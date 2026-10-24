// A bit simpler than readable streams.
// Implement an async ._write(chunk, encoding, cb), and it'll handle all
// the drain event emission and buffering.

"use strict";

const EE = require("node:events");
const { Stream } = require("internal/streams/legacy");
const destroyImpl = require("internal/streams/destroy");
const eos = require("internal/streams/end-of-stream");
const { addAbortSignal } = require("internal/streams/add-abort-signal");
const streamState = require("internal/streams/state");
const { WritableState, resetBuffer, isReadableState, isWritableState, flagsOf, addFlags, removeFlags, internals, nop } =
  streamState;
const kState: typeof streamState.kState = streamState.kState;
const kOnConstructed: typeof streamState.kOnConstructed = streamState.kOnConstructed;
const kErroredValue: typeof streamState.kErroredValue = streamState.kErroredValue;
const kDefaultEncodingValue: typeof streamState.kDefaultEncodingValue = streamState.kDefaultEncodingValue;
const kOnFinishedValue: typeof streamState.kOnFinishedValue = streamState.kOnFinishedValue;
const kWriteCbValue: typeof streamState.kWriteCbValue = streamState.kWriteCbValue;
const kAfterWriteTickInfoValue: typeof streamState.kAfterWriteTickInfoValue = streamState.kAfterWriteTickInfoValue;
const kBufferedValue: typeof streamState.kBufferedValue = streamState.kBufferedValue;
type WritableState = $Node.WritableState;
type WriteCallback = import("internal/streams/state").WriteCallback;
type AfterWriteTickInfo = import("internal/streams/state").AfterWriteTickInfo;

const { queueTick1, queueTick2 } = require("internal/process/next_tick_queue");
const ObjectDefineProperties = Object.defineProperties;
const ArrayPrototypeSlice = Array.prototype.slice;
const ObjectDefineProperty = Object.defineProperty;
const SymbolHasInstance = Symbol.hasInstance;
const FunctionPrototypeSymbolHasInstance = Function.prototype[Symbol.hasInstance];
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const SymbolAsyncDispose = Symbol.asyncDispose;

const { errorOrDestroy } = destroyImpl;

// The bits of WritableState[kState], and the masks of the hot path.
const enum Flag {
  ObjectMode = 1 << 0,
  ErrorEmitted = 1 << 1,
  AutoDestroy = 1 << 2,
  Destroyed = 1 << 4,
  Closed = 1 << 5,
  CloseEmitted = 1 << 6,
  Errored = 1 << 7,
  Constructed = 1 << 8,
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
  OnFinished = 1 << 20,
  HasWritable = 1 << 21,
  Writable = 1 << 22,
  Corked = 1 << 23,
  DefaultUTF8Encoding = 1 << 24,
  WriteCb = 1 << 25,
  ExpectWriteCb = 1 << 26,
  AfterWriteTickInfo = 1 << 27,
  AfterWritePending = 1 << 28,
  Buffered = 1 << 29,
  Ended = 1 << 30,
  WritingErroredCorkedOrConstructed = Writing | Errored | Corked | Constructed,
  WritingSync = Writing | Sync | ExpectWriteCb,
  WritingSyncWithCallback = Writing | Sync | ExpectWriteCb | WriteCb,
  DestroyedOrErrored = Destroyed | Errored,
  EndingOrDestroyed = Ending | Destroyed,
}

const enum ReadableFlag {
  EndEmitted = 1 << 10,
}

