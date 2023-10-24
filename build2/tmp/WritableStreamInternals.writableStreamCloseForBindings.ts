// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream) {  if (__intrinsic__isWritableStreamLocked(stream))
    return Promise.__intrinsic__reject(__intrinsic__makeTypeError("WritableStream.close method can only be used on non locked WritableStream"));

  if (__intrinsic__writableStreamCloseQueuedOrInFlight(stream))
    return Promise.__intrinsic__reject(
      __intrinsic__makeTypeError("WritableStream.close method can only be used on a being close WritableStream"),
    );

  return __intrinsic__writableStreamClose(stream);
}).$$capture_end$$;
