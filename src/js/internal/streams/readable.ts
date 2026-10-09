"use strict";

const EE = require("node:events");
const { Stream, prependListener } = require("internal/streams/legacy");
const { addAbortSignal, addAbortSignalNoValidate } = require("internal/streams/add-abort-signal");
const eos = require("internal/streams/end-of-stream");
const destroyImpl = require("internal/streams/destroy");
const { ReadableState, createReadableState, isReadableState, isWritableState, internals } =
  require("internal/streams/state") as typeof import("internal/streams/state").default;
type ReadableState = import("internal/streams/state").ReadableState;
type WritableState = import("internal/streams/state").WritableState;
const { aggregateTwoErrors } = require("internal/errors");
const { validateAbortSignal, validateObject } = require("internal/validators");
const { StringDecoder } = require("node:string_decoder");
const from = require("internal/streams/from");
const { SafeSet } = require("internal/primordials");
const { kAutoDestroyed } = require("internal/shared");

const process = globalThis.process;
const ObjectDefineProperties = Object.defineProperties;
const SymbolAsyncDispose = Symbol.asyncDispose;
const NumberIsNaN = Number.isNaN;
const NumberIsInteger = Number.isInteger;
const NumberParseInt = Number.parseInt;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ObjectKeys = Object.keys;
const SymbolAsyncIterator = Symbol.asyncIterator;
const TypedArrayPrototypeSet = Uint8Array.prototype.set;

const { errorOrDestroy } = destroyImpl;
const nop = () => {};
const emit: Function = EE.prototype.emit;
const kObjectMode = 1 << 0;
const kErrorEmitted = 1 << 1;
const kAutoDestroy = 1 << 2;
const kDestroyed = 1 << 4;
const kCloseEmitted = 1 << 6;
const kErrored = 1 << 7;
const kConstructed = 1 << 8;
const kEnded = 1 << 9;
const kEndEmitted = 1 << 10;
const kReading = 1 << 11;
const kSync = 1 << 12;
const kNeedReadable = 1 << 13;
const kEmittedReadable = 1 << 14;
const kReadableListening = 1 << 15;
const kResumeScheduled = 1 << 16;
const kMultiAwaitDrain = 1 << 17;
const kReadingMore = 1 << 18;
const kDataEmitted = 1 << 19;
const kDefaultUTF8Encoding = 1 << 20;
const kDecoder = 1 << 21;
const kEncoding = 1 << 22;
const kHasFlowing = 1 << 23;
const kFlowing = 1 << 24;
const kHasPaused = 1 << 25;
const kPaused = 1 << 26;
const kDataListening = 1 << 27;
const kHasReadable = 1 << 28;
const kReadable = 1 << 29;

