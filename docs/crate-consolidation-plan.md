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
| `PORTING.md` comment refs                                            | 396            | 0                                      |
| `LAYERING:` comment refs                                             | 92             | 0                                      |
| Net LOC deleted                                                      | —              | ~15,000 (see §6 for honest accounting) |
| LOC relocated                                                        | —              | ~440,000                               |

**Load-bearing change:** `bun_jsc` is split. The pure JSC FFI bindings (~17k LOC: `JSValue`, `JSGlobalObject`, `Strong`, `Weak`, `host_fn`, `array_buffer`, etc.) stay as `bun_jsc` and depend on nothing above `bun_core`/`bun_sys`/`bun_ast`. The runtime machinery (~37k LOC: `VirtualMachine`, `ModuleLoader`, `ConsoleObject`, `event_loop`, `ipc`, `web_worker`, `hot_reloader`, `rare_data`) moves into `bun_runtime`. This inverts the graph so that `VirtualMachine` can hold a `Transpiler`, `PackageManager`, and `ServerEntryPoint` as real typed fields instead of `*mut c_void` + function-pointer hook tables.

**What this plan does not do** (with evidence in §4): it does not eliminate every `dyn`, every vtable, or every cross-crate dispatch mechanism. Four dispatch sites are kept because converting them would introduce unsoundness (Stacked Borrows violations), wrong ownership semantics, or lose C-ABI compatibility. The `bun_dispatch` crate is not deleted; it is folded into `bun_macros` and used at 2 remaining sites instead of 10. The −100,000 LOC target is not achievable through relayering alone; the honest figure is ~15k deleted (see §6).

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

| Crate        | Absorbs                                                                                                                                                                                   | LOC     | Depends on                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------- |
| `bun_crypto` | `bun_boringssl_sys`, `bun_boringssl`, `bun_sha_hmac`, `bun_csrf`, `bun_s3_signing`, `bun_exe_format`                                                                                      | ~6,700  | `bun_core`, `bun_sys`                             |
| `bun_ast`    | `bun_ast`, `bun_parsers`, `bun_sourcemap`, `bun_dotenv`, `bun_options_types`, `bun_install_types`, `bun_resolve_builtins`, `bun_shell_parser`, `bun_md`, `bun_clap`, `bun_api`, `bun_ini` | ~73,000 | `bun_core`, `bun_sys`, `bun_macros`               |
| `bun_jsc`    | (group-A half of current `bun_jsc`; see §2.1 for the per-file table)                                                                                                                      | ~18,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_macros`    |
| `bun_uws`    | `bun_uws_sys`, `bun_uws`                                                                                                                                                                  | ~11,100 | `bun_core`, `bun_sys`, `bun_crypto`, `bun_macros` |

### Tier 4: engine (fan-out after tier 3)

| Crate                | Absorbs                                                                 | LOC     | Depends on                                             |
| -------------------- | ----------------------------------------------------------------------- | ------- | ------------------------------------------------------ |
| `bun_react_compiler` | (unchanged)                                                             | 63,000  | `bun_core`, `bun_ast`                                  |
| `bun_css`            | (unchanged)                                                             | 72,000  | `bun_core`, `bun_sys`, `bun_ast`, `bun_macros`         |
| `bun_loop`           | `bun_io` (minus `write.rs`), `bun_event_loop`, `bun_spawn`, `bun_patch` | ~22,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_uws`            |
| `bun_sql`            | `bun_sql`                                                               | 6,000   | `bun_core`, `bun_sys`, `bun_crypto`                    |
| `bun_js`             | `bun_js_parser`, `bun_js_printer`                                       | ~57,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_react_compiler` |

### Tier 5: toolchain

| Crate          | Absorbs                                                 | LOC     | Depends on                                                                                                                            |
| -------------- | ------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `bun_resolver` | `bun_resolver`, `bun_router`                            | ~20,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_js`, `bun_jsc`                                                                                 |
| `bun_http`     | `bun_http`                                              | ~18,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_crypto`, `bun_uws`, `bun_loop`                                                                 |
| `bun_bundler`  | `bun_bundler`, `bun_transpiler`, `bun_standalone_graph` | ~50,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_crypto`, `bun_uws`, `bun_loop`, `bun_js`, `bun_css`, `bun_resolver`, `bun_jsc`, `bun_http`     |
| `bun_install`  | `bun_install`, `bun_bunfig`                             | ~82,000 | `bun_core`, `bun_sys`, `bun_ast`, `bun_crypto`, `bun_uws`, `bun_loop`, `bun_js`, `bun_resolver`, `bun_jsc`, `bun_http`, `bun_bundler` |

### Tier 6: top

| Crate           | Absorbs                                                                                   | LOC      | Depends on                                           |
| --------------- | ----------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| `bun_runtime`   | `bun_runtime`, group-B of `bun_jsc`, all 11 `*_jsc` crates, `bun_sql_jsc`, `bun_http_jsc` | ~392,000 | (all of the above except `bun_bin`, `bun_shim_impl`) |
| `bun_bin`       | (unchanged)                                                                               | 260      | `bun_core`, `bun_sys`, `bun_runtime`                 |
| `bun_shim_impl` | (unchanged, separate binary)                                                              | 400      | `bun_opaque`, `bun_windows_sys`                      |

**DAG proof:** Every `Depends on` cell references only crates listed earlier in the table (strictly lower tier, or same tier but earlier row). Intra-tier edges: tier 3 `bun_jsc→bun_ast`, `bun_uws→bun_crypto`; tier 4 `bun_js→bun_react_compiler`; tier 5 `bun_bundler→{bun_resolver,bun_http}`, `bun_install→{bun_resolver,bun_http,bun_bundler}`. None has a reverse edge. `cargo metadata` will reject any cycle at step 13 of the migration; the adversarial review in §7 verified every edge against current imports.

---

## 2. Per-crate detail

### 2.1 `bun_jsc` — the load-bearing split

Today `bun_jsc` (54,148 LOC) depends on `bun_install`, `bun_bundler`, `bun_http`, `bun_resolver`, `bun_spawn`, `bun_transpiler`, `bun_patch` because `VirtualMachine` holds instances of those crates' types. After the split, `bun_jsc` is the pure FFI layer and `VirtualMachine` lives in `bun_runtime`.

**Group A (stays in `bun_jsc`, ~18k LOC):** `AnyPromise`, `BunCPUProfiler`, `BunHeapProfiler`, `CallFrame`, `CommonAbortReason`, `CommonStrings`, `Counters`, `CustomGetterSetter`, `DOMFormData`, `DOMURL`, `DecodedJSValue`, `DeferredError`, `DeprecatedStrong`, `ErrorCode`, `Errorable`, `EventType`, `Exception`, `FFI`, `GetterSetter`, `JSArray`, `JSArrayIterator`, `JSBigInt`, `JSCell`, `JSErrorCode`, `JSFunction`, `JSMap`, `JSModuleLoader`, `JSONLineBuffer`, `JSObject`, `JSPromise`, `JSPromiseRejectionOperation`, `JSPropertyIterator`, `JSRef`, `JSRuntimeType`, `JSSecrets`, `JSString`, `JSType`, `JSUint8Array`, `JSValue`, `MarkedArgumentBuffer`, `RefString`, `RegularExpression`, `ResolvedSource`, `ScriptExecutionStatus`, `SourceProvider`, `SourceType`, `StringBuilder`, `Strong`, `TextCodec`, `TopExceptionScope`, `URL`, `URLSearchParams`, `VM`, `WTF`, `Weak`, `ZigErrorType`, `ZigException`, `ZigStackFrame`, `ZigStackFrameCode`, `ZigStackTrace`, `ZigString`, `array_buffer`, `bindgen`, `bindgen_test`, `bindings/GeneratedBindings`, `bun_string_jsc`, `codegen`, `comptime_string_map_jsc`, `cpp`, `fmt_jsc`, `generated`, `host_fn`, `host_object`, `jsc_abi`, `node_path`, `resolve_path_jsc`, `resolver_jsc`, `sizes`, `build.rs`.

