# JSStreamPipeToOperation.cpp — Lens A: SPEC-STEP FIDELITY

Reviewed: `src/jsc/bindings/webcore/streams/JSStreamPipeToOperation.cpp` (502 lines) + `JSStreamPipeToOperation.h`
Ground truth: `specs/digest/02-readable-abstract-ops.md` L147–261 (`### ReadableStreamPipeTo`), `specs/ARCHITECTURE.md` §5.1/§6.1, `specs/PHASE-B-LOG.md` (pb-pipeto).
`check-streams.py`: CLEAN. Entry-op steps 1–13 (asserts, reader/writer acquisition, `[[disturbed]]`, promise creation, byte-source policy) live in `ReadableStreamOperations.cpp::readableStreamPipeTo` and are NOT double-counted here.

---

### [MAJOR] Signal abort algorithm: `AbortBoth` is sequential (abort dest, THEN cancel source) — the digest requires both actions STARTED and waited for together. **RULING: CONFIRMED.**

Digest, step 14.1 (L164–174) — the abort algorithm builds an ordered SET of actions and then:

> 3. If preventAbort is false, **append** the following action to actions: 1. If dest.[[state]] is "writable", return ! WritableStreamAbort(dest, error). ...
> 4. If preventCancel is false, **append** the following action to actions: 1. If source.[[state]] is "readable", return ! ReadableStreamCancel(source, error). ...
> 5. Shutdown with an action consisting of **getting a promise to wait for all of the actions in actions**, and with error.

"Getting a promise to wait for all" (WebIDL *wait for all*) obtains ALL the actions' promises first — i.e. it **invokes every action** — and then reacts to the aggregate. The reference implementation is `waitForAllPromise(actions.map(action => action()))`: `WritableStreamAbort(dest, …)` and `ReadableStreamCancel(source, …)` are both invoked back-to-back in the same tick.

