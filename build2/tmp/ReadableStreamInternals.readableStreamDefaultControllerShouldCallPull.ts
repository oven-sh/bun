// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream");

  if (!__intrinsic__readableStreamDefaultControllerCanCloseOrEnqueue(controller)) return false;
  if (!(__intrinsic__getByIdDirectPrivate(controller, "started") === 1)) return false;
  if (
    (!__intrinsic__isReadableStreamLocked(stream) ||
      !__intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(stream, "reader"), "readRequests")?.isNotEmpty()) &&
    __intrinsic__readableStreamDefaultControllerGetDesiredSize(controller) <= 0
  )
    return false;
  const desiredSize = __intrinsic__readableStreamDefaultControllerGetDesiredSize(controller);
  (IS_BUN_DEVELOPMENT?$assert(desiredSize !== null,"desiredSize !== null"):void 0);
  return desiredSize > 0;
}).$$capture_end$$;
