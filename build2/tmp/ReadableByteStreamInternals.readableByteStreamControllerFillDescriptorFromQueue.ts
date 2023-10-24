// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,pullIntoDescriptor) {  const currentAlignedBytes =
    pullIntoDescriptor.bytesFilled - (pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize);
  const maxBytesToCopy =
    __intrinsic__getByIdDirectPrivate(controller, "queue").size < pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled
      ? __intrinsic__getByIdDirectPrivate(controller, "queue").size
      : pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled;
  const maxBytesFilled = pullIntoDescriptor.bytesFilled + maxBytesToCopy;
  const maxAlignedBytes = maxBytesFilled - (maxBytesFilled % pullIntoDescriptor.elementSize);
  let totalBytesToCopyRemaining = maxBytesToCopy;
  let ready = false;

  if (maxAlignedBytes > currentAlignedBytes) {
    totalBytesToCopyRemaining = maxAlignedBytes - pullIntoDescriptor.bytesFilled;
    ready = true;
  }

  while (totalBytesToCopyRemaining > 0) {
    let headOfQueue = __intrinsic__getByIdDirectPrivate(controller, "queue").content.peek();
    const bytesToCopy =
      totalBytesToCopyRemaining < headOfQueue.byteLength ? totalBytesToCopyRemaining : headOfQueue.byteLength;
    // Copy appropriate part of pullIntoDescriptor.buffer to headOfQueue.buffer.
    // Remark: this implementation is not completely aligned on the definition of CopyDataBlockBytes
    // operation of ECMAScript (the case of Shared Data Block is not considered here, but it doesn't seem to be an issue).
    const destStart = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
    // FIXME: As indicated in comments of bug 172717, access to set is not safe. However, using prototype.$set.$call does
    // not work ($set is undefined). A safe way to do that is needed.
    new Uint8Array(pullIntoDescriptor.buffer).set(
      new Uint8Array(headOfQueue.buffer, headOfQueue.byteOffset, bytesToCopy),
      destStart,
    );

    if (headOfQueue.byteLength === bytesToCopy) __intrinsic__getByIdDirectPrivate(controller, "queue").content.shift();
    else {
      headOfQueue.byteOffset += bytesToCopy;
      headOfQueue.byteLength -= bytesToCopy;
    }

    __intrinsic__getByIdDirectPrivate(controller, "queue").size -= bytesToCopy;
    (IS_BUN_DEVELOPMENT?$assert(
      __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos").isEmpty() ||
        __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos").peek() === pullIntoDescriptor,"$getByIdDirectPrivate(controller, \"pendingPullIntos\").isEmpty() ||\n        $getByIdDirectPrivate(controller, \"pendingPullIntos\").peek() === pullIntoDescriptor"):void 0);
    __intrinsic__readableByteStreamControllerInvalidateBYOBRequest(controller);
    pullIntoDescriptor.bytesFilled += bytesToCopy;
    totalBytesToCopyRemaining -= bytesToCopy;
  }

  if (!ready) {
    (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(controller, "queue").size === 0,"$getByIdDirectPrivate(controller, \"queue\").size === 0"):void 0);
    (IS_BUN_DEVELOPMENT?$assert(pullIntoDescriptor.bytesFilled > 0,"pullIntoDescriptor.bytesFilled > 0"):void 0);
    (IS_BUN_DEVELOPMENT?$assert(pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize,"pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize"):void 0);
  }

  return ready;
}).$$capture_end$$;