Plus, after trivial edits (≤3 lines each): `JSGlobalObject` (delete the `pub use bun_bundler::transpiler::BunPluginTarget` re-export; move `run_on_load_plugins`/`run_on_resolve_plugins`/`throw_invalid_scrypt_params` to a `JSGlobalObjectExt` trait in `bun_runtime`), `CachedBytecode` (keep; `Format` comes from `bun_ast` which is now a dep; `IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE` thread-local and `jsc::initialize()` stay here since they touch only WTF/VM C FFI), `uuid` (use `bun_core::rand_fill` which forwards to `getrandom` syscall, not `boringssl::rand_bytes`), `webcore_types` (move the `S3` sub-struct block at L823-892 to `bun_runtime::webcore::blob`; rest stays), `BuildMessage`/`ResolveMessage` (stay; use `bun_ast::Msg`; rewrite `bun_resolver::is_package_path` → `bun_core::is_package_path` at `ResolveMessage.rs:160,204`, it is a pure re-export of `bun_paths::is_package_path` which folds into `bun_core` at Step 3).

**Group B (moves to `bun_runtime`, ~37k LOC; becomes `src/runtime/vm/`):** `VirtualMachine`, `ModuleLoader`, `AsyncModule`, `ConsoleObject`, `Debugger`, `event_loop`, `hot_reloader`, `ipc`, `rare_data`, `web_worker`, `RuntimeTranspilerStore`, `RuntimeTranspilerCache`, `virtual_machine_exports`, `btjs`, `error` (the wide `CrateError`), `HTTPServerAgent`, `GarbageCollectionController`, `NodeModuleModule`, `PluginRunner`, `PosixSignalHandle`, `ProcessAutoKiller`, `SavedSourceMap`, `WorkTask`, `ConcurrentPromiseTask`, `CppTask`, `JSCScheduler`, `Task`, `EventLoopHandle`, `any_task_job`, `AbortSignal` (embeds `EventLoopTimer` by value and calls `VirtualMachine::timer_insert`), `FetchHeaders` (the `to_uws_response` helper only; the opaque handle + getters stay in group A as `FetchHeadersCore`), `SystemError` (the `us_bun_verify_error_t` helper only), `ZigStackFramePosition`, `lib.rs` runtime-glue half.

**No migration needed:** `generated_classes_list.rs` is already `#[path]`-mounted from `src/runtime/lib.rs:51` (not from `src/jsc/lib.rs`) precisely because every alias is a `bun_runtime` module path; it stays where it is.

**What this unlocks:** `bun_bundler` and `bun_install` can now depend on `bun_jsc` directly (for `RegularExpression`, `CachedBytecode::generate`), and `bun_runtime` can have `VirtualMachine { transpiler: Transpiler, package_manager: Option<Box<PackageManager>>, entry_point: ServerEntryPoint, timer: timer::All, … }` with real types.

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

Absorbs `bun_bunfig`. Declares `[features] shim_standalone = []` for the `#[path]`-mounted shim source. The `create_matcher`/`PnpmMatcher` regex path stays routed through `bun_ast::REGEX_ENGINE` (§2.4); `bun_install` does not call `bun_jsc::RegularExpression` directly (the `bun_jsc` dep is for the `bun_ast` → `bun_jsc` transitive chain only, not a direct import).

`__bun_resolver_init_package_manager` is deleted. Control inverts: `bun_install` constructs its `PackageManager`, then hands `Some(&*pm as &dyn AutoInstaller)` to the `Resolver`. The `dyn AutoInstaller` trait (defined in `bun_ast::resolver_hooks`) stays; it is a legitimate optional-capability trait object with one impl, and the alternative (making `Resolver<A: AutoInstaller>` generic) would monomorphize 17k LOC twice.

### 2.8 `bun_runtime`

Grows from ~331k to ~392k LOC. Absorbs:

- Group B of `bun_jsc` → `src/runtime/vm/`
- All 11 `*_jsc` crates → modules (`src/runtime/{sql,http_ws,css_jsc,…}/`); `sql_jsc` is 15k LOC of real driver code, not glue, and becomes `src/runtime/sql/`
- `SpawnSyncEventLoop` → `src/runtime/vm/spawn_sync.rs` (was only ever called from VM code)

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
| `__bun_dns_prefetch`                                                                                                                                 | `dns` → `runtime`                   | `bun_sys::dns::PREFETCH_HOOK: OnceLock<fn(&[u8],u16)>`                             |
| `__bun_macro_context_{init,deinit,call,get_remap}`, `__bun_macro_collect_vm_garbage`                                                                 | `js_parser` → `js_parser_jsc`       | `bun_js::MacroContext` holds `Option<Box<dyn MacroRunner>>`; impl in `bun_runtime` |
| `__bun_jsc_generate_cached_bytecode`                                                                                                                 | `bundler` → `bun_jsc`               | Direct call: `bun_jsc::CachedBytecode::generate(…)` (bundler now depends on jsc)   |
| `__bun_jsc_enable_hot_module_reloading_for_bundler`                                                                                                  | `bundler` → `bun_jsc` (group B)     | `bun_bundler::HOT_RELOAD_HOOK: OnceLock<fn(…)>`                                    |
| `__bun_get_vm_ctx`, `__bun_js_vm_get`, `__bun_js_event_loop_current`, 8×`__bun_spawn_sync_*`, `__bun_stdio_blob_store_{new,deinit}`                  | `io`/`event_loop` → `jsc`/`runtime` | All covered by `bun_loop::JS_LOOP_VTABLE: OnceLock<JsLoopVTable>`                  |
| `__bun_run_file_poll`, `__bun_io_pollable_on_{ready,io_error}`                                                                                       | `io` → `runtime`                    | `bun_loop::POLL_DISPATCH: OnceLock<PollDispatchVTable>`                            |
| `__bun_fire_timer`, `__bun_js_timer_epoch`                                                                                                           | `event_loop` → `runtime`            | `bun_loop::TIMER_DISPATCH: OnceLock<TimerDispatchVTable>`                          |
| `__bun_tick_queue_with_count`, `__bun_run_immediate_task`, `__bun_cancel_pending_immediate`, `__bun_run_wtf_timer`, `__bun_release_task_at_shutdown` | `bun_jsc` (group B) → `runtime`     | Same-crate after split: direct calls in `bun_runtime::vm::event_loop`              |
| `__BUN_RUNTIME_HOOKS`, `__BUN_LOADER_HOOKS`                                                                                                          | `bun_jsc` (group B) → `runtime`     | Deleted; bodies become `impl VirtualMachine`                                       |
| `__bun_blob_from_build_artifact`                                                                                                                     | `bun_jsc` (group B) → `runtime`     | Same-crate after split: direct call                                                |
| `__BUN_SQL_RUNTIME_HOOKS`                                                                                                                            | `sql_jsc` → `runtime`               | Same-crate after split: direct field access                                        |

**Result:** zero `extern "Rust"` blocks remain. The 36 symbols (33 fns + 3 statics, per the source audit in `research-catalogs.md` §A) are replaced by a mix of mechanisms; buckets here are by replacement kind, not a partition: same-crate direct calls/deletions after the split, `OnceLock` registrations, `AtomicUsize` hooks, and `dyn Trait`. Appendix B is the authoritative inventory of all 12 runtime-registered statics introduced across §3.1 and §3.2 combined (10 `OnceLock`/`AtomicUsize` + 2 `AtomicPtr` arrays).

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

