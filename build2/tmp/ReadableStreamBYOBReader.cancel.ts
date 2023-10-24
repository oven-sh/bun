// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamBYOBReader.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(reason) {  if (!__intrinsic__isReadableStreamBYOBReader(this))
    return Promise.__intrinsic__reject(__intrinsic__makeThisTypeError("ReadableStreamBYOBReader", "cancel"));

  if (!__intrinsic__getByIdDirectPrivate(this, "ownerReadableStream"))
    return Promise.__intrinsic__reject(__intrinsic__makeTypeError("cancel() called on a reader owned by no readable stream"));

  return __intrinsic__readableStreamReaderGenericCancel(this, reason);
}).$$capture_end$$;
