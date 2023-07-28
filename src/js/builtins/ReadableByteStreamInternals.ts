/*
 * Copyright (C) 2016 Canon Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
// @internal

export function privateInitializeReadableByteStreamController(this, stream, underlyingByteSource, highWaterMark) {
  if (!$isReadableStream(stream)) throw new TypeError("ReadableByteStreamController needs a ReadableStream");

  // readableStreamController is initialized with null value.
  if ($getByIdDirectPrivate(stream, "readableStreamController") !== null)
    throw new TypeError("ReadableStream already has a controller");

  $putByIdDirectPrivate(this, "controlledReadableStream", stream);
  $putByIdDirectPrivate(this, "underlyingByteSource", underlyingByteSource);
  $putByIdDirectPrivate(this, "pullAgain", false);
  $putByIdDirectPrivate(this, "pulling", false);
  $readableByteStreamControllerClearPendingPullIntos(this);
  $putByIdDirectPrivate(this, "queue", $newQueue());
  $putByIdDirectPrivate(this, "started", 0);
  $putByIdDirectPrivate(this, "closeRequested", false);

  let hwm = $toNumber(highWaterMark);
  if (hwm !== hwm || hwm < 0) throw new RangeError("highWaterMark value is negative or not a number");
  $putByIdDirectPrivate(this, "strategyHWM", hwm);

  let autoAllocateChunkSize = underlyingByteSource.autoAllocateChunkSize;
  if (autoAllocateChunkSize !== undefined) {
    autoAllocateChunkSize = $toNumber(autoAllocateChunkSize);
    if (autoAllocateChunkSize <= 0 || autoAllocateChunkSize === Infinity || autoAllocateChunkSize === -Infinity)
      throw new RangeError("autoAllocateChunkSize value is negative or equal to positive or negative infinity");
  }
  $putByIdDirectPrivate(this, "autoAllocateChunkSize", autoAllocateChunkSize);
  $putByIdDirectPrivate(this, "pendingPullIntos", $createFIFO());

  const controller = this;
  $promiseInvokeOrNoopNoCatch($getByIdDirectPrivate(controller, "underlyingByteSource"), "start", [controller]).$then(
    () => {
      $putByIdDirectPrivate(controller, "started", 1);
      $assert(!$getByIdDirectPrivate(controller, "pulling"));
      $assert(!$getByIdDirectPrivate(controller, "pullAgain"));
      $readableByteStreamControllerCallPullIfNeeded(controller);
    },
    error => {
      if ($getByIdDirectPrivate(stream, "state") === $streamReadable)
        $readableByteStreamControllerError(controller, error);
    },
  );

  $putByIdDirectPrivate(this, "cancel", $readableByteStreamControllerCancel);
  $putByIdDirectPrivate(this, "pull", $readableByteStreamControllerPull);

  return this;
}

export function readableStreamByteStreamControllerStart(this, controller) {
  $putByIdDirectPrivate(controller, "start", undefined);
}

export function privateInitializeReadableStreamBYOBRequest(this, controller, view) {
  $putByIdDirectPrivate(this, "associatedReadableByteStreamController", controller);
  $putByIdDirectPrivate(this, "view", view);
}

export function isReadableByteStreamController(controller) {
  // Same test mechanism as in isReadableStreamDefaultController (ReadableStreamInternals.js).
  // See corresponding function for explanations.
  return $isObject(controller) && !!$getByIdDirectPrivate(controller, "underlyingByteSource");
}

export function isReadableStreamBYOBRequest(byobRequest) {
  // Same test mechanism as in isReadableStreamDefaultController (ReadableStreamInternals.js).
  // See corresponding function for explanations.
  return $isObject(byobRequest) && !!$getByIdDirectPrivate(byobRequest, "associatedReadableByteStreamController");
}

export function isReadableStreamBYOBReader(reader) {
  // Spec tells to return true only if reader has a readIntoRequests internal slot.
  // However, since it is a private slot, it cannot be checked using hasOwnProperty().
  // Since readIntoRequests is initialized with an empty array, the following test is ok.
  return $isObject(reader) && !!$getByIdDirectPrivate(reader, "readIntoRequests");
}

export function readableByteStreamControllerCancel(controller, reason) {
  var pendingPullIntos = $getByIdDirectPrivate(controller, "pendingPullIntos");
  var first = pendingPullIntos.peek();
  if (first) first.bytesFilled = 0;

  $putByIdDirectPrivate(controller, "queue", $newQueue());
  return $promiseInvokeOrNoop($getByIdDirectPrivate(controller, "underlyingByteSource"), "cancel", [reason]);
}

export function readableByteStreamControllerError(controller, e) {
  $assert(
    $getByIdDirectPrivate($getByIdDirectPrivate(controller, "controlledReadableStream"), "state") === $streamReadable,
  );
  $readableByteStreamControllerClearPendingPullIntos(controller);
  $putByIdDirectPrivate(controller, "queue", $newQueue());
  $readableStreamError($getByIdDirectPrivate(controller, "controlledReadableStream"), e);
}

export function readableByteStreamControllerClose(controller) {
  $assert(!$getByIdDirectPrivate(controller, "closeRequested"));
  $assert(
    $getByIdDirectPrivate($getByIdDirectPrivate(controller, "controlledReadableStream"), "state") === $streamReadable,
  );

  if ($getByIdDirectPrivate(controller, "queue").size > 0) {
    $putByIdDirectPrivate(controller, "closeRequested", true);
    return;
  }

  var first = $getByIdDirectPrivate(controller, "pendingPullIntos")?.peek();
  if (first) {
    if (first.bytesFilled > 0) {
      const e = $makeTypeError("Close requested while there remain pending bytes");
      $readableByteStreamControllerError(controller, e);
      throw e;
    }
  }

  $readableStreamClose($getByIdDirectPrivate(controller, "controlledReadableStream"));
}

export function readableByteStreamControllerClearPendingPullIntos(controller) {
  $readableByteStreamControllerInvalidateBYOBRequest(controller);
  var existing = $getByIdDirectPrivate(controller, "pendingPullIntos");
  if (existing !== undefined) {
    existing.clear();
  } else {
    $putByIdDirectPrivate(controller, "pendingPullIntos", $createFIFO());
  }
}

export function readableByteStreamControllerGetDesiredSize(controller) {
  const stream = $getByIdDirectPrivate(controller, "controlledReadableStream");
  const state = $getByIdDirectPrivate(stream, "state");

  if (state === $streamErrored) return null;
  if (state === $streamClosed) return 0;

  return $getByIdDirectPrivate(controller, "strategyHWM") - $getByIdDirectPrivate(controller, "queue").size;
}

export function readableStreamHasBYOBReader(stream) {
  const reader = $getByIdDirectPrivate(stream, "reader");
  return reader !== undefined && $isReadableStreamBYOBReader(reader);
}

export function readableStreamHasDefaultReader(stream) {
  const reader = $getByIdDirectPrivate(stream, "reader");
  return reader !== undefined && $isReadableStreamDefaultReader(reader);
}

export function readableByteStreamControllerHandleQueueDrain(controller) {
  $assert(
    $getByIdDirectPrivate($getByIdDirectPrivate(controller, "controlledReadableStream"), "state") === $streamReadable,
  );
  if (!$getByIdDirectPrivate(controller, "queue").size && $getByIdDirectPrivate(controller, "closeRequested"))
    $readableStreamClose($getByIdDirectPrivate(controller, "controlledReadableStream"));
  else $readableByteStreamControllerCallPullIfNeeded(controller);
}

export function readableByteStreamControllerPull(controller) {
  const stream = $getByIdDirectPrivate(controller, "controlledReadableStream");
  $assert($readableStreamHasDefaultReader(stream));
  if ($getByIdDirectPrivate(controller, "queue").content?.isNotEmpty()) {
    const entry = $getByIdDirectPrivate(controller, "queue").content.shift();
    $getByIdDirectPrivate(controller, "queue").size -= entry.byteLength;
    $readableByteStreamControllerHandleQueueDrain(controller);
    let view;
    try {
      view = new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
    } catch (error) {
      return Promise.$reject(error);
    }
    return $createFulfilledPromise({ value: view, done: false });
  }

  if ($getByIdDirectPrivate(controller, "autoAllocateChunkSize") !== undefined) {
    let buffer;
    try {
      buffer = $createUninitializedArrayBuffer($getByIdDirectPrivate(controller, "autoAllocateChunkSize"));
    } catch (error) {
      return Promise.$reject(error);
    }
    const pullIntoDescriptor = {
      buffer,
      byteOffset: 0,
      byteLength: $getByIdDirectPrivate(controller, "autoAllocateChunkSize"),
      bytesFilled: 0,
      elementSize: 1,
      ctor: Uint8Array,
      readerType: "default",
    };
    $getByIdDirectPrivate(controller, "pendingPullIntos").push(pullIntoDescriptor);
  }

  const promise = $readableStreamAddReadRequest(stream);
  $readableByteStreamControllerCallPullIfNeeded(controller);
  return promise;
}

export function readableByteStreamControllerShouldCallPull(controller) {
  const stream = $getByIdDirectPrivate(controller, "controlledReadableStream");

  if ($getByIdDirectPrivate(stream, "state") !== $streamReadable) return false;
  if ($getByIdDirectPrivate(controller, "closeRequested")) return false;
  if (!($getByIdDirectPrivate(controller, "started") > 0)) return false;
  const reader = $getByIdDirectPrivate(stream, "reader");

  if (
    reader &&
    ($getByIdDirectPrivate(reader, "readRequests")?.isNotEmpty() || !!$getByIdDirectPrivate(reader, "bunNativePtr"))
  )
    return true;
  if (
    $readableStreamHasBYOBReader(stream) &&
    $getByIdDirectPrivate($getByIdDirectPrivate(stream, "reader"), "readIntoRequests")?.isNotEmpty()
  )
    return true;
  if ($readableByteStreamControllerGetDesiredSize(controller) > 0) return true;
  return false;
}

export function readableByteStreamControllerCallPullIfNeeded(controller) {
  if (!$readableByteStreamControllerShouldCallPull(controller)) return;

  if ($getByIdDirectPrivate(controller, "pulling")) {
    $putByIdDirectPrivate(controller, "pullAgain", true);
    return;
  }

  $assert(!$getByIdDirectPrivate(controller, "pullAgain"));
  $putByIdDirectPrivate(controller, "pulling", true);
  $promiseInvokeOrNoop($getByIdDirectPrivate(controller, "underlyingByteSource"), "pull", [controller]).$then(
    () => {
      $putByIdDirectPrivate(controller, "pulling", false);
      if ($getByIdDirectPrivate(controller, "pullAgain")) {
        $putByIdDirectPrivate(controller, "pullAgain", false);
        $readableByteStreamControllerCallPullIfNeeded(controller);
      }
    },
    error => {
      if (
        $getByIdDirectPrivate($getByIdDirectPrivate(controller, "controlledReadableStream"), "state") ===
        $streamReadable
      )
        $readableByteStreamControllerError(controller, error);
    },
  );
}

export function transferBufferToCurrentRealm(buffer) {
  // FIXME: Determine what should be done here exactly (what is already existing in current
  // codebase and what has to be added). According to spec, Transfer operation should be
  // performed in order to transfer buffer to current realm. For the moment, simply return
  // received buffer.
  return buffer;
}

export function readableStreamReaderKind(reader) {
  if (!!$getByIdDirectPrivate(reader, "readRequests")) return $getByIdDirectPrivate(reader, "bunNativePtr") ? 3 : 1;

  if (!!$getByIdDirectPrivate(reader, "readIntoRequests")) return 2;

  return 0;
}

export function readableByteStreamControllerEnqueue(controller, chunk) {
  const stream = $getByIdDirectPrivate(controller, "controlledReadableStream");
  $assert(!$getByIdDirectPrivate(controller, "closeRequested"));
  $assert($getByIdDirectPrivate(stream, "state") === $streamReadable);

  switch (
    $getByIdDirectPrivate(stream, "reader") ? $readableStreamReaderKind($getByIdDirectPrivate(stream, "reader")) : 0
  ) {
    /* default reader */
    case 1: {
      if (!$getByIdDirectPrivate($getByIdDirectPrivate(stream, "reader"), "readRequests")?.isNotEmpty())
        $readableByteStreamControllerEnqueueChunk(
          controller,
          $transferBufferToCurrentRealm(chunk.buffer),
          chunk.byteOffset,
          chunk.byteLength,
        );
      else {
        $assert(!$getByIdDirectPrivate(controller, "queue").content.size());
        const transferredView =
          chunk.constructor === Uint8Array ? chunk : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        $readableStreamFulfillReadRequest(stream, transferredView, false);
      }
      break;
    }

    /* BYOB */
    case 2: {
      $readableByteStreamControllerEnqueueChunk(
        controller,
        $transferBufferToCurrentRealm(chunk.buffer),
        chunk.byteOffset,
        chunk.byteLength,
      );
      $readableByteStreamControllerProcessPullDescriptors(controller);
      break;
    }

    /* NativeReader */
    case 3: {
      // reader.$enqueueNative($getByIdDirectPrivate(reader, "bunNativePtr"), chunk);

      break;
    }

    default: {
      $assert(!$isReadableStreamLocked(stream));
      $readableByteStreamControllerEnqueueChunk(
        controller,
        $transferBufferToCurrentRealm(chunk.buffer),
        chunk.byteOffset,
        chunk.byteLength,
      );
      break;
    }
  }
}

