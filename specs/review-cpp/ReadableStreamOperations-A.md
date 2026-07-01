# ReadableStreamOperations.cpp — Lens A: spec-step fidelity

Reviewed against `specs/digest/02-readable-abstract-ops.md` (all step numbers below refer to it),
`specs/digest/01-readable-classes.md`, `specs/BUN-LAYER-DESIGN.md` §7.2/§7.4, and
`specs/PHASE-B-LOG.md` (rulings honored, not re-litigated). Every op in the file was diffed
step-by-step. `python3 specs/check-streams.py <file>` → CLEAN.

Scope note used throughout: the tee read-request / read-into-request **chunk/close/error step
bodies and their "queue a microtask" wrappers** live in `JSReadRequest.cpp`
(`ReadRequestKind::{DefaultTee,ByteTee}` → `queueReactionJob(onDefaultTeeReadChunkMicrotask …)`,
JSReadRequest.cpp:117-120, 283-284); only the microtask *bodies* live in this file and are
reviewed here. `readableStreamDefaultReaderRead/Release`, `readableStreamBYOBReaderRead/Release`
live in `JSReadableStreamReaderBase.cpp`. `startPipeToOperation` (the pipe state machine) is
another file's.

---

### [MAJOR] ReadableStreamFromIterable step 2 — GetIterator(asyncIterable, async) rejects primitive iterables (strings)

Digest (02-readable-abstract-ops.md:113-115):

> ### ReadableStreamFromIterable(asyncIterable) → ReadableStream
> 2. Let iteratorRecord be ? GetIterator(asyncIterable, async).

ES `GetIterator(obj, ASYNC)` resolves `@@asyncIterator` / `@@iterator` via
`GetMethod(V, P)` → `GetV(V, P)`, which `ToObject`s primitives for the *lookup* but calls the
method with the original primitive as `this`. A primitive string is therefore a valid (sync)
iterable and `ReadableStream.from("ab")` must return a stream of `"a"`, `"b"`.

.cpp (ReadableStreamOperations.cpp:661-675):

```cpp
JSReadableStream* readableStreamFromIterable(JSGlobalObject* globalObject, JSValue asyncIterable)
{
    ...
    IterationRecord iteratorRecord = getAsyncIteratorExported(*globalObject, asyncIterable);
    RETURN_IF_EXCEPTION(scope, nullptr);
```

`getAsyncIteratorExported` → JSC `getAsyncIteratorImpl`
(oven-webkit IteratorOperations.cpp:308-317) begins with:

```cpp
auto* iterableObject = iterable.getObject();
if (!iterableObject) [[unlikely]] {
    throwTypeError(&globalObject, throwScope, "iterable should be an object"_s);
    return { };
}
```

i.e. the JSC helper imposes an **is-Object** requirement that `GetIterator` does not have.

**Observable divergence:** `ReadableStream.from("ab")` throws
`TypeError: iterable should be an object` instead of producing a two-chunk stream. This is
directly covered by WPT `streams/readable-streams/from.any.js` (the repo's vendored copy,
`test/js/third_party/wpt-streams/streams/readable-streams/from.any.js:21-24`):

```js
['a string', () => {
  // This iterates over the code points of the string.
  return 'ab';
}],
```

No caller pre-normalizes: `jsReadableStreamStaticFunction_from` (JSReadableStream.cpp:704-711)
passes `callFrame->argument(0)` straight through. All other non-object inputs (`null`,
`undefined`, numbers, `{}` with no `@@iterator`) still end in a `TypeError` on both paths, so
strings (and monkey-patched primitive prototypes) are the whole affected class.

**Minimal fix:** don't route through `getAsyncIteratorExported`'s object gate. Either (a) add a
local `GetIterator(async)` in this file that does the ES lookup with `JSValue::get(globalObject,
vm.propertyNames->asyncIteratorSymbol)` (GetV works on primitives) and, on the sync-fallback
path, `JSAsyncFromSyncIterator::create(...)` exactly as the JSC impl does — calling the iterator
method with the *original* `asyncIterable` as `this`; or (b) patch the vendored
`getAsyncIteratorImpl` to only reject `undefined`/`null` (matching `GetV`) rather than all
non-objects. Add the `from('ab')` WPT case to the streams test surface.

---

### [MINOR] ReadableStreamPipeTo — the Bun byte-source guard is evaluated on the pre-materialization controller kind

