// Hardcoded module "node:stream" / "readable-stream"
// "readable-stream" npm package
// just transpiled and debug logs added.

const EE = require("node:events");
const StringDecoder = require("node:string_decoder").StringDecoder;

var __getOwnPropNames = Object.getOwnPropertyNames;

var __commonJS = (cb, mod) =>
  function __require2() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

var runOnNextTick = process.nextTick;

function isReadableStream(value) {
  return typeof value === "object" && value !== null && value instanceof ReadableStream;
}

function validateBoolean(value, name) {
  if (typeof value !== "boolean") throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
}

$debug("node:stream loaded");

function highWaterMarkFrom(options, isDuplex, duplexKey) {
  return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
}
function getDefaultHighWaterMark(objectMode) {
  return objectMode ? 16 : 16 * 1024;
}
function getHighWaterMark(state, options, duplexKey, isDuplex) {
  const hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
  if (hwm != null) {
    if (!Number.isInteger(hwm) || hwm < 0) {
      const name = isDuplex ? `options.${duplexKey}` : "options.highWaterMark";
      throw new ERR_INVALID_ARG_VALUE(name, hwm);
    }
    return Math.floor(hwm);
  }

  // Default value
  return getDefaultHighWaterMark(state.objectMode);
}

class BufferList {
  constructor() {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }
  push(v) {
    const entry = {
      data: v,
      next: null,
    };
    if (this.length > 0) this.tail.next = entry;
    else this.head = entry;
    this.tail = entry;
    ++this.length;
  }
  unshift(v) {
    const entry = {
      data: v,
      next: this.head,
    };
    if (this.length === 0) this.tail = entry;
    this.head = entry;
    ++this.length;
  }
  shift() {
    if (this.length === 0) return;
    const ret = this.head.data;
    if (this.length === 1) this.head = this.tail = null;
    else this.head = this.head.next;
    --this.length;
    return ret;
  }
  clear() {
    this.head = this.tail = null;
    this.length = 0;
  }
  join(s) {
    if (this.length === 0) return "";
    let p = this.head;
    let ret = "" + p.data;
    while ((p = p.next) !== null) ret += s + p.data;
    return ret;
  }
  concat(n) {
    if (this.length === 0) return Buffer.alloc(0);
    const ret = Buffer.allocUnsafe(n >>> 0);
    let p = this.head;
    let i = 0;
    while (p) {
      ret.set(p.data, i);
      i += p.data.length;
      p = p.next;
    }
    return ret;
  }

  // Consumes a specified amount of bytes or characters from the buffered data.
  consume(n, hasStrings) {
    const data = this.head.data;
    if (n < data.length) {
      // `slice` is the same for buffers and strings.
      const slice = data.slice(0, n);
      this.head.data = data.slice(n);
      return slice;
    }
    if (n === data.length) {
      // First chunk is a perfect match.
      return this.shift();
    }
    // Result spans more than one buffer.
    return hasStrings ? this._getString(n) : this._getBuffer(n);
  }
  first() {
    return this.head.data;
  }
  *[Symbol.iterator]() {
    for (let p = this.head; p; p = p.next) {
      yield p.data;
    }
  }

  // Consumes a specified amount of characters from the buffered data.
  _getString(n) {
    let ret = "";
    let p = this.head;
    let c = 0;
    do {
      const str = p.data;
      if (n > str.length) {
        ret += str;
        n -= str.length;
      } else {
        if (n === str.length) {
          ret += str;
          ++c;
          if (p.next) this.head = p.next;
          else this.head = this.tail = null;
        } else {
          ret += str.slice(0, n);
          this.head = p;
          p.data = str.slice(n);
        }
        break;
      }
      ++c;
    } while ((p = p.next) !== null);
    this.length -= c;
    return ret;
  }

  // Consumes a specified amount of bytes from the buffered data.
  _getBuffer(n) {
    const ret = Buffer.allocUnsafe(n);
    const retLen = n;
    let p = this.head;
    let c = 0;
    do {
      const buf = p.data;
      if (n > buf.length) {
        ret.set(buf, retLen - n);
        n -= buf.length;
      } else {
        if (n === buf.length) {
          ret.set(buf, retLen - n);
          ++c;
          if (p.next) this.head = p.next;
          else this.head = this.tail = null;
        } else {
          ret.set(new Uint8Array(buf.buffer, buf.byteOffset, n), retLen - n);
          this.head = p;
          p.data = buf.slice(n);
        }
        break;
      }
      ++c;
    } while ((p = p.next) !== null);
    this.length -= c;
    return ret;
  }

  // Make sure the linked list only shows the minimal necessary information.
  [Symbol.for("nodejs.util.inspect.custom")](_, options) {
    return inspect(this, {
      ...options,
      // Only inspect one level.
      depth: 0,
      // It should not recurse.
      customInspect: false,
    });
  }
}

