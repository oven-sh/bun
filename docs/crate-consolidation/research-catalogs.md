

---

## extern_rust

I now have everything needed to produce the full catalog.

# Catalog of `extern "Rust"` cross-crate link-time symbols in `/workspace/bun/src/**/*.rs`

Each row: **declarer** (low-tier crate holding `unsafe extern "Rust" { … }`) → **definer** (high-tier crate holding the `#[no_mangle]` body) → **cycle broken** (why the declarer cannot just `use` the definer, per the dep graph supplied).

---

## A. Raw `extern "Rust"` declarations (hand-written, one symbol at a time)

### A1. Crash handler / OOM (tier-0 → tier-1 back-edge)

| Symbol | Declarer (crate / file:line) | Definer (crate / file:line) | Cycle broken |
|---|---|---|---|
| `__bun_crash_handler_out_of_memory` | `bun_alloc` / `src/bun_alloc/lib.rs:903` | `bun_crash_handler` / `src/crash_handler/lib.rs:53` (test shim: `bun_parsers` / `src/parsers/native_test_shims.rs:12`) | `bun_crash_handler → … → bun_alloc`; `bun_alloc` is T0 and may not depend upward. |
| `__bun_crash_handler_dump_stack_trace` | `bun_core` / `src/bun_core/Global.rs:202` | `bun_crash_handler` / `src/crash_handler/lib.rs:61` | `bun_crash_handler → bun_core`; reverse edge would be a cycle. |

### A2. Regex (install-types → JSC)

| Symbol | Declarer | Definer | Cycle broken |
|---|---|---|---|
| `__bun_regex_compile` | `bun_install_types` / `src/install_types/NodeLinker.rs:90` | `bun_jsc` / `src/jsc/RegularExpression.rs:106` | `bun_jsc → … → bun_install_types`; `install_types` (T3) cannot name JSC Yarr FFI. |
| `__bun_regex_matches` | `bun_install_types` / `src/install_types/NodeLinker.rs:91` | `bun_jsc` / `src/jsc/RegularExpression.rs:116` | same |
| `__bun_regex_drop` | `bun_install_types` / `src/install_types/NodeLinker.rs:92` | `bun_jsc` / `src/jsc/RegularExpression.rs:124` | same |

### A3. Resolver ↔ Package-manager

| Symbol | Declarer | Definer | Cycle broken |
|---|---|---|---|
| `__bun_resolver_init_package_manager` | `bun_resolver` / `src/resolver/resolver.rs:41` | `bun_install` / `src/install/auto_installer.rs:457` | `bun_install → bun_resolver`; resolver cannot name `PackageManager`. |

### A4. DNS prefetch

| Symbol | Declarer | Definer | Cycle broken |
|---|---|---|---|
| `__bun_dns_prefetch` | `bun_dns` / `src/dns/lib.rs:499` | `bun_runtime` / `src/runtime/dns_jsc/dns.rs:3167` | `bun_runtime → … → bun_dns`; caller is `bun_install` which must not pull JSC/uws via `bun_runtime`. |

### A5. JS-parser macros (parser → parser_jsc)

| Symbol | Declarer | Definer | Cycle broken |
|---|---|---|---|
| `__bun_macro_context_init` | `bun_js_parser` / `src/js_parser/lib.rs:109` | `bun_js_parser_jsc` / `src/js_parser_jsc/Macro.rs:260` | `bun_js_parser_jsc → bun_js_parser` (and `Transpiler`/`Resolver`/JSC types live above parser). |
| `__bun_macro_context_deinit` | `bun_js_parser` / `src/js_parser/lib.rs:113` | `bun_js_parser_jsc` / `src/js_parser_jsc/Macro.rs:282` | same |
| `__bun_macro_context_call` | `bun_js_parser` / `src/js_parser/lib.rs:118` | `bun_js_parser_jsc` / `src/js_parser_jsc/Macro.rs:305` | same |
| `__bun_macro_context_get_remap` | `bun_js_parser` / `src/js_parser/lib.rs:132` | `bun_js_parser_jsc` / `src/js_parser_jsc/Macro.rs:353` | same |
| `__bun_macro_collect_vm_garbage` | `bun_js_parser` / `src/js_parser/lib.rs:139` | `bun_js_parser_jsc` / `src/js_parser_jsc/Macro.rs:300` | same (called from `bun_bundler::ThreadPool::Worker::deinit`; `bundler` has no `bun_jsc` dep). |

### A6. Bundler → JSC

| Symbol | Declarer | Definer | Cycle broken |
|---|---|---|---|
| `__bun_jsc_generate_cached_bytecode` | `bun_bundler` / `src/bundler/bundle_v2.rs:1410` | `bun_jsc` / `src/jsc/CachedBytecode.rs:144` | `bun_jsc → bun_bundler`; bundler cannot name JSC bytecode types. |
| `__bun_jsc_enable_hot_module_reloading_for_bundler` | `bun_bundler` / `src/bundler/bundle_v2.rs:1427` | `bun_jsc` / `src/jsc/hot_reloader.rs:1418` | `bun_jsc → bun_bundler`; bundler cannot name `NewHotReloader<…>`. |

### A7. `bun_io` → runtime dispatch (hot I/O-poll path)

| Symbol | Declarer | Definer | Cycle broken |
|---|---|---|---|
| `__bun_get_vm_ctx` | `bun_io` / `src/io/posix_event_loop.rs:94` | `bun_runtime` / `src/runtime/jsc_hooks.rs:5278` | `bun_runtime → … → bun_io`; io cannot name `jsc::VirtualMachine` / `MiniEventLoop`. |
| `__bun_run_file_poll` | `bun_io` / `src/io/posix_event_loop.rs:281` | `bun_runtime` / `src/runtime/dispatch.rs:639` | same; the `PollTag` → owner `match` names ~dozen `bun_runtime` types. |
| `__bun_io_pollable_on_ready` | `bun_io` / `src/io/lib.rs:1404` | `bun_runtime` / `src/runtime/dispatch.rs:778` | `ReadFile`/`WriteFile` containers live in `bun_runtime::webcore::blob`. |
| `__bun_io_pollable_on_io_error` | `bun_io` / `src/io/lib.rs:1405` | `bun_runtime` / `src/runtime/dispatch.rs:803` | same |

### A8. `bun_event_loop` → `bun_jsc` (JS-arm of `AnyEventLoop`/`SpawnSync`)

| Symbol | Declarer | Definer | Cycle broken |
|---|---|---|---|
| `__bun_js_event_loop_current` | `bun_event_loop` / `src/event_loop/AnyEventLoop.rs:30` | `bun_jsc` / `src/jsc/event_loop.rs:1383` | `bun_jsc → bun_event_loop`; low tier cannot name `jsc::EventLoop`. |
| `__bun_spawn_sync_create_event_loop` | `bun_event_loop` / `src/event_loop/SpawnSyncEventLoop.rs:50` | `bun_jsc` / `src/jsc/event_loop.rs:1411` | same |
| `__bun_spawn_sync_destroy_event_loop` | `bun_event_loop` / `src/event_loop/SpawnSyncEventLoop.rs:51` | `bun_jsc` / `src/jsc/event_loop.rs:1428` | same |
| `__bun_spawn_sync_event_loop_set_vm` | `bun_event_loop` / `src/event_loop/SpawnSyncEventLoop.rs:53` | `bun_jsc` / `src/jsc/event_loop.rs:1435` | same |
| `__bun_spawn_sync_event_loop_tick_tasks_only` | `bun_event_loop` / `src/event_loop/SpawnSyncEventLoop.rs:54` | `bun_jsc` / `src/jsc/event_loop.rs:1443` | same |
| `__bun_spawn_sync_vm_get_event_loop_handle` | `bun_event_loop` / `src/event_loop/SpawnSyncEventLoop.rs:55` | `bun_jsc` / `src/jsc/event_loop.rs:1448` | same |
| `__bun_spawn_sync_vm_set_event_loop_handle` | `bun_event_loop` / `src/event_loop/SpawnSyncEventLoop.rs:56` | `bun_jsc` / `src/jsc/event_loop.rs:1455` | same |
| `__bun_spawn_sync_vm_set_event_loop` | `bun_event_loop` / `src/event_loop/SpawnSyncEventLoop.rs:58` | `bun_jsc` / `src/jsc/event_loop.rs:1463` | same |
| `__bun_spawn_sync_vm_swap_suppress_microtask_drain` | `bun_event_loop` / `src/event_loop/SpawnSyncEventLoop.rs:60` | `bun_jsc` / `src/jsc/event_loop.rs:1470` | same |

### A9. `bun_event_loop` → `bun_runtime` (timers, stdio, VM handle)

| Symbol | Declarer | Definer | Cycle broken |
|---|---|---|---|
| `__bun_fire_timer` | `bun_event_loop` / `src/event_loop/EventLoopTimer.rs:39` | `bun_runtime` / `src/runtime/dispatch.rs:914` | tag→`container_of` match names ~20 `bun_runtime` timer container types. |
| `__bun_js_timer_epoch` | `bun_event_loop` / `src/event_loop/EventLoopTimer.rs:47` | `bun_runtime` / `src/runtime/dispatch.rs:1118` | same |
| `__bun_stdio_blob_store_new` | `bun_event_loop` / `src/event_loop/MiniEventLoop.rs:53` | `bun_runtime` / `src/runtime/jsc_hooks.rs:5344` | `bun_runtime → … → bun_event_loop`; `webcore::blob::Store` is a runtime type. |
| `__bun_js_vm_get` | `bun_event_loop` / `src/event_loop/MiniEventLoop.rs:58` | `bun_runtime` / `src/runtime/jsc_hooks.rs:5334` | cannot name `jsc::VirtualMachine`. |

### A10. `bun_jsc` → `bun_runtime` (event-loop task dispatch, hooks tables, Blob, stdio-deinit)

