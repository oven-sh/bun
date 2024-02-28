/*
 * Copyright (C) 2015 Canon Inc.
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

export function initializeReadableStreamDefaultReader(this, stream) {
  if (!$isReadableStream(stream)) throw new TypeError("ReadableStreamDefaultReader needs a ReadableStream");
  if ($isReadableStreamLocked(stream)) throw new TypeError("ReadableStream is locked");

  $readableStreamReaderGenericInitialize(this, stream);
  $putByIdDirectPrivate(this, "readRequests", $createFIFO());

  return this;
}

export function cancel(this, reason) {
  if (!$isReadableStreamDefaultReader(this))
    return Promise.$reject($makeThisTypeError("ReadableStreamDefaultReader", "cancel"));

  if (!$getByIdDirectPrivate(this, "ownerReadableStream"))
    return Promise.$reject(new TypeError("cancel() called on a reader owned by no readable stream"));

  return $readableStreamReaderGenericCancel(this, reason);
}

export function readMany(this: ReadableStreamDefaultReader): ReadableStreamDefaultReadManyResult<any> {
  if (!$isReadableStreamDefaultReader(this))
    throw new TypeError("ReadableStreamDefaultReader.readMany() should not be called directly");

  const stream = $getByIdDirectPrivate(this, "ownerReadableStream");
  if (!stream) throw new TypeError("readMany() called on a reader owned by no readable stream");

  const state = $getByIdDirectPrivate(stream, "state");
  stream.$disturbed = true;
  if (state === $streamClosed) return { value: [], size: 0, done: true };
  else if (state === $streamErrored) {
    throw $getByIdDirectPrivate(stream, "storedError");
  }

  var controller = $getByIdDirectPrivate(stream, "readableStreamController");
  var queue = $getByIdDirectPrivate(controller, "queue");
  if (!queue) {
    // This is a ReadableStream direct controller implemented in JS
    // It hasn't been started yet.
    return controller.$pull(controller).$then(function ({ done, value }) {
      return done ? { done: true, value: [], size: 0 } : { value: [value], size: 1, done: false };
    });
  }

  const content = queue.content;
  var size = queue.size;
  var values = content.toArray(false);

  var length = values.length;

  if (length > 0) {
    var outValues = $newArrayWithSize(length);
    if ($isReadableByteStreamController(controller)) {
      {
        const buf = values[0];
        if (!(ArrayBuffer.$isView(buf) || buf instanceof ArrayBuffer)) {
          $putByValDirect(outValues, 0, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        } else {
          $putByValDirect(outValues, 0, buf);
        }
      }

      for (var i = 1; i < length; i++) {
        const buf = values[i];
        if (!(ArrayBuffer.$isView(buf) || buf instanceof ArrayBuffer)) {
          $putByValDirect(outValues, i, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        } else {
          $putByValDirect(outValues, i, buf);
        }
      }
    } else {
      $putByValDirect(outValues, 0, values[0].value);
      for (var i = 1; i < length; i++) {
        $putByValDirect(outValues, i, values[i].value);
      }
    }
    $resetQueue($getByIdDirectPrivate(controller, "queue"));

    if ($getByIdDirectPrivate(controller, "closeRequested")) {
      $readableStreamCloseIfPossible($getByIdDirectPrivate(controller, "controlledReadableStream"));
    } else if ($isReadableStreamDefaultController(controller)) {
      $readableStreamDefaultControllerCallPullIfNeeded(controller);
    } else if ($isReadableByteStreamController(controller)) {
      $readableByteStreamControllerCallPullIfNeeded(controller);
    }

    return { value: outValues, size, done: false };
  }

  var onPullMany = result => {
    if (result.done) {
      return { value: [], size: 0, done: true };
    }
    var controller = $getByIdDirectPrivate(stream, "readableStreamController");

    var queue = $getByIdDirectPrivate(controller, "queue");
    var value = [result.value].concat(queue.content.toArray(false));
    var length = value.length;

    if ($isReadableByteStreamController(controller)) {
      for (var i = 0; i < length; i++) {
        const buf = value[i];
        if (!(ArrayBuffer.$isView(buf) || buf instanceof ArrayBuffer)) {
          const { buffer, byteOffset, byteLength } = buf;
          $putByValDirect(value, i, new Uint8Array(buffer, byteOffset, byteLength));
        }
      }
    } else {
      for (var i = 1; i < length; i++) {
        $putByValDirect(value, i, value[i].value);
      }
    }

    var size = queue.size;
    $resetQueue(queue);

    if ($getByIdDirectPrivate(controller, "closeRequested")) {
      $readableStreamCloseIfPossible($getByIdDirectPrivate(controller, "controlledReadableStream"));
    } else if ($isReadableStreamDefaultController(controller)) {
      $readableStreamDefaultControllerCallPullIfNeeded(controller);
    } else if ($isReadableByteStreamController(controller)) {
      $readableByteStreamControllerCallPullIfNeeded(controller);
    }

    return { value: value, size: size, done: false };
  };

  var pullResult = controller.$pull(controller);
  if (pullResult && $isPromise(pullResult)) {
    return pullResult.$then(onPullMany) as any;
  }

  return onPullMany(pullResult);
}

export function read(this) {
  if (!$isReadableStreamDefaultReader(this))
    return Promise.$reject($makeThisTypeError("ReadableStreamDefaultReader", "read"));
  if (!$getByIdDirectPrivate(this, "ownerReadableStream"))
    return Promise.$reject(new TypeError("read() called on a reader owned by no readable stream"));

  return $readableStreamDefaultReaderRead(this);
}

export function releaseLock(this) {
  if (!$isReadableStreamDefaultReader(this)) throw $makeThisTypeError("ReadableStreamDefaultReader", "releaseLock");

  if (!$getByIdDirectPrivate(this, "ownerReadableStream")) return;

  if ($getByIdDirectPrivate(this, "readRequests")?.isNotEmpty())
    throw new TypeError("There are still pending read requests, cannot release the lock");

  $readableStreamReaderGenericRelease(this);
}

$getter;
export function closed(this) {
  if (!$isReadableStreamDefaultReader(this))
    return Promise.$reject($makeGetterTypeError("ReadableStreamDefaultReader", "closed"));

  return $getByIdDirectPrivate(this, "closedPromiseCapability").promise;
}
