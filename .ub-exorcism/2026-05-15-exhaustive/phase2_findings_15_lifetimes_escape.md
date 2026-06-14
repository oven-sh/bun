# Phase 2 Bucket 15: Lifetimes & Escape — findings

Static-bucket sweeper for Bucket 15 per UB-TAXONOMY §15:

1. raw pointers outliving their borrowed origin;
2. `&'static mut` returns over global state / thread-local scratch;
3. lifetime-laundering `transmute` (`<'_> → <'static>`, `<'_> → <'a>`,
   `<'bump> → 'static`);
4. closure captures of `&T` that return `*const T` (or smuggle the borrow
   past borrowck).

Source-tree-only (no Miri). Numbers are workspace-wide unless scoped.

---

## Cross-refs to existing EXP entries and unregistered placeholders

| ID | file:line | severity | one-line |
|---|---|---|---|
| **EXP-015** | `src/collections/array_hash_map.rs:1898-1905,2008-2014` | NO_EVIDENCE | `StringHashMap::{put_borrowed,get_or_put_borrowed}` cast `&[u8] → &'static [u8]` via `&*(key as *const [u8])`. `unsafe fn` SAFETY contract pushes "outlives the entry" onto callers; no soundness wrapper makes the discipline checkable. |
| **EXP-021** | `src/ast/nodes.rs:42-113,170-208,342-413` | CONFIRMED_UB | `StoreRef<T>`/`StoreStr`/`StoreSlice<T>` lifetime-erased AST store with **safe** constructors + **safe** caller-chosen-lifetime reborrow (`slice<'a>(self) -> &'a [T]`); experiments/EXP-021 Miri reproducer confirms dangling deref. Cross-bucket (4/5: type-pun + uninit). |
| **LIFETIME-TRANSMUTE-CLUSTER** | `src/css/css_parser.rs:2718,2723`; `src/bundler/transpiler.rs:308`; `src/resolver/lib.rs:4260`; `src/bun_alloc/lib.rs:560`; `src/bundler/LinkerContext.rs:2288`; `src/ini/lib.rs:1361` (F-A-6 cross-tag) | MIXED | 7-site `'_ → 'static` / `'_ → 'a` transmute cluster. 2026-05-16 source audit demotes the INI site to `CONTRACTUAL-BUT-DEFENSIBLE`; EXP-077 confirms the CSS result-type safe-API shape with Miri; `bun_alloc::Mutex` is EXP-059; `LinkerContext` is identity-shaped / defensible. The worker-widen sites (`Transpiler::for_worker`, `Resolver::for_worker`) are not confirmed UB: source shows deep-cloned owned fields plus deliberate worker teardown before arena reset, but they remain proof obligations because `optimize_imports` / `framework` / `standalone_module_graph` lifetimes are widened by contract rather than type. |
| **REQUESTCONTEXT-HELPERS** | `src/runtime/server/RequestContext.rs:266, 321-323` | CONTRACTUAL-BUT-DEFENSIBLE | `as_response(value) -> Option<&'static mut Response>` is already `unsafe fn` with an explicit sole-`&mut` + GC-root contract; `NativePromiseContext::take` is private-to-file, consumes/nulls the JS cell ref, and reviewed call sites immediately scope the returned context with `RequestContextRef`. This was once drafted as EXP-025, but follow-up audit demotes it to hardening/watchlist rather than a missing EXP. |
| **EXP-026** | `src/runtime/timer/mod.rs:897,1016`; `src/runtime/jsc_hooks.rs:152-157` | CONFIRMED_UB (TB model) | `timer::All::{get_timeout,drain_timers}` `&mut self` receiver held across `WTFTimer__fire` re-entry that mints fresh `&mut All`. Same family as the lifetime-escape return shape (`&mut` outlives the borrow point). |
| **EXP-027** | `src/runtime/node/dir_iterator.rs:44-67,499-522,895-899`; `src/bun_core/lib.rs:208-212` | CONFIRMED_UB | Windows `IteratorResultW.name.data: RawSlice<u16>` borrows iterator scratch (`name_data: [u16; 257]`); `RawSlice<T: Sync>` is `Send`, so the result outlives the iterator's `&mut self` borrow when the iterator is dropped. Reproducer at `experiments/EXP-027/src/main.rs`. |
| **EXP-079** | `src/bundler/transpiler.rs:262` | CONFIRMED_UB | `Transpiler::env_mut(&self) -> &'a mut Loader<'a>` is a safe method that mints a mutable borrow from a shared receiver. A `Transpiler<'static>` caller can call it twice and obtain two coexisting `&'static mut Loader` references; the Tree-Borrows witness at `experiments/EXP-079` confirms the write-through-disabled-tag failure. |
| **EXP-099** | `src/runtime/node/node_cluster_binding.rs:35-51,147-158`; `src/jsc/ipc.rs:140-159` | CONFIRMED_UB | `child_singleton<'a>() -> &'a mut InternalMsgHolder` returns a caller-chosen mutable borrow from a process static; `InternalMsgHolder::flush(&mut self)` then calls JS callbacks that the source comment says can re-enter via a fresh `&mut Self`. The EXP-099 Tree-Borrows witness mirrors this exact `RacyCell<Option<_>>` / `black_box(ptr::from_mut(self))` shape. |
| **EXP-100** | `src/runtime/socket/UpgradedDuplex.rs:27-44,101-146,202-216,304-390,587-599`; `src/uws_sys/lib.rs:191-201` | CONFIRMED_UB | `UpgradedDuplex` exports `&mut self` methods that borrow the `wrapper` field and call `SSLWrapper`; the handler table uses `ctx: *mut UpgradedDuplex`, so the callbacks materialize a fresh `&mut UpgradedDuplex` and `on_close` can write `self.wrapper = None` while the original receiver borrow is live. |
| **EXP-101** | `src/http/ProxyTunnel.rs:707-711`; callers `src/http/lib.rs:1347-1355`, `src/http/HTTPContext.rs:692-700` | CONFIRMED_UB | `ProxyTunnel::shutdown(&mut self)` leaves the whole-struct receiver protector live while `SSLWrapper::shutdown` runs callbacks. Those callbacks use raw disjoint-field accessors, but that is only sufficient on the raw-owner `close_raw` path, not while a whole-struct `&mut ProxyTunnel` exists. |
| **EXP-102** | `src/http/ProxyTunnel.rs:768-775`; callers `src/http/lib.rs:2876-2888`, `src/http/lib.rs:2913-2947` | CONFIRMED_UB | `ProxyTunnel::write(&mut self, buf)` leaves the whole-struct receiver protector live while `SSLWrapper::write_data` can run `write_encrypted` / close callbacks. The callbacks' disjoint raw-field writes are only sufficient on a raw-owner `write_raw` path. |
| **EXP-103** | `src/http/ProxyTunnel.rs:714-749,752-765`; callers `src/http/lib.rs:2754-2755`, `src/http/lib.rs:3254-3258` | CONFIRMED_UB | `ProxyTunnel::on_writable(&mut self)` and `receive(&mut self, ...)` capture a raw pointer first, then call `SSLWrapper::flush` / `receive_data`. That raw capture does not shorten the receiver lifetime; callbacks still re-enter while the whole-struct `&mut ProxyTunnel` argument is protected. |

