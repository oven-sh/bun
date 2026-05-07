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

use bun_aio as Async;
use bun_bundler::Transpiler;
use bun_logger as logger;
use bun_uws as uws;

use crate::counters::Counters;
use crate::event_loop::EventLoop;
#[allow(unused_imports)] use crate::ipc::IPC; // scoped logger static for `bun_core::scoped_log!(IPC, ...)`
use crate::module_loader::{self as ModuleLoader, FetchFlags};
use crate::rare_data::RareData;
use crate::saved_source_map::SavedSourceMap;
use crate::{
    self as jsc, ErrorableResolvedSource, ErrorableString, Exception, JSGlobalObject,
    JSInternalPromise, JSValue, JsError, JsResult, OpaqueCallback, PlatformEventLoop,
    ResolvedSource, Strong, ZigException, VM,
};

pub use crate::process_auto_killer as ProcessAutoKiller;

// ──────────────────────────────────────────────────────────────────────────
// Exported globals
// ──────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub static mut has_bun_garbage_collector_flag_enabled: bool = false;
#[unsafe(no_mangle)]
pub static mut isBunTest: bool = false;
#[unsafe(no_mangle)]
pub static mut Bun__defaultRemainingRunsUntilSkipReleaseAccess: c_int = 10;

// TODO: evaluate if this has any measurable performance impact.
pub static mut SYNTHETIC_ALLOCATION_LIMIT: usize = u32::MAX as usize;
#[unsafe(export_name = "Bun__stringSyntheticAllocationLimit")]
pub static mut STRING_ALLOCATION_LIMIT: usize = u32::MAX as usize;

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
/// The full `Options<'a>` (with `args: api::TransformOptions`, `env_loader`, etc.)
/// is gated below — this is the minimal surface dependents type-check against.
pub struct InitOptions {
    pub args: alloc::vec::Vec<alloc::string::String>,
    /// Spec VirtualMachine.zig:1208 `Options.log`. When `Some`, [`init`] adopts
    /// the caller's log instead of boxing a fresh one (CLI-path macros pass the
    /// transpiler's log so macro load errors land in the bundle output).
    pub log: Option<NonNull<logger::Log>>,
    /// Spec VirtualMachine.zig:1210 `Options.env_loader`. Forwarded to
    /// `RuntimeHooks::init_runtime_state` so the high-tier `Transpiler::init`
    /// reuses the caller's env loader.
    pub env_loader: Option<NonNull<bun_dotenv::Loader<'static>>>,
    pub graph: *mut c_void,
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
            args: alloc::vec::Vec::new(),
            log: None,
            env_loader: None,
            graph: core::ptr::null_mut(),
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
    // allocator: dropped per §Allocators (global mimalloc)
    pub has_loaded_constructors: bool,
    // TODO(port): lifetime — `Transpiler<'a>` borrows `log`/`allocator`; VM is
    // self-referential and cannot carry `<'a>`, so we erase to `'static` and the
    // owner guarantees the borrowed `log` outlives the VM (see `init`).
    pub transpiler: Transpiler<'static>,
    // TODO(b2-cycle): `bun_watcher` is `ImportWatcher` from hot_reloader.rs (gated sibling).
    pub bun_watcher: *mut c_void,
    pub console: *mut crate::console_object::ConsoleObject,
    // TODO(port): lifetime — LIFETIMES.tsv says BORROW_PARAM (`&'a mut logger::Log`);
    // raw NonNull used because VM is self-referential and cannot carry `<'a>`.
    pub log: Option<NonNull<logger::Log>>,
    pub main: &'static [u8], // TODO(port): lifetime — never freed in deinit, often points to argv
    pub main_is_html_entrypoint: bool,
    pub main_resolved_path: bun_string::String,
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
    /// `body_value_hive_allocator: webcore.Body.Value.HiveAllocator` value
    /// fields live inside this box rather than as `()` shadows here — both
    /// types are owned by `bun_runtime` (forward dep). Access goes through
    /// [`RuntimeHooks::timer_insert`] / [`RuntimeHooks::body_value_hive_ref`].
    pub runtime_state: *mut c_void,
    pub event_loop_handle: Option<*mut PlatformEventLoop>,
    pub pending_unref_counter: i32,
    pub preload: Vec<Box<[u8]>>,
    pub unhandled_pending_rejection_to_capture: Option<*mut JSValue>,
    // TODO(port): lifetime — `Option<&'a StandaloneModuleGraph>`.
    pub standalone_module_graph: Option<NonNull<c_void>>,
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
    pub plugin_runner: Option<bun_bundler::transpiler::PluginRunner>,
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