function ReadableState(options, stream, isDuplex) {
  // Duplex streams are both readable and writable, but share
  // the same options object.
  // However, some cases require setting options to different
  // values for the readable and the writable sides of the duplex stream.
  // These options can be provided separately as readableXXX and writableXXX.
  if (typeof isDuplex !== "boolean") isDuplex = stream instanceof Duplex;

  // Object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away.
  this.objectMode = !!(options && options.objectMode);
  if (isDuplex) this.objectMode = this.objectMode || !!(options && options.readableObjectMode);

  // The point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  this.highWaterMark = options
    ? getHighWaterMark(this, options, "readableHighWaterMark", isDuplex)
    : getDefaultHighWaterMark(false);

  // A linked list is used to store data chunks instead of an array because the
  // linked list can remove elements from the beginning faster than
  // array.shift().
  this.buffer = new BufferList();
  this.length = 0;
  this.pipes = [];
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // Stream is still being constructed and cannot be
  // destroyed until construction finished or failed.
  // Async construction is opt in, therefore we start as
  // constructed.
  this.constructed = true;

  // A flag to be able to tell if the event 'readable'/'data' is emitted
  // immediately, or on a later tick.  We set this to true at first, because
  // any actions that shouldn't happen until "later" should generally also
  // not happen before the first read call.
  this.sync = true;

  // Whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;
  this.resumeScheduled = false;
  // this[kPaused] = null

  // True if the error was already emitted and should not be thrown again.
  this.errorEmitted = false;

  // Should close be emitted on destroy. Defaults to true.
  this.emitClose = !options || options.emitClose !== false;

  // Should .destroy() be called after 'end' (and potentially 'finish').
  this.autoDestroy = !options || options.autoDestroy !== false;

  // Has it been destroyed.
  this.destroyed = false;

  // Indicates whether the stream has errored. When true no further
  // _read calls, 'data' or 'readable' events should occur. This is needed
  // since when autoDestroy is disabled we need a way to tell whether the
  // stream has failed.
  this.errored = null;

  // Indicates whether the stream has finished destroying.
  this.closed = false;

  // True if close has been emitted or would have been emitted
  // depending on emitClose.
  this.closeEmitted = false;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = (options && options.defaultEncoding) || "utf8";

  // Ref the piped dest which we need a drain event on it
  // type: null | Writable | Set<Writable>.
  this.awaitDrainWriters = null;
  this.multiAwaitDrain = false;

  // If true, a maybeReadMore has been scheduled.
  this.readingMore = false;
  this.dataEmitted = false;
  this.decoder = null;
  this.encoding = null;
  if (options && options.encoding) {
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

/**
 * @callback validateObject
 * @param {*} value
 * @param {string} name
 * @param {{
 *   allowArray?: boolean,
 *   allowFunction?: boolean,
 *   nullable?: boolean
 * }} [options]
 */

/** @type {validateObject} */
const validateObject = (value, name, options = null) => {
  const allowArray = options?.allowArray ?? false;
  const allowFunction = options?.allowFunction ?? false;
  const nullable = options?.nullable ?? false;
  if (
    (!nullable && value === null) ||
    (!allowArray && $isArray(value)) ||
    (typeof value !== "object" && (!allowFunction || typeof value !== "function"))
  ) {
    throw new ERR_INVALID_ARG_TYPE(name, "Object", value);
  }
};

/**
 * @callback validateString
 * @param {*} value
 * @param {string} name
 * @returns {asserts value is string}
 */

/** @type {validateString} */
function validateString(value, name) {
  if (typeof value !== "string") throw new ERR_INVALID_ARG_TYPE(name, "string", value);
}

//------------------------------------------------------------------------------
// Node error polyfills
//------------------------------------------------------------------------------

function ERR_INVALID_ARG_TYPE(name, type, value) {
  return new Error(`The argument '${name}' is invalid. Received '${value}' for type '${type}'`);
}

function ERR_INVALID_ARG_VALUE(name, value, reason) {
  return new Error(`The value '${value}' is invalid for argument '${name}'. Reason: ${reason}`);
}

// node_modules/readable-stream/lib/ours/primordials.js
var require_primordials = __commonJS({
  "node_modules/readable-stream/lib/ours/primordials.js"(exports, module) {
    "use strict";
    module.exports = {
      ArrayIsArray(self) {
        return $isArray(self);
      },
      ArrayPrototypeIncludes(self, el) {
        return self.includes(el);
      },
      ArrayPrototypeIndexOf(self, el) {
        return self.indexOf(el);
      },
      ArrayPrototypeJoin(self, sep) {
        return self.join(sep);
      },
      ArrayPrototypeMap(self, fn) {
        return self.map(fn);
      },
      ArrayPrototypePop(self, el) {
        return self.pop(el);
      },
      ArrayPrototypePush(self, el) {
        return self.push(el);
      },
      ArrayPrototypeSlice(self, start, end) {
        return self.slice(start, end);
      },
      Error,
      FunctionPrototypeCall(fn, thisArgs, ...args) {
        return fn.call(thisArgs, ...args);
      },
      FunctionPrototypeSymbolHasInstance(self, instance) {
        return Function.prototype[Symbol.hasInstance].call(self, instance);
      },
      MathFloor: Math.floor,
      Number,
      NumberIsInteger: Number.isInteger,
      NumberIsNaN: Number.isNaN,
      NumberMAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
      NumberMIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
      NumberParseInt: Number.parseInt,
      ObjectDefineProperties(self, props) {
        return Object.defineProperties(self, props);
      },
      ObjectDefineProperty(self, name, prop) {
        return Object.defineProperty(self, name, prop);
      },
      ObjectGetOwnPropertyDescriptor(self, name) {
        return Object.getOwnPropertyDescriptor(self, name);
      },
      ObjectKeys(obj) {
        return Object.keys(obj);
      },
      ObjectSetPrototypeOf(target, proto) {
        return Object.setPrototypeOf(target, proto);
      },
      Promise,
      PromisePrototypeCatch(self, fn) {
        return self.catch(fn);
      },
      PromisePrototypeThen(self, thenFn, catchFn) {
        return self.then(thenFn, catchFn);
      },
      PromiseReject(err) {
        return Promise.reject(err);
      },
      ReflectApply: Reflect.apply,
      RegExpPrototypeTest(self, value) {
        return self.test(value);
      },
      SafeSet: Set,
      String,
      StringPrototypeSlice(self, start, end) {
        return self.slice(start, end);
      },
      StringPrototypeToLowerCase(self) {
        return self.toLowerCase();
      },
      StringPrototypeToUpperCase(self) {
        return self.toUpperCase();
      },
      StringPrototypeTrim(self) {
        return self.trim();
      },
      Symbol,
      SymbolAsyncIterator: Symbol.asyncIterator,
      SymbolHasInstance: Symbol.hasInstance,
      SymbolIterator: Symbol.iterator,
      Uint8Array,
    };
  },
});
// node_modules/readable-stream/lib/ours/util.js
var require_util = __commonJS({
  "node_modules/readable-stream/lib/ours/util.js"(exports, module) {
    "use strict";

    var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    var isBlob =
      typeof Blob !== "undefined"
        ? function isBlob2(b) {
            return b instanceof Blob;
          }
        : function isBlob2(b) {
            return false;
          };

    module.exports = {
      AggregateError,
      once(callback) {
        let called = false;
        return function (...args) {
          if (called) {
            return;
          }
          called = true;
          callback.apply(this, args);
        };
      },
      createDeferredPromise: function () {
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return {
          promise,
          resolve,
          reject,
        };
      },
      promisify(fn) {
        return new Promise((resolve, reject) => {
          fn((err, ...args) => {
            if (err) {
              return reject(err);
            }
            return resolve(...args);
          });
        });
      },
      debuglog() {
        return function () {};
      },
      format(format, ...args) {
        return format.replace(/%([sdifj])/g, function (...[_unused, type]) {
          const replacement = args.shift();
          if (type === "f") {
            return replacement.toFixed(6);
          } else if (type === "j") {
            return JSON.stringify(replacement);
          } else if (type === "s" && typeof replacement === "object") {
            const ctor = replacement.constructor !== Object ? replacement.constructor.name : "";
            return `${ctor} {}`.trim();
          } else {
            return replacement.toString();
          }
        });
      },
      inspect(value) {
        switch (typeof value) {
          case "string":
            if (value.includes("'")) {
              if (!value.includes('"')) {
                return `"${value}"`;
              } else if (!value.includes("`") && !value.includes("${")) {
                return `\`${value}\``;
              }
            }
            return `'${value}'`;
          case "number":
            if (isNaN(value)) {
              return "NaN";
            } else if (Object.is(value, -0)) {
              return String(value);
            }
            return value;
          case "bigint":
            return `${String(value)}n`;
          case "boolean":
          case "undefined":
            return String(value);
          case "object":
            return "{}";
        }
      },
      types: {
        isAsyncFunction(fn) {
          return fn instanceof AsyncFunction;
        },
        isArrayBufferView(arr) {
          return ArrayBuffer.isView(arr);
        },
      },
      isBlob,
    };
    module.exports.promisify.custom = Symbol.for("nodejs.util.promisify.custom");
  },
});

// node_modules/readable-stream/lib/ours/errors.js
var require_errors = __commonJS({
  "node_modules/readable-stream/lib/ours/errors.js"(exports, module) {
    "use strict";
    var { format, inspect } = require_util();
    var AggregateError = globalThis.AggregateError;
    var kIsNodeError = Symbol("kIsNodeError");
    var kTypes = ["string", "function", "number", "object", "Function", "Object", "boolean", "bigint", "symbol"];
    var classRegExp = /^([A-Z][a-z0-9]*)+$/;
    var nodeInternalPrefix = "__node_internal_";
    var codes = {};
    function assert(value, message) {
      if (!value) {
        throw new codes.ERR_INTERNAL_ASSERTION(message);
      }
    }
    function addNumericalSeparator(val) {
      let res = "";
      let i = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (; i >= start + 4; i -= 3) {
        res = `_${val.slice(i - 3, i)}${res}`;
      }
      return `${val.slice(0, i)}${res}`;
    }
    function getMessage(key, msg, args) {
      if (typeof msg === "function") {
        assert(
          msg.length <= args.length,
          `Code: ${key}; The provided arguments length (${args.length}) does not match the required ones (${msg.length}).`,
        );
        return msg(...args);
      }
      const expectedLength = (msg.match(/%[dfijoOs]/g) || []).length;
      assert(
        expectedLength === args.length,
        `Code: ${key}; The provided arguments length (${args.length}) does not match the required ones (${expectedLength}).`,
      );
      if (args.length === 0) {
        return msg;
      }
      return format(msg, ...args);
    }
    function E(code, message, Base) {
      if (!Base) {
        Base = Error;
      }
      class NodeError extends Base {
        constructor(...args) {
          super(getMessage(code, message, args));
        }
        toString() {
          return `${this.name} [${code}]: ${this.message}`;
        }
      }
      Object.defineProperties(NodeError.prototype, {
        name: {
          value: Base.name,
          writable: true,
          enumerable: false,
          configurable: true,
        },
        toString: {
          value() {
            return `${this.name} [${code}]: ${this.message}`;
          },
          writable: true,
          enumerable: false,
          configurable: true,
        },
      });
      NodeError.prototype.code = code;
      NodeError.prototype[kIsNodeError] = true;
      codes[code] = NodeError;
    }
    function hideStackFrames(fn) {
      const hidden = nodeInternalPrefix + fn.name;
      Object.defineProperty(fn, "name", {
        value: hidden,
      });
      return fn;
    }
    function aggregateTwoErrors(innerError, outerError) {
      if (innerError && outerError && innerError !== outerError) {
        if (Array.isArray(outerError.errors)) {
          outerError.errors.push(innerError);
          return outerError;
        }
        const err = new AggregateError([outerError, innerError], outerError.message);
        err.code = outerError.code;
        return err;
      }
      return innerError || outerError;
    }
    var AbortError = class extends Error {
      constructor(message = "The operation was aborted", options = void 0) {
        if (options !== void 0 && typeof options !== "object") {
          throw new codes.ERR_INVALID_ARG_TYPE("options", "Object", options);
        }
        super(message, options);
        this.code = "ABORT_ERR";
        this.name = "AbortError";
      }
    };
    E("ERR_ASSERTION", "%s", Error);
    E(
      "ERR_INVALID_ARG_TYPE",
      (name, expected, actual) => {
        assert(typeof name === "string", "'name' must be a string");
        if (!Array.isArray(expected)) {
          expected = [expected];
        }
        let msg = "The ";
        if (name.endsWith(" argument")) {
          msg += `${name} `;
        } else {
          msg += `"${name}" ${name.includes(".") ? "property" : "argument"} `;
        }
        msg += "must be ";
        const types = [];
        const instances = [];
        const other = [];
        for (const value of expected) {
          assert(typeof value === "string", "All expected entries have to be of type string");
          if (kTypes.includes(value)) {
            types.push(value.toLowerCase());
          } else if (classRegExp.test(value)) {
            instances.push(value);
          } else {
            assert(value !== "object", 'The value "object" should be written as "Object"');
            other.push(value);
          }
        }
        if (instances.length > 0) {
          const pos = types.indexOf("object");
          if (pos !== -1) {
            types.splice(types, pos, 1);
            instances.push("Object");
          }
        }
        if (types.length > 0) {
          switch (types.length) {
            case 1:
              msg += `of type ${types[0]}`;
              break;
            case 2:
              msg += `one of type ${types[0]} or ${types[1]}`;
              break;
            default: {
              const last = types.pop();
              msg += `one of type ${types.join(", ")}, or ${last}`;
            }
          }
          if (instances.length > 0 || other.length > 0) {
            msg += " or ";
          }
        }
        if (instances.length > 0) {
          switch (instances.length) {
            case 1:
              msg += `an instance of ${instances[0]}`;
              break;
            case 2:
              msg += `an instance of ${instances[0]} or ${instances[1]}`;
              break;
            default: {
              const last = instances.pop();
              msg += `an instance of ${instances.join(", ")}, or ${last}`;
            }
          }
          if (other.length > 0) {
            msg += " or ";
          }
        }
        switch (other.length) {
          case 0:
            break;
          case 1:
            if (other[0].toLowerCase() !== other[0]) {
              msg += "an ";
            }
            msg += `${other[0]}`;
            break;
          case 2:
            msg += `one of ${other[0]} or ${other[1]}`;
            break;
          default: {
            const last = other.pop();
            msg += `one of ${other.join(", ")}, or ${last}`;
          }
        }
        if (actual == null) {
          msg += `. Received ${actual}`;
        } else if (typeof actual === "function" && actual.name) {
          msg += `. Received function ${actual.name}`;
        } else if (typeof actual === "object") {
          var _actual$constructor;
          if (
            (_actual$constructor = actual.constructor) !== null &&
            _actual$constructor !== void 0 &&
            _actual$constructor.name
          ) {
            msg += `. Received an instance of ${actual.constructor.name}`;
          } else {
            const inspected = inspect(actual, {
              depth: -1,
            });
            msg += `. Received ${inspected}`;
          }
        } else {
          let inspected = inspect(actual, {
            colors: false,
          });
          if (inspected.length > 25) {
            inspected = `${inspected.slice(0, 25)}...`;
          }
          msg += `. Received type ${typeof actual} (${inspected})`;
        }
        return msg;
      },
      TypeError,
    );
    E(
      "ERR_INVALID_ARG_VALUE",
      (name, value, reason = "is invalid") => {
        let inspected = inspect(value);
        if (inspected.length > 128) {
          inspected = inspected.slice(0, 128) + "...";
        }
        const type = name.includes(".") ? "property" : "argument";
        return `The ${type} '${name}' ${reason}. Received ${inspected}`;
      },
      TypeError,
    );
    E(
      "ERR_INVALID_RETURN_VALUE",
      (input, name, value) => {
        var _value$constructor;
        const type =
          value !== null &&
          value !== void 0 &&
          (_value$constructor = value.constructor) !== null &&
          _value$constructor !== void 0 &&
          _value$constructor.name
            ? `instance of ${value.constructor.name}`
            : `type ${typeof value}`;
        return `Expected ${input} to be returned from the "${name}" function but got ${type}.`;
      },
      TypeError,
    );
    E(
      "ERR_MISSING_ARGS",
      (...args) => {
        assert(args.length > 0, "At least one arg needs to be specified");
        let msg;
        const len = args.length;
        args = (Array.isArray(args) ? args : [args]).map(a => `"${a}"`).join(" or ");
        switch (len) {
          case 1:
            msg += `The ${args[0]} argument`;
            break;
          case 2:
            msg += `The ${args[0]} and ${args[1]} arguments`;
            break;
          default:
            {
              const last = args.pop();
              msg += `The ${args.join(", ")}, and ${last} arguments`;
            }
            break;
        }
        return `${msg} must be specified`;
      },
      TypeError,
    );
    E(
      "ERR_OUT_OF_RANGE",
      (str, range, input) => {
        assert(range, 'Missing "range" argument');
        let received;
        if (Number.isInteger(input) && Math.abs(input) > 2 ** 32) {
          received = addNumericalSeparator(String(input));
        } else if (typeof input === "bigint") {
          received = String(input);
          if (input > 2n ** 32n || input < -(2n ** 32n)) {
            received = addNumericalSeparator(received);
          }
          received += "n";
        } else {
          received = inspect(input);
        }
        return `The value of "${str}" is out of range. It must be ${range}. Received ${received}`;
      },
      RangeError,
    );
    E("ERR_MULTIPLE_CALLBACK", "Callback called multiple times", Error);
    E("ERR_METHOD_NOT_IMPLEMENTED", "The %s method is not implemented", Error);
    E("ERR_STREAM_ALREADY_FINISHED", "Cannot call %s after a stream was finished", Error);
    E("ERR_STREAM_CANNOT_PIPE", "Cannot pipe, not readable", Error);
    E("ERR_STREAM_DESTROYED", "Cannot call %s after a stream was destroyed", Error);
    E("ERR_STREAM_NULL_VALUES", "May not write null values to stream", TypeError);
    E("ERR_STREAM_PREMATURE_CLOSE", "Premature close", Error);
    E("ERR_STREAM_PUSH_AFTER_EOF", "stream.push() after EOF", Error);
    E("ERR_STREAM_UNSHIFT_AFTER_END_EVENT", "stream.unshift() after end event", Error);
    E("ERR_STREAM_WRITE_AFTER_END", "write after end", Error);
    E("ERR_UNKNOWN_ENCODING", "Unknown encoding: %s", TypeError);
    module.exports = {
      AbortError,
      aggregateTwoErrors: hideStackFrames(aggregateTwoErrors),
      hideStackFrames,
      codes,
    };
  },
});

// node_modules/readable-stream/lib/internal/validators.js
var require_validators = __commonJS({
  "node_modules/readable-stream/lib/internal/validators.js"(exports, module) {
    "use strict";
    var {
      ArrayIsArray,
      ArrayPrototypeIncludes,
      ArrayPrototypeJoin,
      ArrayPrototypeMap,
      NumberIsInteger,
      NumberMAX_SAFE_INTEGER,
      NumberMIN_SAFE_INTEGER,
      NumberParseInt,
      RegExpPrototypeTest,
      String: String2,
      StringPrototypeToUpperCase,
      StringPrototypeTrim,
    } = require_primordials();
    var {
      hideStackFrames,
      codes: { ERR_SOCKET_BAD_PORT, ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE, ERR_OUT_OF_RANGE, ERR_UNKNOWN_SIGNAL },
    } = require_errors();
    var { normalizeEncoding } = require_util();
    var { isAsyncFunction, isArrayBufferView } = require_util().types;
    var signals = {};
    function isInt32(value) {
      return value === (value | 0);
    }
    function isUint32(value) {
      return value === value >>> 0;
    }
    var octalReg = /^[0-7]+$/;
    var modeDesc = "must be a 32-bit unsigned integer or an octal string";
    function parseFileMode(value, name, def) {
      if (typeof value === "undefined") {
        value = def;
      }
      if (typeof value === "string") {
        if (!RegExpPrototypeTest(octalReg, value)) {
          throw new ERR_INVALID_ARG_VALUE(name, value, modeDesc);
        }
        value = NumberParseInt(value, 8);
      }
      validateInt32(value, name, 0, 2 ** 32 - 1);
      return value;
    }
    var validateInteger = hideStackFrames((value, name, min = NumberMIN_SAFE_INTEGER, max = NumberMAX_SAFE_INTEGER) => {
      if (typeof value !== "number") throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      if (!NumberIsInteger(value)) throw new ERR_OUT_OF_RANGE(name, "an integer", value);
      if (value < min || value > max) throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
    });
    var validateInt32 = hideStackFrames((value, name, min = -2147483648, max = 2147483647) => {
      if (typeof value !== "number") {
        throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      }
      if (!isInt32(value)) {
        if (!NumberIsInteger(value)) {
          throw new ERR_OUT_OF_RANGE(name, "an integer", value);
        }
        throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
      }
      if (value < min || value > max) {
        throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
      }
    });
    var validateUint32 = hideStackFrames((value, name, positive) => {
      if (typeof value !== "number") {
        throw new ERR_INVALID_ARG_TYPE(name, "number", value);
      }
      if (!isUint32(value)) {
        if (!NumberIsInteger(value)) {
          throw new ERR_OUT_OF_RANGE(name, "an integer", value);
        }
        const min = positive ? 1 : 0;
        throw new ERR_OUT_OF_RANGE(name, `>= ${min} && < 4294967296`, value);
      }
      if (positive && value === 0) {
        throw new ERR_OUT_OF_RANGE(name, ">= 1 && < 4294967296", value);
      }
    });
    function validateString(value, name) {
      if (typeof value !== "string") throw new ERR_INVALID_ARG_TYPE(name, "string", value);
    }
    function validateNumber(value, name) {
      if (typeof value !== "number") throw new ERR_INVALID_ARG_TYPE(name, "number", value);
    }
    var validateOneOf = hideStackFrames((value, name, oneOf) => {
      if (!ArrayPrototypeIncludes(oneOf, value)) {
        const allowed = ArrayPrototypeJoin(
          ArrayPrototypeMap(oneOf, v => (typeof v === "string" ? `'${v}'` : String2(v))),
          ", ",
        );
        const reason = "must be one of: " + allowed;
        throw new ERR_INVALID_ARG_VALUE(name, value, reason);
      }
    });
    function validateBoolean(value, name) {
      if (typeof value !== "boolean") throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
    }
    var validateObject = hideStackFrames((value, name, options) => {
      const useDefaultOptions = options == null;
      const allowArray = useDefaultOptions ? false : options.allowArray;
      const allowFunction = useDefaultOptions ? false : options.allowFunction;
      const nullable = useDefaultOptions ? false : options.nullable;
      if (
        (!nullable && value === null) ||
        (!allowArray && ArrayIsArray(value)) ||
        (typeof value !== "object" && (!allowFunction || typeof value !== "function"))
      ) {
        throw new ERR_INVALID_ARG_TYPE(name, "Object", value);
      }
    });
    var validateArray = hideStackFrames((value, name, minLength = 0) => {
      if (!ArrayIsArray(value)) {
        throw new ERR_INVALID_ARG_TYPE(name, "Array", value);
      }
      if (value.length < minLength) {
        const reason = `must be longer than ${minLength}`;
        throw new ERR_INVALID_ARG_VALUE(name, value, reason);
      }
    });
    function validateSignalName(signal, name = "signal") {
      validateString(signal, name);
      if (signals[signal] === void 0) {
        if (signals[StringPrototypeToUpperCase(signal)] !== void 0) {
          throw new ERR_UNKNOWN_SIGNAL(signal + " (signals must use all capital letters)");
        }
        throw new ERR_UNKNOWN_SIGNAL(signal);
      }
    }
    var validateBuffer = hideStackFrames((buffer, name = "buffer") => {
      if (!isArrayBufferView(buffer)) {
        throw new ERR_INVALID_ARG_TYPE(name, ["Buffer", "TypedArray", "DataView"], buffer);
      }
    });
    function validateEncoding(data, encoding) {
      const normalizedEncoding = normalizeEncoding(encoding);
      const length = data.length;
      if (normalizedEncoding === "hex" && length % 2 !== 0) {
        throw new ERR_INVALID_ARG_VALUE("encoding", encoding, `is invalid for data of length ${length}`);
      }
    }
    function validatePort(port, name = "Port", allowZero = true) {
      if (
        (typeof port !== "number" && typeof port !== "string") ||
        (typeof port === "string" && StringPrototypeTrim(port).length === 0) ||
        +port !== +port >>> 0 ||
        port > 65535 ||
        (port === 0 && !allowZero)
      ) {
        throw new ERR_SOCKET_BAD_PORT(name, port, allowZero);
      }
      return port | 0;
    }
    var validateAbortSignal = hideStackFrames((signal, name) => {
      if (signal !== void 0 && (signal === null || typeof signal !== "object" || !("aborted" in signal))) {
        throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
      }
    });
    var validateFunction = hideStackFrames((value, name) => {
      if (typeof value !== "function") throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
    });
    var validatePlainFunction = hideStackFrames((value, name) => {
      if (typeof value !== "function" || isAsyncFunction(value))
        throw new ERR_INVALID_ARG_TYPE(name, "Function", value);
    });
    var validateUndefined = hideStackFrames((value, name) => {
      if (value !== void 0) throw new ERR_INVALID_ARG_TYPE(name, "undefined", value);
    });
    module.exports = {
      isInt32,
      isUint32,
      parseFileMode,
      validateArray,
      validateBoolean,
      validateBuffer,
      validateEncoding,
      validateFunction,
      validateInt32,
      validateInteger,
      validateNumber,
      validateObject,
      validateOneOf,
      validatePlainFunction,
      validatePort,
      validateSignalName,
      validateString,
      validateUint32,
      validateUndefined,
      validateAbortSignal,
    };
  },
});

// node_modules/readable-stream/lib/internal/streams/utils.js
var require_utils = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/utils.js"(exports, module) {
    "use strict";
    var { Symbol: Symbol2, SymbolAsyncIterator, SymbolIterator } = require_primordials();
    var kDestroyed = Symbol2("kDestroyed");
    var kIsErrored = Symbol2("kIsErrored");
    var kIsReadable = Symbol2("kIsReadable");
    var kIsDisturbed = Symbol2("kIsDisturbed");
    function isReadableNodeStream(obj, strict = false) {
      var _obj$_readableState;
      return !!(
        obj &&
        typeof obj.pipe === "function" &&
        typeof obj.on === "function" &&
        (!strict || (typeof obj.pause === "function" && typeof obj.resume === "function")) &&
        (!obj._writableState ||
          ((_obj$_readableState = obj._readableState) === null || _obj$_readableState === void 0
            ? void 0
            : _obj$_readableState.readable) !== false) &&
        (!obj._writableState || obj._readableState)
      );
    }
    function isWritableNodeStream(obj) {
      var _obj$_writableState;
      return !!(
        obj &&
        typeof obj.write === "function" &&
        typeof obj.on === "function" &&
        (!obj._readableState ||
          ((_obj$_writableState = obj._writableState) === null || _obj$_writableState === void 0
            ? void 0
            : _obj$_writableState.writable) !== false)
      );
    }
    function isDuplexNodeStream(obj) {
      return !!(
        obj &&
        typeof obj.pipe === "function" &&
        obj._readableState &&
        typeof obj.on === "function" &&
        typeof obj.write === "function"
      );
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
    function isIterable(obj, isAsync) {
      if (obj == null) return false;
      if (isAsync === true) return typeof obj[SymbolAsyncIterator] === "function";
      if (isAsync === false) return typeof obj[SymbolIterator] === "function";
      return typeof obj[SymbolAsyncIterator] === "function" || typeof obj[SymbolIterator] === "function";
    }
    function isDestroyed(stream) {
      if (!isNodeStream(stream)) return null;
      const wState = stream._writableState;
      const rState = stream._readableState;
      const state = wState || rState;
      return !!(stream.destroyed || stream[kDestroyed] || (state !== null && state !== void 0 && state.destroyed));
    }
    function isWritableEnded(stream) {
      if (!isWritableNodeStream(stream)) return null;
      if (stream.writableEnded === true) return true;
      const wState = stream._writableState;
      if (wState !== null && wState !== void 0 && wState.errored) return false;
      if (typeof (wState === null || wState === void 0 ? void 0 : wState.ended) !== "boolean") return null;
      return wState.ended;
    }
    function isWritableFinished(stream, strict) {
      if (!isWritableNodeStream(stream)) return null;
      if (stream.writableFinished === true) return true;
      const wState = stream._writableState;
      if (wState !== null && wState !== void 0 && wState.errored) return false;
      if (typeof (wState === null || wState === void 0 ? void 0 : wState.finished) !== "boolean") return null;
      return !!(wState.finished || (strict === false && wState.ended === true && wState.length === 0));
    }
    function isReadableEnded(stream) {
      if (!isReadableNodeStream(stream)) return null;
      if (stream.readableEnded === true) return true;
      const rState = stream._readableState;
      if (!rState || rState.errored) return false;
      if (typeof (rState === null || rState === void 0 ? void 0 : rState.ended) !== "boolean") return null;
      return rState.ended;
    }
    function isReadableFinished(stream, strict) {
      if (!isReadableNodeStream(stream)) return null;
      const rState = stream._readableState;
      if (rState !== null && rState !== void 0 && rState.errored) return false;
      if (typeof (rState === null || rState === void 0 ? void 0 : rState.endEmitted) !== "boolean") return null;
      return !!(rState.endEmitted || (strict === false && rState.ended === true && rState.length === 0));
    }
    function isReadable(stream) {
      if (stream && stream[kIsReadable] != null) return stream[kIsReadable];
      if (typeof (stream === null || stream === void 0 ? void 0 : stream.readable) !== "boolean") return null;
      if (isDestroyed(stream)) return false;
      return isReadableNodeStream(stream) && stream.readable && !isReadableFinished(stream);
    }
    function isWritable(stream) {
      if (typeof (stream === null || stream === void 0 ? void 0 : stream.writable) !== "boolean") return null;
      if (isDestroyed(stream)) return false;
      return isWritableNodeStream(stream) && stream.writable && !isWritableEnded(stream);
    }
    function isFinished(stream, opts) {
      if (!isNodeStream(stream)) {
        return null;
      }
      if (isDestroyed(stream)) {
        return true;
      }
      if ((opts === null || opts === void 0 ? void 0 : opts.readable) !== false && isReadable(stream)) {
        return false;
      }
      if ((opts === null || opts === void 0 ? void 0 : opts.writable) !== false && isWritable(stream)) {
        return false;
      }
      return true;
    }
    function isWritableErrored(stream) {
      var _stream$_writableStat, _stream$_writableStat2;
      if (!isNodeStream(stream)) {
        return null;
      }
      if (stream.writableErrored) {
        return stream.writableErrored;
      }
      return (_stream$_writableStat =
        (_stream$_writableStat2 = stream._writableState) === null || _stream$_writableStat2 === void 0
          ? void 0
          : _stream$_writableStat2.errored) !== null && _stream$_writableStat !== void 0
        ? _stream$_writableStat
        : null;
    }
    function isReadableErrored(stream) {
      var _stream$_readableStat, _stream$_readableStat2;
      if (!isNodeStream(stream)) {
        return null;
      }
      if (stream.readableErrored) {
        return stream.readableErrored;
      }
      return (_stream$_readableStat =
        (_stream$_readableStat2 = stream._readableState) === null || _stream$_readableStat2 === void 0
          ? void 0
          : _stream$_readableStat2.errored) !== null && _stream$_readableStat !== void 0
        ? _stream$_readableStat
        : null;
    }
    function isClosed(stream) {
      if (!isNodeStream(stream)) {
        return null;
      }
      if (typeof stream.closed === "boolean") {
        return stream.closed;
      }
      const wState = stream._writableState;
      const rState = stream._readableState;
      if (
        typeof (wState === null || wState === void 0 ? void 0 : wState.closed) === "boolean" ||
        typeof (rState === null || rState === void 0 ? void 0 : rState.closed) === "boolean"
      ) {
        return (
          (wState === null || wState === void 0 ? void 0 : wState.closed) ||
          (rState === null || rState === void 0 ? void 0 : rState.closed)
        );
      }
      if (typeof stream._closed === "boolean" && isOutgoingMessage(stream)) {
        return stream._closed;
      }
      return null;
    }
    function isOutgoingMessage(stream) {
      return (
        typeof stream._closed === "boolean" &&
        typeof stream._defaultKeepAlive === "boolean" &&
        typeof stream._removedConnection === "boolean" &&
        typeof stream._removedContLen === "boolean"
      );
    }
    function isServerResponse(stream) {
      return typeof stream._sent100 === "boolean" && isOutgoingMessage(stream);
    }
    function isServerRequest(stream) {
      var _stream$req;
      return (
        typeof stream._consuming === "boolean" &&
        typeof stream._dumped === "boolean" &&
        ((_stream$req = stream.req) === null || _stream$req === void 0 ? void 0 : _stream$req.upgradeOrConnect) ===
          void 0
      );
    }
    function willEmitClose(stream) {
      if (!isNodeStream(stream)) return null;
      const wState = stream._writableState;
      const rState = stream._readableState;
      const state = wState || rState;
      return (
        (!state && isServerResponse(stream)) ||
        !!(state && state.autoDestroy && state.emitClose && state.closed === false)
      );
    }
    function isDisturbed(stream) {
      var _stream$kIsDisturbed;
      return !!(
        stream &&
        ((_stream$kIsDisturbed = stream[kIsDisturbed]) !== null && _stream$kIsDisturbed !== void 0
          ? _stream$kIsDisturbed
          : stream.readableDidRead || stream.readableAborted)
      );
    }
    function isErrored(stream) {
      var _ref,
        _ref2,
        _ref3,
        _ref4,
        _ref5,
        _stream$kIsErrored,
        _stream$_readableStat3,
        _stream$_writableStat3,
        _stream$_readableStat4,
        _stream$_writableStat4;
      return !!(
        stream &&
        ((_ref =
          (_ref2 =
            (_ref3 =
              (_ref4 =
                (_ref5 =
                  (_stream$kIsErrored = stream[kIsErrored]) !== null && _stream$kIsErrored !== void 0
                    ? _stream$kIsErrored
                    : stream.readableErrored) !== null && _ref5 !== void 0
                  ? _ref5
                  : stream.writableErrored) !== null && _ref4 !== void 0
                ? _ref4
                : (_stream$_readableStat3 = stream._readableState) === null || _stream$_readableStat3 === void 0
                ? void 0
                : _stream$_readableStat3.errorEmitted) !== null && _ref3 !== void 0
              ? _ref3
              : (_stream$_writableStat3 = stream._writableState) === null || _stream$_writableStat3 === void 0
              ? void 0
              : _stream$_writableStat3.errorEmitted) !== null && _ref2 !== void 0
            ? _ref2
            : (_stream$_readableStat4 = stream._readableState) === null || _stream$_readableStat4 === void 0
            ? void 0
            : _stream$_readableStat4.errored) !== null && _ref !== void 0
          ? _ref
          : (_stream$_writableStat4 = stream._writableState) === null || _stream$_writableStat4 === void 0
          ? void 0
          : _stream$_writableStat4.errored)
      );
    }
    module.exports = {
      kDestroyed,
      isDisturbed,
      kIsDisturbed,
      isErrored,
      kIsErrored,
      isReadable,
      kIsReadable,
      isClosed,
      isDestroyed,
      isDuplexNodeStream,
      isFinished,
      isIterable,
      isReadableNodeStream,
      isReadableEnded,
      isReadableFinished,
      isReadableErrored,
      isNodeStream,
      isWritable,
      isWritableNodeStream,
      isWritableEnded,
      isWritableFinished,
      isWritableErrored,
      isServerRequest,
      isServerResponse,
      willEmitClose,
    };
  },
});

