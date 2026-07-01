# HEADER-REVIEW-2 — GC & object-lifetime safety of the frozen `webcore/streams/` headers

Reviewer lens: GC / object-lifetime ONLY. All 32 headers read line-by-line. Every JSC-API
claim below was verified against the real headers at
`/root/.bun/build-cache/webkit-c9ad5813fd23bd8b-debug-asan/include/JavaScriptCore/`
(`JSDestructibleObject.h`, `LazyProperty.h`, `JSPromise.h`), against
`src/jsc/bindings/BunClientData.h:199` (the destructibility static_assert),
`src/jsc/bindings/webcore/JSDOMConstructorBase.h` (the subspace-sharing static_asserts),
`src/jsc/bindings/webcore/{AbortSignal.h,AbortSignal.cpp,JSAbortSignalCustom.cpp}` (the §6.1
abort-algorithm visit path), `src/jsc/bindings/WriteBarrierList.h` (the blessed cellLock
pattern), and `src/jsc/bindings/webcore/JSCookie.h` (the ratified class template).
`python3 specs/check-streams.py` is CLEAN.

Mechanical sweeps performed over all 32 files (results folded into the table):
- `grep -n virtual` → **zero** C++ `virtual` anywhere; no polymorphic non-JSC base
  (`JSDOMConstructorBase → InternalFunction`, `JSDestructibleObject` — both verified
  vtable-free in the real headers).
- `grep -n 'Strong|protect|gcProtect|ensureStillAlive'` → **zero** (comment mentions only).
- `grep -n 'JSC::Weak|Weak<'` → **exactly one** site, `BunStreamSource.h:59`
  (`JSNativeStreamSourceAdapter::m_controller`), which IS the §7.6-sanctioned site, IS
  destructible (`JSDestructibleObject` + `needsDestruction` + `static destroy` + private
  dtor), and whose visit comment correctly says the Weak MUST NOT be visited.
- `grep` for raw `JSCell*` / `JSValue` / impl-pointer **members** → **zero**. (The
  `WebStreamsInternals.h` dictionary structs hold raw `JSValue`s but are documented,
  stack-only, never-stored carriers — correct.)
- Every class holding a `WriteBarrier`, a `Weak`, or a barrier container declares
  `DECLARE_VISIT_CHILDREN`, and I diffed every class's visit-comment member list against its
  actual member list: **all match, none omit a barrier**. Every barrier *container* comment
  says `cellLock()`.
- `readableStreamPipeTo` takes the **JSAbortSignal wrapper cell** (never a raw
  `WebCore::AbortSignal*`) per the binding PHASE-A ruling §3.6, and `m_abortAlgorithmId` is
  `uint32_t`, matching the real `addAbortAlgorithmToSignal` return type (`AbortSignal.h:83`).
  The GC-visited abort-algorithm path (`AbortSignal::visitAbortAlgorithms` →
  `visitJSFunction`, reached from `JSAbortSignal::visitAdditionalChildrenInGCThread`) exists
  as ARCHITECTURE §6.1 claims.
