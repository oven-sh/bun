// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  // FIXME: use $readableStreamDefaultControllerShouldCallPull
  const stream = __intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream");

  if (!__intrinsic__readableStreamDefaultControllerCanCloseOrEnqueue(controller)) return;
  if (!(__intrinsic__getByIdDirectPrivate(controller, "started") === 1)) return;
  if (
    (!__intrinsic__isReadableStreamLocked(stream) ||
      !__intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(stream, "reader"), "readRequests")?.isNotEmpty()) &&
    __intrinsic__readableStreamDefaultControllerGetDesiredSize(controller) <= 0
  )
    return;

  if (__intrinsic__getByIdDirectPrivate(controller, "pulling")) {
    __intrinsic__putByIdDirectPrivate(controller, "pullAgain", true);
    return;
  }

  (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__getByIdDirectPrivate(controller, "pullAgain"),"!$getByIdDirectPrivate(controller, \"pullAgain\")"):void 0);
  __intrinsic__putByIdDirectPrivate(controller, "pulling", true);

  __intrinsic__getByIdDirectPrivate(controller, "pullAlgorithm")
    .__intrinsic__call(undefined)
    .__intrinsic__then(
      function () {
        __intrinsic__putByIdDirectPrivate(controller, "pulling", false);
        if (__intrinsic__getByIdDirectPrivate(controller, "pullAgain")) {
          __intrinsic__putByIdDirectPrivate(controller, "pullAgain", false);

          __intrinsic__readableStreamDefaultControllerCallPullIfNeeded(controller);
        }
      },
      function (error) {
        __intrinsic__readableStreamDefaultControllerError(controller, error);
      },
    );
}).$$capture_end$$;
