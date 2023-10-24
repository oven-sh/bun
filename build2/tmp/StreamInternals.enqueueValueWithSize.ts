// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/StreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(queue,value,size) {  size = __intrinsic__toNumber(size);
  if (!isFinite(size) || size < 0) __intrinsic__throwRangeError("size has an incorrect value");

  queue.content.push({ value, size });
  queue.size += size;
}).$$capture_end$$;