| Symbol | Declarer | Definer | Cycle broken |
|---|---|---|---|
| `__bun_tick_queue_with_count` | `bun_jsc` / `src/jsc/event_loop.rs:179` | `bun_runtime` / `src/runtime/dispatch.rs:1137` | `bun_runtime → bun_jsc`; the per-task `match` names every `bun_runtime` task type. |
| `__bun_run_immediate_task` | `bun_jsc` / `src/jsc/event_loop.rs:187` | `bun_runtime` / `src/runtime/dispatch.rs:841` | `ImmediateObject` is a `bun_runtime::timer` type. |
| `__bun_cancel_pending_immediate` | `bun_jsc` / `src/jsc/event_loop.rs:190` | `bun_runtime` / `src/runtime/dispatch.rs:864` | same |
| `__bun_run_wtf_timer` | `bun_jsc` / `src/jsc/event_loop.rs:193` | `bun_runtime` / `src/runtime/dispatch.rs:885` | `WTFTimer` is a `bun_runtime::timer` type. |
| `__bun_release_task_at_shutdown` | `bun_jsc` / `src/jsc/event_loop.rs:202` | `bun_runtime` / `src/runtime/dispatch.rs:1159` | tag match names `bun_runtime` task types. |
| `__BUN_RUNTIME_HOOKS` (static) | `bun_jsc` / `src/jsc/VirtualMachine.rs:1938` | `bun_runtime` / `src/runtime/jsc_hooks.rs:1460` | `bun_runtime → bun_jsc`; hooks call into `server`/`webcore`/`timer`/`node`/… bodies. |
| `__BUN_LOADER_HOOKS` (static) | `bun_jsc` / `src/jsc/ModuleLoader.rs:277` | `bun_runtime` / `src/runtime/jsc_hooks.rs:5256` | same — `transpile_source_code` etc. live in `bun_runtime`. |
| `__bun_blob_from_build_artifact` | `bun_jsc` / `src/jsc/webcore_types.rs:190` | `bun_runtime` / `src/runtime/api/JSBundler.rs:1884` | `BuildArtifact` struct lives in `bun_runtime`; `Blob::from_js` needs a fallback that downcasts to it. |
| `__bun_stdio_blob_store_deinit` | `bun_jsc` / `src/jsc/rare_data.rs:890` | `bun_runtime` / `src/runtime/jsc_hooks.rs:5368` | `webcore::blob::Store` is a `bun_runtime` type. |

### A11. `bun_sql_jsc` → `bun_runtime`

| Symbol | Declarer | Definer | Cycle broken |
|---|---|---|---|
| `__BUN_SQL_RUNTIME_HOOKS` (static) | `bun_sql_jsc` / `src/sql_jsc/jsc.rs:250` | `bun_runtime` / `src/runtime/hw_exports.rs:269` | `bun_runtime → bun_sql_jsc`; hooks reach `RuntimeState.sql_rare`, `Timer::All`, `SslCtxCache`, `webcore::Blob`. |

**Subtotal, Section A: 36 hand-written `extern "Rust"` symbols** (33 fns + 3 statics), across **14 extern blocks** (`src/bun_alloc/lib.rs:899`, `src/bun_core/Global.rs:198`, `src/install_types/NodeLinker.rs:87`, `src/resolver/resolver.rs:34`, `src/dns/lib.rs:492`, `src/js_parser/lib.rs:102`, `src/bundler/bundle_v2.rs:1403` + `:1417`, `src/io/posix_event_loop.rs:89` + `:280`, `src/io/lib.rs:1397`, `src/event_loop/AnyEventLoop.rs:26`, `src/event_loop/SpawnSyncEventLoop.rs:47`, `src/event_loop/EventLoopTimer.rs:31`, `src/event_loop/MiniEventLoop.rs:47`, `src/jsc/event_loop.rs:176`, `src/jsc/VirtualMachine.rs:1932`, `src/jsc/ModuleLoader.rs:271`, `src/jsc/webcore_types.rs:189`, `src/jsc/rare_data.rs:889`, `src/sql_jsc/jsc.rs:245`).

---

## B. `bun_dispatch::link_interface!` invocations (macro-generated `extern "Rust"` closed-set dispatch)

Each interface emits `variants × methods` `extern "Rust"` symbols (`__bun_dispatch__<Iface>__<Variant>__<method>`); definers call `link_impl_<Iface>!`.

| Interface | Declarer (crate / file:line) | Variants → Definers (crate / file:line via `link_impl_*!`) | Cycle broken |
|---|---|---|---|
| `OutputSink[Sys]` | `bun_core` / `src/bun_core/lib.rs:584` | `Sys` → `bun_sys` / `src/sys/lib.rs:9680` | `bun_sys → bun_core`; `bun_core` (T0) cannot name `bun_sys` I/O primitives (`File`, `openat`, `isatty`). |
| `ErrnoNames[Sys]` | `bun_core` / `src/bun_core/lib.rs:610` | `Sys` → `bun_errno` / `src/errno/lib.rs:408` | `bun_errno → bun_core`; gives `bun_core::result` access to per-OS `SystemErrno` strum table without duplicating it. |
| `EventLoopCtx[Js, Mini]` | `bun_io` / `src/io/lib.rs:119` | `Js` → `bun_jsc` / `src/jsc/VirtualMachine.rs:1845`; `Mini` → `bun_event_loop` / `src/event_loop/MiniEventLoop.rs:510` | `bun_jsc → … → bun_io` and `bun_event_loop → bun_io`; `FilePoll`/`KeepAlive` must reach the platform uws loop + poll store without naming `VirtualMachine`/`MiniEventLoop`. |
| `BufferedReaderParentLink[13 variants]` | `bun_io` / `src/io/lib.rs:325` | `bun_runtime` (11 variants): `SubprocessPipeReader` `src/runtime/api/bun/subprocess/SubprocessPipeReader.rs:409`, `ShellPipeReader` `src/runtime/shell/subproc.rs:2447`, `ShellIoReader` `src/runtime/shell/IOReader.rs:383`, `FileReader` `src/runtime/webcore/FileReader.rs:282`, `FileResponseStream` `src/runtime/server/FileResponseStream.rs:534`, `Terminal` `src/runtime/api/bun/Terminal.rs:1939`, `CronRegister` `src/runtime/api/cron.rs:179`, `CronRemove` `src/runtime/api/cron.rs:980`, `FilterRunHandle` `src/runtime/cli/filter_run.rs:242`, `MultiRunPipeReader` `src/runtime/cli/multi_run.rs:78`, `TestParallelWorkerPipe` `src/runtime/cli/test/parallel/Worker.rs:496`; `bun_install` (2 variants): `LifecycleScript` `src/install/lifecycle_script_runner.rs:1237`, `SecurityScan` `src/install/PackageManager/security_scanner.rs:1002` | `bun_runtime → … → bun_io` and `bun_install → … → bun_io`; parent types (`Subprocess`, `FileReader`, `ShellPipeReader`, `LifecycleScriptSubprocess`, …) live in higher tiers. |
| `JsEventLoop[Jsc]` | `bun_event_loop` / `src/event_loop/lib.rs:50` | `Jsc` → `bun_jsc` / `src/jsc/event_loop.rs:1328` | `bun_jsc → bun_event_loop`; `AnyEventLoop`/`EventLoopHandle` must dispatch to `jsc::EventLoop` methods it cannot name. |
| `TranspilerCacheImpl[Jsc]` | `bun_ast` / `src/ast/transpiler_cache.rs:52` | `Jsc` → `bun_jsc` / `src/jsc/RuntimeTranspilerCache.rs:1054` | `bun_jsc → … → bun_ast`; `parser::Options.runtime_transpiler_cache` lives in AST but the disk cache (`RuntimeTranspilerCache`) needs JSC types. |
| `ProcessExit[12 variants]` | `bun_spawn` / `src/spawn/lib.rs:72` | `bun_spawn` (in-crate): `SyncWindows` `src/spawn/lib.rs:100`/`:107`; `bun_install`: `LifecycleScript` `src/install/lifecycle_script_runner.rs:1221`, `SecurityScan` `src/install/PackageManager/security_scanner.rs:970`; `bun_runtime`: `Subprocess` `src/runtime/api/bun/subprocess.rs:343`, `Shell` `src/runtime/shell/subproc.rs:318`, `FilterRunHandle` `src/runtime/cli/filter_run.rs:214`, `MultiRunHandle` `src/runtime/cli/multi_run.rs:266`, `TestParallelWorker` `src/runtime/cli/test/parallel/Worker.rs:411`, `CronRegister` `src/runtime/api/cron.rs:2085`, `CronRemove` `src/runtime/api/cron.rs:2092`, `ChromeProcess` `src/runtime/webview/ChromeProcess.rs:169`, `HostProcess` `src/runtime/webview/HostProcess.rs:112` | `bun_runtime → … → bun_spawn` and `bun_install → … → bun_spawn`; `Process::exit_handler` is a closed set of handler types owned by higher crates. |
| `DevServerHandle[Bake]` | `bun_bundler` / `src/bundler/lib.rs:338` | `Bake` → `bun_runtime` / `src/runtime/bake/dev_server/mod.rs:1123` | `bun_runtime → … → bun_bundler`; `bake::DevServer` is a `bun_runtime` type the bundler threads must call into. |
| `VmLoaderCtx[Runtime]` | `bun_bundler` / `src/bundler/lib.rs:364` | `Runtime` → `bun_runtime` / `src/runtime/jsc_hooks.rs:1408` | `bun_runtime → … → bun_bundler`; `normalize_specifier`/`get_loader_and_virtual_source` need `VirtualMachine` fields (`origin`, `module_loader`, `webcore::Blob`). |
| `BundleGenerateChunkCtx[Linker]` (cfg `show_crash_trace`) | `bun_crash_handler` / `src/crash_handler/lib.rs:713` | `Linker` → `bun_bundler` / `src/bundler/LinkerContext.rs:60` | `bun_bundler → … → bun_crash_handler`; crash-trace `Action::BundleGenerateChunk` needs to format `Chunk`/`PartRange` whose layout only `bun_bundler` knows. |

Excluded (non-production): `Shape` in `src/dispatch/tests/shape.rs:4` — test fixture for the proc-macro itself.

**Subtotal, Section B: 10 production `link_interface!` invocations** spanning **33 distinct variant impls** in higher-tier crates.

---

## Totals

| Category | Count |
|---|---|
| Hand-written `extern "Rust"` symbols (fns + statics) | **36** |
| Hand-written `extern "Rust" { }` blocks | **20** |
| `bun_dispatch::link_interface!` invocations (production) | **10** |
| `link_impl_*!` variant definers (production) | **33** |
| Declaring crates touched | 12 (`bun_alloc`, `bun_core`, `bun_install_types`, `bun_resolver`, `bun_dns`, `bun_js_parser`, `bun_bundler`, `bun_io`, `bun_event_loop`, `bun_jsc`, `bun_sql_jsc`, `bun_ast`, `bun_spawn`, `bun_crash_handler`) |
| Defining crates touched | 9 (`bun_crash_handler`, `bun_jsc`, `bun_install`, `bun_runtime`, `bun_js_parser_jsc`, `bun_sys`, `bun_errno`, `bun_event_loop`, `bun_bundler`, `bun_spawn`) |

