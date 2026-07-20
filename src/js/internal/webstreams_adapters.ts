"use strict";

const {
  SafePromiseAllReturnVoid,
  SafeSet,
  TypedArrayPrototypeGetBuffer,
  TypedArrayPrototypeGetByteOffset,
  TypedArrayPrototypeGetByteLength,
} = require("internal/primordials");

const Writable = require("internal/streams/writable");
const Readable = require("internal/streams/readable");
const Duplex = require("internal/streams/duplex");
const { destroyer } = require("internal/streams/destroy");
const { isDestroyed, isReadable, isWritable, isWritableEnded } = require("internal/streams/utils");
const { kEmptyObject } = require("internal/shared");
const { validateBoolean, validateObject, validateOneOf } = require("internal/validators");
const { isAnyArrayBuffer } = require("node:util/types");
const eos = require("internal/streams/end-of-stream");
const { kEosNodeSynchronousCallback } = eos;

const normalizeEncoding = $newRustFunction("node_util_binding.rs", "normalizeEncoding", 1);

const ArrayPrototypeFilter = Array.prototype.filter;
const ArrayPrototypeMap = Array.prototype.map;
const ObjectEntries = Object.entries;
const ObjectDefineProperty = Object.defineProperty;
const StringPrototypeStartsWith = String.prototype.startsWith;
const PromiseWithResolvers = Promise.withResolvers.bind(Promise);
const PromiseResolve = Promise.$resolve.bind(Promise);
const PromisePrototypeThen = $Promise.prototype.$then;
const SafePromisePrototypeFinally = $Promise.prototype.finally;

const constants_zlib = $processBindingConstants.zlib;

const kValidateChunk = Symbol("kValidateChunk");
const kDestroyOnSyncError = Symbol("kDestroyOnSyncError");

function tryTransferToNativeReadable(stream, options) {
  const ptr = stream.$bunNativePtr;
  if (!ptr || ptr === -1) {
    return undefined;
  }
  return require("internal/streams/native-readable").constructNativeReadable(stream, options);
}

class ReadableFromWeb extends Readable {
  #reader;
  #closed;
  #stream;

  constructor(options, stream) {
    const { objectMode, highWaterMark, encoding, signal } = options;
    super({
      objectMode,
      highWaterMark,
      encoding,
      signal,
    });
    this.#reader = undefined;
    this.#stream = stream;
    this.#closed = false;
  }