// Spec name: readableByteStreamControllerEnqueueChunkToQueue.
export function readableByteStreamControllerEnqueueChunk(controller, buffer, byteOffset, byteLength) {
  $getByIdDirectPrivate(controller, "queue").content.push({
    buffer: buffer,
    byteOffset: byteOffset,
    byteLength: byteLength,
  });
  $getByIdDirectPrivate(controller, "queue").size += byteLength;
}

export function readableByteStreamControllerRespondWithNewView(controller, view) {
  $assert($getByIdDirectPrivate(controller, "pendingPullIntos").isNotEmpty());

  let firstDescriptor = $getByIdDirectPrivate(controller, "pendingPullIntos").peek();

  if (firstDescriptor.byteOffset + firstDescriptor.bytesFilled !== view.byteOffset)
    throw new RangeError("Invalid value for view.byteOffset");

  if (firstDescriptor.byteLength !== view.byteLength) throw new RangeError("Invalid value for view.byteLength");

  firstDescriptor.buffer = view.buffer;
  $readableByteStreamControllerRespondInternal(controller, view.byteLength);
}

export function readableByteStreamControllerRespond(controller, bytesWritten) {
  bytesWritten = $toNumber(bytesWritten);

  if (bytesWritten !== bytesWritten || bytesWritten === Infinity || bytesWritten < 0)
    throw new RangeError("bytesWritten has an incorrect value");

  $assert($getByIdDirectPrivate(controller, "pendingPullIntos").isNotEmpty());

  $readableByteStreamControllerRespondInternal(controller, bytesWritten);
}

