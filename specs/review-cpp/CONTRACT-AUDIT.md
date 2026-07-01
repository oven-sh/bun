# CONTRACT-AUDIT — cross-file seams between the 32 streams `.cpp` TUs

Scope: ONLY the seams no per-file review can see — registration↔handler context agreement,
bound-callable shapes, duplicate/missing symbols across TUs, the ControllerKind dispatch
contracts, and X-macro accessor naming. Per-file spec fidelity and GC safety were NOT re-reviewed.
Every `performPromiseThenWithContext`, `JSBoundFunction::create`, `queueMicrotask` deferral,
`JSC_DEFINE_HOST_FUNCTION`, and X-macro entry across all 32 `.cpp` + the frozen headers was
enumerated (greps + a scripted declaration/definition sweep of `WebStreamsInternals.h` and
`JSStreamsRuntime.h`).

---

## Findings

### [CRITICAL] `JSTransformStreamDefaultController.cpp` was never written — an entire planned owner TU is missing (≥8 undefined symbols at Phase-C link, incl. one X-macro handler)

The planned owner-file set is 33 files, not 32. The ownership rule and the plan both name the
missing file explicitly:

- `specs/ARCHITECTURE.md:125-128`: "`TransformStreamDefaultControllerEnqueue` → `JSTransformStreamDefaultController.cpp`"
- `specs/PHASE-A-NOTES.md:136`: "*JSTransformStreamDefaultController.cpp (5):* ClearAlgorithms, Enqueue, Error, PerformTransform, Terminate"
- `specs/PHASE-B-LOG.md:237`: "FULL PROBE OVER ALL **32** .cpp: ZERO non-CLEAN" — no Phase-B agent
  was ever assigned this file; the per-TU syntax probe (`check-streams.py` is `-fsyntax-only`)
  cannot see a missing *definition* in another TU, so nothing caught it.

`JSTransformStreamDefaultController.h` exists (frozen), but NO `.cpp` defines any of it.

**Side A — cross-file callers of the missing definitions (all compile clean, all link-fail):**

1. The 5 declared abstract ops, `WebStreamsInternals.h:385-390` (each annotated
   "`— JSTransformStreamDefaultController.cpp`"):
   - `transformStreamDefaultControllerPerformTransform` — called at
     `TransformStreamOperations.cpp:226` (`RELEASE_AND_RETURN(scope, transformStreamDefaultControllerPerformTransform(globalObject, controller, chunk))`)
     and `TransformStreamOperations.cpp:320` (inside `onTSSinkWriteBackpressureChangeFulfilled`).
   - `transformStreamDefaultControllerClearAlgorithms` — `TransformStreamOperations.cpp:157,241,261,280`.
   - `transformStreamDefaultControllerEnqueue` — `JSTextEncoderStream.cpp:310`, `JSTextDecoderStream.cpp:377`.
   - `transformStreamDefaultControllerError`, `transformStreamDefaultControllerTerminate` — declared
     (`WebStreamsInternals.h`) with the IDL methods `TransformStreamDefaultController.prototype.{error,terminate}`
     as their only intended callers — which are ALSO in the missing file.
2. The class boilerplate: `TransformStreamOperations.cpp:113` and `:194` do
   `JSTransformStreamDefaultController::create(vm, WebCore::getDOMStructure<JSTransformStreamDefaultController>(vm, *domGlobalObject))`
   — requires `s_info`, `createStructure`, `prototype`, `subspaceForImpl`, `visitChildrenImpl`.
   A scripted sweep of every `X::s_info` / `X::createStructure` across all 32 `.cpp` finds every
   other cell class defined exactly once and `JSTransformStreamDefaultController` defined NOWHERE.
3. The X-macro reaction handler `onTSPerformTransformRejected`
   (`JSStreamsRuntime.h:127-129`, group `_TS_CONTROLLER`, "owner: JSTransformStreamDefaultController.cpp"):
   `JSStreamsRuntime.cpp:73-79` (`WEB_STREAMS_INIT_HANDLER` over `FOR_EACH_WEB_STREAMS_REACTION_HANDLER`)
   takes the address of `jsWebStreamsHandler_onTSPerformTransformRejected` → undefined symbol.
   No `JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onTSPerformTransformRejected` exists in any file
   (exhaustive grep), and no file ever fetches `runtime->onTSPerformTransformRejected()`.

