// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  var stream = this.__intrinsic__controlledReadableStream;
  var reader = __intrinsic__getByIdDirectPrivate(stream, "reader");
  if (!reader || !__intrinsic__isReadableStreamDefaultReader(reader)) {
    return;
  }

  var _pendingRead = this._pendingRead;
  this._pendingRead = undefined;
  if (_pendingRead && __intrinsic__isPromise(_pendingRead)) {
    var flushed = this.__intrinsic__sink.flush();
    if (flushed?.byteLength) {
      this._pendingRead = __intrinsic__getByIdDirectPrivate(stream, "readRequests")?.shift();
      __intrinsic__fulfillPromise(_pendingRead, { value: flushed, done: false });
    } else {
      this._pendingRead = _pendingRead;
    }
  } else if (__intrinsic__getByIdDirectPrivate(stream, "readRequests")?.isNotEmpty()) {
    var flushed = this.__intrinsic__sink.flush();
    if (flushed?.byteLength) {
      __intrinsic__readableStreamFulfillReadRequest(stream, flushed, false);
    }
  } else if (this._deferFlush === -1) {
    this._deferFlush = 1;
  }
}).$$capture_end$$;
