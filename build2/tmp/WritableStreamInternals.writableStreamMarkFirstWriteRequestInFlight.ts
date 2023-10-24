// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  const writeRequests = __intrinsic__getByIdDirectPrivate(stream, "writeRequests");
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "inFlightWriteRequest") === undefined,"$getByIdDirectPrivate(stream, \"inFlightWriteRequest\") === undefined"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(writeRequests.isNotEmpty(),"writeRequests.isNotEmpty()"):void 0);

  const writeRequest = writeRequests.shift();
  __intrinsic__putByIdDirectPrivate(stream, "inFlightWriteRequest", writeRequest);
}).$$capture_end$$;
