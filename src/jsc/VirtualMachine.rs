//! This is the shared global state for a single JS instance execution.
//!
//! Today, Bun is one VM per thread, so the name "VirtualMachine" sort of makes
//! sense. If that changes, this should be renamed `ScriptExecutionContext`.
//!
//! ──────────────────────────────────────────────────────────────────────────
//! B-2 un-gate: real `VirtualMachine` struct with the core field set
//! (`global`, `event_loop`, `jsc_vm`, `transpiler`, `source_mappings`,
//! `rare_data`, `counters`, `active_tasks`, …) + lifecycle accessors. Fields
//! and methods that name `bun_runtime` / `bun_webcore` types (forward-dep
//! cycle on `bun_jsc`) are preserved verbatim from the Phase-A draft inside
//! `` blocks below; un-gate piecewise as the cycle breaks.
//! ──────────────────────────────────────────────────────────────────────────

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};
use core::ptr::NonNull;

use bun_bundler::Transpiler;
use bun_io as Async;
use bun_uws as uws;

use crate::counters::Counters;
use crate::event_loop::EventLoop;
#[allow(unused_imports)]
use crate::ipc::IPC; // scoped logger static for `bun_core::scoped_log!(IPC, ...)`
use crate::module_loader::{self as ModuleLoader, FetchFlags};
use crate::rare_data::RareData;
use crate::saved_source_map::SavedSourceMap;
use crate::{
    self as jsc, ErrorableResolvedSource, ErrorableString, Exception, JSGlobalObject,
    JSInternalPromise, JSValue, JsError, JsResult, OpaqueCallback, PlatformEventLoop,
    ResolvedSource, Strong, VM, ZigException,
};

pub use crate::process_auto_killer as ProcessAutoKiller;

// ──────────────────────────────────────────────────────────────────────────
// Exported globals
// ──────────────────────────────────────────────────────────────────────────

// `AtomicBool`/`AtomicI32`/`AtomicUsize` have the same size/alignment as the
// underlying scalar, so the `#[no_mangle]` symbol layout is unchanged for the
// C++ side; Rust gets race-free reads.
#[unsafe(no_mangle)]
pub static has_bun_garbage_collector_flag_enabled: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);
#[unsafe(no_mangle)]
pub static isBunTest: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
#[unsafe(no_mangle)]
pub static Bun__defaultRemainingRunsUntilSkipReleaseAccess: core::sync::atomic::AtomicI32 =
    core::sync::atomic::AtomicI32::new(10);

// TODO: evaluate if this has any measurable performance impact.
pub static SYNTHETIC_ALLOCATION_LIMIT: core::sync::atomic::AtomicUsize =
    core::sync::atomic::AtomicUsize::new(u32::MAX as usize);
#[inline]
pub fn synthetic_allocation_limit() -> usize {
    SYNTHETIC_ALLOCATION_LIMIT.load(core::sync::atomic::Ordering::Relaxed)
}
// `string_allocation_limit` lives in `bun_core` (read by `String::max_length`
// without an upward dep on this crate) and is C-exported there as
// `Bun__stringSyntheticAllocationLimit`. Re-export under the Zig spec name.
pub use bun_core::STRING_ALLOCATION_LIMIT;

// ──────────────────────────────────────────────────────────────────────────
// Type aliases
// ──────────────────────────────────────────────────────────────────────────

pub type OnUnhandledRejection = fn(&mut VirtualMachine, &JSGlobalObject, JSValue);
pub type OnException = fn(&mut ZigException);
pub type MacroMap = bun_collections::ArrayHashMap<i32, jsc::C::JSObjectRef>;
/// Spec VirtualMachine.zig:144 `ExceptionList`. `api::JsException` lives in
/// [`crate::schema_api`] (not `bun_options_types::schema::api`) because its
/// `stack: StackTrace` field transitively names `ZigStackFramePosition` from
/// this crate — see the `schema_api` module doc in lib.rs.
pub type ExceptionList = Vec<crate::schema_api::JsException>;

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine struct (file-level @This())
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct EntryPointResult {
    pub value: crate::strong::Optional, // jsc.Strong.Optional
    pub cjs_set_value: bool,
}

/// Downstream-compat alias: lib.rs previously exposed `virtual_machine::InitOptions`.
/// Carries the cross-tier subset of Zig `Options` that [`init`] and
/// `RuntimeHooks::init_runtime_state` need. `transform_options`/`debugger`
/// live in `bun_options_types` (already a dep of `bun_jsc`), so they thread
/// through here instead of being dropped at the CLI call-site.
pub struct InitOptions {
    /// Spec VirtualMachine.zig:1207 `Options.args` — the CLI's
    /// `api.TransformOptions`. Consumed by `RuntimeHooks::init_runtime_state`
    /// → `Transpiler::init(.., configureTransformOptionsForBunVM(args), ..)`.
    pub transform_options: bun_options_types::schema::api::TransformOptions,
    /// Spec VirtualMachine.zig:1215 `Options.debugger` —
    /// `bun.cli.Command.Debugger` (now `bun_options_types::context::Debugger`).
    /// Consumed by `RuntimeHooks::init_runtime_state` → `configureDebugger`.
    pub debugger: bun_options_types::context::Debugger,
    /// Spec VirtualMachine.zig:1208 `Options.log`. When `Some`, [`init`] adopts
    /// the caller's log instead of boxing a fresh one (CLI-path macros pass the
    /// transpiler's log so macro load errors land in the bundle output).
    pub log: Option<NonNull<bun_ast::Log>>,
    /// Spec VirtualMachine.zig:1210 `Options.env_loader`. Forwarded to
    /// `RuntimeHooks::init_runtime_state` so the high-tier `Transpiler::init`
    /// reuses the caller's env loader.
    pub env_loader: Option<NonNull<bun_dotenv::Loader<'static>>>,
    pub graph: Option<&'static dyn bun_resolver::StandaloneModuleGraph>,
    /// Spec VirtualMachine.zig:1211 `Options.store_fd`. Must be applied to
    /// `transpiler.resolver.store_fd` BEFORE `configure_linker()` reads
    /// `top_level_dir`, so it threads through `init_runtime_state`.
    pub store_fd: bool,
    pub smol: bool,
    pub eval_mode: bool,
    pub is_main_thread: bool,
    /// Forwarded to `Zig__GlobalObject__create` so the C++ ZigGlobalObject is
    /// created with its `WebCore::Worker*` already wired (spec
    /// VirtualMachine.zig:1477-1484). `null` for the main-thread / bake paths.
    pub worker_ptr: *mut c_void,
    /// Debugger script-execution-context id. Main thread = 1, workers receive
    /// `WebWorker::execution_context_id`; `None` lets [`init`] derive it from
    /// `is_main_thread` (matches the previous behaviour for non-worker init).
    pub context_id: Option<i32>,
    /// Forwarded as `mini_mode` to `Zig__GlobalObject__create`. For the
    /// main-thread path this is `smol`; for workers it is `WebWorker::mini`
    /// (spec VirtualMachine.zig:1482).
    pub mini_mode: bool,
}

impl Default for InitOptions {
    fn default() -> Self {
        Self {
            transform_options: Default::default(),
            debugger: Default::default(),
            log: None,
            env_loader: None,
            graph: None,
            store_fd: false,
            smol: false,
            eval_mode: false,
            is_main_thread: false,
            worker_ptr: core::ptr::null_mut(),
            context_id: None,
            mini_mode: false,
        }
    }
}

pub struct VirtualMachine {
    pub global: *mut JSGlobalObject,
    // allocator dropped per §Allocators (global mimalloc)
    pub has_loaded_constructors: bool,
    // TODO(port): lifetime — `Transpiler<'a>` borrows `log`/`allocator`; VM is
    // self-referential and cannot carry `<'a>`, so we erase to `'static` and the
    // owner guarantees the borrowed `log` outlives the VM (see `init`).
    pub transpiler: Transpiler<'static>,
    // TODO(b2-cycle): `bun_watcher` is `ImportWatcher` from hot_reloader.rs (gated sibling).
    pub bun_watcher: *mut c_void,
    pub console: *mut crate::console_object::ConsoleObject,
    // TODO(port): lifetime — LIFETIMES.tsv says BORROW_PARAM (`&'a mut bun_ast::Log`);
    // raw NonNull used because VM is self-referential and cannot carry `<'a>`.
    pub log: Option<NonNull<bun_ast::Log>>,
    /// Path of the entry module. BACKREF — borrows process-argv, the resolver's
    /// process-lifetime `dirname_store`/`filename_store`, the standalone module
    /// graph, or (for workers) the owning `WebWorker.unresolved_specifier`; in
    /// every case the storage outlives this VM but is not Rust-`'static`.
    /// `RawSlice` carries the BACKREF outlives-holder invariant — read via
    /// `main()`.
    main: bun_ptr::RawSlice<u8>,
    pub main_is_html_entrypoint: bool,
    pub main_resolved_path: bun_core::String,
    pub main_hash: u32,
    /// Set if code overrides Bun.main to a custom value.
    pub overridden_main: crate::strong::Optional,
    pub entry_point: bun_bundler::entry_points::ServerEntryPoint,
    pub origin: bun_url::URL<'static>,
    // TODO(b2-cycle): `node_fs` is `Option<Box<bun_runtime::node::fs::NodeFS>>`.
    pub node_fs: Option<*mut c_void>,
    /// Opaque per-VM `bun_runtime` state (boxed `timer::All` +
    /// `Body::Value::HiveAllocator` + …). Set by
    /// `RuntimeHooks::init_runtime_state` in [`init`]; reclaimed by
    /// `RuntimeHooks::deinit_runtime_state` in [`destroy`]. Null when no high
    /// tier is installed (e.g. `bun_jsc` unit tests).
    ///
    /// PORT NOTE: the Zig `timer: api.Timer.All` and
    /// `body_value_pool: webcore.Body.Value.HiveAllocator` value
    /// fields live inside this box rather than as `()` shadows here — both
    /// types are owned by `bun_runtime` (forward dep). Access goes through
    /// [`RuntimeHooks::timer_insert`] / [`RuntimeHooks::body_value_hive_ref`].
    pub runtime_state: *mut c_void,
    pub event_loop_handle: Option<*mut PlatformEventLoop>,
    pub pending_unref_counter: i32,
    pub preload: Vec<Box<[u8]>>,
    pub unhandled_pending_rejection_to_capture: Option<*mut JSValue>,
    // PORT NOTE: layering — the concrete `bun_standalone_graph::Graph` lives
    // in a higher-tier crate. The resolver already broke that cycle with the
    // `bun_resolver::StandaloneModuleGraph` trait; we hold the same trait
    // object here so `init_with_module_graph` can hand it straight to
    // `transpiler.resolver.standalone_module_graph` without a downcast.
    pub standalone_module_graph: Option<&'static dyn bun_resolver::StandaloneModuleGraph>,
    pub smol: bool,
    // TODO(b2-cycle): `dns_result_order` is `bun_runtime::api::dns::Resolver::Order`.
    pub dns_result_order: u8,
    pub cpu_profiler_config: Option<crate::bun_cpu_profiler::CPUProfilerConfig>,
    pub heap_profiler_config: Option<crate::bun_heap_profiler::HeapProfilerConfig>,
    pub counters: Counters,

    // TODO(b2-cycle): `hot_reload` is `bun_runtime::cli::Command::HotReload`.
    pub hot_reload: u8,
    pub jsc_vm: *mut VM,

    /// hide bun:wrap from stack traces
    pub hide_bun_stackframes: bool,

    pub is_printing_plugin: bool,
    pub is_shutting_down: bool,
    pub plugin_runner: Option<crate::plugin_runner::PluginRunner>,
    pub is_main_thread: bool,
    pub exit_handler: ExitHandler,

    pub default_tls_reject_unauthorized: Option<bool>,
    // TODO(b2-cycle): `default_verbose_fetch` is `Option<http::HTTPVerboseLevel>`.
    pub default_verbose_fetch: Option<u8>,

    /// Do not access this field directly! It exists in the VirtualMachine struct so
    /// that we don't accidentally make a stack copy of it; only use it through
    /// `source_mappings`.
    pub saved_source_map_table: crate::saved_source_map::HashTable,
    pub source_mappings: SavedSourceMap,

    // TODO(port): lifetime — `&'a mut Arena`; caller-owned (web_worker).
    pub arena: Option<NonNull<bun_alloc::Arena>>,
    pub has_loaded: bool,

    pub transpiled_count: usize,
    pub resolved_count: usize,
    pub had_errors: bool,

    pub macros: MacroMap,
    // TODO(b2-cycle): `MacroEntryPoint` from `bun_bundler::entry_points` (gated).
    pub macro_entry_points: bun_collections::ArrayHashMap<i32, *mut c_void>,
    pub macro_mode: bool,
    pub no_macros: bool,
    pub auto_killer: ProcessAutoKiller::ProcessAutoKiller,

    pub has_any_macro_remappings: bool,
    pub is_from_devserver: bool,
    pub has_enabled_macro_mode: bool,

    /// Used by bun:test to set global hooks for beforeAll, beforeEach, etc.
    pub is_in_preload: bool,
    pub has_patched_run_main: bool,

    pub transpiler_store: crate::runtime_transpiler_store::RuntimeTranspilerStore,

    pub after_event_loop_callback_ctx: Option<*mut c_void>,
    pub after_event_loop_callback: Option<OpaqueCallback>,

    pub remap_stack_frames_mutex: bun_threading::Mutex,

    pub argv: Vec<Box<[u8]>>,

    pub origin_timer: std::time::Instant, // TODO(port): std.time.Timer
    pub origin_timestamp: u64,
    /// For fake timers: override performance.now() with a specific value (in nanoseconds).
    pub overridden_performance_now: Option<u64>,
    pub macro_event_loop: EventLoop,
    pub regular_event_loop: EventLoop,
    pub event_loop: *mut EventLoop, // BORROW_FIELD — points at sibling regular_event_loop/macro_event_loop

    pub ref_strings: crate::ref_string::Map,
    pub ref_strings_mutex: bun_threading::Mutex,

    pub active_tasks: usize,

    pub rare_data: Option<Box<RareData>>,
    pub proxy_env_storage: crate::rare_data::ProxyEnvStorage,
    pub is_us_loop_entered: bool,
    pub pending_internal_promise: Option<*mut JSInternalPromise>,
    pub pending_internal_promise_is_protected: bool,
    pub pending_internal_promise_reported_at: u32,
    pub hot_reload_deferred: bool,
    pub entry_point_result: EntryPointResult,

    pub auto_install_dependencies: bool,

    pub on_unhandled_rejection: OnUnhandledRejection,
    pub on_unhandled_rejection_ctx: Option<*mut c_void>,
    pub on_unhandled_rejection_exception_list: Option<NonNull<ExceptionList>>,
    pub unhandled_error_counter: usize,
    pub is_handling_uncaught_exception: bool,
    pub exit_on_uncaught_exception: bool,

    // TODO(b2): `modules` is `ModuleLoader::AsyncModule::Queue` (AsyncModule.rs gated).
    pub modules: crate::async_module::Queue,
    pub aggressive_garbage_collection: GCLevel,

    pub module_loader: ModuleLoader::ModuleLoader,

    pub gc_controller: crate::GarbageCollectionController,
    // BACKREF — WebWorker owns the VM. Real type: `*const bun_runtime::webcore::WebWorker`.
    pub worker: Option<*const c_void>,
    pub ipc: Option<IPCInstanceUnion>,
    pub hot_reload_counter: u32,

    pub debugger: Option<Box<crate::debugger::Debugger>>,
    pub has_started_debugger: bool,
    pub has_terminated: bool,

    #[cfg(debug_assertions)]
    pub debug_thread_id: std::thread::ThreadId,
    // PORT NOTE: Zig `if (Environment.isDebug) std.Thread.Id else void` — the
    // release-build ZST is intentional spec parity, not a placeholder.
    #[cfg(not(debug_assertions))]
    pub debug_thread_id: (),

    /// `Cell` so [`EventLoop`] (a value field of this struct) can flip the flag
    /// through `vm_ref()` (`&VirtualMachine`) without forming an overlapping
    /// `&mut VirtualMachine` while `&mut EventLoop` is live. Zero-valid
    /// (`Cell<bool>` is `repr(transparent)` over `bool`).
    pub is_inside_deferred_task_queue: core::cell::Cell<bool>,
    /// When true, drainMicrotasksWithGlobal is suppressed. `Cell` for the same
    /// reason as [`Self::is_inside_deferred_task_queue`].
    pub suppress_microtask_drain: core::cell::Cell<bool>,

    pub channel_ref: Async::KeepAlive,
    pub channel_ref_overridden: bool,
    pub channel_ref_should_ignore_one_disconnect_event_listener: bool,

    /// A set of extensions that exist in the require.extensions map.
    pub commonjs_custom_extensions:
        bun_collections::StringArrayHashMap<crate::node_module_module::CustomLoader>,
    pub has_mutated_built_in_extensions: u32,

    pub initial_script_execution_context_identifier: i32,

    pub test_isolation_generation: u32,
    pub test_isolation_enabled: bool,
}

// ──────────────────────────────────────────────────────────────────────────
// FFI declarations
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): move to jsc_sys
//
// `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle, so
// `&JSGlobalObject` is ABI-identical to a non-null `JSGlobalObject*` and C++
// mutating VM/process state through it is interior mutation invisible to Rust.
unsafe extern "C" {
    safe fn Bun__handleUncaughtException(
        global: &JSGlobalObject,
        err: JSValue,
        is_rejection: c_int,
    ) -> c_int;
    safe fn Bun__handleUnhandledRejection(
        global: &JSGlobalObject,
        reason: JSValue,
        promise: JSValue,
    ) -> c_int;
    safe fn Bun__emitHandledPromiseEvent(global: &JSGlobalObject, promise: JSValue) -> bool;

    safe fn Process__dispatchOnBeforeExit(global: &JSGlobalObject, code: u8);
    safe fn Process__dispatchOnExit(global: &JSGlobalObject, code: u8);
    safe fn Bun__closeAllSQLiteDatabasesForTermination();
    safe fn Bun__WebView__closeAllForTermination();
    safe fn Zig__GlobalObject__destructOnExit(global: &JSGlobalObject);
}

/// `hot_reload` is stored as `u8` (TODO(b2-cycle): widen to
/// `bun_options_types::context::HotReload`). Mirror the Zig enum ordinals so
/// the un-gated accessors below can compare without naming the type.
pub const HOT_RELOAD_NONE: u8 = 0;
pub const HOT_RELOAD_HOT: u8 = 1;
pub const HOT_RELOAD_WATCH: u8 = 2;

// ──────────────────────────────────────────────────────────────────────────
// Nested types
// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)] // u3 in Zig — smallest fitting repr
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum GCLevel {
    #[default]
    None = 0,
    Mild = 1,
    Aggressive = 2,
}

pub struct UnhandledRejectionScope {
    pub ctx: Option<*mut c_void>,
    pub on_unhandled_rejection: OnUnhandledRejection,
    pub count: usize,
}

impl UnhandledRejectionScope {
    pub fn apply(&self, vm: &mut VirtualMachine) {
        vm.on_unhandled_rejection = self.on_unhandled_rejection;
        vm.on_unhandled_rejection_ctx = self.ctx;
        vm.unhandled_error_counter = self.count;
    }
}

/// Thread-local VM holder (`VMHolder` in VirtualMachine.zig). Wired to the
/// crate-level `VirtualMachine::get()`/`set_current()` accessors.
pub struct VMHolder;

// PORT NOTE: Zig nests `pub var main_thread_vm` inside the struct namespace;
// Rust forbids associated `static`s, so it lives at module scope and is
// re-exported as `VMHolder::MAIN_THREAD_VM` via a const fn accessor.
pub static MAIN_THREAD_VM: core::sync::atomic::AtomicPtr<VirtualMachine> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

// `#[thread_local]` (bare `__thread` slot) instead of `thread_local!` macro:
// `LocalKey::__getit` adds a lazy-init check + on some targets a
// `pthread_getspecific` round-trip per access; Zig's `threadlocal var vm`
// is a single `mov %fs:OFFSET`. `get_or_null()` (which reads `VM`) is the
// highest-fan-in accessor on the per-request path — every
// `VirtualMachine::get()/as_mut()/vm_get()` reaches it ≥3× per
// `run_callback`. Const-init `Cell<ptr>` has no destructor, so no
// `LocalKey` registration is needed. Module-level because Rust forbids
// associated `static`s; the `VMHolder` namespace is preserved via the
// `#[inline(always)]` accessors below.
#[thread_local]
static VM: Cell<Option<*mut VirtualMachine>> = Cell::new(None);
#[thread_local]
static CACHED_GLOBAL_OBJECT: Cell<Option<*mut JSGlobalObject>> = Cell::new(None);

impl VMHolder {
    /// Reads the per-thread `*mut VirtualMachine` slot.
    #[inline(always)]
    pub fn vm() -> Option<*mut VirtualMachine> {
        VM.get()
    }
    #[inline(always)]
    pub fn set_vm(vm: Option<*mut VirtualMachine>) {
        VM.set(vm)
    }
    #[inline(always)]
    pub fn cached_global_object() -> Option<*mut JSGlobalObject> {
        CACHED_GLOBAL_OBJECT.get()
    }
    #[inline(always)]
    pub fn set_cached_global_object(g: Option<*mut JSGlobalObject>) {
        CACHED_GLOBAL_OBJECT.set(g)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__setDefaultGlobalObject(global: *mut JSGlobalObject) {
        if let Some(vm_instance) = VM.get() {
            // SAFETY: vm pointer set by init() on this thread
            let vm_instance = unsafe { &mut *vm_instance };
            vm_instance.global = global;
            if vm_instance.is_main_thread {
                MAIN_THREAD_VM.store(vm_instance, core::sync::atomic::Ordering::Release);
            }
        }
        CACHED_GLOBAL_OBJECT.set(Some(global));
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getDefaultGlobalObject() -> Option<NonNull<JSGlobalObject>> {
        if let Some(g) = CACHED_GLOBAL_OBJECT.get() {
            return NonNull::new(g);
        }
        if let Some(vm_instance) = VM.get() {
            // SAFETY: vm pointer set by init() on this thread
            let g = unsafe { (*vm_instance).global };
            CACHED_GLOBAL_OBJECT.set(Some(g));
        }
        None
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__thisThreadHasVM() -> bool {
        VM.get().is_some()
    }
}

#[thread_local]
pub static IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE: Cell<bool> = Cell::new(false);
#[thread_local]
pub static IS_MAIN_THREAD_VM: Cell<bool> = Cell::new(false);

pub static IS_SMOL_MODE: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

/// Process-global "smol" flag (Zig: `bun.jsc.VirtualMachine.is_smol_mode`).
/// Set once during VM init before workers spawn; thereafter read-only.
#[inline]
pub fn is_smol_mode() -> bool {
    IS_SMOL_MODE.load(core::sync::atomic::Ordering::Relaxed)
}

#[derive(Default)]
pub struct ExitHandler {
    pub exit_code: u8,
}

impl ExitHandler {
    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getExitCode(vm: &VirtualMachine) -> u8 {
        vm.exit_handler.exit_code
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__setExitCode(vm: &mut VirtualMachine, code: u8) {
        vm.exit_handler.exit_code = code;
    }

    /// PORT NOTE: spec calls `this.exit_handler.dispatchOnExit()` from a
    /// `*VirtualMachine`. Taking `&mut self: ExitHandler` and recovering the
    /// parent via `container_of` would escape the provenance of `&mut self`
    /// (which only covers the `ExitHandler` field). Callers pass the VM
    /// reference instead; the body re-enters JS so no `&mut` is held.
    pub fn dispatch_on_exit(vm: &VirtualMachine) {
        let exit_code = vm.exit_handler.exit_code;
        Process__dispatchOnExit(vm.global(), exit_code);
        if vm.worker.is_none() {
            Bun__closeAllSQLiteDatabasesForTermination();
            Bun__WebView__closeAllForTermination();
        }
    }

    /// See [`dispatch_on_exit`] for the `&mut self → &VirtualMachine`
    /// signature change.
    pub fn dispatch_on_before_exit(vm: &VirtualMachine) {
        let exit_code = vm.exit_handler.exit_code;
        let global = vm.global();
        let _ = jsc::from_js_host_call_generic(global, || {
            Process__dispatchOnBeforeExit(global, exit_code)
        });
    }
}

pub const MAIN_FILE_NAME: &[u8] = b"bun:main";

/// Instead of storing timestamp as a i128, we store it as a u64.
/// We subtract the timestamp from Jan 1, 2000 (Y2K)
pub const ORIGIN_RELATIVE_EPOCH: i128 = 946_684_800 * 1_000_000_000;

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine impl — core surface (compiles at this tier)
// ──────────────────────────────────────────────────────────────────────────

/// RAII guard returned by [`VirtualMachine::auto_gc_on_drop`]. Calls
/// [`VirtualMachine::auto_garbage_collect`] when dropped — the Rust spelling
/// of Zig's `defer globalThis.bunVM().autoGarbageCollect()`.
#[must_use = "dropping immediately runs GC now; bind to `let _gc = ...` to defer to scope end"]
pub struct AutoGcOnDrop<'a> {
    vm: &'a VirtualMachine,
}

impl Drop for AutoGcOnDrop<'_> {
    #[inline]
    fn drop(&mut self) {
        self.vm.auto_garbage_collect();
    }
}

/// RAII guard that scopes [`VirtualMachine::enable_macro_mode`] /
/// [`VirtualMachine::disable_macro_mode`] — the Rust spelling of Zig's
/// `vm.enableMacroMode(); defer vm.disableMacroMode();` (Macro.zig:120).
///
/// Holds a [`BackRef`] (not `&'a mut`) because callers continue to access the
/// per-thread VM (event loop, `run_with_api_lock`) while the guard is live;
/// an exclusive borrow would forbid that under stacked-borrows. The backref
/// invariant (VM outlives guard) is the caller's `new` contract; mutation
/// routes through [`VirtualMachine::as_mut`] (thread-local provenance) so the
/// guard never forms its own `&mut VM`.
///
/// [`BackRef`]: bun_ptr::BackRef
#[must_use = "macro mode is disabled on drop; bind to a named local"]
pub struct MacroModeGuard {
    vm: bun_ptr::BackRef<VirtualMachine>,
}
impl MacroModeGuard {
    /// `vm` must be the live per-thread `VirtualMachine` (the [`BackRef`]
    /// invariant: the VM outlives any guard it hands out). Mutation routes
    /// through [`VirtualMachine::as_mut`], which derives provenance from the
    /// thread-local slot — so this body contains no raw deref and the fn is
    /// safe; the lifetime contract is the BackRef type invariant rather than
    /// a per-call precondition.
    ///
    /// [`BackRef`]: bun_ptr::BackRef
    #[inline]
    pub fn new(vm: *mut VirtualMachine) -> Self {
        let vm = bun_ptr::BackRef::from(NonNull::new(vm).expect("vm non-null"));
        vm.get().as_mut().enable_macro_mode();
        Self { vm }
    }
}
impl Drop for MacroModeGuard {
    #[inline]
    fn drop(&mut self) {
        // Per `new` contract — `vm` outlives the guard (BackRef invariant).
        self.vm.get().as_mut().disable_macro_mode();
    }
}

// SAFETY: `VirtualMachine` is a per-JS-thread singleton (see `VMHolder`).
// All access is same-thread; the `Sync` impl exists so `&'static
// VirtualMachine` can be returned from [`VirtualMachine::get`] and passed
// through `'static`-bound closures / trait objects without `T: Sync`
// cascading. Cross-thread paths go through `ConcurrentTask` which never
// hands out a `&VirtualMachine`. Fields mutated post-init are wrapped in
// [`JsCell`] for interior mutability.
unsafe impl Sync for VirtualMachine {}
unsafe impl Send for VirtualMachine {}

impl VirtualMachine {
    /// Safe `&'static` accessor for the current thread's VM. The VM is a
    /// per-thread singleton allocated once in [`init`] and never freed until
    /// thread teardown, so the `'static` lifetime is sound. Mutation goes
    /// through [`JsCell`]-wrapped fields (`vm.field.with_mut(|x| ...)`);
    /// legacy code that still needs `&mut VirtualMachine` whole-struct uses
    /// [`Self::get_mut_ptr`] + an explicit `unsafe` deref.
    #[inline(always)]
    pub fn get() -> &'static VirtualMachine {
        // SAFETY: `get_or_null()` returns the thread-local pointer set by
        // `init()`; non-null while a VM is installed; the allocation outlives
        // the thread.
        unsafe { &*Self::get_mut_ptr() }
    }

    /// Raw `*mut` accessor for the current thread's VM. Prefer [`Self::get`]
    /// for read access and `JsCell` field projection for mutation; this exists
    /// for the (shrinking) set of call sites that still take
    /// `*mut VirtualMachine` or need a whole-struct `&mut`.
    ///
    /// Per-request hot path: `vm_get`/`as_mut`/`NewServer::vm_mut` all funnel
    /// through here, so it is reached several times per `run_callback` (Zig
    /// just reads the bare `threadlocal var vm`). The previous `.expect()`
    /// emitted a check + cold-path panic-format branch on every call;
    /// `unwrap_unchecked` collapses to one TLS load. The "no VM on this
    /// thread" case is a programmer error (host_fn reached before `init()`),
    /// not a recoverable condition — keep the diagnostic in debug builds only.
    #[inline(always)]
    pub fn get_mut_ptr() -> *mut VirtualMachine {
        debug_assert!(
            Self::get_or_null().is_some(),
            "VirtualMachine.get() called with no VM on this thread",
        );
        // SAFETY: every caller is reached from a JS host_fn / event-loop tick,
        // which by construction runs after `init()` installed `VMHolder::VM`
        // for this thread.
        unsafe { Self::get_or_null().unwrap_unchecked() }
    }

    /// `&mut self` from `&self` — the `JsCell` escape hatch applied to the
    /// whole VM. Exists so legacy `&mut VirtualMachine`-taking helpers can be
    /// called from a safe `&'static VirtualMachine` without an `unsafe` block
    /// at every call site. Same single-JS-thread soundness contract as
    /// [`JsCell::get_mut`]; keep the borrow short and do not hold across
    /// reentrant JS calls.
    /// Routes through [`Self::get_mut_ptr`] (the thread-local raw pointer)
    /// rather than casting `&self`, so provenance is the original `*mut`
    /// allocation — avoids the `invalid_reference_casting` UB lint.
    #[inline(always)]
    #[allow(clippy::mut_from_ref)]
    pub fn as_mut(&self) -> &mut VirtualMachine {
        debug_assert!(core::ptr::eq(self, Self::get_mut_ptr()));
        // SAFETY: single-JS-thread invariant — see `unsafe impl Sync` above.
        // Provenance comes from the thread-local `*mut` set in `init()`.
        unsafe { &mut *Self::get_mut_ptr() }
    }

    /// `&'static mut` to this thread's VM singleton — the static-fn counterpart
    /// of [`Self::as_mut`]. Exists so per-type `fn vm_mut(&self)` shims (sql,
    /// bake, cron) collapse to one call instead of each open-coding
    /// `unsafe { &mut *self.vm.as_ptr() }` against a stored `BackRef`.
    ///
    /// Returns `'static` (not tied to any `&self`) so callers may pair the VM
    /// borrow with a disjoint `&mut self.field` in the same expression. Same
    /// single-JS-thread soundness contract as [`JsCell::get_mut`] and
    /// [`Self::as_mut`]: keep the borrow short and do not hold it across
    /// reentrant JS calls. Provenance is the thread-local `*mut` installed by
    /// `init()`, so this is sound regardless of how the caller's own
    /// `BackRef<VirtualMachine>` was constructed.
    #[inline(always)]
    pub fn get_mut() -> &'static mut VirtualMachine {
        // SAFETY: single-JS-thread invariant — see `unsafe impl Sync` above.
        // Provenance comes from the thread-local `*mut` set in `init()`.
        unsafe { &mut *Self::get_mut_ptr() }
    }

    #[inline(always)]
    pub fn get_or_null() -> Option<*mut VirtualMachine> {
        // thread-local set by init() on this thread; one VM per thread
        VM.get()
    }

    pub fn get_main_thread_vm() -> Option<*mut VirtualMachine> {
        let p = MAIN_THREAD_VM.load(core::sync::atomic::Ordering::Acquire);
        if p.is_null() { None } else { Some(p) }
    }

    #[inline]
    pub fn is_loaded() -> bool {
        VM.get().is_some()
    }

    /// Installs `vm` as the current thread's VM (Zig: `VMHolder.vm = vm`).
    pub fn set_current(vm: *mut VirtualMachine) {
        VM.set(Some(vm));
    }