**Population A: comments containing `PORTING.md` (396 matches).** 327 historical §rule citations (§Forbidden, §Allocators, §Global mutable state, §Concurrency, §Idiom map, §JSC types, §Strings, §Pointers, §FFI, §Comptime reflection, §Collections, §Logging) + 57 layering-workaround annotations + 11 lifetime-threading notes that cite PORTING.md + 1 external BoringSSL URL. Disposition: delete the 327 historical citations (the referenced document no longer exists); delete 46 of the 57 layering annotations with the code they annotate; rewrite the remaining 11 layering annotations to name the `OnceLock`/`dyn` that now carries the seam; keep the 11 lifetime-threading notes; keep the BoringSSL URL.

**Population B: comments containing `LAYERING:` (92 matches).** These partially overlap the 57 layering annotations above. Same disposition applies.

**Separately:** 2 `TODO(port)` comments in `react_compiler` (not PORTING.md references; real feature gaps) stay as tracked in §8.3.

---

## 6. LOC accounting (honest)

| Category                                                                                                                                                                     | LOC deleted | Evidence                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `RuntimeHooks`/`LoaderHooks`/`SqlRuntimeHooks` structs + statics + `*mut c_void` casts in `jsc_hooks.rs`/`hw_exports.rs`                                                     | ~1,600      | `jsc_hooks.rs` is 5,378 LOC but ~3,800 is hook **bodies** that become `impl VirtualMachine` methods (relocated, not deleted) |
| `#[no_mangle]` wrappers + `extern "Rust"` decls (36 symbols × ~8 lines avg, both sides)                                                                                      | ~600        | Replaced by `OnceLock.set(…)` calls (~200 lines added) → net ~400                                                            |
| `link_interface!` decls + `link_impl_*!` calls for the 8 eliminated interfaces                                                                                               | ~450        | 8 interfaces × ~25 lines decl + 10 impls × ~20 lines                                                                         |
| `bun_dispatch` `extern "Rust"` codegen path                                                                                                                                  | ~120        | Macro body that emits `unsafe extern "Rust" { … }` → replaced by `AtomicPtr` array codegen                                   |
| Facade crates: `transpiler`(10), `output`(51), `api`(78 minus 40-line `Parser` kept)                                                                                         | ~100        |                                                                                                                              |
| `bun_uws` re-export lines + redundant docs                                                                                                                                   | ~60         | 22 `pub use` lines + ~40 lines of "distinct from sys" commentary                                                             |
| 76 deleted `Cargo.toml` files (~35 lines avg) + 76 `lib.rs` crate-attr headers (~15 lines avg)                                                                               | ~3,800      |                                                                                                                              |
| `ErasedJsError`/`JsError` twin (partial; `bun_loop` still can't name `JsError`)                                                                                              | ~30         |                                                                                                                              |
| `dyn SendQueueOwner` + `dyn HotReloadTaskView` machinery                                                                                                                     | ~80         |                                                                                                                              |
| `Sink::VTable`/`SignalVTable`/`OutputTaskVTable`/`Mkdir`/`Rm` → enums                                                                                                        | ~350        | ~600 LOC of vtable structs → ~250 LOC of enum+match                                                                          |
| `sql_jsc/jsc.rs` opaque façade (`SSLConfig` boxed-opaque, duplicate `boringssl_err_to_js`)                                                                                   | ~400        |                                                                                                                              |
| `bun_alloc::String`↔`bun_core::String` transparent-newtype glue, `bun_core::perf` T0 fork, `spawn_ffi` dup                                                                  | ~500        |                                                                                                                              |
| Dead Cargo deps (`analytics→sys`, `http→dispatch`, `dotenv→dispatch`, `options_types→libarchive/zlib`, `js_parser→dispatch`, `css_jsc→js_parser`)                            | ~15         |                                                                                                                              |
| `BundleOptions` forward-decl in `resolver/options.rs` + `resolver_bundle_options_subset()`                                                                                   | ~120        |                                                                                                                              |
| `src/ptr/{owned,shared}.rs` OBSOLETE modules (2 remaining callers migrated)                                                                                                  | ~600        |                                                                                                                              |
| **PORTING.md / LAYERING comments** (327 historical + 46 mechanism)                                                                                                           | ~1,200      | avg ~3 lines per comment block                                                                                               |
| Generated per-variant `extern "Rust"` decls from `link_interface!` (10 interfaces × ~6 methods × ~5 variants avg × 2 lines, in macro output not source, but counted by `wc`) | ~3,500      | Source-visible: 0. Macro-expanded: yes. Conservatively excluded.                                                             |
| **Total (source-visible deletions)**                                                                                                                                         | **~10,000** |                                                                                                                              |
| **With comment cleanup**                                                                                                                                                     | **~11,200** |                                                                                                                              |
| **With Cargo.toml/boilerplate**                                                                                                                                              | **~15,000** |                                                                                                                              |

**Relocated (not deleted):** ~440,000 LOC moves between crates. `bun_runtime` grows ~61k; `bun_core` grows ~53k; `bun_ast` grows ~53k; `bun_sys` grows ~26k.

**The −100,000 target is not achievable through relayering.** Reaching it would require deleting functionality or rewriting major subsystems (e.g., replacing `bun_collections::MultiArrayList`/`HiveArray`/`array_hash_map` with std/crates.io equivalents, ~30k LOC; replacing the hand-written `bun_alloc` arena/BSS machinery, ~5k; rewriting `ConsoleObject`, ~6k). Those are separate projects with behavioral risk.

---

## 7. Adversarial review objections and resolutions

24 reviewers (3 whole-proposal + 3×7 per-decision) produced 42 distinct objections. Each is restated and resolved below.

| #              | Objection                                                                                                           | Resolution                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1             | `bun_sys ↔ bun_crypto` cycle via `exe_format→sha_hmac`                                                             | `exe_format` moved to `bun_crypto` (§2.3); its sole consumer `standalone_graph` is in `bun_bundler` which depends on `bun_crypto`                                                                                 |
| C2/S7/M4/M13   | `FmtAdapter`/`FixedBufferStream`/`BufWriter` are in `bun_io`, not `bun_core`; 6 crates need them without `bun_loop` | `src/io/write.rs` (470 LOC, zero event-loop coupling) moves to `bun_core::io` as step 2 prerequisite (§2.2)                                                                                                       |
| C3/S8          | `JSGlobalObject` re-exports `BunPluginTarget` from bundler; `CachedBytecode` needs `options_types::Format`          | `BunPluginTarget` moves to `bun_ast` (§2.4); `bun_jsc` depends on `bun_ast` (§1 tier 3); `run_on_*_plugins` move to ext-trait in `bun_runtime` (§2.1)                                                             |
| C4/S6/M6       | `PnpmMatcher` can't move to `install` (it's a `BunInstall` struct field)                                            | `PnpmMatcher` stays in `bun_ast`; `REGEX_ENGINE: OnceLock` replaces the extern (§2.4)                                                                                                                             |
| C5/M3/M4       | `bun_jsc` group-A dep list is wrong: `AbortSignal`/`FetchHeaders`/`SystemError`/`uuid` pull higher tiers            | `AbortSignal` moves to group B; `FetchHeaders.to_uws_response` and `SystemError` uws-helper move to group B ext-traits; `uuid` uses `getrandom` not boringssl (§2.1). `bun_jsc` deps are `core, sys, ast, macros` |
| C6             | `AbortSignal` calls `VirtualMachine::timer_*` → group B                                                             | Moved to group B (§2.1)                                                                                                                                                                                           |
| C8/M8          | `bun_loop` → `dotenv` severance underspecified (types in return signatures)                                         | `bun_loop` depends on `bun_ast` (which owns `dotenv`); acyclic (§2.5)                                                                                                                                             |
| C9/S5/M-sem5   | `UpgradedDuplex__*` replacement conflates C-event vs imperative dispatch                                            | Retracted: these are C-ABI and stay (§4.5)                                                                                                                                                                        |
| C10/C-dec4     | `__bun_jsc_enable_hot_module_reloading_for_bundler` can't be direct (hot_reloader is group B)                       | `OnceLock<fn>` hook in `bun_bundler` (§2.6)                                                                                                                                                                       |
| C11/C13/C-dec5 | 88k `bun_core` + 49k `bun_sys` serializes debug cold-build prefix ~2×                                               | Accepted cost; documented in §8.2. Release unaffected (fat LTO). `-Zthreads=8` partially mitigates                                                                                                                |
| C12/S10        | `bun_runtime` → ~392k LOC, 20% larger long pole                                                                     | Accepted cost; documented in §8.2                                                                                                                                                                                 |
| C14/M-sem14    | `analytics→sys` is a dead Cargo edge                                                                                | Delete before merge (§2.2)                                                                                                                                                                                        |
| C15            | `zlib`/`brotli` use `bun_io::Write`                                                                                 | Resolved by C2 (write.rs → core)                                                                                                                                                                                  |
| S1/M5          | `BufferedReaderParent` not object-safe, aliasing contract                                                           | Kept as `link_interface!` with `AtomicPtr` vtable-array codegen (§4.2)                                                                                                                                            |
| S2             | `ProcessExit` `Box<dyn>` wrong ownership                                                                            | Kept as `link_interface!` (§4.2)                                                                                                                                                                                  |
| S3             | `EventLoopCtx` enum would store 256KB `MiniEventLoop` by value                                                      | Both arms are `NonNull<>` pointers; 16-byte `Copy` handle (§2.5)                                                                                                                                                  |
| S4/M-sem3      | `Task→dyn Runnable` doesn't fit non-uniform signatures                                                              | Match stays in `task_dispatch.rs`; only binding mechanism changes (§4.3)                                                                                                                                          |
| S9             | `CachedBytecode` body uses `crate::virtual_machine::IS_BUNDLER_THREAD…`                                             | Thread-local + `jsc::initialize()` stay in group-A `bun_jsc` (they touch only WTF C FFI); verified no group-B imports (§2.1)                                                                                      |
| S11/M6/C-dec3  | `DevServerHandle`/`VmLoaderCtx` need a mechanism; `bun_dispatch` can't fully delete                                 | Both → `Option<&dyn Trait>` (§2.6); `bun_dispatch` folds into `bun_macros` for the 2 kept interfaces (§3.2)                                                                                                       |
| S12            | `bun_http` "drops ast edge" is self-contradictory                                                                   | Sentence deleted; `bun_http → bun_ast` edge stays (§1 tier 5)                                                                                                                                                     |
| S13/M-sem1-5   | −100k LOC inflated by 10×                                                                                           | §6 restates as ~15k with line-item table                                                                                                                                                                          |
| M1             | 24 crates unassigned in truncated proposal                                                                          | All 98 assigned in §1 table + §2.8/2.9                                                                                                                                                                            |
| M2             | (duplicate of C1)                                                                                                   | —                                                                                                                                                                                                                 |
| M7             | Codegen hardcodes `bun_jsc::virtual_machine` / `bun_jsc::debugger` / `crate::dispatch`                              | §8 step 10 updates `generate-host-exports.ts:503-506`, `generate-js2native.ts:98,330`, `generate-classes.ts:2141`                                                                                                 |
| M8             | `build.rs` assumes `../../` repo-root depth                                                                         | Source files stay in place, `#[path]`-mounted (§8 step 2 note); only absorbed crates' `Cargo.toml`/`build.rs` delete, absorbing crate's `build.rs` emits `rerun-if-changed` for the mounted paths                 |
| M9             | `cargo test -p bun_parsers` / bench targets / `native_test_shims.rs` break                                          | §8 step 11: update `scripts/bench-json-rust.sh`, `scripts/rust-miri.ts`; move `[[bench]]` to `bun_ast`; expand `native_test_shims.rs` for the merged crate's C-extern surface                                     |
| M10            | `show_crash_trace` feature chain not rewired                                                                        | `bun_sys` declares it; `bun_bundler`/`bun_runtime` forward (§2.3)                                                                                                                                                 |
| M11            | `shim_standalone` feature must be on `bun_install`                                                                  | Declared (§2.7)                                                                                                                                                                                                   |
| M12            | `bun_ast` missing `bun_macros` dep (absorbs `clap`)                                                                 | Added (§1 tier 3)                                                                                                                                                                                                 |
| M14            | `jsc_macros` emits `::bun_jsc::` paths                                                                              | `bun_jsc` keeps its name; `__macro_support` module stays at same path (§2.1 group A)                                                                                                                              |
| M15            | `src/CLAUDE.md` references `bun_sys_jsc::ErrorJsc`                                                                  | §8 step 12 updates docs; `bun_jsc::SysErrorJsc` is the surviving name                                                                                                                                             |
| M16            | Windows-shim shadow-module drift risk                                                                               | §8 step 11 adds `cargo check -p bun_shim_impl --target x86_64-pc-windows-msvc` to CI lint                                                                                                                         |
| M-sem2         | `jsc_hooks.rs` 5.4k is mostly logic, not glue                                                                       | §6 credits 1.6k, notes 3.8k relocates                                                                                                                                                                             |
| M-sem4         | `bun_uws` façade is 22 re-exports not 1000                                                                          | §6 credits 60 LOC                                                                                                                                                                                                 |
| M-dec3         | `sql`/`valkey`/`tcc_sys` unassigned                                                                                 | `sql`→own crate, `valkey`→`bun_core`, `tcc_sys`→`bun_sys` (§1)                                                                                                                                                    |
| M-dec5         | Windows-shim coupling spans `rust.ts`/`build.rs`/`#[path]`                                                          | `src/install/windows-shim/` stays on disk; `bun_install` `#[path]`-mounts unchanged; `rust.ts:793` unchanged (§8 step 11)                                                                                         |

