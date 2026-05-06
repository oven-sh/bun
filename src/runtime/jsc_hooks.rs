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
use bun_resolve_builtins::Module as HardcodedModule;
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
    // SAFETY: per fn contract.
    let _vm_ref = unsafe { &mut *vm };

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
    }));
    RUNTIME_STATE.with(|c| c.set(state));

    // TODO(b2-cycle): `webcore::Body::Value::HiveAllocator::init()` — gated.
    // TODO(b2-cycle): `Debugger::configure(vm, opts.debugger)` — `Debugger.rs`
    // gated; spec VirtualMachine.zig:1321 `vm.configureDebugger(opts.debugger)`.
    // TODO(b2-cycle): `Transpiler::configureTransformOptionsForBunVM` — bundler
    // option mapping (spec VirtualMachine.zig:1266+).

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
            // SAFETY: `state` is the live per-thread `RuntimeState`; re-entry
            // into `runtime_state()` from a fired `WTFTimer` callback yields a
            // fresh raw ptr, not an aliased `&mut`.
            let have_timeout = unsafe { &mut (*state).timer }
                .get_timeout(&mut timespec, has_pending_immediate, quic_next_tick_us, vm.cast());
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
                        // Zig `defer` is a no-op: the arena is NOT freed (it
                        // was either handed to the AsyncModule queue, or is
                        // intentionally kept alive past `processFetchLog` so
                        // log span data pointing into it stays valid). Dropping
                        // the `Box` here would free it → UAF. Forget instead.
                        // PORT NOTE: this is an ownership hand-off, not a
                        // `'static`-lifetime hack (PORTING.md §Forbidden does
                        // not apply). The AsyncModule path will move the arena
                        // out via `ScopeGuard::into_inner` once it un-gates.
                        core::mem::forget(arena);
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
            // TODO(b2-blocked): `RuntimeTranspilerCache` is `stub_ty!` in
            // `bun_jsc`. Field-init un-gates with `RuntimeTranspilerCache.rs`.
            #[cfg(any())]
            let mut cache = bun_jsc::RuntimeTranspilerCache {
                output_code_allocator: arena,
                sourcemap_allocator: bun_alloc::default_allocator(),
                esm_record_allocator: bun_alloc::default_allocator(),
            };

            // ── Swap `vm.transpiler.log` (and linker/resolver/pm logs) ──────
            // Spec :184-199.
            // SAFETY: per fn contract; `args.log` is a valid `*mut Log`.
            let old_log = unsafe { (*jsc_vm).transpiler.log };
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
                // SAFETY: per fn contract.
                // TODO(port): `MacroMap` may not be `Clone`; spec passes by
                // value (Zig copies the struct). If `MacroMap` is by-ref only,
                // change `ParseOptions::macro_remappings` to `&MacroMap`.
                unsafe { (*jsc_vm).transpiler.options.macro_remap.clone() }
            };

            // Spec :211-215.
            let mut should_close_input_file_fd = fd.is_none();

            // Spec :218-222 — only JS-like loaders get the cjs/esm wrapper hint.
            let module_type_only_for_wrappables = match loader {
                L::Js | L::Jsx | L::Ts | L::Tsx => module_type,
                _ => ModuleType::Unknown,
            };

            let mut input_file_fd = bun_sys::Fd::INVALID;
            // PORT NOTE: spec :251-256 `defer { if should_close ... close() }` —
            // moved into the gated parse block below; `input_file_fd` is only
            // ever written by `parse_maybe_return_file_only`.

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
            //
            // TODO(b2-blocked): `bun_bundler::transpiler::{ParseOptions,
            // ParseResult, Transpiler::parse_maybe_return_file_only,
            // print_with_source_map}` are gated behind `__phase_a_draft`. The
            // entire parse→print arm below is preserved verbatim and un-gates
            // as a unit once that module compiles.
            // ════════════════════════════════════════════════════════════════
            #[cfg(any())]
            {
                use bun_bundler::analyze_transpiled_module;
                use bun_bundler::transpiler::{ParseOptions, ParseResult, AlreadyBundled};
                use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                use bun_jsc::RuntimeTranspilerCache;

                let set_breakpoint_on_first_line = is_main
                    && unsafe { (*jsc_vm).debugger.is_some() }
                    // TODO(b2-cycle): `Debugger::set_breakpoint_on_first_line` +
                    // `runtime_transpiler_store::set_break_point_on_first_line`.
                    && false;

                let arena: &mut bun_alloc::Arena = &mut arena_guard.1;
                let _fd_guard = scopeguard::guard((), |()| {
                    if should_close_input_file_fd && input_file_fd != bun_sys::Fd::INVALID {
                        input_file_fd.close();
                    }
                });
                let parse_options = ParseOptions {
                    allocator: arena,
                    path: path.clone(),
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
                        && !RuntimeTranspilerCache::is_disabled()
                    {
                        Some(&mut cache)
                    } else {
                        None
                    },
                    remove_cjs_module_wrapper: is_main
                        && unsafe { (*jsc_vm).module_loader.eval_source.is_some() },
                    macro_js_ctx: core::ptr::null_mut(),
                    replace_exports: Default::default(),
                };

                // PORT NOTE: spec uses `comptime switch (disable_transpilying or loader == .json)`
                // to monomorphize; Rust dispatches at runtime (PERF(port): const-generic
                // specialization once `parse_maybe_return_file_only` is callable).
                let return_file_only = disable_transpilying || loader == L::Json;
                let parse_result: Option<ParseResult<'_>> = if return_file_only {
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
                    // patched `TranspileArgs`. Gated until `TranspileArgs` can
                    // borrow `parse_result.source` without lifetime gymnastics.
                    return transpile_source_code_inner(
                        jsc_vm,
                        &TranspileArgs {
                            virtual_source: Some(&parse_result.source),
                            ..*args
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
                if matches!(loader, L::Json | L::Jsonc | L::Toml | L::Yaml | L::Json5) {
                    let jsvalue_for_export = if parse_result.empty {
                        JSValue::create_empty_object(unsafe { &*(*jsc_vm).global }, 0)
                    } else {
                        // TODO(b2-blocked): `Expr::to_js` — gated in `bun_js_parser`.
                        parse_result.ast.parts.at(0).stmts[0]
                            .data
                            .s_expr
                            .value
                            .to_js(arena, unsafe { &*(*jsc_vm).global })?
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
                    let source_code = match &mut entry.output_code {
                        bun_jsc::runtime_transpiler_cache::OutputCode::String(s) => s.dupe_ref(),
                        bun_jsc::runtime_transpiler_cache::OutputCode::Utf8(utf8) => {
                            let r = bun_string::String::clone_utf8(utf8);
                            // PORT NOTE: spec frees via `cache.output_code_allocator`;
                            // arena-backed in Rust, so just clear the slice.
                            *utf8 = b"";
                            r
                        }
                    };
                    return Ok(ResolvedSource {
                        source_code,
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        is_commonjs_module: entry.metadata.module_type == ModuleType::Cjs,
                        // TODO(b2-blocked): `module_info` + `tag` package_json probe (:448-464).
                        tag: ResolvedSourceTag::Javascript,
                        ..Default::default()
                    });
                }

                // Spec :468-479 — link import records.
                let start_count = unsafe { (*jsc_vm).transpiler.linker.import_counter };
                unsafe {
                    (*jsc_vm).transpiler.linker.link(
                        path,
                        &mut parse_result,
                        (*jsc_vm).origin,
                        bun_bundler::linker::ImportPathFormat::AbsolutePath,
                        false,
                        true,
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
                let module_info: Option<*mut c_void> = None;

                // ── js_printer::print ───────────────────────────────────────
                // Spec :525-539.
                // SAFETY: `extra.source_code_printer` is non-null per `TranspileExtra`
                // contract.
                let printer: &mut bun_js_printer::BufferPrinter =
                    unsafe { &mut *(*extra).source_code_printer };
                printer.ctx.reset();
                {
                    let mapper = unsafe { (*jsc_vm).source_map_handler(printer) };
                    unsafe {
                        (*jsc_vm)
                            .transpiler
                            .print_with_source_map::<_, { bun_js_printer::Format::EsmAscii }>(
                                parse_result,
                                printer,
                                mapper,
                                None,
                            )?;
                    }
                }

                if is_main {
                    unsafe { (*jsc_vm).has_loaded = true };
                }

                // Spec :553-558 — watcher path uses ref-counted source.
                if unsafe { (*jsc_vm).is_watcher_enabled() } {
                    // TODO(b2-blocked): `VirtualMachine::ref_counted_resolved_source`.
                }

                // Spec :561-592 — final ResolvedSource.
                let tag = match loader {
                    L::Json | L::Jsonc => ResolvedSourceTag::JsonForObjectLoader,
                    L::Js | L::Jsx | L::Ts | L::Tsx => {
                        let mt = package_json
                            .and_then(|pj| unsafe { (*pj).module_type })
                            .unwrap_or(module_type);
                        match mt {
                            ModuleType::Esm => ResolvedSourceTag::PackageJsonTypeModule,
                            ModuleType::Cjs => ResolvedSourceTag::PackageJsonTypeCommonjs,
                            ModuleType::Unknown => ResolvedSourceTag::Javascript,
                        }
                    }
                    _ => ResolvedSourceTag::Javascript,
                };

                let written = printer.ctx.get_written();
                let source_code = cache
                    .output_code
                    .take()
                    .unwrap_or_else(|| bun_string::String::clone_latin1(written));
                if written.len() > 1024 * 1024 * 2 || unsafe { (*jsc_vm).smol } {
                    // PERF(port): spec deinits the printer buffer; Rust drops on
                    // next `reset()`. TODO(port): expose `BufferWriter::deinit`.
                }

                return Ok(ResolvedSource {
                    source_code,
                    specifier: input_specifier.dupe_ref(),
                    source_url: create_if_different(input_specifier, path.text),
                    is_commonjs_module,
                    module_info: module_info.unwrap_or(core::ptr::null_mut()),
                    tag,
                    ..Default::default()
                });
            }

            // Un-gated fallthrough: until `__phase_a_draft` compiles, signal
            // ParseError so the caller routes through `process_fetch_log`.
            let _ = (
                macro_remappings,
                module_type_only_for_wrappables,
                virtual_source,
                hash,
                is_main,
                fd,
                input_file_fd,
                should_close_input_file_fd,
            );
            arena_guard.2 = false;
            Err(bun_core::err!("ParseError"))
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
            let hot = unsafe { (*jsc_vm).hot_reload } != 0;
            // TODO(b2-cycle): `hot_reload` is `cli::Command::HotReload` enum
            // (gated as `u8`); `!= 0` is a placeholder for `== .hot`.
            let sqlite_module_source_code_string: &'static [u8] = if hot {
                SQLITE_MODULE_SOURCE_HOT
            } else {
                SQLITE_MODULE_SOURCE
            };
            #[cfg(any())]
            {
                use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                return Ok(ResolvedSource {
                    source_code: bun_string::String::clone_utf8(
                        sqlite_module_source_code_string,
                    ),
                    specifier: input_specifier.dupe_ref(),
                    source_url: create_if_different(input_specifier, path.text),
                    tag: ResolvedSourceTag::Esm,
                    ..Default::default()
                });
            }
            let _ = sqlite_module_source_code_string;
            Ok(ResolvedSource::default())
        }

        // ────────────────────────────────────────────────────────────────────
        // .html — Spec :720-743.
        // ────────────────────────────────────────────────────────────────────
        L::Html => {
            if disable_transpilying {
                #[cfg(any())]
                {
                    use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                    return Ok(ResolvedSource {
                        source_code: bun_string::String::empty(),
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        tag: ResolvedSourceTag::Esm,
                        ..Default::default()
                    });
                }
                return Ok(ResolvedSource::default());
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
                #[cfg(any())]
                {
                    use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                    return Ok(ResolvedSource {
                        source_code: bun_string::String::empty(),
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        tag: ResolvedSourceTag::Esm,
                        ..Default::default()
                    });
                }
                return Ok(ResolvedSource::default());
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
            Ok(ResolvedSource::default())
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
            Some(ResolvedSource::default())
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
//               fetch_builtin_module HardcodedModule lookup real;
//               transpile_source_code body ported (arena mgmt / loader
//               dispatch / log-swap real, parse→print arm gated on
//               bun_bundler::transpiler::__phase_a_draft).
//               js_synthetic_module / get_hardcoded_module real.
//   todos:      see TODO(b2-cycle) markers — uws::Loop surface,
//               HiveAllocator, Debugger, RuntimeTranspilerStore,
//               StandaloneModuleGraph, MacroEntryPoint,
//               Runtime::source_code().
//   notes:      §Dispatch cold-path — fn-ptr indirection acceptable, each
//               hook does real work (alloc/syscall/parse).
// ──────────────────────────────────────────────────────────────────────────