// node_modules/readable-stream/lib/internal/streams/end-of-stream.js
var require_end_of_stream = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/end-of-stream.js"(exports, module) {
    "use strict";
    var { AbortError, codes } = require_errors();
    var { ERR_INVALID_ARG_TYPE, ERR_STREAM_PREMATURE_CLOSE } = codes;
    var { once } = require_util();
    var { validateAbortSignal, validateFunction, validateObject } = require_validators();
    var { Promise: Promise2 } = require_primordials();
    var {
      isClosed,
      isReadable,
      isReadableNodeStream,
      isReadableFinished,
      isReadableErrored,
      isWritable,
      isWritableNodeStream,
      isWritableFinished,
      isWritableErrored,
      isNodeStream,
      willEmitClose: _willEmitClose,
    } = require_utils();
    function isRequest(stream) {
      return stream.setHeader && typeof stream.abort === "function";
    }
    var nop = () => {};
    function eos(stream, options, callback) {
      var _options$readable, _options$writable;
      if (arguments.length === 2) {
        callback = options;
        options = {};
      } else if (options == null) {
        options = {};
      } else {
        validateObject(options, "options");
      }
      validateFunction(callback, "callback");
      validateAbortSignal(options.signal, "options.signal");
      callback = once(callback);
      const readable =
        (_options$readable = options.readable) !== null && _options$readable !== void 0
          ? _options$readable
          : isReadableNodeStream(stream);
      const writable =
        (_options$writable = options.writable) !== null && _options$writable !== void 0
          ? _options$writable
          : isWritableNodeStream(stream);
      if (!isNodeStream(stream)) {
        throw new ERR_INVALID_ARG_TYPE("stream", "Stream", stream);
      }
      const wState = stream._writableState;
      const rState = stream._readableState;
      const onlegacyfinish = () => {
        if (!stream.writable) {
          onfinish();
        }
      };
      let willEmitClose =
        _willEmitClose(stream) &&
        isReadableNodeStream(stream) === readable &&
        isWritableNodeStream(stream) === writable;
      let writableFinished = isWritableFinished(stream, false);
      const onfinish = () => {
        writableFinished = true;
        if (stream.destroyed) {
          willEmitClose = false;
        }
        if (willEmitClose && (!stream.readable || readable)) {
          return;
        }
        if (!readable || readableFinished) {
          callback.call(stream);
        }
      };
      let readableFinished = isReadableFinished(stream, false);
      const onend = () => {
        readableFinished = true;
        if (stream.destroyed) {
          willEmitClose = false;
        }
        if (willEmitClose && (!stream.writable || writable)) {
          return;
        }
        if (!writable || writableFinished) {
          callback.call(stream);
        }
      };
      const onerror = err => {
        callback.call(stream, err);
      };
      let closed = isClosed(stream);
      const onclose = () => {
        closed = true;
        const errored = isWritableErrored(stream) || isReadableErrored(stream);
        if (errored && typeof errored !== "boolean") {
          return callback.call(stream, errored);
        }
        if (readable && !readableFinished && isReadableNodeStream(stream, true)) {
          if (!isReadableFinished(stream, false)) return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE());
        }
        if (writable && !writableFinished) {
          if (!isWritableFinished(stream, false)) return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE());
        }
        callback.call(stream);
      };
      const onrequest = () => {
        stream.req.on("finish", onfinish);
      };
      if (isRequest(stream)) {
        stream.on("complete", onfinish);
        if (!willEmitClose) {
          stream.on("abort", onclose);
        }
        if (stream.req) {
          onrequest();
        } else {
          stream.on("request", onrequest);
        }
      } else if (writable && !wState) {
        stream.on("end", onlegacyfinish);
        stream.on("close", onlegacyfinish);
      }
      if (!willEmitClose && typeof stream.aborted === "boolean") {
        stream.on("aborted", onclose);
      }
      stream.on("end", onend);
      stream.on("finish", onfinish);
      if (options.error !== false) {
        stream.on("error", onerror);
      }
      stream.on("close", onclose);
      if (closed) {
        runOnNextTick(onclose);
      } else if (
        (wState !== null && wState !== void 0 && wState.errorEmitted) ||
        (rState !== null && rState !== void 0 && rState.errorEmitted)
      ) {
        if (!willEmitClose) {
          runOnNextTick(onclose);
        }
      } else if (
        !readable &&
        (!willEmitClose || isReadable(stream)) &&
        (writableFinished || isWritable(stream) === false)
      ) {
        runOnNextTick(onclose);
      } else if (
        !writable &&
        (!willEmitClose || isWritable(stream)) &&
        (readableFinished || isReadable(stream) === false)
      ) {
        runOnNextTick(onclose);
      } else if (rState && stream.req && stream.aborted) {
        runOnNextTick(onclose);
      }
      const cleanup = () => {
        callback = nop;
        stream.removeListener("aborted", onclose);
        stream.removeListener("complete", onfinish);
        stream.removeListener("abort", onclose);
        stream.removeListener("request", onrequest);
        if (stream.req) stream.req.removeListener("finish", onfinish);
        stream.removeListener("end", onlegacyfinish);
        stream.removeListener("close", onlegacyfinish);
        stream.removeListener("finish", onfinish);
        stream.removeListener("end", onend);
        stream.removeListener("error", onerror);
        stream.removeListener("close", onclose);
      };
      if (options.signal && !closed) {
        const abort = () => {
          const endCallback = callback;
          cleanup();
          endCallback.call(
            stream,
            new AbortError(void 0, {
              cause: options.signal.reason,
            }),
          );
        };
        if (options.signal.aborted) {
          runOnNextTick(abort);
        } else {
          const originalCallback = callback;
          callback = once((...args) => {
            options.signal.removeEventListener("abort", abort);
            originalCallback.apply(stream, args);
          });
          options.signal.addEventListener("abort", abort);
        }
      }
      return cleanup;
    }
    function finished(stream, opts) {
      return new Promise2((resolve, reject) => {
        eos(stream, opts, err => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
    module.exports = eos;
    module.exports.finished = finished;
  },
});

// node_modules/readable-stream/lib/internal/streams/operators.js
var require_operators = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/operators.js"(exports, module) {
    "use strict";
    var {
      codes: { ERR_INVALID_ARG_TYPE, ERR_MISSING_ARGS, ERR_OUT_OF_RANGE },
      AbortError,
    } = require_errors();
    var { validateAbortSignal, validateInteger, validateObject } = require_validators();
    var kWeakHandler = require_primordials().Symbol("kWeak");
    var { finished } = require_end_of_stream();
    var {
      ArrayPrototypePush,
      MathFloor,
      Number: Number2,
      NumberIsNaN,
      Promise: Promise2,
      PromiseReject,
      PromisePrototypeCatch,
      Symbol: Symbol2,
    } = require_primordials();
    var kEmpty = Symbol2("kEmpty");
    var kEof = Symbol2("kEof");
    function map(fn, options) {
      if (typeof fn !== "function") {
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      }
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      let concurrency = 1;
      if ((options === null || options === void 0 ? void 0 : options.concurrency) != null) {
        concurrency = MathFloor(options.concurrency);
      }
      validateInteger(concurrency, "concurrency", 1);
      return async function* map2() {
        var _options$signal, _options$signal2;
        const ac = new AbortController();
        const stream = this;
        const queue = [];
        const signal = ac.signal;
        const signalOpt = {
          signal,
        };
        const abort = () => ac.abort();
        if (
          options !== null &&
          options !== void 0 &&
          (_options$signal = options.signal) !== null &&
          _options$signal !== void 0 &&
          _options$signal.aborted
        ) {
          abort();
        }
        options === null || options === void 0
          ? void 0
          : (_options$signal2 = options.signal) === null || _options$signal2 === void 0
          ? void 0
          : _options$signal2.addEventListener("abort", abort);
        let next;
        let resume;
        let done = false;
        function onDone() {
          done = true;
        }
        async function pump() {
          try {
            for await (let val of stream) {
              var _val;
              if (done) {
                return;
              }
              if (signal.aborted) {
                throw new AbortError();
              }
              try {
                val = fn(val, signalOpt);
              } catch (err) {
                val = PromiseReject(err);
              }
              if (val === kEmpty) {
                continue;
              }
              if (typeof ((_val = val) === null || _val === void 0 ? void 0 : _val.catch) === "function") {
                val.catch(onDone);
              }
              queue.push(val);
              if (next) {
                next();
                next = null;
              }
              if (!done && queue.length && queue.length >= concurrency) {
                await new Promise2(resolve => {
                  resume = resolve;
                });
              }
            }
            queue.push(kEof);
          } catch (err) {
            const val = PromiseReject(err);
            PromisePrototypeCatch(val, onDone);
            queue.push(val);
          } finally {
            var _options$signal3;
            done = true;
            if (next) {
              next();
              next = null;
            }
            options === null || options === void 0
              ? void 0
              : (_options$signal3 = options.signal) === null || _options$signal3 === void 0
              ? void 0
              : _options$signal3.removeEventListener("abort", abort);
          }
        }
        pump();
        try {
          while (true) {
            while (queue.length > 0) {
              const val = await queue[0];
              if (val === kEof) {
                return;
              }
              if (signal.aborted) {
                throw new AbortError();
              }
              if (val !== kEmpty) {
                yield val;
              }
              queue.shift();
              if (resume) {
                resume();
                resume = null;
              }
            }
            await new Promise2(resolve => {
              next = resolve;
            });
          }
        } finally {
          ac.abort();
          done = true;
          if (resume) {
            resume();
            resume = null;
          }
        }
      }.call(this);
    }
    function asIndexedPairs(options = void 0) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      return async function* asIndexedPairs2() {
        let index = 0;
        for await (const val of this) {
          var _options$signal4;
          if (
            options !== null &&
            options !== void 0 &&
            (_options$signal4 = options.signal) !== null &&
            _options$signal4 !== void 0 &&
            _options$signal4.aborted
          ) {
            throw new AbortError({
              cause: options.signal.reason,
            });
          }
          yield [index++, val];
        }
      }.call(this);
    }
    async function some(fn, options = void 0) {
      for await (const unused of filter.call(this, fn, options)) {
        return true;
      }
      return false;
    }
    async function every(fn, options = void 0) {
      if (typeof fn !== "function") {
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      }
      return !(await some.call(
        this,
        async (...args) => {
          return !(await fn(...args));
        },
        options,
      ));
    }
    async function find(fn, options) {
      for await (const result of filter.call(this, fn, options)) {
        return result;
      }
      return void 0;
    }
    async function forEach(fn, options) {
      if (typeof fn !== "function") {
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      }
      async function forEachFn(value, options2) {
        await fn(value, options2);
        return kEmpty;
      }
      for await (const unused of map.call(this, forEachFn, options));
    }
    function filter(fn, options) {
      if (typeof fn !== "function") {
        throw new ERR_INVALID_ARG_TYPE("fn", ["Function", "AsyncFunction"], fn);
      }
      async function filterFn(value, options2) {
        if (await fn(value, options2)) {
          return value;
        }
        return kEmpty;
      }
      return map.call(this, filterFn, options);
    }
    var ReduceAwareErrMissingArgs = class extends ERR_MISSING_ARGS {
      constructor() {
        super("reduce");
        this.message = "Reduce of an empty stream requires an initial value";
      }
    };
    async function reduce(reducer, initialValue, options) {
      var _options$signal5;
      if (typeof reducer !== "function") {
        throw new ERR_INVALID_ARG_TYPE("reducer", ["Function", "AsyncFunction"], reducer);
      }
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      let hasInitialValue = arguments.length > 1;
      if (
        options !== null &&
        options !== void 0 &&
        (_options$signal5 = options.signal) !== null &&
        _options$signal5 !== void 0 &&
        _options$signal5.aborted
      ) {
        const err = new AbortError(void 0, {
          cause: options.signal.reason,
        });
        this.once("error", () => {});
        await finished(this.destroy(err));
        throw err;
      }
      const ac = new AbortController();
      const signal = ac.signal;
      if (options !== null && options !== void 0 && options.signal) {
        const opts = {
          once: true,
          [kWeakHandler]: this,
        };
        options.signal.addEventListener("abort", () => ac.abort(), opts);
      }
      let gotAnyItemFromStream = false;
      try {
        for await (const value of this) {
          var _options$signal6;
          gotAnyItemFromStream = true;
          if (
            options !== null &&
            options !== void 0 &&
            (_options$signal6 = options.signal) !== null &&
            _options$signal6 !== void 0 &&
            _options$signal6.aborted
          ) {
            throw new AbortError();
          }
          if (!hasInitialValue) {
            initialValue = value;
            hasInitialValue = true;
          } else {
            initialValue = await reducer(initialValue, value, {
              signal,
            });
          }
        }
        if (!gotAnyItemFromStream && !hasInitialValue) {
          throw new ReduceAwareErrMissingArgs();
        }
      } finally {
        ac.abort();
      }
      return initialValue;
    }
    async function toArray(options) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      const result = [];
      for await (const val of this) {
        var _options$signal7;
        if (
          options !== null &&
          options !== void 0 &&
          (_options$signal7 = options.signal) !== null &&
          _options$signal7 !== void 0 &&
          _options$signal7.aborted
        ) {
          throw new AbortError(void 0, {
            cause: options.signal.reason,
          });
        }
        ArrayPrototypePush(result, val);
      }
      return result;
    }
    function flatMap(fn, options) {
      const values = map.call(this, fn, options);
      return async function* flatMap2() {
        for await (const val of values) {
          yield* val;
        }
      }.call(this);
    }
    function toIntegerOrInfinity(number) {
      number = Number2(number);
      if (NumberIsNaN(number)) {
        return 0;
      }
      if (number < 0) {
        throw new ERR_OUT_OF_RANGE("number", ">= 0", number);
      }
      return number;
    }
    function drop(number, options = void 0) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      number = toIntegerOrInfinity(number);
      return async function* drop2() {
        var _options$signal8;
        if (
          options !== null &&
          options !== void 0 &&
          (_options$signal8 = options.signal) !== null &&
          _options$signal8 !== void 0 &&
          _options$signal8.aborted
        ) {
          throw new AbortError();
        }
        for await (const val of this) {
          var _options$signal9;
          if (
            options !== null &&
            options !== void 0 &&
            (_options$signal9 = options.signal) !== null &&
            _options$signal9 !== void 0 &&
            _options$signal9.aborted
          ) {
            throw new AbortError();
          }
          if (number-- <= 0) {
            yield val;
          }
        }
      }.call(this);
    }
    function take(number, options = void 0) {
      if (options != null) {
        validateObject(options, "options");
      }
      if ((options === null || options === void 0 ? void 0 : options.signal) != null) {
        validateAbortSignal(options.signal, "options.signal");
      }
      number = toIntegerOrInfinity(number);
      return async function* take2() {
        var _options$signal10;
        if (
          options !== null &&
          options !== void 0 &&
          (_options$signal10 = options.signal) !== null &&
          _options$signal10 !== void 0 &&
          _options$signal10.aborted
        ) {
          throw new AbortError();
        }
        for await (const val of this) {
          var _options$signal11;
          if (
            options !== null &&
            options !== void 0 &&
            (_options$signal11 = options.signal) !== null &&
            _options$signal11 !== void 0 &&
            _options$signal11.aborted
          ) {
            throw new AbortError();
          }
          if (number-- > 0) {
            yield val;
          } else {
            return;
          }
        }
      }.call(this);
    }
    module.exports.streamReturningOperators = {
      asIndexedPairs,
      drop,
      filter,
      flatMap,
      map,
      take,
    };
    module.exports.promiseReturningOperators = {
      every,
      forEach,
      reduce,
      toArray,
      some,
      find,
    };
  },
});

// node_modules/readable-stream/lib/internal/streams/destroy.js
var require_destroy = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/destroy.js"(exports, module) {
    "use strict";
    var {
      aggregateTwoErrors,
      codes: { ERR_MULTIPLE_CALLBACK },
      AbortError,
    } = require_errors();
    var { Symbol: Symbol2 } = require_primordials();
    var { kDestroyed, isDestroyed, isFinished, isServerRequest } = require_utils();
    var kDestroy = "#kDestroy";
    var kConstruct = "#kConstruct";
    function checkError(err, w, r) {
      if (err) {
        err.stack;
        if (w && !w.errored) {
          w.errored = err;
        }
        if (r && !r.errored) {
          r.errored = err;
        }
      }
    }
    function destroy(err, cb) {
      const r = this._readableState;
      const w = this._writableState;
      const s = w || r;
      if ((w && w.destroyed) || (r && r.destroyed)) {
        if (typeof cb === "function") {
          cb();
        }
        return this;
      }
      checkError(err, w, r);
      if (w) {
        w.destroyed = true;
      }
      if (r) {
        r.destroyed = true;
      }
      if (!s.constructed) {
        this.once(kDestroy, er => {
          _destroy(this, aggregateTwoErrors(er, err), cb);
        });
      } else {
        _destroy(this, err, cb);
      }
      return this;
    }
    function _destroy(self, err, cb) {
      let called = false;
      function onDestroy(err2) {
        if (called) {
          return;
        }
        called = true;
        const r = self._readableState;
        const w = self._writableState;
        checkError(err2, w, r);
        if (w) {
          w.closed = true;
        }
        if (r) {
          r.closed = true;
        }
        if (typeof cb === "function") {
          cb(err2);
        }
        if (err2) {
          runOnNextTick(emitErrorCloseNT, self, err2);
        } else {
          runOnNextTick(emitCloseNT, self);
        }
      }
      try {
        self._destroy(err || null, onDestroy);
      } catch (err2) {
        onDestroy(err2);
      }
    }
    function emitErrorCloseNT(self, err) {
      emitErrorNT(self, err);
      emitCloseNT(self);
    }
    function emitCloseNT(self) {
      const r = self._readableState;
      const w = self._writableState;
      if (w) {
        w.closeEmitted = true;
      }
      if (r) {
        r.closeEmitted = true;
      }
      if ((w && w.emitClose) || (r && r.emitClose)) {
        self.emit("close");
      }
    }
    function emitErrorNT(self, err) {
      const r = self?._readableState;
      const w = self?._writableState;
      if (w?.errorEmitted || r?.errorEmitted) {
        return;
      }
      if (w) {
        w.errorEmitted = true;
      }
      if (r) {
        r.errorEmitted = true;
      }
      self?.emit?.("error", err);
    }
    function undestroy() {
      const r = this._readableState;
      const w = this._writableState;
      if (r) {
        r.constructed = true;
        r.closed = false;
        r.closeEmitted = false;
        r.destroyed = false;
        r.errored = null;
        r.errorEmitted = false;
        r.reading = false;
        r.ended = r.readable === false;
        r.endEmitted = r.readable === false;
      }
      if (w) {
        w.constructed = true;
        w.destroyed = false;
        w.closed = false;
        w.closeEmitted = false;
        w.errored = null;
        w.errorEmitted = false;
        w.finalCalled = false;
        w.prefinished = false;
        w.ended = w.writable === false;
        w.ending = w.writable === false;
        w.finished = w.writable === false;
      }
    }
    function errorOrDestroy(stream, err, sync) {
      const r = stream?._readableState;
      const w = stream?._writableState;
      if ((w && w.destroyed) || (r && r.destroyed)) {
        return this;
      }
      if ((r && r.autoDestroy) || (w && w.autoDestroy)) stream.destroy(err);
      else if (err) {
        Error.captureStackTrace(err);
        if (w && !w.errored) {
          w.errored = err;
        }
        if (r && !r.errored) {
          r.errored = err;
        }
        if (sync) {
          runOnNextTick(emitErrorNT, stream, err);
        } else {
          emitErrorNT(stream, err);
        }
      }
    }
    function construct(stream, cb) {
      if (typeof stream._construct !== "function") {
        return;
      }
      const r = stream._readableState;
      const w = stream._writableState;
      if (r) {
        r.constructed = false;
      }
      if (w) {
        w.constructed = false;
      }
      stream.once(kConstruct, cb);
      if (stream.listenerCount(kConstruct) > 1) {
        return;
      }
      runOnNextTick(constructNT, stream);
    }
    function constructNT(stream) {
      let called = false;
      function onConstruct(err) {
        if (called) {
          errorOrDestroy(stream, err !== null && err !== void 0 ? err : new ERR_MULTIPLE_CALLBACK());
          return;
        }
        called = true;
        const r = stream._readableState;
        const w = stream._writableState;
        const s = w || r;
        if (r) {
          r.constructed = true;
        }
        if (w) {
          w.constructed = true;
        }
        if (s.destroyed) {
          stream.emit(kDestroy, err);
        } else if (err) {
          errorOrDestroy(stream, err, true);
        } else {
          runOnNextTick(emitConstructNT, stream);
        }
      }
      try {
        stream._construct(onConstruct);
      } catch (err) {
        onConstruct(err);
      }
    }
    function emitConstructNT(stream) {
      stream.emit(kConstruct);
    }
    function isRequest(stream) {
      return stream && stream.setHeader && typeof stream.abort === "function";
    }
    function emitCloseLegacy(stream) {
      stream.emit("close");
    }
    function emitErrorCloseLegacy(stream, err) {
      stream.emit("error", err);
      runOnNextTick(emitCloseLegacy, stream);
    }
    function destroyer(stream, err) {
      if (!stream || isDestroyed(stream)) {
        return;
      }
      if (!err && !isFinished(stream)) {
        err = new AbortError();
      }
      if (isServerRequest(stream)) {
        stream.socket = null;
        stream.destroy(err);
      } else if (isRequest(stream)) {
        stream.abort();
      } else if (isRequest(stream.req)) {
        stream.req.abort();
      } else if (typeof stream.destroy === "function") {
        stream.destroy(err);
      } else if (typeof stream.close === "function") {
        stream.close();
      } else if (err) {
        runOnNextTick(emitErrorCloseLegacy, stream);
      } else {
        runOnNextTick(emitCloseLegacy, stream);
      }
      if (!stream.destroyed) {
        stream[kDestroyed] = true;
      }
    }
    module.exports = {
      construct,
      destroyer,
      destroy,
      undestroy,
      errorOrDestroy,
    };
  },
});

