const {
  Symbol,
  TypedArrayPrototypeGetBuffer,
  TypedArrayPrototypeGetByteOffset,
  TypedArrayPrototypeGetByteLength,
  SafePromisePrototypeFinally,
  StringPrototypeToLowerCase,
  SafePromiseAll,
  PromisePrototypeThen,
  PromiseResolve,
} = require("internal/primordials");

const { Stream } = require("../streams/legacy");
const { Buffer } = require("node:buffer");

const eos = require("../streams/end-of-stream");

const { isDestroyed, isReadable, isWritable } = require("../streams/utils");

const { AbortError } = require("../../node/events");
const { validateObject, validateBoolean } = require("../validators");

const { createDeferredPromise } = require("../../node/util");

const { Readable } = require("../streams/readable");

const { isReadableStream, isWritableStream } = require("../streams/utils");

const Duplex = require("../streams/duplex");

const kEmptyObject = Object.freeze({ __proto__: null });

const { destroy } = require("../streams/destroy");

function handleKnownInternalErrors(cause) {
  switch (true) {
    case cause?.code === 'ERR_STREAM_PREMATURE_CLOSE': {
      return new AbortError(undefined, { cause });
    }
    // case ZLIB_FAILURES.has(cause?.code): {
    //   // eslint-disable-next-line no-restricted-syntax
    //   const error = new TypeError(undefined, { cause });
    //   error.code = cause.code;
    //   return error;
    // }
    default:
      return cause;
  }
}

function normalizeEncoding(enc) {
  if (enc == null || enc === 'utf8' || enc === 'utf-8') return 'utf8';
  return slowCases(enc);
}

function slowCases(enc) {
  switch (enc.length) {
    case 4:
      if (enc === 'UTF8') return 'utf8';
      if (enc === 'ucs2' || enc === 'UCS2') return 'utf16le';
      enc = StringPrototypeToLowerCase(enc);
      if (enc === 'utf8') return 'utf8';
      if (enc === 'ucs2') return 'utf16le';
      break;
    case 3:
      if (enc === 'hex' || enc === 'HEX' ||
      StringPrototypeToLowerCase(enc) === 'hex')
        return 'hex';
      break;
    case 5:
      if (enc === 'ascii') return 'ascii';
      if (enc === 'ucs-2') return 'utf16le';
      if (enc === 'UTF-8') return 'utf8';
      if (enc === 'ASCII') return 'ascii';
      if (enc === 'UCS-2') return 'utf16le';
      enc = StringPrototypeToLowerCase(enc);
      if (enc === 'utf-8') return 'utf8';
      if (enc === 'ascii') return 'ascii';
      if (enc === 'ucs-2') return 'utf16le';
      break;
    case 6:
      if (enc === 'base64') return 'base64';
      if (enc === 'latin1' || enc === 'binary') return 'latin1';
      if (enc === 'BASE64') return 'base64';
      if (enc === 'LATIN1' || enc === 'BINARY') return 'latin1';
      enc = StringPrototypeToLowerCase(enc);
      if (enc === 'base64') return 'base64';
      if (enc === 'latin1' || enc === 'binary') return 'latin1';
      break;
    case 7:
      if (enc === 'utf16le' || enc === 'UTF16LE' ||
      StringPrototypeToLowerCase(enc) === 'utf16le')
        return 'utf16le';
      break;
    case 8:
      if (enc === 'utf-16le' || enc === 'UTF-16LE' ||
      StringPrototypeToLowerCase(enc) === 'utf-16le')
        return 'utf16le';
      break;
    case 9:
      if (enc === 'base64url' || enc === 'BASE64URL' ||
      StringPrototypeToLowerCase(enc) === 'base64url')
        return 'base64url';
      break;
    default:
      if (enc === '') return 'utf8';
  }
}


