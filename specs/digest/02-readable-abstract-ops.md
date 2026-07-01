# Readable streams — Abstract operations

Transcribed from the WHATWG Streams Standard, §"Abstract operations" for readable streams
(working with readable streams; interfacing with controllers; readers; default controllers;
byte stream controllers).

Notation: `[[SlotName]]` are internal slots. A `!` prefix on an abstract-op call asserts the call
never returns an abrupt completion; a `?` prefix propagates abrupt completions.

## Structures

### read request
A **read request** is a struct containing three algorithms to perform in reaction to filling the
readable stream's internal queue or changing its state. It has the following items:

- **chunk steps**: An algorithm taking a chunk, called when a chunk is available for reading
- **close steps**: An algorithm taking no arguments, called when no chunks are available because the
  stream is closed
- **error steps**: An algorithm taking a JavaScript value, called when no chunks are available
  because the stream is errored

### read-into request
A **read-into request** is a struct containing three algorithms to perform in reaction to filling
the readable byte stream's internal queue or changing its state. It has the following items:

- **chunk steps**: An algorithm taking a chunk, called when a chunk is available for reading
- **close steps**: An algorithm taking a chunk or undefined, called when no chunks are available
  because the stream is closed
- **error steps**: An algorithm taking a JavaScript value, called when no chunks are available
  because the stream is errored

Note: the read-into request's close steps take a chunk so that it can return the backing memory to
the caller.

### readable byte stream queue entry
A **readable byte stream queue entry** is a struct encapsulating the important aspects of a chunk
for the specific case of readable byte streams. It has the following items:

- **buffer**: An ArrayBuffer, which will be a transferred version of the one originally supplied by
  the underlying byte source
- **byte offset**: A nonnegative integer number giving the byte offset derived from the view
  originally supplied by the underlying byte source
- **byte length**: A nonnegative integer number giving the byte length derived from the view
  originally supplied by the underlying byte source

### pull-into descriptor
A **pull-into descriptor** is a struct used to represent pending BYOB pull requests. It has the
following items:

- **buffer**: An ArrayBuffer
- **buffer byte length**: A positive integer representing the initial byte length of buffer
- **byte offset**: A nonnegative integer byte offset into the buffer where the underlying byte
  source will start writing
- **byte length**: A positive integer number of bytes which can be written into the buffer
- **bytes filled**: A nonnegative integer number of bytes that have been written into the buffer so
  far
- **minimum fill**: A positive integer representing the minimum number of bytes that must be written
  into the buffer before the associated `read()` request may be fulfilled. By default, this equals
  the element size.
- **element size**: A positive integer representing the number of bytes that can be written into the
  buffer at a time, using views of the type described by the view constructor
- **view constructor**: A typed array constructor or %DataView%, which will be used for constructing
  a view with which to write into the buffer
- **reader type**: Either "`default`" or "`byob`", indicating what type of readable stream reader
  initiated this request, or "`none`" if the initiating reader was released

## Working with readable streams

### AcquireReadableStreamBYOBReader(stream) → ReadableStreamBYOBReader
1. Let reader be a new ReadableStreamBYOBReader.
2. Perform ? SetUpReadableStreamBYOBReader(reader, stream).
3. Return reader.

### AcquireReadableStreamDefaultReader(stream) → ReadableStreamDefaultReader
1. Let reader be a new ReadableStreamDefaultReader.
2. Perform ? SetUpReadableStreamDefaultReader(reader, stream).
3. Return reader.

### CreateReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm[, highWaterMark[, sizeAlgorithm]]) → ReadableStream
1. If highWaterMark was not passed, set it to 1.
2. If sizeAlgorithm was not passed, set it to an algorithm that returns 1.
3. Assert: ! IsNonNegativeNumber(highWaterMark) is true.
4. Let stream be a new ReadableStream.
5. Perform ! InitializeReadableStream(stream).
6. Let controller be a new ReadableStreamDefaultController.
7. Perform ? SetUpReadableStreamDefaultController(stream, controller, startAlgorithm,
   pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm).
8. Return stream.

Note: This abstract operation will throw an exception if and only if the supplied startAlgorithm
throws.

### CreateReadableByteStream(startAlgorithm, pullAlgorithm, cancelAlgorithm) → ReadableStream
1. Let stream be a new ReadableStream.
2. Perform ! InitializeReadableStream(stream).
3. Let controller be a new ReadableByteStreamController.
4. Perform ? SetUpReadableByteStreamController(stream, controller, startAlgorithm, pullAlgorithm,
   cancelAlgorithm, 0, undefined).
5. Return stream.

Note: This abstract operation will throw an exception if and only if the supplied startAlgorithm
throws.

### InitializeReadableStream(stream) → undefined
1. Set stream.[[state]] to "`readable`".
2. Set stream.[[reader]] and stream.[[storedError]] to undefined.
3. Set stream.[[disturbed]] to false.

### IsReadableStreamLocked(stream) → boolean
1. If stream.[[reader]] is undefined, return false.
2. Return true.

### ReadableStreamFromIterable(asyncIterable) → ReadableStream
1. Let stream be undefined.
2. Let iteratorRecord be ? GetIterator(asyncIterable, async).
3. Let startAlgorithm be an algorithm that returns undefined.
4. Let pullAlgorithm be the following steps:
   1. Let nextResult be IteratorNext(iteratorRecord).
   2. If nextResult is an abrupt completion, return a promise rejected with nextResult.[[Value]].
   3. Let nextPromise be a promise resolved with nextResult.[[Value]].
   4. Return the result of reacting to nextPromise with the following fulfillment steps, given
      iterResult:
      1. If iterResult is not an Object, throw a TypeError.
      2. Let done be ? IteratorComplete(iterResult).
      3. If done is true:
         1. Perform ! ReadableStreamDefaultControllerClose(stream.[[controller]]).
      4. Otherwise:
         1. Let value be ? IteratorValue(iterResult).
         2. Perform ! ReadableStreamDefaultControllerEnqueue(stream.[[controller]], value).
5. Let cancelAlgorithm be the following steps, given reason:
   1. Let iterator be iteratorRecord.[[Iterator]].
   2. Let returnMethod be GetMethod(iterator, "`return`").
   3. If returnMethod is an abrupt completion, return a promise rejected with
      returnMethod.[[Value]].
   4. If returnMethod.[[Value]] is undefined, return a promise resolved with undefined.
   5. Let returnResult be Call(returnMethod.[[Value]], iterator, « reason »).
   6. If returnResult is an abrupt completion, return a promise rejected with
      returnResult.[[Value]].
   7. Let returnPromise be a promise resolved with returnResult.[[Value]].
   8. Return the result of reacting to returnPromise with the following fulfillment steps, given
      iterResult:
      1. If iterResult is not an Object, throw a TypeError.
      2. Return undefined.
6. Set stream to ! CreateReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm, 0).
7. Return stream.

### ReadableStreamPipeTo(source, dest, preventClose, preventAbort, preventCancel[, signal]) → Promise<undefined>
1. Assert: source implements ReadableStream.
2. Assert: dest implements WritableStream.
3. Assert: preventClose, preventAbort, and preventCancel are all booleans.
4. If signal was not given, let signal be undefined.
5. Assert: either signal is undefined, or signal implements AbortSignal.
6. Assert: ! IsReadableStreamLocked(source) is false.
7. Assert: ! IsWritableStreamLocked(dest) is false.
8. If source.[[controller]] implements ReadableByteStreamController, let reader be either
   ! AcquireReadableStreamBYOBReader(source) or ! AcquireReadableStreamDefaultReader(source), at
   the user agent's discretion.
9. Otherwise, let reader be ! AcquireReadableStreamDefaultReader(source).
10. Let writer be ! AcquireWritableStreamDefaultWriter(dest).
11. Set source.[[disturbed]] to true.
12. Let shuttingDown be false.
13. Let promise be a new promise.
14. If signal is not undefined,
    1. Let abortAlgorithm be the following steps:
       1. Let error be signal's abort reason.
       2. Let actions be an empty ordered set.
       3. If preventAbort is false, append the following action to actions:
          1. If dest.[[state]] is "`writable`", return ! WritableStreamAbort(dest, error).
          2. Otherwise, return a promise resolved with undefined.
       4. If preventCancel is false, append the following action to actions:
          1. If source.[[state]] is "`readable`", return ! ReadableStreamCancel(source, error).
          2. Otherwise, return a promise resolved with undefined.
       5. Shutdown with an action consisting of getting a promise to wait for all of the actions in
          actions, and with error.
    2. If signal is aborted, perform abortAlgorithm and return promise.
    3. Add abortAlgorithm to signal.
