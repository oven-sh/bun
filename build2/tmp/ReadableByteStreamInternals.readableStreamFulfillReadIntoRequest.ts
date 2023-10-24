// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,chunk,done) {  const readIntoRequest = __intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(stream, "reader"), "readIntoRequests").shift();
  __intrinsic__fulfillPromise(readIntoRequest, { value: chunk, done: done });
}).$$capture_end$$;
