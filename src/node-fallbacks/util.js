// NOTE: THIS IS A BROWSER POLYFILL - Bun's actual node:* modules are in src/js/node
//
// This file is derived from https://www.npmjs.com/package/util v0.12.5,
// converted into an Tree-shaking ES Module.

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
export function format(f, ...args) {
  if (!isString(f)) {
    var objects = [f];
    for (var i = 0; i < args.length; i++) {
      objects.push(inspect(args[i]));
    }
    return objects.join(" ");
  }

  var i = 0;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function (x) {
    if (x === "%%") return "%";
    if (i >= len) return x;
    switch (x) {
      case "%s":
        return String(args[i++]);
      case "%d":
        return Number(args[i++]);
      case "%j":
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return "[Circular]";
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += " " + x;
    } else {
      str += " " + inspect(x);
    }
  }
  return str;
}

// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
export function deprecate(fn, msg) {
  if (typeof process === "undefined" || process?.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated(...args) {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, ...args);
  }

  return deprecated;
}

// This function has been edited to be tree-shakable and minifiable
export const debuglog = /* @__PURE__ */ ((debugs = {}, debugEnvRegex = {}, debugEnv) => (
  ((debugEnv = typeof process !== "undefined" && process.env.NODE_DEBUG) &&
    (debugEnv = debugEnv
      .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/,/g, "$|^")
      .toUpperCase()),
  (debugEnvRegex = new RegExp("^" + debugEnv + "$", "i"))),
  set => {
    set = set.toUpperCase();
    if (!debugs[set]) {
      if (debugEnvRegex.test(set)) {
        debugs[set] = function (...args) {
          console.error("%s: %s", set, pid, format.apply(null, ...args));
        };
      } else {
        debugs[set] = function () {};
      }
    }
    return debugs[set];
  }
))();

/**
 * Echos the value of a value. Tries to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
export const inspect = /* @__PURE__ */ (i =>
  // http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
  (
    (i.colors = {
      "bold": [1, 22],
      "italic": [3, 23],
      "underline": [4, 24],
      "inverse": [7, 27],
      "white": [37, 39],
      "grey": [90, 39],
      "black": [30, 39],
      "blue": [34, 39],
      "cyan": [36, 39],
      "green": [32, 39],
      "magenta": [35, 39],
      "red": [31, 39],
      "yellow": [33, 39],
    }),
    // Don't use 'blue' not visible on cmd.exe
    (i.styles = {
      "special": "cyan",
      "number": "yellow",
      "boolean": "yellow",
      "undefined": "grey",
      "null": "bold",
      "string": "green",
      "date": "magenta",
      // "name": intentionally not styling
      "regexp": "red",
    }),
    (i.custom = Symbol.for("nodejs.util.inspect.custom")),
    i
  ))(function inspect(obj, opts, ...rest) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor,
  };
  // legacy...
  if (rest.length >= 1) ctx.depth = rest[0];
  if (rest.length >= 2) ctx.colors = rest[1];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    _extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
});

function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return "\u001b[" + inspect.colors[style][0] + "m" + str + "\u001b[" + inspect.colors[style][1] + "m";
  } else {
    return str;
  }
}

function stylizeNoColor(str, styleType) {
  return str;
}

function arrayToHash(array) {
  var hash = {};

  array.forEach(function (val, idx) {
    hash[val] = true;
  });

  return hash;
}

function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (
    ctx.customInspect &&
    value &&
    isFunction(value.inspect) &&
    // Filter out the util module, it's inspect function is special
    value.inspect !== inspect &&
    // Also filter out any prototype objects using the circular check.
    !(value.constructor && value.constructor.prototype === value)
  ) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value) && (keys.indexOf("message") >= 0 || keys.indexOf("description") >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ": " + value.name : "";
      return ctx.stylize("[Function" + name + "]", "special");
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), "regexp");
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), "date");
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = "",
    array = false,
    braces = ["{", "}"];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ["[", "]"];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ": " + value.name : "";
    base = " [Function" + n + "]";
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = " " + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = " " + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = " " + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), "regexp");
    } else {
      return ctx.stylize("[Object]", "special");
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function (key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}

function formatPrimitive(ctx, value) {
  if (isUndefined(value)) return ctx.stylize("undefined", "undefined");
  if (isString(value)) {
    var simple = "'" + JSON.stringify(value).replace(/^"|"$/g, "").replace(/'/g, "\\'").replace(/\\"/g, '"') + "'";
    return ctx.stylize(simple, "string");
  }
  if (isNumber(value)) return ctx.stylize("" + value, "number");
  if (isBoolean(value)) return ctx.stylize("" + value, "boolean");
  // For some reason typeof null is "object", so special case here.
  if (isNull(value)) return ctx.stylize("null", "null");
}

function formatError(value) {
  return "[" + Error.prototype.toString.call(value) + "]";
}

function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, String(i), true));
    } else {
      output.push("");
    }
  }
  keys.forEach(function (key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, key, true));
    }
  });
  return output;
}