---

## Notes on non-declaring string matches

These files matched `extern "Rust"` only in doc comments / macro internals, not as actual declarations, and are **excluded** from the counts:
- `/workspace/bun/src/dispatch/lib.rs:5,328` — proc-macro crate itself; line 328 is the code-gen site that emits the extern block.
- `/workspace/bun/src/jsc/EventLoopHandle.rs:8`, `/workspace/bun/src/event_loop/AnyTask.rs:53`, `/workspace/bun/src/standalone_graph/StandaloneModuleGraph.rs:1518`, `/workspace/bun/src/http_jsc/headers_jsc.rs:24` — doc-only references.
- `/workspace/bun/src/runtime/dispatch.rs`, `/workspace/bun/src/runtime/jsc_hooks.rs`, `/workspace/bun/src/runtime/hw_exports.rs`, `/workspace/bun/src/runtime/api/JSBundler.rs`, `/workspace/bun/src/runtime/dns_jsc/dns.rs`, `/workspace/bun/src/jsc/RegularExpression.rs`, `/workspace/bun/src/jsc/CachedBytecode.rs`, `/workspace/bun/src/install/auto_installer.rs`, `/workspace/bun/src/js_parser_jsc/Macro.rs`, `/workspace/bun/src/crash_handler/lib.rs:36-61` — these are the **definer** side (`#[no_mangle]` bodies), already listed in the "Definer" column above.
- `/workspace/bun/src/parsers/native_test_shims.rs:12` — test-only alternate `#[no_mangle]` definition of `__bun_crash_handler_out_of_memory` for `cargo test -p bun_parsers` (which does not link `bun_crash_handler`).

---

## dyn_vtable

# Catalog: `dyn Trait` and manual-vtable usage in `/workspace/bun/src/**/*.rs`

Excluded: `backend_wic.rs` COM vtables, `dyn Error`, `dyn Any`. Framed against the confirmed `bun_jsc` split (VirtualMachine/ModuleLoader/ConsoleObject/event_loop/ipc/hot_reloader/RuntimeTranspiler*/etc. move UP into `bun_runtime`).

---

## PATTERN 1 — Manual vtables that DELETE under the VM→runtime split

These exist solely to let `bun_jsc`/`bun_sql_jsc` call "up" into `bun_runtime`. Once `VirtualMachine` lives in `bun_runtime`, every call becomes same-crate direct.

| Struct | File:line | Slots | Why it exists today |
|---|---|---|---|
| `RuntimeHooks` | `/workspace/bun/src/jsc/VirtualMachine.rs:1648` | ~25 fn ptrs | `bun_jsc` → `bun_runtime` cycle (Timer::All, NodeFS, Body hive, debugger, console formatter, process.exit, SSL cache, IPC…) — `__BUN_RUNTIME_HOOKS` static |
| `LoaderHooks` | `/workspace/bun/src/jsc/ModuleLoader.rs:185` | 4 fn ptrs | `bun_jsc` → `bun_runtime` for transpile/fetch-builtin/embedded-node-file |
| `SqlRuntimeHooks` | `/workspace/bun/src/sql_jsc/jsc.rs:208` | 13 fn ptrs | `bun_sql_jsc` → `bun_runtime` for timer heap, SSL cache, SSLConfig, Blob accessors — `__BUN_SQL_RUNTIME_HOOKS` |
| `dyn IPC::SendQueueOwner` | `/workspace/bun/src/jsc/ipc.rs:866` (trait), `:848` (`*mut dyn`) | trait | 2 impls: `IPCInstance` (`/workspace/bun/src/jsc/VirtualMachine.rs:2928`) and `SubprocessT` (`/workspace/bun/src/runtime/api/bun/js_bun_spawn_bindings.rs:97`). After split both live in `bun_runtime` → **becomes a 2-variant enum** |
| `dyn HotReloadTaskView` | `/workspace/bun/src/jsc/hot_reloader.rs:336` | trait | Erases `Task<Ctx, EL, const RELOAD_IMMEDIATELY>` generics for the `Reloadable::reload` callback. After split, `hot_reloader` + all reload targets in same crate → can stay generic or inline |

**Disposition:** delete outright (this is the `jsc_hooks.rs` + `runtime/dispatch.rs` the orchestrator already called out).

---

## PATTERN 2 — `link_interface!` (tagged-enum + per-variant `extern "Rust"`, no runtime vtable)

Generated by `/workspace/bun/src/dispatch/lib.rs`. Shape: `{ kind: enum, owner: *mut () }`; dispatch is `match kind { … }` over link-time direct calls. Inlines under LTO; closest Rust analogue is `enum_dispatch` across crates.

| Interface | Declared at | Variants | Boundary | After VM→runtime split |
|---|---|---|---|---|
| `EventLoopCtx[Js, Mini]` | `/workspace/bun/src/io/lib.rs:119` | 2 | `bun_io` ↔ `bun_jsc`/`bun_event_loop` | **REMAINS** (io < event_loop < runtime). Orchestrator item (1). 2-variant, cannot be generic (stored in `FilePoll`/`KeepAlive` by value, mixed at runtime). |
| `JsEventLoop[Jsc]` | `/workspace/bun/src/event_loop/lib.rs:50` | 1 | `bun_event_loop` ↔ `bun_jsc` | **REMAINS** as event_loop↔runtime. Single-variant: could become plain `extern "Rust"` fns or an opaque `*mut ()` + free fns. |
| `BufferedReaderParentLink[13]` | `/workspace/bun/src/io/lib.rs:325` | 13 | `bun_io` ↔ `bun_runtime`/`bun_install` | **Orchestrator item (2).** See dedicated section below. |
| `ProcessExit[12]` | `/workspace/bun/src/spawn/lib.rs:72` | 12 | `bun_spawn` ↔ `bun_runtime`/`bun_install` | **Orchestrator item (2).** See dedicated section below. |
| `DevServerHandle[Bake]` | `/workspace/bun/src/bundler/lib.rs:338` | 1 | `bun_bundler` ↔ `bun_runtime` | **REMAINS** (bundler < runtime). Single-variant, 11 methods. Alternative: `dyn Trait` would be cleaner (no `*const ()` args) but loses `Copy`. |
| `VmLoaderCtx[Runtime]` | `/workspace/bun/src/bundler/lib.rs:364` | 1 | `bun_bundler` ↔ `bun_runtime` | **REMAINS.** Single-variant, 13 methods. Same as above. |
| `TranspilerCacheImpl[Jsc]` | `/workspace/bun/src/ast/transpiler_cache.rs:52` | 1 | `bun_ast` ↔ `bun_jsc` | **REMAINS** as ast↔runtime. Single-variant. |
| `OutputSink[Sys]` | `/workspace/bun/src/bun_core/lib.rs:584` | 1 | `bun_core` ↔ `bun_sys` | **Orchestrator item (3):** dissolves if core absorbs sys primitives (or the extern stays as one of the "remaining 7"). |
| `ErrnoNames[Sys]` | `/workspace/bun/src/bun_core/lib.rs:610` | 1 | `bun_core` ↔ `bun_errno` | **Orchestrator item (3):** dissolves if core absorbs errno. |
| `BundleGenerateChunkCtx[Linker]` | `/workspace/bun/src/crash_handler/lib.rs:713` | 1 | `bun_crash_handler` ↔ `bun_bundler` | `cfg(show_crash_trace)` only. Remains. |

### Deep-dive on orchestrator item (2): `BufferedReaderParentLink` / `ProcessExit`

**`BufferedReaderParentLink`** (`/workspace/bun/src/io/lib.rs:325` + `/workspace/bun/src/io/PipeReader.rs:45`):
- Backing "vtable" is literally `{ parent: *mut c_void, kind: enum }` — no fn pointers stored; dispatch is `match kind` to extern-"Rust" thunks.
- The companion `trait BufferedReaderParent` (`PipeReader.rs:69`) takes raw `*mut Self` (not `&mut self`) because the parent *embeds* the reader and the callbacks fire while `&mut BufferedReader` is live → Stacked-Borrows would UB on `&mut self`.
- **Can it be a generic?** No — `BufferedReader` is stored inline in the parent struct, and the parent type is in a higher crate. Making `BufferedReader<P: Parent>` generic would push the type parameter through `FilePoll`, `PipeReader`, `PollOrFd`, every `EventLoopCtx` consumer. And 13 monomorphized copies of the 1900-line read loop.
- **Can it be `dyn Trait`?** Not cleanly — the trait methods take `*mut Self` (aliasing contract), which is not object-safe.
- **Recommendation:** keep the `link_interface!` shape. It's a tagged enum with direct calls; already the minimal form. After the split, 11/13 variants live in `bun_runtime`, 2 in `bun_install` — still cross-crate.

**`ProcessExit`** (`/workspace/bun/src/spawn/lib.rs:72`):
- 1 method (`on_process_exit`), 12 variants. Stored as `Option<ProcessExit>` on `Process`.
- **Can it be a generic?** No — `Process` is a concrete heap type held in `WaiterThread`'s queue / libuv handles across all spawn sites; can't be `Process<H>`.
- **Can it be `dyn Trait`?** Yes, `Box<dyn FnOnce(&mut Process, Status, &Rusage)>` or `*mut dyn ProcessExitHandler` would work — but costs an allocation per process, and loses the `Copy` `{kind, owner}` handle.
- **Recommendation:** keep `link_interface!`. 1 method × 12 variants = 12 extern symbols; trivial.

---

## PATTERN 3 — Manual vtables that SURVIVE the split (genuine lower→upper boundary or C ABI)

