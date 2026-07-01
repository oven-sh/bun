# Adversarial review — `TransformStreamOperations.cpp` — lens B (exception/reentrancy discipline + mechanism compliance)

Reviewed against `specs/ARCHITECTURE.md` §4.1 / §7 and the `// userJS:` contract in
`src/jsc/bindings/webcore/streams/WebStreamsInternals.h`. `python3 specs/check-streams.py`
reports CLEAN, but that script is a clang *compile* check only (see `check-streams.py:50`),
so it enforces none of §7 — everything below is manual.

Note on scope of evidence: several callees (`resolvePromise`, `rejectPromise`,
`promiseResolvedWith`, `readableStreamDefaultControllerError/Close`,
`writableStreamDefaultControllerErrorIfNeeded`) are declared in `WebStreamsInternals.h` but
their `.cpp` owners are not yet on disk in this tree. I reviewed the target file against the
header's **declared** `userJS:` contract, which §7.2 names as the law, not against the
(absent) bodies.

---

### [MAJOR] Three `resolvePromise` (`userJS: yes`) calls with no exception observation, inside fire-and-forget reaction handlers

**Lines:** 341 (`onTSSinkAbortCancelFulfilled`), 373 (`onTSSinkCloseFlushFulfilled`),
408 (`onTSSourceCancelFulfilled`).

**Rule:** §7.1 ("after EVERY call that can … run user JS: `RETURN_IF_EXCEPTION`"; the §7
preamble requires `BUN_JSC_validateExceptionChecks=1` clean) + §4.1 fact 5 (all three
handlers are registered with `resultPromiseOrJSUndefined == jsUndefined()` — lines 245, 264,
284 — so a pending exception on return is an **uncaught error at the microtask level**).

**Failure:** `resolvePromise` is annotated `userJS: yes` (`WebStreamsInternals.h:147`).
Each of the three sites calls it and then does `return JSValue::encode(jsUndefined());`
without `RETURN_IF_EXCEPTION`, `scope.release()`, or `scope.assertNoException()`. Because
`resolvePromise` will itself declare a throw scope, this leaves `vm.m_needExceptionCheck`
set at `~ThrowScope` → `BUN_JSC_validateExceptionChecks=1` trips, violating the §7
non-negotiable. The file *itself* already proves what the correct form is: the identical
`resolvePromise(previous, jsUndefined())` at **lines 168–171** carries
`// Resolving with undefined performs no thenable lookup and cannot throw.` +
`scope.assertNoException();`, and the fourth site (line 120) uses `RETURN_IF_EXCEPTION`.
So 2 of 5 `resolvePromise` sites in the file are disciplined and 3 are not — this is an
inconsistency inside one file, not a defensible convention.

(These are the fulfilled arms; if a real exception ever *did* escape, `[[finishPromise]]`
would additionally never settle — a hung `writer.abort()` / `readable.cancel()` /
`writer.close()` caller. Today it is a validator failure, not a runtime bug, because the
resolution value is `jsUndefined()`.)

**Minimal fix:** at 341, 373, 408 add the exact line-170/171 pair
(`// Resolving with undefined performs no thenable lookup and cannot throw.` +
`scope.assertNoException();`) before the `return`. (Equivalently `RETURN_IF_EXCEPTION(scope, {})`.)

---

### [MAJOR] Four handlers violate the closed reaction-handler list's documented context contract (`InternalFieldTuple` vs `JSTransformStream`), consumed with an unchecked cast

**Lines:** registrations 245 and 284 pass `context = InternalFieldTuple{stream, reason}`;
handlers 329–330 (`onTSSinkAbortCancelFulfilled`), 350 (`onTSSinkAbortCancelRejected`),
395–396 (`onTSSourceCancelFulfilled`), 417 (`onTSSourceCancelRejected`) do
`uncheckedDowncast<InternalFieldTuple>(callFrame->argument(1))`.

