// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  const inFlightCloseRequest = __intrinsic__getByIdDirectPrivate(stream, "inFlightCloseRequest");
  inFlightCloseRequest.resolve.__intrinsic__call();

  __intrinsic__putByIdDirectPrivate(stream, "inFlightCloseRequest", undefined);

  const state = __intrinsic__getByIdDirectPrivate(stream, "state");
  (IS_BUN_DEVELOPMENT?$assert(state === "writable" || state === "erroring","state === \"writable\" || state === \"erroring\""):void 0);

  if (state === "erroring") {
    __intrinsic__putByIdDirectPrivate(stream, "storedError", undefined);
    const abortRequest = __intrinsic__getByIdDirectPrivate(stream, "pendingAbortRequest");
    if (abortRequest !== undefined) {
      abortRequest.promise.resolve.__intrinsic__call();
      __intrinsic__putByIdDirectPrivate(stream, "pendingAbortRequest", undefined);
    }
  }

  __intrinsic__putByIdDirectPrivate(stream, "state", "closed");

  const writer = __intrinsic__getByIdDirectPrivate(stream, "writer");
  if (writer !== undefined) __intrinsic__getByIdDirectPrivate(writer, "closedPromise").resolve.__intrinsic__call();

  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "pendingAbortRequest") === undefined,"$getByIdDirectPrivate(stream, \"pendingAbortRequest\") === undefined"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "storedError") === undefined,"$getByIdDirectPrivate(stream, \"storedError\") === undefined"):void 0);
}).$$capture_end$$;
