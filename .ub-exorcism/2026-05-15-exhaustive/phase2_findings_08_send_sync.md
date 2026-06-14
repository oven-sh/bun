# Phase 2 Bucket 8: Send/Sync invariants — findings

Static-bucket sweeper run for Bucket 8 (every `unsafe impl Send`/`unsafe impl
Sync` workspace-wide; auto-trait laundering of `!Send`/`!Sync` payloads across
thread boundaries; missing `_not_send` / `PhantomData<*const ()>` markers on
guards; concrete cross-thread carriers that ferry FFI / JS-thread-affine
handles). Source-tree-only (no Miri, no loom). Numbers are workspace-wide
unless scoped.

---

## Current-status overlay (Codex follow-up, 2026-05-16)

This Phase-2 file is a historical bucket-sweeper artifact. The live registry
and final report supersede several status labels below.

Current source re-count:

```text
rg -n --glob '*.rs' 'unsafe\s+impl\s*(<[^>]+>)?\s*(Send|Sync)\s+for\s+' src | wc -l  # 157
rg -n --glob '*.rs' 'unsafe\s+impl\s*<[^>]+>\s*(Send|Sync)\s+for\s+' src | wc -l     # 42
rg -n --glob '*.rs' 'unsafe\s+impl\s*(Send|Sync)\s+for\s+' src | wc -l               # 115
```

Live verdict corrections:

- **EXP-018** is now `CONFIRMED_UB` after the
  source-faithful auto-trait witness (`phase5_experiment_results/EXP-018-source-faithful-autotrait.log`).
- **EXP-045** (`JsCell<T>`) is now
  `CONFIRMED_UB` with a Miri data-race witness.
- **EXP-047** (`RacyCell<T>` / `ThreadCell<T>`) has been corrected to
  `NO_EVIDENCE` as a Bun UB finding. The Miri race requires caller-side
  `unsafe` raw-pointer deref; safe code can share the wrapper and call `get()`,
  but cannot dereference or send the raw pointer across threads.
- The two generic `SendPtr<T>` rows remain hardening-only after source audit:
  `dns.rs` is module-private and currently only wraps `*mut Request`;
  `BundleThread.rs` is function-local and currently only wraps `*mut Self`.

No new EXP was promoted by this Send/Sync follow-up. The correction is
count/status hygiene so maintainers do not read stale Phase-2 labels as live
registry state. The round-78 convergence snapshot recorded 58
`CONFIRMED_UB`, 0 `OPEN`, 0 `NEEDS_REFINEMENT`, 15 `NO_EVIDENCE`, 16
`DEFERRED`, and 2 `RESOLVED` across 91 registry EXP entries. That snapshot is
historical; the current pinned-base totals are maintained in
`FINAL_UB_REPORT.md` and supersede this Phase-2 checkpoint.

---

## Cross-refs to existing EXP entries

| EXP-ID | file:line | severity | one-line |
|---|---|---|---|
| EXP-018 | `src/threading/guarded.rs:132-134` | CONFIRMED_UB | `GuardedLock<…, Mutex>` missing `_not_send: PhantomData<*const ()>`; source-faithful auto-trait witness confirms safe Rust can move the held guard to another OS thread; PR #30765 unmerged |
| EXP-019 | `src/ast/nodes.rs:339-340` | CONFIRMED_UB | `unsafe impl<T> Send/Sync for StoreSlice<T>` unbounded; Phase-5 standalone Miri raced `Cell<u32>` through safe API; PR #30765 unmerged |
| EXP-027 (Bucket 8 root-cause half) | `src/bun_core/lib.rs:211-212`; `src/runtime/node/dir_iterator.rs:44-67` | CONFIRMED_UB | `RawSlice<T>: Send if T: Sync` lets the iterator-scratch `Result<RawSlice<u16>, …>` cross the dirent thread boundary even though the iterator state it borrows from is single-threaded |
| EXP-082 | `src/jsc/webcore_types.rs:60-96, 220-231`; `src/runtime/webcore/Blob.rs:1509,1557,1869,1911` | CONFIRMED_UB (generic safe-API contract) | `Blob: Send + Sync` plus safe `Blob::global_this(&self) -> Option<&JSGlobalObject>` exposes a JS-thread-affine opaque handle from `Arc<Blob>` whenever the pointer is present; Phase-5 Miri raced the same safe API shape via a `Cell` payload. |
| EXP-083 | `src/runtime/shell/IOWriter.rs:237-252, 969-985`; `src/runtime/shell/IOReader.rs:72-100, 220-268` | CONFIRMED_UB (generic safe-API contract) | `IOWriter` / `IOReader` are `Sync` and expose safe `&self` mutators over `UnsafeCell<State>`; Phase-5 Miri rejects the safe two-thread `enqueue(&self)` shape under Stacked Borrows. |
| EXP-084 | `src/jsc/VirtualMachine.rs:604-688` | CONFIRMED_UB (generic safe-API contract) | `VirtualMachine: Send + Sync` lets `&VirtualMachine` cross threads, while safe `as_mut()` / `get_mut()` assume the current thread's TLS VM slot exists and use `unwrap_unchecked`; Phase-5 Miri `--release` reports UB when a safe captured `&VirtualMachine` calls `as_mut()` on a non-VM thread. Direct safe `VirtualMachine::get_mut()` on a non-VM thread reaches the same unchecked precondition. |

