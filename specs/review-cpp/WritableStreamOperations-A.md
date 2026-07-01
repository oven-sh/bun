# Lens A — Spec-step fidelity: `WritableStreamOperations.cpp` vs `specs/digest/03-writable.md`

Method: every numbered digest step for every op implemented in this file was placed
side-by-side with the C++ and diffed for skipped / reordered / paraphrased steps,
inverted conditions, wrong slots, resolve-vs-reject, and missing `markPromiseAsHandled`.
`python3 specs/check-streams.py` reports CLEAN. Findings below are the only deviations
found; everything else is enumerated under "Ops verified clean".

---

### [MINOR] CreateWritableStream — step 5 (startAlgorithm) evaluated before steps 3–4

Digest (`### CreateWritableStream…` + `### SetUpWritableStreamDefaultController` step 15):

> 3. Perform ! InitializeWritableStream(stream).
> 5. Perform ? SetUpWritableStreamDefaultController(stream, controller, startAlgorithm, …)
>    … 14. Perform ! WritableStreamUpdateBackpressure(stream, backpressure).
>    15. Let startResult be the result of performing startAlgorithm. (This may throw an exception.)

`.cpp` 80–99:

```cpp
JSWritableStream* createWritableStream(JSGlobalObject* globalObject, SinkKind kind,
    JSCell* algorithmContext, JSValue startResult, double highWaterMark, JSObject* sizeAlgorithm)
{
    ...
    initializeWritableStream(stream);
    ...
    setUpWritableStreamDefaultController(globalObject, stream, controller, startResult, highWaterMark);
```

`startResult` is a **parameter**, so by construction every caller must have already run
the start algorithm before `InitializeWritableStream` / `SetUpWritableStreamDefaultController`
steps 1–14 execute — the spec runs it *after* step 14 (after the controller is wired and
backpressure updated). This is a structural reordering of spec step 15 baked into the
signature.

Observability today: none. The sole caller (`TransformStreamOperations.cpp:130`) passes the
Transform machinery's pre-existing `startPromise`, which is exactly the spec's
"an algorithm that returns startPromise" — an inert value, order-independent. The JS-sink
path (`setUpWritableStreamDefaultControllerFromUnderlyingSink`, lines 508–521) does it in the
correct order: `setUpWritableStreamDefaultControllerBeforeStart` (steps 1–14) **then** the
user `start()` call. So this only bites a *future* native caller whose start algorithm has
side effects.

Minimal fix (optional / hardening): none needed for current callers; either document the
"startResult must be side-effect-free / precomputable" contract on `createWritableStream`,
or take a start thunk instead of a value.

---

## Ops verified clean

Each op below was checked step-by-step against its `###` section in the digest; the
notes call out the specific traps that were verified, not just skimmed.

- **InitializeWritableStream** (102) — all slots cleared, `[[writeRequests]]` emptied, `[[backpressure]] = false`. Exact.
- **IsWritableStreamLocked** (119), **WritableStreamCloseQueuedOrInFlight** (267 — `closeRequest || inFlightCloseRequest`), **WritableStreamHasOperationMarkedInFlight** (417 — `inFlightWriteRequest || inFlightCloseRequest`). The two predicates are correctly *different* (`closeRequest` vs `inFlightWriteRequest`).
- **AcquireWritableStreamDefaultWriter** (124) — new writer + `?` SetUp; nullptr on throw.
- **SetUpWritableStreamDefaultWriter** (135) — locked ⇒ TypeError before any mutation; all four state branches exact, including the `!closeQueuedOrInFlight && backpressure ⇒ NEW readyPromise` condition (steps 4.1–4.2, not inverted), the fresh pending `closedPromise` in "writable"/"erroring", and the `markPromiseAsHandled` on ready (erroring), ready+closed (errored).
- **WritableStreamAbort** (191) — state check → signal abort → **re-snapshot** state (digest step 3 places the snapshot *after* signaling, and so does line 205) → re-check closed/errored (step 4) → return existing `pendingAbortRequest` promise (step 5) → assert → `wasAlreadyErroring` / `reason = undefined` → record set → `StartErroring` only if `!wasAlreadyErroring` → return promise. Exact, including the step-5-after-step-4 ordering.
  (`AbortController::abort(global, undefined)` maps a missing reason to an `AbortError` DOMException — matches WPT `aborting.any.js:1411`.)