declare global {
  namespace $Node {
    interface ChunkToWrite {
      chunk: unknown;
      encoding: string;
    }

    interface WritableOptions extends StreamOptions {
      decodeStrings?: boolean;
      write?(this: Writable, chunk: unknown, encoding: string, callback: ErrorCallback): void;
      writev?(this: Writable, chunks: ChunkToWrite[], callback: ErrorCallback): void;
      final?(this: Writable, callback: ErrorCallback): void;
    }

    interface Writable extends StreamWithState {
      _writableState: WritableState;
      _write(chunk: unknown, encoding: string, callback: ErrorCallback): void;
      /** `null` on the prototype: only ever tested for truth. */
      _writev?(chunks: ChunkToWrite[], callback: ErrorCallback): void;
      _final?(callback: ErrorCallback): void;
      /** On `process.stdout` and `process.stderr`: `pipe()` does not end them. */
      _isStdio?: boolean;
      write(chunk: unknown, callback?: ErrorCallback): boolean;
      write(chunk: unknown, encoding?: string | null, callback?: ErrorCallback): boolean;
      end(callback?: ErrorCallback): this;
      end(chunk: unknown, callback?: ErrorCallback): this;
      end(chunk: unknown, encoding?: string | null, callback?: ErrorCallback): this;
      cork(): void;
      uncork(): void;
      setDefaultEncoding(encoding: string): this;
      get writable(): boolean;
      set writable(value: boolean);
      get writableFinished(): boolean;
      get writableObjectMode(): boolean;
      get writableBuffer(): unknown[];
      get writableEnded(): boolean;
      get writableNeedDrain(): boolean;
      get writableHighWaterMark(): number;
      get writableCorked(): number;
      get writableLength(): number;
      get writableAborted(): boolean;
    }

    interface WritableConstructor {
      new (options?: WritableOptions): Writable;
      (this: Writable, options?: WritableOptions): void;
      prototype: any;
      WritableState: typeof WritableState;
      fromWeb: typeof Writable.fromWeb;
      toWeb: typeof Writable.toWeb;
    }
  }
}

WritableState.prototype[kOnConstructed] = function onConstructed(this: WritableState, stream: $Node.Writable) {
  if ((this[kState] & Flag.Writing) === 0) {
    clearBuffer(stream, this);
  }

  if ((this[kState] & Flag.Ending) !== 0) {
    finishMaybe(stream, this, false);
  }
};

function preallocatedEvents(): $Node.Events {
  return {
    close: undefined,
    error: undefined,
    prefinish: undefined,
    finish: undefined,
    drain: undefined,
    // Skip uncommon events...
    // [destroyImpl.kConstruct]: undefined,
    // [destroyImpl.kDestroy]: undefined,
  };
}

// A function of its own: a closure over `this` in the constructor is an environment that every stream would make, also the many without _construct().
function runConstruct(stream: $Node.Writable) {
  destroyImpl.construct(stream, () => {
    stream._writableState[kOnConstructed](stream);
  });
}

function Writable(this: $Node.Writable, options?: $Node.WritableOptions): void {
  if (!(this instanceof Writable)) return new Writable(options) as any;

  this._events ??= preallocatedEvents();

  this._writableState = new WritableState(options, this, false);

  if (options) {
    const { write, writev, destroy, final, construct, signal } = options;
    if (typeof write === "function") this._write = write;

    if (typeof writev === "function") this._writev = writev;

    if (typeof destroy === "function") this._destroy = destroy;

    if (typeof final === "function") this._final = final;

    if (typeof construct === "function") this._construct = construct;

    if (signal) addAbortSignal(signal, this);
  }

  Stream.$call(this, options);

  if (this._construct != null) runConstruct(this);
}
$toClass(Writable, "Writable", Stream);

Writable.WritableState = WritableState;

internals.onwrite = onwrite;

ObjectDefineProperty(Writable, SymbolHasInstance, {
  __proto__: null,
  value: function (object) {
    if (FunctionPrototypeSymbolHasInstance.$call(this, object)) return true;
    if (this !== Writable) return false;

    return object && isWritableState(object._writableState);
  },
});

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function (this: $Node.Writable) {
  errorOrDestroy(this, $ERR_STREAM_CANNOT_PIPE());
};

function _write(stream: $Node.Writable, state: WritableState, chunk, encoding, cb) {
  if (cb == null || typeof cb !== "function") {
    cb = nop;
  }

  if (chunk === null) {
    throw $ERR_STREAM_NULL_VALUES();
  }

  if ((state[kState] & Flag.ObjectMode) === 0) {
    return writeBytes(stream, state, chunk, encoding, cb);
  }

  if ((state[kState] & Flag.EndingOrDestroyed) !== 0) {
    return writeAfterEnd(stream, state, cb);
  }

  state.pendingcb!++;
  return writeOrBuffer(stream, state, chunk, encoding, cb, 1);
}