---

## 8. Migration recipe

Each step leaves `cargo check --workspace` passing. Source files stay at their current disk paths; absorbing crates `#[path]`-mount them (so `build.rs` repo-root computation and codegen scanners keep working until step 10). The only exceptions are the two enum moves in Step 1.5 and the file renames in Step 7.8/7.9, which are noted explicitly.

**Every absorbing crate** adds `extern crate self as <crate_name>;` at the top of its `lib.rs` before `#[path]`-mounting. Mounted files reference the absorbing crate by its extern name (`bun_core::Error`, `bun_sys::Fd`, `bun_ast::Expr`), and a crate is not in its own extern prelude by default; without the self-alias every mount step fails E0433. The pattern is already in use at `src/jsc/lib.rs:32`, `src/install/lib.rs:12`, `src/css/lib.rs:6`. Applies at Steps 1.1 (`bun_core`), 3.1, 4.1, 5.1/5.2/5.5, 7.1/7.5, 8.1-8.4.

### Step 1: Prerequisites (no crate graph change)

1. `src/bun_core/lib.rs` adds `extern crate self as bun_core;` (see §8 preamble note) and `#[path = "../io/write.rs"] pub mod io;` (mounting `Write`, `FmtAdapter`, `FixedBufferStream`, `BufWriter`, `DiscardingWriter`, `AsFmt`, `Result` from their existing location). `src/io/lib.rs` replaces its `mod write;` with `pub use bun_core::io::*;`. `src/io/write.rs` stays on disk; only its crate-of-record changes.
2. Tree-wide `sed`: `bun_io::{Write,FmtAdapter,FixedBufferStream,BufWriter,Result,AsFmt,DiscardingWriter}` → `bun_core::io::…` (css, sourcemap, crash_handler, zlib, brotli, js_parser, js_printer).
3. Delete dead Cargo edges: `analytics→sys`, `http→dispatch`, `dotenv→dispatch`, `js_parser→dispatch`, `options_types→{libarchive,zlib}`, `css_jsc→js_parser`.
4. `src/jsc/uuid.rs:23`: replace `bun_boringssl::rand_bytes` with `bun_sys::getrandom` (or `libc::getentropy`).
5. Move `BunPluginTarget` enum from `src/bundler/transpiler.rs` → `src/ast/plugin_target.rs`; `bundler` re-exports it. Update `src/jsc/JSGlobalObject.rs:1510` to `pub use bun_ast::BunPluginTarget;`.