### `AllocatorVTable` / `StdAllocator` — `/workspace/bun/src/bun_alloc/lib.rs:69`
```rust
pub struct AllocatorVTable { pub alloc, pub resize, pub remap, pub free }
pub struct StdAllocator { pub ptr: *mut c_void, pub vtable: &'static AllocatorVTable }
```
**Instances (exhaustive):**
- `/workspace/bun/src/bun_alloc/basic.rs:107` — `C_ALLOCATOR_VTABLE` (mimalloc default)
- `/workspace/bun/src/bun_alloc/basic.rs:188` — `Z_ALLOCATOR_VTABLE` (zero-init)
- `/workspace/bun/src/bun_alloc/MimallocArena.rs:740` — `HEAP_ALLOCATOR_VTABLE` (per-arena)
- `/workspace/bun/src/bun_alloc/MimallocArena.rs:760` — `GLOBAL_MIMALLOC_VTABLE`
- `/workspace/bun/src/bun_alloc/BufferFallbackAllocator.rs:34` — `VTABLE`
- `/workspace/bun/src/bun_alloc/lib.rs:1401` — `StringImplAllocator::VTABLE` (WTFStringImpl refcount)
- `/workspace/bun/src/runtime/allocators/LinuxMemFdAllocator.rs:337` — `allocator_interface::VTABLE` (free-only, munmap)
- `/workspace/bun/src/runtime/webcore/blob/Store.rs:531` — `MMAP_FREE_VTABLE` (free-only)
- `/workspace/bun/src/bundler/bundle_v2.rs:7709` — `EXTERNAL_FREE_VTABLE` (plugin-owned bytes)

**Why:** Zig `std.mem.Allocator` port. The `&'static AllocatorVTable` address is used as a runtime type tag (`is_instance`, `/workspace/bun/src/safety/alloc.rs:26`, `/workspace/bun/src/bun_alloc/NullableAllocator.rs:49`) and registered at init (`/workspace/bun/src/safety/lib.rs:54`, `/workspace/bun/src/runtime/allocators/mod.rs:26`). Must be `Copy`, 2 words, passable by value. Open set across crates.
**Enum/generic?** No. Identity-by-vtable-address is load-bearing; open set; by-value Copy is load-bearing (stored in `Bytes`/`SmolStr`/etc.). This is the one manual vtable that is intrinsically correct.

### `uws_sys::socket_group::VTable` — `/workspace/bun/src/uws_sys/SocketGroup.rs:43`
`#[repr(C)]` struct of 11 `Option<unsafe extern "C" fn>`, must match `us_socket_vtable_t` in `libusockets.h` (asserted at `:68`). Generated per-handler via `/workspace/bun/src/uws_sys/vtable.rs:138` `make<H: Handler>()`; dispatch table at `/workspace/bun/src/runtime/socket/uws_dispatch.rs:38`. Also hand-rolled at `/workspace/bun/src/runtime/cli/test/parallel/Channel.rs:545`.
**Why:** C ABI; loop.c calls through it.
**Enum/generic?** No — C struct.

### `bio_method_st` — `/workspace/bun/src/boringssl_sys/boringssl.rs:751`
BoringSSL BIO vtable. C ABI. Not negotiable.

### `CompletionDispatch` + `CompletionHandle` — `/workspace/bun/src/bundler/bundle_v2.rs:1462`
2 fn ptrs, 1 static instance at `/workspace/bun/src/runtime/api/js_bundle_completion_task.rs:784`.
**Why:** `bun_bundler` → `bun_runtime` (bundler runs on bg thread, enqueues onto JS event loop). Single implementor.
**Enum/generic?** Could be a single-variant `link_interface!` or `&'static dyn Trait`. Survives the split (bundler < runtime).

### `AnyResolveWatcher` — `/workspace/bun/src/watcher/Watcher.rs:69`
`{ context: *mut (), callback: fn(*mut (), &[u8], Fd) }`. 1 method.
**Why:** `bun_watcher`/`bun_resolver` → higher-tier hot-reloader. Survives split.
**Could be:** `&mut dyn FnMut(&[u8], Fd)` — semantically identical; current form is `Copy`.

### `WakeHandler` — `/workspace/bun/src/install_types/resolver_hooks.rs:1371`
`{ context, handler, on_dependency_error }`. Installed by runtime, called from `bun_install`.
**Why:** `bun_install_types` → `bun_runtime` back-edge. Survives.
**Orchestrator item (1):** this is part of the resolver↔install↔runtime extern cluster.

### `bun_core::io::Writer` (head-struct vtable) — `/workspace/bun/src/bun_core/util.rs:1756`
`#[repr(C)] { write_all: fn, flush: fn }` as first field; `&mut Adapter` upcast to `&mut Writer`.
**Why:** T0 `bun_core` can't name `bun_sys` I/O.
**Orchestrator item (3):** dissolves on core absorbing paths/errno/sys primitives, or replace with the `bun_io::Write` trait (which is already in bun_core!).

---

## PATTERN 4 — Manual vtables that are IN-CRATE (could be enum, kept for code-size / Zig parity)

### `webcore::Sink::VTable` — `/workspace/bun/src/runtime/webcore/Sink.rs:302`
`{ connect, write, write_latin1, write_utf16, end }`; `wrap<T: SinkHandler>()` monomorphizes. Stored by-value in `Sink { ptr, vtable, status, used }`.
Implementors: the `JSSink<T>` family (ArrayBufferSink, FileSink, HTTPResponseSink, …).
**Enum?** Yes — all impls in `bun_runtime`. Zig-port shape.

### `webcore::streams::SignalVTable` — `/workspace/bun/src/runtime/webcore/streams.rs:983`
`{ close, ready, start }`; `wrap<W: SignalHandler>()`. Stored by-value (3 words).
Implementors: `Subprocess` (`/workspace/bun/src/runtime/api/bun/subprocess/Writable.rs:558`), shell `Writable` (`/workspace/bun/src/runtime/shell/subproc.rs:1001`), `SinkSignal<T>` (Sink.rs:687).
**Enum?** Yes — all in `bun_runtime`. The JSValue-smuggled `SinkSignal` path (`Sink.rs:676-718`) needs care.

### `SourceMapHandler` — `/workspace/bun/src/js_printer/lib.rs:1206`
`{ ctx: NonNull<()>, callback: fn }` + `trait OnSourceMapChunk` + `for_<T>()` monomorphizer. 1 method.
Implementor: `LinkerContext` (`/workspace/bun/src/bundler/LinkerContext.rs:2578`).
**Why:** avoid a generic param threading through the 10k-line printer. `&'a mut dyn OnSourceMapChunk` would be identical and simpler; current form is just the Zig callback shape.

### `RequireOrImportMetaCallback` — `/workspace/bun/src/js_printer/lib.rs:1432` (struct at ~1410)
Same shape. Implementor: `LinkerContext`. Same verdict as above.

### `OutputTaskVTable` — `/workspace/bun/src/runtime/shell/interpreter.rs:2652`
This is a **trait used as a generic bound** (`OutputTask<P: OutputTaskVTable>`), not dyn, not a fn-ptr struct. Misnamed. Implementors: `Touch`, `Ls`, `Mkdir`, `Cp` (shell builtins). Already the right shape.

### `MkdirVerboseVTable` / `RemoveFileVTable` — `/workspace/bun/src/runtime/shell/builtin/mkdir.rs:374`, `rm.rs:1654`
Plain structs passed to a generic (`mkdir_recursive_impl<V>`, `remove_entry_file<V>`). Misnamed "VTable"; they're generic-bound payload structs. No dispatch.

---

## PATTERN 5 — `dyn Trait` for cross-crate dep inversion (single or few impls, trait in lower crate)

| Trait | Defined | Impls | Boundary | After split |
|---|---|---|---|---|
| `dyn StandaloneModuleGraph` | `/workspace/bun/src/resolver/standalone_module_graph.rs:12` | 1: `/workspace/bun/src/standalone_graph/StandaloneModuleGraph.rs:200` | resolver < standalone_graph < jsc/runtime. Stored on `VirtualMachine` at `VirtualMachine.rs:193`, `InitOptions.graph` at `:97`, threaded through jsc_hooks/run_command/BunObject. | **REMAINS** (resolver < standalone_graph < runtime). Single impl → could be `extern "Rust"` + opaque ptr, but `&'static dyn` is cleanest. |
| `dyn AutoInstaller` | `/workspace/bun/src/install_types/resolver_hooks.rs:1499` | 1: `PackageManager` at `/workspace/bun/src/install/auto_installer.rs:132` | resolver ↔ install (resolver.rs:543 `Option<NonNull<dyn AutoInstaller>>`). **Orchestrator item (1).** | **REMAINS.** Downcast at `VirtualMachine.rs:4348/4374` goes away when VM is in runtime (can name `PackageManager` directly). The resolver-side `dyn` stays. |
| `dyn PluginResolver` | `/workspace/bun/src/bundler/transpiler.rs:51` | 1: `PluginRunner` at `/workspace/bun/src/jsc/PluginRunner.rs:46` | bundler ↔ jsc. `linker.plugin_runner: Option<*mut dyn PluginResolver>` at `/workspace/bun/src/bundler/linker.rs:58`. | **REMAINS** as bundler↔runtime (PluginRunner moves to runtime). |
| `dyn PackageJsonView` | `/workspace/bun/src/install_types/resolver_hooks.rs:1590` | 1: `resolver::PackageJSON` at `/workspace/bun/src/resolver/package_json.rs:187` | install_types ↔ resolver (passed to `AutoInstaller::resolve_*`) | **REMAINS.** Note `dependency_iter() -> Box<dyn Iterator>` at `package_json.rs:206` is forced by object-safety. |
| `dyn EStringRef` | `/workspace/bun/src/bun_core/string/MutableString.rs:9` | 1: `E::String` in js_parser | core ↔ ast | **REMAINS** (core < ast). 2 call sites (`MutableString.rs:500,542`). |
| `dyn RendererImpl` | `/workspace/bun/src/md/types.rs:145` (wrapped as `Renderer { ptr: &mut dyn RendererImpl }` at `:141`) | 5: AnsiRenderer, HtmlRenderer, ImageUrlCollector (bun_md); ParseRenderer, JsCallbackRenderer (bun_runtime) | md ↔ runtime, genuine open set | **REMAINS.** Proper use of dyn. |
| `dyn SourceData` (in `Source::Any(Box<dyn>)`) | `/workspace/bun/src/spawn/lib.rs:203` | 2: `AnyBlob`, `ArrayBufferSource` at `/workspace/bun/src/runtime/api/bun/subprocess.rs:1458,1473` | spawn ↔ runtime (Blob/ArrayBuffer are JSC types) | **REMAINS.** |
| `dyn WatcherContext` | `/workspace/bun/src/watcher/Watcher.rs:139` | 1: `DevServer` at `/workspace/bun/src/runtime/bake/dev_server/lifecycle.rs:20` | watcher ↔ runtime | Used as generic bound on `Watcher<C>`, not dyn — listed for completeness. |

