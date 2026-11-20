//! `crate::jsc_hooks` — high-tier bodies for the cold-path entry points that
//! `bun_jsc` cannot define itself without inverting the crate DAG
//! (`timer::All`, `Transpiler`, `HardcodedModule`, …).
//!
//! Layout:
//!   1. [`RuntimeState`] — per-VM state the low tier stores as `*mut c_void`
//!   2. `__BUN_RUNTIME_HOOKS` — `init_runtime_state`, `load_preloads`, … (fn-ptr table).
//!   3. Module loader: `__bun_transpile_source_code` /
//!      `__bun_fetch_builtin_module` (declared `extern "Rust"` in
//!      `bun_jsc::module_loader`, link-time resolved) and the
//!      `Bun__transpileFile` / `Bun__transpileVirtualModule` /
//!      `Bun__resolveAndFetchBuiltinModule` / `Bun__resolveEmbeddedNodeFile`
//!      C++ entry points.
//!   4. `__bun_get_vm_ctx` / `__bun_http_sync_download_*` — low-tier extern impls.

use bun_core::WTFStringImplExt as _;
use bun_options_types::LoaderExt as _;
use core::cell::Cell;
use core::ffi::c_void;
use core::ptr;

use bun_jsc::bun_string_jsc;
use bun_jsc::js_promise::Status as PromiseStatus;
use bun_jsc::module_loader::{ArenaResetGuard, FetchFlags, TranspileArgs, TranspileExtra};
use bun_jsc::resolved_source::Bytecode;
use bun_jsc::runtime_transpiler_cache::RuntimeTranspilerCache;
use bun_jsc::virtual_machine::{
    CancelHotRunTimers, InitOptions, MainEntryPoint, RuntimeHooks,
    RuntimeState as OpaqueRuntimeState, SweepResult, TimersLeft, VirtualMachine,
    WorkerExecArgvFlags,
};
use bun_jsc::{
    AnyPromise, ErrorableResolvedSource, JSGlobalObject, JSInternalPromise, JSModuleLoader,
    JSValue, JsCell, JsResult, ResolvedSource, StringJsc as _,
};

use bun_ast::ImportKind;
use bun_ast::Loader;
use bun_bundler::options::{self, ModuleType};
use bun_resolve_builtins::Module as HardcodedModule;
use bun_resolver::fs as Fs;
use bun_resolver::node_fallbacks;
use bun_resolver::{GlobalCache, ResultUnion as ResolveResultUnion};

use crate::cli::upgrade_command::FileSystemTmpdirExt as _;
use crate::node::node_fs_stat_watcher::StatWatcherScheduler;
use crate::timer;
use crate::webcore::blob::BlobExt as _;

// ════════════════════════════════════════════════════════════════════════════
// Per-VM runtime state
// ════════════════════════════════════════════════════════════════════════════

/// High-tier per-VM state. Boxed + leaked in `init_runtime_state`; the raw
/// pointer is returned to `bun_jsc` as `RuntimeState` (`*mut c_void`) **and**
/// cached thread-locally so host calls can recover it without the VM.
///
/// The low-tier `VirtualMachine` carries `()`
/// placeholders for these fields (see the placeholder field comments in
/// `VirtualMachine.rs`); until those slots widen to `*mut c_void`, the
/// thread-local is the recovery path.
// `repr(C)` keeps `timer` at offset 0, so `timer_all()` is the thread-local load alone.
#[repr(C)]
pub(crate) struct RuntimeState {
    /// setTimeout/setInterval heap + uv timers.
    pub(crate) timer: timer::All,
    /// `RareData.{mysql,postgresql}_context` — concrete SQL state. The
    /// `bun_jsc::rare_data::RareData` slots for these are opaque ZSTs (cycle
    /// break); `bun_sql_jsc` reads them via [`sql_rare`].
    pub(crate) sql_rare: bun_sql_jsc::jsc::RareData,
    /// `RareData.ssl_ctx_cache` — concrete digest-keyed weak `SSL_CTX*` cache.
    /// Same cycle-break story as `sql_rare`.
    pub(crate) ssl_ctx_cache: crate::api::SSLContextCache::SSLContextCache,
    /// `RareData.global_dns_data` — per-VM resolver + c-ares channel.
    /// Lazy-init by [`crate::dns_jsc::global_resolver`]; freed when this box
    /// drops in [`deinit_runtime_state`].
    pub(crate) global_dns_data: core::cell::OnceCell<Box<crate::dns_jsc::GlobalData>>,
    /// `vm.body_value_pool` — pooled storage for `Body.Value`
    /// (`Request.body` payloads).
    /// Boxed because `HiveAllocator` is `Fallback<HiveRef<Body::Value, 256>, 256>`
    /// — far too large to construct on the stack inside `Box::new(RuntimeState{..})`.
    /// `ManuallyDrop` inside the `Box`: `deinit_runtime_state` runs after
    /// `teardown`, so `HiveArray::Drop` on a leaked body would run
    /// `Value`'s drop (which touches `Blob`/`readable` state) at a point that
    /// has not been proven safe; keep the prior behavior of leaking any
    /// still-occupied slot while still freeing the pool allocation itself.
    pub(crate) body_value_pool: Box<core::mem::ManuallyDrop<crate::webcore::body::HiveAllocator>>,
    #[cfg(windows)]
    pub(crate) path_watchers: core::cell::OnceCell<Box<crate::node::win_watcher::PathWatchers>>,
    pub(crate) request_pools: crate::server::RequestPools,
    /// The wrappers of the running `Bun.cron()` jobs of the main thread under `--hot`, which a reload stops.
    pub(crate) cron_jobs: JsCell<Vec<bun_jsc::Strong>>,
    pub(crate) cron_os_jobs: crate::api::cron_os::OsJobs,
    pub(crate) stat_watcher_scheduler: JsCell<Option<bun_ptr::RefPtr<StatWatcherScheduler>>>,
    /// Set in the VM that runs the files of `bun test`.
    pub(crate) test_runner: Cell<Option<&'static crate::test_runner::jest::TestRunner>>,
    /// Innermost entered `Pass`, borrowed from a caller's stack frame; `EnteredPass::drop` pops it.
    pub(crate) matcher_pass: Cell<*const crate::test_runner::expect::expect_deferred::Pass>,
    /// For the `node:fs` calls that have no binding object. See [`with_node_fs`].
    node_fs: JsCell<Option<crate::node::fs::NodeFS>>,
    /// Installed while `process.on("memoryPressure", ...)` has a listener.
    pub(crate) memory_pressure_watcher: crate::node::memory_pressure::WatcherSlot,
    pub(crate) browsers: crate::webview::Browsers,
    /// For `Bun.zstdDecompressSync()`.
    pub(crate) zstd_tables: JsCell<bun_zstd::SpareTables>,
    /// `bun lint`: what runs the rules of JavaScript plugins in this VM.
    pub(crate) lint: core::cell::OnceCell<Box<crate::cli::lint_js::LintVm>>,
    /// The `uv_loop_t` that addons get for this VM. Stored inline because addons
    /// keep its address for as long as the VM lives.
    #[cfg(unix)]
    pub(crate) uv_loop: crate::napi::uv_posix::UvLoop,
}

/// One `RuntimeState` per JS thread, cleared by [`deinit_runtime_state`].
#[thread_local]
static RUNTIME_STATE: Cell<*mut RuntimeState> = Cell::new(ptr::null_mut());

/// This thread's [`RuntimeState`]. Every JS host call runs with one installed.
#[inline]
pub(crate) fn runtime_state() -> &'static RuntimeState {
    let state = RUNTIME_STATE.get();
    debug_assert!(!state.is_null(), "RuntimeState not installed");
    // SAFETY: the box is freed with the VM (at the top of the thread, or on a path that never
    // returns). Only `take_lint_vm` borrows a field exclusively before that. It is not `Sync`:
    // the reference stays here.
    unsafe { &*state }
}

/// [`runtime_state`] for hooks that also run without one.
#[inline]
pub(crate) fn try_runtime_state() -> Option<&'static RuntimeState> {
    (!RUNTIME_STATE.get().is_null()).then(runtime_state)
}

/// [`runtime_state`] without the thread-local.
#[inline]
pub(crate) fn runtime_state_of(vm: &VirtualMachine) -> &RuntimeState {
    let state = vm.runtime_state.get().cast::<RuntimeState>();
    debug_assert!(!state.is_null(), "RuntimeState not installed");
    // SAFETY: as `runtime_state`.
    unsafe { &*state }
}

/// This thread's timers.
#[inline]
pub(crate) fn timer_all() -> &'static timer::All {
    &runtime_state().timer
}

/// [`timer_all`] without the thread-local.
#[inline]
pub(crate) fn timer_all_of(vm: &VirtualMachine) -> &timer::All {
    &runtime_state_of(vm).timer
}

/// [`timer_all`] for hooks that also run without a `RuntimeState`.
#[inline]
fn try_timer_all() -> Option<&'static timer::All> {
    try_runtime_state().map(|state| &state.timer)
}

/// Per-VM lazy DNS resolver storage. Shared borrow only — script can
/// re-enter [`crate::dns_jsc::global_resolver`] while a `&Resolver` derived
/// from this cell is live, so a `&mut` accessor would alias.
#[inline]
pub(crate) fn global_dns_data() -> &'static core::cell::OnceCell<Box<crate::dns_jsc::GlobalData>> {
    &runtime_state().global_dns_data
}

/// [`RuntimeState::stat_watcher_scheduler`] of `vm`.
pub(crate) fn stat_watcher_scheduler(
    vm: &VirtualMachine,
) -> &JsCell<Option<bun_ptr::RefPtr<StatWatcherScheduler>>> {
    &runtime_state_of(vm).stat_watcher_scheduler
}

/// [`RuntimeState::ssl_ctx_cache`] of this thread's VM.
#[inline]
pub(crate) fn ssl_ctx_cache() -> &'static crate::api::SSLContextCache::SSLContextCache {
    &runtime_state().ssl_ctx_cache
}

/// [`RuntimeState::sql_rare`] of `vm`.
pub(crate) fn sql_rare(vm: &VirtualMachine) -> &bun_sql_jsc::jsc::RareData {
    &runtime_state_of(vm).sql_rare
}

/// [`RuntimeState::path_watchers`] of this thread's VM.
#[cfg(windows)]
pub(crate) fn path_watchers() -> &'static crate::node::win_watcher::PathWatchers {
    runtime_state().path_watchers.get_or_init(Default::default)
}

/// [`RuntimeState::request_pools`] of `vm`.
pub(crate) fn request_pools(vm: &VirtualMachine) -> &crate::server::RequestPools {
    &runtime_state_of(vm).request_pools
}

/// [`RuntimeState::lint`] of this thread's VM.
#[inline]
pub(crate) fn lint_vm() -> &'static core::cell::OnceCell<Box<crate::cli::lint_js::LintVm>> {
    &runtime_state().lint
}

/// Takes [`RuntimeState::lint`] out of this thread's VM, which is about to end.
pub(crate) fn take_lint_vm() -> Option<Box<crate::cli::lint_js::LintVm>> {
    let state = RUNTIME_STATE.get();
    debug_assert!(!state.is_null(), "take_lint_vm before init_runtime_state");
    // SAFETY: this thread's state, and no `runtime_state()` borrow is live at the top of the thread.
    unsafe { (*state).lint.take() }
}

/// Recover the [`RuntimeState`] owned by a specific `vm` (not the calling
/// thread's). `WTFTimer` may be entered off the VM's JS thread (the locked
/// `All.wtf_timers` heap exists for exactly that), so it goes through `vm.runtime_state`
/// rather than the thread-local cache.
///
/// # Safety
/// `vm` must point at a live `VirtualMachine` whose `runtime_state` was set by
/// `init_runtime_state`.
#[inline]
pub(crate) unsafe fn runtime_state_ptr_of(vm: *mut VirtualMachine) -> *mut RuntimeState {
    // One field is read: this may run off the VM's JS thread.
    // SAFETY: per fn contract — `vm` is live and `runtime_state` was set by
    // `init_runtime_state` to a `*mut RuntimeState`.
    unsafe { (*vm).runtime_state.get().cast::<RuntimeState>() }
}

/// `RareData.defaultClientSslCtx()` — lazy
/// default-trust-store client `SSL_CTX*`, shared by every `tls: true` outbound
/// connection that didn't supply explicit options.
///
/// Note: lives here (high tier) because the storage slot
/// (`RareData.default_client_ssl_ctx`) is in `bun_jsc` but population requires
/// `RuntimeState.ssl_ctx_cache` (this crate). The cached `SSL_CTX*` is held
/// until `tls.DEFAULT_CIPHERS` is assigned so the weak-cache entry never tombstones.
pub(crate) fn default_client_ssl_ctx(vm: &VirtualMachine) -> *mut bun_uws::SslCtx {
    let slot = &vm.rare_data().default_client_ssl_ctx;
    if slot.get().is_none() {
        let mut err = bun_uws::create_bun_socket_error_t::none;
        let cache = ssl_ctx_cache();
        // Mode-neutral CTX (VERIFY_NONE). `us_internal_ssl_attach` overrides
        // each client SSL to VERIFY_PEER + the shared bundled-root store, so
        // `new WebSocket("wss://…")` (which shares this CTX and defaults to
        // rejectUnauthorized:true) verifies real servers. Route through the
        // weak cache so a `tls.connect()` with default options later resolves
        // to the same CTX rather than building a second one with the same
        // digest. The +1 ref returned here is held, so the entry never tombstones.
        let ctx = if vm.tls_default_ciphers().is_some() {
            cache.get_or_create(&crate::socket::tls_true_defaults(vm, false), &mut err)
        } else {
            cache.get_or_create_opts(&Default::default(), &mut err)
        };
        match ctx {
            Some(ctx) => slot.set(Some(ctx)),
            None => bun_core::Output::panic(format_args!(
                "default client SSL_CTX init failed: {}",
                bun_core::fmt::s(err.message().unwrap_or(b"unknown")),
            )),
        }
    }
    slot.get().as_ref().unwrap().as_ptr().cast()
}

/// The `RuntimeHooks` slot, which the WebSocket client alone calls.
#[inline(never)]
fn default_client_ssl_ctx_for_websocket(vm: &VirtualMachine) -> *mut bun_uws::SslCtx {
    bun_removable_features::removable_definition!(WebSocket, default_client_ssl_ctx_for_websocket);
    default_client_ssl_ctx(vm)
}

/// `RareData.sslCtxCache().getOrCreateOpts(opts, &err)` — RuntimeHooks slot
/// body. Per-VM digest-keyed weak `SSL_CTX*` cache; returns +1 ref or `None`
/// on BoringSSL rejection (`err` populated).
///
#[inline(never)]
fn ssl_ctx_cache_get_or_create(
    _vm: &VirtualMachine,
    opts: &bun_uws::SocketContext::BunSocketContextOptions,
    err: &mut bun_uws::create_bun_socket_error_t,
) -> Option<bun_boringssl::c::OwnedSslCtx> {
    // The WebSocket client alone calls it.
    bun_removable_features::removable_definition!(WebSocket, ssl_ctx_cache_get_or_create);
    ssl_ctx_cache().get_or_create_opts(opts, err)
}

// ════════════════════════════════════════════════════════════════════════════
// RuntimeHooks bodies
// ════════════════════════════════════════════════════════════════════════════

/// Timer state + body hive-allocator + debugger configuration — everything
/// VM init does that names a `bun_runtime` type.
fn init_runtime_state(vm: &VirtualMachine, opts: &InitOptions) -> OpaqueRuntimeState {
    let state = bun_core::heap::into_raw(Box::new(RuntimeState {
        timer: timer::All::init(),
        sql_rare: Default::default(),
        ssl_ctx_cache: Default::default(),
        global_dns_data: core::cell::OnceCell::new(),
        body_value_pool: {
            // `Box::new(ManuallyDrop::new(HiveAllocator::init()))` still builds the
            // ~100 KB pool in a stack temporary before moving it into the box (see
            // `HiveArray::new_boxed`). Allocate it on the heap and initialize it in
            // place instead — only the occupancy bitset is written.
            let pool = crate::webcore::body::HiveAllocator::new_boxed();
            // SAFETY: `into_raw` gives up a `Box<HiveAllocator>`; reclaim ownership of
            // that same allocation. `ManuallyDrop` is `repr(transparent)`, so
            // `Box<ManuallyDrop<T>>` and `Box<T>` have identical layout — the wrapper
            // only suppresses the inner drop, which is the behavior documented on the
            // field.
            unsafe {
                Box::from_raw(
                    Box::into_raw(pool)
                        .cast::<core::mem::ManuallyDrop<crate::webcore::body::HiveAllocator>>(),
                )
            }
        },
        #[cfg(windows)]
        path_watchers: Default::default(),
        request_pools: Default::default(),
        cron_jobs: JsCell::default(),
        cron_os_jobs: Default::default(),
        stat_watcher_scheduler: JsCell::new(None),
        test_runner: Cell::new(None),
        matcher_pass: Cell::new(ptr::null()),
        node_fs: JsCell::new(None),
        memory_pressure_watcher: Default::default(),
        browsers: Default::default(),
        zstd_tables: JsCell::default(),
        lint: core::cell::OnceCell::new(),
        #[cfg(unix)]
        uv_loop: crate::napi::uv_posix::UvLoop::new(vm.handle()),
    }));
    RUNTIME_STATE.set(state);

    vm.transpiler.with_mut(|t| {
        // With a module graph, `apply_standalone_runtime_flags` has yet to apply `compile.autoloadTsconfig: false`.
        let reads_tsconfig = opts.graph.is_none_or(|graph| {
            graph
                .compiled_program()
                .is_some_and(|program| program.allows_code_from_disk)
        });
        if !reads_tsconfig {
            t.configure_linker_with_auto_jsx(false);
        } else {
            t.configure_linker();
        }
    });

    // Note: the main-thread `ParentDeathWatchdog.installOnEventLoop` call
    // does NOT live in this hook — `init_runtime_state` fires BEFORE
    // `ensure_waker()` sets `vm.event_loop_handle`, so on macOS the kqueue
    // registration would `.expect("uws event_loop_handle is null")`-panic.
    // The call is inlined in `VirtualMachine::init` itself, immediately after
    // the `internal_loop_data.jsc_vm` write; `bun_jsc` already depends on
    // `bun_io` so no layering
    // break.

    // Worker init routes through this same hook but must not configure a
    // debugger, so gate on `worker_ptr` to keep `vm.debugger == None` for
    // workers.
    if opts.worker_ptr.is_null() {
        configure_debugger(vm, &opts.debugger);
    }

    state.cast()
}

/// Translate the CLI flag /
/// `BUN_INSPECT*` env vars into `vm.debugger = Some(Debugger { .. })` so
/// `ensure_debugger` (below) actually starts the inspector.
fn configure_debugger(vm: &VirtualMachine, cli_flag: &bun_options_types::context::Debugger) {
    use bun_core::env_var;
    use bun_jsc::debugger::{Debugger, Mode, Wait};
    use bun_options_types::context::Debugger as CliDebugger;

    if env_var::HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET
        .get()
        .is_some()
    {
        return;
    }

    let unix: &'static [u8] = env_var::BUN_INSPECT.get().unwrap_or(b"");
    let connect_to: &'static [u8] = env_var::BUN_INSPECT_CONNECT_TO.get().unwrap_or(b"");

    let set_breakpoint_on_first_line = !unix.is_empty() && unix.ends_with(b"?break=1");
    let wait_for_debugger = !unix.is_empty() && unix.ends_with(b"?wait=1");

    let wait_for_connection = if set_breakpoint_on_first_line || wait_for_debugger {
        Wait::Forever
    } else {
        Wait::Off
    };

    let debugger = match cli_flag {
        CliDebugger::Unspecified => {
            if !unix.is_empty() {
                Some(Debugger {
                    path_or_port: None,
                    from_environment_variable: unix,
                    wait_for_connection: Cell::new(wait_for_connection),
                    set_breakpoint_on_first_line,
                    ..Default::default()
                })
            } else if !connect_to.is_empty() {
                Some(Debugger {
                    path_or_port: None,
                    from_environment_variable: connect_to,
                    wait_for_connection: Cell::new(Wait::Off),
                    set_breakpoint_on_first_line: false,
                    mode: Mode::Connect,
                    ..Default::default()
                })
            } else {
                None
            }
        }
        CliDebugger::Enable(enable) => {
            // Argv-derived; lives for process lifetime in spec — dupe into the
            // process-lifetime CLI arena.
            let path_or_port: &'static [u8] = crate::cli::cli_dupe(&enable.path_or_port);
            Some(Debugger {
                path_or_port: Some(path_or_port),
                from_environment_variable: unix,
                wait_for_connection: Cell::new(if enable.wait_for_connection {
                    Wait::Forever
                } else {
                    wait_for_connection
                }),
                set_breakpoint_on_first_line: set_breakpoint_on_first_line
                    || enable.set_breakpoint_on_first_line,
                ..Default::default()
            })
        }
    };

    let Some(debugger) = debugger else { return };
    let flag = match cli_flag {
        CliDebugger::Enable(enable) if enable.set_breakpoint_on_first_line => Some("--inspect-brk"),
        CliDebugger::Enable(enable) if enable.wait_for_connection => Some("--inspect-wait"),
        CliDebugger::Enable(_) => Some("--inspect"),
        CliDebugger::Unspecified => None,
    };
    let asked_by = flag.unwrap_or("BUN_INSPECT");
    if !crate::cli::startup_options::is_debugger_admitted() {
        // `BUN_INSPECT_CONNECT_TO` does not say that anybody asked to debug this process: see below.
        if debugger.mode != Mode::Connect {
            crate::cli::startup_options::exit_for_unadmitted_debugger(flag);
        }
        return;
    }
    if bun_removable_features::is_removed(bun_removable_features::Feature::Inspector) {
        if debugger.mode != Mode::Connect {
            bun_core::warn!(
                "{} is ignored, because --trim removed the debugger from this executable",
                asked_by
            );
        }
        return;
    }
    // The debugger evaluates what its client sends, whatever the engine's eval setting.
    if bun_core::code_generation_from_strings() == bun_core::CodeGenerationFromStrings::Strict {
        const STRICT: &str = "--disallow-code-generation-from-strings=strict";
        let is_trimmed = bun_core::is_code_generation_disallowed_by_trimming();
        // Editors set this one for every process started from their terminals (Bun's VS Code
        // extension does by default), so it does not say that anybody asked to debug this one.
        if debugger.mode == Mode::Connect {
            if is_trimmed {
                return;
            }
            bun_core::warn!(
                "BUN_INSPECT_CONNECT_TO is ignored with {}: the inspector evaluates code from strings",
                STRICT
            );
            bun_core::Output::flush();
            return;
        }
        if is_trimmed {
            bun_core::Output::err_generic(
                "{} can't be used with an executable built with --trim, because the debugger runs code from strings\n",
                (asked_by,),
            );
            bun_core::Global::exit(1);
        }
        // Asking for both is an error, so that the process never runs without something its
        // operator asked for.
        bun_core::Output::err_generic(
            "{} cannot be used with {}: the inspector evaluates code from strings\n",
            (asked_by, STRICT),
        );
        bun_core::Global::exit(1);
    }
    let mode = debugger.mode;
    vm.debugger.set(Some(Box::leak(Box::new(debugger))));

    // The inspector is always enabled at this point, so disable the cache
    // unconditionally.
    bun_jsc::runtime_transpiler_cache::IS_DISABLED
        .store(true, core::sync::atomic::Ordering::Relaxed);
    if mode != Mode::Connect {
        vm.transpiler.with_mut(|t| {
            t.options.minify_identifiers = false;
            t.options.minify_syntax = false;
            t.options.minify_whitespace = false;
            t.options.debugger = true;
        });
    }
}