**Side B — what should own them:** nothing. No other TU claims the group (PHASE-B-LOG cross-cutting
fact 3: each X-macro group's handler bodies live in the group's owner `.cpp`; `JSStreamsRuntime.cpp`
owns "any unowned group" but was written with ZERO handler bodies, PHASE-B-LOG line 84-86).

**Runtime consequence:** Phase C cannot link (`JSStreamsRuntime.cpp`, `TransformStreamOperations.cpp`,
`JSTextEncoderStream.cpp`, `JSTextDecoderStream.cpp` all reference undefined symbols). Beyond the
link error, the *behavior* the file owns is absent: `controller.enqueue/error/terminate/desiredSize`
(the entire public TransformStreamDefaultController prototype), and the PerformTransform rejection
reaction (spec TransformStreamDefaultControllerPerformTransform step 2 — "react to rejection: error
the transform stream and rethrow") is neither implemented nor registered anywhere, so even a
hand-stubbed link would leave a user `transform()` rejection silently un-erroring the stream.

**Fix (one new file):** write `src/jsc/bindings/webcore/streams/JSTransformStreamDefaultController.cpp`
— the class boilerplate + prototype (enqueue/error/terminate + desiredSize getter), the 5 declared
ops, and the `jsWebStreamsHandler_onTSPerformTransformRejected` body (context = the
JSTransformStreamDefaultController per `JSStreamsRuntime.h:128`), with `PerformTransform`
registering it via `performPromiseThenWithContext(..., jsUndefined(), onTSPerformTransformRejected, resultPromise, controller)`.
No other file needs to change.

---

### [MAJOR] Direct-controller (b) adapter: a deferred `flush()` inside `pull()` steals the queued NON-promise read request and delivers the chunk to an unobserved promise (pipeTo / tee / for-await over a `type:"direct"` stream can hang)

This is the precise characterization of pb-readers' design-gap note #3 (`PHASE-B-LOG.md:220-226`,
ruled "ACCEPTED AS-IS … GATED ON A FAILING TEST in Phase D"). The ruling describes it as
"misroute ONE chunk"; the two files' actual interaction is worse: the read request is
*destructively dequeued* and dropped, so the non-promise consumer stalls forever.

**Side A — the (b) adapter, `JSReadableStreamDefaultReader.cpp:126-137`
(`readableStreamDefaultReaderRead`, `ControllerKind::Direct`, non-`Promise` request kinds):**

```cpp
readableStreamAddReadRequest(vm, stream, readRequest);          // request queued FIRST
bool hadPendingRead = !!controller->m_pendingRead;
JSValue pulled = controller->onPull(globalObject);              // runs the user pull()
...
if (!hadPendingRead && controller->m_pendingRead && pulled == JSValue(controller->m_pendingRead.get()))
    controller->m_pendingRead.clear();                          // compensation: drop the unobserved head-of-line promise
```

The compensation only helps when the head-of-line promise created by `onPull` is *still pending
and still stored* when `onPull` returns.

**Side B — `JSDirectStreamController.cpp`:**

- `onPull` (`:519-527`) unconditionally creates a fresh head-of-line promise when
  `m_pendingRead` is null — it does not consider that `[[readRequests]]` is non-empty:
  ```cpp
  if (!m_pendingRead) {
      auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
      m_pendingRead.set(vm, this, promise);   // P
      promiseToReturn = promise;
  }
  ...
  if (deferredFlush == 1) { onFlush(globalObject); ... }   // AFTER P was created
  ```
- A user `sink.flush()` during `pull()` is deferred (`m_deferFlush = 1`, `:664-665`) and runs at
  the tail of `onPull` above; `onFlush` (`:634-652`) then prefers `m_pendingRead`:
  ```cpp
  if (auto* pendingRead = m_pendingRead.get()) {
      m_pendingRead.clear();
      ... if (byteLengthOf(flushed)) {
          { Locker locker { reader->cellLock() };
            if (!reader->m_readRequests.isEmpty()) {
                auto nextRequest = reader->m_readRequests.takeFirst();      // <-- dequeues the TEE/PIPE/ITERATOR request
                if (readRequest && readRequest->kind() == ReadRequestKind::Promise)   // it is NOT Promise-kind
                    m_pendingRead.set(...);                                  // (not re-armed)
          } }
          ... RELEASE_AND_RETURN(scope, pendingRead->fulfill(vm, result));   // chunk goes into P
  ```

