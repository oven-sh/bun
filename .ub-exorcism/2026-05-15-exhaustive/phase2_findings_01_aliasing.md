# Phase 2 Bucket 1: Aliasing — findings

Static-bucket sweeper run for Bucket 1 (`&T`/`&mut T` violations, `*mut T`
deref while a live `&T` exists, `slice::from_raw_parts_mut` overlapping a
`from_raw_parts`, manual Cell-likes without `UnsafeCell`, sibling-projection
from `&mut self`, generic-Send laundering of aliasing-relevant payloads).
Source-tree-only (no Miri). Numbers are workspace-wide unless scoped.

---

## Cross-refs to existing EXP entries

| EXP-ID | file:line | severity | one-line |
|---|---|---|---|
| EXP-010 | `src/bundler/LinkerContext.rs:1657-1663`; `linker_context/{generateCompileResultForJSChunk.rs:54-62, generateCompileResultForCssChunk.rs:45-46, prepareCssAstsForChunk.rs:76-80}` | CONFIRMED_UB (TB model) | bundler parallel-callback `&mut LinkerContext` 5-site cluster B-1..B-5 |
| EXP-011 | picohttp wrapper NUL-write | CONFIRMED_UB (TB model) | write through `*const` derived from `&[u8]` provenance (Section Q) |
| EXP-012 | `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:599-637` | RESOLVED (watchpoint) | named cancel path uses `*mut Self` + `ThisPtr` + `ref_guard` |
| EXP-014 | `src/collections/multi_array_list.rs:564-568` | CONFIRMED_UB | `Slice<T>: Copy` lets two `ColMut` overlap (in-source TODO) |
| EXP-015 | `src/collections/array_hash_map.rs:1898-2014` | NO_EVIDENCE | `put_borrowed`/`get_or_put_borrowed` lifetime laundering (also bucket 15) |
| EXP-018 | `src/threading/guarded.rs:132-134` | CONFIRMED_UB | `GuardedLock<…, Mutex>` missing `_not_send`; source-faithful auto-trait witness confirms safe Rust can move a held guard to another OS thread (also bucket 8) |
| EXP-019 | `src/ast/nodes.rs:339-340` | CONFIRMED_UB | `unsafe impl<T> Send/Sync for StoreSlice<T>` unbounded (also bucket 8) |
| EXP-021 | `src/ast/nodes.rs:42-113, 170-208, 342-413` | CONFIRMED_UB | `StoreRef`/`StoreStr`/`StoreSlice` safe constructors expose dangling slices (also 15, 4/5) |
| EXP-026 | `src/runtime/timer/mod.rs:897, 1016`; `src/runtime/jsc_hooks.rs:152-157` | CONFIRMED_UB (TB model) | `timer::All::{get_timeout,drain_timers}` `&mut self` receiver across re-entry |
| EXP-099 | `src/runtime/node/node_cluster_binding.rs:35-51,147-158`; `src/jsc/ipc.rs:140-159` | CONFIRMED_UB (TB model) | `child_singleton() -> &mut InternalMsgHolder` re-enters during `InternalMsgHolder::flush(&mut self)`; `black_box(ptr::from_mut(self))` does not erase the live receiver borrow |
| EXP-100 | `src/runtime/socket/UpgradedDuplex.rs:27-44,101-146,202-216,304-390,587-599`; `src/uws_sys/lib.rs:191-201` | CONFIRMED_UB (TB model) | `UpgradedDuplex` methods hold `&mut self` / `&mut self.wrapper` while `SSLWrapper` synchronously calls back through `ctx: *mut UpgradedDuplex` and materializes a fresh `&mut UpgradedDuplex`; contrast `ProxyTunnel`'s disjoint-field pattern |
| EXP-101 | `src/http/ProxyTunnel.rs:707-711`; callers `src/http/lib.rs:1347-1355`, `src/http/HTTPContext.rs:692-700` | CONFIRMED_UB (TB model) | `ProxyTunnel` has the correct raw/disjoint-field pattern, but `shutdown(&mut self)` still calls `wrapper.shutdown(true)` while a whole-struct receiver borrow is protected; callbacks' raw field writes are valid only through `close_raw` / raw-owner entry |
| EXP-102 | `src/http/ProxyTunnel.rs:768-775`; callers `src/http/lib.rs:2876-2888`, `src/http/lib.rs:2913-2947` | CONFIRMED_UB (TB model) | `ProxyTunnel::write(&mut self, buf)` is the same stale receiver shape for the live request-body path: it calls `wrapper.write_data(buf)`, which can synchronously invoke `write_encrypted` / close callbacks while the whole-struct receiver tag is protected. |
| EXP-103 | `src/http/ProxyTunnel.rs:714-749,752-765`; callers `src/http/lib.rs:2754-2755`, `src/http/lib.rs:3254-3258` | CONFIRMED_UB (TB model) | `ProxyTunnel::on_writable(&mut self)` and `receive(&mut self, ...)` capture a raw pointer first, but the protected whole-struct receiver remains live while `SSLWrapper::flush` / `receive_data` can synchronously invoke callbacks. Raw-owner controls pass. |
| EXP-104 | `src/runtime/socket/WindowsNamedPipe.rs:261-315,394-407,554-610,1038-1052,1127-1152,1166-1238`; thunk macro `src/jsc_macros/lib.rs:828-843` | CONFIRMED_UB (TB model) | `WRAPPER_BUSY` correctly defers wrapper drop but does not cancel the protected whole-struct `&mut self` receiver held while driving `SSLWrapper`; generated exports are one source of that receiver and internal receive paths are same-shape. `SSLWrapper` callbacks materialize fresh whole-struct `&mut WindowsNamedPipe`. |
| EXP-027 | `src/runtime/node/dir_iterator.rs:44-67, 499-522, 895-899`; `src/bun_core/lib.rs:208-212` | CONFIRMED_UB | Windows `IteratorResultW` returns sendable `RawSlice<u16>` into iterator scratch (also 8, 15, 4) |
| EXP-028 | `src/runtime/bake/DevServer/DirectoryWatchStore.rs:69-81` | NO_EVIDENCE / stale-draft hygiene | `owner(&mut self) -> &mut DevServer` sibling-projection via `from_field_ptr!` remains in the Phase-A draft module; canonical `dev_server::DirectoryWatchStore` already returns `*mut DevServer`, and no draft-type call sites were found. |
| EXP-044 (formerly referenced in notes as EXP-030 before registry normalization) | `src/bundler/bundle_v2.rs:1216, 1227, 1362, 1376`; `src/runtime/api/JSBundler.rs:1387-1405` | CONFIRMED_UB (plugin re-entry harness) | `unsafe { &mut *self.bv2 }` / `bv2_mut` JS-loop trampoline reborrow of `&mut BundleV2`; raw log `phase5_experiment_results/EXP-044.log` |
| EXP-028 cluster | see F-A-2 below | STRUCTURAL-HARDENING / DEFERRED-VEHICLE | Other `from_field_ptr!` sibling-projection sites. Legacy on-disk `EXP-022` artifacts belong to the DirectoryWatchStore witness now tracked canonically as `EXP-028`; remaining per-site projections are covered by the F-A-2 enumeration rather than a separate EXP-022 entry. |
| hardening only (formerly EXP-025 placeholder) | `src/runtime/server/RequestContext.rs:266, 321-323` | CONTRACTUAL-BUT-DEFENSIBLE | `as_response(value) -> Option<&'static mut Response>` is already `unsafe fn`; `NativePromiseContext::take` is private-to-file and reviewed call sites immediately scope the returned context with `RequestContextRef` (also bucket 15) |

