const { kEnsureConstructed } = require("internal/shared");
const { errorOrDestroy } = require("internal/streams/destroy");

const ProcessNextTick = process.nextTick;

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

export default function () {
  const Readable = require("internal/streams/readable");

  var closer = [false];
  var handleNumberResult = function (nativeReadable, result, view, isClosed) {
    if (result > 0) {
      const slice = view.subarray(0, result);
      view = slice.byteLength < view.byteLength ? view.subarray(result) : undefined;
      if (slice.byteLength > 0) {
        nativeReadable.push(slice);
      }
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

  function NativeReadable(ptr, options) {
    if (!(this instanceof NativeReadable)) return Reflect.construct(NativeReadable, [ptr, options]);

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
    if (ptr) {
      ptr.onClose = this[_onClose].bind(this);
      ptr.onDrain = this[_onDrain].bind(this);
    }
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
