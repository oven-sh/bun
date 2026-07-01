# Phase-B log — every implementer's report and the maintainer ruling on it

Purpose: a Phase-B author that hits a boundary STOPS and reports instead of improvising.
Every such report lands here with a ruling, so nothing is lost and the Phase-C integrator
has a complete punch list. Also records cross-cutting facts discovered mid-wave.

## Cross-cutting facts (broadcast to every wave-1 agent)

1. **This JSC fork has no `jsCast`/`jsDynamicCast`** — they are `uncheckedDowncast<T>` /
   `dynamicDowncast<T>` (with `JSValue` overloads). ARCHITECTURE §4.1's sample was corrected.
   (Found by pb-ts-ops; the checker enforces it.)
2. **`DOM(Client)IsoSubspaces.h` were missing the 17 new classes' members** — added by the
   orchestrator (these files are outside the streams dir and no Phase-B agent may touch them).
   Member name = class name minus the `JS` prefix.
3. **Handler-body ownership**: the `FOR_EACH_WEB_STREAMS_REACTION_HANDLER_*` X-macro groups in
   `JSStreamsRuntime.h` are chunked by owner file; each owner file defines ITS group's
   `JSC_DEFINE_HOST_FUNCTION` bodies. `JSStreamsRuntime.cpp` owns only the cell, all the
   LazyProperty members, and any unowned group. (The original pb-runtime brief said
   otherwise — corrected before it finished.)

## TransformStreamOperations.cpp — pb-ts-ops — DONE, CLEAN, 427 LOC (13 ops + 7 handlers)

1. Correctly did NOT implement the `TransformerKind::{TextEncoder,TextDecoder}` transform/flush
   arms: the frozen ABI owns them in `JSTextEncoderStream.cpp` / `JSTextDecoderStream.cpp`.
   RULING: correct; those two files are in wave 2. The wave-1 brief over-assigned; the header
   annotation wins, as instructed.
2. **Genuine Phase-A derivation bug**: `JSStreamsRuntime.h` documents the `_TS_OPERATIONS`
   handlers' context as "the JSTransformStream", but the digest's SinkAbort step 7.1.2 and
   SourceCancel steps 7.1.2/7.2 need the captured `reason` at reaction time. Resolved with the
   sanctioned `InternalFieldTuple{transformStream, reason}` context; BOTH the registration and
   the handler bodies live in TransformStreamOperations.cpp, so it is self-consistent.
   RULING: accepted. The stale per-entry comment in the frozen header is a KNOWN COMMENT
   INACCURACY (not an ABI change); fix it in the Phase-D polish pass, do not thaw the header.
3. The `[[flushAlgorithm]]`/`[[cancelAlgorithm]]` per-TransformerKind dispatch had no declared
   cross-file bridge; implemented as file-local static total switches that call the DECLARED
   per-kind entry points (`textEncoderStreamFlush` etc.). RULING: accepted (self-contained;
   the frozen header comment claiming the dispatch lives elsewhere is another Phase-D comment
   fix).
4. Reported the two fork-API facts above. RULING: applied globally.

## WritableStreamOperations.cpp — pb-ws-ops — DONE, CLEAN, 561 LOC (23/23 ops + the 2 `_WS_OPERATIONS` handlers)

1. Start ordering: read the frozen signatures correctly — the internal creators' `startResult`
   is a pre-existing VALUE; the `FromUnderlyingSink` path invokes the user `start(controller)`
   AFTER the controller is wired (spec order; `controller.error()` inside `start` must work).
   Factored file-locally; both public signatures implemented exactly as declared. RULING: accepted.
2. `onWSAbortSteps*` handler context: the header's per-entry comment says "the JSWritableStream"
   but the reaction needs the (already-detached) abort request's promise too; used the sanctioned
   `InternalFieldTuple{abortRequestPromise, stream}`. Registration + handler are both in this
   file, so self-consistent. RULING: accepted; the stale header COMMENT joins the Phase-D
   comment-fix list (same class as pb-ts-ops item 2 — the per-handler context comments in
   `JSStreamsRuntime.h` are advisory, and two files have now needed a tuple where the comment
   named a single cell).