---

## New findings (this phase)

| F-ID | file:line | severity | bucket cross-tags | sketch (≤10 lines) |
|---|---|---|---|---|
| **F-L-1** | `src/install/PackageManager.rs:701,719,1100`; `src/install/PackageInstaller.rs:398,412,419`; `src/install/NetworkTask.rs:175`; `src/install/isolated_install/Installer.rs:138`; `src/http/h3_client/PendingConnect.rs:50`; `src/http/HTTPThread.rs:45,287,387`; `src/sql_jsc/postgres/PostgresSQLConnection.rs:219,229`; `src/sql_jsc/mysql/JSMySQLQuery.rs:612`; `src/runtime/node/node_fs_watcher.rs:76`; `src/runtime/bake/DevServer/HmrSocket.rs:56`; `src/runtime/test_runner/Execution.rs:132`; `src/io/lib.rs:211` | LIKELY-UB-SHAPE-CLUSTER | 15 + 1 | **17-site `fn(&self) -> &'a mut T` / `&'static mut T` cluster** (the broad "static-widen-mut" pattern). Every site forms `&'a mut *raw_ptr` where `'a` is caller-chosen — borrowck-laundering shape. All cite "single-threaded JS/HTTP/install loop + heap-pinned target" as the load-bearing invariant. The lifetime parameter is unconstrained on both sides, so two interleaved calls mint coexisting `&mut T` to the same allocation without borrowck noticing. Unlike the now-demoted RequestContext helpers, these APIs expose caller-chosen lifetimes broadly enough that the canonical witness remains EXP-057. |
| **F-L-2** | `src/bun_core/output.rs:1075-1083,1086,1090,1095,1104,1108` | LIKELY-UB | 15 + 1 | `source_writer_escape() → &'static mut io::Writer` and its 5 public wrappers (`writer`, `writer_buffered`, `error_writer`, `error_writer_buffered`, `error_stream`). Returns `&'static mut` escaping the thread-local `RefCell<Source>` borrow. **In-source TODO(port) at line 1067-1070** explicitly admits "Returning `&'static mut` is *unsound* if two are alive at once". 5 callers across the runtime can hold two simultaneously (e.g. `crash_handler` writes one `error_stream()` while a panic hook holds another). |
| **F-L-3** | `src/http/lib.rs:733-755,881-899,973-977`; `src/http/HTTPThread.rs:77-81` | DEFENSIBLE-RUN-AS-IS | 15 + 8 | 7-site `&'static mut T` cluster over HTTP-thread `RacyCell` / `ThreadCell` statics (`http_thread()`, `request_headers()`, `response_headers()`, `single_packet_small_buffer()`, `temp_hostname()`, `abort_tracker()`, `custom_ssl_context_map()`). All gated on "HTTP-thread-only after on_start", with `ThreadCell` owner-asserts in debug. **Per-statement reborrow contract** is documented at the module level. Different verdict than F-L-2: the SAFETY argument actually holds (single-threaded by type), but the `&'static mut` shape itself is still UB the moment a caller stashes the reference past one statement — auditor-fragile, not currently a bug. |
| **F-L-4** | `src/paths/resolve_path.rs:33-37,393-405` | DEFENSIBLE | 15 + 1 | `tl_buf_mut::<N>(b: &UnsafeCell<[u8;N]>) -> &'static mut [u8;N]` and `lazy_path_buf(c: &Cell<*mut PathBuffer>) -> &'static mut PathBuffer`. Thread-local scratch buffers; **`'static` is the honest contract** (TL storage lives for the thread, and buffer is leaked via `Box::leak`). SAFETY argument: single-live-borrow-per-thread, documented at `thread_local!` site. Note: same shape as F-L-2/L-3 but with a stronger "thread-local owner ⇒ no other observer can exist" argument. Still UB on the second call from the same statement. |
| **F-L-5** | `src/runtime/shell/subproc.rs:253-263`; `src/uws_sys/vtable.rs:237-244`; `src/uws_sys/WebSocket.rs:248-255` | CONTRACTUAL-BUT-DEFENSIBLE | 15 + 13 | Three separate FFI-handle lifetime-widening APIs, now source-audited. `CmdHandle::cmd_mut` is an `unsafe fn` with a concrete safety contract and exactly three immediate call sites; each drops the borrow before slot recycle / re-entry. `Trampolines::ext(s)` returns `&'static mut H::Ext` but immediately passes it into one handler call; the uWS vtable subcase is covered by EXP-070's borrow-mode hardening. `AnyWebSocket::as_<T>()` is still TODO-marked and should be replaced with a callback-scoped/raw API, but actual WebSocket trampolines already use `as_ptr::<T>()`, not `as_::<T>()`, specifically to avoid a live `&mut T` across JS re-entry / `tcp.close()`. Keep as hardening, not an open UB claim. |
| **F-L-6 / EXP-087** | `src/bundler/ThreadPool.rs:414-428,629-652` | CONFIRMED_UB (safe-API shape) | 15 + 1 + 8 | `ThreadPool::get_worker(&self, …) -> &'static mut Worker` + `Worker::get(ctx) -> &'static mut Worker`. Prior text over-demoted this as "defensible by construction." The `Guarded` map protects lookup/mutation, but after the lock drops safe callers can call the method twice for the same `ThreadId` and hold two live `&mut Worker`s. EXP-087's Tree-Borrows witness confirms the exact duplicate-handle shape. Production callers may still be disciplined; the safe API contract is unsound. |
| **F-L-7** | `src/bundler/transpiler.rs:262`; `src/runtime/api/JSTranspiler.rs:787,1336,1527,1713,993` | CONFIRMED_UB (safe-API shape) | 15 + 1 | `Transpiler::env_mut(&self) -> &'a mut dot_env::Loader<'a>` is now EXP-079: safe callers can call it twice and obtain coexisting `&mut Loader`s to the same allocation. The adjacent `set_arena(detach_lifetime_ref(&arena))` sites are a separate per-call arena-lifetime contract: current `JSTranspiler` sites install a `TranspilerStateGuard` that restores the previous arena/log before local `Arena`/`Log` drop, so they remain proof obligations rather than part of the confirmed `env_mut` witness. |
| **F-L-8** | `src/ast/lib.rs:524,1586,3369`; `src/router/lib.rs:1456-1467`; `src/picohttp/lib.rs:342-351,561-571`; `src/md/types.rs:214-228`; `src/runtime/api/filesystem_router.rs:782` | DEFENSIBLE-PATTERN | 15 | 9-site `unsafe fn detach_lifetime(self) -> Self<'static>` cluster — explicit, `unsafe`-marked "widen borrowed fields field-by-field". This is the **good-citizen pattern**: SAFETY comment is at the function level naming the lifetime invariant, callers (e.g. `s3_simple_request:441`, `fetch/FetchTasklet:2063`, `MarkdownObject:804/1276`) write `unsafe { result.detach_lifetime() }` per use. Auditor-friendly. Listed for completeness; no defect, but the *call sites* that use the widened value still need to uphold the contract. |
| **F-L-9** | `src/bun_alloc/lib.rs:550-565` | LIKELY-UB-LATENT | 15 + 8 | `bun_alloc::Mutex::lock() → MutexGuard` transmutes a `std::sync::MutexGuard<'_, ()>` to `<'static, ()>`. SAFETY argument: every `bun_alloc::Mutex` lives in `'static` BSS, so the held `&Mutex` is `'static`-valid. **True for current callers**, but the type-level invariant is unenforced — any `bun_alloc::Mutex` constructed on the stack and locked through this path would yield a guard whose `'static` `&Mutex` outlives the stack frame ⇒ guaranteed UB on drop. The public const constructor `Mutex::new()` (`src/bun_alloc/lib.rs:546-548`) admits stack construction, so this hazard is reachable by API. |
| **F-L-10** | `src/dotenv/env_loader.rs:935`; `src/bun_alloc/lib.rs:2801,3224,2598`; `src/bun_alloc/heap_breakdown.rs:50,97` | DEFENSIBLE (anti-pattern: documented bans) | 15 | Multiple **`// PORTING.md §Forbidden: no Box::leak`** comments calling out the lifetime-escape anti-pattern they declined. Listed not as defects but as **best-practice witnesses** — these are sites that explicitly route through mimalloc / typed allocators to avoid the `Box::leak → &'static mut` shape that F-L-2 / F-L-5 use. The codebase has a documented `&'static`-allergy in `bun_alloc`/`dotenv` that is *not* uniformly applied at `bun_core/output.rs` (F-L-2). |
| **F-L-11** | `src/runtime/api/bun/subprocess/SubprocessPipeReader.rs:322`; `src/sys/windows/env.rs:72,92`; `src/runtime/api/bun/Terminal.rs:1847`; `src/runtime/node/node_fs.rs:2416,2458`; `src/jsc/PluginRunner.rs:160,177`; `src/bundler/HTMLScanner.rs:73` | CONTRACTUAL-BUT-DEFENSIBLE / HARDENING | 15 + 21 | 9-site direct `Box::leak(...).leak()`/`Vec::leak()` → `&'static [u8] / &'static mut [u8]` cluster. Source spot-check: SubprocessPipeReader/Terminal transfer buffers to `MarkedArrayBuffer::from_bytes`; `node_fs` reconstructs/frees the leaked path bytes in worker cleanup; `sys/windows/env` intentionally installs process-global env storage; PluginRunner/HTMLScanner use build-lifetime path storage. This is fragile glue and should be linted into `heap::release` / typed ownership helpers, but it is **not** a current UB finding without a mismatched foreign-owner proof. |
| **F-L-12** | `src/runtime/cli/open.rs:379` | LIKELY-UB | 15 + 2 | Single-site `move \|\| auto_close(spawned_addr as *mut SpawnedEditorContext)` — closure captures a `usize` address (Bucket-2 strict-prov fail) and reconstructs `*mut`. The **only hit for "closure laundering"** in the workspace (rg `move \|.*\| .*as \*const\|*mut`). Spawned editor PID monitor; integer-as-pointer round-trip across a thread boundary. Cross-tags Bucket 2 (`spawned_addr` is `usize`-typed). Concretely strict-provenance UB; classify as the lone closure-capture-via-int Bucket-15 §4 site. |
| **F-L-13 / EXP-099** | `src/runtime/node/node_cluster_binding.rs:45-51`; `src/jsc/ipc.rs:140-159` | CONFIRMED_UB | 15 + 1 + 21 | `child_singleton<'a>() -> &'a mut InternalMsgHolder` is the no-receiver variant of the caller-chosen-`&mut` family. It would already be auditor-fragile as a two-call safe API, but the stronger production-shaped hazard is `on_internal_message_child()` calling `singleton.flush(global)?`: `flush(&mut self)` explicitly runs JS callbacks that may re-enter the same singleton while the receiver's protected unique borrow remains live. |
| **F-L-14 / EXP-100** | `src/runtime/socket/UpgradedDuplex.rs:202-216,304-390,587-599`; `src/uws_sys/lib.rs:191-201` | CONFIRMED_UB | 15 + 1 + 21 | `UpgradedDuplex` has callback-facing `&mut self` receivers that call into `SSLWrapper` while a wrapper-field borrow is live. The synchronous SSLWrapper callback re-enters from `ctx: *mut UpgradedDuplex`, materializes `&mut UpgradedDuplex`, and may tear down the wrapper. This is a receiver-lifetime/protector escape rather than a mere FFI contract nit. |
| **F-L-15 / EXP-101** | `src/http/ProxyTunnel.rs:707-711`; callers `src/http/lib.rs:1347-1355`, `src/http/HTTPContext.rs:692-700` | CONFIRMED_UB | 15 + 1 + 21 | `ProxyTunnel::shutdown(&mut self)` is the same receiver-lifetime/protector escape in a file that otherwise contains the correct raw-owner fix model. The callback writes only through raw field projections, yet Tree-Borrows still rejects them because the original whole-struct receiver borrow remains live for the method call. |
| **F-L-16 / EXP-102** | `src/http/ProxyTunnel.rs:768-775`; callers `src/http/lib.rs:2876-2888`, `src/http/lib.rs:2913-2947` | CONFIRMED_UB | 15 + 1 + 21 | `ProxyTunnel::write(&mut self, buf)` is the live request-body sibling of EXP-101. `SSLWrapper::write_data` can synchronously re-enter ProxyTunnel callbacks while the old whole-struct receiver lifetime is still protected. |
| **F-L-17 / EXP-103** | `src/http/ProxyTunnel.rs:714-749,752-765`; callers `src/http/lib.rs:2754-2755`, `src/http/lib.rs:3254-3258` | CONFIRMED_UB | 15 + 1 + 21 | `ProxyTunnel::on_writable(&mut self)` and `receive(&mut self, ...)` are the remaining live receiver-lifetime escapes in the same file. The code captures `NonNull<Self>` before the SSLWrapper call, but the `&mut self` argument lifetime still spans the call frame, so Tree-Borrows rejects callback writes through the raw pointer. |

