// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStream.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(reason) {  if (!__intrinsic__isReadableStream(this)) return Promise.__intrinsic__reject(__intrinsic__makeThisTypeError("ReadableStream", "cancel"));

  if (__intrinsic__isReadableStreamLocked(this)) return Promise.__intrinsic__reject(__intrinsic__makeTypeError("ReadableStream is locked"));

  return __intrinsic__readableStreamCancel(this, reason);
}).$$capture_end$$;