**Interaction:** for a non-promise consumer (tee branch pull, pipeTo, for-await/`values()`) on a
`type:"direct"` stream whose `pull(sink)` synchronously does `sink.write(chunk); sink.flush()`:
1. the request is queued (side A), 2. `onPull` creates P, 3. the deferred `onFlush` `takeFirst()`s
the queued request, discards it (not Promise-kind), and fulfills P with the chunk, clearing
`m_pendingRead`, 4. back in side A `controller->m_pendingRead` is now null so the compensation
does not fire. Net: the chunk is resolved into a promise nothing observes AND the ReadRequest's
`chunkSteps/closeSteps/errorSteps` never run — `pipeTo()` / `tee()` branch reads / `for await`
never settle. (The plain `read()` path is unaffected: Promise-kind requests take the (a) arm.)

**Fix (which file):** minimal, contract-preserving fix is in `JSDirectStreamController.cpp::onFlush`
(and the identical `takeFirst` shape in `onClose`, `:585-596`): only `takeFirst()` when the head
request is `Promise`-kind (peek before popping); otherwise leave `m_pendingRead` untouched and route
through `readableStreamFulfillReadRequest(...)` like the no-pendingRead branch already does. The
ruled long-term fix (one additive X-macro handler making the (b) arm reaction-based) stands for
Phase D. Either way this needs the Phase-D failing test the ruling demanded; I am recording that
the failure mode is a *hang + lost read request*, not a one-chunk misroute.

---

### [MINOR] One-shot sink `end`/`close` bound context deviates from the frozen header comment (self-consistent, but the deviation was never logged)

- Registration, `BunStreamConsumers.cpp:663-668` (`installOneShotMethods`): `end` and `close` are
  bound over `boundOneShotDirectClose` with context = `closeContext`, an
  `InternalFieldTuple{sink, userCloseFunction}` — while `start`/`write`/`flush` bind the sink cell.
- Body, `BunStreamConsumers.cpp:1239-1244` (`jsWebStreamsHandler_boundOneShotDirectClose`):
  `uncheckedDowncast<InternalFieldTuple>(callFrame->uncheckedArgument(0))`, fields `{0:sink, 1:closeFn}`.
- Header contract, `JSStreamsRuntime.h:241-249`: "Its {start, write, end, close, flush} are OWN
  JSBoundFunctions over these; **context (argument 0) = the JSOneShotDirectSink cell**".

Both sides live in `BunStreamConsumers.cpp`, so there is no runtime bug — but this is exactly the
"tuple where the frozen comment said one cell" class that PHASE-B required to be logged (three prior
rulings). It is not in PHASE-B-LOG. **Fix:** add it to the Phase-D header-comment fix list
(`JSStreamsRuntime.h:244`); alternatively root the user `close` function on the `JSOneShotDirectSink`
cell (it already roots the stream/sink/promise/closed flag per `JSOneShotDirectSink.h`) and bind the
sink like the other three, which restores the documented contract.

### [MINOR] Dead cross-realm runtime state (expected, but nothing marks it)

`onCrossRealmWritableBackpressureFulfilled` (body: `CrossRealmTransform.cpp:58`, an
assert-not-reached stub) is never fetched from any registration site, and
`crossRealmTransformStateStructure` (`JSStreamsRuntime.h:286`) is never used by any `.cpp`
(scripted sweep of all `runtime->…Structure(` / `runtime->on…()` uses). Consistent with
"transferable streams are not implemented"; listing so Phase C/D doesn't mistake it for a lost seam.

### [MINOR] Static-helper duplication across TUs (no ODR problem — all `static` — but the Phase-D dedup list is incomplete)

`queueReactionJob` (`JSReadRequest.cpp:46`, `ReadableStreamOperations.cpp:83`) is already on the
Phase-D dedup list (PHASE-B-LOG line 152). Also byte-for-byte duplicated file-local statics found by
the sweep and NOT yet listed: `defaultControllerOf` / `byteControllerOf`
(`JSReadRequest.cpp:32,38`, `ReadableStreamOperations.cpp:41,56`, `JSReadableStreamDefaultReader.cpp:40,46`,
`byteControllerOf` also `JSReadableStreamBYOBReader.cpp`), `invokeMethod`
(`BunStreamConsumers.cpp:170`, `BunStreamSource.cpp:277`), the bound-handler factory
(`BunStreamSource.cpp:259 createBoundHandler` vs `BunStreamConsumers.cpp:641 createOneShotBoundMethod`),
and `convertQueuingStrategyInit` (`JSByteLengthQueuingStrategy.cpp:126`, `JSCountQueuingStrategy.cpp:126`).
All are link-safe (internal linkage). Fix: fold into the existing Phase-D dedup pass.

