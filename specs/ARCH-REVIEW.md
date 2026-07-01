# Adversarial review of `specs/ARCHITECTURE.md`

Reviewer role: break the design before ~60 `.cpp` files are built on it. Every finding below is
something a maintainer would have to change; none are stylistic. Evidence is cited from the four
digests (ground truth) and from the real vendored JSC headers where an API claim is made.

Findings are ordered CRITICAL → MAJOR → MINOR.

---

### [SEVERITY: CRITICAL] §5's `virtual` methods on a `JSCell` subclass are impossible in JSC — this is memory corruption, not a style problem

- **Claim under attack**: §5:
  `class JSReadRequest : public JSC::JSInternalFieldObjectImpl<0> /* or JSNonFinalObject */ { public: virtual void chunkSteps(JSC::JSGlobalObject*, JSC::JSValue chunk) = 0; virtual void closeSteps(...) = 0; virtual void errorSteps(...) = 0; ... }`
  and “Because they are C++-virtual, they need per-subclass `ClassInfo` and iso subspaces.”
- **Spec evidence**: n/a — this is a JSC ABI fact, not a spec fact. Verified against the vendored
  engine: `/root/oven-webkit/Source/JavaScriptCore/runtime/JSDestructibleObject.h` has **no virtual
  destructor and no virtual functions** (it stores `const ClassInfo* m_classInfo` precisely so the
  sweeper can find the static `MethodTable::destroy` without a vtable). A grep of every header in
  `JavaScriptCore/runtime/` shows **zero** `JSCell` subclasses with a `virtual` member — the only
  polymorphic classes there (`VM.h`, `ConsoleClient.h`, `JSRunLoopTimer.h`, …) are non-GC C++
  objects. There is also no `static_assert(!is_polymorphic)` guard anywhere in `heap/`/`runtime/`,
  so this compiles and fails at runtime.
- **Why it fails**: a `JSCell` must have the cell header (`m_structureID`, `m_type`, `m_cellState`,
  the `JSCellLock` byte) at **offset 0 of the GC allocation**. Introducing the first `virtual`
  function on a class whose primary base (`JSNonFinalObject`) is non-polymorphic makes the Itanium
  ABI place the **vptr at offset 0** and the entire `JSCell` subobject at offset +8. The GC
  allocates atoms at the block-aligned address, but every `JSValue`/`WriteBarrier`/`visitChildren`
  then carries `addr+8` as “the cell”: `MarkedBlock::atomNumber(cell)` mis-rounds, `cellLock()`
  (`reinterpret_cast<JSCellLock*>(this)`, `JSCell.h:152`) locks the wrong byte, marking and
  isLive checks are off by one atom. Silent heap corruption on the very first `reader.read()`.
  (Secondary: `JSInternalFieldObjectImpl<0>` instantiates a zero-length
  `m_internalFields[0]` array — also not a thing to build 5 subclasses on.)
- **Proposed fix**: keep the “read request is a C++ object, not 3 promises” idea, drop C++
  `virtual`. Use the exact same device §4 already uses for algorithms: a
  `enum class ReadRequestKind : uint8_t { Promise, PipeTo, Tee, AsyncIterator, ToText, ... }`
  member on a **single, non-polymorphic** `JSReadRequest` cell, with
  `void chunkSteps(...)` being a `switch (m_kind)` over free functions (or, if separate cell
  classes are wanted for their `visitChildren`, dispatch through
  `classInfo()->isSubClassOf(...)` / `jsDynamicCast` — never a C++ vtable). Same for
  `JSReadIntoRequest`. State this in §5 with the same force §4 uses for “no closures”.

---

### [SEVERITY: CRITICAL] The Transform default source/sink algorithms don’t exist in §4’s `SourceKind`, and `SinkKind` is never enumerated — a `TransformStream` cannot be built from this document

- **Claim under attack**: §4:
  `enum class SourceKind : uint8_t { JavaScript, Native, Direct, TeeBranch, FromIterable, CrossRealm, Nothing /*empty stream*/, /* TBD(bun-ext) */ };`
  and “Same design for the writable controller (`SinkKind` + `m_underlyingSink` + method
  WriteBarriers)” — `SinkKind`’s variants are never listed anywhere in the document.
