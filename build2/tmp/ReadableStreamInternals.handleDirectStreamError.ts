// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(e) {  var controller = this;
  var sink = controller.__intrinsic__sink;
  if (sink) {
    __intrinsic__putByIdDirectPrivate(controller, "sink", undefined);
    try {
      sink.close(e);
    } catch (f) {}
  }

  this.error = this.flush = this.write = this.close = this.end = __intrinsic__onReadableStreamDirectControllerClosed;

  if (typeof this.__intrinsic__underlyingSource.close === "function") {
    try {
      this.__intrinsic__underlyingSource.close.__intrinsic__call(this.__intrinsic__underlyingSource, e);
    } catch (e) {}
  }

  try {
    var pend = controller._pendingRead;
    if (pend) {
      controller._pendingRead = undefined;
      __intrinsic__rejectPromise(pend, e);
    }
  } catch (f) {}
  var stream = controller.__intrinsic__controlledReadableStream;
  if (stream) __intrinsic__readableStreamError(stream, e);
}).$$capture_end$$;
