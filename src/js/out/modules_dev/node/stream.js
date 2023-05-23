var DebugEventEmitter = function(opts) {
  if (!(this instanceof DebugEventEmitter))
    return new DebugEventEmitter(opts);
  _EE.call(this, opts);
  const __id = opts.__id;
  if (__id)
    __defProp(this, "__id", {
      value: __id,
      readable: !0,
      writable: !1,
      enumerable: !1
    });
}, isReadableStream = function(value) {
  return typeof value === "object" && value !== null && value instanceof ReadableStream;
}, validateBoolean = function(value, name) {
  if (typeof value !== "boolean")
    throw new ERR_INVALID_ARG_TYPE(name, "boolean", value);
};
var ERR_INVALID_ARG_TYPE = function(name, type, value) {
  return new Error(`The argument '${name}' is invalid. Received '${value}' for type '${type}'`);
}, ERR_INVALID_ARG_VALUE = function(name, value, reason) {
  return new Error(`The value '${value}' is invalid for argument '${name}'. Reason: ${reason}`);
}, createNativeStreamReadable = function(nativeType, Readable) {
  var [pull, start, cancel, setClose, deinit, updateRef, drainFn] = globalThis[Symbol.for("Bun.lazy")](nativeType), closer = [!1], handleNumberResult = function(nativeReadable, result, view, isClosed) {
    if (result > 0) {
      const slice = view.subarray(0, result), remainder = view.subarray(result);
      if (slice.byteLength > 0)
        nativeReadable.push(slice);
      if (isClosed)
        nativeReadable.push(null);
      return remainder.byteLength > 0 ? remainder : void 0;
    }
    if (isClosed)
      nativeReadable.push(null);
    return view;
  }, handleArrayBufferViewResult = function(nativeReadable, result, view, isClosed) {
    if (result.byteLength > 0)
      nativeReadable.push(result);
    if (isClosed)
      nativeReadable.push(null);
    return view;
  }, DYNAMICALLY_ADJUST_CHUNK_SIZE = process.env.BUN_DISABLE_DYNAMIC_CHUNK_SIZE !== "1";
  const finalizer = new FinalizationRegistry((ptr) => ptr && deinit(ptr)), MIN_BUFFER_SIZE = 512;
  var NativeReadable = class NativeReadable2 extends Readable {
    #ptr;
    #refCount = 1;
    #constructed = !1;
    #remainingChunk = void 0;
    #highWaterMark;
    #pendingRead = !1;
    #hasResized = !DYNAMICALLY_ADJUST_CHUNK_SIZE;
    #unregisterToken;
    constructor(ptr, options = {}) {
      super(options);
      if (typeof options.highWaterMark === "number")
        this.#highWaterMark = options.highWaterMark;
      else
        this.#highWaterMark = 262144;
      this.#ptr = ptr, this.#constructed = !1, this.#remainingChunk = void 0, this.#pendingRead = !1, this.#unregisterToken = {}, finalizer.register(this, this.#ptr, this.#unregisterToken);
    }
    _read(maxToRead) {
      if (__DEBUG__ && debug("NativeReadable._read", this.__id), this.#pendingRead) {
        __DEBUG__ && debug("pendingRead is true", this.__id);
        return;
      }
      var ptr = this.#ptr;
      if (__DEBUG__ && debug("ptr @ NativeReadable._read", ptr, this.__id), ptr === 0) {
        this.push(null);
        return;
      }
      if (!this.#constructed)
        __DEBUG__ && debug("NativeReadable not constructed yet", this.__id), this.#internalConstruct(ptr);
      return this.#internalRead(this.#getRemainingChunk(maxToRead), ptr);
    }
    #internalConstruct(ptr) {
      this.#constructed = !0;
      const result = start(ptr, this.#highWaterMark);
      if (__DEBUG__ && debug("NativeReadable internal `start` result", result, this.__id), typeof result === "number" && result > 1)
        this.#hasResized = !0, __DEBUG__ && debug("NativeReadable resized", this.__id), this.#highWaterMark = Math.min(this.#highWaterMark, result);
      if (drainFn) {
        const drainResult = drainFn(ptr);
        if (__DEBUG__ && debug("NativeReadable drain result", drainResult, this.__id), (drainResult?.byteLength ?? 0) > 0)
          this.push(drainResult);
      }
    }
    #getRemainingChunk(maxToRead = this.#highWaterMark) {
      var chunk = this.#remainingChunk;
      if (__DEBUG__ && debug("chunk @ #getRemainingChunk", chunk, this.__id), chunk?.byteLength ?? 0 < MIN_BUFFER_SIZE) {
        var size = maxToRead > MIN_BUFFER_SIZE ? maxToRead : MIN_BUFFER_SIZE;
        this.#remainingChunk = chunk = new Buffer(size);
      }
      return chunk;
    }
    push(result, encoding) {
      return __DEBUG__ && debug("NativeReadable push -- result, encoding", result, encoding, this.__id), super.push(...arguments);
    }
    #handleResult(result, view, isClosed) {
      if (__DEBUG__ && debug("result, isClosed @ #handleResult", result, isClosed, this.__id), typeof result === "number") {
        if (result >= this.#highWaterMark && !this.#hasResized && !isClosed)
          this.#highWaterMark *= 2, this.#hasResized = !0;
        return handleNumberResult(this, result, view, isClosed);
      } else if (typeof result === "boolean")
        return this.push(null), view?.byteLength ?? 0 > 0 ? view : void 0;
      else if (ArrayBuffer.isView(result)) {
        if (result.byteLength >= this.#highWaterMark && !this.#hasResized && !isClosed)
          this.#highWaterMark *= 2, this.#hasResized = !0, __DEBUG__ && debug("Resized", this.__id);
        return handleArrayBufferViewResult(this, result, view, isClosed);
      } else
        throw __DEBUG__ && debug("Unknown result type", result, this.__id), new Error("Invalid result from pull");
    }
    #internalRead(view, ptr) {
      __DEBUG__ && debug("#internalRead()", this.__id), closer[0] = !1;
      var result = pull(ptr, view, closer);
      if (isPromise(result))
        return this.#pendingRead = !0, result.then((result2) => {
          this.#pendingRead = !1, __DEBUG__ && debug("pending no longerrrrrrrr (result returned from pull)", this.__id), this.#remainingChunk = this.#handleResult(result2, view, closer[0]);
        }, (reason) => {
          __DEBUG__ && debug("error from pull", reason, this.__id), errorOrDestroy(this, reason);
        });
      else
        this.#remainingChunk = this.#handleResult(result, view, closer[0]);
    }
    _destroy(error, callback) {
      var ptr = this.#ptr;
      if (ptr === 0) {
        callback(error);
        return;
      }
      if (finalizer.unregister(this.#unregisterToken), this.#ptr = 0, updateRef)
        updateRef(ptr, !1);
      __DEBUG__ && debug("NativeReadable destroyed", this.__id), cancel(ptr, error), callback(error);
    }
    ref() {
      var ptr = this.#ptr;
      if (ptr === 0)
        return;
      if (this.#refCount++ === 0)
        updateRef(ptr, !0);
    }
    unref() {
      var ptr = this.#ptr;
      if (ptr === 0)
        return;
      if (this.#refCount-- === 1)
        updateRef(ptr, !1);
    }
  };
  if (!updateRef)
    NativeReadable.prototype.ref = void 0, NativeReadable.prototype.unref = void 0;
  return NativeReadable;
}, getNativeReadableStreamPrototype = function(nativeType, Readable) {
  return nativeReadableStreamPrototypes[nativeType] ||= createNativeStreamReadable(nativeType, Readable);
}, getNativeReadableStream = function(Readable, stream, options) {
  if (!(stream && typeof stream === "object" && stream instanceof ReadableStream))
    return;
  const native = direct(stream);
  if (!native) {
    debug("no native readable stream");
    return;
  }
  const { stream: ptr, data: type } = native;
  return new (getNativeReadableStreamPrototype(type, Readable))(ptr, options);
}, { isPromise, isCallable, direct, Object } = import.meta.primordials;
globalThis.__IDS_TO_TRACK = process.env.DEBUG_TRACK_EE?.length ? process.env.DEBUG_TRACK_EE.split(",") : process.env.DEBUG_STREAMS?.length ? process.env.DEBUG_STREAMS.split(",") : null;
var __TRACK_EE__ = !!process.env.DEBUG_TRACK_EE, __DEBUG__ = !!(process.env.DEBUG || process.env.DEBUG_STREAMS || __TRACK_EE__), debug = __DEBUG__ ? globalThis.__IDS_TO_TRACK ? (...args) => {
  const lastItem = args[args.length - 1];
  if (!globalThis.__IDS_TO_TRACK.includes(lastItem))
    return;
  console.log(`ID: ${lastItem}`, ...args.slice(0, -1));
} : (...args) => console.log(...args.slice(0, -1)) : () => {
}, __create = Object.create, __defProp = Object.defineProperty, __getOwnPropDesc = Object.getOwnPropertyDescriptor, __getOwnPropNames = Object.getOwnPropertyNames, __getProtoOf = Object.getPrototypeOf, __hasOwnProp = Object.prototype.hasOwnProperty, __ObjectSetPrototypeOf = Object.setPrototypeOf, __require = (x) => import.meta.require(x), _EE = __require("events");
__ObjectSetPrototypeOf(DebugEventEmitter.prototype, _EE.prototype);
__ObjectSetPrototypeOf(DebugEventEmitter, _EE);
DebugEventEmitter.prototype.emit = function(event, ...args) {
  var __id = this.__id;
  if (__id)
    debug("emit", event, ...args, __id);
  else
    debug("emit", event, ...args);
  return _EE.prototype.emit.call(this, event, ...args);
};
DebugEventEmitter.prototype.on = function(event, handler) {
  var __id = this.__id;
  if (__id)
    debug("on", event, "added", __id);
  else
    debug("on", event, "added");
  return _EE.prototype.on.call(this, event, handler);
};
DebugEventEmitter.prototype.addListener = function(event, handler) {
  return this.on(event, handler);
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var runOnNextTick = process.nextTick;
var ArrayIsArray = Array.isArray, require_primordials = __commonJS({
  "node_modules/readable-stream/lib/ours/primordials.js"(exports, module) {
    module.exports = {
      ArrayIsArray(self) {
        return Array.isArray(self);
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
      TypedArrayPrototypeSet(self, buf, len) {
        return self.set(buf, len);
      },
      Uint8Array
    };
  }
}), require_util = __commonJS({
  "node_modules/readable-stream/lib/ours/util.js"(exports, module) {
    var bufferModule = __require("buffer"), AsyncFunction = Object.getPrototypeOf(async function() {
    }).constructor, Blob = globalThis.Blob || bufferModule.Blob, isBlob = typeof Blob !== "undefined" ? function isBlob2(b) {
      return b instanceof Blob;
    } : function isBlob2(b) {
      return !1;
    }, AggregateError = class extends Error {
      constructor(errors) {
        if (!Array.isArray(errors))
          throw new TypeError(`Expected input to be an Array, got ${typeof errors}`);
        let message = "";
        for (let i = 0;i < errors.length; i++)
          message += `    ${errors[i].stack}
`;
        super(message);
        this.name = "AggregateError", this.errors = errors;
      }
    };
    module.exports = {
      AggregateError,
      once(callback) {
        let called = !1;
        return function(...args) {
          if (called)
            return;
          called = !0, callback.apply(this, args);
        };
      },
      createDeferredPromise: function() {
        let resolve, reject;
        return {
          promise: new Promise((res, rej) => {
            resolve = res, reject = rej;
          }),
          resolve,
          reject
        };
      },
      promisify(fn) {
        return new Promise((resolve, reject) => {
          fn((err, ...args) => {
            if (err)
              return reject(err);
            return resolve(...args);
          });
        });
      },
      debuglog() {
        return function() {
        };
      },
      format(format, ...args) {
        return format.replace(/%([sdifj])/g, function(...[_unused, type]) {
          const replacement = args.shift();
          if (type === "f")
            return replacement.toFixed(6);
          else if (type === "j")
            return JSON.stringify(replacement);
          else if (type === "s" && typeof replacement === "object")
            return `${replacement.constructor !== Object ? replacement.constructor.name : ""} {}`.trim();
          else
            return replacement.toString();
        });
      },
      inspect(value) {
        switch (typeof value) {
          case "string":
            if (value.includes("'")) {
              if (!value.includes('"'))
                return `"${value}"`;
              else if (!value.includes("`") && !value.includes("${"))
                return `\`${value}\``;
            }
            return `'${value}'`;
          case "number":
            if (isNaN(value))
              return "NaN";
            else if (Object.is(value, -0))
              return String(value);
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
        }
      },
      isBlob
    }, module.exports.promisify.custom = Symbol.for("nodejs.util.promisify.custom");
  }
}), require_errors = __commonJS({
  "node_modules/readable-stream/lib/ours/errors.js"(exports, module) {
    var { format, inspect, AggregateError: CustomAggregateError } = require_util(), AggregateError = globalThis.AggregateError || CustomAggregateError, kIsNodeError = Symbol("kIsNodeError"), kTypes = ["string", "function", "number", "object", "Function", "Object", "boolean", "bigint", "symbol"], classRegExp = /^([A-Z][a-z0-9]*)+$/, nodeInternalPrefix = "__node_internal_", codes = {};
    function assert(value, message) {
      if (!value)
        throw new codes.ERR_INTERNAL_ASSERTION(message);
    }
    function addNumericalSeparator(val) {
      let res = "", i = val.length;
      const start = val[0] === "-" ? 1 : 0;
      for (;i >= start + 4; i -= 3)
        res = `_${val.slice(i - 3, i)}${res}`;
      return `${val.slice(0, i)}${res}`;
    }
    function getMessage(key, msg, args) {
      if (typeof msg === "function")
        return assert(msg.length <= args.length, `Code: ${key}; The provided arguments length (${args.length}) does not match the required ones (${msg.length}).`), msg(...args);
      const expectedLength = (msg.match(/%[dfijoOs]/g) || []).length;
      if (assert(expectedLength === args.length, `Code: ${key}; The provided arguments length (${args.length}) does not match the required ones (${expectedLength}).`), args.length === 0)
        return msg;
      return format(msg, ...args);
    }
    function E(code, message, Base) {
      if (!Base)
        Base = Error;

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
          writable: !0,
          enumerable: !1,
          configurable: !0
        },
        toString: {
          value() {
            return `${this.name} [${code}]: ${this.message}`;
          },
          writable: !0,
          enumerable: !1,
          configurable: !0
        }
      }), NodeError.prototype.code = code, NodeError.prototype[kIsNodeError] = !0, codes[code] = NodeError;
    }
    function hideStackFrames(fn) {
      const hidden = nodeInternalPrefix + fn.name;
      return Object.defineProperty(fn, "name", {
        value: hidden
      }), fn;
    }
    function aggregateTwoErrors(innerError, outerError) {
      if (innerError && outerError && innerError !== outerError) {
        if (Array.isArray(outerError.errors))
          return outerError.errors.push(innerError), outerError;
        const err = new AggregateError([outerError, innerError], outerError.message);
        return err.code = outerError.code, err;
      }
      return innerError || outerError;
    }
    var AbortError = class extends Error {
      constructor(message = "The operation was aborted", options = void 0) {
        if (options !== void 0 && typeof options !== "object")
          throw new codes.ERR_INVALID_ARG_TYPE("options", "Object", options);
        super(message, options);
        this.code = "ABORT_ERR", this.name = "AbortError";
      }
    };
    E("ERR_ASSERTION", "%s", Error), E("ERR_INVALID_ARG_TYPE", (name, expected, actual) => {
      if (assert(typeof name === "string", "'name' must be a string"), !Array.isArray(expected))
        expected = [expected];
      let msg = "The ";
      if (name.endsWith(" argument"))
        msg += `${name} `;
      else
        msg += `"${name}" ${name.includes(".") ? "property" : "argument"} `;
      msg += "must be ";
      const types = [], instances = [], other = [];
      for (let value of expected)
        if (assert(typeof value === "string", "All expected entries have to be of type string"), kTypes.includes(value))
          types.push(value.toLowerCase());
        else if (classRegExp.test(value))
          instances.push(value);
        else
          assert(value !== "object", 'The value "object" should be written as "Object"'), other.push(value);
      if (instances.length > 0) {
        const pos = types.indexOf("object");
        if (pos !== -1)
          types.splice(types, pos, 1), instances.push("Object");
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
        if (instances.length > 0 || other.length > 0)
          msg += " or ";
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
        if (other.length > 0)
          msg += " or ";
      }
      switch (other.length) {
        case 0:
          break;
        case 1:
          if (other[0].toLowerCase() !== other[0])
            msg += "an ";
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
      if (actual == null)
        msg += `. Received ${actual}`;
      else if (typeof actual === "function" && actual.name)
        msg += `. Received function ${actual.name}`;
      else if (typeof actual === "object") {
        var _actual$constructor;
        if ((_actual$constructor = actual.constructor) !== null && _actual$constructor !== void 0 && _actual$constructor.name)
          msg += `. Received an instance of ${actual.constructor.name}`;
        else {
          const inspected = inspect(actual, {
            depth: -1
          });
          msg += `. Received ${inspected}`;
        }
      } else {
        let inspected = inspect(actual, {
          colors: !1
        });
        if (inspected.length > 25)
          inspected = `${inspected.slice(0, 25)}...`;
        msg += `. Received type ${typeof actual} (${inspected})`;
      }
      return msg;
    }, TypeError), E("ERR_INVALID_ARG_VALUE", (name, value, reason = "is invalid") => {
      let inspected = inspect(value);
      if (inspected.length > 128)
        inspected = inspected.slice(0, 128) + "...";
      return `The ${name.includes(".") ? "property" : "argument"} '${name}' ${reason}. Received ${inspected}`;
    }, TypeError), E("ERR_INVALID_RETURN_VALUE", (input, name, value) => {
      var _value$constructor;
      const type = value !== null && value !== void 0 && (_value$constructor = value.constructor) !== null && _value$constructor !== void 0 && _value$constructor.name ? `instance of ${value.constructor.name}` : `type ${typeof value}`;
      return `Expected ${input} to be returned from the "${name}" function but got ${type}.`;
    }, TypeError), E("ERR_MISSING_ARGS", (...args) => {
      assert(args.length > 0, "At least one arg needs to be specified");
      let msg;
      const len = args.length;
      switch (args = (Array.isArray(args) ? args : [args]).map((a) => `"${a}"`).join(" or "), len) {
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
    }, TypeError), E("ERR_OUT_OF_RANGE", (str, range, input) => {
      assert(range, 'Missing "range" argument');
      let received;
      if (Number.isInteger(input) && Math.abs(input) > 4294967296)
        received = addNumericalSeparator(String(input));
      else if (typeof input === "bigint") {
        if (received = String(input), input > 2n ** 32n || input < -(2n ** 32n))
          received = addNumericalSeparator(received);
        received += "n";
      } else
        received = inspect(input);
      return `The value of "${str}" is out of range. It must be ${range}. Received ${received}`;
    }, RangeError), E("ERR_MULTIPLE_CALLBACK", "Callback called multiple times", Error), E("ERR_METHOD_NOT_IMPLEMENTED", "The %s method is not implemented", Error), E("ERR_STREAM_ALREADY_FINISHED", "Cannot call %s after a stream was finished", Error), E("ERR_STREAM_CANNOT_PIPE", "Cannot pipe, not readable", Error), E("ERR_STREAM_DESTROYED", "Cannot call %s after a stream was destroyed", Error), E("ERR_STREAM_NULL_VALUES", "May not write null values to stream", TypeError), E("ERR_STREAM_PREMATURE_CLOSE", "Premature close", Error), E("ERR_STREAM_PUSH_AFTER_EOF", "stream.push() after EOF", Error), E("ERR_STREAM_UNSHIFT_AFTER_END_EVENT", "stream.unshift() after end event", Error), E("ERR_STREAM_WRITE_AFTER_END", "write after end", Error), E("ERR_UNKNOWN_ENCODING", "Unknown encoding: %s", TypeError), module.exports = {
      AbortError,
      aggregateTwoErrors: hideStackFrames(aggregateTwoErrors),
      hideStackFrames,
      codes
    };
  }
}), require_validators = __commonJS({
  "node_modules/readable-stream/lib/internal/validators.js"(exports, module) {
    var {
      ArrayIsArray: ArrayIsArray2,
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
      StringPrototypeTrim
    } = require_primordials(), {
      hideStackFrames,
      codes: { ERR_SOCKET_BAD_PORT, ERR_INVALID_ARG_TYPE: ERR_INVALID_ARG_TYPE2, ERR_INVALID_ARG_VALUE: ERR_INVALID_ARG_VALUE2, ERR_OUT_OF_RANGE, ERR_UNKNOWN_SIGNAL }
    } = require_errors(), { normalizeEncoding } = require_util(), { isAsyncFunction, isArrayBufferView } = require_util().types, signals = {};
    function isInt32(value) {
      return value === (value | 0);
    }
    function isUint32(value) {
      return value === value >>> 0;
    }
    var octalReg = /^[0-7]+$/, modeDesc = "must be a 32-bit unsigned integer or an octal string";
    function parseFileMode(value, name, def) {
      if (typeof value === "undefined")
        value = def;
      if (typeof value === "string") {
        if (!RegExpPrototypeTest(octalReg, value))
          throw new ERR_INVALID_ARG_VALUE2(name, value, modeDesc);
        value = NumberParseInt(value, 8);
      }
      return validateInt32(value, name, 0, 4294967295), value;
    }
    var validateInteger = hideStackFrames((value, name, min = NumberMIN_SAFE_INTEGER, max = NumberMAX_SAFE_INTEGER) => {
      if (typeof value !== "number")
        throw new ERR_INVALID_ARG_TYPE2(name, "number", value);
      if (!NumberIsInteger(value))
        throw new ERR_OUT_OF_RANGE(name, "an integer", value);
      if (value < min || value > max)
        throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
    }), validateInt32 = hideStackFrames((value, name, min = -2147483648, max = 2147483647) => {
      if (typeof value !== "number")
        throw new ERR_INVALID_ARG_TYPE2(name, "number", value);
      if (!isInt32(value)) {
        if (!NumberIsInteger(value))
          throw new ERR_OUT_OF_RANGE(name, "an integer", value);
        throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
      }
      if (value < min || value > max)
        throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
    }), validateUint32 = hideStackFrames((value, name, positive) => {
      if (typeof value !== "number")
        throw new ERR_INVALID_ARG_TYPE2(name, "number", value);
      if (!isUint32(value)) {
        if (!NumberIsInteger(value))
          throw new ERR_OUT_OF_RANGE(name, "an integer", value);
        throw new ERR_OUT_OF_RANGE(name, `>= ${positive ? 1 : 0} && < 4294967296`, value);
      }
      if (positive && value === 0)
        throw new ERR_OUT_OF_RANGE(name, ">= 1 && < 4294967296", value);
    });
    function validateString(value, name) {
      if (typeof value !== "string")
        throw new ERR_INVALID_ARG_TYPE2(name, "string", value);
    }
    function validateNumber(value, name) {
      if (typeof value !== "number")
        throw new ERR_INVALID_ARG_TYPE2(name, "number", value);
    }
    var validateOneOf = hideStackFrames((value, name, oneOf) => {
      if (!ArrayPrototypeIncludes(oneOf, value)) {
        const reason = "must be one of: " + ArrayPrototypeJoin(ArrayPrototypeMap(oneOf, (v) => typeof v === "string" ? `'${v}'` : String2(v)), ", ");
        throw new ERR_INVALID_ARG_VALUE2(name, value, reason);
      }
    });
    function validateBoolean2(value, name) {
      if (typeof value !== "boolean")
        throw new ERR_INVALID_ARG_TYPE2(name, "boolean", value);
    }
    var validateObject = hideStackFrames((value, name, options) => {
      const useDefaultOptions = options == null, allowArray = useDefaultOptions ? !1 : options.allowArray, allowFunction = useDefaultOptions ? !1 : options.allowFunction;
      if (!(useDefaultOptions ? !1 : options.nullable) && value === null || !allowArray && ArrayIsArray2(value) || typeof value !== "object" && (!allowFunction || typeof value !== "function"))
        throw new ERR_INVALID_ARG_TYPE2(name, "Object", value);
    }), validateArray = hideStackFrames((value, name, minLength = 0) => {
      if (!ArrayIsArray2(value))
        throw new ERR_INVALID_ARG_TYPE2(name, "Array", value);
      if (value.length < minLength) {
        const reason = `must be longer than ${minLength}`;
        throw new ERR_INVALID_ARG_VALUE2(name, value, reason);
      }
    });
    function validateSignalName(signal, name = "signal") {
      if (validateString(signal, name), signals[signal] === void 0) {
        if (signals[StringPrototypeToUpperCase(signal)] !== void 0)
          throw new ERR_UNKNOWN_SIGNAL(signal + " (signals must use all capital letters)");
        throw new ERR_UNKNOWN_SIGNAL(signal);
      }
    }
    var validateBuffer = hideStackFrames((buffer, name = "buffer") => {
      if (!isArrayBufferView(buffer))
        throw new ERR_INVALID_ARG_TYPE2(name, ["Buffer", "TypedArray", "DataView"], buffer);
    });
    function validateEncoding(data, encoding) {
      const normalizedEncoding = normalizeEncoding(encoding), length = data.length;
      if (normalizedEncoding === "hex" && length % 2 !== 0)
        throw new ERR_INVALID_ARG_VALUE2("encoding", encoding, `is invalid for data of length ${length}`);
    }
    function validatePort(port, name = "Port", allowZero = !0) {
      if (typeof port !== "number" && typeof port !== "string" || typeof port === "string" && StringPrototypeTrim(port).length === 0 || +port !== +port >>> 0 || port > 65535 || port === 0 && !allowZero)
        throw new ERR_SOCKET_BAD_PORT(name, port, allowZero);
      return port | 0;
    }
    var validateAbortSignal = hideStackFrames((signal, name) => {
      if (signal !== void 0 && (signal === null || typeof signal !== "object" || !("aborted" in signal)))
        throw new ERR_INVALID_ARG_TYPE2(name, "AbortSignal", signal);
    }), validateFunction = hideStackFrames((value, name) => {
      if (typeof value !== "function")
        throw new ERR_INVALID_ARG_TYPE2(name, "Function", value);
    }), validatePlainFunction = hideStackFrames((value, name) => {
      if (typeof value !== "function" || isAsyncFunction(value))
        throw new ERR_INVALID_ARG_TYPE2(name, "Function", value);
    }), validateUndefined = hideStackFrames((value, name) => {
      if (value !== void 0)
        throw new ERR_INVALID_ARG_TYPE2(name, "undefined", value);
    });
    module.exports = {
      isInt32,
      isUint32,
      parseFileMode,
      validateArray,
      validateBoolean: validateBoolean2,
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
      validateAbortSignal
    };
  }
}), require_utils = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/utils.js"(exports, module) {
    var { Symbol: Symbol2, SymbolAsyncIterator, SymbolIterator } = require_primordials(), kDestroyed = Symbol2("kDestroyed"), kIsErrored = Symbol2("kIsErrored"), kIsReadable = Symbol2("kIsReadable"), kIsDisturbed = Symbol2("kIsDisturbed");
    function isReadableNodeStream(obj, strict = !1) {
      var _obj$_readableState;
      return !!(obj && typeof obj.pipe === "function" && typeof obj.on === "function" && (!strict || typeof obj.pause === "function" && typeof obj.resume === "function") && (!obj._writableState || ((_obj$_readableState = obj._readableState) === null || _obj$_readableState === void 0 ? void 0 : _obj$_readableState.readable) !== !1) && (!obj._writableState || obj._readableState));
    }
    function isWritableNodeStream(obj) {
      var _obj$_writableState;
      return !!(obj && typeof obj.write === "function" && typeof obj.on === "function" && (!obj._readableState || ((_obj$_writableState = obj._writableState) === null || _obj$_writableState === void 0 ? void 0 : _obj$_writableState.writable) !== !1));
    }
    function isDuplexNodeStream(obj) {
      return !!(obj && typeof obj.pipe === "function" && obj._readableState && typeof obj.on === "function" && typeof obj.write === "function");
    }
    function isNodeStream(obj) {
      return obj && (obj._readableState || obj._writableState || typeof obj.write === "function" && typeof obj.on === "function" || typeof obj.pipe === "function" && typeof obj.on === "function");
    }
    function isIterable(obj, isAsync) {
      if (obj == null)
        return !1;
      if (isAsync === !0)
        return typeof obj[SymbolAsyncIterator] === "function";
      if (isAsync === !1)
        return typeof obj[SymbolIterator] === "function";
      return typeof obj[SymbolAsyncIterator] === "function" || typeof obj[SymbolIterator] === "function";
    }
    function isDestroyed(stream) {
      if (!isNodeStream(stream))
        return null;
      const { _writableState: wState, _readableState: rState } = stream, state = wState || rState;
      return !!(stream.destroyed || stream[kDestroyed] || state !== null && state !== void 0 && state.destroyed);
    }
    function isWritableEnded(stream) {
      if (!isWritableNodeStream(stream))
        return null;
      if (stream.writableEnded === !0)
        return !0;
      const wState = stream._writableState;
      if (wState !== null && wState !== void 0 && wState.errored)
        return !1;
      if (typeof (wState === null || wState === void 0 ? void 0 : wState.ended) !== "boolean")
        return null;
      return wState.ended;
    }
    function isWritableFinished(stream, strict) {
      if (!isWritableNodeStream(stream))
        return null;
      if (stream.writableFinished === !0)
        return !0;
      const wState = stream._writableState;
      if (wState !== null && wState !== void 0 && wState.errored)
        return !1;
      if (typeof (wState === null || wState === void 0 ? void 0 : wState.finished) !== "boolean")
        return null;
      return !!(wState.finished || strict === !1 && wState.ended === !0 && wState.length === 0);
    }
    function isReadableEnded(stream) {
      if (!isReadableNodeStream(stream))
        return null;
      if (stream.readableEnded === !0)
        return !0;
      const rState = stream._readableState;
      if (!rState || rState.errored)
        return !1;
      if (typeof (rState === null || rState === void 0 ? void 0 : rState.ended) !== "boolean")
        return null;
      return rState.ended;
    }
    function isReadableFinished(stream, strict) {
      if (!isReadableNodeStream(stream))
        return null;
      const rState = stream._readableState;
      if (rState !== null && rState !== void 0 && rState.errored)
        return !1;
      if (typeof (rState === null || rState === void 0 ? void 0 : rState.endEmitted) !== "boolean")
        return null;
      return !!(rState.endEmitted || strict === !1 && rState.ended === !0 && rState.length === 0);
    }
    function isReadable(stream) {
      if (stream && stream[kIsReadable] != null)
        return stream[kIsReadable];
      if (typeof (stream === null || stream === void 0 ? void 0 : stream.readable) !== "boolean")
        return null;
      if (isDestroyed(stream))
        return !1;
      return isReadableNodeStream(stream) && stream.readable && !isReadableFinished(stream);
    }
    function isWritable(stream) {
      if (typeof (stream === null || stream === void 0 ? void 0 : stream.writable) !== "boolean")
        return null;
      if (isDestroyed(stream))
        return !1;
      return isWritableNodeStream(stream) && stream.writable && !isWritableEnded(stream);
    }
    function isFinished(stream, opts) {
      if (!isNodeStream(stream))
        return null;
      if (isDestroyed(stream))
        return !0;
      if ((opts === null || opts === void 0 ? void 0 : opts.readable) !== !1 && isReadable(stream))
        return !1;
      if ((opts === null || opts === void 0 ? void 0 : opts.writable) !== !1 && isWritable(stream))
        return !1;
      return !0;
    }
    function isWritableErrored(stream) {
      var _stream$_writableStat, _stream$_writableStat2;
      if (!isNodeStream(stream))
        return null;
      if (stream.writableErrored)
        return stream.writableErrored;
      return (_stream$_writableStat = (_stream$_writableStat2 = stream._writableState) === null || _stream$_writableStat2 === void 0 ? void 0 : _stream$_writableStat2.errored) !== null && _stream$_writableStat !== void 0 ? _stream$_writableStat : null;
    }
    function isReadableErrored(stream) {
      var _stream$_readableStat, _stream$_readableStat2;
      if (!isNodeStream(stream))
        return null;
      if (stream.readableErrored)
        return stream.readableErrored;
      return (_stream$_readableStat = (_stream$_readableStat2 = stream._readableState) === null || _stream$_readableStat2 === void 0 ? void 0 : _stream$_readableStat2.errored) !== null && _stream$_readableStat !== void 0 ? _stream$_readableStat : null;
    }
    function isClosed(stream) {
      if (!isNodeStream(stream))
        return null;
      if (typeof stream.closed === "boolean")
        return stream.closed;
      const { _writableState: wState, _readableState: rState } = stream;
      if (typeof (wState === null || wState === void 0 ? void 0 : wState.closed) === "boolean" || typeof (rState === null || rState === void 0 ? void 0 : rState.closed) === "boolean")
        return (wState === null || wState === void 0 ? void 0 : wState.closed) || (rState === null || rState === void 0 ? void 0 : rState.closed);
      if (typeof stream._closed === "boolean" && isOutgoingMessage(stream))
        return stream._closed;
      return null;
    }
    function isOutgoingMessage(stream) {
      return typeof stream._closed === "boolean" && typeof stream._defaultKeepAlive === "boolean" && typeof stream._removedConnection === "boolean" && typeof stream._removedContLen === "boolean";
    }
    function isServerResponse(stream) {
      return typeof stream._sent100 === "boolean" && isOutgoingMessage(stream);
    }
    function isServerRequest(stream) {
      var _stream$req;
      return typeof stream._consuming === "boolean" && typeof stream._dumped === "boolean" && ((_stream$req = stream.req) === null || _stream$req === void 0 ? void 0 : _stream$req.upgradeOrConnect) === void 0;
    }
    function willEmitClose(stream) {
      if (!isNodeStream(stream))
        return null;
      const { _writableState: wState, _readableState: rState } = stream, state = wState || rState;
      return !state && isServerResponse(stream) || !!(state && state.autoDestroy && state.emitClose && state.closed === !1);
    }
    function isDisturbed(stream) {
      var _stream$kIsDisturbed;
      return !!(stream && ((_stream$kIsDisturbed = stream[kIsDisturbed]) !== null && _stream$kIsDisturbed !== void 0 ? _stream$kIsDisturbed : stream.readableDidRead || stream.readableAborted));
    }
    function isErrored(stream) {
      var _ref, _ref2, _ref3, _ref4, _ref5, _stream$kIsErrored, _stream$_readableStat3, _stream$_writableStat3, _stream$_readableStat4, _stream$_writableStat4;
      return !!(stream && ((_ref = (_ref2 = (_ref3 = (_ref4 = (_ref5 = (_stream$kIsErrored = stream[kIsErrored]) !== null && _stream$kIsErrored !== void 0 ? _stream$kIsErrored : stream.readableErrored) !== null && _ref5 !== void 0 ? _ref5 : stream.writableErrored) !== null && _ref4 !== void 0 ? _ref4 : (_stream$_readableStat3 = stream._readableState) === null || _stream$_readableStat3 === void 0 ? void 0 : _stream$_readableStat3.errorEmitted) !== null && _ref3 !== void 0 ? _ref3 : (_stream$_writableStat3 = stream._writableState) === null || _stream$_writableStat3 === void 0 ? void 0 : _stream$_writableStat3.errorEmitted) !== null && _ref2 !== void 0 ? _ref2 : (_stream$_readableStat4 = stream._readableState) === null || _stream$_readableStat4 === void 0 ? void 0 : _stream$_readableStat4.errored) !== null && _ref !== void 0 ? _ref : (_stream$_writableStat4 = stream._writableState) === null || _stream$_writableStat4 === void 0 ? void 0 : _stream$_writableStat4.errored));
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
      willEmitClose
    };
  }
}), require_end_of_stream = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/end-of-stream.js"(exports, module) {
    var { AbortError, codes } = require_errors(), { ERR_INVALID_ARG_TYPE: ERR_INVALID_ARG_TYPE2, ERR_STREAM_PREMATURE_CLOSE } = codes, { once } = require_util(), { validateAbortSignal, validateFunction, validateObject } = require_validators(), { Promise: Promise2 } = require_primordials(), {
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
      willEmitClose: _willEmitClose
    } = require_utils();
    function isRequest(stream) {
      return stream.setHeader && typeof stream.abort === "function";
    }
    var nop = () => {
    };
    function eos(stream, options, callback) {
      var _options$readable, _options$writable;
      if (arguments.length === 2)
        callback = options, options = {};
      else if (options == null)
        options = {};
      else
        validateObject(options, "options");
      validateFunction(callback, "callback"), validateAbortSignal(options.signal, "options.signal"), callback = once(callback);
      const readable = (_options$readable = options.readable) !== null && _options$readable !== void 0 ? _options$readable : isReadableNodeStream(stream), writable = (_options$writable = options.writable) !== null && _options$writable !== void 0 ? _options$writable : isWritableNodeStream(stream);
      if (!isNodeStream(stream))
        throw new ERR_INVALID_ARG_TYPE2("stream", "Stream", stream);
      const { _writableState: wState, _readableState: rState } = stream, onlegacyfinish = () => {
        if (!stream.writable)
          onfinish();
      };
      let willEmitClose = _willEmitClose(stream) && isReadableNodeStream(stream) === readable && isWritableNodeStream(stream) === writable, writableFinished = isWritableFinished(stream, !1);
      const onfinish = () => {
        if (writableFinished = !0, stream.destroyed)
          willEmitClose = !1;
        if (willEmitClose && (!stream.readable || readable))
          return;
        if (!readable || readableFinished)
          callback.call(stream);
      };
      let readableFinished = isReadableFinished(stream, !1);
      const onend = () => {
        if (readableFinished = !0, stream.destroyed)
          willEmitClose = !1;
        if (willEmitClose && (!stream.writable || writable))
          return;
        if (!writable || writableFinished)
          callback.call(stream);
      }, onerror = (err) => {
        callback.call(stream, err);
      };
      let closed = isClosed(stream);
      const onclose = () => {
        closed = !0;
        const errored = isWritableErrored(stream) || isReadableErrored(stream);
        if (errored && typeof errored !== "boolean")
          return callback.call(stream, errored);
        if (readable && !readableFinished && isReadableNodeStream(stream, !0)) {
          if (!isReadableFinished(stream, !1))
            return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE);
        }
        if (writable && !writableFinished) {
          if (!isWritableFinished(stream, !1))
            return callback.call(stream, new ERR_STREAM_PREMATURE_CLOSE);
        }
        callback.call(stream);
      }, onrequest = () => {
        stream.req.on("finish", onfinish);
      };
      if (isRequest(stream)) {
        if (stream.on("complete", onfinish), !willEmitClose)
          stream.on("abort", onclose);
        if (stream.req)
          onrequest();
        else
          stream.on("request", onrequest);
      } else if (writable && !wState)
        stream.on("end", onlegacyfinish), stream.on("close", onlegacyfinish);
      if (!willEmitClose && typeof stream.aborted === "boolean")
        stream.on("aborted", onclose);
      if (stream.on("end", onend), stream.on("finish", onfinish), options.error !== !1)
        stream.on("error", onerror);
      if (stream.on("close", onclose), closed)
        runOnNextTick(onclose);
      else if (wState !== null && wState !== void 0 && wState.errorEmitted || rState !== null && rState !== void 0 && rState.errorEmitted) {
        if (!willEmitClose)
          runOnNextTick(onclose);
      } else if (!readable && (!willEmitClose || isReadable(stream)) && (writableFinished || isWritable(stream) === !1))
        runOnNextTick(onclose);
      else if (!writable && (!willEmitClose || isWritable(stream)) && (readableFinished || isReadable(stream) === !1))
        runOnNextTick(onclose);
      else if (rState && stream.req && stream.aborted)
        runOnNextTick(onclose);
      const cleanup = () => {
        if (callback = nop, stream.removeListener("aborted", onclose), stream.removeListener("complete", onfinish), stream.removeListener("abort", onclose), stream.removeListener("request", onrequest), stream.req)
          stream.req.removeListener("finish", onfinish);
        stream.removeListener("end", onlegacyfinish), stream.removeListener("close", onlegacyfinish), stream.removeListener("finish", onfinish), stream.removeListener("end", onend), stream.removeListener("error", onerror), stream.removeListener("close", onclose);
      };
      if (options.signal && !closed) {
        const abort = () => {
          const endCallback = callback;
          cleanup(), endCallback.call(stream, new AbortError(void 0, {
            cause: options.signal.reason
          }));
        };
        if (options.signal.aborted)
          runOnNextTick(abort);
        else {
          const originalCallback = callback;
          callback = once((...args) => {
            options.signal.removeEventListener("abort", abort), originalCallback.apply(stream, args);
          }), options.signal.addEventListener("abort", abort);
        }
      }
      return cleanup;
    }
    function finished(stream, opts) {
      return new Promise2((resolve, reject) => {
        eos(stream, opts, (err) => {
          if (err)
            reject(err);
          else
            resolve();
        });
      });
    }
    module.exports = eos, module.exports.finished = finished;
  }
}), require_operators = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/operators.js"(exports, module) {
    var AbortController = globalThis.AbortController || __require("abort-controller").AbortController, {
      codes: { ERR_INVALID_ARG_TYPE: ERR_INVALID_ARG_TYPE2, ERR_MISSING_ARGS, ERR_OUT_OF_RANGE },
      AbortError
    } = require_errors(), { validateAbortSignal, validateInteger, validateObject } = require_validators(), kWeakHandler = require_primordials().Symbol("kWeak"), { finished } = require_end_of_stream(), {
      ArrayPrototypePush,
      MathFloor,
      Number: Number2,
      NumberIsNaN,
      Promise: Promise2,
      PromiseReject,
      PromisePrototypeCatch,
      Symbol: Symbol2
    } = require_primordials(), kEmpty = Symbol2("kEmpty"), kEof = Symbol2("kEof");
    function map(fn, options) {
      if (typeof fn !== "function")
        throw new ERR_INVALID_ARG_TYPE2("fn", ["Function", "AsyncFunction"], fn);
      if (options != null)
        validateObject(options, "options");
      if ((options === null || options === void 0 ? void 0 : options.signal) != null)
        validateAbortSignal(options.signal, "options.signal");
      let concurrency = 1;
      if ((options === null || options === void 0 ? void 0 : options.concurrency) != null)
        concurrency = MathFloor(options.concurrency);
      return validateInteger(concurrency, "concurrency", 1), async function* map2() {
        var _options$signal, _options$signal2;
        const ac = new AbortController, stream = this, queue = [], signal = ac.signal, signalOpt = {
          signal
        }, abort = () => ac.abort();
        if (options !== null && options !== void 0 && (_options$signal = options.signal) !== null && _options$signal !== void 0 && _options$signal.aborted)
          abort();
        options === null || options === void 0 || (_options$signal2 = options.signal) === null || _options$signal2 === void 0 || _options$signal2.addEventListener("abort", abort);
        let next, resume, done = !1;
        function onDone() {
          done = !0;
        }
        async function pump() {
          try {
            for await (let val of stream) {
              var _val;
              if (done)
                return;
              if (signal.aborted)
                throw new AbortError;
              try {
                val = fn(val, signalOpt);
              } catch (err) {
                val = PromiseReject(err);
              }
              if (val === kEmpty)
                continue;
              if (typeof ((_val = val) === null || _val === void 0 ? void 0 : _val.catch) === "function")
                val.catch(onDone);
              if (queue.push(val), next)
                next(), next = null;
              if (!done && queue.length && queue.length >= concurrency)
                await new Promise2((resolve) => {
                  resume = resolve;
                });
            }
            queue.push(kEof);
          } catch (err) {
            const val = PromiseReject(err);
            PromisePrototypeCatch(val, onDone), queue.push(val);
          } finally {
            var _options$signal3;
            if (done = !0, next)
              next(), next = null;
            options === null || options === void 0 || (_options$signal3 = options.signal) === null || _options$signal3 === void 0 || _options$signal3.removeEventListener("abort", abort);
          }
        }
        pump();
        try {
          while (!0) {
            while (queue.length > 0) {
              const val = await queue[0];
              if (val === kEof)
                return;
              if (signal.aborted)
                throw new AbortError;
              if (val !== kEmpty)
                yield val;
              if (queue.shift(), resume)
                resume(), resume = null;
            }
            await new Promise2((resolve) => {
              next = resolve;
            });
          }
        } finally {
          if (ac.abort(), done = !0, resume)
            resume(), resume = null;
        }
      }.call(this);
    }
    function asIndexedPairs(options = void 0) {
      if (options != null)
        validateObject(options, "options");
      if ((options === null || options === void 0 ? void 0 : options.signal) != null)
        validateAbortSignal(options.signal, "options.signal");
      return async function* asIndexedPairs2() {
        let index = 0;
        for await (let val of this) {
          var _options$signal4;
          if (options !== null && options !== void 0 && (_options$signal4 = options.signal) !== null && _options$signal4 !== void 0 && _options$signal4.aborted)
            throw new AbortError({
              cause: options.signal.reason
            });
          yield [index++, val];
        }
      }.call(this);
    }
    async function some(fn, options = void 0) {
      for await (let unused of filter.call(this, fn, options))
        return !0;
      return !1;
    }
    async function every(fn, options = void 0) {
      if (typeof fn !== "function")
        throw new ERR_INVALID_ARG_TYPE2("fn", ["Function", "AsyncFunction"], fn);
      return !await some.call(this, async (...args) => {
        return !await fn(...args);
      }, options);
    }
    async function find(fn, options) {
      for await (let result of filter.call(this, fn, options))
        return result;
      return;
    }
    async function forEach(fn, options) {
      if (typeof fn !== "function")
        throw new ERR_INVALID_ARG_TYPE2("fn", ["Function", "AsyncFunction"], fn);
      async function forEachFn(value, options2) {
        return await fn(value, options2), kEmpty;
      }
      for await (let unused of map.call(this, forEachFn, options))
        ;
    }
    function filter(fn, options) {
      if (typeof fn !== "function")
        throw new ERR_INVALID_ARG_TYPE2("fn", ["Function", "AsyncFunction"], fn);
      async function filterFn(value, options2) {
        if (await fn(value, options2))
          return value;
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
      if (typeof reducer !== "function")
        throw new ERR_INVALID_ARG_TYPE2("reducer", ["Function", "AsyncFunction"], reducer);
      if (options != null)
        validateObject(options, "options");
      if ((options === null || options === void 0 ? void 0 : options.signal) != null)
        validateAbortSignal(options.signal, "options.signal");
      let hasInitialValue = arguments.length > 1;
      if (options !== null && options !== void 0 && (_options$signal5 = options.signal) !== null && _options$signal5 !== void 0 && _options$signal5.aborted) {
        const err = new AbortError(void 0, {
          cause: options.signal.reason
        });
        throw this.once("error", () => {
        }), await finished(this.destroy(err)), err;
      }
      const ac = new AbortController, signal = ac.signal;
      if (options !== null && options !== void 0 && options.signal) {
        const opts = {
          once: !0,
          [kWeakHandler]: this
        };
        options.signal.addEventListener("abort", () => ac.abort(), opts);
      }
      let gotAnyItemFromStream = !1;
      try {
        for await (let value of this) {
          var _options$signal6;
          if (gotAnyItemFromStream = !0, options !== null && options !== void 0 && (_options$signal6 = options.signal) !== null && _options$signal6 !== void 0 && _options$signal6.aborted)
            throw new AbortError;
          if (!hasInitialValue)
            initialValue = value, hasInitialValue = !0;
          else
            initialValue = await reducer(initialValue, value, {
              signal
            });
        }
        if (!gotAnyItemFromStream && !hasInitialValue)
          throw new ReduceAwareErrMissingArgs;
      } finally {
        ac.abort();
      }
      return initialValue;
    }
    async function toArray(options) {
      if (options != null)
        validateObject(options, "options");
      if ((options === null || options === void 0 ? void 0 : options.signal) != null)
        validateAbortSignal(options.signal, "options.signal");
      const result = [];
      for await (let val of this) {
        var _options$signal7;
        if (options !== null && options !== void 0 && (_options$signal7 = options.signal) !== null && _options$signal7 !== void 0 && _options$signal7.aborted)
          throw new AbortError(void 0, {
            cause: options.signal.reason
          });
        ArrayPrototypePush(result, val);
      }
      return result;
    }
    function flatMap(fn, options) {
      const values = map.call(this, fn, options);
      return async function* flatMap2() {
        for await (let val of values)
          yield* val;
      }.call(this);
    }
    function toIntegerOrInfinity(number) {
      if (number = Number2(number), NumberIsNaN(number))
        return 0;
      if (number < 0)
        throw new ERR_OUT_OF_RANGE("number", ">= 0", number);
      return number;
    }
    function drop(number, options = void 0) {
      if (options != null)
        validateObject(options, "options");
      if ((options === null || options === void 0 ? void 0 : options.signal) != null)
        validateAbortSignal(options.signal, "options.signal");
      return number = toIntegerOrInfinity(number), async function* drop2() {
        var _options$signal8;
        if (options !== null && options !== void 0 && (_options$signal8 = options.signal) !== null && _options$signal8 !== void 0 && _options$signal8.aborted)
          throw new AbortError;
        for await (let val of this) {
          var _options$signal9;
          if (options !== null && options !== void 0 && (_options$signal9 = options.signal) !== null && _options$signal9 !== void 0 && _options$signal9.aborted)
            throw new AbortError;
          if (number-- <= 0)
            yield val;
        }
      }.call(this);
    }
    function take(number, options = void 0) {
      if (options != null)
        validateObject(options, "options");
      if ((options === null || options === void 0 ? void 0 : options.signal) != null)
        validateAbortSignal(options.signal, "options.signal");
      return number = toIntegerOrInfinity(number), async function* take2() {
        var _options$signal10;
        if (options !== null && options !== void 0 && (_options$signal10 = options.signal) !== null && _options$signal10 !== void 0 && _options$signal10.aborted)
          throw new AbortError;
        for await (let val of this) {
          var _options$signal11;
          if (options !== null && options !== void 0 && (_options$signal11 = options.signal) !== null && _options$signal11 !== void 0 && _options$signal11.aborted)
            throw new AbortError;
          if (number-- > 0)
            yield val;
          else
            return;
        }
      }.call(this);
    }
    module.exports.streamReturningOperators = {
      asIndexedPairs,
      drop,
      filter,
      flatMap,
      map,
      take
    }, module.exports.promiseReturningOperators = {
      every,
      forEach,
      reduce,
      toArray,
      some,
      find
    };
  }
}), require_destroy = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/destroy.js"(exports, module) {
    var {
      aggregateTwoErrors,
      codes: { ERR_MULTIPLE_CALLBACK },
      AbortError
    } = require_errors(), { Symbol: Symbol2 } = require_primordials(), { kDestroyed, isDestroyed, isFinished, isServerRequest } = require_utils(), kDestroy = "#kDestroy", kConstruct = "#kConstruct";
    function checkError(err, w, r) {
      if (err) {
        if (err.stack, w && !w.errored)
          w.errored = err;
        if (r && !r.errored)
          r.errored = err;
      }
    }
    function destroy(err, cb) {
      const r = this._readableState, w = this._writableState, s = w || r;
      if (w && w.destroyed || r && r.destroyed) {
        if (typeof cb === "function")
          cb();
        return this;
      }
      if (checkError(err, w, r), w)
        w.destroyed = !0;
      if (r)
        r.destroyed = !0;
      if (!s.constructed)
        this.once(kDestroy, (er) => {
          _destroy(this, aggregateTwoErrors(er, err), cb);
        });
      else
        _destroy(this, err, cb);
      return this;
    }
    function _destroy(self, err, cb) {
      let called = !1;
      function onDestroy(err2) {
        if (called)
          return;
        called = !0;
        const { _readableState: r, _writableState: w } = self;
        if (checkError(err2, w, r), w)
          w.closed = !0;
        if (r)
          r.closed = !0;
        if (typeof cb === "function")
          cb(err2);
        if (err2)
          runOnNextTick(emitErrorCloseNT, self, err2);
        else
          runOnNextTick(emitCloseNT, self);
      }
      try {
        self._destroy(err || null, onDestroy);
      } catch (err2) {
        onDestroy(err2);
      }
    }
    function emitErrorCloseNT(self, err) {
      emitErrorNT(self, err), emitCloseNT(self);
    }
    function emitCloseNT(self) {
      const { _readableState: r, _writableState: w } = self;
      if (w)
        w.closeEmitted = !0;
      if (r)
        r.closeEmitted = !0;
      if (w && w.emitClose || r && r.emitClose)
        self.emit("close");
    }
    function emitErrorNT(self, err) {
      const r = self?._readableState, w = self?._writableState;
      if (w?.errorEmitted || r?.errorEmitted)
        return;
      if (w)
        w.errorEmitted = !0;
      if (r)
        r.errorEmitted = !0;
      self?.emit?.("error", err);
    }
    function undestroy() {
      const r = this._readableState, w = this._writableState;
      if (r)
        r.constructed = !0, r.closed = !1, r.closeEmitted = !1, r.destroyed = !1, r.errored = null, r.errorEmitted = !1, r.reading = !1, r.ended = r.readable === !1, r.endEmitted = r.readable === !1;
      if (w)
        w.constructed = !0, w.destroyed = !1, w.closed = !1, w.closeEmitted = !1, w.errored = null, w.errorEmitted = !1, w.finalCalled = !1, w.prefinished = !1, w.ended = w.writable === !1, w.ending = w.writable === !1, w.finished = w.writable === !1;
    }
    function errorOrDestroy2(stream, err, sync) {
      const r = stream?._readableState, w = stream?._writableState;
      if (w && w.destroyed || r && r.destroyed)
        return this;
      if (r && r.autoDestroy || w && w.autoDestroy)
        stream.destroy(err);
      else if (err) {
        if (Error.captureStackTrace(err), w && !w.errored)
          w.errored = err;
        if (r && !r.errored)
          r.errored = err;
        if (sync)
          runOnNextTick(emitErrorNT, stream, err);
        else
          emitErrorNT(stream, err);
      }
    }
    function construct(stream, cb) {
      if (typeof stream._construct !== "function")
        return;
      const { _readableState: r, _writableState: w } = stream;
      if (r)
        r.constructed = !1;
      if (w)
        w.constructed = !1;
      if (stream.once(kConstruct, cb), stream.listenerCount(kConstruct) > 1)
        return;
      runOnNextTick(constructNT, stream);
    }
    function constructNT(stream) {
      let called = !1;
      function onConstruct(err) {
        if (called) {
          errorOrDestroy2(stream, err !== null && err !== void 0 ? err : new ERR_MULTIPLE_CALLBACK);
          return;
        }
        called = !0;
        const { _readableState: r, _writableState: w } = stream, s = w || r;
        if (r)
          r.constructed = !0;
        if (w)
          w.constructed = !0;
        if (s.destroyed)
          stream.emit(kDestroy, err);
        else if (err)
          errorOrDestroy2(stream, err, !0);
        else
          runOnNextTick(emitConstructNT, stream);
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
      stream.emit("error", err), runOnNextTick(emitCloseLegacy, stream);
    }
    function destroyer(stream, err) {
      if (!stream || isDestroyed(stream))
        return;
      if (!err && !isFinished(stream))
        err = new AbortError;
      if (isServerRequest(stream))
        stream.socket = null, stream.destroy(err);
      else if (isRequest(stream))
        stream.abort();
      else if (isRequest(stream.req))
        stream.req.abort();
      else if (typeof stream.destroy === "function")
        stream.destroy(err);
      else if (typeof stream.close === "function")
        stream.close();
      else if (err)
        runOnNextTick(emitErrorCloseLegacy, stream);
      else
        runOnNextTick(emitCloseLegacy, stream);
      if (!stream.destroyed)
        stream[kDestroyed] = !0;
    }
    module.exports = {
      construct,
      destroyer,
      destroy,
      undestroy,
      errorOrDestroy: errorOrDestroy2
    };
  }
}), require_legacy = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/legacy.js"(exports, module) {
    var { ArrayIsArray: ArrayIsArray2, ObjectSetPrototypeOf } = require_primordials(), { EventEmitter: _EE2 } = __require("events"), EE;
    if (__TRACK_EE__)
      EE = DebugEventEmitter;
    else
      EE = _EE2;
    function Stream(options) {
      if (!(this instanceof Stream))
        return new Stream(options);
      EE.call(this, options);
    }
    ObjectSetPrototypeOf(Stream.prototype, EE.prototype), ObjectSetPrototypeOf(Stream, EE), Stream.prototype.pipe = function(dest, options) {
      const source = this;
      function ondata(chunk) {
        if (dest.writable && dest.write(chunk) === !1 && source.pause)
          source.pause();
      }
      source.on("data", ondata);
      function ondrain() {
        if (source.readable && source.resume)
          source.resume();
      }
      if (dest.on("drain", ondrain), !dest._isStdio && (!options || options.end !== !1))
        source.on("end", onend), source.on("close", onclose);
      let didOnEnd = !1;
      function onend() {
        if (didOnEnd)
          return;
        didOnEnd = !0, dest.end();
      }
      function onclose() {
        if (didOnEnd)
          return;
        if (didOnEnd = !0, typeof dest.destroy === "function")
          dest.destroy();
      }
      function onerror(er) {
        if (cleanup(), EE.listenerCount(this, "error") === 0)
          this.emit("error", er);
      }
      prependListener(source, "error", onerror), prependListener(dest, "error", onerror);
      function cleanup() {
        source.removeListener("data", ondata), dest.removeListener("drain", ondrain), source.removeListener("end", onend), source.removeListener("close", onclose), source.removeListener("error", onerror), dest.removeListener("error", onerror), source.removeListener("end", cleanup), source.removeListener("close", cleanup), dest.removeListener("close", cleanup);
      }
      return source.on("end", cleanup), source.on("close", cleanup), dest.on("close", cleanup), dest.emit("pipe", source), dest;
    };
    function prependListener(emitter, event, fn) {
      if (typeof emitter.prependListener === "function")
        return emitter.prependListener(event, fn);
      if (!emitter._events || !emitter._events[event])
        emitter.on(event, fn);
      else if (ArrayIsArray2(emitter._events[event]))
        emitter._events[event].unshift(fn);
      else
        emitter._events[event] = [fn, emitter._events[event]];
    }
    module.exports = {
      Stream,
      prependListener
    };
  }
}), require_add_abort_signal = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/add-abort-signal.js"(exports, module) {
    var { AbortError, codes } = require_errors(), eos = require_end_of_stream(), { ERR_INVALID_ARG_TYPE: ERR_INVALID_ARG_TYPE2 } = codes, validateAbortSignal = (signal, name) => {
      if (typeof signal !== "object" || !("aborted" in signal))
        throw new ERR_INVALID_ARG_TYPE2(name, "AbortSignal", signal);
    };
    function isNodeStream(obj) {
      return !!(obj && typeof obj.pipe === "function");
    }
    module.exports.addAbortSignal = function addAbortSignal(signal, stream) {
      if (validateAbortSignal(signal, "signal"), !isNodeStream(stream))
        throw new ERR_INVALID_ARG_TYPE2("stream", "stream.Stream", stream);
      return module.exports.addAbortSignalNoValidate(signal, stream);
    }, module.exports.addAbortSignalNoValidate = function(signal, stream) {
      if (typeof signal !== "object" || !("aborted" in signal))
        return stream;
      const onAbort = () => {
        stream.destroy(new AbortError(void 0, {
          cause: signal.reason
        }));
      };
      if (signal.aborted)
        onAbort();
      else
        signal.addEventListener("abort", onAbort), eos(stream, () => signal.removeEventListener("abort", onAbort));
      return stream;
    };
  }
}), require_state = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/state.js"(exports, module) {
    var { MathFloor, NumberIsInteger } = require_primordials(), { ERR_INVALID_ARG_VALUE: ERR_INVALID_ARG_VALUE2 } = require_errors().codes;
    function highWaterMarkFrom(options, isDuplex, duplexKey) {
      return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
    }
    function getDefaultHighWaterMark(objectMode) {
      return objectMode ? 16 : 16384;
    }
    function getHighWaterMark(state, options, duplexKey, isDuplex) {
      const hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
      if (hwm != null) {
        if (!NumberIsInteger(hwm) || hwm < 0) {
          const name = isDuplex ? `options.${duplexKey}` : "options.highWaterMark";
          throw new ERR_INVALID_ARG_VALUE2(name, hwm);
        }
        return MathFloor(hwm);
      }
      return getDefaultHighWaterMark(state.objectMode);
    }
    module.exports = {
      getHighWaterMark,
      getDefaultHighWaterMark
    };
  }
}), require_from = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/from.js"(exports, module) {
    var { PromisePrototypeThen, SymbolAsyncIterator, SymbolIterator } = require_primordials(), { ERR_INVALID_ARG_TYPE: ERR_INVALID_ARG_TYPE2, ERR_STREAM_NULL_VALUES } = require_errors().codes;
    function from(Readable, iterable, opts) {
      let iterator;
      if (typeof iterable === "string" || iterable instanceof Buffer)
        return new Readable({
          objectMode: !0,
          ...opts,
          read() {
            this.push(iterable), this.push(null);
          }
        });
      let isAsync;
      if (iterable && iterable[SymbolAsyncIterator])
        isAsync = !0, iterator = iterable[SymbolAsyncIterator]();
      else if (iterable && iterable[SymbolIterator])
        isAsync = !1, iterator = iterable[SymbolIterator]();
      else
        throw new ERR_INVALID_ARG_TYPE2("iterable", ["Iterable"], iterable);
      const readable = new Readable({
        objectMode: !0,
        highWaterMark: 1,
        ...opts
      });
      let reading = !1;
      readable._read = function() {
        if (!reading)
          reading = !0, next();
      }, readable._destroy = function(error, cb) {
        PromisePrototypeThen(close(error), () => runOnNextTick(cb, error), (e) => runOnNextTick(cb, e || error));
      };
      async function close(error) {
        const hadError = error !== void 0 && error !== null, hasThrow = typeof iterator.throw === "function";
        if (hadError && hasThrow) {
          const { value, done } = await iterator.throw(error);
          if (await value, done)
            return;
        }
        if (typeof iterator.return === "function") {
          const { value } = await iterator.return();
          await value;
        }
      }
      async function next() {
        for (;; ) {
          try {
            const { value, done } = isAsync ? await iterator.next() : iterator.next();
            if (done)
              readable.push(null);
            else {
              const res = value && typeof value.then === "function" ? await value : value;
              if (res === null)
                throw reading = !1, new ERR_STREAM_NULL_VALUES;
              else if (readable.push(res))
                continue;
              else
                reading = !1;
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
  }
}), _ReadableFromWeb, require_readable = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/readable.js"(exports, module) {
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
      Symbol: Symbol2
    } = require_primordials(), ReadableState = globalThis[Symbol.for("Bun.lazy")]("bun:stream").ReadableState, { EventEmitter: EE } = __require("events"), { Stream, prependListener } = require_legacy();
    function Readable(options) {
      if (!(this instanceof Readable))
        return new Readable(options);
      const isDuplex = this instanceof require_duplex();
      if (this._readableState = new ReadableState(options, this, isDuplex), options) {
        const { read, destroy, construct, signal } = options;
        if (typeof read === "function")
          this._read = read;
        if (typeof destroy === "function")
          this._destroy = destroy;
        if (typeof construct === "function")
          this._construct = construct;
        if (signal && !isDuplex)
          addAbortSignal(signal, this);
      }
      Stream.call(this, options), destroyImpl.construct(this, () => {
        if (this._readableState.needReadable)
          maybeReadMore(this, this._readableState);
      });
    }
    ObjectSetPrototypeOf(Readable.prototype, Stream.prototype), ObjectSetPrototypeOf(Readable, Stream), Readable.prototype.on = function(ev, fn) {
      const res = Stream.prototype.on.call(this, ev, fn), state = this._readableState;
      if (ev === "data")
        if (state.readableListening = this.listenerCount("readable") > 0, state.flowing !== !1)
          __DEBUG__ && debug("in flowing mode!", this.__id), this.resume();
        else
          __DEBUG__ && debug("in readable mode!", this.__id);
      else if (ev === "readable") {
        if (__DEBUG__ && debug("readable listener added!", this.__id), !state.endEmitted && !state.readableListening) {
          if (state.readableListening = state.needReadable = !0, state.flowing = !1, state.emittedReadable = !1, __DEBUG__ && debug("on readable - state.length, reading, emittedReadable", state.length, state.reading, state.emittedReadable, this.__id), state.length)
            emitReadable(this, state);
          else if (!state.reading)
            runOnNextTick(nReadingNextTick, this);
        } else if (state.endEmitted)
          __DEBUG__ && debug("end already emitted...", this.__id);
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
          signal
        });
        this.#pendingChunks = [], this.#reader = void 0, this.#stream = stream, this.#closed = !1;
      }
      #drainPending() {
        var pendingChunks = this.#pendingChunks, pendingChunksI = 0, pendingChunksCount = pendingChunks.length;
        for (;pendingChunksI < pendingChunksCount; pendingChunksI++) {
          const chunk = pendingChunks[pendingChunksI];
          if (pendingChunks[pendingChunksI] = void 0, !this.push(chunk, void 0))
            return this.#pendingChunks = pendingChunks.slice(pendingChunksI + 1), !0;
        }
        if (pendingChunksCount > 0)
          this.#pendingChunks = [];
        return !1;
      }
      #handleDone(reader) {
        reader.releaseLock(), this.#reader = void 0, this.#closed = !0, this.push(null);
        return;
      }
      async _read() {
        __DEBUG__ && debug("ReadableFromWeb _read()", this.__id);
        var stream = this.#stream, reader = this.#reader;
        if (stream)
          reader = this.#reader = stream.getReader(), this.#stream = void 0;
        else if (this.#drainPending())
          return;
        var deferredError;
        try {
          do {
            var done = !1, value;
            const firstResult = reader.readMany();
            if (isPromise(firstResult)) {
              if ({ done, value } = await firstResult, this.#closed) {
                this.#pendingChunks.push(...value);
                return;
              }
            } else
              ({ done, value } = firstResult);
            if (done) {
              this.#handleDone(reader);
              return;
            }
            if (!this.push(value[0])) {
              this.#pendingChunks = value.slice(1);
              return;
            }
            for (let i = 1, count = value.length;i < count; i++)
              if (!this.push(value[i])) {
                this.#pendingChunks = value.slice(i + 1);
                return;
              }
          } while (!this.#closed);
        } catch (e) {
          deferredError = e;
        } finally {
          if (deferredError)
            throw deferredError;
        }
      }
      _destroy(error, callback) {
        if (!this.#closed) {
          var reader = this.#reader;
          if (reader)
            this.#reader = void 0, reader.cancel(error).finally(() => {
              this.#closed = !0, callback(error);
            });
          return;
        }
        try {
          callback(error);
        } catch (error2) {
          globalThis.reportError(error2);
        }
      }
    }
    function newStreamReadableFromReadableStream(readableStream, options = {}) {
      if (!isReadableStream(readableStream))
        throw new ERR_INVALID_ARG_TYPE2("readableStream", "ReadableStream", readableStream);
      validateObject(options, "options");
      const {
        highWaterMark,
        encoding,
        objectMode = !1,
        signal
      } = options;
      if (encoding !== void 0 && !Buffer.isEncoding(encoding))
        throw new ERR_INVALID_ARG_VALUE(encoding, "options.encoding");
      return validateBoolean(objectMode, "options.objectMode"), getNativeReadableStream(Readable, readableStream, options) || new ReadableFromWeb({
        highWaterMark,
        encoding,
        objectMode,
        signal
      }, readableStream);
    }
    module.exports = Readable, _ReadableFromWeb = ReadableFromWeb;
    var { addAbortSignal } = require_add_abort_signal(), eos = require_end_of_stream();
    const {
      maybeReadMore: _maybeReadMore,
      resume,
      emitReadable: _emitReadable,
      onEofChunk
    } = globalThis[Symbol.for("Bun.lazy")]("bun:stream");
    function maybeReadMore(stream, state) {
      process.nextTick(_maybeReadMore, stream, state);
    }
    function emitReadable(stream, state) {
      __DEBUG__ && debug("NativeReadable - emitReadable", stream.__id), _emitReadable(stream, state);
    }
    var destroyImpl = require_destroy(), {
      aggregateTwoErrors,
      codes: {
        ERR_INVALID_ARG_TYPE: ERR_INVALID_ARG_TYPE2,
        ERR_METHOD_NOT_IMPLEMENTED,
        ERR_OUT_OF_RANGE,
        ERR_STREAM_PUSH_AFTER_EOF,
        ERR_STREAM_UNSHIFT_AFTER_END_EVENT
      }
    } = require_errors(), { validateObject } = require_validators(), { StringDecoder } = __require("string_decoder"), from = require_from(), nop = () => {
    }, { errorOrDestroy: errorOrDestroy2 } = destroyImpl;
    Readable.prototype.destroy = destroyImpl.destroy, Readable.prototype._undestroy = destroyImpl.undestroy, Readable.prototype._destroy = function(err, cb) {
      cb(err);
    }, Readable.prototype[EE.captureRejectionSymbol] = function(err) {
      this.destroy(err);
    }, Readable.prototype.push = function(chunk, encoding) {
      return readableAddChunk(this, chunk, encoding, !1);
    }, Readable.prototype.unshift = function(chunk, encoding) {
      return readableAddChunk(this, chunk, encoding, !0);
    };
    function readableAddChunk(stream, chunk, encoding, addToFront) {
      __DEBUG__ && debug("readableAddChunk", chunk, stream.__id);
      const state = stream._readableState;
      let err;
      if (!state.objectMode) {
        if (typeof chunk === "string") {
          if (encoding = encoding || state.defaultEncoding, state.encoding !== encoding)
            if (addToFront && state.encoding)
              chunk = Buffer.from(chunk, encoding).toString(state.encoding);
            else
              chunk = Buffer.from(chunk, encoding), encoding = "";
        } else if (chunk instanceof Buffer)
          encoding = "";
        else if (Stream._isUint8Array(chunk)) {
          if (addToFront || !state.decoder)
            chunk = Stream._uint8ArrayToBuffer(chunk);
          encoding = "";
        } else if (chunk != null)
          err = new ERR_INVALID_ARG_TYPE2("chunk", ["string", "Buffer", "Uint8Array"], chunk);
      }
      if (err)
        errorOrDestroy2(stream, err);
      else if (chunk === null)
        state.reading = !1, onEofChunk(stream, state);
      else if (state.objectMode || chunk && chunk.length > 0)
        if (addToFront)
          if (state.endEmitted)
            errorOrDestroy2(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT);
          else if (state.destroyed || state.errored)
            return !1;
          else
            addChunk(stream, state, chunk, !0);
        else if (state.ended)
          errorOrDestroy2(stream, new ERR_STREAM_PUSH_AFTER_EOF);
        else if (state.destroyed || state.errored)
          return !1;
        else if (state.reading = !1, state.decoder && !encoding)
          if (chunk = state.decoder.write(chunk), state.objectMode || chunk.length !== 0)
            addChunk(stream, state, chunk, !1);
          else
            maybeReadMore(stream, state);
        else
          addChunk(stream, state, chunk, !1);
      else if (!addToFront)
        state.reading = !1, maybeReadMore(stream, state);
      return !state.ended && (state.length < state.highWaterMark || state.length === 0);
    }
    function addChunk(stream, state, chunk, addToFront) {
      if (__DEBUG__ && debug("adding chunk", stream.__id), __DEBUG__ && debug("chunk", chunk.toString(), stream.__id), state.flowing && state.length === 0 && !state.sync && stream.listenerCount("data") > 0) {
        if (state.multiAwaitDrain)
          state.awaitDrainWriters.clear();
        else
          state.awaitDrainWriters = null;
        state.dataEmitted = !0, stream.emit("data", chunk);
      } else {
        if (state.length += state.objectMode ? 1 : chunk.length, addToFront)
          state.buffer.unshift(chunk);
        else
          state.buffer.push(chunk);
        if (__DEBUG__ && debug("needReadable @ addChunk", state.needReadable, stream.__id), state.needReadable)
          emitReadable(stream, state);
      }
      maybeReadMore(stream, state);
    }
    Readable.prototype.isPaused = function() {
      const state = this._readableState;
      return state.paused === !0 || state.flowing === !1;
    }, Readable.prototype.setEncoding = function(enc) {
      const decoder = new StringDecoder(enc);
      this._readableState.decoder = decoder, this._readableState.encoding = this._readableState.decoder.encoding;
      const buffer = this._readableState.buffer;
      let content = "";
      for (let i = buffer.length;i > 0; i--)
        content += decoder.write(buffer.shift());
      if (content !== "")
        buffer.push(content);
      return this._readableState.length = content.length, this;
    };
    var MAX_HWM = 1073741824;
    function computeNewHighWaterMark(n) {
      if (n > MAX_HWM)
        throw new ERR_OUT_OF_RANGE("size", "<= 1GiB", n);
      else
        n--, n |= n >>> 1, n |= n >>> 2, n |= n >>> 4, n |= n >>> 8, n |= n >>> 16, n++;
      return n;
    }
    function howMuchToRead(n, state) {
      if (n <= 0 || state.length === 0 && state.ended)
        return 0;
      if (state.objectMode)
        return 1;
      if (NumberIsNaN(n)) {
        if (state.flowing && state.length)
          return state.buffer.first().length;
        return state.length;
      }
      if (n <= state.length)
        return n;
      return state.ended ? state.length : 0;
    }
    Readable.prototype.read = function(n) {
      if (__DEBUG__ && debug("read - n =", n, this.__id), !NumberIsInteger(n))
        n = NumberParseInt(n, 10);
      const state = this._readableState, nOrig = n;
      if (n > state.highWaterMark)
        state.highWaterMark = computeNewHighWaterMark(n);
      if (n !== 0)
        state.emittedReadable = !1;
      if (n === 0 && state.needReadable && ((state.highWaterMark !== 0 ? state.length >= state.highWaterMark : state.length > 0) || state.ended)) {
        if (__DEBUG__ && debug("read: emitReadable or endReadable", state.length, state.ended, this.__id), state.length === 0 && state.ended)
          endReadable(this);
        else
          emitReadable(this, state);
        return null;
      }
      if (n = howMuchToRead(n, state), n === 0 && state.ended) {
        if (__DEBUG__ && debug("read: calling endReadable if length 0 -- length, state.ended", state.length, state.ended, this.__id), state.length === 0)
          endReadable(this);
        return null;
      }
      let doRead = state.needReadable;
      if (__DEBUG__ && debug("need readable", doRead, this.__id), state.length === 0 || state.length - n < state.highWaterMark)
        doRead = !0, __DEBUG__ && debug("length less than watermark", doRead, this.__id);
      if (state.ended || state.reading || state.destroyed || state.errored || !state.constructed)
        __DEBUG__ && debug("state.constructed?", state.constructed, this.__id), doRead = !1, __DEBUG__ && debug("reading, ended or constructing", doRead, this.__id);
      else if (doRead) {
        if (__DEBUG__ && debug("do read", this.__id), state.reading = !0, state.sync = !0, state.length === 0)
          state.needReadable = !0;
        try {
          var result = this._read(state.highWaterMark);
          if (isPromise(result)) {
            __DEBUG__ && debug("async _read", this.__id);
            const peeked = Bun.peek(result);
            if (__DEBUG__ && debug("peeked promise", peeked, this.__id), peeked !== result)
              result = peeked;
          }
          if (isPromise(result) && result?.then && isCallable(result.then))
            __DEBUG__ && debug("async _read result.then setup", this.__id), result.then(nop, function(err) {
              errorOrDestroy2(this, err);
            });
        } catch (err) {
          errorOrDestroy2(this, err);
        }
        if (state.sync = !1, !state.reading)
          n = howMuchToRead(nOrig, state);
      }
      __DEBUG__ && debug("n @ fromList", n, this.__id);
      let ret;
      if (n > 0)
        ret = fromList(n, state);
      else
        ret = null;
      if (__DEBUG__ && debug("ret @ read", ret, this.__id), ret === null)
        state.needReadable = state.length <= state.highWaterMark, __DEBUG__ && debug("state.length while ret = null", state.length, this.__id), n = 0;
      else if (state.length -= n, state.multiAwaitDrain)
        state.awaitDrainWriters.clear();
      else
        state.awaitDrainWriters = null;
      if (state.length === 0) {
        if (!state.ended)
          state.needReadable = !0;
        if (nOrig !== n && state.ended)
          endReadable(this);
      }
      if (ret !== null && !state.errorEmitted && !state.closeEmitted)
        state.dataEmitted = !0, this.emit("data", ret);
      return ret;
    }, Readable.prototype._read = function(n) {
      throw new ERR_METHOD_NOT_IMPLEMENTED("_read()");
    }, Readable.prototype.pipe = function(dest, pipeOpts) {
      const src = this, state = this._readableState;
      if (state.pipes.length === 1) {
        if (!state.multiAwaitDrain)
          state.multiAwaitDrain = !0, state.awaitDrainWriters = new SafeSet(state.awaitDrainWriters ? [state.awaitDrainWriters] : []);
      }
      state.pipes.push(dest), __DEBUG__ && debug("pipe count=%d opts=%j", state.pipes.length, pipeOpts, src.__id);
      const endFn = (!pipeOpts || pipeOpts.end !== !1) && dest !== process.stdout && dest !== process.stderr ? onend : unpipe;
      if (state.endEmitted)
        runOnNextTick(endFn);
      else
        src.once("end", endFn);
      dest.on("unpipe", onunpipe);
      function onunpipe(readable, unpipeInfo) {
        if (__DEBUG__ && debug("onunpipe", src.__id), readable === src) {
          if (unpipeInfo && unpipeInfo.hasUnpiped === !1)
            unpipeInfo.hasUnpiped = !0, cleanup();
        }
      }
      function onend() {
        __DEBUG__ && debug("onend", src.__id), dest.end();
      }
      let ondrain, cleanedUp = !1;
      function cleanup() {
        if (__DEBUG__ && debug("cleanup", src.__id), dest.removeListener("close", onclose), dest.removeListener("finish", onfinish), ondrain)
          dest.removeListener("drain", ondrain);
        if (dest.removeListener("error", onerror), dest.removeListener("unpipe", onunpipe), src.removeListener("end", onend), src.removeListener("end", unpipe), src.removeListener("data", ondata), cleanedUp = !0, ondrain && state.awaitDrainWriters && (!dest._writableState || dest._writableState.needDrain))
          ondrain();
      }
      function pause() {
        if (!cleanedUp) {
          if (state.pipes.length === 1 && state.pipes[0] === dest)
            __DEBUG__ && debug("false write response, pause", 0, src.__id), state.awaitDrainWriters = dest, state.multiAwaitDrain = !1;
          else if (state.pipes.length > 1 && state.pipes.includes(dest))
            __DEBUG__ && debug("false write response, pause", state.awaitDrainWriters.size, src.__id), state.awaitDrainWriters.add(dest);
          src.pause();
        }
        if (!ondrain)
          ondrain = pipeOnDrain(src, dest), dest.on("drain", ondrain);
      }
      src.on("data", ondata);
      function ondata(chunk) {
        __DEBUG__ && debug("ondata", src.__id);
        const ret = dest.write(chunk);
        if (__DEBUG__ && debug("dest.write", ret, src.__id), ret === !1)
          pause();
      }
      function onerror(er) {
        if (debug("onerror", er), unpipe(), dest.removeListener("error", onerror), dest.listenerCount("error") === 0) {
          const s = dest._writableState || dest._readableState;
          if (s && !s.errorEmitted)
            errorOrDestroy2(dest, er);
          else
            dest.emit("error", er);
        }
      }
      prependListener(dest, "error", onerror);
      function onclose() {
        dest.removeListener("finish", onfinish), unpipe();
      }
      dest.once("close", onclose);
      function onfinish() {
        debug("onfinish"), dest.removeListener("close", onclose), unpipe();
      }
      dest.once("finish", onfinish);
      function unpipe() {
        debug("unpipe"), src.unpipe(dest);
      }
      if (dest.emit("pipe", src), dest.writableNeedDrain === !0) {
        if (state.flowing)
          pause();
      } else if (!state.flowing)
        debug("pipe resume"), src.resume();
      return dest;
    };
    function pipeOnDrain(src, dest) {
      return function pipeOnDrainFunctionResult() {
        const state = src._readableState;
        if (state.awaitDrainWriters === dest)
          debug("pipeOnDrain", 1), state.awaitDrainWriters = null;
        else if (state.multiAwaitDrain)
          debug("pipeOnDrain", state.awaitDrainWriters.size), state.awaitDrainWriters.delete(dest);
        if ((!state.awaitDrainWriters || state.awaitDrainWriters.size === 0) && src.listenerCount("data"))
          src.resume();
      };
    }
    Readable.prototype.unpipe = function(dest) {
      const state = this._readableState, unpipeInfo = {
        hasUnpiped: !1
      };
      if (state.pipes.length === 0)
        return this;
      if (!dest) {
        const dests = state.pipes;
        state.pipes = [], this.pause();
        for (let i = 0;i < dests.length; i++)
          dests[i].emit("unpipe", this, {
            hasUnpiped: !1
          });
        return this;
      }
      const index = ArrayPrototypeIndexOf(state.pipes, dest);
      if (index === -1)
        return this;
      if (state.pipes.splice(index, 1), state.pipes.length === 0)
        this.pause();
      return dest.emit("unpipe", this, unpipeInfo), this;
    }, Readable.prototype.addListener = Readable.prototype.on, Readable.prototype.removeListener = function(ev, fn) {
      const res = Stream.prototype.removeListener.call(this, ev, fn);
      if (ev === "readable")
        runOnNextTick(updateReadableListening, this);
      return res;
    }, Readable.prototype.off = Readable.prototype.removeListener, Readable.prototype.removeAllListeners = function(ev) {
      const res = Stream.prototype.removeAllListeners.apply(this, arguments);
      if (ev === "readable" || ev === void 0)
        runOnNextTick(updateReadableListening, this);
      return res;
    };
    function updateReadableListening(self) {
      const state = self._readableState;
      if (state.readableListening = self.listenerCount("readable") > 0, state.resumeScheduled && state.paused === !1)
        state.flowing = !0;
      else if (self.listenerCount("data") > 0)
        self.resume();
      else if (!state.readableListening)
        state.flowing = null;
    }
    function nReadingNextTick(self) {
      __DEBUG__ && debug("on readable nextTick, calling read(0)", self.__id), self.read(0);
    }
    Readable.prototype.resume = function() {
      const state = this._readableState;
      if (!state.flowing)
        __DEBUG__ && debug("resume", this.__id), state.flowing = !state.readableListening, resume(this, state);
      return state.paused = !1, this;
    }, Readable.prototype.pause = function() {
      if (__DEBUG__ && debug("call pause flowing=%j", this._readableState.flowing, this.__id), this._readableState.flowing !== !1)
        __DEBUG__ && debug("pause", this.__id), this._readableState.flowing = !1, this.emit("pause");
      return this._readableState.paused = !0, this;
    }, Readable.prototype.wrap = function(stream) {
      let paused = !1;
      stream.on("data", (chunk) => {
        if (!this.push(chunk) && stream.pause)
          paused = !0, stream.pause();
      }), stream.on("end", () => {
        this.push(null);
      }), stream.on("error", (err) => {
        errorOrDestroy2(this, err);
      }), stream.on("close", () => {
        this.destroy();
      }), stream.on("destroy", () => {
        this.destroy();
      }), this._read = () => {
        if (paused && stream.resume)
          paused = !1, stream.resume();
      };
      const streamKeys = ObjectKeys(stream);
      for (let j = 1;j < streamKeys.length; j++) {
        const i = streamKeys[j];
        if (this[i] === void 0 && typeof stream[i] === "function")
          this[i] = stream[i].bind(stream);
      }
      return this;
    }, Readable.prototype[SymbolAsyncIterator] = function() {
      return streamToAsyncIterator(this);
    }, Readable.prototype.iterator = function(options) {
      if (options !== void 0)
        validateObject(options, "options");
      return streamToAsyncIterator(this, options);
    };
    function streamToAsyncIterator(stream, options) {
      if (typeof stream.read !== "function")
        stream = Readable.wrap(stream, {
          objectMode: !0
        });
      const iter = createAsyncIterator(stream, options);
      return iter.stream = stream, iter;
    }
    async function* createAsyncIterator(stream, options) {
      let callback = nop;
      function next(resolve) {
        if (this === stream)
          callback(), callback = nop;
        else
          callback = resolve;
      }
      stream.on("readable", next);
      let error;
      const cleanup = eos(stream, {
        writable: !1
      }, (err) => {
        error = err ? aggregateTwoErrors(error, err) : null, callback(), callback = nop;
      });
      try {
        while (!0) {
          const chunk = stream.destroyed ? null : stream.read();
          if (chunk !== null)
            yield chunk;
          else if (error)
            throw error;
          else if (error === null)
            return;
          else
            await new Promise2(next);
        }
      } catch (err) {
        throw error = aggregateTwoErrors(error, err), error;
      } finally {
        if ((error || (options === null || options === void 0 ? void 0 : options.destroyOnReturn) !== !1) && (error === void 0 || stream._readableState.autoDestroy))
          destroyImpl.destroyer(stream, null);
        else
          stream.off("readable", next), cleanup();
      }
    }
    ObjectDefineProperties(Readable.prototype, {
      readable: {
        get() {
          const r = this._readableState;
          return !!r && r.readable !== !1 && !r.destroyed && !r.errorEmitted && !r.endEmitted;
        },
        set(val) {
          if (this._readableState)
            this._readableState.readable = !!val;
        }
      },
      readableDidRead: {
        enumerable: !1,
        get: function() {
          return this._readableState.dataEmitted;
        }
      },
      readableAborted: {
        enumerable: !1,
        get: function() {
          return !!(this._readableState.readable !== !1 && (this._readableState.destroyed || this._readableState.errored) && !this._readableState.endEmitted);
        }
      },
      readableHighWaterMark: {
        enumerable: !1,
        get: function() {
          return this._readableState.highWaterMark;
        }
      },
      readableBuffer: {
        enumerable: !1,
        get: function() {
          return this._readableState && this._readableState.buffer;
        }
      },
      readableFlowing: {
        enumerable: !1,
        get: function() {
          return this._readableState.flowing;
        },
        set: function(state) {
          if (this._readableState)
            this._readableState.flowing = state;
        }
      },
      readableLength: {
        enumerable: !1,
        get() {
          return this._readableState.length;
        }
      },
      readableObjectMode: {
        enumerable: !1,
        get() {
          return this._readableState ? this._readableState.objectMode : !1;
        }
      },
      readableEncoding: {
        enumerable: !1,
        get() {
          return this._readableState ? this._readableState.encoding : null;
        }
      },
      errored: {
        enumerable: !1,
        get() {
          return this._readableState ? this._readableState.errored : null;
        }
      },
      closed: {
        get() {
          return this._readableState ? this._readableState.closed : !1;
        }
      },
      destroyed: {
        enumerable: !1,
        get() {
          return this._readableState ? this._readableState.destroyed : !1;
        },
        set(value) {
          if (!this._readableState)
            return;
          this._readableState.destroyed = value;
        }
      },
      readableEnded: {
        enumerable: !1,
        get() {
          return this._readableState ? this._readableState.endEmitted : !1;
        }
      }
    }), Readable._fromList = fromList;
    function fromList(n, state) {
      if (state.length === 0)
        return null;
      let ret;
      if (state.objectMode)
        ret = state.buffer.shift();
      else if (!n || n >= state.length) {
        if (state.decoder)
          ret = state.buffer.join("");
        else if (state.buffer.length === 1)
          ret = state.buffer.first();
        else
          ret = state.buffer.concat(state.length);
        state.buffer.clear();
      } else
        ret = state.buffer.consume(n, state.decoder);
      return ret;
    }
    function endReadable(stream) {
      const state = stream._readableState;
      if (__DEBUG__ && debug("endEmitted @ endReadable", state.endEmitted, stream.__id), !state.endEmitted)
        state.ended = !0, runOnNextTick(endReadableNT, state, stream);
    }
    function endReadableNT(state, stream) {
      if (__DEBUG__ && debug("endReadableNT -- endEmitted, state.length", state.endEmitted, state.length, stream.__id), !state.errored && !state.closeEmitted && !state.endEmitted && state.length === 0) {
        if (state.endEmitted = !0, stream.emit("end"), __DEBUG__ && debug("end emitted @ endReadableNT", stream.__id), stream.writable && stream.allowHalfOpen === !1)
          runOnNextTick(endWritableNT, stream);
        else if (state.autoDestroy) {
          const wState = stream._writableState;
          if (!wState || wState.autoDestroy && (wState.finished || wState.writable === !1))
            stream.destroy();
        }
      }
    }
    function endWritableNT(stream) {
      if (stream.writable && !stream.writableEnded && !stream.destroyed)
        stream.end();
    }
    Readable.from = function(iterable, opts) {
      return from(Readable, iterable, opts);
    };
    var webStreamsAdapters = {
      newStreamReadableFromReadableStream
    };
    function lazyWebStreams() {
      if (webStreamsAdapters === void 0)
        webStreamsAdapters = {};
      return webStreamsAdapters;
    }
    Readable.fromWeb = function(readableStream, options) {
      return lazyWebStreams().newStreamReadableFromReadableStream(readableStream, options);
    }, Readable.toWeb = function(streamReadable) {
      return lazyWebStreams().newReadableStreamFromStreamReadable(streamReadable);
    }, Readable.wrap = function(src, options) {
      var _ref, _src$readableObjectMo;
      return new Readable({
        objectMode: (_ref = (_src$readableObjectMo = src.readableObjectMode) !== null && _src$readableObjectMo !== void 0 ? _src$readableObjectMo : src.objectMode) !== null && _ref !== void 0 ? _ref : !0,
        ...options,
        destroy(err, callback) {
          destroyImpl.destroyer(src, err), callback(err);
        }
      }).wrap(src);
    };
  }
}), require_writable = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/writable.js"(exports, module) {
    var {
      ArrayPrototypeSlice,
      Error: Error2,
      FunctionPrototypeSymbolHasInstance,
      ObjectDefineProperty,
      ObjectDefineProperties,
      ObjectSetPrototypeOf,
      StringPrototypeToLowerCase,
      Symbol: Symbol2,
      SymbolHasInstance
    } = require_primordials(), { EventEmitter: EE } = __require("events"), Stream = require_legacy().Stream, destroyImpl = require_destroy(), { addAbortSignal } = require_add_abort_signal(), { getHighWaterMark, getDefaultHighWaterMark } = require_state(), {
      ERR_INVALID_ARG_TYPE: ERR_INVALID_ARG_TYPE2,
      ERR_METHOD_NOT_IMPLEMENTED,
      ERR_MULTIPLE_CALLBACK,
      ERR_STREAM_CANNOT_PIPE,
      ERR_STREAM_DESTROYED,
      ERR_STREAM_ALREADY_FINISHED,
      ERR_STREAM_NULL_VALUES,
      ERR_STREAM_WRITE_AFTER_END,
      ERR_UNKNOWN_ENCODING
    } = require_errors().codes, { errorOrDestroy: errorOrDestroy2 } = destroyImpl;
    function Writable(options = {}) {
      const isDuplex = this instanceof require_duplex();
      if (!isDuplex && !FunctionPrototypeSymbolHasInstance(Writable, this))
        return new Writable(options);
      if (this._writableState = new WritableState(options, this, isDuplex), options) {
        if (typeof options.write === "function")
          this._write = options.write;
        if (typeof options.writev === "function")
          this._writev = options.writev;
        if (typeof options.destroy === "function")
          this._destroy = options.destroy;
        if (typeof options.final === "function")
          this._final = options.final;
        if (typeof options.construct === "function")
          this._construct = options.construct;
        if (options.signal)
          addAbortSignal(options.signal, this);
      }
      Stream.call(this, options), destroyImpl.construct(this, () => {
        const state = this._writableState;
        if (!state.writing)
          clearBuffer(this, state);
        finishMaybe(this, state);
      });
    }
    ObjectSetPrototypeOf(Writable.prototype, Stream.prototype), ObjectSetPrototypeOf(Writable, Stream), module.exports = Writable;
    function nop() {
    }
    var kOnFinished = Symbol2("kOnFinished");
    function WritableState(options, stream, isDuplex) {
      if (typeof isDuplex !== "boolean")
        isDuplex = stream instanceof require_duplex();
      if (this.objectMode = !!(options && options.objectMode), isDuplex)
        this.objectMode = this.objectMode || !!(options && options.writableObjectMode);
      this.highWaterMark = options ? getHighWaterMark(this, options, "writableHighWaterMark", isDuplex) : getDefaultHighWaterMark(!1), this.finalCalled = !1, this.needDrain = !1, this.ending = !1, this.ended = !1, this.finished = !1, this.destroyed = !1;
      const noDecode = !!(options && options.decodeStrings === !1);
      this.decodeStrings = !noDecode, this.defaultEncoding = options && options.defaultEncoding || "utf8", this.length = 0, this.writing = !1, this.corked = 0, this.sync = !0, this.bufferProcessing = !1, this.onwrite = onwrite.bind(void 0, stream), this.writecb = null, this.writelen = 0, this.afterWriteTickInfo = null, resetBuffer(this), this.pendingcb = 0, this.constructed = !0, this.prefinished = !1, this.errorEmitted = !1, this.emitClose = !options || options.emitClose !== !1, this.autoDestroy = !options || options.autoDestroy !== !1, this.errored = null, this.closed = !1, this.closeEmitted = !1, this[kOnFinished] = [];
    }
    function resetBuffer(state) {
      state.buffered = [], state.bufferedIndex = 0, state.allBuffers = !0, state.allNoop = !0;
    }
    WritableState.prototype.getBuffer = function getBuffer() {
      return ArrayPrototypeSlice(this.buffered, this.bufferedIndex);
    }, ObjectDefineProperty(WritableState.prototype, "bufferedRequestCount", {
      get() {
        return this.buffered.length - this.bufferedIndex;
      }
    }), ObjectDefineProperty(Writable, SymbolHasInstance, {
      value: function(object) {
        if (FunctionPrototypeSymbolHasInstance(this, object))
          return !0;
        if (this !== Writable)
          return !1;
        return object && object._writableState instanceof WritableState;
      }
    }), Writable.prototype.pipe = function() {
      errorOrDestroy2(this, new ERR_STREAM_CANNOT_PIPE);
    };
    function _write(stream, chunk, encoding, cb) {
      const state = stream._writableState;
      if (typeof encoding === "function")
        cb = encoding, encoding = state.defaultEncoding;
      else {
        if (!encoding)
          encoding = state.defaultEncoding;
        else if (encoding !== "buffer" && !Buffer.isEncoding(encoding))
          throw new ERR_UNKNOWN_ENCODING(encoding);
        if (typeof cb !== "function")
          cb = nop;
      }
      if (chunk === null)
        throw new ERR_STREAM_NULL_VALUES;
      else if (!state.objectMode)
        if (typeof chunk === "string") {
          if (state.decodeStrings !== !1)
            chunk = Buffer.from(chunk, encoding), encoding = "buffer";
        } else if (chunk instanceof Buffer)
          encoding = "buffer";
        else if (Stream._isUint8Array(chunk))
          chunk = Stream._uint8ArrayToBuffer(chunk), encoding = "buffer";
        else
          throw new ERR_INVALID_ARG_TYPE2("chunk", ["string", "Buffer", "Uint8Array"], chunk);
      let err;
      if (state.ending)
        err = new ERR_STREAM_WRITE_AFTER_END;
      else if (state.destroyed)
        err = new ERR_STREAM_DESTROYED("write");
      if (err)
        return runOnNextTick(cb, err), errorOrDestroy2(stream, err, !0), err;
      return state.pendingcb++, writeOrBuffer(stream, state, chunk, encoding, cb);
    }
    Writable.prototype.write = function(chunk, encoding, cb) {
      return _write(this, chunk, encoding, cb) === !0;
    }, Writable.prototype.cork = function() {
      this._writableState.corked++;
    }, Writable.prototype.uncork = function() {
      const state = this._writableState;
      if (state.corked) {
        if (state.corked--, !state.writing)
          clearBuffer(this, state);
      }
    }, Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
      if (typeof encoding === "string")
        encoding = StringPrototypeToLowerCase(encoding);
      if (!Buffer.isEncoding(encoding))
        throw new ERR_UNKNOWN_ENCODING(encoding);
      return this._writableState.defaultEncoding = encoding, this;
    };
    function writeOrBuffer(stream, state, chunk, encoding, callback) {
      const len = state.objectMode ? 1 : chunk.length;
      state.length += len;
      const ret = state.length < state.highWaterMark;
      if (!ret)
        state.needDrain = !0;
      if (state.writing || state.corked || state.errored || !state.constructed) {
        if (state.buffered.push({
          chunk,
          encoding,
          callback
        }), state.allBuffers && encoding !== "buffer")
          state.allBuffers = !1;
        if (state.allNoop && callback !== nop)
          state.allNoop = !1;
      } else
        state.writelen = len, state.writecb = callback, state.writing = !0, state.sync = !0, stream._write(chunk, encoding, state.onwrite), state.sync = !1;
      return ret && !state.errored && !state.destroyed;
    }
    function doWrite(stream, state, writev, len, chunk, encoding, cb) {
      if (state.writelen = len, state.writecb = cb, state.writing = !0, state.sync = !0, state.destroyed)
        state.onwrite(new ERR_STREAM_DESTROYED("write"));
      else if (writev)
        stream._writev(chunk, state.onwrite);
      else
        stream._write(chunk, encoding, state.onwrite);
      state.sync = !1;
    }
    function onwriteError(stream, state, er, cb) {
      --state.pendingcb, cb(er), errorBuffer(state), errorOrDestroy2(stream, er);
    }
    function onwrite(stream, er) {
      const state = stream._writableState, sync = state.sync, cb = state.writecb;
      if (typeof cb !== "function") {
        errorOrDestroy2(stream, new ERR_MULTIPLE_CALLBACK);
        return;
      }
      if (state.writing = !1, state.writecb = null, state.length -= state.writelen, state.writelen = 0, er) {
        if (Error.captureStackTrace(er), !state.errored)
          state.errored = er;
        if (stream._readableState && !stream._readableState.errored)
          stream._readableState.errored = er;
        if (sync)
          runOnNextTick(onwriteError, stream, state, er, cb);
        else
          onwriteError(stream, state, er, cb);
      } else {
        if (state.buffered.length > state.bufferedIndex)
          clearBuffer(stream, state);
        if (sync)
          if (state.afterWriteTickInfo !== null && state.afterWriteTickInfo.cb === cb)
            state.afterWriteTickInfo.count++;
          else
            state.afterWriteTickInfo = {
              count: 1,
              cb,
              stream,
              state
            }, runOnNextTick(afterWriteTick, state.afterWriteTickInfo);
        else
          afterWrite(stream, state, 1, cb);
      }
    }
    function afterWriteTick({ stream, state, count, cb }) {
      return state.afterWriteTickInfo = null, afterWrite(stream, state, count, cb);
    }
    function afterWrite(stream, state, count, cb) {
      if (!state.ending && !stream.destroyed && state.length === 0 && state.needDrain)
        state.needDrain = !1, stream.emit("drain");
      while (count-- > 0)
        state.pendingcb--, cb();
      if (state.destroyed)
        errorBuffer(state);
      finishMaybe(stream, state);
    }
    function errorBuffer(state) {
      if (state.writing)
        return;
      for (let n = state.bufferedIndex;n < state.buffered.length; ++n) {
        var _state$errored;
        const { chunk, callback } = state.buffered[n], len = state.objectMode ? 1 : chunk.length;
        state.length -= len, callback((_state$errored = state.errored) !== null && _state$errored !== void 0 ? _state$errored : new ERR_STREAM_DESTROYED("write"));
      }
      const onfinishCallbacks = state[kOnFinished].splice(0);
      for (let i = 0;i < onfinishCallbacks.length; i++) {
        var _state$errored2;
        onfinishCallbacks[i]((_state$errored2 = state.errored) !== null && _state$errored2 !== void 0 ? _state$errored2 : new ERR_STREAM_DESTROYED("end"));
      }
      resetBuffer(state);
    }
    function clearBuffer(stream, state) {
      if (state.corked || state.bufferProcessing || state.destroyed || !state.constructed)
        return;
      const { buffered, bufferedIndex, objectMode } = state, bufferedLength = buffered.length - bufferedIndex;
      if (!bufferedLength)
        return;
      let i = bufferedIndex;
      if (state.bufferProcessing = !0, bufferedLength > 1 && stream._writev) {
        state.pendingcb -= bufferedLength - 1;
        const callback = state.allNoop ? nop : (err) => {
          for (let n = i;n < buffered.length; ++n)
            buffered[n].callback(err);
        }, chunks = state.allNoop && i === 0 ? buffered : ArrayPrototypeSlice(buffered, i);
        chunks.allBuffers = state.allBuffers, doWrite(stream, state, !0, state.length, chunks, "", callback), resetBuffer(state);
      } else {
        do {
          const { chunk, encoding, callback } = buffered[i];
          buffered[i++] = null;
          const len = objectMode ? 1 : chunk.length;
          doWrite(stream, state, !1, len, chunk, encoding, callback);
        } while (i < buffered.length && !state.writing);
        if (i === buffered.length)
          resetBuffer(state);
        else if (i > 256)
          buffered.splice(0, i), state.bufferedIndex = 0;
        else
          state.bufferedIndex = i;
      }
      state.bufferProcessing = !1;
    }
    Writable.prototype._write = function(chunk, encoding, cb) {
      if (this._writev)
        this._writev([
          {
            chunk,
            encoding
          }
        ], cb);
      else
        throw new ERR_METHOD_NOT_IMPLEMENTED("_write()");
    }, Writable.prototype._writev = null, Writable.prototype.end = function(chunk, encoding, cb, native = !1) {
      const state = this._writableState;
      if (__DEBUG__ && debug("end", state, this.__id), typeof chunk === "function")
        cb = chunk, chunk = null, encoding = null;
      else if (typeof encoding === "function")
        cb = encoding, encoding = null;
      let err;
      if (chunk !== null && chunk !== void 0) {
        let ret;
        if (!native)
          ret = _write(this, chunk, encoding);
        else
          ret = this.write(chunk, encoding);
        if (ret instanceof Error2)
          err = ret;
      }
      if (state.corked)
        state.corked = 1, this.uncork();
      if (err)
        this.emit("error", err);
      else if (!state.errored && !state.ending)
        state.ending = !0, finishMaybe(this, state, !0), state.ended = !0;
      else if (state.finished)
        err = new ERR_STREAM_ALREADY_FINISHED("end");
      else if (state.destroyed)
        err = new ERR_STREAM_DESTROYED("end");
      if (typeof cb === "function")
        if (err || state.finished)
          runOnNextTick(cb, err);
        else
          state[kOnFinished].push(cb);
      return this;
    };
    function needFinish(state, tag) {
      var needFinish2 = state.ending && !state.destroyed && state.constructed && state.length === 0 && !state.errored && state.buffered.length === 0 && !state.finished && !state.writing && !state.errorEmitted && !state.closeEmitted;
      return debug("needFinish", needFinish2, tag), needFinish2;
    }
    function callFinal(stream, state) {
      let called = !1;
      function onFinish(err) {
        if (called) {
          errorOrDestroy2(stream, err !== null && err !== void 0 ? err : ERR_MULTIPLE_CALLBACK());
          return;
        }
        if (called = !0, state.pendingcb--, err) {
          const onfinishCallbacks = state[kOnFinished].splice(0);
          for (let i = 0;i < onfinishCallbacks.length; i++)
            onfinishCallbacks[i](err);
          errorOrDestroy2(stream, err, state.sync);
        } else if (needFinish(state))
          state.prefinished = !0, stream.emit("prefinish"), state.pendingcb++, runOnNextTick(finish, stream, state);
      }
      state.sync = !0, state.pendingcb++;
      try {
        stream._final(onFinish);
      } catch (err) {
        onFinish(err);
      }
      state.sync = !1;
    }
    function prefinish(stream, state) {
      if (!state.prefinished && !state.finalCalled)
        if (typeof stream._final === "function" && !state.destroyed)
          state.finalCalled = !0, callFinal(stream, state);
        else
          state.prefinished = !0, stream.emit("prefinish");
    }
    function finishMaybe(stream, state, sync) {
      if (__DEBUG__ && debug("finishMaybe -- state, sync", state, sync, stream.__id), !needFinish(state, stream.__id))
        return;
      if (prefinish(stream, state), state.pendingcb === 0) {
        if (sync)
          state.pendingcb++, runOnNextTick((stream2, state2) => {
            if (needFinish(state2))
              finish(stream2, state2);
            else
              state2.pendingcb--;
          }, stream, state);
        else if (needFinish(state))
          state.pendingcb++, finish(stream, state);
      }
    }
    function finish(stream, state) {
      state.pendingcb--, state.finished = !0;
      const onfinishCallbacks = state[kOnFinished].splice(0);
      for (let i = 0;i < onfinishCallbacks.length; i++)
        onfinishCallbacks[i]();
      if (stream.emit("finish"), state.autoDestroy) {
        const rState = stream._readableState;
        if (!rState || rState.autoDestroy && (rState.endEmitted || rState.readable === !1))
          stream.destroy();
      }
    }
    ObjectDefineProperties(Writable.prototype, {
      closed: {
        get() {
          return this._writableState ? this._writableState.closed : !1;
        }
      },
      destroyed: {
        get() {
          return this._writableState ? this._writableState.destroyed : !1;
        },
        set(value) {
          if (this._writableState)
            this._writableState.destroyed = value;
        }
      },
      writable: {
        get() {
          const w = this._writableState;
          return !!w && w.writable !== !1 && !w.destroyed && !w.errored && !w.ending && !w.ended;
        },
        set(val) {
          if (this._writableState)
            this._writableState.writable = !!val;
        }
      },
      writableFinished: {
        get() {
          return this._writableState ? this._writableState.finished : !1;
        }
      },
      writableObjectMode: {
        get() {
          return this._writableState ? this._writableState.objectMode : !1;
        }
      },
      writableBuffer: {
        get() {
          return this._writableState && this._writableState.getBuffer();
        }
      },
      writableEnded: {
        get() {
          return this._writableState ? this._writableState.ending : !1;
        }
      },
      writableNeedDrain: {
        get() {
          const wState = this._writableState;
          if (!wState)
            return !1;
          return !wState.destroyed && !wState.ending && wState.needDrain;
        }
      },
      writableHighWaterMark: {
        get() {
          return this._writableState && this._writableState.highWaterMark;
        }
      },
      writableCorked: {
        get() {
          return this._writableState ? this._writableState.corked : 0;
        }
      },
      writableLength: {
        get() {
          return this._writableState && this._writableState.length;
        }
      },
      errored: {
        enumerable: !1,
        get() {
          return this._writableState ? this._writableState.errored : null;
        }
      },
      writableAborted: {
        enumerable: !1,
        get: function() {
          return !!(this._writableState.writable !== !1 && (this._writableState.destroyed || this._writableState.errored) && !this._writableState.finished);
        }
      }
    });
    var destroy = destroyImpl.destroy;
    Writable.prototype.destroy = function(err, cb) {
      const state = this._writableState;
      if (!state.destroyed && (state.bufferedIndex < state.buffered.length || state[kOnFinished].length))
        runOnNextTick(errorBuffer, state);
      return destroy.call(this, err, cb), this;
    }, Writable.prototype._undestroy = destroyImpl.undestroy, Writable.prototype._destroy = function(err, cb) {
      cb(err);
    }, Writable.prototype[EE.captureRejectionSymbol] = function(err) {
      this.destroy(err);
    };
    var webStreamsAdapters;
    function lazyWebStreams() {
      if (webStreamsAdapters === void 0)
        webStreamsAdapters = {};
      return webStreamsAdapters;
    }
    Writable.fromWeb = function(writableStream, options) {
      return lazyWebStreams().newStreamWritableFromWritableStream(writableStream, options);
    }, Writable.toWeb = function(streamWritable) {
      return lazyWebStreams().newWritableStreamFromStreamWritable(streamWritable);
    };
  }
}), require_duplexify = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/duplexify.js"(exports, module) {
    var bufferModule = __require("buffer"), {
      isReadable,
      isWritable,
      isIterable,
      isNodeStream,
      isReadableNodeStream,
      isWritableNodeStream,
      isDuplexNodeStream
    } = require_utils(), eos = require_end_of_stream(), {
      AbortError,
      codes: { ERR_INVALID_ARG_TYPE: ERR_INVALID_ARG_TYPE2, ERR_INVALID_RETURN_VALUE }
    } = require_errors(), { destroyer } = require_destroy(), Duplex = require_duplex(), Readable = require_readable(), { createDeferredPromise } = require_util(), from = require_from(), Blob = globalThis.Blob || bufferModule.Blob, isBlob = typeof Blob !== "undefined" ? function isBlob2(b) {
      return b instanceof Blob;
    } : function isBlob2(b) {
      return !1;
    }, AbortController = globalThis.AbortController || __require("abort-controller").AbortController, { FunctionPrototypeCall } = require_primordials();

    class Duplexify extends Duplex {
      constructor(options) {
        super(options);
        if ((options === null || options === void 0 ? void 0 : options.readable) === !1)
          this._readableState.readable = !1, this._readableState.ended = !0, this._readableState.endEmitted = !0;
        if ((options === null || options === void 0 ? void 0 : options.writable) === !1)
          this._writableState.writable = !1, this._writableState.ending = !0, this._writableState.ended = !0, this._writableState.finished = !0;
      }
    }
    module.exports = function duplexify(body, name) {
      if (isDuplexNodeStream(body))
        return body;
      if (isReadableNodeStream(body))
        return _duplexify({
          readable: body
        });
      if (isWritableNodeStream(body))
        return _duplexify({
          writable: body
        });
      if (isNodeStream(body))
        return _duplexify({
          writable: !1,
          readable: !1
        });
      if (typeof body === "function") {
        const { value, write, final, destroy } = fromAsyncGen(body);
        if (isIterable(value))
          return from(Duplexify, value, {
            objectMode: !0,
            write,
            final,
            destroy
          });
        const then2 = value === null || value === void 0 ? void 0 : value.then;
        if (typeof then2 === "function") {
          let d;
          const promise = FunctionPrototypeCall(then2, value, (val) => {
            if (val != null)
              throw new ERR_INVALID_RETURN_VALUE("nully", "body", val);
          }, (err) => {
            destroyer(d, err);
          });
          return d = new Duplexify({
            objectMode: !0,
            readable: !1,
            write,
            final(cb) {
              final(async () => {
                try {
                  await promise, runOnNextTick(cb, null);
                } catch (err) {
                  runOnNextTick(cb, err);
                }
              });
            },
            destroy
          });
        }
        throw new ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or AsyncFunction", name, value);
      }
      if (isBlob(body))
        return duplexify(body.arrayBuffer());
      if (isIterable(body))
        return from(Duplexify, body, {
          objectMode: !0,
          writable: !1
        });
      if (typeof (body === null || body === void 0 ? void 0 : body.writable) === "object" || typeof (body === null || body === void 0 ? void 0 : body.readable) === "object") {
        const readable = body !== null && body !== void 0 && body.readable ? isReadableNodeStream(body === null || body === void 0 ? void 0 : body.readable) ? body === null || body === void 0 ? void 0 : body.readable : duplexify(body.readable) : void 0, writable = body !== null && body !== void 0 && body.writable ? isWritableNodeStream(body === null || body === void 0 ? void 0 : body.writable) ? body === null || body === void 0 ? void 0 : body.writable : duplexify(body.writable) : void 0;
        return _duplexify({
          readable,
          writable
        });
      }
      const then = body === null || body === void 0 ? void 0 : body.then;
      if (typeof then === "function") {
        let d;
        return FunctionPrototypeCall(then, body, (val) => {
          if (val != null)
            d.push(val);
          d.push(null);
        }, (err) => {
          destroyer(d, err);
        }), d = new Duplexify({
          objectMode: !0,
          writable: !1,
          read() {
          }
        });
      }
      throw new ERR_INVALID_ARG_TYPE2(name, [
        "Blob",
        "ReadableStream",
        "WritableStream",
        "Stream",
        "Iterable",
        "AsyncIterable",
        "Function",
        "{ readable, writable } pair",
        "Promise"
      ], body);
    };
    function fromAsyncGen(fn) {
      let { promise, resolve } = createDeferredPromise();
      const ac = new AbortController, signal = ac.signal;
      return {
        value: fn(async function* () {
          while (!0) {
            const _promise = promise;
            promise = null;
            const { chunk, done, cb } = await _promise;
            if (runOnNextTick(cb), done)
              return;
            if (signal.aborted)
              throw new AbortError(void 0, {
                cause: signal.reason
              });
            ({ promise, resolve } = createDeferredPromise()), yield chunk;
          }
        }(), {
          signal
        }),
        write(chunk, encoding, cb) {
          const _resolve = resolve;
          resolve = null, _resolve({
            chunk,
            done: !1,
            cb
          });
        },
        final(cb) {
          const _resolve = resolve;
          resolve = null, _resolve({
            done: !0,
            cb
          });
        },
        destroy(err, cb) {
          ac.abort(), cb(err);
        }
      };
    }
    function _duplexify(pair) {
      const r = pair.readable && typeof pair.readable.read !== "function" ? Readable.wrap(pair.readable) : pair.readable, w = pair.writable;
      let readable = !!isReadable(r), writable = !!isWritable(w), ondrain, onfinish, onreadable, onclose, d;
      function onfinished(err) {
        const cb = onclose;
        if (onclose = null, cb)
          cb(err);
        else if (err)
          d.destroy(err);
        else if (!readable && !writable)
          d.destroy();
      }
      if (d = new Duplexify({
        readableObjectMode: !!(r !== null && r !== void 0 && r.readableObjectMode),
        writableObjectMode: !!(w !== null && w !== void 0 && w.writableObjectMode),
        readable,
        writable
      }), writable)
        eos(w, (err) => {
          if (writable = !1, err)
            destroyer(r, err);
          onfinished(err);
        }), d._write = function(chunk, encoding, callback) {
          if (w.write(chunk, encoding))
            callback();
          else
            ondrain = callback;
        }, d._final = function(callback) {
          w.end(), onfinish = callback;
        }, w.on("drain", function() {
          if (ondrain) {
            const cb = ondrain;
            ondrain = null, cb();
          }
        }), w.on("finish", function() {
          if (onfinish) {
            const cb = onfinish;
            onfinish = null, cb();
          }
        });
      if (readable)
        eos(r, (err) => {
          if (readable = !1, err)
            destroyer(r, err);
          onfinished(err);
        }), r.on("readable", function() {
          if (onreadable) {
            const cb = onreadable;
            onreadable = null, cb();
          }
        }), r.on("end", function() {
          d.push(null);
        }), d._read = function() {
          while (!0) {
            const buf = r.read();
            if (buf === null) {
              onreadable = d._read;
              return;
            }
            if (!d.push(buf))
              return;
          }
        };
      return d._destroy = function(err, callback) {
        if (!err && onclose !== null)
          err = new AbortError;
        if (onreadable = null, ondrain = null, onfinish = null, onclose === null)
          callback(err);
        else
          onclose = callback, destroyer(w, err), destroyer(r, err);
      }, d;
    }
  }
}), require_duplex = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/duplex.js"(exports, module) {
    var { ObjectDefineProperties, ObjectGetOwnPropertyDescriptor, ObjectKeys, ObjectSetPrototypeOf } = require_primordials(), Readable = require_readable();
    function Duplex(options) {
      if (!(this instanceof Duplex))
        return new Duplex(options);
      if (Readable.call(this, options), Writable.call(this, options), options) {
        if (this.allowHalfOpen = options.allowHalfOpen !== !1, options.readable === !1)
          this._readableState.readable = !1, this._readableState.ended = !0, this._readableState.endEmitted = !0;
        if (options.writable === !1)
          this._writableState.writable = !1, this._writableState.ending = !0, this._writableState.ended = !0, this._writableState.finished = !0;
      } else
        this.allowHalfOpen = !0;
    }
    module.exports = Duplex, ObjectSetPrototypeOf(Duplex.prototype, Readable.prototype), ObjectSetPrototypeOf(Duplex, Readable);
    for (var method in Writable.prototype)
      if (!Duplex.prototype[method])
        Duplex.prototype[method] = Writable.prototype[method];
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
          if (this._readableState === void 0 || this._writableState === void 0)
            return !1;
          return this._readableState.destroyed && this._writableState.destroyed;
        },
        set(value) {
          if (this._readableState && this._writableState)
            this._readableState.destroyed = value, this._writableState.destroyed = value;
        }
      }
    });
    var webStreamsAdapters;
    function lazyWebStreams() {
      if (webStreamsAdapters === void 0)
        webStreamsAdapters = {};
      return webStreamsAdapters;
    }
    Duplex.fromWeb = function(pair, options) {
      return lazyWebStreams().newStreamDuplexFromReadableWritablePair(pair, options);
    }, Duplex.toWeb = function(duplex) {
      return lazyWebStreams().newReadableWritablePairFromDuplex(duplex);
    };
    var duplexify;
    Duplex.from = function(body) {
      if (!duplexify)
        duplexify = require_duplexify();
      return duplexify(body, "body");
    };
  }
}), require_transform = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/transform.js"(exports, module) {
    var { ObjectSetPrototypeOf, Symbol: Symbol2 } = require_primordials(), { ERR_METHOD_NOT_IMPLEMENTED } = require_errors().codes, Duplex = require_duplex();
    function Transform(options) {
      if (!(this instanceof Transform))
        return new Transform(options);
      if (Duplex.call(this, options), this._readableState.sync = !1, this[kCallback] = null, options) {
        if (typeof options.transform === "function")
          this._transform = options.transform;
        if (typeof options.flush === "function")
          this._flush = options.flush;
      }
      this.on("prefinish", prefinish.bind(this));
    }
    ObjectSetPrototypeOf(Transform.prototype, Duplex.prototype), ObjectSetPrototypeOf(Transform, Duplex), module.exports = Transform;
    var kCallback = Symbol2("kCallback");
    function final(cb) {
      if (typeof this._flush === "function" && !this.destroyed)
        this._flush((er, data) => {
          if (er) {
            if (cb)
              cb(er);
            else
              this.destroy(er);
            return;
          }
          if (data != null)
            this.push(data);
          if (this.push(null), cb)
            cb();
        });
      else if (this.push(null), cb)
        cb();
    }
    function prefinish() {
      if (this._final !== final)
        final.call(this);
    }
    Transform.prototype._final = final, Transform.prototype._transform = function(chunk, encoding, callback) {
      throw new ERR_METHOD_NOT_IMPLEMENTED("_transform()");
    }, Transform.prototype._write = function(chunk, encoding, callback) {
      const rState = this._readableState, wState = this._writableState, length = rState.length;
      this._transform(chunk, encoding, (err, val) => {
        if (err) {
          callback(err);
          return;
        }
        if (val != null)
          this.push(val);
        if (wState.ended || length === rState.length || rState.length < rState.highWaterMark || rState.highWaterMark === 0 || rState.length === 0)
          callback();
        else
          this[kCallback] = callback;
      });
    }, Transform.prototype._read = function() {
      if (this[kCallback]) {
        const callback = this[kCallback];
        this[kCallback] = null, callback();
      }
    };
  }
}), require_passthrough = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/passthrough.js"(exports, module) {
    var { ObjectSetPrototypeOf } = require_primordials(), Transform = require_transform();
    function PassThrough(options) {
      if (!(this instanceof PassThrough))
        return new PassThrough(options);
      Transform.call(this, options);
    }
    ObjectSetPrototypeOf(PassThrough.prototype, Transform.prototype), ObjectSetPrototypeOf(PassThrough, Transform), PassThrough.prototype._transform = function(chunk, encoding, cb) {
      cb(null, chunk);
    }, module.exports = PassThrough;
  }
}), require_pipeline = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/pipeline.js"(exports, module) {
    var { ArrayIsArray: ArrayIsArray2, Promise: Promise2, SymbolAsyncIterator } = require_primordials(), eos = require_end_of_stream(), { once } = require_util(), destroyImpl = require_destroy(), Duplex = require_duplex(), {
      aggregateTwoErrors,
      codes: { ERR_INVALID_ARG_TYPE: ERR_INVALID_ARG_TYPE2, ERR_INVALID_RETURN_VALUE, ERR_MISSING_ARGS, ERR_STREAM_DESTROYED },
      AbortError
    } = require_errors(), { validateFunction, validateAbortSignal } = require_validators(), { isIterable, isReadable, isReadableNodeStream, isNodeStream } = require_utils(), AbortController = globalThis.AbortController || __require("abort-controller").AbortController, PassThrough, Readable;
    function destroyer(stream, reading, writing) {
      let finished = !1;
      stream.on("close", () => {
        finished = !0;
      });
      const cleanup = eos(stream, {
        readable: reading,
        writable: writing
      }, (err) => {
        finished = !err;
      });
      return {
        destroy: (err) => {
          if (finished)
            return;
          finished = !0, destroyImpl.destroyer(stream, err || new ERR_STREAM_DESTROYED("pipe"));
        },
        cleanup
      };
    }
    function popCallback(streams) {
      return validateFunction(streams[streams.length - 1], "streams[stream.length - 1]"), streams.pop();
    }
    function makeAsyncIterable(val) {
      if (isIterable(val))
        return val;
      else if (isReadableNodeStream(val))
        return fromReadable(val);
      throw new ERR_INVALID_ARG_TYPE2("val", ["Readable", "Iterable", "AsyncIterable"], val);
    }
    async function* fromReadable(val) {
      if (!Readable)
        Readable = require_readable();
      yield* Readable.prototype[SymbolAsyncIterator].call(val);
    }
    async function pump(iterable, writable, finish, { end }) {
      let error, onresolve = null;
      const resume = (err) => {
        if (err)
          error = err;
        if (onresolve) {
          const callback = onresolve;
          onresolve = null, callback();
        }
      }, wait = () => new Promise2((resolve, reject) => {
        if (error)
          reject(error);
        else
          onresolve = () => {
            if (error)
              reject(error);
            else
              resolve();
          };
      });
      writable.on("drain", resume);
      const cleanup = eos(writable, {
        readable: !1
      }, resume);
      try {
        if (writable.writableNeedDrain)
          await wait();
        for await (let chunk of iterable)
          if (!writable.write(chunk))
            await wait();
        if (end)
          writable.end();
        await wait(), finish();
      } catch (err) {
        finish(error !== err ? aggregateTwoErrors(error, err) : err);
      } finally {
        cleanup(), writable.off("drain", resume);
      }
    }
    function pipeline(...streams) {
      return pipelineImpl(streams, once(popCallback(streams)));
    }
    function pipelineImpl(streams, callback, opts) {
      if (streams.length === 1 && ArrayIsArray2(streams[0]))
        streams = streams[0];
      if (streams.length < 2)
        throw new ERR_MISSING_ARGS("streams");
      const ac = new AbortController, signal = ac.signal, outerSignal = opts === null || opts === void 0 ? void 0 : opts.signal, lastStreamCleanup = [];
      validateAbortSignal(outerSignal, "options.signal");
      function abort() {
        finishImpl(new AbortError);
      }
      outerSignal === null || outerSignal === void 0 || outerSignal.addEventListener("abort", abort);
      let error, value;
      const destroys = [];
      let finishCount = 0;
      function finish(err) {
        finishImpl(err, --finishCount === 0);
      }
      function finishImpl(err, final) {
        if (err && (!error || error.code === "ERR_STREAM_PREMATURE_CLOSE"))
          error = err;
        if (!error && !final)
          return;
        while (destroys.length)
          destroys.shift()(error);
        if (outerSignal === null || outerSignal === void 0 || outerSignal.removeEventListener("abort", abort), ac.abort(), final) {
          if (!error)
            lastStreamCleanup.forEach((fn) => fn());
          runOnNextTick(callback, error, value);
        }
      }
      let ret;
      for (let i = 0;i < streams.length; i++) {
        const stream = streams[i], reading = i < streams.length - 1, writing = i > 0, end = reading || (opts === null || opts === void 0 ? void 0 : opts.end) !== !1, isLastStream = i === streams.length - 1;
        if (isNodeStream(stream)) {
          let onError = function(err) {
            if (err && err.name !== "AbortError" && err.code !== "ERR_STREAM_PREMATURE_CLOSE")
              finish(err);
          };
          if (end) {
            const { destroy, cleanup } = destroyer(stream, reading, writing);
            if (destroys.push(destroy), isReadable(stream) && isLastStream)
              lastStreamCleanup.push(cleanup);
          }
          if (stream.on("error", onError), isReadable(stream) && isLastStream)
            lastStreamCleanup.push(() => {
              stream.removeListener("error", onError);
            });
        }
        if (i === 0)
          if (typeof stream === "function") {
            if (ret = stream({
              signal
            }), !isIterable(ret))
              throw new ERR_INVALID_RETURN_VALUE("Iterable, AsyncIterable or Stream", "source", ret);
          } else if (isIterable(stream) || isReadableNodeStream(stream))
            ret = stream;
          else
            ret = Duplex.from(stream);
        else if (typeof stream === "function")
          if (ret = makeAsyncIterable(ret), ret = stream(ret, {
            signal
          }), reading) {
            if (!isIterable(ret, !0))
              throw new ERR_INVALID_RETURN_VALUE("AsyncIterable", `transform[${i - 1}]`, ret);
          } else {
            var _ret;
            if (!PassThrough)
              PassThrough = require_passthrough();
            const pt = new PassThrough({
              objectMode: !0
            }), then = (_ret = ret) === null || _ret === void 0 ? void 0 : _ret.then;
            if (typeof then === "function")
              finishCount++, then.call(ret, (val) => {
                if (value = val, val != null)
                  pt.write(val);
                if (end)
                  pt.end();
                runOnNextTick(finish);
              }, (err) => {
                pt.destroy(err), runOnNextTick(finish, err);
              });
            else if (isIterable(ret, !0))
              finishCount++, pump(ret, pt, finish, {
                end
              });
            else
              throw new ERR_INVALID_RETURN_VALUE("AsyncIterable or Promise", "destination", ret);
            ret = pt;
            const { destroy, cleanup } = destroyer(ret, !1, !0);
            if (destroys.push(destroy), isLastStream)
              lastStreamCleanup.push(cleanup);
          }
        else if (isNodeStream(stream)) {
          if (isReadableNodeStream(ret)) {
            finishCount += 2;
            const cleanup = pipe(ret, stream, finish, {
              end
            });
            if (isReadable(stream) && isLastStream)
              lastStreamCleanup.push(cleanup);
          } else if (isIterable(ret))
            finishCount++, pump(ret, stream, finish, {
              end
            });
          else
            throw new ERR_INVALID_ARG_TYPE2("val", ["Readable", "Iterable", "AsyncIterable"], ret);
          ret = stream;
        } else
          ret = Duplex.from(stream);
      }
      if (signal !== null && signal !== void 0 && signal.aborted || outerSignal !== null && outerSignal !== void 0 && outerSignal.aborted)
        runOnNextTick(abort);
      return ret;
    }
    function pipe(src, dst, finish, { end }) {
      if (src.pipe(dst, {
        end
      }), end)
        src.once("end", () => dst.end());
      else
        finish();
      return eos(src, {
        readable: !0,
        writable: !1
      }, (err) => {
        const rState = src._readableState;
        if (err && err.code === "ERR_STREAM_PREMATURE_CLOSE" && rState && rState.ended && !rState.errored && !rState.errorEmitted)
          src.once("end", finish).once("error", finish);
        else
          finish(err);
      }), eos(dst, {
        readable: !1,
        writable: !0
      }, finish);
    }
    module.exports = {
      pipelineImpl,
      pipeline
    };
  }
}), require_compose = __commonJS({
  "node_modules/readable-stream/lib/internal/streams/compose.js"(exports, module) {
    var { pipeline } = require_pipeline(), Duplex = require_duplex(), { destroyer } = require_destroy(), { isNodeStream, isReadable, isWritable } = require_utils(), {
      AbortError,
      codes: { ERR_INVALID_ARG_VALUE: ERR_INVALID_ARG_VALUE2, ERR_MISSING_ARGS }
    } = require_errors();
    module.exports = function compose(...streams) {
      if (streams.length === 0)
        throw new ERR_MISSING_ARGS("streams");
      if (streams.length === 1)
        return Duplex.from(streams[0]);
      const orgStreams = [...streams];
      if (typeof streams[0] === "function")
        streams[0] = Duplex.from(streams[0]);
      if (typeof streams[streams.length - 1] === "function") {
        const idx = streams.length - 1;
        streams[idx] = Duplex.from(streams[idx]);
      }
      for (let n = 0;n < streams.length; ++n) {
        if (!isNodeStream(streams[n]))
          continue;
        if (n < streams.length - 1 && !isReadable(streams[n]))
          throw new ERR_INVALID_ARG_VALUE2(`streams[${n}]`, orgStreams[n], "must be readable");
        if (n > 0 && !isWritable(streams[n]))
          throw new ERR_INVALID_ARG_VALUE2(`streams[${n}]`, orgStreams[n], "must be writable");
      }
      let ondrain, onfinish, onreadable, onclose, d;
      function onfinished(err) {
        const cb = onclose;
        if (onclose = null, cb)
          cb(err);
        else if (err)
          d.destroy(err);
        else if (!readable && !writable)
          d.destroy();
      }
      const head = streams[0], tail = pipeline(streams, onfinished), writable = !!isWritable(head), readable = !!isReadable(tail);
      if (d = new Duplex({
        writableObjectMode: !!(head !== null && head !== void 0 && head.writableObjectMode),
        readableObjectMode: !!(tail !== null && tail !== void 0 && tail.writableObjectMode),
        writable,
        readable
      }), writable)
        d._write = function(chunk, encoding, callback) {
          if (head.write(chunk, encoding))
            callback();
          else
            ondrain = callback;
        }, d._final = function(callback) {
          head.end(), onfinish = callback;
        }, head.on("drain", function() {
          if (ondrain) {
            const cb = ondrain;
            ondrain = null, cb();
          }
        }), tail.on("finish", function() {
          if (onfinish) {
            const cb = onfinish;
            onfinish = null, cb();
          }
        });
      if (readable)
        tail.on("readable", function() {
          if (onreadable) {
            const cb = onreadable;
            onreadable = null, cb();
          }
        }), tail.on("end", function() {
          d.push(null);
        }), d._read = function() {
          while (!0) {
            const buf = tail.read();
            if (buf === null) {
              onreadable = d._read;
              return;
            }
            if (!d.push(buf))
              return;
          }
        };
      return d._destroy = function(err, callback) {
        if (!err && onclose !== null)
          err = new AbortError;
        if (onreadable = null, ondrain = null, onfinish = null, onclose === null)
          callback(err);
        else
          onclose = callback, destroyer(tail, err);
      }, d;
    };
  }
}), require_promises = __commonJS({
  "node_modules/readable-stream/lib/stream/promises.js"(exports, module) {
    var { ArrayPrototypePop, Promise: Promise2 } = require_primordials(), { isIterable, isNodeStream } = require_utils(), { pipelineImpl: pl } = require_pipeline(), { finished } = require_end_of_stream();
    function pipeline(...streams) {
      return new Promise2((resolve, reject) => {
        let signal, end;
        const lastArg = streams[streams.length - 1];
        if (lastArg && typeof lastArg === "object" && !isNodeStream(lastArg) && !isIterable(lastArg)) {
          const options = ArrayPrototypePop(streams);
          signal = options.signal, end = options.end;
        }
        pl(streams, (err, value) => {
          if (err)
            reject(err);
          else
            resolve(value);
        }, {
          signal,
          end
        });
      });
    }
    module.exports = {
      finished,
      pipeline
    };
  }
}), require_stream = __commonJS({
  "node_modules/readable-stream/lib/stream.js"(exports, module) {
    var { ObjectDefineProperty, ObjectKeys, ReflectApply } = require_primordials(), {
      promisify: { custom: customPromisify }
    } = require_util(), { streamReturningOperators, promiseReturningOperators } = require_operators(), {
      codes: { ERR_ILLEGAL_CONSTRUCTOR }
    } = require_errors(), compose = require_compose(), { pipeline } = require_pipeline(), { destroyer } = require_destroy(), eos = require_end_of_stream(), promises = require_promises(), utils = require_utils(), Stream = module.exports = require_legacy().Stream;
    Stream.isDisturbed = utils.isDisturbed, Stream.isErrored = utils.isErrored, Stream.isWritable = utils.isWritable, Stream.isReadable = utils.isReadable, Stream.Readable = require_readable();
    for (let key of ObjectKeys(streamReturningOperators)) {
      let fn = function(...args) {
        if (new.target)
          throw ERR_ILLEGAL_CONSTRUCTOR();
        return Stream.Readable.from(ReflectApply(op, this, args));
      };
      const op = streamReturningOperators[key];
      ObjectDefineProperty(fn, "name", {
        value: op.name
      }), ObjectDefineProperty(fn, "length", {
        value: op.length
      }), ObjectDefineProperty(Stream.Readable.prototype, key, {
        value: fn,
        enumerable: !1,
        configurable: !0,
        writable: !0
      });
    }
    for (let key of ObjectKeys(promiseReturningOperators)) {
      let fn = function(...args) {
        if (new.target)
          throw ERR_ILLEGAL_CONSTRUCTOR();
        return ReflectApply(op, this, args);
      };
      const op = promiseReturningOperators[key];
      ObjectDefineProperty(fn, "name", {
        value: op.name
      }), ObjectDefineProperty(fn, "length", {
        value: op.length
      }), ObjectDefineProperty(Stream.Readable.prototype, key, {
        value: fn,
        enumerable: !1,
        configurable: !0,
        writable: !0
      });
    }
    Stream.Writable = require_writable(), Stream.Duplex = require_duplex(), Stream.Transform = require_transform(), Stream.PassThrough = require_passthrough(), Stream.pipeline = pipeline;
    var { addAbortSignal } = require_add_abort_signal();
    Stream.addAbortSignal = addAbortSignal, Stream.finished = eos, Stream.destroy = destroyer, Stream.compose = compose, ObjectDefineProperty(Stream, "promises", {
      configurable: !0,
      enumerable: !0,
      get() {
        return promises;
      }
    }), ObjectDefineProperty(pipeline, customPromisify, {
      enumerable: !0,
      get() {
        return promises.pipeline;
      }
    }), ObjectDefineProperty(eos, customPromisify, {
      enumerable: !0,
      get() {
        return promises.finished;
      }
    }), Stream.Stream = Stream, Stream._isUint8Array = function isUint8Array(value) {
      return value instanceof Uint8Array;
    }, Stream._uint8ArrayToBuffer = function _uint8ArrayToBuffer(chunk) {
      return new Buffer(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    };
  }
}), require_ours = __commonJS({
  "node_modules/readable-stream/lib/ours/index.js"(exports, module) {
    const CustomStream = require_stream(), promises = require_promises(), originalDestroy = CustomStream.Readable.destroy;
    module.exports = CustomStream, module.exports._uint8ArrayToBuffer = CustomStream._uint8ArrayToBuffer, module.exports._isUint8Array = CustomStream._isUint8Array, module.exports.isDisturbed = CustomStream.isDisturbed, module.exports.isErrored = CustomStream.isErrored, module.exports.isWritable = CustomStream.isWritable, module.exports.isReadable = CustomStream.isReadable, module.exports.Readable = CustomStream.Readable, module.exports.Writable = CustomStream.Writable, module.exports.Duplex = CustomStream.Duplex, module.exports.Transform = CustomStream.Transform, module.exports.PassThrough = CustomStream.PassThrough, module.exports.addAbortSignal = CustomStream.addAbortSignal, module.exports.finished = CustomStream.finished, module.exports.destroy = CustomStream.destroy, module.exports.destroy = originalDestroy, module.exports.pipeline = CustomStream.pipeline, module.exports.compose = CustomStream.compose, module.exports._getNativeReadableStreamPrototype = getNativeReadableStreamPrototype, module.exports.NativeWritable = NativeWritable, Object.defineProperty(CustomStream, "promises", {
      configurable: !0,
      enumerable: !0,
      get() {
        return promises;
      }
    }), module.exports.Stream = CustomStream.Stream, module.exports.default = module.exports;
  }
}), nativeReadableStreamPrototypes = {
  0: void 0,
  1: void 0,
  2: void 0,
  3: void 0,
  4: void 0,
  5: void 0
}, Writable = require_writable(), NativeWritable = class NativeWritable2 extends Writable {
  #pathOrFdOrSink;
  #fileSink;
  #native = !0;
  _construct;
  _destroy;
  _final;
  constructor(pathOrFdOrSink, options = {}) {
    super(options);
    this._construct = this.#internalConstruct, this._destroy = this.#internalDestroy, this._final = this.#internalFinal, this.#pathOrFdOrSink = pathOrFdOrSink;
  }
  #internalConstruct(cb) {
    this._writableState.constructed = !0, this.constructed = !0, cb();
  }
  #lazyConstruct() {
    if (typeof this.#pathOrFdOrSink === "object")
      if (typeof this.#pathOrFdOrSink.write === "function")
        this.#fileSink = this.#pathOrFdOrSink;
      else
        throw new Error("Invalid FileSink");
    else
      this.#fileSink = Bun.file(this.#pathOrFdOrSink).writer();
  }
  write(chunk, encoding, cb, native = this.#native) {
    if (!native)
      return this.#native = !1, super.write(chunk, encoding, cb);
    if (!this.#fileSink)
      this.#lazyConstruct();
    var fileSink = this.#fileSink, result = fileSink.write(chunk);
    if (isPromise(result))
      return result.then(() => {
        this.emit("drain"), fileSink.flush(!0);
      }), !1;
    if (fileSink.flush(!0), cb)
      cb(null, chunk.byteLength);
    return !0;
  }
  end(chunk, encoding, cb, native = this.#native) {
    return super.end(chunk, encoding, cb, native);
  }
  #internalDestroy(error, cb) {
    if (this._writableState.destroyed = !0, cb)
      cb(error);
  }
  #internalFinal(cb) {
    if (this.#fileSink)
      this.#fileSink.end();
    if (cb)
      cb();
  }
  ref() {
    if (!this.#fileSink)
      this.#lazyConstruct();
    this.#fileSink.ref();
  }
  unref() {
    if (!this.#fileSink)
      return;
    this.#fileSink.unref();
  }
}, stream_exports = require_ours();
stream_exports[Symbol.for("CommonJS")] = 0;
stream_exports[Symbol.for("::bunternal::")] = { _ReadableFromWeb };
var stream_default = stream_exports, _uint8ArrayToBuffer = stream_exports._uint8ArrayToBuffer, _isUint8Array = stream_exports._isUint8Array, isDisturbed = stream_exports.isDisturbed, isErrored = stream_exports.isErrored, isWritable = stream_exports.isWritable, isReadable = stream_exports.isReadable, Readable = stream_exports.Readable, Writable = stream_exports.Writable, Duplex = stream_exports.Duplex, Transform = stream_exports.Transform, PassThrough = stream_exports.PassThrough, addAbortSignal = stream_exports.addAbortSignal, finished = stream_exports.finished, destroy = stream_exports.destroy, pipeline = stream_exports.pipeline, compose = stream_exports.compose, Stream = stream_exports.Stream, eos = stream_exports["eos"] = require_end_of_stream, _getNativeReadableStreamPrototype = stream_exports._getNativeReadableStreamPrototype, NativeWritable = stream_exports.NativeWritable, promises = Stream.promise;
export {
  promises,
  pipeline,
  isWritable,
  isReadable,
  isErrored,
  isDisturbed,
  finished,
  eos,
  destroy,
  stream_default as default,
  compose,
  addAbortSignal,
  _uint8ArrayToBuffer,
  _isUint8Array,
  _getNativeReadableStreamPrototype,
  Writable,
  Transform,
  Stream,
  Readable,
  PassThrough,
  NativeWritable,
  Duplex
};

//# debugId=7734C3A39170EC3064756e2164756e21