15. In parallel, using reader and writer, read all chunks from source and write them to dest. Due
    to the locking provided by the reader and writer, the exact manner in which this happens is not
    observable to author code, and so there is flexibility in how this is done. The following
    constraints apply regardless of the exact algorithm used:
    - **Public API must not be used:** while reading or writing, or performing any of the
      operations below, the JavaScript-modifiable reader, writer, and stream APIs (i.e. methods on
      the appropriate prototypes) must not be used. Instead, the streams must be manipulated
      directly.
    - **Backpressure must be enforced:**
      - While WritableStreamDefaultWriterGetDesiredSize(writer) is ≤ 0 or is null, the user agent
        must not read from reader.
      - If reader is a BYOB reader, WritableStreamDefaultWriterGetDesiredSize(writer) should be
        used as a basis to determine the size of the chunks read from reader.
        (Note: It's frequently inefficient to read chunks that are too small or too large. Other
        information might be factored in to determine the optimal chunk size.)
      - Reads or writes should not be delayed for reasons other than these backpressure signals.
        (Example: An implementation that waits for each write to successfully complete before
        proceeding to the next read/write operation violates this recommendation. In doing so,
        such an implementation makes the internal queue of dest useless, as it ensures dest always
        contains at most one queued chunk.)
    - **Shutdown must stop activity:** if shuttingDown becomes true, the user agent must not
      initiate further reads from reader, and must only perform writes of already-read chunks, as
      described below. In particular, the user agent must check the below conditions before
      performing any reads or writes, since they might lead to immediate shutdown.
    - **Error and close states must be propagated:** the following conditions must be applied in
      order.
      1. **Errors must be propagated forward:** if source.[[state]] is or becomes "`errored`",
         then
         1. If preventAbort is false, shutdown with an action of
            ! WritableStreamAbort(dest, source.[[storedError]]) and with source.[[storedError]].
         2. Otherwise, shutdown with source.[[storedError]].
      2. **Errors must be propagated backward:** if dest.[[state]] is or becomes "`errored`", then
         1. If preventCancel is false, shutdown with an action of
            ! ReadableStreamCancel(source, dest.[[storedError]]) and with dest.[[storedError]].
         2. Otherwise, shutdown with dest.[[storedError]].
      3. **Closing must be propagated forward:** if source.[[state]] is or becomes "`closed`",
         then
         1. If preventClose is false, shutdown with an action of
            ! WritableStreamDefaultWriterCloseWithErrorPropagation(writer).
         2. Otherwise, shutdown.
      4. **Closing must be propagated backward:** if
         ! WritableStreamCloseQueuedOrInFlight(dest) is true or dest.[[state]] is "`closed`",
         then
         1. Assert: no chunks have been read or written.
         2. Let destClosed be a new TypeError.
         3. If preventCancel is false, shutdown with an action of
            ! ReadableStreamCancel(source, destClosed) and with destClosed.
         4. Otherwise, shutdown with destClosed.
    - ***Shutdown with an action***: if any of the above requirements ask to shutdown with an
      action action, optionally with an error originalError, then:
      1. If shuttingDown is true, abort these substeps.
      2. Set shuttingDown to true.
      3. If dest.[[state]] is "`writable`" and ! WritableStreamCloseQueuedOrInFlight(dest) is
         false,
         1. If any chunks have been read but not yet written, write them to dest.
         2. Wait until every chunk that has been read has been written (i.e. the corresponding
            promises have settled).
      4. Let p be the result of performing action.
      5. Upon fulfillment of p, finalize, passing along originalError if it was given.
      6. Upon rejection of p with reason newError, finalize with newError.
    - ***Shutdown***: if any of the above requirements or steps ask to shutdown, optionally with an
      error error, then:
      1. If shuttingDown is true, abort these substeps.
      2. Set shuttingDown to true.
      3. If dest.[[state]] is "`writable`" and ! WritableStreamCloseQueuedOrInFlight(dest) is
         false,
         1. If any chunks have been read but not yet written, write them to dest.
         2. Wait until every chunk that has been read has been written (i.e. the corresponding
            promises have settled).
      4. Finalize, passing along error if it was given.
    - ***Finalize***: both forms of shutdown will eventually ask to finalize, optionally with an
      error error, which means to perform the following steps:
      1. Perform ! WritableStreamDefaultWriterRelease(writer).
      2. If reader implements ReadableStreamBYOBReader, perform
         ! ReadableStreamBYOBReaderRelease(reader).
      3. Otherwise, perform ! ReadableStreamDefaultReaderRelease(reader).
      4. If signal is not undefined, remove abortAlgorithm from signal.
      5. If error was given, reject promise with error.
      6. Otherwise, resolve promise with undefined.
16. Return promise.

Note: Various abstract operations performed here include object creation (often of promises), which
usually would require specifying a realm for the created object. However, because of the locking,
none of these objects can be observed by author code. As such, the realm used to create them does
not matter.

### ReadableStreamTee(stream, cloneForBranch2) → « ReadableStream, ReadableStream »
ReadableStreamTee will tee a given readable stream.

