// A bit simpler than readable streams.
// Implement an async ._write(chunk, encoding, cb), and it'll handle all
// the drain event emission and buffering.

"use strict";

const EE = require("node:events");
const { Stream } = require("internal/streams/legacy");
const destroyImpl = require("internal/streams/destroy");
const eos = require("internal/streams/end-of-stream");
const { addAbortSignal } = require("internal/streams/add-abort-signal");
const {
  WritableState,
  createWritableState,
  isReadableState,
  isWritableState,
  flagsOf,
  addFlags,
  removeFlags,
  internals,
  nop,
} = require("internal/streams/state") as typeof import("internal/streams/state").default;
type ReadableState = import("internal/streams/state").ReadableState;
type WritableState = import("internal/streams/state").WritableState;
type WriteCallback = import("internal/streams/state").WriteCallback;
type AfterWriteTickInfo = import("internal/streams/state").AfterWriteTickInfo;

const process = globalThis.process;
const ObjectDefineProperties = Object.defineProperties;
const ArrayPrototypeSlice = Array.prototype.slice;
const ObjectDefineProperty = Object.defineProperty;
const SymbolHasInstance = Symbol.hasInstance;
const FunctionPrototypeSymbolHasInstance = Function.prototype[Symbol.hasInstance];
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const SymbolAsyncDispose = Symbol.asyncDispose;

const { errorOrDestroy } = destroyImpl;

const kObjectMode = 1 << 0;
const kErrorEmitted = 1 << 1;
const kAutoDestroy = 1 << 2;
const kDestroyed = 1 << 4;
const kClosed = 1 << 5;
const kCloseEmitted = 1 << 6;
const kErrored = 1 << 7;
const kConstructed = 1 << 8;
const kSync = 1 << 9;
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
const kOnFinished = 1 << 20;
const kHasWritable = 1 << 21;
const kWritable = 1 << 22;
const kCorked = 1 << 23;
const kDefaultUTF8Encoding = 1 << 24;
const kWriteCb = 1 << 25;
const kExpectWriteCb = 1 << 26;
const kAfterWriteTickInfo = 1 << 27;
const kAfterWritePending = 1 << 28;
const kBuffered = 1 << 29;
const kEnded = 1 << 30;

// Masks of the hot path, by name: an expression of constants counts against the size at which a function is still inlined.
const kWritingErroredCorkedOrConstructed = kWriting | kErrored | kCorked | kConstructed;
const kWritingSync = kWriting | kSync | kExpectWriteCb;
const kWritingSyncWithCallback = kWriting | kSync | kExpectWriteCb | kWriteCb;
const kDestroyedOrErrored = kDestroyed | kErrored;
const kEndingOrDestroyed = kEnding | kDestroyed;

function resetBuffer(state: WritableState): void {
  state.bufferedValue = null;
  state.bufferedIndex = 0;
  state.flags |= kAllBuffers | kAllNoop;
  state.flags &= ~kBuffered;
}