function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize("[Getter/Setter]", "special");
    } else {
      str = ctx.stylize("[Getter]", "special");
    }
  } else {
    if (desc.set) {
      str = ctx.stylize("[Setter]", "special");
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = "[" + key + "]";
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf("\n") > -1) {
        if (array) {
          str = str
            .split("\n")
            .map(function (line) {
              return "  " + line;
            })
            .join("\n")
            .slice(2);
        } else {
          str =
            "\n" +
            str
              .split("\n")
              .map(function (line) {
                return "   " + line;
              })
              .join("\n");
        }
      }
    } else {
      str = ctx.stylize("[Circular]", "special");
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify("" + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.slice(1, -1);
      name = ctx.stylize(name, "name");
    } else {
      name = name
        .replace(/'/g, "\\'")
        .replace(/\\"/g, '"')
        .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, "string");
    }
  }

  return name + ": " + str;
}

function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function (prev, cur) {
    numLinesEst++;
    if (cur.indexOf("\n") >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, "").length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] + (base === "" ? "" : base + "\n ") + " " + output.join(",\n  ") + " " + braces[1];
  }

  return braces[0] + base + " " + output.join(", ") + " " + braces[1];
}

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
export const types = /* @__PURE__ */ () => {
  // var toStr = Object.prototype.toString;
  // var fnToStr = Function.prototype.toString;
  // function isArgumentsObject(value) {
  //   if (hasToStringTag && value && typeof value === "object" && Symbol.toStringTag in value) {
  //     return false;
  //   }
  //   return toStr.apply(value) === "[object Arguments]";
  // }
  // var isFnRegex = /^\s*(?:function)?\*/;
  // var getProto = Object.getPrototypeOf;
  // var GeneratorFunction;
  // function isGeneratorFunction(fn) {
  //   if (typeof fn !== "function") {
  //     return false;
  //   }
  //   if (isFnRegex.test(fnToStr.call(fn))) {
  //     return true;
  //   }
  //   if (typeof GeneratorFunction === "undefined") {
  //     var generatorFunc;
  //     try {
  //       generatorFunc = Function("return function*() {}")();
  //     } catch (e) {}
  //     GeneratorFunction = generatorFunc ? getProto(generatorFunc) : false;
  //   }
  //   return getProto(fn) === GeneratorFunction;
  // }
  // // var whichTypedArray = require("which-typed-array");
  // // var isTypedArray = require("is-typed-array");
  // function uncurryThis(f) {
  //   return f.call.bind(f);
  // }
  // var BigIntSupported = typeof BigInt !== "undefined";
  // var SymbolSupported = typeof Symbol !== "undefined";
  // var ObjectToString = uncurryThis(Object.prototype.toString);
  // var numberValue = uncurryThis(Number.prototype.valueOf);
  // var stringValue = uncurryThis(String.prototype.valueOf);
  // var booleanValue = uncurryThis(Boolean.prototype.valueOf);
  // if (BigIntSupported) {
  //   var bigIntValue = uncurryThis(BigInt.prototype.valueOf);
  // }
  // if (SymbolSupported) {
  //   var symbolValue = uncurryThis(Symbol.prototype.valueOf);
  // }
  // function checkBoxedPrimitive(value, prototypeValueOf) {
  //   if (typeof value !== "object") {
  //     return false;
  //   }
  //   try {
  //     prototypeValueOf(value);
  //     return true;
  //   } catch (e) {
  //     return false;
  //   }
  // }
  // exports.isArgumentsObject = isArgumentsObject;
  // exports.isGeneratorFunction = isGeneratorFunction;
  // exports.isTypedArray = isTypedArray;
  // // Taken from here and modified for better browser support
  // // https://github.com/sindresorhus/p-is-promise/blob/cda35a513bda03f977ad5cde3a079d237e82d7ef/index.js
  // function isPromise(input) {
  //   return (
  //     (typeof Promise !== "undefined" && input instanceof Promise) ||
  //     (input !== null &&
  //       typeof input === "object" &&
  //       typeof input.then === "function" &&
  //       typeof input.catch === "function")
  //   );
  // }
  // exports.isPromise = isPromise;
  // function isArrayBufferView(value) {
  //   if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView) {
  //     return ArrayBuffer.isView(value);
  //   }
  //   return isTypedArray(value) || isDataView(value);
  // }
  // exports.isArrayBufferView = isArrayBufferView;
  // function isUint8Array(value) {
  //   return whichTypedArray(value) === "Uint8Array";
  // }
  // exports.isUint8Array = isUint8Array;
  // function isUint8ClampedArray(value) {
  //   return whichTypedArray(value) === "Uint8ClampedArray";
  // }
  // exports.isUint8ClampedArray = isUint8ClampedArray;
  // function isUint16Array(value) {
  //   return whichTypedArray(value) === "Uint16Array";
  // }
  // exports.isUint16Array = isUint16Array;
  // function isUint32Array(value) {
  //   return whichTypedArray(value) === "Uint32Array";
  // }
  // exports.isUint32Array = isUint32Array;
  // function isInt8Array(value) {
  //   return whichTypedArray(value) === "Int8Array";
  // }
  // exports.isInt8Array = isInt8Array;
  // function isInt16Array(value) {
  //   return whichTypedArray(value) === "Int16Array";
  // }
  // exports.isInt16Array = isInt16Array;
  // function isInt32Array(value) {
  //   return whichTypedArray(value) === "Int32Array";
  // }
  // exports.isInt32Array = isInt32Array;
  // function isFloat32Array(value) {
  //   return whichTypedArray(value) === "Float32Array";
  // }
  // exports.isFloat32Array = isFloat32Array;
  // function isFloat64Array(value) {
  //   return whichTypedArray(value) === "Float64Array";
  // }
  // exports.isFloat64Array = isFloat64Array;
  // function isBigInt64Array(value) {
  //   return whichTypedArray(value) === "BigInt64Array";
  // }
  // exports.isBigInt64Array = isBigInt64Array;
  // function isBigUint64Array(value) {
  //   return whichTypedArray(value) === "BigUint64Array";
  // }
  // exports.isBigUint64Array = isBigUint64Array;
  // function isMapToString(value) {
  //   return ObjectToString(value) === "[object Map]";
  // }
  // isMapToString.working = typeof Map !== "undefined" && isMapToString(new Map());
  // function isMap(value) {
  //   if (typeof Map === "undefined") {
  //     return false;
  //   }
  //   return isMapToString.working ? isMapToString(value) : value instanceof Map;
  // }
  // exports.isMap = isMap;
  // function isSetToString(value) {
  //   return ObjectToString(value) === "[object Set]";
  // }
  // isSetToString.working = typeof Set !== "undefined" && isSetToString(new Set());
  // function isSet(value) {
  //   if (typeof Set === "undefined") {
  //     return false;
  //   }
  //   return isSetToString.working ? isSetToString(value) : value instanceof Set;
  // }
  // exports.isSet = isSet;
  // function isWeakMapToString(value) {
  //   return ObjectToString(value) === "[object WeakMap]";
  // }
  // isWeakMapToString.working = typeof WeakMap !== "undefined" && isWeakMapToString(new WeakMap());
  // function isWeakMap(value) {
  //   if (typeof WeakMap === "undefined") {
  //     return false;
  //   }
  //   return isWeakMapToString.working ? isWeakMapToString(value) : value instanceof WeakMap;
  // }
  // exports.isWeakMap = isWeakMap;
  // function isWeakSetToString(value) {
  //   return ObjectToString(value) === "[object WeakSet]";
  // }
  // isWeakSetToString.working = typeof WeakSet !== "undefined" && isWeakSetToString(new WeakSet());
  // function isWeakSet(value) {
  //   return isWeakSetToString(value);
  // }
  // exports.isWeakSet = isWeakSet;
  // function isArrayBufferToString(value) {
  //   return ObjectToString(value) === "[object ArrayBuffer]";
  // }
  // isArrayBufferToString.working = typeof ArrayBuffer !== "undefined" && isArrayBufferToString(new ArrayBuffer());
  // function isArrayBuffer(value) {
  //   if (typeof ArrayBuffer === "undefined") {
  //     return false;
  //   }
  //   return isArrayBufferToString.working ? isArrayBufferToString(value) : value instanceof ArrayBuffer;
  // }
  // exports.isArrayBuffer = isArrayBuffer;
  // function isDataViewToString(value) {
  //   return ObjectToString(value) === "[object DataView]";
  // }
  // isDataViewToString.working =
  //   typeof ArrayBuffer !== "undefined" &&
  //   typeof DataView !== "undefined" &&
  //   isDataViewToString(new DataView(new ArrayBuffer(1), 0, 1));
  // function isDataView(value) {
  //   if (typeof DataView === "undefined") {
  //     return false;
  //   }
  //   return isDataViewToString.working ? isDataViewToString(value) : value instanceof DataView;
  // }
  // exports.isDataView = isDataView;
  // // Store a copy of SharedArrayBuffer in case it's deleted elsewhere
  // var SharedArrayBufferCopy = typeof SharedArrayBuffer !== "undefined" ? SharedArrayBuffer : undefined;
  // function isSharedArrayBufferToString(value) {
  //   return ObjectToString(value) === "[object SharedArrayBuffer]";
  // }
  // function isSharedArrayBuffer(value) {
  //   if (typeof SharedArrayBufferCopy === "undefined") {
  //     return false;
  //   }
  //   if (typeof isSharedArrayBufferToString.working === "undefined") {
  //     isSharedArrayBufferToString.working = isSharedArrayBufferToString(new SharedArrayBufferCopy());
  //   }
  //   return isSharedArrayBufferToString.working
  //     ? isSharedArrayBufferToString(value)
  //     : value instanceof SharedArrayBufferCopy;
  // }
  // exports.isSharedArrayBuffer = isSharedArrayBuffer;
  // function isAsyncFunction(value) {
  //   return ObjectToString(value) === "[object AsyncFunction]";
  // }
  // exports.isAsyncFunction = isAsyncFunction;
  // function isMapIterator(value) {
  //   return ObjectToString(value) === "[object Map Iterator]";
  // }
  // exports.isMapIterator = isMapIterator;
  // function isSetIterator(value) {
  //   return ObjectToString(value) === "[object Set Iterator]";
  // }
  // exports.isSetIterator = isSetIterator;
  // function isGeneratorObject(value) {
  //   return ObjectToString(value) === "[object Generator]";
  // }
  // exports.isGeneratorObject = isGeneratorObject;
  // function isWebAssemblyCompiledModule(value) {
  //   return ObjectToString(value) === "[object WebAssembly.Module]";
  // }
  // exports.isWebAssemblyCompiledModule = isWebAssemblyCompiledModule;
  // function isNumberObject(value) {
  //   return checkBoxedPrimitive(value, numberValue);
  // }
  // exports.isNumberObject = isNumberObject;
  // function isStringObject(value) {
  //   return checkBoxedPrimitive(value, stringValue);
  // }
  // exports.isStringObject = isStringObject;
  // function isBooleanObject(value) {
  //   return checkBoxedPrimitive(value, booleanValue);
  // }
  // exports.isBooleanObject = isBooleanObject;
  // function isBigIntObject(value) {
  //   return BigIntSupported && checkBoxedPrimitive(value, bigIntValue);
  // }
  // exports.isBigIntObject = isBigIntObject;
  // function isSymbolObject(value) {
  //   return SymbolSupported && checkBoxedPrimitive(value, symbolValue);
  // }
  // exports.isSymbolObject = isSymbolObject;
  // function isBoxedPrimitive(value) {
  //   return (
  //     isNumberObject(value) ||
  //     isStringObject(value) ||
  //     isBooleanObject(value) ||
  //     isBigIntObject(value) ||
  //     isSymbolObject(value)
  //   );
  // }
  // exports.isBoxedPrimitive = isBoxedPrimitive;
  // function isAnyArrayBuffer(value) {
  //   return typeof Uint8Array !== "undefined" && (isArrayBuffer(value) || isSharedArrayBuffer(value));
  // }
  // exports.isAnyArrayBuffer = isAnyArrayBuffer;
  // ["isProxy", "isExternal", "isModuleNamespaceObject"].forEach(function (method) {
  //   Object.defineProperty(exports, method, {
  //     enumerable: false,
  //     value: function () {
  //       throw new Error(method + " is not supported in userland");
  //     },
  //   });
  // });
  // exports.types.isRegExp = isRegExp;
  // exports.types.isDate = isDate;
  // exports.types.isNativeError = isError;
};