`BUN-LAYER-DESIGN.md` §7.4 mandates the byte-source rejection as the FIRST step (ruled, not
re-litigated); §7.2 mandates `readableStreamTee` runs `materializeIfNeeded` first. The file
implements both literally, which leaves the two ops inspecting `m_controllerKind` on opposite
sides of materialization:

ReadableStreamOperations.cpp:1208-1210 (pipeTo — check, then materialize):

```cpp
    if (source->m_controllerKind == ControllerKind::Byte)
        RELEASE_AND_RETURN(scope, promiseRejectedWith(globalObject, jsString(vm, WTF::String("Piping to a readable bytestream is not supported"_s))));
    source->materializeIfNeeded(globalObject);
```

ReadableStreamOperations.cpp:1192-1195 (tee — materialize, then check):

```cpp
    stream->materializeIfNeeded(globalObject);
    RETURN_IF_EXCEPTION(scope, failure);
    if (stream->m_controllerKind == ControllerKind::Byte)
        RELEASE_AND_RETURN(scope, readableByteStreamTee(globalObject, stream));
```

**Divergence (latent only):** an unmaterialized native stream has `ControllerKind::None`, so the
pipeTo guard is decided before the real kind exists. Today this is unobservable — per
BUN-LAYER-DESIGN §2 a native lazy source always materializes into a *Default* controller, never
Byte — so I am NOT crediting this as a behavior bug. It is recorded because the guard is
semantically about the *materialized* controller: if a byte-materializing native source is ever
added, `pipeTo` silently stops enforcing §7.4 while `tee` keeps enforcing its byte dispatch.

**Minimal fix:** move `source->materializeIfNeeded(globalObject)` above the
`ControllerKind::Byte` guard (guard stays the first *observable* step: materialization of a
native source runs no user JS), or add a one-line comment stating the None→Byte impossibility
the current order relies on.

---

### [MINOR] SetUpReadableStreamDefaultController step 9 — `startResult` is a caller-supplied parameter, hoisting the startAlgorithm before steps 1–8 for any non-trivial caller

Digest (02-readable-abstract-ops.md:844-856):

> 8. Set stream.[[controller]] to controller.
> 9. Let startResult be the result of performing startAlgorithm. (This might throw an exception.)

.cpp (ReadableStreamOperations.cpp:515-522):

```cpp
void setUpReadableStreamDefaultController(JSGlobalObject* globalObject, JSReadableStream* stream, JSReadableStreamDefaultController* controller, JSValue startResult, double highWaterMark)
{
    ...
    installDefaultController(globalObject, stream, controller, highWaterMark);   // steps 1-8
    RELEASE_AND_RETURN(scope, reactToStartResult(globalObject, startResult, ...)); // steps 10-12
```

The API shape forces every caller to have already *evaluated* startAlgorithm (step 9) before
steps 1–8 run. I verified **every current caller is safe**: `createReadableStream` is only ever
handed `jsUndefined()` (tee branches, from-iterable, `WebStreamsExports.cpp:189/200/211`) or the
Transform start *promise object* (`TransformStreamOperations.cpp:134` — computed, not user code),
and the two user-code paths (`setUpReadableStream{DefaultController,ByteStreamController}FromUnderlyingSource`,
lines 543-551 / 609-617) correctly call `dict.start` AFTER `installDefaultController` /
`installByteController`, i.e. at exactly the digest's step 9/14, with the controller argument and
`this = underlyingSource`. So there is **no observable divergence today**; this is a
step-ordering hazard baked into a signature, recorded so the next caller with a real
startAlgorithm doesn't run it before the stream↔controller wiring.

