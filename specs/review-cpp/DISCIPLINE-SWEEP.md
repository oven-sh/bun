# DISCIPLINE-SWEEP — consolidated adversarial sweep, lens = §7 exception/GC discipline + §4.1 mechanism discipline

Scope: all 32 `.cpp` under `src/jsc/bindings/webcore/streams/` (15,619 LOC). Grep-driven checklist over
(a) rooting primitives, (b) per-call function creation, (c) catch machinery, (d) `takeAbruptCompletion`
call-site classification, (e) missing exception acknowledgment, (f) §7.2 spot-audit, (g) banned comments.
Items already on `PHASE-B-LOG.md`'s mechanical-fixups list (TransformStreamOperations ~341/373/408
`assertNoException`; the 2 `IsNonNegativeNumber` asserts) are NOT re-reported. Per-file spec fidelity and
cross-file contracts are other passes and are not reported here.

Callee facts verified against the fork sources during this sweep (they kill several would-be findings and
create two real ones):
- `JSPromise::performPromiseThenWithContext` (JSPromise.cpp:433): allocation + microtask queueing only,
  no ThrowScope, no user JS ⇒ non-throwing. Sites that "check" it and sites that don't are both correct;
  only the inconsistency is reportable (A1).
- `promiseResolvedWith` = `JSPromise::resolvedPromise` = the real ES `PromiseResolve`: the `constructor`
  [[Get]] on a user thenable/promise CAN throw synchronously; the thenable `then` [[Get]] runs user JS.
- `resolvePromise` = `JSPromise::resolve`: runs user JS (thenable lookup) but its exception is consumed
  into a rejection by the promise machinery ⇒ never leaves a pending non-termination exception.
- `rejectPromise` = `promise->reject(vm, ...)` and `promiseRejectedWith`: non-throwing, no user JS.
- `TopExceptionScope`/`ThrowScope` verification (ThrowScope.cpp, `VM::verifyExceptionCheckNeedIsSatisfied`):
  every non-tail return from a `DECLARE_THROW_SCOPE` callee arms `m_needExceptionCheck`; the bit is
  verified at the next scope construction AND at scope destruction ⇒ the "trailing throwing call with no
  RELEASE_AND_RETURN" class does trip `BUN_JSC_validateExceptionChecks=1`.

## Per-file table

(a) = Strong/protect/gcProtect/ensureStillAlive; (b) = per-call `JSFunction::create`/`JSNativeStdFunction`;
(c) = bare `clearException` / hand-rolled `clearExceptionExceptTermination`; (d) = takeAbruptCompletion at
an unsanctioned site; (e) = missing-exception-acknowledgment findings; (g) = banned comments.