The second argument, cloneForBranch2, governs whether or not the data from the original stream will
be cloned (using HTML's serializable objects framework) before appearing in the second of the
returned branches. This is useful for scenarios where both branches are to be consumed in such a way
that they might otherwise interfere with each other, such as by transferring their chunks. However,
it does introduce a noticeable asymmetry between the two branches, and limits the possible chunks to
serializable ones.

If stream is a readable byte stream, then cloneForBranch2 is ignored and chunks are cloned
unconditionally.

Note: In this standard ReadableStreamTee is always called with cloneForBranch2 set to false; other
specifications pass true via the tee wrapper algorithm.

It performs the following steps:

1. Assert: stream implements ReadableStream.
2. Assert: cloneForBranch2 is a boolean.
3. If stream.[[controller]] implements ReadableByteStreamController, return
   ? ReadableByteStreamTee(stream).
4. Return ? ReadableStreamDefaultTee(stream, cloneForBranch2).

### ReadableStreamDefaultTee(stream, cloneForBranch2) → « ReadableStream, ReadableStream »
1. Assert: stream implements ReadableStream.
2. Assert: cloneForBranch2 is a boolean.
3. Let reader be ? AcquireReadableStreamDefaultReader(stream).
4. Let reading be false.
5. Let readAgain be false.
6. Let canceled1 be false.
7. Let canceled2 be false.
8. Let reason1 be undefined.
9. Let reason2 be undefined.
10. Let branch1 be undefined.
11. Let branch2 be undefined.
12. Let cancelPromise be a new promise.
13. Let pullAlgorithm be the following steps:
    1. If reading is true,
       1. Set readAgain to true.
       2. Return a promise resolved with undefined.
    2. Set reading to true.
    3. Let readRequest be a read request with the following items:
       - **chunk steps**, given chunk:
         1. Queue a microtask to perform the following steps:
            1. Set readAgain to false.
            2. Let chunk1 and chunk2 be chunk.
            3. If canceled2 is false and cloneForBranch2 is true,
               1. Let cloneResult be StructuredClone(chunk2).
               2. If cloneResult is an abrupt completion,
                  1. Perform ! ReadableStreamDefaultControllerError(branch1.[[controller]],
                     cloneResult.[[Value]]).
                  2. Perform ! ReadableStreamDefaultControllerError(branch2.[[controller]],
                     cloneResult.[[Value]]).
                  3. Resolve cancelPromise with ! ReadableStreamCancel(stream,
                     cloneResult.[[Value]]).
                  4. Return.
               3. Otherwise, set chunk2 to cloneResult.[[Value]].
            4. If canceled1 is false, perform
               ! ReadableStreamDefaultControllerEnqueue(branch1.[[controller]], chunk1).
            5. If canceled2 is false, perform
               ! ReadableStreamDefaultControllerEnqueue(branch2.[[controller]], chunk2).
            6. Set reading to false.
            7. If readAgain is true, perform pullAlgorithm.

         Note: The microtask delay here is necessary because it takes at least a microtask to
         detect errors, when we use reader.[[closedPromise]] below. We want errors in stream to
         error both branches immediately, so we cannot let successful synchronously-available reads
         happen ahead of asynchronously-available errors.
       - **close steps**:
         1. Set reading to false.
         2. If canceled1 is false, perform
            ! ReadableStreamDefaultControllerClose(branch1.[[controller]]).
         3. If canceled2 is false, perform
            ! ReadableStreamDefaultControllerClose(branch2.[[controller]]).
         4. If canceled1 is false or canceled2 is false, resolve cancelPromise with undefined.
       - **error steps**:
         1. Set reading to false.
    4. Perform ! ReadableStreamDefaultReaderRead(reader, readRequest).
    5. Return a promise resolved with undefined.
14. Let cancel1Algorithm be the following steps, taking a reason argument:
    1. Set canceled1 to true.
    2. Set reason1 to reason.
    3. If canceled2 is true,
       1. Let compositeReason be ! CreateArrayFromList(« reason1, reason2 »).
       2. Let cancelResult be ! ReadableStreamCancel(stream, compositeReason).
       3. Resolve cancelPromise with cancelResult.
    4. Return cancelPromise.
15. Let cancel2Algorithm be the following steps, taking a reason argument:
    1. Set canceled2 to true.
    2. Set reason2 to reason.
    3. If canceled1 is true,
       1. Let compositeReason be ! CreateArrayFromList(« reason1, reason2 »).
       2. Let cancelResult be ! ReadableStreamCancel(stream, compositeReason).
       3. Resolve cancelPromise with cancelResult.
    4. Return cancelPromise.
16. Let startAlgorithm be an algorithm that returns undefined.
17. Set branch1 to ! CreateReadableStream(startAlgorithm, pullAlgorithm, cancel1Algorithm).
18. Set branch2 to ! CreateReadableStream(startAlgorithm, pullAlgorithm, cancel2Algorithm).
19. Upon rejection of reader.[[closedPromise]] with reason r,
    1. Perform ! ReadableStreamDefaultControllerError(branch1.[[controller]], r).
    2. Perform ! ReadableStreamDefaultControllerError(branch2.[[controller]], r).
    3. If canceled1 is false or canceled2 is false, resolve cancelPromise with undefined.
20. Return « branch1, branch2 ».

### ReadableByteStreamTee(stream) → « ReadableStream, ReadableStream »
1. Assert: stream implements ReadableStream.
2. Assert: stream.[[controller]] implements ReadableByteStreamController.
3. Let reader be ? AcquireReadableStreamDefaultReader(stream).
4. Let reading be false.
5. Let readAgainForBranch1 be false.
6. Let readAgainForBranch2 be false.
7. Let canceled1 be false.
8. Let canceled2 be false.
9. Let reason1 be undefined.
10. Let reason2 be undefined.
11. Let branch1 be undefined.
12. Let branch2 be undefined.
13. Let cancelPromise be a new promise.
14. Let forwardReaderError be the following steps, taking a thisReader argument:
    1. Upon rejection of thisReader.[[closedPromise]] with reason r,
       1. If thisReader is not reader, return.
       2. Perform ! ReadableByteStreamControllerError(branch1.[[controller]], r).
       3. Perform ! ReadableByteStreamControllerError(branch2.[[controller]], r).
       4. If canceled1 is false or canceled2 is false, resolve cancelPromise with undefined.
15. Let pullWithDefaultReader be the following steps:
    1. If reader implements ReadableStreamBYOBReader,
       1. Assert: reader.[[readIntoRequests]] is empty.
       2. Perform ! ReadableStreamBYOBReaderRelease(reader).
       3. Set reader to ! AcquireReadableStreamDefaultReader(stream).
       4. Perform forwardReaderError, given reader.
    2. Let readRequest be a read request with the following items:
       - **chunk steps**, given chunk:
         1. Queue a microtask to perform the following steps:
            1. Set readAgainForBranch1 to false.
            2. Set readAgainForBranch2 to false.
            3. Let chunk1 and chunk2 be chunk.
            4. If canceled1 is false and canceled2 is false,
               1. Let cloneResult be CloneAsUint8Array(chunk).
               2. If cloneResult is an abrupt completion,
                  1. Perform ! ReadableByteStreamControllerError(branch1.[[controller]],
                     cloneResult.[[Value]]).
                  2. Perform ! ReadableByteStreamControllerError(branch2.[[controller]],
                     cloneResult.[[Value]]).
                  3. Resolve cancelPromise with ! ReadableStreamCancel(stream,
                     cloneResult.[[Value]]).
                  4. Return.
               3. Otherwise, set chunk2 to cloneResult.[[Value]].
            5. If canceled1 is false, perform
               ! ReadableByteStreamControllerEnqueue(branch1.[[controller]], chunk1).
            6. If canceled2 is false, perform
               ! ReadableByteStreamControllerEnqueue(branch2.[[controller]], chunk2).
            7. Set reading to false.
            8. If readAgainForBranch1 is true, perform pull1Algorithm.
            9. Otherwise, if readAgainForBranch2 is true, perform pull2Algorithm.

         Note: The microtask delay here is necessary because it takes at least a microtask to
         detect errors, when we use reader.[[closedPromise]] below. We want errors in stream to
         error both branches immediately, so we cannot let successful synchronously-available reads
         happen ahead of asynchronously-available errors.
       - **close steps**:
         1. Set reading to false.
         2. If canceled1 is false, perform
            ! ReadableByteStreamControllerClose(branch1.[[controller]]).
         3. If canceled2 is false, perform
            ! ReadableByteStreamControllerClose(branch2.[[controller]]).
         4. If branch1.[[controller]].[[pendingPullIntos]] is not empty, perform
            ! ReadableByteStreamControllerRespond(branch1.[[controller]], 0).
         5. If branch2.[[controller]].[[pendingPullIntos]] is not empty, perform
            ! ReadableByteStreamControllerRespond(branch2.[[controller]], 0).
         6. If canceled1 is false or canceled2 is false, resolve cancelPromise with undefined.
       - **error steps**:
         1. Set reading to false.
    3. Perform ! ReadableStreamDefaultReaderRead(reader, readRequest).
16. Let pullWithBYOBReader be the following steps, given view and forBranch2:
    1. If reader implements ReadableStreamDefaultReader,
       1. Assert: reader.[[readRequests]] is empty.
       2. Perform ! ReadableStreamDefaultReaderRelease(reader).
       3. Set reader to ! AcquireReadableStreamBYOBReader(stream).
       4. Perform forwardReaderError, given reader.
    2. Let byobBranch be branch2 if forBranch2 is true, and branch1 otherwise.
    3. Let otherBranch be branch2 if forBranch2 is false, and branch1 otherwise.
    4. Let readIntoRequest be a read-into request with the following items:
       - **chunk steps**, given chunk:
         1. Queue a microtask to perform the following steps:
            1. Set readAgainForBranch1 to false.
            2. Set readAgainForBranch2 to false.
            3. Let byobCanceled be canceled2 if forBranch2 is true, and canceled1 otherwise.
            4. Let otherCanceled be canceled2 if forBranch2 is false, and canceled1 otherwise.
            5. If otherCanceled is false,
               1. Let cloneResult be CloneAsUint8Array(chunk).
               2. If cloneResult is an abrupt completion,
                  1. Perform ! ReadableByteStreamControllerError(byobBranch.[[controller]],
                     cloneResult.[[Value]]).
                  2. Perform ! ReadableByteStreamControllerError(otherBranch.[[controller]],
                     cloneResult.[[Value]]).
                  3. Resolve cancelPromise with ! ReadableStreamCancel(stream,
                     cloneResult.[[Value]]).
                  4. Return.
               3. Otherwise, let clonedChunk be cloneResult.[[Value]].
               4. If byobCanceled is false, perform
                  ! ReadableByteStreamControllerRespondWithNewView(byobBranch.[[controller]],
                  chunk).
               5. Perform ! ReadableByteStreamControllerEnqueue(otherBranch.[[controller]],
                  clonedChunk).
            6. Otherwise, if byobCanceled is false, perform
               ! ReadableByteStreamControllerRespondWithNewView(byobBranch.[[controller]], chunk).
            7. Set reading to false.
            8. If readAgainForBranch1 is true, perform pull1Algorithm.
            9. Otherwise, if readAgainForBranch2 is true, perform pull2Algorithm.

         Note: The microtask delay here is necessary because it takes at least a microtask to
         detect errors, when we use reader.[[closedPromise]] below. We want errors in stream to
         error both branches immediately, so we cannot let successful synchronously-available reads
         happen ahead of asynchronously-available errors.
       - **close steps**, given chunk:
         1. Set reading to false.
         2. Let byobCanceled be canceled2 if forBranch2 is true, and canceled1 otherwise.
         3. Let otherCanceled be canceled2 if forBranch2 is false, and canceled1 otherwise.
         4. If byobCanceled is false, perform
            ! ReadableByteStreamControllerClose(byobBranch.[[controller]]).
         5. If otherCanceled is false, perform
            ! ReadableByteStreamControllerClose(otherBranch.[[controller]]).
         6. If chunk is not undefined,
            1. Assert: chunk.[[ByteLength]] is 0.
            2. If byobCanceled is false, perform
               ! ReadableByteStreamControllerRespondWithNewView(byobBranch.[[controller]], chunk).
            3. If otherCanceled is false and otherBranch.[[controller]].[[pendingPullIntos]] is not
               empty, perform ! ReadableByteStreamControllerRespond(otherBranch.[[controller]], 0).
         7. If byobCanceled is false or otherCanceled is false, resolve cancelPromise with
            undefined.
       - **error steps**:
         1. Set reading to false.
    5. Perform ! ReadableStreamBYOBReaderRead(reader, view, 1, readIntoRequest).
17. Let pull1Algorithm be the following steps:
    1. If reading is true,
       1. Set readAgainForBranch1 to true.
       2. Return a promise resolved with undefined.
    2. Set reading to true.
    3. Let byobRequest be ! ReadableByteStreamControllerGetBYOBRequest(branch1.[[controller]]).
    4. If byobRequest is null, perform pullWithDefaultReader.
    5. Otherwise, perform pullWithBYOBReader, given byobRequest.[[view]] and false.
    6. Return a promise resolved with undefined.
18. Let pull2Algorithm be the following steps:
    1. If reading is true,
       1. Set readAgainForBranch2 to true.
       2. Return a promise resolved with undefined.
    2. Set reading to true.
    3. Let byobRequest be ! ReadableByteStreamControllerGetBYOBRequest(branch2.[[controller]]).
    4. If byobRequest is null, perform pullWithDefaultReader.
    5. Otherwise, perform pullWithBYOBReader, given byobRequest.[[view]] and true.
    6. Return a promise resolved with undefined.
19. Let cancel1Algorithm be the following steps, taking a reason argument:
    1. Set canceled1 to true.
    2. Set reason1 to reason.
    3. If canceled2 is true,
       1. Let compositeReason be ! CreateArrayFromList(« reason1, reason2 »).
       2. Let cancelResult be ! ReadableStreamCancel(stream, compositeReason).
       3. Resolve cancelPromise with cancelResult.
    4. Return cancelPromise.
20. Let cancel2Algorithm be the following steps, taking a reason argument:
    1. Set canceled2 to true.
    2. Set reason2 to reason.
    3. If canceled1 is true,
       1. Let compositeReason be ! CreateArrayFromList(« reason1, reason2 »).
       2. Let cancelResult be ! ReadableStreamCancel(stream, compositeReason).
       3. Resolve cancelPromise with cancelResult.
    4. Return cancelPromise.
21. Let startAlgorithm be an algorithm that returns undefined.
22. Set branch1 to ! CreateReadableByteStream(startAlgorithm, pull1Algorithm, cancel1Algorithm).
23. Set branch2 to ! CreateReadableByteStream(startAlgorithm, pull2Algorithm, cancel2Algorithm).
24. Perform forwardReaderError, given reader.
25. Return « branch1, branch2 ».

## Interfacing with controllers

In terms of specification factoring, the way that the ReadableStream class encapsulates the
behavior of both simple readable streams and readable byte streams into a single class is by
centralizing most of the potentially-varying logic inside the two controller classes,
ReadableStreamDefaultController and ReadableByteStreamController. Those classes define most of the
stateful internal slots and abstract operations for how a stream's internal queue is managed and
how it interfaces with its underlying source or underlying byte source.

Each controller class defines three internal methods, which are called by the ReadableStream
algorithms:

- **[[CancelSteps]](reason)**: The controller's steps that run in reaction to the stream being
  canceled, used to clean up the state stored in the controller and inform the underlying source.
- **[[PullSteps]](readRequest)**: The controller's steps that run when a default reader is read
  from, used to pull from the controller any queued chunks, or pull from the underlying source to
  get more chunks.
- **[[ReleaseSteps]]()**: The controller's steps that run when a reader is released, used to clean
  up reader-specific resources stored in the controller.

(These are defined as internal methods, instead of as abstract operations, so that they can be
called polymorphically by the ReadableStream algorithms, without having to branch on which type of
controller is present.)

The rest of this section concerns abstract operations that go in the other direction: they are used
by the controller implementations to affect their associated ReadableStream object. This translates
internal state changes of the controller into developer-facing results visible through the
ReadableStream's public API.

### ReadableStreamAddReadIntoRequest(stream, readRequest) → undefined
1. Assert: stream.[[reader]] implements ReadableStreamBYOBReader.
2. Assert: stream.[[state]] is "`readable`" or "`closed`".
3. Append readRequest to stream.[[reader]].[[readIntoRequests]].

### ReadableStreamAddReadRequest(stream, readRequest) → undefined
1. Assert: stream.[[reader]] implements ReadableStreamDefaultReader.
2. Assert: stream.[[state]] is "`readable`".
3. Append readRequest to stream.[[reader]].[[readRequests]].

### ReadableStreamCancel(stream, reason) → Promise<undefined>
1. Set stream.[[disturbed]] to true.
2. If stream.[[state]] is "`closed`", return a promise resolved with undefined.
3. If stream.[[state]] is "`errored`", return a promise rejected with stream.[[storedError]].
4. Perform ! ReadableStreamClose(stream).
5. Let reader be stream.[[reader]].
6. If reader is not undefined and reader implements ReadableStreamBYOBReader,
   1. Let readIntoRequests be reader.[[readIntoRequests]].
   2. Set reader.[[readIntoRequests]] to an empty list.
   3. For each readIntoRequest of readIntoRequests,
      1. Perform readIntoRequest's close steps, given undefined.
7. Let sourceCancelPromise be ! stream.[[controller]].[[CancelSteps]](reason).
8. Return the result of reacting to sourceCancelPromise with a fulfillment step that returns
   undefined.

### ReadableStreamClose(stream) → undefined
1. Assert: stream.[[state]] is "`readable`".
2. Set stream.[[state]] to "`closed`".
3. Let reader be stream.[[reader]].
4. If reader is undefined, return.
5. Resolve reader.[[closedPromise]] with undefined.
6. If reader implements ReadableStreamDefaultReader,
   1. Let readRequests be reader.[[readRequests]].
   2. Set reader.[[readRequests]] to an empty list.
   3. For each readRequest of readRequests,
      1. Perform readRequest's close steps.

### ReadableStreamError(stream, e) → undefined
1. Assert: stream.[[state]] is "`readable`".
2. Set stream.[[state]] to "`errored`".
3. Set stream.[[storedError]] to e.
4. Let reader be stream.[[reader]].
5. If reader is undefined, return.
6. Reject reader.[[closedPromise]] with e.
7. Set reader.[[closedPromise]].[[PromiseIsHandled]] to true.
8. If reader implements ReadableStreamDefaultReader,
   1. Perform ! ReadableStreamDefaultReaderErrorReadRequests(reader, e).
9. Otherwise,
   1. Assert: reader implements ReadableStreamBYOBReader.
   2. Perform ! ReadableStreamBYOBReaderErrorReadIntoRequests(reader, e).

### ReadableStreamFulfillReadIntoRequest(stream, chunk, done) → undefined
1. Assert: ! ReadableStreamHasBYOBReader(stream) is true.
2. Let reader be stream.[[reader]].
3. Assert: reader.[[readIntoRequests]] is not empty.
4. Let readIntoRequest be reader.[[readIntoRequests]][0].
5. Remove readIntoRequest from reader.[[readIntoRequests]].
6. If done is true, perform readIntoRequest's close steps, given chunk.
7. Otherwise, perform readIntoRequest's chunk steps, given chunk.

### ReadableStreamFulfillReadRequest(stream, chunk, done) → undefined
1. Assert: ! ReadableStreamHasDefaultReader(stream) is true.
2. Let reader be stream.[[reader]].
3. Assert: reader.[[readRequests]] is not empty.
4. Let readRequest be reader.[[readRequests]][0].
5. Remove readRequest from reader.[[readRequests]].
6. If done is true, perform readRequest's close steps.
7. Otherwise, perform readRequest's chunk steps, given chunk.

### ReadableStreamGetNumReadIntoRequests(stream) → number
1. Assert: ! ReadableStreamHasBYOBReader(stream) is true.
2. Return stream.[[reader]].[[readIntoRequests]]'s size.

### ReadableStreamGetNumReadRequests(stream) → number
1. Assert: ! ReadableStreamHasDefaultReader(stream) is true.
2. Return stream.[[reader]].[[readRequests]]'s size.

### ReadableStreamHasBYOBReader(stream) → boolean
1. Let reader be stream.[[reader]].
2. If reader is undefined, return false.
3. If reader implements ReadableStreamBYOBReader, return true.
4. Return false.

### ReadableStreamHasDefaultReader(stream) → boolean
1. Let reader be stream.[[reader]].
2. If reader is undefined, return false.
3. If reader implements ReadableStreamDefaultReader, return true.
4. Return false.

## Readers

The following abstract operations support the implementation and manipulation of
ReadableStreamDefaultReader and ReadableStreamBYOBReader instances.

### ReadableStreamReaderGenericCancel(reader, reason) → Promise<undefined>
1. Let stream be reader.[[stream]].
2. Assert: stream is not undefined.
3. Return ! ReadableStreamCancel(stream, reason).

### ReadableStreamReaderGenericInitialize(reader, stream) → undefined
1. Set reader.[[stream]] to stream.
2. Set stream.[[reader]] to reader.
3. If stream.[[state]] is "`readable`",
   1. Set reader.[[closedPromise]] to a new promise.
4. Otherwise, if stream.[[state]] is "`closed`",
   1. Set reader.[[closedPromise]] to a promise resolved with undefined.
5. Otherwise,
   1. Assert: stream.[[state]] is "`errored`".
   2. Set reader.[[closedPromise]] to a promise rejected with stream.[[storedError]].
   3. Set reader.[[closedPromise]].[[PromiseIsHandled]] to true.

### ReadableStreamReaderGenericRelease(reader) → undefined
1. Let stream be reader.[[stream]].
2. Assert: stream is not undefined.
3. Assert: stream.[[reader]] is reader.
4. If stream.[[state]] is "`readable`", reject reader.[[closedPromise]] with a TypeError exception.
5. Otherwise, set reader.[[closedPromise]] to a promise rejected with a TypeError exception.
6. Set reader.[[closedPromise]].[[PromiseIsHandled]] to true.
7. Perform ! stream.[[controller]].[[ReleaseSteps]]().
8. Set stream.[[reader]] to undefined.
9. Set reader.[[stream]] to undefined.

### ReadableStreamBYOBReaderErrorReadIntoRequests(reader, e) → undefined
1. Let readIntoRequests be reader.[[readIntoRequests]].
2. Set reader.[[readIntoRequests]] to a new empty list.
3. For each readIntoRequest of readIntoRequests,
   1. Perform readIntoRequest's error steps, given e.

### ReadableStreamBYOBReaderRead(reader, view, min, readIntoRequest) → undefined
1. Let stream be reader.[[stream]].
2. Assert: stream is not undefined.
3. Set stream.[[disturbed]] to true.
4. If stream.[[state]] is "`errored`", perform readIntoRequest's error steps given
   stream.[[storedError]].
5. Otherwise, perform ! ReadableByteStreamControllerPullInto(stream.[[controller]], view, min,
   readIntoRequest).

### ReadableStreamBYOBReaderRelease(reader) → undefined
1. Perform ! ReadableStreamReaderGenericRelease(reader).
2. Let e be a new TypeError exception.
3. Perform ! ReadableStreamBYOBReaderErrorReadIntoRequests(reader, e).

### ReadableStreamDefaultReaderErrorReadRequests(reader, e) → undefined
1. Let readRequests be reader.[[readRequests]].
2. Set reader.[[readRequests]] to a new empty list.
3. For each readRequest of readRequests,
   1. Perform readRequest's error steps, given e.

### ReadableStreamDefaultReaderRead(reader, readRequest) → undefined
1. Let stream be reader.[[stream]].
2. Assert: stream is not undefined.
3. Set stream.[[disturbed]] to true.
4. If stream.[[state]] is "`closed`", perform readRequest's close steps.
5. Otherwise, if stream.[[state]] is "`errored`", perform readRequest's error steps given
   stream.[[storedError]].
6. Otherwise,
   1. Assert: stream.[[state]] is "`readable`".
   2. Perform ! stream.[[controller]].[[PullSteps]](readRequest).

### ReadableStreamDefaultReaderRelease(reader) → undefined
1. Perform ! ReadableStreamReaderGenericRelease(reader).
2. Let e be a new TypeError exception.
3. Perform ! ReadableStreamDefaultReaderErrorReadRequests(reader, e).

### SetUpReadableStreamBYOBReader(reader, stream) → undefined
1. If ! IsReadableStreamLocked(stream) is true, throw a TypeError exception.
2. If stream.[[controller]] does not implement ReadableByteStreamController, throw a TypeError
   exception.
3. Perform ! ReadableStreamReaderGenericInitialize(reader, stream).
4. Set reader.[[readIntoRequests]] to a new empty list.

### SetUpReadableStreamDefaultReader(reader, stream) → undefined
1. If ! IsReadableStreamLocked(stream) is true, throw a TypeError exception.
2. Perform ! ReadableStreamReaderGenericInitialize(reader, stream).
3. Set reader.[[readRequests]] to a new empty list.

## Default controllers

The following abstract operations support the implementation of the ReadableStreamDefaultController
class.

### ReadableStreamDefaultControllerCallPullIfNeeded(controller) → undefined
1. Let shouldPull be ! ReadableStreamDefaultControllerShouldCallPull(controller).
2. If shouldPull is false, return.
3. If controller.[[pulling]] is true,
   1. Set controller.[[pullAgain]] to true.
   2. Return.
4. Assert: controller.[[pullAgain]] is false.
5. Set controller.[[pulling]] to true.
6. Let pullPromise be the result of performing controller.[[pullAlgorithm]].
7. Upon fulfillment of pullPromise,
   1. Set controller.[[pulling]] to false.
   2. If controller.[[pullAgain]] is true,
      1. Set controller.[[pullAgain]] to false.
      2. Perform ! ReadableStreamDefaultControllerCallPullIfNeeded(controller).
8. Upon rejection of pullPromise with reason e,
   1. Perform ! ReadableStreamDefaultControllerError(controller, e).

### ReadableStreamDefaultControllerShouldCallPull(controller) → boolean
1. Let stream be controller.[[stream]].
2. If ! ReadableStreamDefaultControllerCanCloseOrEnqueue(controller) is false, return false.
3. If controller.[[started]] is false, return false.
4. If ! IsReadableStreamLocked(stream) is true and
   ! ReadableStreamGetNumReadRequests(stream) > 0, return true.
5. Let desiredSize be ! ReadableStreamDefaultControllerGetDesiredSize(controller).
6. Assert: desiredSize is not null.
7. If desiredSize > 0, return true.
8. Return false.

### ReadableStreamDefaultControllerClearAlgorithms(controller) → undefined
Called once the stream is closed or errored and the algorithms will not be executed any more. By
removing the algorithm references it permits the underlying source object to be garbage collected
even if the ReadableStream itself is still referenced.

Note: This is observable using weak references.

It performs the following steps:

1. Set controller.[[pullAlgorithm]] to undefined.
2. Set controller.[[cancelAlgorithm]] to undefined.
3. Set controller.[[strategySizeAlgorithm]] to undefined.

### ReadableStreamDefaultControllerClose(controller) → undefined
1. If ! ReadableStreamDefaultControllerCanCloseOrEnqueue(controller) is false, return.
2. Let stream be controller.[[stream]].
3. Set controller.[[closeRequested]] to true.
4. If controller.[[queue]] is empty,
   1. Perform ! ReadableStreamDefaultControllerClearAlgorithms(controller).
   2. Perform ! ReadableStreamClose(stream).

### ReadableStreamDefaultControllerEnqueue(controller, chunk) → undefined
1. If ! ReadableStreamDefaultControllerCanCloseOrEnqueue(controller) is false, return.
2. Let stream be controller.[[stream]].
3. If ! IsReadableStreamLocked(stream) is true and
   ! ReadableStreamGetNumReadRequests(stream) > 0, perform
   ! ReadableStreamFulfillReadRequest(stream, chunk, false).
4. Otherwise,
   1. Let result be the result of performing controller.[[strategySizeAlgorithm]], passing in
      chunk, and interpreting the result as a completion record.
   2. If result is an abrupt completion,
      1. Perform ! ReadableStreamDefaultControllerError(controller, result.[[Value]]).
      2. Return result.
   3. Let chunkSize be result.[[Value]].
   4. Let enqueueResult be EnqueueValueWithSize(controller, chunk, chunkSize).
   5. If enqueueResult is an abrupt completion,
      1. Perform ! ReadableStreamDefaultControllerError(controller, enqueueResult.[[Value]]).
      2. Return enqueueResult.
5. Perform ! ReadableStreamDefaultControllerCallPullIfNeeded(controller).

### ReadableStreamDefaultControllerError(controller, e) → undefined
1. Let stream be controller.[[stream]].
2. If stream.[[state]] is not "`readable`", return.
3. Perform ! ResetQueue(controller).
4. Perform ! ReadableStreamDefaultControllerClearAlgorithms(controller).
5. Perform ! ReadableStreamError(stream, e).

### ReadableStreamDefaultControllerGetDesiredSize(controller) → number | null
1. Let state be controller.[[stream]].[[state]].
2. If state is "`errored`", return null.
3. If state is "`closed`", return 0.
4. Return controller.[[strategyHWM]] − controller.[[queueTotalSize]].

### ReadableStreamDefaultControllerHasBackpressure(controller) → boolean
Used in the implementation of TransformStream. It performs the following steps:

1. If ! ReadableStreamDefaultControllerShouldCallPull(controller) is true, return false.
2. Otherwise, return true.

### ReadableStreamDefaultControllerCanCloseOrEnqueue(controller) → boolean
1. Let state be controller.[[stream]].[[state]].
2. If controller.[[closeRequested]] is false and state is "`readable`", return true.
3. Otherwise, return false.

Note: The case where controller.[[closeRequested]] is false, but state is not "`readable`", happens
when the stream is errored via `controller.error()`, or when it is closed without its controller's
`controller.close()` method ever being called: e.g., if the stream was closed by a call to
`stream.cancel()`.

### SetUpReadableStreamDefaultController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm) → undefined
1. Assert: stream.[[controller]] is undefined.
2. Set controller.[[stream]] to stream.
3. Perform ! ResetQueue(controller).
4. Set controller.[[started]], controller.[[closeRequested]], controller.[[pullAgain]], and
   controller.[[pulling]] to false.
5. Set controller.[[strategySizeAlgorithm]] to sizeAlgorithm and controller.[[strategyHWM]] to
   highWaterMark.
6. Set controller.[[pullAlgorithm]] to pullAlgorithm.
7. Set controller.[[cancelAlgorithm]] to cancelAlgorithm.
8. Set stream.[[controller]] to controller.
9. Let startResult be the result of performing startAlgorithm. (This might throw an exception.)
10. Let startPromise be a promise resolved with startResult.
11. Upon fulfillment of startPromise,
    1. Set controller.[[started]] to true.
    2. Assert: controller.[[pulling]] is false.
    3. Assert: controller.[[pullAgain]] is false.
    4. Perform ! ReadableStreamDefaultControllerCallPullIfNeeded(controller).
12. Upon rejection of startPromise with reason r,
    1. Perform ! ReadableStreamDefaultControllerError(controller, r).

### SetUpReadableStreamDefaultControllerFromUnderlyingSource(stream, underlyingSource, underlyingSourceDict, highWaterMark, sizeAlgorithm) → undefined
1. Let controller be a new ReadableStreamDefaultController.
2. Let startAlgorithm be an algorithm that returns undefined.
3. Let pullAlgorithm be an algorithm that returns a promise resolved with undefined.
4. Let cancelAlgorithm be an algorithm that returns a promise resolved with undefined.
5. If underlyingSourceDict["start"] exists, then set startAlgorithm to an algorithm which returns
   the result of invoking underlyingSourceDict["start"] with argument list « controller » and
   callback this value underlyingSource.
6. If underlyingSourceDict["pull"] exists, then set pullAlgorithm to an algorithm which returns the
   result of invoking underlyingSourceDict["pull"] with argument list « controller » and callback
   this value underlyingSource.
7. If underlyingSourceDict["cancel"] exists, then set cancelAlgorithm to an algorithm which takes an
   argument reason and returns the result of invoking underlyingSourceDict["cancel"] with argument
   list « reason » and callback this value underlyingSource.
8. Perform ? SetUpReadableStreamDefaultController(stream, controller, startAlgorithm,
   pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm).

## Byte stream controllers

### ReadableByteStreamControllerCallPullIfNeeded(controller) → undefined
1. Let shouldPull be ! ReadableByteStreamControllerShouldCallPull(controller).
2. If shouldPull is false, return.
3. If controller.[[pulling]] is true,
   1. Set controller.[[pullAgain]] to true.
   2. Return.
4. Assert: controller.[[pullAgain]] is false.
5. Set controller.[[pulling]] to true.
6. Let pullPromise be the result of performing controller.[[pullAlgorithm]].
7. Upon fulfillment of pullPromise,
   1. Set controller.[[pulling]] to false.
   2. If controller.[[pullAgain]] is true,
      1. Set controller.[[pullAgain]] to false.
      2. Perform ! ReadableByteStreamControllerCallPullIfNeeded(controller).
8. Upon rejection of pullPromise with reason e,
   1. Perform ! ReadableByteStreamControllerError(controller, e).

### ReadableByteStreamControllerClearAlgorithms(controller) → undefined
Called once the stream is closed or errored and the algorithms will not be executed any more. By
removing the algorithm references it permits the underlying byte source object to be garbage
collected even if the ReadableStream itself is still referenced.

Note: This is observable using weak references.

It performs the following steps:

1. Set controller.[[pullAlgorithm]] to undefined.
2. Set controller.[[cancelAlgorithm]] to undefined.

### ReadableByteStreamControllerClearPendingPullIntos(controller) → undefined
1. Perform ! ReadableByteStreamControllerInvalidateBYOBRequest(controller).
2. Set controller.[[pendingPullIntos]] to a new empty list.

### ReadableByteStreamControllerClose(controller) → undefined
1. Let stream be controller.[[stream]].
2. If controller.[[closeRequested]] is true or stream.[[state]] is not "`readable`", return.
3. If controller.[[queueTotalSize]] > 0,
   1. Set controller.[[closeRequested]] to true.
   2. Return.
4. If controller.[[pendingPullIntos]] is not empty,
   1. Let firstPendingPullInto be controller.[[pendingPullIntos]][0].
   2. If the remainder after dividing firstPendingPullInto's bytes filled by
      firstPendingPullInto's element size is not 0,
      1. Let e be a new TypeError exception.
      2. Perform ! ReadableByteStreamControllerError(controller, e).
      3. Throw e.
5. Perform ! ReadableByteStreamControllerClearAlgorithms(controller).
6. Perform ! ReadableStreamClose(stream).

### ReadableByteStreamControllerCommitPullIntoDescriptor(stream, pullIntoDescriptor) → undefined
1. Assert: stream.[[state]] is not "`errored`".
2. Assert: pullIntoDescriptor.reader type is not "`none`".
3. Let done be false.
4. If stream.[[state]] is "`closed`",
   1. Assert: the remainder after dividing pullIntoDescriptor's bytes filled by
      pullIntoDescriptor's element size is 0.
   2. Set done to true.
5. Let filledView be ! ReadableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor).
6. If pullIntoDescriptor's reader type is "`default`",
   1. Perform ! ReadableStreamFulfillReadRequest(stream, filledView, done).