**Rule:** §4.1 — "`WebStreamsInternals.h` declares, and `JSStreamsRuntime` owns, both
closed handler lists"; "Reviewers verify this per handler." The registry entry for this
family, `JSStreamsRuntime.h:115–117`, states:
`// owner: TransformStreamOperations.cpp. context = the JSTransformStream, EXCEPT
// onTSSinkWriteBackpressureChangeFulfilled, whose context is an InternalFieldTuple{transformStream, chunk}.`

**Failure:** That is false for 4 of the 7 handlers: only `onTSSinkCloseFlushFulfilled` /
`onTSSinkCloseFlushRejected` (lines 264, 363, 382) actually take the bare
`JSTransformStream`. The abort-cancel and source-cancel pairs need the digest's captured
`reason` (04-transform §…SinkAbortAlgorithm step 7.1.2.1, …SourceCancelAlgorithm step
7.1.2.1) so they use a tuple — correctly — but the closed-list contract was never updated.
Within this .cpp both ends agree, so there is **no runtime bug today**; the hazard is that
the closed list is the artifact the architecture tells reviewers and future registration
sites to trust, the cast is `uncheckedDowncast` (no type check, `ASSERT` only in debug),
and a registration written to the documented contract (passing `stream` directly) would
type-confuse `JSTransformStream` as `InternalFieldTuple` and read
`getInternalField(0)` out of an unrelated object silently in release builds.

**Minimal fix:** correct `JSStreamsRuntime.h:115–117` to name the four tuple-context
handlers (context = `InternalFieldTuple{transformStream, reason}`) and the two
stream-context handlers explicitly. No .cpp change needed.

---

### [MINOR] `takeAbruptCompletion` catch site is not in §7.1a's enumerated closed list, and the helper hosting it is a byte-for-byte duplicate

**Lines:** 40–60 (`invokePromiseReturningMethod`), used at 73 (flush) and 96 (cancel).

**Rule:** §7.1a — "the ONE place an exception may be caught … occurs in exactly these
families … never elsewhere." The list ends at "every `startAlgorithm` invocation"; it does
**not** name the transformer `flush`/`cancel` (or `transform`) callback invocation.

**Assessment (honest):** the catch is semantically **required** — the digest
(04-transform §SetUpTransformStreamDefaultControllerFromTransformer steps 6–7) defines
these algorithms as *"the result of invoking transformerDict[…]"*, i.e. the WebIDL
promise-returning-callback invoke, whose abrupt completion becomes a rejected promise.
And the exact same helper already exists, character-for-character, as a `static` in
`JSReadableByteStreamController.cpp:109` for the underlying-source `pull`/`cancel` invoke
(lines 142, 175 there). So this is not a swallowed-exception bug; it is (a) a gap in the
§7.1a closed enumeration that a future reviewer relying on the list would wrongly reject
or, worse, wrongly *accept a third divergent copy of*, and (b) a duplicated private
implementation of the one construct the spec says to centralize ("Prefer the ONE shared
helper"). Termination handling in the copy is correct (empty `result` + empty `thrown` ⇒
`nullptr` with the termination still pending; both callers `RETURN_IF_EXCEPTION`
immediately — lines 240, 260, 279).

**Minimal fix:** hoist `invokePromiseReturningMethod` into `WebStreamsInternals.h` /
`WebStreamsMisc.cpp` next to `takeAbruptCompletion` and delete both static copies; add
"WebIDL invocation of a promise-returning underlying-source/sink/transformer callback
(`invokePromiseReturningMethod`)" to §7.1a's family list.

---

### [MINOR] Three `JSGlobalObject*`-taking functions have neither a `ThrowScope` nor the required "provably non-throwing leaf" comment

**Lines:** 177–181 (`transformStreamUnblockWrite`), 190–209
(`setUpTransformStreamDefaultControllerFromTransformer`), 288–294
(`transformStreamDefaultSourcePullAlgorithm`).