function preallocatedEvents(): Record<string | symbol, unknown> {
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

function Readable(options): void {
  if (!(this instanceof Readable)) return new Readable(options);

  this._events ??= preallocatedEvents();

  this._readableState = createReadableState(options, this, false);

  if (options) {
    const { read, destroy, construct, signal } = options;
    if (typeof read === "function") this._read = read;

    if (typeof destroy === "function") this._destroy = destroy;

    if (typeof construct === "function") this._construct = construct;

    if (signal) addAbortSignal(signal, this);
  }

  Stream.$call(this, options);

  if (this._construct != null) {
    destroyImpl.construct(this, () => {
      onConstructed(this, this._readableState);
    });
  }
}
$toClass(Readable, "Readable", Stream);

Readable.ReadableState = ReadableState;

function onConstructed(stream, state: ReadableState): void {
  if ((state.flags & kNeedReadable) !== 0) {
    maybeReadMore(stream, state);
  }
}

internals.onReadableConstructed = onConstructed;

Readable.prototype.destroy = destroyImpl.destroy;
Readable.prototype._undestroy = destroyImpl.undestroy;
Readable.prototype._destroy = function (err, cb) {
  cb(err);
};

Readable.prototype[EE.captureRejectionSymbol] = function (err) {
  this.destroy(err);
};

Readable.prototype[SymbolAsyncDispose] = function () {
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
Readable.prototype.push = function (chunk, encoding) {
  $debug("push", chunk);

  const state: ReadableState = this._readableState;
  return (state.flags & kObjectMode) === 0
    ? readableAddChunkPushByteMode(this, state, chunk, encoding)
    : readableAddChunkPushObjectMode(this, state, chunk, encoding);
};

function push(stream, state: ReadableState, chunk, encoding): boolean {
  return (state.flags & kObjectMode) === 0
    ? readableAddChunkPushByteMode(stream, state, chunk, encoding)
    : readableAddChunkPushObjectMode(stream, state, chunk, encoding);
}

internals.push = push;
internals.pushMethod = Readable.prototype.push;

// Unshift should *always* be something directly out of read().
Readable.prototype.unshift = function (chunk, encoding) {
  $debug("unshift", chunk);
  const state: ReadableState = this._readableState;
  return (state.flags & kObjectMode) === 0
    ? readableAddChunkUnshiftByteMode(this, state, chunk, encoding)
    : readableAddChunkUnshiftObjectMode(this, state, chunk);
};

function readableAddChunkUnshiftByteMode(stream, state: ReadableState, chunk, encoding): boolean {
  if (chunk === null) {
    state.flags &= ~kReading;
    onEofChunk(stream, state);

    return false;
  }

  if (typeof chunk === "string") {
    encoding ||= (state.flags & kDefaultUTF8Encoding) !== 0 ? "utf8" : state.defaultEncodingValue;
    const stateEncoding = (state.flags & kEncoding) !== 0 ? state.encodingValue : null;
    if (stateEncoding !== encoding) {
      if (stateEncoding) {
        // When unshifting, if state.encoding is set, we have to save
        // the string in the BufferList with the state encoding.
        chunk = Buffer.from(chunk, encoding).toString(stateEncoding);
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

function readableAddChunkUnshiftObjectMode(stream, state: ReadableState, chunk): boolean {
  if (chunk === null) {
    state.flags &= ~kReading;
    onEofChunk(stream, state);

    return false;
  }

  return readableAddChunkUnshiftValue(stream, state, chunk);
}

function readableAddChunkUnshiftValue(stream, state: ReadableState, chunk): boolean {
  if ((state.flags & kEndEmitted) !== 0) errorOrDestroy(stream, $ERR_STREAM_UNSHIFT_AFTER_END_EVENT());
  else if ((state.flags & (kDestroyed | kErrored)) !== 0) return false;
  else addChunk(stream, state, chunk, (state.flags & kObjectMode) !== 0 ? 1 : (chunk.length as number), true);

  return canPushMore(state);
}

function readableAddChunkPushByteMode(stream, state: ReadableState, chunk, encoding): boolean {
  if (chunk === null) {
    state.flags &= ~kReading;
    onEofChunk(stream, state);
    return false;
  }

  if (typeof chunk === "string") {
    encoding ||= (state.flags & kDefaultUTF8Encoding) !== 0 ? "utf8" : state.defaultEncodingValue;
    if (((state.flags & kEncoding) !== 0 ? state.encodingValue : null) !== encoding) {
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
    state.flags &= ~kReading;
    maybeReadMore(stream, state);

    return canPushMore(state);
  }

  if ((state.flags & kEnded) !== 0) {
    errorOrDestroy(stream, $ERR_STREAM_PUSH_AFTER_EOF());
    return false;
  }

  if ((state.flags & (kDestroyed | kErrored)) !== 0) {
    return false;
  }

  state.flags &= ~kReading;
  if ((state.flags & kDecoder) !== 0 && !encoding) {
    chunk = state.decoderValue.write(chunk);
    length = chunk.length as number;
    if (length === 0) {
      maybeReadMore(stream, state);
      return canPushMore(state);
    }
  }

  addChunk(stream, state, chunk, length, false);
  return canPushMore(state);
}

function readableAddChunkPushObjectMode(stream, state: ReadableState, chunk, encoding): boolean {
  if (chunk === null) {
    state.flags &= ~kReading;
    onEofChunk(stream, state);
    return false;
  }

  if ((state.flags & kEnded) !== 0) {
    errorOrDestroy(stream, $ERR_STREAM_PUSH_AFTER_EOF());
    return false;
  }

  if ((state.flags & (kDestroyed | kErrored)) !== 0) {
    return false;
  }

  state.flags &= ~kReading;

  if ((state.flags & kDecoder) !== 0 && !encoding) {
    chunk = state.decoderValue.write(chunk);
  }

  addChunk(stream, state, chunk, 1, false);
  return canPushMore(state);
}

function canPushMore(state: ReadableState): boolean {
  // We can push more data if we are below the highWaterMark.
  // Also, if we have no data yet, we can stand some more bytes.
  // This is to work around cases where hwm=0, such as the repl.
  return (state.flags & kEnded) === 0 && (state.length < state.highWaterMark || state.length === 0);
}

function addChunk(stream, state: ReadableState, chunk, length: number, addToFront: boolean): void {
  if ((state.flags & (kFlowing | kSync | kDataListening)) === (kFlowing | kDataListening) && state.length === 0) {
    // Use the guard to avoid creating `Set()` repeatedly
    // when we have multiple pipes.
    if ((state.flags & kMultiAwaitDrain) !== 0) {
      state.awaitDrainWriters.clear();
    } else {
      state.awaitDrainWriters = null;
    }

    state.flags |= kDataEmitted;
    stream.emit("data", chunk);
  } else {
    bufferChunk(stream, state, chunk, length, addToFront);
  }
  maybeReadMore(stream, state);
}

function bufferChunk(stream, state: ReadableState, chunk, length: number, addToFront: boolean): void {
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

  if ((state.flags & kNeedReadable) !== 0) emitReadable(stream);
}

Readable.prototype.isPaused = function () {
  const state: ReadableState = this._readableState;
  return (state.flags & kPaused) !== 0 || (state.flags & (kHasFlowing | kFlowing)) === kHasFlowing;
};

// Backwards compatibility.
Readable.prototype.setEncoding = function (enc) {
  const state: ReadableState = this._readableState;

  const decoder = new StringDecoder(enc);
  state.decoder = decoder;
  // If setEncoding(null), decoder.encoding equals utf8.
  state.encoding = state.decoder.encoding;

  // Iterate over current buffer to convert already stored Buffers:
  let content = "";
  for (const data of state.buffer.slice(state.bufferIndex)) {
    content += decoder.write(data);
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
  if (n <= 0 || (state.length === 0 && (state.flags & kEnded) !== 0)) return 0;
  if ((state.flags & kObjectMode) !== 0) return 1;
  return howManyBytesToRead(n, state);
}

// `state.length` is the sum of the lengths of what is buffered.
function lengthOfFirstChunk(state: ReadableState): number {
  const buffer = state.buffer;
  const index = state.bufferIndex;
  return buffer.length - index === 1 ? state.length : (buffer[index].length as number);
}

function howManyBytesToRead(n: number, state: ReadableState): number {
  if (NumberIsNaN(n)) {
    // Fast path for buffers.
    if ((state.flags & kDecoder) === 0 && state.length) return lengthOfFirstChunk(state);

    // Only flow one buffer at a time.
    if ((state.flags & kFlowing) !== 0 && state.length) return lengthOfFirstChunk(state);

    return state.length;
  }
  if (n <= state.length) return n;
  return (state.flags & kEnded) !== 0 ? state.length : 0;
}

// You can override either this method, or the async _read(n) below.
Readable.prototype.read = function (n) {
  $debug("read", n);
  // Same as parseInt(undefined, 10), however V8 7.3 performance regressed
  // in this scenario, so we are doing it manually.
  if (n === undefined) {
    n = NaN;
  } else if (!NumberIsInteger(n)) {
    n = NumberParseInt(n, 10);
  }
  return read(this, this._readableState, n);
};

function read(stream, state: ReadableState, n: number) {
  const nOrig = n;

  // If we're asking for more than the current hwm, then raise the hwm.
  if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);

  if (n !== 0) state.flags &= ~kEmittedReadable;

  // If we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  const stateLength = state.length;
  if (
    n === 0 &&
    (state.flags & kNeedReadable) !== 0 &&
    ((state.highWaterMark !== 0 ? stateLength >= state.highWaterMark : stateLength > 0) ||
      (state.flags & kEnded) !== 0)
  ) {
    $debug("read: emitReadable");
    if (stateLength === 0 && (state.flags & kEnded) !== 0) endReadable(stream);
    else emitReadable(stream);
    return null;
  }

  n = howMuchToRead(n, state);

  // If we've ended, and we're now clear, then finish it up.
  if (n === 0 && (state.flags & kEnded) !== 0) {
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
  let doRead = (state.flags & kNeedReadable) !== 0;
  $debug("need readable", doRead);

  // If we currently have less than the highWaterMark, then also read some.
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    $debug("length less than watermark", doRead);
  }

  // However, if we've ended, then there's no point, if we're already
  // reading, then it's unnecessary, if we're constructing we have to wait,
  // and if we're destroyed or errored, then it's not allowed,
  if ((state.flags & (kReading | kEnded | kDestroyed | kErrored | kConstructed)) !== kConstructed) {
    doRead = false;
    $debug("reading, ended or constructing", doRead);
  } else if (doRead) {
    $debug("do read");
    state.flags |= kReading | kSync;
    // If the length is currently zero, then we *need* a readable event.
    if (state.length === 0) state.flags |= kNeedReadable;

    // Call internal read method
    try {
      stream._read(state.highWaterMark);
    } catch (err) {
      errorOrDestroy(stream, err);
    }
    state.flags &= ~kSync;

    // If _read pushed data synchronously, then `reading` will be false,
    // and we need to re-evaluate how much data we can return to the user.
    if ((state.flags & kReading) === 0) n = howMuchToRead(nOrig, state);
  }

  let ret;
  if (n > 0) ret = fromList(n, state);
  else ret = null;

  if (ret === null) {
    state.flags |= state.length <= state.highWaterMark ? kNeedReadable : 0;
    n = 0;
  } else {
    state.length -= n;
    if ((state.flags & kMultiAwaitDrain) !== 0) {
      state.awaitDrainWriters.clear();
    } else {
      state.awaitDrainWriters = null;
    }
  }

  if (state.length === 0) {
    // If we have nothing in the buffer, then we want to know
    // as soon as we *do* get something into the buffer.
    if ((state.flags & kEnded) === 0) state.flags |= kNeedReadable;

    // If we tried to read() past the EOF, then emit end on the next tick.
    if (nOrig !== n && (state.flags & kEnded) !== 0) endReadable(stream);
  }

  if (ret !== null && (state.flags & (kErrorEmitted | kCloseEmitted)) === 0) {
    state.flags |= kDataEmitted;
    if ((state.flags & kDataListening) !== 0 || mayHaveDataListeners(stream)) stream.emit("data", ret);
  }

  return ret;
}

// false: `stream.emit("data", ..)` would find nobody and do nothing: `read()` in paused mode.
function mayHaveDataListeners(stream): boolean {
  if (stream.emit !== emit) return true;
  const events = stream._events;
  return events !== undefined && events.data !== undefined;
}

function onEofChunk(stream, state: ReadableState): void {
  $debug("onEofChunk");
  if ((state.flags & kEnded) !== 0) return;
  const decoder = (state.flags & kDecoder) !== 0 ? state.decoderValue : null;
  if (decoder) {
    const chunk = decoder.end();
    if (chunk?.length) {
      state.buffer.push(chunk);
      state.length += (state.flags & kObjectMode) !== 0 ? 1 : (chunk.length as number);
    }
  }
  state.flags |= kEnded;

  if ((state.flags & kSync) !== 0) {
    // If we are sync, wait until next tick to emit the data.
    // Otherwise we risk emitting data in the flow()
    // the readable code triggers during a read() call.
    emitReadable(stream);
  } else {
    // Emit 'readable' now to make sure it gets picked up.
    state.flags &= ~kNeedReadable;
    state.flags |= kEmittedReadable;
    // We have to emit readable now that we are EOF. Modules
    // in the ecosystem (e.g. dicer) rely on this event being sync.
    emitReadable_(stream);
  }
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  const state: ReadableState = stream._readableState;
  $debug("emitReadable");
  state.flags &= ~kNeedReadable;
  if ((state.flags & kEmittedReadable) === 0) {
    $debug("emitReadable", (state.flags & kFlowing) !== 0);
    state.flags |= kEmittedReadable;
    process.nextTick(emitReadable_, stream);
  }
}

function emitReadable_(stream) {
  const state: ReadableState = stream._readableState;
  $debug("emitReadable_");
  if ((state.flags & (kDestroyed | kErrored)) === 0 && (state.length || (state.flags & kEnded) !== 0)) {
    stream.emit("readable");
    state.flags &= ~kEmittedReadable;
  }

  // The stream needs another readable event if:
  // 1. It is not flowing, as the flow mechanism will take
  //    care of it.
  // 2. It is not ended.
  // 3. It is below the highWaterMark, so we can schedule
  //    another readable later.
  state.flags |=
    (state.flags & (kFlowing | kEnded)) === 0 && state.length <= state.highWaterMark ? kNeedReadable : 0;
  flow(stream);
}

// At this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state: ReadableState): void {
  if ((state.flags & (kReadingMore | kReading | kConstructed)) === kConstructed) {
    state.flags |= kReadingMore;
    process.nextTick(maybeReadMore_, stream, state);
  }
}

function maybeReadMore_(stream, state: ReadableState): void {
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
    (state.flags & (kReading | kEnded)) === 0 &&
    (state.length < state.highWaterMark || ((state.flags & kFlowing) !== 0 && state.length === 0))
  ) {
    const len = state.length;
    $debug("maybeReadMore read 0");
    stream.read(0);
    if (len === state.length)
      // Didn't get any data, stop spinning.
      break;
  }
  state.flags &= ~kReadingMore;
}

// Abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function (_n) {
  throw $ERR_METHOD_NOT_IMPLEMENTED("_read()");
};

Readable.prototype.pipe = function (dest, pipeOpts) {
  const src = this;
  const state: ReadableState = this._readableState;

  if (state.pipes.length === 1) {
    if ((state.flags & kMultiAwaitDrain) === 0) {
      state.flags |= kMultiAwaitDrain;
      state.awaitDrainWriters = new SafeSet(state.awaitDrainWriters ? [state.awaitDrainWriters] : []);
    }
  }

  state.pipes.push(dest);
  $debug("pipe count=%d opts=%j", state.pipes.length, pipeOpts);

  const doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;

  const endFn = doEnd ? onend : unpipe;
  if ((state.flags & kEndEmitted) !== 0) process.nextTick(endFn);
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
    dest.end();
  }

  let ondrain;

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
        state.flags &= ~kMultiAwaitDrain;
      } else if (state.pipes.length > 1 && state.pipes.includes(dest)) {
        $debug("false write response, pause", state.awaitDrainWriters.size);
        state.awaitDrainWriters.add(dest);
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
        destState !== undefined && dest.write === internals.writeMethod
          ? internals.write!(dest, destState, chunk, undefined, undefined) === true
          : dest.write(chunk);
      $debug("dest.write", ret);
      if (ret === false) {
        pause();
      }
    } catch (err) {
      dest.destroy(err);
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
  } else if ((state.flags & kFlowing) === 0) {
    $debug("pipe resume");
    src.resume();
  }

  const writableState = dest._writableState;
  if (isWritableState(writableState)) destState = writableState;

  return dest;
};

function pipeOnDrain(src, dest) {
  return function pipeOnDrainFunctionResult() {
    const state: ReadableState = src._readableState;

    // `ondrain` will call directly,
    // `this` maybe not a reference to dest,
    // so we use the real dest here.
    if (state.awaitDrainWriters === dest) {
      $debug("pipeOnDrain", 1);
      state.awaitDrainWriters = null;
    } else if ((state.flags & kMultiAwaitDrain) !== 0) {
      $debug("pipeOnDrain", state.awaitDrainWriters.size);
      state.awaitDrainWriters.delete(dest);
    }

    if ((!state.awaitDrainWriters || state.awaitDrainWriters.size === 0) && (state.flags & kDataListening) !== 0) {
      src.resume();
    }
  };
}

Readable.prototype.unpipe = function (dest) {
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
Readable.prototype.on = function (ev, fn) {
  const res = Stream.prototype.on.$call(this, ev, fn);
  const state: ReadableState = this._readableState;

  if (ev === "data") {
    state.flags |= kDataListening;

    // Update readableListening so that resume() may be a no-op
    // a few lines down. This is needed to support once('readable').
    state.flags |= this.listenerCount("readable") > 0 ? kReadableListening : 0;

    // Try start flowing on next tick if stream isn't explicitly paused.
    if ((state.flags & (kHasFlowing | kFlowing)) !== kHasFlowing) {
      this.resume();
    }
  } else if (ev === "readable") {
    if ((state.flags & (kEndEmitted | kReadableListening)) === 0) {
      state.flags |= kReadableListening | kNeedReadable | kHasFlowing;
      state.flags &= ~(kFlowing | kEmittedReadable);
      $debug("on readable");
      if (state.length) {
        emitReadable(this);
      } else if ((state.flags & kReading) === 0) {
        process.nextTick(nReadingNextTick, this);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

Readable.prototype.removeListener = function (ev, fn) {
  const state: ReadableState = this._readableState;

  const res = Stream.prototype.removeListener.$call(this, ev, fn);

  if (ev === "readable") {
    // We need to check if there is someone still listening to
    // readable and reset the state. However this needs to happen
    // after readable has been emitted but before I/O (nextTick) to
    // support once('readable', fn) cycles. This means that calling
    // resume within the same tick will have no
    // effect.
    process.nextTick(updateReadableListening, this);
  } else if (ev === "data" && this.listenerCount("data") === 0) {
    state.flags &= ~kDataListening;
  }

  return res;
};
Readable.prototype.off = Readable.prototype.removeListener;

Readable.prototype.removeAllListeners = function (ev) {
  const res = Stream.prototype.removeAllListeners.$apply(this, arguments);

  if (ev === "readable" || ev === undefined) {
    // We need to check if there is someone still listening to
    // readable and reset the state. However this needs to happen
    // after readable has been emitted but before I/O (nextTick) to
    // support once('readable', fn) cycles. This means that calling
    // resume within the same tick will have no
    // effect.
    process.nextTick(updateReadableListening, this);
  }

  return res;
};

function updateReadableListening(self) {
  const state: ReadableState = self._readableState;

  if (self.listenerCount("readable") > 0) {
    state.flags |= kReadableListening;
  } else {
    state.flags &= ~kReadableListening;
  }

  if ((state.flags & (kHasPaused | kPaused | kResumeScheduled)) === (kHasPaused | kResumeScheduled)) {
    // Flowing needs to be set to true now, otherwise
    // the upcoming resume will not flow.
    state.flags |= kHasFlowing | kFlowing;

    // Crude way to check if we should resume.
  } else if ((state.flags & kDataListening) !== 0) {
    self.resume();
  } else if ((state.flags & kReadableListening) === 0) {
    state.flags &= ~(kHasFlowing | kFlowing);
  }
}

function nReadingNextTick(self) {
  $debug("readable nexttick read 0");
  self.read(0);
}

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function () {
  const state: ReadableState = this._readableState;
  // Node 26 (nodejs/node#62557) early-returns on kDestroyed. We narrow it to
  // kDestroyed && kEndEmitted: fd-slicer-style readables set `destroyed` right
  // before push(null), and the full guard strands their buffered tail when a
  // piped dest drains (yauzl/extract-zip). Once 'end' has fired there is
  // nothing left to flush, so becoming a no-op restores readableFlowing /
  // isPaused() parity for consumers that resume() past EOF (Readable.toWeb).
  if ((state.flags & (kDestroyed | kEndEmitted)) === (kDestroyed | kEndEmitted)) {
    return this;
  }
  if ((state.flags & kFlowing) === 0) {
    $debug("resume");
    // We flow only if there is no one listening
    // for readable, but we still have to call
    // resume().
    state.flags |= kHasFlowing;
    if ((state.flags & kReadableListening) === 0) {
      state.flags |= kFlowing;
    } else {
      state.flags &= ~kFlowing;
    }
    resume(this, state);
  }
  state.flags |= kHasPaused;
  state.flags &= ~kPaused;
  return this;
};

function resume(stream, state: ReadableState): void {
  if ((state.flags & kResumeScheduled) === 0) {
    state.flags |= kResumeScheduled;
    process.nextTick(resume_, stream, state);
  }
}

function resume_(stream, state: ReadableState): void {
  $debug("resume", (state.flags & kReading) !== 0);
  if ((state.flags & kReading) === 0) {
    stream.read(0);
  }

  state.flags &= ~kResumeScheduled;
  stream.emit("resume");
  flow(stream);
  if ((state.flags & (kFlowing | kReading)) === kFlowing) stream.read(0);
}

Readable.prototype.pause = function () {
  const state: ReadableState = this._readableState;
  if ((state.flags & kDestroyed) !== 0) {
    return this;
  }
  $debug("call pause");
  if ((state.flags & (kHasFlowing | kFlowing)) !== kHasFlowing) {
    $debug("pause");
    state.flags |= kHasFlowing;
    state.flags &= ~kFlowing;
    this.emit("pause");
  }
  state.flags |= kHasPaused | kPaused;
  return this;
};

function flow(stream) {
  const state: ReadableState = stream._readableState;
  $debug("flow");
  while ((state.flags & kFlowing) !== 0 && stream.read() !== null);
}

// Wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function (stream) {
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
      this[i] = stream[i].bind(stream);
    }
  }

  return this;
};

Readable.prototype[SymbolAsyncIterator] = function () {
  return streamToAsyncIterator(this);
};

Readable.prototype.iterator = function (options) {
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
  let createBatchedAsyncIterator;
  let normalizeBatch;
  let kValidatedSource;

  Readable.prototype[toAsyncStreamable] = function () {
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
    const normalize = state.objectMode || state.encoding ? normalizeBatch : null;
    const iter = createBatchedAsyncIterator(this, normalize);
    iter[kValidatedSource] = true;
    iter.stream = this;
    return iter;
  };
}

let composeImpl;

Readable.prototype.compose = function compose(stream, options) {
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

interface StreamAsyncIterator extends AsyncGenerator<any, void, unknown> {
  stream?: import("node:stream").Readable;
}

function streamToAsyncIterator(stream, options?) {
  if (typeof stream.read !== "function") {
    stream = Readable.wrap(stream, { objectMode: true });
  }

  const iter: StreamAsyncIterator = createAsyncIterator(stream, options);
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

  let error: Error | null | undefined;
  const cleanup = eos(stream, { writable: false }, err => {
    error = err ? aggregateTwoErrors(error as Error, err) : null;
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
    error = aggregateTwoErrors(error as Error, err as Error);
    throw error;
  } finally {
    if ((error || options?.destroyOnReturn !== false) && (error === undefined || stream._readableState.autoDestroy)) {
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
    get() {
      const r = this._readableState;
      if (isReadableState(r)) {
        return (
          (r.flags & (kHasReadable | kReadable)) !== kHasReadable &&
          (r.flags & (kDestroyed | kErrorEmitted | kEndEmitted)) === 0
        );
      }
      // r.readable === false means that this is part of a Duplex stream
      // where the readable side was disabled upon construction.
      // Compat. The user might manually disable readable side through
      // deprecated setter.
      return !!r && r.readable !== false && !r.destroyed && !r.errorEmitted && !r.endEmitted;
    },
    set(val) {
      // Backwards compat.
      const state = this._readableState;
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
    get: function () {
      const state = this._readableState;
      return isReadableState(state) ? state.dataEmitted : state.dataEmitted;
    },
  },

  readableAborted: {
    __proto__: null,
    enumerable: false,
    get: function () {
      const state = this._readableState;
      if (isReadableState(state)) {
        return (
          (state.flags & (kHasReadable | kReadable)) !== kHasReadable &&
          (state.flags & (kDestroyed | kErrored)) !== 0 &&
          (state.flags & kEndEmitted) === 0
        );
      }
      return !!(state.readable !== false && (state.destroyed || state.errored) && !state.endEmitted);
    },
  },

  readableHighWaterMark: {
    __proto__: null,
    enumerable: false,
    get: function () {
      const state = this._readableState;
      return isReadableState(state) ? state.highWaterMark : state.highWaterMark;
    },
  },

  readableBuffer: {
    __proto__: null,
    enumerable: false,
    get: function () {
      const state = this._readableState;
      return isReadableState(state) ? state.buffer : state?.buffer;
    },
  },

  readableFlowing: {
    __proto__: null,
    enumerable: false,
    get: function () {
      const state = this._readableState;
      return isReadableState(state) ? state.flowing : state.flowing;
    },
    set: function (state) {
      const readableState = this._readableState;
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
    get() {
      const state = this._readableState;
      return isReadableState(state) ? state.length : state.length;
    },
  },

  readableObjectMode: {
    __proto__: null,
    enumerable: false,
    get() {
      const state = this._readableState;
      return isReadableState(state) ? state.objectMode : state ? state.objectMode : false;
    },
  },

  readableEncoding: {
    __proto__: null,
    enumerable: false,
    get() {
      const state = this._readableState;
      return isReadableState(state) ? state.encoding : state ? state.encoding : null;
    },
  },

  errored: {
    __proto__: null,
    enumerable: false,
    get() {
      const state = this._readableState;
      return isReadableState(state) ? state.errored : state ? state.errored : null;
    },
  },

  closed: {
    __proto__: null,
    get() {
      const state = this._readableState;
      return isReadableState(state) ? state.closed : state ? state.closed : false;
    },
  },

  destroyed: {
    __proto__: null,
    enumerable: false,
    get() {
      const state = this._readableState;
      return isReadableState(state) ? state.destroyed : state ? state.destroyed : false;
    },
    set(value) {
      // We ignore the value if the stream
      // has not been initialized yet.
      const state = this._readableState;
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
    get() {
      const state = this._readableState;
      return isReadableState(state) ? state.endEmitted : state ? state.endEmitted : false;
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

  if ((state.flags & kObjectMode) === 0) return bytesFromList(n, state);

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
    if ((state.flags & kDecoder) !== 0) {
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
    ret = buf[idx].slice(0, n);
    buf[idx] = buf[idx].slice(n);
  } else if (n === firstLength) {
    // First chunk is a perfect match.
    ret = buf[idx];
    buf[idx++] = null;
  } else if ((state.flags & kDecoder) !== 0) {
    ret = "";
    while (idx < len) {
      const str = buf[idx];
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

function endReadable(stream) {
  const state: ReadableState = stream._readableState;

  $debug("endReadable");
  if ((state.flags & kEndEmitted) === 0) {
    state.flags |= kEnded;
    process.nextTick(endReadableNT, state, stream);
  }
}

function endReadableNT(state: ReadableState, stream): void {
  $debug("endReadableNT");

  // Check that we didn't get one last unshift.
  if ((state.flags & (kErrored | kCloseEmitted | kEndEmitted)) === 0 && state.length === 0) {
    state.flags |= kEndEmitted;
    stream.emit("end");

    if (stream.writable && stream.allowHalfOpen === false) {
      process.nextTick(endWritableNT, stream);
    } else if ((state.flags & kAutoDestroy) !== 0) {
      // In case of duplex streams we need a way to detect
      // if the writable side is ready for autoDestroy as well.
      const wState = stream._writableState;
      const autoDestroy = isWritableState(wState)
        ? wState.autoDestroy && (wState.finished || wState.writable === false)
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

// Lazy to avoid circular references
let webStreamsAdapters;
function lazyWebStreams() {
  if (webStreamsAdapters === undefined) webStreamsAdapters = require("internal/webstreams_adapters");
  return webStreamsAdapters;
}

Readable.fromWeb = function (readableStream, options) {
  return lazyWebStreams().newStreamReadableFromReadableStream(readableStream, options);
};

Readable.toWeb = function (streamReadable, options) {
  return lazyWebStreams().newReadableStreamFromStreamReadable(streamReadable, options);
};

Readable.wrap = function (src, options?) {
  return new Readable({
    objectMode: src.readableObjectMode ?? src.objectMode ?? true,
    ...options,
    destroy(err, callback) {
      destroyImpl.destroyer(src, err);
      callback(err);
    },
  }).wrap(src);
};

export default Readable as unknown as typeof import("node:stream").Readable & {
  ReadableState: typeof ReadableState;
  wrap: typeof Readable.wrap;
};