7. Otherwise,
   1. Assert: pullIntoDescriptor's reader type is "`byob`".
   2. Perform ! ReadableStreamFulfillReadIntoRequest(stream, filledView, done).

### ReadableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor) → ArrayBufferView
1. Let bytesFilled be pullIntoDescriptor's bytes filled.
2. Let elementSize be pullIntoDescriptor's element size.
3. Assert: bytesFilled ≤ pullIntoDescriptor's byte length.
4. Assert: the remainder after dividing bytesFilled by elementSize is 0.
5. Let buffer be ! TransferArrayBuffer(pullIntoDescriptor's buffer).
6. Return ! Construct(pullIntoDescriptor's view constructor, « buffer, pullIntoDescriptor's byte
   offset, bytesFilled ÷ elementSize »).

### ReadableByteStreamControllerEnqueue(controller, chunk) → undefined
1. Let stream be controller.[[stream]].
2. If controller.[[closeRequested]] is true or stream.[[state]] is not "`readable`", return.
3. Let buffer be chunk.[[ViewedArrayBuffer]].
4. Let byteOffset be chunk.[[ByteOffset]].
5. Let byteLength be chunk.[[ByteLength]].
6. If ! IsDetachedBuffer(buffer) is true, throw a TypeError exception.
7. Let transferredBuffer be ? TransferArrayBuffer(buffer).
8. If controller.[[pendingPullIntos]] is not empty,
   1. Let firstPendingPullInto be controller.[[pendingPullIntos]][0].
   2. If ! IsDetachedBuffer(firstPendingPullInto's buffer) is true, throw a TypeError exception.
   3. Perform ! ReadableByteStreamControllerInvalidateBYOBRequest(controller).
   4. Set firstPendingPullInto's buffer to ! TransferArrayBuffer(firstPendingPullInto's buffer).
   5. If firstPendingPullInto's reader type is "`none`", perform
      ? ReadableByteStreamControllerEnqueueDetachedPullIntoToQueue(controller,
      firstPendingPullInto).
9. If ! ReadableStreamHasDefaultReader(stream) is true,
   1. Perform ! ReadableByteStreamControllerProcessReadRequestsUsingQueue(controller).
   2. If ! ReadableStreamGetNumReadRequests(stream) is 0,
      1. Assert: controller.[[pendingPullIntos]] is empty.
      2. Perform ! ReadableByteStreamControllerEnqueueChunkToQueue(controller, transferredBuffer,
         byteOffset, byteLength).
   3. Otherwise,
      1. Assert: controller.[[queue]] is empty.
      2. If controller.[[pendingPullIntos]] is not empty,
         1. Assert: controller.[[pendingPullIntos]][0]'s reader type is "`default`".
         2. Perform ! ReadableByteStreamControllerShiftPendingPullInto(controller).
      3. Let transferredView be ! Construct(%Uint8Array%, « transferredBuffer, byteOffset,
         byteLength »).
      4. Perform ! ReadableStreamFulfillReadRequest(stream, transferredView, false).
10. Otherwise, if ! ReadableStreamHasBYOBReader(stream) is true,
    1. Perform ! ReadableByteStreamControllerEnqueueChunkToQueue(controller, transferredBuffer,
       byteOffset, byteLength).
    2. Let filledPullIntos be the result of performing
       ! ReadableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller).
    3. For each filledPullInto of filledPullIntos,
       1. Perform ! ReadableByteStreamControllerCommitPullIntoDescriptor(stream, filledPullInto).