**Rule:** §7.1 sentence 1: "Every function taking a `JSGlobalObject*` declares
`auto scope = DECLARE_THROW_SCOPE(vm)` (or is a provably-non-throwing leaf **and says so
in one comment**)."

**Failure:** none of the three has either. `transformStreamUnblockWrite` and
`transformStreamDefaultSourcePullAlgorithm` are not even leaves — both reach
`transformStreamSetBackpressure` (163), which allocates a `JSPromise` and calls
`resolvePromise`. No exception can actually escape (setBackpressure's own scope proves
`assertNoException` and `JSPromise::create` cannot throw), so this is a discipline/audit
gap, not a live bug — but §7.1 makes the comment mandatory precisely so the next reader
doesn't have to re-derive that.

**Minimal fix:** add the one-line "non-throwing: only reaches
`transformStreamSetBackpressure`, which cannot throw" comment to each (or a scope +
`scope.assertNoException()` on the two non-leaves).

---

## Things hunted for and explicitly found CLEAN (so they are not re-litigated)

- **§4.1 fact 5, per handler.** The 6 fire-and-forget handlers all `RETURN_IF_EXCEPTION`
  after `readableStreamDefaultControllerError/Close` and
  `writableStreamDefaultControllerErrorIfNeeded`. Those are spec `!` operations: I could
  not construct a *user-JS* exception that escapes them (the one arbitrary-user-JS point,
  the `Object.prototype.then` getter hit while resolving a read request's `{value,done}`
  result object, is caught by the ES promise-resolve function itself and converted to a
  rejection). So the `RETURN_IF_EXCEPTION`s there propagate **only VM termination**, which
  §7.1a says must never be caught. Fact 5 holds. (This is why finding #1 is confined to
  the `resolvePromise` tails.)
- **§7.2 reentrancy.** The genuinely dangerous window is
  `writableStreamDefaultControllerErrorIfNeeded` at 405/420: through
  `WritableStreamFinishErroring` it can **synchronously re-enter
  `transformStreamDefaultSinkAbortAlgorithm` (229)** with the user's `cancel()` inside.
  That reentry is defused by the `[[finishPromise]]` memo guard at 234 (already set by the
  in-flight source-cancel at 276 before its user call at 278), and every value read after
  a `userJS: yes` call is either re-fetched from a member
  (`stream->m_backpressure` inside `transformStreamUnblockWrite` at 407/422;
  `stream->m_controller` / `stream->m_writable->m_controller` inside
  `transformStreamErrorWritableAndUnblockWrite` at 157–158) or is a set-once member
  (`m_finishPromise`, `m_controller`, `m_readable`, `m_writable`) whose cached local
  cannot go stale. No deque-entry pointer is held anywhere. Clean.
- **Argument-index / family compliance.** All 7 handlers are on the
  `FOR_EACH_WEB_STREAMS_REACTION_HANDLER` list (not the bound list) and all read
  `value = argument(0)`, `context = argument(1)` — the reaction order, never the bound
  order. All 4 registration sites use `performPromiseThenWithContext` with the §4.1
  6-argument shape; the only real result capability (line 223) belongs to the one handler
  that legitimately throws (315–317, 321). No `JSFunction::create`, no
  `JSNativeStdFunction`, no `Strong`/`protect`/`ensureStillAlive`, no `clearException`
  anywhere in the file.
- **§7.5.** The transform digest requires no `[[PromiseIsHandled]]` sets (grep: none);
  every promise created here is either returned to a machinery that reacts to it or is
  reacted to at its creation site, and no extra `markAsHandled` was added.
- **`dynamicDowncast`.** The file uses only `uncheckedDowncast`, on values whose type is
  a construction invariant (kind-tagged `m_algorithmContext` at 79/81; contexts we
  registered ourselves at 310/329/350/363/382/395/417; the transform readable's controller
  at 35). `uncheckedDowncast<InternalFieldTuple>` on the sibling files' handlers is the
  same convention (`WritableStreamOperations.cpp:537`, `ReadableStreamOperations.cpp:1261`).

