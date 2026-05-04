const { SafeArrayIterator, SafeMap } = require("internal/primordials");

const ArrayIsArray = Array.isArray;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeUnshift = Array.prototype.unshift;
const ArrayPrototypeJoin = Array.prototype.join;
const ArrayPrototypeSlice = Array.prototype.slice;
const ArrayPrototypeIncludes = Array.prototype.includes;
const ArrayPrototypeForEach = Array.prototype.forEach;
const ObjectDefineProperty = Object.defineProperty;
const ObjectDefineProperties = Object.defineProperties;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectIsExtensible = Object.isExtensible;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ObjectAssign = Object.assign;
const ObjectKeys = Object.keys;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeIndexOf = String.prototype.indexOf;
const RegExpPrototypeExec = RegExp.prototype.exec;
const MapPrototypeGet = Map.prototype.get;
const JSONStringify = JSON.stringify;
const ErrorCaptureStackTrace = Error.captureStackTrace;
const SymbolFor = Symbol.for;

const kIsNodeError = Symbol("kIsNodeError");

const messages = new SafeMap();
const codes = {};

let util;
let internalUtilInspect;
function lazyInternalUtilInspect() {
  internalUtilInspect ??= require("internal/util/inspect");
  return internalUtilInspect;
}

let buffer;
function lazyBuffer() {
  buffer ??= require("node:buffer").Buffer;
  return buffer;
}

let uvBinding;
function lazyUv() {
  uvBinding ??= process.binding("uv");
  return uvBinding;
}

function assert(value, message) {
  if (!value) {
    throw $ERR_INTERNAL_ASSERTION(message);
  }
}

function isErrorStackTraceLimitWritable() {
  const desc = ObjectGetOwnPropertyDescriptor(Error, "stackTraceLimit");
  if (desc === undefined) {
    return ObjectIsExtensible(Error);
  }
  return ObjectPrototypeHasOwnProperty.$call(desc, "writable") ? desc.writable : desc.set !== undefined;
}

function aggregateTwoErrors(innerError, outerError) {
  if (innerError && outerError && innerError !== outerError) {
    if (ArrayIsArray(outerError.errors)) {
      // If `outerError` is already an `AggregateError`.
      ArrayPrototypePush.$call(outerError.errors, innerError);
      return outerError;
    }
    let err;
    if (isErrorStackTraceLimitWritable()) {
      const limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 0;
      err = new AggregateError(new SafeArrayIterator([outerError, innerError]), outerError.message);
      Error.stackTraceLimit = limit;
      ErrorCaptureStackTrace(err, aggregateTwoErrors);
    } else {
      err = new AggregateError(new SafeArrayIterator([outerError, innerError]), outerError.message);
    }
    err.code = outerError.code;
    return err;
  }
  return innerError || outerError;
}