export function readableByteStreamControllerRespondInternal(controller, bytesWritten) {
  let firstDescriptor = $getByIdDirectPrivate(controller, "pendingPullIntos").peek();
  let stream = $getByIdDirectPrivate(controller, "controlledReadableStream");

  if ($getByIdDirectPrivate(stream, "state") === $streamClosed) {
    if (bytesWritten !== 0) throw new TypeError("bytesWritten is different from 0 even though stream is closed");
    $readableByteStreamControllerRespondInClosedState(controller, firstDescriptor);
  } else {
    $assert($getByIdDirectPrivate(stream, "state") === $streamReadable);
    $readableByteStreamControllerRespondInReadableState(controller, bytesWritten, firstDescriptor);
  }
}

export function readableByteStreamControllerRespondInReadableState(controller, bytesWritten, pullIntoDescriptor) {
  if (pullIntoDescriptor.bytesFilled + bytesWritten > pullIntoDescriptor.byteLength)
    throw new RangeError("bytesWritten value is too great");

  $assert(
    $getByIdDirectPrivate(controller, "pendingPullIntos").isEmpty() ||
      $getByIdDirectPrivate(controller, "pendingPullIntos").peek() === pullIntoDescriptor,
  );
  $readableByteStreamControllerInvalidateBYOBRequest(controller);
  pullIntoDescriptor.bytesFilled += bytesWritten;

  if (pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize) return;

  $readableByteStreamControllerShiftPendingDescriptor(controller);
  const remainderSize = pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize;

  if (remainderSize > 0) {
    const end = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
    const remainder = $cloneArrayBuffer(pullIntoDescriptor.buffer, end - remainderSize, remainderSize);
    $readableByteStreamControllerEnqueueChunk(controller, remainder, 0, remainder.byteLength);
  }

  pullIntoDescriptor.buffer = $transferBufferToCurrentRealm(pullIntoDescriptor.buffer);
  pullIntoDescriptor.bytesFilled -= remainderSize;
  $readableByteStreamControllerCommitDescriptor(
    $getByIdDirectPrivate(controller, "controlledReadableStream"),
    pullIntoDescriptor,
  );
  $readableByteStreamControllerProcessPullDescriptors(controller);
}

