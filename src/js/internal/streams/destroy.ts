"use strict";

const { aggregateTwoErrors } = require("internal/errors");
const streamUtils = require("internal/streams/utils");
const { isDestroyed, isFinished, isServerRequest } = streamUtils;
const kIsDestroyed: typeof streamUtils.kIsDestroyed = streamUtils.kIsDestroyed;
const streamState = require("internal/streams/state");
const { isReadableState, isWritableState, flagsOf, addFlags } = streamState;
const kState: typeof streamState.kState = streamState.kState;
const kErroredValue: typeof streamState.kErroredValue = streamState.kErroredValue;
type ReadableState = $Node.ReadableState;
type WritableState = $Node.WritableState;

// The bits of [kState] that mean the same in a ReadableState and in a WritableState.
const enum Flag {
  ErrorEmitted = 1 << 1,
  AutoDestroy = 1 << 2,
  EmitClose = 1 << 3,
  Destroyed = 1 << 4,
  Closed = 1 << 5,
  CloseEmitted = 1 << 6,
  Errored = 1 << 7,
  Constructed = 1 << 8,
}

const { nextTick: originalNextTick, enqueueTick1 } = require("internal/process/next_tick_queue");
const ProcessNextTick = process.nextTick;

const kDestroy = Symbol("kDestroy");
const kConstruct = Symbol("kConstruct");

declare global {
  namespace $Node {
    type ErrorCallback = (error?: Error | null) => void;

    interface StreamOptions extends EventEmitterOptions {
      highWaterMark?: number | null;
      objectMode?: boolean;
      emitClose?: boolean;
      autoDestroy?: boolean;
      defaultEncoding?: string | null;
      signal?: AbortSignal;
      destroy?(this: StreamWithState, error: Error | null, callback: ErrorCallback): void;
      construct?(this: StreamWithState, callback: ErrorCallback): void;
    }

    /** What `Readable`, `Writable` and `Duplex` share. A stream has one of the two states or both. */
    interface StreamWithState extends Stream {
      _readableState?: ReadableState;
      _writableState?: WritableState;
      /** `undefined` on a stream that does not have that side. */
      readable?: boolean;
      writable?: boolean;
      allowHalfOpen?: boolean;
      destroy(error?: Error | null, callback?: ErrorCallback): this;
      _destroy(error: Error | null, callback: ErrorCallback): void;
      _undestroy(): void;
      _construct?(callback: ErrorCallback): void;
      get destroyed(): boolean;
      set destroyed(value: boolean);
      get closed(): boolean;
      get errored(): Error | null;
      [Symbol.asyncDispose](): Promise<void>;
    }
  }
}

function checkError(err: Error | null | undefined, w: WritableState | undefined, r: ReadableState | undefined): void {
  if (err) {
    ("unlikely");
    // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
    err.stack; // oxlint-disable-line bun/no-unused-expressions

    if (w && (w[kState] & Flag.Errored) === 0) {
      w[kErroredValue] = err;
      w[kState] |= Flag.Errored;
    }
    if (r && (r[kState] & Flag.Errored) === 0) {
      r[kErroredValue] = err;
      r[kState] |= Flag.Errored;
    }
  }
}

// Backwards compat. cb() is undocumented and unused in core but
// unfortunately might be used by modules.
const destroy = function destroy(this: $Node.StreamWithState, err?: Error | null, cb?: $Node.ErrorCallback) {
  const r: ReadableState | undefined = this._readableState;
  const w: WritableState | undefined = this._writableState;
  // With duplex streams we use the writable side for state.
  const s = (w || r)!;

  if ((w && (w[kState] & Flag.Destroyed) !== 0) || (r && (r[kState] & Flag.Destroyed) !== 0)) {
    if (typeof cb === "function") {
      cb();
    }

    return this;
  }

  // We set destroyed to true before firing error callbacks in order
  // to make it re-entrance safe in case destroy() is called within callbacks
  checkError(err, w, r);

  if (w) {
    w[kState] |= Flag.Destroyed;
  }
  if (r) {
    r[kState] |= Flag.Destroyed;
  }

  // If still constructing then defer calling _destroy.
  if ((s[kState] & Flag.Constructed) === 0) {
    ("unlikely");
    this.once(kDestroy, function (this: $Node.StreamWithState, er: Error | null | undefined) {
      _destroy(this, aggregateTwoErrors(er!, err!), cb);
    });
  } else {
    _destroy(this, err, cb);
  }

  return this;
};