function newReadableWritablePairFromDuplex(duplex) {
  if (typeof duplex?._writableState !== "object" || typeof duplex?._readableState !== "object") {
    throw $ERR_INVALID_ARG_TYPE("duplex", "stream.Duplex", duplex);
  }
  if (isDestroyed(duplex)) {
    const writable2 = new WritableStream;
    const readable2 = new ReadableStream;
    writable2.close();
    readable2.cancel();
    return { readable: readable2, writable: writable2 };
  }
  const writable = isWritable(duplex) ? newWritableStreamFromStreamWritable(duplex) : new WritableStream;
  if (!isWritable(duplex))
    writable.close();
  const readable = isReadable(duplex) ? newReadableStreamFromStreamReadable(duplex) : new ReadableStream;
  if (!isReadable(duplex))
    readable.cancel();
  return { writable, readable };
}
function newStreamDuplexFromReadableWritablePair(pair = kEmptyObject, options = kEmptyObject) {
  validateObject(pair, "pair");
  const {
    readable: readableStream,
    writable: writableStream
  } = pair;
  if (!isReadableStream(readableStream)) {
    throw $ERR_INVALID_ARG_TYPE("pair.readable", "ReadableStream", readableStream);
  }
  if (!isWritableStream(writableStream)) {
    throw $ERR_INVALID_ARG_TYPE("pair.writable", "WritableStream", writableStream);
  }
  validateObject(options, "options");
  const {
    allowHalfOpen = false,
    objectMode = false,
    encoding,
    decodeStrings = true,
    highWaterMark,
    signal
  } = options;
  validateBoolean(objectMode, "options.objectMode");
  if (encoding !== undefined && !Buffer.isEncoding(encoding))
    throw $ERR_INVALID_ARG_VALUE(encoding, "options.encoding");
  const writer = writableStream.getWriter();
  const reader = readableStream.getReader();
  let writableClosed = false;
  let readableClosed = false;
  const duplex = new Duplex({
    allowHalfOpen,
    highWaterMark,
    objectMode,
    encoding,
    decodeStrings,
    signal,
    writev(chunks, callback) {
      function done(error) {
        error = error.filter((e) => e);
        try {
          callback(error.length === 0 ? undefined : error);
        } catch (error2) {
          process.nextTick(() => destroy(duplex, error2));
        }
      }
      PromisePrototypeThen(writer.ready, () => {
        return PromisePrototypeThen(SafePromiseAll(chunks, (data) => writer.write(data.chunk)), done, done);
      }, done);
    },
    write(chunk, encoding2, callback) {
      if (typeof chunk === "string" && decodeStrings && !objectMode) {
        const enc = normalizeEncoding(encoding2);
        if (enc === "utf8") {
          chunk = encoder.encode(chunk);
        } else {
          chunk = Buffer.from(chunk, encoding2);
          chunk = new Uint8Array(TypedArrayPrototypeGetBuffer(chunk), TypedArrayPrototypeGetByteOffset(chunk), TypedArrayPrototypeGetByteLength(chunk));
        }
      }
      function done(error) {
        try {
          callback(error);
        } catch (error2) {
          destroy(duplex, error2);
        }
      }
      PromisePrototypeThen(writer.ready, () => {
        return PromisePrototypeThen(writer.write(chunk), done, done);
      }, done);
    },
    final(callback) {
      function done(error) {
        try {
          callback(error);
        } catch (error2) {
          process.nextTick(() => destroy(duplex, error2));
        }
      }
      if (!writableClosed) {
        PromisePrototypeThen(writer.close(), done, done);
      }
    },
    read() {
      PromisePrototypeThen(reader.read(), (chunk) => {
        if (chunk.done) {
          duplex.push(null);
        } else {
          duplex.push(chunk.value);
        }
      }, (error) => destroy(duplex, error));
    },
    destroy(error, callback) {
      function done() {
        try {
          callback(error);
        } catch (error2) {
          process.nextTick(() => {
            throw error2;
          });
        }
      }
      async function closeWriter() {
        if (!writableClosed)
          await writer.abort(error);
      }
      async function closeReader() {
        if (!readableClosed)
          await reader.cancel(error);
      }
      if (!writableClosed || !readableClosed) {
        PromisePrototypeThen(SafePromiseAll([
          closeWriter(),
          closeReader()
        ]), done, done);
        return;
      }
      done();
    }
  });
  PromisePrototypeThen(writer.closed, () => {
    writableClosed = true;
    if (!isWritableEnded(duplex))
      destroy(duplex, new ERR_STREAM_PREMATURE_CLOSE);
  }, (error) => {
    writableClosed = true;
    readableClosed = true;
    destroy(duplex, error);
  });
  PromisePrototypeThen(reader.closed, () => {
    readableClosed = true;
  }, (error) => {
    writableClosed = true;
    readableClosed = true;
    destroy(duplex, error);
  });
  return duplex;
}



