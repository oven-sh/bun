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
use bun_jsc::{ErrorableResolvedSource, JSGlobalObject, JSInternalPromise, JSValue, ResolvedSource};

use bun_bundler::entry_points::ServerEntryPoint;
use bun_bundler::options::{self, Loader, ModuleType};
use bun_resolver::fs as Fs;
use bun_resolver::node_fallbacks;

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
    // TODO(b2-cycle): `body_value_hive_allocator: webcore::Body::Value::HiveAllocator`
    // — `HiveAllocator` is `#[cfg(any())]`-gated in `webcore/Body.rs`. Add the
    // field (and `HiveAllocator::init()` in `init_runtime_state`) once un-gated.
}

thread_local! {
    /// One `RuntimeState` per JS thread (`VirtualMachine` is per-thread).
    /// Cleared by `VirtualMachine::deinit` once that path is wired.
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
    // SAFETY: per fn contract.
    let _vm_ref = unsafe { &mut *vm };

    // PORT NOTE: spec VirtualMachine.zig:1313 —
    // `uws.Loop.get().internal_loop_data.jsc_vm = vm.jsc_vm` — already done by
    // the low tier (`VirtualMachine::init` writes it immediately before calling
    // this hook), so no uws wiring is repeated here.

    // TODO(b2-cycle): per-worker leak — `Box::into_raw` is never paired with
    // `Box::from_raw`. Spec VirtualMachine.zig stores `timer`/`entry_point` as
    // value fields freed in worker `destroy()`. Fix: add `deinit_runtime_state`
    // slot to `RuntimeHooks`, store the returned ptr in a VM field, and
    // `drop(Box::from_raw(state))` + clear the TLS from the worker destroy
    // path. PORTING.md §Forbidden permits `Box::leak` only for true
    // process-lifetime singletons via `OnceLock`; this is per-VM.
    let state = Box::into_raw(Box::new(RuntimeState {
        timer: timer::All::init(),
        entry_point: ServerEntryPoint::default(),
    }));
    RUNTIME_STATE.with(|c| c.set(state));

    // TODO(b2-cycle): `webcore::Body::Value::HiveAllocator::init()` — gated.
    // TODO(b2-cycle): `Debugger::configure(vm, opts.debugger)` — `Debugger.rs`
    // gated; spec VirtualMachine.zig:1321 `vm.configureDebugger(opts.debugger)`.
    // TODO(b2-cycle): `Transpiler::configureTransformOptionsForBunVM` — bundler
    // option mapping (spec VirtualMachine.zig:1266+).

    state.cast()
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

/// `loadPreloads()` — runs `--preload` scripts. Returns the in-flight promise
/// if a preload is async, else null.
///
/// # Safety
/// `vm` is the live per-thread VM.
unsafe fn load_preloads(_vm: *mut VirtualMachine) -> *mut JSInternalPromise {
    // TODO(b2-cycle): port of `VirtualMachine.loadPreloads` — needs
    // `ModuleLoader.loadAndEvaluate` + `bun_resolver` for each `vm.preload`
    // entry. The low tier already short-circuits on `vm.preload.is_empty()`.
    ptr::null_mut()
}

/// `ensureDebugger(block_until_connected)` — no-op when no debugger.
///
/// # Safety
/// `vm` is the live per-thread VM.
unsafe fn ensure_debugger(_vm: *mut VirtualMachine, _block_until_connected: bool) {
    // TODO(b2-cycle): `Debugger.rs` is gated; real body is
    // `vm.debugger.?.ensure(block_until_connected)`.
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
    // PORT NOTE: `EventLoop::tick_immediate_tasks` is `#[cfg(any())]`-gated in
    // `bun_jsc` (it derefs `*mut ImmediateObject`, a `bun_runtime` type).
    // Inline the body here once `ImmediateObject::run_immediate_task` un-gates.
    // TODO(b2-cycle): tick_immediate_tasks(el, vm).
    //
    // The Windows `wakeup()` (spec event_loop.zig:371-376) checks
    // `immediate_tasks.len > 0` AFTER `tickImmediateTasks` swaps the
    // `next_immediate_tasks` list in. With `tick_immediate_tasks` gated, the
    // pre-swap check would be wrong and the immediates never run, so the
    // wakeup just busy-spins. Gate the wakeup alongside the tick.
    #[cfg(any())]
    {
        #[cfg(windows)]
        if !unsafe { &*el }.immediate_tasks.is_empty() {
            unsafe { (*el).wakeup() };
        }
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
        // No high-tier state (unit test) — fall back to a non-blocking tick.
        // SAFETY: `el` is the live per-thread event loop.
        unsafe { (*el).tick() };
        return;
    }

    // TODO(b2-blocked): `bun_uws::Loop::{is_active, tick_with_timeout,
    // tick_without_idle}` — not yet exposed on the Rust uws Loop. Spec
    // event_loop.zig:398-403 calls `ctx.timer.getTimeout(..)` ONLY inside
    // `if (loop.isActive())` — `get_timeout` has side effects (pops + fires
    // due `WTFTimer` heap entries), so it must stay gated alongside
    // `is_active()` rather than running unconditionally.
    #[cfg(any())]
    {
        // SAFETY: `el` is live; field read only.
        let has_pending_immediate = !unsafe { &*el }.immediate_tasks.is_empty();
        // Spec Timer.zig:261-268: fold the QUIC deadline into the poll timeout.
        // SAFETY: `loop_` is the live per-thread uws loop.
        let quic_next_tick_us = unsafe {
            let ild = &(*loop_).internal_loop_data;
            if ild.quic_head.is_null() { None } else { Some(ild.quic_next_tick_us) }
        };
        let mut timespec = bun_core::Timespec { sec: 0, nsec: 0 };
        if unsafe { (*loop_).is_active() } {
            unsafe { (*el).process_gc_timer() };
            // SAFETY: `state` is the live per-thread `RuntimeState`; re-entry
            // into `runtime_state()` from a fired `WTFTimer` callback yields a
            // fresh raw ptr, not an aliased `&mut`.
            let have_timeout = unsafe { &mut (*state).timer }
                .get_timeout(&mut timespec, has_pending_immediate, quic_next_tick_us, vm.cast());
            unsafe {
                (*loop_).tick_with_timeout(if have_timeout { Some(&timespec) } else { None })
            };
        } else {
            unsafe { (*loop_).tick_without_idle() };
        }
    }
    let _ = loop_;

    #[cfg(unix)]
    {
        // SAFETY: `state` is the live per-thread `RuntimeState`; `drain_timers`
        // may fire JS callbacks that re-enter `runtime_state()` — they receive
        // a fresh raw ptr, not an aliased `&mut`.
        unsafe { (*state).timer.drain_timers(vm.cast()) };
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
    generate_entry_point,
    load_preloads,
    ensure_debugger,
    auto_tick,
};

// ════════════════════════════════════════════════════════════════════════════
// LoaderHooks bodies
// ════════════════════════════════════════════════════════════════════════════

/// `ModuleLoader.transpileSourceCode(...)` — the runtime-transpiler path.
/// Port of `src/jsc/ModuleLoader.zig` `transpileSourceCode`; the body needs
/// `bun_bundler::Transpiler::parse` + `bun_js_printer` and writes a
/// `ResolvedSource` into `*ret`.
///
/// # Safety
/// `jsc_vm` is the live per-thread VM; `ret` is a valid out-param.
unsafe fn transpile_source_code(
    _jsc_vm: *mut VirtualMachine,
    _args: &TranspileArgs<'_>,
    _ret: *mut ErrorableResolvedSource,
) -> bool {
    // TODO(b2-cycle): full port — needs `vm.transpiler.parse(...)` (real in
    // `bun_bundler::transpiler`) followed by `printer.printAst`. Gated until
    // `Transpiler<'static>` field on `VirtualMachine` is populated and
    // `RuntimeTranspilerStore` un-gates.
    #[cfg(any())]
    {
        use bun_bundler::transpiler::Transpiler;
        let vm = unsafe { &mut *_jsc_vm };
        let result = vm.transpiler.parse(/* … */);
    }
    // Contract (ModuleLoader.rs:123-126): `false` means "error written into
    // `*ret` as `.err(...)`". Spec ModuleLoader.zig always populates `ret.*`
    // before signalling failure; leaving it uninit lets C++ read garbage.
    // SAFETY: per fn contract — `_ret` is a valid out-param.
    unsafe {
        *_ret = ErrorableResolvedSource::err(
            bun_core::err!("TranspileNotImplemented"),
            JSValue::UNDEFINED,
        );
    }
    false
}

/// `ModuleLoader.fetchBuiltinModule(jsc_vm, specifier)` — `HardcodedModule`
/// lookup + standalone-module-graph probe.
///
/// # Safety
/// `jsc_vm` is the live per-thread VM; `out` is a valid out-param.
unsafe fn fetch_builtin_module(
    _jsc_vm: *mut VirtualMachine,
    _global: *mut JSGlobalObject,
    specifier: &bun_string::String,
    _referrer: &bun_string::String,
    _out: *mut ErrorableResolvedSource,
) -> FetchBuiltinResult {
    // HardcodedModule fast path — bytes-only PHF lookup.
    // TODO(b2-blocked): `bun_resolve_builtins` is not yet in `bun_runtime`'s
    // dep graph (Cargo.toml). Once added, this becomes:
    //   let spec = specifier.to_owned_slice();
    //   if let Some(m) = bun_resolve_builtins::HardcodedModule::MAP.get(&*spec) {
    //       /* populate `*out` from `bun_js::generated_module(m)` */
    //       return FetchBuiltinResult::Found;
    //   }
    // and the `vm.standalone_module_graph` probe (spec ModuleLoader.zig:861-876).
    let _ = specifier;
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

/// The static `LoaderHooks` instance handed to `bun_jsc`.
pub static LOADER_HOOKS_INSTANCE: LoaderHooks = LoaderHooks {
    transpile_source_code,
    fetch_builtin_module,
    transpile_file,
};

// ════════════════════════════════════════════════════════════════════════════
// Hook installation
// ════════════════════════════════════════════════════════════════════════════

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
//               loader bodies + uws Loop polling gated.
//   todos:      see TODO(b2-cycle)/TODO(b2-blocked) markers — uws::Loop
//               surface, HiveAllocator, Debugger, RuntimeTranspilerStore,
//               ResolvedSource ctor for builtins.
//   notes:      §Dispatch cold-path — fn-ptr indirection acceptable, each
//               hook does real work (alloc/syscall/parse).
// ──────────────────────────────────────────────────────────────────────────
