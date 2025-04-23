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
 *    documentation and/or other materials provided without restriction.
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

  // @ts-ignore - We know these private properties exist at runtime
  $putByIdDirectPrivate(this, "state", $streamReadable);

  // @ts-ignore - We know these private properties exist at runtime
  $putByIdDirectPrivate(this, "reader", undefined);

  // @ts-ignore - We know these private properties exist at runtime
  $putByIdDirectPrivate(this, "storedError", undefined);

  this.$disturbed = false;

  // Initialized with null value to enable distinction with undefined case.
  // @ts-ignore - We know these private properties exist at runtime
  $putByIdDirectPrivate(this, "readableStreamController", null);
  this.$bunNativePtr = $getByIdDirectPrivate(underlyingSource, "bunNativePtr") ?? undefined;

  // @ts-ignore - We know these private properties exist at runtime
  $putByIdDirectPrivate(this, "asyncContext", $getInternalField($asyncContext, 0));

  const isDirect = underlyingSource.type === "direct";
  // direct streams are always lazy
  const isUnderlyingSourceLazy = !!underlyingSource.$lazy;
  const isLazy = isDirect || isUnderlyingSourceLazy;
  let pullFn;

  // FIXME: We should introduce https://streams.spec.whatwg.org/#create-readable-stream.
  // For now, we emulate this with underlyingSource with private properties.
  if (!isLazy && (pullFn = $getByIdDirectPrivate(underlyingSource, "pull")) !== undefined) {
    const size = $getByIdDirectPrivate(strategy, "size");
    const highWaterMark = $getByIdDirectPrivate(strategy, "highWaterMark");
    // @ts-ignore - We know these private properties exist at runtime
    $putByIdDirectPrivate(this, "highWaterMark", highWaterMark as number);
    // @ts-ignore - We know these private properties exist at runtime
    $putByIdDirectPrivate(this, "underlyingSource", undefined);
    $setupReadableStreamDefaultController(
      this,
      underlyingSource,
      size,
      highWaterMark !== undefined ? highWaterMark : 1,
      $getByIdDirectPrivate(underlyingSource, "start"),
      pullFn,
      $getByIdDirectPrivate(underlyingSource, "cancel"),
    );

    return this;
  }
  if (isDirect) {
    // @ts-ignore - We know these private properties exist at runtime
    $putByIdDirectPrivate(this, "underlyingSource", underlyingSource);
    // @ts-ignore - We know these private properties exist at runtime
    $putByIdDirectPrivate(this, "highWaterMark", $getByIdDirectPrivate(strategy, "highWaterMark") as number);
    // @ts-ignore - We know these private properties exist at runtime
    $putByIdDirectPrivate(this, "start", () => $createReadableStreamController(this, underlyingSource, strategy));
  } else if (isLazy) {
    const autoAllocateChunkSize = underlyingSource.autoAllocateChunkSize;
    // @ts-ignore - We know these private properties exist at runtime
    $putByIdDirectPrivate(this, "highWaterMark", undefined as unknown as number);
    // @ts-ignore - We know these private properties exist at runtime
    $putByIdDirectPrivate(this, "underlyingSource", undefined);
    // @ts-ignore - We know these private properties exist at runtime
    // @ts-ignore - We know these private properties exist at runtime
    $putByIdDirectPrivate(
      this,
      "highWaterMark",
      (autoAllocateChunkSize || $getByIdDirectPrivate(strategy, "highWaterMark")) as number,
    );

    // @ts-ignore - We know these private properties exist at runtime
    $putByIdDirectPrivate(this, "start", () => {
      const instance = $lazyLoadStream(this, autoAllocateChunkSize);
      if (instance) {
        $createReadableStreamController(this, instance, strategy);
      }
    });
  } else {
    $putByIdDirectPrivate(this, "underlyingSource", undefined);
    $putByIdDirectPrivate(this, "highWaterMark", $getByIdDirectPrivate(strategy, "highWaterMark") as number);
    $putByIdDirectPrivate(this, "start", undefined);
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
    return ($readableStreamToArrayDirect as any)(stream, underlyingSource);
  }
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE_TypeError("ReadableStream is locked"));
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
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE_TypeError("ReadableStream is locked"));

  const result = $tryUseReadableStreamBufferedFastPath(stream, "text");

  if (result) {
    return result;
  }

  return $readableStreamIntoText(stream);
}

