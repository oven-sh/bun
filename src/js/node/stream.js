// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";

// TODO: split this into more files.
const {
  promisify: { custom: customPromisify },
} = require("node:util");

const { streamReturningOperators, promiseReturningOperators } = require("internal/streams/operators");

const compose = require("internal/streams/compose");
const { setDefaultHighWaterMark, getDefaultHighWaterMark } = require("internal/streams/state");
const { pipeline } = require("internal/streams/pipeline");
const { destroyer } = require("internal/streams/destroy");
const eos = require("internal/streams/end-of-stream");

const promises = require("node:stream/promises");
const utils = require("internal/streams/utils");
const { isArrayBufferView, isUint8Array } = require("node:util/types");

const Stream = require("internal/streams/legacy").Stream;

Stream.isDestroyed = utils.isDestroyed;
Stream.isDisturbed = utils.isDisturbed;
Stream.isErrored = utils.isErrored;
Stream.isReadable = utils.isReadable;
Stream.isWritable = utils.isWritable;

Stream.Readable = require("internal/streams/readable");
const streamKeys = Object.keys(streamReturningOperators);
for (let i = 0; i < streamKeys.length; i++) {
  const key = streamKeys[i];
  const op = streamReturningOperators[key];
  function fn(...args) {
    if (new.target) {
      throw $ERR_ILLEGAL_CONSTRUCTOR();
    }
    return Stream.Readable.from(op.$apply(this, args));
  }
  Object.$defineProperty(fn, "name", { __proto__: null, value: op.name });
  Object.$defineProperty(fn, "length", { __proto__: null, value: op.length });
  Object.$defineProperty(Stream.Readable.prototype, key, {
    __proto__: null,
    value: fn,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}
const promiseKeys = Object.keys(promiseReturningOperators);
for (let i = 0; i < promiseKeys.length; i++) {
  const key = promiseKeys[i];
  const op = promiseReturningOperators[key];
  function fn(...args) {
    if (new.target) {
      throw $ERR_ILLEGAL_CONSTRUCTOR();
    }
    return op.$apply(this, args);
  }
  Object.$defineProperty(fn, "name", { __proto__: null, value: op.name });
  Object.$defineProperty(fn, "length", { __proto__: null, value: op.length });
  Object.$defineProperty(Stream.Readable.prototype, key, {
    __proto__: null,
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
Stream.duplexPair = require("internal/streams/duplexpair");
Stream.pipeline = pipeline;
const { addAbortSignal } = require("internal/streams/add-abort-signal");
Stream.addAbortSignal = addAbortSignal;
Stream.finished = eos;
Stream.destroy = destroyer;
Stream.compose = compose;
Stream.setDefaultHighWaterMark = setDefaultHighWaterMark;
Stream.getDefaultHighWaterMark = getDefaultHighWaterMark;

Object.$defineProperty(Stream, "promises", {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get() {
    return promises;
  },
});

Object.$defineProperty(pipeline, customPromisify, {
  __proto__: null,
  enumerable: true,
  get() {
    return promises.pipeline;
  },
});

Object.$defineProperty(eos, customPromisify, {
  __proto__: null,
  enumerable: true,
  get() {
    return promises.finished;
  },
});

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;

Stream._isArrayBufferView = isArrayBufferView;
Stream._isUint8Array = isUint8Array;
Stream._uint8ArrayToBuffer = function _uint8ArrayToBuffer(chunk) {
  return new $Buffer(chunk.buffer, chunk.byteOffset, chunk.byteLength);
};

Stream._getNativeReadableStreamPrototype = function _getNativeReadableStreamPrototype() {
  const C = function () {
    throw new Error("uhudsahdsua");
  };
  C.prototype = {};

  return C;
};

const transferToNativeReadable = $newCppFunction("ReadableStream.cpp", "jsFunctionTransferToNativeReadableStream", 1);
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

  function NativeReadable(this, ptr, options) {
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
  NativeReadable.prototype = {};
  Object.setPrototypeOf(NativeReadable.prototype, Readable.prototype);

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
      process.nextTick(() => {
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

  NativeReadable.prototype[Stream[Symbol.for("::bunternal::")].kEnsureConstructed] = function () {
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
  Stream.Writable.$call(this, options);

  this[_native] = true;

  this._construct = NativeWritable_internalConstruct;
  this._final = NativeWritable_internalFinal;
  this._write = NativeWritablePrototypeWrite;

  this[_pathOrFdOrSink] = pathOrFdOrSink;
}
Object.setPrototypeOf(NativeWritable, Stream.Writable);
NativeWritable.prototype = Object.create(Stream.Writable.prototype);

// These are confusingly two different fns for construct which initially were the same thing because
// `_construct` is part of the lifecycle of Writable and is not called lazily,
// so we need to separate our _construct for Writable state and actual construction of the write stream
function NativeWritable_internalConstruct(cb) {
  this._writableState.constructed = true;
  this.constructed = true;
  if (typeof cb === "function") process.nextTick(cb);
  process.nextTick(() => {
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

const WritablePrototypeEnd = Stream.Writable.prototype.end;
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

var kEnsureConstructed = Symbol("kEnsureConstructed");
Stream[Symbol.for("::bunternal::")] = { 
  _ReadableFromWeb: null, 
  ReadableFromWebForUndici: null, 
  kEnsureConstructed 
};
Stream._getNativeReadableStreamPrototype = getNativeReadableStreamPrototype;
Stream.NativeWritable = NativeWritable;

export default Stream;
