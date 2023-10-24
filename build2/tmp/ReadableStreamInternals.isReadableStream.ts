// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  // Spec tells to return true only if stream has a readableStreamController internal slot.
  // However, since it is a private slot, it cannot be checked using hasOwnProperty().
  // Therefore, readableStreamController is initialized with null value.
  return __intrinsic__isObject(stream) && __intrinsic__getByIdDirectPrivate(stream, "readableStreamController") !== undefined;
}).$$capture_end$$;