function writeBytes(stream: $Node.Writable, state: WritableState, chunk, encoding, cb: WriteCallback) {
  if (!encoding) {
    encoding = (state[kState] & Flag.DefaultUTF8Encoding) !== 0 ? "utf8" : state[kDefaultEncodingValue];
  } else if (encoding !== "buffer" && !Buffer.isEncoding(encoding)) {
    throw $ERR_UNKNOWN_ENCODING(encoding);
  }

  if (typeof chunk === "string") {
    if (encoding === "buffer") {
      throw $ERR_UNKNOWN_ENCODING(encoding);
    }
    if ((state[kState] & Flag.DecodeStrings) !== 0) {
      chunk = Buffer.from(chunk, encoding);
      encoding = "buffer";
    }
  } else if (chunk instanceof Buffer) {
    encoding = "buffer";
  } else if (Stream._isArrayBufferView(chunk)) {
    chunk = Stream._uint8ArrayToBuffer(chunk);
    encoding = "buffer";
  } else {
    throw $ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "TypedArray", "DataView"], chunk);
  }

  if ((state[kState] & Flag.EndingOrDestroyed) !== 0) {
    return writeAfterEnd(stream, state, cb);
  }

  state.pendingcb!++;
  return writeOrBuffer(stream, state, chunk, encoding, cb, chunk.length as number);
}

function writeAfterEnd(stream: $Node.Writable, state: WritableState, cb: WriteCallback) {
  const err = (state[kState] & Flag.Ending) !== 0 ? $ERR_STREAM_WRITE_AFTER_END() : $ERR_STREAM_DESTROYED("write");
  process.nextTick(cb, err);
  errorOrDestroy(stream, err, true);
  return err;
}

const writingMethod = (Writable.prototype.write = function (
  this: $Node.Writable,
  chunk: unknown,
  encoding?: string | null | WriteCallback,
  cb?: WriteCallback,
) {
  if (encoding != null && typeof encoding === "function") {
    cb = encoding;
    encoding = null;
  }

  return _write(this, this._writableState, chunk, encoding, cb) === true;
});

internals.writeToWritable = _write;
internals.writingMethod = writingMethod;

Writable.prototype.cork = function (this: $Node.Writable) {
  const state: WritableState = this._writableState;

  state[kState] |= Flag.Corked;
  state.corked++;
};

Writable.prototype.uncork = function (this: $Node.Writable) {
  const state: WritableState = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.corked) {
      state[kState] &= ~Flag.Corked;
    }

    if ((state[kState] & Flag.Writing) === 0) clearBuffer(this, state);
  }
};

Writable.prototype.setDefaultEncoding = function setDefaultEncoding(this: $Node.Writable, encoding: string) {
  // node::ParseEncoding() requires lower case.
  if (typeof encoding === "string") encoding = StringPrototypeToLowerCase.$call(encoding);
  if (!Buffer.isEncoding(encoding)) throw $ERR_UNKNOWN_ENCODING(encoding);
  this._writableState.defaultEncoding = encoding;
  return this;
};

// If we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(
  stream: $Node.Writable,
  state: WritableState,
  chunk,
  encoding,
  callback: WriteCallback,
  len: number,
): boolean {
  state.length += len;

  const flags = state[kState];
  if ((flags & Flag.WritingErroredCorkedOrConstructed) !== Flag.Constructed) {
    bufferWrite(state, chunk, encoding, callback);
  } else {
    state.writelen = len;
    if (callback === nop) {
      state[kState] = flags | Flag.WritingSync;
    } else {
      state[kWriteCbValue] = callback;
      state[kState] = flags | Flag.WritingSyncWithCallback;
    }
    stream._write(chunk, encoding, state.onwrite);
    state[kState] &= ~Flag.Sync;
  }

  const length = state.length;
  if (length < state.highWaterMark || length === 0) {
    // Return false if errored or destroyed in order to break any synchronous while(stream.write(data)) loops.
    return (state[kState] & Flag.DestroyedOrErrored) === 0;
  }

  state[kState] |= Flag.NeedDrain;
  return false;
}

