// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/StreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(queue) {  const record = queue.content.shift();
  queue.size -= record.size;
  // As described by spec, below case may occur due to rounding errors.
  if (queue.size < 0) queue.size = 0;
  return record.value;
}).$$capture_end$$;
