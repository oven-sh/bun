/*
 * Copyright (C) 2020 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

export function initializeWritableStreamDefaultController(this) {
  $putByIdDirectPrivate(this, "queue", $newQueue());
  $putByIdDirectPrivate(this, "abortSteps", reason => {
    const result = $getByIdDirectPrivate(this, "abortAlgorithm").$call(undefined, reason);
    $writableStreamDefaultControllerClearAlgorithms(this);
    return result;
  });

  $putByIdDirectPrivate(this, "errorSteps", () => {
    $resetQueue($getByIdDirectPrivate(this, "queue"));
  });

  return this;
}

export function error(this, e) {
  if ($getByIdDirectPrivate(this, "abortSteps") === undefined)
    throw $makeThisTypeError("WritableStreamDefaultController", "error");

  const stream = $getByIdDirectPrivate(this, "stream");
  if ($getByIdDirectPrivate(stream, "state") !== "writable") return;
  $writableStreamDefaultControllerError(this, e);
}
