// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamDefaultWriter.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  if (!__intrinsic__isWritableStreamDefaultWriter(this))
    return Promise.__intrinsic__reject(__intrinsic__makeThisTypeError("WritableStreamDefaultWriter", "close"));

  const stream = __intrinsic__getByIdDirectPrivate(this, "stream");
  if (stream === undefined) return Promise.__intrinsic__reject(__intrinsic__makeTypeError("WritableStreamDefaultWriter has no stream"));

  if (__intrinsic__writableStreamCloseQueuedOrInFlight(stream))
    return Promise.__intrinsic__reject(__intrinsic__makeTypeError("WritableStreamDefaultWriter is being closed"));

  return __intrinsic__writableStreamDefaultWriterClose(this);
}).$$capture_end$$;