// node_modules/readable-stream/lib/internal/streams/legacy.js
var require_legacy = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/legacy.js"(exports, module) {
    "use strict";
    var { ArrayIsArray, ObjectSetPrototypeOf } = require_primordials();

    function Stream(options) {
      if (!(this instanceof Stream)) return new Stream(options);
      EE.call(this, options);
    }
    Stream.prototype = {};
    ObjectSetPrototypeOf(Stream.prototype, EE.prototype);
    ObjectSetPrototypeOf(Stream, EE);

    Stream.prototype.pipe = function (dest, options) {
      const source = this;
      function ondata(chunk) {
        if (dest.writable && dest.write(chunk) === false && source.pause) {
          source.pause();
        }
      }
      source.on("data", ondata);
      function ondrain() {
        if (source.readable && source.resume) {
          source.resume();
        }
      }
      dest.on("drain", ondrain);
      if (!dest._isStdio && (!options || options.end !== false)) {
        source.on("end", onend);
        source.on("close", onclose);
      }
      let didOnEnd = false;
      function onend() {
        if (didOnEnd) return;
        didOnEnd = true;
        dest.end();
      }
      function onclose() {
        if (didOnEnd) return;
        didOnEnd = true;
        if (typeof dest.destroy === "function") dest.destroy();
      }
      function onerror(er) {
        cleanup();
        if (EE.listenerCount(this, "error") === 0) {
          this.emit("error", er);
        }
      }
      prependListener(source, "error", onerror);
      prependListener(dest, "error", onerror);
      function cleanup() {
        source.removeListener("data", ondata);
        dest.removeListener("drain", ondrain);
        source.removeListener("end", onend);
        source.removeListener("close", onclose);
        source.removeListener("error", onerror);
        dest.removeListener("error", onerror);
        source.removeListener("end", cleanup);
        source.removeListener("close", cleanup);
        dest.removeListener("close", cleanup);
      }
      source.on("end", cleanup);
      source.on("close", cleanup);
      dest.on("close", cleanup);
      dest.emit("pipe", source);
      return dest;
    };
    function prependListener(emitter, event, fn) {
      if (typeof emitter.prependListener === "function") return emitter.prependListener(event, fn);
      if (!emitter._events || !emitter._events[event]) emitter.on(event, fn);
      else if (ArrayIsArray(emitter._events[event])) emitter._events[event].unshift(fn);
      else emitter._events[event] = [fn, emitter._events[event]];
    }
    module.exports = {
      Stream,
      prependListener,
    };
  },
});

// node_modules/readable-stream/lib/internal/streams/add-abort-signal.js
var require_add_abort_signal = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/add-abort-signal.js"(exports, module) {
    "use strict";
    var { AbortError, codes } = require_errors();
    var eos = require_end_of_stream();
    var { ERR_INVALID_ARG_TYPE } = codes;
    var validateAbortSignal = (signal, name) => {
      if (typeof signal !== "object" || !("aborted" in signal)) {
        throw new ERR_INVALID_ARG_TYPE(name, "AbortSignal", signal);
      }
    };
    function isNodeStream(obj) {
      return !!(obj && typeof obj.pipe === "function");
    }
    module.exports.addAbortSignal = function addAbortSignal(signal, stream) {
      validateAbortSignal(signal, "signal");
      if (!isNodeStream(stream)) {
        throw new ERR_INVALID_ARG_TYPE("stream", "stream.Stream", stream);
      }
      return module.exports.addAbortSignalNoValidate(signal, stream);
    };
    module.exports.addAbortSignalNoValidate = function (signal, stream) {
      if (typeof signal !== "object" || !("aborted" in signal)) {
        return stream;
      }
      const onAbort = () => {
        stream.destroy(
          new AbortError(void 0, {
            cause: signal.reason,
          }),
        );
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort);
        eos(stream, () => signal.removeEventListener("abort", onAbort));
      }
      return stream;
    };
  },
});

// node_modules/readable-stream/lib/internal/streams/state.js
var require_state = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/state.js"(exports, module) {
    "use strict";
    var { MathFloor, NumberIsInteger } = require_primordials();
    var { ERR_INVALID_ARG_VALUE } = require_errors().codes;
    function highWaterMarkFrom(options, isDuplex, duplexKey) {
      return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
    }
    function getDefaultHighWaterMark(objectMode) {
      return objectMode ? 16 : 16 * 1024;
    }
    function getHighWaterMark(state, options, duplexKey, isDuplex) {
      const hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
      if (hwm != null) {
        if (!NumberIsInteger(hwm) || hwm < 0) {
          const name = isDuplex ? `options.${duplexKey}` : "options.highWaterMark";
          throw new ERR_INVALID_ARG_VALUE(name, hwm);
        }
        return MathFloor(hwm);
      }
      return getDefaultHighWaterMark(state.objectMode);
    }
    module.exports = {
      getHighWaterMark,
      getDefaultHighWaterMark,
    };
  },
});

// node_modules/readable-stream/lib/internal/streams/from.js
var require_from = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/from.js"(exports, module) {
    "use strict";
    var { PromisePrototypeThen, SymbolAsyncIterator, SymbolIterator } = require_primordials();
    var { ERR_INVALID_ARG_TYPE, ERR_STREAM_NULL_VALUES } = require_errors().codes;
    function from(Readable, iterable, opts) {
      let iterator;
      if (typeof iterable === "string" || iterable instanceof Buffer) {
        return new Readable({
          objectMode: true,
          ...opts,
          read() {
            this.push(iterable);
            this.push(null);
          },
        });
      }
      let isAsync;
      if (iterable && iterable[SymbolAsyncIterator]) {
        isAsync = true;
        iterator = iterable[SymbolAsyncIterator]();
      } else if (iterable && iterable[SymbolIterator]) {
        isAsync = false;
        iterator = iterable[SymbolIterator]();
      } else {
        throw new ERR_INVALID_ARG_TYPE("iterable", ["Iterable"], iterable);
      }
      const readable = new Readable({
        objectMode: true,
        highWaterMark: 1,
        ...opts,
      });
      let reading = false;
      readable._read = function () {
        if (!reading) {
          reading = true;
          next();
        }
      };
      readable._destroy = function (error, cb) {
        PromisePrototypeThen(
          close(error),
          () => runOnNextTick(cb, error),
          e => runOnNextTick(cb, e || error),
        );
      };
      async function close(error) {
        const hadError = error !== void 0 && error !== null;
        const hasThrow = typeof iterator.throw === "function";
        if (hadError && hasThrow) {
          const { value, done } = await iterator.throw(error);
          await value;
          if (done) {
            return;
          }
        }
        if (typeof iterator.return === "function") {
          const { value } = await iterator.return();
          await value;
        }
      }
      async function next() {
        for (;;) {
          try {
            const { value, done } = isAsync ? await iterator.next() : iterator.next();
            if (done) {
              readable.push(null);
            } else {
              const res = value && typeof value.then === "function" ? await value : value;
              if (res === null) {
                reading = false;
                throw new ERR_STREAM_NULL_VALUES();
              } else if (readable.push(res)) {
                continue;
              } else {
                reading = false;
              }
            }
          } catch (err) {
            readable.destroy(err);
          }
          break;
        }
      }
      return readable;
    }
    module.exports = from;
  },
});

var _ReadableFromWeb;
var _ReadableFromWebForUndici;

