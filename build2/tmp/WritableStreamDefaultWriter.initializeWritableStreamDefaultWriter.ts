// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamDefaultWriter.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  // stream can be a WritableStream if WritableStreamDefaultWriter constructor is called directly from JS
  // or an InternalWritableStream in other code paths.
  const internalStream = __intrinsic__getInternalWritableStream(stream);
  if (internalStream) stream = internalStream;

  if (!__intrinsic__isWritableStream(stream)) __intrinsic__throwTypeError("WritableStreamDefaultWriter constructor takes a WritableStream");

  __intrinsic__setUpWritableStreamDefaultWriter(this, stream);
  return this;
}).$$capture_end$$;
