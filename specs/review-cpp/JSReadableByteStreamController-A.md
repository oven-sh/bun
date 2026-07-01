# JSReadableByteStreamController.cpp — Lens A: SPEC-STEP FIDELITY

Reviewer: adversarial, spec-step-fidelity lens.
Ground truth: `specs/digest/02-readable-abstract-ops.md` §"Byte stream controllers" (lines 882–1362),
`specs/digest/02-readable-abstract-ops.md` §"Structures" (pull-into descriptor, byte queue entry),
`specs/digest/01-readable-classes.md` §"ReadableByteStreamController" (lines 671–825).
Target: `src/jsc/bindings/webcore/streams/JSReadableByteStreamController.cpp` (1227 LOC).
`python3 specs/check-streams.py <file>` → CLEAN.

Method: for every one of the 28 `readableByteStreamController*` abstract ops in this file, plus
`[[CancelSteps]]`/`[[PullSteps]]`/`[[ReleaseSteps]]`, plus the 5 IDL members
(`close`/`enqueue`/`error`/`byobRequest`/`desiredSize`), plus the four reaction handlers
(= SetUp steps 16–17 and CallPullIfNeeded steps 7–8), I placed the digest's numbered steps
side-by-side with the C++ and compared token by token: step order, slot names, `!` vs `?`
routing, error types and their order, every arithmetic expression, every re-fetch/re-validation
point, and every observable-side-effect ordering (detach points, `HandleQueueDrain` vs
`chunkSteps`, process-then-commit ordering). I also verified the load-bearing external facts the
port relies on: `JSC::typedArrayType(DataViewType) == TypeDataView`,
`JSC::elementSize(TypeDataView) == 1` (so `JSPullIntoDescriptor::elementSize()` derived from the
stored `m_viewConstructor` is exactly the spec's separately-stored "element size", including the
DataView case), and that `constructViewOfType`'s third argument is an element count for typed
arrays and a byte length for `%DataView%` — matching the spec's `Construct(ctor, « buffer,
byteOffset, length »)` semantics at all six construction sites.

## Findings

After a genuine token-by-token diff I found **no CRITICAL and no MAJOR spec-step deviations** in
this file. I attacked the prompt's priority list hardest; the per-op evidence for the hardest
areas is recorded below so the "clean" verdict is auditable rather than asserted. I record two
MINOR items that are the only concrete deltas a literal reading of the digest supports; both are
provably unobservable from JS and would not fail any WPT class.

### [MINOR] readableByteStreamControllerPullInto step 6 — the `minimumFill ≥ 0` half of the assert is not encoded

Digest (02 §PullInto step 6):
> 6. Assert: minimumFill ≥ 0 and minimumFill ≤ view.[[ByteLength]].

.cpp:994–996:
```cpp
size_t minimumFill = static_cast<size_t>(min) * elementSize;
ASSERT(minimumFill <= view->byteLength());
ASSERT(!(minimumFill % elementSize));
```

Divergence: only the `≤ view.[[ByteLength]]` half of the step-6 assert (and the step-7 remainder
assert) are written; the `minimumFill ≥ 0` half is absent.

Observable effect: none. `minimumFill` is `size_t` (unsigned), so `≥ 0` is a tautology; and the
caller (`ReadableStreamBYOBReader.read(view, options)` in a different translation unit) enforces
`min ≥ 1` and `min ≤ view.length` per digest 01, so no negative/overflowing value can reach
here. No WPT class is affected.

Minimal fix (documentation-completeness only): none required; optionally add
`static_assert(std::is_unsigned_v<size_t>)`-style intent or a comment noting the `≥ 0` half is
vacuous under `size_t`.

### [MINOR] [[PullSteps]] — dead `RETURN_IF_EXCEPTION` after an infallible descriptor allocation, absent at the sibling site in pullInto

Digest (01 §[[PullSteps]] step 5.3) creates the pull-into descriptor as a plain struct literal —
there is no fallible step between `Construct(%ArrayBuffer%, …)` (step 5.1, whose abrupt
completion is routed to the error steps at 5.2) and appending it (step 5.4).

.cpp:397–398:
```cpp
JSPullIntoDescriptor* pullIntoDescriptor = JSPullIntoDescriptor::create(vm, JSStreamsRuntime::from(globalObject)->pullIntoDescriptorStructure(zigGlobalObject));
RETURN_IF_EXCEPTION(scope, void());
```
vs. the byte-for-byte parallel site in `readableByteStreamControllerPullInto`, .cpp:1015:
```cpp
JSPullIntoDescriptor* pullIntoDescriptor = JSPullIntoDescriptor::create(vm, JSStreamsRuntime::from(globalObject)->pullIntoDescriptorStructure(zigGlobalObject));
```
(no exception check).

Divergence: an extra "step" (an exception check) that corresponds to nothing in the digest, and
that is inconsistent with the identical construction in `PullInto` two hundred lines later.
`JSPullIntoDescriptor::create` is `allocateCell` + `finishCreation` and cannot leave an
exception pending, so the check is dead on both counts.

Observable effect: none (the branch is unreachable). No WPT class is affected.

Minimal fix: delete the `RETURN_IF_EXCEPTION(scope, void());` at .cpp:398 (or, if the intent was
defensive, add the same line at .cpp:1015 — but the digest supports neither, so deletion is the
faithful shape).

## Detailed evidence for the highest-risk ops (why they are clean)

These are recorded because a "clean" verdict on this file is otherwise unfalsifiable. Each item
is a place where an implementation typically deviates and where I confirmed exact fidelity.

**respondWithNewView — the detach/read ordering.** Digest step 10 captures
`viewByteLength = view.[[ByteLength]]` BEFORE step 11's `? TransferArrayBuffer` detaches
`view`'s buffer (which would zero `view.[[ByteLength]]`), and step 12 passes the CAPTURED value
into RespondInternal. .cpp:1186 reads `size_t viewByteLength = view->byteLength();` at the top
of the function — before the transfer at 1213 — and 1216 passes `viewByteLength` (not
`view->byteLength()`) into `respondInternal`. Steps 5, 6, 9 all use the same pre-transfer value.
The three throw checks are in the digest's exact order and types (TypeError, TypeError,
RangeError@offset, RangeError@bufferByteLength, RangeError@overflow) at .cpp:1187–1212. Step 8's
`firstDescriptor's buffer byte length` vs `view.[[ViewedArrayBuffer]].[[ByteLength]]` is
.cpp:1205 (`m_bufferByteLength != viewedBuffer->impl()->byteLength()`).

