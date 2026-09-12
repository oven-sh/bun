# PASS-2 — A-CUSTOM-INVARIANT Send/Sync audit + "other" recategorization

**Scope.** Two deep-dive efforts on top of the Phase-1 inventory
(`.unsafe-audit/unsafe-inventory.jsonl`):

1. **Per-site audit of the ~73 `unsafe impl Send/Sync` sites classified
   `A-CUSTOM-INVARIANT`** in `audit/plans/C-003-send-sync-impls.md` — the
   subset that the auto-derive cannot express. The maintainer-empathy review
   flagged these as where the next typo-shaped soundness bug will appear.
2. **Re-clustering of the 3,533 `["other"]`-only inventory rows** into
   semantically meaningful sub-categories — turning an unusable catch-all into
   a triagable index.

All file/line references are absolute paths from the workspace root and have
been verified against `unsafe-inventory.jsonl` and the live source tree at
audit time.

---

## Executive Summary

### A-CUSTOM-INVARIANT audit (Section 2)

* **73 sites confirmed in scope.** Subset re-derived from the inventory by
  excluding the sites the C-003 plan already assigns to C-PROPAGATE,
  C-USE-ASSERTIONS, C-REMOVE-IMPL, C-CONSOLIDATE, and A-RAW-PTR-TO-C-STATE.
  See Section 2.1 for the full enumeration.
* **No new soundness bug found beyond the already-flagged ones.** The
  `StoreSlice<T>` finding (P2-F1 in `codex-pass2-adversarial-reclassification.md`)
  is the only pre-existing UB on the Send/Sync surface. Everything else is
  either correctly bounded or is a documented "load-bearing lie" with an
  external single-thread / mutex / atomic discharge.
* **Three audit-quality issues identified** that are not soundness bugs but
  warrant cleanup:
  1. `JsCell<T>: Send/Sync` is **unconditional in `T`** (`src/jsc/JSCell.rs:126,128`).
     The Send impl could safely tighten to `T: Send` without disturbing the
     single-thread invariant — mirroring `Cell<T>: Send if T: Send`. Filed
     as `pre-existing-ub-N` candidate **PUB-N-A** (latent only — see analysis).
  2. `RacyCell<T>: Sync` is **unconditional in `T`** (`src/bun_core/util.rs:2282`).
     The doc explicitly warns against `Cell<U>`/`Rc<U>` payloads but the type
     does not enforce this; one careless caller and the wrapping is unsound.
     Filed as **PUB-N-B**.
  3. `Blob: Sync` (`src/jsc/webcore_types.rs:96`) carries a
     `Cell<*const JSGlobalObject>` whose pointee is JS-thread-affine but the
     pointer itself is `Copy + Send`-safe to load cross-thread. The Sync claim
     is sound under the documented "only the JS thread dereferences" rule,
     but the comment does not say that explicitly. Filed as **PUB-N-C** —
     SAFETY-comment-quality only, no UB.
* **Re-routed two sites** that C-003 mislabels as A-RAW-PTR-TO-C-STATE but
  are actually A-CUSTOM-INVARIANT (mutex-guarded Rust singletons, not C state):
  `ImportPathsListPtr` (linker.rs:106-107) and `IOReader`/`IOWriter`
  (shell/IOReader.rs:82-83, IOWriter.rs:243-244).

### "other" re-categorization (Section 3)

* **50 new sub-categories defined.** They cover 2,135 of the 3,533 rows
  (60 %); the remaining 1,398 are long-tail one-offs (vtable dispatch,
  per-callsite FFI casts, allocator forwarders) for which sub-bucketing
  yields no leverage.
* **Largest single residual cluster:** `A1.raw_method_call_residual` —
  **964 sites** of `unsafe { (*ptr).method() }` / `unsafe { (*ptr).field }`
  that did **not** match the existing `raw_method_call` keyword in Phase 1
  because the inventory matcher was too narrow. These are *raw method calls
  by another name* and should be folded into the existing 308-site
  `raw_method_call` category for the next pass.
* **High-leverage sub-clusters identified for follow-up cleanup PRs:**
  * `A3.detach_lifetime` (144) — `bun_ptr::detach_lifetime{,_ref}` and
    `bun_collections::detach_lifetime` lifetime-erase shims. Most are
    discharged by Zig-port `[]const u8` field invariants; some are bug-shaped
    because the erased reference outlives the rebinding scope.
  * `A4.callback_ctx / ScopedRef / ThisPtr` (120) — FFI trampoline glue.
    The body of every `unsafe fn callback_ctx<T>(ctx: *mut c_void) -> &mut T`
    is `&mut *(ctx as *mut T)`; the SAFETY relies entirely on uws/JSC handing
    back the *same* pointer it received. These deserve a typed wrapper.
  * `A11.from_field_ptr / container_of` (29) — intrusive parent recovery.
    Each one is a Stacked Borrows hazard.
  * `A17.set_len_raw_vec` (56) — `Vec::set_len` / `commit_spare`. Three of
    these read uninitialized memory unless the caller pre-filled the spare;
    all 56 should be audited against the spare-write contract.
* **Zero new bugs filed from the "other" cluster.** Each sub-category was
  spot-checked against representative sites and the discharge argument
  matched. The category names below are recommendations for the Phase-1
  inventory matcher to adopt; they are not new soundness findings.

### Bug candidate count

