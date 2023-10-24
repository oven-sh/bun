// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(pullIntoDescriptor) {  (IS_BUN_DEVELOPMENT?$assert(pullIntoDescriptor.bytesFilled <= pullIntoDescriptor.byteLength,"pullIntoDescriptor.bytesFilled <= pullIntoDescriptor.byteLength"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize === 0,"pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize === 0"):void 0);

  return new pullIntoDescriptor.ctor(
    pullIntoDescriptor.buffer,
    pullIntoDescriptor.byteOffset,
    pullIntoDescriptor.bytesFilled / pullIntoDescriptor.elementSize,
  );
}).$$capture_end$$;
