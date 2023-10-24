// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,reason) {  if (__intrinsic__isWritableStreamLocked(stream))
    return Promise.__intrinsic__reject(__intrinsic__makeTypeError("WritableStream.abort method can only be used on non locked WritableStream"));

  return __intrinsic__writableStreamAbort(stream, reason);
}).$$capture_end$$;
