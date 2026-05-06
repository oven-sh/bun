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
//! `#[cfg(any())]` blocks below; un-gate piecewise as the cycle breaks.
//! ──────────────────────────────────────────────────────────────────────────

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};
use core::mem::offset_of;
use core::ptr::NonNull;

use bun_aio as Async;
use bun_bundler::Transpiler;
use bun_logger as logger;
use bun_uws as uws;

use crate::counters::Counters;
use crate::event_loop::EventLoop;
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
// TODO(b2-cycle): `api::JsException` lives in `bun_options_types::schema::api` —
// not surfaced at this tier yet. Surface as `Vec<()>` placeholder.
pub type ExceptionList = Vec<()>;

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
#[derive(Default)]
pub struct InitOptions {
    pub args: alloc::vec::Vec<alloc::string::String>,
    pub graph: *mut c_void,
    pub smol: bool,
    pub eval_mode: bool,
    pub is_main_thread: bool,
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
    // TODO(b2-cycle): `entry_point` is `bun_bundler::entry_points::ServerEntryPoint` (gated in bundler).
    pub entry_point: (),
    pub origin: bun_url::URL<'static>,
    // TODO(b2-cycle): `node_fs` is `Option<Box<bun_runtime::node::fs::NodeFS>>`.
    pub node_fs: Option<*mut c_void>,
    // TODO(b2-cycle): `timer` is `bun_runtime::api::Timer::All`.
    pub timer: (),
    pub event_loop_handle: Option<*mut PlatformEventLoop>,
    pub pending_unref_counter: i32,
    pub preload: Vec<Box<[u8]>>,
    pub unhandled_pending_rejection_to_capture: Option<*mut JSValue>,
    // TODO(port): lifetime — `Option<&'a StandaloneModuleGraph>`.
    pub standalone_module_graph: Option<NonNull<c_void>>,
    pub smol: bool,
    // TODO(b2-cycle): `dns_result_order` is `bun_runtime::api::dns::Resolver::Order`.
    pub dns_result_order: u8,
    // TODO(b2-cycle): `cpu_profiler_config` / `heap_profiler_config` from gated siblings.
    pub cpu_profiler_config: Option<()>,
    pub heap_profiler_config: Option<()>,
    pub counters: Counters,

    // TODO(b2-cycle): `hot_reload` is `bun_runtime::cli::Command::HotReload`.
    pub hot_reload: u8,
    pub jsc_vm: *mut VM,

    /// hide bun:wrap from stack traces
    pub hide_bun_stackframes: bool,

    pub is_printing_plugin: bool,
    pub is_shutting_down: bool,
    // TODO(b2-cycle): `plugin_runner` is `Option<bun_bundler::transpiler::PluginRunner>` (gated in bundler).
    pub plugin_runner: Option<()>,
    pub is_main_thread: bool,
    pub exit_handler: ExitHandler,

    pub default_tls_reject_unauthorized: Option<bool>,
    // TODO(b2-cycle): `default_verbose_fetch` is `Option<http::HTTPVerboseLevel>`.
    pub default_verbose_fetch: Option<u8>,

    /// Do not access this field directly! It exists in the VirtualMachine struct so
    /// that we don't accidentally make a stack copy of it; only use it through
    /// `source_mappings`.
    // TODO(b2): SavedSourceMap::HashTable — gated until SavedSourceMap.rs un-gates.
    pub saved_source_map_table: (),
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
    // TODO(b2-cycle): `auto_killer` is `ProcessAutoKiller` (gated sibling).
    pub auto_killer: (),

    pub has_any_macro_remappings: bool,
    pub is_from_devserver: bool,
    pub has_enabled_macro_mode: bool,

    /// Used by bun:test to set global hooks for beforeAll, beforeEach, etc.
    pub is_in_preload: bool,
    pub has_patched_run_main: bool,

    // TODO(b2): `transpiler_store` is `RuntimeTranspilerStore` (gated sibling).
    pub transpiler_store: (),

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