- **Spec evidence**: digest 04, `InitializeTransformStream` steps 2–8: the writable side is
  `CreateWritableStream(startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, …)` where
  the three sink algorithms are `TransformStreamDefaultSink{Write,Close,Abort}Algorithm(stream, …)`
  — native algorithms **closing over `stream`, the TransformStream**. The readable side is
  `CreateReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm, readableHighWaterMark, …)`
  with `TransformStreamDefaultSource{Pull,Cancel}Algorithm(stream, …)`. Also step 1:
  `startAlgorithm` for **both** sides is “an algorithm that returns `startPromise`” — an
  externally-created, still-**pending** promise that the `TransformStream` constructor resolves
  later (digest 04, constructor steps 9, 12–13).
- **Why it fails**: three independent unimplementabilities.
  1. There is no `SourceKind::Transform` (nor `SinkKind::Transform`, nor a `SinkKind` at all).
     `runPullAlgorithm`’s `switch (m_sourceKind)` has no arm that can express
     `TransformStreamDefaultSourcePullAlgorithm`.
  2. Even with the arm added, the algorithm needs a back-pointer to the `JSTransformStream`
     (`stream.[[backpressure]]`, `stream.[[backpressureChangePromise]]`, `stream.[[controller]]`,
     `stream.[[writable]]`). §4’s controller layout has exactly three WriteBarriers
     (`m_underlyingSource`, `m_pullMethod`, `m_cancelMethod`) and nowhere to put a
     `WriteBarrier<JSTransformStream>` on the readable’s controller or the writable’s controller.
     `new TransformStream()` — the headline “61 objects → 7 cells” number in §0 — is exactly this
     case.
  3. `[[startAlgorithm]]` for the transform’s two inner streams is **not** the trivial algorithm and
     is **not** a user method: it must return a specific pre-existing `startPromise`. §4 only
     defines two representations of start (“invoke the user `start` method once” or “null ⇒
     trivial”), and the internal `CreateReadableStream`/`CreateWritableStream` C++ signatures are
     never specified, so a `.cpp` writer has no sanctioned way to pass a start *result value*
     through set-up. (§4’s “`[[startAlgorithm]]` … never stored. Do not add a `m_startMethod`” is
     still satisfiable — start never needs re-invoking anywhere in the digests, I checked every
     `SetUp*` — but only if the internal creation API takes `JSValue startResult`.)
- **Proposed fix**: (a) add `Transform` to `SourceKind` and enumerate `SinkKind` explicitly:
  `{ JavaScript, Transform, CrossRealm, Nothing /*, TBD(bun-ext) */ }`. (b) State that each
  non-`JavaScript` kind gets a **kind-payload WriteBarrier slot** on the controller (a single
  `WriteBarrier<JSC::JSCell> m_sourceState` is enough: `JSTransformStream*` for `Transform`,
  `JSStreamTeeState*` for `TeeBranch`, an iterator-record cell for `FromIterable`, the port
  wrapper for `CrossRealm`) and that it is visited. (c) Declare the internal creation signature in
  `WebStreamsInternals.h` as
  `CreateReadableStream(global, SourceKind, JSValue sourceState, JSValue startResult, double hwm, JSObject* sizeAlg)`
  (mirrored for writable) so all six internal callers (default tee ×2, byte tee ×2,
  from-iterable, cross-realm, transform ×2) are expressible.

---

### [SEVERITY: CRITICAL] “No closures, ever” is unsatisfiable: the spec needs ~20 *promise reactions* carrying GC-visited native context, and the document never says how

- **Claim under attack**: §4 heading “Algorithms: no closures, ever” + “**We store none of them**”
  + §7.6 “No `JSC::Strong`, no `protect()` … anywhere in this subsystem”.
- **Spec evidence**: §4 only eliminates the *stored* `[[xxxAlgorithm]]` slots. It says nothing
  about the spec’s other, more numerous closure family: **“Upon fulfillment of P …”** where `P`
  is a promise (often a *user-returned* one) and the reaction body captures internal state. A
  non-exhaustive list from the digests:
  `ReadableStreamDefaultControllerCallPullIfNeeded` steps 7–8 (reaction captures `controller`; `pullPromise` is the *user’s* promise);
  `SetUpReadableStreamDefaultController` steps 11–12; the byte equivalents;
  `WritableStreamDefaultControllerProcessWrite` steps 4–5 (`sinkWritePromise`) and `ProcessClose`;
  `WritableStreamFinishErroring` steps 12–13 (`[[AbortSteps]]` result);
  `ReadableStreamCancel` step 8 (“reacting to sourceCancelPromise”);
  `ReadableStreamDefaultTee` step 19 (“Upon rejection of `reader.[[closedPromise]]`” capturing
  branch1/branch2/cancelPromise); `ReadableByteStreamTee`’s `forwardReaderError` (captures
  `thisReader` **per registration**); `ReadableStreamFromIterable` pull step 4 (reaction on
  `nextPromise` capturing `stream`); `TransformStreamDefaultSinkWriteAlgorithm` step 3.3
  (reaction on `backpressureChangePromise` capturing `stream` **and** `chunk`);
  `TransformStreamDefaultSink{Close,Abort}` / `SourceCancel` steps 7 (reactions capturing
  `controller` + `readable`/`writable`); `TransformStreamDefaultControllerPerformTransform`
  step 2; the whole of `ReadableStreamPipeTo`; `SetUpCrossRealmTransformWritable` write step 2.