streamState.internals.destroyMethods = { destroy };

function _destroy(self: $Node.StreamWithState, err: Error | null | undefined, cb: $Node.ErrorCallback | undefined) {
  let called = false;

  function onDestroy(err?: Error | null) {
    if (called) {
      return;
    }
    called = true;

    const r: ReadableState | undefined = self._readableState;
    const w: WritableState | undefined = self._writableState;

    checkError(err, w, r);

    if (w) {
      w[kState] |= Flag.Closed;
    }
    if (r) {
      r[kState] |= Flag.Closed;
    }

    if (typeof cb === "function") {
      cb(err);
    }

    if (err) {
      ("unlikely");
      ProcessNextTick(emitErrorCloseNT, self, err);
    } else {
      if (ProcessNextTick === originalNextTick) enqueueTick1(emitCloseNT, self);
      else {
        ("unlikely");
        ProcessNextTick(emitCloseNT, self);
      }
    }
  }
  try {
    self._destroy(err || null, onDestroy);
  } catch (err) {
    onDestroy(err as Error);
  }
}

function emitErrorCloseNT(self: $Node.StreamWithState, err: Error) {
  emitErrorNT(self, err);
  emitCloseNT(self);
}

function emitCloseNT(self: $Node.StreamWithState) {
  const r: ReadableState | undefined = self._readableState;
  const w: WritableState | undefined = self._writableState;

  if (w) {
    w[kState] |= Flag.CloseEmitted;
  }
  if (r) {
    r[kState] |= Flag.CloseEmitted;
  }

  if ((w && (w[kState] & Flag.EmitClose) !== 0) || (r && (r[kState] & Flag.EmitClose) !== 0)) {
    self.emit("close");
  }
}

function emitErrorNT(self: $Node.AnyStream, err: Error) {
  const r = self._readableState;
  const w = self._writableState;

  if ((r === undefined || isReadableState(r)) && (w === undefined || isWritableState(w))) {
    if ((w && (w[kState] & Flag.ErrorEmitted) !== 0) || (r && (r[kState] & Flag.ErrorEmitted) !== 0)) {
      return;
    }

    if (w) {
      w[kState] |= Flag.ErrorEmitted;
    }
    if (r) {
      r[kState] |= Flag.ErrorEmitted;
    }

    self.emit("error", err);
    return;
  }

  if ((w && (flagsOf(w) & Flag.ErrorEmitted) !== 0) || (r && (flagsOf(r) & Flag.ErrorEmitted) !== 0)) {
    return;
  }

  if (w) {
    addFlags(w, Flag.ErrorEmitted);
  }
  if (r) {
    addFlags(r, Flag.ErrorEmitted);
  }

  self.emit("error", err);
}

function undestroy(this: $Node.StreamWithState) {
  const r: ReadableState | undefined = this._readableState;
  const w: WritableState | undefined = this._writableState;

  if (r) {
    r.constructed = true;
    r.closed = false;
    r.closeEmitted = false;
    r.destroyed = false;
    r.errored = null;
    r.errorEmitted = false;
    r.reading = false;
    r.ended = r.readable === false;
    r.endEmitted = r.readable === false;
  }

  if (w) {
    w.constructed = true;
    w.destroyed = false;
    w.closed = false;
    w.closeEmitted = false;
    w.errored = null;
    w.errorEmitted = false;
    w.finalCalled = false;
    w.prefinished = false;
    w.ended = w.writable === false;
    w.ending = w.writable === false;
    w.finished = w.writable === false;
  }
}