---

## Per-function table

| Function (line) | throws-checked (§7.1/7.1a)? | userJS-revalidated (§7.2)? | mechanisms-clean (§4.1/7.6)? |
|---|---|---|---|
| `transformReadableController` (31) | n/a (no globalObject; leaf) | n/a | YES |
| `invokePromiseReturningMethod` (40) | YES (but the `takeAbruptCompletion` site is outside §7.1a's list — finding 3; and the helper is duplicated) | YES (nothing cached) | YES |
| `performFlushAlgorithm` (63) | YES (all tails `RELEASE_AND_RETURN`) | YES | YES |
| `performCancelAlgorithm` (87) | YES | YES | YES |
| `createTransformStream` (102) | YES (111, 121) | YES | YES |
| `initializeTransformStream` (125) | YES (131, 135) | YES | YES |
| `transformStreamError` (144) | YES (149) | YES (150 re-reads via `stream`) | YES |
| `transformStreamErrorWritableAndUnblockWrite` (153) | YES (159) | YES | YES |
| `transformStreamSetBackpressure` (163) | YES (171 assertNoException + comment) | n/a (userJS: no) | YES |
| `transformStreamUnblockWrite` (177) | **NO — no scope, no non-throwing comment (finding 4)** | n/a | YES |
| `setUpTransformStreamDefaultController` (183) | n/a (VM&) | n/a | YES |
| `setUpTransformStreamDefaultControllerFromTransformer` (190) | **NO — no scope, no comment (finding 4)** | n/a | YES |
| `transformStreamDefaultSinkWriteAlgorithm` (211) | YES (226 `RELEASE_AND_RETURN`) | YES (no userJS before the state reads) | YES |
| `transformStreamDefaultSinkAbortAlgorithm` (229) | YES (240) | YES (only set-once members used after 239) | YES |
| `transformStreamDefaultSinkCloseAlgorithm` (249) | YES (260) | YES | YES |
| `transformStreamDefaultSourceCancelAlgorithm` (268) | YES (279) | YES | YES |
| `transformStreamDefaultSourcePullAlgorithm` (288) | **NO — no scope, no comment (finding 4)** | n/a | YES |
| `onTSSinkWriteBackpressureChangeFulfilled` (306) | YES (321) | YES (re-reads `m_writable`/`m_controller`) | YES (has a real result capability) |
| `onTSSinkAbortCancelFulfilled` (325) | **NO — 341 `resolvePromise` unobserved (finding 1)** | YES | **contract mismatch (finding 2)** |
| `onTSSinkAbortCancelRejected` (345) | YES (354; 355 `rejectPromise` is `userJS: no`) | YES | **contract mismatch (finding 2)** |
| `onTSSinkCloseFlushFulfilled` (359) | **NO — 373 `resolvePromise` unobserved (finding 1)** | YES | YES |
| `onTSSinkCloseFlushRejected` (377) | YES (386) | YES | YES |
| `onTSSourceCancelFulfilled` (391) | **NO — 408 `resolvePromise` unobserved (finding 1)** | YES (407 re-reads members) | **contract mismatch (finding 2)** |
| `onTSSourceCancelRejected` (412) | YES (421) | YES | **contract mismatch (finding 2)** |

---

## Verdict

The file is structurally sound on the two hardest axes (reentrancy after user JS; the two
sanctioned callable mechanisms) and I found no memory-safety or uncaught-rejection bug
reachable by user code today. It fails §7's *letter* at three fire-and-forget `resolvePromise`
tails (a `BUN_JSC_validateExceptionChecks` cleanliness break the file's own line 170 shows
how to fix) and it desynchronizes the §4.1 closed handler-list contract for 4 of its 7
handlers; both are cheap, mechanical fixes that should land before this file is called done.