$linkTimeConstant;
export function readableStreamToArrayBuffer(stream: ReadableStream<ArrayBuffer>): Promise<ArrayBuffer> | ArrayBuffer {
  if (!$isReadableStream(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "ReadableStream", typeof stream);
  // this is a direct stream
  var underlyingSource = $getByIdDirectPrivate(stream, "underlyingSource");
  if (underlyingSource !== undefined) {
    return $readableStreamToArrayBufferDirect(stream, underlyingSource, false);
  }
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE_TypeError("ReadableStream is locked"));

  let result = $tryUseReadableStreamBufferedFastPath(stream, "arrayBuffer");

  if (result) {
    return result;
  }

  result = Bun.readableStreamToArray(stream);

  function toArrayBuffer(result: unknown[]) {
    switch (result.length) {
      case 0: {
        return new ArrayBuffer(0);
      }
      case 1: {
        const view = result[0];
        if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) {
          return view;
        }

        if (ArrayBuffer.isView(view)) {
          const typedView = view as ArrayBufferView;
          const buffer = typedView.buffer;
          const byteOffset = typedView.byteOffset;
          const byteLength = typedView.byteLength;
          if (byteOffset === 0 && byteLength === buffer.byteLength) {
            return buffer;
          }

          return buffer.slice(byteOffset, byteOffset + byteLength);
        }

        if (typeof view === "string") {
          return new TextEncoder().encode(view);
        }
        break;
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
          return Bun.concatArrayBuffers(
            result as unknown as (ArrayBufferLike | Bun.ArrayBufferView<ArrayBufferLike>)[],
            0,
          );
        }

        const sink = new Bun.ArrayBufferSink();
        sink.start();

        for (const chunk of result) {
          sink.write(chunk as string | ArrayBuffer | SharedArrayBuffer | Bun.ArrayBufferView);
        }

        return sink.end() as Uint8Array;
      }
    }
  }

  if ($isPromise(result)) {
    const completedResult = Bun.peek(result);
    if (completedResult !== result) {
      result = completedResult;
    } else {
      return result.then((value: unknown[]) => toArrayBuffer(value));
    }
  }
  return $createFulfilledPromise(toArrayBuffer(result));
}

$linkTimeConstant;
export function readableStreamToBytes(stream: ReadableStream<ArrayBuffer>): Promise<Uint8Array> | Uint8Array {
  if (!$isReadableStream(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "ReadableStream", typeof stream);
  // this is a direct stream
  var underlyingSource = $getByIdDirectPrivate(stream, "underlyingSource");

  if (underlyingSource !== undefined) {
    return $readableStreamToArrayBufferDirect(stream, underlyingSource, true);
  }
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE_TypeError("ReadableStream is locked"));

  let result = $tryUseReadableStreamBufferedFastPath(stream, "bytes");

  if (result) {
    return result;
  }

  result = Bun.readableStreamToArray(stream);

  function toBytes(result: unknown[]) {
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
          const typedView = view as ArrayBufferView;
          return new Uint8Array(typedView.buffer, typedView.byteOffset, typedView.byteLength);
        }

        if (view instanceof ArrayBuffer || view instanceof SharedArrayBuffer) {
          return new Uint8Array(view as ArrayBuffer);
        }

        if (typeof view === "string") {
          return new TextEncoder().encode(view);
        }
        break;
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
          return Bun.concatArrayBuffers(
            result as unknown as (ArrayBufferLike | Bun.ArrayBufferView<ArrayBufferLike>)[],
            1,
          );
        }

        const sink = new Bun.ArrayBufferSink();
        sink.start({ asUint8Array: true });

        for (const chunk of result) {
          sink.write(chunk as string | ArrayBuffer | SharedArrayBuffer | Bun.ArrayBufferView);
        }

        return sink.end() as Uint8Array;
      }
    }
  }

  if ($isPromise(result)) {
    const completedResult = Bun.peek(result);
    if (completedResult !== result) {
      result = completedResult;
    } else {
      return result.then((value: unknown[]) => toBytes(value));
    }
  }

  return $createFulfilledPromise(toBytes(result));
}

$linkTimeConstant;
export function readableStreamToFormData(
  stream: ReadableStream<ArrayBuffer>,
  contentType: string | ArrayBuffer | ArrayBufferView,
): Promise<FormData> {
  if (!$isReadableStream(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "ReadableStream", typeof stream);
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE_TypeError("ReadableStream is locked"));
  return Bun.readableStreamToBlob(stream).then(blob => {
    return (FormData as any).from(blob, contentType);
  });
}

$linkTimeConstant;
export function readableStreamToJSON(stream: ReadableStream): unknown {
  if (!$isReadableStream(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "ReadableStream", typeof stream);
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE_TypeError("ReadableStream is locked"));
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

  return text.then(globalThis.JSON.parse);
}

