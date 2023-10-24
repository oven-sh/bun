// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamBYOBReader.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  if (!__intrinsic__isReadableStreamBYOBReader(this)) throw __intrinsic__makeThisTypeError("ReadableStreamBYOBReader", "releaseLock");

  if (!__intrinsic__getByIdDirectPrivate(this, "ownerReadableStream")) return;

  if (__intrinsic__getByIdDirectPrivate(this, "readIntoRequests")?.isNotEmpty())
    __intrinsic__throwTypeError("There are still pending read requests, cannot release the lock");

  __intrinsic__readableStreamReaderGenericRelease(this);
}).$$capture_end$$;
