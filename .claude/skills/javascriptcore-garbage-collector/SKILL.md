---
name: javascriptcore-garbage-collector
description: JSC GC reference for Bun. Use for use-after-free, JS object leaks, "collected too early", or when touching WriteBarrier, visitChildren, visitAdditionalChildren, JSRef, JSC::Strong/Weak, hasPendingActivity, ensureStillAlive, addOpaqueRoot, reportExtraMemoryAllocated, IsoSubspace, HeapAnalyzer, finalize.
---

# JavaScriptCore's Garbage Collector (Riptide)

Riptide is **non-moving, generational, parallel, mostly-concurrent, conservative-on-the-stack**. Understanding those five words prevents most GC bugs in Bun.

## The mental model

The heap is a graph. GC does a breadth-first search from **roots** → marks everything it reaches → everything unmarked is freed (lazily, on next allocation from that block). It does NOT compact or move objects — pointers stay stable for an object's lifetime.

**Two collection modes:**

- **Eden GC**: only scans newly-allocated objects + remembered set. Fast, frequent.
- **Full GC**: scans everything. Slower, rarer.

**It runs concurrently.** Marking happens on background threads _while JS is executing_; the mutator only stops at brief safepoints. `visitChildren` runs **off the main thread, racing with your code**.

## How the VM gathers roots

Roots are not a hardcoded list — they are **marking constraints** registered with `Heap::addMarkingConstraint()` and run to fixpoint. The built-in set lives in `Heap::addCoreConstraints()` (`vendor/WebKit/Source/JavaScriptCore/heap/Heap.cpp:2970`):

| Tag   | Name              | What it marks                                                                                                                                                           |
| ----- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cs`  | Conservative Scan | Native stack + registers of every JS thread, scanned word-by-word (`gatherStackRoots` → `ConservativeRoots`). Also JIT stub routines. World is stopped for this.        |
| `Msr` | Misc Small Roots  | `vm.smallStrings`, `m_protectedValues` (`JSValueProtect`/`gcProtect`), `MarkedArgumentBuffer` lists, `vm.exception()` / `lastException()` / `m_terminationException`    |
| `Sh`  | Strong Handles    | `m_handleSet.visitStrongHandles()` — every `JSC::Strong<T>`. Also `vm().visitAggregate()` (atom string tables etc.)                                                     |
| `D`   | Debugger          | Sampling profiler, type profiler, ShadowChicken                                                                                                                         |
| `Ws`  | Weak Sets         | Iterates every `WeakBlock`; calls `WeakHandleOwner::isReachableFromOpaqueRoots()` to decide whether a weak ref should _become_ strong this cycle                        |
| `O`   | Output            | Calls `visitOutputConstraints()` on already-marked cells in output-constraint subspaces (executables, WeakMaps). This is the "re-run after marking discovers more" hook |
| `Jw`  | JIT Worklist      | CodeBlocks queued for compilation                                                                                                                                       |
| `Cb`  | CodeBlocks        | Executing/compiling CodeBlocks                                                                                                                                          |

Bun registers an additional constraint, `DOMGCOutputConstraint` (`src/jsc/bindings/BunGCOutputConstraint.cpp`), which calls `visitOutputConstraints` on every marked cell in Bun's output-constraint subspaces (event targets, generated classes with `visitAdditionalChildren`, etc.).

**Constraint volatility** controls when they re-run during the fixpoint:

- `GreyedByExecution` — may produce new grey cells whenever the mutator runs (re-run after every resume)
- `GreyedByMarking` — may produce new grey cells when _other_ marking happens (re-run after each drain)
- `SeldomGreyed` — usually doesn't add anything; run last

## Object layout: the 8-byte JSCell header

Every GC-managed object inherits `JSCell` (`runtime/JSCell.h`):

```
| StructureID (4) | indexingTypeAndMisc (1) | JSType (1) | flags (1) | cellState (1) |
```

- `StructureID` — compressed hidden-class pointer
- `indexingTypeAndMisc` — 2 bits are an embedded `WTF::Lock` (the **cell lock**); always CAS this byte
- `cellState` — inlined GC color, used by the write barrier

Out-of-line, in the `MarkedBlock` footer (or `PreciseAllocation` header for objects >~8KB):

- `isMarked` bit — survived last GC
- `isNewlyAllocated` bit — allocated since last GC

Liveness = `isMarked || isNewlyAllocated` (with logical-versioning so blocks aren't swept eagerly).

## CellState and the write barrier

`vendor/WebKit/Source/JavaScriptCore/heap/CellState.h`:

```cpp
PossiblyBlack   = 0   // visited (or old-space-pending-rescan during full GC)
DefinitelyWhite = 1   // new / unmarked
PossiblyGrey    = 2   // on the mark stack
```

Generational + concurrent GC share **one** retreating-wavefront barrier:

```cpp
// After: obj->field = newValue
if (obj->cellState <= blackThreshold)   // 0 normally, bumped while GC is marking
    writeBarrierSlowPath(obj);          // → put obj on remembered set / revisit
