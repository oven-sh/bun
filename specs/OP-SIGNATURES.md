# OP-SIGNATURES — the frozen ABI of `WebStreamsInternals.h`

Every abstract operation defined in `specs/digest/0[1-4]-*.md` gets exactly one row below.
All functions live in `namespace Bun::WebStreams`, are free functions (unless noted as a
`StreamQueue<T>` method or a class member), and are declared ONCE in `WebStreamsInternals.h`
(ARCHITECTURE §1). Names are the exact spec names in lowerCamelCase.

## Signature conventions (applied mechanically; read before the table)

1. **`JSC::JSGlobalObject* globalObject` is the first parameter IFF** the op can allocate a JS
   object/promise/error, can throw, or can run user JS. Every such function declares
   `auto scope = DECLARE_THROW_SCOPE(vm)` (ARCH §7.1). Ops that are pure state transitions but
   must *write* a `WriteBarrier` slot take `JSC::VM& vm` as first parameter instead (a
   `WriteBarrier::set` needs the VM; it cannot throw). Ops that only read take neither.
2. **Spec object args → typed pointers** (`JSReadableStream*`, `JSReadableByteStreamController*`,
   …). `chunk`/`reason`/`error`/`e`/`value`/`asyncIterable` → `JSC::JSValue`. Typed-array/view
   args → `JSC::JSArrayBufferView*`; ArrayBuffer args → `JSC::JSArrayBuffer*`.
3. **Numbers**: `double` for anything the spec calls a Number (`highWaterMark`, chunk `size`,
   `desiredSize`, `[[queueTotalSize]]`). `size_t` for byte offsets/lengths/counts internal to the
   byte queue and for list sizes (they index real memory). `uint64_t` for values arriving through
   a WebIDL `[EnforceRange] unsigned long long` conversion (`bytesWritten`, `min`,
   `autoAllocateChunkSize`) — already range-checked at the binding, ≤ 2^53−1.
4. **Returns**: spec `→ undefined` ⇒ `void`; `→ boolean` ⇒ `bool`; `→ a number` ⇒ `double`
   (or `size_t` for list-size counts — noted per row); `→ null or a number` ⇒
   `std::optional<double>`; `→ Promise` ⇒ `JSC::JSPromise*`; `→ ReadableStream` ⇒
   `JSReadableStream*`. Ops that can complete abruptly stay `void`/their value type; the throw
   scope is the abrupt-completion channel (noted per row as "throws").
5. **Optional spec args** get C++ default arguments (single declaration, no overloads).
6. **Algorithm-valued spec parameters do not exist as C++ values** (ARCH §4: no closures). The
   mechanical mapping used everywhere below:
   - `pullAlgorithm`/`cancelAlgorithm`/`writeAlgorithm`/`closeAlgorithm`/`abortAlgorithm`/
     `transformAlgorithm`/`flushAlgorithm`/`sizeAlgorithm` parameters ⇒ the callee reads them
     from the controller's already-populated members (`m_sourceKind`/`m_sinkKind` +
     `m_underlyingSource`/method WriteBarriers + `m_strategySizeAlgorithm`). The C++ signature
     drops them and (for the internal `Create*` entry points) takes the kind enum + an optional
     kind-state cell instead.
   - `startAlgorithm` ⇒ an explicit `JSC::JSValue startMethod` argument for the `JavaScript`
     kind (`jsUndefined()` = the trivial algorithm); native kinds dispatch start on the kind
     enum. Start is invoked exactly once inside `setUp*Controller` and never stored (ARCH §4).
   - `sizeAlgorithm` ⇒ `JSC::JSObject* sizeAlgorithm` (nullptr = the default `() => 1`).
   See **Discrepancies** #1.
7. **WebIDL dictionaries** (`UnderlyingSource`/`UnderlyingSink`/`Transformer`/`QueuingStrategy`)
   are converted ONCE in the public constructor (alphabetical member order, ARCH §4) into the
   stack-only structs in **Structs**; the `…FromUnderlyingSource/Sink/Transformer` ops take
   `const XxxDict&`. All user-getter side effects happen during that conversion, NOT inside
   `extractHighWaterMark`/`extractSizeAlgorithm` (which therefore cannot run user JS).
