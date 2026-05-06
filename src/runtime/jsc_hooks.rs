//! `bun_runtime::jsc_hooks` — high-tier implementations for the §Dispatch
//! cold-path vtables that `bun_jsc` exposes (`virtual_machine::RuntimeHooks`
//! and `module_loader::LoaderHooks`).
//!
//! Per `docs/PORTING.md` §Dispatch (cold path), `bun_jsc::VirtualMachine::init`
//! / `ModuleLoader::*` cannot name `bun_runtime` types (`timer::All`,
//! `bundler::entry_points::ServerEntryPoint`, `bundler::Transpiler`,
//! `HardcodedModule`, …) directly without inverting the crate DAG. Instead the
//! low tier defines a manual fn-pointer table; this module owns the static
//! instances and the bodies, and [`install_jsc_hooks`] wires them in at
//! startup (immediately after `dispatch::install_dispatch_hooks`).
//!
//! Layout:
//!   1. [`RuntimeState`] — per-VM state the low tier stores as `*mut c_void`
//!      (owns `timer::All` + the synthetic `bun:main` `ServerEntryPoint`).
//!   2. `RUNTIME_HOOKS_INSTANCE` — `init_runtime_state` / `generate_entry_point`
//!      / `load_preloads` / `ensure_debugger` / `auto_tick`.
//!   3. `LOADER_HOOKS_INSTANCE` — `transpile_source_code` /
//!      `fetch_builtin_module` / `transpile_file`.
//!   4. [`install_jsc_hooks`] — one-shot setter, called from `main.rs`.

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr;

use bun_jsc::module_loader::{
    FetchBuiltinResult, FetchFlags, LoaderHooks, ModuleLoader, TranspileArgs, TranspileExtra,
};
use bun_jsc::virtual_machine::{
    InitOptions, RuntimeHooks, RuntimeState as OpaqueRuntimeState, VirtualMachine,
};
use bun_jsc::{
    AnyPromise, ErrorableResolvedSource, ErrorableString, JSGlobalObject, JSInternalPromise,
    JSModuleLoader, JSValue, ResolvedSource,
};
use bun_jsc::js_promise::Status as PromiseStatus;

use bun_bundler::entry_points::ServerEntryPoint;
use bun_bundler::options::{self, Loader, ModuleType};
use bun_options_types::import_record::ImportKind;
use bun_resolve_builtins::Module as HardcodedModule;
use bun_resolver::fs as Fs;
use bun_resolver::node_fallbacks;
use bun_resolver::{GlobalCache, ResultUnion as ResolveResultUnion};

use crate::timer;

// ════════════════════════════════════════════════════════════════════════════
// Per-VM runtime state
// ════════════════════════════════════════════════════════════════════════════

/// High-tier per-VM state. Boxed + leaked in `init_runtime_state`; the raw
/// pointer is returned to `bun_jsc` as `RuntimeState` (`*mut c_void`) **and**
/// cached thread-locally so `auto_tick` (which only receives `*mut
/// VirtualMachine`) can recover it without a field on the low-tier struct.
///
/// PORT NOTE: in Zig these are value fields of `VirtualMachine`
/// (`vm.timer: api.Timer.All`, `vm.entry_point: ServerEntryPoint`,
/// `vm.body_value_hive_allocator`). The low-tier `VirtualMachine` carries `()`
/// placeholders for them (see `// TODO(b2-cycle)` markers in
/// `VirtualMachine.rs`); until those slots widen to `*mut c_void`, the
/// thread-local is the recovery path.
pub struct RuntimeState {
    /// `bun.api.Timer.All` — setTimeout/setInterval heap + uv timers.
    pub timer: timer::All,
    /// Synthetic `bun:main` wrapper source.
    pub entry_point: ServerEntryPoint,
    /// Backing arena for `vm.transpiler` (spec passes `bun.default_allocator`;
    /// the Rust `Transpiler<'a>` threads `&'a Arena`). Owned here so
    /// `deinit_runtime_state` reclaims it on Worker teardown — previously
    /// `Box::leak`'d per-VM (PORTING.md §Forbidden: `Box::leak` only for true
    /// process-lifetime singletons via `OnceLock`, which a per-VM arena is not).
    pub transpiler_arena: Box<bun_alloc::Arena>,
    // TODO(b2-cycle): `body_value_hive_allocator: webcore::Body::Value::HiveAllocator`
    // — `HiveAllocator` is `#[cfg(any())]`-gated in `webcore/Body.rs`. Add the
    // field (and `HiveAllocator::init()` in `init_runtime_state`) once un-gated.
}

thread_local! {
    /// One `RuntimeState` per JS thread (`VirtualMachine` is per-thread).
    /// Cleared by [`deinit_runtime_state`] (dispatched from
    /// `VirtualMachine::destroy` via `RuntimeHooks`).
    static RUNTIME_STATE: Cell<*mut RuntimeState> = const { Cell::new(ptr::null_mut()) };
}

/// Recover this thread's [`RuntimeState`] as a raw pointer. Null only before
/// `init_runtime_state` has run (e.g. `bun_jsc` unit tests with no high tier).
///
/// PORT NOTE: returns `*mut` (NOT `&'static mut`) — `auto_tick` holds the
/// pointer across `timer.get_timeout`/`drain_timers`, which fire JS callbacks
/// that may re-enter `runtime_state()`. Handing out `&'static mut` would mint
/// aliased `&mut` to the same allocation (UB per PORTING.md §Forbidden).
/// Callers dereference per-field under `// SAFETY:` blocks, mirroring the
/// raw-ptr-per-field style already used for `vm`/`el` in `auto_tick`.
#[inline]
pub fn runtime_state() -> *mut RuntimeState {
    RUNTIME_STATE.with(Cell::get)
}

// ════════════════════════════════════════════════════════════════════════════
// RuntimeHooks bodies
// ════════════════════════════════════════════════════════════════════════════

/// `bun.api.Timer.All.init()` + `Body.Value.HiveAllocator.init()` +
/// `configureDebugger()` — everything `VirtualMachine.init()` does that names
/// a `bun_runtime` type. Spec VirtualMachine.zig:1313-1322.
///
/// # Safety
/// `vm` is the freshly-boxed unique VM on this thread, with `vm.global` /
/// `vm.jsc_vm` already populated by `bun_jsc::VirtualMachine::init`.
unsafe fn init_runtime_state(
    vm: *mut VirtualMachine,
    _opts: &InitOptions,
) -> OpaqueRuntimeState {
    // PORT NOTE: do NOT form `&mut *vm` here — the caller
    // (`VirtualMachine::init`) may still hold a `&mut VirtualMachine` to the
    // same allocation. Dereference per-field via the raw `vm` ptr if needed.

    // PORT NOTE: spec VirtualMachine.zig:1313 —
    // `uws.Loop.get().internal_loop_data.jsc_vm = vm.jsc_vm` — already done by
    // the low tier (`VirtualMachine::init` writes it immediately before calling
    // this hook), so no uws wiring is repeated here.

    // PORT NOTE: `Box::into_raw` is paired with `Box::from_raw` in
    // [`deinit_runtime_state`] below — called from `VirtualMachine::deinit` /
    // worker `destroy()` via the `RuntimeHooks::deinit_runtime_state` slot.
    // Spec VirtualMachine.zig stores `timer`/`entry_point` as value fields
    // freed in worker `destroy()`; PORTING.md §Forbidden permits
    // `into_raw`-without-reclaim only for true process-lifetime singletons via
    // `OnceLock`, which this is not (per-VM / per-Worker-thread).
    let state = Box::into_raw(Box::new(RuntimeState {
        timer: timer::All::init(),
        entry_point: ServerEntryPoint::default(),
        transpiler_arena: Box::new(bun_alloc::Arena::new()),
    }));
    RUNTIME_STATE.with(|c| c.set(state));

    // ── vm.transpiler — spec VirtualMachine.zig:1241-1246:
    //   `Transpiler.init(allocator, log, configureTransformOptionsForBunVM(opts.args), opts.env_loader)`
    // The low-tier `VirtualMachine::init` left this field as zeroed bytes
    // (see the `alloc_zeroed` note); reading it before this write is
    // validity-invariant UB, so write via `ptr::write` (NOT assignment — the
    // zeroed bytes are not a valid `Transpiler` to drop).
    //
    // PORT NOTE: `InitOptions` is the minimal-surface stub (no `args:
    // api::TransformOptions` yet), so pass `Default` and inline the body of
    // `configure_transform_options_for_bun_vm` (the `bun_jsc::config` module
    // is `#[cfg(any())]`-gated). Once the full `Options<'a>` un-gates, swap
    // `Default::default()` for `opts.args`.
    // SAFETY: `vm.log` was set to a fresh leaked `Box<Log>` by
    // `VirtualMachine::init` immediately before this hook fires.
    let log: *mut bun_logger::Log =
        unsafe { (*vm).log }.map(|p| p.as_ptr()).unwrap_or(ptr::null_mut());
    // `bun_bundler::Transpiler::init` is now public (transpiler.rs); its body
    // sub-gates the `BundleOptions::from_api` / `Resolver::init1` tail and
    // returns `Err(Error::TODO)` until those surface, so the `Err` arm below
    // is the live path for now. The `ptr::write` shape is load-bearing: do
    // not replace with `(*vm).transpiler = ...` (drops zeroed bytes → UB).
    {
        use bun_options_types::schema::api;
        let mut args = api::TransformOptions::default();
        // Inlined `configure_transform_options_for_bun_vm`:
        args.write = Some(false);
        args.resolve = Some(api::ResolveMode::Lazy);
        args.target = Some(api::Target::Bun);
        // PORT NOTE: Zig passed `bun.default_allocator`; the Rust struct
        // threads `&'a Arena` (`bumpalo::Bump`). The arena lives on
        // `RuntimeState` (boxed above) so `deinit_runtime_state` reclaims it
        // alongside `timer`/`entry_point` on Worker teardown. The `Box`
        // payload address is stable, so a `'static` borrow is sound for the
        // `Transpiler<'static>` field — both die in VM teardown
        // (`vm.transpiler` is never dropped; see `ptr::write` note below).
        // SAFETY: `state` is the unique freshly-boxed `RuntimeState`; the
        // inner `Box<Arena>` payload is heap-stable and outlives the
        // `Transpiler` (reclaimed in `deinit_runtime_state` after the VM —
        // and hence `vm.transpiler` — is done).
        let allocator: &'static bun_alloc::Arena =
            unsafe { &*(&*(*state).transpiler_arena as *const bun_alloc::Arena) };
        // TODO(b2): `env_loader_` — spec VirtualMachine.zig:1244 passes
        // `opts.env_loader` so a worker VM inherits its parent's
        // `DotEnv.Loader` (set at VirtualMachine.zig:1415/1513). The minimal
        // `InitOptions` stub (VirtualMachine.rs:78) has no `env_loader` field
        // yet; passing `None` silently falls back to `dot_env::instance()`.
        // Thread `_opts.env_loader` here once the stub widens.
        match bun_bundler::Transpiler::init(allocator, log, args, None) {
            Ok(transpiler) => {
                // SAFETY: `vm` is the unique freshly-boxed VM; `transpiler`
                // field is zero-init'd uninhabited memory (never dropped).
                unsafe { ptr::write(ptr::addr_of_mut!((*vm).transpiler), transpiler) };
            }
            Err(e) => {
                // Spec: `try Transpiler.init(...)` bubbles the error out of
                // `VirtualMachine.init`. The hook signature has no error
                // channel, so log + leave the field zeroed (validity-UB on
                // first read — same failure mode as before this hook existed).
                // TODO(b2): widen `init_runtime_state` return to `Result<_, Error>`.
                bun_core::Output::err("Transpiler", format_args!("init failed: {e:?}"));
            }
        }
    }

    // TODO(b2-cycle): `webcore::Body::Value::HiveAllocator::init()` — gated.
    // TODO(b2-cycle): `ParentDeathWatchdog::install_on_event_loop` — spec
    // VirtualMachine.zig:1316 `if (opts.is_main_thread)
    // bun.ParentDeathWatchdog.installOnEventLoop(jsc.EventLoopHandle.init(vm))`.
    // The low-tier `VirtualMachine::init` doc-comment delegates this here; not
    // arming it means a child Bun process won't exit when its parent dies.
    // Gate on `_opts.is_main_thread` once `bun_aio::parent_death_watchdog`
    // un-gates.
    // TODO(b2-cycle): `Debugger::configure(vm, opts.debugger)` — `Debugger.rs`
    // gated; spec VirtualMachine.zig:1321 `vm.configureDebugger(opts.debugger)`.

    state.cast()
}

/// Reclaim the per-VM [`RuntimeState`] boxed in [`init_runtime_state`]. Called
/// from `VirtualMachine::deinit` / worker `destroy()` with the opaque pointer
/// returned by `init_runtime_state`. Clears the thread-local and drops the
/// `Box`, freeing `timer` + `entry_point` (spec VirtualMachine.zig: value
/// fields freed in worker `destroy()`).
///
/// # Safety
/// `state` must be the exact pointer returned by [`init_runtime_state`] for
/// this thread (or null), and must not be used again after this call.
unsafe fn deinit_runtime_state(_vm: *mut VirtualMachine, state: OpaqueRuntimeState) {
    RUNTIME_STATE.with(|c| c.set(ptr::null_mut()));
    if state.is_null() {
        return;
    }
    // SAFETY: per fn contract — `state` is the unique `Box::into_raw` result
    // from `init_runtime_state`; the TLS was just cleared so no other live
    // alias exists on this thread.
    drop(unsafe { Box::from_raw(state.cast::<RuntimeState>()) });
}