/// Reclaim the per-VM [`RuntimeState`] boxed in [`init_runtime_state`]. Called
/// when the `VirtualMachine` is dropped, with the opaque pointer
/// returned by `init_runtime_state`. Clears the thread-local and drops the
/// `Box`.
///
/// # Safety
/// `state` must be the exact pointer returned by [`init_runtime_state`] for
/// this thread (or null), and must not be used again after this call.
unsafe fn deinit_runtime_state(state: OpaqueRuntimeState) {
    RUNTIME_STATE.set(ptr::null_mut());
    if !state.is_null() {
        // SAFETY: per fn contract — `state` is the unique `heap::alloc` result
        // from `init_runtime_state`; the TLS was just cleared so no other live
        // alias exists on this thread.
        let state = unsafe { bun_core::heap::take(state.cast::<RuntimeState>()) };
        debug_assert!(state.cron_jobs.get().is_empty());
        drop(state);
    }
    // Free the thread-local AST stores allocated by `Transpiler::init`
    // (via `Store::create()`). They live in TLS without a Drop, so each worker
    // thread strands a `Box<Store>` plus its lazily-allocated block chain when
    // the thread exits. `deinit()` is a no-op if a bundler arena currently owns
    // the allocator (`memory_allocator()` non-null) or the store was never
    // created. After the `RuntimeState` drop above nothing on this thread
    // touches the stores again.
    bun_ast::expr::data::Store::deinit();
    bun_ast::stmt::data::Store::deinit();
}

/// `loadPreloads()` — runs `--preload` scripts. Returns the first rejected
/// preload promise if any, else null.
///
/// Error mapping: resolver `Failure` returns the resolver error,
/// `NotFound` returns `error.ModuleNotFound`,
/// `JSModuleLoader.import` throwing returns a rejected promise.
fn load_preloads(vm: &VirtualMachine) -> bun_jsc::CrateResult<*mut JSInternalPromise> {
    // ── is_in_preload guard ─────────────────────────────────────────────
    let global = vm.global();
    vm.is_in_preload.set(true);
    bun_jsc::compiled_program::will_run_preloads(global);
    scopeguard::defer! {
        vm.is_in_preload.set(false);
        bun_jsc::compiled_program::did_run_preloads(global);
    }
    let kept_for_this_run = vm.preloads_kept_for_reload.take();

    let options = &vm.transpiler.get().options;
    if options.rewrite_jest_for_tests && options.vitest_globals {
        bun_removable_features::call_removable!(
            Test,
            Abort,
            crate::test_runner::jest::Jest::define_vitest_globals,
            global
        )
        .map_err(|_| bun_jsc::CrateError::JSError)?;
    }
    let transpiler = vm.transpiler.as_ptr();
    let top_level_dir = Fs::FileSystem::get().top_level_dir();
    let global_cache = if vm.standalone_module_graph.is_none() {
        GlobalCache::read_only
    } else {
        GlobalCache::disable
    };

    // Nothing writes `vm.preload` meanwhile: `reload()` defers while `is_in_preload`.
    for preload_slice in vm.preload.get() {
        // Strip "file://".
        let normalized: &[u8] = preload_slice
            .strip_prefix(b"file://".as_slice())
            .unwrap_or(preload_slice);

        // node: builtin specifiers bypass the file resolver — JSModuleLoader
        // resolves them internally, so `bun --import node:*` works like Node's.
        let module_name = if normalized.starts_with(b"node:") {
            bun_core::StringView::from_bytes(normalized)
        } else {
            // ── resolve ─────────────────────────────────────────────────────
            // SAFETY: nothing up the stack borrows the resolver.
            let mut result = match unsafe {
                (*transpiler).resolver.resolve_and_auto_install(
                    top_level_dir,
                    normalized,
                    ImportKind::Stmt,
                    global_cache,
                )
            } {
                ResolveResultUnion::Success(r) => r,
                ResolveResultUnion::Failure(e) => {
                    if let Some(log) = vm.log.get() {
                        // SAFETY: `log` outlives what the VM runs.
                        let _ = unsafe { &mut *log.as_ptr() }.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "{} resolving preload {}",
                                e.name(),
                                bun_core::fmt::format_json_string_latin1(preload_slice),
                            ),
                        );
                    }
                    return Err(e.into());
                }
                ResolveResultUnion::NotFound => {
                    if let Some(log) = vm.log.get() {
                        // SAFETY: `log` outlives what the VM runs.
                        let _ = unsafe { &mut *log.as_ptr() }.add_error_fmt(
                            None,
                            bun_ast::Loc::EMPTY,
                            format_args!(
                                "preload not found {}",
                                bun_core::fmt::format_json_string_latin1(preload_slice),
                            ),
                        );
                    }
                    return Err(bun_jsc::CrateError::ModuleNotFound);
                }
            };

            // ── import ──────────────────────────────────────────────────────
            let path_text = result
                .path()
                .expect("resolver Success result has a primary path")
                .text;
            vm.preload_hash
                .set(bun_watcher::Watcher::get_hash(path_text));
            let imports_vitest =
                crate::test_runner::jest::compiled_entry_point_imports_vitest(path_text);
            // SAFETY: nothing up the stack borrows the options.
            unsafe { (*transpiler).options.test_file_imports_vitest = imports_vitest };
            bun_core::StringView::from_bytes(path_text)
        };
        // Note: use `import_ptr` (not `import`) so the `*mut` we store in
        // `pending_internal_promise` keeps the FFI's mutable provenance instead
        // of being laundered through `&JSInternalPromise -> *const -> *mut`
        // (UB to write through under Stacked Borrows).
        let promise: *mut JSInternalPromise = match JSModuleLoader::import_ptr(global, &module_name)
        {
            Ok(p) => p.as_ptr(),
            // Report a preload that fails to resolve the same way as one that fails to load.
            Err(err) => {
                let rejected =
                    JSInternalPromise::rejected_promise_with_caught_exception(global, err)?;
                // The caller reports the error, so don't also report it as an unhandled rejection.
                rejected.set_handled();
                return Ok(ptr::from_mut(rejected));
            }
        };

        vm.set_pending_internal_promise(Some(promise));
        let _protected = JSValue::from_cell(promise).protected();

        // ── wait ────────────────────────────────────────────────────────
        if crate::test_runner::jest::Jest::runner().is_some() {
            let never_loads = vm.wait_for_test_runner_load(format_args!(
                "preload {}",
                bun_core::fmt::format_json_string_latin1(preload_slice),
            ));
            if let Some(rejected) = never_loads {
                return Ok(rejected);
            }
        } else {
            let _ = vm.wait_for_promise(AnyPromise::Internal(promise));
        }

        // SAFETY: `promise` is a live (still-protected) JSC heap cell.
        if unsafe { &*promise }.status() == PromiseStatus::Rejected {
            return Ok(promise);
        }
        // A stop was requested (worker terminate()/exit) while it loaded: the
        // caller checks the same and shuts down; load nothing more.
        if !vm.script_allowed() {
            return Ok(core::ptr::null_mut());
        }
        // `_protected` drops here → unprotect.
    }

    // Under --isolate each test file gets
    // a fresh global, so preloads must re-execute for every file. Otherwise,
    // only load preloads once.
    // If another reload was deferred while this reload's preloads ran, keep the list once so it can rerun them.
    vm.preloads_kept_for_reload.set(
        vm.hot_reload_deferred.get() && vm.hot_reload_counter.get() != 0 && !kept_for_this_run,
    );
    if !vm.test_isolation_enabled.get() && !vm.preloads_kept_for_reload.get() {
        // `Vec::clear` drops the `Box<[u8]>`
        // payloads but keeps capacity.
        vm.preload.with_mut(Vec::clear);
    }

    // SAFETY: nothing up the stack borrows the options; each access ends within its statement.
    unsafe {
        (*transpiler).options.test_file_imports_vitest = false;
        if (*transpiler).options.rewrite_jest_for_tests {
            (*transpiler).options.own_test_globals =
                crate::test_runner::jest::Jest::own_globals(global)
                    .map_err(|_| bun_jsc::CrateError::JSError)?;
        }
    }

    Ok(ptr::null_mut())
}

/// `ensureDebugger(block_until_connected)` — no-op when no debugger.
fn ensure_debugger(vm: &VirtualMachine, block_until_connected: bool) {
    // Note: `Debugger::create` / `wait_for_debugger_if_necessary` live in
    // `bun_jsc::debugger::Debugger` (Debugger.rs); the heavy bodies (futex
    // spin, debugger-thread spawn, deadline poll-loop) are there. This hook
    // is the literal `VirtualMachine::ensure_debugger` body — it owns the "is a debugger
    // configured?" guard and the `block_until_connected` branch, then
    // delegates to those two fns.
    if vm.debugger.get().is_none() {
        return;
    }
    // `Debugger::create` can fail (OOM / thread-spawn). The hook signature is
    // `()`, so log via `Output::err` (same shape as the `Transpiler::init`
    // error path above) and return without blocking.
    // SAFETY: `vm.global` is set during `VirtualMachine::init` and outlives the VM.
    if let Err(e) = bun_jsc::debugger::Debugger::create(vm, unsafe { &*vm.global.get() }) {
        bun_core::Output::err("Debugger", "{}", format_args!("create failed: {e:?}"));
        return;
    }
    if block_until_connected {
        bun_jsc::debugger::Debugger::wait_for_debugger_if_necessary(vm);
    }
}

/// `eventLoop().autoTick()`. Needs
/// `timer::All` for the poll-timeout calculation, hence dispatched here.
///
/// PERF: the one fn-ptr indirection is dwarfed by the kqueue/epoll syscall it
/// gates.
fn auto_tick(vm: &VirtualMachine) {
    let el = vm.event_loop();
    let loop_ = el.usockets_loop();

    // ── tick_immediate_tasks ────────────────────────────────────────────
    // After this call `immediate_tasks` reflects next-tick immediates, so
    // the `has_pending_immediate` read below is correct.
    el.tick_immediate_tasks();
    let has_yielded_tasks = el.promote_yield_tasks();
    #[cfg(windows)]
    if has_yielded_tasks || el.immediate_task_count() > 0 || el.has_pending_tasks() {
        el.wakeup();
    }

    // ── pending unref ───────────────────────────────────────────────────
    #[cfg(unix)]
    {
        // `swap(0)` so a concurrent
        // `increment_pending_unref_counter()` (cross-thread, see
        // `KeepAlive::unref_on_next_tick`) can't be lost between
        // the read and the reset.
        let pending_unref = vm
            .pending_unref_counter
            .swap(0, core::sync::atomic::Ordering::Relaxed);
        if pending_unref > 0 {
            loop_.unref_count(pending_unref);
        }
    }

    // ── DateHeaderTimer / imminent-GC ───────────────────────────────────
    let state = try_runtime_state();
    if let Some(state) = state {
        state.timer.update_date_header_timer_if_necessary(loop_, vm);
    }
    el.run_imminent_gc_timer();

    // ── poll the I/O loop with the next-timer deadline ──────────────────
    let Some(state) = state else {
        // No high-tier state (unit test) — fall back to a non-blocking I/O
        // poll. The uws loop must always be polled
        // (`tick_with_timeout`/`tick_without_idle`); `EventLoop::tick()` would only
        // drain JS tasks and never touch kqueue/epoll.
        loop_.tick_without_idle();
        // Still run the post-poll hooks.
        vm.on_after_event_loop();
        // SAFETY: `vm.global` is set during `VirtualMachine::init` and outlives the VM.
        let _ = unsafe { (*vm.global.get()).handle_rejected_promises() };
        return;
    };

    // ── addons' uv_idle_t / uv_prepare_t ────────────────────────────────
    // Run them before reading `has_pending_immediate` because their callbacks can queue work.
    #[cfg(unix)]
    let uv_idle_started = state.uv_loop.before_poll(vm);
    #[cfg(not(unix))]
    let uv_idle_started = false;

    // Call `ctx.timer.getTimeout(..)` ONLY inside
    // `if (loop.isActive())` — `get_timeout` has side effects (pops + fires
    // due `WTFTimer` heap entries), so it must stay guarded by `is_active()`
    // rather than running unconditionally.
    {
        // Read `immediate_tasks` AFTER
        // `tickImmediateTasks` swaps `next_immediate_tasks` in, so this
        // reflects next-tick immediates (queued during the drain above).
        // A started idle handle keeps the poll from blocking, like in libuv.
        let has_pending_immediate = has_yielded_tasks
            || uv_idle_started
            || el.immediate_task_count() > 0
            || el.has_pending_tasks();
        // Fold the QUIC deadline into the poll timeout.
        let quic_next_tick_us = loop_.internal_loop_data.quic_next_tick_us();
        let mut timespec = bun_core::Timespec { sec: 0, nsec: 0 };
        if loop_.is_active() {
            // Before `get_timeout`: the first call arms the idle GC timer, and a
            // timer armed after the poll deadline is computed is not in that deadline.
            el.process_gc_timer();
            // `get_timeout` reads CLOCK_MONOTONIC to compare against the timer heap; hand that
            // same reading to the tick for the park hook's idle-sweep rate limit. It is lazy,
            // and so is the hook: NOW_NS_UNKNOWN means it took none.
            let mut now: Option<bun_core::Timespec> = None;
            let have_timeout = state.timer.get_timeout(
                &mut timespec,
                has_pending_immediate,
                quic_next_tick_us,
                vm,
                &mut now,
            );
            let now_ns = now.map_or(bun_uws::NOW_NS_UNKNOWN, |t| t.ns());
            loop_.tick_with_timeout(if have_timeout { Some(&timespec) } else { None }, now_ns);
        } else {
            loop_.tick_without_idle();
        }
    }

    #[cfg(unix)]
    {
        // ── addons' uv_check_t (libuv runs them right after its poll) ────
        state.uv_loop.after_poll(vm);
        state.timer.drain_timers(vm);
    }

    vm.on_after_event_loop();
    // SAFETY: `vm.global` is set during `VirtualMachine::init` and outlives the VM.
    let _ = unsafe { (*vm.global.get()).handle_rejected_promises() };
}

fn run_pending_test_step(global: &JSGlobalObject) {
    bun_removable_features::call_removable!(
        Test,
        Abort,
        crate::test_runner::bun_test::BunTest::run_pending_step,
        global
    );
}

/// `eventLoop().autoTickActive()`. Same shape as
/// [`auto_tick`] but: no `runImminentGCTimer`, no `handleRejectedPromises` at
/// the tail, and no debug sleep-timer logging. Used by `bun_main` /
/// `on_before_exit` drain loops where blocking when the loop is idle would
/// hang shutdown.
fn auto_tick_active(vm: &VirtualMachine) {
    let el = vm.event_loop();
    let loop_ = el.usockets_loop();

    el.tick_immediate_tasks();
    let has_yielded_tasks = el.promote_yield_tasks();
    #[cfg(windows)]
    if has_yielded_tasks || el.immediate_task_count() > 0 || el.has_pending_tasks() {
        el.wakeup();
    }

    #[cfg(unix)]
    {
        // `swap(0)` so a concurrent
        // `increment_pending_unref_counter()` (cross-thread, see
        // `KeepAlive::unref_on_next_tick`) can't be lost between
        // the read and the reset.
        let pending_unref = vm
            .pending_unref_counter
            .swap(0, core::sync::atomic::Ordering::Relaxed);
        if pending_unref > 0 {
            loop_.unref_count(pending_unref);
        }
    }

    let Some(state) = try_runtime_state() else {
        loop_.tick_without_idle();
        vm.on_after_event_loop();
        return;
    };
    state.timer.update_date_header_timer_if_necessary(loop_, vm);

    #[cfg(unix)]
    let uv_idle_started = state.uv_loop.before_poll(vm);
    #[cfg(not(unix))]
    let uv_idle_started = false;

    {
        let has_pending_immediate = has_yielded_tasks
            || uv_idle_started
            || el.immediate_task_count() > 0
            || el.has_pending_tasks();
        let quic_next_tick_us = loop_.internal_loop_data.quic_next_tick_us();
        let mut timespec = bun_core::Timespec { sec: 0, nsec: 0 };
        if loop_.is_active() {
            // Before `get_timeout` — see the matching call in `auto_tick`.
            el.process_gc_timer();
            // `get_timeout` reads CLOCK_MONOTONIC to compare against the timer heap; hand that
            // same reading to the tick for the park hook's idle-sweep rate limit. It is lazy,
            // and so is the hook: NOW_NS_UNKNOWN means it took none.
            let mut now: Option<bun_core::Timespec> = None;
            let have_timeout = state.timer.get_timeout(
                &mut timespec,
                has_pending_immediate,
                quic_next_tick_us,
                vm,
                &mut now,
            );
            let now_ns = now.map_or(bun_uws::NOW_NS_UNKNOWN, |t| t.ns());
            loop_.tick_with_timeout(if have_timeout { Some(&timespec) } else { None }, now_ns);
        } else {
            loop_.tick_without_idle();
        }
    }

    #[cfg(unix)]
    {
        state.uv_loop.after_poll(vm);
        state.timer.drain_timers(vm);
    }

    vm.on_after_event_loop();
}

/// `printException` / `printErrorlikeObject` — formats `value` to stderr via
/// `ConsoleObject::Formatter`. Dispatched here so the high tier owns the
/// formatter.
fn print_exception(
    vm_ref: &VirtualMachine,
    value: JSValue,
    exception_list: Option<&mut bun_jsc::virtual_machine::ExceptionList>,
) {
    // The print half of `runErrorHandler`
    // (the `had_errors` save/restore lives in the low-tier caller). Route via
    // the buffered error writer; `defer writer.flush()` becomes a tail call —
    // no early returns below.
    let writer = &mut bun_core::Output::error_writer_buffered();

    let global = vm_ref.global();

    if let Some(exception) = value.as_exception(vm_ref.jsc_vm.get()) {
        // SAFETY: `as_exception` returned a live `*mut Exception` owned by the
        // JSC heap; we only read through it for the duration of this call.
        let exception = unsafe { &*exception };
        vm_ref.print_exception(exception, exception_list, writer, true);
    } else {
        let mut formatter = bun_jsc::console_object::Formatter::new(global);
        // `Formatter::new` already
        // defaults `error_display_level` to `Full` (ConsoleObject.rs:1176).
        let colors = bun_core::Output::enable_ansi_colors_stderr();
        vm_ref.print_errorlike_object(
            value,
            None,
            exception_list,
            &mut formatter,
            writer,
            colors,
            true,
        );
        // `defer formatter.deinit()` → Drop.
    }

    let _ = writer.flush();
}

/// `vm.timer.insert(timer)` — the heap lives in
/// [`RuntimeState::timer`]; low-tier callers (`AbortSignal::Timeout`) reach it
/// through this slot.
///
/// # Safety
/// See [`VirtualMachine::timer_insert`].
unsafe fn timer_insert(
    vm: &VirtualMachine,
    t: *const bun_event_loop::EventLoopTimer::EventLoopTimer,
) {
    timer_all_of(vm).insert(t);
}

#[unsafe(no_mangle)]
fn __bun_remove_timer(timer: &bun_event_loop::EventLoopTimer::EventLoopTimer) {
    timer_all().remove(timer);
}

/// For `AbortSignal::Timeout`, which turns its delay into a deadline below this tier.
fn timer_min_delay_ms() -> u32 {
    try_timer_all().map_or(0, |all| all.fake_timers.min_delay_ms())
}

/// For `AbortSignal::Timeout`, like `timer_min_delay_ms`.
fn abort_signal_timeout_clock() -> timer::Clock {
    try_timer_all().map_or(timer::Clock::Real, |all| {
        all.fake_timers.abort_signal_timeout_clock()
    })
}

fn timers_left() -> TimersLeft {
    let Some(all) = try_timer_all() else {
        return TimersLeft::default();
    };
    TimersLeft {
        armed: all.timers.has_program_timer(),
        holds_loop_ref: all.active_timer_count.get() > 0,
    }
}

/// Runs `f`, which must not run script, on the `NodeFS` of `vm`.
pub(crate) fn with_node_fs<R>(
    vm: &'static VirtualMachine,
    f: impl FnOnce(&mut crate::node::fs::NodeFS) -> R,
) -> R {
    runtime_state_of(vm).node_fs.with_mut(|node_fs| {
        f(node_fs.get_or_insert_with(|| crate::node::fs::NodeFS {
            sync_error_buf: bun_paths::path_buffer_pool::get(),
            // `vm` gates the embedded-file lookups inside `node:fs`.
            vm: vm.standalone_module_graph.is_some().then_some(vm),
        }))
    })
}

/// `WebCore.ObjectURLRegistry.singleton().has(specifier["blob:".len..])`.
fn has_blob_url(blob_id: &[u8]) -> bool {
    crate::webcore::object_url_registry::ObjectURLRegistry::singleton().has(blob_id)
}

