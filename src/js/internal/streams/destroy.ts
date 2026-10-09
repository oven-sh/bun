"use strict";

const { aggregateTwoErrors } = require("internal/errors");
const { kIsDestroyed, isDestroyed, isFinished, isServerRequest } = require("internal/streams/utils");
const { isReadableState, isWritableState, flagsOf, addFlags } =
  require("internal/streams/state") as typeof import("internal/streams/state").default;
type ReadableState = import("internal/streams/state").ReadableState;
type WritableState = import("internal/streams/state").WritableState;

const kErrorEmitted = 1 << 1;
const kAutoDestroy = 1 << 2;
const kEmitClose = 1 << 3;
const kDestroyed = 1 << 4;
const kClosed = 1 << 5;
const kCloseEmitted = 1 << 6;
const kErrored = 1 << 7;
const kConstructed = 1 << 8;

const ProcessNextTick = process.nextTick;

const kDestroy = Symbol("kDestroy");
const kConstruct = Symbol("kConstruct");

function checkError(err, w: WritableState | undefined, r: ReadableState | undefined): void {
  if (err) {
    // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
    err.stack; // eslint-disable-line no-unused-expressions

    if (w && (w.flags & kErrored) === 0) {
      w.erroredValue = err;
      w.flags |= kErrored;
    }
    if (r && (r.flags & kErrored) === 0) {
      r.erroredValue = err;
      r.flags |= kErrored;
    }
  }
}

// Backwards compat. cb() is undocumented and unused in core but
// unfortunately might be used by modules.
function destroy(err, cb) {
  const r: ReadableState | undefined = this._readableState;
  const w: WritableState | undefined = this._writableState;
  // With duplex streams we use the writable side for state.
  const s = (w || r)!;

  if ((w && (w.flags & kDestroyed) !== 0) || (r && (r.flags & kDestroyed) !== 0)) {
    if (typeof cb === "function") {
      cb();
    }

    return this;
  }

  // We set destroyed to true before firing error callbacks in order
  // to make it re-entrance safe in case destroy() is called within callbacks
  checkError(err, w, r);

  if (w) {
    w.flags |= kDestroyed;
  }
  if (r) {
    r.flags |= kDestroyed;
  }

  // If still constructing then defer calling _destroy.
  if ((s.flags & kConstructed) === 0) {
    this.once(kDestroy, function (er) {
      _destroy(this, aggregateTwoErrors(er, err), cb);
    });
  } else {
    _destroy(this, err, cb);
  }

  return this;
}

function _destroy(self, err, cb) {
  let called = false;

  function onDestroy(err) {
    if (called) {
      return;
    }
    called = true;

    const r: ReadableState | undefined = self._readableState;
    const w: WritableState | undefined = self._writableState;

    checkError(err, w, r);

    if (w) {
      w.flags |= kClosed;
    }
    if (r) {
      r.flags |= kClosed;
    }

    if (typeof cb === "function") {
      cb(err);
    }

    if (err) {
      ProcessNextTick(emitErrorCloseNT, self, err);
    } else {
      ProcessNextTick(emitCloseNT, self);
    }
  }
  try {
    self._destroy(err || null, onDestroy);
  } catch (err) {
    onDestroy(err);
  }
}

function emitErrorCloseNT(self, err) {
  emitErrorNT(self, err);
  emitCloseNT(self);
}

function emitCloseNT(self) {
  const r: ReadableState | undefined = self._readableState;
  const w: WritableState | undefined = self._writableState;

  if (w) {
    w.flags |= kCloseEmitted;
  }
  if (r) {
    r.flags |= kCloseEmitted;
  }

  if ((w && (w.flags & kEmitClose) !== 0) || (r && (r.flags & kEmitClose) !== 0)) {
    self.emit("close");
  }
}

function emitErrorNT(self, err) {
  const r = self._readableState;
  const w = self._writableState;

  if ((r === undefined || isReadableState(r)) && (w === undefined || isWritableState(w))) {
    if ((w && (w.flags & kErrorEmitted) !== 0) || (r && (r.flags & kErrorEmitted) !== 0)) {
      return;
    }

    if (w) {
      w.flags |= kErrorEmitted;
    }
    if (r) {
      r.flags |= kErrorEmitted;
    }

    self.emit("error", err);
    return;
  }

  if ((w && (flagsOf(w) & kErrorEmitted) !== 0) || (r && (flagsOf(r) & kErrorEmitted) !== 0)) {
    return;
  }

  if (w) {
    addFlags(w, kErrorEmitted);
  }
  if (r) {
    addFlags(r, kErrorEmitted);
  }

  self.emit("error", err);
}