    /// Returns `&'static` so callers can hold the global across `&mut self`
    /// reborrows (`JSGlobalObject` is a separate JSC heap allocation, so no
    /// overlap with `VirtualMachine` storage). Same `'static`-on-the-JS-thread
    /// contract as [`JSGlobalObject::bun_vm`] — the global lives for the VM
    /// lifetime, and the VM is the per-thread singleton.
    #[inline(always)]
    pub fn global(&self) -> &'static JSGlobalObject {
        // `global` is set during init and live for the VM lifetime.
        // `JSGlobalObject` is an `opaque_ffi!` ZST handle; `opaque_ref` is the
        // centralised non-null-ZST deref proof.
        JSGlobalObject::opaque_ref(self.global)
    }

    /// Spec VirtualMachine.zig: `pub fn eventLoop(this: *VirtualMachine) *EventLoop`
    /// — returns a raw `*EventLoop` (no aliasing guarantee). Returning `&mut`
    /// here would let two overlapping callers (e.g. a JS callback re-entering
    /// `vm.event_loop()` from inside `tick()`) mint aliased `&mut EventLoop` to
    /// the same allocation — UB per PORTING.md §Forbidden. Callers form a
    /// short-lived `&mut *p` at the use site instead, mirroring [`Self::get`].
    #[inline(always)]
    pub fn event_loop(&self) -> *mut EventLoop {
        // self-pointer to regular_event_loop or macro_event_loop
        self.event_loop
    }

    /// Safe `&mut EventLoop` accessor — the [`JsCell`] escape hatch applied to
    /// the active event loop. `event_loop` is a self-pointer into either
    /// `regular_event_loop` or `macro_event_loop` (both owned by this VM), so it
    /// is live for the VM lifetime. Same single-JS-thread soundness contract as
    /// [`Self::as_mut`]; keep the borrow short and do not hold across reentrant
    /// JS calls. Prefer this over `unsafe { &mut *vm.event_loop() }` at call
    /// sites.
    #[inline(always)]
    #[allow(clippy::mut_from_ref)]
    pub fn event_loop_mut(&self) -> &mut EventLoop {
        // SAFETY: `event_loop` points at a sibling field of this VM; non-null
        // after `init()`; single-JS-thread invariant per `unsafe impl Sync`.
        unsafe { &mut *self.event_loop }
    }

    /// Safe `&EventLoop` accessor — shared variant of [`Self::event_loop_mut`].
    /// Prefer when only reading event-loop fields (queue lengths, pending
    /// refs) to avoid minting an unnecessary `&mut`.
    #[inline(always)]
    pub fn event_loop_shared(&self) -> &EventLoop {
        // SAFETY: see `event_loop_mut`.
        unsafe { &*self.event_loop }
    }

    /// Alias for [`Self::event_loop_mut`]. Kept for callers migrated on the
    /// `runtime-hostfn-safe` branch; both names funnel into the single audited
    /// `unsafe` deref above.
    #[inline(always)]
    #[allow(clippy::mut_from_ref)]
    pub fn event_loop_ref(&self) -> &mut EventLoop {
        self.event_loop_mut()
    }

    /// Safe `&VM` accessor for the JSC VM owned by this Bun VM. Set once in
    /// `init()` and live for the VM lifetime.
    #[inline(always)]
    pub fn jsc_vm(&self) -> &VM {
        // `jsc_vm` set in `init()`, valid for VM lifetime. `VM` is an
        // `opaque_ffi!` ZST handle; `opaque_ref` is the centralised
        // non-null-ZST deref proof.
        VM::opaque_ref(self.jsc_vm)
    }

    /// Safe `&mut VM` accessor for the JSC VM. Set once in `init()` and live
    /// for the VM lifetime; the JSC `VM` lives in a separate heap allocation
    /// so this never aliases another field of `self`.
    #[inline]
    pub fn jsc_vm_mut(&mut self) -> &mut VM {
        // `jsc_vm` set in `init()`, valid for VM lifetime. `VM` is an
        // `opaque_ffi!` ZST handle; `opaque_mut` is the centralised
        // non-null-ZST deref proof (zero-byte `&mut` cannot alias).
        VM::opaque_mut(self.jsc_vm)
    }

    /// Raw accessor for the hot-reload import watcher. `bun_watcher` is the
    /// type-erased `*mut ImportWatcher` installed by
    /// [`crate::hot_reloader::HotReloaderCtx::install_bun_watcher`] (separate
    /// `Box` heap allocation), or null when hot reload is disabled.
    ///
    /// NOTE: unlike `event_loop_mut`, the pointee is **not** JS-thread-only —
    /// the inner `Box<Watcher>` is held as `&mut Watcher` for the lifetime of
    /// the spawned file-watcher thread (`Watcher::thread_main`), and
    /// `RuntimeTranspilerStore` reads it from transpiler workers. The Zig spec
    /// models this as an alias-allowed `*Watcher` with an internal mutex, so we
    /// return the raw pointer and leave the `unsafe` deref at the call site to
    /// keep the cross-thread hazard visible. Callers must scope any reborrow to
    /// a single mutex-guarded `Watcher` operation.
    #[inline]
    pub fn bun_watcher_ptr(&self) -> *mut crate::hot_reloader::ImportWatcher {
        self.bun_watcher as *mut crate::hot_reloader::ImportWatcher
    }

    /// `event_loop().enter()` now, `.exit()` on drop. Safe wrapper over
    /// [`EventLoop::enter_scope`] for the common `vm.event_loop()` case.
    #[inline]
    pub fn enter_event_loop_scope(&self) -> crate::event_loop::EventLoopEnterGuard {
        // SAFETY: `self.event_loop` is the live VM-owned event-loop pointer and
        // remains valid for the VM (and thus the guard's) lifetime.
        unsafe { EventLoop::enter_scope(self.event_loop) }
    }

    /// Safe shared-reference accessor for the process-lifetime dotenv loader
    /// (`vm.transpiler.env`). The loader is allocated once during VM init and
    /// never freed; callers previously open-coded `unsafe { &*vm.transpiler.env }`.
    #[inline]
    pub fn env_loader(&self) -> &'static bun_dotenv::Loader<'static> {
        self.env_loader_opt()
            .expect("transpiler.env set during Transpiler::init")
    }

    /// Nullable variant of [`Self::env_loader`] for the early-boot window where
    /// `Transpiler::init` has not yet run (e.g. `GarbageCollectionController::init`
    /// is reached from `JSGlobalObject::create` before `init_runtime_state`).
    #[inline]
    pub fn env_loader_opt(&self) -> Option<&'static bun_dotenv::Loader<'static>> {
        // SAFETY: when non-null, `transpiler.env` is set during `Transpiler::init`
        // to a process-lifetime allocation; never freed while a VM is installed.
        unsafe { self.transpiler.env.as_ref() }
    }

    #[inline]
    pub fn transpiler(&mut self) -> &mut Transpiler<'static> {
        &mut self.transpiler
    }

    /// Safe accessor for the process-lifetime resolver `FileSystem` singleton
    /// (`vm.transpiler.fs`). Allocated once during VM init and never freed;
    /// callers previously open-coded `unsafe { &*vm.transpiler.fs }`.
    #[inline]
    pub fn fs(&self) -> &'static bun_resolver::fs::FileSystem {
        // SAFETY: `transpiler.fs` is set during `Transpiler::init` to the
        // process-lifetime `Fs::FileSystem` singleton; never null while a VM
        // is installed.
        unsafe { &*self.transpiler.fs }
    }

    /// Safe accessor for the process-lifetime cwd string
    /// (`vm.transpiler.fs.top_level_dir`). The `FileSystem` singleton is
    /// allocated once during VM init and never freed.
    #[inline]
    pub fn top_level_dir(&self) -> &'static [u8] {
        self.fs().top_level_dir
    }

    /// Safe `&mut Debugger` accessor — the [`JsCell`] escape hatch applied to
    /// the optional boxed `Debugger`. Same single-JS-thread soundness
    /// contract as [`Self::as_mut`]; keep the borrow short and do not hold
    /// across reentrant JS calls.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn debugger_mut(&self) -> Option<&mut crate::debugger::Debugger> {
        self.as_mut().debugger.as_deref_mut()
    }

    /// Safe `&mut uws::Loop` accessor for the per-VM uSockets loop. Same
    /// single-JS-thread soundness contract as [`Self::event_loop_mut`].
    #[inline(always)]
    #[allow(clippy::mut_from_ref)]
    pub fn uws_loop_mut(&self) -> &mut uws::Loop {
        // SAFETY: `uws_loop()` returns the per-VM loop pointer; non-null on
        // the JS thread once `init()` ran. Single-JS-thread invariant per
        // `unsafe impl Sync`.
        unsafe { &mut *self.uws_loop() }
    }

    /// Safe `&mut PlatformEventLoop` accessor for `event_loop_handle` (the
    /// uws loop on POSIX, libuv loop on Windows). `None` only before
    /// `ensure_waker()` runs. Consolidates the open-coded raw deref of
    /// `self.event_loop_handle.unwrap()` at the `EventLoop::tick*` /
    /// `update_counts` call sites into one SAFETY block.
    ///
    /// Same single-JS-thread soundness contract as [`Self::uws_loop_mut`] —
    /// the `PlatformEventLoop` is a separate heap allocation (uws/uv-owned),
    /// so the returned `&mut` cannot alias any field of `self`.
    #[inline(always)]
    #[allow(clippy::mut_from_ref)]
    pub fn platform_loop_opt(&self) -> Option<&mut PlatformEventLoop> {
        // SAFETY: when `Some`, `event_loop_handle` was set in `init()` /
        // `ensure_waker()` to the live per-VM uws/uv loop and remains valid
        // for the VM lifetime. Single-JS-thread invariant per `unsafe impl
        // Sync` — only the owning JS thread reborrows mutably.
        self.event_loop_handle.map(|h| unsafe { &mut *h })
    }

    /// Read-then-zero `pending_unref_counter`. Wraps the common
    /// `let n = vm.pending_unref_counter; if n > 0 { vm.pending_unref_counter = 0; ... }`
    /// pattern so callers don't open-code two raw-ptr writes.
    #[inline]
    pub fn take_pending_unref(&self) -> i32 {
        let this = self.as_mut();
        let n = this.pending_unref_counter;
        if n > 0 {
            this.pending_unref_counter = 0;
        }
        n
    }

    /// Safe shared accessor for the per-VM `bun_ast::Log`. The log is
    /// `Box::leak`ed in `init()` and outlives the VM.
    #[inline]
    pub fn log_ref(&self) -> Option<&bun_ast::Log> {
        // Reborrow `&mut Log` → `&Log`; the single `unsafe` deref lives in
        // `log_mut()` (set-once `Option<NonNull>` accessor pattern).
        self.log_mut().map(|l| &*l)
    }

    /// Safe `&mut bun_ast::Log` accessor. See [`Self::log_ref`].
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn log_mut(&self) -> Option<&mut bun_ast::Log> {
        // SAFETY: see `log_ref`; single-JS-thread invariant.
        self.as_mut().log.map(|mut p| unsafe { p.as_mut() })
    }

    /// Safe `&WebWorker` accessor for the optional owning worker. The
    /// `WebWorker` is a heap allocation owned by C++ that outlives this VM.
    #[inline]
    pub fn worker_ref(&self) -> Option<&crate::web_worker::WebWorker> {
        // SAFETY: `worker` is a `*const c_void` pointing at a heap `WebWorker`
        // owned by C++ that outlives this VM (BACKREF — see field decl).
        self.worker
            .map(|w| unsafe { &*w.cast::<crate::web_worker::WebWorker>() })
    }

    #[inline]
    pub fn source_mappings(&mut self) -> &mut SavedSourceMap {
        &mut self.source_mappings
    }

    /// Port of `VirtualMachine.sourceMapHandler` (VirtualMachine.zig:441).
    /// Returns a small adaptor whose `get()` produces the erased
    /// `js_printer::SourceMapHandler` for `print_with_source_map`.
    ///
    /// PORT NOTE: takes `*mut BufferPrinter` (raw), not `&'a mut`, because the
    /// SAME `BufferPrinter` is also passed as the live `writer` to
    /// `print_with_source_map`. Creating an `&'a mut` here would alias with
    /// that writer borrow for the entire print; instead we stash the raw
    /// pointer and only reborrow inside `on_source_map_chunk` once the
    /// writer's last use (`print_slice`) has retired. See jsc_hooks.rs
    /// `print_with_source_map` call-site PORT NOTE.
    #[inline]
    pub fn source_map_handler<'a>(
        &'a mut self,
        printer: *mut bun_js_printer::BufferPrinter,
    ) -> SourceMapHandlerGetter<'a> {
        SourceMapHandlerGetter {
            vm: self,
            printer,
            _marker: core::marker::PhantomData,
        }
    }

    #[inline]
    pub fn rare_data(&mut self) -> &mut RareData {
        if self.rare_data.is_none() {
            let rd = Box::new(RareData::default());
            // RareData embeds the per-VM `us_socket_group_t` heads as value fields.
            // Registering the allocation as a root region lets LSAN trace
            // `RareData → group.head_sockets → us_socket_t`.
            bun_core::asan::register_root_region(
                core::ptr::from_ref::<RareData>(&*rd).cast(),
                core::mem::size_of::<RareData>(),
            );
            self.rare_data = Some(rd);
        }
        self.rare_data.as_mut().unwrap()
    }

    pub fn is_main_thread(&self) -> bool {
        self.worker.is_none()
    }

    pub fn is_inspector_enabled(&self) -> bool {
        self.debugger.is_some()
    }

    pub fn is_shutting_down(&self) -> bool {
        self.is_shutting_down
    }

    /// Port of `VirtualMachine.scriptExecutionStatus` (VirtualMachine.zig:885).
    /// Exported to C++ as `Bun__VM__scriptExecutionStatus` via virtual_machine_exports.rs.
    pub fn script_execution_status(&self) -> crate::ScriptExecutionStatus {
        if self.is_shutting_down {
            return crate::ScriptExecutionStatus::Stopped;
        }

        if let Some(worker) = self.worker_ref() {
            if worker.has_requested_terminate() {
                return crate::ScriptExecutionStatus::Stopped;
            }
        }

        crate::ScriptExecutionStatus::Running
    }

    /// Per-callback hot path: `drain_microtasks_with_global` calls
    /// `uws_loop_mut()` (→ this) every time the microtask queue drains, and
    /// the only call site there is already gated on
    /// `event_loop_handle.is_some()`. Zig (`uwsLoop`) is a bare field load.
    #[inline(always)]
    pub fn uws_loop(&self) -> *mut uws::Loop {
        #[cfg(unix)]
        {
            debug_assert!(
                self.event_loop_handle.is_some(),
                "uws event_loop_handle is null"
            );
            // SAFETY: set in `init()` on the JS thread before any host_fn /
            // event-loop tick runs; never cleared while the VM is live.
            unsafe { self.event_loop_handle.unwrap_unchecked() }
        }
        #[cfg(not(unix))]
        {
            uws::Loop::get()
        }
    }

    pub fn on_after_event_loop(&mut self) {
        if let Some(cb) = self.after_event_loop_callback.take() {
            let ctx = self.after_event_loop_callback_ctx.take();
            // SAFETY: `cb` was registered with the matching `ctx`.
            unsafe { cb(ctx.unwrap_or(core::ptr::null_mut())) };
        }
    }

    pub fn is_event_loop_alive_excluding_immediates(&self) -> bool {
        let el = self.event_loop_shared();
        let active = self
            .platform_loop_opt()
            .map(|h| h.is_active())
            .unwrap_or(false);
        self.unhandled_error_counter == 0
            && ((active as usize)
                + self.active_tasks
                + el.tasks.readable_length()
                + (el.has_pending_refs() as usize)
                > 0)
    }

    pub fn is_event_loop_alive(&self) -> bool {
        let el = self.event_loop_shared();
        self.is_event_loop_alive_excluding_immediates()
            || !el.immediate_tasks.is_empty()
            || !el.next_immediate_tasks.is_empty()
    }

    pub fn wakeup(&mut self) {
        self.event_loop_mut().wakeup();
    }

    pub fn on_quiet_unhandled_rejection_handler(
        this: &mut VirtualMachine,
        _: &JSGlobalObject,
        _: JSValue,
    ) {
        this.unhandled_error_counter += 1;
    }

    pub fn on_quiet_unhandled_rejection_handler_capture_value(
        this: &mut VirtualMachine,
        _: &JSGlobalObject,
        value: JSValue,
    ) {
        this.unhandled_error_counter += 1;
        value.ensure_still_alive();
        if let Some(ptr) = this.unhandled_pending_rejection_to_capture {
            // SAFETY: caller passed &mut stack_var (see LIFETIMES.tsv)
            unsafe { *ptr = value };
        }
    }

    pub fn unhandled_rejection_scope(&self) -> UnhandledRejectionScope {
        UnhandledRejectionScope {
            on_unhandled_rejection: self.on_unhandled_rejection,
            ctx: self.on_unhandled_rejection_ctx,
            count: self.unhandled_error_counter,
        }
    }

    pub fn handled_promise(&self, global_object: &JSGlobalObject, promise: JSValue) -> bool {
        if self.is_shutting_down() {
            return true;
        }
        Bun__emitHandledPromiseEvent(global_object, promise)
    }

    pub fn default_on_unhandled_rejection(
        this: &mut VirtualMachine,
        _: &JSGlobalObject,
        value: JSValue,
    ) {
        // SAFETY: BORROW_PARAM ptr set by caller, outlives this call (TODO(port): lifetime)
        let list = this
            .on_unhandled_rejection_exception_list
            .map(|mut p| unsafe { p.as_mut() });
        this.run_error_handler(value, list);
    }

    #[cold]
    pub fn garbage_collect(&self, sync: bool) -> usize {
        bun_core::Global::mimalloc_cleanup(false);
        let vm = self.global().vm();
        if sync {
            return vm.run_gc(true);
        }
        vm.collect_async();
        vm.heap_size()
    }

    #[inline]
    pub fn auto_garbage_collect(&self) {
        if self.aggressive_garbage_collection != GCLevel::None {
            let _ = self.garbage_collect(self.aggressive_garbage_collection == GCLevel::Aggressive);
        }
    }

    /// RAII form of `auto_garbage_collect`: returns a guard that calls
    /// `auto_garbage_collect()` when it goes out of scope. Ports Zig's
    /// `defer vm.autoGarbageCollect()` without an ad-hoc scopeguard closure.
    #[inline]
    pub fn auto_gc_on_drop(&self) -> AutoGcOnDrop<'_> {
        AutoGcOnDrop { vm: self }
    }

    pub fn enable_macro_mode(&mut self) {
        if !self.has_enabled_macro_mode {
            self.has_enabled_macro_mode = true;
            self.macro_event_loop = EventLoop::default();
            self.macro_event_loop.virtual_machine = NonNull::new(std::ptr::from_mut(self));
            self.macro_event_loop.global = NonNull::new(self.global);
            self.macro_event_loop.concurrent_tasks = Default::default();
            ensure_source_code_printer();
        }
        self.transpiler.options.target = bun_ast::Target::BunMacro;
        self.transpiler
            .resolver
            .caches
            .fs
            .use_alternate_source_cache = true;
        self.macro_mode = true;
        self.event_loop = &raw mut self.macro_event_loop;
        bun_analytics::features::macros.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        self.transpiler_store.enabled = false;
    }

    pub fn disable_macro_mode(&mut self) {
        self.transpiler.options.target = bun_ast::Target::Bun;
        self.transpiler
            .resolver
            .caches
            .fs
            .use_alternate_source_cache = false;
        self.macro_mode = false;
        self.event_loop = &raw mut self.regular_event_loop;
        self.transpiler_store.enabled = true;
    }

    pub fn prepare_loop(&mut self) {}

    pub fn enter_uws_loop(&mut self) {
        // event_loop_handle is set in ensure_waker before any caller reaches here.
        self.platform_loop_opt().expect("event_loop_handle").run();
    }

    pub fn enqueue_task(&mut self, task: bun_event_loop::Task) {
        // accessed here (no overlapping `&mut EventLoop`).
        self.event_loop_mut().enqueue_task(task);
    }

    pub fn tick(&mut self) {
        self.event_loop_mut().tick();
    }

    #[inline(always)]
    pub fn drain_microtasks(&mut self) {
        let _ = self.event_loop_mut().drain_microtasks();
    }

    pub fn assert_on_js_thread(&self) {
        #[cfg(debug_assertions)]
        {
            assert!(
                std::thread::current().id() == self.debug_thread_id,
                "VirtualMachine accessed from wrong thread"
            );
        }
    }

    /// `runWithAPILock(comptime Context, ctx, comptime fn)` — acquires the JSC
    /// API lock around `f(ctx)`. Rust collapses the comptime params into a closure.
    ///
    /// Spec VirtualMachine.zig:2629-2631: `this.global.vm().holdAPILock(ctx, callback)`.
    /// Routes `f` through `JSC__VM__holdAPILock` via an `OpaqueWrap`-style C
    /// trampoline so the JSC API lock is held for the full duration of `f()`.
    pub fn run_with_api_lock<F, R>(&self, f: F) -> R
    where
        F: FnOnce() -> R,
    {
        use core::mem::{ManuallyDrop, MaybeUninit};

        // PORT NOTE: Zig's `OpaqueWrap(Context, function)` synthesizes a
        // `fn(*anyopaque) void` that casts back and calls the body. The Rust
        // closure carries its own context, so the trampoline state is just
        // `{ closure, out-slot }`. `ManuallyDrop` lets us move the `FnOnce`
        // out by value inside the `extern "C"` body without `Option::take`.
        struct Trampoline<F, R> {
            f: ManuallyDrop<F>,
            result: MaybeUninit<R>,
        }

        extern "C" fn call<F: FnOnce() -> R, R>(ctx: *mut c_void) {
            // SAFETY: `ctx` is `&mut Trampoline<F, R>` on the caller's stack;
            // `JSC__VM__holdAPILock` invokes us exactly once with that pointer.
            let t = unsafe { bun_ptr::callback_ctx::<Trampoline<F, R>>(ctx) };
            // SAFETY: single-shot — `f` is taken exactly once.
            let f = unsafe { ManuallyDrop::take(&mut t.f) };
            t.result.write(f());
        }

        let mut t = Trampoline::<F, R> {
            f: ManuallyDrop::new(f),
            result: MaybeUninit::uninit(),
        };
        // `t` lives on this stack frame for the duration of the FFI call, which
        // invokes `call` exactly once before returning.
        JSC__VM__holdAPILock(self.jsc_vm(), (&raw mut t).cast(), call::<F, R>);
        // SAFETY: `call` wrote `t.result` exactly once above.
        unsafe { t.result.assume_init() }
    }

    #[cold]
    pub fn run_error_handler(
        &mut self,
        result: JSValue,
        exception_list: Option<&mut ExceptionList>,
    ) {
        // Spec VirtualMachine.zig:2156-2189: save/restore `had_errors` around
        // the print, then route the value through `printException` /
        // `printErrorlikeObject` (ConsoleObject formatter). The save/restore
        // has no higher-tier dep, so it lives here unconditionally.
        let prev_had_errors = self.had_errors;
        self.had_errors = false;

        // The actual print path needs `ConsoleObject::Formatter` +
        // `ZigException` (high tier). Dispatch through `RuntimeHooks` —
        // mirroring `auto_tick`/`ensure_debugger` — so the error is actually
        // emitted to stderr before callers hard-exit. With no hook installed
        // (low-tier unit tests), fail loudly: PORTING.md §Forbidden bans a
        // silent no-op here since the .zig has real, observable logic.
        if let Some(hooks) = runtime_hooks() {
            (hooks.print_exception)(self, result, exception_list);
        } else {
            // Low-tier fallback (no `bun_runtime` installed — unit tests):
            // we cannot reach `ConsoleObject::Formatter`, so emit a degraded
            // one-line render via the buffered error writer. Spec
            // VirtualMachine.zig:2156-2189 routes through `printErrorlikeObject`
            // (which formats name/message/stack); the closest we can do here
            // without the high tier is the value's own `toString`.
            let _ = exception_list;
            let writer = bun_core::Output::error_writer();
            let global = self.global();
            let display = result
                .to_error()
                .unwrap_or(result)
                .get_zig_string(global)
                .ok();
            match display {
                Some(zs) => {
                    let utf8 = zs.to_owned_slice();
                    let _ = writer.write_all(utf8.as_slice());
                    let _ = writer.write_all(b"\n");
                }
                None => {
                    let _ = writer.write_all(b"[unhandled exception]\n");
                }
            }
            let _ = writer.flush();
        }

        // PORT NOTE: Zig `defer this.had_errors = prev_had_errors;` — the hook
        // does not unwind across the dispatch boundary, so restore linearly.
        self.had_errors = prev_had_errors;
    }

    /// Spec VirtualMachine.zig:2606 `loadMacroEntryPoint`. Looks up (or
    /// generates) the synthetic `MacroEntryPoint` source for `(entry_path,
    /// function_name, hash)` and evaluates it under the JSC API lock via
    /// [`run_with_api_lock`].
    pub fn load_macro_entry_point(
        &mut self,
        entry_path: &[u8],
        function_name: &[u8],
        specifier: &[u8],
        hash: i32,
    ) -> Result<*mut JSInternalPromise, bun_core::Error> {
        use bun_bundler::entry_points::{Fs, MacroEntryPoint};
        use bun_collections::hash_map::Entry;
        let entry_point: *mut MacroEntryPoint = match self.macro_entry_points.entry(hash) {
            Entry::Occupied(e) => (*e.get()).cast(),
            Entry::Vacant(v) => {
                let mut ep = Box::new(MacroEntryPoint::default());
                // SAFETY: PathName stores slices with an artificial 'static
                // bound (Zig has no lifetimes); the generated entry point is
                // boxed into `macro_entry_points` and lives for the VM
                // lifetime, and `entry_path` is only borrowed for the
                // duration of `generate` (it copies into `code_buffer`).
                let entry_path_static: &'static [u8] = bun_ast::IntoStr::into_str(entry_path);
                MacroEntryPoint::generate(
                    &mut *ep,
                    &mut self.transpiler,
                    &Fs::PathName::init(entry_path_static),
                    function_name,
                    hash,
                    specifier,
                )?;
                let raw = bun_core::heap::into_raw(ep);
                v.insert(raw.cast());
                raw
            }
        };

        // PORT NOTE: Zig used a `MacroEntryPointLoader` struct + `OpaqueWrap`
        // because `runWithAPILock` only accepts `fn(*Ctx) void`. The Rust
        // `run_with_api_lock` already takes a closure, so the loader struct
        // collapses into a captured local.
        // SAFETY: `entry_point` was just inserted (heap-allocated) or fetched
        // from the cache; it lives for the VM lifetime.
        let path: &[u8] = unsafe { &*entry_point }.source.path.text;
        let promise = self.run_with_api_lock(|| {
            // SAFETY: per-thread VM; the API lock guarantees JSC is held.
            VirtualMachine::get().as_mut()._load_macro_entry_point(path)
        });
        promise.ok_or_else(|| bun_core::err!("JSError"))
    }

    pub fn is_watcher_enabled(&self) -> bool {
        !self.bun_watcher.is_null()
    }

    /// Spec VirtualMachine.zig:454 — `pub threadlocal var is_main_thread_vm`.
    /// Thin setter so callers don't need `.with` plumbing on the thread-local.
    #[inline]
    pub fn set_is_main_thread_vm(value: bool) {
        IS_MAIN_THREAD_VM.set(value);
    }

    /// Spec VirtualMachine.zig:2283 `ensureDebugger`.
    ///
    /// The body lives in `bun_runtime` (it constructs `bun.api.Debugger`), so
    /// dispatch through [`RuntimeHooks::ensure_debugger`] like
    /// [`reload_entry_point`] does. No-op when hooks aren't installed (pure
    /// `bun_jsc` unit tests) — matches the Zig early-return when `debugger`
    /// is unset.
    pub fn ensure_debugger(&mut self, block_until_connected: bool) -> Result<(), bun_core::Error> {
        if let Some(hooks) = runtime_hooks() {
            // SAFETY: hook contract — `self` is the live per-thread VM.
            unsafe { (hooks.ensure_debugger)(self, block_until_connected) };
        }
        Ok(())
    }

    /// Whether this VM should be destroyed after it exits, even if it is the
    /// main thread's VM. Worker VMs are always destroyed on exit, regardless
    /// of this setting. Setting this to true may expose bugs that would
    /// otherwise only occur using Workers.
    pub fn should_destruct_main_thread_on_exit(&self) -> bool {
        bun_core::env_var::feature_flag::BUN_DESTRUCT_VM_ON_EXIT::get().unwrap_or(false)
    }

    pub fn uncaught_exception(
        &mut self,
        global_object: &JSGlobalObject,
        err: JSValue,
        is_rejection: bool,
    ) -> bool {
        if self.is_shutting_down() {
            return true;
        }

        if isBunTest.load(core::sync::atomic::Ordering::Relaxed) {
            self.unhandled_error_counter += 1;
            (self.on_unhandled_rejection)(self, global_object, err);
            return true;
        }

        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        if self.is_handling_uncaught_exception {
            self.run_error_handler(err, None);
            // SAFETY: `global_object` is the live VM global; `process_exit` is
            // `bun_runtime::node::process::exit` (main-thread `noreturn`).
            unsafe { (hooks.process_exit)(global_object.as_ptr(), 7) };
            panic!("Uncaught exception while handling uncaught exception");
        }
        if self.exit_on_uncaught_exception {
            self.run_error_handler(err, None);
            // SAFETY: see above.
            unsafe { (hooks.process_exit)(global_object.as_ptr(), 1) };
            panic!("made it past process.exit()");
        }
        self.is_handling_uncaught_exception = true;
        let handled = Bun__handleUncaughtException(
            global_object,
            err.to_error().unwrap_or(err),
            if is_rejection { 1 } else { 0 },
        ) > 0;
        if !handled {
            // TODO maybe we want a separate code path for uncaught exceptions
            self.unhandled_error_counter += 1;
            self.exit_handler.exit_code = 1;
            (self.on_unhandled_rejection)(self, global_object, err);
        }
        // PORT NOTE: Zig `defer this.is_handling_uncaught_exception = false;`
        // (VirtualMachine.zig:707) covers BOTH the FFI call and the
        // `onUnhandledRejection` callback above. The flag must stay raised
        // while that callback runs so a re-entrant `uncaught_exception` from
        // a user handler trips the recursion guard and hard-exits with code 7
        // instead of recursing. Neither the FFI call nor the fn-pointer
        // callback unwind past this frame (re-entry hits `process_exit` →
        // `panic!`, which never returns), so a linear reset here matches the
        // Zig `defer` scope.
        self.is_handling_uncaught_exception = false;
        handled
    }

    pub fn hot_map(&mut self) -> Option<&mut crate::rare_data::HotMap> {
        if self.hot_reload != HOT_RELOAD_HOT {
            return None;
        }
        // TODO(b2-cycle): spec lazy-inits via `RareData::hotMap(allocator)`;
        // that accessor is gated in `rare_data.rs::_accessor_body`. Until it
        // un-gates, return whatever the field already holds (callers that need
        // the lazy-init path are themselves gated on `bun_runtime`).
        self.rare_data.as_deref_mut()?.hot_map.as_mut()
    }

    pub fn on_before_exit(&mut self) {
        ExitHandler::dispatch_on_before_exit(self);
        let mut dispatch = false;
        loop {
            while self.is_event_loop_alive() {
                self.tick();
                self.auto_tick_active();
                dispatch = true;
            }

            if dispatch {
                ExitHandler::dispatch_on_before_exit(self);
                dispatch = false;

                if self.is_event_loop_alive() {
                    continue;
                }
            }

            break;
        }
    }

    pub fn on_exit(&mut self) {
        // Write CPU profile if profiling was enabled - do this FIRST before any
        // shutdown begins. Grab the config and null it out to make this
        // idempotent.
        if let Some(config) = self.cpu_profiler_config.take() {
            if let Err(e) =
                crate::bun_cpu_profiler::stop_and_write_profile(self.jsc_vm_mut(), &config)
            {
                bun_core::Output::err(bun_core::Error::from(e), "Failed to write CPU profile", ());
            }
        }
        // Write heap profile if profiling was enabled - do this after CPU
        // profile but before shutdown.
        if let Some(config) = self.heap_profiler_config.take() {
            if let Err(e) =
                crate::bun_heap_profiler::generate_and_write_profile(self.jsc_vm_mut(), config)
            {
                bun_core::Output::err(e, "Failed to write heap profile", ());
            }
        }

        ExitHandler::dispatch_on_exit(self);
        self.is_shutting_down = true;

        // Make sure we run new cleanup hooks introduced by running cleanup
        // hooks.
        // PORT NOTE: each iteration re-fetches `rare_data` so the FFI hook
        // bodies (which may re-enter `VirtualMachine` and push more hooks) do
        // not run while a `&mut RareData` is live — the borrow ends after
        // `mem::take` returns the owned `Vec`.
        loop {
            let hooks = match self.rare_data.as_deref_mut() {
                Some(rare) if !rare.cleanup_hooks.is_empty() => {
                    core::mem::take(&mut rare.cleanup_hooks)
                }
                _ => break,
            };
            for hook in hooks {
                // SAFETY: ctx/func were registered together by the N-API
                // caller (`CleanupHook::init`).
                unsafe { (hook.func)(hook.ctx) };
            }
        }
        // Zig `defer rare_data.cleanup_hooks.clearAndFree(...)` — `mem::take`
        // above leaves an empty `Vec` (capacity already freed by drop).
    }

    pub fn global_exit(&mut self) -> ! {
        debug_assert!(self.is_shutting_down());
        // FIXME: we should be doing this, but we're not, but unfortunately
        // doing it causes like 50+ tests to break
        // self.event_loop().tick();

        if self.should_destruct_main_thread_on_exit() {
            if let Some(t) = self.event_loop_mut().forever_timer.take() {
                // SAFETY: `t` is the live usockets timer created in
                // `EventLoop::auto_tick`; `close::<true>()` (fallthrough)
                // frees it without re-entering the loop. Spec
                // VirtualMachine.zig:967 `t.deinit(true)`.
                unsafe { uws::Timer::close::<true>(t.as_ptr()) };
            }
            // Detached worker threads may still be in startVM()/spin() using
            // the process-global resolver BSSMap singletons. transpiler.deinit()
            // below frees those singletons, so request termination of every
            // live worker and wait for each to reach shutdown() first.
            if let Some(hooks) = runtime_hooks() {
                // Main-thread only; futex-waits on every registered worker
                // until each unparks at shutdown().
                (hooks.terminate_all_workers_and_wait)(10_000);
            }

            // Embedded per-VM socket groups must drain while JSC is still
            // alive (closeAll() fires on_close → JS). After JSC teardown,
            // RareData's Drop only deinit()s the groups (asserts empty).
            if self.rare_data.is_some() {
                // PORT NOTE: reshaped for borrowck — `close_all_socket_groups`
                // walks the loop's group list via `vm.uws_loop()` and never
                // touches `vm.rare_data`, so the disjoint reborrow is sound.
                // SAFETY: `self` is the live per-thread VM; the shared borrow
                // only reads `event_loop_handle` (no overlap with `rare_data`).
                let vm_ref = unsafe { &*core::ptr::from_ref(self) };
                self.rare_data
                    .as_deref_mut()
                    .unwrap()
                    .close_all_socket_groups(vm_ref);
            }

            Zig__GlobalObject__destructOnExit(self.global());

            // lastChanceToFinalize() above runs Listener/Server finalize →
            // their own embedded group.closeAll() → sockets land in
            // loop.closed_head. Drain again now or LSAN reports every accepted
            // socket that was still open at process.exit().
            // SAFETY: `uws::Loop::get()` returns the process-global usockets
            // loop, which is live for the process lifetime.
            unsafe { (*uws::Loop::get()).drain_closed_sockets() };

            // TODO(port): `self.transpiler.deinit()` — `Transpiler<'_>` has no
            // `deinit()` yet (resolver BSSMap teardown not ported).
            self.gc_controller.deinit();
            self.destroy();
        }
        bun_core::Global::exit(u32::from(self.exit_handler.exit_code))
    }
}

extern crate alloc;

// ──────────────────────────────────────────────────────────────────────────
// §Dispatch — `bun_runtime` vtable.
//
// `init` / `load_entry_point` / the `bun -e` path reach into types that live
// in the higher-tier `bun_runtime` crate (`api::Timer::All`, `node::fs`,
// `webcore::Body`, the bundler entry-point generator, …). Per PORTING.md
// §Dispatch (cold-path), the low tier defines a manual vtable; `bun_runtime`
// defines the `#[no_mangle]` static `__BUN_RUNTIME_HOOKS`. Every call
// site below is `// PERF(port): was inline switch` — acceptable, each does
// real work (I/O, JS callback, allocation).
// ──────────────────────────────────────────────────────────────────────────

/// Opaque per-VM state owned by `bun_runtime` (Timer::All, NodeFS, Body hive
/// allocator, …). Stored as `*mut c_void` in `VirtualMachine`; the high tier
/// casts back on the other side of each hook.
pub type RuntimeState = *mut c_void;

