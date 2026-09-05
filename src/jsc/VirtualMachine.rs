//! This is the shared global state for a single JS instance execution.
//!
//! Today, Bun is one VM per thread, so the name "VirtualMachine" sort of makes
//! sense. If that changes, this should be renamed `ScriptExecutionContext`.

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use bun_bundler::Transpiler;
use bun_io as Async;
use bun_uws as uws;

use crate::bun_string_jsc;
use crate::counters::Counters;
use crate::event_loop::EventLoop;
use crate::module_loader::{self as ModuleLoader, FetchFlags};
use crate::rare_data::RareData;
use crate::saved_source_map::SavedSourceMap;
use crate::{
    self as jsc, Exception, JSGlobalObject, JSInternalPromise, JSValue, JsResult, OpaqueCallback,
    PlatformEventLoop, ResolvedSource, VM, ZigException,
};

pub use crate::process_auto_killer as ProcessAutoKiller;

// ──────────────────────────────────────────────────────────────────────────
// Exported globals
// ──────────────────────────────────────────────────────────────────────────

// `AtomicBool`/`AtomicI32`/`AtomicUsize` have the same size/alignment as the
// underlying scalar, so the `#[no_mangle]` symbol layout is unchanged for the
// C++ side; Rust gets race-free reads.
#[unsafe(no_mangle)]
static has_bun_garbage_collector_flag_enabled: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);
#[unsafe(no_mangle)]
pub static isBunTest: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
#[unsafe(no_mangle)]
pub(crate) static Bun__defaultRemainingRunsUntilSkipReleaseAccess: core::sync::atomic::AtomicI32 =
    core::sync::atomic::AtomicI32::new(10);

// TODO: evaluate if this has any measurable performance impact.
pub(crate) static SYNTHETIC_ALLOCATION_LIMIT: core::sync::atomic::AtomicUsize =
    core::sync::atomic::AtomicUsize::new(u32::MAX as usize);
#[inline]
pub fn synthetic_allocation_limit() -> usize {
    SYNTHETIC_ALLOCATION_LIMIT.load(core::sync::atomic::Ordering::Relaxed)
}
// `string_allocation_limit` lives in `bun_core` (read by `String::max_length`
// without an upward dep on this crate) and is C-exported there as
// `Bun__stringSyntheticAllocationLimit`.
pub use bun_core::STRING_ALLOCATION_LIMIT;

// ──────────────────────────────────────────────────────────────────────────
// Type aliases
// ──────────────────────────────────────────────────────────────────────────

pub(crate) type OnUnhandledRejection = fn(&mut VirtualMachine, &JSGlobalObject, JSValue);
pub(crate) type MacroMap = bun_collections::ArrayHashMap<i32, JSValue>;
pub type ExceptionList = Vec<crate::exception_list::JsException>;

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine struct (file-level @This())
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct EntryPointResult {
    pub value: crate::strong::Optional, // jsc.Strong.Optional
    pub cjs_set_value: bool,
    /// True when the entry module evaluated as CommonJS: Node reports a CJS
    /// entry's top-level throw with origin `uncaughtException` but an ESM
    /// entry rejection with `unhandledRejection`; the run command consults this.
    pub evaluated_as_cjs: bool,
}

/// Downstream-compat alias: lib.rs previously exposed `virtual_machine::InitOptions`.
/// Carries the cross-tier subset of `Options` that [`init`] and
/// `RuntimeHooks::init_runtime_state` need. `transform_options`/`debugger`
/// live in `bun_options_types` (already a dep of `bun_jsc`), so they thread
/// through here instead of being dropped at the CLI call-site.
pub struct InitOptions {
    /// The CLI's `api.TransformOptions`. Consumed by `RuntimeHooks::init_runtime_state`
    /// → `Transpiler::init(.., configureTransformOptionsForBunVM(args), ..)`.
    pub transform_options: bun_options_types::schema::api::TransformOptions,
    /// Consumed by `RuntimeHooks::init_runtime_state` → `configureDebugger`.
    pub debugger: bun_options_types::context::Debugger,
    /// When `Some`, [`init`] adopts
    /// the caller's log instead of boxing a fresh one (CLI-path macros pass the
    /// transpiler's log so macro load errors land in the bundle output).
    pub log: Option<NonNull<bun_ast::Log>>,
    /// Forwarded to
    /// `RuntimeHooks::init_runtime_state` so the high-tier `Transpiler::init`
    /// reuses the caller's env loader.
    pub env_loader: Option<NonNull<bun_dotenv::Loader>>,
    pub graph: Option<&'static dyn bun_resolver::StandaloneModuleGraph>,
    /// Must be applied to
    /// `transpiler.resolver.store_fd` BEFORE `configure_linker()` reads
    /// `top_level_dir`, so it threads through `init_runtime_state`.
    pub store_fd: bool,
    pub smol: bool,
    pub eval_mode: bool,
    pub is_main_thread: bool,
    /// Forwarded to `Zig__GlobalObject__create` so the C++ ZigGlobalObject is
    /// created with its `WebCore::Worker*` already wired. `null` for the
    /// main-thread / bake paths.
    pub worker_ptr: *mut c_void,
    /// Debugger script-execution-context id. Main thread = 1, workers receive
    /// `WebWorker::execution_context_id`; `None` lets [`init`] derive it from
    /// `is_main_thread` (matches the previous behaviour for non-worker init).
    pub context_id: Option<i32>,
    /// Forwarded as `mini_mode` to `Zig__GlobalObject__create`. For the
    /// main-thread path this is `smol`; for workers it is `WebWorker::mini`.
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
    // LIFETIME-ERASED: `Transpiler<'a>` borrows `log`/`allocator`; VM is
    // self-referential and cannot carry `<'a>`, so we erase to `'static` and the
    // owner guarantees the borrowed `log` outlives the VM (see `init`).
    pub transpiler: Transpiler<'static>,
    /// Hot-reload import watcher (heap `Box`, installed by
    /// [`crate::hot_reloader::HotReloaderCtx::install_bun_watcher`]); null when
    /// hot reload is disabled. Read via [`Self::bun_watcher_ptr`].
    pub bun_watcher: *mut crate::hot_reloader::ImportWatcher,
    pub(crate) console: *mut crate::console_object::ConsoleObject,
    // BORROW_PARAM (`&'a mut bun_ast::Log` per LIFETIMES.tsv) — raw NonNull
    // used because VM is self-referential and cannot carry `<'a>`.
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
    pub(crate) entry_point: bun_bundler::entry_points::ServerEntryPoint,
    pub origin: bun_url::URL<'static>,
    // LAYERING: real type is `Option<Box<bun_runtime::node::fs::NodeFS>>`, but
    // `bun_runtime` is a forward dep of this crate; stored type-erased and
    // cast back by the `bun_runtime` consumers.
    pub node_fs: Option<*mut c_void>,
    /// Opaque per-VM `bun_runtime` state (boxed `timer::All` +
    /// `Body::Value::HiveAllocator` + …). Set by
    /// `RuntimeHooks::init_runtime_state` in [`init`]; reclaimed by
    /// `RuntimeHooks::deinit_runtime_state` in [`destroy`]. Null when no high
    /// tier is installed (e.g. `bun_jsc` unit tests).
    ///
    /// Note: the per-VM timer state and body-value pool live inside this box —
    /// both types are owned by `bun_runtime` (forward dep). Access goes through
    /// [`RuntimeHooks::timer_insert`] / [`RuntimeHooks::body_value_hive_ref`].
    pub runtime_state: *mut c_void,
    pub event_loop_handle: Option<*mut PlatformEventLoop>,
    /// Pending `unref` count drained by the event-loop thread. Atomic because
    /// `KeepAlive::unref_on_next_tick` increments it from OTHER threads
    /// (POSIX only; on Windows that path calls `loop_dec()` instead and the
    /// counter stays at zero).
    pub pending_unref_counter: core::sync::atomic::AtomicI32,
    pub preload: Vec<Box<[u8]>>,
    pub unhandled_pending_rejection_to_capture: Option<*mut JSValue>,
    /// LAYERING: the real type is `bun_runtime`'s
    /// `html_rewriter::RewriterPipe` (a forward dep), stored type-erased.
    ///
    /// The HTMLRewriter sink whose lol-html `write()`/`end()`/`resume()` call
    /// is currently on this VM's native stack, if any. Content handlers reach
    /// their sink through it (to record a thrown exception, and to park the JS
    /// wrapper + pending promise when an async handler suspends the rewrite).
    /// Saved and restored LIFO around every lol-html call, so a handler body
    /// that synchronously starts a nested `transform()` nests correctly.
    /// All-zero bytes decode as `None` (null niche).
    pub html_rewriter_active_sink: Option<core::ptr::NonNull<c_void>>,
    // Note: layering — the concrete `bun_standalone_graph::Graph` lives
    // in a higher-tier crate. The resolver already broke that cycle with the
    // `bun_resolver::StandaloneModuleGraph` trait; we hold the same trait
    // object here so `init_with_module_graph` can hand it straight to
    // `transpiler.resolver.standalone_module_graph` without a downcast.
    pub standalone_module_graph: Option<&'static dyn bun_resolver::StandaloneModuleGraph>,
    pub smol: bool,
    // LAYERING: real type is `bun_runtime::dns_jsc::Order` (forward
    // dep); stored as its `u8` repr.
    pub dns_result_order: u8,
    pub cpu_profiler_config: Option<crate::bun_cpu_profiler::CPUProfilerConfig>,
    pub heap_profiler_config: Option<crate::bun_heap_profiler::HeapProfilerConfig>,
    pub counters: Counters,

    /// `--hot` / `--watch` mode this VM runs under.
    pub hot_reload: HotReload,
    pub jsc_vm: *mut VM,

    /// hide bun:wrap from stack traces
    pub(crate) hide_bun_stackframes: bool,

    pub is_shutting_down: bool,
    /// Set once `on_exit()` is past `RareData::cleanup_hooks`, run or not
    /// (`exit_tears_down_napi_envs`). The list is never walked again, so a hook
    /// pushed after this (a finalizer deferred from the final collection) would only leak.
    pub(crate) has_run_cleanup_hooks: bool,
    pub plugin_runner: Option<crate::plugin_runner::PluginRunner>,
    pub is_main_thread: bool,
    pub exit_handler: ExitHandler,

    pub(crate) default_tls_reject_unauthorized: Option<bool>,
    // LAYERING: real type is `Option<http::HTTPVerboseLevel>` (forward dep);
    // stored as the enum's `u8` repr.
    pub(crate) default_verbose_fetch: core::cell::Cell<Option<u8>>,

    pub source_mappings: SavedSourceMap,

    // BACKREF — `&'a mut Arena` in spirit; caller-owned (web_worker) and
    // outlives the VM.
    pub arena: Option<NonNull<bun_alloc::Arena>>,
    pub has_loaded: bool,
    /// The current entry load reached module evaluation: the root's graph is
    /// linked and executing (set from the moduleLoaderEvaluate hook once the
    /// root record — `Bun__VM__entryRootKey` — is Evaluating; a module some
    /// other root evaluates meanwhile, e.g. a preload's un-awaited import(),
    /// does not count). What is still pending on the entry promise after that
    /// is a top-level await.
    pub entry_evaluation_started: bool,

    pub(crate) had_errors: bool,

    pub macros: MacroMap,
    // LAYERING: values are `MacroEntryPoint` from `bun_bundler::entry_points`
    // (forward dep); stored type-erased and cast back by the consumers.
    pub macro_entry_points: bun_collections::ArrayHashMap<i32, *mut c_void>,
    pub macro_mode: bool,
    /// Depth of live [`MacroModeGuard`]s on this thread. Nonzero exactly while
    /// macro JS may be executing — both `MacroContext::call` and `Macro::init`
    /// (whose `load_macro_entry_point` runs the macro module's top-level via
    /// `wait_for_promise`) hold a guard. `enable_/disable_macro_mode` are gated
    /// on the 0↔1 transition so the guard is reentrant; this is the signal
    /// [`drop_source_code_printer_if_macro_owned`] uses.
    pub(crate) macro_guard_depth: u32,
    pub auto_killer: ProcessAutoKiller::ProcessAutoKiller,

    pub has_any_macro_remappings: bool,
    pub(crate) is_from_devserver: bool,
    pub(crate) has_enabled_macro_mode: bool,

    /// Used by bun:test to set global hooks for beforeAll, beforeEach, etc.
    pub is_in_preload: bool,
    pub has_patched_run_main: bool,

    pub transpiler_store: crate::runtime_transpiler_store::RuntimeTranspilerStore,

    pub(crate) after_event_loop_callback_ctx: Option<*mut c_void>,
    pub(crate) after_event_loop_callback: Option<OpaqueCallback>,

    pub(crate) remap_stack_frames_mutex: bun_threading::Mutex,

    pub argv: Vec<Box<[u8]>>,

    pub origin_timer: std::time::Instant,
    pub(crate) origin_timestamp: u64,
    /// For fake timers: override performance.now() with a specific value (in nanoseconds).
    pub overridden_performance_now: Option<u64>,
    /// For fake timers: the wall-clock time (ms since the Unix epoch) that the
    /// overridden `performance.now() == 0` corresponds to, so that
    /// `performance.timeOrigin + performance.now()` tracks the fake `Date.now()`.
    pub overridden_time_origin: Option<f64>,
    pub(crate) macro_event_loop: EventLoop,
    pub regular_event_loop: EventLoop,
    pub event_loop: *mut EventLoop, // BORROW_FIELD — points at sibling regular_event_loop/macro_event_loop

    pub(crate) ref_strings: crate::ref_string::Map,
    pub(crate) ref_strings_mutex: bun_threading::Mutex,

    pub(crate) active_tasks: usize,

    pub rare_data: Option<Box<RareData>>,
    pub proxy_env_storage: crate::rare_data::ProxyEnvStorage,
    pub(crate) resolved_path_dups: Vec<Box<[u8]>>,
    pub pending_internal_promise: Option<*mut JSInternalPromise>,
    pub pending_internal_promise_is_protected: bool,
    pub pending_internal_promise_reported_at: u32,
    pub(crate) hot_reload_deferred: bool,
    pub entry_point_result: EntryPointResult,

    pub on_unhandled_rejection: OnUnhandledRejection,
    pub on_unhandled_rejection_ctx: Option<*mut c_void>,
    pub on_unhandled_rejection_exception_list: Option<NonNull<ExceptionList>>,
    pub unhandled_error_counter: usize,
    /// When set, `print_error_instance_body` calls this with the remapped
    /// `ZigException` (same lifecycle as the GitHub Actions annotation hook),
    /// so observers can read name/message/stack without re-running the
    /// formatter. Installed by `bun test --reporter=junit` around
    /// `run_error_handler`.
    pub on_print_error_zig_exception: Option<fn(*mut c_void, &ZigException)>,
    pub on_print_error_zig_exception_ctx: *mut c_void,
    pub(crate) is_handling_uncaught_exception: bool,
    pub(crate) exit_on_uncaught_exception: bool,

    pub modules: crate::async_module::Queue,
    pub aggressive_garbage_collection: GCLevel,

    pub module_loader: ModuleLoader::ModuleLoader,

    pub(crate) gc_controller: crate::GarbageCollectionController,
    /// The `WebWorker` whose thread this VM runs on (`None` on the main thread).
    /// The thread holds a ref on it for its whole life.
    pub worker: Option<*const c_void>,
    /// Workers created on this thread and not yet released by it. Parent-thread
    /// only: `WebWorker::create` pushes, `release_parent_poll_ref` removes,
    /// `join_child_workers` drains at exit.
    pub child_workers: Vec<*mut crate::web_worker::WebWorker>,
    /// This VM's live pool jobs (`bun_jsc::job`); JS thread only, zero-valid.
    pub(crate) jobs: crate::JsCell<crate::job::JobList>,
    /// The door out of this thread (`bun_jsc::vm_handle`): tickets for work
    /// that leaves it are taken here, and `teardown` waits on it.
    handle: core::mem::ManuallyDrop<crate::VmHandle>,
    pub pending_ipc: Option<PendingIpc>,
    pub hot_reload_counter: u32,

    pub debugger: Option<Box<crate::debugger::Debugger>>,
    pub(crate) has_started_debugger: bool,
    pub(crate) has_terminated: bool,

    /// `Cell` so [`EventLoop`] (a value field of this struct) can flip the flag
    /// through `vm_ref()` (`&VirtualMachine`) without forming an overlapping
    /// `&mut VirtualMachine` while `&mut EventLoop` is live. Zero-valid
    /// (`Cell<bool>` is `repr(transparent)` over `bool`).
    pub is_inside_deferred_task_queue: core::cell::Cell<bool>,
    /// When true, drainMicrotasksWithGlobal is suppressed. `Cell` for the same
    /// reason as [`Self::is_inside_deferred_task_queue`].
    pub(crate) suppress_microtask_drain: core::cell::Cell<bool>,

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
    pub test_isolation_state: TestIsolationState,
}

#[derive(Default)]
pub struct TestIsolationState {
    pub saved_cwd: Option<Box<[u8]>>,
    /// The time zone the test runner applied at startup (`TZ`, default
    /// `Etc/UTC`). Empty means no override (local time). Re-applied after
    /// every file so a `process.env.TZ` write stays with the file that made it.
    /// `Option` keeps the zero-initialized VM valid (a `Box` has no null niche).
    pub time_zone: Option<Box<[u8]>>,
    /// The proxy env keys as the env map held them at startup, restored after
    /// every file. See [`crate::rare_data::ProxyEnvSnapshot`].
    pub proxy_env: Option<crate::rare_data::ProxyEnvSnapshot>,
    /// The synthetic allocation limit at startup, restored after every file.
    /// `setSyntheticAllocationLimitForTesting` lowers it process-wide.
    pub synthetic_allocation_limit: Option<usize>,
}

// ──────────────────────────────────────────────────────────────────────────
// FFI declarations
// ──────────────────────────────────────────────────────────────────────────

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
    safe fn Bun__closeAllSQLiteDatabasesForTermination(global: &JSGlobalObject);
    safe fn Bun__closeAllNodeSqliteDatabasesForTermination(global: &JSGlobalObject);
    safe fn Bun__WebView__closeAllForTermination();
    safe fn Zig__GlobalObject__prepareForDestruction(global: &JSGlobalObject);
    safe fn Zig__GlobalObject__forbidExecution(global: &JSGlobalObject);
    safe fn Zig__GlobalObject__stopActiveDOMObjectsForTestIsolation(global: &JSGlobalObject);
    safe fn Zig__GlobalObject__destructOnExit(global: &JSGlobalObject);
    safe fn WebWorker__teardownJSCVM(global: &JSGlobalObject);
}

bun_core::define_scoped_log!(teardown_log, Worker, hidden);

pub use bun_options_types::context::HotReload;

/// The `bun build --compile` executable's embedded module graph, if this
/// process is one: set when the first VM is created with it, the same for
/// every VM after.
static STANDALONE_MODULE_GRAPH: std::sync::OnceLock<
    &'static dyn bun_resolver::StandaloneModuleGraph,
> = std::sync::OnceLock::new();

/// See [`STANDALONE_MODULE_GRAPH`]. Any thread.
pub fn standalone_module_graph() -> Option<&'static dyn bun_resolver::StandaloneModuleGraph> {
    STANDALONE_MODULE_GRAPH.get().copied()
}

/// InternalModuleRegistry::generateModule: ahead-of-time bytecode for internal module `id` from a `bun build --compile`
/// executable (process-lifetime bytes JSC may alias), if this process is one and it carries it.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__standaloneInternalModuleBytecode(
    _vm: *mut c_void,
    id: u32,
    bytes: *mut *const u8,
    size: *mut usize,
) -> bool {
    let Some(graph) = standalone_module_graph() else {
        return false;
    };
    let Some(found) = graph.builtin_module_bytecode(id) else {
        return false;
    };
    // SAFETY: out-params supplied by the C++ caller; `found` points into the executable's mapped section.
    unsafe {
        *bytes = found.cast::<u8>();
        *size = found.len();
    }
    true
}

/// Module loader resolve hook: whether `onResolve` plugins could claim a specifier before the builtin/standalone fast paths.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__hasPluginRunner(vm: *mut VirtualMachine) -> bool {
    // SAFETY: `vm` is the live per-thread VM the C++ global object holds.
    unsafe { (*vm).plugin_runner.is_some() }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__hasStandaloneModuleGraph() -> bool {
    standalone_module_graph().is_some()
}

/// `StandaloneGlobalObject::moduleLoaderResolve`: an embedded import specifier names its file directly, so it resolves
/// without entering the resolver. Returns the graph's own spelling of the key (the same bytes on POSIX; on Windows the
/// canonical separator form) so every importer lands on one registry entry, or null if `name` is not an embedded file.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__standaloneModuleKey(
    name: *const u8,
    len: usize,
    out_len: *mut usize,
) -> *const u8 {
    // SAFETY: `name[..len]` is the caller's live 8-bit string buffer.
    let name = unsafe { bun_core::ffi::slice(name, len) };
    if !bun_options_types::standalone_path::is_bun_standalone_file_path(name) {
        return core::ptr::null();
    }
    match standalone_module_graph().and_then(|graph| graph.find_assume_standalone_path(name)) {
        Some(canonical) => {
            // SAFETY: `out_len` is the caller's writable out-parameter.
            unsafe { *out_len = canonical.len() };
            canonical.as_ptr()
        }
        None => core::ptr::null(),
    }
}

/// `StandaloneGlobalObject::moduleLoaderFetch`: an embedded key whose file carries a serialized ES module record, i.e.
/// one the loader can register ahead of JSC's graph walk (CommonJS, JSON, assets take the normal path).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__standaloneModuleHasModuleInfo(name: *const u8, len: usize) -> bool {
    // SAFETY: `name[..len]` is the caller's live 8-bit string buffer.
    let name = unsafe { bun_core::ffi::slice(name, len) };
    bun_options_types::standalone_path::is_bun_standalone_file_path(name)
        && standalone_module_graph().is_some_and(|graph| graph.has_module_info(name))
}

// ──────────────────────────────────────────────────────────────────────────
// Nested types
// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum GCLevel {
    #[default]
    None = 0,
    Mild = 1,
    Aggressive = 2,
}

pub struct UnhandledRejectionScope {
    pub ctx: Option<*mut c_void>,
    pub(crate) on_unhandled_rejection: OnUnhandledRejection,
    pub(crate) count: usize,
}

impl UnhandledRejectionScope {
    pub fn apply(&self, vm: &mut VirtualMachine) {
        vm.on_unhandled_rejection = self.on_unhandled_rejection;
        vm.on_unhandled_rejection_ctx = self.ctx;
        vm.unhandled_error_counter = self.count;
    }
}

/// Thread-local VM holder. Wired to the
/// crate-level `VirtualMachine::get()`/`set_current()` accessors.
pub(crate) struct VMHolder;

static MAIN_THREAD_VM: core::sync::atomic::AtomicPtr<VirtualMachine> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