- **Why it fails**: every one of these must become a native fulfillment/rejection handler
  **plus a GC-visited edge to the captured cell(s)**. The document forbids the two easy answers
  (a stored bound `JSFunction` = a closure; a `JSC::Strong` in a native lambda = banned) and names
  no third. The in-tree pattern the writers *will* reach for —
  `JSC::JSNativeStdFunction::create` with a C++ lambda capturing `controller` (used in
  `ModuleLoader.cpp`, `napi.cpp`) — is a **GC hole**: `JSNativeStdFunction`’s lambda captures are
  not visited, so a raw `JSFoo*` capture is a use-after-free and a `Strong` capture is banned.
  With 60 files written in parallel against frozen headers, each author invents their own
  mechanism; several will be wrong; this is the single largest defect surface in the plan.
  This also silently falsifies §0’s object-count table: `new ReadableStream({pull})` needs at
  least the start-fulfillment reaction and (per pull) a pull-promise reaction, so “2 cells” is
  not the steady-state allocation count unless the reaction is closure-free.
- **Proposed fix**: mandate ONE mechanism in a new §4.1 and put it in `WebStreamsInternals.h`.
  The engine already has exactly the right primitives (verified in
  `/root/oven-webkit/Source/JavaScriptCore/runtime/JSPromise.h:139–152`):
  `JSPromise::performPromiseThenWithContext(VM&, JSGlobalObject*, onFulfilled, onRejected, JSValue, JSValue context)`
  and, better, `performPromiseThenWithInternalMicrotask(VM&, JSGlobalObject*, InternalMicrotask, JSValue promise, JSValue context)`
  — the reaction’s `context` is a JSValue stored on the (GC-visited) reaction, and Bun’s fork
  already extends the `InternalMicrotask` enum (`BunPerformMicrotaskJob`,
  `BunInvokeJobWithArguments`). So: one **non-capturing** native `JSFunction` per reaction kind,
  cached lazily on the global (or one new `InternalMicrotask` value per kind), with the owning
  cell (`controller` / `pipeOp` / `teeState`) passed as `context`; when two values are needed
  (transform sink write: `{stream, chunk}`; byte-tee `forwardReaderError`:
  `{teeState, thisReader}`) the context is a 2-field internal cell. Zero closures, zero
  Strong, GC-correct, and it makes §0’s numbers true. Freeze this helper’s signature in Phase A.

---

### [SEVERITY: CRITICAL] The PipeTo liveness argument is wrong: the returned promise roots nothing, and the whole destination half is an unrooted cycle while work is pending

- **Claim under attack**: §6: “created by `readable.pipeTo()` and rooted by (a) the promise it
  returns and (b) the read/write reactions in flight.”
- **Spec evidence**: digest 02, `ReadableStreamPipeTo` steps 13–15. Claim (a): a `JSPromise` holds
  its **reactions** (handlers registered by whoever consumed it); it holds no reference to the
  code that will *settle* it. If the caller drops the return value (`rs.pipeTo(ws);` — the common
  case, and the mandatory case for `pipeThrough`, whose promise is only `markAsHandled`), the
  returned promise is itself garbage and roots nothing. So the pipe’s liveness rests entirely on
  (b). Now enumerate the pipe’s idle states: (i) awaiting `currentWrite` (a write promise the pipe
  created via `WritableStreamDefaultWriterWrite` → `WritableStreamAddWriteRequest`, digest 03) —
  no read request is in the reader’s `[[readRequests]]`; (ii) awaiting `writer.[[readyPromise]]`
  under backpressure (“While `WritableStreamDefaultWriterGetDesiredSize(writer)` ≤ 0 … must not
  read”) — no read AND no write in flight.
