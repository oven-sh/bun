"use strict";

const { validateInteger } = require("internal/validators") as typeof import("internal/validators").default;

const NumberIsInteger = Number.isInteger;
const MathFloor = Math.floor;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ArrayPrototypeSlice = Array.prototype.slice;
type Key = string; // do we need to allow symbols?

const enum StateFlags {
  None = 0,
}

const kObjectMode = 1 << 0;
const kErrorEmitted = 1 << 1;
const kAutoDestroy = 1 << 2;
const kEmitClose = 1 << 3;
const kDestroyed = 1 << 4;
const kClosed = 1 << 5;
const kCloseEmitted = 1 << 6;
const kErrored = 1 << 7;
const kConstructed = 1 << 8;

// TODO (fix): For some reason Windows CI fails with bigger hwm.
let defaultHighWaterMarkBytes = process.platform === "win32" ? 16 * 1024 : 64 * 1024;
let defaultHighWaterMarkObjectMode = 16;

function highWaterMarkFrom(options, isDuplex: boolean, duplexKey: Key): unknown {
  return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
}

function getDefaultHighWaterMark(objectMode: boolean = false): number {
  return objectMode ? defaultHighWaterMarkObjectMode : defaultHighWaterMarkBytes;
}

function setDefaultHighWaterMark(objectMode: boolean, value: number): void {
  validateInteger(value, "value", 0);
  if (objectMode) {
    defaultHighWaterMarkObjectMode = value;
  } else {
    defaultHighWaterMarkBytes = value;
  }
}

function getHighWaterMark(state, options, duplexKey: Key, isDuplex: boolean): number {
  const hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
  if (hwm != null) {
    if (!NumberIsInteger(hwm) || (hwm as number) < 0) {
      const name = isDuplex ? `options.${duplexKey}` : "options.highWaterMark";
      throw $ERR_INVALID_ARG_VALUE(name, hwm);
    }
    return MathFloor(hwm as number);
  }

  // Default value
  return getDefaultHighWaterMark(state.objectMode);
}

function highWaterMarkOf(objectMode: boolean, options, duplexKey: Key, isDuplex: boolean): number {
  const hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
  if (hwm != null) {
    if (!NumberIsInteger(hwm) || (hwm as number) < 0) {
      const name = isDuplex ? `options.${duplexKey}` : "options.highWaterMark";
      throw $ERR_INVALID_ARG_VALUE(name, hwm);
    }
    return MathFloor(hwm as number);
  }

  return objectMode ? defaultHighWaterMarkObjectMode : defaultHighWaterMarkBytes;
}

type WriteCallback = (error?: any) => void;

interface BufferedWrite {
  chunk: any;
  encoding: any;
  callback: WriteCallback;
}

interface AfterWriteTickInfo {
  count: number;
  cb: WriteCallback;
  stream: any;
  state: WritableState;
}

// What readable.ts, writable.ts and transform.ts hand to each other without a require cycle.
class Internals {
  push: ((stream: any, state: ReadableState, chunk: any, encoding: any) => boolean) | undefined = undefined;
  pushMethod: Function | undefined = undefined;
  bindOnwrite: ((stream: any, state: WritableState) => WriteCallback) | undefined = undefined;
  onReadableConstructed: ((stream: any, state: ReadableState) => void) | undefined = undefined;
  onWritableConstructed: ((stream: any, state: WritableState) => void) | undefined = undefined;
  write: ((stream: any, state: WritableState, chunk: any, encoding: any, cb: any) => any) | undefined = undefined;
  writeMethod: Function | undefined = undefined;
}

const internals = new Internals();

let StringDecoder;

const kReadableEnded = 1 << 9;
const kEndEmitted = 1 << 10;
const kReading = 1 << 11;
const kReadableSync = 1 << 12;
const kNeedReadable = 1 << 13;
const kEmittedReadable = 1 << 14;
const kReadableListening = 1 << 15;
const kResumeScheduled = 1 << 16;
const kMultiAwaitDrain = 1 << 17;
const kReadingMore = 1 << 18;
const kDataEmitted = 1 << 19;
const kReadableDefaultUTF8Encoding = 1 << 20;
const kDecoder = 1 << 21;
const kEncoding = 1 << 22;
const kHasFlowing = 1 << 23;
const kFlowing = 1 << 24;
const kHasPaused = 1 << 25;
const kPaused = 1 << 26;
const kHasReadable = 1 << 28;
const kReadable = 1 << 29;