---

## Enumerations

### A. `&'static mut T` returns workspace-wide

`rg "&'static mut" --type rust src/` → **180 grep hits**, **117 distinct call-site
return-signatures** after deduping doc comments / port-notes / unrelated uses
(e.g. `Box::leak` annotations at use sites).

Stratified by *receiver shape* and *owner type*:

| receiver | owner | typical site | safety_status | F-ID |
|---|---|---|---|---|
| `(&self)` | `ThreadPool::workers_assignments` map of heap-pinned `Worker`s | `src/bundler/ThreadPool.rs:414` | CONFIRMED_UB safe-API shape: lock does not guard returned reference lifetime | F-L-6 / EXP-087 |
| `(&self)` | `RefCell<Source>` thread-local field | `src/bun_core/output.rs:1086,1090,1095,1104,1108` (5 sites) | LIKELY-UB (TODO acknowledges) | F-L-2 |
| `(&self)` | `BackRef`-shaped heap pointer field | `src/install/PackageManager.rs:701,719,1100`; `PackageInstaller.rs:398,412,419`; `NetworkTask.rs:175`; `isolated_install/Installer.rs:138`; `HTTPThread.rs:45,287,387`; `sql_jsc/{postgres,mysql}/*.rs` (6 sites); `node_fs_watcher.rs:76`; `bake/DevServer/HmrSocket.rs:56`; `io/lib.rs:211` (17 sites) | LIKELY-UB-SHAPE | F-L-1 |
| no receiver | thread-local `UnsafeCell<[u8;N]>` / `Box::leak`'d `PathBuffer` | `src/paths/resolve_path.rs:33,393` (2 sites) | DEFENSIBLE | F-L-4 |
| no receiver | `ThreadCell<MaybeUninit<HTTPThread>>` / `RacyCell` after on-start | `src/http/lib.rs:733,753,881,886,891,896,973`; `HTTPThread.rs:77` (8 sites) | DEFENSIBLE-AUDITOR-FRAGILE | F-L-3 |
| no receiver | `RacyCell<Option<InternalMsgHolder>>` plus JS-callback re-entry during `flush(&mut self)` | `src/runtime/node/node_cluster_binding.rs:45`; `src/jsc/ipc.rs:140` | CONFIRMED_UB | F-L-13 / EXP-099 |
| `(self)` after FFI handle assume_mut | `Interpreter`/`us_socket_t.ext`/`uws_ws_get_user_data` | `src/runtime/shell/subproc.rs:262`; `src/uws_sys/vtable.rs:237`; `src/uws_sys/WebSocket.rs:248` (3 sites) | CONTRACTUAL-BUT-DEFENSIBLE / hardening (WebSocket `as_` TODO remains, but live trampolines use raw `as_ptr`) | F-L-5 |
| `(value: JSValue)` | JSC `Response` cell pointer | `src/runtime/server/RequestContext.rs:321` (1 site) | CONTRACTUAL-BUT-DEFENSIBLE | `unsafe fn` boundary already carries the contract; reviewed call sites document sole `&mut Response` + rooting |
| `(len: usize)` | freshly-created `WTFStringImpl` buffer | `src/bun_core/string/mod.rs:380,396` (2 sites) | DEFENSIBLE (`&mut` tied to fresh impl) | none |
| `Box::leak(...)` direct return | foreign owner (JSC `ExternalStringImpl`, WTF Adopt, Box hand-off to FFI) | scattered (`Box::leak` ~25 sites + `Vec::leak` ~9 sites) | CONTRACTUAL-BUT-DEFENSIBLE / hardening (some bare, some via `heap::release`) | F-L-10 / F-L-11 |
| `Option<&'static mut T>` from FFI `as_mut()` | foreign-allocated `BrotliDecoder` / `BrotliEncoder` | `src/brotli_sys/brotli_c.rs:111,435` (2 sites) | DEFENSIBLE (one-shot constructor return) | none |
| `pub fn vm()` style on JS-thread singleton | `VirtualMachine` / `EventLoop` singleton via process-static `ThreadCell` | counted in F-L-1 row above | DEFENSIBLE if single-thread is by-type | F-L-1 |
| `pub fn instance() -> &'static mut FileSystem` | process-singleton `ThreadCell<MaybeUninit<FileSystem>>` | `src/resolver/lib.rs:271` | DEFENSIBLE-AUDITOR-FRAGILE | F-L-3-class |

