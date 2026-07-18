// Hardcoded module "node:util"
const types = require("node:util/types");
/** @type {import('node-inspect-extracted')} */
const utl = require("internal/util/inspect");
const { promisify } = require("internal/promisify");
const { validateString, validateOneOf, validateBoolean, validateObject } = require("internal/validators");
const { MIMEType, MIMEParams } = require("internal/util/mime");
const { deprecate } = require("internal/util/deprecate");

const internalErrorName = $newRustFunction("node_util_binding.rs", "internalErrorName", 1);
const parseEnv = $newRustFunction("node_util_binding.rs", "parseEnv", 1);

const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectKeys = Object.keys;

var cjs_exports;

function isBuffer(value) {
  return Buffer.isBuffer(value);
}
function isFunction(value) {
  return typeof value === "function";
}

const deepEquals = Bun.deepEquals;
const isDeepStrictEqual = (a, b) => deepEquals(a, b, true);

const parseArgs = $newRustFunction("parse_args.rs", "parseArgs", 1);

const inspect = utl.inspect;
const formatWithOptions = utl.formatWithOptions;
const format = utl.format;
const stripVTControlCharacters = utl.stripVTControlCharacters;

var debugs = {};
var debugEnvRegex = /^$/;
const NODE_DEBUG = process.env.NODE_DEBUG;
if (NODE_DEBUG) {
  debugEnv = NODE_DEBUG;
  debugEnv = debugEnv
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/,/g, "$|^")
    .toUpperCase();
  debugEnvRegex = new RegExp("^" + debugEnv + "$", "i");
}
var debugEnv;
// Emits a warning when the user enables NODE_DEBUG=http or NODE_DEBUG=http2,
// like Node.js's internal/util/debuglog.
function emitWarningIfNeeded(set) {
  if ("HTTP" === set || "HTTP2" === set) {
    process.emitWarning(
      "Setting the NODE_DEBUG environment variable " +
        "to '" +
        set.toLowerCase() +
        "' can expose sensitive " +
        "data (such as passwords, tokens and authentication headers) " +
        "in the resulting log.",
    );
  }
}

function debuglogImpl(enabled, set) {
  if (!debugs[set]) {
    let impl;
    if (enabled) {
      const pid = process.pid;
      emitWarningIfNeeded(set);
      impl = function debug() {
        const msg = format.$apply(cjs_exports, arguments);
        console.error("%s %d: %s", set, pid, msg);
      };
    } else {
      impl = function debug() {};
    }
    Object.defineProperty(impl, "enabled", {
      __proto__: null,
      value: enabled,
      configurable: true,
      enumerable: true,
    });
    debugs[set] = impl;
  }
  return debugs[set];
}

