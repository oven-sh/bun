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

// @internal

export function isTransformStream(stream) {
  return $isObject(stream) && !!$getByIdDirectPrivate(stream, "readable");
}

export function isTransformStreamDefaultController(controller) {
  return $isObject(controller) && !!$getByIdDirectPrivate(controller, "transformAlgorithm");
}

export function createTransformStream(
  startAlgorithm,
  transformAlgorithm,
  flushAlgorithm,
  writableHighWaterMark,
  writableSizeAlgorithm,
  readableHighWaterMark,
  readableSizeAlgorithm,
) {
  if (writableHighWaterMark === undefined) writableHighWaterMark = 1;
  if (writableSizeAlgorithm === undefined) writableSizeAlgorithm = () => 1;
  if (readableHighWaterMark === undefined) readableHighWaterMark = 0;
  if (readableSizeAlgorithm === undefined) readableSizeAlgorithm = () => 1;
  $assert(writableHighWaterMark >= 0);
  $assert(readableHighWaterMark >= 0);

  const transform = {};
  $putByIdDirectPrivate(transform, "TransformStream", true);

  const stream = new TransformStream(transform);
  const startPromiseCapability = $newPromiseCapability(Promise);
  $initializeTransformStream(
    stream,
    startPromiseCapability.$promise,
    writableHighWaterMark,
    writableSizeAlgorithm,
    readableHighWaterMark,
    readableSizeAlgorithm,
  );

  const controller = new TransformStreamDefaultController();
  $setUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm);

  startAlgorithm().$then(
    () => {
      startPromiseCapability.$resolve.$call();
    },
    error => {
      startPromiseCapability.$reject.$call(undefined, error);
    },
  );

  return stream;
}

export function initializeTransformStream(
  stream,
  startPromise,
  writableHighWaterMark,
  writableSizeAlgorithm,
  readableHighWaterMark,
  readableSizeAlgorithm,
) {
  const startAlgorithm = () => {
    return startPromise;
  };
  const writeAlgorithm = chunk => {
    return $transformStreamDefaultSinkWriteAlgorithm(stream, chunk);
  };
  const abortAlgorithm = reason => {
    return $transformStreamDefaultSinkAbortAlgorithm(stream, reason);
  };
  const closeAlgorithm = () => {
    return $transformStreamDefaultSinkCloseAlgorithm(stream);
  };
  const writable = $createWritableStream(
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    writableHighWaterMark,
    writableSizeAlgorithm,
  );

  const pullAlgorithm = () => {
    return $transformStreamDefaultSourcePullAlgorithm(stream);
  };
  const cancelAlgorithm = reason => {
    $transformStreamErrorWritableAndUnblockWrite(stream, reason);
    return Promise.$resolve();
  };
  const underlyingSource = {};
  $putByIdDirectPrivate(underlyingSource, "start", startAlgorithm);
  $putByIdDirectPrivate(underlyingSource, "pull", pullAlgorithm);
  $putByIdDirectPrivate(underlyingSource, "cancel", cancelAlgorithm);
  const options = {};
  $putByIdDirectPrivate(options, "size", readableSizeAlgorithm);
  $putByIdDirectPrivate(options, "highWaterMark", readableHighWaterMark);
  const readable = new ReadableStream(underlyingSource, options);

  // The writable to expose to JS through writable getter.
  $putByIdDirectPrivate(stream, "writable", writable);
  // The writable to use for the actual transform algorithms.
  $putByIdDirectPrivate(stream, "internalWritable", $getInternalWritableStream(writable));

  $putByIdDirectPrivate(stream, "readable", readable);
  $putByIdDirectPrivate(stream, "backpressure", undefined);
  $putByIdDirectPrivate(stream, "backpressureChangePromise", undefined);

  $transformStreamSetBackpressure(stream, true);
  $putByIdDirectPrivate(stream, "controller", undefined);
}

export function transformStreamError(stream, e) {
  const readable = $getByIdDirectPrivate(stream, "readable");
  const readableController = $getByIdDirectPrivate(readable, "readableStreamController");
  $readableStreamDefaultControllerError(readableController, e);

  $transformStreamErrorWritableAndUnblockWrite(stream, e);
}

