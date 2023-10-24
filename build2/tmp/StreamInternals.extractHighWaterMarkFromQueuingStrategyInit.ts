// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/StreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(init) {  if (!__intrinsic__isObject(init)) __intrinsic__throwTypeError("QueuingStrategyInit argument must be an object.");
  const { highWaterMark } = init;
  if (highWaterMark === undefined) __intrinsic__throwTypeError("QueuingStrategyInit.highWaterMark member is required.");

  return __intrinsic__toNumber(highWaterMark);
}).$$capture_end$$;
