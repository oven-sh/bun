// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(reader) {  const stream = __intrinsic__getByIdDirectPrivate(reader, "ownerReadableStream");
  (IS_BUN_DEVELOPMENT?$assert(!!stream,"!!stream"):void 0);
  const state = __intrinsic__getByIdDirectPrivate(stream, "state");

  __intrinsic__putByIdDirectPrivate(stream, "disturbed", true);
  if (state === __intrinsic__streamClosed) return __intrinsic__createFulfilledPromise({ value: undefined, done: true });
  if (state === __intrinsic__streamErrored) return Promise.__intrinsic__reject(__intrinsic__getByIdDirectPrivate(stream, "storedError"));
  (IS_BUN_DEVELOPMENT?$assert(state === __intrinsic__streamReadable,"state === $streamReadable"):void 0);

  return __intrinsic__getByIdDirectPrivate(stream, "readableStreamController").__intrinsic__pull(
    __intrinsic__getByIdDirectPrivate(stream, "readableStreamController"),
  );
}).$$capture_end$$;