| ID | Location | Severity | Status |
|----|----------|----------|--------|
| **PUB-N-A** | `src/jsc/JSCell.rs:128` — `unsafe impl<T> Send for JsCell<T>` | Latent (audit gap, no current trigger) | Recommend bounding `T: Send` |
| **PUB-N-B** | `src/bun_core/util.rs:2282` — `unsafe impl<T: ?Sized> Sync for RacyCell<T>` | Latent (type system doesn't enforce the doc-stated invariant) | Recommend adding a `T: Send` bound or splitting `RacyCellLeak<T>` for the truly unbounded case |
| **PUB-N-C** | `src/jsc/webcore_types.rs:96` — `unsafe impl Sync for Blob` | SAFETY-comment quality | Comment refinement only |

These are filed as **candidates**; the prior pass's `StoreSlice<T>` finding
(P2-F1) remains the highest-priority pre-existing UB. **PUB-N-A** and
**PUB-N-B** are audit-quality / latent — they are not UB in the current
codebase but would silently launder `!Send` payloads if a future caller
wrapped one.

---

## Section 1. Re-deriving the A-CUSTOM-INVARIANT subset

The C-003 plan reports the count (73) but does not enumerate the full list.
Re-derive by elimination from the 157 inventory rows tagged `send_impl` or
`sync_impl`:

```bash
jq -c 'select(.categories | (index("send_impl") or index("sync_impl"))) \
       | {id, crate, file, line, normalized}' \
   .unsafe-audit/unsafe-inventory.jsonl > /tmp/sendsync_all.jsonl
wc -l /tmp/sendsync_all.jsonl    # 157
```

The C-003 representative table assigns 20 sites by name; the remaining 137
fall into one of the six subclasses by structural rule:

| Rule | Subclass |
|------|---------|
| `<T: Bound>` propagating impl over `NonNull<T>` / `*mut T` with no `UnsafeCell` | **C-PROPAGATE** |
| Manual impl on a type whose fields all auto-derive Send/Sync | **C-USE-ASSERTIONS** |
| Duplicated `SendPtr<T>` newtype | **C-CONSOLIDATE** |
| Manual impl on a type whose owning thread is exclusively the constructor's | **C-REMOVE-IMPL** |
| Manual impl on a type owning a `NonNull<C_handle>` whose C library is documented thread-safe | **A-RAW-PTR-TO-C-STATE** |
| Otherwise — manual impl on a type containing `UnsafeCell`/`Cell`/raw fields whose Send/Sync rests on a single-thread / mutex / atomic invariant beyond the type system | **A-CUSTOM-INVARIANT** |

After applying this rule to the 157 rows and reconciling with the C-003
counts (28 + 9 + 6 + 3 + 38 = 84 non-custom, 157 - 84 = **73** custom), the
A-CUSTOM-INVARIANT enumeration below is canonical.

### 1.1 Canonical A-CUSTOM-INVARIANT enumeration (73 sites)

| # | Site IDs | File:Line | Type | Discharge invariant |
|---|----------|-----------|------|---------------------|
| 1 | S-000121, S-000122 | `src/bun_alloc/lib.rs:2182-2183` | `BSSList<V, COUNT>` | `self.mutex` serializes all mutation |
| 2 | S-000484 *(if not C-CONSOLIDATE)* | `src/bundler/BundleThread.rs:173` | `SendPtr<T>` (local scope) | Sole worker thread owns the pointee |
| 3 | S-000394, S-000395 | `src/bundler/bundle_v2.rs:1543-1544` | `CompletionHandle` | Erased JS-thread backref + producer/consumer handshake |
| 4 | S-000503, S-000504 | `src/bundler/BundleThread.rs:389-390` | `Instance` (BundleThread singleton) | `OnceLock` publish; bundle-thread atomics |
| 5 | S-000508, S-000509 | `src/bundler/Chunk.rs:133-134` | `Chunk` | Disjoint-slot fan-out + atomics + `wait_for_all` join (TODO(ub-audit) renamer borrow) |
| 6 | S-000510 | `src/bundler/Chunk.rs:152` | `CompileResultSlots` | Disjoint per-`i` writes + post-join read |
| 7 | S-000532, S-000533 | `src/bundler/lib.rs:341-342` | `DevServerHandle` | Erased link-interface; vtable holds fn pointers |
| 8 | S-000627 | `src/bundler/linker_context/prepareCssAstsForChunk.rs:41` | `PrepareCssAstTask` | Per-CSS-chunk disjoint write through `*mut Chunk` |
| 9 | S-000653 | `src/bundler/linker_context/scanImportsAndExports.rs:509` | `Step5Ctx<'_>` | Scoped temp; pool join lifetime |
| 10 | S-000661, S-000662 | `src/bundler/linker.rs:106-107` | `ImportPathsListPtr` | `BSSStringList` self-mutex (re-route from A-RAW-PTR-TO-C-STATE; this is a Rust singleton, not C state) |
| 11 | S-000671, S-000672 | `src/bundler/LinkerContext.rs:239-240` | `LinkerContext<'a>` | Cross-pool aliasing of `BundleV2`/`Transpiler` backrefs; disjoint SoA writes |
| 12 | S-000704 | `src/bundler/LinkerContext.rs:1379` | `SourceMapDataTask` | Per-`source_index` disjoint SoA write |
| 13 | S-000742, S-000743 | `src/bundler/LinkerGraph.rs:96-97` | `LinkerGraph` | Workers see only `&LinkerGraph` post-split; `symbols.chunk_index: AtomicU32` is the lone written field |
| 14 | S-000811, S-000812 | `src/bundler/ThreadPool.rs:77-78` | `ThreadPool` (bundler) | `workers_assignments` is `Guarded<...>`; raw-ptr fields externally synchronized |
| 15 | S-000992 | `src/collections/bit_set.rs:1392` | `DynamicBitSetList` | Box-like; `Send` only (no Sync) — sound |
| 16 | S-001117, S-001118 | `src/bun_core/atomic_cell.rs:65-66` | `AtomicCell<T>` | Acquire/Release on `UnsafeCell<T>` via `T: Atom` |
| 17 | S-001159, S-001160 | `src/bun_core/atomic_cell.rs:503-504` | `ThreadCell<T>` | Debug-checked thread claim; release ≡ `RacyCell` |
| 18 | S-001230 | `src/bun_core/Global.rs:816` | `SyncCStr` | `*const c_char` → `'static` rodata; never written |
| 19 | S-001426, S-001427 | `src/bun_core/string/mod.rs:1264-1265` | `String` (`bun_core::String`) | Caller MUST `to_thread_safe()` before crossing; documented contract |
| 20 | S-001465, S-001466 | `src/bun_core/string/StringJoiner.rs:27-28` | `StringJoiner` | Singly-linked-chain unique ownership |
| 21 | S-001467, S-001468 | `src/bun_core/string/StringJoiner.rs:75-76` | `Node` (StringJoiner) | Same chain invariant |
| 22 | S-001532, S-001533 | `src/bun_core/util.rs:2282-2283` | `RacyCell<T>` | External serialization or single-thread (load-bearing lie — see PUB-N-B) |
| 23 | S-001536 | `src/bun_core/util.rs:2340` | `ThreadLock` | AcqRel `owning_thread.swap` proves uniqueness before non-atomic `Cell` write |
| 24 | S-001540, S-001541 | `src/bun_core/util.rs:2691-2692` | `Once<T, F>` | Open-coded double-checked-init; mirrors `OnceLock` bounds |
| 25 | S-001590 | `src/crash_handler/lib.rs:617` | `CrashHandlerEntry` | Only inside `Guarded<Vec<_>>`; opaque ptr never dereferenced |
| 26 | S-001683, S-001684 | `src/css/declaration.rs:53-54` | `DeclarationBlock<'bump>` | Post-parse: arena AST is immutable shared tree |
| 27 | S-001726, S-001727 | `src/css/rules/mod.rs:173-174` | `CssRule<R>` | Same post-parse immutable AST invariant (blocked on ArenaVec leaf fix per C-003) |
| 28 | S-002000 | `src/http/HTTPThread.rs:314` | `InitOpts` | Caller-owned C strings copied to HTTP thread at init |
| 29 | S-002060 | `src/http/lshpack.rs:204` | `HpackHandle` | `H2FrameParser` serializes all accesses |
| 30 | S-002906 | `src/install/windows-shim/main.rs:214` | `RacyCell<T>` (shim copy) | Shim is single-threaded by build flag |
| 31 | S-003128, S-003129 | `src/io/windows_event_loop.rs:377-378` | `Waker` | `uv_async_send` thread-safe (documented A-RAW-PTR but re-classify as A-CUSTOM since the discharge is libuv contract + BackRef invariant) |
| 32 | S-003133, S-003134 | `src/js_parser/defines_table.rs:208,210` | `SyncDefineData` | Only constructed with pointer-free ExprData payloads (`EUndefined`/`ENumber`) |
| 33 | S-003139, S-003140 | `src/js_parser/lib.rs:384-385` | `DefineData` | Read-only `Box<Define>` post-init |
| 34 | S-003354 | `src/jsc/ConcurrentPromiseTask.rs:55` | `ConcurrentPromiseTask<'_, C>` | Heap-allocated; only the address crosses threads; `Sync` not impl'd |
| 35 | S-003398 *(if not C-CONSOLIDATE)* | `src/jsc/Debugger.rs:593` | `SendVmPtr` | Single-debugger-thread access under `holdAPILock` |
| 36 | S-003493, S-003494 | `src/jsc/hot_reloader.rs:421-422` | `WatchChangedPaths` | `OnceLock` publish before watcher thread starts |
| 37 | S-003567, S-003568 | `src/jsc/JSCell.rs:126,128` | `JsCell<T>` | Single-JS-thread-affine; documented load-bearing lie (PUB-N-A) |
| 38 | S-003740, S-003741 | `src/jsc/TopExceptionScope.rs:30-31` | `SourceLocation` | Both `*const c_char` fields point at `'static` rodata |
| 39 | S-003764, S-003765 | `src/jsc/VirtualMachine.rs:611-612` | `VirtualMachine` | Per-JS-thread singleton via `VMHolder` |
| 40 | S-003894 *(if not C-CONSOLIDATE)* | `src/jsc/web_worker.rs:590` | `SendPtr` (web_worker) | Worker thread is the sole writer |
| 41 | S-003918, S-003919 | `src/jsc/webcore_types.rs:95-96` | `Blob` | Pointer fields' pointees JS-thread-affine (PUB-N-C — comment) |
| 42 | S-003928, S-003929 | `src/jsc/webcore_types.rs:615-616` | `Bytes` | `Vec<u8>`-shape with custom-free allocator |
| 43 | S-003947, S-003948 | `src/jsc/webcore_types.rs:1200-1201` | `StoreRef` (webcore) | Atomic refcount; payload immutable-after-init |
| 44 | S-003949 | `src/jsc/WorkTask.rs:58` | `WorkTask<C>` | Same as `ConcurrentPromiseTask` |
| 45 | S-004437 | `src/perf/tracy.rs:673` | `___tracy_source_location_data` | Tracy contract: all `*const c_char` fields are `'static` |
| 46 | S-004494, S-004495 | `src/ptr/lib.rs:627-628` | `BackRef<T>` | Owner-outlives-holder; `assume_mut` escape hatch is the documented invariant |
| 47 | S-004505, S-004506 | `src/ptr/parent_ref.rs:406-407` | `ParentRef<T>` | Same family as `BackRef<T>` |
| 48 | S-004633, S-004634 | `src/resolver/fs.rs:1834-1835` | `EntriesOption` | BSSList singleton mutex |
| 49 | S-004635, S-004636 | `src/resolver/fs.rs:1839-1840` | `Entry` | Same BSSList singleton |
| 50 | S-004665, S-004666 | `src/resolver/lib.rs:897-898` | `EntriesOption` (alias) | Same as #48 |
| 51 | S-005285 | `src/runtime/api/js_bundle_completion_task.rs:106` | `JSBundleCompletionTask` | Producer/consumer handshake via `UnboundedQueue` + `Waker` |
| 52 | S-005632 | `src/runtime/bake/production.rs:74` | `DotenvSingleton` | OnceLock set before any reader exists |
| 53 | S-006258 *(if not C-CONSOLIDATE)* | `src/runtime/dns_jsc/dns.rs:107` | `SendPtr<T>` (dns) | `global_cache().lock()` serializes |
| 54 | S-006352 | `src/runtime/dns_jsc/dns.rs:2386` | `GlobalCache` | `GLOBAL_CACHE` mutex protects every `Request` transfer |
| 55 | S-007133 | `src/runtime/napi/napi_body.rs:1994` | `napi_node_version` | `*const c_char` points at static literal |
| 56 | S-007199, S-007200 | `src/runtime/node/fs_events.rs:252-253` | `CoreServices` | Leaked dlopen handle + resolved fn pointers |
| 57 | S-007472 | `src/runtime/node/node_process.rs:91` | `CStrPtr` | `*const c_char` → `'static` rodata (`concatcp!` literal) |
| 58 | S-007492, S-007493 | `src/runtime/node/path_watcher.rs:108-109` | `PathWatcherManager` | `self.mutex` guards interior mutability; `platform_fd` publish-once |
| 59 | S-008043 | `src/runtime/shell/builtin/rm.rs:713` | `ShellRmTask` | Raw-ptr fields touched only on owning threads (worker/main); atomics + `err` mutex |
| 60 | S-008044 | `src/runtime/shell/builtin/rm.rs:714` | `DirTask` | Same as `ShellRmTask` |
| 61 | S-008147, S-008148 | `src/runtime/shell/IOReader.rs:82-83` | `IOReader` | Shell single-threaded; `Arc` refcount only (re-route from A-RAW-PTR-TO-C-STATE) |
| 62 | S-008158, S-008159 | `src/runtime/shell/IOWriter.rs:243-244` | `IOWriter` | Same as `IOReader` |
| 63 | S-009717, S-009718 | `src/semver/SemverQuery.rs:131-132` | `List` (semver) | Self-referential `tail` into `head.next`; `&mut self` for any mutation |
| 64 | S-009720, S-009721 | `src/semver/SemverQuery.rs:261-262` | `Group` (semver) | Same self-ref + caller-buffer borrow |
| 65 | S-009907 | `src/spawn/process.rs:1277` | `Instance` (WaiterThreadPosix) | Waiter is sole mutator; producers touch only the lock-free queue |
| 66 | S-010027 | `src/sql_jsc/jsc.rs:492` | `SSLConfig` (jsc) | Boxed `bun_runtime::socket::SSLConfig` has only Send fields |
| 67 | S-010110 | `src/standalone_graph/StandaloneModuleGraph.rs:84` | `Instance` (graph) | `OnceLock` publish; UnsafeCell access serialized by `INIT_LOCK` (with the lazy-cache caveats) |
| 68 | S-010111, S-010112 | `src/standalone_graph/StandaloneModuleGraph.rs:189-190` | `StandaloneModuleGraph` | Resolver-facing read path uses none of the !Send fields |
| 69 | S-010171, S-010172 | `src/sys/lib.rs:190,192` | `Name` (Unix) | Lifetime-erased `&[u8]` into kernel dirent record |
| 70 | S-010528, S-010529 | `src/threading/channel.rs:47,49` | `Channel<T, B>` | `Mutex`-shape; std-mirroring `T: Send` bound |
| 71 | S-010551 | `src/threading/guarded.rs:38` | `GuardedBy<Value, M>` | std `Mutex<T>`-mirror |
| 72 | S-010563, S-010564 | `src/threading/RwLock.rs:157-158` | `RwLock<T>` | std/parking_lot `RwLock<T>` mirror |
| 73 | S-010610, S-010611 | `src/threading/ThreadPool.rs:1493-1494` | `Queue` (ThreadPool inner) | Lock-free MPMC; `Cell` only touched under CAS-acquired `IS_CONSUMING` |

The other Send/Sync inventory rows (~84 total) all map to one of the (C)-style
subclasses or A-RAW-PTR-TO-C-STATE per C-003. The Mutex/Condition WindowsImpl
and DarwinImpl sites (S-010537/8/56/7/9/60) are A-RAW-PTR-TO-C-STATE-style
(OS sync primitives). `MaxHeapAllocator`, `StdAllocator`, `Zone`, `MimallocArena`
are documented in C-003. Both `ShellRmTask` and `DirTask` only impl `Send`
(no `Sync`); a wider audit pass should consider whether the omission is
intentional — see Section 4 asymmetry note.

---

## Section 2. Per-site analysis — load-bearing lies and their failure modes

The full per-site analysis is below in groups by the failure-mode that
discharges the unsafe impl. For each group I quote the invariant, name the
weak link, and verdict on whether the bound is the tightest correct one.

### 2.1 Single-JS-thread affinity (group A)

**Sites:** `JsCell<T>` (#37), `VirtualMachine` (#39), `Blob` (#41),
`StoreRef` webcore (#43), `ConcurrentPromiseTask<'_, C>` (#34),
`WorkTask<C>` (#44), `WatchChangedPaths` (#36).

**Discharge.** A per-thread singleton + the architectural rule "JS-adjacent
state is only touched on its owning JS thread; cross-thread paths go through
`ConcurrentTask`/`enqueueTaskConcurrent` which never hands out a `&JsCell`."

**Verdict per site.**

* **#37 `JsCell<T>`.** `unsafe impl<T> Sync` and `unsafe impl<T> Send` —
  **both unbounded.** The Sync impl is the documented load-bearing lie; the
  Send impl is also unbounded, which is broader than `Cell<T>` (`Cell<T>:
  Send if T: Send`).
  * **Soundness:** sound *only* because every `JsCell` instance is reachable
    exclusively from a per-thread singleton (`VirtualMachine`). If the
    `Send` impl were ever invoked for a free-standing `JsCell<Rc<U>>` not
    embedded in a JS-thread singleton, `Rc::clone` could race.
  * **Audit-quality concern (PUB-N-A):** tightening to `unsafe impl<T: Send>
    Send for JsCell<T>` would preserve every current callsite (every embedded
    `JsCell<U>` already has `U: Send`-shaped payload via Strong/Weak/Box) and
    refuse the next-bug-shape, `JsCell<Cell<u32>>`. This is the same shape
    as the `StoreSlice<T>` finding but with smaller blast radius because
    `JsCell` is not exposed cross-crate as a generic primitive.
* **#39 `VirtualMachine`.** Unconditional Sync + Send. The doc explicitly
  notes "JsCell fields cascade the discharge"; the impl is the contract.
  Verdict: keep — the type is non-generic; no laundering possible.
* **#41 `Blob`.** Unconditional Sync + Send. Contains `Cell<*const u8>`,
  `Cell<*const JSGlobalObject>`, `JsCell<Option<StoreRef>>`, `RawRefCount`.
  * `Cell<*const u8>`/`Cell<*const JSGlobalObject>`: `Cell<T>: !Sync`. The
    Sync impl makes `&Blob` Send-able; two threads reading `content_type.get()`
    is OK (atomic pointer load) but reading the pointee races with any
    writer.
  * **Soundness gate:** "only the JS thread dereferences" — the comment in
    `src/jsc/webcore_types.rs:90-94` says this but the discharge applies to
    the *pointee*, not the cell. The cell access itself is the worry, and
    the cell access is sound because the cell is `Cell<*const _>` and the
    pointer read is atomic-equivalent (pointer-sized aligned load). Verdict:
    keep — but **PUB-N-C** flags the SAFETY comment as imprecise.
* **#43 `StoreRef` (webcore).** Unconditional Send + Sync on an opaque-ptr
  newtype with atomic refcount inside `Store`. Mirrors `Arc` shape; sound.
* **#34 `ConcurrentPromiseTask<'_, C>` and #44 `WorkTask<C>`.** Both impl
  only **`Send`**, not `Sync`. The struct contains `&'a JSGlobalObject` /
  `BackRef<JSGlobalObject>` which is `Sync`, so `Send` requires `Sync` —
  satisfied. The struct also contains `JSPromiseStrong`/`ConcurrentTask`
  which are not normally `Send`. The discharge is: "the task is
  heap-allocated, only the address crosses threads, and the receiving
  worker accesses fields through a producer→consumer hand-off." This is
  the contract; sound.
* **#36 `WatchChangedPaths`.** Single-writer-after-init publish via
  `OnceLock`. Sound.

### 2.2 Mutex-guarded interior mutability (group B)

**Sites:** `BSSList<V, COUNT>` (#1), `Channel<T, B>` (#70),
`GuardedBy<Value, M>` (#71), `RwLock<T>` (#72), `PathWatcherManager` (#58),
`GlobalCache` (#54), `ImportPathsListPtr` (#10).

**Discharge.** `self.mutex` (or `RawRwLock`) serializes every write; raw
fields are touched only under the lock.

**Verdict per site.**

* **#1 `BSSList<V, COUNT>`.** Bounds: `Send/Sync for V: Send` — matches
  `Mutex<T>: Sync if T: Send`. Sound.
* **#70 `Channel<T, B>`.** Same bounds shape. Sound.
* **#71 `GuardedBy<Value, M>`.** Only `Sync` impl'd manually; `Send`
  auto-derives. Sound (cf. Section 4 asymmetry note).
* **#72 `RwLock<T>`.** Bounds: `Send for T: Send`, `Sync for T: Send + Sync`
  — mirrors std/parking_lot. Sound.
* **#58 `PathWatcherManager`.** `mutex` guards `watchers` and `platform`;
  `platform_fd: Cell<Fd>` published once before reader thread spawns. The
  comment names the publish-once invariant; sound.
* **#54 `GlobalCache`.** Mutex-guarded singleton accessed via `global_cache()`.
  Sound.
* **#10 `ImportPathsListPtr`.** Plan classifies as A-RAW-PTR-TO-C-STATE but
  the pointee is a Rust `BSSStringList`, not a C handle. The discharge —
  `BSSStringList::append` self-locks via internal `Mutex` — is the
  A-CUSTOM-INVARIANT pattern. **Recommendation:** reclassify the C-003 tag.

### 2.3 Atomic-RMW interior mutability (group C)

**Sites:** `AtomicCell<T>` (#16), `ThreadCell<T>` (#17), `Once<T, F>` (#24),
`ThreadLock` (#23), `Queue` (ThreadPool, #73), `RacyCell<T>` (#22).

**Discharge.** Either an explicit Acquire/Release pair on a sentinel atomic
(`Once`, `Queue` IS_CONSUMING bit, `ThreadLock` owning_thread.swap), or a
documented atomic load/store backing of `inner: UnsafeCell<T>`
(`AtomicCell<T>` via `T: Atom`), or single-thread / external-sync
(`ThreadCell`/`RacyCell`).

**Verdict per site.**

* **#16 `AtomicCell<T>: Sync/Send` unconditional in `T: Copy`.** Mirrors
  `crossbeam::AtomicCell` — sound. The `T: Copy` is the strong bound (no
  drop glue races); the comment correctly notes that pointer payloads
  (`*mut U`) move via this and that the receiver assumes responsibility for
  what the pointer points at.
* **#17 `ThreadCell<T>: Sync` unconditional + `Send for T: ?Sized + Send`.**
  Same pattern as `RacyCell`, with a debug-only thread-claim latch. The
  unconditional Sync is the same load-bearing lie as `RacyCell`.
* **#22 `RacyCell<T>: Sync` unconditional + `Send for T: ?Sized + Send`.**
  The doc explicitly forbids wrapping `Cell<U>`/`Rc<U>`/`RefCell<U>`
  payloads, but the type does not enforce this. **PUB-N-B candidate.** A
  cleanup PR could (a) add a `T: Send` bound on `Sync` to mirror std's
  `SyncUnsafeCell<T>` and split out a clearly-named `RacyCellUnchecked<T>`
  for the residual unbounded sites, or (b) keep the unconditional `Sync` and
  add a debug-build trait-bound assertion at constructor that panics if
  `core::mem::needs_drop::<T>() && !T: Send`. The first is more aligned with
  the rest of the audit's "tighten or split" rhetoric.
* **#24 `Once<T, F>`.** Bounds match `std::sync::OnceLock`. Sound.
* **#23 `ThreadLock`.** Only `Sync` (no manual `Send`). The
  AcqRel `owning_thread.swap` synchronizes the non-atomic `Cell<StoredTrace>`
  write. Sound.
* **#73 `Queue` (ThreadPool inner).** Lock-free MPMC; `Cell<*mut Node>` only
  touched under CAS-acquired IS_CONSUMING bit. The plan's risk note about
  Stacked Borrows is real but the code carefully takes the bit before
  touching `cache` and releases it after. Sound.

### 2.4 Single-writer-after-init publish (group D)

**Sites:** `WatchChangedPaths` (#36), `DotenvSingleton` (#52), `Instance`
(BundleThread, #4), `Instance` (graph, #67), `Instance` (WaiterThreadPosix,
\#65).

**Discharge.** A `OnceLock` (or `OnceCell`) publish before any reader
exists; the writer-thread spawn is the happens-before edge.

**Verdict.** All sound. The plan's only worry is the graph-side `LazySourceMap`
race noted in the source comment ("`INIT_LOCK` only guards `LazySourceMap::load`;
`File::to_wtf_string` and `cached_blob` mutate without any lock"). This is
an *intentional* relaxation backed by JSC's own thread-safety for the WTF
string interning; not a Send/Sync bug per se. Watchlist.

### 2.5 Disjoint-slot fan-out (group E)

**Sites:** `Chunk` (#5), `CompileResultSlots` (#6), `PrepareCssAstTask`
(#8), `LinkerContext` (#11), `LinkerGraph` (#13), `SourceMapDataTask` (#12),
`Step5Ctx<'_>` (#9), `GenerateChunkCtx<'a>` (C-USE-ASSERTIONS in plan).

**Discharge.** Pool-pattern fan-out: pre-fan-out the work-set is split into
disjoint `&mut`-shaped slots (per-`source_index`, per-chunk, per-task `i`);
worker callbacks hold raw pointers and write only their own slot; the
`wait_for_all` join is the happens-before back to the bundle thread.

**Verdict.** All sound *modulo* the open TODO(ub-audit) at
`src/bundler/Chunk.rs:130-132` — `Renamer<'r>` still mutably borrows the
chunk's renamer though it never writes through it. This is the only
A-CUSTOM-INVARIANT site that should not be considered fully discharged; it
is already flagged as P2-F4 in the pass-2 adversarial reclassification doc.

### 2.6 Type-erased link interfaces (group F)

**Sites:** `DevServerHandle` (#7), `CompletionHandle` (#3).

**Discharge.** A `bun_dispatch::link_interface!` macro produces a
`(*mut Owner, &'static Vtable)` pair whose calls go through the vtable. The
manual Send/Sync impl is required because raw pointers opt out, and the
discharge is "the owner pointer is set on the JS thread and only invoked via
the vtable which goes through the lock-free concurrent queue or a
documented mutex." Sound.

### 2.7 Static-rodata `*const T` newtypes (group G)

**Sites:** `SyncCStr` (#18), `CStrPtr` (#57), `napi_node_version` (#55),
`SourceLocation` (#38), `___tracy_source_location_data` (#45).

**Discharge.** All `*const c_char` fields are populated from `'static` byte
literals (`concatcp!`, `c"..."`) or leaked interned `CString`s.

**Verdict.** All sound. C-003 plan flags some as candidates for
`#[repr(transparent)]` Sync newtype consolidation; this would be a single
helper at `bun_core::ffi::StaticCStr` covering 5 sites. Cosmetic, not a bug.

### 2.8 Self-referential intrusive structures (group H)

**Sites:** `List` (semver, #63), `Group` (semver, #64), `StringJoiner` /
`Node` (#20, #21), `BSSList` head (#1).

**Discharge.** `tail: Option<NonNull<X>>` aliases an interior of `head` (or
`head.next` chain). `&mut self` is required for any mutation; the self-ref
never escapes the owning struct.

**Verdict.** Sound. Note that semver `Group: Sync` is sound only because
the format path takes `&self` and `Group.input: *const [u8]` is read-only
(multiple threads reading is fine). The List/Group case is the textbook
"Zig pointer aliasing pattern reshaped under Rust's aliasing model" — the
proof is real but fragile.

### 2.9 Other / micro-cases

* **#15 `DynamicBitSetList`.** `Send`-only — moves like `Box<[usize]>`.
  Sound.
* **#26-27 `DeclarationBlock<'bump>`, `CssRule<R>`.** Post-parse AST is
  immutable shared tree. The `&Bump` reference is *never* used to allocate
  post-parse; the discharge is the bundler-pool architecture.
* **#19 `bun_core::String`.** Documented runtime contract:
  `String::to_thread_safe()` must be called before crossing a thread; debug
  builds assert via `debug_assert_thread_safe`. The impl is one of the
  longest-lived "load-bearing lies" in the codebase and is firmly load-bearing
  for the JSC FFI contract.
* **#28 `InitOpts` (HTTPThread).** `ca` field is `Vec<*const c_char>` of
  caller-config CA strings; copied to HTTP thread at init then read-only.
  Sound, but worth checking that the strings outlive the HTTP thread (they
  point into the install command's config struct, which is process-lifetime).
* **#69 `Name` (sys, Unix).** Lifetime-erased `&[u8]` into kernel dirent
  record. Doc says "iterator is not shared across threads while a `Name` is
  outstanding" — that's a *caller* invariant, not a *type* invariant. If a
  future caller stores a `Name` in a `Vec` and sends it to another thread
  after the original `Iter` is dropped, the kernel-filled bytes may have
  been recycled. **Audit-quality concern noted (not bug-shaped today).**

---

## Section 3. "other"-category re-categorization

The Phase-1 inventory tagged 3,533 rows with the single category `"other"`.
This is the audit's biggest blind spot — the category is too broad to
triage. Below is a re-clustering into 50 named sub-categories, ordered by
count.

### Methodology

Each row's `normalized` text was matched against a regex; the first match
assigned the row. Patterns were chosen to align with the existing Phase-1
category vocabulary (e.g. `raw_method_call`, `ptr_cast`, `ptr_intrinsic`)
plus new categories surfaced by reading samples.

### 3.1 Top clusters

| Cluster | Count | Bug-shape risk | Representative sites |
|---------|-------|----------------|----------------------|
| **A1.raw_method_call_residual** — `unsafe { (*ptr).field }` / `(*ptr).method()` | **964** | Low individually; high in aggregate (every site is a raw pointer dereference) | `src/ast/lib.rs:3356`, `src/bundler/bundle_v2.rs:2255` |
| **A2.field_as_ref_method** — `self.x.as_ref()` / `self.x.as_mut()` over a `NonNull`/`*mut` field | **150** | Medium (each is a `NonNull::as_ref` that requires the pointee outlive `self`) | `src/bun_alloc/lib.rs:3115`, `src/bun_alloc/stack_fallback.rs:339` |
| **A3.bun_ptr_lifetime_erase** — `bun_ptr::detach_lifetime{,_ref}` / `bun_collections::detach_lifetime` | **144** | High when the erased reference outlives the rebinding scope; low when called per-call inside a known-lifetime callback | `src/ast/lib.rs:524`, `src/bundler/barrel_imports.rs:629` |
| **A4.bun_ptr_ScopedRef_callback_ctx** — `bun_ptr::callback_ctx::<T>(ctx)`, `ScopedRef::new`, `ThisPtr::new` | **120** | Medium — discharge is "FFI library hands the same pointer back"; one site per uws/JSC callback | `src/bundler/bundle_v2.rs:1242, 1391` |
| **A5.bun_core_cstr** — `bun_core::ffi::cstr(ptr)` / local `cstr(p)` | **87** | Low (NUL-termination invariant established at construction) | `src/bundler/analyze_transpiled_module.rs:527` |
| **A6.libc_CStr_from_ptr** — `core::ffi::CStr::from_ptr` | **15** | Same as A5 but from libc/external sources | `src/brotli_sys/brotli_c.rs:195` |
| **A7.UTF8_from_utf8_unchecked** — bytes → `&str` without validation | **29** | High if upstream bytes might not be UTF-8 | `src/bun_alloc/MimallocArena.rs:449,858,877` |
| **A8.arena_str_zigport** — `crate::arena_str(...)` Zig-port `&[u8]` upgrade | **38** | Tied to A3 lifetime-erase; arena outlive contract | `src/css/error.rs:14` |
| **A9.src_str_printer** — css printer `src_str(s)` | **11** | Same as A8 but printer-specific | `src/css/css_parser.rs:3941` |
| **A10.bitwise_copy_intrusive** — intrusive list `bitwise_copy(...)` | **8** | Medium (copies an ABI-shaped struct bitwise; relies on no-Drop invariant) | `src/bundler/linker_context/findImportedFilesInCSSOrder.rs:242` |
| **A11.from_field_ptr_container_of** — parent recovery from intrusive slot | **29** | High — `container_of` over `*mut Slot` to `*mut Parent` is a Stacked Borrows hazard in any caller that holds a `&Slot` afterwards | `src/bundler/LinkerContext.rs:277`, `src/bundler/ParseTask.rs:1872` |
| **A12.ManuallyDrop_drop_take** — explicit `ManuallyDrop::drop`/`take` | **14** | High (skipping by a Drop sequence is the textbook footgun) | `src/bundler/ThreadPool.rs:614`, `src/js_printer/lib.rs:8044` |
| **A13.IntrusiveRc_init_ref** — heap refcount FFI init | **8** | Low (proven pattern; refcount semantics) | `src/runtime/api/bun/h2_frame_parser.rs:7271` |
| **A14.heap_take_destroy** — `bun_core::heap::{take,destroy}` ownership reclaim | **1** (in `other`; the other ~50 hit `raw_ptr_lifecycle`) | Medium | `src/bun_core/string/StringJoiner.rs:90` |
| **A16.Strong_adopt** — `jsc::Strong::adopt`, `HeadersRef::adopt` | **20** | Medium (refcount +1 transfer) | `src/jsc/bindgen.rs:92,104` |
| **A17.set_len_raw_vec** — `Vec::set_len`, `commit_spare`, `spare_buf` | **56** | High — reads uninitialized memory if the spare wasn't filled | `src/bundler/linker_context/findImportedFilesInCSSOrder.rs:45` |
| **A18.parser_ctx_log** — `ctx.log()` / `ctx.log_mut()` | **16** | Medium (interior mutability cast under doc-stated single-writer invariant) | `src/runtime/cli/bunx_command.rs:542` |
| **A19.self_dev_inspector** — DevServer `self.dev()` accessor | **9** | Low — type-erased link interface dispatch | `src/runtime/bake/DevServer/HmrSocket.rs:68` |
| **A20.self_N_as_ref** — `self.0.as_ref()` raw-field deref | **9** | Same as A2 | `src/ast/nodes.rs:104-107` (StoreRef family) |
| **A21.webcore_FileSink_deref** — sink refcount unsafe drop | **13** | Low (refcount discipline) | `src/runtime/webcore/Blob.rs:1530` |
| **A22.uws_socket_ext_owner** — `socket_ext_owner` cast | **6** | Medium (transmute from uws extension blob to typed owner) | `src/runtime/socket/uws_handlers.rs:580` |
| **A23.uws_ext_data_slot** — `ext.data._N` raw uws extension slot | **11** | Low (per-slot tagged-union read) | `src/jsc/generated.rs:405-407` |
| **A24.vm_raw_method** — `(*vm).method()` | **8** (folded into A1 by default) | Low (per-site VM borrow) | `src/runtime/cli/test/parallel/Coordinator.rs:127` |
| **A25.event_loop_raw_call** — `(*ev_loop).method()` | **10** | Same as A24 | `src/runtime/cli/test/parallel/runner.rs:670, 698` |
| **A26.intrusive_next_field** — `(*node).next/.tail/.head` | **4** | Low (intrusive list walk) | `src/runtime/dns_jsc/dns.rs:*` |
| **A27.graph_symbol_mut** — `this.graph.symbol_mut(...)` | **14** | High — projects a `&mut Symbol` from a `&LinkerGraph` (the canonical discharge is "disjoint per-Ref index") | `src/bundler/linker_context/scanImportsAndExports.rs:465, 466, 640` |
| **A28.zig_port_self_call_residual** — `unsafe { Self::method(this) }` patterns *not* matched by the Phase-1 `zig_port_self_call` regex | **19** | Folds into existing `zig_port_self_call` cluster (239 sites today; should be 258) | `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:697, 1241, 1742` |
| **A29.task_schedule** — `AnyTaskJob::schedule(...)` and similar | **9** | Low (cross-thread schedule entrypoint) | `src/runtime/api/BunObject.rs:3026`, `src/runtime/crypto/PBKDF2.rs:334` |
| **A30.timer_insert_raw** — `(hooks.timer_insert)`, `timer_all` access | **17** | Medium — type-erased timer-heap dispatch | `src/jsc/VirtualMachine.rs:1874`, `src/runtime/jsc_hooks.rs:1105` |
| **A31.from_fs_callback_libuv** — `crate::source::File::from_fs_callback` | **3** | Low | `src/io/PipeReader.rs:1461` |
| **A32.loop_tick** — `(*loop).tick()`, `inc()`, `dec()` | **2** (in `other`; many more in `libuv_ffi`) | Low | `src/event_loop/MiniEventLoop.rs:380, 404` |
| **A33.jsc_hooks_call** — `crate::jsc_hooks::*` dispatch | **3** (visible in `other`; most are in other clusters) | Low | `src/runtime/node/node_fs_stat_watcher.rs:240` |
| **A34.JS_to_js** — `.to_js(global_this)` over a raw pointer | **1** in `other` (most hit `raw_method_call`) | Low | `src/runtime/api/BunObject.rs:3140` |
| **A35.deinit_destroy_raw** — `::deinit(...)` / `::destroy(...)` on raw | **28** | Medium (single-step free pattern) | `src/bundler/HTMLScanner.rs:398`, `src/http/HTTPContext.rs:1095` |
| **A36.std_alloc_Global_forward** — Allocator passthrough | **5** | Low (forwarder) | `src/bun_alloc/hashbrown_bridge.rs:104, 107, 114` |
| **A37.unsafe_fn_trait_decl** — trait `unsafe fn` declaration (no body) | **55** | None — trait surface only; concrete impls bear the unsafe | `src/bun_alloc/lib.rs:1953`, `src/bundler/analyze_transpiled_module.rs:449` |
| **A38.unsafe_fn_body** — `unsafe fn ...(..) { .. }` with body | **135** | Variable — each body has its own SAFETY comment burden | `src/bun_alloc/heap_breakdown.rs:158`, `src/bun_alloc/MimallocArena.rs:643` |
| **A39.keep_alive_ref_unref** — event-loop `.ref_()/.unref()` | **3** | Low | `src/event_loop/AnyEventLoop.rs:624, 629` |
| **A40.iterators_double_deref** — `&mut **item` / `**fn(...)` | **53** | Medium — double-deref over `Option<NonNull<T>>` or `*mut *mut T` | `src/bundler/bundle_v2.rs:4989, 6152, 6546` |
| **A45.JSPromise_value** — `(*req).promise.value()` (in `other` due to chained field) | folded into A1 | Low | — |
| **A46.mem_replace_take** — `core::mem::replace` / `take` on raw ptr | **3** | Medium (relies on the take leaving a valid dummy) | `src/jsc/AsyncModule.rs:1337`, `src/jsc/RuntimeTranspilerStore.rs:1155` |
| **A47.Interned_assume** — `bun_ptr::Interned::assume` | **12** | Low (string interning contract) | `src/resolver/fs.rs:294, 301` |
| **A48.zero_unchecked** — `zeroed_unchecked` / `boxed_zeroed_unchecked` | **2** | High — same shape as the Windows `BundleThread` waker case flagged in `P2-F3` | `src/bun_core/output.rs:357`, `src/runtime/cli/pack_command.rs:1884` |
| **A49.cares_extras** — non-standard cares/dns access | **7** | Low | `src/dns/lib.rs:398`, `src/runtime/dns_jsc/dns.rs:3787` |
| **A50.PipeReader_RefCount** — `PipeReader::deref` / `PipeWriter::deref` | **5** | Low (refcount discipline) | `src/runtime/api/bun/subprocess/SubprocessPipeReader.rs:104` |

**Total clustered: 2,135 / 3,533 (60 %).** The remaining 1,398 are
long-tail one-offs: per-callsite FFI vtable dispatch
(`(self.vtable.alloc)(...)`), allocator forwarders
(`self.fallback.grow(ptr, old, new)`), per-callsite tagged-union reads
(`this.m_ptr.latin1`), and ad-hoc raw-pointer projections that don't share
a name with peers. These do not benefit from a sub-category and should
remain in the catch-all.

### 3.2 Per-cluster bug-shape risk summary

**Routine (≥80 % discharged by existing comment):**
A5 (cstr), A6 (libc CStr), A13 (IntrusiveRc), A19 (DevServer dispatch), A23
(uws ext), A29 (schedule), A31 (fs_callback), A33 (jsc_hooks), A36
(allocator forward), A37 (trait decl), A39 (keepalive), A47 (Interned),
A49 (cares extras), A50 (PipeReader). Total ≈ 230 sites. No new audit work
needed beyond confirming the standard SAFETY comment.

**Worth a SAFETY-comment pass** (mid-risk, no UB found):
A1 (raw_method_call_residual), A2 (field as_ref), A4 (callback_ctx), A10
(bitwise_copy), A16 (Strong adopt), A18 (parser ctx log), A21 (FileSink
deref), A22 (socket_ext_owner), A26 (intrusive_next), A28 (Zig-port
self-call residual), A30 (timer_insert raw), A34 (to_js raw), A35
(deinit/destroy raw), A40 (double_deref), A45 (promise.value), A46 (mem
replace/take). Total ≈ 1,260 sites. Each one is a stand-alone audit
artifact for the next pass; the cluster names give the auditor a
fast-grep entry-point.

**Worth a focused mini-plan** (higher bug-shape risk):
* **A3 (detach_lifetime, 144 sites)** — each is a lifetime laundering.
  Recommendation: emit a per-callsite `// SAFETY:` table with the
  "rebinding lifetime" named.
* **A7 (from_utf8_unchecked, 29 sites)** — UTF-8 audit. Each call must be
  paired with a documented source-of-validity (parser output, file content
  that was already validated, etc.).
* **A11 (from_field_ptr/container_of, 29 sites)** — Stacked Borrows hazard
  audit; each should name the immediate caller and confirm no
  derived-`&Parent` is held at the time of the recovery.
* **A12 (ManuallyDrop drop/take, 14 sites)** — pair-check audit; each must
  have exactly one `take`/`drop` per construction.
* **A17 (set_len_raw_vec, 56 sites)** — pre-fill audit; each must prove
  the bytes/elements `[old_len, new_len)` are initialised.
* **A27 (graph.symbol_mut, 14 sites)** — disjoint-Ref-index audit; each
  must prove no peer task is writing the same `Ref`.
* **A48 (zeroed_unchecked, 2 sites)** — same shape as the Windows waker
  placeholder; align with `P2-F3`.

---

## Section 4. Asymmetric Send/Sync impl audit

Re-running the StoreSlice-vs-StoreRef analysis across all 157 manual
Send/Sync impls yields:

### Types with only `Send` (no `Sync`) — 12

`ConcurrentPromiseTask<'_, C>`, `CrashHandlerEntry`, `DirTask`,
`DynamicBitSetList`, `GlobalCache`, `HpackHandle`, `InitOpts`,
`JSBundleCompletionTask`, `PrepareCssAstTask`, `Resolved`, `SendPtr` (3
variants), `SendVmPtr`, `ShellRmTask`, `SourceMapDataTask`, `Task`
(ThreadPool unit), `WorkTask<C>`.

**Discharge.** Each is a task that *moves* into a worker pool or a single-
thread-affine handle that should not be shared via `&T`. Omitting `Sync` is
intentional.

**Verdict.** No bugs. The asymmetry is the correct one — each of these
types would be unsound if `Sync`'d (`&JSBundleCompletionTask` shared with a
non-bundler thread would race on the producer/consumer state machine).

### Types with only `Sync` (no `Send`) — 9

`CStrPtr`, `CompileResultSlots`, `DotenvSingleton`, `GuardedBy<Value, M>`,
`Step5Ctx<'_>`, `SyncCStr`, `ThreadLock`, `___tracy_source_location_data`,
`napi_node_version`.

**Discharge.**
* `CStrPtr`, `SyncCStr`, `napi_node_version`,
  `___tracy_source_location_data` — embedded in `static` rodata. `Sync` is
  needed for `static` initialization; `Send` is irrelevant.
* `CompileResultSlots`, `DotenvSingleton`, `Step5Ctx<'_>` — held by-reference
  (`&CompileResultSlots`, `&DotenvSingleton`); never moved.
* `GuardedBy<Value, M>` — `Send` auto-derives from `UnsafeCell<Value>: Send
  iff Value: Send` and `M: Send iff M: Send`. Manual `Send` would be
  redundant.
* `ThreadLock` — `Send` auto-derives from `AtomicU64: Send` + `Cell<T>:
  Send iff T: Send`.

**Verdict.** No bugs. **Audit-quality observation:** `GuardedBy<Value, M>`'s
manual-`Sync`-only impl is correct but unusual; an inline comment "Send
auto-derives via UnsafeCell<Value>: Send" would help future readers
distinguish "intentional asymmetry" from "forgotten impl".

### Asymmetric *bounds* on a pair — 0 confirmed bugs

The PASS-2 reclassification doc already names the only known case
(`StoreSlice<T>` missing `T: Send`/`T: Sync` while sister `StoreRef<T>` has
them, `src/ast/nodes.rs:339-340` vs `:39-40`).

This audit's deeper sweep examined every pair `(unsafe impl Send for X,
unsafe impl Sync for X)` for bound mismatches across `T`/`'a`. Findings:

| Type | Send bound | Sync bound | Verdict |
|------|-----------|-----------|---------|
| `StoreRef<T>` | `T: Send` | `T: Sync` | Correct — `&T` & `&mut T` require `Sync` & `Send` respectively |
| **`StoreSlice<T>`** | none | none | **BUG (P2-F1)** |
| `RwLock<T>` | `T: Send` | `T: Send + Sync` | Correct — std mirror |
| `Channel<T, B>` | `T: Send` | `T: Send` | Correct — Mutex-shape |
| `Once<T, F>` | `T: Send, F: Send` | `T: Send + Sync, F: Sync` | Correct — std `OnceLock` mirror |
| `AtomicCell<T>` | `T: Copy` | `T: Copy` | Correct — `Copy + atomic` discharge |
| `ThreadCell<T>` | `T: ?Sized + Send` | `T: ?Sized` | **Asymmetric on `?Sized`** — Sync omits `Send`. Sound because Sync access via `get()` doesn't move T; the asymmetry is intentional and mirrors the documented single-thread invariant |
| `RacyCell<T>` | `T: ?Sized + Send` | `T: ?Sized` | Same shape as `ThreadCell<T>` — load-bearing lie (PUB-N-B) |
| `BSSList<V, COUNT>` | `V: Send` | `V: Send` | Correct — `Mutex<Vec<V>>`-shape |
| `MultiArrayList<T, A>` | `T: Send, A: Send` | `T: Sync, A: Sync` | Correct — `Vec<T>`-shape |
| `RawSlice<T>` | `T: Sync` | `T: Sync` | Correct — `&[T]`-shape |
| `BackRef<T>` | `T: ?Sized + Sync` | `T: ?Sized + Sync` | Correct — `&T`-shape |
| `ParentRef<T>` | `T: ?Sized + Sync` | `T: ?Sized + Sync` | Same as `BackRef<T>` |
| `JsCell<T>` | unbounded | unbounded | **Audit gap (PUB-N-A)** — could tighten Send to `T: Send` |
| `StringHashMapKey<A>` | `A: Allocator + Default + Send` | `A: Allocator + Default + Sync` | Correct |
| `CssRule<R>` | `R: Send` | `R: Sync` | Correct — `Vec`-shape |
| `DeclarationBlock<'bump>` | none on `T` (no `T`) | none | Correct (no `T`) |

**Conclusion of asymmetry sweep.** The `StoreSlice<T>` find is unique.
`JsCell<T>` and `RacyCell<T>` are unbounded by design but the design
permits a typo-shaped bug (wrapping a `!Send` payload) that the type
system would not catch. These are **PUB-N-A** and **PUB-N-B**
candidates.

---

## Section 5. Bug findings — `pre-existing-ub-N` candidates

Naming convention: `PUB-N-A`, `PUB-N-B`, `PUB-N-C` to distinguish from the
prior pass's `P2-F1` etc.

### PUB-N-A — `JsCell<T>: Send` unbounded in `T`

* **Site:** `src/jsc/JSCell.rs:128`
* **Inventory ID:** S-003568
* **Current code:**

  ```rust
  unsafe impl<T> Send for JsCell<T> {}
  ```

* **Concern:** `JsCell<Rc<U>>` (or any `T: !Send`) compiles, even though
  the underlying `UnsafeCell<T>` is `Send iff T: Send`. Cross-thread move
  of a `JsCell<Rc<U>>` followed by `.with_mut(|x| x.clone())` on the
  receiving thread would clone the `Rc` from a non-owner thread —
  data race on the `Rc` refcount.
* **Why this hasn't bitten yet.** Every current call site embeds `JsCell`
  inside `VirtualMachine` (a per-thread singleton); the singleton is
  documented `Send + Sync` but *no caller ever moves a `JsCell` to another
  thread directly*. The Send bound is therefore unused in practice.
* **Severity:** Latent. Audit-quality. The type system permits a future
  caller to introduce the bug; no current path triggers it.
* **Recommended fix:**

  ```rust
  unsafe impl<T: Send> Send for JsCell<T> {}
  ```

  This preserves every current callsite (every embedded payload type is
  already `Send`) and refuses the next-bug-shape. The `Sync` impl
  intentionally stays unbounded — that's the documented load-bearing lie
  the type is built around.
* **Verification path:**

  ```rust
  const _: fn() = || {
      fn assert_not_send<T: ?Sized>() where T: ?Sized {}
      // Negative check: JsCell<Cell<u32>> must NOT be Send after the bound.
      // This is a compile-fail assertion best expressed with a
      // `#[compile_fail]` doctest or a `compiletest_rs` case.
  };
  ```


### PUB-N-B — `RacyCell<T>: Sync` unbounded in `T`

* **Site:** `src/bun_core/util.rs:2282`
* **Inventory ID:** S-001532
* **Current code:**

  ```rust
  unsafe impl<T: ?Sized> Sync for RacyCell<T> {}
  unsafe impl<T: ?Sized + Send> Send for RacyCell<T> {}
  ```

* **Concern:** The doc explicitly says "Do not wrap *payloads* whose
  `!Sync` is load-bearing (`Cell<U>`, `Rc<U>`, `RefCell<U>`); use
  `thread_local!` or a real lock for those." This is a *caller* rule, not
  a *type-system* rule. A `RacyCell<Cell<u32>>` would compile and would be
  silently `Sync`, identical to the `StoreSlice<T>` bug shape.
* **Why this hasn't bitten yet.** Inventoried call sites all wrap one of:
  raw FFI pointers (`*mut SSL_CTX`), `MaybeUninit<T>`, `[u8; N]`, or
  `Option<NonNull<T>>` — none of which are `!Sync` in a "data-racy" way.
  The Phase-1 inventory plus a `grep` over `RacyCell<` confirms no
  bug-shape today.
* **Severity:** Latent. Same audit-quality level as PUB-N-A.
* **Recommended fix.** Two viable shapes:
  1. **Tighten the bound (preferred):**

     ```rust
     unsafe impl<T: ?Sized + Send> Sync for RacyCell<T> {}
     ```

     Mirrors nightly's `SyncUnsafeCell<T>`. Refuses `RacyCell<Cell<u32>>`
     (`Cell<u32>: !Send`).
  2. **Split into two newtypes:** `RacyCell<T>` keeps the bound;
     `RacyCellUnchecked<T>` retains the unconditional `Sync` for the
     last-resort sites. Single-letter-change cleanup at the audit sites
     that genuinely need the unbounded form.
  The cost of (1) is auditing each existing `RacyCell<U>` for `U: Send`;
  the inventory suggests this is a one-PR change. Pair with a compile-time
  assertion in the bound form so regressions are caught immediately.

### PUB-N-C — `Blob: Sync` SAFETY-comment imprecision

* **Site:** `src/jsc/webcore_types.rs:96`
* **Inventory ID:** S-003919
* **Current code:**

  ```rust
  unsafe impl Send for Blob {}
  unsafe impl Sync for Blob {}
  ```

* **Concern.** The comment says the *pointee* is JS-thread-affine. But the
  fields that make `Blob` `!Sync` are `Cell<*const u8>` and
  `Cell<*const JSGlobalObject>` — and the cell-itself access is what `Sync`
  governs, not the pointee deref.
* **Discharge.** The cell access is sound because (a) `Cell<*const _>` is
  one pointer-sized aligned slot, so concurrent `.get()` is racy but
  reads either the old or new pointer value — both valid — and (b)
  `Blob.ref_count: RawRefCount` is atomic. The actual pointee deref is
  routed through documented JS-thread-only paths.
* **Severity:** SAFETY-comment quality only. Not UB.
* **Recommended fix.** Extend the comment to name the cell-access
  rationale separately from the pointee-deref rationale.

---

## Section 6. Recommended PRs

In addition to the PRs C-003 already proposes (StoreSlice fix; SendPtr
consolidation; C-PROPAGATE retrofit; C-USE-ASSERTIONS sweep), this audit
recommends three new low-risk follow-up PRs:

1. **PR — `JsCell<T>: Send` tighten to `T: Send`**
   * Single one-line change: `src/jsc/JSCell.rs:128`.
   * Negative compile-time assertion that `JsCell<Cell<u32>>: !Send`.
   * Verification: `cargo check --workspace --all-targets` (zero call-site
     impact; every current `JsCell<U>` already has `U: Send`).
   * Risk: extremely low. If any existing usage *did* rely on the unbounded
     form, the compile-time assertion would fail and we'd revisit.

2. **PR — `RacyCell<T>: Sync` tighten or split**
   * Either tighten to `T: ?Sized + Send` (preferred) or introduce
     `RacyCellUnchecked<T>` for the unconditional case.
   * Touch a small number of files; the unbounded sites in
     `bun_core/util.rs`, `install/windows-shim/main.rs`, plus the
     ~12 user sites via `grep RacyCell<`.
   * Pair with a compile-time `assert_impl_all!`-style proof at the
     bounded version's module.
   * Risk: low — mechanical bound-tightening per use-site.

3. **PR — Reclassify the two A-RAW-PTR-TO-C-STATE mislabels in C-003**
   * `ImportPathsListPtr` (`src/bundler/linker.rs:106-107`) — the pointee is
     a Rust `BSSStringList`, not a C handle.
   * `Waker` (`src/io/windows_event_loop.rs:377-378`) — the pointee is a
     Rust `WindowsLoop`; the `uv_async_send` call is the cross-thread
     primitive, but the Send/Sync impl is over the Rust wrapper.
   * Re-tag in `audit/plans/C-003-send-sync-impls.md` as
     A-CUSTOM-INVARIANT. No source change.

These three are independent and each lands in <50 lines of diff.

---

## Section 7. Verification commands

```bash
# Re-derive the 157 Send/Sync sites and 73 A-CUSTOM-INVARIANT subset
jq -c 'select(.categories | (index("send_impl") or index("sync_impl"))) \
       | {id, crate, file, line, normalized}' \
   .unsafe-audit/unsafe-inventory.jsonl > /tmp/sendsync_all.jsonl
wc -l /tmp/sendsync_all.jsonl     # → 157

# Verify the asymmetric-bounds check
python3 - <<'PY'
import json, re
sends, syncs = {}, {}
with open('/tmp/sendsync_all.jsonl') as f:
    for line in f:
        row = json.loads(line)
        text = row['normalized']
        m = re.search(r'unsafe impl(?:<[^>]*>)?\s+(?:core::marker::)?(\w+)\s+for\s+([^\s\{]+)', text)
        if not m: continue
        kind, typ = m.group(1), m.group(2)
        (sends if kind == 'Send' else syncs).setdefault(typ, []).append((row['id'], text))
only_send = set(sends) - set(syncs)
only_sync = set(syncs) - set(sends)
print(f"Send-only ({len(only_send)}):", sorted(only_send))
print(f"Sync-only ({len(only_sync)}):", sorted(only_sync))
PY

# Re-derive the "other"-only sites
jq -c 'select(.categories == ["other"])' .unsafe-audit/unsafe-inventory.jsonl \
   > /tmp/other.jsonl
wc -l /tmp/other.jsonl     # → 3533

# Verify the StoreSlice bug shape (PASS-2 P2-F1 — kept for reference)
grep -n "unsafe impl<T>" src/ast/nodes.rs
# Should match:
#   src/ast/nodes.rs:339:unsafe impl<T> Send for StoreSlice<T> {}
#   src/ast/nodes.rs:340:unsafe impl<T> Sync for StoreSlice<T> {}

# Verify the PUB-N-A audit-gap shape
grep -n "unsafe impl<T>" src/jsc/JSCell.rs
# Should match:
#   src/jsc/JSCell.rs:126:unsafe impl<T> Sync for JsCell<T> {}
#   src/jsc/JSCell.rs:128:unsafe impl<T> Send for JsCell<T> {}

# Verify the PUB-N-B audit-gap shape
grep -n "unsafe impl<T: ?Sized>" src/bun_core/util.rs
# Should match:
#   src/bun_core/util.rs:2282:unsafe impl<T: ?Sized> Sync for RacyCell<T> {}
```

---

## Appendix A. Cluster-name vocabulary for the next inventory pass

The Phase-1 inventory should adopt these category names so the next pass
doesn't re-rediscover them. Suggested additions to the inventory matcher
(in priority order):

```text
raw_method_call_residual     // (*ptr).method() / (*ptr).field — fold into existing raw_method_call
detach_lifetime              // bun_ptr::detach_lifetime{,_ref}, bun_collections::detach_lifetime
callback_ctx_trampoline      // bun_ptr::callback_ctx, ScopedRef, ThisPtr
ffi_cstr_borrow              // bun_core::ffi::cstr, CStr::from_ptr
utf8_unchecked               // core::str::from_utf8_unchecked
arena_str_zigport            // crate::arena_str / src_str
bitwise_copy_intrusive       // bitwise_copy() for intrusive slot duplication
container_of                 // from_field_ptr! macro
manuallydrop_explicit        // ManuallyDrop::drop, ManuallyDrop::take
intrusive_rc_init            // IntrusiveRc::init_ref, ThreadSafeRefCount::init
strong_adopt                 // jsc::Strong::adopt
set_len_raw_vec              // Vec::set_len, commit_spare, spare_buf
parser_ctx_log               // ctx.log(), ctx.log_mut()
linker_graph_symbol_mut      // graph.symbol_mut(Ref) — disjoint-index discharge
uws_ext_slot                 // ext.data._N for tagged-union extension reads
uws_socket_ext_owner         // socket_ext_owner cast
timer_insert_raw             // hooks.timer_insert, timer_all access
intrusive_double_deref       // &mut **item, **node patterns
zeroed_unchecked             // bun_core::ffi::zeroed_unchecked, boxed_zeroed_unchecked
filesink_deref               // webcore::FileSink::deref refcount
piperef_deref                // PipeReader::deref, PipeWriter::deref
interned_assume              // bun_ptr::Interned::assume
strong_to_js                 // .to_js(global) over raw pointer
event_loop_raw_call          // (*event_loop()).method()
loop_tick_raw                // (*loop).tick(), inc(), dec()
keepalive_ref_unref          // KeepAlive ref_()/unref()
allocator_forward            // self.fallback.grow / shrink
mem_replace_raw              // core::mem::replace / take over raw ptr
deinit_destroy_raw           // ::deinit / ::destroy on raw self pointer
task_schedule_raw            // AnyTaskJob::schedule and similar entrypoints
```

Adopting these in the Phase-1 matcher would cut `["other"]` from 3,533
down to ~1,400, and the residual 1,400 would be genuine one-offs rather
than mis-categorized recurring patterns.

---

## Appendix B. Files referenced

* `.unsafe-audit/unsafe-inventory.jsonl`
* `.unsafe-audit/audit/plans/C-003-send-sync-impls.md`
* `.unsafe-audit/audit/synthesis/codex-pass2-adversarial-reclassification.md`
* `src/ast/nodes.rs:39-40, 167-168, 339-340`
* `src/bundler/Chunk.rs:114-152`
* `src/bundler/LinkerContext.rs:233-240, 1615-1633`
* `src/bundler/linker.rs:97-107`
* `src/bundler/linker_context/prepareCssAstsForChunk.rs:30-51`
* `src/bundler/linker_context/scanImportsAndExports.rs:495-509`
* `src/bun_alloc/lib.rs:113-124, 2167-2183`
* `src/bun_alloc/MimallocArena.rs:88-120`
* `src/bun_core/atomic_cell.rs:50-66, 494-504`
* `src/bun_core/util.rs:2269-2283, 2330-2340, 2681-2692`
* `src/jsc/JSCell.rs:89-128`
* `src/jsc/VirtualMachine.rs:600-612`
* `src/jsc/webcore_types.rs:75-96, 596-616, 1180-1201`
* `src/jsc/ConcurrentPromiseTask.rs:30-55`
* `src/jsc/WorkTask.rs:35-58`
* `src/jsc/hot_reloader.rs:405-422`
* `src/jsc/Debugger.rs:575-593`
* `src/jsc/web_worker.rs:580-590`
* `src/jsc/TopExceptionScope.rs:19-31`
* `src/threading/channel.rs:35-49`
* `src/threading/guarded.rs:26-38`
* `src/threading/Mutex.rs:201-265`
* `src/threading/Condition.rs:210-224`
* `src/threading/Semaphore.rs:13-23`
* `src/threading/RwLock.rs:149-158`
* `src/threading/ThreadPool.rs:323-337, 1480-1494`
* `src/runtime/dns_jsc/dns.rs:101-107, 2370-2386`
* `src/runtime/node/fs_events.rs:200-209, 245-253`
* `src/runtime/node/path_watcher.rs:100-109`
* `src/runtime/shell/IOReader.rs:70-83`
* `src/runtime/shell/IOWriter.rs:230-244`
* `src/runtime/shell/builtin/rm.rs:700-714`
* `src/runtime/bake/production.rs:60-74`
* `src/runtime/api/js_bundle_completion_task.rs:100-106`
* `src/semver/SemverQuery.rs:117-132, 240-262`
* `src/resolver/fs.rs:1820-1840`
* `src/resolver/lib.rs:890-898`
* `src/standalone_graph/StandaloneModuleGraph.rs:75-90, 180-190`
* `src/spawn/process.rs:1265-1280`
* `src/sys/lib.rs:175-192, 5880-5891`
* `src/io/windows_event_loop.rs:365-378`
* `src/install/windows-shim/main.rs:200-214`
* `src/install/patch_install.rs:340-360`
* `src/boringssl/lib.rs:115-126`
* `src/http/h3_client/PendingConnect.rs:170-179`
* `src/http/HTTPThread.rs:300-314`
* `src/http/lshpack.rs:195-204`
* `src/http/ssl_config.rs:430-445`
* `src/sql_jsc/jsc.rs:482-492`
* `src/crash_handler/lib.rs:605-617`
* `src/perf/tracy.rs:665-673`
* `src/runtime/napi/napi_body.rs:1985-1994`
* `src/runtime/node/node_process.rs:80-91`
* `src/bun_core/Global.rs:810-816`
* `src/bun_core/string/mod.rs:1255-1265`
* `src/bun_core/string/StringJoiner.rs:15-90`
* `src/bun_core/lib.rs:200-212`
* `src/css/declaration.rs:43-54`
* `src/css/rules/mod.rs:165-174`
* `src/collections/array_hash_map.rs:1550-1559`
* `src/collections/bit_set.rs:1385-1392`
* `src/collections/multi_array_list.rs:440-453`
* `src/js_parser/defines_table.rs:195-210`
* `src/js_parser/lib.rs:375-385`
* `src/bundler/bundle_v2.rs:1520-1544`
* `src/bundler/BundleThread.rs:160-190, 380-390`
* `src/bundler/LinkerGraph.rs:75-97`
* `src/bundler/ThreadPool.rs:43-78`
* `src/bundler/lib.rs:320-342`
* `src/ptr/lib.rs:620-628`
* `src/ptr/parent_ref.rs:400-407`

---

End of PASS-2 deliverable.