**Totals.**
- **180 grep occurrences** (~50 are SAFETY comments / port notes, not signatures).
- **~117 distinct return-site signatures** (deduped).
- **~38 are genuine ambient-singleton `&'static mut`** (process- / thread-singletons whose `'static` matches actual lifetime).
- **~22 are caller-chosen-`'a mut` from `&self`** (F-L-1 cluster — borrowck-laundering shape).
- **~7 are FFI-constructor hand-offs** (`Option<&'static mut T>` from `as_mut()` on a fresh allocator-returned pointer).
- **F-L-2 remains the active TODO-admitted `&'static mut` unsoundness**; F-L-5's WebSocket helper has a TODO-marked placeholder API, but live trampolines use the raw-pointer path, so the cluster is now hardening-only after caller audit. The former RequestContext helper placeholder is also hardening-only after caller audit.

### B. `transmute` lifetime-rebind sites

`rg 'transmute::<.*<\x27_>.*<\x27(static|a)>'` + `rg 'transmute::<.*\x27_.*\x27static'` etc.
→ **4 lifetime-rebind transmute sites** across 4 files (part of the unregistered
lifetime-transmute cluster once cross-bucket sites are added):

| file:line | shape | safety_status | covered_by |
|---|---|---|---|
| `src/css/css_parser.rs:2718` | `CssModuleExports<'_> → CssModuleExports<'static>` | CONFIRMED_UB (safe-API shape) | EXP-077; current reviewed in-tree callers only read `result.code` |
| `src/css/css_parser.rs:2723` | `CssModuleReferences<'_> → CssModuleReferences<'static>` | CONFIRMED_UB (safe-API shape) | EXP-077; current reviewed in-tree callers only read `result.code` |
| `src/bundler/transpiler.rs:308` | `BundleOptions<'_> → BundleOptions<'a>` (caller-chosen) | CONTRACTUAL-PROOF-OBLIGATION | source audit: owned fields deep-cloned; `optimize_imports` / `framework` are copied borrows and must outlive worker `Transpiler`; `BundleV2::deinit_without_freeing_arena` tears workers down before arena reset, but a production-shaped lifetime test is still owed |
| `src/bun_alloc/lib.rs:560` | `MutexGuard<'_,()> → MutexGuard<'static,()>` | LIKELY-UB-LATENT | lifetime-transmute cluster (4/7) + **F-L-9 / EXP-059** |
| `src/bundler/LinkerContext.rs:2288` | `Renamer<'_, '_> → Renamer<'_, '_>` (rebind, identity-shaped) | DEFENSIBLE | lifetime-transmute cluster (5/7) |
| `src/resolver/lib.rs:4260` | `Option<&'_ dyn StandaloneModuleGraph> → Option<&'a dyn …>` | CONTRACTUAL-PROOF-OBLIGATION | source audit: VM stores `Option<&'static dyn StandaloneModuleGraph>` and resolver worker clone carries that same trait object; no dangling path found, but the transmute remains a type-system escape hatch |
| `src/ini/lib.rs:1361` | `*mut DotEnvLoader<'_> → *mut DotEnvLoader<'static>` (pointer-cast variant) | CONTRACTUAL-BUT-DEFENSIBLE | lifetime-transmute cluster (7/7) — cross-tag F-A-6. Parser/env lifetime erasure is ugly but source-audited: parser drops before return, `DotEnvLoader::get()` lends owned map bytes only, and surviving npmrc config/registry/matcher values are boxed or owned. |