- **WritableStreamClose** (229) — closed/errored ⇒ **rejected** TypeError; asserts; `closeRequest` (not `inFlightCloseRequest`) set to the new promise; readyPromise resolved only under `writer && backpressure && state == writable`; ControllerClose; return. Exact.
- **WritableStreamAddWriteRequest** (254), **MarkCloseRequestInFlight** (422), **MarkFirstWriteRequestInFlight** (430) — exact, including the closeRequest→inFlightCloseRequest move + clear.
- **WritableStreamDealWithRejection** (272) — writable ⇒ StartErroring + return; else assert erroring ⇒ FinishErroring. Exact.
- **WritableStreamStartErroring** (285) — asserts (`!storedError`, writable, controller); state ⇒ erroring; storedError ⇒ reason; `EnsureReadyPromiseRejected` on the writer; `!HasOperationMarkedInFlight && controller.[[started]]` ⇒ FinishErroring. Exact, condition not inverted.
- **WritableStreamFinishErroring** (305) — the subtlest op, exact:
  - state ⇒ errored **before** `[[ErrorSteps]]`; `storedError` read after (steps 3–5).
  - all writeRequests rejected with storedError then list cleared.
  - no pendingAbortRequest ⇒ RejectCloseAndClosedPromiseIfNeeded + return.
  - **detach-before-use** (steps 10–11): promise/reason/wasAlreadyErroring copied to locals at 331–333, `clearPendingAbortRequest` at 334, *before* the wasAlreadyErroring branch and before `[[AbortSteps]]` — exactly the digest's ordering.
  - `wasAlreadyErroring` ⇒ abort promise rejected with **storedError** (not the abort reason) — the classic trap, correct at line 337.
  - reactions registered on the `[[AbortSteps]]` result with an `InternalFieldTuple{field0 = detached abortRequest promise, field1 = stream}`.
- **onWSAbortStepsFulfilled / onWSAbortStepsRejected** (533 / 547) — bodies exactly match the digest's "Upon fulfillment/rejection of promise" sub-steps: resolve(field0, undefined) / reject(field0, argument(0)) then `RejectCloseAndClosedPromiseIfNeeded(field1)`. Field indices match the registration site (`InternalFieldTuple::create(vm, structure, abortPromise, stream)` at 346). They settle the *detached* abort promise, never `stream->m_pendingAbortRequest`.
- **WritableStreamFinishInFlightWrite** (350) / **…WithError** (360) — resolve/reject `inFlightWriteRequest`, clear, assert state, and the error variant goes to **DealWithRejection** (not StartErroring) and does **not** touch `pendingAbortRequest`. Exact — the write/close asymmetry is preserved.
- **WritableStreamFinishInFlightClose** (372) — resolve, clear, snapshot state, erroring ⇒ clear storedError then resolve+clear pendingAbortRequest, state ⇒ closed, resolve writer.closedPromise, trailing asserts. Exact step order.
- **WritableStreamFinishInFlightCloseWithError** (400) — reject inFlightCloseRequest with `error`, clear, reject pendingAbortRequest with `error` (not storedError) + clear, then **DealWithRejection**. Exact.
- **WritableStreamRejectCloseAndClosedPromiseIfNeeded** (442) — assert errored; closeRequest ⇒ (assert `!inFlightCloseRequest`) reject with storedError + clear; writer ⇒ reject closedPromise with storedError then `markPromiseAsHandled`. Exact, reject-then-mark order matches the digest.
- **WritableStreamUpdateBackpressure** (461) — both asserts; readyPromise **replaced** with a new pending promise only when `writer && backpressure != stream.[[backpressure]] && backpressure`, resolved otherwise; `[[backpressure]]` always written last. Exact.
- **SetUpWritableStreamDefaultController** (479 / `…BeforeStart` 38) — steps 1–14 in digest order (assert-no-controller, stream↔controller wiring, ResetQueue, AbortController, started=false, HWM, GetBackpressure→UpdateBackpressure), then the start reaction. `reactToWritableControllerStart` (65) is a faithful "promise resolved with startResult" (only the observably-inert primitive case bypasses promise creation; objects go through `promiseResolvedWith`, preserving the `then` lookup).
- **SetUpWritableStreamDefaultControllerFromUnderlyingSink** (488) — algorithms captured from the dict, steps 1–14 run *before* the user `start()` is invoked with `this = underlyingSink`, exception behavior "rethrow" (`RETURN_IF_EXCEPTION` at 519), then the start reaction. Exact.

**`markPromiseAsHandled` audit:** the digest requires exactly 4 `[[PromiseIsHandled]] = true`
sites among this file's ops — SetUpWritableStreamDefaultWriter "erroring" (ready),
"errored" (ready + closed), and RejectCloseAndClosedPromiseIfNeeded (closed). The file has
exactly those 4, at lines 162, 180, 184, 457. None missing, none extra.

## Verdict

Clean modulo one MINOR structural note. Every numbered step of every op the file implements
is present, in digest order, with the correct slot, polarity, and resolve/reject direction;
the erroring hand-off (detach-before-use, wasAlreadyErroring→storedError, the
DealWithRejection-vs-StartErroring split, the 4 `markPromiseAsHandled` sites, and the
`[[AbortSteps]]` reaction context fields) is a faithful transcription. No CRITICAL or MAJOR
spec-step deviations found.
