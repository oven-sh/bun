/*
 * Copyright (C) 2020 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// Note: This file has been modified from the original WebKit source code.

// TextDecoderOptions is globally available or defined elsewhere
import type { TransformStreamDefaultController } from "node:stream/web";

// Add missing types for BufferSource and TextDecoderOptions
type BufferSource = ArrayBufferView | ArrayBuffer;
interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

interface TextDecoderStream {
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  readonly readable: ReadableStream<string>;
  readonly writable: WritableStream<BufferSource>;

  $fatal: boolean;
  $ignoreBOM: boolean;
  $encoding: string;
  $textDecoder: $ZigGeneratedClasses.TextDecoder;
  $textDecoderStreamTransform: TransformStream<BufferSource, string>;
}

export function initializeTextDecoderStream(this: TextDecoderStream) {
  const label = arguments.length >= 1 ? arguments[0] : "utf-8";
  const options: TextDecoderOptions = arguments.length >= 2 ? arguments[1] : {};

  const startAlgorithm = () => {
    return $Promise.$resolve();
  };
  const transformAlgorithm = (chunk: BufferSource) => {
    const decoder = $getByIdDirectPrivate(this, "textDecoder") as $ZigGeneratedClasses.TextDecoder;
    let buffer;
    try {
      // Accept only ArrayBuffer or ArrayBufferView<ArrayBufferLike>
      let input: ArrayBuffer | ArrayBufferView<ArrayBufferLike>;
      if (ArrayBuffer.isView(chunk)) {
        input = chunk as ArrayBufferView<ArrayBufferLike>;
      } else if (chunk instanceof ArrayBuffer) {
        input = chunk as ArrayBuffer;
      } else {
        // fallback, should not happen
        input = chunk as ArrayBuffer;
      }
      buffer = decoder.decode(input, { stream: true });
    } catch (e) {
      return $Promise.$reject(e);
    }
    if (buffer) {
      const transformStream = $getByIdDirectPrivate(this, "textDecoderStreamTransform");
      const controller = $getByIdDirectPrivate(transformStream, "controller") as TransformStreamDefaultController<string>;
      $transformStreamDefaultControllerEnqueue(controller, buffer);
    }
    return $Promise.$resolve();
  };
  const flushAlgorithm = () => {
    const decoder = $getByIdDirectPrivate(this, "textDecoder") as $ZigGeneratedClasses.TextDecoder;
    let buffer;
    try {
      buffer = decoder.decode(undefined, { stream: false });
    } catch (e) {
      return $Promise.$reject(e);
    }
    if (buffer) {
      const transformStream = $getByIdDirectPrivate(this, "textDecoderStreamTransform");
      const controller = $getByIdDirectPrivate(transformStream, "controller") as TransformStreamDefaultController<string>;
      $transformStreamDefaultControllerEnqueue(controller, buffer);
    }
    return $Promise.$resolve();
  };

  // Provide default arguments for queuing strategies
  const transform = $createTransformStream(startAlgorithm, transformAlgorithm, flushAlgorithm, 1, () => 1, 0, () => 1);
  $putByIdDirectPrivate(this, "textDecoderStreamTransform", transform);

  const fatal = !!options.fatal;
  const ignoreBOM = !!options.ignoreBOM;
  // Use the Zig-generated TextDecoder constructor and cast to $ZigGeneratedClasses.TextDecoder
  const decoder = new (globalThis.TextDecoder as unknown as $ZigGeneratedClasses.TextDecoderConstructor)(label, { fatal, ignoreBOM }) as $ZigGeneratedClasses.TextDecoder;

  $putByIdDirectPrivate(this, "fatal", fatal);
  $putByIdDirectPrivate(this, "ignoreBOM", ignoreBOM);
  $putByIdDirectPrivate(this, "encoding", decoder.encoding as string);
  $putByIdDirectPrivate(this, "textDecoder", decoder);

  return this;
}

$getter;
export function encoding(this: TextDecoderStream): string {
  if (!$getByIdDirectPrivate(this, "textDecoderStreamTransform")) throw $ERR_INVALID_THIS("TextDecoderStream");

  return $getByIdDirectPrivate(this, "encoding");
}

$getter;
export function fatal(this: TextDecoderStream): boolean {
  if (!$getByIdDirectPrivate(this, "textDecoderStreamTransform")) throw $ERR_INVALID_THIS("TextDecoderStream");

  return $getByIdDirectPrivate(this, "fatal");
}

$getter;
export function ignoreBOM(this: TextDecoderStream): boolean {
  if (!$getByIdDirectPrivate(this, "textDecoderStreamTransform")) throw $ERR_INVALID_THIS("TextDecoderStream");

  return $getByIdDirectPrivate(this, "ignoreBOM");
}

$getter;
export function readable(this: TextDecoderStream): ReadableStream<string> {
  const transform = $getByIdDirectPrivate(this, "textDecoderStreamTransform");
  if (!transform) throw $ERR_INVALID_THIS("TextDecoderStream");

  return $getByIdDirectPrivate(transform, "readable") as ReadableStream<string>;
}

$getter;
export function writable(this: TextDecoderStream): WritableStream<BufferSource> {
  const transform = $getByIdDirectPrivate(this, "textDecoderStreamTransform");
  if (!transform) throw $ERR_INVALID_THIS("TextDecoderStream");

  return $getByIdDirectPrivate(transform, "writable") as WritableStream<BufferSource>;
}