**The 7-site lifetime-transmute cluster is verified as an inventory.** The CSS
pair is now registered as EXP-077 and Miri-confirms the dangling-reference
safe-API shape. The `bundler/LinkerContext.rs:2288`
Renamer cast is identity-shaped (`'_, '_` on both sides — only the lifetime
variables are rebound, not widened); the SAFETY comment correctly flags
"invariant-position `'src`" as the load-bearing constraint.

### C. `bun_ptr::detach_lifetime*` sites (alternative lifetime-launder API)

`rg 'detach_lifetime' --type rust src/` → **168 occurrences** across **~110
distinct call sites** (some sites use multiple variants):

| variant | sites | typical owner | F-ID |
|---|---:|---|---|
| `detach_lifetime(s: &[T]) -> &'a [T]` | ~70 | parsed source text, lockfile string buffers, arena-allocated slices | F-L-7 + F-L-8 callers |
| `detach_lifetime_ref(r: &T) -> &'a T` | ~30 | `&Bump`/`&Arena` (worker arenas, JSTranspiler, css_internals, bake DevServer) | F-L-7 |
| `detach_lifetime_mut(r: &mut T) -> &'a mut T` | ~8 | callback-entered FFI handles (`shell/subproc:262`, `bundle_v2:2349,2969,4623,6398`, `http/Decompressor:52`) | F-L-5 + bundler-side (covered by Bucket 1 EXP-030) |
| `RawSlice<T>::new(&[T]).slice()` | many (~50 use-sites) | self-referential AST struct fields | EXP-021 + F-L-8 callers + EXP-027 |
| `Cow::Borrowed(detach_lifetime(file_path))` | 2 | `watcher::Watcher` callbacks holding paths across `&mut self` reborrows | DEFENSIBLE (single-callback frame) |