**Minimal fix:** none required; a one-line comment on `setUpReadableStreamDefaultController`
("startResult must be the result of a startAlgorithm that runs no user code, or must be computed
after the controller is installed — see the FromUnderlyingSource twin") is enough.

---

## Ops verified clean

Each op below was compared step-by-step against its digest entry; no divergence found beyond the
findings above. Line numbers are the op's definition.

**Working with readable streams**
- `initializeReadableStream` (136) — steps 1-3 exact.
- `isReadableStreamLocked` (145) — spec + the two Bun lock widenings (ruled, PHASE-B-LOG).
- `readableStreamHasDefaultReader` / `HasBYOBReader` / `GetNumReadRequests` / `GetNumReadIntoRequests` (151-176).
- `readableStreamAddReadRequest` (179) / `AddReadIntoRequest` (189) — incl. the
  readable-or-closed assert on the BYOB variant.
- `readableStreamFulfillReadRequest` (199) / `FulfillReadIntoRequest` (216) — take-first + done
  → close/chunk dispatch.
- `readableStreamClose` (233) — state, closedPromise resolve, default-reader-only drain of
  readRequests via detach-then-iterate; BYOB early-return.
- `readableStreamError` (263) — state, storedError, closedPromise reject **then**
  markAsHandled, then the reader-kind ErrorRead(Into)Requests dispatch (steps 6→7→8/9 order exact).
- `readableStreamCancel` (282) — disturbed → closed/errored early returns → **Close BEFORE the
  cancel algorithm** → BYOB readIntoRequests drained with `closeSteps(undefined)` → total
  ControllerKind switch for `[[CancelSteps]]` → the derived promise's fulfillment mapped to
  `undefined` via `onReturnUndefined` with rejection pass-through (step 8 exact).
- `readableStreamTee` (1187) — force-materialize first (§7.2), then the byte/default split.
- `readableStreamPipeTo` (1201) — §7.4 string-reason byte guard, lock asserts, reader→writer
  acquisition order, `disturbed` at step 11's position, op-cell population + both
  `m_pipeOperation` back-edges, promise created before `startPipeToOperation`.

**readableStreamDefaultTee (907) + its algorithms — the hard target, all clean**
- Entry (steps 3-20): acquire, tee-state init (`shouldClone`, fresh cancelPromise), branch1 then
  branch2 via `createReadableStream(..., HWM default = 1, size default)`, closedPromise
  **rejection-only** reaction registered after both branches. No identity check — correct, the
  default tee never swaps readers.
- `defaultTeePullAlgorithm` (804): `reading` → `readAgain=true` + resolved-undefined;
  `reading=true` set BEFORE the read; single shared `readAgain` flag for both branches.
- chunk-steps microtask body (845): `readAgain=false` first; clone gated on
  `!canceled2 && shouldClone` **only for branch2's chunk** (branch1 always gets the original);
  clone failure → error branch1, error branch2, `resolve(cancelPromise, Cancel(source, thrown))`,
  return (reading intentionally left true, as the spec's early Return does); `canceled1`/`canceled2`
  re-read LIVE at each of steps 3/4/5 (spec-exact — contrast the read-into microtask, which
  correctly *snapshots*); `reading=false` then the `readAgain` re-pull.
- `defaultTeeCancelAlgorithm` (821): per-branch canceled/reason set first, composite
  `[reason1, reason2]` order fixed regardless of which branch cancels last, cancelPromise
  resolved with the cancel result, cancelPromise returned.
- `defaultTeeReaderClosedRejected` (891): error both branches, `!c1 || !c2` → resolve
  cancelPromise with undefined.

**readableByteStreamTee (1154) + its algorithms — all clean**
- Entry (steps 3-25): default reader, branches via `createReadableByteStream`
  (HWM 0, no autoAllocate — spec step 4 exact), `forwardReaderError(reader)` LAST.
- `byteTeeForwardReaderError` (940) + `byteTeeReaderClosedRejected` (1135): the per-registration
  **identity check** (`context[1] != teeState->m_reader`) is present and compares against the
  *current* reader at rejection time — exactly step 14.1.1.
- `byteTeePullWithDefaultReader` (949): BYOB→default release/reacquire dance in the spec's exact
  order (assert-empty, release, acquire, set, forwardReaderError) before the read.
- `byteTeePullWithBYOBReader` (972): the mirror default→BYOB dance; read-into request context =
  `InternalFieldTuple{teeState, jsBoolean(forBranch2)}` (the PHASE-B-LOG-ratified contract);
  `readableStreamBYOBReaderRead(reader, view, /*min*/1, request)`. Correctly adds NO
  byteLength/detached checks — those belong to the public `read(view)` method, not the internal op.
- `byteTeePullAlgorithm` (998): per-branch `readAgainForBranchN`, `reading=true`,
  `GetBYOBRequest(branchN)` null→default / else BYOB with `byobRequest.[[view]]` and
  `forBranch2 = (branch==1)`.
- `byteTeeChunkStepsMicrotask` (1028): both readAgain flags reset; clone only when *neither*
  branch canceled; identical error/cancel unwind; `readAgain1 else-if readAgain2` re-pull.
- `byteTeeReadIntoChunkStepsMicrotask` (1078): byob/other branch+canceled computed as
  **snapshots** at microtask start (spec's `Let` bindings, steps 3-4 — the deliberate asymmetry
  with the live-read default/byte chunk steps is reproduced correctly); clone→respondWithNewView
  (byob, original)→enqueue(other, clone) order; the otherCanceled-true / byobCanceled-false arm.
- `byteTeeCancelAlgorithm` (1022) — spec steps 19/20 are byte-identical to the default tee's; the
  delegation is correct.

**Readers**
- `readableStreamReaderGenericInitialize` (354): stream↔reader wiring first, then the 3-state
  closedPromise setup with `markPromiseAsHandled` on the errored arm ONLY.
- `readableStreamReaderGenericCancel` (436).
- `readableStreamReaderGenericRelease` (381): MODERN semantics — readable → reject the existing
  closedPromise with a fresh TypeError, otherwise replace it with a new rejected one; then
  markAsHandled; then the **total** ControllerKind `[[ReleaseSteps]]` dispatch incl. the
  Direct/NativeSink/None no-op arms mandated by PHASE-B-LOG (+ the Bun `updateRef(false)`
  native-handle unref on the Default/Native arm); then `stream.[[reader]]`/`reader.[[stream]]`
  cleared last. (The "error pending reads with a fresh TypeError" wrapper step is
  `readableStream{Default,BYOB}ReaderRelease` — another file.)
- `setUpReadableStreamDefaultReader` (444) / `setUpReadableStreamBYOBReader` (456) — locked check
  before the byte-controller check (order observable, correct).
- `acquireReadableStreamDefaultReader` (472) / `acquireReadableStreamBYOBReader` (484).

**Controllers / construction**
- `installDefaultController` + `setUpReadableStreamDefaultController` (497/515) — steps 1-8
  wiring before the start reaction; steps 10-12 via `reactToStartResult` (the non-object fast
  path is a faithful one-microtask equivalent of "a promise resolved with startResult"; the
  object path preserves the observable `then` lookup / thenable adoption / rejection→
  `ControllerError`).
- `setUpReadableStreamDefaultControllerFromUnderlyingSource` (524) — algorithms from the dict,
  `start` invoked with `this = underlyingSource` and `« controller »` **after** the
  stream↔controller wiring (digest step 8 → 9 exactly); a sync throw from `start` propagates out
  (spec `?`), it is NOT converted to a rejected promise (that WebIDL conversion applies to the
  Promise-returning `pull`/`cancel`, which are invoked elsewhere — ruled in PHASE-B-LOG).
- `installByteController` + `setUpReadableByteStreamController` (556/579) — digest steps 1-13
  incl. byobRequest null, pendingPullIntos cleared, positive autoAllocate assert.
- `setUpReadableByteStreamControllerFromUnderlyingSource` (588) — the `autoAllocateChunkSize == 0`
  TypeError thrown BEFORE the controller is installed and BEFORE `start` runs (step 9 < step 10).
- `createReadableStream` (622) — HWM default 1, size default (declared defaults verified in
  WebStreamsInternals.h:167).
- `createReadableByteStream` (643) — HWM 0, no autoAllocate.

**From-iterable (other than the MAJOR above)**
- `fromIterablePullAlgorithm` (678): cached `nextMethod` used; `IteratorNext` abrupt (incl. the
  non-object-result TypeError, which JSC's `iteratorNext` performs) → rejected promise;
  nextPromise = resolved-with; the fulfillment handler is a separate reaction.
- `fromIterablePullFulfilled` (757): not-Object TypeError, `IteratorComplete`, done→ControllerClose,
  else `IteratorValue`→ControllerEnqueue.
- `fromIterableCancelAlgorithm` (706): fresh `GetMethod(iterator,"return")` semantics —
  undefined/null → resolved-undefined checked BEFORE callability; get-abrupt / not-callable
  TypeError / call-abrupt each → *rejected promise*; returnPromise reaction.
- `fromIterableCancelFulfilled` (778): not-Object TypeError, else undefined.
- `structuredCloneChunk` (789) — the §7.2-ratified `$structuredCloneForStream` private static.

---

## Verdict

Over the 38 stream-level abstract ops (50 functions) this file is a high-fidelity, step-numbered
transcription of the digest: both tee algorithms — including the live-vs-snapshot canceled-flag
asymmetry, the clone-failure unwind, the forwardReaderError identity check, and the byte tee's
reader release/reacquire dance — the three readerGeneric ops, cancel/close/error ordering, and
both FromUnderlyingSource setups are all step-exact.
One real functional divergence was found: `ReadableStreamFromIterable` step 2 uses a JSC
`GetIterator` helper that rejects primitive iterables, so `ReadableStream.from("ab")` throws a
TypeError instead of streaming code points (a WPT `from.any.js` case) — that is a MAJOR and the
only observable spec break; the two MINORs are latent ordering/shape notes with no
reachable-today divergence.