fn name_text_of_blob_url(blob_id: &[u8], vm: &VirtualMachine) -> Option<Vec<u8>> {
    let registry = crate::webcore::object_url_registry::ObjectURLRegistry::singleton();
    let blob = registry.resolve_and_dupe(blob_id, vm.global())?;
    let loader = blob.get_loader(vm).filter(|_| !blob.needs_to_read_file());
    loader.map(|it| bun_aot::module_keys::name_of_text(it, blob.shared_view()))
}

/// `Response::get_blob_without_call_frame` /
/// `Request::get_blob_without_call_frame`. Downcasts
/// `value` to a `Response`/`Request` (whose data shapes + `BodyMixin` impl live
/// in this crate, above `bun_jsc` / `bun_js_parser_jsc`) and returns its body
/// Blob wrapped in a resolved Promise; `Ok(None)` to fall through to the
/// `Blob`/`BuildMessage`/`ResolveMessage` arms in `Macro::Run::coerce`.
fn body_mixin_get_blob(
    value: JSValue,
    global: &JSGlobalObject,
) -> bun_jsc::JsResult<Option<JSValue>> {
    use crate::webcore::body::BodyMixin as _;
    if let Some(resp) = value.as_class_ref::<crate::webcore::Response>() {
        return Ok(Some(resp.get_blob_without_call_frame(global)?));
    }
    if let Some(req) = value.as_class_ref::<crate::webcore::Request>() {
        return Ok(Some(req.get_blob_without_call_frame(global)?));
    }
    Ok(None)
}

/// `process.exit(code)`. Main-thread is `noreturn`; in a
/// worker it returns and the caller `panic!`s.
fn process_exit(global: &JSGlobalObject, code: u8) {
    crate::node::process::exit(global, code);
}

/// `graph.find(path).?.sourcemap.load()`.
/// Reaches the concrete `bun_standalone_graph::Graph` via its `UnsafeCell`
/// singleton accessor (proper write provenance) and lazily decodes the
/// embedded source map for `path`. The returned `Arc` is the caller's strong
/// ref.
///
/// Note: do **not** thread the `&'static dyn StandaloneModuleGraph` from
/// `vm.standalone_module_graph` here and cast it to `&mut Graph` — that
/// shared-ref provenance has no write permission, so the resulting `&mut` is
/// instant UB under Stacked Borrows regardless of `INIT_LOCK`. `Graph::get()`
/// hands out the `*mut` directly from the backing `UnsafeCell`.
///
/// `LazySourceMap::load` is the graph's only post-init mutation and is
/// serialized by `INIT_LOCK`.
fn load_standalone_sourcemap(
    path: &[u8],
) -> Option<std::sync::Arc<bun_sourcemap::ParsedSourceMap>> {
    let graph = bun_standalone_graph::Graph::get()?;
    // SAFETY: `graph` is the `UnsafeCell::get()` pointer to the
    // process-lifetime singleton. `find`/`load` mutate only per-file lazy
    // state; this hook runs on the JS thread and `LazySourceMap::load` is
    // additionally guarded by its own `INIT_LOCK`.
    unsafe { (*graph).find(path)?.sourcemap.load() }
}

/// `node_cluster_binding.child_singleton.deinit()` —
/// `IPCInstance.handleIPCClose`.
///
/// Called on the JS thread (the `CHILD_SINGLETON` static is JS-thread-only).
pub(crate) fn ipc_child_singleton_deinit() {
    // `InternalMsgHolder`'s owned fields (`Strong`s, map, `Vec`) all impl
    // `Drop`; taking the `Option` runs them.
    // SAFETY: JS-thread-only mutable static (see `child_singleton()` doc).
    unsafe {
        (*crate::node::node_cluster_binding::CHILD_SINGLETON.get()).take();
    }
}

// ────────────────────────────────────────────────────────────────────────────
// VmLoaderVTable — supplies the high-tier bodies for
// `bun_bundler::options::{normalize_specifier, get_loader_and_virtual_source}`.
// The low-tier `VirtualMachine::fetch_without_on_load_plugins` constructs a
// `VmLoaderCtx { vm: vm.cast(), vtable: hooks.vm_loader_vtable }` and threads
// it through; every fn pointer here recovers the concrete `*const
// VirtualMachine` / `*mut Blob` from the erased `*const ()` / `OpaqueBlob`.
// ────────────────────────────────────────────────────────────────────────────

mod vm_loader_ctx {
    use super::*;
    use crate::webcore::Blob;
    use bun_bundler::options::OpaqueBlob;

    /// Recover an [`OpaqueBlob`] as a shared `&Blob` (live until `blob_deinit`).
    ///
    /// # Safety
    /// `b` was produced by `resolve_blob` and not yet passed to `blob_deinit`.
    #[inline]
    unsafe fn blob(b: OpaqueBlob) -> &'static Blob {
        // SAFETY: per fn contract.
        unsafe { &*b.cast::<Blob>() }
    }

    bun_bundler::link_impl_VmLoaderCtx! {
        Runtime for extern VirtualMachine => |this| {
            origin_host() => (*this).origin.host,
            origin_path() => (*this).origin.path,
            loaders() => &raw const (*(*this).transpiler.as_ptr()).options.loaders,
            eval_source() => (*this)
                .module_loader
                .eval_source
                .get()
                .map(|source| &raw const **source),
            main() => (*this).main(),
            read_dir_info_package_json(dir) => {
                match (*(*this).transpiler.as_ptr()).resolver.read_dir_info(dir) {
                    Ok(Some(dir_info)) => {
                        dir_info
                            .package_json()
                            .or(dir_info.enclosing_package_json)
                    }
                    _ => None,
                }
            },
            is_blob_url(spec) => crate::webcore::object_url_registry::is_blob_url(spec),
            resolve_blob(spec) => {
                crate::webcore::object_url_registry::ObjectURLRegistry::singleton()
                    .resolve_and_dupe(spec, &*(*this).global.get())
                    .map(|b| bun_core::heap::into_raw(Box::new(b)).cast::<()>())
            },
            blob_loader(b) => blob(b).get_loader(&*this),
            // Returned slices borrow blob heap storage that lives until
            // `blob_deinit`; erased to `'static` per the interface signature —
            // sound because the bundler caller drops them before `blob_deinit`.
            blob_store_path(b) => blob(b).store_path(),
            blob_needs_read_file(b) => blob(b).needs_to_read_file(),
            blob_shared_view(b) => blob(b).shared_view(),
            blob_deinit(b) => {
                // SAFETY: `b` is the live boxed `Blob`; sole owner.
                drop(bun_core::heap::take(b.cast::<Blob>()))
            },
        }
    }
}

/// The static `RuntimeHooks` instance handed to `bun_jsc`.
#[unsafe(no_mangle)]
static __BUN_RUNTIME_HOOKS: RuntimeHooks = RuntimeHooks {
    init_runtime_state,
    deinit_runtime_state,
    load_preloads,
    ensure_debugger,
    auto_tick,
    auto_tick_active,
    run_pending_test_step,
    print_exception,
    timer_insert,
    timer_min_delay_ms,
    abort_signal_timeout_clock,
    timers_left,
    default_client_ssl_ctx: default_client_ssl_ctx_for_websocket,
    ssl_ctx_cache_get_or_create,
    has_blob_url,
    name_text_of_blob_url,
    body_mixin_get_blob,
    process_exit,
    console_on_before_print,
    console_print_runtime_object,
    load_standalone_sourcemap,
    apply_standalone_runtime_flags,
    parse_worker_exec_argv_flags,
    stop_watches_for_vm_teardown,
    cron_clear_all_reload: crate::api::cron::CronJob::stop_all_for_reload,
    retroactively_report_discovered_tests,
    cancel_timers,
    end_hot_run_timers,
    stop_dns_for_vm_teardown,
    stop_active_handles_for_vm_teardown: stop_active_handles_for_vm_teardown_hook,
    disarm_all_timers_for_vm_teardown,
    close_timer_loop_handles_after_vm_destroyed,
};

// ════════════════════════════════════════════════════════════════════════════
// WebWorker / Debugger runtime hooks
// ════════════════════════════════════════════════════════════════════════════

/// Apply the standalone-executable graph's runtime flags to the transpiler.
///
/// # Safety
/// `graph` is the process-lifetime trait object whose data pointer is a
/// `bun_standalone_graph::Graph` (the only implementor — set in
/// `init_with_module_graph` / inherited from the parent VM).
unsafe fn apply_standalone_runtime_flags(
    transpiler: &mut bun_bundler::Transpiler<'static>,
    graph: &'static dyn bun_resolver::StandaloneModuleGraph,
) {
    // SAFETY: per fn contract — sole implementor; trait-object data pointer IS
    // the concrete `Graph` (originally upcast from `&Graph`, so the data
    // pointer is `Graph`-aligned). Read-only downcast (`&*`, not `&mut *` —
    // the shared-ref provenance carries no write permission); the body only
    // reads `graph.flags`.
    let graph = unsafe {
        &*std::ptr::from_ref::<dyn bun_resolver::StandaloneModuleGraph>(graph)
            .cast::<c_void>()
            .cast::<bun_standalone_graph::Graph>()
    };
    crate::run_main::apply_standalone_runtime_flags(transpiler, graph);
}

/// Scan a Worker's `execArgv` for the flags that mean something there. Like the
/// CLI parser, the scan stops at the first positional.
///
/// # Safety
/// Each `WTFStringImpl` in `exec_argv` is a live WTF string (the C++
/// `Worker::create` array, kept alive for the worker's lifetime).
unsafe fn parse_worker_exec_argv_flags(
    exec_argv: &[bun_core::WTFStringImpl],
) -> Option<WorkerExecArgvFlags> {
    let mut flags = WorkerExecArgvFlags {
        allow_addons: true,
        allow_ffi_cc: true,
        invalid: None,
    };
    if crate::cli::startup_options::may_refuse_options() {
        // SAFETY: per fn contract: each entry that is not null is a live `WTFStringImpl*`.
        let words = exec_argv
            .iter()
            .filter(|arg| !arg.is_null())
            .map(|&arg| unsafe { &*arg }.to_owned_slice_z());
        let words: Vec<_> = words.collect();
        let words: Vec<&[u8]> = words.iter().map(|word| word.as_bytes()).collect();
        crate::cli::startup_options::warn_of_ignored_options(&words);
    }
    for (index, &arg) in exec_argv.iter().enumerate() {
        if arg.is_null() {
            continue;
        }
        // SAFETY: per fn contract — `arg` is a live `WTFStringImpl*`.
        let owned = unsafe { &*arg }.to_owned_slice_z();
        let bytes = owned.as_bytes();
        if bytes.first() != Some(&b'-') {
            break;
        }
        if bytes == b"--" {
            break;
        }
        if bytes == b"--no-addons" {
            flags.allow_addons = false;
        } else if bytes == b"--no-ffi-cc" {
            flags.allow_ffi_cc = false;
        } else if matches!(
            bytes.strip_prefix(b"--disallow-code-generation-from-strings".as_slice()),
            Some([] | [b'=', ..])
        ) {
            flags.invalid.get_or_insert(index);
        }
    }
    Some(flags)
}

/// Drops the owners of polls, which are slots of `RareData`: it is freed before the runtime state.
fn stop_watches_for_vm_teardown() {
    if let Some(state) = try_runtime_state() {
        state.cron_os_jobs.release_for_vm_teardown();
        state.memory_pressure_watcher.set(None);
        state.browsers.release_for_vm_teardown();
    }
}

pub(crate) fn hot_reload_generation() -> f64 {
    let vm = VirtualMachine::get();
    if vm.hot_reload.get() == bun_jsc::virtual_machine::HotReload::Hot {
        f64::from(vm.hot_reload_counter.get())
    } else {
        -1.0
    }
}

/// `RuntimeHooks::cancel_timers` — cancel every `TimeoutObject` /
/// `ImmediateObject` still linked in the current thread's timer heap so the
/// JS pins drop before the GC sweep / `~VM`; or, for
/// `only`, just those script of that (stopped) context set.
/// `timer::All` lives in `bun_runtime`; callers (`global_exit`,
/// `WebWorker::shutdown`) are in `bun_jsc`, hence the hook.
fn cancel_timers(vm: &VirtualMachine, only: Option<bun_jsc::ContextId>) {
    let Some(all) = try_timer_all() else {
        return;
    };
    if only.is_none() {
        // Drain the `fs.watchFile` scheduler queue while the timer heap and JSC
        // are both still live. Each queued `StatWatcher` holds a `RefPtr` back to
        // the scheduler and the scheduler holds a queue ref on the watcher, so any
        // watcher still queued at exit forms a cycle and leaks. Runs before
        // `cancel_all_timeout_objects` so the scheduler's `EventLoopTimer` is still
        // linked when `set_timer(0)` removes it.
        StatWatcherScheduler::shutdown_for_exit(vm);
        // The realm is going (the VM's end, or the end of a test file under `--isolate`), and its
        // connections are closed.
        sql_rare(vm).forget_callbacks();
    }
    if let Some(context) = only {
        // A graph's context keeps the set of its own live timers.
        let Some(timers) = vm.timer_context(context).map(|c| c.take_timers()) else {
            return;
        };
        for &timer in timers.keys() {
            // SAFETY: tracked ⇒ live (each untracks itself when it drops); a
            // discard may free the one it discards, never another tracked one.
            unsafe { timer::discard_js_timer(timer) };
        }
        return;
    }
    // Fake-timer state lives in the per-thread `timer::All`, so it would outlive this global.
    all.fake_timers.forget_realm(vm.global());
    all.cancel_all_timeout_objects();
}

/// `RuntimeHooks::end_hot_run_timers`.
fn end_hot_run_timers(vm: &VirtualMachine, cancel: CancelHotRunTimers) {
    if let Some(timers) = try_timer_all() {
        timers.end_hot_run(vm, cancel);
    }
}

/// `RuntimeHooks::close_timer_loop_handles_after_vm_destroyed`: teardown-only companion of
/// `cancel_timers` (which the `--isolate` swap also uses on a live VM).
///
/// # Safety
/// `runtime_state()` is installed; JS thread; the JSC VM is already destroyed.
unsafe fn close_timer_loop_handles_after_vm_destroyed(_vm: *mut VirtualMachine) {
    #[cfg(windows)]
    timer_all().close_loop_handles_for_vm_teardown();
}

/// `RuntimeHooks::stop_active_handles_for_vm_teardown` — see [`stop_active_handles_for_vm_teardown`].
///
/// # Safety
/// `vm` is the live per-thread VM on the JS thread; the JSC heap is alive.
unsafe fn stop_active_handles_for_vm_teardown_hook(vm: *mut VirtualMachine) -> SweepResult {
    // SAFETY: per the contract above.
    stop_active_handles_for_vm_teardown(unsafe { &*vm })
}

/// `RuntimeHooks::disarm_all_timers_for_vm_teardown`.
unsafe fn disarm_all_timers_for_vm_teardown(_vm: *mut VirtualMachine) {
    if let Some(all) = try_timer_all() {
        // SAFETY: JS thread; teardown has forbidden script.
        unsafe { all.disarm_all_for_vm_teardown() };
    }
}

/// `RuntimeHooks::stop_dns_for_vm_teardown` — destroy the per-VM global DNS
/// resolver's c-ares channel now so its `ARES_EDESTRUCTION` and socket-state
/// callbacks run while the JSC VM, `RareData.file_polls`, and `runtime_state`
/// are all still live.
fn stop_dns_for_vm_teardown() -> SweepResult {
    let Some(state) = try_runtime_state() else {
        return SweepResult::Idle;
    };
    let mut result = SweepResult::Idle;
    if let Some(gd) = state.global_dns_data.get() {
        // SAFETY: the VM-global resolver, pinned by `GlobalData` (its own ref
        // never drops here).
        result = result.and(unsafe {
            crate::dns_jsc::Resolver::close_channel_for_terminate(gd.resolver.as_ctx_ptr())
        });
        #[cfg(windows)]
        gd.resolver.cancel_pending_uv_requests_for_teardown();
    }
    #[cfg(target_os = "macos")]
    crate::dns_jsc::dns_sd::SharedConnection::close_for_terminate();
    result
}

/// `--isolate` swap: a microtask still pending at end-of-file (queued by
/// `tick_immediate_tasks` or `handle_rejected_promises`) can register new
/// handles when it runs, so drain first so they are armed before the sweep,
/// then stop. (VM teardown must *not* drain here — its
/// prepareForDestruction discards the pre-exit queues.)
pub(crate) fn stop_active_handles_for_test_isolation(vm: &VirtualMachine) {
    let _ = vm.event_loop().drain_microtasks();
    let _ = stop_active_handles(vm, bun_jsc::StopReason::Disposed);
}

pub(crate) fn stop_active_handles_for_vm_teardown(vm: &VirtualMachine) -> SweepResult {
    stop_active_handles(vm, bun_jsc::StopReason::VmTeardown)
}

/// One stop-phase sweep over what the VM's contexts own: every armed
/// [`bun_jsc::AbortHandle`] (Node's `HandleWrap` list) is closed natively now,
/// while the VM is alive, rather than by a GC finalizer during `~VM`.
fn stop_active_handles(vm: &VirtualMachine, reason: bun_jsc::StopReason) -> SweepResult {
    if let Some(all) = try_timer_all() {
        all.event_loop_delay.disable_all();
    }
    vm.stop_context_handles(reason)
}

/// `TestReporterAgent.retroactivelyReportDiscoveredTests(agent, next_test_id)`.
/// When `TestReporter.enable` arrives after test
/// collection has started, walk the already-discovered scope tree, assign
/// debugger test IDs, and emit `reportTestFoundWithLocation` for each.
/// Returns `next_test_id` advanced past every ID assigned (the caller writes
/// it back into `TestReporterAgent::next_test_id`).
fn retroactively_report_discovered_tests(
    agent: &mut bun_jsc::debugger::TestReporterHandle,
    next_test_id: i32,
) -> i32 {
    use crate::test_runner::bun_test::{Phase, ScopeId, TestScheduleEntry, clone_active_strong};
    use bun_jsc::debugger::TestType;
    use bun_ptr::CellExt as _;

    let Some(active_file) = clone_active_strong() else {
        return next_test_id;
    };

    // Only report if we're in collection or execution phase (tests have been
    // discovered).
    match active_file.phase.get() {
        Phase::Collection | Phase::Execution => {}
        Phase::Done => return next_test_id,
    }

    // Get the file path for source location info.
    let source_url = bun_core::StringView::from_bytes(active_file.file.path);

    let mut max_id: i32 = next_test_id;

    // Use an explicit stack because describe() can nest to any depth.
    let mut pending: Vec<(TestScheduleEntry, i32)> = Vec::new();
    let push_children = |pending: &mut Vec<_>, scope: ScopeId, id: i32| {
        let entries = &active_file.scope(scope).entries;
        entries.with_taken(|entries| pending.extend(entries.iter().rev().map(|&it| (it, id))));
    };
    push_children(&mut pending, ScopeId::ROOT, -1);
    while let Some((entry, parent_id)) = pending.pop() {
        let (base, test_type) = match entry {
            TestScheduleEntry::Describe(id) => (&active_file.scope(id).base, TestType::Describe),
            TestScheduleEntry::TestCallback(id) => (&active_file.entry(id).base, TestType::Test),
        };
        if base.test_id_for_debugger.get() == 0 {
            max_id += 1;
            // Assign the ID so start/end events will fire during execution.
            base.test_id_for_debugger.set(max_id);
            let name =
                bun_core::StringView::from_bytes(base.name.as_deref().unwrap_or(b"(unnamed)"));
            agent.report_test_found_with_location(
                max_id,
                &name,
                test_type,
                parent_id,
                &source_url,
                base.line_no as i32,
            );
        }
        if let TestScheduleEntry::Describe(id) = entry {
            push_children(&mut pending, id, base.test_id_for_debugger.get());
        }
    }
    max_id
}

// ════════════════════════════════════════════════════════════════════════════
// ConsoleObject runtime-type hooks
// ════════════════════════════════════════════════════════════════════════════

/// `Jest.runner.?.bun_test_root.onBeforePrint()` — flush the test reporter's
/// line state before user `console.log` output interleaves with it.
fn console_on_before_print() {
    if let Some(runner) = crate::test_runner::jest::Jest::runner() {
        runner.bun_test_root.on_before_print();
    }
}

use bun_io::AsFmt;

/// `ConsoleObject.Formatter.printAs(.Private, …)` runtime-type chain — see
/// [`RuntimeHooks::console_print_runtime_object`]. Returns `true` when `value`
/// matched one of the high-tier types and was fully formatted.
fn console_print_runtime_object<'a, 'f>(
    formatter: &'a mut bun_jsc::Formatter<'f>,
    writer: &'a mut dyn bun_io::Write,
    value: JSValue,
    enable_ansi_colors: bool,
) -> JsResult<bool> {
    if enable_ansi_colors {
        console_print_runtime_object_inner::<true>(formatter, writer, value)
    } else {
        console_print_runtime_object_inner::<false>(formatter, writer, value)
    }
}

