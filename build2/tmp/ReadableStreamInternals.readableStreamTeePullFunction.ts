// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(teeState,reader,shouldClone) {  return function () {
    Promise.prototype.__intrinsic__then.__intrinsic__call(__intrinsic__readableStreamDefaultReaderRead(reader), function (result) {
      (IS_BUN_DEVELOPMENT?$assert(__intrinsic__isObject(result),"$isObject(result)"):void 0);
      (IS_BUN_DEVELOPMENT?$assert(typeof result.done === "boolean","typeof result.done === \"boolean\""):void 0);
      if (result.done && !teeState.closedOrErrored) {
        if (!teeState.canceled1) __intrinsic__readableStreamDefaultControllerClose(teeState.branch1.__intrinsic__readableStreamController);
        if (!teeState.canceled2) __intrinsic__readableStreamDefaultControllerClose(teeState.branch2.__intrinsic__readableStreamController);
        teeState.closedOrErrored = true;
        if (!teeState.canceled1 || !teeState.canceled2) teeState.cancelPromiseCapability.resolve.__intrinsic__call();
      }
      if (teeState.closedOrErrored) return;
      if (!teeState.canceled1)
        __intrinsic__readableStreamDefaultControllerEnqueue(teeState.branch1.__intrinsic__readableStreamController, result.value);
      if (!teeState.canceled2)
        __intrinsic__readableStreamDefaultControllerEnqueue(
          teeState.branch2.__intrinsic__readableStreamController,
          shouldClone ? __intrinsic__structuredCloneForStream(result.value) : result.value,
        );
    });
  };
}).$$capture_end$$;
