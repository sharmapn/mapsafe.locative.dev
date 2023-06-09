require=(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/*
 * Copyright 2018 Uber Technologies, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @module geojson2h3
 */

var h3 = require('h3-js');

var FEATURE = 'Feature';
var FEATURE_COLLECTION = 'FeatureCollection';
var POLYGON = 'Polygon';
var MULTI_POLYGON = 'MultiPolygon';

// ----------------------------------------------------------------------------
// Private utilities

/**
 * Utility for efficient flattening of arrays. This mutates input,
 * flattening into the first array in the list.
 * @private
 * @param {String[][]} arrays Arrays to flatten
 * @return {String} Single array with all values from all input arrays
 */
function flatten(arrays) {
    var out = null;
    for (var i = 0; i < arrays.length; i++) {
        if (out !== null) {
            for (var j = 0; j < arrays[i].length; j++) {
                out.push(arrays[i][j]);
            }
        } else {
            out = arrays[i];
        }
    }
    return Array.from(new Set(out));
}

/**
 * Utility to compute the centroid of a polygon, based on @turf/centroid
 * @private
 * @param {Number[][][]} polygon     Polygon, as an array of loops
 * @return {Number[]} lngLat         Lng/lat centroid
 */
function centroid(polygon) {
    var lngSum = 0;
    var latSum = 0;
    var count = 0;
    var loop = polygon[0];
    for (var i = 0; i < loop.length; i++) {
        lngSum += loop[i][0];
        latSum += loop[i][1];
        count++;
    }
    return [lngSum / count, latSum / count];
}

/**
 * Convert a GeoJSON feature collection to a set of hexagons. Only hexagons whose centers
 * fall within the features will be included.
 * @private
 * @param  {Object} feature     GeoJSON FeatureCollection
 * @param  {Number} resolution  Resolution of hexagons, between 0 and 15
 * @return {String[]}           H3 indexes
 */
function featureCollectionToH3Set(featureCollection, resolution) {
    var features = featureCollection.features;
    if (!features) {
        throw new Error('No features found');
    }
    return flatten(features.map(function (feature) { return featureToH3Set(feature, resolution); }));
}

// ----------------------------------------------------------------------------
// Public API functions

/**
 * Convert a GeoJSON feature to a set of hexagons. *Only hexagons whose centers
 * fall within the feature will be included.* Note that conversion from GeoJSON
 * is lossy; the resulting hexagon set only approximately describes the original
 * shape, at a level of precision determined by the hexagon resolution.
 *
 * If the polygon is small in comparison with the chosen resolution, there may be
 * no cell whose center lies within it, resulting in an empty set. To fall back
 * to a single H3 cell representing the centroid of the polygon in this case, use
 * the `ensureOutput` option.
 *
 * ![featureToH3Set](./doc-files/featureToH3Set.png)
 * @static
 * @param  {Object} feature     Input GeoJSON: type must be either `Feature` or
 *                              `FeatureCollection`, and geometry type must be
 *                              either `Polygon` or `MultiPolygon`
 * @param  {Number} resolution  Resolution of hexagons, between 0 and 15
 * @param  {Object} [options]   Options
 * @param  {Boolean} [options.ensureOutput] Whether to ensure that at least one
 *                              cell is returned in the set
 * @return {String[]}           H3 indexes
 */
function featureToH3Set(feature, resolution, options) {
    if ( options === void 0 ) options = {};

    var type = feature.type;
    var geometry = feature.geometry;
    var geometryType = geometry && geometry.type;

    if (type === FEATURE_COLLECTION) {
        return featureCollectionToH3Set(feature, resolution);
    }

    if (type !== FEATURE) {
        throw new Error(("Unhandled type: " + type));
    }
    if (geometryType !== POLYGON && geometryType !== MULTI_POLYGON) {
        throw new Error(("Unhandled geometry type: " + geometryType));
    }

    // Normalize to MultiPolygon
    var polygons = geometryType === POLYGON ? [geometry.coordinates] : geometry.coordinates;

    // Polyfill each polygon and flatten the results
    return flatten(
        polygons.map(function (polygon) {
            var result = h3.polyfill(polygon, resolution, true);
            if (result.length || !options.ensureOutput) {
                return result;
            }
            // If we got no results, index the centroid
            var ref = centroid(polygon);
            var lng = ref[0];
            var lat = ref[1];
            return [h3.geoToH3(lat, lng, resolution)];
        })
    );
}

/**
 * Convert a single H3 hexagon to a `Polygon` feature
 * @static
 * @param  {String} hexAddress   Hexagon address
 * @param  {Object} [properties] Optional feature properties
 * @return {Feature}             GeoJSON Feature object
 */
function h3ToFeature(h3Index, properties) {
    if ( properties === void 0 ) properties = {};

    // Wrap in an array for a single-loop polygon
    var coordinates = [h3.h3ToGeoBoundary(h3Index, true)];
    return {
        type: FEATURE,
        id: h3Index,
        properties: properties,
        geometry: {
            type: POLYGON,
            coordinates: coordinates
        }
    };
}

/**
 * Convert a set of hexagons to a GeoJSON `Feature` with the set outline(s). The
 * feature's geometry type will be either `Polygon` or `MultiPolygon` depending on
 * the number of outlines required for the set.
 *
 * ![h3SetToFeature](./doc-files/h3SetToFeature.png)
 * @static
 * @param  {String[]} hexagons   Hexagon addresses
 * @param  {Object} [properties] Optional feature properties
 * @return {Feature}             GeoJSON Feature object
 */
function h3SetToFeature(hexagons, properties) {
    if ( properties === void 0 ) properties = {};

    var polygons = h3.h3SetToMultiPolygon(hexagons, true);
    // See if we can unwrap to a simple Polygon.
    var isMultiPolygon = polygons.length > 1;
    var type = isMultiPolygon ? MULTI_POLYGON : POLYGON;
    // MultiPolygon, single polygon, or empty array for an empty hex set
    var coordinates = isMultiPolygon ? polygons : polygons[0] || [];
    return {
        type: FEATURE,
        properties: properties,
        geometry: {
            type: type,
            coordinates: coordinates
        }
    };
}

/**
 * Convert a set of hexagons to a GeoJSON `MultiPolygon` feature with the
 * outlines of each individual hexagon.
 *
 * ![h3SetToMultiPolygonFeature](./doc-files/h3SetToFeatureCollection.png)
 * @static
 * @param  {String[]} hexagons   Hexagon addresses
 * @param  {Object} [properties] Optional feature properties
 * @return {Feature}             GeoJSON Feature object
 */
function h3SetToMultiPolygonFeature(hexagons, properties) {
    if ( properties === void 0 ) properties = {};

    var coordinates = hexagons.map(function (h3Index) { return [h3.h3ToGeoBoundary(h3Index, {geoJson: true})]; }
    );
    return {
        type: FEATURE,
        properties: properties,
        geometry: {
            type: MULTI_POLYGON,
            coordinates: coordinates
        }
    };
}

/**
 * Convert a set of hexagons to a GeoJSON `FeatureCollection` with each hexagon
 * in a separate `Polygon` feature with optional properties.
 *
 * ![h3SetToFeatureCollection](./doc-files/h3SetToFeatureCollection.png)
 * @static
 * @param  {String[]} hexagons  Hexagon addresses
 * @param  {Function} [getProperties] Optional function returning properties
 *                                    for a hexagon: f(h3Index) => Object
 * @return {FeatureCollection}        GeoJSON FeatureCollection object
 */
function h3SetToFeatureCollection(hexagons, getProperties) {
    var features = [];
    for (var i = 0; i < hexagons.length; i++) {
        var h3Index = hexagons[i];
        var properties = getProperties ? getProperties(h3Index) : {};
        features.push(h3ToFeature(h3Index, properties));
    }
    return {
        type: FEATURE_COLLECTION,
        features: features
    };
}

module.exports = {
    featureToH3Set: featureToH3Set,
    h3ToFeature: h3ToFeature,
    h3SetToFeature: h3SetToFeature,
    h3SetToMultiPolygonFeature: h3SetToMultiPolygonFeature,
    h3SetToFeatureCollection: h3SetToFeatureCollection
};

},{"h3-js":2}],2:[function(require,module,exports){
var libh3 = function (libh3) {
  libh3 = libh3 || {};
  var Module = typeof libh3 !== "undefined" ? libh3 : {};
  var moduleOverrides = {};
  var key;

  for (key in Module) {
    if (Module.hasOwnProperty(key)) {
      moduleOverrides[key] = Module[key];
    }
  }

  var arguments_ = [];
  var scriptDirectory = "";

  function locateFile(path) {
    if (Module["locateFile"]) {
      return Module["locateFile"](path, scriptDirectory);
    }

    return scriptDirectory + path;
  }

  var readAsync;

  {
    if (document.currentScript) {
      scriptDirectory = document.currentScript.src;
    }

    if (scriptDirectory.indexOf("blob:") !== 0) {
      scriptDirectory = scriptDirectory.substr(0, scriptDirectory.lastIndexOf("/") + 1);
    } else {
      scriptDirectory = "";
    }

    readAsync = function readAsync(url, onload, onerror) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "arraybuffer";

      xhr.onload = function xhr_onload() {
        if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
          onload(xhr.response);
          return;
        }

        var data = tryParseAsDataURI(url);

        if (data) {
          onload(data.buffer);
          return;
        }

        onerror();
      };

      xhr.onerror = onerror;
      xhr.send(null);
    };
  }

  var out = Module["print"] || console.log.bind(console);
  var err = Module["printErr"] || console.warn.bind(console);

  for (key in moduleOverrides) {
    if (moduleOverrides.hasOwnProperty(key)) {
      Module[key] = moduleOverrides[key];
    }
  }

  moduleOverrides = null;
  if (Module["arguments"]) { arguments_ = Module["arguments"]; }

  var tempRet0 = 0;

  var setTempRet0 = function (value) {
    tempRet0 = value;
  };

  var getTempRet0 = function () {
    return tempRet0;
  };

  var GLOBAL_BASE = 8;

  function setValue(ptr, value, type, noSafe) {
    type = type || "i8";
    if (type.charAt(type.length - 1) === "*") { type = "i32"; }

    switch (type) {
      case "i1":
        HEAP8[ptr >> 0] = value;
        break;

      case "i8":
        HEAP8[ptr >> 0] = value;
        break;

      case "i16":
        HEAP16[ptr >> 1] = value;
        break;

      case "i32":
        HEAP32[ptr >> 2] = value;
        break;

      case "i64":
        tempI64 = [value >>> 0, (tempDouble = value, +Math_abs(tempDouble) >= +1 ? tempDouble > +0 ? (Math_min(+Math_floor(tempDouble / +4294967296), +4294967295) | 0) >>> 0 : ~~+Math_ceil((tempDouble - +(~~tempDouble >>> 0)) / +4294967296) >>> 0 : 0)], HEAP32[ptr >> 2] = tempI64[0], HEAP32[ptr + 4 >> 2] = tempI64[1];
        break;

      case "float":
        HEAPF32[ptr >> 2] = value;
        break;

      case "double":
        HEAPF64[ptr >> 3] = value;
        break;

      default:
        abort("invalid type for setValue: " + type);
    }
  }

  function getValue(ptr, type, noSafe) {
    type = type || "i8";
    if (type.charAt(type.length - 1) === "*") { type = "i32"; }

    switch (type) {
      case "i1":
        return HEAP8[ptr >> 0];

      case "i8":
        return HEAP8[ptr >> 0];

      case "i16":
        return HEAP16[ptr >> 1];

      case "i32":
        return HEAP32[ptr >> 2];

      case "i64":
        return HEAP32[ptr >> 2];

      case "float":
        return HEAPF32[ptr >> 2];

      case "double":
        return HEAPF64[ptr >> 3];

      default:
        abort("invalid type for getValue: " + type);
    }

    return null;
  }

  var ABORT = false;

  function assert(condition, text) {
    if (!condition) {
      abort("Assertion failed: " + text);
    }
  }

  function getCFunc(ident) {
    var func = Module["_" + ident];
    assert(func, "Cannot call unknown function " + ident + ", make sure it is exported");
    return func;
  }

  function ccall(ident, returnType, argTypes, args, opts) {
    var toC = {
      "string": function (str) {
        var ret = 0;

        if (str !== null && str !== undefined && str !== 0) {
          var len = (str.length << 2) + 1;
          ret = stackAlloc(len);
          stringToUTF8(str, ret, len);
        }

        return ret;
      },
      "array": function (arr) {
        var ret = stackAlloc(arr.length);
        writeArrayToMemory(arr, ret);
        return ret;
      }
    };

    function convertReturnValue(ret) {
      if (returnType === "string") { return UTF8ToString(ret); }
      if (returnType === "boolean") { return Boolean(ret); }
      return ret;
    }

    var func = getCFunc(ident);
    var cArgs = [];
    var stack = 0;

    if (args) {
      for (var i = 0; i < args.length; i++) {
        var converter = toC[argTypes[i]];

        if (converter) {
          if (stack === 0) { stack = stackSave(); }
          cArgs[i] = converter(args[i]);
        } else {
          cArgs[i] = args[i];
        }
      }
    }

    var ret = func.apply(null, cArgs);
    ret = convertReturnValue(ret);
    if (stack !== 0) { stackRestore(stack); }
    return ret;
  }

  function cwrap(ident, returnType, argTypes, opts) {
    argTypes = argTypes || [];
    var numericArgs = argTypes.every(function (type) {
      return type === "number";
    });
    var numericRet = returnType !== "string";

    if (numericRet && numericArgs && !opts) {
      return getCFunc(ident);
    }

    return function () {
      return ccall(ident, returnType, argTypes, arguments, opts);
    };
  }
  var UTF8Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf8") : undefined;

  function UTF8ArrayToString(u8Array, idx, maxBytesToRead) {
    var endIdx = idx + maxBytesToRead;
    var endPtr = idx;

    while (u8Array[endPtr] && !(endPtr >= endIdx)) { ++endPtr; }

    if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
      return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
    } else {
      var str = "";

      while (idx < endPtr) {
        var u0 = u8Array[idx++];

        if (!(u0 & 128)) {
          str += String.fromCharCode(u0);
          continue;
        }

        var u1 = u8Array[idx++] & 63;

        if ((u0 & 224) == 192) {
          str += String.fromCharCode((u0 & 31) << 6 | u1);
          continue;
        }

        var u2 = u8Array[idx++] & 63;

        if ((u0 & 240) == 224) {
          u0 = (u0 & 15) << 12 | u1 << 6 | u2;
        } else {
          u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | u8Array[idx++] & 63;
        }

        if (u0 < 65536) {
          str += String.fromCharCode(u0);
        } else {
          var ch = u0 - 65536;
          str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
        }
      }
    }

    return str;
  }

  function UTF8ToString(ptr, maxBytesToRead) {
    return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
  }

  function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
    if (!(maxBytesToWrite > 0)) { return 0; }
    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1;

    for (var i = 0; i < str.length; ++i) {
      var u = str.charCodeAt(i);

      if (u >= 55296 && u <= 57343) {
        var u1 = str.charCodeAt(++i);
        u = 65536 + ((u & 1023) << 10) | u1 & 1023;
      }

      if (u <= 127) {
        if (outIdx >= endIdx) { break; }
        outU8Array[outIdx++] = u;
      } else if (u <= 2047) {
        if (outIdx + 1 >= endIdx) { break; }
        outU8Array[outIdx++] = 192 | u >> 6;
        outU8Array[outIdx++] = 128 | u & 63;
      } else if (u <= 65535) {
        if (outIdx + 2 >= endIdx) { break; }
        outU8Array[outIdx++] = 224 | u >> 12;
        outU8Array[outIdx++] = 128 | u >> 6 & 63;
        outU8Array[outIdx++] = 128 | u & 63;
      } else {
        if (outIdx + 3 >= endIdx) { break; }
        outU8Array[outIdx++] = 240 | u >> 18;
        outU8Array[outIdx++] = 128 | u >> 12 & 63;
        outU8Array[outIdx++] = 128 | u >> 6 & 63;
        outU8Array[outIdx++] = 128 | u & 63;
      }
    }

    outU8Array[outIdx] = 0;
    return outIdx - startIdx;
  }

  function stringToUTF8(str, outPtr, maxBytesToWrite) {
    return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
  }

  var UTF16Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-16le") : undefined;

  function writeArrayToMemory(array, buffer) {
    HEAP8.set(array, buffer);
  }

  function alignUp(x, multiple) {
    if (x % multiple > 0) {
      x += multiple - x % multiple;
    }

    return x;
  }

  var buffer, HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;

  function updateGlobalBufferAndViews(buf) {
    buffer = buf;
    Module["HEAP8"] = HEAP8 = new Int8Array(buf);
    Module["HEAP16"] = HEAP16 = new Int16Array(buf);
    Module["HEAP32"] = HEAP32 = new Int32Array(buf);
    Module["HEAPU8"] = HEAPU8 = new Uint8Array(buf);
    Module["HEAPU16"] = HEAPU16 = new Uint16Array(buf);
    Module["HEAPU32"] = HEAPU32 = new Uint32Array(buf);
    Module["HEAPF32"] = HEAPF32 = new Float32Array(buf);
    Module["HEAPF64"] = HEAPF64 = new Float64Array(buf);
  }

  var DYNAMIC_BASE = 5266928,
      DYNAMICTOP_PTR = 24016;
  var INITIAL_TOTAL_MEMORY = Module["TOTAL_MEMORY"] || 33554432;

  if (Module["buffer"]) {
    buffer = Module["buffer"];
  } else {
    buffer = new ArrayBuffer(INITIAL_TOTAL_MEMORY);
  }

  INITIAL_TOTAL_MEMORY = buffer.byteLength;
  updateGlobalBufferAndViews(buffer);
  HEAP32[DYNAMICTOP_PTR >> 2] = DYNAMIC_BASE;

  function callRuntimeCallbacks(callbacks) {
    while (callbacks.length > 0) {
      var callback = callbacks.shift();

      if (typeof callback == "function") {
        callback();
        continue;
      }

      var func = callback.func;

      if (typeof func === "number") {
        if (callback.arg === undefined) {
          Module["dynCall_v"](func);
        } else {
          Module["dynCall_vi"](func, callback.arg);
        }
      } else {
        func(callback.arg === undefined ? null : callback.arg);
      }
    }
  }

  var __ATPRERUN__ = [];
  var __ATINIT__ = [];
  var __ATMAIN__ = [];
  var __ATPOSTRUN__ = [];

  function preRun() {
    if (Module["preRun"]) {
      if (typeof Module["preRun"] == "function") { Module["preRun"] = [Module["preRun"]]; }

      while (Module["preRun"].length) {
        addOnPreRun(Module["preRun"].shift());
      }
    }

    callRuntimeCallbacks(__ATPRERUN__);
  }

  function initRuntime() {
    callRuntimeCallbacks(__ATINIT__);
  }

  function preMain() {
    callRuntimeCallbacks(__ATMAIN__);
  }

  function postRun() {
    if (Module["postRun"]) {
      if (typeof Module["postRun"] == "function") { Module["postRun"] = [Module["postRun"]]; }

      while (Module["postRun"].length) {
        addOnPostRun(Module["postRun"].shift());
      }
    }

    callRuntimeCallbacks(__ATPOSTRUN__);
  }

  function addOnPreRun(cb) {
    __ATPRERUN__.unshift(cb);
  }

  function addOnPostRun(cb) {
    __ATPOSTRUN__.unshift(cb);
  }

  var Math_abs = Math.abs;
  var Math_ceil = Math.ceil;
  var Math_floor = Math.floor;
  var Math_min = Math.min;
  var runDependencies = 0;
  var runDependencyWatcher = null;
  var dependenciesFulfilled = null;

  function addRunDependency(id) {
    runDependencies++;

    if (Module["monitorRunDependencies"]) {
      Module["monitorRunDependencies"](runDependencies);
    }
  }

  function removeRunDependency(id) {
    runDependencies--;

    if (Module["monitorRunDependencies"]) {
      Module["monitorRunDependencies"](runDependencies);
    }

    if (runDependencies == 0) {
      if (runDependencyWatcher !== null) {
        clearInterval(runDependencyWatcher);
        runDependencyWatcher = null;
      }

      if (dependenciesFulfilled) {
        var callback = dependenciesFulfilled;
        dependenciesFulfilled = null;
        callback();
      }
    }
  }

  Module["preloadedImages"] = {};
  Module["preloadedAudios"] = {};
  var memoryInitializer = null;
  var dataURIPrefix = "data:application/octet-stream;base64,";

  function isDataURI(filename) {
    return String.prototype.startsWith ? filename.startsWith(dataURIPrefix) : filename.indexOf(dataURIPrefix) === 0;
  }

  var tempDouble;
  var tempI64;
  memoryInitializer = "data:application/octet-stream;base64,AAAAAAAAAAACAAAAAwAAAAEAAAAFAAAABAAAAAYAAAAAAAAAAAAAAAAAAAABAAAAAgAAAAMAAAAEAAAABQAAAAYAAAABAAAABAAAAAMAAAAGAAAABQAAAAIAAAAAAAAAAgAAAAMAAAABAAAABAAAAAYAAAAAAAAABQAAAAMAAAAGAAAABAAAAAUAAAAAAAAAAQAAAAIAAAAEAAAABQAAAAYAAAAAAAAAAgAAAAMAAAABAAAABQAAAAIAAAAAAAAAAQAAAAMAAAAGAAAABAAAAAYAAAAAAAAABQAAAAIAAAABAAAABAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAgAAAAMAAAAAAAAAAAAAAAIAAAAAAAAAAQAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAEAAAABgAAAAAAAAAFAAAAAAAAAAAAAAAEAAAABQAAAAAAAAAAAAAAAAAAAAIAAAAAAAAABgAAAAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAACAAAAAwAAAAQAAAAFAAAABgAAAAEAAAACAAAAAwAAAAQAAAAFAAAABgAAAAAAAAACAAAAAwAAAAQAAAAFAAAABgAAAAAAAAABAAAAAwAAAAQAAAAFAAAABgAAAAAAAAABAAAAAgAAAAQAAAAFAAAABgAAAAAAAAABAAAAAgAAAAMAAAAFAAAABgAAAAAAAAABAAAAAgAAAAMAAAAEAAAABgAAAAAAAAABAAAAAgAAAAMAAAAEAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAADAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAACAAAAAgAAAAAAAAAAAAAABgAAAAAAAAADAAAAAgAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAUAAAAEAAAAAAAAAAEAAAAAAAAAAAAAAAUAAAAFAAAAAAAAAAAAAAAAAAAABgAAAAAAAAAEAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAUAAAACAAAABAAAAAMAAAAIAAAAAQAAAAcAAAAGAAAACQAAAAAAAAADAAAAAgAAAAIAAAAGAAAACgAAAAsAAAAAAAAAAQAAAAUAAAADAAAADQAAAAEAAAAHAAAABAAAAAwAAAAAAAAABAAAAH8AAAAPAAAACAAAAAMAAAAAAAAADAAAAAUAAAACAAAAEgAAAAoAAAAIAAAAAAAAABAAAAAGAAAADgAAAAsAAAARAAAAAQAAAAkAAAACAAAABwAAABUAAAAJAAAAEwAAAAMAAAANAAAAAQAAAAgAAAAFAAAAFgAAABAAAAAEAAAAAAAAAA8AAAAJAAAAEwAAAA4AAAAUAAAAAQAAAAcAAAAGAAAACgAAAAsAAAAYAAAAFwAAAAUAAAACAAAAEgAAAAsAAAARAAAAFwAAABkAAAACAAAABgAAAAoAAAAMAAAAHAAAAA0AAAAaAAAABAAAAA8AAAADAAAADQAAABoAAAAVAAAAHQAAAAMAAAAMAAAABwAAAA4AAAB/AAAAEQAAABsAAAAJAAAAFAAAAAYAAAAPAAAAFgAAABwAAAAfAAAABAAAAAgAAAAMAAAAEAAAABIAAAAhAAAAHgAAAAgAAAAFAAAAFgAAABEAAAALAAAADgAAAAYAAAAjAAAAGQAAABsAAAASAAAAGAAAAB4AAAAgAAAABQAAAAoAAAAQAAAAEwAAACIAAAAUAAAAJAAAAAcAAAAVAAAACQAAABQAAAAOAAAAEwAAAAkAAAAoAAAAGwAAACQAAAAVAAAAJgAAABMAAAAiAAAADQAAAB0AAAAHAAAAFgAAABAAAAApAAAAIQAAAA8AAAAIAAAAHwAAABcAAAAYAAAACwAAAAoAAAAnAAAAJQAAABkAAAAYAAAAfwAAACAAAAAlAAAACgAAABcAAAASAAAAGQAAABcAAAARAAAACwAAAC0AAAAnAAAAIwAAABoAAAAqAAAAHQAAACsAAAAMAAAAHAAAAA0AAAAbAAAAKAAAACMAAAAuAAAADgAAABQAAAARAAAAHAAAAB8AAAAqAAAALAAAAAwAAAAPAAAAGgAAAB0AAAArAAAAJgAAAC8AAAANAAAAGgAAABUAAAAeAAAAIAAAADAAAAAyAAAAEAAAABIAAAAhAAAAHwAAACkAAAAsAAAANQAAAA8AAAAWAAAAHAAAACAAAAAeAAAAGAAAABIAAAA0AAAAMgAAACUAAAAhAAAAHgAAADEAAAAwAAAAFgAAABAAAAApAAAAIgAAABMAAAAmAAAAFQAAADYAAAAkAAAAMwAAACMAAAAuAAAALQAAADgAAAARAAAAGwAAABkAAAAkAAAAFAAAACIAAAATAAAANwAAACgAAAA2AAAAJQAAACcAAAA0AAAAOQAAABgAAAAXAAAAIAAAACYAAAB/AAAAIgAAADMAAAAdAAAALwAAABUAAAAnAAAAJQAAABkAAAAXAAAAOwAAADkAAAAtAAAAKAAAABsAAAAkAAAAFAAAADwAAAAuAAAANwAAACkAAAAxAAAANQAAAD0AAAAWAAAAIQAAAB8AAAAqAAAAOgAAACsAAAA+AAAAHAAAACwAAAAaAAAAKwAAAD4AAAAvAAAAQAAAABoAAAAqAAAAHQAAACwAAAA1AAAAOgAAAEEAAAAcAAAAHwAAACoAAAAtAAAAJwAAACMAAAAZAAAAPwAAADsAAAA4AAAALgAAADwAAAA4AAAARAAAABsAAAAoAAAAIwAAAC8AAAAmAAAAKwAAAB0AAABFAAAAMwAAAEAAAAAwAAAAMQAAAB4AAAAhAAAAQwAAAEIAAAAyAAAAMQAAAH8AAAA9AAAAQgAAACEAAAAwAAAAKQAAADIAAAAwAAAAIAAAAB4AAABGAAAAQwAAADQAAAAzAAAARQAAADYAAABHAAAAJgAAAC8AAAAiAAAANAAAADkAAABGAAAASgAAACAAAAAlAAAAMgAAADUAAAA9AAAAQQAAAEsAAAAfAAAAKQAAACwAAAA2AAAARwAAADcAAABJAAAAIgAAADMAAAAkAAAANwAAACgAAAA2AAAAJAAAAEgAAAA8AAAASQAAADgAAABEAAAAPwAAAE0AAAAjAAAALgAAAC0AAAA5AAAAOwAAAEoAAABOAAAAJQAAACcAAAA0AAAAOgAAAH8AAAA+AAAATAAAACwAAABBAAAAKgAAADsAAAA/AAAATgAAAE8AAAAnAAAALQAAADkAAAA8AAAASAAAAEQAAABQAAAAKAAAADcAAAAuAAAAPQAAADUAAAAxAAAAKQAAAFEAAABLAAAAQgAAAD4AAAArAAAAOgAAACoAAABSAAAAQAAAAEwAAAA/AAAAfwAAADgAAAAtAAAATwAAADsAAABNAAAAQAAAAC8AAAA+AAAAKwAAAFQAAABFAAAAUgAAAEEAAAA6AAAANQAAACwAAABWAAAATAAAAEsAAABCAAAAQwAAAFEAAABVAAAAMQAAADAAAAA9AAAAQwAAAEIAAAAyAAAAMAAAAFcAAABVAAAARgAAAEQAAAA4AAAAPAAAAC4AAABaAAAATQAAAFAAAABFAAAAMwAAAEAAAAAvAAAAWQAAAEcAAABUAAAARgAAAEMAAAA0AAAAMgAAAFMAAABXAAAASgAAAEcAAABZAAAASQAAAFsAAAAzAAAARQAAADYAAABIAAAAfwAAAEkAAAA3AAAAUAAAADwAAABYAAAASQAAAFsAAABIAAAAWAAAADYAAABHAAAANwAAAEoAAABOAAAAUwAAAFwAAAA0AAAAOQAAAEYAAABLAAAAQQAAAD0AAAA1AAAAXgAAAFYAAABRAAAATAAAAFYAAABSAAAAYAAAADoAAABBAAAAPgAAAE0AAAA/AAAARAAAADgAAABdAAAATwAAAFoAAABOAAAASgAAADsAAAA5AAAAXwAAAFwAAABPAAAATwAAAE4AAAA/AAAAOwAAAF0AAABfAAAATQAAAFAAAABEAAAASAAAADwAAABjAAAAWgAAAFgAAABRAAAAVQAAAF4AAABlAAAAPQAAAEIAAABLAAAAUgAAAGAAAABUAAAAYgAAAD4AAABMAAAAQAAAAFMAAAB/AAAASgAAAEYAAABkAAAAVwAAAFwAAABUAAAARQAAAFIAAABAAAAAYQAAAFkAAABiAAAAVQAAAFcAAABlAAAAZgAAAEIAAABDAAAAUQAAAFYAAABMAAAASwAAAEEAAABoAAAAYAAAAF4AAABXAAAAUwAAAGYAAABkAAAAQwAAAEYAAABVAAAAWAAAAEgAAABbAAAASQAAAGMAAABQAAAAaQAAAFkAAABhAAAAWwAAAGcAAABFAAAAVAAAAEcAAABaAAAATQAAAFAAAABEAAAAagAAAF0AAABjAAAAWwAAAEkAAABZAAAARwAAAGkAAABYAAAAZwAAAFwAAABTAAAATgAAAEoAAABsAAAAZAAAAF8AAABdAAAATwAAAFoAAABNAAAAbQAAAF8AAABqAAAAXgAAAFYAAABRAAAASwAAAGsAAABoAAAAZQAAAF8AAABcAAAATwAAAE4AAABtAAAAbAAAAF0AAABgAAAAaAAAAGIAAABuAAAATAAAAFYAAABSAAAAYQAAAH8AAABiAAAAVAAAAGcAAABZAAAAbwAAAGIAAABuAAAAYQAAAG8AAABSAAAAYAAAAFQAAABjAAAAUAAAAGkAAABYAAAAagAAAFoAAABxAAAAZAAAAGYAAABTAAAAVwAAAGwAAAByAAAAXAAAAGUAAABmAAAAawAAAHAAAABRAAAAVQAAAF4AAABmAAAAZQAAAFcAAABVAAAAcgAAAHAAAABkAAAAZwAAAFsAAABhAAAAWQAAAHQAAABpAAAAbwAAAGgAAABrAAAAbgAAAHMAAABWAAAAXgAAAGAAAABpAAAAWAAAAGcAAABbAAAAcQAAAGMAAAB0AAAAagAAAF0AAABjAAAAWgAAAHUAAABtAAAAcQAAAGsAAAB/AAAAZQAAAF4AAABzAAAAaAAAAHAAAABsAAAAZAAAAF8AAABcAAAAdgAAAHIAAABtAAAAbQAAAGwAAABdAAAAXwAAAHUAAAB2AAAAagAAAG4AAABiAAAAaAAAAGAAAAB3AAAAbwAAAHMAAABvAAAAYQAAAG4AAABiAAAAdAAAAGcAAAB3AAAAcAAAAGsAAABmAAAAZQAAAHgAAABzAAAAcgAAAHEAAABjAAAAdAAAAGkAAAB1AAAAagAAAHkAAAByAAAAcAAAAGQAAABmAAAAdgAAAHgAAABsAAAAcwAAAG4AAABrAAAAaAAAAHgAAAB3AAAAcAAAAHQAAABnAAAAdwAAAG8AAABxAAAAaQAAAHkAAAB1AAAAfwAAAG0AAAB2AAAAcQAAAHkAAABqAAAAdgAAAHgAAABsAAAAcgAAAHUAAAB5AAAAbQAAAHcAAABvAAAAcwAAAG4AAAB5AAAAdAAAAHgAAAB4AAAAcwAAAHIAAABwAAAAeQAAAHcAAAB2AAAAeQAAAHQAAAB4AAAAdwAAAHUAAABxAAAAdgAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAEAAAAFAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAIAAAAFAAAAAQAAAAAAAAD/////AQAAAAAAAAADAAAABAAAAAIAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAwAAAAUAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAUAAAABAAAAAAAAAAAAAAABAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAMAAAAFAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAEAAAAAAAAA/////wMAAAAAAAAABQAAAAIAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAQAAAAFAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAwAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAUAAAAFAAAAAAAAAAAAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAUAAAAFAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAMAAAAAAAAAAAAAAP////8DAAAAAAAAAAUAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAADAAAAAAAAAAAAAAABAAAAAAAAAAMAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAwAAAAAAAAADAAAAAAAAAAAAAAABAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAADAAAAAwAAAAMAAAADAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAMAAAAAAAAA/////wMAAAAAAAAABQAAAAIAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAADAAAAAAAAAAAAAAADAAAAAAAAAAAAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAADAAAABQAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAUAAAAFAAAAAAAAAAAAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAADAAAAAAAAAAAAAAABAAAAAAAAAAAAAAADAAAAAAAAAAAAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAADAAAAAwAAAAAAAAADAAAAAAAAAAAAAAD/////AwAAAAAAAAAFAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAADAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAwAAAAAAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAMAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAMAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAAAAAD/////AwAAAAAAAAAFAAAAAgAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAMAAAADAAAAAwAAAAMAAAADAAAAAAAAAAAAAAADAAAAAwAAAAMAAAADAAAAAAAAAAMAAAAAAAAAAwAAAAMAAAADAAAAAwAAAAAAAAADAAAAAAAAAP////8DAAAAAAAAAAUAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAwAAAAAAAAADAAAAAAAAAAAAAAADAAAAAwAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAMAAAAAAAAAAAAAAP////8DAAAAAAAAAAUAAAACAAAAAAAAAAAAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAMAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAUAAAAAAAAAAAAAAAMAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAMAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAADAAAAAQAAAAAAAAABAAAAAAAAAAAAAAADAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAMAAAAAAAAA/////wMAAAAAAAAABQAAAAIAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAMAAAAAAAAAAAAAAAMAAAADAAAAAwAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAABQAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAUAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAUAAAAFAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAADAAAAAAAAAAAAAAD/////AwAAAAAAAAAFAAAAAgAAAAAAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAADAAAAAAAAAAUAAAAAAAAAAAAAAAUAAAAFAAAAAAAAAAAAAAAAAAAAAQAAAAMAAAABAAAAAAAAAAEAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAADAAAAAAAAAAMAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAMAAAABAAAAAAAAAAEAAAAAAAAAAwAAAAMAAAADAAAAAwAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAADAAAABQAAAAEAAAAAAAAA/////wMAAAAAAAAABQAAAAIAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAUAAAAFAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAEAAAABQAAAAEAAAAAAAAAAwAAAAMAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAgAAAAUAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAMAAAABAAAAAAAAAAEAAAAAAAAABQAAAAAAAAAAAAAABQAAAAUAAAAAAAAAAAAAAP////8BAAAAAAAAAAMAAAAEAAAAAgAAAAAAAAAAAAAAAQAAAAAAAAAAAAAABQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAUAAAAAAAAAAAAAAAUAAAAFAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAABQAAAAEAAAAAAAAAAAAAAAEAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAQAAAP//////////AQAAAAEAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAMAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAACwAAAAIAAAAAAAAAAAAAAAEAAAACAAAABgAAAAQAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAEAAAABAAAAAAAAAAAAAAAAAAAABwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAoAAAACAAAAAAAAAAAAAAABAAAAAQAAAAUAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAACwAAAAEAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAIAAAAAAAAAAAAAAAEAAAADAAAABwAAAAYAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAHAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAEAAAABAAAAAAAAAAAAAAAAAAAABAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAOAAAAAgAAAAAAAAAAAAAAAQAAAAAAAAAJAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAwAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACwAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANAAAAAgAAAAAAAAAAAAAAAQAAAAQAAAAIAAAACgAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAsAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAJAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAACAAAAAAAAAAAAAAABAAAACwAAAA8AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAA4AAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAAQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAgAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAFAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAACAAAAAAAAAAAAAAABAAAADAAAABAAAAAMAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAPAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAA4AAAABAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAANAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAABQAAAAIAAAAAAAAAAAAAAAEAAAAKAAAAEwAAAAgAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAARAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARAAAAAAAAAAEAAAABAAAAAAAAAAAAAAAAAAAADwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAABAAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAJAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAgAAAAAAAAAAAAAAAQAAAA0AAAARAAAADQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAABEAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAATAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAADgAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAABMAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAARAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAADQAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAABEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACQAAAAIAAAAAAAAAAAAAAAEAAAAOAAAAEgAAAA8AAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAPAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEgAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAAABIAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAATAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAEQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAEgAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAABMAAAACAAAAAAAAAAAAAAABAAAA//////////8TAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABMAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAASAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABIAAAAAAAAAGAAAAAAAAAAhAAAAAAAAAB4AAAAAAAAAIAAAAAMAAAAxAAAAAQAAADAAAAADAAAAMgAAAAMAAAAIAAAAAAAAAAUAAAAFAAAACgAAAAUAAAAWAAAAAAAAABAAAAAAAAAAEgAAAAAAAAApAAAAAQAAACEAAAAAAAAAHgAAAAAAAAAEAAAAAAAAAAAAAAAFAAAAAgAAAAUAAAAPAAAAAQAAAAgAAAAAAAAABQAAAAUAAAAfAAAAAQAAABYAAAAAAAAAEAAAAAAAAAACAAAAAAAAAAYAAAAAAAAADgAAAAAAAAAKAAAAAAAAAAsAAAAAAAAAEQAAAAMAAAAYAAAAAQAAABcAAAADAAAAGQAAAAMAAAAAAAAAAAAAAAEAAAAFAAAACQAAAAUAAAAFAAAAAAAAAAIAAAAAAAAABgAAAAAAAAASAAAAAQAAAAoAAAAAAAAACwAAAAAAAAAEAAAAAQAAAAMAAAAFAAAABwAAAAUAAAAIAAAAAQAAAAAAAAAAAAAAAQAAAAUAAAAQAAAAAQAAAAUAAAAAAAAAAgAAAAAAAAAHAAAAAAAAABUAAAAAAAAAJgAAAAAAAAAJAAAAAAAAABMAAAAAAAAAIgAAAAMAAAAOAAAAAQAAABQAAAADAAAAJAAAAAMAAAADAAAAAAAAAA0AAAAFAAAAHQAAAAUAAAABAAAAAAAAAAcAAAAAAAAAFQAAAAAAAAAGAAAAAQAAAAkAAAAAAAAAEwAAAAAAAAAEAAAAAgAAAAwAAAAFAAAAGgAAAAUAAAAAAAAAAQAAAAMAAAAAAAAADQAAAAUAAAACAAAAAQAAAAEAAAAAAAAABwAAAAAAAAAaAAAAAAAAACoAAAAAAAAAOgAAAAAAAAAdAAAAAAAAACsAAAAAAAAAPgAAAAMAAAAmAAAAAQAAAC8AAAADAAAAQAAAAAMAAAAMAAAAAAAAABwAAAAFAAAALAAAAAUAAAANAAAAAAAAABoAAAAAAAAAKgAAAAAAAAAVAAAAAQAAAB0AAAAAAAAAKwAAAAAAAAAEAAAAAwAAAA8AAAAFAAAAHwAAAAUAAAADAAAAAQAAAAwAAAAAAAAAHAAAAAUAAAAHAAAAAQAAAA0AAAAAAAAAGgAAAAAAAAAfAAAAAAAAACkAAAAAAAAAMQAAAAAAAAAsAAAAAAAAADUAAAAAAAAAPQAAAAMAAAA6AAAAAQAAAEEAAAADAAAASwAAAAMAAAAPAAAAAAAAABYAAAAFAAAAIQAAAAUAAAAcAAAAAAAAAB8AAAAAAAAAKQAAAAAAAAAqAAAAAQAAACwAAAAAAAAANQAAAAAAAAAEAAAABAAAAAgAAAAFAAAAEAAAAAUAAAAMAAAAAQAAAA8AAAAAAAAAFgAAAAUAAAAaAAAAAQAAABwAAAAAAAAAHwAAAAAAAAAyAAAAAAAAADAAAAAAAAAAMQAAAAMAAAAgAAAAAAAAAB4AAAADAAAAIQAAAAMAAAAYAAAAAwAAABIAAAADAAAAEAAAAAMAAABGAAAAAAAAAEMAAAAAAAAAQgAAAAMAAAA0AAAAAwAAADIAAAAAAAAAMAAAAAAAAAAlAAAAAwAAACAAAAAAAAAAHgAAAAMAAABTAAAAAAAAAFcAAAADAAAAVQAAAAMAAABKAAAAAwAAAEYAAAAAAAAAQwAAAAAAAAA5AAAAAQAAADQAAAADAAAAMgAAAAAAAAAZAAAAAAAAABcAAAAAAAAAGAAAAAMAAAARAAAAAAAAAAsAAAADAAAACgAAAAMAAAAOAAAAAwAAAAYAAAADAAAAAgAAAAMAAAAtAAAAAAAAACcAAAAAAAAAJQAAAAMAAAAjAAAAAwAAABkAAAAAAAAAFwAAAAAAAAAbAAAAAwAAABEAAAAAAAAACwAAAAMAAAA/AAAAAAAAADsAAAADAAAAOQAAAAMAAAA4AAAAAwAAAC0AAAAAAAAAJwAAAAAAAAAuAAAAAwAAACMAAAADAAAAGQAAAAAAAAAkAAAAAAAAABQAAAAAAAAADgAAAAMAAAAiAAAAAAAAABMAAAADAAAACQAAAAMAAAAmAAAAAwAAABUAAAADAAAABwAAAAMAAAA3AAAAAAAAACgAAAAAAAAAGwAAAAMAAAA2AAAAAwAAACQAAAAAAAAAFAAAAAAAAAAzAAAAAwAAACIAAAAAAAAAEwAAAAMAAABIAAAAAAAAADwAAAADAAAALgAAAAMAAABJAAAAAwAAADcAAAAAAAAAKAAAAAAAAABHAAAAAwAAADYAAAADAAAAJAAAAAAAAABAAAAAAAAAAC8AAAAAAAAAJgAAAAMAAAA+AAAAAAAAACsAAAADAAAAHQAAAAMAAAA6AAAAAwAAACoAAAADAAAAGgAAAAMAAABUAAAAAAAAAEUAAAAAAAAAMwAAAAMAAABSAAAAAwAAAEAAAAAAAAAALwAAAAAAAABMAAAAAwAAAD4AAAAAAAAAKwAAAAMAAABhAAAAAAAAAFkAAAADAAAARwAAAAMAAABiAAAAAwAAAFQAAAAAAAAARQAAAAAAAABgAAAAAwAAAFIAAAADAAAAQAAAAAAAAABLAAAAAAAAAEEAAAAAAAAAOgAAAAMAAAA9AAAAAAAAADUAAAADAAAALAAAAAMAAAAxAAAAAwAAACkAAAADAAAAHwAAAAMAAABeAAAAAAAAAFYAAAAAAAAATAAAAAMAAABRAAAAAwAAAEsAAAAAAAAAQQAAAAAAAABCAAAAAwAAAD0AAAAAAAAANQAAAAMAAABrAAAAAAAAAGgAAAADAAAAYAAAAAMAAABlAAAAAwAAAF4AAAAAAAAAVgAAAAAAAABVAAAAAwAAAFEAAAADAAAASwAAAAAAAAA5AAAAAAAAADsAAAAAAAAAPwAAAAMAAABKAAAAAAAAAE4AAAADAAAATwAAAAMAAABTAAAAAwAAAFwAAAADAAAAXwAAAAMAAAAlAAAAAAAAACcAAAADAAAALQAAAAMAAAA0AAAAAAAAADkAAAAAAAAAOwAAAAAAAABGAAAAAwAAAEoAAAAAAAAATgAAAAMAAAAYAAAAAAAAABcAAAADAAAAGQAAAAMAAAAgAAAAAwAAACUAAAAAAAAAJwAAAAMAAAAyAAAAAwAAADQAAAAAAAAAOQAAAAAAAAAuAAAAAAAAADwAAAAAAAAASAAAAAMAAAA4AAAAAAAAAEQAAAADAAAAUAAAAAMAAAA/AAAAAwAAAE0AAAADAAAAWgAAAAMAAAAbAAAAAAAAACgAAAADAAAANwAAAAMAAAAjAAAAAAAAAC4AAAAAAAAAPAAAAAAAAAAtAAAAAwAAADgAAAAAAAAARAAAAAMAAAAOAAAAAAAAABQAAAADAAAAJAAAAAMAAAARAAAAAwAAABsAAAAAAAAAKAAAAAMAAAAZAAAAAwAAACMAAAAAAAAALgAAAAAAAABHAAAAAAAAAFkAAAAAAAAAYQAAAAMAAABJAAAAAAAAAFsAAAADAAAAZwAAAAMAAABIAAAAAwAAAFgAAAADAAAAaQAAAAMAAAAzAAAAAAAAAEUAAAADAAAAVAAAAAMAAAA2AAAAAAAAAEcAAAAAAAAAWQAAAAAAAAA3AAAAAwAAAEkAAAAAAAAAWwAAAAMAAAAmAAAAAAAAAC8AAAADAAAAQAAAAAMAAAAiAAAAAwAAADMAAAAAAAAARQAAAAMAAAAkAAAAAwAAADYAAAAAAAAARwAAAAAAAABgAAAAAAAAAGgAAAAAAAAAawAAAAMAAABiAAAAAAAAAG4AAAADAAAAcwAAAAMAAABhAAAAAwAAAG8AAAADAAAAdwAAAAMAAABMAAAAAAAAAFYAAAADAAAAXgAAAAMAAABSAAAAAAAAAGAAAAAAAAAAaAAAAAAAAABUAAAAAwAAAGIAAAAAAAAAbgAAAAMAAAA6AAAAAAAAAEEAAAADAAAASwAAAAMAAAA+AAAAAwAAAEwAAAAAAAAAVgAAAAMAAABAAAAAAwAAAFIAAAAAAAAAYAAAAAAAAABVAAAAAAAAAFcAAAAAAAAAUwAAAAMAAABlAAAAAAAAAGYAAAADAAAAZAAAAAMAAABrAAAAAwAAAHAAAAADAAAAcgAAAAMAAABCAAAAAAAAAEMAAAADAAAARgAAAAMAAABRAAAAAAAAAFUAAAAAAAAAVwAAAAAAAABeAAAAAwAAAGUAAAAAAAAAZgAAAAMAAAAxAAAAAAAAADAAAAADAAAAMgAAAAMAAAA9AAAAAwAAAEIAAAAAAAAAQwAAAAMAAABLAAAAAwAAAFEAAAAAAAAAVQAAAAAAAABfAAAAAAAAAFwAAAAAAAAAUwAAAAAAAABPAAAAAAAAAE4AAAAAAAAASgAAAAMAAAA/AAAAAQAAADsAAAADAAAAOQAAAAMAAABtAAAAAAAAAGwAAAAAAAAAZAAAAAUAAABdAAAAAQAAAF8AAAAAAAAAXAAAAAAAAABNAAAAAQAAAE8AAAAAAAAATgAAAAAAAAB1AAAABAAAAHYAAAAFAAAAcgAAAAUAAABqAAAAAQAAAG0AAAAAAAAAbAAAAAAAAABaAAAAAQAAAF0AAAABAAAAXwAAAAAAAABaAAAAAAAAAE0AAAAAAAAAPwAAAAAAAABQAAAAAAAAAEQAAAAAAAAAOAAAAAMAAABIAAAAAQAAADwAAAADAAAALgAAAAMAAABqAAAAAAAAAF0AAAAAAAAATwAAAAUAAABjAAAAAQAAAFoAAAAAAAAATQAAAAAAAABYAAAAAQAAAFAAAAAAAAAARAAAAAAAAAB1AAAAAwAAAG0AAAAFAAAAXwAAAAUAAABxAAAAAQAAAGoAAAAAAAAAXQAAAAAAAABpAAAAAQAAAGMAAAABAAAAWgAAAAAAAABpAAAAAAAAAFgAAAAAAAAASAAAAAAAAABnAAAAAAAAAFsAAAAAAAAASQAAAAMAAABhAAAAAQAAAFkAAAADAAAARwAAAAMAAABxAAAAAAAAAGMAAAAAAAAAUAAAAAUAAAB0AAAAAQAAAGkAAAAAAAAAWAAAAAAAAABvAAAAAQAAAGcAAAAAAAAAWwAAAAAAAAB1AAAAAgAAAGoAAAAFAAAAWgAAAAUAAAB5AAAAAQAAAHEAAAAAAAAAYwAAAAAAAAB3AAAAAQAAAHQAAAABAAAAaQAAAAAAAAB3AAAAAAAAAG8AAAAAAAAAYQAAAAAAAABzAAAAAAAAAG4AAAAAAAAAYgAAAAMAAABrAAAAAQAAAGgAAAADAAAAYAAAAAMAAAB5AAAAAAAAAHQAAAAAAAAAZwAAAAUAAAB4AAAAAQAAAHcAAAAAAAAAbwAAAAAAAABwAAAAAQAAAHMAAAAAAAAAbgAAAAAAAAB1AAAAAQAAAHEAAAAFAAAAaQAAAAUAAAB2AAAAAQAAAHkAAAAAAAAAdAAAAAAAAAByAAAAAQAAAHgAAAABAAAAdwAAAAAAAAByAAAAAAAAAHAAAAAAAAAAawAAAAAAAABkAAAAAAAAAGYAAAAAAAAAZQAAAAMAAABTAAAAAQAAAFcAAAADAAAAVQAAAAMAAAB2AAAAAAAAAHgAAAAAAAAAcwAAAAUAAABsAAAAAQAAAHIAAAAAAAAAcAAAAAAAAABcAAAAAQAAAGQAAAAAAAAAZgAAAAAAAAB1AAAAAAAAAHkAAAAFAAAAdwAAAAUAAABtAAAAAQAAAHYAAAAAAAAAeAAAAAAAAABfAAAAAQAAAGwAAAABAAAAcgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAEAAAABAAAAAAAAAAAAAAABAAAAAAAAAAEAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAB+ogX28rbpPxqumpJv+fM/165tC4ns9D+XaEnTqUsEQFrOtNlC4PA/3U+0XG6P9b9TdUUBxTTjP4PUp8ex1ty/B1rD/EN43z+lcDi6LLrZP/a45NWEHMY/oJ5ijLDZ+j/xw3rjxWPjP2B8A46ioQdAotff3wla2z+FMSpA1jj+v6b5Y1mtPbS/cIu8K0F457/2esiyJpDNv98k5Ts2NeA/pvljWa09tD88ClUJ60MDQPZ6yLImkM0/4ONKxa0UBcD2uOTVhBzGv5G7JRxGave/8cN648Vj47+HCwtkjAXIv6LX398JWtu/qyheaCAL9D9TdUUBxTTjv4gyTxslhwVAB1rD/EN4378EH/28teoFwH6iBfbytum/F6ztFYdK/r/Xrm0Liez0vwcS6wNGWeO/Ws602ULg8L9TCtRLiLT8P8pi5RexJsw/BlIKPVwR5T95Wyu0/QjnP5PjoT7YYcu/mBhKZ6zrwj8wRYS7NebuP3qW6geh+Ls/SLrixebL3r+pcyymN9XrPwmkNHp7xec/GWNMZVAA17+82s+x2BLiPwn2ytbJ9ek/LgEH1sMS1j8yp/2LhTfeP+SnWwtQBbu/d38gkp5X7z8ytsuHaADGPzUYObdf1+m/7IauECWhwz+cjSACjzniP76Z+wUhN9K/1+GEKzup67+/GYr/04baPw6idWOvsuc/ZedTWsRa5b/EJQOuRzi0v/OncYhHPes/h49PixY53j+i8wWfC03Nvw2idWOvsue/ZedTWsRa5T/EJQOuRzi0P/KncYhHPeu/iY9PixY53r+i8wWfC03NP9anWwtQBbs/d38gkp5X778ytsuHaADGvzUYObdf1+k/74auECWhw7+cjSACjzniv8CZ+wUhN9I/1uGEKzup6z+/GYr/04bavwmkNHp7xee/F2NMZVAA1z+82s+x2BLivwr2ytbJ9em/KwEH1sMS1r8yp/2LhTfev81i5RexJsy/BlIKPVwR5b95Wyu0/Qjnv5DjoT7YYcs/nBhKZ6zrwr8wRYS7Nebuv3OW6geh+Lu/SLrixebL3j+pcyymN9Xrv8rHIFfWehZAMBwUdlo0DECTUc17EOb2PxpVB1SWChdAzjbhb9pTDUDQhmdvECX5P9FlMKCC9+g/IIAzjELgE0DajDngMv8GQFhWDmDPjNs/y1guLh96EkAxPi8k7DIEQJCc4URlhRhA3eLKKLwkEECqpNAyTBD/P6xpjXcDiwVAFtl//cQm4z+Ibt3XKiYTQM7mCLUb3QdAoM1t8yVv7D8aLZv2Nk8UQEAJPV5nQwxAtSsfTCoE9z9TPjXLXIIWQBVanC5W9AtAYM3d7Adm9j++5mQz1FoWQBUThyaVBghAwH5muQsV7T89Q1qv82MUQJoWGOfNuBdAzrkClkmwDkDQjKq77t37Py+g0dtitsE/ZwAMTwVPEUBojepluNwBQGYbtuW+t9w/HNWIJs6MEkDTNuQUSlgEQKxktPP5TcQ/ixbLB8JjEUCwuWjXMQYCQAS/R09FkRdAowpiZjhhDkB7LmlczD/7P01iQmhhsAVAnrtTwDy84z/Z6jfQ2TgTQChOCXMnWwpAhrW3daoz8z/HYJvVPI4VQLT3ik5FcA5Angi7LOZd+z+NNVzDy5gXQBXdvVTFUA1AYNMgOeYe+T8+qHXGCwkXQKQTOKwa5AJA8gFVoEMW0T+FwzJyttIRQAEAAAD/////BwAAAP////8xAAAA/////1cBAAD/////YQkAAP////+nQQAA/////5HLAQD/////95AMAP/////B9lcAAAAAAAAAAAAAAAAAAgAAAP////8OAAAA/////2IAAAD/////rgIAAP/////CEgAA/////06DAAD/////IpcDAP/////uIRkA/////4LtrwAAAAAAAAAAAAAAAAAAAAAAAgAAAP//////////AQAAAAMAAAD//////////////////////////////////////////////////////////////////////////wEAAAAAAAAAAgAAAP///////////////wMAAAD//////////////////////////////////////////////////////////////////////////wEAAAAAAAAAAgAAAP///////////////wMAAAD//////////////////////////////////////////////////////////////////////////wEAAAAAAAAAAgAAAP///////////////wMAAAD//////////////////////////////////////////////////////////wIAAAD//////////wEAAAAAAAAA/////////////////////wMAAAD/////////////////////////////////////////////////////AwAAAP////////////////////8AAAAA/////////////////////wEAAAD///////////////8CAAAA////////////////////////////////AwAAAP////////////////////8AAAAA////////////////AgAAAAEAAAD/////////////////////////////////////////////////////AwAAAP////////////////////8AAAAA////////////////AgAAAAEAAAD/////////////////////////////////////////////////////AwAAAP////////////////////8AAAAA////////////////AgAAAAEAAAD/////////////////////////////////////////////////////AwAAAP////////////////////8AAAAA////////////////AgAAAAEAAAD/////////////////////////////////////////////////////AQAAAAIAAAD///////////////8AAAAA/////////////////////wMAAAD/////////////////////////////////////////////////////AQAAAAIAAAD///////////////8AAAAA/////////////////////wMAAAD/////////////////////////////////////////////////////AQAAAAIAAAD///////////////8AAAAA/////////////////////wMAAAD/////////////////////////////////////////////////////AQAAAAIAAAD///////////////8AAAAA/////////////////////wMAAAD///////////////////////////////8CAAAA////////////////AQAAAP////////////////////8AAAAA/////////////////////wMAAAD/////////////////////////////////////////////////////AwAAAP////////////////////8AAAAAAQAAAP//////////AgAAAP//////////////////////////////////////////////////////////AwAAAP///////////////wIAAAAAAAAAAQAAAP//////////////////////////////////////////////////////////////////////////AwAAAP///////////////wIAAAAAAAAAAQAAAP//////////////////////////////////////////////////////////////////////////AwAAAP///////////////wIAAAAAAAAAAQAAAP//////////////////////////////////////////////////////////////////////////AwAAAAEAAAD//////////wIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAgAAAAAAAAACAAAAAQAAAAEAAAACAAAAAgAAAAAAAAAFAAAABQAAAAAAAAACAAAAAgAAAAMAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAIAAAABAAAAAgAAAAIAAAACAAAAAAAAAAUAAAAGAAAAAAAAAAIAAAACAAAAAwAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAIAAAAAAAAAAgAAAAEAAAADAAAAAgAAAAIAAAAAAAAABQAAAAcAAAAAAAAAAgAAAAIAAAADAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAgAAAAAAAAACAAAAAQAAAAQAAAACAAAAAgAAAAAAAAAFAAAACAAAAAAAAAACAAAAAgAAAAMAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAACAAAAAAAAAAIAAAABAAAAAAAAAAIAAAACAAAAAAAAAAUAAAAJAAAAAAAAAAIAAAACAAAAAwAAAAUAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAIAAAACAAAAAAAAAAMAAAAOAAAAAgAAAAAAAAACAAAAAwAAAAAAAAAAAAAAAgAAAAIAAAADAAAABgAAAAAAAAAAAAAAAAAAAAAAAAALAAAAAgAAAAIAAAAAAAAAAwAAAAoAAAACAAAAAAAAAAIAAAADAAAAAQAAAAAAAAACAAAAAgAAAAMAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAACAAAAAgAAAAAAAAADAAAACwAAAAIAAAAAAAAAAgAAAAMAAAACAAAAAAAAAAIAAAACAAAAAwAAAAgAAAAAAAAAAAAAAAAAAAAAAAAADQAAAAIAAAACAAAAAAAAAAMAAAAMAAAAAgAAAAAAAAACAAAAAwAAAAMAAAAAAAAAAgAAAAIAAAADAAAACQAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAgAAAAIAAAAAAAAAAwAAAA0AAAACAAAAAAAAAAIAAAADAAAABAAAAAAAAAACAAAAAgAAAAMAAAAKAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAACAAAAAgAAAAAAAAADAAAABgAAAAIAAAAAAAAAAgAAAAMAAAAPAAAAAAAAAAIAAAACAAAAAwAAAAsAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAIAAAACAAAAAAAAAAMAAAAHAAAAAgAAAAAAAAACAAAAAwAAABAAAAAAAAAAAgAAAAIAAAADAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAgAAAAIAAAAAAAAAAwAAAAgAAAACAAAAAAAAAAIAAAADAAAAEQAAAAAAAAACAAAAAgAAAAMAAAANAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAACAAAAAgAAAAAAAAADAAAACQAAAAIAAAAAAAAAAgAAAAMAAAASAAAAAAAAAAIAAAACAAAAAwAAAA4AAAAAAAAAAAAAAAAAAAAAAAAACQAAAAIAAAACAAAAAAAAAAMAAAAFAAAAAgAAAAAAAAACAAAAAwAAABMAAAAAAAAAAgAAAAIAAAADAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAgAAAAAAAAACAAAAAQAAABMAAAACAAAAAgAAAAAAAAAFAAAACgAAAAAAAAACAAAAAgAAAAMAAAAQAAAAAAAAAAAAAAAAAAAAAAAAABEAAAACAAAAAAAAAAIAAAABAAAADwAAAAIAAAACAAAAAAAAAAUAAAALAAAAAAAAAAIAAAACAAAAAwAAABEAAAAAAAAAAAAAAAAAAAAAAAAAEgAAAAIAAAAAAAAAAgAAAAEAAAAQAAAAAgAAAAIAAAAAAAAABQAAAAwAAAAAAAAAAgAAAAIAAAADAAAAEgAAAAAAAAAAAAAAAAAAAAAAAAATAAAAAgAAAAAAAAACAAAAAQAAABEAAAACAAAAAgAAAAAAAAAFAAAADQAAAAAAAAACAAAAAgAAAAMAAAATAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAACAAAAAAAAAAIAAAABAAAAEgAAAAIAAAACAAAAAAAAAAUAAAAOAAAAAAAAAAIAAAACAAAAAwAAAAIAAAABAAAAAAAAAAEAAAACAAAAAAAAAAAAAAACAAAAAQAAAAAAAAABAAAAAgAAAAEAAAAAAAAAAgAAAAAAAAAFAAAABAAAAAAAAAABAAAABQAAAAAAAAAAAAAABQAAAAQAAAAAAAAAAQAAAAUAAAAEAAAAAAAAAAUAAAAAAAAAAgAAAAEAAAAAAAAAAQAAAAIAAAAAAAAAAAAAAAIAAAABAAAAAAAAAAEAAAACAAAAAQAAAAAAAAACAAAAAgAAAAAAAAABAAAAAAAAAAAAAAAFAAAABAAAAAAAAAABAAAABQAAAAAAAAAAAAAABQAAAAQAAAAAAAAAAQAAAAUAAAAEAAAAAAAAAAUAAAAFAAAAAAAAAAEAAAAAAAAAAAAAAMuhRbbsNlBBYqHW9OmHIkF9XBuqnS31QAK37uYhNMhAOSo3UUupm0DC+6pc6JxvQHV9eseEEEJAzURsCyqlFEB8BQ4NMJjnPyy3tBoS97o/xawXQznRjj89J2K2CZxhP6vX43RIIDQ/S8isgygEBz+LvFHQkmzaPjFFFO7wMq4+AADMLkTtjkIAAOgkJqxhQgAAU7B0MjRCAADwpBcVB0IAAACYP2HaQQAAAIn/Ja5BzczM4Eg6gUHNzMxMU7BTQTMzMzNfgCZBAAAAAEi3+UAAAAAAwGPNQDMzMzMzy6BAmpmZmZkxc0AzMzMzM/NFQDMzMzMzMxlAzczMzMzM7D+ygXSx2U6RQKimJOvQKnpA23hmONTHY0A/AGcxyudNQNb3K647mzZA+S56rrwWIUAm4kUQ+9UJQKre9hGzh/M/BLvoy9WG3T+LmqMf8VHGP2m3nYNV37A/gbFHcyeCmT+cBPWBckiDP61tZACjKW0/q2RbYVUYVj8uDypVyLNAP6jGS5cA5zBBwcqhBdCNGUEGEhQ/JVEDQT6WPnRbNO1AB/AWSJgT1kDfUWNCNLDAQNk+5C33OqlAchWL34QSk0DKvtDIrNV8QNF0G3kFzGVASSeWhBl6UED+/0mNGuk4QGjA/dm/1CJALPLPMql6DEDSHoDrwpP1P2jouzWST+A/egAAAAAAAABKAwAAAAAAAPoWAAAAAAAAyqAAAAAAAAB6ZQQAAAAAAErGHgAAAAAA+mvXAAAAAADK8+MFAAAAAHqqOykAAAAASqmhIAEAAAD6oGvkBwAAAMpm8T43AAAAes+ZuIIBAABKrDQMkwoAAPq1cFUFSgAAyvkUViUGAgAAAAAAAwAAAAYAAAACAAAABQAAAAEAAAAEAAAAAAAAAAAAAAAFAAAAAwAAAAEAAAAGAAAABAAAAAIAAAAAAAAAAAAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAP////////////////////////////////////8AAAAA/////wAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAP////8AAAAAAAAAAAEAAAABAAAAAAAAAAAAAAD/////AAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAA/////wUAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////////////////////////////////////AAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////////////////////////////////////wAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAUAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP////////////////////////////////////8AAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAABAAAAAAAAAAAAAAABAAAAAQAAAAEAAAAAAAAAAQAAAAAAAAAFAAAAAQAAAAEAAAAAAAAAAAAAAAEAAAABAAAAAAAAAAEAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEBAAAAAAABAAEAAAEBAAAAAAABAAAAAQAAAAEAAQAAAAAAAAAAAAAAAAAAAAAEAAAABAAAAAAAAAACAAAAAQAAAAMAAAAOAAAABgAAAAsAAAACAAAABwAAAAEAAAAYAAAABQAAAAoAAAABAAAABgAAAAAAAAAmAAAABwAAAAwAAAADAAAACAAAAAIAAAAxAAAACQAAAA4AAAAAAAAABQAAAAQAAAA6AAAACAAAAA0AAAAEAAAACQAAAAMAAAA/AAAACwAAAAYAAAAPAAAACgAAABAAAABIAAAADAAAAAcAAAAQAAAACwAAABEAAABTAAAACgAAAAUAAAATAAAADgAAAA8AAABhAAAADQAAAAgAAAARAAAADAAAABIAAABrAAAADgAAAAkAAAASAAAADQAAABMAAAB1AAAADwAAABMAAAARAAAAEgAAABAAAAAHAAAABwAAAAEAAAACAAAABAAAAAMAAAAAAAAAAAAAAAcAAAADAAAAAQAAAAIAAAAFAAAABAAAAAAAAAAAAAAAYWxnb3MuYwBfcG9seWZpbGxJbnRlcm5hbABhZGphY2VudEZhY2VEaXJbdG1wRmlqay5mYWNlXVtmaWprLmZhY2VdID09IEtJAGZhY2VpamsuYwBfZmFjZUlqa1BlbnRUb0dlb0JvdW5kYXJ5AGFkamFjZW50RmFjZURpcltjZW50ZXJJSksuZmFjZV1bZmFjZTJdID09IEtJAF9mYWNlSWprVG9HZW9Cb3VuZGFyeQBwb2x5Z29uLT5uZXh0ID09IE5VTEwAbGlua2VkR2VvLmMAYWRkTmV3TGlua2VkUG9seWdvbgBuZXh0ICE9IE5VTEwAbG9vcCAhPSBOVUxMAGFkZE5ld0xpbmtlZExvb3AAcG9seWdvbi0+Zmlyc3QgPT0gTlVMTABhZGRMaW5rZWRMb29wAGNvb3JkICE9IE5VTEwAYWRkTGlua2VkQ29vcmQAbG9vcC0+Zmlyc3QgPT0gTlVMTABpbm5lckxvb3BzICE9IE5VTEwAbm9ybWFsaXplTXVsdGlQb2x5Z29uAGJib3hlcyAhPSBOVUxMAGNhbmRpZGF0ZXMgIT0gTlVMTABmaW5kUG9seWdvbkZvckhvbGUAY2FuZGlkYXRlQkJveGVzICE9IE5VTEwAcmV2RGlyICE9IElOVkFMSURfRElHSVQAbG9jYWxpai5jAGgzVG9Mb2NhbElqawBiYXNlQ2VsbCAhPSBvcmlnaW5CYXNlQ2VsbAAhKG9yaWdpbk9uUGVudCAmJiBpbmRleE9uUGVudCkAcGVudGFnb25Sb3RhdGlvbnMgPj0gMABkaXJlY3Rpb25Sb3RhdGlvbnMgPj0gMABiYXNlQ2VsbCA9PSBvcmlnaW5CYXNlQ2VsbABiYXNlQ2VsbCAhPSBJTlZBTElEX0JBU0VfQ0VMTABsb2NhbElqa1RvSDMAIV9pc0Jhc2VDZWxsUGVudGFnb24oYmFzZUNlbGwpAGJhc2VDZWxsUm90YXRpb25zID49IDAAd2l0aGluUGVudGFnb25Sb3RhdGlvbnMgPj0gMABncmFwaC0+YnVja2V0cyAhPSBOVUxMAHZlcnRleEdyYXBoLmMAaW5pdFZlcnRleEdyYXBoAG5vZGUgIT0gTlVMTABhZGRWZXJ0ZXhOb2Rl";
  var tempDoublePtr = 24032;

  function demangle(func) {
    return func;
  }

  function demangleAll(text) {
    var regex = /\b__Z[\w\d_]+/g;
    return text.replace(regex, function (x) {
      var y = demangle(x);
      return x === y ? x : y + " [" + x + "]";
    });
  }

  function jsStackTrace() {
    var err = new Error();

    if (!err.stack) {
      try {
        throw new Error(0);
      } catch (e) {
        err = e;
      }

      if (!err.stack) {
        return "(no stack trace available)";
      }
    }

    return err.stack.toString();
  }

  function stackTrace() {
    var js = jsStackTrace();
    if (Module["extraStackTrace"]) { js += "\n" + Module["extraStackTrace"](); }
    return demangleAll(js);
  }

  function ___assert_fail(condition, filename, line, func) {
    abort("Assertion failed: " + UTF8ToString(condition) + ", at: " + [filename ? UTF8ToString(filename) : "unknown filename", line, func ? UTF8ToString(func) : "unknown function"]);
  }

  function _emscripten_get_heap_size() {
    return HEAP8.length;
  }

  function _emscripten_memcpy_big(dest, src, num) {
    HEAPU8.set(HEAPU8.subarray(src, src + num), dest);
  }

  function ___setErrNo(value) {
    if (Module["___errno_location"]) { HEAP32[Module["___errno_location"]() >> 2] = value; }
    return value;
  }

  function abortOnCannotGrowMemory(requestedSize) {
    abort("OOM");
  }

  function emscripten_realloc_buffer(size) {
    try {
      var newBuffer = new ArrayBuffer(size);
      if (newBuffer.byteLength != size) { return; }
      new Int8Array(newBuffer).set(HEAP8);

      _emscripten_replace_memory(newBuffer);

      updateGlobalBufferAndViews(newBuffer);
      return 1;
    } catch (e) {}
  }

  function _emscripten_resize_heap(requestedSize) {
    var oldSize = _emscripten_get_heap_size();

    var PAGE_MULTIPLE = 16777216;
    var LIMIT = 2147483648 - PAGE_MULTIPLE;

    if (requestedSize > LIMIT) {
      return false;
    }

    var MIN_TOTAL_MEMORY = 16777216;
    var newSize = Math.max(oldSize, MIN_TOTAL_MEMORY);

    while (newSize < requestedSize) {
      if (newSize <= 536870912) {
        newSize = alignUp(2 * newSize, PAGE_MULTIPLE);
      } else {
        newSize = Math.min(alignUp((3 * newSize + 2147483648) / 4, PAGE_MULTIPLE), LIMIT);
      }
    }

    var replacement = emscripten_realloc_buffer(newSize);

    if (!replacement) {
      return false;
    }

    return true;
  }

  var decodeBase64 = typeof atob === "function" ? atob : function (input) {
    var keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var output = "";
    var chr1, chr2, chr3;
    var enc1, enc2, enc3, enc4;
    var i = 0;
    input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");

    do {
      enc1 = keyStr.indexOf(input.charAt(i++));
      enc2 = keyStr.indexOf(input.charAt(i++));
      enc3 = keyStr.indexOf(input.charAt(i++));
      enc4 = keyStr.indexOf(input.charAt(i++));
      chr1 = enc1 << 2 | enc2 >> 4;
      chr2 = (enc2 & 15) << 4 | enc3 >> 2;
      chr3 = (enc3 & 3) << 6 | enc4;
      output = output + String.fromCharCode(chr1);

      if (enc3 !== 64) {
        output = output + String.fromCharCode(chr2);
      }

      if (enc4 !== 64) {
        output = output + String.fromCharCode(chr3);
      }
    } while (i < input.length);

    return output;
  };

  function intArrayFromBase64(s) {
    try {
      var decoded = decodeBase64(s);
      var bytes = new Uint8Array(decoded.length);

      for (var i = 0; i < decoded.length; ++i) {
        bytes[i] = decoded.charCodeAt(i);
      }

      return bytes;
    } catch (_) {
      throw new Error("Converting base64 string to bytes failed.");
    }
  }

  function tryParseAsDataURI(filename) {
    if (!isDataURI(filename)) {
      return;
    }

    return intArrayFromBase64(filename.slice(dataURIPrefix.length));
  }

  var asmGlobalArg = {
    "Math": Math,
    "Int8Array": Int8Array,
    "Int32Array": Int32Array,
    "Uint8Array": Uint8Array,
    "Float32Array": Float32Array,
    "Float64Array": Float64Array
  };
  var asmLibraryArg = {
    "a": abort,
    "b": setTempRet0,
    "c": getTempRet0,
    "d": ___assert_fail,
    "e": ___setErrNo,
    "f": _emscripten_get_heap_size,
    "g": _emscripten_memcpy_big,
    "h": _emscripten_resize_heap,
    "i": abortOnCannotGrowMemory,
    "j": demangle,
    "k": demangleAll,
    "l": emscripten_realloc_buffer,
    "m": jsStackTrace,
    "n": stackTrace,
    "o": tempDoublePtr,
    "p": DYNAMICTOP_PTR
  }; // EMSCRIPTEN_START_ASM

  var asm =
  /** @suppress {uselessCode} */
  function (global, env, buffer) {
    "almost asm";

    var a = new global.Int8Array(buffer),
        b = new global.Int32Array(buffer),
        c = new global.Uint8Array(buffer),
        d = new global.Float32Array(buffer),
        e = new global.Float64Array(buffer),
        g = env.p | 0,
        p = global.Math.floor,
        q = global.Math.abs,
        r = global.Math.sqrt,
        s = global.Math.pow,
        t = global.Math.cos,
        u = global.Math.sin,
        v = global.Math.tan,
        w = global.Math.acos,
        x = global.Math.asin,
        y = global.Math.atan,
        z = global.Math.atan2,
        A = global.Math.ceil,
        B = global.Math.imul,
        C = global.Math.min,
        D = global.Math.clz32,
        F = env.b,
        G = env.c,
        H = env.d,
        I = env.e,
        J = env.f,
        K = env.g,
        L = env.h,
        M = env.i,
        S = 24048;

    function V(newBuffer) {
      a = new Int8Array(newBuffer);
      c = new Uint8Array(newBuffer);
      b = new Int32Array(newBuffer);
      d = new Float32Array(newBuffer);
      e = new Float64Array(newBuffer);
      buffer = newBuffer;
      return true;
    } // EMSCRIPTEN_START_FUNCS


    function W(a) {
      a = a | 0;
      var b = 0;
      b = S;
      S = S + a | 0;
      S = S + 15 & -16;
      return b | 0;
    }

    function X() {
      return S | 0;
    }

    function Y(a) {
      a = a | 0;
      S = a;
    }

    function Z(a, b) {
      a = a | 0;
      b = b | 0;
      S = a;
    }

    function _(a) {
      a = a | 0;
      return (B(a * 3 | 0, a + 1 | 0) | 0) + 1 | 0;
    }

    function $(a, b, c, d) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0;
      if (!(ba(a, b, c, d, 0) | 0)) { return; }
      f = (B(c * 3 | 0, c + 1 | 0) | 0) + 1 | 0;
      hd(d | 0, 0, f << 3 | 0) | 0;
      e = Yc(f, 4) | 0;
      if (!e) { return; }
      ca(a, b, c, d, e, f, 0);
      Xc(e);
      return;
    }

    function aa(a, b, c, d, e) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0;
      if (!(ba(a, b, c, d, e) | 0)) { return; }
      f = (B(c * 3 | 0, c + 1 | 0) | 0) + 1 | 0;
      hd(d | 0, 0, f << 3 | 0) | 0;

      if (e | 0) {
        hd(e | 0, 0, f << 2 | 0) | 0;
        ca(a, b, c, d, e, f, 0);
        return;
      }

      e = Yc(f, 4) | 0;
      if (!e) { return; }
      ca(a, b, c, d, e, f, 0);
      Xc(e);
      return;
    }

    function ba(a, c, d, e, f) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      f = f | 0;
      var g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0;
      o = S;
      S = S + 16 | 0;
      n = o;
      g = e;
      b[g >> 2] = a;
      b[g + 4 >> 2] = c;
      g = (f | 0) != 0;
      if (g) { b[f >> 2] = 0; }

      if (Fb(a, c) | 0) {
        n = 1;
        S = o;
        return n | 0;
      }

      b[n >> 2] = 0;

      a: do { if ((d | 0) >= 1) {
        if (g) {
          k = 0;
          l = 1;
          m = 1;
          h = 0;
          g = a;

          while (1) {
            if (!(h | k)) {
              g = da(g, c, 4, n) | 0;
              c = G() | 0;

              if ((g | 0) == 0 & (c | 0) == 0) {
                g = 2;
                break a;
              }

              if (Fb(g, c) | 0) {
                g = 1;
                break a;
              }
            }

            g = da(g, c, b[16 + (k << 2) >> 2] | 0, n) | 0;
            c = G() | 0;

            if ((g | 0) == 0 & (c | 0) == 0) {
              g = 2;
              break a;
            }

            a = e + (m << 3) | 0;
            b[a >> 2] = g;
            b[a + 4 >> 2] = c;
            b[f + (m << 2) >> 2] = l;
            h = h + 1 | 0;
            a = (h | 0) == (l | 0);
            i = k + 1 | 0;
            j = (i | 0) == 6;

            if (Fb(g, c) | 0) {
              g = 1;
              break a;
            }

            l = l + (j & a & 1) | 0;

            if ((l | 0) > (d | 0)) {
              g = 0;
              break;
            } else {
              k = a ? j ? 0 : i : k;
              m = m + 1 | 0;
              h = a ? 0 : h;
            }
          }
        } else {
          k = 0;
          l = 1;
          m = 1;
          h = 0;
          g = a;

          while (1) {
            if (!(h | k)) {
              g = da(g, c, 4, n) | 0;
              c = G() | 0;

              if ((g | 0) == 0 & (c | 0) == 0) {
                g = 2;
                break a;
              }

              if (Fb(g, c) | 0) {
                g = 1;
                break a;
              }
            }

            g = da(g, c, b[16 + (k << 2) >> 2] | 0, n) | 0;
            c = G() | 0;

            if ((g | 0) == 0 & (c | 0) == 0) {
              g = 2;
              break a;
            }

            a = e + (m << 3) | 0;
            b[a >> 2] = g;
            b[a + 4 >> 2] = c;
            h = h + 1 | 0;
            a = (h | 0) == (l | 0);
            i = k + 1 | 0;
            j = (i | 0) == 6;

            if (Fb(g, c) | 0) {
              g = 1;
              break a;
            }

            l = l + (j & a & 1) | 0;

            if ((l | 0) > (d | 0)) {
              g = 0;
              break;
            } else {
              k = a ? j ? 0 : i : k;
              m = m + 1 | 0;
              h = a ? 0 : h;
            }
          }
        }
      } else { g = 0; } } while (0);

      n = g;
      S = o;
      return n | 0;
    }

    function ca(a, c, d, e, f, g, h) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      f = f | 0;
      g = g | 0;
      h = h | 0;
      var i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0;
      m = S;
      S = S + 16 | 0;
      l = m;

      if ((a | 0) == 0 & (c | 0) == 0) {
        S = m;
        return;
      }

      i = bd(a | 0, c | 0, g | 0, ((g | 0) < 0) << 31 >> 31 | 0) | 0;
      G() | 0;
      j = e + (i << 3) | 0;
      n = j;
      o = b[n >> 2] | 0;
      n = b[n + 4 >> 2] | 0;
      k = (o | 0) == (a | 0) & (n | 0) == (c | 0);
      if (!((o | 0) == 0 & (n | 0) == 0 | k)) { do {
        i = (i + 1 | 0) % (g | 0) | 0;
        j = e + (i << 3) | 0;
        o = j;
        n = b[o >> 2] | 0;
        o = b[o + 4 >> 2] | 0;
        k = (n | 0) == (a | 0) & (o | 0) == (c | 0);
      } while (!((n | 0) == 0 & (o | 0) == 0 | k)); }
      i = f + (i << 2) | 0;

      if (k ? (b[i >> 2] | 0) <= (h | 0) : 0) {
        S = m;
        return;
      }

      o = j;
      b[o >> 2] = a;
      b[o + 4 >> 2] = c;
      b[i >> 2] = h;

      if ((h | 0) >= (d | 0)) {
        S = m;
        return;
      }

      o = h + 1 | 0;
      b[l >> 2] = 0;
      n = da(a, c, 2, l) | 0;
      ca(n, G() | 0, d, e, f, g, o);
      b[l >> 2] = 0;
      n = da(a, c, 3, l) | 0;
      ca(n, G() | 0, d, e, f, g, o);
      b[l >> 2] = 0;
      n = da(a, c, 1, l) | 0;
      ca(n, G() | 0, d, e, f, g, o);
      b[l >> 2] = 0;
      n = da(a, c, 5, l) | 0;
      ca(n, G() | 0, d, e, f, g, o);
      b[l >> 2] = 0;
      n = da(a, c, 4, l) | 0;
      ca(n, G() | 0, d, e, f, g, o);
      b[l >> 2] = 0;
      n = da(a, c, 6, l) | 0;
      ca(n, G() | 0, d, e, f, g, o);
      S = m;
      return;
    }

    function da(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0;

      if ((b[e >> 2] | 0) > 0) {
        f = 0;

        do {
          d = Pa(d) | 0;
          f = f + 1 | 0;
        } while ((f | 0) < (b[e >> 2] | 0));
      }

      i = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      j = i & 127;
      g = Lb(a, c) | 0;
      f = cd(a | 0, c | 0, 52) | 0;
      G() | 0;
      f = f & 15;

      a: do { if (!f) { h = 6; }else { while (1) {
        m = (15 - f | 0) * 3 | 0;
        n = cd(a | 0, c | 0, m | 0) | 0;
        G() | 0;
        n = n & 7;
        o = (Rb(f) | 0) == 0;
        f = f + -1 | 0;
        l = dd(7, 0, m | 0) | 0;
        c = c & ~(G() | 0);
        m = dd(b[(o ? 464 : 48) + (n * 28 | 0) + (d << 2) >> 2] | 0, 0, m | 0) | 0;
        k = G() | 0;
        d = b[(o ? 672 : 256) + (n * 28 | 0) + (d << 2) >> 2] | 0;
        a = m | a & ~l;
        c = k | c;

        if (!d) {
          d = 0;
          break a;
        }

        if (!f) {
          h = 6;
          break;
        }
      } } } while (0);

      if ((h | 0) == 6) {
        o = b[880 + (j * 28 | 0) + (d << 2) >> 2] | 0;
        n = dd(o | 0, 0, 45) | 0;
        a = n | a;
        c = G() | 0 | c & -1040385;
        d = b[4304 + (j * 28 | 0) + (d << 2) >> 2] | 0;

        if ((o & 127 | 0) == 127) {
          o = dd(b[880 + (j * 28 | 0) + 20 >> 2] | 0, 0, 45) | 0;
          c = G() | 0 | c & -1040385;
          d = b[4304 + (j * 28 | 0) + 20 >> 2] | 0;
          a = Nb(o | a, c) | 0;
          c = G() | 0;
          b[e >> 2] = (b[e >> 2] | 0) + 1;
        }
      }

      h = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      h = h & 127;

      b: do { if (!(la(h) | 0)) {
        if ((d | 0) > 0) {
          f = 0;

          do {
            a = Nb(a, c) | 0;
            c = G() | 0;
            f = f + 1 | 0;
          } while ((f | 0) != (d | 0));
        }
      } else {
        c: do { if ((Lb(a, c) | 0) == 1) {
          if ((j | 0) != (h | 0)) { if (ra(h, b[7728 + (j * 28 | 0) >> 2] | 0) | 0) {
            a = Pb(a, c) | 0;
            g = 1;
            c = G() | 0;
            break;
          } else {
            a = Nb(a, c) | 0;
            g = 1;
            c = G() | 0;
            break;
          } }

          switch (g | 0) {
            case 5:
              {
                a = Pb(a, c) | 0;
                c = G() | 0;
                b[e >> 2] = (b[e >> 2] | 0) + 5;
                g = 0;
                break c;
              }

            case 3:
              {
                a = Nb(a, c) | 0;
                c = G() | 0;
                b[e >> 2] = (b[e >> 2] | 0) + 1;
                g = 0;
                break c;
              }

            default:
              {
                n = 0;
                o = 0;
                F(n | 0);
                return o | 0;
              }
          }
        } else { g = 0; } } while (0);

        if ((d | 0) > 0) {
          f = 0;

          do {
            a = Mb(a, c) | 0;
            c = G() | 0;
            f = f + 1 | 0;
          } while ((f | 0) != (d | 0));
        }

        if ((j | 0) != (h | 0)) {
          if (!(ma(h) | 0)) {
            if ((g | 0) != 0 | (Lb(a, c) | 0) != 5) { break; }
            b[e >> 2] = (b[e >> 2] | 0) + 1;
            break;
          }

          switch (i & 127) {
            case 8:
            case 118:
              break b;

            default:

          }

          if ((Lb(a, c) | 0) != 3) { b[e >> 2] = (b[e >> 2] | 0) + 1; }
        }
      } } while (0);

      b[e >> 2] = ((b[e >> 2] | 0) + d | 0) % 6 | 0;
      n = c;
      o = a;
      F(n | 0);
      return o | 0;
    }

    function ea(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0;
      m = S;
      S = S + 16 | 0;
      l = m;

      if (!d) {
        l = e;
        b[l >> 2] = a;
        b[l + 4 >> 2] = c;
        l = 0;
        S = m;
        return l | 0;
      }

      b[l >> 2] = 0;

      a: do { if (!(Fb(a, c) | 0)) {
        g = (d | 0) > 0;

        if (g) {
          f = 0;
          k = a;

          do {
            k = da(k, c, 4, l) | 0;
            c = G() | 0;

            if ((k | 0) == 0 & (c | 0) == 0) {
              a = 2;
              break a;
            }

            f = f + 1 | 0;

            if (Fb(k, c) | 0) {
              a = 1;
              break a;
            }
          } while ((f | 0) < (d | 0));

          j = e;
          b[j >> 2] = k;
          b[j + 4 >> 2] = c;
          j = d + -1 | 0;

          if (g) {
            g = 0;
            h = 1;
            f = k;
            a = c;

            do {
              f = da(f, a, 2, l) | 0;
              a = G() | 0;

              if ((f | 0) == 0 & (a | 0) == 0) {
                a = 2;
                break a;
              }

              i = e + (h << 3) | 0;
              b[i >> 2] = f;
              b[i + 4 >> 2] = a;
              h = h + 1 | 0;

              if (Fb(f, a) | 0) {
                a = 1;
                break a;
              }

              g = g + 1 | 0;
            } while ((g | 0) < (d | 0));

            i = 0;
            g = h;

            do {
              f = da(f, a, 3, l) | 0;
              a = G() | 0;

              if ((f | 0) == 0 & (a | 0) == 0) {
                a = 2;
                break a;
              }

              h = e + (g << 3) | 0;
              b[h >> 2] = f;
              b[h + 4 >> 2] = a;
              g = g + 1 | 0;

              if (Fb(f, a) | 0) {
                a = 1;
                break a;
              }

              i = i + 1 | 0;
            } while ((i | 0) < (d | 0));

            h = 0;

            do {
              f = da(f, a, 1, l) | 0;
              a = G() | 0;

              if ((f | 0) == 0 & (a | 0) == 0) {
                a = 2;
                break a;
              }

              i = e + (g << 3) | 0;
              b[i >> 2] = f;
              b[i + 4 >> 2] = a;
              g = g + 1 | 0;

              if (Fb(f, a) | 0) {
                a = 1;
                break a;
              }

              h = h + 1 | 0;
            } while ((h | 0) < (d | 0));

            h = 0;

            do {
              f = da(f, a, 5, l) | 0;
              a = G() | 0;

              if ((f | 0) == 0 & (a | 0) == 0) {
                a = 2;
                break a;
              }

              i = e + (g << 3) | 0;
              b[i >> 2] = f;
              b[i + 4 >> 2] = a;
              g = g + 1 | 0;

              if (Fb(f, a) | 0) {
                a = 1;
                break a;
              }

              h = h + 1 | 0;
            } while ((h | 0) < (d | 0));

            h = 0;

            do {
              f = da(f, a, 4, l) | 0;
              a = G() | 0;

              if ((f | 0) == 0 & (a | 0) == 0) {
                a = 2;
                break a;
              }

              i = e + (g << 3) | 0;
              b[i >> 2] = f;
              b[i + 4 >> 2] = a;
              g = g + 1 | 0;

              if (Fb(f, a) | 0) {
                a = 1;
                break a;
              }

              h = h + 1 | 0;
            } while ((h | 0) < (d | 0));

            h = 0;

            while (1) {
              f = da(f, a, 6, l) | 0;
              a = G() | 0;

              if ((f | 0) == 0 & (a | 0) == 0) {
                a = 2;
                break a;
              }

              if ((h | 0) != (j | 0)) {
                i = e + (g << 3) | 0;
                b[i >> 2] = f;
                b[i + 4 >> 2] = a;
                if (!(Fb(f, a) | 0)) { g = g + 1 | 0; }else {
                  a = 1;
                  break a;
                }
              }

              h = h + 1 | 0;

              if ((h | 0) >= (d | 0)) {
                h = k;
                g = c;
                break;
              }
            }
          } else {
            h = k;
            f = k;
            g = c;
            a = c;
          }
        } else {
          h = e;
          b[h >> 2] = a;
          b[h + 4 >> 2] = c;
          h = a;
          f = a;
          g = c;
          a = c;
        }

        a = ((h | 0) != (f | 0) | (g | 0) != (a | 0)) & 1;
      } else { a = 1; } } while (0);

      l = a;
      S = m;
      return l | 0;
    }

    function fa(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      g = S;
      S = S + 48 | 0;
      f = g + 8 | 0;
      e = g;
      i = a;
      h = b[i + 4 >> 2] | 0;
      d = e;
      b[d >> 2] = b[i >> 2];
      b[d + 4 >> 2] = h;
      vc(e, f);
      f = ya(f, c) | 0;
      c = b[e >> 2] | 0;
      e = b[a + 8 >> 2] | 0;

      if ((e | 0) <= 0) {
        i = c;
        h = (f | 0) < (i | 0);
        i = h ? i : f;
        i = i + 12 | 0;
        S = g;
        return i | 0;
      }

      d = b[a + 12 >> 2] | 0;
      a = 0;

      do {
        c = (b[d + (a << 3) >> 2] | 0) + c | 0;
        a = a + 1 | 0;
      } while ((a | 0) < (e | 0));

      i = (f | 0) < (c | 0);
      i = i ? c : f;
      i = i + 12 | 0;
      S = g;
      return i | 0;
    }

    function ga(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0;
      i = S;
      S = S + 48 | 0;
      e = i + 8 | 0;
      f = i;

      if (!(ha(a, c, d) | 0)) {
        S = i;
        return;
      }

      j = a;
      g = b[j + 4 >> 2] | 0;
      h = f;
      b[h >> 2] = b[j >> 2];
      b[h + 4 >> 2] = g;
      vc(f, e);
      h = ya(e, c) | 0;
      c = b[f >> 2] | 0;
      g = b[a + 8 >> 2] | 0;

      if ((g | 0) > 0) {
        f = b[a + 12 >> 2] | 0;
        e = 0;

        do {
          c = (b[f + (e << 3) >> 2] | 0) + c | 0;
          e = e + 1 | 0;
        } while ((e | 0) != (g | 0));
      }

      c = (h | 0) < (c | 0) ? c : h;

      if ((c | 0) <= -12) {
        S = i;
        return;
      }

      j = c + 11 | 0;
      hd(d | 0, 0, (((j | 0) > 0 ? j : 0) << 3) + 8 | 0) | 0;
      S = i;
      return;
    }

    function ha(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0,
          z = 0,
          A = 0,
          B = 0,
          C = 0,
          D = 0,
          E = 0,
          F = 0,
          I = 0,
          J = 0;
      J = S;
      S = S + 112 | 0;
      D = J + 80 | 0;
      j = J + 72 | 0;
      E = J;
      F = J + 56 | 0;
      k = a + 8 | 0;
      I = Wc((b[k >> 2] << 5) + 32 | 0) | 0;
      if (!I) { H(22848, 22448, 800, 22456); }
      wc(a, I);
      g = a;
      e = b[g + 4 >> 2] | 0;
      i = j;
      b[i >> 2] = b[g >> 2];
      b[i + 4 >> 2] = e;
      vc(j, D);
      i = ya(D, c) | 0;
      e = b[j >> 2] | 0;
      g = b[k >> 2] | 0;

      if ((g | 0) > 0) {
        h = b[a + 12 >> 2] | 0;
        f = 0;

        do {
          e = (b[h + (f << 3) >> 2] | 0) + e | 0;
          f = f + 1 | 0;
        } while ((f | 0) != (g | 0));
      }

      i = (i | 0) < (e | 0) ? e : i;
      C = i + 12 | 0;
      f = Yc(C, 8) | 0;
      l = Yc(C, 8) | 0;
      b[D >> 2] = 0;
      A = a;
      B = b[A + 4 >> 2] | 0;
      e = j;
      b[e >> 2] = b[A >> 2];
      b[e + 4 >> 2] = B;
      e = ia(j, C, c, D, f, l) | 0;

      if (e | 0) {
        Xc(f);
        Xc(l);
        Xc(I);
        I = e;
        S = J;
        return I | 0;
      }

      a: do { if ((b[k >> 2] | 0) > 0) {
        g = a + 12 | 0;
        e = 0;

        while (1) {
          h = ia((b[g >> 2] | 0) + (e << 3) | 0, C, c, D, f, l) | 0;
          e = e + 1 | 0;
          if (h | 0) { break; }
          if ((e | 0) >= (b[k >> 2] | 0)) { break a; }
        }

        Xc(f);
        Xc(l);
        Xc(I);
        I = h;
        S = J;
        return I | 0;
      } } while (0);

      if ((i | 0) > -12) { hd(l | 0, 0, ((C | 0) > 1 ? C : 1) << 3 | 0) | 0; }

      b: do { if ((b[D >> 2] | 0) > 0) {
        B = ((C | 0) < 0) << 31 >> 31;
        v = f;
        w = l;
        x = f;
        y = f;
        z = l;
        A = f;
        e = f;
        r = f;
        s = l;
        t = l;
        u = l;
        f = l;

        c: while (1) {
          q = b[D >> 2] | 0;
          o = 0;
          p = 0;
          g = 0;

          while (1) {
            h = E;
            i = h + 56 | 0;

            do {
              b[h >> 2] = 0;
              h = h + 4 | 0;
            } while ((h | 0) < (i | 0));

            c = v + (o << 3) | 0;
            j = b[c >> 2] | 0;
            c = b[c + 4 >> 2] | 0;

            if (ba(j, c, 1, E, 0) | 0) {
              h = E;
              i = h + 56 | 0;

              do {
                b[h >> 2] = 0;
                h = h + 4 | 0;
              } while ((h | 0) < (i | 0));

              h = Yc(7, 4) | 0;

              if (h | 0) {
                ca(j, c, 1, E, h, 7, 0);
                Xc(h);
              }
            }

            n = 0;

            do {
              m = E + (n << 3) | 0;
              l = b[m >> 2] | 0;
              m = b[m + 4 >> 2] | 0;

              d: do { if (!((l | 0) == 0 & (m | 0) == 0)) {
                j = bd(l | 0, m | 0, C | 0, B | 0) | 0;
                G() | 0;
                h = d + (j << 3) | 0;
                i = h;
                c = b[i >> 2] | 0;
                i = b[i + 4 >> 2] | 0;

                if (!((c | 0) == 0 & (i | 0) == 0)) {
                  k = 0;

                  while (1) {
                    if ((k | 0) > (C | 0)) { break c; }
                    if ((c | 0) == (l | 0) & (i | 0) == (m | 0)) { break d; }
                    j = (j + 1 | 0) % (C | 0) | 0;
                    h = d + (j << 3) | 0;
                    i = h;
                    c = b[i >> 2] | 0;
                    i = b[i + 4 >> 2] | 0;
                    if ((c | 0) == 0 & (i | 0) == 0) { break; }else { k = k + 1 | 0; }
                  }
                }

                if (!((l | 0) == 0 & (m | 0) == 0)) {
                  Vb(l, m, F);

                  if (xc(a, I, F) | 0) {
                    k = h;
                    b[k >> 2] = l;
                    b[k + 4 >> 2] = m;
                    k = w + (g << 3) | 0;
                    b[k >> 2] = l;
                    b[k + 4 >> 2] = m;
                    g = g + 1 | 0;
                  }
                }
              } } while (0);

              n = n + 1 | 0;
            } while (n >>> 0 < 7);

            p = p + 1 | 0;
            if ((p | 0) >= (q | 0)) { break; }else { o = o + 1 | 0; }
          }

          if ((q | 0) > 0) { hd(x | 0, 0, q << 3 | 0) | 0; }
          b[D >> 2] = g;

          if ((g | 0) > 0) {
            l = f;
            m = u;
            n = A;
            o = t;
            p = s;
            q = w;
            f = r;
            u = e;
            t = y;
            s = x;
            r = l;
            e = m;
            A = z;
            z = n;
            y = o;
            x = p;
            w = v;
            v = q;
          } else { break b; }
        }

        Xc(y);
        Xc(z);
        Xc(I);
        I = -1;
        S = J;
        return I | 0;
      } else { e = l; } } while (0);

      Xc(I);
      Xc(f);
      Xc(e);
      I = 0;
      S = J;
      return I | 0;
    }

    function ia(a, c, d, f, g, h) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      f = f | 0;
      g = g | 0;
      h = h | 0;
      var i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0.0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0,
          z = 0,
          A = 0,
          B = 0,
          C = 0,
          D = 0.0,
          E = 0.0;
      C = S;
      S = S + 48 | 0;
      y = C + 32 | 0;
      z = C + 16 | 0;
      A = C;
      i = b[a >> 2] | 0;

      if ((i | 0) <= 0) {
        B = 0;
        S = C;
        return B | 0;
      }

      t = a + 4 | 0;
      u = y + 8 | 0;
      v = z + 8 | 0;
      w = A + 8 | 0;
      x = ((c | 0) < 0) << 31 >> 31;
      s = 0;

      a: while (1) {
        j = b[t >> 2] | 0;
        q = j + (s << 4) | 0;
        b[y >> 2] = b[q >> 2];
        b[y + 4 >> 2] = b[q + 4 >> 2];
        b[y + 8 >> 2] = b[q + 8 >> 2];
        b[y + 12 >> 2] = b[q + 12 >> 2];

        if ((s | 0) == (i + -1 | 0)) {
          b[z >> 2] = b[j >> 2];
          b[z + 4 >> 2] = b[j + 4 >> 2];
          b[z + 8 >> 2] = b[j + 8 >> 2];
          b[z + 12 >> 2] = b[j + 12 >> 2];
        } else {
          q = j + (s + 1 << 4) | 0;
          b[z >> 2] = b[q >> 2];
          b[z + 4 >> 2] = b[q + 4 >> 2];
          b[z + 8 >> 2] = b[q + 8 >> 2];
          b[z + 12 >> 2] = b[q + 12 >> 2];
        }

        q = za(y, z, d) | 0;

        b: do { if ((q | 0) > 0) {
          r = +(q | 0);
          p = 0;

          c: while (1) {
            E = +(q - p | 0);
            D = +(p | 0);
            e[A >> 3] = +e[y >> 3] * E / r + +e[z >> 3] * D / r;
            e[w >> 3] = +e[u >> 3] * E / r + +e[v >> 3] * D / r;
            n = Sb(A, d) | 0;
            o = G() | 0;
            j = bd(n | 0, o | 0, c | 0, x | 0) | 0;
            G() | 0;
            i = h + (j << 3) | 0;
            k = i;
            l = b[k >> 2] | 0;
            k = b[k + 4 >> 2] | 0;

            d: do { if ((l | 0) == 0 & (k | 0) == 0) { B = 14; }else {
              m = 0;

              while (1) {
                if ((m | 0) > (c | 0)) {
                  i = 1;
                  break d;
                }

                if ((l | 0) == (n | 0) & (k | 0) == (o | 0)) {
                  i = 7;
                  break d;
                }

                j = (j + 1 | 0) % (c | 0) | 0;
                i = h + (j << 3) | 0;
                k = i;
                l = b[k >> 2] | 0;
                k = b[k + 4 >> 2] | 0;

                if ((l | 0) == 0 & (k | 0) == 0) {
                  B = 14;
                  break;
                } else { m = m + 1 | 0; }
              }
            } } while (0);

            if ((B | 0) == 14) {
              B = 0;
              if ((n | 0) == 0 & (o | 0) == 0) { i = 7; }else {
                b[i >> 2] = n;
                b[i + 4 >> 2] = o;
                i = b[f >> 2] | 0;
                m = g + (i << 3) | 0;
                b[m >> 2] = n;
                b[m + 4 >> 2] = o;
                b[f >> 2] = i + 1;
                i = 0;
              }
            }

            switch (i & 7) {
              case 7:
              case 0:
                break;

              default:
                break c;
            }

            p = p + 1 | 0;

            if ((q | 0) <= (p | 0)) {
              B = 8;
              break b;
            }
          }

          if (i | 0) {
            i = -1;
            B = 20;
            break a;
          }
        } else { B = 8; } } while (0);

        if ((B | 0) == 8) { B = 0; }
        s = s + 1 | 0;
        i = b[a >> 2] | 0;

        if ((s | 0) >= (i | 0)) {
          i = 0;
          B = 20;
          break;
        }
      }

      if ((B | 0) == 20) {
        S = C;
        return i | 0;
      }

      return 0;
    }

    function ja(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0;
      k = S;
      S = S + 176 | 0;
      j = k;

      if ((c | 0) < 1) {
        Mc(d, 0, 0);
        S = k;
        return;
      }

      h = a;
      h = cd(b[h >> 2] | 0, b[h + 4 >> 2] | 0, 52) | 0;
      G() | 0;
      Mc(d, (c | 0) > 6 ? c : 6, h & 15);
      h = 0;

      do {
        e = a + (h << 3) | 0;
        Wb(b[e >> 2] | 0, b[e + 4 >> 2] | 0, j);
        e = b[j >> 2] | 0;

        if ((e | 0) > 0) {
          i = 0;

          do {
            g = j + 8 + (i << 4) | 0;
            i = i + 1 | 0;
            e = j + 8 + (((i | 0) % (e | 0) | 0) << 4) | 0;
            f = Rc(d, e, g) | 0;
            if (!f) { Qc(d, g, e) | 0; }else { Pc(d, f) | 0; }
            e = b[j >> 2] | 0;
          } while ((i | 0) < (e | 0));
        }

        h = h + 1 | 0;
      } while ((h | 0) != (c | 0));

      S = k;
      return;
    }

    function ka(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0;
      g = S;
      S = S + 32 | 0;
      e = g;
      f = g + 16 | 0;
      ja(a, c, f);
      b[d >> 2] = 0;
      b[d + 4 >> 2] = 0;
      b[d + 8 >> 2] = 0;
      a = Oc(f) | 0;

      if (!a) {
        kc(d) | 0;
        Nc(f);
        S = g;
        return;
      }

      do {
        c = hc(d) | 0;

        do {
          ic(c, a) | 0;
          h = a + 16 | 0;
          b[e >> 2] = b[h >> 2];
          b[e + 4 >> 2] = b[h + 4 >> 2];
          b[e + 8 >> 2] = b[h + 8 >> 2];
          b[e + 12 >> 2] = b[h + 12 >> 2];
          Pc(f, a) | 0;
          a = Sc(f, e) | 0;
        } while ((a | 0) != 0);

        a = Oc(f) | 0;
      } while ((a | 0) != 0);

      kc(d) | 0;
      Nc(f);
      S = g;
      return;
    }

    function la(a) {
      a = a | 0;
      return b[7728 + (a * 28 | 0) + 16 >> 2] | 0;
    }

    function ma(a) {
      a = a | 0;
      return (a | 0) == 4 | (a | 0) == 117 | 0;
    }

    function na(a) {
      a = a | 0;
      return b[11152 + ((b[a >> 2] | 0) * 216 | 0) + ((b[a + 4 >> 2] | 0) * 72 | 0) + ((b[a + 8 >> 2] | 0) * 24 | 0) + (b[a + 12 >> 2] << 3) >> 2] | 0;
    }

    function oa(a) {
      a = a | 0;
      return b[11152 + ((b[a >> 2] | 0) * 216 | 0) + ((b[a + 4 >> 2] | 0) * 72 | 0) + ((b[a + 8 >> 2] | 0) * 24 | 0) + (b[a + 12 >> 2] << 3) + 4 >> 2] | 0;
    }

    function pa(a, c) {
      a = a | 0;
      c = c | 0;
      a = 7728 + (a * 28 | 0) | 0;
      b[c >> 2] = b[a >> 2];
      b[c + 4 >> 2] = b[a + 4 >> 2];
      b[c + 8 >> 2] = b[a + 8 >> 2];
      b[c + 12 >> 2] = b[a + 12 >> 2];
      return;
    }

    function qa(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0;

      if (c >>> 0 > 20) {
        c = -1;
        return c | 0;
      }

      do { if ((b[11152 + (c * 216 | 0) >> 2] | 0) != (a | 0)) {
        if ((b[11152 + (c * 216 | 0) + 8 >> 2] | 0) != (a | 0)) {
          if ((b[11152 + (c * 216 | 0) + 16 >> 2] | 0) != (a | 0)) {
            if ((b[11152 + (c * 216 | 0) + 24 >> 2] | 0) != (a | 0)) {
              if ((b[11152 + (c * 216 | 0) + 32 >> 2] | 0) != (a | 0)) {
                if ((b[11152 + (c * 216 | 0) + 40 >> 2] | 0) != (a | 0)) {
                  if ((b[11152 + (c * 216 | 0) + 48 >> 2] | 0) != (a | 0)) {
                    if ((b[11152 + (c * 216 | 0) + 56 >> 2] | 0) != (a | 0)) {
                      if ((b[11152 + (c * 216 | 0) + 64 >> 2] | 0) != (a | 0)) {
                        if ((b[11152 + (c * 216 | 0) + 72 >> 2] | 0) != (a | 0)) {
                          if ((b[11152 + (c * 216 | 0) + 80 >> 2] | 0) != (a | 0)) {
                            if ((b[11152 + (c * 216 | 0) + 88 >> 2] | 0) != (a | 0)) {
                              if ((b[11152 + (c * 216 | 0) + 96 >> 2] | 0) != (a | 0)) {
                                if ((b[11152 + (c * 216 | 0) + 104 >> 2] | 0) != (a | 0)) {
                                  if ((b[11152 + (c * 216 | 0) + 112 >> 2] | 0) != (a | 0)) {
                                    if ((b[11152 + (c * 216 | 0) + 120 >> 2] | 0) != (a | 0)) {
                                      if ((b[11152 + (c * 216 | 0) + 128 >> 2] | 0) != (a | 0)) {
                                        if ((b[11152 + (c * 216 | 0) + 136 >> 2] | 0) == (a | 0)) {
                                          a = 2;
                                          d = 1;
                                          e = 2;
                                        } else {
                                          if ((b[11152 + (c * 216 | 0) + 144 >> 2] | 0) == (a | 0)) {
                                            a = 0;
                                            d = 2;
                                            e = 0;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 152 >> 2] | 0) == (a | 0)) {
                                            a = 0;
                                            d = 2;
                                            e = 1;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 160 >> 2] | 0) == (a | 0)) {
                                            a = 0;
                                            d = 2;
                                            e = 2;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 168 >> 2] | 0) == (a | 0)) {
                                            a = 1;
                                            d = 2;
                                            e = 0;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 176 >> 2] | 0) == (a | 0)) {
                                            a = 1;
                                            d = 2;
                                            e = 1;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 184 >> 2] | 0) == (a | 0)) {
                                            a = 1;
                                            d = 2;
                                            e = 2;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 192 >> 2] | 0) == (a | 0)) {
                                            a = 2;
                                            d = 2;
                                            e = 0;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 200 >> 2] | 0) == (a | 0)) {
                                            a = 2;
                                            d = 2;
                                            e = 1;
                                            break;
                                          }

                                          if ((b[11152 + (c * 216 | 0) + 208 >> 2] | 0) == (a | 0)) {
                                            a = 2;
                                            d = 2;
                                            e = 2;
                                            break;
                                          } else { a = -1; }

                                          return a | 0;
                                        }
                                      } else {
                                        a = 2;
                                        d = 1;
                                        e = 1;
                                      }
                                    } else {
                                      a = 2;
                                      d = 1;
                                      e = 0;
                                    }
                                  } else {
                                    a = 1;
                                    d = 1;
                                    e = 2;
                                  }
                                } else {
                                  a = 1;
                                  d = 1;
                                  e = 1;
                                }
                              } else {
                                a = 1;
                                d = 1;
                                e = 0;
                              }
                            } else {
                              a = 0;
                              d = 1;
                              e = 2;
                            }
                          } else {
                            a = 0;
                            d = 1;
                            e = 1;
                          }
                        } else {
                          a = 0;
                          d = 1;
                          e = 0;
                        }
                      } else {
                        a = 2;
                        d = 0;
                        e = 2;
                      }
                    } else {
                      a = 2;
                      d = 0;
                      e = 1;
                    }
                  } else {
                    a = 2;
                    d = 0;
                    e = 0;
                  }
                } else {
                  a = 1;
                  d = 0;
                  e = 2;
                }
              } else {
                a = 1;
                d = 0;
                e = 1;
              }
            } else {
              a = 1;
              d = 0;
              e = 0;
            }
          } else {
            a = 0;
            d = 0;
            e = 2;
          }
        } else {
          a = 0;
          d = 0;
          e = 1;
        }
      } else {
        a = 0;
        d = 0;
        e = 0;
      } } while (0);

      c = b[11152 + (c * 216 | 0) + (d * 72 | 0) + (a * 24 | 0) + (e << 3) + 4 >> 2] | 0;
      return c | 0;
    }

    function ra(a, c) {
      a = a | 0;
      c = c | 0;

      if ((b[7728 + (a * 28 | 0) + 20 >> 2] | 0) == (c | 0)) {
        c = 1;
        return c | 0;
      }

      c = (b[7728 + (a * 28 | 0) + 24 >> 2] | 0) == (c | 0);
      return c | 0;
    }

    function sa(a, c) {
      a = a | 0;
      c = c | 0;
      return b[880 + (a * 28 | 0) + (c << 2) >> 2] | 0;
    }

    function ta(a, c) {
      a = a | 0;
      c = c | 0;

      if ((b[880 + (a * 28 | 0) >> 2] | 0) == (c | 0)) {
        c = 0;
        return c | 0;
      }

      if ((b[880 + (a * 28 | 0) + 4 >> 2] | 0) == (c | 0)) {
        c = 1;
        return c | 0;
      }

      if ((b[880 + (a * 28 | 0) + 8 >> 2] | 0) == (c | 0)) {
        c = 2;
        return c | 0;
      }

      if ((b[880 + (a * 28 | 0) + 12 >> 2] | 0) == (c | 0)) {
        c = 3;
        return c | 0;
      }

      if ((b[880 + (a * 28 | 0) + 16 >> 2] | 0) == (c | 0)) {
        c = 4;
        return c | 0;
      }

      if ((b[880 + (a * 28 | 0) + 20 >> 2] | 0) == (c | 0)) {
        c = 5;
        return c | 0;
      } else { return ((b[880 + (a * 28 | 0) + 24 >> 2] | 0) == (c | 0) ? 6 : 7) | 0; }

      return 0;
    }

    function ua() {
      return 122;
    }

    function va(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0;
      c = 0;

      do {
        dd(c | 0, 0, 45) | 0;
        e = G() | 0 | 134225919;
        d = a + (c << 3) | 0;
        b[d >> 2] = -1;
        b[d + 4 >> 2] = e;
        c = c + 1 | 0;
      } while ((c | 0) != 122);

      return;
    }

    function wa(a) {
      a = a | 0;
      return +e[a + 16 >> 3] < +e[a + 24 >> 3] | 0;
    }

    function xa(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0;
      c = +e[b >> 3];

      if (!(c >= +e[a + 8 >> 3])) {
        b = 0;
        return b | 0;
      }

      if (!(c <= +e[a >> 3])) {
        b = 0;
        return b | 0;
      }

      d = +e[a + 16 >> 3];
      c = +e[a + 24 >> 3];
      f = +e[b + 8 >> 3];
      b = f >= c;
      a = f <= d & 1;

      if (d < c) {
        if (b) { a = 1; }
      } else if (!b) { a = 0; }

      b = (a | 0) != 0;
      return b | 0;
    }

    function ya(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0.0,
          l = 0.0;
      i = S;
      S = S + 288 | 0;
      d = i + 264 | 0;
      f = i + 96 | 0;
      g = i;
      h = g;
      j = h + 96 | 0;

      do {
        b[h >> 2] = 0;
        h = h + 4 | 0;
      } while ((h | 0) < (j | 0));

      _b(c, g);

      h = g;
      j = b[h >> 2] | 0;
      h = b[h + 4 >> 2] | 0;
      Vb(j, h, d);
      Wb(j, h, f);
      k = +jb(d, f + 8 | 0);
      e[d >> 3] = +e[a >> 3];
      h = d + 8 | 0;
      e[h >> 3] = +e[a + 16 >> 3];
      e[f >> 3] = +e[a + 8 >> 3];
      j = f + 8 | 0;
      e[j >> 3] = +e[a + 24 >> 3];
      l = +jb(d, f);
      j = ~~+A(+(l * l / +ed(+ +q(+((+e[h >> 3] - +e[j >> 3]) / (+e[d >> 3] - +e[f >> 3]))), 3.0) / (k * (k * 2.59807621135) * .8)));
      S = i;
      return ((j | 0) == 0 ? 1 : j) | 0;
    }

    function za(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0.0;
      i = S;
      S = S + 288 | 0;
      e = i + 264 | 0;
      f = i + 96 | 0;
      g = i;
      h = g;
      j = h + 96 | 0;

      do {
        b[h >> 2] = 0;
        h = h + 4 | 0;
      } while ((h | 0) < (j | 0));

      _b(d, g);

      j = g;
      h = b[j >> 2] | 0;
      j = b[j + 4 >> 2] | 0;
      Vb(h, j, e);
      Wb(h, j, f);
      k = +jb(e, f + 8 | 0);
      j = ~~+A(+(+jb(a, c) / (k * 2.0)));
      S = i;
      return ((j | 0) == 0 ? 1 : j) | 0;
    }

    function Aa(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      b[a >> 2] = c;
      b[a + 4 >> 2] = d;
      b[a + 8 >> 2] = e;
      return;
    }

    function Ba(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0.0,
          m = 0,
          n = 0,
          o = 0.0;
      n = c + 8 | 0;
      b[n >> 2] = 0;
      k = +e[a >> 3];
      i = +q(+k);
      l = +e[a + 8 >> 3];
      j = +q(+l) / .8660254037844386;
      i = i + j * .5;
      d = ~~i;
      a = ~~j;
      i = i - +(d | 0);
      j = j - +(a | 0);

      do { if (i < .5) {
        if (i < .3333333333333333) {
          b[c >> 2] = d;

          if (j < (i + 1.0) * .5) {
            b[c + 4 >> 2] = a;
            break;
          } else {
            a = a + 1 | 0;
            b[c + 4 >> 2] = a;
            break;
          }
        } else {
          o = 1.0 - i;
          a = (!(j < o) & 1) + a | 0;
          b[c + 4 >> 2] = a;

          if (o <= j & j < i * 2.0) {
            d = d + 1 | 0;
            b[c >> 2] = d;
            break;
          } else {
            b[c >> 2] = d;
            break;
          }
        }
      } else {
        if (!(i < .6666666666666666)) {
          d = d + 1 | 0;
          b[c >> 2] = d;

          if (j < i * .5) {
            b[c + 4 >> 2] = a;
            break;
          } else {
            a = a + 1 | 0;
            b[c + 4 >> 2] = a;
            break;
          }
        }

        if (j < 1.0 - i) {
          b[c + 4 >> 2] = a;

          if (i * 2.0 + -1.0 < j) {
            b[c >> 2] = d;
            break;
          }
        } else {
          a = a + 1 | 0;
          b[c + 4 >> 2] = a;
        }

        d = d + 1 | 0;
        b[c >> 2] = d;
      } } while (0);

      do { if (k < 0.0) { if (!(a & 1)) {
        m = (a | 0) / 2 | 0;
        m = _c(d | 0, ((d | 0) < 0) << 31 >> 31 | 0, m | 0, ((m | 0) < 0) << 31 >> 31 | 0) | 0;
        d = ~~(+(d | 0) - (+(m >>> 0) + 4294967296.0 * +(G() | 0)) * 2.0);
        b[c >> 2] = d;
        break;
      } else {
        m = (a + 1 | 0) / 2 | 0;
        m = _c(d | 0, ((d | 0) < 0) << 31 >> 31 | 0, m | 0, ((m | 0) < 0) << 31 >> 31 | 0) | 0;
        d = ~~(+(d | 0) - ((+(m >>> 0) + 4294967296.0 * +(G() | 0)) * 2.0 + 1.0));
        b[c >> 2] = d;
        break;
      } } } while (0);

      m = c + 4 | 0;

      if (l < 0.0) {
        d = d - ((a << 1 | 1 | 0) / 2 | 0) | 0;
        b[c >> 2] = d;
        a = 0 - a | 0;
        b[m >> 2] = a;
      }

      f = a - d | 0;

      if ((d | 0) < 0) {
        g = 0 - d | 0;
        b[m >> 2] = f;
        b[n >> 2] = g;
        b[c >> 2] = 0;
        a = f;
        d = 0;
      } else { g = 0; }

      if ((a | 0) < 0) {
        d = d - a | 0;
        b[c >> 2] = d;
        g = g - a | 0;
        b[n >> 2] = g;
        b[m >> 2] = 0;
        a = 0;
      }

      h = d - g | 0;
      f = a - g | 0;

      if ((g | 0) < 0) {
        b[c >> 2] = h;
        b[m >> 2] = f;
        b[n >> 2] = 0;
        a = f;
        d = h;
        g = 0;
      }

      f = (a | 0) < (d | 0) ? a : d;
      f = (g | 0) < (f | 0) ? g : f;
      if ((f | 0) <= 0) { return; }
      b[c >> 2] = d - f;
      b[m >> 2] = a - f;
      b[n >> 2] = g - f;
      return;
    }

    function Ca(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0;
      c = b[a >> 2] | 0;
      h = a + 4 | 0;
      d = b[h >> 2] | 0;

      if ((c | 0) < 0) {
        d = d - c | 0;
        b[h >> 2] = d;
        g = a + 8 | 0;
        b[g >> 2] = (b[g >> 2] | 0) - c;
        b[a >> 2] = 0;
        c = 0;
      }

      if ((d | 0) < 0) {
        c = c - d | 0;
        b[a >> 2] = c;
        g = a + 8 | 0;
        f = (b[g >> 2] | 0) - d | 0;
        b[g >> 2] = f;
        b[h >> 2] = 0;
        d = 0;
      } else {
        f = a + 8 | 0;
        g = f;
        f = b[f >> 2] | 0;
      }

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[a >> 2] = c;
        d = d - f | 0;
        b[h >> 2] = d;
        b[g >> 2] = 0;
        f = 0;
      }

      e = (d | 0) < (c | 0) ? d : c;
      e = (f | 0) < (e | 0) ? f : e;
      if ((e | 0) <= 0) { return; }
      b[a >> 2] = c - e;
      b[h >> 2] = d - e;
      b[g >> 2] = f - e;
      return;
    }

    function Da(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          f = 0;
      f = b[a + 8 >> 2] | 0;
      d = +((b[a + 4 >> 2] | 0) - f | 0);
      e[c >> 3] = +((b[a >> 2] | 0) - f | 0) - d * .5;
      e[c + 8 >> 3] = d * .8660254037844386;
      return;
    }

    function Ea(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      b[d >> 2] = (b[c >> 2] | 0) + (b[a >> 2] | 0);
      b[d + 4 >> 2] = (b[c + 4 >> 2] | 0) + (b[a + 4 >> 2] | 0);
      b[d + 8 >> 2] = (b[c + 8 >> 2] | 0) + (b[a + 8 >> 2] | 0);
      return;
    }

    function Fa(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      b[d >> 2] = (b[a >> 2] | 0) - (b[c >> 2] | 0);
      b[d + 4 >> 2] = (b[a + 4 >> 2] | 0) - (b[c + 4 >> 2] | 0);
      b[d + 8 >> 2] = (b[a + 8 >> 2] | 0) - (b[c + 8 >> 2] | 0);
      return;
    }

    function Ga(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      d = B(b[a >> 2] | 0, c) | 0;
      b[a >> 2] = d;
      d = a + 4 | 0;
      e = B(b[d >> 2] | 0, c) | 0;
      b[d >> 2] = e;
      a = a + 8 | 0;
      c = B(b[a >> 2] | 0, c) | 0;
      b[a >> 2] = c;
      return;
    }

    function Ha(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = b[a >> 2] | 0;
      i = (h | 0) < 0;
      e = (b[a + 4 >> 2] | 0) - (i ? h : 0) | 0;
      g = (e | 0) < 0;
      f = (g ? 0 - e | 0 : 0) + ((b[a + 8 >> 2] | 0) - (i ? h : 0)) | 0;
      d = (f | 0) < 0;
      a = d ? 0 : f;
      c = (g ? 0 : e) - (d ? f : 0) | 0;
      f = (i ? 0 : h) - (g ? e : 0) - (d ? f : 0) | 0;
      d = (c | 0) < (f | 0) ? c : f;
      d = (a | 0) < (d | 0) ? a : d;
      e = (d | 0) > 0;
      a = a - (e ? d : 0) | 0;
      c = c - (e ? d : 0) | 0;

      a: do { switch (f - (e ? d : 0) | 0) {
        case 0:
          switch (c | 0) {
            case 0:
              {
                i = (a | 0) == 0 ? 0 : (a | 0) == 1 ? 1 : 7;
                return i | 0;
              }

            case 1:
              {
                i = (a | 0) == 0 ? 2 : (a | 0) == 1 ? 3 : 7;
                return i | 0;
              }

            default:
              break a;
          }

        case 1:
          switch (c | 0) {
            case 0:
              {
                i = (a | 0) == 0 ? 4 : (a | 0) == 1 ? 5 : 7;
                return i | 0;
              }

            case 1:
              {
                if (!a) { a = 6; }else { break a; }
                return a | 0;
              }

            default:
              break a;
          }

        default:

      } } while (0);

      i = 7;
      return i | 0;
    }

    function Ia(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = a + 8 | 0;
      d = b[h >> 2] | 0;
      c = (b[a >> 2] | 0) - d | 0;
      i = a + 4 | 0;
      d = (b[i >> 2] | 0) - d | 0;
      e = Vc(+((c * 3 | 0) - d | 0) / 7.0) | 0;
      b[a >> 2] = e;
      c = Vc(+((d << 1) + c | 0) / 7.0) | 0;
      b[i >> 2] = c;
      b[h >> 2] = 0;
      d = c - e | 0;

      if ((e | 0) < 0) {
        g = 0 - e | 0;
        b[i >> 2] = d;
        b[h >> 2] = g;
        b[a >> 2] = 0;
        c = d;
        e = 0;
        d = g;
      } else { d = 0; }

      if ((c | 0) < 0) {
        e = e - c | 0;
        b[a >> 2] = e;
        d = d - c | 0;
        b[h >> 2] = d;
        b[i >> 2] = 0;
        c = 0;
      }

      g = e - d | 0;
      f = c - d | 0;

      if ((d | 0) < 0) {
        b[a >> 2] = g;
        b[i >> 2] = f;
        b[h >> 2] = 0;
        c = f;
        f = g;
        d = 0;
      } else { f = e; }

      e = (c | 0) < (f | 0) ? c : f;
      e = (d | 0) < (e | 0) ? d : e;
      if ((e | 0) <= 0) { return; }
      b[a >> 2] = f - e;
      b[i >> 2] = c - e;
      b[h >> 2] = d - e;
      return;
    }

    function Ja(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = a + 8 | 0;
      d = b[h >> 2] | 0;
      c = (b[a >> 2] | 0) - d | 0;
      i = a + 4 | 0;
      d = (b[i >> 2] | 0) - d | 0;
      e = Vc(+((c << 1) + d | 0) / 7.0) | 0;
      b[a >> 2] = e;
      c = Vc(+((d * 3 | 0) - c | 0) / 7.0) | 0;
      b[i >> 2] = c;
      b[h >> 2] = 0;
      d = c - e | 0;

      if ((e | 0) < 0) {
        g = 0 - e | 0;
        b[i >> 2] = d;
        b[h >> 2] = g;
        b[a >> 2] = 0;
        c = d;
        e = 0;
        d = g;
      } else { d = 0; }

      if ((c | 0) < 0) {
        e = e - c | 0;
        b[a >> 2] = e;
        d = d - c | 0;
        b[h >> 2] = d;
        b[i >> 2] = 0;
        c = 0;
      }

      g = e - d | 0;
      f = c - d | 0;

      if ((d | 0) < 0) {
        b[a >> 2] = g;
        b[i >> 2] = f;
        b[h >> 2] = 0;
        c = f;
        f = g;
        d = 0;
      } else { f = e; }

      e = (c | 0) < (f | 0) ? c : f;
      e = (d | 0) < (e | 0) ? d : e;
      if ((e | 0) <= 0) { return; }
      b[a >> 2] = f - e;
      b[i >> 2] = c - e;
      b[h >> 2] = d - e;
      return;
    }

    function Ka(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      c = b[a >> 2] | 0;
      h = a + 4 | 0;
      d = b[h >> 2] | 0;
      i = a + 8 | 0;
      e = b[i >> 2] | 0;
      f = d + (c * 3 | 0) | 0;
      b[a >> 2] = f;
      d = e + (d * 3 | 0) | 0;
      b[h >> 2] = d;
      c = (e * 3 | 0) + c | 0;
      b[i >> 2] = c;
      e = d - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[h >> 2] = e;
        b[i >> 2] = c;
        b[a >> 2] = 0;
        d = e;
        e = 0;
      } else { e = f; }

      if ((d | 0) < 0) {
        e = e - d | 0;
        b[a >> 2] = e;
        c = c - d | 0;
        b[i >> 2] = c;
        b[h >> 2] = 0;
        d = 0;
      }

      g = e - c | 0;
      f = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[h >> 2] = f;
        b[i >> 2] = 0;
        e = g;
        c = 0;
      } else { f = d; }

      d = (f | 0) < (e | 0) ? f : e;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = e - d;
      b[h >> 2] = f - d;
      b[i >> 2] = c - d;
      return;
    }

    function La(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      f = b[a >> 2] | 0;
      h = a + 4 | 0;
      c = b[h >> 2] | 0;
      i = a + 8 | 0;
      d = b[i >> 2] | 0;
      e = (c * 3 | 0) + f | 0;
      f = d + (f * 3 | 0) | 0;
      b[a >> 2] = f;
      b[h >> 2] = e;
      c = (d * 3 | 0) + c | 0;
      b[i >> 2] = c;
      d = e - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[h >> 2] = d;
        b[i >> 2] = c;
        b[a >> 2] = 0;
        f = 0;
      } else { d = e; }

      if ((d | 0) < 0) {
        f = f - d | 0;
        b[a >> 2] = f;
        c = c - d | 0;
        b[i >> 2] = c;
        b[h >> 2] = 0;
        d = 0;
      }

      g = f - c | 0;
      e = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[h >> 2] = e;
        b[i >> 2] = 0;
        f = g;
        c = 0;
      } else { e = d; }

      d = (e | 0) < (f | 0) ? e : f;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = f - d;
      b[h >> 2] = e - d;
      b[i >> 2] = c - d;
      return;
    }

    function Ma(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      if ((c + -1 | 0) >>> 0 >= 6) { return; }
      f = (b[15472 + (c * 12 | 0) >> 2] | 0) + (b[a >> 2] | 0) | 0;
      b[a >> 2] = f;
      i = a + 4 | 0;
      e = (b[15472 + (c * 12 | 0) + 4 >> 2] | 0) + (b[i >> 2] | 0) | 0;
      b[i >> 2] = e;
      h = a + 8 | 0;
      c = (b[15472 + (c * 12 | 0) + 8 >> 2] | 0) + (b[h >> 2] | 0) | 0;
      b[h >> 2] = c;
      d = e - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[i >> 2] = d;
        b[h >> 2] = c;
        b[a >> 2] = 0;
        e = 0;
      } else {
        d = e;
        e = f;
      }

      if ((d | 0) < 0) {
        e = e - d | 0;
        b[a >> 2] = e;
        c = c - d | 0;
        b[h >> 2] = c;
        b[i >> 2] = 0;
        d = 0;
      }

      g = e - c | 0;
      f = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[i >> 2] = f;
        b[h >> 2] = 0;
        e = g;
        c = 0;
      } else { f = d; }

      d = (f | 0) < (e | 0) ? f : e;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = e - d;
      b[i >> 2] = f - d;
      b[h >> 2] = c - d;
      return;
    }

    function Na(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      f = b[a >> 2] | 0;
      h = a + 4 | 0;
      c = b[h >> 2] | 0;
      i = a + 8 | 0;
      d = b[i >> 2] | 0;
      e = c + f | 0;
      f = d + f | 0;
      b[a >> 2] = f;
      b[h >> 2] = e;
      c = d + c | 0;
      b[i >> 2] = c;
      d = e - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[h >> 2] = d;
        b[i >> 2] = c;
        b[a >> 2] = 0;
        e = 0;
      } else {
        d = e;
        e = f;
      }

      if ((d | 0) < 0) {
        e = e - d | 0;
        b[a >> 2] = e;
        c = c - d | 0;
        b[i >> 2] = c;
        b[h >> 2] = 0;
        d = 0;
      }

      g = e - c | 0;
      f = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[h >> 2] = f;
        b[i >> 2] = 0;
        e = g;
        c = 0;
      } else { f = d; }

      d = (f | 0) < (e | 0) ? f : e;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = e - d;
      b[h >> 2] = f - d;
      b[i >> 2] = c - d;
      return;
    }

    function Oa(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      c = b[a >> 2] | 0;
      h = a + 4 | 0;
      e = b[h >> 2] | 0;
      i = a + 8 | 0;
      d = b[i >> 2] | 0;
      f = e + c | 0;
      b[a >> 2] = f;
      e = d + e | 0;
      b[h >> 2] = e;
      c = d + c | 0;
      b[i >> 2] = c;
      d = e - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[h >> 2] = d;
        b[i >> 2] = c;
        b[a >> 2] = 0;
        e = 0;
      } else {
        d = e;
        e = f;
      }

      if ((d | 0) < 0) {
        e = e - d | 0;
        b[a >> 2] = e;
        c = c - d | 0;
        b[i >> 2] = c;
        b[h >> 2] = 0;
        d = 0;
      }

      g = e - c | 0;
      f = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[h >> 2] = f;
        b[i >> 2] = 0;
        e = g;
        c = 0;
      } else { f = d; }

      d = (f | 0) < (e | 0) ? f : e;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = e - d;
      b[h >> 2] = f - d;
      b[i >> 2] = c - d;
      return;
    }

    function Pa(a) {
      a = a | 0;

      switch (a | 0) {
        case 1:
          {
            a = 5;
            break;
          }

        case 5:
          {
            a = 4;
            break;
          }

        case 4:
          {
            a = 6;
            break;
          }

        case 6:
          {
            a = 2;
            break;
          }

        case 2:
          {
            a = 3;
            break;
          }

        case 3:
          {
            a = 1;
            break;
          }

        default:

      }

      return a | 0;
    }

    function Qa(a) {
      a = a | 0;

      switch (a | 0) {
        case 1:
          {
            a = 3;
            break;
          }

        case 3:
          {
            a = 2;
            break;
          }

        case 2:
          {
            a = 6;
            break;
          }

        case 6:
          {
            a = 4;
            break;
          }

        case 4:
          {
            a = 5;
            break;
          }

        case 5:
          {
            a = 1;
            break;
          }

        default:

      }

      return a | 0;
    }

    function Ra(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      c = b[a >> 2] | 0;
      h = a + 4 | 0;
      d = b[h >> 2] | 0;
      i = a + 8 | 0;
      e = b[i >> 2] | 0;
      f = d + (c << 1) | 0;
      b[a >> 2] = f;
      d = e + (d << 1) | 0;
      b[h >> 2] = d;
      c = (e << 1) + c | 0;
      b[i >> 2] = c;
      e = d - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[h >> 2] = e;
        b[i >> 2] = c;
        b[a >> 2] = 0;
        d = e;
        e = 0;
      } else { e = f; }

      if ((d | 0) < 0) {
        e = e - d | 0;
        b[a >> 2] = e;
        c = c - d | 0;
        b[i >> 2] = c;
        b[h >> 2] = 0;
        d = 0;
      }

      g = e - c | 0;
      f = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[h >> 2] = f;
        b[i >> 2] = 0;
        e = g;
        c = 0;
      } else { f = d; }

      d = (f | 0) < (e | 0) ? f : e;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = e - d;
      b[h >> 2] = f - d;
      b[i >> 2] = c - d;
      return;
    }

    function Sa(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      f = b[a >> 2] | 0;
      h = a + 4 | 0;
      c = b[h >> 2] | 0;
      i = a + 8 | 0;
      d = b[i >> 2] | 0;
      e = (c << 1) + f | 0;
      f = d + (f << 1) | 0;
      b[a >> 2] = f;
      b[h >> 2] = e;
      c = (d << 1) + c | 0;
      b[i >> 2] = c;
      d = e - f | 0;

      if ((f | 0) < 0) {
        c = c - f | 0;
        b[h >> 2] = d;
        b[i >> 2] = c;
        b[a >> 2] = 0;
        f = 0;
      } else { d = e; }

      if ((d | 0) < 0) {
        f = f - d | 0;
        b[a >> 2] = f;
        c = c - d | 0;
        b[i >> 2] = c;
        b[h >> 2] = 0;
        d = 0;
      }

      g = f - c | 0;
      e = d - c | 0;

      if ((c | 0) < 0) {
        b[a >> 2] = g;
        b[h >> 2] = e;
        b[i >> 2] = 0;
        f = g;
        c = 0;
      } else { e = d; }

      d = (e | 0) < (f | 0) ? e : f;
      d = (c | 0) < (d | 0) ? c : d;
      if ((d | 0) <= 0) { return; }
      b[a >> 2] = f - d;
      b[h >> 2] = e - d;
      b[i >> 2] = c - d;
      return;
    }

    function Ta(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = (b[a >> 2] | 0) - (b[c >> 2] | 0) | 0;
      i = (h | 0) < 0;
      e = (b[a + 4 >> 2] | 0) - (b[c + 4 >> 2] | 0) - (i ? h : 0) | 0;
      g = (e | 0) < 0;
      f = (i ? 0 - h | 0 : 0) + (b[a + 8 >> 2] | 0) - (b[c + 8 >> 2] | 0) + (g ? 0 - e | 0 : 0) | 0;
      a = (f | 0) < 0;
      c = a ? 0 : f;
      d = (g ? 0 : e) - (a ? f : 0) | 0;
      f = (i ? 0 : h) - (g ? e : 0) - (a ? f : 0) | 0;
      a = (d | 0) < (f | 0) ? d : f;
      a = (c | 0) < (a | 0) ? c : a;
      e = (a | 0) > 0;
      c = c - (e ? a : 0) | 0;
      d = d - (e ? a : 0) | 0;
      a = f - (e ? a : 0) | 0;
      a = (a | 0) > -1 ? a : 0 - a | 0;
      d = (d | 0) > -1 ? d : 0 - d | 0;
      c = (c | 0) > -1 ? c : 0 - c | 0;
      c = (d | 0) > (c | 0) ? d : c;
      return ((a | 0) > (c | 0) ? a : c) | 0;
    }

    function Ua(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0;
      d = b[a + 8 >> 2] | 0;
      b[c >> 2] = (b[a >> 2] | 0) - d;
      b[c + 4 >> 2] = (b[a + 4 >> 2] | 0) - d;
      return;
    }

    function Va(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      e = b[a >> 2] | 0;
      b[c >> 2] = e;
      a = b[a + 4 >> 2] | 0;
      h = c + 4 | 0;
      b[h >> 2] = a;
      i = c + 8 | 0;
      b[i >> 2] = 0;
      d = a - e | 0;

      if ((e | 0) < 0) {
        a = 0 - e | 0;
        b[h >> 2] = d;
        b[i >> 2] = a;
        b[c >> 2] = 0;
        e = 0;
      } else {
        d = a;
        a = 0;
      }

      if ((d | 0) < 0) {
        e = e - d | 0;
        b[c >> 2] = e;
        a = a - d | 0;
        b[i >> 2] = a;
        b[h >> 2] = 0;
        d = 0;
      }

      g = e - a | 0;
      f = d - a | 0;

      if ((a | 0) < 0) {
        b[c >> 2] = g;
        b[h >> 2] = f;
        b[i >> 2] = 0;
        d = f;
        f = g;
        a = 0;
      } else { f = e; }

      e = (d | 0) < (f | 0) ? d : f;
      e = (a | 0) < (e | 0) ? a : e;
      if ((e | 0) <= 0) { return; }
      b[c >> 2] = f - e;
      b[h >> 2] = d - e;
      b[i >> 2] = a - e;
      return;
    }

    function Wa(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0;
      c = a + 8 | 0;
      f = b[c >> 2] | 0;
      d = f - (b[a >> 2] | 0) | 0;
      b[a >> 2] = d;
      e = a + 4 | 0;
      a = (b[e >> 2] | 0) - f | 0;
      b[e >> 2] = a;
      b[c >> 2] = 0 - (a + d);
      return;
    }

    function Xa(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      d = b[a >> 2] | 0;
      c = 0 - d | 0;
      b[a >> 2] = c;
      h = a + 8 | 0;
      b[h >> 2] = 0;
      i = a + 4 | 0;
      e = b[i >> 2] | 0;
      f = e + d | 0;

      if ((d | 0) > 0) {
        b[i >> 2] = f;
        b[h >> 2] = d;
        b[a >> 2] = 0;
        c = 0;
        e = f;
      } else { d = 0; }

      if ((e | 0) < 0) {
        g = c - e | 0;
        b[a >> 2] = g;
        d = d - e | 0;
        b[h >> 2] = d;
        b[i >> 2] = 0;
        f = g - d | 0;
        c = 0 - d | 0;

        if ((d | 0) < 0) {
          b[a >> 2] = f;
          b[i >> 2] = c;
          b[h >> 2] = 0;
          e = c;
          d = 0;
        } else {
          e = 0;
          f = g;
        }
      } else { f = c; }

      c = (e | 0) < (f | 0) ? e : f;
      c = (d | 0) < (c | 0) ? d : c;
      if ((c | 0) <= 0) { return; }
      b[a >> 2] = f - c;
      b[i >> 2] = e - c;
      b[h >> 2] = d - c;
      return;
    }

    function Ya(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      d = S;
      S = S + 16 | 0;
      e = d;
      Za(a, b, c, e);
      Ba(e, c + 4 | 0);
      S = d;
      return;
    }

    function Za(a, c, d, f) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      f = f | 0;
      var g = 0.0,
          h = 0,
          i = 0.0,
          j = 0.0,
          k = 0;
      k = S;
      S = S + 32 | 0;
      h = k;
      Jc(a, h);
      b[d >> 2] = 0;
      g = +Ic(15888, h);
      i = +Ic(15912, h);

      if (i < g) {
        b[d >> 2] = 1;
        g = i;
      }

      i = +Ic(15936, h);

      if (i < g) {
        b[d >> 2] = 2;
        g = i;
      }

      i = +Ic(15960, h);

      if (i < g) {
        b[d >> 2] = 3;
        g = i;
      }

      i = +Ic(15984, h);

      if (i < g) {
        b[d >> 2] = 4;
        g = i;
      }

      i = +Ic(16008, h);

      if (i < g) {
        b[d >> 2] = 5;
        g = i;
      }

      i = +Ic(16032, h);

      if (i < g) {
        b[d >> 2] = 6;
        g = i;
      }

      i = +Ic(16056, h);

      if (i < g) {
        b[d >> 2] = 7;
        g = i;
      }

      i = +Ic(16080, h);

      if (i < g) {
        b[d >> 2] = 8;
        g = i;
      }

      i = +Ic(16104, h);

      if (i < g) {
        b[d >> 2] = 9;
        g = i;
      }

      i = +Ic(16128, h);

      if (i < g) {
        b[d >> 2] = 10;
        g = i;
      }

      i = +Ic(16152, h);

      if (i < g) {
        b[d >> 2] = 11;
        g = i;
      }

      i = +Ic(16176, h);

      if (i < g) {
        b[d >> 2] = 12;
        g = i;
      }

      i = +Ic(16200, h);

      if (i < g) {
        b[d >> 2] = 13;
        g = i;
      }

      i = +Ic(16224, h);

      if (i < g) {
        b[d >> 2] = 14;
        g = i;
      }

      i = +Ic(16248, h);

      if (i < g) {
        b[d >> 2] = 15;
        g = i;
      }

      i = +Ic(16272, h);

      if (i < g) {
        b[d >> 2] = 16;
        g = i;
      }

      i = +Ic(16296, h);

      if (i < g) {
        b[d >> 2] = 17;
        g = i;
      }

      i = +Ic(16320, h);

      if (i < g) {
        b[d >> 2] = 18;
        g = i;
      }

      i = +Ic(16344, h);

      if (i < g) {
        b[d >> 2] = 19;
        g = i;
      }

      i = +w(+(1.0 - g * .5));

      if (i < 1.0e-16) {
        b[f >> 2] = 0;
        b[f + 4 >> 2] = 0;
        b[f + 8 >> 2] = 0;
        b[f + 12 >> 2] = 0;
        S = k;
        return;
      }

      d = b[d >> 2] | 0;
      g = +e[16368 + (d * 24 | 0) >> 3];
      g = +gb(g - +gb(+lb(15568 + (d << 4) | 0, a)));
      if (!(Rb(c) | 0)) { j = g; }else { j = +gb(g + -.3334731722518321); }
      g = +v(+i) / .381966011250105;

      if ((c | 0) > 0) {
        h = 0;

        do {
          g = g * 2.6457513110645907;
          h = h + 1 | 0;
        } while ((h | 0) != (c | 0));
      }

      i = +t(+j) * g;
      e[f >> 3] = i;
      j = +u(+j) * g;
      e[f + 8 >> 3] = j;
      S = k;
      return;
    }

    function _a(a, c, d, f, g) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      f = f | 0;
      g = g | 0;
      var h = 0.0,
          i = 0.0;
      h = +Fc(a);

      if (h < 1.0e-16) {
        c = 15568 + (c << 4) | 0;
        b[g >> 2] = b[c >> 2];
        b[g + 4 >> 2] = b[c + 4 >> 2];
        b[g + 8 >> 2] = b[c + 8 >> 2];
        b[g + 12 >> 2] = b[c + 12 >> 2];
        return;
      }

      i = +z(+ +e[a + 8 >> 3], + +e[a >> 3]);

      if ((d | 0) > 0) {
        a = 0;

        do {
          h = h / 2.6457513110645907;
          a = a + 1 | 0;
        } while ((a | 0) != (d | 0));
      }

      if (!f) {
        h = +y(+(h * .381966011250105));
        if (Rb(d) | 0) { i = +gb(i + .3334731722518321); }
      } else {
        h = h / 3.0;
        d = (Rb(d) | 0) == 0;
        h = +y(+((d ? h : h / 2.6457513110645907) * .381966011250105));
      }

      mb(15568 + (c << 4) | 0, +gb(+e[16368 + (c * 24 | 0) >> 3] - i), h, g);
      return;
    }

    function $a(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0;
      e = S;
      S = S + 16 | 0;
      f = e;
      Da(a + 4 | 0, f);

      _a(f, b[a >> 2] | 0, c, 0, d);

      S = e;
      return;
    }

    function ab(a, c, d, f, g) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      f = f | 0;
      g = g | 0;
      var h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0,
          z = 0,
          A = 0,
          B = 0,
          C = 0,
          D = 0,
          E = 0,
          F = 0,
          G = 0,
          I = 0.0,
          J = 0.0;
      G = S;
      S = S + 272 | 0;
      h = G + 256 | 0;
      u = G + 240 | 0;
      D = G;
      E = G + 224 | 0;
      F = G + 208 | 0;
      v = G + 176 | 0;
      w = G + 160 | 0;
      x = G + 192 | 0;
      y = G + 144 | 0;
      z = G + 128 | 0;
      A = G + 112 | 0;
      B = G + 96 | 0;
      C = G + 80 | 0;
      b[h >> 2] = c;
      b[u >> 2] = b[a >> 2];
      b[u + 4 >> 2] = b[a + 4 >> 2];
      b[u + 8 >> 2] = b[a + 8 >> 2];
      b[u + 12 >> 2] = b[a + 12 >> 2];
      bb(u, h, D);
      b[g >> 2] = 0;
      u = f + d + ((f | 0) == 5 & 1) | 0;

      if ((u | 0) <= (d | 0)) {
        S = G;
        return;
      }

      k = b[h >> 2] | 0;
      l = E + 4 | 0;
      m = v + 4 | 0;
      n = d + 5 | 0;
      o = 16848 + (k << 2) | 0;
      p = 16928 + (k << 2) | 0;
      q = z + 8 | 0;
      r = A + 8 | 0;
      s = B + 8 | 0;
      t = F + 4 | 0;
      j = d;

      a: while (1) {
        i = D + (((j | 0) % 5 | 0) << 4) | 0;
        b[F >> 2] = b[i >> 2];
        b[F + 4 >> 2] = b[i + 4 >> 2];
        b[F + 8 >> 2] = b[i + 8 >> 2];
        b[F + 12 >> 2] = b[i + 12 >> 2];

        do {} while ((cb(F, k, 0, 1) | 0) == 2);

        if ((j | 0) > (d | 0) & (Rb(c) | 0) != 0) {
          b[v >> 2] = b[F >> 2];
          b[v + 4 >> 2] = b[F + 4 >> 2];
          b[v + 8 >> 2] = b[F + 8 >> 2];
          b[v + 12 >> 2] = b[F + 12 >> 2];
          Da(l, w);
          f = b[v >> 2] | 0;
          h = b[17008 + (f * 80 | 0) + (b[E >> 2] << 2) >> 2] | 0;
          b[v >> 2] = b[18608 + (f * 80 | 0) + (h * 20 | 0) >> 2];
          i = b[18608 + (f * 80 | 0) + (h * 20 | 0) + 16 >> 2] | 0;

          if ((i | 0) > 0) {
            a = 0;

            do {
              Na(m);
              a = a + 1 | 0;
            } while ((a | 0) < (i | 0));
          }

          i = 18608 + (f * 80 | 0) + (h * 20 | 0) + 4 | 0;
          b[x >> 2] = b[i >> 2];
          b[x + 4 >> 2] = b[i + 4 >> 2];
          b[x + 8 >> 2] = b[i + 8 >> 2];
          Ga(x, (b[o >> 2] | 0) * 3 | 0);
          Ea(m, x, m);
          Ca(m);
          Da(m, y);
          I = +(b[p >> 2] | 0);
          e[z >> 3] = I * 3.0;
          e[q >> 3] = 0.0;
          J = I * -1.5;
          e[A >> 3] = J;
          e[r >> 3] = I * 2.598076211353316;
          e[B >> 3] = J;
          e[s >> 3] = I * -2.598076211353316;

          switch (b[17008 + ((b[v >> 2] | 0) * 80 | 0) + (b[F >> 2] << 2) >> 2] | 0) {
            case 1:
              {
                a = A;
                f = z;
                break;
              }

            case 3:
              {
                a = B;
                f = A;
                break;
              }

            case 2:
              {
                a = z;
                f = B;
                break;
              }

            default:
              {
                a = 12;
                break a;
              }
          }

          Gc(w, y, f, a, C);

          _a(C, b[v >> 2] | 0, k, 1, g + 8 + (b[g >> 2] << 4) | 0);

          b[g >> 2] = (b[g >> 2] | 0) + 1;
        }

        if ((j | 0) < (n | 0)) {
          Da(t, v);

          _a(v, b[F >> 2] | 0, k, 1, g + 8 + (b[g >> 2] << 4) | 0);

          b[g >> 2] = (b[g >> 2] | 0) + 1;
        }
        b[E >> 2] = b[F >> 2];
        b[E + 4 >> 2] = b[F + 4 >> 2];
        b[E + 8 >> 2] = b[F + 8 >> 2];
        b[E + 12 >> 2] = b[F + 12 >> 2];
        j = j + 1 | 0;

        if ((j | 0) >= (u | 0)) {
          a = 3;
          break;
        }
      }

      if ((a | 0) == 3) {
        S = G;
        return;
      } else if ((a | 0) == 12) { H(22474, 22521, 581, 22531); }
    }

    function bb(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0;
      j = S;
      S = S + 128 | 0;
      e = j + 64 | 0;
      f = j;
      g = e;
      h = 20208;
      i = g + 60 | 0;

      do {
        b[g >> 2] = b[h >> 2];
        g = g + 4 | 0;
        h = h + 4 | 0;
      } while ((g | 0) < (i | 0));

      g = f;
      h = 20272;
      i = g + 60 | 0;

      do {
        b[g >> 2] = b[h >> 2];
        g = g + 4 | 0;
        h = h + 4 | 0;
      } while ((g | 0) < (i | 0));

      i = (Rb(b[c >> 2] | 0) | 0) == 0;
      e = i ? e : f;
      f = a + 4 | 0;
      Ra(f);
      Sa(f);

      if (Rb(b[c >> 2] | 0) | 0) {
        La(f);
        b[c >> 2] = (b[c >> 2] | 0) + 1;
      }

      b[d >> 2] = b[a >> 2];
      c = d + 4 | 0;
      Ea(f, e, c);
      Ca(c);
      b[d + 16 >> 2] = b[a >> 2];
      c = d + 20 | 0;
      Ea(f, e + 12 | 0, c);
      Ca(c);
      b[d + 32 >> 2] = b[a >> 2];
      c = d + 36 | 0;
      Ea(f, e + 24 | 0, c);
      Ca(c);
      b[d + 48 >> 2] = b[a >> 2];
      c = d + 52 | 0;
      Ea(f, e + 36 | 0, c);
      Ca(c);
      b[d + 64 >> 2] = b[a >> 2];
      d = d + 68 | 0;
      Ea(f, e + 48 | 0, d);
      Ca(d);
      S = j;
      return;
    }

    function cb(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0;
      p = S;
      S = S + 32 | 0;
      n = p + 12 | 0;
      i = p;
      o = a + 4 | 0;
      m = b[16928 + (c << 2) >> 2] | 0;
      l = (e | 0) != 0;
      m = l ? m * 3 | 0 : m;
      f = b[o >> 2] | 0;
      k = a + 8 | 0;
      h = b[k >> 2] | 0;

      if (l) {
        g = a + 12 | 0;
        e = b[g >> 2] | 0;
        f = h + f + e | 0;

        if ((f | 0) == (m | 0)) {
          o = 1;
          S = p;
          return o | 0;
        } else { j = g; }
      } else {
        j = a + 12 | 0;
        e = b[j >> 2] | 0;
        f = h + f + e | 0;
      }

      if ((f | 0) <= (m | 0)) {
        o = 0;
        S = p;
        return o | 0;
      }

      do { if ((e | 0) > 0) {
        e = b[a >> 2] | 0;

        if ((h | 0) > 0) {
          g = 18608 + (e * 80 | 0) + 60 | 0;
          e = a;
          break;
        }

        e = 18608 + (e * 80 | 0) + 40 | 0;

        if (!d) {
          g = e;
          e = a;
        } else {
          Aa(n, m, 0, 0);
          Fa(o, n, i);
          Oa(i);
          Ea(i, n, o);
          g = e;
          e = a;
        }
      } else {
        g = 18608 + ((b[a >> 2] | 0) * 80 | 0) + 20 | 0;
        e = a;
      } } while (0);

      b[e >> 2] = b[g >> 2];
      f = g + 16 | 0;

      if ((b[f >> 2] | 0) > 0) {
        e = 0;

        do {
          Na(o);
          e = e + 1 | 0;
        } while ((e | 0) < (b[f >> 2] | 0));
      }

      a = g + 4 | 0;
      b[n >> 2] = b[a >> 2];
      b[n + 4 >> 2] = b[a + 4 >> 2];
      b[n + 8 >> 2] = b[a + 8 >> 2];
      c = b[16848 + (c << 2) >> 2] | 0;
      Ga(n, l ? c * 3 | 0 : c);
      Ea(o, n, o);
      Ca(o);
      if (l) { e = ((b[k >> 2] | 0) + (b[o >> 2] | 0) + (b[j >> 2] | 0) | 0) == (m | 0) ? 1 : 2; }else { e = 2; }
      o = e;
      S = p;
      return o | 0;
    }

    function db(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0;

      do { c = cb(a, b, 0, 1) | 0; } while ((c | 0) == 2);

      return c | 0;
    }

    function eb(a, c, d, f, g) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      f = f | 0;
      g = g | 0;
      var h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0,
          z = 0,
          A = 0,
          B = 0,
          C = 0.0,
          D = 0.0;
      B = S;
      S = S + 240 | 0;
      h = B + 224 | 0;
      x = B + 208 | 0;
      y = B;
      z = B + 192 | 0;
      A = B + 176 | 0;
      s = B + 160 | 0;
      t = B + 144 | 0;
      u = B + 128 | 0;
      v = B + 112 | 0;
      w = B + 96 | 0;
      b[h >> 2] = c;
      b[x >> 2] = b[a >> 2];
      b[x + 4 >> 2] = b[a + 4 >> 2];
      b[x + 8 >> 2] = b[a + 8 >> 2];
      b[x + 12 >> 2] = b[a + 12 >> 2];
      fb(x, h, y);
      b[g >> 2] = 0;
      r = f + d + ((f | 0) == 6 & 1) | 0;

      if ((r | 0) <= (d | 0)) {
        S = B;
        return;
      }

      k = b[h >> 2] | 0;
      l = d + 6 | 0;
      m = 16928 + (k << 2) | 0;
      n = t + 8 | 0;
      o = u + 8 | 0;
      p = v + 8 | 0;
      q = z + 4 | 0;
      i = 0;
      j = d;
      f = -1;

      a: while (1) {
        h = (j | 0) % 6 | 0;
        a = y + (h << 4) | 0;
        b[z >> 2] = b[a >> 2];
        b[z + 4 >> 2] = b[a + 4 >> 2];
        b[z + 8 >> 2] = b[a + 8 >> 2];
        b[z + 12 >> 2] = b[a + 12 >> 2];
        a = i;
        i = cb(z, k, 0, 1) | 0;

        if ((j | 0) > (d | 0) & (Rb(c) | 0) != 0 ? (a | 0) != 1 ? (b[z >> 2] | 0) != (f | 0) : 0 : 0) {
          Da(y + (((h + 5 | 0) % 6 | 0) << 4) + 4 | 0, A);
          Da(y + (h << 4) + 4 | 0, s);
          C = +(b[m >> 2] | 0);
          e[t >> 3] = C * 3.0;
          e[n >> 3] = 0.0;
          D = C * -1.5;
          e[u >> 3] = D;
          e[o >> 3] = C * 2.598076211353316;
          e[v >> 3] = D;
          e[p >> 3] = C * -2.598076211353316;
          h = b[x >> 2] | 0;

          switch (b[17008 + (h * 80 | 0) + (((f | 0) == (h | 0) ? b[z >> 2] | 0 : f) << 2) >> 2] | 0) {
            case 1:
              {
                a = u;
                f = t;
                break;
              }

            case 3:
              {
                a = v;
                f = u;
                break;
              }

            case 2:
              {
                a = t;
                f = v;
                break;
              }

            default:
              {
                a = 8;
                break a;
              }
          }

          Gc(A, s, f, a, w);

          if (!(Hc(A, w) | 0) ? !(Hc(s, w) | 0) : 0) {
            _a(w, b[x >> 2] | 0, k, 1, g + 8 + (b[g >> 2] << 4) | 0);

            b[g >> 2] = (b[g >> 2] | 0) + 1;
          }
        }

        if ((j | 0) < (l | 0)) {
          Da(q, A);

          _a(A, b[z >> 2] | 0, k, 1, g + 8 + (b[g >> 2] << 4) | 0);

          b[g >> 2] = (b[g >> 2] | 0) + 1;
        }

        j = j + 1 | 0;

        if ((j | 0) >= (r | 0)) {
          a = 3;
          break;
        } else { f = b[z >> 2] | 0; }
      }

      if ((a | 0) == 3) {
        S = B;
        return;
      } else if ((a | 0) == 8) { H(22557, 22521, 746, 22602); }
    }

    function fb(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0;
      j = S;
      S = S + 160 | 0;
      e = j + 80 | 0;
      f = j;
      g = e;
      h = 20336;
      i = g + 72 | 0;

      do {
        b[g >> 2] = b[h >> 2];
        g = g + 4 | 0;
        h = h + 4 | 0;
      } while ((g | 0) < (i | 0));

      g = f;
      h = 20416;
      i = g + 72 | 0;

      do {
        b[g >> 2] = b[h >> 2];
        g = g + 4 | 0;
        h = h + 4 | 0;
      } while ((g | 0) < (i | 0));

      i = (Rb(b[c >> 2] | 0) | 0) == 0;
      e = i ? e : f;
      f = a + 4 | 0;
      Ra(f);
      Sa(f);

      if (Rb(b[c >> 2] | 0) | 0) {
        La(f);
        b[c >> 2] = (b[c >> 2] | 0) + 1;
      }

      b[d >> 2] = b[a >> 2];
      c = d + 4 | 0;
      Ea(f, e, c);
      Ca(c);
      b[d + 16 >> 2] = b[a >> 2];
      c = d + 20 | 0;
      Ea(f, e + 12 | 0, c);
      Ca(c);
      b[d + 32 >> 2] = b[a >> 2];
      c = d + 36 | 0;
      Ea(f, e + 24 | 0, c);
      Ca(c);
      b[d + 48 >> 2] = b[a >> 2];
      c = d + 52 | 0;
      Ea(f, e + 36 | 0, c);
      Ca(c);
      b[d + 64 >> 2] = b[a >> 2];
      c = d + 68 | 0;
      Ea(f, e + 48 | 0, c);
      Ca(c);
      b[d + 80 >> 2] = b[a >> 2];
      d = d + 84 | 0;
      Ea(f, e + 60 | 0, d);
      Ca(d);
      S = j;
      return;
    }

    function gb(a) {
      a = +a;
      var b = 0.0;
      b = a < 0.0 ? a + 6.283185307179586 : a;
      return +(!(a >= 6.283185307179586) ? b : b + -6.283185307179586);
    }

    function hb(a, b) {
      a = a | 0;
      b = b | 0;

      if (!(+q(+(+e[a >> 3] - +e[b >> 3])) < 1.7453292519943298e-11)) {
        b = 0;
        return b | 0;
      }

      b = +q(+(+e[a + 8 >> 3] - +e[b + 8 >> 3])) < 1.7453292519943298e-11;
      return b | 0;
    }

    function ib(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0,
          g = 0.0;
      f = +e[b >> 3];
      d = +e[a >> 3];
      g = +u(+((f - d) * .5));
      c = +u(+((+e[b + 8 >> 3] - +e[a + 8 >> 3]) * .5));
      c = g * g + c * (+t(+f) * +t(+d) * c);
      return +(+z(+ +r(+c), + +r(+(1.0 - c))) * 2.0);
    }

    function jb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0,
          g = 0.0;
      f = +e[b >> 3];
      d = +e[a >> 3];
      g = +u(+((f - d) * .5));
      c = +u(+((+e[b + 8 >> 3] - +e[a + 8 >> 3]) * .5));
      c = g * g + c * (+t(+f) * +t(+d) * c);
      return +(+z(+ +r(+c), + +r(+(1.0 - c))) * 2.0 * 6371.007180918475);
    }

    function kb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0,
          g = 0.0;
      f = +e[b >> 3];
      d = +e[a >> 3];
      g = +u(+((f - d) * .5));
      c = +u(+((+e[b + 8 >> 3] - +e[a + 8 >> 3]) * .5));
      c = g * g + c * (+t(+f) * +t(+d) * c);
      return +(+z(+ +r(+c), + +r(+(1.0 - c))) * 2.0 * 6371.007180918475 * 1.0e3);
    }

    function lb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0,
          g = 0.0,
          h = 0.0;
      g = +e[b >> 3];
      d = +t(+g);
      f = +e[b + 8 >> 3] - +e[a + 8 >> 3];
      h = d * +u(+f);
      c = +e[a >> 3];
      return + +z(+h, +(+u(+g) * +t(+c) - +t(+f) * (d * +u(+c))));
    }

    function mb(a, c, d, f) {
      a = a | 0;
      c = +c;
      d = +d;
      f = f | 0;
      var g = 0,
          h = 0.0,
          i = 0.0,
          j = 0.0;

      if (d < 1.0e-16) {
        b[f >> 2] = b[a >> 2];
        b[f + 4 >> 2] = b[a + 4 >> 2];
        b[f + 8 >> 2] = b[a + 8 >> 2];
        b[f + 12 >> 2] = b[a + 12 >> 2];
        return;
      }

      h = c < 0.0 ? c + 6.283185307179586 : c;
      h = !(c >= 6.283185307179586) ? h : h + -6.283185307179586;

      do { if (h < 1.0e-16) {
        c = +e[a >> 3] + d;
        e[f >> 3] = c;
        g = f;
      } else {
        g = +q(+(h + -3.141592653589793)) < 1.0e-16;
        c = +e[a >> 3];

        if (g) {
          c = c - d;
          e[f >> 3] = c;
          g = f;
          break;
        }

        i = +t(+d);
        d = +u(+d);
        c = i * +u(+c) + +t(+h) * (d * +t(+c));
        c = c > 1.0 ? 1.0 : c;
        c = +x(+(c < -1.0 ? -1.0 : c));
        e[f >> 3] = c;

        if (+q(+(c + -1.5707963267948966)) < 1.0e-16) {
          e[f >> 3] = 1.5707963267948966;
          e[f + 8 >> 3] = 0.0;
          return;
        }

        if (+q(+(c + 1.5707963267948966)) < 1.0e-16) {
          e[f >> 3] = -1.5707963267948966;
          e[f + 8 >> 3] = 0.0;
          return;
        }

        j = +t(+c);
        h = d * +u(+h) / j;
        d = +e[a >> 3];
        c = (i - +u(+c) * +u(+d)) / +t(+d) / j;
        i = h > 1.0 ? 1.0 : h;
        c = c > 1.0 ? 1.0 : c;
        c = +e[a + 8 >> 3] + +z(+(i < -1.0 ? -1.0 : i), +(c < -1.0 ? -1.0 : c));
        if (c > 3.141592653589793) { do { c = c + -6.283185307179586; } while (c > 3.141592653589793); }
        if (c < -3.141592653589793) { do { c = c + 6.283185307179586; } while (c < -3.141592653589793); }
        e[f + 8 >> 3] = c;
        return;
      } } while (0);

      if (+q(+(c + -1.5707963267948966)) < 1.0e-16) {
        e[g >> 3] = 1.5707963267948966;
        e[f + 8 >> 3] = 0.0;
        return;
      }

      if (+q(+(c + 1.5707963267948966)) < 1.0e-16) {
        e[g >> 3] = -1.5707963267948966;
        e[f + 8 >> 3] = 0.0;
        return;
      }

      c = +e[a + 8 >> 3];
      if (c > 3.141592653589793) { do { c = c + -6.283185307179586; } while (c > 3.141592653589793); }
      if (c < -3.141592653589793) { do { c = c + 6.283185307179586; } while (c < -3.141592653589793); }
      e[f + 8 >> 3] = c;
      return;
    }

    function nb(a) {
      a = a | 0;
      return + +e[20496 + (a << 3) >> 3];
    }

    function ob(a) {
      a = a | 0;
      return + +e[20624 + (a << 3) >> 3];
    }

    function pb(a) {
      a = a | 0;
      return + +e[20752 + (a << 3) >> 3];
    }

    function qb(a) {
      a = a | 0;
      return + +e[20880 + (a << 3) >> 3];
    }

    function rb(a) {
      a = a | 0;
      var c = 0;
      c = 21008 + (a << 3) | 0;
      a = b[c >> 2] | 0;
      F(b[c + 4 >> 2] | 0);
      return a | 0;
    }

    function sb(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      var d = 0.0,
          f = 0.0,
          g = 0.0,
          h = 0.0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0.0,
          m = 0.0,
          n = 0.0;
      n = +e[b >> 3];
      l = +e[a >> 3];
      j = +u(+((n - l) * .5));
      g = +e[b + 8 >> 3];
      k = +e[a + 8 >> 3];
      h = +u(+((g - k) * .5));
      i = +t(+l);
      m = +t(+n);
      h = j * j + h * (m * i * h);
      h = +z(+ +r(+h), + +r(+(1.0 - h))) * 2.0;
      j = +e[c >> 3];
      n = +u(+((j - n) * .5));
      d = +e[c + 8 >> 3];
      g = +u(+((d - g) * .5));
      f = +t(+j);
      g = n * n + g * (m * f * g);
      g = +z(+ +r(+g), + +r(+(1.0 - g))) * 2.0;
      j = +u(+((l - j) * .5));
      d = +u(+((k - d) * .5));
      d = j * j + d * (i * f * d);
      d = +z(+ +r(+d), + +r(+(1.0 - d))) * 2.0;
      f = (h + g + d) * .5;
      return +(+y(+ +r(+(+v(+(f * .5)) * +v(+((f - h) * .5)) * +v(+((f - g) * .5)) * +v(+((f - d) * .5))))) * 4.0);
    }

    function tb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          e = 0,
          f = 0,
          g = 0,
          h = 0;
      g = S;
      S = S + 192 | 0;
      e = g + 168 | 0;
      f = g;
      Vb(a, c, e);
      Wb(a, c, f);
      c = b[f >> 2] | 0;

      if ((c | 0) <= 0) {
        d = 0.0;
        S = g;
        return +d;
      }

      d = +sb(f + 8 | 0, f + 8 + (((c | 0) != 1 & 1) << 4) | 0, e) + 0.0;

      if ((c | 0) == 1) {
        S = g;
        return +d;
      }

      a = 1;

      do {
        h = a;
        a = a + 1 | 0;
        d = d + +sb(f + 8 + (h << 4) | 0, f + 8 + (((a | 0) % (c | 0) | 0) << 4) | 0, e);
      } while ((a | 0) < (c | 0));

      S = g;
      return +d;
    }

    function ub(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          e = 0,
          f = 0,
          g = 0,
          h = 0;
      g = S;
      S = S + 192 | 0;
      e = g + 168 | 0;
      f = g;
      Vb(a, c, e);
      Wb(a, c, f);
      c = b[f >> 2] | 0;

      if ((c | 0) > 0) {
        d = +sb(f + 8 | 0, f + 8 + (((c | 0) != 1 & 1) << 4) | 0, e) + 0.0;

        if ((c | 0) != 1) {
          a = 1;

          do {
            h = a;
            a = a + 1 | 0;
            d = d + +sb(f + 8 + (h << 4) | 0, f + 8 + (((a | 0) % (c | 0) | 0) << 4) | 0, e);
          } while ((a | 0) < (c | 0));
        }
      } else { d = 0.0; }

      S = g;
      return +(d * 6371.007180918475 * 6371.007180918475);
    }

    function vb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          e = 0,
          f = 0,
          g = 0,
          h = 0;
      g = S;
      S = S + 192 | 0;
      e = g + 168 | 0;
      f = g;
      Vb(a, c, e);
      Wb(a, c, f);
      c = b[f >> 2] | 0;

      if ((c | 0) > 0) {
        d = +sb(f + 8 | 0, f + 8 + (((c | 0) != 1 & 1) << 4) | 0, e) + 0.0;

        if ((c | 0) != 1) {
          a = 1;

          do {
            h = a;
            a = a + 1 | 0;
            d = d + +sb(f + 8 + (h << 4) | 0, f + 8 + (((a | 0) % (c | 0) | 0) << 4) | 0, e);
          } while ((a | 0) < (c | 0));
        }
      } else { d = 0.0; }

      S = g;
      return +(d * 6371.007180918475 * 6371.007180918475 * 1.0e3 * 1.0e3);
    }

    function wb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          f = 0.0,
          g = 0.0,
          h = 0,
          i = 0,
          j = 0.0,
          k = 0.0,
          l = 0.0;
      i = S;
      S = S + 176 | 0;
      h = i;
      gc(a, c, h);
      a = b[h >> 2] | 0;

      if ((a | 0) <= 1) {
        g = 0.0;
        S = i;
        return +g;
      }

      c = a + -1 | 0;
      a = 0;
      d = 0.0;
      f = +e[h + 8 >> 3];
      g = +e[h + 16 >> 3];

      do {
        a = a + 1 | 0;
        k = f;
        f = +e[h + 8 + (a << 4) >> 3];
        l = +u(+((f - k) * .5));
        j = g;
        g = +e[h + 8 + (a << 4) + 8 >> 3];
        j = +u(+((g - j) * .5));
        j = l * l + j * (+t(+f) * +t(+k) * j);
        d = d + +z(+ +r(+j), + +r(+(1.0 - j))) * 2.0;
      } while ((a | 0) < (c | 0));

      S = i;
      return +d;
    }

    function xb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          f = 0.0,
          g = 0.0,
          h = 0,
          i = 0,
          j = 0.0,
          k = 0.0,
          l = 0.0;
      i = S;
      S = S + 176 | 0;
      h = i;
      gc(a, c, h);
      a = b[h >> 2] | 0;

      if ((a | 0) <= 1) {
        g = 0.0;
        S = i;
        return +g;
      }

      c = a + -1 | 0;
      a = 0;
      d = 0.0;
      f = +e[h + 8 >> 3];
      g = +e[h + 16 >> 3];

      do {
        a = a + 1 | 0;
        k = f;
        f = +e[h + 8 + (a << 4) >> 3];
        l = +u(+((f - k) * .5));
        j = g;
        g = +e[h + 8 + (a << 4) + 8 >> 3];
        j = +u(+((g - j) * .5));
        j = l * l + j * (+t(+k) * +t(+f) * j);
        d = d + +z(+ +r(+j), + +r(+(1.0 - j))) * 2.0;
      } while ((a | 0) != (c | 0));

      l = d * 6371.007180918475;
      S = i;
      return +l;
    }

    function yb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          f = 0.0,
          g = 0.0,
          h = 0,
          i = 0,
          j = 0.0,
          k = 0.0,
          l = 0.0;
      i = S;
      S = S + 176 | 0;
      h = i;
      gc(a, c, h);
      a = b[h >> 2] | 0;

      if ((a | 0) <= 1) {
        g = 0.0;
        S = i;
        return +g;
      }

      c = a + -1 | 0;
      a = 0;
      d = 0.0;
      f = +e[h + 8 >> 3];
      g = +e[h + 16 >> 3];

      do {
        a = a + 1 | 0;
        k = f;
        f = +e[h + 8 + (a << 4) >> 3];
        l = +u(+((f - k) * .5));
        j = g;
        g = +e[h + 8 + (a << 4) + 8 >> 3];
        j = +u(+((g - j) * .5));
        j = l * l + j * (+t(+k) * +t(+f) * j);
        d = d + +z(+ +r(+j), + +r(+(1.0 - j))) * 2.0;
      } while ((a | 0) != (c | 0));

      l = d * 6371.007180918475 * 1.0e3;
      S = i;
      return +l;
    }

    function zb(a, b) {
      a = a | 0;
      b = b | 0;
      b = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      return b & 15 | 0;
    }

    function Ab(a, b) {
      a = a | 0;
      b = b | 0;
      b = cd(a | 0, b | 0, 45) | 0;
      G() | 0;
      return b & 127 | 0;
    }

    function Bb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0;

      if (!(0 == 0 & (b & -16777216 | 0) == 134217728)) {
        b = 0;
        return b | 0;
      }

      g = cd(a | 0, b | 0, 45) | 0;
      G() | 0;
      g = g & 127;

      if (g >>> 0 > 121) {
        b = 0;
        return b | 0;
      }

      c = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      c = c & 15;

      do { if (c | 0) {
        e = 1;
        d = 0;

        while (1) {
          f = cd(a | 0, b | 0, (15 - e | 0) * 3 | 0) | 0;
          G() | 0;
          f = f & 7;
          if ((f | 0) != 0 & (d ^ 1)) { if ((f | 0) == 1 & (la(g) | 0) != 0) {
            h = 0;
            d = 13;
            break;
          } else { d = 1; } }

          if ((f | 0) == 7) {
            h = 0;
            d = 13;
            break;
          }

          if (e >>> 0 < c >>> 0) { e = e + 1 | 0; }else {
            d = 9;
            break;
          }
        }

        if ((d | 0) == 9) {
          if ((c | 0) == 15) { h = 1; }else { break; }
          return h | 0;
        } else if ((d | 0) == 13) { return h | 0; }
      } } while (0);

      while (1) {
        h = cd(a | 0, b | 0, (14 - c | 0) * 3 | 0) | 0;
        G() | 0;

        if (!((h & 7 | 0) == 7 & 0 == 0)) {
          h = 0;
          d = 13;
          break;
        }

        if (c >>> 0 < 14) { c = c + 1 | 0; }else {
          h = 1;
          d = 13;
          break;
        }
      }

      if ((d | 0) == 13) { return h | 0; }
      return 0;
    }

    function Cb(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      d = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      d = d & 15;

      if ((d | 0) >= (c | 0)) {
        if ((d | 0) != (c | 0)) { if (c >>> 0 <= 15) {
          e = dd(c | 0, 0, 52) | 0;
          a = e | a;
          b = G() | 0 | b & -15728641;
          if ((d | 0) > (c | 0)) { do {
            e = dd(7, 0, (14 - c | 0) * 3 | 0) | 0;
            c = c + 1 | 0;
            a = e | a;
            b = G() | 0 | b;
          } while ((c | 0) < (d | 0)); }
        } else {
          b = 0;
          a = 0;
        } }
      } else {
        b = 0;
        a = 0;
      }

      F(b | 0);
      return a | 0;
    }

    function Db(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      a = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      a = a & 15;

      if (!((c | 0) < 16 & (a | 0) <= (c | 0))) {
        c = 0;
        return c | 0;
      }

      c = tc(7, c - a | 0) | 0;
      return c | 0;
    }

    function Eb(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0;
      h = cd(a | 0, c | 0, 52) | 0;
      G() | 0;
      h = h & 15;
      if (!((d | 0) < 16 & (h | 0) <= (d | 0))) { return; }

      if ((h | 0) == (d | 0)) {
        d = e;
        b[d >> 2] = a;
        b[d + 4 >> 2] = c;
        return;
      }

      j = tc(7, d - h | 0) | 0;
      k = (j | 0) / 7 | 0;
      i = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      if (!(la(i & 127) | 0)) { g = 0; }else {
        a: do { if (!h) { f = 0; }else {
          g = 1;

          while (1) {
            f = cd(a | 0, c | 0, (15 - g | 0) * 3 | 0) | 0;
            G() | 0;
            f = f & 7;
            if (f | 0) { break a; }
            if (g >>> 0 < h >>> 0) { g = g + 1 | 0; }else {
              f = 0;
              break;
            }
          }
        } } while (0);

        g = (f | 0) == 0;
      }
      l = dd(h + 1 | 0, 0, 52) | 0;
      f = G() | 0 | c & -15728641;
      i = (14 - h | 0) * 3 | 0;
      c = dd(7, 0, i | 0) | 0;
      c = (l | a) & ~c;
      h = f & ~(G() | 0);
      Eb(c, h, d, e);
      f = e + (k << 3) | 0;

      if (!g) {
        l = dd(1, 0, i | 0) | 0;
        Eb(l | c, G() | 0 | h, d, f);
        l = f + (k << 3) | 0;
        j = dd(2, 0, i | 0) | 0;
        Eb(j | c, G() | 0 | h, d, l);
        l = l + (k << 3) | 0;
        j = dd(3, 0, i | 0) | 0;
        Eb(j | c, G() | 0 | h, d, l);
        l = l + (k << 3) | 0;
        j = dd(4, 0, i | 0) | 0;
        Eb(j | c, G() | 0 | h, d, l);
        l = l + (k << 3) | 0;
        j = dd(5, 0, i | 0) | 0;
        Eb(j | c, G() | 0 | h, d, l);
        j = dd(6, 0, i | 0) | 0;
        Eb(j | c, G() | 0 | h, d, l + (k << 3) | 0);
        return;
      }

      g = f + (k << 3) | 0;

      if ((j | 0) > 6) {
        j = f + 8 | 0;
        l = (g >>> 0 > j >>> 0 ? g : j) + -1 + (0 - f) | 0;
        hd(f | 0, 0, l + 8 & -8 | 0) | 0;
        f = j + (l >>> 3 << 3) | 0;
      }

      l = dd(2, 0, i | 0) | 0;
      Eb(l | c, G() | 0 | h, d, f);
      l = f + (k << 3) | 0;
      j = dd(3, 0, i | 0) | 0;
      Eb(j | c, G() | 0 | h, d, l);
      l = l + (k << 3) | 0;
      j = dd(4, 0, i | 0) | 0;
      Eb(j | c, G() | 0 | h, d, l);
      l = l + (k << 3) | 0;
      j = dd(5, 0, i | 0) | 0;
      Eb(j | c, G() | 0 | h, d, l);
      j = dd(6, 0, i | 0) | 0;
      Eb(j | c, G() | 0 | h, d, l + (k << 3) | 0);
      return;
    }

    function Fb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0;
      e = cd(a | 0, b | 0, 45) | 0;
      G() | 0;

      if (!(la(e & 127) | 0)) {
        e = 0;
        return e | 0;
      }

      e = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      e = e & 15;

      a: do { if (!e) { c = 0; }else {
        d = 1;

        while (1) {
          c = cd(a | 0, b | 0, (15 - d | 0) * 3 | 0) | 0;
          G() | 0;
          c = c & 7;
          if (c | 0) { break a; }
          if (d >>> 0 < e >>> 0) { d = d + 1 | 0; }else {
            c = 0;
            break;
          }
        }
      } } while (0);

      e = (c | 0) == 0 & 1;
      return e | 0;
    }

    function Gb(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      d = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      d = d & 15;

      if ((c | 0) < 16 & (d | 0) <= (c | 0)) {
        if ((d | 0) != (c | 0)) {
          e = dd(c | 0, 0, 52) | 0;
          a = e | a;
          b = G() | 0 | b & -15728641;
          if ((d | 0) < (c | 0)) { do {
            e = dd(7, 0, (14 - d | 0) * 3 | 0) | 0;
            d = d + 1 | 0;
            a = a & ~e;
            b = b & ~(G() | 0);
          } while ((d | 0) < (c | 0)); }
        }
      } else {
        b = 0;
        a = 0;
      }

      F(b | 0);
      return a | 0;
    }

    function Hb(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0,
          z = 0;

      if (!d) {
        y = 0;
        return y | 0;
      }

      f = a;
      e = b[f >> 2] | 0;
      f = b[f + 4 >> 2] | 0;

      if (0 == 0 & (f & 15728640 | 0) == 0) {
        if ((d | 0) <= 0) {
          y = 0;
          return y | 0;
        }

        y = c;
        b[y >> 2] = e;
        b[y + 4 >> 2] = f;

        if ((d | 0) == 1) {
          y = 0;
          return y | 0;
        }

        e = 1;

        do {
          w = a + (e << 3) | 0;
          x = b[w + 4 >> 2] | 0;
          y = c + (e << 3) | 0;
          b[y >> 2] = b[w >> 2];
          b[y + 4 >> 2] = x;
          e = e + 1 | 0;
        } while ((e | 0) != (d | 0));

        e = 0;
        return e | 0;
      }

      w = d << 3;
      x = Wc(w) | 0;

      if (!x) {
        y = -3;
        return y | 0;
      }

      gd(x | 0, a | 0, w | 0) | 0;
      v = Yc(d, 8) | 0;

      if (!v) {
        Xc(x);
        y = -3;
        return y | 0;
      }

      e = d;

      a: while (1) {
        h = x;
        l = b[h >> 2] | 0;
        h = b[h + 4 >> 2] | 0;
        t = cd(l | 0, h | 0, 52) | 0;
        G() | 0;
        t = t & 15;
        u = t + -1 | 0;
        s = (e | 0) > 0;

        b: do { if (s) {
          r = ((e | 0) < 0) << 31 >> 31;
          p = dd(u | 0, 0, 52) | 0;
          q = G() | 0;

          if (u >>> 0 > 15) {
            f = 0;
            a = l;
            d = h;

            while (1) {
              if (!((a | 0) == 0 & (d | 0) == 0)) {
                g = cd(a | 0, d | 0, 52) | 0;
                G() | 0;
                g = g & 15;
                i = (g | 0) < (u | 0);
                g = (g | 0) == (u | 0);
                k = i ? 0 : g ? a : 0;
                a = i ? 0 : g ? d : 0;
                d = bd(k | 0, a | 0, e | 0, r | 0) | 0;
                G() | 0;
                g = v + (d << 3) | 0;
                i = g;
                j = b[i >> 2] | 0;
                i = b[i + 4 >> 2] | 0;
                if ((j | 0) == 0 & (i | 0) == 0) { d = k; }else {
                  p = 0;
                  o = d;
                  n = i;
                  d = k;

                  while (1) {
                    if ((p | 0) > (e | 0)) {
                      y = 41;
                      break a;
                    }

                    if ((j | 0) == (d | 0) & (n & -117440513 | 0) == (a | 0)) {
                      k = cd(j | 0, n | 0, 56) | 0;
                      G() | 0;
                      k = k & 7;
                      m = k + 1 | 0;
                      q = cd(j | 0, n | 0, 45) | 0;
                      G() | 0;

                      c: do { if (!(la(q & 127) | 0)) { i = 7; }else {
                        j = cd(j | 0, n | 0, 52) | 0;
                        G() | 0;
                        j = j & 15;

                        if (!j) {
                          i = 6;
                          break;
                        }

                        i = 1;

                        while (1) {
                          q = dd(7, 0, (15 - i | 0) * 3 | 0) | 0;

                          if (!((q & d | 0) == 0 & ((G() | 0) & a | 0) == 0)) {
                            i = 7;
                            break c;
                          }

                          if (i >>> 0 < j >>> 0) { i = i + 1 | 0; }else {
                            i = 6;
                            break;
                          }
                        }
                      } } while (0);

                      if ((k + 2 | 0) >>> 0 > i >>> 0) {
                        y = 51;
                        break a;
                      }

                      q = dd(m | 0, 0, 56) | 0;
                      a = G() | 0 | a & -117440513;
                      i = g;
                      b[i >> 2] = 0;
                      b[i + 4 >> 2] = 0;
                      i = o;
                      d = q | d;
                    } else { i = (o + 1 | 0) % (e | 0) | 0; }

                    g = v + (i << 3) | 0;
                    n = g;
                    j = b[n >> 2] | 0;
                    n = b[n + 4 >> 2] | 0;
                    if ((j | 0) == 0 & (n | 0) == 0) { break; }else {
                      p = p + 1 | 0;
                      o = i;
                    }
                  }
                }
                q = g;
                b[q >> 2] = d;
                b[q + 4 >> 2] = a;
              }

              f = f + 1 | 0;
              if ((f | 0) >= (e | 0)) { break b; }
              d = x + (f << 3) | 0;
              a = b[d >> 2] | 0;
              d = b[d + 4 >> 2] | 0;
            }
          }

          f = 0;
          a = l;
          d = h;

          while (1) {
            if (!((a | 0) == 0 & (d | 0) == 0)) {
              i = cd(a | 0, d | 0, 52) | 0;
              G() | 0;
              i = i & 15;

              if ((i | 0) >= (u | 0)) {
                if ((i | 0) != (u | 0)) {
                  a = a | p;
                  d = d & -15728641 | q;

                  if (i >>> 0 >= t >>> 0) {
                    g = u;

                    do {
                      o = dd(7, 0, (14 - g | 0) * 3 | 0) | 0;
                      g = g + 1 | 0;
                      a = o | a;
                      d = G() | 0 | d;
                    } while (g >>> 0 < i >>> 0);
                  }
                }
              } else {
                a = 0;
                d = 0;
              }

              i = bd(a | 0, d | 0, e | 0, r | 0) | 0;
              G() | 0;
              g = v + (i << 3) | 0;
              j = g;
              k = b[j >> 2] | 0;
              j = b[j + 4 >> 2] | 0;

              if (!((k | 0) == 0 & (j | 0) == 0)) {
                o = 0;

                while (1) {
                  if ((o | 0) > (e | 0)) {
                    y = 41;
                    break a;
                  }

                  if ((k | 0) == (a | 0) & (j & -117440513 | 0) == (d | 0)) {
                    m = cd(k | 0, j | 0, 56) | 0;
                    G() | 0;
                    m = m & 7;
                    n = m + 1 | 0;
                    z = cd(k | 0, j | 0, 45) | 0;
                    G() | 0;

                    d: do { if (!(la(z & 127) | 0)) { j = 7; }else {
                      k = cd(k | 0, j | 0, 52) | 0;
                      G() | 0;
                      k = k & 15;

                      if (!k) {
                        j = 6;
                        break;
                      }

                      j = 1;

                      while (1) {
                        z = dd(7, 0, (15 - j | 0) * 3 | 0) | 0;

                        if (!((z & a | 0) == 0 & ((G() | 0) & d | 0) == 0)) {
                          j = 7;
                          break d;
                        }

                        if (j >>> 0 < k >>> 0) { j = j + 1 | 0; }else {
                          j = 6;
                          break;
                        }
                      }
                    } } while (0);

                    if ((m + 2 | 0) >>> 0 > j >>> 0) {
                      y = 51;
                      break a;
                    }

                    z = dd(n | 0, 0, 56) | 0;
                    d = G() | 0 | d & -117440513;
                    n = g;
                    b[n >> 2] = 0;
                    b[n + 4 >> 2] = 0;
                    a = z | a;
                  } else { i = (i + 1 | 0) % (e | 0) | 0; }

                  g = v + (i << 3) | 0;
                  j = g;
                  k = b[j >> 2] | 0;
                  j = b[j + 4 >> 2] | 0;
                  if ((k | 0) == 0 & (j | 0) == 0) { break; }else { o = o + 1 | 0; }
                }
              }

              z = g;
              b[z >> 2] = a;
              b[z + 4 >> 2] = d;
            }

            f = f + 1 | 0;
            if ((f | 0) >= (e | 0)) { break b; }
            d = x + (f << 3) | 0;
            a = b[d >> 2] | 0;
            d = b[d + 4 >> 2] | 0;
          }
        } } while (0);

        if ((e + 5 | 0) >>> 0 < 11) {
          y = 99;
          break;
        }

        q = Yc((e | 0) / 6 | 0, 8) | 0;

        if (!q) {
          y = 58;
          break;
        }

        e: do { if (s) {
          o = 0;
          n = 0;

          do {
            i = v + (o << 3) | 0;
            a = i;
            f = b[a >> 2] | 0;
            a = b[a + 4 >> 2] | 0;

            if (!((f | 0) == 0 & (a | 0) == 0)) {
              j = cd(f | 0, a | 0, 56) | 0;
              G() | 0;
              j = j & 7;
              d = j + 1 | 0;
              k = a & -117440513;
              z = cd(f | 0, a | 0, 45) | 0;
              G() | 0;

              f: do { if (la(z & 127) | 0) {
                m = cd(f | 0, a | 0, 52) | 0;
                G() | 0;
                m = m & 15;

                if (m | 0) {
                  g = 1;

                  while (1) {
                    z = dd(7, 0, (15 - g | 0) * 3 | 0) | 0;
                    if (!((f & z | 0) == 0 & (k & (G() | 0) | 0) == 0)) { break f; }
                    if (g >>> 0 < m >>> 0) { g = g + 1 | 0; }else { break; }
                  }
                }

                a = dd(d | 0, 0, 56) | 0;
                f = a | f;
                a = G() | 0 | k;
                d = i;
                b[d >> 2] = f;
                b[d + 4 >> 2] = a;
                d = j + 2 | 0;
              } } while (0);

              if ((d | 0) == 7) {
                z = q + (n << 3) | 0;
                b[z >> 2] = f;
                b[z + 4 >> 2] = a & -117440513;
                n = n + 1 | 0;
              }
            }

            o = o + 1 | 0;
          } while ((o | 0) != (e | 0));

          if (s) {
            p = ((e | 0) < 0) << 31 >> 31;
            m = dd(u | 0, 0, 52) | 0;
            o = G() | 0;

            if (u >>> 0 > 15) {
              a = 0;
              f = 0;

              while (1) {
                do { if (!((l | 0) == 0 & (h | 0) == 0)) {
                  j = cd(l | 0, h | 0, 52) | 0;
                  G() | 0;
                  j = j & 15;
                  g = (j | 0) < (u | 0);
                  j = (j | 0) == (u | 0);
                  i = g ? 0 : j ? l : 0;
                  j = g ? 0 : j ? h : 0;
                  g = bd(i | 0, j | 0, e | 0, p | 0) | 0;
                  G() | 0;
                  d = 0;

                  while (1) {
                    if ((d | 0) > (e | 0)) {
                      y = 98;
                      break a;
                    }

                    z = v + (g << 3) | 0;
                    k = b[z + 4 >> 2] | 0;

                    if ((k & -117440513 | 0) == (j | 0) ? (b[z >> 2] | 0) == (i | 0) : 0) {
                      y = 70;
                      break;
                    }

                    g = (g + 1 | 0) % (e | 0) | 0;
                    z = v + (g << 3) | 0;
                    if ((b[z >> 2] | 0) == (i | 0) ? (b[z + 4 >> 2] | 0) == (j | 0) : 0) { break; }else { d = d + 1 | 0; }
                  }

                  if ((y | 0) == 70 ? (y = 0, 0 == 0 & (k & 117440512 | 0) == 100663296) : 0) { break; }
                  z = c + (f << 3) | 0;
                  b[z >> 2] = l;
                  b[z + 4 >> 2] = h;
                  f = f + 1 | 0;
                } } while (0);

                a = a + 1 | 0;

                if ((a | 0) >= (e | 0)) {
                  e = n;
                  break e;
                }

                h = x + (a << 3) | 0;
                l = b[h >> 2] | 0;
                h = b[h + 4 >> 2] | 0;
              }
            }

            a = 0;
            f = 0;

            while (1) {
              do { if (!((l | 0) == 0 & (h | 0) == 0)) {
                j = cd(l | 0, h | 0, 52) | 0;
                G() | 0;
                j = j & 15;
                if ((j | 0) >= (u | 0)) {
                  if ((j | 0) != (u | 0)) {
                    d = l | m;
                    g = h & -15728641 | o;
                    if (j >>> 0 < t >>> 0) { j = g; }else {
                      i = u;

                      do {
                        z = dd(7, 0, (14 - i | 0) * 3 | 0) | 0;
                        i = i + 1 | 0;
                        d = z | d;
                        g = G() | 0 | g;
                      } while (i >>> 0 < j >>> 0);

                      j = g;
                    }
                  } else {
                    d = l;
                    j = h;
                  }
                } else {
                  d = 0;
                  j = 0;
                }
                i = bd(d | 0, j | 0, e | 0, p | 0) | 0;
                G() | 0;
                g = 0;

                while (1) {
                  if ((g | 0) > (e | 0)) {
                    y = 98;
                    break a;
                  }

                  z = v + (i << 3) | 0;
                  k = b[z + 4 >> 2] | 0;

                  if ((k & -117440513 | 0) == (j | 0) ? (b[z >> 2] | 0) == (d | 0) : 0) {
                    y = 93;
                    break;
                  }

                  i = (i + 1 | 0) % (e | 0) | 0;
                  z = v + (i << 3) | 0;
                  if ((b[z >> 2] | 0) == (d | 0) ? (b[z + 4 >> 2] | 0) == (j | 0) : 0) { break; }else { g = g + 1 | 0; }
                }

                if ((y | 0) == 93 ? (y = 0, 0 == 0 & (k & 117440512 | 0) == 100663296) : 0) { break; }
                z = c + (f << 3) | 0;
                b[z >> 2] = l;
                b[z + 4 >> 2] = h;
                f = f + 1 | 0;
              } } while (0);

              a = a + 1 | 0;

              if ((a | 0) >= (e | 0)) {
                e = n;
                break e;
              }

              h = x + (a << 3) | 0;
              l = b[h >> 2] | 0;
              h = b[h + 4 >> 2] | 0;
            }
          } else {
            f = 0;
            e = n;
          }
        } else {
          f = 0;
          e = 0;
        } } while (0);

        hd(v | 0, 0, w | 0) | 0;
        gd(x | 0, q | 0, e << 3 | 0) | 0;
        Xc(q);
        if (!e) { break; }else { c = c + (f << 3) | 0; }
      }

      if ((y | 0) == 41) {
        Xc(x);
        Xc(v);
        z = -1;
        return z | 0;
      } else if ((y | 0) == 51) {
        Xc(x);
        Xc(v);
        z = -2;
        return z | 0;
      } else if ((y | 0) == 58) {
        Xc(x);
        Xc(v);
        z = -3;
        return z | 0;
      } else if ((y | 0) == 98) {
        Xc(q);
        Xc(x);
        Xc(v);
        z = -1;
        return z | 0;
      } else if ((y | 0) == 99) { gd(c | 0, x | 0, e << 3 | 0) | 0; }

      Xc(x);
      Xc(v);
      z = 0;
      return z | 0;
    }

    function Ib(a, c, d, e, f) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      f = f | 0;
      var g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0;

      if ((c | 0) <= 0) {
        f = 0;
        return f | 0;
      }

      if ((f | 0) >= 16) {
        g = 0;

        while (1) {
          l = a + (g << 3) | 0;

          if (!((b[l >> 2] | 0) == 0 & (b[l + 4 >> 2] | 0) == 0)) {
            g = 14;
            break;
          }

          g = g + 1 | 0;

          if ((g | 0) >= (c | 0)) {
            h = 0;
            g = 16;
            break;
          }
        }

        if ((g | 0) == 14) { return ((e | 0) > 0 ? -2 : -1) | 0; }else if ((g | 0) == 16) { return h | 0; }
      }

      g = 0;
      l = 0;

      a: while (1) {
        k = a + (l << 3) | 0;
        i = k;
        h = b[i >> 2] | 0;
        i = b[i + 4 >> 2] | 0;

        do { if (!((h | 0) == 0 & (i | 0) == 0)) {
          if ((g | 0) >= (e | 0)) {
            h = -1;
            g = 16;
            break a;
          }

          j = cd(h | 0, i | 0, 52) | 0;
          G() | 0;
          j = j & 15;

          if ((j | 0) > (f | 0)) {
            h = -2;
            g = 16;
            break a;
          }

          if ((j | 0) == (f | 0)) {
            k = d + (g << 3) | 0;
            b[k >> 2] = h;
            b[k + 4 >> 2] = i;
            g = g + 1 | 0;
            break;
          }

          h = (tc(7, f - j | 0) | 0) + g | 0;

          if ((h | 0) > (e | 0)) {
            h = -1;
            g = 16;
            break a;
          }

          Eb(b[k >> 2] | 0, b[k + 4 >> 2] | 0, f, d + (g << 3) | 0);
          g = h;
        } } while (0);

        l = l + 1 | 0;

        if ((l | 0) >= (c | 0)) {
          h = 0;
          g = 16;
          break;
        }
      }

      if ((g | 0) == 16) { return h | 0; }
      return 0;
    }

    function Jb(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0;

      if ((c | 0) <= 0) {
        d = 0;
        return d | 0;
      }

      if ((d | 0) >= 16) {
        e = 0;

        while (1) {
          h = a + (e << 3) | 0;

          if (!((b[h >> 2] | 0) == 0 & (b[h + 4 >> 2] | 0) == 0)) {
            e = -1;
            f = 13;
            break;
          }

          e = e + 1 | 0;

          if ((e | 0) >= (c | 0)) {
            e = 0;
            f = 13;
            break;
          }
        }

        if ((f | 0) == 13) { return e | 0; }
      }

      e = 0;
      h = 0;

      a: while (1) {
        f = a + (h << 3) | 0;
        g = b[f >> 2] | 0;
        f = b[f + 4 >> 2] | 0;

        do { if (!((g | 0) == 0 & (f | 0) == 0)) {
          f = cd(g | 0, f | 0, 52) | 0;
          G() | 0;
          f = f & 15;

          if ((f | 0) > (d | 0)) {
            e = -1;
            f = 13;
            break a;
          }

          if ((f | 0) == (d | 0)) {
            e = e + 1 | 0;
            break;
          } else {
            e = (tc(7, d - f | 0) | 0) + e | 0;
            break;
          }
        } } while (0);

        h = h + 1 | 0;

        if ((h | 0) >= (c | 0)) {
          f = 13;
          break;
        }
      }

      if ((f | 0) == 13) { return e | 0; }
      return 0;
    }

    function Kb(a, b) {
      a = a | 0;
      b = b | 0;
      b = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      return b & 1 | 0;
    }

    function Lb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0;
      e = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      e = e & 15;

      if (!e) {
        e = 0;
        return e | 0;
      }

      d = 1;

      while (1) {
        c = cd(a | 0, b | 0, (15 - d | 0) * 3 | 0) | 0;
        G() | 0;
        c = c & 7;

        if (c | 0) {
          d = 5;
          break;
        }

        if (d >>> 0 < e >>> 0) { d = d + 1 | 0; }else {
          c = 0;
          d = 5;
          break;
        }
      }

      if ((d | 0) == 5) { return c | 0; }
      return 0;
    }

    function Mb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      i = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      i = i & 15;

      if (!i) {
        h = b;
        i = a;
        F(h | 0);
        return i | 0;
      }

      h = 1;
      c = 0;

      while (1) {
        f = (15 - h | 0) * 3 | 0;
        d = dd(7, 0, f | 0) | 0;
        e = G() | 0;
        g = cd(a | 0, b | 0, f | 0) | 0;
        G() | 0;
        f = dd(Pa(g & 7) | 0, 0, f | 0) | 0;
        g = G() | 0;
        a = f | a & ~d;
        b = g | b & ~e;

        a: do { if (!c) { if (!((f & d | 0) == 0 & (g & e | 0) == 0)) {
          d = cd(a | 0, b | 0, 52) | 0;
          G() | 0;
          d = d & 15;
          if (!d) { c = 1; }else {
            c = 1;

            b: while (1) {
              g = cd(a | 0, b | 0, (15 - c | 0) * 3 | 0) | 0;
              G() | 0;

              switch (g & 7) {
                case 1:
                  break b;

                case 0:
                  break;

                default:
                  {
                    c = 1;
                    break a;
                  }
              }

              if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else {
                c = 1;
                break a;
              }
            }

            c = 1;

            while (1) {
              g = (15 - c | 0) * 3 | 0;
              e = cd(a | 0, b | 0, g | 0) | 0;
              G() | 0;
              f = dd(7, 0, g | 0) | 0;
              b = b & ~(G() | 0);
              g = dd(Pa(e & 7) | 0, 0, g | 0) | 0;
              a = a & ~f | g;
              b = b | (G() | 0);
              if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else {
                c = 1;
                break;
              }
            }
          }
        } else { c = 0; } } } while (0);

        if (h >>> 0 < i >>> 0) { h = h + 1 | 0; }else { break; }
      }

      F(b | 0);
      return a | 0;
    }

    function Nb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0;
      d = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      d = d & 15;

      if (!d) {
        c = b;
        d = a;
        F(c | 0);
        return d | 0;
      }

      c = 1;

      while (1) {
        f = (15 - c | 0) * 3 | 0;
        g = cd(a | 0, b | 0, f | 0) | 0;
        G() | 0;
        e = dd(7, 0, f | 0) | 0;
        b = b & ~(G() | 0);
        f = dd(Pa(g & 7) | 0, 0, f | 0) | 0;
        a = f | a & ~e;
        b = G() | 0 | b;
        if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else { break; }
      }

      F(b | 0);
      return a | 0;
    }

    function Ob(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      i = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      i = i & 15;

      if (!i) {
        h = b;
        i = a;
        F(h | 0);
        return i | 0;
      }

      h = 1;
      c = 0;

      while (1) {
        f = (15 - h | 0) * 3 | 0;
        d = dd(7, 0, f | 0) | 0;
        e = G() | 0;
        g = cd(a | 0, b | 0, f | 0) | 0;
        G() | 0;
        f = dd(Qa(g & 7) | 0, 0, f | 0) | 0;
        g = G() | 0;
        a = f | a & ~d;
        b = g | b & ~e;

        a: do { if (!c) { if (!((f & d | 0) == 0 & (g & e | 0) == 0)) {
          d = cd(a | 0, b | 0, 52) | 0;
          G() | 0;
          d = d & 15;
          if (!d) { c = 1; }else {
            c = 1;

            b: while (1) {
              g = cd(a | 0, b | 0, (15 - c | 0) * 3 | 0) | 0;
              G() | 0;

              switch (g & 7) {
                case 1:
                  break b;

                case 0:
                  break;

                default:
                  {
                    c = 1;
                    break a;
                  }
              }

              if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else {
                c = 1;
                break a;
              }
            }

            c = 1;

            while (1) {
              e = (15 - c | 0) * 3 | 0;
              f = dd(7, 0, e | 0) | 0;
              g = b & ~(G() | 0);
              b = cd(a | 0, b | 0, e | 0) | 0;
              G() | 0;
              b = dd(Qa(b & 7) | 0, 0, e | 0) | 0;
              a = a & ~f | b;
              b = g | (G() | 0);
              if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else {
                c = 1;
                break;
              }
            }
          }
        } else { c = 0; } } } while (0);

        if (h >>> 0 < i >>> 0) { h = h + 1 | 0; }else { break; }
      }

      F(b | 0);
      return a | 0;
    }

    function Pb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0;
      d = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      d = d & 15;

      if (!d) {
        c = b;
        d = a;
        F(c | 0);
        return d | 0;
      }

      c = 1;

      while (1) {
        g = (15 - c | 0) * 3 | 0;
        f = dd(7, 0, g | 0) | 0;
        e = b & ~(G() | 0);
        b = cd(a | 0, b | 0, g | 0) | 0;
        G() | 0;
        b = dd(Qa(b & 7) | 0, 0, g | 0) | 0;
        a = b | a & ~f;
        b = G() | 0 | e;
        if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else { break; }
      }

      F(b | 0);
      return a | 0;
    }

    function Qb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0;
      j = S;
      S = S + 64 | 0;
      i = j + 40 | 0;
      e = j + 24 | 0;
      f = j + 12 | 0;
      g = j;
      dd(c | 0, 0, 52) | 0;
      d = G() | 0 | 134225919;

      if (!c) {
        if ((b[a + 4 >> 2] | 0) > 2) {
          h = 0;
          i = 0;
          F(h | 0);
          S = j;
          return i | 0;
        }

        if ((b[a + 8 >> 2] | 0) > 2) {
          h = 0;
          i = 0;
          F(h | 0);
          S = j;
          return i | 0;
        }

        if ((b[a + 12 >> 2] | 0) > 2) {
          h = 0;
          i = 0;
          F(h | 0);
          S = j;
          return i | 0;
        }

        dd(na(a) | 0, 0, 45) | 0;
        h = G() | 0 | d;
        i = -1;
        F(h | 0);
        S = j;
        return i | 0;
      }
      b[i >> 2] = b[a >> 2];
      b[i + 4 >> 2] = b[a + 4 >> 2];
      b[i + 8 >> 2] = b[a + 8 >> 2];
      b[i + 12 >> 2] = b[a + 12 >> 2];
      h = i + 4 | 0;

      if ((c | 0) > 0) {
        a = -1;

        while (1) {
          b[e >> 2] = b[h >> 2];
          b[e + 4 >> 2] = b[h + 4 >> 2];
          b[e + 8 >> 2] = b[h + 8 >> 2];

          if (!(c & 1)) {
            Ja(h);
            b[f >> 2] = b[h >> 2];
            b[f + 4 >> 2] = b[h + 4 >> 2];
            b[f + 8 >> 2] = b[h + 8 >> 2];
            La(f);
          } else {
            Ia(h);
            b[f >> 2] = b[h >> 2];
            b[f + 4 >> 2] = b[h + 4 >> 2];
            b[f + 8 >> 2] = b[h + 8 >> 2];
            Ka(f);
          }

          Fa(e, f, g);
          Ca(g);
          l = (15 - c | 0) * 3 | 0;
          k = dd(7, 0, l | 0) | 0;
          d = d & ~(G() | 0);
          l = dd(Ha(g) | 0, 0, l | 0) | 0;
          a = l | a & ~k;
          d = G() | 0 | d;
          if ((c | 0) > 1) { c = c + -1 | 0; }else { break; }
        }
      } else { a = -1; }

      a: do { if (((b[h >> 2] | 0) <= 2 ? (b[i + 8 >> 2] | 0) <= 2 : 0) ? (b[i + 12 >> 2] | 0) <= 2 : 0) {
        e = na(i) | 0;
        c = dd(e | 0, 0, 45) | 0;
        c = c | a;
        a = G() | 0 | d & -1040385;
        g = oa(i) | 0;

        if (!(la(e) | 0)) {
          if ((g | 0) <= 0) { break; }
          f = 0;

          while (1) {
            e = cd(c | 0, a | 0, 52) | 0;
            G() | 0;
            e = e & 15;

            if (e) {
              d = 1;

              while (1) {
                l = (15 - d | 0) * 3 | 0;
                i = cd(c | 0, a | 0, l | 0) | 0;
                G() | 0;
                k = dd(7, 0, l | 0) | 0;
                a = a & ~(G() | 0);
                l = dd(Pa(i & 7) | 0, 0, l | 0) | 0;
                c = c & ~k | l;
                a = a | (G() | 0);
                if (d >>> 0 < e >>> 0) { d = d + 1 | 0; }else { break; }
              }
            }

            f = f + 1 | 0;
            if ((f | 0) == (g | 0)) { break a; }
          }
        }

        f = cd(c | 0, a | 0, 52) | 0;
        G() | 0;
        f = f & 15;

        b: do { if (f) {
          d = 1;

          c: while (1) {
            l = cd(c | 0, a | 0, (15 - d | 0) * 3 | 0) | 0;
            G() | 0;

            switch (l & 7) {
              case 1:
                break c;

              case 0:
                break;

              default:
                break b;
            }

            if (d >>> 0 < f >>> 0) { d = d + 1 | 0; }else { break b; }
          }

          if (ra(e, b[i >> 2] | 0) | 0) {
            d = 1;

            while (1) {
              i = (15 - d | 0) * 3 | 0;
              k = dd(7, 0, i | 0) | 0;
              l = a & ~(G() | 0);
              a = cd(c | 0, a | 0, i | 0) | 0;
              G() | 0;
              a = dd(Qa(a & 7) | 0, 0, i | 0) | 0;
              c = c & ~k | a;
              a = l | (G() | 0);
              if (d >>> 0 < f >>> 0) { d = d + 1 | 0; }else { break; }
            }
          } else {
            d = 1;

            while (1) {
              l = (15 - d | 0) * 3 | 0;
              i = cd(c | 0, a | 0, l | 0) | 0;
              G() | 0;
              k = dd(7, 0, l | 0) | 0;
              a = a & ~(G() | 0);
              l = dd(Pa(i & 7) | 0, 0, l | 0) | 0;
              c = c & ~k | l;
              a = a | (G() | 0);
              if (d >>> 0 < f >>> 0) { d = d + 1 | 0; }else { break; }
            }
          }
        } } while (0);

        if ((g | 0) > 0) {
          d = 0;

          do {
            c = Mb(c, a) | 0;
            a = G() | 0;
            d = d + 1 | 0;
          } while ((d | 0) != (g | 0));
        }
      } else {
        c = 0;
        a = 0;
      } } while (0);

      k = a;
      l = c;
      F(k | 0);
      S = j;
      return l | 0;
    }

    function Rb(a) {
      a = a | 0;
      return (a | 0) % 2 | 0 | 0;
    }

    function Sb(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      e = S;
      S = S + 16 | 0;
      d = e;

      if ((c >>> 0 <= 15 ? !((b[a + 4 >> 2] & 2146435072 | 0) == 2146435072) : 0) ? !((b[a + 8 + 4 >> 2] & 2146435072 | 0) == 2146435072) : 0) {
        Ya(a, c, d);
        c = Qb(d, c) | 0;
        a = G() | 0;
      } else {
        a = 0;
        c = 0;
      }

      F(a | 0);
      S = e;
      return c | 0;
    }

    function Tb(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0;
      f = d + 4 | 0;
      g = cd(a | 0, c | 0, 52) | 0;
      G() | 0;
      g = g & 15;
      h = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      e = (g | 0) == 0;

      if (!(la(h & 127) | 0)) {
        if (e) {
          h = 0;
          return h | 0;
        }

        if ((b[f >> 2] | 0) == 0 ? (b[d + 8 >> 2] | 0) == 0 : 0) { e = (b[d + 12 >> 2] | 0) != 0 & 1; }else { e = 1; }
      } else if (e) {
        h = 1;
        return h | 0;
      } else { e = 1; }

      d = 1;

      while (1) {
        if (!(d & 1)) { La(f); }else { Ka(f); }
        h = cd(a | 0, c | 0, (15 - d | 0) * 3 | 0) | 0;
        G() | 0;
        Ma(f, h & 7);
        if (d >>> 0 < g >>> 0) { d = d + 1 | 0; }else { break; }
      }

      return e | 0;
    }

    function Ub(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0;
      l = S;
      S = S + 16 | 0;
      j = l;
      k = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      k = k & 127;

      a: do { if ((la(k) | 0) != 0 ? (g = cd(a | 0, c | 0, 52) | 0, G() | 0, g = g & 15, (g | 0) != 0) : 0) {
        e = 1;

        b: while (1) {
          i = cd(a | 0, c | 0, (15 - e | 0) * 3 | 0) | 0;
          G() | 0;

          switch (i & 7) {
            case 5:
              break b;

            case 0:
              break;

            default:
              {
                e = c;
                break a;
              }
          }

          if (e >>> 0 < g >>> 0) { e = e + 1 | 0; }else {
            e = c;
            break a;
          }
        }

        f = 1;
        e = c;

        while (1) {
          c = (15 - f | 0) * 3 | 0;
          h = dd(7, 0, c | 0) | 0;
          i = e & ~(G() | 0);
          e = cd(a | 0, e | 0, c | 0) | 0;
          G() | 0;
          e = dd(Qa(e & 7) | 0, 0, c | 0) | 0;
          a = a & ~h | e;
          e = i | (G() | 0);
          if (f >>> 0 < g >>> 0) { f = f + 1 | 0; }else { break; }
        }
      } else { e = c; } } while (0);

      i = 7728 + (k * 28 | 0) | 0;
      b[d >> 2] = b[i >> 2];
      b[d + 4 >> 2] = b[i + 4 >> 2];
      b[d + 8 >> 2] = b[i + 8 >> 2];
      b[d + 12 >> 2] = b[i + 12 >> 2];

      if (!(Tb(a, e, d) | 0)) {
        S = l;
        return;
      }

      h = d + 4 | 0;
      b[j >> 2] = b[h >> 2];
      b[j + 4 >> 2] = b[h + 4 >> 2];
      b[j + 8 >> 2] = b[h + 8 >> 2];
      g = cd(a | 0, e | 0, 52) | 0;
      G() | 0;
      i = g & 15;
      if (!(g & 1)) { g = i; }else {
        La(h);
        g = i + 1 | 0;
      }
      if (!(la(k) | 0)) { e = 0; }else {
        c: do { if (!i) { e = 0; }else {
          c = 1;

          while (1) {
            f = cd(a | 0, e | 0, (15 - c | 0) * 3 | 0) | 0;
            G() | 0;
            f = f & 7;

            if (f | 0) {
              e = f;
              break c;
            }

            if (c >>> 0 < i >>> 0) { c = c + 1 | 0; }else {
              e = 0;
              break;
            }
          }
        } } while (0);

        e = (e | 0) == 4 & 1;
      }

      if (!(cb(d, g, e, 0) | 0)) {
        if ((g | 0) != (i | 0)) {
          b[h >> 2] = b[j >> 2];
          b[h + 4 >> 2] = b[j + 4 >> 2];
          b[h + 8 >> 2] = b[j + 8 >> 2];
        }
      } else {
        if (la(k) | 0) { do {} while ((cb(d, g, 0, 0) | 0) != 0); }
        if ((g | 0) != (i | 0)) { Ja(h); }
      }

      S = l;
      return;
    }

    function Vb(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      d = S;
      S = S + 16 | 0;
      e = d;
      Ub(a, b, e);
      b = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      $a(e, b & 15, c);
      S = d;
      return;
    }

    function Wb(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0;
      g = S;
      S = S + 16 | 0;
      f = g;
      Ub(a, b, f);
      d = cd(a | 0, b | 0, 45) | 0;
      G() | 0;
      d = (la(d & 127) | 0) == 0;
      e = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      e = e & 15;

      a: do { if (!d) {
        if (e | 0) {
          d = 1;

          while (1) {
            h = dd(7, 0, (15 - d | 0) * 3 | 0) | 0;
            if (!((h & a | 0) == 0 & ((G() | 0) & b | 0) == 0)) { break a; }
            if (d >>> 0 < e >>> 0) { d = d + 1 | 0; }else { break; }
          }
        }

        ab(f, e, 0, 5, c);
        S = g;
        return;
      } } while (0);

      eb(f, e, 0, 6, c);
      S = g;
      return;
    }

    function Xb(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0,
          d = 0,
          e = 0;
      d = cd(a | 0, b | 0, 45) | 0;
      G() | 0;

      if (!(la(d & 127) | 0)) {
        d = 2;
        return d | 0;
      }

      d = cd(a | 0, b | 0, 52) | 0;
      G() | 0;
      d = d & 15;

      if (!d) {
        d = 5;
        return d | 0;
      }

      c = 1;

      while (1) {
        e = dd(7, 0, (15 - c | 0) * 3 | 0) | 0;

        if (!((e & a | 0) == 0 & ((G() | 0) & b | 0) == 0)) {
          c = 2;
          a = 6;
          break;
        }

        if (c >>> 0 < d >>> 0) { c = c + 1 | 0; }else {
          c = 5;
          a = 6;
          break;
        }
      }

      if ((a | 0) == 6) { return c | 0; }
      return 0;
    }

    function Yb(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0;
      m = S;
      S = S + 128 | 0;
      k = m + 112 | 0;
      g = m + 96 | 0;
      l = m;
      f = cd(a | 0, c | 0, 52) | 0;
      G() | 0;
      i = f & 15;
      b[k >> 2] = i;
      h = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      h = h & 127;

      a: do { if (la(h) | 0) {
        if (i | 0) {
          e = 1;

          while (1) {
            j = dd(7, 0, (15 - e | 0) * 3 | 0) | 0;

            if (!((j & a | 0) == 0 & ((G() | 0) & c | 0) == 0)) {
              f = 0;
              break a;
            }

            if (e >>> 0 < i >>> 0) { e = e + 1 | 0; }else { break; }
          }
        }

        if (!(f & 1)) {
          j = dd(i + 1 | 0, 0, 52) | 0;
          l = G() | 0 | c & -15728641;
          k = dd(7, 0, (14 - i | 0) * 3 | 0) | 0;
          Yb((j | a) & ~k, l & ~(G() | 0), d);
          S = m;
          return;
        } else { f = 1; }
      } else { f = 0; } } while (0);

      Ub(a, c, g);

      if (f) {
        bb(g, k, l);
        j = 5;
      } else {
        fb(g, k, l);
        j = 6;
      }

      b: do { if (la(h) | 0) {
        if (!i) { e = 20; }else {
          e = 1;

          while (1) {
            h = dd(7, 0, (15 - e | 0) * 3 | 0) | 0;

            if (!((h & a | 0) == 0 & ((G() | 0) & c | 0) == 0)) {
              e = 8;
              break b;
            }

            if (e >>> 0 < i >>> 0) { e = e + 1 | 0; }else {
              e = 20;
              break;
            }
          }
        }
      } else { e = 8; } } while (0);

      hd(d | 0, -1, e | 0) | 0;

      if (f) {
        f = 0;

        do {
          g = l + (f << 4) | 0;
          db(g, b[k >> 2] | 0) | 0;
          g = b[g >> 2] | 0;
          e = 0;

          while (1) {
            h = d + (e << 2) | 0;
            i = b[h >> 2] | 0;
            if ((i | 0) == -1 | (i | 0) == (g | 0)) { break; }else { e = e + 1 | 0; }
          }

          b[h >> 2] = g;
          f = f + 1 | 0;
        } while ((f | 0) != (j | 0));
      } else {
        f = 0;

        do {
          g = l + (f << 4) | 0;
          cb(g, b[k >> 2] | 0, 0, 1) | 0;
          g = b[g >> 2] | 0;
          e = 0;

          while (1) {
            h = d + (e << 2) | 0;
            i = b[h >> 2] | 0;
            if ((i | 0) == -1 | (i | 0) == (g | 0)) { break; }else { e = e + 1 | 0; }
          }

          b[h >> 2] = g;
          f = f + 1 | 0;
        } while ((f | 0) != (j | 0));
      }

      S = m;
      return;
    }

    function Zb() {
      return 12;
    }

    function _b(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0;
      dd(a | 0, 0, 52) | 0;
      i = G() | 0 | 134225919;

      if ((a | 0) < 1) {
        e = 0;
        d = 0;

        do {
          if (la(e) | 0) {
            dd(e | 0, 0, 45) | 0;
            h = i | (G() | 0);
            a = c + (d << 3) | 0;
            b[a >> 2] = -1;
            b[a + 4 >> 2] = h;
            d = d + 1 | 0;
          }

          e = e + 1 | 0;
        } while ((e | 0) != 122);

        return;
      }

      h = 0;
      d = 0;

      do {
        if (la(h) | 0) {
          dd(h | 0, 0, 45) | 0;
          e = 1;
          f = -1;
          g = i | (G() | 0);

          while (1) {
            j = dd(7, 0, (15 - e | 0) * 3 | 0) | 0;
            f = f & ~j;
            g = g & ~(G() | 0);
            if ((e | 0) == (a | 0)) { break; }else { e = e + 1 | 0; }
          }

          j = c + (d << 3) | 0;
          b[j >> 2] = f;
          b[j + 4 >> 2] = g;
          d = d + 1 | 0;
        }

        h = h + 1 | 0;
      } while ((h | 0) != 122);

      return;
    }

    function $b(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0;
      i = S;
      S = S + 64 | 0;
      h = i;

      if ((a | 0) == (d | 0) & (c | 0) == (e | 0) | (0 != 0 | (c & 2013265920 | 0) != 134217728 | (0 != 0 | (e & 2013265920 | 0) != 134217728))) {
        h = 0;
        S = i;
        return h | 0;
      }

      f = cd(a | 0, c | 0, 52) | 0;
      G() | 0;
      f = f & 15;
      g = cd(d | 0, e | 0, 52) | 0;
      G() | 0;

      if ((f | 0) != (g & 15 | 0)) {
        h = 0;
        S = i;
        return h | 0;
      }

      g = f + -1 | 0;

      if (f >>> 0 > 1 ? (k = Cb(a, c, g) | 0, j = G() | 0, g = Cb(d, e, g) | 0, (k | 0) == (g | 0) & (j | 0) == (G() | 0)) : 0) {
        g = (f ^ 15) * 3 | 0;
        f = cd(a | 0, c | 0, g | 0) | 0;
        G() | 0;
        f = f & 7;
        g = cd(d | 0, e | 0, g | 0) | 0;
        G() | 0;
        g = g & 7;

        if ((f | 0) == 0 | (g | 0) == 0) {
          k = 1;
          S = i;
          return k | 0;
        }

        if ((b[21136 + (f << 2) >> 2] | 0) == (g | 0)) {
          k = 1;
          S = i;
          return k | 0;
        }

        if ((b[21168 + (f << 2) >> 2] | 0) == (g | 0)) {
          k = 1;
          S = i;
          return k | 0;
        }
      }

      f = h;
      g = f + 56 | 0;

      do {
        b[f >> 2] = 0;
        f = f + 4 | 0;
      } while ((f | 0) < (g | 0));

      $(a, c, 1, h);
      k = h;

      if (((((!((b[k >> 2] | 0) == (d | 0) ? (b[k + 4 >> 2] | 0) == (e | 0) : 0) ? (k = h + 8 | 0, !((b[k >> 2] | 0) == (d | 0) ? (b[k + 4 >> 2] | 0) == (e | 0) : 0)) : 0) ? (k = h + 16 | 0, !((b[k >> 2] | 0) == (d | 0) ? (b[k + 4 >> 2] | 0) == (e | 0) : 0)) : 0) ? (k = h + 24 | 0, !((b[k >> 2] | 0) == (d | 0) ? (b[k + 4 >> 2] | 0) == (e | 0) : 0)) : 0) ? (k = h + 32 | 0, !((b[k >> 2] | 0) == (d | 0) ? (b[k + 4 >> 2] | 0) == (e | 0) : 0)) : 0) ? (k = h + 40 | 0, !((b[k >> 2] | 0) == (d | 0) ? (b[k + 4 >> 2] | 0) == (e | 0) : 0)) : 0) {
        f = h + 48 | 0;
        f = ((b[f >> 2] | 0) == (d | 0) ? (b[f + 4 >> 2] | 0) == (e | 0) : 0) & 1;
      } else { f = 1; }

      k = f;
      S = i;
      return k | 0;
    }

    function ac(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0;
      k = S;
      S = S + 16 | 0;
      h = k;

      if (!($b(a, c, d, e) | 0)) {
        i = 0;
        j = 0;
        F(i | 0);
        S = k;
        return j | 0;
      }

      i = c & -2130706433;
      f = (Fb(a, c) | 0) == 0;
      f = f ? 1 : 2;

      while (1) {
        b[h >> 2] = 0;
        l = da(a, c, f, h) | 0;
        g = f + 1 | 0;
        if ((l | 0) == (d | 0) & (G() | 0) == (e | 0)) { break; }
        if (g >>> 0 < 7) { f = g; }else {
          f = 0;
          a = 0;
          j = 6;
          break;
        }
      }

      if ((j | 0) == 6) {
        F(f | 0);
        S = k;
        return a | 0;
      }

      l = dd(f | 0, 0, 56) | 0;
      j = i | (G() | 0) | 268435456;
      l = a | l;
      F(j | 0);
      S = k;
      return l | 0;
    }

    function bc(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0;
      c = 0 == 0 & (b & 2013265920 | 0) == 268435456;
      F((c ? b & -2130706433 | 134217728 : 0) | 0);
      return (c ? a : 0) | 0;
    }

    function cc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0;
      e = S;
      S = S + 16 | 0;
      d = e;

      if (!(0 == 0 & (c & 2013265920 | 0) == 268435456)) {
        c = 0;
        d = 0;
        F(c | 0);
        S = e;
        return d | 0;
      }

      f = cd(a | 0, c | 0, 56) | 0;
      G() | 0;
      b[d >> 2] = 0;
      d = da(a, c & -2130706433 | 134217728, f & 7, d) | 0;
      c = G() | 0;
      F(c | 0);
      S = e;
      return d | 0;
    }

    function dc(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0;

      if (!(0 == 0 & (b & 2013265920 | 0) == 268435456)) {
        c = 0;
        return c | 0;
      }

      c = cd(a | 0, b | 0, 56) | 0;
      G() | 0;

      switch (c & 7) {
        case 0:
        case 7:
          {
            c = 0;
            return c | 0;
          }

        default:

      }

      c = b & -2130706433 | 134217728;

      if (0 == 0 & (b & 117440512 | 0) == 16777216 & (Fb(a, c) | 0) != 0) {
        c = 0;
        return c | 0;
      }

      c = Bb(a, c) | 0;
      return c | 0;
    }

    function ec(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      g = S;
      S = S + 16 | 0;
      e = g;
      h = 0 == 0 & (c & 2013265920 | 0) == 268435456;
      f = c & -2130706433 | 134217728;
      i = d;
      b[i >> 2] = h ? a : 0;
      b[i + 4 >> 2] = h ? f : 0;

      if (h) {
        c = cd(a | 0, c | 0, 56) | 0;
        G() | 0;
        b[e >> 2] = 0;
        a = da(a, f, c & 7, e) | 0;
        c = G() | 0;
      } else {
        a = 0;
        c = 0;
      }

      i = d + 8 | 0;
      b[i >> 2] = a;
      b[i + 4 >> 2] = c;
      S = g;
      return;
    }

    function fc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0;
      f = (Fb(a, c) | 0) == 0;
      c = c & -2130706433;
      e = d;
      b[e >> 2] = f ? a : 0;
      b[e + 4 >> 2] = f ? c | 285212672 : 0;
      e = d + 8 | 0;
      b[e >> 2] = a;
      b[e + 4 >> 2] = c | 301989888;
      e = d + 16 | 0;
      b[e >> 2] = a;
      b[e + 4 >> 2] = c | 318767104;
      e = d + 24 | 0;
      b[e >> 2] = a;
      b[e + 4 >> 2] = c | 335544320;
      e = d + 32 | 0;
      b[e >> 2] = a;
      b[e + 4 >> 2] = c | 352321536;
      d = d + 40 | 0;
      b[d >> 2] = a;
      b[d + 4 >> 2] = c | 369098752;
      return;
    }

    function gc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = S;
      S = S + 16 | 0;
      g = h;
      e = cd(a | 0, c | 0, 56) | 0;
      G() | 0;
      i = 0 == 0 & (c & 2013265920 | 0) == 268435456;
      f = i ? a : 0;
      a = i ? c & -2130706433 | 134217728 : 0;
      c = Lc(f, a, e & 7) | 0;

      if ((c | 0) == -1) {
        b[d >> 2] = 0;
        S = h;
        return;
      }

      Ub(f, a, g);
      e = cd(f | 0, a | 0, 52) | 0;
      G() | 0;
      e = e & 15;
      if (!(Fb(f, a) | 0)) { eb(g, e, c, 2, d); }else { ab(g, e, c, 2, d); }
      S = h;
      return;
    }

    function hc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0;
      c = Yc(1, 12) | 0;
      if (!c) { H(22691, 22646, 49, 22704); }
      d = a + 4 | 0;
      e = b[d >> 2] | 0;

      if (e | 0) {
        e = e + 8 | 0;
        b[e >> 2] = c;
        b[d >> 2] = c;
        return c | 0;
      }

      if (b[a >> 2] | 0) { H(22721, 22646, 61, 22744); }
      e = a;
      b[e >> 2] = c;
      b[d >> 2] = c;
      return c | 0;
    }

    function ic(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0;
      e = Wc(24) | 0;
      if (!e) { H(22758, 22646, 78, 22772); }
      b[e >> 2] = b[c >> 2];
      b[e + 4 >> 2] = b[c + 4 >> 2];
      b[e + 8 >> 2] = b[c + 8 >> 2];
      b[e + 12 >> 2] = b[c + 12 >> 2];
      b[e + 16 >> 2] = 0;
      c = a + 4 | 0;
      d = b[c >> 2] | 0;

      if (d | 0) {
        b[d + 16 >> 2] = e;
        b[c >> 2] = e;
        return e | 0;
      }

      if (b[a >> 2] | 0) { H(22787, 22646, 82, 22772); }
      b[a >> 2] = e;
      b[c >> 2] = e;
      return e | 0;
    }

    function jc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0;
      if (!a) { return; }
      e = 1;

      while (1) {
        c = b[a >> 2] | 0;
        if (c | 0) { do {
          d = b[c >> 2] | 0;
          if (d | 0) { do {
            f = d;
            d = b[d + 16 >> 2] | 0;
            Xc(f);
          } while ((d | 0) != 0); }
          f = c;
          c = b[c + 8 >> 2] | 0;
          Xc(f);
        } while ((c | 0) != 0); }
        c = a;
        a = b[a + 8 >> 2] | 0;
        if (!e) { Xc(c); }
        if (!a) { break; }else { e = 0; }
      }

      return;
    }

    function kc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          f = 0,
          g = 0,
          h = 0.0,
          i = 0,
          j = 0.0,
          k = 0.0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          r = 0,
          s = 0.0,
          t = 0.0,
          u = 0.0,
          v = 0.0,
          w = 0.0,
          x = 0.0,
          y = 0,
          z = 0,
          A = 0,
          B = 0,
          C = 0,
          D = 0,
          E = 0,
          F = 0,
          G = 0,
          I = 0,
          J = 0,
          K = 0;
      g = a + 8 | 0;

      if (b[g >> 2] | 0) {
        K = 1;
        return K | 0;
      }

      f = b[a >> 2] | 0;

      if (!f) {
        K = 0;
        return K | 0;
      }

      c = f;
      d = 0;

      do {
        d = d + 1 | 0;
        c = b[c + 8 >> 2] | 0;
      } while ((c | 0) != 0);

      if (d >>> 0 < 2) {
        K = 0;
        return K | 0;
      }

      I = Wc(d << 2) | 0;
      if (!I) { H(22807, 22646, 317, 22826); }
      G = Wc(d << 5) | 0;
      if (!G) { H(22848, 22646, 321, 22826); }
      b[a >> 2] = 0;
      z = a + 4 | 0;
      b[z >> 2] = 0;
      b[g >> 2] = 0;
      d = 0;
      F = 0;
      y = 0;
      n = 0;

      a: while (1) {
        m = b[f >> 2] | 0;

        if (m) {
          h = 0.0;
          i = m;

          do {
            k = +e[i + 8 >> 3];
            c = i;
            i = b[i + 16 >> 2] | 0;
            l = (i | 0) == 0;
            g = l ? m : i;
            j = +e[g + 8 >> 3];

            if (+q(+(k - j)) > 3.141592653589793) {
              K = 14;
              break;
            }

            h = h + (j - k) * (+e[c >> 3] + +e[g >> 3]);
          } while (!l);

          if ((K | 0) == 14) {
            K = 0;
            h = 0.0;
            c = m;

            do {
              x = +e[c + 8 >> 3];
              E = c + 16 | 0;
              D = b[E >> 2] | 0;
              D = (D | 0) == 0 ? m : D;
              w = +e[D + 8 >> 3];
              h = h + (+e[c >> 3] + +e[D >> 3]) * ((w < 0.0 ? w + 6.283185307179586 : w) - (x < 0.0 ? x + 6.283185307179586 : x));
              c = b[((c | 0) == 0 ? f : E) >> 2] | 0;
            } while ((c | 0) != 0);
          }

          if (h > 0.0) {
            b[I + (F << 2) >> 2] = f;
            F = F + 1 | 0;
            g = y;
            c = n;
          } else { K = 19; }
        } else { K = 19; }

        if ((K | 0) == 19) {
          K = 0;

          do { if (!d) {
            if (!n) {
              if (!(b[a >> 2] | 0)) {
                g = z;
                i = a;
                c = f;
                d = a;
                break;
              } else {
                K = 27;
                break a;
              }
            } else {
              g = z;
              i = n + 8 | 0;
              c = f;
              d = a;
              break;
            }
          } else {
            c = d + 8 | 0;

            if (b[c >> 2] | 0) {
              K = 21;
              break a;
            }

            d = Yc(1, 12) | 0;

            if (!d) {
              K = 23;
              break a;
            }

            b[c >> 2] = d;
            g = d + 4 | 0;
            i = d;
            c = n;
          } } while (0);

          b[i >> 2] = f;
          b[g >> 2] = f;
          i = G + (y << 5) | 0;
          l = b[f >> 2] | 0;

          if (l) {
            m = G + (y << 5) + 8 | 0;
            e[m >> 3] = 1797693134862315708145274.0e284;
            n = G + (y << 5) + 24 | 0;
            e[n >> 3] = 1797693134862315708145274.0e284;
            e[i >> 3] = -1797693134862315708145274.0e284;
            o = G + (y << 5) + 16 | 0;
            e[o >> 3] = -1797693134862315708145274.0e284;
            u = 1797693134862315708145274.0e284;
            v = -1797693134862315708145274.0e284;
            g = 0;
            p = l;
            k = 1797693134862315708145274.0e284;
            s = 1797693134862315708145274.0e284;
            t = -1797693134862315708145274.0e284;
            j = -1797693134862315708145274.0e284;

            while (1) {
              h = +e[p >> 3];
              x = +e[p + 8 >> 3];
              p = b[p + 16 >> 2] | 0;
              r = (p | 0) == 0;
              w = +e[(r ? l : p) + 8 >> 3];

              if (h < k) {
                e[m >> 3] = h;
                k = h;
              }

              if (x < s) {
                e[n >> 3] = x;
                s = x;
              }

              if (h > t) { e[i >> 3] = h; }else { h = t; }

              if (x > j) {
                e[o >> 3] = x;
                j = x;
              }

              u = x > 0.0 & x < u ? x : u;
              v = x < 0.0 & x > v ? x : v;
              g = g | +q(+(x - w)) > 3.141592653589793;
              if (r) { break; }else { t = h; }
            }

            if (g) {
              e[o >> 3] = v;
              e[n >> 3] = u;
            }
          } else {
            b[i >> 2] = 0;
            b[i + 4 >> 2] = 0;
            b[i + 8 >> 2] = 0;
            b[i + 12 >> 2] = 0;
            b[i + 16 >> 2] = 0;
            b[i + 20 >> 2] = 0;
            b[i + 24 >> 2] = 0;
            b[i + 28 >> 2] = 0;
          }

          g = y + 1 | 0;
        }

        E = f + 8 | 0;
        f = b[E >> 2] | 0;
        b[E >> 2] = 0;

        if (!f) {
          K = 45;
          break;
        } else {
          y = g;
          n = c;
        }
      }

      if ((K | 0) == 21) { H(22624, 22646, 35, 22658); }else if ((K | 0) == 23) { H(22678, 22646, 37, 22658); }else if ((K | 0) == 27) { H(22721, 22646, 61, 22744); }else if ((K | 0) == 45) {
        b: do { if ((F | 0) > 0) {
          E = (g | 0) == 0;
          C = g << 2;
          D = (a | 0) == 0;
          B = 0;
          c = 0;

          while (1) {
            A = b[I + (B << 2) >> 2] | 0;

            if (!E) {
              y = Wc(C) | 0;

              if (!y) {
                K = 50;
                break;
              }

              z = Wc(C) | 0;

              if (!z) {
                K = 52;
                break;
              }

              c: do { if (!D) {
                g = 0;
                d = 0;
                i = a;

                while (1) {
                  f = G + (g << 5) | 0;

                  if (lc(b[i >> 2] | 0, f, b[A >> 2] | 0) | 0) {
                    b[y + (d << 2) >> 2] = i;
                    b[z + (d << 2) >> 2] = f;
                    r = d + 1 | 0;
                  } else { r = d; }

                  i = b[i + 8 >> 2] | 0;
                  if (!i) { break; }else {
                    g = g + 1 | 0;
                    d = r;
                  }
                }

                if ((r | 0) > 0) {
                  f = b[y >> 2] | 0;
                  if ((r | 0) == 1) { d = f; }else {
                    o = 0;
                    p = -1;
                    d = f;
                    n = f;

                    while (1) {
                      l = b[n >> 2] | 0;
                      f = 0;
                      i = 0;

                      while (1) {
                        g = b[b[y + (i << 2) >> 2] >> 2] | 0;
                        if ((g | 0) == (l | 0)) { m = f; }else { m = f + ((lc(g, b[z + (i << 2) >> 2] | 0, b[l >> 2] | 0) | 0) & 1) | 0; }
                        i = i + 1 | 0;
                        if ((i | 0) == (r | 0)) { break; }else { f = m; }
                      }

                      g = (m | 0) > (p | 0);
                      d = g ? n : d;
                      f = o + 1 | 0;
                      if ((f | 0) == (r | 0)) { break c; }
                      o = f;
                      p = g ? m : p;
                      n = b[y + (f << 2) >> 2] | 0;
                    }
                  }
                } else { d = 0; }
              } else { d = 0; } } while (0);

              Xc(y);
              Xc(z);

              if (d) {
                g = d + 4 | 0;
                f = b[g >> 2] | 0;

                if (!f) {
                  if (b[d >> 2] | 0) {
                    K = 70;
                    break;
                  }
                } else { d = f + 8 | 0; }

                b[d >> 2] = A;
                b[g >> 2] = A;
              } else { K = 73; }
            } else { K = 73; }

            if ((K | 0) == 73) {
              K = 0;
              c = b[A >> 2] | 0;
              if (c | 0) { do {
                z = c;
                c = b[c + 16 >> 2] | 0;
                Xc(z);
              } while ((c | 0) != 0); }
              Xc(A);
              c = 2;
            }

            B = B + 1 | 0;

            if ((B | 0) >= (F | 0)) {
              J = c;
              break b;
            }
          }

          if ((K | 0) == 50) { H(22863, 22646, 249, 22882); }else if ((K | 0) == 52) { H(22901, 22646, 252, 22882); }else if ((K | 0) == 70) { H(22721, 22646, 61, 22744); }
        } else { J = 0; } } while (0);

        Xc(I);
        Xc(G);
        K = J;
        return K | 0;
      }
      return 0;
    }

    function lc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var f = 0.0,
          g = 0.0,
          h = 0.0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0.0,
          m = 0;

      if (!(xa(c, d) | 0)) {
        a = 0;
        return a | 0;
      }

      c = wa(c) | 0;
      l = +e[d >> 3];
      f = +e[d + 8 >> 3];
      f = c & f < 0.0 ? f + 6.283185307179586 : f;
      a = b[a >> 2] | 0;

      if (!a) {
        a = 0;
        return a | 0;
      }

      if (c) {
        c = 0;
        d = a;

        a: while (1) {
          while (1) {
            i = +e[d >> 3];
            k = +e[d + 8 >> 3];
            d = d + 16 | 0;
            m = b[d >> 2] | 0;
            m = (m | 0) == 0 ? a : m;
            h = +e[m >> 3];
            g = +e[m + 8 >> 3];

            if (i > h) {
              j = i;
              i = k;
            } else {
              j = h;
              h = i;
              i = g;
              g = k;
            }

            if (!(l < h | l > j)) { break; }
            d = b[d >> 2] | 0;

            if (!d) {
              d = 22;
              break a;
            }
          }

          k = g < 0.0 ? g + 6.283185307179586 : g;
          i = i < 0.0 ? i + 6.283185307179586 : i;
          f = i == f | k == f ? f + -2.220446049250313e-16 : f;
          k = k + (l - h) / (j - h) * (i - k);
          if ((k < 0.0 ? k + 6.283185307179586 : k) > f) { c = c ^ 1; }
          d = b[d >> 2] | 0;

          if (!d) {
            d = 22;
            break;
          }
        }

        if ((d | 0) == 22) { return c | 0; }
      } else {
        c = 0;
        d = a;

        b: while (1) {
          while (1) {
            i = +e[d >> 3];
            k = +e[d + 8 >> 3];
            d = d + 16 | 0;
            m = b[d >> 2] | 0;
            m = (m | 0) == 0 ? a : m;
            h = +e[m >> 3];
            g = +e[m + 8 >> 3];

            if (i > h) {
              j = i;
              i = k;
            } else {
              j = h;
              h = i;
              i = g;
              g = k;
            }

            if (!(l < h | l > j)) { break; }
            d = b[d >> 2] | 0;

            if (!d) {
              d = 22;
              break b;
            }
          }

          f = i == f | g == f ? f + -2.220446049250313e-16 : f;
          if (g + (l - h) / (j - h) * (i - g) > f) { c = c ^ 1; }
          d = b[d >> 2] | 0;

          if (!d) {
            d = 22;
            break;
          }
        }

        if ((d | 0) == 22) { return c | 0; }
      }

      return 0;
    }

    function mc(c, d, e, f, g) {
      c = c | 0;
      d = d | 0;
      e = e | 0;
      f = f | 0;
      g = g | 0;
      var h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0;
      u = S;
      S = S + 32 | 0;
      t = u + 16 | 0;
      s = u;
      h = cd(c | 0, d | 0, 52) | 0;
      G() | 0;
      h = h & 15;
      p = cd(e | 0, f | 0, 52) | 0;
      G() | 0;

      if ((h | 0) != (p & 15 | 0)) {
        t = 1;
        S = u;
        return t | 0;
      }

      l = cd(c | 0, d | 0, 45) | 0;
      G() | 0;
      l = l & 127;
      m = cd(e | 0, f | 0, 45) | 0;
      G() | 0;
      m = m & 127;
      p = (l | 0) != (m | 0);

      if (p) {
        j = ta(l, m) | 0;

        if ((j | 0) == 7) {
          t = 2;
          S = u;
          return t | 0;
        }

        k = ta(m, l) | 0;
        if ((k | 0) == 7) { H(22925, 22949, 151, 22959); }else {
          q = j;
          i = k;
        }
      } else {
        q = 0;
        i = 0;
      }

      n = la(l) | 0;
      o = la(m) | 0;
      b[t >> 2] = 0;
      b[t + 4 >> 2] = 0;
      b[t + 8 >> 2] = 0;
      b[t + 12 >> 2] = 0;

      do { if (!q) {
        Tb(e, f, t) | 0;

        if ((n | 0) != 0 & (o | 0) != 0) {
          if ((m | 0) != (l | 0)) { H(23077, 22949, 243, 22959); }
          i = Lb(c, d) | 0;
          h = Lb(e, f) | 0;

          if (!(a[22032 + (i * 7 | 0) + h >> 0] | 0)) {
            i = b[21200 + (i * 28 | 0) + (h << 2) >> 2] | 0;

            if ((i | 0) > 0) {
              j = t + 4 | 0;
              h = 0;

              do {
                Oa(j);
                h = h + 1 | 0;
              } while ((h | 0) != (i | 0));

              r = 50;
            } else { r = 50; }
          } else { h = 5; }
        } else { r = 50; }
      } else {
        m = b[4304 + (l * 28 | 0) + (q << 2) >> 2] | 0;
        j = (m | 0) > 0;
        if (!o) {
          if (j) {
            l = 0;
            k = e;
            j = f;

            do {
              k = Pb(k, j) | 0;
              j = G() | 0;
              i = Qa(i) | 0;
              l = l + 1 | 0;
            } while ((l | 0) != (m | 0));

            m = i;
            l = k;
            k = j;
          } else {
            m = i;
            l = e;
            k = f;
          }
        } else if (j) {
          l = 0;
          k = e;
          j = f;

          do {
            k = Ob(k, j) | 0;
            j = G() | 0;
            i = Qa(i) | 0;
            if ((i | 0) == 1) { i = Qa(1) | 0; }
            l = l + 1 | 0;
          } while ((l | 0) != (m | 0));

          m = i;
          l = k;
          k = j;
        } else {
          m = i;
          l = e;
          k = f;
        }
        Tb(l, k, t) | 0;
        if (!p) { H(22972, 22949, 181, 22959); }
        j = (n | 0) != 0;
        i = (o | 0) != 0;
        if (j & i) { H(22999, 22949, 182, 22959); }
        if (!j) {
          if (i) {
            i = Lb(l, k) | 0;

            if (a[22032 + (i * 7 | 0) + m >> 0] | 0) {
              h = 4;
              break;
            }

            l = 0;
            k = b[21200 + (m * 28 | 0) + (i << 2) >> 2] | 0;
            r = 26;
          } else { i = 0; }
        } else {
          i = Lb(c, d) | 0;

          if (a[22032 + (i * 7 | 0) + q >> 0] | 0) {
            h = 3;
            break;
          }

          k = b[21200 + (i * 28 | 0) + (q << 2) >> 2] | 0;
          l = k;
          r = 26;
        }

        if ((r | 0) == 26) {
          if ((k | 0) <= -1) { H(23030, 22949, 212, 22959); }
          if ((l | 0) <= -1) { H(23053, 22949, 213, 22959); }

          if ((k | 0) > 0) {
            j = t + 4 | 0;
            i = 0;

            do {
              Oa(j);
              i = i + 1 | 0;
            } while ((i | 0) != (k | 0));

            i = l;
          } else { i = l; }
        }
        b[s >> 2] = 0;
        b[s + 4 >> 2] = 0;
        b[s + 8 >> 2] = 0;
        Ma(s, q);
        if (h | 0) { while (1) {
          if (!(Rb(h) | 0)) { La(s); }else { Ka(s); }
          if ((h | 0) > 1) { h = h + -1 | 0; }else { break; }
        } }

        if ((i | 0) > 0) {
          h = 0;

          do {
            Oa(s);
            h = h + 1 | 0;
          } while ((h | 0) != (i | 0));
        }

        r = t + 4 | 0;
        Ea(r, s, r);
        Ca(r);
        r = 50;
      } } while (0);

      if ((r | 0) == 50) {
        h = t + 4 | 0;
        b[g >> 2] = b[h >> 2];
        b[g + 4 >> 2] = b[h + 4 >> 2];
        b[g + 8 >> 2] = b[h + 8 >> 2];
        h = 0;
      }

      t = h;
      S = u;
      return t | 0;
    }

    function nc(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0;
      p = S;
      S = S + 48 | 0;
      h = p + 36 | 0;
      i = p + 24 | 0;
      j = p + 12 | 0;
      k = p;
      g = cd(a | 0, c | 0, 52) | 0;
      G() | 0;
      g = g & 15;
      n = cd(a | 0, c | 0, 45) | 0;
      G() | 0;
      n = n & 127;
      l = la(n) | 0;
      dd(g | 0, 0, 52) | 0;
      r = G() | 0 | 134225919;
      q = e;
      b[q >> 2] = -1;
      b[q + 4 >> 2] = r;

      if (!g) {
        if ((b[d >> 2] | 0) > 1) {
          r = 1;
          S = p;
          return r | 0;
        }

        if ((b[d + 4 >> 2] | 0) > 1) {
          r = 1;
          S = p;
          return r | 0;
        }

        if ((b[d + 8 >> 2] | 0) > 1) {
          r = 1;
          S = p;
          return r | 0;
        }

        f = sa(n, Ha(d) | 0) | 0;

        if ((f | 0) == 127) {
          r = 1;
          S = p;
          return r | 0;
        }

        o = dd(f | 0, 0, 45) | 0;
        q = G() | 0;
        n = e;
        q = b[n + 4 >> 2] & -1040385 | q;
        r = e;
        b[r >> 2] = b[n >> 2] | o;
        b[r + 4 >> 2] = q;
        r = 0;
        S = p;
        return r | 0;
      }
      b[h >> 2] = b[d >> 2];
      b[h + 4 >> 2] = b[d + 4 >> 2];
      b[h + 8 >> 2] = b[d + 8 >> 2];

      while (1) {
        b[i >> 2] = b[h >> 2];
        b[i + 4 >> 2] = b[h + 4 >> 2];
        b[i + 8 >> 2] = b[h + 8 >> 2];

        if (!(Rb(g) | 0)) {
          Ja(h);
          b[j >> 2] = b[h >> 2];
          b[j + 4 >> 2] = b[h + 4 >> 2];
          b[j + 8 >> 2] = b[h + 8 >> 2];
          La(j);
        } else {
          Ia(h);
          b[j >> 2] = b[h >> 2];
          b[j + 4 >> 2] = b[h + 4 >> 2];
          b[j + 8 >> 2] = b[h + 8 >> 2];
          Ka(j);
        }

        Fa(i, j, k);
        Ca(k);
        q = e;
        s = b[q >> 2] | 0;
        q = b[q + 4 >> 2] | 0;
        t = (15 - g | 0) * 3 | 0;
        d = dd(7, 0, t | 0) | 0;
        q = q & ~(G() | 0);
        t = dd(Ha(k) | 0, 0, t | 0) | 0;
        q = G() | 0 | q;
        r = e;
        b[r >> 2] = t | s & ~d;
        b[r + 4 >> 2] = q;
        if ((g | 0) > 1) { g = g + -1 | 0; }else { break; }
      }

      a: do { if (((b[h >> 2] | 0) <= 1 ? (b[h + 4 >> 2] | 0) <= 1 : 0) ? (b[h + 8 >> 2] | 0) <= 1 : 0) {
        g = Ha(h) | 0;
        i = sa(n, g) | 0;
        if ((i | 0) == 127) { k = 0; }else { k = la(i) | 0; }

        b: do { if (!g) {
          if ((l | 0) != 0 & (k | 0) != 0) {
            t = Lb(a, c) | 0;
            g = e;
            g = 21408 + (t * 28 | 0) + ((Lb(b[g >> 2] | 0, b[g + 4 >> 2] | 0) | 0) << 2) | 0;
            g = b[g >> 2] | 0;
            if ((g | 0) <= -1) { H(23201, 22949, 433, 23134); }

            if (!g) {
              f = i;
              g = 55;
            } else {
              h = e;
              f = 0;
              d = b[h >> 2] | 0;
              h = b[h + 4 >> 2] | 0;

              do {
                d = Nb(d, h) | 0;
                h = G() | 0;
                t = e;
                b[t >> 2] = d;
                b[t + 4 >> 2] = h;
                f = f + 1 | 0;
              } while ((f | 0) < (g | 0));

              f = i;
              g = 54;
            }
          } else {
            f = i;
            g = 54;
          }
        } else {
          if (l) {
            h = 21408 + ((Lb(a, c) | 0) * 28 | 0) + (g << 2) | 0;
            h = b[h >> 2] | 0;

            if ((h | 0) > 0) {
              d = 0;

              do {
                g = Pa(g) | 0;
                d = d + 1 | 0;
              } while ((d | 0) != (h | 0));
            }

            if ((g | 0) == 1) {
              f = 3;
              break a;
            }

            d = sa(n, g) | 0;
            if ((d | 0) == 127) { H(23104, 22949, 376, 23134); }

            if (!(la(d) | 0)) {
              o = h;
              m = g;
              f = d;
            } else { H(23147, 22949, 377, 23134); }
          } else {
            o = 0;
            m = g;
            f = i;
          }

          j = b[4304 + (n * 28 | 0) + (m << 2) >> 2] | 0;
          if ((j | 0) <= -1) { H(23178, 22949, 384, 23134); }

          if (!k) {
            if ((o | 0) <= -1) { H(23030, 22949, 417, 23134); }

            if (o | 0) {
              h = e;
              g = 0;
              d = b[h >> 2] | 0;
              h = b[h + 4 >> 2] | 0;

              do {
                d = Nb(d, h) | 0;
                h = G() | 0;
                t = e;
                b[t >> 2] = d;
                b[t + 4 >> 2] = h;
                g = g + 1 | 0;
              } while ((g | 0) < (o | 0));
            }

            if ((j | 0) <= 0) {
              g = 54;
              break;
            }

            h = e;
            g = 0;
            d = b[h >> 2] | 0;
            h = b[h + 4 >> 2] | 0;

            while (1) {
              d = Nb(d, h) | 0;
              h = G() | 0;
              t = e;
              b[t >> 2] = d;
              b[t + 4 >> 2] = h;
              g = g + 1 | 0;

              if ((g | 0) == (j | 0)) {
                g = 54;
                break b;
              }
            }
          }

          i = ta(f, n) | 0;
          if ((i | 0) == 7) { H(22925, 22949, 393, 23134); }
          g = e;
          d = b[g >> 2] | 0;
          g = b[g + 4 >> 2] | 0;

          if ((j | 0) > 0) {
            h = 0;

            do {
              d = Nb(d, g) | 0;
              g = G() | 0;
              t = e;
              b[t >> 2] = d;
              b[t + 4 >> 2] = g;
              h = h + 1 | 0;
            } while ((h | 0) != (j | 0));
          }

          d = Lb(d, g) | 0;
          t = ma(f) | 0;
          d = b[(t ? 21824 : 21616) + (i * 28 | 0) + (d << 2) >> 2] | 0;
          if ((d | 0) <= -1) { H(23030, 22949, 412, 23134); }
          if (!d) { g = 54; }else {
            i = e;
            g = 0;
            h = b[i >> 2] | 0;
            i = b[i + 4 >> 2] | 0;

            do {
              h = Mb(h, i) | 0;
              i = G() | 0;
              t = e;
              b[t >> 2] = h;
              b[t + 4 >> 2] = i;
              g = g + 1 | 0;
            } while ((g | 0) < (d | 0));

            g = 54;
          }
        } } while (0);

        if ((g | 0) == 54) { if (k) { g = 55; } }

        if ((g | 0) == 55) {
          t = e;

          if ((Lb(b[t >> 2] | 0, b[t + 4 >> 2] | 0) | 0) == 1) {
            f = 4;
            break;
          }
        }

        t = e;
        r = b[t >> 2] | 0;
        t = b[t + 4 >> 2] & -1040385;
        s = dd(f | 0, 0, 45) | 0;
        t = t | (G() | 0);
        f = e;
        b[f >> 2] = r | s;
        b[f + 4 >> 2] = t;
        f = 0;
      } else { f = 2; } } while (0);

      t = f;
      S = p;
      return t | 0;
    }

    function oc(a, b, c, d, e) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0;
      g = S;
      S = S + 16 | 0;
      f = g;
      a = mc(a, b, c, d, f) | 0;

      if (!a) {
        Ua(f, e);
        a = 0;
      }

      S = g;
      return a | 0;
    }

    function pc(a, b, c, d) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0;
      e = S;
      S = S + 16 | 0;
      f = e;
      Va(c, f);
      d = nc(a, b, f, d) | 0;
      S = e;
      return d | 0;
    }

    function qc(a, b, c, d) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0;
      g = S;
      S = S + 32 | 0;
      e = g + 12 | 0;
      f = g;
      if ((mc(a, b, a, b, e) | 0) == 0 ? (mc(a, b, c, d, f) | 0) == 0 : 0) { a = Ta(e, f) | 0; }else { a = -1; }
      S = g;
      return a | 0;
    }

    function rc(a, b, c, d) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0;
      g = S;
      S = S + 32 | 0;
      e = g + 12 | 0;
      f = g;
      if ((mc(a, b, a, b, e) | 0) == 0 ? (mc(a, b, c, d, f) | 0) == 0 : 0) { a = Ta(e, f) | 0; }else { a = -1; }
      S = g;
      return (a >>> 31 ^ 1) + a | 0;
    }

    function sc(a, c, d, e, f) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      f = f | 0;
      var g = 0,
          h = 0,
          i = 0.0,
          j = 0.0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0.0,
          p = 0.0,
          r = 0.0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0.0;
      x = S;
      S = S + 48 | 0;
      g = x + 24 | 0;
      h = x + 12 | 0;
      w = x;

      if ((mc(a, c, a, c, g) | 0) == 0 ? (mc(a, c, d, e, h) | 0) == 0 : 0) {
        v = Ta(g, h) | 0;

        if ((v | 0) < 0) {
          w = v;
          S = x;
          return w | 0;
        }
        b[g >> 2] = 0;
        b[g + 4 >> 2] = 0;
        b[g + 8 >> 2] = 0;
        b[h >> 2] = 0;
        b[h + 4 >> 2] = 0;
        b[h + 8 >> 2] = 0;
        mc(a, c, a, c, g) | 0;
        mc(a, c, d, e, h) | 0;
        Wa(g);
        Wa(h);

        if (!v) {
          e = g + 4 | 0;
          n = g + 8 | 0;
          s = e;
          t = n;
          u = g;
          d = b[g >> 2] | 0;
          e = b[e >> 2] | 0;
          g = b[n >> 2] | 0;
          p = 0.0;
          r = 0.0;
          o = 0.0;
        } else {
          l = b[g >> 2] | 0;
          o = +(v | 0);
          s = g + 4 | 0;
          m = b[s >> 2] | 0;
          t = g + 8 | 0;
          n = b[t >> 2] | 0;
          u = g;
          d = l;
          e = m;
          g = n;
          p = +((b[h >> 2] | 0) - l | 0) / o;
          r = +((b[h + 4 >> 2] | 0) - m | 0) / o;
          o = +((b[h + 8 >> 2] | 0) - n | 0) / o;
        }

        b[w >> 2] = d;
        n = w + 4 | 0;
        b[n >> 2] = e;
        m = w + 8 | 0;
        b[m >> 2] = g;
        l = 0;

        while (1) {
          j = +(l | 0);
          y = p * j + +(d | 0);
          i = r * j + +(b[s >> 2] | 0);
          j = o * j + +(b[t >> 2] | 0);
          e = ~~+fd(+y);
          h = ~~+fd(+i);
          d = ~~+fd(+j);
          y = +q(+(+(e | 0) - y));
          i = +q(+(+(h | 0) - i));
          j = +q(+(+(d | 0) - j));

          do { if (!(y > i & y > j)) {
            k = 0 - e | 0;

            if (i > j) {
              g = k - d | 0;
              break;
            } else {
              g = h;
              d = k - h | 0;
              break;
            }
          } else {
            e = 0 - (h + d) | 0;
            g = h;
          } } while (0);

          b[w >> 2] = e;
          b[n >> 2] = g;
          b[m >> 2] = d;
          Xa(w);
          nc(a, c, w, f + (l << 3) | 0) | 0;
          if ((l | 0) == (v | 0)) { break; }
          l = l + 1 | 0;
          d = b[u >> 2] | 0;
        }

        w = 0;
        S = x;
        return w | 0;
      }

      w = -1;
      S = x;
      return w | 0;
    }

    function tc(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0;

      if (!b) {
        c = 1;
        return c | 0;
      }

      c = a;
      a = 1;

      do {
        a = B((b & 1 | 0) == 0 ? 1 : c, a) | 0;
        b = b >> 1;
        c = B(c, c) | 0;
      } while ((b | 0) != 0);

      return a | 0;
    }

    function uc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var f = 0.0,
          g = 0.0,
          h = 0.0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0,
          m = 0,
          n = 0,
          o = 0.0;

      if (!(xa(c, d) | 0)) {
        n = 0;
        return n | 0;
      }

      c = wa(c) | 0;
      o = +e[d >> 3];
      f = +e[d + 8 >> 3];
      f = c & f < 0.0 ? f + 6.283185307179586 : f;
      n = b[a >> 2] | 0;

      if ((n | 0) <= 0) {
        n = 0;
        return n | 0;
      }

      m = b[a + 4 >> 2] | 0;

      if (c) {
        c = 0;
        d = -1;
        a = 0;

        a: while (1) {
          l = a;

          while (1) {
            i = +e[m + (l << 4) >> 3];
            k = +e[m + (l << 4) + 8 >> 3];
            a = (d + 2 | 0) % (n | 0) | 0;
            h = +e[m + (a << 4) >> 3];
            g = +e[m + (a << 4) + 8 >> 3];

            if (i > h) {
              j = i;
              i = k;
            } else {
              j = h;
              h = i;
              i = g;
              g = k;
            }

            if (!(o < h | o > j)) { break; }
            d = l + 1 | 0;

            if ((d | 0) < (n | 0)) {
              a = l;
              l = d;
              d = a;
            } else {
              d = 22;
              break a;
            }
          }

          k = g < 0.0 ? g + 6.283185307179586 : g;
          i = i < 0.0 ? i + 6.283185307179586 : i;
          f = i == f | k == f ? f + -2.220446049250313e-16 : f;
          k = k + (o - h) / (j - h) * (i - k);
          if ((k < 0.0 ? k + 6.283185307179586 : k) > f) { c = c ^ 1; }
          a = l + 1 | 0;

          if ((a | 0) >= (n | 0)) {
            d = 22;
            break;
          } else { d = l; }
        }

        if ((d | 0) == 22) { return c | 0; }
      } else {
        c = 0;
        d = -1;
        a = 0;

        b: while (1) {
          l = a;

          while (1) {
            i = +e[m + (l << 4) >> 3];
            k = +e[m + (l << 4) + 8 >> 3];
            a = (d + 2 | 0) % (n | 0) | 0;
            h = +e[m + (a << 4) >> 3];
            g = +e[m + (a << 4) + 8 >> 3];

            if (i > h) {
              j = i;
              i = k;
            } else {
              j = h;
              h = i;
              i = g;
              g = k;
            }

            if (!(o < h | o > j)) { break; }
            d = l + 1 | 0;

            if ((d | 0) < (n | 0)) {
              a = l;
              l = d;
              d = a;
            } else {
              d = 22;
              break b;
            }
          }

          f = i == f | g == f ? f + -2.220446049250313e-16 : f;
          if (g + (o - h) / (j - h) * (i - g) > f) { c = c ^ 1; }
          a = l + 1 | 0;

          if ((a | 0) >= (n | 0)) {
            d = 22;
            break;
          } else { d = l; }
        }

        if ((d | 0) == 22) { return c | 0; }
      }

      return 0;
    }

    function vc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0.0,
          f = 0.0,
          g = 0.0,
          h = 0.0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0.0,
          m = 0.0,
          n = 0,
          o = 0,
          p = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0;
      r = b[a >> 2] | 0;

      if (!r) {
        b[c >> 2] = 0;
        b[c + 4 >> 2] = 0;
        b[c + 8 >> 2] = 0;
        b[c + 12 >> 2] = 0;
        b[c + 16 >> 2] = 0;
        b[c + 20 >> 2] = 0;
        b[c + 24 >> 2] = 0;
        b[c + 28 >> 2] = 0;
        return;
      }

      s = c + 8 | 0;
      e[s >> 3] = 1797693134862315708145274.0e284;
      t = c + 24 | 0;
      e[t >> 3] = 1797693134862315708145274.0e284;
      e[c >> 3] = -1797693134862315708145274.0e284;
      u = c + 16 | 0;
      e[u >> 3] = -1797693134862315708145274.0e284;
      if ((r | 0) <= 0) { return; }
      o = b[a + 4 >> 2] | 0;
      l = 1797693134862315708145274.0e284;
      m = -1797693134862315708145274.0e284;
      n = 0;
      a = -1;
      h = 1797693134862315708145274.0e284;
      i = 1797693134862315708145274.0e284;
      k = -1797693134862315708145274.0e284;
      f = -1797693134862315708145274.0e284;
      p = 0;

      while (1) {
        d = +e[o + (p << 4) >> 3];
        j = +e[o + (p << 4) + 8 >> 3];
        a = a + 2 | 0;
        g = +e[o + (((a | 0) == (r | 0) ? 0 : a) << 4) + 8 >> 3];

        if (d < h) {
          e[s >> 3] = d;
          h = d;
        }

        if (j < i) {
          e[t >> 3] = j;
          i = j;
        }

        if (d > k) { e[c >> 3] = d; }else { d = k; }

        if (j > f) {
          e[u >> 3] = j;
          f = j;
        }

        l = j > 0.0 & j < l ? j : l;
        m = j < 0.0 & j > m ? j : m;
        n = n | +q(+(j - g)) > 3.141592653589793;
        a = p + 1 | 0;
        if ((a | 0) == (r | 0)) { break; }else {
          v = p;
          k = d;
          p = a;
          a = v;
        }
      }

      if (!n) { return; }
      e[u >> 3] = m;
      e[t >> 3] = l;
      return;
    }

    function wc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          f = 0,
          g = 0,
          h = 0.0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0.0,
          m = 0.0,
          n = 0.0,
          o = 0.0,
          p = 0.0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0,
          x = 0,
          y = 0,
          z = 0,
          A = 0;
      r = b[a >> 2] | 0;

      if (r) {
        s = c + 8 | 0;
        e[s >> 3] = 1797693134862315708145274.0e284;
        t = c + 24 | 0;
        e[t >> 3] = 1797693134862315708145274.0e284;
        e[c >> 3] = -1797693134862315708145274.0e284;
        u = c + 16 | 0;
        e[u >> 3] = -1797693134862315708145274.0e284;

        if ((r | 0) > 0) {
          g = b[a + 4 >> 2] | 0;
          o = 1797693134862315708145274.0e284;
          p = -1797693134862315708145274.0e284;
          f = 0;
          d = -1;
          k = 1797693134862315708145274.0e284;
          l = 1797693134862315708145274.0e284;
          n = -1797693134862315708145274.0e284;
          i = -1797693134862315708145274.0e284;
          v = 0;

          while (1) {
            h = +e[g + (v << 4) >> 3];
            m = +e[g + (v << 4) + 8 >> 3];
            z = d + 2 | 0;
            j = +e[g + (((z | 0) == (r | 0) ? 0 : z) << 4) + 8 >> 3];

            if (h < k) {
              e[s >> 3] = h;
              k = h;
            }

            if (m < l) {
              e[t >> 3] = m;
              l = m;
            }

            if (h > n) { e[c >> 3] = h; }else { h = n; }

            if (m > i) {
              e[u >> 3] = m;
              i = m;
            }

            o = m > 0.0 & m < o ? m : o;
            p = m < 0.0 & m > p ? m : p;
            f = f | +q(+(m - j)) > 3.141592653589793;
            d = v + 1 | 0;
            if ((d | 0) == (r | 0)) { break; }else {
              z = v;
              n = h;
              v = d;
              d = z;
            }
          }

          if (f) {
            e[u >> 3] = p;
            e[t >> 3] = o;
          }
        }
      } else {
        b[c >> 2] = 0;
        b[c + 4 >> 2] = 0;
        b[c + 8 >> 2] = 0;
        b[c + 12 >> 2] = 0;
        b[c + 16 >> 2] = 0;
        b[c + 20 >> 2] = 0;
        b[c + 24 >> 2] = 0;
        b[c + 28 >> 2] = 0;
      }

      z = a + 8 | 0;
      d = b[z >> 2] | 0;
      if ((d | 0) <= 0) { return; }
      y = a + 12 | 0;
      x = 0;

      do {
        g = b[y >> 2] | 0;
        f = x;
        x = x + 1 | 0;
        t = c + (x << 5) | 0;
        u = b[g + (f << 3) >> 2] | 0;

        if (u) {
          v = c + (x << 5) + 8 | 0;
          e[v >> 3] = 1797693134862315708145274.0e284;
          a = c + (x << 5) + 24 | 0;
          e[a >> 3] = 1797693134862315708145274.0e284;
          e[t >> 3] = -1797693134862315708145274.0e284;
          w = c + (x << 5) + 16 | 0;
          e[w >> 3] = -1797693134862315708145274.0e284;

          if ((u | 0) > 0) {
            r = b[g + (f << 3) + 4 >> 2] | 0;
            o = 1797693134862315708145274.0e284;
            p = -1797693134862315708145274.0e284;
            g = 0;
            f = -1;
            s = 0;
            k = 1797693134862315708145274.0e284;
            l = 1797693134862315708145274.0e284;
            m = -1797693134862315708145274.0e284;
            i = -1797693134862315708145274.0e284;

            while (1) {
              h = +e[r + (s << 4) >> 3];
              n = +e[r + (s << 4) + 8 >> 3];
              f = f + 2 | 0;
              j = +e[r + (((f | 0) == (u | 0) ? 0 : f) << 4) + 8 >> 3];

              if (h < k) {
                e[v >> 3] = h;
                k = h;
              }

              if (n < l) {
                e[a >> 3] = n;
                l = n;
              }

              if (h > m) { e[t >> 3] = h; }else { h = m; }

              if (n > i) {
                e[w >> 3] = n;
                i = n;
              }

              o = n > 0.0 & n < o ? n : o;
              p = n < 0.0 & n > p ? n : p;
              g = g | +q(+(n - j)) > 3.141592653589793;
              f = s + 1 | 0;
              if ((f | 0) == (u | 0)) { break; }else {
                A = s;
                s = f;
                m = h;
                f = A;
              }
            }

            if (g) {
              e[w >> 3] = p;
              e[a >> 3] = o;
            }
          }
        } else {
          b[t >> 2] = 0;
          b[t + 4 >> 2] = 0;
          b[t + 8 >> 2] = 0;
          b[t + 12 >> 2] = 0;
          b[t + 16 >> 2] = 0;
          b[t + 20 >> 2] = 0;
          b[t + 24 >> 2] = 0;
          b[t + 28 >> 2] = 0;
          d = b[z >> 2] | 0;
        }
      } while ((x | 0) < (d | 0));

      return;
    }

    function xc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0,
          g = 0;

      if (!(uc(a, c, d) | 0)) {
        f = 0;
        return f | 0;
      }

      f = a + 8 | 0;

      if ((b[f >> 2] | 0) <= 0) {
        f = 1;
        return f | 0;
      }

      e = a + 12 | 0;
      a = 0;

      while (1) {
        g = a;
        a = a + 1 | 0;

        if (uc((b[e >> 2] | 0) + (g << 3) | 0, c + (a << 5) | 0, d) | 0) {
          a = 0;
          e = 6;
          break;
        }

        if ((a | 0) >= (b[f >> 2] | 0)) {
          a = 1;
          e = 6;
          break;
        }
      }

      if ((e | 0) == 6) { return a | 0; }
      return 0;
    }

    function yc() {
      return 8;
    }

    function zc() {
      return 16;
    }

    function Ac() {
      return 168;
    }

    function Bc() {
      return 8;
    }

    function Cc() {
      return 16;
    }

    function Dc() {
      return 12;
    }

    function Ec() {
      return 8;
    }

    function Fc(a) {
      a = a | 0;
      var b = 0.0,
          c = 0.0;
      c = +e[a >> 3];
      b = +e[a + 8 >> 3];
      return + +r(+(c * c + b * b));
    }

    function Gc(a, b, c, d, f) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      f = f | 0;
      var g = 0.0,
          h = 0.0,
          i = 0.0,
          j = 0.0,
          k = 0.0,
          l = 0.0,
          m = 0.0,
          n = 0.0;
      k = +e[a >> 3];
      j = +e[b >> 3] - k;
      i = +e[a + 8 >> 3];
      h = +e[b + 8 >> 3] - i;
      m = +e[c >> 3];
      g = +e[d >> 3] - m;
      n = +e[c + 8 >> 3];
      l = +e[d + 8 >> 3] - n;
      g = (g * (i - n) - (k - m) * l) / (j * l - h * g);
      e[f >> 3] = k + j * g;
      e[f + 8 >> 3] = i + h * g;
      return;
    }

    function Hc(a, b) {
      a = a | 0;
      b = b | 0;

      if (!(+e[a >> 3] == +e[b >> 3])) {
        b = 0;
        return b | 0;
      }

      b = +e[a + 8 >> 3] == +e[b + 8 >> 3];
      return b | 0;
    }

    function Ic(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0;
      f = +e[a >> 3] - +e[b >> 3];
      d = +e[a + 8 >> 3] - +e[b + 8 >> 3];
      c = +e[a + 16 >> 3] - +e[b + 16 >> 3];
      return +(f * f + d * d + c * c);
    }

    function Jc(a, b) {
      a = a | 0;
      b = b | 0;
      var c = 0.0,
          d = 0.0,
          f = 0.0;
      c = +e[a >> 3];
      d = +t(+c);
      c = +u(+c);
      e[b + 16 >> 3] = c;
      c = +e[a + 8 >> 3];
      f = d * +t(+c);
      e[b >> 3] = f;
      c = d * +u(+c);
      e[b + 8 >> 3] = c;
      return;
    }

    function Kc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0;
      k = S;
      S = S + 32 | 0;
      f = k + 16 | 0;
      g = k;
      Ub(a, c, f);
      h = Ab(a, c) | 0;
      j = Lb(a, c) | 0;
      pa(h, g);
      c = qa(h, b[f >> 2] | 0) | 0;

      if (!(la(h) | 0)) {
        j = c;
        S = k;
        return j | 0;
      }

      do { switch (h | 0) {
        case 4:
          {
            a = 0;
            d = 14;
            break;
          }

        case 14:
          {
            a = 1;
            d = 14;
            break;
          }

        case 24:
          {
            a = 2;
            d = 14;
            break;
          }

        case 38:
          {
            a = 3;
            d = 14;
            break;
          }

        case 49:
          {
            a = 4;
            d = 14;
            break;
          }

        case 58:
          {
            a = 5;
            d = 14;
            break;
          }

        case 63:
          {
            a = 6;
            d = 14;
            break;
          }

        case 72:
          {
            a = 7;
            d = 14;
            break;
          }

        case 83:
          {
            a = 8;
            d = 14;
            break;
          }

        case 97:
          {
            a = 9;
            d = 14;
            break;
          }

        case 107:
          {
            a = 10;
            d = 14;
            break;
          }

        case 117:
          {
            a = 11;
            d = 14;
            break;
          }

        default:
          {
            i = 0;
            e = 0;
          }
      } } while (0);

      if ((d | 0) == 14) {
        i = b[22096 + (a * 24 | 0) + 8 >> 2] | 0;
        e = b[22096 + (a * 24 | 0) + 16 >> 2] | 0;
      }

      a = b[f >> 2] | 0;

      if ((a | 0) != (b[g >> 2] | 0)) {
        h = ma(h) | 0;
        a = b[f >> 2] | 0;
        if (h | (a | 0) == (e | 0)) { c = (c + 1 | 0) % 6 | 0; }
      }

      if ((j | 0) == 3 & (a | 0) == (e | 0)) {
        j = (c + 5 | 0) % 6 | 0;
        S = k;
        return j | 0;
      }

      if (!((j | 0) == 5 & (a | 0) == (i | 0))) {
        j = c;
        S = k;
        return j | 0;
      }

      j = (c + 1 | 0) % 6 | 0;
      S = k;
      return j | 0;
    }

    function Lc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0,
          f = 0;
      e = Fb(a, c) | 0;

      if ((d + -1 | 0) >>> 0 > 5) {
        d = -1;
        return d | 0;
      }

      f = (e | 0) != 0;

      if ((d | 0) == 1 & f) {
        d = -1;
        return d | 0;
      }

      e = Kc(a, c) | 0;

      if (f) {
        d = (5 - e + (b[22384 + (d << 2) >> 2] | 0) | 0) % 5 | 0;
        return d | 0;
      } else {
        d = (6 - e + (b[22416 + (d << 2) >> 2] | 0) | 0) % 6 | 0;
        return d | 0;
      }

      return 0;
    }

    function Mc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var e = 0;

      if ((c | 0) > 0) {
        e = Yc(c, 4) | 0;
        b[a >> 2] = e;
        if (!e) { H(23230, 23253, 40, 23267); }
      } else { b[a >> 2] = 0; }

      b[a + 4 >> 2] = c;
      b[a + 8 >> 2] = 0;
      b[a + 12 >> 2] = d;
      return;
    }

    function Nc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0;
      g = a + 4 | 0;
      h = a + 12 | 0;
      i = a + 8 | 0;

      a: while (1) {
        d = b[g >> 2] | 0;
        c = 0;

        while (1) {
          if ((c | 0) >= (d | 0)) { break a; }
          f = b[a >> 2] | 0;
          j = b[f + (c << 2) >> 2] | 0;
          if (!j) { c = c + 1 | 0; }else { break; }
        }

        c = f + (~~(+q(+(+s(10.0, + +(15 - (b[h >> 2] | 0) | 0)) * (+e[j >> 3] + +e[j + 8 >> 3]))) % +(d | 0)) >>> 0 << 2) | 0;
        d = b[c >> 2] | 0;

        b: do { if (d | 0) {
          f = j + 32 | 0;
          if ((d | 0) == (j | 0)) { b[c >> 2] = b[f >> 2]; }else {
            d = d + 32 | 0;
            c = b[d >> 2] | 0;
            if (!c) { break; }

            while (1) {
              if ((c | 0) == (j | 0)) { break; }
              d = c + 32 | 0;
              c = b[d >> 2] | 0;
              if (!c) { break b; }
            }

            b[d >> 2] = b[f >> 2];
          }
          Xc(j);
          b[i >> 2] = (b[i >> 2] | 0) + -1;
        } } while (0);
      }

      Xc(b[a >> 2] | 0);
      return;
    }

    function Oc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0;
      e = b[a + 4 >> 2] | 0;
      d = 0;

      while (1) {
        if ((d | 0) >= (e | 0)) {
          c = 0;
          d = 4;
          break;
        }

        c = b[(b[a >> 2] | 0) + (d << 2) >> 2] | 0;
        if (!c) { d = d + 1 | 0; }else {
          d = 4;
          break;
        }
      }

      if ((d | 0) == 4) { return c | 0; }
      return 0;
    }

    function Pc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0,
          f = 0,
          g = 0,
          h = 0;
      d = ~~(+q(+(+s(10.0, + +(15 - (b[a + 12 >> 2] | 0) | 0)) * (+e[c >> 3] + +e[c + 8 >> 3]))) % +(b[a + 4 >> 2] | 0)) >>> 0;
      d = (b[a >> 2] | 0) + (d << 2) | 0;
      f = b[d >> 2] | 0;

      if (!f) {
        h = 1;
        return h | 0;
      }

      h = c + 32 | 0;

      do { if ((f | 0) != (c | 0)) {
        d = b[f + 32 >> 2] | 0;

        if (!d) {
          h = 1;
          return h | 0;
        }

        g = d;

        while (1) {
          if ((g | 0) == (c | 0)) {
            g = 8;
            break;
          }

          d = b[g + 32 >> 2] | 0;

          if (!d) {
            d = 1;
            g = 10;
            break;
          } else {
            f = g;
            g = d;
          }
        }

        if ((g | 0) == 8) {
          b[f + 32 >> 2] = b[h >> 2];
          break;
        } else if ((g | 0) == 10) { return d | 0; }
      } else { b[d >> 2] = b[h >> 2]; } } while (0);

      Xc(c);
      h = a + 8 | 0;
      b[h >> 2] = (b[h >> 2] | 0) + -1;
      h = 0;
      return h | 0;
    }

    function Qc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = Wc(40) | 0;
      if (!h) { H(23283, 23253, 98, 23296); }
      b[h >> 2] = b[c >> 2];
      b[h + 4 >> 2] = b[c + 4 >> 2];
      b[h + 8 >> 2] = b[c + 8 >> 2];
      b[h + 12 >> 2] = b[c + 12 >> 2];
      g = h + 16 | 0;
      b[g >> 2] = b[d >> 2];
      b[g + 4 >> 2] = b[d + 4 >> 2];
      b[g + 8 >> 2] = b[d + 8 >> 2];
      b[g + 12 >> 2] = b[d + 12 >> 2];
      b[h + 32 >> 2] = 0;
      g = ~~(+q(+(+s(10.0, + +(15 - (b[a + 12 >> 2] | 0) | 0)) * (+e[c >> 3] + +e[c + 8 >> 3]))) % +(b[a + 4 >> 2] | 0)) >>> 0;
      g = (b[a >> 2] | 0) + (g << 2) | 0;
      f = b[g >> 2] | 0;

      do { if (!f) { b[g >> 2] = h; }else {
        while (1) {
          if (hb(f, c) | 0 ? hb(f + 16 | 0, d) | 0 : 0) { break; }
          g = b[f + 32 >> 2] | 0;
          f = (g | 0) == 0 ? f : g;

          if (!(b[f + 32 >> 2] | 0)) {
            i = 10;
            break;
          }
        }

        if ((i | 0) == 10) {
          b[f + 32 >> 2] = h;
          break;
        }

        Xc(h);
        i = f;
        return i | 0;
      } } while (0);

      i = a + 8 | 0;
      b[i >> 2] = (b[i >> 2] | 0) + 1;
      i = h;
      return i | 0;
    }

    function Rc(a, c, d) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      var f = 0,
          g = 0;
      g = ~~(+q(+(+s(10.0, + +(15 - (b[a + 12 >> 2] | 0) | 0)) * (+e[c >> 3] + +e[c + 8 >> 3]))) % +(b[a + 4 >> 2] | 0)) >>> 0;
      g = b[(b[a >> 2] | 0) + (g << 2) >> 2] | 0;

      if (!g) {
        d = 0;
        return d | 0;
      }

      if (!d) {
        a = g;

        while (1) {
          if (hb(a, c) | 0) {
            f = 10;
            break;
          }

          a = b[a + 32 >> 2] | 0;

          if (!a) {
            a = 0;
            f = 10;
            break;
          }
        }

        if ((f | 0) == 10) { return a | 0; }
      }

      a = g;

      while (1) {
        if (hb(a, c) | 0 ? hb(a + 16 | 0, d) | 0 : 0) {
          f = 10;
          break;
        }

        a = b[a + 32 >> 2] | 0;

        if (!a) {
          a = 0;
          f = 10;
          break;
        }
      }

      if ((f | 0) == 10) { return a | 0; }
      return 0;
    }

    function Sc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0;
      d = ~~(+q(+(+s(10.0, + +(15 - (b[a + 12 >> 2] | 0) | 0)) * (+e[c >> 3] + +e[c + 8 >> 3]))) % +(b[a + 4 >> 2] | 0)) >>> 0;
      a = b[(b[a >> 2] | 0) + (d << 2) >> 2] | 0;

      if (!a) {
        d = 0;
        return d | 0;
      }

      while (1) {
        if (hb(a, c) | 0) {
          c = 5;
          break;
        }

        a = b[a + 32 >> 2] | 0;

        if (!a) {
          a = 0;
          c = 5;
          break;
        }
      }

      if ((c | 0) == 5) { return a | 0; }
      return 0;
    }

    function Tc() {
      return 23312;
    }

    function Uc(a) {
      a = +a;
      return + +id(+a);
    }

    function Vc(a) {
      a = +a;
      return ~~+Uc(a) | 0;
    }

    function Wc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0,
          q = 0,
          r = 0,
          s = 0,
          t = 0,
          u = 0,
          v = 0,
          w = 0;
      w = S;
      S = S + 16 | 0;
      n = w;

      do { if (a >>> 0 < 245) {
        k = a >>> 0 < 11 ? 16 : a + 11 & -8;
        a = k >>> 3;
        m = b[5829] | 0;
        d = m >>> a;

        if (d & 3 | 0) {
          c = (d & 1 ^ 1) + a | 0;
          a = 23356 + (c << 1 << 2) | 0;
          d = a + 8 | 0;
          e = b[d >> 2] | 0;
          f = e + 8 | 0;
          g = b[f >> 2] | 0;
          if ((g | 0) == (a | 0)) { b[5829] = m & ~(1 << c); }else {
            b[g + 12 >> 2] = a;
            b[d >> 2] = g;
          }
          v = c << 3;
          b[e + 4 >> 2] = v | 3;
          v = e + v + 4 | 0;
          b[v >> 2] = b[v >> 2] | 1;
          v = f;
          S = w;
          return v | 0;
        }

        l = b[5831] | 0;

        if (k >>> 0 > l >>> 0) {
          if (d | 0) {
            c = 2 << a;
            c = d << a & (c | 0 - c);
            c = (c & 0 - c) + -1 | 0;
            i = c >>> 12 & 16;
            c = c >>> i;
            d = c >>> 5 & 8;
            c = c >>> d;
            g = c >>> 2 & 4;
            c = c >>> g;
            a = c >>> 1 & 2;
            c = c >>> a;
            e = c >>> 1 & 1;
            e = (d | i | g | a | e) + (c >>> e) | 0;
            c = 23356 + (e << 1 << 2) | 0;
            a = c + 8 | 0;
            g = b[a >> 2] | 0;
            i = g + 8 | 0;
            d = b[i >> 2] | 0;

            if ((d | 0) == (c | 0)) {
              a = m & ~(1 << e);
              b[5829] = a;
            } else {
              b[d + 12 >> 2] = c;
              b[a >> 2] = d;
              a = m;
            }

            v = e << 3;
            h = v - k | 0;
            b[g + 4 >> 2] = k | 3;
            f = g + k | 0;
            b[f + 4 >> 2] = h | 1;
            b[g + v >> 2] = h;

            if (l | 0) {
              e = b[5834] | 0;
              c = l >>> 3;
              d = 23356 + (c << 1 << 2) | 0;
              c = 1 << c;

              if (!(a & c)) {
                b[5829] = a | c;
                c = d;
                a = d + 8 | 0;
              } else {
                a = d + 8 | 0;
                c = b[a >> 2] | 0;
              }

              b[a >> 2] = e;
              b[c + 12 >> 2] = e;
              b[e + 8 >> 2] = c;
              b[e + 12 >> 2] = d;
            }

            b[5831] = h;
            b[5834] = f;
            v = i;
            S = w;
            return v | 0;
          }

          g = b[5830] | 0;

          if (g) {
            d = (g & 0 - g) + -1 | 0;
            f = d >>> 12 & 16;
            d = d >>> f;
            e = d >>> 5 & 8;
            d = d >>> e;
            h = d >>> 2 & 4;
            d = d >>> h;
            i = d >>> 1 & 2;
            d = d >>> i;
            j = d >>> 1 & 1;
            j = b[23620 + ((e | f | h | i | j) + (d >>> j) << 2) >> 2] | 0;
            d = j;
            i = j;
            j = (b[j + 4 >> 2] & -8) - k | 0;

            while (1) {
              a = b[d + 16 >> 2] | 0;

              if (!a) {
                a = b[d + 20 >> 2] | 0;
                if (!a) { break; }
              }

              h = (b[a + 4 >> 2] & -8) - k | 0;
              f = h >>> 0 < j >>> 0;
              d = a;
              i = f ? a : i;
              j = f ? h : j;
            }

            h = i + k | 0;

            if (h >>> 0 > i >>> 0) {
              f = b[i + 24 >> 2] | 0;
              c = b[i + 12 >> 2] | 0;

              do { if ((c | 0) == (i | 0)) {
                a = i + 20 | 0;
                c = b[a >> 2] | 0;

                if (!c) {
                  a = i + 16 | 0;
                  c = b[a >> 2] | 0;

                  if (!c) {
                    d = 0;
                    break;
                  }
                }

                while (1) {
                  e = c + 20 | 0;
                  d = b[e >> 2] | 0;

                  if (!d) {
                    e = c + 16 | 0;
                    d = b[e >> 2] | 0;
                    if (!d) { break; }else {
                      c = d;
                      a = e;
                    }
                  } else {
                    c = d;
                    a = e;
                  }
                }

                b[a >> 2] = 0;
                d = c;
              } else {
                d = b[i + 8 >> 2] | 0;
                b[d + 12 >> 2] = c;
                b[c + 8 >> 2] = d;
                d = c;
              } } while (0);

              do { if (f | 0) {
                c = b[i + 28 >> 2] | 0;
                a = 23620 + (c << 2) | 0;

                if ((i | 0) == (b[a >> 2] | 0)) {
                  b[a >> 2] = d;

                  if (!d) {
                    b[5830] = g & ~(1 << c);
                    break;
                  }
                } else {
                  v = f + 16 | 0;
                  b[((b[v >> 2] | 0) == (i | 0) ? v : f + 20 | 0) >> 2] = d;
                  if (!d) { break; }
                }

                b[d + 24 >> 2] = f;
                c = b[i + 16 >> 2] | 0;

                if (c | 0) {
                  b[d + 16 >> 2] = c;
                  b[c + 24 >> 2] = d;
                }

                c = b[i + 20 >> 2] | 0;

                if (c | 0) {
                  b[d + 20 >> 2] = c;
                  b[c + 24 >> 2] = d;
                }
              } } while (0);

              if (j >>> 0 < 16) {
                v = j + k | 0;
                b[i + 4 >> 2] = v | 3;
                v = i + v + 4 | 0;
                b[v >> 2] = b[v >> 2] | 1;
              } else {
                b[i + 4 >> 2] = k | 3;
                b[h + 4 >> 2] = j | 1;
                b[h + j >> 2] = j;

                if (l | 0) {
                  e = b[5834] | 0;
                  c = l >>> 3;
                  d = 23356 + (c << 1 << 2) | 0;
                  c = 1 << c;

                  if (!(c & m)) {
                    b[5829] = c | m;
                    c = d;
                    a = d + 8 | 0;
                  } else {
                    a = d + 8 | 0;
                    c = b[a >> 2] | 0;
                  }

                  b[a >> 2] = e;
                  b[c + 12 >> 2] = e;
                  b[e + 8 >> 2] = c;
                  b[e + 12 >> 2] = d;
                }

                b[5831] = j;
                b[5834] = h;
              }

              v = i + 8 | 0;
              S = w;
              return v | 0;
            } else { m = k; }
          } else { m = k; }
        } else { m = k; }
      } else if (a >>> 0 <= 4294967231) {
        a = a + 11 | 0;
        k = a & -8;
        e = b[5830] | 0;

        if (e) {
          f = 0 - k | 0;
          a = a >>> 8;
          if (a) {
            if (k >>> 0 > 16777215) { j = 31; }else {
              m = (a + 1048320 | 0) >>> 16 & 8;
              q = a << m;
              i = (q + 520192 | 0) >>> 16 & 4;
              q = q << i;
              j = (q + 245760 | 0) >>> 16 & 2;
              j = 14 - (i | m | j) + (q << j >>> 15) | 0;
              j = k >>> (j + 7 | 0) & 1 | j << 1;
            }
          } else { j = 0; }
          d = b[23620 + (j << 2) >> 2] | 0;

          a: do { if (!d) {
            d = 0;
            a = 0;
            q = 61;
          } else {
            a = 0;
            i = k << ((j | 0) == 31 ? 0 : 25 - (j >>> 1) | 0);
            g = 0;

            while (1) {
              h = (b[d + 4 >> 2] & -8) - k | 0;
              if (h >>> 0 < f >>> 0) { if (!h) {
                a = d;
                f = 0;
                q = 65;
                break a;
              } else {
                a = d;
                f = h;
              } }
              q = b[d + 20 >> 2] | 0;
              d = b[d + 16 + (i >>> 31 << 2) >> 2] | 0;
              g = (q | 0) == 0 | (q | 0) == (d | 0) ? g : q;

              if (!d) {
                d = g;
                q = 61;
                break;
              } else { i = i << 1; }
            }
          } } while (0);

          if ((q | 0) == 61) {
            if ((d | 0) == 0 & (a | 0) == 0) {
              a = 2 << j;
              a = (a | 0 - a) & e;

              if (!a) {
                m = k;
                break;
              }

              m = (a & 0 - a) + -1 | 0;
              h = m >>> 12 & 16;
              m = m >>> h;
              g = m >>> 5 & 8;
              m = m >>> g;
              i = m >>> 2 & 4;
              m = m >>> i;
              j = m >>> 1 & 2;
              m = m >>> j;
              d = m >>> 1 & 1;
              a = 0;
              d = b[23620 + ((g | h | i | j | d) + (m >>> d) << 2) >> 2] | 0;
            }

            if (!d) {
              i = a;
              h = f;
            } else { q = 65; }
          }

          if ((q | 0) == 65) {
            g = d;

            while (1) {
              m = (b[g + 4 >> 2] & -8) - k | 0;
              d = m >>> 0 < f >>> 0;
              f = d ? m : f;
              a = d ? g : a;
              d = b[g + 16 >> 2] | 0;
              if (!d) { d = b[g + 20 >> 2] | 0; }

              if (!d) {
                i = a;
                h = f;
                break;
              } else { g = d; }
            }
          }

          if (((i | 0) != 0 ? h >>> 0 < ((b[5831] | 0) - k | 0) >>> 0 : 0) ? (l = i + k | 0, l >>> 0 > i >>> 0) : 0) {
            g = b[i + 24 >> 2] | 0;
            c = b[i + 12 >> 2] | 0;

            do { if ((c | 0) == (i | 0)) {
              a = i + 20 | 0;
              c = b[a >> 2] | 0;

              if (!c) {
                a = i + 16 | 0;
                c = b[a >> 2] | 0;

                if (!c) {
                  c = 0;
                  break;
                }
              }

              while (1) {
                f = c + 20 | 0;
                d = b[f >> 2] | 0;

                if (!d) {
                  f = c + 16 | 0;
                  d = b[f >> 2] | 0;
                  if (!d) { break; }else {
                    c = d;
                    a = f;
                  }
                } else {
                  c = d;
                  a = f;
                }
              }

              b[a >> 2] = 0;
            } else {
              v = b[i + 8 >> 2] | 0;
              b[v + 12 >> 2] = c;
              b[c + 8 >> 2] = v;
            } } while (0);

            do { if (g) {
              a = b[i + 28 >> 2] | 0;
              d = 23620 + (a << 2) | 0;

              if ((i | 0) == (b[d >> 2] | 0)) {
                b[d >> 2] = c;

                if (!c) {
                  e = e & ~(1 << a);
                  b[5830] = e;
                  break;
                }
              } else {
                v = g + 16 | 0;
                b[((b[v >> 2] | 0) == (i | 0) ? v : g + 20 | 0) >> 2] = c;
                if (!c) { break; }
              }

              b[c + 24 >> 2] = g;
              a = b[i + 16 >> 2] | 0;

              if (a | 0) {
                b[c + 16 >> 2] = a;
                b[a + 24 >> 2] = c;
              }

              a = b[i + 20 >> 2] | 0;

              if (a) {
                b[c + 20 >> 2] = a;
                b[a + 24 >> 2] = c;
              }
            } } while (0);

            b: do { if (h >>> 0 < 16) {
              v = h + k | 0;
              b[i + 4 >> 2] = v | 3;
              v = i + v + 4 | 0;
              b[v >> 2] = b[v >> 2] | 1;
            } else {
              b[i + 4 >> 2] = k | 3;
              b[l + 4 >> 2] = h | 1;
              b[l + h >> 2] = h;
              c = h >>> 3;

              if (h >>> 0 < 256) {
                d = 23356 + (c << 1 << 2) | 0;
                a = b[5829] | 0;
                c = 1 << c;

                if (!(a & c)) {
                  b[5829] = a | c;
                  c = d;
                  a = d + 8 | 0;
                } else {
                  a = d + 8 | 0;
                  c = b[a >> 2] | 0;
                }

                b[a >> 2] = l;
                b[c + 12 >> 2] = l;
                b[l + 8 >> 2] = c;
                b[l + 12 >> 2] = d;
                break;
              }

              c = h >>> 8;
              if (c) {
                if (h >>> 0 > 16777215) { d = 31; }else {
                  u = (c + 1048320 | 0) >>> 16 & 8;
                  v = c << u;
                  t = (v + 520192 | 0) >>> 16 & 4;
                  v = v << t;
                  d = (v + 245760 | 0) >>> 16 & 2;
                  d = 14 - (t | u | d) + (v << d >>> 15) | 0;
                  d = h >>> (d + 7 | 0) & 1 | d << 1;
                }
              } else { d = 0; }
              c = 23620 + (d << 2) | 0;
              b[l + 28 >> 2] = d;
              a = l + 16 | 0;
              b[a + 4 >> 2] = 0;
              b[a >> 2] = 0;
              a = 1 << d;

              if (!(e & a)) {
                b[5830] = e | a;
                b[c >> 2] = l;
                b[l + 24 >> 2] = c;
                b[l + 12 >> 2] = l;
                b[l + 8 >> 2] = l;
                break;
              }

              c = b[c >> 2] | 0;

              c: do { if ((b[c + 4 >> 2] & -8 | 0) != (h | 0)) {
                e = h << ((d | 0) == 31 ? 0 : 25 - (d >>> 1) | 0);

                while (1) {
                  d = c + 16 + (e >>> 31 << 2) | 0;
                  a = b[d >> 2] | 0;
                  if (!a) { break; }

                  if ((b[a + 4 >> 2] & -8 | 0) == (h | 0)) {
                    c = a;
                    break c;
                  } else {
                    e = e << 1;
                    c = a;
                  }
                }

                b[d >> 2] = l;
                b[l + 24 >> 2] = c;
                b[l + 12 >> 2] = l;
                b[l + 8 >> 2] = l;
                break b;
              } } while (0);

              u = c + 8 | 0;
              v = b[u >> 2] | 0;
              b[v + 12 >> 2] = l;
              b[u >> 2] = l;
              b[l + 8 >> 2] = v;
              b[l + 12 >> 2] = c;
              b[l + 24 >> 2] = 0;
            } } while (0);

            v = i + 8 | 0;
            S = w;
            return v | 0;
          } else { m = k; }
        } else { m = k; }
      } else { m = -1; } } while (0);

      d = b[5831] | 0;

      if (d >>> 0 >= m >>> 0) {
        c = d - m | 0;
        a = b[5834] | 0;

        if (c >>> 0 > 15) {
          v = a + m | 0;
          b[5834] = v;
          b[5831] = c;
          b[v + 4 >> 2] = c | 1;
          b[a + d >> 2] = c;
          b[a + 4 >> 2] = m | 3;
        } else {
          b[5831] = 0;
          b[5834] = 0;
          b[a + 4 >> 2] = d | 3;
          v = a + d + 4 | 0;
          b[v >> 2] = b[v >> 2] | 1;
        }

        v = a + 8 | 0;
        S = w;
        return v | 0;
      }

      h = b[5832] | 0;

      if (h >>> 0 > m >>> 0) {
        t = h - m | 0;
        b[5832] = t;
        v = b[5835] | 0;
        u = v + m | 0;
        b[5835] = u;
        b[u + 4 >> 2] = t | 1;
        b[v + 4 >> 2] = m | 3;
        v = v + 8 | 0;
        S = w;
        return v | 0;
      }

      if (!(b[5947] | 0)) {
        b[5949] = 4096;
        b[5948] = 4096;
        b[5950] = -1;
        b[5951] = -1;
        b[5952] = 0;
        b[5940] = 0;
        b[5947] = n & -16 ^ 1431655768;
        a = 4096;
      } else { a = b[5949] | 0; }

      i = m + 48 | 0;
      j = m + 47 | 0;
      g = a + j | 0;
      f = 0 - a | 0;
      k = g & f;

      if (k >>> 0 <= m >>> 0) {
        v = 0;
        S = w;
        return v | 0;
      }

      a = b[5939] | 0;

      if (a | 0 ? (l = b[5937] | 0, n = l + k | 0, n >>> 0 <= l >>> 0 | n >>> 0 > a >>> 0) : 0) {
        v = 0;
        S = w;
        return v | 0;
      }

      d: do { if (!(b[5940] & 4)) {
        d = b[5835] | 0;

        e: do { if (d) {
          e = 23764;

          while (1) {
            n = b[e >> 2] | 0;
            if (n >>> 0 <= d >>> 0 ? (n + (b[e + 4 >> 2] | 0) | 0) >>> 0 > d >>> 0 : 0) { break; }
            a = b[e + 8 >> 2] | 0;

            if (!a) {
              q = 128;
              break e;
            } else { e = a; }
          }

          c = g - h & f;

          if (c >>> 0 < 2147483647) {
            a = jd(c | 0) | 0;

            if ((a | 0) == ((b[e >> 2] | 0) + (b[e + 4 >> 2] | 0) | 0)) {
              if ((a | 0) != (-1 | 0)) {
                h = c;
                g = a;
                q = 145;
                break d;
              }
            } else {
              e = a;
              q = 136;
            }
          } else { c = 0; }
        } else { q = 128; } } while (0);

        do { if ((q | 0) == 128) {
          d = jd(0) | 0;

          if ((d | 0) != (-1 | 0) ? (c = d, o = b[5948] | 0, p = o + -1 | 0, c = ((p & c | 0) == 0 ? 0 : (p + c & 0 - o) - c | 0) + k | 0, o = b[5937] | 0, p = c + o | 0, c >>> 0 > m >>> 0 & c >>> 0 < 2147483647) : 0) {
            n = b[5939] | 0;

            if (n | 0 ? p >>> 0 <= o >>> 0 | p >>> 0 > n >>> 0 : 0) {
              c = 0;
              break;
            }

            a = jd(c | 0) | 0;

            if ((a | 0) == (d | 0)) {
              h = c;
              g = d;
              q = 145;
              break d;
            } else {
              e = a;
              q = 136;
            }
          } else { c = 0; }
        } } while (0);

        do { if ((q | 0) == 136) {
          d = 0 - c | 0;
          if (!(i >>> 0 > c >>> 0 & (c >>> 0 < 2147483647 & (e | 0) != (-1 | 0)))) { if ((e | 0) == (-1 | 0)) {
            c = 0;
            break;
          } else {
            h = c;
            g = e;
            q = 145;
            break d;
          } }
          a = b[5949] | 0;
          a = j - c + a & 0 - a;

          if (a >>> 0 >= 2147483647) {
            h = c;
            g = e;
            q = 145;
            break d;
          }

          if ((jd(a | 0) | 0) == (-1 | 0)) {
            jd(d | 0) | 0;
            c = 0;
            break;
          } else {
            h = a + c | 0;
            g = e;
            q = 145;
            break d;
          }
        } } while (0);

        b[5940] = b[5940] | 4;
        q = 143;
      } else {
        c = 0;
        q = 143;
      } } while (0);

      if (((q | 0) == 143 ? k >>> 0 < 2147483647 : 0) ? (t = jd(k | 0) | 0, p = jd(0) | 0, r = p - t | 0, s = r >>> 0 > (m + 40 | 0) >>> 0, !((t | 0) == (-1 | 0) | s ^ 1 | t >>> 0 < p >>> 0 & ((t | 0) != (-1 | 0) & (p | 0) != (-1 | 0)) ^ 1)) : 0) {
        h = s ? r : c;
        g = t;
        q = 145;
      }

      if ((q | 0) == 145) {
        c = (b[5937] | 0) + h | 0;
        b[5937] = c;
        if (c >>> 0 > (b[5938] | 0) >>> 0) { b[5938] = c; }
        j = b[5835] | 0;

        f: do { if (j) {
          c = 23764;

          while (1) {
            a = b[c >> 2] | 0;
            d = b[c + 4 >> 2] | 0;

            if ((g | 0) == (a + d | 0)) {
              q = 154;
              break;
            }

            e = b[c + 8 >> 2] | 0;
            if (!e) { break; }else { c = e; }
          }

          if (((q | 0) == 154 ? (u = c + 4 | 0, (b[c + 12 >> 2] & 8 | 0) == 0) : 0) ? g >>> 0 > j >>> 0 & a >>> 0 <= j >>> 0 : 0) {
            b[u >> 2] = d + h;
            v = (b[5832] | 0) + h | 0;
            t = j + 8 | 0;
            t = (t & 7 | 0) == 0 ? 0 : 0 - t & 7;
            u = j + t | 0;
            t = v - t | 0;
            b[5835] = u;
            b[5832] = t;
            b[u + 4 >> 2] = t | 1;
            b[j + v + 4 >> 2] = 40;
            b[5836] = b[5951];
            break;
          }

          if (g >>> 0 < (b[5833] | 0) >>> 0) { b[5833] = g; }
          d = g + h | 0;
          c = 23764;

          while (1) {
            if ((b[c >> 2] | 0) == (d | 0)) {
              q = 162;
              break;
            }

            a = b[c + 8 >> 2] | 0;
            if (!a) { break; }else { c = a; }
          }

          if ((q | 0) == 162 ? (b[c + 12 >> 2] & 8 | 0) == 0 : 0) {
            b[c >> 2] = g;
            l = c + 4 | 0;
            b[l >> 2] = (b[l >> 2] | 0) + h;
            l = g + 8 | 0;
            l = g + ((l & 7 | 0) == 0 ? 0 : 0 - l & 7) | 0;
            c = d + 8 | 0;
            c = d + ((c & 7 | 0) == 0 ? 0 : 0 - c & 7) | 0;
            k = l + m | 0;
            i = c - l - m | 0;
            b[l + 4 >> 2] = m | 3;

            g: do { if ((j | 0) == (c | 0)) {
              v = (b[5832] | 0) + i | 0;
              b[5832] = v;
              b[5835] = k;
              b[k + 4 >> 2] = v | 1;
            } else {
              if ((b[5834] | 0) == (c | 0)) {
                v = (b[5831] | 0) + i | 0;
                b[5831] = v;
                b[5834] = k;
                b[k + 4 >> 2] = v | 1;
                b[k + v >> 2] = v;
                break;
              }

              a = b[c + 4 >> 2] | 0;

              if ((a & 3 | 0) == 1) {
                h = a & -8;
                e = a >>> 3;

                h: do { if (a >>> 0 < 256) {
                  a = b[c + 8 >> 2] | 0;
                  d = b[c + 12 >> 2] | 0;

                  if ((d | 0) == (a | 0)) {
                    b[5829] = b[5829] & ~(1 << e);
                    break;
                  } else {
                    b[a + 12 >> 2] = d;
                    b[d + 8 >> 2] = a;
                    break;
                  }
                } else {
                  g = b[c + 24 >> 2] | 0;
                  a = b[c + 12 >> 2] | 0;

                  do { if ((a | 0) == (c | 0)) {
                    d = c + 16 | 0;
                    e = d + 4 | 0;
                    a = b[e >> 2] | 0;

                    if (!a) {
                      a = b[d >> 2] | 0;

                      if (!a) {
                        a = 0;
                        break;
                      }
                    } else { d = e; }

                    while (1) {
                      f = a + 20 | 0;
                      e = b[f >> 2] | 0;

                      if (!e) {
                        f = a + 16 | 0;
                        e = b[f >> 2] | 0;
                        if (!e) { break; }else {
                          a = e;
                          d = f;
                        }
                      } else {
                        a = e;
                        d = f;
                      }
                    }

                    b[d >> 2] = 0;
                  } else {
                    v = b[c + 8 >> 2] | 0;
                    b[v + 12 >> 2] = a;
                    b[a + 8 >> 2] = v;
                  } } while (0);

                  if (!g) { break; }
                  d = b[c + 28 >> 2] | 0;
                  e = 23620 + (d << 2) | 0;

                  do { if ((b[e >> 2] | 0) != (c | 0)) {
                    v = g + 16 | 0;
                    b[((b[v >> 2] | 0) == (c | 0) ? v : g + 20 | 0) >> 2] = a;
                    if (!a) { break h; }
                  } else {
                    b[e >> 2] = a;
                    if (a | 0) { break; }
                    b[5830] = b[5830] & ~(1 << d);
                    break h;
                  } } while (0);

                  b[a + 24 >> 2] = g;
                  d = c + 16 | 0;
                  e = b[d >> 2] | 0;

                  if (e | 0) {
                    b[a + 16 >> 2] = e;
                    b[e + 24 >> 2] = a;
                  }

                  d = b[d + 4 >> 2] | 0;
                  if (!d) { break; }
                  b[a + 20 >> 2] = d;
                  b[d + 24 >> 2] = a;
                } } while (0);

                c = c + h | 0;
                f = h + i | 0;
              } else { f = i; }

              c = c + 4 | 0;
              b[c >> 2] = b[c >> 2] & -2;
              b[k + 4 >> 2] = f | 1;
              b[k + f >> 2] = f;
              c = f >>> 3;

              if (f >>> 0 < 256) {
                d = 23356 + (c << 1 << 2) | 0;
                a = b[5829] | 0;
                c = 1 << c;

                if (!(a & c)) {
                  b[5829] = a | c;
                  c = d;
                  a = d + 8 | 0;
                } else {
                  a = d + 8 | 0;
                  c = b[a >> 2] | 0;
                }

                b[a >> 2] = k;
                b[c + 12 >> 2] = k;
                b[k + 8 >> 2] = c;
                b[k + 12 >> 2] = d;
                break;
              }

              c = f >>> 8;

              do { if (!c) { e = 0; }else {
                if (f >>> 0 > 16777215) {
                  e = 31;
                  break;
                }

                u = (c + 1048320 | 0) >>> 16 & 8;
                v = c << u;
                t = (v + 520192 | 0) >>> 16 & 4;
                v = v << t;
                e = (v + 245760 | 0) >>> 16 & 2;
                e = 14 - (t | u | e) + (v << e >>> 15) | 0;
                e = f >>> (e + 7 | 0) & 1 | e << 1;
              } } while (0);

              c = 23620 + (e << 2) | 0;
              b[k + 28 >> 2] = e;
              a = k + 16 | 0;
              b[a + 4 >> 2] = 0;
              b[a >> 2] = 0;
              a = b[5830] | 0;
              d = 1 << e;

              if (!(a & d)) {
                b[5830] = a | d;
                b[c >> 2] = k;
                b[k + 24 >> 2] = c;
                b[k + 12 >> 2] = k;
                b[k + 8 >> 2] = k;
                break;
              }

              c = b[c >> 2] | 0;

              i: do { if ((b[c + 4 >> 2] & -8 | 0) != (f | 0)) {
                e = f << ((e | 0) == 31 ? 0 : 25 - (e >>> 1) | 0);

                while (1) {
                  d = c + 16 + (e >>> 31 << 2) | 0;
                  a = b[d >> 2] | 0;
                  if (!a) { break; }

                  if ((b[a + 4 >> 2] & -8 | 0) == (f | 0)) {
                    c = a;
                    break i;
                  } else {
                    e = e << 1;
                    c = a;
                  }
                }

                b[d >> 2] = k;
                b[k + 24 >> 2] = c;
                b[k + 12 >> 2] = k;
                b[k + 8 >> 2] = k;
                break g;
              } } while (0);

              u = c + 8 | 0;
              v = b[u >> 2] | 0;
              b[v + 12 >> 2] = k;
              b[u >> 2] = k;
              b[k + 8 >> 2] = v;
              b[k + 12 >> 2] = c;
              b[k + 24 >> 2] = 0;
            } } while (0);

            v = l + 8 | 0;
            S = w;
            return v | 0;
          }

          c = 23764;

          while (1) {
            a = b[c >> 2] | 0;
            if (a >>> 0 <= j >>> 0 ? (v = a + (b[c + 4 >> 2] | 0) | 0, v >>> 0 > j >>> 0) : 0) { break; }
            c = b[c + 8 >> 2] | 0;
          }

          f = v + -47 | 0;
          a = f + 8 | 0;
          a = f + ((a & 7 | 0) == 0 ? 0 : 0 - a & 7) | 0;
          f = j + 16 | 0;
          a = a >>> 0 < f >>> 0 ? j : a;
          c = a + 8 | 0;
          d = h + -40 | 0;
          t = g + 8 | 0;
          t = (t & 7 | 0) == 0 ? 0 : 0 - t & 7;
          u = g + t | 0;
          t = d - t | 0;
          b[5835] = u;
          b[5832] = t;
          b[u + 4 >> 2] = t | 1;
          b[g + d + 4 >> 2] = 40;
          b[5836] = b[5951];
          d = a + 4 | 0;
          b[d >> 2] = 27;
          b[c >> 2] = b[5941];
          b[c + 4 >> 2] = b[5942];
          b[c + 8 >> 2] = b[5943];
          b[c + 12 >> 2] = b[5944];
          b[5941] = g;
          b[5942] = h;
          b[5944] = 0;
          b[5943] = c;
          c = a + 24 | 0;

          do {
            u = c;
            c = c + 4 | 0;
            b[c >> 2] = 7;
          } while ((u + 8 | 0) >>> 0 < v >>> 0);

          if ((a | 0) != (j | 0)) {
            g = a - j | 0;
            b[d >> 2] = b[d >> 2] & -2;
            b[j + 4 >> 2] = g | 1;
            b[a >> 2] = g;
            c = g >>> 3;

            if (g >>> 0 < 256) {
              d = 23356 + (c << 1 << 2) | 0;
              a = b[5829] | 0;
              c = 1 << c;

              if (!(a & c)) {
                b[5829] = a | c;
                c = d;
                a = d + 8 | 0;
              } else {
                a = d + 8 | 0;
                c = b[a >> 2] | 0;
              }

              b[a >> 2] = j;
              b[c + 12 >> 2] = j;
              b[j + 8 >> 2] = c;
              b[j + 12 >> 2] = d;
              break;
            }

            c = g >>> 8;
            if (c) {
              if (g >>> 0 > 16777215) { e = 31; }else {
                u = (c + 1048320 | 0) >>> 16 & 8;
                v = c << u;
                t = (v + 520192 | 0) >>> 16 & 4;
                v = v << t;
                e = (v + 245760 | 0) >>> 16 & 2;
                e = 14 - (t | u | e) + (v << e >>> 15) | 0;
                e = g >>> (e + 7 | 0) & 1 | e << 1;
              }
            } else { e = 0; }
            d = 23620 + (e << 2) | 0;
            b[j + 28 >> 2] = e;
            b[j + 20 >> 2] = 0;
            b[f >> 2] = 0;
            c = b[5830] | 0;
            a = 1 << e;

            if (!(c & a)) {
              b[5830] = c | a;
              b[d >> 2] = j;
              b[j + 24 >> 2] = d;
              b[j + 12 >> 2] = j;
              b[j + 8 >> 2] = j;
              break;
            }

            c = b[d >> 2] | 0;

            j: do { if ((b[c + 4 >> 2] & -8 | 0) != (g | 0)) {
              e = g << ((e | 0) == 31 ? 0 : 25 - (e >>> 1) | 0);

              while (1) {
                d = c + 16 + (e >>> 31 << 2) | 0;
                a = b[d >> 2] | 0;
                if (!a) { break; }

                if ((b[a + 4 >> 2] & -8 | 0) == (g | 0)) {
                  c = a;
                  break j;
                } else {
                  e = e << 1;
                  c = a;
                }
              }

              b[d >> 2] = j;
              b[j + 24 >> 2] = c;
              b[j + 12 >> 2] = j;
              b[j + 8 >> 2] = j;
              break f;
            } } while (0);

            u = c + 8 | 0;
            v = b[u >> 2] | 0;
            b[v + 12 >> 2] = j;
            b[u >> 2] = j;
            b[j + 8 >> 2] = v;
            b[j + 12 >> 2] = c;
            b[j + 24 >> 2] = 0;
          }
        } else {
          v = b[5833] | 0;
          if ((v | 0) == 0 | g >>> 0 < v >>> 0) { b[5833] = g; }
          b[5941] = g;
          b[5942] = h;
          b[5944] = 0;
          b[5838] = b[5947];
          b[5837] = -1;
          b[5842] = 23356;
          b[5841] = 23356;
          b[5844] = 23364;
          b[5843] = 23364;
          b[5846] = 23372;
          b[5845] = 23372;
          b[5848] = 23380;
          b[5847] = 23380;
          b[5850] = 23388;
          b[5849] = 23388;
          b[5852] = 23396;
          b[5851] = 23396;
          b[5854] = 23404;
          b[5853] = 23404;
          b[5856] = 23412;
          b[5855] = 23412;
          b[5858] = 23420;
          b[5857] = 23420;
          b[5860] = 23428;
          b[5859] = 23428;
          b[5862] = 23436;
          b[5861] = 23436;
          b[5864] = 23444;
          b[5863] = 23444;
          b[5866] = 23452;
          b[5865] = 23452;
          b[5868] = 23460;
          b[5867] = 23460;
          b[5870] = 23468;
          b[5869] = 23468;
          b[5872] = 23476;
          b[5871] = 23476;
          b[5874] = 23484;
          b[5873] = 23484;
          b[5876] = 23492;
          b[5875] = 23492;
          b[5878] = 23500;
          b[5877] = 23500;
          b[5880] = 23508;
          b[5879] = 23508;
          b[5882] = 23516;
          b[5881] = 23516;
          b[5884] = 23524;
          b[5883] = 23524;
          b[5886] = 23532;
          b[5885] = 23532;
          b[5888] = 23540;
          b[5887] = 23540;
          b[5890] = 23548;
          b[5889] = 23548;
          b[5892] = 23556;
          b[5891] = 23556;
          b[5894] = 23564;
          b[5893] = 23564;
          b[5896] = 23572;
          b[5895] = 23572;
          b[5898] = 23580;
          b[5897] = 23580;
          b[5900] = 23588;
          b[5899] = 23588;
          b[5902] = 23596;
          b[5901] = 23596;
          b[5904] = 23604;
          b[5903] = 23604;
          v = h + -40 | 0;
          t = g + 8 | 0;
          t = (t & 7 | 0) == 0 ? 0 : 0 - t & 7;
          u = g + t | 0;
          t = v - t | 0;
          b[5835] = u;
          b[5832] = t;
          b[u + 4 >> 2] = t | 1;
          b[g + v + 4 >> 2] = 40;
          b[5836] = b[5951];
        } } while (0);

        c = b[5832] | 0;

        if (c >>> 0 > m >>> 0) {
          t = c - m | 0;
          b[5832] = t;
          v = b[5835] | 0;
          u = v + m | 0;
          b[5835] = u;
          b[u + 4 >> 2] = t | 1;
          b[v + 4 >> 2] = m | 3;
          v = v + 8 | 0;
          S = w;
          return v | 0;
        }
      }

      v = Tc() | 0;
      b[v >> 2] = 12;
      v = 0;
      S = w;
      return v | 0;
    }

    function Xc(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0,
          f = 0,
          g = 0,
          h = 0,
          i = 0,
          j = 0;
      if (!a) { return; }
      d = a + -8 | 0;
      f = b[5833] | 0;
      a = b[a + -4 >> 2] | 0;
      c = a & -8;
      j = d + c | 0;

      do { if (!(a & 1)) {
        e = b[d >> 2] | 0;
        if (!(a & 3)) { return; }
        h = d + (0 - e) | 0;
        g = e + c | 0;
        if (h >>> 0 < f >>> 0) { return; }

        if ((b[5834] | 0) == (h | 0)) {
          a = j + 4 | 0;
          c = b[a >> 2] | 0;

          if ((c & 3 | 0) != 3) {
            i = h;
            c = g;
            break;
          }

          b[5831] = g;
          b[a >> 2] = c & -2;
          b[h + 4 >> 2] = g | 1;
          b[h + g >> 2] = g;
          return;
        }

        d = e >>> 3;

        if (e >>> 0 < 256) {
          a = b[h + 8 >> 2] | 0;
          c = b[h + 12 >> 2] | 0;

          if ((c | 0) == (a | 0)) {
            b[5829] = b[5829] & ~(1 << d);
            i = h;
            c = g;
            break;
          } else {
            b[a + 12 >> 2] = c;
            b[c + 8 >> 2] = a;
            i = h;
            c = g;
            break;
          }
        }

        f = b[h + 24 >> 2] | 0;
        a = b[h + 12 >> 2] | 0;

        do { if ((a | 0) == (h | 0)) {
          c = h + 16 | 0;
          d = c + 4 | 0;
          a = b[d >> 2] | 0;

          if (!a) {
            a = b[c >> 2] | 0;

            if (!a) {
              a = 0;
              break;
            }
          } else { c = d; }

          while (1) {
            e = a + 20 | 0;
            d = b[e >> 2] | 0;

            if (!d) {
              e = a + 16 | 0;
              d = b[e >> 2] | 0;
              if (!d) { break; }else {
                a = d;
                c = e;
              }
            } else {
              a = d;
              c = e;
            }
          }

          b[c >> 2] = 0;
        } else {
          i = b[h + 8 >> 2] | 0;
          b[i + 12 >> 2] = a;
          b[a + 8 >> 2] = i;
        } } while (0);

        if (f) {
          c = b[h + 28 >> 2] | 0;
          d = 23620 + (c << 2) | 0;

          if ((b[d >> 2] | 0) == (h | 0)) {
            b[d >> 2] = a;

            if (!a) {
              b[5830] = b[5830] & ~(1 << c);
              i = h;
              c = g;
              break;
            }
          } else {
            i = f + 16 | 0;
            b[((b[i >> 2] | 0) == (h | 0) ? i : f + 20 | 0) >> 2] = a;

            if (!a) {
              i = h;
              c = g;
              break;
            }
          }

          b[a + 24 >> 2] = f;
          c = h + 16 | 0;
          d = b[c >> 2] | 0;

          if (d | 0) {
            b[a + 16 >> 2] = d;
            b[d + 24 >> 2] = a;
          }

          c = b[c + 4 >> 2] | 0;

          if (c) {
            b[a + 20 >> 2] = c;
            b[c + 24 >> 2] = a;
            i = h;
            c = g;
          } else {
            i = h;
            c = g;
          }
        } else {
          i = h;
          c = g;
        }
      } else {
        i = d;
        h = d;
      } } while (0);

      if (h >>> 0 >= j >>> 0) { return; }
      a = j + 4 | 0;
      e = b[a >> 2] | 0;
      if (!(e & 1)) { return; }

      if (!(e & 2)) {
        if ((b[5835] | 0) == (j | 0)) {
          j = (b[5832] | 0) + c | 0;
          b[5832] = j;
          b[5835] = i;
          b[i + 4 >> 2] = j | 1;
          if ((i | 0) != (b[5834] | 0)) { return; }
          b[5834] = 0;
          b[5831] = 0;
          return;
        }

        if ((b[5834] | 0) == (j | 0)) {
          j = (b[5831] | 0) + c | 0;
          b[5831] = j;
          b[5834] = h;
          b[i + 4 >> 2] = j | 1;
          b[h + j >> 2] = j;
          return;
        }

        f = (e & -8) + c | 0;
        d = e >>> 3;

        do { if (e >>> 0 < 256) {
          c = b[j + 8 >> 2] | 0;
          a = b[j + 12 >> 2] | 0;

          if ((a | 0) == (c | 0)) {
            b[5829] = b[5829] & ~(1 << d);
            break;
          } else {
            b[c + 12 >> 2] = a;
            b[a + 8 >> 2] = c;
            break;
          }
        } else {
          g = b[j + 24 >> 2] | 0;
          a = b[j + 12 >> 2] | 0;

          do { if ((a | 0) == (j | 0)) {
            c = j + 16 | 0;
            d = c + 4 | 0;
            a = b[d >> 2] | 0;

            if (!a) {
              a = b[c >> 2] | 0;

              if (!a) {
                d = 0;
                break;
              }
            } else { c = d; }

            while (1) {
              e = a + 20 | 0;
              d = b[e >> 2] | 0;

              if (!d) {
                e = a + 16 | 0;
                d = b[e >> 2] | 0;
                if (!d) { break; }else {
                  a = d;
                  c = e;
                }
              } else {
                a = d;
                c = e;
              }
            }

            b[c >> 2] = 0;
            d = a;
          } else {
            d = b[j + 8 >> 2] | 0;
            b[d + 12 >> 2] = a;
            b[a + 8 >> 2] = d;
            d = a;
          } } while (0);

          if (g | 0) {
            a = b[j + 28 >> 2] | 0;
            c = 23620 + (a << 2) | 0;

            if ((b[c >> 2] | 0) == (j | 0)) {
              b[c >> 2] = d;

              if (!d) {
                b[5830] = b[5830] & ~(1 << a);
                break;
              }
            } else {
              e = g + 16 | 0;
              b[((b[e >> 2] | 0) == (j | 0) ? e : g + 20 | 0) >> 2] = d;
              if (!d) { break; }
            }

            b[d + 24 >> 2] = g;
            a = j + 16 | 0;
            c = b[a >> 2] | 0;

            if (c | 0) {
              b[d + 16 >> 2] = c;
              b[c + 24 >> 2] = d;
            }

            a = b[a + 4 >> 2] | 0;

            if (a | 0) {
              b[d + 20 >> 2] = a;
              b[a + 24 >> 2] = d;
            }
          }
        } } while (0);

        b[i + 4 >> 2] = f | 1;
        b[h + f >> 2] = f;

        if ((i | 0) == (b[5834] | 0)) {
          b[5831] = f;
          return;
        }
      } else {
        b[a >> 2] = e & -2;
        b[i + 4 >> 2] = c | 1;
        b[h + c >> 2] = c;
        f = c;
      }

      a = f >>> 3;

      if (f >>> 0 < 256) {
        d = 23356 + (a << 1 << 2) | 0;
        c = b[5829] | 0;
        a = 1 << a;

        if (!(c & a)) {
          b[5829] = c | a;
          a = d;
          c = d + 8 | 0;
        } else {
          c = d + 8 | 0;
          a = b[c >> 2] | 0;
        }

        b[c >> 2] = i;
        b[a + 12 >> 2] = i;
        b[i + 8 >> 2] = a;
        b[i + 12 >> 2] = d;
        return;
      }

      a = f >>> 8;
      if (a) {
        if (f >>> 0 > 16777215) { e = 31; }else {
          h = (a + 1048320 | 0) >>> 16 & 8;
          j = a << h;
          g = (j + 520192 | 0) >>> 16 & 4;
          j = j << g;
          e = (j + 245760 | 0) >>> 16 & 2;
          e = 14 - (g | h | e) + (j << e >>> 15) | 0;
          e = f >>> (e + 7 | 0) & 1 | e << 1;
        }
      } else { e = 0; }
      a = 23620 + (e << 2) | 0;
      b[i + 28 >> 2] = e;
      b[i + 20 >> 2] = 0;
      b[i + 16 >> 2] = 0;
      c = b[5830] | 0;
      d = 1 << e;

      a: do { if (!(c & d)) {
        b[5830] = c | d;
        b[a >> 2] = i;
        b[i + 24 >> 2] = a;
        b[i + 12 >> 2] = i;
        b[i + 8 >> 2] = i;
      } else {
        a = b[a >> 2] | 0;

        b: do { if ((b[a + 4 >> 2] & -8 | 0) != (f | 0)) {
          e = f << ((e | 0) == 31 ? 0 : 25 - (e >>> 1) | 0);

          while (1) {
            d = a + 16 + (e >>> 31 << 2) | 0;
            c = b[d >> 2] | 0;
            if (!c) { break; }

            if ((b[c + 4 >> 2] & -8 | 0) == (f | 0)) {
              a = c;
              break b;
            } else {
              e = e << 1;
              a = c;
            }
          }

          b[d >> 2] = i;
          b[i + 24 >> 2] = a;
          b[i + 12 >> 2] = i;
          b[i + 8 >> 2] = i;
          break a;
        } } while (0);

        h = a + 8 | 0;
        j = b[h >> 2] | 0;
        b[j + 12 >> 2] = i;
        b[h >> 2] = i;
        b[i + 8 >> 2] = j;
        b[i + 12 >> 2] = a;
        b[i + 24 >> 2] = 0;
      } } while (0);

      j = (b[5837] | 0) + -1 | 0;
      b[5837] = j;
      if (j | 0) { return; }
      a = 23772;

      while (1) {
        a = b[a >> 2] | 0;
        if (!a) { break; }else { a = a + 8 | 0; }
      }

      b[5837] = -1;
      return;
    }

    function Yc(a, c) {
      a = a | 0;
      c = c | 0;
      var d = 0;

      if (a) {
        d = B(c, a) | 0;
        if ((c | a) >>> 0 > 65535) { d = ((d >>> 0) / (a >>> 0) | 0 | 0) == (c | 0) ? d : -1; }
      } else { d = 0; }

      a = Wc(d) | 0;
      if (!a) { return a | 0; }
      if (!(b[a + -4 >> 2] & 3)) { return a | 0; }
      hd(a | 0, 0, d | 0) | 0;
      return a | 0;
    }

    function Zc(a, b, c, d) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      c = a + c >>> 0;
      return (F(b + d + (c >>> 0 < a >>> 0 | 0) >>> 0 | 0), c | 0) | 0;
    }

    function _c(a, b, c, d) {
      a = a | 0;
      b = b | 0;
      c = c | 0;
      d = d | 0;
      d = b - d - (c >>> 0 > a >>> 0 | 0) >>> 0;
      return (F(d | 0), a - c >>> 0 | 0) | 0;
    }

    function $c(a) {
      a = a | 0;
      return (a ? 31 - (D(a ^ a - 1) | 0) | 0 : 32) | 0;
    }

    function ad(a, c, d, e, f) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      f = f | 0;
      var g = 0,
          h = 0,
          i = 0,
          j = 0,
          k = 0,
          l = 0,
          m = 0,
          n = 0,
          o = 0,
          p = 0;
      l = a;
      j = c;
      k = j;
      h = d;
      n = e;
      i = n;

      if (!k) {
        g = (f | 0) != 0;

        if (!i) {
          if (g) {
            b[f >> 2] = (l >>> 0) % (h >>> 0);
            b[f + 4 >> 2] = 0;
          }

          n = 0;
          f = (l >>> 0) / (h >>> 0) >>> 0;
          return (F(n | 0), f) | 0;
        } else {
          if (!g) {
            n = 0;
            f = 0;
            return (F(n | 0), f) | 0;
          }

          b[f >> 2] = a | 0;
          b[f + 4 >> 2] = c & 0;
          n = 0;
          f = 0;
          return (F(n | 0), f) | 0;
        }
      }

      g = (i | 0) == 0;

      do { if (h) {
        if (!g) {
          g = (D(i | 0) | 0) - (D(k | 0) | 0) | 0;

          if (g >>> 0 <= 31) {
            m = g + 1 | 0;
            i = 31 - g | 0;
            c = g - 31 >> 31;
            h = m;
            a = l >>> (m >>> 0) & c | k << i;
            c = k >>> (m >>> 0) & c;
            g = 0;
            i = l << i;
            break;
          }

          if (!f) {
            n = 0;
            f = 0;
            return (F(n | 0), f) | 0;
          }

          b[f >> 2] = a | 0;
          b[f + 4 >> 2] = j | c & 0;
          n = 0;
          f = 0;
          return (F(n | 0), f) | 0;
        }

        g = h - 1 | 0;

        if (g & h | 0) {
          i = (D(h | 0) | 0) + 33 - (D(k | 0) | 0) | 0;
          p = 64 - i | 0;
          m = 32 - i | 0;
          j = m >> 31;
          o = i - 32 | 0;
          c = o >> 31;
          h = i;
          a = m - 1 >> 31 & k >>> (o >>> 0) | (k << m | l >>> (i >>> 0)) & c;
          c = c & k >>> (i >>> 0);
          g = l << p & j;
          i = (k << p | l >>> (o >>> 0)) & j | l << m & i - 33 >> 31;
          break;
        }

        if (f | 0) {
          b[f >> 2] = g & l;
          b[f + 4 >> 2] = 0;
        }

        if ((h | 0) == 1) {
          o = j | c & 0;
          p = a | 0 | 0;
          return (F(o | 0), p) | 0;
        } else {
          p = $c(h | 0) | 0;
          o = k >>> (p >>> 0) | 0;
          p = k << 32 - p | l >>> (p >>> 0) | 0;
          return (F(o | 0), p) | 0;
        }
      } else {
        if (g) {
          if (f | 0) {
            b[f >> 2] = (k >>> 0) % (h >>> 0);
            b[f + 4 >> 2] = 0;
          }

          o = 0;
          p = (k >>> 0) / (h >>> 0) >>> 0;
          return (F(o | 0), p) | 0;
        }

        if (!l) {
          if (f | 0) {
            b[f >> 2] = 0;
            b[f + 4 >> 2] = (k >>> 0) % (i >>> 0);
          }

          o = 0;
          p = (k >>> 0) / (i >>> 0) >>> 0;
          return (F(o | 0), p) | 0;
        }

        g = i - 1 | 0;

        if (!(g & i)) {
          if (f | 0) {
            b[f >> 2] = a | 0;
            b[f + 4 >> 2] = g & k | c & 0;
          }

          o = 0;
          p = k >>> (($c(i | 0) | 0) >>> 0);
          return (F(o | 0), p) | 0;
        }

        g = (D(i | 0) | 0) - (D(k | 0) | 0) | 0;

        if (g >>> 0 <= 30) {
          c = g + 1 | 0;
          i = 31 - g | 0;
          h = c;
          a = k << i | l >>> (c >>> 0);
          c = k >>> (c >>> 0);
          g = 0;
          i = l << i;
          break;
        }

        if (!f) {
          o = 0;
          p = 0;
          return (F(o | 0), p) | 0;
        }

        b[f >> 2] = a | 0;
        b[f + 4 >> 2] = j | c & 0;
        o = 0;
        p = 0;
        return (F(o | 0), p) | 0;
      } } while (0);

      if (!h) {
        k = i;
        j = 0;
        i = 0;
      } else {
        m = d | 0 | 0;
        l = n | e & 0;
        k = Zc(m | 0, l | 0, -1, -1) | 0;
        d = G() | 0;
        j = i;
        i = 0;

        do {
          e = j;
          j = g >>> 31 | j << 1;
          g = i | g << 1;
          e = a << 1 | e >>> 31 | 0;
          n = a >>> 31 | c << 1 | 0;
          _c(k | 0, d | 0, e | 0, n | 0) | 0;
          p = G() | 0;
          o = p >> 31 | ((p | 0) < 0 ? -1 : 0) << 1;
          i = o & 1;
          a = _c(e | 0, n | 0, o & m | 0, (((p | 0) < 0 ? -1 : 0) >> 31 | ((p | 0) < 0 ? -1 : 0) << 1) & l | 0) | 0;
          c = G() | 0;
          h = h - 1 | 0;
        } while ((h | 0) != 0);

        k = j;
        j = 0;
      }

      h = 0;

      if (f | 0) {
        b[f >> 2] = a;
        b[f + 4 >> 2] = c;
      }

      o = (g | 0) >>> 31 | (k | h) << 1 | (h << 1 | g >>> 31) & 0 | j;
      p = (g << 1 | 0 >>> 31) & -2 | i;
      return (F(o | 0), p) | 0;
    }

    function bd(a, c, d, e) {
      a = a | 0;
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0;
      g = S;
      S = S + 16 | 0;
      f = g | 0;
      ad(a, c, d, e, f) | 0;
      S = g;
      return (F(b[f + 4 >> 2] | 0), b[f >> 2] | 0) | 0;
    }

    function cd(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;

      if ((c | 0) < 32) {
        F(b >>> c | 0);
        return a >>> c | (b & (1 << c) - 1) << 32 - c;
      }

      F(0);
      return b >>> c - 32 | 0;
    }

    function dd(a, b, c) {
      a = a | 0;
      b = b | 0;
      c = c | 0;

      if ((c | 0) < 32) {
        F(b << c | (a & (1 << c) - 1 << 32 - c) >>> 32 - c | 0);
        return a << c;
      }

      F(a << c - 32 | 0);
      return 0;
    }

    function ed(a, b) {
      a = +a;
      b = +b;
      if (a != a) { return +b; }
      if (b != b) { return +a; }
      return +C(+a, +b);
    }

    function fd(a) {
      a = +a;
      return a >= 0.0 ? +p(a + .5) : +A(a - .5);
    }

    function gd(c, d, e) {
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0;

      if ((e | 0) >= 8192) {
        K(c | 0, d | 0, e | 0) | 0;
        return c | 0;
      }

      h = c | 0;
      g = c + e | 0;

      if ((c & 3) == (d & 3)) {
        while (c & 3) {
          if (!e) { return h | 0; }
          a[c >> 0] = a[d >> 0] | 0;
          c = c + 1 | 0;
          d = d + 1 | 0;
          e = e - 1 | 0;
        }

        e = g & -4 | 0;
        f = e - 64 | 0;

        while ((c | 0) <= (f | 0)) {
          b[c >> 2] = b[d >> 2];
          b[c + 4 >> 2] = b[d + 4 >> 2];
          b[c + 8 >> 2] = b[d + 8 >> 2];
          b[c + 12 >> 2] = b[d + 12 >> 2];
          b[c + 16 >> 2] = b[d + 16 >> 2];
          b[c + 20 >> 2] = b[d + 20 >> 2];
          b[c + 24 >> 2] = b[d + 24 >> 2];
          b[c + 28 >> 2] = b[d + 28 >> 2];
          b[c + 32 >> 2] = b[d + 32 >> 2];
          b[c + 36 >> 2] = b[d + 36 >> 2];
          b[c + 40 >> 2] = b[d + 40 >> 2];
          b[c + 44 >> 2] = b[d + 44 >> 2];
          b[c + 48 >> 2] = b[d + 48 >> 2];
          b[c + 52 >> 2] = b[d + 52 >> 2];
          b[c + 56 >> 2] = b[d + 56 >> 2];
          b[c + 60 >> 2] = b[d + 60 >> 2];
          c = c + 64 | 0;
          d = d + 64 | 0;
        }

        while ((c | 0) < (e | 0)) {
          b[c >> 2] = b[d >> 2];
          c = c + 4 | 0;
          d = d + 4 | 0;
        }
      } else {
        e = g - 4 | 0;

        while ((c | 0) < (e | 0)) {
          a[c >> 0] = a[d >> 0] | 0;
          a[c + 1 >> 0] = a[d + 1 >> 0] | 0;
          a[c + 2 >> 0] = a[d + 2 >> 0] | 0;
          a[c + 3 >> 0] = a[d + 3 >> 0] | 0;
          c = c + 4 | 0;
          d = d + 4 | 0;
        }
      }

      while ((c | 0) < (g | 0)) {
        a[c >> 0] = a[d >> 0] | 0;
        c = c + 1 | 0;
        d = d + 1 | 0;
      }

      return h | 0;
    }

    function hd(c, d, e) {
      c = c | 0;
      d = d | 0;
      e = e | 0;
      var f = 0,
          g = 0,
          h = 0,
          i = 0;
      h = c + e | 0;
      d = d & 255;

      if ((e | 0) >= 67) {
        while (c & 3) {
          a[c >> 0] = d;
          c = c + 1 | 0;
        }

        f = h & -4 | 0;
        i = d | d << 8 | d << 16 | d << 24;
        g = f - 64 | 0;

        while ((c | 0) <= (g | 0)) {
          b[c >> 2] = i;
          b[c + 4 >> 2] = i;
          b[c + 8 >> 2] = i;
          b[c + 12 >> 2] = i;
          b[c + 16 >> 2] = i;
          b[c + 20 >> 2] = i;
          b[c + 24 >> 2] = i;
          b[c + 28 >> 2] = i;
          b[c + 32 >> 2] = i;
          b[c + 36 >> 2] = i;
          b[c + 40 >> 2] = i;
          b[c + 44 >> 2] = i;
          b[c + 48 >> 2] = i;
          b[c + 52 >> 2] = i;
          b[c + 56 >> 2] = i;
          b[c + 60 >> 2] = i;
          c = c + 64 | 0;
        }

        while ((c | 0) < (f | 0)) {
          b[c >> 2] = i;
          c = c + 4 | 0;
        }
      }

      while ((c | 0) < (h | 0)) {
        a[c >> 0] = d;
        c = c + 1 | 0;
      }

      return h - e | 0;
    }

    function id(a) {
      a = +a;
      return a >= 0.0 ? +p(a + .5) : +A(a - .5);
    }

    function jd(a) {
      a = a | 0;
      var c = 0,
          d = 0,
          e = 0;
      e = J() | 0;
      d = b[g >> 2] | 0;
      c = d + a | 0;

      if ((a | 0) > 0 & (c | 0) < (d | 0) | (c | 0) < 0) {
        M(c | 0) | 0;
        I(12);
        return -1;
      }

      if ((c | 0) > (e | 0)) { if (!(L(c | 0) | 0)) {
        I(12);
        return -1;
      } }
      b[g >> 2] = c;
      return d | 0;
    } // EMSCRIPTEN_END_FUNCS


    return {
      ___uremdi3: bd,
      _bitshift64Lshr: cd,
      _bitshift64Shl: dd,
      _calloc: Yc,
      _cellAreaKm2: ub,
      _cellAreaM2: vb,
      _cellAreaRads2: tb,
      _compact: Hb,
      _destroyLinkedPolygon: jc,
      _edgeLengthKm: pb,
      _edgeLengthM: qb,
      _emscripten_replace_memory: V,
      _exactEdgeLengthKm: xb,
      _exactEdgeLengthM: yb,
      _exactEdgeLengthRads: wb,
      _experimentalH3ToLocalIj: oc,
      _experimentalLocalIjToH3: pc,
      _free: Xc,
      _geoToH3: Sb,
      _getDestinationH3IndexFromUnidirectionalEdge: cc,
      _getH3IndexesFromUnidirectionalEdge: ec,
      _getH3UnidirectionalEdge: ac,
      _getH3UnidirectionalEdgeBoundary: gc,
      _getH3UnidirectionalEdgesFromHexagon: fc,
      _getOriginH3IndexFromUnidirectionalEdge: bc,
      _getPentagonIndexes: _b,
      _getRes0Indexes: va,
      _h3Distance: qc,
      _h3GetBaseCell: Ab,
      _h3GetFaces: Yb,
      _h3GetResolution: zb,
      _h3IndexesAreNeighbors: $b,
      _h3IsPentagon: Fb,
      _h3IsResClassIII: Kb,
      _h3IsValid: Bb,
      _h3Line: sc,
      _h3LineSize: rc,
      _h3SetToLinkedGeo: ka,
      _h3ToCenterChild: Gb,
      _h3ToChildren: Eb,
      _h3ToGeo: Vb,
      _h3ToGeoBoundary: Wb,
      _h3ToParent: Cb,
      _h3UnidirectionalEdgeIsValid: dc,
      _hexAreaKm2: nb,
      _hexAreaM2: ob,
      _hexRing: ea,
      _i64Subtract: _c,
      _kRing: $,
      _kRingDistances: aa,
      _llvm_minnum_f64: ed,
      _llvm_round_f64: fd,
      _malloc: Wc,
      _maxFaceCount: Xb,
      _maxH3ToChildrenSize: Db,
      _maxKringSize: _,
      _maxPolyfillSize: fa,
      _maxUncompactSize: Jb,
      _memcpy: gd,
      _memset: hd,
      _numHexagons: rb,
      _pentagonIndexCount: Zb,
      _pointDistKm: jb,
      _pointDistM: kb,
      _pointDistRads: ib,
      _polyfill: ga,
      _res0IndexCount: ua,
      _round: id,
      _sbrk: jd,
      _sizeOfCoordIJ: Ec,
      _sizeOfGeoBoundary: Ac,
      _sizeOfGeoCoord: zc,
      _sizeOfGeoPolygon: Cc,
      _sizeOfGeofence: Bc,
      _sizeOfH3Index: yc,
      _sizeOfLinkedGeoPolygon: Dc,
      _uncompact: Ib,
      establishStackSpace: Z,
      stackAlloc: W,
      stackRestore: Y,
      stackSave: X
    };
  }( // EMSCRIPTEN_END_ASM
  asmGlobalArg, asmLibraryArg, buffer);

  var ___uremdi3 = Module["___uremdi3"] = asm["___uremdi3"];

  var _bitshift64Lshr = Module["_bitshift64Lshr"] = asm["_bitshift64Lshr"];

  var _bitshift64Shl = Module["_bitshift64Shl"] = asm["_bitshift64Shl"];

  var _calloc = Module["_calloc"] = asm["_calloc"];

  var _cellAreaKm2 = Module["_cellAreaKm2"] = asm["_cellAreaKm2"];

  var _cellAreaM2 = Module["_cellAreaM2"] = asm["_cellAreaM2"];

  var _cellAreaRads2 = Module["_cellAreaRads2"] = asm["_cellAreaRads2"];

  var _compact = Module["_compact"] = asm["_compact"];

  var _destroyLinkedPolygon = Module["_destroyLinkedPolygon"] = asm["_destroyLinkedPolygon"];

  var _edgeLengthKm = Module["_edgeLengthKm"] = asm["_edgeLengthKm"];

  var _edgeLengthM = Module["_edgeLengthM"] = asm["_edgeLengthM"];

  var _emscripten_replace_memory = Module["_emscripten_replace_memory"] = asm["_emscripten_replace_memory"];

  var _exactEdgeLengthKm = Module["_exactEdgeLengthKm"] = asm["_exactEdgeLengthKm"];

  var _exactEdgeLengthM = Module["_exactEdgeLengthM"] = asm["_exactEdgeLengthM"];

  var _exactEdgeLengthRads = Module["_exactEdgeLengthRads"] = asm["_exactEdgeLengthRads"];

  var _experimentalH3ToLocalIj = Module["_experimentalH3ToLocalIj"] = asm["_experimentalH3ToLocalIj"];

  var _experimentalLocalIjToH3 = Module["_experimentalLocalIjToH3"] = asm["_experimentalLocalIjToH3"];

  var _free = Module["_free"] = asm["_free"];

  var _geoToH3 = Module["_geoToH3"] = asm["_geoToH3"];

  var _getDestinationH3IndexFromUnidirectionalEdge = Module["_getDestinationH3IndexFromUnidirectionalEdge"] = asm["_getDestinationH3IndexFromUnidirectionalEdge"];

  var _getH3IndexesFromUnidirectionalEdge = Module["_getH3IndexesFromUnidirectionalEdge"] = asm["_getH3IndexesFromUnidirectionalEdge"];

  var _getH3UnidirectionalEdge = Module["_getH3UnidirectionalEdge"] = asm["_getH3UnidirectionalEdge"];

  var _getH3UnidirectionalEdgeBoundary = Module["_getH3UnidirectionalEdgeBoundary"] = asm["_getH3UnidirectionalEdgeBoundary"];

  var _getH3UnidirectionalEdgesFromHexagon = Module["_getH3UnidirectionalEdgesFromHexagon"] = asm["_getH3UnidirectionalEdgesFromHexagon"];

  var _getOriginH3IndexFromUnidirectionalEdge = Module["_getOriginH3IndexFromUnidirectionalEdge"] = asm["_getOriginH3IndexFromUnidirectionalEdge"];

  var _getPentagonIndexes = Module["_getPentagonIndexes"] = asm["_getPentagonIndexes"];

  var _getRes0Indexes = Module["_getRes0Indexes"] = asm["_getRes0Indexes"];

  var _h3Distance = Module["_h3Distance"] = asm["_h3Distance"];

  var _h3GetBaseCell = Module["_h3GetBaseCell"] = asm["_h3GetBaseCell"];

  var _h3GetFaces = Module["_h3GetFaces"] = asm["_h3GetFaces"];

  var _h3GetResolution = Module["_h3GetResolution"] = asm["_h3GetResolution"];

  var _h3IndexesAreNeighbors = Module["_h3IndexesAreNeighbors"] = asm["_h3IndexesAreNeighbors"];

  var _h3IsPentagon = Module["_h3IsPentagon"] = asm["_h3IsPentagon"];

  var _h3IsResClassIII = Module["_h3IsResClassIII"] = asm["_h3IsResClassIII"];

  var _h3IsValid = Module["_h3IsValid"] = asm["_h3IsValid"];

  var _h3Line = Module["_h3Line"] = asm["_h3Line"];

  var _h3LineSize = Module["_h3LineSize"] = asm["_h3LineSize"];

  var _h3SetToLinkedGeo = Module["_h3SetToLinkedGeo"] = asm["_h3SetToLinkedGeo"];

  var _h3ToCenterChild = Module["_h3ToCenterChild"] = asm["_h3ToCenterChild"];

  var _h3ToChildren = Module["_h3ToChildren"] = asm["_h3ToChildren"];

  var _h3ToGeo = Module["_h3ToGeo"] = asm["_h3ToGeo"];

  var _h3ToGeoBoundary = Module["_h3ToGeoBoundary"] = asm["_h3ToGeoBoundary"];

  var _h3ToParent = Module["_h3ToParent"] = asm["_h3ToParent"];

  var _h3UnidirectionalEdgeIsValid = Module["_h3UnidirectionalEdgeIsValid"] = asm["_h3UnidirectionalEdgeIsValid"];

  var _hexAreaKm2 = Module["_hexAreaKm2"] = asm["_hexAreaKm2"];

  var _hexAreaM2 = Module["_hexAreaM2"] = asm["_hexAreaM2"];

  var _hexRing = Module["_hexRing"] = asm["_hexRing"];

  var _i64Subtract = Module["_i64Subtract"] = asm["_i64Subtract"];

  var _kRing = Module["_kRing"] = asm["_kRing"];

  var _kRingDistances = Module["_kRingDistances"] = asm["_kRingDistances"];

  var _llvm_minnum_f64 = Module["_llvm_minnum_f64"] = asm["_llvm_minnum_f64"];

  var _llvm_round_f64 = Module["_llvm_round_f64"] = asm["_llvm_round_f64"];

  var _malloc = Module["_malloc"] = asm["_malloc"];

  var _maxFaceCount = Module["_maxFaceCount"] = asm["_maxFaceCount"];

  var _maxH3ToChildrenSize = Module["_maxH3ToChildrenSize"] = asm["_maxH3ToChildrenSize"];

  var _maxKringSize = Module["_maxKringSize"] = asm["_maxKringSize"];

  var _maxPolyfillSize = Module["_maxPolyfillSize"] = asm["_maxPolyfillSize"];

  var _maxUncompactSize = Module["_maxUncompactSize"] = asm["_maxUncompactSize"];

  var _memcpy = Module["_memcpy"] = asm["_memcpy"];

  var _memset = Module["_memset"] = asm["_memset"];

  var _numHexagons = Module["_numHexagons"] = asm["_numHexagons"];

  var _pentagonIndexCount = Module["_pentagonIndexCount"] = asm["_pentagonIndexCount"];

  var _pointDistKm = Module["_pointDistKm"] = asm["_pointDistKm"];

  var _pointDistM = Module["_pointDistM"] = asm["_pointDistM"];

  var _pointDistRads = Module["_pointDistRads"] = asm["_pointDistRads"];

  var _polyfill = Module["_polyfill"] = asm["_polyfill"];

  var _res0IndexCount = Module["_res0IndexCount"] = asm["_res0IndexCount"];

  var _round = Module["_round"] = asm["_round"];

  var _sbrk = Module["_sbrk"] = asm["_sbrk"];

  var _sizeOfCoordIJ = Module["_sizeOfCoordIJ"] = asm["_sizeOfCoordIJ"];

  var _sizeOfGeoBoundary = Module["_sizeOfGeoBoundary"] = asm["_sizeOfGeoBoundary"];

  var _sizeOfGeoCoord = Module["_sizeOfGeoCoord"] = asm["_sizeOfGeoCoord"];

  var _sizeOfGeoPolygon = Module["_sizeOfGeoPolygon"] = asm["_sizeOfGeoPolygon"];

  var _sizeOfGeofence = Module["_sizeOfGeofence"] = asm["_sizeOfGeofence"];

  var _sizeOfH3Index = Module["_sizeOfH3Index"] = asm["_sizeOfH3Index"];

  var _sizeOfLinkedGeoPolygon = Module["_sizeOfLinkedGeoPolygon"] = asm["_sizeOfLinkedGeoPolygon"];

  var _uncompact = Module["_uncompact"] = asm["_uncompact"];

  var establishStackSpace = Module["establishStackSpace"] = asm["establishStackSpace"];
  var stackAlloc = Module["stackAlloc"] = asm["stackAlloc"];
  var stackRestore = Module["stackRestore"] = asm["stackRestore"];
  var stackSave = Module["stackSave"] = asm["stackSave"];
  Module["asm"] = asm;
  Module["cwrap"] = cwrap;
  Module["setValue"] = setValue;
  Module["getValue"] = getValue;
  Module["getTempRet0"] = getTempRet0;

  if (memoryInitializer) {
    if (!isDataURI(memoryInitializer)) {
      memoryInitializer = locateFile(memoryInitializer);
    }

    {
      addRunDependency("memory initializer");

      var applyMemoryInitializer = function (data) {
        if (data.byteLength) { data = new Uint8Array(data); }
        HEAPU8.set(data, GLOBAL_BASE);
        if (Module["memoryInitializerRequest"]) { delete Module["memoryInitializerRequest"].response; }
        removeRunDependency("memory initializer");
      };

      var doBrowserLoad = function () {
        readAsync(memoryInitializer, applyMemoryInitializer, function () {
          throw "could not load memory initializer " + memoryInitializer;
        });
      };

      var memoryInitializerBytes = tryParseAsDataURI(memoryInitializer);

      if (memoryInitializerBytes) {
        applyMemoryInitializer(memoryInitializerBytes.buffer);
      } else if (Module["memoryInitializerRequest"]) {
        var useRequest = function () {
          var request = Module["memoryInitializerRequest"];
          var response = request.response;

          if (request.status !== 200 && request.status !== 0) {
            var data = tryParseAsDataURI(Module["memoryInitializerRequestURL"]);

            if (data) {
              response = data.buffer;
            } else {
              console.warn("a problem seems to have happened with Module.memoryInitializerRequest, status: " + request.status + ", retrying " + memoryInitializer);
              doBrowserLoad();
              return;
            }
          }

          applyMemoryInitializer(response);
        };

        if (Module["memoryInitializerRequest"].response) {
          setTimeout(useRequest, 0);
        } else {
          Module["memoryInitializerRequest"].addEventListener("load", useRequest);
        }
      } else {
        doBrowserLoad();
      }
    }
  }

  var calledRun;

  dependenciesFulfilled = function runCaller() {
    if (!calledRun) { run(); }
    if (!calledRun) { dependenciesFulfilled = runCaller; }
  };

  function run(args) {
    args = args || arguments_;

    if (runDependencies > 0) {
      return;
    }

    preRun();
    if (runDependencies > 0) { return; }

    function doRun() {
      if (calledRun) { return; }
      calledRun = true;
      if (ABORT) { return; }
      initRuntime();
      preMain();
      if (Module["onRuntimeInitialized"]) { Module["onRuntimeInitialized"](); }
      postRun();
    }

    if (Module["setStatus"]) {
      Module["setStatus"]("Running...");
      setTimeout(function () {
        setTimeout(function () {
          Module["setStatus"]("");
        }, 1);
        doRun();
      }, 1);
    } else {
      doRun();
    }
  }

  Module["run"] = run;

  function abort(what) {
    if (Module["onAbort"]) {
      Module["onAbort"](what);
    }

    what += "";
    out(what);
    err(what);
    ABORT = true;
    throw "abort(" + what + "). Build with -s ASSERTIONS=1 for more info.";
  }

  Module["abort"] = abort;

  if (Module["preInit"]) {
    if (typeof Module["preInit"] == "function") { Module["preInit"] = [Module["preInit"]]; }

    while (Module["preInit"].length > 0) {
      Module["preInit"].pop()();
    }
  }
  run();
  return libh3;
}(typeof libh3 === 'object' ? libh3 : {});

/*
 * Copyright 2018-2019 Uber Technologies, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// Define the C bindings for the h3 library
// Add some aliases to make the function definitions more intelligible
var NUMBER = 'number';
var BOOLEAN = NUMBER;
var H3_LOWER = NUMBER;
var H3_UPPER = NUMBER;
var RESOLUTION = NUMBER;
var POINTER = NUMBER; // Define the bindings to functions in the C lib. Functions are defined as
// [name, return type, [arg types]]. You must run `npm run build-emscripten`
// before new functions added here will be available.

var BINDINGS = [// The size functions are inserted via build/sizes.h
['sizeOfH3Index', NUMBER], ['sizeOfGeoCoord', NUMBER], ['sizeOfGeoBoundary', NUMBER], ['sizeOfGeoPolygon', NUMBER], ['sizeOfGeofence', NUMBER], ['sizeOfLinkedGeoPolygon', NUMBER], ['sizeOfCoordIJ', NUMBER], // The remaining functions are defined in the core lib in h3Api.h
['h3IsValid', BOOLEAN, [H3_LOWER, H3_UPPER]], ['geoToH3', H3_LOWER, [NUMBER, NUMBER, RESOLUTION]], ['h3ToGeo', null, [H3_LOWER, H3_UPPER, POINTER]], ['h3ToGeoBoundary', null, [H3_LOWER, H3_UPPER, POINTER]], ['maxKringSize', NUMBER, [NUMBER]], ['kRing', null, [H3_LOWER, H3_UPPER, NUMBER, POINTER]], ['kRingDistances', null, [H3_LOWER, H3_UPPER, NUMBER, POINTER, POINTER]], ['hexRing', null, [H3_LOWER, H3_UPPER, NUMBER, POINTER]], ['maxPolyfillSize', NUMBER, [POINTER, RESOLUTION]], ['polyfill', null, [POINTER, RESOLUTION, POINTER]], ['h3SetToLinkedGeo', null, [POINTER, NUMBER, POINTER]], ['destroyLinkedPolygon', null, [POINTER]], ['compact', NUMBER, [POINTER, POINTER, NUMBER]], ['uncompact', NUMBER, [POINTER, NUMBER, POINTER, NUMBER, RESOLUTION]], ['maxUncompactSize', NUMBER, [POINTER, NUMBER, RESOLUTION]], ['h3IsPentagon', BOOLEAN, [H3_LOWER, H3_UPPER]], ['h3IsResClassIII', BOOLEAN, [H3_LOWER, H3_UPPER]], ['h3GetBaseCell', NUMBER, [H3_LOWER, H3_UPPER]], ['h3GetResolution', NUMBER, [H3_LOWER, H3_UPPER]], ['maxFaceCount', NUMBER, [H3_LOWER, H3_UPPER]], ['h3GetFaces', null, [H3_LOWER, H3_UPPER, POINTER]], ['h3ToParent', H3_LOWER, [H3_LOWER, H3_UPPER, RESOLUTION]], ['h3ToChildren', null, [H3_LOWER, H3_UPPER, RESOLUTION, POINTER]], ['h3ToCenterChild', H3_LOWER, [H3_LOWER, H3_UPPER, RESOLUTION]], ['maxH3ToChildrenSize', NUMBER, [H3_LOWER, H3_UPPER, RESOLUTION]], ['h3IndexesAreNeighbors', BOOLEAN, [H3_LOWER, H3_UPPER, H3_LOWER, H3_UPPER]], ['getH3UnidirectionalEdge', H3_LOWER, [H3_LOWER, H3_UPPER, H3_LOWER, H3_UPPER]], ['getOriginH3IndexFromUnidirectionalEdge', H3_LOWER, [H3_LOWER, H3_UPPER]], ['getDestinationH3IndexFromUnidirectionalEdge', H3_LOWER, [H3_LOWER, H3_UPPER]], ['h3UnidirectionalEdgeIsValid', BOOLEAN, [H3_LOWER, H3_UPPER]], ['getH3IndexesFromUnidirectionalEdge', null, [H3_LOWER, H3_UPPER, POINTER]], ['getH3UnidirectionalEdgesFromHexagon', null, [H3_LOWER, H3_UPPER, POINTER]], ['getH3UnidirectionalEdgeBoundary', null, [H3_LOWER, H3_UPPER, POINTER]], ['h3Distance', NUMBER, [H3_LOWER, H3_UPPER, H3_LOWER, H3_UPPER]], ['h3Line', NUMBER, [H3_LOWER, H3_UPPER, H3_LOWER, H3_UPPER, POINTER]], ['h3LineSize', NUMBER, [H3_LOWER, H3_UPPER, H3_LOWER, H3_UPPER]], ['experimentalH3ToLocalIj', NUMBER, [H3_LOWER, H3_UPPER, H3_LOWER, H3_UPPER, POINTER]], ['experimentalLocalIjToH3', NUMBER, [H3_LOWER, H3_UPPER, POINTER, POINTER]], ['hexAreaM2', NUMBER, [RESOLUTION]], ['hexAreaKm2', NUMBER, [RESOLUTION]], ['edgeLengthM', NUMBER, [RESOLUTION]], ['edgeLengthKm', NUMBER, [RESOLUTION]], ['pointDistM', NUMBER, [POINTER, POINTER]], ['pointDistKm', NUMBER, [POINTER, POINTER]], ['pointDistRads', NUMBER, [POINTER, POINTER]], ['cellAreaM2', NUMBER, [H3_LOWER, H3_UPPER]], ['cellAreaKm2', NUMBER, [H3_LOWER, H3_UPPER]], ['cellAreaRads2', NUMBER, [H3_LOWER, H3_UPPER]], ['exactEdgeLengthM', NUMBER, [H3_LOWER, H3_UPPER]], ['exactEdgeLengthKm', NUMBER, [H3_LOWER, H3_UPPER]], ['exactEdgeLengthRads', NUMBER, [H3_LOWER, H3_UPPER]], ['numHexagons', NUMBER, [RESOLUTION]], ['getRes0Indexes', null, [POINTER]], ['res0IndexCount', NUMBER], ['getPentagonIndexes', null, [NUMBER, POINTER]], ['pentagonIndexCount', NUMBER]];

/*
 * Copyright 2018-2019 Uber Technologies, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var H3 = {}; // Create the bound functions themselves

BINDINGS.forEach(function bind(def) {
  H3[def[0]] = libh3.cwrap.apply(libh3, def);
}); // Alias the hexidecimal base for legibility

var BASE_16 = 16; // ----------------------------------------------------------------------------
// Byte size imports

var SZ_INT = 4;
var SZ_PTR = 4;
var SZ_DBL = 8;
var SZ_H3INDEX = H3.sizeOfH3Index();
var SZ_GEOCOORD = H3.sizeOfGeoCoord();
var SZ_GEOBOUNDARY = H3.sizeOfGeoBoundary();
var SZ_GEOPOLYGON = H3.sizeOfGeoPolygon();
var SZ_GEOFENCE = H3.sizeOfGeofence();
var SZ_LINKED_GEOPOLYGON = H3.sizeOfLinkedGeoPolygon();
var SZ_COORDIJ = H3.sizeOfCoordIJ(); // ----------------------------------------------------------------------------
// Custom types

/**
 * 64-bit hexidecimal string representation of an H3 index
 * @static
 * @typedef {string} H3Index
 */

/**
 * 64-bit hexidecimal string representation of an H3 index,
 * or two 32-bit integers in little endian order in an array.
 * @static
 * @typedef {string | number[]} H3IndexInput
 */

/**
 * Coordinates as an `{i, j}` pair
 * @static
 * @typedef CoordIJ
 * @type {Object}
 * @property {number} i
 * @property {number} j
 */
// ----------------------------------------------------------------------------
// Unit constants

/**
 * Length/Area units
 * @static
 * @typedef UNITS
 * @type {Object}
 * @property {string} m
 * @property {string} m2
 * @property {string} km
 * @property {string} km2
 * @property {string} rads
 * @property {string} rads2
 */

var UNITS = {
  m: 'm',
  m2: 'm2',
  km: 'km',
  km2: 'km2',
  rads: 'rads',
  rads2: 'rads2'
}; // ----------------------------------------------------------------------------
// Utilities and helpers

/**
 * Validate a resolution, throwing an error if invalid
 * @private
 * @param  {mixed} res Value to validate
 * @throws {Error}     Error if invalid
 */

function validateRes(res) {
  if (typeof res !== 'number' || res < 0 || res > 15 || Math.floor(res) !== res) {
    throw new Error(("Invalid resolution: " + res));
  }
}

var INVALID_HEXIDECIMAL_CHAR = /[^0-9a-fA-F]/;
/**
 * Convert an H3 index (64-bit hexidecimal string) into a "split long" - a pair of 32-bit ints
 * @private
 * @param  {H3IndexInput} h3Index  H3 index to check
 * @return {number[]}         A two-element array with 32 lower bits and 32 upper bits
 */

function h3IndexToSplitLong(h3Index) {
  if (Array.isArray(h3Index) && h3Index.length === 2 && Number.isInteger(h3Index[0]) && Number.isInteger(h3Index[1])) {
    return h3Index;
  }

  if (typeof h3Index !== 'string' || INVALID_HEXIDECIMAL_CHAR.test(h3Index)) {
    return [0, 0];
  }

  var upper = parseInt(h3Index.substring(0, h3Index.length - 8), BASE_16);
  var lower = parseInt(h3Index.substring(h3Index.length - 8), BASE_16);
  return [lower, upper];
}
/**
 * Convert a 32-bit int to a hexdecimal string
 * @private
 * @param  {number} num  Integer to convert
 * @return {H3Index}     Hexidecimal string
 */

function hexFrom32Bit(num) {
  if (num >= 0) {
    return num.toString(BASE_16);
  } // Handle negative numbers


  num = num & 0x7fffffff;
  var tempStr = zeroPad(8, num.toString(BASE_16));
  var topNum = (parseInt(tempStr[0], BASE_16) + 8).toString(BASE_16);
  tempStr = topNum + tempStr.substring(1);
  return tempStr;
}
/**
 * Get a H3 index from a split long (pair of 32-bit ints)
 * @private
 * @param  {number} lower Lower 32 bits
 * @param  {number} upper Upper 32 bits
 * @return {H3Index}       H3 index
 */


function splitLongToh3Index(lower, upper) {
  return hexFrom32Bit(upper) + zeroPad(8, hexFrom32Bit(lower));
}
/**
 * Zero-pad a string to a given length
 * @private
 * @param  {number} fullLen Target length
 * @param  {string} numStr  String to zero-pad
 * @return {string}         Zero-padded string
 */

function zeroPad(fullLen, numStr) {
  var numZeroes = fullLen - numStr.length;
  var outStr = '';

  for (var i = 0; i < numZeroes; i++) {
    outStr += '0';
  }

  outStr = outStr + numStr;
  return outStr;
}
/**
 * Populate a C-appropriate Geofence struct from a polygon array
 * @private
 * @param  {Array[]} polygonArray Polygon, as an array of coordinate pairs
 * @param  {number}  geofence     C pointer to a Geofence struct
 * @param  {boolean} isGeoJson    Whether coordinates are in [lng, lat] order per GeoJSON spec
 * @return {number}               C pointer to populated Geofence struct
 */


function polygonArrayToGeofence(polygonArray, geofence, isGeoJson) {
  var numVerts = polygonArray.length;

  var geoCoordArray = libh3._calloc(numVerts, SZ_GEOCOORD); // Support [lng, lat] pairs if GeoJSON is specified


  var latIndex = isGeoJson ? 1 : 0;
  var lngIndex = isGeoJson ? 0 : 1;

  for (var i = 0; i < numVerts * 2; i += 2) {
    libh3.HEAPF64.set([polygonArray[i / 2][latIndex], polygonArray[i / 2][lngIndex]].map(degsToRads), geoCoordArray / SZ_DBL + i);
  }

  libh3.HEAPU32.set([numVerts, geoCoordArray], geofence / SZ_INT);
  return geofence;
}
/**
 * Create a C-appropriate GeoPolygon struct from an array of polygons
 * @private
 * @param  {Array[]} coordinates  Array of polygons, each an array of coordinate pairs
 * @param  {boolean} isGeoJson    Whether coordinates are in [lng, lat] order per GeoJSON spec
 * @return {number}               C pointer to populated GeoPolygon struct
 */


function coordinatesToGeoPolygon(coordinates, isGeoJson) {
  // Any loops beyond the first loop are holes
  var numHoles = coordinates.length - 1;

  var geoPolygon = libh3._calloc(SZ_GEOPOLYGON); // Byte positions within the struct


  var geofenceOffset = 0;
  var numHolesOffset = geofenceOffset + SZ_GEOFENCE;
  var holesOffset = numHolesOffset + SZ_INT; // geofence is first part of struct

  polygonArrayToGeofence(coordinates[0], geoPolygon + geofenceOffset, isGeoJson);
  var holes;

  if (numHoles > 0) {
    holes = libh3._calloc(numHoles, SZ_GEOFENCE);

    for (var i = 0; i < numHoles; i++) {
      polygonArrayToGeofence(coordinates[i + 1], holes + SZ_GEOFENCE * i, isGeoJson);
    }
  }

  libh3.setValue(geoPolygon + numHolesOffset, numHoles, 'i32');
  libh3.setValue(geoPolygon + holesOffset, holes, 'i32');
  return geoPolygon;
}
/**
 * Free memory allocated for a GeoPolygon struct. It is an error to access the struct
 * after passing it to this method.
 * @private
 * @return {number} geoPolygon C pointer to populated GeoPolygon struct
 */


function destroyGeoPolygon(geoPolygon) {
  // Byte positions within the struct
  var geofenceOffset = 0;
  var numHolesOffset = geofenceOffset + SZ_GEOFENCE;
  var holesOffset = numHolesOffset + SZ_INT; // Offset of the geofence vertex array pointer within the Geofence struct

  var geofenceArrayOffset = SZ_INT; // Free the outer vertex array

  libh3._free(libh3.getValue(geoPolygon + geofenceOffset + geofenceArrayOffset, 'i8*')); // Free the vertex array for the holes, if any


  var numHoles = libh3.getValue(geoPolygon + numHolesOffset, 'i32');

  if (numHoles > 0) {
    var holes = libh3.getValue(geoPolygon + holesOffset, 'i32');

    for (var i = 0; i < numHoles; i++) {
      libh3._free(libh3.getValue(holes + SZ_GEOFENCE * i + geofenceArrayOffset, 'i8*'));
    }

    libh3._free(holes);
  }

  libh3._free(geoPolygon);
}
/**
 * Read a long value, returning the lower and upper portions as separate 32-bit integers.
 * Because the upper bits are returned via side effect, the argument to this function is
 * intended to be the invocation that caused the side effect, e.g. readLong(H3.getSomeLong())
 * @private
 * @param  {number} invocation Invoked function returning a long value. The actual return
 *                             value of these functions is a 32-bit integer.
 * @return {number}            Long value as a [lower, upper] pair
 */


function readLong(invocation) {
  // Upper 32-bits of the long set via side-effect
  var upper = libh3.getTempRet0();
  return [invocation, upper];
}
/**
 * Read an H3 index from a C return value. As with readLong, the argument to this function
 * is intended to be an invocation, e.g. readH3Index(H3.getSomeAddress()), to help ensure that
 * the temp value storing the upper bits of the long is still set.
 * @private
 * @param  {number} invocation  Invoked function returning a single H3 index
 * @return {H3Index}            H3 index, or null if index was invalid
 */


function readH3Index(invocation) {
  var ref = readLong(invocation);
  var lower = ref[0];
  var upper = ref[1]; // The lower bits are allowed to be 0s, but if the upper bits are 0
  // this represents an invalid H3 index

  return upper ? splitLongToh3Index(lower, upper) : null;
}
/**
 * Read an H3 index from a pointer to C memory.
 * @private
 * @param  {number} cAddress  Pointer to allocated C memory
 * @param {number} offset     Offset, in number of H3 indexes, in case we're
 *                            reading an array
 * @return {H3Index}          H3 index, or null if index was invalid
 */


function readH3IndexFromPointer(cAddress, offset) {
  if ( offset === void 0 ) offset = 0;

  var lower = libh3.getValue(cAddress + SZ_INT * offset * 2, 'i32');
  var upper = libh3.getValue(cAddress + SZ_INT * (offset * 2 + 1), 'i32'); // The lower bits are allowed to be 0s, but if the upper bits are 0
  // this represents an invalid H3 index

  return upper ? splitLongToh3Index(lower, upper) : null;
}
/**
 * Store an H3 index in C memory. Primarily used as an efficient way to
 * write sets of hexagons.
 * @private
 * @param  {H3IndexInput} h3Index  H3 index to store
 * @param  {number} cAddress  Pointer to allocated C memory
 * @param {number} offset     Offset, in number of H3 indexes from beginning
 *                            of the current array
 */


function storeH3Index(h3Index, cAddress, offset) {
  // HEAPU32 is a typed array projection on the index space
  // as unsigned 32-bit integers. This means the index needs
  // to be divided by SZ_INT (4) to access correctly. Also,
  // the H3 index is 64 bits, so we skip by twos as we're writing
  // to 32-bit integers in the proper order.
  libh3.HEAPU32.set(h3IndexToSplitLong(h3Index), cAddress / SZ_INT + 2 * offset);
}
/**
 * Read an array of 64-bit H3 indexes from C and convert to a JS array of
 * H3 index strings
 * @private
 * @param  {number} cAddress    Pointer to C ouput array
 * @param  {number} maxCount    Max number of hexagons in array. Hexagons with
 *                              the value 0 will be skipped, so this isn't
 *                              necessarily the length of the output array.
 * @return {H3Index[]}          Array of H3 indexes
 */


function readArrayOfHexagons(cAddress, maxCount) {
  var out = [];

  for (var i = 0; i < maxCount; i++) {
    var h3Index = readH3IndexFromPointer(cAddress, i);

    if (h3Index !== null) {
      out.push(h3Index);
    }
  }

  return out;
}
/**
 * Store an array of H3 index strings as a C array of 64-bit integers.
 * @private
 * @param  {number} cAddress    Pointer to C input array
 * @param  {H3IndexInput[]} hexagons H3 indexes to pass to the C lib
 */


function storeArrayOfHexagons(cAddress, hexagons) {
  // Assuming the cAddress points to an already appropriately
  // allocated space
  var count = hexagons.length;

  for (var i = 0; i < count; i++) {
    storeH3Index(hexagons[i], cAddress, i);
  }
}
/**
 * Populate a C-appropriate GeoCoord struct from a [lat, lng] array
 * @private
 * @param {number} lat     Coordinate latitude
 * @param {number} lng     Coordinate longitude
 * @return {number}        C pointer to populated GeoCoord struct
 */


function storeGeoCoord(lat, lng) {
  var geoCoord = libh3._calloc(1, SZ_GEOCOORD);

  libh3.HEAPF64.set([lat, lng].map(degsToRads), geoCoord / SZ_DBL);
  return geoCoord;
}

function readSingleCoord(cAddress) {
  return radsToDegs(libh3.getValue(cAddress, 'double'));
}
/**
 * Read a GeoCoord from C and return a [lat, lng] pair.
 * @private
 * @param  {number} cAddress    Pointer to C struct
 * @return {number[]}           [lat, lng] pair
 */


function readGeoCoord(cAddress) {
  return [readSingleCoord(cAddress), readSingleCoord(cAddress + SZ_DBL)];
}
/**
 * Read a GeoCoord from C and return a GeoJSON-style [lng, lat] pair.
 * @private
 * @param  {number} cAddress    Pointer to C struct
 * @return {number[]}           [lng, lat] pair
 */


function readGeoCoordGeoJson(cAddress) {
  return [readSingleCoord(cAddress + SZ_DBL), readSingleCoord(cAddress)];
}
/**
 * Read the GeoBoundary structure into a list of geo coordinate pairs
 * @private
 * @param {number}  geoBoundary     C pointer to GeoBoundary struct
 * @param {boolean} geoJsonCoords   Whether to provide GeoJSON coordinate order: [lng, lat]
 * @param {boolean} closedLoop      Whether to close the loop
 * @return {Array[]}                Array of geo coordinate pairs
 */


function readGeoBoundary(geoBoundary, geoJsonCoords, closedLoop) {
  var numVerts = libh3.getValue(geoBoundary, 'i32'); // Note that though numVerts is an int, the coordinate doubles have to be
  // aligned to 8 bytes, hence the 8-byte offset here

  var vertsPos = geoBoundary + SZ_DBL;
  var out = []; // Support [lng, lat] pairs if GeoJSON is specified

  var readCoord = geoJsonCoords ? readGeoCoordGeoJson : readGeoCoord;

  for (var i = 0; i < numVerts * 2; i += 2) {
    out.push(readCoord(vertsPos + SZ_DBL * i));
  }

  if (closedLoop) {
    // Close loop if GeoJSON is specified
    out.push(out[0]);
  }

  return out;
}
/**
 * Read the LinkedGeoPolygon structure into a nested array of MultiPolygon coordinates
 * @private
 * @param {number}  polygon         C pointer to LinkedGeoPolygon struct
 * @param {boolean} formatAsGeoJson Whether to provide GeoJSON output: [lng, lat], closed loops
 * @return {number[][][][]}         MultiPolygon-style output.
 */


function readMultiPolygon(polygon, formatAsGeoJson) {
  var output = [];
  var readCoord = formatAsGeoJson ? readGeoCoordGeoJson : readGeoCoord;
  var loops;
  var loop;
  var coords;
  var coord; // Loop through the linked structure, building the output

  while (polygon) {
    output.push(loops = []); // Follow ->first pointer

    loop = libh3.getValue(polygon, 'i8*');

    while (loop) {
      loops.push(coords = []); // Follow ->first pointer

      coord = libh3.getValue(loop, 'i8*');

      while (coord) {
        coords.push(readCoord(coord)); // Follow ->next pointer

        coord = libh3.getValue(coord + SZ_DBL * 2, 'i8*');
      }

      if (formatAsGeoJson) {
        // Close loop if GeoJSON is requested
        coords.push(coords[0]);
      } // Follow ->next pointer


      loop = libh3.getValue(loop + SZ_PTR * 2, 'i8*');
    } // Follow ->next pointer


    polygon = libh3.getValue(polygon + SZ_PTR * 2, 'i8*');
  }

  return output;
}
/**
 * Read a CoordIJ from C and return an {i, j} pair.
 * @private
 * @param  {number} cAddress    Pointer to C struct
 * @return {CoordIJ}            {i, j} pair
 */


function readCoordIJ(cAddress) {
  return {
    i: libh3.getValue(cAddress, 'i32'),
    j: libh3.getValue(cAddress + SZ_INT, 'i32')
  };
}
/**
 * Store an {i, j} pair to a C CoordIJ struct.
 * @private
 * @param  {number} cAddress    Pointer to C struct
 * @return {CoordIJ}            {i, j} pair
 */


function storeCoordIJ(cAddress, ref) {
  var i = ref.i;
  var j = ref.j;

  libh3.setValue(cAddress, i, 'i32');
  libh3.setValue(cAddress + SZ_INT, j, 'i32');
}
/**
 * Read an array of positive integers array from C. Negative
 * values are considered invalid and ignored in output.
 * @private
 * @param  {number} cAddress    Pointer to C array
 * @param  {number} count       Length of C array
 * @return {number[]}           Javascript integer array
 */


function readArrayOfPositiveIntegers(cAddress, count) {
  var out = [];

  for (var i = 0; i < count; i++) {
    var int = libh3.getValue(cAddress + SZ_INT * i, 'i32');

    if (int >= 0) {
      out.push(int);
    }
  }

  return out;
} // ----------------------------------------------------------------------------
// Public API functions: Core

/**
 * Whether a given string represents a valid H3 index
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to check
 * @return {boolean}          Whether the index is valid
 */


function h3IsValid(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  return Boolean(H3.h3IsValid(lower, upper));
}
/**
 * Whether the given H3 index is a pentagon
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to check
 * @return {boolean}          isPentagon
 */

function h3IsPentagon(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  return Boolean(H3.h3IsPentagon(lower, upper));
}
/**
 * Whether the given H3 index is in a Class III resolution (rotated versus
 * the icosahedron and subject to shape distortion adding extra points on
 * icosahedron edges, making them not true hexagons).
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to check
 * @return {boolean}          isResClassIII
 */

function h3IsResClassIII(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  return Boolean(H3.h3IsResClassIII(lower, upper));
}
/**
 * Get the number of the base cell for a given H3 index
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to get the base cell for
 * @return {number}           Index of the base cell (0-121)
 */

function h3GetBaseCell(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  return H3.h3GetBaseCell(lower, upper);
}
/**
 * Get the indices of all icosahedron faces intersected by a given H3 index
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to get faces for
 * @return {number[]}         Indices (0-19) of all intersected faces
 */

function h3GetFaces(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  var count = H3.maxFaceCount(lower, upper);

  var faces = libh3._malloc(SZ_INT * count);

  H3.h3GetFaces(lower, upper, faces);
  var out = readArrayOfPositiveIntegers(faces, count);

  libh3._free(faces);

  return out;
}
/**
 * Returns the resolution of an H3 index
 * @static
 * @param  {H3IndexInput} h3Index H3 index to get resolution
 * @return {number}          The number (0-15) resolution, or -1 if invalid
 */

function h3GetResolution(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];

  if (!H3.h3IsValid(lower, upper)) {
    // Compatability with stated API
    return -1;
  }

  return H3.h3GetResolution(lower, upper);
}
/**
 * Get the hexagon containing a lat,lon point
 * @static
 * @param  {number} lat Latitude of point
 * @param  {number} lng Longtitude of point
 * @param  {number} res Resolution of hexagons to return
 * @return {H3Index}    H3 index
 */

function geoToH3(lat, lng, res) {
  var latlng = libh3._malloc(SZ_GEOCOORD); // Slightly more efficient way to set the memory


  libh3.HEAPF64.set([lat, lng].map(degsToRads), latlng / SZ_DBL); // Read value as a split long

  var h3Index = readH3Index(H3.geoToH3(latlng, res));

  libh3._free(latlng);

  return h3Index;
}
/**
 * Get the lat,lon center of a given hexagon
 * @static
 * @param  {H3IndexInput} h3Index  H3 index
 * @return {number[]}         Point as a [lat, lng] pair
 */

function h3ToGeo(h3Index) {
  var latlng = libh3._malloc(SZ_GEOCOORD);

  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  H3.h3ToGeo(lower, upper, latlng);
  var out = readGeoCoord(latlng);

  libh3._free(latlng);

  return out;
}
/**
 * Get the vertices of a given hexagon (or pentagon), as an array of [lat, lng]
 * points. For pentagons and hexagons on the edge of an icosahedron face, this
 * function may return up to 10 vertices.
 * @static
 * @param  {H3Index} h3Index          H3 index
 * @param {boolean} [formatAsGeoJson] Whether to provide GeoJSON output: [lng, lat], closed loops
 * @return {number[][]}               Array of [lat, lng] pairs
 */

function h3ToGeoBoundary(h3Index, formatAsGeoJson) {
  var geoBoundary = libh3._malloc(SZ_GEOBOUNDARY);

  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  H3.h3ToGeoBoundary(lower, upper, geoBoundary);
  var out = readGeoBoundary(geoBoundary, formatAsGeoJson, formatAsGeoJson);

  libh3._free(geoBoundary);

  return out;
} // ----------------------------------------------------------------------------
// Public API functions: Algorithms

/**
 * Get the parent of the given hexagon at a particular resolution
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to get parent for
 * @param  {number} res       Resolution of hexagon to return
 * @return {H3Index}          H3 index of parent, or null for invalid input
 */

function h3ToParent(h3Index, res) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  return readH3Index(H3.h3ToParent(lower, upper, res));
}
/**
 * Get the children/descendents of the given hexagon at a particular resolution
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to get children for
 * @param  {number} res       Resolution of hexagons to return
 * @return {H3Index[]}        H3 indexes of children, or empty array for invalid input
 */

function h3ToChildren(h3Index, res) {
  // Bad input in this case can potentially result in high computation volume
  // using the current C algorithm. Validate and return an empty array on failure.
  if (!h3IsValid(h3Index)) {
    return [];
  }

  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  var maxCount = H3.maxH3ToChildrenSize(lower, upper, res);

  var hexagons = libh3._calloc(maxCount, SZ_H3INDEX);

  H3.h3ToChildren(lower, upper, res, hexagons);
  var out = readArrayOfHexagons(hexagons, maxCount);

  libh3._free(hexagons);

  return out;
}
/**
 * Get the center child of the given hexagon at a particular resolution
 * @static
 * @param  {H3IndexInput} h3Index  H3 index to get center child for
 * @param  {number} res       Resolution of hexagon to return
 * @return {H3Index}          H3 index of child, or null for invalid input
 */

function h3ToCenterChild(h3Index, res) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  return readH3Index(H3.h3ToCenterChild(lower, upper, res));
}
/**
 * Get all hexagons in a k-ring around a given center. The order of the hexagons is undefined.
 * @static
 * @param  {H3IndexInput} h3Index  H3 index of center hexagon
 * @param  {number} ringSize  Radius of k-ring
 * @return {H3Index[]}        H3 indexes for all hexagons in ring
 */

function kRing(h3Index, ringSize) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  var maxCount = H3.maxKringSize(ringSize);

  var hexagons = libh3._calloc(maxCount, SZ_H3INDEX);

  H3.kRing(lower, upper, ringSize, hexagons);
  var out = readArrayOfHexagons(hexagons, maxCount);

  libh3._free(hexagons);

  return out;
}
/**
 * Get all hexagons in a k-ring around a given center, in an array of arrays
 * ordered by distance from the origin. The order of the hexagons within each ring is undefined.
 * @static
 * @param  {H3IndexInput} h3Index  H3 index of center hexagon
 * @param  {number} ringSize  Radius of k-ring
 * @return {H3Index[][]}      Array of arrays with H3 indexes for all hexagons each ring
 */

function kRingDistances(h3Index, ringSize) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  var maxCount = H3.maxKringSize(ringSize);

  var kRings = libh3._calloc(maxCount, SZ_H3INDEX);

  var distances = libh3._calloc(maxCount, SZ_INT);

  H3.kRingDistances(lower, upper, ringSize, kRings, distances); // Create an array of empty arrays to hold the output

  var out = [];

  for (var i = 0; i < ringSize + 1; i++) {
    out.push([]);
  } // Read the array of hexagons, putting them into the appropriate rings


  for (var i$1 = 0; i$1 < maxCount * 2; i$1 += 2) {
    var hexLower = libh3.getValue(kRings + SZ_INT * i$1, 'i32');
    var hexUpper = libh3.getValue(kRings + SZ_INT * (i$1 + 1), 'i32');
    var index = libh3.getValue(distances + SZ_INT * (i$1 / 2), 'i32');

    if (hexLower !== 0 || hexUpper !== 0) {
      out[index].push(splitLongToh3Index(hexLower, hexUpper));
    }
  }

  libh3._free(kRings);

  libh3._free(distances);

  return out;
}
/**
 * Get all hexagons in a hollow hexagonal ring centered at origin with sides of a given length.
 * Unlike kRing, this function will throw an error if there is a pentagon anywhere in the ring.
 * @static
 * @param  {H3IndexInput} h3Index  H3 index of center hexagon
 * @param  {number} ringSize  Radius of ring
 * @return {H3Index[]}        H3 indexes for all hexagons in ring
 * @throws {Error}            If the algorithm could not calculate the ring
 */

function hexRing(h3Index, ringSize) {
  var maxCount = ringSize === 0 ? 1 : 6 * ringSize;

  var hexagons = libh3._calloc(maxCount, SZ_H3INDEX);

  var retVal = H3.hexRing.apply(H3, h3IndexToSplitLong(h3Index).concat( [ringSize], [hexagons] ));

  if (retVal !== 0) {
    libh3._free(hexagons);

    throw new Error('Failed to get hexRing (encountered a pentagon?)');
  }

  var out = readArrayOfHexagons(hexagons, maxCount);

  libh3._free(hexagons);

  return out;
}
/**
 * Get all hexagons with centers contained in a given polygon. The polygon
 * is specified with GeoJson semantics as an array of loops. Each loop is
 * an array of [lat, lng] pairs (or [lng, lat] if isGeoJson is specified).
 * The first loop is the perimeter of the polygon, and subsequent loops are
 * expected to be holes.
 * @static
 * @param  {number[][] | number[][][]} coordinates
 *                                  Array of loops, or a single loop
 * @param  {number} res             Resolution of hexagons to return
 * @param  {boolean} [isGeoJson]    Whether to expect GeoJson-style [lng, lat]
 *                                  pairs instead of [lat, lng]
 * @return {H3Index[]}              H3 indexes for all hexagons in polygon
 */

function polyfill(coordinates, res, isGeoJson) {
  validateRes(res);
  isGeoJson = Boolean(isGeoJson); // Guard against empty input

  if (coordinates.length === 0 || coordinates[0].length === 0) {
    return [];
  } // Wrap to expected format if a single loop is provided


  if (typeof coordinates[0][0] === 'number') {
    coordinates = [coordinates];
  }

  var geoPolygon = coordinatesToGeoPolygon(coordinates, isGeoJson);
  var arrayLen = H3.maxPolyfillSize(geoPolygon, res);

  var hexagons = libh3._calloc(arrayLen, SZ_H3INDEX);

  H3.polyfill(geoPolygon, res, hexagons);
  var out = readArrayOfHexagons(hexagons, arrayLen);

  libh3._free(hexagons);

  destroyGeoPolygon(geoPolygon);
  return out;
}
/**
 * Get the outlines of a set of H3 hexagons, returned in GeoJSON MultiPolygon
 * format (an array of polygons, each with an array of loops, each an array of
 * coordinates). Coordinates are returned as [lat, lng] pairs unless GeoJSON
 * is requested.
 *
 * It is the responsibility of the caller to ensure that all hexagons in the
 * set have the same resolution and that the set contains no duplicates. Behavior
 * is undefined if duplicates or multiple resolutions are present, and the
 * algorithm may produce unexpected or invalid polygons.
 *
 * @static
 * @param {H3IndexInput[]} h3Indexes       H3 indexes to get outlines for
 * @param {boolean} [formatAsGeoJson] Whether to provide GeoJSON output:
 *                                    [lng, lat], closed loops
 * @return {number[][][][]}           MultiPolygon-style output.
 */

function h3SetToMultiPolygon(h3Indexes, formatAsGeoJson) {
  // Early exit on empty input
  if (!h3Indexes || !h3Indexes.length) {
    return [];
  } // Set up input set


  var indexCount = h3Indexes.length;

  var set = libh3._calloc(indexCount, SZ_H3INDEX);

  storeArrayOfHexagons(set, h3Indexes); // Allocate memory for output linked polygon

  var polygon = libh3._calloc(SZ_LINKED_GEOPOLYGON); // Store a reference to the first polygon - that's the one we need for
  // memory deallocation


  var originalPolygon = polygon;
  H3.h3SetToLinkedGeo(set, indexCount, polygon);
  var multiPolygon = readMultiPolygon(polygon, formatAsGeoJson); // Clean up

  H3.destroyLinkedPolygon(originalPolygon);

  libh3._free(originalPolygon);

  libh3._free(set);

  return multiPolygon;
}
/**
 * Compact a set of hexagons of the same resolution into a set of hexagons across
 * multiple levels that represents the same area.
 * @static
 * @param  {H3IndexInput[]} h3Set H3 indexes to compact
 * @return {H3Index[]}       Compacted H3 indexes
 * @throws {Error}           If the input is invalid (e.g. duplicate hexagons)
 */

function compact(h3Set) {
  if (!h3Set || !h3Set.length) {
    return [];
  } // Set up input set


  var count = h3Set.length;

  var set = libh3._calloc(count, SZ_H3INDEX);

  storeArrayOfHexagons(set, h3Set); // Allocate memory for compacted hexagons, worst-case is no compaction

  var compactedSet = libh3._calloc(count, SZ_H3INDEX);

  var retVal = H3.compact(set, compactedSet, count);

  if (retVal !== 0) {
    libh3._free(set);

    libh3._free(compactedSet);

    throw new Error('Failed to compact, malformed input data (duplicate hexagons?)');
  }

  var out = readArrayOfHexagons(compactedSet, count);

  libh3._free(set);

  libh3._free(compactedSet);

  return out;
}
/**
 * Uncompact a compacted set of hexagons to hexagons of the same resolution
 * @static
 * @param  {H3IndexInput[]} compactedSet H3 indexes to uncompact
 * @param  {number}    res          The resolution to uncompact to
 * @return {H3Index[]}              The uncompacted H3 indexes
 * @throws {Error}                  If the input is invalid (e.g. invalid resolution)
 */

function uncompact(compactedSet, res) {
  validateRes(res);

  if (!compactedSet || !compactedSet.length) {
    return [];
  } // Set up input set


  var count = compactedSet.length;

  var set = libh3._calloc(count, SZ_H3INDEX);

  storeArrayOfHexagons(set, compactedSet); // Estimate how many hexagons we need (always overestimates if in error)

  var maxUncompactedNum = H3.maxUncompactSize(set, count, res); // Allocate memory for uncompacted hexagons

  var uncompactedSet = libh3._calloc(maxUncompactedNum, SZ_H3INDEX);

  var retVal = H3.uncompact(set, count, uncompactedSet, maxUncompactedNum, res);

  if (retVal !== 0) {
    libh3._free(set);

    libh3._free(uncompactedSet);

    throw new Error('Failed to uncompact (bad resolution?)');
  }

  var out = readArrayOfHexagons(uncompactedSet, maxUncompactedNum);

  libh3._free(set);

  libh3._free(uncompactedSet);

  return out;
} // ----------------------------------------------------------------------------
// Public API functions: Unidirectional edges

/**
 * Whether two H3 indexes are neighbors (share an edge)
 * @static
 * @param  {H3IndexInput} origin      Origin hexagon index
 * @param  {H3IndexInput} destination Destination hexagon index
 * @return {boolean}             Whether the hexagons share an edge
 */

function h3IndexesAreNeighbors(origin, destination) {
  var ref = h3IndexToSplitLong(origin);
  var oLower = ref[0];
  var oUpper = ref[1];
  var ref$1 = h3IndexToSplitLong(destination);
  var dLower = ref$1[0];
  var dUpper = ref$1[1];
  return Boolean(H3.h3IndexesAreNeighbors(oLower, oUpper, dLower, dUpper));
}
/**
 * Get an H3 index representing a unidirectional edge for a given origin and destination
 * @static
 * @param  {H3IndexInput} origin      Origin hexagon index
 * @param  {H3IndexInput} destination Destination hexagon index
 * @return {H3Index}             H3 index of the edge, or null if no edge is shared
 */

function getH3UnidirectionalEdge(origin, destination) {
  var ref = h3IndexToSplitLong(origin);
  var oLower = ref[0];
  var oUpper = ref[1];
  var ref$1 = h3IndexToSplitLong(destination);
  var dLower = ref$1[0];
  var dUpper = ref$1[1];
  return readH3Index(H3.getH3UnidirectionalEdge(oLower, oUpper, dLower, dUpper));
}
/**
 * Get the origin hexagon from an H3 index representing a unidirectional edge
 * @static
 * @param  {H3IndexInput} edgeIndex H3 index of the edge
 * @return {H3Index}           H3 index of the edge origin
 */

function getOriginH3IndexFromUnidirectionalEdge(edgeIndex) {
  var ref = h3IndexToSplitLong(edgeIndex);
  var lower = ref[0];
  var upper = ref[1];
  return readH3Index(H3.getOriginH3IndexFromUnidirectionalEdge(lower, upper));
}
/**
 * Get the destination hexagon from an H3 index representing a unidirectional edge
 * @static
 * @param  {H3IndexInput} edgeIndex H3 index of the edge
 * @return {H3Index}           H3 index of the edge destination
 */

function getDestinationH3IndexFromUnidirectionalEdge(edgeIndex) {
  var ref = h3IndexToSplitLong(edgeIndex);
  var lower = ref[0];
  var upper = ref[1];
  return readH3Index(H3.getDestinationH3IndexFromUnidirectionalEdge(lower, upper));
}
/**
 * Whether the input is a valid unidirectional edge
 * @static
 * @param  {H3IndexInput} edgeIndex H3 index of the edge
 * @return {boolean}           Whether the index is valid
 */

function h3UnidirectionalEdgeIsValid(edgeIndex) {
  var ref = h3IndexToSplitLong(edgeIndex);
  var lower = ref[0];
  var upper = ref[1];
  return Boolean(H3.h3UnidirectionalEdgeIsValid(lower, upper));
}
/**
 * Get the [origin, destination] pair represented by a unidirectional edge
 * @static
 * @param  {H3IndexInput} edgeIndex H3 index of the edge
 * @return {H3Index[]}         [origin, destination] pair as H3 indexes
 */

function getH3IndexesFromUnidirectionalEdge(edgeIndex) {
  var ref = h3IndexToSplitLong(edgeIndex);
  var lower = ref[0];
  var upper = ref[1];
  var count = 2;

  var hexagons = libh3._calloc(count, SZ_H3INDEX);

  H3.getH3IndexesFromUnidirectionalEdge(lower, upper, hexagons);
  var out = readArrayOfHexagons(hexagons, count);

  libh3._free(hexagons);

  return out;
}
/**
 * Get all of the unidirectional edges with the given H3 index as the origin (i.e. an edge to
 * every neighbor)
 * @static
 * @param  {H3IndexInput} h3Index   H3 index of the origin hexagon
 * @return {H3Index[]}         List of unidirectional edges
 */

function getH3UnidirectionalEdgesFromHexagon(h3Index) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];
  var count = 6;

  var edges = libh3._calloc(count, SZ_H3INDEX);

  H3.getH3UnidirectionalEdgesFromHexagon(lower, upper, edges);
  var out = readArrayOfHexagons(edges, count);

  libh3._free(edges);

  return out;
}
/**
 * Get the vertices of a given edge as an array of [lat, lng] points. Note that for edges that
 * cross the edge of an icosahedron face, this may return 3 coordinates.
 * @static
 * @param  {H3IndexInput} edgeIndex        H3 index of the edge
 * @param {boolean} [formatAsGeoJson] Whether to provide GeoJSON output: [lng, lat]
 * @return {number[][]}               Array of geo coordinate pairs
 */

function getH3UnidirectionalEdgeBoundary(edgeIndex, formatAsGeoJson) {
  var geoBoundary = libh3._malloc(SZ_GEOBOUNDARY);

  var ref = h3IndexToSplitLong(edgeIndex);
  var lower = ref[0];
  var upper = ref[1];
  H3.getH3UnidirectionalEdgeBoundary(lower, upper, geoBoundary);
  var out = readGeoBoundary(geoBoundary, formatAsGeoJson);

  libh3._free(geoBoundary);

  return out;
}
/**
 * Get the grid distance between two hex indexes. This function may fail
 * to find the distance between two indexes if they are very far apart or
 * on opposite sides of a pentagon.
 * @static
 * @param  {H3IndexInput} origin      Origin hexagon index
 * @param  {H3IndexInput} destination Destination hexagon index
 * @return {number}              Distance between hexagons, or a negative
 *                               number if the distance could not be computed
 */

function h3Distance(origin, destination) {
  var ref = h3IndexToSplitLong(origin);
  var oLower = ref[0];
  var oUpper = ref[1];
  var ref$1 = h3IndexToSplitLong(destination);
  var dLower = ref$1[0];
  var dUpper = ref$1[1];
  return H3.h3Distance(oLower, oUpper, dLower, dUpper);
}
/**
 * Given two H3 indexes, return the line of indexes between them (inclusive).
 *
 * This function may fail to find the line between two indexes, for
 * example if they are very far apart. It may also fail when finding
 * distances for indexes on opposite sides of a pentagon.
 *
 * Notes:
 *
 *  - The specific output of this function should not be considered stable
 *    across library versions. The only guarantees the library provides are
 *    that the line length will be `h3Distance(start, end) + 1` and that
 *    every index in the line will be a neighbor of the preceding index.
 *  - Lines are drawn in grid space, and may not correspond exactly to either
 *    Cartesian lines or great arcs.
 *
 * @static
 * @param  {H3IndexInput} origin      Origin hexagon index
 * @param  {H3IndexInput} destination Destination hexagon index
 * @return {H3Index[]}           H3 indexes connecting origin and destination
 * @throws {Error}               If the line cannot be calculated
 */

function h3Line(origin, destination) {
  var ref = h3IndexToSplitLong(origin);
  var oLower = ref[0];
  var oUpper = ref[1];
  var ref$1 = h3IndexToSplitLong(destination);
  var dLower = ref$1[0];
  var dUpper = ref$1[1];
  var count = H3.h3LineSize(oLower, oUpper, dLower, dUpper);

  if (count < 0) {
    // We can't get the specific error code here - may be any of
    // the errors possible in experimentalH3ToLocalIj
    throw new Error('Line cannot be calculated');
  }

  var hexagons = libh3._calloc(count, SZ_H3INDEX);

  H3.h3Line(oLower, oUpper, dLower, dUpper, hexagons);
  var out = readArrayOfHexagons(hexagons, count);

  libh3._free(hexagons);

  return out;
}
/**
 * Produces IJ coordinates for an H3 index anchored by an origin.
 *
 * - The coordinate space used by this function may have deleted
 * regions or warping due to pentagonal distortion.
 * - Coordinates are only comparable if they come from the same
 * origin index.
 * - Failure may occur if the index is too far away from the origin
 * or if the index is on the other side of a pentagon.
 * - This function is experimental, and its output is not guaranteed
 * to be compatible across different versions of H3.
 * @static
 * @param  {H3IndexInput} origin      Origin H3 index
 * @param  {H3IndexInput} destination H3 index for which to find relative coordinates
 * @return {CoordIJ}             Coordinates as an `{i, j}` pair
 * @throws {Error}               If the IJ coordinates cannot be calculated
 */

function experimentalH3ToLocalIj(origin, destination) {
  var ij = libh3._malloc(SZ_COORDIJ);

  var retVal = H3.experimentalH3ToLocalIj.apply(H3, h3IndexToSplitLong(origin).concat( h3IndexToSplitLong(destination), [ij] ));
  var coords = readCoordIJ(ij);

  libh3._free(ij); // Return the pair, or throw if an error code was returned.
  // Switch statement and error codes cribbed from h3-java's implementation.


  switch (retVal) {
    case 0:
      return coords;

    case 1:
      throw new Error('Incompatible origin and index.');

    case 2:
    default:
      throw new Error('Local IJ coordinates undefined for this origin and index pair. ' + 'The index may be too far from the origin.');

    case 3:
    case 4:
    case 5:
      throw new Error('Encountered possible pentagon distortion');
  }
}
/**
 * Produces an H3 index for IJ coordinates anchored by an origin.
 *
 * - The coordinate space used by this function may have deleted
 * regions or warping due to pentagonal distortion.
 * - Coordinates are only comparable if they come from the same
 * origin index.
 * - Failure may occur if the index is too far away from the origin
 * or if the index is on the other side of a pentagon.
 * - This function is experimental, and its output is not guaranteed
 * to be compatible across different versions of H3.
 * @static
 * @param  {H3IndexInput} origin     Origin H3 index
 * @param  {CoordIJ} coords     Coordinates as an `{i, j}` pair
 * @return {H3Index}            H3 index at the relative coordinates
 * @throws {Error}              If the H3 index cannot be calculated
 */

function experimentalLocalIjToH3(origin, coords) {
  // Validate input coords
  if (!coords || typeof coords.i !== 'number' || typeof coords.j !== 'number') {
    throw new Error('Coordinates must be provided as an {i, j} object');
  } // Allocate memory for the CoordIJ struct and an H3 index to hold the return value


  var ij = libh3._malloc(SZ_COORDIJ);

  var out = libh3._malloc(SZ_H3INDEX);

  storeCoordIJ(ij, coords);
  var retVal = H3.experimentalLocalIjToH3.apply(H3, h3IndexToSplitLong(origin).concat( [ij], [out] ));
  var h3Index = readH3IndexFromPointer(out);

  libh3._free(ij);

  libh3._free(out);

  if (retVal !== 0) {
    throw new Error('Index not defined for this origin and IJ coordinates pair. ' + 'IJ coordinates may be too far from origin, or ' + 'a pentagon distortion was encountered.');
  }

  return h3Index;
} // ----------------------------------------------------------------------------
// Public API functions: Distance/area utilities

/**
 * Great circle distance between two geo points. This is not specific to H3,
 * but is implemented in the library and provided here as a convenience.
 * @static
 * @param  {number[]} latlng1 Origin coordinate as [lat, lng]
 * @param  {number[]} latlng2 Destination coordinate as [lat, lng]
 * @param  {string}   unit    Distance unit (either UNITS.m or UNITS.km)
 * @return {number}           Great circle distance
 * @throws {Error}            If the unit is invalid
 */

function pointDist(latlng1, latlng2, unit) {
  var coord1 = storeGeoCoord(latlng1[0], latlng1[1]);
  var coord2 = storeGeoCoord(latlng2[0], latlng2[1]);
  var result;

  switch (unit) {
    case UNITS.m:
      result = H3.pointDistM(coord1, coord2);
      break;

    case UNITS.km:
      result = H3.pointDistKm(coord1, coord2);
      break;

    case UNITS.rads:
      result = H3.pointDistRads(coord1, coord2);
      break;

    default:
      result = null;
  }

  libh3._free(coord1);

  libh3._free(coord2);

  if (result === null) {
    throw new Error(("Unknown unit: " + unit));
  }

  return result;
}
/**
 * Exact area of a given cell
 * @static
 * @param  {H3Index} h3Index  H3 index of the hexagon to measure
 * @param  {string}  unit     Distance unit (either UNITS.m2 or UNITS.km2)
 * @return {number}           Cell area
 * @throws {Error}            If the unit is invalid
 */

function cellArea(h3Index, unit) {
  var ref = h3IndexToSplitLong(h3Index);
  var lower = ref[0];
  var upper = ref[1];

  switch (unit) {
    case UNITS.m2:
      return H3.cellAreaM2(lower, upper);

    case UNITS.km2:
      return H3.cellAreaKm2(lower, upper);

    case UNITS.rads2:
      return H3.cellAreaRads2(lower, upper);

    default:
      throw new Error(("Unknown unit: " + unit));
  }
}
/**
 * Exact length of a given unidirectional edge
 * @static
 * @param  {H3Index} edge     H3 index of the edge to measure
 * @param  {string}  unit     Distance unit (either UNITS.m, UNITS.km, or UNITS.rads)
 * @return {number}           Cell area
 * @throws {Error}            If the unit is invalid
 */

function exactEdgeLength(edge, unit) {
  var ref = h3IndexToSplitLong(edge);
  var lower = ref[0];
  var upper = ref[1];

  switch (unit) {
    case UNITS.m:
      return H3.exactEdgeLengthM(lower, upper);

    case UNITS.km:
      return H3.exactEdgeLengthKm(lower, upper);

    case UNITS.rads:
      return H3.exactEdgeLengthRads(lower, upper);

    default:
      throw new Error(("Unknown unit: " + unit));
  }
}
/**
 * Average hexagon area at a given resolution
 * @static
 * @param  {number} res  Hexagon resolution
 * @param  {string} unit Area unit (either UNITS.m2, UNITS.km2, or UNITS.rads2)
 * @return {number}      Average area
 * @throws {Error}       If the unit is invalid
 */

function hexArea(res, unit) {
  validateRes(res);

  switch (unit) {
    case UNITS.m2:
      return H3.hexAreaM2(res);

    case UNITS.km2:
      return H3.hexAreaKm2(res);

    default:
      throw new Error(("Unknown unit: " + unit));
  }
}
/**
 * Average hexagon edge length at a given resolution
 * @static
 * @param  {number} res  Hexagon resolution
 * @param  {string} unit Distance unit (either UNITS.m, UNITS.km, or UNITS.rads)
 * @return {number}      Average edge length
 * @throws {Error}       If the unit is invalid
 */

function edgeLength(res, unit) {
  validateRes(res);

  switch (unit) {
    case UNITS.m:
      return H3.edgeLengthM(res);

    case UNITS.km:
      return H3.edgeLengthKm(res);

    default:
      throw new Error(("Unknown unit: " + unit));
  }
} // ----------------------------------------------------------------------------
// Public informational utilities

/**
 * The total count of hexagons in the world at a given resolution. Note that above
 * resolution 8 the exact count cannot be represented in a JavaScript 32-bit number,
 * so consumers should use caution when applying further operations to the output.
 * @static
 * @param  {number} res  Hexagon resolution
 * @return {number}      Count
 */

function numHexagons(res) {
  validateRes(res); // Get number as a long value

  var ref = readLong(H3.numHexagons(res));
  var lower = ref[0];
  var upper = ref[1]; // If we're using <= 32 bits we can use normal JS numbers

  if (!upper) {
    return lower;
  } // Above 32 bit, make a JS number that's correct in order of magnitude


  return upper * Math.pow(2, 32) + lower;
}
/**
 * Get all H3 indexes at resolution 0. As every index at every resolution > 0 is
 * the descendant of a res 0 index, this can be used with h3ToChildren to iterate
 * over H3 indexes at any resolution.
 * @static
 * @return {H3Index[]}  All H3 indexes at res 0
 */

function getRes0Indexes() {
  var count = H3.res0IndexCount();

  var hexagons = libh3._malloc(SZ_H3INDEX * count);

  H3.getRes0Indexes(hexagons);
  var out = readArrayOfHexagons(hexagons, count);

  libh3._free(hexagons);

  return out;
}
/**
 * Get the twelve pentagon indexes at a given resolution.
 * @static
 * @param  {number} res  Hexagon resolution
 * @return {H3Index[]}  All H3 pentagon indexes at res
 */

function getPentagonIndexes(res) {
  validateRes(res);
  var count = H3.pentagonIndexCount();

  var hexagons = libh3._malloc(SZ_H3INDEX * count);

  H3.getPentagonIndexes(res, hexagons);
  var out = readArrayOfHexagons(hexagons, count);

  libh3._free(hexagons);

  return out;
}
/**
 * Convert degrees to radians
 * @static
 * @param  {number} deg Value in degrees
 * @return {number}     Value in radians
 */

function degsToRads(deg) {
  return deg * Math.PI / 180;
}
/**
 * Convert radians to degrees
 * @static
 * @param  {number} rad Value in radians
 * @return {number}     Value in degrees
 */

function radsToDegs(rad) {
  return rad * 180 / Math.PI;
}

exports.UNITS = UNITS;
exports.h3IndexToSplitLong = h3IndexToSplitLong;
exports.splitLongToh3Index = splitLongToh3Index;
exports.h3IsValid = h3IsValid;
exports.h3IsPentagon = h3IsPentagon;
exports.h3IsResClassIII = h3IsResClassIII;
exports.h3GetBaseCell = h3GetBaseCell;
exports.h3GetFaces = h3GetFaces;
exports.h3GetResolution = h3GetResolution;
exports.geoToH3 = geoToH3;
exports.h3ToGeo = h3ToGeo;
exports.h3ToGeoBoundary = h3ToGeoBoundary;
exports.h3ToParent = h3ToParent;
exports.h3ToChildren = h3ToChildren;
exports.h3ToCenterChild = h3ToCenterChild;
exports.kRing = kRing;
exports.kRingDistances = kRingDistances;
exports.hexRing = hexRing;
exports.polyfill = polyfill;
exports.h3SetToMultiPolygon = h3SetToMultiPolygon;
exports.compact = compact;
exports.uncompact = uncompact;
exports.h3IndexesAreNeighbors = h3IndexesAreNeighbors;
exports.getH3UnidirectionalEdge = getH3UnidirectionalEdge;
exports.getOriginH3IndexFromUnidirectionalEdge = getOriginH3IndexFromUnidirectionalEdge;
exports.getDestinationH3IndexFromUnidirectionalEdge = getDestinationH3IndexFromUnidirectionalEdge;
exports.h3UnidirectionalEdgeIsValid = h3UnidirectionalEdgeIsValid;
exports.getH3IndexesFromUnidirectionalEdge = getH3IndexesFromUnidirectionalEdge;
exports.getH3UnidirectionalEdgesFromHexagon = getH3UnidirectionalEdgesFromHexagon;
exports.getH3UnidirectionalEdgeBoundary = getH3UnidirectionalEdgeBoundary;
exports.h3Distance = h3Distance;
exports.h3Line = h3Line;
exports.experimentalH3ToLocalIj = experimentalH3ToLocalIj;
exports.experimentalLocalIjToH3 = experimentalLocalIjToH3;
exports.pointDist = pointDist;
exports.cellArea = cellArea;
exports.exactEdgeLength = exactEdgeLength;
exports.hexArea = hexArea;
exports.edgeLength = edgeLength;
exports.numHexagons = numHexagons;
exports.getRes0Indexes = getRes0Indexes;
exports.getPentagonIndexes = getPentagonIndexes;
exports.degsToRads = degsToRads;
exports.radsToDegs = radsToDegs;


},{}],"geojson2h3":[function(require,module,exports){
/*
 * Copyright 2018 Uber Technologies, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module.exports = require('./dist/src/geojson2h3');

},{"./dist/src/geojson2h3":1}]},{},[]);