    pub is_inside_deferred_task_queue: bool,
    /// When true, drainMicrotasksWithGlobal is suppressed.
    pub suppress_microtask_drain: bool,

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
unsafe extern "C" {
    fn Bun__handleUncaughtException(global: *mut JSGlobalObject, err: JSValue, is_rejection: c_int) -> c_int;
    fn Bun__handleUnhandledRejection(global: *mut JSGlobalObject, reason: JSValue, promise: JSValue) -> c_int;
    fn Bun__emitHandledPromiseEvent(global: *mut JSGlobalObject, promise: JSValue) -> bool;

    fn Process__dispatchOnBeforeExit(global: *mut JSGlobalObject, code: u8);
    fn Process__dispatchOnExit(global: *mut JSGlobalObject, code: u8);
    fn Bun__closeAllSQLiteDatabasesForTermination();
    fn Bun__WebView__closeAllForTermination();
    /// `bun.api.node.process.exit` — exported from the Zig side as
    /// `Bun__Process__exit` (see `runtime/node/node_process.zig` `@export`).
    /// Main-thread is `noreturn`; in a worker it returns and the caller
    /// `panic!`s, mirroring the Zig spec.
    fn Bun__Process__exit(global: *mut JSGlobalObject, code: u8);
    fn Zig__GlobalObject__destructOnExit(global: *mut JSGlobalObject);
}

/// `hot_reload` is stored as `u8` (TODO(b2-cycle): widen to
/// `bun_options_types::Context::HotReload`). Mirror the Zig enum ordinals so
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
pub static mut MAIN_THREAD_VM: Option<*mut VirtualMachine> = None;

impl VMHolder {
    thread_local! {
        pub static VM: Cell<Option<*mut VirtualMachine>> = const { Cell::new(None) };
        pub static CACHED_GLOBAL_OBJECT: Cell<Option<*mut JSGlobalObject>> = const { Cell::new(None) };
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__setDefaultGlobalObject(global: *mut JSGlobalObject) {
        if let Some(vm_instance) = Self::VM.get() {
            // SAFETY: vm pointer set by init() on this thread
            let vm_instance = unsafe { &mut *vm_instance };
            vm_instance.global = global;
            if vm_instance.is_main_thread {
                // SAFETY: mutable static only touched on the main JS thread
                unsafe { MAIN_THREAD_VM = Some(vm_instance) };
            }
        }
        Self::CACHED_GLOBAL_OBJECT.set(Some(global));
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__getDefaultGlobalObject() -> Option<NonNull<JSGlobalObject>> {
        if let Some(g) = Self::CACHED_GLOBAL_OBJECT.get() {
            return NonNull::new(g);
        }
        if let Some(vm_instance) = Self::VM.get() {
            // SAFETY: vm pointer set by init() on this thread
            let g = unsafe { (*vm_instance).global };
            Self::CACHED_GLOBAL_OBJECT.set(Some(g));
        }
        None
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__thisThreadHasVM() -> bool {
        Self::VM.get().is_some()
    }
}

thread_local! {
    pub static IS_BUNDLER_THREAD_FOR_BYTECODE_CACHE: Cell<bool> = const { Cell::new(false) };
    pub static IS_MAIN_THREAD_VM: Cell<bool> = const { Cell::new(false) };
}

pub static mut IS_SMOL_MODE: bool = false;

/// Process-global "smol" flag (Zig: `bun.jsc.VirtualMachine.is_smol_mode`).
/// Set once during VM init before workers spawn; thereafter read-only, so a
/// relaxed unsynchronized read is sound.
#[inline]
pub fn is_smol_mode() -> bool {
    // SAFETY: written once at startup before any concurrent reader exists;
    // `&raw const` avoids the edition-2024 `static_mut_refs` lint.
    unsafe { *&raw const IS_SMOL_MODE }
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
    /// parent via `@fieldParentPtr` is sound in Zig but in Rust would (a) form
    /// a `&mut VirtualMachine` aliased with the live `&mut ExitHandler`, and
    /// (b) escape the provenance of `&mut self` (which only covers the
    /// `ExitHandler` field). Callers pass the raw VM pointer instead.
    ///
    /// # Safety
    /// `vm` must point to the live per-thread `VirtualMachine`.
    pub unsafe fn dispatch_on_exit(vm: *mut VirtualMachine) {
        // SAFETY: per fn contract — per-field raw deref, no `&mut VM` formed.
        let exit_code = unsafe { (*vm).exit_handler.exit_code };
        // SAFETY: extern "C" FFI; vm.global valid for VM lifetime
        unsafe { Process__dispatchOnExit((*vm).global, exit_code) };
        // SAFETY: per fn contract — per-field raw deref.
        if unsafe { (*vm).worker.is_none() } {
            // SAFETY: extern "C" FFI; main-thread-only termination hooks
            unsafe { Bun__closeAllSQLiteDatabasesForTermination() };
            // SAFETY: extern "C" FFI; main-thread-only termination hooks
            unsafe { Bun__WebView__closeAllForTermination() };
        }
    }

    /// See [`dispatch_on_exit`] for the `&mut self → *mut VirtualMachine`
    /// signature change.
    ///
    /// # Safety
    /// `vm` must point to the live per-thread `VirtualMachine`.
    pub unsafe fn dispatch_on_before_exit(vm: *mut VirtualMachine) {
        // SAFETY: per fn contract — per-field raw deref, no `&mut VM` formed.
        let exit_code = unsafe { (*vm).exit_handler.exit_code };
        // SAFETY: per fn contract; vm.global valid for VM lifetime.
        let global = unsafe { &*(*vm).global };
        let _ = jsc::from_js_host_call_generic(global, || unsafe {
            Process__dispatchOnBeforeExit((*vm).global, exit_code)
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

impl VirtualMachine {
    /// Spec VirtualMachine.zig:357-366 returns a raw `*VirtualMachine`.
    /// Returning `&'static mut` would let any two overlapping calls (e.g. a JS
    /// callback fired from inside `vm.tick()` that itself calls `get()`) hold
    /// two live `&'static mut` to the same allocation — UB. Callers form a
    /// short-lived `&mut *p` at the use site instead.
    #[inline]
    pub fn get() -> *mut VirtualMachine {
        Self::get_or_null().expect("VirtualMachine.get() called with no VM on this thread")
    }

    #[inline]
    pub fn get_or_null() -> Option<*mut VirtualMachine> {
        // thread-local set by init() on this thread; one VM per thread
        VMHolder::VM.get()
    }

    pub fn get_main_thread_vm() -> Option<*mut VirtualMachine> {
        // SAFETY: written once during main-thread init
        unsafe { MAIN_THREAD_VM }
    }

    #[inline]
    pub fn is_loaded() -> bool {
        VMHolder::VM.get().is_some()
    }

    /// Installs `vm` as the current thread's VM (Zig: `VMHolder.vm = vm`).
    pub fn set_current(vm: *mut VirtualMachine) {
        VMHolder::VM.set(Some(vm));
    }

    #[inline]
    pub fn global(&self) -> &JSGlobalObject {
        // SAFETY: `global` is set during init and live for the VM lifetime.
        unsafe { &*self.global }
    }

    /// Spec VirtualMachine.zig: `pub fn eventLoop(this: *VirtualMachine) *EventLoop`
    /// — returns a raw `*EventLoop` (no aliasing guarantee). Returning `&mut`
    /// here would let two overlapping callers (e.g. a JS callback re-entering
    /// `vm.event_loop()` from inside `tick()`) mint aliased `&mut EventLoop` to
    /// the same allocation — UB per PORTING.md §Forbidden. Callers form a
    /// short-lived `&mut *p` at the use site instead, mirroring [`Self::get`].
    #[inline]
    pub fn event_loop(&self) -> *mut EventLoop {
        // self-pointer to regular_event_loop or macro_event_loop
        self.event_loop
    }

    #[inline]
    pub fn transpiler(&mut self) -> &mut Transpiler<'static> {
        &mut self.transpiler
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
            // TODO(b2): bun_safety::asan::register_root_region — not at this tier yet.
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

        if let Some(worker) = self.worker {
            // SAFETY: `worker` is a `*const c_void` pointing at a heap `WebWorker`
            // owned by C++ that outlives this VM (BACKREF — see field decl).
            let worker = unsafe { &*(worker as *const crate::web_worker::WebWorker) };
            if worker.has_requested_terminate() {
                return crate::ScriptExecutionStatus::Stopped;
            }
        }

        crate::ScriptExecutionStatus::Running
    }

    pub fn uws_loop(&self) -> *mut uws::Loop {
        #[cfg(unix)]
        {
            self.event_loop_handle.expect("uws event_loop_handle is null")
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
        // SAFETY: event_loop points at sibling field
        let el = unsafe { &*self.event_loop };
        // SAFETY: event_loop_handle is live for the VM lifetime when set.
        let active = self
            .event_loop_handle
            .map(|h| unsafe { (*h).is_active() })
            .unwrap_or(false);
        self.unhandled_error_counter == 0
            && ((active as usize)
                + self.active_tasks
                + el.tasks.readable_length()
                + (el.has_pending_refs() as usize)
                > 0)
    }

    pub fn is_event_loop_alive(&self) -> bool {
        // SAFETY: event_loop points at sibling field
        let el = unsafe { &*self.event_loop };
        self.is_event_loop_alive_excluding_immediates()
            || !el.immediate_tasks.is_empty()
            || !el.next_immediate_tasks.is_empty()
    }

    pub fn wakeup(&mut self) {
        // SAFETY: `event_loop` is a self-pointer into this VM; uniquely accessed here.
        unsafe { (*self.event_loop()).wakeup() };
    }

    pub fn on_quiet_unhandled_rejection_handler(this: &mut VirtualMachine, _: &JSGlobalObject, _: JSValue) {
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
        // SAFETY: extern "C" FFI; const→mut cast required by C ABI, callee does not mutate
        unsafe { Bun__emitHandledPromiseEvent(global_object.as_ptr(), promise) }
    }

    pub fn default_on_unhandled_rejection(this: &mut VirtualMachine, _: &JSGlobalObject, value: JSValue) {
        // SAFETY: BORROW_PARAM ptr set by caller, outlives this call (TODO(port): lifetime)
        let list = this
            .on_unhandled_rejection_exception_list
            .map(|p| unsafe { &mut *p.as_ptr() });
        this.run_error_handler(value, list);
    }

    #[cold]
    pub fn garbage_collect(&self, sync: bool) -> usize {
        bun_core::Global::mimalloc_cleanup(false);
        // SAFETY: global is valid for VM lifetime
        let vm = unsafe { (*self.global).vm() };
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

    pub fn enable_macro_mode(&mut self) {
        if !self.has_enabled_macro_mode {
            self.has_enabled_macro_mode = true;
            self.macro_event_loop = EventLoop::default();
            self.macro_event_loop.virtual_machine = NonNull::new(self as *mut _);
            self.macro_event_loop.global = NonNull::new(self.global);
            self.macro_event_loop.concurrent_tasks = Default::default();
        }
        self.event_loop = &mut self.macro_event_loop;
        self.macro_mode = true;
        // TODO(b2-cycle): self.transpiler.options.target = .bun_macro / no_macros
        // — `bun_bundler::options` is gated.
    }

    pub fn disable_macro_mode(&mut self) {
        self.macro_mode = false;
        self.event_loop = &mut self.regular_event_loop;
        // TODO(b2-cycle): self.transpiler.options.target = .bun
    }

    pub fn prepare_loop(&mut self) {}

    pub fn enter_uws_loop(&mut self) {
        // SAFETY: event_loop_handle is set in ensure_waker before any caller reaches here.
        unsafe { (*self.event_loop_handle.unwrap()).run() };
    }

    pub fn enqueue_task(&mut self, task: bun_event_loop::Task) {
        // SAFETY: `event_loop` is a self-pointer into this VM; uniquely
        // accessed here (no overlapping `&mut EventLoop`).
        unsafe { (*self.event_loop()).enqueue_task(task) };
    }

    pub fn tick(&mut self) {
        // SAFETY: see `enqueue_task`.
        unsafe { (*self.event_loop()).tick() };
    }

    pub fn drain_microtasks(&mut self) {
        // SAFETY: see `enqueue_task`.
        let _ = unsafe { (*self.event_loop()).drain_microtasks() };
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
            let t = unsafe { &mut *ctx.cast::<Trampoline<F, R>>() };
            // SAFETY: single-shot — `f` is taken exactly once.
            let f = unsafe { ManuallyDrop::take(&mut t.f) };
            t.result.write(f());
        }

        let mut t = Trampoline::<F, R> {
            f: ManuallyDrop::new(f),
            result: MaybeUninit::uninit(),
        };
        // SAFETY: `self.jsc_vm` is the live JSC VM for this thread; `t` lives
        // on this stack frame for the duration of the FFI call, which invokes
        // `call` exactly once before returning.
        unsafe {
            JSC__VM__holdAPILock(self.jsc_vm, (&raw mut t).cast(), call::<F, R>);
        }
        // SAFETY: `call` wrote `t.result` exactly once above.
        unsafe { t.result.assume_init() }
    }

    #[cold]
    pub fn run_error_handler(&mut self, result: JSValue, exception_list: Option<&mut ExceptionList>) {
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
            // SAFETY: hook contract — `self` is the live per-thread VM;
            // `exception_list` (if any) borrows caller stack for this call.
            unsafe { (hooks.print_exception)(self, result, exception_list) };
        } else {
            // Low-tier fallback (no `bun_runtime` installed — unit tests):
            // we cannot reach `ConsoleObject::Formatter`, so emit a degraded
            // one-line render via the buffered error writer. Spec
            // VirtualMachine.zig:2156-2189 routes through `printErrorlikeObject`
            // (which formats name/message/stack); the closest we can do here
            // without the high tier is the value's own `toString`.
            let _ = exception_list;
            let writer = bun_core::Output::error_writer();
            // SAFETY: `global` is set during init and live for VM lifetime.
            let global = unsafe { &*self.global };
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
        use bun_collections::hash_map::Entry;
        use bun_bundler::entry_points::{Fs, MacroEntryPoint};
        let entry_point: *mut MacroEntryPoint =
            match self.macro_entry_points.entry(hash) {
                Entry::Occupied(e) => (*e.get()).cast(),
                Entry::Vacant(v) => {
                    let mut ep = Box::new(MacroEntryPoint::default());
                    // SAFETY: PathName stores slices with an artificial 'static
                    // bound (Zig has no lifetimes); the generated entry point is
                    // boxed into `macro_entry_points` and lives for the VM
                    // lifetime, and `entry_path` is only borrowed for the
                    // duration of `generate` (it copies into `code_buffer`).
                    let entry_path_static: &'static [u8] =
                        unsafe { core::mem::transmute::<&[u8], &'static [u8]>(entry_path) };
                    MacroEntryPoint::generate(
                        &mut *ep,
                        &mut self.transpiler,
                        &Fs::PathName::init(entry_path_static),
                        function_name,
                        hash,
                        specifier,
                    )?;
                    let raw = Box::into_raw(ep);
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
        let path: &[u8] = unsafe { (*entry_point).source.path.text };
        let promise = self.run_with_api_lock(|| {
            // SAFETY: per-thread VM; the API lock guarantees JSC is held.
            unsafe { (*VirtualMachine::get())._load_macro_entry_point(path) }
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

        // SAFETY: `isBunTest` is a process-global written once at startup.
        if unsafe { isBunTest } {
            self.unhandled_error_counter += 1;
            (self.on_unhandled_rejection)(self, global_object, err);
            return true;
        }

        if self.is_handling_uncaught_exception {
            self.run_error_handler(err, None);
            // SAFETY: extern "C" FFI; `global_object` is the live VM global.
            unsafe { Bun__Process__exit(global_object.as_ptr(), 7) };
            panic!("Uncaught exception while handling uncaught exception");
        }
        if self.exit_on_uncaught_exception {
            self.run_error_handler(err, None);
            // SAFETY: extern "C" FFI; `global_object` is the live VM global.
            unsafe { Bun__Process__exit(global_object.as_ptr(), 1) };
            panic!("made it past Bun__Process__exit");
        }
        self.is_handling_uncaught_exception = true;
        // SAFETY: extern "C" FFI; `global_object` is the live VM global.
        let handled = unsafe {
            Bun__handleUncaughtException(
                global_object.as_ptr(),
                err.to_error().unwrap_or(err),
                if is_rejection { 1 } else { 0 },
            )
        } > 0;
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
        // callback unwind past this frame (re-entry hits `Bun__Process__exit`
        // → `panic!`, which never returns), so a linear reset here matches
        // the Zig `defer` scope.
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
        let vm = self as *mut VirtualMachine;
        // SAFETY: `vm` is the live per-thread VM (we just took its address).
        unsafe { ExitHandler::dispatch_on_before_exit(vm) };
        let mut dispatch = false;
        loop {
            while self.is_event_loop_alive() {
                self.tick();
                self.auto_tick_active();
                dispatch = true;
            }

            if dispatch {
                // SAFETY: `vm` is the live per-thread VM.
                unsafe { ExitHandler::dispatch_on_before_exit(vm) };
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
            // SAFETY: `jsc_vm` set in `init`, valid for VM lifetime.
            let _ = crate::bun_cpu_profiler::stop_and_write_profile(
                unsafe { &mut *self.jsc_vm },
                &config,
            );
        }
        // Write heap profile if profiling was enabled - do this after CPU
        // profile but before shutdown.
        if let Some(config) = self.heap_profiler_config.take() {
            // SAFETY: `jsc_vm` set in `init`, valid for VM lifetime.
            let _ = crate::bun_heap_profiler::generate_and_write_profile(
                unsafe { &mut *self.jsc_vm },
                config,
            );
        }

        let vm = self as *mut VirtualMachine;
        // SAFETY: `vm` is the live per-thread VM (we just took its address).
        unsafe { ExitHandler::dispatch_on_exit(vm) };
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
            // SAFETY: `event_loop` is a self-pointer into this VM.
            if let Some(_t) = unsafe { (*self.event_loop()).forever_timer.take() } {
                // TODO(b2): `uws::Timer::deinit(true)` — not surfaced in
                // `bun_uws_sys::Timer` at this tier yet.
            }
            // Detached worker threads may still be in startVM()/spin() using
            // the process-global resolver BSSMap singletons. transpiler.deinit()
            // below frees those singletons, so request termination of every
            // live worker and wait for each to reach shutdown() first.
            // TODO(b2-cycle): `webcore::WebWorker::terminate_all_and_wait(10_000)`
            // lives in `bun_runtime` (forward-dep cycle). Route through
            // `RuntimeHooks` once a slot is added.

            // Embedded per-VM socket groups must drain while JSC is still
            // alive (closeAll() fires on_close → JS).
            // TODO(b2-cycle): `RareData::close_all_socket_groups(self)` is
            // gated in `rare_data.rs::_accessor_body`.

            // SAFETY: extern "C" FFI; `self.global` is the live VM global.
            unsafe { Zig__GlobalObject__destructOnExit(self.global) };

            // lastChanceToFinalize() above runs Listener/Server finalize →
            // their own embedded group.closeAll() → sockets land in
            // loop.closed_head. Drain again now or LSAN reports every accepted
            // socket that was still open at process.exit().
            // SAFETY: `uws::Loop::get()` returns the process-global usockets
            // loop, which is live for the process lifetime.
            unsafe { (*uws::Loop::get()).drain_closed_sockets() };

            // TODO(b2-cycle): `self.transpiler.deinit()` /
            // `self.gc_controller.deinit()` / `self.deinit()` — `gc_controller`
            // is a `()` placeholder and `destroy()` is gated. The whole
            // `BUN_DESTRUCT_VM_ON_EXIT` branch is opt-in debug behaviour;
            // un-gate piecewise as the field types widen.
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
// installs the static instance at startup via `set_runtime_hooks`. Every call
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
    pub init_runtime_state: unsafe fn(vm: *mut VirtualMachine, opts: &InitOptions) -> RuntimeState,
    /// Reclaim the per-VM state boxed by `init_runtime_state`. Called from
    /// [`VirtualMachine::destroy`] (worker teardown) with the exact opaque
    /// pointer `init_runtime_state` returned (or null). The high tier
    /// `Box::from_raw`s it and clears its thread-local cache. Spec
    /// VirtualMachine.zig: `timer`/`entry_point` are value fields freed in
    /// worker `destroy()`; without this slot every worker leaked one box.
    pub deinit_runtime_state: unsafe fn(vm: *mut VirtualMachine, state: RuntimeState),
    /// `ServerEntryPoint.generate(watch, entry_path)` — produces the synthetic
    /// `bun:main` module body for `entry_path`. Returns `false` on error
    /// (error already logged into `vm.log`).
    pub generate_entry_point:
        unsafe fn(vm: *mut VirtualMachine, watch: bool, entry_path: &[u8]) -> bool,
    /// `loadPreloads()` — runs `--preload` scripts. Returns the in-flight
    /// promise if a preload is async, else null.
    pub load_preloads: unsafe fn(vm: *mut VirtualMachine) -> *mut JSInternalPromise,
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
        unsafe fn(vm: *mut VirtualMachine, value: JSValue, exception_list: Option<&mut ExceptionList>),
    /// `vm.timer.insert(&mut event_loop_timer)` — `Timer::All` lives in
    /// `bun_runtime::RuntimeState` (b2-cycle); low-tier callers
    /// (`AbortSignal::Timeout`) reach it through this slot.
    pub timer_insert:
        unsafe fn(vm: *mut VirtualMachine, timer: *mut bun_event_loop::EventLoopTimer::EventLoopTimer),
    /// `vm.timer.remove(&mut event_loop_timer)` — see `timer_insert`.
    pub timer_remove:
        unsafe fn(vm: *mut VirtualMachine, timer: *mut bun_event_loop::EventLoopTimer::EventLoopTimer),
    /// `Node.fs.NodeFS{ .vm = … }` lazy creation (spec VirtualMachine.zig:827).
    /// `NodeFS` lives in `bun_runtime`; the high tier boxes one and returns
    /// the type-erased pointer. Stored back into `vm.node_fs`.
    pub create_node_fs: unsafe fn(vm: *mut VirtualMachine) -> *mut c_void,
    /// `Body.Value.HiveRef.init(body, &vm.body_value_hive_allocator)` — spec
    /// VirtualMachine.zig:255. The hive allocator lives inside `runtime_state`
    /// (high tier); `body` and the returned `*mut Body.Value.HiveRef` are
    /// erased here and cast back on the `bun_runtime` side.
    pub init_request_body_value:
        unsafe fn(vm: *mut VirtualMachine, body: *mut c_void) -> *mut c_void,
    /// `WebCore.ObjectURLRegistry.singleton().has(specifier["blob:".len..])` —
    /// spec VirtualMachine.zig:1760. Registry lives in `bun_runtime::webcore`.
    pub has_blob_url: unsafe fn(blob_id: &[u8]) -> bool,
    /// The static `VmLoaderVTable` instance for [`fetch_without_on_load_plugins`]
    /// — its function pointers reach into `Blob`/`ObjectURLRegistry`
    /// (`bun_runtime::webcore`), so the high tier supplies the table.
    pub vm_loader_vtable: &'static bun_bundler::options::VmLoaderVTable,
    /// `node_cluster_binding.handleInternalMessageChild(global, data)` — spec
    /// VirtualMachine.zig:3960 (IPCInstance.handleIPCMessage `.internal` arm).
    pub handle_ipc_internal_child: unsafe fn(global: *mut JSGlobalObject, data: JSValue),
    /// `node_cluster_binding.child_singleton.deinit()` — spec
    /// VirtualMachine.zig:3972 (IPCInstance.handleIPCClose).
    pub ipc_child_singleton_deinit: unsafe fn(),
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

static RUNTIME_HOOKS: core::sync::atomic::AtomicPtr<RuntimeHooks> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

/// Called by `bun_runtime` at startup to install the real hook table.
/// `hooks` must have `'static` lifetime (typically `&'static RUNTIME_HOOKS_IMPL`).
pub fn set_runtime_hooks(hooks: &'static RuntimeHooks) {
    // SAFETY: `AtomicPtr` only stores `*mut T`, but this pointer is never
    // written through — `runtime_hooks()` only ever materializes `&'static
    // RuntimeHooks` via `as_ref()`. The `cast_mut()` is an API-shape coercion,
    // not a mutability grant.
    RUNTIME_HOOKS.store(
        core::ptr::from_ref(hooks).cast_mut(),
        core::sync::atomic::Ordering::Release,
    );
}

#[inline]
fn runtime_hooks() -> Option<&'static RuntimeHooks> {
    let p = RUNTIME_HOOKS.load(core::sync::atomic::Ordering::Acquire);
    // SAFETY: `p` was stored from a `&'static RuntimeHooks` (or is null).
    unsafe { p.as_ref() }
}

// TODO(port): move to jsc_sys
#[allow(improper_ctypes)] // VirtualMachine is opaque to C++; passed as `void*`
unsafe extern "C" {
    // Spec JSGlobalObject.zig:863 / headers.h:435 — note the real symbol is
    // `Zig__GlobalObject__create` and takes 5 args (no leading `vm`); the Zig
    // wrapper `JSGlobalObject.create` accepts `vm` only to call
    // `vm.eventLoop().ensureWaker()` before the FFI.
    fn Zig__GlobalObject__create(
        console: *mut c_void,
        context_id: i32,
        mini_mode: bool,
        eval_mode: bool,
        worker_ptr: *mut c_void,
    ) -> *mut JSGlobalObject;
    fn Bun__loadHTMLEntryPoint(global: *mut JSGlobalObject) -> *mut JSInternalPromise;
    fn JSC__VM__executionForbidden(vm: *mut VM) -> bool;
    fn JSC__VM__holdAPILock(vm: *mut VM, ctx: *mut c_void, callback: extern "C" fn(ctx: *mut c_void));
    fn NodeModuleModule__callOverriddenRunMain(global: *mut JSGlobalObject, argv1: JSValue) -> JSValue;
    fn JSC__JSInternalPromise__resolvedPromise(global: *mut JSGlobalObject, value: JSValue) -> *mut JSInternalPromise;
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
    pub fn init(opts: InitOptions) -> Result<*mut VirtualMachine, bun_core::Error> {
        jsc::mark_binding();

        // Spec VirtualMachine.zig:1234 — `opts.log orelse allocator.create(Log)`.
        let log: *mut logger::Log = match opts.log {
            Some(l) => l.as_ptr(),
            None => Box::into_raw(Box::new(logger::Log::default())),
        };

        // SAFETY: VM is large + self-referential; allocate zeroed and fill in
        // place (mirrors Zig's `allocator.create` + struct-init). The
        // allocation lives for the thread lifetime (never freed on the main
        // thread; worker `destroy()` frees it explicitly).
        // TODO(port): zeroing is not strictly init-safe for every field
        // (e.g. `std::time::Instant`); Phase B should switch to
        // `MaybeUninit` + `addr_of_mut!` per-field writes.
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
        VMHolder::VM.set(Some(vm));
        if opts.is_main_thread {
            // SAFETY: written once during main-thread init.
            unsafe { MAIN_THREAD_VM = Some(vm) };
        }
        // SAFETY: `vm` is a fresh unique allocation on this thread.
        let vm_ref = unsafe { &mut *vm };

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
        let console = Box::into_raw(console_box) as *mut crate::console_object::ConsoleObject;

        vm_ref.global = core::ptr::null_mut();
        vm_ref.console = console;
        // SAFETY: `log` is a fresh leaked Box; outlives the VM.
        vm_ref.log = NonNull::new(log);
        vm_ref.main = b"";
        vm_ref.main_hash = 0;
        vm_ref.main_resolved_path = bun_string::String::empty();
        vm_ref.hide_bun_stackframes = true;
        vm_ref.is_main_thread = opts.is_main_thread;
        vm_ref.on_unhandled_rejection = VirtualMachine::default_on_unhandled_rejection;
        vm_ref.origin_timer = std::time::Instant::now();
        vm_ref.origin_timestamp = get_origin_timestamp();
        vm_ref.smol = opts.smol;
        vm_ref.standalone_module_graph = NonNull::new(opts.graph);
        vm_ref.initial_script_execution_context_identifier = opts
            .context_id
            .unwrap_or(if opts.is_main_thread { 1 } else { i32::MAX });
        #[cfg(debug_assertions)]
        {
            vm_ref.debug_thread_id = std::thread::current().id();
        }

        // Event-loop wiring (self-pointers).
        vm_ref.regular_event_loop = EventLoop::default();
        vm_ref.regular_event_loop.virtual_machine = NonNull::new(vm);
        let _ = vm_ref.regular_event_loop.tasks.ensure_unused_capacity(64);
        vm_ref.event_loop = &mut vm_ref.regular_event_loop;

        // `source_mappings.map` is a sibling-field backref onto
        // `saved_source_map_table` (spec VirtualMachine.zig:1273).
        vm_ref.saved_source_map_table = crate::saved_source_map::HashTable::default();
        vm_ref.source_mappings = SavedSourceMap::default();
        vm_ref.source_mappings.map = &mut vm_ref.saved_source_map_table;

        // Capture inputs and end `vm_ref`'s last use BEFORE the hook/FFI
        // below: both re-enter Rust via the thread-local raw `vm` stored
        // above — a parent provenance of `vm_ref` — so any access during the
        // call invalidates `vm_ref`'s Unique tag under Stacked Borrows.
        let context_id = vm_ref.initial_script_execution_context_identifier;

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
            unsafe { (*vm).runtime_state = (hooks.init_runtime_state)(vm, &opts) };
        }

        // JSGlobalObject creation. Spec JSGlobalObject.zig:875 — the wrapper
        // calls `vm.eventLoop().ensureWaker()` before the 5-arg FFI.
        // SAFETY: `vm` is the unique live VM on this thread; raw-ptr deref so
        // no `&mut` is held across the FFI re-entry (`Bun__getVM()` —
        // ZigGlobalObject.cpp:473/961).
        unsafe { (*vm).regular_event_loop.ensure_waker() };
        // SAFETY: extern "C" FFI; `console` valid. `worker_ptr` is the C++
        // `WebCore::Worker*` (or null on the main thread) — spec
        // VirtualMachine.zig:1477-1484 / JSGlobalObject.zig:876.
        let global = unsafe {
            Zig__GlobalObject__create(
                console.cast(),
                context_id,
                opts.mini_mode,
                opts.eval_mode,
                opts.worker_ptr,
            )
        };
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
        VMHolder::CACHED_GLOBAL_OBJECT.set(Some(global));

        // Spec VirtualMachine.zig:1313: `uws.Loop.get().internal_loop_data.jsc_vm
        // = vm.jsc_vm` — must run AFTER `jsc_vm` is set so C/uws callbacks can
        // recover the JSC VM via `internal_loop_data`.
        // SAFETY: `uws::Loop::get()` returns the live per-thread uws loop.
        unsafe {
            (*uws::Loop::get()).internal_loop_data.jsc_vm = jsc_vm.cast();
        }

        if opts.smol {
            // SAFETY: written once during init.
            unsafe { IS_SMOL_MODE = true };
        }

        Ok(vm)
    }

    /// `init` + set `main` to `entry_path`. Port-side convenience for the
    /// `bun -e` / `bun run <file>` boot path; Zig open-codes this in
    /// `run_command.zig`.
    pub fn init_with_main(
        opts: InitOptions,
        entry_path: &'static [u8],
    ) -> Result<*mut VirtualMachine, bun_core::Error> {
        let vm = Self::init(opts)?;
        // SAFETY: `vm` is the unique live VM on this thread.
        let vm_ref = unsafe { &mut *vm };
        vm_ref.main = entry_path;
        vm_ref.main_hash = bun_watcher::Watcher::get_hash(entry_path);
        Ok(vm)
    }

    /// `eventLoop().waitForPromise(promise)` — spin tick/auto_tick until
    /// `promise` settles. Thin forwarder; body lives in
    /// [`crate::event_loop::EventLoop::wait_for_promise`] (spec event_loop.zig).
    #[inline]
    pub fn wait_for_promise(&mut self, promise: jsc::AnyPromise) {
        // SAFETY: `event_loop` is a self-pointer into this VM; uniquely
        // accessed here (no overlapping `&mut EventLoop`).
        unsafe { (*self.event_loop()).wait_for_promise(promise) };
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
            // SAFETY: `event_loop` is a self-pointer into this VM.
            unsafe { (*self.event_loop()).tick() };
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
            // SAFETY: `event_loop` self-ptr; uniquely accessed here.
            unsafe { (*self.event_loop()).tick() };
        }
    }

    /// `reloadEntryPoint(entry_path)` — set `main`, generate the synthetic
    /// `bun:main` entry, run preloads, and kick off module evaluation.
    pub fn reload_entry_point(
        &mut self,
        entry_path: &'static [u8],
    ) -> Result<*mut JSInternalPromise, bun_core::Error> {
        self.has_loaded = false;
        self.main = entry_path;
        self.main_resolved_path.deref();
        self.main_resolved_path = bun_string::String::empty();
        self.main_hash = bun_watcher::Watcher::get_hash(entry_path);
        self.overridden_main.deinit();

        let hooks = runtime_hooks();
        if let Some(hooks) = hooks {
            // SAFETY: hook contract — `self` is the live per-thread VM.
            unsafe { (hooks.ensure_debugger)(self, true) };
        }

        if !self.main_is_html_entrypoint {
            if let Some(hooks) = hooks {
                let watch = self.is_watcher_enabled();
                // SAFETY: hook contract.
                if !unsafe { (hooks.generate_entry_point)(self, watch, entry_path) } {
                    return Err(bun_core::err!("ServerEntryPointGenerate"));
                }
            }
        }

        if !self.transpiler.options.disable_transpilation {
            if !self.preload.is_empty() {
                if let Some(hooks) = hooks {
                    // SAFETY: hook contract.
                    let p = unsafe { (hooks.load_preloads)(self) };
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
                #[cold]
                #[inline(never)]
                fn cold() {}
                cold();
                self.pending_internal_promise = None;
                self.pending_internal_promise_is_protected = false;
                let global = self.global;
                // SAFETY: `global` is set during init and live for the VM lifetime.
                let global_ref = unsafe { &*global };
                let argv1 = jsc::bun_string_jsc::create_utf8_for_js(global_ref, MAIN_FILE_NAME)
                    .map_err(|_| bun_core::err!("JSError"))?;
                // SAFETY: extern "C" FFI; global valid for VM lifetime.
                let ret = jsc::from_js_host_call_generic(global_ref, || unsafe {
                    NodeModuleModule__callOverriddenRunMain(global, argv1)
                })
                .map_err(|_| bun_core::err!("JSError"))?;
                // If the override stored a promise itself, use that; otherwise
                // wrap its return value.
                if let Some(stored) = self.pending_internal_promise {
                    return Ok(stored);
                }
                // SAFETY: extern "C" FFI; global valid for VM lifetime.
                let resolved = unsafe { JSC__JSInternalPromise__resolvedPromise(global, ret) };
                self.pending_internal_promise = Some(resolved);
                self.pending_internal_promise_is_protected = false;
                    return Ok(resolved);
                }
            }

            // PORT NOTE: reshaped for borrowck — capture raw ptr before &self call.
            let global = self.global;
            // SAFETY: `global` is set during init and live for the VM lifetime.
            let global_ref = unsafe { &*global };
            let promise = if !self.main_is_html_entrypoint {
                let name = bun_string::String::borrow_utf8(MAIN_FILE_NAME);
                jsc::JSModuleLoader::load_and_evaluate_module_ptr(global, Some(&name))
                    .map(NonNull::as_ptr)
                    .ok_or_else(|| bun_core::err!("JSError"))?
            } else {
                // SAFETY: extern "C" FFI; global valid for VM lifetime.
                let p = jsc::from_js_host_call_generic(global_ref, || unsafe {
                    Bun__loadHTMLEntryPoint(global)
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
            let main_str = bun_string::String::from_bytes(self.main);
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
        entry_path: &'static [u8],
    ) -> Result<*mut JSInternalPromise, bun_core::Error> {
        let promise = self.reload_entry_point(entry_path)?;

        // pending_internal_promise can change if hot module reloading is enabled
        if self.is_watcher_enabled() {
            // SAFETY: `event_loop` is a self-pointer into this VM; uniquely
            // accessed here (no overlapping `&mut EventLoop`).
            unsafe { (*self.event_loop()).perform_gc() };
            loop {
                let Some(p) = self.pending_internal_promise else { break };
                // SAFETY: `p` is a live JSC heap cell tracked by the VM.
                if unsafe { (*p).status() } != crate::js_promise::Status::Pending {
                    break;
                }
                // SAFETY: see above re: `event_loop`.
                unsafe { (*self.event_loop()).tick() };
                let Some(p) = self.pending_internal_promise else { break };
                // SAFETY: see above.
                if unsafe { (*p).status() } == crate::js_promise::Status::Pending {
                    self.auto_tick();
                }
            }
        } else {
            // SAFETY: `promise` is a live JSC heap cell.
            if unsafe { (*promise).status() } == crate::js_promise::Status::Rejected {
                return Ok(promise);
            }
            // SAFETY: `event_loop` is a self-pointer into this VM.
            unsafe { (*self.event_loop()).perform_gc() };
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
        if unsafe { (*self.event_loop()).entered_event_loop_count } > 0 {
            return;
        }
        // SAFETY: see above.
        unsafe { (*self.event_loop()).tick() };
        // SAFETY: see above.
        let _ = unsafe { (*self.event_loop()).drain_microtasks() };
        // SAFETY: global is valid for VM lifetime.
        unsafe { (*self.global).handle_rejected_promises() };
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
/// only used `globalThis.allocator()` for the format buffers, which is
/// `bun.default_allocator` (= global mimalloc) and dropped per §Allocators.
pub fn process_fetch_log(
    global_this: &JSGlobalObject,
    specifier: bun_string::String,
    referrer: bun_string::String,
    log: &mut logger::Log,
    ret: &mut ErrorableResolvedSource,
    err: bun_core::Error,
) {
    use crate::{BuildMessage, ResolveMessage, ZigString};

    // Helper: `expr catch |e| globalThis.takeException(e)`.
    let take = |r: JsResult<JSValue>| -> JSValue {
        r.unwrap_or_else(|e| global_this.take_exception(e))
    };

    // Spec: `referrer.toUTF8(bun.default_allocator)` — `ResolveMessage::create`
    // takes raw `&[u8]` and stores them verbatim, so we must convert here.
    let referrer_utf8 = referrer.to_utf8();

    match log.msgs.len() {
        0 => {
            let msg = if err == bun_core::err!("UnexpectedPendingResolution") {
                logger::Msg {
                    data: logger::range_data(
                        None,
                        logger::Range::NONE,
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
                logger::Msg {
                    data: logger::range_data(
                        None,
                        logger::Range::NONE,
                        format!("{} while building {specifier}", err.name()).into_bytes(),
                    ),
                    ..Default::default()
                }
            };
            *ret = ErrorableResolvedSource::err(
                err,
                take(BuildMessage::create(global_this, msg)),
            );
        }

        1 => {
            // PORT NOTE: Zig copied `log.msgs.items[0]` by value; `Msg` is not
            // `Copy` here, so move it out — the caller `defer log.deinit()`s
            // immediately after, so consuming the vec is sound.
            let msg = log.msgs.swap_remove(0);
            let value = match msg.metadata {
                logger::Metadata::Build => take(BuildMessage::create(global_this, msg)),
                logger::Metadata::Resolve(_) => {
                    take(ResolveMessage::create(global_this, &msg, referrer_utf8.slice()))
                }
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
                    logger::Metadata::Build => take(BuildMessage::create(global_this, msg)),
                    logger::Metadata::Resolve(_) => {
                        take(ResolveMessage::create(global_this, &msg, referrer_utf8.slice()))
                    }
                };
                errors.push(v);
            }

            // PORT NOTE: Zig leaked the `allocPrint` buffer into a borrowed
            // `ZigString` (the AggregateError copies it into a JSString). Keep
            // `message_text` alive across the FFI call instead.
            let message_text =
                format!("{} errors building \"{specifier}\"", errors.len()).into_bytes();
            let message = ZigString::init(&message_text);
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
        Self { vm, printer, _marker: core::marker::PhantomData }
    }

    pub fn get(&mut self) -> bun_js_printer::SourceMapHandler<'_> {
        // SAFETY: `vm` was set from a live `&'a mut VirtualMachine` in
        // `source_map_handler`; the getter's lifetime `'a` bounds the borrow.
        // VirtualMachine.zig:408: take the inline-sourcemap path only when a
        // debugger is present AND it is *not* in `.connect` mode — `.connect`
        // (VSCode-extension) clients fall through to the `source_mappings`
        // fast-path handler.
        let wants_inline_source_map = unsafe {
            matches!(
                (*self.vm).debugger,
                Some(ref d) if d.mode != crate::debugger::Mode::Connect
            )
        };
        if !wants_inline_source_map {
            // SAFETY: same provenance as above; `source_mappings` is a value
            // field on the VM, exclusively borrowed for the returned handler's
            // lifetime (which is bounded by `&mut self`).
            let source_mappings = unsafe { &mut (*self.vm).source_mappings };
            return bun_js_printer::SourceMapHandler::for_(source_mappings);
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
        source: &logger::Source,
    ) -> Result<(), bun_core::Error> {
        let mut temp_json_buffer = bun_string::MutableString::init_empty();
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

        // SAFETY: `vm` was set from a live `&'a mut VirtualMachine` in
        // `source_map_handler`. `printer` is the raw `*mut BufferPrinter`
        // passed in by the caller (jsc_hooks.rs), with the SAME provenance as
        // the `writer` arg to `print_with_source_map`. By the time
        // `on_source_map_chunk` runs (js_printer/lib.rs `print_ast` /
        // `print_common_js` tail), the writer has emitted its last byte; we
        // reborrow from the raw pointer here rather than from a stashed
        // `&'a mut` so no Unique tag is held across the writer's lifetime.
        // The caller MUST rederive its own `&mut BufferPrinter` from the raw
        // pointer after `print_with_source_map` returns (see jsc_hooks.rs).
        let vm = unsafe { &mut *self.vm };
        let printer = unsafe { &mut *self.printer };

        vm.source_mappings.put_mappings(source, chunk.buffer)?;
        let encode_len = bun_base64::encode_len(temp_json_buffer.list.as_slice());
        printer.ctx.buffer.grow_if_needed(encode_len + prefix_len + 2)?;
        // Zig: "\n" ++ source_map_url_prefix_start
        printer.ctx.buffer.append_assume_capacity(b"\n");
        printer
            .ctx
            .buffer
            .append_assume_capacity(SOURCE_MAP_URL_PREFIX_START);
        {
            // Zig wrote into `buffer.list.items.ptr[len..capacity]` then bumped
            // `items.len`. `MutableString::list` is a `Vec<u8>`; mirror that with
            // a spare-capacity write + `set_len`.
            let buf = &mut printer.ctx.buffer.list;
            let old_len = buf.len();
            debug_assert!(buf.capacity() - old_len >= encode_len);
            // SAFETY: capacity reserved by `grow_if_needed` above; `encode`
            // writes exactly `wrote <= encode_len` initialized bytes into the
            // spare region, and `set_len` only exposes the initialized prefix.
            let wrote = unsafe {
                let spare = core::slice::from_raw_parts_mut(
                    buf.as_mut_ptr().add(old_len),
                    encode_len,
                );
                bun_base64::encode(spare, temp_json_buffer.list.as_slice())
            };
            // PORT NOTE: Zig added `encode_len` unconditionally; the simdutf
            // encoder returns the exact bytes written, so use that — same value
            // for the standard alphabet (`encode_len` is the calc-size upper
            // bound which equals the output for non-URL base64).
            unsafe { buf.set_len(old_len + wrote) };
        }
        printer.ctx.buffer.append_assume_capacity(SOURCE_MAPPING_URL);
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
    pub log: Option<NonNull<logger::Log>>,
    // TODO(port): lifetime — `&'a mut bun_dot_env::Loader`.
    pub env_loader: Option<NonNull<bun_dotenv::Loader<'static>>>,
    pub store_fd: bool,
    pub smol: bool,
    // TODO(b2-cycle): real type is `bun_runtime::api::dns::Resolver::Order`.
    pub dns_result_order: u8,
    /// `--print` needs the result from evaluating the main module.
    pub eval: bool,
    // TODO(b2-cycle): real type is `bun_standalone_module_graph::StandaloneModuleGraph`,
    // but that crate is not at this tier. Stored opaque.
    pub graph: Option<NonNull<c_void>>,
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
    Waiting { fd: bun_sys::Fd, mode: crate::ipc::Mode },
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
        Box::into_raw(Box::new(v))
    }
    pub fn ipc(&mut self) -> Option<&mut crate::ipc::SendQueue> {
        Some(&mut self.data)
    }
    pub fn get_global_this(&self) -> Option<*mut JSGlobalObject> {
        Some(self.global_this)
    }
    /// Only reached from the `get_ipc_instance` error path.
    pub fn deinit(this: *mut IPCInstance) {
        // SAFETY: `this` was produced by `IPCInstance::new` (Box::into_raw).
        // `SendQueue` cleans itself up via `Drop`.
        drop(unsafe { Box::from_raw(this) });
    }

    /// Spec VirtualMachine.zig:3940 `IPCInstance.handleIPCMessage`.
    pub fn handle_ipc_message(
        &mut self,
        message: crate::ipc::DecodedIPCMessage,
        handle: JSValue,
    ) {
        crate::mark_binding!();
        let global_this = self.global_this;
        // SAFETY: VM singleton + its event loop are process-lifetime.
        let event_loop = unsafe { &mut *(*VirtualMachine::get()).event_loop() };

        match message {
            // In future versions we can read this in order to detect version mismatches,
            // or disable future optimizations if the subprocess is old.
            crate::ipc::DecodedIPCMessage::Version(v) => {
                bun_core::scoped_log!(IPC, "Parent IPC version is {}", v);
            }
            crate::ipc::DecodedIPCMessage::Data(data) => {
                bun_core::scoped_log!(IPC, "Received IPC message from parent");
                event_loop.enter();
                // SAFETY: extern "C" FFI; `global_this` is the live VM global.
                unsafe { Process__emitMessageEvent(global_this, data, handle) };
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
        let vm = unsafe { &mut *VirtualMachine::get() };
        // SAFETY: event loop is process-lifetime.
        let event_loop = unsafe { &mut *vm.event_loop() };
        if let Some(hooks) = runtime_hooks() {
            // SAFETY: hook fn is supplied by `bun_runtime` at startup.
            unsafe { (hooks.ipc_child_singleton_deinit)() };
        }
        event_loop.enter();
        // SAFETY: extern "C" FFI; `vm.global` is the live VM global.
        unsafe { Process__emitDisconnectEvent(vm.global) };
        event_loop.exit();
        // Group is embedded in RareData and shared with subprocess IPC; nothing
        // to free here.
        vm.channel_ref.disable();
    }
}

unsafe extern "C" {
    fn Process__emitMessageEvent(global: *mut JSGlobalObject, value: JSValue, handle: JSValue);
    fn Process__emitDisconnectEvent(global: *mut JSGlobalObject);
}

/// `IPC.SendQueue` owner dispatch for the child-side `IPCInstance`. Mirrors
/// `SUBPROCESS_IPC_OWNER_VTABLE` in `bun_runtime`; lives here because
/// `IPCInstance` itself is defined in this crate.
pub static IPCINSTANCE_OWNER_VTABLE: crate::ipc::SendQueueOwnerVTable =
    crate::ipc::SendQueueOwnerVTable {
        global_this: |ptr| {
            // SAFETY: `ptr` was set from a live `*mut IPCInstance` in
            // `get_ipc_instance` below; the SendQueue is stored inline in
            // `IPCInstance.data` and dropped before the IPCInstance is freed.
            unsafe { (*ptr.cast::<IPCInstance>()).global_this }
        },
        handle_ipc_close: |ptr| {
            // SAFETY: see `global_this`.
            unsafe { (*ptr.cast::<IPCInstance>()).handle_ipc_close() }
        },
        handle_ipc_message: |ptr, msg, handle| {
            // SAFETY: see `global_this`.
            unsafe { (*ptr.cast::<IPCInstance>()).handle_ipc_message(msg, handle) }
        },
        // VM-side owner has no JS-visible `this` (Zig: `.null` arm).
        this_jsvalue: |_| JSValue::ZERO,
    };

/// Spec VirtualMachine.zig:1708 `ResolveFunctionResult`.
#[derive(Default)]
pub struct ResolveFunctionResult {
    pub result: Option<bun_resolver::Result>,
    pub path: &'static [u8], // TODO(port): lifetime — borrows resolver arena
    pub query_string: &'static [u8],
}

thread_local! {
    /// Spec VirtualMachine.zig:1584 `source_code_printer`.
    pub static SOURCE_CODE_PRINTER: Cell<Option<NonNull<bun_js_printer::BufferPrinter>>> =
        const { Cell::new(None) };
}

/// Spec VirtualMachine.zig:1712 `normalizeSpecifierForResolution`.
fn normalize_specifier_for_resolution<'a>(
    specifier_: &'a [u8],
    query_string: &mut &'a [u8],
) -> &'a [u8] {
    if let Some(i) = bun_string::strings::index_of_char(specifier_, b'?') {
        let i = i as usize;
        *query_string = &specifier_[i..];
        &specifier_[..i]
    } else {
        specifier_
    }
}

thread_local! {
    /// Spec VirtualMachine.zig:1722 `specifier_cache_resolver_bufs`.
    static SPECIFIER_CACHE_RESOLVER_BUF: core::cell::UnsafeCell<bun_paths::PathBuffer> =
        const { core::cell::UnsafeCell::new(bun_paths::PathBuffer::ZEROED) };
}

fn ensure_source_code_printer() {
    if SOURCE_CODE_PRINTER.get().is_none() {
        let writer = bun_js_printer::BufferWriter::init();
        let mut printer = Box::new(bun_js_printer::BufferPrinter::init(writer));
        printer.ctx.append_null_byte = false;
        SOURCE_CODE_PRINTER.set(NonNull::new(Box::into_raw(printer)));
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
// PERF(port): hoist into `bun_string` once `lib_draft_b1.rs` un-gates.
#[inline]
pub fn create_if_different(s: &bun_string::String, other: &[u8]) -> bun_string::String {
    if s.eql_utf8(other) {
        return s.dupe_ref();
    }
    bun_string::String::clone_utf8(other)
}

// Additional FFI used by the formerly-gated impl.
#[allow(improper_ctypes)]
unsafe extern "C" {
    fn Bake__getAsyncLocalStorage(global: *mut JSGlobalObject) -> JSValue;
    fn Bun__promises__isErrorLike(global: *mut JSGlobalObject, reason: JSValue) -> bool;
    fn Bun__promises__emitUnhandledRejectionWarning(
        global: *mut JSGlobalObject,
        reason: JSValue,
        promise: JSValue,
    );
    fn Bun__noSideEffectsToString(vm: *mut VM, global: *mut JSGlobalObject, reason: JSValue) -> JSValue;
    fn BakeCreateProdGlobal(console_ptr: *mut c_void) -> *mut JSGlobalObject;
    fn JSC__JSGlobalObject__reload(this: *mut JSGlobalObject);
}

extern "C" fn free_ref_string(str_: *mut crate::ref_string::RefString, _: *mut c_void, _: u32) {
    // SAFETY: `str_` is the `ctx` we passed to `String::create_external` in
    // `ref_counted_string_with_was_new`; it points at a heap `RefString`.
    unsafe { crate::ref_string::RefString::destroy(str_) };
}

impl VirtualMachine {
    /// Spec VirtualMachine.zig:234 `getDevServerAsyncLocalStorage`.
    pub fn get_dev_server_async_local_storage(&mut self) -> JsResult<Option<JSValue>> {
        let global = self.global;
        // SAFETY: `global` is valid for VM lifetime.
        let global_ref = unsafe { &*global };
        let jsvalue = jsc::from_js_host_call(global_ref, || unsafe {
            Bake__getAsyncLocalStorage(global)
        })?;
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
        // SAFETY: `transpiler.env` is set during init and live for VM lifetime.
        unsafe { (*self.transpiler.env).get_tls_reject_unauthorized() }
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
        if let Some(verbose_fetch) = unsafe { (*self.transpiler.env).get(b"BUN_CONFIG_VERBOSE_FETCH") } {
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
        // SAFETY: `transpiler.env` is set during init and live for VM lifetime.
        let map = unsafe { &mut *(*self.transpiler.env).map };

        ensure_source_code_printer();

        if map.get(b"BUN_SHOW_BUN_STACKFRAMES").is_some() {
            self.hide_bun_stackframes = false;
        }

        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER::get()
            .unwrap_or(false)
        {
            // TODO(b2): `transpiler_store` is a `()` placeholder; flip
            // `.enabled = false` once `RuntimeTranspilerStore` un-gates.
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
            match core::str::from_utf8(&fd_s)
                .ok()
                .and_then(|s| s.parse::<u32>().ok())
            {
                Some(fd) => self.init_ipc_instance(bun_sys::Fd::from_uv(fd as i32), mode),
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
                // SAFETY: process-global written once at startup.
                unsafe { has_bun_garbage_collector_flag_enabled = true };
            } else if gc_level == b"2" {
                self.aggressive_garbage_collection = GCLevel::Aggressive;
                // SAFETY: process-global written once at startup.
                unsafe { has_bun_garbage_collector_flag_enabled = true };
            }
            if let Some(value) = map.get(b"BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT") {
                match core::str::from_utf8(value)
                    .ok()
                    .and_then(|s| s.parse::<usize>().ok())
                {
                    Some(limit) => {
                        // SAFETY: process-global written once at startup.
                        unsafe {
                            SYNTHETIC_ALLOCATION_LIMIT = limit;
                            STRING_ALLOCATION_LIMIT = limit;
                        }
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

        // SAFETY: `isBunTest` is a process-global written once at startup.
        if unsafe { isBunTest } {
            self.unhandled_error_counter += 1;
            (self.on_unhandled_rejection)(self, global_object, reason);
            return;
        }

        let global = global_object.as_ptr();
        // PORT NOTE: Zig `defer eventLoop().drainMicrotasks()` per-arm —
        // hoisted into a closure.
        let drain = |this: &mut Self| {
            // SAFETY: `event_loop` is a self-pointer into this VM.
            let _ = unsafe { (*this.event_loop()).drain_microtasks() };
        };
        let emit_warning = |this: &mut Self| {
            let r = jsc::from_js_host_call_generic(global_object, || unsafe {
                Bun__promises__emitUnhandledRejectionWarning(global, reason, promise)
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
                // SAFETY: extern "C" FFI; `global` valid for VM lifetime.
                if unsafe { Bun__handleUnhandledRejection(global, reason, promise) } > 0 {
                    return;
                }
                // continue to default handler
            }
            Mode::None => {
                let _ = unsafe { Bun__handleUnhandledRejection(global, reason, promise) };
                drain(self);
                return; // ignore the unhandled rejection
            }
            Mode::Warn => {
                let _ = unsafe { Bun__handleUnhandledRejection(global, reason, promise) };
                emit_warning(self);
                drain(self);
                return;
            }
            Mode::WarnWithErrorCode => {
                let handled = unsafe { Bun__handleUnhandledRejection(global, reason, promise) } > 0;
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
                let wrapped = wrap_unhandled_rejection_error_for_uncaught_exception(
                    global_object,
                    reason,
                );
                let _ = self.uncaught_exception(global_object, wrapped, true);
                let handled = unsafe { Bun__handleUnhandledRejection(global, reason, promise) } > 0;
                if !handled {
                    emit_warning(self);
                }
                drain(self);
                return;
            }
            Mode::Throw => {
                if unsafe { Bun__handleUnhandledRejection(global, reason, promise) } > 0 {
                    drain(self);
                    return;
                }
                let wrapped = wrap_unhandled_rejection_error_for_uncaught_exception(
                    global_object,
                    reason,
                );
                if self.uncaught_exception(global_object, wrapped, true) {
                    drain(self);
                    return;
                }
                // continue to default handler — but spec VirtualMachine.zig
                // :667-669 RETURNS on `error.JSTerminated` from this drain
                // (the VM is dead; don't bump the counter or invoke the
                // handler).
                // SAFETY: `event_loop` is a self-pointer into this VM.
                if let Err(JsError::Terminated) =
                    unsafe { (*self.event_loop()).drain_microtasks() }
                {
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
        match unsafe { (*promise).status() } {
            crate::js_promise::Status::Pending => {
                self.add_main_to_watcher_if_needed();
                return;
            }
            crate::js_promise::Status::Rejected => {
                if self.pending_internal_promise_reported_at != self.hot_reload_counter {
                    self.pending_internal_promise_reported_at = self.hot_reload_counter;
                    // PORT NOTE: reshaped for borrowck — capture raw before &mut self call.
                    let global = self.global;
                    // SAFETY: `global` valid for VM lifetime.
                    let global_ref = unsafe { &*global };
                    // SAFETY: `promise` is a live JSC heap cell.
                    let result = unsafe { (*promise).result(global_ref.vm()) };
                    let promise_js = JSValue::from_cell(promise);
                    self.unhandled_rejection(global_ref, result, promise_js);
                    // SAFETY: see above.
                    unsafe { (*promise).set_handled() };
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
        let main = self.main;
        if main.is_empty() {
            return;
        }
        let ext = bun_paths::extension(main);
        let loader = self.transpiler.options.loader(ext);
        // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set when
        // `is_watcher_enabled()`; the cast recovers the concrete type.
        unsafe {
            let watcher = &mut *(self.bun_watcher as *mut crate::hot_reloader::ImportWatcher);
            let _ = watcher.add_file_by_path_slow(main, loader);
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
        unsafe { &mut *(pm as *mut _ as *mut bun_install::PackageManager) }
    }

    /// Spec VirtualMachine.zig:769 `reload`.
    pub fn reload(&mut self, _: Option<&mut crate::hot_reloader::HotReloadTask>) {
        if let Some(p) = self.pending_internal_promise {
            // SAFETY: `p` is a live JSC heap cell tracked by the VM.
            match unsafe { (*p).status() } {
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
        // SAFETY: `transpiler.env` is set during init and live for VM lifetime.
        let should_clear_terminal = !unsafe {
            (*self.transpiler.env)
                .has_set_no_clear_terminal_on_reload(!bun_core::Output::enable_ansi_colors_stdout())
        };
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

        // TODO(b2-cycle): `bun_runtime::api::cron::CronJob::clear_all_for_vm(self, .reload)`.
        // SAFETY: `global` valid for VM lifetime; FFI drains microtasks +
        // collects async + clears the JSC module loader registry.
        // PORT NOTE: `JSGlobalObject::reload` lives in the gated
        // JSGlobalObject.rs sibling; inline its body here.
        unsafe {
            // TODO(b2): `vm().drain_microtasks()` — gated in VM.rs.
            (*self.global).vm().collect_async();
            JSC__JSGlobalObject__reload(self.global);
        }
        self.hot_reload_counter += 1;
        if self.pending_internal_promise_is_protected {
            if let Some(p) = self.pending_internal_promise {
                JSValue::from_cell(p).unprotect();
            }
            self.pending_internal_promise_is_protected = false;
        }
        // reload_entry_point() stores into pending_internal_promise on every return path.
        let main = self.main;
        if self.reload_entry_point(main).is_err() {
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
        // SAFETY: `event_loop` is a self-pointer into this VM.
        unsafe { (*self.event_loop()).enqueue_immediate_task(task) };
    }

    /// Spec VirtualMachine.zig:1020 `enqueueTaskConcurrent`.
    #[inline]
    pub fn enqueue_task_concurrent(&mut self, task: *mut crate::event_loop::ConcurrentTaskItem) {
        // SAFETY: `event_loop` is a self-pointer into this VM.
        unsafe { (*self.event_loop()).enqueue_task_concurrent(task) };
    }

    /// Spec VirtualMachine.zig:1028 `waitFor`.
    pub fn wait_for(&mut self, cond: &mut bool) {
        while !*cond {
            // SAFETY: `event_loop` is a self-pointer into this VM.
            unsafe { (*self.event_loop()).tick() };
            if !*cond {
                self.auto_tick();
            }
        }
    }

    /// Spec VirtualMachine.zig:1042 `waitForTasks`.
    pub fn wait_for_tasks(&mut self) {
        while self.is_event_loop_alive() {
            // SAFETY: `event_loop` is a self-pointer into this VM.
            unsafe { (*self.event_loop()).tick() };
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
            graph: graph.as_ptr().cast(),
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
        // SAFETY: `graph` outlives the VM (owned by the caller / embedded binary).
        // PORT NOTE: the resolver's `StandaloneModuleGraph` is a forward-decl
        // opaque (resolver/__forward_decls); we hold it as `*mut c_void` here
        // and cast on store — `.cast()` infers the resolver's expected type.
        vm_ref.transpiler.resolver.standalone_module_graph =
            Some(unsafe { &*graph.as_ptr().cast() });
        // Avoid reading from tsconfig.json & package.json when in standalone mode
        vm_ref.transpiler.configure_linker_with_auto_jsx(false);
        vm_ref.transpiler.resolver.store_fd = false;
        // SAFETY: process-global written once at startup.
        unsafe { IS_SMOL_MODE = opts.smol };
        Ok(vm)
    }

    /// Spec VirtualMachine.zig:1394 `initWorker`.
    pub fn init_worker(
        worker: &mut crate::web_worker::WebWorker,
        opts: Options,
    ) -> Result<*mut VirtualMachine, bun_core::Error> {
        let init_opts = InitOptions {
            graph: opts
                .graph
                .map(|g| g.as_ptr().cast())
                .unwrap_or(core::ptr::null_mut()),
            log: opts.log,
            env_loader: opts.env_loader,
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
        vm_ref.worker = Some((worker as *const crate::web_worker::WebWorker).cast());
        // SAFETY: `parent_vm()` is non-null and outlives this worker while
        // `parent_poll_ref` is held (see web_worker.rs file header).
        let parent = unsafe { &*worker.parent_vm() };
        vm_ref.standalone_module_graph = parent.standalone_module_graph;
        vm_ref.hot_reload = parent.hot_reload;
        vm_ref.initial_script_execution_context_identifier =
            worker.execution_context_id() as i32;
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
        // SAFETY: extern "C" FFI; `console` valid.
        let new_global = unsafe { BakeCreateProdGlobal(vm_ref.console.cast()) };
        vm_ref.global = new_global;
        VMHolder::CACHED_GLOBAL_OBJECT.set(Some(new_global));
        vm_ref.regular_event_loop.global = NonNull::new(new_global);
        // SAFETY: `new_global` is freshly created and live for VM lifetime.
        // `vm_ptr()` returns the FFI `*mut VM` directly (no `&VM` reborrow).
        vm_ref.jsc_vm = unsafe { (*new_global).vm_ptr() };
        // SAFETY: per-thread uws loop is live.
        unsafe { (*uws::Loop::get()).internal_loop_data.jsc_vm = vm_ref.jsc_vm.cast() };
        // SAFETY: `event_loop` is a self-pointer into this VM.
        unsafe { (*vm_ref.event_loop()).ensure_waker() };
        if opts.smol {
            // SAFETY: process-global written once at startup.
            unsafe { IS_SMOL_MODE = true };
        }
        Ok(vm)
    }

    /// Spec VirtualMachine.zig:1586 `clearRefString`.
    ///
    /// SAFETY: `ref_string` was allocated by `ref_counted_string_with_was_new`
    /// on this thread's VM and is currently in `ref_strings`; called from
    /// `RefString::destroy` (the WTF external-string finalizer).
    pub unsafe fn clear_ref_string(_: *mut c_void, ref_string: *mut crate::ref_string::RefString) {
        // SAFETY: per fn contract.
        let hash = unsafe { (*ref_string).hash };
        // SAFETY: `get()` is the live per-thread VM.
        unsafe { (*VirtualMachine::get()).ref_strings.remove(&hash) };
    }

    /// Spec VirtualMachine.zig:1590 `refCountedResolvedSource`.
    pub fn ref_counted_resolved_source<const ADD_DOUBLE_REF: bool>(
        &mut self,
        code: &[u8],
        specifier: bun_string::String,
        source_url: &[u8],
        hash_: Option<u32>,
    ) -> ResolvedSource {
        // refCountedString will panic if the code is empty
        if code.is_empty() {
            return ResolvedSource {
                source_code: bun_string::String::init(b""),
                specifier,
                source_url: create_if_different(&specifier, source_url),
                allocator: core::ptr::null_mut(),
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
            source_code: bun_string::String::adopt_wtf_impl(source_ref.impl_),
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
        use std::collections::hash_map::Entry;
        jsc::mark_binding();
        debug_assert!(!input_.is_empty());
        let hash = hash_.unwrap_or_else(|| RefString::compute_hash(input_));
        self.ref_strings_mutex.lock();
        // PORT NOTE: Zig `defer unlock()` — model with a drop-guard so the
        // early-return `Occupied` arm releases too.
        let _unlock = scopeguard::guard(&self.ref_strings_mutex, |m| m.unlock());

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
                    (Box::into_raw(buf).cast::<u8>(), len)
                } else {
                    (input_.as_ptr(), input_.len())
                };
                let ref_ = Box::into_raw(Box::new(RefString {
                    ptr,
                    len,
                    hash,
                    // Filled in just below — `create_external` needs the
                    // `*mut RefString` ctx pointer first.
                    impl_: core::ptr::null_mut(),
                    ctx: NonNull::new((self as *mut VirtualMachine).cast()),
                    on_before_deinit: Some(VirtualMachine::clear_ref_string),
                }));
                // SAFETY: `ref_` is the unique live `*mut RefString` (just
                // boxed); `(ptr, len)` is its owned latin-1 buffer. The
                // external-string finalizer (`free_ref_string`) is called by
                // WTF on the JS thread when the impl refcount hits zero, with
                // `ref_` as ctx.
                let s = bun_string::String::create_external::<*mut RefString>(
                    unsafe { core::slice::from_raw_parts(ptr, len) },
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
        specifier: bun_string::String,
        referrer: bun_string::String,
        log: &mut logger::Log,
        flags: FetchFlags,
    ) -> Result<ResolvedSource, bun_core::Error> {
        debug_assert!(VirtualMachine::is_loaded());

        let global_ptr = global_object as *const JSGlobalObject as *mut JSGlobalObject;
        let mut ret = ErrorableResolvedSource::ok(ResolvedSource::default());
        match ModuleLoader::fetch_builtin_module(
            jsc_vm, global_ptr, &specifier, &referrer, &mut ret,
        ) {
            ModuleLoader::FetchBuiltinResult::Found
            | ModuleLoader::FetchBuiltinResult::Errored => return ret.unwrap(),
            ModuleLoader::FetchBuiltinResult::NotFound => {}
        }

        let specifier_clone = specifier.to_utf8();
        let referrer_clone = referrer.to_utf8();

        let mut virtual_source_to_use: Option<logger::Source> = None;
        // Spec :1676-1677 — `var blob_to_deinit: ?webcore.Blob = null;
        // defer if (blob_to_deinit) |*blob| blob.deinit();`. The blob crosses
        // the bundler↔runtime boundary as an erased `OpaqueBlob`; deinit goes
        // through the same `VmLoaderVTable` that produced it, so model the
        // `defer` as a drop guard holding `(slot, deinit_fn)`.
        struct BlobDeinit(
            Option<bun_bundler::options::OpaqueBlob>,
            unsafe fn(bun_bundler::options::OpaqueBlob),
        );
        impl Drop for BlobDeinit {
            fn drop(&mut self) {
                if let Some(blob) = self.0.take() {
                    // SAFETY: `blob` was produced by `vtable.resolve_blob`;
                    // `self.1` is that vtable's `blob_deinit`.
                    unsafe { (self.1)(blob) };
                }
            }
        }
        // `get_loader_and_virtual_source` takes a `&VmLoaderCtx` (erased VM +
        // vtable); the vtable's fn pointers reach into `Blob` /
        // `ObjectURLRegistry` (`bun_runtime::webcore`), so the high tier
        // supplies it via [`RuntimeHooks::vm_loader_vtable`].
        let loader_ctx = bun_bundler::options::VmLoaderCtx {
            vm: (jsc_vm as *const VirtualMachine).cast::<()>(),
            vtable: runtime_hooks()
                .expect("fetch_without_on_load_plugins: bun_runtime hooks not installed")
                .vm_loader_vtable,
        };
        let mut blob_to_deinit = BlobDeinit(None, loader_ctx.vtable.blob_deinit);
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
                    let vm = self.0 as *mut VirtualMachine;
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
            path: unsafe {
                core::mem::transmute::<
                    bun_resolver::fs::Path<'_>,
                    bun_resolver::fs::Path<'static>,
                >(lr.path)
            },
            loader: lr.loader.unwrap_or(if lr.is_main {
                bun_bundler::options::Loader::Js
            } else {
                bun_bundler::options::Loader::File
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
            log: log as *mut logger::Log,
            virtual_source: lr.virtual_source,
            global_object: global_object as *const JSGlobalObject as *mut JSGlobalObject,
            flags,
            extra: (&mut extra as *mut ModuleLoader::TranspileExtra).cast::<c_void>(),
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
        unsafe { &*Box::into_raw(s.to_vec().into_boxed_slice()) }
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
        use bun_resolver::{node_fallbacks, ResultUnion};

        // SAFETY: PORT — `specifier`/`source` borrow argv / resolver-arena
        // bytes that outlive `ResolveFunctionResult` (`'static` per the
        // struct's TODO(port) lifetime note). Erase to `'static` to seat the
        // result paths without threading a lifetime parameter through the VM.
        let specifier: &'static [u8] = unsafe { &*(specifier as *const [u8]) };

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
            bun_options_types::Target::Bun,
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
                // SAFETY: hook contract — `blob_id` borrows `specifier`.
                .map(|h| unsafe { (h.has_blob_url)(blob_id) })
                .unwrap_or(false);
            if has {
                ret.path = Self::dupe_resolved_path(specifier);
                return Ok(());
            }
            return Err(bun_core::err!("ModuleNotFound"));
        }

        let is_special_source =
            source == MAIN_FILE_NAME || Macro::is_macro_path(source);
        let mut query_string: &[u8] = b"";
        let normalized_specifier =
            normalize_specifier_for_resolution(specifier, &mut query_string);
        // SAFETY: `transpiler.fs` is set during init and live for VM lifetime.
        let top_level_dir = unsafe { (*self.transpiler.fs).top_level_dir };
        let source_to_use: &[u8] = if !is_special_source {
            if is_a_file_path {
                // SAFETY: PORT — `dir_with_trailing_slash()` returns a
                // re-slice of `source`, which the caller guarantees outlives
                // the resolve call (and the resolver only borrows it for the
                // synchronous `resolve_and_auto_install`).
                unsafe {
                    &*(bun_resolver::fs::PathName::init(source).dir_with_trailing_slash()
                        as *const [u8])
                }
            } else {
                // SAFETY: see `specifier` lifetime erasure note above.
                unsafe { &*(source as *const [u8]) }
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
                bun_options_types::ImportKind::Stmt
            } else {
                bun_options_types::ImportKind::Require
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

                    // SAFETY: thread-local; sole `&mut` on the JS thread for
                    // the duration of the bust below.
                    let buf = SPECIFIER_CACHE_RESOLVER_BUF
                        .with(|b| unsafe { &mut *b.get() })
                        .as_mut_slice();
                    let buster_name: &[u8] = if bun_paths::is_absolute(normalized_specifier) {
                        if let Some(dir) = bun_paths::dirname(normalized_specifier) {
                            if dir.len() > buf.len() {
                                return Err(bun_core::err!("ModuleNotFound"));
                            }
                            // Normalized without trailing slash.
                            bun_string::strings::paths::normalize_slashes_only(
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
                        bun_string::strings::paths::without_trailing_slash_windows_path(
                            buster_name,
                        ),
                    ) {
                        continue;
                    }
                    return Err(bun_core::err!("ModuleNotFound"));
                }
            }
        };

        if !self.macro_mode {
            self.has_any_macro_remappings = self.has_any_macro_remappings
                || self.transpiler.options.macro_remap.count() > 0;
        }
        // SAFETY: PORT — `query_string` re-slices `specifier` (caller-owned;
        // see lifetime erasure note above).
        ret.query_string = unsafe { &*(query_string as *const [u8]) };
        let result_path = result
            .path_const()
            .ok_or_else(|| bun_core::err!("ModuleNotFound"))?;
        // SAFETY: `result_path.text` borrows the resolver's arena, which
        // outlives `ResolveFunctionResult` (see field TODO(port) lifetime).
        ret.path = unsafe { &*(result_path.text as *const [u8]) };
        ret.result = Some(result);
        self.resolved_count += 1;

        Ok(())
    }

    /// Spec VirtualMachine.zig:1854 `resolve`.
    pub fn resolve(
        res: &mut ErrorableString,
        global: &JSGlobalObject,
        specifier: bun_string::String,
        source: bun_string::String,
        query_string: Option<&mut bun_string::String>,
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
        specifier: bun_string::String,
        source: bun_string::String,
        query_string: Option<&mut bun_string::String>,
        is_esm: bool,
        is_user_require_resolve: bool,
    ) -> JsResult<()> {
        const MAX_LEN: usize = (bun_paths::MAX_PATH_BYTES as f64 * 1.5) as usize;
        if IS_A_FILE_PATH && specifier.length() > MAX_LEN {
            let specifier_utf8 = specifier.to_utf8();
            let source_utf8 = source.to_utf8();
            let import_kind = if is_esm {
                bun_options_types::ImportKind::Stmt
            } else if is_user_require_resolve {
                bun_options_types::ImportKind::RequireResolve
            } else {
                bun_options_types::ImportKind::Require
            };
            let printed = bun_core::handle_oom(crate::ResolveMessage::fmt(
                specifier_utf8.slice(),
                source_utf8.slice(),
                bun_core::err!("NameTooLong"),
                import_kind.into(),
            ));
            let msg = logger::Msg {
                data: logger::range_data(None, logger::Range::NONE, printed),
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
        let jsc_vm = unsafe { &mut *global.bun_vm() };
        let specifier_utf8 = specifier.to_utf8();
        let source_utf8 = source.to_utf8();

        // TODO(b2-cycle): `plugin_runner` is `Option<()>` placeholder; the
        // `PluginRunner::could_be_plugin` / `on_resolve_jsc` fast-path is
        // gated until `bun_bundler::transpiler::PluginRunner` un-gates.

        if let Some(hardcoded) = ModuleLoader::HardcodedModule::Alias::get(
            specifier_utf8.slice(),
            bun_options_types::Target::Bun,
            Default::default(),
        ) {
            *res = ErrorableString::ok(if is_user_require_resolve && hardcoded.node_builtin {
                specifier.dupe_ref()
            } else {
                bun_string::String::init(hardcoded.path.as_bytes())
            });
            return Ok(());
        }

        // Swap in a fresh log so resolver errors don't pollute the VM's main log.
        // `vm.log` is set unconditionally in `init` and never cleared (Zig
        // stores `*logger.Log`, always non-null), so the `Option` is purely a
        // zeroed-init nicety; the `expect` is infallible.
        let old_log: NonNull<logger::Log> = jsc_vm.log.expect("vm.log set in init");
        let mut log = logger::Log::default();
        jsc_vm.log = NonNull::new(&mut log);
        jsc_vm.transpiler.resolver.log = &mut log;
        // TODO(b2-cycle): `transpiler.linker.log` / `resolver.package_manager.log`
        // — gated bundler fields.
        // PORT NOTE: Zig `defer { restore old_log }` — scopeguard fires on every
        // exit (including `?` from `ResolveMessage::create` below), so the VM's
        // `log` cannot be left pointing at the dropped stack `log`.
        let jsc_vm_ptr = jsc_vm as *mut VirtualMachine;
        let _restore = scopeguard::guard((), move |()| {
            // SAFETY: `jsc_vm_ptr` is the live per-thread VM (caller is on the
            // JS thread); `old_log` outlives the VM (Box::leak in `init`).
            let jsc_vm = unsafe { &mut *jsc_vm_ptr };
            jsc_vm.log = Some(old_log);
            jsc_vm.transpiler.resolver.log = unsafe { &mut *old_log.as_ptr() };
        });
        // PORT NOTE: reshaped for borrowck — re-derive from raw so the unique
        // borrow doesn't span the scopeguard's drop.
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
                bun_options_types::ImportKind::Stmt
            } else if is_user_require_resolve {
                bun_options_types::ImportKind::RequireResolve
            } else {
                bun_options_types::ImportKind::Require
            };
            // Find a `.resolve`-metadata msg if the log has one.
            let msg = log
                .msgs
                .iter()
                .find_map(|m| {
                    if let logger::Metadata::Resolve(r) = &m.metadata {
                        err = r.err;
                        Some(bun_core::handle_oom(m.clone()))
                    } else {
                        None
                    }
                })
                .unwrap_or_else(|| {
                    let printed = bun_core::handle_oom(crate::ResolveMessage::fmt(
                        specifier_utf8.slice(),
                        source_utf8.slice(),
                        err,
                        import_kind.into(),
                    ));
                    logger::Msg {
                        data: logger::range_data(None, logger::Range::NONE, printed.clone()),
                        metadata: logger::Metadata::Resolve(logger::MetadataResolve {
                            specifier: logger::BabyString::r#in(&printed, specifier_utf8.slice()),
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
                bun_string::String::clone_utf8(result.query_string)
            } else {
                bun_string::String::empty()
            };
        }

        *res = ErrorableString::ok(bun_string::String::clone_utf8(result.path));
        Ok(())
    }
    /// `VirtualMachine.deinit` — worker-thread teardown. Spec
    /// VirtualMachine.zig:2109. Only the `RuntimeHooks` dispatch is real; the
    /// remaining field deinits are gated on their `()` placeholders widening.
    pub fn destroy(&mut self) {
        // PORT NOTE: Zig frees `timer`/`entry_point` as value fields of `self`;
        // here they live in the high-tier `RuntimeState` box, so dispatch the
        // reclaim through the hook. PERF(port): was inline switch.
        if let Some(hooks) = runtime_hooks() {
            let state = core::mem::replace(&mut self.runtime_state, core::ptr::null_mut());
            // SAFETY: hook contract — `state` is exactly the pointer
            // `init_runtime_state` returned for this VM (or null), handed back
            // once on the same thread; `self` is the live per-thread VM.
            unsafe { (hooks.deinit_runtime_state)(self as *mut _, state) };
        }
        // TODO(port): rest of spec VirtualMachine.zig:2109 `deinit` —
        // `auto_killer.deinit()`, `source_mappings.deinit()`,
        // `rare_data.deinit()`, `proxy_env_storage.deinit()`,
        // `overridden_main.deinit()`. Gated on those fields' real types.
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
        // SAFETY: `self.global` is valid for VM lifetime.
        let mut formatter = crate::console_object::Formatter::new(unsafe { &*self.global });
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
        if self.main.is_empty() {
            return Ok(());
        }
        let str = jsc::ZigString::init(MAIN_FILE_NAME);
        // SAFETY: `global` valid for VM lifetime.
        unsafe { (*self.global).delete_module_registry_entry(&str) }
    }

    /// Spec VirtualMachine.zig:2363 `useIsolationSourceProviderCache`.
    #[inline]
    pub fn use_isolation_source_provider_cache(&self) -> bool {
        self.test_isolation_enabled
            && !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_ISOLATION_SOURCE_CACHE::get()
                .unwrap_or(false)
    }

    /// Spec VirtualMachine.zig:2378 `reloadEntryPointForTestRunner`.
    pub fn reload_entry_point_for_test_runner(
        &mut self,
        entry_path: &'static [u8],
    ) -> Result<*mut JSInternalPromise, bun_core::Error> {
        self.has_loaded = false;
        self.main = entry_path;
        self.main_resolved_path.deref();
        self.main_resolved_path = bun_string::String::empty();
        self.main_hash = bun_watcher::Watcher::get_hash(entry_path);
        self.overridden_main.deinit();

        // SAFETY: `event_loop` is a self-pointer into this VM.
        unsafe { (*self.event_loop()).ensure_waker() };

        if let Some(hooks) = runtime_hooks() {
            // SAFETY: hook contract.
            unsafe { (hooks.ensure_debugger)(self, true) };
        }

        if !self.transpiler.options.disable_transpilation {
            if let Some(hooks) = runtime_hooks() {
                // SAFETY: hook contract.
                let p = unsafe { (hooks.load_preloads)(self) };
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
        let main_str = bun_string::String::from_bytes(self.main);
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
        entry_path: &'static [u8],
    ) -> Result<*mut JSInternalPromise, bun_core::Error> {
        let promise = self.reload_entry_point(entry_path)?;
        // SAFETY: `event_loop` is a self-pointer into this VM.
        unsafe { (*self.event_loop()).perform_gc() };
        // SAFETY: see above.
        unsafe {
            (*self.event_loop())
                .wait_for_promise_with_termination(jsc::AnyPromise::Internal(promise))
        };
        if let Some(worker) = self.worker {
            // SAFETY: `worker` is a heap `WebWorker` owned by C++ (BACKREF).
            let worker = unsafe { &*(worker as *const crate::web_worker::WebWorker) };
            if worker.has_requested_terminate() {
                return Err(bun_core::err!("WorkerTerminated"));
            }
        }
        Ok(self.pending_internal_promise.unwrap())
    }

    /// Spec VirtualMachine.zig:2424 `loadEntryPointForTestRunner`.
    pub fn load_entry_point_for_test_runner(
        &mut self,
        entry_path: &'static [u8],
    ) -> Result<*mut JSInternalPromise, bun_core::Error> {
        let promise = self.reload_entry_point_for_test_runner(entry_path)?;

        // pending_internal_promise can change if hot module reloading is enabled
        if self.is_watcher_enabled() {
            // SAFETY: `event_loop` is a self-pointer into this VM.
            unsafe { (*self.event_loop()).perform_gc() };
            loop {
                let Some(p) = self.pending_internal_promise else { break };
                // SAFETY: `p` is a live JSC heap cell tracked by the VM.
                if unsafe { (*p).status() } != crate::js_promise::Status::Pending {
                    break;
                }
                // SAFETY: see above re: `event_loop`.
                unsafe { (*self.event_loop()).tick() };
                let Some(p) = self.pending_internal_promise else { break };
                // SAFETY: see above.
                if unsafe { (*p).status() } == crate::js_promise::Status::Pending {
                    self.auto_tick();
                }
            }
        } else {
            // SAFETY: `promise` is a live JSC heap cell.
            if unsafe { (*promise).status() } == crate::js_promise::Status::Rejected {
                return Ok(promise);
            }
            // SAFETY: `event_loop` is a self-pointer into this VM.
            unsafe { (*self.event_loop()).perform_gc() };
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
        self.rare_data().remove_listening_socket_for_watch_mode(socket);
    }

    /// Spec VirtualMachine.zig:2505 `swapGlobalForTestIsolation`.
    pub fn swap_global_for_test_isolation(&mut self) {
        debug_assert!(self.test_isolation_enabled);

        // SAFETY: `event_loop` is a self-pointer into this VM.
        let _ = unsafe { (*self.event_loop()).drain_microtasks() };

        if let Some(rare) = self.rare_data.as_deref_mut() {
            rare.close_all_watchers_for_isolation();
        }

        {
            // Groups that must survive the per-file isolation swap.
            // TODO(b2-cycle): `rare_data.spawn_ipc_group` /
            // `test_parallel_ipc_group` / `self.ipc.initialized.group` are
            // gated behind `()` placeholders; pass null skips until widened.
            let skip_spawn_ipc: *mut uws::SocketGroup = core::ptr::null_mut();
            let skip_test_parallel_ipc: *mut uws::SocketGroup = core::ptr::null_mut();
            let skip_process_ipc: *mut uws::SocketGroup = core::ptr::null_mut();
            // SAFETY: process-global usockets loop is live.
            let loop_ = unsafe { &mut *uws::Loop::get() };
            let mut maybe_group = loop_.internal_loop_data.head;
            while let Some(group) = NonNull::new(maybe_group) {
                // SAFETY: `group` is a live `us_socket_group_t` linked in the loop.
                let next = unsafe { (*group.as_ptr()).next };
                let g = group.as_ptr();
                // PORT NOTE: `head` is `*mut bun_uws_sys::SocketGroup`; the
                // skip-set placeholders above are typed against the
                // `bun_uws::SocketGroup` mirror — `.cast()` for the
                // pointer-equality check until the duplicate collapses.
                if g != skip_spawn_ipc.cast() && g != skip_process_ipc.cast() && g != skip_test_parallel_ipc.cast() {
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
            let _guard = rare.listening_sockets_for_watch_mode_lock.lock();
            rare.listening_sockets_for_watch_mode.clear();
            drop(_guard);
        }
        // SAFETY: `event_loop` is a self-pointer into this VM.
        let _ = unsafe { (*self.event_loop()).drain_microtasks() };

        // TODO(b2-cycle): `auto_killer.kill()` / `.clear()` — `()` placeholder.

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
        self.main = b"";
        self.main_hash = 0;
        self.main_resolved_path.deref();
        self.main_resolved_path = bun_string::String::empty();
        self.unhandled_error_counter = 0;

        let old_global = self.global;
        // SAFETY: `old_global` valid for VM lifetime; `console` is the live
        // per-VM ConsoleObject.
        // SAFETY: `old_global` valid for VM lifetime; `console` is the live
        // per-VM ConsoleObject.
        let new_global: *mut JSGlobalObject =
            JSGlobalObject::create_for_test_isolation(unsafe { &*old_global }, self.console.cast());
        {
        self.global = new_global;
        VMHolder::CACHED_GLOBAL_OBJECT.set(Some(new_global));
        self.regular_event_loop.global = NonNull::new(new_global);
        self.macro_event_loop.global = NonNull::new(new_global);
        self.has_loaded_constructors = true;
        // TODO(b2-cycle): `self.ipc.initialized.global_this = new_global` —
        // gated behind `Option<()>` placeholder.
        if let Some(rare) = self.rare_data.as_deref_mut() {
            for hook in rare.cleanup_hooks.iter_mut() {
                if hook.global_this == old_global {
                    hook.global_this = new_global;
                }
            }
        }
        }
    }

    /// Spec VirtualMachine.zig:2641 `_loadMacroEntryPoint`.
    #[inline]
    pub fn _load_macro_entry_point(&mut self, entry_path: &[u8]) -> Option<*mut JSInternalPromise> {
        let path_str = bun_string::String::init(entry_path);
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
        let global = self.global;
        // SAFETY: `global` valid for VM lifetime.
        let global_ref = unsafe { &*global };

        // PORT NOTE: `JSValue::is_aggregate_error` not yet ported; the C++
        // binding exists, so call it directly.
        unsafe extern "C" {
            fn JSC__JSValue__isAggregateError(
                this: JSValue,
                global: *const JSGlobalObject,
            ) -> bool;
        }
        // SAFETY: `global_ref` is live; FFI is infallible per JSValue.zig:2194.
        if unsafe { JSC__JSValue__isAggregateError(value, global_ref) } {
            // PORT NOTE: Zig comptime-generated `AggregateErrorIterator` with
            // `extern "C"` callbacks. `JSValue::for_each` takes a C-ABI fn
            // pointer + erased ctx, so thread the captures through a struct.
            struct AggCtx<'a> {
                formatter: *mut crate::console_object::Formatter<'a>,
                writer: *mut bun_core::io::Writer,
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
                let ctx = unsafe { &mut *(ctx as *mut AggCtx<'_>) };
                // SAFETY: per-thread VM.
                let vm = unsafe { &mut *VirtualMachine::get() };
                // SAFETY: `formatter`/`writer` borrow the caller's stack
                // locals, live across the synchronous `for_each` call.
                vm.print_errorlike_object(
                    next_value,
                    None,
                    // PORT NOTE: reshaped for borrowck — Zig threaded
                    // `exception_list` through the iterator ctx; the C
                    // trampoline can't reborrow `&mut Option<&mut _>`, so
                    // child errors don't append (matches observed behaviour:
                    // only the top-level frame is added).
                    None,
                    unsafe { &mut *ctx.formatter },
                    unsafe { &mut *ctx.writer },
                    ctx.allow_ansi_color,
                    ctx.allow_side_effects,
                );
            }
            let errors = value
                .get(global_ref, "errors")
                .ok()
                .flatten()
                .unwrap_or(JSValue::UNDEFINED);
            let mut ctx = AggCtx {
                formatter: formatter as *mut _,
                writer: writer as *mut _,
                allow_ansi_color,
                allow_side_effects,
            };
            let _ = errors.for_each(
                global_ref,
                (&mut ctx as *mut AggCtx<'_>).cast(),
                agg_iter,
            );
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
                    let _ =
                        Self::print_stack_trace(writer, &zig_exception.stack, allow_ansi_color);
                }
                if let Some(list) = exception_list {
                    // SAFETY: `transpiler.fs` set during init; live for VM lifetime.
                    let top_level_dir = unsafe { (*self.transpiler.fs).top_level_dir };
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
        // PORT NOTE: `Msg::write_format` takes `&mut impl fmt::Write` with a
        // const-generic colour flag; `bun_core::io::Writer` is a vtable head
        // (not `fmt::Write`), so adapt locally.
        struct FmtAdapter<'a>(&'a mut bun_core::io::Writer);
        impl core::fmt::Write for FmtAdapter<'_> {
            #[inline]
            fn write_str(&mut self, s: &str) -> core::fmt::Result {
                self.0.write_all(s.as_bytes()).map_err(|_| core::fmt::Error)
            }
        }
        macro_rules! write_msg {
            ($msg:expr, $w:expr, $color:expr) => {
                if $color {
                    let _ = $msg.write_format::<true>(&mut FmtAdapter($w));
                } else {
                    let _ = $msg.write_format::<false>(&mut FmtAdapter($w));
                }
            };
        }

        if value.js_type() == jsc::JSType::DOMWrapper {
            if let Some(build_error) = value.as_::<crate::BuildMessage>() {
                // SAFETY: `as_` returns a live `*mut BuildMessage` backed by
                // the JSCell's private data; valid while `value` is alive.
                let build_error = unsafe { &mut *build_error };
                if !build_error.logged {
                    if self.had_errors {
                        let _ = writer.write_all(b"\n");
                    }
                    write_msg!(build_error.msg, writer, allow_ansi_color);
                    build_error.logged = true;
                    let _ = writer.write_all(b"\n");
                }
                self.had_errors = self.had_errors || build_error.msg.kind == logger::Kind::Err;
                if exception_list.is_some() {
                    // SAFETY: `log` is set in `init` and live for VM lifetime.
                    if let Some(log) = self.log {
                        let _ = unsafe {
                            (*log.as_ptr())
                                .add_msg(bun_core::handle_oom(build_error.msg.clone()))
                        };
                    }
                }
                bun_core::Output::flush();
                return true;
            } else if let Some(resolve_error) = value.as_::<crate::ResolveMessage>() {
                // SAFETY: see above; `*mut ResolveMessage` is live while
                // `value` is alive.
                let resolve_error = unsafe { &mut *resolve_error };
                if !resolve_error.logged {
                    if self.had_errors {
                        let _ = writer.write_all(b"\n");
                    }
                    write_msg!(resolve_error.msg, writer, allow_ansi_color);
                    resolve_error.logged = true;
                    let _ = writer.write_all(b"\n");
                }
                self.had_errors = self.had_errors || resolve_error.msg.kind == logger::Kind::Err;
                if exception_list.is_some() {
                    // SAFETY: see above.
                    if let Some(log) = self.log {
                        let _ = unsafe {
                            (*log.as_ptr())
                                .add_msg(bun_core::handle_oom(resolve_error.msg.clone()))
                        };
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
                // SAFETY: `global` valid for VM lifetime; FFI clears the
                // pending VM exception.
                unsafe { JSGlobalObject__clearException(self.global) };
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
        // SAFETY: per-thread VM.
        let jsc_vm = unsafe { &mut *global_object.bun_vm() };
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
        let vm = unsafe { &mut *VirtualMachine::get() };
        let origin = if vm.is_from_devserver { Some(&vm.origin) } else { None };
        // SAFETY: `transpiler.fs` set during `init` and live for VM lifetime.
        let dir = unsafe { (*vm.transpiler.fs).top_level_dir };

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
        let frames = unsafe { core::slice::from_raw_parts_mut(frames, frames_count) };
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
            // resolve_source_mapping().
            self.source_mappings.unlock();
            table_locked = false;
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
                frame.position.line =
                    bun_core::Ordinal::from_zero_based(lookup.mapping.original.lines.zero_based());
                frame.position.column =
                    bun_core::Ordinal::from_zero_based(lookup.mapping.original.columns.zero_based());
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
        source_code_slice: &mut Option<bun_string::ZigStringSlice>,
        allow_source_code_preview: bool,
    ) {
        // SAFETY: `global` valid for VM lifetime.
        let global = unsafe { &*self.global };
        error_instance.to_zig_exception(global, exception);
        let mut enable_source_code_preview = allow_source_code_preview
            && !(bun_core::env_var::feature_flag::BUN_DISABLE_SOURCE_CODE_PREVIEW::get()
                .unwrap_or(false)
                || bun_core::env_var::feature_flag::BUN_DISABLE_TRANSPILED_SOURCE_CODE_PREVIEW::get()
                    .unwrap_or(false));

        // PORT NOTE: Zig modeled the two `defer` blocks below at fn-top; in
        // Rust we run them on the way out via this guard so every early
        // `return` is covered.
        struct Tail<'a> {
            this: *mut VirtualMachine,
            exception: *mut ZigException,
            exception_list: Option<&'a mut ExceptionList>,
            enable_source_code_preview: *const bool,
            source_code_slice: *const Option<bun_string::ZigStringSlice>,
        }
        impl Drop for Tail<'_> {
            fn drop(&mut self) {
                // SAFETY: `this`/`exception` are stack-local raw ptrs taken
                // before the body below reborrows them; no overlap at drop.
                let this = unsafe { &mut *self.this };
                let exception = unsafe { &mut *self.exception };
                #[cfg(debug_assertions)]
                {
                    // SAFETY: stack-local raw ptrs; live for guard scope.
                    let preview = unsafe { *self.enable_source_code_preview };
                    let slice = unsafe { &*self.source_code_slice };
                    if !preview && slice.is_some() {
                        bun_core::Output::panic(
                            "Do not collect source code when we don't need to",
                            (),
                        );
                    }
                    // SAFETY: `source_lines_numbers[0]` is always valid —
                    // `Holder` backs it with a `[i32; SOURCE_LINES_COUNT]`.
                    if !preview && unsafe { *exception.stack.source_lines_numbers } != -1 {
                        bun_core::Output::panic(
                            "Do not collect source code when we don't need to",
                            (),
                        );
                    }
                }
                #[cfg(not(debug_assertions))]
                {
                    let _ = (self.enable_source_code_preview, self.source_code_slice);
                }
                if let Some(list) = self.exception_list.take() {
                    // SAFETY: `transpiler.fs` set during init; live for VM lifetime.
                    let top_level_dir = unsafe { (*this.transpiler.fs).top_level_dir };
                    // Zig `catch unreachable` — OOM-only.
                    bun_core::handle_oom(
                        exception.add_to_error_list(list, top_level_dir, Some(&this.origin)),
                    );
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
        let source_code_slice: &mut Option<bun_string::ZigStringSlice> =
            unsafe { &mut *(_tail.source_code_slice as *mut _) };

        /// Spec VirtualMachine.zig:3058 `NoisyBuiltinFunctionMap`.
        fn is_noisy_builtin(name: &bun_string::String) -> bool {
            name.eql_comptime("asyncModuleEvaluation")
                || name.eql_comptime("link")
                || name.eql_comptime("linkAndEvaluateModule")
                || name.eql_comptime("moduleEvaluation")
                || name.eql_comptime("processTicksAndRejections")
        }
        fn is_hidden_frame(f: &crate::ZigStackFrame) -> bool {
            f.source_url.eql_comptime("bun:wrap")
                || f.function_name.eql_comptime("::bunternal::")
        }
        fn is_unknown_source(url: &bun_string::String) -> bool {
            url.is_empty()
                || url.eql_comptime("[unknown]")
                || url.has_prefix_comptime(b"[source:")
        }

        // SAFETY: `frames_ptr[..frames_len]` is the caller-owned `Holder`
        // backing buffer (ZigStackTrace contract).
        let mut frames_len = exception.stack.frames_len as usize;
        let frames_buf = unsafe {
            core::slice::from_raw_parts_mut(exception.stack.frames_ptr, frames_len)
        };

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
            enable_source_code_preview = false;
        }

        let top_source_url = frames[top].source_url.to_utf8();

        // PORT NOTE: reshaped for borrowck — `resolve_source_mapping` borrows
        // `&mut self`; the returned `Lookup<'_>` borrows `self.source_mappings`.
        // We can't hold `&mut frames[top]` across that call, so reads/writes go
        // through indices and the lookup is consumed before frame writes.
        let already_remapped = frames[top].remapped;
        let maybe_lookup: Option<bun_sourcemap::mapping::Lookup<'_>> = if already_remapped {
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
            // PORT NOTE: reshaped for borrowck — `Lookup<'_>` borrows
            // `self.source_mappings`, but the `code:` block below needs
            // `&mut self` for `fetch_without_on_load_plugins`. Extract
            // everything needed from `lookup` up-front, then drop it.
            // Zig `defer if (source_map) |map| map.deref();` — `ParsedSourceMap`
            // is borrowed (`&'a`) in the Rust port; the ref-counted handle is
            // owned by `self.source_mappings`, so no manual deref here.
            let mapping = lookup.mapping;
            let display_url = if !already_remapped {
                lookup.display_source_url_if_needed(top_source_url.slice())
            } else {
                None
            };
            let external_code = if enable_source_code_preview
                && !already_remapped
                && lookup.source_map.is_some_and(|m| m.is_external())
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

            let code: bun_string::ZigStringSlice = 'code: {
                if !enable_source_code_preview {
                    break 'code bun_string::ZigStringSlice::EMPTY;
                }
                if let Some(src) = external_code {
                    break 'code src;
                }
                if top_frame_is_builtin {
                    // Avoid printing "export default 'native'"
                    break 'code bun_string::ZigStringSlice::EMPTY;
                }
                let mut log = logger::Log::default();
                let top_url = frames[top].source_url.dupe_ref();
                let Ok(original_source) = Self::fetch_without_on_load_plugins(
                    self,
                    global,
                    top_url,
                    bun_string::String::empty(),
                    &mut log,
                    FetchFlags::PrintSource,
                ) else {
                    return;
                };
                *must_reset_parser_arena_later = true;
                original_source.source_code.to_utf8()
            };

            if enable_source_code_preview && code.slice().is_empty() {
                exception.collect_source_lines(error_instance, global);
            }

            frames[top].position.line =
                bun_core::Ordinal::from_zero_based(mapping.original.lines.zero_based());
            frames[top].position.column =
                bun_core::Ordinal::from_zero_based(mapping.original.columns.zero_based());
            exception.remapped = true;
            frames[top].remapped = true;

            let last_line = frames[top].position.line.zero_based().max(0);
            if let Some(lines_buf) = bun_string::strings::get_lines_in_text::<
                { crate::zig_exception::Holder::SOURCE_LINES_COUNT },
            >(code.slice(), last_line as u32)
            {
                let lines = lines_buf.as_slice();
                const N: usize = crate::zig_exception::Holder::SOURCE_LINES_COUNT;
                // SAFETY: `Holder` backs both arrays with `[_; SOURCE_LINES_COUNT]`.
                let source_lines = unsafe {
                    core::slice::from_raw_parts_mut(exception.stack.source_lines_ptr, N)
                };
                let source_line_numbers = unsafe {
                    core::slice::from_raw_parts_mut(exception.stack.source_lines_numbers, N)
                };
                for s in source_lines.iter_mut() {
                    *s = bun_string::String::empty();
                }
                source_line_numbers.fill(0);

                let take = lines.len().min(N);
                let mut current_line_number = last_line;
                for (i, line) in lines[..take].iter().enumerate() {
                    // To minimize duplicate allocations, we use the same slice
                    // as above — it should virtually always be UTF-8 and thus
                    // not cloned.
                    source_lines[i] = bun_string::String::init(*line);
                    source_line_numbers[i] = current_line_number;
                    current_line_number -= 1;
                }
                exception.stack.source_lines_len = take as u8;
            }

            if !code.slice().is_empty() {
                *source_code_slice = Some(code);
            }
        } else if enable_source_code_preview {
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
                    if let Some(src) =
                        lookup.display_source_url_if_needed(source_url.slice())
                    {
                        frames[i].source_url.deref();
                        frames[i].source_url = src;
                    }
                    let mapping = lookup.mapping;
                    frames[i].remapped = true;
                    frames[i].position.line =
                        bun_core::Ordinal::from_zero_based(mapping.original.lines.zero_based());
                    frames[i].position.column =
                        bun_core::Ordinal::from_zero_based(mapping.original.columns.zero_based());
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
        // SAFETY: `global` valid for VM lifetime.
        let mut default_formatter =
            crate::console_object::Formatter::new(unsafe { &*self.global });
        let f = formatter.unwrap_or(&mut default_formatter);
        self.print_error_instance_zig(
            zig_exception,
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
        let mut exception_holder = crate::zig_exception::Holder::init();
        // PORT NOTE: reshaped for borrowck — `zig_exception()` returns a
        // `&mut` into the holder; we need to also borrow
        // `need_to_clear_parser_arena_on_deinit` disjointly. Route through a
        // raw pointer (the holder is stack-pinned for the call).
        let exception: *mut ZigException = exception_holder.zig_exception();
        let mut source_code_slice: Option<bun_string::ZigStringSlice> = None;

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

        let result = self.print_error_instance_zig(
            // SAFETY: see above.
            unsafe { &mut *exception },
            formatter,
            writer,
            allow_ansi_color,
            allow_side_effects,
        );

        drop(source_code_slice);
        // TODO(port): `Holder::deinit` — parser-arena reset plumbing gated.
        let _ = exception_holder;
        result
    }

    /// `printErrorInstance(.zig_exception, ...)` — shared tail body.
    fn print_error_instance_zig(
        &mut self,
        exception: &mut ZigException,
        formatter: &mut crate::console_object::Formatter,
        writer: &mut bun_core::io::Writer,
        allow_ansi_color: bool,
        allow_side_effects: bool,
    ) -> Result<(), bun_core::Error> {
        let prev_had_errors = self.had_errors;
        self.had_errors = true;

        if allow_side_effects {
            if let Some(debugger) = self.debugger.as_deref_mut() {
                debugger.lifecycle_reporter_agent.report_error(exception);
            }
        }

        // TODO(port): VirtualMachine.zig:3341-3737 — the ~400-line body that
        // renders source-line previews, name/message, code/errno/syscall/path
        // properties, the `cause:` chain, and the `at <fn> (<file>:<line>)`
        // stack. The shape is `{preview}{name}: {message}\n{stack}` with
        // `<tag>`-ANSI markup; the full port needs `ConsoleObject::Formatter`
        // method surface that is still gated. Emit the minimal
        // name/message/stack so callers see *something*, and append the
        // GitHub annotation if `Output.is_github_action`.
        {
            let name = exception.name.to_utf8();
            let message = exception.message.to_utf8();
            if !name.slice().is_empty() {
                let _ = writer.write_all(name.slice());
                let _ = writer.write_all(b": ");
            }
            let _ = writer.write_all(message.slice());
            let _ = writer.write_all(b"\n");
            let _ = Self::print_stack_trace(writer, &exception.stack, allow_ansi_color);
        }
        let _ = formatter; // PERF(port): used by the full body for property formatting.

        if allow_side_effects && bun_core::Output::is_github_action() {
            Self::print_github_annotation(exception);
        }

        self.had_errors = prev_had_errors;
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
                bun_string::strings::index_of_newline_or_non_ascii_or_ansi(msg, cursor)
            {
                cursor = i + 1;
                if msg[i as usize] == b'\n' {
                    let first_line = bun_string::String::borrow_utf8(&msg[..i as usize]);
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
                bun_string::strings::index_of_newline_or_non_ascii_or_ansi(msg, cursor)
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
            let vm = unsafe { &*VirtualMachine::get() };
            let origin = if vm.is_from_devserver { Some(&vm.origin) } else { None };
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
    ) -> Option<bun_sourcemap::mapping::Lookup<'_>> {
        if let Some(lookup) =
            self.source_mappings
                .resolve_mapping(path, line, column, source_handling)
        {
            return Some(lookup);
        }
        // TODO(port): blocked_on `bun_standalone::StandaloneModuleGraph` —
        // crate not surfaced at this tier yet. Fall back to `None` (matches
        // the non-standalone runtime path).
        let _ = self.standalone_module_graph;
        None
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

        // SAFETY: event loop is process-lifetime; sole `&mut` on JS thread.
        unsafe { (*self.event_loop()).ensure_waker() };

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
                let rare = (*this).rare_data() as *mut RareData;
                (*rare).spawn_ipc_group(&mut *this)
            };

            // Box the instance first so `data.owner.ptr` can name its final
            // address (Zig wrote `.data = undefined` then re-init in place).
            let instance = IPCInstance::new(IPCInstance {
                global_this: self.global,
                group,
                data: crate::ipc::SendQueue::init(
                    mode,
                    crate::ipc::SendQueueOwner {
                        ptr: core::ptr::null_mut(),
                        kind: crate::ipc::SendQueueOwnerKind::VirtualMachine,
                        vtable: &IPCINSTANCE_OWNER_VTABLE,
                    },
                    crate::ipc::SocketUnion::Uninitialized,
                ),
                has_disconnect_called: false,
            });
            // SAFETY: `instance` was just boxed by `IPCInstance::new`.
            unsafe { (*instance).data.owner.ptr = instance.cast() };

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
                    crate::ipc::SendQueueOwner {
                        ptr: core::ptr::null_mut(),
                        kind: crate::ipc::SendQueueOwnerKind::VirtualMachine,
                        vtable: &IPCINSTANCE_OWNER_VTABLE,
                    },
                    crate::ipc::SocketUnion::Uninitialized,
                ),
                has_disconnect_called: false,
            });
            // SAFETY: `instance` was just boxed by `IPCInstance::new`.
            unsafe { (*instance).data.owner.ptr = instance.cast() };

            self.ipc = Some(IPCInstanceUnion::Initialized(instance));

            // SAFETY: `instance` is the live boxed IPCInstance.
            if let Err(_) = unsafe { (*instance).data.windows_configure_client(fd) } {
                IPCInstance::deinit(instance);
                self.ipc = None;
                bun_core::output::warn(&format_args!("Unable to start IPC pipe '{:?}'", fd));
                return None;
            }

            instance
        };

        // SAFETY: `instance` is the live boxed IPCInstance; `self.global` is
        // the live VM global.
        unsafe { (*instance).data.write_version_packet(&*self.global) };

        Some(instance)
    }

    /// To satisfy the interface from NewHotReloader().
    pub fn get_loaders(&mut self) -> &mut bun_bundler::options::LoaderHashTable {
        &mut self.transpiler.options.loaders
    }

    /// To satisfy the interface from NewHotReloader().
    pub fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
        self.transpiler.resolver.bust_dir_cache(path)
    }
}

use core::fmt::Write as _;

fn is_error_like(global_object: &JSGlobalObject, reason: JSValue) -> JsResult<bool> {
    jsc::from_js_host_call_generic(global_object, || unsafe {
        Bun__promises__isErrorLike(global_object.as_ptr(), reason)
    })
}

fn wrap_unhandled_rejection_error_for_uncaught_exception(
    global_object: &JSGlobalObject,
    reason: JSValue,
) -> JSValue {
    let like = is_error_like(global_object, reason).unwrap_or_else(|_| {
        // SAFETY: extern "C" FFI; `global_object` is the live VM global.
        unsafe { JSGlobalObject__clearException(global_object.as_ptr()) };
        false
    });
    if like {
        return reason;
    }
    // SAFETY: extern "C" FFI; `global_object` is the live VM global.
    // `vm_ptr()` returns the FFI `*mut VM` directly so the C++ side
    // (`JSC::VM&`) receives a pointer with mutable provenance.
    let reason_str = unsafe {
        let s = Bun__noSideEffectsToString(
            global_object.vm_ptr(),
            global_object.as_ptr(),
            reason,
        );
        JSGlobalObject__clearException(global_object.as_ptr());
        s
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

// Local FFI bridge — `JSGlobalObject::clear_exception` lives in the gated
// `JSGlobalObject.rs`; declare the extern here so the un-gated callers above
// can clear the pending VM exception without depending on the gated module.
unsafe extern "C" {
    fn JSGlobalObject__clearException(this: *const JSGlobalObject);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/VirtualMachine.zig (~3840 lines)
//   confidence: low
//   todos:      30+
//   notes:      Keystone-C un-gate. Core struct + VMHolder + accessors real.
//               init / init_with_main / reload_entry_point / load_entry_point /
//               wait_for_promise / drain_queues_if_needed un-gated; the
//               bun_runtime-typed steps (Timer::All, ServerEntryPoint,
//               configureDebugger, autoTick) dispatch through `RuntimeHooks`
//               per §Dispatch (cold-path vtable). Field types from
//               bun_runtime/webcore/ipc/hot_reloader/gc_controller remain
//               opaque + TODO(b2-cycle). Full Phase-A draft @ 5410a51d85^.
// ──────────────────────────────────────────────────────────────────────────
