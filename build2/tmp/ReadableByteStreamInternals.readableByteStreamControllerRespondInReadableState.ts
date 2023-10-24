// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,bytesWritten,pullIntoDescriptor) {  if (pullIntoDescriptor.bytesFilled + bytesWritten > pullIntoDescriptor.byteLength)
    __intrinsic__throwRangeError("bytesWritten value is too great");

  (IS_BUN_DEVELOPMENT?$assert(
    __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos").isEmpty() ||
      __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos").peek() === pullIntoDescriptor,"$getByIdDirectPrivate(controller, \"pendingPullIntos\").isEmpty() ||\n      $getByIdDirectPrivate(controller, \"pendingPullIntos\").peek() === pullIntoDescriptor"):void 0);
  __intrinsic__readableByteStreamControllerInvalidateBYOBRequest(controller);
  pullIntoDescriptor.bytesFilled += bytesWritten;

  if (pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize) return;

  __intrinsic__readableByteStreamControllerShiftPendingDescriptor(controller);
  const remainderSize = pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize;

  if (remainderSize > 0) {
    const end = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
    const remainder = __intrinsic__cloneArrayBuffer(pullIntoDescriptor.buffer, end - remainderSize, remainderSize);
    __intrinsic__readableByteStreamControllerEnqueueChunk(controller, remainder, 0, remainder.byteLength);
  }

  pullIntoDescriptor.buffer = __intrinsic__transferBufferToCurrentRealm(pullIntoDescriptor.buffer);
  pullIntoDescriptor.bytesFilled -= remainderSize;
  __intrinsic__readableByteStreamControllerCommitDescriptor(
    __intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"),
    pullIntoDescriptor,
  );
  __intrinsic__readableByteStreamControllerProcessPullDescriptors(controller);
}).$$capture_end$$;
