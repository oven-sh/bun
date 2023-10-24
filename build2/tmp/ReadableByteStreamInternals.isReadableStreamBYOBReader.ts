// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(reader) {  // Spec tells to return true only if reader has a readIntoRequests internal slot.
  // However, since it is a private slot, it cannot be checked using hasOwnProperty().
  // Since readIntoRequests is initialized with an empty array, the following test is ok.
  return __intrinsic__isObject(reader) && !!__intrinsic__getByIdDirectPrivate(reader, "readIntoRequests");
}).$$capture_end$$;