/// `ServerEntryPoint.generate(watch, entry_path)` — produces the synthetic
/// `bun:main` wrapper. Returns `false` on error (the error is already logged
/// into `vm.log` by `generate`).
///
/// # Safety
/// `vm` is the live per-thread VM.
unsafe fn generate_entry_point(
    _vm: *mut VirtualMachine,
    watch: bool,
    entry_path: &[u8],
) -> bool {
    let state = runtime_state();
    if state.is_null() {
        return false;
    }
    // SAFETY: `state` is the live per-thread `RuntimeState` (boxed in
    // `init_runtime_state`); no other `&mut` to `entry_point` is held here.
    ServerEntryPoint::generate(unsafe { &mut (*state).entry_point }, watch, entry_path).is_ok()
}

/// `loadPreloads()` — runs `--preload` scripts. Returns the first rejected
/// preload promise if any, else null. Spec VirtualMachine.zig:2204-2280.
///
/// Errors bubble exactly like Zig's `try this.loadPreloads()` in
/// `reloadEntryPoint`: resolver `Failure` returns the resolver error,
/// `Pending`/`NotFound` returns `error.ModuleNotFound`,
/// `JSModuleLoader.import` throwing returns `error.JSError`.
///
/// # Safety
/// `vm` is the live per-thread VM.
unsafe fn load_preloads(
    vm: *mut VirtualMachine,
) -> Result<*mut JSInternalPromise, bun_core::Error> {
    // PORT NOTE: reshaped for borrowck — `wait_for_promise` / `event_loop().tick()`
    // need `&mut VirtualMachine` while we're also iterating `vm.preload` and
    // touching `vm.transpiler.resolver` / `vm.log`. Dereference per-field via
    // the raw `vm` ptr; iterate preloads by index (the `Box<[u8]>` payloads are
    // heap-stable so a raw `*const [u8]` survives the resolver borrow).

    // ── is_in_preload guard ─────────────────────────────────────────────
    // SAFETY: per fn contract — `vm` is the live per-thread VM.
    unsafe { (*vm).is_in_preload = true };
    let _preload_guard = scopeguard::guard((), |_| {
        // SAFETY: per fn contract.
        unsafe { (*vm).is_in_preload = false };
    });

    // SAFETY: `vm.global` is set during `VirtualMachine::init` and outlives the VM.
    let global: *mut JSGlobalObject = unsafe { (*vm).global };
    // ── guard: zeroed transpiler ────────────────────────────────────────
    // `init_runtime_state` swallows `Transpiler::init`'s `Err` (logs + leaves
    // `vm.transpiler` as zeroed bytes — see its `TODO(b2): widen return`).
    // Spec VirtualMachine.zig:1240 uses `try Transpiler.init(...)`, so
    // `loadPreloads` is unreachable with an invalid transpiler; in Rust we
    // must check `fs.is_null()` to avoid null-deref UB on `--preload` until
    // `Transpiler::init`'s gated tail un-gates and `init_runtime_state`'s
    // return widens to `Result`. Fail loudly (PORTING.md §Forbidden:
    // silent-no-op).
    // SAFETY: per fn contract — reading the raw ptr field itself is fine; only
    // the deref below would be UB on null.
    if unsafe { (*vm).transpiler.fs.is_null() } {
        bun_core::Output::err(
            "preload",
            format_args!("transpiler not initialized; ignoring --preload"),
        );
        return Ok(ptr::null_mut());
    }
    // SAFETY: `vm.transpiler.fs` points at the process-global `Fs::FileSystem`
    // singleton (transpiler.rs:66 — Zig used `Fs.FileSystem.instance`).
    let top_level_dir: *const [u8] = unsafe { (*(*vm).transpiler.fs).top_level_dir };
    // Spec VirtualMachine.zig:2213 — `if (this.standalone_module_graph == null)
    // .read_only else .disable`.
    // SAFETY: per fn contract.
    let global_cache = if unsafe { (*vm).standalone_module_graph.is_none() } {
        GlobalCache::read_only
    } else {
        GlobalCache::disable
    };

    // SAFETY: per fn contract.
    let n = unsafe { (*vm).preload.len() };
    for i in 0..n {
        // SAFETY: `i < n`; the `Box<[u8]>` allocation is stable across the
        // `resolve_and_auto_install` call below (which only touches
        // `vm.transpiler.resolver`, not `vm.preload`).
        let preload: *const [u8] = unsafe { &*(*vm).preload[i] };
        // Spec VirtualMachine.zig:1865 — `normalizeSource`: strip "file://".
        // SAFETY: `preload` points at a live boxed slice for this iteration.
        let normalized: &[u8] = {
            let s = unsafe { &*preload };
            s.strip_prefix(b"file://".as_slice()).unwrap_or(s)
        };

        // ── resolve ─────────────────────────────────────────────────────
        // SAFETY: per fn contract; `top_level_dir` is the `'static` fs
        // singleton field.
        let mut result = match unsafe {
            (*vm).transpiler.resolver.resolve_and_auto_install(
                &*top_level_dir,
                normalized,
                ImportKind::Stmt,
                global_cache,
            )
        } {
            ResolveResultUnion::Success(r) => r,
            ResolveResultUnion::Failure(e) => {
                // Spec VirtualMachine.zig:2216-2226 — `log.addErrorFmt` then
                // `return e`.
                // SAFETY: `vm.log` was set to a fresh leaked `Box<Log>` by
                // `VirtualMachine::init`.
                if let Some(log) = unsafe { (*vm).log } {
                    // SAFETY: `log` is the unique per-VM `Box<Log>`.
                    let _ = unsafe { &mut *log.as_ptr() }.add_error_fmt(
                        None,
                        bun_logger::Loc::EMPTY,
                        format_args!(
                            "{} resolving preload {}",
                            e.name(),
                            bun_core::fmt::format_json_string_latin1(unsafe { &*preload }),
                        ),
                    );
                }
                return Err(e);
            }
            ResolveResultUnion::Pending(_) | ResolveResultUnion::NotFound => {
                // Spec VirtualMachine.zig:2228-2238 — `log.addErrorFmt` then
                // `return error.ModuleNotFound`.
                // SAFETY: see above.
                if let Some(log) = unsafe { (*vm).log } {
                    // SAFETY: `log` is the unique per-VM `Box<Log>`.
                    let _ = unsafe { &mut *log.as_ptr() }.add_error_fmt(
                        None,
                        bun_logger::Loc::EMPTY,
                        format_args!(
                            "preload not found {}",
                            bun_core::fmt::format_json_string_latin1(unsafe { &*preload }),
                        ),
                    );
                }
                return Err(bun_core::err!("ModuleNotFound"));
            }
        };

        // ── import ──────────────────────────────────────────────────────
        // Spec VirtualMachine.zig:2241 —
        // `try JSModuleLoader.import(this.global, &String.fromBytes(result.path().?.text))`.
        let path_text = result
            .path()
            .expect("resolver Success result has a primary path")
            .text;
        let module_name = bun_string::String::from_bytes(path_text);
        // SAFETY: `global` is live for the VM lifetime.
        let promise: *mut JSInternalPromise =
            match JSModuleLoader::import(unsafe { &*global }, &module_name) {
                Ok(p) => p as *const JSInternalPromise as *mut JSInternalPromise,
                Err(_) => {
                    // Spec: `try` propagates `error.JSError`. The exception is
                    // already pending on `global`; bubble the tag so
                    // `reload_entry_point` forwards it like Zig's `try`.
                    return Err(bun_core::err!("JSError"));
                }
            };

        // SAFETY: per fn contract.
        unsafe { (*vm).pending_internal_promise = Some(promise) };
        JSValue::from_cell(promise).protect();
        let _protect_guard = scopeguard::guard((), move |_| {
            JSValue::from_cell(promise).unprotect();
        });

        // ── wait ────────────────────────────────────────────────────────
        // SAFETY: per fn contract.
        if unsafe { (*vm).is_watcher_enabled() } {
            // pending_internal_promise can change if hot module reloading is
            // enabled (spec VirtualMachine.zig:2248-2261).
            // SAFETY: `el` is the live per-thread event loop.
            let el = unsafe { (*vm).event_loop() };
            unsafe { (*el).perform_gc() };
            loop {
                // SAFETY: `pending_internal_promise` was set just above (or
                // swapped by HMR to another live cell); `status()` is a
                // read-only FFI call on a live JSC heap cell.
                let pip = unsafe { (*vm).pending_internal_promise }.unwrap_or(promise);
                if unsafe { (*pip).status() } != PromiseStatus::Pending {
                    break;
                }
                // SAFETY: `el` is the live per-thread event loop.
                unsafe { (*el).tick() };
                let pip = unsafe { (*vm).pending_internal_promise }.unwrap_or(promise);
                if unsafe { (*pip).status() } == PromiseStatus::Pending {
                    // SAFETY: per fn contract — short-lived `&mut *vm` for the
                    // dispatched `auto_tick` hook (same shape as
                    // `wait_for_promise` below).
                    unsafe { (*vm).auto_tick() };
                }
            }
        } else {
            // SAFETY: `el` is the live per-thread event loop.
            unsafe { (*(*vm).event_loop()).perform_gc() };
            // SAFETY: per fn contract — short-lived `&mut *vm`; `promise` is a
            // live protected JSC heap cell.
            unsafe { (*vm).wait_for_promise(AnyPromise::Internal(promise)) };
        }

        // SAFETY: `promise` is a live (still-protected) JSC heap cell.
        if unsafe { (*promise).status() } == PromiseStatus::Rejected {
            return Ok(promise);
        }
        // `_protect_guard` drops here → unprotect.
    }

    // Spec VirtualMachine.zig:2275-2278 — under --isolate each test file gets
    // a fresh global, so preloads must re-execute for every file. Otherwise,
    // only load preloads once.
    // SAFETY: per fn contract.
    if !unsafe { (*vm).test_isolation_enabled } {
        // PORT NOTE: Zig sets `this.preload.len = 0` (truncate without freeing
        // the backing allocation). `Vec::clear` matches — drops the `Box<[u8]>`
        // payloads but keeps capacity.
        unsafe { (*vm).preload.clear() };
    }

    Ok(ptr::null_mut())
}

/// `ensureDebugger(block_until_connected)` — no-op when no debugger.
///
/// # Safety
/// `vm` is the live per-thread VM.
unsafe fn ensure_debugger(vm: *mut VirtualMachine, _block_until_connected: bool) {
    // Spec VirtualMachine.zig:2283-2290: when `vm.debugger != null`, call
    // `jsc.Debugger.create(this, this.global)` and (if `block_until_connected`)
    // `Debugger.waitForDebuggerIfNecessary(this)`. Silently continuing when a
    // debugger IS configured would let execution proceed without ever attaching
    // (PORTING.md §Forbidden: silent-no-op). Fail loudly on the
    // debugger-present branch until `Debugger.rs` un-gates.
    // SAFETY: `vm` is the live per-thread VM.
    if unsafe { (*vm).debugger.is_some() } {
        todo!("jsc_hooks: ensure_debugger")
    }
}