    // TODO(b2): `RefString::Map` — RefString.rs gated.
    pub ref_strings: (),
    pub ref_strings_mutex: bun_threading::Mutex,

    pub active_tasks: usize,

    pub rare_data: Option<Box<RareData>>,
    // TODO(b2-cycle): `RareData::ProxyEnvStorage` — rare_data.rs gated.
    pub proxy_env_storage: (),
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
    pub modules: (),
    pub aggressive_garbage_collection: GCLevel,

    pub module_loader: ModuleLoader::ModuleLoader,

    // TODO(b2-cycle): `gc_controller` is `GarbageCollectionController` (gated sibling).
    pub gc_controller: (),
    // BACKREF — WebWorker owns the VM. Real type: `*const bun_runtime::webcore::WebWorker`.
    pub worker: Option<*const c_void>,
    // TODO(b2-cycle): `ipc` is `Option<IPCInstanceUnion>` — depends on ipc.rs (gated sibling).
    pub ipc: Option<()>,
    pub hot_reload_counter: u32,

    // TODO(b2): `debugger` is `Option<Debugger>` (gated sibling).
    pub debugger: Option<()>,
    pub has_started_debugger: bool,
    pub has_terminated: bool,

    #[cfg(debug_assertions)]
    pub debug_thread_id: std::thread::ThreadId,
    #[cfg(not(debug_assertions))]
    pub debug_thread_id: (),

    // TODO(b2-cycle): `body_value_hive_allocator` is `bun_runtime::webcore::Body::Value::HiveAllocator`.
    pub body_value_hive_allocator: (),

    pub is_inside_deferred_task_queue: bool,
    /// When true, drainMicrotasksWithGlobal is suppressed.
    pub suppress_microtask_drain: bool,

    pub channel_ref: Async::KeepAlive,
    pub channel_ref_overridden: bool,
    pub channel_ref_should_ignore_one_disconnect_event_listener: bool,