// node_modules/readable-stream/lib/internal/streams/readable.js
var require_readable = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/readable.js"(exports, module) {
    "use strict";
    var {
      ArrayPrototypeIndexOf,
      NumberIsInteger,
      NumberIsNaN,
      NumberParseInt,
      ObjectDefineProperties,
      ObjectKeys,
      ObjectSetPrototypeOf,
      Promise: Promise2,
      SafeSet,
      SymbolAsyncIterator,
      Symbol: Symbol2,
    } = require_primordials();

    var { Stream, prependListener } = require_legacy();

    function Readable(options) {
      if (!(this instanceof Readable)) return new Readable(options);
      const isDuplex = this instanceof require_duplex();
      this._readableState = new ReadableState(options, this, isDuplex);
      if (options) {
        const { read, destroy, construct, signal } = options;
        if (typeof read === "function") this._read = read;
        if (typeof destroy === "function") this._destroy = destroy;
        if (typeof construct === "function") this._construct = construct;
        if (signal && !isDuplex) addAbortSignal(signal, this);
      }
      Stream.call(this, options);

      destroyImpl.construct(this, () => {
        if (this._readableState.needReadable) {
          maybeReadMore(this, this._readableState);
        }
      });
    }
    Readable.prototype = {};
    ObjectSetPrototypeOf(Readable.prototype, Stream.prototype);
    ObjectSetPrototypeOf(Readable, Stream);

    Readable.prototype.on = function (ev, fn) {
      const res = Stream.prototype.on.call(this, ev, fn);
      const state = this._readableState;
      if (ev === "data") {
        state.readableListening = this.listenerCount("readable") > 0;
        if (state.flowing !== false) {
          $debug("in flowing mode!", this.__id);
          this.resume();
        } else {
          $debug("in readable mode!", this.__id);
        }
      } else if (ev === "readable") {
        $debug("readable listener added!", this.__id);
        if (!state.endEmitted && !state.readableListening) {
          state.readableListening = state.needReadable = true;
          state.flowing = false;
          state.emittedReadable = false;
          $debug(
            "on readable - state.length, reading, emittedReadable",
            state.length,
            state.reading,
            state.emittedReadable,
            this.__id,
          );
          if (state.length) {
            emitReadable(this, state);
          } else if (!state.reading) {
            runOnNextTick(nReadingNextTick, this);
          }
        } else if (state.endEmitted) {
          $debug("end already emitted...", this.__id);
        }
      }
      return res;
    };

    class ReadableFromWeb extends Readable {
      #reader;
      #closed;
      #pendingChunks;
      #stream;

      constructor(options, stream) {
        const { objectMode, highWaterMark, encoding, signal } = options;
        super({
          objectMode,
          highWaterMark,
          encoding,
          signal,
        });
        this.#pendingChunks = [];
        this.#reader = undefined;
        this.#stream = stream;
        this.#closed = false;
      }

      #drainPending() {
        var pendingChunks = this.#pendingChunks,
          pendingChunksI = 0,
          pendingChunksCount = pendingChunks.length;

        for (; pendingChunksI < pendingChunksCount; pendingChunksI++) {
          const chunk = pendingChunks[pendingChunksI];
          pendingChunks[pendingChunksI] = undefined;
          if (!this.push(chunk, undefined)) {
            this.#pendingChunks = pendingChunks.slice(pendingChunksI + 1);
            return true;
          }
        }

        if (pendingChunksCount > 0) {
          this.#pendingChunks = [];
        }

        return false;
      }

      #handleDone(reader) {
        reader.releaseLock();
        this.#reader = undefined;
        this.#closed = true;
        this.push(null);
        return;
      }

      async _read() {
        $debug("ReadableFromWeb _read()", this.__id);
        var stream = this.#stream,
          reader = this.#reader;
        if (stream) {
          reader = this.#reader = stream.getReader();
          this.#stream = undefined;
        } else if (this.#drainPending()) {
          return;
        }

        var deferredError;
        try {
          do {
            var done = false,
              value;
            const firstResult = reader.readMany();

            if ($isPromise(firstResult)) {
              ({ done, value } = await firstResult);

              if (this.#closed) {
                this.#pendingChunks.push(...value);
                return;
              }
            } else {
              ({ done, value } = firstResult);
            }

            if (done) {
              this.#handleDone(reader);
              return;
            }

            if (!this.push(value[0])) {
              this.#pendingChunks = value.slice(1);
              return;
            }

            for (let i = 1, count = value.length; i < count; i++) {
              if (!this.push(value[i])) {
                this.#pendingChunks = value.slice(i + 1);
                return;
              }
            }
          } while (!this.#closed);
        } catch (e) {
          deferredError = e;
        } finally {
          if (deferredError) throw deferredError;
        }
      }

      _destroy(error, callback) {
        if (!this.#closed) {
          var reader = this.#reader;
          if (reader) {
            this.#reader = undefined;
            reader.cancel(error).finally(() => {
              this.#closed = true;
              callback(error);
            });
          }

          return;
        }
        try {
          callback(error);
        } catch (error) {
          globalThis.reportError(error);
        }
      }
    }

    _ReadableFromWebForUndici = ReadableFromWeb;

    /**
     * @param {ReadableStream} readableStream
     * @param {{
     *   highWaterMark? : number,
     *   encoding? : string,
     *   objectMode? : boolean,
     *   signal? : AbortSignal,
     * }} [options]
     * @returns {Readable}
     */
    function newStreamReadableFromReadableStream(readableStream, options = {}) {
      if (!isReadableStream(readableStream)) {
        throw new ERR_INVALID_ARG_TYPE("readableStream", "ReadableStream", readableStream);
      }

      validateObject(options, "options");
      const {
        highWaterMark,
        encoding,
        objectMode = false,
        signal,
        // native = true,
      } = options;

      if (encoding !== undefined && !Buffer.isEncoding(encoding))
        throw new ERR_INVALID_ARG_VALUE(encoding, "options.encoding");
      validateBoolean(objectMode, "options.objectMode");

      // validateBoolean(native, "options.native");

      // if (!native) {
      //   return new ReadableFromWeb(
      //     {
      //       highWaterMark,
      //       encoding,
      //       objectMode,
      //       signal,
      //     },
      //     readableStream,
      //   );
      // }

      const nativeStream = getNativeReadableStream(Readable, readableStream, options);

      return (
        nativeStream ||
        new ReadableFromWeb(
          {
            highWaterMark,
            encoding,
            objectMode,
            signal,
          },
          readableStream,
        )
      );
    }

    module.exports = Readable;
    _ReadableFromWeb = newStreamReadableFromReadableStream;

    var { addAbortSignal } = require_add_abort_signal();
    var eos = require_end_of_stream();
    function maybeReadMore(stream, state) {
      if (!state.readingMore && state.constructed) {
        state.readingMore = true;
        process.nextTick(maybeReadMore_, stream, state);
      }
    }
    function maybeReadMore_(stream, state) {
      // Attempt to read more data if we should.
      //
      // The conditions for reading more data are (one of):
      // - Not enough data buffered (state.length < state.highWaterMark). The loop
      //   is responsible for filling the buffer with enough data if such data
      //   is available. If highWaterMark is 0 and we are not in the flowing mode
      //   we should _not_ attempt to buffer any extra data. We'll get more data
      //   when the stream consumer calls read() instead.
      // - No data in the buffer, and the stream is in flowing mode. In this mode
      //   the loop below is responsible for ensuring read() is called. Failing to
      //   call read here would abort the flow and there's no other mechanism for
      //   continuing the flow if the stream consumer has just subscribed to the
      //   'data' event.
      //
      // In addition to the above conditions to keep reading data, the following
      // conditions prevent the data from being read:
      // - The stream has ended (state.ended).
      // - There is already a pending 'read' operation (state.reading). This is a
      //   case where the stream has called the implementation defined _read()
      //   method, but they are processing the call asynchronously and have _not_
      //   called push() with new data. In this case we skip performing more
      //   read()s. The execution ends in this method again after the _read() ends
      //   up calling push() with more data.
      while (
        !state.reading &&
        !state.ended &&
        (state.length < state.highWaterMark || (state.flowing && state.length === 0))
      ) {
        const len = state.length;
        $debug("maybeReadMore read 0");
        stream.read(0);
        if (len === state.length)
          // Didn't get any data, stop spinning.
          break;
      }
      state.readingMore = false;
    }
    // Don't emit readable right away in sync mode, because this can trigger
    // another read() call => stack overflow.  This way, it might trigger
    // a nextTick recursion warning, but that's not so bad.
    function emitReadable(stream) {
      const state = stream._readableState;
      $debug("emitReadable", state.needReadable, state.emittedReadable);
      state.needReadable = false;
      if (!state.emittedReadable) {
        $debug("emitReadable", state.flowing);
        state.emittedReadable = true;
        process.nextTick(emitReadable_, stream);
      }
    }
    function emitReadable_(stream) {
      const state = stream._readableState;
      $debug("emitReadable_", state.destroyed, state.length, state.ended);
      if (!state.destroyed && !state.errored && (state.length || state.ended)) {
        stream.emit("readable");
        state.emittedReadable = false;
      }

      // The stream needs another readable event if:
      // 1. It is not flowing, as the flow mechanism will take
      //    care of it.
      // 2. It is not ended.
      // 3. It is below the highWaterMark, so we can schedule
      //    another readable later.
      state.needReadable = !state.flowing && !state.ended && state.length <= state.highWaterMark;
      flow(stream);
    }
    function flow(stream) {
      const state = stream._readableState;
      $debug("flow", state.flowing);
      while (state.flowing && stream.read() !== null);
    }
    function onEofChunk(stream, state) {
      $debug("onEofChunk");
      if (state.ended) return;
      if (state.decoder) {
        const chunk = state.decoder.end();
        if (chunk && chunk.length) {
          state.buffer.push(chunk);
          state.length += state.objectMode ? 1 : chunk.length;
        }
      }
      state.ended = true;
      if (state.sync) {
        // If we are sync, wait until next tick to emit the data.
        // Otherwise we risk emitting data in the flow()
        // the readable code triggers during a read() call.
        emitReadable(stream);
      } else {
        // Emit 'readable' now to make sure it gets picked up.
        state.needReadable = false;
        state.emittedReadable = true;
        // We have to emit readable now that we are EOF. Modules
        // in the ecosystem (e.g. dicer) rely on this event being sync.
        emitReadable_(stream);
      }
    }
    function resume(stream, state) {
      if (!state.resumeScheduled) {
        state.resumeScheduled = true;
        process.nextTick(resume_, stream, state);
      }
    }
    function resume_(stream, state) {
      $debug("resume", state.reading);
      if (!state.reading) {
        stream.read(0);
      }
      state.resumeScheduled = false;
      stream.emit("resume");
      flow(stream);
      if (state.flowing && !state.reading) stream.read(0);
    }

    var destroyImpl = require_destroy();
    var {
      aggregateTwoErrors,
      codes: {
        ERR_INVALID_ARG_TYPE,
        ERR_METHOD_NOT_IMPLEMENTED,
        ERR_OUT_OF_RANGE,
        ERR_STREAM_PUSH_AFTER_EOF,
        ERR_STREAM_UNSHIFT_AFTER_END_EVENT,
      },
    } = require_errors();
    var { validateObject } = require_validators();
    var from = require_from();
    var nop = () => {};
    var { errorOrDestroy } = destroyImpl;

    Readable.prototype.destroy = destroyImpl.destroy;
    Readable.prototype._undestroy = destroyImpl.undestroy;
    Readable.prototype._destroy = function (err, cb) {
      cb(err);
    };
    Readable.prototype[EE.captureRejectionSymbol] = function (err) {
      this.destroy(err);
    };
    Readable.prototype.push = function (chunk, encoding) {
      return readableAddChunk(this, chunk, encoding, false);
    };
    Readable.prototype.unshift = function (chunk, encoding) {
      return readableAddChunk(this, chunk, encoding, true);
    };
    function readableAddChunk(stream, chunk, encoding, addToFront) {
      $debug("readableAddChunk", chunk, stream.__id);
      const state = stream._readableState;
      let err;
      if (!state.objectMode) {
        if (typeof chunk === "string") {
          encoding = encoding || state.defaultEncoding;
          if (state.encoding !== encoding) {
            if (addToFront && state.encoding) {
              chunk = Buffer.from(chunk, encoding).toString(state.encoding);
            } else {
              chunk = Buffer.from(chunk, encoding);
              encoding = "";
            }
          }
        } else if (chunk instanceof Buffer) {
          encoding = "";
        } else if (Stream._isUint8Array(chunk)) {
          if (addToFront || !state.decoder) {
            chunk = Stream._uint8ArrayToBuffer(chunk);
          }
          encoding = "";
        } else if (chunk != null) {
          err = new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
        }
      }
      if (err) {
        errorOrDestroy(stream, err);
      } else if (chunk === null) {
        state.reading = false;
        onEofChunk(stream, state);
      } else if (state.objectMode || (chunk && chunk.length > 0)) {
        if (addToFront) {
          if (state.endEmitted) errorOrDestroy(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT());
          else if (state.destroyed || state.errored) return false;
          else addChunk(stream, state, chunk, true);
        } else if (state.ended) {
          errorOrDestroy(stream, new ERR_STREAM_PUSH_AFTER_EOF());
        } else if (state.destroyed || state.errored) {
          return false;
        } else {
          state.reading = false;
          if (state.decoder && !encoding) {
            chunk = state.decoder.write(chunk);
            if (state.objectMode || chunk.length !== 0) addChunk(stream, state, chunk, false);
            else maybeReadMore(stream, state);
          } else {
            addChunk(stream, state, chunk, false);
          }
        }
      } else if (!addToFront) {
        state.reading = false;
        maybeReadMore(stream, state);
      }
      return !state.ended && (state.length < state.highWaterMark || state.length === 0);
    }
    function addChunk(stream, state, chunk, addToFront) {
      $debug("adding chunk", stream.__id);
      $debug("chunk", chunk.toString(), stream.__id);
      if (state.flowing && state.length === 0 && !state.sync && stream.listenerCount("data") > 0) {
        if (state.multiAwaitDrain) {
          state.awaitDrainWriters.clear();
        } else {
          state.awaitDrainWriters = null;
        }
        state.dataEmitted = true;
        stream.emit("data", chunk);
      } else {
        state.length += state.objectMode ? 1 : chunk.length;
        if (addToFront) state.buffer.unshift(chunk);
        else state.buffer.push(chunk);
        $debug("needReadable @ addChunk", state.needReadable, stream.__id);
        if (state.needReadable) emitReadable(stream, state);
      }
      $debug("about to maybereadmore");
      maybeReadMore(stream, state);
    }
    Readable.prototype.isPaused = function () {
      const state = this._readableState;
      return state.paused === true || state.flowing === false;
    };
    Readable.prototype.setEncoding = function (enc) {
      const decoder = new StringDecoder(enc);
      this._readableState.decoder = decoder;
      this._readableState.encoding = this._readableState.decoder.encoding;
      const buffer = this._readableState.buffer;
      let content = "";
      // BufferList does not support iterator now, and iterator is slow in JSC.
      // for (const data of buffer) {
      //   content += decoder.write(data);
      // }
      // buffer.clear();
      for (let i = buffer.length; i > 0; i--) {
        content += decoder.write(buffer.shift());
      }
      if (content !== "") buffer.push(content);
      this._readableState.length = content.length;
      return this;
    };
    var MAX_HWM = 1073741824;
    function computeNewHighWaterMark(n) {
      if (n > MAX_HWM) {
        throw new ERR_OUT_OF_RANGE("size", "<= 1GiB", n);
      } else {
        n--;
        n |= n >>> 1;
        n |= n >>> 2;
        n |= n >>> 4;
        n |= n >>> 8;
        n |= n >>> 16;
        n++;
      }
      return n;
    }
    function howMuchToRead(n, state) {
      if (n <= 0 || (state.length === 0 && state.ended)) return 0;
      if (state.objectMode) return 1;
      if (NumberIsNaN(n)) {
        if (state.flowing && state.length) return state.buffer.first().length;
        return state.length;
      }
      if (n <= state.length) return n;
      return state.ended ? state.length : 0;
    }
    // You can override either this method, or the async _read(n) below.
    Readable.prototype.read = function (n) {
      $debug("read - n =", n, this.__id);
      if (!NumberIsInteger(n)) {
        n = NumberParseInt(n, 10);
      }
      const state = this._readableState;
      const nOrig = n;

      // If we're asking for more than the current hwm, then raise the hwm.
      if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);

      if (n !== 0) state.emittedReadable = false;

      // If we're doing read(0) to trigger a readable event, but we
      // already have a bunch of data in the buffer, then just trigger
      // the 'readable' event and move on.
      if (
        n === 0 &&
        state.needReadable &&
        ((state.highWaterMark !== 0 ? state.length >= state.highWaterMark : state.length > 0) || state.ended)
      ) {
        $debug("read: emitReadable or endReadable", state.length, state.ended, this.__id);
        if (state.length === 0 && state.ended) endReadable(this);
        else emitReadable(this, state);
        return null;
      }

      n = howMuchToRead(n, state);

      // If we've ended, and we're now clear, then finish it up.
      if (n === 0 && state.ended) {
        $debug("read: calling endReadable if length 0 -- length, state.ended", state.length, state.ended, this.__id);
        if (state.length === 0) endReadable(this);
        return null;
      }

      // All the actual chunk generation logic needs to be
      // *below* the call to _read.  The reason is that in certain
      // synthetic stream cases, such as passthrough streams, _read
      // may be a completely synchronous operation which may change
      // the state of the read buffer, providing enough data when
      // before there was *not* enough.
      //
      // So, the steps are:
      // 1. Figure out what the state of things will be after we do
      // a read from the buffer.
      //
      // 2. If that resulting state will trigger a _read, then call _read.
      // Note that this may be asynchronous, or synchronous.  Yes, it is
      // deeply ugly to write APIs this way, but that still doesn't mean
      // that the Readable class should behave improperly, as streams are
      // designed to be sync/async agnostic.
      // Take note if the _read call is sync or async (ie, if the read call
      // has returned yet), so that we know whether or not it's safe to emit
      // 'readable' etc.
      //
      // 3. Actually pull the requested chunks out of the buffer and return.

      // if we need a readable event, then we need to do some reading.
      let doRead = state.needReadable;
      $debug("need readable", doRead, this.__id);

      // If we currently have less than the highWaterMark, then also read some.
      if (state.length === 0 || state.length - n < state.highWaterMark) {
        doRead = true;
        $debug("length less than watermark", doRead, this.__id);
      }

      // However, if we've ended, then there's no point, if we're already
      // reading, then it's unnecessary, if we're constructing we have to wait,
      // and if we're destroyed or errored, then it's not allowed,
      if (state.ended || state.reading || state.destroyed || state.errored || !state.constructed) {
        $debug("state.constructed?", state.constructed, this.__id);
        doRead = false;
        $debug("reading, ended or constructing", doRead, this.__id);
      } else if (doRead) {
        $debug("do read", this.__id);
        state.reading = true;
        state.sync = true;
        // If the length is currently zero, then we *need* a readable event.
        if (state.length === 0) state.needReadable = true;

        // Call internal read method
        try {
          var result = this._read(state.highWaterMark);
          if ($isPromise(result)) {
            $debug("async _read", this.__id);
            const peeked = Bun.peek(result);
            $debug("peeked promise", peeked, this.__id);
            if (peeked !== result) {
              result = peeked;
            }
          }

          if ($isPromise(result) && result?.then && $isCallable(result.then)) {
            $debug("async _read result.then setup", this.__id);
            result.then(nop, function (err) {
              errorOrDestroy(this, err);
            });
          }
        } catch (err) {
          errorOrDestroy(this, err);
        }

        state.sync = false;
        // If _read pushed data synchronously, then `reading` will be false,
        // and we need to re-evaluate how much data we can return to the user.
        if (!state.reading) n = howMuchToRead(nOrig, state);
      }

      $debug("n @ fromList", n, this.__id);
      let ret;
      if (n > 0) ret = fromList(n, state);
      else ret = null;

      $debug("ret @ read", ret, this.__id);

      if (ret === null) {
        state.needReadable = state.length <= state.highWaterMark;
        $debug("state.length while ret = null", state.length, this.__id);
        n = 0;
      } else {
        state.length -= n;
        if (state.multiAwaitDrain) {
          state.awaitDrainWriters.clear();
        } else {
          state.awaitDrainWriters = null;
        }
      }

      if (state.length === 0) {
        // If we have nothing in the buffer, then we want to know
        // as soon as we *do* get something into the buffer.
        if (!state.ended) state.needReadable = true;

        // If we tried to read() past the EOF, then emit end on the next tick.
        if (nOrig !== n && state.ended) endReadable(this);
      }

      if (ret !== null && !state.errorEmitted && !state.closeEmitted) {
        state.dataEmitted = true;
        this.emit("data", ret);
      }

      return ret;
    };
    Readable.prototype._read = function (n) {
      throw new ERR_METHOD_NOT_IMPLEMENTED("_read()");
    };
    Readable.prototype.pipe = function (dest, pipeOpts) {
      const src = this;
      const state = this._readableState;
      if (state.pipes.length === 1) {
        if (!state.multiAwaitDrain) {
          state.multiAwaitDrain = true;
          state.awaitDrainWriters = new SafeSet(state.awaitDrainWriters ? [state.awaitDrainWriters] : []);
        }
      }
      state.pipes.push(dest);
      $debug("pipe count=%d opts=%j", state.pipes.length, pipeOpts, src.__id);
      const doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;
      const endFn = doEnd ? onend : unpipe;
      if (state.endEmitted) runOnNextTick(endFn);
      else src.once("end", endFn);
      dest.on("unpipe", onunpipe);
      function onunpipe(readable, unpipeInfo) {
        $debug("onunpipe", src.__id);
        if (readable === src) {
          if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
            unpipeInfo.hasUnpiped = true;
            cleanup();
          }
        }
      }
      function onend() {
        $debug("onend", src.__id);
        dest.end();
      }
      let ondrain;
      let cleanedUp = false;
      function cleanup() {
        $debug("cleanup", src.__id);
        dest.removeListener("close", onclose);
        dest.removeListener("finish", onfinish);
        if (ondrain) {
          dest.removeListener("drain", ondrain);
        }
        dest.removeListener("error", onerror);
        dest.removeListener("unpipe", onunpipe);
        src.removeListener("end", onend);
        src.removeListener("end", unpipe);
        src.removeListener("data", ondata);
        cleanedUp = true;
        if (ondrain && state.awaitDrainWriters && (!dest._writableState || dest._writableState.needDrain)) ondrain();
      }
      function pause() {
        if (!cleanedUp) {
          if (state.pipes.length === 1 && state.pipes[0] === dest) {
            $debug("false write response, pause", 0, src.__id);
            state.awaitDrainWriters = dest;
            state.multiAwaitDrain = false;
          } else if (state.pipes.length > 1 && state.pipes.includes(dest)) {
            $debug("false write response, pause", state.awaitDrainWriters.size, src.__id);
            state.awaitDrainWriters.add(dest);
          }
          src.pause();
        }
        if (!ondrain) {
          ondrain = pipeOnDrain(src, dest);
          dest.on("drain", ondrain);
        }
      }
      src.on("data", ondata);
      function ondata(chunk) {
        $debug("ondata", src.__id);
        const ret = dest.write(chunk);
        $debug("dest.write", ret, src.__id);
        if (ret === false) {
          pause();
        }
      }
      function onerror(er) {
        $debug("onerror", er);
        unpipe();
        dest.removeListener("error", onerror);
        if (dest.listenerCount("error") === 0) {
          const s = dest._writableState || dest._readableState;
          if (s && !s.errorEmitted) {
            errorOrDestroy(dest, er);
          } else {
            dest.emit("error", er);
          }
        }
      }
      prependListener(dest, "error", onerror);
      function onclose() {
        dest.removeListener("finish", onfinish);
        unpipe();
      }
      dest.once("close", onclose);
      function onfinish() {
        $debug("onfinish");
        dest.removeListener("close", onclose);
        unpipe();
      }
      dest.once("finish", onfinish);
      function unpipe() {
        $debug("unpipe");
        src.unpipe(dest);
      }
      dest.emit("pipe", src);
      if (dest.writableNeedDrain === true) {
        if (state.flowing) {
          pause();
        }
      } else if (!state.flowing) {
        $debug("pipe resume");
        src.resume();
      }
      return dest;
    };
    function pipeOnDrain(src, dest) {
      return function pipeOnDrainFunctionResult() {
        const state = src._readableState;
        if (state.awaitDrainWriters === dest) {
          $debug("pipeOnDrain", 1);
          state.awaitDrainWriters = null;
        } else if (state.multiAwaitDrain) {
          $debug("pipeOnDrain", state.awaitDrainWriters.size);
          state.awaitDrainWriters.delete(dest);
        }
        if ((!state.awaitDrainWriters || state.awaitDrainWriters.size === 0) && src.listenerCount("data")) {
          src.resume();
        }
      };
    }
    Readable.prototype.unpipe = function (dest) {
      const state = this._readableState;
      const unpipeInfo = {
        hasUnpiped: false,
      };
      if (state.pipes.length === 0) return this;
      if (!dest) {
        const dests = state.pipes;
        state.pipes = [];
        this.pause();
        for (let i = 0; i < dests.length; i++)
          dests[i].emit("unpipe", this, {
            hasUnpiped: false,
          });
        return this;
      }
      const index = ArrayPrototypeIndexOf(state.pipes, dest);
      if (index === -1) return this;
      state.pipes.splice(index, 1);
      if (state.pipes.length === 0) this.pause();
      dest.emit("unpipe", this, unpipeInfo);
      return this;
    };
    Readable.prototype.addListener = Readable.prototype.on;
    Readable.prototype.removeListener = function (ev, fn) {
      const res = Stream.prototype.removeListener.call(this, ev, fn);
      if (ev === "readable") {
        runOnNextTick(updateReadableListening, this);
      }
      return res;
    };
    Readable.prototype.off = Readable.prototype.removeListener;
    Readable.prototype.removeAllListeners = function (ev) {
      const res = Stream.prototype.removeAllListeners.apply(this, arguments);
      if (ev === "readable" || ev === void 0) {
        runOnNextTick(updateReadableListening, this);
      }
      return res;
    };
    function updateReadableListening(self) {
      const state = self._readableState;
      state.readableListening = self.listenerCount("readable") > 0;
      if (state.resumeScheduled && state.paused === false) {
        state.flowing = true;
      } else if (self.listenerCount("data") > 0) {
        self.resume();
      } else if (!state.readableListening) {
        state.flowing = null;
      }
    }
    function nReadingNextTick(self) {
      $debug("on readable nextTick, calling read(0)", self.__id);
      self.read(0);
    }
    Readable.prototype.resume = function () {
      const state = this._readableState;
      if (!state.flowing) {
        $debug("resume", this.__id);
        state.flowing = !state.readableListening;
        resume(this, state);
      }
      state.paused = false;
      return this;
    };
    Readable.prototype.pause = function () {
      $debug("call pause flowing=%j", this._readableState.flowing, this.__id);
      if (this._readableState.flowing !== false) {
        $debug("pause", this.__id);
        this._readableState.flowing = false;
        this.emit("pause");
      }
      this._readableState.paused = true;
      return this;
    };
    Readable.prototype.wrap = function (stream) {
      let paused = false;
      stream.on("data", chunk => {
        if (!this.push(chunk) && stream.pause) {
          paused = true;
          stream.pause();
        }
      });
      stream.on("end", () => {
        this.push(null);
      });
      stream.on("error", err => {
        errorOrDestroy(this, err);
      });
      stream.on("close", () => {
        this.destroy();
      });
      stream.on("destroy", () => {
        this.destroy();
      });
      this._read = () => {
        if (paused && stream.resume) {
          paused = false;
          stream.resume();
        }
      };
      const streamKeys = ObjectKeys(stream);
      for (let j = 1; j < streamKeys.length; j++) {
        const i = streamKeys[j];
        if (this[i] === void 0 && typeof stream[i] === "function") {
          this[i] = stream[i].bind(stream);
        }
      }
      return this;
    };
    Readable.prototype[SymbolAsyncIterator] = function () {
      return streamToAsyncIterator(this);
    };
    Readable.prototype.iterator = function (options) {
      if (options !== void 0) {
        validateObject(options, "options");
      }
      return streamToAsyncIterator(this, options);
    };
    function streamToAsyncIterator(stream, options) {
      if (typeof stream.read !== "function") {
        stream = Readable.wrap(stream, {
          objectMode: true,
        });
      }
      const iter = createAsyncIterator(stream, options);
      iter.stream = stream;
      return iter;
    }
    async function* createAsyncIterator(stream, options) {
      let callback = nop;
      function next(resolve) {
        if (this === stream) {
          callback();
          callback = nop;
        } else {
          callback = resolve;
        }
      }
      stream.on("readable", next);
      let error;
      const cleanup = eos(
        stream,
        {
          writable: false,
        },
        err => {
          error = err ? aggregateTwoErrors(error, err) : null;
          callback();
          callback = nop;
        },
      );
      try {
        while (true) {
          const chunk = stream.destroyed ? null : stream.read();
          if (chunk !== null) {
            yield chunk;
          } else if (error) {
            throw error;
          } else if (error === null) {
            return;
          } else {
            await new Promise2(next);
          }
        }
      } catch (err) {
        error = aggregateTwoErrors(error, err);
        throw error;
      } finally {
        if (
          (error || (options === null || options === void 0 ? void 0 : options.destroyOnReturn) !== false) &&
          (error === void 0 || stream._readableState.autoDestroy)
        ) {
          destroyImpl.destroyer(stream, null);
        } else {
          stream.off("readable", next);
          cleanup();
        }
      }
    }
    ObjectDefineProperties(Readable.prototype, {
      readable: {
        get() {
          const r = this._readableState;
          return !!r && r.readable !== false && !r.destroyed && !r.errorEmitted && !r.endEmitted;
        },
        set(val) {
          if (this._readableState) {
            this._readableState.readable = !!val;
          }
        },
      },
      readableDidRead: {
        enumerable: false,
        get: function () {
          return this._readableState.dataEmitted;
        },
      },
      readableAborted: {
        enumerable: false,
        get: function () {
          return !!(
            this._readableState.readable !== false &&
            (this._readableState.destroyed || this._readableState.errored) &&
            !this._readableState.endEmitted
          );
        },
      },
      readableHighWaterMark: {
        enumerable: false,
        get: function () {
          return this._readableState.highWaterMark;
        },
      },
      readableBuffer: {
        enumerable: false,
        get: function () {
          return this._readableState && this._readableState.buffer;
        },
      },
      readableFlowing: {
        enumerable: false,
        get: function () {
          return this._readableState.flowing;
        },
        set: function (state) {
          if (this._readableState) {
            this._readableState.flowing = state;
          }
        },
      },
      readableLength: {
        enumerable: false,
        get() {
          return this._readableState.length;
        },
      },
      readableObjectMode: {
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.objectMode : false;
        },
      },
      readableEncoding: {
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.encoding : null;
        },
      },
      errored: {
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.errored : null;
        },
      },
      closed: {
        get() {
          return this._readableState ? this._readableState.closed : false;
        },
      },
      destroyed: {
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.destroyed : false;
        },
        set(value) {
          if (!this._readableState) {
            return;
          }
          this._readableState.destroyed = value;
        },
      },
      readableEnded: {
        enumerable: false,
        get() {
          return this._readableState ? this._readableState.endEmitted : false;
        },
      },
    });
    Readable._fromList = fromList;
    function fromList(n, state) {
      if (state.length === 0) return null;
      let ret;
      if (state.objectMode) ret = state.buffer.shift();
      else if (!n || n >= state.length) {
        if (state.decoder) ret = state.buffer.join("");
        else if (state.buffer.length === 1) ret = state.buffer.first();
        else ret = state.buffer.concat(state.length);
        state.buffer.clear();
      } else {
        ret = state.buffer.consume(n, state.decoder);
      }
      return ret;
    }
    function endReadable(stream) {
      const state = stream._readableState;
      $debug("endEmitted @ endReadable", state.endEmitted, stream.__id);
      if (!state.endEmitted) {
        state.ended = true;
        runOnNextTick(endReadableNT, state, stream);
      }
    }
    function endReadableNT(state, stream) {
      $debug("endReadableNT -- endEmitted, state.length", state.endEmitted, state.length, stream.__id);
      if (!state.errored && !state.closeEmitted && !state.endEmitted && state.length === 0) {
        state.endEmitted = true;
        stream.emit("end");
        $debug("end emitted @ endReadableNT", stream.__id);
        if (stream.writable && stream.allowHalfOpen === false) {
          runOnNextTick(endWritableNT, stream);
        } else if (state.autoDestroy) {
          const wState = stream._writableState;
          const autoDestroy = !wState || (wState.autoDestroy && (wState.finished || wState.writable === false));
          if (autoDestroy) {
            stream.destroy();
          }
        }
      }
    }
    function endWritableNT(stream) {
      const writable = stream.writable && !stream.writableEnded && !stream.destroyed;
      if (writable) {
        stream.end();
      }
    }
    Readable.from = function (iterable, opts) {
      return from(Readable, iterable, opts);
    };
    var webStreamsAdapters = {
      newStreamReadableFromReadableStream,

      newReadableStreamFromStreamReadable(streamReadable, options = {}) {
        // Not using the internal/streams/utils isReadableNodeStream utility
        // here because it will return false if streamReadable is a Duplex
        // whose readable option is false. For a Duplex that is not readable,
        // we want it to pass this check but return a closed ReadableStream.
        if (typeof streamReadable?._readableState !== "object") {
          throw new ERR_INVALID_ARG_TYPE("streamReadable", "stream.Readable", streamReadable);
        }
        var { isDestroyed, isReadable } = require_utils();

        if (isDestroyed(streamReadable) || !isReadable(streamReadable)) {
          const readable = new ReadableStream();
          readable.cancel();
          return readable;
        }

        const objectMode = streamReadable.readableObjectMode;
        const highWaterMark = streamReadable.readableHighWaterMark;

        const evaluateStrategyOrFallback = strategy => {
          // If there is a strategy available, use it
          if (strategy) return strategy;

          if (objectMode) {
            // When running in objectMode explicitly but no strategy, we just fall
            // back to CountQueuingStrategy
            return new CountQueuingStrategy({ highWaterMark });
          }

          // When not running in objectMode explicitly, we just fall
          // back to a minimal strategy that just specifies the highWaterMark
          // and no size algorithm. Using a ByteLengthQueuingStrategy here
          // is unnecessary.
          return { highWaterMark };
        };

        const strategy = evaluateStrategyOrFallback(options?.strategy);

        let controller;

        function onData(chunk) {
          controller.enqueue(chunk);
          if (controller.desiredSize <= 0) streamReadable.pause();
        }

        streamReadable.pause();

        const cleanup = eos(streamReadable, error => {
          if (error?.code === "ERR_STREAM_PREMATURE_CLOSE") {
            const err = new AbortError(undefined, { cause: error });
            error = err;
          }

          cleanup();
          // This is a protection against non-standard, legacy streams
          // that happen to emit an error event again after finished is called.
          streamReadable.on("error", () => {});
          if (error) return controller.error(error);
          controller.close();
        });

        streamReadable.on("data", onData);

        return new ReadableStream(
          {
            start(c) {
              controller = c;
            },

            pull() {
              streamReadable.resume();
            },

            cancel(reason) {
              destroy(streamReadable, reason);
            },
          },
          strategy,
        );
      },
    };

    Readable.fromWeb = function (readableStream, options) {
      return webStreamsAdapters.newStreamReadableFromReadableStream(readableStream, options);
    };
    Readable.toWeb = function (streamReadable, options) {
      return webStreamsAdapters.newReadableStreamFromStreamReadable(streamReadable, options);
    };
    Readable.wrap = function (src, options) {
      var _ref, _src$readableObjectMo;
      return new Readable({
        objectMode:
          (_ref =
            (_src$readableObjectMo = src.readableObjectMode) !== null && _src$readableObjectMo !== void 0
              ? _src$readableObjectMo
              : src.objectMode) !== null && _ref !== void 0
            ? _ref
            : true,
        ...options,
        destroy(err, callback) {
          destroyImpl.destroyer(src, err);
          callback(err);
        },
      }).wrap(src);
    };
  },
});