  #handleDone(reader) {
    reader.releaseLock();
    this.#reader = undefined;
    this.#closed = true;
    this.push(null);
  }

  #handleError(reader, error) {
    if (reader) {
      this.#reader = undefined;
      try {
        reader.releaseLock();
      } catch {}
    }
    this.#closed = true;
    this.destroy(error);
  }

  // One reader.read() per _read(). readMany() would drain a start()-enqueued
  // source to "closed" before the consumer can abort, and cancel() on a closed
  // stream is a spec no-op, so the source's cancel hook would never run.
  _read() {
    $debug("ReadableFromWeb _read()", this.__id);
    if (this.#closed) return;
    var reader = this.#reader;
    var stream = this.#stream;
    if (stream) {
      reader = this.#reader = stream.getReader();
      this.#stream = undefined;
    }
    PromisePrototypeThen.$call(
      reader.read(),
      chunk => {
        if (this.#closed) return;
        if (chunk.done) {
          this.#handleDone(reader);
        } else {
          this.push(chunk.value);
        }
      },
      error => this.#handleError(reader, error),
    );
  }

  _destroy(error, callback) {
    if (!this.#closed) {
      this.#closed = true;
      var reader = this.#reader;
      if (reader) {
        this.#reader = undefined;
        PromisePrototypeThen.$call(
          reader.cancel(error),
          () => callback(error),
          cancelError => callback(error ?? cancelError),
        );
        return;
      }
      var stream = this.#stream;
      if (stream) {
        this.#stream = undefined;
        PromisePrototypeThen.$call(
          stream.cancel(error),
          () => callback(error),
          cancelError => callback(error ?? cancelError),
        );
        return;
      }
    }
    try {
      callback(error);
    } catch (error) {
      globalThis.reportError(error);
    }
  }
}

const encoder = new TextEncoder();

// Collect all negative (error) ZLIB codes and Z_NEED_DICT
const ZLIB_FAILURES: Set<string> = new SafeSet([
  ...ArrayPrototypeFilter.$call(
    ArrayPrototypeMap.$call(ObjectEntries(constants_zlib), ({ 0: code, 1: value }) => (value < 0 ? code : null)),
    Boolean,
  ),
  "Z_NEED_DICT",
]);

function handleKnownInternalErrors(cause: Error | null): Error | null {
  const causeCode = cause?.code;
  switch (true) {
    case causeCode === "ERR_STREAM_PREMATURE_CLOSE": {
      return $makeAbortError(undefined, { cause });
    }
    case ZLIB_FAILURES.has(causeCode):
    // Brotli decoder errors carry the BrotliDecoderErrorString() name,
    // formatted as 'ERR_' + '_ERROR_...' (= 'ERR__ERROR_*').
    // Falls through
    case causeCode != null && StringPrototypeStartsWith.$call(causeCode, "ERR__ERROR_"): {
      // Upstream uses `new TypeError(undefined, { cause })`, but the builtins
      // codegen rewrites `new TypeError` to $makeTypeError, which only accepts
      // a message and silently drops the options bag. Pass an explicit empty
      // message (matching the `undefined` message upstream produces) and
      // define `cause` manually with the same attributes
      // `new Error(msg, { cause })` would produce: own, writable,
      // configurable, non-enumerable.
      const error = new TypeError("");
      ObjectDefineProperty(error, "cause", {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: cause,
        writable: true,
      });
      ObjectDefineProperty(error, "code", {
        __proto__: null,
        configurable: true,
        enumerable: true,
        value: causeCode,
        writable: true,
      });
      return error;
    }
    default:
      return cause;
  }
}

const noop = () => {};

function newWritableStreamFromStreamWritable(streamWritable, options = kEmptyObject) {
  // Not using the internal/streams/utils isWritableNodeStream utility
  // here because it will return false if streamWritable is a Duplex
  // whose writable option is false. For a Duplex that is not writable,
  // we want it to pass this check but return a closed WritableStream.
  // We check if the given stream is a stream.Writable or http.OutgoingMessage
  const checkIfWritableOrOutgoingMessage =
    streamWritable && typeof streamWritable?.write === "function" && typeof streamWritable?.on === "function";
  if (!checkIfWritableOrOutgoingMessage) {
    throw $ERR_INVALID_ARG_TYPE("streamWritable", ["stream.Writable"], streamWritable);
  }

  if (isDestroyed(streamWritable) || !isWritable(streamWritable)) {
    const writable = new WritableStream();
    writable.close();
    return writable;
  }

  const highWaterMark = streamWritable.writableHighWaterMark;
  const strategy = streamWritable.writableObjectMode
    ? new CountQueuingStrategy({ highWaterMark })
    : {
        highWaterMark,
        // Size chunks in bytes so desiredSize reflects the byte-based
        // highWaterMark and pipeTo applies backpressure.
        size(chunk) {
          return chunk?.byteLength ?? chunk?.length ?? 1;
        },
      };

  let controller;
  let backpressurePromise;
  let closed;

  function onDrain() {
    if (backpressurePromise !== undefined) backpressurePromise.resolve();
  }

  const cleanup = eos(streamWritable, error => {
    error = handleKnownInternalErrors(error);

    cleanup();
    // This is a protection against non-standard, legacy streams
    // that happen to emit an error event again after finished is called.
    streamWritable.on("error", () => {});
    if (error != null) {
      if (backpressurePromise !== undefined) backpressurePromise.reject(error);
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
    controller.error($makeAbortError());
    controller = undefined;
  });

  streamWritable.on("drain", onDrain);

  return new WritableStream(
    {
      start(c) {
        controller = c;
      },

      write(chunk) {
        try {
          options[kValidateChunk]?.(chunk);
          if (!streamWritable.writableObjectMode && isAnyArrayBuffer(chunk)) {
            chunk = new Uint8Array(chunk);
          }
          const needDrainBefore = streamWritable.writableNeedDrain;
          if (needDrainBefore || !streamWritable.write(chunk)) {
            backpressurePromise = PromiseWithResolvers();
            // write() may set writableNeedDrain; the post-write value is
            // what decides whether we resolve immediately.
            if (!streamWritable.writableNeedDrain) {
              backpressurePromise.resolve();
            }
            return SafePromisePrototypeFinally.$call(backpressurePromise.promise, () => {
              backpressurePromise = undefined;
            });
          }
        } catch (error) {
          // When the kDestroyOnSyncError flag is set (e.g. for
          // CompressionStream), a sync throw must also destroy the
          // stream so the readable side is errored too. Without this
          // the readable side hangs forever. This replicates the
          // TransformStream semantics: error both sides on any throw
          // in the transform path.
          if (options[kDestroyOnSyncError]) {
            destroyer(streamWritable, error);
          }
          throw error;
        }
      },

      abort(reason) {
        destroyer(streamWritable, reason);
      },

      close() {
        if (closed === undefined && !isWritableEnded(streamWritable)) {
          closed = PromiseWithResolvers();
          streamWritable.end();
          return closed.promise;
        }

        controller = undefined;
        return PromiseResolve();
      },
    },
    strategy,
  );
}

function newStreamWritableFromWritableStream(writableStream, options = kEmptyObject) {
  if (!$inheritsWritableStream(writableStream)) {
    throw $ERR_INVALID_ARG_TYPE("writableStream", "WritableStream", writableStream);
  }

  validateObject(options, "options");
  const { highWaterMark, decodeStrings = true, objectMode = false, signal } = options;

  validateBoolean(objectMode, "options.objectMode");
  validateBoolean(decodeStrings, "options.decodeStrings");

  const writer = writableStream.getWriter();
  let closed = false;

  const writable = new Writable({
    highWaterMark,
    objectMode,
    decodeStrings,
    signal,

    writev(chunks, callback) {
      function done(error) {
        try {
          callback(error);
        } catch (error) {
          // In a next tick because this is happening within
          // a promise context, and if there are any errors
          // thrown we don't want those to cause an unhandled
          // rejection. Let's just escape the promise and
          // handle it separately.
          process.nextTick(() => destroyer(writable, error));
        }
      }

      PromisePrototypeThen.$call(
        writer.ready,
        () => {
          return PromisePrototypeThen.$call(
            SafePromiseAllReturnVoid(chunks, data => writer.write(data.chunk)),
            done,
            done,
          );
        },
        done,
      );
    },

    write(chunk, encoding, callback) {
      if (typeof chunk === "string" && decodeStrings && !objectMode) {
        const enc = normalizeEncoding(encoding);

        if (enc === "utf8") {
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
          destroyer(writable, error);
        }
      }

      PromisePrototypeThen.$call(
        writer.ready,
        () => {
          return PromisePrototypeThen.$call(writer.write(chunk), done, done);
        },
        done,
      );
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
          process.nextTick(() => {
            throw error;
          });
        }
      }

      if (!closed) {
        if (error != null) {
          PromisePrototypeThen.$call(writer.abort(error), done, done);
        } else {
          PromisePrototypeThen.$call(writer.close(), done, done);
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
          process.nextTick(() => destroyer(writable, error));
        }
      }

      if (!closed) {
        PromisePrototypeThen.$call(writer.close(), done, done);
      }
    },
  });

  PromisePrototypeThen.$call(
    writer.closed,
    () => {
      // If the WritableStream closes before the stream.Writable has been
      // ended, we signal an error on the stream.Writable.
      closed = true;
      if (!isWritableEnded(writable)) destroyer(writable, $ERR_STREAM_PREMATURE_CLOSE());
    },
    error => {
      // If the WritableStream errors before the stream.Writable has been
      // destroyed, signal an error on the stream.Writable.
      closed = true;
      destroyer(writable, error);
    },
  );

  return writable;
}

