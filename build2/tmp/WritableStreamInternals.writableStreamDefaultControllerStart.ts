// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  if (__intrinsic__getByIdDirectPrivate(controller, "started") !== -1) return;

  __intrinsic__putByIdDirectPrivate(controller, "started", 0);

  const startAlgorithm = __intrinsic__getByIdDirectPrivate(controller, "startAlgorithm");
  __intrinsic__putByIdDirectPrivate(controller, "startAlgorithm", undefined);
  const stream = __intrinsic__getByIdDirectPrivate(controller, "stream");
  return Promise.__intrinsic__resolve(startAlgorithm.__intrinsic__call()).__intrinsic__then(
    () => {
      const state = __intrinsic__getByIdDirectPrivate(stream, "state");
      (IS_BUN_DEVELOPMENT?$assert(state === "writable" || state === "erroring","state === \"writable\" || state === \"erroring\""):void 0);
      __intrinsic__putByIdDirectPrivate(controller, "started", 1);
      __intrinsic__writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    error => {
      const state = __intrinsic__getByIdDirectPrivate(stream, "state");
      (IS_BUN_DEVELOPMENT?$assert(state === "writable" || state === "erroring","state === \"writable\" || state === \"erroring\""):void 0);
      __intrinsic__putByIdDirectPrivate(controller, "started", 1);
      __intrinsic__writableStreamDealWithRejection(stream, error);
    },
  );
}).$$capture_end$$;