// node_modules/readable-stream/lib/internal/streams/writable.js
var require_writable = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/writable.js"(exports, module) {
    "use strict";
    var {
      ArrayPrototypeSlice,
      Error: Error2,
      FunctionPrototypeSymbolHasInstance,
      ObjectDefineProperty,
      ObjectDefineProperties,
      ObjectSetPrototypeOf,
      StringPrototypeToLowerCase,
      Symbol: Symbol2,
      SymbolHasInstance,
    } = require_primordials();

    var Stream = require_legacy().Stream;
    var destroyImpl = require_destroy();
    var { addAbortSignal } = require_add_abort_signal();
    var { getHighWaterMark, getDefaultHighWaterMark } = require_state();
    var {
      ERR_INVALID_ARG_TYPE,
      ERR_METHOD_NOT_IMPLEMENTED,
      ERR_MULTIPLE_CALLBACK,
      ERR_STREAM_CANNOT_PIPE,
      ERR_STREAM_DESTROYED,
      ERR_STREAM_ALREADY_FINISHED,
      ERR_STREAM_NULL_VALUES,
      ERR_STREAM_WRITE_AFTER_END,
      ERR_UNKNOWN_ENCODING,
    } = require_errors().codes;
    var { errorOrDestroy } = destroyImpl;

    function Writable(options = {}) {
      const isDuplex = this instanceof require_duplex();
      if (!isDuplex && !FunctionPrototypeSymbolHasInstance(Writable, this)) return new Writable(options);
      this._writableState = new WritableState(options, this, isDuplex);
      if (options) {
        if (typeof options.write === "function") this._write = options.write;
        if (typeof options.writev === "function") this._writev = options.writev;
        if (typeof options.destroy === "function") this._destroy = options.destroy;
        if (typeof options.final === "function") this._final = options.final;
        if (typeof options.construct === "function") this._construct = options.construct;
        if (options.signal) addAbortSignal(options.signal, this);
      }
      Stream.call(this, options);

      destroyImpl.construct(this, () => {
        const state = this._writableState;
        if (!state.writing) {
          clearBuffer(this, state);
        }
        finishMaybe(this, state);
      });
    }
    Writable.prototype = {};
    ObjectSetPrototypeOf(Writable.prototype, Stream.prototype);
    ObjectSetPrototypeOf(Writable, Stream);
    module.exports = Writable;

    function nop() {}
    var kOnFinished = Symbol2("kOnFinished");
    function WritableState(options, stream, isDuplex) {
      if (typeof isDuplex !== "boolean") isDuplex = stream instanceof require_duplex();
      this.objectMode = !!(options && options.objectMode);
      if (isDuplex) this.objectMode = this.objectMode || !!(options && options.writableObjectMode);
      this.highWaterMark = options
        ? getHighWaterMark(this, options, "writableHighWaterMark", isDuplex)
        : getDefaultHighWaterMark(false);
      this.finalCalled = false;
      this.needDrain = false;
      this.ending = false;
      this.ended = false;
      this.finished = false;
      this.destroyed = false;
      const noDecode = !!(options && options.decodeStrings === false);
      this.decodeStrings = !noDecode;
      this.defaultEncoding = (options && options.defaultEncoding) || "utf8";
      this.length = 0;
      this.writing = false;
      this.corked = 0;
      this.sync = true;
      this.bufferProcessing = false;
      this.onwrite = onwrite.bind(void 0, stream);
      this.writecb = null;
      this.writelen = 0;
      this.afterWriteTickInfo = null;
      resetBuffer(this);
      this.pendingcb = 0;
      this.constructed = true;
      this.prefinished = false;
      this.errorEmitted = false;
      this.emitClose = !options || options.emitClose !== false;
      this.autoDestroy = !options || options.autoDestroy !== false;
      this.errored = null;
      this.closed = false;
      this.closeEmitted = false;
      this[kOnFinished] = [];
    }
    WritableState.prototype = {};
    function resetBuffer(state) {
      state.buffered = [];
      state.bufferedIndex = 0;
      state.allBuffers = true;
      state.allNoop = true;
    }
    WritableState.prototype.getBuffer = function getBuffer() {
      return ArrayPrototypeSlice(this.buffered, this.bufferedIndex);
    };
    ObjectDefineProperty(WritableState.prototype, "bufferedRequestCount", {
      get() {
        return this.buffered.length - this.bufferedIndex;
      },
    });

    ObjectDefineProperty(Writable, SymbolHasInstance, {
      value: function (object) {
        if (FunctionPrototypeSymbolHasInstance(this, object)) return true;
        if (this !== Writable) return false;
        return object && object._writableState instanceof WritableState;
      },
    });
    Writable.prototype.pipe = function () {
      errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE());
    };
    function _write(stream, chunk, encoding, cb) {
      const state = stream._writableState;
      if (typeof encoding === "function") {
        cb = encoding;
        encoding = state.defaultEncoding;
      } else {
        if (!encoding) encoding = state.defaultEncoding;
        else if (encoding !== "buffer" && !Buffer.isEncoding(encoding)) throw new ERR_UNKNOWN_ENCODING(encoding);
        if (typeof cb !== "function") cb = nop;
      }
      if (chunk === null) {
        throw new ERR_STREAM_NULL_VALUES();
      } else if (!state.objectMode) {
        if (typeof chunk === "string") {
          if (state.decodeStrings !== false) {
            chunk = Buffer.from(chunk, encoding);
            encoding = "buffer";
          }
        } else if (chunk instanceof Buffer) {
          encoding = "buffer";
        } else if (Stream._isUint8Array(chunk)) {
          chunk = Stream._uint8ArrayToBuffer(chunk);
          encoding = "buffer";
        } else {
          throw new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
        }
      }
      let err;
      if (state.ending) {
        err = new ERR_STREAM_WRITE_AFTER_END();
      } else if (state.destroyed) {
        err = new ERR_STREAM_DESTROYED("write");
      }
      if (err) {
        runOnNextTick(cb, err);
        errorOrDestroy(stream, err, true);
        return err;
      }
      state.pendingcb++;
      return writeOrBuffer(stream, state, chunk, encoding, cb);
    }
    Writable.prototype.write = function (chunk, encoding, cb) {
      return _write(this, chunk, encoding, cb) === true;
    };
    Writable.prototype.cork = function () {
      this._writableState.corked++;
    };
    Writable.prototype.uncork = function () {
      const state = this._writableState;
      if (state.corked) {
        state.corked--;
        if (!state.writing) clearBuffer(this, state);
      }
    };
    Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
      if (typeof encoding === "string") encoding = StringPrototypeToLowerCase(encoding);
      if (!Buffer.isEncoding(encoding)) throw new ERR_UNKNOWN_ENCODING(encoding);
      this._writableState.defaultEncoding = encoding;
      return this;
    };
    function writeOrBuffer(stream, state, chunk, encoding, callback) {
      const len = state.objectMode ? 1 : chunk.length;
      state.length += len;
      const ret = state.length < state.highWaterMark;
      if (!ret) state.needDrain = true;
      if (state.writing || state.corked || state.errored || !state.constructed) {
        state.buffered.push({
          chunk,
          encoding,
          callback,
        });
        if (state.allBuffers && encoding !== "buffer") {
          state.allBuffers = false;
        }
        if (state.allNoop && callback !== nop) {
          state.allNoop = false;
        }
      } else {
        state.writelen = len;
        state.writecb = callback;
        state.writing = true;
        state.sync = true;
        stream._write(chunk, encoding, state.onwrite);
        state.sync = false;
      }
      return ret && !state.errored && !state.destroyed;
    }
    function doWrite(stream, state, writev, len, chunk, encoding, cb) {
      state.writelen = len;
      state.writecb = cb;
      state.writing = true;
      state.sync = true;
      if (state.destroyed) state.onwrite(new ERR_STREAM_DESTROYED("write"));
      else if (writev) stream._writev(chunk, state.onwrite);
      else stream._write(chunk, encoding, state.onwrite);
      state.sync = false;
    }
    function onwriteError(stream, state, er, cb) {
      --state.pendingcb;
      cb(er);
      errorBuffer(state);
      errorOrDestroy(stream, er);
    }
    function onwrite(stream, er) {
      const state = stream._writableState;
      const sync = state.sync;
      const cb = state.writecb;
      if (typeof cb !== "function") {
        errorOrDestroy(stream, new ERR_MULTIPLE_CALLBACK());
        return;
      }
      state.writing = false;
      state.writecb = null;
      state.length -= state.writelen;
      state.writelen = 0;
      if (er) {
        Error.captureStackTrace(er);
        if (!state.errored) {
          state.errored = er;
        }
        if (stream._readableState && !stream._readableState.errored) {
          stream._readableState.errored = er;
        }
        if (sync) {
          runOnNextTick(onwriteError, stream, state, er, cb);
        } else {
          onwriteError(stream, state, er, cb);
        }
      } else {
        if (state.buffered.length > state.bufferedIndex) {
          clearBuffer(stream, state);
        }
        if (sync) {
          if (state.afterWriteTickInfo !== null && state.afterWriteTickInfo.cb === cb) {
            state.afterWriteTickInfo.count++;
          } else {
            state.afterWriteTickInfo = {
              count: 1,
              cb,
              stream,
              state,
            };
            runOnNextTick(afterWriteTick, state.afterWriteTickInfo);
          }
        } else {
          afterWrite(stream, state, 1, cb);
        }
      }
    }
    function afterWriteTick({ stream, state, count, cb }) {
      state.afterWriteTickInfo = null;
      return afterWrite(stream, state, count, cb);
    }
    function afterWrite(stream, state, count, cb) {
      const needDrain = !state.ending && !stream.destroyed && state.length === 0 && state.needDrain;
      if (needDrain) {
        state.needDrain = false;
        stream.emit("drain");
      }
      while (count-- > 0) {
        state.pendingcb--;
        cb();
      }
      if (state.destroyed) {
        errorBuffer(state);
      }
      finishMaybe(stream, state);
    }
    function errorBuffer(state) {
      if (state.writing) {
        return;
      }
      for (let n = state.bufferedIndex; n < state.buffered.length; ++n) {
        var _state$errored;
        const { chunk, callback } = state.buffered[n];
        const len = state.objectMode ? 1 : chunk.length;
        state.length -= len;
        callback(
          (_state$errored = state.errored) !== null && _state$errored !== void 0
            ? _state$errored
            : new ERR_STREAM_DESTROYED("write"),
        );
      }
      const onfinishCallbacks = state[kOnFinished].splice(0);
      for (let i = 0; i < onfinishCallbacks.length; i++) {
        var _state$errored2;
        onfinishCallbacks[i](
          (_state$errored2 = state.errored) !== null && _state$errored2 !== void 0
            ? _state$errored2
            : new ERR_STREAM_DESTROYED("end"),
        );
      }
      resetBuffer(state);
    }
    function clearBuffer(stream, state) {
      if (state.corked || state.bufferProcessing || state.destroyed || !state.constructed) {
        return;
      }
      const { buffered, bufferedIndex, objectMode } = state;
      const bufferedLength = buffered.length - bufferedIndex;
      if (!bufferedLength) {
        return;
      }
      let i = bufferedIndex;
      state.bufferProcessing = true;
      if (bufferedLength > 1 && stream._writev) {
        state.pendingcb -= bufferedLength - 1;
        const callback = state.allNoop
          ? nop
          : err => {
              for (let n = i; n < buffered.length; ++n) {
                buffered[n].callback(err);
              }
            };
        const chunks = state.allNoop && i === 0 ? buffered : ArrayPrototypeSlice(buffered, i);
        chunks.allBuffers = state.allBuffers;
        doWrite(stream, state, true, state.length, chunks, "", callback);
        resetBuffer(state);
      } else {
        do {
          const { chunk, encoding, callback } = buffered[i];
          buffered[i++] = null;
          const len = objectMode ? 1 : chunk.length;
          doWrite(stream, state, false, len, chunk, encoding, callback);
        } while (i < buffered.length && !state.writing);
        if (i === buffered.length) {
          resetBuffer(state);
        } else if (i > 256) {
          buffered.splice(0, i);
          state.bufferedIndex = 0;
        } else {
          state.bufferedIndex = i;
        }
      }
      state.bufferProcessing = false;
    }
    Writable.prototype._write = function (chunk, encoding, cb) {
      if (this._writev) {
        this._writev(
          [
            {
              chunk,
              encoding,
            },
          ],
          cb,
        );
      } else {
        throw new ERR_METHOD_NOT_IMPLEMENTED("_write()");
      }
    };
    Writable.prototype._writev = null;
    Writable.prototype.end = function (chunk, encoding, cb, native = false) {
      const state = this._writableState;
      $debug("end", state, this.__id);
      if (typeof chunk === "function") {
        cb = chunk;
        chunk = null;
        encoding = null;
      } else if (typeof encoding === "function") {
        cb = encoding;
        encoding = null;
      }
      let err;
      if (chunk !== null && chunk !== void 0) {
        let ret;
        if (!native) {
          ret = _write(this, chunk, encoding);
        } else {
          ret = this.write(chunk, encoding);
        }
        if (ret instanceof Error2) {
          err = ret;
        }
      }
      if (state.corked) {
        state.corked = 1;
        this.uncork();
      }
      if (err) {
        this.emit("error", err);
      } else if (!state.errored && !state.ending) {
        state.ending = true;
        finishMaybe(this, state, true);
        state.ended = true;
      } else if (state.finished) {
        err = new ERR_STREAM_ALREADY_FINISHED("end");
      } else if (state.destroyed) {
        err = new ERR_STREAM_DESTROYED("end");
      }
      if (typeof cb === "function") {
        if (err || state.finished) {
          runOnNextTick(cb, err);
        } else {
          state[kOnFinished].push(cb);
        }
      }
      return this;
    };
    function needFinish(state, tag) {
      var needFinish =
        state.ending &&
        !state.destroyed &&
        state.constructed &&
        state.length === 0 &&
        !state.errored &&
        state.buffered.length === 0 &&
        !state.finished &&
        !state.writing &&
        !state.errorEmitted &&
        !state.closeEmitted;
      $debug("needFinish", needFinish, tag);
      return needFinish;
    }
    function callFinal(stream, state) {
      let called = false;
      function onFinish(err) {
        if (called) {
          errorOrDestroy(stream, err !== null && err !== void 0 ? err : ERR_MULTIPLE_CALLBACK());
          return;
        }
        called = true;
        state.pendingcb--;
        if (err) {
          const onfinishCallbacks = state[kOnFinished].splice(0);
          for (let i = 0; i < onfinishCallbacks.length; i++) {
            onfinishCallbacks[i](err);
          }
          errorOrDestroy(stream, err, state.sync);
        } else if (needFinish(state)) {
          state.prefinished = true;
          stream.emit("prefinish");
          state.pendingcb++;
          runOnNextTick(finish, stream, state);
        }
      }
      state.sync = true;
      state.pendingcb++;
      try {
        stream._final(onFinish);
      } catch (err) {
        onFinish(err);
      }
      state.sync = false;
    }
    function prefinish(stream, state) {
      if (!state.prefinished && !state.finalCalled) {
        if (typeof stream._final === "function" && !state.destroyed) {
          state.finalCalled = true;
          callFinal(stream, state);
        } else {
          state.prefinished = true;
          stream.emit("prefinish");
        }
      }
    }
    function finishMaybe(stream, state, sync) {
      $debug("finishMaybe -- state, sync", state, sync, stream.__id);

      if (!needFinish(state, stream.__id)) return;

      prefinish(stream, state);
      if (state.pendingcb === 0) {
        if (sync) {
          state.pendingcb++;
          runOnNextTick(
            (stream2, state2) => {
              if (needFinish(state2)) {
                finish(stream2, state2);
              } else {
                state2.pendingcb--;
              }
            },
            stream,
            state,
          );
        } else if (needFinish(state)) {
          state.pendingcb++;
          finish(stream, state);
        }
      }
    }
    function finish(stream, state) {
      state.pendingcb--;
      state.finished = true;
      const onfinishCallbacks = state[kOnFinished].splice(0);
      for (let i = 0; i < onfinishCallbacks.length; i++) {
        onfinishCallbacks[i]();
      }
      stream.emit("finish");
      if (state.autoDestroy) {
        const rState = stream._readableState;
        const autoDestroy = !rState || (rState.autoDestroy && (rState.endEmitted || rState.readable === false));
        if (autoDestroy) {
          stream.destroy();
        }
      }
    }
    ObjectDefineProperties(Writable.prototype, {
      closed: {
        get() {
          return this._writableState ? this._writableState.closed : false;
        },
      },
      destroyed: {
        get() {
          return this._writableState ? this._writableState.destroyed : false;
        },
        set(value) {
          if (this._writableState) {
            this._writableState.destroyed = value;
          }
        },
      },
      writable: {
        get() {
          const w = this._writableState;
          return !!w && w.writable !== false && !w.destroyed && !w.errored && !w.ending && !w.ended;
        },
        set(val) {
          if (this._writableState) {
            this._writableState.writable = !!val;
          }
        },
      },
      writableFinished: {
        get() {
          return this._writableState ? this._writableState.finished : false;
        },
      },
      writableObjectMode: {
        get() {
          return this._writableState ? this._writableState.objectMode : false;
        },
      },
      writableBuffer: {
        get() {
          return this._writableState && this._writableState.getBuffer();
        },
      },
      writableEnded: {
        get() {
          return this._writableState ? this._writableState.ending : false;
        },
      },
      writableNeedDrain: {
        get() {
          const wState = this._writableState;
          if (!wState) return false;
          return !wState.destroyed && !wState.ending && wState.needDrain;
        },
      },
      writableHighWaterMark: {
        get() {
          return this._writableState && this._writableState.highWaterMark;
        },
      },
      writableCorked: {
        get() {
          return this._writableState ? this._writableState.corked : 0;
        },
      },
      writableLength: {
        get() {
          return this._writableState && this._writableState.length;
        },
      },
      errored: {
        enumerable: false,
        get() {
          return this._writableState ? this._writableState.errored : null;
        },
      },
      writableAborted: {
        enumerable: false,
        get: function () {
          return !!(
            this._writableState.writable !== false &&
            (this._writableState.destroyed || this._writableState.errored) &&
            !this._writableState.finished
          );
        },
      },
    });
    var destroy = destroyImpl.destroy;
    Writable.prototype.destroy = function (err, cb) {
      const state = this._writableState;
      if (!state.destroyed && (state.bufferedIndex < state.buffered.length || state[kOnFinished].length)) {
        runOnNextTick(errorBuffer, state);
      }
      destroy.call(this, err, cb);
      return this;
    };
    Writable.prototype._undestroy = destroyImpl.undestroy;
    Writable.prototype._destroy = function (err, cb) {
      cb(err);
    };
    Writable.prototype[EE.captureRejectionSymbol] = function (err) {
      this.destroy(err);
    };
    var webStreamsAdapters;
    function lazyWebStreams() {
      if (webStreamsAdapters === void 0) webStreamsAdapters = {};
      return webStreamsAdapters;
    }
    Writable.fromWeb = function (writableStream, options) {
      return lazyWebStreams().newStreamWritableFromWritableStream(writableStream, options);
    };
    Writable.toWeb = function (streamWritable) {
      return lazyWebStreams().newWritableStreamFromStreamWritable(streamWritable);
    };
  },
});

