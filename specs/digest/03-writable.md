# Writable streams

Implementation contract transcribed from the WHATWG Streams Standard, §"Writable streams".

## WritableStream

The WritableStream represents a writable stream.

**Web IDL**

```webidl
[Exposed=*, Transferable]
interface WritableStream {
  constructor(optional object underlyingSink, optional QueuingStrategy strategy = {});

  readonly attribute boolean locked;

  Promise<undefined> abort(optional any reason);
  Promise<undefined> close();
  WritableStreamDefaultWriter getWriter();
};
```

**Transferable?** Yes (`[Transferable]`). See "Transfer via postMessage()" below.

**Internal slots**

| Internal Slot | Description (non-normative) |
| --- | --- |
| `[[backpressure]]` | A boolean indicating the backpressure signal set by the controller |
| `[[closeRequest]]` | The promise returned from the writer's close() method |
| `[[controller]]` | A WritableStreamDefaultController created with the ability to control the state and queue of this stream |
| `[[Detached]]` | A boolean flag set to true when the stream is transferred |
| `[[inFlightWriteRequest]]` | A slot set to the promise for the current in-flight write operation while the underlying sink's write algorithm is executing and has not yet fulfilled, used to prevent reentrant calls |
| `[[inFlightCloseRequest]]` | A slot set to the promise for the current in-flight close operation while the underlying sink's close algorithm is executing and has not yet fulfilled, used to prevent the abort() method from interrupting close |
| `[[pendingAbortRequest]]` | A pending abort request |
| `[[state]]` | A string containing the stream's current state, used internally; one of "writable", "closed", "erroring", or "errored" |
| `[[storedError]]` | A value indicating how the stream failed, to be given as a failure reason or exception when trying to operate on the stream while in the "errored" state |
| `[[writer]]` | A WritableStreamDefaultWriter instance, if the stream is locked to a writer, or undefined if it is not |
| `[[writeRequests]]` | A list of promises representing the stream's internal queue of write requests not yet processed by the underlying sink |

> Note: The `[[inFlightCloseRequest]]` slot and `[[closeRequest]]` slot are mutually exclusive. Similarly, no element will be removed from `[[writeRequests]]` while `[[inFlightWriteRequest]]` is not undefined. Implementations can optimize storage for these slots based on these invariants.

**pending abort request** — a struct used to track a request to abort the stream before that request is finally processed. It has the following items:

- **promise**: A promise returned from WritableStreamAbort
- **reason**: A JavaScript value that was passed as the abort reason to WritableStreamAbort
- **was already erroring**: A boolean indicating whether or not the stream was in the "erroring" state when WritableStreamAbort was called, which impacts the outcome of the abort request

### The underlying sink API

The WritableStream() constructor accepts as its first argument a JavaScript object representing the underlying sink. Such objects can contain any of the following properties:

```webidl
dictionary UnderlyingSink {
  UnderlyingSinkStartCallback start;
  UnderlyingSinkWriteCallback write;
  UnderlyingSinkCloseCallback close;
  UnderlyingSinkAbortCallback abort;
  any type;
};

callback UnderlyingSinkStartCallback = any (WritableStreamDefaultController controller);
callback UnderlyingSinkWriteCallback = Promise<undefined> (any chunk, WritableStreamDefaultController controller);
callback UnderlyingSinkCloseCallback = Promise<undefined> ();
callback UnderlyingSinkAbortCallback = Promise<undefined> (optional any reason);
```

- **start(controller)** — A function that is called immediately during creation of the WritableStream. Typically this is used to acquire access to the underlying sink resource being represented. If this setup process is asynchronous, it can return a promise to signal success or failure; a rejected promise will error the stream. Any thrown exceptions will be re-thrown by the WritableStream() constructor.
- **write(chunk, controller)** — A function that is called when a new chunk of data is ready to be written to the underlying sink. The stream implementation guarantees that this function will be called only after previous writes have succeeded, and never before start() has succeeded or after close() or abort() have been called. This function is used to actually send the data to the resource presented by the underlying sink, for example by calling a lower-level API. If the process of writing data is asynchronous, and communicates success or failure signals back to its user, then this function can return a promise to signal success or failure. This promise return value will be communicated back to the caller of writer.write(), so they can monitor that individual write. Throwing an exception is treated the same as returning a rejected promise. Note that such signals are not always available; in such cases, it's best to not return anything. The promise potentially returned by this function also governs whether the given chunk counts as written for the purposes of computing the desired size to fill the stream's internal queue. That is, during the time it takes the promise to settle, writer.desiredSize will stay at its previous value, only increasing to signal the desire for more chunks once the write succeeds. Finally, the promise potentially returned by this function is used to ensure that well-behaved producers do not attempt to mutate the chunk before it has been fully processed. (This is not guaranteed by any specification machinery, but instead is an informal contract between producers and the underlying sink.)
- **close()** — A function that is called after the producer signals, via writer.close(), that they are done writing chunks to the stream, and subsequently all queued-up writes have successfully completed. This function can perform any actions necessary to finalize or flush writes to the underlying sink, and release access to any held resources. If the shutdown process is asynchronous, the function can return a promise to signal success or failure; the result will be communicated via the return value of the called writer.close() method. Additionally, a rejected promise will error the stream, instead of letting it close successfully. Throwing an exception is treated the same as returning a rejected promise.
- **abort(reason)** — A function that is called after the producer signals, via stream.abort() or writer.abort(), that they wish to abort the stream. It takes as its argument the same value as was passed to those methods by the producer. Writable streams can additionally be aborted under certain conditions during piping; see the definition of the ReadableStream pipeTo() method for more details. This function can clean up any held resources, much like close(), but perhaps with some custom handling. If the shutdown process is asynchronous, the function can return a promise to signal success or failure; the result will be communicated via the return value of the called writer.abort() method. Throwing an exception is treated the same as returning a rejected promise. Regardless, the stream will be errored with a new TypeError indicating that it was aborted.
- **type** — This property is reserved for future use, so any attempts to supply a value will throw an exception.