class ReadableState {
  // The point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  highWaterMark: number;
  buffer: any[];
  bufferIndex: number;
  length: number;
  pipes: any[];
  // Ref the piped dest which we need a drain event on it
  // type: null | Writable | Set<Writable>.
  awaitDrainWriters: any;
  erroredValue: any;
  defaultEncodingValue: any;
  decoderValue: any;
  encodingValue: any;
  // Bit map field to store ReadableState more efficiently with 1 bit per field
  // instead of a V8 slot per field.
  flags: StateFlags;

  constructor(options?, stream?, isDuplex?) {
    let state = kEmitClose | kAutoDestroy | kConstructed | kReadableSync;

    // Object stream flag. Used to make read(n) ignore n and to
    // make all the buffer merging and length checks go away.
    if (options?.objectMode) state |= kObjectMode;

    if (isDuplex && options?.readableObjectMode) state |= kObjectMode;

    const highWaterMark = options
      ? highWaterMarkOf((state & kObjectMode) !== 0, options, "readableHighWaterMark", !!isDuplex)
      : defaultHighWaterMarkBytes;

    // Should close be emitted on destroy. Defaults to true.
    if (options && options.emitClose === false) state &= ~kEmitClose;

    // Should .destroy() be called after 'end' (and potentially 'finish').
    if (options && options.autoDestroy === false) state &= ~kAutoDestroy;

    // Crypto is kind of old and crusty.  Historically, its default string
    // encoding is 'binary' so we have to make this configurable.
    // Everything else in the universe uses 'utf8', though.
    const defaultEncoding = options?.defaultEncoding;
    const isDefaultUTF8 = defaultEncoding == null || defaultEncoding === "utf8" || defaultEncoding === "utf-8";
    if (isDefaultUTF8) {
      state |= kReadableDefaultUTF8Encoding;
    } else if (!Buffer.isEncoding(defaultEncoding)) {
      throw $ERR_UNKNOWN_ENCODING(defaultEncoding);
    }

    let decoder = null;
    let encoding = null;
    if (options?.encoding) {
      StringDecoder ??= require("node:string_decoder").StringDecoder;
      decoder = new StringDecoder(options.encoding);
      state |= kDecoder;
      encoding = options.encoding;
      if (encoding) state |= kEncoding;
      else encoding = null;
    }

    this.highWaterMark = highWaterMark;
    this.buffer = [];
    this.bufferIndex = 0;
    this.length = 0;
    this.pipes = [];
    this.awaitDrainWriters = null;
    this.erroredValue = null;
    this.defaultEncodingValue = isDefaultUTF8 ? null : defaultEncoding;
    this.decoderValue = decoder;
    this.encodingValue = encoding;
    this.flags = state;
  }

  get objectMode(): boolean {
    return (this.flags & kObjectMode) !== 0;
  }
  set objectMode(value: unknown) {
    if (value) this.flags |= kObjectMode;
    else this.flags &= ~kObjectMode;
  }

  get ended(): boolean {
    return (this.flags & kReadableEnded) !== 0;
  }
  set ended(value: unknown) {
    if (value) this.flags |= kReadableEnded;
    else this.flags &= ~kReadableEnded;
  }

  get endEmitted(): boolean {
    return (this.flags & kEndEmitted) !== 0;
  }
  set endEmitted(value: unknown) {
    if (value) this.flags |= kEndEmitted;
    else this.flags &= ~kEndEmitted;
  }

  get reading(): boolean {
    return (this.flags & kReading) !== 0;
  }
  set reading(value: unknown) {
    if (value) this.flags |= kReading;
    else this.flags &= ~kReading;
  }

  // Stream is still being constructed and cannot be
  // destroyed until construction finished or failed.
  // Async construction is opt in, therefore we start as
  // constructed.
  get constructed(): boolean {
    return (this.flags & kConstructed) !== 0;
  }
  set constructed(value: unknown) {
    if (value) this.flags |= kConstructed;
    else this.flags &= ~kConstructed;
  }

