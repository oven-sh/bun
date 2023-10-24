// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(pipeState) {  const action = () => {
    pipeState.pendingReadPromiseCapability.resolve.__intrinsic__call(undefined, false);
    const error = __intrinsic__getByIdDirectPrivate(pipeState.source, "storedError");
    if (!pipeState.preventAbort) {
      __intrinsic__pipeToShutdownWithAction(pipeState, () => __intrinsic__writableStreamAbort(pipeState.destination, error), error);
      return;
    }
    __intrinsic__pipeToShutdown(pipeState, error);
  };

  if (__intrinsic__getByIdDirectPrivate(pipeState.source, "state") === __intrinsic__streamErrored) {
    action();
    return;
  }

  __intrinsic__getByIdDirectPrivate(pipeState.reader, "closedPromiseCapability").promise.__intrinsic__then(undefined, action);
}).$$capture_end$$;