The `controller` argument passed to start() and write() is an instance of WritableStreamDefaultController, and has the ability to error the stream. This is mainly used for bridging the gap with non-promise-based APIs.

### Constructor: new WritableStream(underlyingSink, strategy)

1. If underlyingSink is missing, set it to null.
1. Let underlyingSinkDict be underlyingSink, converted to an IDL value of type UnderlyingSink.
   > Note: We cannot declare the underlyingSink argument as having the UnderlyingSink type directly, because doing so would lose the reference to the original object. We need to retain the object so we can invoke the various methods on it.
1. If underlyingSinkDict["type"] exists, throw a RangeError exception.
   > Note: This is to allow us to add new potential types in the future, without backward-compatibility concerns.
1. Perform ! InitializeWritableStream(this).
1. Let sizeAlgorithm be ! ExtractSizeAlgorithm(strategy).
1. Let highWaterMark be ? ExtractHighWaterMark(strategy, 1).
1. Perform ? SetUpWritableStreamDefaultControllerFromUnderlyingSink(this, underlyingSink, underlyingSinkDict, highWaterMark, sizeAlgorithm).

### Getter: locked

1. Return ! IsWritableStreamLocked(this).

### Method: abort(reason)

1. If ! IsWritableStreamLocked(this) is true, return a promise rejected with a TypeError exception.
1. Return ! WritableStreamAbort(this, reason).

### Method: close()

1. If ! IsWritableStreamLocked(this) is true, return a promise rejected with a TypeError exception.
1. If ! WritableStreamCloseQueuedOrInFlight(this) is true, return a promise rejected with a TypeError exception.
1. Return ! WritableStreamClose(this).

### Method: getWriter()

1. Return ? AcquireWritableStreamDefaultWriter(this).

### Transfer steps (given value and dataHolder)

1. If ! IsWritableStreamLocked(value) is true, throw a "DataCloneError" DOMException.
1. Let port1 be a new MessagePort in the current Realm.
1. Let port2 be a new MessagePort in the current Realm.
1. Entangle port1 and port2.
1. Let readable be a new ReadableStream in the current Realm.
1. Perform ! SetUpCrossRealmTransformReadable(readable, port1).
1. Let promise be ! ReadableStreamPipeTo(readable, value, false, false, false).
1. Set promise.[[PromiseIsHandled]] to true.
1. Set dataHolder.[[port]] to ! StructuredSerializeWithTransfer(port2, « port2 »).

### Transfer-receiving steps (given dataHolder and value)

1. Let deserializedRecord be ! StructuredDeserializeWithTransfer(dataHolder.[[port]], the current Realm).
1. Let port be a deserializedRecord.[[Deserialized]].
1. Perform ! SetUpCrossRealmTransformWritable(value, port).

## WritableStreamDefaultWriter

The WritableStreamDefaultWriter class represents a writable stream writer designed to be vended by a WritableStream instance.

**Web IDL**

```webidl
[Exposed=*]
interface WritableStreamDefaultWriter {
  constructor(WritableStream stream);

  readonly attribute Promise<undefined> closed;
  readonly attribute unrestricted double? desiredSize;
  readonly attribute Promise<undefined> ready;

  Promise<undefined> abort(optional any reason);
  Promise<undefined> close();
  undefined releaseLock();
  Promise<undefined> write(optional any chunk);
};
```

**Transferable?** No.

**Internal slots**

| Internal Slot | Description (non-normative) |
| --- | --- |
| `[[closedPromise]]` | A promise returned by the writer's closed getter |
| `[[readyPromise]]` | A promise returned by the writer's ready getter |
| `[[stream]]` | A WritableStream instance that owns this reader |

### Constructor: new WritableStreamDefaultWriter(stream)

