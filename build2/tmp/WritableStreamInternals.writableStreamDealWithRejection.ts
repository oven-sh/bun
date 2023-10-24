// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,error) {  const state = __intrinsic__getByIdDirectPrivate(stream, "state");
  if (state === "writable") {
    __intrinsic__writableStreamStartErroring(stream, error);
    return;
  }

  (IS_BUN_DEVELOPMENT?$assert(state === "erroring","state === \"erroring\""):void 0);
  __intrinsic__writableStreamFinishErroring(stream);
}).$$capture_end$$;