---

## New findings (this phase)

| F-ID | file:line | severity | bucket cross-tags | draft-experiment-sketch (≤10 lines) |
|---|---|---|---|---|
| F-S-1 | `src/jsc/JSCell.rs:126-128` | MUST_BE_UB / CONTRACT_DEFECT | 8 + 1 + 7 | `unsafe impl<T> Send/Sync for JsCell<T>` (unbounded). SAFETY explicitly says "single JS thread", but the public safe API exposes `JsCell::new(value)` and `get(&self) -> &T`. Phase 5 EXP-045 confirms a faithful `static JsCell<Cell<u32>>` witness: safe calls to `get().set(...)` from two threads produce a Miri data race. |
| F-S-2 | `src/runtime/dns_jsc/dns.rs:104-107` | CONTRACTUAL-BUT-DEFENSIBLE / HARDENING | 8 + 13 | `unsafe impl<T> Send for SendPtr<T>` is syntactically unbounded, but the type is private to `dns.rs` and current source constructs it only as `SendPtr(req)` for `req: *mut Request` at `dns.rs:3080`. External safe Rust cannot instantiate `SendPtr<Cell<_>>`; misuse requires editing this module. Refactor to a non-generic `DnsRequestPtr(*mut Request)` or a bounded shared `SendPtr<T: Send>` helper, but do not count this as a current UB finding. |
| F-S-3 | `src/bundler/BundleThread.rs:170-173` | DEFENSIBLE / HARDENING | 8 + 13 | Function-local `struct SendPtr<T>(*mut T)` inside `BundleThread::spawn`. Current source instantiates it exactly once with `instance: *mut Self`, moves it into the spawned thread, and immediately calls `Self::thread_main(ptr.0)`. Because the type is function-local, no outside caller can construct a bad `SendPtr<Cell<_>>`; the generic is unnecessary but not a current safe-API defect. Refactor to `SpawnPtr(*mut Self)` for clarity. |
| F-S-4 | `src/bun_core/atomic_cell.rs:65-66` | CONFIRMED_UB via EXP-098 | 8 + 7 + 11 | `unsafe impl<T: Copy> Sync for AtomicCell<T>` / `Send for AtomicCell<T>` is too broad. The previous contract-hole wording undercounted the issue by focusing on `Atom`-bearing pointer payloads. EXP-098 proves a safe call path using the real `bun_core::AtomicCell`: construct `AtomicCell<&Cell<u32>>`, move it to a scoped thread because the wrapper is `Send`, call safe `into_inner()`, and race the returned `&Cell<u32>` against the original thread. Miri reports a data race. Fix: tighten the auto-trait impls / constructor surface so `T: Copy + !Send/!Sync + !Atom` cannot become a Send wrapper. |
| F-S-5 | `src/bun_core/atomic_cell.rs:503-504` | REVIEWED-HARDENING | 8 + 7 | `unsafe impl<T: ?Sized> Sync for ThreadCell<T>` (Sync unbounded; Send correctly bounded `T: Send`). This is auditor-fragile, but EXP-047's safe-boundary check shows safe code only obtains a raw pointer; the old Miri race required caller-side `unsafe` deref. Current main has two `ThreadCell<MaybeUninit<...>>` statics (`src/io/lib.rs:674`, `src/http/lib.rs:727`), and their cross-thread paths are narrowed to queue/waker fields. |
| F-S-6 | `src/bun_core/util.rs:2276-2277` | REVIEWED-HARDENING | 8 + 7 | `unsafe impl<T: ?Sized> Sync for RacyCell<T>` (unbounded). The SAFETY block (lines 2266-2275) intentionally makes this a "trust me" cell and warns against wrapping load-bearing `!Sync` payloads. EXP-047 is now `NO_EVIDENCE` as project UB because the race witness violates the caller-side raw-pointer contract. Keep payload/access audits and consider clearer naming. |
| F-S-7 | `src/install/windows-shim/main.rs:214` | DEFENSIBLE | 8 | Same `unsafe impl<T: ?Sized> Sync for RacyCell<T>` shape as F-S-6, but in a single-binary install-time shim that the comment promises is single-threaded (line 213). Lower exposure but identical contract-fragility. |
| F-S-8 | `src/jsc/WorkTask.rs:58` | LIKELY_UB / CONFIRMED_UNSAFE_CONTRACT | 8 + 21 | `unsafe impl<C: WorkTaskContext> Send for WorkTask<C>` — the trait lacks `C: Send`. Phase 5 EXP-046 now has both a generic owned-wrapper Miri witness and a Send-bound compile experiment showing all 7 real contexts fail `+ Send`. Production `WorkTask` stores `ctx: *mut C`, so per-context exploitability still requires source review, but the safe trait boundary is unsound. |
| F-S-9 | `src/jsc/ConcurrentPromiseTask.rs:55` | LIKELY_UB / CONFIRMED_UNSAFE_CONTRACT | 8 + 21 | Same generic-bound shape as F-S-8; stronger because this wrapper owns `ctx: Box<C>`. The temporary `+ Send` bound fails on `CopyFile`, `PipelineTask`, `TransformTask`, and `WalkTask`; the wrapper-level `unsafe impl Send` is what permits these non-`Send` contexts to cross the work-pool boundary. |
| F-S-10 | `src/ptr/lib.rs:627-628`; `src/ptr/parent_ref.rs:406-407` | DEFENSIBLE / NEEDS_REVIEW | 8 + 13 | `BackRef<T>` / `ParentRef<T>` use `unsafe impl<T: ?Sized + Sync> Send + Sync`. SAFETY claims "morally `&T`, so match `&T` rules" — but `&T: Send ⇔ T: Sync` (correct) AND `&T: Sync ⇔ T: Sync` (correct) — so on the *Send* side this is sound. The escape hatch is `BackRef::get_mut(&self) -> &mut T` / `ParentRef::assume_mut`, which is `unsafe` and pushes the `T: Send` requirement onto the call site. The risk is the same as `&UnsafeCell<T>`: it compiles even when crossing-thread `get_mut` would race. Verdict: defensible, matches `&T` auto-trait, but the cross-thread `get_mut` callers are not enumerated. |
| F-S-11 | `src/jsc/webcore_types.rs:60-96, 220-231`; `src/runtime/webcore/Blob.rs:1509,1557,1869,1911` | MUST_BE_UB / GENERIC_SAFE_API_CONTRACT | 8 + 21 + 7 | `unsafe impl Send/Sync for Blob` plus safe `Blob::global_this(&self) -> Option<&JSGlobalObject>` exposes a JS-thread-affine opaque JSC handle through any shared `&Blob` / `Arc<Blob>`. `JSGlobalObject` is documented as `!Send + !Sync`, and `JSGlobalObject::bun_vm()` says same-thread callers only; several Blob paths immediately call `self.global_this().expect(...).bun_vm().as_mut().event_loop()`. EXP-082 confirms the generic safe-API shape with Miri: two threads use only safe code to obtain the thread-affine payload through a `Blob`-shaped wrapper and race a `Cell<u32>`. Keep production exploitability separate: no current report proves a live off-thread Blob caller reaches `global_this()`, but the public safe contract is unsound. |
| F-S-12 | `src/runtime/shell/IOWriter.rs:237-252, 969-985`; `src/runtime/shell/IOReader.rs:72-100, 220-268` | MUST_BE_UB / GENERIC_SAFE_API_CONTRACT | 8 + 7 + 1 | `unsafe impl Send/Sync for IOWriter`/`IOReader` with SAFETY "shell is single-threaded; Arc is purely for refcounting" is not just a comment gap: both types expose safe `&self` mutators over `UnsafeCell<State>` (`IOWriter::enqueue`, `cancel_chunks`, `set_interp`; `IOReader::start`, `add_reader`, `remove_reader`). EXP-083 confirms the same safe shared API shape under Miri. The old "last Arc drops on another thread" rationale was too weak by itself; the correct UB proof is safe concurrent method calls on a `Sync` type. |
| F-S-13 | `src/runtime/shell/builtin/rm.rs:710-714` | UNDOCUMENTED_AMBIGUITY | 8 | `unsafe impl Send for ShellRmTask` and `unsafe impl Send for DirTask` share a single SAFETY comment that conflates two different invariants ("raw pointers only dereferenced on owning threads"). H-notes line 38-41 explicitly flagged the dual-type comment. Low severity (both types are real worker-pool sends) but auditor-fragile. |
| F-S-14 | `src/jsc/VirtualMachine.rs:604-688` | MUST_BE_UB / GENERIC_SAFE_API_CONTRACT | 8 + 7 + 21 | `unsafe impl Send/Sync for VirtualMachine` is not merely a foundational documentation lie. The `Sync` impl permits a safe `&'static VirtualMachine` from `VirtualMachine::get()` to be captured by a non-VM thread, and safe `as_mut(&self)` / `get_mut()` route through a thread-local slot with `unwrap_unchecked()`. EXP-084 confirms the generic safe-API defect under Miri `--release`: on a thread without a VM installed, safe `captured_vm.as_mut()` enters unreachable code. Direct safe `VirtualMachine::get_mut()` on a non-VM thread is an even simpler manifestation of the same unchecked TLS precondition. Do not claim a current production caller without an in-tree capture path; do count the safe Rust API boundary as unsound. |
| F-S-15 | `src/bun_core/string/mod.rs:1264-1265` | DEFENSIBLE / DOCUMENTED | 8 | `unsafe impl Send/Sync for bun_core::String` — SAFETY at lines 1255-1263 explicitly admits the type can hold a per-thread-table `AtomString` payload that is **NOT** safe to drop off-thread, and pushes the burden onto `to_thread_safe()` + `debug_assert_thread_safe()`. Repository-wide CLAUDE.md (§Cross-thread string hazards) names this as the canonical bug pattern. Type-system fix is the `ThreadSafeString` newtype split mentioned in the comment but explicitly deferred. |
| F-S-16 | `src/bundler/Chunk.rs:133-134` plus `linker_context/generateCompileResultFor{JS,Css}Chunk.rs` | CONFIRMED_UB via EXP-111 | 8 + 1 + 7 | `unsafe impl Send/Sync for Chunk` sits on top of a part-range worker path that still materializes concurrent whole-owner `&mut Chunk` / `&mut LinkerContext` from shared raw pointers. The TODO at lines 130-132 about `Renamer<'r>` borrowing `&'r mut {Number,Minify}Renamer` is real, but it is not the only issue: default Miri flags the concurrent `&mut Chunk` retag itself, while Tree Borrows accepts the current read-only standalone model. A renamer-only patch is incomplete; the worker API must stop creating overlapping whole-owner `&mut` references and then make renamer/follow lookup shared/read-only. |
| F-S-17 | `src/bundler/LinkerGraph.rs:96-97` | DEFENSIBLE | 8 + 1 | `unsafe impl Send/Sync for LinkerGraph` with extensive SAFETY (lines 76-95) listing exactly which columns workers may touch through `&LinkerGraph`. Disciplined; bound implicitly because `Symbol.chunk_index: AtomicU32` is interior-mutable. Lower risk than `Chunk`; raises only if a new column gets a non-atomic mutator. |
| F-S-18 | `src/bundler/ThreadPool.rs:77-78` | DEFENSIBLE | 8 + 1 | `unsafe impl Send/Sync for ThreadPool` — SAFETY notes `workers_assignments` is `Guarded`, but holds `v2: *const BundleV2<'static>` as a raw backref. The pointee is `BundleV2<'static>` whose own Send/Sync is implicit. EXP-030 / F-A-7 (Bucket 1) cover the dereference half. |
| F-S-19 | `src/jsc/hot_reloader.rs:421-422` | DEFENSIBLE | 8 | `unsafe impl Send/Sync for WatchChangedPaths` — published once before watcher spawn; SAFETY at line 418 cites watcher-thread-only access after init-once publish. Sound init-once pattern. |
| F-S-20 | `src/runtime/node/path_watcher.rs:108-109` | DEFENSIBLE | 8 | `unsafe impl Send/Sync for PathWatcherManager` — disciplined: `UnsafeCell` fields are mutex-guarded; `platform_fd` is set once before reader thread; SAFETY block is exhaustive. Sound. |
| F-S-21 | `src/sys/lib.rs:5890-5891` | DEFENSIBLE | 8 | `unsafe impl Send/Sync for DynLib` — opaque OS handle from `dlopen`; SAFETY cites internal loader synchronization. Matches `std::DynLib` historical behavior. Sound. |
| F-S-22 | `src/io/windows_event_loop.rs:377-378` | DEFENSIBLE | 8 | `unsafe impl Send/Sync for Waker` — `wake()` forwards to `uv_async_send`, the documented cross-thread wake path. Sound. |
| F-S-23 | `src/runtime/node/fs_events.rs:208-209, 252-253` | DEFENSIBLE | 8 | `unsafe impl Send/Sync for CoreFoundation`/`CoreServices` — leaked `dlopen` handles and resolved fn pointers; immutable after init. Sound. |
| F-S-24 | `src/perf/tracy.rs:673` / `src/runtime/napi/napi_body.rs:1994` / `src/runtime/node/node_process.rs:91` / `src/bun_core/Global.rs:816` | DEFENSIBLE | 8 | Single-purpose `*const c_char → 'static literal` Sync wrappers (`___tracy_source_location_data`, `napi_node_version`, `CStrPtr`, `SyncCStr`). All four are FFI-statics pointing at compile-time `concatcp!` output. Sound. |
| F-S-25 | `src/jsc/webcore_types.rs:615-616` (Bytes); `src/jsc/webcore_types.rs:1200-1201` (StoreRef) | DEFENSIBLE | 8 | `Bytes` is morally `Vec<u8>+allocator`; `StoreRef` is atomic-refcounted. Both have careful SAFETY narratives; lower risk than `Blob`. |
| F-S-26 | `src/bundler/lib.rs:341-342` | LIKELY_UB_SHAPE | 8 + 13 | `unsafe impl Send/Sync for DevServerHandle` — type-erased fn-vtable + opaque-owner handle (`link_interface!` macro). The live source risk is not just "owner may not be Send+Sync": the generated handle has public `kind`/`owner` fields, so safe callers can bypass `unsafe fn new` entirely (EXP-080). Keep the Send/Sync row as a concurrency proof obligation, but route the concrete safe-API unsoundness through F-S-32 / EXP-080. |
| F-S-27 | `src/bundler/bundle_v2.rs:1543-1544` | DEFENSIBLE-WITH-SEQUENCING-EVIDENCE | 8 + 13 | `unsafe impl Send/Sync for CompletionHandle` — erased `*mut JSBundleCompletionTask` backref + `&'static CompletionDispatch` vtable. Source audit shows `result` is set on the bundle thread before `complete_on_bundle_thread()` posts the JS-thread completion task; `DeferredBatchTask::run_on_js_thread` later reads `result_is_err()` on the JS thread. No concurrent read/write was proven in this pass. Still cross-reference F-S-32 / EXP-080 because `CompletionHandle` also exposes public `owner`/`vtable` fields that safe code can forge. |
| F-S-28 | `src/runtime/api/js_bundle_completion_task.rs:106` | REVIEWED-FOLLOW-UP | 8 + 13 | `unsafe impl Send for JSBundleCompletionTask` — **Send only, no Sync**, while `CompletionHandle` asserts `Sync`. The prior wording over-implied a live race. The concrete call path observed here is bundle-thread mutation → JS-thread enqueue → later JS-thread read; that sequencing may be sound. Remaining question for hardening: whether any path copies `CompletionHandle` into concurrently executing worker callbacks and calls `result_is_err()` / `enqueue_task_concurrent()` while `JSBundleCompletionTask.result` or `jsc_event_loop` is being mutated. This is not an open registry experiment. |
| F-S-29 | `src/resolver/fs.rs:1841-1842` (Entry); `:1836-1837` (EntriesOption); `src/resolver/lib.rs:897-898` (mirror) | DEFENSIBLE / DUPLICATED | 8 | Triple-declared `unsafe impl Send/Sync` for the same Entry/EntriesOption types (re-export at the resolver tier). SAFETY at `:1839` cites the `RealFS.entries_mutex` invariant. Duplication is brittle — three different SAFETY blocks for the same invariant. |
| F-S-30 | `src/semver/SemverQuery.rs:131-132` (List); `:261-262` (Group) | DEFENSIBLE / DOCUMENTED | 8 | `unsafe impl Send/Sync for List`/`Group` — self-referential intrusive `NonNull` tail + lifetime-erased `*const [u8]` source borrow. SAFETY explicitly acknowledges the lifetime erasure; Zig sent these freely across the lockfile thread pool. Sound by-construction but the lifetime-erasure deserves an `'a` parameter (compose with EXP-021 / F-A-6 lifetime-laundering family in Bucket 1). |
| F-S-31 | `src/jsc/web_worker.rs:590`; `src/jsc/Debugger.rs:593`; `src/bundler/bundle_v2.rs:1543`; `src/bundler/BundleThread.rs:389` | DEFENSIBLE | 8 | Four `fn`-local `struct SendPtr(*mut T)` + `unsafe impl Send for SendPtr {}` shapes, each scoped to a single `thread::spawn` block (release-pattern). All four are sound by construction (the local type is uninhabited by user code) but should be replaced by a single shared `bun_threading::SendPtr<T>` newtype to avoid the pattern drift seen in F-S-3 (where an identical `BundleThread::spawn`-local `SendPtr<T>` is *generic*-unbounded). |
| F-S-32 | `src/dispatch/lib.rs:302-318`; generated handles including `src/bundler/lib.rs:326-342` | MUST_BE_UB_SAFE_API | 8 + 10 + 11 | `bun_dispatch::link_interface!` says `unsafe fn new()` establishes the `kind`/`owner` validity invariant, but then emits `pub kind` and `pub owner`. Safe Rust can forge `DevServerHandle`, `VmLoaderCtx`, `OutputSink`, `Pollable`, etc. with an arbitrary owner pointer and call safe dispatch methods that dereference it in macro-generated unsafe thunks. EXP-080 is Miri-confirmed on the minimized macro shape. |