fn console_print_runtime_object_inner<const C: bool>(
    formatter: &mut bun_jsc::Formatter<'_>,
    writer_: &mut dyn bun_io::Write,
    value: JSValue,
) -> JsResult<bool> {
    use crate::api::BuildArtifact;
    use crate::api::archive::Archive;
    use crate::webcore::{Blob, Request, Response, S3Client};
    use core::fmt::Write as _;

    macro_rules! pf {
        ($s:literal) => {
            if C {
                ::bun_core::pretty_fmt!($s, true)
            } else {
                ::bun_core::pretty_fmt!($s, false)
            }
        };
    }

    // When JS throws, `write_format` returns a plain error and the exception is still pending.
    fn rethrow_pending(global: &JSGlobalObject, write_format_failed: bool) -> JsResult<bool> {
        if write_format_failed && global.has_exception() {
            return Err(bun_jsc::JsError::Thrown);
        }
        Ok(true)
    }
    fn timeout_id_and_repeats(value: JSValue) -> Option<(u64, bool)> {
        let timer = value.as_class_ref::<crate::timer::TimeoutObject>()?;
        Some((timer.id, timer.repeats()))
    }
    let global = formatter.global_this;

    if let Some(response) = value.as_class_ref::<Response>() {
        let mut w = AsFmt::new(writer_);
        let result = response.write_format::<_, _, C>(formatter, &mut w);
        return rethrow_pending(global, result.is_err());
    }
    if let Some(request) = value.as_class_ref::<Request>() {
        let mut w = AsFmt::new(writer_);
        let result = request.write_format::<_, _, C>(value, formatter, &mut w);
        return rethrow_pending(global, result.is_err());
    }
    if let Some(build) = value.as_class_ref::<BuildArtifact>() {
        let mut w = AsFmt::new(writer_);
        let result = build.write_format::<_, _, C>(value, formatter, &mut w);
        return rethrow_pending(global, result.is_err());
    }
    if let Some(blob) = value.as_class_ref::<Blob>() {
        let mut w = AsFmt::new(writer_);
        let result = blob.write_format::<_, _, C>(formatter, &mut w);
        return rethrow_pending(global, result.is_err());
    }
    if let Some(s3client) = value.as_class_ref::<S3Client>() {
        let mut w = AsFmt::new(writer_);
        let result = s3client.write_format::<_, _, C>(formatter, &mut w);
        return rethrow_pending(global, result.is_err());
    }
    if let Some(archive) = value.as_class_ref::<Archive>() {
        let mut w = AsFmt::new(writer_);
        let result = archive.write_format::<_, _, C>(formatter, &mut w);
        return rethrow_pending(global, result.is_err());
    }
    if bun_jsc::FetchHeaders::cast_(value, formatter.global_this.vm()).is_some() {
        if let Some(to_json_function) = value.get(formatter.global_this, "toJSON")? {
            formatter.add_for_new_line("Headers ".len());
            let _ = bun_io::Write::write_all(writer_, pf!("<r>Headers ").as_bytes());
            let result = to_json_function.call(formatter.global_this, value, &[])?;
            let prev_quote_keys = formatter.quote_keys;
            formatter.quote_keys = true;
            let mut w = AsFmt::new(writer_);
            // UFCS — `Formatter` has an inherent `print_as` (const-generic
            // `FORMAT`, `&mut dyn bun_io::Write`); we need the trait's
            // runtime-tag overload that accepts our `core::fmt::Write` adapter.
            let r = bun_jsc::ConsoleFormatter::print_as::<_, C>(
                formatter,
                bun_jsc::FormatTag::Object,
                &mut w,
                result,
                bun_jsc::JSType::Object,
            );
            formatter.quote_keys = prev_quote_keys;
            r?;
            return Ok(true);
        }
        // Spec falls through (no `return`) when `toJSON` is absent.
    }
    if let Some((id, repeats)) = timeout_id_and_repeats(value) {
        formatter.add_for_new_line("Timeout(# ) ".len() + bun_core::fmt::digit_count(id));
        let mut w = AsFmt::new(writer_);
        if repeats {
            formatter.add_for_new_line("repeats ".len() + bun_core::fmt::digit_count(id));
            let _ = write!(
                w,
                "{}Timeout{} {}(#{}{}{}{}, repeats){}",
                pf!("<r><blue>"),
                pf!("<r>"),
                pf!("<d>"),
                pf!("<yellow>"),
                id,
                pf!("<r>"),
                pf!("<d>"),
                pf!("<r>")
            );
        } else {
            let _ = write!(
                w,
                "{}Timeout{} {}(#{}{}{}{}){}",
                pf!("<r><blue>"),
                pf!("<r>"),
                pf!("<d>"),
                pf!("<yellow>"),
                id,
                pf!("<r>"),
                pf!("<d>"),
                pf!("<r>")
            );
        }
        return Ok(true);
    }
    if let Some(immediate) = value.as_class_ref::<crate::timer::ImmediateObject>() {
        let id = immediate.id;
        formatter.add_for_new_line("Immediate(# ) ".len() + bun_core::fmt::digit_count(id));
        let mut w = AsFmt::new(writer_);
        let _ = write!(
            w,
            "{}Immediate{} {}(#{}{}{}{}){}",
            pf!("<r><blue>"),
            pf!("<r>"),
            pf!("<d>"),
            pf!("<yellow>"),
            id,
            pf!("<r>"),
            pf!("<d>"),
            pf!("<r>")
        );
        return Ok(true);
    }
    if let Some(build_log) = value.as_class_ref::<bun_jsc::BuildMessage>() {
        let mut w = AsFmt::new(writer_);
        let _ = build_log.msg.write_format::<C>(&mut w);
        return Ok(true);
    }
    if let Some(resolve_log) = value.as_class_ref::<bun_jsc::ResolveMessage>() {
        let mut w = AsFmt::new(writer_);
        let _ = resolve_log.msg.write_format::<C>(&mut w);
        return Ok(true);
    }
    bun_removable_features::call_removable_or!(
        Test,
        ReturnDefault,
        { Ok(false) },
        console_print_asymmetric_matcher::<C>,
        formatter,
        writer_,
        value
    )
}

#[inline(never)] // --trim cuts the test runner at the call.
fn console_print_asymmetric_matcher<const C: bool>(
    formatter: &mut bun_jsc::Formatter<'_>,
    writer_: &mut dyn bun_io::Write,
    value: JSValue,
) -> JsResult<bool> {
    use crate::test_runner::pretty_format::{JestPrettyFormat, WrappedWriter};
    // `writer_` is `&mut dyn bun_io::Write`; wrap once more so the
    // (sized) `&mut dyn bun_io::Write` satisfies `WrappedWriter<W>`'s
    // `W: bun_io::Write` bound via the blanket `impl Write for &mut W`.
    let mut sink: &mut dyn bun_io::Write = &mut *writer_;
    let mut wrapped = WrappedWriter::new(&mut sink);
    JestPrettyFormat::print_asymmetric_matcher::<_, _, C>(formatter, &mut wrapped, value)
}

// ════════════════════════════════════════════════════════════════════════════
// Module loader
// ════════════════════════════════════════════════════════════════════════════

fn to_jsc_fetch_error(err: &crate::Error) -> bun_jsc::CrateError {
    match err {
        crate::Error::Jsc(e) => *e,
        crate::Error::Bundler(e) => (*e).into(),
        crate::Error::Resolver(e) => (*e).into(),
        crate::Error::Install(e) => (*e).into(),
        crate::Error::Core(e) => (*e).into(),
        crate::Error::Sys(e) => (*e).into(),
        crate::Error::Alloc(e) => (*e).into(),
        crate::Error::ModuleNotFound => bun_jsc::CrateError::ModuleNotFound,
        crate::Error::WriteFailed => bun_jsc::CrateError::WriteFailed,
        crate::Error::JSError | crate::Error::Js(_) => bun_jsc::CrateError::JSError,
        _ => bun_jsc::CrateError::ParseError,
    }
}
/// Shared guard for the two parse-failure exits: register the module with the
/// Node compile cache (Unknown module type maps to CJS, matching Node).
fn note_compile_cache_parse_failure(
    path: &bun_resolver::fs::Path<'_>,
    loader: Loader,
    module_type: ModuleType,
) {
    if bun_jsc::node_compile_cache::is_enabled() && loader.is_java_script_like() && path.is_file() {
        bun_jsc::node_compile_cache::note_parse_failure(
            path.text,
            !matches!(module_type, ModuleType::Esm),
        );
    }
}

/// `ModuleLoader.transpileSourceCode(...)` — the runtime-transpiler path:
/// read file → `Transpiler::parse`
/// → `js_printer::print` → `ResolvedSource`.
///
/// # Safety
/// `args.log` is live for the call.
#[unsafe(no_mangle)]
unsafe fn __bun_transpile_source_code(
    jsc_vm: &VirtualMachine,
    args: &TranspileArgs<'_>,
) -> Result<ResolvedSource, bun_jsc::CrateError> {
    transpile_source_code_inner::<false>(jsc_vm, args).map_err(|e| to_jsc_fetch_error(&e))
}

/// Inner body of [`__bun_transpile_source_code`] — split for `?`-on-`Result`
/// error flow.
fn transpile_source_code_inner<const DATA_ONLY: bool>(
    jsc_vm: &VirtualMachine,
    args: &TranspileArgs<'_>,
) -> crate::Result<ResolvedSource> {
    let mut resolved_source = transpile_source_code_of_any_provenance::<DATA_ONLY>(jsc_vm, args)?;
    resolved_source.is_static |= is_input_static(jsc_vm, args);
    Ok(resolved_source)
}

#[inline(never)]
fn create_html_bundle(global_object: &JSGlobalObject, path: &[u8]) -> JSValue {
    let html_bundle = crate::api::HTMLBundle::init(global_object, path);
    crate::api::HTMLBundle::to_js(html_bundle, global_object)
}

/// Whether what is transpiled is static code (`ResolvedSource::is_static`), so that what is made of it is.
fn is_input_static(vm: &VirtualMachine, args: &TranspileArgs<'_>) -> bool {
    let path = &args.extra.path;
    match args.virtual_source {
        // The program itself, from `-e` or stdin. Any other is a plugin's text or a blob.
        Some(source) => vm
            .module_loader
            .eval_source
            .get()
            .is_some_and(|eval_source| core::ptr::eq(&raw const **eval_source, source)),
        None => {
            VirtualMachine::is_file_on_disk_static(vm.standalone_module_graph.is_some(), path.text)
        }
    }
}

