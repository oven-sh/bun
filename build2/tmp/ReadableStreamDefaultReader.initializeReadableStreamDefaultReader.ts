// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamDefaultReader.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  if (!__intrinsic__isReadableStream(stream)) __intrinsic__throwTypeError("ReadableStreamDefaultReader needs a ReadableStream");
  if (__intrinsic__isReadableStreamLocked(stream)) __intrinsic__throwTypeError("ReadableStream is locked");

  __intrinsic__readableStreamReaderGenericInitialize(this, stream);
  __intrinsic__putByIdDirectPrivate(this, "readRequests", __intrinsic__createFIFO());

  return this;
}).$$capture_end$$;
