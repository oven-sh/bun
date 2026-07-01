# BUN-LAYER-DESIGN (v1) — Adversarial Review: GC / lifetime + ARCHITECTURE-rule compliance

Reviewer lenses: (i) GC & object-lifetime safety, (ii) the non-negotiable rules in
`specs/ARCHITECTURE.md` (§3, §3.3, §4.1, §5, §7, §7.6). Behavioral fidelity is NOT reviewed here.
Every JSC-API claim below was checked against `/root/oven-webkit/Source/JavaScriptCore/` and the
current tree (`src/codegen/generate-jssink.ts`, `src/js/builtins/ReadableStreamInternals.ts`,
`src/runtime/webcore/ReadableStream.rs`), not from memory.

---

### [SEVERITY: CRITICAL] The erased `[[controller]]` slot has a non-total dispatch: `[[ReleaseSteps]]` on a `Direct`/`NativeSink` controller is unhandled, reachable, and type-confuses the spec core

- **Design claim** (§1): *"Widened controller slot (§4 below). ARCHITECTURE §3.2 declares the
  exact-typed back-pointer; the Bun layer REQUIRES it to be the erased form + a kind tag …
  `ControllerKind { None, Default, Byte, Direct, NativeSink }; WriteBarrier<JSC::JSObject> m_controller;`"*
  and (§4.7) the ONLY dispatch sites given are `ReadableStreamDefaultReaderRead`, `readMany`,
  and `readableStreamCancel`.