// A specialized Error that includes an additional info property with
// additional information about the error condition.
class SystemError extends Error {
  constructor(key, context) {
    super();
    const prefix = getMessage(key, [], this);
    let message = `${prefix}: ${context.syscall} returned ` + `${context.code} (${context.message})`;

    if (context.path !== undefined) message += ` ${context.path}`;
    if (context.dest !== undefined) message += ` => ${context.dest}`;

    this.code = key;

    ObjectDefineProperties(this, {
      [kIsNodeError]: {
        __proto__: null,
        value: true,
        enumerable: false,
        writable: false,
        configurable: true,
      },
      name: {
        __proto__: null,
        value: "SystemError",
        enumerable: false,
        writable: true,
        configurable: true,
      },
      message: {
        __proto__: null,
        value: message,
        enumerable: false,
        writable: true,
        configurable: true,
      },
      info: {
        __proto__: null,
        value: context,
        enumerable: true,
        configurable: true,
        writable: false,
      },
      errno: {
        __proto__: null,
        get() {
          return context.errno;
        },
        set: value => {
          context.errno = value;
        },
        enumerable: true,
        configurable: true,
      },
      syscall: {
        __proto__: null,
        get() {
          return context.syscall;
        },
        set: value => {
          context.syscall = value;
        },
        enumerable: true,
        configurable: true,
      },
    });

    if (context.path !== undefined) {
      ObjectDefineProperty(this, "path", {
        __proto__: null,
        get() {
          return context.path != null ? context.path.toString() : context.path;
        },
        set: value => {
          context.path = value ? lazyBuffer().from(value.toString()) : undefined;
        },
        enumerable: true,
        configurable: true,
      });
    }

    if (context.dest !== undefined) {
      ObjectDefineProperty(this, "dest", {
        __proto__: null,
        get() {
          return context.dest != null ? context.dest.toString() : context.dest;
        },
        set: value => {
          context.dest = value ? lazyBuffer().from(value.toString()) : undefined;
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  toString() {
    return `${this.name} [${this.code}]: ${this.message}`;
  }

  [SymbolFor("nodejs.util.inspect.custom")](recurseTimes, ctx) {
    return lazyInternalUtilInspect().inspect(this, {
      ...ctx,
      getters: true,
      customInspect: false,
    });
  }
}

function captureLargerStackTrace(err) {
  const stackTraceLimitIsWritable = isErrorStackTraceLimitWritable();
  let userStackTraceLimit;
  if (stackTraceLimitIsWritable) {
    userStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = Infinity;
  }
  ErrorCaptureStackTrace(err);
  if (stackTraceLimitIsWritable) Error.stackTraceLimit = userStackTraceLimit;
  return err;
}

function makeSystemErrorWithCode(key) {
  return class NodeError extends SystemError {
    constructor(ctx) {
      super(key, ctx);
    }
  };
}

// This is a special error type that is only used for the E function.
class HideStackFramesError extends Error {}

function makeNodeErrorForHideStackFrame(Base, clazz) {
  class HideStackFramesError extends Base {
    constructor(...args) {
      if (isErrorStackTraceLimitWritable()) {
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 0;
        super(...args);
        Error.stackTraceLimit = limit;
      } else {
        super(...args);
      }
    }

    get ["constructor"]() {
      return clazz;
    }
  }

  return HideStackFramesError;
}

function makeNodeErrorWithCode(Base, key) {
  const msg = messages.get(key);
  const expectedLength = typeof msg !== "string" ? -1 : getExpectedArgumentLength(msg);

  switch (expectedLength) {
    case 0: {
      class NodeError extends Base {
        code = key;

        constructor(...args) {
          assert(
            args.length === 0,
            `Code: ${key}; The provided arguments length (${args.length}) does not ` +
              `match the required ones (${expectedLength}).`,
          );
          super(msg);
        }

        get ["constructor"]() {
          return Base;
        }

        get [kIsNodeError]() {
          return true;
        }

        toString() {
          return `${this.name} [${key}]: ${this.message}`;
        }
      }
      return NodeError;
    }
    case -1: {
      class NodeError extends Base {
        code = key;

        constructor(...args) {
          super();
          ObjectDefineProperty(this, "message", {
            __proto__: null,
            value: getMessage(key, args, this),
            enumerable: false,
            writable: true,
            configurable: true,
          });
        }

        get ["constructor"]() {
          return Base;
        }

        get [kIsNodeError]() {
          return true;
        }

        toString() {
          return `${this.name} [${key}]: ${this.message}`;
        }
      }
      return NodeError;
    }
    default: {
      class NodeError extends Base {
        code = key;

        constructor(...args) {
          assert(
            args.length === expectedLength,
            `Code: ${key}; The provided arguments length (${args.length}) does not ` +
              `match the required ones (${expectedLength}).`,
          );

          ArrayPrototypeUnshift.$call(args, msg);
          super(lazyInternalUtilInspect().format.$apply(null, args));
        }

        get ["constructor"]() {
          return Base;
        }

        get [kIsNodeError]() {
          return true;
        }

        toString() {
          return `${this.name} [${key}]: ${this.message}`;
        }
      }
      return NodeError;
    }
  }
}

/**
 * This function removes unnecessary frames from Node.js core errors.
 */
function hideStackFrames(fn) {
  function wrappedFn(...args) {
    try {
      return fn.$apply(this, args);
    } catch (error) {
      if (Error.stackTraceLimit) ErrorCaptureStackTrace(error, wrappedFn);
      throw error;
    }
  }
  wrappedFn.withoutStackTrace = fn;
  return wrappedFn;
}

// Utility function for registering the error codes. Exported *only* to allow
// for testing.
function E(sym, val, def, ...otherClasses) {
  messages.set(sym, val);

  const ErrClass = def === SystemError ? makeSystemErrorWithCode(sym) : makeNodeErrorWithCode(def, sym);

  if (otherClasses.length !== 0) {
    if (ArrayPrototypeIncludes.$call(otherClasses, HideStackFramesError)) {
      if (otherClasses.length !== 1) {
        ArrayPrototypeForEach.$call(otherClasses, clazz => {
          if (clazz !== HideStackFramesError) {
            ErrClass[clazz.name] = makeNodeErrorWithCode(clazz, sym);
            ErrClass[clazz.name].HideStackFramesError = makeNodeErrorForHideStackFrame(ErrClass[clazz.name], clazz);
          }
        });
      }
    } else {
      ArrayPrototypeForEach.$call(otherClasses, clazz => {
        ErrClass[clazz.name] = makeNodeErrorWithCode(clazz, sym);
      });
    }
  }

  if (ArrayPrototypeIncludes.$call(otherClasses, HideStackFramesError)) {
    ErrClass.HideStackFramesError = makeNodeErrorForHideStackFrame(ErrClass, def);
  }

  codes[sym] = ErrClass;
}

function getExpectedArgumentLength(msg) {
  let expectedLength = 0;
  const regex = /%[dfijoOs]/g;
  while (RegExpPrototypeExec.$call(regex, msg) !== null) expectedLength++;
  return expectedLength;
}

function getMessage(key, args, self) {
  const msg = messages.get(key);

  if (typeof msg === "function") {
    assert(
      msg.length <= args.length,
      `Code: ${key}; The provided arguments length (${args.length}) does not ` +
        `match the required ones (${msg.length}).`,
    );
    return msg.$apply(self, args);
  }

  const expectedLength = getExpectedArgumentLength(msg);
  assert(
    expectedLength === args.length,
    `Code: ${key}; The provided arguments length (${args.length}) does not ` +
      `match the required ones (${expectedLength}).`,
  );
  if (args.length === 0) return msg;

  ArrayPrototypeUnshift.$call(args, msg);
  return lazyInternalUtilInspect().format.$apply(null, args);
}

const uvUnmappedError = ["UNKNOWN", "unknown error"];

function uvErrmapGet(name) {
  const binding = lazyUv();
  binding.errmap ??= binding.getErrorMap();
  return MapPrototypeGet.$call(binding.errmap, name);
}

/**
 * This creates an error compatible with errors produced in UVException.
 */
class UVException extends Error {
  constructor(ctx) {
    const [code, uvmsg] = uvErrmapGet(ctx.errno) || uvUnmappedError;
    let message = `${code}: ${ctx.message || uvmsg}, ${ctx.syscall}`;

    let path;
    let dest;
    if (ctx.path) {
      path = ctx.path.toString();
      message += ` '${path}'`;
    }
    if (ctx.dest) {
      dest = ctx.dest.toString();
      message += ` -> '${dest}'`;
    }

    super(message);

    for (const prop of ObjectKeys(ctx)) {
      if (prop === "message" || prop === "path" || prop === "dest") {
        continue;
      }
      this[prop] = ctx[prop];
    }

    this.code = code;
    if (path) this.path = path;
    if (dest) this.dest = dest;
  }

  get ["constructor"]() {
    return Error;
  }
}

class UVExceptionWithHostPort extends Error {
  constructor(err, syscall, address, port) {
    const [code, uvmsg] = uvErrmapGet(err) || uvUnmappedError;
    const message = `${syscall} ${code}: ${uvmsg}`;
    let details = "";

    if (port && port > 0) {
      details = ` ${address}:${port}`;
    } else if (address) {
      details = ` ${address}`;
    }

    super(`${message}${details}`);

    this.code = code;
    this.errno = err;
    this.syscall = syscall;
    this.address = address;
    if (port) {
      this.port = port;
    }
  }

  get ["constructor"]() {
    return Error;
  }
}

class DNSException extends Error {
  constructor(code, syscall, hostname) {
    let errno;
    // If `code` is of type number, it is a libuv error number, else it is a
    // c-ares error code.
    if (typeof code === "number") {
      errno = code;
      const uv = lazyUv();
      if (code === uv.UV_EAI_NODATA || code === uv.UV_EAI_NONAME) {
        code = "ENOTFOUND"; // Fabricated error name.
      } else {
        util ??= require("node:util");
        code = util.getSystemErrorName(code);
      }
    }
    super(`${syscall} ${code}${hostname ? ` ${hostname}` : ""}`);
    this.errno = errno;
    this.code = code;
    this.syscall = syscall;
    if (hostname) {
      this.hostname = hostname;
    }
  }

  get ["constructor"]() {
    return Error;
  }
}

class AbortError extends Error {
  constructor(message = "The operation was aborted", options = undefined) {
    if (options !== undefined && typeof options !== "object") {
      throw $ERR_INVALID_ARG_TYPE("options", "Object", options);
    }
    super(message, options);
    this.code = "ABORT_ERR";
    this.name = "AbortError";
  }
}

const genericNodeError = hideStackFrames(function genericNodeError(message, errorProperties) {
  const err = new Error(message);
  ObjectAssign(err, errorProperties);
  return err;
});

function determineSpecificType(value) {
  if (value === null) {
    return "null";
  } else if (value === undefined) {
    return "undefined";
  }

  const type = typeof value;

  switch (type) {
    case "bigint":
      return `type bigint (${value}n)`;
    case "number":
      if (value === 0) {
        return 1 / value === -Infinity ? "type number (-0)" : "type number (0)";
      } else if (value !== value) {
        return "type number (NaN)";
      } else if (value === Infinity) {
        return "type number (Infinity)";
      } else if (value === -Infinity) {
        return "type number (-Infinity)";
      }
      return `type number (${value})`;
    case "boolean":
      return value ? "type boolean (true)" : "type boolean (false)";
    case "symbol":
      return `type symbol (${String(value)})`;
    case "function":
      return `function ${value.name}`;
    case "object":
      if (value.constructor && "name" in value.constructor) {
        return `an instance of ${value.constructor.name}`;
      }
      return `${lazyInternalUtilInspect().inspect(value, { depth: -1 })}`;
    case "string":
      if (value.length > 28) value = `${StringPrototypeSlice.$call(value, 0, 25)}...`;
      if (StringPrototypeIndexOf.$call(value, "'") === -1) {
        return `type string ('${value}')`;
      }
      return `type string (${JSONStringify(value)})`;
    default:
      value = lazyInternalUtilInspect().inspect(value, { colors: false });
      if (value.length > 28) {
        value = `${StringPrototypeSlice.$call(value, 0, 25)}...`;
      }
      return `type ${type} (${value})`;
  }
}

/**
 * Create a list string in the form like 'A and B' or 'A, B, ..., and Z'.
 */
function formatList(array, type = "and") {
  switch (array.length) {
    case 0:
      return "";
    case 1:
      return `${array[0]}`;
    case 2:
      return `${array[0]} ${type} ${array[1]}`;
    case 3:
      return `${array[0]}, ${array[1]}, ${type} ${array[2]}`;
    default:
      return `${ArrayPrototypeJoin.$call(ArrayPrototypeSlice.$call(array, 0, -1), ", ")}, ${type} ${array[array.length - 1]}`;
  }
}

const classRegExp = /^([A-Z][a-z0-9]*)+$/;
const kTypes = ["string", "function", "number", "object", "Function", "Object", "boolean", "bigint", "symbol"];

// Register the error codes --expose-internals tests rely on. Keep this list
// minimal: this module is required by internal/streams/{destroy,pipeline,readable}
// and so evaluates on first node:stream load in every process, not only under
// the testing flag.
E(
  "ERR_ACCESS_DENIED",
  function (msg, permission = "", resource = "") {
    this.permission = permission;
    this.resource = resource;
    return msg;
  },
  Error,
  HideStackFramesError,
);
E(
  "ERR_INVALID_ARG_TYPE",
  (name, expected, actual) => {
    assert(typeof name === "string", "'name' must be a string");
    if (!ArrayIsArray(expected)) {
      expected = [expected];
    }

    let msg = "The ";
    if (name.endsWith(" argument")) {
      msg += `${name} `;
    } else {
      const type = name.includes(".") ? "property" : "argument";
      msg += `"${name}" ${type} `;
    }
    msg += "must be ";

    const types = [];
    const instances = [];
    const other = [];

    for (const value of expected) {
      assert(typeof value === "string", "All expected entries have to be of type string");
      if (ArrayPrototypeIncludes.$call(kTypes, value)) {
        types.push(value.toLowerCase());
      } else if (RegExpPrototypeExec.$call(classRegExp, value) !== null) {
        instances.push(value);
      } else {
        assert(value !== "object", 'The value "object" should be written as "Object"');
        other.push(value);
      }
    }

    if (instances.length > 0) {
      const pos = types.indexOf("object");
      if (pos !== -1) {
        types.splice(pos, 1);
        instances.push("Object");
      }
    }

    if (types.length > 0) {
      msg += `${types.length > 1 ? "one of type" : "of type"} ${formatList(types, "or")}`;
      if (instances.length > 0 || other.length > 0) msg += " or ";
    }

    if (instances.length > 0) {
      msg += `an instance of ${formatList(instances, "or")}`;
      if (other.length > 0) msg += " or ";
    }

    if (other.length > 0) {
      if (other.length > 1) {
        msg += `one of ${formatList(other, "or")}`;
      } else {
        if (other[0].toLowerCase() !== other[0]) msg += "an ";
        msg += `${other[0]}`;
      }
    }

    msg += `. Received ${determineSpecificType(actual)}`;

    return msg;
  },
  TypeError,
  HideStackFramesError,
);

let useOriginalName = false;

export default {
  AbortError,
  aggregateTwoErrors,
  captureLargerStackTrace,
  codes,
  determineSpecificType,
  DNSException,
  E,
  formatList,
  genericNodeError,
  getMessage,
  hideStackFrames,
  HideStackFramesError,
  isErrorStackTraceLimitWritable,
  kIsNodeError,
  SystemError,
  uvErrmapGet,
  UVException,
  UVExceptionWithHostPort,
  get useOriginalName() {
    return useOriginalName;
  },
  set useOriginalName(value) {
    useOriginalName = value;
  },
};
