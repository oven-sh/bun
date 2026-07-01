# Internal-slot tables — verbatim extraction from specs/digest/{01,03,04}

The COMPLETE set of internal slots for every spec class, extracted from the verbatim
spec transcription. This is the ONLY digest content the Phase-A header author needs;
every C++ member list is derived from these via ARCHITECTURE.md §3. Do not re-derive
from the digests. Bun-only additional members: specs/BUN-LAYER-DESIGN.md.


## ReadableStream — internal slots
| Internal slot | Value type | Description |
|---|---|---|
| `[[controller]]` | ReadableStreamDefaultController or ReadableByteStreamController | Created with the ability to control the state and queue of this stream |
| `[[Detached]]` | boolean | Set to true when the stream is transferred |
| `[[disturbed]]` | boolean | Set to true when the stream has been read from or canceled |
| `[[reader]]` | ReadableStreamDefaultReader \| ReadableStreamBYOBReader \| undefined | The reader, if the stream is locked to a reader; undefined if not |
| `[[state]]` | string | The stream's current state: `"readable"`, `"closed"`, or `"errored"` |
| `[[storedError]]` | any | A value indicating how the stream failed; given as failure reason/exception when operating on an errored stream |


## ReadableStreamGenericReader (mixin) — internal slots
| Internal slot | Value type | Description |
|---|---|---|
| `[[closedPromise]]` | Promise | A promise returned by the reader's `closed` getter |
| `[[stream]]` | ReadableStream | The ReadableStream instance that owns this reader |


## ReadableStreamDefaultReader — internal slots
| Internal slot | Value type | Description |
|---|---|---|
| `[[readRequests]]` | list of read requests | Used when a consumer requests chunks sooner than they are available |


## ReadableStreamBYOBReader — internal slots
| Internal slot | Value type | Description |
|---|---|---|
| `[[readIntoRequests]]` | list of read-into requests | Used when a consumer requests chunks sooner than they are available |


## ReadableStreamDefaultController — internal slots
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


## ReadableByteStreamController — internal slots
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


## ReadableStreamBYOBRequest — internal slots
| Internal slot | Value type | Description |
|---|---|---|
| `[[controller]]` | ReadableByteStreamController | The parent ReadableByteStreamController instance |
| `[[view]]` | typed array or null | The destination region to which the controller can write generated data, or null after the BYOB request has been invalidated |


## WritableStream — internal slots
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


## WritableStreamDefaultWriter — internal slots
| Internal Slot | Description (non-normative) |
| --- | --- |
| `[[closedPromise]]` | A promise returned by the writer's closed getter |
| `[[readyPromise]]` | A promise returned by the writer's ready getter |
| `[[stream]]` | A WritableStream instance that owns this reader |


## WritableStreamDefaultController — internal slots
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


## TransformStream — internal slots
| Internal Slot | Description (non-normative) |
|---|---|
| `[[backpressure]]` | Whether there was backpressure on `[[readable]]` the last time it was observed |
| `[[backpressureChangePromise]]` | A promise which is fulfilled and replaced every time the value of `[[backpressure]]` changes |
| `[[controller]]` | A TransformStreamDefaultController created with the ability to control `[[readable]]` and `[[writable]]` |
| `[[Detached]]` | A boolean flag set to true when the stream is transferred |
| `[[readable]]` | The ReadableStream instance controlled by this object |
| `[[writable]]` | The WritableStream instance controlled by this object |


## TransformStreamDefaultController — internal slots
| Internal Slot | Description (non-normative) |
|---|---|
| `[[cancelAlgorithm]]` | A promise-returning algorithm, taking one argument (the reason for cancellation), which communicates a requested cancellation to the transformer |
| `[[finishPromise]]` | A promise which resolves on completion of either the `[[cancelAlgorithm]]` or the `[[flushAlgorithm]]`. If this field is unpopulated (that is, undefined), then neither of those algorithms have been invoked yet |
| `[[flushAlgorithm]]` | A promise-returning algorithm which communicates a requested close to the transformer |
| `[[stream]]` | The TransformStream instance controlled |
| `[[transformAlgorithm]]` | A promise-returning algorithm, taking one argument (the chunk to transform), which requests the transformer perform its transformation |


## ByteLengthQueuingStrategy — internal slots
| Internal Slot | Description |
|---|---|
| `[[highWaterMark]]` | Stores the value given in the constructor |


## CountQueuingStrategy — internal slots
| Internal Slot | Description |
|---|---|
| `[[highWaterMark]]` | Stores the value given in the constructor |