/// The body of [`transpile_source_code_inner`], which says whether the result is static code.
fn transpile_source_code_of_any_provenance<const DATA_ONLY: bool>(
    jsc_vm: &VirtualMachine,
    args: &TranspileArgs<'_>,
) -> crate::Result<ResolvedSource> {
    use Loader as L;
    let extra = args.extra;

    let path: &Fs::Path = &extra.path;
    let (loader, module_type): (Loader, ModuleType) = (extra.loader.get(), extra.module_type.get());

    let disable_transpilying = args.flags.disable_transpiling();
    let specifier = args.specifier;
    let referrer = args.referrer;
    let input_specifier = &args.input_specifier;
    let global_object = args.global_object;

    // ── disable_transpiling fast-path for non-JS-like loaders ───────────────
    if disable_transpilying
        && !(loader.is_java_script_like()
            || matches!(
                loader,
                L::Toml | L::Yaml | L::Json5 | L::Xml | L::Text | L::Json | L::Jsonc
            ))
    {
        return Ok(ResolvedSource {
            source_url: input_specifier.create_if_different(path.text),
            ..Default::default()
        });
    }

    match loader {
        // ────────────────────────────────────────────────────────────────────
        // JS-like + JSON/TOML/YAML/text/md — the parse→print path.
        // ────────────────────────────────────────────────────────────────────
        L::Js
        | L::Jsx
        | L::Ts
        | L::Tsx
        | L::Json
        | L::Jsonc
        | L::Toml
        | L::Yaml
        | L::Json5
        | L::Xml
        | L::Text
        | L::Md => {
            // `bun_ast::ASTMemoryAllocator::Scope`.
            let mut _ast_scope = bun_ast::ast_memory_allocator::Scope::default();
            _ast_scope.enter();

            // `Transpiler::reset_store`. Inline only the
            // block-store half; `AstAlloc` gets its own per-transpile state
            // below, so the side module's long-lived state is not touched.
            bun_ast::Expr::data_store_reset();
            bun_ast::Stmt::data_store_reset();

            let hash = bun_watcher::Watcher::get_hash(path.text);
            let (main, main_hash) = (jsc_vm.main(), jsc_vm.main_hash.get());
            let is_main = main.is_some_and(|main| {
                main.len() == path.text.len() && main_hash == hash && main == path.text
            });
            let is_preload = jsc_vm.is_in_preload.get() && jsc_vm.preload_hash.get() == hash;

            // ── Arena take/give-back ────────────────────────────────────────
            // Reuse the per-VM arena when free; allocate a
            // fresh boxed one otherwise. `give_back_arena` is cleared on the
            // ParseError path, which leaves it for the caller to inspect.
            let arena: Box<bun_alloc::Arena> = jsc_vm
                .module_loader
                .transpile_source_code_arena
                .take()
                .unwrap_or_else(|| Box::new(bun_alloc::Arena::new()));
            // Stable heap address (Box interior); survives the move into
            // `arena_guard` and into the VM slot on give-back.
            let arena_ptr: *const bun_alloc::Arena = &raw const *arena;
            // Captured before `arena` moves into `arena_guard` (the Box
            // interior is address-stable across the move).
            let arena_heap: *mut bun_alloc::mimalloc::Heap = arena.heap_ptr();
            let give_back_arena = true;
            // Note: a scopeguard so `?`-early-returns still run the cleanup.
            let mut arena_guard = scopeguard::guard(
                (jsc_vm, arena, give_back_arena, args.flags),
                |(jsc_vm, mut arena, give_back, flags)| {
                    let slot = &jsc_vm.module_loader.transpile_source_code_arena;
                    if !give_back {
                        // When `give_back_arena == false`, ownership is held past
                        // `process_fetch_log` so log spans pointing into the
                        // arena stay valid. The ParseError path that flips
                        // `give_back=false` is LIVE: the caller
                        // (`Bun__transpileFile` → `process_fetch_log`, spec
                        // :1112-1114) reads `log` entries whose spans point
                        // into arena-owned source bytes. Freeing here would be
                        // a use-after-free.
                        //
                        // We can't widen `TranspileExtra` (lower tier) to carry
                        // the `Box<Arena>` back, so park it in the per-VM slot
                        // UN-reset. `Bun__transpileFile`'s `_reset_arena` guard
                        // (`ModuleLoader::reset_arena`) runs after
                        // `process_fetch_log` and resets/reclaims it then —
                        // matching the spec lifetime.
                        slot.set(Some(arena));
                        return;
                    }
                    if slot.get().is_none() {
                        if flags != FetchFlags::PrintSource {
                            if jsc_vm.smol {
                                arena.reset();
                            } else {
                                // See `MimallocArena::reset_retain_with_limit`
                                // for why this is a no-op-until-limit rather
                                // than a bump-pointer reset (each fresh
                                // `mi_heap`'s first alloc pays
                                // `mi_arena_pages_alloc` → bitmap memset).
                                //
                                // PERF NOTE: the over-limit branch of this is
                                // `MimallocArena::reset()` = `mi_heap_destroy`
                                // + `mi_heap_new`, and `mi_heap_destroy` is
                                // the costly half (per-page free-list/bitmap
                                // teardown, plus `_mi_stats_merge_from`'s
                                // `mi_stats_t` walk when stats are compiled in).
                                // Because `AstAlloc::deallocate` is a no-op (the
                                // AST graph is abandoned, not freed — see the
                                // `Expr::Data::clone_in` aliasing invariant in
                                // `ast_alloc.rs`), this heap's footprint only
                                // *grows* across retained modules, so a tight
                                // cap means a `mi_heap_destroy` every few
                                // modules — and `next lint` transpiles a few
                                // hundred. `mi_heap_collect` can't substitute:
                                // it only returns *empty* pages, and there are
                                // none while the dead AST blocks pin them. So
                                // the lever is the cap: raise it to the spec's
                                // 8 MB (matching every other
                                // `reset_retain_with_limit` call site) so the
                                // common case retains the warm heap and the
                                // destroy fires ~4× less often. This re-adds the
                                // ~6 MB anon-rw mid-run footprint that commit
                                // bfe6056b1e8e shaved off by going to 2 MB —
                                // accepted: the lint/create-next RSS budget has
                                // headroom, and the
                                // per-destroy CPU is the bigger lever.
                                arena.reset_retain_with_limit(8 * 1024 * 1024);
                            }
                        }
                        slot.set(Some(arena));
                    }
                    // else: drop the fresh Box.
                },
            );
            // Per-transpile `AstAlloc` state spilling into the transpile
            // arena. Declared after `arena_guard` so it drops before the
            // guard can reset that heap.
            let _ast_alloc_scope = bun_alloc::ast_alloc::ScopedAstAlloc::with_spill(arena_heap);

            let mut cache = RuntimeTranspilerCache::default();

            // ── Swap `vm.transpiler.log` (and linker/resolver/pm logs) ──────
            // `parse_maybe_return_file_only` writes diagnostics
            // to `vm.transpiler.log`; the per-call `args.log` is what
            // `Bun__transpileFile` later passes to `process_fetch_log`
            //. Without this swap, parse errors land in the
            // VM's stale log and the user-visible error formatting reads an
            // empty buffer.
            // Note: `vm.transpiler` is already read live below
            // (`.reset_store()`, `.linker`, `.log` at :338) so the original
            // "uninitialized Transpiler" gate was stale.
            // `transpiler.log` / `args.log` are never-null (set in
            // `Transpiler::init` / by the C++ caller respectively).
            let old_log = jsc_vm.transpiler.get().log;
            let old_log_nn = core::ptr::NonNull::new(old_log).expect("transpiler.log is non-null");
            let args_log_nn = core::ptr::NonNull::new(args.log).expect("args.log is non-null");
            let transpiler = jsc_vm.transpiler.as_ptr();
            // SAFETY: field writes on the JS thread;
            // `args.log` is non-null (checked above) and outlives this call.
            unsafe {
                (*transpiler).log = args.log;
                (*transpiler).resolver.log = args_log_nn;
                (*transpiler).linker.log = args.log;
                if let Some(pm) = (*transpiler).resolver.package_manager {
                    (*pm.cast::<bun_install::PackageManager>().as_ptr()).log = args.log;
                }
            }
            let _log_guard = scopeguard::guard(transpiler, move |transpiler| {
                // SAFETY: as above; restores the log pointers swapped there.
                unsafe {
                    (*transpiler).log = old_log;
                    (*transpiler).resolver.log = old_log_nn;
                    (*transpiler).linker.log = old_log;
                    if let Some(pm) = (*transpiler).resolver.package_manager {
                        (*pm.cast::<bun_install::PackageManager>().as_ptr()).log = old_log;
                    }
                }
            });

            let is_node_override = !DATA_ONLY && specifier.starts_with(node_fallbacks::IMPORT_PATH);

            let macro_mode = jsc_vm.macro_mode.get();
            let has_any_macro_remappings = !DATA_ONLY && jsc_vm.has_any_macro_remappings.get();
            let macro_remappings = if macro_mode || !has_any_macro_remappings || is_node_override {
                bun_resolver::package_json::MacroMap::default()
            } else {
                // Note: `MacroMap`'s value type
                // (`StringArrayHashMap<Box<[u8]>>`) has only the fallible
                // `clone() -> Result<_, AllocError>` (no trait `Clone`), so
                // the outer map can't be `clone()`d generically. Re-key
                // shallowly here matching `bun_bundler::transpiler` and treat
                // the inner OOM as a process-fatal alloc failure.
                let src = &jsc_vm.transpiler.get().options.macro_remap;
                if src.is_empty() {
                    // Hot path: a module with no `--define`/`with { type: "macro" }`
                    // remappings skips the per-entry re-key + per-value fallible
                    // `clone()` entirely.
                    bun_resolver::package_json::MacroMap::default()
                } else {
                    let mut m = bun_resolver::package_json::MacroMap::default();
                    for (k, v) in src.iter() {
                        m.insert(k, bun_core::handle_oom(v.clone()));
                    }
                    m
                }
            };

            // Only JS-like loaders get the cjs/esm wrapper hint.
            let module_type_only_for_wrappables = match loader {
                L::Js | L::Jsx | L::Ts | L::Tsx => module_type,
                _ => ModuleType::Unknown,
            };

            let mut input_file = None;

            // ── Node-fallback virtual source ────────────────────────────────
            let fallback_source: bun_ast::Source;
            let mut virtual_source = args.virtual_source;
            if is_node_override {
                if let Some(code) = node_fallbacks::contents_from_path(specifier) {
                    {
                        let fallback_path =
                            bun_paths::fs::Path::init_with_namespace(specifier, b"node");
                        fallback_source = bun_ast::Source {
                            path: fallback_path,
                            contents: std::borrow::Cow::Borrowed(code),
                            ..Default::default()
                        };
                        virtual_source = Some(&fallback_source);
                    }
                }
            }

            // ════════════════════════════════════════════════════════════════
            // Transpiler::parse — the read-file step happens inside
            // `parse_maybe_return_file_only` (it opens `path` itself when
            // `virtual_source` is `None`).
            // ════════════════════════════════════════════════════════════════
            {
                use bun_bundler::transpiler::{AlreadyBundled, ParseOptions, ParseResult};
                use bun_jsc::resolved_source::Tag as ResolvedSourceTag;

                // Keep the one-shot
                // `set_break_point_on_first_line()` last so it is only
                // consumed when the other conditions hold.
                let set_breakpoint_on_first_line = is_main
                    && jsc_vm
                        .debugger
                        .get()
                        .is_some_and(|d| d.set_breakpoint_on_first_line)
                    && bun_jsc::runtime_transpiler_store::set_break_point_on_first_line();

                let options = &jsc_vm.transpiler.get().options;
                let mut parse_options = ParseOptions {
                    // SAFETY: `arena_ptr` points at the `Box<Arena>` interior
                    // held by `arena_guard`; the guard outlives `parse_result`.
                    arena: unsafe { &*arena_ptr },
                    path: *path,
                    loader,
                    dirname_fd: bun_sys::Fd::INVALID,
                    file_descriptor: None,
                    opened_file: Some(&mut input_file),
                    macro_remappings,
                    jsx: options.jsx.clone(),
                    emit_decorator_metadata: options.emit_decorator_metadata,
                    experimental_decorators: options.experimental_decorators,
                    use_define_for_class_fields: options.use_define_for_class_fields,
                    virtual_source,
                    dont_bundle_twice: true,
                    allow_commonjs: true,
                    module_type: module_type_only_for_wrappables,
                    inject_jest_globals: options.rewrite_jest_for_tests,
                    is_test_entry_point: (is_main || is_preload) && options.rewrite_jest_for_tests,
                    keep_json_and_toml_as_one_statement: true,
                    allow_bytecode_cache: true,
                    set_breakpoint_on_first_line,
                    runtime_transpiler_cache: if !DATA_ONLY
                        && !disable_transpilying
                        && !RuntimeTranspilerCache::is_disabled_by_env()
                    {
                        Some(&mut cache)
                    } else {
                        None
                    },
                    // Strip the CJS wrapper for the eval/stdin
                    // entry point.
                    remove_cjs_module_wrapper: is_main
                        && jsc_vm.module_loader.eval_source.get().is_some(),
                    macro_js_ctx: bun_bundler::transpiler::default_macro_js_value(),
                    macro_load_states: &jsc_vm.module_loader.macro_load_states,
                    replace_exports: Default::default(),
                };
                let own = (jsc_vm.transpiler)
                    .with_mut(|t| t.find_aot_package_config(parse_options.path.text, loader));
                if let Some(own) = own {
                    parse_options.apply_aot_package_config(&own);
                }

                // Both the file-only and transpiled arms hit the same
                // `parse_maybe_return_file_only_allow_shared_buffer` body, so
                // dispatch at runtime via the const-generic bool.
                let return_file_only = disable_transpilying || loader == L::Json;
                let parse_result: Option<ParseResult> = if DATA_ONLY {
                    // SAFETY: JS thread; a data file runs no script.
                    let transpiler = unsafe { &mut *transpiler };
                    if return_file_only {
                        transpiler.parse_data_file::<true>(parse_options)
                    } else {
                        transpiler.parse_data_file::<false>(parse_options)
                    }
                } else if return_file_only {
                    // SAFETY: JS thread; reading the file runs no script.
                    unsafe {
                        (*transpiler).parse_maybe_return_file_only::<true>(parse_options, None)
                    }
                } else {
                    // SAFETY: JS thread. Does not hold for a macro: loading it comes back here
                    // while this parse still borrows the transpiler.
                    unsafe {
                        (*transpiler).parse_maybe_return_file_only::<false>(parse_options, None)
                    }
                };

                let Some(mut parse_result) = parse_result else {
                    // Register with watcher even on parse failure.
                    if !disable_transpilying {
                        maybe_watch_file(jsc_vm, &mut input_file, is_node_override, path, hash);
                    }
                    arena_guard.2 = false; // give_back_arena = false
                    // Node compile cache: record the failed module so exit-time
                    // persist logs the "was not initialized" skip (Node parity).
                    if !DATA_ONLY {
                        note_compile_cache_parse_failure(path, loader, module_type);
                    }
                    return Err(crate::Error::ParseError);
                };

                // `.wasm` discovered post-parse: recurse with
                // the parsed source as virtual.
                if parse_result.loader == L::Wasm {
                    let wasm_extra = TranspileExtra {
                        path: *path,
                        loader: Cell::new(L::Wasm),
                        module_type: Cell::new(ModuleType::Unknown),
                    };
                    // Re-enter with `&parse_result.source` as `virtual_source`.
                    return transpile_source_code_inner::<DATA_ONLY>(
                        jsc_vm,
                        &TranspileArgs {
                            specifier: args.specifier,
                            referrer: args.referrer,
                            input_specifier: args.input_specifier,
                            log: args.log,
                            virtual_source: Some(&parse_result.source),
                            global_object: args.global_object,
                            flags: args.flags,
                            extra: &wasm_extra,
                        },
                    );
                }

                // Register with watcher on success too.
                if !disable_transpilying {
                    maybe_watch_file(jsc_vm, &mut input_file, is_node_override, path, hash);
                }

                // SAFETY: `transpiler.log` was swapped to non-null `args.log` above.
                if unsafe { (*(*transpiler).log).errors > 0 } {
                    arena_guard.2 = false;
                    // Node compile cache: record the failed module so exit-time
                    // persist logs the "was not initialized" skip (Node parity).
                    if !DATA_ONLY {
                        note_compile_cache_parse_failure(path, loader, module_type);
                    }
                    return Err(crate::Error::ParseError);
                }

                // Set before the early returns below (cache hit, `// @bun`):
                // every later module load is gated on this flag.
                if is_main && !disable_transpilying {
                    jsc_vm.has_loaded.set(true);
                }
                let is_bun_test = jsc_vm.transpiler.get().options.rewrite_jest_for_tests;
                if (is_main || is_preload) && !disable_transpilying && is_bun_test {
                    let imports_vitest = cache.imports_vitest()
                        || parse_result
                            .ast
                            .import_records
                            .as_slice()
                            .iter()
                            .any(|record| record.path.text == b"vitest");
                    // SAFETY: a field write on the JS thread.
                    unsafe { (*transpiler).options.test_file_imports_vitest = imports_vitest };
                }

                let source = &parse_result.source;

                // Raw JSON: hand the source bytes straight to JSC.
                if loader == L::Json {
                    return Ok(ResolvedSource {
                        source_code: bun_core::String::clone_utf8(&source.contents),
                        source_url: input_specifier.create_if_different(path.text),
                        tag: ResolvedSourceTag::JsonForObjectLoader,
                        ..Default::default()
                    });
                }

                // disable_transpiling: return raw source.
                if disable_transpilying {
                    let source_code = match args.flags {
                        FetchFlags::PrintSource => {
                            // The file contents live in a Drop-carrying
                            // `source_contents_backing` on `parse_result`, so a
                            // borrow would dangle once `parse_result` drops on
                            // return. Clone instead.
                            bun_core::String::clone_utf8(&source.contents)
                        }
                        FetchFlags::Transpile => unreachable!(),
                    };
                    return Ok(ResolvedSource {
                        source_code,
                        source_url: input_specifier.create_if_different(path.text),
                        ..Default::default()
                    });
                }

                if matches!(loader, L::Text)
                    && (DATA_ONLY || bun_jsc::compiled_program::compiled_program().is_some())
                {
                    let Ok(jsvalue_for_export) =
                        bun_core::String::clone_utf8(&parse_result.source.contents)
                            .into_js(global_object)
                    else {
                        return Err(bun_jsc::JsError::Thrown.into());
                    };
                    return Ok(ResolvedSource {
                        source_url: input_specifier.create_if_different(path.text),
                        jsvalue_for_export,
                        tag: ResolvedSourceTag::ExportDefaultOnly,
                        ..Default::default()
                    });
                }

                // JSON/TOML/YAML/JSON5/XML: export as a JS object.
                if matches!(
                    loader,
                    L::Json | L::Jsonc | L::Toml | L::Yaml | L::Json5 | L::Xml
                ) {
                    let jsvalue_for_export = if parse_result.empty {
                        JSValue::create_empty_object(global_object, 0)
                    } else {
                        // `ast.parts.at(0).stmts[0].data.s_expr.value.toJS(...)`
                        // — `Expr` lives in `bun_js_parser` (no JSC dep), so
                        // the JS materialization is the `bun_js_parser_jsc`
                        // extension fn.
                        let part = &parse_result.ast.parts[0];
                        // SAFETY: `Part.stmts` is an arena-owned slice; the
                        // arena outlives this call (returned to the VM by the
                        // scopeguard above only after we return).
                        let stmt = &(*part.stmts)[0];
                        let bun_ast::StmtData::SExpr(s_expr) = &stmt.data else {
                            // Parser guarantees JSON/TOML/YAML produce a single
                            // `SExpr` part; anything else is a parser bug.
                            unreachable!("JSON/TOML/YAML parse result is always SExpr")
                        };
                        match bun_js_parser_jsc::expr_to_js(&s_expr.value, global_object) {
                            Ok(v) => v,
                            Err(e) => {
                                return Err(match e {
                                    bun_ast::ToJSError::JSError => bun_jsc::JsError::Thrown,
                                    bun_ast::ToJSError::OutOfMemory => {
                                        global_object.throw_out_of_memory()
                                    }
                                    e => global_object.throw_error(
                                        bun_jsc::CrateError::from(e),
                                        "converting module to JavaScript",
                                    ),
                                }
                                .into());
                            }
                        }
                    };
                    return Ok(ResolvedSource {
                        source_url: input_specifier.create_if_different(path.text),
                        jsvalue_for_export,
                        tag: ResolvedSourceTag::ExportsObject,
                        ..Default::default()
                    });
                }

                if DATA_ONLY {
                    return Err(crate::Error::ModuleNotFound);
                }

                // already-bundled (bytecode cache hit).
                if !matches!(parse_result.already_bundled, AlreadyBundled::None) {
                    // The bytes live
                    // in `AlreadyBundled::Bytecode(Box<[u8]>)`, which would drop
                    // when `parse_result` drops on return — UAF on the C++ side.
                    // Move the variant out and `heap::alloc` so ownership
                    // transfers to C++ exactly as in the spec.
                    let already_bundled = core::mem::take(&mut parse_result.already_bundled);
                    let is_commonjs_module = already_bundled.is_common_js();
                    let bytecode_cache = Bytecode::owned(already_bundled.into_bytecode());
                    return Ok(ResolvedSource {
                        source_code: bun_core::String::clone_latin1(&source.contents),
                        source_url: input_specifier.create_if_different(path.text),
                        already_bundled: true,
                        bytecode_cache,
                        is_commonjs_module,
                        ..Default::default()
                    });
                }

                // Empty .cjs/.cts: synthetic `(function(){})`.
                if parse_result.empty && matches!(loader, L::Js | L::Ts) {
                    let ext = bun_paths::extension(source.path.text);
                    if ext == b".cjs" || ext == b".cts" {
                        return Ok(ResolvedSource {
                            source_code: bun_core::String::static_("(function(){})"),
                            source_url: input_specifier.create_if_different(path.text),
                            is_commonjs_module: true,
                            tag: ResolvedSourceTag::Javascript,
                            ..Default::default()
                        });
                    }
                }

                // RuntimeTranspilerCache hit: skip print.
                if let Some(mut entry) = cache.entry.take() {
                    use bun_jsc::runtime_transpiler_cache::ModuleType as CacheModuleType;
                    // Register the cached sourcemap so error
                    // stacks remap to original positions even on a cache hit.
                    let _ = jsc_vm.source_mappings.put_mappings(
                        source,
                        bun_core::MutableString {
                            list: core::mem::take(&mut entry.sourcemap).into_vec(),
                        },
                    );
                    // Rebuild the cached ESM record for the
                    // isolation source-provider cache (same shape as
                    // `RuntimeTranspilerStore`).
                    let module_info = if jsc_vm.use_isolation_source_provider_cache()
                        && entry.metadata.module_type != CacheModuleType::Cjs
                        && !entry.esm_record.is_empty()
                    {
                        bun_bundler::analyze_transpiled_module::ModuleInfoDeserialized::create_from_cached_record(
                            &entry.esm_record,
                        )
                    } else {
                        None
                    };
                    let is_commonjs_module = entry.metadata.module_type == CacheModuleType::Cjs;
                    // Node compile cache hook (transpiler-cache-hit path); must
                    // read `output_code` before it is consumed below. UTF-16
                    // output would hash differently than the print path — skip.
                    let node_compile_cache_blob = if bun_jsc::node_compile_cache::is_enabled()
                        && source.path.is_file()
                        && loader.is_java_script_like()
                        && !entry.output_code.is_utf16()
                    {
                        bun_jsc::node_compile_cache::fetch(
                            source.path.text,
                            is_commonjs_module,
                            entry.output_code.byte_slice(),
                        )
                    } else {
                        None
                    };
                    let source_code = core::mem::take(&mut entry.output_code);
                    // When the cached entry was detected as
                    // CJS but lives inside a `"type":"module"` package, emit
                    // `package_json_type_module` so the C++ loader applies the
                    // correct evaluation context on cache hits.
                    let tag = if is_commonjs_module && source.path.is_file() {
                        // SAFETY: JS thread;
                        // `read_dir_info` is re-entrant on the JS
                        // thread and returns a stable cache slot.
                        let pkg = match unsafe {
                            (*transpiler).resolver.read_dir_info(source.path.name().dir)
                        } {
                            Ok(Some(dir_info)) => {
                                dir_info.package_json().or(dir_info.enclosing_package_json)
                            }
                            _ => None,
                        };
                        if pkg
                            .map(|p| p.module_type == ModuleType::Esm)
                            .unwrap_or(false)
                        {
                            ResolvedSourceTag::PackageJsonTypeModule
                        } else {
                            ResolvedSourceTag::Javascript
                        }
                    } else {
                        ResolvedSourceTag::Javascript
                    };
                    return Ok(ResolvedSource {
                        source_code,
                        source_url: input_specifier.create_if_different(path.text),
                        is_commonjs_module,
                        module_info,
                        tag,
                        bytecode_cache: node_compile_cache_blob.unwrap_or_default(),
                        ..Default::default()
                    });
                }

                // Link import records.
                // SAFETY: `options` is only read and `linker` is JS-thread-exclusive.
                unsafe {
                    (*transpiler).linker.link::<false, true>(
                        &(*transpiler).options,
                        path,
                        &mut parse_result,
                        &jsc_vm.origin,
                        options::ImportPathFormat::AbsolutePath,
                    )?;
                }

                let printed_ast = bun_jsc::resolved_source::PrintedAst::new(&parse_result.ast);
                let is_commonjs_module = printed_ast.is_commonjs_module;
                // Collect the ESM record while printing, for the isolation
                // source-provider cache (same shape as `RuntimeTranspilerStore`).
                let mut module_info: Option<
                    Box<bun_bundler::analyze_transpiled_module::ModuleInfo>,
                > = if jsc_vm.use_isolation_source_provider_cache()
                    && !is_commonjs_module
                    && loader.is_java_script_like()
                {
                    Some(bun_bundler::analyze_transpiled_module::ModuleInfo::create(
                        loader.is_type_script(),
                    ))
                } else {
                    None
                };
                // Propagate top-level-await to the
                // cached module record (see the matching note in
                // RuntimeTranspilerStore.rs for why this matters under
                // --isolate / --parallel).
                if let Some(mi) = module_info.as_deref_mut() {
                    mi.flags.has_tla = !parse_result.ast.top_level_await_keyword.is_empty();
                }

                // ── js_printer::print ───────────────────────────────────────
                let printer_slot = &jsc_vm.module_loader.source_code_printer;
                let mut printer =
                    scopeguard::guard(printer_slot.take().unwrap_or_default(), |printer| {
                        printer_slot.set(Some(printer))
                    });
                printer.ctx.reset();
                {
                    let mapper = jsc_vm.source_map_handler(&cache);
                    let print_result = jsc_vm.transpiler.get().print_with_source_map(
                        // The arena of the AST, not that of the VM's transpiler.
                        &arena_guard.1,
                        parse_result,
                        &mut printer,
                        bun_js_printer::Format::EsmAscii,
                        &mapper,
                        module_info.as_deref_mut(),
                    );
                    // The printer never took ownership of `module_info`;
                    // drop it here mirroring the async-path error arm.
                    if print_result.is_err() {
                        drop(module_info.take());
                    }
                    print_result?;
                }

                // `module_info.asDeserialized()`: finalize the printer-filled
                // record into the FFI shape `Zig::SourceProvider` takes.
                let module_info = module_info.map(|mi| {
                    use bun_bundler::analyze_transpiled_module::ModuleInfoExt;
                    mi.into_deserialized()
                });

                // Watcher path uses ref-counted source.
                if jsc_vm.is_watcher_enabled() {
                    let written = printer.ctx.get_written();
                    let node_compile_cache_blob = if bun_jsc::node_compile_cache::is_enabled()
                        && path.is_file()
                        && loader.is_java_script_like()
                    {
                        bun_jsc::node_compile_cache::fetch(path.text, is_commonjs_module, written)
                    } else {
                        None
                    };
                    let mut resolved_source = jsc_vm
                        .ref_counted_resolved_source(
                            printed_ast,
                            written,
                            input_specifier,
                            path.text,
                        )
                        .map_err(|_| global_object.throw_string_too_long())?;
                    resolved_source.module_info = module_info;
                    resolved_source.bytecode_cache = node_compile_cache_blob.unwrap_or_default();
                    return Ok(resolved_source);
                }

                // Final ResolvedSource.
                let tag = match loader {
                    L::Json | L::Jsonc => ResolvedSourceTag::JsonForObjectLoader,
                    L::Js | L::Jsx | L::Ts | L::Tsx => {
                        // A `.cjs` under `"type":"module"` still tags as `PackageJsonTypeModule`.
                        let dir = path.name().dir;
                        let module_type_ = if path.is_file() && bun_paths::is_absolute(dir) {
                            // SAFETY: JS thread; `read_dir_info` is
                            // re-entrant on the JS thread and returns a
                            // stable cache slot.
                            match unsafe { (*transpiler).resolver.read_dir_info(dir) } {
                                Ok(Some(dir_info)) => dir_info
                                    .package_json()
                                    .or(dir_info.enclosing_package_json)
                                    .map_or(module_type, |p| p.module_type),
                                _ => module_type,
                            }
                        } else {
                            module_type
                        };
                        match module_type_ {
                            ModuleType::Esm => ResolvedSourceTag::PackageJsonTypeModule,
                            ModuleType::Cjs => ResolvedSourceTag::PackageJsonTypeCommonjs,
                            _ => ResolvedSourceTag::Javascript,
                        }
                    }
                    _ => ResolvedSourceTag::Javascript,
                };

                let written = printer.ctx.get_written();
                // Node compile cache hook (sync transpile path). `fetch` copies
                // `written`; the printer may be replaced below.
                let node_compile_cache_blob = if bun_jsc::node_compile_cache::is_enabled()
                    && path.is_file()
                    && loader.is_java_script_like()
                {
                    bun_jsc::node_compile_cache::fetch(path.text, is_commonjs_module, written)
                } else {
                    None
                };
                let written_len = written.len();
                let source_code = bun_core::String::clone_latin1(written);
                // `printer.ctx.buffer.deinit()`: release the
                // large/--smol print buffer now instead of holding it until the
                // next transpile. Replacing the printer drops the old buffer
                // (same shape as RuntimeTranspilerStore).
                if written_len > 1024 * 1024 * 2 || jsc_vm.smol {
                    **printer =
                        bun_js_printer::BufferPrinter::init(bun_js_printer::BufferWriter::init());
                }

                return Ok(ResolvedSource {
                    source_url: input_specifier.create_if_different(path.text),
                    module_info,
                    tag,
                    bytecode_cache: node_compile_cache_blob.unwrap_or_default(),
                    ..ResolvedSource::printed(printed_ast, source_code)
                });
            }
        }

        // The `.node` fast-paths in `moduleLoaderFetch` / `overridableRequire`
        // only match module keys that literally end in `.node`, so `?query`
        // suffixes and `--loader <ext>:napi` mappings still reach here.
        L::Napi => Err(global_object
            .throw_type_error(format_args!(
                "To load Node-API modules, use require() or process.dlopen instead of import."
            ))
            .into()),

        // ────────────────────────────────────────────────────────────────────
        // .wasm
        // ────────────────────────────────────────────────────────────────────
        L::Wasm => {
            let main = jsc_vm.main();
            if referrer == b"undefined" && main == Some(path.text) {
                // Stash the WASM bytes on
                // `globalThis.wasmSourceBytes` so the wasi runner avoids
                // reading the file twice.
                if let Some(source) = args.virtual_source {
                    // Spec — `DecodedJSValue{ .ptr = globalThis }.encode()`:
                    // a JSGlobalObject is a JSCell, so its pointer encodes
                    // directly as a JSValue.
                    let global_value = bun_jsc::DecodedJSValue {
                        u: bun_jsc::decoded_js_value::EncodedValueDescriptor {
                            ptr: core::ptr::from_ref(global_object).cast_mut().cast(),
                        },
                    }
                    .encode();
                    global_value.put(
                        global_object,
                        b"wasmSourceBytes",
                        bun_jsc::ArrayBuffer::create_uint8_array(global_object, &source.contents)?,
                    );
                }

                {
                    use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                    return Ok(ResolvedSource {
                        source_code: bun_core::String::static_(include_bytes!(
                            "../js/wasi-runner.js"
                        )),
                        source_url: input_specifier.create_if_different(path.text),
                        tag: ResolvedSourceTag::Esm,
                        is_static: true,
                        ..Default::default()
                    });
                }
            }
            // Recurse as `.file`.
            extra.loader.set(L::File);
            extra.module_type.set(ModuleType::Unknown);
            transpile_source_code_inner::<DATA_ONLY>(jsc_vm, args)
        }

        // ────────────────────────────────────────────────────────────────────
        // .sqlite / .sqlite_embedded
        // ────────────────────────────────────────────────────────────────────
        L::Sqlite | L::SqliteEmbedded => {
            let hot = jsc_vm.hot_reload.get() == bun_options_types::context::HotReload::Hot;
            let sqlite_module_source_code_string: &'static [u8] = if hot {
                SQLITE_MODULE_SOURCE_HOT
            } else {
                SQLITE_MODULE_SOURCE
            };
            use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
            Ok(ResolvedSource {
                source_code: bun_core::String::clone_utf8(sqlite_module_source_code_string),
                source_url: input_specifier.create_if_different(path.text),
                tag: ResolvedSourceTag::Esm,
                is_static: true,
                ..Default::default()
            })
        }

        // ────────────────────────────────────────────────────────────────────
        // .html
        // ────────────────────────────────────────────────────────────────────
        L::Html => {
            if disable_transpilying {
                use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                return Ok(ResolvedSource {
                    source_url: input_specifier.create_if_different(path.text),
                    tag: ResolvedSourceTag::Esm,
                    ..Default::default()
                });
            }
            let html_bundle = bun_removable_features::call_removable_or!(
                Bundler,
                Throw,
                {
                    return Err(crate::removed_feature::throw_for_removed_feature(
                        global_object,
                        bun_removable_features::Feature::Bundler,
                    )
                    .into());
                },
                create_html_bundle,
                global_object,
                path.text
            );
            use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
            Ok(ResolvedSource {
                jsvalue_for_export: html_bundle,
                source_url: input_specifier.create_if_different(path.text),
                tag: ResolvedSourceTag::ExportDefaultObject,
                ..Default::default()
            })
        }

        // ────────────────────────────────────────────────────────────────────
        // Everything else — file loader: `export default <path>`.
        // ────────────────────────────────────────────────────────────────────
        _ => {
            if disable_transpilying {
                use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                return Ok(ResolvedSource {
                    source_url: input_specifier.create_if_different(path.text),
                    tag: ResolvedSourceTag::Esm,
                    ..Default::default()
                });
            }

            if args.virtual_source.is_none() {
                auto_watch_file(jsc_vm, path.text);
            }

            // `export default <path string>`.
            use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
            if matches!(loader, L::Css) {
                if bun_css::css_modules::is_module_path(path.text) {
                    let exports = bun_removable_features::call_removable_or!(
                        Bundler,
                        Throw,
                        {
                            return Err(crate::removed_feature::throw_for_removed_feature(
                                global_object,
                                bun_removable_features::Feature::Bundler,
                            )
                            .into());
                        },
                        css_module_exports,
                        jsc_vm,
                        global_object,
                        path.text,
                        args.virtual_source,
                        // SAFETY: `args.log` is the caller's live `Log`; nothing else borrows it in this arm.
                        unsafe { &mut *args.log }
                    )?;
                    return Ok(ResolvedSource {
                        jsvalue_for_export: exports,
                        source_url: input_specifier.create_if_different(path.text),
                        tag: ResolvedSourceTag::ExportsObject,
                        ..Default::default()
                    });
                }
                // The bundler emits `{}` as the JS stub for a plain CSS import
                // (esbuild parity); match that here instead of leaking the file path
                // as the default export.
                return Ok(ResolvedSource {
                    jsvalue_for_export: JSValue::create_empty_object(global_object, 0),
                    source_url: input_specifier.create_if_different(path.text),
                    tag: ResolvedSourceTag::ExportDefaultObject,
                    ..Default::default()
                });
            }
            let value = if !jsc_vm.origin.is_empty() {
                // Rewrite `specifier` against `vm.origin` so
                // importing an asset via the file loader yields the public URL,
                // not the absolute filesystem path.
                let mut public_path: Vec<u8> = Vec::new();
                let origin = &jsc_vm.origin;
                let top_level_dir = Fs::FileSystem::get().top_level_dir();
                crate::api::bun_object::get_public_path_with_asset_prefix(
                    specifier,
                    top_level_dir,
                    origin,
                    b"",
                    &mut public_path,
                    bun_paths::Platform::Loose,
                );
                bun_string_jsc::create_utf8_for_js(global_object, &public_path)
                    .map_err(|_| crate::Error::JSError)?
            } else {
                bun_string_jsc::create_utf8_for_js(global_object, path.text)
                    .map_err(|_| crate::Error::JSError)?
            };
            Ok(ResolvedSource {
                jsvalue_for_export: value,
                source_url: input_specifier.create_if_different(path.text),
                tag: ResolvedSourceTag::ExportDefaultObject,
                ..Default::default()
            })
        }
    }
}

