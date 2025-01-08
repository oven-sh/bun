// Hardcoded module "node:stream" / "readable-stream"
// "readable-stream" npm package
// just transpiled and debug logs added.

// BEGIN moved from require_readable
// when we split this stuff up again, we can move this back
const kObjectMode = 1 << 0;
const kEnded = 1 << 1;
const kEndEmitted = 1 << 2;
const kReading = 1 << 3;
const kConstructed = 1 << 4;
const kSync = 1 << 5;
const kNeedReadable = 1 << 6;
const kEmittedReadable = 1 << 7;
const kReadableListening = 1 << 8;
const kResumeScheduled = 1 << 9;
const kErrorEmitted = 1 << 10;
const kEmitClose = 1 << 11;
const kAutoDestroy = 1 << 12;
const kDestroyed = 1 << 13;
const kClosed = 1 << 14;
const kCloseEmitted = 1 << 15;
const kMultiAwaitDrain = 1 << 16;
const kReadingMore = 1 << 17;
const kDataEmitted = 1 << 18;
const kPaused = Symbol("kPaused");
// END moved from require_readable

const StringDecoder = require("node:string_decoder").StringDecoder;
const transferToNativeReadable = $newCppFunction("ReadableStream.cpp", "jsFunctionTransferToNativeReadableStream", 1);
const { kAutoDestroyed } = require("internal/shared");
const {
  validateBoolean,
  validateInteger,
  validateAbortSignal,
  validateFunction,
  validateObject,
} = require("internal/validators");

const ProcessNextTick = process.nextTick;

const EE = require("node:events").EventEmitter;

var __getOwnPropNames = Object.getOwnPropertyNames;

var __commonJS = (cb, mod: typeof module | undefined = undefined) =>
  function __require2() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

function isReadableStream(value) {
  return typeof value === "object" && value !== null && value instanceof ReadableStream;
}

$debug("node:stream loaded");

//------------------------------------------------------------------------------
// Node error polyfills
//------------------------------------------------------------------------------

