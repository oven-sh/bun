# Transform Streams, Queuing Strategies, and Supporting Abstract Operations

Transcribed from the WHATWG Streams Standard (Bikeshed source), §Transform streams, §Queuing strategies, §Supporting abstract operations.

---

## TransformStream

**Web IDL**

```webidl
[Exposed=*, Transferable]
interface TransformStream {
  constructor(optional object transformer,
              optional QueuingStrategy writableStrategy = {},
              optional QueuingStrategy readableStrategy = {});

  readonly attribute ReadableStream readable;
  readonly attribute WritableStream writable;
};
```

**Transferable?** Yes — `[Transferable]`. Transfer steps and transfer-receiving steps are given below.

**Internal slots**

| Internal Slot | Description (non-normative) |
|---|---|
| `[[backpressure]]` | Whether there was backpressure on `[[readable]]` the last time it was observed |
| `[[backpressureChangePromise]]` | A promise which is fulfilled and replaced every time the value of `[[backpressure]]` changes |
| `[[controller]]` | A TransformStreamDefaultController created with the ability to control `[[readable]]` and `[[writable]]` |
| `[[Detached]]` | A boolean flag set to true when the stream is transferred |
| `[[readable]]` | The ReadableStream instance controlled by this object |
| `[[writable]]` | The WritableStream instance controlled by this object |

### The transformer API

The `TransformStream()` constructor accepts as its first argument a JavaScript object representing the transformer. Such objects can contain any of the following methods:

```webidl
dictionary Transformer {
  TransformerStartCallback start;
  TransformerTransformCallback transform;
  TransformerFlushCallback flush;
  TransformerCancelCallback cancel;
  any readableType;
  any writableType;
};

callback TransformerStartCallback = any (TransformStreamDefaultController controller);
callback TransformerFlushCallback = Promise<undefined> (TransformStreamDefaultController controller);
callback TransformerTransformCallback = Promise<undefined> (any chunk, TransformStreamDefaultController controller);
callback TransformerCancelCallback = Promise<undefined> (any reason);
```

- **start(controller)** — A function that is called immediately during creation of the TransformStream. Typically this is used to enqueue prefix chunks, using `controller.enqueue()`. Those chunks will be read from the readable side but don't depend on any writes to the writable side. If this initial process is asynchronous, for example because it takes some effort to acquire the prefix chunks, the function can return a promise to signal success or failure; a rejected promise will error the stream. Any thrown exceptions will be re-thrown by the `TransformStream()` constructor.
- **transform(chunk, controller)** — A function called when a new chunk originally written to the writable side is ready to be transformed. The stream implementation guarantees that this function will be called only after previous transforms have succeeded, and never before `start()` has completed or after `flush()` has been called. This function performs the actual transformation work of the transform stream. It can enqueue the results using `controller.enqueue()`. This permits a single chunk written to the writable side to result in zero or multiple chunks on the readable side, depending on how many times `controller.enqueue()` is called. If the process of transforming is asynchronous, this function can return a promise to signal success or failure of the transformation. A rejected promise will error both the readable and writable sides of the transform stream. The promise potentially returned by this function is used to ensure that well-behaved producers do not attempt to mutate the chunk before it has been fully transformed. (This is not guaranteed by any specification machinery, but instead is an informal contract between producers and the transformer.) If no `transform()` method is supplied, the identity transform is used, which enqueues chunks unchanged from the writable side to the readable side.
- **flush(controller)** — A function called after all chunks written to the writable side have been transformed by successfully passing through `transform()`, and the writable side is about to be closed. Typically this is used to enqueue suffix chunks to the readable side, before that too becomes closed. If the flushing process is asynchronous, the function can return a promise to signal success or failure; the result will be communicated to the caller of `stream.writable.write()`. Additionally, a rejected promise will error both the readable and writable sides of the stream. Throwing an exception is treated the same as returning a rejected promise. (Note that there is no need to call `controller.terminate()` inside `flush()`; the stream is already in the process of successfully closing down, and terminating it would be counterproductive.)
- **cancel(reason)** — A function called when the readable side is cancelled, or when the writable side is aborted. Typically this is used to clean up underlying transformer resources when the stream is aborted or cancelled. If the cancellation process is asynchronous, the function can return a promise to signal success or failure; the result will be communicated to the caller of `stream.writable.abort()` or `stream.readable.cancel()`. Throwing an exception is treated the same as returning a rejected promise. (Note that there is no need to call `controller.terminate()` inside `cancel()`; the stream is already in the process of cancelling/aborting, and terminating it would be counterproductive.)
- **readableType** — This property is reserved for future use, so any attempts to supply a value will throw an exception.
- **writableType** — This property is reserved for future use, so any attempts to supply a value will throw an exception.