function bufferWrite(state: WritableState, chunk, encoding, callback: WriteCallback): void {
  if ((state[kState] & Flag.Buffered) === 0) {
    state[kState] |= Flag.Buffered;
    state[kBufferedValue] = [];
  }

  state[kBufferedValue]!.push({ chunk, encoding, callback });
  if ((state[kState] & Flag.AllBuffers) !== 0 && encoding !== "buffer") {
    state[kState] &= ~Flag.AllBuffers;
  }
  if ((state[kState] & Flag.AllNoop) !== 0 && callback !== nop) {
    state[kState] &= ~Flag.AllNoop;
  }
}

function doWrite(
  stream: $Node.Writable,
  state: WritableState,
  writev: boolean,
  len: number,
  chunk,
  encoding,
  cb: WriteCallback,
): void {
  state.writelen = len;
  if (cb !== nop) {
    state[kWriteCbValue] = cb;
    state[kState] |= Flag.WriteCb;
  }
  state[kState] |= Flag.Writing | Flag.Sync | Flag.ExpectWriteCb;
  if ((state[kState] & Flag.Destroyed) !== 0) state.onwrite($ERR_STREAM_DESTROYED("write"));
  else if (writev) stream._writev!(chunk, state.onwrite);
  else stream._write(chunk, encoding, state.onwrite);
  state[kState] &= ~Flag.Sync;
}

function onwriteError(stream: $Node.Writable, state: WritableState, er, cb: WriteCallback): void {
  --state.pendingcb!;

  cb(er);
  // Ensure callbacks are invoked even when autoDestroy is
  // not enabled. Passing `er` here doesn't make sense since
  // it's related to one specific write, not to the buffered
  // writes.
  errorBuffer(state);
  // This can emit error, but error must always follow cb.
  errorOrDestroy(stream, er);
}

function onwrite(stream: $Node.Writable, er): void {
  const state = stream._writableState;

  if ((state[kState] & Flag.ExpectWriteCb) === 0) {
    errorOrDestroy(stream, $ERR_MULTIPLE_CALLBACK());
    return;
  }

  const sync = (state[kState] & Flag.Sync) !== 0;
  const cb: WriteCallback = (state[kState] & Flag.WriteCb) !== 0 ? state[kWriteCbValue]! : nop;

  state[kWriteCbValue] = null;
  state[kState] &= ~(Flag.Writing | Flag.ExpectWriteCb | Flag.WriteCb);
  state.length -= state.writelen;
  state.writelen = 0;

  if (er) {
    // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
    er.stack; // oxlint-disable-line bun/no-unused-expressions

    if ((state[kState] & Flag.Errored) === 0) {
      state[kErroredValue] = er;
      state[kState] |= Flag.Errored;
    }

    // In case of duplex streams we need to notify the readable side of the
    // error.
    const readableState = stream._readableState as $Node.ReadableState | $Node.ForeignState | undefined;
    if (isReadableState(readableState)) {
      if (!readableState.errored) readableState.errored = er;
    } else if (readableState && !readableState.errored) {
      readableState.errored = er;
    }

    if (sync) {
      process.nextTick(onwriteError, stream, state, er, cb);
    } else {
      onwriteError(stream, state, er, cb);
    }
  } else {
    if ((state[kState] & Flag.Buffered) !== 0) {
      clearBuffer(stream, state);
    }

    if (sync) {
      const needDrain = (state[kState] & Flag.NeedDrain) !== 0 && state.length === 0;
      // As in Node, where it is spelled `state[kState] & Number(Flag.Destroyed !== 0)`: bit 0.
      const needTick = needDrain || (state[kState] & 1) !== 0 || cb !== nop;

      // It is a common case that the callback passed to .write() is always
      // the same. In that case, we do not schedule a new nextTick(), but
      // rather just increase a counter, to improve performance and avoid
      // memory allocations.
      if (cb === nop) {
        if ((state[kState] & Flag.AfterWritePending) === 0 && needTick) {
          process.nextTick(afterWrite, stream, state, 1, cb);
          state[kState] |= Flag.AfterWritePending;
        } else {
          state.pendingcb!--;
          if ((state[kState] & Flag.Ending) !== 0) {
            finishMaybe(stream, state, true);
          }
        }
      } else {
        const tickInfo = (state[kState] & Flag.AfterWriteTickInfo) !== 0 ? state[kAfterWriteTickInfoValue]! : null;
        if (tickInfo !== null && tickInfo.cb === cb) {
          tickInfo.count++;
        } else if (needTick) {
          const info: AfterWriteTickInfo = { count: 1, cb, stream, state };
          state[kAfterWriteTickInfoValue] = info;
          queueTick1(afterWriteTick, info);
          state[kState] |= Flag.AfterWritePending | Flag.AfterWriteTickInfo;
        } else {
          state.pendingcb!--;
          if ((state[kState] & Flag.Ending) !== 0) {
            finishMaybe(stream, state, true);
          }
        }
      }
    } else {
      afterWrite(stream, state, 1, cb);
    }
  }
}

