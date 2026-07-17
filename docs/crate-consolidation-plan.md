# Rust Crate Consolidation Plan

This document is the complete, reviewed plan for collapsing Bun's Rust workspace from 98 crates to 22, eliminating the layering workarounds that accumulated during the Zig-to-Rust port. It is written to be executed in one PR by a reader with no prior context.

## Executive summary

|                                                                      | Before         | After                                  |
| -------------------------------------------------------------------- | -------------- | -------------------------------------- |
| Workspace crates                                                     | 98             | 22                                     |
| `extern "Rust"` symbols                                              | 36 (20 blocks) | 0                                      |
| `link_interface!` sites                                              | 10             | 2 (folded into `bun_macros`, see §4)   |
| `*_jsc` split crates                                                 | 11             | 0                                      |
| `*_types` split crates                                               | 3              | 0                                      |
| Facade/re-export crates                                              | 3              | 0                                      |
| Manual hook vtables (`RuntimeHooks`/`LoaderHooks`/`SqlRuntimeHooks`) | 3              | 0                                      |
| `PORTING.md` comment refs                                            | 396            | 1 (the external BoringSSL URL; see §5) |
| `LAYERING:` comment refs                                             | 92             | 0                                      |
| Net LOC deleted                                                      | —              | ~10,000 (see §6 for honest accounting) |
| LOC relocated                                                        | —              | ~440,000                               |

**Load-bearing change:** `bun_jsc` is split. The pure JSC FFI bindings (~17k LOC: `JSValue`, `JSGlobalObject`, `Strong`, `Weak`, `host_fn`, `array_buffer`, etc.) stay as `bun_jsc` and depend on nothing above `bun_core`/`bun_sys`/`bun_ast`. The runtime machinery (~37k LOC: `VirtualMachine`, `ModuleLoader`, `ConsoleObject`, `event_loop`, `ipc`, `web_worker`, `hot_reloader`, `rare_data`) moves into `bun_runtime`. This inverts the graph so that `VirtualMachine` can hold a `Transpiler`, `PackageManager`, and `ServerEntryPoint` as real typed fields instead of `*mut c_void` + function-pointer hook tables.

**What this plan does not do** (with evidence in §4): it does not eliminate every `dyn`, every vtable, or every cross-crate dispatch mechanism. Four dispatch sites are kept because converting them would introduce unsoundness (Stacked Borrows violations), wrong ownership semantics, or lose C-ABI compatibility. The `bun_dispatch` crate is not deleted; it is folded into `bun_macros` and used at 2 remaining sites instead of 10. The −100,000 LOC target is not achievable through relayering alone; the honest figure is ~10k deleted (see §6).

---

## 1. Target crate layout

22 crates in 7 tiers. Topological order (every crate depends only on crates above it in this list):

### Tier 0: `#![no_std]` leaves (cannot merge up; see §4.1)

| Crate             | Absorbs     | LOC   | Depends on |
| ----------------- | ----------- | ----- | ---------- |
| `bun_opaque`      | (unchanged) | 430   | —          |
| `bun_windows_sys` | (unchanged) | 1,900 | —          |
| `bun_output_tags` | (unchanged) | 100   | —          |

### Tier 1: proc-macro

| Crate        | Absorbs                                                                                  | LOC   | Depends on        |
| ------------ | ---------------------------------------------------------------------------------------- | ----- | ----------------- |
| `bun_macros` | `bun_core_macros`, `bun_clap_macros`, `bun_jsc_macros`, `bun_css_derive`, `bun_dispatch` | 4,400 | `bun_output_tags` |

### Tier 2: foundation

| Crate      | Absorbs                                                                                                                                                                                                                                                                                                                                     | LOC     | Depends on                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `bun_core` | `bun_alloc`, `bun_mimalloc_sys`, `bun_simdutf_sys`, `bun_wyhash`, `bun_highway`, `bun_hash`, `bun_core`, `bun_ptr`, `bun_safety`, `bun_output`, `bun_collections`, `bun_base64`, `bun_errno`, `bun_paths`, `bun_libuv_sys`, `bun_url`, `bun_semver`, `bun_http_types`, `bun_analytics`, `bun_picohttp`, `bun_valkey`, **`src/io/write.rs`** | ~86,000 | `bun_opaque`, `bun_windows_sys`, `bun_output_tags`, `bun_macros` |
| `bun_sys`  | `bun_sys`, `bun_which`, `bun_perf`, `bun_platform`, `bun_threading`, `bun_spawn_sys`, `bun_glob`, `bun_watcher`, `bun_libarchive`, `bun_zlib`, `bun_zlib_sys`, `bun_zstd`, `bun_brotli`, `bun_brotli_sys`, `bun_libdeflate_sys`, `bun_tcc_sys`, `bun_cares_sys`, `bun_dns`, `bun_crash_handler`                                             | ~49,000 | `bun_core`, `bun_opaque`, `bun_windows_sys`                      |

### Tier 3: domain (all compile in parallel after `bun_sys`)

| Crate        | Absorbs                                                                                                                                                                                   | LOC     | Depends on                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------ |
| `bun_crypto` | `bun_boringssl_sys`, `bun_boringssl`, `bun_sha_hmac`, `bun_csrf`, `bun_s3_signing`, `bun_exe_format`                                                                                      | ~6,700  | `bun_core`, `bun_sys`                                        |
| `bun_ast`    | `bun_ast`, `bun_parsers`, `bun_sourcemap`, `bun_dotenv`, `bun_options_types`, `bun_install_types`, `bun_resolve_builtins`, `bun_shell_parser`, `bun_md`, `bun_clap`, `bun_api`, `bun_ini` | ~73,000 | `bun_core`, `bun_sys`, `bun_macros`                          |
| `bun_jsc`    | (group-A half of current `bun_jsc`; see §2.1 for the per-file table)                                                                                                                      | ~18,000 | `bun_core`, `bun_sys`, `bun_crypto`, `bun_ast`, `bun_macros` |
| `bun_uws`    | `bun_uws_sys`, `bun_uws`                                                                                                                                                                  | ~11,100 | `bun_core`, `bun_sys`, `bun_crypto`, `bun_macros`            |

### Tier 4: engine (fan-out after tier 3)

| Crate                | Absorbs                                                                 | LOC     | Depends on                                                |
| -------------------- | ----------------------------------------------------------------------- | ------- | --------------------------------------------------------- |
| `bun_react_compiler` | (unchanged)                                                             | 63,000  | `bun_core`, `bun_ast`                                     |
| `bun_css`            | (unchanged)                                                             | 72,000  | `bun_core`, `bun_sys`, `bun_ast`, `bun_macros`            |
| `bun_loop`           | `bun_io` (minus `write.rs`), `bun_event_loop`, `bun_spawn`, `bun_patch` | ~22,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_uws`, `bun_macros` |
| `bun_sql`            | `bun_sql`                                                               | 6,000   | `bun_core`, `bun_sys`, `bun_crypto`                       |
| `bun_js`             | `bun_js_parser`, `bun_js_printer`                                       | ~57,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_react_compiler`    |

### Tier 5: toolchain

| Crate          | Absorbs                                                 | LOC     | Depends on                                                                                                                        |
| -------------- | ------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `bun_resolver` | `bun_resolver`, `bun_router`                            | ~20,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_js`, `bun_jsc`                                                                             |
| `bun_http`     | `bun_http`                                              | ~18,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_crypto`, `bun_uws`, `bun_loop`                                                             |
| `bun_bundler`  | `bun_bundler`, `bun_transpiler`, `bun_standalone_graph` | ~50,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_crypto`, `bun_uws`, `bun_loop`, `bun_js`, `bun_css`, `bun_resolver`, `bun_jsc`, `bun_http` |
| `bun_install`  | `bun_install`, `bun_bunfig`                             | ~82,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_crypto`, `bun_uws`, `bun_loop`, `bun_js`, `bun_resolver`, `bun_http`, `bun_bundler`        |

### Tier 6: top

| Crate           | Absorbs                                                    | LOC      | Depends on                                           |
| --------------- | ---------------------------------------------------------- | -------- | ---------------------------------------------------- |
| `bun_runtime`   | `bun_runtime`, group-B of `bun_jsc`, all 11 `*_jsc` crates | ~392,000 | (all of the above except `bun_bin`, `bun_shim_impl`) |
| `bun_bin`       | (unchanged)                                                | 260      | `bun_core`, `bun_sys`, `bun_loop`, `bun_runtime`     |
| `bun_shim_impl` | (unchanged, separate binary)                               | 400      | `bun_opaque`, `bun_windows_sys`                      |

**DAG proof:** Every `Depends on` cell references only crates listed earlier in the table (strictly lower tier, or same tier but earlier row). Intra-tier edges: tier 3 `bun_jsc→{bun_crypto,bun_ast}`, `bun_uws→bun_crypto`; tier 4 `bun_js→bun_react_compiler`; tier 5 `bun_bundler→{bun_resolver,bun_http}`, `bun_install→{bun_resolver,bun_http,bun_bundler}`. None has a reverse edge. `cargo metadata` will reject any cycle at step 13 of the migration; the adversarial review in §7 verified every edge against current imports.

---

## 2. Per-crate detail

### 2.1 `bun_jsc` — the load-bearing split

Today `bun_jsc` (54,148 LOC) depends on `bun_install`, `bun_bundler`, `bun_http`, `bun_resolver`, `bun_spawn`, `bun_transpiler`, `bun_patch` because `VirtualMachine` holds instances of those crates' types. After the split, `bun_jsc` is the pure FFI layer and `VirtualMachine` lives in `bun_runtime`.

**Group A (stays in `bun_jsc`, ~18k LOC):** `AnyPromise`, `BunCPUProfiler`, `BunHeapProfiler`, `CallFrame`, `CommonAbortReason`, `CommonStrings`, `Counters`, `CustomGetterSetter`, `DOMFormData`, `DOMURL`, `DecodedJSValue`, `DeferredError`, `DeprecatedStrong`, `ErrorCode`, `Errorable`, `EventType`, `Exception`, `FFI`, `GetterSetter`, `JSArray`, `JSArrayIterator`, `JSBigInt`, `JSCell`, `JSErrorCode`, `JSFunction`, `JSMap`, `JSModuleLoader`, `JSONLineBuffer`, `JSObject`, `JSPromise`, `JSPromiseRejectionOperation`, `JSPropertyIterator`, `JSRef`, `JSRuntimeType`, `JSSecrets`, `JSString`, `JSType`, `JSUint8Array`, `JSValue`, `MarkedArgumentBuffer`, `RefString`, `RegularExpression`, `ResolvedSource`, `ScriptExecutionStatus`, `SourceProvider`, `SourceType`, `StringBuilder`, `Strong`, `TextCodec`, `TopExceptionScope`, `URL`, `URLSearchParams`, `VM`, `WTF`, `Weak`, `ZigErrorType`, `ZigException`, `ZigStackFrame`, `ZigStackFrameCode`, `ZigStackFramePosition`, `ZigStackTrace`, `ZigString`, `array_buffer`, `bindgen`, `bindgen_test`, `bindings/GeneratedBindings`, `bun_string_jsc`, `codegen`, `comptime_string_map_jsc`, `cpp`, `fmt_jsc`, `generated`, `host_fn`, `host_object`, `jsc_abi`, `node_path`, `resolve_path_jsc`, `resolver_jsc`, `sizes`, `build.rs`.

Plus, after edits carving group-B references out (Step 6.2/6.7): `JSGlobalObject` (delete the `pub use bun_bundler::transpiler::BunPluginTarget` re-export; move `run_on_load_plugins`/`run_on_resolve_plugins`/`throw_invalid_scrypt_params` and the 5 `bun_vm*()` accessors + `ScriptExecutionContextIdentifier::bun_vm` to a `JSGlobalObjectExt` trait in `bun_runtime`; relocate `create()` + the 2 `#[no_mangle] extern "C" Zig__GlobalObject__{resolve,reportUncaughtException}` C-ABI fns to group-B `virtual_machine_exports.rs`), `CachedBytecode` (keep; `Format` comes from `bun_ast` which is now a dep; the `IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE` thread-local moves here from `VirtualMachine.rs:473` in Step 6.2, and `jsc::initialize()` stays here since both touch only WTF/VM C FFI), `uuid` (v4 uses `bun_core::os_entropy` per Step 1.4; `UUID5::init` at `:241` needs `bun_crypto::SHA1`, so `bun_jsc` gains a `bun_crypto` dep at Step 6.5, a forward tier-3 edge), `webcore_types` (move the `S3` sub-struct block at L823-892 to `bun_runtime::webcore::blob`; rest stays), `BuildMessage`/`ResolveMessage` (stay; use `bun_ast::Msg`; rewrite `bun_resolver::is_package_path` → `bun_core::is_package_path` at `ResolveMessage.rs:160,204`, it is a pure re-export of `bun_paths::is_package_path` which folds into `bun_core` at Step 3), `error` (stays as the shrunk `CrateError` per Step 6.3; group-A `BunHeapProfiler.rs`/`ResolveMessage.rs`/`lib.rs:724-744` depend on `crate::CrateError`; `bun_runtime` defines its own wide error at Step 7.6).