11. Otherwise,
    1. Assert: ! IsReadableStreamLocked(stream) is false.
    2. Perform ! ReadableByteStreamControllerEnqueueChunkToQueue(controller, transferredBuffer,
       byteOffset, byteLength).
12. Perform ! ReadableByteStreamControllerCallPullIfNeeded(controller).

### ReadableByteStreamControllerEnqueueChunkToQueue(controller, buffer, byteOffset, byteLength) → undefined
1. Append a new readable byte stream queue entry with buffer buffer, byte offset byteOffset, and
   byte length byteLength to controller.[[queue]].
2. Set controller.[[queueTotalSize]] to controller.[[queueTotalSize]] + byteLength.

### ReadableByteStreamControllerEnqueueClonedChunkToQueue(controller, buffer, byteOffset, byteLength) → undefined
1. Let cloneResult be CloneArrayBuffer(buffer, byteOffset, byteLength, %ArrayBuffer%).
2. If cloneResult is an abrupt completion,
   1. Perform ! ReadableByteStreamControllerError(controller, cloneResult.[[Value]]).
   2. Return cloneResult.
3. Perform ! ReadableByteStreamControllerEnqueueChunkToQueue(controller, cloneResult.[[Value]], 0,
   byteLength).

### ReadableByteStreamControllerEnqueueDetachedPullIntoToQueue(controller, pullIntoDescriptor) → undefined
1. Assert: pullIntoDescriptor's reader type is "`none`".
2. If pullIntoDescriptor's bytes filled > 0, perform
   ? ReadableByteStreamControllerEnqueueClonedChunkToQueue(controller, pullIntoDescriptor's
   buffer, pullIntoDescriptor's byte offset, pullIntoDescriptor's bytes filled).
