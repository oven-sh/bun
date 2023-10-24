// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamBYOBReader.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  if (!__intrinsic__isReadableStream(stream)) __intrinsic__throwTypeError("ReadableStreamBYOBReader needs a ReadableStream");
  if (!__intrinsic__isReadableByteStreamController(__intrinsic__getByIdDirectPrivate(stream, "readableStreamController")))
    __intrinsic__throwTypeError("ReadableStreamBYOBReader needs a ReadableByteStreamController");
  if (__intrinsic__isReadableStreamLocked(stream)) __intrinsic__throwTypeError("ReadableStream is locked");

  __intrinsic__readableStreamReaderGenericInitialize(this, stream);
  __intrinsic__putByIdDirectPrivate(this, "readIntoRequests", __intrinsic__createFIFO());

  return this;
}).$$capture_end$$;
