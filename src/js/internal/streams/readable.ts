"use strict";

const EE = require("node:events");
const { Stream, prependListener } = require("internal/streams/legacy");
const { addAbortSignal, addAbortSignalNoValidate } = require("internal/streams/add-abort-signal");
const eos = require("internal/streams/end-of-stream");
const destroyImpl = require("internal/streams/destroy");
const streamState = require("internal/streams/state");
const { ReadableState, createByteReadableState, isReadableState, isWritableState, internals } = streamState;
const kState: typeof streamState.kState = streamState.kState;
const kOnConstructed: typeof streamState.kOnConstructed = streamState.kOnConstructed;
const kErroredValue: typeof streamState.kErroredValue = streamState.kErroredValue;
const kDefaultEncodingValue: typeof streamState.kDefaultEncodingValue = streamState.kDefaultEncodingValue;
const kDecoderValue: typeof streamState.kDecoderValue = streamState.kDecoderValue;
const kEncodingValue: typeof streamState.kEncodingValue = streamState.kEncodingValue;
type ReadableState = $Node.ReadableState;
type WritableState = $Node.WritableState;
const { aggregateTwoErrors } = require("internal/errors");
const { validateAbortSignal, validateObject } = require("internal/validators");
const { queueTick1, queueTick2 } = require("internal/process/next_tick_queue");
const { StringDecoder } = require("node:string_decoder");
const from = require("internal/streams/from");
const { SafeSet } = require("internal/primordials");
const shared = require("internal/shared");
const { kAutoDestroyed } = shared;
const isStandardOutputStream: (value: unknown) => boolean = $newCppFunction(
  "BunProcess.cpp",
  "jsFunctionIsStandardOutputStream",
  1,
);

const ObjectDefineProperties = Object.defineProperties;
const SymbolAsyncDispose = Symbol.asyncDispose;
const NumberIsNaN = Number.isNaN;
const NumberIsInteger = Number.isInteger;
const NumberParseInt = Number.parseInt as (value: unknown, radix?: number) => number;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ObjectKeys = Object.keys;
const SymbolAsyncIterator = Symbol.asyncIterator;
const TypedArrayPrototypeSet = Uint8Array.prototype.set;

const { errorOrDestroy } = destroyImpl;
const nop = () => {};
const { emit } = shared.originals.eventEmitter!;

// The bits of ReadableState[kState].
const enum Flag {
  ObjectMode = 1 << 0,
  ErrorEmitted = 1 << 1,
  AutoDestroy = 1 << 2,
  Destroyed = 1 << 4,
  Closed = 1 << 5,
  CloseEmitted = 1 << 6,
  Errored = 1 << 7,
  Constructed = 1 << 8,
  Ended = 1 << 9,
  EndEmitted = 1 << 10,
  Reading = 1 << 11,
  Sync = 1 << 12,
  NeedReadable = 1 << 13,
  EmittedReadable = 1 << 14,
  ReadableListening = 1 << 15,
  ResumeScheduled = 1 << 16,
  MultiAwaitDrain = 1 << 17,
  ReadingMore = 1 << 18,
  DataEmitted = 1 << 19,
  DefaultUTF8Encoding = 1 << 20,
  Decoder = 1 << 21,
  Encoding = 1 << 22,
  HasFlowing = 1 << 23,
  Flowing = 1 << 24,
  HasPaused = 1 << 25,
  Paused = 1 << 26,
  DataListening = 1 << 27,
}

const enum WritableFlag {
  Finished = 1 << 13,
  HasWritable = 1 << 21,
  Writable = 1 << 22,
}

declare global {
  namespace $Node {
    interface ReadableOptions extends StreamOptions {
      encoding?: string | null;
      read?(this: Readable, size: number): void;
    }

    interface ReadableIterator extends AsyncGenerator<unknown, void, unknown> {
      stream?: Readable;
    }

    interface ReadableIteratorOptions {
      destroyOnReturn?: boolean;
    }

    interface OperatorOptions {
      concurrency?: number;
      highWaterMark?: number;
      signal?: AbortSignal;
    }

    type OperatorCallback<R> = (data: unknown, options: { signal: AbortSignal }) => R | Promise<R>;

    interface Readable extends StreamWithState {
      _readableState: ReadableState;
      _read(size: number): void;
      /** `null` ends the stream. In object mode every other value is a chunk. */
      push(chunk: unknown, encoding?: string): boolean;
      unshift(chunk: unknown, encoding?: string): boolean;
      /** A `Buffer`, a string once an encoding is set, any value in object mode, or `null` when nothing is buffered. */
      read(size?: number): unknown;
      isPaused(): boolean;
      setEncoding(encoding: string): this;
      unpipe(destination?: AnyStream): this;
      resume(): this;
      pause(): this;
      wrap(stream: LegacyReadable): this;
      iterator(options?: ReadableIteratorOptions): ReadableIterator;
      [Symbol.asyncIterator](): ReadableIterator;
      compose(stream: unknown, options?: { signal?: AbortSignal }): Duplex;
      drop(limit: number, options?: OperatorOptions): Readable;
      take(limit: number, options?: OperatorOptions): Readable;
      filter(fn: OperatorCallback<unknown>, options?: OperatorOptions): Readable;
      flatMap(fn: OperatorCallback<unknown>, options?: OperatorOptions): Readable;
      map(fn: OperatorCallback<unknown>, options?: OperatorOptions): Readable;
      every(fn: OperatorCallback<unknown>, options?: OperatorOptions): Promise<boolean>;
      some(fn: OperatorCallback<unknown>, options?: OperatorOptions): Promise<boolean>;
      find(fn: OperatorCallback<unknown>, options?: OperatorOptions): Promise<unknown>;
      forEach(fn: OperatorCallback<unknown>, options?: OperatorOptions): Promise<void>;
      reduce(
        fn: (previous: unknown, data: unknown, options: { signal: AbortSignal }) => unknown,
        initial?: unknown,
        options?: OperatorOptions,
      ): Promise<unknown>;
      toArray(options?: OperatorOptions): Promise<unknown[]>;
      get readable(): boolean;
      set readable(value: boolean);
      get readableDidRead(): boolean;
      get readableAborted(): boolean;
      get readableHighWaterMark(): number;
      get readableBuffer(): unknown[];
      get readableFlowing(): boolean | null;
      set readableFlowing(value: boolean | null);
      get readableLength(): number;
      get readableObjectMode(): boolean;
      get readableEncoding(): string | null;
      get readableEnded(): boolean;
    }

    interface ReadableConstructor {
      new (options?: ReadableOptions): Readable;
      (this: Readable, options?: ReadableOptions): void;
      prototype: any;
      ReadableState: typeof ReadableState;
      _fromList: typeof Readable._fromList;
      from: typeof Readable.from;
      fromWeb: typeof Readable.fromWeb;
      toWeb: typeof Readable.toWeb;
      wrap: typeof Readable.wrap;
    }
  }
}

ReadableState.prototype[kOnConstructed] = function onConstructed(this: ReadableState, stream: $Node.Readable) {
  if ((this[kState] & Flag.NeedReadable) !== 0) {
    maybeReadMore(stream, this);
  }
};