The `controller` object passed to `start()`, `transform()`, and `flush()` is an instance of TransformStreamDefaultController, and has the ability to enqueue chunks to the readable side, or to terminate or error the stream.

### Constructor: new TransformStream(transformer, writableStrategy, readableStrategy)

1. If transformer is missing, set it to null.
2. Let transformerDict be transformer, converted to an IDL value of type Transformer.
   > Note: We cannot declare the transformer argument as having the Transformer type directly, because doing so would lose the reference to the original object. We need to retain the object so we can invoke the various methods on it.
3. If transformerDict["readableType"] exists, throw a RangeError exception.
4. If transformerDict["writableType"] exists, throw a RangeError exception.
5. Let readableHighWaterMark be ? ExtractHighWaterMark(readableStrategy, 0).
6. Let readableSizeAlgorithm be ! ExtractSizeAlgorithm(readableStrategy).
7. Let writableHighWaterMark be ? ExtractHighWaterMark(writableStrategy, 1).
8. Let writableSizeAlgorithm be ! ExtractSizeAlgorithm(writableStrategy).
9. Let startPromise be a new promise.
10. Perform ! InitializeTransformStream(this, startPromise, writableHighWaterMark, writableSizeAlgorithm, readableHighWaterMark, readableSizeAlgorithm).
11. Perform ? SetUpTransformStreamDefaultControllerFromTransformer(this, transformer, transformerDict).
12. If transformerDict["start"] exists, then resolve startPromise with the result of invoking transformerDict["start"] with argument list « this.[[controller]] » and callback this value transformer.
13. Otherwise, resolve startPromise with undefined.

### readable getter

1. Return this.[[readable]].

### writable getter

1. Return this.[[writable]].

### Transfer steps (given value and dataHolder)

1. Let readable be value.[[readable]].
2. Let writable be value.[[writable]].
3. If ! IsReadableStreamLocked(readable) is true, throw a "DataCloneError" DOMException.
4. If ! IsWritableStreamLocked(writable) is true, throw a "DataCloneError" DOMException.
5. Set dataHolder.[[readable]] to ! StructuredSerializeWithTransfer(readable, « readable »).
6. Set dataHolder.[[writable]] to ! StructuredSerializeWithTransfer(writable, « writable »).

### Transfer-receiving steps (given dataHolder and value)

1. Let readableRecord be ! StructuredDeserializeWithTransfer(dataHolder.[[readable]], the current Realm).
2. Let writableRecord be ! StructuredDeserializeWithTransfer(dataHolder.[[writable]], the current Realm).
3. Set value.[[readable]] to readableRecord.[[Deserialized]].
4. Set value.[[writable]] to writableRecord.[[Deserialized]].
5. Set value.[[backpressure]], value.[[backpressureChangePromise]], and value.[[controller]] to undefined.

> Note: The [[backpressure]], [[backpressureChangePromise]], and [[controller]] slots are not used in a transferred TransformStream.

---

## TransformStreamDefaultController

**Web IDL**

```webidl
[Exposed=*]
interface TransformStreamDefaultController {
  readonly attribute unrestricted double? desiredSize;

  undefined enqueue(optional any chunk);
  undefined error(optional any reason);
  undefined terminate();
};
```

**Transferable?** No.

**Internal slots**

| Internal Slot | Description (non-normative) |
|---|---|
| `[[cancelAlgorithm]]` | A promise-returning algorithm, taking one argument (the reason for cancellation), which communicates a requested cancellation to the transformer |
| `[[finishPromise]]` | A promise which resolves on completion of either the `[[cancelAlgorithm]]` or the `[[flushAlgorithm]]`. If this field is unpopulated (that is, undefined), then neither of those algorithms have been invoked yet |
| `[[flushAlgorithm]]` | A promise-returning algorithm which communicates a requested close to the transformer |
| `[[stream]]` | The TransformStream instance controlled |
| `[[transformAlgorithm]]` | A promise-returning algorithm, taking one argument (the chunk to transform), which requests the transformer perform its transformation |

**Constructor** — There is no user-facing constructor; instances are created via SetUpTransformStreamDefaultControllerFromTransformer.

### desiredSize getter

1. Let readableController be this.[[stream]].[[readable]].[[controller]].
2. Return ! ReadableStreamDefaultControllerGetDesiredSize(readableController).

### enqueue(chunk) method

1. Perform ? TransformStreamDefaultControllerEnqueue(this, chunk).

### error(e) method

1. Perform ? TransformStreamDefaultControllerError(this, e).

### terminate() method

1. Perform ? TransformStreamDefaultControllerTerminate(this).

---

## Transform stream abstract operations

### Working with transform streams

### InitializeTransformStream(stream, startPromise, writableHighWaterMark, writableSizeAlgorithm, readableHighWaterMark, readableSizeAlgorithm) → undefined