---

## PATTERN 6 — `dyn Trait` for generics-bloat suppression (in-crate or adjacent)

| Usage | File(s) | Impls | Why dyn | Could be enum/generic? |
|---|---|---|---|---|
| `&dyn Host` / `&mut dyn Host` | `/workspace/bun/src/react_compiler/program.rs:62` (trait); ~25 use sites across `lowering/`, `codegen.rs`, `imports.rs`, `pipeline.rs` | 1 (parser `P`) | Threaded through the entire compiler pipeline. **Orchestrator item (4):** react_compiler stays its own crate for `opt-level="s"`; dyn keeps mono count at 1. | Generic would work but defeat the size override. **Keep dyn.** |
| `&mut dyn bun_io::Write` | `/workspace/bun/src/jsc/ConsoleObject.rs` (~50 sites, e.g. `:384,506,866,2737,2928,3027…`), `/workspace/bun/src/runtime/test_runner/pretty_format.rs:2797+`, `/workspace/bun/src/css/printer.rs:127`, `/workspace/bun/src/install/lockfile/bun.lock.rs:95`, `/workspace/bun/src/runtime/jsc_hooks.rs:1782+` | many (Vec<u8>, MutableString, QuietWriter, …) | ConsoleObject formatter is 6000 lines; generic over `W` would mono per sink. Trait at `/workspace/bun/src/bun_core/util.rs:1821` (`bun_io::Write`). | Already the right call. `ConsoleObject` moves to runtime but stays dyn. |
| `&mut dyn ResolverContextDyn` | `/workspace/bun/src/install/lockfile/Package.rs:267` (trait), `:2148-2162` (erase-shim) | blanket over `R: ResolverContext` | Comments say "so the ~960-line body is codegen'd once". | Intentional code-size. Keep. |
| `&mut dyn InsertionHandler` | `/workspace/bun/src/runtime/bake/FrameworkRouter.rs:1458` (trait), `:232,1062,1504,1522` | 3: `JSFrameworkRouterScanCtx`, `EntryPointMap`, `DevServer` — all in bun_runtime | `wrap<T>()` shim at `/workspace/bun/src/runtime/bake/mod.rs:658` explicitly for mono suppression | **Could be a 3-variant enum.** All impls same-crate. |
| `&mut dyn NpmAliasRegistry` | `/workspace/bun/src/install/dependency.rs:19` (trait), `:240,714,1214,1237,1248` + `migration.rs:1126` | 2: `PackageManager`, `NpmAliasMap` — both in bun_install | avoid generic on `parse_version` | **Could be a 2-variant enum.** |
| `&dyn bun_alloc::Allocator` + `impl dyn Allocator` | `/workspace/bun/src/bun_alloc/lib.rs:3504` (`is<T>()`), `heap_breakdown.rs:143,186`, `MaxHeapAllocator.rs:86`, `CachedBytecode.rs:129` | marker trait w/ `type_id()` | `Any`-style downcast for allocator identity (distinct from `StdAllocator` vtable-address identity) | Std idiom adjacent; fine. |
| `*mut dyn DebugDataOps` | `/workspace/bun/src/ptr/ref_count.rs:1095` (trait), `:172,431,624,741` | 2: `NoopDebugData`, `DebugData<Count>` | debug-only refcount instrumentation; erases `Count` | Fine. Debug-only. |

---

## PATTERN 7 — `dyn Fn` / `dyn FnMut` / `dyn fmt::Write` (closure erasure, cold paths)

All low-frequency, all fine, none worth refactoring:

- `/workspace/bun/src/react_compiler/reactive_scopes/print_reactive_function.rs:187,596` — `Box<dyn Fn>`/`&dyn Fn` for debug printer recursion
- `/workspace/bun/src/react_compiler/hir/print.rs:907` — `Option<&dyn Fn>`
- `/workspace/bun/src/js_parser/parser.rs:545` — `&mut dyn FnMut` template-subst callback
- `/workspace/bun/src/js_parser/parse/parse_entry.rs:631` — `&dyn Fn` parser-entry callback
- `/workspace/bun/src/io/openForWriting.rs:15,26,46,59` — `&dyn Fn(Fd, &ZStr, i32, Mode) -> Result<Fd>` openat hook
- `/workspace/bun/src/bun_core/string/immutable.rs:2290` — `&mut dyn FnMut(&mut &[u8])` field visitor
- `/workspace/bun/src/crash_handler/lib.rs:611` — `Box<dyn Fn(*mut c_void) + Send>` crash callback list
- `/workspace/bun/src/runtime/webcore/Blob.rs:5202` — `&mut dyn FnMut(&JSGlobalObject) -> Option<ReadableStream>`
- `/workspace/bun/src/runtime/api/html_rewriter.rs:1421` — `&dyn core::fmt::Display` for error msg
- `/workspace/bun/src/boringssl/lib.rs:471` — `&mut dyn core::fmt::Write`
- `/workspace/bun/src/bun_core/output.rs:1901-1984` — `FmtTuple::write_nth(&self, idx, &mut dyn fmt::Write)` (object-safe bound for tuple impls)

---

## PATTERN 8 — `PipeWriter` parents (generic, not vtable — listed because "vtable" appears in comments)

`/workspace/bun/src/io/PipeWriter.rs:256,604,1381,1401,1915` — `Posix/Windows Buffered/Streaming WriterParent` traits. These are **generic bounds** (`PosixStreamingWriter<Parent: PosixStreamingWriterParent>`), not dyn, not fn-ptr structs. The "vtable" in comments refers to the `impl_streaming_writer_parent!` macro's borrow-mode selector. Already monomorphized; already the right shape.

---

## Summary table keyed to orchestrator items

| Item | Affected constructs | Recommendation |
|---|---|---|
| **Split deletes** | `RuntimeHooks`, `LoaderHooks`, `SqlRuntimeHooks`, `dyn SendQueueOwner`, `dyn HotReloadTaskView`, downcasts of `dyn AutoInstaller` in VirtualMachine | Delete / become direct calls / 2-variant enum |
| **(1) Remaining core↔sys / io↔event_loop / resolver↔install** | `OutputSink[Sys]`, `ErrnoNames[Sys]`, `io::Writer` head-struct, `EventLoopCtx[Js,Mini]`, `JsEventLoop[Jsc]`, `dyn AutoInstaller`, `dyn PackageJsonView`, `WakeHandler`, `__bun_resolver_init_package_manager` | First three dissolve on foundation merge; EventLoopCtx stays (2-variant, stored by value); resolver↔install dyn traits stay |
| **(2) BufferedReaderParentLink / ProcessExit** | `/workspace/bun/src/io/lib.rs:325`, `/workspace/bun/src/spawn/lib.rs:72` | **Keep `link_interface!`.** Generic is infeasible (stored in concrete heap types), `dyn` loses `Copy` + raw-ptr aliasing contract. These are already enums-with-extern-bodies. |
| **(3) Foundation merges** | `OutputSink`, `ErrnoNames`, `io::Writer`, (possibly `dyn EStringRef` if ast merged — unlikely) | Dissolve on merge |
| **(4) react_compiler** | `&dyn Host` (~25 sites) | **Keep dyn.** Own crate + `opt-level="s"` + single mono = intentional. |
| **(5) no_std leaves** | No dyn/vtable in opaque/windows_sys/output_tags | N/A |

---

## porting_todos

# Catalog of `PORTING.md` / `TODO(port` / `TODO(layering` / `layering hack` comments in `/workspace/bun/src/**/*.rs`

**Total matches: 398** across 204 files.
- `PORTING.md` references: **396**
- `TODO(port`: **2**
- `TODO(layering`: **0**
- `layering hack`: **0**

Note: `docs/PORTING.md` no longer exists in the repo; every `PORTING.md` reference is to a deleted Zig→Rust porting guide (except one BoringSSL URL).

---

## Summary counts

| Class | Count | Description |
|---|---|---|
| **(a)** historical note, safe to delete | **327** | Cites a porting-guide §rule (Allocators, Forbidden, Global mutable state, Concurrency, Idiom map, JSC types, Strings, Pointers, FFI, Type map, Comptime reflection, Logging, Collections) to justify a now-settled choice. The referenced document is gone; the comment is dead weight. |
| **(b)** actual unfinished work | **13** | Names a concrete follow-up (thread a lifetime, reshape an API, replace `Strong` with `JsRef`, finish a port gap). |
| **(c)** layering workaround | **57** | Code shape exists only because of the crate DAG (erased `(tag,ptr)`, fn-ptr vtables, extension traits, `*_jsc` bridge stubs, code moved up/down). Split further: **c1=46** vanish under the confirmed `bun_jsc` split + `*_jsc` fold; **c2=11** need a different merge (foundation-tier, resolver↔glob, bundler↔options_types). |
| **(X)** not ours | **1** | BoringSSL `PORTING.md` URL. Leave alone. |

---

## (b) Unfinished work — 13 comments, 9 distinct action items

| Location | Concrete action |
|---|---|
| `/workspace/bun/src/react_compiler/lowering/build_hir/helpers.rs:31` | `TODO(port)`: teach HIR codegen to read `bun_ast` so `original_node` round-trips (currently `serialize_*!` expand to `None`). |
| `/workspace/bun/src/react_compiler/program.rs:1364` | `TODO(port)`: emit the `gate() ? compiled : original` wrapper for the function-declaration path. |
| `/workspace/bun/src/runtime/node/zlib/NativeBrotli.rs:81` | Replace `Strong` self-wrapper ref with `JsRef` (self-`Strong` leaks). |
| `/workspace/bun/src/runtime/cli/filter_run.rs:733` | Reshape `configureEnvForRun` out-param to `-> Result<Transpiler, _>`. |
| `/workspace/bun/src/runtime/bake/bake_body.rs:113,138,283` | Thread a real `'bump` lifetime (or `ArenaStr`) through `UserOptions`/`Framework`/`StringRefList::track`; delete `arena_erase`. |
| `/workspace/bun/src/install/PackageManager/UpdateRequest.rs:26,28` | Thread `<'a>` through `&mut [UpdateRequest]` pipeline so `version_buf` drops the `RawSlice<u8>` erasure (flagged "larger reshape"). |
| `/workspace/bun/src/css/css_parser.rs:4487` | Add `<'a>` to `Token`/`Dimension`/`CachedToken` in `css/lib.rs` and delete `src_str()` erasure fn. |
| `/workspace/bun/src/css/values/css_string.rs:12` | Thread `'bump` through `CssString` (currently `*const [u8]`). |
| `/workspace/bun/src/css/values/syntax.rs:292` | Swap `Literal(Box<[u8]>)` for `&'bump [u8]` once `SyntaxString` threads the arena lifetime. |
| `/workspace/bun/src/sys/Error.rs:32` | Revisit `path: Box<[u8]>` eager-clone if profiling shows regression. |