/// `eventLoop().autoTick()` — port of the `_auto_tick_body` preserved in
/// `bun_jsc::event_loop` (the gated `#[cfg(any())]` block). Needs
/// `timer::All` for the poll-timeout calculation, hence dispatched here.
///
/// PERF(port): was inline switch — Zig calls `vm.timer.getTimeout` directly;
/// the one fn-ptr indirection is dwarfed by the kqueue/epoll syscall it gates.
///
/// # Safety
/// `vm` is the live per-thread VM.
unsafe fn auto_tick(vm: *mut VirtualMachine) {
    // PORT NOTE: reshaped for borrowck — `EventLoop` is a value field of
    // `VirtualMachine`, so holding `&mut EventLoop` while also touching VM
    // siblings would alias. Dereference per-field via the raw `vm` ptr.
    // SAFETY: per fn contract — `vm` is the live per-thread VM.
    let el: *mut bun_jsc::event_loop::EventLoop = unsafe { (*vm).event_loop };
    let loop_ = unsafe { (*el).usockets_loop() };

    // ── tick_immediate_tasks ────────────────────────────────────────────
    // Spec event_loop.zig:368-376. The swap + drain loop is now un-gated in
    // `bun_jsc::event_loop` (per-task body dispatched via `RUN_IMMEDIATE_HOOK`),
    // so `immediate_tasks` after this call reflects next-tick immediates and
    // the `has_pending_immediate` read below is correct.
    // SAFETY: `el` is the live per-thread event loop; `vm` per fn contract.
    unsafe { (*el).tick_immediate_tasks(vm) };
    #[cfg(windows)]
    if !unsafe { &*el }.immediate_tasks.is_empty() {
        // SAFETY: `el` is the live per-thread event loop.
        unsafe { (*el).wakeup() };
    }

    // ── pending unref ───────────────────────────────────────────────────
    #[cfg(unix)]
    {
        // SAFETY: per fn contract.
        let pending_unref = unsafe { (*vm).pending_unref_counter };
        if pending_unref > 0 {
            unsafe { (*vm).pending_unref_counter = 0 };
            // SAFETY: `loop_` is the live per-thread uws loop.
            unsafe { (*loop_).unref_count(pending_unref) };
        }
    }

    // ── DateHeaderTimer / imminent-GC ───────────────────────────────────
    // TODO(b2-cycle): `timer::All::update_date_header_timer_if_necessary` —
    // not yet on the B-2 `All` surface (only insert/remove/update/get_timeout/
    // drain_timers are real). No-op until the DateHeaderTimer body un-gates.
    // SAFETY: `el` is the live per-thread event loop.
    unsafe { (*el).run_imminent_gc_timer() };

    // ── poll the I/O loop with the next-timer deadline ──────────────────
    let state = runtime_state();
    if state.is_null() {
        // No high-tier state (unit test) — fall back to a non-blocking I/O
        // poll. Spec event_loop.zig:398-413 always polls the uws loop
        // (`tickWithTimeout`/`tickWithoutIdle`); `EventLoop::tick()` would only
        // drain JS tasks and never touch kqueue/epoll.
        // SAFETY: `loop_` is the live per-thread uws loop.
        unsafe { (*loop_).tick_without_idle() };
        // Spec event_loop.zig:419-420 — still run the post-poll hooks.
        // SAFETY: per fn contract.
        unsafe { (*vm).on_after_event_loop() };
        // SAFETY: `vm.global` is set during `VirtualMachine::init` and outlives the VM.
        unsafe { (*(*vm).global).handle_rejected_promises() };
        return;
    }

    // Spec event_loop.zig:398-403 calls `ctx.timer.getTimeout(..)` ONLY inside
    // `if (loop.isActive())` — `get_timeout` has side effects (pops + fires
    // due `WTFTimer` heap entries), so it must stay guarded by `is_active()`
    // rather than running unconditionally.
    {
        // Spec Timer.zig:251-256 reads `immediate_tasks.items.len` AFTER
        // `tickImmediateTasks` swaps `next_immediate_tasks` in, so this
        // reflects next-tick immediates (queued during the drain above).
        // SAFETY: `el` is the live per-thread event loop.
        let has_pending_immediate = !unsafe { &*el }.immediate_tasks.is_empty();
        // Spec Timer.zig:261-268: fold the QUIC deadline into the poll timeout.
        // SAFETY: `loop_` is the live per-thread uws loop.
        let quic_next_tick_us = unsafe {
            let ild = &(*loop_).internal_loop_data;
            if ild.quic_head.is_null() { None } else { Some(ild.quic_next_tick_us) }
        };
        let mut timespec = bun_core::Timespec { sec: 0, nsec: 0 };
        // SAFETY: `loop_` is the live per-thread uws loop.
        if unsafe { (*loop_).is_active() } {
            // SAFETY: `el` is the live per-thread event loop.
            unsafe { (*el).process_gc_timer() };
            // PORT NOTE (§Forbidden aliased-&mut): `get_timeout` may fire a
            // `WTFTimer` JS callback (spec Timer.zig:281 `min.fire(&now, vm)`).
            // A re-entrant `setTimeout`/`clearTimeout` reaches
            // `timer::All::insert`/`remove` via `runtime_state()` and would
            // mint a second `&mut timer` if we held `&mut (*state).timer`
            // across the call. Pass the raw `*mut Self` instead;
            // `timer::All::get_timeout` forms short-lived `&mut` only around
            // heap ops that cannot re-enter JS, releasing the borrow before
            // invoking `fire()`.
            // SAFETY: `state` is the live per-thread `RuntimeState`; the
            // `timer` field address is stable for the VM lifetime.
            let have_timeout = unsafe {
                timer::All::get_timeout(
                    ptr::addr_of_mut!((*state).timer),
                    &mut timespec,
                    has_pending_immediate,
                    quic_next_tick_us,
                    vm.cast(),
                )
            };
            // PORT NOTE: `bun_core::Timespec` and `bun_uws::Timespec` are
            // distinct nominal types but layout-identical (`#[repr(C)]
            // {sec: i64, nsec: i64}`, both mirroring `bun.timespec`). The C
            // ABI only sees `*const timespec`, so re-express the value for
            // `tick_with_timeout`. Same shape as SpawnSyncEventLoop.
            let uws_ts = bun_uws::Timespec { sec: timespec.sec, nsec: timespec.nsec };
            // SAFETY: `loop_` is the live per-thread uws loop.
            unsafe {
                (*loop_).tick_with_timeout(if have_timeout { Some(&uws_ts) } else { None })
            };
        } else {
            // SAFETY: `loop_` is the live per-thread uws loop.
            unsafe { (*loop_).tick_without_idle() };
        }
    }

    #[cfg(unix)]
    {
        // PORT NOTE (§Forbidden aliased-&mut): `drain_timers` fires user
        // `setTimeout` callbacks which may re-enter `timer::All::insert`/
        // `remove` via `runtime_state()`. Pass raw `*mut Self` so no
        // long-lived `&mut (*state).timer` is held across `fire()`;
        // `drain_timers` forms short-lived `&mut` only around heap pop/peek.
        // SAFETY: `state` is the live per-thread `RuntimeState`; the `timer`
        // field address is stable for the VM lifetime.
        unsafe { timer::All::drain_timers(ptr::addr_of_mut!((*state).timer), vm.cast()) };
    }
    #[cfg(not(unix))]
    let _ = state;

    // SAFETY: per fn contract.
    unsafe { (*vm).on_after_event_loop() };
    // SAFETY: `vm.global` is set during `VirtualMachine::init` and outlives the VM.
    unsafe { (*(*vm).global).handle_rejected_promises() };
}

/// The static `RuntimeHooks` instance handed to `bun_jsc`.
pub static RUNTIME_HOOKS_INSTANCE: RuntimeHooks = RuntimeHooks {
    init_runtime_state,
    deinit_runtime_state,
    generate_entry_point,
    load_preloads,
    ensure_debugger,
    auto_tick,
};

// ════════════════════════════════════════════════════════════════════════════
// LoaderHooks bodies
// ════════════════════════════════════════════════════════════════════════════

/// `bun.String.createIfDifferent` — `clone_utf8(other)` unless `other` is
/// byte-equal to `s`, in which case bump `s`'s refcount instead.
///
/// PORT NOTE: lives here (not `bun_string`) because the canonical impl is in
/// the gated `lib_draft_b1.rs`; remove once that un-gates.
#[inline]
fn create_if_different(s: &bun_string::String, other: &[u8]) -> bun_string::String {
    if s.eql_utf8(other) {
        return s.dupe_ref();
    }
    bun_string::String::clone_utf8(other)
}

/// `ModuleLoader.transpileSourceCode(...)` — the runtime-transpiler path.
/// Port of `src/jsc/ModuleLoader.zig:85-826`: read file → `Transpiler::parse`
/// → `js_printer::print` → `ResolvedSource`.
///
/// # Safety
/// `jsc_vm` is the live per-thread VM; `ret` is a valid out-param;
/// `args.extra`, when non-null, points at a live [`TranspileExtra`].
unsafe fn transpile_source_code(
    jsc_vm: *mut VirtualMachine,
    args: &TranspileArgs<'_>,
    ret: *mut ErrorableResolvedSource,
) -> bool {
    // ── Recover (path, loader, module_type, printer) ────────────────────────
    // PORT NOTE: Zig took these as positional params; the §Dispatch shim packs
    // them into `args.extra`. When null (low-tier `Bun__*` shim entry), the
    // hook recomputes from `specifier` — that path is owned by `transpile_file`
    // and not exercised here, so a null `extra` is a hard error.
    let extra = args.extra.cast::<TranspileExtra>();
    if extra.is_null() {
        // SAFETY: per fn contract — `ret` is a valid out-param.
        unsafe {
            *ret = ErrorableResolvedSource::err(
                bun_core::err!("MissingTranspileExtra"),
                JSValue::UNDEFINED,
            );
        }
        return false;
    }
    match transpile_source_code_inner(jsc_vm, args, extra) {
        Ok(resolved) => {
            // SAFETY: per fn contract.
            unsafe { *ret = ErrorableResolvedSource::ok(resolved) };
            // PORT NOTE: spec calls `resetArena` only on the `Bun__transpileFile`
            // path, never inside `transpileSourceCode` itself — the
            // `transpile_file` hook owns that. Do NOT reset here.
            true
        }
        Err(e) => {
            // PORT NOTE: spec ModuleLoader.zig — on `error.ParseError` /
            // `error.AsyncModule` the caller (`Bun__transpileFile`) catches and
            // routes through `processFetchLog`. Mirror that: write `.err` so the
            // low tier surfaces it; `process_fetch_log` is invoked by the
            // `transpile_file` hook, not here.
            // SAFETY: per fn contract.
            unsafe { *ret = ErrorableResolvedSource::err(e, JSValue::UNDEFINED) };
            false
        }
    }
}