declare global {
  namespace $Node {
    interface PreallocatedEvents {
      close: Listener | Listener[] | undefined;
      error: Listener | Listener[] | undefined;
      data: Listener | Listener[] | undefined;
      end: Listener | Listener[] | undefined;
      readable: Listener | Listener[] | undefined;
      resume?: Listener | Listener[] | undefined;
    }
  }
}

function preallocatedEvents(): $Node.Events {
  return {
    close: undefined,
    error: undefined,
    data: undefined,
    end: undefined,
    readable: undefined,
    // Skip uncommon events...
    // pause: undefined,
    // resume: undefined,
    // pipe: undefined,
    // unpipe: undefined,
    // [destroyImpl.kConstruct]: undefined,
    // [destroyImpl.kDestroy]: undefined,
  };
}

// A function of its own: a closure over `this` in the constructor is an environment that every stream would make, also the many without _construct().
function runConstruct(stream: $Node.Readable) {
  destroyImpl.construct(stream, () => {
    stream._readableState[kOnConstructed](stream);
  });
}

function Readable(this: $Node.Readable, options?: $Node.ReadableOptions): void {
  if (new.target !== Readable && !(this instanceof Readable)) {
    ("unlikely");
    return new Readable(options) as any;
  }

  this._events ??= preallocatedEvents();

  this._readableState = new ReadableState(options, this, false);

  if (options) {
    const { read, destroy, construct, signal } = options;
    if (typeof read === "function") this._read = read;

    if (typeof destroy === "function") this._destroy = destroy;

    if (typeof construct === "function") this._construct = construct;

    if (signal) addAbortSignal(signal, this);
  }

  Stream.$call(this, options);

  if (this._construct != null) runConstruct(this);
}
$toClass(Readable, "Readable", Stream);

Readable.ReadableState = ReadableState;

function constructReadable(stream: $Node.Readable, highWaterMark: unknown): void {
  stream._events ??= preallocatedEvents();

  stream._readableState = createByteReadableState(highWaterMark);

  Stream.$call(stream, undefined);

  if (stream._construct != null) runConstruct(stream);
}

internals.constructReadable = constructReadable;
internals.preallocatedEvents = preallocatedEvents;

Readable.prototype.destroy = destroyImpl.destroy;
Readable.prototype._undestroy = destroyImpl.undestroy;
Readable.prototype._destroy = function (this: $Node.Readable, err: Error | null, cb: $Node.ErrorCallback) {
  cb(err);
};

Readable.prototype[EE.captureRejectionSymbol] = function (this: $Node.Readable, err: Error) {
  this.destroy(err);
};

Readable.prototype[SymbolAsyncDispose] = function (this: $Node.Readable) {
  let error;
  if (!this.destroyed) {
    error = this.readableEnded ? null : $makeAbortError();
    this.destroy(error);
  }
  return new Promise((resolve, reject) => eos(this, err => (err && err !== error ? reject(err) : resolve(null))));
};

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
const pushingMethod = (Readable.prototype.push = function (this: $Node.Readable, chunk: unknown, encoding?: string) {
  $debug("push", chunk);

  const state: ReadableState = this._readableState;
  return (state[kState] & Flag.ObjectMode) === 0
    ? readableAddChunkPushByteMode(this, state, chunk, encoding)
    : readableAddChunkPushObjectMode(this, state, chunk, encoding);
});

function push(stream: $Node.Readable, state: ReadableState, chunk, encoding): boolean {
  return (state[kState] & Flag.ObjectMode) === 0
    ? readableAddChunkPushByteMode(stream, state, chunk, encoding)
    : readableAddChunkPushObjectMode(stream, state, chunk, encoding);
}

internals.pushToReadable = push;
internals.pushingMethod = pushingMethod;

// Unshift should *always* be something directly out of read().
Readable.prototype.unshift = function (this: $Node.Readable, chunk: unknown, encoding?: string) {
  $debug("unshift", chunk);
  const state: ReadableState = this._readableState;
  return (state[kState] & Flag.ObjectMode) === 0
    ? readableAddChunkUnshiftByteMode(this, state, chunk, encoding)
    : readableAddChunkUnshiftObjectMode(this, state, chunk);
};

function readableAddChunkUnshiftByteMode(stream: $Node.Readable, state: ReadableState, chunk, encoding): boolean {
  if (chunk === null) {
    state[kState] &= ~Flag.Reading;
    onEofChunk(stream, state);

    return false;
  }

  if (typeof chunk === "string") {
    encoding ||= (state[kState] & Flag.DefaultUTF8Encoding) !== 0 ? "utf8" : state[kDefaultEncodingValue];
    const stateEncoding = (state[kState] & Flag.Encoding) !== 0 ? state[kEncodingValue] : null;
    if (stateEncoding !== encoding) {
      if (stateEncoding) {
        // When unshifting, if state.encoding is set, we have to save
        // the string in the BufferList with the state encoding.
        chunk = (Buffer.from(chunk, encoding) as Buffer).toString(stateEncoding);
      } else {
        chunk = Buffer.from(chunk, encoding);
      }
    }
  } else if (Stream._isArrayBufferView(chunk)) {
    chunk = Stream._uint8ArrayToBuffer(chunk);
  } else if (chunk !== undefined && !(chunk instanceof Buffer)) {
    errorOrDestroy(stream, $ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "TypedArray", "DataView"], chunk));
    return false;
  }

  if (!(chunk && chunk.length > 0)) {
    return canPushMore(state);
  }

  return readableAddChunkUnshiftValue(stream, state, chunk);
}

function readableAddChunkUnshiftObjectMode(stream: $Node.Readable, state: ReadableState, chunk): boolean {
  if (chunk === null) {
    state[kState] &= ~Flag.Reading;
    onEofChunk(stream, state);

    return false;
  }

  return readableAddChunkUnshiftValue(stream, state, chunk);
}

function readableAddChunkUnshiftValue(stream: $Node.Readable, state: ReadableState, chunk): boolean {
  if ((state[kState] & Flag.EndEmitted) !== 0) errorOrDestroy(stream, $ERR_STREAM_UNSHIFT_AFTER_END_EVENT());
  else if ((state[kState] & (Flag.Destroyed | Flag.Errored)) !== 0) return false;
  else addChunk(stream, state, chunk, (state[kState] & Flag.ObjectMode) !== 0 ? 1 : (chunk.length as number), true);

  return canPushMore(state);
}

function readableAddChunkPushByteMode(stream: $Node.Readable, state: ReadableState, chunk, encoding): boolean {
  if (chunk === null) {
    state[kState] &= ~Flag.Reading;
    onEofChunk(stream, state);
    return false;
  }

  if (typeof chunk === "string") {
    encoding ||= (state[kState] & Flag.DefaultUTF8Encoding) !== 0 ? "utf8" : state[kDefaultEncodingValue];
    if (((state[kState] & Flag.Encoding) !== 0 ? state[kEncodingValue] : null) !== encoding) {
      chunk = Buffer.from(chunk, encoding);
      encoding = "";
    }
  } else if (chunk instanceof Buffer) {
    encoding = "";
  } else if (Stream._isArrayBufferView(chunk)) {
    chunk = Stream._uint8ArrayToBuffer(chunk);
    encoding = "";
  } else if (chunk !== undefined) {
    errorOrDestroy(stream, $ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "TypedArray", "DataView"], chunk));
    return false;
  }

  let length = chunk ? (chunk.length as number) : 0;
  if (!chunk || length <= 0) {
    ("unlikely");
    state[kState] &= ~Flag.Reading;
    maybeReadMore(stream, state);

    return canPushMore(state);
  }

  if ((state[kState] & Flag.Ended) !== 0) {
    ("unlikely");
    errorOrDestroy(stream, $ERR_STREAM_PUSH_AFTER_EOF());
    return false;
  }

  if ((state[kState] & (Flag.Destroyed | Flag.Errored)) !== 0) {
    return false;
  }

  state[kState] &= ~Flag.Reading;
  if ((state[kState] & Flag.Decoder) !== 0 && !encoding) {
    chunk = state[kDecoderValue]!.write(chunk);
    length = chunk.length as number;
    if (length === 0) {
      maybeReadMore(stream, state);
      return canPushMore(state);
    }
  }

  addChunk(stream, state, chunk, length, false);
  return canPushMore(state);
}

