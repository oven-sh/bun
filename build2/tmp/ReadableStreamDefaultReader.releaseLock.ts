// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamDefaultReader.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  if (!__intrinsic__isReadableStreamDefaultReader(this)) throw __intrinsic__makeThisTypeError("ReadableStreamDefaultReader", "releaseLock");

  if (!__intrinsic__getByIdDirectPrivate(this, "ownerReadableStream")) return;

  if (__intrinsic__getByIdDirectPrivate(this, "readRequests")?.isNotEmpty())
    __intrinsic__throwTypeError("There are still pending read requests, cannot release the lock");

  __intrinsic__readableStreamReaderGenericRelease(this);
}).$$capture_end$$;
