// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,chunk,chunkSize) {  try {
    __intrinsic__enqueueValueWithSize(__intrinsic__getByIdDirectPrivate(controller, "queue"), chunk, chunkSize);

    const stream = __intrinsic__getByIdDirectPrivate(controller, "stream");

    const state = __intrinsic__getByIdDirectPrivate(stream, "state");
    if (!__intrinsic__writableStreamCloseQueuedOrInFlight(stream) && state === "writable") {
      const backpressure = __intrinsic__writableStreamDefaultControllerGetBackpressure(controller);
      __intrinsic__writableStreamUpdateBackpressure(stream, backpressure);
    }
    __intrinsic__writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
  } catch (e) {
    __intrinsic__writableStreamDefaultControllerErrorIfNeeded(controller, e);
  }
}).$$capture_end$$;