**Centralisation status.** `bun_ptr::detach_lifetime*` collapses ~110 sites into
3 audited `unsafe fn`s — best-in-codebase containment of the launder primitive.
The remaining unsoundness is at **call sites**, where the per-site SAFETY
invariant is upheld implicitly by "the arena outlives the worker" / "the
backing FFI handle outlives the callback" arguments that are not
machine-checkable.

### D. `'bump → 'static` arena-lifetime laundering (bundler / css)

The bundler stores `BundledAst<'static>` and runs CSS through a
`bumpalo::Bump`-allocated AST whose `'bump` lifetime is uniformly erased to
`'static` at the boundary. Hits:

- `src/bundler/ParseTask.rs:26` — `BundledAst<'arena>` PORT NOTE
- `src/bundler/ungate_support.rs:64` — `'bump` already laundered to `'static`
- `src/css/css_parser.rs:2310,2712,2793,3052,3174` — `'static` placeholder for
  not-yet-threaded `'bump`
- `src/css/values/{syntax.rs:305,428, ident.rs:410, easing.rs:100}` — same
- `src/css/error.rs:198`, `src/css/rules/mod.rs:250-260` — `DeclarationBlock<'static>`
  is the crate-wide `'bump`-erasure
- `src/css/declaration.rs:253`; `src/css/css_parser.rs:1115,1574,2269` — call sites

