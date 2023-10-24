// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  var queue = __intrinsic__getByIdDirectPrivate(controller, "queue");
  if (queue.content.isNotEmpty()) {
    const chunk = __intrinsic__dequeueValue(queue);
    if (__intrinsic__getByIdDirectPrivate(controller, "closeRequested") && queue.content.isEmpty())
      __intrinsic__readableStreamClose(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"));
    else __intrinsic__readableStreamDefaultControllerCallPullIfNeeded(controller);

    return __intrinsic__createFulfilledPromise({ value: chunk, done: false });
  }
  const pendingPromise = __intrinsic__readableStreamAddReadRequest(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"));
  __intrinsic__readableStreamDefaultControllerCallPullIfNeeded(controller);
  return pendingPromise;
}).$$capture_end$$;