**respond — the transfer point.** Digest step 6 (`Set firstDescriptor's buffer to
! TransferArrayBuffer(firstDescriptor's buffer)`) happens AFTER all four throw checks (4.1,
5.2, 5.3) and BEFORE `? RespondInternal`. .cpp:1067–1086: the two TypeErrors and the RangeError
precede the transfer at 1083–1085; the RangeError check widens both operands to `uint64_t`
before comparing (`static_cast<uint64_t>(m_bytesFilled) + bytesWritten >
static_cast<uint64_t>(m_byteLength)`), so it cannot lose precision or wrap.

**respondInternal — the firstDescriptor re-validation.** Digest step 1 RE-FETCHES
`controller.[[pendingPullIntos]][0]` (it is not a parameter). .cpp:1161 re-fetches
`controller->m_pendingPullIntos.first().get()` rather than threading the pointer from `respond`
/ `respondWithNewView`. Step 2's `Assert: CanTransferArrayBuffer(...)` is .cpp:1162.
`InvalidateBYOBRequest` (step 3) precedes the state dispatch, so the
`Assert: controller.[[byobRequest]] is null` inside every downstream `ShiftPendingPullInto` /
`FillHeadPullIntoDescriptor` is established here, matching the spec's dependency chain.

**respondInReadableState — the `remainderAfter(mod elementSize)` arithmetic and step ordering.**
Digest steps 5→11 vs .cpp:1135–1154: Shift (1135) → `remainderSize = bytesFilled % elementSize`
(1136) → `end = byteOffset + bytesFilled; EnqueueClonedChunkToQueue(buffer, end − remainderSize,
remainderSize)` guarded by `remainderSize > 0` with the digest's `?` propagation
(RETURN_IF_EXCEPTION at 1140) → `bytesFilled -= remainderSize` (1142, correctly AFTER the clone
and NOT executed if the clone threw) → `Process` into `filledPullIntos` (1144) →
`Commit(pullIntoDescriptor)` (1149, the shifted descriptor itself, step 10) → then the loop over
`filledPullIntos` (1151, step 11). The Process-BEFORE-Commit(self)-BEFORE-Commit(rest) ordering
is the modern (post-#1290/#1300) spec and is reproduced exactly. The reader-type "none" arm
(steps 3.1–3.4) is .cpp:1118–1131 with `?` on EnqueueDetachedPullIntoToQueue and the early
`return` at step 3.4 (.cpp:1131). Step 4's early return on `bytesFilled < minimumFill` is
.cpp:1133–1134.

**respondInClosedState — collect-then-commit.** Digest steps 4.2 (while `filledPullIntos.size <
NumReadIntoRequests`, shift+append) then 4.3 (commit each) are two SEPARATE loops in the digest
and two separate loops at .cpp:1099–1100 and 1105–1108 (not interleaved). The reader-type-"none"
shift at step 2 (.cpp:1094–1095) precedes them. `stream` is fetched fresh (.cpp:1096).

**fillPullIntoDescriptorFromQueue — the modern `min` semantics.** Digest steps 1–9 vs
.cpp:836–847: `maxBytesToCopy = min(queueTotalSize, byteLength − bytesFilled)`;
`maxBytesFilled = bytesFilled + maxBytesToCopy`; `remainderBytes = maxBytesFilled %
elementSize`; `maxAlignedBytes = maxBytesFilled − remainderBytes`; the readiness gate is
`maxAlignedBytes >= m_minimumFill` (the MODERN `minimum fill` comparison, .cpp:844), NOT the
pre-`min` `> currentAlignedBytes` form. Both step-5 (`!IsDetachedBuffer`) and step-6
(`bytesFilled < minimumFill`) asserts are present in the digest's exact position (.cpp:840–841).
The copy loop is a line-for-line transcription of steps 11.1–11.13, including: `bytesToCopy =
min(remaining, headOfQueue.byteLength)` (.cpp:851); `destStart = byteOffset + bytesFilled`
computed BEFORE the `FillHead` increment (.cpp:852); the `CanCopyDataBlockBytes` assert made a
RELEASE_ASSERT (.cpp:856) as the digest's Warning note directs ("The user agent should always
check this assertion, and stop in an implementation-defined manner"); the split-vs-consume of
the head entry decided by comparing `byteLength == bytesToCopy` BEFORE any mutation (.cpp:858);
`queueTotalSize -= bytesToCopy` (11.11) before `FillHead` (11.12) before the remaining-counter
decrement (11.13). The step-12 "not ready" asserts are all three present (.cpp:870–874).

**enqueue (abstract op) — the three queue variants, the detach points, and the reader switch.**
Digest step 6's detach check precedes step 7's `? TransferArrayBuffer(buffer)` (.cpp:708→712),
so the chunk IS detached before the step-8.2 TypeError on a detached head descriptor
(.cpp:714–718) can fire — the spec's deliberate quirk is preserved. Step 8.4's `!` re-transfer
of the head descriptor's buffer (.cpp:721–723) then step 8.5's `?`
`EnqueueDetachedPullIntoToQueue` gated on reader type "none" (.cpp:724–727). The final reader
switch is an exact if / else-if / else over `HasDefaultReader` (step 9) / `HasBYOBReader` (step
10) / neither (step 11 with its `!IsReadableStreamLocked` assert, .cpp:759), and
`CallPullIfNeeded` (step 12) runs unconditionally after all three (.cpp:762). The variant
routing is exact: the plain chunk → `EnqueueChunkToQueue`; the detached-pull-into's filled
prefix → `EnqueueClonedChunkToQueue` (via `EnqueueDetachedPullIntoToQueue`), never the plain
variant; the BYOB branch enqueues THEN runs `ProcessPullIntoDescriptorsUsingQueue` into a caller
`MarkedArgumentBuffer` and commits (.cpp:747–757). Step 9.3.3's
`Construct(%Uint8Array%, « transferredBuffer, byteOffset, byteLength »)` is
`constructViewOfType(TypeUint8, …)` (.cpp:741).

**pullInto — the ctor/elementSize derivation, the ladder ORDER, and the fast path.** Steps 2–4's
`elementSize`/`ctor` derivation is a single `typedArrayType(view->type())` + `JSC::elementSize`
(.cpp:992–993); verified `typedArrayType(DataViewType) == TypeDataView` and
`elementSize(TypeDataView) == 1`, so the DataView arm of steps 2–3 is preserved. The branch
ORDER is exact: step 14 (pendingPullIntos non-empty → append + AddReadIntoRequest + return,
.cpp:1024–1031) BEFORE step 15 (closed → 0-length `Construct(ctor, …, 0)` + closeSteps,
.cpp:1032–1036) BEFORE step 16 (queue fast path). Inside step 16, 16.1's
Convert → **HandleQueueDrain → chunkSteps** ordering (.cpp:1039–1043) matches 16.1.1–16.1.3
(HandleQueueDrain BEFORE chunkSteps — the classic ordering bug is absent), and 16.2's
closeRequested error path performs Error(controller, e) and then errorSteps(e) with the SAME
`e` object (.cpp:1045–1050). Steps 10–11's abrupt-completion routing of `TransferArrayBuffer` to
the readIntoRequest's error steps (not a synchronous throw) is a real catch-scope conversion
(.cpp:1002–1013).

**[[PullSteps]] — the autoAllocate construct and its abrupt routing.** Digest 01 steps 5.1–5.2:
`Construct(%ArrayBuffer%, « autoAllocateChunkSize »)`, abrupt → `readRequest`'s ERROR steps (not
a throw). .cpp:383–394 wraps `constructArrayBuffer` in a catch scope and routes the taken abrupt
completion to `readRequest->errorSteps`. The descriptor literal (.cpp:399–406) matches every
digest field: bufferByteLength/byteLength = autoAllocateChunkSize, byteOffset 0, bytesFilled 0,
minimumFill 1, viewConstructor %Uint8Array% (⇒ element size 1), readerType "default". Step 6
`AddReadRequest` follows the append; step 7 `CallPullIfNeeded` last. The step-3 fast path
asserts `NumReadRequests == 0` and calls `FillReadRequestFromQueue` then returns.

