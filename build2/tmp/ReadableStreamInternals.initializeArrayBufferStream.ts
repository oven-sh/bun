// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(underlyingSource,highWaterMark) {  // This is the fallback implementation for direct streams
  // When we don't know what the destination type is
  // We assume it is a Uint8Array.

  var opts =
    highWaterMark && typeof highWaterMark === "number"
      ? { highWaterMark, stream: true, asUint8Array: true }
      : { stream: true, asUint8Array: true };
  var sink = new Bun.ArrayBufferSink();
  sink.start(opts);

  var controller = {
    __intrinsic__underlyingSource: underlyingSource,
    __intrinsic__pull: __intrinsic__onPullDirectStream,
    __intrinsic__controlledReadableStream: this,
    __intrinsic__sink: sink,
    close: __intrinsic__onCloseDirectStream,
    write: sink.write.bind(sink),
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
}).$$capture_end$$;