pub struct RuntimeHooks {
    /// `bun.api.Timer.All.init()` + `Body.Value.HiveAllocator.init()` +
    /// `configureDebugger()` — everything `init()` does that names a
    /// `bun_runtime` type. Called once with the freshly-boxed VM AFTER
    /// `vm.global` / `vm.jsc_vm` are populated (spec VirtualMachine.zig:1313+);
    /// returns the opaque per-VM runtime state pointer (or null).
    pub init_runtime_state:
        unsafe fn(vm: *mut VirtualMachine, opts: &mut InitOptions) -> RuntimeState,
    /// Reclaim the per-VM state boxed by `init_runtime_state`. Called from
    /// [`VirtualMachine::destroy`] (worker teardown) with the exact opaque
    /// pointer `init_runtime_state` returned (or null). The high tier
    /// `heap::take`s it and clears its thread-local cache. Spec
    /// VirtualMachine.zig: `timer`/`entry_point` are value fields freed in
    /// worker `destroy()`; without this slot every worker leaked one box.
    pub deinit_runtime_state: unsafe fn(vm: *mut VirtualMachine, state: RuntimeState),
    /// `ServerEntryPoint.generate(watch, entry_path)` — produces the synthetic
    /// `bun:main` module body for `entry_path`. Returns `false` on error
    /// (error already logged into `vm.log`).
    pub generate_entry_point: fn(vm: &VirtualMachine, watch: bool, entry_path: &[u8]) -> bool,
    /// `loadPreloads()` — runs `--preload` scripts. Returns the first rejected
    /// preload promise if any, else null. Errors propagate like Zig's
    /// `try this.loadPreloads()` (resolver failures / `ModuleNotFound`).
    pub load_preloads:
        unsafe fn(vm: *mut VirtualMachine) -> Result<*mut JSInternalPromise, bun_core::Error>,
    /// `ensureDebugger(block_until_connected)` — no-op when no debugger.
    pub ensure_debugger: unsafe fn(vm: *mut VirtualMachine, block_until_connected: bool),
    /// `eventLoop().autoTick()` — needs `Timer::All` for the timeout calc.
    /// Hoisted here so `event_loop.rs` doesn't need its own hook table.
    pub auto_tick: unsafe fn(vm: *mut VirtualMachine),
    /// `eventLoop().autoTickActive()` — like `auto_tick` but only sleeps in
    /// the uSockets loop while it has active handles (spec event_loop.zig:455).
    /// Separate slot because the body skips `runImminentGCTimer` /
    /// `handleRejectedPromises` and falls through to `tickWithoutIdle` when
    /// idle — folding it into `auto_tick` would change shutdown semantics.
    pub auto_tick_active: unsafe fn(vm: *mut VirtualMachine),
    /// `printException` / `printErrorlikeObject` — formats `value` (or its
    /// wrapped `JSC::Exception`) to stderr via `ConsoleObject::Formatter`.
    /// Spec `runErrorHandler` body (VirtualMachine.zig:2164-2188). High tier
    /// owns the formatter; low tier dispatches here from
    /// [`VirtualMachine::run_error_handler`].
    pub print_exception:
        fn(vm: &mut VirtualMachine, value: JSValue, exception_list: Option<&mut ExceptionList>),
    /// `vm.timer.insert(&mut event_loop_timer)` — `Timer::All` lives in
    /// `bun_runtime::RuntimeState` (b2-cycle); low-tier callers
    /// (`AbortSignal::Timeout`) reach it through this slot.
    pub timer_insert: unsafe fn(
        vm: *mut VirtualMachine,
        timer: *mut bun_event_loop::EventLoopTimer::EventLoopTimer,
    ),
    /// `vm.timer.remove(&mut event_loop_timer)` — see `timer_insert`.
    pub timer_remove: unsafe fn(
        vm: *mut VirtualMachine,
        timer: *mut bun_event_loop::EventLoopTimer::EventLoopTimer,
    ),
    /// `RareData.defaultClientSslCtx()` — lazy default-trust-store client
    /// `SSL_CTX*`, shared by every `tls: true` outbound connection that didn't
    /// supply explicit options. The storage slot lives in `RareData`
    /// (low-tier) but population reaches `RuntimeState.ssl_ctx_cache`
    /// (`bun_runtime`, b2-cycle); spec rare_data.zig:741.
    pub default_client_ssl_ctx: unsafe fn(vm: *mut VirtualMachine) -> *mut uws::SslCtx,
    /// `RareData.sslCtxCache().getOrCreateOpts(opts, &err)` — per-VM
    /// digest-keyed weak `SSL_CTX*` cache. Returns a +1 ref or `None` on
    /// BoringSSL rejection (`err` populated). `SSLContextCache` lives in
    /// `bun_runtime::RuntimeState` (b2-cycle).
    pub ssl_ctx_cache_get_or_create: unsafe fn(
        vm: *mut VirtualMachine,
        opts: uws::SocketContext::BunSocketContextOptions,
        err: &mut uws::create_bun_socket_error_t,
    ) -> Option<*mut uws::SslCtx>,
    /// `Node.fs.NodeFS{ .vm = … }` lazy creation (spec VirtualMachine.zig:827).
    /// `NodeFS` lives in `bun_runtime`; the high tier boxes one and returns
    /// the type-erased pointer. Stored back into `vm.node_fs`.
    pub create_node_fs: unsafe fn(vm: *mut VirtualMachine) -> *mut c_void,
    /// `Body.Value.HiveRef.init(body, &vm.body_value_pool)` — spec
    /// VirtualMachine.zig:255. The hive allocator lives inside `runtime_state`
    /// (high tier); `body` and the returned `*mut Body.Value.HiveRef` are
    /// erased here and cast back on the `bun_runtime` side.
    pub init_request_body_value:
        unsafe fn(vm: *mut VirtualMachine, body: *mut c_void) -> *mut c_void,
    /// `WebCore.ObjectURLRegistry.singleton().has(specifier["blob:".len..])` —
    /// spec VirtualMachine.zig:1760. Registry lives in `bun_runtime::webcore`.
    pub has_blob_url: fn(blob_id: &[u8]) -> bool,
    /// `Response::get_blob_without_call_frame` /
    /// `Request::get_blob_without_call_frame` — spec Macro.zig:331-334. If
    /// `value` downcasts to a `Response` or `Request` (both live in
    /// `bun_runtime::webcore`), return its body Blob wrapped in a resolved
    /// Promise; `Ok(None)` to fall through to the `Blob`/`BuildMessage`/
    /// `ResolveMessage` arms in `Macro::Run::coerce`.
    pub body_mixin_get_blob:
        fn(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<JSValue>>,
    /// `bun.api.node.process.exit(global, code)` — spec
    /// `runtime/node/node_process.zig`. Main-thread is `noreturn`; in a worker
    /// it returns and the caller `panic!`s. Lives in `bun_runtime::node`
    /// (forward-dep cycle), so [`uncaught_exception`] reaches it through this
    /// slot instead of the linker.
    pub process_exit: unsafe fn(global: *mut JSGlobalObject, code: u8),
    /// `node_cluster_binding.handleInternalMessageChild(global, data)` — spec
    /// VirtualMachine.zig:3960 (IPCInstance.handleIPCMessage `.internal` arm).
    pub handle_ipc_internal_child: unsafe fn(global: *mut JSGlobalObject, data: JSValue),
    /// `node_cluster_binding.child_singleton.deinit()` — spec
    /// VirtualMachine.zig:3972 (IPCInstance.handleIPCClose).
    pub ipc_child_singleton_deinit: fn(),
    /// `Jest.runner.?.bun_test_root.onBeforePrint()` — spec
    /// ConsoleObject.zig:170. The `bun:test` runner lives in `bun_runtime`;
    /// `console.log` calls this so the test reporter can flush its line state
    /// before user output interleaves with it. No-op when `bun test` isn't
    /// running.
    pub console_on_before_print: fn(),
    /// `ConsoleObject.Formatter.printAs(.Object, …)` runtime-type dispatch —
    /// spec ConsoleObject.zig `printAs` `.Object` arm: the long `if (value.as(T))`
    /// chain over `Response`/`Request`/`Blob`/`S3Client`/`Archive`/
    /// `BuildArtifact`/`FetchHeaders`/`Timer`/`Immediate`/`BuildMessage`/
    /// `ResolveMessage`/Jest asymmetric matchers. All of those types live in
    /// `bun_runtime`; the high tier owns the downcast + `write_format` calls.
    ///
    /// Returns `Ok(true)` when `value` was one of the runtime types and was
    /// fully formatted into `writer`; `Ok(false)` to fall through to the
    /// generic object printer.
    pub console_print_runtime_object: for<'a, 'f> fn(
        formatter: &'a mut crate::console_object::Formatter<'f>,
        writer: &'a mut dyn bun_io::Write,
        value: JSValue,
        name_buf: &'a [u8; 512],
        enable_ansi_colors: bool,
    ) -> JsResult<bool>,
    /// `bun.bun_js.applyStandaloneRuntimeFlags(b, graph)` — spec
    /// web_worker.zig:552. Applies `--compile`-baked runtime flags to the
    /// worker's transpiler. `graph` is the same trait object stored in
    /// `vm.standalone_module_graph` (the high tier downcasts to its concrete
    /// `bun_standalone_graph::Graph` — the sole implementor).
    pub apply_standalone_runtime_flags: unsafe fn(
        transpiler: *mut Transpiler<'static>,
        graph: &'static dyn bun_resolver::StandaloneModuleGraph,
    ),
    /// Spec web_worker.zig:445-476 — parse `execArgv` against the `RunCommand`
    /// param table and return the resulting `allow_addons` value
    /// (`!args.flag("--no-addons")`), or `None` if parsing failed (Zig's
    /// `catch break :parse_new_args`). The param table lives in
    /// `bun_runtime::cli` (forward-dep). Spec only honours `--no-addons`;
    /// the caller writes the returned bool back into
    /// `transform_options.allow_addons` so the override semantics
    /// ("override the existing even if it was set") match.
    pub parse_worker_exec_argv_allow_addons:
        unsafe fn(exec_argv: &[bun_core::WTFStringImpl]) -> Option<bool>,
    /// `jsc.API.cron.CronJob.clearAllForVM(vm, .teardown)` — spec
    /// web_worker.zig:727. `CronJob` lives in `bun_runtime::api::cron`.
    pub cron_clear_all_teardown: fn(vm: &mut VirtualMachine),
    /// `webcore.WebWorker.terminateAllAndWait(timeout_ms)` — spec
    /// VirtualMachine.zig:975. `WebWorker` lives in this crate but the
    /// `web_worker` module is above `virtual_machine` in the dep graph
    /// (forward use) AND the body re-enters `bun_runtime` for the worker
    /// thread's `event_loop().auto_tick()`, so [`global_exit`] reaches it
    /// through this slot. Prevents detached worker threads from racing the
    /// freed resolver BSSMap singletons during `transpiler.deinit()`.
    pub terminate_all_workers_and_wait: fn(timeout_ms: u64),
    /// `jsc.API.cron.CronJob.clearAllForVM(vm, .reload)` — spec
    /// VirtualMachine.zig:815. Same impl as `cron_clear_all_teardown` but
    /// the `.reload` mode preserves the next-fire schedule across the new
    /// global so timers re-register instead of being torn down.
    pub cron_clear_all_reload: fn(vm: &mut VirtualMachine),
    /// `graph.find(path).?.sourcemap.load()` — spec VirtualMachine.zig:3875.
    /// The concrete `bun_standalone_graph::Graph` / `File` / `LazySourceMap`
    /// live above `bun_jsc`; the high tier reaches them via the graph's own
    /// `UnsafeCell` singleton accessor (NOT by downcasting the resolver trait
    /// object — that shared-ref provenance is read-only and forming `&mut`
    /// from it would be UB) and returns the lazily-decoded map (already
    /// strong-ref'd via the returned `Arc`). [`resolve_source_mapping`]
    /// caches it into `source_mappings` so subsequent lookups hit the fast
    /// path. The caller gates the call on `vm.standalone_module_graph`.
    pub load_standalone_sourcemap:
        fn(path: &[u8]) -> Option<std::sync::Arc<bun_sourcemap::ParsedSourceMap>>,
    /// `bake::production::PerThread` source-map JSON lookup — spec
    /// sourcemap_jsc/source_provider.zig:24
    /// (`pt.source_maps.get(filename) → pt.bundled_outputs[idx].value.asSlice()`).
    /// `pt` is the opaque `*mut PerThread` round-tripped through C++ via
    /// `BakeGlobalObject__attachPerThreadData` / `…__getPerThreadData`;
    /// `PerThread` lives in `bun_runtime::bake::production` (forward-dep
    /// cycle), so `BakeSourceProvider::get_external_data` reaches it through
    /// this slot. Returns the bundled `.map` JSON for `source_filename`, or
    /// `None` if not in the table; the slice borrows
    /// `PerThread.bundled_outputs` (lives for the bake build session, which
    /// outlives any error-stack source-map resolution).
    pub bake_per_thread_source_map:
        unsafe fn(pt: *mut c_void, source_filename: &[u8]) -> Option<*const [u8]>,
    /// `TestReporterAgent.retroactivelyReportDiscoveredTests(agent)` — spec
    /// Debugger.zig:351. Walks `Jest.runner.?.bun_test_root.active_file`'s
    /// scope tree and emits `reportTestFoundWithLocation` for every test
    /// discovered before the inspector connected. `Jest` / `DescribeScope`
    /// live in `bun_runtime::test_runner` (forward-dep cycle), so the body is
    /// hoisted to the high tier; low-tier `Bun__TestReporterAgentEnable`
    /// dispatches here. No-op when `bun test` isn't running.
    pub retroactively_report_discovered_tests:
        unsafe fn(agent: *mut crate::debugger::TestReporterHandle),
}

/// Canonical `EventLoopCtx` vtable for a `*mut VirtualMachine` owner — the JS
/// half of `bun_io`'s cycle-break manual vtable. Every slot is implementable
/// from in-crate data (spec posix_event_loop.zig:100-104 / RareData.zig:441),
/// so this is the single fully-populated instance; `aio::get_vm_ctx(.Js)` and
/// the websocket-client adapters resolve to it. PORT NOTE: in Zig the
/// `KeepAlive::ref(anytype)` accepted `*VirtualMachine` directly.
/// Recover `&mut VirtualMachine` from the erased vtable `owner`. Private to
/// this module — every caller is an `unsafe fn` slot in
/// [`VM_EVENT_LOOP_CTX_VTABLE`] whose contract guarantees `owner` was erased
/// from a live `*mut VirtualMachine` in [`VirtualMachine::event_loop_ctx`].
#[inline(always)]
fn vm_from_owner<'a>(owner: *mut ()) -> &'a mut VirtualMachine {
    // SAFETY: vtable contract — `owner` is a live `*mut VirtualMachine`.
    unsafe { &mut *owner.cast::<VirtualMachine>() }
}

bun_io::link_impl_EventLoopCtx! {
    Js for VirtualMachine => |this| {
        platform_event_loop_ptr() => vm_from_owner(this.cast()).uws_loop(),
        file_polls_ptr() => {
            let rare = vm_from_owner(this.cast()).rare_data();
            &raw mut **rare.file_polls_.get_or_insert_with(|| Box::new(bun_io::Store::init()))
        },
        // CROSS-THREAD: reached via `KeepAlive::unref_on_next_tick_concurrently`.
        // Do NOT route through `vm_from_owner()` — that mints `&mut VM`, which
        // would alias the JS thread's `&mut`. Raw place RMW only (the
        // field-level non-atomic race is pre-existing; TODO: make
        // `pending_unref_counter` an `AtomicI32` with `fetch_add`).
        increment_pending_unref_counter() => (*this).pending_unref_counter += 1,
        // CROSS-THREAD: reached via `KeepAlive::{,un}ref_concurrently`. Do NOT
        // use `vm_from_owner()` / `event_loop_mut()` — both mint `&mut`, UB
        // against the JS thread's borrow. `event_loop()` takes `&self` (Sync)
        // and `{,un}ref_concurrently` take `&self` (atomic fetch_add + wakeup).
        ref_concurrently()   => (*(*this).event_loop()).ref_concurrently(),
        unref_concurrently() => (*(*this).event_loop()).unref_concurrently(),
        after_event_loop_callback() => vm_from_owner(this.cast()).after_event_loop_callback,
        set_after_event_loop_callback(cb, ctx) => {
            let vm = vm_from_owner(this.cast());
            vm.after_event_loop_callback = cb;
            vm.after_event_loop_callback_ctx = (!ctx.is_null()).then_some(ctx);
        },
        pipe_read_buffer() => {
            core::ptr::from_mut::<[u8]>(vm_from_owner(this.cast()).rare_data().pipe_read_buffer())
        },
    }
}

impl VirtualMachine {
    #[inline]
    pub fn event_loop_ctx(this: *mut Self) -> bun_io::EventLoopCtx {
        // SAFETY: `this` is a live VM (per-thread or a worker's parent ref);
        // it outlives every ctx derived from it.
        unsafe { bun_io::EventLoopCtx::new(bun_io::EventLoopCtxKind::Js, this) }
    }

    /// `&self` overload of [`event_loop_ctx`]. Routes through
    /// [`Self::get_mut_ptr`] for write provenance (the vtable callbacks
    /// dereference `owner` as `*mut VirtualMachine`).
    #[inline]
    pub fn loop_ctx(&self) -> bun_io::EventLoopCtx {
        debug_assert!(core::ptr::eq(self, Self::get_mut_ptr()));
        Self::event_loop_ctx(Self::get_mut_ptr())
    }
}

impl VirtualMachine {
    /// `vm.timer.insert(timer)` — dispatches through `RuntimeHooks` because
    /// `Timer::All` lives in `bun_runtime` (b2-cycle).
    ///
    /// # Safety
    /// `timer` must point at a live `EventLoopTimer` not currently linked into
    /// the heap; caller must be on the JS thread.
    #[inline]
    pub unsafe fn timer_insert(
        vm: *mut Self,
        timer: *mut bun_event_loop::EventLoopTimer::EventLoopTimer,
    ) {
        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        // SAFETY: per fn contract; `vm` is the live per-thread VM.
        unsafe { (hooks.timer_insert)(vm, timer) }
    }

    /// `vm.timer.remove(timer)` — see [`Self::timer_insert`].
    ///
    /// # Safety
    /// `timer` must point at a live `EventLoopTimer` currently linked into the
    /// heap (state == ACTIVE); caller must be on the JS thread.
    #[inline]
    pub unsafe fn timer_remove(
        vm: *mut Self,
        timer: *mut bun_event_loop::EventLoopTimer::EventLoopTimer,
    ) {
        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        // SAFETY: per fn contract; `vm` is the live per-thread VM.
        unsafe { (hooks.timer_remove)(vm, timer) }
    }
}

unsafe extern "Rust" {
    /// The single `&'static` instance, defined `#[no_mangle]` in
    /// `bun_runtime::jsc_hooks`. Link-time resolved — no `AtomicPtr`, no
    /// init-order hazard. Zig had no crate split here; `VirtualMachine`
    /// reached `Timer::All` / `ServerEntryPoint` / etc. directly.
    /// `RuntimeHooks` is an immutable POD of fn-ptrs with a single definition;
    /// reading it has no precondition beyond the link succeeding → `safe static`.
    safe static __BUN_RUNTIME_HOOKS: RuntimeHooks;
}

#[inline]
pub fn runtime_hooks() -> Option<&'static RuntimeHooks> {
    // Link-time-resolved `&'static` Rust-ABI static. Always `Some` —
    // kept as `Option` so existing call sites (`if let Some(hooks)`) compile
    // unchanged; the branch folds away.
    Some(&__BUN_RUNTIME_HOOKS)
}

// TODO(port): move to jsc_sys
#[allow(improper_ctypes)] // VirtualMachine is opaque to C++; passed as `void*`
unsafe extern "C" {
    // Spec JSGlobalObject.zig:863 / headers.h:435 — note the real symbol is
    // `Zig__GlobalObject__create` and takes 5 args (no leading `vm`); the Zig
    // wrapper `JSGlobalObject.create` accepts `vm` only to call
    // `vm.eventLoop().ensureWaker()` before the FFI.
    // safe: `console`/`worker_ptr` are opaque round-trip pointers C++ stores
    // into the new ZigGlobalObject (never dereferenced as Rust data); remaining
    // args are by-value scalars.
    safe fn Zig__GlobalObject__create(
        console: *mut c_void,
        context_id: i32,
        mini_mode: bool,
        eval_mode: bool,
        worker_ptr: *mut c_void,
    ) -> *mut JSGlobalObject;
    // safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
    // ABI-identical to a non-null `*mut`); remaining args are by-value scalars.
    // The returned cell pointer is GC-owned (caller checks before deref).
    safe fn Bun__loadHTMLEntryPoint(global: &JSGlobalObject) -> *mut JSInternalPromise;
    // safe: `ctx` is an opaque round-trip pointer C++ only forwards to `callback`
    // (never dereferenced as Rust data).
    safe fn JSC__VM__holdAPILock(
        vm: &VM,
        ctx: *mut c_void,
        callback: extern "C" fn(ctx: *mut c_void),
    );
    safe fn NodeModuleModule__callOverriddenRunMain(
        global: &JSGlobalObject,
        argv1: JSValue,
    ) -> JSValue;
    safe fn JSC__JSInternalPromise__resolvedPromise(
        global: &JSGlobalObject,
        value: JSValue,
    ) -> *mut JSInternalPromise;
}

fn get_origin_timestamp() -> u64 {
    // Subtract the Y2K epoch so the timestamp fits in a u64 (nanoseconds).
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as i128)
        .unwrap_or(0);
    (now - ORIGIN_RELATIVE_EPOCH).max(0) as u64
}

impl VirtualMachine {
    /// `VirtualMachine.init(opts)` — allocate + wire the per-thread VM.
    ///
    /// PORT NOTE: every step that names a `bun_runtime` / `bun_webcore` type
    /// (`Timer.All.init`, `Body.Value.HiveAllocator`, `configureDebugger`,
    /// `Config.configureTransformOptionsForBunVM`, `ParentDeathWatchdog`) is
    /// dispatched through `RuntimeHooks::init_runtime_state` so `bun_jsc` does
    /// not name those types directly. The hook receives the boxed VM after the
    /// JSC-tier fields are populated and finishes the rest.
    pub fn init(mut opts: InitOptions) -> Result<*mut VirtualMachine, bun_core::Error> {
        jsc::mark_binding();

        // Spec VirtualMachine.zig:1234 — `opts.log orelse allocator.create(Log)`.
        let log: *mut bun_ast::Log = match opts.log {
            Some(l) => l.as_ptr(),
            None => bun_core::heap::into_raw(Box::new(bun_ast::Log::default())),
        };

        // SAFETY: VM is large + self-referential; allocate zeroed and fill in
        // place (mirrors Zig's `allocator.create` + struct-init). The
        // allocation lives for the thread lifetime (never freed on the main
        // thread; worker `destroy()` frees it explicitly).
        //
        // PORT NOTE (validity): the zeroed bytes are NOT a valid
        // `VirtualMachine` — `origin_timer: Instant`, `on_unhandled_rejection:
        // fn(...)`, (debug) `debug_thread_id: ThreadId`, every `Vec`/`Box`/
        // `HashMap`/`ArrayHashMap` field (NonNull dangling-when-empty), `URL`
        // (`&[u8]` references), and `Option<bool>` (bool-niche → zero = Some)
        // have no all-zero repr. We therefore never materialize
        // `&mut VirtualMachine` until all such fields have been `ptr::write`n
        // via `addr_of_mut!`; remaining fields are zero-valid
        // (integers/raw-ptr/atomic-mutex/`Option<NonNull>`/`Option<Box>`) so
        // the zero-fill stands in for the Zig struct-init defaults.
        let layout = core::alloc::Layout::new::<VirtualMachine>();
        // SAFETY: `layout` is non-zero-sized; `alloc_zeroed` returns either a
        // valid aligned ptr or null (handled by `handle_alloc_error`).
        let vm: *mut VirtualMachine = unsafe {
            let p = alloc::alloc::alloc_zeroed(layout);
            if p.is_null() {
                alloc::alloc::handle_alloc_error(layout);
            }
            p.cast()
        };
        VM.set(Some(vm));
        if opts.is_main_thread {
            MAIN_THREAD_VM.store(vm, core::sync::atomic::Ordering::Release);
        }

        // ConsoleObject is self-referential (buffers + adapters) — allocate
        // stable storage and init in place. Spec VirtualMachine.zig:1238-1239:
        // `console.init(Output.rawErrorWriter(), Output.rawWriter())` must
        // happen BEFORE the pointer is stored/passed; the previous port left
        // it as raw `MaybeUninit` (UB on first C++ read).
        let mut console_box: Box<core::mem::MaybeUninit<crate::console_object::ConsoleObject>> =
            Box::new(core::mem::MaybeUninit::uninit());
        crate::console_object::ConsoleObject::init_in_place(
            &mut console_box,
            bun_core::Output::raw_error_writer(),
            bun_core::Output::raw_writer(),
        );
        let console =
            bun_core::heap::into_raw(console_box).cast::<crate::console_object::ConsoleObject>();

        let context_id = opts
            .context_id
            .unwrap_or(if opts.is_main_thread { 1 } else { i32::MAX });

        // SAFETY: `vm` is a fresh unique zeroed allocation on this thread. All
        // writes go through `addr_of_mut!` so no `&mut VirtualMachine` is
        // formed while non-zero-valid fields are still zero. Every target is
        // either zero-valid (no Drop on the overwritten bytes) or written via
        // `ptr::write` (no Drop of the uninit bytes).
        unsafe {
            use core::ptr::addr_of_mut;
            addr_of_mut!((*vm).global).write(core::ptr::null_mut());
            addr_of_mut!((*vm).console).write(console);
            // `log` is a fresh leaked Box; outlives the VM.
            addr_of_mut!((*vm).log).write(NonNull::new(log));
            addr_of_mut!((*vm).main).write(bun_ptr::RawSlice::EMPTY);
            addr_of_mut!((*vm).main_hash).write(0);
            addr_of_mut!((*vm).main_resolved_path).write(bun_core::String::empty());
            addr_of_mut!((*vm).hide_bun_stackframes).write(true);
            addr_of_mut!((*vm).is_main_thread).write(opts.is_main_thread);
            // Spec VirtualMachine.zig:154 — `= std.math.maxInt(u32)`. Left at the
            // zeroed default this aliases `hot_reload_counter`'s initial 0, so a
            // watcher event that races the very first entry-point load makes
            // `reload()` think the rejection was already reported and proceed
            // (replacing `pending_internal_promise`) instead of deferring,
            // dropping the error on the floor.
            addr_of_mut!((*vm).pending_internal_promise_reported_at).write(u32::MAX);
            addr_of_mut!((*vm).on_unhandled_rejection)
                .write(VirtualMachine::default_on_unhandled_rejection);
            addr_of_mut!((*vm).origin_timer).write(std::time::Instant::now());
            addr_of_mut!((*vm).origin_timestamp).write(get_origin_timestamp());
            addr_of_mut!((*vm).smol).write(opts.smol);
            // `Option<{CPU,Heap}ProfilerConfig>` are NOT zero-valid: each
            // payload contains a `bool`, and rustc picks that field's invalid
            // range (not the `&[u8]` null-ptr) as the enum niche, so all-zero
            // bytes decode as `Some` with null-ref slices. Write `None`
            // explicitly.
            addr_of_mut!((*vm).cpu_profiler_config).write(None);
            addr_of_mut!((*vm).heap_profiler_config).write(None);
            // `Option<bool>` uses the bool's invalid range (2) as the niche, so
            // all-zero bytes decode as `Some(false)` — for TLS that would
            // silently disable certificate verification. Write `None` explicitly.
            addr_of_mut!((*vm).default_tls_reject_unauthorized).write(None);
            addr_of_mut!((*vm).ipc).write(None);
            // Non-zero-valid container fields: `Vec`/`Box`/`HashMap`/
            // `ArrayHashMap` all carry a `NonNull` (dangling when empty), and
            // `URL` is a struct of `&[u8]` references — all-zero bytes violate
            // their validity invariants even when len/cap are 0. Write the
            // canonical empty value via `ptr::write` (no Drop of zeroed bytes).
            addr_of_mut!((*vm).preload).write(Vec::new());
            addr_of_mut!((*vm).argv).write(Vec::new());
            addr_of_mut!((*vm).macros).write(Default::default());
            addr_of_mut!((*vm).macro_entry_points).write(Default::default());
            addr_of_mut!((*vm).auto_killer).write(Default::default());
            addr_of_mut!((*vm).commonjs_custom_extensions).write(Default::default());
            addr_of_mut!((*vm).entry_point).write(Default::default());
            addr_of_mut!((*vm).origin).write(Default::default());
            addr_of_mut!((*vm).ref_strings).write(Default::default());
            addr_of_mut!((*vm).modules).write(Default::default());
            addr_of_mut!((*vm).macro_event_loop).write(EventLoop::default());
            addr_of_mut!((*vm).proxy_env_storage).write(Default::default());
            addr_of_mut!((*vm).gc_controller).write(Default::default());
            addr_of_mut!((*vm).channel_ref).write(Default::default());
            addr_of_mut!((*vm).standalone_module_graph).write(opts.graph);
            addr_of_mut!((*vm).initial_script_execution_context_identifier).write(context_id);
            #[cfg(debug_assertions)]
            addr_of_mut!((*vm).debug_thread_id).write(std::thread::current().id());
            // Mutex fields: zeroed atomics ARE valid-unlocked, but write the
            // canonical value so the invariant is explicit.
            addr_of_mut!((*vm).remap_stack_frames_mutex).write(bun_threading::Mutex::new());
            addr_of_mut!((*vm).ref_strings_mutex).write(bun_threading::Mutex::new());

            addr_of_mut!((*vm).transpiler_store)
                .write(crate::runtime_transpiler_store::RuntimeTranspilerStore::init());

            // Event-loop wiring (self-pointers).
            addr_of_mut!((*vm).regular_event_loop).write(EventLoop::default());
            let regular = addr_of_mut!((*vm).regular_event_loop);
            (*regular).virtual_machine = NonNull::new(vm);
            let _ = (*regular).tasks.ensure_unused_capacity(64);
            addr_of_mut!((*vm).event_loop).write(regular);

            // `source_mappings.map` is a sibling-field backref onto
            // `saved_source_map_table` (spec VirtualMachine.zig:1273).
            addr_of_mut!((*vm).saved_source_map_table)
                .write(crate::saved_source_map::HashTable::default());
            addr_of_mut!((*vm).source_mappings).write(SavedSourceMap::default());
            (*addr_of_mut!((*vm).source_mappings)).map = addr_of_mut!((*vm).saved_source_map_table);
        }

        // High-tier per-VM state — Transpiler / Timer::All / entry_point.
        // PORT NOTE (init order): spec VirtualMachine.zig:1241/1259 builds
        // `Transpiler.init` and `.timer = bun.api.Timer.All.init()` as part of
        // the struct initializer BEFORE `JSGlobalObject.create`. The C++ body
        // of `Zig__GlobalObject__create` re-enters via `WTFTimer__create`/
        // `WTFTimer__update` (JSC's GC scheduler), which dereferences
        // `runtime_state().timer` — so this hook MUST run first or that path
        // null-derefs. The post-global tail (`configureDebugger`,
        // `Body.Value.HiveAllocator.init`, spec :1321-1322) is gated TODO in
        // the hook body and will need a separate post-global hook when
        // un-gated. PERF(port): was inline switch.
        if let Some(hooks) = runtime_hooks() {
            // SAFETY: hook contract — `vm` is the unique live VM on this
            // thread. Write through the raw `vm` ptr (not `vm_ref`) so no
            // `&mut VirtualMachine` is held live across the hook call — the
            // hook body itself dereferences `vm`.
            unsafe { (*vm).runtime_state = (hooks.init_runtime_state)(vm, &mut opts) };
        }

        // JSGlobalObject creation. Spec JSGlobalObject.zig:875 — the wrapper
        // calls `vm.eventLoop().ensureWaker()` before the 5-arg FFI.
        // SAFETY: `vm` is the unique live VM on this thread; raw-ptr deref so
        // no `&mut` is held across the FFI re-entry (`Bun__getVM()` —
        // ZigGlobalObject.cpp:473/961).
        unsafe { (*vm).regular_event_loop.ensure_waker() };
        // `console`/`worker_ptr` are opaque round-trip pointers C++ stores into
        // the new global. `worker_ptr` is the C++ `WebCore::Worker*` (or null on
        // the main thread) — spec VirtualMachine.zig:1477-1484 / JSGlobalObject.zig:876.
        let global = Zig__GlobalObject__create(
            console.cast(),
            context_id,
            opts.mini_mode,
            opts.eval_mode,
            opts.worker_ptr,
        );
        // JSC may mess with the stack size (spec JSGlobalObject.zig:879).
        bun_core::StackCheck::configure_thread();
        // SAFETY: write through the raw `vm` ptr (not `vm_ref`) so no
        // `&mut VirtualMachine` is held live across the FFI call above; same
        // pattern as the `init_runtime_state` hook above. `global` is freshly
        // created and live for VM lifetime; `vm_ptr()` returns the FFI
        // `*mut VM` directly (no `&VM` reborrow), preserving mutable provenance.
        let jsc_vm = unsafe {
            (*vm).global = global;
            (*vm).regular_event_loop.global = NonNull::new(global);
            let jsc_vm = (*global).vm_ptr();
            (*vm).jsc_vm = jsc_vm;
            jsc_vm
        };
        VMHolder::set_cached_global_object(Some(global));

        // Spec VirtualMachine.zig:1313: `uws.Loop.get().internal_loop_data.jsc_vm
        // = vm.jsc_vm` — must run AFTER `jsc_vm` is set so C/uws callbacks can
        // recover the JSC VM via `internal_loop_data`.
        // SAFETY: `uws::Loop::get()` returns the live per-thread uws loop.
        unsafe {
            (*uws::Loop::get()).internal_loop_data.jsc_vm = jsc_vm.cast();
        }

        // Spec VirtualMachine.zig:1316 / :1191 — `if (opts.is_main_thread)
        // bun.ParentDeathWatchdog.installOnEventLoop(jsc.EventLoopHandle.init(vm))`.
        // Must run AFTER `ensure_waker()` (above) has set `event_loop_handle`,
        // since on macOS the kqueue registration resolves the platform loop via
        // `event_loop_ctx → uws_loop()`. No-op off macOS / when `--no-orphans`
        // is not enabled. `init_with_module_graph` / `init_bake` route through
        // here with their caller's `is_main_thread`; `init_worker` passes
        // `false` so workers never arm the watchdog (matches spec `initWorker`).
        if opts.is_main_thread {
            bun_io::ParentDeathWatchdog::install_on_event_loop(Self::event_loop_ctx(vm));
        }

        if opts.smol {
            // SAFETY: written once during init.
            IS_SMOL_MODE.store(true, core::sync::atomic::Ordering::Relaxed);
        }

        Ok(vm)
    }