1. Perform ? SetUpWritableStreamDefaultWriter(this, stream).

### Getter: closed

1. Return this.[[closedPromise]].

### Getter: desiredSize

1. If this.[[stream]] is undefined, throw a TypeError exception.
1. Return ! WritableStreamDefaultWriterGetDesiredSize(this).

### Getter: ready

1. Return this.[[readyPromise]].

### Method: abort(reason)

1. If this.[[stream]] is undefined, return a promise rejected with a TypeError exception.
1. Return ! WritableStreamDefaultWriterAbort(this, reason).

### Method: close()

1. Let stream be this.[[stream]].
1. If stream is undefined, return a promise rejected with a TypeError exception.
1. If ! WritableStreamCloseQueuedOrInFlight(stream) is true, return a promise rejected with a TypeError exception.
1. Return ! WritableStreamDefaultWriterClose(this).

### Method: releaseLock()

1. Let stream be this.[[stream]].
1. If stream is undefined, return.
1. Assert: stream.[[writer]] is not undefined.
1. Perform ! WritableStreamDefaultWriterRelease(this).

### Method: write(chunk)

1. If this.[[stream]] is undefined, return a promise rejected with a TypeError exception.
1. Return ! WritableStreamDefaultWriterWrite(this, chunk).

## WritableStreamDefaultController

The WritableStreamDefaultController class has methods that allow control of a WritableStream's state. When constructing a WritableStream, the underlying sink is given a corresponding WritableStreamDefaultController instance to manipulate.

**Web IDL**

```webidl
[Exposed=*]
interface WritableStreamDefaultController {
  readonly attribute AbortSignal signal;
  undefined error(optional any e);
};
```

**Transferable?** No. (No public constructor.)

**Internal slots**

| Internal Slot | Description (non-normative) |
| --- | --- |
| `[[abortAlgorithm]]` | A promise-returning algorithm, taking one argument (the abort reason), which communicates a requested abort to the underlying sink |
| `[[abortController]]` | An AbortController that can be used to abort the pending write or close operation when the stream is aborted. |
| `[[closeAlgorithm]]` | A promise-returning algorithm which communicates a requested close to the underlying sink |
| `[[queue]]` | A list representing the stream's internal queue of chunks |
| `[[queueTotalSize]]` | The total size of all the chunks stored in `[[queue]]` (see the "Queue-with-sizes" section) |
| `[[started]]` | A boolean flag indicating whether the underlying sink has finished starting |
| `[[strategyHWM]]` | A number supplied by the creator of the stream as part of the stream's queuing strategy, indicating the point at which the stream will apply backpressure to its underlying sink |
| `[[strategySizeAlgorithm]]` | An algorithm to calculate the size of enqueued chunks, as part of the stream's queuing strategy |
| `[[stream]]` | The WritableStream instance controlled |
| `[[writeAlgorithm]]` | A promise-returning algorithm, taking one argument (the chunk to write), which writes data to the underlying sink |

The **close sentinel** is a unique value enqueued into `[[queue]]`, in lieu of a chunk, to signal that the stream is closed. It is only used internally, and is never exposed to web developers.

### Getter: signal

1. Return this.[[abortController]]'s signal.

### Method: error(e)

1. Let state be this.[[stream]].[[state]].
1. If state is not "writable", return.
1. Perform ! WritableStreamDefaultControllerError(this, e).

### Internal method: [[AbortSteps]](reason)

Implements the WritableStreamController [[AbortSteps]] contract. It performs the following steps:

1. Let result be the result of performing this.[[abortAlgorithm]], passing reason.
1. Perform ! WritableStreamDefaultControllerClearAlgorithms(this).
1. Return result.

### Internal method: [[ErrorSteps]]()

Implements the WritableStreamController [[ErrorSteps]] contract. It performs the following steps:

1. Perform ! ResetQueue(this).

## Abstract operations

### Interfacing with controllers: the controller contract

Each controller class defines two internal methods, which are called by the WritableStream algorithms:

- **[[AbortSteps]](reason)** — The controller's steps that run in reaction to the stream being aborted, used to clean up the state stored in the controller and inform the underlying sink.
- **[[ErrorSteps]]()** — The controller's steps that run in reaction to the stream being errored, used to clean up the state stored in the controller.

(These are defined as internal methods, instead of as abstract operations, so that they can be called polymorphically by the WritableStream algorithms, without having to branch on which type of controller is present.)

## Working with writable streams

### AcquireWritableStreamDefaultWriter(stream) → WritableStreamDefaultWriter

1. Let writer be a new WritableStreamDefaultWriter.
1. Perform ? SetUpWritableStreamDefaultWriter(writer, stream).
1. Return writer.

### CreateWritableStream(startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm) → WritableStream

1. Assert: ! IsNonNegativeNumber(highWaterMark) is true.
1. Let stream be a new WritableStream.
1. Perform ! InitializeWritableStream(stream).
1. Let controller be a new WritableStreamDefaultController.
1. Perform ? SetUpWritableStreamDefaultController(stream, controller, startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm).
1. Return stream.

