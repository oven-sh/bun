# Phase 2 Bucket 7: Data Races — findings

Static-bucket sweeper run for Bucket 7 (`&mut T` shared across threads via
raw pointer; `Cell<T>` cross-thread; `Ordering::Relaxed` where `Acquire`/
`Release` is needed; manual `Send`+`Sync` on a struct containing
`Cell`/`RefCell`; non-atomic publication of state read concurrently).
Source-tree-only (no TSan, no loom). Numbers are workspace-wide unless
scoped.

**Current-status overlay (Codex follow-up, 2026-05-16):** several rows below
were written before the Phase-5 loom/model closures. Current registry verdicts:
EXP-017 (`Request::store_callback_seq_cst`) = **NO_EVIDENCE** for production
UB after source-overlap audit; EXP-030 (`ThreadPool::Queue`) =
**NO_EVIDENCE** after a loom model; EXP-031 (`WatcherAtomics`) =
**NO_EVIDENCE** after a loom model; EXP-032 (`WebWorker` cross-thread `Cell`)
= **NO_EVIDENCE** after a loom model plus conceptual correction that `!Sync`
alone is not UB; EXP-052 (`UnboundedQueue`) = **NO_EVIDENCE** after a
regression-guard loom model. `Channel<T, B>` remains a deferred soak/hardening
target, while the separate uninit-slot bug in `Channel::try_read_item` is
EXP-033 / CONFIRMED_UB under Bucket 5.

---

## Workspace race-surface counts (this run, 2026-05-16)

| metric                                       | value |
| -------------------------------------------- | ----: |
| files importing `core::sync::atomic`         |   520 |
| atomic-ordering literals (`Relaxed`/`Release`/`Acquire`/`AcqRel`/`SeqCst`) | 1400 |
| `Ordering::Relaxed` literals                 |   749 |
| `unsafe impl … Sync for …`                   |    79 |
| `Atomic{Bool,Uxx,Ixx,Ptr,Usize,Isize}` decl/use | 822 |
| `core::sync::atomic::fence(…)`               |     2 |

The two `atomic::fence` sites are:

1. `src/ptr/raw_ref_count.rs:105` — `fence(Ordering::Acquire)` after a
   refcount `fetch_sub(Release)` reaches zero. Textbook `Arc`-shaped
   release/acquire pattern; this is the correct use of `fence`.
2. `src/io/lib.rs:1168` — `fence(Ordering::SeqCst)` after a
   `write_volatile` to `Request::callback`. **EXP-017**: the primitive Miri
   model proves `write_volatile` is non-atomic and races with a concurrent
   plain read. A later Phase 5 source-overlap audit found no current Bun path
   that mutates `callback` after queue publication, so the current registry
   verdict is `NO_EVIDENCE` for production UB and the primitive model is kept as
   a regression guard.

---

## Cross-refs to existing EXP entries

| EXP-ID | site | severity | one-line |
|---|---|---|---|
| EXP-010 | `src/bundler/LinkerContext.rs:1657-1663` (B-1..B-5 cluster) | CONFIRMED_UB (TB model) | bundler parallel-callback `&mut LinkerContext` aliasing — **also Bucket 7** because the overlap is concurrent across worker threads. Loom is the right Phase-3 follow-up tool. |
| EXP-017 | `src/io/lib.rs:1164-1169` (store), `:870, :1020` (read) | NO_EVIDENCE (regression guard) | `Request::store_callback_seq_cst` — `write_volatile` + `SeqCst fence` is **not** an atomic store. Phase-5 Miri model proves the primitive race if a plain `fn`-ptr read overlaps; the later source-overlap audit found no current post-publication callback rewrite path. |
| EXP-019 | `src/ast/nodes.rs:339-340` | CONFIRMED_UB | `unsafe impl<T> Send/Sync for StoreSlice<T>` unbounded — auto-trait laundering across worker pool. Reproducer in `experiments/EXP-019/` runs `Cell<u32>` through scoped threads. Open PR #30765 fixes it; still unmerged. |
| EXP-026 | `src/runtime/timer/mod.rs:897, 1016`; `src/runtime/jsc_hooks.rs:152-157` | CONFIRMED_UB (TB model) | `timer::All::{get_timeout, drain_timers}` `&mut self` across re-entry — Bucket-1 in the existing finding; race is *intra-thread* re-entry, not multi-thread, so Bucket 7 only applies if a foreign thread can ever observe `&mut timer::All`. Current source: no. Tagged Bucket-1 only; listed here for symmetry. |
| Loom/model closure cluster | `src/threading/ThreadPool.rs:1480-1599`, `src/threading/channel.rs:35-243`, `src/threading/unbounded_queue.rs:216-369` | NO_EVIDENCE / DEFERRED | Phase-5 added regression-guard models for ThreadPool::Queue (EXP-030) and UnboundedQueue (EXP-052); `Channel<T, B>` remains deferred hardening/soak for its loose generic bounds. Do not use the old pre-registration placeholder. |