function afterWriteTick({ stream, state, count, cb }: AfterWriteTickInfo): void {
  state[kState] &= ~Flag.AfterWriteTickInfo;
  state[kAfterWriteTickInfoValue] = null;
  return afterWrite(stream, state, count, cb);
}

function afterWrite(stream: $Node.Writable, state: WritableState, count: number, cb: WriteCallback): void {
  state[kState] &= ~Flag.AfterWritePending;

  const needDrain =
    (state[kState] & (Flag.Ending | Flag.NeedDrain | Flag.Destroyed)) === Flag.NeedDrain && state.length === 0;
  if (needDrain) {
    state[kState] &= ~Flag.NeedDrain;
    stream.emit("drain");
  }

  while (count-- > 0) {
    state.pendingcb!--;
    cb(null);
  }

  if ((state[kState] & Flag.Destroyed) !== 0) {
    errorBuffer(state);
  }

  if ((state[kState] & Flag.Ending) !== 0) {
    finishMaybe(stream, state, true);
  }
}

// If there's something in the buffer waiting, then invoke callbacks.
function errorBuffer(state: WritableState): void {
  if ((state[kState] & Flag.Writing) !== 0) {
    return;
  }

  const buffered = (state[kState] & Flag.Buffered) !== 0 ? state[kBufferedValue] : null;
  if (buffered !== null) {
    for (let n = state.bufferedIndex; n < buffered.length; ++n) {
      const { chunk, callback } = buffered[n]!;
      const len = (state[kState] & Flag.ObjectMode) !== 0 ? 1 : (chunk.length as number);
      state.length -= len;
      callback(((state[kState] & Flag.Errored) !== 0 ? state[kErroredValue] : null) ?? $ERR_STREAM_DESTROYED("write"));
    }
  }

  callFinishedCallbacks(
    state,
    ((state[kState] & Flag.Errored) !== 0 ? state[kErroredValue] : null) ?? $ERR_STREAM_DESTROYED("end"),
  );

  resetBuffer(state);
}

// If there's something in the buffer waiting, then process it.
function clearBuffer(stream: $Node.Writable, state: WritableState): void {
  if (
    (state[kState] & (Flag.Destroyed | Flag.BufferProcessing | Flag.Corked | Flag.Buffered | Flag.Constructed)) !==
    (Flag.Buffered | Flag.Constructed)
  ) {
    return;
  }

  const objectMode = (state[kState] & Flag.ObjectMode) !== 0;
  const buffered = state[kBufferedValue]!;
  const bufferedIndex = state.bufferedIndex;
  const bufferedLength = buffered.length - bufferedIndex;

  if (!bufferedLength) {
    return;
  }

  let i = bufferedIndex;

  state[kState] |= Flag.BufferProcessing;
  if (bufferedLength > 1 && stream._writev) {
    state.pendingcb! -= bufferedLength - 1;

    const callback =
      (state[kState] & Flag.AllNoop) !== 0
        ? nop
        : err => {
            for (let n = i; n < buffered.length; ++n) {
              buffered[n]!.callback(err);
            }
          };
    // Make a copy of `buffered` if it's going to be used by `callback` above,
    // since `doWrite` will mutate the array.
    const chunks = (state[kState] & Flag.AllNoop) !== 0 && i === 0 ? buffered : ArrayPrototypeSlice.$call(buffered, i);
    (chunks as any).allBuffers = (state[kState] & Flag.AllBuffers) !== 0;

    doWrite(stream, state, true, state.length, chunks, "", callback);

    resetBuffer(state);
  } else {
    do {
      const { chunk, encoding, callback } = buffered[i]!;
      buffered[i++] = null;
      const len = objectMode ? 1 : (chunk.length as number);
      doWrite(stream, state, false, len, chunk, encoding, callback);
    } while (i < buffered.length && (state[kState] & Flag.Writing) === 0);

    if (i === buffered.length) {
      resetBuffer(state);
    } else if (i > 256) {
      buffered.splice(0, i);
      state.bufferedIndex = 0;
    } else {
      state.bufferedIndex = i;
    }
  }
  state[kState] &= ~Flag.BufferProcessing;
}