$linkTimeConstant;
export function readableStreamToBlob(stream: ReadableStream): Promise<Blob> {
  if (!$isReadableStream(stream)) throw $ERR_INVALID_ARG_TYPE("stream", "ReadableStream", typeof stream);
  if ($isReadableStreamLocked(stream)) return Promise.$reject($ERR_INVALID_STATE_TypeError("ReadableStream is locked"));

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
  // We need to use a type assertion here since there seems to be a Bun.UnderlyingSource
  // that isn't the same as our UnderlyingSource
  return new (ReadableStream as any)({
    $lazy: true,
    $bunNativePtr: nativePtr,
    autoAllocateChunkSize: autoAllocateChunkSize,
  });
}

export function cancel(this, reason) {
  if (!$isReadableStream(this)) return Promise.$reject($ERR_INVALID_THIS("ReadableStream"));

  if ($isReadableStreamLocked(this)) return Promise.$reject($ERR_INVALID_STATE_TypeError("ReadableStream is locked"));

  return $readableStreamCancel(this, reason);
}

export function getReader(this, options) {
  if (!$isReadableStream(this)) throw $ERR_INVALID_THIS("ReadableStream");

  const mode = $toDictionary(options, {}, "ReadableStream.getReader takes an object as first argument").mode;
  if (mode === undefined) {
    var start_ = $getByIdDirectPrivate(this, "start");
    if (start_) {
      $putByIdDirectPrivate(this, "start", undefined);
      start_();
    }

    return new ReadableStreamDefaultReader(this);
  }
  // String conversion is required by spec, hence double equals.
  if (mode == "byob") {
    // Need to handle this differently since constructor doesn't take arguments
    return new (ReadableStreamBYOBReader as any)(this);
  }

  throw $ERR_INVALID_ARG_VALUE("mode", mode, "byob");
}

export function pipeThrough(this, streams, options) {
  const transforms = streams;

  const readable = transforms["readable"];
  if (!$isReadableStream(readable)) throw $makeTypeError("readable should be ReadableStream");

  const writable = transforms["writable"];
  const internalWritable = $getInternalWritableStream(writable);
  if (!$isWritableStream(internalWritable)) throw $makeTypeError("writable should be WritableStream");

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
    if (signal !== undefined && !$isAbortSignal(signal)) throw $makeTypeError("options.signal must be AbortSignal");
  }

  if (!$isReadableStream(this)) throw $ERR_INVALID_THIS("ReadableStream");

  if ($isReadableStreamLocked(this)) throw $ERR_INVALID_STATE_TypeError("ReadableStream is locked");

  if ($isWritableStreamLocked(internalWritable)) throw $makeTypeError("WritableStream is locked");

  const promise = $readableStreamPipeToWritableStream(
    this,
    internalWritable,
    preventClose,
    preventAbort,
    preventCancel,
    signal,
  );
  $markPromiseAsHandled(promise);

  return readable;
}

export function pipeTo(this, destination) {
  if (!$isReadableStream(this)) return Promise.$reject($ERR_INVALID_THIS("ReadableStream"));

  if ($isReadableStreamLocked(this)) return Promise.$reject($ERR_INVALID_STATE_TypeError("ReadableStream is locked"));

  // FIXME: https://bugs.webkit.org/show_bug.cgi?id=159869.
  // Built-in generator should be able to parse function signature to compute the function length correctly.
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

    if (signal !== undefined && !$isAbortSignal(signal))
      return Promise.$reject(new TypeError("options.signal must be AbortSignal"));
  }

  const internalDestination = $getInternalWritableStream(destination);
  if (!$isWritableStream(internalDestination))
    return Promise.$reject(new TypeError("ReadableStream pipeTo requires a WritableStream"));

  if ($isWritableStreamLocked(internalDestination)) return Promise.$reject(new TypeError("WritableStream is locked"));

  return $readableStreamPipeToWritableStream(
    this,
    internalDestination,
    preventClose,
    preventAbort,
    preventCancel,
    signal,
  );
}

export function tee(this) {
  if (!$isReadableStream(this)) throw $ERR_INVALID_THIS("ReadableStream");

  return $readableStreamTee(this, false);
}

$getter;
export function locked(this) {
  if (!$isReadableStream(this)) throw $makeGetterTypeError("ReadableStream", "locked");

  return $isReadableStreamLocked(this);
}

export function values(this, options) {
  var prototype = ReadableStream.prototype;
  $readableStreamDefineLazyIterators(prototype);
  return prototype.values.$call(this, options);
}

$linkTimeConstant;
export function lazyAsyncIterator(this) {
  var prototype = ReadableStream.prototype;
  $readableStreamDefineLazyIterators(prototype);
  return prototype[globalThis.Symbol.asyncIterator].$call(this);
}