```

**You almost never write this by hand.** Use `WriteBarrier<T>` as the field type and call `.set(vm, owner, value)` — it stores then barriers. A raw `JSCell*` / `JSValue` member without a `WriteBarrier` wrapper is a bug: eden GC will free the target out from under you.

`LazyProperty<Owner, T>`, `LazyClassStructure`, and `WriteBarrierStructureID` are barrier-aware variants for lazily-initialized fields and structures.

## Allocation: where objects live

`bmalloc/libpas` provides pages; JSC carves them up:

- **`MarkedBlock`** — 16KB block, fixed cell size (segregated free list). Footer holds bitvectors. 16-byte minimum cell alignment. `addr & ~(16KB-1)` → block, so liveness checks are O(1).
- **`PreciseAllocation`** — large objects (>~8KB), individually `malloc`'d, 96-byte GC header. Always returns addresses with `addr % 16 == 8` so `ptr & 8` distinguishes them from MarkedBlock cells.
- **`CompleteSubspace`** — size-segregated set of `BlockDirectory`s for general JS objects.
- **`IsoSubspace`** — one subspace per C++ type (security: a freed cell can only be reused for the _same_ type, defeating type-confusion UAF). **Every Bun class with native fields needs its own IsoSubspace** — `subspaceFor<T>` in the header, slot in `BunClientData`/`DOMIsoSubspaces`.

**Allocation may trigger GC.** A safepoint exists at every allocation. Never assume "I just allocated X, so Y from before is still alive" unless Y is rooted.

## Conservative stack scanning — what it does and doesn't guarantee

`vendor/WebKit/Source/JavaScriptCore/heap/ConservativeRoots.cpp` walks the native stack/registers word-by-word (after `MachineThreads::tryCopyOtherThreadStacks` snapshots them). Any aligned word inside a live `MarkedBlock` cell or `PreciseAllocation` is a root.

**This means:** a `JSCell*` / `JSValue` in a C++/Zig local variable _usually_ keeps the object alive — no `Handle`/`Local` ceremony like V8.

**This does NOT mean you're always safe.** The compiler may dead-store-eliminate the local after its last visible use, or never spill it. If you extract an interior pointer (`string->characters8()`, butterfly storage, typed-array `vector()`) and then call something that can allocate, the original cell may no longer be on the stack:

```cpp
JSC::EnsureStillAliveScope keepAlive(cell);   // RAII: forces cell onto stack until scope end
// ... use interior pointer, call things that allocate ...
```

or `ensureStillAliveHere(cell)`. In Zig: `value.ensureStillAlive()`.

## `visitChildren` — the per-cell tracing hook

```cpp
// In header:
DECLARE_VISIT_CHILDREN;
WriteBarrier<JSObject> m_callback;
WriteBarrier<Unknown>  m_cachedValue;

// In .cpp:
template<typename Visitor>
void JSFoo::visitChildrenImpl(JSCell* cell, Visitor& visitor) {
    auto* thisObject = jsCast<JSFoo*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);   // ALWAYS call base first

    visitor.append(thisObject->m_callback);
    visitor.append(thisObject->m_cachedValue);
}
DEFINE_VISIT_CHILDREN(JSFoo);
```

**Rules — runs concurrently on a GC thread:**

- No allocation. No `toJS`, no `jsString`, nothing that touches `vm.heap`.
- No `ref()`/`deref()` of `RefCounted` (not thread-safe).
- No locks the main thread might also take while allocating (deadlock).
- If a field can be torn by a racing mutator, take `Locker locker { thisObject->cellLock() }` in both `visitChildren` and the mutating site.
- Forgetting to `append()` a `WriteBarrier` field → use-after-free, often eden-GC-only, often only under load.

## `visitAdditionalChildren` and output constraints

`visitChildren` only sees the cell's own fields. When a JS wrapper's liveness should propagate to **other JS objects reachable through native state** (event listeners, observers, the JS values held inside a wrapped C++ object), Bun uses the WebCore pattern:

```cpp
// Custom hook called from BOTH places:
template<typename Visitor>
void JSFoo::visitAdditionalChildren(Visitor& visitor) {
    wrapped().listeners().visitJSEventListeners(visitor);
    visitor.addOpaqueRoot(&wrapped());
}

