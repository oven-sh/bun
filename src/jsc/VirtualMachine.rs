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
    /// Opaque per-VM `bun_runtime` state (boxed `timer::All` +
    /// `ServerEntryPoint` + …). Set by `RuntimeHooks::init_runtime_state` in
    /// [`init`]; reclaimed by `RuntimeHooks::deinit_runtime_state` in
    /// [`destroy`]. Null when no high tier is installed (e.g. `bun_jsc` unit
    /// tests). Aggregates the `()` placeholder fields above until they widen.
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

    pub debugger: Option<Box<crate::debugger::Debugger>>,
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
    ///
    /// Spec VirtualMachine.zig:2629-2631: `this.global.vm().holdAPILock(ctx, callback)`.
    /// Routes `f` through `JSC__VM__holdAPILock` via an `OpaqueWrap`-style C
    /// trampoline so the JSC API lock is held for the full duration of `f()`.
    pub fn run_with_api_lock<R>(&self, f: impl FnOnce() -> R) -> R {
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

        let mut t = Trampoline::<_, R> {
            f: ManuallyDrop::new(f),
            result: MaybeUninit::uninit(),
        };
        // SAFETY: `self.jsc_vm` is the live JSC VM for this thread; `t` lives
        // on this stack frame for the duration of the FFI call, which invokes
        // `call` exactly once before returning.
        unsafe {
            JSC__VM__holdAPILock(self.jsc_vm, (&raw mut t).cast(), call::<_, R>);
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
            let _ = (result, exception_list);
            todo!("b2-cycle: run_error_handler needs ConsoleObject formatter via RuntimeHooks");
        }

        // PORT NOTE: Zig `defer this.had_errors = prev_had_errors;` — the hook
        // does not unwind across the dispatch boundary, so restore linearly.
        self.had_errors = prev_had_errors;
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
                // SAFETY: `event_loop` is a self-pointer into this VM; uniquely
                // accessed here (no live `&mut EventLoop` overlaps).
                unsafe { (*self.event_loop()).auto_tick_active() };
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
        if let Some(_config) = self.cpu_profiler_config.take() {
            // TODO(b2-cycle): `CPUProfiler::stop_and_write_profile(self.jsc_vm,
            // config)` — `bun_cpu_profiler` sibling is gated and the config
            // field is an `Option<()>` placeholder.
        }
        // Write heap profile if profiling was enabled - do this after CPU
        // profile but before shutdown.
        if let Some(_config) = self.heap_profiler_config.take() {
            // TODO(b2-cycle): `HeapProfiler::generate_and_write_profile(
            // self.jsc_vm, config)` — `bun_heap_profiler` sibling is gated and
            // the config field is an `Option<()>` placeholder.
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
    /// `printException` / `printErrorlikeObject` — formats `value` (or its
    /// wrapped `JSC::Exception`) to stderr via `ConsoleObject::Formatter`.
    /// Spec `runErrorHandler` body (VirtualMachine.zig:2164-2188). High tier
    /// owns the formatter; low tier dispatches here from
    /// [`VirtualMachine::run_error_handler`].
    pub print_exception:
        unsafe fn(vm: *mut VirtualMachine, value: JSValue, exception_list: Option<&mut ExceptionList>),
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
            // Write through the raw `vm` ptr (not `vm_ref`) so no `&mut
            // VirtualMachine` is held live across the hook call — the hook
            // body may itself dereference `vm`.
            unsafe { (*vm).runtime_state = (hooks.init_runtime_state)(vm, &opts) };
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
    pub fn uv_loop(&self) -> &'static Async::Loop { todo!() }
    pub fn get_tls_reject_unauthorized(&self) -> bool { todo!() }
    pub fn on_subprocess_spawn(&mut self, process: &mut bun_spawn::Process) { todo!() }
    pub fn on_subprocess_exit(&mut self, process: &mut bun_spawn::Process) { todo!() }
    pub fn get_verbose_fetch(&mut self) -> bun_http::HTTPVerboseLevel { todo!() }
    pub fn mime_type(&mut self, str: &[u8]) -> Option<bun_http::MimeType> { todo!() }
    pub fn load_extra_env_and_source_code_printer(&mut self) { todo!() }
    pub fn unhandled_rejection(&mut self, global_object: &JSGlobalObject, reason: JSValue, promise: JSValue) { todo!() }
    pub fn report_exception_in_hot_reloaded_module_if_needed(&mut self) { todo!() }
    pub fn add_main_to_watcher_if_needed(&mut self) { todo!() }
    pub fn package_manager(&mut self) -> &mut bun_install::PackageManager { todo!() }
    pub fn reload(&mut self, _: Option<&mut crate::hot_reloader::HotReloader::Task>) { todo!() }
    pub fn node_fs(&mut self) -> &mut bun_runtime::node::fs::NodeFS { todo!() }
    pub fn next_async_task_id(&mut self) -> u64 { todo!() }
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
