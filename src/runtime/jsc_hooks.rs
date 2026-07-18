//! `crate::jsc_hooks` — high-tier implementations for the §Dispatch
//! cold-path vtables that `bun_jsc` exposes (`virtual_machine::RuntimeHooks`
//! and `module_loader::LoaderHooks`).
//!
//! Per `docs/PORTING.md` §Dispatch (cold path), `bun_jsc::VirtualMachine::init`
//! / `ModuleLoader::*` cannot name `bun_runtime` types (`timer::All`,
//! `bundler::entry_points::ServerEntryPoint`, `bundler::Transpiler`,
//! `HardcodedModule`, …) directly without inverting the crate DAG. Instead the
//! low tier defines a manual fn-pointer table; this module owns the static
//! instances and the bodies as `#[no_mangle]` link-time-resolved symbols
//! (declared `extern "Rust"` on the low-tier side).
//!
//! Layout:
//!   1. [`RuntimeState`] — per-VM state the low tier stores as `*mut c_void`
//!      (owns `timer::All` + the synthetic `bun:main` `ServerEntryPoint`).
//!   2. `__BUN_RUNTIME_HOOKS` — `init_runtime_state` / `generate_entry_point`
//!      / `load_preloads` / `ensure_debugger` / `auto_tick`.
//!   3. `__BUN_LOADER_HOOKS` — `transpile_source_code` /
//!      `fetch_builtin_module` / `transpile_file`.
//!   4. `__bun_get_vm_ctx` / `__bun_js_vm_get` / `__bun_stdio_blob_store_new` /
//!      `__bun_http_sync_download_*` — low-tier extern impls.

use bun_core::WTFStringImplExt as _;
use bun_options_types::LoaderExt as _;
use core::cell::Cell;
use core::ffi::c_void;
use core::ptr;

use bun_jsc::js_promise::Status as PromiseStatus;
use bun_jsc::module_loader::{
    ArenaResetGuard, FetchBuiltinResult, FetchFlags, LoaderHooks, TranspileArgs, TranspileExtra,
};
use bun_jsc::resolved_source::OwnedResolvedSource;
use bun_jsc::virtual_machine::{
    InitOptions, RuntimeHooks, RuntimeState as OpaqueRuntimeState, VirtualMachine,
};
use bun_jsc::{
    AnyPromise, ErrorCode, ErrorableResolvedSource, ErrorableString, JSGlobalObject,
    JSInternalPromise, JSModuleLoader, JSValue, JsResult, ResolvedSource,
};

use bun_ast::ImportKind;
use bun_ast::Loader;
use bun_bundler::entry_points::ServerEntryPoint;
use bun_bundler::options::{self, ModuleType};
use bun_resolve_builtins::Module as HardcodedModule;
use bun_resolver::fs as Fs;
use bun_resolver::node_fallbacks;
use bun_resolver::{GlobalCache, ResultUnion as ResolveResultUnion};

use crate::cli::upgrade_command::FileSystemTmpdirExt as _;
use crate::timer;
use crate::webcore::blob::BlobExt as _;

// ════════════════════════════════════════════════════════════════════════════
// Per-VM runtime state
// ════════════════════════════════════════════════════════════════════════════

/// High-tier per-VM state. Boxed + leaked in `init_runtime_state`; the raw
/// pointer is returned to `bun_jsc` as `RuntimeState` (`*mut c_void`) **and**
/// cached thread-locally so `auto_tick` (which only receives `*mut
/// VirtualMachine`) can recover it without a field on the low-tier struct.
///
/// The low-tier `VirtualMachine` carries `()`
/// placeholders for these fields (see the placeholder field comments in
/// `VirtualMachine.rs`); until those slots widen to `*mut c_void`, the
/// thread-local is the recovery path.
pub struct RuntimeState {
    /// setTimeout/setInterval heap + uv timers.
    pub timer: timer::All,
    /// `RareData.{mysql,postgresql}_context` — concrete SQL state. The
    /// `bun_jsc::rare_data::RareData` slots for these are opaque ZSTs (cycle
    /// break); `bun_sql_jsc` reads them via `Bun__VM__rareData`, which returns
    /// `&mut runtime_state().sql_rare` cast to its local `#[repr(C)]` view.
    pub sql_rare: bun_sql_jsc::jsc::RareData,
    /// `RareData.ssl_ctx_cache` — concrete digest-keyed weak `SSL_CTX*` cache.
    /// Same cycle-break story as `sql_rare`.
    pub ssl_ctx_cache: crate::api::SSLContextCache::SSLContextCache,
    /// `RareData.editor_context` — `bun_jsc` cannot name `crate::cli::open`.
    pub editor_context: crate::cli::open::EditorContext,
    /// `RareData.global_dns_data` — per-VM resolver + c-ares channel.
    /// Lazy-init by [`crate::dns_jsc::global_resolver`]; freed when this box
    /// drops in [`deinit_runtime_state`].
    pub global_dns_data: core::cell::OnceCell<Box<crate::dns_jsc::GlobalData>>,
    /// Synthetic `bun:main` wrapper source.
    pub entry_point: ServerEntryPoint,
    /// Backing arena for `vm.transpiler` (spec passes `bun.default_allocator`;
    /// the Rust `Transpiler<'a>` threads `&'a Arena`). Owned here so
    /// `deinit_runtime_state` reclaims it on Worker teardown — previously
    /// leaked per-VM (PORTING.md §Forbidden: leaking only for true
    /// process-lifetime singletons via `OnceLock`, which a per-VM arena is not).
    pub transpiler_arena: Box<bun_alloc::Arena>,
    /// `vm.body_value_pool` — pooled storage for `Body.Value`
    /// (`Request.body` payloads).
    /// Boxed because `HiveAllocator` is `Fallback<HiveRef<Body::Value, 256>, 256>`
    /// — far too large to construct on the stack inside `Box::new(RuntimeState{..})`.
    /// `ManuallyDrop` inside the `Box`: `deinit_runtime_state` runs after
    /// `event_loop.deinit()`, so `HiveArray::Drop` on a leaked body would run
    /// `Value::drop` (which touches `Blob`/`readable` state) at a point that
    /// has not been proven safe; keep the prior behavior of leaking any
    /// still-occupied slot while still freeing the pool allocation itself.
    pub body_value_pool: Box<core::mem::ManuallyDrop<crate::webcore::body::HiveAllocator>>,
    pub isolation_handles: IsolationHandles,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum IsolationHandle {
    FsWatcher(ptr::NonNull<crate::node::node_fs_watcher::FSWatcher>),
    StatWatcher(ptr::NonNull<crate::node::node_fs_stat_watcher::StatWatcher>),
    Server(crate::server::AnyServer),
}

pub type IsolationHandles = bun_collections::ArrayHashMap<IsolationHandle, ()>;

thread_local! {
    /// One `RuntimeState` per JS thread (`VirtualMachine` is per-thread).
    /// Cleared by [`deinit_runtime_state`] (dispatched from
    /// `VirtualMachine::destroy` via `RuntimeHooks`).
    static RUNTIME_STATE: Cell<*mut RuntimeState> = const { Cell::new(ptr::null_mut()) };
}

/// Recover this thread's [`RuntimeState`] as a raw pointer. Null only before
/// `init_runtime_state` has run (e.g. `bun_jsc` unit tests with no high tier).
///
/// Note: returns `*mut` (NOT `&'static mut`) — `auto_tick` holds the
/// pointer across `timer.get_timeout`/`drain_timers`, which fire JS callbacks
/// that may re-enter `runtime_state()`. Handing out `&'static mut` would mint
/// aliased `&mut` to the same allocation (UB per PORTING.md §Forbidden).
/// Callers dereference per-field under `// SAFETY:` blocks, mirroring the
/// raw-ptr-per-field style already used for `vm`/`el` in `auto_tick`.
#[inline]
pub(crate) fn runtime_state() -> *mut RuntimeState {
    RUNTIME_STATE.with(Cell::get)
}

/// Recover this thread's `timer::All` heap as a raw pointer.
///
/// Note: `bun_jsc::VirtualMachine.timer` is a `()` placeholder;
/// the real `All` lives in [`RuntimeState::timer`] until that slot widens.
/// Null only before [`init_runtime_state`] has run (e.g. `bun_jsc` unit tests
/// with no high tier, or `Bun__Timer__getNextID` racing init).
///
/// Returns `*mut` (NOT `&mut`) so callers that are themselves fields of `All`
/// (`DateHeaderTimer`, `EventLoopDelayMonitor`, `FakeTimers`) can dereference
/// per-field under `// SAFETY:` without forming an aliased `&mut All` while
/// `&mut self` is live (raw-ptr-per-field re-entry pattern, see `auto_tick`).
#[inline]
pub(crate) fn timer_all() -> *mut timer::All {
    let state = runtime_state();
    if state.is_null() {
        return ptr::null_mut();
    }
    // SAFETY: `state` is the live boxed `RuntimeState` for this thread;
    // `timer` is an embedded field at a stable address for the VM lifetime.
    unsafe { ptr::addr_of_mut!((*state).timer) }
}

/// [`timer_all`] but `&'static mut` — only valid once `RuntimeState` is
/// installed (true for every JS host-call entry point) and only for callers
/// that are NOT themselves fields of `All` (`Subprocess`, `DevServer`,
/// `cron`, sockets). Single JS thread + boxed-for-process-lifetime ⇒ the
/// borrow is sound; callers must not hold it across a JS re-entry that could
/// itself call this (every use is single-expression).
#[inline]
pub(crate) fn timer_all_mut() -> &'static mut timer::All {
    let state = runtime_state();
    debug_assert!(!state.is_null(), "RuntimeState not installed");
    // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`;
    // single JS thread so no concurrent `&mut`.
    unsafe { &mut (*state).timer }
}

#[inline]
pub(crate) fn isolation_handles() -> Option<&'static mut IsolationHandles> {
    let state = runtime_state();
    if state.is_null() {
        return None;
    }
    // SAFETY: live boxed per-thread `RuntimeState`.
    Some(unsafe { &mut (*state).isolation_handles })
}

/// Per-VM lazy DNS resolver storage. Shared borrow only — c-ares callbacks
/// re-enter [`crate::dns_jsc::global_resolver`] while a `&Resolver` derived
/// from this cell is live, so a `&mut` accessor would alias.
#[inline]
pub(crate) fn global_dns_data() -> &'static core::cell::OnceCell<Box<crate::dns_jsc::GlobalData>> {
    let state = runtime_state();
    debug_assert!(
        !state.is_null(),
        "global_dns_data before init_runtime_state"
    );
    // SAFETY: `state` is the live per-thread `RuntimeState` box; the field
    // address is stable for the VM's lifetime and only read (interior
    // mutability via `OnceCell`).
    unsafe { &(*state).global_dns_data }
}

/// Recover the [`RuntimeState`] owned by a specific `vm` (not the calling
/// thread's). `WTFTimer` may be entered off the VM's JS thread (the locked
/// `All.wtf_timers` heap exists for exactly that), and the
/// `timer_insert`/`timer_remove` hooks take `vm` from a tier that cannot see
/// `RuntimeState`; both must reach the heap through `vm.runtime_state`
/// rather than the thread-local cache.
///
/// # Safety
/// `vm` must point at a live `VirtualMachine` whose `runtime_state` was set by
/// `init_runtime_state`.
#[inline]
pub(crate) unsafe fn runtime_state_of(vm: *mut VirtualMachine) -> *mut RuntimeState {
    // Note: raw-place read (no `&VirtualMachine` formed) — this is the
    // one accessor that may run off the VM's JS thread, which could be inside
    // a `&mut self.transpiler` borrow there; a shared `&*vm` here would alias
    // it (SB/TB-UB).
    // SAFETY: per fn contract — `vm` is live and `runtime_state` was set by
    // `init_runtime_state` to a `*mut RuntimeState`.
    unsafe { (*vm).runtime_state.cast::<RuntimeState>() }
}

/// `RareData.defaultClientSslCtx()` — lazy
/// default-trust-store client `SSL_CTX*`, shared by every `tls: true` outbound
/// connection that didn't supply explicit options.
///
/// Note: lives here (high tier) because the storage slot
/// (`RareData.default_client_ssl_ctx`) is in `bun_jsc` but population requires
/// `RuntimeState.ssl_ctx_cache` (this crate). The cached `SSL_CTX*` is held
/// for the VM's lifetime so the weak-cache entry never tombstones.
///
/// # Safety
/// `vm` must be the live per-thread VM; called only from the JS thread.
pub(crate) unsafe fn default_client_ssl_ctx(vm: *mut VirtualMachine) -> *mut bun_uws::SslCtx {
    // SAFETY: per fn contract; `rare_data()` lazy-inits the box.
    let rare = unsafe { (*vm).rare_data() };
    if rare.default_client_ssl_ctx.is_none() {
        let mut err = bun_uws::create_bun_socket_error_t::none;
        let state = runtime_state();
        debug_assert!(
            !state.is_null(),
            "default_client_ssl_ctx before init_runtime_state"
        );
        // SAFETY: per-thread `RuntimeState`; `ssl_ctx_cache` has a stable
        // address for the VM's lifetime and is only touched from the JS thread.
        let cache = unsafe { &mut (*state).ssl_ctx_cache };
        // Mode-neutral CTX (VERIFY_NONE). `us_internal_ssl_attach` overrides
        // each client SSL to VERIFY_PEER + the shared bundled-root store, so
        // `new WebSocket("wss://…")` (which shares this CTX and defaults to
        // rejectUnauthorized:true) verifies real servers. Route through the
        // weak cache so a `tls.connect()` with default options later resolves
        // to the same CTX rather than building a second one with the same
        // digest. The +1 ref returned here is held for the VM's lifetime, so
        // the entry never tombstones.
        match cache.get_or_create_opts(&Default::default(), &mut err) {
            Some(ctx) => rare.default_client_ssl_ctx = Some(ctx),
            None => bun_core::Output::panic(format_args!(
                "default client SSL_CTX init failed: {}",
                bun_core::fmt::s(err.message().unwrap_or(b"unknown")),
            )),
        }
    }
    rare.default_client_ssl_ctx.unwrap()
}

/// `RareData.sslCtxCache().getOrCreateOpts(opts, &err)` — RuntimeHooks slot
/// body. Per-VM digest-keyed weak `SSL_CTX*` cache; returns +1 ref or `None`
/// on BoringSSL rejection (`err` populated).
///
/// # Safety
/// `vm` must be the live per-thread VM; called only from the JS thread.
unsafe fn ssl_ctx_cache_get_or_create(
    _vm: *mut VirtualMachine,
    opts: &bun_uws::SocketContext::BunSocketContextOptions,
    err: &mut bun_uws::create_bun_socket_error_t,
) -> Option<*mut bun_uws::SslCtx> {
    let state = runtime_state();
    debug_assert!(
        !state.is_null(),
        "ssl_ctx_cache_get_or_create before init_runtime_state"
    );
    // SAFETY: per-thread `RuntimeState`; `ssl_ctx_cache` has a stable
    // address for the VM's lifetime and is only touched from the JS thread.
    let cache = unsafe { &mut (*state).ssl_ctx_cache };
    cache.get_or_create_opts(opts, err)
}

// ════════════════════════════════════════════════════════════════════════════
// RuntimeHooks bodies
// ════════════════════════════════════════════════════════════════════════════

/// Timer state + body hive-allocator + debugger configuration — everything
/// VM init does that names a `bun_runtime` type.
///
/// Returns `Err` when `Transpiler::init` fails — most notably when the process
/// cwd was deleted, so `getcwd` yields `ENOENT` (spec `VirtualMachine.init`
/// bubbles the same error via `try Transpiler.init(...)`). The caller
/// propagates it out of `VirtualMachine::init`, and the CLI turns it into a
/// user-facing message + non-zero exit rather than reading a zeroed
/// `vm.transpiler`.
///
/// # Safety
/// `vm` is the freshly-boxed unique VM on this thread, with `vm.global` /
/// `vm.jsc_vm` already populated by `bun_jsc::VirtualMachine::init`.
#[allow(
    clippy::large_stack_frames,
    reason = "`Transpiler::init` returns a Transpiler by value (~216 KB: its Resolver embeds \
              BSSMapInner<DirInfo, 2048>) and it is `ptr::write`n straight into `(*vm).transpiler`. \
              The copy is elided in optimized builds, and this runs once per VM init."
)]
unsafe fn init_runtime_state(
    vm: *mut VirtualMachine,
    opts: &mut InitOptions,
) -> bun_jsc::CrateResult<OpaqueRuntimeState> {
    // Note: do NOT form `&mut *vm` here — the caller
    // (`VirtualMachine::init`) may still hold a `&mut VirtualMachine` to the
    // same allocation. Dereference per-field via the raw `vm` ptr if needed.

    // Note: `uws.Loop.get().internal_loop_data.jsc_vm = vm.jsc_vm` is already
    // done by
    // the low tier (`VirtualMachine::init` writes it immediately before calling
    // this hook), so no uws wiring is repeated here.

    // Note: `heap::alloc` is paired with `heap::take` in
    // [`deinit_runtime_state`] below — called from `VirtualMachine::deinit` /
    // worker `destroy()` via the `RuntimeHooks::deinit_runtime_state` slot.
    // PORTING.md §Forbidden permits
    // `into_raw`-without-reclaim only for true process-lifetime singletons via
    // `OnceLock`, which this is not (per-VM / per-Worker-thread).
    let state = bun_core::heap::into_raw(Box::new(RuntimeState {
        timer: timer::All::init(),
        sql_rare: bun_sql_jsc::jsc::RareData {
            mysql_context: Default::default(),
            postgresql_context: Default::default(),
        },
        ssl_ctx_cache: Default::default(),
        editor_context: Default::default(),
        global_dns_data: core::cell::OnceCell::new(),
        entry_point: ServerEntryPoint::default(),
        // `borrowing_default()` wraps `mi_heap_main()` so `Transpiler`-level
        // allocations use the same heap as the global allocator and skip the
        // `mi_heap_new`/`mi_heap_destroy` pair.
        transpiler_arena: Box::new(bun_alloc::Arena::borrowing_default()),
        body_value_pool: {
            // `Box::new(ManuallyDrop::new(HiveAllocator::init()))` still builds the
            // ~100 KB pool in a stack temporary before moving it into the box (see
            // `HiveArray::new_boxed`). Allocate it on the heap and initialize it in
            // place instead — only the occupancy bitset is written.
            let pool = crate::webcore::body::HiveAllocator::new_boxed();
            // SAFETY: `new_boxed` leaks a `Box<HiveAllocator>`; reclaim ownership of
            // that same allocation. `ManuallyDrop` is `repr(transparent)`, so
            // `Box<ManuallyDrop<T>>` and `Box<T>` have identical layout — the wrapper
            // only suppresses the inner drop, which is the behavior documented on the
            // field.
            unsafe {
                Box::from_raw(
                    pool.as_ptr()
                        .cast::<core::mem::ManuallyDrop<crate::webcore::body::HiveAllocator>>(),
                )
            }
        },
        isolation_handles: IsolationHandles::default(),
    }));
    RUNTIME_STATE.with(|c| c.set(state));

    // `Timespec::now_allow_mocked_time` reads `bun_core::mock_time` directly;
    // `FakeTimers::CurrentTime::{set,clear}` write that storage so timers
    // scheduled under `jest.useFakeTimers()` use the mocked epoch.

    // ── vm.transpiler ────────────────────────────────────────────────────
    // The low-tier `VirtualMachine::init` left this field as zeroed bytes
    // (see the `alloc_zeroed` note); reading it before this write is
    // validity-invariant UB, so write via `ptr::write` (NOT assignment — the
    // zeroed bytes are not a valid `Transpiler` to drop).
    // SAFETY: `vm.log` was set to a fresh leaked `Box<Log>` by
    // `VirtualMachine::init` immediately before this hook fires.
    let log: *mut bun_ast::Log = unsafe { &*vm }
        .log
        .map(|p| p.as_ptr())
        .unwrap_or(ptr::null_mut());
    // `bun_bundler::Transpiler::init` (transpiler.rs) returns `Ok` on the
    // happy path; the `Err` arm below handles genuine failures (e.g. a deleted
    // cwd → `getcwd` ENOENT). The `ptr::write` shape is load-bearing: do not
    // replace with `(*vm).transpiler = ...` (drops zeroed bytes → UB).
    {
        use bun_options_types::schema::api;
        // Move (not clone) the caller's `TransformOptions` into the
        // `Transpiler::init` call. `InitOptions` is consumed once per VM and
        // the only post-hook reader of `transform_options` is the
        // `preserve_symlinks` line below, which reads from the moved-out
        // value before the move. Avoids deep-cloning `loaders`/
        // `entry_points`/`define` (Vec<Box<[u8]>>) on every VM init —
        // measurable on `bun -e ''` startup.
        let mut args = core::mem::take(&mut opts.transform_options);
        let preserve_symlinks = args.preserve_symlinks.unwrap_or(false);
        // Inlined `configure_transform_options_for_bun_vm`:
        args.write = Some(false);
        args.resolve = Some(api::ResolveMode::Lazy);
        args.target = Some(api::Target::Bun);
        // The arena lives on
        // `RuntimeState` (boxed above) so `deinit_runtime_state` reclaims it
        // alongside `timer`/`entry_point` on Worker teardown. The `Box`
        // payload address is stable, so a `'static` borrow is sound for the
        // `Transpiler<'static>` field — both die in VM teardown
        // (`vm.transpiler` is never dropped; see `ptr::write` note below).
        // SAFETY: `state` is the unique freshly-boxed `RuntimeState`; the
        // inner `Box<Arena>` payload is heap-stable and outlives the
        // `Transpiler` (reclaimed in `deinit_runtime_state` after the VM —
        // and hence `vm.transpiler` — is done).
        let arena: &'static bun_alloc::Arena = unsafe { &*(*state).transpiler_arena };
        // Forward `opts.env_loader` so the VM
        // shares the caller's `DotEnv.Loader` (e.g. `bun test` writes
        // `NODE_ENV=test` into it after init).
        match bun_bundler::Transpiler::init(arena, log, args, opts.env_loader.map(|p| p.as_ptr())) {
            Ok(transpiler) => {
                // SAFETY: `vm` is the unique freshly-boxed VM; `transpiler`
                // field is zero-init'd uninhabited memory (never dropped).
                unsafe { ptr::write(ptr::addr_of_mut!((*vm).transpiler), transpiler) };
                // Post-`Transpiler.init` wiring that must run BEFORE
                // `JSGlobalObject.create`. `configure_linker` MUST run
                // after the `ptr::write` above so the self-referential
                // `addr_of_mut!(self.options)` etc. captured by `Linker::init`
                // point at the final `(*vm).transpiler` storage, not the moved-
                // from stack temporary.
                // SAFETY: `vm` unique on this thread; `transpiler` just written.
                unsafe {
                    let t = &mut (*vm).transpiler;
                    t.options.emit_dce_annotations = false;
                    t.resolver.store_fd = opts.store_fd;
                    t.resolver.prefer_module_field = false;
                    // Propagate `--preserve-symlinks`
                    // from CLI args to the resolver so symlinked node_modules
                    // entries resolve via their link path (peer deps stay reachable).
                    t.resolver.opts.preserve_symlinks = preserve_symlinks;
                    t.resolver.on_wake_package_manager = bun_resolver::install_types::WakeHandler {
                        context: core::ptr::NonNull::new(ptr::addr_of_mut!((*vm).modules).cast()),
                        handler: Some(bun_jsc::async_module::Queue::on_wake_handler),
                        on_dependency_error: Some({
                            unsafe fn adapter(
                                ctx: *mut core::ffi::c_void,
                                dep: &bun_resolver::install_types::Dependency,
                                id: bun_resolver::install_types::DependencyID,
                                err: &'static str,
                            ) {
                                // SAFETY: `ctx` is the `WakeHandler::context` set just above to `&mut (*vm).modules` (a live `Queue`).
                                unsafe {
                                    bun_jsc::async_module::Queue::on_dependency_error(
                                        ctx, dep, id, err,
                                    )
                                }
                            }
                            adapter
                        }),
                    };
                    // Branch on `opts.graph` here — with a module graph,
                    // auto_jsx=true would
                    // `read_dir_info(cwd)` and cache its tsconfig.json BEFORE
                    // `apply_standalone_runtime_flags` can set
                    // `resolver.opts.load_tsconfig_json = false`, defeating
                    // `compile.autoloadTsconfig: false`.
                    if opts.graph.is_some() {
                        t.configure_linker_with_auto_jsx(false);
                    } else {
                        t.configure_linker();
                    }
                }
            }
            Err(e) => {
                // The most common trigger is a deleted cwd → `getcwd` ENOENT
                // (resolver/lib.rs). `vm.transpiler` was never written, so
                // returning `Err` here leaves it as the zeroed bytes the low
                // tier allocated — and the caller aborts `init` before anything
                // reads the field, instead of surfacing it as a segfault.
                //
                // Unwind the per-VM state this hook set up before the
                // `Transpiler::init` attempt: the `RuntimeState` box + its TLS
                // slot (set above) and the thread-local AST stores that
                // `Transpiler::init_in_place` `create()`d before it failed.
                // Mirrors `deinit_runtime_state`, which is the teardown the
                // `Ok` path would otherwise reach.
                RUNTIME_STATE.with(|c| c.set(ptr::null_mut()));
                // SAFETY: `state` is the unique `heap::into_raw` result from the
                // top of this fn; the TLS slot was just nulled so no other live
                // alias exists on this thread.
                drop(unsafe { bun_core::heap::take(state.cast::<RuntimeState>()) });
                bun_ast::expr::data::Store::deinit();
                bun_ast::stmt::data::Store::deinit();
                return Err(e.into());
            }
        }
    }

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
        // SAFETY: `vm` is the freshly-boxed unique VM on this thread.
        unsafe { configure_debugger(vm, &opts.debugger) };
        // SAFETY: `vm` unique; `jsc_vm`/`debugger` written above.
        unsafe { configure_sigusr1_handler(vm, opts) };
    }

    Ok(state.cast())
}

