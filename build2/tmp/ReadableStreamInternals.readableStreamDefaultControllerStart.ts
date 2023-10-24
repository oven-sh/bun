// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  if (__intrinsic__getByIdDirectPrivate(controller, "started") !== -1) return;

  const underlyingSource = __intrinsic__getByIdDirectPrivate(controller, "underlyingSource");
  const startMethod = underlyingSource.start;
  __intrinsic__putByIdDirectPrivate(controller, "started", 0);

  __intrinsic__promiseInvokeOrNoopMethodNoCatch(underlyingSource, startMethod, [controller]).__intrinsic__then(
    () => {
      __intrinsic__putByIdDirectPrivate(controller, "started", 1);
      (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__getByIdDirectPrivate(controller, "pulling"),"!$getByIdDirectPrivate(controller, \"pulling\")"):void 0);
      (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__getByIdDirectPrivate(controller, "pullAgain"),"!$getByIdDirectPrivate(controller, \"pullAgain\")"):void 0);
      __intrinsic__readableStreamDefaultControllerCallPullIfNeeded(controller);
    },
    error => {
      __intrinsic__readableStreamDefaultControllerError(controller, error);
    },
  );
}).$$capture_end$$;
