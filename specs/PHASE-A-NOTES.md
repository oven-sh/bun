# PHASE A NOTES — frozen headers of `src/jsc/bindings/webcore/streams/`

Author: the Phase-A header agent. Inputs: ARCHITECTURE.md (v2), BUN-LAYER-DESIGN.md (v2),
OP-SIGNATURES.md (reconciled to v2), SLOT-TABLES.md, PLUMBING.md, JSCookie.{h,cpp},
WriteBarrierList.h, BunClientData.h (`subspaceForImpl`), JSDOMConstructorBase.h,
JSDOMGlobalObjectInlines.h (`getDOMConstructor`). Nothing was compiled.

---

## 1. File manifest (34 headers, 4422 lines; per-file line counts are post-review)

| file | purpose |
|---|---|
| `StreamsForward.h` (243) | forward decls of every class + ALL shared `enum class : uint8_t`es; the only header class headers include instead of each other. |
| `StreamQueue.h` (166) | `ValueWithSize`, `ByteQueueEntry`, the header-only `StreamQueue<Entry>` ([[queue]]+[[queueTotalSize]]) with the 4 queue-with-sizes spec ops as inline methods + the caller-held-`AbstractLocker` cellLock discipline. |
| `WebStreamsInternals.h` (620) | THE frozen ABI: the converted-dictionary structs, all 146 cross-file spec abstract ops, the internal creation signatures, the per-SourceKind/TransformerKind algorithm-arm bridges, the Bun-layer free functions, and the complete `extern "C"` block. One `// userJS: yes\|no — Owner.cpp` per declaration, grouped by owner. |
| `JSStreamsRuntime.h` (371) | the per-global cell: the TWO closed handler lists ([reaction-convention] / [bound-convention]) as X-macros with per-handler owner+context docs, the per-realm strategy `size` functions, and the cached Structures of every internal cell. |
| `JSReadableStream.h` (181) | class 1 (+Prototype+Constructor); all spec slots + every BUN-LAYER §1 member; the erased `m_controller` + `ControllerKind`. |
| `JSReadableStreamReaderBase.h` (49) | the header-only, non-polymorphic shared reader base (GenericReader mixin slots). |
| `JSReadableStreamDefaultReader.h` (116) | class 2 (+P+C); `[[readRequests]]`; the reader→operation `m_pipeOperation` back-edge. |
| `JSReadableStreamBYOBReader.h` (110) | class 3 (+P+C); `[[readIntoRequests]]`. |
| `JSReadableStreamDefaultController.h` (148) | class 4 (+P+throwing C); queue + the SourceKind algorithm members; `[[PullSteps]]/[[CancelSteps]]/[[ReleaseSteps]]`. |
| `JSReadableByteStreamController.h` (154) | class 5 (+P+throwing C); byte queue + `[[pendingPullIntos]]` + `[[byobRequest]]`. |
| `JSReadableStreamBYOBRequest.h` (92) | class 6 (+P+throwing C). |
| `JSWritableStream.h` (152) | class 7 (+P+C); `PendingAbortRequest`; `[[writeRequests]]` as a deque of PROMISES. |
| `JSWritableStreamDefaultWriter.h` (114) | class 8 (+P+C); the writer→pipe `m_pipeOperation` back-edge. |
| `JSWritableStreamDefaultController.h` (141) | class 9 (+P+throwing C); SinkKind algorithm members + `[[abortController]]`. |
| `JSTransformStream.h` (117) | class 10 (+P+C). |
| `JSTransformStreamDefaultController.h` (119) | class 11 (+P+throwing C); TransformerKind algorithm members. |
| `JSByteLengthQueuingStrategy.h` (104) | class 12 (+P+C). |
| `JSCountQueuingStrategy.h` (104) | class 13 (+P+C). |
| `JSReadableStreamAsyncIterator.h` (80) | class 14 + %ReadableStreamAsyncIteratorPrototype% (no constructor). |
| `JSReadRequest.h` (105) | `JSReadRequest` + `JSReadIntoRequest`: kind-tagged single concrete cells (no vtables). |
| `JSPullIntoDescriptor.h` (62) | the pull-into descriptor GC cell. |
| `JSStreamPipeToOperation.h` (153) | the pipeTo state machine cell: §6.1 back-edges, GC-visited abort algorithm handle, and the FULL method set (the four propagation checks, shutdown / shutdown-with-an-action / finalize, and the per-reaction entry points). |
| `JSStreamTeeState.h` (70) | the shared default/byte tee state cell. |
| `JSCrossRealmTransformState.h` (58) | the cross-realm endpoint cell (out-of-scope stub target). |
| `JSStreamAlgorithmContexts.h` (52) | `JSStreamFromIterableContext` (the iterator record) — nothing else. |
| `JSDirectStreamController.h` (108) | BUN §4: the `type:"direct"` controller (3 sink flavors in one class). |
| `BunStandaloneTextSink.h` (107) | BUN §3.1a: the shared `BunTextAccumulator` value type + `JSBunStandaloneTextSink`, the standalone GENERIC-toText sink cell (post-review; R1-CRIT-1 == R3-CRIT-4). |
| `JSOneShotDirectSink.h` (66) | BUN §3.3: `consumeDirectStreamToArrayBuffer`'s one-shot throwaway controller cell (post-review; R1-CRIT-2). |
| `BunStreamSource.h` (73) | BUN §2.2: `JSNativeStreamSourceAdapter` (the ONE sanctioned `JSC::Weak`). |
| `JSDirectSinkCloseState.h` (49) | BUN §5.2: readDirectStream's onClose context cell. |
| `JSReadStreamIntoSinkOperation.h` (61) | BUN §5.3: the readStreamIntoSink pump cell. |
| `JSResumableSinkPumpOperation.h` (56) | BUN §5.4: the ResumableSink pump cell. |
| `JSTextEncoderStream.h` (109) | BUN §9.2 (+P+C). |
| `JSTextDecoderStream.h` (112) | BUN §9.2 (+P+C). |

NOT created (deliberately): any `.cpp`, `CrossRealmTransform.h` (see §3.7), `JSWriteRequest`
(ARCH §5.1 forbids it), a `SourceKind::Direct` arm (deleted per BUN-LAYER §2), CMake /
registration / `ZigGlobalObject` / lut edits (Phase C).