/// Install (or suppress) the SIGUSR1 runtime-inspector handler on the main
/// thread. Must run after [`configure_debugger`] so the `vm.debugger.is_some()`
/// check reflects `--inspect*` flags.
///
/// The per-VM trap callback is NOT installed here: `init_runtime_state` fires
/// before `vm.jsc_vm` is set (same ordering as the `ParentDeathWatchdog` note
/// above). It is installed lazily in `request_inspector_activation()` once
/// `jsc_vm` is available.
///
/// # Safety
/// `vm` is the freshly-boxed unique VM on this thread.
unsafe fn configure_sigusr1_handler(vm: *mut VirtualMachine, opts: &InitOptions) {
    // SAFETY: per fn contract.
    if !unsafe { (*vm).is_main_thread } {
        return;
    }
    use bun_jsc::runtime_inspector;
    // SAFETY: per fn contract.
    unsafe { (*vm).inspect_port = opts.inspect_port };
    // On platforms where JSC's GC uses SIGUSR1 for thread suspend/resume
    // (e.g. FreeBSD), replacing that handler would hang the first
    // conservative stack scan. Leave the GC handler in place; runtime
    // activation via `process._debugProcess` (Windows-style file mapping is
    // not available here either) is simply unsupported on those platforms.
    if runtime_inspector::gc_owns_sigusr1() {
        return;
    }
    if opts.disable_sigusr1 {
        runtime_inspector::set_default_sigusr1_action();
        // SAFETY: per fn contract; `debugger` written by `configure_debugger`.
    } else if unsafe { (*vm).debugger.is_some() } {
        runtime_inspector::ignore_sigusr1();
    } else {
        runtime_inspector::install_if_not_already();
    }
}

/// Translate the CLI flag /
/// `BUN_INSPECT*` env vars into `vm.debugger = Some(Debugger { .. })` so
/// `ensure_debugger` (below) actually starts the inspector.
///
/// # Safety
/// `vm` is the freshly-boxed unique VM on this thread; `vm.transpiler` has
/// been written by [`init_runtime_state`] (the post-`isInspectorEnabled` tail
/// touches `transpiler.options`).
unsafe fn configure_debugger(
    vm: *mut VirtualMachine,
    cli_flag: &bun_options_types::context::Debugger,
) {
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
                    wait_for_connection,
                    set_breakpoint_on_first_line,
                    ..Default::default()
                })
            } else if !connect_to.is_empty() {
                Some(Debugger {
                    path_or_port: None,
                    from_environment_variable: connect_to,
                    wait_for_connection: Wait::Off,
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
                wait_for_connection: if enable.wait_for_connection {
                    Wait::Forever
                } else {
                    wait_for_connection
                },
                set_breakpoint_on_first_line: set_breakpoint_on_first_line
                    || enable.set_breakpoint_on_first_line,
                ..Default::default()
            })
        }
    };

    let Some(debugger) = debugger else { return };
    let mode = debugger.mode;
    // SAFETY: `vm` is the unique freshly-boxed VM; sole writer.
    unsafe { (*vm).debugger = Some(Box::new(debugger)) };

    // The inspector is always enabled at this point, so disable the cache
    // unconditionally.
    bun_jsc::runtime_transpiler_cache::IS_DISABLED
        .store(true, core::sync::atomic::Ordering::Relaxed);
    if mode != Mode::Connect {
        // SAFETY: `vm` unique; `transpiler` written above in `init_runtime_state`.
        unsafe {
            let opts = &mut (*vm).transpiler.options;
            opts.minify_identifiers = false;
            opts.minify_syntax = false;
            opts.minify_whitespace = false;
            opts.debugger = true;
        }
    }
}

/// Reclaim the per-VM [`RuntimeState`] boxed in [`init_runtime_state`]. Called
/// from `VirtualMachine::deinit` / worker `destroy()` with the opaque pointer
/// returned by `init_runtime_state`. Clears the thread-local and drops the
/// `Box`, freeing `timer` + `entry_point`.
///
/// # Safety
/// `state` must be the exact pointer returned by [`init_runtime_state`] for
/// this thread (or null), and must not be used again after this call.
unsafe fn deinit_runtime_state(_vm: *mut VirtualMachine, state: OpaqueRuntimeState) {
    RUNTIME_STATE.with(|c| c.set(ptr::null_mut()));
    // Free the per-thread `TRANSPILE_PRINTER`. Workers lazy-init their own
    // copy in `transpile_file` / `transpile_virtual_module`; without this
    // each worker thread strands a `Box<BufferPrinter>` (mirrors the
    // `SOURCE_CODE_PRINTER.take()` in `VirtualMachine::destroy`).
    let printer = TRANSPILE_PRINTER.with(|c| c.replace(ptr::null_mut()));
    if !printer.is_null() {
        // SAFETY: `printer` was produced by `heap::into_raw` in
        // `transpile_file`/`transpile_virtual_module` and is exclusively
        // owned by this thread; the TLS slot was just nulled so no other
        // alias exists.
        drop(unsafe { bun_core::heap::take(printer) });
    }
    if !state.is_null() {
        // SAFETY: per fn contract — `state` is the unique `heap::alloc` result
        // from `init_runtime_state`; the TLS was just cleared so no other live
        // alias exists on this thread.
        drop(unsafe { bun_core::heap::take(state.cast::<RuntimeState>()) });
    }
    // Free the thread-local AST stores allocated by `Transpiler::init_in_place`
    // (via `Store::create()`). They live in TLS without a Drop, so each worker
    // thread strands a `Box<Store>` plus its lazily-allocated block chain when
    // the thread exits. `deinit()` is a no-op if a bundler arena currently owns
    // the allocator (`memory_allocator()` non-null) or the store was never
    // created. After the `RuntimeState` drop above nothing on this thread
    // touches the stores again.
    bun_ast::expr::data::Store::deinit();
    bun_ast::stmt::data::Store::deinit();
}

/// `ServerEntryPoint.generate(watch, entry_path)` — produces the synthetic
/// `bun:main` wrapper. Returns `false` on error (the error is already logged
/// into `vm.log` by `generate`).
fn generate_entry_point(_vm: &VirtualMachine, watch: bool, entry_path: &[u8]) -> bool {
    let state = runtime_state();
    if state.is_null() {
        return false;
    }
    // SAFETY: `state` is the live per-thread `RuntimeState` (boxed in
    // `init_runtime_state`); no other `&mut` to `entry_point` is held here.
    ServerEntryPoint::generate(unsafe { &mut (*state).entry_point }, watch, entry_path).is_ok()
}