export function transformStreamErrorWritableAndUnblockWrite(stream, e) {
  $transformStreamDefaultControllerClearAlgorithms($getByIdDirectPrivate(stream, "controller"));

  const writable = $getByIdDirectPrivate(stream, "internalWritable");
  $writableStreamDefaultControllerErrorIfNeeded($getByIdDirectPrivate(writable, "controller"), e);

  if ($getByIdDirectPrivate(stream, "backpressure")) $transformStreamSetBackpressure(stream, false);
}

export function transformStreamSetBackpressure(stream, backpressure) {
  $assert($getByIdDirectPrivate(stream, "backpressure") !== backpressure);

  const backpressureChangePromise = $getByIdDirectPrivate(stream, "backpressureChangePromise");
  if (backpressureChangePromise !== undefined) backpressureChangePromise.$resolve.$call();

  $putByIdDirectPrivate(stream, "backpressureChangePromise", $newPromiseCapability(Promise));
  $putByIdDirectPrivate(stream, "backpressure", backpressure);
}

export function setUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm) {
  $assert($isTransformStream(stream));
  $assert($getByIdDirectPrivate(stream, "controller") === undefined);

  $putByIdDirectPrivate(controller, "stream", stream);
  $putByIdDirectPrivate(stream, "controller", controller);
  $putByIdDirectPrivate(controller, "transformAlgorithm", transformAlgorithm);
  $putByIdDirectPrivate(controller, "flushAlgorithm", flushAlgorithm);
}

export function setUpTransformStreamDefaultControllerFromTransformer(stream, transformer, transformerDict) {
  const controller = new TransformStreamDefaultController();
  let transformAlgorithm = chunk => {
    try {
      $transformStreamDefaultControllerEnqueue(controller, chunk);
    } catch (e) {
      return Promise.$reject(e);
    }
    return Promise.$resolve();
  };
  let flushAlgorithm = () => {
    return Promise.$resolve();
  };

  if ("transform" in transformerDict)
    transformAlgorithm = chunk => {
      return $promiseInvokeOrNoopMethod(transformer, transformerDict["transform"], [chunk, controller]);
    };

  if ("flush" in transformerDict) {
    flushAlgorithm = () => {
      return $promiseInvokeOrNoopMethod(transformer, transformerDict["flush"], [controller]);
    };
  }

  $setUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm);
}

export function transformStreamDefaultControllerClearAlgorithms(controller) {
  // We set transformAlgorithm to true to allow GC but keep the isTransformStreamDefaultController check.
  $putByIdDirectPrivate(controller, "transformAlgorithm", true);
  $putByIdDirectPrivate(controller, "flushAlgorithm", undefined);
}

export function transformStreamDefaultControllerEnqueue(controller, chunk) {
  const stream = $getByIdDirectPrivate(controller, "stream");
  const readable = $getByIdDirectPrivate(stream, "readable");
  const readableController = $getByIdDirectPrivate(readable, "readableStreamController");

  $assert(readableController !== undefined);
  if (!$readableStreamDefaultControllerCanCloseOrEnqueue(readableController))
    $throwTypeError("TransformStream.readable cannot close or enqueue");

  try {
    $readableStreamDefaultControllerEnqueue(readableController, chunk);
  } catch (e) {
    $transformStreamErrorWritableAndUnblockWrite(stream, e);
    throw $getByIdDirectPrivate(readable, "storedError");
  }

  const backpressure = !$readableStreamDefaultControllerShouldCallPull(readableController);
  if (backpressure !== $getByIdDirectPrivate(stream, "backpressure")) {
    $assert(backpressure);
    $transformStreamSetBackpressure(stream, true);
  }
}

export function transformStreamDefaultControllerError(controller, e) {
  $transformStreamError($getByIdDirectPrivate(controller, "stream"), e);
}

export function transformStreamDefaultControllerPerformTransform(controller, chunk) {
  const promiseCapability = $newPromiseCapability(Promise);

  const transformPromise = $getByIdDirectPrivate(controller, "transformAlgorithm").$call(undefined, chunk);
  transformPromise.$then(
    () => {
      promiseCapability.$resolve();
    },
    r => {
      $transformStreamError($getByIdDirectPrivate(controller, "stream"), r);
      promiseCapability.$reject.$call(undefined, r);
    },
  );
  return promiseCapability.$promise;
}

