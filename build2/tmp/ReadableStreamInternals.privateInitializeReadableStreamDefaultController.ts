// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,underlyingSource,size,highWaterMark) {  if (!__intrinsic__isReadableStream(stream)) __intrinsic__throwTypeError("ReadableStreamDefaultController needs a ReadableStream");

  // readableStreamController is initialized with null value.
  if (__intrinsic__getByIdDirectPrivate(stream, "readableStreamController") !== null)
    __intrinsic__throwTypeError("ReadableStream already has a controller");

  __intrinsic__putByIdDirectPrivate(this, "controlledReadableStream", stream);
  __intrinsic__putByIdDirectPrivate(this, "underlyingSource", underlyingSource);
  __intrinsic__putByIdDirectPrivate(this, "queue", __intrinsic__newQueue());
  __intrinsic__putByIdDirectPrivate(this, "started", -1);
  __intrinsic__putByIdDirectPrivate(this, "closeRequested", false);
  __intrinsic__putByIdDirectPrivate(this, "pullAgain", false);
  __intrinsic__putByIdDirectPrivate(this, "pulling", false);
  __intrinsic__putByIdDirectPrivate(this, "strategy", __intrinsic__validateAndNormalizeQueuingStrategy(size, highWaterMark));

  return this;
}).$$capture_end$$;