function debuglog(set, cb) {
  set = set.toUpperCase();
  const enabled = debugEnvRegex.test(set);
  // The implementation is created eagerly so that the NODE_DEBUG=http warning
  // is emitted when node:http requires this, the way node:_http_client does.
  const impl = debuglogImpl(enabled, set);
  let notified = false;
  const logger = function debuglogWrapper() {
    if (!notified) {
      notified = true;
      if (typeof cb === "function") cb(impl);
    }
    return impl.$apply(undefined, arguments);
  };
  Object.defineProperty(logger, "enabled", {
    __proto__: null,
    get() {
      return enabled;
    },
    configurable: true,
    enumerable: true,
  });
  return logger;
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
var isError = $newCppFunction("NodeUtilTypesModule.cpp", "jsFunctionIsError", 1);
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
    throw $ERR_INVALID_ARG_TYPE("ctor", "function", ctor);
  }

  if (superCtor === undefined || superCtor === null) {
    throw $ERR_INVALID_ARG_TYPE("superCtor", "function", superCtor);
  }

  const superCtorPrototype = superCtor.prototype;
  if (superCtorPrototype === undefined) {
    throw $ERR_INVALID_ARG_TYPE("superCtor.prototype", "object", superCtorPrototype);
  }
  Object.defineProperty(ctor, "super_", {
    // @ts-ignore
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
  const { validateFunction } = require("internal/validators");
  validateFunction(original, "original");

  // We DO NOT return the promise as it gives the user a false sense that
  // the promise is actually somehow related to the callback's execution
  // and that the callback throwing will reject the promise.
  function callbackified(...args) {
    const maybeCb = Array.prototype.pop.$call(args);
    validateFunction(maybeCb, "last argument");
    const cb = Function.prototype.bind.$call(maybeCb, this);
    // In true node style we process the callback on `nextTick` with all the
    // implications (stack, `uncaughtException`, `async_hooks`)
    original.$apply(this, args).then(
      ret => process.nextTick(cb, null, ret),
      rej => process.nextTick(callbackifyOnRejected, rej, cb),
    );
  }

  const descriptors = Object.getOwnPropertyDescriptors(original);
  // It is possible to manipulate a functions `length` or `name` property. This
  // guards against the manipulation.
  if (typeof descriptors.length.value === "number") {
    descriptors.length.value++;
  }
  if (typeof descriptors.name.value === "string") {
    descriptors.name.value += "Callbackified";
  }
  const propertiesValues = Object.values(descriptors);
  for (let i = 0; i < propertiesValues.length; i++) {
    // We want to use null-prototype objects to not rely on globally mutable
    // %Object.prototype%.
    Object.setPrototypeOf(propertiesValues[i], null);
  }
  Object.defineProperties(callbackified, descriptors);
  return callbackified;
}
var toUSVString = input => {
  return (input + "").toWellFormed();
};

// internal/streams/utils pulls in the whole stream machinery and
// internal/util/colors requires node:tty, so neither loads until a caller
// actually asks styleText to look at a stream.
let lazyStreamUtils;
let lazyUtilColors;

// The options are read the way node's lib/util.js reads them today, so that
// `{ stream: null }` falls back to process.stdout rather than throwing.
function styleText(format, text, options) {
  const validateStream = options?.validateStream ?? true;

  validateString(text, "text");
  if (options !== undefined) {
    validateObject(options, "options");
  }
  validateBoolean(validateStream, "options.validateStream");

  let skipColorize;
  if (validateStream) {
    const stream = options?.stream ?? process.stdout;
    lazyStreamUtils ??= require("internal/streams/utils");
    const { isReadableStream, isWritableStream, isNodeStream } = lazyStreamUtils;
    if (!isReadableStream(stream) && !isWritableStream(stream) && !isNodeStream(stream)) {
      throw $ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
    }

    lazyUtilColors ??= require("internal/util/colors");
    skipColorize = !lazyUtilColors.shouldColorize(stream);
  }

  const formatArray = $isJSArray(format) ? format : [format];

  const codes: [number, number][] = [];
  for (const key of formatArray) {
    if (key === "none") continue;
    const formatCodes = inspect.colors[key];
    // If the format is not a valid style, throw an error.
    if (formatCodes == null) {
      validateOneOf(key, "format", ObjectKeys(inspect.colors));
    }
    if (skipColorize) continue;
    codes.push(formatCodes);
  }

  if (skipColorize) {
    return text;
  }

  let openCodes = "";
  for (let i = 0; i < codes.length; i++) {
    openCodes += `\u001b[${codes[i][0]}m`;
  }

  // Process the text to handle nested styles: reapply the style after any
  // matching reset code that is not at the very end of the string.
  let processedText = text;
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    processedText = processedText.replace(new RegExp(`\\u001b\\[${code[1]}m`, "g"), (match, offset) => {
      if (offset + match.length < processedText.length) {
        if (code[0] === inspect.colors.dim[0] || code[0] === inspect.colors.bold[0]) {
          // Dim and bold are not mutually exclusive, so reapply.
          return `${match}\u001b[${code[0]}m`;
        }
        return `\u001b[${code[0]}m`;
      }
      return match;
    });
  }

  let closeCodes = "";
  for (let i = codes.length - 1; i >= 0; i--) {
    closeCodes += `\u001b[${codes[i][1]}m`;
  }

  return `${openCodes}${processedText}${closeCodes}`;
}

function getSystemErrorName(err: any) {
  if (typeof err !== "number") throw $ERR_INVALID_ARG_TYPE("err", "number", err);
  if (err >= 0 || !NumberIsSafeInteger(err)) throw $ERR_OUT_OF_RANGE("err", "a negative integer", err);
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
    throw $ERR_INVALID_ARG_TYPE("signal", "AbortSignal", signal);
  }

  if (!$isObject(resource)) {
    throw $ERR_INVALID_ARG_TYPE("resource", "object", resource);
  }

  if (signal.aborted) {
    return Promise.$resolve();
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

function setTraceSigInt(enable) {
  // Node validates the argument before the worker check (lib/util.js), so a
  // bad type throws ERR_INVALID_ARG_TYPE even inside a worker.
  validateBoolean(enable, "enable");
  if (!Bun.isMainThread) {
    // Matches node's ERR_WORKER_UNSUPPORTED_OPERATION('Calling util.setTraceSigInt').
    throw $ERR_WORKER_UNSUPPORTED_OPERATION("Calling util.setTraceSigInt is not supported in workers");
  }
  // Node starts/stops a SIGINT watchdog that prints a stack trace when the
  // process is interrupted; bun does not implement the watchdog yet, so this
  // is accepted as a no-op on the main thread.
}

cjs_exports = {
  // This is in order of `node --print 'Object.keys(util)'`
  // _errnoException,
  // _exceptionWithHostPort,
  _extend,
  callbackify,
  debug: debuglog,
  debuglog,
  deprecate,
  format,
  styleText,
  formatWithOptions,
  // getCallSite,
  // getCallSites,
  // getSystemErrorMap,
  getSystemErrorName,
  // getSystemErrorMessage,
  inherits,
  inspect,
  isDeepStrictEqual,
  promisify,
  setTraceSigInt,
  stripVTControlCharacters,
  toUSVString,
  // transferableAbortSignal,
  // transferableAbortController,
  aborted,
  types,
  parseEnv,
  parseArgs,
  TextDecoder,
  TextEncoder,
  MIMEType,
  MIMEParams,

  // Deprecated in Node.js 22, removed in 23
  isArray: $isArray,
  isBoolean,
  isBuffer,
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
  log,
};

export default cjs_exports;
