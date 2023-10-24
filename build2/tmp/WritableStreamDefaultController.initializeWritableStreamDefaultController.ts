// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamDefaultController.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  __intrinsic__putByIdDirectPrivate(this, "queue", __intrinsic__newQueue());
  __intrinsic__putByIdDirectPrivate(this, "abortSteps", reason => {
    const result = __intrinsic__getByIdDirectPrivate(this, "abortAlgorithm").__intrinsic__call(undefined, reason);
    __intrinsic__writableStreamDefaultControllerClearAlgorithms(this);
    return result;
  });

  __intrinsic__putByIdDirectPrivate(this, "errorSteps", () => {
    __intrinsic__resetQueue(__intrinsic__getByIdDirectPrivate(this, "queue"));
  });

  return this;
}).$$capture_end$$;