### Phase-C obligations created by these headers (registration only, no new mechanism)
- one glob line (`webcore/streams/*.cpp`) per PLUMBING §4;
- `DOMIsoSubspaces.h` / `DOMClientIsoSubspaces.h` entries for every `subspaceForImpl` above
  (18 instance classes + 10 constructible constructors — the 8 spec user-constructible
  classes PLUS `TextEncoderStream` + `TextDecoderStream`, both user-`new`-able per
  BUN-LAYER §9.2, whose constructors each carry `m_instanceStructure` and therefore their
  own iso subspace);
- ONE `LazyProperty<JSGlobalObject, JSStreamsRuntime>` + inline accessor
  `streamsRuntime()` on `Zig::GlobalObject` (the only global-object member added);
- DOMConstructorID entries already exist for the 12 public classes; TextEncoderStream /
  TextDecoderStream keep theirs.

---

## 2. Coverage checklist

### 2a. Abstract ops (OP-SIGNATURES' 150 table rows) → declaring header

**StreamQueue.h (4)** — `EnqueueValueWithSize`, `DequeueValue`, `PeekQueueValue`,
`ResetQueue` (methods on `StreamQueue<Entry>`, per OP-SIGNATURES).

**WebStreamsInternals.h (146)** — every other row, grouped by owner `.cpp` exactly as in the
header:
- *WebStreamsMisc.cpp (8):* ExtractHighWaterMark, ExtractSizeAlgorithm, IsNonNegativeNumber,
  TransferArrayBuffer, CanTransferArrayBuffer, CloneAsUint8Array, StructuredClone,
  CanCopyDataBlockBytes.
- *ReadableStreamOperations.cpp (31 of the 150, + the §4.9-invented
  `readableStreamCloseIfPossible` which is NOT an OP-SIGNATURES row = 32 declarations):*
  CreateReadableStream, CreateReadableByteStream,
  InitializeReadableStream, IsReadableStreamLocked, AcquireReadableStreamDefaultReader,
  AcquireReadableStreamBYOBReader, SetUpReadableStreamDefaultReader,
  SetUpReadableStreamBYOBReader, ReadableStreamReaderGenericCancel,
  ReadableStreamReaderGenericInitialize, ReadableStreamReaderGenericRelease,
  ReadableStreamCancel, ReadableStreamClose, ReadableStreamError,
  ReadableStreamAddReadRequest, ReadableStreamAddReadIntoRequest,
  ReadableStreamFulfillReadRequest, ReadableStreamFulfillReadIntoRequest,
  ReadableStreamGetNumReadRequests, ReadableStreamGetNumReadIntoRequests,
  ReadableStreamHasDefaultReader, ReadableStreamHasBYOBReader, ReadableStreamTee,
  ReadableStreamDefaultTee, ReadableByteStreamTee, ReadableStreamFromIterable,
  ReadableStreamPipeTo, SetUpReadableStreamDefaultController,
  SetUpReadableStreamDefaultControllerFromUnderlyingSource,
  SetUpReadableByteStreamController, SetUpReadableByteStreamControllerFromUnderlyingSource.
- *JSReadableStreamDefaultReader.cpp (3):* ReadableStreamDefaultReaderRead,
  ReadableStreamDefaultReaderRelease, ReadableStreamDefaultReaderErrorReadRequests.
- *JSReadableStreamBYOBReader.cpp (3):* ReadableStreamBYOBReaderRead,
  ReadableStreamBYOBReaderRelease, ReadableStreamBYOBReaderErrorReadIntoRequests.
- *JSReadableStreamDefaultController.cpp (9):* CallPullIfNeeded, ShouldCallPull,
  ClearAlgorithms, Close, Enqueue, Error, GetDesiredSize, HasBackpressure,
  CanCloseOrEnqueue (all `ReadableStreamDefaultController*`-prefixed).
- *JSReadableByteStreamController.cpp (28):* CallPullIfNeeded, ShouldCallPull,
  ClearAlgorithms, ClearPendingPullIntos, Close, CommitPullIntoDescriptor,
  ConvertPullIntoDescriptor, Enqueue, EnqueueChunkToQueue, EnqueueClonedChunkToQueue,
  EnqueueDetachedPullIntoToQueue, Error, FillHeadPullIntoDescriptor,
  FillPullIntoDescriptorFromQueue, FillReadRequestFromQueue, GetBYOBRequest, GetDesiredSize,
  HandleQueueDrain, InvalidateBYOBRequest, ProcessPullIntoDescriptorsUsingQueue,
  ProcessReadRequestsUsingQueue, PullInto, Respond, RespondInClosedState,
  RespondInReadableState, RespondInternal, RespondWithNewView, ShiftPendingPullInto
  (all `ReadableByteStreamController*`-prefixed).
- *WritableStreamOperations.cpp (23):* CreateWritableStream, InitializeWritableStream,
  IsWritableStreamLocked, AcquireWritableStreamDefaultWriter,
  SetUpWritableStreamDefaultWriter, WritableStreamAbort, WritableStreamClose,
  WritableStreamAddWriteRequest, WritableStreamCloseQueuedOrInFlight,
  WritableStreamDealWithRejection, WritableStreamStartErroring, WritableStreamFinishErroring,
  WritableStreamFinishInFlightWrite, WritableStreamFinishInFlightWriteWithError,
  WritableStreamFinishInFlightClose, WritableStreamFinishInFlightCloseWithError,
  WritableStreamHasOperationMarkedInFlight, WritableStreamMarkCloseRequestInFlight,
  WritableStreamMarkFirstWriteRequestInFlight,
  WritableStreamRejectCloseAndClosedPromiseIfNeeded, WritableStreamUpdateBackpressure,
  SetUpWritableStreamDefaultController,
  SetUpWritableStreamDefaultControllerFromUnderlyingSink.
- *JSWritableStreamDefaultWriter.cpp (8):* Abort, Close, CloseWithErrorPropagation,
  EnsureClosedPromiseRejected, EnsureReadyPromiseRejected, GetDesiredSize, Release, Write
  (all `WritableStreamDefaultWriter*`-prefixed).
- *JSWritableStreamDefaultController.cpp (11):* AdvanceQueueIfNeeded, ClearAlgorithms,
  Close, Error, ErrorIfNeeded, GetBackpressure, GetChunkSize, GetDesiredSize, ProcessClose,
  ProcessWrite, Write (all `WritableStreamDefaultController*`-prefixed).