3. Perform ! ReadableByteStreamControllerShiftPendingPullInto(controller).

### ReadableByteStreamControllerError(controller, e) → undefined
1. Let stream be controller.[[stream]].
2. If stream.[[state]] is not "`readable`", return.
3. Perform ! ReadableByteStreamControllerClearPendingPullIntos(controller).
4. Perform ! ResetQueue(controller).
5. Perform ! ReadableByteStreamControllerClearAlgorithms(controller).
6. Perform ! ReadableStreamError(stream, e).

### ReadableByteStreamControllerFillHeadPullIntoDescriptor(controller, size, pullIntoDescriptor) → undefined
1. Assert: either controller.[[pendingPullIntos]] is empty, or
   controller.[[pendingPullIntos]][0] is pullIntoDescriptor.
2. Assert: controller.[[byobRequest]] is null.
3. Set pullIntoDescriptor's bytes filled to bytes filled + size.

### ReadableByteStreamControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor) → boolean
1. Let maxBytesToCopy be min(controller.[[queueTotalSize]], pullIntoDescriptor's byte length −
   pullIntoDescriptor's bytes filled).
2. Let maxBytesFilled be pullIntoDescriptor's bytes filled + maxBytesToCopy.
3. Let totalBytesToCopyRemaining be maxBytesToCopy.
4. Let ready be false.
5. Assert: ! IsDetachedBuffer(pullIntoDescriptor's buffer) is false.
6. Assert: pullIntoDescriptor's bytes filled < pullIntoDescriptor's minimum fill.
7. Let remainderBytes be the remainder after dividing maxBytesFilled by pullIntoDescriptor's
   element size.
8. Let maxAlignedBytes be maxBytesFilled − remainderBytes.
9. If maxAlignedBytes ≥ pullIntoDescriptor's minimum fill,
   1. Set totalBytesToCopyRemaining to maxAlignedBytes − pullIntoDescriptor's bytes filled.
   2. Set ready to true.

   Note: A descriptor for a `read()` request that is not yet filled up to its minimum length will
   stay at the head of the queue, so the underlying source can keep filling it.
10. Let queue be controller.[[queue]].
11. While totalBytesToCopyRemaining > 0,
    1. Let headOfQueue be queue[0].
    2. Let bytesToCopy be min(totalBytesToCopyRemaining, headOfQueue's byte length).
    3. Let destStart be pullIntoDescriptor's byte offset + pullIntoDescriptor's bytes filled.
    4. Let descriptorBuffer be pullIntoDescriptor's buffer.
    5. Let queueBuffer be headOfQueue's buffer.
    6. Let queueByteOffset be headOfQueue's byte offset.
    7. Assert: ! CanCopyDataBlockBytes(descriptorBuffer, destStart, queueBuffer, queueByteOffset,
       bytesToCopy) is true.

       Warning: If this assertion were to fail (due to a bug in this specification or its
       implementation), then the next step may read from or write to potentially invalid memory.
       The user agent should always check this assertion, and stop in an implementation-defined
       manner if it fails (e.g. by crashing the process, or by erroring the stream).
    8. Perform ! CopyDataBlockBytes(descriptorBuffer.[[ArrayBufferData]], destStart,
       queueBuffer.[[ArrayBufferData]], queueByteOffset, bytesToCopy).
    9. If headOfQueue's byte length is bytesToCopy,
       1. Remove queue[0].
    10. Otherwise,
        1. Set headOfQueue's byte offset to headOfQueue's byte offset + bytesToCopy.
        2. Set headOfQueue's byte length to headOfQueue's byte length − bytesToCopy.
    11. Set controller.[[queueTotalSize]] to controller.[[queueTotalSize]] − bytesToCopy.
    12. Perform ! ReadableByteStreamControllerFillHeadPullIntoDescriptor(controller, bytesToCopy,
        pullIntoDescriptor).
    13. Set totalBytesToCopyRemaining to totalBytesToCopyRemaining − bytesToCopy.
12. If ready is false,
    1. Assert: controller.[[queueTotalSize]] is 0.
    2. Assert: pullIntoDescriptor's bytes filled > 0.
    3. Assert: pullIntoDescriptor's bytes filled < pullIntoDescriptor's minimum fill.
13. Return ready.

### ReadableByteStreamControllerFillReadRequestFromQueue(controller, readRequest) → undefined
1. Assert: controller.[[queueTotalSize]] > 0.
2. Let entry be controller.[[queue]][0].
3. Remove entry from controller.[[queue]].
4. Set controller.[[queueTotalSize]] to controller.[[queueTotalSize]] − entry's byte length.
5. Perform ! ReadableByteStreamControllerHandleQueueDrain(controller).
6. Let view be ! Construct(%Uint8Array%, « entry's buffer, entry's byte offset, entry's byte
   length »).
7. Perform readRequest's chunk steps, given view.

### ReadableByteStreamControllerGetBYOBRequest(controller) → ReadableStreamBYOBRequest | null
1. If controller.[[byobRequest]] is null and controller.[[pendingPullIntos]] is not empty,
   1. Let firstDescriptor be controller.[[pendingPullIntos]][0].
   2. Let view be ! Construct(%Uint8Array%, « firstDescriptor's buffer, firstDescriptor's byte
      offset + firstDescriptor's bytes filled, firstDescriptor's byte length − firstDescriptor's
      bytes filled »).
   3. Let byobRequest be a new ReadableStreamBYOBRequest.
   4. Set byobRequest.[[controller]] to controller.
   5. Set byobRequest.[[view]] to view.
   6. Set controller.[[byobRequest]] to byobRequest.
2. Return controller.[[byobRequest]].

### ReadableByteStreamControllerGetDesiredSize(controller) → number | null
1. Let state be controller.[[stream]].[[state]].
2. If state is "`errored`", return null.
3. If state is "`closed`", return 0.
4. Return controller.[[strategyHWM]] − controller.[[queueTotalSize]].

### ReadableByteStreamControllerHandleQueueDrain(controller) → undefined
1. Assert: controller.[[stream]].[[state]] is "`readable`".
2. If controller.[[queueTotalSize]] is 0 and controller.[[closeRequested]] is true,
   1. Perform ! ReadableByteStreamControllerClearAlgorithms(controller).
   2. Perform ! ReadableStreamClose(controller.[[stream]]).
3. Otherwise,
   1. Perform ! ReadableByteStreamControllerCallPullIfNeeded(controller).

### ReadableByteStreamControllerInvalidateBYOBRequest(controller) → undefined
1. If controller.[[byobRequest]] is null, return.
2. Set controller.[[byobRequest]].[[controller]] to undefined.
3. Set controller.[[byobRequest]].[[view]] to null.
4. Set controller.[[byobRequest]] to null.

### ReadableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller) → list of pull-into descriptors
1. Assert: controller.[[closeRequested]] is false.
2. Let filledPullIntos be a new empty list.
3. While controller.[[pendingPullIntos]] is not empty,
   1. If controller.[[queueTotalSize]] is 0, then break.
   2. Let pullIntoDescriptor be controller.[[pendingPullIntos]][0].
   3. If ! ReadableByteStreamControllerFillPullIntoDescriptorFromQueue(controller,
      pullIntoDescriptor) is true,
      1. Perform ! ReadableByteStreamControllerShiftPendingPullInto(controller).
      2. Append pullIntoDescriptor to filledPullIntos.
4. Return filledPullIntos.

### ReadableByteStreamControllerProcessReadRequestsUsingQueue(controller) → undefined
1. Let reader be controller.[[stream]].[[reader]].
2. Assert: reader implements ReadableStreamDefaultReader.
3. While reader.[[readRequests]] is not empty,
   1. If controller.[[queueTotalSize]] is 0, return.
   2. Let readRequest be reader.[[readRequests]][0].
   3. Remove readRequest from reader.[[readRequests]].
   4. Perform ! ReadableByteStreamControllerFillReadRequestFromQueue(controller, readRequest).

### ReadableByteStreamControllerPullInto(controller, view, min, readIntoRequest) → undefined
1. Let stream be controller.[[stream]].
2. Let elementSize be 1.
3. Let ctor be %DataView%.
4. If view has a [[TypedArrayName]] internal slot (i.e., it is not a DataView),
   1. Set elementSize to the element size specified in the typed array constructors table for
      view.[[TypedArrayName]].
   2. Set ctor to the constructor specified in the typed array constructors table for
      view.[[TypedArrayName]].
5. Let minimumFill be min × elementSize.
6. Assert: minimumFill ≥ 0 and minimumFill ≤ view.[[ByteLength]].
7. Assert: the remainder after dividing minimumFill by elementSize is 0.
8. Let byteOffset be view.[[ByteOffset]].
9. Let byteLength be view.[[ByteLength]].
10. Let bufferResult be TransferArrayBuffer(view.[[ViewedArrayBuffer]]).
11. If bufferResult is an abrupt completion,
    1. Perform readIntoRequest's error steps, given bufferResult.[[Value]].
    2. Return.
12. Let buffer be bufferResult.[[Value]].
13. Let pullIntoDescriptor be a new pull-into descriptor with
    - buffer: buffer
    - buffer byte length: buffer.[[ArrayBufferByteLength]]
    - byte offset: byteOffset
    - byte length: byteLength
    - bytes filled: 0
    - minimum fill: minimumFill
    - element size: elementSize
    - view constructor: ctor
    - reader type: "`byob`"
14. If controller.[[pendingPullIntos]] is not empty,
    1. Append pullIntoDescriptor to controller.[[pendingPullIntos]].
    2. Perform ! ReadableStreamAddReadIntoRequest(stream, readIntoRequest).
    3. Return.
15. If stream.[[state]] is "`closed`",
    1. Let emptyView be ! Construct(ctor, « pullIntoDescriptor's buffer, pullIntoDescriptor's byte
       offset, 0 »).
    2. Perform readIntoRequest's close steps, given emptyView.
    3. Return.
16. If controller.[[queueTotalSize]] > 0,
    1. If ! ReadableByteStreamControllerFillPullIntoDescriptorFromQueue(controller,
       pullIntoDescriptor) is true,
       1. Let filledView be
          ! ReadableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor).
       2. Perform ! ReadableByteStreamControllerHandleQueueDrain(controller).
       3. Perform readIntoRequest's chunk steps, given filledView.
       4. Return.
    2. If controller.[[closeRequested]] is true,
       1. Let e be a TypeError exception.
       2. Perform ! ReadableByteStreamControllerError(controller, e).
       3. Perform readIntoRequest's error steps, given e.
       4. Return.
17. Append pullIntoDescriptor to controller.[[pendingPullIntos]].
18. Perform ! ReadableStreamAddReadIntoRequest(stream, readIntoRequest).
19. Perform ! ReadableByteStreamControllerCallPullIfNeeded(controller).

### ReadableByteStreamControllerRespond(controller, bytesWritten) → undefined
1. Assert: controller.[[pendingPullIntos]] is not empty.
2. Let firstDescriptor be controller.[[pendingPullIntos]][0].
3. Let state be controller.[[stream]].[[state]].
4. If state is "`closed`",
   1. If bytesWritten is not 0, throw a TypeError exception.
5. Otherwise,
   1. Assert: state is "`readable`".
   2. If bytesWritten is 0, throw a TypeError exception.
   3. If firstDescriptor's bytes filled + bytesWritten > firstDescriptor's byte length, throw a
      RangeError exception.
6. Set firstDescriptor's buffer to ! TransferArrayBuffer(firstDescriptor's buffer).
7. Perform ? ReadableByteStreamControllerRespondInternal(controller, bytesWritten).

### ReadableByteStreamControllerRespondInClosedState(controller, firstDescriptor) → undefined
1. Assert: the remainder after dividing firstDescriptor's bytes filled by firstDescriptor's element
   size is 0.
2. If firstDescriptor's reader type is "`none`", perform
   ! ReadableByteStreamControllerShiftPendingPullInto(controller).
3. Let stream be controller.[[stream]].
4. If ! ReadableStreamHasBYOBReader(stream) is true,
   1. Let filledPullIntos be a new empty list.
   2. While filledPullIntos's size < ! ReadableStreamGetNumReadIntoRequests(stream),
      1. Let pullIntoDescriptor be
         ! ReadableByteStreamControllerShiftPendingPullInto(controller).
      2. Append pullIntoDescriptor to filledPullIntos.
   3. For each filledPullInto of filledPullIntos,
      1. Perform ! ReadableByteStreamControllerCommitPullIntoDescriptor(stream, filledPullInto).

### ReadableByteStreamControllerRespondInReadableState(controller, bytesWritten, pullIntoDescriptor) → undefined
1. Assert: pullIntoDescriptor's bytes filled + bytesWritten ≤ pullIntoDescriptor's byte length.
2. Perform ! ReadableByteStreamControllerFillHeadPullIntoDescriptor(controller, bytesWritten,
   pullIntoDescriptor).
3. If pullIntoDescriptor's reader type is "`none`",
   1. Perform ? ReadableByteStreamControllerEnqueueDetachedPullIntoToQueue(controller,
      pullIntoDescriptor).
   2. Let filledPullIntos be the result of performing
      ! ReadableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller).
   3. For each filledPullInto of filledPullIntos,
      1. Perform ! ReadableByteStreamControllerCommitPullIntoDescriptor(controller.[[stream]],
         filledPullInto).
   4. Return.