**Group B (moves to `bun_runtime`, ~37k LOC; becomes `src/runtime/vm/`):** `VirtualMachine`, `ModuleLoader`, `AsyncModule`, `ConsoleObject`, `Debugger`, `event_loop`, `hot_reloader`, `ipc`, `rare_data`, `web_worker`, `RuntimeTranspilerStore`, `RuntimeTranspilerCache`, `virtual_machine_exports`, `btjs`, `HTTPServerAgent`, `GarbageCollectionController`, `NodeModuleModule`, `PluginRunner`, `PosixSignalHandle`, `ProcessAutoKiller`, `SavedSourceMap`, `WorkTask`, `ConcurrentPromiseTask`, `CppTask`, `JSCScheduler`, `Task`, `EventLoopHandle`, `any_task_job`, `AbortSignal` (embeds `EventLoopTimer` by value and calls `VirtualMachine::timer_insert`), `FetchHeaders` (the `to_uws_response` helper only; the opaque handle + getters stay in group A as `FetchHeadersCore`), `SystemError` (the `us_bun_verify_error_t` helper only), `arguments_slice` (split from `CallFrame.rs` at Step 6.2), `lib.rs` runtime-glue half.

**No migration needed:** `generated_classes_list.rs` is already `#[path]`-mounted from `src/runtime/lib.rs:51` (not from `src/jsc/lib.rs`) precisely because every alias is a `bun_runtime` module path; it stays where it is.

**What this unlocks:** `bun_bundler` can now depend on `bun_jsc` directly (for `CachedBytecode::generate`), and `bun_runtime` can have `VirtualMachine { transpiler: Transpiler, package_manager: Option<Box<PackageManager>>, entry_point: ServerEntryPoint, timer: timer::All, … }` with real types.

### 2.2 `bun_core` — the foundation merge

Absorbs 21 crates into one ~86k LOC foundation. The two former `link_interface!` sites declared in `bun_core` are addressed here: one dissolves (its impl is now in-crate), the other is replaced by a `OnceLock` registration:

- `ErrnoNames[Sys]` (`src/bun_core/lib.rs:610`): delete. `bun_errno` is now `bun_core::errno`; callers use `crate::errno::SystemErrno::name()` directly.
- `OutputSink[Sys]` (`src/bun_core/lib.rs:584`): does NOT dissolve (the impl is in `bun_sys`). Replaced by `pub static OUTPUT_SINK: OnceLock<OutputSinkVTable> = OnceLock::new();` where `OutputSinkVTable` is a plain `struct { stderr: fn()->File, is_terminal: fn(Fd)->bool, … }`. `bun_sys` calls `bun_core::OUTPUT_SINK.set(…)` in its crate-init. This is a cold-path 11-slot table called once per output stream; a `OnceLock<struct of fn>` is the idiomatic single-registration pattern (`tracing`, `log` crates use the same shape).

`src/io/write.rs` (~470 LOC: `FmtAdapter`, `FixedBufferStream`, `BufWriter`, `DiscardingWriter`, `AsFmt`) moves here as `bun_core::io`. This is a prerequisite for `bun_sys`/`bun_ast`/`bun_css`/`bun_js` not needing `bun_loop` (see §7 objection 2/7/13).

`bun_analytics` is absorbed; its declared-but-dead `bun_sys` Cargo dependency is deleted first (0 code references; see `src/analytics/Cargo.toml:23`).

`__bun_crash_handler_out_of_memory` / `__bun_crash_handler_dump_stack_trace`: replaced by `pub static PANIC_HOOK: AtomicUsize` and `pub static STACK_TRACE_HOOK: AtomicUsize` holding the fn-pointer cast to `usize` (not `AtomicPtr<()>`, which would assume fn-ptr and data-ptr share representation). `bun_core` ships a minimal default (print + `libc::abort`); `bun_sys::crash_handler` upgrades them at init. Std idiom (this is how `std::alloc::set_alloc_error_hook` works).

### 2.3 `bun_sys` — OS layer

`bun_crash_handler` folds in. Its current `bun_ast`/`bun_options_types` deps are severed: the one `ImportKind` use at `crash_handler/lib.rs` passes `kind.label()` as `&[u8]` instead; the `options_types` use was for the feature-gated `Action` formatter, which becomes `pub static ACTION_FORMATTER: OnceLock<fn(&mut dyn core::fmt::Write, ActionTag, *const ())>` set by `bun_bundler` (replacing `link_interface! BundleGenerateChunkCtx`). `bun_io` dep is severed by the `write.rs→bun_core` move.

`bun_cares_sys` + `bun_dns` fold in here, not `bun_crypto`: `bun_dns` (531 LOC) is `addrinfo` types and address formatting, not async I/O; the async c-ares driver is already in `bun_runtime::dns_jsc`. `bun_crypto::boringssl` reaches c-ares via `bun_sys::cares` (it already depends on `bun_sys`).

`bun_exe_format` does **not** go here (would create `sys→crypto→sys` cycle via `macho.rs:814` SHA256 call). It goes to `bun_crypto` instead; its only consumer (`standalone_graph`, now in `bun_bundler`) is above `bun_crypto`.

Features: `[features] show_crash_trace = []` declared here; `bun_bundler` and `bun_runtime` forward to it.

### 2.4 `bun_ast` — vocabulary & non-JS parsers

Absorbs `options_types`, `install_types`, `parsers`, `sourcemap`, `dotenv`, `resolve_builtins`, `shell_parser`, `md`, `clap`, `api`, `ini`. This is the "everything above can name `Expr`/`Log`/`Loader`/`Dependency`/`BunInstall`/`Format`/`Msg`" tier.

`PnpmMatcher` **stays here** (it is a field of `schema::api::BunInstall`, which `bun_resolver` and `bun_bundler` name by value). The `__bun_regex_*` shim is replaced by `pub static REGEX_ENGINE: OnceLock<RegexEngineVTable>` (`compile`/`matches`/`drop` fn pointers). The consumer (`create_matcher`, `NodeLinker.rs:373`) is reached on `bun install` via `.npmrc` `hoist-pattern=` and `bunfig.toml` `hoistPattern` parsing, which never calls `jsc::initialize`, so `REGEX_ENGINE` is set at process init from `bun_bin::main` (via `bun_runtime::register_dispatch_tables()`, alongside `POLL_DISPATCH`); the `YARR.compile` body keeps the lazy `bun_jsc::initialize(false)` call so WTF is still bootstrapped on first use. Same `OnceLock<struct of fn>` pattern as `OUTPUT_SINK`.

`BunPluginTarget` (3-variant enum) moves here from `bun_bundler::transpiler` so `bun_jsc::JSGlobalObject` no longer needs to import from bundler.

`TranspilerCacheImpl` link_interface (`src/ast/transpiler_cache.rs:52`) is replaced by `pub trait TranspilerCache: Sync { fn get(…)->bool; fn put(…); }` and `parser::Options.runtime_transpiler_cache: Option<&'static dyn TranspilerCache>`. Single impl in `bun_runtime`; the trait has no associated consts so it is object-safe. The `parser_options: NonNull<()>` erasure at `transpiler_cache.rs:67` stays because `bun_ast < bun_js` and the field is `js_parser::Options`; this is noted as an accepted cost in §4.

### 2.5 `bun_loop` — event loop layer

Absorbs `bun_io` (minus `write.rs`), `bun_event_loop`, `bun_spawn`, `bun_patch`. Depends on `bun_ast` (for `dotenv::Loader` return types in `JsEventLoop::env()`, see §7 objection 8).

`EventLoopCtx` becomes `#[derive(Clone, Copy)] enum EventLoopCtx { Mini(NonNull<MiniEventLoop>), Js(NonNull<()>) }` (both arms are pointers; 16 bytes, `Copy`, matches current layout). The `Js` arm's methods route through `pub static JS_LOOP_VTABLE: OnceLock<JsLoopVTable>` (a 21-slot struct of fn pointers matching the current `JsEventLoop` interface) that `bun_runtime` fills at VM init. This replaces `link_interface! EventLoopCtx` + `link_interface! JsEventLoop` + 8 `__bun_spawn_sync_*` externs + `__bun_js_event_loop_current` + `__bun_js_vm_get` + `__bun_stdio_blob_store_new` + `__bun_get_vm_ctx` with one registered vtable.

`BufferedReaderParentLink` and `ProcessExit` **stay as `link_interface!`** (macro now in `bun_macros`). See §4.2 for why these cannot become `dyn Trait`.

`__bun_fire_timer` / `__bun_js_timer_epoch` / `__bun_run_file_poll` / `__bun_io_pollable_on_*`: these dispatch on tag enums whose variants name `bun_runtime` types. They become `pub static TIMER_DISPATCH: OnceLock<fn(tag, *mut (), Timespec, *mut ()) -> TimerResult>` etc., set by `bun_runtime::register_dispatch_tables()` called from `bun_bin::main()` **before CLI dispatch** (not at VM init: `bun install` runs `FilePoll`/`MiniEventLoop` with no VM for lifecycle-script pipes, so `POLL_DISPATCH` must be set process-wide). The 96-arm `Task` match stays where it is (in `bun_runtime`); only the 4 `#[no_mangle]`/`extern "Rust"` pairs become `OnceLock<fn>` registrations.

### 2.6 `bun_bundler`

Absorbs `bun_transpiler` (pure re-export, 10 LOC) and `bun_standalone_graph`. Now depends on `bun_jsc` directly: `__bun_jsc_generate_cached_bytecode` becomes a direct call to `bun_jsc::CachedBytecode::generate(format, source, url)`.

`DevServerHandle` and `VmLoaderCtx` link_interfaces (`src/bundler/lib.rs:338,364`) are replaced by `Option<&'static dyn DevServerHooks>` / `Option<&'static dyn VmLoaderHooks>` traits defined here with impls in `bun_runtime`. Both are single-variant, object-safe (no associated consts, no `Self` in return position), called on cold paths (dev-server lifecycle, virtual-module resolution). This is idiomatic `dyn` for an optional upward capability.

`__bun_jsc_enable_hot_module_reloading_for_bundler` becomes `pub static HOT_RELOAD_HOOK: OnceLock<fn(NonNull<BundleV2<'static>>)>` set by `bun_runtime` (the impl, `hot_reloader`, is in group B).

### 2.7 `bun_install`

Absorbs `bun_bunfig`. Declares `[features] shim_standalone = []` for the `#[path]`-mounted shim source. The `create_matcher`/`PnpmMatcher` regex path stays routed through `bun_ast::REGEX_ENGINE` (§2.4); `bun_install` does not call `bun_jsc::RegularExpression` directly and has no direct `bun_jsc` dep (it reaches `bun_jsc` transitively via `bun_bundler`/`bun_resolver`).

`__bun_resolver_init_package_manager` is deleted. Control inverts: `bun_install` constructs its `PackageManager`, then hands `Some(&*pm as &dyn AutoInstaller)` to the `Resolver`. The `dyn AutoInstaller` trait (defined in `bun_ast::resolver_hooks`) stays; it is a legitimate optional-capability trait object with one impl, and the alternative (making `Resolver<A: AutoInstaller>` generic) would monomorphize 17k LOC twice.

### 2.8 `bun_runtime`

Grows from ~331k to ~392k LOC. Absorbs:

- Group B of `bun_jsc` → `src/runtime/vm/`
- All 11 `*_jsc` crates → modules (`src/runtime/{sql,http_ws,css_jsc,…}/`); `sql_jsc` is 15k LOC of real driver code, not glue, and becomes `src/runtime/sql/`

(`SpawnSyncEventLoop` does **not** move here; it stays in `bun_loop` via `event_loop/lib.rs` and reaches its group-B definers through the 8 `JS_LOOP_VTABLE` slots, per §2.5/§3.1/Step 7.3.)

`jsc_hooks.rs` is renamed `src/runtime/vm/init.rs`. The `RuntimeHooks`/`LoaderHooks` structs delete; their ~25+4 slot bodies become `impl VirtualMachine { … }` methods. `RuntimeState` fields (`timer`, `sql_rare`, `ssl_ctx_cache`, `editor_context`, `global_dns_data`, `body_value_pool`) become direct `VirtualMachine` fields.

`runtime/dispatch.rs` is renamed `src/runtime/task_dispatch.rs` and **kept**. Its 96-arm `Task` match, 24-arm `EventLoopTimer` match, 15-arm `FilePoll` match stay as-is (see §4.3). Only the `#[no_mangle]` attributes delete; the functions are registered into `bun_loop`'s `OnceLock`s via `register_dispatch_tables()` at process init (called from `bun_bin::main` before CLI dispatch, since `bun install` reaches the `FilePoll` match on Mini with no VM). `runtime/dispatch_js2native.rs` stays untouched (it is the `$rust()` landing pad, unrelated to the hooks file).

`hw_exports.rs` deletes its `__BUN_SQL_RUNTIME_HOOKS` block (~110 LOC); `sql_jsc` is now same-crate and names `timer::All`/`SSLConfig`/`Blob` directly.

### 2.9 Crates kept unchanged and why

- `bun_react_compiler`: kept separate solely for `[profile.release.package.bun_react_compiler] opt-level = "s"` (Cargo per-package overrides require a distinct package). `&dyn Host` stays (single impl, keeps mono count at 1 which is what makes the size override effective).
- `bun_css`: kept separate for build parallelism (72k LOC compiling alongside `react_compiler`+`bun_js`).
- `bun_sql`: kept separate so the 6k of protocol parsers compile parallel with `bun_js`/`bun_css`; its only consumer is `bun_runtime`.

---

## 3. Workaround elimination ledger

Every `extern "Rust"` symbol, `link_interface!`, and manual hook vtable, with its disposition.

### 3.1 Hand-written `extern "Rust"` (36 symbols, 20 blocks) → 0