### Step 2: Create `bun_macros`

1. New `src/macros/{Cargo.toml,lib.rs}` with `proc-macro = true`. `lib.rs` `#[path]`-mounts `../bun_core_macros/lib.rs`, `../clap_macros/lib.rs`, `../jsc_macros/lib.rs`, `../css_derive/lib.rs`, `../dispatch/lib.rs` as `mod core_macros_impl;` etc. **`#[proc_macro*]` items must live at the crate root** (re-exports do not satisfy rustc), so in each mounted file rename `#[proc_macro…] pub fn foo` → `pub fn foo_impl` (plain fn), and in `src/macros/lib.rs` add one-line wrappers at the root: `#[proc_macro] pub fn foo(t: TokenStream) -> TokenStream { core_macros_impl::foo_impl(t) }`. Same for `#[proc_macro_derive]`/`#[proc_macro_attribute]` (~18 wrappers total).
2. Rewrite `dispatch/lib.rs` codegen: replace the `unsafe extern "Rust" { … }` emission with (declarer side) `pub static __VTABLES_<Iface>: [AtomicPtr<<Iface>MethodTable>; N] = [const { AtomicPtr::new(null_mut()) }; N];` and (impl side, per `link_impl_*!`) `static __VTABLE_<Variant>: <Iface>MethodTable = …; pub fn __register_<Iface>_<Variant>() { <declarer>::__VTABLES_<Iface>[<tag>].store(addr_of!(__VTABLE_<Variant>) as *mut _, Relaxed); }`. Dispatch reads `__VTABLES[tag].load(Relaxed)` (debug-assert non-null). No `extern "Rust"` in output; registration wired in Step 7.9.
3. Update `bun_core_macros` derive emissions: `::bun_ptr::` → `::bun_core::` (the items are flat-re-exported at `bun_core` root in Step 3.1). This rewrite is **required**, not optional: a `pub use crate as bun_ptr;` alias in `bun_core` does not put `bun_ptr` into downstream crates' extern prelude, so `::bun_ptr::…` in macro expansion would still fail there. 16 emission sites: `src/bun_core_macros/lib.rs:332,344,356,373,374,381,389,449,470,472,520,522,528,533,538,544`.
4. Every `Cargo.toml` that depends on one of the 5 absorbed proc-macro crates: replace with `bun_macros.workspace = true`. Add `bun_macros` to `[workspace.dependencies]`.

### Step 3: Merge `bun_core`

1. `src/bun_core/lib.rs`: `#[path]`-mount `../bun_alloc/lib.rs` as `pub mod alloc_impl;`, and likewise for `mimalloc_sys`, `simdutf_sys`, `wyhash`, `highway`, `hash`, `ptr`, `safety`, `collections`, `base64`, `errno`, `paths`, `libuv_sys` (cfg(windows)), `url`, `semver`, `http_types`, `analytics`, `picohttp`, `valkey`. Add flat re-exports at crate root matching the old crates' public surface: `pub use alloc_impl::*; pub use ptr::*; …`. **`crate::` paths inside mounted files** now resolve to `bun_core`, not the original crate root: the flat root re-exports cover every `crate::PublicItem`, but intra-crate submodule paths (`crate::posix`, `crate::hash_map`, `crate::path_buffer_pool`, `crate::zig_base64`) must be rewritten to `super::…` or the mount-point path. Grep each absorbed crate for `\bcrate::` and fix before the Cargo.toml switch; `cargo check -p bun_core` catches any miss.
2. Delete `link_interface! ErrnoNames` (`lib.rs:610`); callers use `crate::errno::SystemErrno::name()`.
3. Replace `link_interface! OutputSink` (`lib.rs:584`) with `pub struct OutputSinkVTable { pub stderr: fn()->output::File, … 11 slots … } pub static OUTPUT_SINK: OnceLock<OutputSinkVTable> = OnceLock::new();`. `src/sys/lib.rs:9680` `link_impl_OutputSink!` becomes `const SINK: OutputSinkVTable = …; pub fn register_output_sink() { bun_core::OUTPUT_SINK.set(SINK).ok(); }` called from `bun_sys::init()`.
4. Replace `extern "Rust" __bun_crash_handler_*` with `pub static PANIC_HOOK: AtomicUsize = …` / `STACK_TRACE_HOOK: AtomicUsize` (fn-pointer stored via `as usize`; `AtomicPtr<()>` would assume fn-pointer and data-pointer share representation, which Rust does not guarantee). Add `const _: () = assert!(size_of::<fn()->!>() == size_of::<usize>());` next to the statics. `bun_core` ships default bodies (print + abort).
5. `[features] debug_logs = []`.
6. Tree-wide `sed` (all `src/**/*.rs` + `src/**/Cargo.toml`): `bun_{alloc,mimalloc_sys,simdutf_sys,wyhash,highway,hash,ptr,safety,output,collections,base64,errno,paths,libuv_sys,url,semver,http_types,analytics,picohttp,valkey}::` → `bun_core::`. Same for `use bun_X` → `use bun_core`.
7. `scripts/rust-miri.ts:34-47`: `MIRI_CRATES` → `["bun_core", "bun_macros", "bun_ast"]`.

### Step 4: Merge `bun_sys`

1. `src/sys/lib.rs`: `#[path]`-mount `which`, `perf`, `platform`, `threading`, `spawn_sys`, `glob`, `watcher`, `libarchive`, `zlib`, `zlib_sys`, `zstd`, `brotli`, `brotli_sys`, `libdeflate_sys`, `tcc_sys`, `cares_sys` (as `pub mod cares`), `dns`, `crash_handler`. Flat re-exports.
2. `crash_handler/lib.rs`: replace `use bun_ast::ImportKind` with `&[u8]` param; delete `link_interface! BundleGenerateChunkCtx` → `pub static ACTION_FORMATTER: OnceLock<fn(&mut dyn core::fmt::Write, u32, *const ())>`; register `PANIC_HOOK`/`STACK_TRACE_HOOK` into `bun_core`.
3. `dns/lib.rs:492`: delete `extern "Rust" __bun_dns_prefetch`; add `pub static PREFETCH_HOOK: OnceLock<fn(*mut Loop, *const u8, usize, u16)> = OnceLock::new();`. `src/runtime/dns_jsc/dns.rs:3167`: replace `#[no_mangle]` with registration at VM init.
4. `[features] show_crash_trace = []`.
5. Tree-wide `sed` + Cargo.toml updates for absorbed crates (including `bun_cares_sys::` → `bun_sys::cares::`, `bun_dns::` → `bun_sys::dns::`).
6. `bun_bin/lib.rs:42`: `use bun_platform as _;` → `use bun_sys::platform as _;`.