function readableAddChunkPushObjectMode(stream: $Node.Readable, state: ReadableState, chunk, encoding): boolean {
  if (chunk === null) {
    state[kState] &= ~Flag.Reading;
    onEofChunk(stream, state);
    return false;
  }

  if ((state[kState] & Flag.Ended) !== 0) {
    ("unlikely");
    errorOrDestroy(stream, $ERR_STREAM_PUSH_AFTER_EOF());
    return false;
  }

  if ((state[kState] & (Flag.Destroyed | Flag.Errored)) !== 0) {
    return false;
  }

  state[kState] &= ~Flag.Reading;

  if ((state[kState] & Flag.Decoder) !== 0 && !encoding) {
    chunk = state[kDecoderValue]!.write(chunk);
  }

  addChunk(stream, state, chunk, 1, false);
  return canPushMore(state);
}

function canPushMore(state: ReadableState): boolean {
  // We can push more data if we are below the highWaterMark.
  // Also, if we have no data yet, we can stand some more bytes.
  // This is to work around cases where hwm=0, such as the repl.
  return (state[kState] & Flag.Ended) === 0 && (state.length < state.highWaterMark || state.length === 0);
}

function addChunk(stream: $Node.Readable, state: ReadableState, chunk, length: number, addToFront: boolean): void {
  if (
    (state[kState] & (Flag.Flowing | Flag.Sync | Flag.DataListening)) === (Flag.Flowing | Flag.DataListening) &&
    state.length === 0
  ) {
    // Use the guard to avoid creating `Set()` repeatedly
    // when we have multiple pipes.
    if ((state[kState] & Flag.MultiAwaitDrain) !== 0) {
      ("unlikely");
      (state.awaitDrainWriters as Set<$Node.AnyStream>).clear();
    } else {
      state.awaitDrainWriters = null;
    }

    state[kState] |= Flag.DataEmitted;
    stream.emit("data", chunk);
  } else {
    bufferChunk(stream, state, chunk, length, addToFront);
  }
  maybeReadMore(stream, state);
}

function bufferChunk(stream: $Node.Readable, state: ReadableState, chunk, length: number, addToFront: boolean): void {
  // Update the buffer info.
  state.length += length;
  if (addToFront) {
    if (state.bufferIndex > 0) {
      state.buffer[--state.bufferIndex] = chunk;
    } else {
      state.buffer.unshift(chunk); // Slow path
    }
  } else {
    state.buffer.push(chunk);
  }

  if ((state[kState] & Flag.NeedReadable) !== 0) emitReadable(stream);
}

Readable.prototype.isPaused = function (this: $Node.Readable) {
  const state: ReadableState = this._readableState;
  return (state[kState] & Flag.Paused) !== 0 || (state[kState] & (Flag.HasFlowing | Flag.Flowing)) === Flag.HasFlowing;
};

// Backwards compatibility.
Readable.prototype.setEncoding = function (this: $Node.Readable, enc: string) {
  const state: ReadableState = this._readableState;

  const decoder = new StringDecoder(enc);
  state[kDecoderValue] = decoder;
  state[kState] |= Flag.Decoder;
  // If setEncoding(null), decoder.encoding equals utf8.
  const encoding = decoder.encoding;
  if (encoding) {
    state[kEncodingValue] = encoding;
    state[kState] |= Flag.Encoding;
  } else {
    state[kState] &= ~Flag.Encoding;
  }

  // Iterate over current buffer to convert already stored Buffers:
  let content = "";
  // oxlint-disable-next-line bun/no-duplicate-conditional-property-access
  if (state.buffer.length !== state.bufferIndex) {
    for (const data of state.buffer.slice(state.bufferIndex)) {
      content += decoder.write(data);
    }
  }
  state.buffer.length = 0;
  state.bufferIndex = 0;

  if (content !== "") state.buffer.push(content);
  state.length = content.length;
  return this;
};