| Symbol(s)                                                                                                                                            | Declarer → Definer (today)          | Disposition                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| `__bun_crash_handler_out_of_memory`                                                                                                                  | `bun_alloc` → `crash_handler`       | `bun_core::PANIC_HOOK: AtomicUsize`, upgraded by `bun_sys`                         |
| `__bun_crash_handler_dump_stack_trace`                                                                                                               | `bun_core` → `crash_handler`        | `bun_core::STACK_TRACE_HOOK: AtomicUsize`                                          |
| `__bun_regex_{compile,matches,drop}`                                                                                                                 | `install_types` → `bun_jsc`         | `bun_ast::REGEX_ENGINE: OnceLock<RegexEngineVTable>`, set at process init          |
| `__bun_resolver_init_package_manager`                                                                                                                | `resolver` → `install`              | Deleted; `install` constructs PM and passes `&dyn AutoInstaller` to resolver       |
| `__bun_dns_prefetch`                                                                                                                                 | `dns` → `runtime`                   | `bun_sys::dns::PREFETCH_HOOK: OnceLock<fn(*mut c_void, *const u8, usize, u16)>`    |
| `__bun_macro_context_{init,deinit,call,get_remap}`                                                                                                   | `js_parser` → `js_parser_jsc`       | `bun_js::MacroContext` holds `Option<Box<dyn MacroRunner>>`; impl in `bun_runtime` |
| `__bun_macro_collect_vm_garbage`                                                                                                                     | `js_parser` → `js_parser_jsc`       | `bun_js::MACRO_GC_HOOK: OnceLock<fn()>`, set at process init                       |
| `__bun_jsc_generate_cached_bytecode`                                                                                                                 | `bundler` → `bun_jsc`               | Direct call: `bun_jsc::CachedBytecode::generate(…)` (bundler now depends on jsc)   |
| `__bun_jsc_enable_hot_module_reloading_for_bundler`                                                                                                  | `bundler` → `bun_jsc` (group B)     | `bun_bundler::HOT_RELOAD_HOOK: OnceLock<fn(…)>`                                    |
| `__bun_get_vm_ctx`, `__bun_js_vm_get`, `__bun_js_event_loop_current`, 8×`__bun_spawn_sync_*`, `__bun_stdio_blob_store_new`                           | `io`/`event_loop` → `jsc`/`runtime` | All covered by `bun_loop::JS_LOOP_VTABLE: OnceLock<JsLoopVTable>`                  |
| `__bun_stdio_blob_store_deinit`                                                                                                                      | `bun_jsc` (group B `rare_data`) → `runtime` | Same-crate after split: direct call in `bun_runtime::vm::rare_data`        |
| `__bun_run_file_poll`, `__bun_io_pollable_on_{ready,io_error}`                                                                                       | `io` → `runtime`                    | `bun_loop::POLL_DISPATCH: OnceLock<PollDispatchVTable>`                            |
| `__bun_fire_timer`, `__bun_js_timer_epoch`                                                                                                           | `event_loop` → `runtime`            | `bun_loop::TIMER_DISPATCH: OnceLock<TimerDispatchVTable>`                          |
| `__bun_tick_queue_with_count`, `__bun_run_immediate_task`, `__bun_cancel_pending_immediate`, `__bun_run_wtf_timer`, `__bun_release_task_at_shutdown` | `bun_jsc` (group B) → `runtime`     | Same-crate after split: direct calls in `bun_runtime::vm::event_loop`              |
| `__BUN_RUNTIME_HOOKS`, `__BUN_LOADER_HOOKS`                                                                                                          | `bun_jsc` (group B) → `runtime`     | Deleted; bodies become `impl VirtualMachine`                                       |
| `__bun_blob_from_build_artifact`                                                                                                                     | `bun_jsc` (group B) → `runtime`     | Same-crate after split: direct call                                                |
| `__BUN_SQL_RUNTIME_HOOKS`                                                                                                                            | `sql_jsc` → `runtime`               | Same-crate after split: direct field access                                        |

**Result:** zero `extern "Rust"` blocks remain. The 36-symbol count (33 fns + 3 statics) is the declarer-side audit in `research-catalogs.md` §A; the table above is a disposition ledger and its rows expand to 41 names because some definer-side symbols (e.g. the 5 group-B `__bun_tick_queue_*`/`__bun_run_*` fns) share a declarer block with symbols counted elsewhere. The 36 are replaced by a mix of mechanisms; buckets here are by replacement kind, not a partition: same-crate direct calls/deletions after the split, `OnceLock` registrations, `AtomicUsize` hooks, and `dyn Trait`. Appendix B is the authoritative inventory of all 14 runtime-registered statics this plan introduces (10 `OnceLock` + 2 `AtomicUsize` + 2 `AtomicPtr` arrays).

### 3.2 `link_interface!` (10 sites) → 2

| Interface                        | Disposition                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `OutputSink[Sys]`                | → `bun_core::OUTPUT_SINK: OnceLock<OutputSinkVTable>`                         |
| `ErrnoNames[Sys]`                | → deleted (errno now in `bun_core`)                                           |
| `TranspilerCacheImpl[Jsc]`       | → `Option<&'static dyn TranspilerCache>`                                      |
| `JsEventLoop[Jsc]`               | → covered by `JS_LOOP_VTABLE`                                                 |
| `EventLoopCtx[Js,Mini]`          | → `enum { Mini(NonNull<MiniEventLoop>), Js(NonNull<()>) }` + `JS_LOOP_VTABLE` |
| `DevServerHandle[Bake]`          | → `Option<&'static dyn DevServerHooks>`                                       |
| `VmLoaderCtx[Runtime]`           | → `Option<&'static dyn VmLoaderHooks>`                                        |
| `BundleGenerateChunkCtx[Linker]` | → `bun_sys::crash_handler::ACTION_FORMATTER: OnceLock<fn(…)>`                 |
| `BufferedReaderParentLink[13]`   | **Kept** (see §4.2)                                                           |
| `ProcessExit[12]`                | **Kept** (see §4.2)                                                           |

The `bun_dispatch` proc-macro folds into `bun_macros` (not deleted) to serve the 2 remaining interfaces. Both are declared in `bun_loop` with impls in `bun_runtime`/`bun_install` (which `bun_loop` does not depend on), so a const `[&'static MethodTable; N]` in the declaring crate cannot name the impl statics without an `extern { static … }` forward-declare. The macro instead emits a runtime-registered array: in `bun_loop`, `static __VTABLES_<Iface>: [AtomicPtr<<Iface>MethodTable>; N]` initialized to null; in each impl crate, `link_impl_*!` emits a const `MethodTable` and a `pub fn register()` that stores its address into the tag's slot (`Relaxed`). `bun_runtime::register_dispatch_tables()` (already called from `bun_bin::main` for `POLL_DISPATCH`/`TIMER_DISPATCH`/`TASK_DISPATCH`; see Appendix B) calls every variant's `register()`. Dispatch is `__VTABLES[tag].load(Relaxed)` then indirect call: one relaxed load per callback, same as the other `bun_loop` hot-path hooks.

### 3.3 Manual vtables

| VTable                                                              | Disposition                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `RuntimeHooks` (`VirtualMachine.rs:1648`)                           | Deleted; fields/methods inline onto `VirtualMachine`                               |
| `LoaderHooks` (`ModuleLoader.rs:185`)                               | Deleted; same                                                                      |
| `SqlRuntimeHooks` (`sql_jsc/jsc.rs:208`)                            | Deleted; same                                                                      |
| `dyn SendQueueOwner` (`ipc.rs:866`)                                 | → `enum SendQueueOwner { Instance(…), Subprocess(…) }` (both in `bun_runtime` now) |
| `dyn HotReloadTaskView` (`hot_reloader.rs:336`)                     | Deleted; stays generic (all callers same-crate)                                    |
| `SourceMapHandler` (`js_printer/lib.rs:1206`)                       | → `Option<&mut dyn SourceMapSink>` (1 impl in bundler, 1 in runtime; object-safe)  |
| `RequireOrImportMetaCallback` (`js_printer/lib.rs:1432`)            | → `Option<&mut dyn RequireMetaResolver>`                                           |
| `webcore::Sink::VTable` (`Sink.rs:302`)                             | → `enum SinkKind` (8 variants, all in `bun_runtime::webcore`)                      |
| `webcore::streams::SignalVTable` (`streams.rs:983`)                 | → `enum SignalKind` (4 variants, all in `bun_runtime::webcore`)                    |
| `shell::OutputTaskVTable`, `MkdirVerboseVTable`, `RemoveFileVTable` | → enums (all impls in `bun_runtime::shell`)                                        |
| `AllocatorVTable` (`bun_alloc/lib.rs:69`)                           | **Kept** (see §4.4)                                                                |
| `uws_sys::socket_group::VTable`                                     | **Kept** (C ABI to uSockets)                                                       |
| `bio_method_st`                                                     | **Kept** (C ABI to BoringSSL)                                                      |
| `UpgradedDuplex__*`/`WindowsNamedPipe__*` externs                   | **Kept** (C ABI; see §4.5)                                                         |
| COM vtables in `backend_wic.rs`                                     | **Kept** (Windows ABI)                                                             |

### 3.4 `dyn Trait`

Kept (idiomatic, with justification):

- `&dyn react_compiler::Host` (1 impl, keeps 63k LOC at one mono for `opt-level="s"`)
- `&mut dyn bun_core::io::Write` (many impls; ConsoleObject is 6k LOC, would mono per sink)
- `&dyn AutoInstaller`, `&dyn PackageJsonView`, `&dyn StandaloneModuleGraph`, `&dyn PluginResolver`, `&dyn RendererImpl`, `&dyn SourceData` (single/few impls, lower-crate trait, upper-crate impl; the textbook use of `dyn`)
- `&mut dyn ResolverContextDyn`, `&mut dyn InsertionHandler`, `&mut dyn NpmAliasRegistry` (documented codegen-size suppression; `InsertionHandler`/`NpmAliasRegistry` could become enums but the win is <100 LOC)
- `dyn Fn`/`dyn FnMut`/`dyn fmt::Write` closures on cold paths

Removed/replaced: `dyn SendQueueOwner`, `dyn HotReloadTaskView` (both become same-crate).

---

## 4. What cannot be eliminated, and why

This section is the honest accounting of the gap between "remove all dyn/extern/vtables" and what is sound Rust.

### 4.1 The three `#![no_std]` leaves

`bun_opaque`, `bun_windows_sys`, `bun_output_tags` must stay as separate zero-dep crates because:

- `bun_shim_impl` is a freestanding Windows PE (no libc, no std, `panic = "abort"`, `opt-level = "z"`) that links **only** `bun_opaque` + `bun_windows_sys`. Merging either into `bun_core` would pull `bun_core`'s `#[no_mangle]` C exports and std into the shim, breaking the ~8KB binary size target (`src/install/windows-shim/Cargo.toml`, `scripts/build/rust.ts:793`).
- `bun_output_tags` is used by proc-macro crates (`bun_macros`) at build time. Proc-macros compile for the host and cannot depend on `bun_core` (which has `build.rs` codegen and target-specific cfg).

### 4.2 `BufferedReaderParentLink` / `ProcessExit` cannot become `dyn Trait`

**`BufferedReaderParentLink`** (`src/io/PipeReader.rs:52-91`): The parent type embeds `BufferedReader` as a field. Callbacks (`on_read_chunk`, `on_reader_done`) fire while the caller holds `&mut self.reader` on its stack. Forming `&self` on the parent at that moment aliases the live `&mut reader` through the parent, which is Stacked Borrows UB regardless of `UnsafeCell`. The trait therefore takes `*mut Self` (raw pointer, no aliasing assertion). A `*const dyn Trait` form would require `&self` methods, reintroducing the UB. The trait also has `const KIND` / `const HAS_ON_READ_CHUNK` associated constants, which are not object-safe. The alternative (heap-allocate the reader, back-pointer to parent) is a significant redesign touching 13 parent types across `runtime` and `install`.

**`ProcessExit`** (`src/spawn/process.rs:270-277`): The handler does not own `Process`; the handler's owner (e.g. `Subprocess`) owns `Process`. `Process.exit_handler` is `{kind: u8, owner: *mut ()}`, `Copy`, and the exit path does `let h = self.exit_handler; self.detach(); h.call(&mut self)`. `Box<dyn>` implies `Process` owns and drops the handler (wrong direction). `NonNull<dyn>` (non-owning fat pointer) would work but requires every `set_exit_handler` call site to coerce `*mut Concrete → *mut dyn`, and the handler trait methods take `*mut Self` for the same aliasing reason as above.

**Disposition:** Both keep the tagged-handle form via `link_interface!` (in `bun_macros`). The macro emits, in the declaring crate, `static __VTABLES: [AtomicPtr<MethodTable>; N]` (null-initialized); each `link_impl_*!` emits a const `MethodTable` (a `struct` of `unsafe fn(*mut (), …)` pointers) and a `register()` fn that stores its address into the slot. All slots are filled at process init from `bun_runtime::register_dispatch_tables()` (same call site as `POLL_DISPATCH`). Dispatch is `__VTABLES[tag as usize].load(Relaxed)` then indirect call. This keeps the `Copy` 16-byte handle and raw-pointer method signatures, with one relaxed load replacing the link-time symbol reference. Net: same safety contract, no `extern "Rust"`.

### 4.3 `Task` / `EventLoopTimer` / `FilePoll` dispatch stays a `match`

`runtime/dispatch.rs` has a 96-arm match over `TaskTag`. The arms are not uniform: some call `.run_from_js()`, some `.run_from_js(vm, global)`, some `.on_poll()`, some return `RunTaskResult::EarlyReturn`, ~50 destroy-after-run via `heap::destroy`. A `dyn Runnable` trait with one signature cannot express "some variants early-return from the drain loop" or "some variants are not even `task.ptr` but `vm.modules`". Additionally `Task` is a packed `{tag: u16, ptr: *mut ()}` that fits in a 64-bit word passed to C++ (`Bun__Task`); a fat `NonNull<dyn>` is 16 bytes and breaks the C ABI.