// 1) From visitChildren (normal marking):
DEFINE_VISIT_CHILDREN_WITH_MODIFIER(..., JSFoo) {
    ...
    thisObject->visitAdditionalChildren(visitor);
}

// 2) From visitOutputConstraints (constraint fixpoint re-scan):
template<typename Visitor>
void JSFoo::visitOutputConstraints(JSCell* cell, Visitor& visitor) {
    auto* thisObject = jsCast<JSFoo*>(cell);
    Base::visitOutputConstraints(thisObject, visitor);
    thisObject->visitAdditionalChildren(visitor);
}
```

**Why two entry points?** `visitChildren` runs once when the cell turns grey. But marking may later discover that some _other_ native object (an opaque root) is live, which retroactively makes more of _this_ cell's references live. `visitOutputConstraints` is re-invoked by `DOMGCOutputConstraint` during the constraint fixpoint to catch that.

To make a class participate, its IsoSubspace must be registered as an **output-constraint subspace** (`clientSubspaceFor*` with `outputConstraint` in `BunClientData` / generated `ZigGeneratedClasses.cpp`). The codegen does this automatically when `.classes.ts` has `hasPendingActivity`, `own` properties, or event-target semantics.

## Opaque roots — liveness through non-JSCell pointers

When native objects form a graph that should keep wrappers alive:

```cpp
// In some wrapper's visitAdditionalChildren:
visitor.addOpaqueRoot(nativePtr);          // "nativePtr is reachable"

// Elsewhere, deciding whether ANOTHER wrapper survives:
bool JSBarOwner::isReachableFromOpaqueRoots(Handle<Unknown> h, void* ctx,
                                            AbstractSlotVisitor& v, ASCIILiteral* reason) {
    auto* bar = static_cast<Bar*>(ctx);
    if (UNLIKELY(reason)) *reason = "Bar is in document tree"_s;
    return v.containsOpaqueRoot(bar->ownerNode());
}
```

The opaque-root set is just a `HashSet<void*>` rebuilt each cycle. It's how DOM trees stay alive as a unit.

## `JSC::Weak<T>`, `WeakImpl`, `WeakBlock`, `WeakHandleOwner`

`JSC::Weak<T>` (`vendor/WebKit/Source/JavaScriptCore/heap/Weak.h`) is the GC-aware weak pointer. It does **not** keep its target alive; `.get()` returns `nullptr` after the target is collected.

Under the hood:

- Each `Weak<T>` owns a `WeakImpl*` (`vendor/WebKit/Source/JavaScriptCore/heap/WeakImpl.h`): `{ JSValue, WeakHandleOwner* (low bits = state), void* context }`. State is `Live → Dead → Finalized → Deallocated`.
- `WeakImpl`s are slab-allocated in 1KB **`WeakBlock`s** (`vendor/WebKit/Source/JavaScriptCore/heap/WeakBlock.h`, `blockSize = 1024`). Every `MarkedBlock` and `PreciseAllocation` has a `WeakSet` — a linked list of `WeakBlock`s for cells in that container.
- During the `Ws` constraint, each `WeakBlock::visit()` walks its `WeakImpl`s; for each one whose target is **not yet marked**, it calls `WeakHandleOwner::isReachableFromOpaqueRoots(handle, context, visitor, &reason)`. Return `true` → the target is marked (the weak ref is "upgraded" this cycle). This is how `hasPendingActivity()` and opaque-root reachability keep wrappers alive even when nothing strongly references them.
- After marking, `WeakBlock::reap()` flips unmarked `Live` impls to `Dead`. `WeakBlock::sweep()` later runs `WeakHandleOwner::finalize(handle, context)` on each `Dead` impl, then frees the slot. **`finalize` runs on the mutator thread but the cell is already dead — do not touch its JS fields.** Typical use: drop the wrapper from a native→JS wrapper cache.

```cpp
struct MyOwner final : public JSC::WeakHandleOwner {
    bool isReachableFromOpaqueRoots(Handle<Unknown>, void* ctx,
                                    AbstractSlotVisitor& v, ASCIILiteral*) override {
        return static_cast<NativeThing*>(ctx)->hasPendingActivity();
    }
    void finalize(Handle<Unknown>, void* ctx) override {
        static_cast<NativeThing*>(ctx)->m_wrapper = nullptr;
    }
};
JSC::Weak<JSFoo> m_wrapper { jsFoo, &myOwnerSingleton, nativeThing };
```

`Weak<T>` is **move-only** (allocates a `WeakImpl`). Don't put it in a hot path; cache it.

## Zig: `jsc.JSRef` — the native↔wrapper reference pattern

In Bun's Zig code, when a native object needs to hold a reference back to its own JS wrapper, **use `jsc.JSRef`** (`src/jsc/bindings/JSRef.zig`), not `gcProtect`, not a raw `JSValue` field, and usually not `jsc.Strong` directly.

`JSRef` is a tagged union with three states:

- `.weak` — a bare `JSValue`. Does **not** keep the wrapper alive. Valid only because the wrapper's `finalize()` will flip this to `.finalized` before the cell is freed, so `tryGet()` returns `null` instead of a dangling pointer. (This is _not_ a `JSC::Weak`; it's cheaper — no `WeakImpl` allocation.)
- `.strong` — wraps `jsc.Strong` (a `JSC::Strong<Unknown>` root). Keeps the wrapper alive.
- `.finalized` — terminal; `tryGet()` returns `null`.

Pattern: **strong while busy, weak while idle.**

```zig
this_value: jsc.JSRef = .empty(),