---

## Enumerations

### unsafe impl Send/Sync workspace-wide — historical count superseded

The original Phase-2 sweep counted 115 rows total. The 2026-05-16 re-count on
the audited-base checkout (`origin/main@4d443e5402`) finds **157** textual
rows: **115 concrete** plus **42 generic**. Keep the risk-classification below
as a useful historical categorization, but use the audited-base overlay above
for pinned-run counts.

**rg-confirmed totals (audited base `origin/main@4d443e5402`):**

- `unsafe impl Send for …` / `unsafe impl Sync for …` (concrete): **115** rows
- `unsafe impl<…> Send for …` / `unsafe impl<…> Sync for …` (generic): **42** rows
- **TOTAL: 157 `unsafe impl` rows**

Section F (server + jsc_hooks) and Section E (socket) confirmed **zero local
`unsafe impl Send/Sync` rows** (`rg 'unsafe impl (Send|Sync)' src/runtime/server/
src/runtime/socket/ src/runtime/jsc_hooks.rs src/http_jsc/websocket_client/`
returns empty). They lean on the upstream `*mut Self` discipline (R-2 pattern;
see Bucket 1 finding F-A-2) and the `bun_http::SSLConfig` re-export.

### Generic Send/Sync — bound-analysis (42 rows after re-count)