/// Register the just-opened file
/// with the dev-server watcher (if enabled, absolute, and not in
/// `node_modules`). Factored out of the two call sites.
#[inline]
fn maybe_watch_file(
    jsc_vm: &VirtualMachine,
    input_file: &mut Option<bun_sys::File>,
    is_node_override: bool,
    path: &Fs::Path,
    hash: u32,
) {
    let Some(watcher) = jsc_vm.bun_watcher.get() else {
        return;
    };
    if input_file.is_none() {
        return;
    }
    if is_node_override
        || !bun_paths::is_absolute(path.text)
        || bun_core::strings::contains(path.text, b"node_modules")
    {
        return;
    }
    let _ = watcher.add_file(input_file.take(), path.text, hash);
}

/// Like `maybe_watch_file`, for a file the transpiler didn't open itself.
fn auto_watch_file(jsc_vm: &VirtualMachine, path_text: &[u8]) {
    let Some(watcher) = jsc_vm.bun_watcher.get() else {
        return;
    };
    if !bun_paths::is_absolute(path_text) || bun_core::strings::contains(path_text, b"node_modules")
    {
        return;
    }
    // kqueue watchers need a file descriptor to receive event notifications on it; inotify/win32 watch by path.
    let file = if bun_watcher::REQUIRES_FILE_DESCRIPTORS {
        let mut buf = bun_paths::path_buffer_pool::get();
        if path_text.len() >= buf.len() {
            return;
        }
        let z = bun_paths::resolve_path::z(path_text, &mut buf);
        match bun_sys::File::open(z, bun_watcher::WATCH_OPEN_FLAGS, 0) {
            Ok(file) => Some(file),
            Err(_) => return,
        }
    } else {
        None
    };
    let hash = bun_watcher::Watcher::get_hash(path_text);
    let _ = watcher.add_file(file, path_text, hash);
}

struct CssModuleHost<'a>(&'a VirtualMachine);

impl bun_bundler::css_module_graph::Host for CssModuleHost<'_> {
    fn transpiler(&mut self) -> &mut bun_bundler::Transpiler<'static> {
        // SAFETY: loading a CSS module runs no script, and `&mut self` bounds the borrow.
        unsafe { self.0.transpiler.get_mut() }
    }

    fn watch(&mut self, path: &[u8]) {
        auto_watch_file(self.0, path);
    }

    fn intern(&mut self, path: &[u8]) -> Option<&'static [u8]> {
        Some(intern_transpile_path(path))
    }
}

/// Builds the same object `Bun.build` emits as the CSS module's default export.
#[cold]
#[inline(never)]
#[optimize(size)]
fn css_module_exports(
    jsc_vm: &VirtualMachine,
    global: &JSGlobalObject,
    path_text: &[u8],
    virtual_source: Option<&bun_ast::Source<'_>>,
    log: &mut bun_ast::Log,
) -> crate::Result<JSValue> {
    use bun_bundler::css_module_graph::{Failure, load_exports, read};

    let contents = match virtual_source {
        Some(source) => std::borrow::Cow::Borrowed(&*source.contents),
        None => read(path_text, log).ok_or(crate::Error::ParseError)?.into(),
    };
    let exports = match load_exports(&mut CssModuleHost(jsc_vm), path_text, &contents) {
        Ok(exports) => exports,
        Err(Failure::StackOverflow) => return Err(global.throw_stack_overflow().into()),
        Err(Failure::Path(error)) => return Err(error.into()),
    };

    let object = JSValue::create_empty_object(global, exports.len());
    for (name, value) in &exports {
        object.put_may_be_index(
            global,
            &bun_core::String::clone_utf8(name),
            bun_string_jsc::create_utf8_for_js(global, value)?,
        )?;
    }
    Ok(object)
}

// Generated `bun:sqlite` import shims.
const SQLITE_MODULE_SOURCE_HOT: &[u8] = b"\
// Generated code
import {Database} from 'bun:sqlite';
const {path} = import.meta;

// Don't reload the database if it's already loaded
const registry = (globalThis[Symbol.for(\"bun:sqlite:hot\")] ??= new Map());

export let db = registry.get(path);
export const __esModule = true;
if (!db) {
   // Load the database
   db = new Database(path);
   registry.set(path, db);
}

export default db;
";

const SQLITE_MODULE_SOURCE: &[u8] = b"\
// Generated code
import {Database} from 'bun:sqlite';
export const db = new Database(import.meta.path);

export const __esModule = true;
export default db;
";

/// `jsSyntheticModule(tag, specifier)` — produce a
/// `ResolvedSource` whose `tag` indexes into the C++ `InternalModuleRegistry`
/// (the embedded JS modules from `src/js/`). No source text — C++ dispatches
/// on `.tag` alone.
///
/// Note: `name` is the canonical specifier string (e.g. `b"node:fs"`),
/// resolved to the numeric tag via
/// `Tag::from_name` (PHF over the codegen table in `bun_jsc::resolved_source_tag`).
#[inline]
fn js_synthetic_module(name: &'static [u8]) -> ResolvedSource {
    use bun_jsc::resolved_source::Tag;
    ResolvedSource {
        source_url: bun_core::String::static_(name),
        tag: Tag::from_name(name),
        ..ResolvedSource::default()
    }
}

/// `getHardcodedModule(jsc_vm, specifier, hardcoded)` —
/// the per-variant body of the builtin-module fast path. Returns `None` when
/// the variant is recognised but not currently servable (e.g. `bun:main`
/// before `ServerEntryPoint::generate` has run, or `bun:internal-for-testing`
/// without the opt-in flag).
fn get_hardcoded_module(
    specifier: &bun_core::String,
    hardcoded: HardcodedModule,
) -> Option<ResolvedSource> {
    // The analytics-side set stores `&'static str` names
    // (cycle break — see `bun_analytics::features::BUILTIN_MODULES`), so feed
    // it the `strum::IntoStaticStr` tag name.
    bun_analytics::features::insert_builtin_module(<&'static str>::from(hardcoded));

    match hardcoded {
        HardcodedModule::BunMain => {
            let vm = VirtualMachine::get();
            let ep = vm.entry_point.get();
            // A compiled entry point runs without the wrapper: the text is empty.
            let is_compiled = vm.main_entry_point.get() == MainEntryPoint::Compiled;
            if !ep.generated && !is_compiled {
                return None;
            }
            use bun_jsc::resolved_source::Tag;
            Some(ResolvedSource {
                source_code: bun_core::String::clone_utf8(&ep.contents),
                source_url: specifier.clone(),
                tag: Tag::Esm,
                is_static: true,
                ..ResolvedSource::default()
            })
        }
        HardcodedModule::NodeStreamIter => {
            // Gated behind `--experimental-stream-iter` (node parity: the
            // module resolves only when the flag was passed on the CLI;
            // without it `node:stream/iter` reports "No such built-in
            // module" and bare `stream/iter` falls through to filesystem
            // resolution).
            if !bun_resolve_builtins::stream_iter_enabled() {
                return None;
            }
            Some(js_synthetic_module(b"node:stream/iter"))
        }
        HardcodedModule::NodeZlibIter => {
            // Same `--experimental-stream-iter` gate as `node:stream/iter`.
            if !bun_resolve_builtins::stream_iter_enabled() {
                return None;
            }
            Some(js_synthetic_module(b"node:zlib/iter"))
        }
        HardcodedModule::BunInternalForTesting
        | HardcodedModule::InternalClusterRoundRobinHandle
        | HardcodedModule::NodeInternalRepl
        | HardcodedModule::NodeInternalReplAwait
        | HardcodedModule::NodeInternalReplHistory
        | HardcodedModule::NodeInternalUtilInspect => {
            // Gated behind `--expose-internals` (release) / always-on (debug).
            if !bun_jsc::module_loader::is_allowed_to_use_internal_testing_apis() {
                return None;
            }
            // A compiled program gets the module for Bun's own tests where its build compiled it in. Text beside one has no build.
            if (!matches!(hardcoded, HardcodedModule::BunInternalForTesting)
                || bun_core::runs_no_compiled_program())
                && bun_resolve_builtins::are_internals_sealed()
            {
                return None;
            }
            let name: &'static str = hardcoded.into();
            Some(js_synthetic_module(name.as_bytes()))
        }
        HardcodedModule::InternalTestBinding => {
            // Gated behind `--expose-internals` (release) / always-on (debug),
            // same as `bun:internal-for-testing`. The tag key uses the
            // generated `internal:`-prefixed canonical specifier (see
            // `generated_resolved_source_tag.rs`).
            if !bun_jsc::module_loader::is_allowed_to_use_internal_testing_apis()
                || (bun_core::runs_no_compiled_program()
                    && bun_resolve_builtins::are_internals_sealed())
            {
                return None;
            }
            Some(js_synthetic_module(b"internal:test/binding"))
        }
        HardcodedModule::BunBake => {
            // Only where `bun bake` is: canary and debug builds, or the Bake feature flag.
            if !bun_core::FeatureFlags::bake() {
                return None;
            }
            Some(js_synthetic_module(b"bun:bake"))
        }
        HardcodedModule::BunWrap => {
            // `Runtime.Runtime.sourceCode()` — the bundler's CJS-interop
            // shim, embedded as a static string in `bun_ast::runtime`.
            return Some(ResolvedSource {
                source_code: bun_core::String::from_static_bytes(
                    bun_ast::runtime::Runtime::source_code(),
                ),
                source_url: specifier.clone(),
                is_static: true,
                ..ResolvedSource::default()
            });
        }
        // Every other `HardcodedModule` is served straight out of the
        // InternalModuleRegistry by tag, with no Rust-side source text.
        other => {
            let name: &'static str = other.into();
            Some(js_synthetic_module(name.as_bytes()))
        }
    }
}

/// `ModuleLoader.fetchBuiltinModule(jsc_vm, specifier)` — `HardcodedModule`
/// lookup + macro-namespace + standalone-module-graph probe.
#[unsafe(no_mangle)]
fn __bun_fetch_builtin_module(
    jsc_vm: &VirtualMachine,
    global: &JSGlobalObject,
    specifier: &bun_core::String,
) -> Option<ResolvedSource> {
    let spec_utf8 = specifier.to_utf8();
    let spec = spec_utf8.slice();

    // ── HardcodedModule fast path ───────────────────────────────────────
    if let Some(&hardcoded) = HardcodedModule::MAP.get(spec) {
        // `None` ⇒ recognised builtin but not servable right now → fall
        // through to filesystem resolution.
        return get_hardcoded_module(specifier, hardcoded);
    }

    if let Some((name, tag)) = bun_jsc::module_loader::exposed_internal_tag(spec) {
        return Some(ResolvedSource {
            source_url: bun_core::String::clone_utf8(&name),
            tag,
            ..ResolvedSource::default()
        });
    }

    // ── `macro:` namespace ──────────────────────────────────────────────
    if spec.starts_with(b"macro:") {
        use bun_bundler::entry_points::MacroEntryPoint;
        let id = MacroEntryPoint::generate_id_from_specifier(spec);
        if let Some(entry) = jsc_vm.macro_entry_points.get().get(&id) {
            return Some(ResolvedSource {
                source_code: bun_core::String::clone_utf8(entry.code()),
                source_url: specifier.clone(),
                ..ResolvedSource::default()
            });
        }
        return None;
    }

    // ── Standalone-module-graph probe ───────────────────────────────────
    // `files.get` (no virtual-root prefix check), not `find_ref`.
    // The loader of its extension reads an asset of a compiled program: `Graph::find_at_source_path`, `Graph::find_asset_under_root`.
    // Of an entry point of a compiled program the graph holds the name and no text. The engine answers for it, and leaves it to this loader once a test has taken it out of `require.cache`: then it is read from disk.
    if let Some(file) = bun_standalone_graph::Graph::get_ref().and_then(|graph| {
        graph
            .files
            .get(spec)
            .filter(|file| !graph.is_asset_of_compiled_program(spec, file))
            .filter(|_| !bun_jsc::compiled_program::is_compiled_module(spec))
            .filter(|_| !bun_jsc::compiled_program::is_entry_point_beside_thread(spec))
    }) {
        use bun_standalone_graph::StandaloneModuleGraph::ModuleFormat;

        if matches!(file.loader, Loader::Sqlite | Loader::SqliteEmbedded) {
            // Distinct from
            // [`SQLITE_MODULE_SOURCE`]: the standalone-binary path reads
            // the embedded blob via `readFileSync(import.meta.path)`
            // (resolved through the `/$bunfs/` virtual root).
            const SQLITE_MODULE_SOURCE_STANDALONE: &[u8] = b"\
/* Generated code */
import {Database} from 'bun:sqlite';
import {readFileSync} from 'node:fs';
export const db = new Database(readFileSync(import.meta.path));

export const __esModule = true;
export default db;
";
            return Some(ResolvedSource {
                source_code: bun_core::String::static_(SQLITE_MODULE_SOURCE_STANDALONE),
                source_url: specifier.clone(),
                is_static: true,
                ..ResolvedSource::default()
            });
        }

        if file.is_text_module() {
            // The bytes are already a string body (`encode_text_module`):
            // the default export is a JSString over the section, no copy.
            // Only a `Dead` string throws; `to_wtf_string` never yields one.
            let value = file
                .to_wtf_string()
                .into_js(global)
                .expect("embedded text module string is never dead");
            return Some(ResolvedSource {
                jsvalue_for_export: value,
                tag: bun_jsc::resolved_source::Tag::ExportDefaultObject,
                ..ResolvedSource::default()
            });
        }

        // SAFETY: `file.module_info` is a live subrange of the embedded section (set in `Graph::from_bytes`).
        let module_info = unsafe { &*file.module_info };
        let module_info_strings: &'static [u8] = bun_standalone_graph::Graph::get_ref()
            .map_or(&[], |graph| graph.module_info_string_table);
        return Some(ResolvedSource {
            source_code: file.to_wtf_string(),
            source_url: specifier.clone(),
            is_static: true,
            // An embedded file is served through the builtin-module path but is a file: its origin is its own path
            // (or, with --bytecode, the path the cache was generated under, which must match exactly).
            origin_path: if file.bytecode_origin_path.is_empty() {
                specifier.clone()
            } else {
                bun_core::String::from_static_bytes(file.bytecode_origin_path)
            },
            bytecode_cache: Bytecode::persistent_at(file.bytecode, file.bytecode_entry_offset),
            source_code_hash: file.source_hash,
            module_info: if !module_info.is_empty() {
                let decoded = bun_bundler::analyze_transpiled_module::ModuleInfoSlotTable::parse(
                    module_info_strings,
                )
                .ok()
                .and_then(|table| {
                    bun_bundler::analyze_transpiled_module::ModuleInfoDeserialized
                            ::create_with_table(&table, module_info)
                });
                debug_assert!(decoded.is_some(), "embedded module_info does not decode");
                decoded
            } else {
                None
            },
            is_commonjs_module: file.module_format == ModuleFormat::Cjs,
            is_prelinked_module: file.prelinked_index != u32::MAX,
            ..ResolvedSource::default()
        });
    }

    None
}

// ────────────────────────────────────────────────────────────────────────────
// `Bun__transpileFile` helpers — local copies of `options.normalizeSpecifier` /
// `options.getLoaderAndVirtualSource`.
//
// Porting the body inline here lets us name `VirtualMachine` directly (no
// vtable) and look the loader up in `transpiler.options.loaders` (which is
// already
// `StringArrayHashMap<bun_ast::Loader>`), so no inter-enum bridge is required.
// ────────────────────────────────────────────────────────────────────────────

/// Maps the wire `Api::Loader` (`#[repr(u8)]`, `_none = 254`) discriminant that
/// crosses the C++ boundary as `force_loader: u8` to the runtime
/// `bun_ast::Loader`. Exhaustive match (any unknown tag — including 0, which
/// `api::Loader` never uses — collapses to `None`).
#[inline]
fn force_loader_from_api_u8(api_loader: u8) -> Option<Loader> {
    use Loader as L;
    match api_loader {
        1 => Some(L::Jsx),
        2 => Some(L::Js),
        3 => Some(L::Ts),
        4 => Some(L::Tsx),
        5 => Some(L::Css),
        6 => Some(L::File),
        7 => Some(L::Json),
        8 => Some(L::Jsonc),
        9 => Some(L::Toml),
        10 => Some(L::Wasm),
        11 => Some(L::Napi),
        12 => Some(L::Base64),
        13 => Some(L::Dataurl),
        14 => Some(L::Text),
        15 => Some(L::Bunsh),
        16 => Some(L::Sqlite),
        17 => Some(L::SqliteEmbedded),
        18 => Some(L::Html),
        19 => Some(L::Yaml),
        20 => Some(L::Json5),
        21 => Some(L::Md),
        22 => Some(L::Xml),
        // 254 = `_none`; everything else is open-tail.
        _ => None,
    }
}

/// `Fs.Path.loader(&jsc_vm.transpiler.options.loaders)` — re-spelt against
/// `bun_ast::LoaderHashTable` (= `StringArrayHashMap<bun_ast::Loader>`).
pub(crate) fn loader_for_path(
    path: &Fs::Path<'_>,
    loaders: &bun_ast::LoaderHashTable,
) -> Option<Loader> {
    if path.is_data_url() {
        return Some(Loader::Dataurl);
    }
    let name = path.name();
    let ext = name.ext;
    let result = loaders
        .get(ext)
        .copied()
        .or_else(|| Loader::from_string(ext));
    if result.is_none() || result == Some(Loader::Json) {
        let str = name.filename;
        if str == b"package.json" || str == b"bun.lock" {
            return Some(Loader::Jsonc);
        }
        if str.ends_with(b".jsonc") {
            return Some(Loader::Jsonc);
        }
        if (str.starts_with(b"tsconfig.") || str.starts_with(b"jsconfig."))
            && str.ends_with(b".json")
        {
            return Some(Loader::Jsonc);
        }
    }
    result
}

/// `options.normalizeSpecifier(jsc_vm, slice)` — strip the VM's origin
/// host/path prefix and split off the `?query`.
fn normalize_specifier_for_loader<'a>(
    origin: &bun_url::URL<'_>,
    slice_: &'a [u8],
) -> (&'a [u8], &'a [u8], &'a [u8]) {
    let mut slice = slice_;
    if slice.is_empty() {
        return (slice, slice, b"");
    }
    // In a `data:` URL everything after the comma is the payload; a `?` is
    // part of the data, not a query string.
    if bun_core::strings::has_prefix_comptime(slice, b"data:") {
        return (slice, slice, b"");
    }
    let host = origin.host;
    let opath = origin.path;
    if slice.starts_with(host) {
        slice = &slice[host.len()..];
    }
    if opath.len() > 1 && slice.starts_with(opath) {
        slice = &slice[opath.len()..];
    }
    let specifier = slice;
    let mut query: &[u8] = b"";
    if let Some(i) = bun_core::strings::index_of_char_usize(slice, b'?') {
        let i = i as usize;
        query = &slice[i..];
        slice = &slice[..i];
    }
    (slice, specifier, query)
}

/// Result of [`get_loader_and_virtual_source`] — mirrors
/// `options.LoaderResult`.
struct LoaderResult<'a> {
    loader: Option<Loader>,
    virtual_source: Option<&'a bun_ast::Source<'a>>,
    path: Fs::Path<'a>,
    is_main: bool,
    /// The specifier is an object URL.
    is_blob: bool,
    specifier: &'a [u8],
    /// Always `None` for non-JS-like loaders (not needed there).
    package_json: Option<&'a bun_resolver::package_json::PackageJSON>,
}

/// `options.getLoaderAndVirtualSource` — high-tier body.
fn get_loader_and_virtual_source<'a>(
    specifier_str: &'a [u8],
    jsc_vm: &'a VirtualMachine,
    virtual_source_to_use: &'a mut Option<bun_ast::Source<'a>>,
    source_blob: &'a mut Option<crate::webcore::Blob>,
    type_attribute_str: Option<&[u8]>,
) -> crate::Result<LoaderResult<'a>> {
    let (normalized_file_path_from_specifier, specifier, query) =
        normalize_specifier_for_loader(&jsc_vm.origin, specifier_str);
    let mut path = Fs::Path::init(normalized_file_path_from_specifier);

    // A `data:` URL has no file name. What follows its last "." is part of the module's text.
    let mut loader: Option<Loader> = if path.text.starts_with(b"data:") {
        None
    } else {
        loader_for_path(&path, &jsc_vm.transpiler.get().options.loaders)
    };
    let mut virtual_source: Option<&'a bun_ast::Source<'a>> = None;
    let attribute_loader = type_attribute_str.and_then(Loader::from_string);
    let suffix = match attribute_loader {
        Some(_) => None,
        None => options::ImportSuffix::find(query, loader),
    };

    // Synthetic `[eval]`/`[stdin]` source.
    if let Some(eval_source) = jsc_vm.module_loader.eval_source.get() {
        // Note: the suffix is `\\[eval]` on Windows; the
        // separator-agnostic `Path::sep_any()` check matches both.
        const EVAL: &[u8] = b"[eval]";
        const STDIN: &[u8] = b"[stdin]";
        let is_eval = specifier.len() > EVAL.len()
            && specifier.ends_with(EVAL)
            && bun_paths::resolve_path::is_sep_any(specifier[specifier.len() - EVAL.len() - 1]);
        let is_stdin = specifier.len() > STDIN.len()
            && specifier.ends_with(STDIN)
            && bun_paths::resolve_path::is_sep_any(specifier[specifier.len() - STDIN.len() - 1]);
        if is_eval || is_stdin {
            virtual_source = Some(eval_source);
            loader = Some(Loader::Tsx);
        }
    }

    // `blob:` ObjectURL → in-memory virtual source.
    let is_blob = crate::webcore::object_url_registry::is_blob_url(specifier);
    if is_blob {
        match crate::webcore::object_url_registry::ObjectURLRegistry::singleton()
            .resolve_and_dupe(&specifier[b"blob:".len()..], jsc_vm.global())
        {
            Some(blob) => {
                // The caller's slot keeps the blob alive for `'a`.
                let blob: &'a crate::webcore::Blob = source_blob.insert(blob);
                loader = blob.get_loader(jsc_vm);

                // "file:" loader makes no sense for blobs, so default to tsx.
                if let Some(filename) = blob.store_path() {
                    // Only treat it as a file if it is a `Bun.file()`.
                    if blob.needs_to_read_file() {
                        path = Fs::Path::init(filename);
                    }
                }

                if !blob.needs_to_read_file() {
                    virtual_source = Some(virtual_source_to_use.insert(
                        bun_ast::Source::init_path_string(path.text, blob.shared_view()),
                    ));
                }
            }
            None => return Err(crate::Error::BlobNotFound),
        }
    } else if let Some(module) = suffix.and_then(|suffix| suffix.module(path.text, specifier)) {
        *virtual_source_to_use = Some(module);
        virtual_source = virtual_source_to_use.as_ref();
        path = Fs::Path::init(specifier);
    } else if virtual_source.is_none()
        && let Some(written) = match attribute_loader
            .or_else(|| suffix.map(options::ImportSuffix::loader))
            .or(loader)
        {
            Some(
                Loader::Json
                | Loader::Jsonc
                | Loader::Json5
                | Loader::Toml
                | Loader::Yaml
                | Loader::Xml
                | Loader::Md
                | Loader::Text
                | Loader::Css,
            ) => bun_standalone_graph::find_written_file(path.text),
            _ => bun_standalone_graph::find_written_code(path.text),
        }
        && let Ok(contents) = bun_sys::File::read_from(bun_sys::Fd::cwd(), &*written)
    {
        // What the program has written is on the disk.
        *virtual_source_to_use = Some(bun_ast::Source {
            path: bun_paths::fs::Path::init(path.text),
            contents: std::borrow::Cow::Owned(contents),
            ..Default::default()
        });
        virtual_source = virtual_source_to_use.as_ref();
    } else if virtual_source.is_none()
        && let Some(file) = bun_standalone_graph::Graph::get_ref().and_then(|graph| {
            graph
                .find_at_source_path(path.text)
                .or_else(|| graph.find_asset_under_root(path.text))
        })
    {
        // An executable compiled in place serves an embedded file that is no longer on disk, on every load of the module.
        // Any other compiled program serves what is embedded under its own root.
        *virtual_source_to_use = Some(bun_ast::Source {
            path: bun_paths::fs::Path::init(path.text),
            contents: std::borrow::Cow::Borrowed(file.utf8_contents()),
            ..Default::default()
        });
        virtual_source = virtual_source_to_use.as_ref();
    }

    loader = attribute_loader
        .or_else(|| suffix.map(options::ImportSuffix::loader))
        .or(loader);

    let is_main = jsc_vm.main() == Some(specifier)
        || (jsc_vm.is_in_preload.get()
            && jsc_vm.preload_hash.get() == bun_watcher::Watcher::get_hash(specifier));

    // package.json sniff for `.js`/`.ts` module-type.
    let is_js_like = loader.map(|l| l.is_java_script_like()).unwrap_or(true);
    let package_json = if is_js_like {
        package_json_of(jsc_vm, &path)
    } else {
        None
    };

    Ok(LoaderResult {
        loader,
        virtual_source,
        path,
        is_main,
        is_blob,
        specifier,
        package_json,
    })
}