### Step 5: Create `bun_crypto`; merge `bun_ast`; merge `bun_uws`

1. New `src/crypto/{Cargo.toml,lib.rs}` `#[path]`-mounting `boringssl_sys`, `boringssl`, `sha_hmac`, `csrf`, `s3_signing`, `exe_format`. `boringssl/lib.rs:10`: `use bun_cares_sys as c_ares;` → `use bun_sys::cares as c_ares;`.
2. `src/ast/lib.rs`: `#[path]`-mount `parsers`, `sourcemap`, `dotenv`, `options_types`, `install_types`, `resolve_builtins`, `shell_parser`, `md`, `clap`, `api`, `ini`. Add `pub use plugin_target::BunPluginTarget;`.
3. `install_types/NodeLinker.rs:87`: delete `extern "Rust" __bun_regex_*`; add `pub struct RegexEngineVTable { compile: fn(&[u8])->Option<NonNull<()>>, matches: fn(NonNull<()>, &[u8])->bool, drop: fn(NonNull<()>) } pub static REGEX_ENGINE: OnceLock<RegexEngineVTable> = OnceLock::new();`. `src/jsc/RegularExpression.rs:106-124`: replace `#[no_mangle]` with `fn yarr_compile(p: &[u8]) -> Option<NonNull<()>> { crate::initialize(false); … }` (keep the lazy WTF init that exists today at `:108`) + `const YARR: RegexEngineVTable = RegexEngineVTable { compile: yarr_compile, … }; pub fn register_regex() { bun_ast::REGEX_ENGINE.set(YARR).ok(); }`.
4. `ast/transpiler_cache.rs:52`: delete `link_interface! TranspilerCacheImpl`; add `pub trait TranspilerCache: Sync { fn is_disabled(&self)->bool; fn get(&self, …)->bool; fn put(&self, …); }`. `parser::Options.runtime_transpiler_cache: Option<&'static dyn TranspilerCache>`.
5. `src/uws_sys/Cargo.toml`: rename `name = "bun_uws"`. `#[path]`-mount `../uws/lib.rs` as `mod wrappers; pub use wrappers::*;`. Update deps to `bun_core, bun_sys, bun_crypto, bun_macros`. **In the same step** (Cargo rejects two workspace members with the same package name): delete `src/uws/Cargo.toml` (source `src/uws/lib.rs` stays on disk for the mount), drop `"src/uws"` from root `Cargo.toml` `[workspace].members`, and repoint `[workspace.dependencies].bun_uws` from `path = "src/uws"` to `path = "src/uws_sys"`. Delete `bun_uws_sys` from `[workspace.dependencies]`.
6. Tree-wide `sed` + Cargo.toml for absorbed crates → `bun_crypto::`/`bun_ast::`/`bun_uws::`.

### Step 6: Slim `bun_jsc` to group A

**Steps 6 and 7 form one `cargo check` unit.** Step 6 removes group-B `mod` declarations from `bun_jsc` while `bun_runtime` + the 11 `*_jsc` crates still import `bun_jsc::{virtual_machine, event_loop, …}`; the consumer-side rewrites are in Step 7.5/7.12. Do not stop between them.

1. `src/jsc/lib.rs`: remove `mod` declarations for all group-B files (per §2.1 table). Keep `pub mod __macro_support` path unchanged.
2. `src/jsc/JSGlobalObject.rs`: delete `pub use bun_bundler::…`, delete `run_on_{load,resolve}_plugins`/`throw_invalid_scrypt_params` (move to step 7 ext-trait). `src/jsc/ResolveMessage.rs:160,204`: `bun_resolver::is_package_path` → `bun_core::is_package_path`.
3. `src/jsc/error.rs`: shrink `CrateError` to `JsError | Core | Sys | Ast` arms only (drop `Resolver`/`Bundler`/`Install`/`Patch`/`Uws`/`Watcher`).
4. `src/jsc/webcore_types.rs`: delete `extern "Rust" __bun_blob_from_build_artifact` block and the `S3` sub-struct (moves in step 7).
5. `src/jsc/Cargo.toml`: deps → `bun_core, bun_sys, bun_ast, bun_macros` + external C deps. Keep `name = "bun_jsc"`.
6. `register_regex()` is **not** called from `bun_jsc::initialize()` (the `bun install` path reaches `create_matcher` without it); it is called from `bun_runtime::register_dispatch_tables()` at process init (Step 7.9).

### Step 7: Create `bun_loop`; mount group B + `*_jsc` into `bun_runtime`

1. New `src/loop/{Cargo.toml,lib.rs}` `#[path]`-mounting `src/io/lib.rs` (minus write.rs), `src/event_loop/lib.rs`, `src/spawn/lib.rs`, `src/patch/lib.rs`.
2. `src/loop/lib.rs`: define `pub struct JsLoopVTable { … 21 fn slots … } pub static JS_LOOP_VTABLE: OnceLock<JsLoopVTable> = OnceLock::new();` + `PollDispatchVTable`/`TimerDispatchVTable`/`TASK_DISPATCH` statics. `EventLoopCtx` becomes `enum { Mini(NonNull<MiniEventLoop>), Js(NonNull<()>) }` with methods that route `Js` through `JS_LOOP_VTABLE.get().unwrap()`.
3. Delete all `extern "Rust"` blocks in `io/posix_event_loop.rs`, `io/lib.rs:1397`, `event_loop/{AnyEventLoop,SpawnSyncEventLoop,EventLoopTimer,MiniEventLoop,lib}.rs`; replace callers with `JS_LOOP_VTABLE.get()…` / `TIMER_DISPATCH.get()…`.
4. Delete `link_interface! EventLoopCtx` / `JsEventLoop`. Keep `link_interface! BufferedReaderParentLink` / `ProcessExit` (now using `bun_macros::link_interface!`).
5. `src/runtime/lib.rs`: add `#[path = "../jsc/VirtualMachine.rs"] pub mod virtual_machine;` and likewise for every group-B file; add `pub mod vm { pub use super::{virtual_machine::*, module_loader::*, …}; }`. `#[path]`-mount `../sql_jsc/lib.rs` as `pub mod sql;`, and `http_jsc`, `css_jsc`, `bundler_jsc`, `install_jsc`, `js_parser_jsc`, `sourcemap_jsc`, `patch_jsc`, `semver_jsc`, `sys_jsc`, `ast_jsc`.
6. `src/runtime/jsc_ext.rs` new: `pub trait JSGlobalObjectExt { fn bun_vm(&self)->…; fn run_on_load_plugins(…); fn run_on_resolve_plugins(…); fn throw_invalid_scrypt_params(…); } impl JSGlobalObjectExt for JSGlobalObject { … }`. Same for `FetchHeadersExt::to_uws_response`, `SystemErrorExt::from_verify_error`.
7. `VirtualMachine.rs`: delete `extern "Rust" { static __BUN_RUNTIME_HOOKS }`; add real fields `timer: timer::All, sql_rare: crate::sql::RareData, ssl_ctx_cache: …, editor_context: …, global_dns_data: …, body_value_pool: …`; delete `link_impl_EventLoopCtx!`; add `fn register_js_loop_vtable(&self)` that fills `bun_loop::JS_LOOP_VTABLE` only (needs the live VM pointer).
8. Rename `jsc_hooks.rs` → `vm/init.rs`; delete `__BUN_RUNTIME_HOOKS`/`__BUN_LOADER_HOOKS` statics + `RuntimeState` struct; inline hook bodies as `impl VirtualMachine { fn generate_entry_point(…), fn load_preloads(…), fn ensure_debugger(…), fn auto_tick(…) }` and `impl ModuleLoader { fn transpile_source_code(…), fn fetch_builtin_module(…), fn transpile_file(…) }`. Delete `#[no_mangle]` on `__bun_{get_vm_ctx,js_vm_get,stdio_blob_store_*}`; bodies stay as the `JS_LOOP_VTABLE` slot impls.
9. Rename `dispatch.rs` → `task_dispatch.rs`; delete `#[no_mangle]` on the 4 entry fns. Add `pub fn register_dispatch_tables()` that fills `bun_loop::{TIMER_DISPATCH, POLL_DISPATCH, TASK_DISPATCH}` (no VM needed; the fn bodies null-check for Mini-path tags as today), calls `bun_jsc::register_regex()` to set `bun_ast::REGEX_ENGINE`, and calls every `__register_<Iface>_<Variant>()` emitted by `link_impl_*!` for `BufferedReaderParentLink`/`ProcessExit` (the `bun_install`-side variants register from `bun_install::init()`, called here as well). `src/bun_bin/lib.rs`: call `bun_runtime::register_dispatch_tables()` before `cli::dispatch()` (so `bun install` + lifecycle-script `FilePoll`s find `POLL_DISPATCH` set, and `.npmrc` `hoist-pattern=` finds `REGEX_ENGINE` set). Keep `dispatch_js2native.rs` unchanged.
10. `hw_exports.rs`: delete `__BUN_SQL_RUNTIME_HOOKS` block; `sql_jsc/jsc.rs` callers use `crate::{timer, socket::SSLConfig, webcore::Blob}` directly.
11. `event_loop.rs` (group B, now in runtime): delete `extern "Rust" __bun_tick_queue_*` etc.; call `crate::task_dispatch::*` directly. Delete `link_impl_JsEventLoop!`.
12. In `src/runtime/**`, `src/*_jsc/**`: `use bun_jsc::{VirtualMachine, virtual_machine, EventLoop, event_loop, ConsoleObject, module_loader, rare_data, RareData, Debugger, debugger, ipc, web_worker, hot_reloader, Formatter, CrateError, plugin_runner, webcore_types::{Blob, S3…}}` → `use crate::vm::…`. Add `use crate::jsc_ext::JSGlobalObjectExt as _;` where `.bun_vm()` is called.

