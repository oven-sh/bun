// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableByteStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(controller,chunk) {  const stream = __intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream");
  (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__getByIdDirectPrivate(controller, "closeRequested"),"!$getByIdDirectPrivate(controller, \"closeRequested\")"):void 0);
  (IS_BUN_DEVELOPMENT?$assert(__intrinsic__getByIdDirectPrivate(stream, "state") === __intrinsic__streamReadable,"$getByIdDirectPrivate(stream, \"state\") === $streamReadable"):void 0);

  switch (
    __intrinsic__getByIdDirectPrivate(stream, "reader") ? __intrinsic__readableStreamReaderKind(__intrinsic__getByIdDirectPrivate(stream, "reader")) : 0
  ) {
    /* default reader */
    case 1: {
      if (!__intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(stream, "reader"), "readRequests")?.isNotEmpty())
        __intrinsic__readableByteStreamControllerEnqueueChunk(
          controller,
          __intrinsic__transferBufferToCurrentRealm(chunk.buffer),
          chunk.byteOffset,
          chunk.byteLength,
        );
      else {
        (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__getByIdDirectPrivate(controller, "queue").content.size(),"!$getByIdDirectPrivate(controller, \"queue\").content.size()"):void 0);
        const transferredView =
          chunk.constructor === Uint8Array ? chunk : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        __intrinsic__readableStreamFulfillReadRequest(stream, transferredView, false);
      }
      break;
    }

    /* BYOB */
    case 2: {
      __intrinsic__readableByteStreamControllerEnqueueChunk(
        controller,
        __intrinsic__transferBufferToCurrentRealm(chunk.buffer),
        chunk.byteOffset,
        chunk.byteLength,
      );
      __intrinsic__readableByteStreamControllerProcessPullDescriptors(controller);
      break;
    }

    /* NativeReader */
    case 3: {
      // reader.$enqueueNative($getByIdDirectPrivate(reader, "bunNativePtr"), chunk);

      break;
    }

    default: {
      (IS_BUN_DEVELOPMENT?$assert(!__intrinsic__isReadableStreamLocked(stream),"!$isReadableStreamLocked(stream)"):void 0);
      __intrinsic__readableByteStreamControllerEnqueueChunk(
        controller,
        __intrinsic__transferBufferToCurrentRealm(chunk.buffer),
        chunk.byteOffset,
        chunk.byteLength,
      );
      break;
    }
  }
}).$$capture_end$$;
