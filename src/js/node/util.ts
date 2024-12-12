// Hardcoded module "node:util"
const types = require("node:util/types");
/** @type {import('node-inspect-extracted')} */
const utl = require("internal/util/inspect");
const { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } = require("internal/errors");
const { promisify } = require("internal/promisify");
const { validateString, validateBoolean, validateOneOf } = require("internal/validators");

const internalErrorName = $newZigFunction("node_util_binding.zig", "internalErrorName", 1);

const NumberIsSafeInteger = Number.isSafeInteger;

var cjs_exports;

function isBuffer(value) {
  return Buffer.isBuffer(value);
}
function isFunction(value) {
  return typeof value === "function";
}

const deepEquals = Bun.deepEquals;
const isDeepStrictEqual = (a, b) => deepEquals(a, b, true);
var getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;

const parseArgs = $newZigFunction("parse_args.zig", "parseArgs", 1);

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
  if (ctor === undefined || ctor === null) {
    throw ERR_INVALID_ARG_TYPE("ctor", "function", ctor);
  }

  if (superCtor === undefined || superCtor === null) {
    throw ERR_INVALID_ARG_TYPE("superCtor", "function", superCtor);
  }

  if (superCtor.prototype === undefined) {
    throw ERR_INVALID_ARG_TYPE("superCtor.prototype", "object", superCtor.prototype);
  }
  Object.defineProperty(ctor, "super_", {
    // @ts-expect-error
    __proto__: null,
    value: superCtor,
    writable: true,
    configurable: true,
  });
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
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

/**
 * @param {string | string[]} format
 * @param {string} text
 * @param {object} [options={}]
 * @param {boolean} [options.validateStream=true] - Whether to validate the stream.
 * @param {Stream} [options.stream=process.stdout] - The stream used for validation.
 * @returns {string}
 */
function styleText(format, text, { validateStream = true, stream = process.stdout } = {}) {
  validateString(text, "text");
  validateBoolean(validateStream, "options.validateStream");

  if (validateStream) {
    if (!$isReadableStream(stream) && !$isWritableStream(stream) && !isNodeStream(stream)) {
      throw $ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
    }
  }

  if (Array.isArray(format)) {
    let left = "";
    let right = "";
    for (const key of format) {
      const formatCodes = inspect.colors[key];
      if (formatCodes == null) {
        validateOneOf(key, "format", Object.keys(inspect.colors));
      }
      left += `\x1b[${formatCodes[0]}m`;
      right = `\x1b[${formatCodes[1]}m${right}`;
    }

    return `${left}${text}${right}`;
  }

  const formatCodes = inspect.colors[format];
  if (formatCodes == null) {
    validateOneOf(format, "format", Object.keys(inspect.colors));
  }

  // Check colorize only after validating arg type and value
  if (validateStream && (!stream || !shouldColorize(stream))) {
    return text;
  }

  return `\x1b[${formatCodes[0]}m${text}\x1b[${formatCodes[1]}m`;
}

function isNodeStream(obj) {
  return (
    obj &&
    (obj._readableState ||
      obj._writableState ||
      (typeof obj.write === "function" && typeof obj.on === "function") ||
      (typeof obj.pipe === "function" && typeof obj.on === "function"))
  );
}

function shouldColorize(stream) {
  if (process.env[["FORCE_", "COLOR"].join("")] !== undefined) {
    return typeof process.stdout.getColorDepth === "function" ? process.stdout.getColorDepth() > 2 : true;
  }
  return stream?.isTTY && (typeof stream.getColorDepth === "function" ? stream.getColorDepth() > 2 : true);
}

function getSystemErrorName(err: any) {
  if (typeof err !== "number") throw ERR_INVALID_ARG_TYPE("err", "number", err);
  if (err >= 0 || !NumberIsSafeInteger(err)) throw ERR_OUT_OF_RANGE("err", "a negative integer", err);
  return internalErrorName(err);
}

let lazyAbortedRegistry: FinalizationRegistry<{
  ref: WeakRef<AbortSignal>;
  unregisterToken: (...args: any[]) => void;
}>;
function onAbortedCallback(resolveFn: Function) {
  lazyAbortedRegistry.unregister(resolveFn);

  resolveFn();
}

function aborted(signal: AbortSignal, resource: object) {
  if (!$isObject(signal) || !(signal instanceof AbortSignal)) {
    throw ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
  }

  if (!$isObject(resource)) {
    throw ERR_INVALID_ARG_TYPE("resource", "object", resource);
  }

  if (signal.aborted) {
    return Promise.resolve();
  }

  const { promise, resolve } = $newPromiseCapability(Promise);
  const unregisterToken = onAbortedCallback.bind(undefined, resolve);
  signal.addEventListener(
    "abort",
    // Do not leak the current scope into the listener.
    // Instead, create a new function.
    unregisterToken,
    { once: true },
  );

  if (!lazyAbortedRegistry) {
    lazyAbortedRegistry = new FinalizationRegistry(({ ref, unregisterToken }) => {
      const signal = ref.deref();
      if (signal) signal.removeEventListener("abort", unregisterToken);
    });
  }

  // When the resource is garbage collected, clear the listener from the
  // AbortSignal so we do not cause the AbortSignal itself to leak (AbortSignal
  // keeps alive until it is signaled).
  lazyAbortedRegistry.register(
    resource,
    {
      ref: new WeakRef(signal),
      unregisterToken,
    },
    unregisterToken,
  );

  return promise;
}

cjs_exports = {
  format,
  formatWithOptions,
  stripVTControlCharacters,
  deprecate,
  debug: debuglog,
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
  getSystemErrorName,
  aborted,
};

export default cjs_exports;
