/*
 * Copyright (C) 2015 Canon Inc.
 * Copyright (C) 2023-2024 Jarred Sumner. All rights reserved.
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

// Define the missing type for the Bun-specific readMany method
interface ReadableStreamDefaultReadManyResult<R> {
  done: boolean;
  value: R[];
  size: number;
}

// Add missing properties to the interface in builtins.d.ts
// Note: This local declaration adds internal fields specific to Bun's implementation.
// It extends _ReadableStreamDefaultReader which should provide the standard methods.
declare interface ReadableStreamDefaultReader<R = any> extends _ReadableStreamDefaultReader<R> {
  $ownerReadableStream: ReadableStream<R> | undefined;
  $readRequests: ReturnType<typeof $createFIFO>; // Use the actual type from $createFIFO
  $closedPromiseCapability: {
    promise: Promise<void>;
    resolve: (value?: void | PromiseLike<void>) => void; // Adjusted resolve type
    reject: (reason?: any) => void;
  };
}

// This function is likely called internally to initialize a reader instance.
// 'this' refers to the reader instance being initialized.
export function initializeReadableStreamDefaultReader(this: ReadableStreamDefaultReader, stream: ReadableStream) {
  if (!$isReadableStream(stream)) throw new TypeError("ReadableStreamDefaultReader needs a ReadableStream");
  if ($isReadableStreamLocked(stream)) throw new TypeError("ReadableStream is locked");

  // TS2352 fix: Cast 'this' to unknown first to bypass strict structural checks.
  $readableStreamReaderGenericInitialize(this as unknown as $ReadableStreamDefaultReader, stream);
  $putByIdDirectPrivate(this, "readRequests", $createFIFO());

  return this;
}

// Standard cancel method implementation
export function cancel(this: ReadableStreamDefaultReader, reason: any): Promise<void> {
  if (!$isReadableStreamDefaultReader(this)) {
    return Promise.$reject($ERR_INVALID_THIS("ReadableStreamDefaultReader"));
  }

  const ownerStream = $getByIdDirectPrivate(this, "ownerReadableStream");
  if (!ownerStream) {
    return Promise.$reject(new TypeError("cancel() called on a reader owned by no readable stream"));
  }

  // Delegate cancellation to the generic reader cancel function.
  // TS2352 fix: Cast 'this' to unknown first.
  return $readableStreamReaderGenericCancel(this as unknown as $ReadableStreamDefaultReader, reason);
}

// Non-standard readMany method (likely Bun-specific optimization)
export function readMany(this: ReadableStreamDefaultReader): Promise<ReadableStreamDefaultReadManyResult<any>> | ReadableStreamDefaultReadManyResult<any> {
  if (!$isReadableStreamDefaultReader(this)) {
    // Use $ERR_INVALID_THIS for consistency
    throw $ERR_INVALID_THIS("ReadableStreamDefaultReader.readMany()");
  }

  const stream = $getByIdDirectPrivate(this, "ownerReadableStream");
  if (!stream) {
    throw new TypeError("readMany() called on a reader owned by no readable stream");
  }

  const state = $getByIdDirectPrivate(stream, "state");
  // Use $putByIdDirectPrivate for internal properties
  $putByIdDirectPrivate(stream, "disturbed", true);

  if (state === $streamErrored) {
    throw $getByIdDirectPrivate(stream, "storedError");
  }

  // Use correct type union for controller
  var controller = $getByIdDirectPrivate(stream, "readableStreamController") as $ReadableStreamDefaultController | ReadableByteStreamController | $ReadableStreamDirectController | undefined;
  var queue: ReturnType<typeof $createFIFO> | null | undefined = null;

  if (controller) {
    // Access queue only if controller exists
    queue = $getByIdDirectPrivate(controller, "queue");
  }

  // Handle direct stream controller case or default controller pull
  if (!queue && state !== $streamClosed) {
    // TS2339 Fix: Check if it's a default controller and has $pull
    if (controller && $isReadableStreamDefaultController(controller)) {
      // Ensure the result structure matches ReadableStreamDefaultReadManyResult
      // TS2339 Fix: Access $pull only on $ReadableStreamDefaultController
      const pullPromise = (controller as $ReadableStreamDefaultController).$pull(controller);
      if ($isPromise(pullPromise)) {
        return pullPromise.$then(function (result: unknown) {
          const typedResult = result as { done: boolean; value: any };
          const valueArray = typedResult.value !== undefined ? [typedResult.value] : [];
          // TODO: Calculate size properly using strategy if available
          const size = typedResult.done ? 0 : valueArray.length;
          return {
            done: typedResult.done,
            value: valueArray,
            size: size,
          };
        });
      } else {
        // Handle synchronous pull result (though $pull usually returns a promise)
        const result = pullPromise as { done: boolean; value: any };
        const valueArray = result.value !== undefined ? [result.value] : [];
        const size = result.done ? 0 : valueArray.length;
        return {
          done: result.done,
          value: valueArray,
          size: size,
        };
      }
    } else {
      // Handle case where controller is missing, not a default controller, or $pull is missing
      // Or if it's a direct stream without a queue (might need specific handling if applicable)
      return { done: true, value: [], size: 0 };
    }
  } else if (!queue) {
    // Stream is closed and queue is empty or never existed
    return { done: true, value: [], size: 0 };
  }

  // At this point, queue is guaranteed to be non-null
  const queueContent = ($getByIdDirectPrivate(queue, "content") as { toArray: (shallow?: boolean) => any[] });
  var size = $getByIdDirectPrivate(queue, "size") as number; // Assume queue tracks size correctly
  var values = queueContent.toArray(false); // Assuming toArray exists on FIFO content

  var length = values.length;

  if (length > 0) {
    var outValues = $newArrayWithSize(length);
    if ($isReadableByteStreamController(controller)) {
      // Handle byte stream chunks (ensure they are Uint8Array or similar)
      for (var i = 0; i < length; i++) {
        const buf = values[i];
        // Ensure the chunk is a view or ArrayBuffer before creating Uint8Array
        if (ArrayBuffer.$isView(buf) || buf instanceof ArrayBuffer) {
          $putByValDirect(outValues, i, buf);
        } else if (buf && typeof buf === 'object' && buf.buffer instanceof ArrayBuffer) {
          // Handle potential wrapper objects if necessary
           $putByValDirect(outValues, i, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        } else {
          // Fallback or error handling if chunk type is unexpected
           throw new TypeError("Unexpected chunk type in byte stream queue");
        }
      }
    } else {
      // Handle default stream chunks (extract value property if necessary)
      for (var i = 0; i < length; i++) {
        // Check if value exists
        $putByValDirect(outValues, i, values[i]?.value !== undefined ? values[i].value : values[i]);
      }
    }

    // Call pullIfNeeded after consuming chunks
    if (state !== $streamClosed && controller) {
      if ($getByIdDirectPrivate(controller, "closeRequested")) {
        $readableStreamCloseIfPossible($getByIdDirectPrivate(controller, "controlledReadableStream"));
      } else if ($isReadableStreamDefaultController(controller)) {
        $readableStreamDefaultControllerCallPullIfNeeded(controller);
      } else if ($isReadableByteStreamController(controller)) {
        $readableByteStreamControllerCallPullIfNeeded(controller);
      }
    }
    $resetQueue(queue); // Reset the queue after consuming

    return { value: outValues, size, done: false };
  }

  // Queue is empty, need to pull
  // TS2304 fix: Correct return type annotation for onPullMany
  var onPullMany = (result: unknown): ReadableStreamDefaultReadManyResult<any> => {
    // Ensure result is treated as { done: boolean, value: any }
    const typedResult = result as { done: boolean; value: any };
    const resultValue = typedResult.value;

    if (typedResult.done) {
      // If pull resulted in done, return empty array
      return { value: [], size: 0, done: true };
    }

    // Re-fetch controller and queue as state might have changed
    const currentController = $getByIdDirectPrivate(stream, "readableStreamController") as $ReadableStreamDefaultController | ReadableByteStreamController | $ReadableStreamDirectController | undefined;
    if (!currentController) {
      // Should not happen if we reached here, but handle defensively
      // Calculate size based on the single pulled value
      let pulledSize = 0;
      // Cannot determine controller type here, default to 1
      pulledSize = 1;
      return { value: [resultValue], size: pulledSize, done: false };
    }

    const currentQueue = $getByIdDirectPrivate(currentController, "queue") as ReturnType<typeof $createFIFO>;
    const currentQueueContent = ($getByIdDirectPrivate(currentQueue, "content") as { toArray: (shallow?: boolean) => any[] });
    // Combine the newly pulled value with any values that might have arrived in the queue concurrently
    const combinedValuesRaw = [resultValue].concat(currentQueueContent.toArray(false));
    const combinedLength = combinedValuesRaw.length;
    const combinedValuesProcessed = $newArrayWithSize(combinedLength);
    let combinedSize = 0; // Recalculate size based on processed values

    if ($isReadableByteStreamController(currentController)) {
      for (let i = 0; i < combinedLength; i++) {
        const buf = combinedValuesRaw[i];
         if (ArrayBuffer.$isView(buf) || buf instanceof ArrayBuffer) {
          $putByValDirect(combinedValuesProcessed, i, buf);
          combinedSize += buf.byteLength; // Assuming byteLength for size
        } else if (buf && typeof buf === 'object' && buf.buffer instanceof ArrayBuffer) {
           const chunk = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
           $putByValDirect(combinedValuesProcessed, i, chunk);
           combinedSize += chunk.byteLength;
        } else {
           throw new TypeError("Unexpected chunk type in byte stream queue during pull");
        }
      }
    } else if ($isReadableStreamDefaultController(currentController)) {
      // Default controller: use strategy size algorithm
      const sizeAlgorithm = $getByIdDirectPrivate(currentController, "strategySizeAlgorithm") as (chunk: any) => number;
      for (let i = 0; i < combinedLength; i++) {
        // Check if value exists
        const chunk = combinedValuesRaw[i]?.value !== undefined ? combinedValuesRaw[i].value : combinedValuesRaw[i];
        $putByValDirect(combinedValuesProcessed, i, chunk);
        try {
          // Call the size algorithm function
          combinedSize += sizeAlgorithm(chunk);
        } catch (e) {
          // Handle potential error in size algorithm
          $readableStreamError(stream, e);
          throw e;
        }
      }
    } else {
      // Fallback for other controller types (e.g., direct) - assume size is count
      for (let i = 0; i < combinedLength; i++) {
        const chunk = combinedValuesRaw[i]?.value !== undefined ? combinedValuesRaw[i].value : combinedValuesRaw[i];
        $putByValDirect(combinedValuesProcessed, i, chunk);
      }
      combinedSize = combinedLength;
    }


    // Call pullIfNeeded after processing
    if ($getByIdDirectPrivate(currentController, "closeRequested")) {
      $readableStreamCloseIfPossible($getByIdDirectPrivate(currentController, "controlledReadableStream"));
    } else if ($isReadableStreamDefaultController(currentController)) {
      $readableStreamDefaultControllerCallPullIfNeeded(currentController);
    } else if ($isReadableByteStreamController(currentController)) {
      $readableByteStreamControllerCallPullIfNeeded(currentController);
    }

    $resetQueue(currentQueue); // Reset the queue

    return { value: combinedValuesProcessed, size: combinedSize, done: false };
  };

  if (state === $streamClosed) {
    return { value: [], size: 0, done: true };
  }

  // Ensure controller and $pull exist before calling
  // TS2339 Fix: Check controller type before accessing $pull
  if (!controller || !$isReadableStreamDefaultController(controller)) {
    // Handle case where controller or $pull is missing unexpectedly or not a default controller
    return { value: [], size: 0, done: true };
  }

  // TS2339 Fix: Access $pull only on $ReadableStreamDefaultController
  var pullResult = (controller as $ReadableStreamDefaultController).$pull(controller);
  if (pullResult && $isPromise(pullResult)) {
    // TS2345 fix: onPullMany now accepts unknown
    return pullResult.then(onPullMany, (e) => {
        $readableStreamError(stream, e);
        throw e;
    });
  }

  // Handle synchronous pull result
  try {
    // Cast synchronous result before passing
    return onPullMany(pullResult as { done: boolean; value: any });
  } catch (e) {
     $readableStreamError(stream, e);
     throw e;
  }
}

// Standard read method implementation
export function read(this: ReadableStreamDefaultReader): Promise<{ done: boolean; value: any }> {
  if (!$isReadableStreamDefaultReader(this)) {
    return Promise.$reject($ERR_INVALID_THIS("ReadableStreamDefaultReader"));
  }
  const ownerStream = $getByIdDirectPrivate(this, "ownerReadableStream");
  if (!ownerStream) {
    return Promise.$reject(new TypeError("read() called on a reader owned by no readable stream"));
  }

  // Delegate reading to the generic reader read function.
  // TS2352 fix: Cast 'this' to unknown first.
  return $readableStreamDefaultReaderRead(this as unknown as $ReadableStreamDefaultReader);
}

// Standard releaseLock method implementation
export function releaseLock(this: ReadableStreamDefaultReader): void {
  if (!$isReadableStreamDefaultReader(this)) {
    throw $ERR_INVALID_THIS("ReadableStreamDefaultReader");
  }

  const ownerStream = $getByIdDirectPrivate(this, "ownerReadableStream");
  if (!ownerStream) {
    return; // Already released or never owned
  }

  // Delegate release to the generic reader release function.
  // TS2352 fix: Cast 'this' to unknown first.
  $readableStreamDefaultReaderRelease(this as unknown as $ReadableStreamDefaultReader);
}

// Standard closed getter implementation
$getter;
export function closed(this: ReadableStreamDefaultReader): Promise<void> {
  if (!$isReadableStreamDefaultReader(this)) {
    // Use $ERR_INVALID_THIS for consistency
    return Promise.$reject($ERR_INVALID_THIS("ReadableStreamDefaultReader.closed"));
  }

  // Return the promise from the capability object.
  return $getByIdDirectPrivate(this, "closedPromiseCapability").promise;
}