**Cross-tag with F-L-7 / the lifetime-transmute cluster.** This is the systemic `'bump → 'static`
contract: the bundler-side `'static` is a placeholder for the not-yet-threaded
`'bump` lifetime parameter. Soundness depends on every `'static`-typed `Bump`
value being dropped before the arena resets. Workspace-wide grep shows ~25
sites; none are currently flagged as UB but the entire family is **structurally
fragile** — any caller that stashes a `DeclarationBlock<'static>` past arena
reset triggers UAF.

### E. Closure-captured `&T → *const T` (Bucket 15 §4)

`rg 'move \|.*\| .*(as \*const|as \*mut|from_ref|as_ptr)' --type rust src/`
→ **1 hit**: `src/runtime/cli/open.rs:379` (F-L-12).

The codebase deliberately routes thread-spawned closures through `*mut`
captures (e.g. via `usize`-as-pointer for cross-thread), not `&T → *const T`
laundering. The single hit goes through a `usize` (Bucket 2 strict-provenance
also-failing), not a direct `&T` capture — so the **Bucket-15 §4 surface is
effectively empty**, with the one hit being a cross-bucket
strict-provenance issue already in F-L-12.

---

## Summary

- **180 grep hits** for `&'static mut T`; **~117 distinct return-site
  signatures**; **~22 are F-L-1-shaped caller-chosen-`'a mut` from `&self`**
  (lifetime-launder cluster). **F-L-2 is the remaining active TODO-admitted
  `&'static mut` unsoundness**; F-L-5 and the former RequestContext helper are
  hardening-only after source/caller audit.