function preallocatedEvents(): Record<string | symbol, unknown> {
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

function Writable(options): void {
  if (!(this instanceof Writable)) return new Writable(options);

  this._events ??= preallocatedEvents();

  this._writableState = createWritableState(options, this, false);

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

  if (this._construct != null) {
    destroyImpl.construct(this, () => {
      onConstructed(this, this._writableState);
    });
  }
}
$toClass(Writable, "Writable", Stream);

Writable.WritableState = WritableState;

function onConstructed(stream, state: WritableState): void {
  if ((state.flags & kWriting) === 0) {
    clearBuffer(stream, state);
  }

  if ((state.flags & kEnding) !== 0) {
    finishMaybe(stream, state, false);
  }
}

// What `onwrite.bind(undefined, stream)` was: the same name, length and own properties, and a plain call.
function bindOnwrite(stream, state: WritableState): WriteCallback {
  return {
    "bound onwrite"(er) {
      onwrite(stream, state, er);
    },
  }["bound onwrite"];
}

internals.bindOnwrite = bindOnwrite;
internals.onWritableConstructed = onConstructed;

ObjectDefineProperty(Writable, SymbolHasInstance, {
  __proto__: null,
  value: function (object) {
    if (FunctionPrototypeSymbolHasInstance.$call(this, object)) return true;
    if (this !== Writable) return false;

    return object && isWritableState(object._writableState);
  },
});

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function () {
  errorOrDestroy(this, $ERR_STREAM_CANNOT_PIPE());
};

function _write(stream, state: WritableState, chunk, encoding, cb) {
  if (cb == null || typeof cb !== "function") {
    cb = nop;
  }

  if (chunk === null) {
    throw $ERR_STREAM_NULL_VALUES();
  }

  if ((state.flags & kObjectMode) === 0) {
    return writeBytes(stream, state, chunk, encoding, cb);
  }

  if ((state.flags & kEndingOrDestroyed) !== 0) {
    return writeAfterEnd(stream, state, cb);
  }

  state.pendingcb!++;
  return writeOrBuffer(stream, state, chunk, encoding, cb, 1);
}

function writeBytes(stream, state: WritableState, chunk, encoding, cb: WriteCallback) {
  if (!encoding) {
    encoding = (state.flags & kDefaultUTF8Encoding) !== 0 ? "utf8" : state.defaultEncodingValue;
  } else if (encoding !== "buffer" && !Buffer.isEncoding(encoding)) {
    throw $ERR_UNKNOWN_ENCODING(encoding);
  }

  if (typeof chunk === "string") {
    if (encoding === "buffer") {
      throw $ERR_UNKNOWN_ENCODING(encoding);
    }
    if ((state.flags & kDecodeStrings) !== 0) {
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

  if ((state.flags & kEndingOrDestroyed) !== 0) {
    return writeAfterEnd(stream, state, cb);
  }

  state.pendingcb!++;
  return writeOrBuffer(stream, state, chunk, encoding, cb, chunk.length as number);
}

function writeAfterEnd(stream, state: WritableState, cb: WriteCallback) {
  const err = (state.flags & kEnding) !== 0 ? $ERR_STREAM_WRITE_AFTER_END() : $ERR_STREAM_DESTROYED("write");
  process.nextTick(cb, err);
  errorOrDestroy(stream, err, true);
  return err;
}

Writable.prototype.write = function (chunk, encoding, cb) {
  if (encoding != null && typeof encoding === "function") {
    cb = encoding;
    encoding = null;
  }

  return _write(this, this._writableState, chunk, encoding, cb) === true;
};

internals.write = _write;
internals.writeMethod = Writable.prototype.write;

Writable.prototype.cork = function () {
  const state: WritableState = this._writableState;

  state.flags |= kCorked;
  state.corked++;
};

Writable.prototype.uncork = function () {
  const state: WritableState = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.corked) {
      state.flags &= ~kCorked;
    }

    if ((state.flags & kWriting) === 0) clearBuffer(this, state);
  }
};

Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
  // node::ParseEncoding() requires lower case.
  if (typeof encoding === "string") encoding = StringPrototypeToLowerCase.$call(encoding);
  if (!Buffer.isEncoding(encoding)) throw $ERR_UNKNOWN_ENCODING(encoding);
  this._writableState.defaultEncoding = encoding;
  return this;
};

// If we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state: WritableState, chunk, encoding, callback: WriteCallback, len: number): boolean {
  state.length += len;

  const flags = state.flags;
  if ((flags & kWritingErroredCorkedOrConstructed) !== kConstructed) {
    bufferWrite(state, chunk, encoding, callback);
  } else {
    state.writelen = len;
    if (callback === nop) {
      state.flags = flags | kWritingSync;
    } else {
      state.writeCbValue = callback;
      state.flags = flags | kWritingSyncWithCallback;
    }
    stream._write(chunk, encoding, state.onwrite);
    state.flags &= ~kSync;
  }

  const length = state.length;
  if (length < state.highWaterMark || length === 0) {
    // Return false if errored or destroyed in order to break
    // any synchronous while(stream.write(data)) loops.
    return (state.flags & kDestroyedOrErrored) === 0;
  }

  state.flags |= kNeedDrain;
  return false;
}

function bufferWrite(state: WritableState, chunk, encoding, callback: WriteCallback): void {
  if ((state.flags & kBuffered) === 0) {
    state.flags |= kBuffered;
    state.bufferedValue = [];
  }

  state.bufferedValue!.push({ chunk, encoding, callback });
  if ((state.flags & kAllBuffers) !== 0 && encoding !== "buffer") {
    state.flags &= ~kAllBuffers;
  }
  if ((state.flags & kAllNoop) !== 0 && callback !== nop) {
    state.flags &= ~kAllNoop;
  }
}