**processPullIntoDescriptorsUsingQueue.** The C++ signature takes the caller's
`MarkedArgumentBuffer& filledPullIntos` and appends into it (.cpp:954–966); the loop's two stop
conditions (`pendingPullIntos empty`, `queueTotalSize == 0` → break) and the shift-only-if-ready
body match digest steps 1–3 exactly, including the top-of-function
`Assert: closeRequested is false`. Every one of the three call sites checks
`filledPullIntos.hasOverflowed()` before iterating.

**commitPullIntoDescriptor / convertPullIntoDescriptor.** Both digest asserts (not-errored,
readerType ≠ none) are present; `done` is set only in the closed state with its mod-elementSize
assert; the default/byob dispatch is exact. Convert transfers the DESCRIPTOR's buffer (step 5)
and constructs the STORED `m_viewConstructor` over `(buffer, byteOffset, bytesFilled ÷
elementSize)` (.cpp:692–694) — an element count for typed arrays and a byte count for DataView,
both correct because `constructViewOfType` routes `%DataView%` to `JSDataView::create` whose
length parameter is a byte length.

**IDL validation ladders (digest 01).** `close()`: closeRequested → TypeError, then state →
TypeError, in that order (.cpp:531–534). `enqueue()`: brand → arg count → ArrayBufferView
conversion (TypeError; SAB-backed rejected per WebIDL, no `[AllowShared]`) →
`chunk.[[ByteLength]] == 0` TypeError → `viewedBuffer.[[ByteLength]] == 0` TypeError →
closeRequested TypeError → state TypeError (.cpp:544–563); the four TypeErrors are in the
digest's exact order. `error(e)` has no validation beyond brand. `byobRequest` returns `null`
(not `undefined`) when the op returns null; `desiredSize` returns `null` for `nullopt`.