- **4 active `transmute` lifetime-rebind sites** in src/ (the 7-site lifetime-transmute
  cluster after counting the pointer-cast variant `ini:1361` and
  `BundleOptions:308` per-instantiation transmute pair). The CSS pair is now
  EXP-077 / CONFIRMED_UB as a safe-API shape; `Transpiler::env_mut` is now
  EXP-079 / CONFIRMED_UB as a safe-API shape; INI is demoted; worker-widen
  sites remain contractual proof obligations rather than counted live UB.
- **168 `bun_ptr::detach_lifetime*` occurrences** (~110 distinct call sites) —
  the largest single-primitive lifetime-launder surface in the codebase, but
  centralised through 3 audited `unsafe fn`s.
- **1 closure-captured raw-ptr-from-borrow site** (F-L-12; also Bucket 2 hit).

**Top 3 new finds.**

1. **F-L-1 — 17-site `fn(&self) -> &'a mut T` caller-chosen-`'a` cluster.** The
   single largest lifetime-launder surface that is *not* covered by any prior
   EXP. Spans install/, http/, sql_jsc/, runtime/node/, runtime/bake/,
   runtime/test_runner/. Every site forms `&'a mut *self.field_raw_ptr` where
   `'a` is unconstrained. Two interleaved calls on `&self` mint coexisting
   `&mut T` without borrowck noticing. Cross-tagged Bucket 1
   (aliasing) — file as a single F-L-1 cluster experiment.
2. **F-L-2 — `bun_core::output::source_writer_escape` and its 5 wrappers.**
   In-source TODO(port) admits "Returning `&'static mut` is *unsound* if two
   are alive at once". 5 distinct callers — crash handler, panic hook, pretty
   logging — can call any pair simultaneously. Convertible to a soundness
   experiment by calling `error_writer()` and `writer()` in the same expression
   and observing LLVM dead-store under TSAN.
3. **F-L-9 — `bun_alloc::Mutex::lock()` `'_ → 'static` MutexGuard transmute.**
   Soundness argument *currently* holds (all `bun_alloc::Mutex` instances live
   in BSS), but `Mutex::new()` is a `pub const fn` and accepts stack construction; the
   `MutexGuard<'static>` would then dangle on drop. Latent API hazard with a
   one-line "make `Mutex::new()` `unsafe` or `pub(crate)`" fix.

**Centralisation status.** Bun's lifetime-launder surface is *unusually
disciplined* — the `bun_ptr::detach_lifetime*` triad and the `unsafe fn
detach_lifetime(self) -> Self<'static>` per-type pattern (F-L-8) are
best-in-class containment. The Bucket-15 audit's remaining defects are mostly
in **per-site SAFETY contracts that depend on runtime invariants** (single
JS thread, arena-outlives-worker, callback frame outlives derived borrow) —
not the launder primitives themselves.