// Don't raise the hwm > 1GB.
const MAX_HWM = 0x40000000;
function computeNewHighWaterMark(n: number): number {
  if (n > MAX_HWM) {
    throw $ERR_OUT_OF_RANGE("size", "<= 1GiB", n);
  } else {
    // Get the next highest power of 2 to prevent increasing hwm excessively in
    // tiny amounts.
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

// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function howMuchToRead(n: number, state: ReadableState): number {
  if (n <= 0 || (state.length === 0 && (state[kState] & Flag.Ended) !== 0)) return 0;
  if ((state[kState] & Flag.ObjectMode) !== 0) return 1;
  return howManyBytesToRead(n, state);
}

// `state.length` is the sum of the lengths of what is buffered.
function firstChunkLength(state: ReadableState): number {
  const buffer = state.buffer;
  const index = state.bufferIndex;
  return buffer.length - index === 1 ? state.length : (buffer[index].length as number);
}

function howManyBytesToRead(n: number, state: ReadableState): number {
  if (NumberIsNaN(n)) {
    // Fast path for buffers.
    if ((state[kState] & Flag.Decoder) === 0 && state.length) return firstChunkLength(state);

    // Only flow one buffer at a time.
    if ((state[kState] & Flag.Flowing) !== 0 && state.length) return firstChunkLength(state);

    return state.length;
  }
  if (n <= state.length) return n;
  return (state[kState] & Flag.Ended) !== 0 ? state.length : 0;
}

// You can override either this method, or the async _read(n) below.
const readingMethod = (Readable.prototype.read = function (this: $Node.Readable, n?: number) {
  $debug("read", n);
  // Same as parseInt(undefined, 10), however V8 7.3 performance regressed
  // in this scenario, so we are doing it manually.
  if (n === undefined) {
    n = NaN;
  } else if (!NumberIsInteger(n)) {
    n = NumberParseInt(n, 10);
  }
  return read(this, this._readableState, n);
});

function read(stream: $Node.Readable, state: ReadableState, n: number) {
  const nOrig = n;

  // If we're asking for more than the current hwm, then raise the hwm.
  if (n > state.highWaterMark) {
    ("unlikely");
    state.highWaterMark = computeNewHighWaterMark(n);
  }

  if (n !== 0) state[kState] &= ~Flag.EmittedReadable;

  // If we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  const stateLength = state.length;
  const flags = state[kState];
  if (
    n === 0 &&
    (flags & Flag.NeedReadable) !== 0 &&
    ((state.highWaterMark !== 0 ? stateLength >= state.highWaterMark : stateLength > 0) || (flags & Flag.Ended) !== 0)
  ) {
    $debug("read: emitReadable");
    if (stateLength === 0 && (flags & Flag.Ended) !== 0) endReadable(stream);
    else emitReadable(stream);
    return null;
  }

  n = howMuchToRead(n, state);

  // If we've ended, and we're now clear, then finish it up.
  if (n === 0 && (state[kState] & Flag.Ended) !== 0) {
    if (state.length === 0) endReadable(stream);
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
  let doRead = (state[kState] & Flag.NeedReadable) !== 0;
  $debug("need readable", doRead);

  // If we currently have less than the highWaterMark, then also read some.
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    $debug("length less than watermark", doRead);
  }

  // However, if we've ended, then there's no point, if we're already
  // reading, then it's unnecessary, if we're constructing we have to wait,
  // and if we're destroyed or errored, then it's not allowed,
  if (
    (state[kState] & (Flag.Reading | Flag.Ended | Flag.Destroyed | Flag.Errored | Flag.Constructed)) !==
    Flag.Constructed
  ) {
    doRead = false;
    $debug("reading, ended or constructing", doRead);
  } else if (doRead) {
    $debug("do read");
    state[kState] |= Flag.Reading | Flag.Sync;
    // If the length is currently zero, then we *need* a readable event.
    if (state.length === 0) state[kState] |= Flag.NeedReadable;

    // Call internal read method
    const highWaterMark = state.highWaterMark;
    try {
      stream._read(highWaterMark);
    } catch (err) {
      errorOrDestroy(stream, err as Error);
    }
    state[kState] &= ~Flag.Sync;

    // If _read pushed data synchronously, then `reading` will be false,
    // and we need to re-evaluate how much data we can return to the user.
    if ((state[kState] & Flag.Reading) === 0) n = howMuchToRead(nOrig, state);
  }

  let ret;
  if (n > 0) ret = fromList(n, state);
  else ret = null;

  if (ret === null) {
    state[kState] |= state.length <= state.highWaterMark ? Flag.NeedReadable : 0;
    n = 0;
  } else {
    state.length -= n;
    if ((state[kState] & Flag.MultiAwaitDrain) !== 0) {
      ("unlikely");
      (state.awaitDrainWriters as Set<$Node.AnyStream>).clear();
    } else {
      state.awaitDrainWriters = null;
    }
  }

  if (state.length === 0) {
    // If we have nothing in the buffer, then we want to know
    // as soon as we *do* get something into the buffer.
    if ((state[kState] & Flag.Ended) === 0) state[kState] |= Flag.NeedReadable;

    // If we tried to read() past the EOF, then emit end on the next tick.
    if (nOrig !== n && (state[kState] & Flag.Ended) !== 0) endReadable(stream);
  }

  if (ret !== null && (state[kState] & (Flag.ErrorEmitted | Flag.CloseEmitted)) === 0) {
    state[kState] |= Flag.DataEmitted;
    if ((state[kState] & Flag.DataListening) !== 0 || mayHaveDataListeners(stream)) stream.emit("data", ret);
  }

  return ret;
}

// false: `stream.emit("data", ..)` would find nobody and do nothing: `read()` in paused mode.
function mayHaveDataListeners(stream: $Node.Readable): boolean {
  if (stream.emit !== emit) return true;
  const events = stream._events;
  return events !== undefined && events.data !== undefined;
}

function onEofChunk(stream: $Node.Readable, state: ReadableState): void {
  $debug("onEofChunk");
  if ((state[kState] & Flag.Ended) !== 0) return;
  const decoder = (state[kState] & Flag.Decoder) !== 0 ? state[kDecoderValue] : null;
  if (decoder) {
    const chunk = decoder.end();
    if (chunk?.length) {
      state.buffer.push(chunk);
      state.length += (state[kState] & Flag.ObjectMode) !== 0 ? 1 : (chunk.length as number);
    }
  }
  state[kState] |= Flag.Ended;

  if ((state[kState] & Flag.Sync) !== 0) {
    // If we are sync, wait until next tick to emit the data.
    // Otherwise we risk emitting data in the flow()
    // the readable code triggers during a read() call.
    emitReadable(stream);
  } else {
    // Emit 'readable' now to make sure it gets picked up.
    state[kState] &= ~Flag.NeedReadable;
    state[kState] |= Flag.EmittedReadable;
    // We have to emit readable now that we are EOF. Modules
    // in the ecosystem (e.g. dicer) rely on this event being sync.
    emitReadable_(stream);
  }
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream: $Node.Readable) {
  const state: ReadableState = stream._readableState;
  $debug("emitReadable");
  state[kState] &= ~Flag.NeedReadable;
  if ((state[kState] & Flag.EmittedReadable) === 0) {
    $debug("emitReadable", (state[kState] & Flag.Flowing) !== 0);
    state[kState] |= Flag.EmittedReadable;
    queueTick1(emitReadable_, stream);
  }
}

function emitReadable_(stream: $Node.Readable) {
  const state: ReadableState = stream._readableState;
  $debug("emitReadable_");
  if ((state[kState] & (Flag.Destroyed | Flag.Errored)) === 0 && (state.length || (state[kState] & Flag.Ended) !== 0)) {
    stream.emit("readable");
    state[kState] &= ~Flag.EmittedReadable;
  }

  // The stream needs another readable event if:
  // 1. It is not flowing, as the flow mechanism will take
  //    care of it.
  // 2. It is not ended.
  // 3. It is below the highWaterMark, so we can schedule
  //    another readable later.
  state[kState] |=
    (state[kState] & (Flag.Flowing | Flag.Ended)) === 0 && state.length <= state.highWaterMark ? Flag.NeedReadable : 0;
  flow(stream);
}

// At this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream: $Node.Readable, state: ReadableState): void {
  if ((state[kState] & (Flag.ReadingMore | Flag.Reading | Flag.Constructed)) === Flag.Constructed) {
    state[kState] |= Flag.ReadingMore;
    queueTick2(maybeReadMore_, stream, state);
  }
}

function maybeReadMore_(stream: $Node.Readable, state: ReadableState): void {
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
    (state[kState] & (Flag.Reading | Flag.Ended)) === 0 &&
    (state.length < state.highWaterMark || ((state[kState] & Flag.Flowing) !== 0 && state.length === 0))
  ) {
    const len = state.length;
    $debug("maybeReadMore read 0");
    stream.read(0);
    if (len === state.length)
      // Didn't get any data, stop spinning.
      break;
  }
  state[kState] &= ~Flag.ReadingMore;
}

// Abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function (this: $Node.Readable, _n: number) {
  throw $ERR_METHOD_NOT_IMPLEMENTED("_read()");
};