/**
 * @typedef {import('../../stream').Writable} Writable
 * @typedef {import('../../stream').Readable} Readable
 * @typedef {import('./writablestream').WritableStream} WritableStream
 * @typedef {import('./readablestream').ReadableStream} ReadableStream
 */

/**
 * @typedef {import('../abort_controller').AbortSignal} AbortSignal
 */

/**
 * @param {Writable} streamWritable
 * @returns {WritableStream}
 */
function newWritableStreamFromStreamWritable(streamWritable) {
  // Not using the internal/streams/utils isWritableNodeStream utility
  // here because it will return false if streamWritable is a Duplex
  // whose writable option is false. For a Duplex that is not writable,
  // we want it to pass this check but return a closed WritableStream.
  // We check if the given stream is a stream.Writable or http.OutgoingMessage
  const checkIfWritableOrOutgoingMessage =
    streamWritable &&
    typeof streamWritable?.write === 'function' &&
    typeof streamWritable?.on === 'function';
  if (!checkIfWritableOrOutgoingMessage) {
    throw new ERR_INVALID_ARG_TYPE(
      'streamWritable',
      'stream.Writable',
      streamWritable,
    );
  }

  if (isDestroyed(streamWritable) || !isWritable(streamWritable)) {
    const writable = new WritableStream();
    writable.close();
    return writable;
  }

  const highWaterMark = streamWritable.writableHighWaterMark;
  const strategy =
    streamWritable.writableObjectMode ?
      new CountQueuingStrategy({ highWaterMark }) :
      { highWaterMark };

  let controller;
  let backpressurePromise;
  let closed;

  function onDrain() {
    if (backpressurePromise !== undefined)
      backpressurePromise.resolve();
  }

  const cleanup = eos(streamWritable, (error) => {
    error = handleKnownInternalErrors(error);

    cleanup();
    // This is a protection against non-standard, legacy streams
    // that happen to emit an error event again after finished is called.
    streamWritable.on('error', () => {});
    if (error != null) {
      if (backpressurePromise !== undefined)
        backpressurePromise.reject(error);
      // If closed is not undefined, the error is happening
      // after the WritableStream close has already started.
      // We need to reject it here.
      if (closed !== undefined) {
        closed.reject(error);
        closed = undefined;
      }
      controller.error(error);
      controller = undefined;
      return;
    }

    if (closed !== undefined) {
      closed.resolve();
      closed = undefined;
      return;
    }
    controller.error(new AbortError());
    controller = undefined;
  });

  streamWritable.on('drain', onDrain);

  return new WritableStream({
    start(c) { controller = c; },

    write(chunk) {
      if (streamWritable.writableNeedDrain || !streamWritable.write(chunk)) {
        backpressurePromise = createDeferredPromise();
        return SafePromisePrototypeFinally(
          backpressurePromise.promise, () => {
            backpressurePromise = undefined;
          });
      }
    },

    abort(reason) {
      destroy(streamWritable, reason);
    },

    close() {
      if (closed === undefined && !isWritableEnded(streamWritable)) {
        closed = createDeferredPromise();
        streamWritable.end();
        return closed.promise;
      }

      controller = undefined;
      return PromiseResolve();
    },
  }, strategy);
}

/**
 * @param {WritableStream} writableStream
 * @param {{
 *   decodeStrings? : boolean,
 *   highWaterMark? : number,
 *   objectMode? : boolean,
 *   signal? : AbortSignal,
 * }} [options]
 * @returns {Writable}
 */