Writable.prototype._write = function (this: $Node.Writable, chunk: unknown, encoding: string, cb: WriteCallback) {
  if (this._writev) {
    this._writev([{ chunk, encoding }], cb);
  } else {
    throw $ERR_METHOD_NOT_IMPLEMENTED("_write()");
  }
};

Writable.prototype._writev = null;

Writable.prototype.end = function (
  this: $Node.Writable,
  chunk?: unknown,
  encoding?: string | null | WriteCallback,
  cb?: WriteCallback,
) {
  const state: WritableState = this._writableState;

  if (typeof chunk === "function") {
    cb = chunk as WriteCallback;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === "function") {
    cb = encoding;
    encoding = null;
  }

  let err;

  if (chunk != null) {
    const ret = _write(this, state, chunk, encoding, undefined);
    if (Error.isError(ret)) {
      err = ret;
    }
  }

  // .end() fully uncorks.
  if ((state[kState] & Flag.Corked) !== 0) {
    state.corked = 1;
    this.uncork();
  }

  if (err) {
    // Do nothing...
  } else if ((state[kState] & (Flag.Ending | Flag.Errored)) === 0) {
    // This is forgiving in terms of unnecessary calls to end() and can hide
    // logic errors. However, usually such errors are harmless and causing a
    // hard error can be disproportionately destructive. It is not always
    // trivial for the user to determine whether end() needs to be called
    // or not.

    state[kState] |= Flag.Ending;
    finishMaybe(this, state, true);
    state[kState] |= Flag.Ended;
  } else if ((state[kState] & Flag.Finished) !== 0) {
    err = $ERR_STREAM_ALREADY_FINISHED("end");
  } else if ((state[kState] & Flag.Destroyed) !== 0) {
    err = $ERR_STREAM_DESTROYED("end");
  }

  if (typeof cb === "function") {
    if (err) {
      process.nextTick(cb, err);
    } else if ((state[kState] & Flag.Errored) !== 0) {
      process.nextTick(cb, state[kErroredValue]);
    } else if ((state[kState] & Flag.Finished) !== 0) {
      process.nextTick(cb, null);
    } else {
      state[kState] |= Flag.OnFinished;
      (state[kOnFinishedValue] ??= []).push(cb);
    }
  }

  return this;
};

function needFinish(state: WritableState): boolean {
  return (
    // State is ended && constructed but not destroyed, finished, writing, errorEmitted or closedEmitted
    (state[kState] &
      (Flag.Ending |
        Flag.Destroyed |
        Flag.Constructed |
        Flag.Finished |
        Flag.Writing |
        Flag.ErrorEmitted |
        Flag.CloseEmitted |
        Flag.Errored |
        Flag.Buffered)) ===
      (Flag.Ending | Flag.Constructed) && state.length === 0
  );
}

function onFinish(stream: $Node.Writable, state: WritableState, err): void {
  if ((state[kState] & Flag.Prefinished) !== 0) {
    errorOrDestroy(stream, err ?? $ERR_MULTIPLE_CALLBACK());
    return;
  }
  state.pendingcb!--;
  if (err) {
    callFinishedCallbacks(state, err);
    errorOrDestroy(stream, err, (state[kState] & Flag.Sync) !== 0);
  } else if (needFinish(state)) {
    state[kState] |= Flag.Prefinished;
    stream.emit("prefinish");
    // Backwards compat. Don't check state.sync here.
    // Some streams assume 'finish' will be emitted
    // asynchronously relative to _final callback.
    state.pendingcb!++;
    queueTick2(finish, stream, state);
  }
}

