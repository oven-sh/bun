"use strict";

const { validateInteger } = require("internal/validators");
const { StringDecoder } = require("node:string_decoder");

const NumberIsInteger = Number.isInteger;
const MathFloor = Math.floor;
const ObjectDefineProperties = Object.defineProperties;
const ObjectDefineProperty = Object.defineProperty;
const ArrayPrototypeSlice = Array.prototype.slice;
type Key = string; // do we need to allow symbols?
type int32 = import("bun").int32;

const kState = Symbol("kState");
const kOnConstructed = Symbol("kOnConstructed");
const kErroredValue = Symbol("kErroredValue");
const kDefaultEncodingValue = Symbol("kDefaultEncodingValue");
const kDecoderValue = Symbol("kDecoderValue");
const kEncodingValue = Symbol("kEncodingValue");
const kOnFinishedValue = Symbol("kOnFinishedValue");
const kWriteCbValue = Symbol("kWriteCbValue");
const kAfterWriteTickInfoValue = Symbol("kAfterWriteTickInfoValue");
const kBufferedValue = Symbol("kBufferedValue");

// The flags are const enums, here and in the modules that test them: each use is a number in the bundled module.

// The bits of [kState] that mean the same in a ReadableState and in a WritableState.
const enum Flag {
  ObjectMode = 1 << 0,
  ErrorEmitted = 1 << 1,
  AutoDestroy = 1 << 2,
  EmitClose = 1 << 3,
  Destroyed = 1 << 4,
  Closed = 1 << 5,
  CloseEmitted = 1 << 6,
  Errored = 1 << 7,
  Constructed = 1 << 8,
}

// TODO (fix): For some reason Windows CI fails with bigger hwm.
let defaultHighWaterMarkBytes = process.platform === "win32" ? 16 * 1024 : 64 * 1024;
let defaultHighWaterMarkObjectMode = 16;

function highWaterMarkFrom(options, isDuplex: boolean, duplexKey: Key): unknown {
  return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
}

function getDefaultHighWaterMark(objectMode: unknown = false): number {
  return objectMode ? defaultHighWaterMarkObjectMode : defaultHighWaterMarkBytes;
}

