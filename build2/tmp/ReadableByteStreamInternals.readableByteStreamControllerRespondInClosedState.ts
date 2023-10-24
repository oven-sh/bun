// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,firstDescriptor) {  firstDescriptor.buffer = __intrinsic__transferBufferToCurrentRealm(firstDescriptor.buffer);
  (IS_BUN_DEVELOPMENT?$assert(firstDescriptor.bytesFilled === 0,"firstDescriptor.bytesFilled === 0"):void 0);

  if (__intrinsic__readableStreamHasBYOBReader(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"))) {
    while (
      __intrinsic__getByIdDirectPrivate(
        __intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"), "reader"),
        "readIntoRequests",
      )?.isNotEmpty()
    ) {
      let pullIntoDescriptor = __intrinsic__readableByteStreamControllerShiftPendingDescriptor(controller);
      __intrinsic__readableByteStreamControllerCommitDescriptor(
        __intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"),
        pullIntoDescriptor,
      );
    }
  }
}).$$capture_end$$;
