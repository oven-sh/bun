// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,underlyingSource,strategy) {  const type = underlyingSource.type;
  const typeString = __intrinsic__toString(type);

  if (typeString === "bytes") {
    // if (!$readableByteStreamAPIEnabled())
    //     $throwTypeError("ReadableByteStreamController is not implemented");

    if (strategy.highWaterMark === undefined) strategy.highWaterMark = 0;
    if (strategy.size !== undefined) __intrinsic__throwRangeError("Strategy for a ReadableByteStreamController cannot have a size");

    __intrinsic__putByIdDirectPrivate(
      stream,
      "readableStreamController",
      new ReadableByteStreamController(stream, underlyingSource, strategy.highWaterMark, __intrinsic__isReadableStream),
    );
  } else if (typeString === "direct") {
    var highWaterMark = strategy?.highWaterMark;
    __intrinsic__initializeArrayBufferStream.__intrinsic__call(stream, underlyingSource, highWaterMark);
  } else if (type === undefined) {
    if (strategy.highWaterMark === undefined) strategy.highWaterMark = 1;

    __intrinsic__setupReadableStreamDefaultController(
      stream,
      underlyingSource,
      strategy.size,
      strategy.highWaterMark,
      underlyingSource.start,
      underlyingSource.pull,
      underlyingSource.cancel,
    );
  } else __intrinsic__throwRangeError("Invalid type for underlying source");
}).$$capture_end$$;
