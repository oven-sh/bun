// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller) {  (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__getByIdDirectPrivate(controller, "closeRequested"),"!$getByIdDirectPrivate(controller, \"closeRequested\")"):void 0);
  while (__intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos").isNotEmpty()) {
    if (__intrinsic__getByIdDirectPrivate(controller, "queue").size === 0) return;
    let pullIntoDescriptor = __intrinsic__getByIdDirectPrivate(controller, "pendingPullIntos").peek();
    if (__intrinsic__readableByteStreamControllerFillDescriptorFromQueue(controller, pullIntoDescriptor)) {
      __intrinsic__readableByteStreamControllerShiftPendingDescriptor(controller);
      __intrinsic__readableByteStreamControllerCommitDescriptor(
        __intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"),
        pullIntoDescriptor,
      );
    }
  }
}).$$capture_end$$;
