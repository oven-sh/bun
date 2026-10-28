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

pub(crate) type OnUnhandledRejection = fn(&VirtualMachine, &JSGlobalObject, JSValue);
pub(crate) type MacroMap = bun_collections::ArrayHashMapCell<i32, JSValue>;
pub type ExceptionList = Vec<crate::exception_list::JsException>;

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine struct (file-level @This())
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct EntryPointResult {
    pub value: crate::strong::Optional, // jsc.Strong.Optional
    pub cjs_set_value: Cell<bool>,
    /// True when the entry module evaluated as CommonJS: Node reports a CJS
    /// entry's top-level throw with origin `uncaughtException` but an ESM
    /// entry rejection with `unhandledRejection`; the run command consults this.
    pub evaluated_as_cjs: Cell<bool>,
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
    /// Overrides `env_loader`. The VM owns it and frees it with its runtime state.
    pub owned_env_loader: Option<Box<bun_dotenv::Loader>>,
    pub graph: Option<&'static dyn bun_resolver::StandaloneModuleGraph>,
    /// `--install=...`; the resolver needs it before `configure_linker()` caches package.json.
    pub global_cache: bun_options_types::global_cache::GlobalCache,
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
    /// The program's arguments: what follows the entry point on the command line.
    pub argv: Vec<Box<[u8]>>,
    /// `--preload`.
    pub preload: Vec<Box<[u8]>>,
}

impl Default for InitOptions {
    fn default() -> Self {
        Self {
            transform_options: Default::default(),
            debugger: Default::default(),
            log: None,
            env_loader: None,
            owned_env_loader: None,
            graph: None,
            global_cache: bun_options_types::global_cache::GlobalCache::disable,
            smol: false,
            eval_mode: false,
            is_main_thread: false,
            worker_ptr: core::ptr::null_mut(),
            context_id: None,
            mini_mode: false,
            argv: Vec::new(),
            preload: Vec::new(),
        }
    }
}

/// Start-up configuration of a new VM's transpiler (see [`VirtualMachine::init`]).
pub type ConfigureTranspiler<'a> = &'a mut dyn FnMut(&mut Transpiler<'static>);

/// What the VM runs as the program.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MainEntryPoint {
    /// The user's file, through the `bun:main` wrapper.
    File,
    Compiled,
    /// `bun ./index.html`: `src/js/internal/html.ts` serves the pages.
    Html,
    /// `bun bake`: `src/js/internal/bake.ts` serves the app in the working directory. There is no
    /// entry module, so `main` is `None`.
    Bake,
}

/// The built-in module that `Bun__loadBuiltinEntryPoint` runs. Mirrors
/// `Bun::BuiltinEntryPoint` in `BuiltinEntryPoint.cpp`.
#[repr(u8)]
#[derive(Clone, Copy)]
pub enum BuiltinEntryPoint {
    Html = 0,
    Bake = 1,
}

pub struct VirtualMachine {
    pub global: Cell<Option<&'static JSGlobalObject>>,
    // allocator dropped per §Allocators (global mimalloc)
    // LIFETIME-ERASED: `Transpiler<'a>` borrows `log`/`allocator`; VM is
    // self-referential and cannot carry `<'a>`, so we erase to `'static` and the
    // owner guarantees the borrowed `log` outlives the VM (see `init`).
    /// Only [`init`](Self::init)'s `configure` gets it as `&mut`.
    transpiler: Transpiler<'static>,
    /// Hot-reload import watcher (heap `Box`, installed by
    /// `HotReloader::enable_hot_module_reloading`); null when
    /// hot reload is disabled. Read via [`Self::bun_watcher_ptr`], set via
    /// [`Self::set_bun_watcher`].
    bun_watcher: Cell<*mut crate::hot_reloader::ImportWatcher>,
    pub(crate) console: Cell<*mut crate::console_object::ConsoleObject>,
    pub log: Cell<Option<NonNull<bun_ast::Log>>>,
    /// Path of the entry module: the user's module that runs first. `None` when there is none, as
    /// for `bun bake`, where the program is a built-in module (`main_entry_point`).
    /// A worker's outlives the VM and no more, so [`main`](Self::main) lends it for `&self`.
    main: Cell<Option<&'static [u8]>>,
    pub main_entry_point: Cell<MainEntryPoint>,
    did_look_for_server: Cell<bool>,
    /// `main` with symlinks resolved, for `Bun.main`. Empty until it is asked for.
    main_resolved_path: Cell<bun_core::String>,
    pub main_hash: Cell<u32>,
    /// Set if code overrides Bun.main to a custom value.
    pub overridden_main: crate::strong::Optional,
    /// `bun bake`: the plugins of `bake.config.ts`, a JS array. The dev server loads them after the
    /// `[serve.static] plugins` of bunfig.toml.
    pub bake_config_plugins: crate::strong::Optional,
    /// One of `bake_config_plugins` has `tailwind` in its name.
    pub bake_config_has_tailwind_plugin: Cell<bool>,
    /// `bun bake`: the next `Bun.serve()` (its own) adds the routers of a framework: the one in
    /// `bake_framework`, or the default React framework. That call clears it.
    pub bake_pages: Cell<bool>,
    /// `bun bake`: the `framework` object of a plugin in `bake.config.ts`, as for the `app` option of
    /// `Bun.serve()`. Empty for the default React framework.
    pub bake_framework: crate::strong::Optional,
    pub(crate) entry_point: bun_bundler::entry_points::ServerEntryPoint,
    pub origin: bun_url::URL<'static>,
    // LAYERING: real type is `Option<Box<bun_runtime::node::fs::NodeFS>>`, but
    // `bun_runtime` is a forward dep of this crate; stored type-erased and
    // cast back by the `bun_runtime` consumers.
    pub node_fs: Cell<Option<*mut c_void>>,
    /// Opaque per-VM `bun_runtime` state (boxed `timer::All` +
    /// `Body::Value::HiveAllocator` + …). Read with [`Self::runtime_state`].
    ///
    /// Private, because `bun_runtime` dereferences it unchecked. [`init`](Self::init) stores what
    /// `RuntimeHooks::init_runtime_state` returned before it runs anything else of `bun_runtime`
    /// or hands out the VM, and only [`destroy`](Self::destroy) clears it, to hand it to
    /// `RuntimeHooks::deinit_runtime_state`.
    ///
    /// Atomic because an addon's threads read it (`uv_default_loop` and friends).
    runtime_state: core::sync::atomic::AtomicPtr<c_void>,
    /// Private, because [`uws_loop`](Self::uws_loop) does not check it. `ensure_waker` sets it
    /// under `init`, and only `teardown` clears it.
    event_loop_handle: Cell<Option<&'static PlatformEventLoop>>,
    /// Pending `unref` count drained by the event-loop thread. Atomic because
    /// `KeepAlive::unref_on_next_tick` increments it from OTHER threads
    /// (POSIX only; on Windows that path calls `loop_dec()` instead and the
    /// counter stays at zero).
    pub pending_unref_counter: core::sync::atomic::AtomicI32,
    pub preload: bun_collections::VecCell<Box<[u8]>>,
    /// See [`Self::replace_unhandled_pending_rejection_to_capture`].
    unhandled_pending_rejection_to_capture: Cell<Option<*mut JSValue>>,
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
    pub html_rewriter_active_sink: Cell<Option<core::ptr::NonNull<c_void>>>,
    // Note: layering — the concrete `bun_standalone_graph::Graph` lives
    // in a higher-tier crate. The resolver already broke that cycle with the
    // `bun_resolver::StandaloneModuleGraph` trait; we hold the same trait
    // object here so `init_with_module_graph` can hand it straight to
    // `transpiler.resolver.standalone_module_graph` without a downcast.
    pub standalone_module_graph: Option<&'static dyn bun_resolver::StandaloneModuleGraph>,
    pub finds_entry_points_by_path: bool,
    pub smol: bool,
    // LAYERING: real type is `bun_runtime::dns_jsc::Order` (forward
    // dep); stored as its `u8` repr.
    pub dns_result_order: Cell<u8>,
    pub cpu_profiler_config: Cell<Option<crate::bun_cpu_profiler::CPUProfilerConfig>>,
    pub heap_profiler_config: Cell<Option<crate::bun_heap_profiler::HeapProfilerConfig>>,
    /// Set by `BUN_JSC_samplingProfilerPath` or `bun:jsc`'s `startSamplingProfiler()`.
    pub sampling_profiler_directory: Cell<Option<Box<[u8]>>>,
    pub counters: Counters,

    /// `--hot` / `--watch` mode this VM runs under.
    pub hot_reload: Cell<HotReload>,
    pub jsc_vm: Cell<Option<&'static VM>>,

    /// hide bun:wrap from stack traces
    pub(crate) hide_bun_stackframes: Cell<bool>,

    pub is_shutting_down: Cell<bool>,
    /// Set once `on_exit()` is past `RareData::cleanup_hooks`, run or not
    /// (`exit_tears_down_napi_envs`). The list is never walked again, so a hook
    /// pushed after this (a finalizer deferred from the final collection) would only leak.
    pub(crate) has_run_cleanup_hooks: Cell<bool>,
    pub is_main_thread: Cell<bool>,
    pub exit_handler: ExitHandler,

    pub(crate) default_tls_reject_unauthorized: Cell<Option<bool>>,
    // LAYERING: real type is `Option<http::HTTPVerboseLevel>` (forward dep);
    // stored as the enum's `u8` repr.
    pub(crate) default_verbose_fetch: core::cell::Cell<Option<u8>>,

    pub source_mappings: SavedSourceMap,

    pub has_loaded: Cell<bool>,
    /// The current entry load reached module evaluation: the root's graph is
    /// linked and executing (set from the moduleLoaderEvaluate hook once the
    /// root record — `Bun__VM__entryRootKey` — is Evaluating; a module some
    /// other root evaluates meanwhile, e.g. a preload's un-awaited import(),
    /// does not count). What is still pending on the entry promise after that
    /// is a top-level await.
    pub entry_evaluation_started: Cell<bool>,

    pub(crate) had_errors: Cell<bool>,

    pub macros: MacroMap,
    // LAYERING: values are `MacroEntryPoint` from `bun_bundler::entry_points`
    // (forward dep); stored type-erased and cast back by the consumers.
    pub macro_entry_points: bun_collections::ArrayHashMapCell<i32, *mut c_void>,
    /// While set, `macro_event_loop` is the current loop. What `event_loop` says, for the signal
    /// handler: on whichever thread it runs, it asks which loop to wake.
    ///
    /// `Relaxed` throughout: it publishes nothing. Both loops' `Shared` are valid for as long as
    /// the VM is, so a signal that races a switch wakes one of them.
    macro_mode: core::sync::atomic::AtomicBool,
    /// Depth of live [`MacroModeGuard`]s on this thread. Nonzero exactly while
    /// macro JS may be executing — both `MacroContext::call` and `Macro::init`
    /// (whose `load_macro_entry_point` runs the macro module's top-level via
    /// `wait_for_promise`) hold a guard. `enable_/disable_macro_mode` are gated
    /// on the 0↔1 transition so the guard is reentrant; this is the signal
    /// [`drop_source_code_printer_if_macro_owned`] uses.
    pub(crate) macro_guard_depth: Cell<u32>,
    pub auto_killer: ProcessAutoKiller::ProcessAutoKiller,

    pub has_any_macro_remappings: Cell<bool>,
    pub(crate) is_from_devserver: bool,
    pub(crate) has_enabled_macro_mode: Cell<bool>,

    /// Used by bun:test to set global hooks for beforeAll, beforeEach, etc.
    pub is_in_preload: Cell<bool>,
    /// True if `load_preloads` kept the preload list for a reload that was deferred while it ran.
    pub preloads_kept_for_reload: Cell<bool>,
    pub has_patched_run_main: Cell<bool>,

    pub transpiler_store: crate::runtime_transpiler_store::RuntimeTranspilerStore,

    pub(crate) after_event_loop_callback_ctx: Cell<Option<*mut c_void>>,
    pub(crate) after_event_loop_callback: Cell<Option<OpaqueCallback>>,

    pub(crate) remap_stack_frames_mutex: bun_threading::Mutex,

    pub argv: Vec<Box<[u8]>>,

    pub origin_timer: std::time::Instant,
    pub(crate) origin_timestamp: u64,
    /// For fake timers: override performance.now() with a specific value (in nanoseconds).
    pub overridden_performance_now: Cell<Option<u64>>,
    /// For fake timers: the wall-clock time (ms since the Unix epoch) that the
    /// overridden `performance.now() == 0` corresponds to, so that
    /// `performance.timeOrigin + performance.now()` tracks the fake `Date.now()`.
    pub overridden_time_origin: Cell<Option<f64>>,
    pub(crate) macro_event_loop: EventLoop,
    pub regular_event_loop: EventLoop,
    /// The current loop. Private: `init` and `enable_`/`disable_macro_mode` alone write it, with
    /// the address of one of the two fields above.
    event_loop: Cell<NonNull<EventLoop>>,

    pub(crate) ref_strings: crate::ref_string::Map,

    pub(crate) active_tasks: Cell<usize>,

    pub rare_data: core::cell::OnceCell<Box<RareData>>,
    pub proxy_env_storage: crate::rare_data::ProxyEnvStorage,
    pending_internal_promise: crate::strong::Optional,
    pub pending_internal_promise_reported_at: Cell<u32>,
    pub hot_reload_deferred: Cell<bool>,
    pub entry_point_result: EntryPointResult,

    pub on_unhandled_rejection: Cell<OnUnhandledRejection>,
    pub on_unhandled_rejection_ctx: Cell<Option<*mut c_void>>,
    /// See [`Self::replace_unhandled_rejection_exception_list`].
    on_unhandled_rejection_exception_list: Cell<Option<NonNull<ExceptionList>>>,
    pub unhandled_error_counter: Cell<usize>,
    /// When set, `print_error_instance_body` calls this with the remapped
    /// `ZigException` (same lifecycle as the GitHub Actions annotation hook),
    /// so observers can read name/message/stack without re-running the
    /// formatter. Installed by `bun test --reporter=junit` around
    /// `run_error_handler`.
    pub on_print_error_zig_exception: Cell<Option<fn(*mut c_void, &ZigException<'_>)>>,
    pub on_print_error_zig_exception_ctx: Cell<*mut c_void>,
    pub(crate) is_handling_uncaught_exception: Cell<bool>,
    pub(crate) exit_on_uncaught_exception: Cell<bool>,
    /// An earlier `--hot` run ended with an unhandled error. Its `beforeExit` listeners are still registered.
    hot_run_failed: Cell<bool>,
    /// The watcher's loop turned after an unhandled error, so that error did not stop the timers.
    pub timers_ran_after_error: Cell<bool>,

    pub modules: crate::async_module::Queue,
    pub aggressive_garbage_collection: Cell<GCLevel>,

    pub module_loader: ModuleLoader::ModuleLoader,

    pub(crate) gc_controller: crate::GarbageCollectionController,
    /// The `WebWorker` whose thread this VM runs on (`None` on the main thread).
    /// The thread holds a ref on it for its whole life. Only `init_worker` sets it.
    worker: Cell<Option<*const c_void>>,
    /// Workers created on this thread and not yet released by it. Parent-thread
    /// only: `WebWorker::create` pushes, `release_parent_poll_ref` removes,
    /// `join_child_workers` drains at exit.
    pub(crate) child_workers: bun_collections::VecCell<*mut crate::web_worker::WebWorker>,
    /// This VM's live pool jobs (`bun_jsc::job`); JS thread only, zero-valid.
    pub(crate) jobs: crate::JsCell<crate::job::JobList>,
    /// The door out of this thread (`bun_jsc::vm_handle`): tickets for work
    /// that leaves it are taken here, and `teardown` waits on it.
    handle: core::mem::ManuallyDrop<crate::VmHandle>,
    pub pending_ipc: Cell<Option<PendingIpc>>,
    pub hot_reload_counter: Cell<u32>,

    pub debugger: core::cell::OnceCell<Box<crate::debugger::Debugger>>,
    pub(crate) has_started_debugger: Cell<bool>,

    pub is_inside_deferred_task_queue: Cell<bool>,
    /// When true, drainMicrotasksWithGlobal is suppressed.
    pub(crate) suppress_microtask_drain: Cell<bool>,

    pub channel_ref: Async::KeepAlive,
    pub channel_ref_overridden: Cell<bool>,
    pub channel_ref_should_ignore_one_disconnect_event_listener: Cell<bool>,

    /// A set of extensions that exist in the require.extensions map.
    pub commonjs_custom_extensions: crate::node_module_module::CustomExtensions,
    pub has_mutated_built_in_extensions: Cell<u32>,

    pub initial_script_execution_context_identifier: Cell<i32>,

    /// Owns what script running in this VM's global opens. `bun test --isolate`
    /// stops it at every file swap.
    pub(crate) root_context: crate::ScriptExecutionContext,
    /// What native code continues on behalf of a context that is gone runs in: always stopped,
    /// so what it arms is closed at once.
    pub(crate) dead_context: crate::ScriptExecutionContext,
    /// The contexts made for `Bun.ModuleGraph`s, by id, stopped or not. Empty:
    /// every context question has the root context for an answer.
    pub(crate) graph_contexts:
        bun_collections::ArrayHashMapCell<u32, NonNull<crate::ScriptExecutionContext>>,
    /// The context native code has entered ([`enter_context`](Self::enter_context)) and not yet
    /// left: whose script the native code that is running continues. `None` when nothing is
    /// entered, which is how script mostly runs. The dead context's, for one entered as gone (its
    /// graph has been collected; its context may not have been stopped yet: that is queued from
    /// the finalizer). Not the current context: that is what the async context says.
    pub(crate) entered_context: Cell<Option<crate::ContextId>>,
    pub test_isolation_enabled: Cell<bool>,
    /// Counts `bun test --isolate` file swaps. The realm's context keeps its identifier across
    /// them, so a timer or pool job of the realm's remembers the count it was made under: one
    /// made under an earlier count is the finished file's, and is dropped.
    pub test_isolation_generation: Cell<u32>,
    pub test_isolation_state: TestIsolationState,
}

#[derive(Default)]
pub struct TestIsolationState {
    pub saved_cwd: Cell<Option<Box<[u8]>>>,
    /// The time zone the test runner applied at startup (`TZ`, default
    /// `Etc/UTC`). Empty means no override (local time). Re-applied after
    /// every file so a `process.env.TZ` write stays with the file that made it.
    pub time_zone: core::cell::OnceCell<Box<[u8]>>,
    /// The proxy env keys as the env map held them at startup, restored after
    /// every file. See [`crate::rare_data::ProxyEnvSnapshot`].
    pub proxy_env: core::cell::OnceCell<crate::rare_data::ProxyEnvSnapshot>,
    /// The synthetic allocation limit at startup, restored after every file.
    /// `setSyntheticAllocationLimitForTesting` lowers it process-wide.
    pub synthetic_allocation_limit: Cell<Option<usize>>,
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
    /// ModuleGraph.cpp: the context of the innermost `Bun.ModuleGraph` the
    /// current async context is inside of, or null.
    // Round-tripped opaquely through C++ (from `Bun__ScriptExecutionContext__create`).
    #[allow(improper_ctypes)]
    safe fn Bun__currentGraphContext(
        global: &JSGlobalObject,
    ) -> *const crate::ScriptExecutionContext;
    /// The identifier of the global's `WebCore::ScriptExecutionContext`.
    safe fn Zig__GlobalObject__contextIdentifier(global: &JSGlobalObject) -> u32;
    /// ModuleGraph.cpp: make the graph of this `WebCore::ScriptExecutionContext` current;
    /// returns the async context to restore.
    /// (Empty: there was nothing to do.)
    fn Bun__ModuleGraph__enterContext(
        dom_context: *mut c_void,
        gone: &mut bool,
        entered: &mut *const JSGlobalObject,
    ) -> JSValue;
    safe fn Bun__ModuleGraph__enterRootContext(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__ModuleGraph__leaveContext(global: &JSGlobalObject, previous: JSValue);
    /// ModuleGraph.cpp: deliver an uncaught exception to the `onError` of the `Bun.ModuleGraph` in
    /// whose context it was thrown (the `Exception` carries it; a bare value: the context that is
    /// current), or an unhandled rejection whose owner promiseRejectionTracker decided. true:
    /// delivered (no test failure, exit code or `--unhandled-rejections` policy); false: not a
    /// graph's, continue with the normal thread-wide handling.
    safe fn Bun__ModuleGraph__handleUncaughtException(
        global: &JSGlobalObject,
        exception: JSValue,
    ) -> bool;
    /// The `Bun.ModuleGraph` a promise rejected now is reported to (its context is current and it, or
    /// a graph that made it, has an `onError`), or null.
    safe fn Bun__ModuleGraph__rejecting(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__ModuleGraph__handleUnhandledRejection(
        global: &JSGlobalObject,
        reason: JSValue,
        owner: JSValue,
    ) -> bool;

    safe fn Process__dispatchOnBeforeExit(global: &JSGlobalObject, code: u8);
    safe fn Process__dispatchOnExit(global: &JSGlobalObject, code: u8);
    safe fn Bun__closeAllSQLiteDatabasesForTermination(global: &JSGlobalObject);
    safe fn Bun__closeAllNodeSqliteDatabasesForTermination(global: &JSGlobalObject);
    safe fn Bun__WebView__closeAllForTermination();
    safe fn Zig__GlobalObject__prepareForDestruction(global: &JSGlobalObject);
    safe fn Zig__GlobalObject__forbidExecution(global: &JSGlobalObject);
    safe fn Zig__GlobalObject__stopActiveDOMObjectsForTestIsolation(global: &JSGlobalObject);
    safe fn Zig__GlobalObject__retireForTestIsolation(global: &JSGlobalObject);
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
    entry_offset: *mut u32,
) -> bool {
    let Some(graph) = standalone_module_graph() else {
        return false;
    };
    let Some((found, found_entry_offset)) = graph.builtin_module_bytecode(id) else {
        return false;
    };
    // SAFETY: out-params supplied by the C++ caller; `found` points into the executable's mapped section.
    unsafe {
        *bytes = found.cast::<u8>();
        *size = found.len();
        *entry_offset = found_entry_offset;
    }
    true
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
            let canonical = crate::compiled_program::entry_module_key(canonical);
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

/// The executable's pre-resolved module graph blob and module-info slot table (`JSVMClientData::prelinkedModuleGraph`);
/// false when there is none. Both spans live as long as the process.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__standalonePrelinkedModuleGraph(
    blob: *mut *const u8,
    blob_len: *mut usize,
    slot_table: *mut *const u8,
    slot_table_len: *mut usize,
) -> bool {
    let Some((graph, slots)) =
        standalone_module_graph().map(|graph| graph.prelinked_module_graph())
    else {
        return false;
    };
    if graph.is_empty() || slots.is_empty() {
        return false;
    }
    // SAFETY: the caller's writable out-parameters.
    unsafe {
        *blob = graph.as_ptr();
        *blob_len = graph.len();
        *slot_table = slots.as_ptr();
        *slot_table_len = slots.len();
    }
    true
}

/// The graph module index of an embedded module key, or `u32::MAX` when it is not a module of the pre-resolved graph.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__standalonePrelinkedModuleIndex(name: *const u8, len: usize) -> u32 {
    // SAFETY: `name[..len]` is the caller's live 8-bit string buffer.
    let name = unsafe { bun_core::ffi::slice(name, len) };
    if !bun_options_types::standalone_path::is_bun_standalone_file_path(name) {
        return u32::MAX;
    }
    standalone_module_graph().map_or(u32::MAX, |graph| graph.prelinked_module_index(name))
}

/// The module key (canonical embedded name) of graph module `index`; null if out of range.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__standalonePrelinkedModuleName(
    index: u32,
    out_len: *mut usize,
) -> *const u8 {
    match standalone_module_graph().and_then(|graph| graph.prelinked_module_name(index)) {
        Some(name) => {
            // SAFETY: `out_len` is the caller's writable out-parameter.
            unsafe { *out_len = name.len() };
            name.as_ptr()
        }
        None => core::ptr::null(),
    }
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
    pub fn apply(&self, vm: &VirtualMachine) {
        vm.on_unhandled_rejection.set(self.on_unhandled_rejection);
        vm.on_unhandled_rejection_ctx.set(self.ctx);
        vm.unhandled_error_counter.set(self.count);
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
// highest-fan-in accessor on the per-request path — `VirtualMachine::get()`
// reaches it ≥3× per `run_callback`. Const-init `Cell<ptr>` has no destructor, so no
// `LocalKey` registration is needed. Module-level because Rust forbids
// associated `static`s; the `VMHolder` namespace is preserved via the
// `#[inline(always)]` accessors below.
#[thread_local]
static VM: Cell<Option<*mut VirtualMachine>> = Cell::new(None);
#[thread_local]
static CACHED_GLOBAL_OBJECT: Cell<Option<&'static JSGlobalObject>> = Cell::new(None);

impl VMHolder {
    #[inline(always)]
    fn set_cached_global_object(g: Option<&'static JSGlobalObject>) {
        CACHED_GLOBAL_OBJECT.set(g)
    }

    #[unsafe(no_mangle)]
    extern "C" fn Bun__setDefaultGlobalObject(global: &'static JSGlobalObject) {
        if let Some(vm) = VM.get() {
            // SAFETY: vm pointer set by init() on this thread
            let vm_instance = unsafe { &*vm };
            vm_instance.global.set(Some(global));
            if vm_instance.is_main_thread.get() {
                MAIN_THREAD_VM.store(vm, core::sync::atomic::Ordering::Release);
            }
        }
        CACHED_GLOBAL_OBJECT.set(Some(global));
    }

    #[unsafe(no_mangle)]
    extern "C" fn Bun__getDefaultGlobalObject() -> Option<&'static JSGlobalObject> {
        if let Some(g) = CACHED_GLOBAL_OBJECT.get() {
            return Some(g);
        }
        if let Some(vm) = VirtualMachine::get_or_null() {
            CACHED_GLOBAL_OBJECT.set(vm.global.get());
        }
        None
    }

    #[unsafe(no_mangle)]
    extern "C" fn Bun__thisThreadHasVM() -> bool {
        VM.get().is_some()
    }

    /// Node parity: `process.kill(self, sig)` with no JS handler for `sig`
    /// flushes the profiles before sending the (likely fatal) signal,
    /// mirroring node's `Kill` binding. Idempotent via `Option::take`
    /// (the compile cache is written again at a real exit; a bytecode order
    /// recording is written once and ends there). The recording is the main
    /// thread's to write: a Worker that sends the signal leaves none.
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__writeProfilesBeforeSelfKill(signal_ends_process: bool) {
        let Some(vm) = VirtualMachine::get_or_null() else {
            return;
        };
        vm.write_profiles();
        // Node runs RunAtExit (incl. compile cache) on self-directed fatal signals. Non-latching:
        // the signal may prove non-fatal, and latching here would no-op the real exit's persist.
        // https://github.com/nodejs/node/blob/main/src/env.cc (AtExit(FlushCompileCache))
        crate::node_compile_cache::persist_now();
        // Written once, and writing it ends the recording: only before a signal that is sure to end the process, not
        // one a program sends itself along the way (SIGTSTP on Ctrl-Z, SIGWINCH, one that is being ignored, ...).
        if signal_ends_process && vm.is_main_thread() {
            crate::bytecode_order_recorder::write_at_exit(vm, standalone_module_graph());
        }
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
    pub exit_code: Cell<u8>,
    /// `bun test` sets this at the end of a run unless `node:test` APIs were used: jest and vitest never fire a test file's `process.on('exit')` listeners.
    pub skip_exit_listeners: Cell<bool>,
    /// `process.exit()`, a fatal error or the end of a `bun test` run, as opposed to the event loop running dry.
    /// See `VirtualMachine::exit_tears_down_napi_envs`.
    pub requested: Cell<bool>,
}

impl ExitHandler {
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__getExitCode(vm: &VirtualMachine) -> u8 {
        vm.exit_handler.exit_code.get()
    }

    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__VM__noteEntryEvaluationStarted(vm: &VirtualMachine) {
        vm.entry_evaluation_started.set(true);
    }

    /// Only a worker's start waits on this (`wait_for_worker_entry_evaluation`);
    /// any other VM answers `true` so the hook's registry probe never runs there.
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__VM__entryEvaluationStarted(vm: &VirtualMachine) -> bool {
        vm.entry_evaluation_started.get() || vm.is_main_thread()
    }

    /// The module-registry key of the current entry load's root: the
    /// `bun:main` wrapper when the entry is transpiled through it, else the
    /// entry path itself (see `reload_entry_point`). Borrowed.
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__VM__entryRootKey(
        vm: &VirtualMachine,
    ) -> bun_core::StringView<'_> {
        if !vm.transpiler().options.disable_transpilation
            && vm.main_entry_point.get() == MainEntryPoint::File
        {
            bun_core::StringView::static_(MAIN_FILE_NAME)
        } else {
            // With no entry module there is no root, and no key matches.
            bun_core::StringView::borrow_utf8(vm.main().unwrap_or_default())
        }
    }

    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__VM__shouldLookForServer(vm: &VirtualMachine) -> bool {
        vm.main_entry_point.get() == MainEntryPoint::Compiled
            && !vm.did_look_for_server.get()
            && !vm.transpiler().options.disable_transpilation
    }

    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__VM__didLookForServer(vm: &VirtualMachine) {
        vm.did_look_for_server.set(true);
    }

    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn Bun__setExitCode(vm: &VirtualMachine, code: u8) {
        vm.exit_handler.exit_code.set(code);
    }

    pub(crate) fn dispatch_on_exit(vm: &VirtualMachine) {
        let exit_code = vm.exit_handler.exit_code.get();
        // `process.on('exit')` handlers are user script (see `on_exit`).
        if vm.script_allowed() && !vm.exit_handler.skip_exit_listeners.get() {
            Process__dispatchOnExit(vm.global(), exit_code);
        }
        if vm.is_main_thread() {
            Bun__WebView__closeAllForTermination();
        }
    }

    pub(crate) fn dispatch_on_before_exit(vm: &VirtualMachine) {
        if !vm.script_allowed() {
            return;
        }
        let exit_code = vm.exit_handler.exit_code.get();
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
#[must_use = "macro mode is disabled on drop; bind to a named local"]
pub struct MacroModeGuard<'a> {
    vm: &'a VirtualMachine,
}
impl<'a> MacroModeGuard<'a> {
    #[inline]
    pub fn new(vm: &'a VirtualMachine) -> Self {
        // Reentrant: only the outermost guard flips the VM into macro mode and
        // back; inner guards (e.g. a macro that calls
        // `Bun.Transpiler#transformSync` which itself enters a guard) just bump
        // the depth so their `Drop` doesn't reset `macro_mode`/`event_loop`/
        // `transpiler.target`/`transpiler_store.enabled` underneath the outer.
        vm.macro_guard_depth.set(vm.macro_guard_depth.get() + 1);
        if vm.macro_guard_depth.get() == 1 {
            vm.enable_macro_mode();
        }
        Self { vm }
    }
}
impl Drop for MacroModeGuard<'_> {
    #[inline]
    fn drop(&mut self) {
        let vm = self.vm;
        vm.macro_guard_depth
            .set(vm.macro_guard_depth.get().saturating_sub(1));
        if vm.macro_guard_depth.get() == 0 {
            vm.disable_macro_mode();
        }
    }
}

// `VirtualMachine` is deliberately `!Send + !Sync`: a `&VirtualMachine`, a
// pointer to it or to its loops cannot be
// carried to another thread. Other threads hold a `bun_jsc::Ticket` /
// `VmHandle` and reach the VM only by posting to it.
//
// After `init` there is no `&mut VirtualMachine`: native code that runs JavaScript is re-entered
// through `get()`, so every method takes `&self` and whatever changes is in a cell.
// Fails to compile ("multiple applicable items") if `VirtualMachine` or `EventLoop` is
// `Send` or `Sync`.
const _: () = {
    trait AmbiguousIfImpl<A> {
        fn some_item() {}
    }
    impl<T: ?Sized> AmbiguousIfImpl<()> for T {}
    impl<T: ?Sized + Send> AmbiguousIfImpl<u8> for T {}
    impl<T: ?Sized + Sync> AmbiguousIfImpl<u16> for T {}
    let _ = <VirtualMachine as AmbiguousIfImpl<_>>::some_item;
    let _ = <EventLoop as AmbiguousIfImpl<_>>::some_item;
};

impl VirtualMachine {
    /// The current thread's VM.
    #[inline(always)]
    pub fn get() -> &'static VirtualMachine {
        debug_assert!(
            VM.get().is_some(),
            "VirtualMachine.get() called with no VM on this thread",
        );
        // Reached several times per `run_callback`: unchecked, so that it is one TLS load.
        // SAFETY: every caller is reached from a JS host function or an event-loop tick, which run
        // after `init()` installed this thread's VM. The VM is freed only as its thread ends, after
        // the slot is cleared, and it is `!Sync`, so the reference stays on this thread.
        unsafe { &*VM.get().unwrap_unchecked() }
    }

    #[inline(always)]
    pub fn get_or_null() -> Option<&'static VirtualMachine> {
        // SAFETY: as `get`.
        VM.get().map(|vm| unsafe { &*vm })
    }

