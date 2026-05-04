//! This is the shared global state for a single JS instance execution.
//!
//! Today, Bun is one VM per thread, so the name "VirtualMachine" sort of makes
//! sense. If that changes, this should be renamed `ScriptExecutionContext`.

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};
use core::mem::offset_of;
use core::ptr::NonNull;

use bun_core::{self as bun, Environment, Global, Output, fmt as bunfmt};
use bun_core::env_var;
use bun_logger as logger;
use bun_str::{self as strings, String, ZigString};
use bun_alloc::Arena; // MimallocArena
use bun_uws as uws;
use bun_aio as Async;
use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_paths::{self as path, PathBuffer, MAX_PATH_BYTES};
use bun_sourcemap as SourceMap;
use bun_options_types::ImportKind;
use bun_bundler::{options, Transpiler};
use bun_bundler::transpiler::PluginRunner;
use bun_bundler::entry_points::{MacroEntryPoint, ServerEntryPoint};
use bun_js_parser::{self as js_ast, js_printer};
use bun_http as http;
use bun_url::URL;
use bun_resolver::{self as Resolver, fs as Fs};
use bun_install::PackageManager;
use bun_schema::api;
use bun_runtime::api::dns::Resolver as DNSResolver;
use bun_runtime::api::Timer;
use bun_runtime::api::node as Node;
use bun_runtime::webcore::{self, Body};
use bun_dotenv as DotEnv;
use bun_watcher::Watcher;

use bun_jsc::{
    self as jsc, JSValue, JSGlobalObject, CallFrame, JSInternalPromise, JSModuleLoader,
    Exception, ZigException, ZigStackTrace, VM, Strong, JsResult, JsError,
    ConsoleObject, ResolvedSource, ErrorableString, ErrorableResolvedSource, RefString,
    EventLoop, RareData, SavedSourceMap, ScriptExecutionStatus, AnyPromise, Task,
    ConcurrentTask, GarbageCollectionController, PlatformEventLoop, OpaqueCallback,
    Debugger, RuntimeTranspilerCache,
};

use crate::config as Config;
use crate::counters::Counters;
use crate::ipc as IPC;
use crate::node_module_module;
use crate::module_loader::{self as ModuleLoader, FetchFlags, RuntimeTranspilerStore, node_fallbacks};
use crate::hot_reloader::{HotReloader, ImportWatcher};
use crate::bun_cpu_profiler::{self as CPUProfiler, CPUProfilerConfig};
use crate::bun_heap_profiler::{self as HeapProfiler, HeapProfilerConfig};

pub use crate::process_auto_killer::ProcessAutoKiller;

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
#[unsafe(no_mangle)]
#[export_name = "Bun__stringSyntheticAllocationLimit"]
pub static mut STRING_ALLOCATION_LIMIT: usize = u32::MAX as usize;

// ──────────────────────────────────────────────────────────────────────────
// Type aliases
// ──────────────────────────────────────────────────────────────────────────

pub type OnUnhandledRejection = fn(&mut VirtualMachine, &JSGlobalObject, JSValue);
pub type OnException = fn(&mut ZigException);
pub type MacroMap = ArrayHashMap<i32, jsc::C::JSObjectRef>;
pub type ExceptionList = Vec<api::JsException>;

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine struct (file-level @This())
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct EntryPointResult {
    pub value: Strong, // jsc.Strong.Optional
    pub cjs_set_value: bool,
}

pub struct VirtualMachine {
    pub global: *mut JSGlobalObject,
    // allocator: dropped per §Allocators (global mimalloc)
    pub has_loaded_constructors: bool,
    pub transpiler: Transpiler,
    pub bun_watcher: ImportWatcher,
    pub console: Box<ConsoleObject>,
    // TODO(port): lifetime — LIFETIMES.tsv says BORROW_PARAM (`&'a mut logger::Log`);
    // raw NonNull used because VM is self-referential and cannot carry `<'a>`.
    pub log: Option<NonNull<logger::Log>>,
    pub main: &'static [u8],   // TODO(port): lifetime — never freed in deinit, often points to argv
    pub main_is_html_entrypoint: bool,
    pub main_resolved_path: bun_str::String,
    pub main_hash: u32,
    /// Set if code overrides Bun.main to a custom value, and then reset when the VM loads a new file
    /// (e.g. when bun:test starts testing a new file)
    pub overridden_main: Strong,
    pub entry_point: ServerEntryPoint,
    pub origin: URL,
    pub node_fs: Option<Box<Node::fs::NodeFS>>,
    pub timer: Timer::All,
    pub event_loop_handle: Option<&'static PlatformEventLoop>,
    pub pending_unref_counter: i32,
    pub preload: Vec<Box<[u8]>>, // TODO(port): lifetime — Zig is `[]const []const u8`
    pub unhandled_pending_rejection_to_capture: Option<*mut JSValue>,
    // TODO(port): lifetime — LIFETIMES.tsv says BORROW_PARAM (`Option<&'a StandaloneModuleGraph>`).
    pub standalone_module_graph: Option<NonNull<bun::StandaloneModuleGraph>>,
    pub smol: bool,
    pub dns_result_order: DNSResolver::Order,
    pub cpu_profiler_config: Option<CPUProfilerConfig>,
    pub heap_profiler_config: Option<HeapProfilerConfig>,
    pub counters: Counters,

    pub hot_reload: bun_cli::Command::HotReload,
    pub jsc_vm: *mut VM,

    /// hide bun:wrap from stack traces
    /// bun:wrap is very noisy
    pub hide_bun_stackframes: bool,

    pub is_printing_plugin: bool,
    pub is_shutting_down: bool,
    pub plugin_runner: Option<PluginRunner>,
    pub is_main_thread: bool,
    pub exit_handler: ExitHandler,

    pub default_tls_reject_unauthorized: Option<bool>,
    pub default_verbose_fetch: Option<http::HTTPVerboseLevel>,

    /// Do not access this field directly!
    ///
    /// It exists in the VirtualMachine struct so that we don't accidentally
    /// make a stack copy of it only use it through source_mappings.
    pub saved_source_map_table: SavedSourceMap::HashTable,
    pub source_mappings: SavedSourceMap,

    // TODO(port): lifetime — LIFETIMES.tsv says BORROW_PARAM (`&'a mut Arena`); caller-owned (web_worker).
    pub arena: Option<NonNull<Arena>>,
    pub has_loaded: bool,

    pub transpiled_count: usize,
    pub resolved_count: usize,
    pub had_errors: bool,

    pub macros: MacroMap,
    pub macro_entry_points: ArrayHashMap<i32, *mut MacroEntryPoint>,
    pub macro_mode: bool,
    pub no_macros: bool,
    pub auto_killer: ProcessAutoKiller,

    pub has_any_macro_remappings: bool,
    pub is_from_devserver: bool,
    pub has_enabled_macro_mode: bool,

    /// Used by bun:test to set global hooks for beforeAll, beforeEach, etc.
    pub is_in_preload: bool,
    pub has_patched_run_main: bool,

    pub transpiler_store: RuntimeTranspilerStore,

    pub after_event_loop_callback_ctx: Option<*mut c_void>,
    pub after_event_loop_callback: Option<OpaqueCallback>,

    pub remap_stack_frames_mutex: bun_threading::Mutex,

    /// The arguments used to launch the process _after_ the script name and bun and any flags applied to Bun
    pub argv: Vec<Box<[u8]>>, // TODO(port): lifetime — borrowed from CLI argv

    pub origin_timer: std::time::Instant, // TODO(port): std.time.Timer
    pub origin_timestamp: u64,
    /// For fake timers: override performance.now() with a specific value (in nanoseconds)
    /// When null, use the real timer. When set, return this value instead.
    pub overridden_performance_now: Option<u64>,
    pub macro_event_loop: EventLoop,
    pub regular_event_loop: EventLoop,
    pub event_loop: *mut EventLoop, // BORROW_FIELD — points at sibling regular_event_loop/macro_event_loop

    pub ref_strings: RefString::Map,
    pub ref_strings_mutex: bun_threading::Mutex,

    pub active_tasks: usize,

    pub rare_data: Option<Box<RareData>>,
    /// Owned storage for proxy env vars set via process.env at runtime.
    pub proxy_env_storage: RareData::ProxyEnvStorage,
    pub is_us_loop_entered: bool,
    pub pending_internal_promise: Option<*mut JSInternalPromise>,
    pub pending_internal_promise_is_protected: bool,
    /// hot_reload_counter value at which we last surfaced a rejected
    /// pending_internal_promise.
    pub pending_internal_promise_reported_at: u32,
    /// A watcher event arrived while pending_internal_promise was still pending.
    pub hot_reload_deferred: bool,
    pub entry_point_result: EntryPointResult,

    pub auto_install_dependencies: bool,

    pub on_unhandled_rejection: OnUnhandledRejection,
    pub on_unhandled_rejection_ctx: Option<*mut c_void>,
    // TODO(port): lifetime — LIFETIMES.tsv says BORROW_PARAM (`Option<&'a mut ExceptionList>`).
    pub on_unhandled_rejection_exception_list: Option<NonNull<ExceptionList>>,
    pub unhandled_error_counter: usize,
    pub is_handling_uncaught_exception: bool,
    pub exit_on_uncaught_exception: bool,

    pub modules: ModuleLoader::AsyncModule::Queue,
    pub aggressive_garbage_collection: GCLevel,

    pub module_loader: ModuleLoader::ModuleLoader,

    pub gc_controller: GarbageCollectionController,
    pub worker: Option<*const webcore::WebWorker>, // BACKREF — WebWorker owns the VM
    pub ipc: Option<IPCInstanceUnion>,
    pub hot_reload_counter: u32,

    pub debugger: Option<Debugger>,
    pub has_started_debugger: bool,
    pub has_terminated: bool,

    #[cfg(debug_assertions)]
    pub debug_thread_id: std::thread::ThreadId,
    #[cfg(not(debug_assertions))]
    pub debug_thread_id: (),

    pub body_value_hive_allocator: webcore::Body::Value::HiveAllocator,

    pub is_inside_deferred_task_queue: bool,
    /// When true, drainMicrotasksWithGlobal is suppressed.
    pub suppress_microtask_drain: bool,

    pub channel_ref: Async::KeepAlive,
    pub channel_ref_overridden: bool,
    pub channel_ref_should_ignore_one_disconnect_event_listener: bool,

    /// A set of extensions that exist in the require.extensions map.
    pub commonjs_custom_extensions: StringArrayHashMap<node_module_module::CustomLoader>,
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
    // TODO(port): callconv(jsc.conv) — needs #[bun_jsc::host_call] ABI rewrite
    fn Bake__getAsyncLocalStorage(globalObject: *mut JSGlobalObject) -> JSValue;

    fn Bun__handleUncaughtException(global: *mut JSGlobalObject, err: JSValue, is_rejection: c_int) -> c_int;
    fn Bun__handleUnhandledRejection(global: *mut JSGlobalObject, reason: JSValue, promise: JSValue) -> c_int;
    fn Bun__wrapUnhandledRejectionErrorForUncaughtException(global: *mut JSGlobalObject, reason: JSValue) -> JSValue;
    fn Bun__emitHandledPromiseEvent(global: *mut JSGlobalObject, promise: JSValue) -> bool;
    fn Bun__promises__isErrorLike(global: *mut JSGlobalObject, reason: JSValue) -> bool;
    fn Bun__promises__emitUnhandledRejectionWarning(global: *mut JSGlobalObject, reason: JSValue, promise: JSValue);
    fn Bun__noSideEffectsToString(vm: *mut VM, globalObject: *mut JSGlobalObject, reason: JSValue) -> JSValue;

    fn Zig__GlobalObject__destructOnExit(global: *mut JSGlobalObject);
    fn BakeCreateProdGlobal(console_ptr: *mut c_void) -> *mut JSGlobalObject;
    fn Bun__loadHTMLEntryPoint(global: *mut JSGlobalObject) -> *mut JSInternalPromise;
    fn NodeModuleModule__callOverriddenRunMain(global: *mut JSGlobalObject, argv1: JSValue) -> JSValue;

    fn Process__emitMessageEvent(global: *mut JSGlobalObject, value: JSValue, handle: JSValue);
    fn Process__emitDisconnectEvent(global: *mut JSGlobalObject);
    pub fn Process__emitErrorEvent(global: *mut JSGlobalObject, value: JSValue);

    fn Process__dispatchOnBeforeExit(global: *mut JSGlobalObject, code: u8);
    fn Process__dispatchOnExit(global: *mut JSGlobalObject, code: u8);
    fn Bun__closeAllSQLiteDatabasesForTermination();
    fn Bun__WebView__closeAllForTermination();
}