1. Let startAlgorithm be an algorithm that returns startPromise.
2. Let writeAlgorithm be the following steps, taking a chunk argument:
   1. Return ! TransformStreamDefaultSinkWriteAlgorithm(stream, chunk).
3. Let abortAlgorithm be the following steps, taking a reason argument:
   1. Return ! TransformStreamDefaultSinkAbortAlgorithm(stream, reason).
4. Let closeAlgorithm be the following steps:
   1. Return ! TransformStreamDefaultSinkCloseAlgorithm(stream).
5. Set stream.[[writable]] to ! CreateWritableStream(startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, writableHighWaterMark, writableSizeAlgorithm).
6. Let pullAlgorithm be the following steps:
   1. Return ! TransformStreamDefaultSourcePullAlgorithm(stream).
7. Let cancelAlgorithm be the following steps, taking a reason argument:
   1. Return ! TransformStreamDefaultSourceCancelAlgorithm(stream, reason).
8. Set stream.[[readable]] to ! CreateReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm, readableHighWaterMark, readableSizeAlgorithm).
9. Set stream.[[backpressure]] and stream.[[backpressureChangePromise]] to undefined.
   > Note: The [[backpressure]] slot is set to undefined so that it can be initialized by TransformStreamSetBackpressure. Alternatively, implementations can use a strictly boolean value for [[backpressure]] and change the way it is initialized. This will not be visible to user code so long as the initialization is correctly completed before the transformer's start() method is called.
10. Perform ! TransformStreamSetBackpressure(stream, true).
11. Set stream.[[controller]] to undefined.

### TransformStreamError(stream, e) → undefined

1. Perform ! ReadableStreamDefaultControllerError(stream.[[readable]].[[controller]], e).
2. Perform ! TransformStreamErrorWritableAndUnblockWrite(stream, e).

> Note: This operation works correctly when one or both sides are already errored. As a result, calling algorithms do not need to check stream states when responding to an error condition.

### TransformStreamErrorWritableAndUnblockWrite(stream, e) → undefined

1. Perform ! TransformStreamDefaultControllerClearAlgorithms(stream.[[controller]]).
2. Perform ! WritableStreamDefaultControllerErrorIfNeeded(stream.[[writable]].[[controller]], e).
3. Perform ! TransformStreamUnblockWrite(stream).

### TransformStreamSetBackpressure(stream, backpressure) → undefined

1. Assert: stream.[[backpressure]] is not backpressure.
2. If stream.[[backpressureChangePromise]] is not undefined, resolve stream.[[backpressureChangePromise]] with undefined.
3. Set stream.[[backpressureChangePromise]] to a new promise.
4. Set stream.[[backpressure]] to backpressure.

### TransformStreamUnblockWrite(stream) → undefined

1. If stream.[[backpressure]] is true, perform ! TransformStreamSetBackpressure(stream, false).

> Note: The TransformStreamDefaultSinkWriteAlgorithm abstract operation could be waiting for the promise stored in the [[backpressureChangePromise]] slot to resolve. The call to TransformStreamSetBackpressure ensures that the promise always resolves.

### Default controllers

### SetUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm, cancelAlgorithm) → undefined

1. Assert: stream implements TransformStream.
2. Assert: stream.[[controller]] is undefined.
3. Set controller.[[stream]] to stream.
4. Set stream.[[controller]] to controller.
5. Set controller.[[transformAlgorithm]] to transformAlgorithm.
6. Set controller.[[flushAlgorithm]] to flushAlgorithm.
7. Set controller.[[cancelAlgorithm]] to cancelAlgorithm.

### SetUpTransformStreamDefaultControllerFromTransformer(stream, transformer, transformerDict) → undefined

1. Let controller be a new TransformStreamDefaultController.
2. Let transformAlgorithm be the following steps, taking a chunk argument:
   1. Let result be TransformStreamDefaultControllerEnqueue(controller, chunk).
   2. If result is an abrupt completion, return a promise rejected with result.[[Value]].
   3. Otherwise, return a promise resolved with undefined.
3. Let flushAlgorithm be an algorithm which returns a promise resolved with undefined.
4. Let cancelAlgorithm be an algorithm which returns a promise resolved with undefined.
5. If transformerDict["transform"] exists, set transformAlgorithm to an algorithm which takes an argument chunk and returns the result of invoking transformerDict["transform"] with argument list « chunk, controller » and callback this value transformer.
6. If transformerDict["flush"] exists, set flushAlgorithm to an algorithm which returns the result of invoking transformerDict["flush"] with argument list « controller » and callback this value transformer.
7. If transformerDict["cancel"] exists, set cancelAlgorithm to an algorithm which takes an argument reason and returns the result of invoking transformerDict["cancel"] with argument list « reason » and callback this value transformer.
8. Perform ! SetUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm, cancelAlgorithm).

### TransformStreamDefaultControllerClearAlgorithms(controller) → undefined

