// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(underlyingSource,highWaterMark) {  var [sink, closingPromise] = __intrinsic__createTextStream(highWaterMark);

  var controller = {
    __intrinsic__underlyingSource: underlyingSource,
    __intrinsic__pull: __intrinsic__onPullDirectStream,
    __intrinsic__controlledReadableStream: this,
    __intrinsic__sink: sink,
    close: __intrinsic__onCloseDirectStream,
    write: sink.write,
    error: __intrinsic__handleDirectStreamError,
    end: __intrinsic__onCloseDirectStream,
    __intrinsic__close: __intrinsic__onCloseDirectStream,
    flush: __intrinsic__onFlushDirectStream,
    _pendingRead: undefined,
    _deferClose: 0,
    _deferFlush: 0,
    _deferCloseReason: undefined,
    _handleError: undefined,
  };

  __intrinsic__putByIdDirectPrivate(this, "readableStreamController", controller);
  __intrinsic__putByIdDirectPrivate(this, "underlyingSource", undefined);
  __intrinsic__putByIdDirectPrivate(this, "start", undefined);
  return closingPromise;
}).$$capture_end$$;