  // A flag to be able to tell if the event 'readable'/'data' is emitted
  // immediately, or on a later tick.  We set this to true at first, because
  // any actions that shouldn't happen until "later" should generally also
  // not happen before the first read call.
  get sync(): boolean {
    return (this.flags & kReadableSync) !== 0;
  }
  set sync(value: unknown) {
    if (value) this.flags |= kReadableSync;
    else this.flags &= ~kReadableSync;
  }

  // Whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  get needReadable(): boolean {
    return (this.flags & kNeedReadable) !== 0;
  }
  set needReadable(value: unknown) {
    if (value) this.flags |= kNeedReadable;
    else this.flags &= ~kNeedReadable;
  }

  get emittedReadable(): boolean {
    return (this.flags & kEmittedReadable) !== 0;
  }
  set emittedReadable(value: unknown) {
    if (value) this.flags |= kEmittedReadable;
    else this.flags &= ~kEmittedReadable;
  }

  get readableListening(): boolean {
    return (this.flags & kReadableListening) !== 0;
  }
  set readableListening(value: unknown) {
    if (value) this.flags |= kReadableListening;
    else this.flags &= ~kReadableListening;
  }

  get resumeScheduled(): boolean {
    return (this.flags & kResumeScheduled) !== 0;
  }
  set resumeScheduled(value: unknown) {
    if (value) this.flags |= kResumeScheduled;
    else this.flags &= ~kResumeScheduled;
  }

  // True if the error was already emitted and should not be thrown again.
  get errorEmitted(): boolean {
    return (this.flags & kErrorEmitted) !== 0;
  }
  set errorEmitted(value: unknown) {
    if (value) this.flags |= kErrorEmitted;
    else this.flags &= ~kErrorEmitted;
  }

  get emitClose(): boolean {
    return (this.flags & kEmitClose) !== 0;
  }
  set emitClose(value: unknown) {
    if (value) this.flags |= kEmitClose;
    else this.flags &= ~kEmitClose;
  }

  get autoDestroy(): boolean {
    return (this.flags & kAutoDestroy) !== 0;
  }
  set autoDestroy(value: unknown) {
    if (value) this.flags |= kAutoDestroy;
    else this.flags &= ~kAutoDestroy;
  }

  // Has it been destroyed.
  get destroyed(): boolean {
    return (this.flags & kDestroyed) !== 0;
  }
  set destroyed(value: unknown) {
    if (value) this.flags |= kDestroyed;
    else this.flags &= ~kDestroyed;
  }

  // Indicates whether the stream has finished destroying.
  get closed(): boolean {
    return (this.flags & kClosed) !== 0;
  }
  set closed(value: unknown) {
    if (value) this.flags |= kClosed;
    else this.flags &= ~kClosed;
  }

  // True if close has been emitted or would have been emitted
  // depending on emitClose.
  get closeEmitted(): boolean {
    return (this.flags & kCloseEmitted) !== 0;
  }
  set closeEmitted(value: unknown) {
    if (value) this.flags |= kCloseEmitted;
    else this.flags &= ~kCloseEmitted;
  }

  get multiAwaitDrain(): boolean {
    return (this.flags & kMultiAwaitDrain) !== 0;
  }
  set multiAwaitDrain(value: unknown) {
    if (value) this.flags |= kMultiAwaitDrain;
    else this.flags &= ~kMultiAwaitDrain;
  }

  // If true, a maybeReadMore has been scheduled.
  get readingMore(): boolean {
    return (this.flags & kReadingMore) !== 0;
  }
  set readingMore(value: unknown) {
    if (value) this.flags |= kReadingMore;
    else this.flags &= ~kReadingMore;
  }

  get dataEmitted(): boolean {
    return (this.flags & kDataEmitted) !== 0;
  }
  set dataEmitted(value: unknown) {
    if (value) this.flags |= kDataEmitted;
    else this.flags &= ~kDataEmitted;
  }

  // Indicates whether the stream has errored. When true no further
  // _read calls, 'data' or 'readable' events should occur. This is needed
  // since when autoDestroy is disabled we need a way to tell whether the
  // stream has failed.
  get errored(): any {
    return (this.flags & kErrored) !== 0 ? this.erroredValue : null;
  }
  set errored(value: unknown) {
    if (value) {
      this.erroredValue = value;
      this.flags |= kErrored;
    } else {
      this.flags &= ~kErrored;
    }
  }

  get defaultEncoding(): any {
    return (this.flags & kReadableDefaultUTF8Encoding) !== 0 ? "utf8" : this.defaultEncodingValue;
  }
  set defaultEncoding(value: unknown) {
    if (value === "utf8" || value === "utf-8") {
      this.flags |= kReadableDefaultUTF8Encoding;
    } else {
      this.flags &= ~kReadableDefaultUTF8Encoding;
      this.defaultEncodingValue = value;
    }
  }

  get decoder(): any {
    return (this.flags & kDecoder) !== 0 ? this.decoderValue : null;
  }
  set decoder(value: unknown) {
    if (value) {
      this.decoderValue = value;
      this.flags |= kDecoder;
    } else {
      this.flags &= ~kDecoder;
    }
  }

  get encoding(): any {
    return (this.flags & kEncoding) !== 0 ? this.encodingValue : null;
  }
  set encoding(value: unknown) {
    if (value) {
      this.encodingValue = value;
      this.flags |= kEncoding;
    } else {
      this.flags &= ~kEncoding;
    }
  }

  get flowing(): boolean | null {
    return (this.flags & kHasFlowing) !== 0 ? (this.flags & kFlowing) !== 0 : null;
  }
  set flowing(value: unknown) {
    if (value == null) {
      this.flags &= ~(kHasFlowing | kFlowing);
    } else if (value) {
      this.flags |= kHasFlowing | kFlowing;
    } else {
      this.flags |= kHasFlowing;
      this.flags &= ~kFlowing;
    }
  }

  // Legacy getter for `pipesCount`.
  get pipesCount(): number {
    return this.pipes.length;
  }

  // Legacy property for `paused`.
  get paused(): boolean {
    return (this.flags & kPaused) !== 0;
  }
  set paused(value: unknown) {
    this.flags |= kHasPaused;
    if (value) {
      this.flags |= kPaused;
    } else {
      this.flags &= ~kPaused;
    }
  }

  // false: the readable side of a Duplex that was disabled upon construction, or through the deprecated setter.
  get readable(): boolean | undefined {
    return (this.flags & kHasReadable) !== 0 ? (this.flags & kReadable) !== 0 : undefined;
  }
  set readable(value: unknown) {
    if (value == null) {
      this.flags &= ~(kHasReadable | kReadable);
    } else if (value) {
      this.flags |= kHasReadable | kReadable;
    } else {
      this.flags |= kHasReadable;
      this.flags &= ~kReadable;
    }
  }
}

