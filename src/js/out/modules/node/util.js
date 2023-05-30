var isBufferInterface = function({ copy, fill, readUint8 }) {
  return typeof copy === "function" && typeof fill === "function" && typeof readUint8 === "function";
};
function isBuffer(value) {
  return Buffer.isBuffer(value) || typeof value === "object" && isBufferInterface(value || {});
}
var format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0;i < arguments.length; i++)
      objects.push(inspect(arguments[i]));
    return objects.join(" ");
  }
  var i = 1, args = arguments, len = args.length, str = String(f).replace(formatRegExp, function(x2) {
    if (x2 === "%%")
      return "%";
    if (i >= len)
      return x2;
    switch (x2) {
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
        return x2;
    }
  });
  for (var x = args[i];i < len; x = args[++i])
    if (isNull(x) || !isObject(x))
      str += " " + x;
    else
      str += " " + inspect(x);
  return str;
}, deprecate = function(fn, msg) {
  if (typeof process !== "undefined" && process.noDeprecation === !0)
    return fn;
  if (typeof process === "undefined")
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  var warned = !1;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation)
        throw new Error(msg);
      else if (process.traceDeprecation)
        console.trace(msg);
      else
        console.error(msg);
      warned = !0;
    }
    return fn.apply(this, arguments);
  }
  return deprecated;
}, debuglog = function(set) {
  if (set = set.toUpperCase(), !debugs[set])
    if (debugEnvRegex.test(set)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error("%s %d: %s", set, pid, msg);
      };
    } else
      debugs[set] = function() {
      };
  return debugs[set];
}, inspect = function(obj, opts) {
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  if (arguments.length >= 3)
    ctx.depth = arguments[2];
  if (arguments.length >= 4)
    ctx.colors = arguments[3];
  if (isBoolean(opts))
    ctx.showHidden = opts;
  else if (opts)
    exports._extend(ctx, opts);
  if (isUndefined(ctx.showHidden))
    ctx.showHidden = !1;
  if (isUndefined(ctx.depth))
    ctx.depth = 2;
  if (isUndefined(ctx.colors))
    ctx.colors = !1;
  if (isUndefined(ctx.customInspect))
    ctx.customInspect = !0;
  if (ctx.colors)
    ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}, stylizeWithColor = function(str, styleType) {
  var style = inspect.styles[styleType];
  if (style)
    return "\x1B[" + inspect.colors[style][0] + "m" + str + "\x1B[" + inspect.colors[style][1] + "m";
  else
    return str;
}, stylizeNoColor = function(str, styleType) {
  return str;
}, arrayToHash = function(array) {
  var hash = {};
  return array.forEach(function(val, idx) {
    hash[val] = !0;
  }), hash;
}, formatValue = function(ctx, value, recurseTimes) {
  if (ctx.customInspect && value && isFunction(value.inspect) && value.inspect !== exports.inspect && !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret))
      ret = formatValue(ctx, ret, recurseTimes);
    return ret;
  }
  var primitive = formatPrimitive(ctx, value);
  if (primitive)
    return primitive;
  var keys = Object.keys(value), visibleKeys = arrayToHash(keys);
  if (ctx.showHidden)
    keys = Object.getOwnPropertyNames(value);
  if (isError(value) && (keys.indexOf("message") >= 0 || keys.indexOf("description") >= 0))
    return formatError(value);
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ": " + value.name : "";
      return ctx.stylize("[Function" + name + "]", "special");
    }
    if (isRegExp(value))
      return ctx.stylize(RegExp.prototype.toString.call(value), "regexp");
    if (isDate(value))
      return ctx.stylize(Date.prototype.toString.call(value), "date");
    if (isError(value))
      return formatError(value);
  }
  var base = "", array = !1, braces = ["{", "}"];
  if (isArray(value))
    array = !0, braces = ["[", "]"];
  if (isFunction(value)) {
    var n = value.name ? ": " + value.name : "";
    base = " [Function" + n + "]";
  }
  if (isRegExp(value))
    base = " " + RegExp.prototype.toString.call(value);
  if (isDate(value))
    base = " " + Date.prototype.toUTCString.call(value);
  if (isError(value))
    base = " " + formatError(value);
  if (keys.length === 0 && (!array || value.length == 0))
    return braces[0] + base + braces[1];
  if (recurseTimes < 0)
    if (isRegExp(value))
      return ctx.stylize(RegExp.prototype.toString.call(value), "regexp");
    else
      return ctx.stylize("[Object]", "special");
  ctx.seen.push(value);
  var output;
  if (array)
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  else
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  return ctx.seen.pop(), reduceToSingleString(output, base, braces);
}, formatPrimitive = function(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize("undefined", "undefined");
  if (isString(value)) {
    var simple = "'" + JSON.stringify(value).replace(/^"|"$/g, "").replace(/'/g, "\\'").replace(/\\"/g, '"') + "'";
    return ctx.stylize(simple, "string");
  }
  if (isNumber(value))
    return ctx.stylize("" + value, "number");
  if (isBoolean(value))
    return ctx.stylize("" + value, "boolean");
  if (isNull(value))
    return ctx.stylize("null", "null");
}, formatError = function(value) {
  return "[" + Error.prototype.toString.call(value) + "]";
}, formatArray = function(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length;i < l; ++i)
    if (hasOwnProperty(value, String(i)))
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, String(i), !0));
    else
      output.push("");
  return keys.forEach(function(key) {
    if (!key.match(/^\d+$/))
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys, key, !0));
  }), output;
}, formatProperty = function(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  if (desc = Object.getOwnPropertyDescriptor(value, key) || {
    value: value[key]
  }, desc.get)
    if (desc.set)
      str = ctx.stylize("[Getter/Setter]", "special");
    else
      str = ctx.stylize("[Getter]", "special");
  else if (desc.set)
    str = ctx.stylize("[Setter]", "special");
  if (!hasOwnProperty(visibleKeys, key))
    name = "[" + key + "]";
  if (!str)
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes))
        str = formatValue(ctx, desc.value, null);
      else
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      if (str.indexOf("\n") > -1)
        if (array)
          str = str.split("\n").map(function(line) {
            return "  " + line;
          }).join("\n").substr(2);
        else
          str = "\n" + str.split("\n").map(function(line) {
            return "   " + line;
          }).join("\n");
    } else
      str = ctx.stylize("[Circular]", "special");
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/))
      return str;
    if (name = JSON.stringify("" + key), name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/))
      name = name.substr(1, name.length - 2), name = ctx.stylize(name, "name");
    else
      name = name.replace(/'/g, "\\'").replace(/\\"/g, '"').replace(/(^"|"$)/g, "'"), name = ctx.stylize(name, "string");
  }
  return name + ": " + str;
}, reduceToSingleString = function(output, base, braces) {
  var numLinesEst = 0, length = output.reduce(function(prev, cur) {
    if (numLinesEst++, cur.indexOf("\n") >= 0)
      numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, "").length + 1;
  }, 0);
  if (length > 60)
    return braces[0] + (base === "" ? "" : base + "\n ") + " " + output.join(",\n  ") + " " + braces[1];
  return braces[0] + base + " " + output.join(", ") + " " + braces[1];
}, isArray = function(ar) {
  return Array.isArray(ar);
}, isBoolean = function(arg) {
  return typeof arg === "boolean";
}, isNull = function(arg) {
  return arg === null;
}, isNullOrUndefined = function(arg) {
  return arg == null;
}, isNumber = function(arg) {
  return typeof arg === "number";
}, isString = function(arg) {
  return typeof arg === "string";
}, isSymbol = function(arg) {
  return typeof arg === "symbol";
}, isUndefined = function(arg) {
  return arg === void 0;
}, isObject = function(arg) {
  return typeof arg === "object" && arg !== null;
}, isFunction = function(arg) {
  return typeof arg === "function";
}, isPrimitive = function(arg) {
  return arg === null || typeof arg === "boolean" || typeof arg === "number" || typeof arg === "string" || typeof arg === "symbol" || typeof arg === "undefined";
}, pad = function(n) {
  return n < 10 ? "0" + n.toString(10) : n.toString(10);
}, timestamp = function() {
  var d = new Date, time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(":");
  return [d.getDate(), months[d.getMonth()], time].join(" ");
}, hasOwnProperty = function(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}, callbackifyOnRejected = function(reason, cb) {
  if (!reason) {
    var newReason = new Error("Promise was rejected with a falsy value");
    newReason.reason = reason, reason = newReason;
  }
  return cb(reason);
}, callbackify = function(original) {
  if (typeof original !== "function")
    throw new TypeError('The "original" argument must be of type Function');
  function callbackified() {
    var args = Array.prototype.slice.call(arguments), maybeCb = args.pop();
    if (typeof maybeCb !== "function")
      throw new TypeError("The last argument must be of type Function");
    var self = this, cb = function() {
      return maybeCb.apply(self, arguments);
    };
    original.apply(this, args).then(function(ret) {
      process.nextTick(cb, null, null, ret);
    }, function(rej) {
      process.nextTick(callbackifyOnRejected, null, rej, cb);
    });
  }
  return Object.setPrototypeOf(callbackified, Object.getPrototypeOf(original)), Object.defineProperties(callbackified, getOwnPropertyDescriptors(original)), callbackified;
}, __getOwnPropNames = Object.getOwnPropertyNames, __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
}, require_inherits_browser = __commonJS({
  "node_modules/inherits/inherits_browser.js"(exports, module2) {
    module2.exports = function inherits(ctor, superCtor) {
      ctor.super_ = superCtor, ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
          value: ctor,
          enumerable: !1,
          writable: !0,
          configurable: !0
        }
      });
    };
  }
}), deepEquals = Bun.deepEquals, isDeepStrictEqual = (a, b) => deepEquals(a, b, !0), exports = {
  isDeepStrictEqual
}, getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors, formatRegExp = /%[sdj%]/g;
exports.format = format;
exports.deprecate = deprecate;
var debugs = {}, debugEnvRegex = /^$/;
if (process.env.NODE_DEBUG)
  debugEnv = process.env.NODE_DEBUG, debugEnv = debugEnv.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*").replace(/,/g, "$|^").toUpperCase(), debugEnvRegex = new RegExp("^" + debugEnv + "$", "i");