    /// `init` + set `main` to `entry_path`. Port-side convenience for the
    /// `bun -e` / `bun run <file>` boot path; Zig open-codes this in
    /// `run_command.zig`.
    pub fn init_with_main(
        opts: InitOptions,
        entry_path: &[u8],
    ) -> Result<*mut VirtualMachine, bun_core::Error> {
        let vm = Self::init(opts)?;
        // SAFETY: `vm` is the unique live VM on this thread.
        let vm_ref = unsafe { &mut *vm };
        vm_ref.set_main(entry_path);
        vm_ref.main_hash = bun_watcher::Watcher::get_hash(entry_path);
        Ok(vm)
    }

    /// Read the entry-point path (see `main` field doc).
    ///
    /// # Safety (callers)
    /// The slice borrows storage that outlives this VM (process-argv,
    /// resolver string store, standalone graph, or the owning `WebWorker`);
    /// see the field doc. Never freed by the VM.
    #[inline]
    pub fn main(&self) -> &[u8] {
        // `main` is a `RawSlice` whose storage outlives this VM (BACKREF — see
        // field doc); the invariant is encapsulated in `RawSlice::slice`.
        self.main.slice()
    }

    /// Set the entry-point path. Caller guarantees `path`'s storage outlives
    /// this VM (BACKREF — see `main` field doc).
    #[inline]
    pub fn set_main(&mut self, path: &[u8]) {
        self.main = bun_ptr::RawSlice::new(path);
    }

    /// `eventLoop().waitForPromise(promise)` — spin tick/auto_tick until
    /// `promise` settles. Thin forwarder; body lives in
    /// [`crate::event_loop::EventLoop::wait_for_promise`] (spec event_loop.zig).
    #[inline]
    pub fn wait_for_promise(&mut self, promise: jsc::AnyPromise) {
        // accessed here (no overlapping `&mut EventLoop`).
        self.event_loop_mut().wait_for_promise(promise);
    }

    /// `eventLoop().autoTick()` — dispatched through the runtime hook
    /// (needs `Timer::All` for the poll timeout).
    #[inline]
    pub fn auto_tick(&mut self) {
        if let Some(hooks) = runtime_hooks() {
            // SAFETY: hook contract — `self` is the live per-thread VM.
            // PERF(port): was inline switch.
            unsafe { (hooks.auto_tick)(self) };
        } else {
            // No high tier (unit tests) — fall back to a non-blocking tick.
            self.event_loop_mut().tick();
        }
    }

    /// `eventLoop().autoTickActive()` — like [`auto_tick`](Self::auto_tick)
    /// but only sleeps in the uSockets loop while it has active handles
    /// (spec event_loop.zig:456). The real body lives in `event_loop.rs`
    /// behind `` until the b2-cycle (`Timer::All`) breaks; until
    /// then route through the same `auto_tick` hook so drain loops in
    /// `on_before_exit` / `bun_main` still make forward progress.
    #[inline]
    pub fn auto_tick_active(&mut self) {
        if let Some(hooks) = runtime_hooks() {
            // PERF(port): was inline switch — direct call in event_loop.zig.
            // SAFETY: `self` is the live per-thread VM (hook contract).
            unsafe { (hooks.auto_tick_active)(self) };
        } else {
            // No high-tier hook (unit tests) — drain JS tasks only so callers
            // observe forward progress without blocking on the I/O loop.
            self.event_loop_mut().tick();
        }
    }

    /// `reloadEntryPoint(entry_path)` — set `main`, generate the synthetic
    /// `bun:main` entry, run preloads, and kick off module evaluation.
    pub fn reload_entry_point(
        &mut self,
        entry_path: &[u8],
    ) -> Result<*mut JSInternalPromise, bun_core::Error> {
        self.has_loaded = false;
        self.set_main(entry_path);
        self.main_resolved_path.deref();
        self.main_resolved_path = bun_core::String::empty();
        self.main_hash = bun_watcher::Watcher::get_hash(entry_path);
        self.overridden_main.deinit();

        let hooks = runtime_hooks();
        let _ = self.ensure_debugger(true);

        if !self.main_is_html_entrypoint {
            if let Some(hooks) = hooks {
                let watch = self.is_watcher_enabled();
                if !(hooks.generate_entry_point)(self, watch, entry_path) {
                    return Err(bun_core::err!("ServerEntryPointGenerate"));
                }
            }
        }

        if !self.transpiler.options.disable_transpilation {
            if !self.preload.is_empty() {
                if let Some(hooks) = hooks {
                    // SAFETY: hook contract.
                    let p = unsafe { (hooks.load_preloads)(self) }?;
                    if !p.is_null() {
                        JSValue::from_cell(p).ensure_still_alive();
                        JSValue::from_cell(p).protect();
                        self.pending_internal_promise = Some(p);
                        self.pending_internal_promise_is_protected = true;
                        return Ok(p);
                    }
                }

                // Check if Module.runMain was patched (spec VirtualMachine.zig:2322-2335).
                if self.has_patched_run_main {
                    bun_core::hint::cold();
                    self.pending_internal_promise = None;
                    self.pending_internal_promise_is_protected = false;
                    let global_ref = self.global();
                    let argv1 = jsc::bun_string_jsc::create_utf8_for_js(global_ref, MAIN_FILE_NAME)
                        .map_err(|_| bun_core::err!("JSError"))?;
                    let ret = jsc::from_js_host_call_generic(global_ref, || {
                        NodeModuleModule__callOverriddenRunMain(global_ref, argv1)
                    })
                    .map_err(|_| bun_core::err!("JSError"))?;
                    // If the override stored a promise itself, use that; otherwise
                    // wrap its return value.
                    if let Some(stored) = self.pending_internal_promise {
                        return Ok(stored);
                    }
                    let resolved = JSC__JSInternalPromise__resolvedPromise(global_ref, ret);
                    self.pending_internal_promise = Some(resolved);
                    self.pending_internal_promise_is_protected = false;
                    return Ok(resolved);
                }
            }

            // PORT NOTE: reshaped for borrowck — capture raw ptr before &self call.
            let global = self.global;
            let global_ref = self.global();
            let promise = if !self.main_is_html_entrypoint {
                let name = bun_core::String::borrow_utf8(MAIN_FILE_NAME);
                jsc::JSModuleLoader::load_and_evaluate_module_ptr(global, Some(&name))
                    .map(NonNull::as_ptr)
                    .ok_or_else(|| bun_core::err!("JSError"))?
            } else {
                let p: *mut JSInternalPromise = jsc::from_js_host_call_generic(global_ref, || {
                    Bun__loadHTMLEntryPoint(global_ref)
                })
                .map_err(|_| bun_core::err!("JSError"))?;
                if p.is_null() {
                    return Err(bun_core::err!("JSError"));
                }
                p
            };

            self.pending_internal_promise = Some(promise);
            self.pending_internal_promise_is_protected = false;
            JSValue::from_cell(promise).ensure_still_alive();
            Ok(promise)
        } else {
            let global = self.global;
            let main_str = bun_core::String::from_bytes(self.main());
            let promise =
                jsc::JSModuleLoader::load_and_evaluate_module_ptr(global, Some(&main_str))
                    .map(NonNull::as_ptr)
                    .ok_or_else(|| bun_core::err!("JSError"))?;
            self.pending_internal_promise = Some(promise);
            self.pending_internal_promise_is_protected = false;
            JSValue::from_cell(promise).ensure_still_alive();
            Ok(promise)
        }
    }

    /// `loadEntryPoint(entry_path)` — `reload_entry_point` + spin until the
    /// returned promise settles.
    pub fn load_entry_point(
        &mut self,
        entry_path: &[u8],
    ) -> Result<*mut JSInternalPromise, bun_core::Error> {
        let promise = self.reload_entry_point(entry_path)?;

        // pending_internal_promise can change if hot module reloading is enabled
        if self.is_watcher_enabled() {
            // accessed here (no overlapping `&mut EventLoop`).
            self.event_loop_mut().perform_gc();
            loop {
                let Some(p) = self.pending_internal_promise else {
                    break;
                };
                // SAFETY: `p` is a live JSC heap cell tracked by the VM.
                if crate::JSPromise::status_ptr(p) != crate::js_promise::Status::Pending {
                    break;
                }
                self.event_loop_mut().tick();
                let Some(p) = self.pending_internal_promise else {
                    break;
                };
                // SAFETY: see above.
                if crate::JSPromise::status_ptr(p) == crate::js_promise::Status::Pending {
                    self.auto_tick();
                }
            }
        } else {
            // SAFETY: `promise` is a live JSC heap cell.
            if crate::JSPromise::status_ptr(promise) == crate::js_promise::Status::Rejected {
                return Ok(promise);
            }
            self.event_loop_mut().perform_gc();
            self.wait_for_promise(jsc::AnyPromise::Internal(promise));
        }

        Ok(self.pending_internal_promise.unwrap_or(promise))
    }

    /// Drain pending tasks/microtasks if the event loop is not currently
    /// re-entered. Port-side convenience used after top-level evaluation on
    /// the `bun -e` path (Zig open-codes `eventLoop().tick()` +
    /// `drainMicrotasks()` at each call site).
    pub fn drain_queues_if_needed(&mut self) {
        // SAFETY: `event_loop` is a self-pointer into this VM; uniquely
        // accessed here (no overlapping `&mut EventLoop`).
        if self.event_loop_mut().entered_event_loop_count > 0 {
            return;
        }
        self.event_loop_mut().tick();
        let _ = self.event_loop_mut().drain_microtasks();
        self.global().handle_rejected_promises();
    }
}

/// Spec VirtualMachine.zig:2032 `processFetchLog`. Synthesize a JS
/// `BuildMessage` / `ResolveMessage` / `AggregateError` from the parser
/// `log` and write it into `ret` as `.err(..)` so the C++ module-loader
/// (`Bun__onFulfillAsyncModule`, ModuleLoader.cpp) rejects the import promise
/// with a real Error instead of `undefined`.
///
/// Free function (file-level in Zig); takes `&JSGlobalObject` directly rather
/// than `&mut VirtualMachine` because the body never touches VM state — Zig
/// only used `globalThis.arena()` for the format buffers, which is
/// `bun.default_allocator` (= global mimalloc) and dropped per §Allocators.
pub fn process_fetch_log(
    global_this: &JSGlobalObject,
    specifier: bun_core::String,
    referrer: bun_core::String,
    log: &mut bun_ast::Log,
    ret: &mut ErrorableResolvedSource,
    err: bun_core::Error,
) {
    use crate::{BuildMessage, ResolveMessage};

    // Helper: `expr catch |e| globalThis.takeException(e)`.
    let take =
        |r: JsResult<JSValue>| -> JSValue { r.unwrap_or_else(|e| global_this.take_exception(e)) };

    // Spec: `referrer.toUTF8(bun.default_allocator)` — `ResolveMessage::create`
    // takes raw `&[u8]` and stores them verbatim, so we must convert here.
    let referrer_utf8 = referrer.to_utf8();

    match log.msgs.len() {
        0 => {
            let msg = if err == bun_core::err!("UnexpectedPendingResolution") {
                bun_ast::Msg {
                    data: bun_ast::range_data(
                        None,
                        bun_ast::Range::NONE,
                        format!(
                            "Unexpected pending import in \"{specifier}\". To automatically \
                             install npm packages with Bun, please use an import statement \
                             instead of require() or dynamic import().\nThis error can also \
                             happen if dependencies import packages which are not referenced \
                             anywhere. Worst case, run `bun install` and opt-out of the \
                             node_modules folder until we come up with a better way to handle \
                             this error."
                        )
                        .into_bytes(),
                    ),
                    ..Default::default()
                }
            } else {
                bun_ast::Msg {
                    data: bun_ast::range_data(
                        None,
                        bun_ast::Range::NONE,
                        format!("{} while building {specifier}", err.name()).into_bytes(),
                    ),
                    ..Default::default()
                }
            };
            *ret = ErrorableResolvedSource::err(err, take(BuildMessage::create(global_this, msg)));
        }

        1 => {
            // PORT NOTE: Zig copied `log.msgs.items[0]` by value; `Msg` is not
            // `Copy` here, so move it out — the caller `defer log.deinit()`s
            // immediately after, so consuming the vec is sound.
            let msg = log.msgs.swap_remove(0);
            let value = match msg.metadata {
                bun_ast::Metadata::Build => take(BuildMessage::create(global_this, msg)),
                bun_ast::Metadata::Resolve(_) => take(ResolveMessage::create(
                    global_this,
                    &msg,
                    referrer_utf8.slice(),
                )),
            };
            *ret = ErrorableResolvedSource::err(err, value);
        }

        _ => {
            // Spec caps at 256 (`var errors_stack: [256]JSValue`). PERF(port):
            // was inline switch — Zig stack-allocated; we heap-allocate the
            // exact `len` since `JSValue` is a thin u64 and 256 * 8 B = 2 KiB
            // is fine either way, but `Vec` avoids the uninit-array dance.
            let len = log.msgs.len().min(256);
            let mut errors: alloc::vec::Vec<JSValue> = alloc::vec::Vec::with_capacity(len);
            for msg in log.msgs.drain(..len) {
                let v = match msg.metadata {
                    bun_ast::Metadata::Build => take(BuildMessage::create(global_this, msg)),
                    bun_ast::Metadata::Resolve(_) => take(ResolveMessage::create(
                        global_this,
                        &msg,
                        referrer_utf8.slice(),
                    )),
                };
                errors.push(v);
            }

            // C++ `Zig::toString` does `createWithoutCopying`, so the buffer
            // must outlive the AggregateError. Mark it global so JSC adopts it
            // as an ExternalStringImpl and frees it via `free_global_string`.
            let message_text: &'static mut [u8] = bun_core::heap::release(
                format!("{} errors building \"{specifier}\"", errors.len())
                    .into_bytes()
                    .into_boxed_slice(),
            );
            let mut message = crate::ZigString::init(message_text);
            message.mark_global();
            *ret = ErrorableResolvedSource::err(
                err,
                take(global_this.create_aggregate_error(&errors, &message)),
            );
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SourceMapHandlerGetter — port of VirtualMachine.zig:403 `SourceMapHandlerGetter`.
// ──────────────────────────────────────────────────────────────────────────

/// Port of `SourceMapHandlerGetter` (VirtualMachine.zig:403). Holds raw
/// pointers to the VM and the active `BufferPrinter` so that `get()` can
/// return an erased `js_printer::SourceMapHandler` borrowing either the VM's
/// `source_mappings` (fast path) or `self` (debugger / inline-sourcemap path)
/// without the two `&mut` borrows colliding.
///
/// PORT NOTE: Zig stored `*VirtualMachine` / `*BufferPrinter` directly. Here
/// we keep raw pointers + a `PhantomData<&'a mut ()>` so the getter's lifetime
/// is tied to the `&'a mut VirtualMachine` it was built from in
/// `source_map_handler`, but `get()` can still hand out a
/// `SourceMapHandler<'_>` over `vm.source_mappings` without tripping borrowck
/// on the disjoint `self.vm` reborrow. `printer` is accepted and stored as a
/// raw pointer (NOT `&'a mut`) because the same `BufferPrinter` is also the
/// live `writer` inside `print_with_source_map`; holding an `&'a mut` here
/// would alias it for the whole print.
pub struct SourceMapHandlerGetter<'a> {
    vm: *mut VirtualMachine,
    printer: *mut bun_js_printer::BufferPrinter,
    _marker: core::marker::PhantomData<&'a mut ()>,
}

impl<'a> SourceMapHandlerGetter<'a> {
    /// Construct directly from raw pointers — used by the off-JS-thread
    /// transpiler worker (`TranspilerJob::run`) which must never materialize a
    /// `&mut VirtualMachine` (the VM is concurrently live on the JS thread and
    /// the job slot itself is stored *inside* `vm.transpiler_store`).
    ///
    /// SAFETY: caller guarantees `vm` outlives `'a` and that only worker-safe
    /// leaf fields (`source_mappings`, `debugger`) are touched via `get()`.
    #[inline]
    pub(crate) unsafe fn from_raw(
        vm: *mut VirtualMachine,
        printer: *mut bun_js_printer::BufferPrinter,
    ) -> Self {
        Self {
            vm,
            printer,
            _marker: core::marker::PhantomData,
        }
    }

    /// Read-only view of `(*vm).debugger` via raw place projection.
    ///
    /// SAFETY: `vm` is never null (set from a live `&'a mut VirtualMachine` in
    /// `source_map_handler`, or via `from_raw` whose caller guarantees the VM
    /// outlives `'a`). Deliberately projects through the raw pointer to the
    /// leaf field WITHOUT forming an intermediate `&VirtualMachine` /
    /// `&mut VirtualMachine`: on the off-JS-thread `TranspilerJob::run` path
    /// the JS thread is concurrently live on the same VM, AND the running
    /// `&mut TranspilerJob` is itself stored inside
    /// `(*vm).transpiler_store.store`, so a whole-VM retag would be a data
    /// race and would invalidate the caller's `&mut self` tag (Stacked
    /// Borrows). Only the worker-safe `debugger` bytes are retagged here.
    #[inline]
    fn vm_debugger(&self) -> Option<&crate::debugger::Debugger> {
        unsafe { (*self.vm).debugger.as_deref() }
    }

    /// Exclusive access to `(*vm).source_mappings` via raw place projection.
    ///
    /// SAFETY: as for `vm_debugger` — `vm` is never null, and we project
    /// `(*self.vm).source_mappings` directly so only the leaf field's bytes
    /// are retagged. A whole-VM `&mut *self.vm` here would (a) race with the
    /// JS thread on the `from_raw` worker path, (b) overlap the caller's own
    /// `&mut TranspilerJob` storage inside `vm.transpiler_store`, and (c) on
    /// the main-thread jsc_hooks path, overlap the already-formed
    /// `&mut (*jsc_vm).transpiler` receiver borrow. The leaf projection
    /// touches none of those bytes.
    #[inline]
    fn vm_source_mappings_mut(&mut self) -> &mut SavedSourceMap {
        unsafe { &mut (*self.vm).source_mappings }
    }

    /// Raw pointer to the active `BufferPrinter`.
    ///
    /// Intentionally NOT a `&mut`-returning accessor: the same
    /// `BufferPrinter` is concurrently the live `writer` argument inside
    /// `print_with_source_map`, so materializing a `&mut` here while the
    /// printer is mid-write would alias. Callers must only dereference this
    /// pointer once the writer's last byte has been emitted (i.e. inside
    /// `on_source_map_chunk`, which the printer invokes from its tail).
    #[inline]
    #[allow(dead_code)]
    pub(crate) fn printer_ptr(&self) -> *mut bun_js_printer::BufferPrinter {
        self.printer
    }

    pub fn get(&mut self) -> bun_js_printer::SourceMapHandler<'_> {
        // VirtualMachine.zig:408: take the inline-sourcemap path only when a
        // debugger is present AND it is *not* in `.connect` mode — `.connect`
        // (VSCode-extension) clients fall through to the `source_mappings`
        // fast-path handler.
        let wants_inline_source_map = matches!(
            self.vm_debugger(),
            Some(d) if d.mode != crate::debugger::Mode::Connect
        );
        if !wants_inline_source_map {
            // `source_mappings` is a value field on the VM, exclusively
            // borrowed for the returned handler's lifetime (bounded by
            // `&mut self`).
            return bun_js_printer::SourceMapHandler::for_(self.vm_source_mappings_mut());
        }
        bun_js_printer::SourceMapHandler::for_(self)
    }
}

impl<'a> bun_js_printer::OnSourceMapChunk for SourceMapHandlerGetter<'a> {
    /// Port of `SourceMapHandlerGetter.onChunk` (VirtualMachine.zig:418).
    ///
    /// When the inspector is enabled, we want to generate an inline sourcemap.
    /// And, for now, we also store it in `source_mappings` like normal.
    /// This is hideously expensive memory-wise...
    fn on_source_map_chunk(
        &mut self,
        chunk: bun_sourcemap::Chunk,
        source: &bun_ast::Source,
    ) -> Result<(), bun_core::Error> {
        let mut temp_json_buffer = bun_core::MutableString::init_empty();
        // `defer temp_json_buffer.deinit()` → Drop.
        chunk.print_source_map_contents_from_internal::<true>(
            source,
            &mut temp_json_buffer,
            true,
        )?;
        const SOURCE_MAP_URL_PREFIX_START: &[u8] =
            b"//# sourceMappingURL=data:application/json;base64,";
        // TODO: do we need to %-encode the path?
        let source_url_len = source.path.text.len();
        const SOURCE_MAPPING_URL: &[u8] = b"\n//# sourceURL=";
        let prefix_len =
            SOURCE_MAP_URL_PREFIX_START.len() + SOURCE_MAPPING_URL.len() + source_url_len;

        self.vm_source_mappings_mut()
            .put_mappings(source, chunk.buffer)?;

        // SAFETY: `printer` is the raw `*mut BufferPrinter` passed in by the
        // caller (jsc_hooks.rs), with the SAME provenance as the `writer` arg
        // to `print_with_source_map`. By the time `on_source_map_chunk` runs
        // (js_printer/lib.rs `print_ast` / `print_common_js` tail), the writer
        // has emitted its last byte; we reborrow from the raw pointer here
        // rather than from a stashed `&'a mut` so no Unique tag is held across
        // the writer's lifetime. The caller MUST rederive its own
        // `&mut BufferPrinter` from the raw pointer after
        // `print_with_source_map` returns (see jsc_hooks.rs). See
        // `printer_ptr()` for why this is not a `&mut`-returning accessor.
        let printer = unsafe { &mut *self.printer };

        let encode_len = bun_base64::encode_len(temp_json_buffer.list.as_slice());
        printer
            .ctx
            .buffer
            .grow_if_needed(encode_len + prefix_len + 2)?;
        // Zig: "\n" ++ source_map_url_prefix_start
        printer.ctx.buffer.append_assume_capacity(b"\n");
        printer
            .ctx
            .buffer
            .append_assume_capacity(SOURCE_MAP_URL_PREFIX_START);
        {
            // Zig wrote into `buffer.list.items.ptr[len..capacity]` then bumped
            // `items.len`. `MutableString::list` is a `Vec<u8>`; mirror that with
            // a spare-capacity write + `commit_spare`.
            let buf = &mut printer.ctx.buffer.list;
            // SAFETY: `grow_if_needed` reserved ≥encode_len spare; encode writes
            // `wrote<=encode_len` bytes.
            let wrote = unsafe {
                bun_base64::encode(
                    &mut bun_core::vec::spare_bytes_mut(buf)[..encode_len],
                    temp_json_buffer.list.as_slice(),
                )
            };
            unsafe { bun_core::vec::commit_spare(buf, wrote) };
        }
        printer
            .ctx
            .buffer
            .append_assume_capacity(SOURCE_MAPPING_URL);
        // TODO: do we need to %-encode the path?
        printer.ctx.buffer.append_assume_capacity(source.path.text);
        printer.ctx.buffer.append(b"\n")?;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// Options / IPC / per-thread printer — supporting types referenced by the
// impl below. Field set mirrors VirtualMachine.zig:1204 (`Options`) and
// :3899 (`IPCInstanceUnion` / `IPCInstance`).
// ──────────────────────────────────────────────────────────────────────────

/// Spec VirtualMachine.zig:1204 `Options`. `allocator` dropped per
/// §Allocators (global mimalloc).
pub struct Options {
    pub args: bun_options_types::schema::api::TransformOptions,
    pub log: Option<NonNull<bun_ast::Log>>,
    // TODO(port): lifetime — `&'a mut bun_dot_env::Loader`.
    pub env_loader: Option<NonNull<bun_dotenv::Loader<'static>>>,
    pub store_fd: bool,
    pub smol: bool,
    // TODO(b2-cycle): real type is `bun_runtime::api::dns::Resolver::Order`.
    pub dns_result_order: u8,
    /// `--print` needs the result from evaluating the main module.
    pub eval: bool,
    // PORT NOTE: layering — concrete `bun_standalone_graph::Graph` is in a
    // forward-dep crate; callers pass it as the resolver's trait object so
    // both VM and resolver can hold it without the cycle.
    pub graph: Option<&'static dyn bun_resolver::StandaloneModuleGraph>,
    // PORT NOTE: Zig `debugger: bun.cli.Command.Debugger` dropped — debugger
    // configuration is plumbed through `RuntimeHooks::ensure_debugger` (the
    // CLI option struct lives in `bun_cli`, a forward dep). See
    // `runtime/jsc_hooks.rs` for the spec :1321 `configureDebugger` call site.
    pub is_main_thread: bool,
    pub destruct_main_thread_on_exit: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            args: Default::default(),
            log: None,
            env_loader: None,
            store_fd: false,
            smol: false,
            dns_result_order: 0,
            eval: false,
            graph: None,
            is_main_thread: false,
            destruct_main_thread_on_exit: false,
        }
    }
}

/// Spec VirtualMachine.zig:3899 `IPCInstanceUnion`.
pub enum IPCInstanceUnion {
    /// IPC is put in this "enabled but not started" state when IPC is
    /// detected but the client JavaScript has not yet done `.on("message")`.
    Waiting {
        fd: bun_sys::Fd,
        mode: crate::ipc::Mode,
    },
    Initialized(*mut IPCInstance),
}

/// Spec VirtualMachine.zig:3909 `IPCInstance`.
pub struct IPCInstance {
    pub global_this: *mut JSGlobalObject,
    /// Embedded per-VM group on `RareData.spawn_ipc_group`; this is just a
    /// borrowed handle so the isolation swap can skip it.
    #[cfg(unix)]
    pub group: *mut uws::SocketGroup,
    #[cfg(not(unix))]
    pub group: (),
    pub data: crate::ipc::SendQueue,
    pub has_disconnect_called: bool,
}

impl IPCInstance {
    pub fn new(v: IPCInstance) -> *mut IPCInstance {
        bun_core::heap::into_raw(Box::new(v))
    }
    pub fn ipc(&mut self) -> Option<&mut crate::ipc::SendQueue> {
        Some(&mut self.data)
    }
    pub fn get_global_this(&self) -> Option<*mut JSGlobalObject> {
        Some(self.global_this)
    }
    /// Only reached from the `get_ipc_instance` error path.
    pub fn deinit(this: *mut IPCInstance) {
        // SAFETY: `this` was produced by `IPCInstance::new` (heap::alloc).
        // `SendQueue` cleans itself up via `Drop`.
        drop(unsafe { bun_core::heap::take(this) });
    }

    /// Spec VirtualMachine.zig:3940 `IPCInstance.handleIPCMessage`.
    pub fn handle_ipc_message(&mut self, message: crate::ipc::DecodedIPCMessage, handle: JSValue) {
        crate::mark_binding!();
        let global_this = self.global_this;
        // SAFETY: VM singleton + its event loop are process-lifetime.
        let event_loop = VirtualMachine::get().event_loop_mut();

        match message {
            // In future versions we can read this in order to detect version mismatches,
            // or disable future optimizations if the subprocess is old.
            crate::ipc::DecodedIPCMessage::Version(v) => {
                bun_core::scoped_log!(IPC, "Parent IPC version is {}", v);
            }
            crate::ipc::DecodedIPCMessage::Data(data) => {
                bun_core::scoped_log!(IPC, "Received IPC message from parent");
                event_loop.enter();
                // `global_this` is the live VM global; `JSGlobalObject` is an
                // opaque ZST handle so `opaque_ref` is the centralised
                // zero-byte deref proof (panics on null).
                Process__emitMessageEvent(JSGlobalObject::opaque_ref(global_this), data, handle);
                event_loop.exit();
            }
            crate::ipc::DecodedIPCMessage::Internal(data) => {
                bun_core::scoped_log!(IPC, "Received IPC internal message from parent");
                event_loop.enter();
                if let Some(hooks) = runtime_hooks() {
                    // SAFETY: hook fn is supplied by `bun_runtime` at startup;
                    // `global_this` is the live VM global.
                    unsafe { (hooks.handle_ipc_internal_child)(global_this, data) };
                }
                event_loop.exit();
            }
        }
    }

    /// Spec VirtualMachine.zig:3966 `IPCInstance.handleIPCClose`.
    pub fn handle_ipc_close(&mut self) {
        bun_core::scoped_log!(IPC, "IPCInstance#handleIPCClose");
        // SAFETY: VM singleton is process-lifetime.
        let vm = VirtualMachine::get().as_mut();
        let event_loop = vm.event_loop_mut();
        if let Some(hooks) = runtime_hooks() {
            (hooks.ipc_child_singleton_deinit)();
        }
        event_loop.enter();
        Process__emitDisconnectEvent(vm.global());
        event_loop.exit();
        // Group is embedded in RareData and shared with subprocess IPC; nothing
        // to free here.
        vm.channel_ref.disable();
    }
}

// `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle, so
// `&JSGlobalObject` is ABI-identical to a non-null `JSGlobalObject*` and C++
// mutating VM/process state through it is interior mutation invisible to Rust.
unsafe extern "C" {
    safe fn Process__emitMessageEvent(global: &JSGlobalObject, value: JSValue, handle: JSValue);
    safe fn Process__emitDisconnectEvent(global: &JSGlobalObject);
}

/// `IPC.SendQueue` owner dispatch for the child-side `IPCInstance`. Mirrors
/// the `Subprocess` impl in `bun_runtime`; lives here because `IPCInstance`
/// itself is defined in this crate.
impl crate::ipc::SendQueueOwner for IPCInstance {
    fn global_this(&self) -> *const JSGlobalObject {
        self.global_this
    }
    fn handle_ipc_close(&mut self) {
        IPCInstance::handle_ipc_close(self)
    }
    fn handle_ipc_message(&mut self, msg: crate::ipc::DecodedIPCMessage, handle: JSValue) {
        IPCInstance::handle_ipc_message(self, msg, handle)
    }
    /// VM-side owner has no JS-visible `this` (Zig: `.null` arm).
    fn this_jsvalue(&self) -> JSValue {
        JSValue::ZERO
    }
    fn kind(&self) -> crate::ipc::SendQueueOwnerKind {
        crate::ipc::SendQueueOwnerKind::VirtualMachine
    }
}

/// Spec VirtualMachine.zig:1708 `ResolveFunctionResult`.
#[derive(Default)]
pub struct ResolveFunctionResult {
    pub result: Option<bun_resolver::Result>,
    pub path: &'static [u8], // TODO(port): lifetime — borrows resolver arena
    pub query_string: &'static [u8],
}

/// Spec VirtualMachine.zig:1584 `source_code_printer`.
#[thread_local]
pub static SOURCE_CODE_PRINTER: Cell<Option<NonNull<bun_js_printer::BufferPrinter>>> =
    Cell::new(None);

/// Spec VirtualMachine.zig:1712 `normalizeSpecifierForResolution`.
fn normalize_specifier_for_resolution<'a>(
    specifier_: &'a [u8],
    query_string: &mut &'a [u8],
) -> &'a [u8] {
    if let Some(i) = bun_core::index_of_char(specifier_, b'?') {
        let i = i as usize;
        *query_string = &specifier_[i..];
        &specifier_[..i]
    } else {
        specifier_
    }
}

/// Spec VirtualMachine.zig:1722 `specifier_cache_resolver_bufs` (bun.ThreadlocalBuffers —
/// heap-backed so only a pointer lives in TLS; see test/js/bun/binary/tls-segment-size).
#[thread_local]
static SPECIFIER_CACHE_RESOLVER_BUF: core::cell::Cell<*mut bun_paths::PathBuffer> =
    core::cell::Cell::new(core::ptr::null_mut());

#[inline]
fn specifier_cache_resolver_buf() -> *mut bun_paths::PathBuffer {
    let mut p = SPECIFIER_CACHE_RESOLVER_BUF.get();
    if p.is_null() {
        p = bun_core::heap::into_raw(Box::new(bun_paths::PathBuffer::ZEROED));
        SPECIFIER_CACHE_RESOLVER_BUF.set(p);
    }
    p
}

fn ensure_source_code_printer() {
    if SOURCE_CODE_PRINTER.get().is_none() {
        let writer = bun_js_printer::BufferWriter::init();
        let mut printer = Box::new(bun_js_printer::BufferPrinter::init(writer));
        printer.ctx.append_null_byte = false;
        SOURCE_CODE_PRINTER.set(NonNull::new(bun_core::heap::into_raw(printer)));
    }
}

fn normalize_source(source: &[u8]) -> &[u8] {
    if let Some(rest) = source.strip_prefix(b"file://") {
        return rest;
    }
    source
}

/// `bun.String.createIfDifferent` — `clone_utf8(other)` unless `other` is
/// byte-equal to `s`, in which case bump `s`'s refcount instead.
#[inline]
pub fn create_if_different(s: &bun_core::String, other: &[u8]) -> bun_core::String {
    if s.eql_utf8(other) {
        return s.dupe_ref();
    }
    bun_core::String::clone_utf8(other)
}

// Additional FFI used by the formerly-gated impl.
// C++ side defines `extern "C" SYSV_ABI` (BakeAdditionsToGlobalObject.cpp).
//
// safe: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle; `&` is
// ABI-identical to a non-null `JSGlobalObject*` and C++ mutating VM state
// through it is interior to the cell.
crate::jsc_abi_extern! {
    #[allow(improper_ctypes)]
    safe fn Bake__getAsyncLocalStorage(global: &JSGlobalObject) -> JSValue;
}
// `JSGlobalObject` / `VM` are opaque `UnsafeCell`-backed ZST handles, so
// `&T` is ABI-identical to a non-null `T*`. `BakeCreateProdGlobal`'s
// `console_ptr` is an opaque round-trip pointer C++ stores into the new global
// (never dereferenced as Rust data) — same contract as `Zig__GlobalObject__create`.
#[allow(improper_ctypes)]
unsafe extern "C" {
    safe fn Bun__promises__isErrorLike(global: &JSGlobalObject, reason: JSValue) -> bool;
    safe fn Bun__promises__emitUnhandledRejectionWarning(
        global: &JSGlobalObject,
        reason: JSValue,
        promise: JSValue,
    );
    safe fn Bun__noSideEffectsToString(
        vm: &VM,
        global: &JSGlobalObject,
        reason: JSValue,
    ) -> JSValue;
    safe fn BakeCreateProdGlobal(console_ptr: *mut c_void) -> *mut JSGlobalObject;
}

extern "C" fn free_ref_string(str_: *mut crate::ref_string::RefString, _: *mut c_void, _: usize) {
    // SAFETY: `str_` is the `ctx` we passed to `String::create_external` in
    // `ref_counted_string_with_was_new`; it points at a heap `RefString`.
    unsafe { crate::ref_string::RefString::destroy(str_) };
}

impl VirtualMachine {
    /// Spec VirtualMachine.zig:234 `getDevServerAsyncLocalStorage`.
    pub fn get_dev_server_async_local_storage(&mut self) -> JsResult<Option<JSValue>> {
        let global_ref = self.global();
        let jsvalue =
            jsc::from_js_host_call(global_ref, || Bake__getAsyncLocalStorage(global_ref))?;
        if jsvalue.is_empty_or_undefined_or_null() {
            return Ok(None);
        }
        Ok(Some(jsvalue))
    }

