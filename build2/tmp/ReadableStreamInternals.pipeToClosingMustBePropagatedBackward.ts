// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(pipeState) {  if (
    !__intrinsic__writableStreamCloseQueuedOrInFlight(pipeState.destination) &&
    __intrinsic__getByIdDirectPrivate(pipeState.destination, "state") !== "closed"
  )
    return;

  // $assert no chunks have been read/written

  const error = __intrinsic__makeTypeError("closing is propagated backward");
  if (!pipeState.preventCancel) {
    __intrinsic__pipeToShutdownWithAction(pipeState, () => __intrinsic__readableStreamCancel(pipeState.source, error), error);
    return;
  }
  __intrinsic__pipeToShutdown(pipeState, error);
}).$$capture_end$$;
