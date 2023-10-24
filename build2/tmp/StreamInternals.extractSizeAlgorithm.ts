// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/StreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(strategy) {  const sizeAlgorithm = strategy.size;

  if (sizeAlgorithm === undefined) return () => 1;

  if (typeof sizeAlgorithm !== "function") __intrinsic__throwTypeError("strategy.size must be a function");

  return chunk => {
    return sizeAlgorithm(chunk);
  };
}).$$capture_end$$;