    /// Spec VirtualMachine.zig:245 `allowAddons` (`callconv(.c)`).
    #[unsafe(export_name = "Bun__VM__allowAddons")]
    pub extern "C" fn allow_addons(this: &VirtualMachine) -> bool {
        this.transpiler
            .options
            .transform_options
            .allow_addons
            .unwrap_or(true)
    }

    /// Spec VirtualMachine.zig:248 `allowRejectionHandledWarning` (`callconv(.c)`).
    #[unsafe(export_name = "Bun__VM__allowRejectionHandledWarning")]
    pub extern "C" fn allow_rejection_handled_warning(this: &VirtualMachine) -> bool {
        use bun_options_types::schema::api::UnhandledRejections;
        this.unhandled_rejections_mode() != UnhandledRejections::Bun
    }

    /// Spec VirtualMachine.zig:251 `unhandledRejectionsMode`.
    pub fn unhandled_rejections_mode(&self) -> bun_options_types::schema::api::UnhandledRejections {
        use bun_options_types::schema::api::UnhandledRejections;
        self.transpiler
            .options
            .transform_options
            .unhandled_rejections
            .unwrap_or(UnhandledRejections::Bun)
    }

    /// Spec VirtualMachine.zig:255 `initRequestBodyValue`.
    ///
    /// `body` is a `*mut bun_runtime::webcore::Body::Value`; the returned
    /// pointer is a `*mut Body::Value::HiveRef`. Both types live in the
    /// higher `bun_runtime` tier (forward-dep on `bun_jsc`), so they're
    /// type-erased here and dispatched through [`RuntimeHooks`]. Callers in
    /// `bun_runtime` cast back.
    pub fn init_request_body_value(&mut self, body: *mut c_void) -> *mut c_void {
        let hooks = runtime_hooks().expect("runtime hooks not installed");
        // SAFETY: hook contract — `body` is a `Body::Value` allocated by the
        // same `bun_runtime` build that registered the hook; `self` is the
        // live per-thread VM (which owns the hive allocator inside
        // `runtime_state`).
        unsafe { (hooks.init_request_body_value)(self, body) }
    }

    /// Spec VirtualMachine.zig:279 `uvLoop`.
    pub fn uv_loop(&self) -> *mut Async::Loop {
        #[cfg(debug_assertions)]
        {
            return self
                .event_loop_handle
                .expect("libuv event_loop_handle is null");
        }
        #[cfg(not(debug_assertions))]
        {
            self.event_loop_handle.unwrap()
        }
    }

    /// Spec VirtualMachine.zig:298 `getTLSRejectUnauthorized`.
    pub fn get_tls_reject_unauthorized(&self) -> bool {
        if let Some(v) = self.default_tls_reject_unauthorized {
            return v;
        }
        self.transpiler.env_mut().get_tls_reject_unauthorized()
    }

    /// Spec VirtualMachine.zig:302 `onSubprocessSpawn`.
    pub fn on_subprocess_spawn(&mut self, process: *mut bun_spawn::Process) {
        self.auto_killer.on_subprocess_spawn(process);
    }

    /// Spec VirtualMachine.zig:306 `onSubprocessExit`.
    pub fn on_subprocess_exit(&mut self, process: *mut bun_spawn::Process) {
        self.auto_killer.on_subprocess_exit(process);
    }

    /// Spec VirtualMachine.zig:310 `getVerboseFetch`.
    pub fn get_verbose_fetch(&mut self) -> bun_http::HTTPVerboseLevel {
        use bun_http::HTTPVerboseLevel as L;
        if let Some(v) = self.default_verbose_fetch {
            // PORT NOTE: field is `Option<u8>` until the b2-cycle widens it;
            // map ordinals back.
            return match v {
                1 => L::Headers,
                2 => L::Curl,
                _ => L::None,
            };
        }
        // SAFETY: `transpiler.env` is set during init and live for VM lifetime.
        if let Some(verbose_fetch) = self.env_loader().get(b"BUN_CONFIG_VERBOSE_FETCH") {
            if verbose_fetch == b"true" || verbose_fetch == b"1" {
                self.default_verbose_fetch = Some(1);
                return L::Headers;
            } else if verbose_fetch == b"curl" {
                self.default_verbose_fetch = Some(2);
                return L::Curl;
            }
        }
        self.default_verbose_fetch = Some(0);
        L::None
    }

    /// Spec VirtualMachine.zig:369 `mimeType`.
    pub fn mime_type(&mut self, str_: &[u8]) -> Option<bun_http::MimeType::MimeType> {
        self.rare_data().mime_type_from_string(str_)
    }

    /// Spec VirtualMachine.zig:498 `loadExtraEnvAndSourceCodePrinter`.
    pub fn load_extra_env_and_source_code_printer(&mut self) {
        // `Transpiler::env_mut()` encapsulates the raw-ptr deref; the returned
        // `&'static mut Loader` is independent of `&self`, so `map` may be held
        // across the `&mut self` writes below.
        let env = self.transpiler.env_mut();
        let map = &mut *env.map;

        ensure_source_code_printer();

        if map.get(b"BUN_SHOW_BUN_STACKFRAMES").is_some() {
            self.hide_bun_stackframes = false;
        }

        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER::get()
            .unwrap_or(false)
        {
            self.transpiler_store.enabled = false;
        }

        if let Some(idx) = map.map.get_index(b"NODE_CHANNEL_FD") {
            let (_, kv) = map.map.swap_remove_at(idx);
            let fd_s = kv.value;
            let mode = map
                .map
                .get_index(b"NODE_CHANNEL_SERIALIZATION_MODE")
                .map(|i| map.map.swap_remove_at(i).1)
                .and_then(|v| crate::ipc::Mode::from_string(&v.value))
                .unwrap_or(crate::ipc::Mode::Json);
            // PORT NOTE: Zig `IPC.log()` debug-only; the `IPC` scope static
            // lives in `crate::ipc` and `scoped_log!` requires a bare ident,
            // so the log line is dropped here.
            // Spec: `std.fmt.parseInt(u31, fd_s, 10)` — accept only
            // non-negative values that fit in i31 (i.e. `0..=i32::MAX`).
            // Parsing as `u32` then `as i32` would silently wrap values in
            // `2^31..2^32` to a negative fd instead of taking the warn branch.
            match bun_core::fmt::parse_int::<i32>(&fd_s, 10)
                .ok()
                .filter(|&n| n >= 0)
            {
                Some(fd) => self.init_ipc_instance(bun_sys::Fd::from_uv(fd), mode),
                None => bun_core::warn!(
                    "Failed to parse IPC channel number '{}'",
                    bstr::BStr::new(&fd_s[..])
                ),
            }
        }

        // Node.js checks if this is set to "1" and no other value
        if let Some(value) = map.get(b"NODE_PRESERVE_SYMLINKS") {
            self.transpiler.resolver.opts.preserve_symlinks = value == b"1";
        }

        if let Some(gc_level) = map.get(b"BUN_GARBAGE_COLLECTOR_LEVEL") {
            // Reuse this flag for other things to avoid unnecessary hashtable
            // lookups on start for obscure flags which we do not want others to
            // depend on.
            if map.get(b"BUN_FEATURE_FLAG_FORCE_WAITER_THREAD").is_some() {
                bun_spawn::process::WaiterThread::set_should_use_waiter_thread();
            }
            // Only allowed for testing
            if map.get(b"BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING").is_some() {
                ModuleLoader::set_is_allowed_to_use_internal_testing_apis(true);
            }
            if gc_level == b"1" {
                self.aggressive_garbage_collection = GCLevel::Mild;
                has_bun_garbage_collector_flag_enabled
                    .store(true, core::sync::atomic::Ordering::Relaxed);
            } else if gc_level == b"2" {
                self.aggressive_garbage_collection = GCLevel::Aggressive;
                has_bun_garbage_collector_flag_enabled
                    .store(true, core::sync::atomic::Ordering::Relaxed);
            }
            if let Some(value) = map.get(b"BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT") {
                match bun_core::fmt::parse_int::<usize>(value, 10).ok() {
                    Some(limit) => {
                        SYNTHETIC_ALLOCATION_LIMIT
                            .store(limit, core::sync::atomic::Ordering::Relaxed);
                        STRING_ALLOCATION_LIMIT.store(limit, core::sync::atomic::Ordering::Relaxed);
                    }
                    None => bun_core::Output::panic(format_args!(
                        "BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT must be a positive integer"
                    )),
                }
            }
        }
    }

    /// Spec VirtualMachine.zig:595 `unhandledRejection`.
    pub fn unhandled_rejection(
        &mut self,
        global_object: &JSGlobalObject,
        reason: JSValue,
        promise: JSValue,
    ) {
        use bun_options_types::schema::api::UnhandledRejections as Mode;

        if self.is_shutting_down() {
            bun_core::debug_warn!("unhandledRejection during shutdown.");
            return;
        }

        if isBunTest.load(core::sync::atomic::Ordering::Relaxed) {
            self.unhandled_error_counter += 1;
            (self.on_unhandled_rejection)(self, global_object, reason);
            return;
        }

        // PORT NOTE: Zig `defer eventLoop().drainMicrotasks()` per-arm —
        // hoisted into a closure.
        let drain = |this: &mut Self| {
            let _ = this.event_loop_mut().drain_microtasks();
        };
        // Wrapper over the `Bun__handleUnhandledRejection` FFI call (returns
        // whether a JS handler claimed it). Captures `global_object` / `reason`
        // / `promise` so the six branches below stay concise.
        let handle_unhandled =
            || -> bool { Bun__handleUnhandledRejection(global_object, reason, promise) > 0 };
        let emit_warning = |this: &mut Self| {
            let r = jsc::from_js_host_call_generic(global_object, || {
                Bun__promises__emitUnhandledRejectionWarning(global_object, reason, promise)
            });
            if let Err(e) = r {
                let exc = global_object.take_exception(e);
                // PORT NOTE: Zig went `exc.asException(vm)` → `reportUncaughtException`,
                // which itself just does `uncaughtException(global, exception.value(), false)`.
                // `JSValue::as_exception` is not yet ported; inline the body — `exc` is
                // already the exception's value.
                let _ = this.uncaught_exception(global_object, exc, false);
            }
        };

        match self.unhandled_rejections_mode() {
            Mode::Bun => {
                if handle_unhandled() {
                    return;
                }
                // continue to default handler
            }
            Mode::None => {
                let _ = handle_unhandled();
                drain(self);
                return; // ignore the unhandled rejection
            }
            Mode::Warn => {
                let _ = handle_unhandled();
                emit_warning(self);
                drain(self);
                return;
            }
            Mode::WarnWithErrorCode => {
                let handled = handle_unhandled();
                if !handled {
                    emit_warning(self);
                    self.exit_handler.exit_code = 1;
                }
                drain(self);
                if handled {
                    return;
                }
                // PORT NOTE: Zig returned unconditionally after warn; mirror it.
                return;
            }
            Mode::Strict => {
                let wrapped =
                    wrap_unhandled_rejection_error_for_uncaught_exception(global_object, reason);
                let _ = self.uncaught_exception(global_object, wrapped, true);
                let handled = handle_unhandled();
                if !handled {
                    emit_warning(self);
                }
                drain(self);
                return;
            }
            Mode::Throw => {
                if handle_unhandled() {
                    drain(self);
                    return;
                }
                let wrapped =
                    wrap_unhandled_rejection_error_for_uncaught_exception(global_object, reason);
                if self.uncaught_exception(global_object, wrapped, true) {
                    drain(self);
                    return;
                }
                // continue to default handler — but spec VirtualMachine.zig
                // :667-669 RETURNS on `error.JSTerminated` from this drain
                // (the VM is dead; don't bump the counter or invoke the
                // handler).
                if self.event_loop_mut().drain_microtasks().is_err() {
                    return;
                }
            }
        }
        self.unhandled_error_counter += 1;
        (self.on_unhandled_rejection)(self, global_object, reason);
    }

    /// Spec VirtualMachine.zig:718 `reportExceptionInHotReloadedModuleIfNeeded`.
    pub fn report_exception_in_hot_reloaded_module_if_needed(&mut self) {
        // PORT NOTE: Zig `defer this.addMainToWatcherIfNeeded()`.
        let promise = match self.pending_internal_promise {
            Some(p) => p,
            None => {
                self.add_main_to_watcher_if_needed();
                return;
            }
        };
        // SAFETY: `promise` is a live JSC heap cell tracked by the VM.
        match crate::JSPromise::status_ptr(promise) {
            crate::js_promise::Status::Pending => {
                self.add_main_to_watcher_if_needed();
                return;
            }
            crate::js_promise::Status::Rejected => {
                if self.pending_internal_promise_reported_at != self.hot_reload_counter {
                    self.pending_internal_promise_reported_at = self.hot_reload_counter;
                    // `global()` is `&'static`, so it survives the `&mut self`
                    // call below.
                    let global_ref = self.global();
                    // `JSPromise` is an `opaque_ffi!` ZST handle; `opaque_mut`
                    // is the centralised non-null deref proof (live JSC heap
                    // cell tracked by the VM's strong-ref slot).
                    let result = crate::JSPromise::opaque_mut(promise).result(global_ref.vm());
                    let promise_js = JSValue::from_cell(promise);
                    self.unhandled_rejection(global_ref, result, promise_js);
                    crate::JSPromise::opaque_mut(promise).set_handled();
                }
            }
            crate::js_promise::Status::Fulfilled => {}
        }

        if self.hot_reload_deferred {
            self.reload(None);
        }
        self.add_main_to_watcher_if_needed();
    }

    /// Spec VirtualMachine.zig:737 `addMainToWatcherIfNeeded`.
    pub fn add_main_to_watcher_if_needed(&mut self) {
        if !self.is_watcher_enabled() {
            return;
        }
        let main = self.main();
        if main.is_empty() {
            return;
        }
        let ext = bun_paths::extension(main);
        let loader = self.transpiler.options.loader(ext);
        let watcher = self.bun_watcher_ptr();
        if !watcher.is_null() {
            // SAFETY: `bun_watcher` is a live `Box<ImportWatcher>` leaked in
            // `enable_hot_module_reloading`. The pointee is shared with the
            // file-watcher thread (see `bun_watcher_ptr` doc) — the enum
            // discriminant is write-once at install and read-only thereafter,
            // and `add_file_by_path_slow` serializes the inner watchlist write
            // via `Watcher.mutex`. Borrow is scoped to this single
            // mutex-guarded call (Zig spec uses alias-allowed `*Watcher`).
            let _ = unsafe { (*watcher).add_file_by_path_slow(main, loader) };
        }
    }

    /// Spec VirtualMachine.zig:751 `packageManager`.
    ///
    /// `bun_resolver` holds the manager as an opaque forward-decl (it cannot
    /// depend on `bun_install`). `bun_jsc` *can*, so cast the opaque back to
    /// the concrete `bun_install::PackageManager` here — the resolver's
    /// `PackageManager` is exactly that struct, just type-erased at a lower
    /// tier.
    #[inline]
    pub fn package_manager(&mut self) -> &mut bun_install::PackageManager {
        let pm = self.transpiler.get_package_manager();
        // SAFETY: `bun_resolver::package_json::PackageManager` is an opaque
        // forward-decl of `bun_install::PackageManager`; the pointer was
        // produced by `PackageManager::init_with_runtime` (the install crate)
        // and only ever names that one type.
        unsafe { &mut *pm.cast::<bun_install::PackageManager>() }
    }

    /// Spec VirtualMachine.zig:769 `reload`.
    pub fn reload(&mut self, _: Option<&mut crate::hot_reloader::HotReloadTask>) {
        if let Some(p) = self.pending_internal_promise {
            // SAFETY: `p` is a live JSC heap cell tracked by the VM.
            match crate::JSPromise::status_ptr(p) {
                crate::js_promise::Status::Pending => {
                    self.hot_reload_deferred = true;
                    return;
                }
                crate::js_promise::Status::Rejected => {
                    if self.pending_internal_promise_reported_at != self.hot_reload_counter {
                        self.hot_reload_deferred = true;
                        return;
                    }
                }
                crate::js_promise::Status::Fulfilled => {}
            }
        }
        self.hot_reload_deferred = false;

        bun_core::debug!("Reloading...");
        let should_clear_terminal = !self
            .env_loader()
            .has_set_no_clear_terminal_on_reload(!bun_core::Output::enable_ansi_colors_stdout());
        if self.hot_reload == HOT_RELOAD_WATCH {
            bun_core::Output::flush();
            bun_core::reload_process(should_clear_terminal, false);
        }

        if should_clear_terminal {
            bun_core::Output::flush();
            bun_core::Output::disable_buffering();
            bun_core::Output::reset_terminal_all();
            bun_core::Output::enable_buffering();
        }

        if let Some(hooks) = runtime_hooks() {
            // The hook walks the VM's cron-job list and detaches each job from
            // the old global so the new global can re-register them post-reload.
            (hooks.cron_clear_all_reload)(self);
        }
        // `JSGlobalObject::reload` drains microtasks + collects async + clears
        // the JSC module loader registry.
        self.global().reload().expect("Failed to reload");
        self.hot_reload_counter += 1;
        if self.pending_internal_promise_is_protected {
            if let Some(p) = self.pending_internal_promise {
                JSValue::from_cell(p).unprotect();
            }
            self.pending_internal_promise_is_protected = false;
        }
        // reload_entry_point() stores into pending_internal_promise on every return path.
        let main = self.main;
        // PORT NOTE: reshaped for borrowck — copy the `RawSlice` first to avoid
        // overlapping `&self`/`&mut self` borrows.
        if self.reload_entry_point(main.slice()).is_err() {
            panic!("Failed to reload");
        }
    }

    /// Spec VirtualMachine.zig:827 `nodeFS`.
    ///
    /// `NodeFS` lives in `bun_runtime` (forward-dep on `bun_jsc`), so the
    /// field is stored type-erased and the lazy boxed allocation goes through
    /// [`RuntimeHooks::create_node_fs`]. Callers in `bun_runtime` cast the
    /// returned pointer back to `*mut node::fs::NodeFS`.
    #[inline]
    pub fn node_fs(&mut self) -> *mut c_void {
        if let Some(existing) = self.node_fs {
            return existing;
        }
        let hooks = runtime_hooks().expect("runtime hooks not installed");
        // SAFETY: hook contract — `self` is the live per-thread VM. The hook
        // boxes a `NodeFS{ vm: self if standalone else null }` and returns
        // the leaked pointer.
        let new = unsafe { (hooks.create_node_fs)(self) };
        self.node_fs = Some(new);
        new
    }

    /// Spec VirtualMachine.zig:998 `nextAsyncTaskID`.
    pub fn next_async_task_id(&mut self) -> u64 {
        let Some(debugger) = self.debugger.as_deref_mut() else {
            return 0;
        };
        debugger.next_debugger_id = debugger.next_debugger_id.wrapping_add(1);
        debugger.next_debugger_id
    }

    /// Spec VirtualMachine.zig:1016 `enqueueImmediateTask`.
    ///
    /// PORT NOTE (§Dispatch): `task` is an erased
    /// `*mut bun_runtime::timer::ImmediateObject` — see
    /// [`crate::event_loop::RunImmediateFn`].
    #[inline]
    pub fn enqueue_immediate_task(&mut self, task: *mut ()) {
        self.event_loop_mut().enqueue_immediate_task(task);
    }

    /// Spec VirtualMachine.zig:1020 `enqueueTaskConcurrent`.
    #[inline]
    pub fn enqueue_task_concurrent(&mut self, task: *mut crate::event_loop::ConcurrentTaskItem) {
        self.event_loop_mut().enqueue_task_concurrent(task);
    }

    /// Spec VirtualMachine.zig:1028 `waitFor`.
    ///
    /// `cond` is `&Cell<bool>` (not `&mut bool`): the re-entrant
    /// `tick()/auto_tick()` calls run JS that flips the flag through an
    /// independently-captured handle, so the read must not be `noalias`.
    /// `Cell` is `!Freeze`, which suppresses the LLVM `noalias`/`readonly`
    /// attributes and forces a real reload on every `.get()` — no raw-pointer
    /// laundering needed for the condition.
    pub fn wait_for(&mut self, cond: &core::cell::Cell<bool>) {
        // R-2 noalias mitigation (PORT_NOTES_PLAN R-2; precedent
        // `b818e70e1c57` NodeHTTPResponse::cork): `&mut self` is
        // LLVM-`noalias`, but `tick()/auto_tick()` re-enter JS which reaches
        // `self` again via `VirtualMachine::get()`. Launder `self` so each
        // access goes through an opaque address.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // SAFETY: `this` is the unique live VM; each deref is a momentary
        // access only (no borrow held across the re-entrant call).
        while !cond.get() {
            unsafe { (*this).event_loop_mut().tick() };
            if !cond.get() {
                unsafe { (*this).auto_tick() };
            }
        }
    }

    /// Spec VirtualMachine.zig:1042 `waitForTasks`.
    pub fn wait_for_tasks(&mut self) {
        while self.is_event_loop_alive() {
            self.event_loop_mut().tick();
            if self.is_event_loop_alive() {
                self.auto_tick();
            }
        }
    }

    /// Spec VirtualMachine.zig:1107 `initWithModuleGraph`.
    ///
    /// PORT NOTE: shares ~90% with [`init`]; the differences are (a) the
    /// transpiler is built without `Config::configureTransformOptionsForBunVM`,
    /// (b) `standalone_module_graph` is mandatory and propagated into the
    /// resolver, (c) `configureLinkerWithAutoJSX(false)` instead of
    /// `configureLinker()`. Rather than re-open-code the 80-line struct init,
    /// we route through [`init`] and patch the deltas.
    pub fn init_with_module_graph(opts: Options) -> Result<*mut VirtualMachine, bun_core::Error> {
        let graph = opts.graph.expect("init_with_module_graph requires graph");
        let init_opts = InitOptions {
            transform_options: opts.args,
            graph: Some(graph),
            log: opts.log,
            env_loader: opts.env_loader,
            smol: opts.smol,
            mini_mode: opts.smol,
            eval_mode: false,
            is_main_thread: opts.is_main_thread,
            ..Default::default()
        };
        let vm = Self::init(init_opts)?;
        // SAFETY: `vm` is the unique live VM on this thread.
        let vm_ref = unsafe { &mut *vm };
        vm_ref.transpiler.resolver.standalone_module_graph = Some(graph);
        // Avoid reading from tsconfig.json & package.json when in standalone mode
        vm_ref.transpiler.configure_linker_with_auto_jsx(false);
        vm_ref.transpiler.resolver.store_fd = false;
        IS_SMOL_MODE.store(opts.smol, core::sync::atomic::Ordering::Relaxed);
        Ok(vm)
    }

    /// Spec VirtualMachine.zig:1394 `initWorker`.
    ///
    /// PORT NOTE: takes `&WebWorker` (not `&mut`) — the worker thread may only
    /// hold a shared reference to its `WebWorker` (the parent / main thread
    /// concurrently observes it; see `web_worker.rs` worker-thread `&self`
    /// note). All accesses on `worker` here are read-only.
    pub fn init_worker(
        worker: &crate::web_worker::WebWorker,
        opts: Options,
    ) -> Result<*mut VirtualMachine, bun_core::Error> {
        let init_opts = InitOptions {
            transform_options: opts.args,
            graph: opts.graph,
            log: opts.log,
            env_loader: opts.env_loader,
            store_fd: opts.store_fd,
            smol: opts.smol,
            eval_mode: opts.eval,
            is_main_thread: false,
            // Spec VirtualMachine.zig:1477-1484 — `JSGlobalObject.create` is
            // called with `worker.cpp_worker`, `worker.execution_context_id`,
            // and `worker.mini` so the C++ ZigGlobalObject is born with its
            // WorkerGlobalScope + debugger context id wired.
            worker_ptr: worker.cpp_worker(),
            context_id: Some(worker.execution_context_id() as i32),
            mini_mode: worker.mini(),
            ..Default::default()
        };
        // PORT NOTE: Zig open-coded the full struct init; we route through
        // [`init`] (which already wires console / event-loop / global / jsc_vm
        // / RuntimeHooks) and then patch the worker-specific fields.
        let vm = Self::init(init_opts)?;
        // SAFETY: `vm` is the unique live VM on this thread.
        let vm_ref = unsafe { &mut *vm };
        vm_ref.worker = Some(std::ptr::from_ref::<crate::web_worker::WebWorker>(worker).cast());
        // `parent_vm()` is a `BackRef`; the parent outlives this worker while
        // `parent_poll_ref` is held (see web_worker.rs file header).
        let parent = worker.parent_vm();
        vm_ref.standalone_module_graph = parent.standalone_module_graph;
        // Spec VirtualMachine.zig:1465 `initWorker` — the worker's resolver also
        // needs the standalone graph, otherwise embedded `/$bunfs/...` specifiers
        // (e.g. a `new Worker("./worker.ts")` entry point inside a compiled
        // executable) resolve against the real filesystem and fail.
        vm_ref.transpiler.resolver.standalone_module_graph = opts.graph;
        vm_ref.hot_reload = parent.hot_reload;
        vm_ref.initial_script_execution_context_identifier = worker.execution_context_id() as i32;
        vm_ref.transpiler.resolver.store_fd = opts.store_fd;
        if opts.graph.is_none() {
            vm_ref.transpiler.configure_linker();
        } else {
            vm_ref.transpiler.configure_linker_with_auto_jsx(false);
        }
        Ok(vm)
    }

    /// Spec VirtualMachine.zig:1495 `initBake`.
    pub fn init_bake(opts: Options) -> Result<*mut VirtualMachine, bun_core::Error> {
        let init_opts = InitOptions {
            transform_options: opts.args,
            log: opts.log,
            env_loader: opts.env_loader,
            smol: opts.smol,
            mini_mode: opts.smol,
            eval_mode: false,
            is_main_thread: opts.is_main_thread,
            ..Default::default()
        };
        // PORT NOTE: shares the console / log / event-loop wiring with `init`;
        // the only delta is the global is created via `BakeCreateProdGlobal`
        // instead of `ZigGlobalObject__create`. Route through `init` then
        // swap the global.
        let vm = Self::init(init_opts)?;
        // SAFETY: `vm` is the unique live VM on this thread.
        let vm_ref = unsafe { &mut *vm };
        // `console` is the opaque round-trip pointer C++ stores into the new global.
        let new_global = BakeCreateProdGlobal(vm_ref.console.cast());
        vm_ref.global = new_global;
        VMHolder::set_cached_global_object(Some(new_global));
        vm_ref.regular_event_loop.global = NonNull::new(new_global);
        // `new_global` is freshly created and live for VM lifetime; safe
        // ZST-handle deref. `vm_ptr()` returns the FFI `*mut VM` directly
        // (no `&VM` reborrow).
        vm_ref.jsc_vm = JSGlobalObject::opaque_ref(new_global).vm_ptr();
        // SAFETY: per-thread uws loop is live.
        unsafe { (*uws::Loop::get()).internal_loop_data.jsc_vm = vm_ref.jsc_vm.cast() };
        vm_ref.event_loop_mut().ensure_waker();
        if opts.smol {
            // SAFETY: process-global written once at startup.
            IS_SMOL_MODE.store(true, core::sync::atomic::Ordering::Relaxed);
        }
        Ok(vm)
    }

    /// Spec VirtualMachine.zig:1586 `clearRefString`.
    ///
    /// Stored as [`RefString::on_before_deinit`] (an unsafe-fn-ptr slot) in
    /// [`ref_counted_string_with_was_new`]; only ever invoked from
    /// `RefString::destroy` with the live `*mut RefString` being torn down.
    fn clear_ref_string(_: *mut c_void, ref_string: *mut crate::ref_string::RefString) {
        // SAFETY: only reachable via `RefString::destroy`, which passes the
        // live heap `RefString` allocated in `ref_counted_string_with_was_new`;
        // safe-fn coerces to the unsafe-fn-ptr `Callback` slot type.
        let hash = unsafe { &*ref_string }.hash;
        // SAFETY: `get()` is the live per-thread VM.
        VirtualMachine::get().as_mut().ref_strings.remove(&hash);
    }

    /// Spec VirtualMachine.zig:1590 `refCountedResolvedSource`.
    pub fn ref_counted_resolved_source<const ADD_DOUBLE_REF: bool>(
        &mut self,
        code: &[u8],
        specifier: bun_core::String,
        source_url: &[u8],
        hash_: Option<u32>,
    ) -> ResolvedSource {
        // refCountedString will panic if the code is empty
        if code.is_empty() {
            return ResolvedSource {
                source_code: bun_core::String::init(b""),
                specifier,
                source_url: create_if_different(&specifier, source_url),
                source_code_needs_deref: false,
                ..Default::default()
            };
        }
        // PORT NOTE: Zig `refCountedString(code, hash_, !add_double_ref)` —
        // const-generic bool can't be `!ADD_DOUBLE_REF`, so branch.
        let source = if ADD_DOUBLE_REF {
            self.ref_counted_string::<false>(code, hash_)
        } else {
            self.ref_counted_string::<true>(code, hash_)
        };
        // SAFETY: `ref_counted_string` returns a live `*mut RefString` held in
        // `self.ref_strings`; we own +1 (or +3 below) until JSC calls the
        // external-string finalizer.
        let source_ref = unsafe { &*source };
        if ADD_DOUBLE_REF {
            source_ref.ref_();
            source_ref.ref_();
        }

        ResolvedSource {
            source_code: bun_core::String::adopt_wtf_impl(source_ref.impl_),
            specifier,
            source_url: create_if_different(&specifier, source_url),
            allocator: source.cast::<c_void>(),
            source_code_needs_deref: false,
            ..Default::default()
        }
    }

    /// Spec VirtualMachine.zig:1615 `refCountedStringWithWasNew`.
    fn ref_counted_string_with_was_new<const DUPE: bool>(
        &mut self,
        new: &mut bool,
        input_: &[u8],
        hash_: Option<u32>,
    ) -> *mut crate::ref_string::RefString {
        use crate::ref_string::RefString;
        use bun_collections::zig_hash_map::MapEntry as Entry;
        jsc::mark_binding();
        debug_assert!(!input_.is_empty());
        let hash = hash_.unwrap_or_else(|| RefString::compute_hash(input_));
        // PORT NOTE: Zig `lock(); defer unlock()` — RAII guard releases on every
        // exit (including the early-return `Occupied` arm).
        let _unlock = self.ref_strings_mutex.lock_guard();
        // PORT NOTE: reshaped for borrowck — capture the back-pointer before
        // `ref_strings.entry()` takes its unique borrow on `self`.
        let self_ctx = NonNull::new(std::ptr::from_mut::<VirtualMachine>(self).cast::<c_void>());

        match self.ref_strings.entry(hash) {
            Entry::Occupied(o) => {
                *new = false;
                *o.get()
            }
            Entry::Vacant(v) => {
                // Spec :1624-1626 — dupe the input bytes when `DUPE`, otherwise
                // adopt the caller's allocation (caller transferred ownership).
                let (ptr, len) = if DUPE {
                    let buf = Box::<[u8]>::from(input_);
                    let len = buf.len();
                    (bun_core::heap::into_raw(buf).cast::<u8>().cast_const(), len)
                } else {
                    (input_.as_ptr(), input_.len())
                };
                let ref_ = bun_core::heap::into_raw(Box::new(RefString {
                    ptr,
                    len,
                    hash,
                    // Filled in just below — `create_external` needs the
                    // `*mut RefString` ctx pointer first.
                    impl_: core::ptr::null_mut(),
                    ctx: self_ctx,
                    on_before_deinit: Some(VirtualMachine::clear_ref_string),
                }));
                // SAFETY: `ref_` is the unique live `*mut RefString` (just
                // boxed); `(ptr, len)` is its owned latin-1 buffer. The
                // external-string finalizer (`free_ref_string`) is called by
                // WTF on the JS thread when the impl refcount hits zero, with
                // `ref_` as ctx.
                let s = bun_core::String::create_external::<*mut RefString>(
                    unsafe { bun_core::ffi::slice(ptr, len) },
                    true,
                    ref_,
                    free_ref_string,
                );
                // SAFETY: see above.
                unsafe { (*ref_).impl_ = s.leak_wtf_impl() };
                v.insert(ref_);
                *new = true;
                ref_
            }
        }
    }

    /// Spec VirtualMachine.zig:1650 `refCountedString`.
    pub fn ref_counted_string<const DUPE: bool>(
        &mut self,
        input_: &[u8],
        hash_: Option<u32>,
    ) -> *mut crate::ref_string::RefString {
        debug_assert!(!input_.is_empty());
        let mut was_new = false;
        self.ref_counted_string_with_was_new::<DUPE>(&mut was_new, input_, hash_)
    }