> Note: This abstract operation will throw an exception if and only if the supplied startAlgorithm throws.

### InitializeWritableStream(stream) → undefined

1. Set stream.[[state]] to "writable".
1. Set stream.[[storedError]], stream.[[writer]], stream.[[controller]], stream.[[inFlightWriteRequest]], stream.[[closeRequest]], stream.[[inFlightCloseRequest]], and stream.[[pendingAbortRequest]] to undefined.
1. Set stream.[[writeRequests]] to a new empty list.
1. Set stream.[[backpressure]] to false.

### IsWritableStreamLocked(stream) → boolean

1. If stream.[[writer]] is undefined, return false.
1. Return true.

### SetUpWritableStreamDefaultWriter(writer, stream) → undefined

1. If ! IsWritableStreamLocked(stream) is true, throw a TypeError exception.
1. Set writer.[[stream]] to stream.
1. Set stream.[[writer]] to writer.
1. Let state be stream.[[state]].
1. If state is "writable",
   1. If ! WritableStreamCloseQueuedOrInFlight(stream) is false and stream.[[backpressure]] is true, set writer.[[readyPromise]] to a new promise.
   1. Otherwise, set writer.[[readyPromise]] to a promise resolved with undefined.
   1. Set writer.[[closedPromise]] to a new promise.
1. Otherwise, if state is "erroring",
   1. Set writer.[[readyPromise]] to a promise rejected with stream.[[storedError]].
   1. Set writer.[[readyPromise]].[[PromiseIsHandled]] to true.
   1. Set writer.[[closedPromise]] to a new promise.
1. Otherwise, if state is "closed",
   1. Set writer.[[readyPromise]] to a promise resolved with undefined.
   1. Set writer.[[closedPromise]] to a promise resolved with undefined.
1. Otherwise,
   1. Assert: state is "errored".
   1. Let storedError be stream.[[storedError]].
   1. Set writer.[[readyPromise]] to a promise rejected with storedError.
   1. Set writer.[[readyPromise]].[[PromiseIsHandled]] to true.
   1. Set writer.[[closedPromise]] to a promise rejected with storedError.
   1. Set writer.[[closedPromise]].[[PromiseIsHandled]] to true.

### WritableStreamAbort(stream, reason) → Promise

1. If stream.[[state]] is "closed" or "errored", return a promise resolved with undefined.
1. Signal abort on stream.[[controller]].[[abortController]] with reason.
1. Let state be stream.[[state]].
1. If state is "closed" or "errored", return a promise resolved with undefined.
   > Note: We re-check the state because signaling abort runs author code and that might have changed the state.
1. If stream.[[pendingAbortRequest]] is not undefined, return stream.[[pendingAbortRequest]]'s promise.
1. Assert: state is "writable" or "erroring".
1. Let wasAlreadyErroring be false.
1. If state is "erroring",
   1. Set wasAlreadyErroring to true.
   1. Set reason to undefined.
1. Let promise be a new promise.
1. Set stream.[[pendingAbortRequest]] to a new pending abort request whose promise is promise, reason is reason, and was already erroring is wasAlreadyErroring.
1. If wasAlreadyErroring is false, perform ! WritableStreamStartErroring(stream, reason).
1. Return promise.

### WritableStreamClose(stream) → Promise

1. Let state be stream.[[state]].
1. If state is "closed" or "errored", return a promise rejected with a TypeError exception.
1. Assert: state is "writable" or "erroring".
1. Assert: ! WritableStreamCloseQueuedOrInFlight(stream) is false.
1. Let promise be a new promise.
1. Set stream.[[closeRequest]] to promise.
1. Let writer be stream.[[writer]].
1. If writer is not undefined, and stream.[[backpressure]] is true, and state is "writable", resolve writer.[[readyPromise]] with undefined.
1. Perform ! WritableStreamDefaultControllerClose(stream.[[controller]]).
1. Return promise.

## Interfacing with controllers

### WritableStreamAddWriteRequest(stream) → Promise

1. Assert: ! IsWritableStreamLocked(stream) is true.
1. Assert: stream.[[state]] is "writable".
1. Let promise be a new promise.
1. Append promise to stream.[[writeRequests]].
1. Return promise.

### WritableStreamCloseQueuedOrInFlight(stream) → boolean

1. If stream.[[closeRequest]] is undefined and stream.[[inFlightCloseRequest]] is undefined, return false.
1. Return true.

### WritableStreamDealWithRejection(stream, error) → undefined

1. Let state be stream.[[state]].
1. If state is "writable",
   1. Perform ! WritableStreamStartErroring(stream, error).
   1. Return.
1. Assert: state is "erroring".
1. Perform ! WritableStreamFinishErroring(stream).

### WritableStreamFinishErroring(stream) → undefined