// node_modules/readable-stream/lib/ours/primordials.js
var require_primordials = __commonJS({
  "node_modules/readable-stream/lib/ours/primordials.js"(exports, module) {
    "use strict";
    module.exports = {
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
        return fn.$call(thisArgs, ...args);
      },
      FunctionPrototypeSymbolHasInstance(self, instance) {
        return Function.prototype[Symbol.hasInstance].$call(self, instance);
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
      TypedArrayPrototypeSet(self, buf, len) {
        return self.set(buf, len);
      },
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
    var AggregateError = class extends Error {
      constructor(errors) {
        if (!Array.isArray(errors)) {
          throw new TypeError(`Expected input to be an Array, got ${typeof errors}`);
        }
        let message = "";
        for (let i = 0; i < errors.length; i++) {
          message += `    ${errors[i].stack}
`;
        }
        super(message);
        this.name = "AggregateError";
        this.errors = errors;
      }
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
          callback.$apply(this, args);
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
    var { format, inspect, AggregateError: CustomAggregateError } = require_util();
    var AggregateError = globalThis.AggregateError || CustomAggregateError;
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

// node_modules/readable-stream/lib/internal/streams/state.js
var { MathFloor, NumberIsInteger } = require_primordials();
function highWaterMarkFrom(options, isDuplex, duplexKey) {
  return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
}

let hwm_object = 16;
let hwm_bytes = 16 * 1024;

function getDefaultHighWaterMark(objectMode) {
  return objectMode ? hwm_object : hwm_bytes;
}

function setDefaultHighWaterMark(objectMode, value) {
  if (objectMode) {
    hwm_object = value;
  } else {
    hwm_bytes = value;
  }
}

function getHighWaterMark(state, options, duplexKey, isDuplex) {
  const hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
  if (hwm != null) {
    if (!NumberIsInteger(hwm) || hwm < 0) {
      const name = isDuplex ? `options.${duplexKey}` : "options.highWaterMark";
      throw $ERR_INVALID_ARG_VALUE(name, hwm);
    }
    return MathFloor(hwm);
  }
  return getDefaultHighWaterMark(state.objectMode);
}

var _ReadableFromWeb;
var _ReadableFromWebForUndici;

const Readable = require("internal/streams/readable");

const Writable = require("internal/streams/writable");

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
    } = require("internal/streams/utils");
    var eos = require("internal/streams/end-of-stream");
    var {
      AbortError,
      codes: { ERR_INVALID_ARG_TYPE, ERR_INVALID_RETURN_VALUE },
    } = require_errors();
    var { destroyer } = require("internal/streams/destroy");
    var Duplex = require("internal/streams/duplex");
    var { createDeferredPromise } = require_util();
    var from = require("internal/streams/from");
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
                  ProcessNextTick(cb, null);
                } catch (err) {
                  ProcessNextTick(cb, err);
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
            ProcessNextTick(cb);
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

const Duplex = require("internal/streams/duplex");

// node_modules/readable-stream/lib/stream/promises.js
var require_promises = __commonJS({
  "node_modules/readable-stream/lib/stream/promises.js"(exports, module) {
    "use strict";
    var { ArrayPrototypePop, Promise: Promise2 } = require_primordials();
    var { isIterable, isNodeStream } = require("internal/streams/utils");
    var { pipelineImpl: pl } = require("internal/streams/pipeline");
    var { finished } = require("internal/streams/end-of-stream");
    function pipeline(...streams) {
      const { promise, resolve, reject } = $newPromiseCapability(Promise);
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
      return promise;
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
    var { ObjectDefineProperty, ObjectKeys } = require_primordials();
    var {
      promisify: { custom: customPromisify },
    } = require_util();

    var { streamReturningOperators, promiseReturningOperators } = require("internal/streams/operators");
    var {
      codes: { ERR_ILLEGAL_CONSTRUCTOR },
    } = require_errors();
    var compose = require("internal/streams/compose");
    var { pipeline } = require("internal/streams/pipeline");
    var { destroyer } = require("internal/streams/destroy");
    var eos = require("internal/streams/end-of-stream");
    var promises = require_promises();
    var utils = require("internal/streams/utils");
    var Stream = (module.exports = require("internal/streams/legacy").Stream);
    Stream.isDisturbed = utils.isDisturbed;
    Stream.isErrored = utils.isErrored;
    Stream.isWritable = utils.isWritable;
    Stream.isReadable = utils.isReadable;
    Stream.Readable = require("internal/streams/readable");
    for (const key of ObjectKeys(streamReturningOperators)) {
      let fn = function (...args) {
        if (new.target) {
          throw ERR_ILLEGAL_CONSTRUCTOR();
        }
        return Stream.Readable.from(op.$apply(this, args));
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
        return op.$apply(this, args);
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
    Stream.Writable = require("internal/streams/writable");
    Stream.Duplex = require("internal/streams/duplex");
    Stream.Transform = require("internal/streams/transform");
    Stream.PassThrough = require("internal/streams/passthrough");
    Stream.pipeline = pipeline;
    var { addAbortSignal } = require("internal/streams/add-abort-signal");
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
    Stream.setDefaultHighWaterMark = setDefaultHighWaterMark;
    Stream.getDefaultHighWaterMark = getDefaultHighWaterMark;
  },
});

var kEnsureConstructed = Symbol("kEnsureConstructed");

/**
 * Bun native stream wrapper
 *
 * This glue code lets us avoid using ReadableStreams to wrap Bun internal streams
 */
function createNativeStreamReadable(Readable) {
  var closer = [false];
  var handleNumberResult = function (nativeReadable, result, view, isClosed) {
    if (result > 0) {
      const slice = view.subarray(0, result);
      const remainder = view.subarray(result);
      if (slice.byteLength > 0) {
        nativeReadable.push(slice);
      }

      if (isClosed) {
        ProcessNextTick(() => {
          nativeReadable.push(null);
        });
      }

      return remainder.byteLength > 0 ? remainder : undefined;
    }

    if (isClosed) {
      ProcessNextTick(() => {
        nativeReadable.push(null);
      });
    }

    return view;
  };

  var handleArrayBufferViewResult = function (nativeReadable, result, view, isClosed) {
    if (result.byteLength > 0) {
      nativeReadable.push(result);
    }

    if (isClosed) {
      ProcessNextTick(() => {
        nativeReadable.push(null);
      });
    }

    return view;
  };

  var DYNAMICALLY_ADJUST_CHUNK_SIZE = process.env.BUN_DISABLE_DYNAMIC_CHUNK_SIZE !== "1";

  const MIN_BUFFER_SIZE = 512;

  const refCount = Symbol("refCount");
  const constructed = Symbol("constructed");
  const remainingChunk = Symbol("remainingChunk");
  const highWaterMark = Symbol("highWaterMark");
  const pendingRead = Symbol("pendingRead");
  const hasResized = Symbol("hasResized");

  const _onClose = Symbol("_onClose");
  const _onDrain = Symbol("_onDrain");
  const _internalConstruct = Symbol("_internalConstruct");
  const _getRemainingChunk = Symbol("_getRemainingChunk");
  const _adjustHighWaterMark = Symbol("_adjustHighWaterMark");
  const _handleResult = Symbol("_handleResult");
  const _internalRead = Symbol("_internalRead");

  function NativeReadable(this: typeof NativeReadable, ptr, options) {
    if (!(this instanceof NativeReadable)) {
      return new NativeReadable(path, options);
    }

    this[refCount] = 0;
    this[constructed] = false;
    this[remainingChunk] = undefined;
    this[pendingRead] = false;
    this[hasResized] = !DYNAMICALLY_ADJUST_CHUNK_SIZE;

    options ??= {};
    Readable.$apply(this, [options]);

    if (typeof options.highWaterMark === "number") {
      this[highWaterMark] = options.highWaterMark;
    } else {
      this[highWaterMark] = 256 * 1024;
    }
    this.$bunNativePtr = ptr;
    this[constructed] = false;
    this[remainingChunk] = undefined;
    this[pendingRead] = false;
    ptr.onClose = this[_onClose].bind(this);
    ptr.onDrain = this[_onDrain].bind(this);
  }
  $toClass(NativeReadable, "NativeReadable", Readable);

  NativeReadable.prototype[_onClose] = function () {
    this.push(null);
  };

  NativeReadable.prototype[_onDrain] = function (chunk) {
    this.push(chunk);
  };

  // maxToRead is by default the highWaterMark passed from the Readable.read call to this fn
  // However, in the case of an fs.ReadStream, we can pass the number of bytes we want to read
  // which may be significantly less than the actual highWaterMark
  NativeReadable.prototype._read = function _read(maxToRead) {
    $debug("NativeReadable._read", this.__id);
    if (this[pendingRead]) {
      $debug("pendingRead is true", this.__id);
      return;
    }
    var ptr = this.$bunNativePtr;
    $debug("ptr @ NativeReadable._read", ptr, this.__id);
    if (!ptr) {
      this.push(null);
      return;
    }
    if (!this[constructed]) {
      $debug("NativeReadable not constructed yet", this.__id);
      this[_internalConstruct](ptr);
    }
    return this[_internalRead](this[_getRemainingChunk](maxToRead), ptr);
  };

  NativeReadable.prototype[_internalConstruct] = function (ptr) {
    $assert(this[constructed] === false);
    this[constructed] = true;

    const result = ptr.start(this[highWaterMark]);

    $debug("NativeReadable internal `start` result", result, this.__id);

    if (typeof result === "number" && result > 1) {
      this[hasResized] = true;
      $debug("NativeReadable resized", this.__id);

      this[highWaterMark] = Math.min(this[highWaterMark], result);
    }

    const drainResult = ptr.drain();
    $debug("NativeReadable drain result", drainResult, this.__id);
    if ((drainResult?.byteLength ?? 0) > 0) {
      this.push(drainResult);
    }
  };

  // maxToRead can be the highWaterMark (by default) or the remaining amount of the stream to read
  // This is so the consumer of the stream can terminate the stream early if they know
  // how many bytes they want to read (ie. when reading only part of a file)
  // ObjectDefinePrivateProperty(NativeReadable.prototype, "_getRemainingChunk", );
  NativeReadable.prototype[_getRemainingChunk] = function (maxToRead) {
    maxToRead ??= this[highWaterMark];
    var chunk = this[remainingChunk];
    $debug("chunk @ #getRemainingChunk", chunk, this.__id);
    if (chunk?.byteLength ?? 0 < MIN_BUFFER_SIZE) {
      var size = maxToRead > MIN_BUFFER_SIZE ? maxToRead : MIN_BUFFER_SIZE;
      this[remainingChunk] = chunk = new Buffer(size);
    }
    return chunk;
  };

  // ObjectDefinePrivateProperty(NativeReadable.prototype, "_adjustHighWaterMark", );
  NativeReadable.prototype[_adjustHighWaterMark] = function () {
    this[highWaterMark] = Math.min(this[highWaterMark] * 2, 1024 * 1024 * 2);
    this[hasResized] = true;
    $debug("Resized", this.__id);
  };

  // ObjectDefinePrivateProperty(NativeReadable.prototype, "_handleResult", );
  NativeReadable.prototype[_handleResult] = function (result, view, isClosed) {
    $debug("result, isClosed @ #handleResult", result, isClosed, this.__id);

    if (typeof result === "number") {
      if (result >= this[highWaterMark] && !this[hasResized] && !isClosed) {
        this[_adjustHighWaterMark]();
      }
      return handleNumberResult(this, result, view, isClosed);
    } else if (typeof result === "boolean") {
      ProcessNextTick(() => {
        this.push(null);
      });
      return (view?.byteLength ?? 0 > 0) ? view : undefined;
    } else if ($isTypedArrayView(result)) {
      if (result.byteLength >= this[highWaterMark] && !this[hasResized] && !isClosed) {
        this[_adjustHighWaterMark]();
      }

      return handleArrayBufferViewResult(this, result, view, isClosed);
    } else {
      $debug("Unknown result type", result, this.__id);
      throw new Error("Invalid result from pull");
    }
  };

  NativeReadable.prototype[_internalRead] = function (view, ptr) {
    $debug("#internalRead()", this.__id);
    closer[0] = false;
    var result = ptr.pull(view, closer);
    if ($isPromise(result)) {
      this[pendingRead] = true;
      return result.then(
        result => {
          this[pendingRead] = false;
          $debug("pending no longerrrrrrrr (result returned from pull)", this.__id);
          const isClosed = closer[0];
          this[remainingChunk] = this[_handleResult](result, view, isClosed);
        },
        reason => {
          $debug("error from pull", reason, this.__id);
          errorOrDestroy(this, reason);
        },
      );
    } else {
      this[remainingChunk] = this[_handleResult](result, view, closer[0]);
    }
  };

  NativeReadable.prototype._destroy = function (error, callback) {
    var ptr = this.$bunNativePtr;
    if (!ptr) {
      callback(error);
      return;
    }

    this.$bunNativePtr = undefined;
    ptr.updateRef(false);

    $debug("NativeReadable destroyed", this.__id);
    ptr.cancel(error);
    callback(error);
  };

  NativeReadable.prototype.ref = function () {
    var ptr = this.$bunNativePtr;
    if (ptr === undefined) return;
    if (this[refCount]++ === 0) {
      ptr.updateRef(true);
    }
  };

  NativeReadable.prototype.unref = function () {
    var ptr = this.$bunNativePtr;
    if (ptr === undefined) return;
    if (this[refCount]-- === 1) {
      ptr.updateRef(false);
    }
  };

  NativeReadable.prototype[kEnsureConstructed] = function () {
    if (this[constructed]) return;
    this[_internalConstruct](this.$bunNativePtr);
  };

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
  return (nativeReadableStreamPrototypes[nativeType] ??= createNativeStreamReadable(Readable));
}

function getNativeReadableStream(Readable, stream, options) {
  const ptr = stream.$bunNativePtr;
  if (!ptr || ptr === -1) {
    $debug("no native readable stream");
    return undefined;
  }
  const type = stream.$bunNativeType;
  $assert(typeof type === "number", "Invalid native type");
  $assert(typeof ptr === "object", "Invalid native ptr");

  const NativeReadable = getNativeReadableStreamPrototype(type, Readable);
  // https://github.com/oven-sh/bun/pull/12801
  // https://github.com/oven-sh/bun/issues/9555
  // There may be a ReadableStream.Strong handle to the ReadableStream.
  // We can't update those handles to point to the NativeReadable from JS
  // So we instead mark it as no longer usable, and create a new NativeReadable
  transferToNativeReadable(stream);

  return new NativeReadable(ptr, options);
}

/** --- Bun native stream wrapper ---  */

const _pathOrFdOrSink = Symbol("pathOrFdOrSink");
const { fileSinkSymbol: _fileSink } = require("internal/shared");
const _native = Symbol("native");

function NativeWritable(pathOrFdOrSink, options = {}) {
  Writable.$call(this, options);

  this[_native] = true;

  this._construct = NativeWritable_internalConstruct;
  this._final = NativeWritable_internalFinal;
  this._write = NativeWritablePrototypeWrite;

  this[_pathOrFdOrSink] = pathOrFdOrSink;
}
$toClass(NativeWritable, "NativeWritable", Writable);

// These are confusingly two different fns for construct which initially were the same thing because
// `_construct` is part of the lifecycle of Writable and is not called lazily,
// so we need to separate our _construct for Writable state and actual construction of the write stream
function NativeWritable_internalConstruct(cb) {
  this._writableState.constructed = true;
  this.constructed = true;
  if (typeof cb === "function") ProcessNextTick(cb);
  ProcessNextTick(() => {
    this.emit("open", this.fd);
    this.emit("ready");
  });
}

function NativeWritable_lazyConstruct(stream) {
  // TODO: Turn this check into check for instanceof FileSink
  var sink = stream[_pathOrFdOrSink];
  if (typeof sink === "object") {
    if (typeof sink.write === "function") {
      return (stream[_fileSink] = sink);
    } else {
      throw new Error("Invalid FileSink");
    }
  } else {
    return (stream[_fileSink] = Bun.file(sink).writer());
  }
}

function NativeWritablePrototypeWrite(chunk, encoding, cb) {
  var fileSink = this[_fileSink] ?? NativeWritable_lazyConstruct(this);
  var result = fileSink.write(chunk);

  if (typeof encoding === "function") {
    cb = encoding;
  }

  if ($isPromise(result)) {
    // var writePromises = this.#writePromises;
    // var i = writePromises.length;
    // writePromises[i] = result;
    result
      .then(result => {
        this.emit("drain");
        if (cb) {
          cb(null, result);
        }
      })
      .catch(
        cb
          ? err => {
              cb(err);
            }
          : err => {
              this.emit("error", err);
            },
      );
    return false;
  }

  // TODO: Should we just have a calculation based on encoding and length of chunk?
  if (cb) cb(null, chunk.byteLength);
  return true;
}

const WritablePrototypeEnd = Writable.prototype.end;
NativeWritable.prototype.end = function end(chunk, encoding, cb, native) {
  return WritablePrototypeEnd.$call(this, chunk, encoding, cb, native ?? this[_native]);
};

NativeWritable.prototype._destroy = function (error, cb) {
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
};

function NativeWritable_internalFinal(cb) {
  var sink = this[_fileSink];
  if (sink) {
    const end = sink.end(true);
    if ($isPromise(end) && cb) {
      end.then(() => {
        if (cb) cb();
      }, cb);
    }
  }
  if (cb) cb();
}

NativeWritable.prototype.ref = function ref() {
  const sink = (this[_fileSink] ||= NativeWritable_lazyConstruct(this));
  sink.ref();
  return this;
};

NativeWritable.prototype.unref = function unref() {
  const sink = (this[_fileSink] ||= NativeWritable_lazyConstruct(this));
  sink.unref();
  return this;
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

exports[Symbol.for("::bunternal::")] = { _ReadableFromWeb, _ReadableFromWebForUndici, kEnsureConstructed };
exports.eos = require("internal/streams/end-of-stream");
exports.EventEmitter = EE;

export default exports;
