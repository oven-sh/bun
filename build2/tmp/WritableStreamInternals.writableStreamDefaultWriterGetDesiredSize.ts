// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(writer) {  const stream = __intrinsic__getByIdDirectPrivate(writer, "stream");
  (IS_BUN_DEVELOPMENT?$assert(stream !== undefined,"stream !== undefined"):void 0);

  const state = __intrinsic__getByIdDirectPrivate(stream, "state");

  if (state === "errored" || state === "erroring") return null;

  if (state === "closed") return 0;

  return __intrinsic__writableStreamDefaultControllerGetDesiredSize(__intrinsic__getByIdDirectPrivate(stream, "controller"));
}).$$capture_end$$;
