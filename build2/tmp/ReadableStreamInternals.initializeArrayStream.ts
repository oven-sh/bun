// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(underlyingSource,highWaterMark) {  var array = [];
  var closingPromise = __intrinsic__newPromiseCapability(Promise);
  var calledDone = false;

  function fulfill() {
    calledDone = true;
    closingPromise.resolve.__intrinsic__call(undefined, array);
    return array;
  }

  var sink = {
    start() {},
    write(chunk) {
      __intrinsic__arrayPush(array, chunk);
      return chunk.byteLength || chunk.length;
    },

    flush() {
      return 0;
    },

    end() {
      if (calledDone) {
        return [];
      }
      return fulfill();
    },

    close() {
      if (!calledDone) {
        fulfill();
      }
    },
  };

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