    /// Spec VirtualMachine.zig:1656 `fetchWithoutOnLoadPlugins`.
    // PORT NOTE: Zig `comptime flags: FetchFlags` lowered to a runtime arg —
    // `FetchFlags` would need `ConstParamTy` (unstable derive on the enum's
    // owning module) to stay a const generic; the only branches are cheap
    // equality tests so the runtime form is fine. PERF(port): revisit.
    pub fn fetch_without_on_load_plugins(
        jsc_vm: &mut VirtualMachine,
        global_object: &JSGlobalObject,
        specifier: bun_core::String,
        referrer: bun_core::String,
        log: &mut bun_ast::Log,
        flags: FetchFlags,
    ) -> Result<ResolvedSource, bun_core::Error> {
        debug_assert!(VirtualMachine::is_loaded());

        let global_ptr = std::ptr::from_ref::<JSGlobalObject>(global_object).cast_mut();
        let mut ret = ErrorableResolvedSource::ok(ResolvedSource::default());
        match ModuleLoader::fetch_builtin_module(
            jsc_vm, global_ptr, &specifier, &referrer, &mut ret,
        ) {
            ModuleLoader::FetchBuiltinResult::Found | ModuleLoader::FetchBuiltinResult::Errored => {
                return ret.unwrap();
            }
            ModuleLoader::FetchBuiltinResult::NotFound => {}
        }

        let specifier_clone = specifier.to_utf8();
        let referrer_clone = referrer.to_utf8();

        let mut virtual_source_to_use: Option<bun_ast::Source> = None;
        // Spec :1676-1677 — `var blob_to_deinit: ?webcore.Blob = null;
        // defer if (blob_to_deinit) |*blob| blob.deinit();`. The blob crosses
        // the bundler↔runtime boundary as an erased `OpaqueBlob`; deinit goes
        // through the same `VmLoaderCtx` that produced it.
        struct BlobDeinit(
            Option<bun_bundler::options::OpaqueBlob>,
            bun_bundler::options::VmLoaderCtx,
        );
        impl Drop for BlobDeinit {
            fn drop(&mut self) {
                if let Some(blob) = self.0.take() {
                    self.1.blob_deinit(blob);
                }
            }
        }
        // SAFETY: `jsc_vm` outlives this stack frame.
        let loader_ctx = unsafe {
            bun_bundler::options::VmLoaderCtx::new(
                bun_bundler::options::VmLoaderCtxKind::Runtime,
                std::ptr::from_ref::<VirtualMachine>(jsc_vm).cast_mut(),
            )
        };
        let mut blob_to_deinit = BlobDeinit(None, loader_ctx);
        let lr = match bun_bundler::options::get_loader_and_virtual_source(
            specifier_clone.slice(),
            &loader_ctx,
            &mut virtual_source_to_use,
            &mut blob_to_deinit.0,
            None,
        ) {
            Ok(lr) => lr,
            // Spec :1679 `catch { return error.ModuleNotFound; }`.
            Err(_) => return Err(bun_core::err!("ModuleNotFound")),
        };
        let module_type = lr
            .package_json
            .map(|pkg| pkg.module_type)
            .unwrap_or(bun_bundler::options::ModuleType::Unknown);

        // PORT NOTE: Zig `defer if (flags != .print_source) resetArena();
        // errdefer if (flags == .print_source) resetArena()`. Model with a
        // drop-guard so both paths reset on the right edge.
        struct ArenaReset<'a>(&'a mut VirtualMachine, bool);
        impl Drop for ArenaReset<'_> {
            fn drop(&mut self) {
                if self.1 {
                    let vm = std::ptr::from_mut::<VirtualMachine>(self.0);
                    // SAFETY: `vm` is the live per-thread VM.
                    unsafe { ModuleLoader::ModuleLoader::reset_arena(&mut *vm) };
                }
            }
        }
        let mut guard = ArenaReset(jsc_vm, flags != FetchFlags::PrintSource);

        let printer = SOURCE_CODE_PRINTER
            .get()
            .expect("source_code_printer not initialized");

        // PORT NOTE: Zig passes path/loader/module_type/printer/promise_ptr as
        // positional params to `transpileSourceCode`; the §Dispatch shim takes
        // them bundled as `TranspileExtra` behind `args.extra` (see
        // ModuleLoader.rs `TranspileArgs`).
        let mut extra = ModuleLoader::TranspileExtra {
            // SAFETY: `lr.path` borrows from `specifier_clone` (and the VM's
            // resolver caches), both of which outlive the synchronous
            // `transpile_source_code` call below; `TranspileExtra` declares
            // `'static` only because it crosses the §Dispatch boundary as
            // `*mut c_void` — the hook never retains the borrow.
            path: unsafe { lr.path.into_static() },
            loader: lr.loader.unwrap_or(if lr.is_main {
                bun_ast::Loader::Js
            } else {
                bun_ast::Loader::File
            }),
            module_type,
            source_code_printer: printer.as_ptr(),
            // Spec: `null` — `fetchWithoutOnLoadPlugins` forbids the async path.
            promise_ptr: core::ptr::null_mut(),
        };
        let args = ModuleLoader::TranspileArgs {
            specifier: lr.specifier,
            referrer: referrer_clone.slice(),
            input_specifier: specifier,
            log: std::ptr::from_mut::<bun_ast::Log>(log),
            virtual_source: lr.virtual_source,
            global_object: std::ptr::from_ref::<JSGlobalObject>(global_object).cast_mut(),
            flags,
            extra: (&raw mut extra).cast::<c_void>(),
        };
        let mut ret = ErrorableResolvedSource::ok(ResolvedSource::default());
        let ok = ModuleLoader::transpile_source_code(guard.0, &args, &mut ret);

        if !ok && flags == FetchFlags::PrintSource {
            guard.1 = true; // errdefer
        }
        // `blob_to_deinit` drop guard fires here (spec :1677 `defer`).
        ret.unwrap()
    }

    /// Zig `bun.default_allocator.dupe(u8, s)` for the `_resolve`
    /// fast-paths. The spec intentionally never frees these — they back
    /// `ResolveFunctionResult.path` for the VM lifetime (see the field's
    /// `TODO(port): lifetime` note). Returning a `'static` borrow of the
    /// boxed bytes mirrors that contract.
    fn dupe_resolved_path(s: &[u8]) -> &'static [u8] {
        // SAFETY: allocation is VM-lifetime by spec (VirtualMachine.zig:1740,
        // :1744, :1755, :1761) — never freed in `deinit`.
        unsafe { &*bun_core::heap::into_raw(s.to_vec().into_boxed_slice()) }
    }

    /// Spec VirtualMachine.zig:1724 `_resolve`.
    ///
    /// PORT NOTE: Zig has `comptime is_a_file_path: bool`; folded to a runtime
    /// arg here to avoid duplicating the body for both monomorphizations.
    pub fn _resolve(
        &mut self,
        ret: &mut ResolveFunctionResult,
        specifier: &[u8],
        source: &[u8],
        is_esm: bool,
        is_a_file_path: bool,
    ) -> Result<(), bun_core::Error> {
        use bun_js_parser::Macro;
        use bun_resolver::{ResultUnion, node_fallbacks};

        // SAFETY: PORT — `specifier`/`source` borrow argv / resolver-arena
        // bytes that outlive `ResolveFunctionResult` (`'static` per the
        // struct's TODO(port) lifetime note). Erase to `'static` to seat the
        // result paths without threading a lifetime parameter through the VM.
        let specifier: &'static [u8] = unsafe { bun_ptr::detach_lifetime(specifier) };

        // `Runtime.Runtime.Imports.{alt_name, Name}` are both `"bun:wrap"`
        // (see js_parser/runtime.rs).
        if bun_paths::basename(specifier) == b"bun:wrap" {
            ret.path = b"bun:wrap";
            return Ok(());
        }
        if specifier == MAIN_FILE_NAME && self.entry_point.generated {
            ret.result = None;
            ret.path = MAIN_FILE_NAME;
            return Ok(());
        }
        if specifier.starts_with(Macro::NAMESPACE_WITH_COLON) {
            ret.result = None;
            ret.path = Self::dupe_resolved_path(specifier);
            return Ok(());
        }
        if specifier.starts_with(node_fallbacks::IMPORT_PATH) {
            ret.result = None;
            ret.path = Self::dupe_resolved_path(specifier);
            return Ok(());
        }
        if let Some(result) = ModuleLoader::HardcodedModule::Alias::get(
            specifier,
            bun_ast::Target::Bun,
            Default::default(),
        ) {
            ret.result = None;
            ret.path = result.path.as_bytes();
            return Ok(());
        }
        if self.module_loader.eval_source.is_some()
            && (specifier.ends_with(bun_paths::path_literal!("/[eval]").as_bytes())
                || specifier.ends_with(bun_paths::path_literal!("/[stdin]").as_bytes()))
        {
            ret.result = None;
            ret.path = Self::dupe_resolved_path(specifier);
            return Ok(());
        }
        if let Some(blob_id) = specifier.strip_prefix(b"blob:".as_slice()) {
            ret.result = None;
            // `WebCore.ObjectURLRegistry` lives in `bun_runtime`; routed
            // through [`RuntimeHooks::has_blob_url`].
            let has = runtime_hooks()
                .map(|h| (h.has_blob_url)(blob_id))
                .unwrap_or(false);
            if has {
                ret.path = Self::dupe_resolved_path(specifier);
                return Ok(());
            }
            return Err(bun_core::err!("ModuleNotFound"));
        }

        let is_special_source = source == MAIN_FILE_NAME || Macro::is_macro_path(source);
        let mut query_string: &[u8] = b"";
        let normalized_specifier = normalize_specifier_for_resolution(specifier, &mut query_string);
        let top_level_dir = self.top_level_dir();
        let source_to_use: &[u8] = if !is_special_source {
            if is_a_file_path {
                // SAFETY: PORT — `dir_with_trailing_slash()` returns a
                // re-slice of `source`, which the caller guarantees outlives
                // the resolve call (and the resolver only borrows it for the
                // synchronous `resolve_and_auto_install`).
                unsafe {
                    bun_ptr::detach_lifetime(
                        bun_resolver::fs::PathName::init(source).dir_with_trailing_slash(),
                    )
                }
            } else {
                // SAFETY: see `specifier` lifetime erasure note above.
                unsafe { bun_ptr::detach_lifetime(source) }
            }
        } else {
            top_level_dir
        };

        // PORT NOTE: Zig modeled this as a labeled `while (true)` with
        // `continue` after a successful cache bust. Expressed as a `loop`
        // returning the resolver result; `retry_on_not_found` is consumed on
        // the first miss.
        let mut retry_on_not_found = bun_paths::is_absolute(source_to_use);
        let result: bun_resolver::Result = loop {
            let import_kind = if is_esm {
                bun_ast::ImportKind::Stmt
            } else {
                bun_ast::ImportKind::Require
            };
            let global_cache = self.transpiler.resolver.opts.global_cache;
            match self.transpiler.resolver.resolve_and_auto_install(
                source_to_use,
                normalized_specifier,
                import_kind,
                global_cache,
            ) {
                ResultUnion::Success(r) => break r,
                ResultUnion::Failure(e) => return Err(e),
                ResultUnion::Pending(_) | ResultUnion::NotFound => {
                    if !retry_on_not_found {
                        return Err(bun_core::err!("ModuleNotFound"));
                    }
                    retry_on_not_found = false;

                    // SAFETY: thread-local heap allocation; sole `&mut` on the JS
                    // thread for the duration of the bust below.
                    let buf = unsafe { &mut *specifier_cache_resolver_buf() }.as_mut_slice();
                    let buster_name: &[u8] = if bun_paths::is_absolute(normalized_specifier) {
                        if let Some(dir) = bun_paths::dirname(normalized_specifier) {
                            if dir.len() > buf.len() {
                                return Err(bun_core::err!("ModuleNotFound"));
                            }
                            // Normalized without trailing slash.
                            bun_paths::string_paths::normalize_slashes_only(
                                buf,
                                dir,
                                bun_paths::SEP,
                            )
                        } else {
                            // Absolute but root — fall through to join.
                            &b""[..]
                        }
                    } else {
                        &b""[..]
                    };
                    let buster_name: &[u8] = if !buster_name.is_empty() {
                        buster_name
                    } else {
                        // If the specifier is too long to join, it can't name
                        // a real directory — skip the cache bust and fail.
                        if source_to_use.len() + normalized_specifier.len() + 4 >= buf.len() {
                            return Err(bun_core::err!("ModuleNotFound"));
                        }
                        let parts: [&[u8]; 3] = [
                            source_to_use,
                            normalized_specifier,
                            bun_paths::path_literal!("..").as_bytes(),
                        ];
                        bun_paths::resolve_path::join_abs_string_buf_z::<
                            bun_paths::resolve_path::platform::Auto,
                        >(top_level_dir, buf, &parts)
                        .as_bytes()
                    };

                    // Only re-query if we previously had something cached.
                    if self.transpiler.resolver.bust_dir_cache(
                        bun_paths::string_paths::without_trailing_slash_windows_path(buster_name),
                    ) {
                        continue;
                    }
                    return Err(bun_core::err!("ModuleNotFound"));
                }
            }
        };

        if !self.macro_mode {
            self.has_any_macro_remappings =
                self.has_any_macro_remappings || self.transpiler.options.macro_remap.count() > 0;
        }
        // SAFETY: PORT — `query_string` re-slices `specifier` (caller-owned;
        // see lifetime erasure note above).
        ret.query_string = unsafe { bun_ptr::detach_lifetime(query_string) };
        let result_path = result
            .path_const()
            .ok_or_else(|| bun_core::err!("ModuleNotFound"))?;
        // SAFETY: `result_path.text` borrows the resolver's arena, which
        // outlives `ResolveFunctionResult` (see field TODO(port) lifetime).
        ret.path = unsafe { bun_ptr::detach_lifetime(result_path.text) };
        ret.result = Some(result);
        self.resolved_count += 1;

        Ok(())
    }

    /// Spec VirtualMachine.zig:1854 `resolve`.
    pub fn resolve(
        res: &mut ErrorableString,
        global: &JSGlobalObject,
        specifier: bun_core::String,
        source: bun_core::String,
        query_string: Option<&mut bun_core::String>,
        is_esm: bool,
    ) -> JsResult<()> {
        Self::resolve_maybe_needs_trailing_slash::<true>(
            res,
            global,
            specifier,
            source,
            query_string,
            is_esm,
            false,
        )
    }

    /// Spec VirtualMachine.zig:1873 `resolveMaybeNeedsTrailingSlash`.
    pub fn resolve_maybe_needs_trailing_slash<const IS_A_FILE_PATH: bool>(
        res: &mut ErrorableString,
        global: &JSGlobalObject,
        specifier: bun_core::String,
        source: bun_core::String,
        query_string: Option<&mut bun_core::String>,
        is_esm: bool,
        is_user_require_resolve: bool,
    ) -> JsResult<()> {
        const MAX_LEN: usize = (bun_paths::MAX_PATH_BYTES as f64 * 1.5) as usize;
        if IS_A_FILE_PATH && specifier.length() > MAX_LEN {
            let specifier_utf8 = specifier.to_utf8();
            let source_utf8 = source.to_utf8();
            let import_kind = if is_esm {
                bun_ast::ImportKind::Stmt
            } else if is_user_require_resolve {
                bun_ast::ImportKind::RequireResolve
            } else {
                bun_ast::ImportKind::Require
            };
            let printed = crate::ResolveMessage::fmt(
                specifier_utf8.slice(),
                source_utf8.slice(),
                bun_core::err!("NameTooLong"),
                import_kind.into(),
            );
            let msg = bun_ast::Msg {
                data: bun_ast::range_data(None, bun_ast::Range::NONE, printed),
                ..Default::default()
            };
            *res = ErrorableString::err(
                bun_core::err!("NameTooLong"),
                crate::ResolveMessage::create(global, &msg, source_utf8.slice())?,
            );
            return Ok(());
        }

        let mut result = ResolveFunctionResult::default();
        // SAFETY: per-thread VM is live (caller is on the JS thread).
        let jsc_vm_ptr = global.bun_vm_ptr();
        let jsc_vm = unsafe { &mut *jsc_vm_ptr };
        let specifier_utf8 = specifier.to_utf8();
        let source_utf8 = source.to_utf8();

        if jsc_vm.plugin_runner.is_some() {
            use bun_bundler::transpiler::PluginRunner;
            let spec = specifier_utf8.slice();
            if PluginRunner::could_be_plugin(spec) {
                let namespace = PluginRunner::extract_namespace(spec);
                let after_namespace = if namespace.is_empty() {
                    spec
                } else {
                    &spec[namespace.len() + 1..]
                };
                if let Some(resolved_path) = plugin_runner_on_resolve_jsc(
                    global,
                    bun_core::String::init(namespace),
                    bun_core::String::borrow_utf8(after_namespace),
                    source,
                    crate::BunPluginTarget::Bun,
                )? {
                    *res = resolved_path;
                    return Ok(());
                }
            }
        }

        if let Some(hardcoded) = ModuleLoader::HardcodedModule::Alias::get(
            specifier_utf8.slice(),
            bun_ast::Target::Bun,
            Default::default(),
        ) {
            *res = ErrorableString::ok(if is_user_require_resolve && hardcoded.node_builtin {
                specifier.dupe_ref()
            } else {
                bun_core::String::init(hardcoded.path.as_bytes())
            });
            return Ok(());
        }

        // Swap in a fresh log so resolver errors don't pollute the VM's main log.
        // `vm.log` is set unconditionally in `init` and never cleared (Zig
        // stores `*logger.Log`, always non-null), so the `Option` is purely a
        // zeroed-init nicety; the `expect` is infallible.
        let old_log: NonNull<bun_ast::Log> = jsc_vm.log.expect("vm.log set in init");
        let mut log = bun_ast::Log::default();
        jsc_vm.log = NonNull::new(&raw mut log);
        jsc_vm.transpiler.resolver.log = &raw mut log;
        // TODO(b2-cycle): `transpiler.linker.log` / `resolver.package_manager.log`
        // — gated bundler fields.
        // PORT NOTE: Zig `defer { restore old_log }` — fires on every exit
        // (including `?` from `ResolveMessage::create` below), so the VM's
        // `log` cannot be left pointing at the dropped stack `log`. Hand-roll
        // a drop guard (no captured borrows) so the unique `&mut *jsc_vm_ptr`
        // below isn't kept alive across the closure. `BackRef` + `as_mut`
        // route the restore through thread-local provenance.
        struct RestoreLog {
            vm: bun_ptr::BackRef<VirtualMachine>,
            old_log: NonNull<bun_ast::Log>,
        }
        impl Drop for RestoreLog {
            fn drop(&mut self) {
                // `vm` is the live per-thread VM (caller is on the JS
                // thread); `old_log` outlives the VM (Box::leak in `init`).
                let jsc_vm = self.vm.get().as_mut();
                jsc_vm.log = Some(self.old_log);
                jsc_vm.transpiler.resolver.log = &raw mut *self.old_log.as_ptr();
            }
        }
        let _restore = RestoreLog {
            vm: bun_ptr::BackRef::from(NonNull::new(jsc_vm_ptr).expect("vm non-null")),
            old_log,
        };
        // PORT NOTE: reshaped for borrowck — re-derive from raw so the unique
        // borrow doesn't span the guard's drop.
        // SAFETY: per-thread VM is live for this synchronous call.
        let jsc_vm = unsafe { &mut *jsc_vm_ptr };

        let resolve_result = jsc_vm._resolve(
            &mut result,
            specifier_utf8.slice(),
            normalize_source(source_utf8.slice()),
            is_esm,
            IS_A_FILE_PATH,
        );
        if let Err(err_) = resolve_result {
            let mut err = err_;
            let import_kind = if is_esm {
                bun_ast::ImportKind::Stmt
            } else if is_user_require_resolve {
                bun_ast::ImportKind::RequireResolve
            } else {
                bun_ast::ImportKind::Require
            };
            // Find a `.resolve`-metadata msg if the log has one.
            let msg = log
                .msgs
                .iter()
                .find_map(|m| {
                    if let bun_ast::Metadata::Resolve(r) = &m.metadata {
                        err = r.err;
                        Some(m.clone())
                    } else {
                        None
                    }
                })
                .unwrap_or_else(|| {
                    let printed = crate::ResolveMessage::fmt(
                        specifier_utf8.slice(),
                        source_utf8.slice(),
                        err,
                        import_kind.into(),
                    );
                    bun_ast::Msg {
                        data: bun_ast::range_data(None, bun_ast::Range::NONE, printed.clone()),
                        metadata: bun_ast::Metadata::Resolve(bun_ast::MetadataResolve {
                            specifier: bun_ast::BabyString::r#in(&printed, specifier_utf8.slice()),
                            import_kind: import_kind.into(),
                            err,
                        }),
                        ..Default::default()
                    }
                });
            *res = ErrorableString::err(
                err,
                crate::ResolveMessage::create(global, &msg, source_utf8.slice())?,
            );
            return Ok(());
        }

        if let Some(query) = query_string {
            *query = if !result.query_string.is_empty() {
                bun_core::String::clone_utf8(result.query_string)
            } else {
                bun_core::String::empty()
            };
        }

        *res = ErrorableString::ok(bun_core::String::clone_utf8(result.path));
        Ok(())
    }
    /// `VirtualMachine.deinit` — worker-thread teardown. Spec
    /// VirtualMachine.zig:2109.
    pub fn destroy(&mut self) {
        // PORT NOTE: Zig `auto_killer.deinit()` — `ProcessAutoKiller`'s `Drop`
        // is the deinit body; take()+drop runs it without dropping `self`.
        drop(core::mem::take(&mut self.auto_killer));

        // PORT NOTE: Zig frees the thread-local `source_code_printer` static
        // in `deinit`; here it's `SOURCE_CODE_PRINTER` (boxed via
        // `ensure_source_code_printer`).
        if let Some(printer) = SOURCE_CODE_PRINTER.take() {
            // SAFETY: `printer` was produced by `heap::alloc` in
            // `ensure_source_code_printer` and is exclusively owned by this
            // thread's VM.
            drop(unsafe { bun_core::heap::take(printer.as_ptr()) });
        }

        // PORT NOTE: `SavedSourceMap`'s `Drop` is the Zig `deinit()`; it frees
        // each stored map and `deinit()`s the sibling `saved_source_map_table`.
        drop(core::mem::take(&mut self.source_mappings));

        if let Some(rare) = self.rare_data.take() {
            if let Some(hooks) = runtime_hooks() {
                (hooks.cron_clear_all_teardown)(self);
            }
            // Paired with `rare_data()`'s register_root_region. Without this,
            // every terminated Worker leaves a stale LSAN root entry pointing
            // into a freed arena.
            bun_core::asan::unregister_root_region(
                core::ptr::from_ref::<RareData>(&*rare).cast(),
                core::mem::size_of::<RareData>(),
            );
            drop(rare);
        }

        // PORT NOTE: Zig `proxy_env_storage.deinit()` — drops all `Arc`-held
        // proxy strings; `ProxyEnvStorage: Default` so take()+drop suffices.
        drop(core::mem::take(&mut self.proxy_env_storage));
        self.overridden_main.deinit();

        // PORT NOTE: Zig frees `timer`/`entry_point` as value fields of `self`;
        // here they live in the high-tier `RuntimeState` box, so dispatch the
        // reclaim through the hook. PERF(port): was inline switch.
        if let Some(hooks) = runtime_hooks() {
            let state = core::mem::replace(&mut self.runtime_state, core::ptr::null_mut());
            // SAFETY: hook contract — `state` is exactly the pointer
            // `init_runtime_state` returned for this VM (or null), handed back
            // once on the same thread; `self` is the live per-thread VM.
            unsafe { (hooks.deinit_runtime_state)(std::ptr::from_mut(self), state) };
        }
        self.has_terminated = true;
    }
    /// Spec VirtualMachine.zig:2134 `printException`.
    ///
    /// PORT NOTE: Zig is `comptime Writer`-generic; collapse to the concrete
    /// `bun_core::io::Writer` since every call site passes
    /// `Output.errorWriterBuffered()`.
    pub fn print_exception(
        &mut self,
        exception: &Exception,
        exception_list: Option<&mut ExceptionList>,
        writer: &mut bun_core::io::Writer,
        allow_side_effects: bool,
    ) {
        let mut formatter = crate::console_object::Formatter::new(self.global());
        let colors = bun_core::Output::enable_ansi_colors_stderr();
        self.print_errorlike_object(
            exception.value(),
            Some(exception),
            exception_list,
            &mut formatter,
            writer,
            colors,
            allow_side_effects,
        );
        // `defer formatter.deinit()` → Drop.
    }

    /// Spec VirtualMachine.zig:2195 `clearEntryPoint`.
    pub fn clear_entry_point(&mut self) -> JsResult<()> {
        if self.main().is_empty() {
            return Ok(());
        }
        let str = crate::zig_string::ZigString::init(MAIN_FILE_NAME);
        self.global().delete_module_registry_entry(&str)
    }

    /// Spec VirtualMachine.zig:2363 `useIsolationSourceProviderCache` (exported `callconv(.c)`).
    #[unsafe(export_name = "Bun__VM__useIsolationSourceProviderCache")]
    pub extern "C" fn use_isolation_source_provider_cache(&self) -> bool {
        self.test_isolation_enabled
            && !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_ISOLATION_SOURCE_CACHE::get()
                .unwrap_or(false)
    }

    /// Spec VirtualMachine.zig:2378 `reloadEntryPointForTestRunner`.
    pub fn reload_entry_point_for_test_runner(
        &mut self,
        entry_path: &[u8],
    ) -> Result<*mut JSInternalPromise, bun_core::Error> {
        self.has_loaded = false;
        self.set_main(entry_path);
        self.main_resolved_path.deref();
        self.main_resolved_path = bun_core::String::empty();
        self.main_hash = bun_watcher::Watcher::get_hash(entry_path);
        self.overridden_main.deinit();

        self.event_loop_mut().ensure_waker();

        let _ = self.ensure_debugger(true);

        if !self.transpiler.options.disable_transpilation {
            if let Some(hooks) = runtime_hooks() {
                // SAFETY: hook contract.
                let p = unsafe { (hooks.load_preloads)(self) }?;
                if !p.is_null() {
                    JSValue::from_cell(p).ensure_still_alive();
                    self.pending_internal_promise = Some(p);
                    JSValue::from_cell(p).protect();
                    self.pending_internal_promise_is_protected = true;
                    return Ok(p);
                }
            }
        }

        // PORT NOTE: reshaped for borrowck.
        let global = self.global;
        let main_str = bun_core::String::from_bytes(self.main());
        let promise = jsc::JSModuleLoader::load_and_evaluate_module_ptr(global, Some(&main_str))
            .map(NonNull::as_ptr)
            .ok_or_else(|| bun_core::err!("JSError"))?;
        self.pending_internal_promise = Some(promise);
        self.pending_internal_promise_is_protected = false;
        JSValue::from_cell(promise).ensure_still_alive();
        Ok(promise)
    }

    /// Spec VirtualMachine.zig:2410 `loadEntryPointForWebWorker`.
    pub fn load_entry_point_for_web_worker(
        &mut self,
        entry_path: &[u8],
    ) -> Result<*mut JSInternalPromise, bun_core::Error> {
        let promise = self.reload_entry_point(entry_path)?;
        self.event_loop_mut().perform_gc();
        self.event_loop_mut()
            .wait_for_promise_with_termination(jsc::AnyPromise::Internal(promise));
        if let Some(worker) = self.worker_ref() {
            if worker.has_requested_terminate() {
                return Err(bun_core::err!("WorkerTerminated"));
            }
        }
        Ok(self.pending_internal_promise.unwrap())
    }

    /// Spec VirtualMachine.zig:2424 `loadEntryPointForTestRunner`.
    pub fn load_entry_point_for_test_runner(
        &mut self,
        entry_path: &[u8],
    ) -> Result<*mut JSInternalPromise, bun_core::Error> {
        let promise = self.reload_entry_point_for_test_runner(entry_path)?;

        // pending_internal_promise can change if hot module reloading is enabled
        if self.is_watcher_enabled() {
            self.event_loop_mut().perform_gc();
            loop {
                let Some(p) = self.pending_internal_promise else {
                    break;
                };
                // SAFETY: `p` is a live JSC heap cell tracked by the VM.
                if crate::JSPromise::status_ptr(p) != crate::js_promise::Status::Pending {
                    break;
                }
                self.event_loop_mut().tick();
                let Some(p) = self.pending_internal_promise else {
                    break;
                };
                // SAFETY: see above.
                if crate::JSPromise::status_ptr(p) == crate::js_promise::Status::Pending {
                    self.auto_tick();
                }
            }
        } else {
            // SAFETY: `promise` is a live JSC heap cell.
            if crate::JSPromise::status_ptr(promise) == crate::js_promise::Status::Rejected {
                return Ok(promise);
            }
            self.event_loop_mut().perform_gc();
            self.wait_for_promise(jsc::AnyPromise::Internal(promise));
        }

        self.auto_tick();
        Ok(self.pending_internal_promise.unwrap())
    }

    /// Spec VirtualMachine.zig:2486 `addListeningSocketForWatchMode`.
    pub fn add_listening_socket_for_watch_mode(&mut self, socket: bun_sys::Fd) {
        if self.hot_reload != HOT_RELOAD_WATCH && !self.test_isolation_enabled {
            return;
        }
        self.rare_data().add_listening_socket_for_watch_mode(socket);
    }

    /// Spec VirtualMachine.zig:2493 `removeListeningSocketForWatchMode`.
    pub fn remove_listening_socket_for_watch_mode(&mut self, socket: bun_sys::Fd) {
        if self.hot_reload != HOT_RELOAD_WATCH && !self.test_isolation_enabled {
            return;
        }
        self.rare_data()
            .remove_listening_socket_for_watch_mode(socket);
    }

    /// Spec VirtualMachine.zig:2505 `swapGlobalForTestIsolation`.
    pub fn swap_global_for_test_isolation(&mut self) {
        debug_assert!(self.test_isolation_enabled);

        let _ = self.event_loop_mut().drain_microtasks();

        if let Some(rare) = self.rare_data.as_deref_mut() {
            rare.close_all_watchers_for_isolation();
        }

        {
            // Groups that must survive the per-file isolation swap: this
            // process's own inbound IPC, the spawn-IPC pool, and the
            // test-parallel channel.
            let (skip_spawn_ipc, skip_test_parallel_ipc): (
                *mut uws::SocketGroup,
                *mut uws::SocketGroup,
            ) = match self.rare_data.as_deref_mut() {
                Some(rare) => (
                    core::ptr::from_mut(&mut rare.spawn_ipc_group),
                    core::ptr::from_mut(&mut rare.test_parallel_ipc_group),
                ),
                None => (core::ptr::null_mut(), core::ptr::null_mut()),
            };
            #[cfg(unix)]
            let skip_process_ipc: *mut uws::SocketGroup = match &self.ipc {
                Some(IPCInstanceUnion::Initialized(inst)) => {
                    // SAFETY: `inst` was produced by `IPCInstance::new` and is
                    // live for as long as `self.ipc` holds it.
                    unsafe { (**inst).group }
                }
                _ => core::ptr::null_mut(),
            };
            #[cfg(not(unix))]
            let skip_process_ipc: *mut uws::SocketGroup = core::ptr::null_mut();
            // SAFETY: process-global usockets loop is live.
            let loop_ = unsafe { &mut *uws::Loop::get() };
            let mut maybe_group = loop_.internal_loop_data.head;
            while let Some(group) = NonNull::new(maybe_group) {
                // SAFETY: `group` is a live `us_socket_group_t` linked in the loop.
                let next = unsafe { (*group.as_ptr()).next };
                let g = group.as_ptr();
                if g != skip_spawn_ipc && g != skip_process_ipc && g != skip_test_parallel_ipc {
                    // SAFETY: see above.
                    unsafe { (*g).close_all() };
                }
                // SAFETY: `next` may have been unlinked by an on_close JS
                // callback; restart from head if so (mirrors loop.c).
                maybe_group = if !next.is_null() && unsafe { (*next).linked } == 0 {
                    loop_.internal_loop_data.head
                } else {
                    next
                };
            }
        }
        if let Some(rare) = self.rare_data.as_deref_mut() {
            rare.listening_sockets_for_watch_mode.lock().clear();
        }
        let _ = self.event_loop_mut().drain_microtasks();

        let _ = self.auto_killer.kill();
        self.auto_killer.clear();

        self.test_isolation_generation = self.test_isolation_generation.wrapping_add(1);

        self.overridden_main.deinit();
        self.entry_point_result.value.deinit();
        self.entry_point_result.cjs_set_value = false;
        if let Some(promise) = self.pending_internal_promise {
            if self.pending_internal_promise_is_protected {
                JSValue::from_cell(promise).unprotect();
                self.pending_internal_promise_is_protected = false;
            }
            self.pending_internal_promise = None;
        }
        self.has_patched_run_main = false;
        self.set_main(b"");
        self.main_hash = 0;
        self.main_resolved_path.deref();
        self.main_resolved_path = bun_core::String::empty();
        self.unhandled_error_counter = 0;

        let old_global = self.global;
        // `old_global` valid for VM lifetime (safe ZST-handle deref);
        // `console` is the live per-VM ConsoleObject.
        let new_global: *mut JSGlobalObject = JSGlobalObject::create_for_test_isolation(
            JSGlobalObject::opaque_ref(old_global),
            self.console.cast(),
        );
        self.global = new_global;
        VMHolder::set_cached_global_object(Some(new_global));
        self.regular_event_loop.global = NonNull::new(new_global);
        self.macro_event_loop.global = NonNull::new(new_global);
        self.has_loaded_constructors = true;
        if let Some(IPCInstanceUnion::Initialized(inst)) = self.ipc {
            // SAFETY: `inst` was produced by `IPCInstance::new` and stays live
            // until `IPCInstance::deinit`; repoint at the new global so
            // `Process__emitMessageEvent` doesn't dispatch on a freed cell.
            unsafe { (*inst).global_this = new_global };
        }
        if let Some(rare) = self.rare_data.as_deref_mut() {
            for hook in rare.cleanup_hooks.iter_mut() {
                if hook.global_this == old_global {
                    hook.global_this = new_global;
                }
            }
        }
    }

    /// Spec VirtualMachine.zig:2641 `_loadMacroEntryPoint`.
    #[inline]
    pub fn _load_macro_entry_point(&mut self, entry_path: &[u8]) -> Option<*mut JSInternalPromise> {
        let path_str = bun_core::String::init(entry_path);
        let promise =
            jsc::JSModuleLoader::load_and_evaluate_module_ptr(self.global, Some(&path_str))?
                .as_ptr();
        self.wait_for_promise(jsc::AnyPromise::Internal(promise));
        Some(promise)
    }

    /// Spec VirtualMachine.zig:2652 `printErrorLikeObjectToConsole`.
    pub fn print_error_like_object_to_console(&mut self, value: JSValue) {
        self.run_error_handler(value, None);
    }

    /// Spec VirtualMachine.zig:2663 `printErrorlikeObject`.
    ///
    /// PORT NOTE: Zig is `comptime Writer` + `comptime allow_ansi_color` +
    /// `comptime allow_side_effects` — collapse to runtime bools and the
    /// concrete `bun_core::io::Writer`.
    pub fn print_errorlike_object(
        &mut self,
        value: JSValue,
        exception: Option<&Exception>,
        exception_list: Option<&mut ExceptionList>,
        formatter: &mut crate::console_object::Formatter,
        writer: &mut bun_core::io::Writer,
        allow_ansi_color: bool,
        allow_side_effects: bool,
    ) {
        // PORT NOTE: Zig declared `was_internal` and ran the
        // exception-stack-trace `defer` after the body. Reshape: handle the
        // post-print stack/exception_list block at the tail instead of via a
        // drop guard (the body has no early-`?` returns once the AggregateError
        // branch is taken).
        let global_ref = self.global();

        if value.is_aggregate_error(global_ref) {
            // PORT NOTE: Zig comptime-generated `AggregateErrorIterator` with
            // `extern "C"` callbacks. `JSValue::for_each` takes a C-ABI fn
            // pointer + erased ctx, so thread the captures through a struct.
            // The C trampoline erases lifetimes via `*mut c_void`; round-trip
            // the caller's `&mut ExceptionList` as a raw pointer so child
            // errors append to the same list (spec VirtualMachine.zig:2715).
            struct AggCtx<'a> {
                formatter: *mut crate::console_object::Formatter<'a>,
                writer: *mut bun_core::io::Writer,
                exception_list: *mut ExceptionList,
                allow_ansi_color: bool,
                allow_side_effects: bool,
            }
            extern "C" fn agg_iter(
                _vm: *mut crate::VM,
                _global: &JSGlobalObject,
                ctx: *mut c_void,
                next_value: JSValue,
            ) {
                // SAFETY: `ctx` is `&mut AggCtx` for the duration of `for_each`.
                let ctx = unsafe { bun_ptr::callback_ctx::<AggCtx<'_>>(ctx) };
                // SAFETY: per-thread VM.
                let vm = VirtualMachine::get().as_mut();
                // SAFETY: `formatter`/`writer`/`exception_list` borrow the
                // caller's stack locals, live across the synchronous
                // `for_each` call; reborrow the raw pointers for the
                // recursive call.
                let exception_list = if ctx.exception_list.is_null() {
                    None
                } else {
                    Some(unsafe { &mut *ctx.exception_list })
                };
                vm.print_errorlike_object(
                    next_value,
                    None,
                    exception_list,
                    unsafe { &mut *ctx.formatter },
                    unsafe { &mut *ctx.writer },
                    ctx.allow_ansi_color,
                    ctx.allow_side_effects,
                );
            }
            let mut ctx = AggCtx {
                formatter: std::ptr::from_mut(formatter),
                writer: std::ptr::from_mut(writer),
                exception_list: exception_list
                    .map(|l| std::ptr::from_mut::<ExceptionList>(l))
                    .unwrap_or(core::ptr::null_mut()),
                allow_ansi_color,
                allow_side_effects,
            };
            // Spec VirtualMachine.zig:2717 — `getErrorsProperty` is
            // `getDirect` (own data prop, nothrow); `for_each` may throw, in
            // which case the spec `catch return` swallows it.
            let errors = value.get_errors_property(global_ref);
            let _ = errors.for_each(global_ref, (&raw mut ctx).cast(), agg_iter);
            return;
        }

        // PORT NOTE: reborrow so the Zig `defer { addToErrorList(exception_list) }`
        // tail can still see it after `print_error_from_maybe_private_data`.
        let mut exception_list = exception_list;
        let was_internal = self.print_error_from_maybe_private_data(
            value,
            exception_list.as_deref_mut(),
            formatter,
            writer,
            allow_ansi_color,
            allow_side_effects,
        );

        if was_internal {
            if let Some(exception_) = exception {
                let mut holder = crate::zig_exception::Holder::init();
                // PORT NOTE: Zig calls `holder.deinit(this)` *before*
                // `getStackTrace` (no-op on the empty holder); reordered to
                // the tail for borrowck — semantics unchanged because
                // `need_to_clear_parser_arena_on_deinit` is false here.
                let zig_exception: &mut ZigException = holder.zig_exception();
                exception_.get_stack_trace(global_ref, &mut zig_exception.stack);
                if zig_exception.stack.frames_len > 0 {
                    let _ = Self::print_stack_trace(writer, &zig_exception.stack, allow_ansi_color);
                }
                if let Some(list) = exception_list {
                    let top_level_dir = self.top_level_dir();
                    let _ =
                        zig_exception.add_to_error_list(list, top_level_dir, Some(&self.origin));
                }
                holder.deinit(self);
            }
        }
    }

    /// Spec VirtualMachine.zig:2735 `printErrorFromMaybePrivateData`.
    fn print_error_from_maybe_private_data(
        &mut self,
        value: JSValue,
        exception_list: Option<&mut ExceptionList>,
        formatter: &mut crate::console_object::Formatter,
        writer: &mut bun_core::io::Writer,
        allow_ansi_color: bool,
        allow_side_effects: bool,
    ) -> bool {
        macro_rules! write_msg {
            ($msg:expr, $w:expr, $color:expr) => {
                if $color {
                    let _ = $msg.write_format::<true>(&mut bun_io::AsFmt::new($w));
                } else {
                    let _ = $msg.write_format::<false>(&mut bun_io::AsFmt::new($w));
                }
            };
        }

        if value.js_type() == jsc::JSType::DOMWrapper {
            // `as_class_ref` is the audited `as_::<T>() → &T` backref-deref;
            // R-2: shared borrow — `logged` is `Cell<bool>`.
            if let Some(build_error) = value.as_class_ref::<crate::BuildMessage>() {
                if !build_error.logged.get() {
                    if self.had_errors {
                        let _ = writer.write_all(b"\n");
                    }
                    write_msg!(build_error.msg, writer, allow_ansi_color);
                    build_error.logged.set(true);
                    let _ = writer.write_all(b"\n");
                }
                self.had_errors = self.had_errors || build_error.msg.kind == bun_ast::Kind::Err;
                if exception_list.is_some() {
                    // `log_mut()` is the centralized set-once `Option<NonNull>`
                    // accessor — single audited deref lives there.
                    if let Some(log) = self.log_mut() {
                        let _ = log.add_msg(build_error.msg.clone());
                    }
                }
                bun_core::Output::flush();
                return true;
            } else if let Some(resolve_error) = value.as_class_ref::<crate::ResolveMessage>() {
                if !resolve_error.logged.get() {
                    if self.had_errors {
                        let _ = writer.write_all(b"\n");
                    }
                    write_msg!(resolve_error.msg, writer, allow_ansi_color);
                    resolve_error.logged.set(true);
                    let _ = writer.write_all(b"\n");
                }
                self.had_errors = self.had_errors || resolve_error.msg.kind == bun_ast::Kind::Err;
                if exception_list.is_some() {
                    // `log_mut()` is the centralized set-once `Option<NonNull>`
                    // accessor — single audited deref lives there.
                    if let Some(log) = self.log_mut() {
                        let _ = log.add_msg(resolve_error.msg.clone());
                    }
                }
                bun_core::Output::flush();
                return true;
            }
        }

        if let Err(err) = self.print_error_instance_js(
            value,
            exception_list,
            formatter,
            writer,
            allow_ansi_color,
            allow_side_effects,
        ) {
            if err == bun_core::err!("JSError") {
                self.global().clear_exception();
            } else {
                #[cfg(debug_assertions)]
                {
                    bun_core::pretty_errorln!(
                        "Error while printing Error-like object: {}",
                        err.name()
                    );
                    bun_core::Output::flush();
                }
            }
        }
        false
    }

    /// Spec VirtualMachine.zig:2807 `reportUncaughtException`.
    pub fn report_uncaught_exception(
        global_object: &JSGlobalObject,
        exception: &Exception,
    ) -> JSValue {
        let jsc_vm = global_object.bun_vm().as_mut();
        let _ = jsc_vm.uncaught_exception(global_object, exception.value(), false);
        JSValue::UNDEFINED
    }

    /// Spec VirtualMachine.zig:2813 `printStackTrace`.
    ///
    /// PORT NOTE: Zig is `comptime Writer` + `comptime allow_ansi_colors`;
    /// collapse to runtime bool + concrete writer.
    pub fn print_stack_trace(
        writer: &mut bun_core::io::Writer,
        trace: &crate::ZigStackTrace,
        allow_ansi_colors: bool,
    ) -> Result<(), bun_core::Error> {
        let stack = trace.frames();
        if stack.is_empty() {
            return Ok(());
        }
        // SAFETY: per-thread VM.
        let vm = VirtualMachine::get().as_mut();
        let origin = if vm.is_from_devserver {
            Some(&vm.origin)
        } else {
            None
        };
        let dir = vm.top_level_dir();

        for frame in stack {
            let file_slice = frame.source_url.to_utf8();
            let func_slice = frame.function_name.to_utf8();
            let file = file_slice.slice();
            let func = func_slice.slice();
            if file.is_empty() && func.is_empty() {
                continue;
            }
            // PERF(port): Zig used `std.fmt.count` to test if the formatter
            // emits anything; format into a scratch `String` to probe.
            let has_name = {
                use core::fmt::Write as _;
                let mut probe = String::new();
                let _ = write!(probe, "{}", frame.name_formatter(false));
                !probe.is_empty()
            };

            // PORT NOTE: Zig used `comptime Output.prettyFmt(...)` per arm;
            // route through `bun_core::pretty_fmt!` with a local wrapper that
            // dispatches on the runtime `allow_ansi_colors` flag.
            macro_rules! pretty_write {
                ($fmt:literal $(, $arg:expr)* $(,)?) => {
                    if allow_ansi_colors {
                        write!(writer, bun_core::pretty_fmt!($fmt, true) $(, $arg)*)
                    } else {
                        write!(writer, bun_core::pretty_fmt!($fmt, false) $(, $arg)*)
                    }
                };
            }
            if has_name && !frame.position.is_invalid() {
                pretty_write!(
                    "<r>      <d>at <r>{}<d> (<r>{}<d>)<r>\n",
                    frame.name_formatter(allow_ansi_colors),
                    frame.source_url_formatter(dir, origin, false, allow_ansi_colors)
                )?;
            } else if !frame.position.is_invalid() {
                pretty_write!(
                    "<r>      <d>at <r>{}\n",
                    frame.source_url_formatter(dir, origin, false, allow_ansi_colors)
                )?;
            } else if has_name {
                pretty_write!(
                    "<r>      <d>at <r>{}<d>\n",
                    frame.name_formatter(allow_ansi_colors)
                )?;
            } else {
                pretty_write!(
                    "<r>      <d>at <r>{}<d>\n",
                    frame.source_url_formatter(dir, origin, false, allow_ansi_colors)
                )?;
            }
        }
        Ok(())
    }

    /// Spec VirtualMachine.zig:2904 `remapStackFramePositions`.
    pub fn remap_stack_frame_positions(
        &mut self,
        frames: *mut crate::ZigStackFrame,
        frames_count: usize,
    ) {
        if frames_count == 0 {
            return;
        }
        // **Warning** this method can be called in the heap collector thread!!
        self.remap_stack_frames_mutex.lock();
        // PORT NOTE: Zig `defer unlock()`.

        self.source_mappings.lock();
        let mut table_locked = true;

        // PORT NOTE: the Zig body caches the last `(hash → InternalSourceMap)`
        // pair across the loop and falls back to `resolve_source_mapping` on a
        // miss. The cache is purely a perf optimization (most stacks repeat
        // the same source); port the straightforward per-frame resolve and
        // leave the cache as `// PERF(port)`.
        // SAFETY: caller passes `frames_count` valid `ZigStackFrame`s.
        let frames = unsafe { bun_core::ffi::slice_mut(frames, frames_count) };
        for frame in frames {
            if frame.position.is_invalid() || frame.remapped {
                continue;
            }
            let source_url = frame.source_url.to_utf8();
            let path = source_url.slice();
            if path.is_empty() {
                frame.remapped = true;
                continue;
            }
            // PERF(port): Zig cached `(hash → ism)` across iterations.
            // Slow path: drops and re-acquires the source_mappings lock around
            // resolve_source_mapping(). The `false` write is dead today (the
            // loop body always re-locks before loop-end) but keeps the
            // lock-state invariant explicit per the Zig spec.
            self.source_mappings.unlock();
            #[allow(unused_assignments)]
            {
                table_locked = false;
            }
            if let Some(lookup) = self.resolve_source_mapping(
                path,
                frame.position.line,
                frame.position.column,
                bun_sourcemap::SourceContentHandling::NoSourceContents,
            ) {
                if let Some(source_url) = lookup.display_source_url_if_needed(path) {
                    frame.source_url.deref();
                    frame.source_url = source_url;
                }
                // Spec VirtualMachine.zig:3022 — direct copy; both sides are
                // `bun_core::Ordinal`. A `from_zero_based` round-trip would
                // debug-assert on the valid INVALID (-1) sentinel.
                frame.position.line = lookup.mapping.original.lines;
                frame.position.column = lookup.mapping.original.columns;
                frame.remapped = true;
            } else {
                frame.remapped = true;
            }
            self.source_mappings.lock();
            table_locked = true;
        }

        if table_locked {
            self.source_mappings.unlock();
        }
        self.remap_stack_frames_mutex.unlock();
    }

    /// Spec VirtualMachine.zig:3029 `remapZigException`.
    pub fn remap_zig_exception(
        &mut self,
        exception: &mut ZigException,
        error_instance: JSValue,
        exception_list: Option<&mut ExceptionList>,
        must_reset_parser_arena_later: &mut bool,
        source_code_slice: &mut Option<bun_core::ZigStringSlice>,
        allow_source_code_preview: bool,
    ) {
        // `global()` returns `&'static`, so the borrow detaches from `&self`
        // and survives the `&mut self` reborrows below.
        let global = self.global();
        error_instance.to_zig_exception(global, exception);
        // `Cell<bool>` so the `Tail` drop-guard below can hold a shared `&Cell`
        // and read the *current* value at scope-exit without a raw-ptr deref,
        // while the body freely `.set()`s it (Zig late-evaluated `defer`).
        let enable_source_code_preview = Cell::new(
            allow_source_code_preview
                && !(bun_core::env_var::feature_flag::BUN_DISABLE_SOURCE_CODE_PREVIEW::get()
                    .unwrap_or(false)
                    || bun_core::env_var::feature_flag::BUN_DISABLE_TRANSPILED_SOURCE_CODE_PREVIEW::get()
                        .unwrap_or(false)),
        );

        // PORT NOTE: Zig modeled the two `defer` blocks below at fn-top; in
        // Rust we run them on the way out via this guard so every early
        // `return` is covered.
        struct Tail<'a> {
            this: *mut VirtualMachine,
            exception: *mut ZigException,
            exception_list: Option<&'a mut ExceptionList>,
            enable_source_code_preview: &'a Cell<bool>,
            source_code_slice: *const Option<bun_core::ZigStringSlice>,
        }
        impl Drop for Tail<'_> {
            fn drop(&mut self) {
                // SAFETY: `this`/`exception` are stack-local raw ptrs taken
                // before the body below reborrows them; no overlap at drop.
                let this = unsafe { &mut *self.this };
                let exception = unsafe { &mut *self.exception };
                #[cfg(debug_assertions)]
                {
                    let preview = self.enable_source_code_preview.get();
                    // SAFETY: stack-local raw ptr; live for guard scope.
                    let slice = unsafe { &*self.source_code_slice };
                    if !preview && slice.is_some() {
                        bun_core::Output::panic(format_args!(
                            "Do not collect source code when we don't need to"
                        ));
                    }
                    // SAFETY: `source_lines_numbers[0]` is always valid —
                    // `Holder` backs it with a `[i32; SOURCE_LINES_COUNT]`.
                    if !preview && unsafe { *exception.stack.source_lines_numbers } != -1 {
                        bun_core::Output::panic(format_args!(
                            "Do not collect source code when we don't need to"
                        ));
                    }
                }
                #[cfg(not(debug_assertions))]
                {
                    let _ = (self.enable_source_code_preview, self.source_code_slice);
                }
                if let Some(list) = self.exception_list.take() {
                    let top_level_dir = this.top_level_dir();
                    // Zig `catch unreachable` — OOM-only.
                    bun_core::handle_oom(exception.add_to_error_list(
                        list,
                        top_level_dir,
                        Some(&this.origin),
                    ));
                }
            }
        }
        let _tail = Tail {
            this: self,
            exception,
            exception_list,
            enable_source_code_preview: &enable_source_code_preview,
            source_code_slice,
        };
        // SAFETY: re-borrow through the guard's raw ptrs; `_tail` does not
        // touch them until Drop, so no aliasing during the body.
        let exception: &mut ZigException = unsafe { &mut *_tail.exception };
        let source_code_slice: &mut Option<bun_core::ZigStringSlice> =
            unsafe { &mut *_tail.source_code_slice.cast_mut() };

        /// Spec VirtualMachine.zig:3058 `NoisyBuiltinFunctionMap`.
        fn is_noisy_builtin(name: &bun_core::String) -> bool {
            name.eql_comptime("asyncModuleEvaluation")
                || name.eql_comptime("link")
                || name.eql_comptime("linkAndEvaluateModule")
                || name.eql_comptime("moduleEvaluation")
                || name.eql_comptime("processTicksAndRejections")
        }
        fn is_hidden_frame(f: &crate::ZigStackFrame) -> bool {
            f.source_url.eql_comptime("bun:wrap") || f.function_name.eql_comptime("::bunternal::")
        }
        fn is_unknown_source(url: &bun_core::String) -> bool {
            url.is_empty() || url.eql_comptime("[unknown]") || url.has_prefix_comptime(b"[source:")
        }

        // SAFETY: `frames_ptr[..frames_len]` is the caller-owned `Holder`
        // backing buffer (ZigStackTrace contract).
        let mut frames_len = exception.stack.frames_len as usize;
        let frames_buf =
            unsafe { bun_core::ffi::slice_mut(exception.stack.frames_ptr, frames_len) };

        if self.hide_bun_stackframes {
            let mut start_index: Option<usize> = None;
            for (i, frame) in frames_buf.iter().enumerate() {
                if is_hidden_frame(frame) {
                    start_index = Some(i);
                    break;
                }
                // Workaround for being unable to hide that specific frame
                // without also hiding the frame before it.
                if is_unknown_source(&frame.source_url) && is_noisy_builtin(&frame.function_name) {
                    start_index = Some(0);
                    break;
                }
            }
            if let Some(k) = start_index {
                let mut j = k;
                for i in k..frames_len {
                    let frame = &frames_buf[i];
                    if is_hidden_frame(frame) {
                        continue;
                    }
                    if is_unknown_source(&frame.source_url)
                        && is_noisy_builtin(&frame.function_name)
                    {
                        continue;
                    }
                    // PORT NOTE: `frames[j] = frame`. `ZigStackFrame` impls
                    // `Drop` so `copy_within` is unavailable; swap instead —
                    // the discarded tail past `j` is never read after we
                    // truncate `frames_len` below.
                    frames_buf.swap(j, i);
                    j += 1;
                }
                exception.stack.frames_len = j as u8;
                frames_len = j;
            }
        }

        let frames = &mut frames_buf[..frames_len];
        if frames.is_empty() {
            return;
        }

        // Pick the top-most non-builtin frame for source preview.
        let mut top: usize = 0;
        let mut top_frame_is_builtin = false;
        if self.hide_bun_stackframes {
            for (i, frame) in frames.iter().enumerate() {
                if frame.source_url.has_prefix_comptime(b"bun:")
                    || frame.source_url.has_prefix_comptime(b"node:")
                    || frame.source_url.is_empty()
                    || frame.source_url.eql_comptime("native")
                    || frame.source_url.eql_comptime("unknown")
                    || frame.source_url.eql_comptime("[unknown]")
                    || frame.source_url.has_prefix_comptime(b"[source:")
                {
                    top_frame_is_builtin = true;
                    continue;
                }
                top = i;
                top_frame_is_builtin = false;
                break;
            }
        }

        // Don't show source code preview for REPL frames — it would show the
        // transformed IIFE wrapper code, not what the user typed.
        if frames[top].source_url.eql_comptime("[repl]") {
            enable_source_code_preview.set(false);
        }

        let top_source_url = frames[top].source_url.to_utf8();

        let already_remapped = frames[top].remapped;
        let maybe_lookup: Option<bun_sourcemap::mapping::Lookup> = if already_remapped {
            Some(bun_sourcemap::mapping::Lookup {
                mapping: bun_sourcemap::mapping::Mapping {
                    generated: bun_sourcemap::LineColumnOffset::default(),
                    original: bun_sourcemap::LineColumnOffset {
                        lines: bun_sourcemap::Ordinal::from_zero_based(
                            frames[top].position.line.zero_based().max(0),
                        ),
                        columns: bun_sourcemap::Ordinal::from_zero_based(
                            frames[top].position.column.zero_based().max(0),
                        ),
                    },
                    source_index: 0,
                    name_index: -1,
                },
                source_map: None,
                prefetched_source_code: None,
                name: None,
            })
        } else {
            self.resolve_source_mapping(
                top_source_url.slice(),
                frames[top].position.line,
                frames[top].position.column,
                bun_sourcemap::SourceContentHandling::SourceContents,
            )
        };

        if let Some(lookup) = maybe_lookup {
            // Zig `defer if (source_map) |map| map.deref();` — Arc drop on scope exit.
            let mapping = lookup.mapping;
            let display_url = if !already_remapped {
                lookup.display_source_url_if_needed(top_source_url.slice())
            } else {
                None
            };
            let external_code = if enable_source_code_preview.get()
                && !already_remapped
                && lookup
                    .source_map
                    .as_deref()
                    .is_some_and(|m| m.is_external())
            {
                lookup.get_source_code(top_source_url.slice())
            } else {
                drop(lookup);
                None
            };

            if let Some(src) = display_url {
                frames[top].source_url.deref();
                frames[top].source_url = src;
            }

            let code: bun_core::ZigStringSlice = 'code: {
                if !enable_source_code_preview.get() {
                    break 'code bun_core::ZigStringSlice::EMPTY;
                }
                if let Some(src) = external_code {
                    break 'code src;
                }
                if top_frame_is_builtin {
                    // Avoid printing "export default 'native'"
                    break 'code bun_core::ZigStringSlice::EMPTY;
                }
                let mut log = bun_ast::Log::default();
                let Ok(original_source) = Self::fetch_without_on_load_plugins(
                    self,
                    global,
                    // Spec VirtualMachine.zig:3194 passes `top.source_url` by
                    // value (no `dupeRef`); `bun_core::String` is `Copy`.
                    frames[top].source_url,
                    bun_core::String::empty(),
                    &mut log,
                    FetchFlags::PrintSource,
                ) else {
                    return;
                };
                *must_reset_parser_arena_later = true;
                // PORT NOTE: spec ModuleLoader.zig:358 *borrows*
                // `parse_result.source.contents` for `.print_source`
                // (`bun.String.init`), so the Zig caller has nothing to
                // release. The Rust transpile path must `clone_utf8` instead
                // (the backing `parse_result` drops on return — see
                // jsc_hooks.rs PORT NOTE at the `PrintSource` arm), leaving
                // `source_code` with a +1 strong ref this caller never
                // consumed. `to_utf8()` takes its own ref via
                // `ZigStringSlice::WTF`, so balance the clone here. Also
                // release the `dupe_ref` / `create_if_different` refs on
                // `specifier` / `source_url` — this caller never reads them.
                // Skipping the `source_code` deref leaks one WTFStringImpl
                // (~file-size) per `Bun.inspect(new Error)` and fails
                // inspect-error-leak.test.js.
                let code = original_source.source_code.to_utf8();
                original_source.source_code.deref();
                original_source.specifier.deref();
                original_source.source_url.deref();
                code
            };

            if enable_source_code_preview.get() && code.slice().is_empty() {
                exception.collect_source_lines(error_instance, global);
            }

            // Spec VirtualMachine.zig:3205 — direct copy; both sides are
            // `bun_core::Ordinal`.
            frames[top].position.line = mapping.original.lines;
            frames[top].position.column = mapping.original.columns;
            exception.remapped = true;
            frames[top].remapped = true;

            let last_line = frames[top].position.line.zero_based().max(0);
            if let Some(lines_buf) = bun_core::strings::get_lines_in_text::<
                { crate::zig_exception::Holder::SOURCE_LINES_COUNT },
            >(code.slice(), last_line as u32)
            {
                let lines = lines_buf.as_slice();
                const N: usize = crate::zig_exception::Holder::SOURCE_LINES_COUNT;
                // SAFETY: `Holder` backs both arrays with `[_; SOURCE_LINES_COUNT]`.
                let source_lines =
                    unsafe { bun_core::ffi::slice_mut(exception.stack.source_lines_ptr, N) };
                let source_line_numbers =
                    unsafe { bun_core::ffi::slice_mut(exception.stack.source_lines_numbers, N) };
                for s in source_lines.iter_mut() {
                    *s = bun_core::String::empty();
                }
                source_line_numbers.fill(0);

                let take = lines.len().min(N);
                let mut current_line_number = last_line;
                for (i, line) in lines[..take].iter().enumerate() {
                    // To minimize duplicate allocations, we use the same slice
                    // as above — it should virtually always be UTF-8 and thus
                    // not cloned.
                    source_lines[i] = bun_core::String::init(*line);
                    source_line_numbers[i] = current_line_number;
                    current_line_number -= 1;
                }
                exception.stack.source_lines_len = take as u8;
            }

            if !code.slice().is_empty() {
                *source_code_slice = Some(code);
            }
        } else if enable_source_code_preview.get() {
            exception.collect_source_lines(error_instance, global);
        }

        drop(top_source_url);

        if frames.len() > 1 {
            for i in 0..frames.len() {
                if i == top || frames[i].position.is_invalid() {
                    continue;
                }
                let source_url = frames[i].source_url.to_utf8();
                if let Some(lookup) = self.resolve_source_mapping(
                    source_url.slice(),
                    frames[i].position.line,
                    frames[i].position.column,
                    bun_sourcemap::SourceContentHandling::NoSourceContents,
                ) {
                    if let Some(src) = lookup.display_source_url_if_needed(source_url.slice()) {
                        frames[i].source_url.deref();
                        frames[i].source_url = src;
                    }
                    let mapping = lookup.mapping;
                    frames[i].remapped = true;
                    // Spec VirtualMachine.zig:3257 — direct copy.
                    frames[i].position.line = mapping.original.lines;
                    frames[i].position.column = mapping.original.columns;
                }
            }
        }
    }

    /// Spec VirtualMachine.zig:3265 `printExternallyRemappedZigException`.
    pub fn print_externally_remapped_zig_exception(
        &mut self,
        zig_exception: &mut ZigException,
        formatter: Option<&mut crate::console_object::Formatter>,
        writer: &mut bun_core::io::Writer,
        allow_side_effects: bool,
        allow_ansi_color: bool,
    ) -> Result<(), bun_core::Error> {
        let mut default_formatter = crate::console_object::Formatter::new(self.global());
        let f = formatter.unwrap_or(&mut default_formatter);
        self.print_error_instance_body(
            zig_exception,
            JSValue::ZERO,
            None,
            f,
            writer,
            allow_ansi_color,
            allow_side_effects,
        )
        // `defer default_formatter.deinit()` → Drop.
    }

    /// `printErrorInstance(.js, ...)` — split out from the Zig
    /// `comptime mode: enum { js, zig_exception }` generic.
    fn print_error_instance_js(
        &mut self,
        error_instance: JSValue,
        exception_list: Option<&mut ExceptionList>,
        formatter: &mut crate::console_object::Formatter,
        writer: &mut bun_core::io::Writer,
        allow_ansi_color: bool,
        allow_side_effects: bool,
    ) -> Result<(), bun_core::Error> {
        // PORT NOTE: stack-safety guard for the Error recursion path.
        // Zig's `printErrorInstance` is `comptime Writer`/`allow_ansi_color`/
        // `allow_side_effects`-monomorphized so each instantiation carries
        // only one branch's locals. The Rust port collapses those to runtime
        // bools, so `print_error_instance_body` carries the union of all
        // branches' locals (every `pretty_write!` expands to two `write!`s).
        // More importantly, `remap_zig_exception` below calls
        // `fetch_without_on_load_plugins` → the transpiler for source-line
        // preview, and on Windows that call tree stack-allocates `PathBuffer`s
        // (`MAX_PATH_BYTES = 98302` vs 4096 on Linux). One cycle can therefore
        // exceed the default 256 KB headroom `is_safe_to_recurse()` leaves, so
        // re-check here with an extra `MAX_PATH_BYTES * 3` of slack on Windows
        // to cover the transpiler's nested path buffers — same parity-level
        // protection the Object path gets from C++ `forEachProperty`'s
        // `vm.isSafeToRecurse()`. The formatter's `stack_check` was seated by
        // the caller (`format2` / `Bun.inspect`).
        let extra_headroom: usize = if cfg!(windows) {
            // 3× PathBuffer ≈ 288 KB — empirically enough for the
            // `remap_zig_exception` → `transpile_source_code` chain on the
            // 16K-deep Error test (`bun-inspect.test.ts`).
            bun_paths::MAX_PATH_BYTES * 3
        } else {
            0
        };
        if !formatter
            .stack_check
            .is_safe_to_recurse_with_extra(extra_headroom)
        {
            formatter.failed = true;
            if formatter.can_throw_stack_overflow {
                let _ = self.global().throw_stack_overflow();
            }
            return Ok(());
        }

        // PORT NOTE: `Holder` is ~4 KB (32 ZigStackFrames + 6 source lines +
        // ZigException). Zig stack-allocates it inside a small monomorphized
        // function; here it sits next to the large runtime-dispatched body, so
        // box it to keep the per-level recursion frame small enough for the
        // 16K-deep `bun-inspect.test.ts` Error chain on Windows debug.
        let mut exception_holder = Box::new(crate::zig_exception::Holder::init());
        // PORT NOTE: reshaped for borrowck — `zig_exception()` returns a
        // `&mut` into the holder; we need to also borrow
        // `need_to_clear_parser_arena_on_deinit` disjointly. Route through a
        // raw pointer (the holder is heap-pinned for the call).
        let exception: *mut ZigException = exception_holder.zig_exception();
        let mut source_code_slice: Option<bun_core::ZigStringSlice> = None;

        self.remap_zig_exception(
            // SAFETY: `exception` points into stack-local `exception_holder`.
            unsafe { &mut *exception },
            error_instance,
            exception_list,
            &mut exception_holder.need_to_clear_parser_arena_on_deinit,
            &mut source_code_slice,
            formatter.error_display_level != crate::console_object::ErrorDisplayLevel::Warn,
        );
        error_instance.ensure_still_alive();

        let result = self.print_error_instance_body(
            // SAFETY: see above.
            unsafe { &mut *exception },
            error_instance,
            None, // PORT NOTE: spec passes `exception_list` but it was already
            // consumed by `remap_zig_exception` above (only writer).
            formatter,
            writer,
            allow_ansi_color,
            allow_side_effects,
        );

        drop(source_code_slice);
        // Spec VirtualMachine.zig:3304 `defer exception_holder.deinit(this)` —
        // releases the WTFString refs (`name`/`message`/stack-frame
        // `function_name`/`source_url`/source-line bodies) populated by
        // `JSC__JSValue__toZigException`. Skipping this leaks ~1 KB/error and
        // OOMs the inspect-error-leak test.
        exception_holder.deinit(self);
        result
    }

    /// Spec VirtualMachine.zig:3288 `printErrorInstance` — shared body for both
    /// `mode == .js` (`error_instance != .zero`) and `mode == .zig_exception`
    /// (`error_instance == .zero`). Renders source-line previews, the
    /// name/message line, owned-property dump, stack trace, and the `cause:` /
    /// AggregateError chain.
    #[allow(clippy::too_many_arguments)]
    fn print_error_instance_body(
        &mut self,
        exception: &mut ZigException,
        error_instance: JSValue,
        exception_list: Option<&mut ExceptionList>,
        formatter: &mut crate::console_object::Formatter,
        writer: &mut bun_core::io::Writer,
        allow_ansi_color: bool,
        allow_side_effects: bool,
    ) -> Result<(), bun_core::Error> {
        use crate::JSType;
        use crate::console_object::formatter::TagOptions;
        use crate::console_object::{self, Colon, Tag, TagPayload};

        let prev_had_errors = self.had_errors;
        self.had_errors = true;
        // PORT NOTE: Zig `defer this.had_errors = prev_had_errors;` — restore on
        // every exit (including `?` from `JSError` paths). `BackRef` holds the
        // VM without a live borrow; the write at drop routes through
        // `VirtualMachine::as_mut` (thread-local provenance).
        struct RestoreHadErrors {
            vm: bun_ptr::BackRef<VirtualMachine>,
            prev: bool,
        }
        impl Drop for RestoreHadErrors {
            fn drop(&mut self) {
                // `vm` is the live per-thread VM (caller is on the JS thread).
                self.vm.get().as_mut().had_errors = self.prev;
            }
        }
        let _restore_had_errors = RestoreHadErrors {
            vm: bun_ptr::BackRef::new_mut(self),
            prev: prev_had_errors,
        };

        if allow_side_effects {
            if let Some(debugger) = self.debugger.as_deref_mut() {
                debugger.lifecycle_reporter_agent.report_error(exception);
            }
        }

        // PORT NOTE: Zig `defer if (allow_side_effects and Output.is_github_action)
        // printGithubAnnotation(exception);`.
        struct DeferGhAnnotation {
            run: bool,
            /// BACKREF — borrows the caller's stack-local `ZigException`, live
            /// across this drop guard (declared after the `&mut` rebind so it
            /// drops first).
            exception: bun_ptr::BackRef<ZigException>,
        }
        impl Drop for DeferGhAnnotation {
            fn drop(&mut self) {
                if self.run {
                    VirtualMachine::print_github_annotation(self.exception.get());
                }
            }
        }
        let _defer_gh = DeferGhAnnotation {
            run: allow_side_effects && bun_core::Output::is_github_action(),
            exception: bun_ptr::BackRef::new_mut(exception),
        };

        // Runtime dispatch over `comptime allow_ansi_color` — `pretty_fmt!` is
        // a `const`-param macro, so route through a local wrapper.
        macro_rules! pretty_write {
            ($w:expr, $fmt:literal $(, $arg:expr)* $(,)?) => {
                if allow_ansi_color {
                    write!($w, bun_core::pretty_fmt!($fmt, true) $(, $arg)*)
                } else {
                    write!($w, bun_core::pretty_fmt!($fmt, false) $(, $arg)*)
                }
            };
        }
        // `writer.splatByteAll(' ', n)` — `bun_core::io::Writer` has no native
        // `splat`, so emit in chunks.
        #[inline]
        fn splat_space(w: &mut bun_core::io::Writer, mut n: u64) -> Result<(), bun_core::Error> {
            const SPACES: &[u8; 32] = b"                                ";
            while n > 0 {
                let chunk = n.min(32) as usize;
                w.write_all(&SPACES[..chunk])?;
                n -= chunk as u64;
            }
            Ok(())
        }
        #[inline]
        fn count_digits(n: i32) -> u64 {
            bun_core::fmt::digit_count(n) as u64
        }

        // This is a longer number than necessary because we don't handle this
        // case very well — at the very least, we shouldn't dump 100 KB of
        // minified code into your terminal.
        const MAX_LINE_LENGTH_WITH_DIVOT: usize = 512;
        const MAX_LINE_LENGTH: usize = 1024;

        // SAFETY: `source_lines_numbers[..source_lines_len]` is the
        // caller-owned buffer (see ZigStackTrace contract).
        let line_numbers = exception.stack.source_line_numbers();
        let max_line: i32 = line_numbers.iter().copied().fold(-1, i32::max);
        let max_line_number_pad = count_digits(max_line + 1);

        let mut source_lines = exception.stack.source_line_iterator();
        let mut last_pad: u64 = 0;
        while let Some(source) = source_lines.until_last() {
            let display_line = source.line + 1;
            let int_size = count_digits(display_line);
            let pad = max_line_number_pad.saturating_sub(int_size);
            last_pad = pad;
            splat_space(writer, pad)?;

            let text = source.text.slice();
            let trimmed = text
                .trim_ascii_start()
                .strip_prefix(b"\n")
                .unwrap_or(text)
                .trim_ascii_end();
            // Zig: trimRight(trim(text, "\n"), "\t ") — match by trimming
            // newlines on both sides then trailing tab/space.
            let trimmed = bun_core::trim(text, b"\n");
            let trimmed = bun_core::trim_right(trimmed, b"\t ");
            let clamped = &trimmed[..trimmed.len().min(MAX_LINE_LENGTH)];

            let hl = bun_core::fmt::fmt_javascript(
                clamped,
                bun_core::fmt::HighlighterOptions {
                    enable_colors: allow_ansi_color,
                    ..Default::default()
                },
            );
            if clamped.len() != trimmed.len() {
                if allow_ansi_color {
                    pretty_write!(
                        writer,
                        "<r><b>{} |<r> {}<r><d> | ... truncated <r>\n",
                        display_line,
                        hl
                    )?;
                } else {
                    pretty_write!(writer, "<r><b>{} |<r> {}\n", display_line, hl)?;
                }
            } else {
                pretty_write!(writer, "<r><b>{} |<r> {}\n", display_line, hl)?;
            }
            drop(source.text);
        }
        let _ = last_pad;

        let name = exception.name;
        let message = exception.message;

        let is_error_instance = error_instance != JSValue::ZERO
            && error_instance.is_cell()
            && error_instance.js_type() == JSType::ErrorInstance;
        // NOTE: cannot use `self.global()` — `global_ref` outlives a
        // `&mut self` recursion (`print_error_instance_js`) and is passed to
        // `Formatter<'2>::format`, which requires an unbounded (VM-lifetime)
        // borrow. `global()` returns `&'static` so the borrow detaches.
        let global_ref = self.global();
        // PORT NOTE: Zig keeps a borrowed `[]const u8` whose backing
        // `bun.String` is `defer .deref()`-ed; hold the owning `bun_core::String`
        // alongside the slice so the latin1 view stays live for this fn.
        // `bun_core::String` is `Copy` (no `Drop`), so use a scopeguard to
        // run `.deref()` on every exit path (matches Zig `defer`).
        let mut code_string_guard = scopeguard::guard(None::<bun_core::String>, |s| {
            if let Some(s) = s {
                s.deref();
            }
        });
        let code: Option<&[u8]> = if is_error_instance {
            // SAFETY: `is_error_instance` ⇒ `get_object()` is `Some`.
            let obj = unsafe { &mut *error_instance.get_object().unwrap_unchecked() };
            if let Some(code_value) = obj.get_code_property_vm_inquiry(global_ref) {
                if code_value.is_string() {
                    match code_value.to_bun_string(global_ref) {
                        Ok(code_string) if code_string.is_8bit() => {
                            // SAFETY: `code_string` is moved into
                            // `code_string_guard` and outlives the borrow.
                            let bytes: &[u8] = unsafe {
                                bun_core::ffi::slice(
                                    code_string.latin1().as_ptr(),
                                    code_string.latin1().len(),
                                )
                            };
                            *code_string_guard = Some(code_string);
                            Some(bytes)
                        }
                        Ok(s) => {
                            s.deref();
                            None
                        }
                        Err(_) => bun_core::out_of_memory(),
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        let mut did_print_name = false;
        if let Some(source) = source_lines.next() {
            'brk: {
                if source.text.slice().is_empty() {
                    break 'brk;
                }

                let frames = exception.stack.frames();
                let mut top_frame: Option<&crate::ZigStackFrame> = frames.first();
                if self.hide_bun_stackframes {
                    for frame in frames {
                        if frame.position.is_invalid()
                            || frame.source_url.has_prefix_comptime(b"bun:")
                            || frame.source_url.has_prefix_comptime(b"node:")
                        {
                            continue;
                        }
                        top_frame = Some(frame);
                        break;
                    }
                }

                let text = source.text.slice();
                let trimmed = bun_core::trim(text, b"\n");
                let trimmed = bun_core::trim_right(trimmed, b"\t ");

                if top_frame.is_none() || top_frame.unwrap().position.is_invalid() {
                    did_print_name = true;
                    let clamped = &trimmed[..trimmed.len().min(MAX_LINE_LENGTH)];
                    let hl = bun_core::fmt::fmt_javascript(
                        clamped,
                        bun_core::fmt::HighlighterOptions {
                            enable_colors: allow_ansi_color,
                            ..Default::default()
                        },
                    );
                    if clamped.len() != trimmed.len() {
                        if allow_ansi_color {
                            pretty_write!(
                                writer,
                                "<r><b>- |<r> {}<r><d> | ... truncated <r>\n",
                                hl
                            )?;
                        } else {
                            pretty_write!(writer, "<r><b>- |<r> {}\n", hl)?;
                        }
                    } else {
                        pretty_write!(writer, "<r><d>- |<r> {}\n", hl)?;
                    }
                    Self::print_error_name_and_message(
                        name,
                        message,
                        !exception.browser_url.is_empty(),
                        code,
                        writer,
                        allow_ansi_color,
                        formatter.error_display_level,
                    )?;
                } else if let Some(top) = top_frame {
                    did_print_name = true;
                    let display_line = source.line + 1;
                    let int_size = count_digits(display_line);
                    let pad = max_line_number_pad.saturating_sub(int_size);
                    splat_space(writer, pad)?;

                    let clamped = &trimmed[..trimmed.len().min(MAX_LINE_LENGTH)];
                    let hl = bun_core::fmt::fmt_javascript(
                        clamped,
                        bun_core::fmt::HighlighterOptions {
                            enable_colors: allow_ansi_color,
                            ..Default::default()
                        },
                    );
                    if clamped.len() != trimmed.len() {
                        if allow_ansi_color {
                            pretty_write!(
                                writer,
                                "<r><b>{} |<r> {}<r><d> | ... truncated <r>\n\n",
                                display_line,
                                hl
                            )?;
                        } else {
                            pretty_write!(writer, "<r><b>{} |<r> {}\n\n", display_line, hl)?;
                        }
                    } else {
                        pretty_write!(writer, "<r><b>{} |<r> {}\n", display_line, hl)?;

                        let col = top.position.column.zero_based();
                        if clamped.len() < MAX_LINE_LENGTH_WITH_DIVOT
                            || (col as usize) > MAX_LINE_LENGTH_WITH_DIVOT
                        {
                            let indent =
                                max_line_number_pad + b" | ".len() as u64 + col.max(0) as u64;
                            splat_space(writer, indent)?;
                            pretty_write!(writer, "<red><b>^<r>\n")?;
                        } else {
                            writer.write_all(b"\n")?;
                        }
                    }
                    Self::print_error_name_and_message(
                        name,
                        message,
                        !exception.browser_url.is_empty(),
                        code,
                        writer,
                        allow_ansi_color,
                        formatter.error_display_level,
                    )?;
                }
            }
            drop(source.text);
        }

        if !did_print_name {
            Self::print_error_name_and_message(
                name,
                message,
                !exception.browser_url.is_empty(),
                code,
                writer,
                allow_ansi_color,
                formatter.error_display_level,
            )?;
        }

        // This is usually unsafe to do, but we are protecting them each time first.
        let mut errors_to_append: Vec<JSValue> = Vec::new();
        // PORT NOTE: Zig `defer { for (..) |e| e.unprotect(); deinit(); }`.
        // `BackRef` (constructed from `&raw mut` via `NonNull` so the tag is
        // not popped by later `errors_to_append.push` reborrows) lets the drop
        // body read the Vec safely.
        struct UnprotectAll(bun_ptr::BackRef<Vec<JSValue>>);
        impl Drop for UnprotectAll {
            fn drop(&mut self) {
                // BackRef invariant: borrows the caller's stack `Vec`, live for this scope.
                for v in self.0.iter() {
                    v.unprotect();
                }
            }
        }
        let _unprotect_guard = UnprotectAll(bun_ptr::BackRef::from(
            NonNull::new(&raw mut errors_to_append).expect("stack addr"),
        ));

        if is_error_instance {
            let mut saw_cause = false;
            // SAFETY: `is_error_instance` ⇒ object.
            let error_obj = unsafe { error_instance.get_object().unwrap_unchecked() };
            let mut iterator = crate::JSPropertyIterator::init(
                global_ref,
                error_obj,
                crate::JSPropertyIteratorOptions {
                    include_value: true,
                    skip_empty_name: true,
                    own_properties_only: true,
                    observable: false,
                    only_non_index_properties: true,
                },
            )?;
            let longest_name = iterator.get_longest_property_name().min(10);
            let mut is_first_property = true;
            while let Some(field) = iterator.next()? {
                let value = iterator.value;
                if field.eql_comptime(b"message")
                    || field.eql_comptime(b"name")
                    || field.eql_comptime(b"stack")
                {
                    continue;
                }
                if field.eql_comptime(b"code") && code.is_some() {
                    continue;
                }

                let kind = value.js_type();
                if kind == JSType::ErrorInstance && !prev_had_errors {
                    if field.eql_comptime(b"cause") {
                        saw_cause = true;
                    }
                    value.protect();
                    errors_to_append.push(value);
                } else if kind.is_object()
                    || kind.is_array()
                    || value.is_primitive()
                    || kind.is_string_like()
                {
                    let prev_disable_inspect_custom = formatter.disable_inspect_custom;
                    let prev_quote_strings = formatter.quote_strings;
                    let prev_max_depth = formatter.max_depth;
                    let prev_format_buffer_as_text = formatter.format_buffer_as_text;
                    formatter.depth += 1;
                    formatter.format_buffer_as_text = true;
                    formatter.max_depth = 1;
                    formatter.quote_strings = true;
                    formatter.disable_inspect_custom = true;
                    // PORT NOTE: Zig `defer { restore }` — hand-rolled drop guard.
                    struct RestoreFmt<'a, 'f> {
                        f: &'a mut crate::console_object::Formatter<'f>,
                        d: bool,
                        q: bool,
                        m: u16,
                        b: bool,
                    }
                    impl Drop for RestoreFmt<'_, '_> {
                        fn drop(&mut self) {
                            self.f.depth -= 1;
                            self.f.max_depth = self.m;
                            self.f.quote_strings = self.q;
                            self.f.disable_inspect_custom = self.d;
                            self.f.format_buffer_as_text = self.b;
                        }
                    }
                    let restore = RestoreFmt {
                        f: formatter,
                        d: prev_disable_inspect_custom,
                        q: prev_quote_strings,
                        m: prev_max_depth,
                        b: prev_format_buffer_as_text,
                    };
                    let formatter = &mut *restore.f;

                    let pad_left = longest_name.saturating_sub(field.length());
                    is_first_property = false;
                    splat_space(writer, pad_left as u64)?;
                    pretty_write!(writer, " {}<r><d>:<r> ", field)?;

                    if allow_side_effects && global_ref.has_exception() {
                        global_ref.clear_exception();
                    }

                    let tag = Tag::get_advanced(
                        value,
                        global_ref,
                        TagOptions::DISABLE_INSPECT_CUSTOM | TagOptions::HIDE_GLOBAL,
                    )?;
                    let _ = if allow_ansi_color {
                        formatter.format::<true>(tag, writer, value, global_ref)
                    } else {
                        formatter.format::<false>(tag, writer, value, global_ref)
                    };

                    if allow_side_effects {
                        if global_ref.has_exception() {
                            global_ref.clear_exception();
                        }
                    } else if global_ref.has_exception() || formatter.failed {
                        return Ok(());
                    }

                    pretty_write!(writer, "<r><d>,<r>\n")?;
                }
            }

            if let Some(code_str) = code {
                let pad_left = longest_name.saturating_sub(b"code".len());
                is_first_property = false;
                splat_space(writer, pad_left as u64)?;
                pretty_write!(
                    writer,
                    " code<r><d>:<r> <green>{}<r>\n",
                    bun_core::fmt::quote(code_str)
                )?;
            }

            if !is_first_property {
                writer.write_all(b"\n")?;
            }

            // "cause" is not enumerable, so the above loop won't see it.
            if !saw_cause {
                let key = bun_core::String::static_(b"cause");
                if let Some(cause) = error_instance.get_own(global_ref, &key)? {
                    if cause.is_cell() && cause.js_type() == JSType::ErrorInstance {
                        cause.protect();
                        errors_to_append.push(cause);
                    }
                }
            }
        } else if error_instance != JSValue::ZERO {
            // If you do `reportError([1,2,3])` we should still show something.
            let tag = Tag::get_advanced(
                error_instance,
                global_ref,
                TagOptions::DISABLE_INSPECT_CUSTOM | TagOptions::HIDE_GLOBAL,
            )?;
            if !matches!(tag.tag, TagPayload::NativeCode) {
                let _ = if allow_ansi_color {
                    formatter.format::<true>(tag, writer, error_instance, global_ref)
                } else {
                    formatter.format::<false>(tag, writer, error_instance, global_ref)
                };
                writer.write_all(b"\n")?;
            }
        }

        Self::print_stack_trace(writer, &exception.stack, allow_ansi_color)?;

        if !exception.browser_url.is_empty() {
            pretty_write!(
                writer,
                "    <d>from <r>browser tab <magenta>{}<r>\n",
                exception.browser_url
            )?;
        }

        let mut exception_list = exception_list;
        for &err in &errors_to_append {
            // Circular-ref guard for cause chains.
            if formatter.map_node.is_none() {
                let mut node = NonNull::new(console_object::formatter::visited::Pool::get_node())
                    .expect("ObjectPool::get_node always returns a valid heap node");
                let data = console_object::formatter::visited::node_data_mut(&mut node);
                data.clear();
                formatter.map = core::mem::take(data);
                formatter.map_node = Some(node);
            }

            let entry = formatter.map.get_or_put(err).expect("unreachable");
            if entry.found_existing {
                writer.write_all(b"\n")?;
                pretty_write!(writer, "<r><cyan>[Circular]<r>")?;
                continue;
            }

            writer.write_all(b"\n")?;
            self.print_error_instance_js(
                err,
                exception_list.as_deref_mut(),
                formatter,
                writer,
                allow_ansi_color,
                allow_side_effects,
            )?;
            let _ = formatter.map.remove(&err);
        }

        Ok(())
    }

    /// Spec VirtualMachine.zig:3679 `printErrorNameAndMessage`.
    fn print_error_name_and_message(
        name: bun_core::String,
        message: bun_core::String,
        is_browser_error: bool,
        optional_code: Option<&[u8]>,
        writer: &mut bun_core::io::Writer,
        allow_ansi_color: bool,
        error_display_level: crate::console_object::ErrorDisplayLevel,
    ) -> Result<(), bun_core::Error> {
        use crate::console_object::Colon;
        macro_rules! pretty_write {
            ($fmt:literal $(, $arg:expr)* $(,)?) => {
                if allow_ansi_color {
                    write!(writer, bun_core::pretty_fmt!($fmt, true) $(, $arg)*)
                } else {
                    write!(writer, bun_core::pretty_fmt!($fmt, false) $(, $arg)*)
                }
            };
        }
        if is_browser_error {
            writer.write_all(bun_core::pretty_fmt!("<red>frontend<r> ", true).as_bytes())?;
        }
        if !name.is_empty() && !message.is_empty() {
            let (display_name, display_message) = if name.eql_comptime(b"Error") {
                'brk: {
                    if let Some(code) = optional_code {
                        if bun_core::is_all_ascii(code) {
                            let has_prefix = if message.is_utf16() {
                                let msg_chars = message.utf16();
                                msg_chars.len() > code.len() + 2 + 1
                                    && code
                                        .iter()
                                        .zip(msg_chars.iter())
                                        .all(|(&a, &b)| u16::from(a) == b)
                                    && msg_chars[code.len()] == u16::from(b':')
                                    && msg_chars[code.len() + 1] == u16::from(b' ')
                            } else {
                                let msg_chars = message.latin1();
                                msg_chars.len() > code.len() + 2 + 1
                                    && bun_core::strings::eql_long(
                                        &msg_chars[..code.len()],
                                        code,
                                        false,
                                    )
                                    && msg_chars[code.len()] == b':'
                                    && msg_chars[code.len() + 1] == b' '
                            };
                            if has_prefix {
                                break 'brk (
                                    bun_core::String::init(code),
                                    message.substring(code.len() + 2),
                                );
                            }
                        }
                    }
                    (bun_core::String::empty(), message)
                }
            } else {
                (name, message)
            };
            pretty_write!(
                "{}<b>{}<r>\n",
                error_display_level.formatter(display_name, allow_ansi_color, Colon::IncludeColon),
                display_message,
            )?;
        } else if !name.is_empty() {
            write!(
                writer,
                "{}\n",
                error_display_level.formatter(name, allow_ansi_color, Colon::IncludeColon)
            )?;
        } else if !message.is_empty() {
            pretty_write!(
                "{}<b>{}<r>\n",
                error_display_level.formatter(
                    bun_core::String::empty(),
                    allow_ansi_color,
                    Colon::IncludeColon
                ),
                message,
            )?;
        } else {
            pretty_write!(
                "{}\n",
                error_display_level.formatter(
                    bun_core::String::empty(),
                    allow_ansi_color,
                    Colon::ExcludeColon
                ),
            )?;
        }
        Ok(())
    }

    /// Spec VirtualMachine.zig:3739 `printGithubAnnotation`.
    #[cold]
    #[inline(never)]
    pub fn print_github_annotation(exception: &ZigException) {
        let name = &exception.name;
        let message = &exception.message;
        let frames = exception.stack.frames();
        let top_frame = frames.first();
        let dir = bun_core::env_var::GITHUB_WORKSPACE::get()
            .unwrap_or_else(|| bun_bundler::bun_fs::FileSystem::instance().top_level_dir);
        bun_core::Output::flush();

        let writer = bun_core::Output::error_writer();

        let mut has_location = false;
        if let Some(frame) = top_frame {
            if !frame.position.is_invalid() {
                let source_url = frame.source_url.to_utf8();
                let file = bun_paths::resolve_path::relative(dir, source_url.slice());
                let _ = write!(
                    writer,
                    "\n::error file={},line={},col={},title=",
                    bstr::BStr::new(file),
                    frame.position.line.one_based(),
                    frame.position.column.one_based(),
                );
                has_location = true;
            }
        }
        if !has_location {
            let _ = writer.write_all(b"\n::error title=");
        }

        if name.is_empty() || name.eql_comptime(b"Error") {
            let _ = writer.write_all(b"error");
        } else {
            let _ = write!(writer, "{}", name.github_action());
        }

        if !message.is_empty() {
            let message_slice = message.to_utf8();
            let msg = message_slice.slice();
            let mut cursor: u32 = 0;
            let mut printed_first_line = false;
            while let Some(i) =
                bun_core::strings::index_of_newline_or_non_ascii_or_ansi(msg, cursor)
            {
                cursor = i + 1;
                if msg[i as usize] == b'\n' {
                    let first_line = bun_core::String::borrow_utf8(&msg[..i as usize]);
                    let _ = write!(writer, ": {}::", first_line.github_action());
                    printed_first_line = true;
                    break;
                }
            }
            if !printed_first_line {
                let _ = write!(writer, ": {}::", message.github_action());
            }
            // Skip past the next newline.
            while let Some(i) =
                bun_core::strings::index_of_newline_or_non_ascii_or_ansi(msg, cursor)
            {
                cursor = i + 1;
                if msg[i as usize] == b'\n' {
                    break;
                }
            }
            if cursor > 0 {
                let body = jsc::ZigString::init_utf8(&msg[cursor as usize..]);
                let _ = write!(writer, "{}", body.github_action());
            }
        } else {
            let _ = writer.write_all(b"::");
        }

        if top_frame.is_some() {
            // SAFETY: per-thread VM.
            let vm = VirtualMachine::get();
            let origin = if vm.is_from_devserver {
                Some(&vm.origin)
            } else {
                None
            };
            for frame in frames {
                let source_url = frame.source_url.to_utf8();
                let file = bun_paths::resolve_path::relative(dir, source_url.slice());
                let func = frame.function_name.to_utf8();
                if file.is_empty() && func.slice().is_empty() {
                    continue;
                }
                let name_fmt = frame.name_formatter(false);
                let has_name = {
                    use core::fmt::Write as _;
                    let mut probe = String::new();
                    let _ = write!(probe, "{name_fmt}");
                    !probe.is_empty()
                };
                if has_name {
                    let _ = write!(
                        writer,
                        "%0A      at {} ({})",
                        name_fmt,
                        frame.source_url_formatter(file, origin, false, false),
                    );
                } else {
                    let _ = write!(
                        writer,
                        "%0A      at {}",
                        frame.source_url_formatter(file, origin, false, false),
                    );
                }
            }
        }

        let _ = writer.write_all(b"\n");
        let _ = writer.flush();
    }

    /// Spec VirtualMachine.zig:3864 `resolveSourceMapping`.
    pub fn resolve_source_mapping(
        &mut self,
        path: &[u8],
        line: bun_core::Ordinal,
        column: bun_core::Ordinal,
        source_handling: bun_sourcemap::SourceContentHandling,
    ) -> Option<bun_sourcemap::mapping::Lookup> {
        if let Some(lookup) =
            self.source_mappings
                .resolve_mapping(path, line, column, source_handling)
        {
            return Some(lookup);
        }

        // Spec VirtualMachine.zig:3871-3889 — standalone-module-graph fallback.
        // `graph.find(path).?.sourcemap.load()` reaches into
        // `bun_standalone_graph::{Graph,File,LazySourceMap}` (higher tier);
        // dispatch through [`RuntimeHooks::load_standalone_sourcemap`] per
        // §Dispatch (cold path — one-time decode then cached below).
        // Gate only — the hook reaches the concrete graph via its own
        // `UnsafeCell` singleton (write-provenance), not via this read-only
        // trait object.
        let _ = self.standalone_module_graph?;
        let hooks = runtime_hooks()?;
        // JS-thread call; hook mutates only per-`File` lazy caches under the
        // standalone graph's internal `INIT_LOCK`.
        let map = (hooks.load_standalone_sourcemap)(path)?;

        // Spec: `map.ref(); this.source_mappings.putValue(path, Value.init(map))`.
        // The `Arc::clone` is the ref-bump; `into_raw` transfers that strong
        // ref into the table (reclaimed by `put_value`'s replace path /
        // `SavedSourceMap` teardown). `catch bun.outOfMemory()` → `handle_oom`.
        bun_core::handle_oom(self.source_mappings.put_value(
            path,
            crate::saved_source_map::Value::init(std::sync::Arc::into_raw(std::sync::Arc::clone(
                &map,
            ))),
        ));

        let mapping = map.find_mapping(line, column)?;

        Some(bun_sourcemap::mapping::Lookup {
            mapping,
            source_map: Some(map),
            prefetched_source_code: None,
            name: None,
        })
    }

    /// Spec VirtualMachine.zig:3989 `initIPCInstance`.
    pub fn init_ipc_instance(&mut self, fd: bun_sys::Fd, mode: crate::ipc::Mode) {
        bun_core::scoped_log!(IPC, "initIPCInstance {:?}", fd);
        self.ipc = Some(IPCInstanceUnion::Waiting { fd, mode });
    }

    /// Spec VirtualMachine.zig:3994 `getIPCInstance`.
    pub fn get_ipc_instance(&mut self) -> Option<*mut IPCInstance> {
        let (fd, mode) = match self.ipc.as_ref()? {
            IPCInstanceUnion::Initialized(inst) => return Some(*inst),
            IPCInstanceUnion::Waiting { fd, mode } => (*fd, *mode),
        };

        bun_core::scoped_log!(IPC, "getIPCInstance {:?}", fd);

        self.event_loop_mut().ensure_waker();

        // PORT NOTE: reshaped for borrowck — `rare_data()` borrows `self` and
        // `spawn_ipc_group` then needs `&mut VirtualMachine`. Split via raw
        // pointers (disjoint fields) per the existing `Bun__RareData__*`
        // accessors in virtual_machine_exports.rs.
        let this: *mut VirtualMachine = self;

        #[cfg(not(windows))]
        let instance: *mut IPCInstance = {
            // SAFETY: disjoint borrow — `spawn_ipc_group` only touches the
            // embedded `SocketGroup` field + `vm.uws_loop()`.
            let group: *mut uws::SocketGroup = unsafe {
                let rare = std::ptr::from_mut::<RareData>((*this).rare_data());
                (*rare).spawn_ipc_group(&mut *this)
            };

            // Box the instance first so `data.owner` can name its final
            // address (Zig wrote `.data = undefined` then re-init in place).
            let instance = IPCInstance::new(IPCInstance {
                global_this: self.global,
                group,
                data: crate::ipc::SendQueue::init(
                    mode,
                    // Patched below once the box address is fixed.
                    core::ptr::null_mut::<IPCInstance>() as *mut dyn crate::ipc::SendQueueOwner,
                    crate::ipc::SocketUnion::Uninitialized,
                ),
                has_disconnect_called: false,
            });
            // PROVENANCE: `from_fd` STORES the `*mut SendQueue` in the socket
            // ext slot for the socket's lifetime, so that pointer must derive
            // from the root raw `instance` (SharedReadWrite tag, never popped),
            // NOT from a `&mut IPCInstance` reborrow whose Unique tag would be
            // invalidated by later writes through `instance`. Per-use raw deref
            // also avoids holding a live `&mut` across `deinit` on the failure
            // branch.
            // SAFETY: `instance` was just boxed by `IPCInstance::new`.
            unsafe { (*instance).data.owner = instance as *mut dyn crate::ipc::SendQueueOwner };

            self.ipc = Some(IPCInstanceUnion::Initialized(instance));

            // SAFETY: `group` is the live per-VM SocketGroup; `instance.data`
            // is the freshly-initialized SendQueue stored inline in `*instance`.
            let socket = unsafe {
                crate::ipc::Socket::from_fd::<crate::ipc::SendQueue>(
                    &mut *group,
                    uws::SocketKind::SpawnIpc,
                    fd,
                    core::ptr::addr_of_mut!((*instance).data),
                    true,
                )
            };
            let Some(socket) = socket else {
                IPCInstance::deinit(instance);
                self.ipc = None;
                bun_core::output::warn("Unable to start IPC socket");
                return None;
            };
            socket.set_timeout(0);

            // SAFETY: `instance` is the live boxed IPCInstance.
            unsafe { (*instance).data.socket = crate::ipc::SocketUnion::Open(socket) };

            instance
        };

        #[cfg(windows)]
        let instance: *mut IPCInstance = {
            let instance = IPCInstance::new(IPCInstance {
                global_this: self.global,
                group: (),
                data: crate::ipc::SendQueue::init(
                    mode,
                    // Patched below once the box address is fixed.
                    core::ptr::null_mut::<IPCInstance>() as *mut dyn crate::ipc::SendQueueOwner,
                    crate::ipc::SocketUnion::Uninitialized,
                ),
                has_disconnect_called: false,
            });
            // Per-use raw deref — do NOT bind a `&mut IPCInstance` here: it
            // would remain live across `deinit(instance)` on the failure
            // branch (live `&mut T` to freed memory violates the validity
            // invariant even if never dereferenced).
            // SAFETY: `instance` was just boxed by `IPCInstance::new`.
            unsafe { (*instance).data.owner = instance as *mut dyn crate::ipc::SendQueueOwner };

            self.ipc = Some(IPCInstanceUnion::Initialized(instance));

            // PROVENANCE: `windows_configure_client` STORES the `*mut SendQueue`
            // in `uv_handle_t.data` for the pipe's lifetime, so that pointer
            // must derive from the root raw `instance` (SharedReadWrite tag,
            // never popped), NOT from a `&mut SendQueue` auto-ref whose Unique
            // tag would be invalidated by `(*instance).data.write_version_packet`
            // below — every later libuv read callback would then deref a popped
            // pointer (UB under Stacked Borrows). Mirror the POSIX branch's
            // `addr_of_mut!` treatment.
            // SAFETY: `instance` is the live boxed IPCInstance.
            let data_ptr = unsafe { core::ptr::addr_of_mut!((*instance).data) };
            // SAFETY: `data_ptr` points at the freshly-initialized SendQueue
            // stored inline in `*instance`; no other live `&mut` aliases it.
            if let Err(_) = unsafe { crate::ipc::SendQueue::windows_configure_client(data_ptr, fd) }
            {
                IPCInstance::deinit(instance);
                self.ipc = None;
                bun_core::output::warn(&format_args!("Unable to start IPC pipe '{:?}'", fd));
                return None;
            }

            instance
        };

        // SAFETY: `instance` is the live boxed IPCInstance.
        unsafe { (*instance).data.write_version_packet(self.global()) };

        Some(instance)
    }

    /// To satisfy the interface from NewHotReloader().
    pub fn get_loaders(&mut self) -> &mut bun_ast::LoaderHashTable {
        &mut self.transpiler.options.loaders
    }

    /// To satisfy the interface from NewHotReloader().
    pub fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
        self.transpiler.resolver.bust_dir_cache(path)
    }
}