- *TransformStreamOperations.cpp (12):* InitializeTransformStream, TransformStreamError,
  TransformStreamErrorWritableAndUnblockWrite, TransformStreamSetBackpressure,
  TransformStreamUnblockWrite, SetUpTransformStreamDefaultController,
  SetUpTransformStreamDefaultControllerFromTransformer,
  TransformStreamDefaultSinkWriteAlgorithm, TransformStreamDefaultSinkAbortAlgorithm,
  TransformStreamDefaultSinkCloseAlgorithm, TransformStreamDefaultSourceCancelAlgorithm,
  TransformStreamDefaultSourcePullAlgorithm.
- *JSTransformStreamDefaultController.cpp (5):* ClearAlgorithms, Enqueue, Error,
  PerformTransform, Terminate (all `TransformStreamDefaultController*`-prefixed).
- *CrossRealmTransform.cpp (5, stubs allowed):* CrossRealmTransformSendError,
  PackAndPostMessage, PackAndPostMessageHandlingError, SetUpCrossRealmTransformReadable,
  SetUpCrossRealmTransformWritable.

Total: 4 + 146 = **150 / 150 op rows declared.** Nothing intentionally omitted.

### 2b. Internal methods (OP-SIGNATURES' 8 rows) → declaring header
- `ReadableStreamDefaultController.[[CancelSteps]]/[[PullSteps]]/[[ReleaseSteps]]` →
  members `cancelSteps/pullSteps/releaseSteps` in `JSReadableStreamDefaultController.h`.
- `ReadableByteStreamController.[[CancelSteps]]/[[PullSteps]]/[[ReleaseSteps]]` →
  same names in `JSReadableByteStreamController.h`.
- `WritableStreamDefaultController.[[AbortSteps]]/[[ErrorSteps]]` →
  `abortSteps/errorSteps` in `JSWritableStreamDefaultController.h`.
**8 / 8.** (The read-request steps surface is `JSReadRequest.h`'s
`chunkSteps/closeSteps/errorSteps` on the two kind-tagged cells.)

### 2c. SLOT-TABLES → members (73 / 73)

| class (header) | slot → member |
|---|---|
| ReadableStream (`JSReadableStream.h`) | `[[controller]]`→`m_controller` (+`m_controllerKind`), `[[Detached]]`→`m_detached`, `[[disturbed]]`→`m_disturbed`, `[[reader]]`→`m_reader`, `[[state]]`→`m_state`, `[[storedError]]`→`m_storedError` |
| ReadableStreamGenericReader (`JSReadableStreamReaderBase.h`) | `[[closedPromise]]`→`m_closedPromise`, `[[stream]]`→`m_stream` |
| ReadableStreamDefaultReader | `[[readRequests]]`→`m_readRequests` |
| ReadableStreamBYOBReader | `[[readIntoRequests]]`→`m_readIntoRequests` |
| ReadableStreamDefaultController | `[[cancelAlgorithm]]`→`m_sourceKind`+`m_cancelMethod`+`m_algorithmContext`, `[[closeRequested]]`→`m_closeRequested`, `[[pullAgain]]`→`m_pullAgain`, `[[pullAlgorithm]]`→`m_sourceKind`+`m_pullMethod`+`m_algorithmContext`, `[[pulling]]`→`m_pulling`, `[[queue]]`+`[[queueTotalSize]]`→`m_queue` (StreamQueue), `[[started]]`→`m_started`, `[[strategyHWM]]`→`m_strategyHWM`, `[[strategySizeAlgorithm]]`→`m_strategySizeAlgorithm`, `[[stream]]`→`m_stream` |
| ReadableByteStreamController | `[[autoAllocateChunkSize]]`→`m_autoAllocateChunkSize` (0 = undefined), `[[byobRequest]]`→`m_byobRequest`, `[[cancelAlgorithm]]`/`[[pullAlgorithm]]`→kind+methods+context, `[[closeRequested]]`, `[[pullAgain]]`, `[[pulling]]`, `[[pendingPullIntos]]`→`m_pendingPullIntos`, `[[queue]]`+`[[queueTotalSize]]`→`m_queue`, `[[started]]`, `[[strategyHWM]]`, `[[stream]]` |
| ReadableStreamBYOBRequest | `[[controller]]`→`m_controller`, `[[view]]`→`m_view` |
| WritableStream (`JSWritableStream.h`) | `[[backpressure]]`, `[[closeRequest]]`, `[[controller]]`, `[[Detached]]`, `[[inFlightWriteRequest]]`, `[[inFlightCloseRequest]]`, `[[pendingAbortRequest]]`→`m_pendingAbortRequest` (struct), `[[state]]`, `[[storedError]]`, `[[writer]]`, `[[writeRequests]]`→`m_writeRequests` (deque of promises) |
| WritableStreamDefaultWriter | `[[closedPromise]]`, `[[readyPromise]]`, `[[stream]]` |
| WritableStreamDefaultController | `[[abortAlgorithm]]`/`[[closeAlgorithm]]`/`[[writeAlgorithm]]`→`m_sinkKind`+`m_abortMethod`/`m_closeMethod`/`m_writeMethod`+`m_algorithmContext`, `[[abortController]]`→`m_abortController`, `[[queue]]`+`[[queueTotalSize]]`→`m_queue`, `[[started]]`, `[[strategyHWM]]`, `[[strategySizeAlgorithm]]`, `[[stream]]` |
| TransformStream | `[[backpressure]]`, `[[backpressureChangePromise]]`, `[[controller]]`, `[[Detached]]`, `[[readable]]`, `[[writable]]` |
| TransformStreamDefaultController | `[[cancelAlgorithm]]`/`[[flushAlgorithm]]`/`[[transformAlgorithm]]`→`m_transformerKind`+`m_cancelMethod`/`m_flushMethod`/`m_transformMethod`+`m_algorithmContext`, `[[finishPromise]]`→`m_finishPromise`, `[[stream]]`→`m_stream` |
| ByteLengthQueuingStrategy / CountQueuingStrategy | `[[highWaterMark]]`→`m_highWaterMark` |