export function transformStreamDefaultControllerTerminate(controller) {
  const stream = $getByIdDirectPrivate(controller, "stream");
  const readable = $getByIdDirectPrivate(stream, "readable");
  const readableController = $getByIdDirectPrivate(readable, "readableStreamController");

  // FIXME: Update readableStreamDefaultControllerClose to make this check.
  if ($readableStreamDefaultControllerCanCloseOrEnqueue(readableController))
    $readableStreamDefaultControllerClose(readableController);
  const error = $makeTypeError("the stream has been terminated");
  $transformStreamErrorWritableAndUnblockWrite(stream, error);
}

export function transformStreamDefaultSinkWriteAlgorithm(stream, chunk) {
  const writable = $getByIdDirectPrivate(stream, "internalWritable");

  $assert($getByIdDirectPrivate(writable, "state") === "writable");

  const controller = $getByIdDirectPrivate(stream, "controller");

  if ($getByIdDirectPrivate(stream, "backpressure")) {
    const promiseCapability = $newPromiseCapability(Promise);

    const backpressureChangePromise = $getByIdDirectPrivate(stream, "backpressureChangePromise");
    $assert(backpressureChangePromise !== undefined);
    backpressureChangePromise.$promise.$then(
      () => {
        const state = $getByIdDirectPrivate(writable, "state");
        if (state === "erroring") {
          promiseCapability.$reject.$call(undefined, $getByIdDirectPrivate(writable, "storedError"));
          return;
        }

        $assert(state === "writable");
        $transformStreamDefaultControllerPerformTransform(controller, chunk).$then(
          () => {
            promiseCapability.$resolve();
          },
          e => {
            promiseCapability.$reject.$call(undefined, e);
          },
        );
      },
      e => {
        promiseCapability.$reject.$call(undefined, e);
      },
    );

    return promiseCapability.$promise;
  }
  return $transformStreamDefaultControllerPerformTransform(controller, chunk);
}

export function transformStreamDefaultSinkAbortAlgorithm(stream, reason) {
  $transformStreamError(stream, reason);
  return Promise.$resolve();
}

export function transformStreamDefaultSinkCloseAlgorithm(stream) {
  const readable = $getByIdDirectPrivate(stream, "readable");
  const controller = $getByIdDirectPrivate(stream, "controller");
  const readableController = $getByIdDirectPrivate(readable, "readableStreamController");

  const flushAlgorithm = $getByIdDirectPrivate(controller, "flushAlgorithm");
  $assert(flushAlgorithm !== undefined);
  const flushPromise = $getByIdDirectPrivate(controller, "flushAlgorithm").$call();
  $transformStreamDefaultControllerClearAlgorithms(controller);

  const promiseCapability = $newPromiseCapability(Promise);
  flushPromise.$then(
    () => {
      if ($getByIdDirectPrivate(readable, "state") === $streamErrored) {
        promiseCapability.$reject.$call(undefined, $getByIdDirectPrivate(readable, "storedError"));
        return;
      }

      // FIXME: Update readableStreamDefaultControllerClose to make this check.
      if ($readableStreamDefaultControllerCanCloseOrEnqueue(readableController))
        $readableStreamDefaultControllerClose(readableController);
      promiseCapability.$resolve();
    },
    r => {
      $transformStreamError($getByIdDirectPrivate(controller, "stream"), r);
      promiseCapability.$reject.$call(undefined, $getByIdDirectPrivate(readable, "storedError"));
    },
  );
  return promiseCapability.$promise;
}

export function transformStreamDefaultSourcePullAlgorithm(stream) {
  $assert($getByIdDirectPrivate(stream, "backpressure"));
  $assert($getByIdDirectPrivate(stream, "backpressureChangePromise") !== undefined);

  $transformStreamSetBackpressure(stream, false);

  return $getByIdDirectPrivate(stream, "backpressureChangePromise").$promise;
}
