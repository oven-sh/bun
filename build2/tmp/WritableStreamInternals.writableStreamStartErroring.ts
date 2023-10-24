// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,reason) {  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "storedError") === undefined,"$getByIdDirectPrivate(stream, \"storedError\") === undefined"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "state") === "writable","$getByIdDirectPrivate(stream, \"state\") === \"writable\""):void 0);

  const controller = __intrinsic__getByIdDirectPrivate(stream, "controller");
  (IS_BUN_DEVELOPMENT?$assert(controller !== undefined,"controller !== undefined"):void 0);

  __intrinsic__putByIdDirectPrivate(stream, "state", "erroring");
  __intrinsic__putByIdDirectPrivate(stream, "storedError", reason);

  const writer = __intrinsic__getByIdDirectPrivate(stream, "writer");
  if (writer !== undefined) __intrinsic__writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, reason);

  if (!__intrinsic__writableStreamHasOperationMarkedInFlight(stream) && __intrinsic__getByIdDirectPrivate(controller, "started") === 1)
    __intrinsic__writableStreamFinishErroring(stream);
}).$$capture_end$$;