- **Why it fails**: take `let ctl; const rs = new ReadableStream({start(c){ctl=c}}); rs.pipeTo(new WritableStream({write(){…}}))`
  with the return promise dropped and `setInterval(() => ctl.enqueue(x))` keeping the *source*
  alive. In idle state (i)/(ii) the edges into the pipe op are only:
  `currentWrite`’s reaction → `pipeOp`; `currentWrite` ∈ `dest.[[inFlightWriteRequest]]` /
  `dest.[[writeRequests]]`; `dest` ← `writer.[[stream]]` ← `writer` ← `pipeOp.m_writer`. That is a
  **cycle** (`pipeOp → writer → dest → writePromise → reaction → pipeOp`) reachable from **no GC
  root**: the source’s reader (`rs.[[reader]]`) does not point at the pipe op, and nothing else on
  the alive side does. JSC collects unreachable cycles regardless of “pending work”. Result: the
  pipe op, the writer, `dest`, and the user’s sink are collected mid-pipe; the pipe silently stops;
  the sink’s `write`/`close` never fire again. The mirror case (native sink roots `dest`, JS pull
  source only reachable via the pipe) drops the *source* half. §7.6 explicitly bans the escape
  hatches (`Strong`, `hasPendingActivity` isn’t mentioned), so §6’s liveness argument, presented
  as the reviewed “proof”, is false and every `.cpp` writer will trust it.
  **Compounding UAF**: the abort listener. §6 mandates the “existing `WebCore::AbortSignal` C++
  listener API (`addAlgorithm`)”. That is (verified) `AbortSignal::addAlgorithm(Function<void(JSValue)>&&)`
  (`src/jsc/bindings/webcore/AbortSignal.h:112–114`) storing into `m_algorithms`, which — unlike
  the *separate* `m_abortAlgorithms`/`visitAbortAlgorithms` list — is **not GC-visited**. The only
  thing the algorithm can capture is a raw `JSStreamPipeToOperation*`. Combine with the cycle
  above: the pipe op is collected while its abort algorithm is still registered on a user-held
  `AbortSignal`; the user calls `controller.abort()`; the algorithm dereferences freed memory.
  A concrete, user-triggerable use-after-free designed into §6.
- **Proposed fix**: give the pipe op real owners. Minimal, Strong-free, and complete:
  the pipe’s **reader** and **writer** each get a `WriteBarrier<JSStreamPipeToOperation> m_pipeOperation`
  (set in `ReadableStreamPipeTo` steps 8–10, cleared in “finalize” step 1–3, both visited). Then
  the op is alive whenever *either* end is externally reachable, and if neither end is reachable
  nothing about the pipe is observable, so collecting it is correct. Delete claim (a). For the
  signal: the pipe op holds `WriteBarrier<JSAbortSignal> m_signal`; the registered algorithm must
  be routed through a GC-visited registration (the `AbortAlgorithm`/`visitAbortAlgorithms` path,
  or a new visited variant of `addAlgorithm` taking a `JSCell*` context) — never a raw pointer in
  `m_algorithms`. State in §6 that `removeAlgorithm` in finalize is a *correctness* requirement
  (a never-aborted long-lived signal must not root a completed pipe) and add it to the Phase-A
  GC-lens checklist.

---

### [SEVERITY: CRITICAL] `SetUpCrossRealmTransform{Readable,Writable}` has no design: the only thing keeping the stream working is a MessagePort event handler, and the document gives it no representation, no rooting, and no `SourceKind` payload

- **Claim under attack**: §1’s file table row — “`CrossRealmTransform.{h,cpp}` |
  `postMessage`/`structuredClone` transfer: `SetUpCrossRealmTransformReadable/Writable`, …” — is
  the **entire** design for cross-realm streams; §4 contributes only the bare enumerator
  `CrossRealm` and the sentence “additional `SourceKind` arms with native pull/cancel bodies — no
  JS at all.”
- **Spec evidence**: digest 04, `SetUpCrossRealmTransformReadable` steps 3–5: “**Add a handler for
  port’s `message` event**” whose body calls `ReadableStreamDefaultControllerEnqueue(controller, …)`
  / `Close` / `Error`, plus a `messageerror` handler, plus “Enable port’s port message queue.”
  Steps 7–8: the pull/cancel algorithms need `port`. `SetUpCrossRealmTransformWritable` is worse:
  its `writeAlgorithm` additionally closes over a **mutable local** `backpressurePromise` that is
  reassigned by the `message` handler (steps 4.6, 8.1–8.2.1) — mutable state shared between an
  event listener and the sink algorithm, living in neither the controller nor the stream per spec.
  Digest 01 “Transfer-receiving steps” and digest 03’s are the entry points that run in the
  destination realm during `structuredClone`/`postMessage` deserialization; neither appears in
  §1’s ownership map nor in `WebStreamsExports.cpp`’s remit.