function setDefaultHighWaterMark(objectMode: unknown, value: unknown): void {
  validateInteger(value, "value", 0);
  if (objectMode) {
    defaultHighWaterMarkObjectMode = value as number;
  } else {
    defaultHighWaterMarkBytes = value as number;
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

type WriteCallback = $Node.ErrorCallback;

interface BufferedWrite {
  chunk: any;
  encoding: any;
  callback: WriteCallback;
}

interface AfterWriteTickInfo {
  count: number;
  cb: WriteCallback;
  stream: $Node.Writable;
  state: WritableState;
}

// What readable.ts, writable.ts and transform.ts hand to each other without a require cycle.
interface Internals {
  pushToReadable:
    | ((stream: $Node.Readable, state: ReadableState, chunk: unknown, encoding: string | undefined) => boolean)
    | undefined;
  pushingMethod: $Node.Readable["push"] | undefined;
  readableMethods:
    | {
        read: $Node.Readable["read"];
        push: $Node.Readable["push"];
        resume: $Node.Readable["resume"];
        removeAllListeners: $Node.Readable["removeAllListeners"];
      }
    | undefined;
  destroyMethods:
    | {
        destroy: (
          this: $Node.StreamWithState,
          error?: Error | null,
          callback?: $Node.ErrorCallback,
        ) => $Node.StreamWithState;
      }
    | undefined;
  onwrite: ((stream: $Node.Writable, er?: Error | null) => void) | undefined;
  /** `true`, `false`, or the error of a write after the end. */
  writeToWritable:
    | ((
        stream: $Node.Writable,
        state: WritableState,
        chunk: unknown,
        encoding: string | null | undefined,
        cb: WriteCallback | null | undefined,
      ) => boolean | Error)
    | undefined;
  writingMethod: $Node.Writable["write"] | undefined;
  constructReadable: ((stream: $Node.Readable, highWaterMark: unknown) => void) | undefined;
  resumeOnNextTick: ((stream: $Node.Readable, state: ReadableState) => void) | undefined;
  endOnNextTick: ((state: ReadableState, stream: $Node.Readable) => void) | undefined;
  preallocatedEvents: (() => $Node.Events) | undefined;
  writableAccessors: Record<WritableAccessorName, PropertyDescriptor> | undefined;
  resumeRequestBody: ((stream: $Node.Readable, state: ReadableState) => boolean) | undefined;
  finishReadOfNothing: ((state: ReadableState) => void) | undefined;
  finishResume: ((stream: $Node.Readable, state: ReadableState) => void) | undefined;
  readMoreLater: ((stream: $Node.Readable, state: ReadableState) => void) | undefined;
  readMoreOnNextTick: ((stream: $Node.Readable, state: ReadableState) => void) | undefined;
  emitReadableNow: ((stream: $Node.Readable) => void) | undefined;
  finishEnd: ((state: ReadableState, stream: $Node.Readable) => void) | undefined;
  onRequestBodyData:
    ((this: $Node.IncomingMessage, chunk: Buffer | undefined, isLast: boolean, aborted: number) => void) | undefined;
  takeRequestCloseTick: ((request: $Node.IncomingMessage) => boolean) | undefined;
  destroyEndedRequest: ((state: ReadableState, stream: $Node.Readable) => boolean) | undefined;
}

type WritableAccessorName =
  | "writable"
  | "writableHighWaterMark"
  | "writableObjectMode"
  | "writableBuffer"
  | "writableLength"
  | "writableFinished"
  | "writableCorked"
  | "writableEnded"
  | "writableNeedDrain";

const internals: Internals = {
  pushToReadable: undefined,
  pushingMethod: undefined,
  readableMethods: undefined,
  destroyMethods: undefined,
  onwrite: undefined,
  writeToWritable: undefined,
  writingMethod: undefined,
  constructReadable: undefined,
  resumeOnNextTick: undefined,
  endOnNextTick: undefined,
  preallocatedEvents: undefined,
  writableAccessors: undefined,
  resumeRequestBody: undefined,
  finishReadOfNothing: undefined,
  finishResume: undefined,
  readMoreLater: undefined,
  readMoreOnNextTick: undefined,
  emitReadableNow: undefined,
  finishEnd: undefined,
  onRequestBodyData: undefined,
  takeRequestCloseTick: undefined,
  destroyEndedRequest: undefined,
};

// TODO(benjamingr) it is likely slower to do it this way than with free functions
function makeBitMapDescriptor(bit: number) {
  return {
    enumerable: false,
    get(this: ReadableState | WritableState) {
      return (this[kState] & bit) !== 0;
    },
    set(this: ReadableState | WritableState, value) {
      if (value) this[kState] |= bit;
      else this[kState] &= ~bit;
    },
  };
}

// The other bits of a ReadableState.
const enum ReadableFlag {
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
}

interface ReadableState {
  [kState]: int32;
  highWaterMark: number;
  buffer: any[];
  bufferIndex: number;
  length: number;
  pipes: $Node.AnyStream[];
  awaitDrainWriters: $Node.AnyStream | Set<$Node.AnyStream> | null;
  /** `false`: the readable side of a Duplex that was disabled upon construction, or through the deprecated setter. */
  readable?: boolean;
  [kErroredValue]?: any;
  [kDefaultEncodingValue]?: any;
  [kDecoderValue]?: import("node:string_decoder").StringDecoder;
  [kEncodingValue]?: any;
  [kOnConstructed](stream: $Node.Readable): void;
  get objectMode(): boolean;
  set objectMode(value: unknown);
  get ended(): boolean;
  set ended(value: unknown);
  get endEmitted(): boolean;
  set endEmitted(value: unknown);
  get reading(): boolean;
  set reading(value: unknown);
  get constructed(): boolean;
  set constructed(value: unknown);
  get sync(): boolean;
  set sync(value: unknown);
  get needReadable(): boolean;
  set needReadable(value: unknown);
  get emittedReadable(): boolean;
  set emittedReadable(value: unknown);
  get readableListening(): boolean;
  set readableListening(value: unknown);
  get resumeScheduled(): boolean;
  set resumeScheduled(value: unknown);
  get errorEmitted(): boolean;
  set errorEmitted(value: unknown);
  get emitClose(): boolean;
  set emitClose(value: unknown);
  get autoDestroy(): boolean;
  set autoDestroy(value: unknown);
  get destroyed(): boolean;
  set destroyed(value: unknown);
  get closed(): boolean;
  set closed(value: unknown);
  get closeEmitted(): boolean;
  set closeEmitted(value: unknown);
  get multiAwaitDrain(): boolean;
  set multiAwaitDrain(value: unknown);
  get readingMore(): boolean;
  set readingMore(value: unknown);
  get dataEmitted(): boolean;
  set dataEmitted(value: unknown);
  get errored(): any;
  set errored(value: unknown);
  get defaultEncoding(): any;
  set defaultEncoding(value: unknown);
  get decoder(): import("node:string_decoder").StringDecoder | null;
  set decoder(value: import("node:string_decoder").StringDecoder | null);
  get encoding(): any;
  set encoding(value: unknown);
  get flowing(): boolean | null;
  set flowing(value: unknown);
  get pipesCount(): number;
  get paused(): boolean;
  set paused(value: unknown);
}

const kUnreadBytes = Symbol("kUnreadBytes");

function ReadableState(this: ReadableState, options?, stream?, isDuplex?) {
  if (options === kUnreadBytes) {
    this[kState] =
      Flag.EmitClose |
      Flag.AutoDestroy |
      Flag.Constructed |
      ReadableFlag.Sync |
      ReadableFlag.DefaultUTF8Encoding |
      ReadableFlag.ReadingMore;
    this.highWaterMark = stream;
    this.buffer = [];
    this.bufferIndex = 0;
    this.length = 0;
    this.pipes = [];
    this.awaitDrainWriters = null;
    return;
  }
  // Bit map field to store ReadableState more efficiently with 1 bit per field instead of a V8 slot per field.
  this[kState] = Flag.EmitClose | Flag.AutoDestroy | Flag.Constructed | ReadableFlag.Sync;

  // Object stream flag.
  if (options?.objectMode) this[kState] |= Flag.ObjectMode;

  if (isDuplex && options?.readableObjectMode) this[kState] |= Flag.ObjectMode;

  // The point at which it stops calling _read() to fill the buffer; 0 means never ahead of a read.
  this.highWaterMark = options
    ? getHighWaterMark(this, options, "readableHighWaterMark", isDuplex)
    : getDefaultHighWaterMark(false);

  this.buffer = [];
  this.bufferIndex = 0;
  this.length = 0;
  this.pipes = [];

  // Should close be emitted on destroy. Defaults to true.
  if (options && options.emitClose === false) this[kState] &= ~Flag.EmitClose;

  // Should .destroy() be called after 'end' (and potentially 'finish').
  if (options && options.autoDestroy === false) this[kState] &= ~Flag.AutoDestroy;

  // Crypto is kind of old and crusty.  Historically, its default string encoding is 'binary' so we have to make this configurable.
  const defaultEncoding = options?.defaultEncoding;
  if (defaultEncoding == null || defaultEncoding === "utf8" || defaultEncoding === "utf-8") {
    this[kState] |= ReadableFlag.DefaultUTF8Encoding;
  } else if (Buffer.isEncoding(defaultEncoding)) {
    this.defaultEncoding = defaultEncoding;
  } else {
    throw $ERR_UNKNOWN_ENCODING(defaultEncoding);
  }

  // The piped destinations whose drain event is awaited: null | Writable | Set<Writable>.
  this.awaitDrainWriters = null;

  if (options?.encoding) {
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}
ReadableState.prototype = {};
ObjectDefineProperties(ReadableState.prototype, {
  constructor: { __proto__: null, value: ReadableState, writable: true, configurable: true },
  objectMode: makeBitMapDescriptor(Flag.ObjectMode),
  ended: makeBitMapDescriptor(ReadableFlag.Ended),
  endEmitted: makeBitMapDescriptor(ReadableFlag.EndEmitted),
  reading: makeBitMapDescriptor(ReadableFlag.Reading),
  // Stream is still being constructed and cannot be destroyed until construction finished or failed.
  constructed: makeBitMapDescriptor(Flag.Constructed),
  // A flag to be able to tell if the event 'readable'/'data' is emitted immediately, or on a later tick.  We set this to true at first, because any actions that shouldn't happen until "later" should generally also not happen before the first read call.
  sync: makeBitMapDescriptor(ReadableFlag.Sync),
  // Whenever we return null, then we set a flag to say that we're awaiting a 'readable' event emission.
  needReadable: makeBitMapDescriptor(ReadableFlag.NeedReadable),
  emittedReadable: makeBitMapDescriptor(ReadableFlag.EmittedReadable),
  readableListening: makeBitMapDescriptor(ReadableFlag.ReadableListening),
  resumeScheduled: makeBitMapDescriptor(ReadableFlag.ResumeScheduled),
  // True if the error was already emitted and should not be thrown again.
  errorEmitted: makeBitMapDescriptor(Flag.ErrorEmitted),
  emitClose: makeBitMapDescriptor(Flag.EmitClose),
  autoDestroy: makeBitMapDescriptor(Flag.AutoDestroy),
  // Has it been destroyed.
  destroyed: makeBitMapDescriptor(Flag.Destroyed),
  // Indicates whether the stream has finished destroying.
  closed: makeBitMapDescriptor(Flag.Closed),
  // True if close has been emitted or would have been emitted depending on emitClose.
  closeEmitted: makeBitMapDescriptor(Flag.CloseEmitted),
  multiAwaitDrain: makeBitMapDescriptor(ReadableFlag.MultiAwaitDrain),
  // If true, a maybeReadMore has been scheduled.
  readingMore: makeBitMapDescriptor(ReadableFlag.ReadingMore),
  dataEmitted: makeBitMapDescriptor(ReadableFlag.DataEmitted),

  // Indicates whether the stream has errored.
  errored: {
    __proto__: null,
    enumerable: false,
    get(this: ReadableState) {
      return (this[kState] & Flag.Errored) !== 0 ? this[kErroredValue] : null;
    },
    set(this: ReadableState, value) {
      if (value) {
        this[kErroredValue] = value;
        this[kState] |= Flag.Errored;
      } else {
        this[kState] &= ~Flag.Errored;
      }
    },
  },

  defaultEncoding: {
    __proto__: null,
    enumerable: false,
    get(this: ReadableState) {
      return (this[kState] & ReadableFlag.DefaultUTF8Encoding) !== 0 ? "utf8" : this[kDefaultEncodingValue];
    },
    set(this: ReadableState, value) {
      if (value === "utf8" || value === "utf-8") {
        this[kState] |= ReadableFlag.DefaultUTF8Encoding;
      } else {
        this[kState] &= ~ReadableFlag.DefaultUTF8Encoding;
        this[kDefaultEncodingValue] = value;
      }
    },
  },

  decoder: {
    __proto__: null,
    enumerable: false,
    get(this: ReadableState) {
      return (this[kState] & ReadableFlag.Decoder) !== 0 ? this[kDecoderValue] : null;
    },
    set(this: ReadableState, value) {
      if (value) {
        this[kDecoderValue] = value;
        this[kState] |= ReadableFlag.Decoder;
      } else {
        this[kState] &= ~ReadableFlag.Decoder;
      }
    },
  },

  encoding: {
    __proto__: null,
    enumerable: false,
    get(this: ReadableState) {
      return (this[kState] & ReadableFlag.Encoding) !== 0 ? this[kEncodingValue] : null;
    },
    set(this: ReadableState, value) {
      if (value) {
        this[kEncodingValue] = value;
        this[kState] |= ReadableFlag.Encoding;
      } else {
        this[kState] &= ~ReadableFlag.Encoding;
      }
    },
  },

  flowing: {
    __proto__: null,
    enumerable: false,
    get(this: ReadableState) {
      return (this[kState] & ReadableFlag.HasFlowing) !== 0 ? (this[kState] & ReadableFlag.Flowing) !== 0 : null;
    },
    set(this: ReadableState, value) {
      if (value == null) {
        this[kState] &= ~(ReadableFlag.HasFlowing | ReadableFlag.Flowing);
      } else if (value) {
        this[kState] |= ReadableFlag.HasFlowing | ReadableFlag.Flowing;
      } else {
        this[kState] |= ReadableFlag.HasFlowing;
        this[kState] &= ~ReadableFlag.Flowing;
      }
    },
  },
});

ObjectDefineProperties(ReadableState.prototype, {
  // Legacy getter for `pipesCount`.
  pipesCount: {
    __proto__: null,
    get(this: ReadableState) {
      return this.pipes.length;
    },
  },

  // Legacy property for `paused`.
  paused: {
    __proto__: null,
    get(this: ReadableState) {
      return (this[kState] & ReadableFlag.Paused) !== 0;
    },
    set(this: ReadableState, value) {
      this[kState] |= ReadableFlag.HasPaused;
      if (value) {
        this[kState] |= ReadableFlag.Paused;
      } else {
        this[kState] &= ~ReadableFlag.Paused;
      }
    },
  },
});

// The other bits of a WritableState.
const enum WritableFlag {
  Sync = 1 << 9,
  FinalCalled = 1 << 10,
  NeedDrain = 1 << 11,
  Ending = 1 << 12,
  Finished = 1 << 13,
  DecodeStrings = 1 << 14,
  Writing = 1 << 15,
  BufferProcessing = 1 << 16,
  Prefinished = 1 << 17,
  AllBuffers = 1 << 18,
  AllNoop = 1 << 19,
  HasWritable = 1 << 21,
  Writable = 1 << 22,
  DefaultUTF8Encoding = 1 << 24,
  WriteCb = 1 << 25,
  AfterWriteTickInfo = 1 << 27,
  Buffered = 1 << 29,
  Ended = 1 << 30,
}

function nop() {}

interface WritableState {
  [kState]: int32;
  highWaterMark: number;
  length: number;
  corked: number;
  onwrite: WriteCallback;
  writelen: number;
  bufferedIndex: number;
  /** It can be deleted, to look like a stream of an old implementation (test-stream-finished.js). */
  pendingcb?: number;
  [kDefaultEncodingValue]?: any;
  [kBufferedValue]: (BufferedWrite | null)[] | null;
  [kErroredValue]?: any;
  [kOnFinishedValue]?: WriteCallback[] | null;
  [kWriteCbValue]?: WriteCallback | null;
  [kAfterWriteTickInfoValue]?: AfterWriteTickInfo | null;
  [kOnConstructed](stream: $Node.Writable): void;
  getBuffer(): (BufferedWrite | null)[];
  get objectMode(): boolean;
  set objectMode(value: unknown);
  get finalCalled(): boolean;
  set finalCalled(value: unknown);
  get needDrain(): boolean;
  set needDrain(value: unknown);
  get ending(): boolean;
  set ending(value: unknown);
  get ended(): boolean;
  set ended(value: unknown);
  get finished(): boolean;
  set finished(value: unknown);
  get destroyed(): boolean;
  set destroyed(value: unknown);
  get decodeStrings(): boolean;
  set decodeStrings(value: unknown);
  get writing(): boolean;
  set writing(value: unknown);
  get sync(): boolean;
  set sync(value: unknown);
  get bufferProcessing(): boolean;
  set bufferProcessing(value: unknown);
  get constructed(): boolean;
  set constructed(value: unknown);
  get prefinished(): boolean;
  set prefinished(value: unknown);
  get errorEmitted(): boolean;
  set errorEmitted(value: unknown);
  get emitClose(): boolean;
  set emitClose(value: unknown);
  get autoDestroy(): boolean;
  set autoDestroy(value: unknown);
  get closed(): boolean;
  set closed(value: unknown);
  get closeEmitted(): boolean;
  set closeEmitted(value: unknown);
  get allBuffers(): boolean;
  set allBuffers(value: unknown);
  get allNoop(): boolean;
  set allNoop(value: unknown);
  get errored(): any;
  set errored(value: unknown);
  get writable(): boolean | undefined;
  set writable(value: unknown);
  get defaultEncoding(): any;
  set defaultEncoding(value: unknown);
  get writecb(): any;
  set writecb(value: any);
  get afterWriteTickInfo(): any;
  set afterWriteTickInfo(value: any);
  get buffered(): any;
  set buffered(value: any);
  get bufferedRequestCount(): number;
}

WritableState.prototype = {} as { getBuffer?(this: WritableState): (BufferedWrite | null)[] };
ObjectDefineProperties(WritableState.prototype, {
  constructor: { __proto__: null, value: WritableState, writable: true, configurable: true },
  // Object stream flag to indicate whether or not this stream contains buffers or objects.
  objectMode: makeBitMapDescriptor(Flag.ObjectMode),

  // if _final has been called.
  finalCalled: makeBitMapDescriptor(WritableFlag.FinalCalled),

  // drain event flag.
  needDrain: makeBitMapDescriptor(WritableFlag.NeedDrain),

  // At the start of calling end()
  ending: makeBitMapDescriptor(WritableFlag.Ending),

  // When end() has been called, and returned.
  ended: makeBitMapDescriptor(WritableFlag.Ended),

  // When 'finish' is emitted.
  finished: makeBitMapDescriptor(WritableFlag.Finished),

  // Has it been destroyed.
  destroyed: makeBitMapDescriptor(Flag.Destroyed),

  // Should we decode strings into buffers before passing to _write? this is here so that some node-core streams can optimize string handling at a lower level.
  decodeStrings: makeBitMapDescriptor(WritableFlag.DecodeStrings),

  // A flag to see when we're in the middle of a write.
  writing: makeBitMapDescriptor(WritableFlag.Writing),

  // A flag to be able to tell if the onwrite cb is called immediately, or on a later tick.  We set this to true at first, because any actions that shouldn't happen until "later" should generally also not happen before the first write call.
  sync: makeBitMapDescriptor(WritableFlag.Sync),

  // A flag to know if we're processing previously buffered items, which may call the _write() callback in the same tick, so that we don't end up in an overlapped onwrite situation.
  bufferProcessing: makeBitMapDescriptor(WritableFlag.BufferProcessing),

  // Stream is still being constructed and cannot be destroyed until construction finished or failed.
  constructed: makeBitMapDescriptor(Flag.Constructed),

  // Emit prefinish if the only thing we're waiting for is _write cbs.
  prefinished: makeBitMapDescriptor(WritableFlag.Prefinished),

  // True if the error was already emitted and should not be thrown again.
  errorEmitted: makeBitMapDescriptor(Flag.ErrorEmitted),

  // Should close be emitted on destroy. Defaults to true.
  emitClose: makeBitMapDescriptor(Flag.EmitClose),

  // Should .destroy() be called after 'finish' (and potentially 'end').
  autoDestroy: makeBitMapDescriptor(Flag.AutoDestroy),

  // Indicates whether the stream has finished destroying.
  closed: makeBitMapDescriptor(Flag.Closed),

  // True if close has been emitted or would have been emitted depending on emitClose.
  closeEmitted: makeBitMapDescriptor(Flag.CloseEmitted),

  allBuffers: makeBitMapDescriptor(WritableFlag.AllBuffers),
  allNoop: makeBitMapDescriptor(WritableFlag.AllNoop),

  // Indicates whether the stream has errored.
  errored: {
    __proto__: null,
    enumerable: false,
    get(this: WritableState) {
      return (this[kState] & Flag.Errored) !== 0 ? this[kErroredValue] : null;
    },
    set(this: WritableState, value) {
      if (value) {
        this[kErroredValue] = value;
        this[kState] |= Flag.Errored;
      } else {
        this[kState] &= ~Flag.Errored;
      }
    },
  },

  writable: {
    __proto__: null,
    enumerable: false,
    get(this: WritableState) {
      return (this[kState] & WritableFlag.HasWritable) !== 0 ? (this[kState] & WritableFlag.Writable) !== 0 : undefined;
    },
    set(this: WritableState, value) {
      if (value == null) {
        this[kState] &= ~(WritableFlag.HasWritable | WritableFlag.Writable);
      } else if (value) {
        this[kState] |= WritableFlag.HasWritable | WritableFlag.Writable;
      } else {
        this[kState] |= WritableFlag.HasWritable;
        this[kState] &= ~WritableFlag.Writable;
      }
    },
  },

  defaultEncoding: {
    __proto__: null,
    enumerable: false,
    get(this: WritableState) {
      return (this[kState] & WritableFlag.DefaultUTF8Encoding) !== 0 ? "utf8" : this[kDefaultEncodingValue];
    },
    set(this: WritableState, value) {
      if (value === "utf8" || value === "utf-8") {
        this[kState] |= WritableFlag.DefaultUTF8Encoding;
      } else {
        this[kState] &= ~WritableFlag.DefaultUTF8Encoding;
        this[kDefaultEncodingValue] = value;
      }
    },
  },

  // The callback that the user supplies to write(chunk, encoding, cb).
  writecb: {
    __proto__: null,
    enumerable: false,
    get(this: WritableState) {
      return (this[kState] & WritableFlag.WriteCb) !== 0 ? this[kWriteCbValue] : nop;
    },
    set(this: WritableState, value) {
      this[kWriteCbValue] = value;
      if (value) {
        this[kState] |= WritableFlag.WriteCb;
      } else {
        this[kState] &= ~WritableFlag.WriteCb;
      }
    },
  },

  // Storage for data passed to the afterWrite() callback in case of synchronous _write() completion.
  afterWriteTickInfo: {
    __proto__: null,
    enumerable: false,
    get(this: WritableState) {
      return (this[kState] & WritableFlag.AfterWriteTickInfo) !== 0 ? this[kAfterWriteTickInfoValue] : null;
    },
    set(this: WritableState, value) {
      this[kAfterWriteTickInfoValue] = value;
      if (value) {
        this[kState] |= WritableFlag.AfterWriteTickInfo;
      } else {
        this[kState] &= ~WritableFlag.AfterWriteTickInfo;
      }
    },
  },

  buffered: {
    __proto__: null,
    enumerable: false,
    get(this: WritableState) {
      return (this[kState] & WritableFlag.Buffered) !== 0 ? this[kBufferedValue] : [];
    },
    set(this: WritableState, value) {
      this[kBufferedValue] = value;
      if (value) {
        this[kState] |= WritableFlag.Buffered;
      } else {
        this[kState] &= ~WritableFlag.Buffered;
      }
    },
  },
});

function WritableState(this: WritableState, options?, stream?, isDuplex?) {
  // Bit map field to store WritableState more efficiently with 1 bit per field instead of a V8 slot per field.
  // The last two are those of an empty buffer.
  this[kState] =
    WritableFlag.Sync |
    Flag.Constructed |
    Flag.EmitClose |
    Flag.AutoDestroy |
    WritableFlag.AllBuffers |
    WritableFlag.AllNoop;

  if (options?.objectMode) this[kState] |= Flag.ObjectMode;

  if (isDuplex && options?.writableObjectMode) this[kState] |= Flag.ObjectMode;

  // The point at which write() starts returning false; 0 means always unless the buffer is flushed at once.
  this.highWaterMark = options
    ? getHighWaterMark(this, options, "writableHighWaterMark", isDuplex)
    : getDefaultHighWaterMark(false);

  if (!options || options.decodeStrings !== false) this[kState] |= WritableFlag.DecodeStrings;

  // Should close be emitted on destroy. Defaults to true.
  if (options && options.emitClose === false) this[kState] &= ~Flag.EmitClose;

  // Should .destroy() be called after 'end' (and potentially 'finish').
  if (options && options.autoDestroy === false) this[kState] &= ~Flag.AutoDestroy;

  // Crypto is kind of old and crusty.  Historically, its default string encoding is 'binary' so we have to make this configurable.
  const defaultEncoding = options ? options.defaultEncoding : null;
  if (defaultEncoding == null || defaultEncoding === "utf8" || defaultEncoding === "utf-8") {
    this[kState] |= WritableFlag.DefaultUTF8Encoding;
  } else if (Buffer.isEncoding(defaultEncoding)) {
    this[kState] &= ~WritableFlag.DefaultUTF8Encoding;
    this[kDefaultEncodingValue] = defaultEncoding;
  } else {
    throw $ERR_UNKNOWN_ENCODING(defaultEncoding);
  }

  // Not an actual buffer we keep track of, but a measurement of how much we're waiting to get pushed to some underlying socket or file.
  this.length = 0;

  // When true all writes will be buffered until .uncork() call.
  this.corked = 0;

  // The callback that's passed to _write(chunk, cb).
  this.onwrite = internals.onwrite!.bind(undefined, stream);

  // The amount that is being written when _write is called.
  this.writelen = 0;

  // What resetBuffer(this) does, but for the flags, which the first store has. The constructor creates every property itself, so that
  // all states have the same shape. With two more stores of flags it is too large for the JIT to put it where it is called.
  this[kBufferedValue] = null;
  this.bufferedIndex = 0;

  // Number of pending user-supplied write callbacks; 0 before 'finish' can be emitted.
  this.pendingcb = 0;
}

function resetBuffer(state: WritableState): void {
  state[kBufferedValue] = null;
  state.bufferedIndex = 0;
  state[kState] |= WritableFlag.AllBuffers | WritableFlag.AllNoop;
  state[kState] &= ~WritableFlag.Buffered;
}

WritableState.prototype.getBuffer = function getBuffer(this: WritableState) {
  return (this[kState] & WritableFlag.Buffered) === 0
    ? []
    : ArrayPrototypeSlice.$call(this.buffered, this.bufferedIndex);
};

ObjectDefineProperty(WritableState.prototype, "bufferedRequestCount", {
  __proto__: null,
  get(this: WritableState) {
    return (this[kState] & WritableFlag.Buffered) === 0 ? 0 : this[kBufferedValue]!.length - this.bufferedIndex;
  },
});

interface ReadableStateConstructor {
  new (options?, stream?, isDuplex?): ReadableState;
  (this: ReadableState, options?, stream?, isDuplex?): void;
  prototype: any;
}

interface WritableStateConstructor {
  new (options?, stream?, isDuplex?): WritableState;
  (this: WritableState, options?, stream?, isDuplex?): void;
  prototype: any;
}

function isReadableState(value: unknown): value is ReadableState {
  return value instanceof ReadableState;
}

function isWritableState(value: unknown): value is WritableState {
  return value instanceof WritableState;
}

function flagsOf(state) {
  return state[kState];
}

function addFlags(state, flags: number): void {
  state[kState] |= flags;
}

function removeFlags(state, flags: number): void {
  state[kState] &= ~flags;
}

function createByteReadableState(highWaterMark: unknown): ReadableState {
  const state: ReadableState = new ReadableState(undefined, undefined, false);
  if (highWaterMark != null) {
    if (typeof highWaterMark !== "number" || !NumberIsInteger(highWaterMark) || highWaterMark < 0) {
      throw $ERR_INVALID_ARG_VALUE("options.highWaterMark", highWaterMark);
    }
    state.highWaterMark = highWaterMark;
  }
  return state;
}

function createUnreadByteState(highWaterMark: number): ReadableState {
  return new ReadableState(kUnreadBytes, highWaterMark, false);
}

function advanceFlags(state: ReadableState, from: number, to: number): boolean {
  if (state[kState] !== from || state.length !== 0) return false;
  state[kState] = to | 0;
  return true;
}

declare global {
  namespace $Node {
    type ReadableState = import("internal/streams/state").ReadableState;
    type WritableState = import("internal/streams/state").WritableState;
    /** What a program may have put where a state belongs: the state of another implementation of streams, or its own object. */
    type ForeignState = Record<string, unknown>;
  }
}

export type { AfterWriteTickInfo, BufferedWrite, ReadableState, WritableState, WriteCallback };

export default {
  getHighWaterMark,
  getDefaultHighWaterMark,
  setDefaultHighWaterMark,
  ReadableState: ReadableState as unknown as ReadableStateConstructor,
  WritableState: WritableState as unknown as WritableStateConstructor,
  resetBuffer,
  createByteReadableState,
  createUnreadByteState,
  isReadableState,
  isWritableState,
  flagsOf,
  addFlags,
  removeFlags,
  advanceFlags,
  internals,
  nop,
  kState,
  kOnConstructed,
  kErroredValue,
  kDefaultEncodingValue,
  kDecoderValue,
  kEncodingValue,
  kOnFinishedValue,
  kWriteCbValue,
  kAfterWriteTickInfoValue,
  kBufferedValue,
} as const;