---

## Verified cross-file contracts (both sides quoted-checked; NO mismatch)

Every `performPromiseThenWithContext` / `queueMicrotask` registration was matched to its handler
body's downcast + field reads. All agree with the reaction convention `(value@0, context@1)`:

| Contract (registration site) | Context passed | Handler body (file) | Agrees |
|---|---|---|---|
| RS default/byte controller start (`ReadableStreamOperations.cpp:522,553,586,619` via `reactToStartResult`) + pull (`JSReadableStreamDefaultController.cpp:470`, `JSReadableByteStreamController.cpp:603`) | the controller cell | `JSReadableStreamDefaultController.cpp:327-380`, `JSReadableByteStreamController.cpp:430-478` | ✓ (cross-file for start) |
| WS controller start (`WritableStreamOperations.cpp:73`) / sink close+write (`JSWritableStreamDefaultController.cpp:586,597`) | the WS controller cell | `JSWritableStreamDefaultController.cpp:314-410` | ✓ (cross-file for start) |
| **WS abortSteps** (`WritableStreamOperations.cpp:346-347`) | `InternalFieldTuple{abortRequestPromise, stream}` | same file `:533-560` reads `{0:promise, 1:stream}` | ✓ (matches PHASE-B contract) |
| **TS sink-write backpressure** (`TransformStreamOperations.cpp:221-223`) | `{stream, chunk}` | same file `:306` reads `{0:stream, 1:chunk}` | ✓ |
| **TS sink-abort / source-cancel** (`TransformStreamOperations.cpp:243-245, 282-284`) | `{stream, reason}` | same file `:325-355, 391-425` read `{0:stream, 1:reason}` | ✓ |
| TS sink-close-flush (`TransformStreamOperations.cpp:264`) | the JSTransformStream | same file `:359-388` | ✓ |
| **ByteTee read-into request** (`ReadableStreamOperations.cpp:1049-1051`) | `InternalFieldTuple{teeState, jsBoolean(forBranch2)}` | `JSReadRequest.cpp:300-345` (closeSteps/errorSteps) + microtask `onByteTeeReadIntoChunkMicrotask` → `ReadableStreamOperations.cpp:1136` | ✓ (matches PHASE-B binding contract, BOTH files) |
| DefaultTee / ByteTee (non-BYOB) read request (`ReadableStreamOperations.cpp:872,1025`) | the JSStreamTeeState | `JSReadRequest.cpp:117-120,145-182,207-210` + `ReadableStreamOperations.cpp:1317-1341` | ✓ |
| Byte-tee reader-closed (`ReadableStreamOperations.cpp:1002-1003`) | `{teeState, thisReader}` | same file `:1193` | ✓ |
| **AsyncIterator read request** (`JSReadableStreamAsyncIterator.cpp:158-160`) | `InternalFieldTuple{iterator, perCallPromise}` | `JSReadRequest.cpp:121-127,183-193,211-219` reads `{0:iterator, 1:promise}` | ✓ (matches PHASE-B contract, BOTH files) |
| AsyncIterator next/return/cancel settle (`:215,242,198`) | iterator / `{iterator,returnValue}` / iterator | same file `:256-289` | ✓ |
| **Pipe** source/dest closed, writer ready, write settled (`JSStreamPipeToOperation.cpp:524-525,553,557,132,369`) | the op cell | same file trampolines `:400-433` | ✓ |
| **Pipe AbortBoth latch** (`JSStreamPipeToOperation.cpp:176-179`) | `InternalFieldTuple{op, jsNumber(actionCount)}` (single action → bare op) | same file `:439-478` (`pipeOpFromShutdownActionContext` handles both; `{0:op, 1:remaining}`) | ✓ (matches PHASE-B contract) |
| PipeTo read request (`JSStreamPipeToOperation.cpp:135`) | the op cell | `JSReadRequest.cpp:116,144,206` → `pipeToReadRequest*Steps` defined `JSStreamPipeToOperation.cpp:540-575` | ✓ (the amended frozen-ABI bridge exists) |
| Direct pull rejection (`JSDirectStreamController.cpp:488`) | the direct controller | same file `:669` | ✓ |
| readMany (`JSReadableStreamDefaultReader.cpp:333,363`) | the reader | same file `:679-694` (Direct variant ignores its context by design) | ✓ |
| Native source pull / callClose (`BunStreamSource.cpp:638,408`) | the adapter | same file `:1543-1587` | ✓ |
| readStreamIntoSink read/readMany/flush/reject (`BunStreamSource.cpp:1207,1253,1081`) | op, or `{op, tail}` for flush | same file `:1589-1640` (`rsisOpFromContext` handles both shapes) | ✓ |
| ResumableSink read/end (`BunStreamSource.cpp:1422,1360,1525`) | the pump op | same file `:1641-1680` | ✓ |
| Consumers: buffered fast path / into-array `{reader,chunks}` / direct loop `{stream,reader}` / one-shot pull (sink) / toFormData (contentType) (`BunStreamConsumers.cpp:444,557,592,752,808,881,904,923`) | as listed | same file `:1057-1213` (field indices match) | ✓ |
| `onReturnUndefined` (`ReadableStreamOperations.cpp:349`, `BunStreamSource.cpp:868`) | unused | `WebStreamsMisc.cpp:329` | ✓ |