- **Why it fails**: four holes. (1) *Rooting*: after transfer the receiving realm’s stream is
  handed to user code, but the **port → handler → controller** edge is the one that matters: the
  entangled port outlives everything and delivers messages later. If the handler is a native
  listener holding a raw `JSReadableStreamDefaultController*`, that is a UAF the moment the user
  drops the stream; if it holds a `Strong`, §7.6 bans it; a JS `EventListener` function object
  holding a WriteBarrier is a closure §4 bans. No compliant implementation exists as specified.
  (2) *State*: `SourceKind::CrossRealm`’s pull/cancel need `port`; `SinkKind::CrossRealm`’s
  write/close/abort need `port` **and** the mutable `backpressurePromise`. §4’s controller layout
  has no slot for either (see the Transform finding — same root cause: no per-kind payload).
  (3) *Reentrancy*: nothing in §7.2 lists “a MessagePort message is delivered” or
  “`PackAndPostMessage`/port disentangle” as running user JS, yet the readable handler calls
  `ControllerEnqueue` which calls the *strategy size* algorithm… no — cross-realm uses
  `sizeAlgorithm = 1`; but `Enqueue` → `FulfillReadRequest` → arbitrary read-request steps. The
  digest’s own warning (“the input might come from an untrusted context … could lead to security
  issues”) has no counterpart in §7/§8. (4) *Entry points*: the transfer-receiving steps and the
  `dataHolder` plumbing are declared in no file.
- **Proposed fix**: give `CrossRealmTransform.{h,cpp}` a real §, before freeze:
  a `JSCrossRealmTransformState` internal cell (like `JSStreamTeeState`) holding
  `WriteBarrier<JSMessagePort-wrapper> m_port`, `WriteBarrier<JSPromise> m_backpressurePromise`,
  and a back-pointer to the controller; the port’s message handler is registered through the
  event-target machinery with a **JS-heap listener object** whose `visitChildren` reaches that
  state cell (explicitly carve this out of §4’s “no closures” — it is one cell, allocated once,
  per transferred stream — or root the controller from the port wrapper’s
  `visitAdditionalChildren`). Enumerate the transfer / transfer-receiving hooks in §1 and add
  “message delivery, `PackAndPostMessage`, port disentangle” to §7.2.

---

### [SEVERITY: MAJOR] §6’s `JSStreamTeeState` is missing its two most load-bearing members: the original `stream` and the (mutable!) `reader`

- **Claim under attack**: §6: “one internal cell `JSStreamTeeState` per tee holding
  `{reading, readAgain(ForBranch1/2), canceled1, canceled2, reason1, reason2, branch1, branch2, cancelPromise}`”.
- **Spec evidence**: digest 02, `ReadableStreamDefaultTee`: step 13.4
  `ReadableStreamDefaultReaderRead(reader, readRequest)` — every pull needs **`reader`**;
  steps 14.3.2 / 15.3.2 `ReadableStreamCancel(stream, compositeReason)` — every cancel needs the
  **original `stream`** (not reachable from a branch: `branchN.[[controller]].[[stream]]` is the
  branch). `ReadableByteStreamTee` steps 15.1.2–15.1.4 and 16.1.2–16.1.4: the tee **releases the
  current reader and acquires a new one of the other kind, repeatedly**, and re-runs
  `forwardReaderError(thisReader)` each time with the identity check “If thisReader is not
  reader, return” (step 14.1.1) — so `reader` is a *mutable* slot AND each closed-promise
  rejection reaction must additionally carry the specific `thisReader` it was registered for.
- **Why it fails**: with the listed members, `pullAlgorithm` and `cancelNAlgorithm` are literally
  unwritable — a Phase-B author must either invent an unfrozen field (forbidden: “it STOPS and
  reports”) or fish `stream` out of `reader.[[stream]]` (which the byte tee sets to `undefined`
  mid-flight during the release/reacquire dance, so that’s wrong). The per-registration
  `thisReader` capture is another instance of the reaction-context finding above.
- **Proposed fix**: add `WriteBarrier<JSReadableStream> m_stream` and
  `WriteBarrier<JSCell> m_reader` (mutable; default or BYOB) to `JSStreamTeeState`, both visited.
  Specify that the byte tee’s `forwardReaderError` reaction context is `{teeState, thisReader}`.

---

### [SEVERITY: MAJOR] The async-iterator object is a 14th public class the architecture has no home for