Called once the stream is closed or errored and the algorithms will not be executed any more. By removing the algorithm references it permits the transformer object to be garbage collected even if the TransformStream itself is still referenced.

> Note: This is observable using weak references. See tc39/proposal-weakrefs#31 for more detail.

1. Set controller.[[transformAlgorithm]] to undefined.
2. Set controller.[[flushAlgorithm]] to undefined.
3. Set controller.[[cancelAlgorithm]] to undefined.

### TransformStreamDefaultControllerEnqueue(controller, chunk) → undefined (throws)

1. Let stream be controller.[[stream]].
2. Let readableController be stream.[[readable]].[[controller]].
3. If ! ReadableStreamDefaultControllerCanCloseOrEnqueue(readableController) is false, throw a TypeError exception.
4. Let enqueueResult be ReadableStreamDefaultControllerEnqueue(readableController, chunk).
5. If enqueueResult is an abrupt completion,
   1. Perform ! TransformStreamErrorWritableAndUnblockWrite(stream, enqueueResult.[[Value]]).
   2. Throw stream.[[readable]].[[storedError]].
6. Let backpressure be ! ReadableStreamDefaultControllerHasBackpressure(readableController).
7. If backpressure is not stream.[[backpressure]],
   1. Assert: backpressure is true.
   2. Perform ! TransformStreamSetBackpressure(stream, true).

### TransformStreamDefaultControllerError(controller, e) → undefined

1. Perform ! TransformStreamError(controller.[[stream]], e).

### TransformStreamDefaultControllerPerformTransform(controller, chunk) → Promise

1. Let transformPromise be the result of performing controller.[[transformAlgorithm]], passing chunk.
2. Return the result of reacting to transformPromise with the following rejection steps given the argument r:
   1. Perform ! TransformStreamError(controller.[[stream]], r).
   2. Throw r.

### TransformStreamDefaultControllerTerminate(controller) → undefined

1. Let stream be controller.[[stream]].
2. Let readableController be stream.[[readable]].[[controller]].
3. Perform ! ReadableStreamDefaultControllerClose(readableController).
4. Let error be a TypeError exception indicating that the stream has been terminated.
5. Perform ! TransformStreamErrorWritableAndUnblockWrite(stream, error).

### Default sinks

### TransformStreamDefaultSinkWriteAlgorithm(stream, chunk) → Promise

1. Assert: stream.[[writable]].[[state]] is "writable".
2. Let controller be stream.[[controller]].
3. If stream.[[backpressure]] is true,
   1. Let backpressureChangePromise be stream.[[backpressureChangePromise]].
   2. Assert: backpressureChangePromise is not undefined.
   3. Return the result of reacting to backpressureChangePromise with the following fulfillment steps:
      1. Let writable be stream.[[writable]].
      2. Let state be writable.[[state]].
      3. If state is "erroring", throw writable.[[storedError]].
      4. Assert: state is "writable".
      5. Return ! TransformStreamDefaultControllerPerformTransform(controller, chunk).
4. Return ! TransformStreamDefaultControllerPerformTransform(controller, chunk).

### TransformStreamDefaultSinkAbortAlgorithm(stream, reason) → Promise

1. Let controller be stream.[[controller]].
2. If controller.[[finishPromise]] is not undefined, return controller.[[finishPromise]].
3. Let readable be stream.[[readable]].
4. Let controller.[[finishPromise]] be a new promise.
5. Let cancelPromise be the result of performing controller.[[cancelAlgorithm]], passing reason.
6. Perform ! TransformStreamDefaultControllerClearAlgorithms(controller).
7. React to cancelPromise:
   1. If cancelPromise was fulfilled, then:
      1. If readable.[[state]] is "errored", reject controller.[[finishPromise]] with readable.[[storedError]].
      2. Otherwise:
         1. Perform ! ReadableStreamDefaultControllerError(readable.[[controller]], reason).
         2. Resolve controller.[[finishPromise]] with undefined.
   2. If cancelPromise was rejected with reason r, then:
      1. Perform ! ReadableStreamDefaultControllerError(readable.[[controller]], r).
      2. Reject controller.[[finishPromise]] with r.
8. Return controller.[[finishPromise]].

### TransformStreamDefaultSinkCloseAlgorithm(stream) → Promise

1. Let controller be stream.[[controller]].
2. If controller.[[finishPromise]] is not undefined, return controller.[[finishPromise]].
3. Let readable be stream.[[readable]].
4. Let controller.[[finishPromise]] be a new promise.
5. Let flushPromise be the result of performing controller.[[flushAlgorithm]].
6. Perform ! TransformStreamDefaultControllerClearAlgorithms(controller).
7. React to flushPromise:
   1. If flushPromise was fulfilled, then:
      1. If readable.[[state]] is "errored", reject controller.[[finishPromise]] with readable.[[storedError]].
      2. Otherwise:
         1. Perform ! ReadableStreamDefaultControllerClose(readable.[[controller]]).
         2. Resolve controller.[[finishPromise]] with undefined.
   2. If flushPromise was rejected with reason r, then:
      1. Perform ! ReadableStreamDefaultControllerError(readable.[[controller]], r).
      2. Reject controller.[[finishPromise]] with r.