The code instead chains them (following the frozen header's `AbortBoth, // ... abort dest THEN cancel source` comment):

- `performPipeShutdownAction`, L150–158: `AbortBoth` performs ONLY `writableStreamAbort(...)` and registers `onShutdownActionFulfilled/Rejected` on that single promise.
- `onShutdownActionFulfilled`, L340–343: only **upon fulfillment** of the dest-abort promise does it enter `performPipeAbortBothCancelPhase` (L167–182), which then calls `readableStreamCancel`.
- `onShutdownActionRejected`, L347–355: does NOT check `AbortBoth`; it records `newError` and calls `finalize` immediately.

Concrete observable divergences (all with `preventAbort === false && preventCancel === false`, dest writable, source readable, signal aborted):

1. **A rejecting dest-abort suppresses the source-cancel entirely.** If the sink's `abort()` returns a rejected promise, per spec `source`'s underlying `cancel()` has ALREADY been invoked (both actions were started before the wait). In the code, `onShutdownActionRejected` finalizes without ever calling `readableStreamCancel` → the source's `cancelAlgorithm` is **never invoked**, the source is never closed/cleaned up, and only the reader lock is dropped by finalize.
2. **A never-settling dest-abort starves the source-cancel forever.** If `sink.abort()` returns a forever-pending promise, per spec `source.cancel()` still ran (and its resources are released); in the code it never runs.
3. Even on success, the source's `cancelAlgorithm` runs one-or-more microtask turns later than every other engine (after the dest abort-request promise fulfills) instead of in the same tick as the sink `abort()` call.

Minimal fix: on `AbortBoth`, evaluate BOTH per-action state guards up front, invoke `writableStreamAbort` and `readableStreamCancel` back-to-back (each falling back to a resolved promise per digest 14.1.3.2 / 14.1.4.2), and set `m_shutdownActionPromise` to an aggregate that fulfills when both fulfill and rejects with the FIRST rejection (a 2-element wait-for-all; e.g. an internal `JSPromise` + a small counter/first-error pair on the op cell, or `JSPromise::all`-equivalent internal machinery). `onShutdownActionFulfilled/Rejected` then finalize directly — the `AbortBoth` special-case in `onShutdownActionFulfilled` and `performPipeAbortBothCancelPhase` are deleted. (Note the digest's order is abort-dest then cancel-source, which the fix preserves; only the *gating* of the second on the first's settlement is wrong.)

Severity per the pre-made ruling: MAJOR (both underlying callbacks must be invoked; a rejecting dest-abort must not suppress the source-cancel).

---

### [MAJOR] Shutdown actions and finalize run SYNCHRONOUSLY inside the `pipeTo()` job when an entry-time condition holds and no write is pending — digest step 15 is "In parallel"

Digest L177: "**In parallel**, using reader and writer, read all chunks from source and write them to dest." The four propagation conditions, both shutdown forms, and finalize are all sub-procedures of that in-parallel step; none of their author-observable effects may interleave with the job that called `pipeTo()`.

`startPipeToOperation` (L452–459) runs the four checks synchronously inside `readableStreamPipeTo` (which is itself synchronous — `ReadableStreamOperations.cpp:1235`). When a condition already holds, `shutdownWithAction` L246–250 takes the `dest writable && !closeQueuedOrInFlight` branch and calls `onWritesFinishedForShutdown` **directly**; with no `m_currentWrite` (L328) that falls through to `performPipeShutdownAction` **in the same C++ frame** — i.e. the shutdown ACTION (a user algorithm) and, on the no-action path, `finalize` (reader/writer release) execute before `pipeTo()` returns.

The digest's own shutdown step 3.2 ("Wait until every chunk that has been read has been written") is what the reference implementation uses to guarantee the deferral in exactly this branch: `uponFulfillment(waitForWritesToFinish(), doTheRest)` is ALWAYS a promise reaction even when zero chunks have been read (`currentWrite` starts as a resolved promise). The code short-circuits it.

Concrete observable divergences (dest already started + `writable`, source already errored — a completely ordinary `rs.pipeTo(ws)` where `rs` errored in `start`):
- `preventAbort:false` → `writableStreamAbort(dest, e)` runs synchronously → the author's `sink.abort(e)` callback is invoked **before `pipeTo()` returns**. Per spec/reference it runs in a later microtask, after the caller has the pipe promise.
- `preventAbort:true` → plain shutdown → `finalize()` runs synchronously → the reader and writer are released **before `pipeTo()` returns**, so `rs.locked === false && ws.locked === false` on the very next statement after `rs.pipeTo(ws, {preventAbort:true})`. Per spec both MUST read `true` there (steps 8–10 acquired them; the in-parallel finalize cannot have run yet). This one is observable through the *public* API with no recording sink at all.
- The signal-already-aborted entry path (L433–436) has the same shape: `onSignalAbort` → sync `writableStreamAbort` → `sink.abort()` inside the `pipeTo()` call.

(Scoped deliberately: in the `dest NOT writable` branch the reference implementation ALSO performs the action / finalize synchronously, so no divergence is claimed there.)

Minimal fix: in `shutdownWithAction`'s `dest writable && !closeQueuedOrInFlight` branch, ALWAYS go through a promise reaction — i.e. `onWritesFinishedForShutdown` should register the `onPipeWritesFinishedForShutdown` reaction on `m_currentWrite` unconditionally (introducing an always-present `m_currentWrite`, initialized to a resolved internal promise, exactly like the reference's `currentWrite`), or, equivalently, register the settle-check reaction even when `m_currentWrite` is null by reacting to a pre-resolved promise. One deferral in that one branch restores both observables.

---

### [MINOR] `finalize` performs its unconditional obligations AFTER a fallible early-return

Digest L247–255: finalize's six steps are all `!` (infallible) and must all happen — release writer, release reader, **remove abortAlgorithm from signal**, settle `promise`. `specs/ARCHITECTURE.md` §6.1 additionally: "MUST remove it in 'finalize' **on every terminal path**" and the back-edge clears are part of finalize.

L264–276 sets `m_finalized = true`, then calls the two releases and does `RETURN_IF_EXCEPTION(scope, )` at L269 — **before** clearing the two `m_pipeOperation` back-edges, before `removeAbortAlgorithmFromSignal`, and before settling `m_promise`. If either release throws (they allocate TypeErrors; OOM/termination), the pipe is marked finalized but: the returned promise is never settled (permanent hang for the caller), the abort algorithm stays registered on a possibly long-lived signal (the exact leak §6.1 calls out), and the back-edges keep the whole graph alive. Exception-path-only (borderline §7), but finalize is the one method the architecture doc says must complete its obligations on every terminal path.