export function isArray(ar) {
  return Array.isArray(ar);
}

export function isBoolean(arg) {
  return typeof arg === "boolean";
}

export function isNull(arg) {
  return arg === null;
}

export function isNullOrUndefined(arg) {
  return arg == null;
}

export function isNumber(arg) {
  return typeof arg === "number";
}

export function isString(arg) {
  return typeof arg === "string";
}

export function isSymbol(arg) {
  return typeof arg === "symbol";
}

export function isUndefined(arg) {
  return arg === void 0;
}

export function isRegExp(re) {
  return isObject(re) && objectToString(re) === "[object RegExp]";
}

export function isObject(arg) {
  return typeof arg === "object" && arg !== null;
}

export function isDate(d) {
  return isObject(d) && objectToString(d) === "[object Date]";
}

export function isError(e) {
  return isObject(e) && (objectToString(e) === "[object Error]" || e instanceof Error);
}

export function isFunction(arg) {
  return typeof arg === "function";
}

export function isPrimitive(arg) {
  return (
    arg === null ||
    typeof arg === "boolean" ||
    typeof arg === "number" ||
    typeof arg === "string" ||
    typeof arg === "symbol" || // ES6 symbol
    typeof arg === "undefined"
  );
}

// Compatibility with the buffer polyfill:
export function isBuffer(arg) {
  return arg instanceof Buffer;
}

