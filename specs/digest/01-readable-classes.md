# Readable stream classes (WHATWG Streams §Model, §Conventions, §4 Readable streams — classes)

## Model & Conventions

### Chunks
A **chunk** is a single piece of data that is written to or read from a stream. It can be of any
type; streams can even contain chunks of different types. A chunk will often not be the most atomic
unit of data for a given stream (e.g. a byte stream might contain 16 KiB Uint8Array chunks).

### Readable streams
- A **readable stream** represents a source of data; it is an instance of the ReadableStream class.
- Most readable streams wrap a lower-level I/O source, the **underlying source**. Two kinds:
  - **push source**: pushes data at you whether or not you are listening; may provide a mechanism
    for pausing/resuming flow.
  - **pull source**: requires you to request data from it.
- Chunks are enqueued into the stream by the underlying source and read via a **readable stream
  reader** acquired with `getReader()`.
- Code reading a readable stream via its public interface is a **consumer**.
- Consumers can **cancel** a readable stream (`cancel()`): signals loss of interest, immediately
  closes the stream, throws away queued chunks, and runs the underlying source's cancellation
  mechanism.
- Consumers can **tee** a readable stream (`tee()`): locks the stream and creates two new streams
  (**branches**) that can be consumed independently.
- The underlying source of a byte-optimized readable stream is an **underlying byte source**; such a
  stream is a **readable byte stream**. Consumers of a readable byte stream can acquire a **BYOB
  reader** via `getReader({ mode: "byob" })`.

### Writable streams (context)
A **writable stream** (WritableStream) is a destination for data, wrapping an **underlying sink**.
The code writing into it is a **producer**. Producers can **abort** a writable stream via `abort()`,
putting the stream in an errored state and discarding all writes in its internal queue.

### Transform streams (context)
A **transform stream** is a pair: a **writable side** (WritableStream) and a **readable side**
(ReadableStream). Writes to the writable side result in new data readable from the readable side.
An **identity transform stream** forwards all chunks unchanged.

### Pipe chains and backpressure
- Streams are primarily used by **piping** them to each other (`pipeTo()`, `pipeThrough()`).
- A set of streams piped together is a **pipe chain**; the **original source** is the underlying
  source of the first readable stream, the **ultimate sink** is the underlying sink of the final
  writable stream.
- **Backpressure**: the process of normalizing flow from the original source according to how fast
  the chain can process chunks. Concretely, the original source is given
  `controller.desiredSize` / `byteController.desiredSize`, derived from `writer.desiredSize`
  corresponding to the ultimate sink.
- When teeing, backpressure signals from the two branches aggregate: only if neither branch is read
  from is a backpressure signal sent to the original stream's underlying source.
- Piping **locks** the readable and writable streams for the duration of the pipe.

### Internal queues and queuing strategies
- Both readable and writable streams maintain **internal queues**. For readable streams, the queue
  contains chunks enqueued by the underlying source but not yet read by the consumer.
- A **queuing strategy** determines how a stream signals backpressure based on its internal queue.
  It assigns a size to each chunk and compares the total size of all chunks in the queue to the
  **high water mark**. The difference, high water mark minus total size, is the
  **desired size to fill the stream's internal queue** ("desired size").
- An underlying source should use desired size as a backpressure signal, trying to keep it at or
  above zero.
- Concretely, a queuing strategy is any JavaScript object with a `highWaterMark` property. For byte
  streams `highWaterMark` always has units of bytes. For other streams the default unit is chunks,
  but a `size()` function can be included that returns the size for a given chunk.

### Locking
- A **readable stream reader** (reader) allows direct reading of chunks from a readable stream. A
  readable byte stream can vend two types of readers: **default readers**
  (ReadableStreamDefaultReader) and **BYOB readers** (ReadableStreamBYOBReader). A non-byte
  readable stream can only vend default readers.
- A given readable (or writable) stream has at most one reader (or writer) at a time; the stream is
  then **locked** and the reader/writer is **active**. Observable via `readableStream.locked`.
- A reader can **release its lock** (`releaseLock()`), making it no longer active and allowing
  further readers to be acquired.

