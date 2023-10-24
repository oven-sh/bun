// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStream.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  // this is a direct stream
  var underlyingSource = __intrinsic__getByIdDirectPrivate(stream, "underlyingSource");
  if (underlyingSource !== undefined) {
    return __intrinsic__readableStreamToArrayDirect(stream, underlyingSource);
  }

  return __intrinsic__readableStreamIntoArray(stream);
}).$$capture_end$$;
