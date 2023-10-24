// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/StreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(strategy,defaultHWM) {  const highWaterMark = strategy.highWaterMark;

  if (highWaterMark === undefined) return defaultHWM;

  if (highWaterMark !== highWaterMark || highWaterMark < 0)
    __intrinsic__throwRangeError("highWaterMark value is negative or not a number");

  return __intrinsic__toNumber(highWaterMark);
}).$$capture_end$$;