---

## (c) Layering workarounds — 57 comments

### c1 — 46 vanish under the confirmed `bun_jsc` split + `*_jsc` fold

These document the §Dispatch fn-ptr vtables, erased `(tag, *mut ())` storage, `extern "Rust"` link-time hooks, and `*_jsc` extension-trait breadcrumbs that exist solely because `VirtualMachine`/`ModuleLoader`/`event_loop`/`rare_data`/`ipc` live below `bun_runtime`. After those ~37k LOC move up into `bun_runtime`, `jsc_hooks.rs` + `runtime/dispatch.rs` delete and the 11 `*_jsc` crates fold in — every comment here goes with them.

**Dispatch vtable / erased-storage machinery (24):**
`/workspace/bun/src/runtime/jsc_hooks.rs:5` · `/workspace/bun/src/runtime/dispatch.rs:3,466` · `/workspace/bun/src/jsc/event_loop.rs:10,169` · `/workspace/bun/src/jsc/VirtualMachine.rs:1267,1636` · `/workspace/bun/src/jsc/lib.rs:245` · `/workspace/bun/src/jsc/Task.rs:3,37` · `/workspace/bun/src/jsc/rare_data.rs:29,50` · `/workspace/bun/src/jsc/ModuleLoader.rs:126,547` · `/workspace/bun/src/jsc/ipc.rs:52` · `/workspace/bun/src/runtime/node/node_cluster_binding.rs:13` · `/workspace/bun/src/runtime/timer/timer_object_internals.rs:312` · `/workspace/bun/src/runtime/timer/WTFTimer.rs:50` · `/workspace/bun/src/event_loop/ConcurrentTask.rs:37,186` · `/workspace/bun/src/bundler/bundle_v2.rs:1382` · `/workspace/bun/src/bundler/DeferredBatchTask.rs:9,55` · `/workspace/bun/src/runtime/bake/production.rs:248`

**`*_jsc` bridge-crate / `to_js` extension-trait residue (18):**
`/workspace/bun/src/sys_jsc/lib.rs:9` · `/workspace/bun/src/sys/fd.rs:316` · `/workspace/bun/src/sys/Error.rs:491` · `/workspace/bun/src/ast/target.rs:36` · `/workspace/bun/src/options_types/compile_target.rs:477` · `/workspace/bun/src/http_types/Method.rs:46` · `/workspace/bun/src/http_types/FetchRequestMode.rs:26` · `/workspace/bun/src/http_types/FetchCacheMode.rs:34` · `/workspace/bun/src/http_types/FetchRedirect.rs:19` · `/workspace/bun/src/s3_signing/error.rs:50` · `/workspace/bun/src/uws_sys/WebSocket.rs:353` · `/workspace/bun/src/ini/lib.rs:1086` · `/workspace/bun/src/glob/GlobWalker.rs:301` · `/workspace/bun/src/bundler/options.rs:279,390` · `/workspace/bun/src/bun_core/string/mod.rs:893,1143` · `/workspace/bun/src/bun_core/util.rs:5626`

**Local shims / POD duplicates for upward deps (4):**
`/workspace/bun/src/runtime/api/cron.rs:50` · `/workspace/bun/src/runtime/napi/napi_body.rs:23` · `/workspace/bun/src/runtime/webcore/encoding.rs:927` · `/workspace/bun/src/dotenv/env_loader.rs:97` (duplicate `S3Credentials` POD so T2 `dotenv` names no `bun_s3_signing` types)

### c2 — 11 need a different merge

| Location | Boundary |
|---|---|
| `/workspace/bun/src/glob/GlobWalker.rs:223` + `/workspace/bun/src/resolver/lib.rs:1851` | `bun_glob` ↔ `bun_resolver` — `Accessor` trait in glob, impl in resolver. Survives the jsc split. |
| `/workspace/bun/src/bundler/bundle_v2.rs:601` + `/workspace/bun/src/bundler/options.rs:31,272,357` | `bun_options_types` / `bun_ast` ↔ `bun_bundler` — `TargetExt`/`LoaderExt` extension traits, shared `EntryPointMap` nominal type. |
| `/workspace/bun/src/errno/windows_errno.rs:830` + `/workspace/bun/src/sys/fd.rs:510` + `/workspace/bun/src/bun_core/util.rs:1370,1452` | Foundation-tier `bun_core` ↔ `bun_sys` ↔ `bun_errno` — `fd_path_raw[_w]` + `Win32Error` pushed down to break a cycle. Vanishes if core absorbs `errno`/`paths`/`sys`-lite. |
| `/workspace/bun/src/install_types/NodeLinker.rs:119` | `bun_install_types` single-declarer for `__bun_regex_*` extern (Yarr lives above). |

---

## (a) Historical notes — 327 comments, safe to delete

These justify a completed porting choice by citing a now-deleted guide section. Representative buckets (full list in `/tmp/classified2.txt` on the linux-x64 machine under `^a|`):

| §Section cited | ~Count | Example |
|---|---|---|
| `§Forbidden` (no `Box::leak`/`transmute`/aliased `&mut`/lifetime-extend) | ~95 | `/workspace/bun/src/install/lockfile.rs:1847`, `/workspace/bun/src/bundler/transpiler.rs:2173`, `/workspace/bun/src/js_parser/parser.rs:371` |
| `§Global mutable state` (OnceLock/AtomicPtr/RacyCell rationale) | ~60 | `/workspace/bun/src/install/PackageManager.rs:786,819,1094`, `/workspace/bun/src/runtime/cli/create_command.rs:35,256,2083,2740` |
| `§Allocators` (allocator field dropped; global mimalloc; arena pattern) | ~35 | `/workspace/bun/src/url/lib.rs:905`, `/workspace/bun/src/jsc/WorkTask.rs:40`, `/workspace/bun/src/bun_alloc/lib.rs:252,319,324,743,777` |
| `§Concurrency` (`Guarded`/`OnceLock`/mutex-owns-T) | ~20 | `/workspace/bun/src/crash_handler/lib.rs:586,607,1569`, `/workspace/bun/src/jsc/uuid.rs:108` |
| `§Idiom map` (deinit→Drop, defer→scopeguard, no `pub fn deinit`) | ~20 | `/workspace/bun/src/runtime/webcore/Body.rs:230,592,1416`, `/workspace/bun/src/watcher/Watcher.rs:242` |
| `§JSC types` / `§JSC` (JsClass codegen, Strong/JsRef, `!Send`) | ~15 | `/workspace/bun/src/runtime/image/Image.rs:52`, `/workspace/bun/src/jsc/JSValue.rs:3`, `/workspace/bun/src/runtime/api/filesystem_router.rs:116,854` |
| `§Pointers` (intrusive refcount ≠ `Arc`, `RawSlice`, `BackRef`) | ~15 | `/workspace/bun/src/ptr/lib.rs:15,19,32`, `/workspace/bun/src/ptr/owned.rs:*`, `/workspace/bun/src/ptr/shared.rs:3,60` |
| `§Strings` / `§Type map` (`ZStr`/`&'static`/no struct lifetime params) | ~15 | `/workspace/bun/src/resolve_builtins/HardcodedModule.rs:299`, `/workspace/bun/src/ast/import_record.rs:18` |
| `§FFI` (extern stays in this crate / `jsc_conv!`) | ~10 | `/workspace/bun/src/runtime/node/types.rs:855,1852`, `/workspace/bun/src/zlib/lib.rs:11`, `/workspace/bun/src/zstd/lib.rs:7` |
| `§Comptime reflection` / `§Collections` / `§Logging` / misc | ~40 | `/workspace/bun/src/css/values/length.rs:74`, `/workspace/bun/src/collections/array_hash_map.rs:6`, `/workspace/bun/src/output/lib.rs:21` |
| Intra-crate "§Dispatch" (not a layering workaround — just a hoisted `match`) | 6 | `/workspace/bun/src/runtime/shell/interpreter.rs:23,969`, `/workspace/bun/src/runtime/shell/IOWriter.rs:1228`, `/workspace/bun/src/js_printer/lib.rs:1212,1432`, `/workspace/bun/src/io/lib.rs:1318` |

Note on `/workspace/bun/src/runtime/jsc_hooks.rs:90,128,324,2059,2447,4042,4870,5050`: these 8 are class-(a) style-rule citations (§Forbidden aliasing/leaking) that happen to sit inside `jsc_hooks.rs`. When that file deletes under the confirmed split, they go with the code — but as comments they are deletable today independent of the restructure.

---

## (X) Not a Bun porting reference — 1

`/workspace/bun/src/uws/lib.rs:399` — external URL `https://boringssl.googlesource.com/boringssl/+/HEAD/PORTING.md#TLS-renegotiation`. Keep.

---

## Per architectural-direction note

Factoring in the confirmed `bun_jsc` split:
- **46 of the 57** layering comments (c1) document exactly the machinery the split removes — the `§Dispatch` vtables in `VirtualMachine`/`ModuleLoader`/`rare_data`/`event_loop`, the `jsc_hooks`/`runtime::dispatch` bodies, the erased `(tag,ptr)` Task storage in `bun_event_loop`, and the `*_jsc` extension-trait breadcrumbs. These are the textual shadow of the 14-of-21 `extern "Rust"` blocks the maintainer expects to vanish.
- **11** (c2) sit on other edges: `glob↔resolver` (2), `options_types/ast↔bundler` (4), foundation-tier `core↔sys↔errno` (4), and `install_types`→Yarr (1). These map to the orchestrator's open questions (1) and (3): the remaining `extern "Rust"` edges and the foundation-tier merge.
- None of the tagged comments bear on `BufferedReaderParentLink`/`ProcessExit` generics (open Q2), `react_compiler` opt-level isolation (Q4 — the two `TODO(port)` there are feature gaps, not layering), or the `no_std` shim leaves (Q5).

---

## tiny_crates

Based on reading each crate's `lib.rs` and `Cargo.toml` plus the dependency graph, here is the classification of all 47 crates in `/workspace/bun/src/` under 1500 LOC:

| crate | LOC | class | merge-into | reason |
|---|---|---|---|---|
| `bun_transpiler` | 10 | (e) vestigial | `bun_bundler` | Pure `pub use bun_bundler::transpiler::*` re-export shim; all 4 consumers already (transitively) have `bun_bundler` |
| `bun_output` | 51 | (e) vestigial | `bun_core` | Thin facade: `pub use bun_core::output::*` + macro re-exports; callers can use `bun_core` directly |
| `bun_api` | 78 | (e) vestigial | `bun_options_types` | Re-exports `bun_options_types::schema::api::*` plus one 40-line `Parser`; doc admits canonical defs moved there |
| `bun_ast_jsc` | 91 | (d) small module | `bun_runtime` | JSC↔`Log` glue; only consumers are `install_jsc` and `runtime`, both fold into `runtime` |
| `bun_output_tags` | 102 | (c) cycle-breaker | — (keep) | `#![no_std]` zero-dep leaf shared by two proc-macro crates (`bun_core_macros`, `bun_clap_macros`) **and** `bun_core`; proc-macros can't depend on `bun_core` |
| `bun_semver_jsc` | 144 | (d) small module | `bun_runtime` | JSC bridge for semver; only consumer is `runtime` |
| `bun_patch_jsc` | 223 | (d) small module | `bun_runtime` | JSC bridge for patch; only consumer is `runtime` |
| `bun_bin` | 262 | — (entry point) | — (keep) | `crate-type = ["staticlib"]` link root; holds `main`/`#[global_allocator]`/ASAN hooks — must stay a leaf crate |
| `bun_csrf` | 276 | (d) small module | `bun_runtime` | CSRF token gen/verify; only consumer is `runtime` |
| `bun_platform` | 348 | (d) small module | `bun_bin` | Darwin signposts + Linux `#[no_mangle]` syscall exports; only consumer is `bun_bin` (force-linked for symbols) |
| `bun_which` | 387 | (d) small module | `bun_sys` | `which()` PATH lookup; deps only `core`+`paths`+`sys`; all 6 consumers already have `bun_sys` |
| `bun_sha_hmac` | 398 | (d) small module | `bun_boringssl` | SHA/HMAC wrappers over BoringSSL; natural home is the BoringSSL safe-wrapper crate |
| `bun_dispatch` | 407 | (a) proc-macro | — (keep) | `proc-macro = true`; `syn`/`quote`-based `define_fn!`; must stay separate |
| `bun_opaque` | 430 | (c) cycle-breaker | — (keep) | `#![no_std]` zero-dep leaf providing `opaque_ffi!`; 26+ consumers incl. `bun_alloc` and every `*_sys`; intentionally lowest tier |
| `bun_sys_jsc` | 465 | (d) small module | `bun_runtime` | JSC bridge for `bun_sys` (fd/error/signal); only consumer is `runtime` |
| `bun_clap_macros` | 477 | (a) proc-macro | — (keep) | `proc-macro = true`; backs `bun_clap::parse_param!` |
| `bun_brotli_sys` | 491 | (b) FFI *_sys | `bun_brotli` | Raw brotli C externs; sole consumer is `bun_brotli` |
| `bun_tcc_sys` | 493 | (b) FFI *_sys | `bun_runtime` | TinyCC FFI; only consumer is `runtime` (FFI JIT) |
| `bun_boringssl` | 521 | (d) small module | `bun_boringssl_sys` | Safe wrappers + init over `_sys`; fold into one `boringssl` crate (uws_sys→sys, everyone else→wrapper) |
| `bun_dns` | 531 | (d) small module | `bun_http` | `GetAddrInfo`/c-ares glue; consumers are `http`, `install`(→http), `runtime`(→http) |
| `bun_zlib_sys` | 534 | (b) FFI *_sys | `bun_zlib` | Raw zlib externs; sole consumer is `bun_zlib` |
| `bun_safety` | 593 | (d) small module | `bun_core` | `ThreadLock`/`thread_id` already re-exported from `bun_core`; remaining alloc-vtable registry + `CriticalSection` fit tier-0 |
| `bun_mimalloc_sys` | 597 | (b) FFI *_sys | `bun_alloc` | Raw mimalloc externs; consumers are `bun_alloc` and `bun_bin` (which already depends on `bun_alloc`) |
| `bun_zstd` | 630 | (d) small module | — (keep) | Combined FFI+wrapper; 5 independent consumers (`http`/`resolver`/`sourcemap`/`standalone_graph`) with no common parent below them |
| `bun_libdeflate_sys` | 636 | (b) FFI *_sys | `bun_http` | Raw libdeflate externs; all consumers (`http`/`http_jsc`/`install`/`runtime`) depend on `bun_http` |
| `bun_brotli` | 654 | (d) small module | `bun_http` | Safe brotli reader/writer; consumers are `http` and `runtime`(→http) |
| `bun_highway` | 692 | (b) FFI *_sys | `bun_hash` | Highway SIMD C++ externs + thin `#[inline]` wrappers; merge with `wyhash`+`hash` into one zero-dep hashing leaf below `bun_core` |
| `bun_picohttp` | 755 | (d) small module | `bun_http_types` | picohttpparser FFI + `Header`/`Request`/`Response`; all consumers (incl. `s3_signing`) already depend on `bun_http_types` |
| `bun_analytics` | 779 | (c) cycle-breaker | — (keep) | Feature-usage counters written by 12+ crates at every tier; comment notes it deliberately avoids upward deps (`HardcodedModule` stored as `&str`) |
| `bun_valkey` | 832 | (d) small module | `bun_runtime` | RESP protocol parser; only consumer is `runtime` |
| `bun_bundler_jsc` | 858 | (d) small module | `bun_runtime` | JSC bridge for bundler options/plugins; only consumer is `runtime` |
| `bun_simdutf_sys` | 872 | (b) FFI *_sys | — (keep) | simdutf externs used directly by `bun_core`/`bun_paths`/`bun_collections`; must stay below `bun_core` as a leaf |
| `bun_jsc_macros` | 974 | (a) proc-macro | — (keep) | `proc-macro = true`; `#[host_fn]`/`#[uws_callback]` codegen |
| `bun_install_jsc` | 994 | (d) small module | `bun_runtime` | JSC bridge for install (npm/ini/dependency bindings); only consumer is `runtime` |
| `bun_boringssl_sys` | 1030 | (b) FFI *_sys | — (absorb `bun_boringssl`) | Keep as the combined BoringSSL crate after `bun_boringssl` folds in |
| `bun_resolve_builtins` | 1034 | (c) cycle-breaker | `bun_resolver` | `HardcodedModule` table split out so `resolver`+`bundler`+`jsc` share it; `bundler` and `jsc` already depend on `resolver` |
| `bun_base64` | 1036 | (d) small module | `bun_core` | `encode` already lives in `bun_core::base64`; move decode there (drop the thin `bun_collections` use) |
| `bun_css_jsc` | 1049 | (d) small module | `bun_runtime` | JSC bridge for CSS (color/internals); only consumer is `runtime` |
| `bun_perf` | 1074 | (d) small module | `bun_sys` | System-profiler tracing; deps only `core`+`paths`+`sys`; T0 subset already in `bun_core::perf` — full impl belongs in `sys` tier |
| `bun_wyhash` | 1179 | (d) small module | `bun_hash` | Zero-dep hash impl; combine with `bun_hash`+`bun_highway` into one hashing leaf (`bun_alloc` would gain `highway`, which is zero-dep) |
| `bun_css_derive` | 1223 | (a) proc-macro | — (keep) | `proc-macro = true`; `#[derive(DeepClone)]` for `bun_css` |
| `bun_hash` | 1253 | (d) small module | — (absorb `wyhash`+`highway`) | Non-crypto hashes (`Bun.hash`); becomes the unified hashing leaf below `bun_core` |
| `bun_core_macros` | 1327 | (a) proc-macro | — (keep) | `proc-macro = true`; `pretty_fmt!` etc. for `bun_core` |
| `bun_zlib` | 1442 | (d) small module | — (absorb `bun_zlib_sys`) | Safe zlib wrapper; 6 independent consumers incl. `options_types`; keep but fold `_sys` in |
| `bun_uws` | 1444 | (d) small module | `bun_uws_sys` | Safe wrapper over uws C ABI; fold into one `uws` crate; all 7 consumers can take the combined crate |
| `bun_sourcemap_jsc` | 1453 | (d) small module | `bun_runtime` | JSC bridge for sourcemap (coverage/JSSourceMap); only consumer is `runtime` |
| `bun_js_parser_jsc` | 1487 | (d) small module | `bun_runtime` | JSC bridge for parser (`Macro`/`expr_to_js`); consumers are `install_jsc`(→runtime) and `runtime` |

### Summary by class

- **(a) proc-macro — must stay separate (5):** `bun_dispatch`, `bun_clap_macros`, `bun_jsc_macros`, `bun_css_derive`, `bun_core_macros`
- **(b) pure FFI *_sys (8):** `bun_brotli_sys`, `bun_tcc_sys`, `bun_zlib_sys`, `bun_mimalloc_sys`, `bun_libdeflate_sys`, `bun_highway`, `bun_simdutf_sys`, `bun_boringssl_sys`
- **(c) cycle-breaker (4):** `bun_output_tags`, `bun_opaque`, `bun_analytics`, `bun_resolve_builtins`
- **(d) real small module (26):** the nine `*_jsc` crates (all → `bun_runtime`), plus `bun_csrf`, `bun_platform`, `bun_which`, `bun_sha_hmac`, `bun_boringssl`, `bun_dns`, `bun_safety`, `bun_zstd`, `bun_brotli`, `bun_picohttp`, `bun_valkey`, `bun_base64`, `bun_perf`, `bun_wyhash`, `bun_hash`, `bun_zlib`, `bun_uws`
- **(e) vestigial (3):** `bun_transpiler`, `bun_output`, `bun_api` — pure re-export facades whose canonical definitions already live elsewhere
- **entry-point (1):** `bun_bin` — staticlib root, not mergeable

### Key merge clusters

