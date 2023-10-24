// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(pipeState) {  const action = () => {
    const error = __intrinsic__getByIdDirectPrivate(pipeState.destination, "storedError");
    if (!pipeState.preventCancel) {
      __intrinsic__pipeToShutdownWithAction(pipeState, () => __intrinsic__readableStreamCancel(pipeState.source, error), error);
      return;
    }
    __intrinsic__pipeToShutdown(pipeState, error);
  };
  if (__intrinsic__getByIdDirectPrivate(pipeState.destination, "state") === "errored") {
    action();
    return;
  }
  __intrinsic__getByIdDirectPrivate(pipeState.writer, "closedPromise").promise.__intrinsic__then(undefined, action);
}).$$capture_end$$;