Readable.prototype.pipe = function (this: $Node.Readable, destination: $Node.Stream, pipeOpts?: $Node.PipeOptions) {
  const dest: $Node.AnyStream = destination;
  const src = this;
  const state: ReadableState = this._readableState;

  if (state.pipes.length === 1) {
    if ((state[kState] & Flag.MultiAwaitDrain) === 0) {
      state[kState] |= Flag.MultiAwaitDrain;
      state.awaitDrainWriters = new SafeSet(state.awaitDrainWriters ? [state.awaitDrainWriters] : []);
    }
  }

  state.pipes.push(dest);
  $debug("pipe count=%d opts=%j", state.pipes.length, pipeOpts);

  const doEnd = (!pipeOpts || pipeOpts.end !== false) && !isStandardOutputStream(dest);

  const endFn = doEnd ? onend : unpipe;
  if ((state[kState] & Flag.EndEmitted) !== 0) process.nextTick(endFn);
  else src.once("end", endFn);

  dest.on("unpipe", onunpipe);
  function onunpipe(readable, unpipeInfo) {
    $debug("onunpipe");
    if (readable === src) {
      if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
        unpipeInfo.hasUnpiped = true;
        cleanup();
      }
    }
  }

  function onend() {
    $debug("onend");
    dest.end!();
  }

  let ondrain: (() => void) | undefined;

  let cleanedUp = false;
  function cleanup() {
    $debug("cleanup");
    // Cleanup event handlers once the pipe is broken.
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

    // If the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (ondrain && state.awaitDrainWriters && (!dest._writableState || dest._writableState.needDrain)) ondrain();
  }

  function pause() {
    // If the user unpiped during `dest.write()`, it is possible
    // to get stuck in a permanently paused state if that write
    // also returned false.
    // => Check whether `dest` is still a piping destination.
    if (!cleanedUp) {
      if (state.pipes.length === 1 && state.pipes[0] === dest) {
        $debug("false write response, pause", 0);
        state.awaitDrainWriters = dest;
        state[kState] &= ~Flag.MultiAwaitDrain;
      } else if (state.pipes.length > 1 && state.pipes.includes(dest)) {
        $debug("false write response, pause", (state.awaitDrainWriters as Set<$Node.AnyStream>).size);
        (state.awaitDrainWriters as Set<$Node.AnyStream>).add(dest);
      }
      src.pause();
    }
    if (!ondrain) {
      // When the dest drains, it reduces the awaitDrain counter
      // on the source.  This would be more elegant with a .once()
      // handler in flow(), but adding and removing repeatedly is
      // too slow.
      ondrain = pipeOnDrain(src, dest);
      dest.on("drain", ondrain);
    }
  }

  // Set once `dest` is known to be a Writable of ours: then `dest.write(chunk)` needs no call where `write` is Writable's own.
  let destState: WritableState | undefined;

  src.on("data", ondata);
  function ondata(chunk) {
    $debug("ondata");
    try {
      const ret =
        destState !== undefined && dest.write === internals.writingMethod
          ? internals.writeToWritable!(dest as $Node.Writable, destState, chunk, undefined, undefined) === true
          : dest.write!(chunk);
      $debug("dest.write", ret);
      if (ret === false) {
        pause();
      }
    } catch (err) {
      dest.destroy!(err as Error);
    }
  }

  // If the dest has an error, then stop piping into it.
  // However, don't suppress the throwing behavior for this.
  function onerror(er) {
    $debug("onerror", er);
    unpipe();
    dest.removeListener("error", onerror);
    if (dest.listenerCount("error") === 0) {
      const s = dest._writableState || dest._readableState;
      if (s && !s.errorEmitted) {
        // User incorrectly emitted 'error' directly on the stream.
        errorOrDestroy(dest, er);
      } else {
        dest.emit("error", er);
      }
    }
  }

  // Make sure our error handler is attached before userland ones.
  prependListener(dest, "error", onerror);

  // Both close and finish should trigger unpipe, but only once.
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

  // Tell the dest that it's being piped to.
  dest.emit("pipe", src);

  // Start the flow if it hasn't been started already.

  if (dest.writableNeedDrain === true) {
    pause();
  } else if ((state[kState] & Flag.Flowing) === 0) {
    $debug("pipe resume");
    src.resume();
  }

  const writableState = dest._writableState;
  if (isWritableState(writableState)) destState = writableState;

  return dest;
};

function pipeOnDrain(src: $Node.Readable, dest: $Node.AnyStream) {
  return function pipeOnDrainFunctionResult() {
    const state: ReadableState = src._readableState;

    // `ondrain` will call directly,
    // `this` maybe not a reference to dest,
    // so we use the real dest here.
    if (state.awaitDrainWriters === dest) {
      $debug("pipeOnDrain", 1);
      state.awaitDrainWriters = null;
    } else if ((state[kState] & Flag.MultiAwaitDrain) !== 0) {
      $debug("pipeOnDrain", (state.awaitDrainWriters as Set<$Node.AnyStream>).size);
      (state.awaitDrainWriters as Set<$Node.AnyStream>).delete(dest);
    }

    if (
      (!state.awaitDrainWriters || (state.awaitDrainWriters as Set<$Node.AnyStream>).size === 0) &&
      (state[kState] & Flag.DataListening) !== 0
    ) {
      src.resume();
    }
  };
}

Readable.prototype.unpipe = function (this: $Node.Readable, dest?: $Node.AnyStream) {
  const state: ReadableState = this._readableState;
  const unpipeInfo = { hasUnpiped: false };

  // If we're not piping anywhere, then do nothing.
  if (state.pipes.length === 0) return this;

  if (!dest) {
    // remove all.
    const dests = state.pipes;
    state.pipes = [];
    this.pause();

    for (let i = 0; i < dests.length; i++) dests[i].emit("unpipe", this, { hasUnpiped: false });
    return this;
  }

  // Try to find the right one.
  const index = ArrayPrototypeIndexOf.$call(state.pipes, dest);
  if (index === -1) return this;

  state.pipes.splice(index, 1);
  if (state.pipes.length === 0) this.pause();

  dest.emit("unpipe", this, unpipeInfo);

  return this;
};

