# Adversarial review — WritableStreamOperations.cpp — Lens B (exception/reentrancy + mechanism compliance)

Target: `src/jsc/bindings/webcore/streams/WritableStreamOperations.cpp` (561 LOC).
Law: `specs/ARCHITECTURE.md` §4.1, §7 (§7.1/§7.1a/§7.2/§7.4/§7.5/§7.6), `WebStreamsInternals.h` `// userJS:` annotations, `specs/digest/03-writable.md`.
`python3 specs/check-streams.py` → CLEAN (checker catches nothing here; findings below are model-level).

## The headline hazard — `writableStreamAbort`'s synchronous "signal abort" (lines 191–227): VERIFIED CLEAN

I attacked this hardest and could not break it. Documenting the proof so the next reviewer does not have to redo it:

- (a) **Pre-signal snapshot** matches the digest exactly: only `[[state]]` is read before the signal (L196). `controller`/`m_abortController` are read at L200–202 *solely* to perform the signal and are never touched again.
- (b) **Post-signal re-validation**: L205 re-loads `m_state` fresh (digest step 3 + the spec's only prose reentrancy note), L208 re-loads `m_pendingAbortRequest.promise` fresh. Nothing computed before L202 is reused after it except the immutable params `stream`/`reason`.
- (c) **No pointer into any deque or promise slot is held across the signal.** The only locals live across L202 are `stream` (a param, conservatively stack-rooted GC cell) and `reason` (a JSValue param).
- (d) **Reentrancy**: a listener that re-enters `stream.abort()` produces a nested `writableStreamAbort` whose `pendingAbortRequest` the outer frame then correctly returns at L208–209; a listener that errors the stream to `Errored` is caught by L206; a listener that only reaches `Erroring` falls into the `wasAlreadyErroring` arm at L213. All three match the digest. `AbortSignal::signalAbort` is idempotent (`if (aborted()) return`, AbortSignal.cpp:205) so a re-entrant signal cannot double-fire.
- `RETURN_IF_EXCEPTION` at L203 is defensive-only: listener exceptions are consumed by event dispatch (`AbortSignal::runAbortSteps` → `dispatchEvent` → reportException), so `WritableStream.prototype.abort`'s `!` (never-throws) contract holds.

The other three `userJS: yes` bodies in this file (`writableStreamFinishErroring`'s `[[AbortSteps]]` at L342, `setUpWritableStreamDefaultControllerFromUnderlyingSink`'s user `start()` at L518, `reactToWritableControllerStart`'s thenable lookup at L71) also hold nothing stale across the user-JS point; `writableStreamFinishErroring` detaches the abort request (L331–334) *before* invoking the user abort algorithm, exactly as the digest requires, and the state it flips to `Errored` at L312 makes the function non-re-entrant. §7.4/HEADER-REVIEW-3: **every** `resolvePromise`/`promiseResolvedWith` in this file except L71 resolves with `jsUndefined()`, so no hidden `Object.prototype.then` user-JS point exists. §7.5 `markAsHandled` sites (L162, L180, L184, L457) are exactly the digest's four — no missing, no extra. `[[writeRequests]]` is mutated only under `cellLock()` (L114, L262, L324, L436) and only *iterated* (never mutated) without it at L319, which the header's "mutated AND visited under cellLock" contract permits; `rejectPromise` runs no user JS (verified: `GlobalObject::promiseRejectionTracker` is pure C++ bookkeeping), so the L319 loop cannot be invalidated. No `clearException`, no `takeAbruptCompletion` (correct — the digest gives `start` exception behavior "rethrow", so §7.1a's startAlgorithm catch does NOT apply here), no `JSFunction::create`, no `JSNativeStdFunction`, no `Strong`/`protect`/`ensureStillAlive`.

---

### [MAJOR] `onWSAbortStepsFulfilled` / `onWSAbortStepsRejected` are not §4.1-fact-5 boundaries: they return with a pending exception into a fire-and-forget reaction

**Lines**: 533–545 (`RETURN_IF_EXCEPTION(scope, {})` at 541, 543) and 547–559 (at 555, 557).
**Rule**: ARCHITECTURE §4.1 fact 5 — "A reaction registered with `resultPromiseOrJSUndefined == jsUndefined()` that returns with a pending exception escapes as an uncaught error at the microtask level. Therefore every native reaction handler in this subsystem is a *boundary*: it must convert any internal failure into the spec action ... and never return with a pending exception. **Reviewers verify this per handler.**" Restated verbatim in `JSStreamsRuntime.h:16–18`.

Both handlers are registered at L347 with `resultPromiseOrJSUndefined == jsUndefined()` (fire-and-forget). Both bodies are `op(); RETURN_IF_EXCEPTION(scope, {}); op(); RETURN_IF_EXCEPTION(scope, {})` — i.e. on any throw they do the *opposite* of the rule: they return with the exception pending.

Concrete failure this shape allows: if the first call (`resolvePromise(abortRequestPromise, undefined)` at 540, or `rejectPromise` at 554) throws, (a) `writableStreamRejectCloseAndClosedPromiseIfNeeded` at 542/556 is skipped, so `writer.closed` and any `[[closeRequest]]` are **never settled** (permanently pending promises the spec guarantees are rejected here), and (b) an uncaught error surfaces at the microtask level that the spec never produces.

Honest scoping (do not overstate): I traced both callees — `resolvePromise`/`rejectPromise`/`markPromiseAsHandled` and the rejects inside `writableStreamRejectCloseAndClosedPromiseIfNeeded` cannot raise a JS exception except on forced VM termination, and §7.1a says a termination must propagate. So **today** the handlers only ever return a pending exception when propagation is the correct behavior. But fact 5 is deliberately a *black-box, per-handler* contract ("reviewers verify this per handler") precisely so correctness does not depend on a white-box audit of every transitive callee's throw set; the header itself declares both callees with the `JSGlobalObject*`+throw-scope contract. The compliance gap is structural: the moment either callee gains a real throw path, this silently becomes a hung `writer.closed` plus a spurious uncaught error. The identical shape exists in `onTSSink*`/`onRSByteController*` handlers, so the ruling should be applied subsystem-uniformly, not to this file alone.

**Minimal fix**: since fact 5 says the recovery must be "the spec action", and §7.1a says only a termination may pass through: replace each `RETURN_IF_EXCEPTION(scope, {})` after a step with a shape that (a) lets a termination propagate and (b) otherwise still performs the remaining digest steps — e.g. run steps 1 and 2 unconditionally, checking only for termination between them (`if (vm.hasPendingTerminationException()) return {};`), and put a one-line comment citing fact 5. If the team instead rules that "these callees are provably non-throwing modulo termination" is the accepted subsystem-wide argument, that ruling must be written into §4.1 fact 5 / `JSStreamsRuntime.h`, because as written the handlers fail the stated per-handler check.

---

### [MINOR] `reactToWritableControllerStart` hand-rolls a second, drifting copy of the §4.1-fact-6 microtask deferral instead of the subsystem's `[reaction-convention]` helper

**Lines**: 63–78, specifically 76–77.
**Rule**: §4.1 fact 6 (the sanctioned promise-elision mechanism) + §4.1's closing sentence "Phase-B authors may not add reaction sites or callables outside these two mechanisms"; ARCHITECTURE "one implementation, one mechanism" posture.

`ReadableStreamOperations.cpp:82–90` already defines the tagged `// [reaction-convention] deferral` for exactly this ("queueReactionJob": build the `BunPerformMicrotaskJob` `QueuedTask` carrying `(handler, asyncContext, value, context)`). This file re-implements it inline at L76 and has **already drifted** from it: every other producer of a `BunPerformMicrotaskJob` in the tree (`ReadableStreamOperations.cpp:86–87`, `ZigGlobalObject.cpp:1263`, `bindings.cpp:5712`) normalizes an empty async-context internal field to `jsUndefined()` before enqueuing; L76 passes `globalObject->m_asyncContextData.get()->getInternalField(0)` raw.

Honest scoping: I chased this to ground and it is **not a live bug** — `InternalFieldTuple::create` initializes field 0 to `jsUndefined()` and every writer stores a real JSValue, so the field is provably never empty and the three sibling guards are dead-defensive. That is exactly why this is MINOR (mechanism divergence), not MAJOR. But two independently-maintained encodings of one sanctioned mechanism inside one subsystem is how the next reviewer gets a *real* divergence.

**Minimal fix**: hoist `queueReactionJob` out of `ReadableStreamOperations.cpp` (it is currently `static`) into `WebStreamsInternals.h`, and make `reactToWritableControllerStart` call it. Delete L76–77.

---

### [MINOR] `onWSAbortSteps*` deviate from §4.1 fact 1's prescribed handler body: `uncheckedDowncast` with no null/type check on the context

**Lines**: 537–539 and 551–553.
**Rule**: §4.1 fact 1 — "A handler's entire body is `auto* c = dynamicDowncast<JSXxx>(callFrame->uncheckedArgument(1)); if (!c) return JSValue::encode(jsUndefined());` ...".

The two handlers here `uncheckedDowncast` the context tuple *and* both of its internal fields with no check. The byte-controller handlers (`JSReadableByteStreamController.cpp:434–436` etc.) follow the LAW's prescribed shape; the transform/tee/writable handlers do not — so the subsystem is split down the middle on §4.1's own canonical body.

Honest scoping: the context is not reachable from user JS (it is constructed at L346 by us and stored only on the `JSPromiseReaction`), and the shared handler `JSFunction`s on `JSStreamsRuntime` are never installed on a user-reachable object, so I could not construct a type-confusion. This is mechanism-shape non-compliance, not an exploitable bug. Whichever shape is intended, §4.1 fact 1 and half the subsystem currently disagree.

**Minimal fix**: either add the `dynamicDowncast` + `if (!context) return jsUndefined()` guard (matching fact 1 and the byte-controller handlers), or amend §4.1 fact 1 to bless `uncheckedDowncast` for tuple contexts and fix the byte-controller handlers to match — one canonical shape.

---

## Per-function table

| fn | throws-checked? (§7.1) | userJS-revalidated? (§7.2) | mechanisms-clean? (§4.1/§7.1a/§7.5/§7.6) |
|---|---|---|---|
| `clearPendingAbortRequest` (29) | n/a (no globalObject) | n/a | yes |
| `setUpWritableStreamDefaultControllerBeforeStart` (38) | yes (L53, L60) | n/a (no userJS) | yes |
| `reactToWritableControllerStart` (65) | yes (L72; `performPromiseThenWithContext`+`queueMicrotask` non-throwing) | yes (nothing cached across L71) | **duplicated fact-6 deferral (MINOR #2)**; otherwise the sanctioned `performPromiseThenWithContext` |
| `createWritableStream` (80) | yes (L98) | delegated | yes |
| `initializeWritableStream` (102) | n/a | n/a | yes (deque cleared under cellLock, L113) |
| `isWritableStreamLocked` (119) | n/a | n/a | yes |
| `acquireWritableStreamDefaultWriter` (124) | yes (L131) | n/a | yes |
| `setUpWritableStreamDefaultWriter` (135) | yes (all 5) | n/a (`userJS: no` holds — resolves only `undefined`, rejects never do a `then` lookup) | yes; §7.5 marks exact (L162,180,184) |
| `writableStreamAbort` (191) | yes (L203, L224) | **YES — the headline check passes** (see proof above) | yes |
| `writableStreamClose` (229) | yes (L246, L249) | yes (nothing cached across L248) | yes |
| `writableStreamAddWriteRequest` (254) | non-throwing leaf, commented (L253) per §7.1 | n/a | yes (append under cellLock L261) |
| `writableStreamCloseQueuedOrInFlight` (267) | n/a | n/a | yes |
| `writableStreamDealWithRejection` (272) | yes (L278, L282) | delegated | yes |
| `writableStreamStartErroring` (285) | yes (L299, L302) | yes (`controller` held only across `userJS: no` calls) | yes |
| `writableStreamFinishErroring` (305) | yes (L321, L338, L343) | yes (abort request detached BEFORE `abortSteps`; nothing stale used after L342) | yes — the reaction is the sanctioned mechanism with an `InternalFieldTuple` (fact 4) |
| `writableStreamFinishInFlightWrite` (350) | yes (L356) | n/a | yes |
| `writableStreamFinishInFlightWriteWithError` (360) | yes (L366, L369) | n/a (reject ≠ userJS) | yes |
| `writableStreamFinishInFlightClose` (372) | yes (L378, L387, L394) | n/a (all resolves `undefined`); state re-read at L381 per digest order | yes |
| `writableStreamFinishInFlightCloseWithError` (400) | yes (L406, L411, L414) | n/a | yes |
| `writableStreamHasOperationMarkedInFlight` (417) | n/a | n/a | yes |
| `writableStreamMarkCloseRequestInFlight` (422) | n/a | n/a | yes |
| `writableStreamMarkFirstWriteRequestInFlight` (430) | n/a | n/a | yes (takeFirst under cellLock L436) |
| `writableStreamRejectCloseAndClosedPromiseIfNeeded` (442) | yes (L451, L456) | n/a | yes; §7.5 exact (L457) |
| `writableStreamUpdateBackpressure` (461) | yes (L473) | n/a | yes |
| `setUpWritableStreamDefaultController` (479) | yes (L484, L485) | delegated | yes |
| `setUpWritableStreamDefaultControllerFromUnderlyingSink` (488) | yes (L509, L519, L521) | yes (nothing cached across the user `start()` at L518) | yes — no `takeAbruptCompletion` and correctly so (digest: `start` is "rethrow") |
| `jsWebStreamsHandler_onWSAbortStepsFulfilled` (533) | RIE present | n/a | **NO — not a fact-5 boundary (MAJOR); fact-1 body shape (MINOR #3)** |
| `jsWebStreamsHandler_onWSAbortStepsRejected` (547) | RIE present | n/a | **NO — same two** |

## Verdict

The file's defining hazard — user `abort` listeners running synchronously inside `writableStreamAbort` — is handled correctly and provably: state and the pending-abort slot are re-loaded from members after the signal, and nothing else survives across it; every other `userJS: yes` site, the `[[writeRequests]]` cellLock contract, `markAsHandled` placement, and the §7.6 bans are all clean, and there is exactly one reaction mechanism in use.
The real defect is at the mechanism layer, not the reentrancy layer: the two reaction handlers this file owns are registered fire-and-forget yet are written as `RETURN_IF_EXCEPTION` bail-outs, which is the literal negation of §4.1 fact 5's per-handler boundary contract (MAJOR — today reachable only via VM termination, but structurally wrong and it leaves `writer.closed` unsettled on the bail path); two MINORs cover a duplicated fact-6 deferral and the fact-1 handler-body shape split.
Recommendation: fix or formally re-rule fact 5 subsystem-wide (this file is not the only offender), hoist `queueReactionJob`, and pick one handler-body shape; the abstract-op bodies themselves need no change.