8. Return controller.[[finishPromise]].

### Default sources

### TransformStreamDefaultSourceCancelAlgorithm(stream, reason) → Promise

1. Let controller be stream.[[controller]].
2. If controller.[[finishPromise]] is not undefined, return controller.[[finishPromise]].
3. Let writable be stream.[[writable]].
4. Let controller.[[finishPromise]] be a new promise.
5. Let cancelPromise be the result of performing controller.[[cancelAlgorithm]], passing reason.
6. Perform ! TransformStreamDefaultControllerClearAlgorithms(controller).
7. React to cancelPromise:
   1. If cancelPromise was fulfilled, then:
      1. If writable.[[state]] is "errored", reject controller.[[finishPromise]] with writable.[[storedError]].
      2. Otherwise:
         1. Perform ! WritableStreamDefaultControllerErrorIfNeeded(writable.[[controller]], reason).
         2. Perform ! TransformStreamUnblockWrite(stream).
         3. Resolve controller.[[finishPromise]] with undefined.
   2. If cancelPromise was rejected with reason r, then:
      1. Perform ! WritableStreamDefaultControllerErrorIfNeeded(writable.[[controller]], r).
      2. Perform ! TransformStreamUnblockWrite(stream).
      3. Reject controller.[[finishPromise]] with r.
8. Return controller.[[finishPromise]].

### TransformStreamDefaultSourcePullAlgorithm(stream) → Promise

1. Assert: stream.[[backpressure]] is true.
2. Assert: stream.[[backpressureChangePromise]] is not undefined.
3. Perform ! TransformStreamSetBackpressure(stream, false).
4. Return stream.[[backpressureChangePromise]].

---

## Queuing strategies

### The queuing strategy API

The `ReadableStream()`, `WritableStream()`, and `TransformStream()` constructors all accept at least one argument representing an appropriate queuing strategy for the stream being created. Such objects contain the following properties:

```webidl
dictionary QueuingStrategy {
  unrestricted double highWaterMark;
  QueuingStrategySize size;
};

callback QueuingStrategySize = unrestricted double (any chunk);
```

- **highWaterMark** — A non-negative number indicating the high water mark of the stream using this queuing strategy.
- **size(chunk)** (non-byte streams only) — A function that computes and returns the finite non-negative size of the given chunk value. The result is used to determine backpressure, manifesting via the appropriate `desiredSize` property: either `defaultController.desiredSize`, `byteController.desiredSize`, or `writer.desiredSize`, depending on where the queuing strategy is being used. For readable streams, it also governs when the underlying source's `pull()` method is called. This function has to be idempotent and not cause side effects; very strange results can occur otherwise. For readable byte streams, this function is not used, as chunks are always measured in bytes.

Any object with these properties can be used when a queuing strategy object is expected. The two built-in queuing strategy classes (ByteLengthQueuingStrategy and CountQueuingStrategy) both make use of the following Web IDL fragment for their constructors:

```webidl
dictionary QueuingStrategyInit {
  required unrestricted double highWaterMark;
};
```

---

## ByteLengthQueuingStrategy

**Web IDL**

```webidl
[Exposed=*]
interface ByteLengthQueuingStrategy {
  constructor(QueuingStrategyInit init);

  readonly attribute unrestricted double highWaterMark;
  readonly attribute Function size;
};
```

**Transferable?** No.

**Internal slots**

| Internal Slot | Description |
|---|---|
| `[[highWaterMark]]` | Stores the value given in the constructor |

Additionally, every global object globalObject has an associated **byte length queuing strategy size function**, which is a Function whose value must be initialized as follows:

1. Let steps be the following steps, given chunk:
   1. Return ? GetV(chunk, "byteLength").
