// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__isReadableStreamDefaultReader(__intrinsic__getByIdDirectPrivate(stream, "reader")),"$isReadableStreamDefaultReader($getByIdDirectPrivate(stream, \"reader\"))"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "state") == __intrinsic__streamReadable,"$getByIdDirectPrivate(stream, \"state\") == $streamReadable"):void 0);

  const readRequest = __intrinsic__newPromise();

  __intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(stream, "reader"), "readRequests").push(readRequest);

  return readRequest;
}).$$capture_end$$;