export function readableByteStreamControllerRespondInClosedState(controller, firstDescriptor) {
  firstDescriptor.buffer = $transferBufferToCurrentRealm(firstDescriptor.buffer);
  $assert(firstDescriptor.bytesFilled === 0);

  if ($readableStreamHasBYOBReader($getByIdDirectPrivate(controller, "controlledReadableStream"))) {
    while (
      $getByIdDirectPrivate(
        $getByIdDirectPrivate($getByIdDirectPrivate(controller, "controlledReadableStream"), "reader"),
        "readIntoRequests",
      )?.isNotEmpty()
    ) {
      let pullIntoDescriptor = $readableByteStreamControllerShiftPendingDescriptor(controller);
      $readableByteStreamControllerCommitDescriptor(
        $getByIdDirectPrivate(controller, "controlledReadableStream"),
        pullIntoDescriptor,
      );
    }
  }
}

// Spec name: readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue (shortened for readability).
export function readableByteStreamControllerProcessPullDescriptors(controller) {
  $assert(!$getByIdDirectPrivate(controller, "closeRequested"));
  while ($getByIdDirectPrivate(controller, "pendingPullIntos").isNotEmpty()) {
    if ($getByIdDirectPrivate(controller, "queue").size === 0) return;
    let pullIntoDescriptor = $getByIdDirectPrivate(controller, "pendingPullIntos").peek();
    if ($readableByteStreamControllerFillDescriptorFromQueue(controller, pullIntoDescriptor)) {
      $readableByteStreamControllerShiftPendingDescriptor(controller);
      $readableByteStreamControllerCommitDescriptor(
        $getByIdDirectPrivate(controller, "controlledReadableStream"),
        pullIntoDescriptor,
      );
    }
  }
}

