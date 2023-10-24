// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  const closeRequest = __intrinsic__getByIdDirectPrivate(stream, "closeRequest");
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "inFlightCloseRequest") === undefined,"$getByIdDirectPrivate(stream, \"inFlightCloseRequest\") === undefined"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(closeRequest !== undefined,"closeRequest !== undefined"):void 0);

  __intrinsic__putByIdDirectPrivate(stream, "inFlightCloseRequest", closeRequest);
  __intrinsic__putByIdDirectPrivate(stream, "closeRequest", undefined);
}).$$capture_end$$;