    /// A set of extensions that exist in the require.extensions map.
    // TODO(b2-cycle): `node_module_module::CustomLoader` — gated sibling.
    pub commonjs_custom_extensions: bun_collections::StringArrayHashMap<()>,
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
}

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

    pub fn dispatch_on_exit(&mut self) {
        // SAFETY: self points to VirtualMachine.exit_handler
        let vm: &mut VirtualMachine = unsafe {
            &mut *((self as *mut Self as *mut u8)
                .sub(offset_of!(VirtualMachine, exit_handler))
                .cast::<VirtualMachine>())
        };
        // SAFETY: extern "C" FFI; vm.global valid for VM lifetime
        unsafe { Process__dispatchOnExit(vm.global, self.exit_code) };
        if vm.is_main_thread() {
            // SAFETY: extern "C" FFI; main-thread-only termination hooks
            unsafe { Bun__closeAllSQLiteDatabasesForTermination() };
            // SAFETY: extern "C" FFI; main-thread-only termination hooks
            unsafe { Bun__WebView__closeAllForTermination() };
        }
    }

    pub fn dispatch_on_before_exit(&mut self) {
        // SAFETY: self points to VirtualMachine.exit_handler
        let vm: &mut VirtualMachine = unsafe {
            &mut *((self as *mut Self as *mut u8)
                .sub(offset_of!(VirtualMachine, exit_handler))
                .cast::<VirtualMachine>())
        };
        // SAFETY: extern "C" FFI; vm.global valid for VM lifetime
        let global = unsafe { &*vm.global };
        let _ = jsc::from_js_host_call_generic(global, || unsafe {
            Process__dispatchOnBeforeExit(vm.global, self.exit_code)
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
    #[inline]
    pub fn get() -> &'static mut VirtualMachine {
        Self::get_or_null().expect("VirtualMachine.get() called with no VM on this thread")
    }

    #[inline]
    pub fn get_or_null() -> Option<&'static mut VirtualMachine> {
        // SAFETY: thread-local set by init() on this thread; one VM per thread
        VMHolder::VM.get().map(|p| unsafe { &mut *p })
    }

    pub fn get_main_thread_vm() -> Option<&'static mut VirtualMachine> {
        // SAFETY: written once during main-thread init
        unsafe { MAIN_THREAD_VM.map(|p| &mut *p) }
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

    #[inline]
    pub fn event_loop(&self) -> &mut EventLoop {
        // SAFETY: event_loop is a self-pointer to regular_event_loop or macro_event_loop
        unsafe { &mut *self.event_loop }
    }

    #[inline]
    pub fn transpiler(&mut self) -> &mut Transpiler<'static> {
        &mut self.transpiler
    }

    #[inline]
    pub fn source_mappings(&mut self) -> &mut SavedSourceMap {
        &mut self.source_mappings
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
        self.event_loop().wakeup();
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
        self.event_loop().enqueue_task(task);
    }

    pub fn tick(&mut self) {
        self.event_loop().tick();
    }

    pub fn drain_microtasks(&mut self) {
        let _ = self.event_loop().drain_microtasks();
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
    pub fn run_with_api_lock<R>(&self, f: impl FnOnce() -> R) -> R {
        // TODO(b2): JSLock acquire/release FFI — gated.
        f()
    }

    pub fn run_error_handler(&mut self, result: JSValue, exception_list: Option<&mut ExceptionList>) {
        let _ = (result, exception_list);
        // TODO(b2-cycle): full impl walks ZigException + ConsoleObject formatter
        // (gated siblings) and calls into bun_runtime::node::process. Stub: count.
        self.unhandled_error_counter += 1;
    }

    pub fn load_macro_entry_point(
        &mut self,
        entry_path: &str,
        function_name: &str,
        specifier: &str,
        hash: i32,
    ) -> JsResult<*mut JSInternalPromise> {
        let _ = (entry_path, function_name, specifier, hash);
        // TODO(b2-cycle): MacroEntryPointLoader + runWithAPILock — bun_bundler::entry_points gated.
        todo!("VirtualMachine::load_macro_entry_point")
    }

    pub fn is_watcher_enabled(&self) -> bool {
        !self.bun_watcher.is_null()
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
}

static RUNTIME_HOOKS: core::sync::atomic::AtomicPtr<RuntimeHooks> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

/// Called by `bun_runtime` at startup to install the real hook table.
/// `hooks` must have `'static` lifetime (typically `&'static RUNTIME_HOOKS_IMPL`).
pub fn set_runtime_hooks(hooks: &'static RuntimeHooks) {
    RUNTIME_HOOKS.store(
        hooks as *const RuntimeHooks as *mut RuntimeHooks,
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
unsafe extern "C" {
    fn ZigGlobalObject__create(
        vm: *mut VirtualMachine,
        console: *mut c_void,
        context_id: i32,
        mini_mode: bool,
        eval_mode: bool,
        worker_ptr: *mut c_void,
    ) -> *mut JSGlobalObject;
    fn Bun__loadHTMLEntryPoint(global: *mut JSGlobalObject) -> *mut JSInternalPromise;
    fn JSC__VM__executionForbidden(vm: *mut VM) -> bool;
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
        jsc::mark_binding(core::panic::Location::caller());

        let log: *mut logger::Log = Box::into_raw(Box::new(logger::Log::default()));

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
        crate::console_object::ConsoleObject::init(
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
        vm_ref.initial_script_execution_context_identifier =
            if opts.is_main_thread { 1 } else { i32::MAX };
        #[cfg(debug_assertions)]
        {
            vm_ref.debug_thread_id = std::thread::current().id();
        }

        // Event-loop wiring (self-pointers).
        vm_ref.regular_event_loop = EventLoop::default();
        vm_ref.regular_event_loop.virtual_machine = NonNull::new(vm);
        let _ = vm_ref.regular_event_loop.tasks.ensure_unused_capacity(64);
        vm_ref.event_loop = &mut vm_ref.regular_event_loop;

        // JSGlobalObject creation.
        // SAFETY: extern "C" FFI; `vm`/`console` valid.
        vm_ref.global = unsafe {
            ZigGlobalObject__create(
                vm,
                console.cast(),
                vm_ref.initial_script_execution_context_identifier,
                opts.smol,
                opts.eval_mode,
                core::ptr::null_mut(),
            )
        };
        vm_ref.regular_event_loop.global = NonNull::new(vm_ref.global);
        // SAFETY: global is freshly created and live for VM lifetime.
        vm_ref.jsc_vm = unsafe { (*vm_ref.global).vm() } as *const VM as *mut VM;
        VMHolder::CACHED_GLOBAL_OBJECT.set(Some(vm_ref.global));

        // Spec VirtualMachine.zig:1313: `uws.Loop.get().internal_loop_data.jsc_vm
        // = vm.jsc_vm` — must run AFTER `jsc_vm` is set so C/uws callbacks can
        // recover the JSC VM via `internal_loop_data`.
        // SAFETY: `uws::Loop::get()` returns the live per-thread uws loop.
        unsafe {
            (*uws::Loop::get()).internal_loop_data.jsc_vm = vm_ref.jsc_vm.cast();
        }

        // High-tier finishes Transpiler / Timer::All / debugger / body-hive.
        // PORT NOTE: spec VirtualMachine.zig:1321-1322 runs configureDebugger
        // / Body.Value.HiveAllocator.init AFTER global creation; the hook must
        // see `vm.global`/`vm.jsc_vm` populated. PERF(port): was inline switch.
        if let Some(hooks) = runtime_hooks() {
            // SAFETY: hook contract — `vm` is the unique live VM on this thread.
            unsafe { (hooks.init_runtime_state)(vm, &opts) };
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
    /// `promise` settles. Hoisted here (vs. the gated `event_loop.rs` body)
    /// so `load_entry_point` can call it without naming `Timer::All`.
    pub fn wait_for_promise(&mut self, promise: jsc::AnyPromise) {
        let jsc_vm = self.jsc_vm;
        loop {
            // SAFETY: AnyPromise wraps a live JSC heap cell.
            let status = match promise {
                jsc::AnyPromise::Normal(p) => unsafe { (*p).status() },
                jsc::AnyPromise::Internal(p) => unsafe { (*p).status() },
            };
            if status != crate::js_promise::Status::Pending {
                break;
            }
            // SAFETY: jsc_vm is live for VM lifetime.
            if unsafe { JSC__VM__executionForbidden(jsc_vm) } {
                break;
            }
            self.event_loop().tick();
            // Re-check after tick before sleeping in auto_tick.
            // SAFETY: see above.
            let status = match promise {
                jsc::AnyPromise::Normal(p) => unsafe { (*p).status() },
                jsc::AnyPromise::Internal(p) => unsafe { (*p).status() },
            };
            if status != crate::js_promise::Status::Pending {
                break;
            }
            self.auto_tick();
        }
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
            self.event_loop().tick();
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

        // TODO(b2-cycle): `transpiler.options.disable_transpilation` — gated
        // bundler field. Assume `false` (always transpile) until un-gated.
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
            jsc::JSModuleLoader::load_and_evaluate_module(global_ref, Some(&name))
                .map(|p| p as *const _ as *mut JSInternalPromise)
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
            self.event_loop().perform_gc();
            loop {
                let Some(p) = self.pending_internal_promise else { break };
                // SAFETY: `p` is a live JSC heap cell tracked by the VM.
                if unsafe { (*p).status() } != crate::js_promise::Status::Pending {
                    break;
                }
                self.event_loop().tick();
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
            self.event_loop().perform_gc();
            self.wait_for_promise(jsc::AnyPromise::Internal(promise));
        }

        Ok(self.pending_internal_promise.unwrap_or(promise))
    }

    /// Drain pending tasks/microtasks if the event loop is not currently
    /// re-entered. Port-side convenience used after top-level evaluation on
    /// the `bun -e` path (Zig open-codes `eventLoop().tick()` +
    /// `drainMicrotasks()` at each call site).
    pub fn drain_queues_if_needed(&mut self) {
        if self.event_loop().entered_event_loop_count > 0 {
            return;
        }
        self.event_loop().tick();
        let _ = self.event_loop().drain_microtasks();
        // SAFETY: global is valid for VM lifetime.
        unsafe { (*self.global).handle_rejected_promises() };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun_runtime` / `bun_schema` / gated-sibling-dependent impl — preserved
// verbatim from the Phase-A draft. Un-gate piecewise once the cycle breaks.
// ──────────────────────────────────────────────────────────────────────────
#[cfg(any())]
mod _gated_impl {
    include!("VirtualMachine.gated.rs");
}
// PORT NOTE: the full Phase-A draft (3550 lines) referenced ~40 types from
// `bun_runtime` (cycle), `bun_schema` (no crate), `bun_spawn`/`bun_output`
// (no workspace dep), and gated bundler internals. Rather than duplicate it
// here under `#[cfg(any())]`, the original is preserved in git history at
// commit `5410a51d85^` (`git show 5410a51d85^:src/jsc/VirtualMachine.rs`).
// The methods listed below are the ones whose bodies were gated; each maps
// 1:1 to a `pub fn` in `VirtualMachine.zig`.
#[cfg(any())]
impl VirtualMachine {
    pub fn get_dev_server_async_local_storage(&mut self) -> JsResult<Option<JSValue>> { todo!() }
    pub fn allow_addons(this: &VirtualMachine) -> bool { todo!() }
    pub fn allow_rejection_handled_warning(this: &VirtualMachine) -> bool { todo!() }
    pub fn unhandled_rejections_mode(&self) -> bun_options_types::schema::api::UnhandledRejections { todo!() }
    pub fn init_request_body_value(&mut self, body: bun_runtime::webcore::Body::Value) { todo!() }
    pub fn should_destruct_main_thread_on_exit(&self) -> bool { todo!() }
    pub fn uv_loop(&self) -> &'static Async::Loop { todo!() }
    pub fn get_tls_reject_unauthorized(&self) -> bool { todo!() }
    pub fn on_subprocess_spawn(&mut self, process: &mut bun_spawn::Process) { todo!() }
    pub fn on_subprocess_exit(&mut self, process: &mut bun_spawn::Process) { todo!() }
    pub fn get_verbose_fetch(&mut self) -> bun_http::HTTPVerboseLevel { todo!() }
    pub fn mime_type(&mut self, str: &[u8]) -> Option<bun_http::MimeType> { todo!() }
    pub fn source_map_handler<'a>(&'a self, printer: &'a mut bun_js_printer::BufferPrinter) { todo!() }
    pub fn load_extra_env_and_source_code_printer(&mut self) { todo!() }
    pub fn unhandled_rejection(&mut self, global_object: &JSGlobalObject, reason: JSValue, promise: JSValue) { todo!() }
    pub fn uncaught_exception(&mut self, global_object: &JSGlobalObject, err: JSValue, is_rejection: bool) -> bool { todo!() }
    pub fn report_exception_in_hot_reloaded_module_if_needed(&mut self) { todo!() }
    pub fn add_main_to_watcher_if_needed(&mut self) { todo!() }
    pub fn package_manager(&mut self) -> &mut bun_install::PackageManager { todo!() }
    pub fn reload(&mut self, _: Option<&mut crate::hot_reloader::HotReloader::Task>) { todo!() }
    pub fn node_fs(&mut self) -> &mut bun_runtime::node::fs::NodeFS { todo!() }
    pub fn on_before_exit(&mut self) { todo!() }
    pub fn on_exit(&mut self) { todo!() }
    pub fn global_exit(&mut self) -> ! { todo!() }
    pub fn next_async_task_id(&mut self) -> u64 { todo!() }
    pub fn hot_map(&mut self) -> Option<&mut RareData::HotMap> { todo!() }
    pub fn enqueue_immediate_task(&mut self, task: *mut bun_runtime::api::Timer::ImmediateObject) { todo!() }
    pub fn enqueue_task_concurrent(&mut self, task: *mut crate::event_loop::ConcurrentTaskItem) { todo!() }
    pub fn wait_for(&mut self, cond: &mut bool) { todo!() }
    pub fn wait_for_tasks(&mut self) { todo!() }
    pub fn init_with_module_graph(opts: Options) -> Result<*mut VirtualMachine, bun_core::Error> { todo!() }
    pub fn init_worker(worker: &mut bun_runtime::webcore::WebWorker, opts: Options) -> Result<*mut VirtualMachine, bun_core::Error> { todo!() }
    pub fn init_bake(opts: Options) -> Result<*mut VirtualMachine, bun_core::Error> { todo!() }
    pub fn clear_ref_string(_: *mut c_void, ref_string: &mut crate::RefString) { todo!() }
    pub fn ref_counted_resolved_source<const ADD_DOUBLE_REF: bool>() { todo!() }
    pub fn ref_counted_string<const DUPE: bool>(&mut self, input_: &[u8], hash_: Option<u32>) { todo!() }
    pub fn fetch_without_on_load_plugins<const FLAGS: FetchFlags>() { todo!() }
    pub fn resolve() { todo!() }
    pub fn resolve_maybe_needs_trailing_slash<const IS_A_FILE_PATH: bool>() { todo!() }
    pub fn process_fetch_log() { todo!() }
    pub fn destroy(&mut self) { todo!() }
    pub fn print_exception() { todo!() }
    pub fn clear_entry_point(&mut self) -> JsResult<()> { todo!() }
    pub fn use_isolation_source_provider_cache(&self) -> bool { todo!() }
    pub fn reload_entry_point_for_test_runner(&mut self, entry_path: &[u8]) -> Result<*mut JSInternalPromise, bun_core::Error> { todo!() }
    pub fn load_entry_point_for_web_worker(&mut self, entry_path: &[u8]) -> Result<*mut JSInternalPromise, bun_core::Error> { todo!() }
    pub fn load_entry_point_for_test_runner(&mut self, entry_path: &[u8]) -> Result<*mut JSInternalPromise, bun_core::Error> { todo!() }
    pub fn add_listening_socket_for_watch_mode(&mut self, socket: bun_sys::Fd) { todo!() }
    pub fn remove_listening_socket_for_watch_mode(&mut self, socket: bun_sys::Fd) { todo!() }
    pub fn swap_global_for_test_isolation(&mut self) { todo!() }
    pub fn _load_macro_entry_point(&mut self, entry_path: &[u8]) -> Option<*mut JSInternalPromise> { todo!() }
    pub fn print_error_like_object_to_console(&mut self, value: JSValue) { todo!() }
    pub fn print_errorlike_object() { todo!() }
    pub fn report_uncaught_exception(global_object: &JSGlobalObject, exception: &Exception) -> JSValue { todo!() }
    pub fn print_stack_trace() { todo!() }
    pub fn remap_stack_frame_positions(&mut self, frames: *mut crate::ZigStackFrame, frames_count: usize) { todo!() }
    pub fn remap_zig_exception() { todo!() }
    pub fn print_externally_remapped_zig_exception() { todo!() }
    pub fn print_github_annotation(exception: &ZigException) { todo!() }
    pub fn resolve_source_mapping() { todo!() }
    pub fn init_ipc_instance(&mut self, fd: bun_sys::Fd, mode: crate::ipc::Mode) { todo!() }
    pub fn get_ipc_instance(&mut self) -> Option<&mut IPCInstance> { todo!() }
    pub fn get_loaders(&mut self) -> &mut bun_options_types::Loader::HashTable { todo!() }
    pub fn bust_dir_cache(&mut self, path: &[u8]) -> bool { todo!() }
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
