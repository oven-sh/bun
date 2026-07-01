# HEADER-REVIEW-3 — adversarial review of the frozen `webcore/streams/` headers

Reviewer lenses: (A) the `userJS`/owner annotations Phase-B authors will code against;
(B) practical C++ usability beyond `check-streams.py` (which I re-ran: 32 headers → CLEAN).
Method: every declaration in `WebStreamsInternals.h` was diffed against OP-SIGNATURES'
userJS column AND against ARCHITECTURE §7.2's later additions (a)/(b)/(c); the two handler
lists in `JSStreamsRuntime.h` were re-derived from the reaction/bound sites in
ARCHITECTURE §4.1/§5.1, digest-cited spec sites, and BUN-LAYER §2–§5/§7/§9; the in-tree
`JSDOMConstructorBase.h` and `JSAbortAlgorithm.h`/`ZigGlobalObject.cpp:1737` were read to
test include/ABI hypotheses the syntax check cannot see.

---

### [CRITICAL] The per-`SourceKind`/`TransformerKind` algorithm ARMS are cross-file with NO declared entry points

- Where: `WebStreamsInternals.h:237` (`readableStreamDefaultControllerCallPullIfNeeded` — owner
  `JSReadableStreamDefaultController.cpp`), `:251` (byte twin), the controller members
  `cancelSteps/pullSteps` (`JSReadableStreamDefaultController.h:91-99`), vs
  `BunStreamSource.h:3-5` ("its .cpp also owns … the **Native pull/cancel/start algorithm
  arms** (§2.3-§2.4)") and BUN-LAYER §2.4.
- Why it blocks Phase B: ARCHITECTURE §4 makes "perform this.[[pullAlgorithm]]" a
  `switch (m_sourceKind)` inside the controller's own `.cpp`. The `Transform` arm has a
  declared cross-file target (`transformStreamDefaultSourcePullAlgorithm/…CancelAlgorithm`,
  `WebStreamsInternals.h:358-359`) — proving the intended pattern — but **no other
  non-JavaScript arm does**:
  - `Native` pull / cancel / start bodies are assigned to `BunStreamSource.cpp`
    (BUN-LAYER §2.3–§2.4, and `BunStreamSource.h`'s own header comment), yet the switch
    that must invoke them is owned by `JSReadableStreamDefaultController.cpp`. No
    `nativeSourcePull/nativeSourceCancel/nativeSourceStart` declaration exists anywhere.
  - `TeeBranch` / `ByteTeeBranch` pull+cancel algorithm bodies belong (per §1.4's prefix
    rule: `ReadableStreamDefaultTee`/`ReadableByteStreamTee`) to
    `ReadableStreamOperations.cpp`; the invoking switch is in the two controller `.cpp`s.
  - `FromIterable` pull/cancel (iterator `next`/`return` + reactions whose handlers are
    owned by `ReadableStreamOperations.cpp`, `JSStreamsRuntime.h:76-83`).
  - `TransformerKind::TextEncoder/TextDecoder` transform/flush arms (BUN-LAYER §9.2 puts
    the encode/flush logic with the `JSTextEncoderStream`/`JSTextDecoderStream` classes)
    are invoked from `transformStreamDefaultControllerPerformTransform`
    (`JSTransformStreamDefaultController.cpp`). No cross-file symbol.
  Two Phase-B authors will either both implement an arm (duplicate/diverging bodies) or
  each assume the other did; the internals header forbids them from adding a declaration
  ("declared here, EXACTLY ONCE" and the set is frozen).
- Exact fix: add one declaration per non-JavaScript arm to `WebStreamsInternals.h`, in the
  owner-file section §1.4 assigns, with userJS annotations, e.g.
  `JSC::JSValue nativeSourcePull(JSC::JSGlobalObject*, JSReadableStreamDefaultController*); // userJS: no (native handle.pull) — BunStreamSource.cpp`,
  `nativeSourceCancel`, `nativeSourceStart`,
  `defaultTeePullAlgorithm(JSC::JSGlobalObject*, JSStreamTeeState*, uint8_t branch)`,
  `defaultTeeCancelAlgorithm(…)`, `byteTeePullAlgorithm(…)`, `byteTeeCancelAlgorithm(…)`,
  `fromIterablePullAlgorithm(…)`, `fromIterableCancelAlgorithm(…)`,
  `textEncoderStreamTransform/Flush(…)`, `textDecoderStreamTransform/Flush(…)`.
  (Alternative accepted fix: a written ruling that ALL arms are implemented inline in the
  controller `.cpp`s — but then `BunStreamSource.h:3-5` and BUN-LAYER §2.4's owner claim
  must be corrected in the same freeze, or two files implement the Native arm.)

### [CRITICAL] The pipeTo state machine has no cross-file entry point at all

- Where: `WebStreamsInternals.h:202` declares `readableStreamPipeTo` with owner
  "`ReadableStreamOperations.cpp` (the state machine lives in `JSStreamPipeToOperation.cpp`,
  §1.3)". The section reserved for that file (`WebStreamsInternals.h:390-393`) is EMPTY and
  says "their class methods are on the cells" — but `JSStreamPipeToOperation.h:20-87`
  declares **zero member functions** (data members only).
- Why: the `ReadableStreamOperations.cpp` author must allocate the op cell, register the
  source/dest closed reactions and the signal algorithm, and START the loop; every "resume
  the loop / shutdown / finalize" step is (by the owner split and by the `onPipe*` handler
  ownership, `JSStreamsRuntime.h:91-103`) in `JSStreamPipeToOperation.cpp`. There is no
  declared symbol connecting the two files, and both files need the shared
  loop/shutdown/finalize logic. Un-writable without violating the frozen ABI.
