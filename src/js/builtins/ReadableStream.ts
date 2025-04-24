/*
 * Copyright (C) 2015 Canon Inc.
 * Copyright (C) 2015 Igalia.
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
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// Note: FormData is implicitly imported via the global scope augmentation in builtins.d.ts
// We rely on the global FormData being available.

export function initializeReadableStream(
  this: ReadableStream,
  underlyingSource: UnderlyingSource,
  strategy: QueuingStrategy,
) {
  if (underlyingSource === undefined) underlyingSource = { $bunNativePtr: undefined, $lazy: false } as UnderlyingSource;
  if (strategy === undefined) strategy = {};

  if (!$isObject(underlyingSource)) throw new TypeError("ReadableStream constructor takes an object as first argument");

  if (strategy !== undefined && !$isObject(strategy))
    throw new TypeError("ReadableStream constructor takes an object as second argument, if any");

  $putByIdDirectPrivate(this as any, "state", $streamReadable);

  $putByIdDirectPrivate(this as any, "reader", undefined);

  $putByIdDirectPrivate(this as any, "storedError", undefined);

  this.$disturbed = false;

  // Initialized with null value to enable distinction with undefined case.
  $putByIdDirectPrivate(this as any, "readableStreamController", null);
  this.$bunNativePtr = $getByIdDirectPrivate(underlyingSource, "bunNativePtr") ?? undefined;

  $putByIdDirectPrivate(this as any, "asyncContext", $getInternalField($asyncContext, 0));

  const isDirect = (underlyingSource as any).type === "direct";
  // direct streams are always lazy
  const isUnderlyingSourceLazy = !!underlyingSource.$lazy;
  const isLazy = isDirect || isUnderlyingSourceLazy;
  let pullFn;

  // FIXME: We should introduce https://streams.spec.whatwg.org/#create-readable-stream.
  // For now, we emulate this with underlyingSource with private properties.
  if (!isLazy && (pullFn = $getByIdDirectPrivate(underlyingSource, "pull")) !== undefined) {
    const size = $getByIdDirectPrivate(strategy, "size");
    const highWaterMark = $getByIdDirectPrivate(strategy, "highWaterMark");
    const resolvedHighWaterMark = (highWaterMark as number | undefined) ?? 1;
    $putByIdDirectPrivate(this, "highWaterMark", resolvedHighWaterMark);
    $putByIdDirectPrivate(this as any, "underlyingSource", undefined);
    $setupReadableStreamDefaultController(
      this,
      underlyingSource,
      size,
      resolvedHighWaterMark,
      $getByIdDirectPrivate(underlyingSource, "start"),
      pullFn,
      $getByIdDirectPrivate(underlyingSource, "cancel"),
    );

    return this;
  }
  if (isDirect) {
    $putByIdDirectPrivate(this as any, "underlyingSource", underlyingSource);
    $putByIdDirectPrivate(this, "highWaterMark", ($getByIdDirectPrivate(strategy, "highWaterMark") as number | undefined) ?? 1);
    $putByIdDirectPrivate(this as any, "start", () => $createReadableStreamController(this, underlyingSource, strategy));
  } else if (isLazy) {
    const autoAllocateChunkSize = underlyingSource.autoAllocateChunkSize;
    $putByIdDirectPrivate(this, "highWaterMark", 1); // Default to 1 if undefined
    $putByIdDirectPrivate(this as any, "underlyingSource", undefined);
    $putByIdDirectPrivate(
      this,
      "highWaterMark",
      autoAllocateChunkSize !== undefined
        ? autoAllocateChunkSize
        : (($getByIdDirectPrivate(strategy, "highWaterMark") as number | undefined) ?? 1),
    );

    $putByIdDirectPrivate(this as any, "start", () => {
      const instance = $lazyLoadStream(this, autoAllocateChunkSize);
      if (instance) {
        $createReadableStreamController(this, instance, strategy);
      }
    });
  } else {
    $putByIdDirectPrivate(this as any, "underlyingSource", undefined);
    $putByIdDirectPrivate(this, "highWaterMark", ($getByIdDirectPrivate(strategy, "highWaterMark") as number | undefined) ?? 1);
    $putByIdDirectPrivate(this as any, "start", undefined);
    $createReadableStreamController(this, underlyingSource, strategy);
  }

  return this;
}

$linkTimeConstant;
export function readableStreamToArray(stream: ReadableStream): Promise<unknown[]> {
  if (!$isReadableStream(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "ReadableStream", typeof stream);
  // this is a direct stream
  var underlyingSource = $getByIdDirectPrivate(stream, "underlyingSource");
  if (underlyingSource !== undefined) {
    return $readableStreamToArrayDirect(stream, underlyingSource);
  }
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE("ReadableStream is locked"));
  return $readableStreamIntoArray(stream);
}

$linkTimeConstant;
export function readableStreamToText(stream: ReadableStream): Promise<string> {
  if (!$isReadableStream(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "ReadableStream", typeof stream);
  // this is a direct stream
  var underlyingSource = $getByIdDirectPrivate(stream, "underlyingSource");
  if (underlyingSource !== undefined) {
    return $readableStreamToTextDirect(stream, underlyingSource);
  }
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE("ReadableStream is locked"));

  const result = $tryUseReadableStreamBufferedFastPath(stream, "text");

  if (result) {
    return result;
  }

  return $readableStreamIntoText(stream);
}

$linkTimeConstant;
export function readableStreamToArrayBuffer(stream: ReadableStream<ArrayBuffer>): Promise<ArrayBuffer> {
  if (!$isReadableStream(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "ReadableStream", typeof stream);

  // this is a direct stream
  var underlyingSource = $getByIdDirectPrivate(stream, "underlyingSource");
  if (underlyingSource !== undefined) {
    // Assuming $readableStreamToArrayBufferDirect returns Promise<ArrayBuffer> or ArrayBuffer
    const result = $readableStreamToArrayBufferDirect(stream, underlyingSource, 0);
    return $isPromise(result) ? result as Promise<ArrayBuffer> : Promise.resolve(result as ArrayBuffer);
  }
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE("ReadableStream is locked"));

  let fastPathResult = $tryUseReadableStreamBufferedFastPath(stream, "arrayBuffer");
  if (fastPathResult) {
    // Assuming $tryUseReadableStreamBufferedFastPath returns Promise<ArrayBuffer> or ArrayBuffer
    return $isPromise(fastPathResult) ? fastPathResult as Promise<ArrayBuffer> : Promise.resolve(fastPathResult as ArrayBuffer);
  }

  // Helper function to convert array of chunks to a single ArrayBuffer
  function toArrayBuffer(result: unknown[]): ArrayBuffer {
    switch (result.length) {
      case 0: {
        return new ArrayBuffer(0);
      }
      case 1: {
        const view = result[0];
        if (view instanceof ArrayBuffer) return view;
        if (view instanceof SharedArrayBuffer) return view.slice(0) as unknown as ArrayBuffer;
        if (ArrayBuffer.isView(view)) {
          const v = view as ArrayBufferView;
          if (v.byteOffset === 0 && v.byteLength === v.buffer.byteLength && v.buffer instanceof ArrayBuffer) return v.buffer;
          return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
        }
        if (typeof view === "string") {
          const encoded = new TextEncoder().encode(view);
          if (encoded.byteOffset === 0 && encoded.byteLength === encoded.buffer.byteLength) return encoded.buffer;
          return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
        }
        break; // Fallthrough for unexpected types
      }
      default: {
        let anyStrings = false;
        for (const chunk of result) {
          if (typeof chunk === "string") {
            anyStrings = true;
            break;
          }
        }

        if (!anyStrings) {
          const concatenated = Bun.concatArrayBuffers(
            result as (ArrayBuffer | Bun.ArrayBufferView<ArrayBuffer>)[],
            false, // Request ArrayBuffer output
          );
          // Bun.concatArrayBuffers may return ArrayBuffer or Uint8Array, but we want ArrayBuffer
          if (concatenated instanceof ArrayBuffer) return concatenated;
          if (concatenated instanceof Uint8Array) return concatenated.buffer;
          // fallback
          return (concatenated as Uint8Array).buffer;
        }

        const sink = new Bun.ArrayBufferSink();
        sink.start({ asUint8Array: false });

        for (const chunk of result) {
          sink.write(chunk as string | ArrayBuffer | Bun.ArrayBufferView<ArrayBuffer>);
        }

        // sink.end() returns ArrayBuffer, not { buffer: ArrayBuffer }
        return sink.end() as ArrayBuffer;
      }
    }
    throw new TypeError("ReadableStream contained non-bufferable chunks");
  }

  const arrayPromise = Bun.readableStreamToArray(stream);

  return Promise.resolve(arrayPromise).then(arr => toArrayBuffer(arr as unknown[]));
}

$linkTimeConstant;
export function readableStreamToBytes(stream: ReadableStream<ArrayBuffer>): Promise<Uint8Array> | Uint8Array {
  if (!$isReadableStream(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "ReadableStream", typeof stream);
  // this is a direct stream
  var underlyingSource = $getByIdDirectPrivate(stream, "underlyingSource");

  if (underlyingSource !== undefined) {
    return $readableStreamToArrayBufferDirect(stream, underlyingSource, 1) as Promise<Uint8Array> | Uint8Array;
  }
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE("ReadableStream is locked"));

  let result = $tryUseReadableStreamBufferedFastPath(stream, "bytes");

  if (result) {
    return result;
  }

  result = Bun.readableStreamToArray(stream);

  function toBytes(result: unknown[]): Uint8Array {
    switch (result.length) {
      case 0: {
        return new Uint8Array(0);
      }
      case 1: {
        const view = result[0];
        if (view instanceof Uint8Array) {
          return view;
        }

        if (ArrayBuffer.isView(view)) {
          return new Uint8Array(
            (view as ArrayBufferView).buffer,
            (view as ArrayBufferView).byteOffset,
            (view as ArrayBufferView).byteLength,
          );
        }

        if (view instanceof ArrayBuffer) {
          return new Uint8Array(view);
        }

        if (view instanceof SharedArrayBuffer) {
          return new Uint8Array(view.slice(0) as unknown as ArrayBuffer);
        }

        if (typeof view === "string") {
          return new TextEncoder().encode(view);
        }
        break; // Fallthrough to default case if type is unexpected
      }
      default: {
        let anyStrings = false;
        for (const chunk of result) {
          if (typeof chunk === "string") {
            anyStrings = true;
            break;
          }
        }

        if (!anyStrings) {
          const concatenated = Bun.concatArrayBuffers(
            result as (ArrayBuffer | Bun.ArrayBufferView<ArrayBuffer>)[],
            true, // Request Uint8Array
          );
          // Bun.concatArrayBuffers may return Uint8Array or ArrayBuffer
          if (concatenated instanceof Uint8Array) return concatenated;
          if (concatenated instanceof ArrayBuffer) return new Uint8Array(concatenated);
          // fallback
          return concatenated as Uint8Array;
        }

        const sink = new Bun.ArrayBufferSink();
        sink.start({ asUint8Array: true });

        for (const chunk of result) {
          sink.write(chunk as string | ArrayBuffer | Bun.ArrayBufferView<ArrayBuffer>);
        }

        // sink.end() returns Uint8Array
        return sink.end() as Uint8Array;
      }
    }
    throw new TypeError("ReadableStream contained non-bufferable chunks");
  }

  if ($isPromise(result)) {
    const completedResult = Bun.peek(result);
    if (completedResult !== result) {
      result = completedResult;
    } else {
      return (result as Promise<unknown[]>).then((res: unknown) => toBytes(res as unknown[]));
    }
  }

  return $createFulfilledPromise(toBytes(result as unknown[]));
}

$linkTimeConstant;
export function readableStreamToFormData(
  stream: ReadableStream<ArrayBuffer>,
  contentType: string | ArrayBuffer | ArrayBufferView,
): Promise<FormData> {
  if (!$isReadableStream(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "ReadableStream", typeof stream);
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE("ReadableStream is locked"));
  return Bun.readableStreamToBlob(stream).then(blob => {
    return (globalThis.FormData as any).from(blob, contentType);
  });
}

$linkTimeConstant;
export function readableStreamToJSON(stream: ReadableStream): unknown {
  if (!$isReadableStream(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "ReadableStream", typeof stream);
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE("ReadableStream is locked"));
  let result = $tryUseReadableStreamBufferedFastPath(stream, "json");
  if (result) {
    return result;
  }

  let text = Bun.readableStreamToText(stream);
  const peeked = Bun.peek(text);
  if (peeked !== text) {
    try {
      return $createFulfilledPromise(globalThis.JSON.parse(peeked as string));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  return (text as Promise<string>).then(globalThis.JSON.parse);
}

$linkTimeConstant;
export function readableStreamToBlob(stream: ReadableStream): Promise<Blob> {
  if (!$isReadableStream(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "ReadableStream", typeof stream);
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE("ReadableStream is locked"));

  return (
    $tryUseReadableStreamBufferedFastPath(stream, "blob") ||
    Promise.resolve(Bun.readableStreamToArray(stream)).then(array => new Blob(array))
  );
}

$linkTimeConstant;
export function createEmptyReadableStream() {
  var stream = new ReadableStream({
    pull() {},
  } as any);
  $readableStreamClose(stream);
  return stream;
}

$linkTimeConstant;
export function createUsedReadableStream() {
  var stream = new ReadableStream({
    pull() {},
  } as any);
  stream.getReader();
  return stream;
}

$linkTimeConstant;
export function createNativeReadableStream(nativePtr, autoAllocateChunkSize) {
  $assert(nativePtr, "nativePtr must be a valid pointer");
  return new ReadableStream({
    $lazy: true,
    $bunNativePtr: nativePtr,
    autoAllocateChunkSize: autoAllocateChunkSize,
  } as UnderlyingSource);
}

export function cancel(this: ReadableStream, reason) {
  if (!$isReadableStream(this)) return Promise.$reject($ERR_INVALID_THIS("ReadableStream"));

  if ($isReadableStreamLocked(this)) return Promise.$reject($ERR_INVALID_STATE("ReadableStream is locked"));

  return $readableStreamCancel(this, reason);
}

export function getReader(this: ReadableStream, options) {
  if (!$isReadableStream(this)) throw $ERR_INVALID_THIS("ReadableStream");

  const mode = ($toDictionary(options, {}, "ReadableStream.getReader takes an object as first argument") as any).mode;
  if (mode === undefined) {
    var start_ = $getByIdDirectPrivate<() => void>(this, "start");
    if (start_) {
      $putByIdDirectPrivate(this as any, "start", undefined);
      start_();
    }

    return new ReadableStreamDefaultReader(this);
  }
  if (mode == "byob") {
    return new ReadableStreamBYOBReader(this);
  }

  throw $ERR_INVALID_ARG_VALUE("mode", mode, "byob");
}

export function pipeThrough(this: ReadableStream, streams, options) {
  const transforms = streams;

  const readable = transforms["readable"];
  if (!$isReadableStream(readable)) throw $makeTypeError("readable should be ReadableStream");

  const writable = transforms["writable"];
  const internalWritable = $getInternalWritableStream(writable);
  if (!$isWritableStream(internalWritable as WritableStream)) throw $makeTypeError("writable should be WritableStream");

  let preventClose = false;
  let preventAbort = false;
  let preventCancel = false;
  let signal;
  if (!$isUndefinedOrNull(options)) {
    if (!$isObject(options)) throw $makeTypeError("options must be an object");

    preventAbort = !!options["preventAbort"];
    preventCancel = !!options["preventCancel"];
    preventClose = !!options["preventClose"];

    signal = options["signal"];
    if (signal !== undefined && !$isAbortSignal(signal as AbortSignal))
      throw $makeTypeError("options.signal must be AbortSignal");
  }

  if (!$isReadableStream(this)) throw $ERR_INVALID_THIS("ReadableStream");

  if ($isReadableStreamLocked(this)) throw $ERR_INVALID_STATE("ReadableStream is locked");

  if ($isWritableStreamLocked(internalWritable as WritableStream)) throw $makeTypeError("WritableStream is locked");

  const promise = $readableStreamPipeToWritableStream(
    this,
    internalWritable as WritableStream,
    preventClose ? 1 : 0,
    preventAbort ? 1 : 0,
    preventCancel ? 1 : 0,
    signal as AbortSignal,
  );
  $markPromiseAsHandled(promise);

  return readable;
}

export function pipeTo(this: ReadableStream, destination) {
  if (!$isReadableStream(this)) return Promise.$reject($ERR_INVALID_THIS("ReadableStream"));

  if ($isReadableStreamLocked(this)) return Promise.$reject($ERR_INVALID_STATE("ReadableStream is locked"));

  let options = $argument(1);

  let preventClose = false;
  let preventAbort = false;
  let preventCancel = false;
  let signal;
  if (!$isUndefinedOrNull(options)) {
    if (!$isObject(options)) return Promise.$reject($makeTypeError("options must be an object"));

    try {
      preventAbort = !!options["preventAbort"];
      preventCancel = !!options["preventCancel"];
      preventClose = !!options["preventClose"];

      signal = options["signal"];
    } catch (e) {
      return Promise.$reject(e);
    }

    if (signal !== undefined && !$isAbortSignal(signal as AbortSignal))
      return Promise.$reject(new TypeError("options.signal must be AbortSignal"));
  }

  const internalDestination = $getInternalWritableStream(destination);
  if (!$isWritableStream(internalDestination as WritableStream))
    return Promise.$reject(new TypeError("ReadableStream pipeTo requires a WritableStream"));

  if ($isWritableStreamLocked(internalDestination as WritableStream))
    return Promise.$reject(new TypeError("WritableStream is locked"));

  return $readableStreamPipeToWritableStream(
    this,
    internalDestination as WritableStream,
    preventClose ? 1 : 0,
    preventAbort ? 1 : 0,
    preventCancel ? 1 : 0,
    signal as AbortSignal,
  );
}

export function tee(this: ReadableStream) {
  if (!$isReadableStream(this)) throw $ERR_INVALID_THIS("ReadableStream");

  return $readableStreamTee(this, 0);
}

$getter;
export function locked(this: ReadableStream) {
  if (!$isReadableStream(this)) throw $makeGetterTypeError("ReadableStream", "locked");

  return $isReadableStreamLocked(this);
}

export function values(this: ReadableStream, options) {
  var prototype = ReadableStream.prototype;
  $readableStreamDefineLazyIterators(prototype);
  return prototype.values.$call(this);
}

$linkTimeConstant;
export function lazyAsyncIterator(this: ReadableStream) {
  var prototype = ReadableStream.prototype;
  $readableStreamDefineLazyIterators(prototype);
  return prototype[globalThis.Symbol.asyncIterator].$call(this);
}