function doWrite(stream, state: WritableState, writev: boolean, len: number, chunk, encoding, cb: WriteCallback): void {
  state.writelen = len;
  if (cb !== nop) {
    state.writeCbValue = cb;
    state.flags |= kWriteCb;
  }
  state.flags |= kWriting | kSync | kExpectWriteCb;
  if ((state.flags & kDestroyed) !== 0) state.onwrite($ERR_STREAM_DESTROYED("write"));
  else if (writev) stream._writev(chunk, state.onwrite);
  else stream._write(chunk, encoding, state.onwrite);
  state.flags &= ~kSync;
}

function onwriteError(stream, state: WritableState, er, cb: WriteCallback): void {
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

function onwrite(stream, state: WritableState, er): void {
  if ((state.flags & kExpectWriteCb) === 0) {
    errorOrDestroy(stream, $ERR_MULTIPLE_CALLBACK());
    return;
  }

  const sync = (state.flags & kSync) !== 0;
  const cb: WriteCallback = (state.flags & kWriteCb) !== 0 ? state.writeCbValue! : nop;

  state.writeCbValue = null;
  state.flags &= ~(kWriting | kExpectWriteCb | kWriteCb);
  state.length -= state.writelen;
  state.writelen = 0;

  if (er) {
    // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
    er.stack; // eslint-disable-line no-unused-expressions

    if ((state.flags & kErrored) === 0) {
      state.erroredValue = er;
      state.flags |= kErrored;
    }

    // In case of duplex streams we need to notify the readable side of the
    // error.
    const readableState = stream._readableState;
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
    if ((state.flags & kBuffered) !== 0) {
      clearBuffer(stream, state);
    }

    if (sync) {
      const needDrain = (state.flags & kNeedDrain) !== 0 && state.length === 0;
      // As in Node, where it is spelled `state[kState] & Number(kDestroyed !== 0)`: bit 0.
      const needTick = needDrain || (state.flags & 1) !== 0 || cb !== nop;

      // It is a common case that the callback passed to .write() is always
      // the same. In that case, we do not schedule a new nextTick(), but
      // rather just increase a counter, to improve performance and avoid
      // memory allocations.
      if (cb === nop) {
        if ((state.flags & kAfterWritePending) === 0 && needTick) {
          process.nextTick(afterWrite, stream, state, 1, cb);
          state.flags |= kAfterWritePending;
        } else {
          state.pendingcb!--;
          if ((state.flags & kEnding) !== 0) {
            finishMaybe(stream, state, true);
          }
        }
      } else if ((state.flags & kAfterWriteTickInfo) !== 0 && state.afterWriteTickInfoValue!.cb === cb) {
        state.afterWriteTickInfoValue!.count++;
      } else if (needTick) {
        const info: AfterWriteTickInfo = { count: 1, cb, stream, state };
        state.afterWriteTickInfoValue = info;
        process.nextTick(afterWriteTick, info);
        state.flags |= kAfterWritePending | kAfterWriteTickInfo;
      } else {
        state.pendingcb!--;
        if ((state.flags & kEnding) !== 0) {
          finishMaybe(stream, state, true);
        }
      }
    } else {
      afterWrite(stream, state, 1, cb);
    }
  }
}

function afterWriteTick({ stream, state, count, cb }: AfterWriteTickInfo): void {
  state.flags &= ~kAfterWriteTickInfo;
  state.afterWriteTickInfoValue = null;
  return afterWrite(stream, state, count, cb);
}

function afterWrite(stream, state: WritableState, count: number, cb: WriteCallback): void {
  state.flags &= ~kAfterWritePending;

  const needDrain = (state.flags & (kEnding | kNeedDrain | kDestroyed)) === kNeedDrain && state.length === 0;
  if (needDrain) {
    state.flags &= ~kNeedDrain;
    stream.emit("drain");
  }

  while (count-- > 0) {
    state.pendingcb!--;
    cb(null);
  }

  if ((state.flags & kDestroyed) !== 0) {
    errorBuffer(state);
  }

  if ((state.flags & kEnding) !== 0) {
    finishMaybe(stream, state, true);
  }
}

// If there's something in the buffer waiting, then invoke callbacks.
function errorBuffer(state: WritableState): void {
  if ((state.flags & kWriting) !== 0) {
    return;
  }

  if ((state.flags & kBuffered) !== 0) {
    const buffered = state.bufferedValue!;
    for (let n = state.bufferedIndex; n < buffered.length; ++n) {
      const { chunk, callback } = buffered[n]!;
      const len = (state.flags & kObjectMode) !== 0 ? 1 : (chunk.length as number);
      state.length -= len;
      callback(((state.flags & kErrored) !== 0 ? state.erroredValue : null) ?? $ERR_STREAM_DESTROYED("write"));
    }
  }

  callFinishedCallbacks(state, ((state.flags & kErrored) !== 0 ? state.erroredValue : null) ?? $ERR_STREAM_DESTROYED("end"));

  resetBuffer(state);
}

// If there's something in the buffer waiting, then process it.
function clearBuffer(stream, state: WritableState): void {
  if (
    (state.flags & (kDestroyed | kBufferProcessing | kCorked | kBuffered | kConstructed)) !==
    (kBuffered | kConstructed)
  ) {
    return;
  }

  const objectMode = (state.flags & kObjectMode) !== 0;
  const buffered = state.bufferedValue!;
  const bufferedIndex = state.bufferedIndex;
  const bufferedLength = buffered.length - bufferedIndex;

  if (!bufferedLength) {
    return;
  }

  let i = bufferedIndex;

  state.flags |= kBufferProcessing;
  if (bufferedLength > 1 && stream._writev) {
    state.pendingcb! -= bufferedLength - 1;

    const callback =
      (state.flags & kAllNoop) !== 0
        ? nop
        : err => {
            for (let n = i; n < buffered.length; ++n) {
              buffered[n]!.callback(err);
            }
          };
    // Make a copy of `buffered` if it's going to be used by `callback` above,
    // since `doWrite` will mutate the array.
    const chunks = (state.flags & kAllNoop) !== 0 && i === 0 ? buffered : ArrayPrototypeSlice.$call(buffered, i);
    (chunks as any).allBuffers = (state.flags & kAllBuffers) !== 0;

    doWrite(stream, state, true, state.length, chunks, "", callback);

    resetBuffer(state);
  } else {
    do {
      const { chunk, encoding, callback } = buffered[i]!;
      buffered[i++] = null;
      const len = objectMode ? 1 : (chunk.length as number);
      doWrite(stream, state, false, len, chunk, encoding, callback);
    } while (i < buffered.length && (state.flags & kWriting) === 0);

    if (i === buffered.length) {
      resetBuffer(state);
    } else if (i > 256) {
      buffered.splice(0, i);
      state.bufferedIndex = 0;
    } else {
      state.bufferedIndex = i;
    }
  }
  state.flags &= ~kBufferProcessing;
}

Writable.prototype._write = function (chunk, encoding, cb) {
  if (this._writev) {
    this._writev([{ chunk, encoding }], cb);
  } else {
    throw $ERR_METHOD_NOT_IMPLEMENTED("_write()");
  }
};

Writable.prototype._writev = null;

Writable.prototype.end = function (chunk, encoding, cb) {
  const state: WritableState = this._writableState;

  if (typeof chunk === "function") {
    cb = chunk;
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
  if ((state.flags & kCorked) !== 0) {
    state.corked = 1;
    this.uncork();
  }

  if (err) {
    // Do nothing...
  } else if ((state.flags & (kEnding | kErrored)) === 0) {
    // This is forgiving in terms of unnecessary calls to end() and can hide
    // logic errors. However, usually such errors are harmless and causing a
    // hard error can be disproportionately destructive. It is not always
    // trivial for the user to determine whether end() needs to be called
    // or not.

    state.flags |= kEnding;
    finishMaybe(this, state, true);
    state.flags |= kEnded;
  } else if ((state.flags & kFinished) !== 0) {
    err = $ERR_STREAM_ALREADY_FINISHED("end");
  } else if ((state.flags & kDestroyed) !== 0) {
    err = $ERR_STREAM_DESTROYED("end");
  }

  if (typeof cb === "function") {
    if (err) {
      process.nextTick(cb, err);
    } else if ((state.flags & kErrored) !== 0) {
      process.nextTick(cb, state.erroredValue);
    } else if ((state.flags & kFinished) !== 0) {
      process.nextTick(cb, null);
    } else {
      state.flags |= kOnFinished;
      (state.onFinishedValue ??= []).push(cb);
    }
  }

  return this;
};

function needFinish(state: WritableState): boolean {
  return (
    // State is ended && constructed but not destroyed, finished, writing, errorEmitted or closedEmitted
    (state.flags &
      (kEnding |
        kDestroyed |
        kConstructed |
        kFinished |
        kWriting |
        kErrorEmitted |
        kCloseEmitted |
        kErrored |
        kBuffered)) ===
      (kEnding | kConstructed) && state.length === 0
  );
}

function onFinish(stream, state: WritableState, err): void {
  if ((state.flags & kPrefinished) !== 0) {
    errorOrDestroy(stream, err ?? $ERR_MULTIPLE_CALLBACK());
    return;
  }
  state.pendingcb!--;
  if (err) {
    callFinishedCallbacks(state, err);
    errorOrDestroy(stream, err, (state.flags & kSync) !== 0);
  } else if (needFinish(state)) {
    state.flags |= kPrefinished;
    stream.emit("prefinish");
    // Backwards compat. Don't check state.sync here.
    // Some streams assume 'finish' will be emitted
    // asynchronously relative to _final callback.
    state.pendingcb!++;
    process.nextTick(finish, stream, state);
  }
}

function prefinish(stream, state: WritableState): void {
  if ((state.flags & (kPrefinished | kFinalCalled)) !== 0) {
    return;
  }

  if (typeof stream._final === "function" && (state.flags & kDestroyed) === 0) {
    state.flags |= kFinalCalled | kSync;
    state.pendingcb!++;

    try {
      stream._final(err => onFinish(stream, state, err));
    } catch (err) {
      onFinish(stream, state, err);
    }

    state.flags &= ~kSync;
  } else {
    state.flags |= kFinalCalled | kPrefinished;
    stream.emit("prefinish");
  }
}

function finishMaybe(stream, state: WritableState, sync: boolean): void {
  if (needFinish(state)) {
    prefinish(stream, state);
    if (state.pendingcb === 0) {
      if (sync) {
        state.pendingcb!++;
        process.nextTick(
          (stream, state: WritableState) => {
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

function finish(stream, state: WritableState): void {
  state.pendingcb!--;
  state.flags |= kFinished;

  callFinishedCallbacks(state, null);

  stream.emit("finish");

  if ((state.flags & kAutoDestroy) !== 0) {
    // In case of duplex streams we need a way to detect
    // if the readable side is ready for autoDestroy as well.
    const rState = stream._readableState;
    const autoDestroy = isReadableState(rState)
      ? rState.autoDestroy && (rState.endEmitted || rState.readable === false)
      : !rState ||
        (rState.autoDestroy &&
          // We don't expect the readable to ever 'end'
          // if readable is explicitly set to false.
          (rState.endEmitted || rState.readable === false));
    if (autoDestroy) {
      stream.destroy();
    }
  }
}

function callFinishedCallbacks(state: WritableState, err): void {
  if ((state.flags & kOnFinished) === 0) {
    return;
  }

  const onfinishCallbacks = state.onFinishedValue!;
  state.onFinishedValue = null;
  state.flags &= ~kOnFinished;
  for (let i = 0; i < onfinishCallbacks.length; i++) {
    onfinishCallbacks[i](err);
  }
}

ObjectDefineProperties(Writable.prototype, {
  closed: {
    __proto__: null,
    get() {
      const state = this._writableState;
      return state ? (flagsOf(state) & kClosed) !== 0 : false;
    },
  },

  destroyed: {
    __proto__: null,
    get() {
      const state = this._writableState;
      return state ? (flagsOf(state) & kDestroyed) !== 0 : false;
    },
    set(value) {
      // Backward compatibility, the user is explicitly managing destroyed.
      const state = this._writableState;
      if (!state) return;

      if (value) addFlags(state, kDestroyed);
      else removeFlags(state, kDestroyed);
    },
  },

  writable: {
    __proto__: null,
    get() {
      const w = this._writableState;
      // w.writable === false means that this is part of a Duplex stream
      // where the writable side was disabled upon construction.
      // Compat. The user might manually disable writable side through
      // deprecated setter.
      if (isWritableState(w)) {
        return (
          (w.flags & (kHasWritable | kWritable)) !== kHasWritable &&
          (w.flags & (kEnding | kEnded | kDestroyed | kErrored)) === 0
        );
      }
      return !!w && w.writable !== false && (flagsOf(w) & (kEnding | kEnded | kDestroyed | kErrored)) === 0;
    },
    set(val) {
      // Backwards compatible.
      const state = this._writableState;
      if (isWritableState(state)) {
        state.writable = !!val;
      } else if (state) {
        state.writable = !!val;
      }
    },
  },

  writableFinished: {
    __proto__: null,
    get() {
      const state = this._writableState;
      return state ? (flagsOf(state) & kFinished) !== 0 : false;
    },
  },

  writableObjectMode: {
    __proto__: null,
    get() {
      const state = this._writableState;
      return state ? (flagsOf(state) & kObjectMode) !== 0 : false;
    },
  },

  writableBuffer: {
    __proto__: null,
    get() {
      const state = this._writableState;
      return isWritableState(state) ? state.getBuffer() : state && state.getBuffer();
    },
  },

  writableEnded: {
    __proto__: null,
    get() {
      const state = this._writableState;
      return state ? (flagsOf(state) & kEnding) !== 0 : false;
    },
  },

  writableNeedDrain: {
    __proto__: null,
    get() {
      const state = this._writableState;
      return state ? (flagsOf(state) & (kDestroyed | kEnding | kNeedDrain)) === kNeedDrain : false;
    },
  },

  writableHighWaterMark: {
    __proto__: null,
    get() {
      const state = this._writableState;
      return isWritableState(state) ? state.highWaterMark : state?.highWaterMark;
    },
  },

  writableCorked: {
    __proto__: null,
    get() {
      const state = this._writableState;
      return isWritableState(state) ? state.corked : state ? state.corked : 0;
    },
  },

  writableLength: {
    __proto__: null,
    get() {
      const state = this._writableState;
      return isWritableState(state) ? state.length : state?.length;
    },
  },

  errored: {
    __proto__: null,
    enumerable: false,
    get() {
      const state = this._writableState;
      return isWritableState(state) ? state.errored : state ? state.errored : null;
    },
  },

  writableAborted: {
    __proto__: null,
    get: function () {
      const state = this._writableState;
      const flags = flagsOf(state);
      return (
        (flags & (kHasWritable | kWritable)) !== kHasWritable &&
        (flags & (kDestroyed | kErrored)) !== 0 &&
        (flags & kFinished) === 0
      );
    },
  },
});

const destroy = destroyImpl.destroy;
Writable.prototype.destroy = function (err, cb) {
  const state: WritableState = this._writableState;

  // Invoke pending callbacks.
  if ((state.flags & (kBuffered | kOnFinished)) !== 0 && (state.flags & kDestroyed) === 0) {
    process.nextTick(errorBuffer, state);
  }

  destroy.$call(this, err, cb);
  return this;
};

Writable.prototype._undestroy = destroyImpl.undestroy;
Writable.prototype._destroy = function (err, cb) {
  cb(err);
};

Writable.prototype[EE.captureRejectionSymbol] = function (err) {
  this.destroy(err);
};

// Lazy to avoid circular references
let webStreamsAdapters;
function lazyWebStreams() {
  if (webStreamsAdapters === undefined) webStreamsAdapters = require("internal/webstreams_adapters");
  return webStreamsAdapters;
}

Writable.fromWeb = function (writableStream, options) {
  return lazyWebStreams().newStreamWritableFromWritableStream(writableStream, options);
};

Writable.toWeb = function (streamWritable) {
  return lazyWebStreams().newWritableStreamFromStreamWritable(streamWritable);
};

Writable.prototype[SymbolAsyncDispose] = function () {
  let error;
  if (!this.destroyed) {
    error = this.writableFinished ? null : $makeAbortError();
    this.destroy(error);
  }
  return new Promise((resolve, reject) =>
    eos(this, err => (err && err.name !== "AbortError" ? reject(err) : resolve(null))),
  );
};

export default Writable as unknown as typeof import("node:stream").Writable & {
  WritableState: typeof WritableState;
};