fn package_json_of<'a>(
    jsc_vm: &'a VirtualMachine,
    path: &Fs::Path<'_>,
) -> Option<&'a bun_resolver::package_json::PackageJSON> {
    let dir = path.name().dir;
    if !bun_paths::is_absolute(dir) {
        return None;
    }
    // SAFETY: `read_dir_info` is re-entrant on the JS thread.
    match unsafe { (*jsc_vm.transpiler.as_ptr()).resolver.read_dir_info(dir) } {
        Ok(Some(dir_info)) => dir_info.package_json().or(dir_info.enclosing_package_json),
        _ => None,
    }
}

pub(crate) fn module_type_of(
    path: &Fs::Path<'_>,
    package_json: Option<&bun_resolver::package_json::PackageJSON>,
) -> ModuleType {
    if path.text.starts_with(b"data:") {
        return ModuleType::Unknown;
    }
    let ext = path.name().ext;
    // regex /\.[cm][jt]s$/
    if ext.len() == b".cjs".len() {
        if ext == b".cjs" {
            return ModuleType::Cjs;
        }
        if ext == b".mjs" {
            return ModuleType::Esm;
        }
        if ext == b".cts" {
            return ModuleType::Cjs;
        }
        if ext == b".mts" {
            return ModuleType::Esm;
        }
    }
    // regex /\.[jt]s$/
    if ext.len() == b".ts".len() && (ext == b".js" || ext == b".ts") {
        // Use the package.json module type if it exists.
        return package_json
            .map(|pkg| pkg.module_type)
            .unwrap_or(ModuleType::Unknown);
    }
    // For JSX/TSX and other extensions, let the file contents decide.
    ModuleType::Unknown
}

/// C++ entry point: whether the extension, or else `"type"` in package.json, makes the file an ES module.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__isESModuleByExtensionOrPackageType(
    global: &JSGlobalObject,
    path: &bun_core::String,
) -> bool {
    let path = path.to_utf8();
    let path = Fs::Path::init(path.slice());
    let package_json = package_json_of(global.bun_vm(), &path);
    module_type_of(&path, package_json) == ModuleType::Esm
}

thread_local! {
    /// Dedup cache for [`intern_transpile_path`].
    /// `&'static [u8]` keys point into the `FilenameStore` BSS singleton, so
    /// the set itself owns nothing beyond its bucket array.
    static TRANSPILE_PATH_INTERN: core::cell::RefCell<
        bun_collections::HashMap<&'static [u8], ()>,
    > = core::cell::RefCell::new(bun_collections::HashMap::new());
}

/// Interns `value` into the process-lifetime `FilenameStore`, once per distinct content.
fn intern_transpile_path(value: &[u8]) -> &'static [u8] {
    // Fast path: `value` already lives in the process-lifetime `FilenameStore`
    // backing arena (resolver-interned, or a prior `intern_transpile_path`
    // result) — no hash, no probe, no append.
    if Fs::FilenameStore::instance().exists(value) {
        // SAFETY: `exists` is a pointer-range check (like `is_slice_in_buffer`): the
        // bytes lie wholly within `FilenameStore`'s backing storage, which is
        // process-lifetime and never freed, so widening to `'static` is sound.
        // Same widening as `FilenameStore::append_slice` itself performs.
        return unsafe { core::slice::from_raw_parts(value.as_ptr(), value.len()) };
    }
    TRANSPILE_PATH_INTERN.with(|cell| {
        let mut set = cell.borrow_mut();
        if let Some((interned, ())) = set.get_key_value(value) {
            return *interned;
        }
        let interned: &'static [u8] =
            bun_core::handle_oom(Fs::FilenameStore::instance().append_slice(value));
        set.insert(interned, ());
        interned
    })
}

/// What loading a file with a loader gives.
#[derive(Copy, Clone, PartialEq)]
enum Loaded {
    /// The file runs code of its own.
    Code,
    /// An object of Bun's with methods: a database, a page.
    HostObject,
    /// Strings, numbers, plain objects and arrays.
    Data,
}

fn what_loading_gives(loader: Loader) -> Loaded {
    match loader {
        Loader::Jsx
        | Loader::Js
        | Loader::Ts
        | Loader::Tsx
        | Loader::Wasm
        | Loader::Napi
        | Loader::Bunsh
        | Loader::Md => Loaded::Code,
        Loader::Sqlite | Loader::SqliteEmbedded | Loader::Html => Loaded::HostObject,
        Loader::Css
        | Loader::File
        | Loader::Json
        | Loader::Jsonc
        | Loader::Toml
        | Loader::Base64
        | Loader::Dataurl
        | Loader::Text
        | Loader::Yaml
        | Loader::Json5
        | Loader::Xml => Loaded::Data,
    }
}

/// What reading `path` answers where no file can be read there.
fn unreadable_file_error(
    global: &JSGlobalObject,
    specifier: &bun_core::String,
    referrer: &bun_core::String,
    log: &mut bun_ast::Log,
    path: &[u8],
) -> Option<JSValue> {
    let mut buffer = bun_paths::path_buffer_pool::get();
    if path.len() >= buffer.len() {
        return None;
    }
    let error = bun_sys::access(
        bun_paths::resolve_path::z(path, &mut buffer),
        bun_sys::posix::R_OK,
    )
    .err()?;
    let _ = log.add_error_fmt(
        None,
        bun_ast::Loc::EMPTY,
        format_args!(
            "{} reading \"{}\"",
            bstr::BStr::new(error.name()),
            bstr::BStr::new(path),
        ),
    );
    Some(bun_jsc::virtual_machine::process_fetch_log(
        global,
        specifier,
        referrer,
        log,
        bun_jsc::CrateError::ModuleNotFound,
    ))
}

fn loader_refusal_error<const DATA_ONLY: bool>(
    global: &JSGlobalObject,
    specifier: &bun_core::String,
    referrer: &bun_core::String,
    is_commonjs_require: bool,
    loader: Loader,
    lr: &LoaderResult<'_>,
    log: &mut bun_ast::Log,
) -> Option<JSValue> {
    let refusal =
        refusal_of_what_loading_gives::<DATA_ONLY>(global, specifier, is_commonjs_require, loader)?;
    let is_read_from_disk = loader.is_java_script_like()
        && lr.virtual_source.is_none()
        && !lr.path.text.starts_with(b"data:")
        && !bun_jsc::compiled_program::is_compiled_module(lr.path.text);
    if is_read_from_disk
        && let Some(error) = unreadable_file_error(global, specifier, referrer, log, lr.path.text)
    {
        return Some(error);
    }
    Some(refusal)
}

fn refusal_of_what_loading_gives<const DATA_ONLY: bool>(
    global: &JSGlobalObject,
    specifier: &bun_core::String,
    is_commonjs_require: bool,
    loader: Loader,
) -> Option<JSValue> {
    if !DATA_ONLY && bun_jsc::compiled_program::compiled_program().is_none() {
        return None;
    }
    let code = if is_commonjs_require {
        bun_jsc::ErrCode::MODULE_NOT_FOUND
    } else {
        bun_jsc::ErrCode::ERR_MODULE_NOT_FOUND
    };
    let changed = bun_jsc::compiled_program::error_if_compiled_file_changed_out_of_sight(
        global, code, specifier,
    );
    if changed.is_some() {
        return changed;
    }
    let loaded = what_loading_gives(loader);
    if loaded == Loaded::Data {
        return None;
    }
    // Whether an executable holds a native addon is a matter of how it is packaged, which a test run cannot know.
    if loader == Loader::Napi
        && (bun_jsc::compiled_program::lets_test_run_load_addon(global, specifier)
            || bun_jsc::compiled_program::is_file_in_executable(specifier))
    {
        return None;
    }
    let refusal = if loaded == Loaded::Code {
        bun_jsc::compiled_program::error_if_code_outside_image_is_refused(global, code, specifier)
    } else {
        bun_jsc::compiled_program::error_if_host_object_outside_image_is_refused(
            global, code, specifier,
        )
    };
    if DATA_ONLY && refusal.is_none() {
        return Some(bun_jsc::module_loader::module_not_compiled_in_error(
            global, code, specifier,
        ));
    }
    refusal
}

/// Modules that must always transpile on-thread (see [`Bun__transpileFile`]).
const ALWAYS_SYNC_MODULES: &[&[u8]] = &[b"reflect-metadata"];

/// Concurrent-transpiler entry. Returns the in-flight `JSInternalPromise*`
/// when `allow_promise && async`, else null (result is in `*ret`).
///
/// PERF: this is the per-`require()` / per-`import` hot-loop root.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__transpileFile(
    jsc_vm: &VirtualMachine,
    global: &JSGlobalObject,
    specifier: &bun_core::String,
    referrer: &bun_core::String,
    type_attribute: Option<&bun_core::String>,
    ret: &mut ErrorableResolvedSource,
    allow_promise: bool,
    is_commonjs_require: bool,
    force_loader: u8,
    // The `JSModuleLoader` that is fetching when it is not the global object's (a
    // `Bun.ModuleGraph`'s), else empty: handed back to `Bun__onFulfillAsyncModule`.
    module_loader: JSValue,
) -> *mut c_void {
    unsafe extern "C" {
        safe fn Bun__compiledProgramWillRunTextOfFile(
            global: &JSGlobalObject,
            path: &bun_core::String,
        );
    }
    bun_jsc::mark_binding();
    if bun_jsc::compiled_program::compiled_program().is_some() {
        Bun__compiledProgramWillRunTextOfFile(global, specifier);
    }
    bun_removable_features::call_removable_or!(
        RuntimeTranspiler,
        Throw,
        {
            bun_removable_features::call_removable_or!(
                DataFileLoaders,
                Throw,
                {
                    let code = if is_commonjs_require {
                        bun_jsc::ErrCode::MODULE_NOT_FOUND
                    } else {
                        bun_jsc::ErrCode::ERR_MODULE_NOT_FOUND
                    };
                    *ret = ErrorableResolvedSource::err(
                        bun_jsc::module_loader::module_not_compiled_in_error(
                            global, code, specifier,
                        ),
                    );
                    ptr::null_mut()
                },
                transpile_file::<true>,
                jsc_vm,
                global,
                specifier,
                referrer,
                type_attribute,
                ret,
                allow_promise,
                is_commonjs_require,
                force_loader,
                module_loader
            )
        },
        transpile_file::<false>,
        jsc_vm,
        global,
        specifier,
        referrer,
        type_attribute,
        ret,
        allow_promise,
        is_commonjs_require,
        force_loader,
        module_loader
    )
}

#[inline(never)]
fn transpile_file<const DATA_ONLY: bool>(
    jsc_vm: &VirtualMachine,
    global: &JSGlobalObject,
    specifier: &bun_core::String,
    referrer: &bun_core::String,
    type_attribute: Option<&bun_core::String>,
    ret: &mut ErrorableResolvedSource,
    allow_promise: bool,
    is_commonjs_require: bool,
    force_loader: u8,
    module_loader: JSValue,
) -> *mut c_void {
    use bun_jsc::resolved_source::Tag as ResolvedSourceTag;

    let force_loader_type: Option<Loader> = force_loader_from_api_u8(force_loader);

    // Create a fresh parse log.
    // Note: per §Allocators the explicit allocator threads are dropped.
    let mut log = bun_ast::Log::init();

    let _specifier = specifier.to_utf8();
    let referrer_slice = referrer.to_utf8();
    let type_attribute_str: Option<&[u8]> = type_attribute.and_then(|s| s.as_utf8());

    let mut virtual_source_to_use: Option<bun_ast::Source> = None;
    let mut source_blob: Option<crate::webcore::Blob> = None;
    let mut lr = match get_loader_and_virtual_source(
        _specifier.slice(),
        jsc_vm,
        &mut virtual_source_to_use,
        &mut source_blob,
        type_attribute_str,
    ) {
        Ok(lr) => lr,
        Err(_) => {
            let js = global
                .err(
                    bun_jsc::ErrCode::ERR_MODULE_NOT_FOUND,
                    format_args!("Blob not found"),
                )
                .to_js();
            *ret = ErrorableResolvedSource::err(js);
            return ptr::null_mut();
        }
    };
    let had_blob = lr.is_blob;

    // ── force_loader / require.extensions override ──────────────────────────
    if let Some(loader_type) = force_loader_type {
        // Note: `@branchHint(.unlikely)` dropped (no stable Rust equiv).
        debug_assert!(!is_commonjs_require);
        lr.loader = Some(loader_type);
    } else if is_commonjs_require && jsc_vm.has_mutated_built_in_extensions.get() > 0 {
        use bun_jsc::node_module_module::{CustomLoader, find_longest_registered_extension};
        if let Some(entry) = find_longest_registered_extension(jsc_vm, _specifier.slice()) {
            match entry {
                CustomLoader::Loader(loader) => lr.loader = Some(*loader),
                CustomLoader::Custom(strong) => {
                    *ret = ErrorableResolvedSource::ok(ResolvedSource {
                        cjs_custom_extension_index: strong.get(),
                        tag: ResolvedSourceTag::CommonJsCustomExtension,
                        ..Default::default()
                    });
                    return ptr::null_mut();
                }
            }
        }
    }

    if let Some(loader) = lr.loader
        && let Some(error) = loader_refusal_error::<DATA_ONLY>(
            global,
            specifier,
            referrer,
            is_commonjs_require,
            loader,
            &lr,
            &mut log,
        )
    {
        *ret = ErrorableResolvedSource::err(error);
        return ptr::null_mut();
    }

    let module_type = module_type_of(&lr.path, lr.package_json);
    let pkg_name: Option<&[u8]> = lr
        .package_json
        .and_then(|pkg| (!pkg.name.is_empty()).then_some(&*pkg.name));

    // ── Concurrent-transpiler dispatch (`transpile_async:` block) ───────────
    // We only run the transpiler concurrently when we can — today that's import statements and
    // import expressions. Node compile cache: lazily initialize from env on the first fetch.
    if !DATA_ONLY {
        bun_jsc::node_compile_cache::init_from_env_once();
    }

    if !DATA_ONLY
        && crate::read_ahead::is_enabled(jsc_vm)
        && let Some(loader) = lr.loader.filter(|it| it.is_java_script_like())
        && lr.virtual_source.is_none()
        && !lr.is_main
        && lr.path.is_file()
        && !lr.specifier.starts_with(node_fallbacks::IMPORT_PATH)
        && !jsc_vm.macro_mode.get()
        && !jsc_vm.has_any_macro_remappings.get()
        && !bun_jsc::node_compile_cache::is_enabled()
        && (jsc_vm.transpiler)
            .with_mut(|t| t.find_aot_package_config(lr.path.text, loader))
            .is_none()
    {
        let tag = match lr.package_json.map_or(module_type, |it| it.module_type) {
            ModuleType::Esm => ResolvedSourceTag::PackageJsonTypeModule,
            ModuleType::Cjs => ResolvedSourceTag::PackageJsonTypeCommonjs,
            ModuleType::Unknown => ResolvedSourceTag::Javascript,
        };
        let loaded = crate::read_ahead::load(jsc_vm, specifier, &lr.path, loader, module_type, tag);
        if let Some(loaded) = loaded {
            *ret = ErrorableResolvedSource::ok(loaded);
            return ptr::null_mut();
        }
    }

    'transpile_async: {
        if DATA_ONLY {
            break 'transpile_async;
        }
        let concurrent_loader = lr.loader.unwrap_or(Loader::File);
        let (has_loaded, is_in_preload, store_enabled) = (
            jsc_vm.has_loaded.get(),
            jsc_vm.is_in_preload.get(),
            jsc_vm.transpiler_store.enabled.get(),
        );
        if !had_blob
            && lr.virtual_source.is_none()
            && allow_promise
            && (has_loaded || is_in_preload)
            && concurrent_loader.is_java_script_like()
            && !lr.is_main
            && store_enabled
            // With the Node compile cache enabled, transpile on-thread so the
            // fetch hook sees every module.
            && !bun_jsc::node_compile_cache::is_enabled()
        {
            // Disgusting workaround: polyfills like
            // `reflect-metadata` are CJS-with-side-effects that other ESM
            // depends on synchronously, so they must transpile on-thread.
            if let Some(pkg_name_) = pkg_name {
                for always_sync in ALWAYS_SYNC_MODULES {
                    if pkg_name_ == *always_sync {
                        break 'transpile_async;
                    }
                }
            }

            let aot_package_config = (jsc_vm.transpiler)
                .with_mut(|t| t.find_aot_package_config(lr.path.text, concurrent_loader));
            return jsc_vm.transpiler_store.transpile(
                jsc_vm,
                global,
                specifier.clone(),
                &lr.path,
                referrer.clone(),
                concurrent_loader,
                lr.package_json,
                aot_package_config,
                module_loader,
            );
        }
    }

    // ── Synchronous-loader fallback ────────────────────────────────────────
    // Note: hoisted out of `unwrap_or_else` into a
    // labelled block so the `CustomLoader::Custom` arm can write `*ret` and
    // `return null` — a closure cannot perform a non-local return.
    let synchronous_loader: Loader = 'loader: {
        if let Some(l) = lr.loader {
            break 'loader l;
        }
        let (has_loaded, is_in_preload) = (jsc_vm.has_loaded.get(), jsc_vm.is_in_preload.get());
        if has_loaded || is_in_preload {
            // Extensionless files in this context are treated as the JS loader.
            if lr.path.name().ext.is_empty() || lr.path.text.starts_with(b"data:") {
                break 'loader Loader::Tsx;
            }
            // Unknown extensions are to be treated as file loader.
            if is_commonjs_require {
                use bun_jsc::node_module_module::{
                    CustomLoader, find_longest_registered_extension,
                };
                if jsc_vm.commonjs_custom_extensions.get().len() > 0
                    && jsc_vm.has_mutated_built_in_extensions.get() == 0
                {
                    if let Some(entry) = find_longest_registered_extension(jsc_vm, lr.path.text) {
                        match entry {
                            CustomLoader::Loader(loader) => break 'loader *loader,
                            CustomLoader::Custom(strong) => {
                                *ret = ErrorableResolvedSource::ok(ResolvedSource {
                                    cjs_custom_extension_index: strong.get(),
                                    tag: ResolvedSourceTag::CommonJsCustomExtension,
                                    ..Default::default()
                                });
                                return ptr::null_mut();
                            }
                        }
                    }
                }
                // For Node.js compatibility, requiring a file with an unknown
                // extension is treated as a JS file.
                break 'loader Loader::Ts;
            }
            // For ESM, Bun treats unknown extensions as the file loader.
            Loader::File
        } else {
            // Unless it's potentially the main module — important so that
            // `bun run ./foo-i-have-no-extension` works.
            Loader::Tsx
        }
    };

    if lr.loader.is_none()
        && let Some(error) = loader_refusal_error::<DATA_ONLY>(
            global,
            specifier,
            referrer,
            is_commonjs_require,
            synchronous_loader,
            &lr,
            &mut log,
        )
    {
        *ret = ErrorableResolvedSource::err(error);
        return ptr::null_mut();
    }

    // Reset the module loader's arena on scope exit.
    let _reset_arena = ArenaResetGuard::new(jsc_vm);

    // ── `ModuleLoader.transpileSourceCode(...)` ─────────────────────────────
    let extra = TranspileExtra {
        path: lr.path,
        loader: Cell::new(synchronous_loader),
        module_type: Cell::new(module_type),
    };
    let args = TranspileArgs {
        specifier: lr.specifier,
        referrer: referrer_slice.slice(),
        input_specifier: specifier,
        log: &raw mut log,
        virtual_source: lr.virtual_source,
        global_object: global,
        flags: FetchFlags::Transpile,
        extra: &extra,
    };

    match transpile_source_code_inner::<DATA_ONLY>(jsc_vm, &args) {
        Ok(resolved) => *ret = ErrorableResolvedSource::ok(resolved),
        Err(err) => {
            if let Some(value) = transpile_error_value(global, specifier, referrer, &mut log, err) {
                *ret = ErrorableResolvedSource::err(value);
            }
        }
    }
    ptr::null_mut()
}

