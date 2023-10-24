// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  if (!__intrinsic__readableByteStreamControllerShouldCallPull(controller)) return;

  if (__intrinsic__getByIdDirectPrivate(controller, "pulling")) {
    __intrinsic__putByIdDirectPrivate(controller, "pullAgain", true);
    return;
  }

  (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__getByIdDirectPrivate(controller, "pullAgain"),"!$getByIdDirectPrivate(controller, \"pullAgain\")"):void 0);
  __intrinsic__putByIdDirectPrivate(controller, "pulling", true);
  __intrinsic__promiseInvokeOrNoop(__intrinsic__getByIdDirectPrivate(controller, "underlyingByteSource"), "pull", [controller]).__intrinsic__then(
    () => {
      __intrinsic__putByIdDirectPrivate(controller, "pulling", false);
      if (__intrinsic__getByIdDirectPrivate(controller, "pullAgain")) {
        __intrinsic__putByIdDirectPrivate(controller, "pullAgain", false);
        __intrinsic__readableByteStreamControllerCallPullIfNeeded(controller);
      }
    },
    error => {
      if (
        __intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"), "state") ===
        __intrinsic__streamReadable
      )
        __intrinsic__readableByteStreamControllerError(controller, error);
    },
  );
}).$$capture_end$$;
