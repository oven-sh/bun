// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,backpressure) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "state") === "writable","$getByIdDirectPrivate(stream, \"state\") === \"writable\""):void 0);
  (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__writableStreamCloseQueuedOrInFlight(stream),"!$writableStreamCloseQueuedOrInFlight(stream)"):void 0);

  const writer = __intrinsic__getByIdDirectPrivate(stream, "writer");
  if (writer !== undefined && backpressure !== __intrinsic__getByIdDirectPrivate(stream, "backpressure")) {
    if (backpressure) __intrinsic__putByIdDirectPrivate(writer, "readyPromise", __intrinsic__newPromiseCapability(Promise));
    else __intrinsic__getByIdDirectPrivate(writer, "readyPromise").resolve.__intrinsic__call();
  }
  __intrinsic__putByIdDirectPrivate(stream, "backpressure", backpressure);
}).$$capture_end$$;