## Ops verified clean

Prototype / class surface (digest 01):
- `byobRequest` getter, `desiredSize` getter, `close()`, `enqueue(chunk)`, `error(e)`
- `[[CancelSteps]](reason)`, `[[PullSteps]](readRequest)` (subject to MINOR #2), `[[ReleaseSteps]]()`
- SetUp start-reaction handlers (`onRSByteControllerStartFulfilled/Rejected` = SetUp steps 16–17)
- pull-reaction handlers (`onRSByteControllerPullFulfilled/Rejected` = CallPullIfNeeded steps 7–8)

Abstract operations (digest 02, all 28 in this file):
- readableByteStreamControllerCallPullIfNeeded
- readableByteStreamControllerShouldCallPull
- readableByteStreamControllerClearAlgorithms
- readableByteStreamControllerClearPendingPullIntos
- readableByteStreamControllerClose
- readableByteStreamControllerCommitPullIntoDescriptor
- readableByteStreamControllerConvertPullIntoDescriptor
- readableByteStreamControllerEnqueue
- readableByteStreamControllerEnqueueChunkToQueue
- readableByteStreamControllerEnqueueClonedChunkToQueue
- readableByteStreamControllerEnqueueDetachedPullIntoToQueue
- readableByteStreamControllerError
- readableByteStreamControllerFillHeadPullIntoDescriptor
- readableByteStreamControllerFillPullIntoDescriptorFromQueue
- readableByteStreamControllerFillReadRequestFromQueue
- readableByteStreamControllerGetBYOBRequest
- readableByteStreamControllerGetDesiredSize
- readableByteStreamControllerHandleQueueDrain
- readableByteStreamControllerInvalidateBYOBRequest
- readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue
- readableByteStreamControllerProcessReadRequestsUsingQueue
- readableByteStreamControllerPullInto (subject to MINOR #1)
- readableByteStreamControllerRespond
- readableByteStreamControllerRespondInClosedState
- readableByteStreamControllerRespondInReadableState
- readableByteStreamControllerRespondInternal
- readableByteStreamControllerRespondWithNewView
- readableByteStreamControllerShiftPendingPullInto

Supporting static helpers diffed against the spec primitives they implement:
- `constructArrayBuffer` (= Construct(%ArrayBuffer%, « n »), abrupt-on-OOM)
- `cloneArrayBuffer` (= CloneArrayBuffer(buffer, byteOffset, byteLength, %ArrayBuffer%))
- `constructViewOfType` (= Construct(ctor, « buffer, byteOffset, length »), all 13 ctors)
- `invokePromiseReturningMethod` (WebIDL callback with Promise return: abrupt → rejected promise)
- `performByteControllerPullAlgorithm` / `performByteControllerCancelAlgorithm`
  ([[pullAlgorithm]]/[[cancelAlgorithm]] dispatch; the "algorithm that returns a promise
  resolved with undefined" default for a missing pull/cancel is the `!method → resolved(undefined)` arm)
- `transferArrayBuffer` / `canTransferArrayBuffer` / `canCopyDataBlockBytes` (in
  `WebStreamsMisc.cpp` — read to confirm the semantics this file depends on; reviewed here only
  as consumers)

## Verdict

**CLEAN for spec-step fidelity.** A token-by-token diff of every abstract op, internal method,
and IDL member against digests 02/01 found no skipped, reordered, or mis-slotted step, no `!`/`?`
inversion, no missing spec-mandated re-validation, and no incorrect
buffer/byteOffset/byteLength/mod-elementSize arithmetic; the two MINORs above (a vacuous half of
one assert, one dead exception check) are the only literal deltas and neither is JS-observable.
Confidence is high because the highest-risk sites (the respond* detach ordering, the
respondWithNewView pre-transfer `viewByteLength` capture, the modern minimum-fill logic, and the
Process→Commit(self)→Commit(rest) ordering) were each individually verified and are documented
above; residual risk is concentrated in the helpers this file delegates to
(`WebStreamsMisc.cpp`, `JSReadableStreamBYOBRequest.cpp`), which are out of this pass's scope.