8. **userJS? column**: `no` / `YES(direct)` / `YES(thenable)` / `YES(transitive)` as defined by
   the task brief. The closure was computed pessimistically; every YES row's notes say which
   callee (or which direct mechanism) makes it YES. "read-request dispatch" = performing a read
   request's chunk/close/error steps: the promise-backed kind only resolves an internal promise
   (no sync user JS), but the pipe/tee/native kinds re-enter controller ops that reach user
   algorithms (e.g. the destination's `size()`), so every dispatch site is `YES(transitive)`.

---

## Abstract operations

### From `digest/02-readable-abstract-ops.md` (74 ops)

| Spec op | Owner file (§1) | Proposed C++ declaration | userJS? | notes |
|---|---|---|---|---|
| `AcquireReadableStreamBYOBReader(stream)` → ReadableStreamBYOBReader | `ReadableStreamOperations.cpp` | `JSReadableStreamBYOBReader* acquireReadableStreamBYOBReader(JSC::JSGlobalObject*, JSReadableStream* stream)` | no | allocates reader cell + `setUpReadableStreamBYOBReader`; throws TypeError if locked / not a byte stream |
| `AcquireReadableStreamDefaultReader(stream)` → ReadableStreamDefaultReader | `ReadableStreamOperations.cpp` | `JSReadableStreamDefaultReader* acquireReadableStreamDefaultReader(JSC::JSGlobalObject*, JSReadableStream* stream)` | no | throws TypeError if locked |
| `CreateReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm[, highWaterMark[, sizeAlgorithm]])` → ReadableStream | `ReadableStreamOperations.cpp` | `JSReadableStream* createReadableStream(JSC::JSGlobalObject*, SourceKind, JSC::JSCell* sourceState, double highWaterMark = 1, JSC::JSObject* sizeAlgorithm = nullptr)` | YES(transitive) | internal-only entry; algorithm triple ⇒ `SourceKind` + kind-state cell (tee state, iterator record cell, …) per convention #6; calls `setUpReadableStreamDefaultController`, which runs the start algorithm — every kind reachable here has a native no-op start, but marked YES conservatively |
| `CreateReadableByteStream(startAlgorithm, pullAlgorithm, cancelAlgorithm)` → ReadableStream | `ReadableStreamOperations.cpp` | `JSReadableStream* createReadableByteStream(JSC::JSGlobalObject*, SourceKind, JSC::JSCell* sourceState)` | YES(transitive) | hwm 0, autoAllocateChunkSize absent; via `setUpReadableByteStreamController` (start) |
| `InitializeReadableStream(stream)` → undefined | `ReadableStreamOperations.cpp` | `void initializeReadableStream(JSReadableStream* stream)` | no | pure state transition (state=Readable, clear reader/storedError, disturbed=false); no global |
| `IsReadableStreamLocked(stream)` → boolean | `ReadableStreamOperations.cpp` | `bool isReadableStreamLocked(JSReadableStream* stream)` | no | pure read; no global |
| `ReadableStreamFromIterable(asyncIterable)` → ReadableStream | `ReadableStreamOperations.cpp` | `JSReadableStream* readableStreamFromIterable(JSC::JSGlobalObject*, JSC::JSValue asyncIterable)` | YES(direct) | `GetIterator(async)` does a `[[Get]]` of `@@asyncIterator`/`@@iterator` on a user object and calls it; throws. Creates a `SourceKind::FromIterable` stream |
| `ReadableStreamPipeTo(source, dest, preventClose, preventAbort, preventCancel[, signal])` → Promise\<undefined\> | `ReadableStreamOperations.cpp` (state machine cell in `JSStreamPipeToOperation.{h,cpp}`, §6) | `JSC::JSPromise* readableStreamPipeTo(JSC::JSGlobalObject*, JSReadableStream* source, JSWritableStream* dest, bool preventClose, bool preventAbort, bool preventCancel, WebCore::AbortSignal* signal = nullptr)` | YES(transitive) | if `signal` is already aborted the abort algorithm runs synchronously → `writableStreamAbort` (user abort-signal listeners + sink abort) / `readableStreamCancel`; `signal == nullptr` ⇔ spec `undefined` |
| `ReadableStreamTee(stream, cloneForBranch2)` → « RS, RS » | `ReadableStreamOperations.cpp` | `std::pair<JSReadableStream*, JSReadableStream*> readableStreamTee(JSC::JSGlobalObject*, JSReadableStream* stream, bool cloneForBranch2)` | YES(transitive) | dispatches to Default/ByteStream tee; pair return — see Discrepancies #6 |
| `ReadableStreamDefaultTee(stream, cloneForBranch2)` → « RS, RS » | `ReadableStreamOperations.cpp` | `std::pair<JSReadableStream*, JSReadableStream*> readableStreamDefaultTee(JSC::JSGlobalObject*, JSReadableStream* stream, bool cloneForBranch2)` | YES(transitive) | allocates `JSStreamTeeState` + 2 branches via `createReadableStream` (start = native no-op). No user JS synchronously today; YES only through `createReadableStream` |
| `ReadableByteStreamTee(stream)` → « RS, RS » | `ReadableStreamOperations.cpp` | `std::pair<JSReadableStream*, JSReadableStream*> readableByteStreamTee(JSC::JSGlobalObject*, JSReadableStream* stream)` | YES(transitive) | separate byte-tee state cell; branches via `createReadableByteStream` |
| `ReadableStreamAddReadIntoRequest(stream, readRequest)` → undefined | `ReadableStreamOperations.cpp` | `void readableStreamAddReadIntoRequest(JSC::VM&, JSReadableStream* stream, JSReadIntoRequest* readRequest)` | no | appends a `WriteBarrier` into the BYOB reader's deque (cellLock) |
| `ReadableStreamAddReadRequest(stream, readRequest)` → undefined | `ReadableStreamOperations.cpp` | `void readableStreamAddReadRequest(JSC::VM&, JSReadableStream* stream, JSReadRequest* readRequest)` | no | same, default reader deque |
| `ReadableStreamCancel(stream, reason)` → Promise\<undefined\> | `ReadableStreamOperations.cpp` | `JSC::JSPromise* readableStreamCancel(JSC::JSGlobalObject*, JSReadableStream* stream, JSC::JSValue reason)` | YES(transitive) | `readableStreamClose` (read-request dispatch) + read-into close steps + controller `[[CancelSteps]]` (user cancel) + thenable adoption of the cancel result |
| `ReadableStreamClose(stream)` → undefined | `ReadableStreamOperations.cpp` | `void readableStreamClose(JSC::JSGlobalObject*, JSReadableStream* stream)` | YES(transitive) | resolves `[[closedPromise]]` (ours, no sync JS) then read-request **close-steps dispatch** for every queued request |
| `ReadableStreamError(stream, e)` → undefined | `ReadableStreamOperations.cpp` | `void readableStreamError(JSC::JSGlobalObject*, JSReadableStream* stream, JSC::JSValue e)` | YES(transitive) | rejects+marks-handled `[[closedPromise]]`, then error-steps dispatch via `readableStream{Default,BYOB}Reader…ErrorRead*Requests` |
| `ReadableStreamFulfillReadIntoRequest(stream, chunk, done)` → undefined | `ReadableStreamOperations.cpp` | `void readableStreamFulfillReadIntoRequest(JSC::JSGlobalObject*, JSReadableStream* stream, JSC::JSValue chunk, bool done)` | YES(transitive) | read-into-request dispatch (chunk/close steps); the byte-tee read-into request re-enters controller ops |
| `ReadableStreamFulfillReadRequest(stream, chunk, done)` → undefined | `ReadableStreamOperations.cpp` | `void readableStreamFulfillReadRequest(JSC::JSGlobalObject*, JSReadableStream* stream, JSC::JSValue chunk, bool done)` | YES(transitive) | read-request dispatch: the public `JSPromiseReadRequest` kind only resolves an internal promise (no sync user JS), but pipe/tee/iterator kinds do more — conservatively YES |
| `ReadableStreamGetNumReadIntoRequests(stream)` → number | `ReadableStreamOperations.cpp` | `size_t readableStreamGetNumReadIntoRequests(JSReadableStream* stream)` | no | list size ⇒ `size_t`, only compared to 0 / used as a loop bound; no global |
| `ReadableStreamGetNumReadRequests(stream)` → number | `ReadableStreamOperations.cpp` | `size_t readableStreamGetNumReadRequests(JSReadableStream* stream)` | no | same |
| `ReadableStreamHasBYOBReader(stream)` → boolean | `ReadableStreamOperations.cpp` | `bool readableStreamHasBYOBReader(JSReadableStream* stream)` | no | pure |
| `ReadableStreamHasDefaultReader(stream)` → boolean | `ReadableStreamOperations.cpp` | `bool readableStreamHasDefaultReader(JSReadableStream* stream)` | no | pure |
| `ReadableStreamReaderGenericCancel(reader, reason)` → Promise\<undefined\> | `ReadableStreamOperations.cpp` | `JSC::JSPromise* readableStreamReaderGenericCancel(JSC::JSGlobalObject*, JSReadableStreamGenericReader* reader, JSC::JSValue reason)` | YES(transitive) | → `readableStreamCancel`. `JSReadableStreamGenericReader` = the shared C++ base of the two reader classes (mixin ⇒ base class); if reviewers prefer no shared base, this is 2 overloads |
| `ReadableStreamReaderGenericInitialize(reader, stream)` → undefined | `ReadableStreamOperations.cpp` | `void readableStreamReaderGenericInitialize(JSC::JSGlobalObject*, JSReadableStreamGenericReader* reader, JSReadableStream* stream)` | no | allocates `[[closedPromise]]` (resolved/rejected/pending per state), marks handled on the errored arm; never runs user JS |
| `ReadableStreamReaderGenericRelease(reader)` → undefined | `ReadableStreamOperations.cpp` | `void readableStreamReaderGenericRelease(JSC::JSGlobalObject*, JSReadableStreamGenericReader* reader)` | no | rejects/replaces `[[closedPromise]]` with a fresh TypeError (created, not thrown), calls controller `[[ReleaseSteps]]` (both impls: no user JS), unlinks |
| `ReadableStreamBYOBReaderErrorReadIntoRequests(reader, e)` → undefined | `JSReadableStreamBYOBReader.cpp` | `void readableStreamBYOBReaderErrorReadIntoRequests(JSC::JSGlobalObject*, JSReadableStreamBYOBReader* reader, JSC::JSValue e)` | YES(transitive) | error-steps dispatch over the drained `[[readIntoRequests]]` list |
| `ReadableStreamBYOBReaderRead(reader, view, min, readIntoRequest)` → undefined | `JSReadableStreamBYOBReader.cpp` | `void readableStreamBYOBReaderRead(JSC::JSGlobalObject*, JSReadableStreamBYOBReader* reader, JSC::JSArrayBufferView* view, uint64_t min, JSReadIntoRequest* readIntoRequest)` | YES(transitive) | error-steps dispatch or `readableByteStreamControllerPullInto`; `min` from `[EnforceRange] unsigned long long` ⇒ `uint64_t` |
| `ReadableStreamBYOBReaderRelease(reader)` → undefined | `JSReadableStreamBYOBReader.cpp` | `void readableStreamBYOBReaderRelease(JSC::JSGlobalObject*, JSReadableStreamBYOBReader* reader)` | YES(transitive) | GenericRelease (no) + `…ErrorReadIntoRequests` (dispatch) |
| `ReadableStreamDefaultReaderErrorReadRequests(reader, e)` → undefined | `JSReadableStreamDefaultReader.cpp` | `void readableStreamDefaultReaderErrorReadRequests(JSC::JSGlobalObject*, JSReadableStreamDefaultReader* reader, JSC::JSValue e)` | YES(transitive) | error-steps dispatch |
| `ReadableStreamDefaultReaderRead(reader, readRequest)` → undefined | `JSReadableStreamDefaultReader.cpp` | `void readableStreamDefaultReaderRead(JSC::JSGlobalObject*, JSReadableStreamDefaultReader* reader, JSReadRequest* readRequest)` | YES(transitive) | close/error-steps dispatch, or controller `[[PullSteps]]` → user pull |
| `ReadableStreamDefaultReaderRelease(reader)` → undefined | `JSReadableStreamDefaultReader.cpp` | `void readableStreamDefaultReaderRelease(JSC::JSGlobalObject*, JSReadableStreamDefaultReader* reader)` | YES(transitive) | GenericRelease + `…ErrorReadRequests` (dispatch) |
| `SetUpReadableStreamBYOBReader(reader, stream)` → undefined | `ReadableStreamOperations.cpp` | `void setUpReadableStreamBYOBReader(JSC::JSGlobalObject*, JSReadableStreamBYOBReader* reader, JSReadableStream* stream)` | no | throws TypeError (locked / non-byte controller); GenericInitialize |
| `SetUpReadableStreamDefaultReader(reader, stream)` → undefined | `ReadableStreamOperations.cpp` | `void setUpReadableStreamDefaultReader(JSC::JSGlobalObject*, JSReadableStreamDefaultReader* reader, JSReadableStream* stream)` | no | throws TypeError if locked |
| `ReadableStreamDefaultControllerCallPullIfNeeded(controller)` → undefined | `JSReadableStreamDefaultController.cpp` | `void readableStreamDefaultControllerCallPullIfNeeded(JSC::JSGlobalObject*, JSReadableStreamDefaultController* controller)` | YES(direct) | performs `[[pullAlgorithm]]` (user `pull(controller)` for `SourceKind::JavaScript`) and adopts its return value as a promise (thenable on a user value) |
| `ReadableStreamDefaultControllerShouldCallPull(controller)` → boolean | `JSReadableStreamDefaultController.cpp` | `bool readableStreamDefaultControllerShouldCallPull(JSReadableStreamDefaultController* controller)` | no | pure reads; no global |
| `ReadableStreamDefaultControllerClearAlgorithms(controller)` → undefined | `JSReadableStreamDefaultController.cpp` | `void readableStreamDefaultControllerClearAlgorithms(JSReadableStreamDefaultController* controller)` | no | clears the 3 method/size WriteBarriers (`.clear()`, no VM needed) |
| `ReadableStreamDefaultControllerClose(controller)` → undefined | `JSReadableStreamDefaultController.cpp` | `void readableStreamDefaultControllerClose(JSC::JSGlobalObject*, JSReadableStreamDefaultController* controller)` | YES(transitive) | may call `readableStreamClose` (read-request dispatch) |
| `ReadableStreamDefaultControllerEnqueue(controller, chunk)` → undefined | `JSReadableStreamDefaultController.cpp` | `void readableStreamDefaultControllerEnqueue(JSC::JSGlobalObject*, JSReadableStreamDefaultController* controller, JSC::JSValue chunk)` | YES(direct) | throws (propagates the size algorithm's / EnqueueValueWithSize's abrupt completion). Calls the user `[[strategySizeAlgorithm]]` directly; also FulfillReadRequest dispatch |
| `ReadableStreamDefaultControllerError(controller, e)` → undefined | `JSReadableStreamDefaultController.cpp` | `void readableStreamDefaultControllerError(JSC::JSGlobalObject*, JSReadableStreamDefaultController* controller, JSC::JSValue e)` | YES(transitive) | → `readableStreamError` (error-steps dispatch) |
| `ReadableStreamDefaultControllerGetDesiredSize(controller)` → number \| null | `JSReadableStreamDefaultController.cpp` | `std::optional<double> readableStreamDefaultControllerGetDesiredSize(JSReadableStreamDefaultController* controller)` | no | `nullopt` = spec `null` (errored); no global |
| `ReadableStreamDefaultControllerHasBackpressure(controller)` → boolean | `JSReadableStreamDefaultController.cpp` | `bool readableStreamDefaultControllerHasBackpressure(JSReadableStreamDefaultController* controller)` | no | pure |
| `ReadableStreamDefaultControllerCanCloseOrEnqueue(controller)` → boolean | `JSReadableStreamDefaultController.cpp` | `bool readableStreamDefaultControllerCanCloseOrEnqueue(JSReadableStreamDefaultController* controller)` | no | pure |
| `SetUpReadableStreamDefaultController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm)` → undefined | `ReadableStreamOperations.cpp` (per §1 `SetUpXxx` rule — see Discrepancies #4) | `void setUpReadableStreamDefaultController(JSC::JSGlobalObject*, JSReadableStream* stream, JSReadableStreamDefaultController* controller, JSC::JSValue startMethod, double highWaterMark)` | YES(direct) | pull/cancel/size algorithms = controller members populated by the CALLER before this call (convention #6); performs the start algorithm synchronously (user `start(controller)` for the JS kind — may throw) and adopts `startResult` as a promise (thenable on a user value) |
| `SetUpReadableStreamDefaultControllerFromUnderlyingSource(stream, underlyingSource, underlyingSourceDict, highWaterMark, sizeAlgorithm)` → undefined | `ReadableStreamOperations.cpp` | `void setUpReadableStreamDefaultControllerFromUnderlyingSource(JSC::JSGlobalObject*, JSReadableStream* stream, JSC::JSValue underlyingSource, const UnderlyingSourceDict& underlyingSourceDict, double highWaterMark, JSC::JSObject* sizeAlgorithm)` | YES(transitive) | allocates the controller, stores `SourceKind::JavaScript` + method barriers from the dict, then `setUpReadableStreamDefaultController` (runs user start). Dict already converted (convention #7) — no `[[Get]]`s here |
| `ReadableByteStreamControllerCallPullIfNeeded(controller)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerCallPullIfNeeded(JSC::JSGlobalObject*, JSReadableByteStreamController* controller)` | YES(direct) | performs `[[pullAlgorithm]]` (user pull) + thenable adoption |
| `ReadableByteStreamControllerClearAlgorithms(controller)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerClearAlgorithms(JSReadableByteStreamController* controller)` | no | clears barriers |
| `ReadableByteStreamControllerClearPendingPullIntos(controller)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerClearPendingPullIntos(JSReadableByteStreamController* controller)` | no | InvalidateBYOBRequest + clear deque; no allocation, no throw |
| `ReadableByteStreamControllerClose(controller)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerClose(JSC::JSGlobalObject*, JSReadableByteStreamController* controller)` | YES(transitive) | throws TypeError (partial pull-into) and errors the controller; may call `readableStreamClose` (dispatch) |
| `ReadableByteStreamControllerCommitPullIntoDescriptor(stream, pullIntoDescriptor)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerCommitPullIntoDescriptor(JSC::JSGlobalObject*, JSReadableStream* stream, JSPullIntoDescriptor* pullIntoDescriptor)` | YES(transitive) | Convert (intrinsic view construction, no user JS) + Fulfill(Read/ReadInto)Request dispatch |
| `ReadableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor)` → ArrayBufferView | `JSReadableByteStreamController.cpp` | `JSC::JSArrayBufferView* readableByteStreamControllerConvertPullIntoDescriptor(JSC::JSGlobalObject*, JSPullIntoDescriptor* pullIntoDescriptor)` | no | `TransferArrayBuffer` + `Construct` of the *intrinsic* view constructor recorded in the descriptor (`ViewConstructorKind`) — allocation only; can throw (OOM) |
| `ReadableByteStreamControllerEnqueue(controller, chunk)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerEnqueue(JSC::JSGlobalObject*, JSReadableByteStreamController* controller, JSC::JSArrayBufferView* chunk)` | YES(transitive) | throws (detached buffers, transfer); FulfillReadRequest / FillReadRequestFromQueue dispatch + `…CallPullIfNeeded` (user pull) |
| `ReadableByteStreamControllerEnqueueChunkToQueue(controller, buffer, byteOffset, byteLength)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerEnqueueChunkToQueue(JSC::VM&, JSReadableByteStreamController* controller, JSC::JSArrayBuffer* buffer, size_t byteOffset, size_t byteLength)` | no | appends a `ByteQueueEntry` (WriteBarrier ⇒ needs VM), bumps `[[queueTotalSize]]` |
| `ReadableByteStreamControllerEnqueueClonedChunkToQueue(controller, buffer, byteOffset, byteLength)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerEnqueueClonedChunkToQueue(JSC::JSGlobalObject*, JSReadableByteStreamController* controller, JSC::JSArrayBuffer* buffer, size_t byteOffset, size_t byteLength)` | YES(transitive) | `CloneArrayBuffer` (alloc only); on abrupt completion calls `…ControllerError` (error-steps dispatch) then rethrows |
| `ReadableByteStreamControllerEnqueueDetachedPullIntoToQueue(controller, pullIntoDescriptor)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerEnqueueDetachedPullIntoToQueue(JSC::JSGlobalObject*, JSReadableByteStreamController* controller, JSPullIntoDescriptor* pullIntoDescriptor)` | YES(transitive) | `?` on EnqueueCloned…; throws |
| `ReadableByteStreamControllerError(controller, e)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerError(JSC::JSGlobalObject*, JSReadableByteStreamController* controller, JSC::JSValue e)` | YES(transitive) | → `readableStreamError` |
| `ReadableByteStreamControllerFillHeadPullIntoDescriptor(controller, size, pullIntoDescriptor)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerFillHeadPullIntoDescriptor(JSReadableByteStreamController* controller, size_t size, JSPullIntoDescriptor* pullIntoDescriptor)` | no | pure arithmetic on the descriptor; `size` is a byte count |
| `ReadableByteStreamControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor)` → boolean | `JSReadableByteStreamController.cpp` | `bool readableByteStreamControllerFillPullIntoDescriptorFromQueue(JSReadableByteStreamController* controller, JSPullIntoDescriptor* pullIntoDescriptor)` | no | memmoves between real ArrayBuffers; mutates the byte queue under cellLock; no JS |
| `ReadableByteStreamControllerFillReadRequestFromQueue(controller, readRequest)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerFillReadRequestFromQueue(JSC::JSGlobalObject*, JSReadableByteStreamController* controller, JSReadRequest* readRequest)` | YES(transitive) | `HandleQueueDrain` (→ user pull) THEN read-request chunk-steps dispatch |
| `ReadableByteStreamControllerGetBYOBRequest(controller)` → ReadableStreamBYOBRequest \| null | `JSReadableByteStreamController.cpp` | `JSReadableStreamBYOBRequest* readableByteStreamControllerGetBYOBRequest(JSC::JSGlobalObject*, JSReadableByteStreamController* controller)` | no | lazily allocates the BYOBRequest cell + an intrinsic Uint8Array view; `nullptr` = spec `null` |
| `ReadableByteStreamControllerGetDesiredSize(controller)` → number \| null | `JSReadableByteStreamController.cpp` | `std::optional<double> readableByteStreamControllerGetDesiredSize(JSReadableByteStreamController* controller)` | no | pure |
| `ReadableByteStreamControllerHandleQueueDrain(controller)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerHandleQueueDrain(JSC::JSGlobalObject*, JSReadableByteStreamController* controller)` | YES(transitive) | `readableStreamClose` (dispatch) or `…CallPullIfNeeded` (user pull) |
| `ReadableByteStreamControllerInvalidateBYOBRequest(controller)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerInvalidateBYOBRequest(JSReadableByteStreamController* controller)` | no | clears barriers on the request + controller |
| `ReadableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller)` → list of pull-into descriptors | `JSReadableByteStreamController.cpp` | `WTF::Vector<JSPullIntoDescriptor*, 4> readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(JSReadableByteStreamController* controller)` | no | fills+shifts descriptors; returned raw pointers are stack-rooted (conservative scan) and consumed immediately by the caller's commit loop |
| `ReadableByteStreamControllerProcessReadRequestsUsingQueue(controller)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerProcessReadRequestsUsingQueue(JSC::JSGlobalObject*, JSReadableByteStreamController* controller)` | YES(transitive) | pops read requests and dispatches via FillReadRequestFromQueue |
| `ReadableByteStreamControllerPullInto(controller, view, min, readIntoRequest)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerPullInto(JSC::JSGlobalObject*, JSReadableByteStreamController* controller, JSC::JSArrayBufferView* view, uint64_t min, JSReadIntoRequest* readIntoRequest)` | YES(transitive) | read-into-request dispatch (chunk/close/error steps) + `…CallPullIfNeeded`. TransferArrayBuffer failure goes to error steps, not a throw |
| `ReadableByteStreamControllerRespond(controller, bytesWritten)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerRespond(JSC::JSGlobalObject*, JSReadableByteStreamController* controller, uint64_t bytesWritten)` | YES(transitive) | throws Type/RangeError; `?` RespondInternal |
| `ReadableByteStreamControllerRespondInClosedState(controller, firstDescriptor)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerRespondInClosedState(JSC::JSGlobalObject*, JSReadableByteStreamController* controller, JSPullIntoDescriptor* firstDescriptor)` | YES(transitive) | CommitPullIntoDescriptor dispatch loop |
| `ReadableByteStreamControllerRespondInReadableState(controller, bytesWritten, pullIntoDescriptor)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerRespondInReadableState(JSC::JSGlobalObject*, JSReadableByteStreamController* controller, uint64_t bytesWritten, JSPullIntoDescriptor* pullIntoDescriptor)` | YES(transitive) | throws (`?` EnqueueCloned/Detached); Commit dispatch |
| `ReadableByteStreamControllerRespondInternal(controller, bytesWritten)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerRespondInternal(JSC::JSGlobalObject*, JSReadableByteStreamController* controller, uint64_t bytesWritten)` | YES(transitive) | throws; RespondIn{Closed,Readable}State + `…CallPullIfNeeded` |
| `ReadableByteStreamControllerRespondWithNewView(controller, view)` → undefined | `JSReadableByteStreamController.cpp` | `void readableByteStreamControllerRespondWithNewView(JSC::JSGlobalObject*, JSReadableByteStreamController* controller, JSC::JSArrayBufferView* view)` | YES(transitive) | throws Type/RangeError; `?` TransferArrayBuffer; RespondInternal |
| `ReadableByteStreamControllerShiftPendingPullInto(controller)` → pull-into descriptor | `JSReadableByteStreamController.cpp` | `JSPullIntoDescriptor* readableByteStreamControllerShiftPendingPullInto(JSReadableByteStreamController* controller)` | no | pops the head descriptor (still GC-live via the returned stack pointer) |
| `ReadableByteStreamControllerShouldCallPull(controller)` → boolean | `JSReadableByteStreamController.cpp` | `bool readableByteStreamControllerShouldCallPull(JSReadableByteStreamController* controller)` | no | pure |
| `SetUpReadableByteStreamController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, autoAllocateChunkSize)` → undefined | `ReadableStreamOperations.cpp` (`SetUpXxx` rule; see Discrepancies #4) | `void setUpReadableByteStreamController(JSC::JSGlobalObject*, JSReadableStream* stream, JSReadableByteStreamController* controller, JSC::JSValue startMethod, double highWaterMark, std::optional<uint64_t> autoAllocateChunkSize)` | YES(direct) | runs the user start synchronously + thenable adoption of `startResult`; `nullopt` = spec `undefined` (auto-alloc off) |
| `SetUpReadableByteStreamControllerFromUnderlyingSource(stream, underlyingSource, underlyingSourceDict, highWaterMark)` → undefined | `ReadableStreamOperations.cpp` | `void setUpReadableByteStreamControllerFromUnderlyingSource(JSC::JSGlobalObject*, JSReadableStream* stream, JSC::JSValue underlyingSource, const UnderlyingSourceDict& underlyingSourceDict, double highWaterMark)` | YES(transitive) | throws TypeError on `autoAllocateChunkSize === 0`; → `setUpReadableByteStreamController` (user start) |

### From `digest/03-writable.md` (42 ops)

| Spec op | Owner file (§1) | Proposed C++ declaration | userJS? | notes |
|---|---|---|---|---|
| `AcquireWritableStreamDefaultWriter(stream)` → WritableStreamDefaultWriter | `WritableStreamOperations.cpp` | `JSWritableStreamDefaultWriter* acquireWritableStreamDefaultWriter(JSC::JSGlobalObject*, JSWritableStream* stream)` | no | throws TypeError if locked; allocates writer + promises |
| `CreateWritableStream(startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm)` → WritableStream | `WritableStreamOperations.cpp` | `JSWritableStream* createWritableStream(JSC::JSGlobalObject*, SinkKind, JSC::JSCell* sinkState, double highWaterMark, JSC::JSObject* sizeAlgorithm)` | YES(transitive) | internal-only; algorithm quadruple ⇒ `SinkKind` + kind-state cell (convention #6); via `setUpWritableStreamDefaultController` (start) |
| `InitializeWritableStream(stream)` → undefined | `WritableStreamOperations.cpp` | `void initializeWritableStream(JSWritableStream* stream)` | no | pure state reset (clears slots, empty write-request list, backpressure=false) |
| `IsWritableStreamLocked(stream)` → boolean | `WritableStreamOperations.cpp` | `bool isWritableStreamLocked(JSWritableStream* stream)` | no | pure |
| `SetUpWritableStreamDefaultWriter(writer, stream)` → undefined | `WritableStreamOperations.cpp` | `void setUpWritableStreamDefaultWriter(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter* writer, JSWritableStream* stream)` | no | throws TypeError if locked; allocates/marks ready+closed promises per state |
| `WritableStreamAbort(stream, reason)` → Promise | `WritableStreamOperations.cpp` | `JSC::JSPromise* writableStreamAbort(JSC::JSGlobalObject*, JSWritableStream* stream, JSC::JSValue reason)` | YES(direct) | "signal abort on `[[abortController]]`" fires user `abort`-event listeners **synchronously** (the spec re-checks `[[state]]` right after for exactly this reason); then StartErroring → controller `[[AbortSteps]]` (user abort) |
| `WritableStreamClose(stream)` → Promise | `WritableStreamOperations.cpp` | `JSC::JSPromise* writableStreamClose(JSC::JSGlobalObject*, JSWritableStream* stream)` | YES(transitive) | → `writableStreamDefaultControllerClose` → advance queue → user close/write algorithm |
| `WritableStreamAddWriteRequest(stream)` → Promise | `WritableStreamOperations.cpp` | `JSC::JSPromise* writableStreamAddWriteRequest(JSC::JSGlobalObject*, JSWritableStream* stream)` | no | allocates a promise we own and appends it |
| `WritableStreamCloseQueuedOrInFlight(stream)` → boolean | `WritableStreamOperations.cpp` | `bool writableStreamCloseQueuedOrInFlight(JSWritableStream* stream)` | no | pure |
| `WritableStreamDealWithRejection(stream, error)` → undefined | `WritableStreamOperations.cpp` | `void writableStreamDealWithRejection(JSC::JSGlobalObject*, JSWritableStream* stream, JSC::JSValue error)` | YES(transitive) | → StartErroring / FinishErroring (→ user abort algorithm) |
| `WritableStreamFinishErroring(stream)` → undefined | `WritableStreamOperations.cpp` | `void writableStreamFinishErroring(JSC::JSGlobalObject*, JSWritableStream* stream)` | YES(transitive) | controller `[[ErrorSteps]]` (no) then `[[AbortSteps]]` = user abort algorithm; write-request rejections are async |
| `WritableStreamFinishInFlightClose(stream)` → undefined | `WritableStreamOperations.cpp` | `void writableStreamFinishInFlightClose(JSC::JSGlobalObject*, JSWritableStream* stream)` | no | resolves promises we own; state flips |
| `WritableStreamFinishInFlightCloseWithError(stream, error)` → undefined | `WritableStreamOperations.cpp` | `void writableStreamFinishInFlightCloseWithError(JSC::JSGlobalObject*, JSWritableStream* stream, JSC::JSValue error)` | YES(transitive) | → DealWithRejection |
| `WritableStreamFinishInFlightWrite(stream)` → undefined | `WritableStreamOperations.cpp` | `void writableStreamFinishInFlightWrite(JSC::JSGlobalObject*, JSWritableStream* stream)` | no | resolves our promise |
| `WritableStreamFinishInFlightWriteWithError(stream, error)` → undefined | `WritableStreamOperations.cpp` | `void writableStreamFinishInFlightWriteWithError(JSC::JSGlobalObject*, JSWritableStream* stream, JSC::JSValue error)` | YES(transitive) | → DealWithRejection |
| `WritableStreamHasOperationMarkedInFlight(stream)` → boolean | `WritableStreamOperations.cpp` | `bool writableStreamHasOperationMarkedInFlight(JSWritableStream* stream)` | no | pure |
| `WritableStreamMarkCloseRequestInFlight(stream)` → undefined | `WritableStreamOperations.cpp` | `void writableStreamMarkCloseRequestInFlight(JSC::VM&, JSWritableStream* stream)` | no | moves one WriteBarrier slot to another |
| `WritableStreamMarkFirstWriteRequestInFlight(stream)` → undefined | `WritableStreamOperations.cpp` | `void writableStreamMarkFirstWriteRequestInFlight(JSC::VM&, JSWritableStream* stream)` | no | pops the deque head into `[[inFlightWriteRequest]]` |
| `WritableStreamRejectCloseAndClosedPromiseIfNeeded(stream)` → undefined | `WritableStreamOperations.cpp` | `void writableStreamRejectCloseAndClosedPromiseIfNeeded(JSC::JSGlobalObject*, JSWritableStream* stream)` | no | rejects + marks-handled promises we own |
| `WritableStreamStartErroring(stream, reason)` → undefined | `WritableStreamOperations.cpp` | `void writableStreamStartErroring(JSC::JSGlobalObject*, JSWritableStream* stream, JSC::JSValue reason)` | YES(transitive) | may call FinishErroring (→ user abort algorithm) |
| `WritableStreamUpdateBackpressure(stream, backpressure)` → undefined | `WritableStreamOperations.cpp` | `void writableStreamUpdateBackpressure(JSC::JSGlobalObject*, JSWritableStream* stream, bool backpressure)` | no | allocates / resolves the writer's `[[readyPromise]]` (ours) |
| `WritableStreamDefaultWriterAbort(writer, reason)` → Promise | `JSWritableStreamDefaultWriter.cpp` | `JSC::JSPromise* writableStreamDefaultWriterAbort(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter* writer, JSC::JSValue reason)` | YES(transitive) | → `writableStreamAbort` (user abort-signal listeners + sink abort) |
| `WritableStreamDefaultWriterClose(writer)` → Promise | `JSWritableStreamDefaultWriter.cpp` | `JSC::JSPromise* writableStreamDefaultWriterClose(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter* writer)` | YES(transitive) | → `writableStreamClose` |
| `WritableStreamDefaultWriterCloseWithErrorPropagation(writer)` → Promise | `JSWritableStreamDefaultWriter.cpp` | `JSC::JSPromise* writableStreamDefaultWriterCloseWithErrorPropagation(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter* writer)` | YES(transitive) | pipe helper; → `writableStreamDefaultWriterClose` |
| `WritableStreamDefaultWriterEnsureClosedPromiseRejected(writer, error)` → undefined | `JSWritableStreamDefaultWriter.cpp` | `void writableStreamDefaultWriterEnsureClosedPromiseRejected(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter* writer, JSC::JSValue error)` | no | reject-or-replace `[[closedPromise]]` + markAsHandled |
| `WritableStreamDefaultWriterEnsureReadyPromiseRejected(writer, error)` → undefined | `JSWritableStreamDefaultWriter.cpp` | `void writableStreamDefaultWriterEnsureReadyPromiseRejected(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter* writer, JSC::JSValue error)` | no | same for `[[readyPromise]]` |
| `WritableStreamDefaultWriterGetDesiredSize(writer)` → Number or null | `JSWritableStreamDefaultWriter.cpp` | `std::optional<double> writableStreamDefaultWriterGetDesiredSize(JSWritableStreamDefaultWriter* writer)` | no | `nullopt` = spec `null` (errored/erroring); no global |
| `WritableStreamDefaultWriterRelease(writer)` → undefined | `JSWritableStreamDefaultWriter.cpp` | `void writableStreamDefaultWriterRelease(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter* writer)` | no | creates a TypeError value; Ensure*Rejected only |
| `WritableStreamDefaultWriterWrite(writer, chunk)` → Promise | `JSWritableStreamDefaultWriter.cpp` | `JSC::JSPromise* writableStreamDefaultWriterWrite(JSC::JSGlobalObject*, JSWritableStreamDefaultWriter* writer, JSC::JSValue chunk)` | YES(transitive) | `writableStreamDefaultControllerGetChunkSize` runs the user `size()` FIRST — the spec then re-checks `writer.[[stream]]` because that call is reentrant |
| `SetUpWritableStreamDefaultController(stream, controller, startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm)` → undefined | `WritableStreamOperations.cpp` (`SetUpXxx` rule) | `void setUpWritableStreamDefaultController(JSC::JSGlobalObject*, JSWritableStream* stream, JSWritableStreamDefaultController* controller, JSC::JSValue startMethod, double highWaterMark)` | YES(direct) | write/close/abort/size algorithms = controller members populated by the caller (convention #6); allocates the `[[abortController]]`; runs the user start synchronously + thenable adoption of `startResult` |
| `SetUpWritableStreamDefaultControllerFromUnderlyingSink(stream, underlyingSink, underlyingSinkDict, highWaterMark, sizeAlgorithm)` → undefined | `WritableStreamOperations.cpp` | `void setUpWritableStreamDefaultControllerFromUnderlyingSink(JSC::JSGlobalObject*, JSWritableStream* stream, JSC::JSValue underlyingSink, const UnderlyingSinkDict& underlyingSinkDict, double highWaterMark, JSC::JSObject* sizeAlgorithm)` | YES(transitive) | allocates the controller, `SinkKind::JavaScript` members, → `setUpWritableStreamDefaultController` |
| `WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller)` → undefined | `JSWritableStreamDefaultController.cpp` | `void writableStreamDefaultControllerAdvanceQueueIfNeeded(JSC::JSGlobalObject*, JSWritableStreamDefaultController* controller)` | YES(transitive) | → FinishErroring / ProcessClose / ProcessWrite (all reach user algorithms) |
| `WritableStreamDefaultControllerClearAlgorithms(controller)` → undefined | `JSWritableStreamDefaultController.cpp` | `void writableStreamDefaultControllerClearAlgorithms(JSWritableStreamDefaultController* controller)` | no | clears barriers; idempotent |
| `WritableStreamDefaultControllerClose(controller)` → undefined | `JSWritableStreamDefaultController.cpp` | `void writableStreamDefaultControllerClose(JSC::JSGlobalObject*, JSWritableStreamDefaultController* controller)` | YES(transitive) | enqueues the close sentinel (size 0 — cannot throw) + AdvanceQueueIfNeeded |
| `WritableStreamDefaultControllerError(controller, error)` → undefined | `JSWritableStreamDefaultController.cpp` | `void writableStreamDefaultControllerError(JSC::JSGlobalObject*, JSWritableStreamDefaultController* controller, JSC::JSValue error)` | YES(transitive) | → StartErroring |
| `WritableStreamDefaultControllerErrorIfNeeded(controller, error)` → undefined | `JSWritableStreamDefaultController.cpp` | `void writableStreamDefaultControllerErrorIfNeeded(JSC::JSGlobalObject*, JSWritableStreamDefaultController* controller, JSC::JSValue error)` | YES(transitive) | gated `…ControllerError` |
| `WritableStreamDefaultControllerGetBackpressure(controller)` → boolean | `JSWritableStreamDefaultController.cpp` | `bool writableStreamDefaultControllerGetBackpressure(JSWritableStreamDefaultController* controller)` | no | pure |
| `WritableStreamDefaultControllerGetChunkSize(controller, chunk)` → Number | `JSWritableStreamDefaultController.cpp` | `double writableStreamDefaultControllerGetChunkSize(JSC::JSGlobalObject*, JSWritableStreamDefaultController* controller, JSC::JSValue chunk)` | YES(direct) | calls the user `[[strategySizeAlgorithm]]`; converts its abrupt completion into `…ErrorIfNeeded` + returns 1 (never throws out) |
| `WritableStreamDefaultControllerGetDesiredSize(controller)` → Number | `JSWritableStreamDefaultController.cpp` | `double writableStreamDefaultControllerGetDesiredSize(JSWritableStreamDefaultController* controller)` | no | plain number (never null at this layer) |
| `WritableStreamDefaultControllerProcessClose(controller)` → undefined | `JSWritableStreamDefaultController.cpp` | `void writableStreamDefaultControllerProcessClose(JSC::JSGlobalObject*, JSWritableStreamDefaultController* controller)` | YES(direct) | performs the user `[[closeAlgorithm]]` + thenable adoption of its result |
| `WritableStreamDefaultControllerProcessWrite(controller, chunk)` → undefined | `JSWritableStreamDefaultController.cpp` | `void writableStreamDefaultControllerProcessWrite(JSC::JSGlobalObject*, JSWritableStreamDefaultController* controller, JSC::JSValue chunk)` | YES(direct) | performs the user `[[writeAlgorithm]]` + thenable adoption |
| `WritableStreamDefaultControllerWrite(controller, chunk, chunkSize)` → undefined | `JSWritableStreamDefaultController.cpp` | `void writableStreamDefaultControllerWrite(JSC::JSGlobalObject*, JSWritableStreamDefaultController* controller, JSC::JSValue chunk, double chunkSize)` | YES(transitive) | EnqueueValueWithSize failure → `…ErrorIfNeeded` (never rethrows); AdvanceQueueIfNeeded |

### From `digest/04-transform-queuing-support.md` (34 ops)

| Spec op | Owner file (§1) | Proposed C++ declaration | userJS? | notes |
|---|---|---|---|---|
| `InitializeTransformStream(stream, startPromise, writableHighWaterMark, writableSizeAlgorithm, readableHighWaterMark, readableSizeAlgorithm)` → undefined | `TransformStreamOperations.cpp` | `void initializeTransformStream(JSC::JSGlobalObject*, JSTransformStream* stream, JSC::JSPromise* startPromise, double writableHighWaterMark, JSC::JSObject* writableSizeAlgorithm, double readableHighWaterMark, JSC::JSObject* readableSizeAlgorithm)` | YES(transitive) | creates `[[writable]]` (`SinkKind::TransformSink`) and `[[readable]]` (`SourceKind::TransformSource`) via `createWritableStream`/`createReadableStream` — see Discrepancies #2; start algorithm = returns `startPromise` (ours), so no user JS in practice |
| `TransformStreamError(stream, e)` → undefined | `TransformStreamOperations.cpp` | `void transformStreamError(JSC::JSGlobalObject*, JSTransformStream* stream, JSC::JSValue e)` | YES(transitive) | → `readableStreamDefaultControllerError` + `transformStreamErrorWritableAndUnblockWrite` |
| `TransformStreamErrorWritableAndUnblockWrite(stream, e)` → undefined | `TransformStreamOperations.cpp` | `void transformStreamErrorWritableAndUnblockWrite(JSC::JSGlobalObject*, JSTransformStream* stream, JSC::JSValue e)` | YES(transitive) | → `writableStreamDefaultControllerErrorIfNeeded` |
| `TransformStreamSetBackpressure(stream, backpressure)` → undefined | `TransformStreamOperations.cpp` | `void transformStreamSetBackpressure(JSC::JSGlobalObject*, JSTransformStream* stream, bool backpressure)` | no | resolves the old `[[backpressureChangePromise]]` (ours) + allocates the new one |
| `TransformStreamUnblockWrite(stream)` → undefined | `TransformStreamOperations.cpp` | `void transformStreamUnblockWrite(JSC::JSGlobalObject*, JSTransformStream* stream)` | no | → SetBackpressure(false) |
| `SetUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm, cancelAlgorithm)` → undefined | `TransformStreamOperations.cpp` (`SetUpXxx` rule) | `void setUpTransformStreamDefaultController(JSC::VM&, JSTransformStream* stream, JSTransformStreamDefaultController* controller)` | no | pure state wiring; the three algorithms are the controller's already-populated transformer members (convention #6). No global — nothing allocates or throws |
| `SetUpTransformStreamDefaultControllerFromTransformer(stream, transformer, transformerDict)` → undefined | `TransformStreamOperations.cpp` | `void setUpTransformStreamDefaultControllerFromTransformer(JSC::JSGlobalObject*, JSTransformStream* stream, JSC::JSValue transformer, const TransformerDict& transformerDict)` | no | allocates the controller cell, stores the converted method barriers (no `[[Get]]`s here — convention #7), then `setUpTransformStreamDefaultController`. The absent-`transform` case is the identity-transform arm |
| `TransformStreamDefaultControllerClearAlgorithms(controller)` → undefined | `JSTransformStreamDefaultController.cpp` | `void transformStreamDefaultControllerClearAlgorithms(JSTransformStreamDefaultController* controller)` | no | clears barriers |
| `TransformStreamDefaultControllerEnqueue(controller, chunk)` → undefined (throws) | `JSTransformStreamDefaultController.cpp` | `void transformStreamDefaultControllerEnqueue(JSC::JSGlobalObject*, JSTransformStreamDefaultController* controller, JSC::JSValue chunk)` | YES(transitive) | throws TypeError / rethrows `[[storedError]]`; → `readableStreamDefaultControllerEnqueue` (user readable-side `size()`) |
| `TransformStreamDefaultControllerError(controller, e)` → undefined | `JSTransformStreamDefaultController.cpp` | `void transformStreamDefaultControllerError(JSC::JSGlobalObject*, JSTransformStreamDefaultController* controller, JSC::JSValue e)` | YES(transitive) | → `transformStreamError` |
| `TransformStreamDefaultControllerPerformTransform(controller, chunk)` → Promise | `JSTransformStreamDefaultController.cpp` | `JSC::JSPromise* transformStreamDefaultControllerPerformTransform(JSC::JSGlobalObject*, JSTransformStreamDefaultController* controller, JSC::JSValue chunk)` | YES(direct) | performs the user `[[transformAlgorithm]]` + thenable adoption of its return value |
| `TransformStreamDefaultControllerTerminate(controller)` → undefined | `JSTransformStreamDefaultController.cpp` | `void transformStreamDefaultControllerTerminate(JSC::JSGlobalObject*, JSTransformStreamDefaultController* controller)` | YES(transitive) | → RS close (dispatch) + ErrorWritableAndUnblockWrite |
| `TransformStreamDefaultSinkWriteAlgorithm(stream, chunk)` → Promise | `TransformStreamOperations.cpp` | `JSC::JSPromise* transformStreamDefaultSinkWriteAlgorithm(JSC::JSGlobalObject*, JSTransformStream* stream, JSC::JSValue chunk)` | YES(transitive) | when no backpressure, immediately → PerformTransform (user transform); otherwise reacts to `[[backpressureChangePromise]]` |
| `TransformStreamDefaultSinkAbortAlgorithm(stream, reason)` → Promise | `TransformStreamOperations.cpp` | `JSC::JSPromise* transformStreamDefaultSinkAbortAlgorithm(JSC::JSGlobalObject*, JSTransformStream* stream, JSC::JSValue reason)` | YES(direct) | performs the user `[[cancelAlgorithm]]` synchronously |
| `TransformStreamDefaultSinkCloseAlgorithm(stream)` → Promise | `TransformStreamOperations.cpp` | `JSC::JSPromise* transformStreamDefaultSinkCloseAlgorithm(JSC::JSGlobalObject*, JSTransformStream* stream)` | YES(direct) | performs the user `[[flushAlgorithm]]` |
| `TransformStreamDefaultSourceCancelAlgorithm(stream, reason)` → Promise | `TransformStreamOperations.cpp` | `JSC::JSPromise* transformStreamDefaultSourceCancelAlgorithm(JSC::JSGlobalObject*, JSTransformStream* stream, JSC::JSValue reason)` | YES(direct) | performs the user `[[cancelAlgorithm]]` |
| `TransformStreamDefaultSourcePullAlgorithm(stream)` → Promise | `TransformStreamOperations.cpp` | `JSC::JSPromise* transformStreamDefaultSourcePullAlgorithm(JSC::JSGlobalObject*, JSTransformStream* stream)` | no | SetBackpressure(false) + returns `[[backpressureChangePromise]]` (ours) |
| `ExtractHighWaterMark(strategy, defaultHWM)` → Number (throws) | `WebStreamsMisc.cpp` | `double extractHighWaterMark(JSC::JSGlobalObject*, const QueuingStrategyDict& strategy, double defaultHWM)` | no | throws RangeError on NaN / negative; +∞ allowed. Operates on the ALREADY-converted dictionary (convention #7) — the user `highWaterMark` getter fired during conversion in the caller, not here |
| `ExtractSizeAlgorithm(strategy)` → algorithm | `WebStreamsMisc.cpp` | `JSC::JSObject* extractSizeAlgorithm(const QueuingStrategyDict& strategy)` | no | returns the converted `size` callback object, or `nullptr` = the default `() => 1` (ARCH §4: null `m_strategySizeAlgorithm`); callability was enforced by the WebIDL callback conversion |
| `DequeueValue(container)` → any | `StreamQueue.h` (method `StreamQueue<ValueWithSize>::dequeueValue`) | `JSC::JSValue StreamQueue<ValueWithSize>::dequeueValue(JSC::JSCell* owner)` | no | container = the owning controller's `StreamQueue` member; clamps `totalSize` at 0; cellLock |
| `EnqueueValueWithSize(container, value, size)` → undefined (throws) | `StreamQueue.h` (method) | `void StreamQueue<ValueWithSize>::enqueueValueWithSize(JSC::JSGlobalObject*, JSC::JSCell* owner, JSC::JSValue value, double size)` | no | throws RangeError on non-finite / negative `size`; the size was computed by the CALLER's size algorithm — this op runs no user JS |
| `PeekQueueValue(container)` → any | `StreamQueue.h` (method) | `JSC::JSValue StreamQueue<ValueWithSize>::peekQueueValue() const` | no | pure |
| `ResetQueue(container)` → undefined | `StreamQueue.h` (method) | `void StreamQueue<ValueWithSize>::resetQueue(JSC::JSCell* owner)` (and a `StreamQueue<ByteQueueEntry>` instantiation for the byte controller) | no | clears deque + `totalSize = 0` under cellLock |
| `CrossRealmTransformSendError(port, error)` → undefined | `CrossRealmTransform.cpp` | `void crossRealmTransformSendError(JSC::JSGlobalObject*, WebCore::MessagePort& port, JSC::JSValue error)` | YES(transitive) | → PackAndPostMessage, result discarded (exception caught & cleared at this boundary — see Discrepancies #7) |
| `PackAndPostMessage(port, type, value)` → undefined (may be abrupt) | `CrossRealmTransform.cpp` | `void packAndPostMessage(JSC::JSGlobalObject*, WebCore::MessagePort& port, CrossRealmMessageType type, JSC::JSValue value)` | YES(direct) | structured-serialization of the user `value` (chunk/error) performs `[[Get]]`s on it → getters/Proxy traps run. Throws (serialization failure). See Discrepancies #3. `type` is the closed 4-string set ⇒ `CrossRealmMessageType` enum |
| `PackAndPostMessageHandlingError(port, type, value)` → completion record | `CrossRealmTransform.cpp` | `bool packAndPostMessageHandlingError(JSC::JSGlobalObject*, WebCore::MessagePort& port, CrossRealmMessageType type, JSC::JSValue value)` | YES(transitive) | returns `true` = normal completion; on `false` the abrupt completion has ALREADY been forwarded via `crossRealmTransformSendError` and is left pending on the throw scope for the caller to convert into a rejected promise (Discrepancies #7) |
| `SetUpCrossRealmTransformReadable(stream, port)` → undefined | `CrossRealmTransform.cpp` | `void setUpCrossRealmTransformReadable(JSC::JSGlobalObject*, JSReadableStream* stream, WebCore::MessagePort& port)` | YES(transitive) | registers native message handlers + `setUpReadableStreamDefaultController` with `SourceKind::CrossRealm` (start = native no-op ⇒ no user JS in practice; YES only through the setUp callee) |
| `SetUpCrossRealmTransformWritable(stream, port)` → undefined | `CrossRealmTransform.cpp` | `void setUpCrossRealmTransformWritable(JSC::JSGlobalObject*, JSWritableStream* stream, WebCore::MessagePort& port)` | YES(transitive) | same shape, `SinkKind::CrossRealm`; owns the `backpressurePromise` |
| `CanTransferArrayBuffer(O)` → boolean | `WebStreamsMisc.cpp` | `bool canTransferArrayBuffer(JSC::JSArrayBuffer* buffer)` | no | pure (detached? detach-key?) — per brief seed fact; no global |
| `IsNonNegativeNumber(v)` → boolean | `WebStreamsMisc.cpp` | `bool isNonNegativeNumber(JSC::JSValue v)` | no | pure type+range test (`v.isNumber()` — no coercion) |
| `TransferArrayBuffer(O)` → ArrayBuffer (throws) | `WebStreamsMisc.cpp` | `JSC::JSArrayBuffer* transferArrayBuffer(JSC::JSGlobalObject*, JSC::JSArrayBuffer* buffer)` | no | `DetachArrayBuffer` + new JSArrayBuffer over the same contents; throws TypeError on a non-transferable detach key; never runs user JS |
| `CloneAsUint8Array(O)` → Uint8Array (throws) | `WebStreamsMisc.cpp` | `JSC::JSUint8Array* cloneAsUint8Array(JSC::JSGlobalObject*, JSC::JSArrayBufferView* view)` | no | `CloneArrayBuffer` + intrinsic `Uint8Array` construction; allocation-throws only |
| `StructuredClone(v)` → any (throws) | `WebStreamsMisc.cpp` | `JSC::JSValue structuredClone(JSC::JSGlobalObject*, JSC::JSValue v)` | YES(direct) | StructuredSerialize of a user value reads its own properties (accessor/Proxy ⇒ user JS) — ARCH §7 rule 2 lists `structuredClone` as user-JS-running. See Discrepancies #3 (the task brief's seed fact says `no`) |
| `CanCopyDataBlockBytes(toBuffer, toIndex, fromBuffer, fromIndex, count)` → boolean | `WebStreamsMisc.cpp` | `bool canCopyDataBlockBytes(JSC::JSArrayBuffer* toBuffer, size_t toIndex, JSC::JSArrayBuffer* fromBuffer, size_t fromIndex, size_t count)` | no | pure bounds/detach/aliasing check; used only inside an assertion the spec says MUST be checked (error the stream / crash on failure) |

---

## Structs

Everything below is declared in `WebStreamsInternals.h` (except the two queue entry types +
`StreamQueue`, which live in `StreamQueue.h`, and the two GC cells, which live in their own
`.h` per §1). Field lists are taken from the digests' struct definitions, not from memory.

```cpp
// ===== StreamQueue.h (§3.3) — the "queue-with-sizes" container ==============================

// value-with-size (digest 04 §Queue-with-sizes): items `value`, `size`.
struct ValueWithSize {
    JSC::WriteBarrier<JSC::Unknown> value;
    double size;
};

// readable byte stream queue entry (digest 01/02): buffer, byte offset, byte length.
struct ByteQueueEntry {
    JSC::WriteBarrier<JSC::JSArrayBuffer> buffer; // always a transferred (owned) ArrayBuffer
    size_t byteOffset;
    size_t byteLength;
};

// The [[queue]] + [[queueTotalSize]] pair. A member of JSReadableStreamDefaultController,
// JSReadableByteStreamController (ByteQueueEntry; totalSize still a double per spec note),
// and JSWritableStreamDefaultController. ALL mutation and GC visitation happen under
// WTF::Locker { owner->cellLock() } (§3.3).
template<typename Entry>
class StreamQueue {
public:
    // spec: EnqueueValueWithSize(container, value, size) — throws RangeError on bad size.
    void enqueueValueWithSize(JSC::JSGlobalObject*, JSC::JSCell* owner, JSC::JSValue value, double size);
    // spec: DequeueValue(container)
    JSC::JSValue dequeueValue(JSC::JSCell* owner);
    // spec: PeekQueueValue(container)
    JSC::JSValue peekQueueValue() const;
    // spec: ResetQueue(container)
    void resetQueue(JSC::JSCell* owner);

    bool isEmpty() const;
    size_t size() const;
    double totalSize() const;               // [[queueTotalSize]] — a double, never an integer
    // byte-queue-only manual mutators (the spec updates the byte controller's two slots by
    // hand): appendEntry / firstEntry / removeFirstEntry / adjustTotalSize.
    template<typename Visitor> void visitAggregate(JSC::JSCell* owner, Visitor&); // under cellLock

private:
    WTF::Deque<Entry, 4> m_queue;
    double m_totalSize { 0 };
};

// The WritableStream "close sentinel" enqueued by WritableStreamDefaultControllerClose is
// represented as an EMPTY JSC::JSValue() in a ValueWithSize (a real chunk is never the empty
// value; `undefined` IS a legal chunk and must not be conflated with the sentinel).

// ===== JSPullIntoDescriptor.h (§3.4) — a non-destructible GC cell ==========================
// Fields = the digest's pull-into descriptor items, exactly.
class JSPullIntoDescriptor final : public JSC::JSInternalFieldObjectImpl<0> {
public:
    JSC::WriteBarrier<JSC::JSArrayBuffer> buffer; // "buffer"
    size_t bufferByteLength;                      // "buffer byte length"
    size_t byteOffset;                            // "byte offset"
    size_t byteLength;                            // "byte length"
    size_t bytesFilled;                           // "bytes filled"
    size_t minimumFill;                           // "minimum fill"
    uint8_t elementSize;                          // "element size" (1..8)
    ViewConstructorKind viewConstructor;          // "view constructor" (intrinsic, never user)
    ReaderType readerType;                        // "reader type": Default / Byob / None
    // DECLARE_VISIT_CHILDREN (visits `buffer`)
};

// ===== JSReadRequest.h (§5) — the read-request / read-into-request vtables =================
class JSReadRequest : public JSC::JSNonFinalObject {
public:
    // read request items (digest 01/02):
    virtual void chunkSteps(JSC::JSGlobalObject*, JSC::JSValue chunk) = 0; // userJS: see §Internal methods note
    virtual void closeSteps(JSC::JSGlobalObject*) = 0;
    virtual void errorSteps(JSC::JSGlobalObject*, JSC::JSValue error) = 0;
    // subclasses: JSPromiseReadRequest, JSPipeToReadRequest, JSTeeReadRequest,
    // JSByteTeeReadRequest, JSAsyncIteratorReadRequest, Bun fast-path requests (TBD(bun-ext)).
    // Each has its own ClassInfo + iso subspace + visitChildren.
};

class JSReadIntoRequest : public JSC::JSNonFinalObject {
public:
    // read-into request items — NOTE: close steps take a chunk (or undefined).
    virtual void chunkSteps(JSC::JSGlobalObject*, JSC::JSValue chunk) = 0;
    virtual void closeSteps(JSC::JSGlobalObject*, JSC::JSValue chunkOrUndefined) = 0;
    virtual void errorSteps(JSC::JSGlobalObject*, JSC::JSValue error) = 0;
    // subclasses: JSPromiseReadIntoRequest, JSByteTeeReadIntoRequest.
};

// ===== WebStreamsInternals.h — plain structs ================================================

// WritableStream "pending abort request" (digest 03): promise, reason, was already erroring.
struct PendingAbortRequest {
    JSC::WriteBarrier<JSC::JSPromise> promise;
    JSC::WriteBarrier<JSC::Unknown> reason;
    bool wasAlreadyErroring { false };
    // `[[pendingAbortRequest]] = undefined` ⇔ `!promise` (gate on the barrier, not a bool)
};

// Converted WebIDL dictionaries (convention #7). STACK-ONLY carriers: the JSValues are rooted
// by the conservative stack scan for the duration of the constructor; never stored.
// A member holds an empty JSValue when the dictionary member is absent.
struct UnderlyingSourceDict {
    JSC::JSValue start;                            // callable or empty
    JSC::JSValue pull;                             // callable or empty
    JSC::JSValue cancel;                           // callable or empty
    std::optional<ReadableStreamType> type;        // "bytes" or absent
    std::optional<uint64_t> autoAllocateChunkSize; // [EnforceRange] unsigned long long
};
struct UnderlyingSinkDict {
    JSC::JSValue start, write, close, abort;       // callable or empty
    bool hasType { false };                        // presence alone triggers the RangeError
};
struct TransformerDict {
    JSC::JSValue start, transform, flush, cancel;  // callable or empty
    bool hasReadableType { false };
    bool hasWritableType { false };
};
struct QueuingStrategyDict {
    std::optional<double> highWaterMark;           // absent vs present-NaN are distinct states
    JSC::JSValue size;                             // callable or empty (empty ⇒ default `()=>1`)
};
```

`[[readRequests]]` / `[[readIntoRequests]]` / `[[writeRequests]]` / `[[pendingPullIntos]]` are
`WTF::Deque<JSC::WriteBarrier<T>>` members (T = `JSReadRequest`, `JSReadIntoRequest`,
`JSC::JSPromise`, `JSPullIntoDescriptor`) on their owning cell, mutated and visited under
`cellLock()` exactly like `StreamQueue` (§3.3).

---

## Enums

```cpp
// [[state]] machines (§3.1)
enum class ReadableStreamState : uint8_t { Readable, Closed, Errored };
enum class WritableStreamState : uint8_t { Writable, Erroring, Errored, Closed };

// Pull-into descriptor / release bookkeeping "reader type" (digest: "default"/"byob"/"none")
enum class ReaderType : uint8_t { Default, Byob, None };

// §4: which arm runs the pull/cancel (RS) algorithms. No closures.
enum class SourceKind : uint8_t {
    JavaScript,      // user underlyingSource: m_underlyingSource + m_pullMethod + m_cancelMethod
    TeeBranch,       // ReadableStreamDefaultTee branches (JSStreamTeeState + branch index)
    ByteTeeBranch,   // ReadableByteStreamTee branches (distinct algorithm, §6)
    FromIterable,    // ReadableStreamFromIterable (holds the iterator record cell)
    TransformSource, // TransformStreamDefaultSource{Pull,Cancel}Algorithm  (see Discrepancies #2)
    CrossRealm,      // SetUpCrossRealmTransformReadable (holds the MessagePort)
    Nothing,         // empty stream: trivial start/pull/cancel
    /* Bun: Native, Direct — TBD(bun-ext), from specs/BUN-EXTENSIONS.md */
};

// Same idea for the writable controller's write/close/abort algorithms.
enum class SinkKind : uint8_t {
    JavaScript,      // user underlyingSink
    TransformSink,   // TransformStreamDefaultSink{Write,Close,Abort}Algorithm (Discrepancies #2)
    CrossRealm,      // SetUpCrossRealmTransformWritable
    Nothing,
    /* Bun: Native / JSSink — TBD(bun-ext) */
};

// And for the transform controller's transform/flush/cancel algorithms.
enum class TransformerKind : uint8_t {
    JavaScript,      // user transformer (m_transformer + method barriers)
    Identity,        // no `transform` member: enqueue the chunk unchanged
};

// WebIDL `enum ReadableStreamType { "bytes" }` — an unknown string throws TypeError during
// dictionary conversion (ARCH §4).
enum class ReadableStreamType : uint8_t { Bytes };

// WebIDL `enum ReadableStreamReaderMode { "byob" }` (getReader options.mode)
enum class ReadableStreamReaderMode : uint8_t { Byob };

// Pull-into descriptor "view constructor": %DataView% or one of the typed array constructors
// from the ES typed-array table. Closed intrinsic set — never a user constructor.
enum class ViewConstructorKind : uint8_t {
    DataView,
    Int8Array, Uint8Array, Uint8ClampedArray,
    Int16Array, Uint16Array,
    Int32Array, Uint32Array,
    Float16Array, Float32Array, Float64Array,
    BigInt64Array, BigUint64Array,
};

// Cross-realm transform protocol message `type` (digest 04: "chunk"/"pull"/"error"/"close")
enum class CrossRealmMessageType : uint8_t { Chunk, Pull, Error, Close };
```

---

## Internal methods

The spec's polymorphic controller internal methods. There is no common C++ base class for the
two readable controllers (they are unrelated GC cells); each declares the same-named member
functions and the two dispatch sites (`ReadableStreamCancel` → `[[CancelSteps]]`,
`ReadableStreamDefaultReaderRead` → `[[PullSteps]]`, `ReadableStreamReaderGenericRelease` →
`[[ReleaseSteps]]`) branch on the stream's controller kind (one branch, both cells known at
compile time — no vtable needed). The WS controller has exactly one kind, so its two internal
methods are plain members.

| Internal method (digest) | Class / file | C++ member declaration | userJS? | notes |
|---|---|---|---|---|
| `ReadableStreamDefaultController.[[CancelSteps]](reason)` (digest 01) | `JSReadableStreamDefaultController.cpp` | `JSC::JSPromise* cancelSteps(JSC::JSGlobalObject*, JSC::JSValue reason)` | YES(direct) | ResetQueue, then performs the user `[[cancelAlgorithm]]` and adopts its return value as a promise (thenable), then ClearAlgorithms |
| `ReadableStreamDefaultController.[[PullSteps]](readRequest)` (digest 01) | `JSReadableStreamDefaultController.cpp` | `void pullSteps(JSC::JSGlobalObject*, JSReadRequest* readRequest)` | YES(transitive) | DequeueValue + `readableStreamClose` / `…CallPullIfNeeded` (user pull) + read-request chunk-steps dispatch |
| `ReadableStreamDefaultController.[[ReleaseSteps]]()` (digest 01) | `JSReadableStreamDefaultController.cpp` | `void releaseSteps()` | no | spec: "Return." (no-op) |
| `ReadableByteStreamController.[[CancelSteps]](reason)` (digest 01) | `JSReadableByteStreamController.cpp` | `JSC::JSPromise* cancelSteps(JSC::JSGlobalObject*, JSC::JSValue reason)` | YES(direct) | ClearPendingPullIntos + ResetQueue + user `[[cancelAlgorithm]]` (thenable adoption) + ClearAlgorithms |
| `ReadableByteStreamController.[[PullSteps]](readRequest)` (digest 01) | `JSReadableByteStreamController.cpp` | `void pullSteps(JSC::JSGlobalObject*, JSReadRequest* readRequest)` | YES(transitive) | FillReadRequestFromQueue (dispatch) / auto-alloc `ArrayBuffer` construction (error steps on abrupt) / AddReadRequest + `…CallPullIfNeeded` (user pull) |
| `ReadableByteStreamController.[[ReleaseSteps]]()` (digest 01) | `JSReadableByteStreamController.cpp` | `void releaseSteps()` | no | truncates `[[pendingPullIntos]]` to its head with readerType = None; pure state |
| `WritableStreamDefaultController.[[AbortSteps]](reason)` (digest 03) | `JSWritableStreamDefaultController.cpp` | `JSC::JSPromise* abortSteps(JSC::JSGlobalObject*, JSC::JSValue reason)` | YES(direct) | performs the user `[[abortAlgorithm]]` (thenable adoption) + ClearAlgorithms |
| `WritableStreamDefaultController.[[ErrorSteps]]()` (digest 03) | `JSWritableStreamDefaultController.cpp` | `void errorSteps()` | no | ResetQueue only (clearing barriers; no VM/global needed) |

`JSReadRequest::{chunk,close,error}Steps` / `JSReadIntoRequest::…` (the §5 vtable, declared in
**Structs**) are the *other* polymorphic surface: each takes `JSC::JSGlobalObject*`. Treat
every call through them as **YES(transitive)** — the promise-backed subclass only resolves an
internal promise (no synchronous user JS), but the pipe subclass re-enters
`writableStreamDefaultWriterWrite` (user `size()`), the tee subclasses re-enter controller
enqueue/error, and Bun's native subclasses are TBD.

---

## Discrepancies

1. **Algorithm-valued parameters cannot be translated mechanically.** ARCHITECTURE §4 forbids
   storing/creating algorithm closures, but 8 digest ops take algorithms as *parameters*
   (`CreateReadableStream`, `CreateReadableByteStream`, `CreateWritableStream`,
   `SetUpReadableStreamDefaultController`, `SetUpReadableByteStreamController`,
   `SetUpWritableStreamDefaultController`, `SetUpTransformStreamDefaultController`,
   `InitializeTransformStream`) and ARCHITECTURE never says what their C++ signatures become.
   I fixed one convention (preamble #6): kind enum + kind-state cell + pre-populated controller
   members + an explicit `startMethod` argument. This is a design decision Phase A must ratify;
   every row using it says so.
2. **`SourceKind`/`SinkKind` in ARCHITECTURE §4 are missing arms.** `InitializeTransformStream`
   (digest 04) creates the transform's readable with `TransformStreamDefaultSource{Pull,Cancel}Algorithm`
   and its writable with `TransformStreamDefaultSink{Write,Close,Abort}Algorithm`, but §4's
   `SourceKind` list (`JavaScript, Native, Direct, TeeBranch, FromIterable, CrossRealm, Nothing`)
   has no TransformSource arm and no `SinkKind` list is given at all. `ReadableByteStreamTee`
   also needs its own arm (its pull/cancel algorithms are a different algorithm from the default
   tee's, per §6's own "implement it separately" instruction). I added `TransformSource`,
   `ByteTeeBranch`, and a full `SinkKind`/`TransformerKind` to **Enums**.
3. **`StructuredClone` / structured serialization userJS classification conflicts.** The task
   brief's seed fact says `TransferArrayBuffer`/`StructuredClone`/`CanTransferArrayBuffer` run
   no user JS, but ARCHITECTURE §7 rule 2 explicitly lists `structuredClone` among the
   operations that "run arbitrary user JS synchronously" — and it is right: StructuredSerialize
   of a user chunk performs `[[Get]]` on its own properties, so accessors/Proxy traps run. I
   followed ARCHITECTURE (pessimistic): `StructuredClone` and `PackAndPostMessage` (same
   mechanism, via `postMessage`) are `YES(direct)`; `TransferArrayBuffer` /
   `CanTransferArrayBuffer` are genuinely `no`. Every caller of the two YES ops
   (`ReadableStreamDefaultTee`'s chunk steps, the cross-realm write/cancel/close algorithms)
   must re-read state afterwards.
4. **`SetUpXxx` ownership is ambiguous.** §1's ownership rule routes ALL `SetUpXxx` ops to the
   `*Operations.cpp` files, which puts `SetUpReadable{Stream,ByteStream}…Controller…` (pure
   controller logic) in `ReadableStreamOperations.cpp` rather than the controller's own `.cpp`,
   and §1's per-file content table for `ReadableStreamOperations.cpp` does not mention them.
   I applied the explicit `SetUpXxx` rule verbatim (it is the only deterministic reading);
   `SetUpCrossRealmTransform{Readable,Writable}` go to `CrossRealmTransform.cpp` because §1's
   file table names them there explicitly (a table entry overrides the generic rule).
5. **`WebStreamsMisc.cpp`'s content list is incomplete.** It omits `StructuredClone` and
   `CanCopyDataBlockBytes` (both defined in digest 04 §Miscellaneous). Both have no class-name
   prefix, so by the §1 rule they land in a `*Operations.cpp` — but they are misc utilities, so
   I assigned them to `WebStreamsMisc.cpp` alongside their siblings. Phase A should add them to
   §1's table.
6. **Multi-value returns are not covered by the return-type rules.** `ReadableStreamTee` /
   `ReadableStreamDefaultTee` / `ReadableByteStreamTee` return « two ReadableStreams ». I used
   `std::pair<JSReadableStream*, JSReadableStream*>` (both stack-rooted in the caller, which
   immediately puts them into a JSArray for `tee()`).
7. **"Completion record" returns and ARCHITECTURE §7's "never `clearException()`" collide.**
   `PackAndPostMessageHandlingError` returns a completion record that its callers *inspect
   without rethrowing* (they convert an abrupt completion into a rejected promise), and
   `CrossRealmTransformSendError` *discards* an abrupt completion. Both require catching the
   pending exception off the throw scope and clearing it at that boundary — which §7.6 appears
   to ban outright ("Never `clearException()`"). Phase A must bless a single sanctioned
   catch-into-rejected-promise helper (declared with the promise-capability helpers in
   `WebStreamsMisc.cpp`) or these two spec ops cannot be written.
8. **`ReadableStreamReaderGeneric*` ops need a target type.** The spec defines them on the
   `ReadableStreamGenericReader` *mixin*; the 13-class list in §1 has no corresponding C++
   class. I declared their parameter as `JSReadableStreamGenericReader*` — a shared C++ base
   class of the two reader cells holding the mixin's slots (`[[closedPromise]]`, `[[stream]]`).
   If Phase A rejects a shared base, each of the 3 generic ops becomes two overloads.
9. **`ReadableStreamPipeTo`'s `signal` parameter forces a dependency outside the streams
   directory** (`WebCore::AbortSignal*`, per §6's requirement to use the C++ listener API), and
   `WritableStreamDefaultController.[[abortController]]` requires `WebCore::AbortController`.
   Neither type is named in §1's include surface. Also note `WritableStreamAbort`'s "signal
   abort" step **runs user `abort` listeners synchronously** — a user-JS entry point that
   ARCHITECTURE §7's list does not mention; I classified it `YES(direct)`.
10. **`PackAndPostMessage(port, type, …)`'s `type` string** is a closed 4-value protocol set;
    no mapping rule covers it. I introduced `CrossRealmMessageType` (Enums) instead of passing
    a `WTF::String`.

---

## Coverage check

"Op heading" = a `### Name(args) → returnType` heading (the digests' abstract-operation
definition form). Class getters/methods/constructors/prose headings are not abstract ops (see
the skip list).

| Digest | `###` headings total | op headings | rows produced | internal-method headings | internal-method rows |
|---|---|---|---|---|---|
| `01-readable-classes.md` | 53 | 0 | 0 | 2 (`### Internal methods` ×2, defining 5 methods) | 5 |
| `02-readable-abstract-ops.md` | 78 | 74 | **74** | 0 | 0 |
| `03-writable.md` | 63 | 42 | **42** | 2 (`[[AbortSteps]]`, `[[ErrorSteps]]`) | 2 |
| `04-transform-queuing-support.md` | 58 | 34 | **34** | 0 | 0 |
| **Total** | 252 | **150** | **150** | — | **7** (+ the RS controllers' 5 from digest 01 = 8 total internal-method rows) |

Every op heading produced exactly one row: 150 = 150. The 8 internal methods
(3 + 3 on the two RS controllers from digest 01, 2 on the WS controller from digest 03) are
all in **## Internal methods**.

Non-op `###` headings deliberately not given table rows, with reasons:

- **Prose/struct/IDL-surface headings** (digest 01: Chunks, Locking, Internal slots ×?,
  "The … struct" ×3, "The underlying source API", etc.; digest 02: the 4 leading struct
  headings; digest 03/04: "The underlying sink API", "The transformer API", "Queue-with-sizes",
  "Miscellaneous", "Default sinks", …): definitions/prose, not operations. The struct headings
  are covered by **## Structs**.
- **Public IDL constructors / methods / getters / async-iterator hooks / transfer steps**
  (digest 01: `Constructor` ×3, `static from`, `get locked/closed/desiredSize/byobRequest/view`,
  `cancel(reason)` ×2, `getReader`, `pipeThrough`, `pipeTo`, `tee()`, `read()`,
  `read(view, options)`, `releaseLock()` ×2, `close()` ×2, `enqueue(chunk)` ×2, `error(e)` ×2,
  `respond`, `respondWithNewView`, `Asynchronous iteration`, `Transfer via postMessage()`;
  digest 03: `Constructor: …` ×2, `Getter: …` ×6, `Method: …` ×8, transfer steps ×2;
  digest 04: `Constructor: …` ×3, the 6 strategy/TS getters, `enqueue/error/terminate` methods,
  transfer steps ×2): these are the classes' Web IDL surface. Per ARCHITECTURE §1 they are
  `JSC_DECLARE_HOST_FUNCTION` / `JSC_DECLARE_CUSTOM_GETTER` entries in each class's own
  `JSFoo.{h,cpp}`, NOT free abstract ops in `WebStreamsInternals.h`; every abstract op they
  delegate to already has a row above. Producing "declarations" for them here would put ~70
  host-function symbols into the shared internals header, contradicting §1's file-granularity
  rule.
- **`### Internal methods` / `### Internal method: [[X]]`** headings: covered in
  **## Internal methods** (8 member declarations), as the task requires them separated from the
  abstract-op table.