---

## New findings (this phase)

| F-ID | file:line | severity | bucket cross-tags | draft experiment sketch (<=10 lines) |
|---|---|---|---|---|
| F-DR-1 | `src/threading/ThreadPool.rs:1486-1494` (`Queue::cache: Cell<*mut Node>`) | NO_EVIDENCE via EXP-030 | 7 + 8 + 1 | `unsafe impl Sync for Queue {}` allows `&Queue` to cross threads. `cache: Cell<*mut Node>` is `!Sync` by auto-trait; the comment says "only the IS_CONSUMING-CAS-holder reads/writes". Later loom model supports the tag-bit CAS discipline; keep as a regression guard / soak target, not a counted UB bug. |
| F-DR-2 | `src/threading/channel.rs:35-49`, `:174-242` | DEFENSIBLE-BUT-UNVERIFIED | 7 + 8 + 1 | `Channel<T, B: LinearFifoBuffer<T>>` `Sync` requires only `T: Send`; B is unbounded (trait carries no `Send`/`Sync` bound). `buffer: UnsafeCell<LinearFifo<T,B>>` + `is_closed: Cell<bool>` both touched only with `mutex` held; comment notes the borrow is re-derived each loop so it does not live across `Condition::wait`. Race only if B's interior offers a side channel that bypasses `as_mut_slice`. Loom: a producer + consumer with `should_block=true`; assert no torn `LinearFifo` writes after wake. |
| F-DR-3 | `src/threading/unbounded_queue.rs:216-369` (`UnboundedQueue<T>`) | NO_EVIDENCE via EXP-052 | 7 | Lock-free MPSC: producers CAS `back` then `Release`-store `next` on the previous tail; consumer Acquire-loads `front` → `next`, then CASes `front`. Later 2P-1C loom regression model supports the AcqRel/Acquire discipline. Keep the model as a guard for future queue edits. |
| F-DR-4 | `src/runtime/bake/DevServer/WatcherAtomics.rs:27, 128-225, 232-285` | NO_EVIDENCE via EXP-031 | 7 + 1 | Triple-buffered `events: [HotReloadEvent; 3]` plus `next_event: AtomicU8` channel (DONE / WAITING / index). Later loom model supports the AcqRel handoff edge. Keep as a regression guard; no current UB is counted. |
| F-DR-5 | `src/jsc/web_worker.rs:127-128, 145, 246-326, 332-388` | NO_EVIDENCE via EXP-032 | 7 + 1 + 8 | `WebWorker` has `Cell<*mut WebWorker>` / `Cell<*mut VirtualMachine>` fields touched from cross-thread orchestration paths. Later review corrected the key concept: unsafe sharing of a `!Sync` type is not UB by itself when the actual memory-model invariant is upheld. The loom model, including a negative control, supports the `live_workers::MUTEX` / `vm_lock` serialization invariant for current source. Keep AtomicCell/marker hardening optional. |
| F-DR-6 | `src/bun_alloc/lib.rs:2182-2183` | REVIEWED-HARDENING | 7 + 8 + 1 | **Correction (Codex 2026-05-16):** prior text incorrectly attributed `at_index(&self) -> &ValueType` to `BSSList`. That method is on `OverflowList` at `src/bun_alloc/lib.rs:2111`, not on `BSSList`. `BSSList` exposes only unsafe raw-pointer mutation (`append` / `append_uninit`) and `MaybeUninit<ValueType>` storage; it does not have a safe shared accessor returning `&V`. Therefore the `V: Send` bound on `Sync` is closer to the standard `Mutex<T>: Sync where T: Send` pattern than to the `StoreSlice<T>` unsound-safe-API pattern. Hardening remains warranted because `BSSList` has public fields and mutates non-`UnsafeCell` fields through raw pointers under its mutex; make fields private and add `V: Sync` only if a future safe `&self -> &V` accessor is introduced. Do **not** count this as confirmed or likely current UB without a source-specific witness. |
| F-DR-7 | `src/bun_core/atomic_cell.rs:65-66` | CONFIRMED_UB via EXP-098 | 7 + 8 + 11 | `unsafe impl<T: Copy> Sync/Send for AtomicCell<T>`. Bound `T: Copy` is **not** enough to imply `Send` / `Sync`, and the earlier "methods are gated on `T: Atom`" mitigation is incomplete: safe `new()` + safe `into_inner()` require only `T: Copy`. EXP-098 uses the real `bun_core::AtomicCell` to send `AtomicCell<&Cell<u32>>` to a scoped thread and Miri reports a non-atomic `Cell` data race. Current production instantiations appear atomically valid, but the public safe abstraction is unsound. Fix: require `T: Atom` (or at least directionally appropriate `T: Send` / `T: Sync`) on the unsafe auto-trait impls and prevent non-Atom `Copy` payloads from becoming a Send wrapper. |
| F-DR-8 | `src/bun_core/atomic_cell.rs:503-504` (`ThreadCell<T>`) | REVIEWED-HARDENING via EXP-047 | 7 + 8 | `unsafe impl<T: ?Sized> Sync for ThreadCell<T>` is **unbounded** and the owner latch is debug-only, so this is auditor-fragile. Codex safe-boundary correction: safe code can share `&ThreadCell<Cell<_>>` and obtain a raw pointer, but cannot dereference it or send that raw pointer across threads without `unsafe`; the old Miri race therefore demonstrated caller-contract violation, not Bun safe-API UB. Current in-tree ThreadCell statics (`IoRequestLoop`, `HTTPThread`) route cross-thread access only to documented queue/waker fields. Keep payload/access audits and consider a clearer unsafe wrapper name, but do **not** count this as confirmed UB. |
| F-DR-9 | `src/bun_core/util.rs:2276-2277` (`RacyCell<T>`) | REVIEWED-HARDENING via EXP-047 | 7 + 8 | `unsafe impl<T: ?Sized> Sync for RacyCell<T>` is **unbounded**. RacyCell's whole point is to be a "trust me" cell; its unsafe methods require callers to prove single-thread ownership or external synchronization. The EXP-047 Miri race required caller-side `unsafe { &*rc.get() }` on two threads, so it is not a project-UB witness. Current payloads still deserve per-site discipline review, and `UnsafeSyncCell`-style naming would make audits louder. |
| F-DR-10 | `src/sys/lib.rs:154-159, 183-192, 207-221, 804-808` (`dir_iterator::Name`) | CONFIRMED_UB | 7 + 8 + 15 | **Codex correction (2026-05-16):** this is stronger than the earlier cross-thread watchlist framing. POSIX `WrappedIterator::next(&mut self) -> Result<Option<IteratorResult>>` is safe and returns an owned `IteratorResult` with no lifetime tying `name` to `&mut self`. `Name = { ptr: NonNull<u8>, len }` points into the iterator's inline `getdents` buffer; the source comment correctly says it is invalidated by the next `next()` call or by moving/dropping the iterator, but Rust does not enforce that. Safe code can retain the entry, drop the iterator, and then call safe `entry.name.slice_u8()`. EXP-081 mirrors this API shape and default Miri reports `pointer not dereferenceable: ... has been freed, so this pointer is dangling`. Cross-bucket with EXP-027 (Windows cousin), but F-DR-10 now has its own POSIX witness. |
| F-DR-11 | `src/jsc/web_worker.rs:127-128 + 252` | NO_EVIDENCE via EXP-032 | 7 | Companion to F-DR-5: the `live_workers::HEAD: AtomicCell<*mut WebWorker>` (line 252) is updated via `register`/`unregister` under MUTEX, and the `Cell` link fields are written under the same MUTEX. Loom model supports the current serialization. Recommend `AtomicCell<*mut WebWorker>` / marker hardening for type-system clarity, not because a current race was proven. |
| F-DR-12 | `src/bundler/Chunk.rs:133-134` + `src/bundler/Chunk.rs:152` (`Chunk` Send/Sync, `CompileResultSlots`) | CONFIRMED_UB via EXP-111 | 7 + 1 + 8 | The intended disjoint-write pieces are sound-looking in isolation (`CompileResultSlots(Box<[UnsafeCell<CompileResult>]>)` with unique slot indices, plus atomic byte counters), but they do **not** justify the current worker API forming concurrent whole-owner `&mut Chunk` / `&mut LinkerContext`. EXP-111's default-Miri witness flags the retag/data-race at the `&mut Chunk` construction before any logical write is needed. The renamer-frozen-before-fan-out claim also needs a `SymbolMap::follow()` proof or no-compress read-only follow path. Cross-ref EXP-010/EXP-111. |
| F-DR-13 | 5 `Ordering::Relaxed` static-init+publish sites surveyed | DEFENSIBLE | 7 | `bun_safety::lib.rs:60, 66` (KNOWN_ALLOC_VTABLES, registered before reader threads spawn — happens-before via spawn edge); `bun_core::util::ARGV` (RacyCell, single-threaded startup); `bun_core::env_var` typed-cache (length-Acquire publishes pointer-Relaxed, audited Section N open Q1); `dotenv::env_loader::INSTANCE` (Release-publish + Acquire-read elsewhere); `install::PackageManager::CONFIGURE_ENV_FOR_SCRIPTS_ONCE` and `holder::RAW_PTR` (Release-store, paired Acquire-load on script-runner thread). All five have explicit publication-edge documentation; none are too-weak. |