## More cross-cutting facts (from wave 1's completions)

4. **`JSStreamConstructor<T>` needs a per-instantiation iso-subspace** (it carries
   `m_instanceStructure`, so it cannot share `internalFunctionSpace` like a plain
   `JSDOMConstructor<T>`). The orchestrator added the 10 `m_(client)subspaceFor<X>Constructor`
   members to `DOM(Client)IsoSubspaces.h`. Canonical names; JSReadableStream.cpp is the
   working example.
5. **WebIDL promise-returning-callback semantics are a sanctioned §7.1a site** (found by the
   byte-controller author, ratified): a SYNCHRONOUS throw from a user algorithm method
   (pull/cancel/write/close/abort/transform/flush) MUST become a REJECTED PROMISE, never a
   synchronous throw out of the calling op. ARCHITECTURE §7.1a's enumerated family list was
   incomplete on this. Every remaining author + reviewer has it in their brief.
6. The orchestrator ALSO wired (Phase-C items pulled forward because running agents needed
   them): `Zig::GlobalObject::m_streamsRuntime` + `streamsRuntime()` accessor (the initLater
   is DEFERRED with an in-code note — arming it before the streams/*.cpp are in the build
   would break every incremental link); `#include "streams/JSStreamsRuntime.h"` in
   ZigGlobalObject.cpp. Both verified: the full ZigGlobalObject.cpp TU compiles CLEAN.

## JSStreamPipeToOperation.cpp — pb-pipeto — DONE, CLEAN, 494 LOC
- Requested (and was granted) frozen-ABI amendment #1: the 3 `pipeToReadRequest*Steps`
  bridge declarations JSReadRequest.cpp needs (additive; probe re-verified CLEAN).
- RULING on its self-flagged design note: `ShutdownAction::AbortBoth` must START BOTH actions
  and wait for all (the digest: "a promise to wait for ALL of the actions"), NOT abort-then-
  cancel sequentially. Its lens-A reviewer confirms independently; it is a real fix for this
  file. Everything else accepted.

## JSReadableByteStreamController.cpp — pb-byte-controller — DONE, CLEAN, 1227 LOC (28/28 ops)
- Its `invokePromiseReturningMethod` judgment call is RATIFIED (cross-cutting fact 5 above).

## JSStreamsRuntime.cpp — pb-runtime — DONE, CLEAN, 140 LOC
- ZERO handler bodies (every X-macro group has another owner, incl. `_MISC` →
  WebStreamsMisc.cpp). The cell + all 102 LazyProperties + visitChildren + `from()`.

## ReadableStreamOperations.cpp — pb-rs-ops — DONE, CLEAN, 1284 LOC (38/38 ops)
- BINDING CROSS-FILE CONTRACT it set (relayed into pb-cells' brief): the ByteTee
  `JSReadIntoRequest` context is `InternalFieldTuple{teeState, jsBoolean(forBranch2)}` (the
  frozen header's "the JSStreamTeeState" comment is unimplementable). JSReadRequest.cpp MUST
  match. Phase-D comment fix.
- `acquireReadableStreamDefaultReader` is `userJS: no` ⇒ it does NOT materialize;
  getReader()/values()/readMany() materialize BEFORE acquiring (their briefs already say so).
- The `[[ReleaseSteps]]` total ControllerKind switch (incl. the Direct/NativeSink no-op arms)
  lives in readableStreamReaderGenericRelease here — its reviewers verify the arms exist.

## JSDirectStreamController.cpp — pb-direct — DONE, CLEAN, 831 LOC
- OPEN QUESTION for its fidelity reviewer: the old impl has a 4th non-spec `Closing` stream
  state for the direct-close window; the frozen spec-shaped enum cannot represent it, so the
  author emulated it (`m_closed` earlier + an onPull gate). The reviewer must adjudicate
  observational equivalence for a cancel() racing a deferred close(); worst case the fix is a
  `m_closing` bool on the CONTROLLER (not the stream enum).

## JSReadableStream.cpp — pb-readable-stream — DONE (CLEAN after fact 4's members), 802 LOC
## BunStreamConsumers.cpp — pb-consumers — DONE, CLEAN, 1275 LOC
## First review verdicts (both lenses of the first two files):
- TransformStreamOperations-A: ZERO critical/major over all 13 ops (3 minors).
- WritableStreamOperations-A: ZERO critical/major over all 23 ops (1 minor).
- TransformStreamOperations-B: 2 MAJOR (3 missing exception-checks at handler tails; the
  known stale handler-context comments) + 2 minor. All mechanical; queued for its fix pass.

## BunStreamSource.cpp — pb-native-source — DONE, CLEAN, 1745 LOC  ==> WAVE 1 IS 10/10 COMPLETE
- Its ONE deviation is RATIFIED and is a BUN-LAYER-DESIGN v2 ERRATUM: §5.2 step 8 said the
  direct `pull` is called with `this = undefined`, but the RSI line it cites (785) does
  `underlyingSource.pull(sink)` = `this = underlyingSource` (observable). The agent followed
  the cited ground truth over the derived doc, per its stated precedence. Correct.

## JSReadableStreamDefaultController.cpp — pb-rs-controller — DONE, CLEAN, 609 LOC (16 defs)
## JSWritableStreamDefaultWriter.cpp — pb-ws-writer — DONE, CLEAN, 482 LOC (8/8)
- Correctly refused to duplicate `setUpWritableStreamDefaultWriter` (my brief over-assigned
  it; the header annotates it to WritableStreamOperations.cpp, already defined there). The
  annotation-wins rule has now prevented duplicate symbols 3 times.

## RULING (from rv-ws-ops-B's MAJOR): ARCHITECTURE §4.1 fact 5 REFINED, no code change.
A handler must never leak a CATCHABLE SPEC-LEVEL exception, but `RETURN_IF_EXCEPTION`
bail-outs after `!`-op calls inside a handler are ACCEPTED: a VM termination must propagate
uncleared, and an exception escaping a `!` op is an internal invariant failure whose loud
uncaught-error report is DESIRED. Do not add catch-alls. (ARCHITECTURE.md updated.) Also:
`uncheckedDowncast` on a handler's OWN context (guaranteed by its registration site; handlers
are private and never exposed to JS) is CORRECT and preferred; the §4.1 sample's defensive
dynamicDowncast is not required. Reviewers should not report either pattern.

## Review verdicts so far
- WritableStreamOperations-B: 1 MAJOR (= the fact-5 refinement above; resolved by ruling,
  not by code) + 2 minors (a duplicated microtask helper for the Phase-D dedup list).

## JSWritableStreamDefaultController.cpp — pb-ws-controller — DONE, CLEAN, 637 LOC (11/11 + 2 internal methods + 6 handlers)
- All judgment calls follow already-ratified patterns (fact 5's invokePromiseReturningMethod;
  the file-local total kind switches; GetChunkSize's swallow-vs-Enqueue's-rethrow per digest).

## The internal-cells bundle — pb-cells — DONE, all 6 CLEAN (JSReadRequest 350, TeeState 70, CrossRealmState 68, PullIntoDescriptor 64, AlgorithmContexts 64, ReaderBase 14 LOC)
- Verified the ByteTee tuple contract BYTE-FOR-BYTE against ReadableStreamOperations.cpp's
  registrations before writing. Both binding contracts honored.
- NEW BINDING CONTRACT it set (relayed to pb-async-iter, which must match): the
  `ReadRequestKind::AsyncIterator` context is `InternalFieldTuple{iterator, thisNextsPromise}`
  (a bare-iterator context is provably wrong under chained next()); the read request's own
  steps do the resolve/release work. Same tuple-where-the-comment-said-one-cell class as the
  two prior rulings → Phase-D header-comment fix, no ABI change.
- ODR note (relayed to pb-readers): `isBYOB()` is defined in JSReadableStreamReaderBase.cpp;
  the header comment claiming otherwise is stale; the BYOB reader file must not redefine it.
- `queueReactionJob` now duplicated in a 3rd file → firmly on the Phase-D dedup list.

## WebStreamsMisc.cpp — pb-misc — DONE, CLEAN, 348 LOC (17/17 + the 3 host fns)
- Facts recorded: this fork's `JSPromise::markAsHandled()` takes no args (the declared VM& is
  unused); 5 dictionary property names are not in BunBuiltinNames (Identifier::fromString per
  call) — a Phase-D micro-optimization, not a defect.
## JSWritableStream.cpp (337) + JSTransformStream.cpp (311) + JSReadableStreamBYOBRequest.cpp (242) — pb-ws-ts-classes — DONE, all CLEAN
- All three delegate the observable dictionary conversions to the WebStreamsMisc-owned
  converters (single implementation of the alphabetical [[Get]] order).

## Strategies + TextEncoder/DecoderStream — pb-small-classes — DONE, all 4 CLEAN (271+271+355+394 LOC)
- Reuses the existing native TextEncoderStreamEncoder / TextDecoder classes (no encoding
  reimplementation). Per-realm cached strategy `size` functions come from JSStreamsRuntime.
- FYI it flagged (already covered): the OLD generated webcore/JSTextEncoderStream.{h,cpp} +
  JSTextDecoderStream.{h,cpp} define the SAME WebCore:: class names → they are on Phase C's
  deletion list; until then only the streams/ TUs are compiled by the probe (no collision).

## Review: JSReadableByteStreamController-A — ZERO critical/major over all 28 ops + 3 internal
   methods + 5 IDL members (2 provably-unobservable minors). Every classic BYOB bug site
   individually verified with quoted evidence. NO code changes required.
## Fidelity scoreboard so far: ts-ops(13 ops)=0, ws-ops(23)=0, byte-controller(28)=0
   critical/major across 64 of the hardest spec ops.

## JSReadableStreamAsyncIterator.cpp — pb-async-iter — DONE, CLEAN, 280 LOC
- Honored the binding AsyncIterator tuple contract exactly (no redundant reaction). Its
  `_ASYNC_ITERATOR` return-path context is `InternalFieldTuple{iterator, returnValue}` (the
  known comment-inaccuracy class; header comment → Phase-D list).

## WebStreamsExports.cpp (294) + CrossRealmTransform.cpp (64, stub) — pb-exports — DONE, CLEAN
- LOAD-BEARING: the Rust<->extern-C cross-check found ZERO mismatches across all 18 symbols
  (names, arity, types, the frozen Tag discriminants).
- RULING on its #1: ACCEPTED. `ReadableStreamTag__tagged`'s async-iterable path now builds a
  spec FromIterable stream (the old `type:"direct"` wrapper was a JS closure factory the
  closed ABI cannot express). Behavior-equivalent for consumers. FLAGGED PERF FOLLOW-UP
  (Phase D, measurement-gated): `new Response(asyncGenerator)` used to bypass the stream
  queue entirely; the new path goes through the (now C++) generic pump. Measure before
  optimizing — the new path may well be faster than the old JS one. The frozen header's
  comment claiming DirectPending is stale (Phase-D comment list).
- Its #2 (a second observable @@asyncIterator [[Get]] on the Bun-only tagged probe) is
  accepted as a negligible delta; #3's per-class error message wording is correct as written.

## Review: JSStreamPipeToOperation-A — CONFIRMED the AbortBoth ruling + found a REAL second
   MAJOR (synchronous-in-call shutdown/finalize where the spec requires "in parallel";
   observable: sink.abort() before pipeTo() returns; rs.locked wrong immediately after) + a
   MINOR (finalize obligations skippable by an exception). Fixer fx-pipeto LAUNCHED with all 3.

## ACCUMULATING MECHANICAL-FIXUPS LIST (one small fixer at the end of Phase B, not N agents)
- TransformStreamOperations.cpp lines ~341/373/408: add `scope.assertNoException()` after the
  3 `resolvePromise(<our promise>, jsUndefined())` calls in fire-and-forget handlers (they
  cannot throw — resolving with undefined does no thenable lookup — but the exception-check
  validator requires the explicit ack; the file's own line ~168 shows the blessed form).
  [From TransformStreamOperations-B; re-scoped under the refined fact 5: no behavior change.]
- TransformStreamOperations-A's 2 MINORs: add the 2 missing `IsNonNegativeNumber` asserts in
  createTransformStream.

## Review: ReadableStreamOperations-A — 1 REAL MAJOR (ReadableStream.from(primitive) must
   work; the vendored getAsyncIterator helper rejects non-objects; WPT from.any.js covers it)
   → fixer fx-rsops LAUNCHED. Other 37 ops step-exact. 2 non-observable minors (log only).
## Review: JSReadableStream-A — ZERO critical/major (ctor conversion order, all methods, the
   Bun materialization table all exact). Its 1 minor is a BUN-LAYER-DESIGN §3.4 ERRATUM: the
   doc says the text/json/bytes/blob brand check "rejects" but the old source IT CITES throws
   synchronously; the file matches the source (= parity). Doc erratum; zero code change.
## FIDELITY SCOREBOARD, FINAL (all 6 lens-A reviews in): 4 files with ZERO critical/major
   (ts-ops 13 ops, ws-ops 23, byte-controller 28, JSReadableStream); 2 files with 3 real
   MAJORs total, both prose-algorithm files (rs-ops: from(primitive); pipeto: AbortBoth
   sequentialization + synchronous-in-call shutdown). Fixers launched for both.

## JSReadableStreamDefaultReader.cpp (555) + JSReadableStreamBYOBReader.cpp (390) — pb-readers — DONE, both CLEAN
   (It negative-controlled the checker: an injected bogus member produced ERRORS.)
- RULING on its #3 (a real design-gap report): the frozen JSDirectStreamController::onPull is
  promise-shaped, so NON-promise read requests (tee / for-await / pipeTo over a `type:"direct"`
  stream) go through its (b) adapter, which can misroute ONE chunk only when a user pull()
  synchronously calls flush() while a non-promise consumer waits. ACCEPTED AS-IS: the OLD
  implementation was promise-shaped everywhere (nothing regresses), the scenario is an edge of
  an edge, and the clean fix is ONE additive X-macro handler. GATED ON A FAILING TEST in
  Phase D; do not thaw the ABI for it now. Its #4 (result property order) accepted.
- Correctly did not duplicate the setUp ops (annotation wins, 4th time) nor isBYOB (ODR relay).

## FIXERS LANDED, both CLEAN:
- fx-rsops: real GetIterator(async) (accepts primitives; JSAsyncFromSyncIterator via the
  VERIFIED fork API + asyncFromSyncIteratorStructure). ReadableStream.from("ab") now works.
- fx-pipeto: all 3 findings (AbortBoth starts BOTH actions + waits for all via a tuple latch;
  shutdown/finalize deferred off the synchronous pipeTo() call; finalize's obligations
  un-skippable). Both review observables now behave per spec.

## FULL PROBE OVER ALL 32 .cpp: ZERO non-CLEAN. 15,619 LOC of implementation.
## PHASE B WRITING + FIDELITY REVIEW + FIXES: COMPLETE. Awaiting the 2 consolidated sweeps.

## ============ CONTRACT AUDIT (the cross-file sweep) — THE BIG CATCH ============
1. [CRITICAL — MY ERROR, caught by the auditor] `JSTransformStreamDefaultController.cpp`
   WAS NEVER LAUNCHED. The real owner-file set is 33, not 32: I planned the file, lost it
   between planning and launching 21 agents, and "all 32 CLEAN" matched my own wrong count.
   Its 5 ops + the class + `onTSPerformTransformRejected` are declared in the frozen ABI and
   already CALLED by 3 finished files → Phase C's link would have failed with ~10 undefined
   symbols. A per-file syntax probe cannot see a MISSING file; only the cross-file
   "every declared symbol has exactly one definer" audit can — which is why it exists.
   FIX: pb-ts-controller LAUNCHED (the 33rd and final implementation file).
2. [MAJOR] The Direct-controller flush seam is a PERMANENT HANG for a non-promise consumer
   (tee / for-await / pipeTo over a `type:"direct"` stream whose pull() synchronously
   write()+flush()es): onFlush takeFirst()s the queued read request and fulfills an
   unobserved promise. This SUPERSEDES my earlier "gated on a failing test" ruling (the
   auditor proved a hang, not a misroute). FIX: in fx-mech (deliver by request KIND).
3. MINORs: the one-shot sink end/close tuple context (self-consistent; header comment →
   Phase-D list); dead cross-realm handler+structure (expected for the stub); several
   file-local static helpers duplicated across TUs (Phase-D dedup list).
EVERYTHING ELSE: every registration↔handler context, every tuple field order, every bound
shape, the ControllerKind dispatch totality, all accessor names, and ZERO duplicate symbols
across all TUs — verified clean by the auditor.

## fx-mech — DONE, both files CLEAN. The Direct flush/close delivery is now BY REQUEST KIND
   (non-promise consumers get the chunk via their own chunkSteps; the promise path unchanged).
   The tee-over-direct hang is fixed. + the 5 TransformStreamOperations mechanical items.

## ============ DISCIPLINE SWEEP (all 32 files at once) ============
STRUCTURAL FACTS (the headline): ZERO Strong/protect/gcProtect/ensureStillAlive in the whole
subsystem; ZERO per-call JSFunction creation; ZERO bare clearException; all 45
takeAbruptCompletion call sites at sanctioned spec completion-record locations.
FINDINGS: 0 CRITICAL, 7 MAJOR, 12 MINOR + 12 banned-comment lines. RULINGS:
- I1(x3): the `promiseResolvedWith(userResult)` tail of invokePromiseReturningMethod (a real
  user-JS point: the ES thenable lookup) is unchecked in 3 of its 4 copies → FIX all 3 in
  place NOW (the 4-copy DEDUP into one shared helper needs an ABI addition → Phase D).
- S1: the resumable-sink pump's §7.2 hole (sync cancel from inside sink.write() nulls the
  reader the next line derefs) — the one crash-shaped finding → FIX NOW.
- D1/D2 (hand-rolled catches → the sanctioned helper), P3 (finalize's two throwing releases
  need independent checks), the RELEASE_AND_RETURN validator class, and the 12
  banned-comment lines → FIX NOW.
- Everything the REFINED fact 5 obsoletes + the pure dedup/style minors → SKIPPED (Phase D).
Fixer fx-discipline LAUNCHED over the 7 affected files (JSTransformStreamDefaultController.cpp
excluded — being written concurrently; it gets its own review pass on landing).

## JSTransformStreamDefaultController.cpp — pb-ts-controller — DONE, CLEAN, 413 LOC
   (the 33rd and FINAL implementation file; 5/5 ops + the missing onTSPerformTransformRejected
   body; zero new judgment calls). Its dedicated combined reviewer (the only post-review code
   in the tree) is running: rv-ts-controller-AB.

## Review: JSTransformStreamDefaultController-AB (the only post-review file) — 1 CRITICAL +
   1 MAJOR + 2 minors. Retroactively justifies its dedicated pass:
- CRITICAL: its invokePromiseReturningMethod copy is the ONE without the ratified I1 fix —
  the file was written CONCURRENTLY with fx-discipline, which was (correctly) barred from
  touching it. An expected seam of my sequencing, caught exactly as designed.
- MAJOR (a genuinely new find): Enqueue's abrupt path over-asserts `readable is Errored`; a
  user size() that closes the readable THEN throws makes it CLOSED → a debug ASSERT crash /
  an EMPTY JSValue thrown in release. Real, user-reachable.
Fixer fx-ts-controller LAUNCHED with both + the minors.

## fx-discipline — DONE. 10 files edited, all 7 MAJORs + the validator class + all 12 banned
   comments applied; every edited file independently CLEAN. Its skip list is reasoned (each
   item is Phase-D style/dedup or something the sweep itself deferred; it also correctly
   refined the sweep's own suggested isDone-arm guard, which would have broken completion,
   with the proof). Remaining: fx-ts-controller only.