function undestroy() {
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

function errorOrDestroy(stream, err, sync?) {
  // We have tests that rely on errors being emitted
  // in the same tick, so changing this is semver major.
  // For now when you opt-in to autoDestroy we allow
  // the error to be emitted nextTick. In a future
  // semver major update we should change the default to this.

  const r = stream._readableState;
  const w = stream._writableState;

  if ((r === undefined || isReadableState(r)) && (w === undefined || isWritableState(w))) {
    if ((w && (w.flags & kDestroyed) !== 0) || (r && (r.flags & kDestroyed) !== 0)) {
      return;
    }

    if ((r && (r.flags & kAutoDestroy) !== 0) || (w && (w.flags & kAutoDestroy) !== 0)) {
      stream.destroy(err);
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
    (w && (flagsOf(w) ? (flagsOf(w) & kDestroyed) !== 0 : w.destroyed)) ||
    (r && (flagsOf(r) ? (flagsOf(r) & kDestroyed) !== 0 : r.destroyed))
  ) {
    return;
  }

  if ((r && (flagsOf(r) & kAutoDestroy) !== 0) || (w && (flagsOf(w) & kAutoDestroy) !== 0)) {
    stream.destroy(err);
  } else if (err) {
    // Avoid V8 leak, https://github.com/nodejs/node/pull/34103#issuecomment-652002364
    err.stack; // eslint-disable-line no-unused-expressions

    if (w && (flagsOf(w) & kErrored) === 0) {
      w.errored = err;
    }
    if (r && (flagsOf(r) & kErrored) === 0) {
      r.errored = err;
    }
    if (sync) {
      ProcessNextTick(emitErrorNT, stream, err);
    } else {
      emitErrorNT(stream, err);
    }
  }
}

function construct(stream, cb) {
  if (typeof stream._construct !== "function") {
    return;
  }

  const r: ReadableState | undefined = stream._readableState;
  const w: WritableState | undefined = stream._writableState;

  if (r) {
    r.flags &= ~kConstructed;
  }
  if (w) {
    w.flags &= ~kConstructed;
  }

  stream.once(kConstruct, cb);

  if (stream.listenerCount(kConstruct) > 1) {
    // Duplex
    return;
  }

  ProcessNextTick(constructNT, stream);
}

function constructNT(stream) {
  let called = false;

  function onConstruct(err) {
    if (called) {
      errorOrDestroy(stream, err ?? $ERR_MULTIPLE_CALLBACK());
      return;
    }
    called = true;

    const r: ReadableState | undefined = stream._readableState;
    const w: WritableState | undefined = stream._writableState;
    const s = (w || r)!;

    if (r) {
      r.flags |= kConstructed;
    }
    if (w) {
      w.flags |= kConstructed;
    }

    if ((s.flags & kDestroyed) !== 0) {
      stream.emit(kDestroy, err);
    } else if (err) {
      errorOrDestroy(stream, err, true);
    } else {
      stream.emit(kConstruct);
    }
  }

  try {
    stream._construct(err => {
      ProcessNextTick(onConstruct, err);
    });
  } catch (err) {
    ProcessNextTick(onConstruct, err);
  }
}

function isRequest(stream) {
  return stream?.setHeader && typeof stream.abort === "function";
}

function emitCloseLegacy(stream) {
  stream.emit("close");
}

function emitErrorCloseLegacy(stream, err) {
  stream.emit("error", err);
  ProcessNextTick(emitCloseLegacy, stream);
}

// Normalize destroy for legacy.
function destroyer(stream, err) {
  if (!stream || isDestroyed(stream)) {
    return;
  }

  if (!err && !isFinished(stream)) {
    err = $makeAbortError();
  }

  // TODO: Remove isRequest branches.
  if (isServerRequest(stream)) {
    stream.socket = null;
    stream.destroy(err);
  } else if (isRequest(stream)) {
    stream.abort();
  } else {
    const req = stream.req;
    if (isRequest(req)) {
      req.abort();
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