**Deferral mechanisms agree with the reaction convention on both sides:**
`BunPerformMicrotaskJob` (`JSReadRequest.cpp:46-54`, `ReadableStreamOperations.cpp:83-90`,
`WritableStreamOperations.cpp:76-77`) → `job(arg2, arg3)` = `handler(value, context)`
(JSMicrotask dispatch: arguments = job, asyncContext, arg0, arg1); `BunInvokeJobWithArguments`
(`BunStreamSource.cpp:270-274`) → `job(value, context)`. Same observable convention.

**Bound convention `(contextCell@0, ...callArgs)` — all 4 creation shapes bind exactly one leading
context and every target body reads `argument(0)` as that cell type:**
- `BunStreamSource.cpp:259-267` → `boundOnNativeSourceClose(adapter)` / `boundOnNativeSourceDrain(adapter, chunk)`
  / `boundReadDirectStreamOnClose(state, stream, reason)` / `boundReadStreamIntoSinkOnClose(op, stream, reason)`
  / `boundResumableSinkDrain(op)` / `boundResumableSinkCancel(op, _, reason)` — bodies `:1685-1745`
  read exactly those positions; the native side invokes onClose with zero call-args
  (`src/runtime/webcore/ReadableStream.rs:933-936 queue_microtask(cb, &[])`), consistent.
- `JSDirectStreamController.cpp:750-764` (write/end/close/flush/error over the 4 targets, `end` and
  `close` two cells over `boundDirectClose`) ↔ bodies `:685-737`.
- `BunStreamConsumers.cpp:641-671` one-shot 5 methods ↔ bodies `:1222-1275` (see the MINOR above).
- `JSStreamPipeToOperation.cpp:512-519` `boundPipeAbortAlgorithm(op)` handed to
  `JSAbortAlgorithm` (invoked as `(reason)`) ↔ body `:480` reads `(op@0, reason@1)`.

**ControllerKind dispatches are TOTAL:** `readableStreamDefaultReaderRead`
(`JSReadableStreamDefaultReader.cpp:87-140`: Default, Byte, None→queue, Direct(a)/(b), NativeSink)
and `readableStreamReaderGenericRelease` `[[ReleaseSteps]]`
(`ReadableStreamOperations.cpp:402-431`: None/Direct/NativeSink no-op arms, Default (+ native
handle unref), Byte).

**No duplicate symbols:** no `JSC_DEFINE_HOST_FUNCTION` / `JSC_DEFINE_CUSTOM_GETTER` name defined
twice; no class member (`s_info`, `subspaceForImpl`, `visitChildrenImpl`, `isBYOB` —
`JSReadableStreamReaderBase.cpp:9` only) defined in two TUs; no duplicate `extern "C"` symbol
(all 19 in `WebStreamsExports.cpp` only). Every cross-file free helper that appears in ≥2 files is
`static` (internal linkage).

**X-macro accessor names:** every `runtime->onXxx()` / `runtime->boundXxx()` /
`runtime->xxxStructure()` call in every `.cpp` names an accessor generated by the header's
X-macros (scripted diff: used-but-not-declared = ∅).

---

## Handler coverage table

`FOR_EACH_WEB_STREAMS_REACTION_HANDLER` (71) → file defining `JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_<name>)`:

