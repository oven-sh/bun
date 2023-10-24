// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "stream");

  __intrinsic__writableStreamMarkCloseRequestInFlight(stream);
  __intrinsic__dequeueValue(__intrinsic__getByIdDirectPrivate(controller, "queue"));

  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(controller, "queue").content?.isEmpty(),"$getByIdDirectPrivate(controller, \"queue\").content?.isEmpty()"):void 0);

  const sinkClosePromise = __intrinsic__getByIdDirectPrivate(controller, "closeAlgorithm").__intrinsic__call();
  __intrinsic__writableStreamDefaultControllerClearAlgorithms(controller);

  sinkClosePromise.__intrinsic__then(
    () => {
      __intrinsic__writableStreamFinishInFlightClose(stream);
    },
    reason => {
      __intrinsic__writableStreamFinishInFlightCloseWithError(stream, reason);
    },
  );
}).$$capture_end$$;