// On construction / when work starts:
this.this_value.setStrong(js_wrapper, globalThis);   // or .upgrade(globalThis)

// When the last in-flight operation completes:
this.this_value.downgrade();                         // strong → weak, GC may now collect

// In any callback that needs the wrapper:
const js_this = this.this_value.tryGet() orelse return;

// In the codegen'd finalize():
this.this_value.finalize();
```

See `ServerWebSocket`, `UDPSocket`, `MySQLConnection`, `ValkeyClient` for real examples.

**`JSRef` requires a finalizer.** The `.weak` state is only sound because the codegen'd `finalize()` flips it to `.finalized` before the cell is reused. If your `.classes.ts` entry has `finalize: true` (almost all native-backed classes do), `JSRef` is the default choice for self-references.

**`JSRef` vs `hasPendingActivity`:** prefer `JSRef`. `hasPendingActivity: true` is a GC-thread-polled atomic predicate; its only real justification is when **many concurrent operations** independently keep the wrapper alive and there's no single place to call `upgrade()`/`downgrade()` — i.e., refcount-style liveness where the count is touched from multiple threads. That's uncommon. If you can identify "work started" / "work finished" edges, use `JSRef`. Don't add `hasPendingActivity` reflexively; it costs a constraint-fixpoint poll on every GC.

## `gcProtect` / `JSValueProtect` — almost never

`gcProtect()` / `JSValueProtect()` push into `Heap::m_protectedValues` (a ref-counted root map, visited by the `Msr` constraint). It's the legacy C-API mechanism. **Avoid it in Bun:**

- It's a raw global root with manual unprotect — easy to leak.
- It has no owner, so heap snapshots can't attribute the retention.
- `jsc.Strong` / `JSRef` give the same guarantee with RAII and a destructor.

The only legitimate uses are inside the JSC C API shims themselves, or one-off debugging.

## Extra-memory reporting — `reportExtraMemoryAllocated` / `reportExtraMemoryVisited`

The GC schedules itself by bytes-allocated-since-last-GC. It only sees JSCell allocations, so a 32-byte wrapper around a 50MB native buffer looks like 32 bytes → GC never triggers → OOM.

**Contract — both halves are required:**

```cpp
// 1) When the native memory is allocated (or the wrapper takes ownership):
vm.heap.reportExtraMemoryAllocated(ownerCell, byteCount);

