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
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

export function initializeReadableByteStreamController(this, stream, underlyingByteSource, highWaterMark) {
  if (arguments.length !== 4 && arguments[3] !== $isReadableStream)
    throw new TypeError("ReadableByteStreamController constructor should not be called directly");

  return $privateInitializeReadableByteStreamController.$call(this, stream, underlyingByteSource, highWaterMark);
}

export function enqueue(this: ReadableByteStreamController, chunk: ArrayBufferView) {
  if (!$isReadableByteStreamController(this)) throw $ERR_INVALID_THIS("ReadableByteStreamController");

  if ($getByIdDirectPrivate(this, "closeRequested")) throw $ERR_INVALID_STATE_TypeError("Controller is already closed");

  if ($getByIdDirectPrivate($getByIdDirectPrivate(this, "controlledReadableStream"), "state") !== $streamReadable)
    throw $ERR_INVALID_STATE_TypeError("Controller is already closed");

  if (!$isObject(chunk) || !ArrayBuffer.$isView(chunk))
    throw $ERR_INVALID_ARG_TYPE("buffer", "Buffer, TypedArray, or DataView", chunk);

  return $readableByteStreamControllerEnqueue(this, chunk);
}

export function error(this: ReadableByteStreamController, error: any) {
  if (!$isReadableByteStreamController(this)) throw $ERR_INVALID_THIS("ReadableByteStreamController");

  if ($getByIdDirectPrivate($getByIdDirectPrivate(this, "controlledReadableStream"), "state") !== $streamReadable)
    throw $ERR_INVALID_STATE_TypeError("Controller is already closed");

  $readableByteStreamControllerError(this, error);
}

export function close(this: ReadableByteStreamController) {
  if (!$isReadableByteStreamController(this)) throw $ERR_INVALID_THIS("ReadableByteStreamController");

  if ($getByIdDirectPrivate(this, "closeRequested")) throw new TypeError("Close has already been requested");

  if ($getByIdDirectPrivate($getByIdDirectPrivate(this, "controlledReadableStream"), "state") !== $streamReadable)
    throw $ERR_INVALID_STATE_TypeError("Controller is already closed");

  $readableByteStreamControllerClose(this);
}

$getter;
export function byobRequest(this) {
  if (!$isReadableByteStreamController(this)) throw $makeGetterTypeError("ReadableByteStreamController", "byobRequest");

  var request = $getByIdDirectPrivate(this, "byobRequest");
  if (request === undefined) {
    var pending = $getByIdDirectPrivate(this, "pendingPullIntos");
    const firstDescriptor = pending.peek();
    if (firstDescriptor) {
      const view = new Uint8Array(
        firstDescriptor.buffer,
        firstDescriptor.byteOffset + firstDescriptor.bytesFilled,
        firstDescriptor.byteLength - firstDescriptor.bytesFilled,
      );
      $putByIdDirectPrivate(this, "byobRequest", new ReadableStreamBYOBRequest(this, view, $isReadableStream));
    }
  }

  return $getByIdDirectPrivate(this, "byobRequest");
}

$getter;
export function desiredSize(this) {
  if (!$isReadableByteStreamController(this)) throw $makeGetterTypeError("ReadableByteStreamController", "desiredSize");

  return $readableByteStreamControllerGetDesiredSize(this);
}