const kWritableSync = 1 << 9;
const kFinalCalled = 1 << 10;
const kNeedDrain = 1 << 11;
const kEnding = 1 << 12;
const kFinished = 1 << 13;
const kDecodeStrings = 1 << 14;
const kWriting = 1 << 15;
const kBufferProcessing = 1 << 16;
const kPrefinished = 1 << 17;
const kAllBuffers = 1 << 18;
const kAllNoop = 1 << 19;
const kHasWritable = 1 << 21;
const kWritable = 1 << 22;
const kWritableDefaultUTF8Encoding = 1 << 24;
const kWriteCb = 1 << 25;
const kAfterWriteTickInfo = 1 << 27;
const kBuffered = 1 << 29;
const kWritableEnded = 1 << 30;

function nop() {}

class WritableState {
  // The point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write().
  highWaterMark: number;
  // Not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  length: number;
  // When true all writes will be buffered until .uncork() call.
  corked: number;
  // The callback that's passed to _write(chunk, cb).
  onwrite: WriteCallback;
  // The amount that is being written when _write is called.
  writelen: number;
  bufferedIndex: number;
  // Number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted.
  // Optional: it can be deleted, to look like a stream of an old implementation (test-stream-finished.js).
  pendingcb?: number;
  bufferedValue: (BufferedWrite | null)[] | null;
  defaultEncodingValue: any;
  erroredValue: any;
  onFinishedValue: WriteCallback[] | null;
  writeCbValue: WriteCallback | null;
  afterWriteTickInfoValue: AfterWriteTickInfo | null;
  // Bit map field to store WritableState more efficiently with 1 bit per field
  // instead of a V8 slot per field.
  flags: StateFlags;