/// `loadPreloads()` — runs `--preload` scripts. Returns the first rejected
/// preload promise if any, else null.
///
/// Error mapping: resolver `Failure` returns the resolver error,
/// `Pending`/`NotFound` returns `error.ModuleNotFound`,
/// `JSModuleLoader.import` throwing returns `error.JSError`.
///
/// # Safety
/// `vm` is the live per-thread VM.
unsafe fn load_preloads(vm: *mut VirtualMachine) -> bun_jsc::CrateResult<*mut JSInternalPromise> {
    // Note: reshaped for borrowck — `wait_for_promise` / `event_loop().tick()`
    // need `&mut VirtualMachine` while we're also iterating `vm.preload` and
    // touching `vm.transpiler.resolver` / `vm.log`. Dereference per-field via
    // the raw `vm` ptr; iterate preloads by index (the `Box<[u8]>` payloads are
    // heap-stable so a raw `*const [u8]` survives the resolver borrow).

    // ── is_in_preload guard ─────────────────────────────────────────────
    // SAFETY: per fn contract — `vm` is the live per-thread VM.
    unsafe { (*vm).is_in_preload = true };
    // Note: copy the raw ptr into a guard-owned local so the defer body
    // doesn't borrow the fn param — later `(*vm).pending_internal_promise = …`
    // would otherwise alias the guard's capture.
    let vm_for_guard = vm;
    scopeguard::defer! {
        // SAFETY: per fn contract.
        unsafe { (*vm_for_guard).is_in_preload = false };
    }

    // SAFETY: `vm.global` is set during `VirtualMachine::init` and outlives the VM.
    let global: *mut JSGlobalObject = unsafe { &*vm }.global;
    // `vm.transpiler` (hence `transpiler.fs`) is always initialized here:
    // `init_runtime_state` returns `Err` on `Transpiler::init`
    // failure and `VirtualMachine::init` propagates it via `?`, so a VM that
    // failed to build its transpiler never reaches `load_preloads` (this hook
    // only runs via `reload_entry_point*`, which operate on an already-`Ok` VM).
    let top_level_dir: *const [u8] = Fs::FileSystem::get().top_level_dir;
    // SAFETY: per fn contract.
    let global_cache = if unsafe { &*vm }.standalone_module_graph.is_none() {
        GlobalCache::read_only
    } else {
        GlobalCache::disable
    };

    // SAFETY: per fn contract.
    let n = unsafe { &*vm }.preload.len();
    for i in 0..n {
        // SAFETY: `i < n`; the `Box<[u8]>` allocation is stable across the
        // `resolve_and_auto_install` call below (which only touches
        // `vm.transpiler.resolver`, not `vm.preload`).
        let preload: *const [u8] = unsafe { &raw const *(&(*vm).preload)[i] };
        // SAFETY: `preload` points at a live boxed slice for this iteration
        // (heap-stable `Box<[u8]>` payload; nothing below mutates `vm.preload`).
        let preload_slice: &[u8] = unsafe { &*preload };
        // Strip "file://".
        let normalized: &[u8] = preload_slice
            .strip_prefix(b"file://".as_slice())
            .unwrap_or(preload_slice);

        // node: builtin specifiers bypass the file resolver — JSModuleLoader
        // resolves them internally. node:worker_threads is preloaded this way so
        // its node-style worker bootstrap (stdio rebinding) runs before user code;
        // this also means `bun --import node:*` works like Node's.
        let module_name = if normalized.starts_with(b"node:") {
            bun_core::String::from_bytes(normalized)
        } else {
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
                    // SAFETY: `vm.log` was set to a fresh leaked `Box<Log>` by
                    // `VirtualMachine::init`.
                    if let Some(log) = unsafe { &*vm }.log {
                        // SAFETY: `log` is the unique per-VM `Box<Log>`.
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
                ResolveResultUnion::Pending(_) | ResolveResultUnion::NotFound => {
                    // SAFETY: see above.
                    if let Some(log) = unsafe { &*vm }.log {
                        // SAFETY: `log` is the unique per-VM `Box<Log>`.
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
            bun_core::String::from_bytes(path_text)
        };
        // Note: use `import_ptr` (not `import`) so the `*mut` we store in
        // `pending_internal_promise` keeps the FFI's mutable provenance instead
        // of being laundered through `&JSInternalPromise -> *const -> *mut`
        // (UB to write through under Stacked Borrows).
        let promise: *mut JSInternalPromise = match JSModuleLoader::import_ptr(global, &module_name)
        {
            Ok(p) => p.as_ptr(),
            Err(_) => {
                // The exception is
                // already pending on `global`; bubble the tag so
                // `reload_entry_point` forwards it.
                return Err(bun_jsc::CrateError::JSError);
            }
        };

        // SAFETY: per fn contract.
        unsafe { (*vm).pending_internal_promise = Some(promise) };
        let _protected = JSValue::from_cell(promise).protected();

        // ── wait ────────────────────────────────────────────────────────
        // HMR `pending_internal_promise` swap loop; non-watcher path uses
        // `wait_for_promise` directly.
        {
            // SAFETY: per fn contract.
            if unsafe { &*vm }.is_watcher_enabled() {
                // pending_internal_promise can change if hot module reloading is
                // enabled.
                // SAFETY: `el` is the live per-thread event loop.
                let el = unsafe { &*vm }.event_loop();
                // SAFETY: `el` is the live per-thread event loop.
                unsafe { (*el).perform_gc() };
                loop {
                    // SAFETY: `pending_internal_promise` was set just above (or
                    // swapped by HMR to another live cell); `status()` is a
                    // read-only FFI call on a live JSC heap cell.
                    let pip = unsafe { &*vm }.pending_internal_promise.unwrap_or(promise);
                    // SAFETY: `pip` is a live JSC heap cell (set just above or
                    // the protected `promise` fallback).
                    if unsafe { &*pip }.status() != PromiseStatus::Pending {
                        break;
                    }
                    // SAFETY: `el` is the live per-thread event loop.
                    unsafe { (*el).tick() };
                    // SAFETY: per fn contract — `vm` is the live per-thread VM.
                    let pip = unsafe { &*vm }.pending_internal_promise.unwrap_or(promise);
                    // SAFETY: `pip` is a live JSC heap cell (see above).
                    if unsafe { &*pip }.status() == PromiseStatus::Pending {
                        // SAFETY: per fn contract — short-lived `&mut *vm` for the
                        // dispatched `auto_tick` hook (same shape as the
                        // non-watcher `wait_for_promise` arm).
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
        }

        // SAFETY: `promise` is a live (still-protected) JSC heap cell.
        if unsafe { &*promise }.status() == PromiseStatus::Rejected {
            return Ok(promise);
        }
        // `_protected` drops here → unprotect.
    }

    // Under --isolate each test file gets
    // a fresh global, so preloads must re-execute for every file. Otherwise,
    // only load preloads once.
    // SAFETY: per fn contract.
    if !unsafe { &*vm }.test_isolation_enabled {
        // `Vec::clear` drops the `Box<[u8]>`
        // payloads but keeps capacity.
        // SAFETY: per fn contract — `vm` is the live per-thread VM.
        unsafe { (*vm).preload.clear() };
    }

    Ok(ptr::null_mut())
}

/// `ensureDebugger(block_until_connected)` — no-op when no debugger.
///
/// # Safety
/// `vm` is the live per-thread VM.
unsafe fn ensure_debugger(vm: *mut VirtualMachine, block_until_connected: bool) {
    // Note: `Debugger::create` / `wait_for_debugger_if_necessary` live in
    // `bun_jsc::debugger::Debugger` (Debugger.rs); the heavy bodies (futex
    // spin, debugger-thread spawn, deadline poll-loop) are there. This hook
    // is the literal `ensureDebugger` body — it owns the "is a debugger
    // configured?" guard and the `block_until_connected` branch, then
    // delegates to those two fns.
    // SAFETY: `vm` is the live per-thread VM.
    if unsafe { &*vm }.debugger.is_none() {
        return;
    }
    // SAFETY: `vm.global` is set during `VirtualMachine::init` and outlives
    // the VM; read the raw ptr before forming `&mut *vm` so the two derefs
    // don't alias.
    let global = unsafe { &*vm }.global;
    // `Debugger::create` can fail (OOM / thread-spawn). The hook signature is
    // `()`, so log via `Output::err` (same shape as the `Transpiler::init`
    // error path above) and return without blocking.
    // SAFETY: `global` is a live JSC heap cell (`JSGlobalObject`); `vm` is the
    // live per-thread VM (raw-ptr receiver — `create` re-enters JS).
    if let Err(e) = bun_jsc::debugger::Debugger::create(vm, unsafe { &*global }) {
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
///
/// # Safety
/// `vm` is the live per-thread VM.
unsafe fn auto_tick(vm: *mut VirtualMachine) {
    // Note: reshaped for borrowck — `EventLoop` is a value field of
    // `VirtualMachine`, so holding `&mut EventLoop` while also touching VM
    // siblings would alias. Dereference per-field via the raw `vm` ptr.
    // SAFETY: per fn contract — `vm` is the live per-thread VM.
    let el: *mut bun_jsc::event_loop::EventLoop = unsafe { &*vm }.event_loop;
    // SAFETY: `el` is the live per-thread event loop (field of `*vm`).
    let loop_ = unsafe { (*el).usockets_loop() };

    // ── tick_immediate_tasks ────────────────────────────────────────────
    // After this call `immediate_tasks` reflects next-tick immediates, so
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
        // SAFETY: per fn contract. `swap(0)` so a concurrent
        // `increment_pending_unref_counter()` (cross-thread, see
        // `KeepAlive::unref_on_next_tick_concurrently`) can't be lost between
        // the read and the reset.
        let pending_unref = unsafe { &*vm }
            .pending_unref_counter
            .swap(0, core::sync::atomic::Ordering::Relaxed);
        if pending_unref > 0 {
            // SAFETY: `loop_` is the live per-thread uws loop.
            unsafe { (*loop_).unref_count(pending_unref) };
        }
    }

    // ── DateHeaderTimer / imminent-GC ───────────────────────────────────
    let state = runtime_state();
    if !state.is_null() {
        // SAFETY: `state` is the live per-thread `RuntimeState`; `loop_` is the
        // live per-thread uws loop; `vm` per fn contract. The re-entrant
        // `All::insert`/`update` inside `DateHeaderTimer::enable` touches only
        // fields disjoint from `date_header_timer` (raw-ptr-per-field pattern,
        // same as `Bun__internal_ensureDateHeaderTimerIsEnabled`).
        unsafe {
            (*state)
                .timer
                .update_date_header_timer_if_necessary(&*loop_, vm)
        };
    }
    // SAFETY: `el` is the live per-thread event loop.
    unsafe { (*el).run_imminent_gc_timer() };

    // ── poll the I/O loop with the next-timer deadline ──────────────────
    if state.is_null() {
        // No high-tier state (unit test) — fall back to a non-blocking I/O
        // poll. The uws loop must always be polled
        // (`tickWithTimeout`/`tickWithoutIdle`); `EventLoop::tick()` would only
        // drain JS tasks and never touch kqueue/epoll.
        // SAFETY: `loop_` is the live per-thread uws loop.
        unsafe { (*loop_).tick_without_idle() };
        // Still run the post-poll hooks.
        // SAFETY: per fn contract.
        unsafe { (*vm).on_after_event_loop() };
        // SAFETY: `vm.global` is set during `VirtualMachine::init` and outlives the VM.
        unsafe { (*(*vm).global).handle_rejected_promises() };
        return;
    }

    // Call `ctx.timer.getTimeout(..)` ONLY inside
    // `if (loop.isActive())` — `get_timeout` has side effects (pops + fires
    // due `WTFTimer` heap entries), so it must stay guarded by `is_active()`
    // rather than running unconditionally.
    {
        // Read `immediate_tasks` AFTER
        // `tickImmediateTasks` swaps `next_immediate_tasks` in, so this
        // reflects next-tick immediates (queued during the drain above).
        // SAFETY: `el` is the live per-thread event loop.
        let has_pending_immediate = !unsafe { &*el }.immediate_tasks.is_empty();
        // Fold the QUIC deadline into the poll timeout.
        // SAFETY: `loop_` is the live per-thread uws loop.
        let quic_next_tick_us = unsafe {
            let ild = &(*loop_).internal_loop_data;
            if ild.quic_head.is_null() {
                None
            } else {
                Some(ild.quic_next_tick_us)
            }
        };
        let mut timespec = bun_core::Timespec { sec: 0, nsec: 0 };
        // SAFETY: `loop_` is the live per-thread uws loop.
        if unsafe { (*loop_).is_active() } {
            // Before `get_timeout`, not after: both of these can arm the GC timer, and a
            // timer armed after the poll deadline is computed is not in that deadline.
            // SAFETY: `el` is the live per-thread event loop.
            unsafe { (*el).drain_pending_gc_hint() };
            // SAFETY: `el` is the live per-thread event loop.
            unsafe { (*el).process_gc_timer() };
            // Note (§Forbidden aliased-&mut): `get_timeout` may fire a
            // `WTFTimer` JS callback.
            // A re-entrant `setTimeout`/`clearTimeout` reaches
            // `timer::All::insert`/`remove` via `runtime_state()` and would
            // mint a second `&mut timer` if we held `&mut (*state).timer`
            // across the call. Pass the raw `*mut Self` instead;
            // `timer::All::get_timeout` forms short-lived `&mut` only around
            // heap ops that cannot re-enter JS, releasing the borrow before
            // invoking `fire()`.
            // `get_timeout` reads CLOCK_MONOTONIC to compare against the timer heap; hand that
            // same reading to the tick for the park hook's idle-sweep rate limit. It is lazy,
            // and so is the hook: NOW_NS_UNKNOWN means it took none.
            let mut now: Option<bun_core::Timespec> = None;
            // SAFETY: `state` is the live per-thread `RuntimeState`; the
            // `timer` field address is stable for the VM lifetime.
            let have_timeout = unsafe {
                timer::All::get_timeout(
                    &mut (*state).timer,
                    &mut timespec,
                    has_pending_immediate,
                    quic_next_tick_us,
                    vm.cast(),
                    &mut now,
                )
            };
            let now_ns = now.map_or(bun_uws::NOW_NS_UNKNOWN, |t| t.ns());
            // SAFETY: `loop_` is the live per-thread uws loop.
            unsafe {
                (*loop_)
                    .tick_with_timeout(if have_timeout { Some(&timespec) } else { None }, now_ns)
            };
        } else {
            // SAFETY: `loop_` is the live per-thread uws loop.
            unsafe { (*loop_).tick_without_idle() };
        }
    }

    #[cfg(unix)]
    {
        // Note (§Forbidden aliased-&mut): `drain_timers` fires user
        // `setTimeout` callbacks which may re-enter `timer::All::insert`/
        // `remove` via `runtime_state()`. Pass raw `*mut Self` so no
        // long-lived `&mut (*state).timer` is held across `fire()`;
        // `drain_timers` forms short-lived `&mut` only around heap pop/peek.
        // SAFETY: `state` is the live per-thread `RuntimeState`; the `timer`
        // field address is stable for the VM lifetime.
        unsafe { timer::All::drain_timers(&mut (*state).timer, vm.cast()) };
    }
    #[cfg(not(unix))]
    let _ = state;

    // SAFETY: per fn contract.
    unsafe { (*vm).on_after_event_loop() };
    // SAFETY: `vm.global` is set during `VirtualMachine::init` and outlives the VM.
    unsafe { (*(*vm).global).handle_rejected_promises() };
}

/// `eventLoop().autoTickActive()`. Same shape as
/// [`auto_tick`] but: no `runImminentGCTimer`, no `handleRejectedPromises` at
/// the tail, and no debug sleep-timer logging. Used by `bun_main` /
/// `on_before_exit` drain loops where blocking when the loop is idle would
/// hang shutdown.
///
/// # Safety
/// `vm` is the live per-thread VM.
unsafe fn auto_tick_active(vm: *mut VirtualMachine) {
    // Note: reshaped for borrowck — see `auto_tick` above.
    // SAFETY: per fn contract — `vm` is the live per-thread VM.
    let el: *mut bun_jsc::event_loop::EventLoop = unsafe { &*vm }.event_loop;
    // SAFETY: `el` is the live per-thread event loop (field of `*vm`).
    let loop_ = unsafe { (*el).usockets_loop() };

    // SAFETY: `el` is the live per-thread event loop; `vm` per fn contract.
    unsafe { (*el).tick_immediate_tasks(vm) };
    #[cfg(windows)]
    if !unsafe { &*el }.immediate_tasks.is_empty() {
        // SAFETY: `el` is the live per-thread event loop.
        unsafe { (*el).wakeup() };
    }

    #[cfg(unix)]
    {
        // SAFETY: per fn contract. `swap(0)` so a concurrent
        // `increment_pending_unref_counter()` (cross-thread, see
        // `KeepAlive::unref_on_next_tick_concurrently`) can't be lost between
        // the read and the reset.
        let pending_unref = unsafe { &*vm }
            .pending_unref_counter
            .swap(0, core::sync::atomic::Ordering::Relaxed);
        if pending_unref > 0 {
            // SAFETY: `loop_` is the live per-thread uws loop.
            unsafe { (*loop_).unref_count(pending_unref) };
        }
    }

    let state = runtime_state();
    if !state.is_null() {
        // SAFETY: see the matching call in `auto_tick` above.
        unsafe {
            (*state)
                .timer
                .update_date_header_timer_if_necessary(&*loop_, vm)
        };
    }

    if state.is_null() {
        // SAFETY: `loop_` is the live per-thread uws loop.
        unsafe { (*loop_).tick_without_idle() };
        // SAFETY: per fn contract.
        unsafe { (*vm).on_after_event_loop() };
        return;
    }

    {
        // SAFETY: `el` is the live per-thread event loop.
        let has_pending_immediate = !unsafe { &*el }.immediate_tasks.is_empty();
        // SAFETY: `loop_` is the live per-thread uws loop.
        let quic_next_tick_us = unsafe {
            let ild = &(*loop_).internal_loop_data;
            if ild.quic_head.is_null() {
                None
            } else {
                Some(ild.quic_next_tick_us)
            }
        };
        let mut timespec = bun_core::Timespec { sec: 0, nsec: 0 };
        // SAFETY: `loop_` is the live per-thread uws loop.
        if unsafe { (*loop_).is_active() } {
            // Before `get_timeout` — see the matching call in `auto_tick`.
            // SAFETY: `el` is the live per-thread event loop.
            unsafe { (*el).drain_pending_gc_hint() };
            // SAFETY: `el` is the live per-thread event loop.
            unsafe { (*el).process_gc_timer() };
            // `get_timeout` reads CLOCK_MONOTONIC to compare against the timer heap; hand that
            // same reading to the tick for the park hook's idle-sweep rate limit. It is lazy,
            // and so is the hook: NOW_NS_UNKNOWN means it took none.
            let mut now: Option<bun_core::Timespec> = None;
            // SAFETY: `state` is the live per-thread `RuntimeState`; see
            // Note on `auto_tick` re: aliased-&mut across `fire()`.
            let have_timeout = unsafe {
                timer::All::get_timeout(
                    &mut (*state).timer,
                    &mut timespec,
                    has_pending_immediate,
                    quic_next_tick_us,
                    vm.cast(),
                    &mut now,
                )
            };
            let now_ns = now.map_or(bun_uws::NOW_NS_UNKNOWN, |t| t.ns());
            // SAFETY: `loop_` is the live per-thread uws loop.
            unsafe {
                (*loop_)
                    .tick_with_timeout(if have_timeout { Some(&timespec) } else { None }, now_ns)
            };
        } else {
            // SAFETY: `loop_` is the live per-thread uws loop.
            unsafe { (*loop_).tick_without_idle() };
        }
    }

    #[cfg(unix)]
    {
        // SAFETY: `state` is the live per-thread `RuntimeState`; see Note
        // on `auto_tick` re: aliased-&mut across `fire()`.
        unsafe { timer::All::drain_timers(&mut (*state).timer, vm.cast()) };
    }
    #[cfg(not(unix))]
    let _ = state;

    // SAFETY: per fn contract.
    unsafe { (*vm).on_after_event_loop() };
}

/// `printException` / `printErrorlikeObject` — formats `value` to stderr via
/// `ConsoleObject::Formatter`. Dispatched here so the high tier owns the
/// formatter.
fn print_exception(
    vm_ref: &mut VirtualMachine,
    value: JSValue,
    exception_list: Option<&mut bun_jsc::virtual_machine::ExceptionList>,
) {
    // The print half of `runErrorHandler`
    // (the `had_errors` save/restore lives in the low-tier caller). Route via
    // the buffered error writer; `defer writer.flush()` becomes a tail call —
    // no early returns below.
    let writer = bun_core::Output::error_writer_buffered();

    let global = vm_ref.global();

    if let Some(exception) = value.as_exception(vm_ref.jsc_vm) {
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
/// `vm` is a live `VirtualMachine`; `t` points at a live unlinked
/// `EventLoopTimer`.
unsafe fn timer_insert(
    vm: *mut VirtualMachine,
    t: *mut bun_event_loop::EventLoopTimer::EventLoopTimer,
) {
    // SAFETY: per fn contract.
    let state = unsafe { runtime_state_of(vm) };
    debug_assert!(!state.is_null(), "timer_insert before init_runtime_state");
    // SAFETY: this leaf hook runs no JS, so a short-lived `&mut RuntimeState`
    // does not alias anything. `Timer::All::insert` re-derefs `t` per-field.
    unsafe { &mut (*state).timer }.insert(t);
}

/// `vm.timer.remove(timer)` — counterpart to [`timer_insert`].
///
/// # Safety
/// `t` points at a live `EventLoopTimer` currently linked into the heap.
unsafe fn timer_remove(
    vm: *mut VirtualMachine,
    t: *mut bun_event_loop::EventLoopTimer::EventLoopTimer,
) {
    // SAFETY: per fn contract.
    let state = unsafe { runtime_state_of(vm) };
    debug_assert!(!state.is_null(), "timer_remove before init_runtime_state");
    // SAFETY: see `timer_insert` — leaf hook, short-lived `&mut RuntimeState`.
    unsafe { &mut (*state).timer }.remove(t);
}

/// `Node.fs.NodeFS{ .vm = … }` lazy creation.
/// The low tier stores the result in `vm.node_fs: Option<*mut c_void>`.
///
/// # Safety
/// `vm` is the live per-thread VM. The returned box is reclaimed (if at all)
/// only by VM teardown.
unsafe fn create_node_fs(vm: *mut VirtualMachine) -> *mut c_void {
    use crate::node::fs::NodeFS;
    // `.vm` is set only when standalone-module-graph is active
    // (it gates the embedded-file `Bun.file()` lookups inside `node:fs`).
    // SAFETY: per fn contract.
    let vm_field = if unsafe { &*vm }.standalone_module_graph.is_some() {
        core::ptr::NonNull::new(vm)
    } else {
        None
    };
    bun_core::heap::into_raw(Box::new(NodeFS {
        sync_error_buf: bun_paths::PathBuffer::uninit(),
        vm: vm_field,
    }))
    .cast::<c_void>()
}

/// `WebCore.ObjectURLRegistry.singleton().has(specifier["blob:".len..])`.
fn has_blob_url(blob_id: &[u8]) -> bool {
    crate::webcore::object_url_registry::ObjectURLRegistry::singleton().has(blob_id)
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
    if let Some(resp) = value.as_::<crate::webcore::Response>() {
        // SAFETY: `as_` returned the live `m_ctx` payload of a JS-heap
        // `Response` cell pinned by `value` for the duration of this call.
        return Ok(Some(
            unsafe { &mut *resp }.get_blob_without_call_frame(global)?,
        ));
    }
    if let Some(req) = value.as_::<crate::webcore::Request>() {
        // SAFETY: see above.
        return Ok(Some(
            unsafe { &mut *req }.get_blob_without_call_frame(global)?,
        ));
    }
    Ok(None)
}

/// `process.exit(code)`. Main-thread is `noreturn`; in a
/// worker it returns and the caller `panic!`s.
///
/// # Safety
/// `global` is the live VM global.
unsafe fn process_exit(global: *mut JSGlobalObject, code: u8) {
    // SAFETY: per fn contract — `global` is the live VM global. The deref is
    // performed once here in the hook shim so the user-facing `process::exit`
    // can take a safe `&JSGlobalObject`.
    crate::node::process::exit(unsafe { &*global }, code);
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
/// hands out the `*mut` directly from the backing `UnsafeCell`, which is the
/// same path every other mutating caller (`node_fs`, `Blob`) uses.
///
/// Called on the JS thread; `Graph::find` / `LazySourceMap::load` only mutate
/// the per-`File` lazy caches (sourcemap decode is serialized by `INIT_LOCK`).
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

/// `node_cluster_binding.handleInternalMessageChild(global, data)` — the
/// `IPCInstance.handleIPCMessage` `.internal` arm.
///
/// # Safety
/// `global` is the live VM global; called on the JS thread inside an
/// `event_loop.enter()` scope.
unsafe fn handle_ipc_internal_child(global: *mut JSGlobalObject, data: JSValue) {
    // SAFETY: per fn contract.
    let global = unsafe { &*global };
    // Spec discards a JS exception here (`catch |err| switch (err) {
    // error.JSError => {} }`); the low tier already wrapped this call in
    // `event_loop.enter()/exit()` which clears any pending exception, so
    // dropping the `Err` is correct.
    let _ = crate::node::node_cluster_binding::handle_internal_message_child(
        global,
        data,
        JSValue::UNDEFINED,
    );
}

/// `node_cluster_binding.child_singleton.deinit()` —
/// `IPCInstance.handleIPCClose`.
///
/// Called on the JS thread (the `CHILD_SINGLETON` static is JS-thread-only).
fn ipc_child_singleton_deinit() {
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
    use bun_resolver::package_json::PackageJSON;

    /// Recover an [`OpaqueBlob`] as a shared `&Blob` (live until `blob_deinit`).
    ///
    /// # Safety
    /// `b` was produced by `resolve_blob` and not yet passed to `blob_deinit`.
    #[inline]
    unsafe fn blob(b: OpaqueBlob) -> &'static Blob {
        // SAFETY: per fn contract.
        unsafe { &*b.cast::<Blob>() }
    }

    // `this: *mut VirtualMachine`. Bodies use raw place projections —
    // `(*this).field` — so no `&VirtualMachine` retag is materialized for the
    // simple field reads. This matters because `read_dir_info_package_json`
    // holds a live `&mut transpiler.resolver` across a re-entrant `read_dir_info`
    // that can call back into these hooks; a `&VirtualMachine` formed here would
    // alias that `&mut` (SB/TB UB). The two accessors that call `&self` methods
    // (`main`, `blob_loader`) form a transient `&VirtualMachine` scoped to the
    // single call, which never spans the re-entrant path.
    bun_bundler::link_impl_VmLoaderCtx! {
        Runtime for VirtualMachine => |this| {
            origin_host() => (*this).origin.host,
            origin_path() => (*this).origin.path,
            loaders() => &raw const (*this).transpiler.options.loaders,
            eval_source() => (*this)
                .module_loader
                .eval_source
                .as_deref()
                .map(core::ptr::from_ref::<bun_ast::Source>),
            main() => &*core::ptr::from_ref::<[u8]>((*this).main()),
            read_dir_info_package_json(dir) => {
                // Short-lived `&mut Resolver` (not `&mut VirtualMachine`) for
                // the call — narrows the borrow re-entrant JS could alias.
                match (*this).transpiler.resolver.read_dir_info(dir) {
                    Ok(Some(dir_info)) => {
                        dir_info
                            .package_json()
                            .or(dir_info.enclosing_package_json)
                            .map(core::ptr::from_ref::<PackageJSON>)
                    }
                    _ => None,
                }
            },
            is_blob_url(spec) => crate::webcore::object_url_registry::is_blob_url(spec),
            resolve_blob(spec) => {
                crate::webcore::object_url_registry::ObjectURLRegistry::singleton()
                    .resolve_and_dupe(spec)
                    .map(|b| bun_core::heap::into_raw(Box::new(b)).cast::<()>())
            },
            blob_loader(b) => blob(b).get_loader(&*this),
            // Returned slices borrow blob heap storage that lives until
            // `blob_deinit`; erased to `'static` per the interface signature —
            // sound because the bundler caller drops them before `blob_deinit`.
            blob_file_name(b) => blob(b)
                .get_file_name()
                .map(|s| core::slice::from_raw_parts(s.as_ptr(), s.len())),
            blob_needs_read_file(b) => blob(b).needs_to_read_file(),
            blob_shared_view(b) => {
                let v = blob(b).shared_view();
                core::slice::from_raw_parts(v.as_ptr(), v.len())
            },
            blob_deinit(b) => {
                // SAFETY: `b` is the live boxed `Blob`; sole owner.
                drop(bun_core::heap::take(b.cast::<Blob>()))
            },
        }
    }
}

/// The static `RuntimeHooks` instance handed to `bun_jsc`.
#[unsafe(no_mangle)]
pub(crate) static __BUN_RUNTIME_HOOKS: RuntimeHooks = RuntimeHooks {
    init_runtime_state,
    deinit_runtime_state,
    generate_entry_point,
    load_preloads,
    ensure_debugger,
    auto_tick,
    auto_tick_active,
    print_exception,
    timer_insert,
    timer_remove,
    default_client_ssl_ctx,
    ssl_ctx_cache_get_or_create,
    create_node_fs,
    has_blob_url,
    body_mixin_get_blob,
    process_exit,
    handle_ipc_internal_child,
    ipc_child_singleton_deinit,
    console_on_before_print,
    console_print_runtime_object,
    load_standalone_sourcemap,
    apply_standalone_runtime_flags,
    parse_worker_exec_argv_allow_addons,
    cron_clear_all_teardown,
    cron_clear_all_reload,
    terminate_all_workers_and_wait,
    retroactively_report_discovered_tests,
    cancel_all_timers,
    close_dns_for_terminate,
};

// ════════════════════════════════════════════════════════════════════════════
// WebWorker / Debugger runtime hooks
// ════════════════════════════════════════════════════════════════════════════

/// Apply the standalone-executable graph's runtime flags to the transpiler.
///
/// # Safety
/// `transpiler` is the worker VM's live `&mut Transpiler` (not yet visible to
/// any other thread); `graph` is the process-lifetime trait object whose data
/// pointer is a `bun_standalone_graph::Graph` (the only implementor — set in
/// `init_with_module_graph` / inherited from the parent VM).
unsafe fn apply_standalone_runtime_flags(
    transpiler: *mut bun_bundler::Transpiler<'static>,
    graph: &'static dyn bun_resolver::StandaloneModuleGraph,
) {
    // SAFETY: per fn contract — sole implementor; trait-object data pointer IS
    // the concrete `Graph` (originally upcast from `&Graph`, so the data
    // pointer is `Graph`-aligned). Read-only downcast (`&*`, not `&mut *` —
    // the shared-ref provenance carries no write permission); the body only
    // reads `graph.runtime_flags`.
    let graph = unsafe {
        &*std::ptr::from_ref::<dyn bun_resolver::StandaloneModuleGraph>(graph)
            .cast::<c_void>()
            .cast::<bun_standalone_graph::Graph>()
    };
    // SAFETY: per fn contract.
    crate::run_main::apply_standalone_runtime_flags(unsafe { &mut *transpiler }, graph);
}

/// Parse a Worker's `execArgv` against the
/// `RunCommand` param table and return `!args.flag("--no-addons")`, or `None`
/// on parse error.
///
/// Note: the Rust `bun_clap::parse_ex` port currently constrains
/// `ArgIter<'static>` (parsed values are stored by reference), which would
/// force leaking the per-call UTF-8 copies of `exec_argv`. Spec only ever
/// reads the single `--no-addons` flag from the result (per the in-tree
/// `// TODO: currently this only checks for --no-addons`), so this body scans
/// the converted argv directly with the same `stop_after_positional_at = 1`
/// short-circuit. Full clap routing can return when `ComptimeClap` grows a
/// borrowed-lifetime variant.
///
/// # Safety
/// Each `WTFStringImpl` in `exec_argv` is a live WTF string (the C++
/// `Worker::create` array, kept alive for the worker's lifetime).
unsafe fn parse_worker_exec_argv_allow_addons(
    exec_argv: &[bun_core::WTFStringImpl],
) -> Option<bool> {
    let mut no_addons = false;
    for &arg in exec_argv {
        if arg.is_null() {
            continue;
        }
        // SAFETY: per fn contract — `arg` is a live `WTFStringImpl*`.
        let owned = unsafe { &*arg }.to_owned_slice_z();
        let bytes = owned.as_bytes();
        // `stop_after_positional_at = 1` — first non-flag token ends parsing.
        if bytes.first() != Some(&b'-') {
            break;
        }
        if bytes == b"--" {
            break;
        }
        if bytes == b"--no-addons" {
            no_addons = true;
        }
    }
    // Override `allow_addons` unconditionally on successful parse.
    Some(!no_addons)
}

/// `jsc.API.cron.CronJob.clearAllForVM(vm, .teardown)` —
/// stops every in-process `Bun.cron()` job registered on
/// this VM and releases the pending-promise ref so the struct frees (the event
/// loop is dying; settle callbacks will never run).
fn cron_clear_all_teardown(vm: &mut VirtualMachine) {
    use crate::api::cron::{ClearMode, CronJob};
    CronJob::clear_all_for_vm::<{ ClearMode::Teardown }>(vm);
}

/// `jsc.API.cron.CronJob.clearAllForVM(vm, .reload)` —
/// same impl as [`cron_clear_all_teardown`] but skips
/// the pending-promise force-release (the event loop survives a hot reload, so
/// settle callbacks will still run).
fn cron_clear_all_reload(vm: &mut VirtualMachine) {
    use crate::api::cron::{ClearMode, CronJob};
    CronJob::clear_all_for_vm::<{ ClearMode::Reload }>(vm);
}

/// `webcore.WebWorker.terminateAllAndWait(timeout_ms)` —
/// forwards to the in-crate `bun_jsc::web_worker`
/// implementation; routed through `RuntimeHooks` because `virtual_machine.rs`
/// sits below `web_worker.rs` in the module DAG and the wait re-enters
/// `auto_tick` (this crate) on the worker side.
///
/// Main-thread only; called from `global_exit` after `is_shutting_down` is set.
fn terminate_all_workers_and_wait(timeout_ms: u64) {
    bun_jsc::web_worker::terminate_all_and_wait(timeout_ms);
}

/// `RuntimeHooks::cancel_all_timers` — cancel every `TimeoutObject` /
/// `ImmediateObject` still linked in the current thread's timer heap so the
/// in-heap `+1` ref and the JS pin drop before the GC sweep / `~VM`.
/// `timer::All` lives in `bun_runtime`; callers (`global_exit`,
/// `WebWorker::shutdown`) are in `bun_jsc`, hence the hook.
///
/// # Safety
/// `vm` is the live per-thread VM; `runtime_state()` must still be installed.
/// Must run on the JS thread before JSC teardown.
unsafe fn cancel_all_timers(vm: *mut VirtualMachine) {
    let state = runtime_state();
    if state.is_null() {
        return;
    }
    // Drain the `fs.watchFile` scheduler queue while the timer heap and JSC
    // are both still live. Each queued `StatWatcher` holds a `RefPtr` back to
    // the scheduler and the scheduler holds a queue ref on the watcher, so any
    // watcher still queued at exit forms a cycle and leaks. Runs before
    // `cancel_all_timeout_objects` so the scheduler's `EventLoopTimer` is still
    // linked when `set_timer(0)` removes it.
    // SAFETY: `vm` per fn contract; JS thread, before JSC teardown.
    unsafe {
        crate::node::node_fs_stat_watcher::StatWatcherScheduler::shutdown_for_exit(vm);
    }
    // SAFETY: `state` is the live boxed per-thread `RuntimeState`; `vm` per fn
    // contract. `addr_of_mut!` does not materialize a `&mut RuntimeState`.
    unsafe {
        crate::timer::All::cancel_all_timeout_objects(ptr::addr_of_mut!((*state).timer), vm);
    }
}

/// `RuntimeHooks::close_dns_for_terminate` — destroy the per-VM global DNS
/// resolver's c-ares channel now so its `ARES_EDESTRUCTION` and socket-state
/// callbacks run while the JSC VM, `RareData.file_polls`, and `runtime_state`
/// are all still live. See `Resolver::close_channel_for_terminate`.
fn close_dns_for_terminate() {
    let state = runtime_state();
    if state.is_null() {
        return;
    }
    // SAFETY: `state` is the live per-thread `RuntimeState` box; shared borrow
    // of the `OnceCell` only (the resolver's own state is interior-mutable).
    if let Some(gd) = unsafe { &(*state).global_dns_data }.get() {
        gd.resolver.close_channel_for_terminate();
    }
}

pub(crate) fn close_isolation_handles(vm: &mut VirtualMachine) {
    let state = runtime_state();
    if state.is_null() {
        return;
    }
    // A microtask still pending at end-of-file (e.g. queued by
    // `tick_immediate_tasks` or `handle_rejected_promises`) can register new
    // handles when it runs. Drain first so they land in the registry before
    // it empties — matches the swap's own drain-before-teardown ordering.
    let _ = vm.event_loop_mut().drain_microtasks();
    loop {
        // SAFETY: live boxed per-thread `RuntimeState`; the borrow ends before
        // the close below re-enters JS.
        let Some(kv) = (unsafe { &mut (*state).isolation_handles }).pop() else {
            break;
        };
        match kv.key {
            // SAFETY: live until it unregisters in `detach`.
            IsolationHandle::FsWatcher(w) => unsafe { w.as_ref() }.close_for_isolation(),
            // Live until it unregisters in `close()` (JS thread, us) — a
            // registered entry implies `close()` has not run, and `deinit`
            // cannot fire before `close()` drops the wrapper's Strong ref.
            IsolationHandle::StatWatcher(w) => bun_ptr::ParentRef::from(w).close(),
            IsolationHandle::Server(mut s) => s.stop(true),
        }
    }
}

/// `TestReporterAgent.retroactivelyReportDiscoveredTests(agent)`.
/// When `TestReporter.enable` arrives after test
/// collection has started, walk the already-discovered scope tree, assign
/// debugger test IDs, and emit `reportTestFoundWithLocation` for each.
///
/// # Safety
/// `agent` is a live C++ `Inspector::TestReporterAgent::Handle*` (just stored
/// into `debugger.test_reporter_agent.handle` by the caller). Called on the JS
/// thread.
unsafe fn retroactively_report_discovered_tests(agent: *mut bun_jsc::debugger::TestReporterHandle) {
    use crate::test_runner::bun_test::{DescribeScope, Phase, TestScheduleEntry};
    use crate::test_runner::jest::Jest;
    use bun_jsc::debugger::{TestReporterHandle, TestType};

    let Some(runner) = Jest::runner() else { return };
    let Some(active_file) = runner.bun_test_root.active_file.as_ref() else {
        return;
    };
    // SAFETY: single-threaded; `active_file` keeps the cell alive for this call.
    let active_file = unsafe { &mut *active_file.as_ptr() };

    // Only report if we're in collection or execution phase (tests have been
    // discovered).
    match active_file.phase {
        Phase::Collection | Phase::Execution => {}
        Phase::Done => return,
    }

    // Get the file path for source location info.
    use crate::test_runner::jest::FileColumns as _;
    let file_path = runner.files.items_source()[active_file.file_id as usize]
        .path
        .text();
    let mut source_url = bun_core::String::init(file_path);

    // Track the maximum ID we assign.
    let mut max_id: i32 = 0;

    // Recursively report all discovered tests starting from root scope.
    retroactively_report_scope(
        agent,
        &mut active_file.collection.root_scope,
        -1,
        &mut max_id,
        &mut source_url,
    );

    // A debug-only log of `max_id` was dropped here: `scoped_log!` only accepts
    // an ident, so it can't name the scoped-logger static in `bun_jsc::debugger`.
    let _ = max_id;

    fn retroactively_report_scope(
        agent: *mut TestReporterHandle,
        scope: &mut DescribeScope,
        parent_id: i32,
        max_id: &mut i32,
        source_url: &mut bun_core::String,
    ) {
        for entry in scope.entries.iter_mut() {
            match entry {
                TestScheduleEntry::Describe(describe) => {
                    if describe.base.test_id_for_debugger == 0 {
                        *max_id += 1;
                        let test_id = *max_id;
                        // Assign the ID so start/end events will fire during
                        // execution.
                        describe.base.test_id_for_debugger = test_id;
                        let mut name = bun_core::String::init(
                            describe.base.name.as_deref().unwrap_or(b"(unnamed)"),
                        );
                        // SAFETY: `agent` is a live C++ handle (fn contract).
                        unsafe { &mut *agent }.report_test_found_with_location(
                            test_id,
                            &mut name,
                            TestType::Describe,
                            parent_id,
                            source_url,
                            describe.base.line_no as i32,
                        );
                        // Recursively report children with this describe as
                        // parent.
                        retroactively_report_scope(agent, describe, test_id, max_id, source_url);
                    } else {
                        // Already has ID, just recurse with existing ID as
                        // parent.
                        let existing = describe.base.test_id_for_debugger;
                        retroactively_report_scope(agent, describe, existing, max_id, source_url);
                    }
                }
                TestScheduleEntry::TestCallback(test_entry) => {
                    if test_entry.base.test_id_for_debugger == 0 {
                        *max_id += 1;
                        let test_id = *max_id;
                        test_entry.base.test_id_for_debugger = test_id;
                        let mut name = bun_core::String::init(
                            test_entry.base.name.as_deref().unwrap_or(b"(unnamed)"),
                        );
                        // SAFETY: `agent` is a live C++ handle (fn contract).
                        unsafe { &mut *agent }.report_test_found_with_location(
                            test_id,
                            &mut name,
                            TestType::Test,
                            parent_id,
                            source_url,
                            test_entry.base.line_no as i32,
                        );
                    }
                }
            }
        }
    }
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
    name_buf: &'a [u8; 512],
    enable_ansi_colors: bool,
) -> JsResult<bool> {
    if enable_ansi_colors {
        console_print_runtime_object_inner::<true>(formatter, writer, value, name_buf)
    } else {
        console_print_runtime_object_inner::<false>(formatter, writer, value, name_buf)
    }
}

fn console_print_runtime_object_inner<const C: bool>(
    formatter: &mut bun_jsc::Formatter<'_>,
    writer_: &mut dyn bun_io::Write,
    value: JSValue,
    name_buf: &[u8; 512],
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

    // SAFETY: `as_` returns a non-null `*mut T` only when `value` wraps a
    // live `T` cell; conservative stack scan keeps `value` alive for the
    // duration of each branch.
    if let Some(response) = value.as_::<Response>() {
        let mut w = AsFmt::new(writer_);
        // SAFETY: `as_` returned a non-null `*mut Response` to the live native
        // wrapper backing `value`; `value` is on-stack so GC keeps it alive.
        let _ = unsafe { &mut *response }.write_format::<_, _, C>(formatter, &mut w);
        return Ok(true);
    }
    if let Some(request) = value.as_::<Request>() {
        let mut w = AsFmt::new(writer_);
        // SAFETY: `as_` returned a non-null `*mut Request` to the live native
        // wrapper backing `value`; `value` is on-stack so GC keeps it alive.
        let _ = unsafe { &mut *request }.write_format::<_, _, C>(value, formatter, &mut w);
        return Ok(true);
    }
    if let Some(build) = value.as_::<BuildArtifact>() {
        let mut w = AsFmt::new(writer_);
        // SAFETY: `as_` returned a non-null `*mut BuildArtifact` to the live
        // native wrapper backing `value`; GC keeps it alive (see above).
        let _ = unsafe { &*build }.write_format::<_, _, C>(formatter, &mut w);
        return Ok(true);
    }
    if let Some(blob) = value.as_::<Blob>() {
        let mut w = AsFmt::new(writer_);
        // SAFETY: `as_` returned a non-null `*mut Blob` to the live native
        // wrapper backing `value`; GC keeps it alive (see above).
        let _ = unsafe { &mut *blob }.write_format::<_, _, C>(formatter, &mut w);
        return Ok(true);
    }
    if let Some(s3client) = value.as_class_ref::<S3Client>() {
        let mut w = AsFmt::new(writer_);
        let _ = s3client.write_format::<_, _, C>(formatter, &mut w);
        return Ok(true);
    }
    if let Some(archive) = value.as_class_ref::<Archive>() {
        let mut w = AsFmt::new(writer_);
        let _ = archive.write_format::<_, _, C>(formatter, &mut w);
        return Ok(true);
    }
    if bun_jsc::FetchHeaders::cast_(value, formatter.global_this.vm()).is_some() {
        if let Some(to_json_function) = value.get(formatter.global_this, "toJSON")? {
            formatter.add_for_new_line("Headers ".len());
            let _ = bun_io::Write::write_all(writer_, pf!("<r>Headers ").as_bytes());
            let prev_quote_keys = formatter.quote_keys;
            formatter.quote_keys = true;
            let result = to_json_function
                .call(formatter.global_this, value, &[])
                .unwrap_or_else(|err| formatter.global_this.take_exception(err));
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
    if let Some(timer) = value.as_class_ref::<crate::timer::TimeoutObject>() {
        let internals = &timer.internals;
        let id = internals.id;
        formatter.add_for_new_line("Timeout(# ) ".len() + bun_core::fmt::digit_count(id.max(0)));
        let mut w = AsFmt::new(writer_);
        if internals.flags.get().kind() == crate::timer::Kind::SetInterval {
            formatter.add_for_new_line("repeats ".len() + bun_core::fmt::digit_count(id.max(0)));
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
        let id = immediate.internals.id;
        formatter.add_for_new_line("Immediate(# ) ".len() + bun_core::fmt::digit_count(id.max(0)));
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
    {
        use crate::test_runner::pretty_format::{JestPrettyFormat, WrappedWriter};
        // `writer_` is `&mut dyn bun_io::Write`; wrap once more so the
        // (sized) `&mut dyn bun_io::Write` satisfies `WrappedWriter<W>`'s
        // `W: bun_io::Write` bound via the blanket `impl Write for &mut W`.
        let mut sink: &mut dyn bun_io::Write = &mut *writer_;
        let mut wrapped = WrappedWriter::new(&mut sink);
        if JestPrettyFormat::print_asymmetric_matcher::<_, _, C>(
            formatter,
            &mut wrapped,
            name_buf,
            value,
        )? {
            return Ok(true);
        }
    }

    Ok(false)
}

// ════════════════════════════════════════════════════════════════════════════
// LoaderHooks bodies
// ════════════════════════════════════════════════════════════════════════════

/// `clone_utf8(other)` unless `other` is
/// byte-equal to `s`, in which case bump `s`'s refcount instead.
#[inline]
fn create_if_different(s: &bun_core::String, other: &[u8]) -> bun_core::String {
    if s.eql_utf8(other) {
        return s.dupe_ref();
    }
    bun_core::String::clone_utf8(other)
}

fn to_jsc_fetch_error(err: &crate::Error) -> bun_jsc::CrateError {
    match err {
        crate::Error::Jsc(e) => *e,
        crate::Error::Bundler(e) => (*e).into(),
        crate::Error::Resolver(e) => (*e).into(),
        crate::Error::Install(e) => (*e).into(),
        crate::Error::Core(e) => (*e).into(),
        crate::Error::Sys(e) => (*e).into(),
        crate::Error::Alloc(e) => (*e).into(),
        crate::Error::UnexpectedPendingResolution => {
            bun_jsc::CrateError::UnexpectedPendingResolution
        }
        crate::Error::ModuleNotFound => bun_jsc::CrateError::ModuleNotFound,
        crate::Error::WriteFailed => bun_jsc::CrateError::WriteFailed,
        crate::Error::JSError | crate::Error::Js(_) => bun_jsc::CrateError::JSError,
        crate::Error::JSErrorObject => bun_jsc::CrateError::JSErrorObject,
        _ => bun_jsc::CrateError::ParseError,
    }
}

/// `ModuleLoader.transpileSourceCode(...)` — the runtime-transpiler path:
/// read file → `Transpiler::parse`
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
    // The §Dispatch shim packs
    // them into `args.extra`. When null (low-tier `Bun__*` shim entry), the
    // hook recomputes from `specifier` — that path is owned by `transpile_file`
    // and not exercised here, so a null `extra` is a hard error.
    let extra = args.extra.cast::<TranspileExtra>();
    if extra.is_null() {
        // SAFETY: per fn contract — `ret` is a valid out-param.
        unsafe {
            *ret = ErrorableResolvedSource::err(
                ErrorCode(ErrorCode::JS_ERROR_OBJECT),
                JSValue::UNDEFINED,
            );
        }
        return false;
    }
    match transpile_source_code_inner(jsc_vm, args, extra) {
        Ok(resolved) => {
            // SAFETY: per fn contract.
            unsafe { *ret = ErrorableResolvedSource::ok(resolved.into_ffi()) };
            // Note: spec calls `resetArena` only on the `Bun__transpileFile`
            // path, never inside `transpileSourceCode` itself — the
            // `transpile_file` hook owns that. Do NOT reset here.
            true
        }
        Err(_) => {
            // Note: on `error.ParseError` /
            // `error.AsyncModule` the caller (`Bun__transpileFile`) catches and
            // routes through `processFetchLog`. Mirror that: write `.err` so the
            // low tier surfaces it; `process_fetch_log` is invoked by the
            // `transpile_file` hook, not here.
            // SAFETY: per fn contract.
            unsafe {
                *ret = ErrorableResolvedSource::err(
                    ErrorCode(ErrorCode::JS_ERROR_OBJECT),
                    JSValue::UNDEFINED,
                )
            };
            false
        }
    }
}

/// Inner body of [`transpile_source_code`] — split for `?`-on-`Result` error
/// flow.
///
/// Note: takes `*mut VirtualMachine` (NOT `&mut`) — the body re-enters
/// `vm.transpiler` while also touching `vm.module_loader` / `vm.bun_watcher`,
/// which would alias under `&mut` (PORTING.md §Forbidden). Per-field deref via
/// the raw ptr, mirroring `auto_tick` above.
fn transpile_source_code_inner(
    jsc_vm: *mut VirtualMachine,
    args: &TranspileArgs<'_>,
    extra: *mut TranspileExtra,
) -> crate::Result<OwnedResolvedSource> {
    use Loader as L;

    // SAFETY: per fn contract — `extra` is a live `TranspileExtra` for the call.
    // Note: raw-ptr (not `&mut`) so the recursive `.wasm` arm can mutate
    // `extra.loader` and re-enter without borrowck seeing aliased `&mut`.
    let path: &Fs::Path = unsafe { &(*extra).path };
    // SAFETY: per fn contract — `extra` is live for the call (see above).
    let (loader, module_type): (Loader, ModuleType) =
        unsafe { ((*extra).loader, (*extra).module_type) };

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
                L::Toml | L::Yaml | L::Json5 | L::Text | L::Json | L::Jsonc
            ))
    {
        return Ok(OwnedResolvedSource::from(ResolvedSource {
            source_code: bun_core::String::empty(),
            specifier: input_specifier.dupe_ref(),
            source_url: create_if_different(input_specifier, path.text),
            ..Default::default()
        }));
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
        | L::Text
        | L::Md => {
            // `bun_ast::ASTMemoryAllocator::Scope`.
            let mut _ast_scope = bun_ast::ast_memory_allocator::Scope::default();
            _ast_scope.enter();

            // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
            unsafe { (*jsc_vm).transpiled_count += 1 };
            // `Transpiler::reset_store`. Inline only the
            // block-store half; `AstAlloc` gets its own per-transpile state
            // below, so the side module's long-lived state is not touched.
            bun_ast::Expr::data_store_reset();
            bun_ast::Stmt::data_store_reset();

            let hash = bun_watcher::Watcher::get_hash(path.text);
            // SAFETY: per fn contract.
            let (main, main_hash) = unsafe { ((*jsc_vm).main(), (*jsc_vm).main_hash) };
            let is_main = main.len() == path.text.len() && main_hash == hash && main == path.text;

            // ── Arena take/give-back ────────────────────────────────────────
            // Reuse the per-VM arena when free; allocate a
            // fresh boxed one otherwise. `give_back_arena` is cleared on the
            // ParseError / AsyncModule paths (which hand the arena to the
            // async queue or leak it intentionally for the caller to inspect).
            // SAFETY: per fn contract.
            let arena: Box<bun_alloc::Arena> =
                unsafe { (*jsc_vm).module_loader.transpile_source_code_arena.take() }
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
                    // SAFETY: `jsc_vm` is the live per-thread VM (closure runs
                    // on the same thread, before the hook returns).
                    let slot = unsafe { &mut (*jsc_vm).module_loader.transpile_source_code_arena };
                    if !give_back {
                        // When `give_back_arena == false`, ownership is held past
                        // `processFetchLog` so log spans pointing into the
                        // arena stay valid. (The AsyncModule path never reaches
                        // here: its enqueue site defuses this guard via
                        // `ScopeGuard::into_inner` and hands the `Box<Arena>`
                        // to the queue.) The ParseError path that flips
                        // `give_back=false` is LIVE: the caller
                        // (`transpile_file` → `process_fetch_log`, spec
                        // :1112-1114) reads `log` entries whose spans point
                        // into arena-owned source bytes. Freeing here would be
                        // a use-after-free.
                        //
                        // We can't widen `TranspileExtra` (lower tier) to carry
                        // the `Box<Arena>` back, so park it in the per-VM slot
                        // UN-reset. `transpile_file`'s `_reset_arena` guard
                        // (`ModuleLoader::reset_arena`) runs after
                        // `process_fetch_log` and resets/reclaims it then —
                        // matching the spec lifetime.
                        *slot = Some(arena);
                        return;
                    }
                    if slot.is_none() {
                        if flags != FetchFlags::PrintSource {
                            // SAFETY: per fn contract — `jsc_vm` is the live
                            // per-thread VM (closure runs on the same thread,
                            // before the hook returns).
                            if unsafe { (*jsc_vm).smol } {
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
                        *slot = Some(arena);
                    }
                    // else: drop the fresh Box.
                },
            );
            // Per-transpile `AstAlloc` state spilling into the transpile
            // arena. Declared after `arena_guard` so it drops before the
            // guard can reset that heap. Small `AstVec`s live in the state's
            // inline chunk, not the arena, so the pending-imports path must
            // consume this scope via `take_state()` and ship the box with the
            // arena.
            let ast_alloc_scope = bun_alloc::ast_alloc::ScopedAstAlloc::with_spill(arena_heap);
            // ── Watcher fd / package_json lookup ────────────────────────────
            let mut fd: Option<bun_sys::Fd> = None;
            let mut package_json: Option<&'static bun_watcher::PackageJSON> = None;
            {
                // SAFETY: `bun_watcher` is the `*mut ImportWatcher`
                // set during VM init (BACKREF); cast recovers the concrete type.
                let import_watcher: *mut bun_jsc::ImportWatcher =
                    unsafe { &*jsc_vm }.bun_watcher.cast();
                if !import_watcher.is_null() {
                    // SAFETY: non-null per check above. The watchlist *is*
                    // mutated cross-thread (the watcher thread's
                    // `flush_evictions` closes fds and `swap_remove`s), so
                    // snapshot under the watcher mutex — see
                    // `ImportWatcher::snapshot_fd_and_package_json` doc for
                    // the EBADF race this closes.
                    let iw = unsafe { &*import_watcher };
                    (fd, package_json) = iw.snapshot_fd_and_package_json(hash);
                }
            }

            // Note / fix: never reuse the watcher's cached fd for the
            // `--hot` entrypoint. An atomic `rename()` over the entrypoint (the
            // common HMR save pattern) replaces its inode; the watcher entry
            // still holds an fd to the now-unlinked old inode until the
            // IN_DELETE_SELF event for it is processed and `flush_evictions`
            // closes it. If a reload's transpile runs first (e.g. the
            // directory-watch recovery in `hot_reloader` re-fired the reload
            // before that file event landed under load), reading via the stale
            // fd returns the OLD file contents — the reload "succeeds" with the
            // wrong source and `bun --hot` hangs. Re-open the entrypoint by
            // path so we always see the current inode; `maybe_watch_file` below
            // re-registers the fresh fd with the watcher.
            if is_main && fd.is_some() {
                fd = None;
            }

            // ── RuntimeTranspilerCache ──────────────────────────────────────
            let mut cache = bun_ast::RuntimeTranspilerCache {
                r#impl: Some(bun_ast::TranspilerCacheImplKind::Jsc),
                ..Default::default()
            };

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
            // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
            // `transpiler.log` / `args.log` are never-null (set in
            // `Transpiler::init_in_place` / by the C++ caller respectively).
            let old_log = unsafe { &*jsc_vm }.transpiler.log;
            let old_log_nn = core::ptr::NonNull::new(old_log).expect("transpiler.log is non-null");
            let args_log_nn = core::ptr::NonNull::new(args.log).expect("args.log is non-null");
            // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM;
            // `args.log` is non-null (checked above) and outlives this call.
            unsafe {
                (*jsc_vm).transpiler.log = args.log;
                (*jsc_vm).transpiler.resolver.log = args_log_nn;
                (*jsc_vm).transpiler.linker.log = args.log;
                if let Some(pm) = (*jsc_vm).transpiler.resolver.package_manager {
                    (*pm.cast::<bun_install::PackageManager>().as_ptr()).log = args.log;
                }
            }
            let _log_guard = scopeguard::guard(jsc_vm, move |jsc_vm| {
                // SAFETY: guard runs on the same JS thread before `jsc_vm` is
                // torn down; restores the log pointers swapped just above.
                unsafe {
                    (*jsc_vm).transpiler.log = old_log;
                    (*jsc_vm).transpiler.resolver.log = old_log_nn;
                    (*jsc_vm).transpiler.linker.log = old_log;
                    if let Some(pm) = (*jsc_vm).transpiler.resolver.package_manager {
                        (*pm.cast::<bun_install::PackageManager>().as_ptr()).log = old_log;
                    }
                }
            });

            let is_node_override = specifier.starts_with(node_fallbacks::IMPORT_PATH);

            // SAFETY: per fn contract.
            let (macro_mode, has_any_macro_remappings) =
                unsafe { ((*jsc_vm).macro_mode, (*jsc_vm).has_any_macro_remappings) };
            let macro_remappings = if macro_mode || !has_any_macro_remappings || is_node_override {
                bun_resolver::package_json::MacroMap::default()
            } else {
                // Note: `MacroMap`'s value type
                // (`StringArrayHashMap<Box<[u8]>>`) has only the fallible
                // `clone() -> Result<_, AllocError>` (no trait `Clone`), so
                // the outer map can't be `clone()`d generically. Re-key
                // shallowly here matching `bun_bundler::transpiler` and treat
                // the inner OOM as a process-fatal alloc failure.
                // SAFETY: per fn contract — `jsc_vm` is the live per-thread
                // VM and `init_runtime_state` has already `ptr::write`n a
                // real `Transpiler` into `vm.transpiler` (the `options.jsx` /
                // `options.loaders` reads below depend on the same invariant).
                let src = unsafe { &(*jsc_vm).transpiler.options.macro_remap };
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

            let mut should_close_input_file_fd = fd.is_none();

            // Only JS-like loaders get the cjs/esm wrapper hint.
            let module_type_only_for_wrappables = match loader {
                L::Js | L::Jsx | L::Ts | L::Tsx => module_type,
                _ => ModuleType::Unknown,
            };

            let mut input_file_fd = bun_sys::Fd::INVALID;
            // The deferred fd close is independent of `give_back_arena`
            // and must fire on every exit path: parse failure, JSON early
            // return, `disable_transpilying`, already_bundled, empty `.cjs`,
            // cache-hit, AsyncModule, the wasm recurse, and the print error.
            // Note: reshaped for borrowck — capture raw pointers so the
            // guard does not alias the parser's `file_fd_ptr` /
            // `maybe_watch_file` borrows. **All** later access to
            // `should_close_input_file_fd` / `input_file_fd` MUST go through
            // these raw pointers — taking a fresh `&mut` to either local would
            // invalidate the guard's tag under Stacked Borrows, making the
            // deferred `.close()` (which the parse path always reaches) UB.
            let should_close_ptr: *mut bool = &raw mut should_close_input_file_fd;
            let input_file_fd_ptr: *mut bun_sys::Fd = &raw mut input_file_fd;
            // Note: `scopeguard::defer!` would capture the two `*mut`
            // locals by-ref in its non-`move` closure, which borrowck then
            // treats as conflicting with the later `&mut *ptr` reborrows below
            // (edition-2021 capture analysis). Thread the raw pointers through
            // the guard *payload* instead so nothing is captured.
            let _fd_guard = scopeguard::guard(
                (should_close_ptr, input_file_fd_ptr),
                |(should_close_ptr, input_file_fd_ptr)| {
                    // SAFETY: `should_close_input_file_fd` / `input_file_fd`
                    // are declared earlier in this stack frame and outlive
                    // this guard (locals drop in reverse declaration order);
                    // the guard runs on the same thread before either is
                    // destroyed.
                    unsafe {
                        if *should_close_ptr && (*input_file_fd_ptr).is_valid() {
                            use bun_sys::FdExt as _;
                            (*input_file_fd_ptr).close();
                            *input_file_fd_ptr = bun_sys::Fd::INVALID;
                        }
                    }
                },
            );

            // ── Node-fallback virtual source ────────────────────────────────
            let fallback_source: bun_ast::Source;
            let mut virtual_source = args.virtual_source;
            if is_node_override {
                if let Some(code) = node_fallbacks::contents_from_path(specifier) {
                    {
                        // `bun_ast::Source::path` is the logger-local
                        // `fs::Path` (NOT `bun_resolver::fs::Path`). `specifier`
                        // here is a `node_fallbacks` key — a `&'static [u8]`
                        // literal — so no lifetime erasure needed.
                        // SAFETY: `node_fallbacks::contents_from_path` only
                        // matches `'static` literal keys.
                        let spec_static: &'static [u8] = unsafe {
                            core::slice::from_raw_parts(specifier.as_ptr(), specifier.len())
                        };
                        let fallback_path =
                            bun_paths::fs::Path::init_with_namespace(spec_static, b"node");
                        fallback_source = bun_ast::Source {
                            path: fallback_path,
                            contents: bun_ptr::Cow::Borrowed(code),
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
            // `virtual_source` is `None`).
            // ════════════════════════════════════════════════════════════════
            {
                use bun_ast::RuntimeTranspilerCache;
                use bun_bundler::transpiler::{AlreadyBundled, ParseOptions, ParseResult};
                use bun_jsc::resolved_source::Tag as ResolvedSourceTag;

                // Keep the one-shot
                // `set_break_point_on_first_line()` last so it is only
                // consumed when the other conditions hold.
                // SAFETY: per fn contract — leaf-field `&` borrow on
                // `(*jsc_vm).debugger` (same shape as RuntimeTranspilerStore).
                let set_breakpoint_on_first_line = is_main
                    && unsafe { &(*jsc_vm).debugger }
                        .as_ref()
                        .map(|d| d.set_breakpoint_on_first_line)
                        .unwrap_or(false)
                    && bun_jsc::runtime_transpiler_store::set_break_point_on_first_line();

                // `ParseOptions::path` is `bun_paths::fs::Path<'static>`
                // (the `'static`-slice flavour used by `bun_ast::Source`), but
                // `path` here is `bun_resolver::fs::Path<'_>`. The two structs
                // are field-identical (they could be collapsed into one type).
                // The resolver entry path interns into
                // `'static` BSSStringList stores, but the `transpile_file`
                // entry path borrows a heap `Utf8Slice` that drops at frame
                // exit — so re-intern into the same `FilenameStore` here
                // instead of transmuting the lifetime (PORTING.md §Forbidden).
                //
                // When `disable_transpilying` is true the
                // `parse_result` is consumed *within this frame* (the
                // `.print_source` / `.print_source_and_clone` early-return
                // below reads only `source.contents` then drops it), so the
                // re-intern is unnecessary and — because `BSSStringList::append`
                // does not deduplicate — leaks one path-len buffer per
                // `Bun.inspect(new Error)` (inspect-error-leak.test.js). The
                // borrowed path bytes outlive `parse_result` in that branch,
                // so reuse them directly. The intern is a
                // workaround for the async-module queue path only.
                let parse_path = if disable_transpilying {
                    bun_paths::fs::Path {
                        pretty: path.pretty,
                        text: path.text,
                        namespace: path.namespace,
                        is_disabled: path.is_disabled,
                        is_symlink: path.is_symlink,
                    }
                } else {
                    // Note: route through `intern_transpile_path` (dedup)
                    // instead of `FilenameStore::append_slice` directly — see
                    // that fn's doc for the leak this closes
                    // (require-cache.test.ts "don't leak file paths").
                    let text: &'static [u8] = intern_transpile_path(path.text);
                    let pretty: &'static [u8] =
                        if core::ptr::eq(path.pretty.as_ptr(), path.text.as_ptr())
                            && path.pretty.len() == path.text.len()
                        {
                            text
                        } else {
                            intern_transpile_path(path.pretty)
                        };
                    // `Fs::Path::init` always sets namespace to the `b"file"`
                    // literal; only intern if a caller overrode it.
                    let namespace: &'static [u8] = if path.namespace == b"file" {
                        b"file"
                    } else {
                        intern_transpile_path(path.namespace)
                    };
                    bun_paths::fs::Path {
                        pretty,
                        text,
                        namespace,
                        is_disabled: path.is_disabled,
                        is_symlink: path.is_symlink,
                    }
                };
                let parse_options = ParseOptions {
                    // SAFETY: `arena_ptr` points at the `Box<Arena>` interior
                    // held by `arena_guard`; the guard outlives `parse_result`.
                    arena: unsafe { &*arena_ptr },
                    path: parse_path,
                    loader,
                    dirname_fd: bun_sys::Fd::INVALID,
                    file_descriptor: fd,
                    // SAFETY: `input_file_fd_ptr` points at this frame's
                    // `input_file_fd`; reborrow through the raw pointer so the
                    // `_fd_guard` scopeguard's tag is not invalidated by a
                    // fresh `&mut` (see Note on `_fd_guard`).
                    file_fd_ptr: Some(unsafe { &mut *input_file_fd_ptr }),
                    file_hash: Some(hash),
                    macro_remappings,
                    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                    jsx: unsafe { &*jsc_vm }.transpiler.options.jsx.clone(),
                    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                    emit_decorator_metadata: unsafe {
                        (*jsc_vm).transpiler.options.emit_decorator_metadata
                    },
                    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                    experimental_decorators: unsafe {
                        (*jsc_vm).transpiler.options.experimental_decorators
                    },
                    virtual_source,
                    dont_bundle_twice: true,
                    allow_commonjs: true,
                    module_type: module_type_only_for_wrappables,
                    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                    inject_jest_globals: unsafe {
                        (*jsc_vm).transpiler.options.rewrite_jest_for_tests
                    },
                    keep_json_and_toml_as_one_statement: true,
                    allow_bytecode_cache: true,
                    set_breakpoint_on_first_line,
                    runtime_transpiler_cache: if !disable_transpilying
                        && !<RuntimeTranspilerCache as bun_bundler::RuntimeTranspilerCacheExt>::disabled()
                    {
                        Some(&mut cache)
                    } else {
                        None
                    },
                    // Strip the CJS wrapper for the eval/stdin
                    // entry point.
                    // SAFETY: `jsc_vm` is the live per-thread VM.
                    remove_cjs_module_wrapper: is_main
                        && unsafe { &*jsc_vm }.module_loader.eval_source.is_some(),
                    macro_js_ctx: bun_bundler::transpiler::default_macro_js_value(),
                    replace_exports: Default::default(),
                };

                // Both the file-only and transpiled arms hit the same
                // `parse_maybe_return_file_only_allow_shared_buffer` body, so
                // dispatch at runtime via the const-generic bool.
                let return_file_only = disable_transpilying || loader == L::Json;
                let parse_result: Option<ParseResult> = if return_file_only {
                    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                    unsafe {
                        (*jsc_vm)
                            .transpiler
                            .parse_maybe_return_file_only::<true>(parse_options, None)
                    }
                } else {
                    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                    unsafe {
                        (*jsc_vm)
                            .transpiler
                            .parse_maybe_return_file_only::<false>(parse_options, None)
                    }
                };

                let Some(mut parse_result) = parse_result else {
                    // Register with watcher even on parse failure.
                    if !disable_transpilying {
                        // SAFETY: see Note on `_fd_guard` — reborrow via
                        // the raw pointers so the guard stays valid.
                        maybe_watch_file(
                            jsc_vm,
                            unsafe { &mut *should_close_ptr },
                            unsafe { *input_file_fd_ptr },
                            is_node_override,
                            path,
                            hash,
                            loader,
                            package_json,
                        );
                    }
                    arena_guard.2 = false; // give_back_arena = false
                    return Err(crate::Error::ParseError);
                };

                // `.wasm` discovered post-parse: recurse with
                // the parsed source as virtual.
                if parse_result.loader == L::Wasm {
                    // SAFETY: per fn contract — `extra` is live for the call;
                    // sole writer on this thread before the recursive re-entry.
                    unsafe {
                        (*extra).loader = L::Wasm;
                        (*extra).module_type = ModuleType::Unknown;
                    }
                    // Note: reshaped — spec passes `&parse_result.source`
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

                // Register with watcher on success too.
                if !disable_transpilying {
                    // SAFETY: see Note on `_fd_guard` — reborrow via the
                    // raw pointers so the guard stays valid.
                    maybe_watch_file(
                        jsc_vm,
                        unsafe { &mut *should_close_ptr },
                        unsafe { *input_file_fd_ptr },
                        is_node_override,
                        path,
                        hash,
                        loader,
                        package_json,
                    );
                }

                // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM;
                // `transpiler.log` was swapped to non-null `args.log` above.
                if unsafe { (*(*jsc_vm).transpiler.log).errors > 0 } {
                    arena_guard.2 = false;
                    return Err(crate::Error::ParseError);
                }

                let source = &parse_result.source;

                // Raw JSON: hand the source bytes straight to JSC.
                if loader == L::Json {
                    return Ok(OwnedResolvedSource::from(ResolvedSource {
                        source_code: bun_core::String::clone_utf8(&source.contents),
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        tag: ResolvedSourceTag::JsonForObjectLoader,
                        ..Default::default()
                    }));
                }

                // disable_transpiling: return raw source.
                if disable_transpilying {
                    let source_code = match args.flags {
                        FetchFlags::PrintSourceAndClone => {
                            bun_core::String::clone_utf8(&source.contents)
                        }
                        FetchFlags::PrintSource => {
                            // The file contents live in a Drop-carrying
                            // `source_contents_backing` on `parse_result`, so a
                            // borrow would dangle once `parse_result` drops on
                            // return. Clone instead — matches the
                            // `PrintSourceAndClone` arm.
                            bun_core::String::clone_utf8(&source.contents)
                        }
                        FetchFlags::Transpile => unreachable!(),
                    };
                    return Ok(OwnedResolvedSource::from(ResolvedSource {
                        source_code,
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        ..Default::default()
                    }));
                }

                // JSON/TOML/YAML/JSON5: export as a JS object.
                if matches!(loader, L::Json | L::Jsonc | L::Toml | L::Yaml | L::Json5) {
                    // SAFETY: `jsc_vm.global` is set during init and live for
                    // VM lifetime; `global_object` (if non-null) is the live
                    // per-thread global.
                    let global = unsafe {
                        &*if global_object.is_null() {
                            (*jsc_vm).global
                        } else {
                            global_object
                        }
                    };
                    let jsvalue_for_export = if parse_result.empty {
                        JSValue::create_empty_object(global, 0)
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
                        bun_js_parser_jsc::expr_to_js(&s_expr.value, global).unwrap_or_else(|e| {
                            bun_core::Output::panic(format_args!(
                                "Unexpected JS error: {}",
                                <&'static str>::from(e)
                            ))
                        })
                    };
                    return Ok(OwnedResolvedSource::from(ResolvedSource {
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        jsvalue_for_export,
                        tag: ResolvedSourceTag::ExportsObject,
                        ..Default::default()
                    }));
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
                    let (bytecode_cache, bytecode_cache_size) = match already_bundled {
                        AlreadyBundled::Bytecode(bytes) | AlreadyBundled::BytecodeCjs(bytes) => {
                            let len = bytes.len();
                            if len == 0 {
                                (core::ptr::null_mut(), 0)
                            } else {
                                // C++ side becomes the owner.
                                (bun_core::heap::into_raw(bytes).cast::<u8>(), len)
                            }
                        }
                        _ => (core::ptr::null_mut(), 0),
                    };
                    return Ok(OwnedResolvedSource::from(ResolvedSource {
                        source_code: bun_core::String::clone_latin1(&source.contents),
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        already_bundled: true,
                        bytecode_cache,
                        bytecode_cache_size,
                        is_commonjs_module,
                        ..Default::default()
                    }));
                }

                // Empty .cjs/.cts: synthetic `(function(){})`.
                if parse_result.empty && matches!(loader, L::Js | L::Ts) {
                    let ext = bun_paths::extension(source.path.text);
                    if ext == b".cjs" || ext == b".cts" {
                        return Ok(OwnedResolvedSource::from(ResolvedSource {
                            source_code: bun_core::String::static_(b"(function(){})"),
                            specifier: input_specifier.dupe_ref(),
                            source_url: create_if_different(input_specifier, path.text),
                            is_commonjs_module: true,
                            tag: ResolvedSourceTag::Javascript,
                            ..Default::default()
                        }));
                    }
                }

                // RuntimeTranspilerCache hit: skip print.
                // `cache.entry` is `Option<*mut ()>` (type-erased in T2
                // `bun_js_parser`); the concrete payload is the T6
                // `bun_jsc::runtime_transpiler_cache::Entry` boxed by
                // `JSC_PARSER_CACHE_VTABLE.get`.
                if let Some(entry_ptr) = cache.entry.take() {
                    use bun_jsc::runtime_transpiler_cache::{
                        Entry as CacheEntry, ModuleType as CacheModuleType, OutputCode,
                    };
                    // SAFETY: `entry_ptr` was produced by `heap::into_raw(Box<CacheEntry>)`
                    // in `JSC_PARSER_CACHE_VTABLE.get`; sole owner.
                    let mut entry: Box<CacheEntry> =
                        unsafe { bun_core::heap::take(entry_ptr.cast::<CacheEntry>()) };
                    // Register the cached sourcemap so error
                    // stacks remap to original positions even on a cache hit.
                    // SAFETY: per fn contract — `jsc_vm` is the live per-thread
                    // VM; `source_mappings` is only touched from the JS thread.
                    let _ = unsafe { &mut (*jsc_vm).source_mappings }.put_mappings(
                        source,
                        bun_core::MutableString {
                            list: core::mem::take(&mut entry.sourcemap).into_vec(),
                        },
                    );
                    // Rebuild the cached ESM record for the
                    // isolation source-provider cache (same shape as
                    // `RuntimeTranspilerStore`).
                    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                    let module_info: *mut core::ffi::c_void = if unsafe { &*jsc_vm }
                        .use_isolation_source_provider_cache()
                        && entry.metadata.module_type != CacheModuleType::Cjs
                        && !entry.esm_record.is_empty()
                    {
                        bun_bundler::analyze_transpiled_module::ModuleInfoDeserialized::create_from_cached_record(
                            &entry.esm_record,
                        )
                        .map(|b| bun_core::heap::into_raw(b).cast())
                        .unwrap_or(core::ptr::null_mut())
                    } else {
                        core::ptr::null_mut()
                    };
                    let source_code = match &mut entry.output_code {
                        OutputCode::String(s) => *s,
                        OutputCode::Utf8(utf8) => {
                            let result = bun_core::String::clone_utf8(utf8);
                            *utf8 = Box::default();
                            result
                        }
                    };
                    let is_commonjs_module = entry.metadata.module_type == CacheModuleType::Cjs;
                    // When the cached entry was detected as
                    // CJS but lives inside a `"type":"module"` package, emit
                    // `package_json_type_module` so the C++ loader applies the
                    // correct evaluation context on cache hits.
                    let tag = if is_commonjs_module && source.path.is_file() {
                        // Prefer the watcher's already-
                        // resolved `PackageJSON` (free under `--watch`/`--hot`)
                        // and only fall back to the resolver dir-info walk
                        // when the watcher had nothing for `hash`. The
                        // unconditional `read_dir_info` cost +9.6% instructions
                        // on the cache-hit path for a 222 KB CJS file.
                        //
                        // SAFETY: `bun_watcher::PackageJSON` is the opaque
                        // forward-decl of `bun_resolver::package_json::
                        // PackageJSON` (same layout, see the cast at the
                        // `:561-592` arm below); `package_json` is a
                        // VM-lifetime backref into the resolver cache.
                        let pkg = package_json
                            .map(|p| unsafe {
                                &*core::ptr::from_ref(p)
                                    .cast::<bun_resolver::package_json::PackageJSON>()
                            })
                            .or_else(|| {
                                // SAFETY: per fn contract — `transpiler.
                                // resolver` is a value field of the VM;
                                // `read_dir_info` is re-entrant on the JS
                                // thread and returns a stable cache slot.
                                match unsafe {
                                    (*jsc_vm)
                                        .transpiler
                                        .resolver
                                        .read_dir_info(source.path.name().dir)
                                } {
                                    Ok(Some(dir_info)) => {
                                        dir_info.package_json().or(dir_info.enclosing_package_json)
                                    }
                                    _ => None,
                                }
                            });
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
                    return Ok(OwnedResolvedSource::from(ResolvedSource {
                        source_code,
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        is_commonjs_module,
                        module_info,
                        tag,
                        ..Default::default()
                    }));
                }

                // Link import records.
                // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                let start_count = unsafe { &*jsc_vm }.transpiler.linker.import_counter;
                // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM;
                // `origin` is read-only and `linker` is JS-thread-exclusive.
                unsafe {
                    (*jsc_vm).transpiler.linker.link::<false, true>(
                        path,
                        &mut parse_result,
                        &(*jsc_vm).origin,
                        options::ImportPathFormat::AbsolutePath,
                    )?;
                }

                // Pending imports → AsyncModule queue.
                if parse_result.pending_imports.len() > 0 {
                    // SAFETY: per fn contract — `extra` is live for the call.
                    let promise_ptr = unsafe { &*extra }.promise_ptr;
                    if promise_ptr.is_null() {
                        return Err(crate::Error::UnexpectedPendingResolution);
                    }

                    if parse_result.source.contents_is_recycled {
                        // this shared buffer is about to become owned by the AsyncModule struct
                        // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                        let fs_cache = unsafe { &mut (*jsc_vm).transpiler.resolver.caches.fs };
                        let buf = core::ptr::from_mut(fs_cache.shared_buffer()).cast_const();
                        // `parse_result.source.contents` borrows the detached buffer's bytes;
                        // ownership moves to the AsyncModule via the arena/parse_result, so the
                        // swapped-out backing storage must not be freed here.
                        let _ = core::mem::ManuallyDrop::new(fs_cache.reset_shared_buffer(buf));
                    }

                    // Hand `arena` ownership to the queue (defuse the give-back guard).
                    let (_, arena, _, _) = scopeguard::ScopeGuard::into_inner(arena_guard);
                    // Hand the `AstAlloc` state to the queue too: the queued
                    // AST's small `AstVec`s live in its inline bump chunk.
                    let ast_alloc_state = ast_alloc_scope.take_state();
                    // SAFETY: per fn contract — `jsc_vm` / `global_object` are the live
                    // per-thread VM / global; `package_json` is the opaque watcher
                    // forward-decl of `bun_resolver::package_json::PackageJSON`.
                    unsafe {
                        (*jsc_vm).modules.enqueue(
                            &*global_object,
                            bun_jsc::async_module::InitOpts {
                                parse_result,
                                path: *path,
                                loader,
                                fd,
                                package_json: package_json.map(|p| {
                                    &*core::ptr::from_ref(p)
                                        .cast::<bun_resolver::package_json::PackageJSON>()
                                }),
                                promise_ptr: Some(promise_ptr),
                                specifier,
                                referrer,
                                hash,
                                arena,
                                ast_alloc_state,
                            },
                        );
                    }
                    return Err(crate::Error::AsyncModule);
                }

                if !macro_mode {
                    // SAFETY: per fn contract — `jsc_vm` is the live per-thread
                    // VM; both fields are JS-thread-exclusive plain integers.
                    unsafe {
                        (*jsc_vm).resolved_count +=
                            (*jsc_vm).transpiler.linker.import_counter - start_count;
                    }
                }
                // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                unsafe { (*jsc_vm).transpiler.linker.import_counter = 0 };

                let is_commonjs_module = parse_result.ast.has_commonjs_export_names
                    || parse_result.ast.exports_kind == bun_ast::ExportsKind::Cjs;
                // Collect the ESM record while printing, for the isolation
                // source-provider cache (same shape as `RuntimeTranspilerStore`).
                // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                let mut module_info: Option<
                    Box<bun_bundler::analyze_transpiled_module::ModuleInfo>,
                > = if unsafe { &*jsc_vm }.use_isolation_source_provider_cache()
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
                // Derive the `*mut` from a `&mut` borrow (not `&x as *const _
                // as *mut _`, which is Stacked-Borrows UB). The borrow ends
                // here; the raw pointer stays valid until `module_info` is
                // moved/touched again (after `print_with_source_map`).
                let module_info_ptr: Option<
                    *mut bun_bundler::analyze_transpiled_module::ModuleInfo,
                > = module_info.as_deref_mut().map(core::ptr::from_mut);

                // ── js_printer::print ───────────────────────────────────────
                // SAFETY: `extra.source_code_printer` is non-null per `TranspileExtra`
                // contract.
                // Note: do NOT bind a long-lived `&mut BufferPrinter`
                // here — the `source_map_handler` / `print_with_source_map`
                // calls below each rederive `&mut *(*extra).source_code_printer`
                // from the raw pointer, which would invalidate any earlier
                // Unique tag under Stacked Borrows. Rederive at each use-site
                // instead (reset, mapper, print, get_written).
                unsafe { (*(*extra).source_code_printer).ctx.reset() };
                // Install the VM's sourcemap handler on the printer, then
                // print the parse result (ESM, ASCII) with sourcemaps.
                //
                // Note (borrowck): `source_map_handler` borrows the VM for
                // the getter's lifetime, but the print call also needs
                // `&mut vm.transpiler` and `&mut printer`. Per the raw-ptr
                // aliasing convention at the top of this fn (see fn-level PORT
                // NOTE), rederive from `jsc_vm`/`extra` raw ptrs at each
                // use-site so borrowck sees disjoint temporaries; the getter
                // itself only stashes raw pointers (VirtualMachine.rs
                // `SourceMapHandlerGetter`).
                //
                // Note (Stacked Borrows): the printer is passed to the
                // getter as the RAW `*mut BufferPrinter` (`source_map_handler`
                // takes `*mut`, not `&mut`). When a debugger is attached
                // (`mode != Connect`), `SourceMapHandlerGetter::
                // on_source_map_chunk` reborrows `&mut *self.printer` from that
                // raw pointer to append the inline-sourcemap trailer; doing so
                // through a stashed `&'a mut` would alias the
                // `writer: &mut BufferPrinter` live inside `print_ast`. After
                // this block returns, the `printer` binding is rederived from
                // the raw pointer below — any earlier Unique tag is dead.
                {
                    // SAFETY: `jsc_vm` / `(*extra).source_code_printer` are live
                    // for the call (fn contract); `mapper` does not escape this
                    // scope, so the unbounded `'a` from the raw-deref reborrow
                    // is bounded by the block.
                    let mut mapper =
                        unsafe { (*jsc_vm).source_map_handler((*extra).source_code_printer) };
                    // SAFETY: per fn contract — `jsc_vm` / `extra.source_code_printer`
                    // are live; the printer borrow is scoped to this call.
                    let print_result = unsafe {
                        (*jsc_vm).transpiler.print_with_source_map(
                            // Same per-call arena that `parse_options.arena`
                            // built `parse_result.ast` from — the printer's
                            // rope-flattening scratch belongs in it, not in
                            // the per-VM `transpiler_arena`.
                            &arena_guard.1,
                            parse_result,
                            &mut *(*extra).source_code_printer,
                            bun_js_printer::Format::EsmAscii,
                            mapper.get(),
                            module_info_ptr,
                        )
                    };
                    // The printer never took ownership of `module_info`;
                    // explicit destroy (not Drop) mirrors the async-path
                    // error arm.
                    if print_result.is_err() {
                        if let Some(mi) = module_info.take() {
                            mi.destroy();
                        }
                    }
                    print_result?;
                }

                if is_main {
                    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                    unsafe { (*jsc_vm).has_loaded = true };
                }

                // `module_info.asDeserialized()`: finalize the
                // printer-filled record into the FFI shape consumed by C++
                // (freed by C++ `~SourceProvider` via
                // `zig__ModuleInfoDeserialized__deinit` — ZigSourceProvider.cpp;
                // `ResolvedSource`/`OwnedResolvedSource` never free it, see the
                // ownership note in ResolvedSource.rs).
                let module_info: *mut core::ffi::c_void = module_info
                    .map(|mi| {
                        use bun_bundler::analyze_transpiled_module::ModuleInfoExt;
                        bun_core::heap::into_raw(mi.into_deserialized()).cast()
                    })
                    .unwrap_or(core::ptr::null_mut());

                // Watcher path uses ref-counted source.
                // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                if unsafe { &*jsc_vm }.is_watcher_enabled() {
                    // SAFETY: `extra.source_code_printer` is non-null per
                    // `TranspileExtra` contract; rederive after the print block
                    // (Stacked Borrows — see the matching note below).
                    let printer: &mut bun_js_printer::BufferPrinter =
                        unsafe { &mut *(*extra).source_code_printer };
                    // SAFETY: per fn contract — `jsc_vm` is the live per-thread
                    // VM; `printer.ctx.get_written()` borrows thread-local data.
                    let mut resolved_source = unsafe {
                        (*jsc_vm).ref_counted_resolved_source::<false>(
                            printer.ctx.get_written(),
                            input_specifier.dupe_ref(),
                            path.text,
                            None,
                        )
                    };
                    resolved_source.is_commonjs_module = is_commonjs_module;
                    resolved_source.module_info = module_info;
                    return Ok(OwnedResolvedSource::from(resolved_source));
                }

                // Final ResolvedSource.
                let tag = match loader {
                    L::Json | L::Jsonc => ResolvedSourceTag::JsonForObjectLoader,
                    L::Js | L::Jsx | L::Ts | L::Tsx => {
                        // Note: `bun_watcher::PackageJSON` is an opaque
                        // forward-decl of
                        // `bun_resolver::package_json::PackageJSON`; cast
                        // through to read `module_type`.
                        // SAFETY: `package_json` (when set) is a VM-lifetime
                        // backref into the resolver's package.json cache.
                        let module_type_ = package_json
                            .map(|pj| unsafe {
                                (*std::ptr::from_ref::<bun_watcher::PackageJSON>(pj)
                                    .cast::<bun_resolver::package_json::PackageJSON>())
                                .module_type
                            })
                            .or_else(|| {
                                // Recover the package.json lookup here so
                                // a `.cjs` under `"type":"module"` still tags as
                                // `PackageJsonTypeModule` (mirrors the cache-hit
                                // branch above).
                                let dir = path.name().dir;
                                if !path.is_file() || !bun_paths::is_absolute(dir) {
                                    return None;
                                }
                                // SAFETY: per fn contract — `transpiler.resolver`
                                // is a value field of the VM; `read_dir_info` is
                                // re-entrant on the JS thread and returns a
                                // stable cache slot.
                                match unsafe { (*jsc_vm).transpiler.resolver.read_dir_info(dir) } {
                                    Ok(Some(dir_info)) => dir_info
                                        .package_json()
                                        .or(dir_info.enclosing_package_json)
                                        .map(|p| p.module_type),
                                    _ => None,
                                }
                            })
                            .unwrap_or(module_type);
                        match module_type_ {
                            ModuleType::Esm => ResolvedSourceTag::PackageJsonTypeModule,
                            ModuleType::Cjs => ResolvedSourceTag::PackageJsonTypeCommonjs,
                            _ => ResolvedSourceTag::Javascript,
                        }
                    }
                    _ => ResolvedSourceTag::Javascript,
                };

                // SAFETY: `extra.source_code_printer` is non-null per
                // `TranspileExtra` contract. Rederive from the raw pointer
                // AFTER the print block — both the `writer: &mut BufferPrinter`
                // passed into `print_with_source_map` and the
                // `on_source_map_chunk` reborrow inside it invalidated any
                // earlier Unique tag under Stacked Borrows, so reading through
                // a pre-print binding here would be UB.
                let printer: &mut bun_js_printer::BufferPrinter =
                    unsafe { &mut *(*extra).source_code_printer };
                let written = printer.ctx.get_written();
                // The `Jsc` vtable bridge `put()` does not write
                // `cache.output_code` (only the `r#impl == None` fallback
                // does, and `r#impl` is `Some(Jsc)` here), so it is always
                // `None`.
                debug_assert!(cache.output_code.is_none());
                let written_len = written.len();
                let source_code = bun_core::String::clone_latin1(written);
                // `printer.ctx.buffer.deinit()`: release the
                // large/--smol print buffer now instead of holding it until the
                // next transpile. Replacing the printer drops the old buffer
                // (same shape as RuntimeTranspilerStore).
                // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                if written_len > 1024 * 1024 * 2 || unsafe { &*jsc_vm }.smol {
                    *printer =
                        bun_js_printer::BufferPrinter::init(bun_js_printer::BufferWriter::init());
                    printer.ctx.append_null_byte = false;
                }

                // (fd close handled by `_fd_guard` registered above; spec
                // :251-256 `defer` fires on every exit path.)

                return Ok(OwnedResolvedSource::from(ResolvedSource {
                    source_code,
                    specifier: input_specifier.dupe_ref(),
                    source_url: create_if_different(input_specifier, path.text),
                    is_commonjs_module,
                    module_info,
                    tag,
                    ..Default::default()
                }));
            }
        }

        // The `.node` fast-paths in `moduleLoaderFetch` / `overridableRequire`
        // only match module keys that literally end in `.node`, so `?query`
        // suffixes and `--loader <ext>:napi` mappings still reach here.
        L::Napi => {
            if global_object.is_null() {
                return Err(crate::Error::NotSupported);
            }
            // SAFETY: null-checked above; `global_object` is the live
            // per-thread global.
            let global = unsafe { &*global_object };
            Err(global
                .throw_type_error(format_args!(
                    "To load Node-API modules, use require() or process.dlopen instead of import."
                ))
                .into())
        }

        // ────────────────────────────────────────────────────────────────────
        // .wasm
        // ────────────────────────────────────────────────────────────────────
        L::Wasm => {
            // SAFETY: per fn contract.
            let main = unsafe { &*jsc_vm }.main();
            if referrer == b"undefined" && main == path.text {
                // Stash the WASM bytes on
                // `globalThis.wasmSourceBytes` so the wasi runner avoids
                // reading the file twice.
                if let Some(source) = args.virtual_source {
                    if !global_object.is_null() {
                        // SAFETY: null-checked above; `global_object` is the
                        // live per-thread global.
                        let global = unsafe { &*global_object };
                        // Spec — `DecodedJSValue{ .ptr = globalThis }.encode()`:
                        // a JSGlobalObject is a JSCell, so its pointer encodes
                        // directly as a JSValue.
                        let global_value = bun_jsc::DecodedJSValue {
                            u: bun_jsc::decoded_js_value::EncodedValueDescriptor {
                                ptr: core::ptr::from_ref(global).cast_mut().cast(),
                            },
                        }
                        .encode();
                        global_value.put(
                            global,
                            b"wasmSourceBytes",
                            bun_jsc::ArrayBuffer::create_uint8_array(global, &source.contents)?,
                        );
                    }
                }

                {
                    use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                    return Ok(OwnedResolvedSource::from(ResolvedSource {
                        source_code: bun_core::String::static_(include_bytes!(
                            "../js/wasi-runner.js"
                        )),
                        specifier: input_specifier.dupe_ref(),
                        source_url: create_if_different(input_specifier, path.text),
                        tag: ResolvedSourceTag::Esm,
                        ..Default::default()
                    }));
                }
            }
            // Recurse as `.file`.
            // SAFETY: per fn contract — `extra` is live for the call.
            unsafe {
                (*extra).loader = L::File;
                (*extra).module_type = ModuleType::Unknown;
            }
            transpile_source_code_inner(jsc_vm, args, extra)
        }

        // ────────────────────────────────────────────────────────────────────
        // .sqlite / .sqlite_embedded
        // ────────────────────────────────────────────────────────────────────
        L::Sqlite | L::SqliteEmbedded => {
            // The low-tier
            // `VirtualMachine.hot_reload` slot is a raw `u8`; compare against
            // the real `HotReload` enum discriminant (`!= 0` would also match
            // `.watch`, which is wrong).
            // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
            let hot =
                unsafe { &*jsc_vm }.hot_reload == bun_options_types::context::HotReload::Hot as u8;
            let sqlite_module_source_code_string: &'static [u8] = if hot {
                SQLITE_MODULE_SOURCE_HOT
            } else {
                SQLITE_MODULE_SOURCE
            };
            use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
            Ok(OwnedResolvedSource::from(ResolvedSource {
                source_code: bun_core::String::clone_utf8(sqlite_module_source_code_string),
                specifier: input_specifier.dupe_ref(),
                source_url: create_if_different(input_specifier, path.text),
                tag: ResolvedSourceTag::Esm,
                ..Default::default()
            }))
        }

        // ────────────────────────────────────────────────────────────────────
        // .html
        // ────────────────────────────────────────────────────────────────────
        L::Html => {
            if disable_transpilying {
                use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                return Ok(OwnedResolvedSource::from(ResolvedSource {
                    source_code: bun_core::String::empty(),
                    specifier: input_specifier.dupe_ref(),
                    source_url: create_if_different(input_specifier, path.text),
                    tag: ResolvedSourceTag::Esm,
                    ..Default::default()
                }));
            }
            if global_object.is_null() {
                return Err(crate::Error::NotSupported);
            }
            // SAFETY: null-checked above.
            let global = unsafe { &*global_object };
            let html_bundle = crate::api::HTMLBundle::init(global, path.text);
            use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
            Ok(OwnedResolvedSource::from(ResolvedSource {
                jsvalue_for_export: crate::api::HTMLBundle::to_js(html_bundle.into_raw(), global),
                specifier: input_specifier.dupe_ref(),
                source_url: create_if_different(input_specifier, path.text),
                tag: ResolvedSourceTag::ExportDefaultObject,
                ..Default::default()
            }))
        }

        // ────────────────────────────────────────────────────────────────────
        // Everything else — file loader: `export default <path>`.
        // ────────────────────────────────────────────────────────────────────
        _ => {
            if disable_transpilying {
                use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
                return Ok(OwnedResolvedSource::from(ResolvedSource {
                    source_code: bun_core::String::empty(),
                    specifier: input_specifier.dupe_ref(),
                    source_url: create_if_different(input_specifier, path.text),
                    tag: ResolvedSourceTag::Esm,
                    ..Default::default()
                }));
            }

            // auto-watch for non-virtual absolute paths.
            'auto_watch: {
                if args.virtual_source.is_some() {
                    break 'auto_watch;
                }
                // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                if !unsafe { &*jsc_vm }.is_watcher_enabled() {
                    break 'auto_watch;
                }
                if !bun_paths::is_absolute(path.text)
                    || bun_core::strings::contains(path.text, b"node_modules")
                {
                    break 'auto_watch;
                }
                // kqueue watchers need a file descriptor to receive event
                // notifications on it; inotify/win32 watch by path.
                let input_fd = if bun_watcher::REQUIRES_FILE_DESCRIPTORS {
                    let mut buf = bun_paths::path_buffer_pool::get();
                    if path.text.len() >= buf.len() {
                        break 'auto_watch;
                    }
                    let z = bun_paths::resolve_path::z(path.text, &mut buf);
                    match bun_sys::open(z, bun_watcher::WATCH_OPEN_FLAGS, 0) {
                        Ok(fd) => fd,
                        Err(_) => break 'auto_watch,
                    }
                } else {
                    bun_sys::Fd::INVALID
                };
                let hash = bun_watcher::Watcher::get_hash(path.text);
                // SAFETY: `bun_watcher` is the `*mut ImportWatcher`
                // set when `is_watcher_enabled()`; cast recovers the concrete
                // type.
                let watcher =
                    unsafe { &mut *(*jsc_vm).bun_watcher.cast::<bun_jsc::ImportWatcher>() };
                if watcher
                    .add_file::<true>(
                        input_fd,
                        path.text,
                        hash,
                        loader,
                        bun_sys::Fd::INVALID,
                        None,
                    )
                    .is_err()
                {
                    // Close the fd we just opened on macOS;
                    // not a transpile failure (the user didn't open it).
                    #[cfg(target_os = "macos")]
                    if input_fd.is_valid() {
                        use bun_sys::FdExt as _;
                        input_fd.close();
                    }
                }
            }

            // `export default <path string>`.
            use bun_jsc::resolved_source::Tag as ResolvedSourceTag;
            if global_object.is_null() {
                return Err(crate::Error::NotSupported);
            }
            // Note: tier-6 ctor lives in `bun_jsc::bun_string_jsc` (not on
            // `bun_core::String`, which is tier-2); calls
            // `BunString__createUTF8ForJS` under the hood.
            // SAFETY: null-checked above; `global_object` is the live per-thread
            // `JSGlobalObject` for the FFI call.
            let global = unsafe { &*global_object };
            // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
            let value = if !unsafe { &*jsc_vm }.origin.is_empty() {
                // Rewrite `specifier` against `vm.origin` so
                // importing an asset via the file loader yields the public URL,
                // not the absolute filesystem path.
                let mut buf = std::string::String::new();
                // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                // `URL<'static>` is a view struct; borrow it in place — no
                // `&mut *jsc_vm` aliases through the call below, so there is no
                // need to copy the ~12 borrowed slices out (perf: was a
                // per-asset-import `url::URL::clone`).
                let origin = unsafe { &(*jsc_vm).origin };
                let top_level_dir = Fs::FileSystem::get().top_level_dir;
                crate::api::bun_object::get_public_path_with_asset_prefix(
                    specifier,
                    top_level_dir,
                    origin,
                    b"",
                    &mut buf,
                    bun_paths::Platform::Loose,
                );
                bun_jsc::bun_string_jsc::create_utf8_for_js(global, buf.as_bytes())
                    .map_err(|_| crate::Error::JSError)?
            } else {
                bun_jsc::bun_string_jsc::create_utf8_for_js(global, path.text)
                    .map_err(|_| crate::Error::JSError)?
            };
            Ok(OwnedResolvedSource::from(ResolvedSource {
                jsvalue_for_export: value,
                specifier: input_specifier.dupe_ref(),
                source_url: create_if_different(input_specifier, path.text),
                tag: ResolvedSourceTag::ExportDefaultObject,
                ..Default::default()
            }))
        }
    }
}

/// Register the just-opened file
/// with the dev-server watcher (if enabled, absolute, and not in
/// `node_modules`). Factored out of the two call sites.
#[inline]
#[allow(clippy::too_many_arguments)]
fn maybe_watch_file(
    jsc_vm: *mut VirtualMachine,
    should_close_input_file_fd: &mut bool,
    input_file_fd: bun_sys::Fd,
    is_node_override: bool,
    path: &Fs::Path,
    hash: u32,
    loader: Loader,
    package_json: Option<&'static bun_watcher::PackageJSON>,
) {
    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
    if !unsafe { &*jsc_vm }.is_watcher_enabled() {
        return;
    }
    if !input_file_fd.is_valid() {
        return;
    }
    if is_node_override
        || !bun_paths::is_absolute(path.text)
        || bun_core::strings::contains(path.text, b"node_modules")
    {
        return;
    }
    *should_close_input_file_fd = false;
    // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set when
    // `is_watcher_enabled()`; cast recovers the concrete type.
    let watcher = unsafe { &mut *(*jsc_vm).bun_watcher.cast::<bun_jsc::ImportWatcher>() };
    let _ = watcher.add_file::<true>(
        input_file_fd,
        path.text,
        hash,
        loader,
        bun_sys::Fd::INVALID,
        package_json,
    );
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
fn js_synthetic_module(name: &'static [u8], specifier: &bun_core::String) -> OwnedResolvedSource {
    use bun_jsc::resolved_source::Tag;
    OwnedResolvedSource::from(ResolvedSource {
        source_code: bun_core::String::empty(),
        specifier: *specifier,
        source_url: bun_core::String::static_(name),
        tag: Tag::from_name(name),
        source_code_needs_deref: false,
        ..ResolvedSource::default()
    })
}

/// `getHardcodedModule(jsc_vm, specifier, hardcoded)` —
/// the per-variant body of the builtin-module fast path. Returns `None` when
/// the variant is recognised but not currently servable (e.g. `bun:main`
/// before `ServerEntryPoint::generate` has run, or `bun:internal-for-testing`
/// without the opt-in flag).
fn get_hardcoded_module(
    _jsc_vm: *mut VirtualMachine,
    specifier: &bun_core::String,
    hardcoded: HardcodedModule,
) -> Option<OwnedResolvedSource> {
    // The analytics-side set stores `&'static str` names
    // (cycle break — see `bun_analytics::features::BUILTIN_MODULES`), so feed
    // it the `strum::IntoStaticStr` tag name.
    bun_analytics::features::insert_builtin_module(<&'static str>::from(hardcoded));

    match hardcoded {
        HardcodedModule::BunMain => {
            // Synthetic `bun:main` wrapper — pulls source from this thread's
            // `RuntimeState.entry_point`.
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
            Some(OwnedResolvedSource::from(ResolvedSource {
                source_code: bun_core::String::clone_utf8(&ep.contents),
                // +1 each: ~SourceProvider() derefs `specifier` and
                // `source_url` once all uses are done (see ZigSourceProvider.cpp).
                specifier: specifier.dupe_ref(),
                source_url: specifier.dupe_ref(),
                tag: Tag::Esm,
                source_code_needs_deref: true,
                ..ResolvedSource::default()
            }))
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
            Some(js_synthetic_module(b"node:stream/iter", specifier))
        }
        HardcodedModule::NodeZlibIter => {
            // Same `--experimental-stream-iter` gate as `node:stream/iter`.
            if !bun_resolve_builtins::stream_iter_enabled() {
                return None;
            }
            Some(js_synthetic_module(b"node:zlib/iter", specifier))
        }
        HardcodedModule::BunInternalForTesting => {
            // Gated behind `--expose-internals` (release) / always-on (debug).
            if !bun_core::env::IS_DEBUG {
                let allowed = bun_jsc::module_loader::IS_ALLOWED_TO_USE_INTERNAL_TESTING_APIS
                    .load(core::sync::atomic::Ordering::Relaxed);
                if !allowed {
                    return None;
                }
            }
            Some(js_synthetic_module(b"bun:internal-for-testing", specifier))
        }
        HardcodedModule::InternalTestBinding => {
            // Gated behind `--expose-internals` (release) / always-on (debug),
            // same as `bun:internal-for-testing`. The tag key uses the
            // generated `internal:`-prefixed canonical specifier (see
            // `generated_resolved_source_tag.rs`).
            if !bun_core::env::IS_DEBUG {
                let allowed = bun_jsc::module_loader::IS_ALLOWED_TO_USE_INTERNAL_TESTING_APIS
                    .load(core::sync::atomic::Ordering::Relaxed);
                if !allowed {
                    return None;
                }
            }
            Some(js_synthetic_module(b"internal:test/binding", specifier))
        }
        HardcodedModule::BunWrap => {
            // `Runtime.Runtime.sourceCode()` — the bundler's CJS-interop
            // shim, embedded as a static string in `bun_ast::runtime`.
            return Some(OwnedResolvedSource::from(ResolvedSource {
                source_code: bun_core::String::init(bun_ast::runtime::Runtime::source_code()),
                // +1 each: ~SourceProvider() derefs both.
                specifier: specifier.dupe_ref(),
                source_url: specifier.dupe_ref(),
                ..ResolvedSource::default()
            }));
        }
        // Every other `HardcodedModule` is served straight out of the
        // InternalModuleRegistry by tag, with no Rust-side source text.
        other => {
            let name: &'static str = other.into();
            Some(js_synthetic_module(name.as_bytes(), specifier))
        }
    }
}

/// `ModuleLoader.fetchBuiltinModule(jsc_vm, specifier)` — `HardcodedModule`
/// lookup + macro-namespace + standalone-module-graph probe; also covers the
/// `Bun__fetchBuiltinModule` export wrapper.
///
/// # Safety
/// `jsc_vm` is the live per-thread VM; `out` is a valid out-param.
unsafe fn fetch_builtin_module(
    jsc_vm: *mut VirtualMachine,
    _global: *mut JSGlobalObject,
    specifier: &bun_core::String,
    _referrer: &bun_core::String,
    out: *mut ErrorableResolvedSource,
) -> FetchBuiltinResult {
    // The PHF map keys on `&[u8]`, so transcode once up-front;
    // builtin specifiers are short ASCII so `to_utf8()` is borrow-only in
    // the common case (`ZigStringSlice` drops without freeing).
    let spec_utf8 = specifier.to_utf8();
    let spec = spec_utf8.slice();

    // ── HardcodedModule fast path ───────────────────────────────────────
    if let Some(&hardcoded) = HardcodedModule::MAP.get(spec) {
        return match get_hardcoded_module(jsc_vm, specifier, hardcoded) {
            Some(resolved) => {
                // SAFETY: per fn contract — `out` is a valid out-param.
                unsafe { *out = ErrorableResolvedSource::ok(resolved.into_ffi()) };
                FetchBuiltinResult::Found
            }
            // Recognised builtin but not servable right now → fall through
            // to filesystem resolution.
            None => FetchBuiltinResult::NotFound,
        };
    }

    // ── `macro:` namespace ──────────────────────────────────────────────
    // `vm.macro_entry_points` values are
    // `*mut MacroEntryPoint` (gated `bun_bundler::entry_points` type); the
    // map itself is keyed by `i32` hash of the specifier.
    if spec.starts_with(b"macro:") {
        use bun_bundler::entry_points::MacroEntryPoint;
        let id = MacroEntryPoint::generate_id_from_specifier(spec);
        // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
        if let Some(&entry) = unsafe { &*jsc_vm }.macro_entry_points.get(&id) {
            let entry = entry.cast::<MacroEntryPoint>();
            // SAFETY: `entry` is the `heap::alloc`d `MacroEntryPoint`
            // inserted by `js_run_macro_entry_point`; map ownership keeps it
            // alive for the VM lifetime.
            unsafe {
                *out = ErrorableResolvedSource::ok(ResolvedSource {
                    source_code: bun_core::String::clone_utf8(&(*entry).source.contents),
                    // +1 each: ~SourceProvider() derefs both.
                    specifier: specifier.dupe_ref(),
                    source_url: specifier.dupe_ref(),
                    ..ResolvedSource::default()
                });
            }
            return FetchBuiltinResult::Found;
        }
        return FetchBuiltinResult::NotFound;
    }

    // ── Standalone-module-graph probe ───────────────────────────────────
    // The VM field is the resolver's
    // read-only `&dyn StandaloneModuleGraph`; for `File::to_wtf_string`
    // (mutates the lazy `wtf_string` cache) we need write provenance, so
    // reach the concrete `Graph` via its `UnsafeCell` singleton accessor —
    // same path as `load_standalone_sourcemap` / `node_fs`.
    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
    if unsafe { &*jsc_vm }.standalone_module_graph.is_some() {
        let graph = bun_standalone_graph::Graph::get()
            .expect("vm.standalone_module_graph set ⇔ Graph singleton populated");
        // Spec uses `graph.files.getPtr(spec)` (no virtual-root prefix
        // check). SAFETY: `graph` is the `UnsafeCell::get()` pointer to the
        // process-lifetime singleton; this hook runs on the JS thread and
        // the only mutation below (`to_wtf_string`) is the per-`File`
        // idempotent `wtf_string` cache.
        if let Some(file) = unsafe { (*graph).files.get_mut(spec) } {
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
                // SAFETY: per fn contract — `out` is a valid out-param.
                unsafe {
                    *out = ErrorableResolvedSource::ok(ResolvedSource {
                        source_code: bun_core::String::static_(SQLITE_MODULE_SOURCE_STANDALONE),
                        // +1 each: ~SourceProvider() derefs both.
                        specifier: specifier.dupe_ref(),
                        source_url: specifier.dupe_ref(),
                        source_code_needs_deref: false,
                        ..ResolvedSource::default()
                    });
                }
                return FetchBuiltinResult::Found;
            }

            let bytecode_len = file.bytecode.len();
            let module_info_len = file.module_info.len();
            // SAFETY: per fn contract — `out` is a valid out-param.
            // `file.module_info` is a live subrange of the embedded section
            // (set in `Graph::from_bytes`); `create_from_cached_record`
            // copies out of it before returning.
            unsafe {
                *out = ErrorableResolvedSource::ok(ResolvedSource {
                    source_code: file.to_wtf_string(),
                    // +1 each: ~SourceProvider() derefs both.
                    specifier: specifier.dupe_ref(),
                    source_url: specifier.dupe_ref(),
                    bytecode_origin_path: if !file.bytecode_origin_path.is_empty() {
                        bun_core::String::from_bytes(file.bytecode_origin_path)
                    } else {
                        bun_core::String::empty()
                    },
                    source_code_needs_deref: false,
                    bytecode_cache: if bytecode_len > 0 {
                        file.bytecode.cast::<u8>()
                    } else {
                        core::ptr::null_mut()
                    },
                    bytecode_cache_size: bytecode_len,
                    module_info: if module_info_len > 0 {
                        bun_bundler::analyze_transpiled_module::ModuleInfoDeserialized
                            ::create_from_cached_record(&*file.module_info)
                            .map(bun_core::heap::into_raw)
                            .unwrap_or(core::ptr::null_mut())
                            .cast::<c_void>()
                    } else {
                        core::ptr::null_mut()
                    },
                    is_commonjs_module: file.module_format == ModuleFormat::Cjs,
                    ..ResolvedSource::default()
                });
            }
            return FetchBuiltinResult::Found;
        }
    }

    FetchBuiltinResult::NotFound
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
        // 254 = `_none`; everything else is open-tail.
        _ => None,
    }
}

/// `Fs.Path.loader(&jsc_vm.transpiler.options.loaders)` — re-spelt against
/// `bun_ast::LoaderHashTable` (= `StringArrayHashMap<bun_ast::Loader>`).
fn loader_for_path(path: &Fs::Path<'_>, loaders: &bun_ast::LoaderHashTable) -> Option<Loader> {
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
///
/// # Safety
/// `jsc_vm` is the live per-thread VM.
unsafe fn normalize_specifier_for_loader<'a>(
    jsc_vm: *mut VirtualMachine,
    slice_: &'a [u8],
) -> (&'a [u8], &'a [u8], &'a [u8]) {
    let mut slice = slice_;
    if slice.is_empty() {
        return (slice, slice, b"");
    }
    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
    let host = unsafe { &*jsc_vm }.origin.host;
    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
    let opath = unsafe { &*jsc_vm }.origin.path;
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
    virtual_source: Option<&'a bun_ast::Source>,
    path: Fs::Path<'a>,
    is_main: bool,
    specifier: &'a [u8],
    /// Always `None` for non-JS-like loaders (not needed there).
    package_json: Option<&'a bun_resolver::package_json::PackageJSON>,
}

/// `options.getLoaderAndVirtualSource` — high-tier body.
/// Named `*mut VirtualMachine` directly per the §Dispatch
/// note above (no `VmLoaderCtx` vtable).
///
/// # Safety
/// `jsc_vm` is the live per-thread VM; the returned borrows live as long as
/// the input `specifier_str` / the VM's resolver caches.
unsafe fn get_loader_and_virtual_source<'a>(
    specifier_str: &'a [u8],
    jsc_vm: *mut VirtualMachine,
    virtual_source_to_use: &'a mut Option<bun_ast::Source>,
    blob_to_deinit: &mut Option<crate::webcore::Blob>,
    type_attribute_str: Option<&[u8]>,
) -> crate::Result<LoaderResult<'a>> {
    let (normalized_file_path_from_specifier, specifier, query) =
        // SAFETY: per fn contract.
        unsafe { normalize_specifier_for_loader(jsc_vm, specifier_str) };
    let mut path = Fs::Path::init(normalized_file_path_from_specifier);

    // SAFETY: per fn contract — `transpiler.options` is a value field of the VM.
    let mut loader: Option<Loader> =
        loader_for_path(&path, unsafe { &(*jsc_vm).transpiler.options.loaders });
    let mut virtual_source: Option<&'a bun_ast::Source> = None;

    // Synthetic `[eval]`/`[stdin]` source.
    // SAFETY: per fn contract.
    if let Some(eval_source) = unsafe { &*jsc_vm }.module_loader.eval_source.as_deref() {
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
            // SAFETY: `eval_source` is heap-owned by the VM (`Box<Source>`); it
            // outlives the synchronous transpile this borrow feeds into.
            virtual_source = Some(unsafe { &*std::ptr::from_ref::<bun_ast::Source>(eval_source) });
            loader = Some(Loader::Tsx);
        }
    }

    // `blob:` ObjectURL → in-memory virtual source.
    if crate::webcore::object_url_registry::is_blob_url(specifier) {
        match crate::webcore::object_url_registry::ObjectURLRegistry::singleton()
            .resolve_and_dupe(&specifier[b"blob:".len()..])
        {
            Some(blob) => {
                *blob_to_deinit = Some(blob);
                // SAFETY: `blob_to_deinit` is `Some` (just written); we hold
                // `&mut` for the duration of this body, so `as_mut().unwrap()`
                // is sound and the `&'a` reborrow points at storage owned by
                // the *caller's* `Option<Blob>` slot (outlives `LoaderResult`).
                let blob = blob_to_deinit.as_mut().unwrap();
                // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                loader = blob.get_loader(unsafe { &*jsc_vm });

                // "file:" loader makes no sense for blobs, so default to tsx.
                if let Some(filename) = blob.get_file_name() {
                    // Only treat it as a file if it is a `Bun.file()`.
                    if blob.needs_to_read_file() {
                        // Note: borrowck — `Fs::Path<'a>` borrows
                        // `filename`, which borrows `*blob_to_deinit`. The
                        // caller owns that slot for `'a`, so erase via raw ptr.
                        // SAFETY: `filename` borrows the blob's backing store,
                        // which the caller's `blob_to_deinit` slot keeps alive
                        // for `'a`; reconstructing the slice preserves provenance.
                        path = Fs::Path::init(unsafe {
                            core::slice::from_raw_parts(filename.as_ptr(), filename.len())
                        });
                    }
                }

                if !blob.needs_to_read_file() {
                    // SAFETY: same lifetime erasure as above — `shared_view()`
                    // borrows the blob's backing store (held in the caller's
                    // `blob_to_deinit` slot for the synchronous transpile).
                    // `bun_ast::Source` stores `&'static [u8]` (see
                    // logger/lib.rs §`type Str`), so erase to
                    // `'static`; sound because the blob outlives the
                    // synchronous `transpile_source_code_inner` call.
                    let (contents, path_text): (&'static [u8], &'static [u8]) = unsafe {
                        let v = blob.shared_view();
                        (
                            core::slice::from_raw_parts(v.as_ptr(), v.len()),
                            core::slice::from_raw_parts(path.text.as_ptr(), path.text.len()),
                        )
                    };
                    *virtual_source_to_use = Some(bun_ast::Source {
                        // Note: `bun_ast::Source::path` is the
                        // logger-local `fs::Path` (NOT `bun_resolver::fs::Path`
                        // — see logger/lib.rs:32-). Re-init from `path.text`.
                        path: bun_paths::fs::Path::init(path_text),
                        contents: bun_ptr::Cow::Borrowed(contents),
                        ..Default::default()
                    });
                    virtual_source = virtual_source_to_use.as_ref();
                }
            }
            None => return Err(crate::Error::BlobNotFound),
        }
    }

    if query == b"?raw" {
        loader = Some(Loader::Text);
    }
    if let Some(attr_str) = type_attribute_str {
        if let Some(attr_loader) = Loader::from_string(attr_str) {
            loader = Some(attr_loader);
        }
    }

    // SAFETY: per fn contract.
    let is_main = specifier == unsafe { &*jsc_vm }.main();

    // package.json sniff for `.js`/`.ts` module-type.
    let dir = path.name().dir;
    let is_js_like = loader.map(|l| l.is_java_script_like()).unwrap_or(true);
    let package_json = if is_js_like && bun_paths::is_absolute(dir) {
        // SAFETY: per fn contract — `transpiler.resolver` is a value field of
        // the VM; `read_dir_info` is re-entrant on the JS thread.
        match unsafe { (*jsc_vm).transpiler.resolver.read_dir_info(dir) } {
            Ok(Some(dir_info)) => dir_info.package_json().or(dir_info.enclosing_package_json),
            _ => None,
        }
    } else {
        None
    };

    Ok(LoaderResult {
        loader,
        virtual_source,
        path,
        is_main,
        specifier,
        package_json,
    })
}

thread_local! {
    /// Per-thread shared `BufferPrinter`. Lazy-init in [`transpile_file`];
    /// never freed (process-lifetime singleton —
    /// PORTING.md §Forbidden permits the leak for true thread-local singletons).
    static TRANSPILE_PRINTER: Cell<*mut bun_js_printer::BufferPrinter> =
        const { Cell::new(ptr::null_mut()) };

    /// Dedup cache for [`intern_transpile_path`] — see that fn's Note.
    /// `&'static [u8]` keys point into the `FilenameStore` BSS singleton, so
    /// the set itself owns nothing beyond its bucket array.
    static TRANSPILE_PATH_INTERN: core::cell::RefCell<
        bun_collections::HashMap<&'static [u8], ()>,
    > = core::cell::RefCell::new(bun_collections::HashMap::new());
}

/// Intern `value` into the process-lifetime `FilenameStore`, returning a
/// `&'static` view — but **deduplicated** by content so repeated calls with
/// equal bytes return the same backing slice instead of appending a fresh
/// copy each time.
///
/// Note: the
/// `bun_paths::fs::Path<'static><'static>` shape forces a re-intern on
/// every call. `BSSStringList::append` does not dedupe, so a `require()`
/// loop that busts `require.cache` (test/cli/run/require-cache.test.ts —
/// "files transpiled and loaded don't leak file paths") leaked one path-len
/// buffer per iteration into the never-freed BSS store, eventually pushing
/// RSS over the test's threshold on busy CI hosts. The thread-local
/// `HashSet<&'static [u8]>` makes the intern idempotent: each distinct path
/// is appended exactly once (matching the resolver's own per-file semantics),
/// and the 10⁴–10⁵-iteration leak tests pay zero growth after the first call.
///
/// PERF: most callers already hand us a slice that lives inside the
/// `FilenameStore` BSS arena — the resolver interns every resolved module path
/// before this point, and a re-entrant transpile of an arena-resident path
/// just round-trips its own prior result. For those, skip the content hash and
/// `HashSet` probe/insert entirely: a pointer-range compare against the store's
/// backing buffer (`FilenameStore::exists`) proves
/// the bytes are already `'static`, so we can widen and return them directly.
/// Only genuinely-foreign slices (heap-backed `bun.String::to_utf8` views, the
/// rare overflow-block case) fall back to the dedup map. This is ~0.7%
/// self-time on `bun --bun eslint .` (hundreds of `require()`d CJS modules).
fn intern_transpile_path(value: &[u8]) -> &'static [u8] {
    // Fast path: `value` already lives in the process-lifetime `FilenameStore`
    // backing arena (resolver-interned, or a prior `intern_transpile_path`
    // result) — no hash, no probe, no append.
    if Fs::FilenameStore::instance().exists(value) {
        // SAFETY: `exists` is the pointer-range check `isSliceInBuffer` — the
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

/// Modules that must always transpile on-thread (see [`transpile_file`]).
const ALWAYS_SYNC_MODULES: &[&[u8]] = &[b"reflect-metadata"];

/// `Bun__transpileFile` body — concurrent-transpiler entry. Returns the
/// in-flight `JSInternalPromise*` when `allow_promise && async`, else null
/// (result is in `*ret`).
///
/// PERF: this is the per-`require()` / per-`import` hot-loop root. Its call
/// chain (-> `parse_maybe_return_file_only_allow_shared_buffer` ->
/// `LexerType::next` -> `Printer::print_expr` -> `add_source_mapping`) is
/// pinned as a contiguous block in `src/startup.order` ("Runtime-transpiler
/// per-module hot loop") so lld doesn't interleave it with one-shot JSC
/// VM-init C++ from the cold-start profile. If you rename / outline anything
/// reachable from here that shows up in `perf top` on `bun --bun eslint .`,
/// re-run the regen recipe in that file's header (eslint workload FIRST) —
/// otherwise smaps r-xp Rss on lint/create-vite regresses ~1.9 MB despite a
/// smaller .text.
///
/// # Safety
/// `jsc_vm` is the live per-thread VM; `global` is its `JSGlobalObject*`;
/// `specifier_ptr`/`referrer` are valid `bun.String*` for the call's duration;
/// `type_attribute` is null or a valid `bun.String*`; `ret` is a valid
/// out-param the caller reads when `null` is returned.
unsafe fn transpile_file(
    jsc_vm: *mut VirtualMachine,
    global: *mut JSGlobalObject,
    specifier_ptr: *const bun_core::String,
    referrer: *const bun_core::String,
    type_attribute: *const bun_core::String,
    ret: *mut ErrorableResolvedSource,
    allow_promise: bool,
    is_commonjs_require: bool,
    force_loader: u8,
) -> *mut c_void {
    use bun_jsc::resolved_source::Tag as ResolvedSourceTag;

    // SAFETY: per fn contract.
    let global_ref = unsafe { &*global };

    let force_loader_type: Option<Loader> = force_loader_from_api_u8(force_loader);

    // Create a fresh parse log.
    // Note: per §Allocators the explicit allocator threads are dropped.
    let log = bun_ast::Log::init();
    // Note: a scopeguard so every `return null` path still frees the msg vec.
    let mut log = scopeguard::guard(log, |mut l| {
        l.msgs.clear();
    });

    // UTF-8 views over the WTF-backed `bun.String` inputs.
    // SAFETY: per fn contract — both pointers are valid for the call.
    let _specifier = unsafe { &*specifier_ptr }.to_utf8();
    // SAFETY: per fn contract — `referrer` is valid for the call.
    let referrer_slice = unsafe { &*referrer }.to_utf8();

    // `type_attribute` may be null (no `with { type }`).
    // SAFETY: per fn contract — null or a live `bun.String*`.
    let type_attribute_str: Option<&[u8]> =
        unsafe { type_attribute.as_ref() }.and_then(|s| s.as_utf8());

    let mut virtual_source_to_use: Option<bun_ast::Source> = None;
    let mut blob_to_deinit: Option<crate::webcore::Blob> = None;
    // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
    let mut lr = match unsafe {
        get_loader_and_virtual_source(
            _specifier.slice(),
            jsc_vm,
            &mut virtual_source_to_use,
            &mut blob_to_deinit,
            type_attribute_str,
        )
    } {
        Ok(lr) => lr,
        Err(_) => {
            let js = global_ref
                .err(
                    bun_jsc::ErrCode::ERR_MODULE_NOT_FOUND,
                    format_args!("Blob not found"),
                )
                .to_js();
            // SAFETY: per fn contract — `ret` is a valid out-param.
            unsafe {
                *ret = ErrorableResolvedSource::err(ErrorCode(ErrorCode::JS_ERROR_OBJECT), js);
            }
            return ptr::null_mut();
        }
    };
    // Deinit the blob (if any) on scope exit.
    // Note: reshaped for borrowck — capture the `is_some()` flag *before*
    // moving the option into the scopeguard so the `transpile_async` predicate
    // can still read it without aliasing the guard's `&mut`.
    let had_blob = blob_to_deinit.is_some();
    let _blob_guard = scopeguard::guard(blob_to_deinit, |mut slot| {
        if let Some(mut blob) = slot.take() {
            blob.deinit();
        }
    });

    // ── force_loader / require.extensions override ──────────────────────────
    if let Some(loader_type) = force_loader_type {
        // Note: `@branchHint(.unlikely)` dropped (no stable Rust equiv).
        debug_assert!(!is_commonjs_require);
        lr.loader = Some(loader_type);
    } else if is_commonjs_require
        // SAFETY: per fn contract.
        && unsafe { &*jsc_vm }.has_mutated_built_in_extensions > 0
    {
        use bun_jsc::node_module_module::{CustomLoader, find_longest_registered_extension};
        if let Some(entry) =
            // SAFETY: per fn contract.
            find_longest_registered_extension(unsafe { &*jsc_vm }, _specifier.slice())
        {
            match entry {
                CustomLoader::Loader(loader) => lr.loader = Some(*loader),
                CustomLoader::Custom(strong) => {
                    // SAFETY: `ret` is a valid out-param per fn contract.
                    unsafe {
                        *ret = ErrorableResolvedSource::ok(ResolvedSource {
                            source_code: bun_core::String::empty(),
                            specifier: bun_core::String::empty(),
                            source_url: bun_core::String::empty(),
                            cjs_custom_extension_index: strong.get(),
                            tag: ResolvedSourceTag::CommonJsCustomExtension,
                            ..Default::default()
                        });
                    }
                    return ptr::null_mut();
                }
            }
        }
    }

    // ── module_type sniff from extension / package.json ─────────────────────
    let module_type: ModuleType = 'brk: {
        let ext = lr.path.name().ext;
        // regex /\.[cm][jt]s$/
        if ext.len() == b".cjs".len() {
            if ext == b".cjs" {
                break 'brk ModuleType::Cjs;
            }
            if ext == b".mjs" {
                break 'brk ModuleType::Esm;
            }
            if ext == b".cts" {
                break 'brk ModuleType::Cjs;
            }
            if ext == b".mts" {
                break 'brk ModuleType::Esm;
            }
        }
        // regex /\.[jt]s$/
        if ext.len() == b".ts".len() && (ext == b".js" || ext == b".ts") {
            // Use the package.json module type if it exists.
            break 'brk lr
                .package_json
                .map(|pkg| pkg.module_type)
                .unwrap_or(ModuleType::Unknown);
        }
        // For JSX/TSX and other extensions, let the file contents decide.
        ModuleType::Unknown
    };
    let pkg_name: Option<&[u8]> = lr
        .package_json
        .and_then(|pkg| (!pkg.name.is_empty()).then_some(&*pkg.name));

    // ── Concurrent-transpiler dispatch (`transpile_async:` block) ───────────
    // We only run the transpiler concurrently when we can.
    // Today that's: import statements (`import 'foo'`) and import expressions
    // (`import('foo')`).
    'transpile_async: {
        let concurrent_loader = lr.loader.unwrap_or(Loader::File);
        // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
        let (has_loaded, is_in_preload, plugin_runner_is_none, store_enabled) = unsafe {
            (
                (*jsc_vm).has_loaded,
                (*jsc_vm).is_in_preload,
                (*jsc_vm).plugin_runner.is_none(),
                (*jsc_vm).transpiler_store.enabled,
            )
        };
        if !had_blob
            && allow_promise
            && (has_loaded || is_in_preload)
            && concurrent_loader.is_java_script_like()
            && !lr.is_main
            // Plugins make this complicated.
            // TODO: allow running concurrently when no onLoad handlers match a plugin.
            && plugin_runner_is_none
            && store_enabled
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

            // SAFETY: per fn contract — `jsc_vm` / `specifier_ptr` / `referrer`
            // are valid for the call. `lr.path` borrows `_specifier`, which the
            // store immediately heap-duplicates inside `transpile()`.
            return unsafe {
                (*jsc_vm).transpiler_store.transpile(
                    jsc_vm,
                    global_ref,
                    (*specifier_ptr).dupe_ref(),
                    &lr.path,
                    (*referrer).dupe_ref(),
                    concurrent_loader,
                    lr.package_json,
                )
            };
        }
        let _ = concurrent_loader;
    }

    // ── Synchronous-loader fallback ────────────────────────────────────────
    // Note: hoisted out of `unwrap_or_else` into a
    // labelled block so the `CustomLoader::Custom` arm can write `*ret` and
    // `return null` from `Bun__transpileFile` itself — a
    // closure cannot perform a non-local return.
    let synchronous_loader: Loader = 'loader: {
        if let Some(l) = lr.loader {
            break 'loader l;
        }
        // SAFETY: per fn contract.
        let (has_loaded, is_in_preload) =
            unsafe { ((*jsc_vm).has_loaded, (*jsc_vm).is_in_preload) };
        if has_loaded || is_in_preload {
            // Extensionless files in this context are treated as the JS loader.
            if lr.path.name().ext.is_empty() {
                break 'loader Loader::Tsx;
            }
            // Unknown extensions are to be treated as file loader.
            if is_commonjs_require {
                use bun_jsc::node_module_module::{
                    CustomLoader, find_longest_registered_extension,
                };
                // SAFETY: per fn contract — `jsc_vm` is the live per-thread VM.
                if unsafe {
                    (*jsc_vm).commonjs_custom_extensions.len() > 0
                        && (*jsc_vm).has_mutated_built_in_extensions == 0
                } {
                    if let Some(entry) = find_longest_registered_extension(
                        // SAFETY: per fn contract.
                        unsafe { &*jsc_vm },
                        lr.path.text,
                    ) {
                        match entry {
                            CustomLoader::Loader(loader) => break 'loader *loader,
                            CustomLoader::Custom(strong) => {
                                // SAFETY: `ret` is a valid out-param per fn
                                // contract.
                                unsafe {
                                    *ret = ErrorableResolvedSource::ok(ResolvedSource {
                                        source_code: bun_core::String::empty(),
                                        specifier: bun_core::String::empty(),
                                        source_url: bun_core::String::empty(),
                                        cjs_custom_extension_index: strong.get(),
                                        tag: ResolvedSourceTag::CommonJsCustomExtension,
                                        ..Default::default()
                                    });
                                }
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

    // Reset the module loader's arena on scope exit.
    // `jsc_vm` is the live per-thread VM (BackRef invariant).
    let _reset_arena = ArenaResetGuard::new(jsc_vm);

    // Lazy-init the per-thread shared printer.
    // `load_extra_env_and_source_code_printer` calls `ensure_source_code_printer`
    // (VirtualMachine.rs), but prime defensively here on first use too.
    let printer_ptr: *mut bun_js_printer::BufferPrinter = TRANSPILE_PRINTER.with(|cell| {
        let mut p = cell.get();
        if p.is_null() {
            let writer = bun_js_printer::BufferWriter::init();
            let mut bp = Box::new(bun_js_printer::BufferPrinter::init(writer));
            bp.ctx.append_null_byte = false;
            p = bun_core::heap::into_raw(bp);
            cell.set(p);
        }
        p
    });

    // ── `ModuleLoader.transpileSourceCode(...)` ─────────────────────────────
    let mut promise: *mut JSInternalPromise = ptr::null_mut();
    let mut extra = TranspileExtra {
        // SAFETY: `TranspileExtra::path` is typed `'static` for the cross-crate
        // fn-ptr ABI; the borrow actually lives only for this synchronous call
        // (the `extra` struct is consumed by `transpile_source_code_inner`
        // before `_specifier` / `virtual_source_to_use` drop). Same erasure as
        // `transpile_virtual_module` below.
        path: unsafe { lr.path.into_static() },
        loader: synchronous_loader,
        module_type,
        source_code_printer: printer_ptr,
        promise_ptr: if allow_promise {
            &raw mut promise
        } else {
            ptr::null_mut()
        },
    };
    let args = TranspileArgs {
        specifier: lr.specifier,
        referrer: referrer_slice.slice(),
        // SAFETY: per fn contract — `*specifier_ptr` is valid for the call;
        // `bun.String` is `Copy` (tagged-pointer pair) so by-value is sound.
        input_specifier: unsafe { *specifier_ptr },
        log: &raw mut *log,
        virtual_source: lr.virtual_source,
        global_object: global,
        flags: FetchFlags::Transpile,
        extra: (&raw mut extra).cast::<c_void>(),
    };

    match transpile_source_code_inner(jsc_vm, &args, &raw mut extra) {
        Ok(resolved) => {
            // SAFETY: per fn contract — `ret` is a valid out-param.
            unsafe { *ret = ErrorableResolvedSource::ok(resolved.into_ffi()) };
            promise.cast::<c_void>()
        }
        Err(err) => {
            if matches!(err, crate::Error::AsyncModule) {
                debug_assert!(!promise.is_null());
                return promise.cast::<c_void>();
            }
            if matches!(
                err,
                crate::Error::PluginError | crate::Error::Bundler(bun_bundler::Error::Plugin)
            ) {
                return ptr::null_mut();
            }
            if matches!(
                err,
                crate::Error::JSError
                    | crate::Error::Js(_)
                    | crate::Error::Bundler(bun_bundler::Error::Js(_))
            ) {
                // `take_error` unwraps
                // the JSC::Exception to its inner value; the C++ caller
                // re-wraps via `JSC::Exception::create`, so storing the raw
                // Exception here would double-wrap and trip
                // `ASSERT(!value.inherits<Exception>())` in JSPromise::reject.
                let exc = global_ref.take_error(bun_jsc::JsError::Thrown);
                // SAFETY: per fn contract.
                unsafe {
                    *ret = ErrorableResolvedSource::err(ErrorCode(ErrorCode::JS_ERROR_OBJECT), exc);
                }
                return ptr::null_mut();
            }
            // Generic transpile error → format `log` into `*ret`.
            bun_jsc::module_loader::process_fetch_log(
                global_ref,
                // SAFETY: per fn contract — pointers valid for the call.
                unsafe { *specifier_ptr },
                // SAFETY: per fn contract — `referrer` is valid for the call.
                unsafe { *referrer },
                &mut log,
                // SAFETY: per fn contract — `ret` is a valid out-param.
                unsafe { &mut *ret },
                to_jsc_fetch_error(&err),
            );
            ptr::null_mut()
        }
    }
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
    specifier: &bun_core::String,
    hardcoded: HardcodedModule,
    out: *mut ResolvedSource,
) -> bool {
    match get_hardcoded_module(jsc_vm, specifier, hardcoded) {
        Some(resolved) => {
            // SAFETY: per fn contract — `out` is a valid out-param.
            unsafe { *out = resolved.into_ffi() };
            true
        }
        None => false,
    }
}

/// `LoaderHooks::transpile_virtual_module` body —
/// `Bun__transpileVirtualModule`. Transpiles
/// plugin-provided source through the per-thread `TRANSPILE_PRINTER`.
///
/// # Safety
/// `global` is the live JS-thread `JSGlobalObject*`; `specifier_ptr` /
/// `referrer_ptr` are valid `bun.String*` for the call's duration;
/// `source_code` is a valid `ZigString*`; `ret` is a valid out-param.
unsafe fn transpile_virtual_module(
    global: *mut JSGlobalObject,
    specifier_ptr: *const bun_core::String,
    referrer_ptr: *const bun_core::String,
    source_code: *mut bun_core::ZigString,
    loader_: bun_options_types::schema::api::Loader,
    ret: *mut ErrorableResolvedSource,
) -> bool {
    use bun_options_types::schema::api;

    // SAFETY: per fn contract — `global` is the live JS-thread global.
    let global_ref = unsafe { &*global };
    // Note: `bun_vm_ptr()` returns the FFI `*mut VirtualMachine` directly;
    // going through `bun_vm() -> &VirtualMachine -> *const -> *mut` would
    // launder provenance through a shared ref and the `&mut *jsc_vm` /
    // transpiler writes below would be UB under Stacked Borrows.
    let jsc_vm: *mut VirtualMachine = global_ref.bun_vm_ptr();
    // Note: spec asserted `jsc_vm.plugin_runner != null` then dropped the
    // assert ("not required for build.module()") — keep parity (no assert).

    // SAFETY: per fn contract — pointers valid for the call.
    let specifier_slice = unsafe { &*specifier_ptr }.to_utf8();
    let specifier = specifier_slice.slice();
    // SAFETY: per fn contract.
    let source_code_slice = unsafe { &*source_code }.to_slice();
    // SAFETY: per fn contract.
    let referrer_slice = unsafe { &*referrer_ptr }.to_utf8();

    let virtual_source = bun_ast::Source::init_path_string(specifier, source_code_slice.slice());
    let mut log = bun_ast::Log::init();
    // SAFETY: `TranspileExtra::path` is typed `'static` for the cross-crate
    // fn-ptr ABI; the borrow actually lives only for this call (the `extra`
    // struct is consumed by `transpile_source_code_inner` before
    // `specifier_slice` drops). Same erasure as `transpile_file` above.
    let path: Fs::Path<'static> = unsafe { Fs::Path::init(specifier).into_static() };

    // Pick the loader: the explicit API loader if given, else by file
    // extension, else `.js` for the main module / `.file` otherwise.
    let loader = if loader_ != api::Loader::_none {
        Loader::from_api(loader_)
    } else {
        // SAFETY: `jsc_vm` is the live per-thread VM.
        let opt = unsafe { &*jsc_vm }
            .transpiler
            .options
            .loaders
            .get(path.name().ext)
            .copied();
        opt.unwrap_or_else(|| {
            // SAFETY: `jsc_vm` is the live per-thread VM.
            if bun_core::strings::eql_long(specifier, unsafe { &*jsc_vm }.main(), true) {
                Loader::Js
            } else {
                Loader::File
            }
        })
    };

    // Reset the module loader's arena on scope exit.
    // `jsc_vm` is the live per-thread VM (BackRef invariant).
    let _reset_arena = ArenaResetGuard::new(jsc_vm);

    // Lazy-init the per-thread shared printer (same path as `transpile_file`).
    let printer_ptr: *mut bun_js_printer::BufferPrinter = TRANSPILE_PRINTER.with(|cell| {
        let mut p = cell.get();
        if p.is_null() {
            let writer = bun_js_printer::BufferWriter::init();
            let mut bp = Box::new(bun_js_printer::BufferPrinter::init(writer));
            bp.ctx.append_null_byte = false;
            p = bun_core::heap::into_raw(bp);
            cell.set(p);
        }
        p
    });

    // ── `ModuleLoader.transpileSourceCode(...)` ─────────────────────────────
    let mut extra = TranspileExtra {
        path,
        loader,
        module_type: ModuleType::Unknown,
        source_code_printer: printer_ptr,
        promise_ptr: ptr::null_mut(), // null forbids async resolution
    };
    let args = TranspileArgs {
        specifier,
        referrer: referrer_slice.slice(),
        // SAFETY: per fn contract — `*specifier_ptr` is valid for the call;
        // `bun.String` is `Copy` (tagged-pointer pair) so by-value is sound.
        input_specifier: unsafe { *specifier_ptr },
        log: &raw mut log,
        virtual_source: Some(&virtual_source),
        global_object: global,
        flags: FetchFlags::Transpile,
        extra: (&raw mut extra).cast::<c_void>(),
    };

    match transpile_source_code_inner(jsc_vm, &args, &raw mut extra) {
        Ok(resolved) => {
            // SAFETY: per fn contract — `ret` is a valid out-param.
            unsafe { *ret = ErrorableResolvedSource::ok(resolved.into_ffi()) };
            bun_analytics::features::virtual_modules
                .fetch_add(1, core::sync::atomic::Ordering::Relaxed);
            true
        }
        Err(err) => {
            if matches!(
                err,
                crate::Error::PluginError | crate::Error::Bundler(bun_bundler::Error::Plugin)
            ) {
                return true;
            }
            if matches!(
                err,
                crate::Error::JSError
                    | crate::Error::Js(_)
                    | crate::Error::Bundler(bun_bundler::Error::Js(_))
            ) {
                // `take_error` unwraps
                // the JSC::Exception to its inner value (see same note in
                // `transpile_file` above).
                let exc = global_ref.take_error(bun_jsc::JsError::Thrown);
                // SAFETY: per fn contract.
                unsafe {
                    *ret = ErrorableResolvedSource::err(ErrorCode(ErrorCode::JS_ERROR_OBJECT), exc);
                }
                return true;
            }
            // Generic transpile error → format `log` into `*ret`.
            bun_jsc::module_loader::process_fetch_log(
                global_ref,
                // SAFETY: per fn contract — pointers valid for the call.
                unsafe { *specifier_ptr },
                // SAFETY: per fn contract — `referrer_ptr` is valid for the call.
                unsafe { *referrer_ptr },
                &mut log,
                // SAFETY: per fn contract — `ret` is a valid out-param.
                unsafe { &mut *ret },
                to_jsc_fetch_error(&err),
            );
            true
        }
    }
}

/// Core of `ModuleLoader.resolveEmbeddedFile`:
/// finds an embedded file in the standalone module graph, materializes it to
/// a real on-disk temp file with `extname`, and writes the resulting absolute
/// path into `out_buf`. Returns the number of bytes written.
///
/// Called from two paths:
///   - `resolve_embedded_node_file_hook` (`process.dlopen()` on a compiled
///     executable; extname = `"node"`).
///   - `bun:ffi` `dlopen()` on an embedded `with { type: "file" }` shared
///     library (`ffi_body::FFI::open`; extname = `"so"` / `"dylib"` / `"dll"`).
///
/// Returns `None` when the path is empty, not present in the graph, or any
/// filesystem step fails.
pub(crate) fn resolve_embedded_file_to_buf(
    input_path: &[u8],
    extname: &[u8],
    out_buf: &mut [u8],
) -> Option<usize> {
    if input_path.is_empty() {
        return None;
    }

    // Note: do NOT downcast the `&'static dyn StandaloneModuleGraph`
    // stored on `vm` to `&mut Graph` — that shared-ref provenance is
    // read-only (instant UB under Stacked Borrows). Reach the concrete graph
    // via `Graph::get()` which hands out the `UnsafeCell` `*mut` (same path
    // as `load_standalone_sourcemap` / `node_fs`).
    let graph = bun_standalone_graph::Graph::get()?;
    // SAFETY: `graph` is the `UnsafeCell::get()` pointer to the
    // process-lifetime singleton; this hook runs on the JS thread and `find`
    // is read-only over the post-init `files` table.
    let file = (unsafe { &mut *graph }).find(input_path)?;
    let file_name: &[u8] = file.name;
    let file_contents: &[u8] = file.contents.as_bytes();

    let mut tmpname_buf = bun_paths::path_buffer_pool::get();
    let tmpfilename =
        Fs::FileSystem::tmpname(extname, &mut tmpname_buf[..], bun_wyhash::hash(file_name)).ok()?;

    // SAFETY: `FileSystem::instance()` returns the process-global singleton
    // pointer (initialized at startup).
    let tmpdir = (*Fs::FileSystem::instance()).tmpdir().ok()?;
    let tmpdir_fd: bun_sys::Fd = tmpdir.fd;

    let tmpfile = bun_sys::Tmpfile::create(tmpdir_fd, tmpfilename).ok()?;
    let tmpfile_fd = tmpfile.fd;
    scopeguard::defer! {
        let _ = bun_sys::close(tmpfile_fd);
    }

    let mut scratch = bun_paths::path_buffer_pool::get();
    if bun_sys::write_file_with_path_buffer(
        &mut scratch,
        &bun_sys::WriteFileArgs {
            data: bun_sys::WriteFileData::Buffer {
                buffer: file_contents,
            },
            encoding: bun_sys::WriteFileEncoding::Buffer,
            dirfd: tmpdir_fd,
            file: bun_sys::PathOrFileDescriptor::Fd(tmpfile_fd),
            ..Default::default()
        },
    )
    .is_err()
    {
        return None;
    }

    // `join_abs_string_buf` writes into
    // `out_buf` and returns a slice pointing into it; capture the length so
    // the caller knows how many bytes are live.
    let result = bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Auto>(
        Fs::RealFS::tmpdir_path(),
        out_buf,
        &[tmpfilename.as_bytes()],
    );
    Some(result.len())
}

/// `LoaderHooks::resolve_embedded_node_file` body —
/// `ModuleLoader.resolveEmbeddedFile` for the
/// `process.dlopen()`-on-a-compiled-executable path. Delegates to
/// [`resolve_embedded_file_to_buf`] with `extname = "node"` and writes the
/// resulting on-disk path back into `*in_out_str`
/// (as an owned UTF-8 clone).
///
/// # Safety
/// `vm` is the live per-thread VM; `in_out_str` is a valid in/out
/// `bun.String*` (C++ ABI, BunProcess.cpp). Caller (`Bun__resolveEmbeddedNodeFile`
/// in `bun_jsc::module_loader`) has already checked
/// `vm.standalone_module_graph.is_some()`.
unsafe fn resolve_embedded_node_file_hook(
    vm: *mut VirtualMachine,
    in_out_str: *mut bun_core::String,
) -> bool {
    // SAFETY: per fn contract — `in_out_str` is a valid `bun.String*`.
    let input_path_utf8 = unsafe { &*in_out_str }.to_utf8();
    let input_path = input_path_utf8.slice();
    let _ = vm;

    let mut path_buf = bun_paths::path_buffer_pool::get();
    let Some(len) = resolve_embedded_file_to_buf(input_path, b"node", &mut path_buf[..]) else {
        return false;
    };

    // SAFETY: per fn contract.
    unsafe { *in_out_str = bun_core::String::clone_utf8(&path_buf[..len]) };
    true
}

// ════════════════════════════════════════════════════════════════════════════
// LoaderHooks::resolve — `VirtualMachine.resolveMaybeNeedsTrailingSlash`
// + `_resolve`.
//
// This is the resolution path behind `Bun__resolveSync`,
// `Zig__GlobalObject__resolve`, `import.meta.resolve`, and
// `Module._findPath`. The body drives `transpiler.resolver` (a
// `bun_resolver::Resolver` value field of `VirtualMachine`) and reaches into
// `ServerEntryPoint` / `ObjectURLRegistry` — all forward-deps on `bun_jsc`,
// hence §Dispatch.
// ════════════════════════════════════════════════════════════════════════════

/// Path-separator-adjusted literal suffixes. Only the two
/// `_resolve` callers need them (the `[eval]` / `[stdin]` suffix checks), so
/// inline the per-platform constants.
#[cfg(windows)]
const EVAL_SUFFIX: &[u8] = b"\\[eval]";
#[cfg(not(windows))]
const EVAL_SUFFIX: &[u8] = b"/[eval]";
#[cfg(windows)]
const STDIN_SUFFIX: &[u8] = b"\\[stdin]";
#[cfg(not(windows))]
const STDIN_SUFFIX: &[u8] = b"/[stdin]";

/// Split off the `?query` suffix.
#[inline]
fn normalize_specifier_for_resolution<'a>(
    specifier: &'a [u8],
    query_string: &mut &'a [u8],
) -> &'a [u8] {
    if let Some(i) = bun_core::strings::index_of_char_usize(specifier, b'?') {
        let i = i as usize;
        *query_string = &specifier[i..];
        &specifier[..i]
    } else {
        specifier
    }
}

/// Strip a `file://` prefix.
#[inline]
fn normalize_source(source: &[u8]) -> &[u8] {
    source.strip_prefix(b"file://".as_slice()).unwrap_or(source)
}

/// `VirtualMachine._resolve`.
///
/// Writes the resolved path/query into `*ret_path` / `*ret_query`. A full
/// `Resolver::Result` would be unused by the
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
) -> crate::Result<()> {
    use bun_ast::Target;
    use bun_jsc::virtual_machine::MAIN_FILE_NAME;
    use bun_resolve_builtins::{Alias, Cfg as AliasCfg};

    // `Runtime.Runtime.Imports.alt_name` == `Runtime.Runtime.Imports.Name`
    // == `"bun:wrap"` (see js_parser/runtime.rs:644-645); both consts are the
    // bare specifier so a direct equality on `basename(specifier)` is correct.
    if bun_paths::basename(specifier) == b"bun:wrap" {
        *ret_path = b"bun:wrap";
        return Ok(());
    }

    // `bun:main` synthetic entry. `entry_point` lives on the
    // high-tier `RuntimeState`.
    if specifier == MAIN_FILE_NAME {
        let state = runtime_state();
        // SAFETY: `state` is the per-thread `RuntimeState` box; null only when
        // no high tier is installed (impossible — this *is* the high tier).
        if !state.is_null() && unsafe { &*state }.entry_point.generated {
            *ret_path = MAIN_FILE_NAME;
            return Ok(());
        }
    }

    // `macro:` namespace passes through.
    if specifier.starts_with(bun_js_parser::Macro::NAMESPACE_WITH_COLON) {
        // The caller
        // clones `ret_path` into an owned string unconditionally, so
        // returning the borrowed slice is sufficient and avoids a leak
        // (PORTING.md §Forbidden (leaking)).
        *ret_path = specifier;
        return Ok(());
    }

    // `node_fallbacks` virtual import path.
    if specifier.starts_with(node_fallbacks::IMPORT_PATH) {
        *ret_path = specifier;
        return Ok(());
    }

    // Hardcoded builtin alias (`node:fs` etc.).
    if let Some(alias) = Alias::get(specifier, Target::Bun, AliasCfg::default()) {
        *ret_path = alias.path.as_bytes();
        return Ok(());
    }

    // `[eval]` / `[stdin]` virtual sources.
    // SAFETY: `vm` is the live per-thread VM.
    if unsafe { &*vm }.module_loader.eval_source.is_some()
        && (specifier.ends_with(EVAL_SUFFIX) || specifier.ends_with(STDIN_SUFFIX))
    {
        *ret_path = specifier;
        return Ok(());
    }

    // `blob:` URLs registered via `URL.createObjectURL`.
    if let Some(rest) = specifier.strip_prefix(b"blob:".as_slice()) {
        if crate::webcore::object_url_registry::ObjectURLRegistry::singleton().has(rest) {
            *ret_path = specifier;
            return Ok(());
        }
        return Err(crate::Error::ModuleNotFound);
    }

    // ── Filesystem resolver ──────────────────────────────────────────────
    let is_special_source = source == MAIN_FILE_NAME || bun_js_parser::Macro::is_macro_path(source);
    let mut query_string: &[u8] = b"";
    let normalized_specifier = normalize_specifier_for_resolution(specifier, &mut query_string);
    // `Fs.PathName.init(source).dirWithTrailingSlash()` slices
    // `source` in place, so the `'a` lifetime is preserved.
    let top_level_dir: &'a [u8] = Fs::FileSystem::get().top_level_dir;
    let source_to_use: &[u8] = if !is_special_source {
        if is_a_file_path {
            Fs::PathName::init(source).dir_with_trailing_slash()
        } else {
            source
        }
    } else {
        top_level_dir
    };

    // `resolveAndAutoInstall` retry-on-not-found loop.
    // SAFETY: `resolver.opts.global_cache` is a plain enum field.
    let global_cache = unsafe { &*vm }.transpiler.resolver.opts.global_cache;
    let kind = if is_esm {
        ImportKind::Stmt
    } else {
        ImportKind::Require
    };

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
            ResolveResultUnion::Failure(e) => return Err(e.into()),
            ResolveResultUnion::Pending(_) | ResolveResultUnion::NotFound => {
                if !retry_on_not_found {
                    return Err(crate::Error::ModuleNotFound);
                }
                retry_on_not_found = false;

                // Bust the dir cache for the candidate
                // parent directory and retry once.
                let mut buf = bun_paths::path_buffer_pool::get();
                let buster_name: &[u8] = 'name: {
                    if bun_paths::is_absolute(normalized_specifier) {
                        if let Some(dir) = bun_core::dirname(normalized_specifier) {
                            if dir.len() > buf.len() {
                                return Err(crate::Error::ModuleNotFound);
                            }
                            // Normalized without trailing slash.
                            break 'name bun_paths::string_paths::normalize_slashes_only(
                                &mut buf[..],
                                dir,
                                bun_paths::SEP,
                            );
                        }
                    }

                    // If the specifier is too long to join, it can't name a
                    // real directory — skip the cache bust and fail.
                    if source_to_use.len() + normalized_specifier.len() + 4 >= buf.len() {
                        return Err(crate::Error::ModuleNotFound);
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
                        bun_paths::string_paths::without_trailing_slash_windows_path(buster_name),
                    )
                } {
                    continue;
                }
                return Err(crate::Error::ModuleNotFound);
            }
        }
    };

    // SAFETY: plain bool/usize fields.
    unsafe {
        if !(*vm).macro_mode {
            (*vm).has_any_macro_remappings =
                (*vm).has_any_macro_remappings || !(*vm).transpiler.options.macro_remap.is_empty();
        }
    }

    *ret_query = query_string;
    let Some(result_path) = result.path_const() else {
        return Err(crate::Error::ModuleNotFound);
    };
    // SAFETY: plain usize field.
    unsafe { (*vm).resolved_count += 1 };

    // Note: `result_path.text` is a `&'_ [u8]` borrowed from the
    // resolver's interned `'static` BSSStringList stores (see resolver/lib.rs
    // §allocators) — the same store `load_preloads` reads from. Transmute the
    // lifetime to `'a` so the caller can `cloneUTF8` it; the underlying bytes
    // outlive the program.
    // SAFETY: `result_path.text` borrows the resolver's `'static` interned
    // string store; detaching the borrow lifetime is sound (see Note).
    *ret_path = unsafe { bun_ptr::detach_lifetime(result_path.text) };
    Ok(())
}

/// `LoaderHooks::resolve` body —
/// `VirtualMachine.resolveMaybeNeedsTrailingSlash`.
///
/// # Safety
/// `res` / `global` are valid; `query_string` is null or a valid out-param.
/// `specifier` / `source` are passed by value (spec moves the `bun.String`s by
/// value too) and are NOT derefed here — the caller owns them.
unsafe fn resolve_hook(
    res: *mut ErrorableString,
    global: *mut JSGlobalObject,
    specifier: bun_core::String,
    source: bun_core::String,
    query_string: *mut bun_core::String,
    is_esm: bool,
    is_a_file_path: bool,
    is_user_require_resolve: bool,
) -> bool {
    use bun_ast::Target;
    use bun_jsc::ResolveMessage;
    use bun_resolve_builtins::{Alias, Cfg as AliasCfg};

    // SAFETY: per fn contract.
    let global_ref = unsafe { &*global };
    // Note: `bun_vm_ptr()` returns the FFI `*mut VirtualMachine` directly
    // (mutable provenance from C++); we go through a raw ptr (not `&mut`) for
    // the resolver/log writes below to avoid aliasing (PORTING.md §Forbidden —
    // same raw-ptr-per-field style as `load_preloads`/`transpile_source_code`).
    // Going through `bun_vm() -> &VirtualMachine -> *mut` would be UB to write
    // through under Stacked Borrows.
    let vm: *mut VirtualMachine = global_ref.bun_vm_ptr();

    // Overlong specifier guard. `MAX_PATH_BYTES * 1.5`, truncated:
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
        let printed = ResolveMessage::fmt(
            specifier_utf8.slice(),
            source_utf8.slice(),
            bun_jsc::CrateError::Sys(bun_errno::SystemErrno::ENAMETOOLONG),
            import_kind,
        );
        let msg = bun_ast::Msg {
            data: bun_ast::range_data(None, bun_ast::Range::NONE, printed),
            ..Default::default()
        };
        let js_err = match ResolveMessage::create(global_ref, &msg, source_utf8.slice()) {
            Ok(v) => v,
            Err(_) => return false,
        };
        // SAFETY: per fn contract.
        unsafe { *res = ErrorableString::err(ErrorCode(ErrorCode::JS_ERROR_OBJECT), js_err) };
        return true;
    }

    let specifier_utf8 = specifier.to_utf8();
    let source_utf8 = source.to_utf8();

    // `PluginRunner.onResolveJSC`.
    // SAFETY: `vm` is the live per-thread VM.
    if unsafe { &*vm }.plugin_runner.is_some() {
        use bun_bundler_jsc::PluginRunner as plugin_runner;
        if plugin_runner::could_be_plugin(specifier_utf8.slice()) {
            let namespace = plugin_runner::extract_namespace(specifier_utf8.slice());
            let after_namespace = if namespace.is_empty() {
                specifier_utf8.slice()
            } else {
                &specifier_utf8.slice()[namespace.len() + 1..]
            };
            match plugin_runner::on_resolve_jsc(
                global_ref,
                bun_core::String::init(namespace),
                bun_core::String::borrow_utf8(after_namespace),
                source,
                bun_jsc::BunPluginTarget::Bun,
            ) {
                Ok(Some(resolved_path)) => {
                    // SAFETY: per fn contract.
                    unsafe { *res = resolved_path };
                    return true;
                }
                Ok(None) => {}
                // JS exception was thrown; caller observes it via the
                // global's exception state, so bail without writing `res`.
                Err(_) => return false,
            }
        }
    }

    // Hardcoded builtin alias fast path. For
    // `require.resolve("fs")` (`is_user_require_resolve && node_builtin`) Node
    // returns the bare specifier as-is, not the canonical `node:fs`.
    if let Some(hardcoded) = Alias::get(specifier_utf8.slice(), Target::Bun, AliasCfg::default()) {
        let path = if is_user_require_resolve && hardcoded.node_builtin {
            specifier.dupe_ref()
        } else {
            bun_core::String::init(hardcoded.path.as_bytes())
        };
        // SAFETY: per fn contract.
        unsafe { *res = ErrorableString::ok(path) };
        return true;
    }

    // Swap `vm.log` (and resolver/linker/pm logs) to a fresh
    // local Log so resolver diagnostics don't leak into the VM log. Note:
    // `Resolver.log` is `NonNull<Log>` and `Linker.log` is `*mut Log` (see
    // transpile_source_code's identical swap at jsc_hooks.rs:848-879), so the
    // pointer write is sound; restore via scopeguard so the early-`return
    // false` paths don't leave a dangling stack pointer.
    let mut log = bun_ast::Log::init();
    // `vm.log` is set unconditionally in `init` and never cleared — the
    // `expect` is infallible.
    // SAFETY: per fn contract — `vm` is the live per-thread VM.
    let old_log: core::ptr::NonNull<bun_ast::Log> =
        unsafe { &*vm }.log.expect("vm.log set in init");
    let log_nn: core::ptr::NonNull<bun_ast::Log> = core::ptr::NonNull::from(&mut log);
    // SAFETY: `vm` is the live per-thread VM.
    unsafe {
        (*vm).log = Some(log_nn);
        (*vm).transpiler.resolver.log = log_nn;
        (*vm).transpiler.linker.log = log_nn.as_ptr();
        if let Some(pm) = (*vm).transpiler.resolver.package_manager {
            (*pm.cast::<bun_install::PackageManager>().as_ptr()).log = log_nn.as_ptr();
        }
    }
    scopeguard::defer! {
        // SAFETY: `vm` is the live per-thread VM; restoring the log pointers
        // swapped just above so early-return paths don't leave a dangling
        // stack pointer. The PM may have been lazily created inside
        // `_resolve` with `pm.log = resolver.log` (our stack `log`), so
        // restore it even if it was `None` at swap time.
        unsafe {
            (*vm).log = Some(old_log);
            (*vm).transpiler.resolver.log = old_log;
            (*vm).transpiler.linker.log = old_log.as_ptr();
            if let Some(pm) = (*vm).transpiler.resolver.package_manager {
                (*pm.cast::<bun_install::PackageManager>().as_ptr()).log = old_log.as_ptr();
            }
        }
    }

    let mut result_path: &[u8] = b"";
    let mut result_query: &[u8] = b"";
    // SAFETY: `vm` is the live per-thread VM; the slices borrow
    // `specifier_utf8`/`source_utf8` which outlive this call.
    if let Err(err) = unsafe {
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
        // Synthesise a `ResolveMessage` from the first
        // `.resolve`-tagged log msg, or fall back to `ResolveMessage::fmt`.
        let msg: bun_ast::Msg = 'brk: {
            for m in log.msgs.iter() {
                if let bun_ast::Metadata::Resolve(_) = &m.metadata {
                    break 'brk m.clone();
                }
            }

            let import_kind = if is_esm {
                ImportKind::Stmt
            } else if is_user_require_resolve {
                ImportKind::RequireResolve
            } else {
                ImportKind::Require
            };

            let printed = ResolveMessage::fmt(
                specifier_utf8.slice(),
                source_utf8.slice(),
                to_jsc_fetch_error(&err),
                import_kind,
            );
            bun_ast::Msg {
                data: bun_ast::range_data(None, bun_ast::Range::NONE, printed.clone()),
                metadata: bun_ast::Metadata::Resolve(bun_ast::MetadataResolve {
                    specifier: bun_ast::BabyString::r#in(&printed, specifier_utf8.slice()),
                    import_kind,
                    err: bun_ast::Error::ModuleNotFound,
                }),
                ..Default::default()
            }
        };

        let js_err = match ResolveMessage::create(global_ref, &msg, source_utf8.slice()) {
            Ok(v) => v,
            Err(_) => return false,
        };
        // SAFETY: per fn contract.
        unsafe { *res = ErrorableString::err(ErrorCode(ErrorCode::JS_ERROR_OBJECT), js_err) };
        return true;
    }

    // Write `*query_string`. `result_query` borrows
    // `specifier_utf8`, which is freed when this fn returns; clone into an
    // owned `bun.String`.
    if !query_string.is_null() {
        // SAFETY: per fn contract — `query_string` is a valid out-param.
        unsafe {
            *query_string = if !result_query.is_empty() {
                bun_core::String::clone_utf8(result_query)
            } else {
                bun_core::String::empty()
            };
        }
    }

    // `result.path` may borrow `specifier_utf8` (e.g. `http://`
    // specifiers the resolver marked external without copying); clone for the
    // same reason. Callers own the resulting ref.
    // SAFETY: per fn contract.
    unsafe { *res = ErrorableString::ok(bun_core::String::clone_utf8(result_path)) };
    true
}

/// The static `LoaderHooks` instance handed to `bun_jsc`.
#[unsafe(no_mangle)]
pub(crate) static __BUN_LOADER_HOOKS: LoaderHooks = LoaderHooks {
    transpile_source_code,
    fetch_builtin_module,
    get_hardcoded_module: get_hardcoded_module_hook,
    resolve_embedded_node_file: resolve_embedded_node_file_hook,
    transpile_virtual_module,
    transpile_file,
    resolve: resolve_hook,
};

// ════════════════════════════════════════════════════════════════════════════
// Hook installation
// ════════════════════════════════════════════════════════════════════════════

// Note: the event-loop per-task bodies (`__bun_run_immediate_task` /
// `__bun_run_wtf_timer`) live in [`crate::dispatch`] alongside the other
// §Dispatch hot-path bodies (`__bun_tick_queue_with_count` / `__bun_run_file_poll`).

/// `bun_io::__bun_get_vm_ctx` body — recover the global event-loop context
/// for the requested arm. Declared
/// `extern "Rust"` in `bun_io::posix_event_loop`; link-time resolved.
#[unsafe(no_mangle)]
pub(crate) fn __bun_get_vm_ctx(kind: bun_io::AllocatorType) -> bun_io::EventLoopCtx {
    match kind {
        // SAFETY: `get_mut_ptr()` is the live per-thread VM singleton.
        bun_io::AllocatorType::Js => unsafe {
            bun_jsc::virtual_machine::VirtualMachine::event_loop_ctx(
                bun_jsc::virtual_machine::VirtualMachine::get_mut_ptr(),
            )
        },
        bun_io::AllocatorType::Mini => {
            // SAFETY: `GLOBAL` is set by `MiniEventLoop::init_global` before
            // any caller asks for `AllocatorType::Mini` (the global mini loop
            // is the only one and is init-once); `mini` is live
            // for the process and `as_event_loop_ctx` only stores it as a tagged
            // backref.
            let mini = bun_event_loop::MiniEventLoop::GLOBAL.with(|g| g.get());
            // SAFETY: `mini` is the live process-global `MiniEventLoop` (see above).
            bun_event_loop::MiniEventLoop::MiniEventLoop::as_event_loop_ctx(unsafe { &mut *mini })
        }
    }
}

/// `dateForHeader`: wrap the header bytes in a
/// `bun.String`, call `String.parseDate(&s, vm.global)`, return the integer
/// value if finite and non-negative, else `None`. Lives in this crate (callers
/// are `server::FileRoute` / `server::StaticRoute`) so `bun_uws_sys` (T0) has
/// no upward hook into `bun_jsc`.
pub fn parse_http_date(value: &[u8]) -> Option<u64> {
    let vm = bun_jsc::virtual_machine::VirtualMachine::get();
    // SAFETY: `vm.global` is set during `VirtualMachine::init` and outlives
    // the VM; `parse_http_date` is only reachable from a `Bun.serve` request
    // callback (JS thread, VM live).
    let global = unsafe { &*(*vm).global };
    let mut string = bun_core::String::init(value);
    // The only callers — FileRoute / static
    // routes — treat a throw the same as "header absent / unparsable", so
    // swallow `JsError` here and surface `None`.
    let date_f64 = match bun_jsc::bun_string_jsc::parse_date(&mut string, global) {
        Ok(v) => v,
        Err(_) => {
            string.deref();
            return None;
        }
    };
    string.deref();
    if !date_f64.is_nan() && date_f64.is_finite() && date_f64 >= 0.0 {
        Some(date_f64 as u64)
    } else {
        None
    }
}

/// `bun_event_loop::__bun_js_vm_get` body — erased `VirtualMachine::get()` for
/// `AbstractVM::JsKind`'s `get_vm()`.
/// Declared `extern "Rust"` in `bun_event_loop::MiniEventLoop`; link-time
/// resolved.
#[unsafe(no_mangle)]
pub(crate) fn __bun_js_vm_get() -> *mut () {
    bun_jsc::virtual_machine::VirtualMachine::get_mut_ptr().cast()
}

/// `bun_event_loop::__bun_stdio_blob_store_new` body.
/// Returns an erased `*mut webcore::blob::Store` with intrusive `ref_count = 2`
/// (one for `RareData`/`MiniEventLoop`, one for the eventual `Blob` consumer).
/// Declared `extern "Rust"` in `bun_event_loop::MiniEventLoop`; link-time
/// resolved.
#[unsafe(no_mangle)]
pub(crate) fn __bun_stdio_blob_store_new(
    fd: bun_sys::Fd,
    is_atty: bool,
    mode: bun_sys::Mode,
) -> *mut () {
    use bun_jsc::node_path::PathOrFileDescriptor;
    use bun_jsc::webcore_types::store::{Data, File, Store};
    let store: Box<Store> = Store::new(Store {
        data: Data::File(File {
            pathlike: PathOrFileDescriptor::Fd(fd),
            is_atty: Some(is_atty),
            mode,
            ..Default::default()
        }),
        mime_type: bun_http_types::MimeType::NONE,
        ref_count: bun_ptr::ThreadSafeRefCount::init_exact_refs(2),
        is_all_ascii: None,
    });
    bun_core::heap::into_raw(store).cast()
}

/// Releases both refs from [`__bun_stdio_blob_store_new`]'s `+2` (one owner ref + one
/// dead immortality sentinel). Live retained `StoreRef`s keep their own `+1`, so safe.
#[unsafe(no_mangle)]
pub(crate) fn __bun_stdio_blob_store_deinit(ptr: *mut ()) {
    use bun_jsc::webcore_types::store::Store;
    let Some(this) = core::ptr::NonNull::new(ptr.cast::<Store>()) else {
        return;
    };
    // SAFETY: ptr is a live `Box<Store>` raw from the ctor; releasing its +2.
    unsafe {
        Store::deref(this);
        Store::deref(this);
    }
}