use core::fmt::Write as _;

fn is_error_like(global_object: &JSGlobalObject, reason: JSValue) -> JsResult<bool> {
    jsc::from_js_host_call_generic(global_object, || {
        Bun__promises__isErrorLike(global_object, reason)
    })
}

fn wrap_unhandled_rejection_error_for_uncaught_exception(
    global_object: &JSGlobalObject,
    reason: JSValue,
) -> JSValue {
    let like = is_error_like(global_object, reason).unwrap_or_else(|_| {
        global_object.clear_exception();
        false
    });
    if like {
        return reason;
    }
    // Zig (VirtualMachine.zig:581-585) opens an explicit `TopExceptionScope`
    // around the call and clears any exception via the scope; the C++ side has a
    // `DECLARE_THROW_SCOPE`, so under `BUN_JSC_validateExceptionChecks=1` the
    // post-call `clear_exception()` (whose own scope ctor asserts) is wrong
    // without a Rust-side scope live across the call.
    let reason_str = {
        crate::top_scope!(scope, global_object);
        let r = Bun__noSideEffectsToString(global_object.vm(), global_object, reason);
        if scope.exception().is_some() {
            scope.clear_exception();
        }
        r
    };
    const MSG_1: &str = "This error originated either by throwing inside of an async function \
        without a catch block, or by rejecting a promise which was not handled with .catch(). \
        The promise rejected with the reason \"";
    if reason_str.is_string() {
        // SAFETY: `as_string()` returns a non-null `*mut JSString` when
        // `is_string()` is true; `view()` borrows it for the `write!` below.
        let view = unsafe { (*reason_str.as_string()).view(global_object) };
        return global_object
            .err(
                crate::ErrorCode::ERR_UNHANDLED_REJECTION,
                format_args!("{MSG_1}{view}\"."),
            )
            .to_js();
    }
    global_object
        .err(
            crate::ErrorCode::ERR_UNHANDLED_REJECTION,
            format_args!("{MSG_1}undefined\"."),
        )
        .to_js()
}