// 2) In visitChildren, every time the cell is visited:
visitor.reportExtraMemoryVisited(thisObject->wrapped().byteSize());
```

- `reportExtraMemoryAllocated` adds to the "since last GC" counter and may **immediately trigger a GC** (it's a safepoint). Call it _after_ the cell is fully constructed.
- `reportExtraMemoryVisited` adds to the "live bytes after this GC" counter, which sets the next trigger threshold. **If you forget this half**, the heap's high-water mark drifts down each cycle and you get back-to-back full GCs (the "GC death spiral").
- If the size changes over time, report the delta on growth (`reportExtraMemoryAllocated(cell, newSize - oldSize)`) and report the current size in `visitChildren`.
- `deprecatedReportExtraMemory` exists for callers that can't satisfy the visit-side half — avoid it.

In `.classes.ts`, `estimatedSize: true` generates the `reportExtraMemoryVisited` side; you implement `estimatedSize()` in Zig. You still call `reportExtraMemoryAllocated` (or the binding's helper) at allocation time.

## `HeapAnalyzer` — heap snapshots and labelling

`vendor/WebKit/Source/JavaScriptCore/heap/HeapAnalyzer.h` is the abstract visitor used to build heap snapshots (Web Inspector "Heap Snapshot", and Bun's V8-compatible `BunV8HeapSnapshotBuilder`). When a snapshot is requested, marking runs with an analyzer attached and each cell's `analyzeHeap` static is called:

```cpp
void JSFoo::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer) {
    auto* thisObject = jsCast<JSFoo*>(cell);
    Base::analyzeHeap(cell, analyzer);
    analyzer.setWrappedObjectForCell(cell, &thisObject->wrapped());
    analyzer.setLabelForCell(cell, thisObject->wrapped().url().string());
    if (auto* child = thisObject->m_callback.get())
        analyzer.analyzePropertyNameEdge(cell, child, vm.propertyNames->callback.impl());
}
```

API (`HeapAnalyzer`):

- `analyzeNode(cell)` — record a node
- `analyzeEdge(from, to, RootMarkReason)` / `analyzePropertyNameEdge` / `analyzeVariableNameEdge` / `analyzeIndexEdge` — record a labelled edge
- `setWrappedObjectForCell(cell, void*)` — link wrapper → native pointer
- `setLabelForCell(cell, String)` — human-readable name in the snapshot
- `setOpaqueRootReachabilityReasonForCell` — why a weakly-held wrapper survived

If your class shows up as an opaque blob in heap snapshots, implement `analyzeHeap`.

## How to keep things alive (decision table)

| Scenario                                                                           | Mechanism                                                                                                                                          |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSCell field pointing to another JSCell                                            | `WriteBarrier<T>` member + `visitor.append(m_field)` in `visitChildren`                                                                            |
| Native state inside the wrapped C++ object holds JS values                         | `visitAdditionalChildren` + register subspace as output-constraint                                                                                 |
| C++/Zig local across allocation/call                                               | Conservative scan (free) — add `EnsureStillAliveScope` / `value.ensureStillAlive()` if extracting interior pointers or seeing release-only crashes |
| **Zig** native object holds its own JS wrapper (class has `finalize: true`)        | **`jsc.JSRef`** — `upgrade()` when work starts, `downgrade()` when idle. **This is the default.**                                                  |
| **Zig** native object owns an arbitrary JS value (callback, options object)        | `jsc.Strong.Optional` — `deinit()` in `finalize()`. Watch for cycles                                                                               |
| C++ non-GC object owns a JS value as a root                                        | `JSC::Strong<T>`. **Danger:** cycle if the JS value can reach back → leak                                                                          |
| Weak ref with resurrection predicate / finalize callback (C++)                     | `JSC::Weak<T>` + `WeakHandleOwner`                                                                                                                 |
| Wrapper kept alive by **many concurrent operations** with no single busy/idle edge | `.classes.ts` `hasPendingActivity: true` (atomic flag polled on GC thread). **Uncommon — prefer `JSRef` if you can.**                              |
| Group of wrappers share lifetime via a native graph                                | `visitor.addOpaqueRoot(ptr)` + `containsOpaqueRoot(ptr)`                                                                                           |
| Temporarily forbid GC in a critical section                                        | `DeferGC deferGC(vm)` — defers until scope exit. Never hold across user JS                                                                         |
| Tell GC about off-heap memory you own                                              | `reportExtraMemoryAllocated` on alloc **and** `reportExtraMemoryVisited` in `visitChildren`                                                        |
| ~~Mark a value as root from C API~~                                                | ~~`gcProtect` / `JSValueProtect`~~ — **avoid**; use `jsc.Strong` / `JSRef` instead                                                                 |

## Destruction & finalizers

- `static constexpr bool needsDestruction = true` → C++ destructor runs when the cell is swept. Sweep is **lazy** (next allocation from that block, or `IncrementalSweeper`), so destruction is delayed arbitrarily. Do not rely on it for prompt resource release — expose explicit `close()`/`dispose()`.
- In `.classes.ts`, `finalize: true` → Zig `finalize()` called from the destructor. Same laziness applies.
- `WeakHandleOwner::finalize` runs earlier (at weak-reap time) but the cell is already dead; only use it to clear caches.
- Destructors run on the mutator thread but **other JS objects may already be swept** — do not dereference `WriteBarrier` fields in a destructor.

## Debugging GC issues

```bash
# Force synchronous, frequent GC — turns rare races into immediate crashes
BUN_JSC_collectContinuously=1 BUN_JSC_useConcurrentGC=0 bun-debug test.js