const kErrorSentinelAttached = Symbol("kErrorSentinelAttached");

function newReadableStreamFromStreamReadable(streamReadable, options = kEmptyObject) {
  // Not using the internal/streams/utils isReadableNodeStream utility
  // here because it will return false if streamReadable is a Duplex
  // whose readable option is false. For a Duplex that is not readable,
  // we want it to pass this check but return a closed ReadableStream.
  if (typeof streamReadable?._readableState !== "object") {
    throw $ERR_INVALID_ARG_TYPE("streamReadable", ["stream.Readable"], streamReadable);
  }
  validateObject(options, "options");
  const optionsType = options.type;
  if (optionsType !== undefined) {
    validateOneOf(optionsType, "options.type", ["bytes", undefined]);
  }

  const isBYOB = optionsType === "bytes";
  let controller;
  let wasCanceled = false;
  let strategy;

  const underlyingSource = {
    __proto__: null,
    type: isBYOB ? "bytes" : undefined,
    start(c) {
      controller = c;
    },
    cancel(reason) {
      wasCanceled = true;
      destroyer(streamReadable, reason);
    },
  };

  const readable = isReadable(streamReadable);
  const objectMode = streamReadable.readableObjectMode;
  if (readable) {
    underlyingSource.pull = function pull() {
      streamReadable.resume();
    };

    const highWaterMark = streamReadable.readableHighWaterMark;
    strategy = isBYOB
      ? { highWaterMark }
      : (options.strategy ?? new (objectMode ? CountQueuingStrategy : ByteLengthQueuingStrategy)({ highWaterMark }));
  }
  const readableStream = new ReadableStream(underlyingSource, strategy);

  // When adapting a Duplex as a ReadableStream, readable completion should not
  // wait for a half-open writable side to finish as well.
  let cleanup = noop;
  cleanup = eos(
    streamReadable,
    {
      __proto__: null,
      writable: false,
      [kEosNodeSynchronousCallback]: true,
    },
    error => {
      error = handleKnownInternalErrors(error);

      // If eos calls the callback synchronously, cleanup is still a no-op here.
      cleanup();

      if (!(kErrorSentinelAttached in streamReadable)) {
        // This is a protection against non-standard, legacy streams
        // that happen to emit an error event again after finished is called.
        streamReadable.on("error", noop);
        streamReadable[kErrorSentinelAttached] = true;
      }
      if (wasCanceled) {
        return;
      }
      wasCanceled = true;
      if (error) return controller.error(error);
      controller.close();
      if (isBYOB) controller.byobRequest?.respond(0);
    },
  );

  if (wasCanceled) {
    // `eos` called the callback synchronously
    cleanup();
  } else if (readable) {
    streamReadable.pause();

    streamReadable.on("data", function onData(chunk) {
      // Copy the Buffer to detach it from the pool.
      if (Buffer.isBuffer(chunk) && !objectMode) chunk = new Uint8Array(chunk);
      controller.enqueue(chunk);
      if (controller.desiredSize <= 0) streamReadable.pause();
    });
  }

  return readableStream;
}