---

## New findings (this phase)

| F-ID | file:line | severity | bucket cross-tags | draft-experiment-sketch (<=10 lines) |
|---|---|---|---|---|
| F-A-1 | `src/runtime/webcore/Sink.rs:1232` | STRICT_PROVENANCE_FAIL | 1 + 2 + 15 | `unsafe { &mut *(ptr.as_uintptr() as usize as *mut Subprocess<'_>) }` — int→ptr round-trip then `&mut`. Same shape as EXP-020 / EXP-029. Reproducer: stash a Subprocess address in a TaggedPointer, read back via `as_uintptr() as usize as *mut`, deref under `MIRIFLAGS=-Zmiri-strict-provenance`. |
| F-A-2 | `src/bundler/ParseTask.rs:354,362,1872`; `src/bundler/ServerComponentParseTask.rs:76`; `src/bundler/ThreadPool.rs:563`; `src/bundler/HTMLImportManifest.rs:190`; `src/bundler/DeferredBatchTask.rs:46`; `src/bundler/linker_context/{prepareCssAstsForChunk.rs:58, generateCompileResultForHtmlChunk.rs:56, LinkerContext.rs:1407,1441,1711}`; `src/jsc/AsyncModule.rs:401`; `src/runtime/dispatch.rs:794,799,823,828`; `src/runtime/webcore/FileSink.rs:1593`; `src/event_loop/EventLoopTimer.rs:288`; `src/http/AsyncHTTP.rs:855`; `src/http/HTTPThread.rs:995`; `src/http/lib.rs:3848`; `src/bun.rs:365`; `src/collections/pool.rs:464`; `src/bun_core/lib.rs:808-863` | LIKELY-UB-SHAPE | 1 + 14 | 95 `from_field_ptr!` / `bun_core::from_field_ptr!` invocations workspace-wide. The macro recovers `*mut Parent` from `*mut field`; the old EXP-028 `DirectoryWatchStore` example is now stale-draft hygiene because the canonical implementation already returns raw. Remaining call sites that form `&mut *parent` from worker-thread task fields still need per-site TB/source audit. |
| F-A-3 | `src/bun_core/util.rs:747` | CONTRACTUAL-BUT-DEFENSIBLE | 1 + 6 | `WStr::from_raw_mut(ptr, len)` forms `&mut [u16]` and reborrows it as `&mut WStr`. Source audit verifies `WStr` is `#[repr(transparent)] pub struct WStr([u16])`, so the cast itself is layout-valid. The remaining obligations are the explicit `unsafe fn` preconditions (`ptr[..=len]` writable and `ptr[len] == 0`), not a detected UB bug. |
| F-A-4 | `src/bundler/linker_context/doStep5.rs:694` | DEFENSIBLE-BUT-BRITTLE | 1 + 5 | `&mut *(init as *mut [MaybeUninit<Stmt>] as *mut [Stmt])` is currently source-proven initialized: `stmts_count` is the exact per-export plus conditional-trailing count, `all_export_stmts_base` is captured after the per-export writes, and every conditional term in `all_export_stmts_len` has exactly one `emit_export_stmt!` before the cast. Keep as a brittleness/refactor target, not a current uninit-UB finding. |
| F-A-5 | `src/jsc/TopExceptionScope.rs:497-498` | DEFENSIBLE-LAYOUT-PUN | 1 + 5 | `ExceptionValidationScope::init_at` reinterprets `MaybeUninit<ExceptionValidationScope>` as `MaybeUninit<TopExceptionScope>` only under the cfg where `ExceptionValidationScope` has exactly one non-ZST field, `scope: TopExceptionScope`. The in-source const assertion proves size and alignment equality; with a single non-ZST field this forces offset 0, and `MaybeUninit<T>` preserves layout. Do not count as UB. |
| F-A-6 | `src/ini/lib.rs:1361` | CONTRACTUAL-BUT-DEFENSIBLE | 1 + 15 | `&mut *(env as *mut DotEnvLoader<'_> as *mut DotEnvLoader<'static>)` — lifetime laundering via `*mut`. Source audit on 2026-05-16 found the local parser drops before return; `DotEnvLoader::get()` only lends owned map bytes; parser substitutions copy into the parser arena; and all values that survive `load_npmrc()` are boxed or otherwise owned (`ConfigItem`, `ScopeItem`, `NpmRegistry`, `PnpmMatcher`). Keep as an auditability/refactor target, not a current live-UB claim. |
| F-A-7 | `src/runtime/api/JSBundler.rs:1387-1405` (`bv2_mut`/`bv2_plugin` helpers) | CONFIRMED_UB (plugin re-entry harness) | 1 + 21 | Centralized `*mut BundleV2 → &mut BundleV2` reborrow used by 4 plugin-callback exports. SAFETY comment cites "live backref + single JS thread + disjoint heap" but the returned `&'a mut` lifetime is caller-chosen, so two callers within the same plugin frame can collide. Confirmed under EXP-044 (the old EXP-030 brief reference was normalized to EXP-044 in the registry). |
| F-A-8 | `src/bundler/BundleThread.rs:170-173` (second `SendPtr<T>`); `src/runtime/dns_jsc/dns.rs:104-107` (first); `src/jsc/JSCell.rs:126-128` (`JsCell<T>`) | LIKELY-UB | 1 + 8 | Three independent `unsafe impl<T> Send for X<T> {}` generic-Send-laundering sites (in addition to EXP-019's `StoreSlice<T>`). All allow safe construction with `T = Cell<…>` / `T = !Send` payload. JsCell explicitly relies on "single JS thread" but auto-trait says otherwise. |
| F-A-9 | `src/options_types/context.rs` (3 `pub unsafe fn` accessors over `*mut Log`) | DEFENSIBLE | 1 + 8 | `ContextData` carries `AtomicPtr<Log>` published process-wide; the `*mut Log` accessors return raw pointers and are documented as "no `&mut self` proof of exclusivity" — gold-standard SAFETY but auditor-fragile. |
| F-A-10 | `src/runtime/server/HTMLBundle.rs:154` (`pub struct Route`) | REVIEWED-CLEAN / REGRESSION-WATCH | 1 + 13 | `Route` has `*mut Route` callbacks (uws on_aborted, JSBundleCompletionTask backref) that re-enter while a `&Route` may be on the stack. SAFETY comment line 149-151 explicitly chooses `&self`+UnsafeCell over `&mut self` to avoid the alias. **This is the safe-pattern reference**, not a current UB finding; keep as a regression watchpoint if new plain fields are added without interior mutability. |
| F-A-11 | `src/runtime/webcore/Sink.rs:1232`; `src/runtime/shell/EnvStr.rs:188-200`; `src/url/lib.rs:340-351` | STRICT_PROVENANCE_FAIL_CLUSTER | 1 + 2 | At least 3 sites that round-trip pointer→integer→pointer then form a reference. EXP-020 covers URL; EXP-029 covers EnvStr; F-A-1 (Sink) was previously uncovered. |
| F-A-12 | `src/runtime/dispatch.rs:794,799,823,828` (4 sites) | CONTRACTUAL-BUT-DEFENSIBLE / REVIEWED | 1 + 21 | `&mut *bun_core::from_field_ptr!(ReadFile, io_poll, poll)` and `WriteFile` analog — source audit demotes the aliasing claim. The POSIX epoll/kqueue callback receives a raw `*mut Poll`; the `&mut Poll` from registration is short-lived and not retained. The remaining issue is strict provenance in `Pollable::init`/`Pollable::poll`, tracked as F-P-9, not a confirmed sibling-projection UB. |
| F-A-13 / EXP-099 | `src/runtime/node/node_cluster_binding.rs:35-51,147-158`; `src/jsc/ipc.rs:140-159` | CONFIRMED_UB | 1 + 15 + 21 | `child_singleton<'a>() -> &'a mut InternalMsgHolder` is safe and caller-lifetime-erased; `on_internal_message_child()` holds that `&mut` while calling `flush(&mut self)`, and `flush` runs `event_loop.run_callback` via `dispatch_unsafe`. The source comment names re-entry through a fresh `&mut Self`; Tree-Borrows confirms the protected receiver tag is still live. |
| F-A-14 / EXP-100 | `src/runtime/socket/UpgradedDuplex.rs:27-44,101-146,202-216,304-390,587-599`; `src/uws_sys/lib.rs:191-201` | CONFIRMED_UB | 1 + 15 + 21 | `UpgradedDuplex::{flush,close,shutdown,encode_and_write,on_internal_receive_data}` borrow `&mut self.wrapper` and call `SSLWrapper`; `SSLWrapper` synchronously invokes callbacks with `ctx: *mut UpgradedDuplex`, and those callbacks materialize `&mut UpgradedDuplex` and can write `self.wrapper = None`. Tree-Borrows confirms the receiver protector conflict. |
| F-A-15 / EXP-101 | `src/http/ProxyTunnel.rs:707-711`; callers `src/http/lib.rs:1347-1355`, `src/http/HTTPContext.rs:692-700` | CONFIRMED_UB | 1 + 15 + 21 | `ProxyTunnel::shutdown(&mut self)` is the leftover pre-fix receiver shape beside the otherwise-correct `close_raw` path. Tree-Borrows rejects callback raw-field writes while the whole-struct receiver tag from `shutdown(&mut self)` is protected; the raw-owner control path passes. |
| F-A-16 / EXP-102 | `src/http/ProxyTunnel.rs:768-775`; callers `src/http/lib.rs:2876-2888`, `src/http/lib.rs:2913-2947` | CONFIRMED_UB | 1 + 15 + 21 | `ProxyTunnel::write(&mut self, buf)` still calls `SSLWrapper::write_data` under a whole-struct receiver. `write_data` reaches `handle_traffic`, which can synchronously invoke ProxyTunnel callbacks; disjoint raw-field writes are valid only through a raw-owner `write_raw` path. |
| F-A-17 / EXP-103 | `src/http/ProxyTunnel.rs:714-749,752-765`; callers `src/http/lib.rs:2754-2755`, `src/http/lib.rs:3254-3258` | CONFIRMED_UB | 1 + 15 + 21 | `ProxyTunnel::on_writable(&mut self)` and `receive(&mut self, ...)` are the remaining raw-capture-first receiver wrappers. Capturing `NonNull::from(&mut *self)` at the top of the method does not end the receiver protector; `SSLWrapper::flush` / `receive_data` can re-enter callbacks that write fields through raw projections while that whole-struct receiver tag is still protected. |
| F-A-18 / EXP-104 | `src/runtime/socket/WindowsNamedPipe.rs:261-315,394-407,554-610,1038-1052,1127-1152,1166-1238`; `src/jsc_macros/lib.rs:828-843` | CONFIRMED_UB | 1 + 15 + 21 | `WindowsNamedPipe` fixed the UAF half of SSLWrapper re-entry with `WRAPPER_BUSY`, but representative SSLWrapper-driving paths still hold whole-struct `&mut self` while entering callback-capable wrapper code. The generated-export and internal receive shapes both let callbacks materialize a fresh whole-struct `&mut WindowsNamedPipe`; Tree-Borrows rejects the modeled receiver-protector conflict. |

---

## Enumerations

### unsafe impl<T> Send/Sync for X<T> (generic-Send anti-pattern)

44 generic `unsafe impl<…> (Send|Sync) for …` sites total in workspace. The
**unbounded** subset (no `T: Send`/`T: Sync` bound) is the soundness-relevant
group:

| crate | file:line | type | bound on T | safety_status |
|---|---|---|---|---|
| `bun_ast` | `src/ast/nodes.rs:339-340` | `StoreSlice<T>` | **none** | UNBOUNDED — EXP-019 CONFIRMED_UB; fix in open PR #30765 |
| `bun_jsc` | `src/jsc/JSCell.rs:126,128` | `JsCell<T>` | **none** | UNBOUNDED — SAFETY says "single JS thread"; auto-trait says otherwise. F-A-8. |
| `bun_runtime::dns_jsc` | `src/runtime/dns_jsc/dns.rs:107` | `SendPtr<T>` | **none** | UNBOUNDED — Section I subagent already flagged; "synchronization via `global_cache()`" is a runtime invariant, not a type bound. F-A-8. |
| `bun_bundler` | `src/bundler/BundleThread.rs:173` | `SendPtr<T>` (local) | **none** | UNBOUNDED — second copy of the SendPtr<T> shape. F-A-8. |
| `bun_ast` | `src/ast/nodes.rs:39-40` | `StoreRef<T>` | `T: Send` / `T: Sync` | BOUNDED — sound auto-trait shape; same surface as `StoreSlice` but properly bounded |
| `bun_bundler` | `src/bundler/LinkerContext.rs:239-240,1632-1633` | `LinkerContext<'a>`, `GenerateChunkCtx<'a>` | lifetime-only | EXP-010-related: only-lifetime parameter, not really "generic-Send"; relies on per-callback aliasing discipline |
| `bun_css` | `src/css/declaration.rs:53-54` | `DeclarationBlock<'bump>` | lifetime-only | DEFENSIBLE — multi-paragraph SAFETY argues post-parse-immutable; lifetime-only generic |
| `bun_css` | `src/css/rules/mod.rs:173-174` | `CssRule<R>` | `R: Send` / `R: Sync` | BOUNDED |
| `bun_collections` | `src/collections/multi_array_list.rs:556-557` | `MultiArrayList<T,A>` | `T: Send, A: Allocator + Send` / Sync | BOUNDED |
| `bun_alloc` | `src/bun_alloc/lib.rs:2182-2183` | `BSSList<V, COUNT>` | `V: Send` | REVIEWED-HARDENING — no safe shared `&self -> &V` accessor exists on `BSSList`; prior `at_index` concern belonged to `OverflowList`. Make fields private / re-review if an accessor is added. |
| `bun_collections` | `src/collections/array_hash_map.rs:1561-1562` | `StringHashMapKey<A>` | `A: Allocator + Default + Send/Sync` | BOUNDED |
| `bun_threading` | `src/threading/RwLock.rs:157-158` | `RwLock<T>` | `T: Send` / `T: Send + Sync` | std-equivalent bounded |
| `bun_threading` | `src/threading/channel.rs:47-49` | `Channel<T,B>` | `T: Send, B: LinearFifoBuffer<T>` | BOUNDED but B is a trait without `: Send` — requires inspection |
| `bun_threading` | `src/threading/guarded.rs:38` | `GuardedBy<V,M>` | `V: Send, M: RawMutex + Sync` | EXP-018 the related `GuardedLock<V,M>` is missing `_not_send` |
| `bun_ptr` | `src/ptr/lib.rs:627-628` | `BackRef<T>` | `T: ?Sized + Sync` | BOUNDED but Send-only-needs-Sync is weak; review |
| `bun_ptr` | `src/ptr/parent_ref.rs:406-407` | `ParentRef<T>` | `T: ?Sized + Sync` | same as BackRef |
| `bun_jsc` | `src/jsc/ConcurrentPromiseTask.rs:55` | `ConcurrentPromiseTask<'_, C>` | `C: ConcurrentPromiseTaskContext` | trait-bounded — relies on trait being a Send-marker proxy |
| `bun_jsc` | `src/jsc/WorkTask.rs:58` | `WorkTask<C>` | `C: WorkTaskContext` | same as ConcurrentPromiseTask |
| `bun_core` | `src/bun_core/atomic_cell.rs:65-66` | `AtomicCell<T>` | `T: Copy` | BOUNDED but Copy ≠ Send (e.g. `*mut U: Copy` is `!Send`) — **review** |
| `bun_core` | `src/bun_core/atomic_cell.rs:503-504` | `ThreadCell<T>` | `T: ?Sized + Send` (Send), unbounded (Sync) | Sync **unbounded**; review |
| `bun_core` | `src/bun_core/util.rs:2276-2277` | `RacyCell<T>` | unbounded Sync; `T: Send` for Send | Sync **unbounded** |
| `bun_core` | `src/bun_core/lib.rs:211-212` | `RawSlice<T>` | `T: Sync` (both Send and Sync) | EXP-027 root cause — Sync→Send relaxation lets sendable Result escape iterator |
| `bun_install/windows-shim` | `src/install/windows-shim/main.rs:214` | `RacyCell<T>` | unbounded `?Sized` | UNBOUNDED for Sync; install-time only |

### *mut Self callback pattern (stratified sample)

468 `unsafe fn name(this: *mut Self, …)` declarations in workspace (rg-confirmed).
Section subtotals from inventories:

| section | callback fn site count | reentry depth | sibling-fix-applied? |
|---|---:|---|---|
| F (server + jsc_hooks) | 808 unsafe sites; 93 `*mut Self` shapes (F notes line 115) | unbounded; deepest observed: uws on_data → JS → ws.send → uws write → on_writable → JS → ws.close → on_close (F notes line 164) | YES — `*mut Self` discipline uniformly applied; no `&mut self` ever held across callbacks that may free `self` |
| A (webcore) | 266 Bucket-1 sites (A notes line 64); FileSink alone has 52 `*mut Self` sites | re-entrant FFI for stream sinks | YES — explicit `borrow=ptr` mode in `impl_streaming_writer_parent!` |
| B (api) | 165 Bucket-1 sites (B notes line 67); cron.rs 30 `unsafe fn(this: *mut Self)` | re-entrant via `cb.call()` | YES — R-2 discipline (`&self`-receiver + UnsafeCell) is the dominant pattern |
| E (socket) | 100+ `*mut Self` (E notes line 255 lists socket_body.rs sites at 730/784/855/1025/1128); WebSocketUpgradeClient 9 callbacks | unbounded — `tcp.close()` may free `this` | YES — best-in-section per Q-notes line 153 |
| G (bake) | 1 callback (HmrSocket on_close) | callback consumes self | YES — destroy-self stays at pointer level |
| I (dns_jsc) | 4 request clusters | re-entrant cancel/notify | YES — uniformly `*mut Self` |
| J (timer) | EXP-026 — `&mut self` receiver still on `get_timeout`/`drain_timers` despite TODO(b2) | re-entrant via `WTFTimer__fire` → `update`/`remove` | NO — fix unmerged |
| Q (uws/h3) | WebSocketUpgradeClient 9 callbacks (`:682, 706, 778, 833, 1189, 1241, 1680, 1748, 1761`) | unbounded (`tcp.close` may free) | YES |
| M (bundler) | EXP-010 5-site cluster + EXP-044 4-site `bv2` cluster | parallel workers / plugin re-entry | NO — explicit aliased `&mut LinkerContext` (B-1..B-5) and `&mut BundleV2` (bundle_v2:1216/1227/1362/1376) |

### Sibling-projection from &mut self

95 `from_field_ptr!` invocations workspace-wide. Stratified by aliasing-overlap shape:

| crate | file:line | macro/fn | aliasing-overlap shape |
|---|---|---|---|
| `bun_runtime/bake` | `src/runtime/bake/DevServer/DirectoryWatchStore.rs:69-81` | `from_field_ptr!` returns **`&mut DevServer`** (not `*mut`) in the mounted Phase-A draft module | EXP-028 — demoted to stale-draft hygiene; canonical `dev_server::DirectoryWatchStore` in `dev_server/mod.rs` already returns `*mut DevServer` |
| `bun_runtime/server` | `src/runtime/server/RequestContext.rs:321` | `as_response(value) -> Option<&'static mut Response>` | hardening-only after follow-up: `unsafe fn` boundary plus per-call sole-`&mut`/rooting comments |
| `bun_runtime/server` | `src/runtime/server/RequestContext.rs:266` | `NativePromiseContext::take` (per F notes line 170) | hardening-only after follow-up: private wrapper around one-shot cell take, immediately guarded by `RequestContextRef` at reviewed call sites |
| `bun_jsc` | `src/runtime/jsc_hooks.rs:152-157` | `timer_all_mut() -> &'static mut timer::All` | EXP-026 — caller-discipline ("not themselves fields of `All`") not type-enforced |
| `bun_bundler` | `src/bundler/ParseTask.rs:354,362` | `&mut *bun_core::from_field_ptr!(ParseTask, io_task, task)` | worker-thread sibling recovery; reborrow is mut, not raw |
| `bun_bundler` | `src/bundler/ServerComponentParseTask.rs:76` | `&mut *(bun_core::from_field_ptr!(ServerComponentParseTask, task, ...))` | same shape as ParseTask |
| `bun_bundler` | `src/bundler/ThreadPool.rs:563` | `let this: *mut Worker = unsafe { bun_core::from_field_ptr!(Worker, deinit_task, task) };` | returns raw — sound mode |
| `bun_bundler` | `src/bundler/HTMLImportManifest.rs:190` | `&*bun_core::from_field_ptr!(BundleV2<'static>, graph, ...)` | shared reborrow — sound mode |
| `bun_bundler` | `src/bundler/DeferredBatchTask.rs:46` | `&mut *bun_core::from_field_ptr!(...)` | F-A-2 family |
| `bun_bundler/linker_context` | `prepareCssAstsForChunk.rs:58, generateCompileResultForHtmlChunk.rs:56, LinkerContext.rs:1407,1441,1711` | mix of `&*` and `&mut *` | composes with EXP-010 if multiple chunks recover the same parent |
| `bun_runtime/dispatch.rs` | `:794,799,823,828` (4 sites) | `&mut *bun_core::from_field_ptr!(ReadFile/WriteFile, io_poll, poll)` | F-A-12 — reviewed/demoted for aliasing; strict-provenance concern lives in F-P-9 |
| `bun_runtime/webcore/FileSink.rs` | `:1593` | inside callback path | sound — only inside the macro pattern |
| `bun_event_loop/EventLoopTimer.rs` | `:288` | `bun_core::from_field_ptr!(Self, $field, t)` returns raw | sound mode |
| `bun_http/AsyncHTTP.rs` | `:855, :970` | mix of raw and `&mut *` | `:970` is `&mut *` reborrow |
| `bun_http/HTTPThread.rs` | `:995` | `bun_core::from_field_ptr!(AsyncHttp, task, ...)` raw | sound mode |
| `bun_jsc/AsyncModule.rs` | `:401` | `&mut *bun_core::from_field_ptr!(VirtualMachine, modules, queue)` | parent recovery — needs review for re-entry overlap |
| `bun_collections/pool.rs` | `:464` | `Node<T>` data field projection | local — sound shape |
| `bun.rs` | `:365` | `Storage<T>::node` projection | local — sound shape |
| `bun_core/lib.rs` | `:699-863` | macro definition + safe wrappers | the macro itself + `from_field_safe!` helpers (shared/mut) at `:808/:814/:824` |

---

## Summary

- **18 existing EXP cross-refs** (EXP-010, 011, 012, 014, 015, 018, 019, 021, 026, 027, 028, 044, 099, 100, 101, 102, 103, 104). The former brief-only `bundle_v2 self.bv2` reference is now normalized under EXP-044 / Cluster S4. The former EXP-025 RequestContext placeholder is hardening-only after follow-up source audit. EXP-022 referenced in brief is identical to EXP-028's pattern; covered in F-A-2 enumeration.
- **18 new findings** (F-A-1 .. F-A-18).
- **3 enumerations completed**:
  1. 44 generic Send/Sync impls (4 unbounded UB-class: StoreSlice<T>, JsCell<T>, two SendPtr<T>; 4 partial-bound UB-class: AtomicCell<T: Copy>, ThreadCell<T> Sync-unbounded, RacyCell<T> Sync-unbounded, Channel<T, B> with unbounded B trait).
  2. 468 `*mut Self` callback fn-sigs workspace-wide; 9 sections scored — most use the discipline correctly, but EXP-010 (bundler cluster), EXP-026 (timer signature), EXP-099 (IPC singleton), EXP-100 (UpgradedDuplex/SSLWrapper), EXP-101/102/103 (ProxyTunnel stale receiver wrappers), and EXP-104 (WindowsNamedPipe WRAPPER_BUSY receiver-protector gap) require remediation.
  3. 95 `from_field_ptr!` invocations enumerated; 4 risky shapes return `&mut Parent` directly (EXP-028, F-A-2 cluster of 4 in dispatch.rs, plus the bundler ParseTask/DeferredBatchTask sites); the rest return raw pointers (sound mode).

### Coverage gaps

- The `Cell::set` path-compression in `SymbolMap::follow()` (EXP-010 note line 378) crosses bucket-1 + bucket-7; not enumerated here because it requires call-graph proof of which `follow()` calls land in parallel codegen.
- `bun_brotli` `&mut *self.brotli` reborrow over caller-owned `*mut BrotliDecoder` (T notes line 51) — not enumerated as separate F-finding; depends on whether `&mut self` provenance suffices for the wrapped raw pointer.
- Remaining `WindowsNamedPipe` non-SSL callback edges beyond EXP-104's modeled `flush`/`receive_data` shapes (notably the streaming-writer `borrow = mut` adapter) still need source-side migration, but the SSLWrapper receiver-protector risk is no longer "unclear without runtime model" — EXP-104 confirms the core shape.
- The 165 Bucket-1 sites in Section B and 266 in Section A are sampled, not exhaustively enumerated by file:line in this run; the dominant pattern is the bucket-21 R-2 discipline already validated by Section F.