| crate | file:line | type | bound on T | safety_status |
|---|---|---|---|---|
| `bun_ast` | `src/ast/nodes.rs:39-40` | `StoreRef<T>` | `T: Send` / `T: Sync` | SOUND_BOUNDED |
| `bun_ast` | `src/ast/nodes.rs:339-340` | `StoreSlice<T>` | **UNBOUNDED** | EXP-019 CONFIRMED_UB |
| `bun_jsc` | `src/jsc/JSCell.rs:126,128` | `JsCell<T>` | **UNBOUNDED** | EXP-045 CONFIRMED_UB |
| `bun_runtime/dns_jsc` | `src/runtime/dns_jsc/dns.rs:107` | `SendPtr<T>` (module-private) | **UNBOUNDED syntax; current T fixed to Request** | F-S-2 hardening |
| `bun_bundler` | `src/bundler/BundleThread.rs:173` | `SendPtr<T>` (fn-local but **generic**) | **UNBOUNDED syntax; function-local current T fixed to Self** | F-S-3 hardening |
| `bun_core` | `src/bun_core/atomic_cell.rs:65-66` | `AtomicCell<T>` (Sync, Send) | `T: Copy` | F-S-4 CONFIRMED_UB (EXP-098) |
| `bun_core` | `src/bun_core/atomic_cell.rs:503-504` | `ThreadCell<T>` Sync / Send | Sync **UNBOUNDED** ; Send `T: Send` | F-S-5 hardening (EXP-047 `NO_EVIDENCE`; project-UB claim demoted) |
| `bun_core` | `src/bun_core/util.rs:2276-2277` | `RacyCell<T>` Sync / Send | Sync **UNBOUNDED** ; Send `T: Send` | F-S-6 hardening (EXP-047 `NO_EVIDENCE`; project-UB claim demoted) |
| `bun_core` | `src/bun_core/lib.rs:211-212` | `RawSlice<T>` Send / Sync | `T: Sync` | EXP-027 root-cause |
| `bun_core` | `src/bun_core/util.rs:2685-2686` | `Once<T, F>` Sync / Send | `T: Send+Sync, F: Sync` / `T: Send, F: Send` | SOUND_BOUNDED (std parity) |
| `bun_alloc` | `src/bun_alloc/lib.rs:2182-2183` | `BSSList<V, COUNT>` Send / Sync | `V: Send` (both) | SOUND_BOUNDED (Mutex<T>: Sync ⇔ T: Send pattern) |
| `bun_install/windows-shim` | `src/install/windows-shim/main.rs:214` | `RacyCell<T>` Sync (Send not impl'd) | **UNBOUNDED** ?Sized | F-S-7 DEFENSIBLE (single-binary shim) |
| `bun_collections` | `src/collections/multi_array_list.rs:556-557` | `MultiArrayList<T,A>` Send / Sync | `T+A: Send` / `T+A: Sync` | SOUND_BOUNDED |
| `bun_collections` | `src/collections/array_hash_map.rs:1561-1562` | `StringHashMapKey<A>` Send / Sync | `A: Allocator + Default + Send/Sync` | SOUND_BOUNDED |
| `bun_threading` | `src/threading/RwLock.rs:157-158` | `RwLock<T>` Send / Sync | `T: Send` / `T: Send+Sync` | SOUND_BOUNDED (std parity) |
| `bun_threading` | `src/threading/channel.rs:47-49` | `Channel<T, B>` Send / Sync | `T: Send, B: LinearFifoBuffer<T>` | SOUND_BOUNDED (B has no `Send` bound but trait is data-bag) |
| `bun_threading` | `src/threading/guarded.rs:38` | `GuardedBy<V, M>` Sync | `V: Send, M: RawMutex + Sync` | SOUND_BOUNDED (std-Mutex parity) |
| `bun_ptr` | `src/ptr/lib.rs:627-628` | `BackRef<T>` Send / Sync | `T: ?Sized + Sync` (both) | F-S-10 DEFENSIBLE (matches `&T` rules) |
| `bun_ptr` | `src/ptr/parent_ref.rs:406-407` | `ParentRef<T>` Send / Sync | `T: ?Sized + Sync` (both) | F-S-10 DEFENSIBLE |
| `bun_jsc` | `src/jsc/WorkTask.rs:58` | `WorkTask<C>` Send | `C: WorkTaskContext` (no `C: Send` bound on trait) | F-S-8 LIKELY_UB |
| `bun_jsc` | `src/jsc/ConcurrentPromiseTask.rs:55` | `ConcurrentPromiseTask<'_, C>` Send | `C: ConcurrentPromiseTaskContext` (no `C: Send` bound on trait) | F-S-9 LIKELY_UB |
| `bun_bundler` | `src/bundler/LinkerContext.rs:239-240` | `LinkerContext<'a>` Send / Sync | lifetime-only | DEFENSIBLE (EXP-010 cluster relies) |
| `bun_bundler` | `src/bundler/LinkerContext.rs:1632-1633` | `GenerateChunkCtx<'a>` Send / Sync | lifetime-only | DEFENSIBLE (sibling of EXP-010) |
| `bun_css` | `src/css/declaration.rs:53-54` | `DeclarationBlock<'bump>` Send / Sync | lifetime-only | DEFENSIBLE (post-parse-immutable) |
| `bun_css` | `src/css/rules/mod.rs:173-174` | `CssRule<R>` Send / Sync | `R: Send` / `R: Sync` | SOUND_BOUNDED |

**Generic Send/Sync verdict:**
- **4 unbounded-generic shapes (EXP-019 + F-S-1, F-S-2, F-S-3).** EXP-019 and F-S-1 are confirmed safe-API defects. F-S-2 and F-S-3 are hardening-only after source audit because their unbounded wrapper types are private/function-local and current instantiations are fixed to the intended raw pointer type.
- **1 partially-bounded confirmed UB-class (F-S-4 `AtomicCell<T: Copy>` now EXP-098-confirmed) plus 2 hardening-only cell wrappers (F-S-5 `ThreadCell<T>`, F-S-6 `RacyCell<T>` after the EXP-047 safe-boundary correction).**
- **2 Context-trait-bounded but missing `Send` on the trait (F-S-8 `WorkTask<C>`, F-S-9 `ConcurrentPromiseTask<C>`).** These are now covered by EXP-046 / CONFIRMED_UB at the unsafe-contract boundary after the Send-bound compile experiment; per-context production exploitability remains remediation detail.
- 11 lifetime-only generics (sound for the auto-trait but rely on Bucket-1 aliasing discipline).
- 22 standard-pattern `T: Send`/`T: Sync` bounds matching `Mutex<T>` / `RwLock<T>` / `&T` shapes (SOUND).

### Concrete Send/Sync — sampled (73 rows)

| risk-class | count | examples |
|---|---:|---|
| FFI-string-literal Sync wrapper (`*const c_char` → `'static`) | 4 | `napi_node_version`, `CStrPtr`, `SyncCStr`, `___tracy_source_location_data` (F-S-24) |
| OS-handle / dlopen / kernel-API wrapper | 8 | `DynLib`, `Waker`, `CoreFoundation`, `CoreServices`, `WindowsImpl(Mutex)`, `DarwinImpl(Mutex)`, `WindowsImpl(Condition)`, `Semaphore` |
| Init-once-then-read-only singleton | 7 | `WatchChangedPaths`, `Instance(WaiterThreadPosix)`, `Instance(StandaloneModuleGraph)`, `DotenvSingleton`, `Instance(BundleThread)`, `GlobalCache`, `Instance(MimallocArena)` |
| Mutex-guarded data with raw-pointer hops | 9 | `Chunk` (F-S-16), `LinkerGraph` (F-S-17), `ThreadPool` (F-S-18), `PathWatcherManager` (F-S-20), `ImportPathsListPtr`, `LinkerContext` (lifetime-generic dup), `SourceMapDataTask`, `PrepareCssAstTask`, `Task` (intrusive node) |
| JS-thread-affine asserted Send/Sync | 6 | `VirtualMachine` (F-S-14 / EXP-084), `JSBundleCompletionTask` (F-S-28, Send-only), `Blob` (F-S-11 / EXP-082), `Bytes`, `StoreRef`, `bun_core::String` (F-S-15) |
| Shell single-thread asserted Send/Sync | 6 | `IOWriter` (F-S-12), `IOReader` (F-S-12), `ShellRmTask`, `DirTask` (F-S-13), `StringJoiner`, `StringJoiner::Node` |
| Lifetime-erased self-referential (NonNull + `*const [u8]`) | 4 | `SemverQuery::List` (F-S-30), `SemverQuery::Group` (F-S-30), `StoreStr`, `Entry`/`EntriesOption` (F-S-29) |
| fn-local thread-spawn SendPtr | 4 | `web_worker.rs:590`, `Debugger.rs:593`, `bundle_v2.rs:1543`, `BundleThread.rs:389` (F-S-31) |
| Type-erased fn-vtable handle | 3 | `DevServerHandle` (F-S-26), `CompletionHandle` (F-S-27), macro-generated public-field bypass (F-S-32 / EXP-080) |
| Other (HpackHandle, SSLConfig, SourceLocation, ThreadLock, MaxHeapAllocator, …) | ~23 | All in scope of CLAUDE-md-§Cross-thread string hazards / FFI-handle invariants |

### Cross-thread surface (`thread::spawn` etc.)

24 `std::thread::spawn` / `Builder::spawn` sites across:
`watcher/`, `bundler/BundleThread.rs`, `http/HTTPThread.rs`, `bun_bin/lib.rs`,
`io/lib.rs`, `threading/ThreadPool.rs`, `jsc/web_worker.rs`,
`jsc/Debugger.rs`, `runtime/node/fs_events.rs`, `runtime/node/path_watcher.rs`,
`runtime/cli/{create_command,open}.rs`, `runtime/api/bun/Terminal.rs`,
`spawn/process.rs` (waiter thread), plus the four `fn`-local SendPtr sites in
F-S-31. Every cross-thread move must satisfy the auto-trait at the closure
boundary; the F-S-1 / F-S-8 / F-S-9 cluster is the path by which a `!Send` payload
crosses without the compiler complaining.

---

## Summary

- **7 existing EXP cross-refs** (EXP-018, EXP-019, EXP-027, EXP-045, EXP-046, EXP-047, EXP-098). EXP-047 is a hardening / `NO_EVIDENCE` correction, not a confirmed-UB count. EXP-018 + EXP-019 still sit in unmerged PR #30765.
- **32 new findings (F-S-1 … F-S-32).** Top 3:
  1. **F-S-1 / `JsCell<T>` unbounded Send+Sync** — sibling to EXP-019, same Bucket-8 shape, now EXP-045 `CONFIRMED_UB`; same one-line `T: Send`/`T: Sync` fix.
  2. **F-S-8 / F-S-9 — `WorkTask<C>` & `ConcurrentPromiseTask<C>` lacking `C: Send` on the trait.** Combined surface: every JS-API method that schedules a work-pool job. EXP-046 is now confirmed at the unsafe-contract boundary: the generic Miri witness proves the laundering shape, and a temporary `+ Send` bound fails on all 7 real contexts. Per-context worker-side field touches remain remediation detail, not a blocker for the abstraction-level verdict.
  3. **F-S-4 / F-S-5 / F-S-6 — `AtomicCell<T: Copy>`, `ThreadCell<T>`, and `RacyCell<T>` under-bounded auto traits.** EXP-098 proves `AtomicCell<T: Copy>` can transport `&Cell<_>` across threads through safe `new()` + `into_inner()`. EXP-047 was corrected: `ThreadCell` / `RacyCell` remain hardening-only because safe code cannot dereference the raw pointer or send it across threads.
- **3 enumerations completed:**
  1. 42 generic `unsafe impl<...> Send/Sync` rows classified: 4 UNBOUNDED-UB, 1 under-bounded confirmed-UB (`AtomicCell<T: Copy>`), 2 hardening-only cell wrappers (`ThreadCell` / `RacyCell`), 2 trait-bounded-Context-without-Send, 11 lifetime-only, 22 sound-bounded.
  2. 73 concrete `unsafe impl Send/Sync` rows bucketed into 10 risk-classes; 6 JS-thread-affine + 6 shell-single-thread + 9 mutex-with-raw-hops form the audit hot zone.
  3. Confirmed Sections E + F have **zero** local Send/Sync impls (cleanest cross-thread axis in the codebase), validating Bucket 1's F-A-2 enumeration of the `*mut Self` discipline replacing the need for Send/Sync laundering.

### Registry mapping after follow-up

- **F-S-1** is now **EXP-045 / CONFIRMED_UB** (`JsCell<T>` unbounded `Send`/`Sync` with a Miri data-race witness).
- **F-S-4** is now **EXP-098 / CONFIRMED_UB** (`AtomicCell<T: Copy>` unbounded `Send`/`Sync`; direct `bun_core` Miri witness races `&Cell<u32>` through safe `new()` + `into_inner()`).
- **F-S-5 + F-S-6** are now **EXP-047 / `NO_EVIDENCE`** for the project-UB claim. The old `RacyCell<Cell<_>>` Miri race required caller-side `unsafe` deref, so it is contract-violation evidence and hardening rationale, not a confirmed Bun UB.
- **F-S-8 + F-S-9** are now **EXP-046 / CONFIRMED_UB (unsafe-contract boundary)** after the trait-bound compile experiment; all seven audited real contexts fail a temporary `+ Send` bound.
- **F-S-2, F-S-3, and F-S-31** stay **hardening-only**: replace private/function-local generic pointer wrappers with named non-generic wrappers or one audited helper, but do not count them as current UB.

### Remaining follow-up gates

- `RacyCell<...>` / `ThreadCell<...>` production exploitability remains a **per-site access-discipline audit**, not a confirmed registry finding. Current-main review found the two real `ThreadCell` statics narrowed to queue/waker cross-thread access; keep the payload audit for future drift.
- `CompletionHandle` (F-S-27) asserts `Sync` over a `JSBundleCompletionTask` declared `Send` only (F-S-28); source review found the common `result` path sequenced bundle-thread write before JS-thread read, so this remains a hardening follow-up rather than a confirmed race.
- `bun_dispatch::link_interface!` public handle fields (F-S-32 / EXP-080) are a confirmed safe-API defect: they bypass the macro's own `unsafe fn new` invariant gate.