### Step 8: Merge `bun_js`, `bun_resolver`, `bun_bundler`, `bun_install`

1. New `src/js/{Cargo.toml,lib.rs}` mounting `js_parser`, `js_printer`. `js_parser/lib.rs:102`: delete `extern "Rust" __bun_macro_*`; `pub trait MacroRunner { fn call(…)->Result<Expr>; fn get_remap(…)->…; fn collect_garbage(); } pub struct MacroContext { runner: Option<Box<dyn MacroRunner>>, … }`. Impl in `src/runtime/macro_runner.rs` (moved from `js_parser_jsc/Macro.rs`). `js_printer/lib.rs:1206,1432`: `SourceMapHandler`/`RequireOrImportMetaCallback` fn-ptr structs → `Option<&mut dyn SourceMapSink>`/`Option<&mut dyn RequireMetaResolver>`.
2. `src/resolver/lib.rs`: `#[path]`-mount `router`. Delete `extern "Rust" __bun_resolver_init_package_manager`; `Resolver::init` takes `auto_installer: Option<&'a dyn AutoInstaller>` (caller in `bun_install` constructs PM first). Add `bun_jsc` dep (for `StandaloneModuleGraph` no longer needs the `dyn` downcast in runtime; the trait stays since resolver < bundler).
3. `src/bundler/lib.rs`: `#[path]`-mount `standalone_graph`; `pub use transpiler::*;` (deleting `bun_transpiler` crate). `bundle_v2.rs:1403,1417`: delete both `extern "Rust"`; replace first with direct `bun_jsc::CachedBytecode::generate(…)`, second with `pub static HOT_RELOAD_HOOK: OnceLock<fn(NonNull<BundleV2<'static>>)>`. `lib.rs:338,364`: delete `link_interface! DevServerHandle/VmLoaderCtx`; add `pub trait DevServerHooks { …11 methods… } pub trait VmLoaderHooks { …13 methods… }`; stores `Option<&'static dyn …>`. `LinkerContext.rs:60`: replace `link_impl_BundleGenerateChunkCtx!` with `bun_sys::crash_handler::ACTION_FORMATTER.set(…)`. Add `bun_jsc` to deps.
4. `src/install/lib.rs`: `#[path]`-mount `bunfig`. `auto_installer.rs:457`: delete `#[no_mangle] __bun_resolver_init_package_manager`. `[features] shim_standalone = []`. Add `pub fn init()` calling the `__register_BufferedReaderParentLink_*`/`__register_ProcessExit_*` fns for the 2+2 `bun_install`-side `link_impl_*!` variants (wired from `register_dispatch_tables`, Step 7.9).
5. Tree-wide `sed` + Cargo.toml for `js_parser`/`js_printer`/`router`/`standalone_graph`/`transpiler`/`bunfig`.

### Step 9: In-crate vtable → enum conversions

1. `runtime/webcore/Sink.rs`: `VTable` → `enum SinkKind { FileSink, ArrayBufferSink, HTTPResponseSink, … }`; `Sink.vtable` → `Sink.kind`.
2. `runtime/webcore/streams.rs`: `SignalVTable` → `enum SignalKind`.
3. `runtime/shell/interpreter.rs:2652`, `builtin/mkdir.rs:374`, `builtin/rm.rs:1654`: vtable → enum.
4. `jsc/ipc.rs` (now `runtime/vm/ipc.rs`): `*mut dyn SendQueueOwner` → `enum SendQueueOwner { Instance(NonNull<IPCInstance>), Subprocess(NonNull<SubprocessT<'static>>) }`.

### Step 10: Codegen script updates