**Disposition:** The match stays in `bun_runtime::task_dispatch`. The `#[no_mangle]` attributes delete; the 4 functions (`tick_queue_with_count`, `fire_timer`, `run_file_poll`, `release_task_at_shutdown`) register into `bun_loop::{TASK,TIMER,POLL}_DISPATCH: OnceLock<…>` via `bun_runtime::register_dispatch_tables()` at process init (from `bun_bin::main`), not VM init, because `bun install` reaches `run_file_poll` on the `MiniEventLoop` path with no VM. This is not a LOC reduction; it is a mechanism change from link-time to init-time binding.

### 4.4 `AllocatorVTable` address-identity is load-bearing

`bun_alloc::StdAllocator { ptr, vtable: &'static AllocatorVTable }` uses the vtable **address** as the allocator identity tag: `MimallocArena::is_instance(a) → ptr::eq(a.vtable, &MIMALLOC_ARENA_VTABLE)`. `String::is_wtf_allocator` and `safety::alloc::assert_eq` depend on this. `dyn Allocator` would give each coercion site a distinct vtable instance (rustc does not guarantee vtable deduplication), breaking identity. The parallel `trait Allocator + dyn Allocator` at `bun_alloc/lib.rs:3497` is independent and used only for `Any`-style downcast in 4 places.

### 4.5 `UpgradedDuplex__*` / `WindowsNamedPipe__*` are C ABI, not Rust ABI

These 25 `extern "C"` symbols (`src/runtime/socket/UpgradedDuplex.rs`) back the 38 `match InternalSocket` sites in `uws_sys/socket.rs` for imperative ops (`write`, `flush`, `timeout`). `UpgradedDuplex` wraps a JS Duplex stream; it is not a real `us_socket_t`, so it cannot register through uSockets' C vtable. The shims are Rust→Rust but typed `extern "C"` because `InternalSocket` is passed through C++ uSockets code. Replacing with `dyn SocketTransport` would require a second Rust-side vtable threaded through every `NewSocketHandler<SSL>` method and stored in C-allocated `us_socket_t` ext memory.

### 4.6 `RuntimeTranspilerCache.parser_options: NonNull<()>` erasure

The cache entry stores `js_parser::Options` but lives in `bun_ast` (below `bun_js`). The erasure stays; the getter in `bun_runtime` casts back. ~30 LOC.

### 4.7 `watcher` opaque forward-decls

`bun_sys::watcher` stores `*const PackageJSON` / `Loader` tag for the resolver but `bun_sys < bun_ast`. These become `*const ()` + `u8` (stored, never dereferenced in watcher). ~10 LOC.

---

## 5. `PORTING.md` / `LAYERING:` comment cleanup

Separate mechanical pass, independent of the crate moves. Two overlapping populations are covered (the exec-summary rows count each independently):

**Population A: comments containing `PORTING.md` (396 matches).** 327 historical §rule citations (§Forbidden, §Allocators, §Global mutable state, §Concurrency, §Idiom map, §JSC types, §Strings, §Pointers, §FFI, §Comptime reflection, §Collections, §Logging) + 57 layering-workaround annotations + 11 lifetime-threading notes that cite PORTING.md + 1 external BoringSSL URL. Disposition: delete the 327 historical citations (the referenced document no longer exists); delete 46 of the 57 layering annotations with the code they annotate; rewrite the remaining 11 layering annotations to name the `OnceLock`/`dyn` that now carries the seam; keep the 11 lifetime-threading notes but strip their `PORTING.md` citation (the note body stays, tracked in §8.3); keep the BoringSSL URL (external link, not a citation of the deleted doc).

**Population B: comments containing `LAYERING:` (92 matches).** These partially overlap the 57 layering annotations above. Same disposition applies.

**Separately:** 2 `TODO(port)` comments in `react_compiler` (not PORTING.md references; real feature gaps) stay as tracked in §8.3.

---

## 6. LOC accounting (honest)

| Category                                                                                                                                                                     | LOC deleted | Evidence                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `RuntimeHooks`/`LoaderHooks`/`SqlRuntimeHooks` structs + statics + `*mut c_void` casts in `jsc_hooks.rs`/`hw_exports.rs`                                                     | ~1,600      | `jsc_hooks.rs` is 5,378 LOC but ~3,800 is hook **bodies** that become `impl VirtualMachine` methods (relocated, not deleted)            |
| `#[no_mangle]` wrappers + `extern "Rust"` decls (36 symbols × ~8 lines avg, both sides)                                                                                      | ~600        | Replaced by `OnceLock.set(…)` calls (~200 lines added) → net ~400                                                                       |
| `link_interface!` decls + `link_impl_*!` calls for the 8 eliminated interfaces                                                                                               | ~450        | 8 interfaces × ~25 lines decl + 10 impls × ~20 lines                                                                                    |
| `bun_dispatch` `extern "Rust"` codegen path                                                                                                                                  | ~120        | Macro body that emits `unsafe extern "Rust" { … }` → replaced by `AtomicPtr` array codegen                                              |
| Facade crates: `transpiler`(10), `output`(51), `api`(78 minus 40-line `Parser` kept)                                                                                         | ~100        |                                                                                                                                         |
| `bun_uws` re-export lines + redundant docs                                                                                                                                   | ~60         | 22 `pub use` lines + ~40 lines of "distinct from sys" commentary                                                                        |
| 76 deleted `Cargo.toml` files (~35 lines avg) + 76 `lib.rs` crate-attr headers (~15 lines avg)                                                                               | ~3,800      |                                                                                                                                         |
| `ErasedJsError`/`JsError` twin (partial; `bun_loop` still can't name `JsError`)                                                                                              | ~30         |                                                                                                                                         |
| `dyn SendQueueOwner` + `dyn HotReloadTaskView` machinery                                                                                                                     | ~80         |                                                                                                                                         |
| `Sink::VTable`/`SignalVTable`/`OutputTaskVTable`/`Mkdir`/`Rm` → enums                                                                                                        | ~350        | ~600 LOC of vtable structs → ~250 LOC of enum+match                                                                                     |
| `sql_jsc/jsc.rs` opaque façade (`SSLConfig` boxed-opaque, duplicate `boringssl_err_to_js`)                                                                                   | ~400        |                                                                                                                                         |
| `bun_alloc::String`↔`bun_core::String` transparent-newtype glue, `bun_core::perf` T0 fork, `spawn_ffi` dup                                                                  | ~500        |                                                                                                                                         |
| Dead Cargo deps (`analytics→sys`, `http→dispatch`, `dotenv→dispatch`, `options_types→libarchive/zlib`, `js_parser→dispatch`, `css_jsc→js_parser`)                            | ~15         |                                                                                                                                         |
| `BundleOptions` forward-decl in `resolver/options.rs` + `resolver_bundle_options_subset()`                                                                                   | ~120        |                                                                                                                                         |
| `src/ptr/{owned,shared}.rs` OBSOLETE modules (2 remaining callers migrated)                                                                                                  | ~600        |                                                                                                                                         |
| **PORTING.md / LAYERING comments** (327 historical + 46 mechanism)                                                                                                           | ~1,200      | avg ~3 lines per comment block                                                                                                          |
| Generated per-variant `extern "Rust"` decls from `link_interface!` (10 interfaces × ~6 methods × ~5 variants avg × 2 lines, in macro output not source, but counted by `wc`) | ~3,500      | Source-visible: 0. Macro-expanded: yes. Conservatively excluded.                                                                        |
| **Total**                                                                                                                                                                    | **~10,000** | Sum of the itemized rows above (the comment and Cargo.toml rows are line items, not separate add-ons). Excludes the macro-expanded row. |

**Relocated (not deleted):** ~440,000 LOC moves between crates. `bun_runtime` grows ~61k; `bun_core` grows ~53k; `bun_ast` grows ~53k; `bun_sys` grows ~26k.

**The −100,000 target is not achievable through relayering.** Reaching it would require deleting functionality or rewriting major subsystems (e.g., replacing `bun_collections::MultiArrayList`/`HiveArray`/`array_hash_map` with std/crates.io equivalents, ~30k LOC; replacing the hand-written `bun_alloc` arena/BSS machinery, ~5k; rewriting `ConsoleObject`, ~6k). Those are separate projects with behavioral risk.

---

## 7. Adversarial review objections and resolutions

24 reviewers (3 whole-proposal + 3×7 per-decision) produced 42 distinct objections. Each is restated and resolved below.

| #              | Objection                                                                                                           | Resolution                                                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1             | `bun_sys ↔ bun_crypto` cycle via `exe_format→sha_hmac`                                                             | `exe_format` moved to `bun_crypto` (§2.3); its sole consumer `standalone_graph` is in `bun_bundler` which depends on `bun_crypto`                                                                                                                 |
| C2/S7/M4/M13   | `FmtAdapter`/`FixedBufferStream`/`BufWriter` are in `bun_io`, not `bun_core`; 6 crates need them without `bun_loop` | `src/io/write.rs` (470 LOC, zero event-loop coupling) moves to `bun_core::io` as step 2 prerequisite (§2.2)                                                                                                                                       |
| C3/S8          | `JSGlobalObject` re-exports `BunPluginTarget` from bundler; `CachedBytecode` needs `options_types::Format`          | `BunPluginTarget` moves to `bun_ast` (§2.4); `bun_jsc` depends on `bun_ast` (§1 tier 3); `run_on_*_plugins` move to ext-trait in `bun_runtime` (§2.1)                                                                                             |
| C4/S6/M6       | `PnpmMatcher` can't move to `install` (it's a `BunInstall` struct field)                                            | `PnpmMatcher` stays in `bun_ast`; `REGEX_ENGINE: OnceLock` replaces the extern (§2.4)                                                                                                                                                             |
| C5/M3/M4       | `bun_jsc` group-A dep list is wrong: `AbortSignal`/`FetchHeaders`/`SystemError`/`uuid` pull higher tiers            | `AbortSignal` moves to group B; `FetchHeaders.to_uws_response` and `SystemError` uws-helper move to group B ext-traits; `uuid` v4 uses `os_entropy`, `UUID5` keeps `bun_crypto::SHA1` (§2.1). `bun_jsc` deps are `core, sys, crypto, ast, macros` |
| C6             | `AbortSignal` calls `VirtualMachine::timer_*` → group B                                                             | Moved to group B (§2.1)                                                                                                                                                                                                                           |
| C8/M8          | `bun_loop` → `dotenv` severance underspecified (types in return signatures)                                         | `bun_loop` depends on `bun_ast` (which owns `dotenv`); acyclic (§2.5)                                                                                                                                                                             |
| C9/S5/M-sem5   | `UpgradedDuplex__*` replacement conflates C-event vs imperative dispatch                                            | Retracted: these are C-ABI and stay (§4.5)                                                                                                                                                                                                        |
| C10/C-dec4     | `__bun_jsc_enable_hot_module_reloading_for_bundler` can't be direct (hot_reloader is group B)                       | `OnceLock<fn>` hook in `bun_bundler` (§2.6)                                                                                                                                                                                                       |
| C11/C13/C-dec5 | 88k `bun_core` + 49k `bun_sys` serializes debug cold-build prefix ~2×                                               | Accepted cost; documented in §8.2. Release unaffected (fat LTO). `-Zthreads=8` partially mitigates                                                                                                                                                |
| C12/S10        | `bun_runtime` → ~392k LOC, 20% larger long pole                                                                     | Accepted cost; documented in §8.2                                                                                                                                                                                                                 |
| C14/M-sem14    | `analytics→sys` is a dead Cargo edge                                                                                | Delete before merge (§2.2)                                                                                                                                                                                                                        |
| C15            | `zlib`/`brotli` use `bun_io::Write`                                                                                 | Resolved by C2 (write.rs → core)                                                                                                                                                                                                                  |
| S1/M5          | `BufferedReaderParent` not object-safe, aliasing contract                                                           | Kept as `link_interface!` with `AtomicPtr` vtable-array codegen (§4.2)                                                                                                                                                                            |
| S2             | `ProcessExit` `Box<dyn>` wrong ownership                                                                            | Kept as `link_interface!` (§4.2)                                                                                                                                                                                                                  |
| S3             | `EventLoopCtx` enum would store 256KB `MiniEventLoop` by value                                                      | Both arms are `NonNull<>` pointers; 16-byte `Copy` handle (§2.5)                                                                                                                                                                                  |
| S4/M-sem3      | `Task→dyn Runnable` doesn't fit non-uniform signatures                                                              | Match stays in `task_dispatch.rs`; only binding mechanism changes (§4.3)                                                                                                                                                                          |
| S9             | `CachedBytecode` body uses `crate::virtual_machine::IS_BUNDLER_THREAD…`                                             | Thread-local moves from `VirtualMachine.rs:473` into `CachedBytecode.rs` (Step 6.2); `jsc::initialize()` stays in group-A `bun_jsc` (touches only WTF C FFI)                                                                                      |
| S11/M6/C-dec3  | `DevServerHandle`/`VmLoaderCtx` need a mechanism; `bun_dispatch` can't fully delete                                 | Both → `Option<&dyn Trait>` (§2.6); `bun_dispatch` folds into `bun_macros` for the 2 kept interfaces (§3.2)                                                                                                                                       |
| S12            | `bun_http` "drops ast edge" is self-contradictory                                                                   | Sentence deleted; `bun_http → bun_ast` edge stays (§1 tier 5)                                                                                                                                                                                     |
| S13/M-sem1-5   | −100k LOC inflated by 10×                                                                                           | §6 restates as ~10k with line-item table                                                                                                                                                                                                          |
| M1             | 24 crates unassigned in truncated proposal                                                                          | All 98 assigned in §1 table + §2.8/2.9                                                                                                                                                                                                            |
| M2             | (duplicate of C1)                                                                                                   | —                                                                                                                                                                                                                                                 |
| M7             | Codegen hardcodes `bun_jsc::virtual_machine` / `bun_jsc::debugger` / `crate::dispatch`                              | §8 step 10 updates `generate-host-exports.ts:503-506`, `generate-js2native.ts:98,330`, `generate-classes.ts:2141`                                                                                                                                 |
| M8             | `build.rs` assumes `../../` repo-root depth                                                                         | Source files stay in place, `#[path]`-mounted (§8 step 2 note); only absorbed crates' `Cargo.toml`/`build.rs` delete, absorbing crate's `build.rs` emits `rerun-if-changed` for the mounted paths                                                 |
| M9             | `cargo test -p bun_parsers` / bench targets / `native_test_shims.rs` break                                          | §8 step 11: update `scripts/bench-json-rust.sh`, `scripts/rust-miri.ts`; move `[[bench]]` to `bun_ast`; expand `native_test_shims.rs` for the merged crate's C-extern surface                                                                     |
| M10            | `show_crash_trace` feature chain not rewired                                                                        | `bun_sys` declares it; `bun_bundler`/`bun_runtime` forward (§2.3)                                                                                                                                                                                 |
| M11            | `shim_standalone` feature must be on `bun_install`                                                                  | Declared (§2.7)                                                                                                                                                                                                                                   |
| M12            | `bun_ast` missing `bun_macros` dep (absorbs `clap`)                                                                 | Added (§1 tier 3)                                                                                                                                                                                                                                 |
| M14            | `jsc_macros` emits `::bun_jsc::` paths                                                                              | `bun_jsc` keeps its name; `__macro_support` module stays at same path (§2.1 group A)                                                                                                                                                              |
| M15            | `src/CLAUDE.md` references `bun_sys_jsc::ErrorJsc`                                                                  | §8 step 12 updates docs; `bun_jsc::SysErrorJsc` is the surviving name                                                                                                                                                                             |
| M16            | Windows-shim shadow-module drift risk                                                                               | §8 step 11 adds `cargo check -p bun_shim_impl --target x86_64-pc-windows-msvc` to CI lint                                                                                                                                                         |
| M-sem2         | `jsc_hooks.rs` 5.4k is mostly logic, not glue                                                                       | §6 credits 1.6k, notes 3.8k relocates                                                                                                                                                                                                             |
| M-sem4         | `bun_uws` façade is 22 re-exports not 1000                                                                          | §6 credits 60 LOC                                                                                                                                                                                                                                 |
| M-dec3         | `sql`/`valkey`/`tcc_sys` unassigned                                                                                 | `sql`→own crate, `valkey`→`bun_core`, `tcc_sys`→`bun_sys` (§1)                                                                                                                                                                                    |
| M-dec5         | Windows-shim coupling spans `rust.ts`/`build.rs`/`#[path]`                                                          | `src/install/windows-shim/` stays on disk; `bun_install` `#[path]`-mounts unchanged; `rust.ts:793` unchanged (§8 step 11)                                                                                                                         |

