// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/WritableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "stream");

  if (__intrinsic__getByIdDirectPrivate(controller, "started") !== 1) return;

  (IS_BUN_DEVELOPMENT?$assert(stream !== undefined,"stream !== undefined"):void 0);
  if (__intrinsic__getByIdDirectPrivate(stream, "inFlightWriteRequest") !== undefined) return;

  const state = __intrinsic__getByIdDirectPrivate(stream, "state");
  (IS_BUN_DEVELOPMENT?$assert(state !== "closed" || state !== "errored","state !== \"closed\" || state !== \"errored\""):void 0);
  if (state === "erroring") {
    __intrinsic__writableStreamFinishErroring(stream);
    return;
  }

  const queue = __intrinsic__getByIdDirectPrivate(controller, "queue");

  if (queue.content?.isEmpty() ?? false) return;

  const value = __intrinsic__peekQueueValue(queue);
  if (value === __intrinsic__isCloseSentinel) __intrinsic__writableStreamDefaultControllerProcessClose(controller);
  else __intrinsic__writableStreamDefaultControllerProcessWrite(controller, value);
}).$$capture_end$$;