var debugEnv;
exports.debuglog = debuglog;
exports.inspect = inspect;
inspect.colors = {
  bold: [1, 22],
  italic: [3, 23],
  underline: [4, 24],
  inverse: [7, 27],
  white: [37, 39],
  grey: [90, 39],
  black: [30, 39],
  blue: [34, 39],
  cyan: [36, 39],
  green: [32, 39],
  magenta: [35, 39],
  red: [31, 39],
  yellow: [33, 39]
};
inspect.styles = {
  special: "cyan",
  number: "yellow",
  boolean: "yellow",
  undefined: "grey",
  null: "bold",
  string: "green",
  date: "magenta",
  regexp: "red"
};
var types = import.meta.require("node:util/types");
exports.types = types;
exports.isArray = isArray;
exports.isBoolean = isBoolean;
exports.isNull = isNull;
exports.isNullOrUndefined = isNullOrUndefined;
exports.isNumber = isNumber;
exports.isString = isString;
exports.isSymbol = isSymbol;
exports.isUndefined = isUndefined;
var isRegExp = exports.isRegExp = exports.types.isRegExp;
exports.isObject = isObject;
var isDate = exports.isDate = exports.types.isDate, isError = exports.isError = exports.types.isNativeError, isFunction = exports.isFunction = isFunction;
exports.isPrimitive = isPrimitive;
exports.isBuffer = isBuffer;
var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], log = exports.log = function() {
  console.log("%s - %s", timestamp(), exports.format.apply(exports, arguments));
}, inherits = exports.inherits = require_inherits_browser(), _extend = exports._extend = function(origin, add) {
  if (!add || !isObject(add))
    return origin;
  var keys = Object.keys(add), i = keys.length;
  while (i--)
    origin[keys[i]] = add[keys[i]];
  return origin;
}, kCustomPromisifiedSymbol = Symbol.for("util.promisify.custom"), promisify = exports.promisify = function promisify2(original) {
  if (typeof original !== "function")
    throw new TypeError('The "original" argument must be of type Function');
  if (kCustomPromisifiedSymbol && original[kCustomPromisifiedSymbol]) {
    var fn = original[kCustomPromisifiedSymbol];
    if (typeof fn !== "function")
      throw new TypeError('The "util.promisify.custom" argument must be of type Function');
    return Object.defineProperty(fn, kCustomPromisifiedSymbol, {
      value: fn,
      enumerable: !1,
      writable: !1,
      configurable: !0
    }), fn;
  }
  function fn() {
    var promiseResolve, promiseReject, promise = new Promise(function(resolve, reject) {
      promiseResolve = resolve, promiseReject = reject;
    }), args = [];
    for (var i = 0;i < arguments.length; i++)
      args.push(arguments[i]);
    args.push(function(err, value) {
      if (err)
        promiseReject(err);
      else
        promiseResolve(value);
    });
    try {
      original.apply(this, args);
    } catch (err) {
      promiseReject(err);
    }
    return promise;
  }
  if (Object.setPrototypeOf(fn, Object.getPrototypeOf(original)), kCustomPromisifiedSymbol)
    Object.defineProperty(fn, kCustomPromisifiedSymbol, {
      value: fn,
      enumerable: !1,
      writable: !1,
      configurable: !0
    });
  return Object.defineProperties(fn, getOwnPropertyDescriptors(original));
};
exports.promisify.custom = kCustomPromisifiedSymbol;
exports.callbackify = callbackify;
var TextDecoder = exports.TextDecoder = globalThis.TextDecoder, TextEncoder = exports.TextEncoder = globalThis.TextEncoder;
exports[Symbol.for("CommonJS")] = 0;
var util_default = exports;
export {
  promisify,
  log,
  isUndefined,
  isSymbol,
  isString,
  isRegExp,
  isPrimitive,
  isObject,
  isNumber,
  isNullOrUndefined,
  isNull,
  isFunction,
  isError,
  isDeepStrictEqual,
  isDate,
  isBuffer,
  isBoolean,
  isArray,
  inspect,
  inherits,
  format,
  deprecate,
  util_default as default,
  debuglog,
  callbackify,
  TextEncoder,
  TextDecoder
};