// ──────────────────────────────────────────────────────────────────────────
// Nested types
// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)] // u3 in Zig — smallest fitting repr
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum GCLevel {
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

pub struct VMHolder;
impl VMHolder {
    thread_local! {
        pub static VM: Cell<Option<*mut VirtualMachine>> = const { Cell::new(None) };
        pub static CACHED_GLOBAL_OBJECT: Cell<Option<*mut JSGlobalObject>> = const { Cell::new(None) };
    }
    pub static mut MAIN_THREAD_VM: Option<*mut VirtualMachine> = None;

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__setDefaultGlobalObject(global: *mut JSGlobalObject) {
        if let Some(vm_instance) = Self::VM.get() {
            // SAFETY: vm pointer set by init() on this thread
            let vm_instance = unsafe { &mut *vm_instance };
            vm_instance.global = global;
            // Ensure this is always set when it should be.
            if vm_instance.is_main_thread {
                // SAFETY: mutable static only touched on the main JS thread
                unsafe { Self::MAIN_THREAD_VM = Some(vm_instance) };
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
    pub static SOURCE_CODE_PRINTER: Cell<Option<*mut js_printer::BufferPrinter>> = const { Cell::new(None) };
}

pub static mut IS_SMOL_MODE: bool = false;

pub struct Options<'a> {
    // allocator: dropped per §Allocators
    pub args: api::TransformOptions,
    pub log: Option<&'a mut logger::Log>,
    pub env_loader: Option<&'a mut DotEnv::Loader>,
    pub store_fd: bool,
    pub smol: bool,
    pub dns_result_order: DNSResolver::Order,
    /// --print needs the result from evaluating the main module
    pub eval: bool,
    pub graph: Option<&'a bun::StandaloneModuleGraph>,
    pub debugger: bun_cli::Command::Debugger,
    pub is_main_thread: bool,
    /// Whether this VM should be destroyed after it exits, even if it is the main thread's VM.
    pub destruct_main_thread_on_exit: bool,
}

pub struct ResolveFunctionResult {
    pub result: Option<Resolver::Result>,
    pub path: &'static [u8], // TODO(port): lifetime — points into resolver result/spec
    pub query_string: &'static [u8],
}

pub const MAIN_FILE_NAME: &[u8] = b"bun:main";

/// Instead of storing timestamp as a i128, we store it as a u64.
/// We subtract the timestamp from Jan 1, 2000 (Y2K)
pub const ORIGIN_RELATIVE_EPOCH: i128 = 946_684_800 * 1_000_000_000;

struct SourceMapHandlerGetter<'a> {
    vm: &'a VirtualMachine,
    printer: &'a mut js_printer::BufferPrinter,
}

impl<'a> SourceMapHandlerGetter<'a> {
    pub fn get(&mut self) -> js_printer::SourceMapHandler {
        if self.vm.debugger.is_none() || self.vm.debugger.as_ref().unwrap().mode == Debugger::Mode::Connect {
            return SavedSourceMap::SourceMapHandler::init(&self.vm.source_mappings);
        }
        js_printer::SourceMapHandler::for_handler(self, Self::on_chunk)
    }

    /// When the inspector is enabled, we want to generate an inline sourcemap.
    /// And, for now, we also store it in source_mappings like normal.
    /// This is hideously expensive memory-wise...
    pub fn on_chunk(&mut self, chunk: SourceMap::Chunk, source: &logger::Source) -> Result<(), bun_core::Error> {
        let mut temp_json_buffer = bun::MutableString::init_empty();
        chunk.print_source_map_contents_from_internal(source, &mut temp_json_buffer, true, true)?;
        const SOURCE_MAP_URL_PREFIX_START: &[u8] = b"//# sourceMappingURL=data:application/json;base64,";
        // TODO: do we need to %-encode the path?
        let source_url_len = source.path.text.len();
        const SOURCE_MAPPING_URL: &[u8] = b"\n//# sourceURL=";
        let prefix_len = SOURCE_MAP_URL_PREFIX_START.len() + SOURCE_MAPPING_URL.len() + source_url_len;

        self.vm.source_mappings.put_mappings(source, chunk.buffer)?;
        let encode_len = bun_base64::encode_len(temp_json_buffer.list.as_slice());
        self.printer.ctx.buffer.grow_if_needed(encode_len + prefix_len + 2)?;
        // PERF(port): was appendAssumeCapacity — profile in Phase B
        self.printer.ctx.buffer.append_slice(b"\n");
        self.printer.ctx.buffer.append_slice(SOURCE_MAP_URL_PREFIX_START);
        // TODO(port): direct base64 encode into spare capacity
        let written = {
            let buf = &mut self.printer.ctx.buffer;
            let start = buf.len();
            let cap = buf.list.capacity();
            // SAFETY: capacity reserved above
            let dst = unsafe { core::slice::from_raw_parts_mut(buf.list.as_mut_ptr().add(start), cap - start) };
            bun_base64::encode(dst, temp_json_buffer.list.as_slice())
        };
        // SAFETY: encode wrote `encode_len` bytes
        unsafe { self.printer.ctx.buffer.list.set_len(self.printer.ctx.buffer.list.len() + encode_len) };
        let _ = written;
        self.printer.ctx.buffer.append_slice(SOURCE_MAPPING_URL);
        // TODO: do we need to %-encode the path?
        self.printer.ctx.buffer.append_slice(source.path.text);
        self.printer.ctx.buffer.append(b"\n")?;
        Ok(())
    }
}

struct MacroEntryPointLoader {
    path: &'static [u8], // TODO(port): lifetime
    promise: Option<*mut JSInternalPromise>,
}

impl MacroEntryPointLoader {
    pub fn load(&mut self) {
        self.promise = VirtualMachine::get()._load_macro_entry_point(self.path);
    }
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

    pub fn dispatch_on_exit(&mut self) {
        jsc::mark_binding!();
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
        jsc::mark_binding!();
        // SAFETY: self points to VirtualMachine.exit_handler
        let vm: &mut VirtualMachine = unsafe {
            &mut *((self as *mut Self as *mut u8)
                .sub(offset_of!(VirtualMachine, exit_handler))
                .cast::<VirtualMachine>())
        };
        // SAFETY: extern "C" FFI; vm.global valid for VM lifetime
        let _ = jsc::from_js_host_call_generic(vm.global, || unsafe {
            Process__dispatchOnBeforeExit(vm.global, self.exit_code)
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// IPC types
// ──────────────────────────────────────────────────────────────────────────

pub enum IPCInstanceUnion {
    /// IPC is put in this "enabled but not started" state when IPC is detected
    /// but the client JavaScript has not yet done `.on("message")`
    Waiting { fd: bun_sys::Fd, mode: IPC::Mode },
    Initialized(Box<IPCInstance>),
}

pub struct IPCInstance {
    pub global_this: *mut JSGlobalObject, // JSC_BORROW
    /// Embedded per-VM group on `RareData.spawn_ipc_group`; this is just a
    /// borrowed handle so the isolation swap can skip it.
    #[cfg(unix)]
    pub group: *mut uws::SocketGroup, // BORROW_PARAM
    #[cfg(not(unix))]
    pub group: (),
    pub data: IPC::SendQueue,
    pub has_disconnect_called: bool,
}

impl IPCInstance {
    pub fn ipc(&mut self) -> Option<&mut IPC::SendQueue> {
        Some(&mut self.data)
    }

    pub fn get_global_this(&self) -> Option<*mut JSGlobalObject> {
        Some(self.global_this)
    }

    pub fn handle_ipc_message(&mut self, message: IPC::DecodedIPCMessage, handle: JSValue) {
        jsc::mark_binding!();
        let global_this = self.global_this;
        let event_loop = VirtualMachine::get().event_loop();

        match message {
            // In future versions we can read this in order to detect version mismatches,
            // or disable future optimizations if the subprocess is old.
            IPC::DecodedIPCMessage::Version(v) => {
                bun_output::scoped_log!(IPC, "Parent IPC version is {}", v);
            }
            IPC::DecodedIPCMessage::Data(data) => {
                bun_output::scoped_log!(IPC, "Received IPC message from parent");
                event_loop.enter();
                let _exit = scopeguard::guard((), |_| event_loop.exit());
                // SAFETY: extern "C" FFI; global_this/data/handle live on stack (GC scan)
                unsafe { Process__emitMessageEvent(global_this, data, handle) };
            }
            IPC::DecodedIPCMessage::Internal(data) => {
                bun_output::scoped_log!(IPC, "Received IPC internal message from parent");
                event_loop.enter();
                let _exit = scopeguard::guard((), |_| event_loop.exit());
                let _ = bun_runtime::node::node_cluster_binding::handle_internal_message_child(global_this, data);
            }
        }
    }

    pub fn handle_ipc_close(&mut self) {
        bun_output::scoped_log!(IPC, "IPCInstance#handleIPCClose");
        let vm = VirtualMachine::get();
        let event_loop = vm.event_loop();
        bun_runtime::node::node_cluster_binding::child_singleton_deinit();
        event_loop.enter();
        // SAFETY: extern "C" FFI; vm.global valid for VM lifetime
        unsafe { Process__emitDisconnectEvent(vm.global) };
        event_loop.exit();
        // Group is embedded in RareData and shared with subprocess IPC; nothing
        // to free here.
        vm.channel_ref.disable();
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__closeChildIPC(global: &JSGlobalObject) {
        if let Some(current_ipc) = global.bun_vm().get_ipc_instance() {
            current_ipc.data.close_socket_next_tick(true);
        }
    }

    // TODO(port): pub const Handlers = IPC.NewIPCHandler(IPCInstance) — type-generator macro
}

impl Drop for IPCInstance {
    /// Only reached from the `getIPCInstance` error path. On Windows,
    /// `windowsConfigureClient` sets `data.socket = .open` before calling
    /// `uv_read_start`; if that fails it calls `closeSocket()` which queues
    /// the tracked `_onAfterIPCClosed` task holding `*SendQueue` — so
    /// `SendQueue.deinit()` must run here to cancel it before this
    /// allocation (and the embedded `SendQueue`) is freed.
    fn drop(&mut self) {
        // data.deinit() handled by SendQueue's Drop
    }
}

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine impl
// ──────────────────────────────────────────────────────────────────────────

impl VirtualMachine {
    pub fn get_dev_server_async_local_storage(&mut self) -> JsResult<Option<JSValue>> {
        // SAFETY: extern "C" FFI; self.global valid for VM lifetime
        let jsvalue = jsc::from_js_host_call(self.global, || unsafe { Bake__getAsyncLocalStorage(self.global) })?;
        if jsvalue.is_empty_or_undefined_or_null() {
            return Ok(None);
        }
        Ok(Some(jsvalue))
    }

    #[unsafe(no_mangle)]
    #[export_name = "Bun__VM__allowAddons"]
    pub extern "C" fn allow_addons(this: &VirtualMachine) -> bool {
        this.transpiler.options.transform_options.allow_addons.unwrap_or(true)
    }

    #[unsafe(no_mangle)]
    #[export_name = "Bun__VM__allowRejectionHandledWarning"]
    pub extern "C" fn allow_rejection_handled_warning(this: &VirtualMachine) -> bool {
        this.unhandled_rejections_mode() != api::UnhandledRejections::Bun
    }

    pub fn unhandled_rejections_mode(&self) -> api::UnhandledRejections {
        self.transpiler.options.transform_options.unhandled_rejections.unwrap_or(api::UnhandledRejections::Bun)
    }

    pub fn init_request_body_value(&mut self, body: webcore::Body::Value) -> Result<*mut Body::Value::HiveRef, bun_core::Error> {
        Body::Value::HiveRef::init(body, &mut self.body_value_hive_allocator)
    }

    /// Whether this VM should be destroyed after it exits, even if it is the main thread's VM.
    pub fn should_destruct_main_thread_on_exit(&self) -> bool {
        bun_core::feature_flag::BUN_DESTRUCT_VM_ON_EXIT.get()
    }

    pub fn uws_loop(&self) -> &'static uws::Loop {
        #[cfg(unix)]
        {
            if cfg!(debug_assertions) {
                return self.event_loop_handle.expect("uws event_loop_handle is null");
            }
            return self.event_loop_handle.unwrap();
        }
        #[cfg(not(unix))]
        {
            uws::Loop::get()
        }
    }

    pub fn uv_loop(&self) -> &'static Async::Loop {
        if cfg!(debug_assertions) {
            return self.event_loop_handle.expect("libuv event_loop_handle is null");
        }
        self.event_loop_handle.unwrap()
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

    pub fn get_tls_reject_unauthorized(&self) -> bool {
        self.default_tls_reject_unauthorized
            .unwrap_or_else(|| self.transpiler.env.get_tls_reject_unauthorized())
    }

    pub fn on_subprocess_spawn(&mut self, process: &mut bun_spawn::Process) {
        self.auto_killer.on_subprocess_spawn(process);
    }

    pub fn on_subprocess_exit(&mut self, process: &mut bun_spawn::Process) {
        self.auto_killer.on_subprocess_exit(process);
    }

    pub fn get_verbose_fetch(&mut self) -> http::HTTPVerboseLevel {
        if let Some(v) = self.default_verbose_fetch {
            return v;
        }
        if let Some(verbose_fetch) = self.transpiler.env.get(b"BUN_CONFIG_VERBOSE_FETCH") {
            if verbose_fetch == b"true" || verbose_fetch == b"1" {
                self.default_verbose_fetch = Some(http::HTTPVerboseLevel::Headers);
                return http::HTTPVerboseLevel::Headers;
            } else if verbose_fetch == b"curl" {
                self.default_verbose_fetch = Some(http::HTTPVerboseLevel::Curl);
                return http::HTTPVerboseLevel::Curl;
            }
        }
        self.default_verbose_fetch = Some(http::HTTPVerboseLevel::None);
        http::HTTPVerboseLevel::None
    }

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
        unsafe { VMHolder::MAIN_THREAD_VM.map(|p| &mut *p) }
    }

    pub fn mime_type(&mut self, str: &[u8]) -> Option<http::MimeType> {
        self.rare_data().mime_type_from_string(str)
    }

    pub fn on_after_event_loop(&mut self) {
        if let Some(cb) = self.after_event_loop_callback.take() {
            let ctx = self.after_event_loop_callback_ctx.take();
            cb(ctx.unwrap_or(core::ptr::null_mut()));
        }
    }

    pub fn is_event_loop_alive_excluding_immediates(&self) -> bool {
        // SAFETY: event_loop points at sibling field
        let el = unsafe { &*self.event_loop };
        self.unhandled_error_counter == 0
            && ((self.event_loop_handle.unwrap().is_active() as usize)
                + self.active_tasks
                + el.tasks.count
                + (el.has_pending_refs() as usize)
                > 0)
    }

    pub fn is_event_loop_alive(&self) -> bool {
        // SAFETY: event_loop points at sibling field
        let el = unsafe { &*self.event_loop };
        self.is_event_loop_alive_excluding_immediates()
            || el.immediate_tasks.len() > 0
            || el.next_immediate_tasks.len() > 0
    }

    pub fn wakeup(&mut self) {
        self.event_loop().wakeup();
    }

    #[inline]
    pub fn source_map_handler<'a>(&'a self, printer: &'a mut js_printer::BufferPrinter) -> SourceMapHandlerGetter<'a> {
        SourceMapHandlerGetter { vm: self, printer }
    }

    pub fn on_quiet_unhandled_rejection_handler(this: &mut VirtualMachine, _: &JSGlobalObject, _: JSValue) {
        this.unhandled_error_counter += 1;
    }

    pub fn on_quiet_unhandled_rejection_handler_capture_value(this: &mut VirtualMachine, _: &JSGlobalObject, value: JSValue) {
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

    fn ensure_source_code_printer(&self) {
        if SOURCE_CODE_PRINTER.get().is_none() {
            // PERF(port): heap_breakdown namedAllocator dropped — global mimalloc
            let writer = js_printer::BufferWriter::init();
            let printer = Box::into_raw(Box::new(js_printer::BufferPrinter::init(writer)));
            // SAFETY: just allocated
            unsafe { (*printer).ctx.append_null_byte = false };
            SOURCE_CODE_PRINTER.set(Some(printer));
        }
    }

    pub fn load_extra_env_and_source_code_printer(&mut self) {
        let map = &mut self.transpiler.env.map;

        self.ensure_source_code_printer();

        if map.get(b"BUN_SHOW_BUN_STACKFRAMES").is_some() {
            self.hide_bun_stackframes = false;
        }

        if bun_core::feature_flag::BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER.get() {
            self.transpiler_store.enabled = false;
        }

        if let Some(kv) = map.map.fetch_swap_remove(b"NODE_CHANNEL_FD") {
            let fd_s = kv.value.value;
            let mode = if let Some(mode_kv) = map.map.fetch_swap_remove(b"NODE_CHANNEL_SERIALIZATION_MODE") {
                IPC::Mode::from_string(&mode_kv.value.value).unwrap_or(IPC::Mode::Json)
            } else {
                IPC::Mode::Json
            };

            bun_output::scoped_log!(IPC, "IPC environment variables: NODE_CHANNEL_FD={}, NODE_CHANNEL_SERIALIZATION_MODE={}",
                bstr::BStr::new(&fd_s), <&'static str>::from(mode));
            // TODO(port): parse u31 — Rust has no u31; use u32 and validate <= i32::MAX.
            // TODO(port): byte-level int parse — env vars are bytes, not str (PORTING.md §Strings).
            match bun_str::strings::parse_int::<u32>(&fd_s) {
                Some(fd) if fd <= i32::MAX as u32 => {
                    self.init_ipc_instance(bun_sys::Fd::from_uv(i32::try_from(fd).unwrap()), mode);
                }
                _ => {
                    Output::warn(format_args!("Failed to parse IPC channel number '{}'", bstr::BStr::new(&fd_s)));
                }
            }
        }

        // Node.js checks if this are set to "1" and no other value
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
                // SAFETY: mutable static only written once during init on the JS thread
                unsafe { has_bun_garbage_collector_flag_enabled = true };
            } else if gc_level == b"2" {
                self.aggressive_garbage_collection = GCLevel::Aggressive;
                // SAFETY: mutable static only written once during init on the JS thread
                unsafe { has_bun_garbage_collector_flag_enabled = true };
            }

            if let Some(value) = map.get(b"BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT") {
                // TODO(port): byte-level int parse — env vars are bytes, not str.
                match bun_str::strings::parse_int::<usize>(value) {
                    // SAFETY: mutable statics only touched on the main JS thread during init
                    Some(limit) => unsafe {
                        SYNTHETIC_ALLOCATION_LIMIT = limit;
                        STRING_ALLOCATION_LIMIT = limit;
                    },
                    None => {
                        Output::panic(format_args!("BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT must be a positive integer"));
                    }
                }
            }
        }
    }

    pub fn unhandled_rejection(&mut self, global_object: &JSGlobalObject, reason: JSValue, promise: JSValue) {
        if self.is_shutting_down() {
            Output::debug_warn(format_args!("unhandledRejection during shutdown."));
            return;
        }

        // SAFETY: extern static read; written once at startup, single-threaded thereafter
        if unsafe { isBunTest } {
            self.unhandled_error_counter += 1;
            (self.on_unhandled_rejection)(self, global_object, reason);
            return;
        }

        let global = global_object as *const _ as *mut JSGlobalObject;
        match self.unhandled_rejections_mode() {
            api::UnhandledRejections::Bun => {
                // SAFETY: extern "C" FFI; global/reason/promise live on stack (GC scan)
                if unsafe { Bun__handleUnhandledRejection(global, reason, promise) } > 0 {
                    return;
                }
                // continue to default handler
            }
            api::UnhandledRejections::None => {
                let _drain = scopeguard::guard((), |_| {
                    let _ = self.event_loop().drain_microtasks();
                });
                // SAFETY: extern "C" FFI; global/reason/promise live on stack (GC scan)
                if unsafe { Bun__handleUnhandledRejection(global, reason, promise) } > 0 {
                    return;
                }
                return; // ignore the unhandled rejection
            }
            api::UnhandledRejections::Warn => {
                let _drain = scopeguard::guard((), |_| {
                    let _ = self.event_loop().drain_microtasks();
                });
                // SAFETY: extern "C" FFI; global/reason/promise live on stack (GC scan)
                let _ = unsafe { Bun__handleUnhandledRejection(global, reason, promise) };
                // SAFETY: extern "C" FFI; args validated above
                if let Err(err) = jsc::from_js_host_call_generic(global_object, || unsafe {
                    Bun__promises__emitUnhandledRejectionWarning(global, reason, promise)
                }) {
                    let _ = global_object.report_uncaught_exception(
                        global_object.take_exception(err).as_exception(global_object.vm()).unwrap(),
                    );
                }
                return;
            }
            api::UnhandledRejections::WarnWithErrorCode => {
                let _drain = scopeguard::guard((), |_| {
                    let _ = self.event_loop().drain_microtasks();
                });
                // SAFETY: extern "C" FFI; global/reason/promise live on stack (GC scan)
                if unsafe { Bun__handleUnhandledRejection(global, reason, promise) } > 0 {
                    return;
                }
                // SAFETY: extern "C" FFI; args live on stack (GC scan)
                if let Err(err) = jsc::from_js_host_call_generic(global_object, || unsafe {
                    Bun__promises__emitUnhandledRejectionWarning(global, reason, promise)
                }) {
                    let _ = global_object.report_uncaught_exception(
                        global_object.take_exception(err).as_exception(global_object.vm()).unwrap(),
                    );
                }
                self.exit_handler.exit_code = 1;
                return;
            }
            api::UnhandledRejections::Strict => {
                let _drain = scopeguard::guard((), |_| {
                    let _ = self.event_loop().drain_microtasks();
                });
                let wrapped_reason = wrap_unhandled_rejection_error_for_uncaught_exception(global_object, reason);
                let _ = self.uncaught_exception(global_object, wrapped_reason, true);
                // SAFETY: extern "C" FFI; global/reason/promise live on stack (GC scan)
                if unsafe { Bun__handleUnhandledRejection(global, reason, promise) } > 0 {
                    return;
                }
                // SAFETY: extern "C" FFI; args live on stack (GC scan)
                if let Err(err) = jsc::from_js_host_call_generic(global_object, || unsafe {
                    Bun__promises__emitUnhandledRejectionWarning(global, reason, promise)
                }) {
                    let _ = global_object.report_uncaught_exception(
                        global_object.take_exception(err).as_exception(global_object.vm()).unwrap(),
                    );
                }
                return;
            }
            api::UnhandledRejections::Throw => {
                // SAFETY: extern "C" FFI; global/reason/promise live on stack (GC scan)
                if unsafe { Bun__handleUnhandledRejection(global, reason, promise) } > 0 {
                    let _ = self.event_loop().drain_microtasks();
                    return;
                }
                let wrapped_reason = wrap_unhandled_rejection_error_for_uncaught_exception(global_object, reason);
                if self.uncaught_exception(global_object, wrapped_reason, true) {
                    let _ = self.event_loop().drain_microtasks();
                    return;
                }
                // continue to default handler
                if self.event_loop().drain_microtasks().is_err() {
                    return;
                }
            }
        }
        self.unhandled_error_counter += 1;
        (self.on_unhandled_rejection)(self, global_object, reason);
    }

    pub fn handled_promise(&self, global_object: &JSGlobalObject, promise: JSValue) -> bool {
        if self.is_shutting_down() {
            return true;
        }
        // SAFETY: extern "C" FFI; const→mut cast required by C ABI, callee does not mutate
        unsafe { Bun__emitHandledPromiseEvent(global_object as *const _ as *mut _, promise) }
    }

    pub fn uncaught_exception(&mut self, global_object: &JSGlobalObject, err: JSValue, is_rejection: bool) -> bool {
        if self.is_shutting_down() {
            return true;
        }

        // SAFETY: extern static read; written once at startup, single-threaded thereafter
        if unsafe { isBunTest } {
            self.unhandled_error_counter += 1;
            (self.on_unhandled_rejection)(self, global_object, err);
            return true;
        }

        if self.is_handling_uncaught_exception {
            self.run_error_handler(err, None);
            Node::process::exit(global_object, 7);
            unreachable!("Uncaught exception while handling uncaught exception");
        }
        if self.exit_on_uncaught_exception {
            self.run_error_handler(err, None);
            Node::process::exit(global_object, 1);
            unreachable!("made it past Bun__Process__exit");
        }
        self.is_handling_uncaught_exception = true;
        let _restore = scopeguard::guard((), |_| {
            // PORT NOTE: reshaped for borrowck — restore via raw self ptr below
        });
        // SAFETY: extern "C" FFI; global_object/err live on stack (GC scan)
        let handled = unsafe {
            Bun__handleUncaughtException(
                global_object as *const _ as *mut _,
                err.to_error().unwrap_or(err),
                if is_rejection { 1 } else { 0 },
            )
        } > 0;
        self.is_handling_uncaught_exception = false;
        if !handled {
            // TODO maybe we want a separate code path for uncaught exceptions
            self.unhandled_error_counter += 1;
            self.exit_handler.exit_code = 1;
            (self.on_unhandled_rejection)(self, global_object, err);
        }
        handled
    }

    pub fn report_exception_in_hot_reloaded_module_if_needed(&mut self) {
        let _add_main = scopeguard::guard(self as *mut Self, |s| {
            // SAFETY: self outlives this scope
            unsafe { (*s).add_main_to_watcher_if_needed() };
        });
        let Some(promise) = self.pending_internal_promise else { return };
        // SAFETY: GC-heap promise kept alive by protect/module loader
        let promise = unsafe { &mut *promise };

        match promise.status() {
            jsc::PromiseStatus::Pending => return,
            jsc::PromiseStatus::Rejected => {
                if self.pending_internal_promise_reported_at != self.hot_reload_counter {
                    self.pending_internal_promise_reported_at = self.hot_reload_counter;
                    // SAFETY: self.global valid for VM lifetime
                    let global = unsafe { &*self.global };
                    self.unhandled_rejection(global, promise.result(global.vm()), promise.to_js());
                    promise.set_handled();
                }
            }
            jsc::PromiseStatus::Fulfilled => {}
        }

        if self.hot_reload_deferred {
            self.reload(None);
        }
    }

    pub fn add_main_to_watcher_if_needed(&mut self) {
        if self.is_watcher_enabled() {
            let main = self.main;
            if main.is_empty() {
                return;
            }
            let _ = self.bun_watcher.add_file_by_path_slow(
                main,
                self.transpiler.options.loader(path::extension(main)),
            );
        }
    }

    pub fn default_on_unhandled_rejection(this: &mut VirtualMachine, _: &JSGlobalObject, value: JSValue) {
        // PORT NOTE: reshaped for borrowck — clone the optional ptr before mutable borrow
        // SAFETY: BORROW_PARAM ptr set by caller, outlives this call (TODO(port): lifetime)
        let list = this.on_unhandled_rejection_exception_list.map(|p| unsafe { &mut *p.as_ptr() });
        this.run_error_handler(value, list);
    }

    #[inline]
    pub fn package_manager(&mut self) -> &mut PackageManager {
        self.transpiler.get_package_manager()
    }

    #[cold]
    pub fn garbage_collect(&self, sync: bool) -> usize {
        Global::mimalloc_cleanup(false);
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

    pub fn reload(&mut self, _: Option<&mut HotReloader::Task>) {
        // The C++ module loader is async: reloadEntryPoint() returns while the
        // fetch/link/evaluate chain is still draining via microtasks. Kicking
        // off another clearAll() before that chain settles lets the two loads
        // race through one registry. Defer instead.
        if let Some(p) = self.pending_internal_promise {
            // SAFETY: GC heap, alive via module loader
            match unsafe { (*p).status() } {
                jsc::PromiseStatus::Pending => {
                    self.hot_reload_deferred = true;
                    return;
                }
                jsc::PromiseStatus::Rejected => {
                    if self.pending_internal_promise_reported_at != self.hot_reload_counter {
                        self.hot_reload_deferred = true;
                        return;
                    }
                }
                jsc::PromiseStatus::Fulfilled => {}
            }
        }
        self.hot_reload_deferred = false;

        Output::debug(format_args!("Reloading..."));
        let should_clear_terminal = !self.transpiler.env.has_set_no_clear_terminal_on_reload(!Output::enable_ansi_colors_stdout());
        if self.hot_reload == bun_cli::Command::HotReload::Watch {
            Output::flush();
            bun_core::reload_process(should_clear_terminal, false);
        }

        if should_clear_terminal {
            Output::flush();
            Output::disable_buffering();
            Output::reset_terminal_all();
            Output::enable_buffering();
        }

        bun_runtime::api::cron::CronJob::clear_all_for_vm(self, bun_runtime::api::cron::ClearReason::Reload);
        // SAFETY: global is valid
        unsafe { (*self.global).reload() }.expect("Failed to reload");
        self.hot_reload_counter += 1;
        if self.pending_internal_promise_is_protected {
            if let Some(p) = self.pending_internal_promise {
                JSValue::from_cell(p).unprotect();
            }
            self.pending_internal_promise_is_protected = false;
        }
        // reloadEntryPoint() stores into pending_internal_promise on every return path.
        let _ = self.reload_entry_point(self.main).expect("Failed to reload");
    }

    #[inline]
    pub fn node_fs(&mut self) -> &mut Node::fs::NodeFS {
        if self.node_fs.is_none() {
            let vm_ptr = if self.standalone_module_graph.is_some() { self as *mut Self } else { core::ptr::null_mut() };
            self.node_fs = Some(Box::new(Node::fs::NodeFS {
                // only used when standalone module graph is enabled
                vm: vm_ptr,
                ..Default::default()
            }));
        }
        self.node_fs.as_mut().unwrap()
    }

    #[inline]
    pub fn rare_data(&mut self) -> &mut RareData {
        if self.rare_data.is_none() {
            let rd = Box::new(RareData::default());
            // RareData embeds the per-VM `us_socket_group_t` heads as value fields.
            // Registering the allocation as a root region lets LSAN trace
            // `RareData → group.head_sockets → us_socket_t`.
            bun_asan::register_root_region(&*rd as *const RareData as *const c_void, core::mem::size_of::<RareData>());
            self.rare_data = Some(rd);
        }
        self.rare_data.as_mut().unwrap()
    }

    #[inline]
    pub fn event_loop(&self) -> &mut EventLoop {
        // SAFETY: event_loop is a self-pointer to regular_event_loop or macro_event_loop
        unsafe { &mut *self.event_loop }
    }

    pub fn prepare_loop(&mut self) {}

    pub fn enter_uws_loop(&mut self) {
        let loop_ = self.event_loop_handle.unwrap();
        loop_.run();
    }

    pub fn on_before_exit(&mut self) {
        self.exit_handler.dispatch_on_before_exit();
        let mut dispatch = false;
        loop {
            while self.is_event_loop_alive() {
                self.tick();
                self.event_loop().auto_tick_active();
                dispatch = true;
            }

            if dispatch {
                self.exit_handler.dispatch_on_before_exit();
                dispatch = false;

                if self.is_event_loop_alive() {
                    continue;
                }
            }

            break;
        }
    }

    #[unsafe(no_mangle)]
    #[export_name = "Bun__VM__scriptExecutionStatus"]
    pub extern "C" fn script_execution_status(this: &VirtualMachine) -> ScriptExecutionStatus {
        if this.is_shutting_down {
            return ScriptExecutionStatus::Stopped;
        }
        if let Some(worker) = this.worker {
            // SAFETY: worker outlives the VM (BACKREF)
            if unsafe { (*worker).has_requested_terminate() } {
                return ScriptExecutionStatus::Stopped;
            }
        }
        ScriptExecutionStatus::Running
    }

    #[unsafe(no_mangle)]
    #[export_name = "Bun__VM__specifierIsEvalEntryPoint"]
    pub extern "C" fn specifier_is_eval_entry_point(this: &VirtualMachine, specifier: JSValue) -> bool {
        if let Some(eval_source) = &this.module_loader.eval_source {
            // SAFETY: global is valid
            let global = unsafe { &*this.global };
            let specifier_str = specifier.to_bun_string(global).expect("unexpected exception");
            let result = specifier_str.eql_utf8(eval_source.path.text);
            specifier_str.deref();
            return result;
        }
        false
    }

    #[unsafe(no_mangle)]
    #[export_name = "Bun__VM__setEntryPointEvalResultESM"]
    pub extern "C" fn set_entry_point_eval_result_esm(this: &mut VirtualMachine, result: JSValue) {
        // allow esm evaluate to set value multiple times
        if !this.entry_point_result.cjs_set_value {
            // SAFETY: this.global valid for VM lifetime
            this.entry_point_result.value.set(unsafe { &*this.global }, result);
        }
    }

    #[unsafe(no_mangle)]
    #[export_name = "Bun__VM__setEntryPointEvalResultCJS"]
    pub extern "C" fn set_entry_point_eval_result_cjs(this: &mut VirtualMachine, value: JSValue) {
        if !this.entry_point_result.value.has() {
            // SAFETY: this.global valid for VM lifetime
            this.entry_point_result.value.set(unsafe { &*this.global }, value);
            this.entry_point_result.cjs_set_value = true;
        }
    }

    pub fn on_exit(&mut self) {
        // Write CPU profile if profiling was enabled - do this FIRST before any shutdown begins
        if let Some(config) = self.cpu_profiler_config.take() {
            if let Err(err) = CPUProfiler::stop_and_write_profile(self.jsc_vm, config) {
                Output::err(err, format_args!("Failed to write CPU profile"));
            }
        }

        // Write heap profile if profiling was enabled
        if let Some(config) = self.heap_profiler_config.take() {
            if let Err(err) = HeapProfiler::generate_and_write_profile(self.jsc_vm, config) {
                Output::err(err, format_args!("Failed to write heap profile"));
            }
        }

        self.exit_handler.dispatch_on_exit();
        self.is_shutting_down = true;

        let Some(rare_data) = self.rare_data.as_mut() else { return };
        // Make sure we run new cleanup hooks introduced by running cleanup hooks
        while !rare_data.cleanup_hooks.is_empty() {
            let hooks = core::mem::take(&mut rare_data.cleanup_hooks);
            for hook in &hooks {
                hook.execute();
            }
        }
        rare_data.cleanup_hooks = Vec::new();
    }

    pub fn global_exit(&mut self) -> ! {
        debug_assert!(self.is_shutting_down());
        // FIXME: we should be doing this, but we're not
        // self.event_loop().tick();

        if self.should_destruct_main_thread_on_exit() {
            if let Some(t) = self.event_loop().forever_timer.take() {
                t.deinit(true);
            }
            // Detached worker threads may still be in startVM()/spin() using the
            // process-global resolver BSSMap singletons.
            webcore::WebWorker::terminate_all_and_wait(10_000);
            if let Some(rare) = self.rare_data.as_mut() {
                rare.close_all_socket_groups(self);
            }
            // SAFETY: extern "C" FFI; self.global valid until this teardown call
            unsafe { Zig__GlobalObject__destructOnExit(self.global) };
            // lastChanceToFinalize() above runs Listener/Server finalize → their
            // own embedded group.closeAll() → sockets land in loop.closed_head.
            uws::Loop::get().drain_closed_sockets();
            self.transpiler.deinit();
            self.gc_controller.deinit();
            // TODO(port): VirtualMachine has no Drop yet (self-referential layout); explicit teardown
            self.destroy();
        }
        Global::exit(self.exit_handler.exit_code);
    }

    pub fn next_async_task_id(&mut self) -> u64 {
        let Some(debugger) = &mut self.debugger else { return 0 };
        debugger.next_debugger_id = debugger.next_debugger_id.wrapping_add(1);
        debugger.next_debugger_id
    }

    pub fn hot_map(&mut self) -> Option<&mut RareData::HotMap> {
        if self.hot_reload != bun_cli::Command::HotReload::Hot {
            return None;
        }
        Some(self.rare_data().hot_map())
    }

    #[inline]
    pub fn enqueue_task(&mut self, task: Task) {
        self.event_loop().enqueue_task(task);
    }

    #[inline]
    pub fn enqueue_immediate_task(&mut self, task: *mut Timer::ImmediateObject) {
        self.event_loop().enqueue_immediate_task(task);
    }

    #[inline]
    pub fn enqueue_task_concurrent(&mut self, task: *mut ConcurrentTask) {
        self.event_loop().enqueue_task_concurrent(task);
    }

    pub fn tick(&mut self) {
        self.event_loop().tick();
    }

    pub fn wait_for(&mut self, cond: &mut bool) {
        while !*cond {
            self.event_loop().tick();
            if !*cond {
                self.event_loop().auto_tick();
            }
        }
    }

    pub fn wait_for_promise(&mut self, promise: AnyPromise) {
        self.event_loop().wait_for_promise(promise);
    }

    pub fn wait_for_tasks(&mut self) {
        while self.is_event_loop_alive() {
            self.event_loop().tick();
            if self.is_event_loop_alive() {
                self.event_loop().auto_tick();
            }
        }
    }

    pub fn enable_macro_mode(&mut self) {
        jsc::mark_binding!();

        if !self.has_enabled_macro_mode {
            self.has_enabled_macro_mode = true;
            self.macro_event_loop.tasks = EventLoop::Queue::init();
            self.macro_event_loop.tasks.reserve(16);
            self.macro_event_loop.global = self.global;
            self.macro_event_loop.virtual_machine = self;
            self.macro_event_loop.concurrent_tasks = Default::default();
            self.ensure_source_code_printer();
        }

        self.transpiler.options.target = options::Target::BunMacro;
        self.transpiler.resolver.caches.fs.use_alternate_source_cache = true;
        self.macro_mode = true;
        self.event_loop = &mut self.macro_event_loop;
        bun_analytics::Features::macros_inc(1);
        self.transpiler_store.enabled = false;
    }

    pub fn disable_macro_mode(&mut self) {
        self.transpiler.options.target = options::Target::Bun;
        self.transpiler.resolver.caches.fs.use_alternate_source_cache = false;
        self.macro_mode = false;
        self.event_loop = &mut self.regular_event_loop;
        self.transpiler_store.enabled = true;
    }

    pub fn is_watcher_enabled(&self) -> bool {
        !matches!(self.bun_watcher, ImportWatcher::None)
    }

    #[inline]
    pub fn is_loaded() -> bool {
        VMHolder::VM.get().is_some()
    }

    pub fn init_with_module_graph(opts: Options) -> Result<*mut VirtualMachine, bun_core::Error> {
        jsc::mark_binding!();
        // TODO(port): this fn does in-place init of a heap allocation with many
        // self-referential pointers (event_loop = &regular_event_loop, etc.).
        // The straightforward Rust shape is Box::new + raw-ptr fixups; Phase B
        // should evaluate Pin<Box<Self>>.
        // TODO(port): in-place init — heap slot for self-referential ptrs; Phase B: Pin<Box<Self>>.
        let vm_box: *mut VirtualMachine =
            Box::into_raw(Box::new(core::mem::MaybeUninit::<VirtualMachine>::uninit())).cast();
        VMHolder::VM.set(Some(vm_box));
        let console = Box::new(ConsoleObject::new(Output::raw_error_writer(), Output::raw_writer()));
        let log = opts.log.expect("log required") as *mut logger::Log;
        let transpiler = Transpiler::init(log, opts.args, None)?;

        // TODO(port): direct struct-literal init replaced with field assigns;
        // Zig used `vm.* = VirtualMachine{...}` which we cannot replicate without
        // a full Default impl.
        // SAFETY: writing into uninit heap slot; ptr::write does not drop the prior (uninit) value
        unsafe { core::ptr::write(vm_box, VirtualMachine {
            global: core::ptr::null_mut(),
            transpiler_store: RuntimeTranspilerStore::init(),
            has_loaded_constructors: false,
            entry_point: ServerEntryPoint::default(),
            transpiler,
            console,
            log: NonNull::new(log),
            timer: Timer::All::init(),
            origin: Default::default(), // set below from transpiler.options.origin
            saved_source_map_table: SavedSourceMap::HashTable::init(),
            source_mappings: SavedSourceMap::default(),
            macros: MacroMap::init(),
            macro_entry_points: ArrayHashMap::init(),
            origin_timer: std::time::Instant::now(), // TODO(port): std.time.Timer.start() catch panic
            origin_timestamp: get_origin_timestamp(),
            ref_strings: RefString::Map::init(),
            ref_strings_mutex: bun_threading::Mutex::new(),
            standalone_module_graph: opts.graph.map(|g| NonNull::from(g)),
            #[cfg(debug_assertions)]
            debug_thread_id: std::thread::current().id(),
            #[cfg(not(debug_assertions))]
            debug_thread_id: (),
            initial_script_execution_context_identifier: if opts.is_main_thread { 1 } else { i32::MAX },
            // ... defaults
            ..VirtualMachine::field_defaults() // TODO(port): need explicit field_defaults() helper
        }) };
        // SAFETY: vm_box fully initialized by ptr::write above
        let vm = unsafe { &mut *vm_box };
        vm.origin = vm.transpiler.options.origin.clone();
        vm.source_mappings.init(&mut vm.saved_source_map_table);
        vm.regular_event_loop.tasks = EventLoop::Queue::init();
        vm.regular_event_loop.virtual_machine = vm;
        vm.regular_event_loop.tasks.reserve(64);
        vm.regular_event_loop.concurrent_tasks = Default::default();
        vm.event_loop = &mut vm.regular_event_loop;

        vm.transpiler.macro_context = None;
        vm.transpiler.resolver.store_fd = false;
        vm.transpiler.resolver.prefer_module_field = false;

        vm.transpiler.resolver.on_wake_package_manager = Resolver::OnWakePackageManager {
            context: &mut vm.modules as *mut _ as *mut c_void,
            handler: ModuleLoader::AsyncModule::Queue::on_wake_handler,
            on_dependency_error: ModuleLoader::AsyncModule::Queue::on_dependency_error,
        };

        // Emitting "@__PURE__" comments at runtime is a waste of memory and time.
        vm.transpiler.options.emit_dce_annotations = false;

        vm.transpiler.resolver.standalone_module_graph = opts.graph.map(|g| g as *const _);

        // Avoid reading from tsconfig.json & package.json when we're in standalone mode
        vm.transpiler.configure_linker_with_auto_jsx(false);

        vm.transpiler.macro_context = Some(js_ast::Macro::MacroContext::init(&mut vm.transpiler));
        if opts.is_main_thread {
            // SAFETY: mutable static only touched on the main JS thread
            unsafe { VMHolder::MAIN_THREAD_VM = Some(vm) };
            vm.is_main_thread = true;
        }
        // SAFETY: mutable static only written once during init
        unsafe { IS_SMOL_MODE = opts.smol };
        vm.global = JSGlobalObject::create(
            vm,
            &*vm.console,
            vm.initial_script_execution_context_identifier,
            false,
            false,
            None,
        );
        vm.regular_event_loop.global = vm.global;
        // SAFETY: vm.global just assigned by JSGlobalObject::create above
        vm.jsc_vm = unsafe { (*vm.global).vm() };
        uws::Loop::get().internal_loop_data.jsc_vm = vm.jsc_vm;
        bun_core::ParentDeathWatchdog::install_on_event_loop(jsc::EventLoopHandle::init(vm));

        vm.configure_debugger(opts.debugger);
        vm.body_value_hive_allocator = Body::Value::HiveAllocator::init();

        Ok(vm)
    }

    pub fn init(opts: Options) -> Result<*mut VirtualMachine, bun_core::Error> {
        // TODO(port): near-identical to init_with_module_graph; see Zig source
        // lines 1226-1325. Differences: log fallback creation, store_fd from
        // opts, configureLinker(), preserve_symlinks, smol/dns_result_order,
        // ParentDeathWatchdog only if main_thread. Phase B: factor common path.
        jsc::mark_binding!();
        let log: *mut logger::Log = match opts.log {
            Some(l) => l,
            None => Box::into_raw(Box::new(logger::Log::init())),
        };

        // TODO(port): in-place init — heap slot for self-referential ptrs; Phase B: Pin<Box<Self>>.
        let vm_box: *mut VirtualMachine =
            Box::into_raw(Box::new(core::mem::MaybeUninit::<VirtualMachine>::uninit())).cast();
        VMHolder::VM.set(Some(vm_box));
        let console = Box::new(ConsoleObject::new(Output::raw_error_writer(), Output::raw_writer()));
        let transpiler = Transpiler::init(
            log,
            Config::configure_transform_options_for_bun_vm(opts.args)?,
            opts.env_loader,
        )?;
        if opts.is_main_thread {
            // SAFETY: mutable static only touched on the main JS thread
            unsafe { VMHolder::MAIN_THREAD_VM = Some(vm_box) };
        }
        // TODO(port): full struct-literal init mirroring lines 1250-1274
        // SAFETY: writing into uninit heap slot; ptr::write does not drop the prior (uninit) value
        unsafe { core::ptr::write(vm_box, VirtualMachine {
            global: core::ptr::null_mut(),
            transpiler_store: RuntimeTranspilerStore::init(),
            has_loaded_constructors: false,
            entry_point: ServerEntryPoint::default(),
            transpiler,
            console,
            log: NonNull::new(log),
            timer: Timer::All::init(),
            origin: Default::default(), // set below
            saved_source_map_table: SavedSourceMap::HashTable::init(),
            source_mappings: SavedSourceMap::default(),
            macros: MacroMap::init(),
            macro_entry_points: ArrayHashMap::init(),
            origin_timer: std::time::Instant::now(),
            origin_timestamp: get_origin_timestamp(),
            ref_strings: RefString::Map::init(),
            ref_strings_mutex: bun_threading::Mutex::new(),
            #[cfg(debug_assertions)]
            debug_thread_id: std::thread::current().id(),
            #[cfg(not(debug_assertions))]
            debug_thread_id: (),
            initial_script_execution_context_identifier: if opts.is_main_thread { 1 } else { i32::MAX },
            ..VirtualMachine::field_defaults()
        }) };
        // SAFETY: vm_box fully initialized by ptr::write above
        let vm = unsafe { &mut *vm_box };
        vm.origin = vm.transpiler.options.origin.clone();
        vm.source_mappings.init(&mut vm.saved_source_map_table);
        vm.regular_event_loop.tasks = EventLoop::Queue::init();
        vm.regular_event_loop.virtual_machine = vm;
        vm.regular_event_loop.tasks.reserve(64);
        vm.regular_event_loop.concurrent_tasks = Default::default();
        vm.event_loop = &mut vm.regular_event_loop;

        vm.transpiler.options.emit_dce_annotations = false;
        vm.transpiler.macro_context = None;
        vm.transpiler.resolver.store_fd = opts.store_fd;
        vm.transpiler.resolver.prefer_module_field = false;
        vm.transpiler.resolver.opts.preserve_symlinks = opts.args.preserve_symlinks.unwrap_or(false);

        vm.transpiler.resolver.on_wake_package_manager = Resolver::OnWakePackageManager {
            context: &mut vm.modules as *mut _ as *mut c_void,
            handler: ModuleLoader::AsyncModule::Queue::on_wake_handler,
            on_dependency_error: ModuleLoader::AsyncModule::Queue::on_dependency_error,
        };

        vm.transpiler.configure_linker();
        vm.transpiler.macro_context = Some(js_ast::Macro::MacroContext::init(&mut vm.transpiler));

        vm.global = JSGlobalObject::create(
            vm,
            &*vm.console,
            vm.initial_script_execution_context_identifier,
            opts.smol,
            opts.eval,
            None,
        );
        vm.regular_event_loop.global = vm.global;
        // SAFETY: vm.global just assigned by JSGlobalObject::create above
        vm.jsc_vm = unsafe { (*vm.global).vm() };
        uws::Loop::get().internal_loop_data.jsc_vm = vm.jsc_vm;
        vm.smol = opts.smol;
        vm.dns_result_order = opts.dns_result_order;
        if opts.is_main_thread {
            bun_core::ParentDeathWatchdog::install_on_event_loop(jsc::EventLoopHandle::init(vm));
        }

        if opts.smol {
            // SAFETY: mutable static only written once during init
            unsafe { IS_SMOL_MODE = opts.smol };
        }

        vm.configure_debugger(opts.debugger);
        vm.body_value_hive_allocator = Body::Value::HiveAllocator::init();

        Ok(vm)
    }

    #[inline]
    pub fn assert_on_js_thread(&self) {
        #[cfg(debug_assertions)]
        if self.debug_thread_id != std::thread::current().id() {
            panic!("Expected to be on the JS thread.");
        }
    }

    fn configure_debugger(&mut self, cli_flag: bun_cli::Command::Debugger) {
        if env_var::HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET.get().is_some() {
            return;
        }

        let unix = env_var::BUN_INSPECT.get();
        let connect_to = env_var::BUN_INSPECT_CONNECT_TO.get();

        let set_breakpoint_on_first_line = !unix.is_empty() && unix.ends_with(b"?break=1");
        let wait_for_debugger = !unix.is_empty() && unix.ends_with(b"?wait=1");

        let wait_for_connection: Debugger::Wait = if set_breakpoint_on_first_line || wait_for_debugger {
            Debugger::Wait::Forever
        } else {
            Debugger::Wait::Off
        };

        match cli_flag {
            bun_cli::Command::Debugger::Unspecified => {
                if !unix.is_empty() {
                    self.debugger = Some(Debugger {
                        path_or_port: None,
                        from_environment_variable: unix.into(),
                        wait_for_connection,
                        set_breakpoint_on_first_line,
                        ..Default::default()
                    });
                } else if !connect_to.is_empty() {
                    self.debugger = Some(Debugger {
                        path_or_port: None,
                        from_environment_variable: connect_to.into(),
                        wait_for_connection: Debugger::Wait::Off,
                        set_breakpoint_on_first_line: false,
                        mode: Debugger::Mode::Connect,
                        ..Default::default()
                    });
                }
            }
            bun_cli::Command::Debugger::Enable(enable) => {
                self.debugger = Some(Debugger {
                    path_or_port: enable.path_or_port,
                    from_environment_variable: unix.into(),
                    wait_for_connection: if enable.wait_for_connection { Debugger::Wait::Forever } else { wait_for_connection },
                    set_breakpoint_on_first_line: set_breakpoint_on_first_line || enable.set_breakpoint_on_first_line,
                    ..Default::default()
                });
            }
        }

        if self.is_inspector_enabled() {
            // The runtime transpiler cache does not store inline source maps needed
            // by the debugger frontend. Disable it so the printer always runs.
            RuntimeTranspilerCache::set_disabled(true);

            if self.debugger.as_ref().unwrap().mode != Debugger::Mode::Connect {
                self.transpiler.options.minify_identifiers = false;
                self.transpiler.options.minify_syntax = false;
                self.transpiler.options.minify_whitespace = false;
                self.transpiler.options.debugger = true;
            }
        }
    }

    pub fn init_worker(worker: &mut webcore::WebWorker, opts: Options) -> Result<*mut VirtualMachine, bun_core::Error> {
        // TODO(port): mirrors init() with worker-specific differences (lines 1394-1491):
        // - vm.worker = worker, vm.hot_reload = worker.parent.hot_reload
        // - standalone_module_graph from worker.parent
        // - JSGlobalObject.create gets worker.mini, worker.cpp_worker
        // - configureLinker vs configureLinkerWithAutoJSX based on opts.graph
        // - initial_script_execution_context_identifier = worker.execution_context_id
        // Phase B: factor common path with init().
        let _ = (worker, opts);
        todo!("init_worker — see Zig lines 1394-1491")
    }

    pub fn init_bake(opts: Options) -> Result<*mut VirtualMachine, bun_core::Error> {
        // TODO(port): mirrors init() but creates global via BakeCreateProdGlobal
        // and on Windows calls ensureWaker() before creating the global (lines 1495-1582).
        let _ = opts;
        todo!("init_bake — see Zig lines 1495-1582")
    }

    pub fn clear_ref_string(_: *mut c_void, ref_string: &mut RefString) {
        let _ = VirtualMachine::get().ref_strings.remove(&ref_string.hash);
    }

    pub fn ref_counted_resolved_source<const ADD_DOUBLE_REF: bool>(
        &mut self,
        code: &[u8],
        specifier: bun_str::String,
        source_url: &[u8],
        hash_: Option<u32>,
    ) -> ResolvedSource {
        // refCountedString will panic if the code is empty
        if code.is_empty() {
            return ResolvedSource {
                source_code: bun_str::String::init(b""),
                specifier,
                source_url: specifier.create_if_different(source_url),
                allocator: None,
                source_code_needs_deref: false,
                ..Default::default()
            };
        }
        let source = self.ref_counted_string::<{ !ADD_DOUBLE_REF }>(code, hash_);
        if ADD_DOUBLE_REF {
            source.ref_();
            source.ref_();
        }

        ResolvedSource {
            source_code: bun_str::String::init(source.impl_),
            specifier,
            source_url: specifier.create_if_different(source_url),
            allocator: Some(source),
            source_code_needs_deref: false,
            ..Default::default()
        }
    }

    fn ref_counted_string_with_was_new<const DUPE: bool>(
        &mut self,
        new: &mut bool,
        input_: &[u8],
        hash_: Option<u32>,
    ) -> *mut RefString {
        jsc::mark_binding!();
        debug_assert!(!input_.is_empty());
        let hash = hash_.unwrap_or_else(|| RefString::compute_hash(input_));
        self.ref_strings_mutex.lock();
        let _unlock = scopeguard::guard(&mut self.ref_strings_mutex, |m| m.unlock());

        let entry = self.ref_strings.get_or_put(hash);
        if !entry.found_existing {
            let input: Box<[u8]> = if DUPE {
                Box::<[u8]>::from(input_)
            } else {
                // TODO(port): non-dupe path borrows caller's slice; using raw ptr below
                Box::<[u8]>::from(input_) // PERF(port): Zig avoided copy here
            };

            let ref_ = Box::into_raw(Box::new(RefString {
                ptr: input.as_ptr(),
                len: input.len(),
                impl_: bun_str::String::create_external::<RefString>(
                    &input, true, core::ptr::null_mut(), free_ref_string,
                ).value.wtf_string_impl,
                hash,
                ctx: self as *mut Self as *mut c_void,
                on_before_deinit: Some(Self::clear_ref_string),
                ..Default::default()
            }));
            // TODO(port): set ref_ self-ptr inside create_external call above
            core::mem::forget(input);
            *entry.value_ptr = ref_;
        }
        *new = !entry.found_existing;
        *entry.value_ptr
    }

    pub fn ref_counted_string<const DUPE: bool>(&mut self, input_: &[u8], hash_: Option<u32>) -> *mut RefString {
        debug_assert!(!input_.is_empty());
        let mut was_new = false;
        self.ref_counted_string_with_was_new::<DUPE>(&mut was_new, input_, hash_)
    }

    pub fn fetch_without_on_load_plugins<const FLAGS: FetchFlags>(
        jsc_vm: &mut VirtualMachine,
        global_object: &JSGlobalObject,
        _specifier: bun_str::String,
        referrer: bun_str::String,
        log: &mut logger::Log,
    ) -> Result<ResolvedSource, bun_core::Error> {
        debug_assert!(VirtualMachine::is_loaded());

        if let Some(builtin) = ModuleLoader::fetch_builtin_module(jsc_vm, &_specifier)? {
            return Ok(builtin);
        }

        let specifier_clone = _specifier.to_utf8();
        let referrer_clone = referrer.to_utf8();

        let mut virtual_source_to_use: Option<logger::Source> = None;
        let mut blob_to_deinit: Option<webcore::Blob> = None;
        let lr = options::get_loader_and_virtual_source(
            specifier_clone.slice(),
            jsc_vm,
            &mut virtual_source_to_use,
            &mut blob_to_deinit,
            None,
        ).map_err(|_| bun_core::err!("ModuleNotFound"))?;
        let module_type: options::ModuleType = match lr.package_json {
            Some(pkg) => pkg.module_type,
            None => options::ModuleType::Unknown,
        };

        // .print_source, which is used by exceptions avoids duplicating the entire source code
        // but that means we have to be careful of the lifetime of the source code
        // so we only want to reset the arena once its done freeing it.
        // TODO(port): errdefer / defer arena reset based on FLAGS
        let result = ModuleLoader::transpile_source_code(
            jsc_vm,
            lr.specifier,
            referrer_clone.slice(),
            _specifier,
            lr.path,
            lr.loader.unwrap_or(if lr.is_main { options::Loader::Js } else { options::Loader::File }),
            module_type,
            log,
            lr.virtual_source,
            None,
            // SAFETY: ensure_source_code_printer() called before any fetch
            unsafe { &mut *SOURCE_CODE_PRINTER.get().unwrap() },
            global_object,
            FLAGS,
        );

        match result {
            Ok(r) => {
                if FLAGS != FetchFlags::PrintSource {
                    jsc_vm.module_loader.reset_arena(jsc_vm);
                }
                Ok(r)
            }
            Err(e) => {
                jsc_vm.module_loader.reset_arena(jsc_vm);
                Err(e)
            }
        }
    }

    // TODO(port): narrow error set
    pub fn resolve(
        res: &mut ErrorableString,
        global: &JSGlobalObject,
        specifier: bun_str::String,
        source: bun_str::String,
        query_string: Option<&mut bun_str::String>,
        is_esm: bool,
    ) -> JsResult<()> {
        Self::resolve_maybe_needs_trailing_slash::<true>(res, global, specifier, source, query_string, is_esm, false)
    }

    pub fn resolve_maybe_needs_trailing_slash<const IS_A_FILE_PATH: bool>(
        res: &mut ErrorableString,
        global: &JSGlobalObject,
        specifier: bun_str::String,
        source: bun_str::String,
        query_string: Option<&mut bun_str::String>,
        is_esm: bool,
        is_user_require_resolve: bool,
    ) -> JsResult<()> {
        // TODO(port): comptime float→int math in length check
        const MAX_SPEC_LEN: u32 = (MAX_PATH_BYTES as f64 * 1.5) as u32;
        if IS_A_FILE_PATH && specifier.length() > MAX_SPEC_LEN {
            let specifier_utf8 = specifier.to_utf8();
            let source_utf8 = source.to_utf8();
            let printed = bun_runtime::api::ResolveMessage::fmt(
                specifier_utf8.slice(),
                source_utf8.slice(),
                bun_core::err!("NameTooLong"),
                if is_esm { ImportKind::Stmt } else if is_user_require_resolve { ImportKind::RequireResolve } else { ImportKind::Require },
            );
            let msg = logger::Msg {
                data: logger::range_data(None, logger::Range::NONE, printed),
                ..Default::default()
            };
            *res = ErrorableString::err(
                bun_core::err!("NameTooLong"),
                bun_runtime::api::ResolveMessage::create(global, msg, source_utf8.slice())?,
            );
            return Ok(());
        }

        let mut result = ResolveFunctionResult { path: b"", result: None, query_string: b"" };
        let jsc_vm = global.bun_vm();
        let specifier_utf8 = specifier.to_utf8();
        let source_utf8 = source.to_utf8();

        if let Some(plugin_runner) = &jsc_vm.plugin_runner {
            if PluginRunner::could_be_plugin(specifier_utf8.slice()) {
                let namespace = PluginRunner::extract_namespace(specifier_utf8.slice());
                let after_namespace = if namespace.is_empty() {
                    specifier_utf8.slice()
                } else {
                    &specifier_utf8.slice()[namespace.len() + 1..]
                };

                if let Some(resolved_path) = plugin_runner.on_resolve_jsc(
                    bun_str::String::init(namespace),
                    bun_str::String::borrow_utf8(after_namespace),
                    source.clone(),
                    options::Target::Bun,
                )? {
                    *res = resolved_path;
                    return Ok(());
                }
            }
        }

        if let Some(hardcoded) = ModuleLoader::HardcodedModule::Alias::get(specifier_utf8.slice(), options::Target::Bun, Default::default()) {
            *res = ErrorableString::ok(
                if is_user_require_resolve && hardcoded.node_builtin {
                    specifier.dupe_ref()
                } else {
                    bun_str::String::init(hardcoded.path)
                },
            );
            return Ok(());
        }

        let old_log = jsc_vm.log;
        // TODO(port): lifetime — transpiler/linker/pm log fields still raw ptr in their crates
        let old_log_ptr: *mut logger::Log = old_log.map_or(core::ptr::null_mut(), |p| p.as_ptr());
        // the logger can end up being called on another thread, it must not use threadlocal Heap Allocator
        let mut log = logger::Log::init();
        jsc_vm.log = Some(NonNull::from(&mut log));
        jsc_vm.transpiler.resolver.log = &mut log;
        jsc_vm.transpiler.linker.log = &mut log;
        if let Some(pm) = jsc_vm.transpiler.resolver.package_manager.as_mut() {
            pm.log = &mut log;
        }
        let restore = scopeguard::guard(jsc_vm as *mut VirtualMachine, move |vm| {
            // SAFETY: vm outlives this scope
            let vm = unsafe { &mut *vm };
            vm.log = old_log;
            vm.transpiler.linker.log = old_log_ptr;
            vm.transpiler.resolver.log = old_log_ptr;
            if let Some(pm) = vm.transpiler.resolver.package_manager.as_mut() {
                pm.log = old_log_ptr;
            }
        });

        let resolve_result = jsc_vm._resolve::<IS_A_FILE_PATH>(
            &mut result,
            specifier_utf8.slice(),
            normalize_source(source_utf8.slice()),
            is_esm,
        );
        if let Err(err_) = resolve_result {
            let mut err = err_;
            let msg: logger::Msg = 'brk: {
                for m in &log.msgs {
                    if matches!(m.metadata, logger::MsgMetadata::Resolve(_)) {
                        if let logger::MsgMetadata::Resolve(r) = &m.metadata {
                            err = r.err;
                        }
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

                let printed = bun_runtime::api::ResolveMessage::fmt(
                    specifier_utf8.slice(),
                    source_utf8.slice(),
                    err,
                    import_kind,
                )?;
                break 'brk logger::Msg {
                    data: logger::range_data(None, logger::Range::NONE, printed.clone()),
                    metadata: logger::MsgMetadata::Resolve(logger::ResolveMsgMetadata {
                        specifier: logger::BabyString::in_(&printed, specifier_utf8.slice()),
                        import_kind,
                    }),
                    ..Default::default()
                };
            };

            *res = ErrorableString::err(
                err,
                bun_runtime::api::ResolveMessage::create(global, msg, source_utf8.slice())?,
            );
            drop(restore);
            return Ok(());
        }

        if let Some(query) = query_string {
            // `result.query_string` is a slice into `specifier_utf8`, which is freed by
            // its Drop before callers read the out-param. Clone into an owned bun.String.
            *query = if !result.query_string.is_empty() {
                bun_str::String::clone_utf8(result.query_string)
            } else {
                bun_str::String::empty()
            };
        }

        // `result.path` can be a slice into `specifier_utf8`; clone for the same reason.
        *res = ErrorableString::ok(bun_str::String::clone_utf8(result.path));
        drop(restore);
        Ok(())
    }

    fn _resolve<const IS_A_FILE_PATH: bool>(
        &mut self,
        ret: &mut ResolveFunctionResult,
        specifier: &[u8],
        source: &[u8],
        is_esm: bool,
    ) -> Result<(), bun_core::Error> {
        if path::basename(specifier) == bun_js_parser::runtime::Runtime::Imports::ALT_NAME {
            ret.path = bun_js_parser::runtime::Runtime::Imports::NAME;
            return Ok(());
        } else if specifier == MAIN_FILE_NAME && self.entry_point.generated {
            ret.result = None;
            ret.path = MAIN_FILE_NAME;
            return Ok(());
        } else if specifier.starts_with(js_ast::Macro::NAMESPACE_WITH_COLON) {
            ret.result = None;
            // TODO(port): leaked dupe — Zig leaks too
            ret.path = Box::leak(Box::<[u8]>::from(specifier));
            return Ok(());
        } else if specifier.starts_with(node_fallbacks::IMPORT_PATH) {
            ret.result = None;
            ret.path = Box::leak(Box::<[u8]>::from(specifier));
            return Ok(());
        } else if let Some(result) = ModuleLoader::HardcodedModule::Alias::get(specifier, options::Target::Bun, Default::default()) {
            ret.result = None;
            ret.path = result.path;
            return Ok(());
        } else if self.module_loader.eval_source.is_some()
            && (specifier.ends_with(bun_paths::path_literal!("/[eval]"))
                || specifier.ends_with(bun_paths::path_literal!("/[stdin]")))
        {
            ret.result = None;
            ret.path = Box::leak(Box::<[u8]>::from(specifier));
            return Ok(());
        } else if specifier.starts_with(b"blob:") {
            ret.result = None;
            if webcore::ObjectURLRegistry::singleton().has(&specifier[b"blob:".len()..]) {
                ret.path = Box::leak(Box::<[u8]>::from(specifier));
                return Ok(());
            } else {
                return Err(bun_core::err!("ModuleNotFound"));
            }
        }

        let is_special_source = source == MAIN_FILE_NAME || js_ast::Macro::is_macro_path(source);
        let mut query_string: &[u8] = b"";
        let normalized_specifier = normalize_specifier_for_resolution(specifier, &mut query_string);
        let source_to_use: &[u8] = if !is_special_source {
            if IS_A_FILE_PATH {
                Fs::PathName::init(source).dir_with_trailing_slash()
            } else {
                source
            }
        } else {
            self.transpiler.fs.top_level_dir
        };

        let result: Resolver::Result = 'brk: {
            // TODO: We only want to retry on not found only when the directories we searched for were cached.
            // This fixes an issue where new files created in cached directories were not picked up.
            // See https://github.com/oven-sh/bun/issues/3216
            //
            // This cache-bust is disabled when the filesystem is not being used to resolve.
            let mut retry_on_not_found = bun_paths::is_absolute(source_to_use);
            loop {
                match self.transpiler.resolver.resolve_and_auto_install(
                    source_to_use,
                    normalized_specifier,
                    if is_esm { ImportKind::Stmt } else { ImportKind::Require },
                    self.transpiler.resolver.opts.global_cache,
                ) {
                    Resolver::ResolveResult::Success(r) => break 'brk r,
                    Resolver::ResolveResult::Failure(e) => return Err(e),
                    Resolver::ResolveResult::Pending | Resolver::ResolveResult::NotFound => {
                        if !retry_on_not_found {
                            return Err(bun_core::err!("ModuleNotFound"));
                        }
                        retry_on_not_found = false;

                        // TODO(port): bun.ThreadlocalBuffers — using thread_local PathBuffer
                        thread_local! {
                            static SPECIFIER_CACHE_RESOLVER_BUF: core::cell::RefCell<PathBuffer> =
                                const { core::cell::RefCell::new(PathBuffer::ZEROED) };
                        }
                        let buster_name = SPECIFIER_CACHE_RESOLVER_BUF.with_borrow_mut(|buf| -> Result<Box<[u8]>, bun_core::Error> {
                            let name: &[u8] = 'name: {
                                if bun_paths::is_absolute(normalized_specifier) {
                                    if let Some(dir) = bun_paths::dirname(normalized_specifier) {
                                        if dir.len() > buf.len() {
                                            return Err(bun_core::err!("ModuleNotFound"));
                                        }
                                        // Normalized without trailing slash
                                        break 'name strings::normalize_slashes_only(buf.as_mut_slice(), dir, bun_paths::SEP);
                                    }
                                }

                                if source_to_use.len() + normalized_specifier.len() + 4 >= buf.len() {
                                    return Err(bun_core::err!("ModuleNotFound"));
                                }

                                let parts: [&[u8]; 3] = [
                                    source_to_use,
                                    normalized_specifier,
                                    bun_paths::path_literal!(".."),
                                ];

                                break 'name bun_paths::join_abs_string_buf_z(
                                    self.transpiler.fs.top_level_dir,
                                    buf.as_mut_slice(),
                                    &parts,
                                    bun_paths::Platform::Auto,
                                );
                            };
                            // PORT NOTE: reshaped for borrowck — clone out of TLS-borrowed buffer
                            Ok(Box::<[u8]>::from(name))
                        })?;

                        // Only re-query if we previously had something cached.
                        if self.transpiler.resolver.bust_dir_cache(
                            strings::without_trailing_slash_windows_path(&buster_name),
                        ) {
                            continue;
                        }

                        return Err(bun_core::err!("ModuleNotFound"));
                    }
                }
            }
        };

        if !self.macro_mode {
            self.has_any_macro_remappings = self.has_any_macro_remappings || self.transpiler.options.macro_remap.count() > 0;
        }
        ret.result = Some(result);
        // SAFETY: TODO(port): lifetime — query_string slices specifier; caller keeps specifier alive
        ret.query_string = unsafe { core::mem::transmute::<&[u8], &'static [u8]>(query_string) };
        let result_path = ret.result.as_ref().unwrap().path_const().ok_or(bun_core::err!("ModuleNotFound"))?;
        self.resolved_count += 1;

        // SAFETY: TODO(port): lifetime — result_path.text borrows ret.result (stored in same struct)
        ret.path = unsafe { core::mem::transmute::<&[u8], &'static [u8]>(result_path.text) };
        Ok(())
    }

    pub fn drain_microtasks(&mut self) {
        let _ = self.event_loop().drain_microtasks(); // TODO: properly propagate exception upwards
    }

    pub fn process_fetch_log(
        global_this: &JSGlobalObject,
        specifier: bun_str::String,
        referrer: bun_str::String,
        log: &mut logger::Log,
        ret: &mut ErrorableResolvedSource,
        err: bun_core::Error,
    ) {
        match log.msgs.len() {
            0 => {
                let msg: logger::Msg = 'brk: {
                    if err == bun_core::err!("UnexpectedPendingResolution") {
                        let mut s = Vec::new();
                        use std::io::Write;
                        let _ = write!(&mut s, "Unexpected pending import in \"{}\". To automatically install npm packages with Bun, please use an import statement instead of require() or dynamic import().\nThis error can also happen if dependencies import packages which are not referenced anywhere. Worst case, run `bun install` and opt-out of the node_modules folder until we come up with a better way to handle this error.", specifier);
                        break 'brk logger::Msg {
                            data: logger::range_data(None, logger::Range::NONE, s),
                            ..Default::default()
                        };
                    }

                    let mut s = Vec::new();
                    use std::io::Write;
                    let _ = write!(&mut s, "{} while building {}", err.name(), specifier);
                    break 'brk logger::Msg {
                        data: logger::range_data(None, logger::Range::NONE, s),
                        ..Default::default()
                    };
                };
                *ret = ErrorableResolvedSource::err(
                    err,
                    bun_runtime::api::BuildMessage::create(global_this, msg)
                        .unwrap_or_else(|e| global_this.take_exception(e)),
                );
            }
            1 => {
                let msg = log.msgs[0].clone();
                let referrer_utf8 = referrer.to_utf8();
                *ret = ErrorableResolvedSource::err(err, match msg.metadata {
                    logger::MsgMetadata::Build => bun_runtime::api::BuildMessage::create(global_this, msg)
                        .unwrap_or_else(|e| global_this.take_exception(e)),
                    logger::MsgMetadata::Resolve(_) => bun_runtime::api::ResolveMessage::create(
                        global_this, msg, referrer_utf8.slice(),
                    ).unwrap_or_else(|e| global_this.take_exception(e)),
                });
            }
            _ => {
                let mut errors_stack: [JSValue; 256] = [JSValue::ZERO; 256];
                let len = log.msgs.len().min(errors_stack.len());
                let errors = &mut errors_stack[..len];
                let logs = &log.msgs[..len];
                let referrer_utf8 = referrer.to_utf8();

                debug_assert_eq!(logs.len(), errors.len());
                for (msg, current) in logs.iter().zip(errors.iter_mut()) {
                    *current = match msg.metadata {
                        logger::MsgMetadata::Build => bun_runtime::api::BuildMessage::create(global_this, msg.clone())
                            .unwrap_or_else(|e| global_this.take_exception(e)),
                        logger::MsgMetadata::Resolve(_) => bun_runtime::api::ResolveMessage::create(
                            global_this, msg.clone(), referrer_utf8.slice(),
                        ).unwrap_or_else(|e| global_this.take_exception(e)),
                    };
                }

                let mut s = Vec::new();
                {
                    use std::io::Write;
                    let _ = write!(&mut s, "{} errors building \"{}\"", errors.len(), specifier);
                }
                *ret = ErrorableResolvedSource::err(
                    err,
                    global_this.create_aggregate_error(errors, &ZigString::init(&s))
                        .unwrap_or_else(|e| global_this.take_exception(e)),
                );
            }
        }
    }

    // TODO(port): not `impl Drop` because of explicit-call-only semantics & self-referential
    // raw pointers (event_loop → regular_event_loop); called explicitly from
    // globalExit/web_worker. PORTING.md forbids the name `deinit` for the public API.
    pub fn destroy(&mut self) {
        // PORT NOTE: owned-field `.deinit()` calls (auto_killer, source_mappings,
        // rare_data, proxy_env_storage, entry_point) deleted — their Drop impls
        // free them when this allocation is released. Only side effects remain.
        if let Some(print) = SOURCE_CODE_PRINTER.get() {
            // SAFETY: thread-local set by ensure_source_code_printer on this thread
            unsafe {
                (*print).get_mutable_buffer().deinit();
                (*print).ctx.written = &mut [];
            }
        }
        if let Some(rare_data) = self.rare_data.take() {
            bun_runtime::api::cron::CronJob::clear_all_for_vm(self, bun_runtime::api::cron::ClearReason::Teardown);
            // Paired with rareData()'s registerRootRegion.
            bun_asan::unregister_root_region(&*rare_data as *const RareData as *const c_void, core::mem::size_of::<RareData>());
            drop(rare_data);
        }
        self.overridden_main = Strong::empty();
        self.has_terminated = true;
    }

    pub fn print_exception<W: core::fmt::Write, const ALLOW_SIDE_EFFECTS: bool>(
        &mut self,
        exception: &Exception,
        exception_list: Option<&mut ExceptionList>,
        writer: &mut W,
    ) {
        let mut formatter = ConsoleObject::Formatter {
            global_this: self.global,
            quote_strings: false,
            single_line: false,
            stack_check: bun_core::StackCheck::init(),
            ..Default::default()
        };
        if Output::enable_ansi_colors_stderr() {
            self.print_errorlike_object::<W, true, ALLOW_SIDE_EFFECTS>(
                exception.value(), Some(exception), exception_list, &mut formatter, writer,
            );
        } else {
            self.print_errorlike_object::<W, false, ALLOW_SIDE_EFFECTS>(
                exception.value(), Some(exception), exception_list, &mut formatter, writer,
            );
        }
    }

    #[cold]
    #[inline(never)]
    pub fn run_error_handler(&mut self, result: JSValue, exception_list: Option<&mut ExceptionList>) {
        let prev_had_errors = self.had_errors;
        self.had_errors = false;
        // SAFETY: self outlives this scope; raw ptr to dodge borrowck across guard
        let _restore = scopeguard::guard(self as *mut Self, move |s| unsafe { (*s).had_errors = prev_had_errors });

        let mut writer = Output::error_writer_buffered();
        // SAFETY: writer is on stack and outlives the guard
        let _flush = scopeguard::guard(&mut writer as *mut _, |w| unsafe { let _ = (*w).flush(); });

        if let Some(exception) = result.as_exception(self.jsc_vm) {
            self.print_exception::<_, true>(exception, exception_list, &mut writer);
        } else {
            let mut formatter = ConsoleObject::Formatter {
                global_this: self.global,
                quote_strings: false,
                single_line: false,
                stack_check: bun_core::StackCheck::init(),
                error_display_level: ConsoleObject::FormatOptions::ErrorDisplayLevel::Full,
                ..Default::default()
            };
            if Output::enable_ansi_colors_stderr() {
                self.print_errorlike_object::<_, true, true>(result, None, exception_list, &mut formatter, &mut writer);
            } else {
                self.print_errorlike_object::<_, false, true>(result, None, exception_list, &mut formatter, &mut writer);
            }
        }
    }

    pub fn clear_entry_point(&mut self) -> JsResult<()> {
        if self.main.is_empty() {
            return Ok(());
        }
        let mut str = ZigString::init(MAIN_FILE_NAME);
        // SAFETY: global is valid
        unsafe { (*self.global).delete_module_registry_entry(&mut str) }
    }

    fn load_preloads(&mut self) -> Result<Option<*mut JSInternalPromise>, bun_core::Error> {
        self.is_in_preload = true;
        // SAFETY: self outlives this scope; raw ptr to dodge borrowck across guard
        let _restore = scopeguard::guard(self as *mut Self, |s| unsafe { (*s).is_in_preload = false });

        for preload in self.preload.iter() {
            let mut result = match self.transpiler.resolver.resolve_and_auto_install(
                self.transpiler.fs.top_level_dir,
                normalize_source(preload),
                ImportKind::Stmt,
                if self.standalone_module_graph.is_none() {
                    Resolver::GlobalCache::ReadOnly
                } else {
                    Resolver::GlobalCache::Disable
                },
            ) {
                Resolver::ResolveResult::Success(r) => r,
                Resolver::ResolveResult::Failure(e) => {
                    // SAFETY: BORROW_PARAM log ptr valid for VM lifetime (set in init)
                    let _ = unsafe { self.log.unwrap().as_mut() }.add_error_fmt(
                        None, logger::Loc::EMPTY,
                        format_args!("{} resolving preload {}", e.name(), bunfmt::format_json_string_latin1(preload)),
                    );
                    return Err(e);
                }
                Resolver::ResolveResult::Pending | Resolver::ResolveResult::NotFound => {
                    // SAFETY: BORROW_PARAM log ptr valid for VM lifetime (set in init)
                    let _ = unsafe { self.log.unwrap().as_mut() }.add_error_fmt(
                        None, logger::Loc::EMPTY,
                        format_args!("preload not found {}", bunfmt::format_json_string_latin1(preload)),
                    );
                    return Err(bun_core::err!("ModuleNotFound"));
                }
            };
            // SAFETY: self.global valid for VM lifetime
            let global = unsafe { &*self.global };
            let promise = JSModuleLoader::import(global, &bun_str::String::from_bytes(result.path().unwrap().text))?;

            self.pending_internal_promise = Some(promise);
            JSValue::from_cell(promise).protect();
            let _unprotect = scopeguard::guard((), |_| JSValue::from_cell(promise).unprotect());

            // pending_internal_promise can change if hot module reloading is enabled
            if self.is_watcher_enabled() {
                self.event_loop().perform_gc();
                // SAFETY: pending_internal_promise just assigned & .protect()ed above; GC-rooted
                if unsafe { (*self.pending_internal_promise.unwrap()).status() } == jsc::PromiseStatus::Pending {
                    // SAFETY: same — promise rooted while loop runs
                    while unsafe { (*self.pending_internal_promise.unwrap()).status() } == jsc::PromiseStatus::Pending {
                        self.event_loop().tick();
                        // SAFETY: same — promise rooted while loop runs
                        if unsafe { (*self.pending_internal_promise.unwrap()).status() } == jsc::PromiseStatus::Pending {
                            self.event_loop().auto_tick();
                        }
                    }
                }
            } else {
                self.event_loop().perform_gc();
                self.wait_for_promise(AnyPromise::Internal(promise));
            }

            // SAFETY: promise rooted by .protect() guard above
            if unsafe { (*promise).status() } == jsc::PromiseStatus::Rejected {
                return Ok(Some(promise));
            }
        }

        // Under --isolate each test file gets a fresh global, so preloads must
        // re-execute for every file. Otherwise, only load preloads once.
        if !self.test_isolation_enabled {
            self.preload.clear();
        }

        Ok(None)
    }

    pub fn ensure_debugger(&mut self, block_until_connected: bool) -> Result<(), bun_core::Error> {
        if self.debugger.is_some() {
            // SAFETY: self.global valid for VM lifetime
            Debugger::create(self, unsafe { &*self.global })?;
            if block_until_connected {
                Debugger::wait_for_debugger_if_necessary(self);
            }
        }
        Ok(())
    }

    pub fn reload_entry_point(&mut self, entry_path: &[u8]) -> Result<*mut JSInternalPromise, bun_core::Error> {
        self.has_loaded = false;
        // SAFETY: TODO(port): lifetime — entry_path stored in self.main; Zig assumes caller-owned for VM lifetime
        self.main = unsafe { core::mem::transmute::<&[u8], &'static [u8]>(entry_path) };
        self.main_resolved_path.deref();
        self.main_resolved_path = bun_str::String::empty();
        self.main_hash = Watcher::get_hash(entry_path);
        self.overridden_main = Strong::empty();

        self.ensure_debugger(true)?;

        if !self.main_is_html_entrypoint {
            self.entry_point.generate(!matches!(self.bun_watcher, ImportWatcher::None), entry_path)?;
        }

        // SAFETY: self.global valid for VM lifetime
        let global = unsafe { &*self.global };
        if !self.transpiler.options.disable_transpilation {
            if !self.preload.is_empty() {
                if let Some(promise) = self.load_preloads()? {
                    JSValue::from_cell(promise).ensure_still_alive();
                    JSValue::from_cell(promise).protect();
                    self.pending_internal_promise = Some(promise);
                    self.pending_internal_promise_is_protected = true;
                    return Ok(promise);
                }

                // Check if Module.runMain was patched
                if self.has_patched_run_main {
                    #[cold] fn cold() {}
                    cold();
                    self.pending_internal_promise = None;
                    self.pending_internal_promise_is_protected = false;
                    let main_str = bun_str::String::create_utf8_for_js(global, MAIN_FILE_NAME)?;
                    // SAFETY: extern "C" FFI; self.global valid for VM lifetime
                    let ret = jsc::from_js_host_call(global, || unsafe {
                        NodeModuleModule__callOverriddenRunMain(self.global, main_str)
                    })?;
                    // If the override stored a promise itself, use that; otherwise wrap its return value.
                    if let Some(stored) = self.pending_internal_promise {
                        return Ok(stored);
                    }
                    let resolved = JSInternalPromise::resolved_promise(global, ret);
                    self.pending_internal_promise = Some(resolved);
                    self.pending_internal_promise_is_protected = false;
                    return Ok(resolved);
                }
            }

            let promise = if !self.main_is_html_entrypoint {
                JSModuleLoader::load_and_evaluate_module(global, &bun_str::String::init(MAIN_FILE_NAME))
                    .ok_or(bun_core::err!("JSError"))?
            } else {
                // SAFETY: extern "C" FFI; self.global valid for VM lifetime
                jsc::from_js_host_call_generic(global, || unsafe { Bun__loadHTMLEntryPoint(self.global) })?
            };

            self.pending_internal_promise = Some(promise);
            self.pending_internal_promise_is_protected = false;
            JSValue::from_cell(promise).ensure_still_alive();
            Ok(promise)
        } else {
            let promise = JSModuleLoader::load_and_evaluate_module(global, &bun_str::String::from_bytes(self.main))
                .ok_or(bun_core::err!("JSError"))?;
            self.pending_internal_promise = Some(promise);
            self.pending_internal_promise_is_protected = false;
            JSValue::from_cell(promise).ensure_still_alive();
            Ok(promise)
        }
    }

    #[inline]
    pub fn use_isolation_source_provider_cache(&self) -> bool {
        self.test_isolation_enabled
            && !bun_core::feature_flag::BUN_FEATURE_FLAG_DISABLE_ISOLATION_SOURCE_CACHE.get()
    }

    pub fn reload_entry_point_for_test_runner(&mut self, entry_path: &[u8]) -> Result<*mut JSInternalPromise, bun_core::Error> {
        self.has_loaded = false;
        // SAFETY: TODO(port): lifetime — entry_path stored in self.main; Zig assumes caller-owned for VM lifetime
        self.main = unsafe { core::mem::transmute::<&[u8], &'static [u8]>(entry_path) };
        self.main_resolved_path.deref();
        self.main_resolved_path = bun_str::String::empty();
        self.main_hash = Watcher::get_hash(entry_path);
        self.overridden_main = Strong::empty();

        self.event_loop().ensure_waker();
        self.ensure_debugger(true)?;

        if !self.transpiler.options.disable_transpilation {
            if let Some(promise) = self.load_preloads()? {
                JSValue::from_cell(promise).ensure_still_alive();
                self.pending_internal_promise = Some(promise);
                JSValue::from_cell(promise).protect();
                self.pending_internal_promise_is_protected = true;
                return Ok(promise);
            }
        }

        // SAFETY: self.global valid for VM lifetime
        let global = unsafe { &*self.global };
        let promise = JSModuleLoader::load_and_evaluate_module(global, &bun_str::String::from_bytes(self.main))
            .ok_or(bun_core::err!("JSError"))?;
        self.pending_internal_promise = Some(promise);
        self.pending_internal_promise_is_protected = false;
        JSValue::from_cell(promise).ensure_still_alive();
        Ok(promise)
    }

    // worker dont has bun_watcher and also we dont wanna call autoTick before dispatchOnline
    pub fn load_entry_point_for_web_worker(&mut self, entry_path: &[u8]) -> Result<*mut JSInternalPromise, bun_core::Error> {
        let promise = self.reload_entry_point(entry_path)?;
        self.event_loop().perform_gc();
        self.event_loop().wait_for_promise_with_termination(AnyPromise::Internal(promise));
        if let Some(worker) = self.worker {
            // SAFETY: worker outlives VM (BACKREF)
            if unsafe { (*worker).has_requested_terminate() } {
                return Err(bun_core::err!("WorkerTerminated"));
            }
        }
        Ok(self.pending_internal_promise.unwrap())
    }

    pub fn load_entry_point_for_test_runner(&mut self, entry_path: &[u8]) -> Result<*mut JSInternalPromise, bun_core::Error> {
        let promise = self.reload_entry_point_for_test_runner(entry_path)?;

        // pending_internal_promise can change if hot module reloading is enabled
        if self.is_watcher_enabled() {
            self.event_loop().perform_gc();
            // SAFETY: pending_internal_promise set by reload_entry_point above; rooted by module loader
            if unsafe { (*self.pending_internal_promise.unwrap()).status() } == jsc::PromiseStatus::Pending {
                // SAFETY: same — promise rooted while loop runs
                while unsafe { (*self.pending_internal_promise.unwrap()).status() } == jsc::PromiseStatus::Pending {
                    self.event_loop().tick();
                    // SAFETY: same — promise rooted while loop runs
                    if unsafe { (*self.pending_internal_promise.unwrap()).status() } == jsc::PromiseStatus::Pending {
                        self.event_loop().auto_tick();
                    }
                }
            }
        } else {
            // SAFETY: promise rooted by module loader; on stack (GC scan)
            if unsafe { (*promise).status() } == jsc::PromiseStatus::Rejected {
                return Ok(promise);
            }
            self.event_loop().perform_gc();
            self.wait_for_promise(AnyPromise::Internal(promise));
        }

        self.event_loop().auto_tick();
        Ok(self.pending_internal_promise.unwrap())
    }

    pub fn load_entry_point(&mut self, entry_path: &[u8]) -> Result<*mut JSInternalPromise, bun_core::Error> {
        let promise = self.reload_entry_point(entry_path)?;

        if self.is_watcher_enabled() {
            self.event_loop().perform_gc();
            // SAFETY: pending_internal_promise set by reload_entry_point above; rooted by module loader
            if unsafe { (*self.pending_internal_promise.unwrap()).status() } == jsc::PromiseStatus::Pending {
                // SAFETY: same — promise rooted while loop runs
                while unsafe { (*self.pending_internal_promise.unwrap()).status() } == jsc::PromiseStatus::Pending {
                    self.event_loop().tick();
                    // SAFETY: same — promise rooted while loop runs
                    if unsafe { (*self.pending_internal_promise.unwrap()).status() } == jsc::PromiseStatus::Pending {
                        self.event_loop().auto_tick();
                    }
                }
            }
        } else {
            // SAFETY: promise rooted by module loader; on stack (GC scan)
            if unsafe { (*promise).status() } == jsc::PromiseStatus::Rejected {
                return Ok(promise);
            }
            self.event_loop().perform_gc();
            self.wait_for_promise(AnyPromise::Internal(promise));
        }

        Ok(self.pending_internal_promise.unwrap())
    }

    pub fn add_listening_socket_for_watch_mode(&mut self, socket: bun_sys::Fd) {
        if self.hot_reload != bun_cli::Command::HotReload::Watch && !self.test_isolation_enabled {
            return;
        }
        self.rare_data().add_listening_socket_for_watch_mode(socket);
    }

    pub fn remove_listening_socket_for_watch_mode(&mut self, socket: bun_sys::Fd) {
        if self.hot_reload != bun_cli::Command::HotReload::Watch && !self.test_isolation_enabled {
            return;
        }
        self.rare_data().remove_listening_socket_for_watch_mode(socket);
    }

    /// `bun test --isolate`: tear down per-file OS resources, bump the generation
    /// so stale callbacks self-cancel, then create a fresh `ZigGlobalObject` on
    /// the same `JSC::VM` and point `this.global` at it.
    pub fn swap_global_for_test_isolation(&mut self) {
        debug_assert!(self.test_isolation_enabled);

        let _ = self.event_loop().drain_microtasks();

        if let Some(rare) = self.rare_data.as_mut() {
            rare.close_all_watchers_for_isolation();
        }

        {
            // Groups that must survive the per-file isolation swap.
            let skip_spawn_ipc: Option<*mut uws::SocketGroup> = self.rare_data.as_mut()
                .map(|rare| &mut rare.spawn_ipc_group as *mut _);
            let skip_test_parallel_ipc: Option<*mut uws::SocketGroup> = self.rare_data.as_mut()
                .map(|rare| &mut rare.test_parallel_ipc_group as *mut _);
            #[cfg(unix)]
            let skip_process_ipc: Option<*mut uws::SocketGroup> = match &self.ipc {
                Some(IPCInstanceUnion::Initialized(inst)) => Some(inst.group),
                _ => None,
            };
            #[cfg(not(unix))]
            let skip_process_ipc: Option<*mut uws::SocketGroup> = None;

            let loop_ = uws::Loop::get();
            let mut maybe_group = loop_.internal_loop_data.head;
            while let Some(group) = NonNull::new(maybe_group) {
                let group = group.as_ptr();
                // SAFETY: linked list maintained by usockets
                let next = unsafe { (*group).next };
                if Some(group) != skip_spawn_ipc
                    && Some(group) != skip_process_ipc
                    && Some(group) != skip_test_parallel_ipc
                {
                    // SAFETY: group is a valid linked-list node from usockets loop data
                    unsafe { (*group).close_all() };
                }
                // closeAll → on_close JS may close another group's last socket and
                // unlink our cached `next` from the loop list. Same guard as
                // us_loop_close_all_groups (loop.c) — restart from the head if so.
                // SAFETY: next was read from valid group above; null-checked before deref
                maybe_group = if !next.is_null() && unsafe { (*next).linked } == 0 {
                    loop_.internal_loop_data.head
                } else {
                    next
                };
            }
        }
        if let Some(rare) = self.rare_data.as_mut() {
            rare.listening_sockets_for_watch_mode_lock.lock();
            rare.listening_sockets_for_watch_mode.clear();
            rare.listening_sockets_for_watch_mode_lock.unlock();
        }
        let _ = self.event_loop().drain_microtasks();

        let _ = self.auto_killer.kill();
        self.auto_killer.clear();

        self.test_isolation_generation = self.test_isolation_generation.wrapping_add(1);

        self.overridden_main = Strong::empty();
        self.entry_point_result.value = Strong::empty();
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
        self.main_resolved_path = bun_str::String::empty();
        self.unhandled_error_counter = 0;

        let old_global = self.global;
        let new_global = JSGlobalObject::create_for_test_isolation(old_global, &*self.console);
        self.global = new_global;
        VMHolder::CACHED_GLOBAL_OBJECT.set(Some(new_global));
        self.regular_event_loop.global = new_global;
        self.macro_event_loop.global = new_global;
        self.has_loaded_constructors = true;
        if let Some(IPCInstanceUnion::Initialized(inst)) = &mut self.ipc {
            inst.global_this = new_global;
        }
        // NapiEnv cleanup hooks captured the old global; repoint.
        if let Some(rare) = self.rare_data.as_mut() {
            for hook in rare.cleanup_hooks.iter_mut() {
                if hook.global_this == old_global {
                    hook.global_this = new_global;
                }
            }
        }

        // TODO(isolate): drain HTTPThread's keepalive pool.
    }

    pub fn load_macro_entry_point(&mut self, entry_path: &[u8], function_name: &[u8], specifier: &[u8], hash: i32) -> Result<*mut JSInternalPromise, bun_core::Error> {
        let entry_point_entry = self.macro_entry_points.get_or_put(hash);

        if !entry_point_entry.found_existing {
            let macro_entry_pointer = Box::into_raw(Box::new(MacroEntryPoint::default()));
            *entry_point_entry.value_ptr = macro_entry_pointer;
            // SAFETY: just allocated
            unsafe {
                (*macro_entry_pointer).generate(&mut self.transpiler, Fs::PathName::init(entry_path), function_name, hash, specifier)?;
            }
        }
        let entry_point = *entry_point_entry.value_ptr;

        let mut loader = MacroEntryPointLoader {
            // SAFETY: entry_point lives in macro_entry_points map for VM lifetime
            path: unsafe { core::mem::transmute::<&[u8], &'static [u8]>((*entry_point).source.path.text) },
            promise: None,
        };

        self.run_with_api_lock(&mut loader, MacroEntryPointLoader::load);
        loader.promise.ok_or(bun_core::err!("JSError"))
    }

    /// A subtlelty of JavaScriptCore:
    /// JavaScriptCore has many release asserts that check an API lock is currently held
    /// We cannot hold it from Rust code because it relies on C++ RAII to automatically release the lock
    /// So we have to wrap entry points to & from JavaScript with an API lock that calls out to C++
    pub fn run_with_api_lock<C>(&mut self, ctx: &mut C, function: fn(&mut C)) {
        // SAFETY: global is valid
        unsafe { (*self.global).vm() }.hold_api_lock(ctx as *mut C as *mut c_void, jsc::opaque_wrap::<C>(function));
    }

    #[inline]
    pub fn _load_macro_entry_point(&mut self, entry_path: &[u8]) -> Option<*mut JSInternalPromise> {
        // SAFETY: self.global valid for VM lifetime
        let global = unsafe { &*self.global };
        let promise = JSModuleLoader::load_and_evaluate_module(global, &bun_str::String::init(entry_path))?;
        self.wait_for_promise(AnyPromise::Internal(promise));
        Some(promise)
    }

    pub fn print_error_like_object_to_console(&mut self, value: JSValue) {
        self.run_error_handler(value, None);
    }

    // When the Error-like object is one of our own, it's best to rely on the object directly instead of serializing it to a ZigException.
    // This is for: BuildMessage, ResolveMessage. AggregateError is recursive. All other cases convert to ZigException.
    pub fn print_errorlike_object<W: core::fmt::Write, const ALLOW_ANSI_COLOR: bool, const ALLOW_SIDE_EFFECTS: bool>(
        &mut self,
        value: JSValue,
        exception: Option<&Exception>,
        exception_list: Option<&mut ExceptionList>,
        formatter: &mut ConsoleObject::Formatter,
        writer: &mut W,
    ) {
        // TODO(port): full body at Zig lines 2663-2733. Heavy generic-over-Writer
        // logic with closure-based AggregateErrorIterator that captures self+writer.
        // Phase B: port via dyn Write or callback adapter.
        let mut was_internal = false;

        // defer block (Zig lines 2676-2696)
        let _defer = scopeguard::guard(
            (self as *mut Self, exception, exception_list.as_deref().map(|l| l as *const _)),
            |(s, ex, list)| {
                if was_internal {
                    if let Some(exception_) = ex {
                        // TODO(port): ZigException.Holder + getStackTrace + printStackTrace
                        let _ = (s, list, exception_);
                    }
                }
            },
        );

        // SAFETY: self.global valid for VM lifetime
        let global = unsafe { &*self.global };
        if value.is_aggregate_error(global) {
            // TODO(port): AggregateErrorIterator with callconv(.c) callbacks (lines 2699-2720)
            // Needs C-ABI thunks capturing (writer, exception_list, formatter) via ctx ptr.
            return;
        }

        was_internal = self.print_error_from_maybe_private_data::<W, ALLOW_ANSI_COLOR, ALLOW_SIDE_EFFECTS>(
            value, exception_list, formatter, writer,
        );
        let _ = was_internal;
    }

    fn print_error_from_maybe_private_data<W: core::fmt::Write, const ALLOW_ANSI_COLOR: bool, const ALLOW_SIDE_EFFECTS: bool>(
        &mut self,
        value: JSValue,
        exception_list: Option<&mut ExceptionList>,
        formatter: &mut ConsoleObject::Formatter,
        writer: &mut W,
    ) -> bool {
        if value.js_type() == jsc::JSType::DOMWrapper {
            if let Some(build_error) = value.as_::<bun_runtime::api::BuildMessage>() {
                let _flush = scopeguard::guard((), |_| Output::flush());
                if !build_error.logged {
                    if self.had_errors {
                        let _ = writer.write_str("\n");
                    }
                    let _ = build_error.msg.write_format(writer, ALLOW_ANSI_COLOR);
                    build_error.logged = true;
                    let _ = writer.write_str("\n");
                }
                self.had_errors = self.had_errors || build_error.msg.kind == logger::Kind::Err;
                if exception_list.is_some() {
                    // SAFETY: BORROW_PARAM log ptr valid for VM lifetime (set in init)
                    let _ = unsafe { self.log.unwrap().as_mut() }.add_msg(build_error.msg.clone());
                }
                return true;
            } else if let Some(resolve_error) = value.as_::<bun_runtime::api::ResolveMessage>() {
                let _flush = scopeguard::guard((), |_| Output::flush());
                if !resolve_error.logged {
                    if self.had_errors {
                        let _ = writer.write_str("\n");
                    }
                    let _ = resolve_error.msg.write_format(writer, ALLOW_ANSI_COLOR);
                    resolve_error.logged = true;
                    let _ = writer.write_str("\n");
                }
                self.had_errors = self.had_errors || resolve_error.msg.kind == logger::Kind::Err;
                if exception_list.is_some() {
                    // SAFETY: BORROW_PARAM log ptr valid for VM lifetime (set in init)
                    let _ = unsafe { self.log.unwrap().as_mut() }.add_msg(resolve_error.msg.clone());
                }
                return true;
            }
        }

        if let Err(err) = self.print_error_instance::<W, ALLOW_ANSI_COLOR, ALLOW_SIDE_EFFECTS>(
            ErrorInstanceMode::Js(value), exception_list, formatter, writer,
        ) {
            if err == bun_core::err!("JSError") {
                // SAFETY: self.global valid for VM lifetime
                unsafe { (*self.global).clear_exception() };
            } else if cfg!(debug_assertions) {
                // yo dawg
                Output::print_error_ln(format_args!("Error while printing Error-like object: {}", err.name()));
                Output::flush();
            }
        }

        false
    }

    pub fn report_uncaught_exception(global_object: &JSGlobalObject, exception: &Exception) -> JSValue {
        let jsc_vm = global_object.bun_vm();
        let _ = jsc_vm.uncaught_exception(global_object, exception.value(), false);
        JSValue::UNDEFINED
    }

    pub fn print_stack_trace<W: core::fmt::Write, const ALLOW_ANSI_COLORS: bool>(
        writer: &mut W,
        trace: &ZigStackTrace,
    ) -> core::fmt::Result {
        let stack = trace.frames();
        if stack.is_empty() {
            return Ok(());
        }
        let vm = VirtualMachine::get();
        let origin: Option<&URL> = if vm.is_from_devserver { Some(&vm.origin) } else { None };
        let dir = vm.transpiler.fs.top_level_dir;

        for frame in stack {
            let file_slice = frame.source_url.to_utf8();
            let func_slice = frame.function_name.to_utf8();

            let file = file_slice.slice();
            let func = func_slice.slice();

            if file.is_empty() && func.is_empty() {
                continue;
            }

            // TODO(port): std.fmt.count("{f}", nameFormatter) — using is_empty heuristic
            let has_name = !func.is_empty() || frame.name_formatter(false).has_content();

            if has_name && !frame.position.is_invalid() {
                write!(writer, "{}",
                    Output::pretty_fmt::<ALLOW_ANSI_COLORS>(format_args!(
                        "<r>      <d>at <r>{}<d> (<r>{}<d>)<r>\n",
                        frame.name_formatter(ALLOW_ANSI_COLORS),
                        frame.source_url_formatter(dir, origin, false, ALLOW_ANSI_COLORS),
                    ))
                )?;
            } else if !frame.position.is_invalid() {
                write!(writer, "{}",
                    Output::pretty_fmt::<ALLOW_ANSI_COLORS>(format_args!(
                        "<r>      <d>at <r>{}\n",
                        frame.source_url_formatter(dir, origin, false, ALLOW_ANSI_COLORS),
                    ))
                )?;
            } else if has_name {
                write!(writer, "{}",
                    Output::pretty_fmt::<ALLOW_ANSI_COLORS>(format_args!(
                        "<r>      <d>at <r>{}<d>\n",
                        frame.name_formatter(ALLOW_ANSI_COLORS),
                    ))
                )?;
            } else {
                write!(writer, "{}",
                    Output::pretty_fmt::<ALLOW_ANSI_COLORS>(format_args!(
                        "<r>      <d>at <r>{}<d>\n",
                        frame.source_url_formatter(dir, origin, false, ALLOW_ANSI_COLORS),
                    ))
                )?;
            }
        }
        Ok(())
    }

    pub fn remap_stack_frame_positions(&mut self, frames: *mut jsc::ZigStackFrame, frames_count: usize) {
        if frames_count == 0 {
            return;
        }

        // **Warning** this method can be called in the heap collector thread!!
        // https://github.com/oven-sh/bun/issues/17087
        self.remap_stack_frames_mutex.lock();
        // SAFETY: mutex field outlives this scope; raw ptr to dodge borrowck across guard
        let _unlock = scopeguard::guard(&mut self.remap_stack_frames_mutex as *mut _, |m| unsafe { (*m).unlock() });

        self.source_mappings.lock();
        let mut table_locked = true;
        let _unlock_table = scopeguard::guard((&mut self.source_mappings as *mut SavedSourceMap, &mut table_locked as *mut bool), |(sm, tl)| {
            // SAFETY: pointers valid for fn duration
            if unsafe { *tl } {
                // SAFETY: sm points to self.source_mappings which outlives this scope
                unsafe { (*sm).unlock() };
            }
        });

        let sm = &mut self.source_mappings;
        let mut cached_hash: u64 = sm.last_path_hash;

        enum Cached {
            None,
            Ism(SourceMap::InternalSourceMap),
            Absent,
        }
        let mut cached: Cached = match sm.last_ism {
            Some(ism) => Cached::Ism(ism),
            None => Cached::None,
        };

        // SAFETY: caller guarantees frames[0..frames_count] valid
        let frames_slice = unsafe { core::slice::from_raw_parts_mut(frames, frames_count) };
        for frame in frames_slice.iter_mut() {
            if frame.position.is_invalid() || frame.remapped {
                continue;
            }
            let source_url = frame.source_url.to_utf8();
            let path = source_url.slice();
            if path.is_empty() {
                frame.remapped = true;
                continue;
            }
            let hash = bun_wyhash::hash(path);

            if matches!(cached, Cached::None) || hash != cached_hash {
                cached_hash = hash;
                if let Some(value) = self.source_mappings.get_value_locked(hash) {
                    if let Some(ptr) = value.get::<SourceMap::InternalSourceMap>() {
                        cached = Cached::Ism(SourceMap::InternalSourceMap { data: ptr as *const u8 });
                    } else if let Some(parsed) = value.get::<SourceMap::ParsedSourceMap>() {
                        if parsed.internal.is_some() && !parsed.is_external() {
                            cached = Cached::Ism(parsed.internal.unwrap());
                        } else {
                            cached = Cached::None;
                            if let Some(mapping) = parsed.find_mapping(frame.position.line, frame.position.column) {
                                let lookup = SourceMap::Mapping::Lookup {
                                    mapping,
                                    source_map: Some(parsed),
                                    prefetched_source_code: None,
                                };
                                if let Some(source_url) = lookup.display_source_url_if_needed(path) {
                                    frame.source_url.deref();
                                    frame.source_url = source_url;
                                }
                                frame.position.line = mapping.original.lines;
                                frame.position.column = mapping.original.columns;
                            }
                            frame.remapped = true;
                            continue;
                        }
                    } else {
                        // SourceProviderMap / Bake / DevServer: needs lazy parse outside the table lock.
                        cached = Cached::None;
                        self.source_mappings.unlock();
                        table_locked = false;
                        self.remap_one_frame_slow(frame, path);
                        self.source_mappings.lock();
                        table_locked = true;
                        continue;
                    }
                } else if self.standalone_module_graph.is_some() {
                    cached = Cached::None;
                    self.source_mappings.unlock();
                    table_locked = false;
                    self.remap_one_frame_slow(frame, path);
                    self.source_mappings.lock();
                    table_locked = true;
                    continue;
                } else {
                    cached = Cached::Absent;
                }
            }

            match &cached {
                Cached::Ism(ism) => {
                    if let Some(mapping) = ism.find_with_cache(frame.position.line, frame.position.column, &mut sm.find_cache) {
                        frame.position.line = mapping.original.lines;
                        frame.position.column = mapping.original.columns;
                    }
                }
                Cached::Absent => {}
                Cached::None => unreachable!(),
            }
            frame.remapped = true;
        }

        sm.last_path_hash = cached_hash;
        sm.last_ism = if let Cached::Ism(ism) = cached { Some(ism) } else { None };
    }

    fn remap_one_frame_slow(&mut self, frame: &mut jsc::ZigStackFrame, path: &[u8]) {
        if let Some(lookup) = self.resolve_source_mapping(
            path,
            frame.position.line,
            frame.position.column,
            SourceMap::SourceContentHandling::NoSourceContents,
        ) {
            let source_map = lookup.source_map;
            let _deref = scopeguard::guard(source_map, |m| if let Some(m) = m { m.deref() });
            if let Some(source_url) = lookup.display_source_url_if_needed(path) {
                frame.source_url.deref();
                frame.source_url = source_url;
            }
            let mapping = lookup.mapping;
            frame.position.line = mapping.original.lines;
            frame.position.column = mapping.original.columns;
        }
        frame.remapped = true;
    }

    pub fn remap_zig_exception(
        &mut self,
        exception: &mut ZigException,
        error_instance: JSValue,
        exception_list: Option<&mut ExceptionList>,
        must_reset_parser_arena_later: &mut bool,
        source_code_slice: &mut Option<ZigString::Slice>,
        allow_source_code_preview: bool,
    ) {
        // TODO(port): full body at Zig lines 3029-3263. ~230 lines of dense
        // sourcemap remapping + frame filtering + source-line collection.
        // Logic structure preserved in comments; Phase B port required.
        // SAFETY: self.global valid for VM lifetime
        let global = unsafe { &*self.global };
        error_instance.to_zig_exception(global, exception);
        let mut enable_source_code_preview = allow_source_code_preview
            && !(bun_core::feature_flag::BUN_DISABLE_SOURCE_CODE_PREVIEW.get()
                || bun_core::feature_flag::BUN_DISABLE_TRANSPILED_SOURCE_CODE_PREVIEW.get());

        // defer: addToErrorList
        // defer (debug): assert source_code_slice consistency

        static NOISY_BUILTIN_FUNCTION_MAP: phf::Set<&'static [u8]> = phf::phf_set! {
            b"asyncModuleEvaluation",
            b"link",
            b"linkAndEvaluateModule",
            b"moduleEvaluation",
            b"processTicksAndRejections",
        };

        // TODO(port): frame filtering (hide_bun_stackframes) — lines 3066-3108
        // TODO(port): top-frame selection — lines 3110-3138
        // TODO(port): source code fetch + getLinesInText — lines 3143-3238
        // TODO(port): remap remaining frames — lines 3240-3262

        let _ = (exception_list, must_reset_parser_arena_later, source_code_slice, enable_source_code_preview);
    }

    pub fn print_externally_remapped_zig_exception<W: core::fmt::Write, const ALLOW_SIDE_EFFECTS: bool, const ALLOW_ANSI_COLOR: bool>(
        &mut self,
        zig_exception: &mut ZigException,
        formatter: Option<&mut ConsoleObject::Formatter>,
        writer: &mut W,
    ) -> Result<(), bun_core::Error> {
        let mut default_formatter = ConsoleObject::Formatter { global_this: self.global, ..Default::default() };
        self.print_error_instance::<W, ALLOW_ANSI_COLOR, ALLOW_SIDE_EFFECTS>(
            ErrorInstanceMode::ZigException(zig_exception),
            None,
            formatter.unwrap_or(&mut default_formatter),
            writer,
        )
    }

    fn print_error_instance<W: core::fmt::Write, const ALLOW_ANSI_COLOR: bool, const ALLOW_SIDE_EFFECTS: bool>(
        &mut self,
        error_instance: ErrorInstanceMode,
        exception_list: Option<&mut ExceptionList>,
        formatter: &mut ConsoleObject::Formatter,
        writer: &mut W,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): full body at Zig lines 3288-3677. ~390 lines: source-line
        // rendering with line-number gutter, name+message printing, property
        // iteration via JSPropertyIterator, recursive cause/errors handling,
        // circular detection. This is the largest single fn in the file and
        // depends heavily on Output.prettyFmt comptime expansion. Phase B port.
        let _ = (error_instance, exception_list, formatter, writer);
        Ok(())
    }

    fn print_error_name_and_message<W: core::fmt::Write, const ALLOW_ANSI_COLOR: bool>(
        &self,
        name: bun_str::String,
        message: bun_str::String,
        is_browser_error: bool,
        optional_code: Option<&[u8]>,
        writer: &mut W,
        error_display_level: ConsoleObject::FormatOptions::ErrorDisplayLevel,
    ) -> core::fmt::Result {
        // TODO(port): full body at Zig lines 3679-3735. Involves comptime
        // Output.prettyFmt and inline-for over isUTF16 to detect code prefix.
        let _ = (name, message, is_browser_error, optional_code, writer, error_display_level);
        Ok(())
    }

    // In Github Actions, emit an annotation that renders the error and location.
    // https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#setting-an-error-message
    #[cold]
    #[inline(never)]
    pub fn print_github_annotation(exception: &ZigException) {
        let name = &exception.name;
        let message = &exception.message;
        let frames = exception.stack.frames();
        let top_frame = frames.first();
        let dir = env_var::GITHUB_WORKSPACE.get()
            .unwrap_or_else(|| bun_resolver::fs::FileSystem::instance().top_level_dir);
        Output::flush();

        let mut writer = Output::error_writer_buffered();
        // SAFETY: writer is on stack and outlives the guard
        let _flush = scopeguard::guard(&mut writer as *mut _, |w| unsafe { let _ = (*w).flush(); });

        let mut has_location = false;

        if let Some(frame) = top_frame {
            if !frame.position.is_invalid() {
                let source_url = frame.source_url.to_utf8();
                let file = bun_paths::relative(dir, source_url.slice());
                let _ = write!(writer, "\n::error file={},line={},col={},title=",
                    bstr::BStr::new(file),
                    frame.position.line.one_based(),
                    frame.position.column.one_based(),
                );
                has_location = true;
            }
        }

        if !has_location {
            let _ = write!(writer, "\n::error title=");
        }

        if name.is_empty() || name.eql_comptime(b"Error") {
            let _ = write!(writer, "error");
        } else {
            let _ = write!(writer, "{}", name.github_action());
        }

        if !message.is_empty() {
            let message_slice = message.to_utf8();
            let msg = message_slice.slice();

            let mut cursor: u32 = 0;
            let mut found_first_newline = false;
            while let Some(i) = strings::index_of_newline_or_non_ascii_or_ansi(msg, cursor) {
                cursor = i + 1;
                if msg[i as usize] == b'\n' {
                    let first_line = bun_str::String::borrow_utf8(&msg[..i as usize]);
                    let _ = write!(writer, ": {}::", first_line.github_action());
                    found_first_newline = true;
                    break;
                }
            }
            if !found_first_newline {
                let _ = write!(writer, ": {}::", message.github_action());
            }

            while let Some(i) = strings::index_of_newline_or_non_ascii_or_ansi(msg, cursor) {
                cursor = i + 1;
                if msg[i as usize] == b'\n' {
                    break;
                }
            }

            if cursor > 0 {
                let body = ZigString::init_utf8(&msg[cursor as usize..]);
                let _ = write!(writer, "{}", body.github_action());
            }
        } else {
            let _ = write!(writer, "::");
        }

        // TODO: cleanup and refactor to use printStackTrace()
        if top_frame.is_some() {
            let vm = VirtualMachine::get();
            let origin = if vm.is_from_devserver { Some(&vm.origin) } else { None };

            // PORT NOTE: Zig used i16 for the loop counter for no good reason; usize is fine.
            let mut i: usize = 0;
            while i < frames.len() {
                let frame = &frames[i];
                let source_url = frame.source_url.to_utf8();
                let file = bun_paths::relative(dir, source_url.slice());
                let func = frame.function_name.to_utf8();

                if file.is_empty() && func.slice().is_empty() {
                    i += 1;
                    continue;
                }

                // TODO(port): std.fmt.count("{f}", nameFormatter)
                let has_name = !func.slice().is_empty() || frame.name_formatter(false).has_content();

                // %0A = escaped newline
                if has_name {
                    let _ = write!(writer, "%0A      at {} ({})",
                        frame.name_formatter(false),
                        frame.source_url_formatter(file, origin, false, false),
                    );
                } else {
                    let _ = write!(writer, "%0A      at {}",
                        frame.source_url_formatter(file, origin, false, false),
                    );
                }
                i += 1;
            }
        }

        let _ = write!(writer, "\n");
    }

    pub fn resolve_source_mapping(
        &mut self,
        path: &[u8],
        line: bun_core::Ordinal,
        column: bun_core::Ordinal,
        source_handling: SourceMap::SourceContentHandling,
    ) -> Option<SourceMap::Mapping::Lookup> {
        if let Some(lookup) = self.source_mappings.resolve_mapping(path, line, column, source_handling) {
            return Some(lookup);
        }
        if let Some(graph) = self.standalone_module_graph {
            // SAFETY: BORROW_PARAM — graph outlives VM
            let graph = unsafe { graph.as_ref() };
            let file = graph.find(path)?;
            let map = file.sourcemap.load()?;

            map.ref_();

            self.source_mappings
                .put_value(path, SavedSourceMap::Value::init(map))
                .unwrap_or_else(|_| bun_core::out_of_memory());

            let mapping = map.find_mapping(line, column)?;

            return Some(SourceMap::Mapping::Lookup {
                mapping,
                source_map: Some(map),
                prefetched_source_code: None,
            });
        }
        None
    }

    pub fn init_ipc_instance(&mut self, fd: bun_sys::Fd, mode: IPC::Mode) {
        bun_output::scoped_log!(IPC, "initIPCInstance {}", fd);
        self.ipc = Some(IPCInstanceUnion::Waiting { fd, mode });
    }

    pub fn get_ipc_instance(&mut self) -> Option<&mut IPCInstance> {
        let opts = match &self.ipc {
            None => return None,
            Some(IPCInstanceUnion::Initialized(_)) => {
                // PORT NOTE: reshaped for borrowck — re-borrow after match
                if let Some(IPCInstanceUnion::Initialized(inst)) = &mut self.ipc {
                    return Some(inst);
                }
                unreachable!();
            }
            Some(IPCInstanceUnion::Waiting { fd, mode }) => (*fd, *mode),
        };
        let (fd, mode) = opts;

        bun_output::scoped_log!(IPC, "getIPCInstance {}", fd);

        self.event_loop().ensure_waker();

        #[cfg(not(target_os = "windows"))]
        let instance: Option<Box<IPCInstance>> = {
            let group = self.rare_data().spawn_ipc_group(self) as *mut uws::SocketGroup;

            let mut instance = Box::new(IPCInstance {
                global_this: self.global,
                group,
                // SAFETY: TODO(port) — overwritten by SendQueue::init below before any read; verify SendQueue is zero-valid
                data: unsafe { core::mem::zeroed() }, // set below
                has_disconnect_called: false,
            });

            // TODO(port): self.ipc must be set BEFORE Socket.fromFd (Zig line 4013) but
            // we need ownership; using raw ptr round-trip
            let inst_ptr = &mut *instance as *mut IPCInstance;
            self.ipc = Some(IPCInstanceUnion::Initialized(instance));

            // SAFETY: just stored in self.ipc
            let instance = unsafe { &mut *inst_ptr };
            instance.data = IPC::SendQueue::init(mode, IPC::Owner::VirtualMachine(inst_ptr), IPC::SocketState::Uninitialized);

            match IPC::Socket::from_fd(group, IPC::SocketKind::SpawnIpc, fd, &mut instance.data, None, true) {
                Some(socket) => {
                    socket.set_timeout(0);
                    instance.data.socket = IPC::SocketState::Open(socket);
                    if let Some(IPCInstanceUnion::Initialized(b)) = self.ipc.take() {
                        Some(b)
                    } else {
                        unreachable!()
                    }
                }
                None => {
                    self.ipc = None; // drops instance
                    Output::warn(format_args!("Unable to start IPC socket"));
                    return None;
                }
            }
        };
        #[cfg(target_os = "windows")]
        let instance: Option<Box<IPCInstance>> = {
            let mut instance = Box::new(IPCInstance {
                global_this: self.global,
                group: (),
                // SAFETY: TODO(port) — overwritten by SendQueue::init below before any read; verify SendQueue is zero-valid
                data: unsafe { core::mem::zeroed() },
                has_disconnect_called: false,
            });
            let inst_ptr = &mut *instance as *mut IPCInstance;
            instance.data = IPC::SendQueue::init(mode, IPC::Owner::VirtualMachine(inst_ptr), IPC::SocketState::Uninitialized);

            self.ipc = Some(IPCInstanceUnion::Initialized(instance));
            // SAFETY: just stored
            let instance = unsafe { &mut *inst_ptr };

            if instance.data.windows_configure_client(fd).is_err() {
                self.ipc = None; // drops instance
                Output::warn(format_args!("Unable to start IPC pipe '{}'", fd));
                return None;
            }

            if let Some(IPCInstanceUnion::Initialized(b)) = self.ipc.take() {
                Some(b)
            } else {
                unreachable!()
            }
        };

        let mut instance = instance.unwrap();
        // SAFETY: self.global valid for VM lifetime
        instance.data.write_version_packet(unsafe { &*self.global });
        self.ipc = Some(IPCInstanceUnion::Initialized(instance));

        if let Some(IPCInstanceUnion::Initialized(inst)) = &mut self.ipc {
            Some(inst)
        } else {
            unreachable!()
        }
    }

    /// To satisfy the interface from NewHotReloader()
    pub fn get_loaders(&mut self) -> &mut options::Loader::HashTable {
        &mut self.transpiler.options.loaders
    }

    /// To satisfy the interface from NewHotReloader()
    pub fn bust_dir_cache(&mut self, path: &[u8]) -> bool {
        self.transpiler.resolver.bust_dir_cache(path)
    }

    // TODO(port): field_defaults() — helper for the many = default field initializers
    // in the Zig struct literal. Phase B MUST replace this with a hand-written
    // `Default`/const initializer: `mem::zeroed()` is UB for Box/NonNull/Strong/enum
    // fields (PORTING.md §std.mem.zeroes). Only the FRU-spread fields are ever read
    // from this value; all others are overwritten by ptr::write in init().
    fn field_defaults() -> Self {
        // SAFETY: TODO(port) — INVALID. all-zero is NOT a valid Self (Box/NonNull fields).
        // Retained as placeholder so the FRU `..` spread compiles in Phase A.
        unsafe { core::mem::zeroed() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Free-standing & exported fns
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
enum ErrorInstanceMode<'a> {
    Js(JSValue),
    ZigException(&'a mut ZigException),
}

fn get_origin_timestamp() -> u64 {
    // handle if they set their system clock to be before epoch
    let now = bun_core::time::nano_timestamp().max(ORIGIN_RELATIVE_EPOCH);
    (u128::try_from(now).unwrap() - ORIGIN_RELATIVE_EPOCH as u128) as u64
}

fn is_error_like(global_object: &JSGlobalObject, reason: JSValue) -> JsResult<bool> {
    // SAFETY: extern "C" FFI; const→mut cast required by C ABI, callee does not mutate
    jsc::from_js_host_call_generic(global_object, || unsafe {
        Bun__promises__isErrorLike(global_object as *const _ as *mut _, reason)
    })
}

fn wrap_unhandled_rejection_error_for_uncaught_exception(global_object: &JSGlobalObject, reason: JSValue) -> JSValue {
    let like = is_error_like(global_object, reason).unwrap_or_else(|_| {
        global_object.clear_exception();
        false
    });
    if like {
        return reason;
    }
    let reason_str = {
        let mut scope = jsc::TopExceptionScope::init(global_object);
        let _clear = scopeguard::guard(&mut scope as *mut jsc::TopExceptionScope, |s| {
            // SAFETY: scope on stack
            let s = unsafe { &mut *s };
            if s.exception().is_some() {
                s.clear_exception();
            }
        });
        // SAFETY: extern "C" FFI; const→mut cast required by C ABI, callee does not mutate
        unsafe { Bun__noSideEffectsToString(global_object.vm(), global_object as *const _ as *mut _, reason) }
    };
    const MSG_1: &str = "This error originated either by throwing inside of an async function without a catch block, \
        or by rejecting a promise which was not handled with .catch(). The promise rejected with the reason \"";
    if reason_str.is_string() {
        return global_object
            .err(jsc::ErrorCode::UNHANDLED_REJECTION, format_args!("{}{}\".", MSG_1, reason_str.as_string().view(global_object)))
            .to_js();
    }
    global_object
        .err(jsc::ErrorCode::UNHANDLED_REJECTION, format_args!("{}{}\".", MSG_1, "undefined"))
        .to_js()
}

fn normalize_specifier_for_resolution<'a>(specifier_: &'a [u8], query_string: &mut &'a [u8]) -> &'a [u8] {
    let mut specifier = specifier_;
    if let Some(i) = strings::index_of_char(specifier, b'?') {
        *query_string = &specifier[i as usize..];
        specifier = &specifier[..i as usize];
    }
    specifier
}

fn normalize_source(source: &[u8]) -> &[u8] {
    if source.starts_with(b"file://") {
        return &source[b"file://".len()..];
    }
    source
}

extern "C" fn free_ref_string(str: *mut RefString, _: *mut c_void, _: u32) {
    // SAFETY: RefString allocated by Box in ref_counted_string_with_was_new
    unsafe { (*str).deinit() };
}

#[unsafe(no_mangle)]
extern "C" fn Bun__isMainThreadVM() -> bool {
    VirtualMachine::get().is_main_thread
}

#[bun_jsc::host_fn]
pub fn Bun__drainMicrotasksFromJS(global_object: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
    global_object.bun_vm().drain_microtasks();
    Ok(JSValue::UNDEFINED)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__logUnhandledException(exception: JSValue) {
    VirtualMachine::get().run_error_handler(exception, None);
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__remapStackFramePositions(vm: &mut VirtualMachine, frames: *mut jsc::ZigStackFrame, frames_count: usize) {
    // **Warning** this method can be called in the heap collector thread!!
    // https://github.com/oven-sh/bun/issues/17087
    vm.remap_stack_frame_positions(frames, frames_count);
}

#[unsafe(no_mangle)]
extern "C" fn Bun__VM__useIsolationSourceProviderCache(vm: &VirtualMachine) -> bool {
    vm.use_isolation_source_provider_cache()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__VirtualMachine__setOverrideModuleRunMain(vm: &mut VirtualMachine, is_patched: bool) {
    if vm.is_in_preload {
        vm.has_patched_run_main = is_patched;
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__VirtualMachine__setOverrideModuleRunMainPromise(vm: &mut VirtualMachine, promise: *mut JSInternalPromise) {
    if vm.pending_internal_promise.is_none() {
        vm.pending_internal_promise = Some(promise);
        vm.pending_internal_promise_is_protected = false;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/VirtualMachine.zig (4173 lines)
//   confidence: low
//   todos:      59
//   notes:      Self-referential heap struct (event_loop→regular_event_loop, source_mappings→saved_source_map_table) — init now uses MaybeUninit+ptr::write but field_defaults() FRU spread is still mem::zeroed placeholder (UB, Phase B must hand-write); log/arena/standalone_module_graph kept Option<NonNull> with TODO(port):lifetime (TSV says BORROW_PARAM but VM cannot carry <'a>); deinit→destroy (no Drop, explicit-call-only); init_worker/init_bake stubbed; print_error_instance/remap_zig_exception/print_error_name_and_message bodies stubbed (~700 LOC); many &'static [u8] lifetimes need Phase B audit.
// ──────────────────────────────────────────────────────────────────────────