/// Inner body of [`transpile_source_code`] — split so the `?`-on-`Result`
/// flow matches Zig's `try`/`!ResolvedSource` shape (ModuleLoader.zig:99).
///
/// PORT NOTE: takes `*mut VirtualMachine` (NOT `&mut`) — the body re-enters
/// `vm.transpiler` while also touching `vm.module_loader` / `vm.bun_watcher`,
/// which would alias under `&mut` (PORTING.md §Forbidden). Per-field deref via
/// the raw ptr, mirroring `auto_tick` above.
#[allow(unused_variables, unused_mut, unreachable_code)]
fn transpile_source_code_inner(
    jsc_vm: *mut VirtualMachine,
    args: &TranspileArgs<'_>,
    extra: *mut TranspileExtra,
) -> Result<ResolvedSource, bun_core::Error> {
    use Loader as L;

    // SAFETY: per fn contract — `extra` is a live `TranspileExtra` for the call.
    // PORT NOTE: raw-ptr (not `&mut`) so the recursive `.wasm` arm can mutate
    // `extra.loader` and re-enter without borrowck seeing aliased `&mut`.
    let path: &Fs::Path = unsafe { &(*extra).path };
    let loader: Loader = unsafe { (*extra).loader };
    let module_type: ModuleType = unsafe { (*extra).module_type };

    let disable_transpilying = args.flags.disable_transpiling();
    let specifier = args.specifier;
    let referrer = args.referrer;
    let input_specifier = &args.input_specifier;
    let global_object = args.global_object;

    // ── disable_transpiling fast-path for non-JS-like loaders ───────────────
    // Spec ModuleLoader.zig:102-112.
    if disable_transpilying
        && !(loader.is_java_script_like()
            || matches!(
                loader,
                L::Toml | L::Yaml | L::Json5 | L::Text | L::Json | L::Jsonc
            ))
    {
        return Ok(ResolvedSource {
            source_code: bun_string::String::empty(),
            specifier: input_specifier.dupe_ref(),
            source_url: create_if_different(input_specifier, path.text),
            ..Default::default()
        });
    }

    match loader {
        // ────────────────────────────────────────────────────────────────────
        // JS-like + JSON/TOML/YAML/text/md — the parse→print path.
        // Spec ModuleLoader.zig:115-593.
        // ────────────────────────────────────────────────────────────────────
        L::Js | L::Jsx | L::Ts | L::Tsx | L::Json | L::Jsonc | L::Toml | L::Yaml | L::Json5
        | L::Text | L::Md => {
            // TODO(b2-blocked): `js_ast::ASTMemoryAllocator::Scope` — gated in
            // `bun_js_parser`. Spec :117-119.
            #[cfg(any())]
            let _ast_scope = bun_js_parser::ASTMemoryAllocator::Scope::enter();

            // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
            unsafe { (*jsc_vm).transpiled_count += 1 };
            // TODO(b2-blocked): `Transpiler::reset_store` — gated in
            // `bun_bundler::transpiler::__phase_a_draft`. Spec :122.
            #[cfg(any())]
            unsafe { (*jsc_vm).transpiler.reset_store() };

            let hash = bun_watcher::Watcher::get_hash(path.text);
            // SAFETY: per fn contract.
            let (main, main_hash) = unsafe { ((*jsc_vm).main, (*jsc_vm).main_hash) };
            let is_main =
                main.len() == path.text.len() && main_hash == hash && main == path.text;

            // ── Arena take/give-back ────────────────────────────────────────
            // Spec :128-165. Reuse the per-VM arena when free; allocate a
            // fresh boxed one otherwise. `give_back_arena` is cleared on the
            // ParseError / AsyncModule paths (which hand the arena to the
            // async queue or leak it intentionally for the caller to inspect).
            // SAFETY: per fn contract.
            let mut arena: Box<bun_alloc::Arena> = unsafe {
                (*jsc_vm).module_loader.transpile_source_code_arena.take()
            }
            .unwrap_or_else(|| Box::new(bun_alloc::Arena::new()));
            let mut give_back_arena = true;
            // PORT NOTE: reshaped for borrowck — Zig's `defer` block becomes a
            // scopeguard so `?`-early-returns still run it.
            let mut arena_guard = scopeguard::guard(
                (jsc_vm, arena, give_back_arena, args.flags),
                |(jsc_vm, mut arena, give_back, flags)| {
                    if !give_back {
                        // Spec :146-165 — when `give_back_arena == false` the
                        // Zig `defer` is a no-op because ownership was already
                        // transferred (to the AsyncModule queue, or held past
                        // `processFetchLog` so log spans pointing into it stay
                        // valid). In this port the hand-off paths are
                        // `#[cfg(any())]`-gated, so no transfer happens and
                        // `mem::forget` would be a pure leak (PORTING.md
                        // §Forbidden). Drop (free) instead.
                        // TODO(b2-cycle): once AsyncModule / processFetchLog
                        // un-gate, the hand-off sites must call
                        // `scopeguard::ScopeGuard::into_inner(arena_guard)` and
                        // move the `Box<Arena>` to the consumer instead of
                        // flipping `give_back` and reaching here.
                        drop(arena);
                        return;
                    }
                    // SAFETY: `jsc_vm` is the live per-thread VM (closure runs
                    // on the same thread, before the hook returns).
                    let slot = unsafe {
                        &mut (*jsc_vm).module_loader.transpile_source_code_arena
                    };
                    if slot.is_none() {
                        if flags != FetchFlags::PrintSource {
                            // PERF(port): Zig `.retain_with_limit(8M)` — bumpalo
                            // has only `.reset()` (free-all). Profile in Phase B.
                            arena.reset();
                        }
                        *slot = Some(arena);
                    }
                    // else: drop the fresh Box (spec :161-163).
                },
            );
            // ── Watcher fd / package_json lookup ────────────────────────────
            // Spec :170-176.
            // TODO(b2-cycle): `vm.bun_watcher` is `*mut c_void` (ImportWatcher
            // gated). `index_of` / `watchlist()` un-gate with `hot_reloader.rs`.
            let mut fd: Option<bun_sys::Fd> = None;
            #[allow(unused)]
            let mut package_json: Option<*mut c_void> = None;
            #[cfg(any())]
            unsafe {
                if let Some(index) = (*jsc_vm).bun_watcher.index_of(hash) {
                    fd = (*jsc_vm).bun_watcher.watchlist().items_fd()[index].unwrap_valid();
                    package_json = (*jsc_vm).bun_watcher.watchlist().items_package_json()[index];
                }
            }

            // ── RuntimeTranspilerCache ──────────────────────────────────────
            // Spec :178-182.
            // PORT NOTE: Zig threaded `output_code_allocator = arena.allocator()`,
            // `sourcemap_allocator = default_allocator`, `esm_record_allocator =
            // default_allocator`. The bundler-side `cache::RuntimeTranspilerCache`
            // dropped those fields per PORTING.md §Allocators (cache buffers use
            // global mimalloc), so `Default::default()` matches.
            let mut cache = bun_bundler::cache::RuntimeTranspilerCache::default();

            // ── Swap `vm.transpiler.log` (and linker/resolver/pm logs) ──────
            // Spec :184-199.
            // TODO(b2-cycle): `vm.transpiler` is never initialized by
            // `VirtualMachine::init` / `init_runtime_state` yet (zero-bit-
            // pattern `Transpiler<'static>` — validity-invariant UB on first
            // read). Gate the live read/write until `init_runtime_state`
            // writes a real `Transpiler`.
            #[cfg(any())]
            let old_log = unsafe { (*jsc_vm).transpiler.log };
            #[cfg(any())]
            unsafe {
                (*jsc_vm).transpiler.log = args.log;
                // TODO(port): lifetime — `Resolver.log` is `&'static mut Log`
                // (Transpiler<'static>); `args.log` is `*mut Log`. Spec aliases
                // freely; Rust would need `Resolver.log: *mut Log` first.
                #[cfg(any())]
                {
                    (*jsc_vm).transpiler.resolver.log = args.log;
                }
                // TODO(b2-blocked): `Linker` is a unit stub in `bun_bundler`
                // — `.log` field un-gates with `linker.rs`.
                #[cfg(any())]
                {
                    (*jsc_vm).transpiler.linker.log = args.log;
                    if let Some(pm) = (*jsc_vm).transpiler.resolver.package_manager {
                        (*pm).log = args.log;
                    }
                }
            }
            #[cfg(any())]
            let _log_guard = scopeguard::guard(jsc_vm, move |jsc_vm| unsafe {
                (*jsc_vm).transpiler.log = old_log;
                #[cfg(any())]
                {
                    (*jsc_vm).transpiler.resolver.log = old_log;
                    (*jsc_vm).transpiler.linker.log = old_log;
                    if let Some(pm) = (*jsc_vm).transpiler.resolver.package_manager {
                        (*pm).log = old_log;
                    }
                }
            });

            // Spec :202.
            let is_node_override = specifier.starts_with(node_fallbacks::IMPORT_PATH);

            // Spec :204-207.
            // SAFETY: per fn contract.
            let (macro_mode, has_any_macro_remappings) =
                unsafe { ((*jsc_vm).macro_mode, (*jsc_vm).has_any_macro_remappings) };
            let macro_remappings = if macro_mode || !has_any_macro_remappings || is_node_override
            {
                bun_resolver::package_json::MacroMap::default()
            } else {
                // TODO(b2-cycle): `vm.transpiler` is uninitialized (see log-swap
                // note above) — reading `options.macro_remap` would be UB. Gate
                // until `init_runtime_state` writes a real `Transpiler`.
                #[cfg(any())]
                {
                    // SAFETY: per fn contract.
                    // TODO(port): `MacroMap` may not be `Clone`; spec passes by
                    // value (Zig copies the struct). If `MacroMap` is by-ref only,
                    // change `ParseOptions::macro_remappings` to `&MacroMap`.
                    unsafe { (*jsc_vm).transpiler.options.macro_remap.clone() }
                }
                #[cfg(not(any()))]
                bun_resolver::package_json::MacroMap::default()
            };

            // Spec :211-215.
            let mut should_close_input_file_fd = fd.is_none();

            // Spec :218-222 — only JS-like loaders get the cjs/esm wrapper hint.
            let module_type_only_for_wrappables = match loader {
                L::Js | L::Jsx | L::Ts | L::Tsx => module_type,
                _ => ModuleType::Unknown,
            };

            let mut input_file_fd = bun_sys::Fd::INVALID;
            // Spec :251-256 `defer { if (should_close_input_file_fd and
            // input_file_fd != .invalid) input_file_fd.close(); }` — this
            // `defer` is unconditional in Zig (independent of `give_back_arena`)
            // and must fire on every exit path: parse failure, JSON early
            // return, `disable_transpilying`, already_bundled, empty `.cjs`,
            // cache-hit, AsyncModule, the wasm recurse, and the print error.
            // PORT NOTE: reshaped for borrowck — capture raw pointers so the
            // guard does not alias the later `&mut input_file_fd`
            // (`file_fd_ptr`) / `&mut should_close_input_file_fd`
            // (`maybe_watch_file`) borrows.
            let should_close_ptr: *mut bool = &mut should_close_input_file_fd;
            let input_file_fd_ptr: *mut bun_sys::Fd = &mut input_file_fd;
            let _fd_guard = scopeguard::guard((), move |_| {
                // SAFETY: `should_close_input_file_fd` / `input_file_fd` are
                // declared earlier in this stack frame and outlive `_fd_guard`
                // (locals drop in reverse declaration order); the guard runs on
                // the same thread before either is destroyed.
                unsafe {
                    if *should_close_ptr && (*input_file_fd_ptr).is_valid() {
                        use bun_sys::FdExt as _;
                        (*input_file_fd_ptr).close();
                        *input_file_fd_ptr = bun_sys::Fd::INVALID;
                    }
                }
            });

            // ── Node-fallback virtual source ────────────────────────────────
            // Spec :258-264.
            let mut fallback_source: bun_logger::Source;
            let mut virtual_source = args.virtual_source;
            if is_node_override {
                if let Some(code) = node_fallbacks::contents_from_path(specifier) {
                    // TODO(port): lifetime — `Fs::Path::init` wants `'static`;
                    // `specifier` is `&'a [u8]`. Spec stores the `Path` in a
                    // stack `logger::Source`, so the borrow is sound for the
                    // call. Un-gate once `Fs::Path<'a>` lands.
                    #[cfg(any())]
                    {
                        let fallback_path = Fs::Path::init_with_namespace(specifier, b"node");
                        fallback_source = bun_logger::Source {
                            path: fallback_path,
                            contents: code,
                            ..Default::default()
                        };
                        virtual_source = Some(&fallback_source);
                    }
                    let _ = code;
                }
            }

            // ════════════════════════════════════════════════════════════════
            // Transpiler::parse — the read-file step happens inside
            // `parse_maybe_return_file_only` (it opens `path` itself when
            // `virtual_source` is `None`). Spec :225-297.
            // ════════════════════════════════════════════════════════════════
            {
                use bun_bundler::transpiler::{ParseOptions, ParseResult, AlreadyBundled};
                use bun_bundler::cache::RuntimeTranspilerCache;
                use bun_jsc::resolved_source::Tag as ResolvedSourceTag;

                // TODO(b2-cycle): `Debugger::set_breakpoint_on_first_line` +
                // `runtime_transpiler_store::set_break_point_on_first_line` —
                // gated; spec gates on `vm.debugger != null && debugger.set_...`.
                let set_breakpoint_on_first_line = false;
                let _ = is_main;

                // PORT NOTE: `ParseOptions::path` is `bun_logger::fs::Path`
                // (the `'static`-slice flavour used by `logger::Source`), but
                // `path` here is `bun_resolver::fs::Path<'_>`. The two structs
                // are field-identical; the resolver-side slices are interned in
                // `'static` BSSStringList stores (see resolver/lib.rs
                // `dirname_store`/`filename_store`), so the lifetime extension
                // is sound. Phase-B collapses both `Path` defs into one type.
                // SAFETY: see PORT NOTE — `path.text` / `.namespace` / `.pretty`
                // borrow `'static` interned storage.
                let parse_path = unsafe {
                    bun_logger::fs::Path {
                        pretty: core::mem::transmute::<&[u8], &'static [u8]>(path.pretty),
                        text: core::mem::transmute::<&[u8], &'static [u8]>(path.text),
                        namespace: core::mem::transmute::<&[u8], &'static [u8]>(path.namespace),
                        name: bun_logger::fs::PathName::init(core::mem::transmute::<
                            &[u8],
                            &'static [u8],
                        >(path.text)),
                        is_disabled: path.is_disabled,
                        is_symlink: path.is_symlink,
                    }
                };
                let parse_options = ParseOptions {
                    allocator: &arena_guard.1,
                    path: parse_path,
                    loader,
                    dirname_fd: bun_sys::Fd::INVALID,
                    file_descriptor: fd,
                    file_fd_ptr: Some(&mut input_file_fd),
                    file_hash: Some(hash),
                    macro_remappings,
                    jsx: unsafe { (*jsc_vm).transpiler.options.jsx.clone() },
                    emit_decorator_metadata: unsafe {
                        (*jsc_vm).transpiler.options.emit_decorator_metadata
                    },
                    experimental_decorators: unsafe {
                        (*jsc_vm).transpiler.options.experimental_decorators
                    },
                    virtual_source,
                    dont_bundle_twice: true,
                    allow_commonjs: true,
                    module_type: module_type_only_for_wrappables,
                    inject_jest_globals: unsafe {
                        (*jsc_vm).transpiler.options.rewrite_jest_for_tests
                    },
                    keep_json_and_toml_as_one_statement: true,
                    allow_bytecode_cache: true,
                    set_breakpoint_on_first_line,
                    runtime_transpiler_cache: if !disable_transpilying
                        && !RuntimeTranspilerCache::disabled()
                    {
                        Some(&mut cache)
                    } else {
                        None
                    },
                    // TODO(b2-cycle): `vm.module_loader.eval_source` — field
                    // not surfaced on `ModuleLoader` yet. Spec :247.
                    remove_cjs_module_wrapper: false,
                    macro_js_ctx: core::ptr::null_mut(),
                    replace_exports: Default::default(),
                };

                // PORT NOTE: spec uses `comptime switch (disable_transpilying or
                // loader == .json)` to monomorphize; both arms hit the same
                // `parse_maybe_return_file_only_allow_shared_buffer` body, so
                // dispatch at runtime via the const-generic bool.
                let return_file_only = disable_transpilying || loader == L::Json;
                let parse_result: Option<ParseResult> = if return_file_only {
                    unsafe {
                        (*jsc_vm)
                            .transpiler
                            .parse_maybe_return_file_only::<true>(parse_options, None)
                    }
                } else {
                    unsafe {
                        (*jsc_vm)
                            .transpiler
                            .parse_maybe_return_file_only::<false>(parse_options, None)
                    }
                };

                let Some(mut parse_result) = parse_result else {
                    // Spec :273-295 — register with watcher even on parse failure.
                    if !disable_transpilying {
                        maybe_watch_file(
                            jsc_vm,
                            &mut should_close_input_file_fd,
                            input_file_fd,
                            is_node_override,
                            path,
                            hash,
                            loader,
                            package_json,
                        );
                    }
                    arena_guard.2 = false; // give_back_arena = false
                    return Err(bun_core::err!("ParseError"));
                };

                // Spec :301-317 — `.wasm` discovered post-parse: recurse with
                // the parsed source as virtual.
                if parse_result.loader == L::Wasm {
                    unsafe {
                        (*extra).loader = L::Wasm;
                        (*extra).module_type = ModuleType::Unknown;
                    }
                    // PORT NOTE: reshaped — spec passes `&parse_result.source`
                    // as `virtual_source`; we re-enter via the hook with a
                    // patched `TranspileArgs`. `TranspileArgs` is not `Copy`
                    // (`input_specifier: bun.String`), so rebuild field-wise
                    // with a `dupe_ref` instead of `..*args`.
                    return transpile_source_code_inner(
                        jsc_vm,
                        &TranspileArgs {
                            specifier: args.specifier,
                            referrer: args.referrer,
                            input_specifier: args.input_specifier.dupe_ref(),
                            log: args.log,
                            virtual_source: Some(&parse_result.source),
                            global_object: args.global_object,
                            flags: args.flags,
                            extra: args.extra,
                        },
                        extra,
                    );
                }

                // Spec :319-336 — register with watcher on success too.
                if !disable_transpilying {
                    maybe_watch_file(
                        jsc_vm,
                        &mut should_close_input_file_fd,
                        input_file_fd,
                        is_node_override,
                        path,
                        hash,
                        loader,
                        package_json,
                    );
                }

                // Spec :338-341.
                if unsafe { (*(*jsc_vm).transpiler.log).errors > 0 } {
                    arena_guard.2 = false;
                    return Err(bun_core::err!("ParseError"));
                }

                let source = &parse_result.source;

                // Spec :343-351 — raw JSON: hand the source bytes straight to JSC.
                if loader == L::Json {
                    return Ok(ResolvedSource {
                        source_code: bun_string::String::clone_utf8(source.contents),
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        tag: ResolvedSourceTag::JsonForObjectLoader,
                        ..Default::default()
                    });
                }

                // Spec :353-364 — disable_transpiling: return raw source.
                if disable_transpilying {
                    let source_code = match args.flags {
                        FetchFlags::PrintSourceAndClone => {
                            bun_string::String::clone_utf8(source.contents)
                        }
                        FetchFlags::PrintSource => {
                            bun_string::String::borrow_utf8(source.contents)
                        }
                        FetchFlags::Transpile => unreachable!(),
                    };
                    return Ok(ResolvedSource {
                        source_code,
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        ..Default::default()
                    });
                }

                // Spec :366-384 — JSON/TOML/YAML/JSON5: export as a JS object.
                // TODO(b2-blocked): `Expr::to_js` — gated in `bun_js_parser`
                // (`ast.parts.at(0).stmts[0].data.s_expr.value.to_js(...)`).
                // Until that surfaces, fall through to the print path so the
                // JSON/TOML body is emitted as JS source instead of a direct
                // JSValue. This is the same behaviour as `Bun.Transpiler`
                // (which also routes JSON through the printer).
                #[cfg(any())]
                if matches!(loader, L::Json | L::Jsonc | L::Toml | L::Yaml | L::Json5) {
                    let jsvalue_for_export = if parse_result.empty {
                        JSValue::create_empty_object(unsafe { &*(*jsc_vm).global }, 0)
                    } else {
                        parse_result.ast.parts.at(0).stmts[0]
                            .data
                            .s_expr
                            .value
                            .to_js(&arena_guard.1, unsafe { &*(*jsc_vm).global })?
                    };
                    return Ok(ResolvedSource {
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        jsvalue_for_export,
                        tag: ResolvedSourceTag::ExportsObject,
                        ..Default::default()
                    });
                }

                // Spec :386-398 — already-bundled (bytecode cache hit).
                if !matches!(parse_result.already_bundled, AlreadyBundled::None) {
                    let bytecode_slice = parse_result.already_bundled.bytecode_slice();
                    return Ok(ResolvedSource {
                        source_code: bun_string::String::clone_latin1(source.contents),
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        already_bundled: true,
                        bytecode_cache: if bytecode_slice.is_empty() {
                            core::ptr::null_mut()
                        } else {
                            bytecode_slice.as_ptr().cast_mut()
                        },
                        bytecode_cache_size: bytecode_slice.len(),
                        is_commonjs_module: parse_result.already_bundled.is_common_js(),
                        ..Default::default()
                    });
                }

                // Spec :400-415 — empty .cjs/.cts: synthetic `(function(){})`.
                if parse_result.empty && matches!(loader, L::Js | L::Ts) {
                    let ext = bun_paths::extension(source.path.text);
                    if ext == b".cjs" || ext == b".cts" {
                        return Ok(ResolvedSource {
                            source_code: bun_string::String::static_(b"(function(){})"),
                            specifier: input_specifier.dupe_ref(),
                            source_url: create_if_different(input_specifier, path.text),
                            is_commonjs_module: true,
                            tag: ResolvedSourceTag::Javascript,
                            ..Default::default()
                        });
                    }
                }

                // Spec :417-466 — RuntimeTranspilerCache hit: skip print.
                if let Some(entry) = cache.entry.as_mut() {
                    // TODO(b2-blocked): `SavedSourceMap::put_mappings` +
                    // `ModuleInfoDeserialized::create_from_cached_record`.
                    // PORT NOTE: bundler-side `Entry::output_code` is a flat
                    // `Box<[u8]>` (the `OutputCode::{String,Utf8}` enum lives
                    // on the T6 `bun_jsc::RuntimeTranspilerCache` mirror).
                    // Spec dispatches on `entry.metadata.output_encoding` to
                    // pick latin1 vs utf8; mirror that here.
                    let source_code = if entry.metadata.output_encoding
                        == bun_js_parser::ExportsKind::None as u8
                    {
                        // encoding == .none unreachable per spec :430; clone as
                        // latin1 (lossless byte → WTFString).
                        bun_string::String::clone_latin1(&entry.output_code)
                    } else {
                        bun_string::String::clone_utf8(&entry.output_code)
                    };
                    // PORT NOTE: spec frees via `cache.output_code_allocator`;
                    // `Box<[u8]>` drops on its own.
                    entry.output_code = Box::default();
                    // PORT NOTE: `entry.metadata.module_type` encodes the
                    // on-disk cache enum (`RuntimeTranspilerCache.ModuleType`:
                    // none=0, esm=1, cjs=2 — RuntimeTranspilerCache.zig:399),
                    // NOT `bun_bundler::options::ModuleType` (Unknown=0, Cjs=1,
                    // Esm=2). Spec ModuleLoader.zig:446 compares against the
                    // cache enum's `.cjs` (= 2).
                    const CACHE_MODULE_TYPE_CJS: u8 = 2;
                    return Ok(ResolvedSource {
                        source_code,
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        is_commonjs_module: entry.metadata.module_type
                            == CACHE_MODULE_TYPE_CJS,
                        // TODO(b2-blocked): `module_info` + `tag` package_json probe (:448-464).
                        tag: ResolvedSourceTag::Javascript,
                        ..Default::default()
                    });
                }

                // Spec :468-479 — link import records.
                let start_count = unsafe { (*jsc_vm).transpiler.linker.import_counter };
                // PORT NOTE: Zig `link(path, &result, origin, .absolute_path,
                // comptime ignore_runtime=false, comptime is_bun=true)` — the
                // two trailing comptime bools became const-generics on
                // `Linker::link`; `import_path_format` stayed runtime
                // (see `linker.rs` PORT NOTE: `ImportPathFormat` is not
                // `ConstParamTy`).
                unsafe {
                    (*jsc_vm).transpiler.linker.link::<false, true>(
                        path,
                        &mut parse_result,
                        &(*jsc_vm).origin,
                        options::ImportPathFormat::AbsolutePath,
                    )?;
                }

                // Spec :481-510 — pending imports → AsyncModule queue.
                if parse_result.pending_imports.len() > 0 {
                    if unsafe { (*extra).promise_ptr.is_null() } {
                        return Err(bun_core::err!("UnexpectedPendingResolution"));
                    }
                    // TODO(b2-blocked): `vm.modules.enqueue` — `AsyncModule::Queue`
                    // gated. Hands `arena` ownership to the queue.
                    arena_guard.2 = false;
                    return Err(bun_core::err!("AsyncModule"));
                }

                if !macro_mode {
                    unsafe {
                        (*jsc_vm).resolved_count +=
                            (*jsc_vm).transpiler.linker.import_counter - start_count;
                    }
                }
                unsafe { (*jsc_vm).transpiler.linker.import_counter = 0 };

                // Spec :516-523.
                let is_commonjs_module = parse_result.ast.has_commonjs_export_names
                    || parse_result.ast.exports_kind == bun_js_parser::ExportsKind::Cjs;
                // TODO(b2-blocked): `analyze_transpiled_module::ModuleInfo::create`.

                // ── js_printer::print ───────────────────────────────────────
                // Spec :525-539.
                // SAFETY: `extra.source_code_printer` is non-null per `TranspileExtra`
                // contract.
                let printer: &mut bun_js_printer::BufferPrinter =
                    unsafe { &mut *(*extra).source_code_printer };
                printer.ctx.reset();
                // TODO(b2-cycle): `VirtualMachine::source_map_handler` is a
                // `todo!()` stub returning `()` (VirtualMachine.rs:1566).
                // Once it returns `js_printer::SourceMapHandler<'_>`, switch
                // back to `print_with_source_map(parse_result, &mut *printer,
                // Format::EsmAscii, mapper, None)`. Until then, route through
                // `print` (same printer body, `ENABLE_SOURCE_MAP = false`).
                #[cfg(any())]
                let _mapper = unsafe { (*jsc_vm).source_map_handler(printer) };
                unsafe {
                    (*jsc_vm).transpiler.print(
                        parse_result,
                        &mut *printer,
                        bun_js_printer::Format::EsmAscii,
                    )?;
                }

                if is_main {
                    unsafe { (*jsc_vm).has_loaded = true };
                }

                // Spec :553-558 — watcher path uses ref-counted source.
                if unsafe { (*jsc_vm).is_watcher_enabled() } {
                    // TODO(b2-blocked): `VirtualMachine::ref_counted_resolved_source`.
                }

                // Spec :561-592 — final ResolvedSource.
                // TODO(b2-cycle): `package_json` is `Option<*mut c_void>`
                // (ImportWatcher gated) — spec reads `pj.module_type` to
                // override `module_type`. Fall back to `module_type` until
                // `bun_watcher` un-gates the typed `*mut PackageJSON`.
                let _ = package_json;
                let tag = match loader {
                    L::Json | L::Jsonc => ResolvedSourceTag::JsonForObjectLoader,
                    L::Js | L::Jsx | L::Ts | L::Tsx => match module_type {
                        ModuleType::Esm => ResolvedSourceTag::PackageJsonTypeModule,
                        ModuleType::Cjs => ResolvedSourceTag::PackageJsonTypeCommonjs,
                        _ => ResolvedSourceTag::Javascript,
                    },
                    _ => ResolvedSourceTag::Javascript,
                };

                let written = printer.ctx.get_written();
                // PORT NOTE: bundler-side `cache.output_code` is
                // `Option<Box<[u8]>>` (T6's `bun.String` wrapper lives in
                // `bun_jsc::RuntimeTranspilerCache`); clone into a fresh
                // `bun.String` either way. Spec :573 hands the `bun.String`
                // straight through.
                let source_code = match cache.output_code.take() {
                    Some(b) => bun_string::String::clone_latin1(&b),
                    None => bun_string::String::clone_latin1(written),
                };
                if written.len() > 1024 * 1024 * 2 || unsafe { (*jsc_vm).smol } {
                    // PERF(port): spec deinits the printer buffer; Rust drops on
                    // next `reset()`. TODO(port): expose `BufferWriter::deinit`.
                }

                // (fd close handled by `_fd_guard` registered above; spec
                // :251-256 `defer` fires on every exit path.)

                return Ok(ResolvedSource {
                    source_code,
                    specifier: input_specifier.dupe_ref(),
                    source_url: create_if_different(input_specifier, path.text),
                    is_commonjs_module,
                    // TODO(b2-blocked): `analyze_transpiled_module::ModuleInfo::create`.
                    module_info: core::ptr::null_mut(),
                    tag,
                    ..Default::default()
                });
            }
            // (parse→link→print arm always `return`s; no fallthrough.)
            #[allow(unreachable_code)]
            { unreachable!() }
        }

        // Spec :595 — `provideFetch()` should be called.
        L::Napi => unreachable!("napi modules go through provideFetch()"),

        // ────────────────────────────────────────────────────────────────────
        // .wasm — Spec :636-676.
        // ────────────────────────────────────────────────────────────────────
        L::Wasm => {
            // SAFETY: per fn contract.
            let main = unsafe { (*jsc_vm).main };
            if referrer == b"undefined" && main == path.text {
                // TODO(b2-blocked): `globalThis.wasmSourceBytes` put +
                // `@embedFile("../js/wasi-runner.js")` — needs `ArrayBuffer::create`
                // and a Rust `include_bytes!` of the wasi runner. Spec :638-658.
                #[cfg(any())]
                {
                    use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                    return Ok(ResolvedSource {
                        source_code: bun_string::String::static_(include_bytes!(
                            "../js/wasi-runner.js"
                        )),
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        tag: ResolvedSourceTag::Esm,
                        ..Default::default()
                    });
                }
                // Spec :637-659 RETURNS the wasi-runner source here; it must
                // NOT fall through to the `.file` recursion below. Fail closed
                // until the gated ctor above un-gates (PORTING.md §Forbidden:
                // no silent-no-op fall-through).
                #[allow(unreachable_code)]
                return Err(bun_core::err!("NotSupported"));
            }
            // Spec :661-675 — recurse as `.file`.
            // SAFETY: per fn contract — `extra` is live for the call.
            unsafe {
                (*extra).loader = L::File;
                (*extra).module_type = ModuleType::Unknown;
            }
            transpile_source_code_inner(jsc_vm, args, extra)
        }

        // ────────────────────────────────────────────────────────────────────
        // .sqlite / .sqlite_embedded — Spec :678-718.
        // ────────────────────────────────────────────────────────────────────
        L::Sqlite | L::SqliteEmbedded => {
            // SAFETY: per fn contract.
            // Spec :680 — `jsc_vm.hot_reload == .hot`. `HotReload` is
            // `{ none=0, hot=1, watch=2 }` (src/options_types/Context.zig:118);
            // `!= 0` would also match `.watch`, which is wrong.
            // TODO(b2-cycle): `hot_reload` is `cli::Command::HotReload` enum
            // (gated as `u8`); compare to the `.hot` discriminant explicitly.
            const HOT_RELOAD_HOT: u8 = 1;
            let hot = unsafe { (*jsc_vm).hot_reload } == HOT_RELOAD_HOT;
            let sqlite_module_source_code_string: &'static [u8] = if hot {
                SQLITE_MODULE_SOURCE_HOT
            } else {
                SQLITE_MODULE_SOURCE
            };
            use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
            Ok(ResolvedSource {
                source_code: bun_string::String::clone_utf8(
                    sqlite_module_source_code_string,
                ),
                specifier: input_specifier.dupe_ref(),
                source_url: create_if_different(input_specifier, path.text),
                tag: ResolvedSourceTag::Esm,
                ..Default::default()
            })
        }

        // ────────────────────────────────────────────────────────────────────
        // .html — Spec :720-743.
        // ────────────────────────────────────────────────────────────────────
        L::Html => {
            if disable_transpilying {
                use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                return Ok(ResolvedSource {
                    source_code: bun_string::String::empty(),
                    specifier: input_specifier.dupe_ref(),
                    source_url: create_if_different(input_specifier, path.text),
                    tag: ResolvedSourceTag::Esm,
                    ..Default::default()
                });
            }
            if global_object.is_null() {
                return Err(bun_core::err!("NotSupported"));
            }
            // TODO(b2-cycle): `jsc::API::HTMLBundle::init` — gated in
            // `bun_runtime::api`. Spec :735-742.
            Err(bun_core::err!("NotSupported"))
        }

        // ────────────────────────────────────────────────────────────────────
        // Everything else — Spec :745-825 (file loader: `export default <path>`).
        // ────────────────────────────────────────────────────────────────────
        _ => {
            if disable_transpilying {
                use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                return Ok(ResolvedSource {
                    source_code: bun_string::String::empty(),
                    specifier: input_specifier.dupe_ref(),
                    source_url: create_if_different(input_specifier, path.text),
                    tag: ResolvedSourceTag::Esm,
                    ..Default::default()
                });
            }

            // Spec :756-803 — auto-watch for non-virtual absolute paths.
            // TODO(b2-cycle): `vm.bun_watcher.addFile` — ImportWatcher gated.

            // Spec :805-823 — `export default <path string>`.
            // TODO(b2-blocked): `bun_string::String::create_utf8_for_js` is a
            // tier-6 (jsc) ctor not yet exposed; `JSValue` is `stub_ty!`.
            #[cfg(any())]
            {
                use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                let value = if !unsafe { (*jsc_vm).origin.is_empty() } {
                    // TODO(b2-cycle): `api::Bun::get_public_path` — gated.
                    bun_string::String::create_utf8_for_js(
                        unsafe { &*global_object },
                        path.text,
                    )?
                } else {
                    bun_string::String::create_utf8_for_js(
                        unsafe { &*global_object },
                        path.text,
                    )?
                };
                return Ok(ResolvedSource {
                    jsvalue_for_export: value,
                    specifier: input_specifier.dupe_ref(),
                    source_url: create_if_different(input_specifier, path.text),
                    tag: ResolvedSourceTag::ExportDefaultObject,
                    ..Default::default()
                });
            }
            // Spec ModuleLoader.zig:817-823 returns
            // `tag = .export_default_object` with `jsvalue_for_export = <path
            // JSString>`. Until `create_utf8_for_js` un-gates, fail closed —
            // PORTING.md §Forbidden: an empty `ResolvedSource::default()` here
            // is a silent-no-op (importing a file-loader asset would yield an
            // empty JS module instead of the path string).
            #[allow(unreachable_code)]
            Err(bun_core::err!("NotSupported"))
        }
    }
}