Every BUN-LAYER §1/§2.2/§4.1/§5.2-5.4 member is present in the corresponding class (see
each header's slot comments). The reader→op and writer→pipe back-edges
(`m_pipeOperation`) exist on `JSReadableStreamDefaultReader` / `JSWritableStreamDefaultWriter`.

---

## 3. Contradictions between the input documents, and what I followed

1. **Reader base class.** ARCHITECTURE §1.2 writes `JSReadableStreamReaderBase :
   JSC::JSNonFinalObject`, but §1.1 makes both concrete readers DESTRUCTIBLE, and the
   in-tree subspace machinery (`BunClientData.h:199` static_assert) requires a destructible
   class to derive from `JSC::JSDestructibleObject`. **Followed §1.1 + the in-tree
   invariant:** the base is `JSC::JSDestructibleObject`.
2. **`JSReadRequest` shape.** OP-SIGNATURES §Structs sketches an abstract base with
   `virtual` methods and subclasses. ARCHITECTURE §5 explicitly supersedes this (virtual on
   a JSCell = memory corruption). **Followed ARCHITECTURE:** one concrete cell + a kind tag
   (and a parallel `ReadIntoRequestKind` for `JSReadIntoRequest`).
3. **`JSPullIntoDescriptor` base.** OP-SIGNATURES writes `JSInternalFieldObjectImpl<0>`;
   ARCHITECTURE §3.4 says "a small non-destructible cell". **Followed ARCHITECTURE:**
   `JSC::JSNonFinalObject`.
4. **Enum arm names.** OP-SIGNATURES: `TransformSource`/`TransformSink`, no `Native`, no
   byte-tee arm in the prose enum. ARCHITECTURE v2 §4 (+ BUN-LAYER §2) is later and
   explicit. **Followed ARCHITECTURE:** `SourceKind { JavaScript, Nothing, Transform,
   TeeBranch, ByteTeeBranch, FromIterable, CrossRealm, Native }` (NO `Direct`),
   `SinkKind { JavaScript, Nothing, Transform, CrossRealm }`,
   `TransformerKind { JavaScript, Identity, TextEncoder, TextDecoder }`.
5. **`setUp*Controller`'s start parameter.** OP-SIGNATURES convention #6 passes a
   `startMethod` and has `setUp*Controller` INVOKE start; ARCHITECTURE §4 (v2) states the
   start method/result is never stored, the `From{UnderlyingSource,Sink,Transformer}` op
   invokes start, and `setUp*Controller` receives the already-computed **`startResult`**.
   **Followed ARCHITECTURE:** `JSC::JSValue startResult` replaces `startMethod` in
   `setUpReadableStreamDefaultController`, `setUpReadableByteStreamController`,
   `setUpWritableStreamDefaultController`, and in the `create{Readable,Writable}Stream` /
   `createTransformStream` internal entry points.
6. **`readableStreamPipeTo`'s `signal` parameter type.** OP-SIGNATURES: `WebCore::AbortSignal*`.
   ARCHITECTURE §6.1 requires the pipe's signal registration to be GC-visited and removable
   on every terminal path; a raw impl pointer stored on the cell is either unrooted (UAF) or
   forces a `RefPtr` member (which would make the pipe cell destructible for no other
   reason). **Reconciled to `JSC::JSObject* signal` (the JSAbortSignal WRAPPER cell,
   nullptr = none), rooted by the pipe op's WriteBarrier**, plus a `uint32_t` algorithm id.
7. **Where the cross-realm ops are declared.** ARCHITECTURE §1.3/§6.3 says
   `CrossRealmTransform.h` declares the SetUpCrossRealm* ops and the transfer steps; §1.4
   says EVERY op is declared exactly once in `WebStreamsInternals.h`. **Followed §1.4** (the
   5 in-scope abstract ops are in WebStreamsInternals.h). `CrossRealmTransform.h` is NOT
   created: the only content it would add — the per-class transfer / transfer-receiving
   steps — is exactly the surface §6.3's scope gate defers to a follow-up PR.
8. **Where the enums/structs live.** ARCHITECTURE §1.3 puts "the enums and shared structs"
   in `WebStreamsInternals.h`; the Phase-A brief adds `StreamsForward.h` for the enums so
   class headers need not include the whole ABI. **Followed the brief:** enums →
   `StreamsForward.h` (which `WebStreamsInternals.h` includes); the converted-dictionary
   structs stay in `WebStreamsInternals.h`; `PendingAbortRequest` moved to
   `JSWritableStream.h` (it is a member type of that class — keeping it in Internals.h
   would force the class header to include the whole ABI).
9. **Namespaces.** OP-SIGNATURES puts all functions in `namespace Bun::WebStreams`;
   ARCHITECTURE §2 mandates reusing the existing registration plumbing, whose
   `WEBCORE_GENERATED_CONSTRUCTOR_GETTER` macro hard-codes `WebCore::JS<Name>`. **Split:**
   classes in `namespace WebCore`, free functions + enums + structs in
   `namespace Bun::WebStreams` (with targeted `using`-declarations of the enum names into
   `WebCore` in StreamsForward.h).
10. **`JSTextDecoderStream`'s decoder member.** BUN-LAYER §9.2 says it holds "a
    `WebCore::TextDecoder`" (an owning smart pointer ⇒ a destructible cell). **Held as the
    TextDecoder WRAPPER CELL (`WriteBarrier<JSObject>`) instead** — GC-correct, keeps the
    class non-destructible, and the getters delegate. Behavior-identical.
11. **`ReadableStreamFulfillReadIntoRequest`'s `chunk`.** OP-SIGNATURES types it
    `JSC::JSValue`; its own convention #2 types view args `JSC::JSArrayBufferView*` (a
    read-into chunk is always a view). **Followed convention #2.**
12. **Where the two closed handler lists are declared.** ARCHITECTURE §4.1's last sentence
    says `WebStreamsInternals.h` declares them; they are DELIBERATELY declared only in
    `JSStreamsRuntime.h` (the X-macros and every `jsWebStreamsHandler_*` host-function
    declaration). Every owner `.cpp` that defines a handler already needs
    `JSStreamsRuntime.h` for the accessor, and keeping the callable ABI out of the abstract-op
    ABI keeps `WebStreamsInternals.h` includable from headers that only need op signatures.
    **Followed the split; this entry records the deviation from §4.1's wording.**

## 4. Things I had to invent (no input document specified them) — each is a design bug to review

