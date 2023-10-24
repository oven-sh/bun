// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(reader,reason) {  const stream = __intrinsic__getByIdDirectPrivate(reader, "ownerReadableStream");
  (IS_BUN_DEVELOPMENT?$assert(!!stream,"!!stream"):void 0);
  return __intrinsic__readableStreamCancel(stream, reason);
}).$$capture_end$$;