1. Assert: stream.[[state]] is "erroring".
1. Assert: ! WritableStreamHasOperationMarkedInFlight(stream) is false.
1. Set stream.[[state]] to "errored".
1. Perform ! stream.[[controller]].[[ErrorSteps]]().
1. Let storedError be stream.[[storedError]].
1. For each writeRequest of stream.[[writeRequests]]:
   1. Reject writeRequest with storedError.
1. Set stream.[[writeRequests]] to an empty list.
1. If stream.[[pendingAbortRequest]] is undefined,
   1. Perform ! WritableStreamRejectCloseAndClosedPromiseIfNeeded(stream).
   1. Return.
1. Let abortRequest be stream.[[pendingAbortRequest]].
1. Set stream.[[pendingAbortRequest]] to undefined.
1. If abortRequest's was already erroring is true,
   1. Reject abortRequest's promise with storedError.
   1. Perform ! WritableStreamRejectCloseAndClosedPromiseIfNeeded(stream).
   1. Return.
1. Let promise be ! stream.[[controller]].[[AbortSteps]](abortRequest's reason).
1. Upon fulfillment of promise,
   1. Resolve abortRequest's promise with undefined.
   1. Perform ! WritableStreamRejectCloseAndClosedPromiseIfNeeded(stream).
1. Upon rejection of promise with reason reason,
   1. Reject abortRequest's promise with reason.
   1. Perform ! WritableStreamRejectCloseAndClosedPromiseIfNeeded(stream).

### WritableStreamFinishInFlightClose(stream) → undefined

1. Assert: stream.[[inFlightCloseRequest]] is not undefined.
1. Resolve stream.[[inFlightCloseRequest]] with undefined.
1. Set stream.[[inFlightCloseRequest]] to undefined.
1. Let state be stream.[[state]].
1. Assert: stream.[[state]] is "writable" or "erroring".
1. If state is "erroring",
   1. Set stream.[[storedError]] to undefined.
   1. If stream.[[pendingAbortRequest]] is not undefined,
      1. Resolve stream.[[pendingAbortRequest]]'s promise with undefined.
      1. Set stream.[[pendingAbortRequest]] to undefined.
1. Set stream.[[state]] to "closed".
1. Let writer be stream.[[writer]].
1. If writer is not undefined, resolve writer.[[closedPromise]] with undefined.
1. Assert: stream.[[pendingAbortRequest]] is undefined.
1. Assert: stream.[[storedError]] is undefined.

### WritableStreamFinishInFlightCloseWithError(stream, error) → undefined

1. Assert: stream.[[inFlightCloseRequest]] is not undefined.
1. Reject stream.[[inFlightCloseRequest]] with error.
1. Set stream.[[inFlightCloseRequest]] to undefined.
1. Assert: stream.[[state]] is "writable" or "erroring".
1. If stream.[[pendingAbortRequest]] is not undefined,
   1. Reject stream.[[pendingAbortRequest]]'s promise with error.
   1. Set stream.[[pendingAbortRequest]] to undefined.
1. Perform ! WritableStreamDealWithRejection(stream, error).

### WritableStreamFinishInFlightWrite(stream) → undefined

1. Assert: stream.[[inFlightWriteRequest]] is not undefined.
1. Resolve stream.[[inFlightWriteRequest]] with undefined.
1. Set stream.[[inFlightWriteRequest]] to undefined.

### WritableStreamFinishInFlightWriteWithError(stream, error) → undefined

1. Assert: stream.[[inFlightWriteRequest]] is not undefined.
1. Reject stream.[[inFlightWriteRequest]] with error.
1. Set stream.[[inFlightWriteRequest]] to undefined.
1. Assert: stream.[[state]] is "writable" or "erroring".
1. Perform ! WritableStreamDealWithRejection(stream, error).

### WritableStreamHasOperationMarkedInFlight(stream) → boolean

1. If stream.[[inFlightWriteRequest]] is undefined and stream.[[inFlightCloseRequest]] is undefined, return false.
1. Return true.

### WritableStreamMarkCloseRequestInFlight(stream) → undefined

1. Assert: stream.[[inFlightCloseRequest]] is undefined.
1. Assert: stream.[[closeRequest]] is not undefined.
1. Set stream.[[inFlightCloseRequest]] to stream.[[closeRequest]].
1. Set stream.[[closeRequest]] to undefined.

### WritableStreamMarkFirstWriteRequestInFlight(stream) → undefined

1. Assert: stream.[[inFlightWriteRequest]] is undefined.
1. Assert: stream.[[writeRequests]] is not empty.
1. Let writeRequest be stream.[[writeRequests]][0].
1. Remove writeRequest from stream.[[writeRequests]].
1. Set stream.[[inFlightWriteRequest]] to writeRequest.

### WritableStreamRejectCloseAndClosedPromiseIfNeeded(stream) → undefined

1. Assert: stream.[[state]] is "errored".
1. If stream.[[closeRequest]] is not undefined,
   1. Assert: stream.[[inFlightCloseRequest]] is undefined.
   1. Reject stream.[[closeRequest]] with stream.[[storedError]].
   1. Set stream.[[closeRequest]] to undefined.
1. Let writer be stream.[[writer]].
1. If writer is not undefined,
   1. Reject writer.[[closedPromise]] with stream.[[storedError]].
   1. Set writer.[[closedPromise]].[[PromiseIsHandled]] to true.

### WritableStreamStartErroring(stream, reason) → undefined

1. Assert: stream.[[storedError]] is undefined.
1. Assert: stream.[[state]] is "writable".
1. Let controller be stream.[[controller]].
1. Assert: controller is not undefined.
1. Set stream.[[state]] to "erroring".
1. Set stream.[[storedError]] to reason.
1. Let writer be stream.[[writer]].
1. If writer is not undefined, perform ! WritableStreamDefaultWriterEnsureReadyPromiseRejected(writer, reason).
1. If ! WritableStreamHasOperationMarkedInFlight(stream) is false and controller.[[started]] is true, perform ! WritableStreamFinishErroring(stream).

### WritableStreamUpdateBackpressure(stream, backpressure) → undefined

1. Assert: stream.[[state]] is "writable".
1. Assert: ! WritableStreamCloseQueuedOrInFlight(stream) is false.
1. Let writer be stream.[[writer]].
1. If writer is not undefined and backpressure is not stream.[[backpressure]],
   1. If backpressure is true, set writer.[[readyPromise]] to a new promise.
   1. Otherwise,
      1. Assert: backpressure is false.
      1. Resolve writer.[[readyPromise]] with undefined.
1. Set stream.[[backpressure]] to backpressure.

## Writers

### WritableStreamDefaultWriterAbort(writer, reason) → Promise

1. Let stream be writer.[[stream]].
1. Assert: stream is not undefined.
1. Return ! WritableStreamAbort(stream, reason).

### WritableStreamDefaultWriterClose(writer) → Promise

1. Let stream be writer.[[stream]].
1. Assert: stream is not undefined.
1. Return ! WritableStreamClose(stream).

### WritableStreamDefaultWriterCloseWithErrorPropagation(writer) → Promise

1. Let stream be writer.[[stream]].
1. Assert: stream is not undefined.
1. Let state be stream.[[state]].
1. If ! WritableStreamCloseQueuedOrInFlight(stream) is true or state is "closed", return a promise resolved with undefined.
1. If state is "errored", return a promise rejected with stream.[[storedError]].
1. Assert: state is "writable" or "erroring".
1. Return ! WritableStreamDefaultWriterClose(writer).

> Note: This abstract operation helps implement the error propagation semantics of ReadableStream's pipeTo().

### WritableStreamDefaultWriterEnsureClosedPromiseRejected(writer, error) → undefined

1. If writer.[[closedPromise]].[[PromiseState]] is "pending", reject writer.[[closedPromise]] with error.
1. Otherwise, set writer.[[closedPromise]] to a promise rejected with error.
1. Set writer.[[closedPromise]].[[PromiseIsHandled]] to true.

### WritableStreamDefaultWriterEnsureReadyPromiseRejected(writer, error) → undefined

1. If writer.[[readyPromise]].[[PromiseState]] is "pending", reject writer.[[readyPromise]] with error.
1. Otherwise, set writer.[[readyPromise]] to a promise rejected with error.
1. Set writer.[[readyPromise]].[[PromiseIsHandled]] to true.

### WritableStreamDefaultWriterGetDesiredSize(writer) → Number or null

1. Let stream be writer.[[stream]].
1. Let state be stream.[[state]].
1. If state is "errored" or "erroring", return null.
1. If state is "closed", return 0.
1. Return ! WritableStreamDefaultControllerGetDesiredSize(stream.[[controller]]).

### WritableStreamDefaultWriterRelease(writer) → undefined

1. Let stream be writer.[[stream]].
1. Assert: stream is not undefined.
1. Assert: stream.[[writer]] is writer.
1. Let releasedError be a new TypeError.
1. Perform ! WritableStreamDefaultWriterEnsureReadyPromiseRejected(writer, releasedError).
1. Perform ! WritableStreamDefaultWriterEnsureClosedPromiseRejected(writer, releasedError).
1. Set stream.[[writer]] to undefined.
1. Set writer.[[stream]] to undefined.

### WritableStreamDefaultWriterWrite(writer, chunk) → Promise

1. Let stream be writer.[[stream]].
1. Assert: stream is not undefined.
1. Let controller be stream.[[controller]].
1. Let chunkSize be ! WritableStreamDefaultControllerGetChunkSize(controller, chunk).
1. If stream is not equal to writer.[[stream]], return a promise rejected with a TypeError exception.
1. Let state be stream.[[state]].
1. If state is "errored", return a promise rejected with stream.[[storedError]].
1. If ! WritableStreamCloseQueuedOrInFlight(stream) is true or state is "closed", return a promise rejected with a TypeError exception indicating that the stream is closing or closed.
1. If state is "erroring", return a promise rejected with stream.[[storedError]].
1. Assert: state is "writable".
1. Let promise be ! WritableStreamAddWriteRequest(stream).
1. Perform ! WritableStreamDefaultControllerWrite(controller, chunk, chunkSize).
1. Return promise.

## Default controllers

### SetUpWritableStreamDefaultController(stream, controller, startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm) → undefined

1. Assert: stream implements WritableStream.
1. Assert: stream.[[controller]] is undefined.
1. Set controller.[[stream]] to stream.
1. Set stream.[[controller]] to controller.
1. Perform ! ResetQueue(controller).
1. Set controller.[[abortController]] to a new AbortController.
1. Set controller.[[started]] to false.
1. Set controller.[[strategySizeAlgorithm]] to sizeAlgorithm.
1. Set controller.[[strategyHWM]] to highWaterMark.
1. Set controller.[[writeAlgorithm]] to writeAlgorithm.
1. Set controller.[[closeAlgorithm]] to closeAlgorithm.
1. Set controller.[[abortAlgorithm]] to abortAlgorithm.
1. Let backpressure be ! WritableStreamDefaultControllerGetBackpressure(controller).
1. Perform ! WritableStreamUpdateBackpressure(stream, backpressure).
1. Let startResult be the result of performing startAlgorithm. (This may throw an exception.)
1. Let startPromise be a promise resolved with startResult.
1. Upon fulfillment of startPromise,
   1. Assert: stream.[[state]] is "writable" or "erroring".
   1. Set controller.[[started]] to true.
   1. Perform ! WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller).