1. **The two concrete handler NAME LISTS on `JSStreamsRuntime`** (~68 [reaction-convention]
   + 10 [bound-convention] entries). ARCHITECTURE §4.1 mandates that the two closed lists
   exist and estimates "~20 handlers" for the spec core; NO document enumerates them. I
   derived the list from every "Upon fulfillment/rejection" / "React to" site in the
   digests plus every BUN-LAYER reaction/bound site, but this is the highest-risk invention
   in Phase A. Mitigation: the lists are X-macros; a missing handler is a one-line,
   signature-neutral addition, and the header says a Phase-B author must STOP and report it.
2. **`ReadIntoRequestKind`** (`{ Promise, ByteTee }`). ARCHITECTURE §5 defines
   `ReadRequestKind` and says `JSReadIntoRequest` is "the parallel single concrete class"
   without naming its tag enum.
3. **`JSStreamsRuntime`'s exact member list** beyond the handlers: the per-realm
   `%*QueuingStrategySizeFunction%`s and one cached `Structure` LazyProperty per internal
   (prototype-less) cell class. ARCHITECTURE only says the cell holds "any other per-global
   streams state".
4. **`JSStreamsRuntime::from(JSGlobalObject*)`** + the Phase-C contract that
   `Zig::GlobalObject` gains exactly ONE `LazyProperty` named `streamsRuntime`.
5. **`BunStreamConsumers.cpp`** as the owner file for BUN-LAYER §3 (`readableStreamTo*`,
   the buffered fast path, the direct consumers, `withoutUTF8BOM`) — no document assigns §3
   a file.
6. **Constructor classes derive from `WebCore::JSDOMConstructorBase`** (an
   `JSC::InternalFunction` subclass — this is what ARCHITECTURE §2 asks for, expressed
   through the house base class), and only the 8 USER-constructible classes' constructors
   carry the cached `m_instanceStructure` (a throwing constructor has nothing to construct,
   so the member would be dead state).
7. **The dictionary-conversion entry points' names/signatures**
   (`convertUnderlyingSourceDict` et al.) — implied by OP-SIGNATURES convention #7 ("the
   dictionaries are converted ONCE in the public constructor") but never declared, and they
   must be cross-file (three constructors + `WebStreamsMisc.cpp`).
8. **The promise-helper names** (`promiseResolvedWith`, `promiseRejectedWith`,
   `resolvePromise`, `rejectPromise`, `markPromiseAsHandled`, `createReadResultObject`) and
   **`takeAbruptCompletion(global, CatchScope&)`** — the "sanctioned catch helper" that
   ARCHITECTURE §1.3 names and OP-SIGNATURES Discrepancy #7 explicitly asks Phase A to
   bless.
9. **`readableStreamCloseIfPossible(global, stream)`** — used throughout BUN-LAYER
   (§3.2, §4.5, §5.3, §5.4) with no signature given anywhere.
10. **`JSStreamPipeToOperation`'s members beyond ARCHITECTURE §6.1's prose list**
    (`m_shutdownActionPromise`, `m_hasShutdownError`, `m_readInFlight`, `m_finalized`,
    `m_abortAlgorithmId`) — the reference pipe's state machine needs cross-reaction state
    and a cell member is the only sanctioned place to put it.
11. **`tryUseReadableStreamBufferedFastPath`'s `method` parameter type**
    (`const JSC::Identifier&`) — BUN-LAYER passes a JS string name for a real `[[Get]]`.
12. **`readableStreamFromAsyncIterator`** (Bun's DirectPending wrapper used by
    `ReadableStreamTag__tagged`) is declared with `(JSGlobalObject*, JSValue) →
    JSReadableStream*`; BUN-LAYER §6.1 names the function but not its C++ signature.
13. **`StreamQueue`'s inline bodies** (the only function bodies Phase A ships):
    ARCHITECTURE §1.3/§3.3 mandates a header-only helper with the queue ops as inline
    methods, which cannot be satisfied with declarations alone.

---

## Maintainer rulings on §3 (contradictions) and §4 (inventions) — BINDING for the reviewers and for Phase B

**§3: ALL ELEVEN resolutions are RATIFIED as written.** In particular: #1 (JSDestructibleObject
base — the in-tree subspace static_assert wins over ARCHITECTURE's wording), #6 (the pipe holds
the JSAbortSignal WRAPPER cell in a WriteBarrier, never a raw impl pointer — this is BETTER than
either source document and is now the rule), #7 (no CrossRealmTransform.h; the deferred follow-up
owns it), #9 (classes in `WebCore::`, free functions/enums in `Bun::WebStreams::`).

**§4: ALL THIRTEEN inventions are RATIFIED**, with these notes:
- #1 (the two concrete handler lists, 68 reaction + 10 bound) is the HIGHEST-RISK item in Phase A
  and the header reviewers' single most important target: lens 1 MUST independently derive the
  reaction-handler set from every "Upon fulfillment / Upon rejection / react to / reacting to"
  site in specs/digest/0[1-4]-*.md AND every reaction/bound site in specs/BUN-LAYER-DESIGN.md,
  and diff it against `JSStreamsRuntime.h`'s X-macro lists. A missing handler blocks a Phase-B
  author. (ARCHITECTURE's "~20" estimate was wrong by 3x; the real number is the derived one.)
- #5: `BunStreamConsumers.cpp` is hereby ADDED to ARCHITECTURE §1.3's file table as the owner of
  BUN-LAYER-DESIGN §3 (`readableStreamTo*`, the buffered fast path, the `*Direct` consumers,
  `withoutUTF8BOM`).
- #6: constructor classes derive from the house `JSDOMConstructorBase`; ONLY the 10
  user-constructible classes' constructors carry `m_instanceStructure` (the 8 spec classes +
  `TextEncoderStream` + `TextDecoderStream` — a throwing constructor constructs nothing, so
  the member would be dead state). Correct; ratified.
- #8: `takeAbruptCompletion(JSGlobalObject*, JSC::TopExceptionScope&) -> JSValue` IS the one sanctioned
  §7.1a catch helper. Its body (Phase B) MUST use `clearExceptionExceptTermination()` and
  propagate a termination unconditionally.