// Set up data events if they are asked for
// Ensure readable listeners eventually get something.
Readable.prototype.on = function (this: $Node.Readable, ev: $Node.EventName, fn: $Node.Listener) {
  const res = Stream.prototype.on.$call(this, ev, fn);
  const state: ReadableState = this._readableState;

  if (ev === "data") {
    state[kState] |= Flag.DataListening;

    // Update readableListening so that resume() may be a no-op
    // a few lines down. This is needed to support once('readable').
    state[kState] |= this.listenerCount("readable") > 0 ? Flag.ReadableListening : 0;

    // Try start flowing on next tick if stream isn't explicitly paused.
    if ((state[kState] & (Flag.HasFlowing | Flag.Flowing)) !== Flag.HasFlowing) {
      this.resume();
    }
  } else if (ev === "readable") {
    if ((state[kState] & (Flag.EndEmitted | Flag.ReadableListening)) === 0) {
      state[kState] |= Flag.ReadableListening | Flag.NeedReadable | Flag.HasFlowing;
      state[kState] &= ~(Flag.Flowing | Flag.EmittedReadable);
      $debug("on readable");
      if (state.length) {
        emitReadable(this);
      } else if ((state[kState] & Flag.Reading) === 0) {
        queueTick1(nReadingNextTick, this);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

Readable.prototype.removeListener = function (this: $Node.Readable, ev: $Node.EventName, fn: $Node.Listener) {
  const state: ReadableState = this._readableState;

  const res = Stream.prototype.removeListener.$call(this, ev, fn);

  if (ev === "readable") {
    // We need to check if there is someone still listening to
    // readable and reset the state. However this needs to happen
    // after readable has been emitted but before I/O (nextTick) to
    // support once('readable', fn) cycles. This means that calling
    // resume within the same tick will have no
    // effect.
    queueTick1(updateReadableListening, this);
  } else if (ev === "data" && this.listenerCount("data") === 0) {
    state[kState] &= ~Flag.DataListening;
  }

  return res;
};
Readable.prototype.off = Readable.prototype.removeListener;

const removingAllMethod = (Readable.prototype.removeAllListeners = function (
  this: $Node.Readable,
  ev?: $Node.EventName,
) {
  const res = Stream.prototype.removeAllListeners.$apply(this, arguments);

  if (ev === "readable" || ev === undefined) {
    // We need to check if there is someone still listening to
    // readable and reset the state. However this needs to happen
    // after readable has been emitted but before I/O (nextTick) to
    // support once('readable', fn) cycles. This means that calling
    // resume within the same tick will have no
    // effect.
    queueTick1(updateReadableListening, this);
  }

  return res;
});

function updateReadableListening(self: $Node.Readable) {
  const state: ReadableState = self._readableState;

  if (self.listenerCount("readable") > 0) {
    state[kState] |= Flag.ReadableListening;
  } else {
    state[kState] &= ~Flag.ReadableListening;
  }

  if (
    (state[kState] & (Flag.HasPaused | Flag.Paused | Flag.ResumeScheduled)) ===
    (Flag.HasPaused | Flag.ResumeScheduled)
  ) {
    // Flowing needs to be set to true now, otherwise
    // the upcoming resume will not flow.
    state[kState] |= Flag.HasFlowing | Flag.Flowing;

    // Crude way to check if we should resume.
  } else if ((state[kState] & Flag.DataListening) !== 0) {
    self.resume();
  } else if ((state[kState] & Flag.ReadableListening) === 0) {
    state[kState] &= ~(Flag.HasFlowing | Flag.Flowing);
  }
}

function nReadingNextTick(self: $Node.Readable) {
  $debug("readable nexttick read 0");
  self.read(0);
}

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
const resumingMethod = (Readable.prototype.resume = function (this: $Node.Readable) {
  const state: ReadableState = this._readableState;
  // Node 26 (nodejs/node#62557) early-returns on Flag.Destroyed. We narrow it to Flag.Destroyed && Flag.EndEmitted: fd-slicer-style readables set `destroyed` right
  // before push(null), and the full guard strands their buffered tail when a
  // piped dest drains (yauzl/extract-zip). Once 'end' has fired there is
  // nothing left to flush, so becoming a no-op restores readableFlowing /
  // isPaused() parity for consumers that resume() past EOF (Readable.toWeb).
  if ((state[kState] & (Flag.Destroyed | Flag.EndEmitted)) === (Flag.Destroyed | Flag.EndEmitted)) {
    return this;
  }
  if ((state[kState] & Flag.Flowing) === 0) {
    $debug("resume");
    // We flow only if there is no one listening
    // for readable, but we still have to call
    // resume().
    state[kState] |= Flag.HasFlowing;
    if ((state[kState] & Flag.ReadableListening) === 0) {
      state[kState] |= Flag.Flowing;
    } else {
      state[kState] &= ~Flag.Flowing;
    }
    resume(this, state);
  }
  state[kState] |= Flag.HasPaused;
  state[kState] &= ~Flag.Paused;
  return this;
});

function resume(stream: $Node.Readable, state: ReadableState): void {
  if ((state[kState] & Flag.ResumeScheduled) === 0) {
    state[kState] |= Flag.ResumeScheduled;
    queueTick2(resume_, stream, state);
  }
}

function resume_(stream: $Node.Readable, state: ReadableState): void {
  $debug("resume", (state[kState] & Flag.Reading) !== 0);
  const resumeRequestBody = internals.resumeRequestBody;
  if (resumeRequestBody !== undefined && resumeRequestBody(stream, state)) return;

  if ((state[kState] & Flag.Reading) === 0) {
    stream.read(0);
  }

  finishResume(stream, state);
}

function finishResume(stream: $Node.Readable, state: ReadableState): void {
  state[kState] &= ~Flag.ResumeScheduled;
  stream.emit("resume");
  flow(stream);
  if ((state[kState] & (Flag.Flowing | Flag.Reading)) === Flag.Flowing) stream.read(0);
}

function finishReadOfNothing(state: ReadableState): void {
  state[kState] &= ~Flag.Sync;
  if (state.length <= state.highWaterMark) state[kState] |= Flag.NeedReadable;
}

internals.resumeOnNextTick = resume_;
internals.readableMethods = {
  read: readingMethod,
  push: pushingMethod,
  resume: resumingMethod,
  removeAllListeners: removingAllMethod,
};
internals.finishResume = finishResume;
internals.finishReadOfNothing = finishReadOfNothing;
internals.readMoreLater = maybeReadMore;
internals.readMoreOnNextTick = maybeReadMore_;
internals.emitReadableNow = emitReadable_;

Readable.prototype.pause = function (this: $Node.Readable) {
  const state: ReadableState = this._readableState;
  if ((state[kState] & Flag.Destroyed) !== 0) {
    return this;
  }
  $debug("call pause");
  if ((state[kState] & (Flag.HasFlowing | Flag.Flowing)) !== Flag.HasFlowing) {
    $debug("pause");
    state[kState] |= Flag.HasFlowing;
    state[kState] &= ~Flag.Flowing;
    this.emit("pause");
  }
  state[kState] |= Flag.HasPaused | Flag.Paused;
  return this;
};

function flow(stream: $Node.Readable) {
  const state: ReadableState = stream._readableState;
  $debug("flow");
  while ((state[kState] & Flag.Flowing) !== 0 && stream.read() !== null);
}

// Wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function (this: $Node.Readable, stream: $Node.LegacyReadable) {
  let paused = false;

  // TODO (ronag): Should this.destroy(err) emit
  // 'error' on the wrapped stream? Would require
  // a static factory method, e.g. Readable.wrap(stream).

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

  // Proxy all the other methods. Important when wrapping filters and duplexes.
  const streamKeys = ObjectKeys(stream);
  for (let j = 1; j < streamKeys.length; j++) {
    const i = streamKeys[j];
    if (this[i] === undefined && typeof stream[i] === "function") {
      this[i] = (stream[i] as (...args: unknown[]) => unknown).bind(stream);
    }
  }

  return this;
};

Readable.prototype[SymbolAsyncIterator] = function (this: $Node.Readable) {
  return streamToAsyncIterator(this);
};

Readable.prototype.iterator = function (this: $Node.Readable, options?: $Node.ReadableIteratorOptions) {
  if (options !== undefined) {
    validateObject(options, "options");
  }
  return streamToAsyncIterator(this, options);
};

// The flag cannot be checked at module load time (readable loads during
// bootstrap before options are available). Instead, toAsyncStreamable is
// always defined but lazily initializes on first call -- throwing if the
// flag is not set.
{
  const toAsyncStreamable = Symbol.for("Stream.toAsyncStreamable");
  interface BatchedIterator extends AsyncGenerator<unknown, void, unknown> {
    stream?: $Node.Readable;
    [mark: symbol]: unknown;
  }
  let createBatchedAsyncIterator:
    typeof import("internal/streams/iter/classic").default.createBatchedAsyncIterator | undefined;
  let normalizeBatch: typeof import("internal/streams/iter/classic").default.normalizeBatch | undefined;
  let kValidatedSource: typeof import("internal/streams/iter/types").default.kValidatedSource | undefined;

  Readable.prototype[toAsyncStreamable] = function (this: $Node.Readable) {
    if (createBatchedAsyncIterator === undefined) {
      // Write-once CLI bit set during argument parsing - unlike
      // process.execArgv this cannot be mutated by user code.
      if (!$cpp("NodeModuleModule.cpp", "createStreamIterEnabledFlag")) {
        throw $ERR_STREAM_ITER_MISSING_FLAG();
      }
      ({ createBatchedAsyncIterator, normalizeBatch } = require("internal/streams/iter/classic"));
      ({ kValidatedSource } = require("internal/streams/iter/types"));
    }
    const state: ReadableState = this._readableState;
    const normalize = state.objectMode || state.encoding ? normalizeBatch! : null;
    const iter = createBatchedAsyncIterator(this, normalize) as BatchedIterator;
    iter[kValidatedSource!] = true;
    iter.stream = this;
    return iter;
  };
}

let composeImpl: typeof import("internal/streams/compose").default | undefined;

Readable.prototype.compose = function compose(
  this: $Node.Readable,
  stream: unknown,
  options?: { signal?: AbortSignal },
) {
  if (options != null) {
    validateObject(options, "options");
  }
  if (options?.signal != null) {
    validateAbortSignal(options.signal, "options.signal");
  }

  composeImpl ??= require("internal/streams/compose");
  const composedStream = composeImpl(this, stream);

  if (options?.signal) {
    // Not validating as we already validated before
    addAbortSignalNoValidate(options.signal, composedStream);
  }

  return composedStream;
};

function streamToAsyncIterator(stream: $Node.Readable, options?: $Node.ReadableIteratorOptions) {
  if (typeof stream.read !== "function") {
    stream = Readable.wrap(stream, { objectMode: true });
  }

  const iter: $Node.ReadableIterator = createAsyncIterator(stream, options);
  iter.stream = stream;
  return iter;
}

function destroysItself(stream: $Node.Readable) {
  const state = stream._readableState as ReadableState | $Node.ForeignState;
  return isReadableState(state) ? (state[kState] & Flag.AutoDestroy) !== 0 : state.autoDestroy;
}

async function* createAsyncIterator(stream: $Node.Readable, options?: $Node.ReadableIteratorOptions) {
  let callback = nop;

  function next(this: unknown, resolve: (value?: unknown) => void) {
    if (this === stream) {
      callback();
      callback = nop;
    } else {
      callback = resolve;
    }
  }

  stream.on("readable", next);

  let error: any;
  const cleanup = eos(stream, { writable: false }, err => {
    error = err ? aggregateTwoErrors(error, err) : null;
    callback();
    callback = nop;
  });

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
        await new Promise(next);
      }
    }
  } catch (err: unknown) {
    error = aggregateTwoErrors(error, err as any);
    throw error;
  } finally {
    if ((error || options?.destroyOnReturn !== false) && (error === undefined || destroysItself(stream))) {
      destroyImpl.destroyer(stream, null);
    } else {
      stream.off("readable", next);
      cleanup();
    }
  }
}