1. `src/codegen/generate-host-exports.ts:59-60`: `scanRoots` stays `[{dir: src/runtime, crate: "bun_runtime"}, {dir: src/jsc, crate: "bun_jsc"}]` (group-B files are `#[path]`-mounted so they're scanned under `src/jsc/` disk path but emit `bun_runtime::` crate prefix — add a `mountedIn` override map for the 38 group-B filenames). `:503-506` import table: `["bun_jsc::virtual_machine", …]` → `["bun_runtime::vm", "VirtualMachine"]`, `["bun_runtime::vm::debugger", "LifecycleHandle"]`, `["bun_runtime::vm::debugger", "TestReporterHandle"]`.
2. `src/codegen/generate-js2native.ts:98`: `"virtual_machine_exports.rs": "jsc/virtual_machine_exports.rs"` → `"runtime/vm/virtual_machine_exports.rs"` (or keep disk path, update crate prefix). `:330`: `crate::dispatch::` → `crate::task_dispatch::` is wrong (js2native lands in `dispatch_js2native.rs`); leave as-is, ensure `mod dispatch { pub mod js2native; }` alias stays in `runtime/lib.rs`.
3. `src/codegen/generate-classes.ts:2141-2143`: `src/jsc/*.classes.ts` routing via `bun_jsc::` re-exports: no change needed. `BuildMessage`/`ResolveMessage` stay in group-A `bun_jsc` (per §2.1), so the existing `pub use bun_jsc::{BuildMessage, ResolveMessage}` at `src/runtime/api.rs:38-39` remains correct.

### Step 11: Build scripts & CI

1. `scripts/build/rust.ts`: no change to `-p bun_bin` / `-p bun_shim_impl` invocations. Update comment at `:775`.
2. `scripts/rust-miri.ts:34-47`: `MIRI_CRATES = ["bun_core", "bun_macros", "bun_ast", "bun_opaque"]`.
3. `scripts/bench-json-rust.sh:59,61`: `-p bun_parsers` → `-p bun_ast --bench json`.
4. `src/parsers/native_test_shims.rs`: expand `#[no_mangle]` stubs for the merged `bun_ast`'s full `extern "C"` surface (simdutf, highway, zstd). Or gate `bun_ast`'s FFI modules behind `#[cfg(not(test))]`.
5. Add to `scripts/build/ci.ts` lint step: `cargo check -p bun_shim_impl --features shim_standalone --target x86_64-pc-windows-msvc` (no link; catches shadow-module drift).
6. `src/js_parser/Cargo.toml` `[[bench]]` → `src/js/Cargo.toml`.
7. `src/runtime/Cargo.toml:113`, `src/bundler/Cargo.toml:73`: `show_crash_trace = ["bun_sys/show_crash_trace"]`.
8. `Cargo.toml:449`: `[profile.release.package.bun_react_compiler]` unchanged.

### Step 12: Comment & doc cleanup

1. `scripts/` one-liner: delete all `// … PORTING.md …` comment lines that match the 327 §rule patterns (regex in §5).
2. Rewrite 11 surviving `LAYERING:` comments to name the `OnceLock`/`dyn` seam.
3. `src/CLAUDE.md`: `bun_sys_jsc::ErrorJsc` → `bun_jsc::SysErrorJsc`; update crate list.
4. `scripts/clippy-loop/fix-round.workflow.ts:76,103`: update wrapper-crate references.
5. `scripts/generate-perf-trace-events.sh:20,23`: `bun_perf::trace` → `bun_sys::perf::trace`.

### Step 13: Delete absorbed crate manifests

1. `Cargo.toml` `[workspace] members`: reduce to the 22 crates in §1.
2. Delete `Cargo.toml` + `build.rs` for all 76 absorbed crates (source `.rs` files stay on disk for `#[path]` mounts).
3. Absorbing crates' `build.rs` add `println!("cargo:rerun-if-changed=../<absorbed>/");` for each mounted source dir.
4. `cargo check --workspace && bun run rust:check-all && bun bd && bun bd test`.

---

## 8.2 Accepted costs

- **Debug cold-build prefix serialization.** `bun_core` (86k) + `bun_sys` (46k) compile serially before any fan-out, vs today's ~33k + parallel siblings. Estimated ~1.5–2× wall-clock on that prefix. `-Zthreads=8` (`scripts/build/rust.ts:423-438`) partially mitigates. Release unaffected (`lto = "fat"` + `codegen-units = 1` already serialize, per `Cargo.toml:114-131`).
- **`bun_runtime` at ~392k LOC** (from 331k). Longer incremental rebuild when touching any runtime/VM/console/SQL-driver/WebSocket code. Buys: elimination of all hook tables and `*mut c_void` VM fields.
- **`OnceLock<fn-struct>` vs link-time.** The `OnceLock` tables + `AtomicUsize` hooks (Appendix B) replace 20 `extern "Rust"` blocks. Each call is now `static.get().unwrap().slot(…)` vs a direct symbol: `OnceLock::get` is an **acquire** load on the init flag (a plain `mov` on x86_64 under TSO; `ldar` on aarch64) plus one indirect call through the stored fn pointer. The current `extern "Rust"` path is already an indirect call (cross-crate, resolved at link time, not inlined without LTO), so the delta is the acquire load + the `Option` null check; benchmark the hot paths (`TIMER_DISPATCH`, `POLL_DISPATCH`, `TASK_DISPATCH`, `__VTABLES_BufferedReaderParentLink`) in the implementation PR rather than asserting equivalence here. `JS_LOOP_VTABLE` calls sit behind an `EventLoopCtx::Js` branch that already exists. The two `__VTABLES_*` arrays use `Relaxed` (not `Acquire`) loads: the pointed-to `MethodTable` is `const` (fully initialized before `main`), so no release/acquire pair is needed to publish its contents.

## 8.3 Out of scope

- Splitting `bun_runtime` into `runtime_core`/`runtime_cli` for build parallelism (cli/ is 54k, test_runner/ 21k, bake/ 20k; viable follow-up).
- The 13 `TODO(port)` real-work items (lifetime threading in `bake`/`UpdateRequest`/`css`; react-compiler HIR gaps).
- Replacing `bun_collections` hand-written containers with crates.io equivalents (~30k LOC potential but behavioral risk).
- Replacing `AllocatorVTable` with `dyn Allocator` (address-identity is load-bearing).
- Converting `InternalSocket` variants to `dyn SocketTransport` (C-ABI boundary).
- Any behavioral change.

---

## Appendix A: Full per-file `bun_jsc` A/B classification

See §2.1. The source-of-truth table (118 files) is derived from scanning each file's imports against the group-B crate list. Files with ≤3 B-tier reference lines that become A after trivial edits: `JSGlobalObject`, `CachedBytecode`, `uuid`, `webcore_types` (minus S3 block), `BuildMessage`, `ResolveMessage`. Files that are structurally B despite small import count: `AbortSignal` (embeds `EventLoopTimer`, calls `VirtualMachine::timer_*`), `FetchHeaders.to_uws_response`, `SystemError` uws-helper.

## Appendix B: `OnceLock` registry inventory

| Static                           | Defined in               | Set by                         | Slots  | Hot path?               |
| -------------------------------- | ------------------------ | ------------------------------ | ------ | ----------------------- |
| `OUTPUT_SINK`                    | `bun_core`               | `bun_sys::init`                | 11     | No (stderr/logger init) |
| `PANIC_HOOK`, `STACK_TRACE_HOOK` | `bun_core`               | `bun_sys::crash_handler::init` | 1 each | No                      |
| `REGEX_ENGINE`                   | `bun_ast`                | `bun_bin::main` (process init) | 3      | No (bunfig parse)       |
| `PREFETCH_HOOK`                  | `bun_sys::dns`           | `bun_runtime` VM init          | 1      | No                      |
| `ACTION_FORMATTER`               | `bun_sys::crash_handler` | `bun_bundler` linker init      | 1      | No (crash only)         |
| `JS_LOOP_VTABLE`                 | `bun_loop`               | `bun_runtime` VM init          | 21     | Yes (event-loop tick)   |
| `TIMER_DISPATCH`                 | `bun_loop`               | `bun_bin::main` (process init) | 2      | Yes                     |
| `POLL_DISPATCH`                  | `bun_loop`               | `bun_bin::main` (process init) | 3      | Yes                     |
| `TASK_DISPATCH`                  | `bun_loop`               | `bun_bin::main` (process init) | 1      | Yes                     |
| `HOT_RELOAD_HOOK`                | `bun_bundler`            | `bun_runtime` bake init        | 1      | No                      |

| `__VTABLES_BufferedReaderParentLink` | `bun_loop`           | `bun_bin::main` (process init) | 13×5   | Yes (pipe read)         |
| `__VTABLES_ProcessExit`          | `bun_loop`               | `bun_bin::main` (process init) | 12×3   | No (once per process)   |

All set-once at init, read-many. `JS_LOOP_VTABLE` is set at VM init and only read behind an `EventLoopCtx::Js` branch, so the `bun_install` / `MiniEventLoop` path (no VM) never reaches its `.get().unwrap()`. `{TIMER,POLL,TASK}_DISPATCH`, `REGEX_ENGINE`, and the two `__VTABLES_*` arrays are **not** guarded that way (`FilePoll::on_update` calls `POLL_DISPATCH` unconditionally and `bun install` creates `FilePoll`s for lifecycle-script pipes on Mini; `create_matcher` is reached from `.npmrc` parsing without a VM), so they are set at process init from `bun_bin::main` via `bun_runtime::register_dispatch_tables()` before any CLI command runs.