- **Claim under attack**: §1 “The 13 public classes …” (exhaustive table + shared-file table);
  §5 lists only a `JSAsyncIteratorReadRequest`.
- **Spec evidence**: digest 01, “Asynchronous iteration (`values()` / `[Symbol.asyncIterator]`)”:
  Web IDL `async_iterable<any>(optional ReadableStreamIteratorOptions)` defines a distinct
  platform object — `%ReadableStreamAsyncIteratorPrototype%` with `next()`/`return()` — holding
  per-iterator state: its **reader**, **prevent cancel**, and (from the Web IDL async-iterator
  machinery the digest’s hooks plug into) an **ongoing promise** used to serialize `next()`
  calls and an **is-finished** flag; “Asynchronous iterator return” step 3 even asserts
  “`reader.[[readRequests]]` is empty, as the async iterator machinery guarantees that any
  previous calls to `next()` have settled before this is called” — a guarantee only the
  ongoing-promise chaining provides.
- **Why it fails**: `JSAsyncIteratorReadRequest` is the *read request*, not the *iterator*. There
  is no class, no file, no prototype registration, and no owner for the ongoing-promise chaining
  logic. A read-request cell cannot be returned from `stream.values()`. Whoever writes
  `JSReadableStream.cpp` must invent a whole extra GC class outside the frozen headers.
- **Proposed fix**: add class #14, `JSReadableStreamAsyncIterator.{h,cpp}` (members:
  `WriteBarrier<JSReadableStreamDefaultReader> m_reader`, `WriteBarrier<JSPromise> m_ongoingPromise`,
  `bool m_preventCancel`, `bool m_isFinished`), its prototype, and the `next`/`return` chaining
  algorithm, to §1 before the headers freeze.

---

### [SEVERITY: MAJOR] §5’s “`pipeTo` of N chunks allocates O(1) promises” contradicts digest 03, and the architecture never designs the writable-side request abstraction it would need

- **Claim under attack**: §5: “Same idea on the writable side … we keep the *write request*
  promise chain internal … `pipeTo(a → b)` of N chunks allocates **O(1) promises**, not O(N)”.
- **Spec evidence**: digest 03, `WritableStreamDefaultWriterWrite` step “Let promise be
  ! `WritableStreamAddWriteRequest(stream)`” → “Let promise be a **new promise**. Append promise
  to `stream.[[writeRequests]]`.” — one fresh `JSPromise` per chunk, by construction.
  `[[writeRequests]]` is defined as “a list of **promises**”; `WritableStreamFinishInFlightWrite{,WithError}`
  and `WritableStreamFinishErroring` step 5 settle them individually; the pipe’s “Shutdown” must
  “wait until every chunk that has been read has been written (i.e. the corresponding **promises**
  have settled)”. §5 itself concedes the write’s “returned promise is required by the pipe’s
  backpressure logic.”
- **Why it fails**: the ownership rule (§1) sends `WritableStreamDefaultWriterWrite` and
  `WritableStreamAddWriteRequest` to authors who are told the digest is ground truth; those ops
  allocate a promise per chunk. So either the headline perf claim is false, or the writable side
  needs a `JSWriteRequest` vtable-style abstraction (the read-side §5 device mirrored) that is
  nowhere in the document — a spec-shape change touching `[[writeRequests]]`,
  `FinishInFlightWrite*`, `FinishErroring`, and `MarkFirstWriteRequestInFlight`. There is also a
  correctness edge: `WritableStreamFinishErroring` rejects **every** queued write promise; the
  spec’s reference pipe reacts to (i.e. handles) each one, but §5’s O(1) pipe reacts only to
  `currentWrite`, so an erroring dest emits an unhandled-rejection per unhandled queued write —
  exactly the §7.5 failure mode the document warns about.
- **Proposed fix**: pick one and write it down. Either (a) drop the O(1) claim (a `JSPromise`
  per `writer.write()` is cheap and spec-shaped; the real win — no `{value,done}` result objects,
  no read promises — stands), or (b) design `JSWriteRequest` explicitly: `[[writeRequests]]`
  becomes a deque of request cells with `resolveSteps/rejectSteps`, `JSPromiseWriteRequest` for
  the public `writer.write()`, `JSPipeToWriteRequest` for the pipe, and updated bodies for the
  five ops above; plus `markAsHandled` semantics for the pipe’s per-chunk failures.

---

### [SEVERITY: MAJOR] §7 gives no sanctioned way to *catch* a user exception, yet the digests require it at ≥6 sites; “RETURN_IF_EXCEPTION after every call” is the wrong instruction there