Phase-B authors: treat PHASE-A-NOTES.md + the frozen headers as authoritative over
OP-SIGNATURES.md wherever they differ; the differences are exactly the twelve §3 items
(#1–#11 ratified above; #12 recorded at header-review time — see the post-review section).

---

## Post-review changes (header freeze)

The three adversarial header reviews (`specs/HEADER-REVIEW-{1,2,3}.md`) were applied in full,
per each finding's own fix text and the maintainer rulings issued on them. Every finding from
all three reviews was applied; **nothing was left unapplied.** `python3 specs/check-streams.py`
is CLEAN (34 headers) after the edits.

### Findings applied, per review

**HEADER-REVIEW-1 (spec/design completeness) — 6 findings, 6 applied**
- **R1-CRITICAL #1** (== R3-CRITICAL #4, one finding found independently twice): created
  `BunStandaloneTextSink.h` — the BUN-LAYER §3.1a standalone Text sink as a real destructible
  internal cell (`WebCore::JSBunStandaloneTextSink`, full DECLARE_VISIT_CHILDREN / destroy /
  subspaceForImpl / visit-list comment) plus the ONE shared `Bun::WebStreams::BunTextAccumulator`
  value type; forward-declared in `StreamsForward.h`; `V(standaloneTextSinkStructure,
  JSBunStandaloneTextSink)` added to `FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE`;
  `JSDirectStreamController`'s five inline Text members replaced with one
  `BunTextAccumulator m_textAccumulator`; `JSReadStreamIntoSinkOperation::m_sink`'s comment and
  `readableStreamIntoText`'s declaration repointed at the new class.
- **R1-CRITICAL #2**: created `JSOneShotDirectSink.h` — the §3.3 one-shot
  `consumeDirectStreamToArrayBuffer` throwaway controller cell; forward-declared;
  `V(oneShotDirectSinkStructure, JSOneShotDirectSink)` added; a new
  `FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_ONE_SHOT` owner group
  (`boundOneShotDirectWrite/Close/Flush`) added and appended to the closed bound list; the
  `onConsumeDirectToArrayBufferPull*` context annotation updated to name the new cell.
- **R1-CRITICAL #3**: added `onIntoArrayReadManyFulfilled` / `onIntoArrayReadManyRejected`
  (the `readableStreamIntoArray` readMany continuation loop) to
  `FOR_EACH_WEB_STREAMS_REACTION_HANDLER_BUN_CONSUMERS`, with the group comment extended.
- **R1-MAJOR #4**: added `onReadManyDirectPullFulfilled` (readMany §7.1 step 3, the
  Direct-controller branch) to `FOR_EACH_WEB_STREAMS_REACTION_HANDLER_READER`, with the two
  readMany reaction sites documented as distinct.
- **R1-MAJOR #5**: both "8"s in this file corrected to **10** constructible constructors, with
  a one-line note each: `TextEncoderStream` and `TextDecoderStream` are user-constructible, so
  their constructors carry `m_instanceStructure` and need their own iso subspaces (§1
  Phase-C obligations, and the §4.6 ruling).
- **R1-MINOR**: the `WebStreamsInternals.h` vs `JSStreamsRuntime.h` handler-list location is
  now recorded as §3 item **#12** (the "better" option in the fix text: record the deliberate
  relocation rather than adding an include). The §3 header ruling above ("ALL ELEVEN") is the
  maintainer's ruling on the original 11; #12 was added at header-review time and is the
  reviewers'/editor's record, not a re-ratification.