function objectToString(o) {
  return Object.prototype.toString.call(o);
}

function pad(n) {
  return n < 10 ? "0" + n.toString(10) : n.toString(10);
}

var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(":");
  return [d.getDate(), months[d.getMonth()], time].join(" ");
}

// log is just a thin wrapper to console.log that prepends a timestamp
export function log(...args) {
  console.log("%s - %s", timestamp(), format.apply(null, args));
}

/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
export function inherits(ctor, superCtor) {
  if (superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true,
      },
    });
  }
}

export function _extend(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
}

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

export const promisify = /* @__PURE__ */ (x => ((x.custom = Symbol.for("nodejs.util.promisify.custom")), x))(
  function promisify(original) {
    if (typeof original !== "function") throw new TypeError('The "original" argument must be of type Function');

    if (kCustomPromisifiedSymbol && original[kCustomPromisifiedSymbol]) {
      var fn = original[kCustomPromisifiedSymbol];

      if (typeof fn !== "function") {
        throw new TypeError('The "nodejs.util.promisify.custom" argument must be of type Function');
      }

      Object.defineProperty(fn, kCustomPromisifiedSymbol, {
        value: fn,
        enumerable: false,
        writable: false,
        configurable: true,
      });
      return fn;
    }

    function fn(...args) {
      var promiseResolve, promiseReject;
      var promise = new Promise(function (resolve, reject) {
        promiseResolve = resolve;
        promiseReject = reject;
      });

      args.push(function (err, value) {
        if (err) {
          promiseReject(err);
        } else {
          promiseResolve(value);
        }
      });

      try {
        original.apply(this, args);
      } catch (err) {
        promiseReject(err);
      }

      return promise;
    }

    Object.setPrototypeOf(fn, Object.getPrototypeOf(original));

    if (kCustomPromisifiedSymbol)
      Object.defineProperty(fn, kCustomPromisifiedSymbol, {
        value: fn,
        enumerable: false,
        writable: false,
        configurable: true,
      });
    return Object.defineProperties(fn, Object.getOwnPropertyDescriptors(original));
  },
);

