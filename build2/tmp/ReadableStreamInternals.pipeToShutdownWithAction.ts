// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(pipeState,action) {  if (pipeState.shuttingDown) return;

  pipeState.shuttingDown = true;

  const hasError = arguments.length > 2;
  const error = arguments[2];
  const finalize = () => {
    const promise = action();
    promise.__intrinsic__then(
      () => {
        if (hasError) __intrinsic__pipeToFinalize(pipeState, error);
        else __intrinsic__pipeToFinalize(pipeState);
      },
      e => {
        __intrinsic__pipeToFinalize(pipeState, e);
      },
    );
  };

  if (
    __intrinsic__getByIdDirectPrivate(pipeState.destination, "state") === "writable" &&
    !__intrinsic__writableStreamCloseQueuedOrInFlight(pipeState.destination)
  ) {
    pipeState.pendingReadPromiseCapability.promise.__intrinsic__then(
      () => {
        pipeState.pendingWritePromise.__intrinsic__then(finalize, finalize);
      },
      e => __intrinsic__pipeToFinalize(pipeState, e),
    );
    return;
  }

  finalize();
}).$$capture_end$$;