// Making it explicit these properties are not enumerable
// because otherwise some prototype manipulation in
// userland will fail.
ObjectDefineProperties(Readable.prototype, {
  readable: {
    __proto__: null,
    get(this: $Node.Readable) {
      const r = this._readableState as ReadableState | $Node.ForeignState | undefined;
      if (isReadableState(r)) {
        return r.readable !== false && (r[kState] & (Flag.Destroyed | Flag.ErrorEmitted | Flag.EndEmitted)) === 0;
      }
      // r.readable === false means that this is part of a Duplex stream
      // where the readable side was disabled upon construction.
      // Compat. The user might manually disable readable side through
      // deprecated setter.
      return !!r && r.readable !== false && !r.destroyed && !r.errorEmitted && !r.endEmitted;
    },
    set(this: $Node.Readable, val) {
      // Backwards compat.
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      if (isReadableState(state)) {
        state.readable = !!val;
      } else if (state) {
        state.readable = !!val;
      }
    },
  },

  readableDidRead: {
    __proto__: null,
    enumerable: false,
    get: function (this: $Node.Readable) {
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      return isReadableState(state) ? (state[kState] & Flag.DataEmitted) !== 0 : state!.dataEmitted;
    },
  },

  readableAborted: {
    __proto__: null,
    enumerable: false,
    get: function (this: $Node.Readable) {
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      if (isReadableState(state)) {
        return (
          state.readable !== false &&
          (state[kState] & (Flag.Destroyed | Flag.Errored)) !== 0 &&
          (state[kState] & Flag.EndEmitted) === 0
        );
      }
      return !!(state!.readable !== false && (state!.destroyed || state!.errored) && !state!.endEmitted);
    },
  },

  readableHighWaterMark: {
    __proto__: null,
    enumerable: false,
    get: function (this: $Node.Readable) {
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      return isReadableState(state) ? state.highWaterMark : state!.highWaterMark;
    },
  },

  readableBuffer: {
    __proto__: null,
    enumerable: false,
    get: function (this: $Node.Readable) {
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      return isReadableState(state) ? state.buffer : state?.buffer;
    },
  },

  readableFlowing: {
    __proto__: null,
    enumerable: false,
    get: function (this: $Node.Readable) {
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      if (!isReadableState(state)) return state!.flowing;
      return (state[kState] & Flag.HasFlowing) !== 0 ? (state[kState] & Flag.Flowing) !== 0 : null;
    },
    set: function (this: $Node.Readable, state) {
      const readableState = this._readableState as ReadableState | $Node.ForeignState | undefined;
      if (isReadableState(readableState)) {
        readableState.flowing = state;
      } else if (readableState) {
        readableState.flowing = state;
      }
    },
  },

  readableLength: {
    __proto__: null,
    enumerable: false,
    get(this: $Node.Readable) {
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      return isReadableState(state) ? state.length : state!.length;
    },
  },

  readableObjectMode: {
    __proto__: null,
    enumerable: false,
    get(this: $Node.Readable) {
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      return isReadableState(state) ? (state[kState] & Flag.ObjectMode) !== 0 : state ? state.objectMode : false;
    },
  },

  readableEncoding: {
    __proto__: null,
    enumerable: false,
    get(this: $Node.Readable) {
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      if (!isReadableState(state)) return state ? state.encoding : null;
      return (state[kState] & Flag.Encoding) !== 0 ? state[kEncodingValue] : null;
    },
  },

  errored: {
    __proto__: null,
    enumerable: false,
    get(this: $Node.Readable) {
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      if (!isReadableState(state)) return state ? state.errored : null;
      return (state[kState] & Flag.Errored) !== 0 ? state[kErroredValue] : null;
    },
  },

  closed: {
    __proto__: null,
    get(this: $Node.Readable) {
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      return isReadableState(state) ? (state[kState] & Flag.Closed) !== 0 : state ? state.closed : false;
    },
  },

  destroyed: {
    __proto__: null,
    enumerable: false,
    get(this: $Node.Readable) {
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      return isReadableState(state) ? (state[kState] & Flag.Destroyed) !== 0 : state ? state.destroyed : false;
    },
    set(this: $Node.Readable, value) {
      // We ignore the value if the stream
      // has not been initialized yet.
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      if (!state) {
        return;
      }

      // Backward compatibility, the user is explicitly
      // managing destroyed.
      if (isReadableState(state)) state.destroyed = value;
      else state.destroyed = value;
    },
  },

  readableEnded: {
    __proto__: null,
    enumerable: false,
    get(this: $Node.Readable) {
      const state = this._readableState as ReadableState | $Node.ForeignState | undefined;
      return isReadableState(state) ? (state[kState] & Flag.EndEmitted) !== 0 : state ? state.endEmitted : false;
    },
  },
});

// Exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
// This function is designed to be inlinable, so please take care when making
// changes to the function body.
function fromList(n: number, state: ReadableState) {
  // nothing buffered.
  if (state.length === 0) return null;

  if ((state[kState] & Flag.ObjectMode) === 0) return bytesFromList(n, state);

  const idx = state.bufferIndex;
  const buf = state.buffer;
  const ret = buf[idx];
  buf[idx] = null;
  advanceBuffer(state, idx + 1, buf.length);
  return ret;
}

function advanceBuffer(state: ReadableState, idx: number, len: number): void {
  if (idx === len) {
    state.buffer.length = 0;
    state.bufferIndex = 0;
  } else if (idx > 1024) {
    state.buffer.splice(0, idx);
    state.bufferIndex = 0;
  } else {
    state.bufferIndex = idx;
  }
}

function bytesFromList(n: number, state: ReadableState) {
  let idx = state.bufferIndex;
  let ret;

  const buf = state.buffer;
  const len = buf.length;

  let stateLength;
  let firstLength: number;
  if (!n || n >= (stateLength = state.length)) {
    // Read it all, truncate the list.
    if ((state[kState] & Flag.Decoder) !== 0) {
      ret = "";
      while (idx < len) {
        ret += buf[idx];
        buf[idx++] = null;
      }
    } else if (len - idx === 0) {
      ret = Buffer.alloc(0);
    } else if (len - idx === 1) {
      ret = buf[idx];
      buf[idx++] = null;
    } else {
      ret = Buffer.allocUnsafe(stateLength ?? state.length);

      let i = 0;
      while (idx < len) {
        TypedArrayPrototypeSet.$call(ret, buf[idx], i);
        i += buf[idx].length;
        buf[idx++] = null;
      }
    }
  } else if (n < (firstLength = buf[idx].length as number)) {
    // `slice` is the same for buffers and strings.
    ret = (buf[idx] as string | Buffer).slice(0, n);
    buf[idx] = (buf[idx] as string | Buffer).slice(n);
  } else if (n === firstLength) {
    // First chunk is a perfect match.
    ret = buf[idx];
    buf[idx++] = null;
  } else if ((state[kState] & Flag.Decoder) !== 0) {
    ret = "";
    while (idx < len) {
      const str: string = buf[idx];
      const strLength = str.length;
      if (n > strLength) {
        ret += str;
        n -= strLength;
        buf[idx++] = null;
      } else {
        if (n === strLength) {
          ret += str;
          buf[idx++] = null;
        } else {
          ret += str.slice(0, n);
          buf[idx] = str.slice(n);
        }
        break;
      }
    }
  } else {
    ret = Buffer.allocUnsafe(n);

    const retLen = n;
    while (idx < len) {
      const data = buf[idx];
      const dataLength = data.length;
      if (n > dataLength) {
        TypedArrayPrototypeSet.$call(ret, data, retLen - n);
        n -= dataLength;
        buf[idx++] = null;
      } else {
        if (n === dataLength) {
          TypedArrayPrototypeSet.$call(ret, data, retLen - n);
          buf[idx++] = null;
        } else {
          TypedArrayPrototypeSet.$call(ret, new $Buffer(data.buffer, data.byteOffset, n), retLen - n);
          buf[idx] = new $Buffer(data.buffer, data.byteOffset + n, dataLength - n);
        }
        break;
      }
    }
  }

  advanceBuffer(state, idx, len);

  return ret;
}

function endReadable(stream: $Node.Readable) {
  const state: ReadableState = stream._readableState;

  $debug("endReadable");
  if ((state[kState] & Flag.EndEmitted) === 0) {
    state[kState] |= Flag.Ended;
    queueTick2(endReadableNT, state, stream);
  }
}

function endReadableNT(state: ReadableState, stream: $Node.Readable): void {
  $debug("endReadableNT");

  // Check that we didn't get one last unshift.
  if ((state[kState] & (Flag.Errored | Flag.CloseEmitted | Flag.EndEmitted)) === 0 && state.length === 0) {
    state[kState] |= Flag.EndEmitted;
    stream.emit("end");
    finishEnd(state, stream);
  }
}

function finishEnd(state: ReadableState, stream: $Node.Readable): void {
  const destroyEndedRequest = internals.destroyEndedRequest;
  if (destroyEndedRequest !== undefined && destroyEndedRequest(state, stream)) return;

  if (stream.writable && stream.allowHalfOpen === false) {
    queueTick1(endWritableNT, stream);
  } else if ((state[kState] & Flag.AutoDestroy) !== 0) {
    // In case of duplex streams we need a way to detect if the writable side is ready for autoDestroy as well.
    const wState = stream._writableState as WritableState | $Node.ForeignState | undefined;
    const autoDestroy = isWritableState(wState)
      ? (wState[kState] & Flag.AutoDestroy) !== 0 &&
        ((wState[kState] & WritableFlag.Finished) !== 0 ||
          (wState[kState] & (WritableFlag.HasWritable | WritableFlag.Writable)) === WritableFlag.HasWritable)
      : !wState ||
        (wState.autoDestroy &&
          // We don't expect the writable to ever 'finish'
          // if writable is explicitly set to false.
          (wState.finished || wState.writable === false));

    if (autoDestroy) {
      stream[kAutoDestroyed] = true; // workaround for node:http Server not using node:net Server
      stream.destroy();
    }
  }
}

internals.endOnNextTick = endReadableNT;
internals.finishEnd = finishEnd;

function endWritableNT(stream: $Node.Duplex) {
  const writable = stream.writable && !stream.writableEnded && !stream.destroyed;
  if (writable) {
    stream.end();
  }
}

Readable.from = function (
  iterable: string | Buffer | Iterable<unknown> | AsyncIterable<unknown>,
  opts?: $Node.ReadableOptions,
) {
  return from(Readable as $Node.ReadableConstructor, iterable, opts);
};

// Lazy to avoid circular references
Readable.fromWeb = function (readableStream, options?) {
  return require("internal/webstreams_adapters").newStreamReadableFromReadableStream(readableStream, options);
};

Readable.toWeb = function (streamReadable, options?) {
  return require("internal/webstreams_adapters").newReadableStreamFromStreamReadable(streamReadable, options);
};

Readable.wrap = function (src, options?) {
  return new (Readable as $Node.ReadableConstructor)({
    objectMode: src.readableObjectMode ?? src.objectMode ?? true,
    ...options,
    destroy(err, callback) {
      destroyImpl.destroyer(src, err);
      callback(err);
    },
  }).wrap(src);
};

export default Readable as $Node.ReadableConstructor;