// `#[thread_local]` (bare `__thread` slot) instead of `thread_local!` macro:
// `LocalKey::__getit` adds a lazy-init check + on some targets a
// `pthread_getspecific` round-trip per access. `get_or_null()` (which reads `VM`) is the
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
    #[inline(always)]
    pub(crate) fn set_vm(vm: Option<*mut VirtualMachine>) {
        VM.set(vm)
    }
    #[inline(always)]
    fn set_cached_global_object(g: Option<*mut JSGlobalObject>) {
        CACHED_GLOBAL_OBJECT.set(g)
    }

    #[unsafe(no_mangle)]
    extern "C" fn Bun__setDefaultGlobalObject(global: *mut JSGlobalObject) {
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
    extern "C" fn Bun__getDefaultGlobalObject() -> Option<NonNull<JSGlobalObject>> {
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
    extern "C" fn Bun__thisThreadHasVM() -> bool {
        VM.get().is_some()
    }

    /// Node parity: `process.kill(self, sig)` with no JS handler for `sig`
    /// flushes the CPU and heap profiles before sending the (likely fatal)
    /// signal, mirroring node's `Kill` binding. Idempotent via `Option::take`.
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__writeProfilesBeforeSelfKill() {
        let Some(vm_ptr) = VM.get() else { return };
        // SAFETY: called on the JS thread that owns this VM (process._kill).
        let vm = unsafe { &mut *vm_ptr };
        if let Some(config) = vm.cpu_profiler_config.take() {
            if let Err(e) =
                crate::bun_cpu_profiler::stop_and_write_profile(vm.jsc_vm_mut(), &config)
            {
                bun_core::Output::err(<&'static str>::from(e), "Failed to write CPU profile", ());
            }
        }
        if let Some(config) = vm.heap_profiler_config.take() {
            if let Err(e) =
                crate::bun_heap_profiler::generate_and_write_profile(vm.jsc_vm_mut(), &config)
            {
                bun_core::Output::err(e, "Failed to write heap profile", ());
            }
        }
        // Node runs RunAtExit (incl. compile cache) on self-directed fatal signals. Non-latching:
        // the signal may prove non-fatal, and latching here would no-op the real exit's persist.
        // https://github.com/nodejs/node/blob/main/src/env.cc (AtExit(FlushCompileCache))
        crate::node_compile_cache::persist_now();
    }
}

#[thread_local]
pub static IS_MAIN_THREAD_VM: Cell<bool> = Cell::new(false);

static IS_SMOL_MODE: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

#[inline]
pub fn is_smol_mode() -> bool {
    IS_SMOL_MODE.load(core::sync::atomic::Ordering::Relaxed)
}

#[derive(Default)]
pub struct ExitHandler {
    pub exit_code: u8,
    /// `bun test` sets this at the end of a run unless `node:test` APIs were used: jest and vitest never fire a test file's `process.on('exit')` listeners.
    pub skip_exit_listeners: bool,
    /// `process.exit()` or a fatal error, as opposed to the event loop running dry.
    /// See `VirtualMachine::exit_tears_down_napi_envs`.
    pub requested: bool,
}

impl ExitHandler {
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__getExitCode(vm: &VirtualMachine) -> u8 {
        vm.exit_handler.exit_code
    }

    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__VM__noteEntryEvaluationStarted(vm: &mut VirtualMachine) {
        vm.entry_evaluation_started = true;
    }

    /// Only a worker's start waits on this (`wait_for_worker_entry_evaluation`);
    /// any other VM answers `true` so the hook's registry probe never runs there.
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__VM__entryEvaluationStarted(vm: &VirtualMachine) -> bool {
        vm.entry_evaluation_started || vm.worker.is_none()
    }

    /// The module-registry key of the current entry load's root: the
    /// `bun:main` wrapper when the entry is transpiled through it, else the
    /// entry path itself (see `reload_entry_point`). Borrowed.
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__VM__entryRootKey(
        vm: &VirtualMachine,
    ) -> bun_core::StringView<'_> {
        if !vm.transpiler.options.disable_transpilation && !vm.main_is_html_entrypoint {
            bun_core::StringView::static_(MAIN_FILE_NAME)
        } else {
            bun_core::StringView::borrow_utf8(vm.main())
        }
    }

    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__setExitCode(vm: &mut VirtualMachine, code: u8) {
        vm.exit_handler.exit_code = code;
    }

    /// Note: spec calls `this.exit_handler.dispatchOnExit()` from a
    /// `*VirtualMachine`. Taking `&mut self: ExitHandler` and recovering the
    /// parent via `container_of` would escape the provenance of `&mut self`
    /// (which only covers the `ExitHandler` field). Callers pass the VM
    /// reference instead; the body re-enters JS so no `&mut` is held.
    pub(crate) fn dispatch_on_exit(vm: &VirtualMachine) {
        let exit_code = vm.exit_handler.exit_code;
        // `process.on('exit')` handlers are user script (see `on_exit`).
        if vm.script_allowed() && !vm.exit_handler.skip_exit_listeners {
            Process__dispatchOnExit(vm.global(), exit_code);
        }
        if vm.worker.is_none() {
            Bun__WebView__closeAllForTermination();
        }
    }

    /// See [`dispatch_on_exit`] for the `&mut self → &VirtualMachine`
    /// signature change.
    pub(crate) fn dispatch_on_before_exit(vm: &VirtualMachine) {
        if !vm.script_allowed() {
            return;
        }
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
pub(crate) const ORIGIN_RELATIVE_EPOCH: i128 = 946_684_800 * 1_000_000_000;

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine impl — core surface (compiles at this tier)
// ──────────────────────────────────────────────────────────────────────────

/// RAII guard returned by [`VirtualMachine::auto_gc_on_drop`]. Calls
/// [`VirtualMachine::auto_garbage_collect`] when dropped.
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
/// [`VirtualMachine::disable_macro_mode`].
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
        let vm_mut = vm.get().as_mut();
        // Reentrant: only the outermost guard flips the VM into macro mode and
        // back; inner guards (e.g. a macro that calls
        // `Bun.Transpiler#transformSync` which itself enters a guard) just bump
        // the depth so their `Drop` doesn't reset `macro_mode`/`event_loop`/
        // `transpiler.target`/`transpiler_store.enabled` underneath the outer.
        vm_mut.macro_guard_depth += 1;
        if vm_mut.macro_guard_depth == 1 {
            vm_mut.enable_macro_mode();
        }
        Self { vm }
    }
}
impl Drop for MacroModeGuard {
    #[inline]
    fn drop(&mut self) {
        // Per `new` contract — `vm` outlives the guard (BackRef invariant).
        let vm_mut = self.vm.get().as_mut();
        vm_mut.macro_guard_depth = vm_mut.macro_guard_depth.saturating_sub(1);
        if vm_mut.macro_guard_depth == 0 {
            vm_mut.disable_macro_mode();
        }
    }
}

// `VirtualMachine` is deliberately `!Send + !Sync` (its raw-pointer fields
// make it so): a `&VirtualMachine`, a pointer to it or to its loops cannot be
// carried to another thread. Other threads hold a `bun_jsc::Ticket` /
// `VmHandle` and reach the VM only by posting to it. Fields mutated post-init
// are wrapped in [`JsCell`] for same-thread interior mutability.
// Fails to compile ("multiple applicable items") if `VirtualMachine` is
// `Send` or `Sync`.
const _: () = {
    trait AmbiguousIfImpl<A> {
        fn some_item() {}
    }
    impl<T: ?Sized> AmbiguousIfImpl<()> for T {}
    impl<T: ?Sized + Send> AmbiguousIfImpl<u8> for T {}
    impl<T: ?Sized + Sync> AmbiguousIfImpl<u16> for T {}
    let _ = <VirtualMachine as AmbiguousIfImpl<_>>::some_item;
};

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
    /// through here, so it is reached several times per `run_callback`. The
    /// previous `.expect()`
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
        // SAFETY: JS thread only (`VirtualMachine` is `!Send + !Sync`).
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
        // SAFETY: JS thread only (`VirtualMachine` is `!Send + !Sync`).
        // Provenance comes from the thread-local `*mut` set in `init()`.
        unsafe { &mut *Self::get_mut_ptr() }
    }

    #[inline(always)]
    pub fn get_or_null() -> Option<*mut VirtualMachine> {
        // thread-local set by init() on this thread; one VM per thread
        VM.get()
    }

    /// The signal handler path (unix only) reaches the main VM through this.
    #[cfg(unix)]
    pub(crate) fn get_main_thread_vm() -> Option<*mut VirtualMachine> {
        let p = MAIN_THREAD_VM.load(core::sync::atomic::Ordering::Acquire);
        if p.is_null() { None } else { Some(p) }
    }

    #[inline]
    pub fn is_loaded() -> bool {
        VM.get().is_some()
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

    /// Returns a raw `*EventLoop` (no aliasing guarantee). Returning `&mut`
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
        // after `init()`; JS thread only (`VirtualMachine` is `!Sync`).
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

    /// A clone of this VM's uncounted [`crate::VmHandle`] — what something
    /// that refers to this VM from elsewhere holds. Work that leaves the thread
    /// on this VM's behalf takes a [`ticket`](Self::ticket) instead.
    #[inline]
    pub fn handle(&self) -> crate::VmHandle {
        (*self.handle).clone()
    }

    #[inline]
    pub(crate) fn handle_ref(&self) -> &crate::VmHandle {
        &self.handle
    }

    /// May native code enter user JavaScript right now? `true` in normal
    /// operation and while the exit handlers run; `false` once teardown has
    /// forbidden execution — the start of [`teardown`](Self::teardown), or
    /// already in `on_exit` for a worker its parent terminated. Node's
    /// `can_call_into_js()`. JS thread.
    ///
    /// This is **not** something callers of `JSValue::call` consult: once
    /// script is forbidden, the native→JS boundary itself
    /// (`Bun__JSValue__call`, WebCore's `JSEventListener`) turns a call into a
    /// silent no-op and JSC discards microtasks — the same model as Node's
    /// `InternalMakeCallback` and WebCore's `isJSExecutionForbidden`. Read it
    /// only for a *resource* decision that differs during teardown (e.g.
    /// "release this parked request instead of waiting for a JS consumer"),
    /// never as a guard in front of a call.
    #[inline]
    pub fn script_allowed(&self) -> bool {
        self.handle.script_allowed()
    }

    /// From here no script runs on this VM: JS entry is refused at the
    /// native→JS boundary (`Bun__JSValue__call`, `EventLoop::run_callback*`,
    /// WebCore's `JSEventListener`) and JSC discards microtasks. Both the
    /// ordinary teardown (after the stop phase) and a parent-terminated
    /// worker's exit (before it) go through here.
    pub fn forbid_script(&self) {
        Zig__GlobalObject__forbidExecution(self.global());
        self.handle.stop();
    }

    /// Which embedded loop is current (`event_loop` points at the regular loop
    /// except while a macro runs). Off-thread completions carry this so they
    /// land on the loop that was current when their work started.
    #[inline]
    pub fn current_loop_kind(&self) -> crate::LoopKind {
        if core::ptr::eq(
            self.event_loop.cast_const(),
            &raw const self.regular_event_loop,
        ) {
            crate::LoopKind::Regular
        } else {
            debug_assert!(core::ptr::eq(
                self.event_loop.cast_const(),
                &raw const self.macro_event_loop
            ));
            crate::LoopKind::Macro
        }
    }

    /// Alias for [`Self::event_loop_mut`]. Kept for callers migrated on the
    /// `runtime-hostfn-safe` branch; both names funnel into the single audited
    /// `unsafe` deref above.
    #[inline(always)]
    #[allow(clippy::mut_from_ref)]
    pub fn event_loop_ref(&self) -> &mut EventLoop {
        self.event_loop_mut()
    }

    /// Let the main VM's heap take the executable's initial module graph without collecting: everything allocated
    /// while it loads is live, so collections before it finishes only re-mark it. The budget is what loading the graph
    /// reads (bytecode, records, string table; capped); after the first collection JSC's usual sizing applies. Workers load a fraction of the graph and
    /// keep the default.
    fn let_heap_take_initial_module_graph(
        &self,
        graph: &'static dyn bun_resolver::StandaloneModuleGraph,
    ) {
        unsafe extern "C" {
            safe fn JSC__Heap__setInitialAllocationBudget(vm: &VM, bytes: usize);
        }
        const MIN_BUDGET: usize = 8 * 1024 * 1024;
        const MAX_BUDGET: usize = 128 * 1024 * 1024;
        let budget = graph
            .module_graph_load_bytes()
            .clamp(MIN_BUDGET, MAX_BUDGET);
        if budget > MIN_BUDGET {
            JSC__Heap__setInitialAllocationBudget(self.jsc_vm(), budget);
        }
    }

    /// Hand the executable's shared bytecode string table (if any) to JSC as this VM's `DecoderStringTable`.
    fn install_bytecode_string_table(
        &self,
        graph: &'static dyn bun_resolver::StandaloneModuleGraph,
    ) {
        unsafe extern "C" {
            fn Bun__DecoderStringTable__install(vm: *mut VM, bytes: *const u8, len: usize);
        }
        let table = graph.bytecode_string_table();
        if table.is_empty() {
            return;
        }
        // SAFETY: `jsc_vm` set in `init()`; `table` is a mmapped process-lifetime span from the executable's own section.
        unsafe { Bun__DecoderStringTable__install(self.jsc_vm, table.as_ptr(), table.len()) };
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
    /// `*mut ImportWatcher` installed by
    /// [`crate::hot_reloader::HotReloaderCtx::install_bun_watcher`] (separate
    /// `Box` heap allocation), or null when hot reload is disabled.
    ///
    /// NOTE: unlike `event_loop_mut`, the pointee is **not** JS-thread-only —
    /// the inner `Box<Watcher>` is held as `&mut Watcher` for the lifetime of
    /// the spawned file-watcher thread (`Watcher::thread_main`), and
    /// `RuntimeTranspilerStore` reads it from transpiler workers. The pointee
    /// guards itself with an internal mutex, so we
    /// return the raw pointer and leave the `unsafe` deref at the call site to
    /// keep the cross-thread hazard visible. Callers must scope any reborrow to
    /// a single mutex-guarded `Watcher` operation.
    #[inline]
    pub(crate) fn bun_watcher_ptr(&self) -> *mut crate::hot_reloader::ImportWatcher {
        self.bun_watcher
    }

    /// `event_loop().enter()` now, `.exit()` on drop. Safe wrapper over
    /// [`EventLoop::enter_scope`] for the common `vm.event_loop()` case.
    #[inline]
    pub fn enter_event_loop_scope(&self) -> crate::event_loop::EventLoopEnterGuard {
        // SAFETY: `self.event_loop` is the live VM-owned event-loop pointer and
        // remains valid for the VM (and thus the guard's) lifetime.
        unsafe { EventLoop::enter_scope(self.event_loop) }
    }

    /// `event_loop().enter()` now, `.exit_without_checkpoint()` on drop, for a
    /// dispatcher that drains microtasks itself: see
    /// [`EventLoop::enter_scope_without_checkpoint`].
    #[inline]
    pub fn enter_event_loop_scope_without_checkpoint(
        &self,
    ) -> crate::event_loop::EventLoopEnterNoCheckpointGuard {
        // SAFETY: as `enter_event_loop_scope`.
        unsafe { EventLoop::enter_scope_without_checkpoint(self.event_loop) }
    }

    /// Safe shared-reference accessor for the process-lifetime dotenv loader
    /// (`vm.transpiler.env`). The loader is allocated once during VM init and
    /// never freed; callers previously open-coded `unsafe { &*vm.transpiler.env }`.
    #[inline]
    pub fn env_loader(&self) -> &'static bun_dotenv::Loader {
        self.env_loader_opt()
            .expect("transpiler.env set during Transpiler::init")
    }

    /// Nullable variant of [`Self::env_loader`] for the early-boot window where
    /// `Transpiler::init` has not yet run (e.g. `GarbageCollectionController::init`
    /// is reached from `JSGlobalObject::create` before `init_runtime_state`).
    #[inline]
    pub(crate) fn env_loader_opt(&self) -> Option<&'static bun_dotenv::Loader> {
        // SAFETY: when non-null, `transpiler.env` is set during `Transpiler::init`
        // to a process-lifetime allocation; never freed while a VM is installed.
        unsafe { self.transpiler.env.as_ref() }
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
    pub(crate) fn debugger_mut(&self) -> Option<&mut crate::debugger::Debugger> {
        self.as_mut().debugger.as_deref_mut()
    }

    /// Safe `&mut uws::Loop` accessor for the per-VM uSockets loop. Same
    /// single-JS-thread soundness contract as [`Self::event_loop_mut`].
    #[inline(always)]
    #[allow(clippy::mut_from_ref)]
    pub fn uws_loop_mut(&self) -> &mut uws::Loop {
        // SAFETY: `uws_loop()` returns the per-VM loop pointer; non-null on
        // the JS thread once `init()` ran; JS thread only (`!Sync`).
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
    pub(crate) fn platform_loop_opt(&self) -> Option<&mut PlatformEventLoop> {
        // SAFETY: when `Some`, `event_loop_handle` was set in `init()` /
        // `ensure_waker()` to the live per-VM uws/uv loop and remains valid
        // for the VM lifetime. Single-JS-thread invariant per `unsafe impl
        // Sync` — only the owning JS thread reborrows mutably.
        self.event_loop_handle.map(|h| unsafe { &mut *h })
    }

    /// Read-then-zero `pending_unref_counter`. `swap(0)` so a concurrent
    /// `increment_pending_unref_counter()` from another thread can't be lost
    /// between the read and the reset.
    #[inline]
    #[cfg(not(windows))]
    pub(crate) fn take_pending_unref(&self) -> i32 {
        self.pending_unref_counter
            .swap(0, core::sync::atomic::Ordering::Relaxed)
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

    /// Returns a small adaptor whose `get()` produces the erased
    /// `js_printer::SourceMapHandler` for `print_with_source_map`.
    ///
    /// Note: takes `*mut BufferPrinter` (raw), not `&'a mut`, because the
    /// SAME `BufferPrinter` is also passed as the live `writer` to
    /// `print_with_source_map`. Creating an `&'a mut` here would alias with
    /// that writer borrow for the entire print; instead we stash the raw
    /// pointer and only reborrow inside `on_source_map_chunk` once the
    /// writer's last use (`print_slice`) has retired. See jsc_hooks.rs
    /// `print_with_source_map` call-site Note.
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

    /// Raw projection to the lazily-allocated `RareData`, for callers holding a borrow into it across re-entry (never forms `&mut RareData`).
    pub fn rare_data_ptr(&mut self) -> *mut RareData {
        if self.rare_data.is_none() {
            self.rare_data();
        }
        match &mut self.rare_data {
            Some(rd) => &raw mut **rd,
            None => unreachable!(),
        }
    }

    pub(crate) fn is_main_thread(&self) -> bool {
        self.worker.is_none()
    }

    pub fn is_inspector_enabled(&self) -> bool {
        self.debugger.is_some()
    }

    pub fn is_shutting_down(&self) -> bool {
        self.is_shutting_down
    }

    pub fn has_run_cleanup_hooks(&self) -> bool {
        self.has_run_cleanup_hooks
    }

    /// Exported to C++ as `Bun__VM__scriptExecutionStatus` via virtual_machine_exports.rs.
    pub fn script_execution_status(&self) -> crate::ScriptExecutionStatus {
        if self.is_shutting_down || !self.script_allowed() {
            crate::ScriptExecutionStatus::Stopped
        } else {
            crate::ScriptExecutionStatus::Running
        }
    }

    /// Per-callback hot path: `drain_microtasks_with_global` calls
    /// `uws_loop_mut()` (→ this) every time the microtask queue drains, and
    /// the only call site there is already gated on
    /// `event_loop_handle.is_some()`.
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
                + el.yield_tasks.len()
                + (el.has_concurrent_tasks() as usize)
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

    pub(crate) fn handled_promise(&self, global_object: &JSGlobalObject, promise: JSValue) -> bool {
        if self.is_shutting_down() {
            return true;
        }
        Bun__emitHandledPromiseEvent(global_object, promise)
    }

    pub(crate) fn default_on_unhandled_rejection(
        this: &mut VirtualMachine,
        _: &JSGlobalObject,
        value: JSValue,
    ) {
        // SAFETY: BORROW_PARAM ptr set by caller; outlives this call.
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
        vm.collect_async(false);
        vm.heap_size()
    }

    #[inline]
    pub fn auto_garbage_collect(&self) {
        if self.aggressive_garbage_collection != GCLevel::None {
            let _ = self.garbage_collect(self.aggressive_garbage_collection == GCLevel::Aggressive);
        }
    }

    /// RAII form of `auto_garbage_collect`: returns a guard that calls
    /// `auto_garbage_collect()` when it goes out of scope.
    #[inline]
    pub fn auto_gc_on_drop(&self) -> AutoGcOnDrop<'_> {
        AutoGcOnDrop { vm: self }
    }

    pub(crate) fn enable_macro_mode(&mut self) {
        if !self.has_enabled_macro_mode {
            self.has_enabled_macro_mode = true;
            self.macro_event_loop = EventLoop::default();
            self.macro_event_loop.virtual_machine = NonNull::new(std::ptr::from_mut(self));
            self.macro_event_loop.global = NonNull::new(self.global);
            self.macro_event_loop.concurrent_tasks = Default::default();
        }
        // Idempotent; outside the `has_enabled_macro_mode` guard because
        // `__bun_macro_context_deinit` runs per-job (RuntimeTranspilerStore
        // scopeguard, JSTranspiler TransformTask, bundler `Worker::deinit`) and
        // frees the printer while this VM survives with the flag still set —
        // the next macro on the same pool thread would otherwise skip re-init
        // and panic at `SOURCE_CODE_PRINTER.get().expect(...)`.
        if SOURCE_CODE_PRINTER.get().is_none() {
            SOURCE_CODE_PRINTER_FROM_MACRO.set(true);
        }
        ensure_source_code_printer();
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

    pub(crate) fn disable_macro_mode(&mut self) {
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

    /// Acquires the JSC API lock for the duration of `f()`.
    ///
    /// Routes `f` through `JSC__VM__holdAPILock` via an `OpaqueWrap`-style C
    /// trampoline so the JSC API lock is held for the full duration of `f()`.
    pub fn run_with_api_lock<F, R>(&self, f: F) -> R
    where
        F: FnOnce() -> R,
    {
        use core::mem::{ManuallyDrop, MaybeUninit};

        // Note: the closure carries its own context, so the trampoline state is
        // just `{ closure, out-slot }`. `ManuallyDrop` lets us move the `FnOnce`
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
        if result.is_termination_exception() {
            return;
        }
        // Save/restore `had_errors` around
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
        // silent no-op here since the real path has observable logic.
        if let Some(hooks) = runtime_hooks() {
            (hooks.print_exception)(self, result, exception_list);
        } else {
            // Low-tier fallback (no `bun_runtime` installed — unit tests):
            // we cannot reach `ConsoleObject::Formatter`, so emit a degraded
            // one-line render via the buffered error writer. The full path
            // routes through `printErrorlikeObject`
            // (which formats name/message/stack); the closest we can do here
            // without the high tier is the value's own `toString`.
            let _ = exception_list;
            let writer = bun_core::Output::error_writer();
            let global = self.global();
            let display = result
                .to_error()
                .unwrap_or(result)
                .to_js_string_view(global)
                .ok();
            match display {
                Some(s) => {
                    let utf8 = s.to_utf8();
                    let _ = writer.write_all(utf8.slice());
                    let _ = writer.write_all(b"\n");
                }
                None => {
                    let _ = writer.write_all(b"[unhandled exception]\n");
                }
            }
            let _ = writer.flush();
        }

        // The hook does not unwind across the dispatch boundary, so restore
        // linearly.
        self.had_errors = prev_had_errors;
    }

    /// Looks up (or
    /// generates) the synthetic `MacroEntryPoint` source for `(entry_path,
    /// function_name, hash)` and evaluates it under the JSC API lock via
    /// [`run_with_api_lock`].
    pub fn load_macro_entry_point(
        &mut self,
        entry_path: &[u8],
        function_name: &[u8],
        specifier: &[u8],
        hash: i32,
    ) -> crate::CrateResult<*mut JSInternalPromise> {
        use bun_bundler::entry_points::{Fs, MacroEntryPoint};
        use bun_collections::hash_map::Entry;
        let entry_point: *mut MacroEntryPoint = match self.macro_entry_points.entry(hash) {
            Entry::Occupied(e) => (*e.get()).cast(),
            Entry::Vacant(v) => {
                let mut ep = Box::new(MacroEntryPoint::default());
                // SAFETY: PathName stores slices with an artificial 'static
                // bound; the generated entry point is
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

        // SAFETY: `entry_point` was just inserted (heap-allocated) or fetched
        // from the cache; it lives for the VM lifetime.
        let path: &[u8] = unsafe { &*entry_point }.source.path.text;
        let promise = self.run_with_api_lock(|| {
            // SAFETY: per-thread VM; the API lock guarantees JSC is held.
            VirtualMachine::get().as_mut()._load_macro_entry_point(path)
        });
        promise.ok_or(crate::CrateError::JSError)
    }

    pub fn is_watcher_enabled(&self) -> bool {
        !self.bun_watcher.is_null()
    }

    /// Whether an error nothing in script handled ends the run. Under
    /// `--hot`/`--watch` it does not: the error is printed and the process keeps
    /// running what it has (servers, timers) until the watcher reloads it.
    /// Counting it in `unhandled_error_counter` there would keep
    /// `is_event_loop_alive()` false for the rest of the process, leaving the
    /// watcher run loop in `tick_possibly_forever()`, which polls I/O but never
    /// drains the timer heap.
    fn unhandled_errors_are_fatal(&self) -> bool {
        !self.is_watcher_enabled()
    }

    /// Thin setter so callers don't need `.with` plumbing on the thread-local.
    #[inline]
    pub fn set_is_main_thread_vm(value: bool) {
        IS_MAIN_THREAD_VM.set(value);
    }

    /// The body lives in `bun_runtime` (it constructs `bun.api.Debugger`), so
    /// dispatch through [`RuntimeHooks::ensure_debugger`] like
    /// [`reload_entry_point`] does. No-op when hooks aren't installed (pure
    /// `bun_jsc` unit tests).
    pub fn ensure_debugger(&mut self, block_until_connected: bool) -> crate::CrateResult<()> {
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
    pub(crate) fn should_destruct_main_thread_on_exit(&self) -> bool {
        bun_core::env_var::feature_flag::BUN_DESTRUCT_VM_ON_EXIT::get().unwrap_or(false)
    }

    pub fn uncaught_exception(
        &mut self,
        global_object: &JSGlobalObject,
        err: JSValue,
        is_rejection: bool,
    ) -> bool {
        // A VM that has stopped (or is being torn down) has nobody to report to; and what a caller took
        // to be an error may be its termination.
        if self.is_shutting_down() || !self.script_allowed() || err.is_termination_exception() {
            return true;
        }

        if isBunTest.load(core::sync::atomic::Ordering::Relaxed) {
            self.unhandled_error_counter += 1;
            (self.on_unhandled_rejection)(self, global_object, err);
            return true;
        }

        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        if self.is_handling_uncaught_exception {
            if !self.is_main_thread() {
                // node parity: a throw inside the uncaughtException handler in a
                // worker exits the worker with code 1 (not the main-thread fatal
                // code 7). Report it to the parent + arm termination via the
                // normal path; process_exit() RETURNS on a worker, so the
                // main-thread process_exit(7)+panic below would crash.
                self.exit_handler.exit_code = 1;
                (self.on_unhandled_rejection)(self, global_object, err);
                return false;
            }
            self.run_error_handler(err, None);
            // SAFETY: `global_object` is the live VM global; `process_exit` is
            // `bun_runtime::node::process::exit` (main-thread `noreturn`).
            unsafe { (hooks.process_exit)(global_object.as_ptr(), 7) };
            panic!("Uncaught exception while handling uncaught exception");
        }
        self.is_handling_uncaught_exception = true;
        let handled = Bun__handleUncaughtException(
            global_object,
            err.to_error().unwrap_or(err),
            if is_rejection { 1 } else { 0 },
        ) > 0;
        if !handled {
            // `beforeExit` has already been dispatched, so the run is winding
            // down and there is no loop turn left to defer to: print the error
            // and exit, like node's fatal-exception path. Main thread only:
            // process_exit() RETURNS on a worker, so the panic would fire; a
            // worker falls through and exits 1 below (e.g. a beforeExit throw).
            // A watcher's run loop dispatches `beforeExit` whenever it drains
            // and keeps turning afterwards, so there the error is only printed.
            if self.exit_on_uncaught_exception
                && self.is_main_thread()
                && self.unhandled_errors_are_fatal()
            {
                self.run_error_handler(err, None);
                // `process_exit` emits `exit`, re-entering here if a listener
                // throws. No handler is running, so drop the recursion guard or
                // that re-entry exits 7 ("handler threw") instead of 1.
                self.is_handling_uncaught_exception = false;
                // SAFETY: see above.
                unsafe { (hooks.process_exit)(global_object.as_ptr(), 1) };
                panic!("made it past process.exit()");
            }
            // TODO maybe we want a separate code path for uncaught exceptions
            if self.unhandled_errors_are_fatal() {
                self.unhandled_error_counter += 1;
            }
            self.exit_handler.exit_code = 1;
            (self.on_unhandled_rejection)(self, global_object, err);
        }
        // Note: this reset must cover BOTH the FFI call and the
        // `onUnhandledRejection` callback above. The flag must stay raised
        // while that callback runs so a re-entrant `uncaught_exception` from
        // a user handler trips the recursion guard and hard-exits with code 7
        // instead of recursing. Neither the FFI call nor the fn-pointer
        // callback unwind past this frame (re-entry hits `process_exit` →
        // `panic!`, which never returns), so a linear reset here suffices.
        self.is_handling_uncaught_exception = false;
        handled
    }

    pub fn hot_map(&mut self) -> Option<&mut crate::rare_data::HotMap> {
        if self.hot_reload != HotReload::Hot {
            return None;
        }
        Some(self.rare_data().hot_map())
    }

    pub fn on_before_exit(&mut self) {
        // Node only emits 'beforeExit' on a natural drain; a fatal uncaught
        // exception that brought us here is an implicit process.exit(1). Arm
        // the hard-exit flag ourselves since we're skipping the dispatch that
        // would have set it, so a throw from an 'exit' listener still stops
        // subsequent listeners.
        if self.unhandled_error_counter > 0 {
            self.exit_on_uncaught_exception = true;
            return;
        }
        ExitHandler::dispatch_on_before_exit(self);
        let mut dispatch = false;
        loop {
            while self.is_event_loop_alive() {
                // A stop requested meanwhile (worker.terminate(), or process.exit()
                // from a listener) ends the drain, as it ends the worker's main
                // loop: what is still in flight is cancelled by teardown, and its
                // completions would no longer be delivered to release the loop.
                if !self.script_allowed() {
                    return;
                }
                self.tick();
                if !self.script_allowed() {
                    return;
                }
                self.auto_tick_active();
                dispatch = true;
            }

            // Same guards as on entry: a fatal throw or a stop requested during
            // the inner drain must not re-dispatch. The main-thread case already
            // hard-exits via `exit_on_uncaught_exception`; this covers workers.
            if dispatch && self.unhandled_error_counter == 0 && self.script_allowed() {
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
        // Decide once whether the exit sequence may run script. It can be
        // entered with an exception pending: `process.exit()` from inside a
        // throwing/catching callback (an ordinary exception — cleared here, as
        // Node's EmitProcessExit does under a TryCatch), or after
        // `worker.terminate()` / a termination request (script must not run at
        // all: no 'exit' handlers or close events for a forcefully terminated
        // worker, matching Node and WebCore's terminate()).
        {
            unsafe extern "C" {
                safe fn Bun__GlobalObject__clearExceptionsForExit(global: &JSGlobalObject);
            }
            Bun__GlobalObject__clearExceptionsForExit(self.global());
            // A worker stopped by its parent (worker.terminate()) runs no exit
            // handlers. A worker exiting on its own — process.exit(), or an
            // uncaught exception — does, even though Bun stops its script with
            // the same trap.
            if self.worker_ref().is_some_and(|w| w.stopped_by_parent()) {
                self.forbid_script();
            }
        }

        // Write CPU profile if profiling was enabled - do this FIRST before any
        // shutdown begins. Grab the config and null it out to make this
        // idempotent.
        if let Some(config) = self.cpu_profiler_config.take() {
            if let Err(e) =
                crate::bun_cpu_profiler::stop_and_write_profile(self.jsc_vm_mut(), &config)
            {
                bun_core::Output::err(<&'static str>::from(e), "Failed to write CPU profile", ());
            }
        }
        // Write heap profile if profiling was enabled - do this after CPU
        // profile but before shutdown.
        if let Some(config) = self.heap_profiler_config.take() {
            if let Err(e) =
                crate::bun_heap_profiler::generate_and_write_profile(self.jsc_vm_mut(), &config)
            {
                bun_core::Output::err(e, "Failed to write heap profile", ());
            }
        }

        ExitHandler::dispatch_on_exit(self);

        // process.exit() never reaches drain_microtasks; flush AutoFlusher sinks here.
        if !self.is_inside_deferred_task_queue.get() {
            self.is_inside_deferred_task_queue.set(true);
            self.event_loop_mut().deferred_tasks.run();
            self.is_inside_deferred_task_queue.set(false);
        }

        self.is_shutting_down = true;

        if self.exit_tears_down_napi_envs() {
            self.run_cleanup_hooks();
        }
        self.has_run_cleanup_hooks = true;

        // Persist the Node compile cache (NODE_COMPILE_CACHE /
        // module.enableCompileCache()) after user exit handlers ran.
        if self.is_main_thread() {
            crate::node_compile_cache::persist_at_exit();
        }
    }

    /// Whether `on_exit()` runs `RareData::cleanup_hooks`, i.e. `NapiEnv::cleanup` for
    /// each addon. Node does this when it frees an environment: a worker's on any exit,
    /// the main thread's only once its loop ran dry (`process.exit()` and a fatal error
    /// call `exit()` instead). `BUN_DESTRUCT_VM_ON_EXIT` destroys the main thread's VM
    /// like a worker's, and that teardown expects the envs to be gone, so it tears them
    /// down on every exit too.
    fn exit_tears_down_napi_envs(&self) -> bool {
        !self.is_main_thread()
            || !self.exit_handler.requested
            || self.should_destruct_main_thread_on_exit()
    }

    /// Drains `RareData::cleanup_hooks`, repeating while the hooks push more (an env's
    /// cleanup defers finalizers onto this list once shutdown has begun). The `Vec` is
    /// taken out of `rare_data` before the hooks run: they re-enter the VM.
    fn run_cleanup_hooks(&mut self) {
        loop {
            let hooks = match self.rare_data.as_deref_mut() {
                Some(rare) if !rare.cleanup_hooks.is_empty() => {
                    core::mem::take(&mut rare.cleanup_hooks)
                }
                _ => break,
            };
            for hook in hooks {
                (hook.func)(hook.ctx);
                // A hook's C signature returns nothing, so one that entered JS
                // (an addon finalizer) leaves what it threw pending: fold it here,
                // this loop being its dispatcher.
                let global = self.global();
                if global.has_exception() {
                    let _ = crate::task::report_error_or_terminate(global, crate::JsError::Thrown);
                }
            }
        }
    }

    pub fn global_exit(&mut self) -> ! {
        debug_assert!(self.is_shutting_down());
        // FIXME: we should be doing this, but we're not, but unfortunately
        // doing it causes like 50+ tests to break
        // self.event_loop().tick();

        if self.should_destruct_main_thread_on_exit() {
            // SAFETY: main-thread VM on the main thread; exit handlers have run.
            unsafe { Self::teardown(core::ptr::from_mut(self), Teardown::MainThreadExit) };
        } else {
            self.close_sqlite_databases_for_exit();
        }
        bun_core::Global::exit(u32::from(self.exit_handler.exit_code))
    }

    /// Checkpoint + close the sqlite connections *this* VM opened, while it is
    /// alive and no user script will touch them again. Never another VM's: a
    /// worker still running when the main thread exits without joining it owns
    /// live objects on another thread; its WAL is recovered on next open, as
    /// after any abrupt exit (and as in Node).
    fn close_sqlite_databases_for_exit(&self) {
        Bun__closeAllSQLiteDatabasesForTermination(self.global());
        Bun__closeAllNodeSqliteDatabasesForTermination(self.global());
    }

    /// Tear down this thread's VM: the one sequence both a finished worker
    /// thread and the exiting main thread (under `BUN_DESTRUCT_VM_ON_EXIT`) run.
    /// The exit handlers ran before this (`on_exit`); nothing below enters script.
    ///
    ///  A. stop — script forbidden (microtasks/modules cleared, termination
    ///     requested), WebCore stop phase (child workers asked to terminate;
    ///     ports/channels/WebSockets closed without events; listeners stripped),
    ///     everything registered as stoppable closed natively (servers,
    ///     listeners, sockets, watchers, subprocess/pipe/tty handles, in-flight
    ///     fetch/S3/Bun.build aborted or cancelled), socket groups and the DNS
    ///     channel closed.
    ///  B. release — cron, user timers and GC-controller timers cancelled; child
    ///     workers joined; this VM's sqlite connections closed; **the wait**:
    ///     every ticket held off-thread comes back while queued work is
    ///     released without running; the handle closes; main: HTTP thread
    ///     parked; RareData's JS handles released.
    ///  C. JSC VM destroyed (finalizers close what only they own; JSC's RunLoop
    ///     timers ride the timer heap until ~VM returns); sockets they closed
    ///     drained; then the timer heap's loop handles closed.
    ///  D. worker: keep-alive delta folded, uSockets loop freed and (Windows)
    ///     the uv loop closed — every handle unlinks while its owner is still
    ///     allocated. Main proceeds to process exit instead.
    ///  E. `destroy()`: RareData, runtime state, event loop.
    ///
    /// # Safety
    /// `this` is this thread's VM and no other thread can reach it any more
    /// (worker: its handle unpublished); `is_shutting_down` is set and
    /// the exit handlers have run.
    pub(crate) unsafe fn teardown(this: *mut Self, kind: Teardown) {
        // SAFETY: per fn contract — sole owner on the owning thread. Shared
        // here; the few `&mut` steps below are statement-scoped, because the
        // hooks re-derive their own access from `this`.
        let vm = unsafe { &*this };
        let hooks = runtime_hooks();

        // ---- A. no more script; stop phase ------------------------------------
        // The user's last word was the exit handlers (`on_exit`, before this).
        // Everything below closes natively and dispatches nothing into JS —
        // Node runs its environment cleanup under a DisallowJavascriptExecution
        // scope, WebCore's ActiveDOMObject::stop() runs no script — so no
        // 'close'/'error' handler runs after 'exit', and nothing can reopen what
        // a sweep just closed.
        vm.forbid_script();
        Zig__GlobalObject__prepareForDestruction(vm.global());
        // SAFETY: fn contract.
        let sweep = || unsafe {
            let _ = Self::stop_phase_sweep(this, kind);
            let second = Self::stop_phase_sweep(this, kind);
            debug_assert!(
                second == SweepResult::Idle,
                "a native close path registered a stoppable resource during teardown"
            );
        };
        sweep();
        // A worker closes its uv loop below (D), so requests still in flight
        // complete here, against this live VM: their handles were just closed,
        // so what remains finishes on its own (threadpool work), and a
        // completion may start more — open a handle, schedule pool work (still
        // accepted, and awaited in B) — hence sweep again after each drain.
        // The exiting main thread neither closes its loop nor may nest uv_run
        // here: process.exit() can be running inside a libuv completion callback.
        #[cfg(windows)]
        if matches!(kind, Teardown::Worker) {
            while bun_sys::windows::libuv::Loop::drain_requests() {
                sweep();
            }
        }
        teardown_log!("teardown: stopped");

        // ---- B. release ------------------------------------------------------
        #[cfg(windows)]
        if let Some(t) = vm.event_loop_mut().forever_timer.take() {
            // SAFETY: live usockets timer from `hold_forever_poll`; closed like
            // any us_timer (freed by its close callback when the loop turns).
            unsafe { uws::Timer::close::<true>(t.as_ptr()) };
        }
        if let Some(hooks) = hooks {
            // SAFETY: fn contract (statement-scoped exclusive access).
            (hooks.stop_cron_for_vm_teardown)(unsafe { &mut *this });
            // Drop every TimeoutObject/ImmediateObject's heap node, JS pin and
            // +1 while runtime state and the JSC heap are alive. The heap itself
            // (and the loop handle it embeds) stays up: JSC's own RunLoop timers
            // — GC activity callbacks, sweeper, deferred work — are WTFTimers on
            // this heap and keep being scheduled until ~VM returns.
            // SAFETY: fn contract.
            unsafe { (hooks.cancel_all_timers)(this) };
            // And unlink every other kind of EventLoopTimer (socket timeouts,
            // reconnect/lifetime timers, schedulers): their owners stay valid
            // and find them CANCELLED, but nothing fires again even where the
            // loop still turns (JSC's timers).
            // SAFETY: fn contract.
            unsafe { (hooks.disarm_all_timers_for_vm_teardown)(this) };
        }
        // SAFETY: fn contract (statement-scoped exclusive access).
        unsafe {
            (*this).gc_controller.deinit();
            crate::web_worker::join_child_workers(&mut *this);
        }
        // Children have closed their own; now this VM's sqlite connections
        // checkpoint and close, before finalizers could.
        vm.close_sqlite_databases_for_exit();
        // The one place the invariant is enforced: nothing below runs until
        // everything that left this thread (pool jobs, fetches, uv work, C++
        // work-queue tasks, child threads) has come back. Whatever arrives
        // meanwhile — and whatever was already queued — is released here, on
        // this thread with the heap alive, never run.
        teardown_log!(
            "teardown: waiting for {} ticket(s) held off-thread",
            vm.handle.tickets_outstanding()
        );
        // A released completion can be a native continuation that opens
        // something new (a multipart upload's next part); sweep again so it is
        // cancelled rather than waited out.
        // SAFETY: fn contract (statement-scoped exclusive access).
        vm.handle.close_and_wait(|| unsafe {
            (*this).release_queued_work();
            let _ = Self::stop_phase_sweep(this, kind);
        });
        // The exiting main thread now parks the process-wide HTTP thread —
        // after the children it also served are joined and this VM's own
        // requests are back — so it cannot touch what process exit frees. If
        // it does not acknowledge (≤1 s), leave the rest to process exit.
        if matches!(kind, Teardown::MainThreadExit) && !bun_http::shutdown_for_exit() {
            teardown_log!("teardown: HTTP thread unresponsive; skipping to process exit");
            return;
        }
        // SAFETY: fn contract (statement-scoped exclusive access).
        unsafe {
            if let Some(rare) = (*this).rare_data.as_deref_mut() {
                rare.release_js_handles();
            }
        }
        teardown_log!("teardown: script forbidden, resources cancelled, off-thread work back");

        // ---- C. JSC VM -------------------------------------------------------
        match kind {
            Teardown::Worker => WebWorker__teardownJSCVM(vm.global()),
            Teardown::MainThreadExit => Zig__GlobalObject__destructOnExit(vm.global()),
        }
        // Finalizers just closed the sockets only they owned; `us_socket_close`
        // queues onto `loop->data.closed_head`, normally freed on the next tick.
        vm.uws_loop_mut().drain_closed_sockets();
        // Nothing schedules a WTFTimer any more: the timer heap's loop handles
        // can go (Windows uv_timer/uv_idle), before the loop close unlinks them.
        if let Some(hooks) = hooks {
            // SAFETY: fn contract; runtime state still installed.
            unsafe { (hooks.close_timer_loop_handles_after_vm_destroyed)(this) };
        }
        teardown_log!("teardown: JSC VM destroyed");

        // ---- D. loops (worker; main exits the process instead) ----------------
        if matches!(kind, Teardown::Worker) {
            // Whatever B/C unref'd through the concurrent counter, folded now:
            // on Windows it shares `active_handles` with libuv and a residue
            // would keep the loop close below spinning.
            vm.event_loop_mut().apply_concurrent_ref_delta();
            // SAFETY: fn contract (statement-scoped exclusive access).
            if let Some(rare) = unsafe { (*this).rare_data.as_deref_mut() } {
                rare.detach_socket_groups_from_loop();
            }
            // SAFETY: this thread's loop; nothing ticks it any more.
            unsafe { (*vm.uws_loop()).internal_loop_data.jsc_vm = core::ptr::null_mut() };
            bun_uws::free_thread_loop();
            teardown_log!("teardown: uSockets loop freed");
            #[cfg(windows)]
            bun_sys::windows::libuv::Loop::close_thread_loop();
            teardown_log!("teardown: loops closed");
        }

        // ---- E. free owners --------------------------------------------------
        // SAFETY: fn contract; last use of `this`.
        unsafe { (*this).destroy() };
    }
}

impl VirtualMachine {
    /// One stop-phase sweep: registered handles (servers, listeners, watchers,
    /// duplex/named-pipe sockets, resolvers), a worker's uv stream/process
    /// handles, every socket group, the VM-global dns channel. Reports whether
    /// it found anything.
    ///
    /// # Safety
    /// As [`teardown`](Self::teardown): sole owner on the owning thread, heap alive.
    unsafe fn stop_phase_sweep(this: *mut Self, kind: Teardown) -> SweepResult {
        let hooks = runtime_hooks();
        let mut result = SweepResult::Idle;
        // Pool jobs parked on something external (a pipe that never becomes
        // readable): their completions then arrive through the wait.
        // SAFETY: fn contract.
        unsafe { (*this).jobs.get() }.cancel_all();
        if let Some(hooks) = hooks {
            // SAFETY: fn contract.
            result = result.and(unsafe { (hooks.stop_active_handles_for_vm_teardown)(this) });
        }
        // A worker's uv loop is closed in D, so every pipe / tty / child-process
        // handle open on it closes now — through whoever drives it (reader,
        // writer, IPC channel, named pipe, Process), or directly if nothing
        // adopted it — so pending writes complete (ECANCELED) against a live VM
        // and no request on them can hold up the loop drain in B. The exiting
        // main thread keeps its loop (the OS reclaims the handles); sweeping
        // them there only re-enters stream owners under still-running script.
        #[cfg(windows)]
        if matches!(kind, Teardown::Worker) {
            bun_sys::windows::libuv::open_handles::stop_all_for_vm_teardown();
        }
        let _ = kind;
        // `close_all_socket_groups` walks the loop's group list through the VM
        // and never touches `rare_data`, so the two accesses are disjoint.
        // SAFETY: fn contract.
        if let Some(rare) = unsafe { (*this).rare_data.as_deref_mut() } {
            // SAFETY: as above.
            result = result.and(rare.close_all_socket_groups(unsafe { &*this }));
        }
        if let Some(hooks) = hooks {
            result = result.and((hooks.stop_dns_for_vm_teardown)());
        }
        result
    }

    /// Release — never run — everything queued on both event loops (tasks,
    /// concurrent tasks, pending immediates) while the JSC heap and this
    /// thread's loop are alive: their JS handles and keep-alives drop now. The
    /// macro loop is only ever ticked explicitly, so whatever a macro queued on
    /// it is still there. Teardown phase B; also the one thing an owner that
    /// calls `destroy()` without a teardown (bake's build VM) must do first.
    pub fn release_queued_work(&mut self) {
        self.regular_event_loop.release_queued_tasks();
        self.macro_event_loop.release_queued_tasks();
        self.transpiler_store.release_queued_jobs_for_teardown();
    }
}

/// Which exit funnel is running [`VirtualMachine::teardown`].
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Teardown {
    Worker,
    MainThreadExit,
}

/// What one stop-phase sweep found (see `VirtualMachine::stop_phase_sweep`).
#[derive(Clone, Copy, PartialEq, Eq)]
#[must_use]
pub enum SweepResult {
    /// Nothing was registered / open / pending; the sweep did no work.
    Idle,
    /// The sweep stopped or closed at least one thing (whose close handlers may
    /// have opened something else).
    Stopped,
}

impl SweepResult {
    pub fn and(self, other: SweepResult) -> SweepResult {
        if self == SweepResult::Stopped || other == SweepResult::Stopped {
            SweepResult::Stopped
        } else {
            SweepResult::Idle
        }
    }
}

extern crate alloc;

// ──────────────────────────────────────────────────────────────────────────
// §Dispatch — `bun_runtime` vtable.
//
// `init` / `load_entry_point` / the `bun -e` path reach into types that live
// in the higher-tier `bun_runtime` crate (`timer::All`, `node::fs`,
// `webcore::Body`, the bundler entry-point generator, …). Per PORTING.md
// §Dispatch (cold-path), the low tier defines a manual vtable; `bun_runtime`
// defines the `#[no_mangle]` static `__BUN_RUNTIME_HOOKS`. The fn-ptr
// indirection at every call site below is acceptable — each does
// real work (I/O, JS callback, allocation).
// ──────────────────────────────────────────────────────────────────────────

/// Opaque per-VM state owned by `bun_runtime` (Timer::All, NodeFS, Body hive
/// allocator, …). Stored as `*mut c_void` in `VirtualMachine`; the high tier
/// casts back on the other side of each hook.
pub type RuntimeState = *mut c_void;

/// Runtime flags a Worker's `execArgv` can set. `true` means allowed.
#[derive(Copy, Clone, Debug)]
pub struct WorkerExecArgvFlags {
    /// `!--no-addons`
    pub allow_addons: bool,
    /// `!--no-ffi-cc`
    pub allow_ffi_cc: bool,
}

pub struct RuntimeHooks {
    /// `bun.api.Timer.All.init()` + `Body.Value.HiveAllocator.init()` +
    /// `configureDebugger()` — everything `init()` does that names a
    /// `bun_runtime` type. Called once with the freshly-boxed VM AFTER
    /// `vm.global` / `vm.jsc_vm` are populated;
    /// returns the opaque per-VM runtime state pointer (or null). `Err` when
    /// `Transpiler::init` fails (e.g. a deleted cwd → `getcwd` ENOENT); the
    /// hook unwinds its own allocations, so [`VirtualMachine::init`] only has to
    /// propagate the error.
    pub init_runtime_state: unsafe fn(
        vm: *mut VirtualMachine,
        opts: &mut InitOptions,
    ) -> crate::CrateResult<RuntimeState>,
    /// Reclaim the per-VM state boxed by `init_runtime_state`. Called from
    /// [`VirtualMachine::destroy`] (worker teardown) with the exact opaque
    /// pointer `init_runtime_state` returned (or null). The high tier
    /// `heap::take`s it and clears its thread-local cache. Without this slot
    /// every worker leaked one box.
    pub deinit_runtime_state: unsafe fn(vm: *mut VirtualMachine, state: RuntimeState),
    /// `ServerEntryPoint.generate(watch, entry_path)` — produces the synthetic
    /// `bun:main` module body for `entry_path`. Returns `false` on error
    /// (error already logged into `vm.log`).
    pub generate_entry_point: fn(vm: &VirtualMachine, watch: bool, entry_path: &[u8]) -> bool,
    /// `loadPreloads()` — runs `--preload` scripts. Returns the first rejected
    /// preload promise if any, else null. Errors propagate
    /// (resolver failures / `ModuleNotFound`).
    pub load_preloads:
        unsafe fn(vm: *mut VirtualMachine) -> crate::CrateResult<*mut JSInternalPromise>,
    /// `ensureDebugger(block_until_connected)` — no-op when no debugger.
    pub ensure_debugger: unsafe fn(vm: *mut VirtualMachine, block_until_connected: bool),
    /// `eventLoop().autoTick()` — needs `Timer::All` for the timeout calc.
    /// Hoisted here so `event_loop.rs` doesn't need its own hook table.
    pub auto_tick: unsafe fn(vm: *mut VirtualMachine),
    /// `eventLoop().autoTickActive()` — like `auto_tick` but only sleeps in
    /// the uSockets loop while it has active handles.
    /// Separate slot because the body skips `runImminentGCTimer` /
    /// `handleRejectedPromises` and falls through to `tickWithoutIdle` when
    /// idle — folding it into `auto_tick` would change shutdown semantics.
    pub auto_tick_active: unsafe fn(vm: *mut VirtualMachine),
    /// `printException` / `printErrorlikeObject` — formats `value` (or its
    /// wrapped `JSC::Exception`) to stderr via `ConsoleObject::Formatter`.
    /// High tier
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
    /// (`bun_runtime`, b2-cycle).
    pub default_client_ssl_ctx: fn(vm: &VirtualMachine) -> *mut uws::SslCtx,
    /// `RareData.sslCtxCache().getOrCreateOpts(opts, &err)` — per-VM
    /// digest-keyed weak `SSL_CTX*` cache. Returns a +1 ref or `None` on
    /// BoringSSL rejection (`err` populated). `SSLContextCache` lives in
    /// `bun_runtime::RuntimeState` (b2-cycle).
    pub ssl_ctx_cache_get_or_create: fn(
        vm: &VirtualMachine,
        opts: &uws::SocketContext::BunSocketContextOptions,
        err: &mut uws::create_bun_socket_error_t,
    ) -> Option<bun_boringssl::c::OwnedSslCtx>,
    /// Lazy `NodeFS` creation.
    /// `NodeFS` lives in `bun_runtime`; the high tier boxes one and returns
    /// the type-erased pointer. Stored back into `vm.node_fs`.
    pub create_node_fs: unsafe fn(vm: *mut VirtualMachine) -> *mut c_void,
    /// `ObjectURLRegistry` lookup. Registry lives in `bun_runtime::webcore`.
    pub has_blob_url: fn(blob_id: &[u8]) -> bool,
    /// `Response::get_blob_without_call_frame` /
    /// `Request::get_blob_without_call_frame`. If
    /// `value` downcasts to a `Response` or `Request` (both live in
    /// `bun_runtime::webcore`), return its body Blob wrapped in a resolved
    /// Promise; `Ok(None)` to fall through to the `Blob`/`BuildMessage`/
    /// `ResolveMessage` arms in `Macro::Run::coerce`.
    pub body_mixin_get_blob:
        fn(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<JSValue>>,
    /// `process.exit(global, code)`. Main-thread is `noreturn`; in a worker
    /// it returns and the caller `panic!`s. Lives in `bun_runtime::node`
    /// (forward-dep cycle), so [`uncaught_exception`] reaches it through this
    /// slot instead of the linker.
    pub process_exit: unsafe fn(global: *mut JSGlobalObject, code: u8),
    /// `onBeforePrint()` for the `bun:test` runner, which lives in `bun_runtime`;
    /// `console.log` calls this so the test reporter can flush its line state
    /// before user output interleaves with it. No-op when `bun test` isn't
    /// running.
    pub console_on_before_print: fn(),
    /// `ConsoleObject.Formatter` runtime-type dispatch
    /// over `Response`/`Request`/`Blob`/`S3Client`/`Archive`/
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
        enable_ansi_colors: bool,
    ) -> JsResult<bool>,
    /// Applies `--compile`-baked runtime flags to the
    /// worker's transpiler. `graph` is the same trait object stored in
    /// `vm.standalone_module_graph` (the high tier downcasts to its concrete
    /// `bun_standalone_graph::Graph` — the sole implementor).
    pub apply_standalone_runtime_flags: unsafe fn(
        transpiler: *mut Transpiler<'static>,
        graph: &'static dyn bun_resolver::StandaloneModuleGraph,
    ),
    /// Parse a Worker's `execArgv` for the flags in [`WorkerExecArgvFlags`].
    /// `None` if parsing failed.
    pub parse_worker_exec_argv_flags:
        unsafe fn(exec_argv: &[bun_core::WTFStringImpl]) -> Option<WorkerExecArgvFlags>,
    /// `CronJob.clearAllForVM(vm, .teardown)`. `CronJob` lives in
    /// `bun_runtime::api::cron`.
    pub stop_cron_for_vm_teardown: fn(vm: &mut VirtualMachine),
    /// `CronJob.clearAllForVM(vm, .reload)`.
    /// Same impl as `stop_cron_for_vm_teardown` but
    /// the `.reload` mode preserves the next-fire schedule across the new
    /// global so timers re-register instead of being torn down.
    pub cron_clear_all_reload: fn(vm: &mut VirtualMachine),
    /// Standalone-graph sourcemap load.
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
    /// `TestReporterAgent.retroactivelyReportDiscoveredTests(agent, next_test_id)`.
    /// Walks the active test file's
    /// scope tree and emits `reportTestFoundWithLocation` for every test
    /// discovered before the inspector connected. `Jest` / `DescribeScope`
    /// live in `bun_runtime::test_runner` (forward-dep cycle), so the body is
    /// hoisted to the high tier; low-tier `Bun__TestReporterAgentEnable`
    /// dispatches here. `next_test_id` / the return value thread
    /// `TestReporterAgent::next_test_id` through by value; no-op returns it
    /// unchanged.
    pub retroactively_report_discovered_tests:
        unsafe fn(agent: *mut crate::debugger::TestReporterHandle, next_test_id: i32) -> i32,
    /// Cancel every `TimeoutObject` / `ImmediateObject` still in the calling
    /// thread's `timer::All` heap so their JS pins and in-heap `+1` refs drop
    /// before the GC sweep. `timer::All` lives in `bun_runtime` (forward-dep);
    /// callers (`global_exit`, `WebWorker::shutdown`) are in this crate.
    ///
    /// # Safety
    /// `vm` is the live per-thread VM; `runtime_state` must still be installed
    /// and the JSC heap must not have been swept yet.
    pub cancel_all_timers: unsafe fn(vm: *mut VirtualMachine),
    /// Destroy the per-VM global DNS resolver's c-ares channel now, while JSC,
    /// the event loop, `RareData.file_polls`, and `runtime_state` are all
    /// live. `ares_destroy()` re-enters the resolver's socket-state and query
    /// callbacks; deferring it to `deinit_runtime_state`'s `RuntimeState` drop
    /// runs those callbacks against freed state. No-op when the resolver was
    /// never lazily created. Called from `WebWorker::shutdown` / `global_exit`
    /// right after `close_all_socket_groups`.
    pub stop_dns_for_vm_teardown: fn() -> SweepResult,
    /// Stop every registered native handle behind a JS object (servers,
    /// listeners, fs watchers) — the stop phase for Rust-side JS classes, run
    /// with the VM alive right after the WebCore stop phase.
    ///
    /// # Safety
    /// `vm` is the live per-thread VM on the JS thread; the JSC heap is alive.
    pub stop_active_handles_for_vm_teardown: unsafe fn(vm: *mut VirtualMachine) -> SweepResult,
    /// Teardown only (never on a live VM): unlink every remaining EventLoopTimer.
    pub disarm_all_timers_for_vm_teardown: unsafe fn(vm: *mut VirtualMachine),
    /// Teardown-only, after ~VM (JSC's RunLoop timers use the heap until then):
    /// close the loop handles the timer heap embeds (Windows uv_timer/uv_idle)
    /// so the loop close unlinks them before the runtime state is freed.
    ///
    /// # Safety
    /// JS thread; `runtime_state` installed.
    pub close_timer_loop_handles_after_vm_destroyed: unsafe fn(vm: *mut VirtualMachine),
}

/// Canonical `EventLoopCtx` vtable for a `*mut VirtualMachine` owner — the JS
/// half of `bun_io`'s cycle-break manual vtable. Every slot is implementable
/// from in-crate data,
/// so this is the single fully-populated instance; `aio::get_vm_ctx(.Js)` and
/// the websocket-client adapters resolve to it.
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
            &raw mut **rare.file_polls.get_or_insert_with(|| Box::new(bun_io::Store::init()))
        },
        // CROSS-THREAD: reached via `KeepAlive::unref_on_next_tick`.
        // Do NOT route through `vm_from_owner()` — that mints `&mut VM`, which
        // would alias the JS thread's `&mut`. Atomic RMW through a shared ref.
        increment_pending_unref_counter() => {
            (*this)
                .pending_unref_counter
                .fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        },
        after_event_loop_callback() => vm_from_owner(this.cast()).after_event_loop_callback,
        set_after_event_loop_callback(cb, ctx) => {
            let vm = vm_from_owner(this.cast());
            vm.after_event_loop_callback = cb;
            vm.after_event_loop_callback_ctx = ctx.map(|p| p.as_ptr());
        },
        pipe_read_scratch() => &raw const *(*vm_from_owner(this.cast()).rare_data_ptr()).pipe_read_scratch,
    }
}

impl VirtualMachine {
    /// # Safety
    /// `this` must be a live VM (per-thread or a worker's parent ref) that
    /// outlives every dispatch through the returned ctx.
    #[inline]
    pub unsafe fn event_loop_ctx(this: *mut Self) -> bun_io::EventLoopCtx {
        // SAFETY: caller contract above.
        unsafe { bun_io::EventLoopCtx::new(bun_io::EventLoopCtxKind::Js, this) }
    }

    /// `RareData.defaultClientSslCtx()` — the VM-wide default-trust-store
    /// client `SSL_CTX*` (see [`RuntimeHooks::default_client_ssl_ctx`]).
    pub fn default_client_ssl_ctx(&self) -> *mut uws::SslCtx {
        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        (hooks.default_client_ssl_ctx)(self)
    }

    /// `RareData.sslCtxCache().getOrCreateOpts()` — a +1 `SSL_CTX` for `opts`
    /// from the per-VM weak cache (see
    /// [`RuntimeHooks::ssl_ctx_cache_get_or_create`]).
    pub fn ssl_ctx_cache_get_or_create(
        &self,
        opts: &uws::SocketContext::BunSocketContextOptions,
        err: &mut uws::create_bun_socket_error_t,
    ) -> Option<bun_boringssl::c::OwnedSslCtx> {
        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        (hooks.ssl_ctx_cache_get_or_create)(self, opts, err)
    }

    /// `&self` overload of [`event_loop_ctx`]. Routes through
    /// [`Self::get_mut_ptr`] for write provenance (the vtable callbacks
    /// dereference `owner` as `*mut VirtualMachine`).
    #[inline]
    pub fn loop_ctx(&self) -> bun_io::EventLoopCtx {
        debug_assert!(core::ptr::eq(self, Self::get_mut_ptr()));
        // SAFETY: `get_mut_ptr()` is the live per-thread VM singleton.
        unsafe { Self::event_loop_ctx(Self::get_mut_ptr()) }
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
    /// init-order hazard.
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

#[allow(improper_ctypes)] // VirtualMachine is opaque to C++; passed as `void*`
unsafe extern "C" {
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
    /// Note: every step that names a `bun_runtime` / `bun_webcore` type
    /// (`Timer.All.init`, `Body.Value.HiveAllocator`, `configureDebugger`,
    /// `Config.configureTransformOptionsForBunVM`, `ParentDeathWatchdog`) is
    /// dispatched through `RuntimeHooks::init_runtime_state` so `bun_jsc` does
    /// not name those types directly. The hook receives the boxed VM after the
    /// JSC-tier fields are populated and finishes the rest.
    pub fn init(mut opts: InitOptions) -> crate::CrateResult<*mut VirtualMachine> {
        jsc::mark_binding();

        let log: *mut bun_ast::Log = match opts.log {
            Some(l) => l.as_ptr(),
            None => bun_core::heap::into_raw(Box::new(bun_ast::Log::default())),
        };

        // SAFETY: VM is large + self-referential; allocate zeroed and fill in
        // place. The
        // allocation lives for the thread lifetime (never freed on the main
        // thread; worker `destroy()` frees it explicitly).
        //
        // Note (validity): the zeroed bytes are NOT a valid
        // `VirtualMachine` — `origin_timer: Instant`, `on_unhandled_rejection:
        // fn(...)`, every `Vec`/`Box`/
        // `HashMap`/`ArrayHashMap` field (NonNull dangling-when-empty), `URL`
        // (`&[u8]` references), and `Option<bool>` (bool-niche → zero = Some)
        // have no all-zero repr. We therefore never materialize
        // `&mut VirtualMachine` until all such fields have been `ptr::write`n
        // via `addr_of_mut!`; remaining fields are zero-valid
        // (integers/raw-ptr/atomic-mutex/`Option<NonNull>`/`Option<Box>`) so
        // the zero-fill stands in for the struct-init defaults.
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
        // stable storage and init in place.
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
            addr_of_mut!((*vm).main_resolved_path).write(bun_core::String::EMPTY);
            addr_of_mut!((*vm).hide_bun_stackframes).write(true);
            addr_of_mut!((*vm).is_main_thread).write(opts.is_main_thread);
            // Left at the
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
            addr_of_mut!((*vm).pending_ipc).write(None);
            // Non-zero-valid container fields: `Vec`/`Box`/`HashMap`/
            // `ArrayHashMap` all carry a `NonNull` (dangling when empty), and
            // `URL` is a struct of `&[u8]` references — all-zero bytes violate
            // their validity invariants even when len/cap are 0. Write the
            // canonical empty value via `ptr::write` (no Drop of zeroed bytes).
            addr_of_mut!((*vm).preload).write(Vec::new());
            addr_of_mut!((*vm).child_workers).write(Vec::new());
            addr_of_mut!((*vm).handle)
                .write(core::mem::ManuallyDrop::new(crate::VmHandle::new(vm)));
            addr_of_mut!((*vm).argv).write(Vec::new());
            addr_of_mut!((*vm).resolved_path_dups).write(Vec::new());
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
            if let Some(graph) = opts.graph {
                let _ = STANDALONE_MODULE_GRAPH.set(graph);
            }
            addr_of_mut!((*vm).standalone_module_graph).write(opts.graph);
            addr_of_mut!((*vm).initial_script_execution_context_identifier).write(context_id);
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

            addr_of_mut!((*vm).source_mappings).write(SavedSourceMap::default());
        }

        // High-tier per-VM state — Transpiler / Timer::All / entry_point.
        // Note (init order): the transpiler and per-VM timer state must be
        // built BEFORE `JSGlobalObject` creation. The C++ body
        // of `Zig__GlobalObject__create` re-enters via `WTFTimer__create`/
        // `WTFTimer__update` (JSC's GC scheduler), which dereferences
        // `runtime_state().timer` — so this hook MUST run first or that path
        // null-derefs.
        if let Some(hooks) = runtime_hooks() {
            // SAFETY: hook contract — `vm` is the unique live VM on this
            // thread. Write through the raw `vm` ptr (not `vm_ref`) so no
            // `&mut VirtualMachine` is held live across the hook call — the
            // hook body itself dereferences `vm`.
            //
            // `?`: on `Err` (e.g. a deleted cwd → `getcwd` ENOENT out of
            // `Transpiler::init`) the hook already unwound its own per-VM state,
            // so abort `init` here — `vm.transpiler` was never written, and
            // bailing out before the CLI reads it turns the old segfault into a
            // clean error + non-zero exit.
            unsafe { (*vm).runtime_state = (hooks.init_runtime_state)(vm, &mut opts)? };
        }

        // JSGlobalObject creation. `ensure_waker()` must run before the FFI.
        // SAFETY: `vm` is the unique live VM on this thread; raw-ptr deref so
        // no `&mut` is held across the FFI re-entry (`Bun__getVM()` —
        // ZigGlobalObject.cpp:473/961).
        unsafe { (*vm).regular_event_loop.ensure_waker() };
        // `console`/`worker_ptr` are opaque round-trip pointers C++ stores into
        // the new global. `worker_ptr` is the C++ `WebCore::Worker*` (or null on
        // the main thread).
        let global = Zig__GlobalObject__create(
            console.cast(),
            context_id,
            opts.mini_mode,
            opts.eval_mode,
            opts.worker_ptr,
        );
        // Sets the bound for a thread that skipped it at start (`configure_thread_no_js`).
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

        // `uws.Loop.get().internal_loop_data.jsc_vm
        // = vm.jsc_vm` — must run AFTER `jsc_vm` is set so C/uws callbacks can
        // recover the JSC VM via `internal_loop_data`.
        // SAFETY: `uws::Loop::get()` returns the live per-thread uws loop.
        unsafe {
            (*uws::Loop::get()).internal_loop_data.jsc_vm = jsc_vm.cast();
        }

        // `ParentDeathWatchdog` install for the main thread.
        // Must run AFTER `ensure_waker()` (above) has set `event_loop_handle`,
        // since on macOS the kqueue registration resolves the platform loop via
        // `event_loop_ctx → uws_loop()`. No-op off macOS / when `--no-orphans`
        // is not enabled. `init_with_module_graph` / `init_bake` route through
        // here with their caller's `is_main_thread`; `init_worker` passes
        // `false` so workers never arm the watchdog.
        if opts.is_main_thread {
            // SAFETY: `vm` is the freshly-initialised per-thread VM singleton.
            bun_io::ParentDeathWatchdog::install_on_event_loop(unsafe { Self::event_loop_ctx(vm) });
        }

        if opts.smol {
            // SAFETY: written once during init.
            IS_SMOL_MODE.store(true, core::sync::atomic::Ordering::Relaxed);
        }

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
    /// [`crate::event_loop::EventLoop::wait_for_promise`].
    #[inline]
    pub fn wait_for_promise(&mut self, promise: jsc::AnyPromise) -> Result<(), jsc::Stopped> {
        self.event_loop_mut().wait_for_promise(promise)
    }

    /// `eventLoop().autoTick()` — dispatched through the runtime hook
    /// (needs `Timer::All` for the poll timeout).
    #[inline]
    pub fn auto_tick(&mut self) {
        if let Some(hooks) = runtime_hooks() {
            // SAFETY: hook contract — `self` is the live per-thread VM.
            unsafe { (hooks.auto_tick)(self) };
        } else {
            // No high tier (unit tests) — fall back to a non-blocking tick.
            self.event_loop_mut().tick();
        }
    }

    /// `eventLoop().autoTickActive()` — like [`auto_tick`](Self::auto_tick)
    /// but only sleeps in the uSockets loop while it has active handles.
    /// The real body lives in `event_loop.rs`
    /// behind `` until the b2-cycle (`Timer::All`) breaks; until
    /// then route through the same `auto_tick` hook so drain loops in
    /// `on_before_exit` / `bun_main` still make forward progress.
    #[inline]
    pub fn auto_tick_active(&mut self) {
        if let Some(hooks) = runtime_hooks() {
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
    pub(crate) fn reload_entry_point(
        &mut self,
        entry_path: &[u8],
    ) -> crate::CrateResult<*mut JSInternalPromise> {
        self.has_loaded = false;
        self.set_main(entry_path);
        self.main_resolved_path = bun_core::String::EMPTY;
        self.main_hash = bun_watcher::Watcher::get_hash(entry_path);
        self.overridden_main.deinit();

        let hooks = runtime_hooks();
        let _ = self.ensure_debugger(true);

        // Node.js `--trace-*` and `--stack-trace-limit` flags need
        // `internal/process/pre_execution` to run before any user code.
        // `reload_entry_point` is the single funnel for the main entry,
        // workers, and `-e` evals, so this covers them all. Gated on a cheap
        // argv scan so the zero-flag path costs nothing; the module registry
        // caches the evaluation, so hot reloads and worker re-entries are
        // no-ops after the first call.
        //
        // Process argv is identical on every thread, so a worker spawned with
        // an explicit `execArgv: ['--trace-*']` from an untraced parent would
        // be missed by the global scan — also scan this VM's own worker
        // execArgv. (The JS side re-reads `process.execArgv`, so an explicit
        // empty execArgv under a traced parent stays a no-op there.)
        fn is_bootstrap_flag(arg: &[u8]) -> bool {
            arg.starts_with(b"--trace-") || arg.starts_with(b"--stack-trace-limit")
        }
        let needs_pre_execution = bun_core::argv().into_iter().any(is_bootstrap_flag)
            || self
                .worker_ref()
                .and_then(crate::web_worker::WebWorker::exec_argv)
                .is_some_and(|exec_argv| {
                    use bun_core::WTFStringImplExt as _;
                    exec_argv.iter().any(|&arg| {
                        // SAFETY: each entry borrows the C++ `WorkerOptions`
                        // array, kept alive by the owning `WebCore::Worker`
                        // for the worker's lifetime (see `WebWorker::argv`).
                        !arg.is_null()
                            && is_bootstrap_flag(unsafe { &*arg }.to_owned_slice_z().as_bytes())
                    })
                });
        if needs_pre_execution {
            // The C++ side catches and reports any JS exception thrown while
            // evaluating `internal/process/pre_execution`.
            crate::cpp::Bun__preExecutionBootstrap(self.global());
        }

        if !self.main_is_html_entrypoint {
            if let Some(hooks) = hooks {
                let watch = self.is_watcher_enabled();
                if !(hooks.generate_entry_point)(self, watch, entry_path) {
                    return Err(crate::CrateError::ServerEntryPointGenerate);
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

                // Check if Module.runMain was patched.
                if self.has_patched_run_main {
                    bun_core::hint::cold();
                    self.pending_internal_promise = None;
                    self.pending_internal_promise_is_protected = false;
                    let global_ref = self.global();
                    let argv1 = bun_string_jsc::create_utf8_for_js(global_ref, MAIN_FILE_NAME)
                        .map_err(|_| crate::CrateError::JSError)?;
                    let ret = jsc::from_js_host_call_generic(global_ref, || {
                        NodeModuleModule__callOverriddenRunMain(global_ref, argv1)
                    })
                    .map_err(|_| crate::CrateError::JSError)?;
                    // If the override stored a promise itself, use that; otherwise
                    // wrap its return value.
                    if let Some(stored) = self.pending_internal_promise {
                        return Ok(stored);
                    }
                    // `Promise.resolve(ret)` reads `ret.constructor` / `ret.then`,
                    // which may throw.
                    let resolved = jsc::call_check_slow(global_ref, || {
                        JSC__JSInternalPromise__resolvedPromise(global_ref, ret)
                    })
                    .map_err(|_| crate::CrateError::JSError)?;
                    self.pending_internal_promise = Some(resolved);
                    self.pending_internal_promise_is_protected = false;
                    return Ok(resolved);
                }
            }

            // Preloads (evaluated above, synchronously) are not the entry: only
            // module evaluations from here on mark the entry graph as executing.
            self.entry_evaluation_started = false;
            // Note: reshaped for borrowck — capture raw ptr before &self call.
            let global = self.global;
            let global_ref = self.global();
            let promise = if !self.main_is_html_entrypoint {
                let name = bun_core::String::borrow_utf8(MAIN_FILE_NAME);
                jsc::JSModuleLoader::load_and_evaluate_module_ptr(global, Some(&name))
                    .map(NonNull::as_ptr)
                    .ok_or(crate::CrateError::JSError)?
            } else {
                let p: *mut JSInternalPromise = jsc::from_js_host_call_generic(global_ref, || {
                    Bun__loadHTMLEntryPoint(global_ref)
                })
                .map_err(|_| crate::CrateError::JSError)?;
                if p.is_null() {
                    return Err(crate::CrateError::JSError);
                }
                p
            };

            self.pending_internal_promise = Some(promise);
            self.pending_internal_promise_is_protected = false;
            JSValue::from_cell(promise).ensure_still_alive();
            Ok(promise)
        } else {
            self.entry_evaluation_started = false;
            let global = self.global;
            let main_str = bun_core::String::from_bytes(self.main());
            let promise =
                jsc::JSModuleLoader::load_and_evaluate_module_ptr(global, Some(&main_str))
                    .map(NonNull::as_ptr)
                    .ok_or(crate::CrateError::JSError)?;
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
    ) -> crate::CrateResult<*mut JSInternalPromise> {
        let promise = self.reload_entry_point(entry_path)?;

        // pending_internal_promise can change if hot module reloading is enabled
        if self.is_watcher_enabled() {
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
            let _ = self.wait_for_promise(jsc::AnyPromise::Internal(promise));
        }

        Ok(self.pending_internal_promise.unwrap_or(promise))
    }
}

/// Synthesize a JS `BuildMessage` / `ResolveMessage` / `AggregateError` from
/// the parser `log` for a failed fetch, so the import promise rejects with a
/// real Error instead of `undefined`.
pub fn process_fetch_log(
    global_this: &JSGlobalObject,
    specifier: &bun_core::String,
    referrer: &bun_core::String,
    log: &mut bun_ast::Log,
    err: crate::CrateError,
) -> JSValue {
    use crate::{BuildMessage, ResolveMessage};

    // Helper: on error, swap in the pending exception value.
    let take =
        |r: JsResult<JSValue>| -> JSValue { r.unwrap_or_else(|e| global_this.take_exception(e)) };

    // `ResolveMessage::create` takes raw `&[u8]` and stores them verbatim, so
    // we must convert to UTF-8 here.
    let referrer_utf8 = referrer.to_utf8();

    let msg_to_js = |msg: bun_ast::Msg| -> JSValue {
        take(match msg.metadata {
            bun_ast::Metadata::Build => BuildMessage::create(global_this, msg),
            bun_ast::Metadata::Resolve(_) => {
                ResolveMessage::create(global_this, &msg, referrer_utf8.slice())
            }
        })
    };

    match log.msgs.len() {
        0 => {
            let msg = if err == crate::CrateError::UnexpectedPendingResolution {
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
            take(BuildMessage::create(global_this, msg))
        }

        1 => {
            // Note: `Msg` is not `Copy`, so move it out — the caller deinits
            // the log immediately after, so consuming the vec is sound.
            let msg = log.msgs.swap_remove(0);
            msg_to_js(msg)
        }

        _ => {
            // On-stack array: the conservative GC stack scan is the only
            // thing keeping these wrappers alive until
            // `create_aggregate_error` stores them. A heap `Vec` is invisible
            // to that scan, so a GC triggered by a later `create` could sweep
            // the earlier cells and free their native
            // `BuildMessage`/`ResolveMessage` out from under us.
            let mut errors_stack: [JSValue; 256] = [JSValue::default(); 256];
            let len = log.msgs.len().min(errors_stack.len());
            for (i, msg) in log.msgs.drain(..len).enumerate() {
                errors_stack[i] = msg_to_js(msg);
            }

            take(global_this.create_aggregate_error(
                &errors_stack[..len],
                format_args!("{len} errors building \"{specifier}\""),
            ))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SourceMapHandlerGetter
// ──────────────────────────────────────────────────────────────────────────

/// Holds raw
/// pointers to the VM and the active `BufferPrinter` so that `get()` can
/// return an erased `js_printer::SourceMapHandler` borrowing either the VM's
/// `source_mappings` (fast path) or `self` (debugger / inline-sourcemap path)
/// without the two `&mut` borrows colliding.
///
/// Note: we keep raw pointers + a `PhantomData<&'a mut ()>` so the getter's lifetime
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
        // SAFETY: see fn doc — `self.vm` is non-null; raw place projection to
        // the worker-safe `debugger` leaf avoids a whole-VM retag.
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
        // SAFETY: see fn doc — `self.vm` is non-null; raw place projection to
        // the `source_mappings` leaf avoids aliasing the caller's borrows.
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
    pub fn get(&mut self) -> bun_js_printer::SourceMapHandler<'_> {
        // Take the inline-sourcemap path only when a
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
    /// When the inspector is enabled, we want to generate an inline sourcemap.
    /// And, for now, we also store it in `source_mappings` like normal.
    /// This is hideously expensive memory-wise...
    fn on_source_map_chunk(
        &mut self,
        chunk: bun_sourcemap::Chunk,
        source: &bun_ast::Source,
    ) -> bun_js_printer::Result<()> {
        let mut temp_json_buffer = bun_core::MutableString::init_empty();
        // `defer temp_json_buffer.deinit()` → Drop.
        chunk
            .print_source_map_contents_from_internal::<true>(source, &mut temp_json_buffer, true)
            .map_err(|_| bun_js_printer::Error::WriteFailed)?;
        const SOURCE_MAP_URL_PREFIX_START: &[u8] =
            b"//# sourceMappingURL=data:application/json;base64,";
        // TODO: do we need to %-encode the path?
        let source_url_len = source.path.text.len();
        const SOURCE_MAPPING_URL: &[u8] = b"\n//# sourceURL=";
        let prefix_len =
            SOURCE_MAP_URL_PREFIX_START.len() + SOURCE_MAPPING_URL.len() + source_url_len;

        self.vm_source_mappings_mut()
            .put_mappings(source, chunk.buffer)
            .map_err(|_| bun_js_printer::Error::WriteFailed)?;

        // SAFETY: `printer` is the raw `*mut BufferPrinter` passed in by the
        // caller (jsc_hooks.rs), with the SAME provenance as the `writer` arg
        // to `print_with_source_map`. By the time `on_source_map_chunk` runs
        // (js_printer/lib.rs `print_ast` tail), the writer
        // has emitted its last byte; we reborrow from the raw pointer here
        // rather than from a stashed `&'a mut` so no Unique tag is held across
        // the writer's lifetime. The caller MUST rederive its own
        // `&mut BufferPrinter` from the raw pointer after
        // `print_with_source_map` returns (see jsc_hooks.rs). See
        // `SourceMapHandlerGetter` doc for why `printer` is not stored as `&'a mut`.
        let printer = unsafe { &mut *self.printer };

        let encode_len = bun_base64::encode_len(temp_json_buffer.list.as_slice());
        printer
            .ctx
            .buffer
            .grow_if_needed(encode_len + prefix_len + 2)?;
        printer.ctx.buffer.append_assume_capacity(b"\n");
        printer
            .ctx
            .buffer
            .append_assume_capacity(SOURCE_MAP_URL_PREFIX_START);
        {
            // `MutableString::list` is a `Vec<u8>`; write into spare capacity,
            // then commit the written length.
            let buf = &mut printer.ctx.buffer.list;
            // SAFETY: `grow_if_needed` reserved ≥encode_len spare; encode writes
            // `wrote<=encode_len` bytes.
            let wrote = unsafe {
                bun_base64::encode(
                    &mut bun_core::vec::spare_bytes_mut(buf)[..encode_len],
                    temp_json_buffer.list.as_slice(),
                )
            };
            // SAFETY: `wrote <= encode_len` bytes were just initialized in the
            // spare capacity reserved by `grow_if_needed` above.
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
// impl below.
// ──────────────────────────────────────────────────────────────────────────

/// `allocator` dropped per §Allocators (global mimalloc).
#[derive(Default)]
pub struct Options {
    pub args: bun_options_types::schema::api::TransformOptions,
    pub log: Option<NonNull<bun_ast::Log>>,
    // BORROW_PARAM (`&'a mut bun_dotenv::Loader`) — caller-owned; the loader
    // outlives the VM, so the inner lifetime is erased to `'static`.
    pub env_loader: Option<NonNull<bun_dotenv::Loader>>,
    pub store_fd: bool,
    pub smol: bool,
    // LAYERING: real type is `bun_runtime::dns_jsc::Order` (forward
    // dep); stored as its `u8` repr.
    pub dns_result_order: u8,
    /// `--print` needs the result from evaluating the main module.
    pub eval: bool,
    // Note: layering — concrete `bun_standalone_graph::Graph` is in a
    // forward-dep crate; callers pass it as the resolver's trait object so
    // both VM and resolver can hold it without the cycle.
    pub graph: Option<&'static dyn bun_resolver::StandaloneModuleGraph>,
    // Note: debugger
    // configuration is plumbed through `RuntimeHooks::ensure_debugger` (the
    // CLI option struct lives in `bun_cli`, a forward dep). See
    // `runtime/jsc_hooks.rs` for the `configureDebugger` call site.
    pub is_main_thread: bool,
}

/// Inherited IPC channel recorded at env load; consumed by `bun_runtime`'s
/// `ipc_host::get_ipc_instance` when JS first attaches a listener.
#[derive(Clone, Copy)]
pub struct PendingIpc {
    pub fd: bun_sys::Fd,
    pub advanced: bool,
}

/// Caller intent for runtime module resolution.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ResolveMode {
    Esm,
    Require,
    /// `require.resolve()`: returns the bare specifier for Node builtins.
    RequireResolve,
}

impl ResolveMode {
    #[inline]
    pub fn is_esm(self) -> bool {
        matches!(self, Self::Esm)
    }

    #[inline]
    pub fn import_kind(self) -> bun_ast::ImportKind {
        match self {
            Self::Esm => bun_ast::ImportKind::Stmt,
            Self::Require => bun_ast::ImportKind::Require,
            Self::RequireResolve => bun_ast::ImportKind::RequireResolve,
        }
    }

    /// Fold the two-bool encoding the C++ FFI boundary passes.
    #[inline]
    pub fn from_ffi_bools(is_esm: bool, is_user_require_resolve: bool) -> Self {
        if is_esm {
            Self::Esm
        } else if is_user_require_resolve {
            Self::RequireResolve
        } else {
            Self::Require
        }
    }
}

/// Output slot for module resolution: the resolver result plus the resolved path and query string.
#[derive(Default)]
pub struct ResolveFunctionResult {
    pub result: Option<bun_resolver::Result>,
    // LIFETIME-ERASED: `path`/`query_string` borrow argv or the resolver's
    // process-lifetime arena (`detach_lifetime` in `resolve_maybe_need_dirname_uncached`),
    // which outlives every `ResolveFunctionResult`.
    pub path: &'static [u8],
    pub(crate) query_string: &'static [u8],
}

/// Per-thread `BufferPrinter` used when printing transpiled module source.
#[thread_local]
pub(crate) static SOURCE_CODE_PRINTER: Cell<Option<NonNull<bun_js_printer::BufferPrinter>>> =
    Cell::new(None);

/// `true` when [`enable_macro_mode`](VirtualMachine::enable_macro_mode)
/// allocated [`SOURCE_CODE_PRINTER`] on this thread and no runtime VM has since
/// claimed it via [`VirtualMachine::load_extra_env_and_source_code_printer`]
/// (i.e. a bundler worker thread running a macro). Lets
/// `__bun_macro_context_deinit` free the printer on worker teardown without
/// touching the runtime VM's printer when an inline `Bun.build()` macro ran on
/// the JS thread.
#[thread_local]
static SOURCE_CODE_PRINTER_FROM_MACRO: Cell<bool> = Cell::new(false);

fn normalize_specifier_for_resolution<'a>(
    specifier_: &'a [u8],
    query_string: &mut &'a [u8],
) -> &'a [u8] {
    // In a `data:` URL everything after the comma is the payload; a `?` is
    // part of the data, not a query string.
    if bun_core::strings::has_prefix_comptime(specifier_, b"data:") {
        return specifier_;
    }
    if let Some(i) = bun_core::strings::index_of_char_usize(specifier_, b'?') {
        *query_string = &specifier_[i..];
        &specifier_[..i]
    } else {
        specifier_
    }
}

/// Heap-backed so only a pointer lives in TLS; see test/js/bun/binary/tls-segment-size.
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

/// Free this thread's [`SOURCE_CODE_PRINTER`] Box (if any).
fn drop_source_code_printer() {
    if let Some(printer) = SOURCE_CODE_PRINTER.take() {
        // SAFETY: `printer` was produced by `heap::into_raw` in
        // `ensure_source_code_printer` and is exclusively owned by this thread.
        drop(unsafe { bun_core::heap::take(printer.as_ptr()) });
    }
    SOURCE_CODE_PRINTER_FROM_MACRO.set(false);
}

/// Free this thread's [`SOURCE_CODE_PRINTER`] Box only if
/// [`enable_macro_mode`](VirtualMachine::enable_macro_mode) allocated it.
/// Called from `js_parser_jsc::Macro::__bun_macro_context_deinit` on bundler
/// worker teardown — the macro VM never reaches `VirtualMachine::deinit`, so
/// the box would otherwise leak when the worker thread's TLS block is torn down
/// before LSan scans (issue 03830 on debian-13-asan after the
/// `leak:bun_js_parser_jsc::Macro` suppression was removed in #30875). A no-op
/// on threads where the runtime VM had already initialized the printer (e.g. an
/// inline `Bun.build()` macro on the JS thread), so subsequent module loads
/// keep their printer.
///
/// Also a no-op while a [`MacroModeGuard`] is still active on this thread:
/// `__bun_macro_context_deinit` can fire *inside* the guard scope (e.g. a
/// macro that calls `new Bun.Transpiler().transformSync(...)` —
/// `TranspilerStateGuard::drop` deinits the nested `MacroContext`), and freeing
/// here would panic the next module fetch at
/// `SOURCE_CODE_PRINTER.get().expect(...)` with no intervening
/// `enable_macro_mode()`. Gated on `macro_guard_depth`: nonzero exactly while a
/// guard is on the stack (both `MacroContext::call` and `Macro::init` hold one,
/// so the macro module's top-level is covered too).
pub fn drop_source_code_printer_if_macro_owned() {
    if !SOURCE_CODE_PRINTER_FROM_MACRO.get() {
        return;
    }
    if let Some(vm) = VM.get() {
        // SAFETY: `VM` is this thread's per-JS-thread VM singleton; we only
        // read the depth counter and never alias `&mut`.
        if unsafe { (*vm).macro_guard_depth } > 0 {
            return;
        }
    }
    drop_source_code_printer();
}

/// Run a synchronous GC sweep on this thread's VM iff it was created for a
/// bundler-worker macro (via `Macro::init`) and is otherwise quiescent. The
/// macro VM is intentionally never `destroy()`'d (per-worker dealloc is
/// unimplemented), so JS-wrapper-owned native boxes — e.g. a
/// `new Bun.Transpiler()` constructed inside a macro body — would otherwise
/// outlive the worker thread's TLS root and be reported by LSan once the
/// `leak:bun_js_parser_jsc::Macro` suppression is gone.
///
/// Only invoked from `bun_bundler::ThreadPool::Worker::deinit` (the call site
/// is the discriminant — JS `Worker` threads never reach it), after both
/// per-worker `MacroContext` boxes are freed. Not called from
/// `__bun_macro_context_deinit`: that path is reached from
/// `TranspilerStateGuard::drop` and `JSTranspiler::Drop` (during a sweep),
/// where re-entering `run_gc` would be a recursion hazard.
pub fn collect_macro_vm_garbage() {
    let Some(vm) = VM.get() else { return };
    // SAFETY: `VM` is this thread's per-JS-thread VM singleton; we only read
    // plain fields and call `jsc_vm()` (which the C++ side locks internally).
    let vm_ref = unsafe { &*vm };
    if !vm_ref.has_enabled_macro_mode {
        return;
    }
    debug_assert!(!vm_ref.is_main_thread);
    debug_assert_eq!(vm_ref.macro_guard_depth, 0);
    vm_ref.jsc_vm().run_gc(true);
}

fn normalize_source(source: &[u8]) -> &[u8] {
    if let Some(rest) = source.strip_prefix(b"file://") {
        return rest;
    }
    source
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
    /// Returns the dev server's `AsyncLocalStorage` instance, or `None` when unset.
    pub fn get_dev_server_async_local_storage(&mut self) -> JsResult<Option<JSValue>> {
        let global_ref = self.global();
        let jsvalue =
            jsc::from_js_host_call(global_ref, || Bake__getAsyncLocalStorage(global_ref))?;
        if jsvalue.is_empty_or_undefined_or_null() {
            return Ok(None);
        }
        Ok(Some(jsvalue))
    }

    /// Whether native addons (`process.dlopen`) are allowed (`--no-addons` disables them).
    #[unsafe(export_name = "Bun__VM__allowAddons")]
    pub(crate) extern "C" fn allow_addons(this: &VirtualMachine) -> bool {
        this.transpiler
            .options
            .transform_options
            .allow_addons
            .unwrap_or(true)
    }

    /// Whether `bun:ffi` `cc()` is allowed (`--no-ffi-cc` and `--no-addons` disable it).
    pub fn allow_ffi_cc(&self) -> bool {
        let opts = &self.transpiler.options.transform_options;
        opts.allow_ffi_cc.unwrap_or(true) && opts.allow_addons.unwrap_or(true)
    }

    /// Whether to warn when a previously-unhandled rejection later gains a handler.
    #[unsafe(export_name = "Bun__VM__allowRejectionHandledWarning")]
    pub(crate) extern "C" fn allow_rejection_handled_warning(this: &VirtualMachine) -> bool {
        use bun_options_types::schema::api::UnhandledRejections;
        this.unhandled_rejections_mode() != UnhandledRejections::Bun
    }

    /// The configured `--unhandled-rejections` mode (defaults to Bun's behavior).
    pub(crate) fn unhandled_rejections_mode(
        &self,
    ) -> bun_options_types::schema::api::UnhandledRejections {
        use bun_options_types::schema::api::UnhandledRejections;
        self.transpiler
            .options
            .transform_options
            .unhandled_rejections
            .unwrap_or(UnhandledRejections::Bun)
    }

    /// Returns this VM's libuv event loop handle (must already be initialized).
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

    /// Whether TLS certificate verification is enforced, from the cached override or the env loader.
    pub fn get_tls_reject_unauthorized(&self) -> bool {
        if let Some(v) = self.default_tls_reject_unauthorized {
            return v;
        }
        self.transpiler.env_mut().get_tls_reject_unauthorized()
    }

    /// Registers a spawned subprocess with the auto-killer.
    pub fn on_subprocess_spawn(&mut self, process: core::ptr::NonNull<bun_spawn::Process>) {
        self.auto_killer.on_subprocess_spawn(process);
    }

    /// Unregisters an exited subprocess from the auto-killer.
    pub fn on_subprocess_exit(&mut self, process: core::ptr::NonNull<bun_spawn::Process>) {
        self.auto_killer.on_subprocess_exit(process);
    }

    /// Verbose fetch logging level, from the cached override or `BUN_CONFIG_VERBOSE_FETCH`.
    pub fn get_verbose_fetch(&self) -> bun_http::HTTPVerboseLevel {
        use bun_http::HTTPVerboseLevel as L;
        if let Some(v) = self.default_verbose_fetch.get() {
            // Note: field is `Option<u8>` until the b2-cycle widens it;
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
                self.default_verbose_fetch.set(Some(1));
                return L::Headers;
            } else if verbose_fetch == b"curl" {
                self.default_verbose_fetch.set(Some(2));
                return L::Curl;
            }
        }
        self.default_verbose_fetch.set(Some(0));
        L::None
    }

    /// Interns a MIME type string against the static common-type set.
    pub fn mime_type(&mut self, str_: &[u8]) -> Option<bun_http::MimeType::MimeType> {
        bun_http::MimeType::by_name_static(str_)
    }

    /// Applies env-derived runtime settings, claims the per-thread source code printer, and adopts `NODE_CHANNEL_FD` for IPC.
    pub fn load_extra_env_and_source_code_printer(&mut self) {
        // `Transpiler::env_mut()` encapsulates the raw-ptr deref; the returned
        // `&'static mut Loader` is independent of `&self`, so `map` may be held
        // across the `&mut self` writes below.
        let env = self.transpiler.env_mut();
        let map = &mut env.map;

        ensure_source_code_printer();
        // The runtime VM owns the printer from here on — even if a macro had
        // allocated it first, `__bun_macro_context_deinit` must not free it.
        SOURCE_CODE_PRINTER_FROM_MACRO.set(false);

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
            let advanced = map
                .map
                .get_index(b"NODE_CHANNEL_SERIALIZATION_MODE")
                .map(|i| map.map.swap_remove_at(i).1)
                .is_some_and(|v| &v.value[..] == b"advanced");
            // Accept only
            // non-negative values that fit in i31 (i.e. `0..=i32::MAX`).
            // Parsing as `u32` then `as i32` would silently wrap values in
            // `2^31..2^32` to a negative fd instead of taking the warn branch.
            // The channel belongs to the process (its main thread). A worker
            // sees the same inherited variables but must not open a second
            // endpoint over the same fd (Node: no process.send() in workers).
            if self.is_main_thread() {
                match bun_core::fmt::parse_int::<i32>(&fd_s, 10)
                    .ok()
                    .filter(|&n| n >= 0)
                {
                    Some(fd) => {
                        self.pending_ipc = Some(PendingIpc {
                            fd: bun_sys::Fd::from_uv(fd),
                            advanced,
                        })
                    }
                    None => bun_core::warn!(
                        "Failed to parse IPC channel number '{}'",
                        bstr::BStr::new(&fd_s[..])
                    ),
                }
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
                bun_resolve_builtins::set_expose_internals_enabled(true);
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

    /// Routes an unhandled promise rejection to the configured handler and, where
    /// [`Self::unhandled_errors_are_fatal`], bumps the unhandled-error counter.
    pub fn unhandled_rejection(
        &mut self,
        global_object: &JSGlobalObject,
        reason: JSValue,
        promise: JSValue,
    ) {
        use bun_options_types::schema::api::UnhandledRejections as Mode;

        if self.is_shutting_down() || !self.script_allowed() || reason.is_termination_exception() {
            bun_core::debug_warn!("unhandledRejection during shutdown.");
            return;
        }

        if isBunTest.load(core::sync::atomic::Ordering::Relaxed) {
            self.unhandled_error_counter += 1;
            (self.on_unhandled_rejection)(self, global_object, reason);
            return;
        }

        // Each arm drains microtasks on exit — hoisted into a closure.
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
                // `exc` is already the exception's value; report it directly.
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
                return;
            }
            Mode::Strict => {
                let wrapped = unhandled_rejection_as_uncaught_error(global_object, reason);
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
                let wrapped = unhandled_rejection_as_uncaught_error(global_object, reason);
                if self.uncaught_exception(global_object, wrapped, true) {
                    drain(self);
                    return;
                }
                // continue to default handler — but RETURN if this drain
                // errors (the VM is dead; don't bump the counter or invoke the
                // handler).
                if self.event_loop_mut().drain_microtasks().is_err() {
                    return;
                }
            }
        }
        if self.unhandled_errors_are_fatal() {
            self.unhandled_error_counter += 1;
        }
        (self.on_unhandled_rejection)(self, global_object, reason);
    }

    /// After a hot reload, surfaces the entry-point promise's rejection (if any) and re-arms the watcher.
    pub fn report_exception_in_hot_reloaded_module_if_needed(&mut self) {
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

    /// Adds the main entry point to the file watcher when watch mode is enabled.
    pub fn add_main_to_watcher_if_needed(&mut self) {
        if !self.is_watcher_enabled() {
            return;
        }
        let main = self.main();
        if main.is_empty() {
            return;
        }
        let watcher = self.bun_watcher_ptr();
        if !watcher.is_null() {
            // SAFETY: `bun_watcher` is a live `Box<ImportWatcher>` leaked in
            // `enable_hot_module_reloading`. The pointee is shared with the
            // file-watcher thread (see `bun_watcher_ptr` doc) — the enum
            // discriminant is write-once at install and read-only thereafter,
            // and `add_file_by_path_slow` serializes the inner watchlist write
            // via `Watcher.mutex`. Borrow is scoped to this single
            // mutex-guarded call.
            let _ = unsafe { (*watcher).add_file_by_path_slow(main) };
        }
    }

    /// `bun_resolver` holds the manager as an opaque forward-decl (it cannot
    /// depend on `bun_install`). `bun_jsc` *can*, so cast the opaque back to
    /// the concrete `bun_install::PackageManager` here — the resolver's
    /// `PackageManager` is exactly that struct, just type-erased at a lower
    /// tier.
    ///
    /// Panics when the lazy init fails (unreadable top-level dir). Production
    /// callers (AsyncModule's pending-task machinery) only run after a pending
    /// dependency was enqueued, which requires a previously successful
    /// `get_package_manager`, so the init error is surfaced as a resolve
    /// failure in `Resolver::load_node_modules` long before reaching here.
    /// The one caller outside that machinery is the `bun:internal-for-testing`
    /// `parseLockfile` binding (`install_jsc/install_binding.rs`), which may
    /// lazy-init here and accepts the panic on its test-only surface.
    #[inline]
    pub fn package_manager(&mut self) -> &mut bun_install::PackageManager {
        let pm = self
            .transpiler
            .get_package_manager()
            .expect("package manager init already succeeded when the pending task was enqueued");
        // SAFETY: `bun_resolver::package_json::PackageManager` is an opaque
        // forward-decl of `bun_install::PackageManager`; the pointer was
        // produced by `PackageManager::init_with_runtime` (the install crate)
        // and only ever names that one type, so the concrete 64-byte alignment
        // is preserved through the `dyn` erasure. On success
        // `get_package_manager` never returns null (it lazy-inits the
        // process-static singleton).
        unsafe {
            &mut *NonNull::new_unchecked(pm)
                .cast::<bun_install::PackageManager>()
                .as_ptr()
        }
    }

    /// Performs a hot reload: re-evaluates the entry point once any pending entry-point load settles.
    pub(crate) fn reload(&mut self, _: Option<&mut crate::hot_reloader::HotReloadTask>) {
        if self.hot_reload == HotReload::Watch {
            // Watch reload replaces the process: never defer on a pending
            // entry promise (node restarts regardless of child state), and
            // emit the --watch-kill-signal JS handlers first, like node.
            crate::posix_signal_handle::emit_watch_kill_signal_before_reload(self.global());
            let should_clear_terminal =
                !self.env_loader().has_set_no_clear_terminal_on_reload(
                    !bun_core::Output::enable_ansi_colors_stdout(),
                );
            // execve will not reach on_exit; flush the compile cache here like
            // node's child does via AtExit(FlushCompileCache) on every restart.
            crate::node_compile_cache::persist_now();
            bun_core::Output::flush();
            bun_core::reload_process(should_clear_terminal, false);
        }

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
        // Note: reshaped for borrowck — copy the `RawSlice` first to avoid
        // overlapping `&self`/`&mut self` borrows.
        if self.reload_entry_point(main.slice()).is_err() {
            panic!("Failed to reload");
        }
    }

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

    /// Returns the next debugger async-task id, or 0 when no debugger is attached.
    pub(crate) fn next_async_task_id(&mut self) -> u64 {
        let Some(debugger) = self.debugger.as_deref_mut() else {
            return 0;
        };
        debugger.next_debugger_id = debugger.next_debugger_id.wrapping_add(1);
        debugger.next_debugger_id
    }

    /// Note (§Dispatch): `task` is an erased
    /// `*mut bun_runtime::timer::ImmediateObject` — see
    /// [`crate::event_loop::RunImmediateFn`].
    #[inline]
    pub fn enqueue_immediate_task(&mut self, task: *mut ()) {
        self.event_loop_mut().enqueue_immediate_task(task);
    }

    /// Ticks the event loop until no tasks keep it alive.
    pub fn wait_for_tasks(&mut self) {
        while self.is_event_loop_alive() {
            self.event_loop_mut().tick();
            if self.is_event_loop_alive() {
                self.auto_tick();
            }
        }
    }

    /// Note: shares ~90% with [`init`]; the differences are (a) the
    /// transpiler is built without `Config::configureTransformOptionsForBunVM`,
    /// (b) `standalone_module_graph` is mandatory and propagated into the
    /// resolver, (c) `configureLinkerWithAutoJSX(false)` instead of
    /// `configureLinker()`. Rather than re-open-code the 80-line struct init,
    /// we route through [`init`] and patch the deltas.
    pub fn init_with_module_graph(opts: Options) -> crate::CrateResult<*mut VirtualMachine> {
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
        vm_ref.install_bytecode_string_table(graph);
        vm_ref.let_heap_take_initial_module_graph(graph);
        // Avoid reading from tsconfig.json & package.json when in standalone mode
        vm_ref.transpiler.configure_linker_with_auto_jsx(false);
        vm_ref.transpiler.resolver.store_fd = false;
        IS_SMOL_MODE.store(opts.smol, core::sync::atomic::Ordering::Relaxed);
        Ok(vm)
    }

    /// Note: takes `&WebWorker` (not `&mut`) — the worker thread may only
    /// hold a shared reference to its `WebWorker` (the parent / main thread
    /// concurrently observes it; see `web_worker.rs` worker-thread `&self`
    /// note). All accesses on `worker` here are read-only.
    pub(crate) fn init_worker(
        worker: &crate::web_worker::WebWorker,
        opts: Options,
    ) -> crate::CrateResult<*mut VirtualMachine> {
        let init_opts = InitOptions {
            transform_options: opts.args,
            graph: opts.graph,
            log: opts.log,
            env_loader: opts.env_loader,
            store_fd: opts.store_fd,
            smol: opts.smol,
            eval_mode: opts.eval,
            is_main_thread: false,
            // The global is created with the worker's messaging proxy, context id
            // and `mini` so the C++ ZigGlobalObject is born with its options wired.
            worker_ptr: worker.messaging_proxy(),
            context_id: Some(worker.execution_context_id() as i32),
            mini_mode: worker.mini(),
            ..Default::default()
        };
        // Route through
        // [`init`] (which already wires console / event-loop / global / jsc_vm
        // / RuntimeHooks) and then patch the worker-specific fields.
        let vm = Self::init(init_opts)?;
        // SAFETY: `vm` is the unique live VM on this thread.
        let vm_ref = unsafe { &mut *vm };
        vm_ref.worker = Some(std::ptr::from_ref::<crate::web_worker::WebWorker>(worker).cast());
        if worker.arm_test_gate() {
            vm_ref.handle.arm_test_gate();
        }
        // The worker's resolver also
        // needs the standalone graph, otherwise embedded `/$bunfs/...` specifiers
        // (e.g. a `new Worker("./worker.ts")` entry point inside a compiled
        // executable) resolve against the real filesystem and fail.
        vm_ref.transpiler.resolver.standalone_module_graph = opts.graph;
        if let Some(graph) = opts.graph {
            vm_ref.install_bytecode_string_table(graph);
        }
        vm_ref.hot_reload = worker.hot_reload();
        vm_ref.initial_script_execution_context_identifier = worker.execution_context_id() as i32;
        vm_ref.transpiler.resolver.store_fd = opts.store_fd;
        if opts.graph.is_none() {
            vm_ref.transpiler.configure_linker();
        } else {
            vm_ref.transpiler.configure_linker_with_auto_jsx(false);
        }
        Ok(vm)
    }

    /// Creates a `VirtualMachine` configured for the bake (dev server) runtime.
    pub fn init_bake(opts: Options) -> crate::CrateResult<*mut VirtualMachine> {
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
        // Note: shares the console / log / event-loop wiring with `init`;
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

    /// Builds a `ResolvedSource` backed by a ref-counted copy of `code` interned in the VM's ref-string map.
    pub fn ref_counted_resolved_source(
        &mut self,
        code: &[u8],
        specifier: &bun_core::String,
        source_url: &[u8],
        hash_: Option<u32>,
    ) -> ResolvedSource {
        // refCountedString will panic if the code is empty
        if code.is_empty() {
            return ResolvedSource {
                source_url: specifier.create_if_different(source_url),
                ..Default::default()
            };
        }
        let source = self.ref_counted_string::<true>(code, hash_);
        // SAFETY: `ref_counted_string` returns a live `*mut RefString` held in
        // `self.ref_strings` until JSC calls the external-string finalizer.
        let source_ref = unsafe { &*source };

        ResolvedSource {
            source_code: bun_core::String::retain_wtf_impl(source_ref.impl_),
            source_url: specifier.create_if_different(source_url),
            ..Default::default()
        }
    }

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
        // RAII guard releases on every
        // exit (including the early-return `Occupied` arm).
        let _unlock = self.ref_strings_mutex.lock_guard();
        // Note: reshaped for borrowck — capture the back-pointer before
        // `ref_strings.entry()` takes its unique borrow on `self`.
        let self_ctx = NonNull::new(std::ptr::from_mut::<VirtualMachine>(self).cast::<c_void>());

        match self.ref_strings.entry(hash) {
            Entry::Occupied(o) => {
                *new = false;
                *o.get()
            }
            Entry::Vacant(v) => {
                // Dupe the input bytes when `DUPE`, otherwise
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

    /// Interns `input_` in the VM's ref-string map and returns the ref-counted entry.
    pub fn ref_counted_string<const DUPE: bool>(
        &mut self,
        input_: &[u8],
        hash_: Option<u32>,
    ) -> *mut crate::ref_string::RefString {
        debug_assert!(!input_.is_empty());
        let mut was_new = false;
        self.ref_counted_string_with_was_new::<DUPE>(&mut was_new, input_, hash_)
    }

    // Note: `flags` is a runtime arg —
    // `FetchFlags` would need `ConstParamTy` (unstable derive on the enum's
    // owning module) to be a const generic; the only branches are cheap
    // equality tests so the runtime form is fine.
    pub(crate) fn fetch_without_on_load_plugins(
        jsc_vm: &mut VirtualMachine,
        global_object: &JSGlobalObject,
        specifier: &bun_core::String,
        referrer: &bun_core::String,
        log: &mut bun_ast::Log,
        flags: FetchFlags,
    ) -> crate::CrateResult<ResolvedSource> {
        debug_assert!(VirtualMachine::is_loaded());

        if let Some(resolved) =
            ModuleLoader::__bun_fetch_builtin_module(jsc_vm, global_object, specifier)
        {
            return Ok(resolved);
        }

        let specifier_clone = specifier.to_utf8();
        let referrer_clone = referrer.to_utf8();

        let mut virtual_source_to_use: Option<bun_ast::Source> = None;
        // The blob crosses
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
            Err(_) => return Err(crate::CrateError::ModuleNotFound),
        };
        let module_type = lr
            .package_json
            .map(|pkg| pkg.module_type)
            .unwrap_or(bun_bundler::options::ModuleType::Unknown);

        // A drop-guard so both the normal and error paths reset the arena on
        // the right edge.
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

        // Note: the §Dispatch shim takes path/loader/module_type/printer/
        // promise_ptr bundled as `TranspileExtra` behind `args.extra` (see
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
            // `fetchWithoutOnLoadPlugins` forbids the async path.
            promise_ptr: core::ptr::null_mut(),
        };
        let args = ModuleLoader::TranspileArgs {
            specifier: lr.specifier,
            referrer: referrer_clone.slice(),
            input_specifier: specifier,
            log: std::ptr::from_mut::<bun_ast::Log>(log),
            virtual_source: lr.virtual_source,
            global_object,
            flags,
            extra: &raw mut extra,
        };
        // SAFETY: `guard.0` is the live per-thread VM; `args.extra` points at
        // the live `extra` above.
        let result = unsafe { ModuleLoader::__bun_transpile_source_code(guard.0, &args) };
        if result.is_err() && flags == FetchFlags::PrintSource {
            guard.1 = true; // errdefer
        }
        // `blob_to_deinit` drop guard fires here.
        result
    }

    /// Dupe `s` into a VM-owned allocation for the `_resolve` fast-paths.
    fn dupe_resolved_path(&mut self, s: &[u8]) -> &'static [u8] {
        let boxed: Box<[u8]> = s.to_vec().into_boxed_slice();
        // SAFETY: `boxed`'s heap allocation has a stable address for as long
        // as the owning `Box` lives in `resolved_path_dups` (drained in `destroy()`).
        let slice: &'static [u8] = unsafe { core::mem::transmute::<&[u8], &'static [u8]>(&*boxed) };
        self.resolved_path_dups.push(boxed);
        slice
    }

    /// Note: `is_a_file_path` is a runtime
    /// arg to avoid duplicating the body for both monomorphizations.
    pub(crate) fn _resolve(
        &mut self,
        ret: &mut ResolveFunctionResult,
        specifier: &[u8],
        source: &[u8],
        is_esm: bool,
        is_a_file_path: bool,
    ) -> crate::CrateResult<()> {
        use bun_js_parser::Macro;
        use bun_resolver::{ResultUnion, node_fallbacks};

        // SAFETY: `specifier`/`source` borrow argv / resolver-arena bytes that
        // outlive `ResolveFunctionResult` (see the struct's lifetime-erasure
        // note). Erase to `'static` to seat the result paths without threading
        // a lifetime parameter through the VM.
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
            ret.path = self.dupe_resolved_path(specifier);
            return Ok(());
        }
        if specifier.starts_with(node_fallbacks::IMPORT_PATH) {
            ret.result = None;
            ret.path = self.dupe_resolved_path(specifier);
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
            ret.path = self.dupe_resolved_path(specifier);
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
                ret.path = self.dupe_resolved_path(specifier);
                return Ok(());
            }
            return Err(crate::CrateError::ModuleNotFound);
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

        // A `loop`
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
                ResultUnion::Failure(e) => return Err(e.into()),
                ResultUnion::Pending(_) | ResultUnion::NotFound => {
                    if !retry_on_not_found {
                        return Err(crate::CrateError::ModuleNotFound);
                    }
                    retry_on_not_found = false;

                    // SAFETY: thread-local heap allocation; sole `&mut` on the JS
                    // thread for the duration of the bust below.
                    let buf = unsafe { &mut *specifier_cache_resolver_buf() }.as_mut_slice();
                    let buster_name: &[u8] = if bun_paths::is_absolute(normalized_specifier) {
                        if let Some(dir) = bun_paths::dirname(normalized_specifier) {
                            if dir.len() > buf.len() {
                                return Err(crate::CrateError::ModuleNotFound);
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
                            return Err(crate::CrateError::ModuleNotFound);
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
                    return Err(crate::CrateError::ModuleNotFound);
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
            .ok_or(crate::CrateError::ModuleNotFound)?;
        // SAFETY: `result_path.text` borrows the resolver's arena, which
        // outlives `ResolveFunctionResult` (see the struct's lifetime-erasure
        // note).
        ret.path = unsafe { bun_ptr::detach_lifetime(result_path.text) };
        ret.result = Some(result);

        Ok(())
    }

    /// Module-resolution core: resolves `specifier` relative to `source`, with
    /// path-length checks when `IS_A_FILE_PATH`. `Ok(Err(value))` is a
    /// resolution failure to be thrown/rejected with `value`.
    pub fn resolve_maybe_needs_trailing_slash<const IS_A_FILE_PATH: bool>(
        global: &JSGlobalObject,
        specifier: &bun_core::String,
        source: &bun_core::String,
        query_string: Option<&mut bun_core::String>,
        mode: ResolveMode,
    ) -> JsResult<Result<bun_core::String, JSValue>> {
        const MAX_LEN: usize = (bun_paths::MAX_PATH_BYTES as f64 * 1.5) as usize;
        // `data:` URLs carry the module source inline and never touch the
        // filesystem, so the path-length cap does not apply to them.
        if IS_A_FILE_PATH && specifier.length() > MAX_LEN && !specifier.starts_with_ascii(b"data:")
        {
            let specifier_utf8 = specifier.to_utf8();
            let source_utf8 = source.to_utf8();
            let import_kind = mode.import_kind();
            let printed = crate::ResolveMessage::fmt(
                specifier_utf8.slice(),
                source_utf8.slice(),
                crate::CrateError::Sys(bun_errno::SystemErrno::ENAMETOOLONG),
                import_kind,
            );
            let msg = bun_ast::Msg {
                data: bun_ast::range_data(None, bun_ast::Range::NONE, printed),
                ..Default::default()
            };
            return Ok(Err(crate::ResolveMessage::create(
                global,
                &msg,
                source_utf8.slice(),
            )?));
        }

        let mut result = ResolveFunctionResult::default();
        let jsc_vm_ptr = global.bun_vm_ptr();
        // SAFETY: per-thread VM is live (caller is on the JS thread).
        let jsc_vm = unsafe { &mut *jsc_vm_ptr };

        // Bare/`node:` builtins: answer from the alias table before paying for UTF-8 copies and the resolver.
        // (Alias names are ASCII, so the Latin-1 bytes are the UTF-8 bytes whenever they can match.)
        if jsc_vm.plugin_runner.is_none() && specifier.is_8bit() {
            if let Some(hardcoded) = ModuleLoader::HardcodedModule::Alias::get(
                specifier.latin1(),
                bun_ast::Target::Bun,
                Default::default(),
            ) {
                return Ok(Ok(
                    if mode == ResolveMode::RequireResolve && hardcoded.node_builtin {
                        specifier.clone()
                    } else {
                        bun_core::String::from_bytes(hardcoded.path.as_bytes())
                    },
                ));
            }
        }

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
                    &bun_core::String::from_bytes(namespace),
                    &bun_core::String::borrow_utf8(after_namespace),
                    source,
                    crate::BunPluginTarget::Bun,
                )? {
                    return Ok(resolved_path);
                }
            }
        }

        if let Some(hardcoded) = ModuleLoader::HardcodedModule::Alias::get(
            specifier_utf8.slice(),
            bun_ast::Target::Bun,
            Default::default(),
        ) {
            return Ok(Ok(
                if mode == ResolveMode::RequireResolve && hardcoded.node_builtin {
                    specifier.clone()
                } else {
                    bun_core::String::from_bytes(hardcoded.path.as_bytes())
                },
            ));
        }

        // Node's `--expose-internals`.
        if ModuleLoader::exposed_internal_tag(specifier_utf8.slice()).is_some() {
            return Ok(Ok(specifier.clone()));
        }

        // Swap in a fresh log so resolver errors don't pollute the VM's main log.
        // `vm.log` is set unconditionally in `init` and never cleared,
        // so the `Option` is purely a
        // zeroed-init nicety; the `expect` is infallible.
        let old_log: NonNull<bun_ast::Log> = jsc_vm.log.expect("vm.log set in init");
        let old_transpiler_log: *mut bun_ast::Log = jsc_vm.transpiler.log;
        let mut log = bun_ast::Log::default();
        jsc_vm.log = NonNull::new(&raw mut log);
        jsc_vm.transpiler.log = &raw mut log;
        jsc_vm.transpiler.resolver.log = NonNull::from(&mut log);
        jsc_vm.transpiler.linker.log = &raw mut log;
        if let Some(pm) = jsc_vm.transpiler.resolver.package_manager {
            // SAFETY: the `dyn AutoInstaller` is always `PackageManager`
            // (sole impl — see `VirtualMachine::package_manager`).
            unsafe { (*pm.cast::<bun_install::PackageManager>().as_ptr()).log = &raw mut log };
        }
        // Note: the restore must fire on every exit
        // (including `?` from `ResolveMessage::create` below), so the VM's
        // `log` cannot be left pointing at the dropped stack `log`. Hand-roll
        // a drop guard (no captured borrows) so the unique `&mut *jsc_vm_ptr`
        // below isn't kept alive across the closure. `BackRef` + `as_mut`
        // route the restore through thread-local provenance.
        struct RestoreLog {
            vm: bun_ptr::BackRef<VirtualMachine>,
            old_log: NonNull<bun_ast::Log>,
            old_transpiler_log: *mut bun_ast::Log,
        }
        impl Drop for RestoreLog {
            fn drop(&mut self) {
                // `vm` is the live per-thread VM (caller is on the JS
                // thread); `old_log` outlives the VM (Box::leak in `init`).
                let jsc_vm = self.vm.get().as_mut();
                jsc_vm.log = Some(self.old_log);
                jsc_vm.transpiler.log = self.old_transpiler_log;
                jsc_vm.transpiler.resolver.log = self.old_log;
                jsc_vm.transpiler.linker.log = self.old_log.as_ptr();
                // `_resolve` may have lazily created the PM with
                // `pm.log = resolver.log` (our stack `log`), so restore even
                // if it was `None` when we swapped.
                if let Some(pm) = jsc_vm.transpiler.resolver.package_manager {
                    // SAFETY: sole `dyn AutoInstaller` impl is `PackageManager`.
                    unsafe {
                        (*pm.cast::<bun_install::PackageManager>().as_ptr()).log =
                            self.old_log.as_ptr();
                    }
                }
            }
        }
        let _restore = RestoreLog {
            vm: bun_ptr::BackRef::from(NonNull::new(jsc_vm_ptr).expect("vm non-null")),
            old_log,
            old_transpiler_log,
        };
        // Note: reshaped for borrowck — re-derive from raw so the unique
        // borrow doesn't span the guard's drop.
        // SAFETY: per-thread VM is live for this synchronous call.
        let jsc_vm = unsafe { &mut *jsc_vm_ptr };

        let resolve_result = jsc_vm._resolve(
            &mut result,
            specifier_utf8.slice(),
            normalize_source(source_utf8.slice()),
            mode.is_esm(),
            IS_A_FILE_PATH,
        );
        if let Err(err_) = resolve_result {
            let err = err_;
            let import_kind = mode.import_kind();
            // Find a `.resolve`-metadata msg if the log has one.
            let msg = log
                .msgs
                .iter()
                .find_map(|m| {
                    if let bun_ast::Metadata::Resolve(_) = &m.metadata {
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
                });
            return Ok(Err(crate::ResolveMessage::create(
                global,
                &msg,
                source_utf8.slice(),
            )?));
        }

        if let Some(query) = query_string {
            *query = bun_core::String::clone_utf8(result.query_string);
        }

        Ok(Ok(bun_core::String::clone_utf8(result.path)))
    }
    /// Worker-thread teardown.
    pub fn destroy(&mut self) {
        self.regular_event_loop.deinit();
        self.macro_event_loop.deinit();
        // The VM's own clone of its handle; the shared inner is freed when the
        // last outside holder (C++ client data, a late poster) lets go.
        // SAFETY: `destroy` runs once; the field is not used afterwards.
        unsafe { core::mem::ManuallyDrop::drop(&mut self.handle) };

        // `ProcessAutoKiller`'s `Drop`
        // is the deinit body; take()+drop runs it without dropping `self`.
        drop(core::mem::take(&mut self.auto_killer));

        drop_source_code_printer();

        // `SavedSourceMap`'s `Drop` frees each stored map along with its table.
        drop(core::mem::take(&mut self.source_mappings));

        if let Some(hooks) = runtime_hooks() {
            (hooks.stop_cron_for_vm_teardown)(self);
        }
        if let Some(rare) = self.rare_data.take() {
            // Paired with `rare_data()`'s register_root_region. Without this,
            // every terminated Worker leaves a stale LSAN root entry pointing
            // into a freed arena.
            bun_core::asan::unregister_root_region(
                core::ptr::from_ref::<RareData>(&*rare).cast(),
                core::mem::size_of::<RareData>(),
            );
            drop(rare);
        }

        // Drops all `Arc`-held
        // proxy strings; `ProxyEnvStorage: Default` so take()+drop suffices.
        drop(core::mem::take(&mut self.proxy_env_storage));

        // The VM box is `dealloc`'d raw by the worker (see `web_worker.rs`
        // section 5) so field `Drop`s never run; reclaim the boxed
        // `ModuleLoader` payloads explicitly. `eval_source.contents` may be
        // mmap-backed (`MAPPED_CONTENTS_CACHE`) — `Source`'s `Drop` is a
        // no-op, so dropping the box just frees its own allocation.
        drop(core::mem::take(&mut self.module_loader));

        // Same raw-dealloc story: `preload` is cloned into the VM at spin()
        // time and `load_preloads` clears the boxes but keeps the Vec buffer,
        // so reclaim it here or every Worker leaks it.
        drop(core::mem::take(&mut self.preload));

        // SAFETY: this VM is raw-`dealloc`'d (no field `Drop` runs), so
        // `transpiler` is never auto-dropped after `deinit` clears its fields.
        unsafe { self.transpiler.deinit() };

        drop(core::mem::take(&mut self.resolved_path_dups));
        drop(core::mem::take(&mut self.main_resolved_path));

        self.overridden_main.deinit();

        // `timer`/`entry_point` live in the high-tier `RuntimeState` box, so
        // dispatch the reclaim through the hook.
        if let Some(hooks) = runtime_hooks() {
            let state = core::mem::replace(&mut self.runtime_state, core::ptr::null_mut());
            // SAFETY: hook contract — `state` is exactly the pointer
            // `init_runtime_state` returned for this VM (or null), handed back
            // once on the same thread; `self` is the live per-thread VM.
            unsafe { (hooks.deinit_runtime_state)(std::ptr::from_mut(self), state) };
        }
        self.has_terminated = true;
    }
    /// Note: takes the concrete
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

    /// Deletes the synthetic main-entry module from the module registry.
    pub fn clear_entry_point(&mut self) -> JsResult<()> {
        if self.main().is_empty() {
            return Ok(());
        }
        let str = bun_core::EncodedSlice::latin1(MAIN_FILE_NAME);
        self.global().delete_module_registry_entry(&str)
    }

    /// Whether the per-test-isolation source provider cache is active.
    #[unsafe(export_name = "Bun__VM__useIsolationSourceProviderCache")]
    pub extern "C" fn use_isolation_source_provider_cache(&self) -> bool {
        self.test_isolation_enabled
            && !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_ISOLATION_SOURCE_CACHE::get()
                .unwrap_or(false)
    }

    /// Resets entry-point state and re-loads `entry_path` for the test runner, returning the load promise.
    pub(crate) fn reload_entry_point_for_test_runner(
        &mut self,
        entry_path: &[u8],
    ) -> crate::CrateResult<*mut JSInternalPromise> {
        self.has_loaded = false;
        self.set_main(entry_path);
        self.main_resolved_path = bun_core::String::EMPTY;
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

        // Note: reshaped for borrowck.
        let global = self.global;
        let main_str = bun_core::String::from_bytes(self.main());
        let promise = jsc::JSModuleLoader::load_and_evaluate_module_ptr(global, Some(&main_str))
            .map(NonNull::as_ptr)
            .ok_or(crate::CrateError::JSError)?;
        self.pending_internal_promise = Some(promise);
        self.pending_internal_promise_is_protected = false;
        JSValue::from_cell(promise).ensure_still_alive();
        Ok(promise)
    }

    /// Load a worker's entry: fetch and link its module graph and begin
    /// evaluating it. Returns once evaluation has begun (or the load failed) —
    /// the promise may still be pending on a top-level await, which then
    /// continues in the worker's normal event loop, as in Node.
    pub(crate) fn load_entry_point_for_web_worker(
        &mut self,
        entry_path: &[u8],
    ) -> crate::CrateResult<*mut JSInternalPromise> {
        let promise = self.reload_entry_point(entry_path)?;
        self.event_loop_mut()
            .wait_for_worker_entry_evaluation(jsc::AnyPromise::Internal(promise));
        if let Some(worker) = self.worker_ref() {
            if worker.has_requested_terminate() {
                return Err(crate::CrateError::WorkerTerminated);
            }
        }
        Ok(promise)
    }

    /// Loads a test-file entry point and waits for the load promise to settle.
    pub fn load_entry_point_for_test_runner(
        &mut self,
        entry_path: &[u8],
    ) -> crate::CrateResult<*mut JSInternalPromise> {
        let promise = self.reload_entry_point_for_test_runner(entry_path)?;

        // pending_internal_promise can change if hot module reloading is enabled
        if self.is_watcher_enabled() {
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
            let _ = self.wait_for_promise(jsc::AnyPromise::Internal(promise));
        }

        // Pre-arm the waker so this settled-promise tick cannot park (#36450).
        self.wakeup();
        self.auto_tick();
        Ok(self.pending_internal_promise.unwrap())
    }

    /// Tracks a listening socket so watch-mode reloads can close it.
    pub fn add_listening_socket_for_watch_mode(&mut self, socket: bun_sys::Fd) {
        if self.hot_reload != HotReload::Watch && !self.test_isolation_enabled {
            return;
        }
        self.rare_data().add_listening_socket_for_watch_mode(socket);
    }

    /// Stops tracking a watch-mode listening socket.
    pub fn remove_listening_socket_for_watch_mode(&mut self, socket: bun_sys::Fd) {
        if self.hot_reload != HotReload::Watch && !self.test_isolation_enabled {
            return;
        }
        self.rare_data()
            .remove_listening_socket_for_watch_mode(socket);
    }

    pub fn test_isolation_scope<R>(
        &mut self,
        f: impl FnOnce(&mut TestIsolationState) -> R,
    ) -> Option<R> {
        if !self.test_isolation_enabled {
            return None;
        }
        Some(f(&mut self.test_isolation_state))
    }

    pub fn set_process_cwd(&mut self, to: &bun_core::ZStr) -> bun_sys::Result<()> {
        let fs = self.transpiler.fs_mut();
        bun_sys::chdir(to)?;
        let mut buf = bun_paths::PathBuffer::uninit();
        let into_cwd_len = match bun_sys::getcwd(&mut buf[..]) {
            bun_sys::Result::Ok(r) => r,
            bun_sys::Result::Err(err) => {
                let mut rollback = bun_paths::PathBuffer::uninit();
                let _ = bun_sys::chdir(bun_paths::resolve_path::z(fs.top_level_dir, &mut rollback));
                return bun_sys::Result::Err(err);
            }
        };
        fs.top_level_dir_buf[..into_cwd_len].copy_from_slice(&buf[..into_cwd_len]);
        fs.top_level_dir_buf[into_cwd_len] = 0;
        // SAFETY: `top_level_dir_buf` is a process-lifetime field of the
        // FileSystem singleton, so the detached borrow never outlives its
        // backing storage.
        fs.top_level_dir =
            unsafe { bun_ptr::detach_lifetime(&fs.top_level_dir_buf[..into_cwd_len]) };
        let len = fs.top_level_dir.len();
        if fs.top_level_dir_buf[len - 1] != bun_paths::SEP {
            fs.top_level_dir_buf[len] = bun_paths::SEP;
            fs.top_level_dir_buf[len + 1] = 0;
            // SAFETY: see above.
            fs.top_level_dir =
                unsafe { bun_ptr::detach_lifetime(&fs.top_level_dir_buf[..len + 1]) };
        }
        bun_core::set_top_level_dir(fs.top_level_dir);
        Ok(())
    }

    /// Replaces the global object between test files so each file runs in a fresh realm.
    ///
    /// Callers must run `bun_runtime::jsc_hooks::stop_active_handles_for_test_isolation(vm)`
    /// first so leaked watchers/servers are stopped (dropping their JS-side
    /// Strongs, which otherwise pin the outgoing global) before the blind
    /// socket-group close below. That helper lives in the higher-tier crate
    /// and cannot be called from here.
    pub fn swap_global_for_test_isolation(&mut self) {
        debug_assert!(self.test_isolation_enabled);

        // The finished file's workers, ports, channels and sockets are stopped
        // first (no events dispatched), before its socket groups and timers are
        // swept and before the new global exists.
        Zig__GlobalObject__stopActiveDOMObjectsForTestIsolation(self.global());

        if let Some(cwd) = self.test_isolation_state.saved_cwd.take() {
            let mut buf = bun_paths::PathBuffer::uninit();
            let z = bun_paths::resolve_path::z(&cwd, &mut buf);
            let _ = self.set_process_cwd(z);
        }

        let _ = self.event_loop_mut().drain_microtasks();

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
            // SAFETY: process-global usockets loop is live.
            let loop_ = unsafe { &mut *uws::Loop::get() };
            let mut maybe_group = loop_.internal_loop_data.head;
            while let Some(group) = NonNull::new(maybe_group) {
                // SAFETY: `group` is a live `us_socket_group_t` linked in the loop.
                let next = unsafe { (*group.as_ptr()).next };
                let g = group.as_ptr();
                if g != skip_spawn_ipc && g != skip_test_parallel_ipc {
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
            // `setCallbacks` is once-only (node/src/quic/bindingdata.cc
            // `BindingData::SetCallbacks`), so a holder left by the outgoing
            // global makes the next file's call a no-op and dispatches
            // node:quic events into the dead realm.
            rare.node_quic_callbacks.deinit();
        }
        let _ = self.event_loop_mut().drain_microtasks();

        let _ = self.auto_killer.kill();
        self.auto_killer.clear();

        self.test_isolation_generation = self.test_isolation_generation.wrapping_add(1);

        // Generation-stale JS timers would otherwise release their pins only
        // when they fire — a module-scope `setTimeout(cb, 3_600_000)` keeps a
        // Strong on its wrapper (and thereby the outgoing global's whole
        // graph) for an hour. Every TimeoutObject / ImmediateObject /
        // AbortSignal timeout in the heap belongs to the outgoing file (the
        // new global doesn't exist yet), so drop them eagerly, same as
        // `global_exit()`. Runs no user JS.
        //
        // The hook also runs `StatWatcherScheduler::shutdown_for_exit` first:
        // it drains the (already-closed — the caller ran
        // `stop_active_handles_for_test_isolation` before this swap) watcher queue and retires
        // the per-VM scheduler singleton, which the next file's first
        // `fs.watchFile` lazily recreates. That per-file reset is intentional
        // — the scheduler's queue and in-flight work-pool task belong to the
        // outgoing file, and its brief spin-wait is bounded by at most one
        // in-flight `stat()`.
        if let Some(hooks) = runtime_hooks() {
            // SAFETY: live per-thread VM on the JS thread; `runtime_state`
            // stays installed for the whole test run.
            unsafe { (hooks.cancel_all_timers)(core::ptr::from_mut(self)) };
        }

        self.overridden_main.deinit();
        self.entry_point_result.value.deinit();
        self.entry_point_result.cjs_set_value = false;
        self.entry_point_result.evaluated_as_cjs = false;
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
        self.main_resolved_path = bun_core::String::EMPTY;
        self.unhandled_error_counter = 0;
        // The finished file's plugins are dropped with its global; the next
        // `Bun.plugin()` call reinstalls the runner against the new global.
        self.transpiler.linker.plugin_runner = None;
        self.plugin_runner = None;

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
        if let Some(rare) = self.rare_data.as_deref_mut() {
            for hook in rare.cleanup_hooks.iter_mut() {
                if hook.global_this == old_global {
                    hook.global_this = new_global;
                }
            }
        }

        self.undo_process_env_side_effects();
        self.undo_synthetic_allocation_limit();
    }

    /// `setSyntheticAllocationLimitForTesting` lowers a process-wide limit.
    /// Put the startup value back so a file's limit stays with that file.
    fn undo_synthetic_allocation_limit(&mut self) {
        if let Some(limit) = self.test_isolation_state.synthetic_allocation_limit {
            SYNTHETIC_ALLOCATION_LIMIT.store(limit, core::sync::atomic::Ordering::Relaxed);
            STRING_ALLOCATION_LIMIT.store(limit, core::sync::atomic::Ordering::Relaxed);
        }
    }

    /// The `process.env` keys with a custom setter (`applySharedEnvSideEffects`
    /// in JSEnvironmentVariableMap.cpp) write past the env object: TZ into the
    /// WTF time zone override, NODE_TLS_REJECT_UNAUTHORIZED and
    /// BUN_CONFIG_VERBOSE_FETCH into per-VM caches, and the proxy keys into the
    /// env map that seeds the next global's `process.env`. Put each back to
    /// its startup state so a file's write does not reach the files after it.
    fn undo_process_env_side_effects(&mut self) {
        self.default_tls_reject_unauthorized = None;
        self.default_verbose_fetch.set(None);
        if let Some(tz) = self.test_isolation_state.time_zone.as_deref() {
            let _ = self
                .global()
                .set_time_zone(&bun_core::EncodedSlice::from_bytes(tz));
        }
        if let Some(snapshot) = self.test_isolation_state.proxy_env.as_ref() {
            let mut slots = self.proxy_env_storage.lock();
            slots.restore(&mut self.transpiler.env_mut().map, snapshot);
        }
    }

    /// Loads and evaluates a macro entry module, waiting for its promise.
    #[inline]
    pub(crate) fn _load_macro_entry_point(
        &mut self,
        entry_path: &[u8],
    ) -> Option<*mut JSInternalPromise> {
        let path_str = bun_core::String::from_bytes(entry_path);
        let promise =
            jsc::JSModuleLoader::load_and_evaluate_module_ptr(self.global, Some(&path_str))?
                .as_ptr();
        let _ = self.wait_for_promise(jsc::AnyPromise::Internal(promise));
        Some(promise)
    }

    /// Prints an error-like JS value to the console via the error handler.
    pub fn print_error_like_object_to_console(&mut self, value: JSValue) {
        self.run_error_handler(value, None);
    }

    /// Note: takes runtime bools and the concrete `bun_core::io::Writer`.
    pub fn print_errorlike_object(
        &mut self,
        value: JSValue,
        exception: Option<&Exception>,
        mut exception_list: Option<&mut ExceptionList>,
        formatter: &mut crate::console_object::Formatter,
        writer: &mut bun_core::io::Writer,
        allow_ansi_color: bool,
        allow_side_effects: bool,
    ) {
        // Note: the post-print stack/exception_list block is handled at the
        // tail instead of via a drop guard (the body has no early-`?` returns
        // once the AggregateError branch is taken).
        let global_ref = self.global();

        let errors = if value.is_aggregate_error(global_ref) {
            match value.fast_get(global_ref, jsc::BuiltinName::errors) {
                Ok(errors) => errors,
                Err(_) => {
                    global_ref.clear_exception();
                    None
                }
            }
        } else {
            None
        };
        if let Some(errors) = errors {
            // Note: `JSValue::for_each` takes a C-ABI fn
            // pointer + erased ctx, so thread the captures through a struct.
            // The C trampoline erases lifetimes via `*mut c_void`; round-trip
            // the caller's `&mut ExceptionList` as a raw pointer so child
            // errors append to the same list.
            struct AggCtx<'a> {
                formatter: *mut crate::console_object::Formatter<'a>,
                writer: *mut bun_core::io::Writer,
                exception_list: *mut ExceptionList,
                allow_ansi_color: bool,
                allow_side_effects: bool,
                printed_member: bool,
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
                let exception_list = if ctx.exception_list.is_null() {
                    None
                } else {
                    // SAFETY: non-null branch; borrows the caller's stack
                    // `ExceptionList`, live for the synchronous `for_each`.
                    Some(unsafe { &mut *ctx.exception_list })
                };
                // SAFETY: `ctx.formatter` borrows the caller's stack local,
                // live across the synchronous `for_each` call.
                let formatter = unsafe { &mut *ctx.formatter };
                // SAFETY: `ctx.writer` borrows the caller's stack local,
                // live across the synchronous `for_each` call.
                let writer = unsafe { &mut *ctx.writer };
                ctx.printed_member = true;
                vm.print_errorlike_object(
                    next_value,
                    None,
                    exception_list,
                    formatter,
                    writer,
                    ctx.allow_ansi_color,
                    ctx.allow_side_effects,
                );
            }
            let mut ctx = AggCtx {
                formatter: std::ptr::from_mut(&mut *formatter),
                writer: std::ptr::from_mut(&mut *writer),
                exception_list: exception_list
                    .as_deref_mut()
                    .map_or(core::ptr::null_mut(), std::ptr::from_mut::<ExceptionList>),
                allow_ansi_color,
                allow_side_effects,
                printed_member: false,
            };
            if errors
                .for_each(global_ref, (&raw mut ctx).cast(), agg_iter)
                .is_err()
            {
                global_ref.clear_exception();
            }
            if ctx.printed_member {
                return;
            }
            // `errors` is empty or not iterable: print the AggregateError itself.
        }

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
                // Note: `holder.deinit(self)` runs at the tail (for borrowck)
                // — semantics unchanged because
                // `need_to_clear_parser_arena_on_deinit` is false here.
                let zig_exception: &mut ZigException = holder.zig_exception();
                exception_.get_stack_trace(global_ref, &mut zig_exception.stack);
                if zig_exception.stack.frames_len > 0 {
                    let _ = Self::print_stack_trace(writer, &zig_exception.stack, allow_ansi_color);
                }
                if let Some(list) = exception_list {
                    let origin = self.is_from_devserver.then_some(&self.origin);
                    zig_exception.add_to_error_list(list, self.top_level_dir(), origin);
                }
                holder.deinit(self);
            }
        }
    }

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
            if err == crate::CrateError::JSError {
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

    /// Reports an uncaught exception through the owning VM's handler; returns `undefined`.
    pub(crate) fn report_uncaught_exception(
        global_object: &JSGlobalObject,
        exception: &Exception,
    ) -> JSValue {
        let jsc_vm = global_object.bun_vm().as_mut();
        let _ = jsc_vm.uncaught_exception(global_object, exception.value(), false);
        JSValue::UNDEFINED
    }

    /// Note: takes a runtime bool + concrete writer.
    pub(crate) fn print_stack_trace(
        writer: &mut bun_core::io::Writer,
        trace: &crate::ZigStackTrace,
        allow_ansi_colors: bool,
    ) -> crate::CrateResult<()> {
        use crate::zig_stack_frame::LineColumn;
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
            // Format into a scratch `String` to probe whether the formatter
            // emits anything.
            let has_name = {
                use core::fmt::Write as _;
                let mut probe = String::new();
                let _ = write!(probe, "{}", frame.name_formatter(false));
                !probe.is_empty()
            };

            // Route through `bun_core::pretty_fmt!` with a local wrapper that
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
                    frame.source_url_formatter(dir, origin, LineColumn::Include, allow_ansi_colors)
                )?;
            } else if !frame.position.is_invalid() {
                pretty_write!(
                    "<r>      <d>at <r>{}\n",
                    frame.source_url_formatter(dir, origin, LineColumn::Include, allow_ansi_colors)
                )?;
            } else if has_name {
                pretty_write!(
                    "<r>      <d>at <r>{}<d>\n",
                    frame.name_formatter(allow_ansi_colors)
                )?;
            } else {
                pretty_write!(
                    "<r>      <d>at <r>{}<d>\n",
                    frame.source_url_formatter(dir, origin, LineColumn::Include, allow_ansi_colors)
                )?;
            }
        }
        Ok(())
    }

    /// # Safety
    /// `frames` must point to `frames_count` initialized `ZigStackFrame`s.
    pub unsafe fn remap_stack_frame_positions(
        &mut self,
        frames: *mut crate::ZigStackFrame,
        frames_count: usize,
    ) {
        if frames_count == 0 {
            return;
        }
        // **Warning** this method can be called in the heap collector thread!!
        self.remap_stack_frames_mutex.lock();

        self.source_mappings.lock();

        // Note: a last-`(hash → InternalSourceMap)` cache across the loop
        // would be purely a perf optimization (most stacks repeat the same
        // source); do the straightforward per-frame resolve. See the PERF
        // note below.
        // SAFETY: caller passes `frames_count` valid `ZigStackFrame`s.
        let frames = unsafe { bun_core::ffi::slice_mut(frames, frames_count) };
        for frame in frames {
            if frame.position.is_invalid() || frame.remapped {
                continue;
            }
            if frame.source_url.is_empty() {
                frame.remapped = true;
                continue;
            }
            // PERF: could cache `(hash → ism)` across iterations.
            // Slow path: drops and re-acquires the source_mappings lock around
            // resolve_source_mapping().
            self.source_mappings.unlock();
            let resolved = {
                let source_url = frame.source_url.to_utf8();
                self.resolve_source_mapping(
                    source_url.slice(),
                    frame.position.line,
                    frame.position.column,
                    bun_sourcemap::SourceContentHandling::NoSourceContents,
                )
                .map(|lookup| {
                    (
                        lookup.display_source_url_if_needed(source_url.slice()),
                        lookup,
                    )
                })
            };
            if let Some((display_url, lookup)) = resolved {
                if let Some(source_url) = display_url {
                    frame.source_url = source_url;
                }
                // Direct copy; both sides are
                // `bun_core::Ordinal`. A `from_zero_based` round-trip would
                // debug-assert on the valid INVALID (-1) sentinel.
                frame.position.line = lookup.mapping.original.lines;
                frame.position.column = lookup.mapping.original.columns;
                frame.remapped = true;
            } else {
                frame.remapped = true;
            }
            self.source_mappings.lock();
        }

        self.source_mappings.unlock();
        self.remap_stack_frames_mutex.unlock();
    }

    /// Fills `exception` from `error_instance`, remapping stack frames through source maps.
    pub(crate) fn remap_zig_exception(
        &mut self,
        exception: &mut ZigException,
        error_instance: JSValue,
        exception_list: Option<&mut ExceptionList>,
        must_reset_parser_arena_later: &mut bool,
        source_code_slice: &mut Option<bun_core::Utf8Bytes<'static>>,
        allow_source_code_preview: bool,
    ) {
        // `global()` returns `&'static`, so the borrow detaches from `&self`
        // and survives the `&mut self` reborrows below.
        let global = self.global();
        error_instance.to_zig_exception(global, exception);
        // `Cell<bool>` so the `Tail` drop-guard below can hold a shared `&Cell`
        // and read the *current* value at scope-exit without a raw-ptr deref,
        // while the body freely `.set()`s it.
        let enable_source_code_preview = Cell::new(
            allow_source_code_preview
                && !(bun_core::env_var::feature_flag::BUN_DISABLE_SOURCE_CODE_PREVIEW::get()
                    .unwrap_or(false)
                    || bun_core::env_var::feature_flag::BUN_DISABLE_TRANSPILED_SOURCE_CODE_PREVIEW::get()
                        .unwrap_or(false)),
        );

        // Note: this guard runs the two tail blocks on the way out so every
        // early `return` is covered.
        struct Tail<'a> {
            this: *mut VirtualMachine,
            exception: *mut ZigException,
            exception_list: Option<&'a mut ExceptionList>,
            enable_source_code_preview: &'a Cell<bool>,
            source_code_slice: *const Option<bun_core::Utf8Bytes<'static>>,
        }
        impl Drop for Tail<'_> {
            fn drop(&mut self) {
                // SAFETY: `this`/`exception` are stack-local raw ptrs taken
                // before the body below reborrows them; no overlap at drop.
                let this = unsafe { &mut *self.this };
                // SAFETY: `self.exception` is the caller's stack
                // `ZigException`, live for the guard scope; no overlap at drop.
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
                    let origin = this.is_from_devserver.then_some(&this.origin);
                    exception.add_to_error_list(list, this.top_level_dir(), origin);
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
        // SAFETY: as above — re-borrow through the guard's raw ptr; `_tail`
        // does not touch `source_code_slice` until Drop.
        let source_code_slice: &mut Option<bun_core::Utf8Bytes<'static>> =
            unsafe { &mut *_tail.source_code_slice.cast_mut() };

        fn is_noisy_builtin(name: &bun_core::String) -> bool {
            name.eq_ascii(b"asyncModuleEvaluation")
                || name.eq_ascii(b"link")
                || name.eq_ascii(b"linkAndEvaluateModule")
                || name.eq_ascii(b"moduleEvaluation")
                || name.eq_ascii(b"processTicksAndRejections")
        }
        fn is_hidden_frame(f: &crate::ZigStackFrame) -> bool {
            f.source_url.eq_ascii(b"bun:wrap") || f.function_name.eq_ascii(b"::bunternal::")
        }
        fn is_unknown_source(url: &bun_core::String) -> bool {
            url.is_empty() || url.eq_ascii(b"[unknown]") || url.starts_with_ascii(b"[source:")
        }

        let mut frames_len = exception.stack.frames_len as usize;
        // SAFETY: `frames_ptr[..frames_len]` is the caller-owned `Holder`
        // backing buffer (ZigStackTrace contract).
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
                    // Swap rather than overwrite: the discarded tail past `j`
                    // still owns its strings and is released with the Holder.
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
                if frame.source_url.starts_with_ascii(b"bun:")
                    || frame.source_url.starts_with_ascii(b"node:")
                    || frame.source_url.is_empty()
                    || frame.source_url.eq_ascii(b"native")
                    || frame.source_url.eq_ascii(b"unknown")
                    || frame.source_url.eq_ascii(b"[unknown]")
                    || frame.source_url.starts_with_ascii(b"[source:")
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
        if frames[top].source_url.eq_ascii(b"[repl]") {
            enable_source_code_preview.set(false);
        }

        let already_remapped = frames[top].remapped;
        let resolved = {
            let top_source_url = frames[top].source_url.to_utf8();
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
                })
            } else {
                self.resolve_source_mapping(
                    top_source_url.slice(),
                    frames[top].position.line,
                    frames[top].position.column,
                    bun_sourcemap::SourceContentHandling::SourceContents,
                )
            };

            maybe_lookup.map(|lookup| {
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
                    None
                };
                (mapping, display_url, external_code)
            })
        };

        if let Some((mapping, display_url, external_code)) = resolved {
            if let Some(src) = display_url {
                frames[top].source_url = src;
            }

            let code: bun_core::Utf8Bytes<'static> = 'code: {
                if !enable_source_code_preview.get() {
                    break 'code bun_core::Utf8Bytes::EMPTY;
                }
                if let Some(src) = external_code {
                    break 'code src;
                }
                if top_frame_is_builtin {
                    // Avoid printing "export default 'native'"
                    break 'code bun_core::Utf8Bytes::EMPTY;
                }
                let mut log = bun_ast::Log::default();
                let Ok(original_source) = Self::fetch_without_on_load_plugins(
                    self,
                    global,
                    &frames[top].source_url,
                    &bun_core::String::EMPTY,
                    &mut log,
                    FetchFlags::PrintSource,
                ) else {
                    // Source is gone; the frames still get remapped below.
                    break 'code bun_core::Utf8Bytes::EMPTY;
                };
                *must_reset_parser_arena_later = true;
                original_source.source_code.into_utf8()
            };

            if enable_source_code_preview.get() && code.slice().is_empty() {
                exception.collect_source_lines(error_instance, global);
            }

            // Direct copy; both sides are `bun_core::Ordinal`.
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
                // SAFETY: `Holder` backs `source_lines_numbers` with `[i32; SOURCE_LINES_COUNT]`.
                let source_line_numbers =
                    unsafe { bun_core::ffi::slice_mut(exception.stack.source_lines_numbers, N) };
                for s in source_lines.iter_mut() {
                    *s = bun_core::String::EMPTY;
                }
                source_line_numbers.fill(0);

                let take = lines.len().min(N);
                let mut current_line_number = last_line;
                for (i, line) in lines[..take].iter().enumerate() {
                    // To minimize duplicate allocations, we use the same slice
                    // as above — it should virtually always be UTF-8 and thus
                    // not cloned.
                    source_lines[i] = bun_core::String::from_bytes(line);
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

        if frames.len() > 1 {
            for i in 0..frames.len() {
                // `remapped`: frames parsed back out of a formatted `error.stack`.
                if i == top || frames[i].remapped || frames[i].position.is_invalid() {
                    continue;
                }
                let resolved = {
                    let source_url = frames[i].source_url.to_utf8();
                    self.resolve_source_mapping(
                        source_url.slice(),
                        frames[i].position.line,
                        frames[i].position.column,
                        bun_sourcemap::SourceContentHandling::NoSourceContents,
                    )
                    .map(|lookup| {
                        (
                            lookup.display_source_url_if_needed(source_url.slice()),
                            lookup,
                        )
                    })
                };
                if let Some((display_url, lookup)) = resolved {
                    if let Some(src) = display_url {
                        frames[i].source_url = src;
                    }
                    let mapping = lookup.mapping;
                    frames[i].remapped = true;
                    // Direct copy.
                    frames[i].position.line = mapping.original.lines;
                    frames[i].position.column = mapping.original.columns;
                }
            }
        }
    }

    /// Prints an already-remapped exception (name, message, stack, source lines) to `writer`.
    pub fn print_externally_remapped_zig_exception(
        &mut self,
        zig_exception: &mut ZigException,
        formatter: Option<&mut crate::console_object::Formatter>,
        writer: &mut bun_core::io::Writer,
        allow_side_effects: bool,
        allow_ansi_color: bool,
    ) -> crate::CrateResult<()> {
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

    /// JS-value variant of the error printer; see
    /// [`Self::print_error_instance_body`].
    fn print_error_instance_js(
        &mut self,
        error_instance: JSValue,
        exception_list: Option<&mut ExceptionList>,
        formatter: &mut crate::console_object::Formatter,
        writer: &mut bun_core::io::Writer,
        allow_ansi_color: bool,
        allow_side_effects: bool,
    ) -> crate::CrateResult<()> {
        // Note: stack-safety guard for the Error recursion path.
        // `print_error_instance_body` dispatches on runtime bools, so it
        // carries the union of all
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

        // Note: `Holder` is ~4 KB (32 ZigStackFrames + 6 source lines +
        // ZigException). It sits next to the large runtime-dispatched body, so
        // box it to keep the per-level recursion frame small enough for the
        // 16K-deep `bun-inspect.test.ts` Error chain on Windows debug.
        let mut exception_holder = Box::new(crate::zig_exception::Holder::init());
        // Note: reshaped for borrowck — `zig_exception()` returns a
        // `&mut` into the holder; we need to also borrow
        // `need_to_clear_parser_arena_on_deinit` disjointly. Route through a
        // raw pointer (the holder is heap-pinned for the call).
        let exception: *mut ZigException = exception_holder.zig_exception();
        let mut source_code_slice: Option<bun_core::Utf8Bytes<'static>> = None;

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
            None, // Note: `exception_list` was already
            // consumed by `remap_zig_exception` above (only writer).
            formatter,
            writer,
            allow_ansi_color,
            allow_side_effects,
        );

        drop(source_code_slice);
        exception_holder.deinit(self);
        result
    }

    /// Shared error-printer body for both the JS-value
    /// (`error_instance != .zero`) and pre-built-exception
    /// (`error_instance == .zero`) modes. Renders source-line previews, the
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
    ) -> crate::CrateResult<()> {
        use crate::JSType;
        use crate::console_object::formatter::TagOptions;
        use crate::console_object::{self, Tag, TagPayload};

        let prev_had_errors = self.had_errors;
        self.had_errors = true;
        // Note: restore `had_errors` on
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
            vm: bun_ptr::BackRef::new(&*self),
            prev: prev_had_errors,
        };

        if allow_side_effects {
            if let Some(debugger) = self.debugger.as_deref_mut() {
                debugger.lifecycle_reporter_agent.report_error(exception);
            }
            if let Some(cb) = self.on_print_error_zig_exception {
                cb(self.on_print_error_zig_exception_ctx, exception);
            }
        }

        // Defer the GitHub-annotation print to scope exit.
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
            exception: bun_ptr::BackRef::new(&*exception),
        };

        // `pretty_fmt!` takes a `const` color parameter, so route the runtime
        // `allow_ansi_color` bool through a local wrapper.
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
        fn splat_space(w: &mut bun_core::io::Writer, mut n: u64) -> crate::CrateResult<()> {
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

            let trimmed = source.trimmed_text();
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

        let name = &exception.name;
        let message = &exception.message;

        let is_error_instance = error_instance != JSValue::ZERO
            && error_instance.is_cell()
            && error_instance.js_type() == JSType::ErrorInstance;
        // NOTE: cannot use `self.global()` — `global_ref` outlives a
        // `&mut self` recursion (`print_error_instance_js`) and is passed to
        // `Formatter<'2>::format`, which requires an unbounded (VM-lifetime)
        // borrow. `global()` returns `&'static` so the borrow detaches.
        let global_ref = self.global();
        // Holds the owning `bun_core::String` so the latin1 view below stays
        // live for this fn.
        let code_string: Option<bun_core::String>;
        let code: Option<&[u8]> = if is_error_instance {
            // SAFETY: `is_error_instance` ⇒ `get_object()` is `Some`.
            let obj = unsafe { &mut *error_instance.get_object().unwrap_unchecked() };
            if let Some(code_value) = obj.get_code_property_vm_inquiry(global_ref) {
                if code_value.is_string() {
                    match code_value.to_bun_string(global_ref) {
                        Ok(s) if s.is_8bit() => {
                            code_string = Some(s);
                            code_string.as_ref().map(|s| s.latin1())
                        }
                        Ok(_) => None,
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
                            || frame.source_url.starts_with_ascii(b"bun:")
                            || frame.source_url.starts_with_ascii(b"node:")
                        {
                            continue;
                        }
                        top_frame = Some(frame);
                        break;
                    }
                }

                let trimmed = source.trimmed_text();

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
        // Each appended error is unprotected at scope exit.
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
            let iterator = crate::JSPropertyIterator::init(
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
            while let Some((field, value)) = iterator.next()? {
                if field.eq_ascii(b"message") || field.eq_ascii(b"name") || field.eq_ascii(b"stack")
                {
                    continue;
                }
                if field.eq_ascii(b"code") && code.is_some() {
                    continue;
                }

                let kind = value.js_type();
                if kind == JSType::ErrorInstance && !prev_had_errors {
                    if field.eq_ascii(b"cause") {
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
                    // Hand-rolled drop guard restores the formatter state.
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
                let key = bun_core::String::static_("cause");
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

    fn print_error_name_and_message(
        name: &bun_core::String,
        message: &bun_core::String,
        is_browser_error: bool,
        optional_code: Option<&[u8]>,
        writer: &mut bun_core::io::Writer,
        allow_ansi_color: bool,
        error_display_level: crate::console_object::ErrorDisplayLevel,
    ) -> crate::CrateResult<()> {
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
            let (display_name, display_message) = if name.eq_ascii(b"Error") {
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
                                    bun_core::StringView::from_bytes(code),
                                    message.substring(code.len() + 2),
                                );
                            }
                        }
                    }
                    (
                        bun_core::StringView::EMPTY,
                        bun_core::StringView::new(message),
                    )
                }
            } else {
                (
                    bun_core::StringView::new(name),
                    bun_core::StringView::new(message),
                )
            };
            pretty_write!(
                "{}<b>{}<r>\n",
                error_display_level.formatter(&display_name, allow_ansi_color, Colon::IncludeColon),
                display_message,
            )?;
        } else if !name.is_empty() {
            writeln!(
                writer,
                "{}",
                error_display_level.formatter(name, allow_ansi_color, Colon::IncludeColon)
            )?;
        } else if !message.is_empty() {
            pretty_write!(
                "{}<b>{}<r>\n",
                error_display_level.formatter(
                    &bun_core::String::EMPTY,
                    allow_ansi_color,
                    Colon::IncludeColon
                ),
                message,
            )?;
        } else {
            pretty_write!(
                "{}\n",
                error_display_level.formatter(
                    &bun_core::String::EMPTY,
                    allow_ansi_color,
                    Colon::ExcludeColon
                ),
            )?;
        }
        Ok(())
    }

    /// Emits a GitHub Actions `::error` annotation for the exception when running in CI.
    #[cold]
    #[inline(never)]
    pub(crate) fn print_github_annotation(exception: &ZigException) {
        use crate::zig_stack_frame::LineColumn;
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
                let file = crate::ZigStackFrame::relative_source_url(dir, source_url.slice());
                let _ = write!(
                    writer,
                    "\n::error file={},line={},col={},title=",
                    bun_core::fmt::github_action_property(file),
                    frame.position.line.one_based(),
                    frame.position.column.one_based(),
                );
                has_location = true;
            }
        }
        if !has_location {
            let _ = writer.write_all(b"\n::error title=");
        }

        if name.is_empty() || name.eq_ascii(b"Error") {
            let _ = writer.write_all(b"error");
        } else {
            let name_utf8 = name.to_utf8();
            let _ = write!(
                writer,
                "{}",
                bun_core::fmt::github_action_property(name_utf8.slice())
            );
        }

        if !message.is_empty() {
            let message_slice = message.to_utf8();
            let msg = message_slice.slice();
            let mut cursor: u32 = 0;
            if let Some(i) = bun_core::strings::index_of_char(msg, b'\n') {
                cursor = i + 1;
                let _ = write!(
                    writer,
                    ": {}::",
                    bun_core::fmt::github_action_property(&msg[..i as usize])
                );
            } else {
                let _ = write!(writer, ": {}::", bun_core::fmt::github_action_property(msg));
            }
            // Skip past the next newline.
            if let Some(i) = bun_core::strings::index_of_char(&msg[cursor as usize..], b'\n') {
                cursor += i + 1;
            }
            if cursor > 0 {
                let _ = write!(
                    writer,
                    "{}",
                    bun_core::fmt::github_action(&msg[cursor as usize..])
                );
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
                let file = crate::ZigStackFrame::relative_source_url(dir, source_url.slice());
                let func = frame.function_name.to_utf8();
                if file.is_empty() && func.slice().is_empty() {
                    continue;
                }
                let (name_str, loc_str) = {
                    use core::fmt::Write as _;
                    let mut name_str = String::new();
                    let _ = write!(name_str, "{}", frame.name_formatter(false));
                    let mut loc_str = String::new();
                    let _ = write!(
                        loc_str,
                        "{}",
                        frame.source_url_formatter(file, origin, LineColumn::Include, false)
                    );
                    (name_str, loc_str)
                };
                if !name_str.is_empty() {
                    let _ = write!(
                        writer,
                        "%0A      at {} ({})",
                        bun_core::fmt::github_action(name_str.as_bytes()),
                        bun_core::fmt::github_action(loc_str.as_bytes()),
                    );
                } else {
                    let _ = write!(
                        writer,
                        "%0A      at {}",
                        bun_core::fmt::github_action(loc_str.as_bytes()),
                    );
                }
            }
        }

        let _ = writer.write_all(b"\n");
        let _ = writer.flush();
    }

    /// Looks up the source-map mapping for `path` at `line:column`.
    pub(crate) fn resolve_source_mapping(
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

        // Standalone-module-graph fallback: the sourcemap load reaches into
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

        // The `Arc::clone` is the ref-bump; `into_raw` transfers that strong
        // ref into the table (reclaimed by `put_value`'s replace path /
        // `SavedSourceMap` teardown).
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
        })
    }

    /// To satisfy the interface from NewHotReloader().
    pub(crate) fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
        self.transpiler.resolver.bust_dir_cache(path)
    }
}

fn is_error_like(global_object: &JSGlobalObject, reason: JSValue) -> JsResult<bool> {
    jsc::from_js_host_call_generic(global_object, || {
        Bun__promises__isErrorLike(global_object, reason)
    })
}

/// What `--unhandled-rejections=strict|throw` hand to the uncaught-exception path for `reason`. If describing the
/// rejection itself throws (a hostile Proxy under isErrorLike, an OOM resolving a rope), that failure does not
/// replace the thing being reported: the rejection is the user's bug, so it is reported as-is — unless what was
/// thrown is a termination, which has to win.
fn unhandled_rejection_as_uncaught_error(
    global_object: &JSGlobalObject,
    reason: JSValue,
) -> JSValue {
    match wrap_unhandled_rejection_error_for_uncaught_exception(global_object, reason) {
        Ok(wrapped) => wrapped,
        Err(e) => {
            let secondary = global_object.take_exception(e);
            if secondary.is_termination_exception() {
                secondary
            } else {
                reason
            }
        }
    }
}

fn wrap_unhandled_rejection_error_for_uncaught_exception(
    global_object: &JSGlobalObject,
    reason: JSValue,
) -> JsResult<JSValue> {
    if is_error_like(global_object, reason)? {
        return Ok(reason);
    }
    let reason_str = jsc::from_js_host_call_generic(global_object, || {
        Bun__noSideEffectsToString(global_object.vm(), global_object, reason)
    })?;
    const MSG_1: &str = "This error originated either by throwing inside of an async function \
        without a catch block, or by rejecting a promise which was not handled with .catch(). \
        The promise rejected with the reason \"";
    if reason_str.is_string_literal() {
        let view = reason_str.as_string().view(global_object)?;
        return Ok(global_object
            .err(
                crate::ErrorCode::ERR_UNHANDLED_REJECTION,
                format_args!("{MSG_1}{view}\"."),
            )
            .to_js());
    }
    Ok(global_object
        .err(
            crate::ErrorCode::ERR_UNHANDLED_REJECTION,
            format_args!("{MSG_1}undefined\"."),
        )
        .to_js())
}

/// `None` when no `Bun.plugin()` `onResolve` callback claimed the specifier.
pub(crate) fn plugin_runner_on_resolve_jsc(
    global: &JSGlobalObject,
    namespace: &bun_core::String,
    specifier: &bun_core::String,
    importer: &bun_core::String,
    target: crate::BunPluginTarget,
) -> JsResult<Option<Result<bun_core::String, JSValue>>> {
    let empty = bun_core::String::EMPTY;
    let Some(on_resolve_plugin) = global.run_on_resolve_plugins(
        if namespace.length() > 0 && !namespace.eq_ascii(b"file") {
            namespace
        } else {
            &empty
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
        return Ok(Some(Err(global.create_error_instance(format_args!(
            "Expected \"path\" to be a string in onResolve plugin"
        )))));
    }

    let file_path = path_value.to_bun_string(global)?;

    if file_path.length() == 0 {
        return Ok(Some(Err(global.create_error_instance(format_args!(
            "Expected \"path\" to be a non-empty string in onResolve plugin"
        )))));
    } else if file_path.eq_ascii(b".")
        || file_path.eq_ascii(b"..")
        || file_path.eq_ascii(b"...")
        || file_path.eq_ascii(b" ")
    {
        return Ok(Some(Err(global.create_error_instance(format_args!(
            "\"path\" is invalid in onResolve plugin"
        )))));
    }
    let user_namespace: bun_core::String = 'brk: {
        if let Some(namespace_value) = on_resolve_plugin.get(global, b"namespace")? {
            if !namespace_value.is_string() {
                return Ok(Some(Err(global.create_error_instance(format_args!(
                    "Expected \"namespace\" to be a string"
                )))));
            }

            let namespace_str = namespace_value.to_bun_string(global)?;
            if namespace_str.length() == 0 {
                break 'brk bun_core::String::static_("file");
            }
            if namespace_str.eq_ascii(b"file") {
                break 'brk bun_core::String::static_("file");
            }
            if namespace_str.eq_ascii(b"bun") {
                break 'brk bun_core::String::static_("bun");
            }
            if namespace_str.eq_ascii(b"node") {
                break 'brk bun_core::String::static_("node");
            }
            break 'brk namespace_str;
        }
        break 'brk bun_core::String::static_("file");
    };

    // A `file`-namespace result (the default) is a filesystem path, not a new
    // specifier: hand it back unprefixed. Other namespaces keep the `ns:path`
    // form the module loader dispatches on.
    if user_namespace.eq_ascii(b"file") {
        return Ok(Some(Ok(file_path)));
    }

    Ok(Some(Ok(bun_core::String::create_format(format_args!(
        "{}:{}",
        user_namespace, file_path
    )))))
}
