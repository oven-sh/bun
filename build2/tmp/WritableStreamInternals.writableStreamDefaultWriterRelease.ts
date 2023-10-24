// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(writer) {  const stream = __intrinsic__getByIdDirectPrivate(writer, "stream");
  (IS_BUN_DEVELOPMENT?$assert(stream !== undefined,"stream !== undefined"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "writer") === writer,"$getByIdDirectPrivate(stream, \"writer\") === writer"):void 0);

  const releasedError = __intrinsic__makeTypeError("writableStreamDefaultWriterRelease");

  __intrinsic__writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, releasedError);
  __intrinsic__writableStreamDefaultWriterEnsureClosedPromiseRejected(writer, releasedError);

  __intrinsic__putByIdDirectPrivate(stream, "writer", undefined);
  __intrinsic__putByIdDirectPrivate(writer, "stream", undefined);
}).$$capture_end$$;