function newStreamWritableFromWritableStream(writableStream, options = kEmptyObject) {
  if (!$isWritableStream(writableStream)) {
    throw new ERR_INVALID_ARG_TYPE(
      'writableStream',
      'WritableStream',
      writableStream);
  }

  validateObject(options, 'options');
  const {
    highWaterMark,
    decodeStrings = true,
    objectMode = false,
    signal,
  } = options;

  validateBoolean(objectMode, 'options.objectMode');
  validateBoolean(decodeStrings, 'options.decodeStrings');

  const writer = writableStream.getWriter();
  let closed = false;

  const writable = new Writable({
    highWaterMark,
    objectMode,
    decodeStrings,
    signal,

    writev(chunks, callback) {
      function done(error) {
        error = error.filter((e) => e);
        try {
          callback(error.length === 0 ? undefined : error);
        } catch (error) {
          // In a next tick because this is happening within
          // a promise context, and if there are any errors
          // thrown we don't want those to cause an unhandled
          // rejection. Let's just escape the promise and
          // handle it separately.
          process.nextTick(() => destroy(writable, error));
        }
      }

      PromisePrototypeThen(
        writer.ready,
        () => {
          return PromisePrototypeThen(
            SafePromiseAll(
              chunks,
              (data) => writer.write(data.chunk)),
            done,
            done);
        },
        done);
    },

    write(chunk, encoding, callback) {
      if (typeof chunk === 'string' && decodeStrings && !objectMode) {
        const enc = normalizeEncoding(encoding);

        if (enc === 'utf8') {
          chunk = encoder.encode(chunk);
        } else {
          chunk = Buffer.from(chunk, encoding);
          chunk = new Uint8Array(
            TypedArrayPrototypeGetBuffer(chunk),
            TypedArrayPrototypeGetByteOffset(chunk),
            TypedArrayPrototypeGetByteLength(chunk),
          );
        }
      }

      function done(error) {
        try {
          callback(error);
        } catch (error) {
          destroy(writable, error);
        }
      }

      PromisePrototypeThen(
        writer.ready,
        () => {
          return PromisePrototypeThen(
            writer.write(chunk),
            done,
            done);
        },
        done);
    },

    destroy(error, callback) {
      function done() {
        try {
          callback(error);
        } catch (error) {
          // In a next tick because this is happening within
          // a promise context, and if there are any errors
          // thrown we don't want those to cause an unhandled
          // rejection. Let's just escape the promise and
          // handle it separately.
          process.nextTick(() => { throw error; });
        }
      }

      if (!closed) {
        if (error != null) {
          PromisePrototypeThen(
            writer.abort(error),
            done,
            done);
        } else {
          PromisePrototypeThen(
            writer.close(),
            done,
            done);
        }
        return;
      }

      done();
    },

    final(callback) {
      function done(error) {
        try {
          callback(error);
        } catch (error) {
          // In a next tick because this is happening within
          // a promise context, and if there are any errors
          // thrown we don't want those to cause an unhandled
          // rejection. Let's just escape the promise and
          // handle it separately.
          process.nextTick(() => destroy(writable, error));
        }
      }

      if (!closed) {
        PromisePrototypeThen(
          writer.close(),
          done,
          done);
      }
    },
  });

  PromisePrototypeThen(
    writer.closed,
    () => {
      // If the WritableStream closes before the stream.Writable has been
      // ended, we signal an error on the stream.Writable.
      closed = true;
      if (!isWritableEnded(writable))
        destroy(writable, new ERR_STREAM_PREMATURE_CLOSE());
    },
    (error) => {
      // If the WritableStream errors before the stream.Writable has been
      // destroyed, signal an error on the stream.Writable.
      closed = true;
      destroy(writable, error);
    });

  return writable;
}




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

function newStreamReadableFromReadableStream(readableStream, options = {}) {
  if (!(readableStream instanceof ReadableStream)) {
    throw $ERR_INVALID_ARG_TYPE("readableStream", "ReadableStream", readableStream);
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

function newReadableStreamFromStreamReadable(streamReadable, options = {}) {
  // Not using the internal/streams/utils isReadableNodeStream utility
  // here because it will return false if streamReadable is a Duplex
  // whose readable option is false. For a Duplex that is not readable,
  // we want it to pass this check but return a closed ReadableStream.
  if (typeof streamReadable?._readableState !== "object") {
    throw $ERR_INVALID_ARG_TYPE("streamReadable", "stream.Readable", streamReadable);
  }

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
}

export default {
  newStreamWritableFromWritableStream,
  newWritableStreamFromStreamWritable,

  newStreamDuplexFromReadableWritablePair,
  newReadableWritablePairFromDuplex,

  newStreamReadableFromReadableStream,
  newReadableStreamFromStreamReadable,
};