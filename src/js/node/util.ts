// Hardcoded module "node:util"
const types = require("node:util/types");
/** @type {import('node-inspect-extracted')} */
const utl = require("internal/util/inspect");
const { promisify } = require("internal/promisify");
const {
  validateString,
  validateOneOf,
  validateBoolean,
  validateObject,
  validateInteger,
} = require("internal/validators");
const { resistStopPropagation } = require("internal/shared");
const { MIMEType, MIMEParams } = require("internal/util/mime");
const { deprecate } = require("internal/util/deprecate");

const internalErrorName = $newRustFunction("node_util_binding.rs", "internalErrorName", 1);
const parseEnv = $newRustFunction("node_util_binding.rs", "parseEnv", 1);

const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectKeys = Object.keys;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const { uncurryThis, SafeMap } = require("internal/primordials");
const RegExpPrototypeExec = uncurryThis(RegExp.prototype.exec);

var cjs_exports;

function isBuffer(value) {
  return Buffer.isBuffer(value);
}
function isFunction(value) {
  return typeof value === "function";
}

const deepEquals = Bun.deepEquals;
function isDeepStrictEqual(a, b, skipPrototype) {
  return deepEquals(a, b, true, skipPrototype);
}

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

function debuglog(set) {
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (debugEnvRegex.test(set)) {
      var pid = process.pid;
      emitWarningIfNeeded(set);
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

const kEscape = "\u001b[";
const kEscapeEnd = "m";
const kDimCode = 2;
const kBoldCode = 1;
const kHexCloseSeq = kEscape + "39" + kEscapeEnd;
const kHexStyleCacheMax = 256;

// Matches #RGB or #RRGGBB
const hexColorRegExp = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

let styleCache;
let hexStyleCache;
let lazyStreamUtils;
let lazyUtilColors;

function getHexStyleCache() {
  hexStyleCache ??= new SafeMap();
  return hexStyleCache;
}

function getStyleCache() {
  if (styleCache === undefined) {
    styleCache = { __proto__: null };
    const colors = inspect.colors;
    for (const key of ObjectGetOwnPropertyNames(colors)) {
      const codes = colors[key];
      if (codes) {
        const openNum = codes[0];
        const closeNum = codes[1];
        styleCache[key] = {
          __proto__: null,
          openSeq: kEscape + openNum + kEscapeEnd,
          closeSeq: kEscape + closeNum + kEscapeEnd,
          keepClose: openNum === kDimCode || openNum === kBoldCode,
        };
      }
    }
  }
  return styleCache;
}

function hexToRgb(hex) {
  let hexStr;
  if (hex.length === 4) {
    hexStr = hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  } else if (hex.length === 7) {
    hexStr = hex.slice(1);
  } else {
    throw $ERR_OUT_OF_RANGE("hex", "#RGB or #RRGGBB", hex);
  }

  return Buffer.from(hexStr, "hex");
}

function getHexStyle(hex) {
  const cache = getHexStyleCache();
  const cached = cache.get(hex);
  if (cached !== undefined) return cached;
  const rgb = hexToRgb(hex);
  const style = {
    __proto__: null,
    openSeq: kEscape + `38;2;${rgb[0]};${rgb[1]};${rgb[2]}` + kEscapeEnd,
    closeSeq: kHexCloseSeq,
  };
  if (cache.size >= kHexStyleCacheMax) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(hex, style);
  return style;
}

function replaceCloseCode(str, closeSeq, openSeq, keepClose) {
  const closeLen = closeSeq.length;
  let index = str.indexOf(closeSeq);
  if (index === -1) return str;

  let result = "";
  let lastIndex = 0;
  const replacement = keepClose ? closeSeq + openSeq : openSeq;

  do {
    const afterClose = index + closeLen;
    if (afterClose < str.length) {
      result += str.slice(lastIndex, index) + replacement;
      lastIndex = afterClose;
    } else {
      break;
    }
    index = str.indexOf(closeSeq, lastIndex);
  } while (index !== -1);

  return result + str.slice(lastIndex);
}

function styleText(format, text, options) {
  const validateStream = options?.validateStream ?? true;
  const cache = getStyleCache();

  // Fast path: single format string with validateStream=false
  if (!validateStream && typeof format === "string" && typeof text === "string") {
    if (format === "none") return text;
    const style = cache[format];
    if (style !== undefined) {
      const processed = replaceCloseCode(text, style.closeSeq, style.openSeq, style.keepClose);
      return style.openSeq + processed + style.closeSeq;
    }

    if (format[0] === "#") {
      let hexStyle = getHexStyleCache().get(format);
      if (hexStyle === undefined && RegExpPrototypeExec(hexColorRegExp, format) !== null) {
        hexStyle = getHexStyle(format);
      }
      if (hexStyle !== undefined) {
        const processed = replaceCloseCode(text, hexStyle.closeSeq, hexStyle.openSeq, false);
        return hexStyle.openSeq + processed + hexStyle.closeSeq;
      }
    }
  }

  validateString(text, "text");
  if (options !== undefined) {
    validateObject(options, "options");
  }
  validateBoolean(validateStream, "options.validateStream");

  let skipColorize;
  if (validateStream) {
    const stream = options?.stream ?? process.stdout;
    lazyStreamUtils ??= require("internal/streams/utils");
    const { isNodeStream, isReadableStream, isWritableStream } = lazyStreamUtils;
    if (!isReadableStream(stream) && !isWritableStream(stream) && !isNodeStream(stream)) {
      throw $ERR_INVALID_ARG_TYPE("stream", ["ReadableStream", "WritableStream", "Stream"], stream);
    }
    lazyUtilColors ??= require("internal/util/colors");
    skipColorize = !lazyUtilColors.shouldColorize(stream);
  }

  const formatArray = $isJSArray(format) ? format : [format];

  let openCodes = "";
  let closeCodes = "";
  let processedText = text;

  for (const key of formatArray) {
    if (key === "none") continue;

    if (typeof key === "string" && key[0] === "#") {
      let hexStyle = getHexStyleCache().get(key);
      if (hexStyle === undefined) {
        if (RegExpPrototypeExec(hexColorRegExp, key) === null) {
          throw $ERR_INVALID_ARG_VALUE("format", key, "must be a valid hex color (#RGB or #RRGGBB)");
        }
        if (skipColorize) continue;
        hexStyle = getHexStyle(key);
      } else if (skipColorize) {
        continue;
      }
      openCodes += hexStyle.openSeq;
      closeCodes = hexStyle.closeSeq + closeCodes;
      processedText = replaceCloseCode(processedText, hexStyle.closeSeq, hexStyle.openSeq, false);
      continue;
    }

    const style = cache[key];
    if (style === undefined) {
      validateOneOf(key, "format", ObjectGetOwnPropertyNames(inspect.colors));
    }
    openCodes += style.openSeq;
    closeCodes = style.closeSeq + closeCodes;
    processedText = replaceCloseCode(processedText, style.closeSeq, style.openSeq, style.keepClose);
  }

  if (skipColorize) return text;

  return `${openCodes}${processedText}${closeCodes}`;
}

function getSystemErrorName(err: any) {
  if (typeof err !== "number") throw $ERR_INVALID_ARG_TYPE("err", "number", err);
  if (err >= 0 || !NumberIsSafeInteger(err)) throw $ERR_OUT_OF_RANGE("err", "a negative integer", err);
  return internalErrorName(err);
}

function prepareCallSites(_err, callSites) {
  const result = [];
  for (let i = 0; i < callSites.length; i++) {
    const callSite = callSites[i];
    // CallSite#getColumnNumber() is 0-based here but 1-based in V8, and node
    // exposes the column under both names.
    const columnNumber = (callSite.getColumnNumber() ?? 0) + 1;
    result.push({
      functionName: callSite.getFunctionName() ?? "",
      scriptId: `${callSite.getScriptId()}`,
      scriptName: callSite.getFileName() ?? "",
      lineNumber: callSite.getLineNumber() ?? 0,
      columnNumber,
      column: columnNumber,
    });
  }
  return result;
}

function validateSourceMapOption(options) {
  const { sourceMap } = options;
  if (sourceMap !== undefined) {
    validateBoolean(sourceMap, "options.sourceMap");
  }
}

function getCallSites(frameCount = 10, options) {
  // If options is not provided check if frameCount is an object
  if (options === undefined) {
    if (typeof frameCount === "object" && frameCount !== null) {
      // If frameCount is an object, it is the options object
      options = frameCount;
      validateObject(options, "options");
      validateSourceMapOption(options);
      frameCount = 10;
    } else {
      options = {};
    }
  } else {
    validateObject(options, "options");
    validateSourceMapOption(options);
  }

  // Using kDefaultMaxCallStackSizeToCapture as reference
  validateInteger(frameCount, "frameCount", 1, 200);

  // Capture with our own prepareStackTrace so a user-installed
  // Error.prepareStackTrace is never invoked, and so Error.stackTraceLimit
  // does not influence the number of frames returned.
  const target = {};
  const savedPrepareStackTrace = Error.prepareStackTrace;
  const savedStackTraceLimit = Error.stackTraceLimit;
  try {
    Error.prepareStackTrace = prepareCallSites;
    // User code may have made stackTraceLimit non-writable; best-effort so the
    // capture still runs and prepareStackTrace is always restored.
    try {
      Error.stackTraceLimit = frameCount;
    } catch {}
    Error.captureStackTrace(target, getCallSites);
    return target.stack;
  } finally {
    Error.prepareStackTrace = savedPrepareStackTrace;
    try {
      Error.stackTraceLimit = savedStackTraceLimit;
    } catch {}
  }
}

let lazySignals;
function getSignals() {
  lazySignals ??= require("node:os").constants.signals;
  return lazySignals;
}

function convertProcessSignalToExitCode(signalCode) {
  const signals = getSignals();
  validateOneOf(signalCode, "signalCode", ObjectKeys(signals));

  // POSIX standard: exit code for signal termination is 128 + signal number.
  return 128 + signals[signalCode];
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
    resistStopPropagation({ __proto__: null, once: true }),
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
  convertProcessSignalToExitCode,
  debug: debuglog,
  debuglog,
  deprecate,
  format,
  styleText,
  formatWithOptions,
  getCallSites,
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