- **Claim under attack**: §7.1: “After EVERY call that can (a) allocate, (b) run user JS, or
  (c) is a spec `?` op: `RETURN_IF_EXCEPTION(scope, ...)`.” — presented as the complete
  exception-handling rule.
- **Spec evidence**: the spec repeatedly *interprets a user call’s result as a completion record*
  and continues:
  digest 02 `ReadableStreamDefaultControllerEnqueue` steps 4.1–4.5 (an abrupt `size()` errors the
  stream, then **re-throws that same value**);
  digest 03 `WritableStreamDefaultControllerGetChunkSize` steps 2–3 (an abrupt `size()` is
  **swallowed** — error-if-needed then `return 1`);
  digest 04 `TransformStreamDefaultControllerEnqueue` step 5 (abrupt enqueue → error the writable →
  **throw a *different* value**, `readable.[[storedError]]`);
  digest 02 `ReadableByteStreamController.[[PullSteps]]` step 4.2 (`Construct(%ArrayBuffer%)`
  abrupt → route to `readRequest`’s error steps, **do not propagate**);
  `ReadableStreamFromIterable` pull/cancel steps 4.2, 5.3, 5.6 (abrupt `IteratorNext`/`GetMethod`/
  `Call` → convert to a **rejected promise**, do not throw);
  `ReadableByteStreamControllerEnqueueClonedChunkToQueue` step 2;
  and every `startAlgorithm` invocation (“This might throw” — `CreateReadableStream` “throws
  if and only if the supplied startAlgorithm throws”, while `SetUpWritableStreamDefaultController`’s
  start uses exception behavior “rethrow”).
- **Why it fails**: at those sites the *correct* code is “observe `scope.exception()`, take its
  value, `clearException()`, and follow the spec’s recovery path” — the one thing `RETURN_IF_EXCEPTION`
  cannot express, and the one thing this repo’s reviewers reflexively reject (“never
  `clearException()`”). Sixty parallel authors will produce a mix of: propagating where the spec
  swallows (wrong observable behavior + WPT failures), swallowing where the spec propagates, and
  hand-rolled `CatchScope`s in inconsistent shapes. This is the highest-frequency correctness
  decision in the whole port and the document is silent on it.
- **Proposed fix**: add §7.1a: “The spec phrase ‘interpreting the result as a completion record’
  (and ‘If X is an abrupt completion’) is the ONLY place an exception may be caught. Pattern:
  `auto catchScope = DECLARE_CATCH_SCOPE(vm); JSValue r = <call>; if (auto* ex = catchScope.exception()) { JSValue v = ex->value(); catchScope.clearException(); <spec recovery path> }`
  — never elsewhere, and never for a `TerminationException`
  (`vm.hasPendingTerminationException()` must be re-checked / propagated).” Enumerate the exact
  sites (the six families above) in the header comments so Phase-B authors don’t have to decide.

---

### [SEVERITY: MAJOR] §7.2’s “these operations run user JS” list is incomplete, and §7.4 is false as stated

- **Claim under attack**: §7.2’s four-bullet enumeration, and §7.4: “Resolving/rejecting the
  promises WE created … does **not** run user JS synchronously — reactions are microtasks.”
- **Spec evidence**: (a) digest 03 `WritableStreamAbort` step 2 “Signal abort on
  `stream.[[controller]].[[abortController]]` with reason”, immediately followed by the spec’s
  own note: “**We re-check the state because signaling abort runs author code**.” Signaling abort
  dispatches the `abort` event and runs abort algorithms on `controller.signal` — arbitrary user
  JS from deep inside `WritableStreamAbort`. It is in none of §7.2’s bullets, and it is the *only*
  place in all four digests where the spec spells out its reentrancy re-check in prose; an author
  applying §7.2 mechanically will not treat it as a user-JS boundary. (b) Invoking a read
  request’s / read-into request’s steps: §5 says they “may run arbitrary user JS”, §7.2 omits
  them. (c) §7.4: JSC’s promise *resolution* (not settlement of already-resolved state) performs
  `Get(value, "then")` **synchronously** when `value` is an object — a user getter/Proxy trap.
  Concrete digest site: the async-iterator read request’s chunk steps, “Resolve promise with
  **chunk**” (digest 01) — a raw user chunk; `{ get then() { reader.releaseLock(); } }` runs user
  JS inside `ReadableStreamFulfillReadRequest`. §7.2 bullet 2 gets this right for
  `resolvedPromise(v)`; §7.4 then contradicts it with a blanket exemption. Contradictory rules in
  a “non-negotiable” section means both get cited to justify opposite code.