4. If pullIntoDescriptor's bytes filled < pullIntoDescriptor's minimum fill, return.

   Note: A descriptor for a `read()` request that is not yet filled up to its minimum length will
   stay at the head of the queue, so the underlying source can keep filling it.
5. Perform ! ReadableByteStreamControllerShiftPendingPullInto(controller).
6. Let remainderSize be the remainder after dividing pullIntoDescriptor's bytes filled by
   pullIntoDescriptor's element size.
7. If remainderSize > 0,
   1. Let end be pullIntoDescriptor's byte offset + pullIntoDescriptor's bytes filled.
   2. Perform ? ReadableByteStreamControllerEnqueueClonedChunkToQueue(controller,
      pullIntoDescriptor's buffer, end − remainderSize, remainderSize).
8. Set pullIntoDescriptor's bytes filled to pullIntoDescriptor's bytes filled − remainderSize.
9. Let filledPullIntos be the result of performing
   ! ReadableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller).
10. Perform ! ReadableByteStreamControllerCommitPullIntoDescriptor(controller.[[stream]],
    pullIntoDescriptor).
11. For each filledPullInto of filledPullIntos,
    1. Perform ! ReadableByteStreamControllerCommitPullIntoDescriptor(controller.[[stream]],
       filledPullInto).

### ReadableByteStreamControllerRespondInternal(controller, bytesWritten) → undefined
1. Let firstDescriptor be controller.[[pendingPullIntos]][0].
2. Assert: ! CanTransferArrayBuffer(firstDescriptor's buffer) is true.
3. Perform ! ReadableByteStreamControllerInvalidateBYOBRequest(controller).
4. Let state be controller.[[stream]].[[state]].
5. If state is "`closed`",
   1. Assert: bytesWritten is 0.
   2. Perform ! ReadableByteStreamControllerRespondInClosedState(controller, firstDescriptor).
6. Otherwise,
   1. Assert: state is "`readable`".
   2. Assert: bytesWritten > 0.
   3. Perform ? ReadableByteStreamControllerRespondInReadableState(controller, bytesWritten,
      firstDescriptor).
7. Perform ! ReadableByteStreamControllerCallPullIfNeeded(controller).

### ReadableByteStreamControllerRespondWithNewView(controller, view) → undefined
1. Assert: controller.[[pendingPullIntos]] is not empty.
2. Assert: ! IsDetachedBuffer(view.[[ViewedArrayBuffer]]) is false.
3. Let firstDescriptor be controller.[[pendingPullIntos]][0].
4. Let state be controller.[[stream]].[[state]].
5. If state is "`closed`",
   1. If view.[[ByteLength]] is not 0, throw a TypeError exception.
6. Otherwise,
   1. Assert: state is "`readable`".
   2. If view.[[ByteLength]] is 0, throw a TypeError exception.
7. If firstDescriptor's byte offset + firstDescriptor's bytes filled is not view.[[ByteOffset]],
   throw a RangeError exception.
8. If firstDescriptor's buffer byte length is not view.[[ViewedArrayBuffer]].[[ByteLength]], throw
   a RangeError exception.
9. If firstDescriptor's bytes filled + view.[[ByteLength]] > firstDescriptor's byte length, throw a
   RangeError exception.
10. Let viewByteLength be view.[[ByteLength]].
11. Set firstDescriptor's buffer to ? TransferArrayBuffer(view.[[ViewedArrayBuffer]]).
12. Perform ? ReadableByteStreamControllerRespondInternal(controller, viewByteLength).

### ReadableByteStreamControllerShiftPendingPullInto(controller) → pull-into descriptor
1. Assert: controller.[[byobRequest]] is null.
2. Let descriptor be controller.[[pendingPullIntos]][0].
3. Remove descriptor from controller.[[pendingPullIntos]].
4. Return descriptor.

### ReadableByteStreamControllerShouldCallPull(controller) → boolean
1. Let stream be controller.[[stream]].
2. If stream.[[state]] is not "`readable`", return false.
3. If controller.[[closeRequested]] is true, return false.
4. If controller.[[started]] is false, return false.
5. If ! ReadableStreamHasDefaultReader(stream) is true and
   ! ReadableStreamGetNumReadRequests(stream) > 0, return true.
6. If ! ReadableStreamHasBYOBReader(stream) is true and
   ! ReadableStreamGetNumReadIntoRequests(stream) > 0, return true.
7. Let desiredSize be ! ReadableByteStreamControllerGetDesiredSize(controller).
8. Assert: desiredSize is not null.
9. If desiredSize > 0, return true.
10. Return false.

### SetUpReadableByteStreamController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, autoAllocateChunkSize) → undefined
1. Assert: stream.[[controller]] is undefined.
2. If autoAllocateChunkSize is not undefined,
   1. Assert: ! IsInteger(autoAllocateChunkSize) is true.
   2. Assert: autoAllocateChunkSize is positive.
3. Set controller.[[stream]] to stream.
4. Set controller.[[pullAgain]] and controller.[[pulling]] to false.
5. Set controller.[[byobRequest]] to null.
6. Perform ! ResetQueue(controller).
7. Set controller.[[closeRequested]] and controller.[[started]] to false.
8. Set controller.[[strategyHWM]] to highWaterMark.
9. Set controller.[[pullAlgorithm]] to pullAlgorithm.
10. Set controller.[[cancelAlgorithm]] to cancelAlgorithm.
11. Set controller.[[autoAllocateChunkSize]] to autoAllocateChunkSize.
12. Set controller.[[pendingPullIntos]] to a new empty list.
13. Set stream.[[controller]] to controller.
14. Let startResult be the result of performing startAlgorithm.
15. Let startPromise be a promise resolved with startResult.
16. Upon fulfillment of startPromise,
    1. Set controller.[[started]] to true.
    2. Assert: controller.[[pulling]] is false.
    3. Assert: controller.[[pullAgain]] is false.
    4. Perform ! ReadableByteStreamControllerCallPullIfNeeded(controller).
17. Upon rejection of startPromise with reason r,
    1. Perform ! ReadableByteStreamControllerError(controller, r).

### SetUpReadableByteStreamControllerFromUnderlyingSource(stream, underlyingSource, underlyingSourceDict, highWaterMark) → undefined
1. Let controller be a new ReadableByteStreamController.
2. Let startAlgorithm be an algorithm that returns undefined.
3. Let pullAlgorithm be an algorithm that returns a promise resolved with undefined.
4. Let cancelAlgorithm be an algorithm that returns a promise resolved with undefined.
5. If underlyingSourceDict["start"] exists, then set startAlgorithm to an algorithm which returns
   the result of invoking underlyingSourceDict["start"] with argument list « controller » and
   callback this value underlyingSource.
6. If underlyingSourceDict["pull"] exists, then set pullAlgorithm to an algorithm which returns the
   result of invoking underlyingSourceDict["pull"] with argument list « controller » and callback
   this value underlyingSource.
7. If underlyingSourceDict["cancel"] exists, then set cancelAlgorithm to an algorithm which takes
   an argument reason and returns the result of invoking underlyingSourceDict["cancel"] with
   argument list « reason » and callback this value underlyingSource.
8. Let autoAllocateChunkSize be underlyingSourceDict["autoAllocateChunkSize"], if it exists, or
   undefined otherwise.
9. If autoAllocateChunkSize is 0, then throw a TypeError exception.
10. Perform ? SetUpReadableByteStreamController(stream, controller, startAlgorithm, pullAlgorithm,
    cancelAlgorithm, highWaterMark, autoAllocateChunkSize).

## Cross-shard abstract ops referenced

Abstract operations called by algorithms in this shard but defined elsewhere (ECMAScript/HTML
primitives, queue-with-sizes ops, WritableStream ops, and other Streams sections):

- AcquireWritableStreamDefaultWriter
- Call
- CanCopyDataBlockBytes
- CanTransferArrayBuffer
- CloneArrayBuffer
- CloneAsUint8Array
- Construct
- CopyDataBlockBytes
- CreateArrayFromList
- EnqueueValueWithSize
- GetIterator
- GetMethod
- IsDetachedBuffer
- IsInteger
- IsNonNegativeNumber
- IsWritableStreamLocked
- IteratorComplete
- IteratorNext
- IteratorValue
- ResetQueue
- StructuredClone
- TransferArrayBuffer
- WritableStreamAbort
- WritableStreamCloseQueuedOrInFlight
- WritableStreamDefaultWriterCloseWithErrorPropagation
- WritableStreamDefaultWriterGetDesiredSize
- WritableStreamDefaultWriterRelease
