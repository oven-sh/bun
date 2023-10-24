// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  const state = __intrinsic__getByIdDirectPrivate(stream, "state");
  if (state === "closed" || state === "errored")
    return Promise.__intrinsic__reject(__intrinsic__makeTypeError("Cannot close a writable stream that is closed or errored"));

  (IS_BUN_DEVELOPMENT?$assert(state === "writable" || state === "erroring","state === \"writable\" || state === \"erroring\""):void 0);
  (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__writableStreamCloseQueuedOrInFlight(stream),"!$writableStreamCloseQueuedOrInFlight(stream)"):void 0);

  const closePromiseCapability = __intrinsic__newPromiseCapability(Promise);
  __intrinsic__putByIdDirectPrivate(stream, "closeRequest", closePromiseCapability);

  const writer = __intrinsic__getByIdDirectPrivate(stream, "writer");
  if (writer !== undefined && __intrinsic__getByIdDirectPrivate(stream, "backpressure") && state === "writable")
    __intrinsic__getByIdDirectPrivate(writer, "readyPromise").resolve.__intrinsic__call();

  __intrinsic__writableStreamDefaultControllerClose(__intrinsic__getByIdDirectPrivate(stream, "controller"));

  return closePromiseCapability.promise;
}).$$capture_end$$;
