// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,chunk) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "stream");

  __intrinsic__writableStreamMarkFirstWriteRequestInFlight(stream);

  const sinkWritePromise = __intrinsic__getByIdDirectPrivate(controller, "writeAlgorithm").__intrinsic__call(undefined, chunk);

  sinkWritePromise.__intrinsic__then(
    () => {
      __intrinsic__writableStreamFinishInFlightWrite(stream);
      const state = __intrinsic__getByIdDirectPrivate(stream, "state");
      (IS_BUN_DEVELOPMENT?$assert(state === "writable" || state === "erroring","state === \"writable\" || state === \"erroring\""):void 0);

      __intrinsic__dequeueValue(__intrinsic__getByIdDirectPrivate(controller, "queue"));
      if (!__intrinsic__writableStreamCloseQueuedOrInFlight(stream) && state === "writable") {
        const backpressure = __intrinsic__writableStreamDefaultControllerGetBackpressure(controller);
        __intrinsic__writableStreamUpdateBackpressure(stream, backpressure);
      }
      __intrinsic__writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    reason => {
      const state = __intrinsic__getByIdDirectPrivate(stream, "state");
      if (state === "writable") __intrinsic__writableStreamDefaultControllerClearAlgorithms(controller);

      __intrinsic__writableStreamFinishInFlightWriteWithError(stream, reason);
    },
  );
}).$$capture_end$$;
