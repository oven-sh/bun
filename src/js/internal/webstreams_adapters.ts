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
const AsyncContextFrame = require("internal/async_context_frame");

const normalizeEncoding: (encoding: unknown) => string | undefined = $bindgen(
  "node_util_binding.bind.ts",
  "normalizeEncoding",
);

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

function tryTransferToNativeReadable(stream: ReadableStream, options: StreamReadableFromReadableStreamOptions) {
  const ptr = stream.$bunNativePtr;
  if (!ptr || ptr === -1) {
    return undefined;
  }
  return require("internal/streams/native-readable").constructNativeReadable(stream, options);
}

type DefaultReader = ReturnType<ReadableStream["getReader"]>;

// The read side of Readable.fromWeb() and Duplex.fromWeb() is a read request of the web stream, not a reader.read()
// promise, as in Node.js since v26.9.0 and v24.22.0 (nodejs/node#65548):
// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/webstreams/adapters.js#L676-L696
// The stream calls the close step and the error step where it closes or errors: inside _read(), controller.close(),
// controller.error() or reader.cancel(). It calls the chunk step one microtask after it hands a chunk over, so an
// error or a destroy() of that turn is ahead of the chunk. Each step is called as step(value, nodeStream).
// Two things are not Node's. What a step throws is an unhandled rejection, as it was in the reaction of reader.read():
// Node throws it into controller.close(). And the steps run in the async context of the read that asked, as that
// reaction did: in Node the listeners see the AsyncLocalStorage store of whoever closes the stream.
interface NodeStreamReadOperation {
  readonly $nodeStreamReadOperation: never;
}
type NodeStreamReadStep = (value: any, nodeStream: any) => void;
const createReadOperation: (
  reader: DefaultReader,
  nodeStream: object,
  chunkStep: NodeStreamReadStep,
  closeStep: NodeStreamReadStep,
  errorStep: NodeStreamReadStep,
) => NodeStreamReadOperation = $newCppFunction(
  "streams/BunStreamConsumers.cpp",
  "jsFunctionCreateNodeStreamReadOperation",
  5,
);
const readNextChunk: (operation: NodeStreamReadOperation) => void = $newCppFunction(
  "streams/BunStreamConsumers.cpp",
  "jsFunctionNodeStreamReadOperationRead",
  1,
);

// Node's `closed` flag of the adapter: the reaction of reader.closed raises it one promise job after the web stream
// closes or errors, and a destroy() ahead of it still cancels. The web stream holds that reaction for as long as
// it is open. So the reaction holds this object and not the node stream, and it is made outside every async
// context: an open web stream keeps alive neither an idle node stream nor the stores of the read that opened it.
interface WebStreamEnd {
  closed: Promise<void>;
  seen: boolean;
}

function watchWebStreamEnd(reader: DefaultReader): WebStreamEnd {
  const closed = reader.closed;
  const end: WebStreamEnd = { closed, seen: false };
  // A reader of a subclass can answer `closed` with anything.
  if (!$isPromise(closed)) return end;
  if (!$isPromisePending(closed)) {
    // Node takes the reader inside fromWeb(), so for a stream that ended ahead of the first read its flag is up.
    end.seen = true;
  } else {
    const see = () => {
      end.seen = true;
    };
    AsyncContextFrame.run(undefined, PromisePrototypeThen, closed, see, see);
  }
  return end;
}

class ReadableFromWeb extends Readable {
  #reader: DefaultReader | undefined;
  #operation: NodeStreamReadOperation | undefined;
  #end: WebStreamEnd | undefined;
  #stream: ReadableStream | undefined;
  // node-fetch, undici: `stream` is a Response body, which text(), json(), ... lock for good.
  #responseBody: boolean;

  constructor(options: StreamReadableFromReadableStreamOptions, stream: ReadableStream) {
    const { objectMode, highWaterMark, encoding, signal, responseBody = false } = options;
    super({
      objectMode,
      highWaterMark,
      encoding,
      signal,
    });
    this.#reader = undefined;
    this.#operation = undefined;
    this.#end = undefined;
    this.#stream = stream;
    this.#responseBody = responseBody;
  }