# Zero free cells so UAF reads are obvious
BUN_JSC_scribbleFreeCells=1

# Validate the GC's own bookkeeping
BUN_JSC_verifyGC=1 BUN_JSC_verboseVerifyGC=1

# See what's being collected / heap growth
BUN_JSC_logGC=2 BUN_JSC_showObjectStatistics=1

# Force GC from JS
Bun.gc(true)      // sync full GC
require('bun:jsc').heapStats()
```

If a bug only reproduces with concurrent GC **on** → missing write barrier or `visitChildren` race.
If it only reproduces with `collectContinuously=1` → something isn't rooted across an allocation.
If memory grows but `heapStats().heapSize` doesn't → missing `reportExtraMemoryAllocated`.
If GC runs constantly with little garbage → missing `reportExtraMemoryVisited`.

## Key source files

- `vendor/WebKit/Source/JavaScriptCore/heap/Heap.cpp` — `collectImpl`, `addCoreConstraints` (root list)
- `vendor/WebKit/Source/JavaScriptCore/heap/SlotVisitor.cpp` / `SlotVisitorInlines.h` — `drain()`, `append`, `addOpaqueRoot`, `reportExtraMemoryVisited`
- `vendor/WebKit/Source/JavaScriptCore/heap/MarkedBlock.h`, `vendor/WebKit/Source/JavaScriptCore/heap/PreciseAllocation.h` — cell containers, `isLive`
- `vendor/WebKit/Source/JavaScriptCore/heap/CellState.h`, `runtime/WriteBarrier.h`, `runtime/WriteBarrierInlines.h`
- `vendor/WebKit/Source/JavaScriptCore/heap/ConservativeRoots.cpp`, `vendor/WebKit/Source/JavaScriptCore/heap/MachineStackMarker.cpp`
- `vendor/WebKit/Source/JavaScriptCore/heap/Weak.h`, `vendor/WebKit/Source/JavaScriptCore/heap/WeakImpl.h`, `vendor/WebKit/Source/JavaScriptCore/heap/WeakBlock.h`, `vendor/WebKit/Source/JavaScriptCore/heap/WeakSet.h`, `vendor/WebKit/Source/JavaScriptCore/heap/WeakHandleOwner.h`
- `vendor/WebKit/Source/JavaScriptCore/heap/HeapAnalyzer.h`, `vendor/WebKit/Source/JavaScriptCore/heap/HeapSnapshotBuilder.cpp`, Bun: `vendor/WebKit/Source/JavaScriptCore/heap/BunV8HeapSnapshotBuilder.cpp`
- `vendor/WebKit/Source/JavaScriptCore/heap/DeferGC.h`, `vendor/WebKit/Source/JavaScriptCore/heap/Strong.h`, `vendor/WebKit/Source/JavaScriptCore/heap/HandleSet.h`
- `runtime/JSCell.h` / `JSCellInlines.h` — header layout, `visitChildren` base
- Bun: `src/jsc/bindings/BunGCOutputConstraint.cpp`, `ZigGeneratedClasses.cpp` (codegen'd `visitChildren` / `visitOutputConstraints`)