Minimal fix: clear the back-edges, remove the abort algorithm, and capture the promise/error *before* the two release calls (or after them without an intervening early return); keep the single `RETURN_IF_EXCEPTION` only ahead of the final settle, which is last anyway.

---

## Verified clean

Everything else in the digest's prose was diffed line-by-line and matches; calling these out explicitly since the instruction is "compare harder":

- **Entry / already-aborted signal (14.2, 14.3):** aborted-at-entry performs the abort algorithm and returns without adding the algorithm, registering the closed observers, or starting the loop (L431–437) — exactly steps 14.2 then "return promise". The abort algorithm is added (GC-visited `addAbortAlgorithmToSignal`) before step 15's checks; `m_abortAlgorithmId == 0` correctly encodes "never registered" for finalize. The abort reason is captured once (`signal.jsReason` / the algorithm's argument) and is the `originalError`.
- **Backpressure & the loop (L106–126, 465–483):** reads are gated on `writableStreamDefaultWriterGetDesiredSize` — `null` ⇒ no read (parked; the backward-error observer resumes), `≤ 0` ⇒ waits on the writer's `[[readyPromise]]` (which is pending iff desiredSize ≤ 0). Exactly one pending read (`m_readInFlight`); no reads once `m_shuttingDown`. A chunk is written via `writableStreamDefaultWriterWrite` with its promise tracked as `m_currentWrite` and **reacted to per-write** (ARCH §5.1); the next read is armed on `readyPromise` — never on write completion, so it does NOT serialize read→write→read (digest's "should not be delayed for reasons other than these backpressure signals" NOTE). Only abstract ops and direct internal-slot reads are used — the public API is never touched.
- **The four propagation conditions:** each is `is or becomes` — checked once at start (L452–458, in the digest's 1→4 order) and re-checked from live state on the reader/writer `[[closedPromise]]` reactions plus the read-request close/error steps. Forward errors: `WritableStreamAbort(dest, source.[[storedError]])` with `source.[[storedError]]` / else shutdown with it. Backward errors: `ReadableStreamCancel(source, dest.[[storedError]])` with it / else shutdown with it. Forward close: `WritableStreamDefaultWriterCloseWithErrorPropagation(writer)` with NO error / else plain shutdown with no error. Backward close: fresh TypeError; `ReadableStreamCancel(source, destClosed)` with it / else shutdown with it. All preventX gates match.
- **Shutdown latch & write-draining:** `m_shuttingDown` is set first and tested first in `shutdownWithAction` (both forms funnel through it), so the FIRST shutdown wins. The write-drain wait happens iff `dest.[[state]] == writable && !closeQueuedOrInFlight` (both forms), re-checks `m_currentWrite` across a late in-flight chunk, and waiting on the LAST write is sufficient (writes settle FIFO). The per-action `dest is writable` / `source is readable` guards of the signal path are evaluated at action-perform time, matching the spec's action closures.
- **Finalize (happy path):** exactly once (`m_finalized`), writer release then reader release (spec order), clears BOTH `m_pipeOperation` back-edges, removes the abort algorithm, rejects with the shutdown/newError iff one was given (with `m_hasShutdownError` correctly distinguishing "error is `undefined`" from "no error"), else resolves with undefined. `onShutdownActionRejected` replaces the original error with `newError` per shutdown-with-action step 6.

**Verdict:** The state machine is a faithful, well-latched transcription of the digest's loop, the four propagation conditions, both shutdown forms, and finalize — with **two MAJOR step divergences**: the signal `AbortBoth` action is sequentialized instead of started-together-and-waited-for (the pre-made ruling is CONFIRMED against digest L173–174 verbatim), and the shutdown action / finalize can execute synchronously inside the `pipeTo()` job in the one branch where the digest's write-drain wait (and step 15's "In parallel") mandates a deferral. Both fixes are local to `performPipeShutdownAction` / `onWritesFinishedForShutdown`; nothing structural.