2. Let F be ! CreateBuiltinFunction(steps, 1, "size", « », globalObject's relevant Realm).
3. Set globalObject's byte length queuing strategy size function to a Function that represents a reference to F, with callback context equal to globalObject's relevant settings object.

> Note: This design is somewhat historical. It is motivated by the desire to ensure that `size` is a function, not a method, i.e. it does not check its `this` value.

### Constructor: new ByteLengthQueuingStrategy(init)

1. Set this.[[highWaterMark]] to init["highWaterMark"].

### highWaterMark getter

1. Return this.[[highWaterMark]].

### size getter

1. Return this's relevant global object's byte length queuing strategy size function.

---

## CountQueuingStrategy

**Web IDL**

```webidl
[Exposed=*]
interface CountQueuingStrategy {
  constructor(QueuingStrategyInit init);

  readonly attribute unrestricted double highWaterMark;
  readonly attribute Function size;
};
```

**Transferable?** No.

**Internal slots**

| Internal Slot | Description |
|---|---|
| `[[highWaterMark]]` | Stores the value given in the constructor |

Additionally, every global object globalObject has an associated **count queuing strategy size function**, which is a Function whose value must be initialized as follows:

1. Let steps be the following steps:
   1. Return 1.
2. Let F be ! CreateBuiltinFunction(steps, 0, "size", « », globalObject's relevant Realm).
3. Set globalObject's count queuing strategy size function to a Function that represents a reference to F, with callback context equal to globalObject's relevant settings object.

> Note: This design is somewhat historical. It is motivated by the desire to ensure that `size` is a function, not a method, i.e. it does not check its `this` value.

### Constructor: new CountQueuingStrategy(init)

1. Set this.[[highWaterMark]] to init["highWaterMark"].

### highWaterMark getter

1. Return this.[[highWaterMark]].

### size getter

1. Return this's relevant global object's count queuing strategy size function.

---

## Queuing strategy abstract operations

### ExtractHighWaterMark(strategy, defaultHWM) → Number (throws)

1. If strategy["highWaterMark"] does not exist, return defaultHWM.
2. Let highWaterMark be strategy["highWaterMark"].
3. If highWaterMark is NaN or highWaterMark < 0, throw a RangeError exception.
4. Return highWaterMark.

> Note: +∞ is explicitly allowed as a valid high water mark. It causes backpressure to never be applied.

### ExtractSizeAlgorithm(strategy) → algorithm

1. If strategy["size"] does not exist, return an algorithm that returns 1.
2. Return an algorithm that performs the following steps, taking a chunk argument:
   1. Return the result of invoking strategy["size"] with argument list « chunk ».

---

## Supporting abstract operations

### Queue-with-sizes

The streams in this specification use a "queue-with-sizes" data structure to store queued up values, along with their determined sizes. Various specification objects contain a queue-with-sizes, represented by the object having two paired internal slots, always named `[[queue]]` and `[[queueTotalSize]]`. `[[queue]]` is a list of value-with-sizes, and `[[queueTotalSize]]` is a JavaScript Number, i.e. a double-precision floating point number.

The following abstract operations are used when operating on objects that contain queues-with-sizes, in order to ensure that the two internal slots stay synchronized.

> Warning: Due to the limited precision of floating-point arithmetic, the framework specified here, of keeping a running total in the `[[queueTotalSize]]` slot, is *not* equivalent to adding up the size of all chunks in `[[queue]]`. (However, this only makes a difference when there is a huge (~10^15) variance in size between chunks, or when trillions of chunks are enqueued.)

A **value-with-size** is a struct with the two items **value** and **size**.

### DequeueValue(container) → any

1. Assert: container has [[queue]] and [[queueTotalSize]] internal slots.
2. Assert: container.[[queue]] is not empty.
3. Let valueWithSize be container.[[queue]][0].
4. Remove valueWithSize from container.[[queue]].
5. Set container.[[queueTotalSize]] to container.[[queueTotalSize]] − valueWithSize's size.
6. If container.[[queueTotalSize]] < 0, set container.[[queueTotalSize]] to 0. (This can occur due to rounding errors.)
7. Return valueWithSize's value.

### EnqueueValueWithSize(container, value, size) → undefined (throws)

1. Assert: container has [[queue]] and [[queueTotalSize]] internal slots.
2. If ! IsNonNegativeNumber(size) is false, throw a RangeError exception.
3. If size is +∞, throw a RangeError exception.
4. Append a new value-with-size with value value and size size to container.[[queue]].
5. Set container.[[queueTotalSize]] to container.[[queueTotalSize]] + size.

### PeekQueueValue(container) → any

1. Assert: container has [[queue]] and [[queueTotalSize]] internal slots.
2. Assert: container.[[queue]] is not empty.
3. Let valueWithSize be container.[[queue]][0].
4. Return valueWithSize's value.

### ResetQueue(container) → undefined

1. Assert: container has [[queue]] and [[queueTotalSize]] internal slots.
2. Set container.[[queue]] to a new empty list.
3. Set container.[[queueTotalSize]] to 0.

### Transferable streams

Transferable streams are implemented using a special kind of identity transform which has the writable side in one realm and the readable side in another realm. The following abstract operations are used to implement these "cross-realm transforms".

### CrossRealmTransformSendError(port, error) → undefined

1. Perform PackAndPostMessage(port, "error", error), discarding the result.

> Note: As we are already in an errored state when this abstract operation is performed, we cannot handle further errors, so we just discard them.

### PackAndPostMessage(port, type, value) → undefined (may be an abrupt completion)

1. Let message be OrdinaryObjectCreate(null).
2. Perform ! CreateDataProperty(message, "type", type).
3. Perform ! CreateDataProperty(message, "value", value).
4. Let targetPort be the port with which port is entangled, if any; otherwise let it be null.
5. Let options be «[ "transfer" → « » ]».
6. Run the message port post message steps providing targetPort, message, and options.

> Note: A JavaScript object is used for transfer to avoid having to duplicate the message port post message steps. The prototype of the object is set to null to avoid interference from %Object.prototype%.

### PackAndPostMessageHandlingError(port, type, value) → completion record

1. Let result be PackAndPostMessage(port, type, value).
2. If result is an abrupt completion,
   1. Perform ! CrossRealmTransformSendError(port, result.[[Value]]).
3. Return result as a completion record.

### SetUpCrossRealmTransformReadable(stream, port) → undefined

1. Perform ! InitializeReadableStream(stream).
2. Let controller be a new ReadableStreamDefaultController.
3. Add a handler for port's message event with the following steps:
   1. Let data be the data of the message.
   2. Assert: data is an Object.
   3. Let type be ! Get(data, "type").
   4. Let value be ! Get(data, "value").
   5. Assert: type is a String.
   6. If type is "chunk",
      1. Perform ! ReadableStreamDefaultControllerEnqueue(controller, value).
   7. Otherwise, if type is "close",
      1. Perform ! ReadableStreamDefaultControllerClose(controller).
      2. Disentangle port.
   8. Otherwise, if type is "error",
      1. Perform ! ReadableStreamDefaultControllerError(controller, value).
      2. Disentangle port.
4. Add a handler for port's messageerror event with the following steps:
   1. Let error be a new "DataCloneError" DOMException.
   2. Perform ! CrossRealmTransformSendError(port, error).
   3. Perform ! ReadableStreamDefaultControllerError(controller, error).
   4. Disentangle port.
5. Enable port's port message queue.
6. Let startAlgorithm be an algorithm that returns undefined.
7. Let pullAlgorithm be the following steps:
   1. Perform ! PackAndPostMessage(port, "pull", undefined).
   2. Return a promise resolved with undefined.
8. Let cancelAlgorithm be the following steps, taking a reason argument:
   1. Let result be PackAndPostMessageHandlingError(port, "error", reason).
   2. Disentangle port.
   3. If result is an abrupt completion, return a promise rejected with result.[[Value]].
   4. Otherwise, return a promise resolved with undefined.
9. Let sizeAlgorithm be an algorithm that returns 1.
10. Perform ! SetUpReadableStreamDefaultController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, 0, sizeAlgorithm).

> Note: Implementations are encouraged to explicitly handle failures from the asserts in this algorithm, as the input might come from an untrusted context. Failure to do so could lead to security issues.

### SetUpCrossRealmTransformWritable(stream, port) → undefined

1. Perform ! InitializeWritableStream(stream).
2. Let controller be a new WritableStreamDefaultController.
3. Let backpressurePromise be a new promise.
4. Add a handler for port's message event with the following steps:
   1. Let data be the data of the message.
   2. Assert: data is an Object.
   3. Let type be ! Get(data, "type").
   4. Let value be ! Get(data, "value").
   5. Assert: type is a String.
   6. If type is "pull",
      1. If backpressurePromise is not undefined,
         1. Resolve backpressurePromise with undefined.
         2. Set backpressurePromise to undefined.
   7. Otherwise, if type is "error",
      1. Perform ! WritableStreamDefaultControllerErrorIfNeeded(controller, value).
      2. If backpressurePromise is not undefined,
         1. Resolve backpressurePromise with undefined.
         2. Set backpressurePromise to undefined.
5. Add a handler for port's messageerror event with the following steps:
   1. Let error be a new "DataCloneError" DOMException.
   2. Perform ! CrossRealmTransformSendError(port, error).
   3. Perform ! WritableStreamDefaultControllerErrorIfNeeded(controller, error).
   4. Disentangle port.
6. Enable port's port message queue.
7. Let startAlgorithm be an algorithm that returns undefined.
8. Let writeAlgorithm be the following steps, taking a chunk argument:
   1. If backpressurePromise is undefined, set backpressurePromise to a promise resolved with undefined.
   2. Return the result of reacting to backpressurePromise with the following fulfillment steps:
      1. Set backpressurePromise to a new promise.
      2. Let result be PackAndPostMessageHandlingError(port, "chunk", chunk).
      3. If result is an abrupt completion,
         1. Disentangle port.
         2. Return a promise rejected with result.[[Value]].
      4. Otherwise, return a promise resolved with undefined.
9. Let closeAlgorithm be the following steps:
   1. Perform ! PackAndPostMessage(port, "close", undefined).
   2. Disentangle port.
   3. Return a promise resolved with undefined.
10. Let abortAlgorithm be the following steps, taking a reason argument:
    1. Let result be PackAndPostMessageHandlingError(port, "error", reason).
    2. Disentangle port.
    3. If result is an abrupt completion, return a promise rejected with result.[[Value]].
    4. Otherwise, return a promise resolved with undefined.
11. Let sizeAlgorithm be an algorithm that returns 1.
12. Perform ! SetUpWritableStreamDefaultController(stream, controller, startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, 1, sizeAlgorithm).

> Note: Implementations are encouraged to explicitly handle failures from the asserts in this algorithm, as the input might come from an untrusted context. Failure to do so could lead to security issues.

### Miscellaneous

### CanTransferArrayBuffer(O) → boolean

1. Assert: O is an Object.
2. Assert: O has an [[ArrayBufferData]] internal slot.
3. If ! IsDetachedBuffer(O) is true, return false.
4. If SameValue(O.[[ArrayBufferDetachKey]], undefined) is false, return false.
5. Return true.

### IsNonNegativeNumber(v) → boolean

1. If v is not a Number, return false.
2. If v is NaN, return false.
3. If v < 0, return false.
4. Return true.

### TransferArrayBuffer(O) → ArrayBuffer (throws)

1. Assert: ! IsDetachedBuffer(O) is false.
2. Let arrayBufferData be O.[[ArrayBufferData]].
3. Let arrayBufferByteLength be O.[[ArrayBufferByteLength]].
4. Perform ? DetachArrayBuffer(O).
   > Note: This will throw an exception if O has an [[ArrayBufferDetachKey]] that is not undefined, such as a WebAssembly.Memory's buffer.
5. Return a new ArrayBuffer object, created in the current Realm, whose [[ArrayBufferData]] internal slot value is arrayBufferData and whose [[ArrayBufferByteLength]] internal slot value is arrayBufferByteLength.

### CloneAsUint8Array(O) → Uint8Array (throws)

1. Assert: O is an Object.
2. Assert: O has an [[ViewedArrayBuffer]] internal slot.
3. Assert: ! IsDetachedBuffer(O.[[ViewedArrayBuffer]]) is false.
4. Let buffer be ? CloneArrayBuffer(O.[[ViewedArrayBuffer]], O.[[ByteOffset]], O.[[ByteLength]], %ArrayBuffer%).
5. Let array be ! Construct(%Uint8Array%, « buffer »).
6. Return array.

### StructuredClone(v) → any (throws)

1. Let serialized be ? StructuredSerialize(v).
2. Return ? StructuredDeserialize(serialized, the current Realm).

### CanCopyDataBlockBytes(toBuffer, toIndex, fromBuffer, fromIndex, count) → boolean

1. Assert: toBuffer is an Object.
2. Assert: toBuffer has an [[ArrayBufferData]] internal slot.
3. Assert: fromBuffer is an Object.
4. Assert: fromBuffer has an [[ArrayBufferData]] internal slot.
5. If toBuffer is fromBuffer, return false.
6. If ! IsDetachedBuffer(toBuffer) is true, return false.
7. If ! IsDetachedBuffer(fromBuffer) is true, return false.
8. If toIndex + count > toBuffer.[[ArrayBufferByteLength]], return false.
9. If fromIndex + count > fromBuffer.[[ArrayBufferByteLength]], return false.
10. Return true.

---

## Cross-shard abstract ops referenced

Abstract operations called in this shard but defined elsewhere (other shards or external specs), deduped and sorted:

- CloneArrayBuffer (ECMA-262)
- Construct (ECMA-262)
- CreateBuiltinFunction (ECMA-262)
- CreateDataProperty (ECMA-262)
- CreateReadableStream
- CreateWritableStream
- DetachArrayBuffer (ECMA-262)
- Get (ECMA-262)
- GetV (ECMA-262)
- InitializeReadableStream
- InitializeWritableStream
- IsDetachedBuffer (ECMA-262)
- IsReadableStreamLocked
- IsWritableStreamLocked
- OrdinaryObjectCreate (ECMA-262)
- ReadableStreamDefaultControllerCanCloseOrEnqueue
- ReadableStreamDefaultControllerClose
- ReadableStreamDefaultControllerEnqueue
- ReadableStreamDefaultControllerError
- ReadableStreamDefaultControllerGetDesiredSize
- ReadableStreamDefaultControllerHasBackpressure
- SameValue (ECMA-262)
- SetUpReadableStreamDefaultController
- SetUpWritableStreamDefaultController
- StructuredDeserialize (HTML)
- StructuredDeserializeWithTransfer (HTML)
- StructuredSerialize (HTML)
- StructuredSerializeWithTransfer (HTML)
- WritableStreamDefaultControllerErrorIfNeeded
