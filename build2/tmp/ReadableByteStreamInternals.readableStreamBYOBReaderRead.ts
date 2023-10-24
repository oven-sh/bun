// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(reader,view) {  const stream = __intrinsic__getByIdDirectPrivate(reader, "ownerReadableStream");
  (IS_BUN_DEVELOPMENT?$assert(!!stream,"!!stream"):void 0);

  __intrinsic__putByIdDirectPrivate(stream, "disturbed", true);
  if (__intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamErrored)
    return Promise.__intrinsic__reject(__intrinsic__getByIdDirectPrivate(stream, "storedError"));

  return __intrinsic__readableByteStreamControllerPullInto(__intrinsic__getByIdDirectPrivate(stream, "readableStreamController"), view);
}).$$capture_end$$;