  // Locked before this wrapper opened it: a body method has the contents, nothing to read or cancel.
  #takenByResponse(stream: ReadableStream) {
    return this.#responseBody && stream.locked;
  }

  static #chunkStep(chunk: any, self: ReadableFromWeb) {
    self.push(chunk);
  }

  static #closeStep(_: undefined, self: ReadableFromWeb) {
    // A body of node-fetch or of undici is no Readable.fromWeb() in Node: after destroy() its end stays a premature close.
    if (self.#responseBody && self.destroyed) return;
    self.push(null);
  }

  static #errorStep(error: any, self: ReadableFromWeb) {
    destroyer(self, error);
  }

  // The read operation of the reader that the adapter has, or of the one that it takes from the stream now.
  #open() {
    let reader = this.#reader;
    if (reader === undefined) {
      const stream = this.#stream;
      if (stream === undefined) return undefined;
      this.#stream = undefined;
      if (this.#takenByResponse(stream)) {
        this.push(null);
        return undefined;
      }
      // From here on _destroy() cancels the source through the reader, also a reader that the read operation refuses.
      reader = this.#reader = stream.getReader();
    }
    const operation = createReadOperation(
      reader,
      this,
      ReadableFromWeb.#chunkStep,
      ReadableFromWeb.#closeStep,
      ReadableFromWeb.#errorStep,
    );
    this.#end = watchWebStreamEnd(reader);
    return (this.#operation = operation);
  }

  // One read per _read(). readMany() would drain a start()-enqueued source to "closed" before the consumer can abort,
  // and cancel() on a closed stream is a spec no-op, so the source's cancel hook would never run.
  _read() {
    $debug("ReadableFromWeb _read()");
    const operation = this.#operation ?? this.#open();
    if (operation !== undefined) readNextChunk(operation);
  }

  _destroy(error: Error | null, callback: $Node.ErrorCallback) {
    const reader = this.#reader;
    if (reader !== undefined) {
      const end = this.#end;
      this.#reader = undefined;
      this.#operation = undefined;
      this.#end = undefined;
      // A web stream that closed or errored by itself gets its lock back, as it did when the adapter read through
      // reader.read(). One that this call cancels stays locked. Node never gives the lock back.
      const ended = end !== undefined && $isPromise(end.closed) && !$isPromisePending(end.closed);
      if (end === undefined || !end.seen) {
        // As in Node, a cancel() that rejects doesn't error the Readable.
        const done = () => callback(error);
        PromisePrototypeThen.$call(reader.cancel(error), done, done);
        if (ended) reader.releaseLock();
        return;
      }
      reader.releaseLock();
    } else {
      const stream = this.#stream;
      if (stream !== undefined) {
        this.#stream = undefined;
        if (!this.#takenByResponse(stream)) {
          const done = () => callback(error);
          PromisePrototypeThen.$call(stream.cancel(error), done, done);
          return;
        }
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
const ZLIB_FAILURES: Set<string | undefined> = new SafeSet([
  ...ArrayPrototypeFilter.$call(
    ArrayPrototypeMap.$call(ObjectEntries(constants_zlib), ({ 0: code, 1: value }) => (value < 0 ? code : null)),
    Boolean,
  ),
  "Z_NEED_DICT",
]);

function handleKnownInternalErrors(cause: Error | null | undefined): Error | null | undefined {
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

function newWritableStreamFromStreamWritable(streamWritable: $Node.Writable) {
  // Not using the internal/streams/utils isWritableNodeStream utility
  // here because it will return false if streamWritable is a Duplex
  // whose writable option is false. For a Duplex that is not writable,
  // we want it to pass this check but return a closed WritableStream.
  // We check if the given stream is a stream.Writable or http.OutgoingMessage
  const checkIfWritableOrOutgoingMessage =
    streamWritable && typeof streamWritable?.write === "function" && typeof streamWritable?.on === "function";
  if (!checkIfWritableOrOutgoingMessage) {
    throw $ERR_INVALID_ARG_TYPE("streamWritable", "stream.Writable", streamWritable);
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

  let controller: WritableStreamDefaultController | undefined;
  let backpressurePromise: PromiseWithResolvers<void> | undefined;
  let closed: PromiseWithResolvers<void> | undefined;

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
      // close() clears the controller when the stream has already ended.
      controller?.error(error);
      controller = undefined;
      return;
    }

    if (closed !== undefined) {
      closed.resolve();
      closed = undefined;
      return;
    }
    controller?.error($makeAbortError());
    controller = undefined;
  });

  streamWritable.on("drain", onDrain);

  return new WritableStream(
    {
      start(c) {
        controller = c;
      },

      write(chunk) {
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
      },

      abort(reason) {
        destroyer(streamWritable, reason as Error);
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

interface StreamWritableFromWritableStreamOptions {
  highWaterMark?: number;
  decodeStrings?: boolean;
  objectMode?: boolean;
  signal?: AbortSignal;
}

function newStreamWritableFromWritableStream(
  writableStream: WritableStream,
  options: StreamWritableFromWritableStreamOptions = kEmptyObject,
) {
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
      function done(error?: Error | null) {
        try {
          callback(error);
        } catch (error) {
          // In a next tick because this is happening within
          // a promise context, and if there are any errors
          // thrown we don't want those to cause an unhandled
          // rejection. Let's just escape the promise and
          // handle it separately.
          process.nextTick(() => destroyer(writable, error as Error));
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

      function done(error?: Error | null) {
        try {
          callback(error);
        } catch (error) {
          destroyer(writable, error as Error);
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
      function done(error?: Error | null) {
        try {
          callback(error);
        } catch (error) {
          // In a next tick because this is happening within
          // a promise context, and if there are any errors
          // thrown we don't want those to cause an unhandled
          // rejection. Let's just escape the promise and
          // handle it separately.
          process.nextTick(() => destroyer(writable, error as Error));
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

interface StreamReadableUnderlyingSource {
  __proto__?: null;
  type: "bytes" | undefined;
  start(c: ReadableStreamDefaultController | ReadableByteStreamController): void;
  cancel(reason: unknown): void;
  pull?(): void;
}

interface ReadableStreamFromStreamReadableOptions {
  __proto__?: null;
  type?: "bytes";
  strategy?: { highWaterMark?: number; size?(chunk: unknown): number };
}

function newReadableStreamFromStreamReadable(
  streamReadable: $Node.Readable,
  options: ReadableStreamFromStreamReadableOptions = kEmptyObject,
) {
  // Not using the internal/streams/utils isReadableNodeStream utility
  // here because it will return false if streamReadable is a Duplex
  // whose readable option is false. For a Duplex that is not readable,
  // we want it to pass this check but return a closed ReadableStream.
  if (typeof streamReadable?._readableState !== "object") {
    throw $ERR_INVALID_ARG_TYPE("streamReadable", "stream.Readable", streamReadable);
  }
  validateObject(options, "options");
  const optionsType = options.type;
  if (optionsType !== undefined) {
    validateOneOf(optionsType, "options.type", ["bytes", undefined]);
  }

  const isBYOB = optionsType === "bytes";
  let controller: ReadableStreamDefaultController | ReadableByteStreamController | undefined;
  let wasCanceled = false;
  let strategy: ReadableStreamFromStreamReadableOptions["strategy"];

  const underlyingSource: StreamReadableUnderlyingSource = {
    __proto__: null,
    type: isBYOB ? "bytes" : undefined,
    start(c) {
      controller = c;
    },
    cancel(reason) {
      wasCanceled = true;
      destroyer(streamReadable, reason as Error);
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
      if (error) return controller!.error(error);
      controller!.close();
      if (isBYOB) (controller as ReadableByteStreamController).byobRequest?.respond(0);
    },
  );

  if (wasCanceled) {
    // `eos` called the callback synchronously
    cleanup();
  } else if (readable) {
    streamReadable.pause();

    streamReadable.on("data", function onData(chunk) {
      // Buffered data can still be emitted after cancel() destroys the stream.
      if (wasCanceled) return;
      // Copy the Buffer to detach it from the pool.
      if (Buffer.isBuffer(chunk) && !objectMode) chunk = new Uint8Array(chunk);
      controller!.enqueue(chunk);
      if (controller!.desiredSize! <= 0) streamReadable.pause();
    });
  }

  return readableStream;
}

interface StreamReadableFromReadableStreamOptions {
  highWaterMark?: number;
  encoding?: string;
  objectMode?: boolean;
  signal?: AbortSignal;
  responseBody?: boolean;
}

function newStreamReadableFromReadableStream(
  readableStream: ReadableStream,
  options: StreamReadableFromReadableStreamOptions = kEmptyObject,
) {
  if (!$inheritsReadableStream(readableStream)) {
    throw $ERR_INVALID_ARG_TYPE("readableStream", "ReadableStream", readableStream);
  }

  validateObject(options, "options");
  const { highWaterMark, encoding, objectMode = false, signal } = options;

  if (encoding !== undefined && !Buffer.isEncoding(encoding))
    throw $ERR_INVALID_ARG_VALUE("options.encoding", encoding);
  validateBoolean(objectMode, "options.objectMode");

  // Node acquires the reader at this point, so a locked stream throws here too.
  if (readableStream.locked) throw $ERR_INVALID_STATE_TypeError("ReadableStream is locked");

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

function newReadableWritablePairFromDuplex(
  duplex: $Node.Duplex,
  options: { readableType?: "bytes"; type?: "bytes" } = kEmptyObject,
) {
  // Not using the internal/streams/utils isWritableNodeStream and
  // isReadableNodeStream utilities here because they will return false
  // if the duplex was created with writable or readable options set to
  // false. Instead, we'll check the readable and writable state after
  // and return closed WritableStream or closed ReadableStream as
  // necessary.
  if (typeof duplex?._writableState !== "object" || typeof duplex?._readableState !== "object") {
    throw $ERR_INVALID_ARG_TYPE("duplex", "stream.Duplex", duplex);
  }

  validateObject(options, "options");

  const readableOptions: ReadableStreamFromStreamReadableOptions = {
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

  const writable = isWritable(duplex) ? newWritableStreamFromStreamWritable(duplex) : new WritableStream();

  if (!isWritable(duplex)) writable.close();

  const readable = isReadable(duplex)
    ? newReadableStreamFromStreamReadable(duplex, readableOptions)
    : new ReadableStream({ type: readableOptions.type });

  if (!isReadable(duplex)) readable.cancel();

  return { writable, readable };
}

function duplexChunkStep(chunk: any, duplex: $Node.Duplex) {
  duplex.push(chunk);
}

function duplexCloseStep(_: undefined, duplex: $Node.Duplex) {
  duplex.push(null);
}

// Node's error step destroys the duplex in place, which aborts the sink:
// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/webstreams/adapters.js#L926-L942
// Node's write() also hands its chunk to the sink in place. Here write() does that one promise job later (the write
// half of nodejs/node#65548 is not ported), so a destroy in place would abort a write of the same turn that Node
// delivers. The reaction of reader.closed destroys the duplex instead, one promise job after the stream errors.
function duplexErrorStep() {}

interface StreamDuplexFromPairOptions extends StreamWritableFromWritableStreamOptions {
  allowHalfOpen?: boolean;
  encoding?: string;
}

function newStreamDuplexFromReadableWritablePair(
  pair: { readable: ReadableStream; writable: WritableStream } = kEmptyObject,
  options: StreamDuplexFromPairOptions = kEmptyObject,
) {
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
  let readOperation: NodeStreamReadOperation | undefined;

  const duplex = new Duplex({
    allowHalfOpen,
    highWaterMark,
    objectMode,
    encoding,
    decodeStrings,
    signal,

    writev(chunks, callback) {
      function done(error?: Error | null) {
        try {
          callback(error);
        } catch (error) {
          // In a next tick because this is happening within
          // a promise context, and if there are any errors
          // thrown we don't want those to cause an unhandled
          // rejection. Let's just escape the promise and
          // handle it separately.
          process.nextTick(() => destroyer(duplex, error as Error));
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

      function done(error?: Error | null) {
        try {
          callback(error);
        } catch (error) {
          destroyer(duplex, error as Error);
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
      function done(error?: Error | null) {
        try {
          callback(error);
        } catch (error) {
          // In a next tick because this is happening within
          // a promise context, and if there are any errors
          // thrown we don't want those to cause an unhandled
          // rejection. Let's just escape the promise and
          // handle it separately.
          process.nextTick(() => destroyer(duplex, error as Error));
        }
      }

      if (!writableClosed) {
        PromisePrototypeThen.$call(writer.close(), done, done);
      }
    },

    read() {
      readOperation ??= createReadOperation(reader, duplex, duplexChunkStep, duplexCloseStep, duplexErrorStep);
      readNextChunk(readOperation);
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

export default {
  newWritableStreamFromStreamWritable,
  newReadableStreamFromStreamReadable,
  newStreamWritableFromWritableStream,
  newStreamReadableFromReadableStream,
  newReadableWritablePairFromDuplex,
  newStreamDuplexFromReadableWritablePair,
  _ReadableFromWeb: ReadableFromWeb,
};