function prefinish(stream: $Node.Writable, state: WritableState): void {
  if ((state[kState] & (Flag.Prefinished | Flag.FinalCalled)) !== 0) {
    return;
  }

  if (typeof stream._final === "function" && (state[kState] & Flag.Destroyed) === 0) {
    state[kState] |= Flag.FinalCalled | Flag.Sync;
    state.pendingcb!++;

    try {
      stream._final(err => onFinish(stream, state, err));
    } catch (err) {
      onFinish(stream, state, err);
    }

    state[kState] &= ~Flag.Sync;
  } else {
    state[kState] |= Flag.FinalCalled | Flag.Prefinished;
    stream.emit("prefinish");
  }
}

function finishMaybe(stream: $Node.Writable, state: WritableState, sync: boolean): void {
  if (needFinish(state)) {
    prefinish(stream, state);
    if (state.pendingcb === 0) {
      if (sync) {
        state.pendingcb!++;
        process.nextTick(
          (stream: $Node.Writable, state: WritableState) => {
            if (needFinish(state)) {
              finish(stream, state);
            } else {
              state.pendingcb!--;
            }
          },
          stream,
          state,
        );
      } else if (needFinish(state)) {
        state.pendingcb!++;
        finish(stream, state);
      }
    }
  }
}

function finish(stream: $Node.Writable, state: WritableState): void {
  state.pendingcb!--;
  state[kState] |= Flag.Finished;

  callFinishedCallbacks(state, null);

  stream.emit("finish");

  if ((state[kState] & Flag.AutoDestroy) !== 0) {
    // In case of duplex streams we need a way to detect
    // if the readable side is ready for autoDestroy as well.
    const rState = stream._readableState as $Node.ReadableState | $Node.ForeignState | undefined;
    const autoDestroy = isReadableState(rState)
      ? (rState[kState] & Flag.AutoDestroy) !== 0 &&
        ((rState[kState] & ReadableFlag.EndEmitted) !== 0 || rState.readable === false)
      : !rState ||
        (rState.autoDestroy &&
          // We don't expect the readable to ever 'end' if readable is explicitly set to false.
          (rState.endEmitted || rState.readable === false));
    if (autoDestroy) {
      stream.destroy();
    }
  }
}

function callFinishedCallbacks(state: WritableState, err): void {
  if ((state[kState] & Flag.OnFinished) === 0) {
    return;
  }

  const onfinishCallbacks = state[kOnFinishedValue]!;
  state[kOnFinishedValue] = null;
  state[kState] &= ~Flag.OnFinished;
  for (let i = 0; i < onfinishCallbacks.length; i++) {
    onfinishCallbacks[i](err);
  }
}