| file | a | b | c | d | e | g |
|---|---|---|---|---|---|---|
| BunStreamConsumers.cpp | 0 | 0 | 0 | 0 (4 sites, all routed) | 0 | 1 (`§3.1` @762) + 8 RS:/RSI: port refs |
| BunStreamSource.cpp | 0 | 0 | 0 | 0 sanctioned-shape; 6 cleanup swallows flagged (F5) | 1 MAJOR (S1) + 3 MINOR | 0 |
| CrossRealmTransform.cpp | 0 | 0 | 0 | 0 (stubs) | 0 | 0 |
| JSByteLengthQueuingStrategy.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| JSCountQueuingStrategy.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| JSCrossRealmTransformState.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| JSDirectStreamController.cpp | 0 | 0 | **2 hand-rolled (396, 408)** | 0 (2 sites, both routed) | 0 | 0 |
| JSPullIntoDescriptor.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| JSReadRequest.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| JSReadableByteStreamController.cpp | 0 | 0 | 0 | 0 (4 sites, digest families) | 1 MAJOR (I1 class) + 1 note | 3 ("the digest" @385, 780, 1003) |
| JSReadableStream.cpp | 0 | 0 (ctor `finishCreation`, one-time) | 0 | 0 (1 site, WebIDL family) | 0 | 5 (BUN-LAYER § @96,135,357,434,713) |
| JSReadableStreamAsyncIterator.cpp | 0 | 0 | 0 | 0 | 0 (consistency note A1) | 0 |
| JSReadableStreamBYOBReader.cpp | 0 | 0 | 0 | 0 (1 site, WebIDL family) | 0 | 0 |
| JSReadableStreamBYOBRequest.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| JSReadableStreamDefaultController.cpp | 0 | 0 | 0 | 0 (3 sites, digest families) | 1 MAJOR (I1) | 2 ("the digest" @526, 551) |
| JSReadableStreamDefaultReader.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| JSReadableStreamReaderBase.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| JSStreamAlgorithmContexts.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| JSStreamPipeToOperation.cpp | 0 | 0 | 0 | 0 | 1 MAJOR (P3) + 2 MINOR | 1 ("digest 14.1" @141) |
| JSStreamTeeState.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| JSStreamsRuntime.cpp | 0 | 0 (all inside `initLater`) | 0 | 0 | 0 | 0 |
| JSTextDecoderStream.cpp | 0 | 0 | 0 | 0 (1 site, transform-algorithm family) | 0 | 0 |
| JSTextEncoderStream.cpp | 0 | 0 | 0 | 0 (1 site, transform-algorithm family) | 0 | 0 |
| JSTransformStream.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| JSWritableStream.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| JSWritableStreamDefaultController.cpp | 0 | 0 | 0 | 0 (3 sites, digest families) | 1 MAJOR (I1) | 0 (`§7.1a` @536 = the rule-cite comment) |
| JSWritableStreamDefaultWriter.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| ReadableStreamOperations.cpp | 0 | 0 | 0 | 0 (6 sites, digest families) | 0 (1 scope-decl note R1) | 0 |
| TransformStreamOperations.cpp | 0 | 0 | 0 | 0 (1 site, WebIDL family) | 4 MINOR (T1–T4) | 0 (`§7.1a` @39 = rule cite) |
| WebStreamsExports.cpp | 0 | 0 | 0 | 0 | 0 | 0 |
| WebStreamsMisc.cpp | 0 | 0 | THE sanctioned helper (311–318) | definition site | 0 | 0 (`§7.1a` @310 = rule cite) |
| WritableStreamOperations.cpp | 0 | 0 | 0 | 0 | 0 | 0 |

(a) is CLEAN across the whole subsystem: `grep -n 'JSC::Strong\|gcProtect\|protect(\|ensureStillAlive'`
over all 32 files returns nothing. §7.6 holds with zero uses of even the pre-authorized exception.

(b) `JSFunction::create` appears at exactly 4 places: 3 inside `LazyProperty::initLater` initializers in
`JSStreamsRuntime.cpp:75/84/88` (sanctioned) and 1 in `JSReadableStreamConstructor::finishCreation`
(`JSReadableStream.cpp:307`, the static `from` — one per realm at constructor creation, not per-call).
Zero `JSNativeStdFunction` anywhere. §4.1's two-closed-list contract holds.

(c) Zero bare `clearException()`. `clearExceptionExceptTermination()` appears at exactly 3 places: the ONE
sanctioned helper (`WebStreamsMisc.cpp:316`) and TWO hand-rolled copies in
`JSDirectStreamController.cpp:396,408` (findings D1, D2).

## (d) `takeAbruptCompletion` call-site classification (45 call sites + the definition)

Definition: `WebStreamsMisc.cpp:311`. Every call site classified:

Digest completion-record families (sanctioned, §7.1a) — 24:
- size() family: `JSReadableStreamDefaultController.cpp:539` (strategy size), `:558` (EnqueueValueWithSize),
  `JSWritableStreamDefaultController.cpp:552` (GetChunkSize), `:617` (write's EnqueueValueWithSize).
- WebIDL promise-returning user-method invoke: the `invokePromiseReturningMethod` helpers —
  `JSReadableStreamDefaultController.cpp:41`, `JSReadableByteStreamController.cpp:117`,
  `JSWritableStreamDefaultController.cpp:40`, `TransformStreamOperations.cpp:52`.
- WebIDL promise-returning operation argument conversion → rejection:
  `JSReadableStreamBYOBReader.cpp:413` (read), `JSReadableStream.cpp:637` (pipeTo).
- byte controller %ArrayBuffer% construct family: `JSReadableByteStreamController.cpp:389`
  ([[PullSteps]] autoAllocate), `:1007` (pullInto buffer), `:785` (EnqueueClonedChunkToQueue).
- ReadableStreamFromIterable iterator calls: `ReadableStreamOperations.cpp:749, 777, 800`.
- tee structuredClone / CloneAsUint8Array abrupt: `ReadableStreamOperations.cpp:916, 1100, 1157`.
- native transformer transform/flush algorithm → rejected promise (the promise-returning callback
  contract): `JSTextEncoderStream.cpp:327`, `JSTextDecoderStream.cpp:368`.
- PackAndPostMessage*: NO sites — `CrossRealmTransform.cpp` is a throwing stub (transferable streams out
  of scope), so this family is empty by design. (`TransformStreamDefaultControllerEnqueue`'s catch lives in
  `webcore/JSTransformStreamDefaultController.cpp`, OUTSIDE the swept directory — noted for the fidelity pass.)

Bun-layer sites (no digest exists for these; the catch shape is the same helper) — 21:
- ROUTED (error the stream / reject the tracked promise / rethrow) — 15:
  `JSDirectStreamController.cpp:477` (user pull → handleError + rejected pull promise), `:571`
  (sink end → reject pending read / rethrow); `BunStreamConsumers.cpp:494, 620, 741, 870` (each
  returned as a rejected consumer promise; 741 also errors the stream);
  `BunStreamSource.cpp:397` (→ `Bun__reportError`), `:663`, `:699` (→ rejected promise), `:965`
  (→ `rsisAbrupt`), `:1033` (→ AggregateError rejection), `:1436` (→ `resumableHandleAbrupt`),
  `:1517` (→ sticky `m_error` + end microtask), `:1554` (→ controller error), `:1652` (→ abrupt handler).
- SWALLOWED on a cleanup/teardown path (error has no consumer) — 6, see F5:
  `BunStreamSource.cpp:333` (`publicStreamCancelIgnoringResult`), `:380` (`nativeSourceSever`),
  `:785` (user `cancel()` during direct close), `:984` (`rsisFinally` reader release),
  `:1312` (`resumableReleaseReader`), `:1345` (`resumableEnd` sink `end()` failure).
  All 6 correctly propagate VM terminations (empty ⇒ return).

No `takeAbruptCompletion` at a SPEC-file site outside the §7.1a families ⇒ no unsanctioned spec-level
swallow. The 6 Bun-layer cleanup swallows are the only judgment calls (F5).

### findings

Severity: CRITICAL = a §7/§4.1 hard-rule break with a runtime consequence; MAJOR = a real
validator-breaking / re-validation / mechanism-rule violation; MINOR = consistency & hygiene.
CRITICAL: 0. MAJOR: 7. MINOR: 12 (some are one fix over several sites).

#### I1 (MAJOR ×3, §7.1 + code-dup) `invokePromiseReturningMethod` — 3 of its 4 copies are wrong
`JSReadableStreamDefaultController.cpp:33–47`, `JSWritableStreamDefaultController.cpp:32–47`,
`JSReadableByteStreamController.cpp:108–122`: the whole helper runs under a single
`DECLARE_TOP_EXCEPTION_SCOPE`, there is NO `DECLARE_THROW_SCOPE`, and the tail
`return promiseResolvedWith(globalObject, result);` is unchecked. `promiseResolvedWith` is the real ES
`PromiseResolve`: on a user thenable/promise `result` it performs the `constructor` [[Get]] and the `then`
[[Get]] — user JS that CAN throw. A throw there (a) escapes the "convert abrupt to a rejected promise"
contract the comment above the helper states, and (b) leaves the pending exception unacknowledged under a
live catch scope (validator RELEASE_ASSERT). The 4th copy — `TransformStreamOperations.cpp:40–61` — is the
correct shape (outer `DECLARE_THROW_SCOPE`, block-scoped catch scope, `RELEASE_AND_RETURN` on both
tails). FIX: make the other three byte-identical to it — and per the dedup rule, this is ONE helper
declared once (WebStreamsInternals.h), not four static copies.

#### D1, D2 (MAJOR ×2, rule c / §7.1a) `JSDirectStreamController.cpp:393–397` and `:404–410`
Two hand-rolled `catchScope.clearExceptionExceptTermination()` blocks (`callUnderlyingSourceClose`,
`handleError`) — the subsystem's contract (`WebStreamsInternals.h:155–158`, §7.1a) is that
`takeAbruptCompletion` is the ONLY catch spelling. Behavior is correct (swallow a fire-and-forget Bun
`close(reason)` error / a secondary sink-teardown error; keep terminations pending), so the fix is purely
mechanical: `if (catchScope.exception()) [[unlikely]] { if (takeAbruptCompletion(globalObject, catchScope).isEmpty()) return; }`
at both sites.

#### S1 (MAJOR, §7.2) `BunStreamSource.cpp:1399–1409` — no re-validation after the resumable sink `write()`
The resumable sink holds a bound `cancel` callable (`resumableSetup:1490–1497`); if `sink.write(chunk)`
synchronously invokes it, `resumableCancelImpl` (1446) sets `m_closed` and `resumableReleaseReader` (1303)
CLEARS `op->m_reader`. The `keepGoing` path then tail-calls `resumableIssueRead` (1409→1420), which passes
`op->m_reader.get()` — now null — into `readableStreamDefaultReaderRead`, which dereferences
`reader->m_stream` with no null check (`JSReadableStreamDefaultReader.cpp:87–91`). Every other loop head in
this pump re-checks (`resumableDrain:1428`). FIX: after each `write` (the `isDone` one at ~1389 and the
streaming one at ~1400) re-check `if (op->m_closed || !op->m_reader) { op->m_reading = false; return; }`
before issuing the next read / ending.

#### P3 (MAJOR, §7.1) `JSStreamPipeToOperation.cpp:314–316` — back-to-back throwing releases, one check
`writableStreamDefaultWriterRelease(...)` (a `DECLARE_THROW_SCOPE` callee that can throw) is immediately
followed by `readableStreamDefaultReaderRelease(...)`; the single `RETURN_IF_EXCEPTION` at 316 covers only
the second. If the writer release throws, the reader release runs with a pending exception (and its scope
constructor RELEASE_ASSERTs under the validator) — and §7 finalize semantics want BOTH releases attempted.
FIX: `RETURN_IF_EXCEPTION(scope, );` between the two (or the digest's catch-both-then-settle shape).

MINOR findings, grouped by file:

#### TransformStreamOperations.cpp (validator hygiene; same class as the already-logged 341/373/408 items)
- T1 `:142` — `transformStreamSetBackpressure(...)` (a ThrowScope callee) is the last armed call before
  `initializeTransformStream`'s scope destructs. FIX: `scope.assertNoException()` after it.
- T2 `:150` — `transformStreamError`'s tail `transformStreamErrorWritableAndUnblockWrite(...)` is a
  throwing tail call without `RELEASE_AND_RETURN`. FIX: wrap.
- T3 `:160` — `transformStreamErrorWritableAndUnblockWrite`'s tail `transformStreamUnblockWrite(...)`:
  same. FIX: wrap.
- T4 `:422–423` (`onTSSourceCancelRejected`) — `transformStreamUnblockWrite(...)` arms the bit; the
  following `rejectPromise` does not clear it and the handler scope destructs unchecked. FIX:
  `RETURN_IF_EXCEPTION(scope, {})` (or `assertNoException` if provably non-throwing here) after it, as the
  fulfilled twin at `:407–412` will get from the logged 408 fix.

#### JSStreamPipeToOperation.cpp
- P1 `:170–171` and P2 `:193–194` — `op->finalize(globalObject); return;` where `finalize` declares a
  ThrowScope and can throw (the releases): throwing tail call without `RELEASE_AND_RETURN` (the AbortBoth
  arm at `:205` does it right). FIX: `RELEASE_AND_RETURN(scope, op->finalize(globalObject))` at both.

#### BunStreamSource.cpp
- S2 `:1014` — `rsisFinish` ends with `resolvePromise(globalObject, result, endResult);` under the live
  scope with no `RELEASE_AND_RETURN`; `endResult` is the user sink's `end()` return, so this is a §7.2
  userJS point (nothing is read after it) and the file's own convention everywhere else is
  `RELEASE_AND_RETURN`. FIX: wrap.
- S3 `:1047` — same shape for `rsisAbrupt`'s trailing `rejectPromise` (cannot throw; consistency only). FIX: wrap.
- S4 `:~1228` (`rsisHandleReadResult`) — the non-batch write path issues the next read without re-checking
  `op->m_didClose` after `sink.write`, while the batch path (`rsisAfterBatch:1105–1130`) re-checks.
  Consequence is benign today (a read on a closed stream resolves done); mirror the guard.
- F5 (decision) — the 6 cleanup-path swallows listed under (d). They are outside the §7.1a families (Bun
  layer, no digest) and are "ignore a secondary failure during teardown". Each should carry the one-line
  reason-the-error-has-no-consumer comment that §7.1a demands of every catch site (or route to
  `Bun__reportError` as `nativeSourceCallClose:397` does). Flagged for the BUN-LAYER reviewer; not a spec
  violation.

#### ReadableStreamOperations.cpp
- R1 `:998` `byteTeeForwardReaderError` — takes `JSGlobalObject*`, allocates (`InternalFieldTuple::create`,
  1002) and registers a reaction, with no `DECLARE_THROW_SCOPE` and no "non-throwing leaf" comment. All 3
  callers check immediately after, so nothing is dropped; add the scope or the §7.1 one-line comment. The
  same tail-delegate-without-scope shape exists at `:200`, `:217`, `:257`, `:437` — one treatment for the class.

#### JSReadableStreamAsyncIterator.cpp / JSReadableStreamDefaultReader.cpp
- A1 — `JSReadableStreamAsyncIterator.cpp:198, 215, 242` register reactions via
  `performPromiseThenWithContext` with no exception check, while `JSReadableStreamDefaultReader.cpp:334, 364`
  check the identical (verified non-throwing) call. One convention is dead code; pick one subsystem-wide
  (the callee cannot throw ⇒ the DefaultReader checks are the noise).

#### JSReadableByteStreamController.cpp
- B1 — `:397–398` vs `:1015`: `JSPullIntoDescriptor::create` (pure cell allocation) is
  RETURN_IF_EXCEPTION'd in `pullSteps` but not in `pullInto`; the `pullSteps` check is the redundant one.

## (f) §7.2 spot-audit (the ~10 highest-risk user-JS points)

- `WritableStreamOperations.cpp:202` (signal abort fires user `abort` listeners): `stream->m_state`
  RE-READ at 205 and re-branched before any further mutation — correct (the spec's one prose re-check).
- `JSDirectStreamController.cpp:473` (user `pull`): `m_stream`/`m_state` re-loaded at 505–506 after the
  call, with the re-entrancy comment — correct.
- `JSReadableStreamDefaultController.cpp:528` (user `size()`): only the returned number is used; nothing
  re-read between the size call and `enqueueValueWithSize` — this MATCHES the WHATWG step order (the spec
  itself does not re-check between them) and is cell-safe. Deliberate; not a finding.
- `JSWritableStreamDefaultWriter.cpp:137–150` (write → user `size()`): fully re-validates after — release
  detection (`writer->m_stream != stream`) and a fresh `m_state` before enqueuing — correct.
- WS/RS/byte `write()/close()/abort()/pull()/cancel()` algorithm invokes: in-flight markers are set BEFORE
  the user call; state is only re-read inside the reaction handlers — correct.
- byte controller `enqueue` (read-request resolution + detach): counts/`pendingPullIntos` re-read after
  every resolution loop iteration; `byteOffset/byteLength` captured before the transfer — correct.
- `ReadableStreamOperations.cpp:914` (tee `structuredClone`): `m_canceled1/2` re-read after — correct.
- `BunStreamConsumers.cpp:540` (buffered fast path user call): checked BEFORE any state mutation — correct.
- `BunStreamSource.cpp:1389/1400` (resumable sink `write`): NOT re-validated — finding S1 (the one hole).
- `ReadableStreamOperations.cpp:421` (`updateRef(false)` on reader release): `m_reader`/`m_stream` cleared
  unconditionally after with no liveness re-check — idempotent; worth a look only if a user handle's
  `updateRef` can re-enter `releaseLock`.

## (g) Banned-comment list (one consolidated list)

Comments citing a review/spec artifact that does not ship (reword each to cite the WHATWG step or the
in-tree header instead):
- `JSReadableStreamDefaultController.cpp:526, 551` — "the digest's completion-record site"
- `JSReadableByteStreamController.cpp:384–385, 780, 1003` — "the digest"
- `JSStreamPipeToOperation.cpp:141` — "digest 14.1"
- `JSReadableStream.cpp:96, 135, 357, 434, 713` — "BUN-LAYER §…" (= specs/BUN-LAYER-DESIGN.md sections)
- `BunStreamConsumers.cpp:762` — "§3.1's exact per-function check order" (a specs/ section)

Notes, not violations:
- `[reaction-convention]` / `[bound-convention]` tags (~15 sites) resolve to `JSStreamsRuntime.h:11/43/196`
  — in-tree and self-contained; NOT banned.
- `WebStreamsMisc.cpp:310`, `TransformStreamOperations.cpp:39`, `JSWritableStreamDefaultController.cpp:536`
  say "§7.1a" — §7.1a itself requires catch sites to cite the rule; keep, or spell it out
  ("the one sanctioned completion-record catch") to drop the doc-section number.
- `BunStreamConsumers.cpp:225, 256, 300, 341, 383, 521, 641, 790` cite deleted-builtin line ranges
  (`RS:`/`RSI:`) — port provenance that will rot; consider dropping the line numbers.
- No "Phase B/C/D", review IDs, or transcript references anywhere in the 32 files.

## Verdict

Mechanism discipline is structurally intact across all 32 files: zero Strong/protect/ensureStillAlive, zero
per-call callable creation, zero bare `clearException`, and zero spec-level catches outside §7.1a's families.
The sweep's real defects are seven MAJORs of three kinds: the 3 wrong copies of `invokePromiseReturningMethod`
(I1 — unchecked user-JS `promiseResolvedWith` under a catch scope; the TransformStreamOperations copy is the
correct template), the 2 hand-rolled catches in JSDirectStreamController (D1/D2, mechanical), the 1 §7.2
re-validation hole in the resumable-sink pump (S1, the only runtime-crash-shaped finding), plus 1 ordering
bug in `JSStreamPipeToOperation::finalize` (P3); everything else is validator/consistency hygiene and a
comment-wording list.