/// Spec ModuleLoader.zig:273-291 / :319-336 — register the just-opened file
/// with the dev-server watcher (if enabled, absolute, and not in
/// `node_modules`). Factored out because the spec inlines it twice.
#[cfg(any())] // TODO(b2-cycle): un-gate with `ImportWatcher` (`hot_reloader.rs`).
#[inline]
fn maybe_watch_file(
    jsc_vm: *mut VirtualMachine,
    should_close_input_file_fd: &mut bool,
    input_file_fd: bun_sys::Fd,
    is_node_override: bool,
    path: &Fs::Path,
    hash: u32,
    loader: Loader,
    package_json: Option<*mut c_void>,
) {
    if !unsafe { (*jsc_vm).is_watcher_enabled() } {
        return;
    }
    if !input_file_fd.is_valid() {
        return;
    }
    if is_node_override
        || !bun_paths::is_absolute(path.text)
        || bun_string::strings::contains(path.text, b"node_modules")
    {
        return;
    }
    *should_close_input_file_fd = false;
    let _ = unsafe {
        (*jsc_vm).bun_watcher.add_file(
            input_file_fd,
            path.text,
            hash,
            loader,
            bun_sys::Fd::INVALID,
            package_json,
            true,
        )
    };
}

// Spec ModuleLoader.zig:681-708 — generated `bun:sqlite` import shims.
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