**HEADER-REVIEW-2 (GC/lifetime) — 3 findings, 3 applied**
- **R2-CRITICAL** (maintainer-ruled): `readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue`
  now fills a caller-provided `JSC::MarkedArgumentBuffer&` out-parameter (its overflow storage
  IS registered with the VM's mark-list set) instead of returning a
  `WTF::Vector<JSPullIntoDescriptor*, 4>` whose 5th+ element spills to an unscanned fastMalloc
  buffer. The factually-wrong "stack-rooted (conservative scan)" comment was REPLACED with the
  real invariant: the filled descriptors are SHIFTED OUT of the visited `[[pendingPullIntos]]`
  deque, so the MarkedArgumentBuffer is their ONLY root while the commit loop runs user JS.
  The consumer op (`...CommitPullIntoDescriptor`) got a matching comment.
- **R2-MAJOR** (maintainer-ruled): adopted the `const WTF::AbstractLocker&` design. Every
  `StreamQueue` mutator and `StreamQueue::visit()` now take a caller-held locker and NEVER
  acquire `cellLock()` themselves; the OWNING cell's `visitChildrenImpl` takes `cellLock()`
  exactly ONCE around ALL of its barrier containers (the `StreamQueue` AND any sibling
  `Deque<WriteBarrier<...>>`). The `StreamQueue.h` class comment now states that `cellLock()`
  is non-recursive and names both failure modes of the old internal-lock design (GC deadlock /
  a concurrent-marking race on the sibling deque). Visit-list comments updated on all four
  owning classes (`JSReadableStreamDefaultController`, `JSReadableByteStreamController` — the
  one class with BOTH containers — `JSWritableStreamDefaultController`,
  `JSDirectStreamController`). `BunTextAccumulator::visit` follows the same locker convention.
- **R2-MINOR**: `JSCrossRealmTransformState`'s type-erased `m_controller` + `m_isReadableSide`
  bool replaced with two EXACT-TYPED barriers (`m_readableController` /
  `m_writableController`, exactly one non-null, both visited) — the subsystem keeps exactly
  ONE sanctioned erased back-pointer (`JSReadableStream::m_controller`).

**HEADER-REVIEW-3 (annotations + usability) — 11 findings, 11 applied**
- **R3-CRITICAL #1**: declared every non-JavaScript `SourceKind`/`TransformerKind` algorithm
  ARM whose body and dispatching `switch` live in different files, each under its owning
  `.cpp` section in `WebStreamsInternals.h` with `userJS` annotations:
  `nativeSourceStart/Pull/Cancel` (BunStreamSource.cpp);
  `defaultTeePullAlgorithm/defaultTeeCancelAlgorithm/byteTeePullAlgorithm/byteTeeCancelAlgorithm`
  and `fromIterablePullAlgorithm/fromIterableCancelAlgorithm` (ReadableStreamOperations.cpp);
  `textEncoderStreamTransform/Flush` (a new JSTextEncoderStream.cpp section) and
  `textDecoderStreamTransform/Flush` (a new JSTextDecoderStream.cpp section). The Transform
  arm's bridge already existed (`transformStreamDefaultSource{Pull,Cancel}Algorithm`); the
  CrossRealm arms are out of scope with the rest of `CrossRealmTransform.cpp`.
- **R3-CRITICAL #2**: `JSStreamPipeToOperation` got its full method-declaration set per
  ARCHITECTURE §6.1 (the four propagation checks, `shutdown`, `shutdownWithAction` +
  `ShutdownAction` closed enum + the §6.1-mandated `m_pendingShutdownAction` member,
  `finalize`, and one per-reaction entry point per `onPipe*` handler plus `onSignalAbort`),
  and `WebStreamsInternals.h`'s previously-empty `JSStreamPipeToOperation.cpp` section now
  declares the ONE cross-file bridge, `startPipeToOperation(global, op)`.
- **R3-CRITICAL #3**: added the pipe's signal-abort bound handler: a new
  `FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_PIPE` owner group with `boundPipeAbortAlgorithm`,
  appended to the closed bound list; `JSStreamPipeToOperation.h`'s liveness comment names it
  and explains why a reaction-convention handler cannot substitute.
- **R3-CRITICAL #4**: == R1-CRITICAL #1 (see above).
- **R3-MAJOR (ownership)**: `readableStreamCloseIfPossible` moved out of the
  `BunStreamConsumers.cpp` banner into the `ReadableStreamOperations.cpp` block (its owner tag
  already said so); its §2a entry above now records it as the block's +1 §4.9 invention.
- **R3-MAJOR (commit-loop contract)**: folded into the R2-CRITICAL comment rewrite — the
  declaration now states the caller MUST commit one descriptor at a time and, because Commit is
  `userJS: yes`, MUST re-read all reentrantly-mutable controller/stream state after every commit.
- **R3-MINOR (readableStreamFromAsyncIterator owner)**: retagged and moved to the
  `WebStreamsExports.cpp` section (§6, the tag protocol, is that file's surface; PHASE-A-NOTES
  §4.5 scopes `BunStreamConsumers.cpp` to BUN-LAYER §3).
- **R3-MINOR (transferArrayBuffer)**: the `userJS: no` annotation now also says the op DETACHES
  the source buffer, so callers must re-read any cached view state (ARCHITECTURE §7.2's last bullet).
- **R3-MINOR (§7.4 / `Object.prototype.then`)**: applied as a header COMMENT on
  `promiseResolvedWith` / `resolvePromise`: resolving a promise with ANY object — including our
  own fresh `{value, done}` result objects — performs `Get(v, "then")` and can synchronously
  run a user-installed `Object.prototype.then` getter; only primitive resolutions are exempt.
  **NOTE FOR THE MAINTAINER:** `specs/ARCHITECTURE.md` §7.4's "fresh object" exemption wording
  should be tightened to match; ARCHITECTURE.md is outside this pass's write scope, so it was
  deliberately NOT edited. This is the only doc the reviews touch that was not updated here.
- **R3-MINOR (transitive includes)**: `WebStreamsInternals.h` now includes
  `<JavaScriptCore/Identifier.h>`, `<JavaScriptCore/JSTypedArrays.h>`, and
  `<wtf/text/WTFString.h>` for the three names it uses by value (plus
  `<JavaScriptCore/MarkedVector.h>` for the new `MarkedArgumentBuffer` out-param);
  `StreamQueue.h` now includes `<wtf/Noncopyable.h>`.
- **R3-MINOR (RangeError message)**: `StreamQueue::enqueueValueWithSize`'s message is now
  class-neutral ("The queuing strategy's chunk size must be a non-negative, finite number") —
  the same instantiation backs both the readable and the writable default controllers.

### New / renamed files
- **NEW** `src/jsc/bindings/webcore/streams/BunStandaloneTextSink.h`
  (`Bun::WebStreams::BunTextAccumulator` + `WebCore::JSBunStandaloneTextSink`).
- **NEW** `src/jsc/bindings/webcore/streams/JSOneShotDirectSink.h`
  (`WebCore::JSOneShotDirectSink`).
- No file was renamed or deleted. The header set is now **34** files.

### Not applied
- Nothing. Every finding from all three reviews was applied. The only deliberate non-edit is
  the ARCHITECTURE.md §7.4 wording noted above (out of this pass's write scope; recorded here
  for the maintainer).

### Signature changes made by the review pass (Phase-B authors take note)
1. `readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller,
   JSC::MarkedArgumentBuffer& filledPullIntos)` — was a `WTF::Vector<JSPullIntoDescriptor*,4>`
   return (R2-CRITICAL).
2. Every `StreamQueue<Entry>` mutator + `visit()` takes a leading `const WTF::AbstractLocker&`
   and no longer acquires `cellLock()` internally; the ones that no longer need the `owner`
   cell dropped that parameter (R2-MAJOR).
Everything else in this pass is strictly additive (new declarations, new handler-list entries,
new cells, comment corrections).

---

## Standing note for Phase D (pre-PR): comment slimming

The dense contract comments in these headers (spec-slot tags, userJS/owner annotations,
visit-list contracts) are DELIBERATE SCAFFOLDING for the parallel Phase-B/C build: they are
what let ~28 independent agents produce coherent, GC-correct code against a frozen ABI. They
are NOT the final shape. Before the PR opens, Phase D runs a comment-slimming pass over every
file in src/jsc/bindings/webcore/streams/ down to the repo standard: comments carry ONLY
durable non-obvious content (a 1-line ownership/lifetime/SAFETY contract where non-obvious),
never narration, never design history, never a citation of a specs/ document, a review ID, or
a PHASE/ARCHITECTURE section number. Any comment citing a review finding or a specs/ section
is a defect at PR time even if it was useful during the build.

---

## Phase-C obligation: js2native

Every surviving `.ts` call `$newCppFunction("<old file>.cpp", "<symbol>", n)` that names a
deleted file MUST be updated to `"BunStreamConsumers.cpp"` — the js2native generator resolves
the symbol against the named file, so the symbol's `JSC_DEFINE_HOST_FUNCTION` must live in
`BunStreamConsumers.cpp` (its declaration is in the new `BunStreamConsumers.h`, in
`namespace WebCore` because the generator's `using namespace WebCore` requires it).

Exact surviving sites found via
`grep -rn 'newCppFunction' src/js/ | grep -i 'readablestream\|nativeReadable'`:

- `src/js/internal/streams/native-readable.ts:9` —
  `$newCppFunction("ReadableStream.cpp", "jsFunctionTransferToNativeReadableStream", 1)`
  → must become `$newCppFunction("BunStreamConsumers.cpp", "jsFunctionTransferToNativeReadableStream", 1)`

That is the ONLY surviving `$newCppFunction` site that names a streams symbol. As a
consequence, `jsFunctionTransferToNativeReadableStream`'s owner is `BunStreamConsumers.cpp`
(it was previously annotated as WebStreamsExports.cpp); the `jsFunctionReadableStreamTo*` set
was already owned by BunStreamConsumers.cpp and is declared alongside it.

## Post-code-review header refactor

Applied to the frozen header set before the ABI freeze. One bullet per work-order item:

1. Constructor classes: the 5 non-user-constructible constructors
   (ReadableStreamDefaultController, ReadableByteStreamController, ReadableStreamBYOBRequest,
   WritableStreamDefaultController, TransformStreamDefaultController) are now
   `using JSFooConstructor = JSDOMConstructorNotConstructable<JSFoo>;`
   (JSDOMConstructorNotConstructable.h); each owner .cpp defines the specialization's
   `s_info` + `prototypeForStructure` exactly like JSAbortSignal.cpp does. The 10
   user-constructible constructors (ReadableStream, ReadableStreamDefaultReader,
   ReadableStreamBYOBReader, WritableStream, WritableStreamDefaultWriter, TransformStream,
   ByteLengthQueuingStrategy, CountQueuingStrategy, TextEncoderStream, TextDecoderStream)
   are now `using JSFooConstructor = JSStreamConstructor<JSFoo>;` over ONE new class
   template in `StreamConstructor.h` (JSDOMConstructor's shape + a visited
   `m_instanceStructure` WriteBarrier + `instanceStructure()`); each owner .cpp defines the
   specialization's `s_info`, `visitChildrenImpl`, `subspaceForImpl`, `construct`,
   `prototypeForStructure`, and `finishCreation`. 15 hand-declared constructor class
   definitions deleted.
2. Prototype classes: all 16 `class JSFooPrototype final { ... }` DEFINITIONS deleted from
   the public headers (the class definitions move to each owner .cpp, the JSCookie.cpp
   pattern). No header names any of those types, so no forward declarations were needed.
   The `createPrototype`/`prototype`/`getConstructor` statics on each `JSFoo` are unchanged.
3. JSPullIntoDescriptor: the `ViewConstructorKind` enum (StreamsForward.h) and the
   `uint8_t m_elementSize` member are DELETED. The descriptor stores
   `JSC::TypedArrayType m_viewConstructor` (`<JavaScriptCore/TypedArrayType.h>`) and derives
   the element size via the new `elementSize()` accessor (`JSC::elementSize(...)`).
4. WebStreamsInternals.h: `createReadResultObject` deleted (use
   `JSC::createIteratorResultObject` from `<JavaScriptCore/IteratorOperations.h>`); the
   duplicate `structuredClone(JSGlobalObject*, JSValue)` deleted (use the existing
   `WebCore::structuredCloneForStream` from StructuredClone.h). Notes left at both
   deletion sites.
5. JSStreamsRuntime.h: every handler member (both X-macro lists) is now a
   `JSC::LazyProperty<JSStreamsRuntime, JSC::JSFunction>` materialized on first use via
   `m_NAME.get(this)` (no eager finishCreation creation), matching the size-function /
   Structure members.
6. JSReadableStreamReaderBase: the `const bool m_isBYOB` member and its constructor
   parameter are DELETED; `bool isBYOB() const` is declared and its .cpp definition
   compares `classInfo()` against `JSReadableStreamBYOBReader::info()`.
7. The algorithm-slot group: `Bun::WebStreams::SourceAlgorithmSlots` and
   `SinkAlgorithmSlots` are defined ONCE in StreamQueue.h (next to the other
   Bun::WebStreams structs). JSReadableStreamDefaultController,
   JSReadableByteStreamController, and JSWritableStreamDefaultController each replace their
   hand-copied kind/underlying/method/context member block with ONE `m_algorithms` by value;
   their visit-list comments say to visit every barrier inside `m_algorithms`. Member set
   otherwise unchanged.
8. js2native contract: new `BunStreamConsumers.h` declares (in `namespace WebCore`)
   `jsFunctionTransferToNativeReadableStream` and the 7 `jsFunctionReadableStreamTo*` host
   functions; they were removed from `namespace Bun::WebStreams` in WebStreamsInternals.h
   (which now includes the new header). See "Phase-C obligation: js2native" above.
9. JSReadableByteStreamController: the reachable `m_algorithms.kind` contract for the BYTE
   controller is now stated as exactly {JavaScript, Nothing, ByteTeeBranch} (CrossRealm is
   impossible: the cross-realm readable endpoint is always a DEFAULT controller and
   JSCrossRealmTransformState's back-pointer is exact-typed to one).
10. JSOneShotDirectSink: `boundOneShotStart` added to the one-shot [bound-convention]
    X-macro group (a no-op target that returns undefined); the surface comment states that
    the one-shot controller's `start` own property is bound to it.
11-15. Comment conventions, applied to every file: review-artifact / finding-ID /
    specs-document citations, design-history narratives, and workflow/PR-lifecycle
    narration deleted and replaced with their durable contract; every ASCII-art divider
    line stripped; name-restating member comments deleted; file banners trimmed to <= 3
    lines plus their genuine contracts. Kept intact: `// [[slotName]]` spec-slot mappings,
    `// userJS: yes|no — owner.cpp` tags, ownership/lifetime contracts, and every
    `visitChildren MUST visit:` list.
16-18. No further finder-report items exist. Nothing else was changed.

Files created: `streams/StreamConstructor.h` (66 lines), `streams/BunStreamConsumers.h`
(24 lines). Files deleted: none. Total `src/jsc/bindings/webcore/streams/*.h` line count:
4422 before (34 files) -> 3621 after (36 files), a net delta of -801 lines.
Verified with `python3 specs/check-streams.py` -> `[check-streams] 36 headers -> CLEAN`.