// Spec name: readableByteStreamControllerFillPullIntoDescriptorFromQueue (shortened for readability).
export function readableByteStreamControllerFillDescriptorFromQueue(controller, pullIntoDescriptor) {
  const currentAlignedBytes =
    pullIntoDescriptor.bytesFilled - (pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize);
  const maxBytesToCopy =
    $getByIdDirectPrivate(controller, "queue").size < pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled
      ? $getByIdDirectPrivate(controller, "queue").size
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
    let headOfQueue = $getByIdDirectPrivate(controller, "queue").content.peek();
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

    if (headOfQueue.byteLength === bytesToCopy) $getByIdDirectPrivate(controller, "queue").content.shift();
    else {
      headOfQueue.byteOffset += bytesToCopy;
      headOfQueue.byteLength -= bytesToCopy;
    }

    $getByIdDirectPrivate(controller, "queue").size -= bytesToCopy;
    $assert(
      $getByIdDirectPrivate(controller, "pendingPullIntos").isEmpty() ||
        $getByIdDirectPrivate(controller, "pendingPullIntos").peek() === pullIntoDescriptor,
    );
    $readableByteStreamControllerInvalidateBYOBRequest(controller);
    pullIntoDescriptor.bytesFilled += bytesToCopy;
    totalBytesToCopyRemaining -= bytesToCopy;
  }

  if (!ready) {
    $assert($getByIdDirectPrivate(controller, "queue").size === 0);
    $assert(pullIntoDescriptor.bytesFilled > 0);
    $assert(pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize);
  }

  return ready;
}

// Spec name: readableByteStreamControllerShiftPendingPullInto (renamed for consistency).
export function readableByteStreamControllerShiftPendingDescriptor(controller) {
  let descriptor = $getByIdDirectPrivate(controller, "pendingPullIntos").shift();
  $readableByteStreamControllerInvalidateBYOBRequest(controller);
  return descriptor;
}

export function readableByteStreamControllerInvalidateBYOBRequest(controller) {
  if ($getByIdDirectPrivate(controller, "byobRequest") === undefined) return;
  const byobRequest = $getByIdDirectPrivate(controller, "byobRequest");
  $putByIdDirectPrivate(byobRequest, "associatedReadableByteStreamController", undefined);
  $putByIdDirectPrivate(byobRequest, "view", undefined);
  $putByIdDirectPrivate(controller, "byobRequest", undefined);
}