export function callbackifyOnRejected(reason, cb) {
  // `!reason` guard inspired by bluebird (Ref: https://goo.gl/t5IS6M).
  // Because `null` is a special error value in callbacks which means "no error
  // occurred", we error-wrap so the callback consumer can distinguish between
  // "the promise rejected with null" or "the promise fulfilled with undefined".
  if (!reason) {
    var newReason = new Error("Promise was rejected with a falsy value");
    newReason.reason = reason;
    reason = newReason;
  }
  return cb(reason);
}

export function callbackify(original) {
  if (typeof original !== "function") {
    throw new TypeError('The "original" argument must be of type Function');
  }

  // We DO NOT return the promise as it gives the user a false sense that
  // the promise is actually somehow related to the callback's execution
  // and that the callback throwing will reject the promise.
  function callbackified(...args) {
    var maybeCb = args.pop();
    if (typeof maybeCb !== "function") {
      throw new TypeError("The last argument must be of type Function");
    }
    var self = this;
    var cb = function (...args) {
      return maybeCb.apply(self, ...args);
    };
    // In true node style we process the callback on `nextTick` with all the
    // implications (stack, `uncaughtException`, `async_hooks`)
    original.apply(this, args).then(
      function (ret) {
        process.nextTick(cb.bind(null, null, ret));
      },
      function (rej) {
        process.nextTick(callbackifyOnRejected.bind(null, rej, cb));
      },
    );
  }

  Object.setPrototypeOf(callbackified, Object.getPrototypeOf(original));
  Object.defineProperties(callbackified, Object.getOwnPropertyDescriptors(original));

  return callbackified;
}

export const TextEncoder = /* @__PURE__ */ globalThis.TextEncoder;
export const TextDecoder = /* @__PURE__ */ globalThis.TextDecoder;