/// `ModuleLoader.zig` `jsSyntheticModule(tag, specifier)` — produce a
/// `ResolvedSource` whose `tag` indexes into the C++ `InternalModuleRegistry`
/// (the embedded JS modules from `src/js/`). No source text — C++ dispatches
/// on `.tag` alone.
///
/// PORT NOTE: `name` is the canonical specifier string (e.g. `b"node:fs"`).
/// Zig threads `ResolvedSource.Tag.@"node:fs"` (a generated `u32` enum); the
/// Rust side carries the string and resolves to the numeric tag via
/// `Tag::from_name` (PHF over the codegen table in `bun_jsc::resolved_source_tag`).
#[inline]
fn js_synthetic_module(name: &'static [u8], specifier: &bun_string::String) -> ResolvedSource {
    use bun_jsc::resolved_source::Tag;
    ResolvedSource {
        allocator: core::ptr::null_mut(),
        source_code: bun_string::String::empty(),
        specifier: *specifier,
        source_url: bun_string::String::static_(name),
        tag: Tag::from_name(name),
        source_code_needs_deref: false,
        ..ResolvedSource::default()
    }
}

/// `ModuleLoader.zig` `getHardcodedModule(jsc_vm, specifier, hardcoded)` —
/// the per-variant body of the builtin-module fast path. Returns `None` when
/// the variant is recognised but not currently servable (e.g. `bun:main`
/// before `ServerEntryPoint::generate` has run, or `bun:internal-for-testing`
/// without the opt-in flag).
fn get_hardcoded_module(
    _jsc_vm: *mut VirtualMachine,
    specifier: &bun_string::String,
    hardcoded: HardcodedModule,
) -> Option<ResolvedSource> {
    // TODO(b2-cycle): `bun_analytics::Features::builtin_modules.insert(hardcoded)`
    // — the `EnumSet<HardcodedModule>` static lives in T5 (`bun_resolve_builtins`)
    // per CYCLEBREAK.md and is not yet wired into `bun_analytics`.

    match hardcoded {
        HardcodedModule::BunMain => {
            // Synthetic `bun:main` wrapper — pulls source from this thread's
            // `RuntimeState.entry_point` (the high-tier home for what Zig
            // stores as `vm.entry_point`).
            let state = runtime_state();
            if state.is_null() {
                return None;
            }
            // SAFETY: `state` is the live per-thread `RuntimeState` boxed in
            // `init_runtime_state`; no other `&mut` to `entry_point` is held.
            let ep = unsafe { &(*state).entry_point };
            if !ep.generated {
                return None;
            }
            use bun_jsc::resolved_source::Tag;
            Some(ResolvedSource {
                allocator: core::ptr::null_mut(),
                source_code: bun_string::String::clone_utf8(&ep.contents),
                specifier: *specifier,
                source_url: *specifier,
                tag: Tag::Esm,
                source_code_needs_deref: true,
                ..ResolvedSource::default()
            })
        }
        HardcodedModule::BunInternalForTesting => {
            // Gated behind `--expose-internals` (release) / always-on (debug).
            if !cfg!(debug_assertions) {
                // SAFETY: plain `static mut` matching Zig's mutable global;
                // only written during init on the JS thread (see
                // `module_loader::set_is_allowed_to_use_internal_testing_apis`).
                let allowed = unsafe {
                    bun_jsc::module_loader::IS_ALLOWED_TO_USE_INTERNAL_TESTING_APIS
                };
                if !allowed {
                    return None;
                }
            }
            Some(js_synthetic_module(b"bun:internal-for-testing", specifier))
        }
        HardcodedModule::BunWrap => {
            // `Runtime.Runtime.sourceCode()` — the bundler's CJS-interop
            // shim, embedded as a static string in `bun_js_parser::runtime`.
            #[cfg(any())]
            // TODO(b2-cycle): `Runtime::source_code()` — `bun_js_parser::runtime`
            // is a stub re-export until `runtime.rs` un-gates there.
            {
                return Some(ResolvedSource {
                    allocator: core::ptr::null_mut(),
                    source_code: bun_string::String::init(
                        bun_js_parser::runtime::Runtime::source_code(),
                    ),
                    specifier: *specifier,
                    source_url: *specifier,
                    ..ResolvedSource::default()
                });
            }
            // Fail closed: until `Runtime::source_code()` un-gates, returning
            // a default-zeroed `ResolvedSource` here would hand C++ a garbage
            // `.tag`. Spec returns a populated source; `None` falls through to
            // `FetchBuiltinResult::NotFound` → coherent error instead.
            None
        }
        // Zig: `inline else => |tag| jsSyntheticModule(@field(ResolvedSource.Tag, @tagName(tag)), specifier)`
        // — every other `HardcodedModule` is served straight out of the
        // InternalModuleRegistry by tag, with no Rust-side source text.
        other => {
            let name: &'static str = other.into();
            Some(js_synthetic_module(name.as_bytes(), specifier))
        }
    }
}

/// `ModuleLoader.fetchBuiltinModule(jsc_vm, specifier)` — `HardcodedModule`
/// lookup + macro-namespace + standalone-module-graph probe. Port of
/// `src/jsc/ModuleLoader.zig:1173` `fetchBuiltinModule` and the
/// `Bun__fetchBuiltinModule` export wrapper at :850.
///
/// # Safety
/// `jsc_vm` is the live per-thread VM; `out` is a valid out-param.
unsafe fn fetch_builtin_module(
    jsc_vm: *mut VirtualMachine,
    _global: *mut JSGlobalObject,
    specifier: &bun_string::String,
    _referrer: &bun_string::String,
    out: *mut ErrorableResolvedSource,
) -> FetchBuiltinResult {
    // PORT NOTE: Zig's `getWithEql(specifier, bun.String.eqlComptime)` walks
    // the comptime map comparing each key against the (possibly UTF-16)
    // `bun.String`. The PHF map keys on `&[u8]`, so transcode once up-front;
    // builtin specifiers are short ASCII so `to_utf8()` is borrow-only in
    // the common case (`ZigStringSlice` drops without freeing).
    let spec_utf8 = specifier.to_utf8();
    let spec = spec_utf8.slice();

    // ── HardcodedModule fast path ───────────────────────────────────────
    if let Some(&hardcoded) = HardcodedModule::MAP.get(spec) {
        return match get_hardcoded_module(jsc_vm, specifier, hardcoded) {
            Some(resolved) => {
                // SAFETY: per fn contract — `out` is a valid out-param.
                unsafe { *out = ErrorableResolvedSource::ok(resolved) };
                FetchBuiltinResult::Found
            }
            // Recognised builtin but not servable right now → fall through
            // to filesystem resolution (matches Zig `orelse return false`).
            None => FetchBuiltinResult::NotFound,
        };
    }

    // ── `macro:` namespace ──────────────────────────────────────────────
    // Spec ModuleLoader.zig:1178-1186. `vm.macro_entry_points` values are
    // `*mut MacroEntryPoint` (gated `bun_bundler::entry_points` type); the
    // map itself is keyed by `i32` hash of the specifier.
    if spec.starts_with(b"macro:") {
        #[cfg(any())]
        // TODO(b2-cycle): `MacroEntryPoint::generate_id_from_specifier` +
        // `(*entry).source.contents` — `MacroEntryPoint` is gated and the
        // VM field stores `*mut c_void`.
        {
            use bun_bundler::entry_points::MacroEntryPoint;
            let id = MacroEntryPoint::generate_id_from_specifier(spec);
            // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
            if let Some(&entry) = unsafe { (*jsc_vm).macro_entry_points.get(&id) } {
                let entry = entry.cast::<MacroEntryPoint>();
                unsafe {
                    *out = ErrorableResolvedSource::ok(ResolvedSource {
                        allocator: core::ptr::null_mut(),
                        source_code: bun_string::String::clone_utf8(&(*entry).source.contents),
                        specifier: *specifier,
                        source_url: specifier.dupe_ref(),
                        ..ResolvedSource::default()
                    });
                }
                return FetchBuiltinResult::Found;
            }
        }
        return FetchBuiltinResult::NotFound;
    }

    // ── Standalone-module-graph probe ───────────────────────────────────
    // Spec ModuleLoader.zig:1187-1221. `vm.standalone_module_graph` is
    // `Option<NonNull<c_void>>` until `bun_bundler::StandaloneModuleGraph`
    // un-gates; the per-file fields (`loader`, `bytecode`, `module_info`,
    // `module_format`, `toWTFString`) are all on that gated type.
    #[cfg(any())]
    // TODO(b2-cycle): `StandaloneModuleGraph` + `ResolvedSource` field ctor.
    {
        // SAFETY: per fn contract.
        if let Some(graph) = unsafe { (*jsc_vm).standalone_module_graph } {
            let graph = graph.as_ptr().cast::<bun_bundler::StandaloneModuleGraph>();
            if let Some(file) = unsafe { (*graph).files.get_ptr(spec) } {
                // … sqlite synthetic-import wrapper / bytecode-cache fields …
            }
        }
    }

    FetchBuiltinResult::NotFound
}