// node_modules/readable-stream/lib/internal/streams/duplexify.js
var require_duplexify = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/duplexify.js"(exports, module) {
    "use strict";
    var {
      isReadable,
      isWritable,
      isIterable,
      isNodeStream,
      isReadableNodeStream,
      isWritableNodeStream,
      isDuplexNodeStream,
    } = require_utils();
    var eos = require_end_of_stream();
    var {
      AbortError,
      codes: { ERR_INVALID_ARG_TYPE, ERR_INVALID_RETURN_VALUE },
    } = require_errors();
    var { destroyer } = require_destroy();
    var Duplex = require_duplex();
    var Readable = require_readable();
    var { createDeferredPromise } = require_util();
    var from = require_from();
    var isBlob =
      typeof Blob !== "undefined"
        ? function isBlob2(b) {
            return b instanceof Blob;
          }
        : function isBlob2(b) {
            return false;
          };
    var { FunctionPrototypeCall } = require_primordials();
    class Duplexify extends Duplex {
      constructor(options) {
        super(options);

        // https://github.com/nodejs/node/pull/34385

        if ((options === null || options === undefined ? undefined : options.readable) === false) {
          this._readableState.readable = false;
          this._readableState.ended = true;
          this._readableState.endEmitted = true;
        }
        if ((options === null || options === undefined ? undefined : options.writable) === false) {
          this._writableState.writable = false;
          this._writableState.ending = true;
          this._writableState.ended = true;
          this._writableState.finished = true;
        }
      }
    }
    module.exports = function duplexify(body, name) {
      if (isDuplexNodeStream(body)) {
        return body;
      }
      if (isReadableNodeStream(body)) {
        return _duplexify({
          readable: body,
        });
      }
      if (isWritableNodeStream(body)) {
        return _duplexify({
          writable: body,
        });
      }
      if (isNodeStream(body)) {
        return _duplexify({
          writable: false,
          readable: false,
        });
      }
      if (typeof body === "function") {
        const { value, write, final, destroy } = fromAsyncGen(body);
        if (isIterable(value)) {
          return from(Duplexify, value, {
            objectMode: true,
            write,
            final,
            destroy,
          });
        }
        const then2 = value === null || value === void 0 ? void 0 : value.then;
        if (typeof then2 === "function") {
          let d;
          const promise = FunctionPrototypeCall(
            then2,
            value,
            val => {
              if (val != null) {
                throw new ERR_INVALID_RETURN_VALUE("nully", "body", val);
              }
            },
            err => {
              destroyer(d, err);
            },
          );
          return (d = new Duplexify({
            objectMode: true,
            readable: false,
            write,
            final(cb) {
              final(async () => {
                try {
                  await promise;
                  runOnNextTick(cb, null);
                } catch (err) {
                  runOnNextTick(cb, err);
                }
              });
            },
            destroy,
          }));
        }
        throw new ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or AsyncFunction", name, value);
      }
      if (isBlob(body)) {
        return duplexify(body.arrayBuffer());
      }
      if (isIterable(body)) {
        return from(Duplexify, body, {
          objectMode: true,
          writable: false,
        });
      }
      if (
        typeof (body === null || body === void 0 ? void 0 : body.writable) === "object" ||
        typeof (body === null || body === void 0 ? void 0 : body.readable) === "object"
      ) {
        const readable =
          body !== null && body !== void 0 && body.readable
            ? isReadableNodeStream(body === null || body === void 0 ? void 0 : body.readable)
              ? body === null || body === void 0
                ? void 0
                : body.readable
              : duplexify(body.readable)
            : void 0;
        const writable =
          body !== null && body !== void 0 && body.writable
            ? isWritableNodeStream(body === null || body === void 0 ? void 0 : body.writable)
              ? body === null || body === void 0
                ? void 0
                : body.writable
              : duplexify(body.writable)
            : void 0;
        return _duplexify({
          readable,
          writable,
        });
      }
      const then = body === null || body === void 0 ? void 0 : body.then;
      if (typeof then === "function") {
        let d;
        FunctionPrototypeCall(
          then,
          body,
          val => {
            if (val != null) {
              d.push(val);
            }
            d.push(null);
          },
          err => {
            destroyer(d, err);
          },
        );
        return (d = new Duplexify({
          objectMode: true,
          writable: false,
          read() {},
        }));
      }
      throw new ERR_INVALID_ARG_TYPE(
        name,
        [
          "Blob",
          "ReadableStream",
          "WritableStream",
          "Stream",
          "Iterable",
          "AsyncIterable",
          "Function",
          "{ readable, writable } pair",
          "Promise",
        ],
        body,
      );
    };
    function fromAsyncGen(fn) {
      let { promise, resolve } = createDeferredPromise();
      const ac = new AbortController();
      const signal = ac.signal;
      const value = fn(
        (async function* () {
          while (true) {
            const _promise = promise;
            promise = null;
            const { chunk, done, cb } = await _promise;
            runOnNextTick(cb);
            if (done) return;
            if (signal.aborted)
              throw new AbortError(void 0, {
                cause: signal.reason,
              });
            ({ promise, resolve } = createDeferredPromise());
            yield chunk;
          }
        })(),
        {
          signal,
        },
      );
      return {
        value,
        write(chunk, encoding, cb) {
          const _resolve = resolve;
          resolve = null;
          _resolve({
            chunk,
            done: false,
            cb,
          });
        },
        final(cb) {
          const _resolve = resolve;
          resolve = null;
          _resolve({
            done: true,
            cb,
          });
        },
        destroy(err, cb) {
          ac.abort();
          cb(err);
        },
      };
    }
    function _duplexify(pair) {
      const r =
        pair.readable && typeof pair.readable.read !== "function" ? Readable.wrap(pair.readable) : pair.readable;
      const w = pair.writable;
      let readable = !!isReadable(r);
      let writable = !!isWritable(w);
      let ondrain;
      let onfinish;
      let onreadable;
      let onclose;
      let d;
      function onfinished(err) {
        const cb = onclose;
        onclose = null;
        if (cb) {
          cb(err);
        } else if (err) {
          d.destroy(err);
        } else if (!readable && !writable) {
          d.destroy();
        }
      }
      d = new Duplexify({
        readableObjectMode: !!(r !== null && r !== void 0 && r.readableObjectMode),
        writableObjectMode: !!(w !== null && w !== void 0 && w.writableObjectMode),
        readable,
        writable,
      });
      if (writable) {
        eos(w, err => {
          writable = false;
          if (err) {
            destroyer(r, err);
          }
          onfinished(err);
        });
        d._write = function (chunk, encoding, callback) {
          if (w.write(chunk, encoding)) {
            callback();
          } else {
            ondrain = callback;
          }
        };
        d._final = function (callback) {
          w.end();
          onfinish = callback;
        };
        w.on("drain", function () {
          if (ondrain) {
            const cb = ondrain;
            ondrain = null;
            cb();
          }
        });
        w.on("finish", function () {
          if (onfinish) {
            const cb = onfinish;
            onfinish = null;
            cb();
          }
        });
      }
      if (readable) {
        eos(r, err => {
          readable = false;
          if (err) {
            destroyer(r, err);
          }
          onfinished(err);
        });
        r.on("readable", function () {
          if (onreadable) {
            const cb = onreadable;
            onreadable = null;
            cb();
          }
        });
        r.on("end", function () {
          d.push(null);
        });
        d._read = function () {
          while (true) {
            const buf = r.read();
            if (buf === null) {
              onreadable = d._read;
              return;
            }
            if (!d.push(buf)) {
              return;
            }
          }
        };
      }
      d._destroy = function (err, callback) {
        if (!err && onclose !== null) {
          err = new AbortError();
        }
        onreadable = null;
        ondrain = null;
        onfinish = null;
        if (onclose === null) {
          callback(err);
        } else {
          onclose = callback;
          destroyer(w, err);
          destroyer(r, err);
        }
      };
      return d;
    }
  },
});

// node_modules/readable-stream/lib/internal/streams/duplex.js
var require_duplex = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/duplex.js"(exports, module) {
    "use strict";
    var { ObjectDefineProperties, ObjectGetOwnPropertyDescriptor, ObjectKeys, ObjectSetPrototypeOf } =
      require_primordials();

    var Readable = require_readable();

    function Duplex(options) {
      if (!(this instanceof Duplex)) return new Duplex(options);
      Readable.call(this, options);
      Writable.call(this, options);

      if (options) {
        this.allowHalfOpen = options.allowHalfOpen !== false;
        if (options.readable === false) {
          this._readableState.readable = false;
          this._readableState.ended = true;
          this._readableState.endEmitted = true;
        }
        if (options.writable === false) {
          this._writableState.writable = false;
          this._writableState.ending = true;
          this._writableState.ended = true;
          this._writableState.finished = true;
        }
      } else {
        this.allowHalfOpen = true;
      }
    }
    Duplex.prototype = {};
    module.exports = Duplex;
    ObjectSetPrototypeOf(Duplex.prototype, Readable.prototype);
    ObjectSetPrototypeOf(Duplex, Readable);

    {
      for (var method in Writable.prototype) {
        if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
      }
    }

    ObjectDefineProperties(Duplex.prototype, {
      writable: ObjectGetOwnPropertyDescriptor(Writable.prototype, "writable"),
      writableHighWaterMark: ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableHighWaterMark"),
      writableObjectMode: ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableObjectMode"),
      writableBuffer: ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableBuffer"),
      writableLength: ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableLength"),
      writableFinished: ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableFinished"),
      writableCorked: ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableCorked"),
      writableEnded: ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableEnded"),
      writableNeedDrain: ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableNeedDrain"),
      destroyed: {
        get() {
          if (this._readableState === void 0 || this._writableState === void 0) {
            return false;
          }
          return this._readableState.destroyed && this._writableState.destroyed;
        },
        set(value) {
          if (this._readableState && this._writableState) {
            this._readableState.destroyed = value;
            this._writableState.destroyed = value;
          }
        },
      },
    });
    var webStreamsAdapters;
    function lazyWebStreams() {
      if (webStreamsAdapters === void 0) webStreamsAdapters = {};
      return webStreamsAdapters;
    }
    Duplex.fromWeb = function (pair, options) {
      return lazyWebStreams().newStreamDuplexFromReadableWritablePair(pair, options);
    };
    Duplex.toWeb = function (duplex) {
      return lazyWebStreams().newReadableWritablePairFromDuplex(duplex);
    };
    var duplexify;
    Duplex.from = function (body) {
      if (!duplexify) {
        duplexify = require_duplexify();
      }
      return duplexify(body, "body");
    };
  },
});

// node_modules/readable-stream/lib/internal/streams/transform.js
var require_transform = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/transform.js"(exports, module) {
    "use strict";
    var { ObjectSetPrototypeOf, Symbol: Symbol2 } = require_primordials();
    var { ERR_METHOD_NOT_IMPLEMENTED } = require_errors().codes;
    var Duplex = require_duplex();
    function Transform(options) {
      if (!(this instanceof Transform)) return new Transform(options);
      Duplex.call(this, options);

      this._readableState.sync = false;
      this[kCallback] = null;

      if (options) {
        if (typeof options.transform === "function") this._transform = options.transform;
        if (typeof options.flush === "function") this._flush = options.flush;
      }

      this.on("prefinish", prefinish.bind(this));
    }
    Transform.prototype = {};
    ObjectSetPrototypeOf(Transform.prototype, Duplex.prototype);
    ObjectSetPrototypeOf(Transform, Duplex);

    module.exports = Transform;
    var kCallback = Symbol2("kCallback");
    function final(cb) {
      if (typeof this._flush === "function" && !this.destroyed) {
        this._flush((er, data) => {
          if (er) {
            if (cb) {
              cb(er);
            } else {
              this.destroy(er);
            }
            return;
          }
          if (data != null) {
            this.push(data);
          }
          this.push(null);
          if (cb) {
            cb();
          }
        });
      } else {
        this.push(null);
        if (cb) {
          cb();
        }
      }
    }
    function prefinish() {
      if (this._final !== final) {
        final.call(this);
      }
    }
    Transform.prototype._final = final;
    Transform.prototype._transform = function (chunk, encoding, callback) {
      throw new ERR_METHOD_NOT_IMPLEMENTED("_transform()");
    };
    Transform.prototype._write = function (chunk, encoding, callback) {
      const rState = this._readableState;
      const wState = this._writableState;
      const length = rState.length;
      this._transform(chunk, encoding, (err, val) => {
        if (err) {
          callback(err);
          return;
        }
        if (val != null) {
          this.push(val);
        }
        if (
          wState.ended ||
          length === rState.length ||
          rState.length < rState.highWaterMark ||
          rState.highWaterMark === 0 ||
          rState.length === 0
        ) {
          callback();
        } else {
          this[kCallback] = callback;
        }
      });
    };
    Transform.prototype._read = function () {
      if (this[kCallback]) {
        const callback = this[kCallback];
        this[kCallback] = null;
        callback();
      }
    };
  },
});

// node_modules/readable-stream/lib/internal/streams/passthrough.js
var require_passthrough = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/passthrough.js"(exports, module) {
    "use strict";
    var { ObjectSetPrototypeOf } = require_primordials();
    var Transform = require_transform();

    function PassThrough(options) {
      if (!(this instanceof PassThrough)) return new PassThrough(options);
      Transform.call(this, options);
    }
    PassThrough.prototype = {};

    ObjectSetPrototypeOf(PassThrough.prototype, Transform.prototype);
    ObjectSetPrototypeOf(PassThrough, Transform);

    PassThrough.prototype._transform = function (chunk, encoding, cb) {
      cb(null, chunk);
    };

    module.exports = PassThrough;
  },
});

// node_modules/readable-stream/lib/internal/streams/pipeline.js
var require_pipeline = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/pipeline.js"(exports, module) {
    "use strict";
    var { ArrayIsArray, Promise: Promise2, SymbolAsyncIterator } = require_primordials();
    var eos = require_end_of_stream();
    var { once } = require_util();
    var destroyImpl = require_destroy();
    var Duplex = require_duplex();
    var {
      aggregateTwoErrors,
      codes: { ERR_INVALID_ARG_TYPE, ERR_INVALID_RETURN_VALUE, ERR_MISSING_ARGS, ERR_STREAM_DESTROYED },
      AbortError,
    } = require_errors();
    var { validateFunction, validateAbortSignal } = require_validators();
    var { isIterable, isReadable, isReadableNodeStream, isNodeStream } = require_utils();
    var PassThrough;
    var Readable;
    function destroyer(stream, reading, writing) {
      let finished = false;
      stream.on("close", () => {
        finished = true;
      });
      const cleanup = eos(
        stream,
        {
          readable: reading,
          writable: writing,
        },
        err => {
          finished = !err;
        },
      );
      return {
        destroy: err => {
          if (finished) return;
          finished = true;
          destroyImpl.destroyer(stream, err || new ERR_STREAM_DESTROYED("pipe"));
        },
        cleanup,
      };
    }
    function popCallback(streams) {
      validateFunction(streams[streams.length - 1], "streams[stream.length - 1]");
      return streams.pop();
    }
    function makeAsyncIterable(val) {
      if (isIterable(val)) {
        return val;
      } else if (isReadableNodeStream(val)) {
        return fromReadable(val);
      }
      throw new ERR_INVALID_ARG_TYPE("val", ["Readable", "Iterable", "AsyncIterable"], val);
    }
    async function* fromReadable(val) {
      if (!Readable) {
        Readable = require_readable();
      }
      yield* Readable.prototype[SymbolAsyncIterator].call(val);
    }
    async function pump(iterable, writable, finish, { end }) {
      let error;
      let onresolve = null;
      const resume = err => {
        if (err) {
          error = err;
        }
        if (onresolve) {
          const callback = onresolve;
          onresolve = null;
          callback();
        }
      };
      const wait = () =>
        new Promise2((resolve, reject) => {
          if (error) {
            reject(error);
          } else {
            onresolve = () => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            };
          }
        });
      writable.on("drain", resume);
      const cleanup = eos(
        writable,
        {
          readable: false,
        },
        resume,
      );
      try {
        if (writable.writableNeedDrain) {
          await wait();
        }
        for await (const chunk of iterable) {
          if (!writable.write(chunk)) {
            await wait();
          }
        }
        if (end) {
          writable.end();
        }
        await wait();
        finish();
      } catch (err) {
        finish(error !== err ? aggregateTwoErrors(error, err) : err);
      } finally {
        cleanup();
        writable.off("drain", resume);
      }
    }
    function pipeline(...streams) {
      return pipelineImpl(streams, once(popCallback(streams)));
    }
    function pipelineImpl(streams, callback, opts) {
      if (streams.length === 1 && ArrayIsArray(streams[0])) {
        streams = streams[0];
      }
      if (streams.length < 2) {
        throw new ERR_MISSING_ARGS("streams");
      }
      const ac = new AbortController();
      const signal = ac.signal;
      const outerSignal = opts === null || opts === void 0 ? void 0 : opts.signal;
      const lastStreamCleanup = [];
      validateAbortSignal(outerSignal, "options.signal");
      function abort() {
        finishImpl(new AbortError());
      }
      outerSignal === null || outerSignal === void 0 ? void 0 : outerSignal.addEventListener("abort", abort);
      let error;
      let value;
      const destroys = [];
      let finishCount = 0;
      function finish(err) {
        finishImpl(err, --finishCount === 0);
      }
      function finishImpl(err, final) {
        if (err && (!error || error.code === "ERR_STREAM_PREMATURE_CLOSE")) {
          error = err;
        }
        if (!error && !final) {
          return;
        }
        while (destroys.length) {
          destroys.shift()(error);
        }
        outerSignal === null || outerSignal === void 0 ? void 0 : outerSignal.removeEventListener("abort", abort);
        ac.abort();
        if (final) {
          if (!error) {
            lastStreamCleanup.forEach(fn => fn());
          }
          runOnNextTick(callback, error, value);
        }
      }
      let ret;
      for (let i = 0; i < streams.length; i++) {
        const stream = streams[i];
        const reading = i < streams.length - 1;
        const writing = i > 0;
        const end = reading || (opts === null || opts === void 0 ? void 0 : opts.end) !== false;
        const isLastStream = i === streams.length - 1;
        if (isNodeStream(stream)) {
          let onError = function (err) {
            if (err && err.name !== "AbortError" && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
              finish(err);
            }
          };
          if (end) {
            const { destroy, cleanup } = destroyer(stream, reading, writing);
            destroys.push(destroy);
            if (isReadable(stream) && isLastStream) {
              lastStreamCleanup.push(cleanup);
            }
          }
          stream.on("error", onError);
          if (isReadable(stream) && isLastStream) {
            lastStreamCleanup.push(() => {
              stream.removeListener("error", onError);
            });
          }
        }
        if (i === 0) {
          if (typeof stream === "function") {
            ret = stream({
              signal,
            });
            if (!isIterable(ret)) {
              throw new ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or Stream", "source", ret);
            }
          } else if (isIterable(stream) || isReadableNodeStream(stream)) {
            ret = stream;
          } else {
            ret = Duplex.from(stream);
          }
        } else if (typeof stream === "function") {
          ret = makeAsyncIterable(ret);
          ret = stream(ret, {
            signal,
          });
          if (reading) {
            if (!isIterable(ret, true)) {
              throw new ERR_INVALID_RETURN_VALUE("AsyncIterable", `transform[${i - 1}]`, ret);
            }
          } else {
            var _ret;
            if (!PassThrough) {
              PassThrough = require_passthrough();
            }
            const pt = new PassThrough({
              objectMode: true,
            });
            const then = (_ret = ret) === null || _ret === void 0 ? void 0 : _ret.then;
            if (typeof then === "function") {
              finishCount++;
              then.call(
                ret,
                val => {
                  value = val;
                  if (val != null) {
                    pt.write(val);
                  }
                  if (end) {
                    pt.end();
                  }
                  runOnNextTick(finish);
                },
                err => {
                  pt.destroy(err);
                  runOnNextTick(finish, err);
                },
              );
            } else if (isIterable(ret, true)) {
              finishCount++;
              pump(ret, pt, finish, {
                end,
              });
            } else {
              throw new ERR_INVALID_RETURN_VALUE("AsyncIterable or Promise", "destination", ret);
            }
            ret = pt;
            const { destroy, cleanup } = destroyer(ret, false, true);
            destroys.push(destroy);
            if (isLastStream) {
              lastStreamCleanup.push(cleanup);
            }
          }
        } else if (isNodeStream(stream)) {
          if (isReadableNodeStream(ret)) {
            finishCount += 2;
            const cleanup = pipe(ret, stream, finish, {
              end,
            });
            if (isReadable(stream) && isLastStream) {
              lastStreamCleanup.push(cleanup);
            }
          } else if (isIterable(ret)) {
            finishCount++;
            pump(ret, stream, finish, {
              end,
            });
          } else {
            throw new ERR_INVALID_ARG_TYPE("val", ["Readable", "Iterable", "AsyncIterable"], ret);
          }
          ret = stream;
        } else {
          ret = Duplex.from(stream);
        }
      }
      if (
        (signal !== null && signal !== void 0 && signal.aborted) ||
        (outerSignal !== null && outerSignal !== void 0 && outerSignal.aborted)
      ) {
        runOnNextTick(abort);
      }
      return ret;
    }
    function pipe(src, dst, finish, { end }) {
      src.pipe(dst, {
        end,
      });
      if (end) {
        src.once("end", () => dst.end());
      } else {
        finish();
      }
      eos(
        src,
        {
          readable: true,
          writable: false,
        },
        err => {
          const rState = src._readableState;
          if (
            err &&
            err.code === "ERR_STREAM_PREMATURE_CLOSE" &&
            rState &&
            rState.ended &&
            !rState.errored &&
            !rState.errorEmitted
          ) {
            src.once("end", finish).once("error", finish);
          } else {
            finish(err);
          }
        },
      );
      return eos(
        dst,
        {
          readable: false,
          writable: true,
        },
        finish,
      );
    }
    module.exports = {
      pipelineImpl,
      pipeline,
    };
  },
});

