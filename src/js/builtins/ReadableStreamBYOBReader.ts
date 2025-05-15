/*
 * Copyright (C) 2017 Canon Inc.
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
 * THIS SOFTWARE IS PROVIDED BY CANON INC. AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL CANON INC. AND ITS CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

export function initializeReadableStreamBYOBReader(this, stream) {
  if (!$isReadableStream(stream)) throw new TypeError("ReadableStreamBYOBReader needs a ReadableStream");
  if (!$isReadableByteStreamController($getByIdDirectPrivate(stream, "readableStreamController")))
    throw new TypeError("ReadableStreamBYOBReader needs a ReadableByteStreamController");
  if ($isReadableStreamLocked(stream)) throw new TypeError("ReadableStream is locked");

  $readableStreamReaderGenericInitialize(this, stream);
  $putByIdDirectPrivate(this, "readIntoRequests", $createFIFO());

  return this;
}

export function cancel(this, reason) {
  if (!$isReadableStreamBYOBReader(this)) return Promise.$reject($ERR_INVALID_THIS("ReadableStreamBYOBReader"));

  if (!$getByIdDirectPrivate(this, "ownerReadableStream"))
    return Promise.$reject($ERR_INVALID_STATE_TypeError("The reader is not attached to a stream"));

  return $readableStreamReaderGenericCancel(this, reason);
}

export function read(this, view: DataView) {
  if (!$isReadableStreamBYOBReader(this)) return Promise.$reject($ERR_INVALID_THIS("ReadableStreamBYOBReader"));

  if (!$getByIdDirectPrivate(this, "ownerReadableStream"))
    return Promise.$reject($ERR_INVALID_STATE_TypeError("The reader is not attached to a stream"));

  if (!$isObject(view)) return Promise.$reject($ERR_INVALID_ARG_TYPE("view", "Buffer, TypedArray, or DataView", view));

  if (!ArrayBuffer.$isView(view))
    return Promise.$reject($ERR_INVALID_ARG_TYPE("view", "Buffer, TypedArray, or DataView", view));

  if (view.byteLength === 0) return Promise.$reject($makeTypeError("Provided view cannot have a 0 byteLength"));

  return $readableStreamBYOBReaderRead(this, view);
}

export function releaseLock(this) {
  if (!$isReadableStreamBYOBReader(this)) throw $ERR_INVALID_THIS("ReadableStreamBYOBReader");

  if (!$getByIdDirectPrivate(this, "ownerReadableStream")) return;

  if ($getByIdDirectPrivate(this, "readIntoRequests")?.isNotEmpty())
    throw new TypeError("There are still pending read requests, cannot release the lock");

  $readableStreamReaderGenericRelease(this);
}

$getter;
export function closed(this) {
  if (!$isReadableStreamBYOBReader(this))
    return Promise.$reject($makeGetterTypeError("ReadableStreamBYOBReader", "closed"));

  return $getByIdDirectPrivate(this, "closedPromiseCapability").promise;
}
