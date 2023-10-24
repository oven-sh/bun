// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  // Spec tells to return true only if controller has an underlyingSource internal slot.
  // However, since it is a private slot, it cannot be checked using hasOwnProperty().
  // underlyingSource is obtained in ReadableStream constructor: if undefined, it is set
  // to an empty object. Therefore, following test is ok.
  return __intrinsic__isObject(controller) && !!__intrinsic__getByIdDirectPrivate(controller, "underlyingSource");
}).$$capture_end$$;