- The §6.1/§5.3/§5.4 liveness back-edges all exist and are declared visited:
  `JSReadableStreamDefaultReader::m_pipeOperation` (erased `JSCell` on purpose — shared by
  the pipe and both Bun pumps, per BUN-LAYER §5.3's "do not add a second field"),
  `JSWritableStreamDefaultWriter::m_pipeOperation`, `JSStreamTeeState::{m_stream, m_reader}`,
  and the pipe op's full §6.1 member set. The BYOB reader intentionally has no back-edge
  (no pump ever acquires one: pipeTo uses a default reader; Bun rejects byte-source pipeTo).

Three findings. One is a shipped use-after-free.

---

### [CRITICAL] `ProcessPullIntoDescriptorsUsingQueue` returns already-unrooted GC cells in an unscanned heap buffer — UAF at ≥5 filled descriptors

**Where:** `src/jsc/bindings/webcore/streams/WebStreamsInternals.h:270-272`

```cpp
// The returned raw pointers are stack-rooted (conservative scan) and must be consumed by the
// caller's commit loop before any allocation-heavy work.
WTF::Vector<JSPullIntoDescriptor*, 4> readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(JSReadableByteStreamController*); // userJS: no
```

**Rule violated:** ARCHITECTURE §3.4. Its guarantee — "Holding a `JSPullIntoDescriptor*`
across user JS is then never a UAF" — is true *only while the descriptor is still in the
visited `m_pendingPullIntos` deque*. This op is the ONE place where that predicate is false
by construction: the spec (digest 02:1125-1135) SHIFTS every filled descriptor out of
`[[pendingPullIntos]]` **before** any commit runs, so the returned pointers are the **sole**
remaining references. It also violates the subsystem-wide "no unrooted retention of GC cells
in a non-GC container" invariant that §7.6 / WriteBarrierList.h encode.

**Why the header's own safety comment is false, twice:**

1. *"stack-rooted (conservative scan)"* is only true for ≤4 elements. `WTF::Vector<T*, 4>`
   spills its 5th element to a `fastMalloc`'d out-of-line buffer, and JSC's conservative
   root scan covers ONLY machine stacks and registers — never the fastMalloc heap. From the
   5th filled descriptor onward the pointers are invisible to the GC. Five+ simultaneously
   fillable pull-intos is a trivially user-reachable state (≥5 pending `byobReader.read()`s
   followed by one large `controller.enqueue()` / `byobRequest.respond(n)` — the exact
   call sites at digest 02:991-993, :1238-1241, :1256-1261).
2. *"before any allocation-heavy work"* is unsatisfiable: the consumer of this list IS
   `readableByteStreamControllerCommitPullIntoDescriptor`, which **this same header**
   annotates `userJS: yes (fulfill dispatch)` at `WebStreamsInternals.h:256`. Commit #1
   allocates (a fresh typed-array view via `ConvertPullIntoDescriptor`, a `{value,done}`
   result object, promise-reaction jobs) and can run user code (byte-tee chunk steps).
   Any of those allocations can trigger a GC.

**Concrete UAF trace:** 5 filled descriptors are shifted off `m_pendingPullIntos`; the
Vector spills descriptor #5 to a heap buffer; commit #1's allocation triggers a collection;
descriptor #5 (and its `m_buffer` ArrayBuffer — the very memory about to be handed to the
user's read promise) is swept; commit #5 reads a dead cell. Every one of this op's three
callers is a real, per-`respond()`/per-`enqueue()` hot path, so this ships a
user-triggerable UAF into `JSReadableByteStreamController.cpp`.

**Exact fix (pick ONE; the first is the canonical JSC device and the repo's own stated
rule — "MarkedArgumentBuffer for values accumulated across slow calls, never raw JS
pointers in std containers"):**
- Change the signature to fill a **caller-provided `JSC::MarkedArgumentBuffer&`**
  (`void readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(JSReadableByteStreamController*, JSC::MarkedArgumentBuffer& filledPullIntos)`).
  `MarkedArgumentBuffer` registers its overflow buffer with the VM's mark-list set, so ALL
  entries — inline and spilled — are strongly scanned for its scope. The commit loop
  `jsCast<JSPullIntoDescriptor*>(filledPullIntos.at(i))`s each element.
  (`MarkedArgumentBuffer` is non-copyable, hence the out-param, not a return.)
- OR keep the filled descriptors in a second *visited* `WTF::Deque<WriteBarrier<JSPullIntoDescriptor>>`
  member on the controller until the commit loop drains it (adds a member + visit line).
- Either way, DELETE the false comment at :270-271 and replace it with the real ownership
  statement ("these descriptors are no longer in [[pendingPullIntos]]; this buffer is their
  only root").

---

### [MAJOR] The byte controller's frozen `cellLock()` contract is unsatisfiable as one lock scope — `StreamQueue::visit()` self-locks under a non-recursive lock while the sibling barrier deque needs the caller to hold the same lock

**Where:**
- `src/jsc/bindings/webcore/streams/StreamQueue.h:112-121, 126-130, 138-145` — every
  `StreamQueue` mutator and `StreamQueue::visit()` acquires `owner->cellLock()` **inside**
  the helper (correctly copying `WriteBarrierList.h`).
- `src/jsc/bindings/webcore/streams/JSReadableByteStreamController.h:33-37` — the frozen
  visit contract for the ONE class that owns BOTH a `StreamQueue` **and** a bare barrier
  deque: *"...and the TWO barrier containers m_queue (via m_queue.visit()) and
  m_pendingPullIntos — both UNDER cellLock()."*
- `src/jsc/bindings/webcore/streams/JSReadableByteStreamController.h:53-55` — the two
  members (`m_queue` self-locking; `m_pendingPullIntos` a raw
  `WTF::Deque<WriteBarrier<JSPullIntoDescriptor>, 4>` that needs a *caller-held* lock).

**Rule violated:** ARCHITECTURE §3.3's cellLock discipline (task rule 2). `JSCellLock` is
a **non-recursive** `WTF::Lock`-style lock. The header's phrasing "both UNDER cellLock()"
describes the two containers as one requirement; the natural Phase-B implementation —
`{ Locker locker { t->cellLock() }; for (auto& d : t->m_pendingPullIntos) visitor.append(d); t->m_queue.visit(t, visitor); }`
— **re-acquires `cellLock()` inside `m_queue.visit()` and deadlocks the GC constraint
solver** (a whole-process hang, and it will fire in the very first byte-stream test).
The "obvious escape" — dropping the outer `Locker` because "the queue already locks" and
visiting `m_pendingPullIntos` bare — is a concurrent-marking race on the deque's backing
buffer: exactly the heap corruption the discipline exists to prevent. Both failure modes
are one Phase-B author away, and this is the ONE header that ships bodies. The same
asymmetry bites the mutation side: `readableByteStreamControllerEnqueueDetachedPullIntoToQueue`
and friends must mutate `m_pendingPullIntos` (external lock) and `m_queue` (self-locking) in
the same op.

(To be explicit: TWO separate lock scopes — `m_queue.visit(t, visitor)` first, then a
fresh `Locker` around the `m_pendingPullIntos` loop — IS correct. The defect is that the
frozen contract does not say that, the API shape actively invites the deadlocking
composition, and this contract is exactly what 14 Phase-B files code against.)

**Exact fix (either restores a single, unambiguous discipline):**
- Preferred: make every `StreamQueue` mutator and `visit()` take a
  `const WTF::AbstractLocker&` first parameter (the standard WTF "prove you hold the lock"
  idiom) instead of locking internally; the owning cell's `visitChildrenImpl` then takes
  `cellLock()` exactly ONCE around all of its barrier containers. One lock scope, no
  re-entry, symmetric with the bare deques.
- Minimum: keep the self-locking API but rewrite `JSReadableByteStreamController.h:33-37`
  (and `StreamQueue.h:10-15`) to state: *"cellLock() is non-recursive. Visit
  `m_pendingPullIntos` and `m_queue` in TWO DISJOINT lock scopes; `m_queue.visit()` takes
  the lock itself — NEVER call it while already holding `cellLock()`."* And add the same
  warning to the mutator group at `StreamQueue.h:110-130`.

---

### [MINOR] `JSCrossRealmTransformState::m_controller` is a second type-erased controller back-pointer, outside ARCHITECTURE §3.2's "ONE mandatory exception"

**Where:** `src/jsc/bindings/webcore/streams/JSCrossRealmTransformState.h:44-49`

```cpp
// Back-pointer to the controller in THIS realm. Erased: a
// JSReadableStreamDefaultController (readable side) or a
// JSWritableStreamDefaultController (writable side).
JSC::WriteBarrier<JSC::JSObject> m_controller;
bool m_isReadableSide { false };
```

**Rule violated:** ARCHITECTURE §3.2 / task rule 6: `JSReadableStream::m_controller` is
"the ONE mandatory exception"; every OTHER back-pointer is exact-typed. This is a second
erased controller slot, tagged by a bool.

**Honest severity:** this is NOT a lifetime bug — the slot IS a `WriteBarrier`, IS in the
visit list, and roots whichever controller it holds. The residual hazard is the one the
readable-side exception is explicitly fenced with (§3.2 / BUN-LAYER §4.7's "raw
jsCast/static_cast on the erased slot is BANNED; every switch is TOTAL") and this cell has
no such fence, so a wrong-typed `jsCast` in the (deferred) CrossRealmTransform.cpp is a
type-confusion latent in the frozen layout. It is also entirely inside the §6.3
out-of-scope-this-PR surface.

**Exact fix:** replace the erased pair with two exact-typed barriers
(`WriteBarrier<JSReadableStreamDefaultController> m_readableController;` /
`WriteBarrier<JSWritableStreamDefaultController> m_writableController;`, exactly one
non-null; both visited), OR — if the single-slot layout is deliberate — copy §3.2's ban
comment ("raw jsCast on this slot is BANNED; dispatch on m_isReadableSide") onto the member.

---

## Per-class table

Legend: **V?** = `DECLARE_VISIT_CHILDREN` declared. **D?** = destructible as declared
(derives `JSC::JSDestructibleObject` + `needsDestruction = NeedsDestruction` + `static
void destroy(JSCell*)` + private dtor). **Should?** = must it be destructible (owns a
non-trivially-destructible C++ member)?

| Class (header) | Barrier / Weak / container members | V? | D? | Should? | Verdict |
|---|---|---|---|---|---|
| `JSReadableStream` (JSReadableStream.h) | 6 WB (`m_reader`,`m_storedError`,`m_controller`†erased+tag,`m_nativePtr`,`m_directUnderlyingSource`,`m_asyncContext`) | yes (all 6 listed) | no | no | OK |
| `JSReadableStreamReaderBase` (JSReadableStreamReaderBase.h) | 2 WB (`m_stream`,`m_closedPromise`) — visited by each concrete subclass (base has no ClassInfo) | n/a (documented) | base = `JSDestructibleObject` per PHASE-A ruling §3.1 | n/a | OK |
| `JSReadableStreamDefaultReader` (JSReadableStreamDefaultReader.h) | base 2 WB + `m_pipeOperation` + **Deque\<WB\<JSReadRequest\>\>** | yes; deque under cellLock | yes | yes (Deque) | OK |
| `JSReadableStreamBYOBReader` (JSReadableStreamBYOBReader.h) | base 2 WB + **Deque\<WB\<JSReadIntoRequest\>\>** | yes; deque under cellLock | yes | yes (Deque) | OK |
| `JSReadableStreamDefaultController` (JSReadableStreamDefaultController.h) | 6 WB + **StreamQueue\<ValueWithSize\>** | yes; queue via `m_queue.visit()` (cellLock) | yes | yes (StreamQueue⇒Deque) | OK |
| `JSReadableByteStreamController` (JSReadableByteStreamController.h) | 6 WB + **StreamQueue\<ByteQueueEntry\>** + **Deque\<WB\<JSPullIntoDescriptor\>\>** | yes; both under cellLock | yes | yes | **MAJOR** (cellLock contract, above) |
| `JSReadableStreamBYOBRequest` (JSReadableStreamBYOBRequest.h) | 2 WB | yes | no | no | OK |
| `JSWritableStream` (JSWritableStream.h) | 6 WB + `PendingAbortRequest`{2 WB} + **Deque\<WB\<JSPromise\>\>** | yes; deque under cellLock; abort-request fields listed | yes | yes (Deque) | OK |
| `JSWritableStreamDefaultWriter` (JSWritableStreamDefaultWriter.h) | 4 WB (incl. `m_pipeOperation`) | yes | no | no | OK |
| `JSWritableStreamDefaultController` (JSWritableStreamDefaultController.h) | 8 WB + **StreamQueue\<ValueWithSize\>** | yes; queue under cellLock | yes | yes | OK |
| `JSTransformStream` (JSTransformStream.h) | 4 WB | yes | no | no | OK |
| `JSTransformStreamDefaultController` (JSTransformStreamDefaultController.h) | 7 WB | yes | no | no | OK |
| `JSByteLengthQueuingStrategy` / `JSCountQueuingStrategy` | none (scalar only) | correctly none | no | no | OK |
| `JSReadableStreamAsyncIterator` (JSReadableStreamAsyncIterator.h) | 2 WB | yes | no | no | OK |
| `JSReadRequest` / `JSReadIntoRequest` (JSReadRequest.h) | 1 WB each (`m_context`) | yes | no | no | OK (no vtable; kind tag) |
| `JSPullIntoDescriptor` (JSPullIntoDescriptor.h) | 1 WB (`m_buffer`) | yes | no | no | OK as a cell; **CRITICAL** at the ABI site above |
| `JSStreamPipeToOperation` (JSStreamPipeToOperation.h) | 9 WB (source, dest, reader, writer, signal, promise, currentWrite, shutdownActionPromise, shutdownError) | yes (all 9) | no | no | OK (§6.1 member set complete) |
| `JSStreamTeeState` (JSStreamTeeState.h) | 7 WB (incl. the §6.2 load-bearing `m_stream`,`m_reader`) | yes | no | no | OK |
| `JSCrossRealmTransformState` (JSCrossRealmTransformState.h) | 3 WB | yes | no | no | **MINOR** (erased `m_controller`) |
| `JSStreamFromIterableContext` (JSStreamAlgorithmContexts.h) | 2 WB | yes | no | no | OK |
| `JSStreamsRuntime` (JSStreamsRuntime.h) | ~90 `WB<JSFunction>` + 14 `JSC::LazyProperty` (all trivially destructible; verified `LazyProperty` is one `uintptr_t`) | yes (both macro lists + every LazyProperty) | no | no | OK |
| `JSDirectStreamController` (JSDirectStreamController.h) | 8 WB + **StringBuilder** + **Vector\<WB\>** | yes; `m_pieces` under cellLock | yes | yes | OK |
| `JSNativeStreamSourceAdapter` (BunStreamSource.h) | 4 WB + **`JSC::Weak<JSReadableStreamDefaultController>`** | yes (4 WB; Weak correctly NOT visited) | yes | yes (Weak) | OK — the ONE sanctioned Weak, correctly destructible |
| `JSDirectSinkCloseState` (JSDirectSinkCloseState.h) | 2 WB | yes | no | no | OK |
| `JSReadStreamIntoSinkOperation` (JSReadStreamIntoSinkOperation.h) | 4 WB | yes | no | no | OK |
| `JSResumableSinkPumpOperation` (JSResumableSinkPumpOperation.h) | 4 WB | yes | no | no | OK |
| `JSTextEncoderStream` / `JSTextDecoderStream` | 2 WB each | yes | no | no | OK (decoder held as the WRAPPER cell — the ratified §3.10 fix that keeps them non-destructible) |
| 12 user-constructible `*Constructor` classes (incl. TextEncoder/DecoderStream) | 1 `WB<Structure>` (`m_instanceStructure`) each | yes | no | no | OK — each declares its OWN `subspaceForImpl` (its `sizeof` differs from `JSDOMConstructorBase`, whose inherited `subspaceFor` would `static_assert`-fail) |
| 5 throwing `*Constructor` classes | none | correctly none | no | no | OK — inherit `JSDOMConstructorBase::subspaceFor` (same size; its `sizeof`/`destroy` static_asserts pass) |
| 13 `*Prototype` classes | none | correctly none | no | no | OK (`vm.plainObjectSpace()` + `STATIC_ASSERT_ISO_SUBSPACE_SHARABLE` — the house pattern) |
| `StreamQueue<Entry>` (StreamQueue.h) | not a cell; `Deque<Entry,4>` of barrier-holding entries | `visit(owner,…)` self-locks | n/a | forces the OWNER destructible (documented) | **MAJOR** (lock composition, above) |
| `StreamsForward.h` / `WebStreamsInternals.h` | no cells | — | — | — | one **CRITICAL** signature (above) |

† `JSReadableStream::m_controller` is the sanctioned §3.2 erasure (`WriteBarrier<JSObject>`
+ `ControllerKind` tag). Verified: every other back-pointer named by §3.2 (`[[reader]]`,
`[[stream]]`, `[[readable]]`, `[[writable]]`, `[[writer]]`, `JSWritableStream::m_controller`,
`JSTransformStream::m_controller`, `JSReadableStreamBYOBRequest::m_controller`) is
exact-typed. `[[queueTotalSize]]`/HWM are `double`; every state enum is
`enum class : uint8_t`; `[[storedError]]` is `WriteBarrier<Unknown>` with the
gate-on-`m_state` contract commented on BOTH stream classes.

## Verdict

The header set is structurally sound on the axes this review owns: zero virtuals, zero Strong/protect, one correctly-destructible sanctioned Weak, destructibility exactly right on all 32 files (8 destructible classes = 8 with a real non-trivial member, 0 wasteful ones), every barrier and barrier-container visited with the right cellLock annotation, and every §6.1/§5.3/§5.4 liveness back-edge present and visited.
It must NOT be frozen as-is: `WebStreamsInternals.h:272` freezes a signature that hands the byte controller's shifted-out pull-into descriptors to the commit loop through an unscanned `fastMalloc` buffer — a user-triggerable use-after-free that the header's own comment mis-justifies and that its own `userJS: yes` annotation on the consumer (line 256) contradicts.
Fix the CRITICAL (MarkedArgumentBuffer out-param) and the MAJOR (make `StreamQueue`'s lock discipline composable/unambiguous with a sibling barrier deque) before the freeze; the MINOR is a one-line typing/comment cleanup.
