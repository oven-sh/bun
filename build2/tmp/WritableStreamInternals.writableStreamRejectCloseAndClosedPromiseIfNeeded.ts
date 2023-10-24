// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "state") === "errored","$getByIdDirectPrivate(stream, \"state\") === \"errored\""):void 0);

  const storedError = __intrinsic__getByIdDirectPrivate(stream, "storedError");

  const closeRequest = __intrinsic__getByIdDirectPrivate(stream, "closeRequest");
  if (closeRequest !== undefined) {
    (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "inFlightCloseRequest") === undefined,"$getByIdDirectPrivate(stream, \"inFlightCloseRequest\") === undefined"):void 0);
    closeRequest.reject.__intrinsic__call(undefined, storedError);
    __intrinsic__putByIdDirectPrivate(stream, "closeRequest", undefined);
  }

  const writer = __intrinsic__getByIdDirectPrivate(stream, "writer");
  if (writer !== undefined) {
    const closedPromise = __intrinsic__getByIdDirectPrivate(writer, "closedPromise");
    closedPromise.reject.__intrinsic__call(undefined, storedError);
    __intrinsic__markPromiseAsHandled(closedPromise.promise);
  }
}).$$capture_end$$;
