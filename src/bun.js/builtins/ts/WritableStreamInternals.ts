/*
 * Copyright (C) 2015 Canon Inc.
 * Copyright (C) 2015 Igalia
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

// @internal

export function isWritableStream(stream) {
  return $isObject(stream) && !!$getByIdDirectPrivate(stream, "underlyingSink");
}

export function isWritableStreamDefaultWriter(writer) {
  return $isObject(writer) && !!$getByIdDirectPrivate(writer, "closedPromise");
}

export function acquireWritableStreamDefaultWriter(stream) {
  return new WritableStreamDefaultWriter(stream);
}

// https://streams.spec.whatwg.org/#create-writable-stream
export function createWritableStream(
  startAlgorithm,
  writeAlgorithm,
  closeAlgorithm,
  abortAlgorithm,
  highWaterMark,
  sizeAlgorithm,
) {
  $assert(typeof highWaterMark === "number" && !isNaN(highWaterMark) && highWaterMark >= 0);

  const internalStream = {};
  $initializeWritableStreamSlots(internalStream, {});
  const controller = new WritableStreamDefaultController();

  $setUpWritableStreamDefaultController(
    internalStream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm,
  );

  return $createWritableStreamFromInternal(internalStream);
}

export function createInternalWritableStreamFromUnderlyingSink(underlyingSink, strategy) {
  const stream = {};

  if (underlyingSink === undefined) underlyingSink = {};

  if (strategy === undefined) strategy = {};

  if (!$isObject(underlyingSink)) $throwTypeError("WritableStream constructor takes an object as first argument");

  if ("type" in underlyingSink) $throwRangeError("Invalid type is specified");

  const sizeAlgorithm = $extractSizeAlgorithm(strategy);
  const highWaterMark = $extractHighWaterMark(strategy, 1);

  const underlyingSinkDict = {};
  if ("start" in underlyingSink) {
    underlyingSinkDict["start"] = underlyingSink["start"];
    if (typeof underlyingSinkDict["start"] !== "function") $throwTypeError("underlyingSink.start should be a function");
  }
  if ("write" in underlyingSink) {
    underlyingSinkDict["write"] = underlyingSink["write"];
    if (typeof underlyingSinkDict["write"] !== "function") $throwTypeError("underlyingSink.write should be a function");
  }
  if ("close" in underlyingSink) {
    underlyingSinkDict["close"] = underlyingSink["close"];
    if (typeof underlyingSinkDict["close"] !== "function") $throwTypeError("underlyingSink.close should be a function");
  }
  if ("abort" in underlyingSink) {
    underlyingSinkDict["abort"] = underlyingSink["abort"];
    if (typeof underlyingSinkDict["abort"] !== "function") $throwTypeError("underlyingSink.abort should be a function");
  }

  $initializeWritableStreamSlots(stream, underlyingSink);
  $setUpWritableStreamDefaultControllerFromUnderlyingSink(
    stream,
    underlyingSink,
    underlyingSinkDict,
    highWaterMark,
    sizeAlgorithm,
  );

  return stream;
}

export function initializeWritableStreamSlots(stream, underlyingSink) {
  $putByIdDirectPrivate(stream, "state", "writable");
  $putByIdDirectPrivate(stream, "storedError", undefined);
  $putByIdDirectPrivate(stream, "writer", undefined);
  $putByIdDirectPrivate(stream, "controller", undefined);
  $putByIdDirectPrivate(stream, "inFlightWriteRequest", undefined);
  $putByIdDirectPrivate(stream, "closeRequest", undefined);
  $putByIdDirectPrivate(stream, "inFlightCloseRequest", undefined);
  $putByIdDirectPrivate(stream, "pendingAbortRequest", undefined);
  $putByIdDirectPrivate(stream, "writeRequests", $createFIFO());
  $putByIdDirectPrivate(stream, "backpressure", false);
  $putByIdDirectPrivate(stream, "underlyingSink", underlyingSink);
}

export function writableStreamCloseForBindings(stream) {
  if ($isWritableStreamLocked(stream))
    return Promise.$reject($makeTypeError("WritableStream.close method can only be used on non locked WritableStream"));

  if ($writableStreamCloseQueuedOrInFlight(stream))
    return Promise.$reject(
      $makeTypeError("WritableStream.close method can only be used on a being close WritableStream"),
    );

  return $writableStreamClose(stream);
}

export function writableStreamAbortForBindings(stream, reason) {
  if ($isWritableStreamLocked(stream))
    return Promise.$reject($makeTypeError("WritableStream.abort method can only be used on non locked WritableStream"));

  return $writableStreamAbort(stream, reason);
}

export function isWritableStreamLocked(stream) {
  return $getByIdDirectPrivate(stream, "writer") !== undefined;
}

export function setUpWritableStreamDefaultWriter(writer, stream) {
  if ($isWritableStreamLocked(stream)) $throwTypeError("WritableStream is locked");

  $putByIdDirectPrivate(writer, "stream", stream);
  $putByIdDirectPrivate(stream, "writer", writer);

  const readyPromiseCapability = $newPromiseCapability(Promise);
  const closedPromiseCapability = $newPromiseCapability(Promise);
  $putByIdDirectPrivate(writer, "readyPromise", readyPromiseCapability);
  $putByIdDirectPrivate(writer, "closedPromise", closedPromiseCapability);

  const state = $getByIdDirectPrivate(stream, "state");
  if (state === "writable") {
    if ($writableStreamCloseQueuedOrInFlight(stream) || !$getByIdDirectPrivate(stream, "backpressure"))
      readyPromiseCapability.$resolve.$call();
  } else if (state === "erroring") {
    readyPromiseCapability.$reject.$call(undefined, $getByIdDirectPrivate(stream, "storedError"));
    $markPromiseAsHandled(readyPromiseCapability.$promise);
  } else if (state === "closed") {
    readyPromiseCapability.$resolve.$call();
    closedPromiseCapability.$resolve.$call();
  } else {
    $assert(state === "errored");
    const storedError = $getByIdDirectPrivate(stream, "storedError");
    readyPromiseCapability.$reject.$call(undefined, storedError);
    $markPromiseAsHandled(readyPromiseCapability.$promise);
    closedPromiseCapability.$reject.$call(undefined, storedError);
    $markPromiseAsHandled(closedPromiseCapability.$promise);
  }
}

export function writableStreamAbort(stream, reason) {
  const state = $getByIdDirectPrivate(stream, "state");
  if (state === "closed" || state === "errored") return Promise.$resolve();

  const pendingAbortRequest = $getByIdDirectPrivate(stream, "pendingAbortRequest");
  if (pendingAbortRequest !== undefined) return pendingAbortRequest.promise.$promise;

  $assert(state === "writable" || state === "erroring");
  let wasAlreadyErroring = false;
  if (state === "erroring") {
    wasAlreadyErroring = true;
    reason = undefined;
  }

  const abortPromiseCapability = $newPromiseCapability(Promise);
  $putByIdDirectPrivate(stream, "pendingAbortRequest", {
    promise: abortPromiseCapability,
    reason: reason,
    wasAlreadyErroring: wasAlreadyErroring,
  });

  if (!wasAlreadyErroring) $writableStreamStartErroring(stream, reason);
  return abortPromiseCapability.$promise;
}

export function writableStreamClose(stream) {
  const state = $getByIdDirectPrivate(stream, "state");
  if (state === "closed" || state === "errored")
    return Promise.$reject($makeTypeError("Cannot close a writable stream that is closed or errored"));

  $assert(state === "writable" || state === "erroring");
  $assert(!$writableStreamCloseQueuedOrInFlight(stream));

  const closePromiseCapability = $newPromiseCapability(Promise);
  $putByIdDirectPrivate(stream, "closeRequest", closePromiseCapability);

  const writer = $getByIdDirectPrivate(stream, "writer");
  if (writer !== undefined && $getByIdDirectPrivate(stream, "backpressure") && state === "writable")
    $getByIdDirectPrivate(writer, "readyPromise").$resolve.$call();

  $writableStreamDefaultControllerClose($getByIdDirectPrivate(stream, "controller"));

  return closePromiseCapability.$promise;
}

export function writableStreamAddWriteRequest(stream) {
  $assert($isWritableStreamLocked(stream));
  $assert($getByIdDirectPrivate(stream, "state") === "writable");

  const writePromiseCapability = $newPromiseCapability(Promise);
  const writeRequests = $getByIdDirectPrivate(stream, "writeRequests");
  writeRequests.push(writePromiseCapability);
  return writePromiseCapability.$promise;
}

export function writableStreamCloseQueuedOrInFlight(stream) {
  return (
    $getByIdDirectPrivate(stream, "closeRequest") !== undefined ||
    $getByIdDirectPrivate(stream, "inFlightCloseRequest") !== undefined
  );
}

export function writableStreamDealWithRejection(stream, error) {
  const state = $getByIdDirectPrivate(stream, "state");
  if (state === "writable") {
    $writableStreamStartErroring(stream, error);
    return;
  }

  $assert(state === "erroring");
  $writableStreamFinishErroring(stream);
}

export function writableStreamFinishErroring(stream) {
  $assert($getByIdDirectPrivate(stream, "state") === "erroring");
  $assert(!$writableStreamHasOperationMarkedInFlight(stream));

  $putByIdDirectPrivate(stream, "state", "errored");

  const controller = $getByIdDirectPrivate(stream, "controller");
  $getByIdDirectPrivate(controller, "errorSteps").$call();

  const storedError = $getByIdDirectPrivate(stream, "storedError");
  const requests = $getByIdDirectPrivate(stream, "writeRequests");
  for (var request = requests.shift(); request; request = requests.shift())
    request.$reject.$call(undefined, storedError);

  // TODO: is this still necessary?
  $putByIdDirectPrivate(stream, "writeRequests", $createFIFO());

  const abortRequest = $getByIdDirectPrivate(stream, "pendingAbortRequest");
  if (abortRequest === undefined) {
    $writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }

  $putByIdDirectPrivate(stream, "pendingAbortRequest", undefined);
  if (abortRequest.wasAlreadyErroring) {
    abortRequest.promise.$reject.$call(undefined, storedError);
    $writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
    return;
  }

  $getByIdDirectPrivate(controller, "abortSteps")
    .$call(undefined, abortRequest.reason)
    .$then(
      () => {
        abortRequest.promise.$resolve.$call();
        $writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
      },
      reason => {
        abortRequest.promise.$reject.$call(undefined, reason);
        $writableStreamRejectCloseAndClosedPromiseIfNeeded(stream);
      },
    );
}

export function writableStreamFinishInFlightClose(stream) {
  const inFlightCloseRequest = $getByIdDirectPrivate(stream, "inFlightCloseRequest");
  inFlightCloseRequest.$resolve.$call();

  $putByIdDirectPrivate(stream, "inFlightCloseRequest", undefined);

  const state = $getByIdDirectPrivate(stream, "state");
  $assert(state === "writable" || state === "erroring");

  if (state === "erroring") {
    $putByIdDirectPrivate(stream, "storedError", undefined);
    const abortRequest = $getByIdDirectPrivate(stream, "pendingAbortRequest");
    if (abortRequest !== undefined) {
      abortRequest.promise.$resolve.$call();
      $putByIdDirectPrivate(stream, "pendingAbortRequest", undefined);
    }
  }

  $putByIdDirectPrivate(stream, "state", "closed");

  const writer = $getByIdDirectPrivate(stream, "writer");
  if (writer !== undefined) $getByIdDirectPrivate(writer, "closedPromise").$resolve.$call();

  $assert($getByIdDirectPrivate(stream, "pendingAbortRequest") === undefined);
  $assert($getByIdDirectPrivate(stream, "storedError") === undefined);
}

export function writableStreamFinishInFlightCloseWithError(stream, error) {
  const inFlightCloseRequest = $getByIdDirectPrivate(stream, "inFlightCloseRequest");
  $assert(inFlightCloseRequest !== undefined);
  inFlightCloseRequest.$reject.$call(undefined, error);

  $putByIdDirectPrivate(stream, "inFlightCloseRequest", undefined);

  const state = $getByIdDirectPrivate(stream, "state");
  $assert(state === "writable" || state === "erroring");

  const abortRequest = $getByIdDirectPrivate(stream, "pendingAbortRequest");
  if (abortRequest !== undefined) {
    abortRequest.promise.$reject.$call(undefined, error);
    $putByIdDirectPrivate(stream, "pendingAbortRequest", undefined);
  }

  $writableStreamDealWithRejection(stream, error);
}

export function writableStreamFinishInFlightWrite(stream) {
  const inFlightWriteRequest = $getByIdDirectPrivate(stream, "inFlightWriteRequest");
  $assert(inFlightWriteRequest !== undefined);
  inFlightWriteRequest.$resolve.$call();

  $putByIdDirectPrivate(stream, "inFlightWriteRequest", undefined);
}

export function writableStreamFinishInFlightWriteWithError(stream, error) {
  const inFlightWriteRequest = $getByIdDirectPrivate(stream, "inFlightWriteRequest");
  $assert(inFlightWriteRequest !== undefined);
  inFlightWriteRequest.$reject.$call(undefined, error);

  $putByIdDirectPrivate(stream, "inFlightWriteRequest", undefined);

  const state = $getByIdDirectPrivate(stream, "state");
  $assert(state === "writable" || state === "erroring");

  $writableStreamDealWithRejection(stream, error);
}

export function writableStreamHasOperationMarkedInFlight(stream) {
  return (
    $getByIdDirectPrivate(stream, "inFlightWriteRequest") !== undefined ||
    $getByIdDirectPrivate(stream, "inFlightCloseRequest") !== undefined
  );
}

export function writableStreamMarkCloseRequestInFlight(stream) {
  const closeRequest = $getByIdDirectPrivate(stream, "closeRequest");
  $assert($getByIdDirectPrivate(stream, "inFlightCloseRequest") === undefined);
  $assert(closeRequest !== undefined);

  $putByIdDirectPrivate(stream, "inFlightCloseRequest", closeRequest);
  $putByIdDirectPrivate(stream, "closeRequest", undefined);
}

export function writableStreamMarkFirstWriteRequestInFlight(stream) {
  const writeRequests = $getByIdDirectPrivate(stream, "writeRequests");
  $assert($getByIdDirectPrivate(stream, "inFlightWriteRequest") === undefined);
  $assert(writeRequests.isNotEmpty());

  const writeRequest = writeRequests.shift();
  $putByIdDirectPrivate(stream, "inFlightWriteRequest", writeRequest);
}

export function writableStreamRejectCloseAndClosedPromiseIfNeeded(stream) {
  $assert($getByIdDirectPrivate(stream, "state") === "errored");

  const storedError = $getByIdDirectPrivate(stream, "storedError");

  const closeRequest = $getByIdDirectPrivate(stream, "closeRequest");
  if (closeRequest !== undefined) {
    $assert($getByIdDirectPrivate(stream, "inFlightCloseRequest") === undefined);
    closeRequest.$reject.$call(undefined, storedError);
    $putByIdDirectPrivate(stream, "closeRequest", undefined);
  }

  const writer = $getByIdDirectPrivate(stream, "writer");
  if (writer !== undefined) {
    const closedPromise = $getByIdDirectPrivate(writer, "closedPromise");
    closedPromise.$reject.$call(undefined, storedError);
    $markPromiseAsHandled(closedPromise.$promise);
  }
}

export function writableStreamStartErroring(stream, reason) {
  $assert($getByIdDirectPrivate(stream, "storedError") === undefined);
  $assert($getByIdDirectPrivate(stream, "state") === "writable");

  const controller = $getByIdDirectPrivate(stream, "controller");
  $assert(controller !== undefined);

  $putByIdDirectPrivate(stream, "state", "erroring");
  $putByIdDirectPrivate(stream, "storedError", reason);

  const writer = $getByIdDirectPrivate(stream, "writer");
  if (writer !== undefined) $writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, reason);

  if (!$writableStreamHasOperationMarkedInFlight(stream) && $getByIdDirectPrivate(controller, "started") === 1)
    $writableStreamFinishErroring(stream);
}

export function writableStreamUpdateBackpressure(stream, backpressure) {
  $assert($getByIdDirectPrivate(stream, "state") === "writable");
  $assert(!$writableStreamCloseQueuedOrInFlight(stream));

  const writer = $getByIdDirectPrivate(stream, "writer");
  if (writer !== undefined && backpressure !== $getByIdDirectPrivate(stream, "backpressure")) {
    if (backpressure) $putByIdDirectPrivate(writer, "readyPromise", $newPromiseCapability(Promise));
    else $getByIdDirectPrivate(writer, "readyPromise").$resolve.$call();
  }
  $putByIdDirectPrivate(stream, "backpressure", backpressure);
}

export function writableStreamDefaultWriterAbort(writer, reason) {
  const stream = $getByIdDirectPrivate(writer, "stream");
  $assert(stream !== undefined);
  return $writableStreamAbort(stream, reason);
}

export function writableStreamDefaultWriterClose(writer) {
  const stream = $getByIdDirectPrivate(writer, "stream");
  $assert(stream !== undefined);
  return $writableStreamClose(stream);
}

export function writableStreamDefaultWriterCloseWithErrorPropagation(writer) {
  const stream = $getByIdDirectPrivate(writer, "stream");
  $assert(stream !== undefined);

  const state = $getByIdDirectPrivate(stream, "state");

  if ($writableStreamCloseQueuedOrInFlight(stream) || state === "closed") return Promise.$resolve();

  if (state === "errored") return Promise.$reject($getByIdDirectPrivate(stream, "storedError"));

  $assert(state === "writable" || state === "erroring");
  return $writableStreamDefaultWriterClose(writer);
}

export function writableStreamDefaultWriterEnsureClosedPromiseRejected(writer, error) {
  let closedPromiseCapability = $getByIdDirectPrivate(writer, "closedPromise");
  let closedPromise = closedPromiseCapability.$promise;

  if (($getPromiseInternalField(closedPromise, $promiseFieldFlags) & $promiseStateMask) !== $promiseStatePending) {
    closedPromiseCapability = $newPromiseCapability(Promise);
    closedPromise = closedPromiseCapability.$promise;
    $putByIdDirectPrivate(writer, "closedPromise", closedPromiseCapability);
  }

  closedPromiseCapability.$reject.$call(undefined, error);
  $markPromiseAsHandled(closedPromise);
}

export function writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, error) {
  let readyPromiseCapability = $getByIdDirectPrivate(writer, "readyPromise");
  let readyPromise = readyPromiseCapability.$promise;

  if (($getPromiseInternalField(readyPromise, $promiseFieldFlags) & $promiseStateMask) !== $promiseStatePending) {
    readyPromiseCapability = $newPromiseCapability(Promise);
    readyPromise = readyPromiseCapability.$promise;
    $putByIdDirectPrivate(writer, "readyPromise", readyPromiseCapability);
  }

  readyPromiseCapability.$reject.$call(undefined, error);
  $markPromiseAsHandled(readyPromise);
}

export function writableStreamDefaultWriterGetDesiredSize(writer) {
  const stream = $getByIdDirectPrivate(writer, "stream");
  $assert(stream !== undefined);

  const state = $getByIdDirectPrivate(stream, "state");

  if (state === "errored" || state === "erroring") return null;

  if (state === "closed") return 0;

  return $writableStreamDefaultControllerGetDesiredSize($getByIdDirectPrivate(stream, "controller"));
}

export function writableStreamDefaultWriterRelease(writer) {
  const stream = $getByIdDirectPrivate(writer, "stream");
  $assert(stream !== undefined);
  $assert($getByIdDirectPrivate(stream, "writer") === writer);

  const releasedError = $makeTypeError("writableStreamDefaultWriterRelease");

  $writableStreamDefaultWriterEnsureReadyPromiseRejected(writer, releasedError);
  $writableStreamDefaultWriterEnsureClosedPromiseRejected(writer, releasedError);

  $putByIdDirectPrivate(stream, "writer", undefined);
  $putByIdDirectPrivate(writer, "stream", undefined);
}

export function writableStreamDefaultWriterWrite(writer, chunk) {
  const stream = $getByIdDirectPrivate(writer, "stream");
  $assert(stream !== undefined);

  const controller = $getByIdDirectPrivate(stream, "controller");
  $assert(controller !== undefined);
  const chunkSize = $writableStreamDefaultControllerGetChunkSize(controller, chunk);

  if (stream !== $getByIdDirectPrivate(writer, "stream"))
    return Promise.$reject($makeTypeError("writer is not stream's writer"));

  const state = $getByIdDirectPrivate(stream, "state");
  if (state === "errored") return Promise.$reject($getByIdDirectPrivate(stream, "storedError"));

  if ($writableStreamCloseQueuedOrInFlight(stream) || state === "closed")
    return Promise.$reject($makeTypeError("stream is closing or closed"));

  if ($writableStreamCloseQueuedOrInFlight(stream) || state === "closed")
    return Promise.$reject($makeTypeError("stream is closing or closed"));

  if (state === "erroring") return Promise.$reject($getByIdDirectPrivate(stream, "storedError"));

  $assert(state === "writable");

  const promise = $writableStreamAddWriteRequest(stream);
  $writableStreamDefaultControllerWrite(controller, chunk, chunkSize);
  return promise;
}

export function setUpWritableStreamDefaultController(
  stream,
  controller,
  startAlgorithm,
  writeAlgorithm,
  closeAlgorithm,
  abortAlgorithm,
  highWaterMark,
  sizeAlgorithm,
) {
  $assert($isWritableStream(stream));
  $assert($getByIdDirectPrivate(stream, "controller") === undefined);

  $putByIdDirectPrivate(controller, "stream", stream);
  $putByIdDirectPrivate(stream, "controller", controller);

  $resetQueue($getByIdDirectPrivate(controller, "queue"));

  $putByIdDirectPrivate(controller, "started", -1);
  $putByIdDirectPrivate(controller, "startAlgorithm", startAlgorithm);
  $putByIdDirectPrivate(controller, "strategySizeAlgorithm", sizeAlgorithm);
  $putByIdDirectPrivate(controller, "strategyHWM", highWaterMark);
  $putByIdDirectPrivate(controller, "writeAlgorithm", writeAlgorithm);
  $putByIdDirectPrivate(controller, "closeAlgorithm", closeAlgorithm);
  $putByIdDirectPrivate(controller, "abortAlgorithm", abortAlgorithm);

  const backpressure = $writableStreamDefaultControllerGetBackpressure(controller);
  $writableStreamUpdateBackpressure(stream, backpressure);

  $writableStreamDefaultControllerStart(controller);
}

export function writableStreamDefaultControllerStart(controller) {
  if ($getByIdDirectPrivate(controller, "started") !== -1) return;

  $putByIdDirectPrivate(controller, "started", 0);

  const startAlgorithm = $getByIdDirectPrivate(controller, "startAlgorithm");
  $putByIdDirectPrivate(controller, "startAlgorithm", undefined);
  const stream = $getByIdDirectPrivate(controller, "stream");
  return Promise.$resolve(startAlgorithm.$call()).$then(
    () => {
      const state = $getByIdDirectPrivate(stream, "state");
      $assert(state === "writable" || state === "erroring");
      $putByIdDirectPrivate(controller, "started", 1);
      $writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    error => {
      const state = $getByIdDirectPrivate(stream, "state");
      $assert(state === "writable" || state === "erroring");
      $putByIdDirectPrivate(controller, "started", 1);
      $writableStreamDealWithRejection(stream, error);
    },
  );
}

export function setUpWritableStreamDefaultControllerFromUnderlyingSink(
  stream,
  underlyingSink,
  underlyingSinkDict,
  highWaterMark,
  sizeAlgorithm,
) {
  const controller = new $WritableStreamDefaultController();

  let startAlgorithm = () => {};
  let writeAlgorithm = () => {
    return Promise.$resolve();
  };
  let closeAlgorithm = () => {
    return Promise.$resolve();
  };
  let abortAlgorithm = () => {
    return Promise.$resolve();
  };

  if ("start" in underlyingSinkDict) {
    const startMethod = underlyingSinkDict["start"];
    startAlgorithm = () => $promiseInvokeOrNoopMethodNoCatch(underlyingSink, startMethod, [controller]);
  }
  if ("write" in underlyingSinkDict) {
    const writeMethod = underlyingSinkDict["write"];
    writeAlgorithm = chunk => $promiseInvokeOrNoopMethod(underlyingSink, writeMethod, [chunk, controller]);
  }
  if ("close" in underlyingSinkDict) {
    const closeMethod = underlyingSinkDict["close"];
    closeAlgorithm = () => $promiseInvokeOrNoopMethod(underlyingSink, closeMethod, []);
  }
  if ("abort" in underlyingSinkDict) {
    const abortMethod = underlyingSinkDict["abort"];
    abortAlgorithm = reason => $promiseInvokeOrNoopMethod(underlyingSink, abortMethod, [reason]);
  }

  $setUpWritableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    writeAlgorithm,
    closeAlgorithm,
    abortAlgorithm,
    highWaterMark,
    sizeAlgorithm,
  );
}

export function writableStreamDefaultControllerAdvanceQueueIfNeeded(controller) {
  const stream = $getByIdDirectPrivate(controller, "stream");

  if ($getByIdDirectPrivate(controller, "started") !== 1) return;

  $assert(stream !== undefined);
  if ($getByIdDirectPrivate(stream, "inFlightWriteRequest") !== undefined) return;

  const state = $getByIdDirectPrivate(stream, "state");
  $assert(state !== "closed" || state !== "errored");
  if (state === "erroring") {
    $writableStreamFinishErroring(stream);
    return;
  }

  const queue = $getByIdDirectPrivate(controller, "queue");

  if (queue.content?.isEmpty() ?? false) return;

  const value = $peekQueueValue(queue);
  if (value === $isCloseSentinel) $writableStreamDefaultControllerProcessClose(controller);
  else $writableStreamDefaultControllerProcessWrite(controller, value);
}

export function isCloseSentinel() {}

export function writableStreamDefaultControllerClearAlgorithms(controller) {
  $putByIdDirectPrivate(controller, "writeAlgorithm", undefined);
  $putByIdDirectPrivate(controller, "closeAlgorithm", undefined);
  $putByIdDirectPrivate(controller, "abortAlgorithm", undefined);
  $putByIdDirectPrivate(controller, "strategySizeAlgorithm", undefined);
}

export function writableStreamDefaultControllerClose(controller) {
  $enqueueValueWithSize($getByIdDirectPrivate(controller, "queue"), $isCloseSentinel, 0);
  $writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
}

export function writableStreamDefaultControllerError(controller, error) {
  const stream = $getByIdDirectPrivate(controller, "stream");
  $assert(stream !== undefined);
  $assert($getByIdDirectPrivate(stream, "state") === "writable");

  $writableStreamDefaultControllerClearAlgorithms(controller);
  $writableStreamStartErroring(stream, error);
}

export function writableStreamDefaultControllerErrorIfNeeded(controller, error) {
  const stream = $getByIdDirectPrivate(controller, "stream");
  if ($getByIdDirectPrivate(stream, "state") === "writable") $writableStreamDefaultControllerError(controller, error);
}

export function writableStreamDefaultControllerGetBackpressure(controller) {
  const desiredSize = $writableStreamDefaultControllerGetDesiredSize(controller);
  return desiredSize <= 0;
}

export function writableStreamDefaultControllerGetChunkSize(controller, chunk) {
  try {
    return $getByIdDirectPrivate(controller, "strategySizeAlgorithm").$call(undefined, chunk);
  } catch (e) {
    $writableStreamDefaultControllerErrorIfNeeded(controller, e);
    return 1;
  }
}

export function writableStreamDefaultControllerGetDesiredSize(controller) {
  return $getByIdDirectPrivate(controller, "strategyHWM") - $getByIdDirectPrivate(controller, "queue").size;
}

export function writableStreamDefaultControllerProcessClose(controller) {
  const stream = $getByIdDirectPrivate(controller, "stream");

  $writableStreamMarkCloseRequestInFlight(stream);
  $dequeueValue($getByIdDirectPrivate(controller, "queue"));

  $assert($getByIdDirectPrivate(controller, "queue").content?.isEmpty());

  const sinkClosePromise = $getByIdDirectPrivate(controller, "closeAlgorithm").$call();
  $writableStreamDefaultControllerClearAlgorithms(controller);

  sinkClosePromise.$then(
    () => {
      $writableStreamFinishInFlightClose(stream);
    },
    reason => {
      $writableStreamFinishInFlightCloseWithError(stream, reason);
    },
  );
}

export function writableStreamDefaultControllerProcessWrite(controller, chunk) {
  const stream = $getByIdDirectPrivate(controller, "stream");

  $writableStreamMarkFirstWriteRequestInFlight(stream);

  const sinkWritePromise = $getByIdDirectPrivate(controller, "writeAlgorithm").$call(undefined, chunk);

  sinkWritePromise.$then(
    () => {
      $writableStreamFinishInFlightWrite(stream);
      const state = $getByIdDirectPrivate(stream, "state");
      $assert(state === "writable" || state === "erroring");

      $dequeueValue($getByIdDirectPrivate(controller, "queue"));
      if (!$writableStreamCloseQueuedOrInFlight(stream) && state === "writable") {
        const backpressure = $writableStreamDefaultControllerGetBackpressure(controller);
        $writableStreamUpdateBackpressure(stream, backpressure);
      }
      $writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    reason => {
      const state = $getByIdDirectPrivate(stream, "state");
      if (state === "writable") $writableStreamDefaultControllerClearAlgorithms(controller);

      $writableStreamFinishInFlightWriteWithError(stream, reason);
    },
  );
}

export function writableStreamDefaultControllerWrite(controller, chunk, chunkSize) {
  try {
    $enqueueValueWithSize($getByIdDirectPrivate(controller, "queue"), chunk, chunkSize);

    const stream = $getByIdDirectPrivate(controller, "stream");

    const state = $getByIdDirectPrivate(stream, "state");
    if (!$writableStreamCloseQueuedOrInFlight(stream) && state === "writable") {
      const backpressure = $writableStreamDefaultControllerGetBackpressure(controller);
      $writableStreamUpdateBackpressure(stream, backpressure);
    }
    $writableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
  } catch (e) {
    $writableStreamDefaultControllerErrorIfNeeded(controller, e);
  }
}