function newStreamReadableFromReadableStream(readableStream, options: Record<string, unknown> = kEmptyObject) {
  if (!$inheritsReadableStream(readableStream)) {
    throw $ERR_INVALID_ARG_TYPE("readableStream", "ReadableStream", readableStream);
  }

  validateObject(options, "options");
  const { highWaterMark, encoding, objectMode = false, signal } = options;

  if (encoding !== undefined && !Buffer.isEncoding(encoding))
    throw $ERR_INVALID_ARG_VALUE("options.encoding", encoding);
  validateBoolean(objectMode, "options.objectMode");

  const nativeStream = tryTransferToNativeReadable(readableStream, options);

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

let dep0201Warned = false;
function emitDEP0201() {
  if (dep0201Warned) return;
  dep0201Warned = true;
  process.emitWarning(
    "Passing 'options.type' to Duplex.toWeb() is deprecated. " +
      "To specify the ReadableStream type, use 'options.readableType'.",
    "DeprecationWarning",
    "DEP0201",
  );
}

function newReadableWritablePairFromDuplex(duplex, options = kEmptyObject) {
  // Not using the internal/streams/utils isWritableNodeStream and
  // isReadableNodeStream utilities here because they will return false
  // if the duplex was created with writable or readable options set to
  // false. Instead, we'll check the readable and writable state after
  // and return closed WritableStream or closed ReadableStream as
  // necessary.
  if (typeof duplex?._writableState !== "object" || typeof duplex?._readableState !== "object") {
    throw $ERR_INVALID_ARG_TYPE("duplex", ["stream.Duplex"], duplex);
  }

  validateObject(options, "options");

  const readableOptions = {
    __proto__: null,
    type: options.readableType,
  };

  let optionsType;
  if (options.readableType == null && (optionsType = options.type) != null) {
    // 'options.type' is a deprecated alias for 'options.readableType'
    emitDEP0201();
    readableOptions.type = optionsType;
  }

  if (isDestroyed(duplex)) {
    const writable = new WritableStream();
    const readable = new ReadableStream({ type: readableOptions.type });
    writable.close();
    readable.cancel();
    return { readable, writable };
  }

  const writableOptions = {
    __proto__: null,
    [kValidateChunk]: options[kValidateChunk],
    [kDestroyOnSyncError]: options[kDestroyOnSyncError],
  };

  const writable = isWritable(duplex)
    ? newWritableStreamFromStreamWritable(duplex, writableOptions)
    : new WritableStream();

  if (!isWritable(duplex)) writable.close();

  const readable = isReadable(duplex)
    ? newReadableStreamFromStreamReadable(duplex, readableOptions)
    : new ReadableStream({ type: readableOptions.type });

  if (!isReadable(duplex)) readable.cancel();

  return { writable, readable };
}

function newStreamDuplexFromReadableWritablePair(pair = kEmptyObject, options = kEmptyObject) {
  validateObject(pair, "pair");
  const { readable: readableStream, writable: writableStream } = pair;

  if (!$inheritsReadableStream(readableStream)) {
    throw $ERR_INVALID_ARG_TYPE("pair.readable", "ReadableStream", readableStream);
  }
  if (!$inheritsWritableStream(writableStream)) {
    throw $ERR_INVALID_ARG_TYPE("pair.writable", "WritableStream", writableStream);
  }

  validateObject(options, "options");
  const { allowHalfOpen = false, objectMode = false, encoding, decodeStrings = true, highWaterMark, signal } = options;

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
        try {
          callback(error);
        } catch (error) {
          // In a next tick because this is happening within
          // a promise context, and if there are any errors
          // thrown we don't want those to cause an unhandled
          // rejection. Let's just escape the promise and
          // handle it separately.
          process.nextTick(() => destroyer(duplex, error));
        }
      }

      PromisePrototypeThen.$call(
        writer.ready,
        () => {
          return PromisePrototypeThen.$call(
            SafePromiseAllReturnVoid(chunks, data => writer.write(data.chunk)),
            done,
            done,
          );
        },
        done,
      );
    },

    write(chunk, encoding, callback) {
      if (typeof chunk === "string" && decodeStrings && !objectMode) {
        const enc = normalizeEncoding(encoding);

        if (enc === "utf8") {
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
          destroyer(duplex, error);
        }
      }

      PromisePrototypeThen.$call(
        writer.ready,
        () => {
          return PromisePrototypeThen.$call(writer.write(chunk), done, done);
        },
        done,
      );
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
          process.nextTick(() => destroyer(duplex, error));
        }
      }

      if (!writableClosed) {
        PromisePrototypeThen.$call(writer.close(), done, done);
      }
    },

    read() {
      PromisePrototypeThen.$call(
        reader.read(),
        chunk => {
          if (chunk.done) {
            duplex.push(null);
          } else {
            duplex.push(chunk.value);
          }
        },
        error => destroyer(duplex, error),
      );
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
          process.nextTick(() => {
            throw error;
          });
        }
      }

      async function closeWriter() {
        if (!writableClosed) await writer.abort(error);
      }

      async function closeReader() {
        if (!readableClosed) await reader.cancel(error);
      }

      if (!writableClosed || !readableClosed) {
        PromisePrototypeThen.$call(SafePromiseAllReturnVoid([closeWriter(), closeReader()]), done, done);
        return;
      }

      done();
    },
  });

  PromisePrototypeThen.$call(
    writer.closed,
    () => {
      writableClosed = true;
      if (!isWritableEnded(duplex)) destroyer(duplex, $ERR_STREAM_PREMATURE_CLOSE());
    },
    error => {
      writableClosed = true;
      readableClosed = true;
      destroyer(duplex, error);
    },
  );

  PromisePrototypeThen.$call(
    reader.closed,
    () => {
      readableClosed = true;
    },
    error => {
      writableClosed = true;
      readableClosed = true;
      destroyer(duplex, error);
    },
  );

  return duplex;
}