// node_modules/readable-stream/lib/internal/streams/compose.js
var require_compose = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/compose.js"(exports, module) {
    "use strict";
    var { pipeline } = require_pipeline();
    var Duplex = require_duplex();
    var { destroyer } = require_destroy();
    var { isNodeStream, isReadable, isWritable } = require_utils();
    var {
      AbortError,
      codes: { ERR_INVALID_ARG_VALUE, ERR_MISSING_ARGS },
    } = require_errors();
    module.exports = function compose(...streams) {
      if (streams.length === 0) {
        throw new ERR_MISSING_ARGS("streams");
      }
      if (streams.length === 1) {
        return Duplex.from(streams[0]);
      }
      const orgStreams = [...streams];
      if (typeof streams[0] === "function") {
        streams[0] = Duplex.from(streams[0]);
      }
      if (typeof streams[streams.length - 1] === "function") {
        const idx = streams.length - 1;
        streams[idx] = Duplex.from(streams[idx]);
      }
      for (let n = 0; n < streams.length; ++n) {
        if (!isNodeStream(streams[n])) {
          continue;
        }
        if (n < streams.length - 1 && !isReadable(streams[n])) {
          throw new ERR_INVALID_ARG_VALUE(`streams[${n}]`, orgStreams[n], "must be readable");
        }
        if (n > 0 && !isWritable(streams[n])) {
          throw new ERR_INVALID_ARG_VALUE(`streams[${n}]`, orgStreams[n], "must be writable");
        }
      }
      let ondrain;
      let onfinish;
      let onreadable;
      let onclose;
      let d;
      function onfinished(err) {
        const cb = onclose;
        onclose = null;
        if (cb) {
          cb(err);
        } else if (err) {
          d.destroy(err);
        } else if (!readable && !writable) {
          d.destroy();
        }
      }
      const head = streams[0];
      const tail = pipeline(streams, onfinished);
      const writable = !!isWritable(head);
      const readable = !!isReadable(tail);
      d = new Duplex({
        writableObjectMode: !!(head !== null && head !== void 0 && head.writableObjectMode),
        readableObjectMode: !!(tail !== null && tail !== void 0 && tail.writableObjectMode),
        writable,
        readable,
      });
      if (writable) {
        d._write = function (chunk, encoding, callback) {
          if (head.write(chunk, encoding)) {
            callback();
          } else {
            ondrain = callback;
          }
        };
        d._final = function (callback) {
          head.end();
          onfinish = callback;
        };
        head.on("drain", function () {
          if (ondrain) {
            const cb = ondrain;
            ondrain = null;
            cb();
          }
        });
        tail.on("finish", function () {
          if (onfinish) {
            const cb = onfinish;
            onfinish = null;
            cb();
          }
        });
      }
      if (readable) {
        tail.on("readable", function () {
          if (onreadable) {
            const cb = onreadable;
            onreadable = null;
            cb();
          }
        });
        tail.on("end", function () {
          d.push(null);
        });
        d._read = function () {
          while (true) {
            const buf = tail.read();
            if (buf === null) {
              onreadable = d._read;
              return;
            }
            if (!d.push(buf)) {
              return;
            }
          }
        };
      }
      d._destroy = function (err, callback) {
        if (!err && onclose !== null) {
          err = new AbortError();
        }
        onreadable = null;
        ondrain = null;
        onfinish = null;
        if (onclose === null) {
          callback(err);
        } else {
          onclose = callback;
          destroyer(tail, err);
        }
      };
      return d;
    };
  },
});

// node_modules/readable-stream/lib/stream/promises.js
var require_promises = __commonJS({
  "node_modules/readable-stream/lib/stream/promises.js"(exports, module) {
    "use strict";
    var { ArrayPrototypePop, Promise: Promise2 } = require_primordials();
    var { isIterable, isNodeStream } = require_utils();
    var { pipelineImpl: pl } = require_pipeline();
    var { finished } = require_end_of_stream();
    function pipeline(...streams) {
      return new Promise2((resolve, reject) => {
        let signal;
        let end;
        const lastArg = streams[streams.length - 1];
        if (lastArg && typeof lastArg === "object" && !isNodeStream(lastArg) && !isIterable(lastArg)) {
          const options = ArrayPrototypePop(streams);
          signal = options.signal;
          end = options.end;
        }
        pl(
          streams,
          (err, value) => {
            if (err) {
              reject(err);
            } else {
              resolve(value);
            }
          },
          {
            signal,
            end,
          },
        );
      });
    }
    module.exports = {
      finished,
      pipeline,
    };
  },
});
// node_modules/readable-stream/lib/stream.js
var require_stream = __commonJS({
  "node_modules/readable-stream/lib/stream.js"(exports, module) {
    "use strict";
    var { ObjectDefineProperty, ObjectKeys, ReflectApply } = require_primordials();
    var {
      promisify: { custom: customPromisify },
    } = require_util();

    var { streamReturningOperators, promiseReturningOperators } = require_operators();
    var {
      codes: { ERR_ILLEGAL_CONSTRUCTOR },
    } = require_errors();
    var compose = require_compose();
    var { pipeline } = require_pipeline();
    var { destroyer } = require_destroy();
    var eos = require_end_of_stream();
    var promises = require_promises();
    var utils = require_utils();
    var Stream = (module.exports = require_legacy().Stream);
    Stream.isDisturbed = utils.isDisturbed;
    Stream.isErrored = utils.isErrored;
    Stream.isWritable = utils.isWritable;
    Stream.isReadable = utils.isReadable;
    Stream.Readable = require_readable();
    for (const key of ObjectKeys(streamReturningOperators)) {
      let fn = function (...args) {
        if (new.target) {
          throw ERR_ILLEGAL_CONSTRUCTOR();
        }
        return Stream.Readable.from(ReflectApply(op, this, args));
      };
      const op = streamReturningOperators[key];
      ObjectDefineProperty(fn, "name", {
        value: op.name,
      });
      ObjectDefineProperty(fn, "length", {
        value: op.length,
      });
      ObjectDefineProperty(Stream.Readable.prototype, key, {
        value: fn,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
    for (const key of ObjectKeys(promiseReturningOperators)) {
      let fn = function (...args) {
        if (new.target) {
          throw ERR_ILLEGAL_CONSTRUCTOR();
        }
        return ReflectApply(op, this, args);
      };
      const op = promiseReturningOperators[key];
      ObjectDefineProperty(fn, "name", {
        value: op.name,
      });
      ObjectDefineProperty(fn, "length", {
        value: op.length,
      });
      ObjectDefineProperty(Stream.Readable.prototype, key, {
        value: fn,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
    Stream.Writable = require_writable();
    Stream.Duplex = require_duplex();
    Stream.Transform = require_transform();
    Stream.PassThrough = require_passthrough();
    Stream.pipeline = pipeline;
    var { addAbortSignal } = require_add_abort_signal();
    Stream.addAbortSignal = addAbortSignal;
    Stream.finished = eos;
    Stream.destroy = destroyer;
    Stream.compose = compose;
    ObjectDefineProperty(Stream, "promises", {
      configurable: true,
      enumerable: true,
      get() {
        return promises;
      },
    });
    ObjectDefineProperty(pipeline, customPromisify, {
      enumerable: true,
      get() {
        return promises.pipeline;
      },
    });
    ObjectDefineProperty(eos, customPromisify, {
      enumerable: true,
      get() {
        return promises.finished;
      },
    });
    Stream.Stream = Stream;
    Stream._isUint8Array = function isUint8Array(value) {
      return value instanceof Uint8Array;
    };
    Stream._uint8ArrayToBuffer = function _uint8ArrayToBuffer(chunk) {
      return new Buffer(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    };
  },
});

/**
 * Bun native stream wrapper
 *
 * This glue code lets us avoid using ReadableStreams to wrap Bun internal streams
 *
 */
function createNativeStreamReadable(nativeType, Readable) {
  var [pull, start, cancel, setClose, deinit, updateRef, drainFn] = $lazy(nativeType);

  var closer = [false];
  var handleNumberResult = function (nativeReadable, result, view, isClosed) {
    if (result > 0) {
      const slice = view.subarray(0, result);
      const remainder = view.subarray(result);
      if (slice.byteLength > 0) {
        nativeReadable.push(slice);
      }

      if (isClosed) {
        nativeReadable.push(null);
      }

      return remainder.byteLength > 0 ? remainder : undefined;
    }

    if (isClosed) {
      nativeReadable.push(null);
    }

    return view;
  };

  var handleArrayBufferViewResult = function (nativeReadable, result, view, isClosed) {
    if (result.byteLength > 0) {
      nativeReadable.push(result);
    }

    if (isClosed) {
      nativeReadable.push(null);
    }

    return view;
  };

  var DYNAMICALLY_ADJUST_CHUNK_SIZE = process.env.BUN_DISABLE_DYNAMIC_CHUNK_SIZE !== "1";

  const finalizer = new FinalizationRegistry(ptr => ptr && deinit(ptr));
  const MIN_BUFFER_SIZE = 512;
  var NativeReadable = class NativeReadable extends Readable {
    #bunNativePtr;
    #refCount = 1;
    #constructed = false;
    #remainingChunk = undefined;
    #highWaterMark;
    #pendingRead = false;
    #hasResized = !DYNAMICALLY_ADJUST_CHUNK_SIZE;
    #unregisterToken;
    constructor(ptr, options = {}) {
      super(options);
      if (typeof options.highWaterMark === "number") {
        this.#highWaterMark = options.highWaterMark;
      } else {
        this.#highWaterMark = 256 * 1024;
      }
      this.#bunNativePtr = ptr;
      this.#constructed = false;
      this.#remainingChunk = undefined;
      this.#pendingRead = false;
      this.#unregisterToken = {};
      finalizer.register(this, this.#bunNativePtr, this.#unregisterToken);
    }

    // maxToRead is by default the highWaterMark passed from the Readable.read call to this fn
    // However, in the case of an fs.ReadStream, we can pass the number of bytes we want to read
    // which may be significantly less than the actual highWaterMark
    _read(maxToRead) {
      $debug("NativeReadable._read", this.__id);
      if (this.#pendingRead) {
        $debug("pendingRead is true", this.__id);
        return;
      }

      var ptr = this.#bunNativePtr;
      $debug("ptr @ NativeReadable._read", ptr, this.__id);
      if (ptr === 0) {
        this.push(null);
        return;
      }

      if (!this.#constructed) {
        $debug("NativeReadable not constructed yet", this.__id);
        this.#internalConstruct(ptr);
      }

      return this.#internalRead(this.#getRemainingChunk(maxToRead), ptr);
      // const internalReadRes = this.#internalRead(
      //   this.#getRemainingChunk(),
      //   ptr,
      // );
      // // REVERT ME
      // const wrap = new Promise((resolve) => {
      //   if (!this.internalReadRes?.then) {
      //     debug("internalReadRes not promise");
      //     resolve(internalReadRes);
      //     return;
      //   }
      //   internalReadRes.then((result) => {
      //     debug("internalReadRes done");
      //     resolve(result);
      //   });
      // });
      // return wrap;
    }

    #internalConstruct(ptr) {
      this.#constructed = true;
      const result = start(ptr, this.#highWaterMark);
      $debug("NativeReadable internal `start` result", result, this.__id);

      if (typeof result === "number" && result > 1) {
        this.#hasResized = true;
        $debug("NativeReadable resized", this.__id);

        this.#highWaterMark = Math.min(this.#highWaterMark, result);
      }

      if (drainFn) {
        const drainResult = drainFn(ptr);
        $debug("NativeReadable drain result", drainResult, this.__id);
        if ((drainResult?.byteLength ?? 0) > 0) {
          this.push(drainResult);
        }
      }
    }

    // maxToRead can be the highWaterMark (by default) or the remaining amount of the stream to read
    // This is so the the consumer of the stream can terminate the stream early if they know
    // how many bytes they want to read (ie. when reading only part of a file)
    #getRemainingChunk(maxToRead = this.#highWaterMark) {
      var chunk = this.#remainingChunk;
      $debug("chunk @ #getRemainingChunk", chunk, this.__id);
      if (chunk?.byteLength ?? 0 < MIN_BUFFER_SIZE) {
        var size = maxToRead > MIN_BUFFER_SIZE ? maxToRead : MIN_BUFFER_SIZE;
        this.#remainingChunk = chunk = new Buffer(size);
      }
      return chunk;
    }

    // push(result, encoding) {
    //   debug("NativeReadable push -- result, encoding", result, encoding, this.__id);
    //   return super.push(...arguments);
    // }

    #handleResult(result, view, isClosed) {
      $debug("result, isClosed @ #handleResult", result, isClosed, this.__id);

      if (typeof result === "number") {
        if (result >= this.#highWaterMark && !this.#hasResized && !isClosed) {
          this.#highWaterMark *= 2;
          this.#hasResized = true;
        }

        return handleNumberResult(this, result, view, isClosed);
      } else if (typeof result === "boolean") {
        process.nextTick(() => {
          this.push(null);
        });
        return view?.byteLength ?? 0 > 0 ? view : undefined;
      } else if (ArrayBuffer.isView(result)) {
        if (result.byteLength >= this.#highWaterMark && !this.#hasResized && !isClosed) {
          this.#highWaterMark *= 2;
          this.#hasResized = true;
          $debug("Resized", this.__id);
        }

        return handleArrayBufferViewResult(this, result, view, isClosed);
      } else {
        $debug("Unknown result type", result, this.__id);
        throw new Error("Invalid result from pull");
      }
    }

    #internalRead(view, ptr) {
      $debug("#internalRead()", this.__id);
      closer[0] = false;
      var result = pull(ptr, view, closer);
      if ($isPromise(result)) {
        this.#pendingRead = true;
        return result.then(
          result => {
            this.#pendingRead = false;
            $debug("pending no longerrrrrrrr (result returned from pull)", this.__id);
            this.#remainingChunk = this.#handleResult(result, view, closer[0]);
          },
          reason => {
            $debug("error from pull", reason, this.__id);
            errorOrDestroy(this, reason);
          },
        );
      } else {
        this.#remainingChunk = this.#handleResult(result, view, closer[0]);
      }
    }

    _destroy(error, callback) {
      var ptr = this.#bunNativePtr;
      if (ptr === 0) {
        callback(error);
        return;
      }

      finalizer.unregister(this.#unregisterToken);
      this.#bunNativePtr = 0;
      if (updateRef) {
        updateRef(ptr, false);
      }
      $debug("NativeReadable destroyed", this.__id);
      cancel(ptr, error);
      callback(error);
    }

    ref() {
      var ptr = this.#bunNativePtr;
      if (ptr === 0) return;
      if (this.#refCount++ === 0) {
        updateRef(ptr, true);
      }
    }

    unref() {
      var ptr = this.#bunNativePtr;
      if (ptr === 0) return;
      if (this.#refCount-- === 1) {
        updateRef(ptr, false);
      }
    }
  };

  if (!updateRef) {
    NativeReadable.prototype.ref = undefined;
    NativeReadable.prototype.unref = undefined;
  }

  return NativeReadable;
}

var nativeReadableStreamPrototypes = {
  0: undefined,
  1: undefined,
  2: undefined,
  3: undefined,
  4: undefined,
  5: undefined,
};
function getNativeReadableStreamPrototype(nativeType, Readable) {
  return (nativeReadableStreamPrototypes[nativeType] ||= createNativeStreamReadable(nativeType, Readable));
}

function getNativeReadableStream(Readable, stream, options) {
  if (!(stream && typeof stream === "object" && stream instanceof ReadableStream)) {
    return undefined;
  }

  const native = $direct(stream);
  if (!native) {
    $debug("no native readable stream");
    return undefined;
  }
  const { stream: ptr, data: type } = native;

  const NativeReadable = getNativeReadableStreamPrototype(type, Readable);

  return new NativeReadable(ptr, options);
}
/** --- Bun native stream wrapper ---  */

var Writable = require_writable();
var NativeWritable = class NativeWritable extends Writable {
  #pathOrFdOrSink;
  #fileSink;
  #native = true;

  _construct;
  _destroy;
  _final;

  constructor(pathOrFdOrSink, options = {}) {
    super(options);

    this._construct = this.#internalConstruct;
    this._destroy = this.#internalDestroy;
    this._final = this.#internalFinal;

    this.#pathOrFdOrSink = pathOrFdOrSink;
  }

  // These are confusingly two different fns for construct which initially were the same thing because
  // `_construct` is part of the lifecycle of Writable and is not called lazily,
  // so we need to separate our _construct for Writable state and actual construction of the write stream
  #internalConstruct(cb) {
    this._writableState.constructed = true;
    this.constructed = true;
    if (typeof cb === "function") cb();
    process.nextTick(() => {
      this.emit("open", this.fd);
      this.emit("ready");
    });
  }

  #lazyConstruct() {
    // TODO: Turn this check into check for instanceof FileSink
    if (typeof this.#pathOrFdOrSink === "object") {
      if (typeof this.#pathOrFdOrSink.write === "function") {
        this.#fileSink = this.#pathOrFdOrSink;
      } else {
        throw new Error("Invalid FileSink");
      }
    } else {
      this.#fileSink = Bun.file(this.#pathOrFdOrSink).writer();
    }
  }

  write(chunk, encoding, cb, native = this.#native) {
    if (!native) {
      this.#native = false;
      return super.write(chunk, encoding, cb);
    }

    if (!this.#fileSink) {
      this.#lazyConstruct();
    }
    var fileSink = this.#fileSink;
    var result = fileSink.write(chunk);

    if ($isPromise(result)) {
      // var writePromises = this.#writePromises;
      // var i = writePromises.length;
      // writePromises[i] = result;
      result.then(() => {
        this.emit("drain");
        fileSink.flush(true);
        // // We can't naively use i here because we don't know when writes will resolve necessarily
        // writePromises.splice(writePromises.indexOf(result), 1);
      });
      return false;
    }
    fileSink.flush(true);
    // TODO: Should we just have a calculation based on encoding and length of chunk?
    if (cb) cb(null, chunk.byteLength);
    return true;
  }

  end(chunk, encoding, cb, native = this.#native) {
    return super.end(chunk, encoding, cb, native);
  }

  #internalDestroy(error, cb) {
    const w = this._writableState;
    const r = this._readableState;

    if (w) {
      w.destroyed = true;
      w.closeEmitted = true;
    }
    if (r) {
      r.destroyed = true;
      r.closeEmitted = true;
    }

    if (typeof cb === "function") cb(error);

    if (w?.closeEmitted || r?.closeEmitted) {
      this.emit("close");
    }
  }

  #internalFinal(cb) {
    if (this.#fileSink) {
      this.#fileSink.end();
    }
    if (cb) cb();
  }

  ref() {
    if (!this.#fileSink) {
      this.#lazyConstruct();
    }
    this.#fileSink.ref();
  }

  unref() {
    if (!this.#fileSink) return;
    this.#fileSink.unref();
  }
};

const exports = require_stream();
const promises = require_promises();
exports._getNativeReadableStreamPrototype = getNativeReadableStreamPrototype;
exports.NativeWritable = NativeWritable;
Object.defineProperty(exports, "promises", {
  configurable: true,
  enumerable: true,
  get() {
    return promises;
  },
});

exports[Symbol.for("::bunternal::")] = { _ReadableFromWeb, _ReadableFromWebForUndici };
exports.eos = require_end_of_stream();
exports.EventEmitter = EE;

var Duplex = exports.Duplex;

export default exports;
