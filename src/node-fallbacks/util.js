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
  var proc = globalThis.process;
  if (proc == null || proc.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated(...args) {
    if (!warned) {
      if (proc.throwDeprecation) {
        throw new Error(msg);
      } else if (proc.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, args);
  }

  return deprecated;
}

// This function has been edited to be tree-shakable and minifiable
export const debuglog = /* @__PURE__ */ ((debugs = {}, debugEnvRegex, debugEnv) => (
  (debugEnv = globalThis.process?.env?.NODE_DEBUG) &&
    (debugEnvRegex = new RegExp(
      "^" +
        debugEnv
          .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/,/g, "$|^")
          .toUpperCase() +
        "$",
      "i",
    )),
  set => {
    set = set.toUpperCase();
    if (!debugs[set]) {
      if (debugEnvRegex?.test(set)) {
        debugs[set] = function (...args) {
          console.error("%s: %s", set, format(...args));
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

export const types = /* @__PURE__ */ () => {};

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

// Browsers have no Buffer global, so detect the buffer polyfill by its methods.
export function isBuffer(arg) {
  return (
    typeof arg === "object" &&
    arg !== null &&
    typeof arg.copy === "function" &&
    typeof arg.fill === "function" &&
    typeof arg.readUInt8 === "function"
  );
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

const kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");

export const promisify = /* @__PURE__ */ (x => ((x.custom = kCustomPromisifiedSymbol), x))(
  function promisify(original) {
    if (typeof original !== "function") throw new TypeError('The "original" argument must be of type Function');

    if (original[kCustomPromisifiedSymbol]) {
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
      return maybeCb.apply(self, args);
    };
    // Like process.nextTick in Node, a throw from the callback is an uncaught error, not a rejection.
    original.apply(this, args).then(
      function (ret) {
        queueMicrotask(cb.bind(null, null, ret));
      },
      function (rej) {
        queueMicrotask(callbackifyOnRejected.bind(null, rej, cb));
      },
    );
  }

  Object.setPrototypeOf(callbackified, Object.getPrototypeOf(original));
  Object.defineProperties(callbackified, Object.getOwnPropertyDescriptors(original));

  return callbackified;
}

export const TextEncoder = /* @__PURE__ */ globalThis.TextEncoder;
export const TextDecoder = /* @__PURE__ */ globalThis.TextDecoder;
export default {
  format,
  deprecate,
  debuglog,
  inspect,
  types,
  isArray,
  isBoolean,
  isNull,
  isNullOrUndefined,
  isNumber,
  isString,
  isSymbol,
  isUndefined,
  isRegExp,
  isObject,
  isDate,
  isError,
  isFunction,
  isPrimitive,
  isBuffer,
  log,
  inherits,
  _extend,
  promisify,
  callbackifyOnRejected,
  callbackify,
  TextEncoder,
  TextDecoder,
};
