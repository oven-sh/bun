// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(reason) {  var stream = this.__intrinsic__controlledReadableStream;
  if (!stream || __intrinsic__getByIdDirectPrivate(stream, "state") !== __intrinsic__streamReadable) return;

  if (this._deferClose !== 0) {
    this._deferClose = 1;
    this._deferCloseReason = reason;
    return;
  }

  __intrinsic__putByIdDirectPrivate(stream, "state", __intrinsic__streamClosing);
  if (typeof this.__intrinsic__underlyingSource.close === "function") {
    try {
      this.__intrinsic__underlyingSource.close.__intrinsic__call(this.__intrinsic__underlyingSource, reason);
    } catch (e) {}
  }

  var flushed;
  try {
    flushed = this.__intrinsic__sink.end();
    __intrinsic__putByIdDirectPrivate(this, "sink", undefined);
  } catch (e) {
    if (this._pendingRead) {
      var read = this._pendingRead;
      this._pendingRead = undefined;
      __intrinsic__rejectPromise(read, e);
    }
    __intrinsic__readableStreamError(stream, e);
    return;
  }

  this.error = this.flush = this.write = this.close = this.end = __intrinsic__onReadableStreamDirectControllerClosed;

  var reader = __intrinsic__getByIdDirectPrivate(stream, "reader");

  if (reader && __intrinsic__isReadableStreamDefaultReader(reader)) {
    var _pendingRead = this._pendingRead;
    if (_pendingRead && __intrinsic__isPromise(_pendingRead) && flushed?.byteLength) {
      this._pendingRead = undefined;
      __intrinsic__fulfillPromise(_pendingRead, { value: flushed, done: false });
      __intrinsic__readableStreamClose(stream);
      return;
    }
  }

  if (flushed?.byteLength) {
    var requests = __intrinsic__getByIdDirectPrivate(reader, "readRequests");
    if (requests?.isNotEmpty()) {
      __intrinsic__readableStreamFulfillReadRequest(stream, flushed, false);
      __intrinsic__readableStreamClose(stream);
      return;
    }

    __intrinsic__putByIdDirectPrivate(stream, "state", __intrinsic__streamReadable);
    this.__intrinsic__pull = () => {
      var thisResult = __intrinsic__createFulfilledPromise({
        value: flushed,
        done: false,
      });
      flushed = undefined;
      __intrinsic__readableStreamClose(stream);
      stream = undefined;
      return thisResult;
    };
  } else if (this._pendingRead) {
    var read = this._pendingRead;
    this._pendingRead = undefined;
    __intrinsic__putByIdDirectPrivate(this, "pull", __intrinsic__noopDoneFunction);
    __intrinsic__fulfillPromise(read, { value: undefined, done: true });
  }

  __intrinsic__readableStreamClose(stream);
}).$$capture_end$$;
