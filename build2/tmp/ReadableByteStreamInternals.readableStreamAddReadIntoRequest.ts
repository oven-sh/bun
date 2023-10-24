// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__isReadableStreamBYOBReader(__intrinsic__getByIdDirectPrivate(stream, "reader")),"$isReadableStreamBYOBReader($getByIdDirectPrivate(stream, \"reader\"))"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(
    __intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamReadable ||
      __intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamClosed,"$getByIdDirectPrivate(stream, \"state\") === $streamReadable ||\n      $getByIdDirectPrivate(stream, \"state\") === $streamClosed"):void 0);

  const readRequest = __intrinsic__newPromise();
  __intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(stream, "reader"), "readIntoRequests").push(readRequest);

  return readRequest;
}).$$capture_end$$;
