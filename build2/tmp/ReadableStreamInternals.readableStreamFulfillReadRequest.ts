// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,chunk,done) {  const readRequest = __intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(stream, "reader"), "readRequests").shift();
  __intrinsic__fulfillPromise(readRequest, { value: chunk, done: done });
}).$$capture_end$$;