// Spec name: readableByteStreamControllerCommitPullIntoDescriptor (shortened for readability).
export function readableByteStreamControllerCommitDescriptor(stream, pullIntoDescriptor) {
  $assert($getByIdDirectPrivate(stream, "state") !== $streamErrored);
  let done = false;
  if ($getByIdDirectPrivate(stream, "state") === $streamClosed) {
    $assert(!pullIntoDescriptor.bytesFilled);
    done = true;
  }
  let filledView = $readableByteStreamControllerConvertDescriptor(pullIntoDescriptor);
  if (pullIntoDescriptor.readerType === "default") $readableStreamFulfillReadRequest(stream, filledView, done);
  else {
    $assert(pullIntoDescriptor.readerType === "byob");
    $readableStreamFulfillReadIntoRequest(stream, filledView, done);
  }
}

// Spec name: readableByteStreamControllerConvertPullIntoDescriptor (shortened for readability).
export function readableByteStreamControllerConvertDescriptor(pullIntoDescriptor) {
  $assert(pullIntoDescriptor.bytesFilled <= pullIntoDescriptor.byteLength);
  $assert(pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize === 0);

  return new pullIntoDescriptor.ctor(
    pullIntoDescriptor.buffer,
    pullIntoDescriptor.byteOffset,
    pullIntoDescriptor.bytesFilled / pullIntoDescriptor.elementSize,
  );
}

export function readableStreamFulfillReadIntoRequest(stream, chunk, done) {
  const readIntoRequest = $getByIdDirectPrivate($getByIdDirectPrivate(stream, "reader"), "readIntoRequests").shift();
  $fulfillPromise(readIntoRequest, { value: chunk, done: done });
}

export function readableStreamBYOBReaderRead(reader, view) {
  const stream = $getByIdDirectPrivate(reader, "ownerReadableStream");
  $assert(!!stream);

  $putByIdDirectPrivate(stream, "disturbed", true);
  if ($getByIdDirectPrivate(stream, "state") === $streamErrored)
    return Promise.$reject($getByIdDirectPrivate(stream, "storedError"));

  return $readableByteStreamControllerPullInto($getByIdDirectPrivate(stream, "readableStreamController"), view);
}

export function readableByteStreamControllerPullInto(controller, view) {
  const stream = $getByIdDirectPrivate(controller, "controlledReadableStream");
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

  var pending = $getByIdDirectPrivate(controller, "pendingPullIntos");
  if (pending?.isNotEmpty()) {
    pullIntoDescriptor.buffer = $transferBufferToCurrentRealm(pullIntoDescriptor.buffer);
    pending.push(pullIntoDescriptor);
    return $readableStreamAddReadIntoRequest(stream);
  }

  if ($getByIdDirectPrivate(stream, "state") === $streamClosed) {
    const emptyView = new ctor(pullIntoDescriptor.buffer, pullIntoDescriptor.byteOffset, 0);
    return $createFulfilledPromise({ value: emptyView, done: true });
  }

  if ($getByIdDirectPrivate(controller, "queue").size > 0) {
    if ($readableByteStreamControllerFillDescriptorFromQueue(controller, pullIntoDescriptor)) {
      const filledView = $readableByteStreamControllerConvertDescriptor(pullIntoDescriptor);
      $readableByteStreamControllerHandleQueueDrain(controller);
      return $createFulfilledPromise({ value: filledView, done: false });
    }
    if ($getByIdDirectPrivate(controller, "closeRequested")) {
      const e = $makeTypeError("Closing stream has been requested");
      $readableByteStreamControllerError(controller, e);
      return Promise.$reject(e);
    }
  }

  pullIntoDescriptor.buffer = $transferBufferToCurrentRealm(pullIntoDescriptor.buffer);
  $getByIdDirectPrivate(controller, "pendingPullIntos").push(pullIntoDescriptor);
  const promise = $readableStreamAddReadIntoRequest(stream);
  $readableByteStreamControllerCallPullIfNeeded(controller);
  return promise;
}

export function readableStreamAddReadIntoRequest(stream) {
  $assert($isReadableStreamBYOBReader($getByIdDirectPrivate(stream, "reader")));
  $assert(
    $getByIdDirectPrivate(stream, "state") === $streamReadable ||
      $getByIdDirectPrivate(stream, "state") === $streamClosed,
  );

  const readRequest = $newPromise();
  $getByIdDirectPrivate($getByIdDirectPrivate(stream, "reader"), "readIntoRequests").push(readRequest);

  return readRequest;
}