- **Evidence**: the spec core the OTHER agents write from ARCHITECTURE + the digests performs
  `stream.[[controller]].[[ReleaseSteps]]()` inside `ReadableStreamReaderGenericRelease`
  (`specs/digest/02-readable-abstract-ops.md:684`) and `[[CancelSteps]]` inside
  `ReadableStreamCancel`. ARCHITECTURE §3.2 tells that author the slot is a
  **`WriteBarrier<JSFoo>` of the exact class**, so the natural (and per-ARCHITECTURE, *correct*)
  code is `m_controller->releaseSteps()` on a `JSReadableStream{Default,Byte}Controller*`, or a
  `jsCast<>` of the erased slot. `jsCast` is `static_cast` in release. The design's OWN §3.3
  (`readableStreamToTextDirect`: "take a default reader, `await read()` until `done` …,
  **release**") and §5.3 step 8 (`reader.releaseLock()`) reach `ReaderGenericRelease` while
  `m_controllerKind == Direct` (and user JS can do it directly:
  `s = new ReadableStream({type:"direct", pull(c){c.write(u8)}}); r = s.getReader(); r.read(); r.releaseLock()`).
  The design never mentions `[[ReleaseSteps]]` (grep: zero hits) and never enumerates the total
  set of controller-typed sites in `ReadableStreamOperations.cpp` that must grow a
  `ControllerKind` switch.
- **Why it fails**: a `JSDirectStreamController` (a `JSDestructibleObject` owning a
  `WTF::StringBuilder` + a `Vector<WriteBarrier>`) or a generated `JSReadable*Controller`
  (JSSink) reinterpreted as a `JSReadableStreamDefaultController` and having its `Deque`
  members walked/cleared is heap corruption — exactly the §5 "off-by-one-atom" class the
  architecture bans `virtual` to avoid, reintroduced through a partial kind switch. Even in
  debug it is an unconditional `jsCast` ASSERT on a supported public path. This is also a direct
  contradiction between two documents that are both about to be FROZEN (ARCHITECTURE §3.2 says
  exact-typed; this design says erased) — Phase-B authors of `ReadableStreamOperations.cpp` will
  follow ARCHITECTURE.
- **Proposed fix (minimal)**: (1) amend ARCHITECTURE §3.2 in the same edit: `JSReadableStream::
  [[controller]]` is the ONE back-pointer that is `WriteBarrier<JSObject>` + `ControllerKind`,
  everything else stays exact-typed. (2) Add to this design an EXHAUSTIVE table of every spec op
  that touches `stream.[[controller]]` (`GenericRelease→[[ReleaseSteps]]`,
  `Cancel→[[CancelSteps]]`, `DefaultReaderRead→[[PullSteps]]`, `close/error`,
  `getReader({mode:"byob"})`'s brand check, `desiredSize`) with the required behavior for
  `Direct`, `NativeSink`, and `None` in each (for `[[ReleaseSteps]]` on `Direct`/`NativeSink`:
  a no-op arm — but it must be WRITTEN). (3) State that a raw `jsCast` on `m_controller` is
  banned; every access goes through one inline `switch (m_controllerKind)` helper.

---

### [SEVERITY: MAJOR] §2.2 turns the handle→controller edge from a `WeakRef` into a strong `WriteBarrier` while the handle is externally rooted by Rust — pins the entire consumer graph (leak)

- **Design claim** (§2.2): *"the adapter's `m_controller` is the back-edge (replaces the old
  `WeakRef` — a strong edge is correct: today the WeakRef was only a GC-cycle-breaking hack; the
  controller already holds `m_algorithmContext` so the cycle is a plain, collectable JS cycle).
  `#onClose` no longer needs to null the back-edge for GC."*
- **Evidence**: the claim is only true if the handle has no root *outside* the cycle. It does.
  `src/runtime/webcore/ReadableStream.rs:681-689` + `increment_count` (`:945-956`): the JS
  handle wrapper's `JsRef` *"is upgraded to **Strong** in `increment_count` while a native I/O
  ref is held … downgraded back to Weak in `decrement_count`"*. So during any in-flight native
  read (and for an `updateRef(true)`'d long-lived source like a socket/stdin) the object graph is
  `Rust Strong → handle → handle.onDrain (the §2.2 JSBoundFunction, a GC-visited property/cached
  value on the handle) → boundArgs[0] = adapter → adapter.m_controller (STRONG) → controller →
  controller.[[stream]] → stream → reader → readRequests → queued chunks`, plus
  `adapter.m_pendingView` (up to the 2 MiB adaptive buffer). Today
  (`ReadableStreamInternals.ts:2154, 2180, 2207-2216`) `#controller` is a **`WeakRef`** and
  `#onClose` explicitly nulls it and `$data` — precisely so a natively-rooted handle does NOT
  root the consumer side. The design deletes both.
- **Why it fails**: not a UAF, a **retention regression**. (a) A consumer that abandons the
  stream mid-read (drops the reader, breaks out of `for await`, never cancels) keeps the whole
  stream + controller + queue + `m_pendingView` alive for as long as native holds its Strong —
  today only `{handle, source}` survive and the controller/queue/chunks collect. (b) After a
  clean close, `callClose` clears `adapter→handle` (`m_handle`) and `m_pendingView`, but the
  leak edge is the OTHER direction (`handle → onClose/onDrain boundfn → adapter → controller →
  stream`), which nothing in the design ever clears; a lingering Rust Strong retains a dead
  stream graph per source.
- **Proposed fix (minimal)**: keep the strong `m_controller` (it is simpler and §7.6-clean) but
  restore the old teardown's severing, in C++: on `#onClose`/`callClose` AND on the Native
  `cancelAlgorithm`, clear `handle.onClose`/`handle.onDrain` (set the handle's cached callback
  slots to `undefined`, exactly what the Rust `on_close_callback_set_cached(..., UNDEFINED)`
  path already does) in the same step that nulls `m_handle` and `m_pendingView`. State it as a
  numbered step in §2.4's `callClose` and §2.4's `cancelAlgorithm`.

---

### [SEVERITY: MAJOR] §5.3 / §5.4 pump cells have no proven GC root across the backpressure `await` — the exact "rooted only by pending reactions" argument ARCHITECTURE §6.1 refuted

- **Design claim** (§5.3): `readStreamIntoSink` *"Becomes an internal cell
  `JSReadStreamIntoSinkOperation … { m_stream, m_reader, m_sink, m_result … }` driven by §4.1
  reactions."* No rooting/liveness statement is made for it (nor for §5.4's
  `JSResumableSinkPumpOperation`).
- **Evidence / trace**: ARCHITECTURE §6.1 ("this is a proof, not a hope — v1's version was
  refuted with a concrete trace") requires the pipe cell to be reachable via
  **`WriteBarrier` back-edges from the acquired reader/writer**, cleared in finalize, precisely
  because "rooted by whichever promise it is currently awaiting" fails the moment the only
  pending reaction is on a promise nobody marks. §5.3's op cell is in exactly that shape.
  While a `reader.read()` is pending the chain
  `stream (Rust `readable_stream::Strong`) → m_reader → readRequests → JSReadRequest →
  m_context(JSPromise) → reaction(context = opCell)` holds. But in step 5's backpressure window
  (`wrote < 0 → await sink.flush(true)`) there is **no pending read request**: the ONLY path to
  the op cell (and therefore to `m_sink` and to `m_result`, the promise Rust's `Signal` protocol
  is waiting on) is `pendingFlushPromise → reaction → opCell`, and whether that flush promise is
  itself strongly held by a marked object is a property of the native sink's Rust/JSSink
  internals that this design neither states nor cites. If it is not, the op cell is collected
  mid-pump: the pump silently stops, the stream stays locked forever (its reader is only
  reachable from the collected op… and from `stream.m_reader`, so the *lock* leaks while the
  *pump* dies), and `m_result` never settles.
- **Why it fails**: even if the current native sinks happen to root their pending flush promise,
  the design ships an internal operation cell whose liveness rests on an unstated invariant
  about code outside the subsystem — the thing §6.1 exists to forbid. §5.4 has the same shape
  (idle between `drain()` calls, reachable only through the JSBoundFunctions stored on the
  native ResumableSink wrapper, whose own rooting is Rust-side and unstated).
- **Proposed fix (minimal)**: apply §6.1's own device: give the acquired reader a
  `WriteBarrier<JSC::JSCell> m_pumpOperation` back-edge (the same member the pipe uses — reuse
  `m_pipeOperation`, it is one op per reader by construction), set when §5.3/§5.4 acquire the
  reader and cleared in their `finally`/release steps, both visited. Then
  `Rust Strong → stream → reader → opCell → sink` holds through every await with no assumptions
  about native promise retention. One sentence each in §5.3 step 1 and §5.4 setup.

---

### [SEVERITY: MAJOR] §4.3's direct-pull pump violates ARCHITECTURE §7.2: after the synchronous user `pull()` it neither re-validates `[[state]]` nor re-loads `m_pendingRead`, then calls `readableStreamAddReadRequest` whose precondition it may have destroyed

- **Design claim** (§4.3): step 5 runs the user `pull(controller)`; step 7 is unconditionally
  *"`if (!m_pendingRead) m_pendingRead = promiseToReturn = newPromise(); else promiseToReturn =
  readableStreamAddReadRequest(m_stream)`"*. §4.6 (`handleDirectStreamError`): *"reject
  `m_pendingRead` with `e`"*.
- **Evidence**: `controller.error(e)` is a public method on the direct controller (§4.2) and is
  NOT deferred by the `m_deferClose = -1` guard (only `close`/`flush` are, §4.4/§4.5 step 2). A
  user `pull` that calls `controller.error(e)` and **returns normally** (no throw, so §4.3's
  step-5 early-error return is not taken) leaves the stream `Errored` and `m_pendingRead`
  rejected. Step 7 then runs against an Errored stream. Two concrete failures: (a) the design's
  §4.6 says *reject* `m_pendingRead`, not *clear* it (the old code clears it —
  `ReadableStreamInternals.ts:1141` `controller._pendingRead = undefined`), so step 7 takes the
  `readableStreamAddReadRequest(m_stream)` arm; (b) the spec op `ReadableStreamAddReadRequest`
  begins `Assert: stream.[[state]] is "readable"` (digest 02) — in the C++ core that is a debug
  `ASSERT` (crash) and in release it enqueues a `JSReadRequest` whose error steps have already
  fired, so the returned `read()` promise is pinned in the reader's deque and never settles.
  ARCHITECTURE §7.2 names this exact rule: after any `JSC::call` of a user function,
  *"re-load all cached state from members, re-fetch queue heads, and re-validate `[[state]]`"*.
  The one state check in §4.3 (step 1) is *before* the user call.
- **Why it fails**: a debug assertion / permanently-pinned unsettleable read request reachable
  from trivial user JS, plus a stale `m_pendingRead` (a settled promise occupying the "the one
  pending read" slot) that every later `onFlush`/`onClose` step keys decisions off.
- **Proposed fix (minimal)**: in §4.6, "reject **and clear** `m_pendingRead`" (matching
  RSI:1141). In §4.3, insert between steps 6 and 7: *"re-check `m_stream` and
  `m_stream->m_state == Readable`; if not, return `m_pendingRead` if the error path armed one,
  else a promise rejected/resolved per the state"* — i.e. the §7.2 re-validation, stated
  explicitly so the `.cpp` author cannot hoist it.

---

### [SEVERITY: MINOR] `JSBoundFunction` PREPENDS its bound args; §4.1's `performPromiseThenWithContext` APPENDS the context — the design's "bind a **shared §4.1 handler**" wording produces handlers reading the wrong argument

- **Design claim** (§2.2): *"Use a `JSC::JSBoundFunction` binding a **shared per-global native
  handler (on `JSStreamsRuntime`, ARCHITECTURE §4.1)** with `boundArgs = [adapterCell]`."*
  (Same wording in §5.2 step 2 and §5.4.)
- **Evidence**: `JSBoundFunction.cpp` `boundFunctionCall` (lines 53-58/86-91) appends
  `m_boundArgs` **then** the call-site arguments — a call `handle.onDrain(chunk)` reaches the
  target as `target(adapterCell, chunk)` with the context at `argument(0)`. ARCHITECTURE §4.1's
  contract for its shared handlers is `handler(resolutionValue, contextCell)` — context at
  `argument(1)`, body `jsDynamicCast<JSXxx*>(callFrame->uncheckedArgument(1))`. The same
  function object cannot serve both.
- **Why it fails**: a §4.1 handler reused as a bound target `jsDynamicCast`s the *payload*
  (a chunk / `undefined`) as the context → null → silent no-op (`onDrain` drops chunks,
  `onClose` never closes), or for a 0-arg `onClose()` call reads `argument(1) === undefined`.
  Not memory-unsafe, but a guaranteed logic failure baked into the frozen wording.
- **Proposed fix (minimal)**: in §2.2, replace "a shared per-global native handler
  (… ARCHITECTURE §4.1)" with "a shared per-global native `JSFunction` on `JSStreamsRuntime`
  using the **bound-callable convention: context = `argument(0)`, payload(s) follow**"; state
  that `JSStreamsRuntime` owns TWO closed handler lists (reaction-convention, bound-convention)
  and a handler belongs to exactly one.

---

### [SEVERITY: MINOR] Three new cell classes are specified without the `DECLARE_VISIT_CHILDREN` / iso-subspace statement ARCHITECTURE §3.2 calls "the #1 reviewer check"

- **Design claim**: §5.2 step 2 `JSDirectSinkCloseState` *"`{WriteBarrier<JSObject>
  m_underlyingSource, WriteBarrier<JSPromise> m_closePromise}`"*; §5.3
  `JSReadStreamIntoSinkOperation { m_stream, m_reader, m_sink, m_result(JSPromise), … }`; §5.4
  `JSResumableSinkPumpOperation { m_stream, m_sink, m_reader, m_error(WB<Unknown>), … }`.
- **Evidence**: unlike §1, §2.2, and §4.1 (which each end with "all N barriers
  visited"/`DECLARE_VISIT_CHILDREN`), none of these three states that its barriers are visited,
  names its base/destructibility, or claims an iso subspace. ARCHITECTURE §3.2: *"**Every**
  WriteBarrier member appears in `visitChildrenImpl` … This is the #1 reviewer check."* Phase A
  freezes headers generated from this text.
- **Why it fails**: an unvisited `WriteBarrier<JSPromise> m_closePromise` on
  `JSDirectSinkCloseState` is a premature collection of the very promise §5.2 step 9 hands to
  Rust as the operation's result (resolved only from `readDirectStreamOnClose`, whose sole path
  to it is this member). The rule exists so this cannot be left implicit.
- **Proposed fix (minimal)**: append to each of the three cells: base class
  (`JSC::JSNonFinalObject`), `DECLARE_VISIT_CHILDREN` visiting every listed barrier, one iso
  subspace each, non-destructible (none owns a WTF container).

---

## Verdict

The generated JSSink cells are SAFE as used (`m_onPull`/`m_onClose` are `WriteBarrier`s visited
by the generated `visitChildrenImpl`, `generate-jssink.ts:172-173, 858-866` — the design adds no
new stored value to them), no `Strong`/`protect`/`ensureStillAlive`/capturing-`JSNativeStdFunction`
is introduced anywhere, and no JS-property state is smuggled back in. The three real defects are
(1) a non-total dispatch over the newly-erased `[[controller]]` slot that lets the spec core
type-confuse a `Direct`/`NativeSink` controller, (2) two liveness arguments that repeat the exact
mistakes ARCHITECTURE §2.2-analog/§6.1 already litigated (an externally-rooted handle now strongly
reaching the whole consumer graph; pump cells rooted only by whichever reaction happens to be
pending), and (3) a §7.2 re-validation the direct pump skips.

**JSBoundFunction mechanism: ACCEPT**, with the argument-convention fix above. Proposed
ARCHITECTURE §4.1 blessing paragraph:

> **Bound callables (Bun layer only).** Where a callable must be *stored on and later invoked by
> an object we do not control* (the Rust native-source handle's `onClose`/`onDrain`, the JSSink
> controller's `start(onPull, onClose)`, the ResumableSink's `setHandlers`), a per-reaction
> closure is still banned; the ONE sanctioned form is `JSC::JSBoundFunction::create(vm, global,
> sharedHandler, jsUndefined(), ArgList{contextCell}, …)` binding a **shared, stateless,
> per-global native `JSFunction` owned by `JSStreamsRuntime`** to exactly one context cell.
> Verified against `runtime/JSBoundFunction.h`: `m_boundThis` and the (≤3 embedded) `m_boundArgs`
> are `WriteBarrier<Unknown>` and are appended by `JSBoundFunction::visitChildrenImpl`, so the
> context is GC-reachable from whatever roots the callable — this is why it satisfies the intent
> of the `JSNativeStdFunction` ban (nothing lives outside the GC's view). Cost: one 96-byte cell
> in JSC's existing `boundFunctionSpace`, name/length materialized lazily; it is already used
> from Bun's bindings (`JSCommonJSModule.cpp:129`). **Convention:** `boundFunctionCall` PREPENDS
> the bound args, so a bound-callable handler receives `(contextCell, ...callArgs)` — the
> opposite order from `performPromiseThenWithContext`'s `(resolution, contextCell)`; the two
> handler families are disjoint closed lists on `JSStreamsRuntime` and must never be shared.
> Every other callable in the subsystem remains a §4.1 shared reaction handler; anything else
> (a fresh `JSFunction` per stream, any capturing `JSNativeStdFunction`) stays FORBIDDEN.
