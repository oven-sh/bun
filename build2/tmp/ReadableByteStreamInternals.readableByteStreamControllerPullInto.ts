// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,view) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream");
  let elementSize = 1;
  // Spec describes that in the case where view is a TypedArray, elementSize
  // should be set to the size of an element (e.g. 2 for UInt16Array). For
  // DataView, BYTES_PER_ELEMENT is undefined, contrary to the same property
  // for TypedArrays.
  // FIXME: Getting BYTES_PER_ELEMENT like this is not safe (property is read-only
  // but can be modified if the prototype is redefined). A safe way of getting
  // it would be to determine which type of ArrayBufferView view is an instance
  // of based on typed arrays private variables. However, this is not possible due
  // to bug 167697, which prevents access to typed arrays through their private
  // names unless public name has already been met before.
  if (view.BYTES_PER_ELEMENT !== undefined) elementSize = view.BYTES_PER_ELEMENT;

  // FIXME: Getting constructor like this is not safe. A safe way of getting
  // it would be to determine which type of ArrayBufferView view is an instance
  // of, and to assign appropriate constructor based on this (e.g. ctor =
  // $Uint8Array). However, this is not possible due to bug 167697, which
  // prevents access to typed arrays through their private names unless public
  // name has already been met before.
  const ctor = view.constructor;

  const pullIntoDescriptor = {
    buffer: view.buffer,
    byteOffset: view.byteOffset,
    byteLength: view.byteLength,
    bytesFilled: 0,
    elementSize,
    ctor,
    readerType: "byob",
  };

  var pending = __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos");
  if (pending?.isNotEmpty()) {
    pullIntoDescriptor.buffer = __intrinsic__transferBufferToCurrentRealm(pullIntoDescriptor.buffer);
    pending.push(pullIntoDescriptor);
    return __intrinsic__readableStreamAddReadIntoRequest(stream);
  }

  if (__intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamClosed) {
    const emptyView = new ctor(pullIntoDescriptor.buffer, pullIntoDescriptor.byteOffset, 0);
    return __intrinsic__createFulfilledPromise({ value: emptyView, done: true });
  }

  if (__intrinsic__getByIdDirectPrivate(controller, "queue").size > 0) {
    if (__intrinsic__readableByteStreamControllerFillDescriptorFromQueue(controller, pullIntoDescriptor)) {
      const filledView = __intrinsic__readableByteStreamControllerConvertDescriptor(pullIntoDescriptor);
      __intrinsic__readableByteStreamControllerHandleQueueDrain(controller);
      return __intrinsic__createFulfilledPromise({ value: filledView, done: false });
    }
    if (__intrinsic__getByIdDirectPrivate(controller, "closeRequested")) {
      const e = __intrinsic__makeTypeError("Closing stream has been requested");
      __intrinsic__readableByteStreamControllerError(controller, e);
      return Promise.__intrinsic__reject(e);
    }
  }

  pullIntoDescriptor.buffer = __intrinsic__transferBufferToCurrentRealm(pullIntoDescriptor.buffer);
  __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos").push(pullIntoDescriptor);
  const promise = __intrinsic__readableStreamAddReadIntoRequest(stream);
  __intrinsic__readableByteStreamControllerCallPullIfNeeded(controller);
  return promise;
}).$$capture_end$$;