/// `Bun__transpileFile` body — concurrent-transpiler entry. Returns the
/// in-flight `JSInternalPromise*` when `allow_promise && async`, else null.
///
/// # Safety
/// `jsc_vm` is the live per-thread VM; `ret` is a valid out-param.
unsafe fn transpile_file(
    _jsc_vm: *mut VirtualMachine,
    _global: *mut JSGlobalObject,
    _specifier: *const bun_string::String,
    _referrer: *const bun_string::String,
    _type_attribute: *const bun_string::String,
    _ret: *mut ErrorableResolvedSource,
    _allow_promise: bool,
    _is_commonjs_require: bool,
    _force_loader: u8,
) -> *mut c_void {
    // TODO(b2-cycle): full port — needs `options.getLoaderAndVirtualSource`,
    // `node_module_module`, `webcore.Blob`, the `RuntimeTranspilerStore`
    // queue. All gated siblings.
    //
    // Contract (ModuleLoader.rs:138-150 / spec ModuleLoader.zig:881+): a null
    // return means "synchronous; result is in `*ret`". The no-hook fallback
    // (ModuleLoader.rs:223-228) writes `ModuleNotFound` into `*ret` before
    // returning null; once this hook is installed it must do the same so C++
    // reads a well-formed error instead of uninit memory.
    // SAFETY: per fn contract — `_ret` is a valid out-param.
    unsafe {
        *_ret = ErrorableResolvedSource::err(
            bun_core::err!("ModuleNotFound"),
            JSValue::UNDEFINED,
        );
    }
    ptr::null_mut()
}

/// `LoaderHooks::get_hardcoded_module` body — thin adaptor over the local
/// [`get_hardcoded_module`] that writes through an out-param (the §Dispatch
/// fn-ptr can't return `Option<ResolvedSource>` by value across the boundary
/// without naming the high-tier `ResolvedSource` move semantics).
///
/// # Safety
/// `jsc_vm` is the live per-thread VM; `out` is a valid out-param.
unsafe fn get_hardcoded_module_hook(
    jsc_vm: *mut VirtualMachine,
    specifier: &bun_string::String,
    hardcoded: HardcodedModule,
    out: *mut ResolvedSource,
) -> bool {
    match get_hardcoded_module(jsc_vm, specifier, hardcoded) {
        Some(resolved) => {
            // SAFETY: per fn contract — `out` is a valid out-param.
            unsafe { *out = resolved };
            true
        }
        None => false,
    }
}

// ════════════════════════════════════════════════════════════════════════════
// LoaderHooks::resolve — `VirtualMachine.resolveMaybeNeedsTrailingSlash`
// (spec VirtualMachine.zig:1873-2016) + `_resolve` (spec :1724-1852).
//
// This is the resolution path behind `Bun__resolveSync`,
// `Zig__GlobalObject__resolve`, `import.meta.resolve`, and
// `Module._findPath`. The body drives `transpiler.resolver` (a
// `bun_resolver::Resolver` value field of `VirtualMachine`) and reaches into
// `ServerEntryPoint` / `ObjectURLRegistry` — all forward-deps on `bun_jsc`,
// hence §Dispatch.
// ════════════════════════════════════════════════════════════════════════════

/// `bun.pathLiteral(s)` — comptime path-separator rewrite. Only the two
/// `_resolve` callers need it (the `[eval]` / `[stdin]` suffix checks); inline
/// the const-folded result instead of pulling in the `bun.rs` macro.
#[cfg(windows)]
const EVAL_SUFFIX: &[u8] = b"\\[eval]";
#[cfg(not(windows))]
const EVAL_SUFFIX: &[u8] = b"/[eval]";
#[cfg(windows)]
const STDIN_SUFFIX: &[u8] = b"\\[stdin]";
#[cfg(not(windows))]
const STDIN_SUFFIX: &[u8] = b"/[stdin]";

/// Spec VirtualMachine.zig:1712-1720.
#[inline]
fn normalize_specifier_for_resolution<'a>(specifier: &'a [u8], query_string: &mut &'a [u8]) -> &'a [u8] {
    if let Some(i) = bun_string::strings::index_of_char(specifier, b'?') {
        let i = i as usize;
        *query_string = &specifier[i..];
        &specifier[..i]
    } else {
        specifier
    }
}

/// Spec VirtualMachine.zig:1865-1871 — strip a `file://` prefix.
#[inline]
fn normalize_source(source: &[u8]) -> &[u8] {
    source.strip_prefix(b"file://".as_slice()).unwrap_or(source)
}

/// Port of `VirtualMachine._resolve` (spec VirtualMachine.zig:1724-1852).
///
/// Writes the resolved path/query into `*ret_path` / `*ret_query`. The Zig
/// `ResolveFunctionResult.result: ?Resolver.Result` field is unused by the
/// only caller (`resolveMaybeNeedsTrailingSlash` reads `.path` /
/// `.query_string` and clones them), so we drop it and return only the slices
/// the caller actually consumes — avoids materialising the 1KB
/// `Resolver::Result` on every fast-path hit.
///
/// # Safety
/// `vm` is the live per-thread VM. `specifier` / `source` borrow the caller's
/// `to_utf8()` buffers and must outlive the returned slices (which the caller
/// immediately `cloneUTF8`s).
unsafe fn _resolve<'a>(
    vm: *mut VirtualMachine,
    specifier: &'a [u8],
    source: &'a [u8],
    is_esm: bool,
    is_a_file_path: bool,
    ret_path: &mut &'a [u8],
    ret_query: &mut &'a [u8],
) -> Result<(), bun_core::Error> {
    use bun_jsc::virtual_machine::MAIN_FILE_NAME;
    use bun_resolve_builtins::{Alias, Cfg as AliasCfg, Target};

    // Spec :1732 — `Runtime.Runtime.Imports.alt_name` == `Runtime.Runtime.Imports.Name`
    // == `"bun:wrap"` (see js_parser/runtime.rs:644-645). Zig compared the
    // *basename* against `alt_name`; both consts are the bare specifier so a
    // direct equality on `basename(specifier)` is correct.
    if bun_paths::basename(specifier) == b"bun:wrap" {
        *ret_path = b"bun:wrap";
        return Ok(());
    }

    // Spec :1734-1737 — `bun:main` synthetic entry. `entry_point` lives on the
    // high-tier `RuntimeState` (it was a value field of `VirtualMachine` in
    // Zig).
    if specifier == MAIN_FILE_NAME {
        let state = runtime_state();
        // SAFETY: `state` is the per-thread `RuntimeState` box; null only when
        // no high tier is installed (impossible — this *is* the high tier).
        if !state.is_null() && unsafe { (*state).entry_point.generated } {
            *ret_path = MAIN_FILE_NAME;
            return Ok(());
        }
    }

    // Spec :1738-1741 — `macro:` namespace passes through.
    if specifier.starts_with(bun_js_parser::Macro::NAMESPACE_WITH_COLON) {
        // PORT NOTE: Zig duped into `bun.default_allocator`; the caller now
        // `bun.String.cloneUTF8`s `ret_path` unconditionally (spec :2015), so
        // returning the borrowed slice is sufficient and avoids the leak
        // (PORTING.md §Forbidden: `Box::leak`).
        *ret_path = specifier;
        return Ok(());
    }

    // Spec :1742-1745 — `node_fallbacks` virtual import path.
    if specifier.starts_with(node_fallbacks::IMPORT_PATH) {
        *ret_path = specifier;
        return Ok(());
    }

    // Spec :1746-1749 — hardcoded builtin alias (`node:fs` etc.).
    if let Some(alias) = Alias::get(specifier, Target::Bun, AliasCfg::default()) {
        *ret_path = alias.path.as_bytes();
        return Ok(());
    }

    // Spec :1750-1756 — `[eval]` / `[stdin]` virtual sources.
    // SAFETY: `vm` is the live per-thread VM.
    if unsafe { (*vm).module_loader.eval_source.is_some() }
        && (specifier.ends_with(EVAL_SUFFIX) || specifier.ends_with(STDIN_SUFFIX))
    {
        *ret_path = specifier;
        return Ok(());
    }

    // Spec :1757-1765 — `blob:` URLs registered via `URL.createObjectURL`.
    if let Some(rest) = specifier.strip_prefix(b"blob:".as_slice()) {
        if crate::webcore::object_url_registry::ObjectURLRegistry::singleton().has(rest) {
            *ret_path = specifier;
            return Ok(());
        }
        return Err(bun_core::err!("ModuleNotFound"));
    }

    // ── Filesystem resolver ──────────────────────────────────────────────
    let is_special_source =
        source == MAIN_FILE_NAME || bun_js_parser::Macro::is_macro_path(source);
    let mut query_string: &[u8] = b"";
    let normalized_specifier = normalize_specifier_for_resolution(specifier, &mut query_string);
    // Spec :1771-1778. `Fs.PathName.init(source).dirWithTrailingSlash()` slices
    // `source` in place, so the `'a` lifetime is preserved.
    // SAFETY: `vm.transpiler.fs` is the `'static` `FileSystem` singleton
    // pointer set in `init_runtime_state`.
    let top_level_dir: &'a [u8] =
        unsafe { core::mem::transmute::<&[u8], &'a [u8]>((*(*vm).transpiler.fs).top_level_dir) };
    let source_to_use: &[u8] = if !is_special_source {
        if is_a_file_path {
            Fs::PathName::init(source).dir_with_trailing_slash()
        } else {
            source
        }
    } else {
        top_level_dir
    };

    // Spec :1780-1838 — `resolveAndAutoInstall` retry-on-not-found loop.
    // SAFETY: `resolver.opts.global_cache` is a plain enum field.
    let global_cache = unsafe { (*vm).transpiler.resolver.opts.global_cache };
    let kind = if is_esm { ImportKind::Stmt } else { ImportKind::Require };

    // This cache-bust is disabled when the filesystem is not being used to
    // resolve.
    let mut retry_on_not_found = bun_paths::is_absolute(source_to_use);
    let result: bun_resolver::Result = loop {
        // SAFETY: `vm.transpiler.resolver` is the unique per-VM resolver; this
        // is the only `&mut` borrow live for this call (the JS thread is
        // single-entry here).
        match unsafe {
            (*vm).transpiler.resolver.resolve_and_auto_install(
                source_to_use,
                normalized_specifier,
                kind,
                global_cache,
            )
        } {
            ResolveResultUnion::Success(r) => break r,
            ResolveResultUnion::Failure(e) => return Err(e),
            ResolveResultUnion::Pending(_) | ResolveResultUnion::NotFound => {
                if !retry_on_not_found {
                    return Err(bun_core::err!("ModuleNotFound"));
                }
                retry_on_not_found = false;

                // Spec :1799-1833 — bust the dir cache for the candidate
                // parent directory and retry once.
                let mut buf = bun_paths::path_buffer_pool::get();
                let buster_name: &[u8] = 'name: {
                    if bun_paths::is_absolute(normalized_specifier) {
                        if let Some(dir) = bun_core::dirname(normalized_specifier) {
                            if dir.len() > buf.len() {
                                return Err(bun_core::err!("ModuleNotFound"));
                            }
                            // Normalized without trailing slash.
                            break 'name bun_string::strings::paths::normalize_slashes_only(
                                &mut buf[..],
                                dir,
                                bun_paths::SEP,
                            );
                        }
                    }

                    // If the specifier is too long to join, it can't name a
                    // real directory — skip the cache bust and fail.
                    if source_to_use.len() + normalized_specifier.len() + 4 >= buf.len() {
                        return Err(bun_core::err!("ModuleNotFound"));
                    }

                    let parts: [&[u8]; 3] = [source_to_use, normalized_specifier, b".."];
                    break 'name bun_paths::resolve_path::join_abs_string_buf_z::<
                        bun_paths::platform::Auto,
                    >(top_level_dir, &mut buf[..], &parts)
                    .as_bytes();
                };

                // Only re-query if we previously had something cached.
                // SAFETY: see above.
                if unsafe {
                    (*vm).transpiler.resolver.bust_dir_cache(
                        bun_string::strings::paths::without_trailing_slash_windows_path(
                            buster_name,
                        ),
                    )
                } {
                    continue;
                }
                return Err(bun_core::err!("ModuleNotFound"));
            }
        }
    };

    // Spec :1840-1842.
    // SAFETY: plain bool/usize fields.
    unsafe {
        if !(*vm).macro_mode {
            (*vm).has_any_macro_remappings = (*vm).has_any_macro_remappings
                || !(*vm).transpiler.options.macro_remap.is_empty();
        }
    }

    *ret_query = query_string;
    let Some(result_path) = result.path_const() else {
        return Err(bun_core::err!("ModuleNotFound"));
    };
    // SAFETY: plain usize field.
    unsafe { (*vm).resolved_count += 1 };

    // PORT NOTE: `result_path.text` is a `&'_ [u8]` borrowed from the
    // resolver's interned `'static` BSSStringList stores (see resolver/lib.rs
    // §allocators) — the same store `load_preloads` reads from. Transmute the
    // lifetime to `'a` so the caller can `cloneUTF8` it; the underlying bytes
    // outlive the program.
    *ret_path = unsafe { core::mem::transmute::<&[u8], &'a [u8]>(result_path.text) };
    Ok(())
}

