// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream");
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__readableStreamHasDefaultReader(stream),"$readableStreamHasDefaultReader(stream)"):void 0);
  if (__intrinsic__getByIdDirectPrivate(controller, "queue").content?.isNotEmpty()) {
    const entry = __intrinsic__getByIdDirectPrivate(controller, "queue").content.shift();
    __intrinsic__getByIdDirectPrivate(controller, "queue").size -= entry.byteLength;
    __intrinsic__readableByteStreamControllerHandleQueueDrain(controller);
    let view;
    try {
      view = new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
    } catch (error) {
      return Promise.__intrinsic__reject(error);
    }
    return __intrinsic__createFulfilledPromise({ value: view, done: false });
  }

  if (__intrinsic__getByIdDirectPrivate(controller, "autoAllocateChunkSize") !== undefined) {
    let buffer;
    try {
      buffer = __intrinsic__createUninitializedArrayBuffer(__intrinsic__getByIdDirectPrivate(controller, "autoAllocateChunkSize"));
    } catch (error) {
      return Promise.__intrinsic__reject(error);
    }
    const pullIntoDescriptor = {
      buffer,
      byteOffset: 0,
      byteLength: __intrinsic__getByIdDirectPrivate(controller, "autoAllocateChunkSize"),
      bytesFilled: 0,
      elementSize: 1,
      ctor: Uint8Array,
      readerType: "default",
    };
    __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos").push(pullIntoDescriptor);
  }

  const promise = __intrinsic__readableStreamAddReadRequest(stream);
  __intrinsic__readableByteStreamControllerCallPullIfNeeded(controller);
  return promise;
}).$$capture_end$$;
