// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamDefaultWriter.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  if (!__intrinsic__isWritableStreamDefaultWriter(this)) throw __intrinsic__makeThisTypeError("WritableStreamDefaultWriter", "releaseLock");

  const stream = __intrinsic__getByIdDirectPrivate(this, "stream");
  if (stream === undefined) return;

  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "writer") !== undefined,"$getByIdDirectPrivate(stream, \"writer\") !== undefined"):void 0);
  __intrinsic__writableStreamDefaultWriterRelease(this);
}).$$capture_end$$;