1. Upon rejection of startPromise with reason r,
   1. Assert: stream.[[state]] is "writable" or "erroring".
   1. Set controller.[[started]] to true.
   1. Perform ! WritableStreamDealWithRejection(stream, r).

### SetUpWritableStreamDefaultControllerFromUnderlyingSink(stream, underlyingSink, underlyingSinkDict, highWaterMark, sizeAlgorithm) → undefined

1. Let controller be a new WritableStreamDefaultController.
1. Let startAlgorithm be an algorithm that returns undefined.
1. Let writeAlgorithm be an algorithm that returns a promise resolved with undefined.
1. Let closeAlgorithm be an algorithm that returns a promise resolved with undefined.
1. Let abortAlgorithm be an algorithm that returns a promise resolved with undefined.
1. If underlyingSinkDict["start"] exists, then set startAlgorithm to an algorithm which returns the result of invoking underlyingSinkDict["start"] with argument list « controller », exception behavior "rethrow", and callback this value underlyingSink.
1. If underlyingSinkDict["write"] exists, then set writeAlgorithm to an algorithm which takes an argument chunk and returns the result of invoking underlyingSinkDict["write"] with argument list « chunk, controller » and callback this value underlyingSink.
1. If underlyingSinkDict["close"] exists, then set closeAlgorithm to an algorithm which returns the result of invoking underlyingSinkDict["close"] with argument list «» and callback this value underlyingSink.
1. If underlyingSinkDict["abort"] exists, then set abortAlgorithm to an algorithm which takes an argument reason and returns the result of invoking underlyingSinkDict["abort"] with argument list « reason » and callback this value underlyingSink.
1. Perform ? SetUpWritableStreamDefaultController(stream, controller, startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm).

### WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller) → undefined

1. Let stream be controller.[[stream]].
1. If controller.[[started]] is false, return.
1. If stream.[[inFlightWriteRequest]] is not undefined, return.
1. Let state be stream.[[state]].
1. Assert: state is not "closed" or "errored".
1. If state is "erroring",
   1. Perform ! WritableStreamFinishErroring(stream).
   1. Return.
1. If controller.[[queue]] is empty, return.
1. Let value be ! PeekQueueValue(controller).
1. If value is the close sentinel, perform ! WritableStreamDefaultControllerProcessClose(controller).
1. Otherwise, perform ! WritableStreamDefaultControllerProcessWrite(controller, value).

### WritableStreamDefaultControllerClearAlgorithms(controller) → undefined

Called once the stream is closed or errored and the algorithms will not be executed any more. By removing the algorithm references it permits the underlying sink object to be garbage collected even if the WritableStream itself is still referenced.

1. Set controller.[[writeAlgorithm]] to undefined.
1. Set controller.[[closeAlgorithm]] to undefined.
1. Set controller.[[abortAlgorithm]] to undefined.
1. Set controller.[[strategySizeAlgorithm]] to undefined.

> Note: This algorithm will be performed multiple times in some edge cases. After the first time it will do nothing.

### WritableStreamDefaultControllerClose(controller) → undefined

1. Perform ! EnqueueValueWithSize(controller, close sentinel, 0).
1. Perform ! WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller).