| Handler | Defined in |
|---|---|
| onReturnUndefined | WebStreamsMisc.cpp |
| onRSDefaultControllerStartFulfilled / StartRejected / PullFulfilled / PullRejected | JSReadableStreamDefaultController.cpp |
| onRSByteControllerStartFulfilled / StartRejected / PullFulfilled / PullRejected | JSReadableByteStreamController.cpp |
| onFromIterablePullFulfilled, onFromIterableCancelFulfilled, onDefaultTeeReadChunkMicrotask, onDefaultTeeReaderClosedRejected, onByteTeeReadChunkMicrotask, onByteTeeReadIntoChunkMicrotask, onByteTeeReaderClosedRejected | ReadableStreamOperations.cpp |
| onAsyncIteratorNextAfterOngoingSettled, onAsyncIteratorReturnAfterOngoingSettled, onAsyncIteratorCancelFulfilled | JSReadableStreamAsyncIterator.cpp |
| onPipeSourceClosedFulfilled/Rejected, onPipeDestClosedFulfilled/Rejected, onPipeWriterReadyFulfilled, onPipeWriteSettled, onPipeWritesFinishedForShutdown (macro-generated), onPipeShutdownActionFulfilled/Rejected | JSStreamPipeToOperation.cpp |
| onWSAbortStepsFulfilled, onWSAbortStepsRejected | WritableStreamOperations.cpp |
| onWSControllerStartFulfilled/Rejected, onWSSinkCloseFulfilled/Rejected, onWSSinkWriteFulfilled/Rejected | JSWritableStreamDefaultController.cpp |
| onTSSinkWriteBackpressureChangeFulfilled, onTSSinkAbortCancelFulfilled/Rejected, onTSSinkCloseFlushFulfilled/Rejected, onTSSourceCancelFulfilled/Rejected | TransformStreamOperations.cpp |
| **onTSPerformTransformRejected** | **MISSING** (owner `JSTransformStreamDefaultController.cpp` does not exist) |
| onCrossRealmWritableBackpressureFulfilled | CrossRealmTransform.cpp (stub; never registered — expected) |
| onNativePullFulfilled/Rejected, onNativeSourceCallCloseMicrotask, onReadStreamIntoSinkReadManyFulfilled / ReadFulfilled / FlushFulfilled / Rejected, onResumableSinkReadFulfilled / ReadRejected / EndMicrotask | BunStreamSource.cpp |
| onDirectPullRejected | JSDirectStreamController.cpp |
| onReadManyPullFulfilled, onReadManyDirectPullFulfilled | JSReadableStreamDefaultReader.cpp |
| onBufferedFastPathRejected/Settled, onReadableStreamToArrayBufferFulfilled / ToBytesFulfilled / ToJSONFulfilled / ToBlobFulfilled / ToFormDataFulfilled, onIntoArrayReadManyFulfilled/Rejected, onDirectConsumeLoopReadFulfilled/Rejected, onConsumeDirectToArrayBufferPullFulfilled/Rejected | BunStreamConsumers.cpp |

`FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET` (15):

| Target | Defined in |
|---|---|
| boundOnNativeSourceClose, boundOnNativeSourceDrain, boundReadDirectStreamOnClose, boundReadStreamIntoSinkOnClose, boundResumableSinkDrain, boundResumableSinkCancel | BunStreamSource.cpp |
| boundDirectWrite, boundDirectClose, boundDirectFlush, boundDirectError | JSDirectStreamController.cpp |
| boundOneShotStart, boundOneShotDirectWrite, boundOneShotDirectClose, boundOneShotDirectFlush | BunStreamConsumers.cpp |
| boundPipeAbortAlgorithm | JSStreamPipeToOperation.cpp |

Non-macro: `jsWebStreamsByteLengthQueuingStrategySize`, `jsWebStreamsCountQueuingStrategySize` → WebStreamsMisc.cpp ✓.

---

## Verdict

The seams are in remarkably good shape for 32 blind-parallel TUs — every registration↔handler
context contract (including all six PHASE-B binding tuples), every bound-callable shape, and every
X-macro accessor name agrees, with zero duplicate symbols. But Phase C cannot link and
TransformStream cannot work as reviewed: one entire planned owner file,
`JSTransformStreamDefaultController.cpp` (5 ops + class boilerplate + the `onTSPerformTransformRejected`
handler), was never assigned or written — 1 CRITICAL, plus 1 MAJOR (the Direct (b)-adapter can drop
a non-promise read request and strand its chunk) and 3 MINORs.
