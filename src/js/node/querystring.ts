var __commonJS =
  (cb, mod: typeof module | undefined = undefined) =>
  () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

var Buffer = require("node:buffer").Buffer;

// src/node-fallbacks/node_modules/querystring-es3/src/object-keys.js
var require_object_keys = __commonJS((exports, module) => {
  var objectKeys =
    Object.keys ||
    (function () {
      var hasOwnProperty = Object.prototype.hasOwnProperty;
      var hasDontEnumBug = !{ toString: null }.propertyIsEnumerable("toString");
      var dontEnums = [
        "toString",
        "toLocaleString",
        "valueOf",
        "hasOwnProperty",
        "isPrototypeOf",
        "propertyIsEnumerable",
        "constructor",
      ];
      var dontEnumsLength = dontEnums.length;
      return function (obj) {
        if (typeof obj !== "function" && (typeof obj !== "object" || obj === null)) {
          throw new TypeError("Object.keys called on non-object");
        }
        var result = [];
        var prop;
        var i;
        for (prop in obj) {
          if (hasOwnProperty.$call(obj, prop)) {
            result.push(prop);
          }
        }
        if (hasDontEnumBug) {
          for (i = 0; i < dontEnumsLength; i++) {
            if (hasOwnProperty.$call(obj, dontEnums[i])) {
              result.push(dontEnums[i]);
            }
          }
        }
        return result;
      };
    })();
  module.exports = objectKeys;
});