  constructor(options?, stream?, isDuplex?) {
    let state = kWritableSync | kConstructed | kEmitClose | kAutoDestroy | kAllBuffers | kAllNoop;

    if (options?.objectMode) state |= kObjectMode;

    if (isDuplex && options?.writableObjectMode) state |= kObjectMode;

    const highWaterMark = options
      ? highWaterMarkOf((state & kObjectMode) !== 0, options, "writableHighWaterMark", !!isDuplex)
      : defaultHighWaterMarkBytes;

    if (!options || options.decodeStrings !== false) state |= kDecodeStrings;

    // Should close be emitted on destroy. Defaults to true.
    if (options && options.emitClose === false) state &= ~kEmitClose;

    // Should .destroy() be called after 'end' (and potentially 'finish').
    if (options && options.autoDestroy === false) state &= ~kAutoDestroy;

    // Crypto is kind of old and crusty.  Historically, its default string
    // encoding is 'binary' so we have to make this configurable.
    // Everything else in the universe uses 'utf8', though.
    const defaultEncoding = options ? options.defaultEncoding : null;
    const isDefaultUTF8 = defaultEncoding == null || defaultEncoding === "utf8" || defaultEncoding === "utf-8";
    if (isDefaultUTF8) {
      state |= kWritableDefaultUTF8Encoding;
    } else if (!Buffer.isEncoding(defaultEncoding)) {
      throw $ERR_UNKNOWN_ENCODING(defaultEncoding);
    }

    this.highWaterMark = highWaterMark;
    this.length = 0;
    this.corked = 0;
    this.writelen = 0;
    this.bufferedIndex = 0;
    this.pendingcb = 0;
    this.bufferedValue = null;
    this.defaultEncodingValue = isDefaultUTF8 ? null : defaultEncoding;
    this.erroredValue = null;
    this.onFinishedValue = null;
    this.writeCbValue = null;
    this.afterWriteTickInfoValue = null;
    this.flags = state;
    this.onwrite = internals.bindOnwrite!(stream, this);
  }

