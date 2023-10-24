// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(writer) {  const stream = __intrinsic__getByIdDirectPrivate(writer, "stream");
  (IS_BUN_DEVELOPMENT?$assert(stream !== undefined,"stream !== undefined"):void 0);

  const state = __intrinsic__getByIdDirectPrivate(stream, "state");

  if (__intrinsic__writableStreamCloseQueuedOrInFlight(stream) || state === "closed") return Promise.__intrinsic__resolve();

  if (state === "errored") return Promise.__intrinsic__reject(__intrinsic__getByIdDirectPrivate(stream, "storedError"));

  (IS_BUN_DEVELOPMENT?$assert(state === "writable" || state === "erroring","state === \"writable\" || state === \"erroring\""):void 0);
  return __intrinsic__writableStreamDefaultWriterClose(writer);
}).$$capture_end$$;
