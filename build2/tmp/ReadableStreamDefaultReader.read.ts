// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamDefaultReader.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  if (!__intrinsic__isReadableStreamDefaultReader(this))
    return Promise.__intrinsic__reject(__intrinsic__makeThisTypeError("ReadableStreamDefaultReader", "read"));
  if (!__intrinsic__getByIdDirectPrivate(this, "ownerReadableStream"))
    return Promise.__intrinsic__reject(__intrinsic__makeTypeError("read() called on a reader owned by no readable stream"));

  return __intrinsic__readableStreamDefaultReaderRead(this);
}).$$capture_end$$;
