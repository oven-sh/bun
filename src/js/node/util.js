// Hardcoded module "node:util"
const types = require("node:util/types");
/** @type {import('node-inspect-extracted')} */
const utl = require("internal/util/inspect");

var cjs_exports = {};

function isBuffer(value) {
  return Buffer.isBuffer(value);
}
function isFunction(value) {
  return typeof value === "function";
}

const deepEquals = Bun.deepEquals;
const isDeepStrictEqual = (a, b) => deepEquals(a, b, true);
var getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;

const { parseArgs } = $lazy("util");

const inspect = utl.inspect;
const formatWithOptions = utl.formatWithOptions;
const format = utl.format;
const stripVTControlCharacters = utl.stripVTControlCharacters;

function deprecate(fn, msg, code) {
  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        var err = new Error(msg);
        if (code) err.code = code;
        throw err;
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.$apply(this, arguments);
  }
  return deprecated;
}

var debugs = {};
var debugEnvRegex = /^$/;
if (process.env.NODE_DEBUG) {
  debugEnv = process.env.NODE_DEBUG;
  debugEnv = debugEnv
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/,/g, "$|^")
    .toUpperCase();
  debugEnvRegex = new RegExp("^" + debugEnv + "$", "i");
}
var debugEnv;
function debuglog(set) {
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (debugEnvRegex.test(set)) {
      var pid = process.pid;
      debugs[set] = function () {
        var msg = format.$apply(cjs_exports, arguments);
        console.error("%s %d: %s", set, pid, msg);
      };
    } else {
      debugs[set] = function () {};
    }
  }
  return debugs[set];
}

function isBoolean(arg) {
  return typeof arg === "boolean";
}

function isNull(arg) {
  return arg === null;
}

function isNullOrUndefined(arg) {
  return arg == null;
}

function isNumber(arg) {
  return typeof arg === "number";
}

function isString(arg) {
  return typeof arg === "string";
}

function isSymbol(arg) {
  return typeof arg === "symbol";
}
function isUndefined(arg) {
  return arg === void 0;
}
var isRegExp = types.isRegExp;
function isObject(arg) {
  return typeof arg === "object" && arg !== null;
}
var isDate = types.isDate;
var isError = types.isNativeError;
function isPrimitive(arg) {
  return (
    arg === null ||
    typeof arg === "boolean" ||
    typeof arg === "number" ||
    typeof arg === "string" ||
    typeof arg === "symbol" ||
    typeof arg === "undefined"
  );
}
function pad(n) {
  return n < 10 ? "0" + n.toString(10) : n.toString(10);
}
var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(":");
  return [d.getDate(), months[d.getMonth()], time].join(" ");
}
var log = function log() {
  console.log("%s - %s", timestamp(), format.$apply(cjs_exports, arguments));
};
var inherits = function inherits(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object.create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true,
    },
  });
};
var _extend = function (origin, add) {
  if (!add || !isObject(add)) return origin;
  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};
var kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");
var promisify = function promisify(original) {
  if (typeof original !== "function") throw new TypeError('The "original" argument must be of type Function');
  if (kCustomPromisifiedSymbol && original[kCustomPromisifiedSymbol]) {
    var fn = original[kCustomPromisifiedSymbol];
    if (typeof fn !== "function") {
      throw new TypeError('The "util.promisify.custom" argument must be of type Function');
    }
    Object.defineProperty(fn, kCustomPromisifiedSymbol, {
      value: fn,
      enumerable: false,
      writable: false,
      configurable: true,
    });
    return fn;
  }
  function fn() {
    var promiseResolve, promiseReject;
    var promise = new Promise(function (resolve, reject) {
      promiseResolve = resolve;
      promiseReject = reject;
    });
    var args = [];
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    args.push(function (err, value) {
      if (err) {
        promiseReject(err);
      } else {
        promiseResolve(value);
      }
    });
    try {
      original.$apply(this, args);
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
  return Object.defineProperties(fn, getOwnPropertyDescriptors(original));
};
promisify.custom = kCustomPromisifiedSymbol;
function callbackifyOnRejected(reason, cb) {
  if (!reason) {
    var newReason = new Error("Promise was rejected with a falsy value");
    newReason.reason = reason;
    newReason.code = "ERR_FALSY_VALUE_REJECTION";
    reason = newReason;
  }
  return cb(reason);
}
function callbackify(original) {
  if (typeof original !== "function") {
    throw new TypeError('The "original" argument must be of type Function');
  }
  function callbackified() {
    var args = Array.prototype.slice.$call(arguments);
    var maybeCb = args.pop();
    if (typeof maybeCb !== "function") {
      throw new TypeError("The last argument must be of type Function");
    }
    var self = this;
    var cb = function () {
      return maybeCb.$apply(self, arguments);
    };
    original.$apply(this, args).then(
      function (ret) {
        process.nextTick(cb, null, ret);
      },
      function (rej) {
        process.nextTick(callbackifyOnRejected, rej, cb);
      },
    );
  }
  Object.setPrototypeOf(callbackified, Object.getPrototypeOf(original));
  Object.defineProperties(callbackified, getOwnPropertyDescriptors(original));
  return callbackified;
}
var toUSVString = input => {
  return (input + "").toWellFormed();
};

function styleText(format, text) {
  if (typeof text !== "string") {
    const e = new Error(`The text argument must be of type string. Received type ${typeof text}`);
    e.code = "ERR_INVALID_ARG_TYPE";
    throw e;
  }
  const formatCodes = inspect.colors[format];
  if (formatCodes == null) {
    const e = new Error(
      `The value "${typeof format === "symbol" ? format.description : format}" is invalid for argument 'format'. Reason: must be one of: ${Object.keys(inspect.colors).join(", ")}`,
    );
    e.code = "ERR_INVALID_ARG_VALUE";
    throw e;
  }
  return `\u001b[${formatCodes[0]}m${text}\u001b[${formatCodes[1]}m`;
}

export default Object.assign(cjs_exports, {
  format,
  formatWithOptions,
  stripVTControlCharacters,
  deprecate,
  debuglog,
  _extend,
  inspect,
  types,
  isArray: $isArray,
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
  isFunction,
  isError,
  isPrimitive,
  isBuffer,
  log,
  inherits,
  toUSVString,
  promisify,
  callbackify,
  isDeepStrictEqual,
  TextDecoder,
  TextEncoder,
  parseArgs,
  styleText,
});
