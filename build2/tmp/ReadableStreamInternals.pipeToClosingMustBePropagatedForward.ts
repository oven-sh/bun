// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(pipeState) {  const action = () => {
    pipeState.pendingReadPromiseCapability.resolve.__intrinsic__call(undefined, false);
    // const error = $getByIdDirectPrivate(pipeState.source, "storedError");
    if (!pipeState.preventClose) {
      __intrinsic__pipeToShutdownWithAction(pipeState, () =>
        __intrinsic__writableStreamDefaultWriterCloseWithErrorPropagation(pipeState.writer),
      );
      return;
    }
    __intrinsic__pipeToShutdown(pipeState);
  };
  if (__intrinsic__getByIdDirectPrivate(pipeState.source, "state") === __intrinsic__streamClosed) {
    action();
    return;
  }
  __intrinsic__getByIdDirectPrivate(pipeState.reader, "closedPromiseCapability").promise.__intrinsic__then(action, undefined);
}).$$capture_end$$;
