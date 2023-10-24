// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamDefaultWriter.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(chunk) {  if (!__intrinsic__isWritableStreamDefaultWriter(this))
    return Promise.__intrinsic__reject(__intrinsic__makeThisTypeError("WritableStreamDefaultWriter", "write"));

  if (__intrinsic__getByIdDirectPrivate(this, "stream") === undefined)
    return Promise.__intrinsic__reject(__intrinsic__makeTypeError("WritableStreamDefaultWriter has no stream"));

  return __intrinsic__writableStreamDefaultWriterWrite(this, chunk);
}).$$capture_end$$;