/// The JS value a failed transpile should reject with, or `None` for a plugin
/// error (the plugin already threw).
fn transpile_error_value(
    global: &JSGlobalObject,
    specifier: &bun_core::String,
    referrer: &bun_core::String,
    log: &mut bun_ast::Log,
    err: crate::Error,
) -> Option<JSValue> {
    match err {
        crate::Error::Bundler(bun_bundler::Error::Plugin) => None,
        // `take_error` unwraps the JSC::Exception to its inner value; the C++
        // caller re-wraps via `JSC::Exception::create`, so storing the raw
        // Exception here would double-wrap and trip
        // `ASSERT(!value.inherits<Exception>())` in JSPromise::reject.
        crate::Error::JSError
        | crate::Error::Js(_)
        | crate::Error::Bundler(bun_bundler::Error::Js(_)) => {
            Some(global.take_error(bun_jsc::JsError::Thrown))
        }
        err => Some(bun_jsc::virtual_machine::process_fetch_log(
            global,
            specifier,
            referrer,
            log,
            to_jsc_fetch_error(&err),
        )),
    }
}

/// What `bun test --coverage` runs of the file at `path` with the text `source`: what the transpiler prints. Its source map is saved as for a
/// file that is loaded.
pub(crate) fn transpile_as_loaded(
    global: &JSGlobalObject,
    path: &[u8],
    source: &[u8],
) -> Option<ResolvedSource> {
    let jsc_vm = global.bun_vm();
    let virtual_source = bun_ast::Source::init_path_string(path, source);
    let mut log = bun_ast::Log::init();
    let fs_path = Fs::Path::init(path);
    let loaders = &jsc_vm.transpiler.get().options.loaders;
    let loader = loaders.get(fs_path.name().ext).copied()?;
    if !loader.is_java_script_like() {
        return None;
    }
    let _reset_arena = ArenaResetGuard::new(jsc_vm);
    let extra = TranspileExtra {
        path: fs_path,
        loader: Cell::new(loader),
        module_type: Cell::new(ModuleType::Unknown),
    };
    let specifier = bun_core::StringView::from_bytes(path);
    let args = TranspileArgs {
        specifier: path,
        referrer: b"",
        input_specifier: &specifier,
        log: &raw mut log,
        virtual_source: Some(&virtual_source),
        global_object: global,
        flags: FetchFlags::Transpile,
        extra: &extra,
    };
    transpile_source_code_inner::<false>(jsc_vm, &args).ok()
}

/// BunCompiledModules.cpp. An error of the class that `bun run` throws at the import of a file of data that its parser refuses, with the place that the parser named at the build. Empty where the build kept nothing under the path.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__compiledProgramErrorOfRefusedData(
    global: &JSGlobalObject,
    path: &bun_core::String,
) -> JSValue {
    let path = path.to_utf8();
    let graph = bun_standalone_graph::Graph::get_ref();
    let Some(refused) = graph.and_then(|graph| graph.find_refused_data(path.slice())) else {
        return JSValue::ZERO;
    };
    if refused.is_syntax_error {
        let message = bstr::BStr::new(refused.message);
        return global.create_syntax_error_instance(format_args!("{message}"));
    }
    let file = match bun_core::strings::last_index_of_char(path.slice(), b'?') {
        Some(mark) => &path.slice()[..mark],
        None => path.slice(),
    };
    let location = bun_ast::Location {
        file: Box::from(file),
        line_text: Some(Box::default()),
        length: refused.length as usize,
        offset: refused.offset as usize,
        line: refused.line,
        column: refused.column,
        ..Default::default()
    };
    let message = bun_ast::Msg {
        data: bun_ast::Data {
            text: std::borrow::Cow::Owned(refused.message.to_vec()),
            location: Some(location),
        },
        ..Default::default()
    };
    bun_jsc::BuildMessage::create(global, message)
        .unwrap_or_else(|error| global.take_exception(error))
}

/// BunCompiledModules.cpp. The executable of a compiled program holds the file as it is, so the loader of its kind can read it.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__compiledProgramHoldsFileAsItIs(path: &bun_core::String) -> bool {
    let path = path.to_utf8();
    bun_standalone_graph::Graph::get_ref()
        .is_some_and(|graph| graph.find_asset_under_root(path.slice()).is_some())
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__compiledProgramDataFileIsPrintedAsJavaScript(
    global: &JSGlobalObject,
    path: &bun_core::String,
) -> bool {
    let path = path.to_utf8();
    let loaders = &global.bun_vm().transpiler.get().options.loaders;
    matches!(
        loader_for_path(&Fs::Path::init(path.slice()), loaders),
        Some(Loader::Text | Loader::Md)
    )
}

/// Transpiles plugin-provided source, writing the result into `ret`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__transpileVirtualModule(
    global: &JSGlobalObject,
    specifier_str: &bun_core::String,
    referrer_str: &bun_core::String,
    source_code: &bun_core::EncodedSlice,
    loader_: bun_options_types::schema::api::Loader,
    ret: &mut ErrorableResolvedSource,
) -> bool {
    use bun_options_types::schema::api;

    bun_jsc::mark_binding();
    let jsc_vm = global.bun_vm();

    let specifier_slice = specifier_str.to_utf8();
    let specifier = specifier_slice.slice();
    let source_code_slice = source_code.to_utf8();
    let referrer_slice = referrer_str.to_utf8();

    let virtual_source = bun_ast::Source::init_path_string(specifier, source_code_slice.slice());
    let mut log = bun_ast::Log::init();
    let path = Fs::Path::init(specifier);

    // Pick the loader: the explicit API loader if given, else by file
    // extension, else `.js` for the main module / `.file` otherwise.
    let loader = if loader_ != api::Loader::_none {
        Loader::from_api(loader_)
    } else {
        let opt = jsc_vm
            .transpiler
            .get()
            .options
            .loaders
            .get(path.name().ext)
            .copied();
        opt.unwrap_or_else(|| {
            let main = jsc_vm.main();
            if main.is_some_and(|main| bun_core::strings::eql_long(specifier, main)) {
                Loader::Js
            } else {
                Loader::File
            }
        })
    };

    // Reset the module loader's arena on scope exit.
    let _reset_arena = ArenaResetGuard::new(jsc_vm);

    let module_type = if loader.is_java_script_like() {
        module_type_of(&path, package_json_of(jsc_vm, &path))
    } else {
        ModuleType::Unknown
    };

    // ── `ModuleLoader.transpileSourceCode(...)` ─────────────────────────────
    let extra = TranspileExtra {
        path,
        loader: Cell::new(loader),
        module_type: Cell::new(module_type),
    };
    let args = TranspileArgs {
        specifier,
        referrer: referrer_slice.slice(),
        input_specifier: specifier_str,
        log: &raw mut log,
        virtual_source: Some(&virtual_source),
        global_object: global,
        flags: FetchFlags::Transpile,
        extra: &extra,
    };

    match transpile_source_code_inner::<false>(jsc_vm, &args) {
        Ok(resolved) => {
            *ret = ErrorableResolvedSource::ok(resolved);
            bun_analytics::features::virtual_modules
                .fetch_add(1, core::sync::atomic::Ordering::Relaxed);
            true
        }
        Err(err) => {
            if let Some(value) =
                transpile_error_value(global, specifier_str, referrer_str, &mut log, err)
            {
                *ret = ErrorableResolvedSource::err(value);
            }
            true
        }
    }
}

/// Materialise an embedded file (`.node`/`.so`/`.dylib`/`.dll` from
/// `bun build --compile`) to an on-disk path `dlopen(2)` can open. Called
/// from `resolve_embedded_node_file_hook` (`process.dlopen()`) and
/// `ffi_body::FFI::dlopen` (`bun:ffi`).
///
/// The filename is a hash of the contents, so every `dlopen()` of the same
/// embedded library — across calls, Worker VMs, and restarts — shares one
/// file instead of leaking a copy per call (#29585). Returns `None` when the
/// input is empty, absent from the graph, or a filesystem step fails.
pub(crate) fn resolve_embedded_file_to_buf(
    input_path: &[u8],
    extname: &[u8],
    out_buf: &mut [u8],
) -> Option<usize> {
    if input_path.is_empty() {
        return None;
    }

    if let Some(path) = bun_standalone_graph::find_written_code(input_path) {
        out_buf.get_mut(..path.len())?.copy_from_slice(&path);
        return Some(path.len());
    }
    let file = bun_standalone_graph::Graph::get_ref()?.find_library(input_path)?;
    let file_contents: &[u8] = file.contents.as_bytes();

    // `.bun-{uid}-{wyhash(contents)}.{ext}`: the hash dedupes; the uid keeps
    // users on a shared `/tmp` from colliding.
    let content_hash = bun_wyhash::hash(file_contents);
    let uid = extract_owner_uid();
    let mut canonical_name_buf = [0u8; 64];
    let canonical_name = bun_core::fmt::buf_print_z(
        &mut canonical_name_buf,
        format_args!(
            ".bun-{}-{:x}.{}",
            uid,
            content_hash,
            bun_core::fmt::s(extname)
        ),
    )
    .ok()?;

    // Reuse the canonical file from a previous run if it is still ours with
    // the right size. `lstatat` so a planted symlink fails the ISREG check
    // instead of being followed.
    let tmpdir = Fs::FileSystem::get().tmpdir().ok()?;
    let tmpdir_fd: bun_sys::Fd = tmpdir.fd;
    if let Ok(st) = bun_sys::lstatat(tmpdir_fd, canonical_name) {
        let size_ok = st.st_size as usize == file_contents.len();
        #[cfg(unix)]
        let ours = st.st_uid == uid && bun_sys::S::ISREG(st.st_mode as u32);
        #[cfg(windows)]
        let ours = true;
        if size_ok && ours {
            return write_absolute(
                out_buf,
                Fs::RealFS::tmpdir_path(),
                canonical_name.as_bytes(),
            );
        }
    }

    // Write to a unique scratch name, then atomically rename it into place.
    let mut scratch_buf = bun_paths::path_buffer_pool::get();
    let scratch_name = Fs::FileSystem::tmpname(extname, &mut scratch_buf[..], content_hash).ok()?;

    // 0600: the file persists, only the owning euid ever dlopens it, and the
    // embedded bytes may come from a binary that is not world-readable.
    let tmpfile = bun_sys::Tmpfile::create_with_mode(tmpdir_fd, scratch_name, 0o600).ok()?;
    tmpfile.file.write_all(file_contents).ok()?;

    // On sticky `/tmp` the rename fails EACCES/EPERM when another user owns
    // the destination; fall back to the scratch file.
    let final_name = match tmpfile.finish(canonical_name) {
        Ok(()) => canonical_name,
        Err((_, scratch)) => {
            scratch.keep();
            scratch_name
        }
    };
    write_absolute(out_buf, Fs::RealFS::tmpdir_path(), final_name.as_bytes())
}

/// Writes `{tmpdir}/{name}` into `out_buf` and returns the length.
fn write_absolute(out_buf: &mut [u8], tmpdir: &[u8], name: &[u8]) -> Option<usize> {
    let result = bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Auto>(
        tmpdir,
        out_buf,
        &[name],
    );
    Some(result.len())
}

/// euid, not uid: `open(2)` sets the new file's owner to euid, so a
/// `getuid()` check would never match in a setuid binary.
#[cfg(unix)]
fn extract_owner_uid() -> u32 {
    // SAFETY: `geteuid` takes no arguments and cannot fail.
    unsafe { libc::geteuid() as u32 }
}

#[cfg(windows)]
fn extract_owner_uid() -> u32 {
    bun_sys::windows::user_unique_id()
}

/// Creates `path` if nothing is there. Returns whether `path` is a directory that this user owns and nobody else can access.
#[cfg(unix)]
fn make_or_find_private_folder(path: &[u8], uid: u32) -> bool {
    let path = bun_core::ZBox::from_bytes(path);
    let _ = bun_sys::mkdir(&path, 0o700);
    // `lstat`: a planted link is not followed.
    bun_sys::lstat(&path).is_ok_and(|it| {
        bun_sys::S::ISDIR(it.st_mode as u32) && it.st_uid == uid && it.st_mode & 0o077 == 0
    })
}

#[cfg(windows)]
fn make_or_find_private_folder(path: &[u8], _uid: u32) -> bool {
    bun_sys::windows::private_folder::make_or_find(path)
}

/// An addon may load libraries by a path relative to itself (`$ORIGIN/../lib`, `@loader_path/../lib`).
fn write_next_to_libraries(addon_path: &[u8]) -> Option<Vec<u8>> {
    use bun_sys::O;

    let graph = bun_standalone_graph::Graph::get_ref()?;
    let addon = graph.find_library(addon_path)?;
    let mut files: Vec<(&[u8], &[u8])> = graph.preserved_shared_libraries().collect();
    if files.is_empty() {
        return None;
    }
    let mut hash = bun_wyhash::hash(addon.contents.as_bytes());
    for (path, contents) in &files {
        hash = hash.rotate_left(7) ^ bun_wyhash::hash(path) ^ bun_wyhash::hash(contents);
    }
    files.push((addon.name, addon.contents.as_bytes()));

    let uid = extract_owner_uid();
    let mut persistent_folder = [
        Fs::RealFS::tmpdir_path(),
        bun_paths::SEP_STR.as_bytes(),
        format!(".bun-{uid}-{hash:x}").as_bytes(),
    ]
    .concat();
    if cfg!(windows) {
        bun_paths::resolve_path::slashes_to_windows_in_place(&mut persistent_folder);
    }
    let per_process_folder = [
        &persistent_folder[..],
        format!("-{:x}", bun_core::fast_random()).as_bytes(),
    ]
    .concat();
    let folder = [persistent_folder, per_process_folder]
        .into_iter()
        .find(|folder| make_or_find_private_folder(folder, uid))?;
    let written_path = |path: &[u8]| -> Vec<u8> {
        if cfg!(unix) {
            return [&folder[..], path].concat();
        }
        let under_folder = path
            .iter()
            .filter(|&&c| c != b':')
            .map(|&c| if c == b'/' { b'\\' } else { c });
        folder
            .iter()
            .copied()
            .chain(std::iter::once(b'\\'))
            .chain(under_folder)
            .collect()
    };
    for (path, contents) in files {
        let to = bun_core::ZBox::from_vec(written_path(path));
        let is_written = || {
            bun_sys::lstat(&to).is_ok_and(|it| {
                bun_sys::S::ISREG(it.st_mode as u32) && it.st_size as usize == contents.len()
            })
        };
        if is_written() {
            continue;
        }
        bun_sys::mkdir_recursive_at_mode(
            bun_sys::Fd::cwd(),
            bun_paths::dirname(to.as_bytes())?,
            0o700,
        )
        .ok()?;
        let scratch = bun_core::ZBox::from_vec(
            [
                to.as_bytes(),
                format!(".{:x}", bun_core::fast_random()).as_bytes(),
            ]
            .concat(),
        );
        let is_complete = {
            let file = bun_sys::open(&scratch, O::WRONLY | O::CREAT | O::EXCL, 0o600)
                .map(bun_sys::CloseOnDrop::new)
                .ok()?;
            file.write_all(contents).is_ok()
        };
        if !is_complete || bun_sys::rename(&scratch, &to).is_err() {
            let _ = bun_sys::unlink(&scratch);
            if !is_written() {
                return None;
            }
        }
    }
    Some(written_path(addon.name))
}

/// Support embedded .node files. `Dead` when `path` is not an embedded file.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__resolveEmbeddedNodeFile(path: &bun_core::String) -> bun_core::String {
    bun_jsc::mark_binding();
    if VirtualMachine::get().standalone_module_graph.is_none() {
        return bun_core::String::DEAD;
    }
    let input_path = path.to_utf8();
    if let Some(path) = write_next_to_libraries(input_path.slice()) {
        return bun_core::String::clone_utf8(&path);
    }
    let mut path_buf = bun_paths::path_buffer_pool::get();
    match resolve_embedded_file_to_buf(input_path.slice(), b"node", &mut path_buf[..]) {
        Some(len) => bun_core::String::clone_utf8(&path_buf[..len]),
        None => bun_core::String::DEAD,
    }
}

/// C++ entry point: if `specifier` names a builtin module, writes its resolved
/// source into `ret` and returns `true`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__resolveAndFetchBuiltinModule(
    specifier: &bun_core::String,
    ret: &mut ErrorableResolvedSource,
) -> bool {
    bun_jsc::mark_binding();
    let spec_utf8 = specifier.to_utf8();
    if let Some((_, tag)) = bun_jsc::module_loader::exposed_internal_tag(spec_utf8.slice()) {
        // The `InternalModuleRegistryFlag` consumer reads only `tag`.
        *ret = ErrorableResolvedSource::ok(ResolvedSource {
            tag,
            ..ResolvedSource::default()
        });
        return true;
    }
    let Some(alias) = bun_jsc::module_loader::bun_aliases_get(spec_utf8.slice()) else {
        return false;
    };
    let Some(&hardcoded) = HardcodedModule::MAP.get(alias.path.as_bytes()) else {
        debug_assert!(false);
        return false;
    };
    let Some(resolved) = get_hardcoded_module(specifier, hardcoded) else {
        return false;
    };
    *ret = ErrorableResolvedSource::ok(resolved);
    true
}

// ════════════════════════════════════════════════════════════════════════════
// Low-tier extern impls
// ════════════════════════════════════════════════════════════════════════════

// Note: the event-loop per-task bodies (`__bun_run_immediate_task` /
// `__bun_run_wtf_timer`) live in [`crate::dispatch`] alongside the other
// §Dispatch hot-path bodies (`__bun_tick_queue_with_count` / `__bun_run_io`).

/// `bun_io::__bun_get_vm_ctx` body. Declared
/// `extern "Rust"` in `bun_io::posix_event_loop`; link-time resolved.
#[unsafe(no_mangle)]
fn __bun_get_vm_ctx() -> bun_io::EventLoopCtx {
    VirtualMachine::get().loop_ctx()
}

/// `dateForHeader`: wrap the header bytes in a
/// `bun.String`, call `String.parseDate(&s, vm.global)`, return the integer
/// value if finite and non-negative, else `None`. Lives in this crate (callers
/// are `server::FileRoute` / `server::StaticRoute`) so `bun_uws_sys` (T0) has
/// no upward hook into `bun_jsc`.
pub(crate) fn parse_http_date(value: &[u8]) -> Option<u64> {
    let vm = bun_jsc::virtual_machine::VirtualMachine::get();
    // SAFETY: `vm.global` is set during `VirtualMachine::init` and outlives
    // the VM; `parse_http_date` is only reachable from a `Bun.serve` request
    // callback (JS thread, VM live).
    let global = unsafe { &*vm.global.get() };
    let string = bun_core::StringView::from_bytes(value);
    // The only callers — FileRoute / static
    // routes — treat a throw the same as "header absent / unparsable", so
    // swallow `JsError` here and surface `None`.
    let Ok(date_f64) = bun_string_jsc::parse_date(&string, global) else {
        return None;
    };
    if !date_f64.is_nan() && date_f64.is_finite() && date_f64 >= 0.0 {
        Some(date_f64 as u64)
    } else {
        None
    }
}