- **Why it fails**: an op annotated “cannot run user JS” by a Phase-A reviewer using §7.2 as the
  checklist (that is literally lens 3’s job description in §9) will then hold cached queue heads /
  state across `WritableStreamAbort` step 2 or across resolving a promise with a user value —
  the exact UAF/stale-state class §7 exists to prevent.
- **Proposed fix**: §7.2 additions: “signaling abort on any `AbortController` / firing any
  event”, “invoking any read-request / read-into-request / write-request steps”, “resolving ANY
  promise with a value that is or contains a user-controlled object (JSC reads `.then`
  synchronously)”, and (from the cross-realm finding) “`PackAndPostMessage` / port message
  delivery”. Rewrite §7.4 to: “settling one of our promises with a value **we constructed**
  (undefined, a fresh result object) is not a user-JS point; settling it with a user value is —
  see §7.2.”

---

### [SEVERITY: MINOR] §3.3 conflates `[[writeRequests]]` with the read-request deques

- **Claim under attack**: §3.3: “`[[readRequests]]` … / `[[readIntoRequests]]` … /
  `[[writeRequests]]` (writable stream): `WTF::Deque<WriteBarrier<JSReadRequest>>` (etc.)”.
- **Spec evidence**: digest 03: `[[writeRequests]]` is “A list of **promises**”;
  `WritableStreamAddWriteRequest` appends a fresh promise; `WritableStreamMarkFirstWriteRequestInFlight`
  moves one into `[[inFlightWriteRequest]]` (a `WriteBarrier<JSPromise>` per §3.2).
- **Why it fails**: “(etc.)” is the only word covering it, and it points at the wrong element type;
  §1’s table 7 then says `JSWritableStream` is destructible because it “owns `[[writeRequests]]`
  deque”, so the wrong type lands in a frozen header. It also collides head-on with the
  O(1)-promise finding above — whichever way that is resolved determines this deque’s type.
- **Proposed fix**: spell it out: `WTF::Deque<WriteBarrier<JSC::JSPromise>>` (or
  `<JSWriteRequest>` if option (b) of that finding is taken), under the same cellLock discipline.

---

### [SEVERITY: MINOR] The `ReadableStreamGenericReader` mixin has no stated representation

- **Claim under attack**: §1/§3 map every “internal-slot table in `specs/digest/*`” to a class;
  digest 01 defines a third slot table (`ReadableStreamGenericReader`: `[[closedPromise]]`,
  `[[stream]]`) shared by both reader classes, plus the generic ops
  (`ReadableStreamReaderGenericInitialize/Cancel/Release`) that mutate them, and the architecture
  never says whether the two readers share a C++ base class or duplicate the members.
- **Why it fails**: two authors writing `JSReadableStreamDefaultReader.cpp` and
  `JSReadableStreamBYOBReader.cpp` in parallel against frozen headers each need
  `ReadableStreamReaderGenericRelease` (which per §1’s ownership rule has *no* class-name prefix
  and lands in `ReadableStreamOperations.cpp`, written by a third author) to operate on “a
  reader” polymorphically — with C++ virtuals off the table (finding 1) and no stated base class,
  the free op has no type to take. Trivially resolvable, but it must be resolved in the headers,
  not improvised.
- **Proposed fix**: one sentence in §1: both readers derive from a non-polymorphic
  `JSReadableStreamReaderBase : JSC::JSNonFinalObject` holding `m_closedPromise` + `m_stream`
  (+ a `bool isBYOB` / distinct `JSType`), and the generic ops take `JSReadableStreamReaderBase*`.

---

## Verdict

**Not yet.** The load-bearing ideas — internal slots as C++ members, a kind-tag instead of stored
algorithm closures, read requests as native objects, PipeTo/Tee as internal cells — are the right
shape and worth building, but as written §5 is a memory-safety non-starter (virtual functions on a
JSCell), §4 cannot express `TransformStream` at all, and §6’s liveness proof is false (with a
concrete UAF through `AbortSignal::addAlgorithm`), so freezing headers from this document would bake
all three into 60 files. The single change I would insist on before Phase A: **specify the one
closure-free, GC-visited promise-reaction mechanism (`performPromiseThenWithContext` /
`performPromiseThenWithInternalMicrotask` + an owner-cell context) in `WebStreamsInternals.h`** —
every CRITICAL above except the vtable one is either caused by, or fixed by, having that primitive
pinned down.