### WritableStreamDefaultControllerError(controller, error) → undefined

1. Let stream be controller.[[stream]].
1. Assert: stream.[[state]] is "writable".
1. Perform ! WritableStreamDefaultControllerClearAlgorithms(controller).
1. Perform ! WritableStreamStartErroring(stream, error).

### WritableStreamDefaultControllerErrorIfNeeded(controller, error) → undefined

1. If controller.[[stream]].[[state]] is "writable", perform ! WritableStreamDefaultControllerError(controller, error).

### WritableStreamDefaultControllerGetBackpressure(controller) → boolean

1. Let desiredSize be ! WritableStreamDefaultControllerGetDesiredSize(controller).
1. Return true if desiredSize ≤ 0, or false otherwise.

### WritableStreamDefaultControllerGetChunkSize(controller, chunk) → Number

1. If controller.[[strategySizeAlgorithm]] is undefined, then:
   1. Assert: controller.[[stream]].[[state]] is not "writable".
   1. Return 1.
1. Let returnValue be the result of performing controller.[[strategySizeAlgorithm]], passing in chunk, and interpreting the result as a completion record.
1. If returnValue is an abrupt completion,
   1. Perform ! WritableStreamDefaultControllerErrorIfNeeded(controller, returnValue.[[Value]]).
   1. Return 1.
1. Return returnValue.[[Value]].

### WritableStreamDefaultControllerGetDesiredSize(controller) → Number

1. Return controller.[[strategyHWM]] − controller.[[queueTotalSize]].

### WritableStreamDefaultControllerProcessClose(controller) → undefined

1. Let stream be controller.[[stream]].
1. Perform ! WritableStreamMarkCloseRequestInFlight(stream).
1. Perform ! DequeueValue(controller).
1. Assert: controller.[[queue]] is empty.
1. Let sinkClosePromise be the result of performing controller.[[closeAlgorithm]].
1. Perform ! WritableStreamDefaultControllerClearAlgorithms(controller).
1. Upon fulfillment of sinkClosePromise,
   1. Perform ! WritableStreamFinishInFlightClose(stream).
1. Upon rejection of sinkClosePromise with reason reason,
   1. Perform ! WritableStreamFinishInFlightCloseWithError(stream, reason).

### WritableStreamDefaultControllerProcessWrite(controller, chunk) → undefined

1. Let stream be controller.[[stream]].
1. Perform ! WritableStreamMarkFirstWriteRequestInFlight(stream).
1. Let sinkWritePromise be the result of performing controller.[[writeAlgorithm]], passing in chunk.
1. Upon fulfillment of sinkWritePromise,
   1. Perform ! WritableStreamFinishInFlightWrite(stream).
   1. Let state be stream.[[state]].
   1. Assert: state is "writable" or "erroring".
   1. Perform ! DequeueValue(controller).
   1. If ! WritableStreamCloseQueuedOrInFlight(stream) is false and state is "writable",
      1. Let backpressure be ! WritableStreamDefaultControllerGetBackpressure(controller).
      1. Perform ! WritableStreamUpdateBackpressure(stream, backpressure).
   1. Perform ! WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller).
1. Upon rejection of sinkWritePromise with reason,
   1. If stream.[[state]] is "writable", perform ! WritableStreamDefaultControllerClearAlgorithms(controller).
   1. Perform ! WritableStreamFinishInFlightWriteWithError(stream, reason).

### WritableStreamDefaultControllerWrite(controller, chunk, chunkSize) → undefined

1. Let enqueueResult be EnqueueValueWithSize(controller, chunk, chunkSize).
1. If enqueueResult is an abrupt completion,
   1. Perform ! WritableStreamDefaultControllerErrorIfNeeded(controller, enqueueResult.[[Value]]).
   1. Return.
1. Let stream be controller.[[stream]].
1. If ! WritableStreamCloseQueuedOrInFlight(stream) is false and stream.[[state]] is "writable",
   1. Let backpressure be ! WritableStreamDefaultControllerGetBackpressure(controller).
   1. Perform ! WritableStreamUpdateBackpressure(stream, backpressure).
1. Perform ! WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller).

## Cross-shard abstract ops referenced

Ops called in this shard but defined elsewhere in the spec (or in other specs), deduped and sorted:

- DequeueValue
- EnqueueValueWithSize
- ExtractHighWaterMark
- ExtractSizeAlgorithm
- IsNonNegativeNumber
- PeekQueueValue
- ReadableStreamPipeTo
- ResetQueue
- SetUpCrossRealmTransformReadable
- SetUpCrossRealmTransformWritable
- StructuredDeserializeWithTransfer
- StructuredSerializeWithTransfer

(Also referenced host/infra concepts: MessagePort creation and entangling, AbortController "signal abort", converting to an IDL value, invoking callbacks, promise creation/resolution/rejection, "upon fulfillment"/"upon rejection".)