  // Object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  get objectMode(): boolean {
    return (this.flags & kObjectMode) !== 0;
  }
  set objectMode(value: unknown) {
    if (value) this.flags |= kObjectMode;
    else this.flags &= ~kObjectMode;
  }

  // if _final has been called.
  get finalCalled(): boolean {
    return (this.flags & kFinalCalled) !== 0;
  }
  set finalCalled(value: unknown) {
    if (value) this.flags |= kFinalCalled;
    else this.flags &= ~kFinalCalled;
  }

  // drain event flag.
  get needDrain(): boolean {
    return (this.flags & kNeedDrain) !== 0;
  }
  set needDrain(value: unknown) {
    if (value) this.flags |= kNeedDrain;
    else this.flags &= ~kNeedDrain;
  }

  // At the start of calling end()
  get ending(): boolean {
    return (this.flags & kEnding) !== 0;
  }
  set ending(value: unknown) {
    if (value) this.flags |= kEnding;
    else this.flags &= ~kEnding;
  }

  // When end() has been called, and returned.
  get ended(): boolean {
    return (this.flags & kWritableEnded) !== 0;
  }
  set ended(value: unknown) {
    if (value) this.flags |= kWritableEnded;
    else this.flags &= ~kWritableEnded;
  }

  // When 'finish' is emitted.
  get finished(): boolean {
    return (this.flags & kFinished) !== 0;
  }
  set finished(value: unknown) {
    if (value) this.flags |= kFinished;
    else this.flags &= ~kFinished;
  }

  // Has it been destroyed.
  get destroyed(): boolean {
    return (this.flags & kDestroyed) !== 0;
  }
  set destroyed(value: unknown) {
    if (value) this.flags |= kDestroyed;
    else this.flags &= ~kDestroyed;
  }

  // Should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  get decodeStrings(): boolean {
    return (this.flags & kDecodeStrings) !== 0;
  }
  set decodeStrings(value: unknown) {
    if (value) this.flags |= kDecodeStrings;
    else this.flags &= ~kDecodeStrings;
  }

  // A flag to see when we're in the middle of a write.
  get writing(): boolean {
    return (this.flags & kWriting) !== 0;
  }
  set writing(value: unknown) {
    if (value) this.flags |= kWriting;
    else this.flags &= ~kWriting;
  }

  // A flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  get sync(): boolean {
    return (this.flags & kWritableSync) !== 0;
  }
  set sync(value: unknown) {
    if (value) this.flags |= kWritableSync;
    else this.flags &= ~kWritableSync;
  }

  // A flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  get bufferProcessing(): boolean {
    return (this.flags & kBufferProcessing) !== 0;
  }
  set bufferProcessing(value: unknown) {
    if (value) this.flags |= kBufferProcessing;
    else this.flags &= ~kBufferProcessing;
  }

  // Stream is still being constructed and cannot be
  // destroyed until construction finished or failed.
  // Async construction is opt in, therefore we start as
  // constructed.
  get constructed(): boolean {
    return (this.flags & kConstructed) !== 0;
  }
  set constructed(value: unknown) {
    if (value) this.flags |= kConstructed;
    else this.flags &= ~kConstructed;
  }

  // Emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams.
  get prefinished(): boolean {
    return (this.flags & kPrefinished) !== 0;
  }
  set prefinished(value: unknown) {
    if (value) this.flags |= kPrefinished;
    else this.flags &= ~kPrefinished;
  }

  // True if the error was already emitted and should not be thrown again.
  get errorEmitted(): boolean {
    return (this.flags & kErrorEmitted) !== 0;
  }
  set errorEmitted(value: unknown) {
    if (value) this.flags |= kErrorEmitted;
    else this.flags &= ~kErrorEmitted;
  }

  // Should close be emitted on destroy. Defaults to true.
  get emitClose(): boolean {
    return (this.flags & kEmitClose) !== 0;
  }
  set emitClose(value: unknown) {
    if (value) this.flags |= kEmitClose;
    else this.flags &= ~kEmitClose;
  }

  // Should .destroy() be called after 'finish' (and potentially 'end').
  get autoDestroy(): boolean {
    return (this.flags & kAutoDestroy) !== 0;
  }
  set autoDestroy(value: unknown) {
    if (value) this.flags |= kAutoDestroy;
    else this.flags &= ~kAutoDestroy;
  }

  // Indicates whether the stream has finished destroying.
  get closed(): boolean {
    return (this.flags & kClosed) !== 0;
  }
  set closed(value: unknown) {
    if (value) this.flags |= kClosed;
    else this.flags &= ~kClosed;
  }

  // True if close has been emitted or would have been emitted
  // depending on emitClose.
  get closeEmitted(): boolean {
    return (this.flags & kCloseEmitted) !== 0;
  }
  set closeEmitted(value: unknown) {
    if (value) this.flags |= kCloseEmitted;
    else this.flags &= ~kCloseEmitted;
  }

  get allBuffers(): boolean {
    return (this.flags & kAllBuffers) !== 0;
  }
  set allBuffers(value: unknown) {
    if (value) this.flags |= kAllBuffers;
    else this.flags &= ~kAllBuffers;
  }

  get allNoop(): boolean {
    return (this.flags & kAllNoop) !== 0;
  }
  set allNoop(value: unknown) {
    if (value) this.flags |= kAllNoop;
    else this.flags &= ~kAllNoop;
  }

  // Indicates whether the stream has errored. When true all write() calls
  // should return false. This is needed since when autoDestroy
  // is disabled we need a way to tell whether the stream has failed.
  // This is/should be a cold path.
  get errored(): any {
    return (this.flags & kErrored) !== 0 ? this.erroredValue : null;
  }
  set errored(value: unknown) {
    if (value) {
      this.erroredValue = value;
      this.flags |= kErrored;
    } else {
      this.flags &= ~kErrored;
    }
  }

  get writable(): boolean | undefined {
    return (this.flags & kHasWritable) !== 0 ? (this.flags & kWritable) !== 0 : undefined;
  }
  set writable(value: unknown) {
    if (value == null) {
      this.flags &= ~(kHasWritable | kWritable);
    } else if (value) {
      this.flags |= kHasWritable | kWritable;
    } else {
      this.flags |= kHasWritable;
      this.flags &= ~kWritable;
    }
  }

  get defaultEncoding(): any {
    return (this.flags & kWritableDefaultUTF8Encoding) !== 0 ? "utf8" : this.defaultEncodingValue;
  }
  set defaultEncoding(value: unknown) {
    if (value === "utf8" || value === "utf-8") {
      this.flags |= kWritableDefaultUTF8Encoding;
    } else {
      this.flags &= ~kWritableDefaultUTF8Encoding;
      this.defaultEncodingValue = value;
    }
  }

  // The callback that the user supplies to write(chunk, encoding, cb).
  get writecb(): any {
    return (this.flags & kWriteCb) !== 0 ? this.writeCbValue : nop;
  }
  set writecb(value: any) {
    this.writeCbValue = value;
    if (value) {
      this.flags |= kWriteCb;
    } else {
      this.flags &= ~kWriteCb;
    }
  }

  // Storage for data passed to the afterWrite() callback in case of
  // synchronous _write() completion.
  get afterWriteTickInfo(): any {
    return (this.flags & kAfterWriteTickInfo) !== 0 ? this.afterWriteTickInfoValue : null;
  }
  set afterWriteTickInfo(value: any) {
    this.afterWriteTickInfoValue = value;
    if (value) {
      this.flags |= kAfterWriteTickInfo;
    } else {
      this.flags &= ~kAfterWriteTickInfo;
    }
  }

  get buffered(): any {
    return (this.flags & kBuffered) !== 0 ? this.bufferedValue : [];
  }
  set buffered(value: any) {
    this.bufferedValue = value;
    if (value) {
      this.flags |= kBuffered;
    } else {
      this.flags &= ~kBuffered;
    }
  }

  getBuffer() {
    return (this.flags & kBuffered) === 0 ? [] : ArrayPrototypeSlice.$call(this.bufferedValue, this.bufferedIndex);
  }

  get bufferedRequestCount(): number {
    return (this.flags & kBuffered) === 0 ? 0 : this.bufferedValue!.length - this.bufferedIndex;
  }
}