// src/node-fallbacks/node_modules/querystring-es3/src/index.js
var require_src = __commonJS((exports, module) => {
  var ParsedQueryString = function () {};
  var unescapeBuffer = function (s, decodeSpaces) {
    var out = Buffer.allocUnsafe(s.length);
    var state = 0;
    var n, m, hexchar, c;
    for (var inIndex = 0, outIndex = 0; ; inIndex++) {
      if (inIndex < s.length) {
        c = s.charCodeAt(inIndex);
      } else {
        if (state > 0) {
          out[outIndex++] = 37;
          if (state === 2) out[outIndex++] = hexchar;
        }
        break;
      }
      switch (state) {
        case 0:
          switch (c) {
            case 37:
              n = 0;
              m = 0;
              state = 1;
              break;
            case 43:
              if (decodeSpaces) c = 32;
            default:
              out[outIndex++] = c;
              break;
          }
          break;
        case 1:
          hexchar = c;
          n = unhexTable[c];
          if (!(n >= 0)) {
            out[outIndex++] = 37;
            out[outIndex++] = c;
            state = 0;
            break;
          }
          state = 2;
          break;
        case 2:
          state = 0;
          m = unhexTable[c];
          if (!(m >= 0)) {
            out[outIndex++] = 37;
            out[outIndex++] = hexchar;
            out[outIndex++] = c;
            break;
          }
          out[outIndex++] = 16 * n + m;
          break;
      }
    }
    return out.slice(0, outIndex);
  };
  var qsUnescape = function (s, decodeSpaces) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return QueryString.unescapeBuffer(s, decodeSpaces).toString();
    }
  };
  var qsEscape = function (str) {
    if (typeof str !== "string") {
      if (typeof str === "object") str = String(str);
      else str += "";
    }
    var out = "";
    var lastPos = 0;
    for (var i2 = 0; i2 < str.length; ++i2) {
      var c = str.charCodeAt(i2);
      if (c < 128) {
        if (noEscape[c] === 1) continue;
        if (lastPos < i2) out += str.slice(lastPos, i2);
        lastPos = i2 + 1;
        out += hexTable[c];
        continue;
      }
      if (lastPos < i2) out += str.slice(lastPos, i2);
      if (c < 2048) {
        lastPos = i2 + 1;
        out += hexTable[192 | (c >> 6)] + hexTable[128 | (c & 63)];
        continue;
      }
      if (c < 55296 || c >= 57344) {
        lastPos = i2 + 1;
        out += hexTable[224 | (c >> 12)] + hexTable[128 | ((c >> 6) & 63)] + hexTable[128 | (c & 63)];
        continue;
      }
      ++i2;
      var c2;
      if (i2 < str.length) c2 = str.charCodeAt(i2) & 1023;
      else throw new URIError("URI malformed");
      lastPos = i2 + 1;
      c = 65536 + (((c & 1023) << 10) | c2);
      out +=
        hexTable[240 | (c >> 18)] +
        hexTable[128 | ((c >> 12) & 63)] +
        hexTable[128 | ((c >> 6) & 63)] +
        hexTable[128 | (c & 63)];
    }
    if (lastPos === 0) return str;
    if (lastPos < str.length) return out + str.slice(lastPos);
    return out;
  };
  var stringifyPrimitive = function (v) {
    if (typeof v === "string") return v;
    if (typeof v === "number" && isFinite(v)) return "" + v;
    if (typeof v === "boolean") return v ? "true" : "false";
    return "";
  };
  var stringify = function (obj, sep, eq, options) {
    sep = sep || "&";
    eq = eq || "=";
    var encode = QueryString.escape;
    if (options && typeof options.encodeURIComponent === "function") {
      encode = options.encodeURIComponent;
    }
    if (obj !== null && typeof obj === "object") {
      var keys = objectKeys(obj);
      var len = keys.length;
      var flast = len - 1;
      var fields = "";
      for (var i2 = 0; i2 < len; ++i2) {
        var k = keys[i2];
        var v = obj[k];
        var ks = encode(stringifyPrimitive(k)) + eq;
        if (isArray(v)) {
          var vlen = v.length;
          var vlast = vlen - 1;
          for (var j = 0; j < vlen; ++j) {
            fields += ks + encode(stringifyPrimitive(v[j]));
            if (j < vlast) fields += sep;
          }
          if (vlen && i2 < flast) fields += sep;
        } else {
          fields += ks + encode(stringifyPrimitive(v));
          if (i2 < flast) fields += sep;
        }
      }
      return fields;
    }
    return "";
  };
  var charCodes = function (str) {
    if (str.length === 0) return [];
    if (str.length === 1) return [str.charCodeAt(0)];
    const ret = [];
    for (var i2 = 0; i2 < str.length; ++i2) ret[ret.length] = str.charCodeAt(i2);
    return ret;
  };
  var parse = function (qs, sep, eq, options) {
    const obj = new ParsedQueryString();
    if (typeof qs !== "string" || qs.length === 0) {
      return obj;
    }
    var sepCodes = !sep ? defSepCodes : charCodes(sep + "");
    var eqCodes = !eq ? defEqCodes : charCodes(eq + "");
    const sepLen = sepCodes.length;
    const eqLen = eqCodes.length;
    var pairs = 1000;
    if (options && typeof options.maxKeys === "number") {
      pairs = options.maxKeys > 0 ? options.maxKeys : -1;
    }
    var decode = QueryString.unescape;
    if (options && typeof options.decodeURIComponent === "function") {
      decode = options.decodeURIComponent;
    }
    const customDecode = decode !== qsUnescape;
    const keys = [];
    var posIdx = 0;
    var lastPos = 0;
    var sepIdx = 0;
    var eqIdx = 0;
    var key = "";
    var value = "";
    var keyEncoded = customDecode;
    var valEncoded = customDecode;
    var encodeCheck = 0;
    for (var i2 = 0; i2 < qs.length; ++i2) {
      const code = qs.charCodeAt(i2);
      if (code === sepCodes[sepIdx]) {
        if (++sepIdx === sepLen) {
          const end = i2 - sepIdx + 1;
          if (eqIdx < eqLen) {
            if (lastPos < end) key += qs.slice(lastPos, end);
          } else if (lastPos < end) value += qs.slice(lastPos, end);
          if (keyEncoded) key = decodeStr(key, decode);
          if (valEncoded) value = decodeStr(value, decode);
          if (key || value || lastPos - posIdx > sepLen || i2 === 0) {
            if (indexOf(keys, key) === -1) {
              obj[key] = value;
              keys[keys.length] = key;
            } else {
              const curValue = obj[key] || "";
              if (curValue.pop) curValue[curValue.length] = value;
              else if (curValue) obj[key] = [curValue, value];
            }
          } else if (i2 === 1) {
            delete obj[key];
          }
          if (--pairs === 0) break;
          keyEncoded = valEncoded = customDecode;
          encodeCheck = 0;
          key = value = "";
          posIdx = lastPos;
          lastPos = i2 + 1;
          sepIdx = eqIdx = 0;
        }
        continue;
      } else {
        sepIdx = 0;
        if (!valEncoded) {
          if (code === 37) {
            encodeCheck = 1;
          } else if (
            encodeCheck > 0 &&
            ((code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102))
          ) {
            if (++encodeCheck === 3) valEncoded = true;
          } else {
            encodeCheck = 0;
          }
        }
      }
      if (eqIdx < eqLen) {
        if (code === eqCodes[eqIdx]) {
          if (++eqIdx === eqLen) {
            const end = i2 - eqIdx + 1;
            if (lastPos < end) key += qs.slice(lastPos, end);
            encodeCheck = 0;
            lastPos = i2 + 1;
          }
          continue;
        } else {
          eqIdx = 0;
          if (!keyEncoded) {
            if (code === 37) {
              encodeCheck = 1;
            } else if (
              encodeCheck > 0 &&
              ((code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102))
            ) {
              if (++encodeCheck === 3) keyEncoded = true;
            } else {
              encodeCheck = 0;
            }
          }
        }
      }
      if (code === 43) {
        if (eqIdx < eqLen) {
          if (lastPos < i2) key += qs.slice(lastPos, i2);
          key += "%20";
          keyEncoded = true;
        } else {
          if (lastPos < i2) value += qs.slice(lastPos, i2);
          value += "%20";
          valEncoded = true;
        }
        lastPos = i2 + 1;
      }
    }
    if (pairs !== 0 && (lastPos < qs.length || eqIdx > 0)) {
      if (lastPos < qs.length) {
        if (eqIdx < eqLen) key += qs.slice(lastPos);
        else if (sepIdx < sepLen) value += qs.slice(lastPos);
      }
      if (keyEncoded) key = decodeStr(key, decode);
      if (valEncoded) value = decodeStr(value, decode);
      if (indexOf(keys, key) === -1) {
        obj[key] = value;
        keys[keys.length] = key;
      } else {
        const curValue = obj[key];
        if (curValue.pop) curValue[curValue.length] = value;
        else obj[key] = [curValue, value];
      }
    }
    return obj;
  };
  var decodeStr = function (s, decoder) {
    try {
      return decoder(s);
    } catch (e) {
      return QueryString.unescape(s, true);
    }
  };
  var QueryString = (module.exports = {
    unescapeBuffer,
    unescape: qsUnescape,
    escape: qsEscape,
    stringify,
    encode: stringify,
    parse,
    decode: parse,
  });
  var objectKeys = require_object_keys();
  var isArray = arg => Object.prototype.toString.$call(arg) === "[object Array]";
  var indexOf = (arr, searchElement, fromIndex) => {
    var k;
    if (arr == null) {
      throw new TypeError('"arr" is null or not defined');
    }
    var o = Object(arr);
    var len = o.length >>> 0;
    if (len === 0) {
      return -1;
    }
    var n = fromIndex | 0;
    if (n >= len) {
      return -1;
    }
    k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);
    while (k < len) {
      if (k in o && o[k] === searchElement) {
        return k;
      }
      k++;
    }
    return -1;
  };
  ParsedQueryString.prototype = Object.create ? Object.create(null) : {};
  var unhexTable = [
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, -1, -1,
    -1, -1, -1, -1, -1, 10, 11, 12, 13, 14, 15, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, 10, 11, 12, 13, 14, 15, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  ];
  var hexTable = [];
  for (i = 0; i < 256; ++i) hexTable[i] = "%" + ((i < 16 ? "0" : "") + i.toString(16)).toUpperCase();
  var i;
  var noEscape = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0,
  ];
  var defSepCodes = [38];
  var defEqCodes = [61];
});
export default require_src();
