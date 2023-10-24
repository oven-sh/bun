// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,error) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "stream");
  (IS_BUN_DEVELOPMENT?$assert(stream !== undefined,"stream !== undefined"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "state") === "writable","$getByIdDirectPrivate(stream, \"state\") === \"writable\""):void 0);

  __intrinsic__writableStreamDefaultControllerClearAlgorithms(controller);
  __intrinsic__writableStreamStartErroring(stream, error);
}).$$capture_end$$;