// Shared by CompressionStream and DecompressionStream: per the Compression
// Streams spec, chunks must be BufferSource (ArrayBuffer or ArrayBufferView
// not backed by SharedArrayBuffer), and an invalid chunk must error both
// sides of the pair synchronously.
function newBufferSourceTransformPairFromDuplex(duplex) {
  const { isArrayBufferView, isSharedArrayBuffer } = require("node:util/types");
  return newReadableWritablePairFromDuplex(duplex, {
    [kValidateChunk]: function validateBufferSourceChunk(chunk) {
      if (isSharedArrayBuffer(isArrayBufferView(chunk) ? chunk.buffer : chunk)) {
        throw $ERR_INVALID_ARG_TYPE("chunk", ["ArrayBuffer", "Buffer", "TypedArray", "DataView"], chunk);
      }
    },
    [kDestroyOnSyncError]: true,
  });
}

export default {
  newWritableStreamFromStreamWritable,
  newReadableStreamFromStreamReadable,
  newStreamWritableFromWritableStream,
  newStreamReadableFromReadableStream,
  newReadableWritablePairFromDuplex,
  newStreamDuplexFromReadableWritablePair,
  newBufferSourceTransformPairFromDuplex,
  kValidateChunk,
  kDestroyOnSyncError,
  _ReadableFromWeb: ReadableFromWeb,
};
