/*
 * Copyright (C) 2016 Canon Inc.
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
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// Type definition is in node_modules/@types/node/stream/web.d.ts
// We augment it in builtins.d.ts
import type { ReadableByteStreamController as RBC, ReadableStreamBYOBRequest as RSBYOBR } from "node:stream/web";

// Assume ReadableByteStreamController is correctly defined in builtins.d.ts
// with $controlledReadableStream, $pendingPullIntos, $byobRequest, $closeRequested

export function initializeReadableByteStreamController(this: RBC, stream, underlyingByteSource, highWaterMark) {
  if (arguments.length !== 4 && arguments[3] !== $isReadableStream)
    throw new TypeError("ReadableByteStreamController constructor should not be called directly");

  return $privateInitializeReadableByteStreamController.$call(this, stream, underlyingByteSource, highWaterMark);
}

export function enqueue(this: RBC, chunk: ArrayBufferView) {
  if (!$isReadableByteStreamController(this)) throw $ERR_INVALID_THIS("ReadableByteStreamController");

  // Use internal properties via $getByIdDirectPrivate as originally written
  if ($getByIdDirectPrivate(this, "closeRequested"))
    throw new TypeError("ReadableByteStreamController is requested to close");

  if ($getByIdDirectPrivate($getByIdDirectPrivate(this, "controlledReadableStream"), "state") !== $streamReadable)
    throw new TypeError("ReadableStream is not readable");

  if (!$isObject(chunk) || !ArrayBuffer.$isView(chunk)) throw new TypeError("Provided chunk is not a TypedArray");

  return $readableByteStreamControllerEnqueue(this, chunk);
}

export function error(this: RBC, error: any) {
  if (!$isReadableByteStreamController(this)) throw $ERR_INVALID_THIS("ReadableByteStreamController");

  if ($getByIdDirectPrivate($getByIdDirectPrivate(this, "controlledReadableStream"), "state") !== $streamReadable)
    throw new TypeError("ReadableStream is not readable");

  $readableByteStreamControllerError(this, error);
}

export function close(this: RBC) {
  if (!$isReadableByteStreamController(this)) throw $ERR_INVALID_THIS("ReadableByteStreamController");

  if ($getByIdDirectPrivate(this, "closeRequested")) throw new TypeError("Close has already been requested");

  if ($getByIdDirectPrivate($getByIdDirectPrivate(this, "controlledReadableStream"), "state") !== $streamReadable)
    throw new TypeError("ReadableStream is not readable");

  $readableByteStreamControllerClose(this);
}

$getter;
export function byobRequest(this: RBC) {
  if (!$isReadableByteStreamController(this)) throw $makeGetterTypeError("ReadableByteStreamController", "byobRequest");

  var request = $getByIdDirectPrivate(this, "byobRequest");
  if (request === undefined) {
    // Assume $pendingPullIntos has type 'any' or 'FIFO<any>' in builtins.d.ts
    // Add 'as any' to fix peek error locally, assuming builtins.d.ts will define the property
    var pending = $getByIdDirectPrivate(this, "pendingPullIntos") as any;
    // TODO: Define PullIntoDescriptor type properly
    const firstDescriptor: { buffer: ArrayBuffer; byteOffset: number; bytesFilled: number; byteLength: number } | undefined =
      pending.peek();
    if (firstDescriptor) {
      const view = new Uint8Array(
        firstDescriptor.buffer,
        firstDescriptor.byteOffset + firstDescriptor.bytesFilled,
        firstDescriptor.byteLength - firstDescriptor.bytesFilled,
      );
      // Use $putByIdDirectPrivate with explicit type assertion to satisfy TS2345 and TS2352
      $putByIdDirectPrivate(this as unknown as { $byobRequest: unknown }, "byobRequest", new (ReadableStreamBYOBRequest as any)(this, view, $isReadableStream));
    }
  }

  // Re-fetch the potentially updated value
  return $getByIdDirectPrivate(this, "byobRequest");
}

$getter;
export function desiredSize(this: RBC) {
  if (!$isReadableByteStreamController(this)) throw $makeGetterTypeError("ReadableByteStreamController", "desiredSize");

  return $readableByteStreamControllerGetDesiredSize(this);
}