/// Spec PluginRunner.zig:121 `onResolveJSC`.
///
/// LAYERING: moved DOWN from `bun_bundler_jsc::PluginRunner` so
/// `resolve_maybe_needs_trailing_slash` can consult `Bun.plugin()` resolvers
/// without a `bun_jsc → bun_bundler_jsc` cycle. The body only touches
/// `JSGlobalObject`/`JSValue`/`bun_core::String`, all of which live at this
/// tier; `bun_bundler_jsc` re-exports this fn for its own callers.
pub fn plugin_runner_on_resolve_jsc(
    global: &JSGlobalObject,
    namespace: bun_core::String,
    specifier: bun_core::String,
    importer: bun_core::String,
    target: crate::BunPluginTarget,
) -> JsResult<Option<ErrorableString>> {
    use crate::StringJsc as _;
    let Some(on_resolve_plugin) = global.run_on_resolve_plugins(
        if namespace.length() > 0 && !namespace.eql_comptime(b"file") {
            namespace
        } else {
            bun_core::String::static_(b"")
        },
        specifier,
        importer,
        target,
    )?
    else {
        return Ok(None);
    };
    if !on_resolve_plugin.is_object() {
        return Ok(None);
    }
    let Some(path_value) = on_resolve_plugin.get(global, b"path")? else {
        return Ok(None);
    };
    if path_value.is_empty_or_undefined_or_null() {
        return Ok(None);
    }
    if !path_value.is_string() {
        return Ok(Some(ErrorableString::err(
            bun_core::err!(JSErrorObject),
            bun_core::String::static_(b"Expected \"path\" to be a string in onResolve plugin")
                .to_error_instance(global),
        )));
    }

    let file_path = path_value.to_bun_string(global)?;

    if file_path.length() == 0 {
        return Ok(Some(ErrorableString::err(
            bun_core::err!(JSErrorObject),
            bun_core::String::static_(
                b"Expected \"path\" to be a non-empty string in onResolve plugin",
            )
            .to_error_instance(global),
        )));
    } else if file_path.eql_comptime(b".")
        || file_path.eql_comptime(b"..")
        || file_path.eql_comptime(b"...")
        || file_path.eql_comptime(b" ")
    {
        return Ok(Some(ErrorableString::err(
            bun_core::err!(JSErrorObject),
            bun_core::String::static_(b"\"path\" is invalid in onResolve plugin")
                .to_error_instance(global),
        )));
    }
    let user_namespace: bun_core::String = 'brk: {
        if let Some(namespace_value) = on_resolve_plugin.get(global, b"namespace")? {
            if !namespace_value.is_string() {
                return Ok(Some(ErrorableString::err(
                    bun_core::err!(JSErrorObject),
                    bun_core::String::static_(b"Expected \"namespace\" to be a string")
                        .to_error_instance(global),
                )));
            }

            let namespace_str = namespace_value.to_bun_string(global)?;
            if namespace_str.length() == 0 {
                break 'brk bun_core::String::static_(b"file");
            }
            if namespace_str.eql_comptime(b"file") {
                namespace_str.deref();
                break 'brk bun_core::String::static_(b"file");
            }
            if namespace_str.eql_comptime(b"bun") {
                namespace_str.deref();
                break 'brk bun_core::String::static_(b"bun");
            }
            if namespace_str.eql_comptime(b"node") {
                namespace_str.deref();
                break 'brk bun_core::String::static_(b"node");
            }
            break 'brk namespace_str;
        }
        break 'brk bun_core::String::static_(b"file");
    };
    // Spec PluginRunner.zig:212 `defer user_namespace.deref()` — `bun_core::String`
    // is `Copy` (no `Drop`), so guard the WTF refcount across the remaining
    // early-return paths.
    let user_namespace = scopeguard::guard(user_namespace, |s| s.deref());

    // Our slow way of cloning the string into memory owned by JSC.
    use std::io::Write as _;
    let mut combined_string: Vec<u8> = Vec::new();
    write!(&mut combined_string, "{}:{}", *user_namespace, file_path).expect("unreachable");
    let out_ = bun_core::String::borrow_utf8(&combined_string);
    let jsval = match out_.to_js(global) {
        Ok(v) => v,
        Err(_) => {
            return Ok(Some(ErrorableString::err(
                bun_core::err!(JSError),
                global.try_take_exception().unwrap_or(JSValue::UNDEFINED),
            )));
        }
    };
    let out = match jsval.to_bun_string(global) {
        Ok(v) => v,
        Err(_) => {
            return Ok(Some(ErrorableString::err(
                bun_core::err!(JSError),
                global.try_take_exception().unwrap_or(JSValue::UNDEFINED),
            )));
        }
    };
    Ok(Some(ErrorableString::ok(out)))
}

// ported from: src/jsc/VirtualMachine.zig
