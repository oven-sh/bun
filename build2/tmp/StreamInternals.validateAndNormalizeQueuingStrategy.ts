// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/StreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(size,highWaterMark) {  if (size !== undefined && typeof size !== "function") __intrinsic__throwTypeError("size parameter must be a function");

  const newHighWaterMark = __intrinsic__toNumber(highWaterMark);

  if (newHighWaterMark !== newHighWaterMark || newHighWaterMark < 0)
    __intrinsic__throwRangeError("highWaterMark value is negative or not a number");

  return { size: size, highWaterMark: newHighWaterMark };
}).$$capture_end$$;
