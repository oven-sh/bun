// Hardcoded module "node:util"
const types = require("node:util/types");
/** @type {import('node-inspect-extracted')} */
const utl = require("internal/util/inspect");
const { promisify } = require("internal/promisify");
const { validateString, validateOneOf, validateBoolean } = require("internal/validators");
const { resistStopPropagation, ErrnoException } = require("internal/shared");
const { MIMEType, MIMEParams } = require("internal/util/mime");
const { deprecate } = require("internal/util/deprecate");

const internalErrorName = $newRustFunction("node_util_binding.rs", "internalErrorName", 1);
const internalErrorEntries = $newRustFunction("node_util_binding.rs", "internalErrorEntries", 0);
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

// Node semantics (includes the [[Prototype]] identity check that
// Bun.deepEquals(a, b, true) intentionally omits). Node wraps the internal
// comparator in a 2-arg forwarder in lib/util.js so the private skipPrototype
// argument never reaches the public API; mirror that (v26.3.0).
const { isDeepStrictEqual: internalIsDeepStrictEqual } = require("internal/util/comparisons");
function isDeepStrictEqual(val1, val2) {
  return internalIsDeepStrictEqual(val1, val2);
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

function styleText(format, text) {
  validateString(text, "text");

  if ($isJSArray(format)) {
    let left = "";
    let right = "";
    for (const key of format) {
      const formatCodes = inspect.colors[key];
      if (formatCodes == null) {
        validateOneOf(key, "format", ObjectKeys(inspect.colors));
      }
      left += `\u001b[${formatCodes[0]}m`;
      right = `\u001b[${formatCodes[1]}m${right}`;
    }

    return `${left}${text}${right}`;
  }

  let formatCodes = inspect.colors[format];

  if (formatCodes == null) {
    validateOneOf(format, "format", ObjectKeys(inspect.colors));
  }
  return `\u001b[${formatCodes[0]}m${text}\u001b[${formatCodes[1]}m`;
}

function getSystemErrorName(err: any) {
  if (typeof err !== "number") throw $ERR_INVALID_ARG_TYPE("err", "number", err);
  if (err >= 0 || !NumberIsSafeInteger(err)) throw $ERR_OUT_OF_RANGE("err", "a negative integer", err);
  return internalErrorName(err);
}

// libuv's uv_strerror() messages keyed by error name (target-independent).
// The per-target codes come from the native uv_e table (internalErrorEntries).
const uvErrorMessages = {
  __proto__: null,
  E2BIG: "argument list too long",
  EACCES: "permission denied",
  EADDRINUSE: "address already in use",
  EADDRNOTAVAIL: "address not available",
  EAFNOSUPPORT: "address family not supported",
  EAGAIN: "resource temporarily unavailable",
  EAI_ADDRFAMILY: "address family not supported",
  EAI_AGAIN: "temporary failure",
  EAI_BADFLAGS: "bad ai_flags value",
  EAI_BADHINTS: "invalid value for hints",
  EAI_CANCELED: "request canceled",
  EAI_FAIL: "permanent failure",
  EAI_FAMILY: "ai_family not supported",
  EAI_MEMORY: "out of memory",
  EAI_NODATA: "no address",
  EAI_NONAME: "unknown node or service",
  EAI_OVERFLOW: "argument buffer overflow",
  EAI_PROTOCOL: "resolved protocol is unknown",
  EAI_SERVICE: "service not available for socket type",
  EAI_SOCKTYPE: "socket type not supported",
  EALREADY: "connection already in progress",
  EBADF: "bad file descriptor",
  EBUSY: "resource busy or locked",
  ECANCELED: "operation canceled",
  ECHARSET: "invalid Unicode character",
  ECONNABORTED: "software caused connection abort",
  ECONNREFUSED: "connection refused",
  ECONNRESET: "connection reset by peer",
  EDESTADDRREQ: "destination address required",
  EEXIST: "file already exists",
  EFAULT: "bad address in system call argument",
  EFBIG: "file too large",
  EHOSTUNREACH: "host is unreachable",
  EINTR: "interrupted system call",
  EINVAL: "invalid argument",
  EIO: "i/o error",
  EISCONN: "socket is already connected",
  EISDIR: "illegal operation on a directory",
  ELOOP: "too many symbolic links encountered",
  EMFILE: "too many open files",
  EMSGSIZE: "message too long",
  ENAMETOOLONG: "name too long",
  ENETDOWN: "network is down",
  ENETUNREACH: "network is unreachable",
  ENFILE: "file table overflow",
  ENOBUFS: "no buffer space available",
  ENODEV: "no such device",
  ENOENT: "no such file or directory",
  ENOMEM: "not enough memory",
  ENONET: "machine is not on the network",
  ENOPROTOOPT: "protocol not available",
  ENOSPC: "no space left on device",
  ENOSYS: "function not implemented",
  ENOTCONN: "socket is not connected",
  ENOTDIR: "not a directory",
  ENOTEMPTY: "directory not empty",
  ENOTSOCK: "socket operation on non-socket",
  ENOTSUP: "operation not supported on socket",
  EOVERFLOW: "value too large for defined data type",
  EPERM: "operation not permitted",
  EPIPE: "broken pipe",
  EPROTO: "protocol error",
  EPROTONOSUPPORT: "protocol not supported",
  EPROTOTYPE: "protocol wrong type for socket",
  ERANGE: "result too large",
  EROFS: "read-only file system",
  ESHUTDOWN: "cannot send after transport endpoint shutdown",
  ESPIPE: "invalid seek",
  ESRCH: "no such process",
  ETIMEDOUT: "connection timed out",
  ETXTBSY: "text file is busy",
  EXDEV: "cross-device link not permitted",
  UNKNOWN: "unknown error",
  EOF: "end of file",
  ENXIO: "no such device or address",
  EMLINK: "too many links",
  EHOSTDOWN: "host is down",
  EREMOTEIO: "remote I/O error",
  ENOTTY: "inappropriate ioctl for device",
  EFTYPE: "inappropriate file type or format",
  EILSEQ: "illegal byte sequence",
  ESOCKTNOSUPPORT: "socket type not supported",
  ENODATA: "no data available",
  EUNATCH: "protocol driver not attached",
  ENOEXEC: "exec format error",
};

let uvErrmap: Map<number, [string, string]> | undefined;
function getUvErrmap() {
  if (uvErrmap === undefined) {
    uvErrmap = new Map();
    const flat = internalErrorEntries();
    for (let i = 0; i < flat.length; i += 2) {
      const code = flat[i];
      const name = flat[i + 1];
      if (!uvErrmap.has(code)) uvErrmap.set(code, [name, uvErrorMessages[name] ?? name]);
    }
  }
  return uvErrmap;
}

function getSystemErrorMap() {
  // Fresh Map with fresh entry arrays: node's binding materialises a new map
  // per call, and callers may mutate the [name, message] pairs.
  const copy = new Map();
  for (const [code, entry] of getUvErrmap()) {
    copy.set(code, [entry[0], entry[1]]);
  }
  return copy;
}

function getSystemErrorMessage(err: any) {
  if (typeof err !== "number") throw $ERR_INVALID_ARG_TYPE("err", "number", err);
  if (err >= 0 || !NumberIsSafeInteger(err)) throw $ERR_OUT_OF_RANGE("err", "a negative integer", err);
  const entry = getUvErrmap().get(err);
  return entry !== undefined ? entry[1] : `Unknown system error ${err}`;
}

function _errnoException(err: any, syscall: string, original?: string) {
  // ErrnoException validates err via getSystemErrorName (type + range) and
  // builds node's exact `${syscall} ${code}[ ${original}]` shape.
  return new ErrnoException(err, syscall, original);
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
  _errnoException,
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
  getSystemErrorMap,
  getSystemErrorName,
  getSystemErrorMessage,
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
