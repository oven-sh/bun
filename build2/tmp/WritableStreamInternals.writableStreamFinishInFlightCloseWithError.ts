// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,error) {  const inFlightCloseRequest = __intrinsic__getByIdDirectPrivate(stream, "inFlightCloseRequest");
  (IS_BUN_DEVELOPMENT?$assert(inFlightCloseRequest !== undefined,"inFlightCloseRequest !== undefined"):void 0);
  inFlightCloseRequest.reject.__intrinsic__call(undefined, error);

  __intrinsic__putByIdDirectPrivate(stream, "inFlightCloseRequest", undefined);

  const state = __intrinsic__getByIdDirectPrivate(stream, "state");
  (IS_BUN_DEVELOPMENT?$assert(state === "writable" || state === "erroring","state === \"writable\" || state === \"erroring\""):void 0);

  const abortRequest = __intrinsic__getByIdDirectPrivate(stream, "pendingAbortRequest");
  if (abortRequest !== undefined) {
    abortRequest.promise.reject.__intrinsic__call(undefined, error);
    __intrinsic__putByIdDirectPrivate(stream, "pendingAbortRequest", undefined);
  }

  __intrinsic__writableStreamDealWithRejection(stream, error);
}).$$capture_end$$;