---

## Enumerations

### Lock-free queue / channel surfaces and current model status

(Per Section P open question #4 — quoted: _"The `ThreadPool::Queue::cache: Cell<*mut Node>` non-atomic read/write under the `IS_CONSUMING`-CAS — has loom (or even a manual model) ever been run on it?"_ Answer: **no.**)

The historical answer above was true when this Phase-2 file was written.
Current status after Phase-5 closure is reflected in the table.

| crate | type | file:line | producers / consumers | sync edge | current model status |
|---|---|---|---|---|---|
| `bun_threading` | `ThreadPool::node::Queue` | `ThreadPool.rs:1480` | MPMC | `IS_CONSUMING` tag-bit CAS (Acquire) + `fetch_sub(Release)` | EXP-030 loom model clean / NO_EVIDENCE |
| `bun_threading` | `ThreadPool::node::Buffer` | `ThreadPool.rs:1668` | SPMC | All fields `AtomicU32`/`AtomicPtr` (no Cell, no UnsafeCell — auto-`Send + Sync`) | not required (no unsafe Sync) |
| `bun_threading` | `Channel<T, B>` | `channel.rs:35` | MPMC | `Mutex` + `Condition` | deferred soak/hardening for loose `B` bounds; distinct Bucket-5 uninit defect is EXP-033 |
| `bun_threading` | `UnboundedQueue<T>` | `unbounded_queue.rs:216` | MPSC | `front/back AtomicPtr` Acquire/Release | EXP-052 loom model clean / NO_EVIDENCE |
| `bun_runtime/bake` | `WatcherAtomics` | `WatcherAtomics.rs:10` | 1P-1C with triple buffer | `next_event: AtomicU8` AcqRel-swap + CAS | EXP-031 loom model clean / NO_EVIDENCE |
| `bun_jsc` | `live_workers::HEAD` + per-worker Cell links | `web_worker.rs:127, 252` | N producers (spawn) + 1 sweeper | `live_workers::MUTEX` | EXP-032 loom model clean / NO_EVIDENCE |

### Generic Send/Sync impls with too-weak bounds for cross-thread `Cell`/`RefCell` payloads

(Subset of the 79-site enumeration that is Bucket-7-relevant. Existing
Bucket-1 enumeration covered all 79; reproducing here only the rows that
fail when `T = Cell<X>` or `T = !Sync`.)

| type | file:line | bound | unsoundness when T is… | F-ID |
|---|---|---|---|---|
| `StoreSlice<T>` | `ast/nodes.rs:339-340` | none | any non-`Sync` T | EXP-019 |
| `JsCell<T>` | `jsc/JSCell.rs:126, 128` | none | any non-`Send`/`Sync` T (Sync says "JS-thread-only" but type permits cross-thread) | F-A-8 / Bucket-1 |
| `SendPtr<T>` (`bundler/BundleThread.rs:173`) | bundler crate | none | any non-`Send` T | F-A-8 / Bucket-1 |
| `SendPtr<T>` (`runtime/dns_jsc/dns.rs:107`) | dns_jsc crate | none | any non-`Send` T | F-A-8 / Bucket-1 |
| `AtomicCell<T>` Sync/Send | `bun_core/atomic_cell.rs:65-66` | `T: Copy` | `T = &Cell<U>` (Copy + !Send/!Sync + !Atom); safe `new()` + `into_inner()` bypass method gating and can move the reference cross-thread | F-DR-7 / EXP-098 |
| `ThreadCell<T>` Sync | `bun_core/atomic_cell.rs:503` | none for Sync | `T = Cell<X>` (Send + !Sync) | F-DR-8 hardening; EXP-047 safe-boundary correction |
| `RacyCell<T>` Sync | `bun_core/util.rs:2276` | none for Sync | any `T` | F-DR-9 hardening; EXP-047 safe-boundary correction |
| `BSSList<V>` Sync | `bun_alloc/lib.rs:2183` | `V: Send` for Sync | **Reviewed hardening only**: no safe `&self -> &V` accessor exists on `BSSList`; prior `at_index` citation was for `OverflowList` | F-DR-6 |
| `BackRef<T>` Send | `ptr/lib.rs:627-628` | `T: ?Sized + Sync` for Send | (Send needs `T: Send`, not just Sync; weak-but-symmetric) | Bucket-1 review |
| `ParentRef<T>` Send | `ptr/parent_ref.rs:406-407` | `T: ?Sized + Sync` for Send | same as BackRef | Bucket-1 review |
| `Name` (POSIX) | `sys/lib.rs:154-159, 183-192, 207-221, 804-808` | none | always (lifetime-erased borrow) | F-DR-10 / EXP-081 / Bucket-15 |

### Cell-on-`*mut` cross-thread (mutex-guarded but type-system-silent)

| type | field | file:line | mutex / atomic edge |
|---|---|---|---|
| `WebWorker` | `live_next`, `live_prev: Cell<*mut WebWorker>` | `web_worker.rs:127-128` | `live_workers::MUTEX` |
| `WebWorker` | `vm: Cell<*mut VirtualMachine>` | `web_worker.rs:145` | `vm_lock` |
| `WebWorker` | `worker_env_map`, `worker_env_loader: Cell<*mut …>` | `web_worker.rs:183-184` | worker-thread-only |
| `ThreadPool::Queue` | `cache: Cell<*mut Node>` | `ThreadPool.rs:1486` | `IS_CONSUMING` tag-bit CAS |
| `Channel<T,B>` | `buffer: UnsafeCell<LinearFifo>`, `is_closed: Cell<bool>` | `channel.rs:39, 43` | `mutex` |

All five are documented as "mutex / tag-bit serializes". The later loom pass
closed the highest-risk models as `NO_EVIDENCE`; keep them as regression guards
when these primitives change.

### Volatile-as-cross-thread-publication

Only **one** site: EXP-017 (`bun_io::Request::store_callback_seq_cst`).
The pattern is `core::ptr::write_volatile(&raw mut self.callback, cb); fence(SeqCst);`
followed by a plain read of `(request.callback)` on the io thread.
Primitive race model confirmed. **Superseding Phase 5 result:** the call-graph
overlap audit did not find a current path where stores happen after the
`Request` is visible to the io thread, so the registry verdict is now
`NO_EVIDENCE` for production UB. The primitive model remains a regression
guard; the Phase-3 fix, if future overlap appears, is an `AtomicPtr` callback
representation or a state-transition that prevents concurrent read/write.

---

## atomic_cell.rs re-confirmation (per brief)

Per Section N: re-confirmed that `bun_core::atomic_cell.rs` is clean for
the **methods** Acquire/Release/AcqRel default-ordering discipline:

* `load`: `Acquire` (line 92)
* `store`: `Release` (line 99)
* `swap`: `AcqRel` (line 106)
* `compare_exchange`: success `AcqRel`, failure `Acquire` (lines 119-120)
* `load_relaxed` / `store_relaxed`: the only Relaxed paths, **name-explicit**
  (lines 144, 151). Workspace grep confirms no other module defines these
  names; downstream opt-out sites are visible.

The two new Bucket-7 caveats are about the `unsafe impl` bounds, not the
operation orderings:

* `unsafe impl<T: Copy> Send/Sync` is broader than the `T: Atom` methods
  they gate — see F-DR-7.
* `unsafe impl<T: ?Sized> Sync for ThreadCell<T>` is unbounded — see F-DR-8.

Both fixes are local (tighten the `Sync` bound). No too-weak orderings
detected; no Release-without-Acquire pairings detected; the eight SeqCst
sites in `bun_ptr/ref_count.rs` (lines 474, 492, 527, 566, 588, 597, 1131,
1225) are over-conservative refcount RMWs (not UB; a performance polish
opportunity, not a soundness defect).

---

## Cross-bucket callouts

### Bucket 1 (aliasing) → Bucket 7 promotions

* **EXP-010** (`LinkerContext` 5-site cluster): the aliasing-on-`&mut`
  exists *between worker threads*, not just within one thread. Tree-Borrows
  caught it as Bucket-1 UB; loom would also catch it as Bucket-7
  data-race. Phase-3 sketch should run both tools.
* **EXP-030** (`bundle_v2.rs:1216, 1227, 1362, 1376` `self.bv2` reborrow):
  same shape — JS trampoline forms `&mut BundleV2` while a worker still
  holds one. Bucket-1 finding; also a Bucket-7 race surface if both threads
  execute concurrently. Loom + TB model.
* **F-A-2 cluster** (95 `from_field_ptr!` sites; 13 raw-enumerated shapes
  form `&mut Parent`, with 9 still-risky after the dispatch io_poll demotion):
  the parent-recovery in worker callbacks (e.g.
  `ParseTask.rs:354, 362`, `ThreadPool.rs:563`) crosses thread boundaries.
  Each is also a Bucket-7 surface.

### Bucket 8 (Send/Sync) → Bucket 7 race instances

Too-weak `unsafe impl Sync` entries split into two categories:

- Confirmed safe-API UB where safe methods expose the non-`Sync` payload (`StoreSlice<T>`, `JsCell<T>`, `AtomicCell<T: Copy>` via EXP-019 / EXP-045 / EXP-098).
- Hardening-only wrappers where safe code only obtains raw pointers and the actual race requires caller-side `unsafe` (`RacyCell<T>` / `ThreadCell<T>` via the EXP-047 correction).

Do not collapse those two categories. The former count as confirmed UB; the latter stay on the payload/access-discipline audit list.

### Bucket 13 (refcount lifecycle) → Bucket 7 cross-thread

`bun_ptr::ref_count` uses SeqCst for refcount RMWs; `raw_ref_count.rs:105`
uses the correct `fetch_sub(Release) → fence(Acquire)` pattern when count
reaches zero. No too-weak orderings here. The Bucket-13 finding registry
in `phase2_findings_13_refcount.md` already covers the lifecycle layer.

### Bucket 15 (lifetime escape) → Bucket 7

`dir_iterator::Name` Send/Sync (F-DR-10) is both Bucket-8 (`unsafe impl`)
and Bucket-15 (lifetime-erased borrow). Earlier text treated Bucket 7 as
conditional on a live cross-thread caller; EXP-081 shows cross-thread use is
not required for UB. The safe lifetime escape alone is enough: retain the
entry, drop or advance the iterator, then call the safe `slice_u8()` accessor.

---

## Open questions

1. Should `unsafe impl<T: Copy> Send/Sync for AtomicCell<T>` (F-DR-7) be
   tightened to `unsafe impl<T: Atom> Send/Sync`? Methods are gated; the
   impl is loose for stylistic-Send/Sync-symmetry. Defensible but tightenable.
2. Should `unsafe impl<T: ?Sized> Sync for ThreadCell<T>` (F-DR-8) require
   `T: Send`/`T: Sync`, or should the type be renamed to make the unsafe
   contract louder? Workspace usage is currently disciplined; this is a
   hardening question after EXP-047's safe-boundary correction.
3. Keep `BSSList<V> Sync` (F-DR-6) on the hardening list: make fields private,
   and require `V: Sync` if a safe shared accessor is ever added. Workspace usage is
   `u8`-payload, so non-reachable today; one-line bound fix.
4. Keep the loom models for ThreadPool::Queue / UnboundedQueue /
   WatcherAtomics / live_workers as regression guards. `Channel<T, B>` remains
   a deferred soak/hardening target for its loose generic bound; do not count it
   as a current race without a failing model.
5. EXP-017's source overlap has been audited: no current path invokes
   `store_callback_seq_cst` after the Request is shared with the IO thread.
   Keep the primitive race model as a regression guard, not as production UB.

---

## Summary

* **Existing EXP cross-refs**: EXP-010 (bundler aliasing also races),
  EXP-017 (volatile-as-publication regression guard), EXP-019 (`StoreSlice<T>`
  unbounded Send/Sync), EXP-026 (timer re-entry; intra-thread only), EXP-030
  (ThreadPool::Queue loom clean), EXP-031 (WatcherAtomics loom clean), EXP-032
  (WebWorker Cell model clean), and EXP-052 (UnboundedQueue loom clean). Do not
  use the old pre-registration placeholder.
* **13 new findings** (F-DR-1 .. F-DR-13).
* **3 enumerations completed**:
  1. Lock-free queue / channel surfaces and current model status (6 distinct
     surfaces; ThreadPool::Buffer is the only one auto-`Sync` from atomic-only
     fields).
  2. Generic Send/Sync impls with too-weak bounds for `Cell`/`!Sync`
     payloads (11 sites, 6 of which are Bucket-7-fresh; the other 5 cross-ref
     Bucket-1's EXP-019/F-A-8 enumeration).
  3. Cell-on-`*mut` cross-thread fields (5 sites; all mutex/CAS-serialised,
     key models now verified clean).
* **No new too-weak atomic orderings** beyond EXP-017's volatile-not-atomic.
* **No new unscoped Relaxed** sites: 749 Relaxed literals surveyed (via grep
  spot-check on the 30 most-frequent caller files); every spot-checked site
  has either an inline publication-edge comment or carries scalar state that
  does not publish separate memory.

### Top-3 Bucket-7 regression guards / hardening targets

1. **F-DR-5 / F-DR-11** (`WebWorker` Cell-cross-thread): EXP-032 loom model is
   clean, but this remains worth guarding because `terminate_all_and_wait` is a
   high-reachability path and the type-system story is subtle.
2. **F-DR-1** (`ThreadPool::Queue::cache: Cell<*mut Node>`): EXP-030 loom model
   is clean; keep it as a hot-path regression guard for worker-pool changes.
3. **F-DR-4** (`WatcherAtomics` 3-state AcqRel + non-atomic
   `current_event`/`pending_event` indices): EXP-031 loom model is clean; keep
   it as a regression guard because the triple-buffer handoff is intricate.