    /// What other threads and the signal handler may touch of the main thread's current event
    /// loop. Callable from any thread: the main thread's VM is never freed.
    #[cfg(unix)]
    pub(crate) fn main_thread_loop_shared() -> Option<&'static crate::event_loop::Shared> {
        let vm = MAIN_THREAD_VM.load(core::sync::atomic::Ordering::Acquire);
        if vm.is_null() {
            return None;
        }
        // SAFETY: never freed. The places read are `Sync`; no `&VirtualMachine` or `&EventLoop`
        // is formed on a thread that is not theirs.
        Some(unsafe {
            if (*vm).macro_mode.load(core::sync::atomic::Ordering::Relaxed) {
                &(*vm).macro_event_loop.shared
            } else {
                &(*vm).regular_event_loop.shared
            }
        })
    }

    #[inline]
    pub fn is_loaded() -> bool {
        VM.get().is_some()
    }

    #[inline(always)]
    pub fn global(&self) -> &'static JSGlobalObject {
        self.global
            .get()
            .expect("VirtualMachine.global is set in init()")
    }

    #[inline(always)]
    pub fn macro_mode(&self) -> bool {
        self.macro_mode.load(core::sync::atomic::Ordering::Relaxed)
    }

    /// The current loop: the regular one, except while a macro runs.
    #[inline(always)]
    pub fn event_loop(&self) -> &EventLoop {
        // SAFETY: a field of `*self` (see `event_loop`). A VM is made in place and only ever lent,
        // so it does not move.
        unsafe { self.event_loop.get().as_ref() }
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

    /// The context of the script that is calling: script is running, so its async context says
    /// whose it is. For a host function, a function exported to C++ that a C++ host function calls,
    /// a custom getter or setter, a Node-API function (an addon calls those from a callback script
    /// called, or from one of its own completions, which entered the context it was scheduled in).
    /// Helpers below take the context as a parameter; native code the event loop calls uses the
    /// [`ContextScope`] it entered ([`ContextScope::context`]).
    #[inline]
    pub fn context_of_caller(&self) -> &crate::ScriptExecutionContext {
        self.current_context()
    }

    /// `context` when it is a `Bun.ModuleGraph`'s (stopped or not), for an owner that only a graph's
    /// context stops.
    #[inline]
    pub fn as_graph_context<'a>(
        &self,
        context: &'a crate::ScriptExecutionContext,
    ) -> Option<&'a crate::ScriptExecutionContext> {
        (context.id() != self.root_context.id()).then_some(context)
    }

    /// The context of the realm's own script: what belongs to the realm rather
    /// than to whichever `Bun.ModuleGraph` first needed it.
    #[inline]
    pub fn root_context(&self) -> &crate::ScriptExecutionContext {
        &self.root_context
    }

    /// What the running script's async context, or the [`ContextScope`] native code entered, says.
    /// With no script on the stack and no context entered it is nobody's in particular, so the
    /// realm's. The VM's own: everything else is handed a context (`context_of_caller`,
    /// [`ContextScope::context`]).
    fn current_context(&self) -> &crate::ScriptExecutionContext {
        if self.entered_context.get() == Some(self.dead_context.id()) {
            return &self.dead_context;
        }
        if self.graph_contexts.count() == 0 {
            return &self.root_context;
        }
        // SAFETY: a graph's context outlives every async context frame that names it, and the
        // realm's own is `root_context` (every global's context is made with it).
        unsafe { &*Bun__currentGraphContext(self.global()) }
    }

    /// The native code that is running continues the script of a `Bun.ModuleGraph` that was
    /// disposed (or is gone): a completion that entered its context, a handler run while that
    /// context is being stopped, what the graph's leftover microtasks call. Whatever it would
    /// report — a promise settled, an error — goes to nobody; its cleanup runs as always.
    pub fn reports_to_nobody(&self) -> bool {
        // (Asked from every native settle: from the event loop with no context entered the async
        // context names no graph, and the answer is no.)
        let context = self.current_context();
        context.id() != self.root_context.id() && context.is_stopped()
    }

    /// As [`reports_to_nobody`](Self::reports_to_nobody), for a call into script: the native
    /// code that is running entered the context of a `Bun.ModuleGraph` that was disposed (or is
    /// gone) — a completion, a handler run while the context is being stopped. `JSValue::call`
    /// makes such a call a no-op, as the same boundary does for a VM that forbids script. Not
    /// what a disposed graph's leftover script calls synchronously (a comparator, a handler of a
    /// synchronous transform): that is still its script running, which no scope entered.
    pub fn calls_nobody(&self) -> bool {
        self.entered_context
            .get()
            .is_some_and(|context| !self.is_context_live(context))
    }

    /// The context that tracks the timers set under `id`: a graph's, or the one standing in for
    /// graphs that are gone.
    pub fn timer_context(&self, id: crate::ContextId) -> Option<&crate::ScriptExecutionContext> {
        if id == self.dead_context.id() {
            return Some(&self.dead_context);
        }
        self.graph_context(id)
    }

    /// The context `id` names: the realm's, a `Bun.ModuleGraph`'s, or the dead one once that graph's is freed.
    pub fn context_of(&self, id: crate::ContextId) -> &crate::ScriptExecutionContext {
        if id == self.root_context.id() {
            return &self.root_context;
        }
        self.graph_context(id).unwrap_or(&self.dead_context)
    }

    /// The `Bun.ModuleGraph` context `id` names, until it is freed
    /// ([`release_graph_context`](Self::release_graph_context)).
    pub fn graph_context(&self, id: crate::ContextId) -> Option<&crate::ScriptExecutionContext> {
        if self.graph_contexts.count() == 0 || id == self.root_context.id() {
            return None;
        }
        // SAFETY: registered ⇒ not freed. Whoever frees it promises that no reference is in use.
        self.graph_contexts
            .get(id.raw())
            .map(|context| unsafe { context.as_ref() })
    }

    /// Whether a timer or pool job made for `context` under `generation` (the
    /// [`test_isolation_generation`](Self::test_isolation_generation) of then) has outlived the
    /// script it would continue: its context has stopped, or `bun test --isolate` has moved on to
    /// another file since.
    #[inline]
    pub fn has_outlived_its_script(&self, context: crate::ContextId, generation: u32) -> bool {
        generation != self.test_isolation_generation.get() || !self.is_context_live(context)
    }

    /// Whether the context `id` names has not stopped.
    #[inline]
    pub fn is_context_live(&self, id: crate::ContextId) -> bool {
        id == self.root_context.id()
            || self
                .graph_context(id)
                .is_some_and(|context| !context.is_stopped())
    }

    /// Native code reached from the event loop is about to continue what `context`'s script
    /// started (run a completion, start the next step): while the guard lives
    /// [`ContextScope::context`] is that context, and the script it calls belongs to it.
    ///
    /// A stopped context can still be entered, and one that is
    /// gone (freed, its graph collected, a realm `bun test --isolate` retired) is entered as a
    /// context that is always stopped: what is armed inside is closed at once, as for
    /// anything a disposed graph opens.
    pub fn enter_context(&self, context: crate::ContextId) -> ContextScope<'_> {
        let mut scope = ContextScope {
            vm: self,
            context,
            previous: JSValue::ZERO,
            entered: self
                .global
                .get()
                .map_or(core::ptr::null(), core::ptr::from_ref),
            previous_entered: self.entered_context.replace(Some(context)),
        };
        if context == self.root_context.id() {
            if self.graph_contexts.count() != 0 && self.script_allowed() {
                scope.previous = Bun__ModuleGraph__enterRootContext(self.global());
            }
            return scope;
        }
        let entered = self.graph_contexts.get(context.raw()).and_then(|context| {
            // SAFETY: registered ⇒ not freed.
            let context = unsafe { context.as_ref() };
            let dom_context = context.dom_context();
            if dom_context.is_null() || !self.script_allowed() {
                return None;
            }
            let mut gone = false;
            let mut realm: *const JSGlobalObject = self.global();
            // SAFETY: non-null ⇒ the `WebCore::ScriptExecutionContext` is alive.
            let previous =
                unsafe { Bun__ModuleGraph__enterContext(dom_context, &mut gone, &mut realm) };
            (!gone).then_some((previous, realm))
        });
        match entered {
            Some((previous, realm)) => {
                scope.previous = previous;
                scope.entered = realm;
            }
            None => {
                scope.context = self.dead_context.id();
                self.entered_context.set(Some(scope.context));
                if self.graph_contexts.count() != 0 && self.script_allowed() {
                    scope.previous = Bun__ModuleGraph__enterRootContext(self.global());
                }
            }
        }
        scope
    }

    /// Whether the running script may name by number (a timer id) something `owner`'s script
    /// made: the host may name anything; a graph's script its own and the host's (whose
    /// `globalThis` it shares anyway), never another graph's.
    pub fn context_may_name(
        &self,
        context: &crate::ScriptExecutionContext,
        owner: crate::ContextId,
    ) -> bool {
        match self.as_graph_context(context) {
            None => true,
            Some(current) => owner == current.id() || owner == self.root_context.id(),
        }
    }

    /// The groups a client socket opened by `context`'s script joins.
    pub fn client_socket_groups_in<'a>(
        &'a self,
        context: &'a crate::ScriptExecutionContext,
    ) -> &'a crate::rare_data::SocketGroups {
        let id = context.id();
        if id == self.root_context.id() {
            return &self.rare_data().socket_groups;
        }
        // Script of a stopped context (the dead one is stopped from the start) is still opening
        // things: what joins is closed on the next turn of the loop.
        if context.is_stopped() {
            self.stop_graph_context_again(id);
        }
        context.socket_groups()
    }

    /// Script of a disposed graph is still opening things in the graph's
    /// stopped context `id`: they go on the next turn of the loop, before the
    /// context can be freed.
    pub(crate) fn stop_graph_context_again(&self, id: crate::ContextId) {
        if id == self.dead_context.id() {
            if !self.dead_context.stop_again_is_queued() {
                self.enqueue_task(bun_event_loop::Task::init(core::ptr::null_mut::<
                    DeadContextStopAgain,
                >()));
            }
            return;
        }
        if self
            .graph_context(id)
            .is_some_and(|context| !context.stop_again_is_queued())
        {
            self.enqueue_task(bun_event_loop::Task::init(
                id.raw() as usize as *mut GraphContextStopAgain
            ));
        }
    }

    /// One stop-phase sweep over the armed handles of this VM's contexts.
    /// Every `Bun.ModuleGraph` context of the realm goes with it.
    pub fn stop_context_handles(&self, reason: crate::StopReason) -> SweepResult {
        let mut result = self.root_context.stop_handles(reason);
        result = result.and(self.dead_context.stop_handles(reason));
        // By index: an owner's callback may create or free a context.
        let mut i = 0;
        while let Some(context) = self.graph_contexts.value_at(i) {
            // SAFETY: registered ⇒ not freed.
            result = result.and(unsafe { self.stop_graph_context(context, reason) });
            // SAFETY: as above.
            unsafe { context.as_ref() }.stop_dom_objects();
            i += 1;
        }
        result
    }

    /// `WebCore::ScriptExecutionContext` for a `Bun.ModuleGraph`: the
    /// context that owns what the graph's script opens.
    pub fn create_graph_context(
        &self,
        dom_context: *mut c_void,
        id: crate::ContextId,
    ) -> NonNull<crate::ScriptExecutionContext> {
        let context = NonNull::from(Box::leak(Box::new(
            crate::ScriptExecutionContext::for_graph(id, dom_context),
        )));
        bun_core::handle_oom(self.graph_contexts.put(id.raw(), context));
        context
    }

    /// Everything the graph's script opened goes (the graph was disposed, or
    /// its realm or VM is going). From here its timers, jobs and late
    /// completions are stale. One stop-phase sweep: may be repeated.
    ///
    /// # Safety
    /// `context` came from [`create_graph_context`](Self::create_graph_context)
    /// on this VM and was not freed; JS thread.
    pub unsafe fn stop_graph_context(
        &self,
        context: NonNull<crate::ScriptExecutionContext>,
        reason: crate::StopReason,
    ) -> SweepResult {
        // SAFETY: fn contract.
        let context = unsafe { context.as_ref() };
        let result = {
            // What stopping it makes its owners do (a connecting socket fails, a client drops
            // its queue) is done in its context: reported to nobody.
            let _context = self.enter_context(context.id());
            context.stop(reason)
        };
        self.jobs.get().cancel_of_context(context.id());
        if let Some(hooks) = runtime_hooks() {
            (hooks.cancel_timers)(self, Some(context.id()));
        }
        result
    }

    /// The `WebCore::ScriptExecutionContext` that owned `context` is gone
    /// (possibly from a GC finalizer, where nothing may be closed): free it,
    /// after stopping what it still owns from the event loop.
    ///
    /// # Safety
    /// As [`stop_graph_context`](Self::stop_graph_context); the caller does
    /// not use `context` again. As [`free_graph_context`](Self::free_graph_context), now and when
    /// the task it queues runs.
    pub unsafe fn release_graph_context(&self, context: NonNull<crate::ScriptExecutionContext>) {
        // SAFETY: fn contract.
        unsafe { context.as_ref() }.dom_context_released();
        // SAFETY: fn contract.
        if unsafe { context.as_ref() }.owns_nothing() {
            // SAFETY: fn contract.
            unsafe { self.free_graph_context(context) };
            return;
        }
        self.enqueue_task(bun_event_loop::Task::init(
            context.as_ptr().cast::<GraphContextStopAndFree>(),
        ));
    }

    /// # Safety
    /// `context` is registered and owns nothing. No reference to it (`graph_context`,
    /// `context_of`, `timer_context`, `context_of_caller`, `ContextScope::context`) is used again.
    unsafe fn free_graph_context(&self, context: NonNull<crate::ScriptExecutionContext>) {
        // SAFETY: fn contract.
        unsafe {
            self.graph_contexts.swap_remove(context.as_ref().id().raw());
            drop(Box::from_raw(context.as_ptr()));
        }
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

    /// Which embedded loop is current (the regular loop, except while a macro runs).
    /// Off-thread completions carry this so they land on the loop that was current when their
    /// work started.
    #[inline]
    pub fn current_loop_kind(&self) -> crate::LoopKind {
        if self.macro_mode() {
            crate::LoopKind::Macro
        } else {
            crate::LoopKind::Regular
        }
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
            fn Bun__DecoderStringTable__install(vm: &VM, bytes: *const u8, len: usize);
        }
        let table = graph.bytecode_string_table();
        if table.is_empty() {
            return;
        }
        // SAFETY: `table` is a mmapped process-lifetime span from the executable's own section.
        unsafe { Bun__DecoderStringTable__install(self.jsc_vm(), table.as_ptr(), table.len()) };
    }

    /// Safe `&VM` accessor for the JSC VM owned by this Bun VM. Set once in
    /// `init()` and live for the VM lifetime.
    #[inline(always)]
    pub fn jsc_vm(&self) -> &VM {
        self.jsc_vm
            .get()
            .expect("VirtualMachine.jsc_vm is set in init()")
    }

    /// Raw accessor for the hot-reload import watcher. `bun_watcher` is the
    /// `*mut ImportWatcher` installed by
    /// `HotReloader::enable_hot_module_reloading` (separate
    /// `Box` heap allocation), or null when hot reload is disabled.
    ///
    /// NOTE: the pointee is **not** JS-thread-only —
    /// the inner `Box<Watcher>` is held as `&mut Watcher` for the lifetime of
    /// the spawned file-watcher thread (`Watcher::thread_main`), and
    /// `RuntimeTranspilerStore` reads it from transpiler workers. The pointee
    /// guards itself with an internal mutex, so we
    /// return the raw pointer and leave the `unsafe` deref at the call site to
    /// keep the cross-thread hazard visible. Callers must scope any reborrow to
    /// a single mutex-guarded `Watcher` operation.
    #[inline]
    pub fn bun_watcher_ptr(&self) -> *mut crate::hot_reloader::ImportWatcher {
        self.bun_watcher.get()
    }

    /// # Safety
    /// `watcher` came from `heap::into_raw`, and the VM now owns it.
    pub(crate) unsafe fn set_bun_watcher(&self, watcher: *mut crate::hot_reloader::ImportWatcher) {
        self.bun_watcher.set(watcher);
    }

    /// Shuts down the file watcher: waits for the change it is handling to finish and prevents new
    /// ones.
    ///
    /// # Safety
    /// The pool threads that were handed [`bun_watcher_ptr`](Self::bun_watcher_ptr) are done with
    /// it, and nothing on this thread borrows the `ImportWatcher`.
    unsafe fn stop_import_watcher(&self) {
        use crate::hot_reloader::ImportWatcher;
        if self.bun_watcher.get().is_null() {
            return;
        }
        // SAFETY: `set_bun_watcher`'s contract, and this function's.
        let watcher = unsafe { &mut *self.bun_watcher.get() };
        if let ImportWatcher::Hot(w) | ImportWatcher::Watch(w) = watcher {
            // SAFETY: the box is the one `Watcher::init` returned.
            unsafe { bun_watcher::Watcher::shutdown(&raw mut **w, false) };
        }
        self.transpiler().resolver.watcher.set(None);
        let watcher = self.bun_watcher.replace(core::ptr::null_mut());
        // SAFETY: as above.
        let watcher = unsafe { bun_core::heap::take(watcher) };
        if let ImportWatcher::Hot(w) | ImportWatcher::Watch(w) = *watcher {
            // `shutdown` transferred ownership to the watcher thread.
            let _ = Box::into_raw(w);
        }
    }

    /// `event_loop().enter()` now, `.exit()` on drop. Safe wrapper over
    /// [`EventLoop::enter_scope`] for the common `vm.event_loop()` case.
    #[inline]
    pub fn enter_event_loop_scope(&self) -> crate::event_loop::EventLoopEnterGuard<'_> {
        self.event_loop().enter_scope()
    }

    /// `event_loop().enter()` now, `.exit_without_checkpoint()` on drop, for a
    /// dispatcher that drains microtasks itself: see
    /// [`EventLoop::enter_scope_without_checkpoint`].
    #[inline]
    pub fn enter_event_loop_scope_without_checkpoint(
        &self,
    ) -> crate::event_loop::EventLoopEnterNoCheckpointGuard<'_> {
        self.event_loop().enter_scope_without_checkpoint()
    }

    /// The dotenv loader (`transpiler.env`).
    #[inline]
    pub fn env_loader(&self) -> &bun_dotenv::Loader {
        self.env_loader_opt()
            .expect("transpiler.env set during Transpiler::init")
    }

    /// Nullable variant of [`Self::env_loader`] for the early-boot window where
    /// `Transpiler::init` has not yet run (e.g. `GarbageCollectionController::init`
    /// is reached from `JSGlobalObject::create` before `init_runtime_state`).
    #[inline]
    pub(crate) fn env_loader_opt(&self) -> Option<&bun_dotenv::Loader> {
        // SAFETY: null, or what `Transpiler::init` was given: the process's loader, or one that is
        // freed with the VM's runtime state or (a worker's) after the VM.
        // FIXME: `Transpiler::env_mut` hands out `&mut` to the same loader.
        unsafe { self.transpiler().env.as_ref() }
    }

    /// The process-lifetime resolver `FileSystem` singleton (`transpiler.fs`).
    #[inline]
    pub fn fs(&self) -> &'static bun_resolver::fs::FileSystem {
        // SAFETY: `transpiler.fs` is set during `Transpiler::init` to the
        // process-lifetime `Fs::FileSystem` singleton; never null while a VM
        // is installed.
        unsafe { &*self.transpiler().fs }
    }

    /// `transpiler.fs.top_level_dir`.
    #[inline]
    pub fn top_level_dir(&self) -> &'static [u8] {
        self.fs().top_level_dir()
    }

    /// `event_loop_handle` (the uws loop on POSIX, the libuv loop on Windows). `None` only before
    /// `ensure_waker()` runs.
    #[inline(always)]
    pub fn platform_loop_opt(&self) -> Option<&PlatformEventLoop> {
        self.event_loop_handle.get()
    }

    #[inline]
    pub fn set_platform_loop(&self, loop_: &'static PlatformEventLoop) {
        self.event_loop_handle.set(Some(loop_));
    }

    /// `Bun.spawnSync` runs on a loop of its own and puts the previous one back.
    #[cfg(windows)]
    pub(crate) fn replace_platform_loop(
        &self,
        loop_: Option<&'static PlatformEventLoop>,
    ) -> Option<&'static PlatformEventLoop> {
        self.event_loop_handle.replace(loop_)
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

    /// For `TranspilerJob`, which copies the transpiler on a pool thread.
    #[inline]
    pub(crate) fn transpiler_ptr(&self) -> *const Transpiler<'static> {
        &raw const self.transpiler
    }

    #[inline(always)]
    pub fn transpiler(&self) -> &Transpiler<'static> {
        &self.transpiler
    }

    /// The per-VM `bun_ast::Log`, which outlives the VM.
    #[inline]
    pub fn log_ref(&self) -> Option<&bun_ast::Log> {
        // SAFETY: live for as long as the VM. Whoever writes to it promises that no borrow this
        // returned is live (`log_mut`, and the transpiler's own pointers to it).
        self.log.get().map(|p| unsafe { p.as_ref() })
    }

    /// # Safety
    /// No other borrow of the log is live while the result is. The transpiler, resolver and linker
    /// write to the same log.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub unsafe fn log_mut(&self) -> Option<&mut bun_ast::Log> {
        // SAFETY: live for as long as the VM; exclusive by the fn contract.
        self.log.get().map(|mut p| unsafe { p.as_mut() })
    }

    /// The `WebWorker` whose thread this VM runs on.
    #[inline]
    pub fn worker_ref(&self) -> Option<&crate::web_worker::WebWorker> {
        // SAFETY: a heap `WebWorker` that outlives this VM (see the field).
        self.worker
            .get()
            .map(|w| unsafe { &*w.cast::<crate::web_worker::WebWorker>() })
    }

    /// Returns a small adaptor whose `get()` produces the erased
    /// `js_printer::SourceMapHandler` for `print_with_source_map`.
    #[inline]
    pub fn source_map_handler(&self) -> SourceMapHandlerGetter<'_> {
        SourceMapHandlerGetter::new(&self.source_mappings, self.wants_inline_source_map())
    }

    /// A debugger is present and not in `.connect` mode, whose clients (the VSCode extension) read
    /// `source_mappings`.
    #[inline]
    pub(crate) fn wants_inline_source_map(&self) -> bool {
        self.debugger
            .get()
            .is_some_and(|d| d.mode != crate::debugger::Mode::Connect)
    }

    #[inline]
    pub fn rare_data(&self) -> &RareData {
        self.rare_data.get_or_init(|| {
            let rd = Box::new(RareData::default());
            // RareData embeds the per-VM `us_socket_group_t` heads as value fields.
            // Registering the allocation as a root region lets LSAN trace
            // `RareData → group.head_sockets → us_socket_t`.
            bun_core::asan::register_root_region(
                core::ptr::from_ref::<RareData>(&*rd).cast(),
                core::mem::size_of::<RareData>(),
            );
            rd
        })
    }

    pub(crate) fn is_main_thread(&self) -> bool {
        self.worker.get().is_none()
    }

    pub fn is_inspector_enabled(&self) -> bool {
        self.debugger.get().is_some()
    }

    pub fn is_shutting_down(&self) -> bool {
        self.is_shutting_down.get()
    }

    pub fn has_run_cleanup_hooks(&self) -> bool {
        self.has_run_cleanup_hooks.get()
    }

    /// Exported to C++ as `Bun__VM__scriptExecutionStatus` via virtual_machine_exports.rs.
    pub fn script_execution_status(&self) -> crate::ScriptExecutionStatus {
        if self.is_shutting_down.get() || !self.script_allowed() {
            crate::ScriptExecutionStatus::Stopped
        } else {
            crate::ScriptExecutionStatus::Running
        }
    }

    /// Per-callback hot path: `drain_microtasks_with_global` calls
    /// this every time the microtask queue drains, and
    /// the only call site there is already gated on
    /// `event_loop_handle.is_some()`.
    #[inline(always)]
    pub fn uws_loop(&self) -> &'static uws::Loop {
        #[cfg(unix)]
        {
            debug_assert!(
                self.event_loop_handle.get().is_some(),
                "uws event_loop_handle is null"
            );
            // SAFETY: see the field. `teardown`'s caller promises that nothing asks for the loop
            // once it is freed.
            unsafe { self.event_loop_handle.get().unwrap_unchecked() }
        }
        #[cfg(not(unix))]
        {
            uws::Loop::get()
        }
    }

    pub fn on_after_event_loop(&self) {
        if let Some(cb) = self.after_event_loop_callback.take() {
            let ctx = self.after_event_loop_callback_ctx.take();
            // SAFETY: `cb` was registered with the matching `ctx`.
            unsafe { cb(ctx.unwrap_or(core::ptr::null_mut())) };
        }
    }

    pub fn is_event_loop_alive_excluding_immediates(&self) -> bool {
        let el = self.event_loop();
        let active = self
            .platform_loop_opt()
            .map(|h| h.is_active())
            .unwrap_or(false);
        self.unhandled_error_counter.get() == 0
            && ((active as usize)
                + self.active_tasks.get()
                + el.tasks.readable_length()
                + el.yield_tasks.len()
                + (el.has_concurrent_tasks() as usize)
                + (el.has_pending_refs() as usize)
                > 0)
    }

    pub fn is_event_loop_alive(&self) -> bool {
        self.is_event_loop_alive_excluding_immediates()
            || self.event_loop().has_any_immediate_tasks()
    }

    pub fn wakeup(&self) {
        self.event_loop().wakeup();
    }

    pub fn on_quiet_unhandled_rejection_handler_capture_value(
        this: &VirtualMachine,
        _: &JSGlobalObject,
        value: JSValue,
    ) {
        this.unhandled_error_counter
            .set(this.unhandled_error_counter.get() + 1);
        value.ensure_still_alive();
        if let Some(ptr) = this.unhandled_pending_rejection_to_capture.get() {
            // SAFETY: `replace_unhandled_pending_rejection_to_capture`'s contract.
            unsafe { *ptr = value };
        }
    }

    /// Where [`on_quiet_unhandled_rejection_handler_capture_value`](Self::on_quiet_unhandled_rejection_handler_capture_value)
    /// writes the rejection. Returns what it replaces.
    ///
    /// # Safety
    /// `slot` is valid for writes until the next call replaces it.
    pub unsafe fn replace_unhandled_pending_rejection_to_capture(
        &self,
        slot: Option<*mut JSValue>,
    ) -> Option<*mut JSValue> {
        self.unhandled_pending_rejection_to_capture.replace(slot)
    }

    #[inline]
    pub fn unhandled_rejection_exception_list(&self) -> Option<NonNull<ExceptionList>> {
        self.on_unhandled_rejection_exception_list.get()
    }

    /// The list an unhandled rejection's exceptions are collected in. Returns what it replaces.
    ///
    /// # Safety
    /// Until the next call replaces it, `list` is live and borrowed by nothing else while an
    /// unhandled rejection is reported.
    pub unsafe fn replace_unhandled_rejection_exception_list(
        &self,
        list: Option<NonNull<ExceptionList>>,
    ) -> Option<NonNull<ExceptionList>> {
        self.on_unhandled_rejection_exception_list.replace(list)
    }

    pub fn unhandled_rejection_scope(&self) -> UnhandledRejectionScope {
        UnhandledRejectionScope {
            on_unhandled_rejection: self.on_unhandled_rejection.get(),
            ctx: self.on_unhandled_rejection_ctx.get(),
            count: self.unhandled_error_counter.get(),
        }
    }

    pub(crate) fn handled_promise(&self, global_object: &JSGlobalObject, promise: JSValue) -> bool {
        if self.is_shutting_down() {
            return true;
        }
        Bun__emitHandledPromiseEvent(global_object, promise)
    }

    pub fn default_on_unhandled_rejection(
        this: &VirtualMachine,
        _: &JSGlobalObject,
        value: JSValue,
    ) {
        // SAFETY: `replace_unhandled_rejection_exception_list`'s contract.
        let list = this
            .on_unhandled_rejection_exception_list
            .get()
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

    /// `Bun.gc(force)` and `gc()`. Whoever asks for a synchronous collection reads the footprint next: what the collection
    /// freed goes back to the OS now, not whenever the allocator's purge delay has passed.
    pub fn garbage_collect_from_js(&self, sync: bool) -> usize {
        let size = self.garbage_collect(sync);
        if sync {
            bun_core::Global::mimalloc_cleanup(true);
        }
        size
    }

    #[inline]
    pub fn auto_garbage_collect(&self) {
        if self.aggressive_garbage_collection.get() != GCLevel::None {
            let _ = self
                .garbage_collect(self.aggressive_garbage_collection.get() == GCLevel::Aggressive);
        }
    }

    /// RAII form of `auto_garbage_collect`: returns a guard that calls
    /// `auto_garbage_collect()` when it goes out of scope.
    #[inline]
    pub fn auto_gc_on_drop(&self) -> AutoGcOnDrop<'_> {
        AutoGcOnDrop { vm: self }
    }

    pub(crate) fn enable_macro_mode(&self) {
        if !self.has_enabled_macro_mode.replace(true) {
            self.macro_event_loop.set_global(self.global());
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
        self.set_transpiler_macro_mode(true);
        self.event_loop.set(NonNull::from(&self.macro_event_loop));
        self.macro_mode
            .store(true, core::sync::atomic::Ordering::Relaxed);
        bun_analytics::features::macros.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        self.transpiler_store.enabled.set(false);
    }

    pub(crate) fn disable_macro_mode(&self) {
        self.set_transpiler_macro_mode(false);
        self.event_loop.set(NonNull::from(&self.regular_event_loop));
        self.macro_mode
            .store(false, core::sync::atomic::Ordering::Relaxed);
        self.transpiler_store.enabled.set(true);
    }

    fn set_transpiler_macro_mode(&self, macro_mode: bool) {
        let transpiler = self.transpiler();
        transpiler.options.target.set(if macro_mode {
            bun_ast::Target::BunMacro
        } else {
            bun_ast::Target::Bun
        });
        transpiler
            .resolver
            .caches
            .fs
            .use_alternate_source_cache
            .set(macro_mode);
    }

    pub fn enqueue_task(&self, task: bun_event_loop::Task) {
        self.event_loop().enqueue_task(task);
    }

    pub fn tick(&self) {
        self.event_loop().tick();
    }

    #[inline(always)]
    pub fn drain_microtasks(&self) {
        let _ = self.event_loop().drain_microtasks();
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
    pub fn run_error_handler(&self, result: JSValue, exception_list: Option<&mut ExceptionList>) {
        if result.is_termination_exception() {
            return;
        }
        // Save/restore `had_errors` around
        // the print, then route the value through `printException` /
        // `printErrorlikeObject` (ConsoleObject formatter). The save/restore
        // has no higher-tier dep, so it lives here unconditionally.
        let prev_had_errors = self.had_errors.replace(false);

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
        self.had_errors.set(prev_had_errors);
    }

    /// Looks up (or
    /// generates) the synthetic `MacroEntryPoint` source for `(entry_path,
    /// function_name, hash)` and evaluates it under the JSC API lock via
    /// [`run_with_api_lock`].
    pub fn load_macro_entry_point(
        &self,
        entry_path: &[u8],
        function_name: &[u8],
        specifier: &[u8],
        hash: i32,
    ) -> crate::CrateResult<*mut JSInternalPromise> {
        use bun_bundler::entry_points::{Fs, MacroEntryPoint};
        let entry_point: *mut MacroEntryPoint = match self.macro_entry_points.get(hash) {
            Some(entry_point) => entry_point.cast(),
            None => {
                let mut ep = Box::new(MacroEntryPoint::default());
                MacroEntryPoint::generate(
                    &mut *ep,
                    &Fs::PathName::init(entry_path),
                    function_name,
                    hash,
                    specifier,
                )?;
                let raw = bun_core::heap::into_raw(ep);
                bun_core::handle_oom(self.macro_entry_points.put(hash, raw.cast()));
                raw
            }
        };

        // SAFETY: `entry_point` was just inserted (heap-allocated) or fetched
        // from the cache; it lives for the VM lifetime.
        let path: &[u8] = unsafe { &*entry_point }.label();
        let promise = self.run_with_api_lock(|| self._load_macro_entry_point(path));
        promise.ok_or(crate::CrateError::JSError)
    }

    pub fn is_watcher_enabled(&self) -> bool {
        !self.bun_watcher.get().is_null()
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
    pub fn ensure_debugger(&self, block_until_connected: bool) -> crate::CrateResult<()> {
        if let Some(hooks) = runtime_hooks() {
            (hooks.ensure_debugger)(self, block_until_connected);
        }
        Ok(())
    }

    /// Whether this VM should be destroyed after it exits, even if it is the
    /// main thread's VM. Worker VMs are always destroyed on exit, regardless
    /// of this setting. Setting this to true may expose bugs that would
    /// otherwise only occur using Workers.
    pub(crate) fn should_destruct_main_thread_on_exit(&self) -> bool {
        bun_core::env_var::feature_flag::BUN_DESTRUCT_VM_ON_EXIT::get().unwrap_or(false)
            && !bun_removable_features::is_removed(bun_removable_features::Feature::Worker)
    }

    pub fn uncaught_exception(
        &self,
        global_object: &JSGlobalObject,
        err: JSValue,
        is_rejection: bool,
    ) -> bool {
        // A VM that has stopped (or is being torn down) has nobody to report to; and what a caller took
        // to be an error may be its termination.
        if self.is_shutting_down() || !self.script_allowed() || err.is_termination_exception() {
            return true;
        }

        // An exception thrown by a Bun.ModuleGraph's module code is that graph's to
        // handle, ahead of the test runner and the thread-wide path. (A rejection
        // re-entering here under --unhandled-rejections=strict/throw was already judged.)
        if !is_rejection && Bun__ModuleGraph__handleUncaughtException(global_object, err) {
            return true;
        }

        if isBunTest.load(core::sync::atomic::Ordering::Relaxed) {
            self.unhandled_error_counter
                .set(self.unhandled_error_counter.get() + 1);
            (self.on_unhandled_rejection.get())(self, global_object, err);
            return true;
        }

        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        if self.is_handling_uncaught_exception.get() {
            if !self.is_main_thread() {
                // node parity: a throw inside the uncaughtException handler in a
                // worker exits the worker with code 1 (not the main-thread fatal
                // code 7). Report it to the parent + arm termination via the
                // normal path; process_exit() RETURNS on a worker, so the
                // main-thread process_exit(7)+panic below would crash.
                self.exit_handler.exit_code.set(1);
                (self.on_unhandled_rejection.get())(self, global_object, err);
                return false;
            }
            self.run_error_handler(err, None);
            (hooks.process_exit)(global_object, 7);
            panic!("Uncaught exception while handling uncaught exception");
        }
        self.is_handling_uncaught_exception.set(true);
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
            // `--hot` and `--watch` stay to wait for the next save.
            if self.exit_on_uncaught_exception.get()
                && self.is_main_thread()
                && !self.is_watcher_enabled()
            {
                self.run_error_handler(err, None);
                // `process_exit` emits `exit`, re-entering here if a listener
                // throws. No handler is running, so drop the recursion guard or
                // that re-entry exits 7 ("handler threw") instead of 1.
                self.is_handling_uncaught_exception.set(false);
                (hooks.process_exit)(global_object, 1);
                panic!("made it past process.exit()");
            }
            // TODO maybe we want a separate code path for uncaught exceptions
            self.unhandled_error_counter
                .set(self.unhandled_error_counter.get() + 1);
            self.exit_handler.exit_code.set(1);
            (self.on_unhandled_rejection.get())(self, global_object, err);
        }
        // Note: this reset must cover BOTH the FFI call and the
        // `onUnhandledRejection` callback above. The flag must stay raised
        // while that callback runs so a re-entrant `uncaught_exception` from
        // a user handler trips the recursion guard and hard-exits with code 7
        // instead of recursing. Neither the FFI call nor the fn-pointer
        // callback unwind past this frame (re-entry hits `process_exit` →
        // `panic!`, which never returns), so a linear reset here suffices.
        self.is_handling_uncaught_exception.set(false);
        handled
    }

    pub fn hot_map(&self) -> Option<&crate::rare_data::HotMap> {
        if self.hot_reload.get() != HotReload::Hot {
            return None;
        }
        Some(self.rare_data().hot_map())
    }

    pub fn on_before_exit(&self) {
        // Node only emits 'beforeExit' on a natural drain; a fatal uncaught
        // exception that brought us here is an implicit process.exit(1). Arm
        // the hard-exit flag ourselves since we're skipping the dispatch that
        // would have set it, so a throw from an 'exit' listener still stops
        // subsequent listeners.
        if self.unhandled_error_counter.get() > 0 || self.hot_run_failed.get() {
            self.exit_on_uncaught_exception.set(true);
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
            if dispatch && self.unhandled_error_counter.get() == 0 && self.script_allowed() {
                ExitHandler::dispatch_on_before_exit(self);
                dispatch = false;

                if self.is_event_loop_alive() {
                    continue;
                }
            }

            break;
        }
    }

    /// Writes each configured profile once. The sampling report is written first because
    /// `stopCPUProfiler` clears its traces.
    pub fn write_profiles(&self) {
        if let Some(directory) = self.sampling_profiler_directory.take() {
            if let Err(e) =
                crate::bun_cpu_profiler::write_sampling_profiler_report(self.jsc_vm(), &directory)
            {
                bun_core::Output::err(
                    <&'static str>::from(e),
                    "Failed to write sampling profiler report",
                    (),
                );
            }
        }
        if let Some(config) = self.cpu_profiler_config.take() {
            if let Err(e) = crate::bun_cpu_profiler::stop_and_write_profile(self.jsc_vm(), &config)
            {
                bun_core::Output::err(<&'static str>::from(e), "Failed to write CPU profile", ());
            }
        }
        if let Some(config) = self.heap_profiler_config.take() {
            if let Err(e) =
                crate::bun_heap_profiler::generate_and_write_profile(self.jsc_vm(), &config)
            {
                bun_core::Output::err(e, "Failed to write heap profile", ());
            }
        }
    }

    pub fn on_exit(&self) {
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

        // Write profiles before any shutdown begins.
        self.write_profiles();

        ExitHandler::dispatch_on_exit(self);

        // process.exit() never reaches drain_microtasks; flush AutoFlusher sinks here.
        if !self.is_inside_deferred_task_queue.get() {
            self.is_inside_deferred_task_queue.set(true);
            self.event_loop().deferred_tasks.run();
            self.is_inside_deferred_task_queue.set(false);
        }

        // The loop won't tick again, so flush now. Don't use `uws_loop()`: inside spawnSync it
        // returns a loop that has no uWS LoopData.
        uws::Loop::get().flush_pending_writes();

        self.is_shutting_down.set(true);

        // Node's FreeEnvironment sets `is_stopping` before `RunCleanup`: the
        // Node-API env teardown below refuses every `NAPI_PREAMBLE` call.
        self.handle.stop();

        if self.exit_tears_down_napi_envs() {
            self.run_cleanup_hooks();
        }
        self.has_run_cleanup_hooks.set(true);

        // Persist the Node compile cache (NODE_COMPILE_CACHE /
        // module.enableCompileCache()) after user exit handlers ran.
        if self.is_main_thread() {
            crate::node_compile_cache::persist_at_exit();
            crate::bytecode_order_recorder::write_at_exit(self, standalone_module_graph());
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
            || !self.exit_handler.requested.get()
            || self.should_destruct_main_thread_on_exit()
    }

    /// Drains `RareData::cleanup_hooks`, repeating while the hooks push more (an env's
    /// cleanup defers finalizers onto this list once shutdown has begun). The `Vec` is
    /// taken out of `rare_data` before the hooks run: they re-enter the VM.
    fn run_cleanup_hooks(&self) {
        loop {
            let hooks = match self.rare_data.get() {
                Some(rare) if !rare.cleanup_hooks.is_empty() => rare.cleanup_hooks.take(),
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

    pub fn global_exit(&self) -> ! {
        debug_assert!(self.is_shutting_down());
        // FIXME: we should be doing this, but we're not, but unfortunately
        // doing it causes like 50+ tests to break
        // self.event_loop().tick();

        if self.is_main_thread.get() && self.should_destruct_main_thread_on_exit() {
            // SAFETY: other threads have this VM's handle and nothing else of it, and this
            // function does not return, so this thread uses no reference again either.
            unsafe { Self::teardown(Teardown::MainThreadExit) };
        } else {
            self.close_sqlite_databases_for_exit();
        }
        bun_core::Global::exit(u32::from(self.exit_handler.exit_code.get()))
    }

    /// Ends this thread's VM, which is not the main thread's: its exit handlers,
    /// [`teardown`](Self::teardown), and the storage `init` put on the global heap.
    /// Returns its exit code.
    ///
    /// # Safety
    /// This thread's VM was made without a caller's `log`; this thread holds its API lock and
    /// abandons it; nothing else can reach the VM, and no reference to it or into it is used
    /// after the call.
    pub unsafe fn exit_and_free() -> u8 {
        let this = VM.get().expect("this thread has a VM");
        // SAFETY: as `get`.
        let vm = unsafe { &*this };
        vm.is_shutting_down.set(true);
        vm.on_exit();
        let exit_code = vm.exit_handler.exit_code.get();
        // SAFETY: fn contract.
        unsafe { Self::teardown(Teardown::Worker) };
        // SAFETY: sole owner; nothing past this point dereferences the VM.
        unsafe {
            let console = vm.console.replace(core::ptr::null_mut());
            if !console.is_null() {
                bun_core::heap::destroy(console);
            }
            if let Some(log) = vm.log.take() {
                bun_core::heap::destroy(log.as_ptr());
            }
            VM.set(None);
            // The VM was `alloc_zeroed(Layout::<VirtualMachine>())` in
            // `init`, NOT `Box::new` — dealloc the raw storage directly so
            // field `Drop`s do not re-run on already-`deinit`'d state.
            std::alloc::dealloc(this.cast::<u8>(), core::alloc::Layout::new::<Self>());
        }
        exit_code
    }

    /// Checkpoint + close the sqlite connections *this* VM opened, while it is
    /// alive and no user script will touch them again. Never another VM's: a
    /// worker still running when the main thread exits without joining it owns
    /// live objects on another thread; its WAL is recovered on next open, as
    /// after any abrupt exit (and as in Node).
    fn close_sqlite_databases_for_exit(&self) {
        bun_removable_features::call_removable!(
            Sqlite,
            ReturnDefault,
            Bun__closeAllSQLiteDatabasesForTermination,
            self.global()
        );
        bun_removable_features::call_removable!(
            Sqlite,
            ReturnDefault,
            Bun__closeAllNodeSqliteDatabasesForTermination,
            self.global()
        );
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
    /// Other threads reach this thread's VM through its handle alone (worker: unpublished).
    /// Nothing uses again a reference to its JSC VM or global, to what [`destroy`](Self::destroy)
    /// frees or, for a worker, to this thread's loops; nor, on any thread, a pointer to those
    /// loops that did not come through the handle.
    pub(crate) unsafe fn teardown(kind: Teardown) {
        let vm = Self::get();
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
        let sweep = || {
            let _ = Self::stop_phase_sweep(vm, kind);
            let second = Self::stop_phase_sweep(vm, kind);
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
        if let Some(t) = vm.event_loop().forever_timer.take() {
            // SAFETY: live usockets timer from `hold_forever_poll`; closed like
            // any us_timer (freed by its close callback when the loop turns).
            unsafe { uws::Timer::close::<true>(t.as_ptr()) };
        }
        if let Some(hooks) = hooks {
            (hooks.stop_cron_for_vm_teardown)(vm);
            // Drop every TimeoutObject/ImmediateObject's heap node, JS pin and
            // +1 while runtime state and the JSC heap are alive. The heap itself
            // (and the loop handle it embeds) stays up: JSC's own RunLoop timers
            // — GC activity callbacks, sweeper, deferred work — are WTFTimers on
            // this heap and keep being scheduled until ~VM returns.
            (hooks.cancel_timers)(vm, None);
            // And unlink every other kind of EventLoopTimer (socket timeouts,
            // reconnect/lifetime timers, schedulers): their owners stay valid
            // and find them CANCELLED, but nothing fires again even where the
            // loop still turns (JSC's timers).
            // SAFETY: fn contract.
            unsafe { (hooks.disarm_all_timers_for_vm_teardown)(vm) };
        }
        crate::GarbageCollectionController::deinit(vm);
        crate::web_worker::join_child_workers(vm);
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
        // SAFETY: `vm` is this thread's, and alive.
        unsafe {
            vm.handle.close_and_wait(|| {
                vm.release_queued_work();
                let _ = Self::stop_phase_sweep(vm, kind);
            })
        };
        // Node-API finalizers that `NapiEnv::cleanup` held back for an `execute()` on the pool.
        if let Some(rare) = vm.rare_data.get() {
            for hook in rare.cleanup_hooks_after_teardown_wait.take() {
                rare.cleanup_hooks.push(hook);
            }
        }
        vm.run_cleanup_hooks();
        // SAFETY: the wait above had every transpiler job's ticket back.
        unsafe { vm.stop_import_watcher() };
        // The exiting main thread now parks the process-wide HTTP thread —
        // after the children it also served are joined and this VM's own
        // requests are back — so it cannot touch what process exit frees. If
        // it does not acknowledge (≤1 s), leave the rest to process exit.
        if matches!(kind, Teardown::MainThreadExit) && !bun_http::shutdown_for_exit() {
            teardown_log!("teardown: HTTP thread unresponsive; skipping to process exit");
            return;
        }
        if let Some(rare) = vm.rare_data.get() {
            rare.release_js_handles();
        }
        teardown_log!("teardown: script forbidden, resources cancelled, off-thread work back");

        // ---- C. JSC VM -------------------------------------------------------
        if let Some(worker) = vm.worker_ref() {
            worker.will_wait_for_nothing_more();
        }
        vm.regular_event_loop.release_without_global();
        vm.macro_event_loop.release_without_global();
        match kind {
            Teardown::Worker => WebWorker__teardownJSCVM(vm.global()),
            Teardown::MainThreadExit => Zig__GlobalObject__destructOnExit(vm.global()),
        }
        // Finalizers just closed the sockets only they owned; `us_socket_close`
        // queues onto `loop->data.closed_head`, normally freed on the next tick.
        vm.uws_loop().drain_closed_sockets();
        // Nothing schedules a WTFTimer any more: the timer heap's loop handles
        // can go (Windows uv_timer/uv_idle), before the loop close unlinks them.
        if let Some(hooks) = hooks {
            // SAFETY: destroyed above.
            unsafe { (hooks.close_timer_loop_handles_after_vm_destroyed)(vm) };
        }
        teardown_log!("teardown: JSC VM destroyed");

        // ---- D. loops (worker; main exits the process instead) ----------------
        if matches!(kind, Teardown::Worker) {
            // Whatever B/C unref'd through the concurrent counter, folded now:
            // on Windows it shares `active_handles` with libuv and a residue
            // would keep the loop close below spinning.
            vm.event_loop().apply_concurrent_ref_delta();
            if let Some(rare) = vm.rare_data.get() {
                rare.detach_socket_groups_from_loop();
            }
            // SAFETY: null.
            unsafe {
                vm.uws_loop()
                    .internal_loop_data
                    .set_jsc_vm(core::ptr::null())
            };
            vm.event_loop_handle.set(None);
            vm.regular_event_loop.forget_uws_loop();
            vm.macro_event_loop.forget_uws_loop();
            // SAFETY: nothing ticks this thread's loop any more, and what pointed at it here (the
            // groups, the event loops, `event_loop_handle`) has let go. Other threads woke it
            // through the handle, which B closed after waiting for them. The rest: fn contract.
            unsafe { bun_uws::free_thread_loop() };
            teardown_log!("teardown: uSockets loop freed");
            // SAFETY: as above.
            #[cfg(windows)]
            unsafe {
                bun_sys::windows::libuv::Loop::close_thread_loop()
            };
            teardown_log!("teardown: loops closed");
        }

        // ---- E. free owners --------------------------------------------------
        // SAFETY: fn contract.
        unsafe { Self::destroy() };
    }
}

impl VirtualMachine {
    /// One stop-phase sweep: armed handles (servers, listeners, watchers,
    /// duplex/named-pipe sockets, resolvers), a worker's uv stream/process
    /// handles, every socket group, the VM-global dns channel. Reports whether
    /// it found anything.
    fn stop_phase_sweep(vm: &Self, kind: Teardown) -> SweepResult {
        let hooks = runtime_hooks();
        let mut result = SweepResult::Idle;
        // Pool jobs parked on something external (a pipe that never becomes
        // readable): their completions then arrive through the wait.
        vm.jobs.get().cancel_all();
        result = result.and(match hooks {
            Some(hooks) => (hooks.stop_active_handles_for_vm_teardown)(vm),
            None => vm.stop_context_handles(crate::StopReason::VmTeardown),
        });
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
        if let Some(rare) = vm.rare_data.get() {
            result = result.and(rare.close_all_socket_groups(vm));
        }
        if let Some(hooks) = hooks {
            result = result.and((hooks.stop_dns_for_vm_teardown)(vm));
        }
        result
    }

    /// Release — never run — everything queued on both event loops (tasks,
    /// concurrent tasks, pending immediates) while the JSC heap and this
    /// thread's loop are alive: their JS handles and keep-alives drop now. The
    /// macro loop is only ever ticked explicitly, so whatever a macro queued on
    /// it is still there. Teardown phase B; also the one thing an owner that
    /// calls `destroy()` without a teardown (bake's build VM) must do first.
    pub fn release_queued_work(&self) {
        self.regular_event_loop.release_queued_tasks();
        self.macro_event_loop.release_queued_tasks();
        self.transpiler_store.release_queued_jobs_for_teardown();
    }
}

/// [`VirtualMachine::stop_graph_context_again`]'s task for a `Bun.ModuleGraph` context; `ptr`
/// packs the [`ContextId`](crate::ContextId), nothing is owned.
pub struct GraphContextStopAgain;

impl bun_event_loop::Taskable for GraphContextStopAgain {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::GraphContextStopAgain;
    unsafe fn release_unrun(_: *mut Self) {}
    /// Enters no context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl GraphContextStopAgain {
    pub fn run(vm: &VirtualMachine, id: crate::ContextId) {
        if let Some(context) = vm.graph_context(id).map(NonNull::from) {
            // SAFETY: registered ⇒ not freed.
            let _ = unsafe { vm.stop_graph_context(context, crate::StopReason::Disposed) };
        }
    }
}

/// [`VirtualMachine::stop_graph_context_again`]'s task for the dead context; `ptr` is unused.
pub struct DeadContextStopAgain;

impl bun_event_loop::Taskable for DeadContextStopAgain {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::DeadContextStopAgain;
    unsafe fn release_unrun(_: *mut Self) {}
    /// Enters no context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl DeadContextStopAgain {
    pub fn run(vm: &VirtualMachine) {
        let dead_context = &vm.dead_context;
        let _ = dead_context.stop(crate::StopReason::Disposed);
        if let Some(hooks) = runtime_hooks() {
            (hooks.cancel_timers)(vm, Some(dead_context.id()));
        }
    }
}

/// [`VirtualMachine::release_graph_context`]'s task: same pointer as the context, its own tag.
#[repr(transparent)]
pub struct GraphContextStopAndFree(crate::ScriptExecutionContext);

impl bun_event_loop::Taskable for GraphContextStopAndFree {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::GraphContextStopAndFree;
    /// Still registered: `destroy` frees what teardown left.
    unsafe fn release_unrun(_: *mut Self) {}
    /// Enters no context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl GraphContextStopAndFree {
    /// # Safety
    /// `this` is the context `release_graph_context` queued, whose contract holds here.
    pub unsafe fn run(vm: &VirtualMachine, this: *mut Self) {
        // SAFETY: still registered (`destroy` frees what teardown left), so not freed.
        unsafe {
            let context = NonNull::new_unchecked(this.cast::<crate::ScriptExecutionContext>());
            let _ = vm.stop_graph_context(context, crate::StopReason::Disposed);
            vm.free_graph_context(context);
        }
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
    /// Where a flag is that is the process's, which a Worker cannot be given
    /// (`ERR_WORKER_INVALID_EXEC_ARGV`): `--disallow-code-generation-from-strings`.
    pub invalid: Option<usize>,
}

/// Which of its timers a `--hot` run takes with it.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum CancelHotRunTimers {
    None,
    /// A `setTimeout` may be the next step of an earlier run's loop.
    Intervals,
    All,
}

pub struct RuntimeHooks {
    /// `bun.api.Timer.All.init()` + `Body.Value.HiveAllocator.init()` +
    /// `configureDebugger()` — everything `init()` does that names a
    /// `bun_runtime` type. Called once with the new VM, of which every field is
    /// written but `transpiler`: the hook writes it through the pointer, and
    /// does not borrow `vm` whole before that. `handle` is the VM's.
    /// Returns the opaque per-VM runtime state pointer (or null). `Err` when
    /// `Transpiler::init` fails (e.g. a deleted cwd → `getcwd` ENOENT); the
    /// hook unwinds its own allocations, so [`VirtualMachine::init`] only has to
    /// propagate the error.
    pub init_runtime_state: unsafe fn(
        vm: *mut VirtualMachine,
        transpiler: *mut Transpiler<'static>,
        handle: crate::VmHandle,
        opts: &mut InitOptions,
    ) -> crate::CrateResult<RuntimeState>,
    /// Reclaim the per-VM state boxed by `init_runtime_state`. Called from
    /// [`VirtualMachine::destroy`] (worker teardown) with the exact opaque
    /// pointer `init_runtime_state` returned (or null), which the high tier
    /// `heap::take`s. Without this slot every worker leaked one box.
    pub deinit_runtime_state: unsafe fn(state: RuntimeState),
    /// `ServerEntryPoint.generate(watch, entry_path)` — produces the synthetic
    /// `bun:main` module body for `entry_path`. Returns `false` on error
    /// (error already logged into `vm.log`).
    pub generate_entry_point: fn(vm: &VirtualMachine, watch: bool, entry_path: &[u8]) -> bool,
    /// `loadPreloads()` — runs `--preload` scripts. Returns the first rejected
    /// preload promise if any, else null. Errors propagate
    /// (resolver failures / `ModuleNotFound`).
    ///
    /// # Safety
    /// No borrow of the log is live.
    pub load_preloads: unsafe fn(vm: &VirtualMachine) -> crate::CrateResult<*mut JSInternalPromise>,
    /// `ensureDebugger(block_until_connected)` — no-op when no debugger.
    pub ensure_debugger: fn(vm: &VirtualMachine, block_until_connected: bool),
    /// `eventLoop().autoTick()` — needs `Timer::All` for the timeout calc.
    /// Hoisted here so `event_loop.rs` doesn't need its own hook table.
    pub auto_tick: fn(vm: &VirtualMachine),
    /// `eventLoop().autoTickActive()` — like `auto_tick` but only sleeps in
    /// the uSockets loop while it has active handles.
    /// Separate slot because the body skips `runImminentGCTimer` /
    /// `handleRejectedPromises` and falls through to `tickWithoutIdle` when
    /// idle — folding it into `auto_tick` would change shutdown semantics.
    pub auto_tick_active: fn(vm: &VirtualMachine),
    /// `printException` / `printErrorlikeObject` — formats `value` (or its
    /// wrapped `JSC::Exception`) to stderr via `ConsoleObject::Formatter`.
    /// High tier
    /// owns the formatter; low tier dispatches here from
    /// [`VirtualMachine::run_error_handler`].
    pub print_exception:
        fn(vm: &VirtualMachine, value: JSValue, exception_list: Option<&mut ExceptionList>),
    /// `vm.timer.insert(&mut event_loop_timer)` — `Timer::All` lives in
    /// `bun_runtime::RuntimeState` (b2-cycle); low-tier callers
    /// (`AbortSignal::Timeout`) reach it through this slot.
    pub timer_insert:
        unsafe fn(vm: &VirtualMachine, timer: *mut bun_event_loop::EventLoopTimer::EventLoopTimer),
    /// `vm.timer.remove(&mut event_loop_timer)` — see `timer_insert`.
    pub timer_remove:
        unsafe fn(vm: &VirtualMachine, timer: *mut bun_event_loop::EventLoopTimer::EventLoopTimer),
    /// `FakeTimers::min_delay_ms()`. A slot for the same reason as `timer_insert`.
    pub timer_min_delay_ms: fn(vm: &VirtualMachine) -> u32,
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
    pub create_node_fs: fn(vm: &VirtualMachine) -> *mut c_void,
    /// `ObjectURLRegistry` lookup. Registry lives in `bun_runtime::webcore`.
    pub has_blob_url: fn(blob_id: &[u8]) -> bool,
    /// `bun_aot::module_keys::name_of_text` of the text behind an object URL.
    pub name_text_of_blob_url: fn(blob_id: &[u8], vm: &VirtualMachine) -> Option<Vec<u8>>,
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
    pub process_exit: fn(global: &JSGlobalObject, code: u8),
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
        transpiler: &mut Transpiler<'static>,
        graph: &'static dyn bun_resolver::StandaloneModuleGraph,
    ),
    /// Parse a Worker's `execArgv` for the flags in [`WorkerExecArgvFlags`].
    /// `None` if parsing failed.
    pub parse_worker_exec_argv_flags:
        unsafe fn(exec_argv: &[bun_core::WTFStringImpl]) -> Option<WorkerExecArgvFlags>,
    /// `CronJob.clearAllForVM(vm, .teardown)`. `CronJob` lives in
    /// `bun_runtime::api::cron`.
    pub stop_cron_for_vm_teardown: fn(vm: &VirtualMachine),
    /// `CronJob.clearAllForVM(vm, .reload)`.
    /// Same impl as `stop_cron_for_vm_teardown` but
    /// the `.reload` mode preserves the next-fire schedule across the new
    /// global so timers re-register instead of being torn down.
    pub cron_clear_all_reload: fn(vm: &VirtualMachine),
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
        fn(agent: &crate::debugger::TestReporterHandle, next_test_id: i32) -> i32,
    /// Cancel every `TimeoutObject` / `ImmediateObject` still in the calling
    /// thread's `timer::All` heap so their JS pins and in-heap `+1` refs drop
    /// before the GC sweep. `timer::All` lives in `bun_runtime` (forward-dep);
    /// callers (`global_exit`, `WebWorker::shutdown`) are in this crate.
    ///
    /// `only`: just the timers script of that context set (the context
    /// stopped; the VM keeps running).
    ///
    /// It releases JS handles, so [`VirtualMachine::teardown`] calls it while the JSC VM is alive.
    pub cancel_timers: fn(vm: &VirtualMachine, only: Option<crate::ContextId>),
    /// A `--hot` run ends, before `hot_reload_counter` moves on. The timers of the runs before it are kept.
    pub end_hot_run_timers: fn(vm: &VirtualMachine, cancel: CancelHotRunTimers),
    /// Destroy the per-VM global DNS resolver's c-ares channel now, while JSC,
    /// the event loop, `RareData.file_polls`, and `runtime_state` are all
    /// live. `ares_destroy()` re-enters the resolver's socket-state and query
    /// callbacks; deferring it to `deinit_runtime_state`'s `RuntimeState` drop
    /// runs those callbacks against freed state. No-op when the resolver was
    /// never lazily created. Called from `WebWorker::shutdown` / `global_exit`
    /// right after `close_all_socket_groups`.
    pub stop_dns_for_vm_teardown: fn(vm: &VirtualMachine) -> SweepResult,
    /// Stop every registered native handle behind a JS object (servers,
    /// listeners, fs watchers) — the stop phase for Rust-side JS classes, run
    /// with the VM alive right after the WebCore stop phase.
    pub stop_active_handles_for_vm_teardown: fn(vm: &VirtualMachine) -> SweepResult,
    /// Teardown only (never on a live VM): unlink every remaining EventLoopTimer.
    pub disarm_all_timers_for_vm_teardown: unsafe fn(vm: &VirtualMachine),
    /// Teardown-only, after ~VM (JSC's RunLoop timers use the heap until then):
    /// close the loop handles the timer heap embeds (Windows uv_timer/uv_idle)
    /// so the loop close unlinks them before the runtime state is freed.
    ///
    /// # Safety
    /// The JSC VM is already destroyed.
    pub close_timer_loop_handles_after_vm_destroyed: unsafe fn(vm: &VirtualMachine),
}

// Canonical `EventLoopCtx` vtable for a `*mut VirtualMachine` owner — the JS
// half of `bun_io`'s cycle-break manual vtable. Every slot is implementable
// from in-crate data,
// so this is the single fully-populated instance; `aio::get_vm_ctx(.Js)` and
// the websocket-client adapters resolve to it.
bun_io::link_impl_EventLoopCtx! {
    Js for VirtualMachine => |this| {
        platform_event_loop_ptr() => (*this).uws_loop().as_ptr(),
        file_polls_ptr() => (*this).rare_data().file_polls(),
        // CROSS-THREAD: reached via `KeepAlive::unref_on_next_tick`, so no `&VirtualMachine` is
        // formed: only the atomic is borrowed.
        increment_pending_unref_counter() => {
            (*this)
                .pending_unref_counter
                .fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        },
        after_event_loop_callback() => (*this).after_event_loop_callback.get(),
        set_after_event_loop_callback(cb, ctx) => {
            (*this).after_event_loop_callback.set(cb);
            (*this).after_event_loop_callback_ctx.set(ctx.map(|p| p.as_ptr()));
        },
        pipe_read_scratch() => &raw const *(*this).rare_data().pipe_read_scratch,
    }
}

impl VirtualMachine {
    #[inline]
    pub fn event_loop_ctx(&'static self) -> bun_io::EventLoopCtx {
        // SAFETY: `'static` outlives every dispatch.
        unsafe {
            bun_io::EventLoopCtx::new(
                bun_io::EventLoopCtxKind::Js,
                core::ptr::from_ref(self).cast_mut(),
            )
        }
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

    /// [`event_loop_ctx`](Self::event_loop_ctx) for a caller whose borrow of the VM is shorter.
    #[inline]
    pub fn loop_ctx(&self) -> bun_io::EventLoopCtx {
        debug_assert!(core::ptr::eq(self, Self::get()));
        Self::get().event_loop_ctx()
    }
}

impl VirtualMachine {
    /// What `RuntimeHooks::init_runtime_state` returned for this VM. Null once
    /// [`destroy`](Self::destroy) has taken it back.
    #[inline]
    pub fn runtime_state(&self) -> RuntimeState {
        self.runtime_state
            .load(core::sync::atomic::Ordering::Relaxed)
    }

    /// [`Self::runtime_state`] for a thread that is not `vm`'s. Also null until `init` has stored it.
    ///
    /// # Safety
    /// `vm` is not freed.
    #[inline]
    pub unsafe fn runtime_state_of(vm: *const Self) -> RuntimeState {
        // SAFETY: fn contract. Only the field, which is `Sync`, is borrowed.
        unsafe {
            (*vm)
                .runtime_state
                .load(core::sync::atomic::Ordering::Relaxed)
        }
    }

    /// `vm.timer.insert(timer)` — dispatches through `RuntimeHooks` because
    /// `Timer::All` lives in `bun_runtime` (b2-cycle).
    ///
    /// # Safety
    /// That of `bun_runtime::timer::All::insert`:
    /// - `timer` is the node that `__bun_fire_timer` expects for its `tag` (not `WTFTimer`): a
    ///   field of a live owner, with provenance for reads and writes over the whole owner.
    /// - It is linked in no heap.
    /// - Until it is unlinked, by [`Self::timer_remove`], `FakeTimers`, VM teardown or the drain
    ///   that pops it to fire it, the owner is neither freed nor moved, and every call that arms,
    ///   disarms or drains a timer of this thread may read and write the node through `timer`, to
    ///   compare and relink it. So the node is in a cell of an owner that is only borrowed shared,
    ///   or nothing borrows the owner across such a call.
    /// - The owner's handler takes `state` off `ACTIVE` before anything passes the popped node to
    ///   `timer_remove`. The drain leaves it `ACTIVE`.
    #[inline]
    pub unsafe fn timer_insert(
        vm: &Self,
        timer: *mut bun_event_loop::EventLoopTimer::EventLoopTimer,
    ) {
        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        // SAFETY: per fn contract; `vm` is the live per-thread VM.
        unsafe { (hooks.timer_insert)(vm, timer) }
    }

    /// `vm.timer.remove(timer)` — see [`Self::timer_insert`].
    ///
    /// # Safety
    /// `timer` is a node that [`Self::timer_insert`] linked on this thread and that nothing has
    /// unlinked since. For an owner that keeps the contract of `timer_insert`, that is what
    /// `state == ACTIVE` says.
    #[inline]
    pub unsafe fn timer_remove(
        vm: &Self,
        timer: *mut bun_event_loop::EventLoopTimer::EventLoopTimer,
    ) {
        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        // SAFETY: per fn contract; `vm` is the live per-thread VM.
        unsafe { (hooks.timer_remove)(vm, timer) }
    }

    /// The shortest delay, in milliseconds, a timer armed now can have: 1 while `jest.useFakeTimers()` runs a timer's callback.
    #[inline]
    pub fn timer_min_delay_ms(&self) -> u32 {
        let hooks = runtime_hooks().expect("RuntimeHooks not installed");
        (hooks.timer_min_delay_ms)(self)
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
    safe fn Bun__loadBuiltinEntryPoint(
        global: &JSGlobalObject,
        entry_point: BuiltinEntryPoint,
    ) -> *mut JSInternalPromise;
    fn Bun__lookForServerAfterEvaluation(global: &JSGlobalObject, promise: *mut JSInternalPromise);
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
    ///
    /// `configure` is the one chance to change the transpiler through `&mut`: it runs last,
    /// before anything can borrow the VM.
    pub fn init(
        opts: InitOptions,
        configure: ConfigureTranspiler<'_>,
    ) -> crate::CrateResult<&'static VirtualMachine> {
        let vm = Self::init_unshared(opts)?;
        // SAFETY: just made, and nothing borrows it.
        Ok(unsafe { Self::share(vm, configure) })
    }

    /// The last step of every `init*`: configures the transpiler and hands the VM out.
    ///
    /// # Safety
    /// `vm` is what [`init_unshared`](Self::init_unshared) returned on this thread. No reference
    /// to it or into it is live, and no pointer made from one is used again.
    unsafe fn share(
        vm: *mut VirtualMachine,
        configure: ConfigureTranspiler<'_>,
    ) -> &'static VirtualMachine {
        // `configure` cannot reach the VM whose transpiler it borrows.
        VM.set(None);
        // SAFETY: fn contract: the only borrow of the VM.
        configure(unsafe { &mut (*vm).transpiler });
        VM.set(Some(vm));
        // SAFETY: every field is written, and the allocation lives as long as its thread runs
        // script.
        unsafe { &*vm }
    }

    /// [`init`](Self::init) up to `configure`. This thread's VM is the result, and nothing
    /// borrows it.
    fn init_unshared(mut opts: InitOptions) -> crate::CrateResult<*mut VirtualMachine> {
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
        // `&VirtualMachine` until all such fields have been `ptr::write`n
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
        // writes go through `addr_of_mut!` so no `&VirtualMachine` is
        // formed while non-zero-valid fields are still zero. Every target is
        // either zero-valid (no Drop on the overwritten bytes) or written via
        // `ptr::write` (no Drop of the uninit bytes).
        unsafe {
            use core::ptr::addr_of_mut;
            addr_of_mut!((*vm).global).write(Cell::new(None));
            addr_of_mut!((*vm).jsc_vm).write(Cell::new(None));
            addr_of_mut!((*vm).event_loop_handle).write(Cell::new(None));
            addr_of_mut!((*vm).rare_data).write(Default::default());
            addr_of_mut!((*vm).debugger).write(Default::default());
            addr_of_mut!((*vm).console).write(Cell::new(console));
            // `log` is a fresh leaked Box; outlives the VM.
            addr_of_mut!((*vm).log).write(Cell::new(NonNull::new(log)));
            addr_of_mut!((*vm).main).write(Cell::new(None));
            addr_of_mut!((*vm).main_hash).write(Cell::new(0));
            addr_of_mut!((*vm).main_entry_point).write(Cell::new(MainEntryPoint::File));
            addr_of_mut!((*vm).main_resolved_path).write(Cell::new(bun_core::String::EMPTY));
            addr_of_mut!((*vm).bake_pages).write(Cell::new(false));
            addr_of_mut!((*vm).hide_bun_stackframes).write(Cell::new(true));
            addr_of_mut!((*vm).is_main_thread).write(Cell::new(opts.is_main_thread));
            // Left at the
            // zeroed default this aliases `hot_reload_counter`'s initial 0, so a
            // watcher event that races the very first entry-point load makes
            // `reload()` think the rejection was already reported and proceed
            // (replacing `pending_internal_promise`) instead of deferring,
            // dropping the error on the floor.
            addr_of_mut!((*vm).pending_internal_promise_reported_at).write(Cell::new(u32::MAX));
            addr_of_mut!((*vm).on_unhandled_rejection)
                .write(Cell::new(VirtualMachine::default_on_unhandled_rejection));
            addr_of_mut!((*vm).origin_timer).write(std::time::Instant::now());
            addr_of_mut!((*vm).origin_timestamp).write(get_origin_timestamp());
            addr_of_mut!((*vm).smol).write(opts.smol);
            // `Option<{CPU,Heap}ProfilerConfig>` are NOT zero-valid: each
            // payload contains a `bool`, and rustc picks that field's invalid
            // range (not the `&[u8]` null-ptr) as the enum niche, so all-zero
            // bytes decode as `Some` with null-ref slices. Write `None`
            // explicitly.
            addr_of_mut!((*vm).cpu_profiler_config).write(Cell::new(None));
            addr_of_mut!((*vm).heap_profiler_config).write(Cell::new(None));
            addr_of_mut!((*vm).sampling_profiler_directory).write(Cell::new(None));
            // `Option<bool>` uses the bool's invalid range (2) as the niche, so
            // all-zero bytes decode as `Some(false)` — for TLS that would
            // silently disable certificate verification. Write `None` explicitly.
            addr_of_mut!((*vm).default_tls_reject_unauthorized).write(Cell::new(None));
            addr_of_mut!((*vm).pending_ipc).write(Cell::new(None));
            // Non-zero-valid container fields: `Vec`/`Box`/`HashMap`/
            // `ArrayHashMap` all carry a `NonNull` (dangling when empty), and
            // `URL` is a struct of `&[u8]` references — all-zero bytes violate
            // their validity invariants even when len/cap are 0. Write the
            // canonical empty value via `ptr::write` (no Drop of zeroed bytes).
            addr_of_mut!((*vm).preload).write(core::mem::take(&mut opts.preload).into());
            addr_of_mut!((*vm).child_workers).write(Default::default());
            addr_of_mut!((*vm).handle)
                .write(core::mem::ManuallyDrop::new(crate::VmHandle::new(vm)));
            addr_of_mut!((*vm).argv).write(core::mem::take(&mut opts.argv));
            addr_of_mut!((*vm).test_isolation_state).write(Default::default());
            addr_of_mut!((*vm).macros).write(Default::default());
            addr_of_mut!((*vm).macro_entry_points).write(Default::default());
            addr_of_mut!((*vm).auto_killer).write(Default::default());
            addr_of_mut!((*vm).root_context).write(crate::ScriptExecutionContext::root());
            addr_of_mut!((*vm).graph_contexts).write(Default::default());
            addr_of_mut!((*vm).entered_context).write(Cell::new(None));
            addr_of_mut!((*vm).dead_context).write(crate::ScriptExecutionContext::dead());
            addr_of_mut!((*vm).commonjs_custom_extensions).write(Default::default());
            addr_of_mut!((*vm).entry_point).write(Default::default());
            addr_of_mut!((*vm).origin).write(Default::default());
            addr_of_mut!((*vm).ref_strings).write(Default::default());
            addr_of_mut!((*vm).modules).write(Default::default());
            addr_of_mut!((*vm).macro_event_loop).write(EventLoop::new(vm));
            addr_of_mut!((*vm).proxy_env_storage).write(Default::default());
            addr_of_mut!((*vm).gc_controller).write(Default::default());
            addr_of_mut!((*vm).channel_ref).write(Default::default());
            if let Some(graph) = opts.graph {
                let _ = STANDALONE_MODULE_GRAPH.set(graph);
            }
            addr_of_mut!((*vm).standalone_module_graph).write(opts.graph);
            addr_of_mut!((*vm).finds_entry_points_by_path).write(opts.graph.is_some_and(|graph| {
                graph
                    .compiled_program()
                    .is_some_and(|program| !program.entry_points.is_empty())
            }));
            addr_of_mut!((*vm).initial_script_execution_context_identifier)
                .write(Cell::new(context_id));
            // Mutex fields: zeroed atomics ARE valid-unlocked, but write the
            // canonical value so the invariant is explicit.
            addr_of_mut!((*vm).remap_stack_frames_mutex).write(bun_threading::Mutex::new());

            addr_of_mut!((*vm).transpiler_store)
                .write(crate::runtime_transpiler_store::RuntimeTranspilerStore::init());

            addr_of_mut!((*vm).regular_event_loop).write(EventLoop::new(vm));
            addr_of_mut!((*vm).event_loop).write(Cell::new(NonNull::new_unchecked(addr_of_mut!(
                (*vm).regular_event_loop
            ))));
            let _ = (*vm).regular_event_loop.tasks.ensure_unused_capacity(64);

            addr_of_mut!((*vm).source_mappings).write(SavedSourceMap::default());
        }

        // High-tier per-VM state — Transpiler / Timer::All / entry_point.
        // Note (init order): the transpiler and per-VM timer state must be
        // built BEFORE `JSGlobalObject` creation. The C++ body
        // of `Zig__GlobalObject__create` re-enters via `WTFTimer__create`/
        // `WTFTimer__update` (JSC's GC scheduler), which dereferences
        // `RuntimeState::of(vm).timer` — so this hook MUST run first or that path
        // null-derefs.
        if let Some(hooks) = runtime_hooks() {
            // SAFETY: hook contract — `vm` is the unique live VM on this
            // thread. Write through the raw `vm` ptr (not `vm_ref`) so no
            // `&VirtualMachine` is held live across the hook call — the
            // hook body itself dereferences `vm`.
            //
            // `?`: on `Err` (e.g. a deleted cwd → `getcwd` ENOENT out of
            // `Transpiler::init`) the hook already unwound its own per-VM state,
            // so abort `init` here — `vm.transpiler` was never written, and
            // bailing out before the CLI reads it turns the old segfault into a
            // clean error + non-zero exit.
            unsafe {
                (*vm).runtime_state.store(
                    (hooks.init_runtime_state)(
                        vm,
                        &raw mut (*vm).transpiler,
                        (*(*vm).handle).clone(),
                        &mut opts,
                    )?,
                    core::sync::atomic::Ordering::Relaxed,
                )
            };
        }

        // JSGlobalObject creation. `ensure_waker()` must run before the FFI.
        // SAFETY: `vm` is the unique live VM on this thread; raw-ptr deref so
        // no `&mut` is held across the FFI re-entry (`Bun__getVM()` —
        // ZigGlobalObject.cpp:473/961).
        unsafe { (*vm).regular_event_loop.ensure_waker() };
        if opts.is_main_thread {
            if let Some(graph) = standalone_module_graph() {
                crate::compiled_program::use_image(graph);
            }
        }
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
        let vm_ptr = vm;
        // SAFETY: every field is written, and the allocation lives as long as its thread runs
        // script. Nothing below keeps the reference or a pointer made from it.
        let vm: &'static VirtualMachine = unsafe { &*vm_ptr };
        // SAFETY: freshly created, and lives as long as the VM.
        let global: &'static JSGlobalObject = unsafe { &*global };
        vm.global.set(Some(global));
        vm.root_context.bind(crate::ContextId::from_raw(
            Zig__GlobalObject__contextIdentifier(global),
        ));
        vm.regular_event_loop.set_global(global);
        let jsc_vm = global.vm();
        vm.jsc_vm.set(Some(jsc_vm));
        vm.handle.set_jsc_vm(jsc_vm);
        VMHolder::set_cached_global_object(Some(global));

        // After `jsc_vm` is set, so C/uws callbacks can recover the JSC VM.
        // SAFETY: nothing ticks the loop once `teardown` has destroyed the `JSC::VM`.
        unsafe {
            uws::Loop::get()
                .internal_loop_data
                .set_jsc_vm(core::ptr::from_ref(jsc_vm).cast())
        };

        // `ParentDeathWatchdog` install for the main thread.
        // Must run AFTER `ensure_waker()` (above) has set `event_loop_handle`,
        // since on macOS the kqueue registration resolves the platform loop via
        // `event_loop_ctx → uws_loop()`. No-op off macOS / when `--no-orphans`
        // is not enabled. `init_with_module_graph` / `init_bake` route through
        // here with their caller's `is_main_thread`; `init_worker` passes
        // `false` so workers never arm the watchdog.
        if opts.is_main_thread {
            bun_io::ParentDeathWatchdog::install_on_event_loop(vm.event_loop_ctx());
        }

        if opts.smol {
            // SAFETY: written once during init.
            IS_SMOL_MODE.store(true, core::sync::atomic::Ordering::Relaxed);
        }

        // `Bun__standaloneInternalModuleBytecode` serves the executable's embedded bytecode to every VM in the
        // process, so every VM needs the executable's string table (the debugger thread's VM included).
        if let Some(graph) = standalone_module_graph() {
            vm.install_bytecode_string_table(graph);
            crate::bytecode_order_recorder::init_vm(vm, graph);
        }

        Ok(vm_ptr)
    }

    /// The path of the entry module, `None` when there is none (see `main` field doc).
    #[inline]
    pub fn main(&self) -> Option<&[u8]> {
        self.main.get()
    }

    /// `main_resolved_path` as a JS string, `None` while it is empty.
    pub fn main_resolved_path_to_js(&self, global: &JSGlobalObject) -> Option<JsResult<JSValue>> {
        use crate::StringJsc as _;
        // SAFETY: the borrow ends with `to_js`, which allocates a JS string and runs no script, so
        // nothing under it assigns the field.
        let path = unsafe { &*self.main_resolved_path.as_ptr() };
        (!path.is_empty()).then(|| path.to_js(global))
    }

    pub fn set_main_resolved_path(&self, path: bun_core::String) {
        self.main_resolved_path.set(path);
    }

    /// Set the entry-point path, or `None` for no entry module.
    #[inline]
    pub fn set_main(&self, path: Option<&'static [u8]>) {
        self.main.set(path);
        self.main_hash
            .set(path.map_or(0, bun_watcher::Watcher::get_hash));
    }

    pub fn entry_point_is_commonjs(&self) -> bool {
        self.entry_point_result.evaluated_as_cjs.get()
            || (self.main_entry_point.get() == MainEntryPoint::Compiled
                && crate::compiled_program::entry_point_is_commonjs(self.global()))
    }

    /// `eventLoop().waitForPromise(promise)` — spin tick/auto_tick until
    /// `promise` settles. Thin forwarder; body lives in
    /// [`crate::event_loop::EventLoop::wait_for_promise`].
    #[inline]
    pub fn wait_for_promise(&self, promise: jsc::AnyPromise) -> Result<(), jsc::Stopped> {
        self.event_loop().wait_for_promise(promise)
    }

    /// `eventLoop().autoTick()` — dispatched through the runtime hook
    /// (needs `Timer::All` for the poll timeout).
    #[inline]
    pub fn auto_tick(&self) {
        if let Some(hooks) = runtime_hooks() {
            (hooks.auto_tick)(self);
        } else {
            // No high tier (unit tests) — fall back to a non-blocking tick.
            self.event_loop().tick();
        }
    }

    /// `eventLoop().autoTickActive()` — like [`auto_tick`](Self::auto_tick)
    /// but only sleeps in the uSockets loop while it has active handles.
    /// The real body lives in `event_loop.rs`
    /// behind `` until the b2-cycle (`Timer::All`) breaks; until
    /// then route through the same `auto_tick` hook so drain loops in
    /// `on_before_exit` / `bun_main` still make forward progress.
    #[inline]
    pub fn auto_tick_active(&self) {
        if let Some(hooks) = runtime_hooks() {
            (hooks.auto_tick_active)(self);
        } else {
            // No high-tier hook (unit tests) — drain JS tasks only so callers
            // observe forward progress without blocking on the I/O loop.
            self.event_loop().tick();
        }
    }

    /// `reloadEntryPoint(entry_path)` — set `main`, generate the synthetic
    /// `bun:main` entry, run preloads, and kick off module evaluation.
    /// `entry_path` is `None` for a built-in entry point with no entry module (`bun bake`).
    pub(crate) fn reload_entry_point(
        &self,
        entry_path: Option<&'static [u8]>,
    ) -> crate::CrateResult<*mut JSInternalPromise> {
        let entry_path = entry_path.map(crate::compiled_program::entry_module_key);
        self.has_loaded.set(false);
        self.set_main(entry_path);
        self.main_resolved_path.set(bun_core::String::EMPTY);
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
        use bun_core::is_bootstrap_flag;
        let main_thread_vm = MAIN_THREAD_VM.load(core::sync::atomic::Ordering::Acquire);
        let program_argument_count =
            if self.standalone_module_graph.is_none() || main_thread_vm.is_null() {
                0
            } else if self.is_main_thread.get() {
                self.argv.len()
            } else {
                // SAFETY: the main thread's VM outlives a worker's, and only `init` writes `argv`.
                // Only that field is borrowed.
                let program_arguments = unsafe { &(*main_thread_vm).argv };
                program_arguments.len()
            };
        let argv = bun_core::argv();
        let needs_pre_execution = argv
            .iter()
            .take(argv.len().saturating_sub(program_argument_count))
            .any(is_bootstrap_flag)
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
        if needs_pre_execution && crate::compiled_program::can_load_unused_library_modules() {
            // The C++ side catches and reports any JS exception thrown while
            // evaluating `internal/process/pre_execution`.
            crate::cpp::Bun__preExecutionBootstrap(self.global());
        } else if needs_pre_execution {
            crate::cpp::Bun__applyStackTraceLimitOption(self.global());
        }

        if matches!(
            self.main_entry_point.get(),
            MainEntryPoint::File | MainEntryPoint::Compiled
        ) {
            let is_compiled = entry_path.is_some_and(crate::compiled_program::is_compiled_module);
            self.main_entry_point.set(if is_compiled {
                MainEntryPoint::Compiled
            } else {
                MainEntryPoint::File
            });
        }
        self.has_loaded.set(
            self.main_entry_point.get() == MainEntryPoint::Compiled
                && crate::compiled_program::runs_in_place(),
        );
        self.did_look_for_server.set(false);

        if let (MainEntryPoint::File, Some(entry_path)) = (self.main_entry_point.get(), entry_path)
        {
            if let Some(hooks) = hooks {
                let watch = self.is_watcher_enabled();
                if !(hooks.generate_entry_point)(self, watch, entry_path) {
                    return Err(crate::CrateError::ServerEntryPointGenerate);
                }
            }
        }

        if !self.transpiler().options.disable_transpilation {
            if !self.preload.is_empty() {
                if let Some(hooks) = hooks {
                    // SAFETY: this does not borrow it, and nor do the callers: they are about to
                    // run the entry point, which transpiles.
                    let p = unsafe { (hooks.load_preloads)(self) }?;
                    if !p.is_null() {
                        self.set_pending_internal_promise(Some(p));
                        return Ok(p);
                    }
                }

                // Check if Module.runMain was patched.
                if self.has_patched_run_main.get()
                    && matches!(
                        self.main_entry_point.get(),
                        MainEntryPoint::File | MainEntryPoint::Compiled
                    )
                {
                    bun_core::hint::cold();
                    self.set_pending_internal_promise(None);
                    let global_ref = self.global();
                    let run_main_path = match (self.main_entry_point.get(), self.main()) {
                        (MainEntryPoint::Compiled, Some(main)) => main,
                        _ => MAIN_FILE_NAME,
                    };
                    let argv1 = bun_string_jsc::create_utf8_for_js(global_ref, run_main_path)?;
                    let promise: *mut JSInternalPromise =
                        match jsc::from_js_host_call_generic(global_ref, || {
                            NodeModuleModule__callOverriddenRunMain(global_ref, argv1)
                        }) {
                            Ok(ret) => {
                                // If the override stored a promise itself, use that; otherwise
                                // wrap its return value.
                                if let Some(stored) = self.pending_internal_promise() {
                                    return Ok(stored);
                                }
                                // `Promise.resolve(ret)` reads `ret.constructor` / `ret.then`,
                                // which may throw.
                                jsc::call_check_slow(global_ref, || {
                                    JSC__JSInternalPromise__resolvedPromise(global_ref, ret)
                                })?
                            }
                            Err(err) => {
                                let rejected =
                                    crate::JSPromise::rejected_promise_with_caught_exception(
                                        global_ref, err,
                                    )?;
                                // Nobody else looks at a promise the override stored, so that stays
                                // the entry point's, and this one is left to the rejection tracker.
                                if let Some(stored) = self.pending_internal_promise() {
                                    return Ok(stored);
                                }
                                // Whoever loads the entry point reports its promise, so, like the
                                // loader's, it is not for the rejection tracker as well.
                                rejected.set_handled();
                                core::ptr::from_mut(rejected).cast()
                            }
                        };
                    self.set_pending_internal_promise(Some(promise));
                    return Ok(promise);
                }
            }
        }

        // Preloads (evaluated above, synchronously) are not the entry: only
        // module evaluations from here on mark the entry graph as executing.
        self.entry_evaluation_started.set(false);
        let builtin = match self.main_entry_point.get() {
            MainEntryPoint::File | MainEntryPoint::Compiled => None,
            MainEntryPoint::Html => Some(BuiltinEntryPoint::Html),
            MainEntryPoint::Bake => Some(BuiltinEntryPoint::Bake),
        };
        let promise = if let Some(builtin) = builtin {
            // The built-in module is the main module, so what it imports loads as the imports of a
            // main module do (`has_loaded`): a file of an unknown type is a file, not a script.
            if !self.transpiler().options.disable_transpilation {
                self.has_loaded.set(true);
            }
            let global_ref = self.global();
            let p: *mut JSInternalPromise = jsc::from_js_host_call_generic(global_ref, || {
                Bun__loadBuiltinEntryPoint(global_ref, builtin)
            })?;
            if p.is_null() {
                return Err(crate::CrateError::JSError);
            }
            p
        } else if self.main_entry_point.get() == MainEntryPoint::Compiled
            && !self.transpiler().options.disable_transpilation
        {
            // The path is the key of the module in the image: there is nothing to resolve.
            let main = (self.main()).expect("a compiled entry point has a path");
            let main_str = bun_core::StringView::from_bytes(main);
            let promise =
                jsc::JSModuleLoader::load_and_evaluate_module_ptr(self.global(), &main_str)
                    .map(NonNull::as_ptr)
                    .ok_or(crate::CrateError::JSError)?;
            // SAFETY: `promise` is a live JSC heap cell.
            unsafe { Bun__lookForServerAfterEvaluation(self.global(), promise) };
            promise
        } else if !self.transpiler().options.disable_transpilation {
            let name = bun_core::StringView::borrow_utf8(MAIN_FILE_NAME);
            jsc::JSModuleLoader::load_and_evaluate_module_ptr(self.global(), &name)
                .map(NonNull::as_ptr)
                .ok_or(crate::CrateError::JSError)?
        } else {
            let main = (self.main()).expect("a file entry point has a path");
            let main_str = bun_core::StringView::from_bytes(main);
            jsc::JSModuleLoader::resolve_and_load_and_evaluate_module_ptr(self.global(), &main_str)
                .map(NonNull::as_ptr)
                .ok_or(crate::CrateError::JSError)?
        };

        self.set_pending_internal_promise(Some(promise));
        Ok(promise)
    }

    /// `loadEntryPoint(entry_path)` — `reload_entry_point` + spin until the
    /// returned promise settles.
    pub fn load_entry_point(
        &self,
        entry_path: Option<&'static [u8]>,
    ) -> crate::CrateResult<*mut JSInternalPromise> {
        let promise = self.reload_entry_point(entry_path)?;

        // pending_internal_promise can change if hot module reloading is enabled
        if self.is_watcher_enabled() {
            loop {
                let Some(p) = self.pending_internal_promise() else {
                    break;
                };
                if crate::JSPromise::status_ptr(p) != crate::js_promise::Status::Pending {
                    break;
                }
                self.event_loop().tick();
                let Some(p) = self.pending_internal_promise() else {
                    break;
                };
                if crate::JSPromise::status_ptr(p) == crate::js_promise::Status::Pending {
                    self.auto_tick();
                }
            }
        } else {
            if crate::JSPromise::status_ptr(promise) == crate::js_promise::Status::Rejected {
                return Ok(promise);
            }
            let _ = self.wait_for_promise(jsc::AnyPromise::Internal(promise));
        }

        Ok(self.pending_internal_promise().unwrap_or(promise))
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
            bun_ast::Metadata::Build | bun_ast::Metadata::TypeScript { .. } => {
                BuildMessage::create(global_this, msg)
            }
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

/// `get()` returns an erased `js_printer::SourceMapHandler` over either the VM's `source_mappings`
/// (fast path) or `self` (inline source map, for a debugger).
///
/// Holds nothing of the VM that only its thread may touch: `TranspilerJob::run` uses one on a pool
/// thread.
///
/// The printer that is printing is borrowed for the whole print, so the inline source map is kept
/// here until [`append_inline_source_map`](Self::append_inline_source_map).
pub struct SourceMapHandlerGetter<'a> {
    source_mappings: &'a SavedSourceMap,
    inline_source_map: bool,
    inline: Option<InlineSourceMap>,
}

struct InlineSourceMap {
    json: bun_core::MutableString,
    source_url: Box<[u8]>,
}

impl<'a> SourceMapHandlerGetter<'a> {
    /// `inline_source_map` is [`VirtualMachine::wants_inline_source_map`].
    #[inline]
    pub(crate) fn new(source_mappings: &'a SavedSourceMap, inline_source_map: bool) -> Self {
        Self {
            source_mappings,
            inline_source_map,
            inline: None,
        }
    }

    pub fn get(&mut self) -> bun_js_printer::SourceMapHandler<'_> {
        if !self.inline_source_map {
            return bun_js_printer::SourceMapHandler::for_(&mut self.source_mappings);
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
        let mut json = bun_core::MutableString::init_empty();
        chunk
            .print_source_map_contents_from_internal::<true>(source, &mut json, true)
            .map_err(|_| bun_js_printer::Error::WriteFailed)?;
        self.source_mappings
            .put_mappings(source, chunk.buffer)
            .map_err(|_| bun_js_printer::Error::WriteFailed)?;
        self.inline = Some(InlineSourceMap {
            json,
            // TODO: do we need to %-encode the path?
            source_url: source.path.text.into(),
        });
        Ok(())
    }
}

impl SourceMapHandlerGetter<'_> {
    /// Once the print that was handed [`get`](Self::get) has returned: ends `printer`'s output with
    /// the inline source map, if one was wanted.
    pub fn append_inline_source_map(
        &mut self,
        printer: &mut bun_js_printer::BufferPrinter,
    ) -> bun_js_printer::Result<()> {
        let Some(InlineSourceMap { json, source_url }) = self.inline.take() else {
            return Ok(());
        };
        const SOURCE_MAP_URL_PREFIX_START: &[u8] =
            b"//# sourceMappingURL=data:application/json;base64,";
        const SOURCE_MAPPING_URL: &[u8] = b"\n//# sourceURL=";
        let prefix_len =
            SOURCE_MAP_URL_PREFIX_START.len() + SOURCE_MAPPING_URL.len() + source_url.len();

        let encode_len = bun_base64::encode_len(json.list.as_slice());
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
                    json.list.as_slice(),
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
        printer.ctx.buffer.append_assume_capacity(&source_url);
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
    /// [`InitOptions::argv`].
    pub argv: Vec<Box<[u8]>>,
    /// [`InitOptions::preload`].
    pub preload: Vec<Box<[u8]>>,
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

/// Output slot for module resolution: the resolved path and query string.
#[derive(Default)]
pub struct ResolveFunctionResult<'r> {
    pub path: &'r [u8],
    pub(crate) query_string: &'r [u8],
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
        let printer = Box::new(bun_js_printer::BufferPrinter::init(writer));
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
    if VirtualMachine::get_or_null().is_some_and(|vm| vm.macro_guard_depth.get() > 0) {
        return;
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
    let Some(vm) = VirtualMachine::get_or_null() else {
        return;
    };
    if !vm.has_enabled_macro_mode.get() {
        return;
    }
    debug_assert!(!vm.is_main_thread.get());
    debug_assert_eq!(vm.macro_guard_depth.get(), 0);
    vm.jsc_vm().run_gc(true);
}

fn normalize_source(source: &[u8]) -> &[u8] {
    if let Some(rest) = source.strip_prefix(b"file://") {
        return rest;
    }
    source
}

// `JSGlobalObject` / `VM` are opaque `UnsafeCell`-backed ZST handles, so
// `&T` is ABI-identical to a non-null `T*`. `BakeCreateProdGlobal`'s
// `console_ptr` is an opaque round-trip pointer C++ stores into the new global
// (never dereferenced as Rust data) — same contract as `Zig__GlobalObject__create`.
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
    // `ref_counted_string`; it points at a heap `RefString`.
    unsafe { crate::ref_string::RefString::destroy(str_) };
}

impl VirtualMachine {
    /// Whether native addons (`process.dlopen`) are allowed (`--no-addons` disables them).
    #[unsafe(export_name = "Bun__VM__allowAddons")]
    pub(crate) extern "C" fn allow_addons(this: &VirtualMachine) -> bool {
        this.transpiler()
            .options
            .transform_options
            .allow_addons
            .unwrap_or(true)
    }

    /// `--disallow-code-generation-from-strings`, as a `bun_core::CodeGenerationFromStrings`.
    /// The process's, so it takes no `VirtualMachine`. C++ does not ask a build that has the
    /// level as a constant (CodeGenerationFromStrings.h).
    #[cfg(not(bun_disallow_code_generation_from_strings))]
    #[unsafe(export_name = "Bun__codeGenerationFromStrings")]
    pub(crate) extern "C" fn code_generation_from_strings_for_cpp() -> u8 {
        bun_core::code_generation_from_strings() as u8
    }

    #[cfg(not(bun_disallow_code_generation_from_strings))]
    #[unsafe(export_name = "Bun__isCodeGenerationDisallowedByTrimming")]
    pub(crate) extern "C" fn is_code_generation_disallowed_by_trimming_for_cpp() -> bool {
        bun_core::is_code_generation_disallowed_by_trimming()
            && bun_core::code_generation_from_strings_by_flags()
                == bun_core::CodeGenerationFromStrings::Allowed
    }

    #[cfg(not(bun_disallow_code_generation_from_strings))]
    #[unsafe(export_name = "Bun__isCodeGenerationDisallowedByCompiledProgram")]
    pub(crate) extern "C" fn is_code_generation_disallowed_by_compiled_program_for_cpp() -> bool {
        bun_core::is_code_generation_disallowed_by_compiled_program()
            && bun_core::code_generation_from_strings_by_flags()
                == bun_core::CodeGenerationFromStrings::Allowed
    }

    #[cfg(not(bun_disallow_code_generation_from_strings))]
    #[unsafe(export_name = "Bun__isCodeGenerationStrictOnlyBesideCompiledProgram")]
    pub(crate) extern "C" fn is_strict_only_beside_compiled_program_for_cpp() -> bool {
        bun_core::is_strict_only_beside_compiled_program()
    }

    #[cfg(not(bun_disallow_code_generation_from_strings))]
    #[unsafe(export_name = "Bun__isCodeGenerationFromStringsStrictByFlags")]
    pub(crate) extern "C" fn is_code_generation_from_strings_strict_by_flags_for_cpp() -> bool {
        bun_core::code_generation_from_strings_by_flags()
            == bun_core::CodeGenerationFromStrings::Strict
    }

    /// Whether `bun:ffi` `cc()` is allowed (`--no-ffi-cc` and `--no-addons` disable it).
    pub fn allow_ffi_cc(&self) -> bool {
        let opts = &self.transpiler().options.transform_options;
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
        self.transpiler()
            .options
            .transform_options
            .unhandled_rejections
            .unwrap_or(UnhandledRejections::Bun)
    }

    /// Returns this VM's libuv event loop handle (must already be initialized).
    pub fn uv_loop(&self) -> &Async::Loop {
        self.event_loop_handle
            .get()
            .expect("libuv event_loop_handle is null")
    }

    /// Whether TLS certificate verification is enforced, from the cached override or the env loader.
    pub fn get_tls_reject_unauthorized(&self) -> bool {
        if let Some(v) = self.default_tls_reject_unauthorized.get() {
            return v;
        }
        self.transpiler().env_mut().get_tls_reject_unauthorized()
    }

    /// The TLS 1.2 list assigned through `tls.DEFAULT_CIPHERS`, `None` when never assigned.
    pub fn tls_default_ciphers(&self) -> Option<std::rc::Rc<[u8]>> {
        self.rare_data.get()?.tls_default_ciphers()
    }

    /// Whether `tls.DEFAULT_CIPHERS` was assigned.
    #[inline]
    pub fn has_tls_default_ciphers(&self) -> bool {
        self.rare_data
            .get()
            .is_some_and(|rare| rare.has_tls_default_ciphers())
    }

    /// Registers a spawned subprocess with the auto-killer.
    pub fn on_subprocess_spawn(&self, process: core::ptr::NonNull<bun_spawn::Process>) {
        self.auto_killer.on_subprocess_spawn(process);
    }

    /// Unregisters an exited subprocess from the auto-killer.
    pub fn on_subprocess_exit(&self, process: core::ptr::NonNull<bun_spawn::Process>) {
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
    pub fn mime_type(&self, str_: &[u8]) -> Option<bun_http::MimeType::MimeType> {
        bun_http::MimeType::by_name_static(str_)
    }

    /// Applies env-derived runtime settings, claims the per-thread source code printer, and adopts `NODE_CHANNEL_FD` for IPC.
    pub fn load_extra_env_and_source_code_printer(&self) {
        let env = self.transpiler().env_mut();
        let map = &env.map;

        ensure_source_code_printer();
        // The runtime VM owns the printer from here on — even if a macro had
        // allocated it first, `__bun_macro_context_deinit` must not free it.
        SOURCE_CODE_PRINTER_FROM_MACRO.set(false);

        if map.get(b"BUN_SHOW_BUN_STACKFRAMES").is_some() {
            self.hide_bun_stackframes.set(false);
        }

        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER::get()
            .unwrap_or(false)
        {
            self.transpiler_store.enabled.set(false);
        }

        // `Loader::load_process` skips these, so read them from the process environment.
        // A worker has no process.send().
        if self.is_main_thread() {
            if let Some(fd_s) = bun_core::env_var::NODE_CHANNEL_FD.get() {
                let advanced = bun_core::env_var::NODE_CHANNEL_SERIALIZATION_MODE
                    .get()
                    .is_some_and(|v| bun_core::strings::eql(v, b"advanced"));
                match bun_core::fmt::parse_int::<i32>(fd_s, 10)
                    .ok()
                    .filter(|&n| n >= 0)
                {
                    Some(fd) => self.pending_ipc.set(Some(PendingIpc {
                        fd: bun_sys::Fd::from_uv(fd),
                        advanced,
                    })),
                    None => bun_core::warn!(
                        "Failed to parse IPC channel number '{}'",
                        bstr::BStr::new(fd_s)
                    ),
                }
            }
        }

        // Node.js checks if this is set to "1" and no other value
        if let Some(value) = map.get(b"NODE_PRESERVE_SYMLINKS") {
            self.transpiler()
                .resolver
                .opts
                .preserve_symlinks
                .set(value == b"1");
        }

        if let Some(gc_level) = map.get(b"BUN_GARBAGE_COLLECTOR_LEVEL") {
            // Reuse this flag for other things to avoid unnecessary hashtable
            // lookups on start for obscure flags which we do not want others to
            // depend on.
            #[cfg(unix)]
            if map.get(b"BUN_FEATURE_FLAG_FORCE_WAITER_THREAD").is_some() {
                bun_spawn::process::WaiterThread::set_should_use_waiter_thread();
            }
            // Only allowed for testing
            if map.get(b"BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING").is_some() {
                ModuleLoader::set_is_allowed_to_use_internal_testing_apis(true);
                bun_resolve_builtins::set_expose_internals_enabled(true);
            }
            if gc_level == b"1" {
                self.aggressive_garbage_collection.set(GCLevel::Mild);
                has_bun_garbage_collector_flag_enabled
                    .store(true, core::sync::atomic::Ordering::Relaxed);
            } else if gc_level == b"2" {
                self.aggressive_garbage_collection.set(GCLevel::Aggressive);
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

    /// Routes an unhandled promise rejection to the configured handler, bumping the unhandled-error counter.
    pub fn unhandled_rejection(
        &self,
        global_object: &JSGlobalObject,
        reason: JSValue,
        promise: JSValue,
    ) {
        // Reported as it happens: it belongs to the context that is current.
        let owner = Bun__ModuleGraph__rejecting(global_object);
        self.unhandled_rejection_owned(global_object, reason, promise, owner);
    }

    /// `owner`: the `Bun.ModuleGraph` in whose context the promise was rejected (its `onError`
    /// takes it), or null. The tracker queue reports after the fact, so it decided when it happened.
    pub fn unhandled_rejection_owned(
        &self,
        global_object: &JSGlobalObject,
        reason: JSValue,
        promise: JSValue,
        owner: JSValue,
    ) {
        use bun_options_types::schema::api::UnhandledRejections as Mode;

        if self.is_shutting_down() || !self.script_allowed() || reason.is_termination_exception() {
            bun_core::debug_warn!("unhandledRejection during shutdown.");
            return;
        }

        if owner.is_cell()
            && Bun__ModuleGraph__handleUnhandledRejection(global_object, reason, owner)
        {
            let _ = self.event_loop().drain_microtasks();
            return;
        }

        if isBunTest.load(core::sync::atomic::Ordering::Relaxed) {
            self.unhandled_error_counter
                .set(self.unhandled_error_counter.get() + 1);
            (self.on_unhandled_rejection.get())(self, global_object, reason);
            return;
        }

        // Each arm drains microtasks on exit — hoisted into a closure.
        let drain = |this: &Self| {
            let _ = this.event_loop().drain_microtasks();
        };
        // Wrapper over the `Bun__handleUnhandledRejection` FFI call (returns
        // whether a JS handler claimed it). Captures `global_object` / `reason`
        // / `promise` so the six branches below stay concise.
        let handle_unhandled =
            || -> bool { Bun__handleUnhandledRejection(global_object, reason, promise) > 0 };
        let emit_warning = |this: &Self| {
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
                    self.exit_handler.exit_code.set(1);
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
                if self.event_loop().drain_microtasks().is_err() {
                    return;
                }
            }
        }
        self.unhandled_error_counter
            .set(self.unhandled_error_counter.get() + 1);
        (self.on_unhandled_rejection.get())(self, global_object, reason);
    }

    /// The promise of the latest load of the entry point. `--hot` looks at it on every tick,
    /// long after it has settled and the module loader has let go of it.
    pub fn pending_internal_promise(&self) -> Option<*mut JSInternalPromise> {
        Some(self.pending_internal_promise.get()?.to_cell()?.cast())
    }

    pub fn set_pending_internal_promise(&self, promise: Option<*mut JSInternalPromise>) {
        match promise {
            Some(promise) => self
                .pending_internal_promise
                .set(self.global(), JSValue::from_cell(promise)),
            None => self.pending_internal_promise.clear_without_deallocation(),
        }
    }

    /// After a hot reload, surfaces the entry-point promise's rejection (if any) and re-arms the watcher.
    pub fn report_exception_in_hot_reloaded_module_if_needed(&self) {
        while let Some(promise) = self.pending_internal_promise() {
            match crate::JSPromise::status_ptr(promise) {
                crate::js_promise::Status::Pending => break,
                crate::js_promise::Status::Rejected => {
                    if self.pending_internal_promise_reported_at.get()
                        != self.hot_reload_counter.get()
                    {
                        self.pending_internal_promise_reported_at
                            .set(self.hot_reload_counter.get());
                        let global_ref = self.global();
                        // `opaque_mut`: the VM's slot keeps this JSC heap cell alive.
                        let result = crate::JSPromise::opaque_mut(promise).result(global_ref.vm());
                        let promise_js = JSValue::from_cell(promise);
                        self.unhandled_rejection(global_ref, result, promise_js);
                        crate::JSPromise::opaque_mut(promise).set_handled();
                    }
                }
                crate::js_promise::Status::Fulfilled => {}
            }

            if !self.hot_reload_deferred.get() {
                break;
            }
            self.reload(None);
            // This reload wasn't started by a task, so run its microtasks here before the loop sleeps.
            self.tick();
        }
        self.add_main_to_watcher_if_needed();
    }

    /// Adds the main entry point to the file watcher when watch mode is enabled.
    pub fn add_main_to_watcher_if_needed(&self) {
        if let Some(main) = self.main() {
            self.add_to_watcher_if_needed(main);
        }
    }

    /// Adds a file that the module loader has not loaded to the file watcher when watch mode is
    /// enabled.
    pub fn add_to_watcher_if_needed(&self, path: &[u8]) {
        if !self.is_watcher_enabled() || path.is_empty() {
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
            let _ = unsafe { (*watcher).add_file_by_path_slow(path) };
        }
    }

    /// `add_to_watcher_if_needed`, for threads that work for this one. `None` unless watch mode is
    /// enabled.
    pub fn watcher_for_threads(&self) -> Option<impl Fn(&[u8]) + Send + Sync + 'static> {
        struct Shared {
            watcher: *mut crate::hot_reloader::ImportWatcher,
            _ticket: crate::Ticket,
        }
        // SAFETY: it carries a `Ticket` for the VM that has the watcher. The pointee is made to be
        // shared with other threads (see `bun_watcher_ptr`).
        unsafe impl Send for Shared {}
        if !self.is_watcher_enabled() {
            return None;
        }
        // One of these threads at a time has the `&mut`.
        let shared = bun_threading::Guarded::new(Shared {
            watcher: self.bun_watcher_ptr(),
            _ticket: self.ticket(),
        });
        Some(move |path: &[u8]| {
            let shared = shared.lock();
            let watcher = shared.watcher;
            // SAFETY: as in `add_to_watcher_if_needed`.
            let _ = unsafe { (*watcher).add_file_by_path_slow(path) };
        })
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
    ///
    /// # Safety
    /// No other reference to the package manager is live when this is called, and none is made
    /// while the returned borrow is.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub unsafe fn package_manager(&self) -> &mut bun_install::PackageManager {
        let pm = self
            .transpiler()
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

    /// Starts the process again with the same arguments, as `--watch` does on a change. Emits the
    /// `--watch-kill-signal` JS handlers first, like node. On Windows, this needs the watcher-manager
    /// parent (`bun_sys::windows::become_watcher_manager`). Returns only when the restart failed and
    /// `may_return` is true; the error is printed.
    pub fn restart_process(&self, may_return: bool) {
        crate::posix_signal_handle::emit_watch_kill_signal_before_reload(self.global());
        let should_clear_terminal = !self
            .env_loader()
            .has_set_no_clear_terminal_on_reload(!bun_core::Output::enable_ansi_colors_stdout());
        // execve will not reach on_exit; flush the compile cache here like
        // node's child does via AtExit(FlushCompileCache) on every restart.
        crate::node_compile_cache::persist_now();
        bun_core::Output::flush();
        bun_removable_features::removable_body!(HotReload, Abort, {
            bun_core::reload_process(should_clear_terminal, may_return);
        });
    }

    /// Performs a hot reload: re-evaluates the entry point once any pending entry-point load settles.
    pub(crate) fn reload(&self, _: Option<&mut crate::hot_reloader::HotReloadTask>) {
        if self.hot_reload.get() == HotReload::Watch {
            // Watch reload replaces the process: never defer on a pending
            // entry promise (node restarts regardless of child state).
            self.restart_process(false);
            unreachable!("reload_process returns only when may_return is true");
        }

        // Reloading while `load_preloads` ticks would clear the list it's iterating.
        if self.is_in_preload.get() {
            self.hot_reload_deferred.set(true);
            return;
        }

        if let Some(p) = self.pending_internal_promise() {
            match crate::JSPromise::status_ptr(p) {
                crate::js_promise::Status::Pending => {
                    self.hot_reload_deferred.set(true);
                    return;
                }
                crate::js_promise::Status::Rejected => {
                    if self.pending_internal_promise_reported_at.get()
                        != self.hot_reload_counter.get()
                    {
                        self.hot_reload_deferred.set(true);
                        return;
                    }
                }
                crate::js_promise::Status::Fulfilled => {}
            }
        }
        self.hot_reload_deferred.set(false);

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
        // An unhandled error stops all timers. The next run starts them again, without those of the failed run.
        // libuv fires timers on Windows, error or not.
        let timers_ran = self.timers_ran_after_error.take() || cfg!(windows);
        let cancel = if self.unhandled_error_counter.take() == 0 {
            CancelHotRunTimers::None
        } else {
            self.hot_run_failed.set(true);
            self.exit_handler.exit_code.set(0);
            if timers_ran {
                CancelHotRunTimers::Intervals
            } else {
                CancelHotRunTimers::All
            }
        };
        if let Some(hooks) = runtime_hooks() {
            (hooks.end_hot_run_timers)(self, cancel);
        }
        self.hot_reload_counter
            .set(self.hot_reload_counter.get() + 1);
        // reload_entry_point() stores into pending_internal_promise whenever it returns a promise.
        if let Err(err) = self.reload_entry_point(self.main.get()) {
            self.reject_failed_reload(err);
        }
    }

    /// Sets the entry promise to a rejected promise when `reload_entry_point` fails without returning one.
    #[cold]
    fn reject_failed_reload(&self, err: crate::CrateError) {
        use crate::LogJsc as _;
        let global = self.global();
        let reason = if global.has_exception() {
            Err(jsc::JsError::Thrown)
        // SAFETY: nothing is transpiling or resolving: no other borrow of the log is live.
        } else if let Some(log) = unsafe { self.log_mut() }.filter(|log| log.has_errors()) {
            let reason = log.to_js(global, format_args!("Failed to reload"));
            log.reset();
            reason
        } else {
            Ok(global.create_error_instance(format_args!(
                "Error occurred loading entry point: {}",
                err.name(),
            )))
        };
        let rejected = match reason {
            Ok(reason) => Ok(crate::JSPromise::rejected_promise(global, reason)),
            Err(thrown) => crate::JSPromise::rejected_promise_with_caught_exception(global, thrown),
        };
        if let Ok(rejected) = rejected {
            // The run loop reports the entry promise's rejection, so keep it out of the unhandled rejection tracker.
            rejected.set_handled();
            self.set_pending_internal_promise(Some(core::ptr::from_mut(rejected)));
        }
    }

    /// `NodeFS` lives in `bun_runtime` (forward-dep on `bun_jsc`), so the
    /// field is stored type-erased and the lazy boxed allocation goes through
    /// [`RuntimeHooks::create_node_fs`]. Callers in `bun_runtime` cast the
    /// returned pointer back to `*mut node::fs::NodeFS`.
    #[inline]
    pub fn node_fs(&self) -> *mut c_void {
        if let Some(existing) = self.node_fs.get() {
            return existing;
        }
        let hooks = runtime_hooks().expect("runtime hooks not installed");
        // The hook boxes a `NodeFS{ vm: self if standalone else null }` and returns
        // the leaked pointer.
        let new = (hooks.create_node_fs)(self);
        self.node_fs.set(Some(new));
        new
    }

    /// Returns the next debugger async-task id, or 0 when no debugger is attached.
    pub(crate) fn next_async_task_id(&self) -> u64 {
        let Some(debugger) = self.debugger.get() else {
            return 0;
        };
        debugger.next_async_task_id()
    }

    /// # Safety
    /// That of [`EventLoop::enqueue_immediate_task`].
    #[inline]
    pub unsafe fn enqueue_immediate_task(&self, task: *mut ()) {
        // SAFETY: fn contract.
        unsafe { self.event_loop().enqueue_immediate_task(task) };
    }

    /// Ticks the event loop until no tasks keep it alive.
    pub fn wait_for_tasks(&self) {
        while self.is_event_loop_alive() {
            self.event_loop().tick();
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
    pub fn init_with_module_graph(
        opts: Options,
        configure: ConfigureTranspiler<'_>,
    ) -> crate::CrateResult<&'static VirtualMachine> {
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
            argv: opts.argv,
            preload: opts.preload,
            ..Default::default()
        };
        let vm = Self::init(init_opts, &mut |transpiler| {
            transpiler.resolver.standalone_module_graph = Some(graph);
            // Avoid reading from tsconfig.json & package.json when in standalone mode
            transpiler.configure_linker_with_auto_jsx(false);
            configure(transpiler);
        })?;
        vm.let_heap_take_initial_module_graph(graph);
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
        configure: ConfigureTranspiler<'_>,
    ) -> crate::CrateResult<&'static VirtualMachine> {
        let init_opts = InitOptions {
            transform_options: opts.args,
            graph: opts.graph,
            log: opts.log,
            env_loader: opts.env_loader,
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
        let vm_ptr = Self::init_unshared(init_opts)?;
        // SAFETY: just made. Nothing below keeps the reference or a pointer made from it.
        let vm = unsafe { &*vm_ptr };
        vm.worker.set(Some(
            std::ptr::from_ref::<crate::web_worker::WebWorker>(worker).cast(),
        ));
        if worker.arm_test_gate() {
            vm.handle.arm_test_gate();
        }
        vm.hot_reload.set(worker.hot_reload());
        vm.initial_script_execution_context_identifier
            .set(worker.execution_context_id() as i32);
        let mut handle = Some(vm.handle());
        // SAFETY: `vm` is not used again.
        Ok(unsafe {
            Self::share(vm_ptr, &mut |transpiler| {
                // The worker's resolver also
                // needs the standalone graph, otherwise embedded `/$bunfs/...` specifiers
                // (e.g. a `new Worker("./worker.ts")` entry point inside a compiled
                // executable) resolve against the real filesystem and fail.
                transpiler.resolver.standalone_module_graph = opts.graph;
                if opts.graph.is_none() {
                    transpiler.configure_linker();
                } else {
                    transpiler.configure_linker_with_auto_jsx(false);
                }
                if let Some(handle) = handle.take() {
                    worker.publish_vm_handle(handle);
                }
                configure(transpiler);
            })
        })
    }

    /// Creates a `VirtualMachine` configured for the bake (dev server) runtime.
    pub fn init_bake(
        opts: Options,
        configure: ConfigureTranspiler<'_>,
    ) -> crate::CrateResult<&'static VirtualMachine> {
        let init_opts = InitOptions {
            transform_options: opts.args,
            log: opts.log,
            env_loader: opts.env_loader,
            smol: opts.smol,
            mini_mode: opts.smol,
            eval_mode: false,
            is_main_thread: opts.is_main_thread,
            argv: opts.argv,
            preload: opts.preload,
            ..Default::default()
        };
        // Note: shares the console / log / event-loop wiring with `init`;
        // the only delta is the global is created via `BakeCreateProdGlobal`
        // instead of `ZigGlobalObject__create`. Route through `init` then
        // swap the global.
        let vm_ptr = Self::init_unshared(init_opts)?;
        // SAFETY: just made. Nothing below keeps the reference or a pointer made from it.
        let vm = unsafe { &*vm_ptr };
        // `console` is the opaque round-trip pointer C++ stores into the new global.
        // SAFETY: freshly created, and lives as long as the VM.
        let new_global: &'static JSGlobalObject =
            unsafe { &*BakeCreateProdGlobal(vm.console.get().cast()) };
        vm.global.set(Some(new_global));
        VMHolder::set_cached_global_object(Some(new_global));
        vm.regular_event_loop.set_global(new_global);
        let jsc_vm = new_global.vm();
        vm.jsc_vm.set(Some(jsc_vm));
        vm.handle.set_jsc_vm(jsc_vm);
        // SAFETY: nothing ticks the loop once `teardown` has destroyed the `JSC::VM`.
        unsafe {
            uws::Loop::get()
                .internal_loop_data
                .set_jsc_vm(core::ptr::from_ref(jsc_vm).cast())
        };
        vm.event_loop().ensure_waker();
        if opts.smol {
            // SAFETY: process-global written once at startup.
            IS_SMOL_MODE.store(true, core::sync::atomic::Ordering::Relaxed);
        }
        // SAFETY: `vm` is not used again.
        Ok(unsafe { Self::share(vm_ptr, configure) })
    }

    /// Stored as [`RefString::on_before_deinit`] (an unsafe-fn-ptr slot) in
    /// [`Self::ref_counted_string`]; only ever invoked from
    /// `RefString::destroy` with the live `*mut RefString` being torn down.
    fn clear_ref_string(_: *mut c_void, ref_string: *mut crate::ref_string::RefString) {
        // SAFETY: only reachable via `RefString::destroy`, which passes the
        // live heap `RefString` allocated in `ref_counted_string`;
        // safe-fn coerces to the unsafe-fn-ptr `Callback` slot type.
        let hash = unsafe { &*ref_string }.hash;
        VirtualMachine::get().ref_strings.remove(hash);
    }

    /// Whether what is made of a file on disk is static code (`ResolvedSource::is_static`). A standalone executable is
    /// stored in itself, so to it a file on disk is not part of the program.
    pub fn is_file_on_disk_static(in_standalone_executable: bool, path: &[u8]) -> bool {
        !in_standalone_executable && !path.starts_with(b"data:")
    }

    /// Builds a `ResolvedSource` backed by a ref-counted copy of `code` interned in the VM's ref-string map.
    pub fn ref_counted_resolved_source(
        &self,
        code: &[u8],
        specifier: &bun_core::String,
        source_url: &[u8],
        hash_: Option<u32>,
    ) -> Result<ResolvedSource, crate::ref_string::StringTooLong> {
        // refCountedString will panic if the code is empty
        if code.is_empty() {
            return Ok(ResolvedSource {
                source_url: specifier.create_if_different(source_url),
                ..Default::default()
            });
        }
        let source = self.ref_counted_string(code, hash_)?;
        // SAFETY: `ref_counted_string` returns a live `RefString` held in
        // `self.ref_strings` until JSC calls the external-string finalizer.
        let source_ref = unsafe { source.as_ref() };

        Ok(ResolvedSource {
            source_code: bun_core::String::retain_wtf_impl(source_ref.impl_),
            source_url: specifier.create_if_different(source_url),
            ..Default::default()
        })
    }

    /// Interns `input_` in the VM's ref-string map and returns the ref-counted entry.
    pub fn ref_counted_string(
        &self,
        input_: &[u8],
        hash_: Option<u32>,
    ) -> Result<NonNull<crate::ref_string::RefString>, crate::ref_string::StringTooLong> {
        use crate::ref_string::{RefString, StringTooLong};
        jsc::mark_binding();
        debug_assert!(!input_.is_empty());
        let hash = hash_.unwrap_or_else(|| RefString::compute_hash(input_));
        let self_ctx = Some(NonNull::from(self).cast::<c_void>());

        match self.ref_strings.get(hash) {
            Some(existing) => Ok(existing),
            None => {
                if input_.len() > bun_core::String::max_length() {
                    return Err(StringTooLong);
                }
                let buf = Box::<[u8]>::from(input_);
                let len = buf.len();
                let ptr = bun_core::heap::into_raw(buf).cast::<u8>().cast_const();
                let ref_ = bun_core::heap::into_raw_nn(Box::new(RefString {
                    ptr,
                    len,
                    hash,
                    // Filled in just below — `create_external` needs the
                    // `*mut RefString` ctx pointer first.
                    impl_: core::ptr::null_mut(),
                    ctx: self_ctx,
                    // Set after `create_external` succeeds. If it fails, it runs `free_ref_string` on a string that is not in the map.
                    on_before_deinit: None,
                }));
                // SAFETY: `ref_` is the unique live `*mut RefString` (just
                // boxed); `(ptr, len)` is its owned latin-1 buffer. The
                // external-string finalizer (`free_ref_string`) is called by
                // WTF on the JS thread when the impl refcount hits zero, with
                // `ref_` as ctx.
                let s = unsafe {
                    bun_core::String::create_external::<*mut RefString>(
                        bun_core::ffi::slice(ptr, len),
                        ref_.as_ptr(),
                        free_ref_string,
                    )
                };
                if s.tag() == bun_core::Tag::Dead {
                    // `create_external` already freed `ref_`.
                    return Err(StringTooLong);
                }
                // SAFETY: `s` owns the impl, so `free_ref_string` has not run
                // and `ref_` is still the unique live `RefString`.
                unsafe {
                    (*ref_.as_ptr()).impl_ = s.leak_wtf_impl();
                    (*ref_.as_ptr()).on_before_deinit = Some(VirtualMachine::clear_ref_string);
                }
                bun_core::handle_oom(self.ref_strings.put(hash, ref_));
                Ok(ref_)
            }
        }
    }

    // Note: `flags` is a runtime arg —
    // `FetchFlags` would need `ConstParamTy` (unstable derive on the enum's
    // owning module) to be a const generic; the only branches are cheap
    // equality tests so the runtime form is fine.
    #[inline(never)]
    pub(crate) fn fetch_without_on_load_plugins(
        jsc_vm: &VirtualMachine,
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
        struct ArenaReset<'a>(&'a VirtualMachine, bool);
        impl Drop for ArenaReset<'_> {
            fn drop(&mut self) {
                if self.1 {
                    ModuleLoader::ModuleLoader::reset_arena(self.0);
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
            path: lr.path,
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

    /// Note: `is_a_file_path` is a runtime
    /// arg to avoid duplicating the body for both monomorphizations.
    pub(crate) fn _resolve<'r>(
        &self,
        ret: &mut ResolveFunctionResult<'r>,
        specifier: &'r [u8],
        source: &[u8],
        is_esm: bool,
        is_a_file_path: bool,
        global_cache: bun_resolver::GlobalCache,
    ) -> crate::CrateResult<()> {
        use bun_js_parser::Macro;
        use bun_resolver::{ResultUnion, node_fallbacks};

        // `Runtime.Runtime.Imports.{alt_name, Name}` are both `"bun:wrap"`
        // (see js_parser/runtime.rs).
        if bun_paths::basename(specifier) == b"bun:wrap" {
            ret.path = b"bun:wrap";
            return Ok(());
        }
        if specifier == MAIN_FILE_NAME && self.entry_point.generated {
            ret.path = MAIN_FILE_NAME;
            return Ok(());
        }
        if specifier.starts_with(Macro::NAMESPACE_WITH_COLON) {
            ret.path = specifier;
            return Ok(());
        }
        if specifier.starts_with(node_fallbacks::IMPORT_PATH) {
            ret.path = specifier;
            return Ok(());
        }
        if let Some(result) = ModuleLoader::HardcodedModule::Alias::get(
            specifier,
            bun_ast::Target::Bun,
            Default::default(),
        ) {
            ret.path = result.path.as_bytes();
            return Ok(());
        }
        if self.module_loader.eval_source().is_some()
            && (specifier.ends_with(bun_paths::path_literal!("/[eval]").as_bytes())
                || specifier.ends_with(bun_paths::path_literal!("/[stdin]").as_bytes()))
        {
            ret.path = specifier;
            return Ok(());
        }
        if let Some(blob_id) = specifier.strip_prefix(b"blob:".as_slice()) {
            // `WebCore.ObjectURLRegistry` lives in `bun_runtime`; routed
            // through [`RuntimeHooks::has_blob_url`].
            let has = runtime_hooks()
                .map(|h| (h.has_blob_url)(blob_id))
                .unwrap_or(false);
            if has {
                ret.path = specifier;
                return Ok(());
            }
            return Err(crate::CrateError::ModuleNotFound);
        }

        let is_special_source = source == MAIN_FILE_NAME || Macro::is_macro_path(source);
        let mut query_string: &[u8] = b"";
        let normalized_specifier = normalize_specifier_for_resolution(specifier, &mut query_string);
        let top_level_dir = self.top_level_dir();
        let mut source_to_use: &[u8] = if !is_special_source {
            if is_a_file_path {
                bun_resolver::fs::PathName::init(source).dir_with_trailing_slash()
            } else {
                source
            }
        } else {
            top_level_dir
        };

        // A `loop`
        // returning the resolver result; `retry_on_not_found` is consumed on
        // the first miss.
        let mut retry_on_not_found = bun_paths::is_absolute(source_to_use);
        let mut may_retry_from_root = self.finds_entry_points_by_path && !is_special_source;
        let result: bun_resolver::Result = loop {
            let import_kind = if is_esm {
                bun_ast::ImportKind::Stmt
            } else {
                bun_ast::ImportKind::Require
            };
            match self.transpiler().resolver.resolve_and_auto_install(
                source_to_use,
                normalized_specifier,
                import_kind,
                global_cache,
            ) {
                ResultUnion::Success(r) => break r,
                ResultUnion::Failure(e) => return Err(e.into()),
                ResultUnion::Pending(_) | ResultUnion::NotFound => {
                    if core::mem::take(&mut may_retry_from_root)
                        && let Some(root) = self
                            .standalone_module_graph
                            .map(|graph| graph.base_public_path_with_default_suffix())
                            .filter(|root| !source_to_use.starts_with(root))
                    {
                        source_to_use = root;
                        retry_on_not_found = true;
                        continue;
                    }
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
                    if bun_resolver::bust_dir_cache(
                        bun_paths::string_paths::without_trailing_slash_windows_path(buster_name),
                    ) {
                        continue;
                    }
                    return Err(crate::CrateError::ModuleNotFound);
                }
            }
        };

        if !self.macro_mode() {
            self.has_any_macro_remappings.set(
                self.has_any_macro_remappings.get()
                    || self.transpiler().options.macro_remap.count() > 0,
            );
        }
        ret.query_string = query_string;
        let result_path = result
            .path_const()
            .ok_or(crate::CrateError::ModuleNotFound)?;
        ret.path = result_path.text;
        if self.finds_entry_points_by_path
            && let Some(entry) = crate::compiled_program::find_entry_point_by_source_path(ret.path)
        {
            ret.path = crate::compiled_program::module_key(entry);
        }

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
        if global.has_plugins() {
            match run_on_resolve(global, specifier, source)? {
                None => {}
                Some(Err(error)) => return Ok(Err(error)),
                Some(Ok(answer)) => {
                    if let Some(name) = global.resolve_virtual_module(&answer, source) {
                        return Ok(Ok(name));
                    }
                    // A bare name may be a package's in the registry. It is the plugin's own, and not
                    // installed, if `onResolve` answers about it as well.
                    let answer_utf8 = answer.to_utf8();
                    let is_bare = bun_resolver::is_package_path(&answer_utf8)
                        && ModuleLoader::plugin_namespace_and_path(&answer_utf8)
                            .is_some_and(|(namespace, _)| namespace.is_empty());
                    drop(answer_utf8);
                    let is_own = is_bare
                        && (answer.eql(specifier)
                            || match run_on_resolve(global, &answer, source)? {
                                None => false,
                                Some(Ok(_)) => true,
                                Some(Err(error)) => return Ok(Err(error)),
                            });
                    let global_cache = if is_own {
                        bun_resolver::GlobalCache::disable
                    } else {
                        global.bun_vm().transpiler().resolver.opts.global_cache
                    };
                    let resolved = Self::resolve_without_on_resolve::<IS_A_FILE_PATH>(
                        global,
                        &answer,
                        source,
                        query_string,
                        mode,
                        global_cache,
                    )?;
                    // Not on disk, for an `onLoad` to serve.
                    if resolved.is_err() && global.has_on_load(&answer.to_utf8())? {
                        return Ok(Ok(answer));
                    }
                    return Ok(resolved);
                }
            }
        }
        Self::resolve_without_on_resolve::<IS_A_FILE_PATH>(
            global,
            specifier,
            source,
            query_string,
            mode,
            global.bun_vm().transpiler().resolver.opts.global_cache,
        )
    }

    fn resolve_without_on_resolve<const IS_A_FILE_PATH: bool>(
        global: &JSGlobalObject,
        specifier: &bun_core::String,
        source: &bun_core::String,
        query_string: Option<&mut bun_core::String>,
        mode: ResolveMode,
        global_cache: bun_resolver::GlobalCache,
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
        let jsc_vm = global.bun_vm();

        // Bare/`node:` builtins: answer from the alias table before paying for UTF-8 copies and the resolver.
        // (Alias names are ASCII, so the Latin-1 bytes are the UTF-8 bytes whenever they can match.)
        let has_plugins = global.has_plugins();
        if !has_plugins && specifier.is_8bit() {
            if let Some(hardcoded) = ModuleLoader::HardcodedModule::Alias::get(
                specifier.latin1(),
                bun_ast::Target::Bun,
                Default::default(),
            ) {
                return Ok(Ok(
                    if mode == ResolveMode::RequireResolve && hardcoded.node_builtin {
                        specifier.clone()
                    } else {
                        bun_core::String::static_(hardcoded.path.as_bytes())
                    },
                ));
            }
        }

        let specifier_utf8 = specifier.to_utf8();
        let source_utf8 = source.to_utf8();

        if let Some(hardcoded) = ModuleLoader::HardcodedModule::Alias::get(
            specifier_utf8.slice(),
            bun_ast::Target::Bun,
            Default::default(),
        ) {
            return Ok(Ok(
                if mode == ResolveMode::RequireResolve && hardcoded.node_builtin {
                    specifier.clone()
                } else {
                    bun_core::String::static_(hardcoded.path.as_bytes())
                },
            ));
        }

        // Node's `--expose-internals`.
        if ModuleLoader::exposed_internal_tag(specifier_utf8.slice()).is_some() {
            return Ok(Ok(specifier.clone()));
        }

        // (One letter is a Windows drive.)
        if has_plugins
            && ModuleLoader::plugin_namespace_and_path(&specifier_utf8)
                .is_some_and(|(namespace, _)| namespace.len() > 1)
            && global.has_on_load(&specifier_utf8)?
        {
            return Ok(Ok(specifier.clone()));
        }

        // Swap in a fresh log so resolver errors don't pollute the VM's main log.
        // `vm.log` is set unconditionally in `init` and never cleared,
        // so the `Option` is purely a
        // zeroed-init nicety; the `expect` is infallible.
        let old_log: NonNull<bun_ast::Log> = jsc_vm.log.get().expect("vm.log set in init");
        let old_transpiler_log: *mut bun_ast::Log = jsc_vm.transpiler().log_ptr();
        let mut log = bun_ast::Log::default();
        jsc_vm.log.set(NonNull::new(&raw mut log));
        // SAFETY: `_restore`, declared after `log`, takes the pointer out again before `log`
        // drops. This function reads `log` only after `_resolve` has returned.
        unsafe { jsc_vm.transpiler().set_log(&raw mut log) };
        if let Some(pm) = jsc_vm.transpiler().resolver.package_manager.get() {
            // SAFETY: the `dyn AutoInstaller` is always `PackageManager`
            // (sole impl — see `VirtualMachine::package_manager`).
            unsafe { (*pm.cast::<bun_install::PackageManager>().as_ptr()).log = &raw mut log };
        }
        // Note: the restore must fire on every exit
        // (including `?` from `ResolveMessage::create` below), so the VM's
        // `log` cannot be left pointing at the dropped stack `log`.
        struct RestoreLog<'a> {
            vm: &'a VirtualMachine,
            old_log: NonNull<bun_ast::Log>,
            old_transpiler_log: *mut bun_ast::Log,
        }
        impl Drop for RestoreLog<'_> {
            fn drop(&mut self) {
                let jsc_vm = self.vm;
                jsc_vm.log.set(Some(self.old_log));
                let transpiler = jsc_vm.transpiler();
                // SAFETY: what whoever installed them promised holds again: both logs were in
                // use when this function was called, and their owners have not returned.
                unsafe {
                    transpiler.set_log(self.old_transpiler_log);
                    transpiler.resolver.set_log(self.old_log);
                    transpiler.linker.set_log(self.old_log.as_ptr());
                }
                // `_resolve` may have lazily created the PM with
                // `pm.log = resolver.log` (our stack `log`), so restore even
                // if it was `None` when we swapped.
                if let Some(pm) = jsc_vm.transpiler().resolver.package_manager.get() {
                    // SAFETY: sole `dyn AutoInstaller` impl is `PackageManager`.
                    unsafe {
                        (*pm.cast::<bun_install::PackageManager>().as_ptr()).log =
                            self.old_log.as_ptr();
                    }
                }
            }
        }
        let _restore = RestoreLog {
            vm: jsc_vm,
            old_log,
            old_transpiler_log,
        };

        let resolve_result = jsc_vm._resolve(
            &mut result,
            specifier_utf8.slice(),
            normalize_source(source_utf8.slice()),
            mode.is_esm(),
            IS_A_FILE_PATH,
            global_cache,
        );
        if let Err(err) = resolve_result {
            let import_kind = mode.import_kind();
            // Find a `.resolve`-metadata msg if the log has one.
            let resolve_msg_index = log
                .msgs
                .iter()
                .position(|m| matches!(m.metadata, bun_ast::Metadata::Resolve(_)));
            let mut msg = match resolve_msg_index {
                Some(i) => log.msgs[i].clone(),
                None => {
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
                }
            };
            // `log` dies with this frame. Deduplicated: `_resolve`'s retry can log a failure twice.
            let mut notes = core::mem::take(&mut msg.notes).into_vec();
            for (i, logged) in log.msgs.iter().enumerate() {
                if Some(i) == resolve_msg_index
                    || !matches!(logged.kind, bun_ast::Kind::Err | bun_ast::Kind::Warn)
                    || notes.iter().any(|note| note.text == logged.data.text)
                {
                    continue;
                }
                notes.push(logged.data.clone());
            }
            msg.notes = notes.into_boxed_slice();
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
    /// Frees what the VM owns. Its storage is `dealloc`'d raw afterwards (a worker's) or left to
    /// process exit, so no field's `Drop` runs.
    ///
    /// # Safety
    /// Runs once on this thread's VM, after its last use ([`teardown`](Self::teardown)'s last
    /// step); nothing borrowed from what is freed here is used again.
    pub unsafe fn destroy() {
        let vm = Self::get();
        vm.regular_event_loop.deinit();
        vm.macro_event_loop.deinit();
        // The VM's own clone of its handle; the shared inner is freed when the
        // last outside holder (C++ client data, a late poster) lets go.
        // SAFETY: the field is not used afterwards.
        drop(unsafe { core::ptr::read(&raw const *vm.handle) });

        vm.auto_killer.clear();

        // A graph context whose release was still queued: teardown stopped what it owned.
        for context in vm.graph_contexts.take().values() {
            // SAFETY: registered ⇒ live and owned here.
            drop(unsafe { Box::from_raw(context.as_ptr()) });
        }
        drop_source_code_printer();

        vm.source_mappings.clear();

        if let Some(hooks) = runtime_hooks() {
            (hooks.stop_cron_for_vm_teardown)(vm);
        }
        // The `OnceCell`s below are cells through and through, so `vm`'s own borrow reaches them
        // for writes, and it stays usable afterwards.
        // SAFETY: fn contract: no `&RareData` is live.
        if let Some(rare) = unsafe { (*(&raw const vm.rare_data).cast_mut()).take() } {
            // Paired with `rare_data()`'s register_root_region. Without this,
            // every terminated Worker leaves a stale LSAN root entry pointing
            // into a freed arena.
            bun_core::asan::unregister_root_region(
                core::ptr::from_ref::<RareData>(&*rare).cast(),
                core::mem::size_of::<RareData>(),
            );
            drop(rare);
        }

        *vm.proxy_env_storage.lock() = Default::default();

        // SAFETY: fn contract: nothing borrowed from it is live.
        drop(unsafe { core::mem::take(&mut *(&raw const vm.module_loader).cast_mut()) });

        drop(vm.preload.take());

        // Neither is a cell, so they are reached through the VM's own pointer, with no
        // `&VirtualMachine` live.
        let this = VM.get().expect("this thread has a VM");
        // SAFETY: fn contract: nothing borrowed from either is live. No field `Drop` follows
        // `deinit`.
        unsafe {
            core::ptr::drop_in_place(&raw mut (*this).argv);
            (*this).transpiler.deinit();
        }
        let vm = Self::get();

        drop(vm.main_resolved_path.take());
        drop(vm.sampling_profiler_directory.take());

        vm.overridden_main.deinit();
        vm.bake_config_plugins.deinit();
        vm.bake_framework.deinit();
        vm.pending_internal_promise.deinit();

        // `timer`/`entry_point` live in the high-tier `RuntimeState` box, so
        // dispatch the reclaim through the hook.
        if let Some(hooks) = runtime_hooks() {
            let state = vm
                .runtime_state
                .swap(core::ptr::null_mut(), core::sync::atomic::Ordering::Relaxed);
            // SAFETY: hook contract — `state` is exactly the pointer
            // `init_runtime_state` returned for this VM (or null), handed back
            // once on the same thread.
            unsafe { (hooks.deinit_runtime_state)(state) };
        }
    }
    /// Note: takes the concrete
    /// `bun_core::io::Writer` since every call site passes
    /// `Output.errorWriterBuffered()`.
    pub fn print_exception(
        &self,
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
    pub fn clear_entry_point(&self) -> JsResult<()> {
        if self.main().is_none() {
            return Ok(());
        }
        let str = bun_core::EncodedSlice::latin1(MAIN_FILE_NAME);
        self.global().delete_module_registry_entry(&str)
    }

    /// Whether the per-test-isolation source provider cache is active.
    #[unsafe(export_name = "Bun__VM__useIsolationSourceProviderCache")]
    pub extern "C" fn use_isolation_source_provider_cache(&self) -> bool {
        self.test_isolation_enabled.get()
            && !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_ISOLATION_SOURCE_CACHE::get()
                .unwrap_or(false)
    }

    /// Resets entry-point state and re-loads `entry_path` for the test runner, returning the load promise.
    pub(crate) fn reload_entry_point_for_test_runner(
        &self,
        entry_path: &'static [u8],
    ) -> crate::CrateResult<*mut JSInternalPromise> {
        let entry_path = crate::compiled_program::entry_module_key(entry_path);
        self.has_loaded.set(
            crate::compiled_program::runs_in_place()
                && crate::compiled_program::is_compiled_module(entry_path),
        );
        self.set_main(Some(entry_path));
        self.main_resolved_path.set(bun_core::String::EMPTY);
        self.overridden_main.deinit();

        self.event_loop().ensure_waker();

        let _ = self.ensure_debugger(true);

        if !self.transpiler().options.disable_transpilation {
            if let Some(hooks) = runtime_hooks() {
                // SAFETY: this does not borrow it, and nor do the callers: they are about to
                // run the entry point, which transpiles.
                let p = unsafe { (hooks.load_preloads)(self) }?;
                if !p.is_null() {
                    self.set_pending_internal_promise(Some(p));
                    return Ok(p);
                }
            }
        }

        let main = (self.main()).expect("set to the test file above");
        let main_str = bun_core::StringView::from_bytes(main);
        let promise = match jsc::JSModuleLoader::resolve_and_load_and_evaluate_module_ptr(
            self.global(),
            &main_str,
        ) {
            Some(promise) => promise.as_ptr(),
            // Not resolving is this file's failure, like not loading.
            None => {
                let rejected = crate::JSPromise::rejected_promise_with_caught_exception(
                    self.global(),
                    jsc::JsError::Thrown,
                )?;
                // Like the loader's: whoever loads the file reports it, not the rejection tracker.
                rejected.set_handled();
                std::ptr::from_mut(rejected)
            }
        };
        self.set_pending_internal_promise(Some(promise));
        Ok(promise)
    }

    /// Load a worker's entry: fetch and link its module graph and begin
    /// evaluating it. Returns once evaluation has begun (or the load failed) —
    /// the promise may still be pending on a top-level await, which then
    /// continues in the worker's normal event loop, as in Node.
    pub(crate) fn load_entry_point_for_web_worker(
        &self,
        entry_path: &'static [u8],
    ) -> crate::CrateResult<*mut JSInternalPromise> {
        let promise = self.reload_entry_point(Some(entry_path))?;
        self.event_loop()
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
        &self,
        entry_path: &'static [u8],
    ) -> crate::CrateResult<*mut JSInternalPromise> {
        let promise = self.reload_entry_point_for_test_runner(entry_path)?;

        // pending_internal_promise can change if hot module reloading is enabled
        if self.is_watcher_enabled() {
            loop {
                let Some(p) = self.pending_internal_promise() else {
                    break;
                };
                if crate::JSPromise::status_ptr(p) != crate::js_promise::Status::Pending {
                    break;
                }
                self.event_loop().tick();
                let Some(p) = self.pending_internal_promise() else {
                    break;
                };
                if crate::JSPromise::status_ptr(p) == crate::js_promise::Status::Pending {
                    self.auto_tick();
                }
            }
        } else {
            if crate::JSPromise::status_ptr(promise) == crate::js_promise::Status::Rejected {
                return Ok(promise);
            }
            let _ = self.wait_for_promise(jsc::AnyPromise::Internal(promise));
        }

        // Pre-arm the waker so this settled-promise tick cannot park (#36450).
        self.wakeup();
        self.auto_tick();
        Ok(self.pending_internal_promise().unwrap())
    }

    /// `bun test --isolate`: `cwd` is what a file's first `process.chdir()` left.
    pub fn save_cwd_for_test_isolation(&self, cwd: Box<[u8]>) {
        if self.test_isolation_enabled.get() {
            let saved = &self.test_isolation_state.saved_cwd;
            saved.set(Some(saved.take().unwrap_or(cwd)));
        }
    }

    pub fn set_process_cwd(&self, to: &bun_core::ZStr) -> bun_sys::Result<()> {
        let fs = self.fs();
        bun_sys::chdir(to)?;
        let mut buf = bun_paths::path_buffer_pool::get();
        let mut len = match bun_sys::getcwd(&mut buf[..]) {
            bun_sys::Result::Ok(r) => r,
            bun_sys::Result::Err(err) => {
                let mut rollback = bun_paths::path_buffer_pool::get();
                let _ = bun_sys::chdir(bun_paths::resolve_path::z(
                    fs.top_level_dir(),
                    &mut rollback,
                ));
                return bun_sys::Result::Err(err);
            }
        };
        if len > 0 && buf[len - 1] != bun_paths::SEP && len < buf.len() {
            buf[len] = bun_paths::SEP;
            len += 1;
        }
        fs.set_top_level_dir(Self::intern_cwd(fs, &buf[..len]));
        Ok(())
    }

    /// Returns a `'static` copy of `cwd`. Other threads keep slices of the cwd, so a published one
    /// is never overwritten or freed.
    fn intern_cwd(fs: &bun_resolver::fs::FileSystem, cwd: &[u8]) -> &'static [u8] {
        static CACHE: bun_core::Mutex<Option<bun_collections::HashMap<&'static [u8], ()>>> =
            bun_core::Mutex::new(None);
        let mut cache = CACHE.lock();
        let cache = cache.get_or_insert_default();
        if let Some((&interned, ())) = cache.get_key_value(cwd) {
            return interned;
        }
        let interned = bun_core::handle_oom(fs.dirname_store().append(cwd));
        cache.insert(interned, ());
        interned
    }

    /// Whether `group` outlives a test file under `--isolate`: the spawn-IPC pool (this process's
    /// own inbound IPC included) and the test-parallel channel.
    fn is_test_runner_socket_group(&self, group: *const uws::SocketGroup) -> bool {
        self.rare_data.get().is_some_and(|rare| {
            core::ptr::eq(group, &raw const rare.spawn_ipc_group)
                || core::ptr::eq(group, &raw const rare.test_parallel_ipc_group)
        })
    }

    /// One sweep over the sockets a test file opened. What a close handler opens meanwhile stays open.
    fn close_test_file_sockets(&self) {
        let data = &uws::Loop::get().internal_loop_data;
        // A close handler may unlink any group, and its owner then free it.
        data.start_group_walk();
        while let Some(group) = data.next_group_of_walk() {
            // SAFETY: linked in the loop, so alive until a close handler unlinks it; not used
            // after `close_all`.
            let group = unsafe { group.as_ref() };
            if !self.is_test_runner_socket_group(group) {
                group.close_all();
            }
        }
    }

    /// A group is linked into the loop while it has a socket.
    fn has_test_file_sockets(&self) -> bool {
        let mut maybe_group = uws::Loop::get().internal_loop_data.first_group();
        while let Some(group) = NonNull::new(maybe_group) {
            if !self.is_test_runner_socket_group(group.as_ptr()) {
                return true;
            }
            // SAFETY: `group` is a live `us_socket_group_t` linked in the loop.
            maybe_group = unsafe { group.as_ref() }.next();
        }
        false
    }

    /// Replaces the global object between test files so each file runs in a fresh realm.
    ///
    /// Callers must run `bun_runtime::jsc_hooks::stop_active_handles_for_test_isolation(vm)`
    /// first so leaked watchers/servers are stopped while their close handlers
    /// can still run (dropping their JS-side Strongs, which otherwise pin the
    /// outgoing global) before the blind socket-group close below. It also
    /// resets the high tier's fake-timer state, which this crate cannot reach.
    pub fn swap_global_for_test_isolation(&self) {
        debug_assert!(self.test_isolation_enabled.get());

        // The finished file's workers, ports, channels and sockets are stopped
        // first (no events dispatched), before its socket groups and timers are
        // swept and before the new global exists.
        Zig__GlobalObject__stopActiveDOMObjectsForTestIsolation(self.global());

        if let Some(cwd) = self.test_isolation_state.saved_cwd.take() {
            let mut buf = bun_paths::path_buffer_pool::get();
            let z = bun_paths::resolve_path::z(&cwd, &mut buf);
            let _ = self.set_process_cwd(z);
        }

        let _ = self.event_loop().drain_microtasks();

        // The finished file's close handlers run, and may dial again.
        self.close_test_file_sockets();
        if let Some(rare) = self.rare_data.get() {
            // `setCallbacks` is once-only (node/src/quic/bindingdata.cc
            // `BindingData::SetCallbacks`), so a holder left by the outgoing
            // global makes the next file's call a no-op and dispatches
            // node:quic events into the dead realm.
            rare.node_quic_callbacks.deinit();
        }
        let _ = self.event_loop().drain_microtasks();

        let _ = self.auto_killer.kill();
        self.auto_killer.clear();

        // The outgoing file's exit: work it left in flight (thread-pool jobs,
        // the children just killed) lands later and must not resume its script.
        Zig__GlobalObject__retireForTestIsolation(self.global());
        // What the outgoing file's close handlers and last microtasks opened
        // since the caller's sweep.
        let _ = self.stop_context_handles(crate::StopReason::Disposed);
        // Nothing enters its script now, so no close handler dials again: this sweep leaves no socket.
        self.close_test_file_sockets();
        debug_assert!(!self.has_test_file_sockets());
        self.test_isolation_generation
            .set(self.test_isolation_generation.get().wrapping_add(1));

        // The outgoing file's JS timers would otherwise release their pins only
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
            (hooks.cancel_timers)(self, None);
        }

        self.overridden_main.deinit();
        self.entry_point_result.value.deinit();
        self.entry_point_result.cjs_set_value.set(false);
        self.entry_point_result.evaluated_as_cjs.set(false);
        self.set_pending_internal_promise(None);
        self.has_patched_run_main.set(false);
        self.set_main(None);
        self.main_resolved_path.set(bun_core::String::EMPTY);
        self.unhandled_error_counter.set(0);

        // Loaded macros are functions of the outgoing realm. The macro context
        // remembers which ones are loaded, so the next file loads its own.
        let mut i = 0;
        while let Some(callback) = self.macros.value_at(i) {
            callback.unprotect();
            i += 1;
        }
        self.macros.clear_retaining_capacity();
        if let Some(ctx) = self.transpiler().macro_context.take() {
            // SAFETY: the test runner calls this between files, with no parse in progress, so no
            // copy of the handle is left.
            unsafe { ctx.deinit() };
        }

        let old_global = self.global();
        // SAFETY: freshly created, and lives until the next swap retires it.
        let new_global: &'static JSGlobalObject = unsafe {
            &*JSGlobalObject::create_for_test_isolation(old_global, self.console.get().cast())
        };
        self.global.set(Some(new_global));
        VMHolder::set_cached_global_object(Some(new_global));
        self.regular_event_loop.set_global(new_global);
        self.macro_event_loop.set_global(new_global);
        if let Some(rare) = self.rare_data.get() {
            let mut i = 0;
            while let Some(mut hook) = rare.cleanup_hooks.get(i) {
                if core::ptr::eq(hook.global_this, old_global) {
                    hook.global_this = new_global;
                    rare.cleanup_hooks.set_at(i, hook);
                }
                i += 1;
            }
        }

        self.undo_process_env_side_effects();
        self.undo_synthetic_allocation_limit();
    }

    /// `setSyntheticAllocationLimitForTesting` lowers a process-wide limit.
    /// Put the startup value back so a file's limit stays with that file.
    fn undo_synthetic_allocation_limit(&self) {
        if let Some(limit) = self.test_isolation_state.synthetic_allocation_limit.get() {
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
    fn undo_process_env_side_effects(&self) {
        self.default_tls_reject_unauthorized.set(None);
        self.default_verbose_fetch.set(None);
        if let Some(tz) = self.test_isolation_state.time_zone.get() {
            let _ = self
                .global()
                .set_time_zone(&bun_core::EncodedSlice::from_bytes(tz));
        }
        if let Some(snapshot) = self.test_isolation_state.proxy_env.get() {
            let mut slots = self.proxy_env_storage.lock();
            slots.restore(&mut self.transpiler().env_mut().map, snapshot);
        }
    }

    /// Loads and evaluates a macro entry module, waiting for its promise.
    #[inline]
    pub(crate) fn _load_macro_entry_point(
        &self,
        entry_path: &[u8],
    ) -> Option<*mut JSInternalPromise> {
        let path_str = bun_core::StringView::from_bytes(entry_path);
        let promise =
            jsc::JSModuleLoader::load_and_evaluate_module_ptr(self.global(), &path_str)?.as_ptr();
        let _ = self.wait_for_promise(jsc::AnyPromise::Internal(promise));
        Some(promise)
    }

    /// Prints an error-like JS value to the console via the error handler.
    pub fn print_error_like_object_to_console(&self, value: JSValue) {
        self.run_error_handler(value, None);
    }

    /// Note: takes runtime bools and the concrete `bun_core::io::Writer`.
    pub fn print_errorlike_object(
        &self,
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
            let members_past_cap =
                formatter.depth.saturating_add(1) > formatter.error_chain_max_depth();
            if members_past_cap {
                self.print_error_from_maybe_private_data(
                    value,
                    exception_list.as_deref_mut(),
                    formatter,
                    writer,
                    allow_ansi_color,
                    allow_side_effects,
                );
            }
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
                let vm = VirtualMachine::get();
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
                formatter.depth = formatter.depth.saturating_add(1);
                if next_value.is_cell()
                    && next_value.js_type() == crate::JSType::ErrorInstance
                    && formatter.visited_contains(next_value)
                {
                    let _ = if ctx.allow_ansi_color {
                        writer.write_all(
                            bun_core::pretty_fmt!("<r><cyan>[Circular]<r>\n", true).as_bytes(),
                        )
                    } else {
                        writer.write_all(
                            bun_core::pretty_fmt!("<r><cyan>[Circular]<r>\n", false).as_bytes(),
                        )
                    };
                } else if formatter.depth > formatter.error_chain_max_depth()
                    || !formatter.stack_check.is_safe_to_recurse()
                {
                    let _ = if ctx.allow_ansi_color {
                        writer.write_all(
                            bun_core::pretty_fmt!("<r><cyan>[Error ...]<r>\n", true).as_bytes(),
                        )
                    } else {
                        writer.write_all(
                            bun_core::pretty_fmt!("<r><cyan>[Error ...]<r>\n", false).as_bytes(),
                        )
                    };
                } else {
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
                formatter.depth = formatter.depth.saturating_sub(1);
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
            if ctx.printed_member || members_past_cap {
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
                let zig_exception: &mut ZigException<'_> = holder.zig_exception();
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
        &self,
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
                    if self.had_errors.get() {
                        let _ = writer.write_all(b"\n");
                    }
                    write_msg!(build_error.msg, writer, allow_ansi_color);
                    build_error.logged.set(true);
                    let _ = writer.write_all(b"\n");
                }
                self.had_errors
                    .set(self.had_errors.get() || build_error.msg.kind == bun_ast::Kind::Err);
                if exception_list.is_some() {
                    // SAFETY: no other borrow of the log is live in this statement.
                    if let Some(log) = unsafe { self.log_mut() } {
                        let _ = log.add_msg(build_error.msg.clone());
                    }
                }
                bun_core::Output::flush();
                return true;
            } else if let Some(resolve_error) = value.as_class_ref::<crate::ResolveMessage>() {
                if !resolve_error.logged.get() {
                    if self.had_errors.get() {
                        let _ = writer.write_all(b"\n");
                    }
                    write_msg!(resolve_error.msg, writer, allow_ansi_color);
                    resolve_error.logged.set(true);
                    let _ = writer.write_all(b"\n");
                }
                self.had_errors
                    .set(self.had_errors.get() || resolve_error.msg.kind == bun_ast::Kind::Err);
                if exception_list.is_some() {
                    // SAFETY: no other borrow of the log is live in this statement.
                    if let Some(log) = unsafe { self.log_mut() } {
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
        let jsc_vm = global_object.bun_vm();
        let _ = jsc_vm.uncaught_exception(global_object, exception.value(), false);
        JSValue::UNDEFINED
    }

    /// Note: takes a runtime bool + concrete writer.
    pub(crate) fn print_stack_trace(
        writer: &mut bun_core::io::Writer,
        trace: &crate::ZigStackTrace<'_>,
        allow_ansi_colors: bool,
    ) -> crate::CrateResult<()> {
        use crate::zig_stack_frame::LineColumn;
        let stack = trace.frames();
        if stack.is_empty() {
            return Ok(());
        }
        let vm = VirtualMachine::get();
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

    /// The heap collector thread calls this too, so it takes no `&VirtualMachine`.
    ///
    /// # Safety
    /// `this` is a live VM. `frames` must point to `frames_count` initialized `ZigStackFrame`s.
    pub unsafe fn remap_stack_frame_positions(
        this: *const Self,
        frames: *mut crate::ZigStackFrame<'_>,
        frames_count: usize,
    ) {
        if frames_count == 0 {
            return;
        }
        // SAFETY: fn contract. The first two are `Sync`; nothing writes the third after `init`.
        let (mutex, source_mappings, in_standalone_executable) = unsafe {
            (
                &(*this).remap_stack_frames_mutex,
                &(*this).source_mappings,
                (*this).standalone_module_graph.is_some(),
            )
        };
        let _lock = mutex.lock_guard();

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
            let resolved = {
                let source_url = frame.source_url.to_utf8();
                Self::resolve_source_mapping_in(
                    source_mappings,
                    in_standalone_executable,
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
                    frame.source_url = source_url.into();
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
        }
    }

    /// Fills `exception` from `error_instance`, remapping stack frames through source maps.
    /// `source_code` receives the text that `exception`'s source lines borrow.
    pub(crate) fn remap_zig_exception<'a>(
        &self,
        exception: &mut ZigException<'a>,
        error_instance: JSValue,
        exception_list: Option<&mut ExceptionList>,
        must_reset_parser_arena_later: &mut bool,
        source_code: &'a mut bun_core::Utf8Bytes<'static>,
        allow_source_code_preview: bool,
    ) {
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
        struct Tail<'t, 'a> {
            this: &'t VirtualMachine,
            exception: *mut ZigException<'a>,
            exception_list: Option<&'t mut ExceptionList>,
            enable_source_code_preview: &'t Cell<bool>,
        }
        impl Drop for Tail<'_, '_> {
            fn drop(&mut self) {
                let this = self.this;
                // SAFETY: `self.exception` is the caller's stack
                // `ZigException`, live for the guard scope; no overlap at drop.
                let exception = unsafe { &mut *self.exception };
                #[cfg(debug_assertions)]
                {
                    let preview = self.enable_source_code_preview.get();
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
                    let _ = self.enable_source_code_preview;
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
        };
        // SAFETY: re-borrow through the guard's raw ptrs; `_tail` does not
        // touch them until Drop, so no aliasing during the body.
        let exception: &mut ZigException<'a> = unsafe { &mut *_tail.exception };

        fn is_noisy_builtin(name: &bun_core::String) -> bool {
            name.eq_ascii(b"asyncModuleEvaluation")
                || name.eq_ascii(b"link")
                || name.eq_ascii(b"linkAndEvaluateModule")
                || name.eq_ascii(b"moduleEvaluation")
                || name.eq_ascii(b"processTicksAndRejections")
        }
        fn is_hidden_frame(f: &crate::ZigStackFrame<'_>) -> bool {
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

        if self.hide_bun_stackframes.get() {
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
        if self.hide_bun_stackframes.get() {
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
                frames[top].source_url = src.into();
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
                // What lies on the disk under the name of a module that is compiled into an executable is not what runs.
                let top_path = frames[top].source_url.to_utf8();
                if crate::compiled_program::is_compiled_module(top_path.slice()) {
                    if !crate::compiled_program::runs_in_place() {
                        break 'code bun_core::Utf8Bytes::EMPTY;
                    }
                    let text = bun_sys::File::read_from(bun_sys::Fd::cwd(), top_path.slice());
                    break 'code bun_core::Utf8Bytes::Owned(text.unwrap_or_default());
                }
                let mut log = bun_ast::Log::default();
                let Ok(original_source) = bun_removable_features::call_removable_or!(
                    RuntimeTranspiler,
                    ReturnDefault,
                    { break 'code bun_core::Utf8Bytes::EMPTY },
                    VirtualMachine::fetch_without_on_load_plugins,
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
            *source_code = code;
            let code: &'a [u8] = source_code.slice();

            if enable_source_code_preview.get() && code.is_empty() {
                exception.collect_source_lines(error_instance, global);
            }

            // Direct copy; both sides are `bun_core::Ordinal`.
            frames[top].position.line = mapping.original.lines;
            frames[top].position.column = mapping.original.columns;
            exception.remapped = true;
            frames[top].remapped = true;

            let last_line = frames[top].position.line.zero_based().max(0);
            if let Some(lines_buf) = bun_core::strings::get_lines_in_text::<
                { crate::zig_exception::SOURCE_LINES_COUNT },
            >(code, last_line as u32)
            {
                let lines = lines_buf.as_slice();
                const N: usize = crate::zig_exception::SOURCE_LINES_COUNT;
                // SAFETY: `Holder` backs both arrays with `[_; SOURCE_LINES_COUNT]`.
                let source_lines =
                    unsafe { bun_core::ffi::slice_mut(exception.stack.source_lines_ptr, N) };
                // SAFETY: `Holder` backs `source_lines_numbers` with `[i32; SOURCE_LINES_COUNT]`.
                let source_line_numbers =
                    unsafe { bun_core::ffi::slice_mut(exception.stack.source_lines_numbers, N) };
                for s in source_lines.iter_mut() {
                    *s = bun_core::StringOrView::EMPTY;
                }
                source_line_numbers.fill(0);

                let take = lines.len().min(N);
                let mut current_line_number = last_line;
                for (i, line) in lines[..take].iter().enumerate() {
                    source_lines[i] = bun_core::StringOrView::from_bytes(line);
                    source_line_numbers[i] = current_line_number;
                    current_line_number -= 1;
                }
                exception.stack.source_lines_len = take as u8;
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
                        frames[i].source_url = src.into();
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
        &self,
        zig_exception: &mut ZigException<'_>,
        formatter: Option<&mut crate::console_object::Formatter>,
        writer: &mut bun_core::io::Writer,
        allow_side_effects: bool,
        allow_ansi_color: bool,
    ) -> crate::CrateResult<()> {
        let mut default_formatter = crate::console_object::Formatter::new(self.global());
        let f = formatter.unwrap_or(&mut default_formatter);
        let mut recorded = false;
        self.print_error_instance_body(
            zig_exception,
            JSValue::ZERO,
            None,
            f,
            writer,
            allow_ansi_color,
            allow_side_effects,
            &mut recorded,
        )
        // `defer default_formatter.deinit()` → Drop.
    }

    /// JS-value variant of the error printer; see
    /// [`Self::print_error_instance_body`].
    fn print_error_instance_js(
        &self,
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
        // `vm.isSafeToRecurse()`.
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

        if error_instance.is_cell()
            && error_instance.js_type() == crate::JSType::ErrorInstance
            && formatter.visited_contains(error_instance)
        {
            writer.write_all(if allow_ansi_color {
                bun_core::pretty_fmt!("<r><cyan>[Circular]<r>", true).as_bytes()
            } else {
                bun_core::pretty_fmt!("<r><cyan>[Circular]<r>", false).as_bytes()
            })?;
            return Ok(());
        }

        // Declared before the holder, whose source lines borrow it.
        let mut source_code = bun_core::Utf8Bytes::EMPTY;
        // Note: `Holder` is ~4 KB (32 ZigStackFrames + 6 source lines +
        // ZigException). It sits next to the large runtime-dispatched body, so
        // box it to keep the per-level recursion frame small enough for the
        // 16K-deep `bun-inspect.test.ts` Error chain on Windows debug.
        let mut exception_holder = Box::new(crate::zig_exception::Holder::init());
        // Note: reshaped for borrowck — `zig_exception()` returns a
        // `&mut` into the holder; we need to also borrow
        // `need_to_clear_parser_arena_on_deinit` disjointly. Route through a
        // raw pointer (the holder is heap-pinned for the call).
        let exception: *mut ZigException<'_> = exception_holder.zig_exception();

        self.remap_zig_exception(
            // SAFETY: `exception` points into stack-local `exception_holder`.
            unsafe { &mut *exception },
            error_instance,
            exception_list,
            &mut exception_holder.need_to_clear_parser_arena_on_deinit,
            &mut source_code,
            formatter.error_display_level != crate::console_object::ErrorDisplayLevel::Warn,
        );
        error_instance.ensure_still_alive();

        let mut recorded = false;
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
            &mut recorded,
        );
        if recorded {
            formatter.visited_remove(error_instance);
        }

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
        &self,
        exception: &mut ZigException<'_>,
        error_instance: JSValue,
        exception_list: Option<&mut ExceptionList>,
        formatter: &mut crate::console_object::Formatter,
        writer: &mut bun_core::io::Writer,
        allow_ansi_color: bool,
        allow_side_effects: bool,
        recorded: &mut bool,
    ) -> crate::CrateResult<()> {
        use crate::JSType;
        use crate::console_object::formatter::TagOptions;
        use crate::console_object::{Tag, TagPayload};

        let prev_had_errors = self.had_errors.replace(true);
        // Restore `had_errors` on every exit (including `?` from `JSError` paths).
        struct RestoreHadErrors<'a> {
            vm: &'a VirtualMachine,
            prev: bool,
        }
        impl Drop for RestoreHadErrors<'_> {
            fn drop(&mut self) {
                self.vm.had_errors.set(self.prev);
            }
        }
        let _restore_had_errors = RestoreHadErrors {
            vm: self,
            prev: prev_had_errors,
        };

        if allow_side_effects {
            if let Some(debugger) = self.debugger.get() {
                debugger.lifecycle_reporter_agent.report_error(exception);
            }
            if let Some(cb) = self.on_print_error_zig_exception.get() {
                cb(self.on_print_error_zig_exception_ctx.get(), exception);
            }
        }

        // Defer the GitHub-annotation print to scope exit.
        struct DeferGhAnnotation<'a> {
            run: bool,
            /// BACKREF — borrows the caller's stack-local `ZigException`, live
            /// across this drop guard (declared after the `&mut` rebind so it
            /// drops first).
            exception: bun_ptr::BackRef<ZigException<'a>>,
        }
        impl Drop for DeferGhAnnotation<'_> {
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
        let global_ref = self.global();
        // Holds the owning `bun_core::String` so the latin1 view below stays
        // live for this fn.
        let code_string: Option<bun_core::String>;
        let code: Option<&[u8]> = if is_error_instance {
            // SAFETY: `is_error_instance` ⇒ `get_object()` is `Some`.
            let obj = unsafe { &mut *error_instance.get_object().unwrap_unchecked() };
            if let Some(code_value) = obj.get_code_property_vm_inquiry(global_ref) {
                // Not `is_string()`: converting a String object runs its `toString` /
                // `Symbol.toPrimitive`. The property loop below prints one.
                if code_value.is_string_literal() {
                    match code_value.to_bun_string(global_ref) {
                        Ok(s) if s.is_8bit() => {
                            code_string = Some(s);
                            code_string.as_ref().map(|s| s.latin1())
                        }
                        Ok(_) => None,
                        // A primitive string only fails to convert when it is a rope
                        // that cannot be resolved.
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
                let mut top_frame: Option<&crate::ZigStackFrame<'_>> = frames.first();
                if self.hide_bun_stackframes.get() {
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
                    include_symbols: true,
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
                let circular = kind == JSType::ErrorInstance
                    && (value == error_instance || formatter.visited_contains(value));
                if kind == JSType::ErrorInstance && !prev_had_errors && !circular {
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
                    if circular && field.eq_ascii(b"cause") {
                        saw_cause = true;
                    }
                    if !*recorded && !value.is_primitive() {
                        *recorded = formatter.visited_insert(error_instance);
                    }
                    let prev_disable_inspect_custom = formatter.disable_inspect_custom;
                    let prev_quote_strings = formatter.quote_strings;
                    let prev_max_depth = formatter.max_depth;
                    let prev_outer_max_depth = formatter.outer_max_depth;
                    let prev_format_buffer_as_text = formatter.format_buffer_as_text;
                    formatter.depth += 1;
                    formatter.format_buffer_as_text = true;
                    formatter.outer_max_depth = Some(formatter.error_chain_max_depth());
                    formatter.max_depth = formatter.depth;
                    formatter.quote_strings = true;
                    formatter.disable_inspect_custom = true;
                    // Hand-rolled drop guard restores the formatter state.
                    struct RestoreFmt<'a, 'f> {
                        f: &'a mut crate::console_object::Formatter<'f>,
                        d: bool,
                        q: bool,
                        m: u16,
                        o: Option<u16>,
                        b: bool,
                    }
                    impl Drop for RestoreFmt<'_, '_> {
                        fn drop(&mut self) {
                            self.f.depth -= 1;
                            self.f.max_depth = self.m;
                            self.f.outer_max_depth = self.o;
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
                        o: prev_outer_max_depth,
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

            // "cause" is not enumerable, so the above loop won't see it.
            if !saw_cause {
                let key = bun_core::String::static_("cause");
                if let Some(cause) = error_instance.get_own(global_ref, &key)? {
                    if cause.is_cell() && cause.js_type() == JSType::ErrorInstance {
                        if cause == error_instance || formatter.visited_contains(cause) {
                            let pad_left = longest_name.saturating_sub(b"cause".len());
                            is_first_property = false;
                            splat_space(writer, pad_left as u64)?;
                            pretty_write!(
                                writer,
                                " cause<r><d>:<r> <r><cyan>[Circular]<r><r><d>,<r>\n"
                            )?;
                        } else {
                            cause.protect();
                            errors_to_append.push(cause);
                        }
                    }
                }
            }

            if !is_first_property {
                writer.write_all(b"\n")?;
            }
        } else if error_instance != JSValue::ZERO {
            // If you do `reportError([1,2,3])` we should still show something.
            let tag = Tag::get_advanced(
                error_instance,
                global_ref,
                TagOptions::DISABLE_INSPECT_CUSTOM | TagOptions::HIDE_GLOBAL,
            )?;
            if !matches!(tag.tag, TagPayload::NativeCode) {
                if allow_ansi_color {
                    formatter.format::<true>(tag, writer, error_instance, global_ref)?;
                } else {
                    formatter.format::<false>(tag, writer, error_instance, global_ref)?;
                }
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

        if !*recorded && !errors_to_append.is_empty() {
            *recorded = formatter.visited_insert(error_instance);
        }

        let mut exception_list = exception_list;
        for &err in &errors_to_append {
            writer.write_all(b"\n")?;
            let prev_depth = formatter.depth;
            formatter.depth = formatter.depth.saturating_add(1);
            let over_cap = formatter.depth > formatter.error_chain_max_depth();
            let result: crate::CrateResult<()> = if over_cap {
                pretty_write!(writer, "<r><cyan>[Error ...]<r>").map_err(Into::into)
            } else {
                self.print_error_instance_js(
                    err,
                    exception_list.as_deref_mut(),
                    formatter,
                    writer,
                    allow_ansi_color,
                    allow_side_effects,
                )
            };
            formatter.depth = prev_depth;
            result?;
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
    pub(crate) fn print_github_annotation(exception: &ZigException<'_>) {
        use crate::zig_stack_frame::LineColumn;
        let name = &exception.name;
        let message = &exception.message;
        let frames = exception.stack.frames();
        let top_frame = frames.first();
        let dir = bun_core::env_var::GITHUB_WORKSPACE::get()
            .unwrap_or_else(|| bun_bundler::bun_fs::FileSystem::instance().top_level_dir());
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
        &self,
        path: &[u8],
        line: bun_core::Ordinal,
        column: bun_core::Ordinal,
        source_handling: bun_sourcemap::SourceContentHandling,
    ) -> Option<bun_sourcemap::mapping::Lookup> {
        Self::resolve_source_mapping_in(
            &self.source_mappings,
            self.standalone_module_graph.is_some(),
            path,
            line,
            column,
            source_handling,
        )
    }

    fn resolve_source_mapping_in(
        source_mappings: &SavedSourceMap,
        in_standalone_executable: bool,
        path: &[u8],
        line: bun_core::Ordinal,
        column: bun_core::Ordinal,
        source_handling: bun_sourcemap::SourceContentHandling,
    ) -> Option<bun_sourcemap::mapping::Lookup> {
        if let Some(lookup) = source_mappings.resolve_mapping(path, line, column, source_handling) {
            return Some(lookup);
        }

        // Standalone-module-graph fallback: the sourcemap load reaches into
        // `bun_standalone_graph::{Graph,File,LazySourceMap}` (higher tier);
        // dispatch through [`RuntimeHooks::load_standalone_sourcemap`] per
        // §Dispatch (cold path — one-time decode then cached below).
        // Gate only — the hook reaches the concrete graph via its own
        // `UnsafeCell` singleton (write-provenance), not via this read-only
        // trait object.
        if !in_standalone_executable {
            return None;
        }
        let hooks = runtime_hooks()?;
        // The hook mutates only per-`File` lazy caches under the standalone graph's internal
        // `INIT_LOCK`.
        let map = (hooks.load_standalone_sourcemap)(path)?;

        source_mappings.put_parsed(path, std::sync::Arc::clone(&map));

        let mapping = map.find_mapping(line, column)?;

        Some(bun_sourcemap::mapping::Lookup {
            mapping,
            source_map: Some(map),
            prefetched_source_code: None,
        })
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
fn run_on_resolve(
    global: &JSGlobalObject,
    specifier: &bun_core::String,
    importer: &bun_core::String,
) -> JsResult<Option<Result<bun_core::String, JSValue>>> {
    let specifier = specifier.to_utf8();
    let Some((namespace, path)) = ModuleLoader::plugin_namespace_and_path(&specifier) else {
        return Ok(None);
    };
    // The importer's key ends in the query it was imported with.
    let importer = importer.to_utf8();
    let importer = match bun_core::strings::index_of_char_usize(&importer, b'?') {
        Some(query) => &importer[..query],
        None => &importer[..],
    };
    let Some(on_resolve_plugin) = global.run_on_resolve_plugins(
        &bun_core::StringView::from_bytes(if namespace == b"file" { b"" } else { namespace }),
        &bun_core::StringView::borrow_utf8(path),
        &bun_core::StringView::borrow_utf8(importer),
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

    if user_namespace.eq_ascii(b"file") {
        if file_path.starts_with_ascii(b"file://") {
            let path = bun_url::path_from_file_url(&file_path);
            if !path.is_dead() {
                return Ok(Some(Ok(path)));
            }
        }
        return Ok(Some(Ok(file_path)));
    }

    Ok(Some(Ok(bun_core::String::create_format(format_args!(
        "{}:{}",
        user_namespace, file_path
    )))))
}

/// See [`VirtualMachine::enter_context`].
pub struct ContextScope<'a> {
    vm: &'a VirtualMachine,
    /// The context entered: the dead one's, for a context that is gone.
    context: crate::ContextId,
    /// The async context to restore; empty when entering changed nothing. (On the stack: kept
    /// alive by the conservative scan.)
    previous: JSValue,
    /// The realm `previous` is restored in: the one that was entered. (On the stack, as `previous`.)
    entered: *const JSGlobalObject,
    previous_entered: Option<crate::ContextId>,
}

impl<'a> ContextScope<'a> {
    /// The context this scope entered (the dead one, once that graph's is freed): what native code
    /// that has no `CallFrame` passes to whatever it creates.
    pub fn context(&self) -> &'a crate::ScriptExecutionContext {
        self.vm.context_of(self.context)
    }
}

impl Drop for ContextScope<'_> {
    fn drop(&mut self) {
        self.vm.entered_context.set(self.previous_entered);
        if !self.previous.is_empty() {
            // SAFETY: the realm entered above; it is reachable from this frame until here.
            Bun__ModuleGraph__leaveContext(unsafe { &*self.entered }, self.previous);
        }
    }
}