function isReadableState(value: unknown): value is ReadableState {
  return value instanceof ReadableState;
}

function isWritableState(value: unknown): value is WritableState {
  return value instanceof WritableState;
}

// A state object that another implementation of streams has made (readable-stream, a mock) keeps what is noted about it under a symbol.
const kState = Symbol("kState");

function flagsOf(state) {
  return state instanceof ReadableState || state instanceof WritableState ? state.flags : state[kState];
}

function addFlags(state, flags: number): void {
  if (state instanceof ReadableState || state instanceof WritableState) state.flags |= flags;
  else state[kState] |= flags;
}

function removeFlags(state, flags: number): void {
  if (state instanceof ReadableState || state instanceof WritableState) state.flags &= ~flags;
  else state[kState] &= ~flags;
}

function createReadableState(options, stream, isDuplex: boolean): ReadableState {
  return new ReadableState(options, stream, isDuplex);
}

function createWritableState(options, stream, isDuplex: boolean): WritableState {
  return new WritableState(options, stream, isDuplex);
}

// Accessors that cannot be redefined and methods that are enumerable, as when they were defined one by one.
function restoreAttributes(prototype: object) {
  const names = ObjectGetOwnPropertyNames(prototype);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name !== "constructor" && name !== "getBuffer") ObjectDefineProperty(prototype, name, { configurable: false });
  }
}
restoreAttributes(ReadableState.prototype);
restoreAttributes(WritableState.prototype);
Object.defineProperty(WritableState.prototype, "getBuffer", { enumerable: true });

export type { ReadableState, WritableState, BufferedWrite, AfterWriteTickInfo, WriteCallback };

export default {
  getHighWaterMark,
  getDefaultHighWaterMark,
  setDefaultHighWaterMark,
  ReadableState,
  WritableState,
  createReadableState,
  createWritableState,
  isReadableState,
  isWritableState,
  flagsOf,
  addFlags,
  removeFlags,
  internals,
  nop,
};