### State machine
`ReadableStream.[[state]]` is one of `"readable"`, `"closed"`, or `"errored"`.
(Writable streams additionally have `"erroring"`; that is out of this shard's scope.)
- **disturbed**: `[[disturbed]]` is a boolean flag set to true once the stream has been read from or
  canceled.
- **errored**: `[[state]]` is `"errored"`; `[[storedError]]` holds the failure value used as the
  rejection/exception for further operations.

### Conventions (normative)
- The spec uses ECMAScript **abstract operations**, treating return values as completion records,
  with `!` (assert-no-abrupt-completion) and `?` (propagate abrupt completion / ReturnIfAbrupt)
  prefixes.
- The spec uses **internal slot** notation `[[name]]`, but on Web IDL platform objects.
- All numbers are double-precision 64-bit IEEE 754 floating point values (JavaScript Number / Web
  IDL `unrestricted double`), and all arithmetic on them must be done in the standard way for such
  values. This is particularly important for the queue-with-sizes data structure.

---

## ReadableStream

- **Web IDL**:

```webidl
[Exposed=*, Transferable]
interface ReadableStream {
  constructor(optional object underlyingSource, optional QueuingStrategy strategy = {});

  static ReadableStream from(any asyncIterable);

  readonly attribute boolean locked;

  Promise<undefined> cancel(optional any reason);
  ReadableStreamReader getReader(optional ReadableStreamGetReaderOptions options = {});
  ReadableStream pipeThrough(ReadableWritablePair transform, optional StreamPipeOptions options = {});
  Promise<undefined> pipeTo(WritableStream destination, optional StreamPipeOptions options = {});
  sequence<ReadableStream> tee();

  async_iterable<any>(optional ReadableStreamIteratorOptions options = {});
};

typedef (ReadableStreamDefaultReader or ReadableStreamBYOBReader) ReadableStreamReader;

enum ReadableStreamReaderMode { "byob" };

dictionary ReadableStreamGetReaderOptions {
  ReadableStreamReaderMode mode;
};

dictionary ReadableStreamIteratorOptions {
  boolean preventCancel = false;
};

dictionary ReadableWritablePair {
  required ReadableStream readable;
  required WritableStream writable;
};

dictionary StreamPipeOptions {
  boolean preventClose = false;
  boolean preventAbort = false;
  boolean preventCancel = false;
  AbortSignal signal;
};
```

- **Transferable?**: yes (`[Transferable]`).

### Internal slots

| Internal slot | Value type | Description |
|---|---|---|
| `[[controller]]` | ReadableStreamDefaultController or ReadableByteStreamController | Created with the ability to control the state and queue of this stream |
| `[[Detached]]` | boolean | Set to true when the stream is transferred |
| `[[disturbed]]` | boolean | Set to true when the stream has been read from or canceled |
| `[[reader]]` | ReadableStreamDefaultReader \| ReadableStreamBYOBReader \| undefined | The reader, if the stream is locked to a reader; undefined if not |
| `[[state]]` | string | The stream's current state: `"readable"`, `"closed"`, or `"errored"` |
| `[[storedError]]` | any | A value indicating how the stream failed; given as failure reason/exception when operating on an errored stream |

### The underlying source API

The `ReadableStream()` constructor accepts as its first argument a JavaScript object representing
the underlying source. Such objects can contain any of the following properties:

```webidl
dictionary UnderlyingSource {
  UnderlyingSourceStartCallback start;
  UnderlyingSourcePullCallback pull;
  UnderlyingSourceCancelCallback cancel;
  ReadableStreamType type;
  [EnforceRange] unsigned long long autoAllocateChunkSize;
};

typedef (ReadableStreamDefaultController or ReadableByteStreamController) ReadableStreamController;

callback UnderlyingSourceStartCallback = any (ReadableStreamController controller);
callback UnderlyingSourcePullCallback = Promise<undefined> (ReadableStreamController controller);
callback UnderlyingSourceCancelCallback = Promise<undefined> (optional any reason);

enum ReadableStreamType { "bytes" };
```

- **`start(controller)`** — `UnderlyingSourceStartCallback`, returns `any`.
  A function that is called immediately during creation of the ReadableStream. If this setup
  process is asynchronous, it can return a promise to signal success or failure; a rejected promise
  will error the stream. Any thrown exceptions will be re-thrown by the `ReadableStream()`
  constructor.

- **`pull(controller)`** — `UnderlyingSourcePullCallback`, returns `Promise<undefined>`.
  A function that is called whenever the stream's internal queue of chunks becomes not full, i.e.
  whenever the queue's desired size becomes positive. Generally, it will be called repeatedly until
  the queue reaches its high water mark (i.e. until the desired size becomes non-positive).
  This function will not be called until `start()` successfully completes. Additionally, it will
  only be called repeatedly if it enqueues at least one chunk or fulfills a BYOB request; a no-op
  `pull()` implementation will not be continually called.
  If the function returns a promise, then it will not be called again until that promise fulfills.
  (If the promise rejects, the stream will become errored.) Throwing an exception is treated the
  same as returning a rejected promise.

- **`cancel(reason)`** — `UnderlyingSourceCancelCallback`, returns `Promise<undefined>`.
  A function that is called whenever the consumer cancels the stream, via `stream.cancel()` or
  `reader.cancel()`. It takes as its argument the same value as was passed to those methods by the
  consumer. Readable streams can additionally be canceled under certain conditions during piping
  (see `pipeTo()`).
  If the shutdown process is asynchronous, it can return a promise to signal success or failure;
  the result is communicated via the return value of the `cancel()` method that was called.
  Throwing an exception is treated the same as returning a rejected promise.
  Even if the cancelation process fails, the stream still closes; it is not put into an errored
  state — the failure is only communicated to the immediate caller of the corresponding method.

- **`type`** (byte streams only) — `ReadableStreamType`.
  Can be set to `"bytes"` to signal that the constructed ReadableStream is a readable byte stream.
  This ensures the resulting ReadableStream can vend BYOB readers via `getReader()`. It also
  affects the `controller` argument passed to `start()` and `pull()`. Setting any value other than
  `"bytes"` or undefined causes the `ReadableStream()` constructor to throw an exception.

- **`autoAllocateChunkSize`** (byte streams only) — `[EnforceRange] unsigned long long`.
  Can be set to a positive integer to cause the implementation to automatically allocate buffers
  for the underlying source code to write into. In this case, when a consumer is using a default
  reader, the stream implementation will automatically allocate an ArrayBuffer of the given size,
  so that `controller.byobRequest` is always present, as if the consumer was using a BYOB reader.

The type of the `controller` argument passed to the `start()` and `pull()` methods depends on the
value of the `type` option. If `type` is set to undefined (including via omission), then
`controller` will be a ReadableStreamDefaultController. If it's set to `"bytes"`, then `controller`
will be a ReadableByteStreamController.

### Constructor

`new ReadableStream(underlyingSource, strategy)` constructor steps:

1. If underlyingSource is missing, set it to null.
1. Let underlyingSourceDict be underlyingSource, converted to an IDL value of type
   UnderlyingSource.
   > Note: We cannot declare the underlyingSource argument as having the UnderlyingSource type
   > directly, because doing so would lose the reference to the original object. We need to retain
   > the object so we can invoke the various methods on it.
1. Perform ! InitializeReadableStream(this).
1. If underlyingSourceDict["type"] is "bytes":
   1. If strategy["size"] exists, throw a RangeError exception.
   1. Let highWaterMark be ? ExtractHighWaterMark(strategy, 0).
   1. Perform ? SetUpReadableByteStreamControllerFromUnderlyingSource(this, underlyingSource,
      underlyingSourceDict, highWaterMark).
1. Otherwise,
   1. Assert: underlyingSourceDict["type"] does not exist.
   1. Let sizeAlgorithm be ! ExtractSizeAlgorithm(strategy).
   1. Let highWaterMark be ? ExtractHighWaterMark(strategy, 1).
   1. Perform ? SetUpReadableStreamDefaultControllerFromUnderlyingSource(this, underlyingSource,
      underlyingSourceDict, highWaterMark, sizeAlgorithm).

### static from(asyncIterable)

The static `from(asyncIterable)` method steps are:

1. Return ? ReadableStreamFromIterable(asyncIterable).

### get locked

The `locked` getter steps are:

1. Return ! IsReadableStreamLocked(this).

### cancel(reason)

The `cancel(reason)` method steps are:

1. If ! IsReadableStreamLocked(this) is true, return a promise rejected with a TypeError
   exception.
1. Return ! ReadableStreamCancel(this, reason).

### getReader(options)

The `getReader(options)` method steps are:

1. If options["mode"] does not exist, return ? AcquireReadableStreamDefaultReader(this).
1. Assert: options["mode"] is "byob".
1. Return ? AcquireReadableStreamBYOBReader(this).

### pipeThrough(transform, options)

The `pipeThrough(transform, options)` method steps are:

1. If ! IsReadableStreamLocked(this) is true, throw a TypeError exception.
1. If ! IsWritableStreamLocked(transform["writable"]) is true, throw a TypeError exception.
1. Let signal be options["signal"] if it exists, or undefined otherwise.
1. Let promise be ! ReadableStreamPipeTo(this, transform["writable"], options["preventClose"],
   options["preventAbort"], options["preventCancel"], signal).
1. Set promise.[[PromiseIsHandled]] to true.
1. Return transform["readable"].

### pipeTo(destination, options)

The `pipeTo(destination, options)` method steps are:

1. If ! IsReadableStreamLocked(this) is true, return a promise rejected with a TypeError
   exception.
1. If ! IsWritableStreamLocked(destination) is true, return a promise rejected with a TypeError
   exception.
1. Let signal be options["signal"] if it exists, or undefined otherwise.
1. Return ! ReadableStreamPipeTo(this, destination, options["preventClose"],
   options["preventAbort"], options["preventCancel"], signal).

### tee()

The `tee()` method steps are:

1. Return ? ReadableStreamTee(this, false).

### Asynchronous iteration (`values()` / `[Symbol.asyncIterator]`)

The interface declares `async_iterable<any>(optional ReadableStreamIteratorOptions options = {})`.
Per Web IDL this defines a `values(options)` method and `[Symbol.asyncIterator]` (aliased to
`values`), backed by the following per-class hooks.

**Asynchronous iterator initialization steps**, given stream, iterator, and args:

1. Let reader be ? AcquireReadableStreamDefaultReader(stream).
1. Set iterator's **reader** to reader.
1. Let preventCancel be args[0]["preventCancel"].
1. Set iterator's **prevent cancel** to preventCancel.

**Get the next iteration result** steps, given stream and iterator:

1. Let reader be iterator's reader.
1. Assert: reader.[[stream]] is not undefined.
1. Let promise be a new promise.
1. Let readRequest be a new read request with the following items:
   - chunk steps, given chunk:
     1. Resolve promise with chunk.
   - close steps:
     1. Perform ! ReadableStreamDefaultReaderRelease(reader).
     1. Resolve promise with end of iteration.
   - error steps, given e:
     1. Perform ! ReadableStreamDefaultReaderRelease(reader).
     1. Reject promise with e.
1. Perform ! ReadableStreamDefaultReaderRead(this, readRequest).
1. Return promise.

**Asynchronous iterator return** steps, given stream, iterator, and arg:

1. Let reader be iterator's reader.
1. Assert: reader.[[stream]] is not undefined.
1. Assert: reader.[[readRequests]] is empty, as the async iterator machinery guarantees that any
   previous calls to `next()` have settled before this is called.
1. If iterator's prevent cancel is false:
   1. Let result be ! ReadableStreamReaderGenericCancel(reader, arg).
   1. Perform ! ReadableStreamDefaultReaderRelease(reader).
   1. Return result.
1. Perform ! ReadableStreamDefaultReaderRelease(reader).
1. Return a promise resolved with undefined.

### Transfer via `postMessage()`

ReadableStream objects are transferable objects.

**Transfer steps**, given value and dataHolder:

1. If ! IsReadableStreamLocked(value) is true, throw a "DataCloneError" DOMException.
1. Let port1 be a new MessagePort in the current Realm.
1. Let port2 be a new MessagePort in the current Realm.
1. Entangle port1 and port2.
1. Let writable be a new WritableStream in the current Realm.
1. Perform ! SetUpCrossRealmTransformWritable(writable, port1).
1. Let promise be ! ReadableStreamPipeTo(value, writable, false, false, false).
1. Set promise.[[PromiseIsHandled]] to true.
1. Set dataHolder.[[port]] to ! StructuredSerializeWithTransfer(port2, « port2 »).

**Transfer-receiving steps**, given dataHolder and value:

1. Let deserializedRecord be ! StructuredDeserializeWithTransfer(dataHolder.[[port]],
   the current Realm).
1. Let port be deserializedRecord.[[Deserialized]].
1. Perform ! SetUpCrossRealmTransformReadable(value, port).

---

## ReadableStreamGenericReader (mixin)

The ReadableStreamGenericReader mixin defines common internal slots, getters and methods that are
shared between ReadableStreamDefaultReader and ReadableStreamBYOBReader objects.

- **Web IDL**:

```webidl
interface mixin ReadableStreamGenericReader {
  readonly attribute Promise<undefined> closed;

  Promise<undefined> cancel(optional any reason);
};
```

- **Transferable?**: no (mixin; not a platform object on its own).

### Internal slots

| Internal slot | Value type | Description |
|---|---|---|
| `[[closedPromise]]` | Promise | A promise returned by the reader's `closed` getter |
| `[[stream]]` | ReadableStream | The ReadableStream instance that owns this reader |

### get closed

The `closed` getter steps are:

1. Return this.[[closedPromise]].

### cancel(reason)

The `cancel(reason)` method steps are:

1. If this.[[stream]] is undefined, return a promise rejected with a TypeError exception.
1. Return ! ReadableStreamReaderGenericCancel(this, reason).

---

## ReadableStreamDefaultReader

- **Web IDL**:

```webidl
[Exposed=*]
interface ReadableStreamDefaultReader {
  constructor(ReadableStream stream);

  Promise<ReadableStreamReadResult> read();
  undefined releaseLock();
};
ReadableStreamDefaultReader includes ReadableStreamGenericReader;

dictionary ReadableStreamReadResult {
  any value;
  boolean done;
};
```

- **Transferable?**: no.

### Internal slots

Instances have the internal slots defined by ReadableStreamGenericReader (`[[closedPromise]]`,
`[[stream]]`), plus:

| Internal slot | Value type | Description |
|---|---|---|
| `[[readRequests]]` | list of read requests | Used when a consumer requests chunks sooner than they are available |

### The read request struct

A **read request** is a struct containing three algorithms to perform in reaction to filling the
readable stream's internal queue or changing its state. It has the following items:

- **chunk steps**: an algorithm taking a chunk, called when a chunk is available for reading.
- **close steps**: an algorithm taking no arguments, called when no chunks are available because
  the stream is closed.
- **error steps**: an algorithm taking a JavaScript value, called when no chunks are available
  because the stream is errored.

### Constructor

`new ReadableStreamDefaultReader(stream)` constructor steps:

1. Perform ? SetUpReadableStreamDefaultReader(this, stream).

### read()

The `read()` method steps are:

1. If this.[[stream]] is undefined, return a promise rejected with a TypeError exception.
1. Let promise be a new promise.
1. Let readRequest be a new read request with the following items:
   - chunk steps, given chunk:
     1. Resolve promise with «[ "value" → chunk, "done" → false ]».
   - close steps:
     1. Resolve promise with «[ "value" → undefined, "done" → true ]».
   - error steps, given e:
     1. Reject promise with e.
1. Perform ! ReadableStreamDefaultReaderRead(this, readRequest).
1. Return promise.

### releaseLock()

The `releaseLock()` method steps are:

1. If this.[[stream]] is undefined, return.
1. Perform ! ReadableStreamDefaultReaderRelease(this).

(Also inherits `closed` and `cancel(reason)` from ReadableStreamGenericReader.)

---

## ReadableStreamBYOBReader

- **Web IDL**:

```webidl
[Exposed=*]
interface ReadableStreamBYOBReader {
  constructor(ReadableStream stream);

  Promise<ReadableStreamReadResult> read(ArrayBufferView view, optional ReadableStreamBYOBReaderReadOptions options = {});
  undefined releaseLock();
};
ReadableStreamBYOBReader includes ReadableStreamGenericReader;

dictionary ReadableStreamBYOBReaderReadOptions {
  [EnforceRange] unsigned long long min = 1;
};
```

- **Transferable?**: no.

### Internal slots

Instances have the internal slots defined by ReadableStreamGenericReader (`[[closedPromise]]`,
`[[stream]]`), plus:

| Internal slot | Value type | Description |
|---|---|---|
| `[[readIntoRequests]]` | list of read-into requests | Used when a consumer requests chunks sooner than they are available |

### The read-into request struct

A **read-into request** is a struct containing three algorithms to perform in reaction to filling
the readable byte stream's internal queue or changing its state. It has the following items:

- **chunk steps**: an algorithm taking a chunk, called when a chunk is available for reading.
- **close steps**: an algorithm taking a chunk or undefined, called when no chunks are available
  because the stream is closed.
- **error steps**: an algorithm taking a JavaScript value, called when no chunks are available
  because the stream is errored.

> The close steps take a chunk so that the backing memory can be returned to the caller if
> possible. `byobReader.read(chunk)` fulfills with `{ value: newViewOnSameMemory, done: true }` for
> closed streams. If the stream is canceled, the backing memory is discarded and it fulfills with
> `{ value: undefined, done: true }` instead.

### Constructor

`new ReadableStreamBYOBReader(stream)` constructor steps:

1. Perform ? SetUpReadableStreamBYOBReader(this, stream).

### read(view, options)

The `read(view, options)` method steps are:

1. If view.[[ByteLength]] is 0, return a promise rejected with a TypeError exception.
1. If view.[[ViewedArrayBuffer]].[[ByteLength]] is 0, return a promise rejected with a TypeError
   exception.
1. If ! IsDetachedBuffer(view.[[ViewedArrayBuffer]]) is true, return a promise rejected with a
   TypeError exception.
1. If options["min"] is 0, return a promise rejected with a TypeError exception.
1. If view has a [[TypedArrayName]] internal slot,
   1. If options["min"] > view.[[ArrayLength]], return a promise rejected with a RangeError
      exception.
1. Otherwise (i.e., it is a DataView),
   1. If options["min"] > view.[[ByteLength]], return a promise rejected with a RangeError
      exception.
1. If this.[[stream]] is undefined, return a promise rejected with a TypeError exception.
1. Let promise be a new promise.
1. Let readIntoRequest be a new read-into request with the following items:
   - chunk steps, given chunk:
     1. Resolve promise with «[ "value" → chunk, "done" → false ]».
   - close steps, given chunk:
     1. Resolve promise with «[ "value" → chunk, "done" → true ]».
   - error steps, given e:
     1. Reject promise with e.
1. Perform ! ReadableStreamBYOBReaderRead(this, view, options["min"], readIntoRequest).
1. Return promise.

### releaseLock()

The `releaseLock()` method steps are:

1. If this.[[stream]] is undefined, return.
1. Perform ! ReadableStreamBYOBReaderRelease(this).

(Also inherits `closed` and `cancel(reason)` from ReadableStreamGenericReader.)

---

## ReadableStreamDefaultController

- **Web IDL**:

```webidl
[Exposed=*]
interface ReadableStreamDefaultController {
  readonly attribute unrestricted double? desiredSize;

  undefined close();
  undefined enqueue(optional any chunk);
  undefined error(optional any e);
};
```

- **Transferable?**: no.
- **Constructor**: none exposed (no public constructor; instances are created only by the stream
  setup abstract operations).

### Internal slots

| Internal slot | Value type | Description |
|---|---|---|
| `[[cancelAlgorithm]]` | promise-returning algorithm (1 arg: cancel reason) | Communicates a requested cancelation to the underlying source |
| `[[closeRequested]]` | boolean | Whether the stream has been closed by its underlying source, but still has chunks in its internal queue that have not yet been read |
| `[[pullAgain]]` | boolean | True if the stream's mechanisms requested a call to the underlying source's pull algorithm to pull more data, but the pull could not yet be done since a previous call is still executing |
| `[[pullAlgorithm]]` | promise-returning algorithm | Pulls data from the underlying source |
| `[[pulling]]` | boolean | True while the underlying source's pull algorithm is executing and the returned promise has not yet fulfilled; used to prevent reentrant calls |
| `[[queue]]` | list | The stream's internal queue of chunks |
| `[[queueTotalSize]]` | number | The total size of all the chunks stored in `[[queue]]` (see queue-with-sizes) |
| `[[started]]` | boolean | Whether the underlying source has finished starting |
| `[[strategyHWM]]` | number | Supplied to the constructor as part of the stream's queuing strategy; the point at which the stream will apply backpressure to its underlying source |
| `[[strategySizeAlgorithm]]` | algorithm | Calculates the size of enqueued chunks, as part of the stream's queuing strategy |
| `[[stream]]` | ReadableStream | The ReadableStream instance controlled |

### get desiredSize

The `desiredSize` getter steps are:

1. Return ! ReadableStreamDefaultControllerGetDesiredSize(this).

### close()

The `close()` method steps are:

1. If ! ReadableStreamDefaultControllerCanCloseOrEnqueue(this) is false, throw a TypeError
   exception.
1. Perform ! ReadableStreamDefaultControllerClose(this).

### enqueue(chunk)

The `enqueue(chunk)` method steps are:

1. If ! ReadableStreamDefaultControllerCanCloseOrEnqueue(this) is false, throw a TypeError
   exception.
1. Perform ? ReadableStreamDefaultControllerEnqueue(this, chunk).

### error(e)

The `error(e)` method steps are:

1. Perform ! ReadableStreamDefaultControllerError(this, e).

### Internal methods

These are internal methods implemented by each ReadableStreamDefaultController instance. The
readable stream implementation polymorphically calls either these or their BYOB-controller
counterparts.

**`[[CancelSteps]](reason)`** — implements the `[[CancelSteps]]` contract:

1. Perform ! ResetQueue(this).
1. Let result be the result of performing this.[[cancelAlgorithm]], passing reason.
1. Perform ! ReadableStreamDefaultControllerClearAlgorithms(this).
1. Return result.

**`[[PullSteps]](readRequest)`** — implements the `[[PullSteps]]` contract:

1. Let stream be this.[[stream]].
1. If this.[[queue]] is not empty,
   1. Let chunk be ! DequeueValue(this).
   1. If this.[[closeRequested]] is true and this.[[queue]] is empty,
      1. Perform ! ReadableStreamDefaultControllerClearAlgorithms(this).
      1. Perform ! ReadableStreamClose(stream).
   1. Otherwise, perform ! ReadableStreamDefaultControllerCallPullIfNeeded(this).
   1. Perform readRequest's chunk steps, given chunk.
1. Otherwise,
   1. Perform ! ReadableStreamAddReadRequest(stream, readRequest).
   1. Perform ! ReadableStreamDefaultControllerCallPullIfNeeded(this).

**`[[ReleaseSteps]]()`** — implements the `[[ReleaseSteps]]` contract:

1. Return.

---

## ReadableByteStreamController

- **Web IDL**:

```webidl
[Exposed=*]
interface ReadableByteStreamController {
  readonly attribute ReadableStreamBYOBRequest? byobRequest;
  readonly attribute unrestricted double? desiredSize;

  undefined close();
  undefined enqueue(ArrayBufferView chunk);
  undefined error(optional any e);
};
```

- **Transferable?**: no.
- **Constructor**: none exposed.

### Internal slots

| Internal slot | Value type | Description |
|---|---|---|
| `[[autoAllocateChunkSize]]` | positive integer or undefined | When automatic buffer allocation is enabled, the size of buffer to allocate; undefined otherwise |
| `[[byobRequest]]` | ReadableStreamBYOBRequest or null | The current BYOB pull request, or null if there are no pending requests |
| `[[cancelAlgorithm]]` | promise-returning algorithm (1 arg: cancel reason) | Communicates a requested cancelation to the underlying byte source |
| `[[closeRequested]]` | boolean | Whether the stream has been closed by its underlying byte source, but still has chunks in its internal queue that have not yet been read |
| `[[pullAgain]]` | boolean | True if the stream's mechanisms requested a call to the underlying byte source's pull algorithm to pull more data, but the pull could not yet be done since a previous call is still executing |
| `[[pullAlgorithm]]` | promise-returning algorithm | Pulls data from the underlying byte source |
| `[[pulling]]` | boolean | True while the underlying byte source's pull algorithm is executing and the returned promise has not yet fulfilled; used to prevent reentrant calls |
| `[[pendingPullIntos]]` | list of pull-into descriptors | Pending BYOB pull requests |
| `[[queue]]` | list of readable byte stream queue entries | The stream's internal queue of chunks |
| `[[queueTotalSize]]` | number | The total size, in bytes, of all the chunks stored in `[[queue]]` (see queue-with-sizes) |
| `[[started]]` | boolean | Whether the underlying byte source has finished starting |
| `[[strategyHWM]]` | number | Supplied to the constructor as part of the stream's queuing strategy; the point at which the stream will apply backpressure to its underlying byte source |
| `[[stream]]` | ReadableStream | The ReadableStream instance controlled |

> Note: although ReadableByteStreamController instances have `[[queue]]` and `[[queueTotalSize]]`
> slots, most of the queue-with-sizes abstract operations are NOT used on them; the two slots are
> updated together manually.

### The readable byte stream queue entry struct

A **readable byte stream queue entry** is a struct encapsulating the important aspects of a chunk
for the specific case of readable byte streams. Items:

- **buffer**: an ArrayBuffer, which will be a transferred version of the one originally supplied by
  the underlying byte source
- **byte offset**: a nonnegative integer number giving the byte offset derived from the view
  originally supplied by the underlying byte source
- **byte length**: a nonnegative integer number giving the byte length derived from the view
  originally supplied by the underlying byte source

### The pull-into descriptor struct

A **pull-into descriptor** is a struct used to represent pending BYOB pull requests. Items:

- **buffer**: an ArrayBuffer
- **buffer byte length**: a positive integer representing the initial byte length of buffer
- **byte offset**: a nonnegative integer byte offset into the buffer where the underlying byte
  source will start writing
- **byte length**: a positive integer number of bytes which can be written into the buffer
- **bytes filled**: a nonnegative integer number of bytes that have been written into the buffer so
  far
- **minimum fill**: a positive integer representing the minimum number of bytes that must be written
  into the buffer before the associated `read()` request may be fulfilled. By default, this equals
  the element size.
- **element size**: a positive integer representing the number of bytes that can be written into the
  buffer at a time, using views of the type described by the view constructor
- **view constructor**: a typed array constructor or %DataView%, which will be used for constructing
  a view with which to write into the buffer
- **reader type**: either "`default`" or "`byob`", indicating what type of readable stream reader
  initiated this request, or "`none`" if the initiating reader was released

### get byobRequest

The `byobRequest` getter steps are:

1. Return ! ReadableByteStreamControllerGetBYOBRequest(this).

### get desiredSize

The `desiredSize` getter steps are:

1. Return ! ReadableByteStreamControllerGetDesiredSize(this).

### close()

The `close()` method steps are:

1. If this.[[closeRequested]] is true, throw a TypeError exception.
1. If this.[[stream]].[[state]] is not "`readable`", throw a TypeError exception.
1. Perform ? ReadableByteStreamControllerClose(this).

### enqueue(chunk)

The `enqueue(chunk)` method steps are:

1. If chunk.[[ByteLength]] is 0, throw a TypeError exception.
1. If chunk.[[ViewedArrayBuffer]].[[ByteLength]] is 0, throw a TypeError exception.
1. If this.[[closeRequested]] is true, throw a TypeError exception.
1. If this.[[stream]].[[state]] is not "`readable`", throw a TypeError exception.
1. Return ? ReadableByteStreamControllerEnqueue(this, chunk).

### error(e)

The `error(e)` method steps are:

1. Perform ! ReadableByteStreamControllerError(this, e).

### Internal methods

**`[[CancelSteps]](reason)`** — implements the `[[CancelSteps]]` contract:

1. Perform ! ReadableByteStreamControllerClearPendingPullIntos(this).
1. Perform ! ResetQueue(this).
1. Let result be the result of performing this.[[cancelAlgorithm]], passing in reason.
1. Perform ! ReadableByteStreamControllerClearAlgorithms(this).
1. Return result.

**`[[PullSteps]](readRequest)`** — implements the `[[PullSteps]]` contract:

1. Let stream be this.[[stream]].
1. Assert: ! ReadableStreamHasDefaultReader(stream) is true.
1. If this.[[queueTotalSize]] > 0,
   1. Assert: ! ReadableStreamGetNumReadRequests(stream) is 0.
   1. Perform ! ReadableByteStreamControllerFillReadRequestFromQueue(this, readRequest).
   1. Return.
1. Let autoAllocateChunkSize be this.[[autoAllocateChunkSize]].
1. If autoAllocateChunkSize is not undefined,
   1. Let buffer be Construct(%ArrayBuffer%, « autoAllocateChunkSize »).
   1. If buffer is an abrupt completion,
      1. Perform readRequest's error steps, given buffer.[[Value]].
      1. Return.
   1. Let pullIntoDescriptor be a new pull-into descriptor with
      - buffer: buffer.[[Value]]
      - buffer byte length: autoAllocateChunkSize
      - byte offset: 0
      - byte length: autoAllocateChunkSize
      - bytes filled: 0
      - minimum fill: 1
      - element size: 1
      - view constructor: %Uint8Array%
      - reader type: "`default`"
   1. Append pullIntoDescriptor to this.[[pendingPullIntos]].
1. Perform ! ReadableStreamAddReadRequest(stream, readRequest).
1. Perform ! ReadableByteStreamControllerCallPullIfNeeded(this).

**`[[ReleaseSteps]]()`** — implements the `[[ReleaseSteps]]` contract:

1. If this.[[pendingPullIntos]] is not empty,
   1. Let firstPendingPullInto be this.[[pendingPullIntos]][0].
   1. Set firstPendingPullInto's reader type to "`none`".
   1. Set this.[[pendingPullIntos]] to the list « firstPendingPullInto ».

---

## ReadableStreamBYOBRequest

- **Web IDL**:

```webidl
[Exposed=*]
interface ReadableStreamBYOBRequest {
  readonly attribute Uint8Array? view;

  undefined respond([EnforceRange] unsigned long long bytesWritten);
  undefined respondWithNewView(ArrayBufferView view);
};
```

- **Transferable?**: no.
- **Constructor**: none exposed.

### Internal slots

| Internal slot | Value type | Description |
|---|---|---|
| `[[controller]]` | ReadableByteStreamController | The parent ReadableByteStreamController instance |
| `[[view]]` | typed array or null | The destination region to which the controller can write generated data, or null after the BYOB request has been invalidated |

### get view

The `view` getter steps are:

1. Return this.[[view]].

### respond(bytesWritten)

The `respond(bytesWritten)` method steps are:

1. If this.[[controller]] is undefined, throw a TypeError exception.
1. If ! IsDetachedBuffer(this.[[view]].[[ArrayBuffer]]) is true, throw a TypeError exception.
1. Assert: this.[[view]].[[ByteLength]] > 0.
1. Assert: this.[[view]].[[ViewedArrayBuffer]].[[ByteLength]] > 0.
1. Perform ? ReadableByteStreamControllerRespond(this.[[controller]], bytesWritten).

### respondWithNewView(view)

The `respondWithNewView(view)` method steps are:

1. If this.[[controller]] is undefined, throw a TypeError exception.
1. If ! IsDetachedBuffer(view.[[ViewedArrayBuffer]]) is true, throw a TypeError exception.
1. Return ? ReadableByteStreamControllerRespondWithNewView(this.[[controller]], view).

---

## Cross-shard abstract ops referenced

Streams-spec abstract operations called by this shard's algorithms but defined elsewhere
(in §Abstract operations or other shards):

- AcquireReadableStreamBYOBReader
- AcquireReadableStreamDefaultReader
- DequeueValue
- ExtractHighWaterMark
- ExtractSizeAlgorithm
- InitializeReadableStream
- IsReadableStreamLocked
- IsWritableStreamLocked
- ReadableByteStreamControllerCallPullIfNeeded
- ReadableByteStreamControllerClearAlgorithms
- ReadableByteStreamControllerClearPendingPullIntos
- ReadableByteStreamControllerClose
- ReadableByteStreamControllerEnqueue
- ReadableByteStreamControllerError
- ReadableByteStreamControllerFillReadRequestFromQueue
- ReadableByteStreamControllerGetBYOBRequest
- ReadableByteStreamControllerGetDesiredSize
- ReadableByteStreamControllerRespond
- ReadableByteStreamControllerRespondWithNewView
- ReadableStreamAddReadRequest
- ReadableStreamBYOBReaderRead
- ReadableStreamBYOBReaderRelease
- ReadableStreamCancel
- ReadableStreamClose
- ReadableStreamDefaultControllerCallPullIfNeeded
- ReadableStreamDefaultControllerCanCloseOrEnqueue
- ReadableStreamDefaultControllerClearAlgorithms
- ReadableStreamDefaultControllerClose
- ReadableStreamDefaultControllerEnqueue
- ReadableStreamDefaultControllerError
- ReadableStreamDefaultControllerGetDesiredSize
- ReadableStreamDefaultReaderRead
- ReadableStreamDefaultReaderRelease
- ReadableStreamFromIterable
- ReadableStreamGetNumReadRequests
- ReadableStreamHasDefaultReader
- ReadableStreamPipeTo
- ReadableStreamReaderGenericCancel
- ReadableStreamTee
- ResetQueue
- SetUpCrossRealmTransformReadable
- SetUpCrossRealmTransformWritable
- SetUpReadableByteStreamControllerFromUnderlyingSource
- SetUpReadableStreamBYOBReader
- SetUpReadableStreamDefaultControllerFromUnderlyingSource
- SetUpReadableStreamDefaultReader

External (ECMAScript / HTML) abstract ops referenced: Construct, IsDetachedBuffer,
StructuredSerializeWithTransfer, StructuredDeserializeWithTransfer.
