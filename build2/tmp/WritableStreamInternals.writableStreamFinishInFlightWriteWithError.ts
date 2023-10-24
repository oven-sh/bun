// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,error) {  const inFlightWriteRequest = __intrinsic__getByIdDirectPrivate(stream, "inFlightWriteRequest");
  (IS_BUN_DEVELOPMENT?$assert(inFlightWriteRequest !== undefined,"inFlightWriteRequest !== undefined"):void 0);
  inFlightWriteRequest.reject.__intrinsic__call(undefined, error);

  __intrinsic__putByIdDirectPrivate(stream, "inFlightWriteRequest", undefined);

  const state = __intrinsic__getByIdDirectPrivate(stream, "state");
  (IS_BUN_DEVELOPMENT?$assert(state === "writable" || state === "erroring","state === \"writable\" || state === \"erroring\""):void 0);

  __intrinsic__writableStreamDealWithRejection(stream, error);
}).$$capture_end$$;