---

## 8. Migration recipe

Each step leaves `cargo check --workspace` passing. Source files stay at their current disk paths; absorbing crates `#[path]`-mount them (so `build.rs` repo-root computation and codegen scanners keep working until step 10). The only exceptions are the two enum moves in Step 1.5 and the file renames in Step 7.8/7.9, which are noted explicitly.

**Every absorbing crate** adds `extern crate self as <crate_name>;` at the top of its `lib.rs` before `#[path]`-mounting. Mounted files reference the absorbing crate by its extern name (`bun_core::Error`, `bun_sys::Fd`, `bun_ast::Expr`), and a crate is not in its own extern prelude by default; without the self-alias every mount step fails E0433. The pattern is already in use at `src/jsc/lib.rs:32`, `src/install/lib.rs:12`, `src/css/lib.rs:6`. Applies at Steps 1.1 (`bun_core`), 3.1, 4.1, 5.1/5.2/5.5, 7.1/7.5, 8.1-8.4. Step 2 (`bun_macros`) is the exception: the five mounted proc-macro sources have no `bun_macros::` extern-name references (that name did not exist before Step 2), only `crate::` paths which Step 2.1's root wrappers satisfy.

### Step 1: Prerequisites (no crate graph change)

1. `src/bun_core/lib.rs` adds `extern crate self as bun_core;` (see §8 preamble note) and `#[path = "../io/write.rs"] pub mod io;` (mounting `Write`, `FmtAdapter`, `FixedBufferStream`, `BufWriter`, `DiscardingWriter`, `AsFmt`, `Result` from their existing location). `src/io/lib.rs` replaces its `mod write;` with `pub use bun_core::io::*;`. `src/io/write.rs` stays on disk; only its crate-of-record changes.
2. Tree-wide `sed`: `bun_io::{Write,FmtAdapter,FixedBufferStream,BufWriter,Result,AsFmt,DiscardingWriter}` → `bun_core::io::…` (css, sourcemap, crash_handler, zlib, brotli, js_parser, js_printer).
3. Delete dead Cargo edges: `analytics→sys`, `http→dispatch`, `dotenv→dispatch`, `js_parser→dispatch`, `options_types→{libarchive,zlib}`, `css_jsc→js_parser`, `css→io` (dead after 1.2; `bun_css` is the one surviving §1 crate in 1.2's list so its manifest reaches Step 13).
4. `src/bun_core/util.rs:2828`: make `fn os_entropy` `pub` (and adjust its "every other caller must use `rand_bytes`" comment to note the `bun_jsc` uuid-v4 exception). `src/jsc/uuid.rs:23`: replace `bun_boringssl::rand_bytes(&mut uuid.bytes)` with `bun_core::os_entropy(&mut uuid.bytes)`.
5. Move `BunPluginTarget` enum from `src/bundler/transpiler.rs` → `src/ast/plugin_target.rs`; `bundler` re-exports it. Update `src/jsc/JSGlobalObject.rs:1510` to `pub use bun_ast::BunPluginTarget;`.

### Step 2: Create `bun_macros`

**Steps 2 and 3 form one `cargo check` unit.** Step 2.3 rewrites derive emissions to `::bun_core::{RefCounted, CellRefCounted, …}` but those items only exist at `bun_core` root after Step 3.1's `pub use ptr::*;`. Do not stop between them.

1. New `src/macros/{Cargo.toml,lib.rs}` with `proc-macro = true`. `lib.rs` `#[path]`-mounts `../bun_core_macros/lib.rs`, `../clap_macros/lib.rs`, `../jsc_macros/lib.rs`, `../css_derive/lib.rs`, `../dispatch/lib.rs` as `mod core_macros_impl;` etc. **`#[proc_macro*]` items must live at the crate root** (re-exports do not satisfy rustc), so in each mounted file rename `#[proc_macro…] pub fn foo` → `pub fn foo_impl` (plain fn), and in `src/macros/lib.rs` add one-line wrappers at the root: `#[proc_macro] pub fn foo(t: TokenStream) -> TokenStream { core_macros_impl::foo_impl(t) }`. Same for `#[proc_macro_derive]`/`#[proc_macro_attribute]` (~18 wrappers total).
2. Rewrite `dispatch/lib.rs` codegen: replace the `unsafe extern "Rust" { … }` emission with (declarer side) `pub static __VTABLES_<Iface>: [AtomicPtr<<Iface>MethodTable>; N] = [const { AtomicPtr::new(null_mut()) }; N];` and (impl side, per `link_impl_*!`) `static __VTABLE_<Variant>: <Iface>MethodTable = …; pub fn __register_<Iface>_<Variant>() { <declarer>::__VTABLES_<Iface>[<tag>].store(addr_of!(__VTABLE_<Variant>) as *mut _, Relaxed); }`. Dispatch reads `__VTABLES[tag].load(Relaxed)` (debug-assert non-null). No `extern "Rust"` in output; registration wired in Step 7.9.
3. Update `bun_core_macros` derive emissions: `::bun_ptr::` → `::bun_core::` (the items are flat-re-exported at `bun_core` root in Step 3.1). This rewrite is **required**, not optional: a `pub use crate as bun_ptr;` alias in `bun_core` does not put `bun_ptr` into downstream crates' extern prelude, so `::bun_ptr::…` in macro expansion would still fail there. 16 emission sites: `src/bun_core_macros/lib.rs:332,344,356,373,374,381,389,449,470,472,520,522,528,533,538,544`.
4. Every `Cargo.toml` that depends on one of the 5 absorbed proc-macro crates: replace with `bun_macros.workspace = true`. Add `bun_macros` to `[workspace.dependencies]`.
5. Tree-wide `sed` (all `src/**/*.rs`): `bun_{core_macros,clap_macros,jsc_macros,css_derive,dispatch}::` → `bun_macros::`; `use bun_{core_macros,clap_macros,jsc_macros,css_derive,dispatch}` → `use bun_macros`. ~25 non-comment sites across 19 files (`src/bun_core/lib.rs:629`, `src/ptr/lib.rs:64`, `src/jsc/lib.rs:43`, `src/uws/lib.rs:32`, `src/css/{lib,generics,css_parser}.rs`, `src/clap/lib.rs:21`, `src/{io,event_loop,spawn,ast,bundler,crash_handler}/lib.rs` `bun_dispatch::link_interface!` sites). Same pattern as Steps 3.6/4.5/5.6/7.13/8.5.

### Step 3: Merge `bun_core`

1. `src/bun_core/lib.rs`: `#[path]`-mount `../bun_alloc/lib.rs` as `pub mod alloc_impl;`, and likewise for `mimalloc_sys`, `simdutf_sys`, `wyhash`, `highway`, `hash`, `ptr`, `safety`, `collections`, `base64`, `errno`, `paths`, `libuv_sys` (mount unconditionally: the heavy `mod libuv` is inner-gated `#[cfg(windows)]`, but `src/libuv_sys/lib.rs:35-48` exposes 7 `#[cfg(not(windows))] UV_E*` constants that `src/errno/{darwin,linux,freebsd}_errno.rs` reference), `url`, `semver`, `http_types`, `analytics`, `picohttp`, `valkey`. (`bun_output` is **not** mounted: it is a 51-line facade re-exporting `bun_core::output`; the impl is already native here. Add `pub use output::{declare_scope, scoped_log, …};` root re-exports, and add `#[macro_export] macro_rules! scope_is_visible { ($scope:ident) => { $scope.is_visible() }; }` since that macro is the one item `bun_output` defines itself rather than re-exporting, with 2 callers at `src/runtime/bake/DevServer.rs:4798,5567`, so Step 3.6's `bun_output::` → `bun_core::` sed resolves.) Add flat re-exports at crate root matching the old crates' public surface: `pub use alloc_impl::*; pub use ptr::*; …`. **`crate::` paths inside mounted files** now resolve to `bun_core`, not the original crate root: the flat root re-exports cover every `crate::PublicItem`, but intra-crate submodule paths (`crate::posix`, `crate::hash_map`, `crate::path_buffer_pool`, `crate::zig_base64`) must be rewritten to `super::…` or the mount-point path. Grep each absorbed crate for `\bcrate::` and fix before the Cargo.toml switch; `cargo check -p bun_core` catches any miss.
2. Delete `link_interface! ErrnoNames` (`lib.rs:610`); callers use `crate::errno::SystemErrno::name()`.
3. Replace `link_interface! OutputSink` (`lib.rs:584`) with `pub struct OutputSinkVTable { pub stderr: fn()->output::File, … 11 slots … } pub static OUTPUT_SINK: OnceLock<OutputSinkVTable> = OnceLock::new();`. `src/sys/lib.rs:9680` `link_impl_OutputSink!` becomes `const SINK: OutputSinkVTable = …; pub fn register_output_sink() { bun_core::OUTPUT_SINK.set(SINK).ok(); }`. Add `pub fn init() { register_output_sink(); }` at `src/sys/lib.rs` crate root (new; no crate-level `init` exists today). `src/bun_bin/lib.rs`: insert `bun_sys::init();` immediately before `output::stdio::init()` at `:200` (the existing `bun_crash_handler::init()` at `:161` becomes `bun_sys::crash_handler::init()` after Step 4.5's sed and sets `PANIC_HOOK`/`STACK_TRACE_HOOK`, not `OUTPUT_SINK`).
4. Replace `extern "Rust" __bun_crash_handler_*` with `pub static PANIC_HOOK: AtomicUsize = …` / `STACK_TRACE_HOOK: AtomicUsize` (fn-pointer stored via `as usize`; `AtomicPtr<()>` would assume fn-pointer and data-pointer share representation, which Rust does not guarantee). Add `const _: () = assert!(size_of::<fn()->!>() == size_of::<usize>());` next to the statics. `bun_core` ships default bodies (print + abort).
5. `[features] debug_logs = []`.
6. Tree-wide `sed` (all `src/**/*.rs` + `src/**/Cargo.toml`): `bun_{alloc,mimalloc_sys,simdutf_sys,wyhash,highway,hash,ptr,safety,output,collections,base64,errno,paths,libuv_sys,url,semver,http_types,analytics,picohttp,valkey}::` → `bun_core::`. Same for `use bun_X` → `use bun_core`.

### Step 4: Merge `bun_sys`

1. `src/sys/lib.rs`: `#[path]`-mount `which`, `perf`, `platform`, `threading`, `spawn_sys`, `glob`, `watcher`, `libarchive`, `zlib`, `zlib_sys`, `zstd`, `brotli`, `brotli_sys`, `libdeflate_sys`, `tcc_sys`, `cares_sys` (as `pub mod cares`), `dns`, `crash_handler`. Flat re-exports.
2. `crash_handler/lib.rs`: replace `use bun_ast::ImportKind` with `&[u8]` param; delete `link_interface! BundleGenerateChunkCtx` → `pub static ACTION_FORMATTER: OnceLock<fn(&mut dyn core::fmt::Write, u32, *const ())>`; register `PANIC_HOOK`/`STACK_TRACE_HOOK` into `bun_core`.
3. `dns/lib.rs:492`: delete `extern "Rust" __bun_dns_prefetch`; add `pub static PREFETCH_HOOK: OnceLock<fn(*mut c_void, *const u8, usize, u16)> = OnceLock::new();` (`Loop` is tier-3 `bun_uws`; `bun_sys` cannot name it, so keep the existing `*mut c_void` erasure). `src/runtime/dns_jsc/dns.rs:3167`: replace `#[no_mangle]` with `pub fn register_prefetch() { bun_sys::dns::PREFETCH_HOOK.set(prefetch_shim).ok(); }`, called from `register_dispatch_tables()` at process init (Step 7.9), **not** VM init: `bun_install` calls `bun_dns::internal::prefetch` at `install_with_manager.rs:59` on `MiniEventLoop` with no VM, same Mini-path constraint as `POLL_DISPATCH`/`REGEX_ENGINE`. The impl body (`dns.rs:3152`) is VM-agnostic.
4. `[features] show_crash_trace = []`. `src/bundler/Cargo.toml:73` and `src/runtime/Cargo.toml:113`: rewrite `show_crash_trace = ["bun_crash_handler/show_crash_trace"]` / `["bun_bundler/show_crash_trace"]` → `["bun_sys/show_crash_trace"]` now (not at Step 11): Step 4.5 removes `bun_crash_handler` from `[dependencies]`, and Cargo validates `dep/feature` entries at manifest-parse time regardless of feature enablement, so the stale reference hard-errors at the Step 4 checkpoint.
5. Tree-wide `sed` + Cargo.toml updates for absorbed crates (including `bun_cares_sys::` → `bun_sys::cares::`, `bun_dns::` → `bun_sys::dns::`).
6. `bun_bin/lib.rs:42`: `use bun_platform as _;` → `use bun_sys::platform as _;`.

### Step 5: Create `bun_crypto`; merge `bun_ast`; merge `bun_uws`

1. New `src/crypto/{Cargo.toml,lib.rs}` `#[path]`-mounting `boringssl_sys`, `boringssl`, `sha_hmac`, `csrf`, `s3_signing`, `exe_format`. `boringssl/lib.rs:10`: `use bun_cares_sys as c_ares;` → `use bun_sys::cares as c_ares;`.
2. `src/ast/lib.rs`: `#[path]`-mount `parsers`, `sourcemap`, `dotenv`, `options_types`, `install_types`, `resolve_builtins`, `shell_parser`, `md`, `clap`, `api`, `ini`. Add `pub use plugin_target::BunPluginTarget;`.
3. `install_types/NodeLinker.rs:87`: delete `extern "Rust" __bun_regex_*`; add `pub struct RegexEngineVTable { compile: fn(&[u8])->Option<NonNull<()>>, matches: fn(NonNull<()>, &[u8])->bool, drop: fn(NonNull<()>) } pub static REGEX_ENGINE: OnceLock<RegexEngineVTable> = OnceLock::new();`. `src/jsc/RegularExpression.rs:106-124`: replace `#[no_mangle]` with `fn yarr_compile(p: &[u8]) -> Option<NonNull<()>> { crate::initialize(false); … }` (keep the lazy WTF init that exists today at `:108`) + `const YARR: RegexEngineVTable = RegexEngineVTable { compile: yarr_compile, … }; pub fn register_regex() { bun_ast::REGEX_ENGINE.set(YARR).ok(); }`.
4. `ast/transpiler_cache.rs:52`: delete `link_interface! TranspilerCacheImpl`; add `pub trait TranspilerCache: Sync { fn is_disabled(&self)->bool; fn get(&self, …)->bool; fn put(&self, …); }`. `parser::Options.runtime_transpiler_cache: Option<&'static dyn TranspilerCache>`. `src/jsc/RuntimeTranspilerCache.rs:1054`: replace `bun_ast::link_impl_TranspilerCacheImpl! { Jsc for … }` with `impl bun_ast::TranspilerCache for RuntimeTranspilerCache { fn is_disabled(&self)->bool {…} fn get(&self,…)->bool {…} fn put(&self,…) {…} }` (the declarer-side macro no longer exists; the file is still compiled in `bun_jsc` until Step 6.1).
5. `src/uws_sys/Cargo.toml`: rename `name = "bun_uws"`. `#[path]`-mount `../uws/lib.rs` as `mod wrappers; pub use wrappers::*;`. Update deps to `bun_core, bun_sys, bun_crypto, bun_macros`. **In the same step** (Cargo rejects two workspace members with the same package name): delete `src/uws/Cargo.toml` (source `src/uws/lib.rs` stays on disk for the mount), drop `"src/uws"` from root `Cargo.toml` `[workspace].members`, and repoint `[workspace.dependencies].bun_uws` from `path = "src/uws"` to `path = "src/uws_sys"`. Delete `bun_uws_sys` from `[workspace.dependencies]`.
6. Tree-wide `sed` + Cargo.toml for absorbed crates → `bun_crypto::`/`bun_ast::`/`bun_uws::`.

### Step 6: Slim `bun_jsc` to group A

**Steps 6 and 7 form one `cargo check` unit.** Step 6 removes group-B `mod` declarations from `bun_jsc` while `bun_runtime` + the 11 `*_jsc` crates still import `bun_jsc::{virtual_machine, event_loop, …}`; the consumer-side rewrites are in Step 7.5/7.12. Do not stop between them.

1. `src/jsc/lib.rs`: remove `mod` declarations for all group-B files (per §2.1 table). Keep `pub mod __macro_support` path unchanged.
2. `src/jsc/JSGlobalObject.rs`: delete `pub use bun_bundler::…`, delete `run_on_{load,resolve}_plugins`/`throw_invalid_scrypt_params` (move to step 7 ext-trait). `src/jsc/ResolveMessage.rs:160,204`: `bun_resolver::is_package_path` → `bun_core::is_package_path`. Move `#[thread_local] pub static IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE` from `src/jsc/VirtualMachine.rs:473` into `src/jsc/CachedBytecode.rs`; rewrite `CachedBytecode.rs:149` from `crate::virtual_machine::…` to the local path, and add `pub use cached_bytecode::IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE;` to `src/jsc/lib.rs`. `src/runtime/timer/WTFTimer.rs:15`: rewrite `use crate::jsc::virtual_machine::{IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE, VirtualMachine}` → `use bun_jsc::IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE; use crate::vm::VirtualMachine;` (Step 7.12's sed matches `bun_jsc::virtual_machine`, not `crate::jsc::virtual_machine`). `src/jsc/CallFrame.rs`: move `pub struct ArgumentsSlice<'a>` + its `impl` blocks (`:285-` end, `pub vm: &'a VirtualMachine` field) to a new `src/jsc/arguments_slice.rs` (group-B, `#[path]`-mounted at Step 7.5; add `ArgumentsSlice` to Step 7.12's rewrite list); delete `use crate::virtual_machine::VirtualMachine;` at `:4`. The only in-`bun_jsc` reference at `node_path.rs:229` is a doc-comment; all ~74 `ArgumentsSlice::init` callers and the 4 `.vm` readers at `ServerConfig.rs:709,738,755,773` are in `src/runtime/**`/`src/*_jsc/**`. `src/jsc/FetchHeaders.rs:307-312`: rewrite `cast(value)` to `cast(value, global: &JSGlobalObject)` calling `Self::cast_(value, global.vm())`; delete `use crate::virtual_machine::VirtualMachine;` at `:4` (the body only needed `global.vm()`; `cast_` at `:303` already has that shape).
3. `src/jsc/error.rs` (stays group-A, not removed at 6.1): shrink `CrateError` to `JsError | Core | Sys | Ast` arms only (drop `Resolver`/`Bundler`/`Install`/`Patch`/`Uws`/`Watcher`). Group-B files that today match the dropped arms (e.g. `AsyncModule.rs:725` `CrateError::Bundler(…)`) are rewritten to the wide `crate::vm::Error` defined at Step 7.6.
4. `src/jsc/webcore_types.rs`: delete `extern "Rust" __bun_blob_from_build_artifact` block and the `S3` sub-struct (moves in step 7).
5. `src/jsc/Cargo.toml`: deps → `bun_core, bun_sys, bun_crypto, bun_ast, bun_macros` + external C deps (`bun_crypto` for `UUID5::init`'s `SHA1` at `uuid.rs:241`; forward tier-3 edge). Keep `name = "bun_jsc"`.
6. `register_regex()` is **not** called from `bun_jsc::initialize()` (the `bun install` path reaches `create_matcher` without it); it is called from `bun_runtime::register_dispatch_tables()` at process init (Step 7.9).
7. **Systematic group-A `crate::<group-B-module>` carve-out pass.** Appendix A's original import-scan missed intra-crate `crate::{virtual_machine, module_loader, console_object, event_loop, rare_data}` paths; `rg 'crate::(virtual_machine|module_loader|console_object|event_loop|rare_data)' src/jsc/*.rs` over the group-A file set (after 6.1) must return zero. Per-file dispositions for the known hits (beyond 6.2's `CachedBytecode`/`WTFTimer`/`CallFrame`/`FetchHeaders` items): `JSGlobalObject.rs:9,1095-1160,1409,1560-1598,1777` delete the 5 `bun_vm*()` inherent accessors + `ScriptExecutionContextIdentifier::bun_vm` (all move to Step 7.6's `JSGlobalObjectExt`; this resolves the Step 7.6/7.12 contradiction where `bun_vm()` was listed in both places), and cut-paste `create(v: &mut VirtualMachine,…)` + `Zig__GlobalObject__{resolve,reportUncaughtException}` (~40 LOC, C-ABI, called by name from `bindings.cpp`) into group-B `virtual_machine_exports.rs`. `JSValue.rs:2639-2646` delete `to_fmt()` (moves to a `JSValueExt` trait at Step 7.6; all ~60 callers are in `src/runtime/test_runner/**`). `ZigException.rs:9-10,167,175` change `Holder::deinit(&mut self, vm: &mut VirtualMachine)` → `Holder::deinit(&mut self, reset_arena: impl FnOnce())`; the 2 callers pass `|| ModuleLoader::reset_arena(vm)`. `JSPromise.rs:8,93,103,216,230` change the 4 `VirtualMachine::get().enter_event_loop_scope()` sites to take `global: &JSGlobalObject` and call via `JSGlobalObjectExt` (or move the 2 wrapper fns to a `JSPromiseExt` trait at Step 7.6). `DOMURL.rs:46` rewrite `cast(value)` → `cast(value, global: &JSGlobalObject)` calling `Self::cast_(value, global.vm())` (same shape as `FetchHeaders::cast` in 6.2). Any further hits the grep surfaces follow one of these three patterns: take `&JSGlobalObject`/`&VM` param instead of `VirtualMachine::get()`, move to an `*Ext` trait at Step 7.6, or relocate the item to a group-B file. Separately, `src/jsc/lib.rs:644-666`: rewrite the 7 `bun_event_loop::ErasedJsError` references in the three `From` impls to `bun_core::JsError` (pure re-export per `event_loop/AnyTask.rs:12`; these impls cannot move to group-B per orphan rules since neither type would be local to `bun_runtime`; same rewrite-to-source-of-truth pattern as 6.2's `bun_resolver::is_package_path` → `bun_core::is_package_path`).

### Step 7: Create `bun_loop`; mount group B + `*_jsc` into `bun_runtime`

1. New `src/loop/{Cargo.toml,lib.rs}` `#[path]`-mounting `src/io/lib.rs` (minus write.rs), `src/event_loop/lib.rs`, `src/spawn/lib.rs`, `src/patch/lib.rs`.
2. `src/loop/lib.rs`: define `pub struct JsLoopVTable { … 21 fn slots … } pub static JS_LOOP_VTABLE: OnceLock<JsLoopVTable> = OnceLock::new();` + `PollDispatchVTable`/`TimerDispatchVTable`/`TASK_DISPATCH` statics. `EventLoopCtx` becomes `enum { Mini(NonNull<MiniEventLoop>), Js(NonNull<()>) }` with methods that route `Js` through `JS_LOOP_VTABLE.get().unwrap()`.
3. Delete all `extern "Rust"` blocks in `io/posix_event_loop.rs`, `io/lib.rs:1397`, `event_loop/{AnyEventLoop,SpawnSyncEventLoop,EventLoopTimer,MiniEventLoop,lib}.rs`; replace callers with `JS_LOOP_VTABLE.get()…` / `TIMER_DISPATCH.get()…`.
4. Delete `link_interface! EventLoopCtx` / `JsEventLoop`. Keep `link_interface! BufferedReaderParentLink` / `ProcessExit` (now using `bun_macros::link_interface!`).
5. `src/runtime/lib.rs`: add `pub use bun_jsc::*;` at crate root (before the group-B mounts) so mounted files' `use crate::{self as jsc, JSValue, JSGlobalObject, VM, …}` group-A references resolve (`VirtualMachine.rs:20` alone pulls 13 items this way). Then add `#[path = "../jsc/VirtualMachine.rs"] pub mod virtual_machine;` and likewise for every group-B file; add `pub mod vm { pub use super::{virtual_machine::*, module_loader::*, …}; }`. `#[path]`-mount `../sql_jsc/lib.rs` as `pub mod sql;`, and `http_jsc`, `css_jsc`, `bundler_jsc`, `install_jsc`, `js_parser_jsc`, `sourcemap_jsc`, `patch_jsc`, `semver_jsc`, `sys_jsc`, `ast_jsc`. **In the same sub-step**, delete the 11 `src/*_jsc/Cargo.toml` files and drop those entries from root `[workspace].members` + `[workspace.dependencies]`: Step 7.12 rewrites their sources to `crate::vm::…` which only resolves when compiled as `bun_runtime` modules, so the standalone crates cannot compile past this point (same pattern as Step 5.5's `bun_uws` manifest delete).
6. `src/runtime/jsc_ext.rs` new: `pub trait JSGlobalObjectExt { fn bun_vm(&self)->…; fn run_on_load_plugins(…); fn run_on_resolve_plugins(…); fn throw_invalid_scrypt_params(…); } impl JSGlobalObjectExt for JSGlobalObject { … }`. Same for `FetchHeadersExt::to_uws_response`, `SystemErrorExt::from_verify_error`, `JSValueExt::to_fmt`, and optionally `JSPromiseExt` for the 2 event-loop-scope wrappers. The `JSGlobalObjectExt` method list is `{bun_vm, bun_vm_ptr, bun_vm_ref, try_bun_vm, bun_vm_concurrently, run_on_load_plugins, run_on_resolve_plugins, throw_invalid_scrypt_params}` plus `ScriptExecutionContextIdentifier::bun_vm` (all deleted from inherent `impl`s at Step 6.7). `src/runtime/vm/error.rs` new: `pub enum Error { #[from] Jsc(bun_jsc::CrateError), #[from] Resolver(bun_resolver::Error), #[from] Bundler(bun_bundler::Error), #[from] Install(bun_install::Error), #[from] Patch(bun_loop::patch::Error), #[from] Uws(bun_uws::Error), #[from] Watcher(bun_sys::watcher::Error) } pub type Result<T> = core::result::Result<T, Error>;` and `pub use` it from `vm`. Group-B `?`-chains that today produce a dropped `bun_jsc::CrateError` arm (e.g. `AsyncModule.rs:725`) switch to `crate::vm::Error`; group-B files reach the shrunk `bun_jsc::CrateError` via Step 7.5's `pub use bun_jsc::*;`.
7. `VirtualMachine.rs`: delete `extern "Rust" { static __BUN_RUNTIME_HOOKS }`; add real fields `timer: timer::All, sql_rare: crate::sql::RareData, ssl_ctx_cache: …, editor_context: …, global_dns_data: …, body_value_pool: …`; delete `link_impl_EventLoopCtx!`; add `fn register_js_loop_vtable(&self)` that fills `bun_loop::JS_LOOP_VTABLE` only (needs the live VM pointer).
8. Rename `jsc_hooks.rs` → `vm/init.rs`; delete `__BUN_RUNTIME_HOOKS`/`__BUN_LOADER_HOOKS` statics + `RuntimeState` struct; inline hook bodies as `impl VirtualMachine { fn generate_entry_point(…), fn load_preloads(…), fn ensure_debugger(…), fn auto_tick(…) }` and `impl ModuleLoader { fn transpile_source_code(…), fn fetch_builtin_module(…), fn transpile_file(…) }`. Delete `#[no_mangle]` on `__bun_{get_vm_ctx,js_vm_get,stdio_blob_store_*}`; bodies stay as the `JS_LOOP_VTABLE` slot impls.
9. Rename `dispatch.rs` → `task_dispatch.rs`; delete `#[no_mangle]` on the 4 entry fns. Add `pub fn register_dispatch_tables()` that fills `bun_loop::{TIMER_DISPATCH, POLL_DISPATCH, TASK_DISPATCH}` (no VM needed; the fn bodies null-check for Mini-path tags as today), calls `bun_jsc::register_regex()` to set `bun_ast::REGEX_ENGINE`, and calls every `__register_<Iface>_<Variant>()` emitted by `link_impl_*!` for `BufferedReaderParentLink`/`ProcessExit` (the `bun_install`-side variants register from `bun_install::init()`, called here as well). **Prerequisite:** add `pub fn init()` to `src/install/lib.rs` in this sub-step, calling the `__register_BufferedReaderParentLink_*`/`__register_ProcessExit_*` fns for the 2+2 `bun_install`-side `link_impl_*!` variants (the fns exist since Step 2.2; only the wrapper is new). Also call `crate::dns_jsc::register_prefetch()` to set `bun_sys::dns::PREFETCH_HOOK` (Step 4.3). `src/bun_bin/lib.rs`: call `bun_runtime::register_dispatch_tables()` before `cli::dispatch()` (so `bun install` + lifecycle-script `FilePoll`s find `POLL_DISPATCH` set, `.npmrc` `hoist-pattern=` finds `REGEX_ENGINE` set, and `install_with_manager.rs:59` finds `PREFETCH_HOOK` set). `src/runtime/lib.rs`: change `pub mod dispatch;` (`:39`) to `pub mod task_dispatch;` and add `pub mod dispatch { pub use crate::task_dispatch::js2native; }` as a compatibility alias: `dispatch_js2native.rs` is `#[path]`-mounted from inside the renamed file (`dispatch.rs:24`), and `generate-js2native.ts:331` emits `crate::dispatch::js2native::…` into `generated_js2native.rs` which compiles at `lib.rs:56`.
10. `hw_exports.rs`: delete `__BUN_SQL_RUNTIME_HOOKS` block; `sql_jsc/jsc.rs` callers use `crate::{timer, socket::SSLConfig, webcore::Blob}` directly.
11. `event_loop.rs` (group B, now in runtime): delete `extern "Rust" __bun_tick_queue_*` etc.; call `crate::task_dispatch::*` directly. Delete `link_impl_JsEventLoop!`. `rare_data.rs` (group B, now in runtime): delete the `extern "Rust"` block at `:889-891` and the `use bun_event_loop::MiniEventLoop::__bun_stdio_blob_store_new;` import at `:13`; rewrite `:899` and `:1076` to direct `crate::vm::init::stdio_blob_store_{new,deinit}(…)` calls (the bodies Step 7.8 kept; both declarer and definer are now same-crate).
12. In `src/runtime/**`, `src/*_jsc/**`: `bun_jsc::<N>` → `crate::vm::<N>` for **every** §2.1 group-B module/type name `<N>` (the full list at line 102, both snake_case module paths and PascalCase type re-exports: `virtual_machine`/`VirtualMachine`, `module_loader`/`ModuleLoader`, `async_module`, `console_object`/`ConsoleObject`/`Formatter`, `debugger`/`Debugger`, `event_loop`/`EventLoop`, `hot_reloader`, `ipc`, `rare_data`/`RareData`, `web_worker`, `runtime_transpiler_store`/`RuntimeTranspilerStore`, `runtime_transpiler_cache`, `virtual_machine_exports`, `btjs`, `http_server_agent`, `garbage_collection_controller`, `node_module_module`, `plugin_runner`, `posix_signal_handle`/`PosixSignalTask`, `process_auto_killer`, `saved_source_map`, `work_task`, `concurrent_promise_task`, `cpp_task`, `jsc_scheduler`, `Task`, `event_loop_handle`/`EventLoopHandle`, `any_task_job`, `abort_signal`/`AbortSignal`/`AbortSignalRef`, `arguments_slice`/`ArgumentsSlice`, `webcore_types::{Blob, S3…}`). `CrateError`/`error` is the only explicit exclusion (stays group-A per Step 6.3, resolves via 7.5's `pub use bun_jsc::*;`). ~50 non-comment sites across 27 files (`dispatch.rs:126-130,166-167,243-245,423`; `EventLoopHandle` in `cli/*`/`socket/WindowsNamedPipe.rs`; `work_task` in `webcore/blob/{read,write}_file.rs`; `jsc_hooks.rs:434,444,594,2437,2777,2925,4210,4341`; etc.). Add `use crate::jsc_ext::JSGlobalObjectExt as _;` where `.bun_vm()` is called.
13. Tree-wide `sed` (all `src/**/*.rs` + `src/**/Cargo.toml`): `bun_{io,event_loop,spawn,patch}::` → `bun_loop::`; `use bun_{io,event_loop,spawn,patch}` → `use bun_loop`. Replace `bun_{io,event_loop,spawn,patch}.workspace = true` with `bun_loop.workspace = true` in downstream `Cargo.toml`s (`src/http/`, `src/install/`, `src/bundler/`, `src/resolver/`, `src/runtime/`, `src/bun_bin/` for `ParentDeathWatchdog::install()` at `lib.rs:221`). Add `bun_loop` to root `[workspace.dependencies]`. Same pattern as Steps 3.6/4.5/5.6/8.5.
14. `src/runtime/Cargo.toml`: delete the 11 `bun_{ast,bundler,css,http,install,js_parser,patch,semver,sourcemap,sql,sys}_jsc.workspace = true` lines (`:40,53,60,66,72,82,87,91,106-108`); Cargo hard-errors on them after 7.5 dropped the names from `[workspace.dependencies]`. Tree-wide `sed` in `src/runtime/**`, `src/*_jsc/**`, `src/jsc/generated_classes_list.rs`: `bun_sql_jsc::` → `crate::sql::`, and `bun_{http,css,bundler,install,js_parser,sourcemap,patch,semver,sys,ast}_jsc::` → `crate::{http_jsc,css_jsc,bundler_jsc,install_jsc,js_parser_jsc,sourcemap_jsc,patch_jsc,semver_jsc,sys_jsc,ast_jsc}::` (the Step 7.5 mount-point names). ~60+ non-comment sites including `dispatch_js2native.rs:19-65`, `generated_classes_list.rs:114-118`, `install_jsc/ini_jsc.rs:111,220`. Same pattern as Steps 2.5/3.6/4.5/5.6/7.13/8.5, for the `*_jsc` name set.

### Step 8: Merge `bun_js`, `bun_resolver`, `bun_bundler`, `bun_install`

1. New `src/js/{Cargo.toml,lib.rs}` mounting `js_parser`, `js_printer`. `js_parser/lib.rs:102`: delete `extern "Rust" __bun_macro_*`; `pub trait MacroRunner { fn call(&mut self, …)->Result<Expr>; fn get_remap(&self, …)->…; } pub struct MacroContext { runner: Option<Box<dyn MacroRunner>>, … }`. Impl in `src/runtime/macro_runner.rs` (moved from `js_parser_jsc/Macro.rs`). `collect_garbage` is **not** a trait method: it has no receiver (trait would fail E0038) and its sole caller `bundler/ThreadPool.rs:646` is a free-fn call _after_ both per-worker `MacroContext` boxes are freed (`js_parser/lib.rs:144-148`). Instead add `pub static MACRO_GC_HOOK: OnceLock<fn()> = OnceLock::new(); pub fn collect_vm_garbage() { if let Some(f) = MACRO_GC_HOOK.get() { f() } }` in `bun_js`, set from `register_dispatch_tables()` (Step 7.9) with the impl body `crate::vm::collect_macro_vm_garbage` (group-B `VirtualMachine.rs:3067`, same `HOT_RELOAD_HOOK` pattern for the same tier-4/5→group-B edge). Amend `bun_runtime::register_dispatch_tables()` (Step 7.9) in this sub-step: add `bun_js::MACRO_GC_HOOK.set(crate::vm::collect_macro_vm_garbage).ok();` (`bun_js` did not exist at Step 7.9). `js_printer/lib.rs:1206,1432`: `SourceMapHandler`/`RequireOrImportMetaCallback` fn-ptr structs → `Option<&mut dyn SourceMapSink>`/`Option<&mut dyn RequireMetaResolver>`.
2. `src/resolver/lib.rs`: `#[path]`-mount `router`. Delete `extern "Rust" __bun_resolver_init_package_manager`; `Resolver::init` takes `auto_installer: Option<&'a dyn AutoInstaller>` (caller in `bun_install` constructs PM first). Add `bun_jsc` dep (for `StandaloneModuleGraph` no longer needs the `dyn` downcast in runtime; the trait stays since resolver < bundler).
3. `src/bundler/lib.rs`: `#[path]`-mount `standalone_graph`; `pub use transpiler::*;` (deleting `bun_transpiler` crate). `bundle_v2.rs:1403,1417`: delete both `extern "Rust"`; replace first with direct `bun_jsc::CachedBytecode::generate(…)`, second with `pub static HOT_RELOAD_HOOK: OnceLock<fn(NonNull<BundleV2<'static>>)>`. **Definer-side rewrite** (amended here, not at Step 7.9, since `bun_bundler::HOT_RELOAD_HOOK` did not exist at Step 7.9; same pattern as 8.1's `MACRO_GC_HOOK`): `src/jsc/hot_reloader.rs:1417-1425` delete `#[unsafe(no_mangle)]` and wrap as `pub fn register_hot_reload_hook() { bun_bundler::HOT_RELOAD_HOOK.set(|bv2| unsafe { BundlerWatcher::enable_hot_module_reloading(bv2.as_ptr(), None) }).ok(); }`, and amend `register_dispatch_tables()` to add `crate::vm::hot_reloader::register_hot_reload_hook();` (the impl body is VM-agnostic over `AnyEventLoop`; sole caller `bun build --watch` at `bundle_v2.rs:2865` is a CLI command, not bake). `lib.rs:338,364`: delete `link_interface! DevServerHandle/VmLoaderCtx`; add `pub trait DevServerHooks { …11 methods… } pub trait VmLoaderHooks { …13 methods… }`; stores `Option<&'static dyn …>`. `LinkerContext.rs:59-60`: replace the module-scope `#[cfg(feature = "show_crash_trace")] link_impl_BundleGenerateChunkCtx! { … }` with `#[cfg(feature = "show_crash_trace")] fn format_bundle_generate_chunk(w: &mut dyn core::fmt::Write, tag: u32, ctx: *const ()) { … } #[cfg(feature = "show_crash_trace")] pub fn register_action_formatter() { bun_sys::crash_handler::ACTION_FORMATTER.set(format_bundle_generate_chunk).ok(); }` (a bare `.set(…)` expression at module scope is a parse error; cfg-stripping runs after parsing); call `register_action_formatter()` from `LinkerContext::new()` (per-bundle, idempotent via `OnceLock`). **Impl-side rewrites in `bun_runtime`** (the declarer-side macros no longer exist after this sub-step): `src/runtime/bake/dev_server/mod.rs:1123` replace `bun_bundler::link_impl_DevServerHandle! { … }` with `impl bun_bundler::DevServerHooks for DevServer { …11 methods… }`; `src/runtime/vm/init.rs` (was `jsc_hooks.rs:1408`) replace `bun_bundler::link_impl_VmLoaderCtx! { … }` with `impl bun_bundler::VmLoaderHooks for VmLoaderCtxImpl { …13 methods… }`. Add `bun_jsc`, `bun_crypto`, `bun_http` to `src/bundler/Cargo.toml` deps (the mounted `standalone_graph` sources reference `bun_http::{http_thread,AsyncHTTP,Method,FetchRedirect,Error}` at `StandaloneModuleGraph.rs:1525,1555-1556,1564` / `error.rs:24` and `bun_exe_format::` → `bun_crypto::` post-Step-5.6 at `:15,308`; `src/bundler/Cargo.toml` has neither today, matching §1 tier-5 line 77 / §7 C1).
4. `src/install/lib.rs`: `#[path]`-mount `bunfig`. `auto_installer.rs:457`: delete `#[no_mangle] __bun_resolver_init_package_manager`. `[features] shim_standalone = []`. (`bun_install::init()` was already added in Step 7.9.)
5. Tree-wide `sed` + Cargo.toml for `js_parser`/`js_printer`/`router`/`standalone_graph`/`transpiler`/`bunfig`.

### Step 9: In-crate vtable → enum conversions

1. `runtime/webcore/Sink.rs`: `VTable` → `enum SinkKind { FileSink, ArrayBufferSink, HTTPResponseSink, … }`; `Sink.vtable` → `Sink.kind`.
2. `runtime/webcore/streams.rs`: `SignalVTable` → `enum SignalKind`.
3. `runtime/shell/interpreter.rs:2652`, `builtin/mkdir.rs:374`, `builtin/rm.rs:1654`: vtable → enum.
4. `jsc/ipc.rs` (now `runtime/vm/ipc.rs`): `*mut dyn SendQueueOwner` → `enum SendQueueOwner { Instance(NonNull<IPCInstance>), Subprocess(NonNull<SubprocessT<'static>>) }`.

### Step 10: Codegen script updates

1. `src/codegen/generate-host-exports.ts:59-60`: `scanRoots` stays `[{dir: src/runtime, crate: "bun_runtime"}, {dir: src/jsc, crate: "bun_jsc"}]` (group-B files are `#[path]`-mounted so they're scanned under `src/jsc/` disk path but emit `bun_runtime::` crate prefix — add a `mountedIn` override map for the 38 group-B filenames). `:503-506` import table: `["bun_jsc::virtual_machine", …]` → `["bun_runtime::vm", "VirtualMachine"]`, `["bun_runtime::vm::debugger", "LifecycleHandle"]`, `["bun_runtime::vm::debugger", "TestReporterHandle"]`.
2. `src/codegen/generate-js2native.ts:98`: `"virtual_machine_exports.rs": "jsc/virtual_machine_exports.rs"` → `"runtime/vm/virtual_machine_exports.rs"` (or keep disk path, update crate prefix). `:330`: leave `crate::dispatch::js2native::` emission as-is; the `pub mod dispatch { pub use crate::task_dispatch::js2native; }` compatibility alias was added to `runtime/lib.rs` at Step 7.9.
3. `src/codegen/generate-classes.ts:2141-2143`: `src/jsc/*.classes.ts` routing via `bun_jsc::` re-exports: no change needed. `BuildMessage`/`ResolveMessage` stay in group-A `bun_jsc` (per §2.1), so the existing `pub use bun_jsc::{BuildMessage, ResolveMessage}` at `src/runtime/api.rs:38-39` remains correct.

### Step 11: Build scripts & CI

1. `scripts/build/rust.ts`: no change to `-p bun_bin` / `-p bun_shim_impl` invocations. Update comment at `:775`.
2. `scripts/rust-miri.ts:34-47`: `MIRI_CRATES = ["bun_core", "bun_macros", "bun_ast", "bun_opaque"]`.
3. `scripts/bench-json-rust.sh:59,61`: `-p bun_parsers` → `-p bun_ast --bench json`.
4. `src/parsers/native_test_shims.rs`: expand `#[no_mangle]` stubs for the merged `bun_ast`'s full `extern "C"` surface (simdutf, highway, zstd). Or gate `bun_ast`'s FFI modules behind `#[cfg(not(test))]`.
5. Add to `scripts/build/ci.ts` lint step: `cargo check -p bun_shim_impl --features shim_standalone --target x86_64-pc-windows-msvc` (no link; catches shadow-module drift).
6. `src/js_parser/Cargo.toml` `[[bench]]` → `src/js/Cargo.toml`.
7. (`show_crash_trace` feature-forward rewrites were done at Step 4.4.)
8. `Cargo.toml:449`: `[profile.release.package.bun_react_compiler]` unchanged.

### Step 12: Comment & doc cleanup

1. `scripts/` one-liner: delete all `// … PORTING.md …` comment lines that match the 327 §rule patterns (regex in §5).
2. Strip the `PORTING.md` citation from the 11 lifetime-threading notes listed in §8.3 (`bake_body.rs`, `UpdateRequest.rs`, `css_parser.rs`, …); keep the note body. These don't match the §5 regex (different prefix), so they survive 12.1.
3. Rewrite 11 surviving `LAYERING:` comments to name the `OnceLock`/`dyn` seam.
4. `src/CLAUDE.md`: `bun_sys_jsc::ErrorJsc` → `bun_jsc::SysErrorJsc`; update crate list.
5. `scripts/clippy-loop/fix-round.workflow.ts:76,103`: update wrapper-crate references.
6. `scripts/generate-perf-trace-events.sh:20,23`: `bun_perf::trace` → `bun_sys::perf::trace`.

### Step 13: Delete absorbed crate manifests

1. `Cargo.toml` `[workspace] members`: reduce to the 22 crates in §1.
2. Delete `Cargo.toml` + `build.rs` for the remaining 64 absorbed crates (12 of the 76 were already deleted at Steps 5.5 and 7.5; source `.rs` files stay on disk for `#[path]` mounts).
3. Absorbing crates' `build.rs` add `println!("cargo:rerun-if-changed=../<absorbed>/");` for each mounted source dir.
4. `cargo check --workspace && bun run rust:check-all && bun bd && bun bd test`.

---

## 8.2 Accepted costs

- **Debug cold-build prefix serialization.** `bun_core` (86k) + `bun_sys` (49k) compile serially before any fan-out, vs today's ~33k + parallel siblings. Estimated ~1.5–2× wall-clock on that prefix. `-Zthreads=8` (`scripts/build/rust.ts:423-438`) partially mitigates. Release unaffected (`lto = "fat"` + `codegen-units = 1` already serialize, per `Cargo.toml:114-131`).
- **`bun_runtime` at ~392k LOC** (from 331k). Longer incremental rebuild when touching any runtime/VM/console/SQL-driver/WebSocket code. Buys: elimination of all hook tables and `*mut c_void` VM fields.
<!-- prettier-ignore -->
- **`OnceLock<fn-struct>` vs link-time.** The `OnceLock` tables + `AtomicUsize` hooks (Appendix B) replace 20 `extern "Rust"` blocks. Each call is now `static.get().unwrap().slot(…)` vs a direct symbol: `OnceLock::get` is an **acquire** load on the init flag (a plain `mov` on `x86_64` under TSO; `ldar` on `aarch64`) plus one indirect call through the stored fn pointer. The current `extern "Rust"` path is already an indirect call (cross-crate, resolved at link time, not inlined without LTO), so the delta is the acquire load + the `Option` null check; benchmark the hot paths (`TIMER_DISPATCH`, `POLL_DISPATCH`, `TASK_DISPATCH`, `__VTABLES_BufferedReaderParentLink`) in the implementation PR rather than asserting equivalence here. `JS_LOOP_VTABLE` calls sit behind an `EventLoopCtx::Js` branch that already exists. The two `__VTABLES_*` arrays use `Relaxed` (not `Acquire`) loads: the pointed-to `MethodTable` is `const` (fully initialized before `main`), so no release/acquire pair is needed to publish its contents.

## 8.3 Out of scope

- Splitting `bun_runtime` into `runtime_core`/`runtime_cli` for build parallelism (cli/ is 54k, test_runner/ 21k, bake/ 20k; viable follow-up).
- The 13 `TODO(port)` real-work items (lifetime threading in `bake`/`UpdateRequest`/`css`; react-compiler HIR gaps).
- Replacing `bun_collections` hand-written containers with crates.io equivalents (~30k LOC potential but behavioral risk).
- Replacing `AllocatorVTable` with `dyn Allocator` (address-identity is load-bearing).
- Converting `InternalSocket` variants to `dyn SocketTransport` (C-ABI boundary).
- Any behavioral change.

---

## Appendix A: Full per-file `bun_jsc` A/B classification

See §2.1. The source-of-truth table (118 files) is derived from scanning each file's imports against the group-B crate list plus intra-crate `crate::{virtual_machine,module_loader,console_object,event_loop,rare_data}` paths; Step 6.7's grep enforces zero hits over group-A. Files with ≤3 B-tier reference lines that become A after trivial edits: `JSGlobalObject`, `CachedBytecode`, `uuid`, `webcore_types` (minus S3 block), `BuildMessage`, `ResolveMessage`. Files that are structurally B despite small import count: `AbortSignal` (embeds `EventLoopTimer`, calls `VirtualMachine::timer_*`), `FetchHeaders.to_uws_response`, `SystemError` uws-helper.

## Appendix B: `OnceLock` registry inventory

<!-- prettier-ignore -->
| Static                               | Defined in               | Set by                         | Slots  | Hot path?               |
| ------------------------------------ | ------------------------ | ------------------------------ | ------ | ----------------------- |
| `OUTPUT_SINK`                        | `bun_core`               | `bun_sys::init`                | 11     | No (stderr/logger init) |
| `PANIC_HOOK`, `STACK_TRACE_HOOK`     | `bun_core`               | `bun_sys::crash_handler::init` | 1 each | No                      |
| `REGEX_ENGINE`                       | `bun_ast`                | `bun_bin::main` (process init) | 3      | No (bunfig parse)       |
| `PREFETCH_HOOK`                      | `bun_sys::dns`           | `bun_bin::main` (process init) | 1      | No                      |
| `ACTION_FORMATTER`                   | `bun_sys::crash_handler` | `bun_bundler::LinkerContext::new` | 1   | No (crash only)         |
| `JS_LOOP_VTABLE`                     | `bun_loop`               | `bun_runtime` VM init          | 21     | Yes (event-loop tick)   |
| `TIMER_DISPATCH`                     | `bun_loop`               | `bun_bin::main` (process init) | 2      | Yes                     |
| `POLL_DISPATCH`                      | `bun_loop`               | `bun_bin::main` (process init) | 3      | Yes                     |
| `TASK_DISPATCH`                      | `bun_loop`               | `bun_bin::main` (process init) | 1      | Yes                     |
| `HOT_RELOAD_HOOK`                    | `bun_bundler`            | `bun_bin::main` (process init) | 1      | No (`bun build --watch`)|
| `MACRO_GC_HOOK`                      | `bun_js`                 | `bun_bin::main` (process init) | 1      | No (worker teardown)    |
| `__VTABLES_BufferedReaderParentLink` | `bun_loop`               | `bun_bin::main` (process init) | 13×7   | Yes (pipe read)         |
| `__VTABLES_ProcessExit`              | `bun_loop`               | `bun_bin::main` (process init) | 12×1   | No (once per process)   |

All set-once at init, read-many. `JS_LOOP_VTABLE` is set at VM init and only read behind an `EventLoopCtx::Js` branch, so the `bun_install` / `MiniEventLoop` path (no VM) never reaches its `.get().unwrap()`. `{TIMER,POLL,TASK}_DISPATCH`, `REGEX_ENGINE`, `PREFETCH_HOOK`, `HOT_RELOAD_HOOK`, `MACRO_GC_HOOK`, and the two `__VTABLES_*` arrays are **not** guarded that way (`FilePoll::on_update` calls `POLL_DISPATCH` unconditionally and `bun install` creates `FilePoll`s for lifecycle-script pipes on Mini; `create_matcher` is reached from `.npmrc` parsing without a VM; `install_with_manager.rs:59` calls `prefetch` for registry DNS on Mini; `bun build --watch` at `bundle_v2.rs:2865` is a CLI command, not bake), so they are set at process init from `bun_bin::main` via `bun_runtime::register_dispatch_tables()` before any CLI command runs.