- Exact fix: declare the pipe cell's methods in `JSStreamPipeToOperation.h`
  (e.g. `void start(JSC::JSGlobalObject*); void next(JSC::JSGlobalObject*); void shutdown(JSC::JSGlobalObject*, JSC::JSValue error, bool hasError); void shutdownWithAction(…); void finalize(JSC::JSGlobalObject*);`
  each with a `// userJS:` comment), OR declare a single
  `void startPipeToOperation(JSC::JSGlobalObject*, JSStreamPipeToOperation*)` under a
  `JSStreamPipeToOperation.cpp` section in `WebStreamsInternals.h`. Do the same audit for
  `JSStreamTeeState` (the tee pull/cancel entry of CRITICAL #1 covers it).

### [CRITICAL] The pipe's signal-abort callable has no handler in EITHER closed list

- Where: `JSStreamPipeToOperation.h:8-10` mandates registration "through the GC-visited
  `addAbortAlgorithmToSignal` / `removeAbortAlgorithmFromSignal` API" +
  `m_abortAlgorithmId` (`:57-58`); `JSStreamsRuntime.h:240-242` (the closed
  bound-convention list) has no pipe entry; the reaction list (`:192-207`) has none either.
- Why: the ONLY in-tree GC-visited API is
  `AbortSignal::addAbortAlgorithmToSignal(AbortSignal&, Ref<AbortAlgorithm>&&)` where the
  algorithm is a `JSAbortAlgorithm` wrapping a **`JSC::JSObject*` callback**
  (`webcore/JSAbortAlgorithm.h:32-35`, `ZigGlobalObject.cpp:1746-1749`). The pipe therefore
  needs a JS callable carrying the op cell — per ARCHITECTURE §4.1 that callable stored on
  an object we don't control MUST be a `JSBoundFunction` over a shared bound-convention
  target. That target does not exist; the header itself instructs a Phase-B author who
  needs an unlisted handler to STOP. `pipeTo({signal})` (heavily WPT-covered) is blocked.
  (A reaction-convention handler cannot be substituted: `JSAbortAlgorithm::handleEvent`
  calls the callback with `(reason)` only — no `argument(1)` context.)
- Exact fix: add an owner group to `JSStreamsRuntime.h`:
  `// owner: JSStreamPipeToOperation.cpp` →
  `#define FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET_PIPE(V) V(boundPipeAbortAlgorithm)`
  (receives `(pipeOpCell, reason)`), and add it to
  `FOR_EACH_WEB_STREAMS_BOUND_HANDLER_TARGET`. Update the JSStreamPipeToOperation.h
  liveness comment to name it.

### [CRITICAL] BUN-LAYER §3.1a's standalone Text sink has no cell class in the frozen set

- Where: `WebStreamsInternals.h:443-445` (`readableStreamIntoText` "through
  readStreamIntoSink with the standalone Text sink"), `JSReadStreamIntoSinkOperation.h:44-45`
  ("`m_sink` … OR the internal standalone Text sink of BUN-LAYER §3.1a"),
  BUN-LAYER §3.1a step 1 ("as its own small internal cell/object, **distinct from
  `JSDirectStreamController`**").
- Why: no header declares that cell, `StreamsForward.h` does not forward-declare it, and
  `JSStreamsRuntime.h:258-270`'s internal-Structure list has no entry for it — yet
  `readStreamIntoSink(…, sink, /*isNative*/ false)` requires an instance of it. A Phase-B
  author must invent a new class in a frozen header set (forbidden) or violate §3.1a by
  reusing `JSDirectStreamController` (whose Text arm has different BOM semantics — the
  asymmetry §3.1a says must NOT be conflated).
- Exact fix: add `JSStandaloneTextSink.h` (a small `JSNonFinalObject` owning the shared
  `BunTextAccumulator` state — or, cheaper, a `JSDestructibleObject` owning the same
  `m_rope/m_pieces/m_estimatedLength` members as `JSDirectStreamController`'s Text arm),
  forward-declare it in `StreamsForward.h`, and add a `standaloneTextSinkStructure` row to
  `FOR_EACH_WEB_STREAMS_INTERNAL_STRUCTURE`. (Or a maintainer ruling amending §3.1a.)

### [MAJOR] `readableStreamCloseIfPossible` is declared inside the wrong owner block

- Where: `WebStreamsInternals.h:457-459` — it sits under the
  `BunStreamConsumers.cpp` banner (`:423-427`) but its trailing tag says
  `— ReadableStreamOperations.cpp`. PHASE-A-NOTES §2a's `ReadableStreamOperations.cpp`
  list (31 ops) does not contain it either.
- Why: the file's stated organizing rule is "grouped by the .cpp that OWNS its body"
  (`WebStreamsInternals.h:3-5`). A `BunStreamConsumers.cpp` author implementing their
  section and a `ReadableStreamOperations.cpp` author grepping for their tag will BOTH (or
  NEITHER) implement it. It is also called from BunStreamSource.cpp (§5.3/§5.4), so a miss
  is a link error at best.
- Exact fix: move the declaration up into the `ReadableStreamOperations.cpp` block
  (after `readableStreamError`), and add it to PHASE-A-NOTES §2a's list (32 ops).

### [MAJOR] `readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue`'s contract invites stale-descriptor double-commit

- Where: `WebStreamsInternals.h:270-272`. The returned `Vector<JSPullIntoDescriptor*,4>` is
  pre-collected and the ONLY caller obligation stated is "consumed … before any
  allocation-heavy work" (a GC concern). But the caller's commit loop calls
  `readableByteStreamControllerCommitPullIntoDescriptor` — annotated `userJS: yes` on the
  very next screen (`:256`) — between elements. The spec's own loop re-reads
  `[[pendingPullIntos]]`/fill state after EVERY commit; §7.2 forbids holding stale views of
  reentrantly-mutable state across a userJS call, and `JSPullIntoDescriptor.h:2-5` itself
  says holders "must still RE-VALIDATE that the descriptor is still relevant afterward".
  The comment as written certifies the unsafe pattern.
- Exact fix: replace the comment with the real contract: "the caller MUST commit these one
  at a time and, because Commit is userJS:yes, MUST re-validate each remaining descriptor
  (still head-of / still pending on this controller) before committing it" — or change the
  signature back to the spec's incremental fill-shift-commit inside ONE owner function.

### [MINOR] `readableStreamFromAsyncIterator` owner contradicts the file table

- Where: `WebStreamsInternals.h:461-464` assigns it to `BunStreamConsumers.cpp`, citing
  BUN-LAYER §6.1. The ruling (PHASE-A-NOTES §4.5) scopes `BunStreamConsumers.cpp` to
  BUN-LAYER §3; §6 (the tag protocol whose only caller this is) is owned by
  `WebStreamsExports.cpp`. One unambiguous tag exists so it will not be double-written,
  but the assignment breaks the "table entry wins" rule and PHASE-A-NOTES never records
  the deviation. Fix: retag to `WebStreamsExports.cpp` (or record the deviation).

### [MINOR] `userJS: no` on `transferArrayBuffer` is correct but under-documents §7.2's detach hazard

- Where: `WebStreamsInternals.h:117-118`. ARCHITECTURE §7.2's list includes "detaching an
  ArrayBuffer that could be observed by user code". Detach runs no user JS (the `no` is
  right and matches OP-SIGNATURES' seed fact), but the annotation legend says `no` ⇒
  callers need no re-validation — while any cached view length/`vector()` of the SOURCE
  buffer is dead after this call. Fix: append "(runs no JS, but DETACHES `buffer`: callers
  must re-read any cached view state — §7.2 last bullet)".

### [MINOR] `resolvePromise` / §7.4's "fresh object" exemption is unsound for objects (documentation only)

- Where: `WebStreamsInternals.h:136-141`; ARCHITECTURE §7.4. Resolving a promise with ANY
  object — including our fresh `{value, done}` result object — performs `Get(v, "then")`,
  which reaches a user-installed `Object.prototype.then` getter (user JS synchronously).
  Only primitive resolutions (undefined/true) are exempt. No annotation flips (every op
  that resolves with an object is already `yes`), but the `promiseResolvedWith` /
  `resolvePromise` comments should say "with any OBJECT (a user `Object.prototype.then`
  getter runs), not only user thenables" so a Phase-B author does not "optimize" a
  fulfillment site to skip re-validation.

### [MINOR] `WebStreamsInternals.h` relies on transitive includes for three names it uses

- Where: `JSC::JSUint8Array*` (`:122` — a typedef, not forward-declarable),
  `const JSC::Identifier&` (`:441`), `WTF::String` (`:449`). None of
  `<JavaScriptCore/JSTypedArrays.h>`, `<JavaScriptCore/Identifier.h>`,
  `<wtf/text/WTFString.h>` is included; they resolve today only through `root.h`.
  `check-streams.py` passes, so this is fragility, not breakage. Fix: add the three
  includes (`StreamQueue.h` has the same relationship to `WTF_MAKE_NONCOPYABLE`
  / `<wtf/Noncopyable.h>`).

### [MINOR] `StreamQueue::enqueueValueWithSize`'s RangeError message names the wrong class

- Where: `StreamQueue.h:64` — `"ReadableStream chunk size must be …"`. The same
  instantiation is the WritableStream controller's `[[queue]]`
  (`JSWritableStreamDefaultController.h:52`), so `writer.write()` size errors would say
  "ReadableStream". Fix: a class-neutral message ("The queuing strategy's chunk size must
  be a non-negative, finite number").

---

## userJS corrections

**None are required.** I diffed all 146 free-op annotations (plus the 8 internal-method
members, `materializeIfNeeded`, the direct controller's pump, and the `extern "C"` block)
against OP-SIGNATURES' userJS column and then re-audited every `userJS: no` against
ARCHITECTURE §7.2's three post-OP-SIGNATURES additions:

- (a) *signals abort on an `AbortController`* — the only op that reaches
  `WritableStreamAbort` step 2 / the `[[abortController]]` signal is `writableStreamAbort`
  itself; it and every transitive caller declared here (`writableStreamDefaultWriterAbort`,
  `readableStreamPipeTo`, the `ReadableStream__cancel*` externs) are already `yes`
  (`WebStreamsInternals.h:291-292, 315, 202, 503-505`).
- (b) *settling a promise with a user-controlled value / fulfilling a read request with a
  user chunk* — every such op is already `yes`:
  `readableStreamFulfillReadRequest/FulfillReadIntoRequest` (`:183-184`),
  `readableStreamClose/Error` (`:179-180`), `resolvePromise`/`promiseResolvedWith`
  (`:137,141`), every `*Enqueue`, every read/release dispatch site. The `no`-marked
  settlers all settle exclusively with values we construct or are *rejections*
  (rejection never does a `then` lookup): `promiseRejectedWith`/`rejectPromise` (`:139,143`),
  `readableStreamReaderGenericInitialize` (`:174`),
  `writableStreamFinishInFlightWrite/Close` (`:299,301`),
  `writableStreamRejectCloseAndClosedPromiseIfNeeded` (`:306`),
  `writableStreamUpdateBackpressure` (`:307`),
  `writableStreamDefaultWriterEnsure{Closed,Ready}PromiseRejected` (`:318-319`),
  `writableStreamDefaultWriterRelease` (`:321`), `writableStreamAddWriteRequest` (`:294`),
  `transformStreamSetBackpressure`/`transformStreamDefaultSourcePullAlgorithm` (`:351,359`),
  `acquire*/setUp*Reader/Writer` (`:169-172,289-290`). I verified each against its digest
  steps; none settles with a user value.
- (c) *invoking read-request / read-into-request steps* — every dispatch site is `yes`,
  and the `JSReadRequest`/`JSReadIntoRequest` member declarations carry the blanket
  `userJS: YES(transitive)` comment (`JSReadRequest.h:38-41, 85`).

The class-member annotations required by the brief all exist and are correct:
`cancelSteps/pullSteps/releaseSteps` (`JSReadableStreamDefaultController.h:91-99`,
`JSReadableByteStreamController.h:93-101`), `abortSteps/errorSteps`
(`JSWritableStreamDefaultController.h:88-92`), `materializeIfNeeded`
(`JSReadableStream.h:105-107`), the direct controller's pump (`JSDirectStreamController.h:87-96`).
Header-vs-OP-SIGNATURES yes→no downgrades: zero. So the annotation surface is safe to
freeze as-is; the freeze risk is entirely in the MISSING declarations above.

## Verdict

The userJS/owner annotation layer is faithful to OP-SIGNATURES **and** to §7.2's later additions — zero flips required — and the class headers are C++-sound (subspace/destructibility/constructor-base checks all hold against the real in-tree bases).
The set is NOT freezable yet: four CRITICALs are all of one shape — work the docs assign across two files with no declared bridge (the non-JS algorithm arms, the pipe state machine + its abort callable, §3.1a's Text sink cell) — each fixable by additive declarations, no signature changes.
Fix those four plus the two MAJORs (ownership grouping of `readableStreamCloseIfPossible`; the pull-into commit-loop contract) and freeze; the MINORs can ride along.