/// `LoaderHooks::resolve` body — port of
/// `VirtualMachine.resolveMaybeNeedsTrailingSlash` (spec VirtualMachine.zig:1873-2016).
///
/// # Safety
/// `res` / `global` are valid; `query_string` is null or a valid out-param.
/// `specifier` / `source` are passed by value (spec moves the `bun.String`s by
/// value too) and are NOT derefed here — the caller owns them.
unsafe fn resolve_hook(
    res: *mut ErrorableString,
    global: *mut JSGlobalObject,
    specifier: bun_string::String,
    source: bun_string::String,
    query_string: *mut bun_string::String,
    is_esm: bool,
    is_a_file_path: bool,
    is_user_require_resolve: bool,
) -> bool {
    use bun_jsc::ResolveMessage;
    use bun_logger as logger;
    use bun_resolve_builtins::{Alias, Cfg as AliasCfg, Target};

    // SAFETY: per fn contract.
    let global_ref = unsafe { &*global };
    // PORT NOTE: `bun_vm()` hands back `&VirtualMachine`; we go through a raw
    // ptr (not `&mut`) for the resolver/log writes below to avoid aliasing the
    // shared ref (PORTING.md §Forbidden — same raw-ptr-per-field style as
    // `load_preloads`/`transpile_source_code`).
    let vm: *mut VirtualMachine =
        global_ref.bun_vm() as *const VirtualMachine as *mut VirtualMachine;

    // Spec :1883-1904 — overlong specifier guard. `MAX_PATH_BYTES * 1.5`,
    // truncated. PORT NOTE: Zig used `@intFromFloat(@trunc(f64(..) * 1.5))`;
    // integer `* 3 / 2` is exact for the powers-of-two MAX_PATH_BYTES values.
    const MAX_SPECIFIER_LEN: usize = bun_paths::MAX_PATH_BYTES * 3 / 2;
    if is_a_file_path && specifier.length() > MAX_SPECIFIER_LEN {
        let specifier_utf8 = specifier.to_utf8();
        let source_utf8 = source.to_utf8();
        let import_kind = if is_esm {
            ImportKind::Stmt
        } else if is_user_require_resolve {
            ImportKind::RequireResolve
        } else {
            ImportKind::Require
        };
        let printed = bun_core::handle_oom(ResolveMessage::fmt(
            specifier_utf8.slice(),
            source_utf8.slice(),
            bun_core::err!("NameTooLong"),
            import_kind,
        ));
        let msg = logger::Msg {
            data: logger::range_data(None, logger::Range::NONE, printed),
            ..Default::default()
        };
        let js_err = match ResolveMessage::create(global_ref, &msg, source_utf8.slice()) {
            Ok(v) => v,
            Err(_) => return false,
        };
        // SAFETY: per fn contract.
        unsafe { *res = ErrorableString::err(bun_core::err!("NameTooLong"), js_err) };
        return true;
    }

    let specifier_utf8 = specifier.to_utf8();
    let source_utf8 = source.to_utf8();

    // Spec :1913-1925 — `PluginRunner.onResolveJSC`. The `plugin_runner` field
    // is `Option<()>` on the low-tier VM (TODO(b2-cycle) in VirtualMachine.rs:
    // gated `bun_bundler::transpiler::PluginRunner`); skip until it widens.
    // PORT NOTE: NOT silently dropping — `Zig__GlobalObject__resolve` already
    // short-circuits plugin namespaces in C++ (ZigGlobalObject.cpp:3299-3331),
    // and `Bun__resolveSync` callers go through `PluginRunner` only when a
    // plugin is registered (which Phase B doesn't yet do).
    #[cfg(any())]
    {
        // SAFETY: `vm` is the live per-thread VM.
        if let Some(plugin_runner) = unsafe { (*vm).plugin_runner.as_mut() } {
            if PluginRunner::could_be_plugin(specifier_utf8.slice()) {
                let namespace = PluginRunner::extract_namespace(specifier_utf8.slice());
                let after_namespace = if namespace.is_empty() {
                    specifier_utf8.slice()
                } else {
                    &specifier_utf8.slice()[namespace.len() + 1..]
                };
                match plugin_runner.on_resolve_jsc(
                    bun_string::String::init(namespace),
                    bun_string::String::borrow_utf8(after_namespace),
                    source,
                    bun_options_types::Target::Bun,
                ) {
                    Ok(Some(resolved_path)) => {
                        unsafe { *res = resolved_path };
                        return true;
                    }
                    Ok(None) => {}
                    Err(_) => return false,
                }
            }
        }
    }

    // Spec :1927-1935 — hardcoded builtin alias fast path. For
    // `require.resolve("fs")` (`is_user_require_resolve && node_builtin`) Node
    // returns the bare specifier as-is, not the canonical `node:fs`.
    if let Some(hardcoded) = Alias::get(specifier_utf8.slice(), Target::Bun, AliasCfg::default()) {
        let path = if is_user_require_resolve && hardcoded.node_builtin {
            specifier.dupe_ref()
        } else {
            bun_string::String::init(hardcoded.path.as_bytes())
        };
        // SAFETY: per fn contract.
        unsafe { *res = ErrorableString::ok(path) };
        return true;
    }

    // Spec :1937-1954 — swap `vm.log` (and resolver/linker/pm logs) to a fresh
    // local Log so resolver diagnostics don't leak into the VM log. PORT NOTE:
    // the Rust `Resolver.log` / `Linker.log` are `*mut Log` (see
    // transpile_source_code's identical swap at jsc_hooks.rs:848-879), so the
    // pointer write is sound; restore via scopeguard so the early-`return
    // false` paths don't leave a dangling stack pointer.
    let mut log = logger::Log::init();
    // SAFETY: `vm.log` is `Option<NonNull<Log>>`.
    let old_log: *mut logger::Log =
        unsafe { (*vm).log }.map(|p| p.as_ptr()).unwrap_or(ptr::null_mut());
    let log_ptr: *mut logger::Log = &mut log;
    // SAFETY: `vm` is the live per-thread VM; the log fields are raw `*mut`.
    unsafe {
        (*vm).log = core::ptr::NonNull::new(log_ptr);
        (*vm).transpiler.resolver.log = log_ptr;
        (*vm).transpiler.linker.log = log_ptr;
        // TODO(b2-cycle): `transpiler.resolver.package_manager` log swap —
        // gated alongside the PM field (see transpile_source_code §log-swap).
    }
    let _restore = scopeguard::guard((), |_| unsafe {
        (*vm).log = core::ptr::NonNull::new(old_log);
        (*vm).transpiler.resolver.log = old_log;
        (*vm).transpiler.linker.log = old_log;
    });

    // Spec :1955 — `jsc_vm._resolve(...)`.
    let mut result_path: &[u8] = b"";
    let mut result_query: &[u8] = b"";
    // SAFETY: `vm` is the live per-thread VM; the slices borrow
    // `specifier_utf8`/`source_utf8` which outlive this call.
    if let Err(mut err) = unsafe {
        _resolve(
            vm,
            specifier_utf8.slice(),
            normalize_source(source_utf8.slice()),
            is_esm,
            is_a_file_path,
            &mut result_path,
            &mut result_query,
        )
    } {
        // Spec :1956-1999 — synthesise a `ResolveMessage` from the first
        // `.resolve`-tagged log msg, or fall back to `ResolveMessage::fmt`.
        let msg: logger::Msg = 'brk: {
            for m in log.msgs.iter() {
                if let logger::Metadata::Resolve(r) = &m.metadata {
                    err = r.err;
                    // PORT NOTE: Zig moved the msg out (`break :brk m`); the
                    // Rust `Msg` is `Clone` (Result<Msg, AllocError>).
                    break 'brk bun_core::handle_oom(m.clone());
                }
            }

            let import_kind = if is_esm {
                ImportKind::Stmt
            } else if is_user_require_resolve {
                ImportKind::RequireResolve
            } else {
                ImportKind::Require
            };

            let printed = bun_core::handle_oom(ResolveMessage::fmt(
                specifier_utf8.slice(),
                source_utf8.slice(),
                err,
                import_kind,
            ));
            logger::Msg {
                data: logger::range_data(None, logger::Range::NONE, printed.clone()),
                metadata: logger::Metadata::Resolve(logger::MetadataResolve {
                    specifier: logger::BabyString::r#in(&printed, specifier_utf8.slice()),
                    import_kind,
                    err,
                }),
                ..Default::default()
            }
        };

        let js_err = match ResolveMessage::create(global_ref, &msg, source_utf8.slice()) {
            Ok(v) => v,
            Err(_) => return false,
        };
        // SAFETY: per fn contract.
        unsafe { *res = ErrorableString::err(err, js_err) };
        return true;
    }

    // Spec :2002-2010 — write `*query_string`. `result_query` borrows
    // `specifier_utf8`, which is freed when this fn returns; clone into an
    // owned `bun.String`.
    if !query_string.is_null() {
        // SAFETY: per fn contract — `query_string` is a valid out-param.
        unsafe {
            *query_string = if !result_query.is_empty() {
                bun_string::String::clone_utf8(result_query)
            } else {
                bun_string::String::empty()
            };
        }
    }

    // Spec :2015 — `result.path` may borrow `specifier_utf8` (e.g. `http://`
    // specifiers the resolver marked external without copying); clone for the
    // same reason. Callers own the resulting ref.
    // SAFETY: per fn contract.
    unsafe { *res = ErrorableString::ok(bun_string::String::clone_utf8(result_path)) };
    true
}

/// The static `LoaderHooks` instance handed to `bun_jsc`.
pub static LOADER_HOOKS_INSTANCE: LoaderHooks = LoaderHooks {
    transpile_source_code,
    fetch_builtin_module,
    get_hardcoded_module: get_hardcoded_module_hook,
    transpile_file,
    resolve: resolve_hook,
};

// ════════════════════════════════════════════════════════════════════════════
// Hook installation
// ════════════════════════════════════════════════════════════════════════════

// PORT NOTE: the event-loop per-task hook bodies (`RUN_IMMEDIATE_HOOK` /
// `RUN_WTF_TIMER_HOOK`) live in [`crate::dispatch`] alongside the other
// §Dispatch hot-path hooks (`RUN_TASK_HOOK` / `ON_POLL_DISPATCH`) and are
// wired from [`crate::dispatch::install_dispatch_hooks`], not here.

/// Wire the high-tier `RuntimeHooks` / `LoaderHooks` into `bun_jsc`. Called
/// once from `main.rs` immediately after [`crate::dispatch::install_dispatch_hooks`]
/// (and before the first `VirtualMachine::init`).
pub fn install_jsc_hooks() {
    bun_jsc::virtual_machine::set_runtime_hooks(&RUNTIME_HOOKS_INSTANCE);
    bun_jsc::module_loader::set_loader_hooks(&LOADER_HOOKS_INSTANCE);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/VirtualMachine.zig init() steps 1313-1322 +
//               src/jsc/event_loop.zig autoTick() +
//               src/jsc/ModuleLoader.zig transpileSourceCode/fetchBuiltinModule
//   confidence: low — vtable wiring + Timer::All/ServerEntryPoint real;
//               fetch_builtin_module HardcodedModule lookup real;
//               transpile_source_code body ported (arena mgmt / loader
//               dispatch / log-swap real; parse→link→print arm un-gated:
//               ParseOptions / parse_maybe_return_file_only / Linker::link
//               / Transpiler::print live; source-map handler + Expr::to_js
//               + ModuleInfo::create still gated).
//               js_synthetic_module / get_hardcoded_module real.
//   todos:      see TODO(b2-cycle) markers — uws::Loop surface,
//               HiveAllocator, Debugger, RuntimeTranspilerStore,
//               StandaloneModuleGraph, MacroEntryPoint,
//               Runtime::source_code().
//   notes:      §Dispatch cold-path — fn-ptr indirection acceptable, each
//               hook does real work (alloc/syscall/parse).
// ──────────────────────────────────────────────────────────────────────────