const accessors = {
  closed: {
    __proto__: null,
    get(this: $Node.Writable) {
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      return state ? (flagsOf(state) & Flag.Closed) !== 0 : false;
    },
  },

  destroyed: {
    __proto__: null,
    get(this: $Node.Writable) {
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      return state ? (flagsOf(state) & Flag.Destroyed) !== 0 : false;
    },
    set(this: $Node.Writable, value) {
      // Backward compatibility, the user is explicitly managing destroyed.
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      if (!state) return;

      if (value) addFlags(state, Flag.Destroyed);
      else removeFlags(state, Flag.Destroyed);
    },
  },

  writable: {
    __proto__: null,
    get(this: $Node.Writable) {
      const w = this._writableState as WritableState | $Node.ForeignState | undefined;
      // w.writable === false means that this is part of a Duplex stream
      // where the writable side was disabled upon construction.
      // Compat. The user might manually disable writable side through
      // deprecated setter.
      if (isWritableState(w)) {
        return (
          (w[kState] & (Flag.HasWritable | Flag.Writable)) !== Flag.HasWritable &&
          (w[kState] & (Flag.Ending | Flag.Ended | Flag.Destroyed | Flag.Errored)) === 0
        );
      }
      return (
        !!w && w.writable !== false && (flagsOf(w) & (Flag.Ending | Flag.Ended | Flag.Destroyed | Flag.Errored)) === 0
      );
    },
    set(this: $Node.Writable, val) {
      // Backwards compatible.
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      if (isWritableState(state)) {
        state.writable = !!val;
      } else if (state) {
        state.writable = !!val;
      }
    },
  },

  writableFinished: {
    __proto__: null,
    get(this: $Node.Writable) {
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      return state ? (flagsOf(state) & Flag.Finished) !== 0 : false;
    },
  },

  writableObjectMode: {
    __proto__: null,
    get(this: $Node.Writable) {
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      return state ? (flagsOf(state) & Flag.ObjectMode) !== 0 : false;
    },
  },

  writableBuffer: {
    __proto__: null,
    get(this: $Node.Writable) {
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      return isWritableState(state) ? state.getBuffer() : state && (state.getBuffer as () => unknown[])();
    },
  },

  writableEnded: {
    __proto__: null,
    get(this: $Node.Writable) {
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      return state ? (flagsOf(state) & Flag.Ending) !== 0 : false;
    },
  },

  writableNeedDrain: {
    __proto__: null,
    get(this: $Node.Writable) {
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      return state ? (flagsOf(state) & (Flag.Destroyed | Flag.Ending | Flag.NeedDrain)) === Flag.NeedDrain : false;
    },
  },

  writableHighWaterMark: {
    __proto__: null,
    get(this: $Node.Writable) {
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      return isWritableState(state) ? state.highWaterMark : state?.highWaterMark;
    },
  },

  writableCorked: {
    __proto__: null,
    get(this: $Node.Writable) {
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      return isWritableState(state) ? state.corked : state ? state.corked : 0;
    },
  },

  writableLength: {
    __proto__: null,
    get(this: $Node.Writable) {
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      return isWritableState(state) ? state.length : state?.length;
    },
  },

  errored: {
    __proto__: null,
    enumerable: false,
    get(this: $Node.Writable) {
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      if (!isWritableState(state)) return state ? state.errored : null;
      return (state[kState] & Flag.Errored) !== 0 ? state[kErroredValue] : null;
    },
  },

  writableAborted: {
    __proto__: null,
    get: function (this: $Node.Writable) {
      const state = this._writableState as WritableState | $Node.ForeignState | undefined;
      const flags = flagsOf(state);
      return (
        (flags & (Flag.HasWritable | Flag.Writable)) !== Flag.HasWritable &&
        (flags & (Flag.Destroyed | Flag.Errored)) !== 0 &&
        (flags & Flag.Finished) === 0
      );
    },
  },
};
ObjectDefineProperties(Writable.prototype, accessors);
internals.writableAccessors = accessors;

const destroy = destroyImpl.destroy;
Writable.prototype.destroy = function (this: $Node.Writable, err?: Error | null, cb?: WriteCallback) {
  const state: WritableState = this._writableState;

  // Invoke pending callbacks.
  if ((state[kState] & (Flag.Buffered | Flag.OnFinished)) !== 0 && (state[kState] & Flag.Destroyed) === 0) {
    process.nextTick(errorBuffer, state);
  }

  destroy.$call(this, err, cb);
  return this;
};

Writable.prototype._undestroy = destroyImpl.undestroy;
Writable.prototype._destroy = function (this: $Node.Writable, err: Error | null, cb: WriteCallback) {
  cb(err);
};

Writable.prototype[EE.captureRejectionSymbol] = function (this: $Node.Writable, err: Error) {
  this.destroy(err);
};

// Lazy to avoid circular references
Writable.fromWeb = function (writableStream, options?) {
  return require("internal/webstreams_adapters").newStreamWritableFromWritableStream(writableStream, options);
};

Writable.toWeb = function (streamWritable) {
  return require("internal/webstreams_adapters").newWritableStreamFromStreamWritable(streamWritable);
};

Writable.prototype[SymbolAsyncDispose] = function (this: $Node.Writable) {
  let error;
  if (!this.destroyed) {
    error = this.writableFinished ? null : $makeAbortError();
    this.destroy(error);
  }
  return new Promise((resolve, reject) =>
    eos(this, err => (err && err.name !== "AbortError" ? reject(err) : resolve(null))),
  );
};

export default Writable as $Node.WritableConstructor;