function errorOrDestroy(stream: $Node.AnyStream, err: Error | null | undefined, sync?: boolean) {
  // We have tests that rely on errors being emitted
  // in the same tick, so changing this is semver major.
  // For now when you opt-in to autoDestroy we allow
  // the error to be emitted nextTick. In a future
  // semver major update we should change the default to this.

  const r = stream._readableState;
  const w = stream._writableState;

  if ((r === undefined || isReadableState(r)) && (w === undefined || isWritableState(w))) {
    if ((w && (w[kState] & Flag.Destroyed) !== 0) || (r && (r[kState] & Flag.Destroyed) !== 0)) {
      return;
    }

    if ((r && (r[kState] & Flag.AutoDestroy) !== 0) || (w && (w[kState] & Flag.AutoDestroy) !== 0)) {
      stream.destroy!(err);
    } else if (err) {
      checkError(err, w, r);
      if (sync) {
        ProcessNextTick(emitErrorNT, stream, err);
      } else {
        emitErrorNT(stream, err);
      }
    }
    return;
  }

  if (
    (w && (flagsOf(w) ? (flagsOf(w) & Flag.Destroyed) !== 0 : w.destroyed)) ||
    (r && (flagsOf(r) ? (flagsOf(r) & Flag.Destroyed) !== 0 : r.destroyed))
  ) {
    return;
  }

  if ((r && (flagsOf(r) & Flag.AutoDestroy) !== 0) || (w && (flagsOf(w) & Flag.AutoDestroy) !== 0)) {
    stream.destroy!(err);
  } else if (err) {
    // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
    err.stack; // oxlint-disable-line bun/no-unused-expressions

    if (w && (flagsOf(w) & Flag.Errored) === 0) {
      w.errored = err;
    }
    if (r && (flagsOf(r) & Flag.Errored) === 0) {
      r.errored = err;
    }
    if (sync) {
      ProcessNextTick(emitErrorNT, stream, err);
    } else {
      emitErrorNT(stream, err);
    }
  }
}

function construct(stream: $Node.StreamWithState, cb: () => void) {
  if (typeof stream._construct !== "function") {
    return;
  }

  const r: ReadableState | undefined = stream._readableState;
  const w: WritableState | undefined = stream._writableState;

  if (r) {
    r[kState] &= ~Flag.Constructed;
  }
  if (w) {
    w[kState] &= ~Flag.Constructed;
  }

  stream.once(kConstruct, cb);

  if (stream.listenerCount(kConstruct) > 1) {
    // Duplex
    return;
  }

  ProcessNextTick(constructNT, stream);
}

function constructNT(stream: $Node.StreamWithState) {
  let called = false;

  function onConstruct(err?: Error | null) {
    if (called) {
      errorOrDestroy(stream, err ?? $ERR_MULTIPLE_CALLBACK());
      return;
    }
    called = true;

    const r: ReadableState | undefined = stream._readableState;
    const w: WritableState | undefined = stream._writableState;
    const s = (w || r)!;

    if (r) {
      r[kState] |= Flag.Constructed;
    }
    if (w) {
      w[kState] |= Flag.Constructed;
    }

    if ((s[kState] & Flag.Destroyed) !== 0) {
      stream.emit(kDestroy, err);
    } else if (err) {
      errorOrDestroy(stream, err, true);
    } else {
      stream.emit(kConstruct);
    }
  }

  try {
    stream._construct!(err => {
      ProcessNextTick(onConstruct, err);
    });
  } catch (err) {
    ProcessNextTick(onConstruct, err);
  }
}

function isRequest(stream: $Node.AnyStream | null | undefined) {
  return stream?.setHeader && typeof stream.abort === "function";
}

function emitCloseLegacy(stream: $Node.EventEmitter) {
  stream.emit("close");
}

function emitErrorCloseLegacy(stream: $Node.EventEmitter, err: Error) {
  stream.emit("error", err);
  ProcessNextTick(emitCloseLegacy, stream);
}

// Normalize destroy for legacy.
function destroyer(stream: $Node.AnyStream | null | undefined, err?: Error | null) {
  if (!stream || isDestroyed(stream)) {
    return;
  }

  if (!err && !isFinished(stream)) {
    err = $makeAbortError();
  }

  // TODO: Remove isRequest branches.
  if (isServerRequest(stream)) {
    stream.socket = null;
    stream.destroy!(err);
  } else if (isRequest(stream)) {
    stream.abort!();
  } else {
    const req = stream.req;
    if (isRequest(req)) {
      req!.abort!();
    } else if (typeof stream.destroy === "function") {
      stream.destroy(err);
    } else if (typeof stream.close === "function") {
      // TODO: Don't lose err?
      stream.close();
    } else if (err) {
      ProcessNextTick(emitErrorCloseLegacy, stream, err);
    } else {
      ProcessNextTick(emitCloseLegacy, stream);
    }
  }

  if (!stream.destroyed) {
    stream[kIsDestroyed] = true;
  }
}

export default {
  construct,
  destroyer,
  destroy,
  undestroy,
  errorOrDestroy,
};
