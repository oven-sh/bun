/*
 * Copyright (C) 2015 Canon Inc. All rights reserved.
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

export function readableStreamReaderGenericInitialize(reader: ReadableStreamDefaultReader, stream: ReadableStream) {
  $putByIdDirectPrivate(reader, "ownerReadableStream", stream);
  $putByIdDirectPrivate(stream, "reader", reader);
  if ($getByIdDirectPrivate(stream, "state") === $streamReadable)
    $putByIdDirectPrivate(reader, "closedPromiseCapability", $newPromiseCapability(Promise));
  else if ($getByIdDirectPrivate(stream, "state") === $streamClosed)
    $putByIdDirectPrivate(reader, "closedPromiseCapability", {
      promise: Promise.$resolve(),
    });
  else {
    $assert($getByIdDirectPrivate(stream, "state") === $streamErrored);
    $putByIdDirectPrivate(reader, "closedPromiseCapability", {
      promise: $newHandledRejectedPromise($getByIdDirectPrivate(stream, "storedError")),
    });
  }
}

export function privateInitializeReadableStreamDefaultController(
  this: ReadableStreamDefaultController,
  stream: ReadableStream,
  underlyingSource: UnderlyingSource,
  size: QueuingStrategySize,
  highWaterMark: QueuingStrategyHighWaterMark,
) {
  if (!$isReadableStream(stream)) throw new TypeError("ReadableStreamDefaultController needs a ReadableStream");

  // readableStreamController is initialized with null value.
  if ($getByIdDirectPrivate(stream, "readableStreamController") !== null)
    throw new TypeError("ReadableStream already has a controller");

  $putByIdDirectPrivate(this, "controlledReadableStream", stream);
  $putByIdDirectPrivate(this, "underlyingSource", underlyingSource);
  $putByIdDirectPrivate(this, "queue", $newQueue());
  $putByIdDirectPrivate(this, "started", -1);
  $putByIdDirectPrivate(this, "closeRequested", false);
  $putByIdDirectPrivate(this, "pullAgain", false);
  $putByIdDirectPrivate(this, "pulling", false);
  $putByIdDirectPrivate(this, "strategy", $validateAndNormalizeQueuingStrategy(size, highWaterMark));

  return this;
}

export function readableStreamDefaultControllerError(controller, error) {
  const stream = $getByIdDirectPrivate(controller, "controlledReadableStream");
  if (!$isObject(stream) || $getByIdDirectPrivate(stream, "state") !== $streamReadable) return;
  $putByIdDirectPrivate(controller, "queue", $newQueue());

  $readableStreamError(stream, error);
}

export function readableStreamPipeTo(stream, sink) {
  $assert($isReadableStream(stream));

  const reader = new ReadableStreamDefaultReader(stream);

  $getByIdDirectPrivate(reader, "closedPromiseCapability").promise.$then(
    () => {},
    e => {
      sink.error(e);
    },
  );

  function doPipe() {
    $readableStreamDefaultReaderRead(reader).$then(
      function (result) {
        if (result.done) {
          sink.close();
          return;
        }
        try {
          sink.enqueue(result.value);
        } catch {
          sink.error("ReadableStream chunk enqueueing in the sink failed");
          return;
        }
        doPipe();
      },
      function (e) {
        sink.error(e);
      },
    );
  }
  doPipe();
}

export function acquireReadableStreamDefaultReader(stream) {
  var start = $getByIdDirectPrivate(stream, "start");
  if (start) {
    start.$call(stream);
  }

  return new ReadableStreamDefaultReader(stream);
}

// https://streams.spec.whatwg.org/#set-up-readable-stream-default-controller, starting from step 6.
// The other part is implemented in privateInitializeReadableStreamDefaultController.
export function setupReadableStreamDefaultController(
  stream,
  underlyingSource,
  size,
  highWaterMark,
  startMethod,
  pullMethod,
  cancelMethod,
) {
  const controller = new ReadableStreamDefaultController(
    stream,
    underlyingSource,
    size,
    highWaterMark,
    $isReadableStream,
  );

  var asyncContext = stream.$asyncContext;
  const pullAlgorithm = () => $promiseInvokeOrNoopMethod(underlyingSource, pullMethod, [controller]);
  const cancelAlgorithm = asyncContext
    ? reason => {
        var prev = $getInternalField($asyncContext, 0);
        $putInternalField($asyncContext, 0, asyncContext);
        // this does not throw, but can returns a rejected promise
        var result = $promiseInvokeOrNoopMethod(underlyingSource, cancelMethod, [reason]);
        $putInternalField($asyncContext, 0, prev);
        return result;
      }
    : reason => $promiseInvokeOrNoopMethod(underlyingSource, cancelMethod, [reason]);

  $putByIdDirectPrivate(controller, "pullAlgorithm", pullAlgorithm);
  $putByIdDirectPrivate(controller, "cancelAlgorithm", cancelAlgorithm);
  $putByIdDirectPrivate(controller, "pull", $readableStreamDefaultControllerPull);
  $putByIdDirectPrivate(controller, "cancel", $readableStreamDefaultControllerCancel);
  $putByIdDirectPrivate(stream, "readableStreamController", controller);

  $readableStreamDefaultControllerStart(controller);
}

export function createReadableStreamController(stream, underlyingSource, strategy) {
  const type = underlyingSource.type;
  const typeString = $toString(type);

  if (typeString === "bytes") {
    // if (!$readableByteStreamAPIEnabled())
    //     $throwTypeError("ReadableByteStreamController is not implemented");

    if (strategy.highWaterMark === undefined) strategy.highWaterMark = 0;
    if (strategy.size !== undefined) $throwRangeError("Strategy for a ReadableByteStreamController cannot have a size");

    $putByIdDirectPrivate(
      stream,
      "readableStreamController",
      new ReadableByteStreamController(stream, underlyingSource, strategy.highWaterMark, $isReadableStream),
    );
  } else if (typeString === "direct") {
    var highWaterMark = strategy?.highWaterMark;
    $initializeArrayBufferStream.$call(stream, underlyingSource, highWaterMark);
  } else if (type === undefined) {
    if (strategy.highWaterMark === undefined) strategy.highWaterMark = 1;

    $setupReadableStreamDefaultController(
      stream,
      underlyingSource,
      strategy.size,
      strategy.highWaterMark,
      underlyingSource.start,
      underlyingSource.pull,
      underlyingSource.cancel,
    );
  } else throw new RangeError("Invalid type for underlying source");
}

export function readableStreamDefaultControllerStart(controller) {
  if ($getByIdDirectPrivate(controller, "started") !== -1) return;

  const underlyingSource = $getByIdDirectPrivate(controller, "underlyingSource");
  const startMethod = underlyingSource.start;
  $putByIdDirectPrivate(controller, "started", 0);

  $promiseInvokeOrNoopMethodNoCatch(underlyingSource, startMethod, [controller]).$then(
    () => {
      $putByIdDirectPrivate(controller, "started", 1);
      $assert(!$getByIdDirectPrivate(controller, "pulling"));
      $assert(!$getByIdDirectPrivate(controller, "pullAgain"));
      $readableStreamDefaultControllerCallPullIfNeeded(controller);
    },
    error => {
      $readableStreamDefaultControllerError(controller, error);
    },
  );
}

// FIXME: Replace readableStreamPipeTo by below function.
// This method implements the latest https://streams.spec.whatwg.org/#readable-stream-pipe-to.
export function readableStreamPipeToWritableStream(
  source,
  destination,
  preventClose,
  preventAbort,
  preventCancel,
  signal,
) {
  // const isDirectStream = !!$getByIdDirectPrivate(source, "start");

  $assert($isReadableStream(source));
  $assert($isWritableStream(destination));
  $assert(!$isReadableStreamLocked(source));
  $assert(!$isWritableStreamLocked(destination));
  $assert(signal === undefined || $isAbortSignal(signal));

  if ($getByIdDirectPrivate(source, "underlyingByteSource") !== undefined)
    return Promise.$reject("Piping to a readable bytestream is not supported");

  let pipeState: any = {
    source: source,
    destination: destination,
    preventAbort: preventAbort,
    preventCancel: preventCancel,
    preventClose: preventClose,
    signal: signal,
  };

  pipeState.reader = $acquireReadableStreamDefaultReader(source);
  pipeState.writer = $acquireWritableStreamDefaultWriter(destination);

  source.$disturbed = true;

  pipeState.shuttingDown = false;
  pipeState.promiseCapability = $newPromiseCapability(Promise);
  pipeState.pendingReadPromiseCapability = $newPromiseCapability(Promise);
  pipeState.pendingReadPromiseCapability.resolve.$call();
  pipeState.pendingWritePromise = Promise.$resolve();

  if (signal !== undefined) {
    const algorithm = reason => {
      $pipeToShutdownWithAction(
        pipeState,
        () => {
          const shouldAbortDestination =
            !pipeState.preventAbort && $getByIdDirectPrivate(pipeState.destination, "state") === "writable";
          const promiseDestination = shouldAbortDestination
            ? $writableStreamAbort(pipeState.destination, reason)
            : Promise.$resolve();

          const shouldAbortSource =
            !pipeState.preventCancel && $getByIdDirectPrivate(pipeState.source, "state") === $streamReadable;
          const promiseSource = shouldAbortSource
            ? $readableStreamCancel(pipeState.source, reason)
            : Promise.$resolve();

          let promiseCapability = $newPromiseCapability(Promise);
          let shouldWait = true;
          let handleResolvedPromise = () => {
            if (shouldWait) {
              shouldWait = false;
              return;
            }
            promiseCapability.resolve.$call();
          };
          let handleRejectedPromise = e => {
            promiseCapability.reject.$call(undefined, e);
          };
          promiseDestination.$then(handleResolvedPromise, handleRejectedPromise);
          promiseSource.$then(handleResolvedPromise, handleRejectedPromise);
          return promiseCapability.promise;
        },
        reason,
      );
    };
    const abortAlgorithmIdentifier = (pipeState.abortAlgorithmIdentifier = $addAbortAlgorithmToSignal(
      signal,
      algorithm,
    ));

    if (!abortAlgorithmIdentifier) return pipeState.promiseCapability.promise;
    pipeState.signal = signal;
  }

  $pipeToErrorsMustBePropagatedForward(pipeState);
  $pipeToErrorsMustBePropagatedBackward(pipeState);
  $pipeToClosingMustBePropagatedForward(pipeState);
  $pipeToClosingMustBePropagatedBackward(pipeState);

  $pipeToLoop(pipeState);

  return pipeState.promiseCapability.promise;
}

export function pipeToLoop(pipeState) {
  if (pipeState.shuttingDown) return;

  $pipeToDoReadWrite(pipeState).$then(result => {
    if (result) $pipeToLoop(pipeState);
  });
}

export function pipeToDoReadWrite(pipeState) {
  $assert(!pipeState.shuttingDown);

  pipeState.pendingReadPromiseCapability = $newPromiseCapability(Promise);
  $getByIdDirectPrivate(pipeState.writer, "readyPromise").promise.$then(
    () => {
      if (pipeState.shuttingDown) {
        pipeState.pendingReadPromiseCapability.resolve.$call(undefined, false);
        return;
      }

      $readableStreamDefaultReaderRead(pipeState.reader).$then(
        result => {
          const canWrite = !result.done && $getByIdDirectPrivate(pipeState.writer, "stream") !== undefined;
          pipeState.pendingReadPromiseCapability.resolve.$call(undefined, canWrite);
          if (!canWrite) return;

          pipeState.pendingWritePromise = $writableStreamDefaultWriterWrite(pipeState.writer, result.value).$then(
            undefined,
            () => {},
          );
        },
        _e => {
          pipeState.pendingReadPromiseCapability.resolve.$call(undefined, false);
        },
      );
    },
    _e => {
      pipeState.pendingReadPromiseCapability.resolve.$call(undefined, false);
    },
  );
  return pipeState.pendingReadPromiseCapability.promise;
}

export function pipeToErrorsMustBePropagatedForward(pipeState) {
  const action = () => {
    pipeState.pendingReadPromiseCapability.resolve.$call(undefined, false);
    const error = $getByIdDirectPrivate(pipeState.source, "storedError");
    if (!pipeState.preventAbort) {
      $pipeToShutdownWithAction(pipeState, () => $writableStreamAbort(pipeState.destination, error), error);
      return;
    }
    $pipeToShutdown(pipeState, error);
  };

  if ($getByIdDirectPrivate(pipeState.source, "state") === $streamErrored) {
    action();
    return;
  }

  $getByIdDirectPrivate(pipeState.reader, "closedPromiseCapability").promise.$then(undefined, action);
}

export function pipeToErrorsMustBePropagatedBackward(pipeState) {
  const action = () => {
    const error = $getByIdDirectPrivate(pipeState.destination, "storedError");
    if (!pipeState.preventCancel) {
      $pipeToShutdownWithAction(pipeState, () => $readableStreamCancel(pipeState.source, error), error);
      return;
    }
    $pipeToShutdown(pipeState, error);
  };
  if ($getByIdDirectPrivate(pipeState.destination, "state") === "errored") {
    action();
    return;
  }
  $getByIdDirectPrivate(pipeState.writer, "closedPromise").promise.$then(undefined, action);
}

export function pipeToClosingMustBePropagatedForward(pipeState) {
  const action = () => {
    pipeState.pendingReadPromiseCapability.resolve.$call(undefined, false);
    // const error = $getByIdDirectPrivate(pipeState.source, "storedError");
    if (!pipeState.preventClose) {
      $pipeToShutdownWithAction(pipeState, () =>
        $writableStreamDefaultWriterCloseWithErrorPropagation(pipeState.writer),
      );
      return;
    }
    $pipeToShutdown(pipeState);
  };
  if ($getByIdDirectPrivate(pipeState.source, "state") === $streamClosed) {
    action();
    return;
  }
  $getByIdDirectPrivate(pipeState.reader, "closedPromiseCapability").promise.$then(action, () => {});
}

export function pipeToClosingMustBePropagatedBackward(pipeState) {
  if (
    !$writableStreamCloseQueuedOrInFlight(pipeState.destination) &&
    $getByIdDirectPrivate(pipeState.destination, "state") !== "closed"
  )
    return;

  // $assert no chunks have been read/written

  const error = new TypeError("closing is propagated backward");
  if (!pipeState.preventCancel) {
    $pipeToShutdownWithAction(pipeState, () => $readableStreamCancel(pipeState.source, error), error);
    return;
  }
  $pipeToShutdown(pipeState, error);
}

export function pipeToShutdownWithAction(pipeState, action) {
  if (pipeState.shuttingDown) return;

  pipeState.shuttingDown = true;

  const hasError = arguments.length > 2;
  const error = arguments[2];
  const finalize = () => {
    const promise = action();
    promise.$then(
      () => {
        if (hasError) $pipeToFinalize(pipeState, error);
        else $pipeToFinalize(pipeState);
      },
      e => {
        $pipeToFinalize(pipeState, e);
      },
    );
  };

  if (
    $getByIdDirectPrivate(pipeState.destination, "state") === "writable" &&
    !$writableStreamCloseQueuedOrInFlight(pipeState.destination)
  ) {
    pipeState.pendingReadPromiseCapability.promise.$then(
      () => {
        pipeState.pendingWritePromise.$then(finalize, finalize);
      },
      e => $pipeToFinalize(pipeState, e),
    );
    return;
  }

  finalize();
}

export function pipeToShutdown(pipeState) {
  if (pipeState.shuttingDown) return;

  pipeState.shuttingDown = true;

  const hasError = arguments.length > 1;
  const error = arguments[1];
  const finalize = () => {
    if (hasError) $pipeToFinalize(pipeState, error);
    else $pipeToFinalize(pipeState);
  };

  if (
    $getByIdDirectPrivate(pipeState.destination, "state") === "writable" &&
    !$writableStreamCloseQueuedOrInFlight(pipeState.destination)
  ) {
    pipeState.pendingReadPromiseCapability.promise.$then(
      () => {
        pipeState.pendingWritePromise.$then(finalize, finalize);
      },
      e => $pipeToFinalize(pipeState, e),
    );
    return;
  }
  finalize();
}

export function pipeToFinalize(pipeState) {
  $writableStreamDefaultWriterRelease(pipeState.writer);
  $readableStreamReaderGenericRelease(pipeState.reader);

  const signal = pipeState.signal;
  if (signal) $removeAbortAlgorithmFromSignal(signal, pipeState.abortAlgorithmIdentifier);

  if (arguments.length > 1) pipeState.promiseCapability.reject.$call(undefined, arguments[1]);
  else pipeState.promiseCapability.resolve.$call();
}

const enum TeeStateFlags {
  canceled1 = 1 << 0,
  canceled2 = 1 << 1,
  reading = 1 << 2,
  closedOrErrored = 1 << 3,
  readAgain = 1 << 4,
}

export function readableStreamTee(stream, shouldClone) {
  $assert($isReadableStream(stream));
  $assert(typeof shouldClone === "boolean");

  var start_ = $getByIdDirectPrivate(stream, "start");
  if (start_) {
    $putByIdDirectPrivate(stream, "start", undefined);
    start_();
  }

  const reader = new $ReadableStreamDefaultReader(stream);

  const teeState = {
    stream,
    flags: 0,
    reason1: undefined,
    reason2: undefined,
    branch1Source: undefined,
    branch2Source: undefined,
    branch1: undefined,
    branch2: undefined,
    cancelPromiseCapability: $newPromiseCapability(Promise),
  };

  const pullFunction = $readableStreamTeePullFunction(teeState, reader, shouldClone);

  const branch1Source = {
    $pull: pullFunction,
    $cancel: $readableStreamTeeBranch1CancelFunction(teeState, stream),
  };

  const branch2Source = {
    $pull: pullFunction,
    $cancel: $readableStreamTeeBranch2CancelFunction(teeState, stream),
  };

  const branch1 = new $ReadableStream(branch1Source);
  const branch2 = new $ReadableStream(branch2Source);

  $getByIdDirectPrivate(reader, "closedPromiseCapability").promise.$then(undefined, function (e) {
    const flags = teeState.flags;
    if (flags & TeeStateFlags.closedOrErrored) return;
    $readableStreamDefaultControllerError(branch1.$readableStreamController, e);
    $readableStreamDefaultControllerError(branch2.$readableStreamController, e);
    teeState.flags |= TeeStateFlags.closedOrErrored;

    if (teeState.flags & (TeeStateFlags.canceled1 | TeeStateFlags.canceled2))
      teeState.cancelPromiseCapability.resolve.$call();
  });

  // Additional fields compared to the spec, as they are needed within pull/cancel functions.
  teeState.branch1 = branch1;
  teeState.branch2 = branch2;

  return [branch1, branch2];
}

export function readableStreamTeePullFunction(teeState, reader, shouldClone) {
  "use strict";

  const pullAlgorithm = function () {
    if (teeState.flags & TeeStateFlags.reading) {
      teeState.flags |= TeeStateFlags.readAgain;
      return $Promise.$resolve();
    }
    teeState.flags |= TeeStateFlags.reading;
    $Promise.prototype.$then.$call(
      $readableStreamDefaultReaderRead(reader),
      function (result) {
        $assert($isObject(result));
        $assert(typeof result.done === "boolean");
        const { done, value } = result;
        if (done) {
          // close steps.
          teeState.flags &= ~TeeStateFlags.reading;
          if (!(teeState.flags & TeeStateFlags.canceled1))
            $readableStreamDefaultControllerClose(teeState.branch1.$readableStreamController);
          if (!(teeState.flags & TeeStateFlags.canceled2))
            $readableStreamDefaultControllerClose(teeState.branch2.$readableStreamController);
          if (!(teeState.flags & TeeStateFlags.canceled1) || !(teeState.flags & TeeStateFlags.canceled2))
            teeState.cancelPromiseCapability.resolve.$call();
          return;
        }
        // chunk steps.
        teeState.flags &= ~TeeStateFlags.readAgain;
        let chunk1 = value;
        let chunk2 = value;
        if (!(teeState.flags & TeeStateFlags.canceled2) && shouldClone) {
          try {
            chunk2 = $structuredCloneForStream(value);
          } catch (e) {
            $readableStreamDefaultControllerError(teeState.branch1.$readableStreamController, e);
            $readableStreamDefaultControllerError(teeState.branch2.$readableStreamController, e);
            $readableStreamCancel(teeState.stream, e).$then(
              teeState.cancelPromiseCapability.resolve,
              teeState.cancelPromiseCapability.reject,
            );
            return;
          }
        }
        if (!(teeState.flags & TeeStateFlags.canceled1))
          $readableStreamDefaultControllerEnqueue(teeState.branch1.$readableStreamController, chunk1);
        if (!(teeState.flags & TeeStateFlags.canceled2))
          $readableStreamDefaultControllerEnqueue(teeState.branch2.$readableStreamController, chunk2);
        teeState.flags &= ~TeeStateFlags.reading;

        $Promise.$resolve().$then(() => {
          if (teeState.flags & TeeStateFlags.readAgain) pullAlgorithm();
        });
      },
      () => {
        // error steps.
        teeState.flags &= ~TeeStateFlags.reading;
      },
    );
    return $Promise.$resolve();
  };
  return pullAlgorithm;
}

export function readableStreamTeeBranch1CancelFunction(teeState, stream) {
  return function (r) {
    teeState.flags |= TeeStateFlags.canceled1;
    teeState.reason1 = r;
    if (teeState.flags & TeeStateFlags.canceled2) {
      $readableStreamCancel(stream, [teeState.reason1, teeState.reason2]).$then(
        teeState.cancelPromiseCapability.resolve,
        teeState.cancelPromiseCapability.reject,
      );
    }
    return teeState.cancelPromiseCapability.promise;
  };
}

export function readableStreamTeeBranch2CancelFunction(teeState, stream) {
  return function (r) {
    teeState.flags |= TeeStateFlags.canceled2;
    teeState.reason2 = r;
    if (teeState.flags & TeeStateFlags.canceled1) {
      $readableStreamCancel(stream, [teeState.reason1, teeState.reason2]).$then(
        teeState.cancelPromiseCapability.resolve,
        teeState.cancelPromiseCapability.reject,
      );
    }
    return teeState.cancelPromiseCapability.promise;
  };
}

$alwaysInline = true;
export function isReadableStream(stream) {
  // Spec tells to return true only if stream has a readableStreamController internal slot.
  // However, since it is a private slot, it cannot be checked using hasOwnProperty().
  // Therefore, readableStreamController is initialized with null value.
  return $isObject(stream) && $getByIdDirectPrivate(stream, "readableStreamController") !== undefined;
}

$alwaysInline = true;
export function isReadableStreamDefaultReader(reader) {
  // Spec tells to return true only if reader has a readRequests internal slot.
  // However, since it is a private slot, it cannot be checked using hasOwnProperty().
  // Since readRequests is initialized with an empty array, the following test is ok.
  return $isObject(reader) && !!$getByIdDirectPrivate(reader, "readRequests");
}

$alwaysInline = true;
export function isReadableStreamDefaultController(controller) {
  // Spec tells to return true only if controller has an underlyingSource internal slot.
  // However, since it is a private slot, it cannot be checked using hasOwnProperty().
  // underlyingSource is obtained in ReadableStream constructor: if undefined, it is set
  // to an empty object. Therefore, following test is ok.
  return $isObject(controller) && $getByIdDirectPrivate(controller, "underlyingSource") !== undefined;
}

export function readDirectStream(stream, sink, underlyingSource) {
  $putByIdDirectPrivate(stream, "underlyingSource", null); // doing this causes isReadableStreamDefaultController to return false
  $putByIdDirectPrivate(stream, "start", undefined);
  function close(stream, reason) {
    const cancelFn = underlyingSource?.cancel;
    if (cancelFn) {
      try {
        var prom = cancelFn.$call(underlyingSource, reason);
        if ($isPromise(prom)) {
          $markPromiseAsHandled(prom);
        }
      } catch {}

      underlyingSource = undefined;
    }

    if (stream) {
      $putByIdDirectPrivate(stream, "readableStreamController", undefined);
      $putByIdDirectPrivate(stream, "reader", undefined);
      if (reason) {
        $putByIdDirectPrivate(stream, "state", $streamErrored);
        $putByIdDirectPrivate(stream, "storedError", reason);
      } else {
        $putByIdDirectPrivate(stream, "state", $streamClosed);
      }
      stream = undefined;
    }
  }

  if (!underlyingSource.pull) {
    close();
    return;
  }

  if (!$isCallable(underlyingSource.pull)) {
    close();
    $throwTypeError("pull is not a function");
    return;
  }
  $putByIdDirectPrivate(stream, "readableStreamController", sink);
  const highWaterMark = $getByIdDirectPrivate(stream, "highWaterMark");
  sink.start({
    highWaterMark: !highWaterMark || highWaterMark < 64 ? 64 : highWaterMark,
  });

  $startDirectStream.$call(sink, stream, underlyingSource.pull, close, stream.$asyncContext);

  $putByIdDirectPrivate(stream, "reader", {});

  var maybePromise = underlyingSource.pull(sink);
  sink = undefined;
  if (maybePromise && $isPromise(maybePromise)) {
    if (maybePromise.$then) {
      return maybePromise.$then(() => {});
    }

    return maybePromise.then(() => {});
  }
}

$linkTimeConstant;
export function assignToStream(stream, sink) {
  // The stream is either a direct stream or a "default" JS stream
  var underlyingSource = $getByIdDirectPrivate(stream, "underlyingSource");

  // we know it's a direct stream when $underlyingSource is set
  if (underlyingSource) {
    try {
      return $readDirectStream(stream, sink, underlyingSource);
    } finally {
      underlyingSource = undefined;
      stream = undefined;
      sink = undefined;
    }
  }

  return $readStreamIntoSink(stream, sink, true);
}

export async function readStreamIntoSink(stream: ReadableStream, sink, isNative) {
  var didClose = false;
  var didThrow = false;
  var started = false;
  const highWaterMark = $getByIdDirectPrivate(stream, "highWaterMark") || 0;

  try {
    var reader = stream.getReader();
    var many = reader.readMany();
    function onSinkClose(stream, reason) {
      if (!didThrow && !didClose && stream && stream.$state !== $streamClosed) {
        $readableStreamCancel(stream, reason);
      }
    }

    if (many && $isPromise(many)) {
      // Some time may pass before this Promise is fulfilled. The sink may
      // abort, for example. So we have to start it, if only so that we can
      // receive a notification when it closes or cancels.
      // https://github.com/oven-sh/bun/issues/6758
      if (isNative) $startDirectStream.$call(sink, stream, undefined, onSinkClose, stream.$asyncContext);
      sink.start({ highWaterMark });
      started = true;

      many = await many;
    }
    if (many.done) {
      didClose = true;
      return sink.end();
    }

    if (!started) {
      if (isNative) $startDirectStream.$call(sink, stream, undefined, onSinkClose, stream.$asyncContext);
      sink.start({ highWaterMark });
    }

    for (var i = 0, values = many.value, length = many.value.length; i < length; i++) {
      sink.write(values[i]);
    }

    var streamState = $getByIdDirectPrivate(stream, "state");
    if (streamState === $streamClosed) {
      didClose = true;
      return sink.end();
    }

    while (true) {
      var { value, done } = await reader.read();
      if (done) {
        didClose = true;
        return sink.end();
      }

      sink.write(value);
    }
  } catch (e) {
    didThrow = true;

    try {
      reader = undefined;
      const prom = stream.cancel(e);
      if ($isPromise(prom)) {
        $markPromiseAsHandled(prom);
      }
    } catch {}

    if (sink && !didClose) {
      didClose = true;
      try {
        sink.close(e);
      } catch (j) {
        throw new globalThis.AggregateError([e, j]);
      }
    }

    throw e;
  } finally {
    if (reader) {
      try {
        reader.releaseLock();
      } catch {}
      reader = undefined;
    }
    sink = undefined;
    var streamState = $getByIdDirectPrivate(stream, "state");
    if (stream) {
      // make it easy for this to be GC'd
      // but don't do property transitions
      var readableStreamController = $getByIdDirectPrivate(stream, "readableStreamController");
      if (readableStreamController) {
        if ($getByIdDirectPrivate(readableStreamController, "underlyingSource"))
          $putByIdDirectPrivate(readableStreamController, "underlyingSource", null);
        if ($getByIdDirectPrivate(readableStreamController, "controlledReadableStream"))
          $putByIdDirectPrivate(readableStreamController, "controlledReadableStream", null);

        $putByIdDirectPrivate(stream, "readableStreamController", null);
        if ($getByIdDirectPrivate(stream, "underlyingSource")) $putByIdDirectPrivate(stream, "underlyingSource", null);
        readableStreamController = undefined;
      }

      if (!didThrow && streamState !== $streamClosed && streamState !== $streamErrored) {
        $readableStreamCloseIfPossible(stream);
      }
      stream = undefined;
    }
  }
}

export function handleDirectStreamError(e) {
  var controller = this;
  var sink = controller.$sink;
  if (sink) {
    $putByIdDirectPrivate(controller, "sink", undefined);
    try {
      sink.close(e);
    } catch {}
  }

  this.error = this.flush = this.write = this.close = this.end = $onReadableStreamDirectControllerClosed;

  if (typeof this.$underlyingSource.close === "function") {
    try {
      this.$underlyingSource.close.$call(this.$underlyingSource, e);
    } catch {}
  }

  try {
    var pend = controller._pendingRead;
    if (pend) {
      controller._pendingRead = undefined;
      $rejectPromise(pend, e);
    }
  } catch {}
  var stream = controller.$controlledReadableStream;
  if (stream) $readableStreamError(stream, e);
}

export function handleDirectStreamErrorReject(e) {
  $handleDirectStreamError.$call(this, e);
  return Promise.$reject(e);
}

export function onPullDirectStream(controller: ReadableStreamDirectController) {
  var stream = controller.$controlledReadableStream;
  if (!stream || $getByIdDirectPrivate(stream, "state") !== $streamReadable) return;

  // pull is in progress
  // this is a recursive call
  // ignore it
  if (controller._deferClose === -1) {
    return;
  }

  controller._deferClose = -1;
  controller._deferFlush = -1;
  var deferClose;
  var deferFlush;

  var asyncContext = stream.$asyncContext;
  if (asyncContext) {
    var prev = $getInternalField($asyncContext, 0);
    $putInternalField($asyncContext, 0, asyncContext);
  }

  // Direct streams allow $pull to be called multiple times, unlike the spec.
  // Backpressure is handled by the destination, not by the underlying source.
  // In this case, we rely on the heuristic that repeatedly draining in the same tick
  // is bad for performance
  // this code is only run when consuming a direct stream from JS
  // without the HTTP server or anything else
  try {
    var result = controller.$underlyingSource.pull(controller);

    if (result && $isPromise(result)) {
      if (controller._handleError === undefined) {
        controller._handleError = $handleDirectStreamErrorReject.bind(controller);
      }

      Promise.prototype.catch.$call(result, controller._handleError);
    }
  } catch (e) {
    return $handleDirectStreamErrorReject.$call(controller, e);
  } finally {
    deferClose = controller._deferClose;
    deferFlush = controller._deferFlush;
    controller._deferFlush = controller._deferClose = 0;

    if (asyncContext) {
      $putInternalField($asyncContext, 0, prev);
    }
  }

  var promiseToReturn;

  if (controller._pendingRead === undefined) {
    controller._pendingRead = promiseToReturn = $newPromise();
  } else {
    promiseToReturn = $readableStreamAddReadRequest(stream);
  }

  // they called close during $pull()
  // we delay that
  if (deferClose === 1) {
    var reason = controller._deferCloseReason;
    controller._deferCloseReason = undefined;
    $onCloseDirectStream.$call(controller, reason);
    return promiseToReturn;
  }

  // not done, but they called flush()
  if (deferFlush === 1) {
    $onFlushDirectStream.$call(controller);
  }

  return promiseToReturn;
}

export function noopDoneFunction() {
  return Promise.$resolve({ value: undefined, done: true });
}

export function onReadableStreamDirectControllerClosed(_reason) {
  $throwTypeError("ReadableStreamDirectController is now closed");
}

export function tryUseReadableStreamBufferedFastPath(stream, method) {
  // -- Fast path for Blob.prototype.stream(), fetch body streams, and incoming Request body streams --
  const ptr = stream.$bunNativePtr;
  if (
    // only available on native streams
    ptr &&
    // don't even attempt it if the stream was used in some way
    !$isReadableStreamDisturbed(stream) &&
    // feature-detect if supported
    $isCallable(ptr[method])
  ) {
    const promise = ptr[method]();
    // if it throws, let it throw without setting $disturbed
    stream.$disturbed = true;

    // Clear the lazy load function.
    $putByIdDirectPrivate(stream, "start", undefined);
    $putByIdDirectPrivate(stream, "reader", {});

    if (Bun.peek.status(promise) === "fulfilled") {
      stream.$reader = undefined;
      $readableStreamCloseIfPossible(stream);
      return promise;
    }

    return promise
      .catch(e => {
        stream.$reader = undefined;
        $readableStreamCancel(stream, e);
        return Promise.$reject(e);
      })
      .finally(() => {
        stream.$reader = undefined;
        $readableStreamCloseIfPossible(stream);
      });
  }
}

export function onCloseDirectStream(reason) {
  var stream = this.$controlledReadableStream;
  if (!stream || $getByIdDirectPrivate(stream, "state") !== $streamReadable) return;

  if (this._deferClose !== 0) {
    this._deferClose = 1;
    this._deferCloseReason = reason;
    return;
  }

  $putByIdDirectPrivate(stream, "state", $streamClosing);
  if (typeof this.$underlyingSource.close === "function") {
    try {
      this.$underlyingSource.close.$call(this.$underlyingSource, reason);
    } catch {}
  }

  var flushed;
  try {
    flushed = this.$sink.end();
    $putByIdDirectPrivate(this, "sink", undefined);
  } catch (e) {
    if (this._pendingRead) {
      var read = this._pendingRead;
      this._pendingRead = undefined;
      $rejectPromise(read, e);
    } else {
      throw e;
    }

    return;
  }

  this.error = this.flush = this.write = this.close = this.end = $onReadableStreamDirectControllerClosed;

  var reader = $getByIdDirectPrivate(stream, "reader");

  if (reader && $isReadableStreamDefaultReader(reader)) {
    var _pendingRead = this._pendingRead;
    if (_pendingRead && $isPromise(_pendingRead) && flushed?.byteLength) {
      this._pendingRead = undefined;
      $fulfillPromise(_pendingRead, { value: flushed, done: false });
      $readableStreamCloseIfPossible(stream);
      return;
    }
  }

  if (flushed?.byteLength) {
    var requests = $getByIdDirectPrivate(reader, "readRequests");
    if (requests?.isNotEmpty()) {
      $readableStreamFulfillReadRequest(stream, flushed, false);
      $readableStreamCloseIfPossible(stream);
      return;
    }

    $putByIdDirectPrivate(stream, "state", $streamReadable);
    this.$pull = () => {
      var thisResult = $createFulfilledPromise({
        value: flushed,
        done: false,
      });
      flushed = undefined;
      $readableStreamCloseIfPossible(stream);
      stream = undefined;
      return thisResult;
    };
  } else if (this._pendingRead) {
    var read = this._pendingRead;
    this._pendingRead = undefined;
    $putByIdDirectPrivate(this, "pull", $noopDoneFunction);
    $fulfillPromise(read, { value: undefined, done: true });
  }

  $readableStreamCloseIfPossible(stream);
}

export function onFlushDirectStream() {
  var stream = this.$controlledReadableStream;
  var reader = $getByIdDirectPrivate(stream, "reader");
  if (!reader || !$isReadableStreamDefaultReader(reader)) {
    return;
  }

  var _pendingRead = this._pendingRead;
  this._pendingRead = undefined;
  if (_pendingRead && $isPromise(_pendingRead)) {
    var flushed = this.$sink.flush();
    if (flushed?.byteLength) {
      this._pendingRead = $getByIdDirectPrivate(stream, "readRequests")?.shift();
      $fulfillPromise(_pendingRead, { value: flushed, done: false });
    } else {
      this._pendingRead = _pendingRead;
    }
  } else if ($getByIdDirectPrivate(stream, "readRequests")?.isNotEmpty()) {
    var flushed = this.$sink.flush();
    if (flushed?.byteLength) {
      $readableStreamFulfillReadRequest(stream, flushed, false);
    }
  } else if (this._deferFlush === -1) {
    this._deferFlush = 1;
  }
}

export function createTextStream(_highWaterMark: number) {
  var sink;
  var array = [];
  var hasString = false;
  var hasBuffer = false;
  var rope = "";
  var estimatedLength = $toLength(0);
  var capability = $newPromiseCapability(Promise);
  var calledDone = false;

  sink = {
    start() {},
    write(chunk) {
      if (typeof chunk === "string") {
        var chunkLength = $toLength(chunk.length);
        if (chunkLength > 0) {
          rope += chunk;
          hasString = true;
          // TODO: utf16 byte length
          estimatedLength += chunkLength;
        }

        return chunkLength;
      }

      if (!chunk || !($ArrayBuffer.$isView(chunk) || chunk instanceof $ArrayBuffer)) {
        $throwTypeError("Expected text, ArrayBuffer or ArrayBufferView");
      }

      const byteLength = $toLength(chunk.byteLength);
      if (byteLength > 0) {
        hasBuffer = true;
        if (rope.length > 0) {
          $arrayPush(array, rope);
          $arrayPush(array, chunk);
          rope = "";
        } else {
          $arrayPush(array, chunk);
        }
      }
      estimatedLength += byteLength;
      return byteLength;
    },

    flush() {
      return 0;
    },

    end() {
      if (calledDone) {
        return "";
      }
      return sink.fulfill();
    },

    fulfill() {
      calledDone = true;
      const result = sink.finishInternal();

      $fulfillPromise(capability.promise, result);
      return result;
    },

    finishInternal() {
      if (!hasString && !hasBuffer) {
        return "";
      }

      if (hasString && !hasBuffer) {
        if (rope.charCodeAt(0) === 0xfeff) {
          rope = rope.slice(1);
        }

        return rope;
      }

      if (hasBuffer && !hasString) {
        return new globalThis.TextDecoder("utf-8", { ignoreBOM: true }).decode(Bun.concatArrayBuffers(array));
      }

      // worst case: mixed content

      var arrayBufferSink = new Bun.ArrayBufferSink();
      arrayBufferSink.start({
        highWaterMark: estimatedLength,
        asUint8Array: true,
      });
      for (let item of array) {
        arrayBufferSink.write(item);
      }
      array.length = 0;
      if (rope.length > 0) {
        if (rope.charCodeAt(0) === 0xfeff) {
          rope = rope.slice(1);
        }

        arrayBufferSink.write(rope);
        rope = "";
      }

      // TODO: use builtin
      return new globalThis.TextDecoder("utf-8", { ignoreBOM: true }).decode(arrayBufferSink.end());
    },

    close() {
      try {
        if (!calledDone) {
          calledDone = true;
          sink.fulfill();
        }
      } catch {}
    },
  };

  return [sink, capability];
}

export function initializeTextStream(underlyingSource, highWaterMark: number) {
  var [sink, closingPromise] = $createTextStream(highWaterMark);

  var controller = {
    $underlyingSource: underlyingSource,
    $pull: $onPullDirectStream,
    $controlledReadableStream: this,
    $sink: sink,
    close: $onCloseDirectStream,
    write: sink.write,
    error: $handleDirectStreamError,
    end: $onCloseDirectStream,
    $close: $onCloseDirectStream,
    flush: $onFlushDirectStream,
    _pendingRead: undefined,
    _deferClose: 0,
    _deferFlush: 0,
    _deferCloseReason: undefined,
    _handleError: undefined,
  };

  $putByIdDirectPrivate(this, "readableStreamController", controller);
  $putByIdDirectPrivate(this, "underlyingSource", null);
  $putByIdDirectPrivate(this, "start", undefined);
  return closingPromise;
}

export function initializeArrayStream(underlyingSource, _highWaterMark: number) {
  var array = [];
  var closingPromise = $newPromiseCapability(Promise);
  var calledDone = false;

  function fulfill() {
    calledDone = true;
    closingPromise.resolve.$call(undefined, array);
    return array;
  }

  var sink = {
    start() {},
    write(chunk) {
      $arrayPush(array, chunk);
      return chunk.byteLength || chunk.length;
    },

    flush() {
      return 0;
    },

    end() {
      if (calledDone) {
        return [];
      }
      return fulfill();
    },

    close() {
      if (!calledDone) {
        fulfill();
      }
    },
  };

  var controller = {
    $underlyingSource: underlyingSource,
    $pull: $onPullDirectStream,
    $controlledReadableStream: this,
    $sink: sink,
    close: $onCloseDirectStream,
    write: sink.write,
    error: $handleDirectStreamError,
    end: $onCloseDirectStream,
    $close: $onCloseDirectStream,
    flush: $onFlushDirectStream,
    _pendingRead: undefined,
    _deferClose: 0,
    _deferFlush: 0,
    _deferCloseReason: undefined,
    _handleError: undefined,
  };

  $putByIdDirectPrivate(this, "readableStreamController", controller);
  $putByIdDirectPrivate(this, "underlyingSource", null);
  $putByIdDirectPrivate(this, "start", undefined);
  return closingPromise;
}

export function initializeArrayBufferStream(underlyingSource, highWaterMark: number) {
  // This is the fallback implementation for direct streams
  // When we don't know what the destination type is
  // We assume it is a Uint8Array.

  var opts =
    highWaterMark && typeof highWaterMark === "number"
      ? { highWaterMark, stream: true, asUint8Array: true }
      : { stream: true, asUint8Array: true };
  var sink = new Bun.ArrayBufferSink();
  sink.start(opts);

  var controller = {
    $underlyingSource: underlyingSource,
    $pull: $onPullDirectStream,
    $controlledReadableStream: this,
    $sink: sink,
    close: $onCloseDirectStream,
    write: sink.write.bind(sink),
    error: $handleDirectStreamError,
    end: $onCloseDirectStream,
    $close: $onCloseDirectStream,
    flush: $onFlushDirectStream,
    _pendingRead: undefined,
    _deferClose: 0,
    _deferFlush: 0,
    _deferCloseReason: undefined,
    _handleError: undefined,
  };

  $putByIdDirectPrivate(this, "readableStreamController", controller);
  $putByIdDirectPrivate(this, "underlyingSource", null);
  $putByIdDirectPrivate(this, "start", undefined);
}

export function readableStreamError(stream, error) {
  $assert($isReadableStream(stream));
  $putByIdDirectPrivate(stream, "state", $streamErrored);
  $putByIdDirectPrivate(stream, "storedError", error);
  const reader = $getByIdDirectPrivate(stream, "reader");

  if (!reader) return;

  $getByIdDirectPrivate(reader, "closedPromiseCapability").reject.$call(undefined, error);
  const promise = $getByIdDirectPrivate(reader, "closedPromiseCapability").promise;
  $markPromiseAsHandled(promise);

  if ($isReadableStreamDefaultReader(reader)) {
    $readableStreamDefaultReaderErrorReadRequests(reader, error);
  } else {
    $assert($isReadableStreamBYOBReader(reader));
    const requests = $getByIdDirectPrivate(reader, "readIntoRequests");
    $putByIdDirectPrivate(reader, "readIntoRequests", $createFIFO());
    for (var request = requests.shift(); request; request = requests.shift()) $rejectPromise(request, error);
  }
}

export function readableStreamDefaultControllerShouldCallPull(controller) {
  if (!$readableStreamDefaultControllerCanCloseOrEnqueue(controller)) return false;
  if (!($getByIdDirectPrivate(controller, "started") === 1)) return false;

  const stream = $getByIdDirectPrivate(controller, "controlledReadableStream");

  if (
    (!$isReadableStreamLocked(stream) ||
      !$getByIdDirectPrivate($getByIdDirectPrivate(stream, "reader"), "readRequests")?.isNotEmpty()) &&
    $readableStreamDefaultControllerGetDesiredSize(controller) <= 0
  )
    return false;
  const desiredSize = $readableStreamDefaultControllerGetDesiredSize(controller);
  $assert(desiredSize !== null);
  return desiredSize > 0;
}

export function readableStreamDefaultControllerCallPullIfNeeded(controller) {
  // FIXME: use $readableStreamDefaultControllerShouldCallPull
  const stream = $getByIdDirectPrivate(controller, "controlledReadableStream");

  if (!$readableStreamDefaultControllerCanCloseOrEnqueue(controller)) return;
  if (!($getByIdDirectPrivate(controller, "started") === 1)) return;
  if (
    (!$isReadableStreamLocked(stream) ||
      !$getByIdDirectPrivate($getByIdDirectPrivate(stream, "reader"), "readRequests")?.isNotEmpty()) &&
    $readableStreamDefaultControllerGetDesiredSize(controller) <= 0
  )
    return;

  if ($getByIdDirectPrivate(controller, "pulling")) {
    $putByIdDirectPrivate(controller, "pullAgain", true);
    return;
  }

  $assert(!$getByIdDirectPrivate(controller, "pullAgain"));
  $putByIdDirectPrivate(controller, "pulling", true);
  $getByIdDirectPrivate(controller, "pullAlgorithm")
    .$call(undefined)
    .$then(
      function () {
        $putByIdDirectPrivate(controller, "pulling", false);
        if ($getByIdDirectPrivate(controller, "pullAgain")) {
          $putByIdDirectPrivate(controller, "pullAgain", false);

          $readableStreamDefaultControllerCallPullIfNeeded(controller);
        }
      },
      function (error) {
        $readableStreamDefaultControllerError(controller, error);
      },
    );
}

$alwaysInline = true;
export function isReadableStreamLocked(stream) {
  $assert($isReadableStream(stream));
  return (
    // Case 1. Is there a reader actively using it?
    !!$getByIdDirectPrivate(stream, "reader") ||
    // Case 2. Has the native reader been released?
    // Case 3. Has it been converted into a Node.js NativeReadable?
    stream.$bunNativePtr === -1
  );
}

export function readableStreamDefaultControllerGetDesiredSize(controller) {
  const stream = $getByIdDirectPrivate(controller, "controlledReadableStream");
  const state = $getByIdDirectPrivate(stream, "state");

  if (state === $streamErrored) return null;
  if (state === $streamClosed) return 0;

  return $getByIdDirectPrivate(controller, "strategy").highWaterMark - $getByIdDirectPrivate(controller, "queue").size;
}

$alwaysInline = true;
export function readableStreamReaderGenericCancel(reader, reason) {
  const stream = $getByIdDirectPrivate(reader, "ownerReadableStream");
  $assert(!!stream);
  return $readableStreamCancel(stream, reason);
}

export function readableStreamCancel(stream: ReadableStream, reason: any) {
  stream.$disturbed = true;
  const state = $getByIdDirectPrivate(stream, "state");
  if (state === $streamClosed) return Promise.$resolve();
  if (state === $streamErrored) return Promise.$reject($getByIdDirectPrivate(stream, "storedError"));
  $readableStreamClose(stream);

  const controller = $getByIdDirectPrivate(stream, "readableStreamController");
  if (controller === null) return Promise.$resolve();

  const cancel = controller.$cancel;
  if (cancel) return cancel(controller, reason).$then(function () {});

  const close = controller.close;
  if (close) return Promise.$resolve(controller.close(reason));

  $throwTypeError("ReadableStreamController has no cancel or close method");
}

$alwaysInline = true;
export function readableStreamDefaultControllerCancel(controller, reason) {
  $putByIdDirectPrivate(controller, "queue", $newQueue());
  return $getByIdDirectPrivate(controller, "cancelAlgorithm").$call(undefined, reason);
}

export function readableStreamDefaultControllerPull(controller) {
  var queue = $getByIdDirectPrivate(controller, "queue");
  if (queue.content.isNotEmpty()) {
    const chunk = $dequeueValue(queue);
    if ($getByIdDirectPrivate(controller, "closeRequested") && queue.content.isEmpty()) {
      $readableStreamCloseIfPossible($getByIdDirectPrivate(controller, "controlledReadableStream"));
    } else $readableStreamDefaultControllerCallPullIfNeeded(controller);

    return $createFulfilledPromise({ value: chunk, done: false });
  }
  const pendingPromise = $readableStreamAddReadRequest($getByIdDirectPrivate(controller, "controlledReadableStream"));
  $readableStreamDefaultControllerCallPullIfNeeded(controller);
  return pendingPromise;
}

export function readableStreamDefaultControllerClose(controller) {
  $assert($readableStreamDefaultControllerCanCloseOrEnqueue(controller));
  $putByIdDirectPrivate(controller, "closeRequested", true);
  if ($getByIdDirectPrivate(controller, "queue")?.content?.isEmpty()) {
    $readableStreamCloseIfPossible($getByIdDirectPrivate(controller, "controlledReadableStream"));
  }
}

export function readableStreamCloseIfPossible(stream) {
  switch ($getByIdDirectPrivate(stream, "state")) {
    case $streamReadable:
    case $streamClosing: {
      $readableStreamClose(stream);
      break;
    }
  }
}

export function readableStreamClose(stream) {
  $assert(
    $getByIdDirectPrivate(stream, "state") === $streamReadable ||
      $getByIdDirectPrivate(stream, "state") === $streamClosing,
  );
  $putByIdDirectPrivate(stream, "state", $streamClosed);
  const reader = $getByIdDirectPrivate(stream, "reader");
  if (!reader) return;

  if ($isReadableStreamDefaultReader(reader)) {
    const requests = $getByIdDirectPrivate(reader, "readRequests");
    if (requests.isNotEmpty()) {
      $putByIdDirectPrivate(reader, "readRequests", $createFIFO());

      for (var request = requests.shift(); request; request = requests.shift())
        $fulfillPromise(request, { value: undefined, done: true });
    }
  }

  $getByIdDirectPrivate($getByIdDirectPrivate(stream, "reader"), "closedPromiseCapability").resolve.$call();
}

export function readableStreamFulfillReadRequest(stream, chunk, done) {
  const readRequest = $getByIdDirectPrivate($getByIdDirectPrivate(stream, "reader"), "readRequests").shift();
  $fulfillPromise(readRequest, { value: chunk, done: done });
}

export function readableStreamDefaultControllerEnqueue(controller, chunk) {
  const stream = $getByIdDirectPrivate(controller, "controlledReadableStream");
  // this is checked by callers
  $assert($readableStreamDefaultControllerCanCloseOrEnqueue(controller));

  if (
    $isReadableStreamLocked(stream) &&
    $getByIdDirectPrivate($getByIdDirectPrivate(stream, "reader"), "readRequests")?.isNotEmpty()
  ) {
    $readableStreamFulfillReadRequest(stream, chunk, false);
    $readableStreamDefaultControllerCallPullIfNeeded(controller);
    return;
  }

  try {
    let chunkSize = 1;
    if ($getByIdDirectPrivate(controller, "strategy").size !== undefined)
      chunkSize = $getByIdDirectPrivate(controller, "strategy").size(chunk);
    $enqueueValueWithSize($getByIdDirectPrivate(controller, "queue"), chunk, chunkSize);
  } catch (error) {
    $readableStreamDefaultControllerError(controller, error);
    throw error;
  }
  $readableStreamDefaultControllerCallPullIfNeeded(controller);
}

export function readableStreamDefaultReaderRead(reader) {
  const stream = $getByIdDirectPrivate(reader, "ownerReadableStream");
  $assert(!!stream);
  const state = $getByIdDirectPrivate(stream, "state");

  stream.$disturbed = true;
  if (state === $streamClosed) return $createFulfilledPromise({ value: undefined, done: true });
  if (state === $streamErrored) return Promise.$reject($getByIdDirectPrivate(stream, "storedError"));
  $assert(state === $streamReadable);

  return $getByIdDirectPrivate(stream, "readableStreamController").$pull(
    $getByIdDirectPrivate(stream, "readableStreamController"),
  );
}

export function readableStreamAddReadRequest(stream) {
  $assert($isReadableStreamDefaultReader($getByIdDirectPrivate(stream, "reader")));
  $assert($getByIdDirectPrivate(stream, "state") == $streamReadable);

  const readRequest = $newPromise();

  $getByIdDirectPrivate($getByIdDirectPrivate(stream, "reader"), "readRequests").push(readRequest);

  return readRequest;
}

export function isReadableStreamDisturbed(stream) {
  $assert($isReadableStream(stream));
  return stream.$disturbed;
}

$visibility = "Private";
export function readableStreamDefaultReaderRelease(reader) {
  $readableStreamReaderGenericRelease(reader);
  $readableStreamDefaultReaderErrorReadRequests(
    reader,
    $ERR_STREAM_RELEASE_LOCK("Stream reader cancelled via releaseLock()"),
  );
}

$visibility = "Private";
export function readableStreamReaderGenericRelease(reader) {
  $assert(!!$getByIdDirectPrivate(reader, "ownerReadableStream"));
  $assert($getByIdDirectPrivate($getByIdDirectPrivate(reader, "ownerReadableStream"), "reader") === reader);

  if ($getByIdDirectPrivate($getByIdDirectPrivate(reader, "ownerReadableStream"), "state") === $streamReadable)
    $getByIdDirectPrivate(reader, "closedPromiseCapability").reject.$call(
      undefined,
      $ERR_STREAM_RELEASE_LOCK("Stream reader cancelled via releaseLock()"),
    );
  else
    $putByIdDirectPrivate(reader, "closedPromiseCapability", {
      promise: $newHandledRejectedPromise($ERR_STREAM_RELEASE_LOCK("Stream reader cancelled via releaseLock()")),
    });

  const promise = $getByIdDirectPrivate(reader, "closedPromiseCapability").promise;
  $markPromiseAsHandled(promise);

  var stream = $getByIdDirectPrivate(reader, "ownerReadableStream");
  if (stream.$bunNativePtr) {
    $getByIdDirectPrivate($getByIdDirectPrivate(stream, "readableStreamController"), "underlyingSource").$resume(false);
  }
  $putByIdDirectPrivate(stream, "reader", undefined);
  $putByIdDirectPrivate(reader, "ownerReadableStream", undefined);
}

export function readableStreamDefaultReaderErrorReadRequests(reader, error) {
  const requests = $getByIdDirectPrivate(reader, "readRequests");
  $putByIdDirectPrivate(reader, "readRequests", $createFIFO());
  for (var request = requests.shift(); request; request = requests.shift()) $rejectPromise(request, error);
}

export function readableStreamDefaultControllerCanCloseOrEnqueue(controller) {
  if ($getByIdDirectPrivate(controller, "closeRequested")) {
    return false;
  }

  const controlledReadableStream = $getByIdDirectPrivate(controller, "controlledReadableStream");

  if (!$isObject(controlledReadableStream)) {
    return false;
  }

  return $getByIdDirectPrivate(controlledReadableStream, "state") === $streamReadable;
}

export function readableStreamFromAsyncIterator(target, fn) {
  var cancelled = false,
    iter: AsyncIterator<any>;

  // We must eagerly start the async generator to ensure that it works if objects are reused later.
  // This impacts Astro, amongst others.
  iter = fn.$call(target);
  fn = target = undefined;

  if (!$isAsyncGenerator(iter) && typeof iter.next !== "function") {
    throw new TypeError("Expected an async generator");
  }

  return new ReadableStream({
    type: "direct",

    cancel(reason) {
      $debug("readableStreamFromAsyncIterator.cancel", reason);
      cancelled = true;

      if (iter) {
        const thisIter = iter;
        iter = undefined;
        if (reason) {
          // We return the value so that the caller can await it.
          return thisIter.throw?.(reason);
        } else {
          // undefined === Abort.
          //
          // We don't want to throw here because it will almost
          // inevitably become an uncatchable exception. So instead, we call the
          // synthetic return method if it exists to signal that the stream is
          // done.
          return thisIter?.return?.();
        }
      }
    },

    close() {
      cancelled = true;
    },

    async pull(controller) {
      var closingError: Error | undefined, value, done, immediateTask;

      try {
        while (!cancelled && !done) {
          const promise = iter.next(controller);

          if (cancelled) {
            return;
          }

          if ($isPromise(promise) && $isPromiseFulfilled(promise)) {
            clearImmediate(immediateTask);
            ({ value, done } = $getPromiseInternalField(promise, $promiseFieldReactionsOrResult));
            $assert(!$isPromise(value), "Expected a value, not a promise");
          } else {
            immediateTask = setImmediate(() => immediateTask && controller?.flush?.(true));
            ({ value, done } = await promise);

            if (cancelled) {
              return;
            }
          }

          if (!$isUndefinedOrNull(value)) {
            controller.write(value);
          }
        }
      } catch (e) {
        closingError = e;
      } finally {
        clearImmediate(immediateTask);
        immediateTask = undefined;
        // "iter" will be undefined if the stream was closed above.

        // Stream was closed before we tried writing to it.
        if (closingError?.code === "ERR_INVALID_THIS") {
          await iter?.return?.();
          return;
        }

        if (closingError) {
          try {
            await iter.throw?.(closingError);
          } finally {
            iter = undefined;
            // eslint-disable-next-line no-throw-literal
            throw closingError;
          }
        } else {
          await controller.end();
          if (iter) {
            await iter.return?.();
          }
        }
        iter = undefined;
      }
    },
  });
}

export function createLazyLoadedStreamPrototype(): typeof ReadableStreamDefaultController {
  const closer = [false];

  function callClose(controller: ReadableStreamDefaultController) {
    try {
      var source = controller.$underlyingSource;
      const stream = $getByIdDirectPrivate(controller, "controlledReadableStream");
      if (!stream) {
        return;
      }

      if ($getByIdDirectPrivate(stream, "state") !== $streamReadable) return;
      controller.close();
    } catch (e) {
      globalThis.reportError(e);
    } finally {
      if (source?.$stream) {
        source.$stream = undefined;
      }

      if (source) {
        source.$data = undefined;
      }
    }
  }

  // This was a type: "bytes" until Bun v1.1.44, but pendingPullIntos was not really
  // compatible with how we send data to the stream, and "mode: 'byob'" wasn't
  // supported so changing it isn't an observable change.
  //
  // When we receive chunks of data from native code, we sometimes read more
  // than what the input buffer provided. When that happens, we return a typed
  // array instead of the number of bytes read.
  //
  // When that happens, the ReadableByteStreamController creates (byteLength / autoAllocateChunkSize) pending pull into descriptors.
  // So if that number is something like 16 * 1024, and we actually read 2 MB, you're going to create 128 pending pull into descriptors.
  //
  // And those pendingPullIntos were often never actually drained.
  class NativeReadableStreamSource {
    constructor(handle, autoAllocateChunkSize, drainValue) {
      $putByIdDirectPrivate(this, "stream", handle);
      this.pull = this.#pull.bind(this);
      this.cancel = this.#cancel.bind(this);
      this.autoAllocateChunkSize = autoAllocateChunkSize;

      if (drainValue !== undefined) {
        this.start = controller => {
          this.start = undefined;
          this.#controller = new WeakRef(controller);
          controller.enqueue(drainValue);
        };
      }

      handle.onClose = this.#onClose.bind(this);
      handle.onDrain = this.#onDrain.bind(this);
    }

    #onDrain(chunk) {
      var controller = this.#controller?.deref?.();
      if (controller) {
        controller.enqueue(chunk);
      }
    }

    #hasResized = false;

    #adjustHighWaterMark(result) {
      const autoAllocateChunkSize = this.autoAllocateChunkSize;
      if (result >= autoAllocateChunkSize && !this.#hasResized) {
        this.#hasResized = true;
        this.autoAllocateChunkSize = Math.min(autoAllocateChunkSize * 2, 1024 * 1024 * 2);
      }
    }

    #controller?: WeakRef<ReadableStreamDefaultController>;

    // eslint-disable-next-line no-unused-vars
    pull;
    // eslint-disable-next-line no-unused-vars
    cancel;
    // eslint-disable-next-line no-unused-vars
    start;

    autoAllocateChunkSize = 0;
    #closed = false;

    $data?: Uint8Array;

    // @ts-ignore-next-line
    $stream: ReadableStream;

    #onClose() {
      this.#closed = true;
      this.#controller = undefined;
      this.$data = undefined;

      var controller = this.#controller?.deref?.();

      $putByIdDirectPrivate(this, "stream", undefined);
      if (controller) {
        $enqueueJob(callClose, controller);
      }
    }

    #getInternalBuffer(chunkSize) {
      var chunk = this.$data;
      if (!chunk || chunk.length < chunkSize) {
        this.$data = chunk = new Uint8Array(chunkSize);
      }
      return chunk;
    }

    #handleArrayBufferViewResult(result, view, isClosed, controller) {
      if (result.byteLength > 0) {
        controller.enqueue(result);
      }

      if (isClosed) {
        $enqueueJob(callClose, controller);
        return undefined;
      }

      return view;
    }

    #handleNumberResult(result, view, isClosed, controller) {
      if (result > 0) {
        const remaining = view.length - result;
        let toEnqueue = view;

        if (remaining > 0) {
          toEnqueue = view.subarray(0, result);
          view = view.subarray(result);
        } else {
          view = undefined;
        }

        controller.enqueue(toEnqueue);
      }

      if (isClosed) {
        $enqueueJob(callClose, controller);
        return undefined;
      }

      return view;
    }

    #onNativeReadableStreamResult(result, view, isClosed, controller) {
      if (typeof result === "number") {
        if (!isClosed) this.#adjustHighWaterMark(result);
        return this.#handleNumberResult(result, view, isClosed, controller);
      } else if (typeof result === "boolean") {
        $enqueueJob(callClose, controller);
        return undefined;
      } else if ($isTypedArrayView(result)) {
        if (!isClosed) this.#adjustHighWaterMark(result.byteLength);
        return this.#handleArrayBufferViewResult(result, view, isClosed, controller);
      }

      $debug("Unknown result type", result);
      throw $ERR_INVALID_STATE("Internal error: invalid result from pull. This is a bug in Bun. Please report it.");
    }

    // eslint-disable-next-line no-unused-private-class-members
    #pull(controller) {
      var handle = $getByIdDirectPrivate(this, "stream");

      if (!handle || this.#closed) {
        this.#controller = undefined;
        this.#closed = true;
        $putByIdDirectPrivate(this, "stream", undefined);
        $enqueueJob(callClose, controller);
        this.$data = undefined;
        return;
      }

      if (!this.#controller) {
        this.#controller = new WeakRef(controller);
      }

      closer[0] = false;

      if (this.$data) {
        let drainResult = handle.drain();
        if (drainResult) {
          this.$data = this.#onNativeReadableStreamResult(drainResult, this.$data, closer[0], controller);
          return;
        }
      }

      const view = this.#getInternalBuffer(this.autoAllocateChunkSize);
      const result = handle.pull(view, closer);
      if ($isPromise(result)) {
        return result.$then(
          result => {
            this.$data = this.#onNativeReadableStreamResult(result, view, closer[0], controller);
            if (this.#closed) {
              this.$data = undefined;
            }
          },
          err => {
            this.$data = undefined;
            this.#closed = true;
            this.#controller = undefined;
            controller.error(err);
            this.#onClose();
          },
        );
      }

      this.$data = this.#onNativeReadableStreamResult(result, view, closer[0], controller);
      if (this.#closed) {
        this.$data = undefined;
      }
    }

    // eslint-disable-next-line no-unused-private-class-members
    #cancel(reason) {
      var handle = $getByIdDirectPrivate(this, "stream");
      this.$data = undefined;
      if (handle) {
        handle.updateRef(false);
        handle.cancel(reason);
        $putByIdDirectPrivate(this, "stream", undefined);
      }
    }
  }
  // this is reuse of an existing private symbol
  NativeReadableStreamSource.prototype.$resume = function (has_ref) {
    var handle = $getByIdDirectPrivate(this, "stream");
    if (handle) handle.updateRef(has_ref);
  };

  return NativeReadableStreamSource;
}

export function lazyLoadStream(stream, autoAllocateChunkSize) {
  $debug("lazyLoadStream", stream, autoAllocateChunkSize);
  var handle = stream.$bunNativePtr;
  if (handle === -1) return;
  var Prototype = $lazyStreamPrototypeMap.$get($getPrototypeOf(handle));
  if (Prototype === undefined) {
    $lazyStreamPrototypeMap.$set($getPrototypeOf(handle), (Prototype = $createLazyLoadedStreamPrototype()));
  }

  stream.$disturbed = true;

  if (autoAllocateChunkSize === undefined) {
    // This default is what Node.js uses as well.
    autoAllocateChunkSize = 256 * 1024;
  }

  const chunkSizeOrCompleteBuffer = handle.start(autoAllocateChunkSize);
  let chunkSize, drainValue;
  if ($isTypedArrayView(chunkSizeOrCompleteBuffer)) {
    chunkSize = 0;
    drainValue = chunkSizeOrCompleteBuffer;
  } else {
    chunkSize = chunkSizeOrCompleteBuffer;
    drainValue = handle.drain();
  }

  // empty file, no need for native back-and-forth on this
  if (chunkSize === 0) {
    if ((drainValue?.byteLength ?? 0) > 0) {
      return {
        start(controller) {
          controller.enqueue(drainValue);
          controller.close();
        },
        pull(controller) {
          controller.close();
        },
      };
    }

    return {
      start(controller) {
        controller.close();
      },
      pull(controller) {
        controller.close();
      },
    };
  }

  return new Prototype(handle, Math.max(chunkSize, autoAllocateChunkSize), drainValue);
}

export function readableStreamIntoArray(stream) {
  var reader = stream.getReader();
  var manyResult = reader.readMany();

  async function processManyResult(result) {
    let { done, value } = result;
    var chunks = value || [];

    while (!done) {
      var thisResult = reader.readMany();
      if ($isPromise(thisResult)) {
        thisResult = await thisResult;
      }

      ({ done, value = [] } = thisResult);
      const length = value.length || 0;
      if (length > 1) {
        chunks = chunks.concat(value);
      } else if (length === 1) {
        chunks.push(value[0]);
      }
    }

    return chunks;
  }

  if (manyResult && $isPromise(manyResult)) {
    return manyResult.$then(processManyResult);
  }

  return processManyResult(manyResult);
}

export function withoutUTF8BOM(result) {
  if (result.charCodeAt(0) === 0xfeff) {
    return result.slice(1);
  }

  return result;
}

export function readableStreamIntoText(stream: ReadableStream) {
  const highWaterMark = $getByIdDirectPrivate(stream, "highWaterMark");
  const [textStream, closer] = $createTextStream(highWaterMark);
  const prom = $readStreamIntoSink(stream, textStream, false);

  if (prom && $isPromise(prom)) {
    return Promise.$resolve(prom).$then(closer.promise).$then($withoutUTF8BOM);
  }

  return closer.promise.$then($withoutUTF8BOM);
}

export function readableStreamToArrayBufferDirect(
  stream: ReadableStream,
  underlyingSource: any,
  asUint8Array: boolean,
) {
  var sink = new Bun.ArrayBufferSink();
  $putByIdDirectPrivate(stream, "underlyingSource", null);
  var highWaterMark = $getByIdDirectPrivate(stream, "highWaterMark");
  sink.start({ highWaterMark, asUint8Array });
  var capability = $newPromiseCapability(Promise);
  var ended = false;
  var pull = underlyingSource.pull;
  var close = underlyingSource.close;

  var controller = {
    start() {},
    close(_reason) {
      if (!ended) {
        ended = true;
        if (close) {
          close();
        }

        $fulfillPromise(capability.promise, sink.end());
      }
    },
    end() {
      if (!ended) {
        ended = true;
        if (close) {
          close();
        }
        $fulfillPromise(capability.promise, sink.end());
      }
    },
    flush() {
      return 0;
    },
    write: sink.write.bind(sink),
  };

  var didError = false;
  try {
    var firstPull = pull(controller);
  } catch (e) {
    didError = true;
    $readableStreamError(stream, e);
    return Promise.$reject(e);
  } finally {
    if (!$isPromise(firstPull)) {
      if (!didError && stream) $readableStreamCloseIfPossible(stream);
      controller = close = sink = pull = stream = undefined;
      return capability.promise;
    }
  }

  $assert($isPromise(firstPull));
  return firstPull.then(
    () => {
      if (!didError && stream) $readableStreamCloseIfPossible(stream);
      controller = close = sink = pull = stream = undefined;
      return capability.promise;
    },
    e => {
      didError = true;
      if ($getByIdDirectPrivate(stream, "state") === $streamReadable) $readableStreamError(stream, e);
      return Promise.$reject(e);
    },
  );
}

export async function readableStreamToTextDirect(stream, underlyingSource) {
  const capability = $initializeTextStream.$call(stream, underlyingSource, undefined);
  var reader = stream.getReader();

  while ($getByIdDirectPrivate(stream, "state") === $streamReadable) {
    var thisResult = await reader.read();
    if (thisResult.done) {
      break;
    }
  }

  try {
    reader.releaseLock();
  } catch {}
  reader = undefined;
  stream = undefined;

  return capability.promise;
}

export async function readableStreamToArrayDirect(stream, underlyingSource) {
  const capability = $initializeArrayStream.$call(stream, underlyingSource, undefined);
  underlyingSource = undefined;
  var reader = stream.getReader();
  try {
    while ($getByIdDirectPrivate(stream, "state") === $streamReadable) {
      var thisResult = await reader.read();
      if (thisResult.done) {
        break;
      }
    }

    try {
      reader.releaseLock();
    } catch {}
    reader = undefined;

    return Promise.$resolve(capability.promise);
  } finally {
    stream = undefined;
    reader = undefined;
  }
}

export function readableStreamDefineLazyIterators(prototype) {
  var asyncIterator = globalThis.Symbol.asyncIterator;

  var ReadableStreamAsyncIterator = async function* ReadableStreamAsyncIterator(stream, preventCancel) {
    var reader = stream.getReader();
    var deferredError;
    try {
      while (true) {
        var done, value;
        const firstResult = reader.readMany();
        if ($isPromise(firstResult)) {
          ({ done, value } = await firstResult);
        } else {
          ({ done, value } = firstResult);
        }

        if (done) {
          return;
        }
        yield* value;
      }
    } catch (e) {
      deferredError = e;
      throw e;
    } finally {
      reader.releaseLock();

      if (!preventCancel && !$isReadableStreamLocked(stream)) {
        const promise = stream.cancel(deferredError);
        if (Bun.peek.status(promise) === "rejected") {
          $markPromiseAsHandled(promise);
        }
      }
    }
  };
  var createAsyncIterator = function asyncIterator() {
    return ReadableStreamAsyncIterator(this, false);
  };
  var createValues = function values({ preventCancel = false } = { preventCancel: false }) {
    return ReadableStreamAsyncIterator(this, preventCancel);
  };
  $Object.$defineProperty(prototype, asyncIterator, { value: createAsyncIterator });
  $Object.$defineProperty(prototype, "values", { value: createValues });
  return prototype;
}