1. **`bun_runtime` absorbs 12 crates** (all `*_jsc` bridges + `csrf` + `valkey` + `tcc_sys`) — every one has `runtime` as its only real consumer.
2. **Hashing leaf:** `bun_wyhash` + `bun_highway` + `bun_hash` → single zero-dep `bun_hash` below `bun_core`.
3. **`_sys`/wrapper pairs fold together:** `brotli_sys→brotli`, `zlib_sys→zlib`, `mimalloc_sys→alloc`, `boringssl→boringssl_sys`, `uws→uws_sys`.
4. **`bun_sys` absorbs:** `bun_which`, `bun_perf`.
5. **`bun_core` absorbs:** `bun_output` (already there), `bun_safety`, `bun_base64`.
6. **`bun_http` absorbs:** `bun_dns`, `bun_brotli`, `bun_libdeflate_sys`.

Relevant files: `/workspace/bun/src/*/Cargo.toml`, `/workspace/bun/src/*/lib.rs` (one per crate listed above).

---

## build_impact

# Answers

## (1) Is the crate split motivated by parallel compilation?

**Not primarily.** No documentation or comment says "~100 crates for parallel cold-build." The explicit, documented motivations are:

- **Dependency-cycle breaking / layering.** `bun_jsc` transitively depends on `bun_install`, `bun_bundler`, `bun_http`, `bun_resolver`, etc. (see the dep graph you supplied), so anything that needs JSC *and* is needed by those crates must be split — hence the `*_jsc` sibling crates (`bun_sql`/`bun_sql_jsc`, `bun_css`/`bun_css_jsc`, `bun_semver`/`bun_semver_jsc`, `bun_ast`/`bun_ast_jsc`, etc.). The `*_types` crates (`bun_http_types`, `bun_install_types`, `bun_options_types`) exist for the same reason. `/workspace/bun/src/dispatch/lib.rs` header: *"Lets a low-tier crate declare an interface whose variant types live in higher-tier crates, without a vtable."* — i.e. an entire proc-macro crate exists solely to work around crate-graph layering. `/workspace/bun/src/opaque/Cargo.toml`: *"Intentionally zero `[dependencies]` — this crate is the lowest-tier leaf so every `*_sys` crate … can depend on it without pulling a single transitive crate into its build graph."*
- **Incremental rebuild scope.** `/workspace/bun/CONTRIBUTING.md:195`: *"Single-crate Rust changes … are incremental."* `/workspace/bun/scripts/build/rust.ts:9`: *"Cargo's own incremental compilation handles per-file tracking."*
- **Artifact isolation.** `/workspace/bun/src/install/windows-shim/Cargo.toml`: *"The crate is not `bun_install` itself: putting `[[bin]]` there would make the bin link the entire `bun_install` lib (50+ crates)."*

There **is** acknowledgment that crate-level parallelism is relevant, but as a *problem*, not a design goal — `/workspace/bun/scripts/build/rust.ts:423-434`:
> *"rustc's default is single-threaded for parse / macro expansion / typeck / borrowck, so the critical-path crate (`bun_runtime`) sits on one core while the rest idle."*

That comment is the rationale for passing `-Zthreads=8` (parallel frontend) in local builds, i.e. the split *doesn't* give enough parallelism on its own because `bun_runtime` is still the long pole.

## (2) codegen-units / lto settings

From `/workspace/bun/Cargo.toml` `[profile]` sections:

| profile | lto | codegen-units | other |
|---|---|---|---|
| `release` | `"fat"` | `1` | `panic = "abort"`, `debug = "line-tables-only"` |
| `dev` | (default = off) | (default = 256) | `panic = "abort"`, incremental default on |
| `release-dev` | `"thin"` | `16` | inherits release |
| `release-profiling` | inherits release (`"fat"`, 1) | | |
| `shim` | `true` | `1` | `opt-level = "z"`, `strip = "symbols"` |

Runtime **env overrides** in `/workspace/bun/scripts/build/rust.ts:716-763`:
- `cfg.crossLangLto` (the shipped CI release): `CARGO_PROFILE_RELEASE_LTO = "off"` on darwin/windows (per-CGU ThinLTO bitcode for the lld ThinLTO link), `"fat"` on ELF (rustc pre-merges into one module, then `rust_lto_fix` bolts on a regular-LTO summary).
- `cfg.asan`: `CARGO_PROFILE_RELEASE_LTO = "off"` (see L746-752).
- `cfg.assertions`: `CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS = "true"`.

No `CARGO_INCREMENTAL` / `incremental = …` override anywhere (grep: `/workspace/bun/scripts/build/`, `/workspace/bun/Cargo.toml`, `/workspace/bun/.cargo/config.toml` — none). Dev uses cargo's default incremental; release uses cargo's default non-incremental.

Rationale comment at `/workspace/bun/Cargo.toml:114-119`:
> *"Zig's release build is one compilation unit with whole-program optimization. Cargo's defaults (lto=false, codegen-units=16) leave us at ~105 crates × 16 CGUs ≈ 1680 separately-optimized units with NO cross-crate inlining beyond `#[inline]`-annotated leaf fns. `lto = "fat"` + `codegen-units = 1` collapses the whole Rust crate graph into one LLVM module, matching Zig's shape."*

## (3) Would merging into ~20 crates hurt cold-build parallelism, or does LTO already serialize?

**Release (the shipped binary): LTO already serializes.**
- ELF release: `lto = "fat"` + `codegen-units = 1` → rustc merges every crate into one LLVM module and codegens serially. Explicitly stated at `/workspace/bun/scripts/build/rust.ts:746-752`: *"rustc merges every crate into one module and codegens it serially … That's the 15-min cargo step."* The crate count is irrelevant to release backend parallelism; only the frontend pipeline (parse/typeck) still fans out over crates, and that is a minority of release build time.
- darwin/windows release: `CARGO_PROFILE_RELEASE_LTO = "off"` so each crate produces `codegen-units = 1` of bitcode, and the parallel ThinLTO backend runs at the *final lld link*, not cargo. Merging crates just produces fewer, larger bitcode modules; lld's ThinLTO threadpool still parallelizes.

So for release cold-build, merging ~100→~20 would cost essentially nothing on the backend and would lengthen the frontend critical path somewhat — but release is dominated by the serial fat-LTO codegen / link either way.

**Debug cold-build: it would hurt, partially mitigated by `-Zthreads=8`.**
- `[profile.dev]` has no LTO, default `codegen-units = 256`, incremental on. The backend is already massively parallel per-crate via CGUs; the constraint is the *frontend*, which is one rustc process per crate scheduled by cargo's DAG. The `-Zthreads=8` comment (rust.ts:423-438) says the current split already leaves cores idle waiting on `bun_runtime`, and that the parallel frontend "roughly halves" that long pole. Merging into 20 crates would shorten the DAG width (fewer concurrent rustcs), lengthen individual frontend phases, and increase the incremental-rebuild blast radius (the documented benefit in CONTRIBUTING.md). `-Zthreads=8` recovers some of that — *"returns flatten past ~8 (the query DAG has its own serial spine)"* — but not all.

Net: merging primarily costs debug cold build + incremental scope; release is already serialized by fat LTO.

## (4) Cargo features that depend on crate boundaries

Very few; most conditional compilation is done via global `--cfg` RUSTFLAGS (`bun_asan`, `bun_debug`, `bun_codegen_embed`, `socket_fault_injection` — see rust.ts:470-512 and Cargo.toml:188), which are crate-boundary-independent.

Cargo `[features]` in workspace crates (exhaustive grep of `src/*/Cargo.toml`):

| crate | feature | boundary-dependent? |
|---|---|---|
| `bun_crash_handler` | `show_crash_trace` | forwarded to by `bun_bundler`, `bun_runtime` |
| `bun_bundler` | `show_crash_trace = ["bun_crash_handler/show_crash_trace"]`, `debug_logs` | yes — forwarding chain |
| `bun_runtime` | `show_crash_trace = ["bun_bundler/show_crash_trace"]`, `error_return_tracing`, `bake_debugging_features` | yes — forwarding chain |
| `bun_output` | `debug_logs` | independent |
| `bun_resolver` | `debug_logs` | independent |
| `bun_react_compiler` | `fixtures` | independent |
| `bun_install` | `shim_standalone` (declared but never enabled — only so `unexpected_cfgs` passes when it `mod`s the shared source file) | yes — exists specifically because the same source file compiles in two crates |
| `bun_shim_impl` (`src/install/windows-shim/`) | `shim_standalone` + `required-features = ["shim_standalone"]` on the `[[bin]]` | yes — gates the standalone PE build |

The only non-trivial inter-crate feature wiring is the `show_crash_trace` forwarding chain (`bun_runtime` → `bun_bundler` → `bun_crash_handler`) and the `shim_standalone` dual-compilation arrangement. None of these are load-bearing for the shipped binary (rust.ts never passes `--features` to the main `cargo build -p bun_bin`; only the shim build gets `--features shim_standalone` at rust.ts:796-797). Merging crates would collapse the forwarding chain to a single feature and would require re-thinking the shim dual-compile, but nothing else.

---

## Files cited

- `/workspace/bun/scripts/build/rust.ts` — cargo invocation, rustflags, env LTO overrides, `-Zthreads=8` rationale (L423-441), ASAN-serialization note (L746-752), shim build (L777-876)
- `/workspace/bun/Cargo.toml` — `[profile.*]` (L114-177), `~105 crates × 16 CGUs` comment (L114-119), `unexpected_cfgs` registration (L188)
- `/workspace/bun/.cargo/config.toml` — generated, linker/rustflags only, no codegen-units/lto/incremental
- `/workspace/bun/scripts/build/cargo-config.ts` — confirms `.cargo/config.toml` is advisory (env overrides win)
- `/workspace/bun/scripts/build/profiles.ts` — which build profiles map to cargo `dev`/`release`
- `/workspace/bun/CONTRIBUTING.md:188-195` — incremental-rebuild rationale
- `/workspace/bun/src/dispatch/lib.rs` — cycle-breaking rationale
- `/workspace/bun/src/opaque/Cargo.toml` — "lowest-tier leaf" rationale
- `/workspace/bun/src/install/windows-shim/Cargo.toml` — separate-crate rationale, `shim_standalone`
- `/workspace/bun/src/install/Cargo.toml`, `/workspace/bun/src/bundler/Cargo.toml`, `/workspace/bun/src/runtime/Cargo.toml`, `/workspace/bun/src/crash_handler/Cargo.toml`, `/workspace/bun/src/output/Cargo.toml`, `/workspace/bun/src/resolver/Cargo.toml`, `/workspace/bun/src/react_compiler/Cargo.toml` — `[features]` sections
