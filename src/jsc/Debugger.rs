use core::ffi::{c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_aio::KeepAlive;
use bun_core::Output;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, VirtualMachine, ZigException};
use bun_str::String as BunString;

bun_output::declare_scope!(debugger, visible);
bun_output::declare_scope!(TestReporterAgent, visible);
bun_output::declare_scope!(LifecycleAgent, visible);

pub use crate::http_server_agent::HttpServerAgent as HTTPServerAgent;
pub use bun_runtime::server::inspector_bun_frontend_dev_server_agent::BunFrontendDevServerAgent;

/// `bun.GenericIndex(i32, Debugger)`
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct DebuggerId(pub i32);

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Wait {
    Off,
    Shortly,
    Forever,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Mode {
    /// Bun acts as the server. https://debug.bun.sh/ uses this
    Listen,
    /// Bun connects to this path. The VSCode extension uses this.
    Connect,
}

pub struct Debugger {
    // TODO(port): lifetime — never freed in Zig; likely borrowed from CLI args / env for process lifetime
    pub path_or_port: Option<&'static [u8]>,
    // TODO(port): lifetime — never freed in Zig; default ""
    pub from_environment_variable: &'static [u8],
    pub script_execution_context_id: u32,
    pub next_debugger_id: u64,
    pub poll_ref: KeepAlive,
    pub wait_for_connection: Wait,
    // wait_for_connection: bool = false,
    pub set_breakpoint_on_first_line: bool,
    pub mode: Mode,

    pub test_reporter_agent: TestReporterAgent,
    pub lifecycle_reporter_agent: LifecycleAgent,
    pub frontend_dev_server_agent: BunFrontendDevServerAgent,
    pub http_server_agent: HTTPServerAgent,
    pub must_block_until_connected: bool,
}

impl Default for Debugger {
    fn default() -> Self {
        Self {
            path_or_port: None,
            from_environment_variable: b"",
            script_execution_context_id: 0,
            next_debugger_id: 1,
            poll_ref: KeepAlive::default(),
            wait_for_connection: Wait::Off,
            set_breakpoint_on_first_line: false,
            mode: Mode::Listen,
            test_reporter_agent: TestReporterAgent::default(),
            lifecycle_reporter_agent: LifecycleAgent::default(),
            frontend_dev_server_agent: BunFrontendDevServerAgent::default(),
            http_server_agent: HTTPServerAgent::default(),
            must_block_until_connected: false,
        }
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn Bun__createJSDebugger(global: *mut JSGlobalObject) -> u32;
    fn Bun__ensureDebugger(ctx_id: u32, wait: bool);
    fn Bun__startJSDebuggerThread(
        global: *mut JSGlobalObject,
        ctx_id: u32,
        url: *mut BunString,
        from_env: c_int,
        is_connect: bool,
    );
}

static FUTEX_ATOMIC: AtomicU32 = AtomicU32::new(0);

impl Debugger {
    pub fn wait_for_debugger_if_necessary(this: &mut VirtualMachine) {
        let Some(debugger) = this.debugger.as_mut() else {
            return;
        };
        bun_analytics::Features::debugger().fetch_add(1, Ordering::Relaxed);
        if !debugger.must_block_until_connected {
            return;
        }
        // defer debugger.must_block_until_connected = false;
        // PORT NOTE: reshaped for borrowck — moved to end of fn (no early returns after this point)

        bun_output::scoped_log!(debugger, "spin");
        while FUTEX_ATOMIC.load(Ordering::Relaxed) > 0 {
            bun_threading::futex::wait_forever(&FUTEX_ATOMIC, 1);
        }
        if cfg!(feature = "debug_logs") {
            bun_output::scoped_log!(
                debugger,
                "waitForDebugger: {}",
                Output::ElapsedFormatter {
                    colors: Output::enable_ansi_colors_stderr(),
                    duration_ns: (bun_core::time::nano_timestamp() - bun_cli::start_time()) as u64,
                }
            );
        }

        // SAFETY: FFI call into C++ debugger init
        unsafe {
            Bun__ensureDebugger(
                debugger.script_execution_context_id,
                debugger.wait_for_connection != Wait::Off,
            );
        }

        // Sleep up to 30ms for automatic inspection.
        const WAIT_FOR_CONNECTION_DELAY_MS: u64 = 30;

        // TODO(port): bun.timespec — using bun_core::Timespec placeholder
        let mut deadline: bun_core::Timespec = if debugger.wait_for_connection == Wait::Shortly {
            bun_core::Timespec::now(bun_core::TimespecClock::ForceRealTime)
                .add_ms(WAIT_FOR_CONNECTION_DELAY_MS)
        } else {
            // SAFETY: only read when wait_for_connection == Shortly (matches Zig `undefined`)
            unsafe { core::mem::zeroed() }
        };

        #[cfg(windows)]
        {
            use bun_sys::windows::libuv as uv;
            // TODO: remove this when tickWithTimeout actually works properly on Windows.
            if debugger.wait_for_connection == Wait::Shortly {
                // SAFETY: uv loop pointer is valid for the VM's lifetime
                unsafe {
                    uv::uv_update_time(this.uv_loop());
                }
                let timer: *mut uv::Timer = Box::into_raw(Box::new(
                    // SAFETY: all-zero is a valid uv::Timer (C struct, initialized by uv_timer_init)
                    unsafe { core::mem::zeroed::<uv::Timer>() },
                ));
                // SAFETY: timer is a freshly allocated uv::Timer
                unsafe {
                    (*timer).init(this.uv_loop());
                }

                extern "C" fn on_debugger_timer(handle: *mut uv::Timer) {
                    let vm = VirtualMachine::get();
                    vm.debugger.as_mut().unwrap().poll_ref.unref(vm);
                    // SAFETY: handle is a live uv_timer_t; uv_close accepts any uv_handle_t*
                    unsafe {
                        uv::uv_close(handle.cast(), Some(deinit_timer));
                    }
                }

                extern "C" fn deinit_timer(handle: *mut c_void) {
                    // SAFETY: handle was allocated via Box::into_raw above
                    drop(unsafe { Box::from_raw(handle.cast::<uv::Timer>()) });
                }

                // SAFETY: timer is initialized; callback is extern "C" with matching signature
                unsafe {
                    (*timer).start(WAIT_FOR_CONNECTION_DELAY_MS, 0, on_debugger_timer);
                    (*timer).ref_();
                }
            }
        }

        while debugger.wait_for_connection != Wait::Off {
            this.event_loop().tick();
            // PORT NOTE: reshaped for borrowck — re-borrow debugger after event_loop() may have mutated VM
            let debugger = this.debugger.as_mut().unwrap();
            match debugger.wait_for_connection {
                Wait::Forever => {
                    this.event_loop().auto_tick_active();

                    if cfg!(feature = "debug_logs") {
                        bun_output::scoped_log!(
                            debugger,
                            "waited: {}",
                            (bun_core::time::nano_timestamp() - bun_cli::start_time()) as i64
                        );
                    }
                }
                Wait::Shortly => {
                    // Handle .incrementRefConcurrently
                    #[cfg(unix)]
                    {
                        let pending_unref = this.pending_unref_counter;
                        if pending_unref > 0 {
                            this.pending_unref_counter = 0;
                            this.uws_loop().unref_count(pending_unref);
                        }
                    }

                    this.uws_loop().tick_with_timeout(&deadline);

                    if cfg!(feature = "debug_logs") {
                        bun_output::scoped_log!(
                            debugger,
                            "waited: {}",
                            (bun_core::time::nano_timestamp() - bun_cli::start_time()) as i64
                        );
                    }

                    let elapsed = bun_core::Timespec::now(bun_core::TimespecClock::ForceRealTime);
                    if elapsed.order(&deadline) != core::cmp::Ordering::Less {
                        debugger.poll_ref.unref(this);
                        bun_output::scoped_log!(debugger, "Timed out waiting for the debugger");
                        break;
                    }
                }
                Wait::Off => {
                    break;
                }
            }
        }

        // deferred from above
        this.debugger.as_mut().unwrap().must_block_until_connected = false;
    }

    pub fn create(
        this: &mut VirtualMachine,
        global_object: &JSGlobalObject,
    ) -> Result<(), bun_core::Error> {
        bun_output::scoped_log!(debugger, "create");
        jsc::mark_binding(core::panic::Location::caller());
        // PORT NOTE: Zig used a non-atomic `var has_created_debugger: bool`; using AtomicBool here
        if !HAS_CREATED_DEBUGGER.swap(true, Ordering::Relaxed) {
            // Zig: doNotOptimizeAway on the export fns to force linkage.
            // In Rust, #[unsafe(no_mangle)] pub extern "C" fns are already retained; no-op.
            let debugger = this.debugger.as_mut().unwrap();
            // SAFETY: global_object is a live JSGlobalObject
            debugger.script_execution_context_id =
                unsafe { Bun__createJSDebugger(global_object as *const _ as *mut _) };
            if !this.has_started_debugger {
                this.has_started_debugger = true;
                // TODO(port): std::thread::spawn — Zig uses std.Thread.spawn; bun_threading may be preferred
                let other_vm = this as *mut VirtualMachine;
                // SAFETY: VirtualMachine outlives the debugger thread (process-lifetime)
                let other_vm_usize = other_vm as usize;
                std::thread::spawn(move || {
                    // SAFETY: pointer was valid when captured and VM is process-lifetime
                    let other_vm = unsafe { &mut *(other_vm_usize as *mut VirtualMachine) };
                    Debugger::start_js_debugger_thread(other_vm);
                });
                // TODO(port): narrow error set — Zig `try std.Thread.spawn` could fail; std::thread panics on failure
            }
            this.event_loop().ensure_waker();

            let debugger = this.debugger.as_mut().unwrap();
            if debugger.wait_for_connection != Wait::Off {
                debugger.poll_ref.ref_(this);
                // PORT NOTE: reshaped for borrowck
                this.debugger.as_mut().unwrap().must_block_until_connected = true;
            }
        }
        Ok(())
    }

    pub fn start_js_debugger_thread(other_vm: &mut VirtualMachine) {
        // TODO(port): MimallocArena — Zig creates a thread-local arena and uses it as the VM allocator.
        // Non-AST crate so the arena param is normally dropped, but here it backs an entire VM.
        // Phase B must decide whether VirtualMachine::init takes an allocator in Rust.
        // PERF(port): was arena bulk-free
        Output::Source::configure_named_thread("Debugger");
        bun_output::scoped_log!(debugger, "startJSDebuggerThread");
        jsc::mark_binding(core::panic::Location::caller());

        // Create a thread-local env_loader to avoid allocator threading violations
        let env_map = Box::new(bun_dotenv::Map::init());
        let env_loader = Box::new(bun_dotenv::Loader::init(Box::leak(env_map)));
        // TODO(port): ownership — Zig allocates these in the arena; here we leak into the VM

        let vm = VirtualMachine::init(jsc::VirtualMachineInitOptions {
            // allocator: dropped (global mimalloc)
            args: bun_schema::api::TransformOptions::default(),
            store_fd: false,
            env_loader: Some(Box::leak(env_loader)),
            ..Default::default()
        })
        .unwrap_or_else(|_| panic!("Failed to create Debugger VM"));
        // vm.allocator / vm.arena assignment dropped — TODO(port): arena ownership

        vm.transpiler
            .configure_defines()
            .unwrap_or_else(|_| panic!("Failed to configure defines"));
        vm.is_main_thread = false;
        vm.event_loop().ensure_waker();

        // TODO(port): jsc.OpaqueWrap — wraps a Rust fn(&mut VirtualMachine) into a C callback
        let callback = jsc::opaque_wrap::<VirtualMachine, _>(start);
        vm.global.vm().hold_api_lock(other_vm, callback);
    }
}

pub static HAS_CREATED_DEBUGGER: AtomicBool = AtomicBool::new(false);

#[unsafe(no_mangle)]
pub extern "C" fn Debugger__didConnect() {
    let this = VirtualMachine::get();
    let debugger = this.debugger.as_mut().unwrap();
    if debugger.wait_for_connection != Wait::Off {
        debugger.wait_for_connection = Wait::Off;
        debugger.poll_ref.unref(this);
        this.event_loop().wakeup();
    }
}

fn start(other_vm: &mut VirtualMachine) {
    jsc::mark_binding(core::panic::Location::caller());

    let this = VirtualMachine::get();
    // PORT NOTE: Zig copies the Debugger struct by value here (`const debugger = other_vm.debugger.?;`)
    let debugger = other_vm.debugger.as_ref().unwrap();
    let loop_ = this.event_loop();

    if !debugger.from_environment_variable.is_empty() {
        let mut url = BunString::clone_utf8(debugger.from_environment_variable);

        loop_.enter();
        let _exit = scopeguard::guard((), |_| loop_.exit());
        // SAFETY: this.global is live; url is a stack-local BunString
        unsafe {
            Bun__startJSDebuggerThread(
                this.global,
                debugger.script_execution_context_id,
                &mut url,
                1,
                debugger.mode == Mode::Connect,
            );
        }
    }

    if let Some(path_or_port) = debugger.path_or_port {
        let mut url = BunString::clone_utf8(path_or_port);

        loop_.enter();
        let _exit = scopeguard::guard((), |_| loop_.exit());
        // SAFETY: this.global is live; url is a stack-local BunString
        unsafe {
            Bun__startJSDebuggerThread(
                this.global,
                debugger.script_execution_context_id,
                &mut url,
                0,
                debugger.mode == Mode::Connect,
            );
        }
    }

    this.global.handle_rejected_promises();

    if !this.log.msgs.as_slice().is_empty() {
        let _ = this.log.print(Output::error_writer());
        Output::pretty_errorln("\n", ());
        Output::flush();
    }

    bun_output::scoped_log!(debugger, "wake");
    FUTEX_ATOMIC.store(0, Ordering::Relaxed);
    bun_threading::futex::wake(&FUTEX_ATOMIC, 1);

    other_vm.event_loop().wakeup();

    this.event_loop().tick();

    other_vm.event_loop().wakeup();

    loop {
        while this.is_event_loop_alive() {
            this.tick();
            this.event_loop().auto_tick_active();
        }

        this.event_loop().tick_possibly_forever();
    }
}

#[derive(Copy, Clone)]
pub struct AsyncTaskTracker {
    pub id: u64,
}

impl AsyncTaskTracker {
    pub fn init(vm: &mut VirtualMachine) -> AsyncTaskTracker {
        AsyncTaskTracker {
            id: vm.next_async_task_id(),
        }
    }

    pub fn did_schedule(self, global_object: &JSGlobalObject) {
        if self.id == 0 {
            return;
        }

        did_schedule_async_call(global_object, AsyncCallType::EventListener, self.id, true);
    }

    pub fn did_cancel(self, global_object: &JSGlobalObject) {
        if self.id == 0 {
            return;
        }

        did_cancel_async_call(global_object, AsyncCallType::EventListener, self.id);
    }

    pub fn will_dispatch(self, global_object: &JSGlobalObject) {
        if self.id == 0 {
            return;
        }

        will_dispatch_async_call(global_object, AsyncCallType::EventListener, self.id);
    }

    pub fn did_dispatch(self, global_object: &JSGlobalObject) {
        if self.id == 0 {
            return;
        }

        did_dispatch_async_call(global_object, AsyncCallType::EventListener, self.id);
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum AsyncCallType {
    DOMTimer = 1,
    EventListener = 2,
    PostMessage = 3,
    RequestAnimationFrame = 4,
    Microtask = 5,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn Debugger__didScheduleAsyncCall(
        global: *mut JSGlobalObject,
        call: AsyncCallType,
        id: u64,
        single_shot: bool,
    );
    fn Debugger__didCancelAsyncCall(global: *mut JSGlobalObject, call: AsyncCallType, id: u64);
    fn Debugger__didDispatchAsyncCall(global: *mut JSGlobalObject, call: AsyncCallType, id: u64);
    fn Debugger__willDispatchAsyncCall(global: *mut JSGlobalObject, call: AsyncCallType, id: u64);
}

pub fn did_schedule_async_call(
    global_object: &JSGlobalObject,
    call: AsyncCallType,
    id: u64,
    single_shot: bool,
) {
    jsc::mark_binding(core::panic::Location::caller());
    // SAFETY: global_object is live
    unsafe {
        Debugger__didScheduleAsyncCall(global_object as *const _ as *mut _, call, id, single_shot);
    }
}
pub fn did_cancel_async_call(global_object: &JSGlobalObject, call: AsyncCallType, id: u64) {
    jsc::mark_binding(core::panic::Location::caller());
    // SAFETY: global_object is live
    unsafe {
        Debugger__didCancelAsyncCall(global_object as *const _ as *mut _, call, id);
    }
}
pub fn did_dispatch_async_call(global_object: &JSGlobalObject, call: AsyncCallType, id: u64) {
    jsc::mark_binding(core::panic::Location::caller());
    // SAFETY: global_object is live
    unsafe {
        Debugger__didDispatchAsyncCall(global_object as *const _ as *mut _, call, id);
    }
}
pub fn will_dispatch_async_call(global_object: &JSGlobalObject, call: AsyncCallType, id: u64) {
    jsc::mark_binding(core::panic::Location::caller());
    // SAFETY: global_object is live
    unsafe {
        Debugger__willDispatchAsyncCall(global_object as *const _ as *mut _, call, id);
    }
}

// ─── TestReporterAgent ────────────────────────────────────────────────────

#[derive(Default)]
pub struct TestReporterAgent {
    pub handle: *mut TestReporterHandle,
}

/// this enum is kept in sync with c++ InspectorTestReporterAgent.cpp `enum class BunTestStatus`
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum TestStatus {
    Pass,
    Fail,
    Timeout,
    Skip,
    Todo,
    SkippedBecauseLabel,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum TestType {
    Test = 0,
    Describe = 1,
}

#[repr(C)]
pub struct TestReporterHandle {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn Bun__TestReporterAgentReportTestFound(
        agent: *mut TestReporterHandle,
        call_frame: *mut CallFrame,
        test_id: c_int,
        name: *mut BunString,
        item_type: TestType,
        parent_id: c_int,
    );
    fn Bun__TestReporterAgentReportTestFoundWithLocation(
        agent: *mut TestReporterHandle,
        test_id: c_int,
        name: *mut BunString,
        item_type: TestType,
        parent_id: c_int,
        source_url: *mut BunString,
        line: c_int,
    );
    fn Bun__TestReporterAgentReportTestStart(agent: *mut TestReporterHandle, test_id: c_int);
    fn Bun__TestReporterAgentReportTestEnd(
        agent: *mut TestReporterHandle,
        test_id: c_int,
        bun_test_status: TestStatus,
        elapsed: f64,
    );
}

impl TestReporterHandle {
    pub fn report_test_found(
        &mut self,
        call_frame: &CallFrame,
        test_id: i32,
        name: &mut BunString,
        item_type: TestType,
        parent_id: i32,
    ) {
        // SAFETY: self is a live C++ handle
        unsafe {
            Bun__TestReporterAgentReportTestFound(
                self,
                call_frame as *const _ as *mut _,
                test_id,
                name,
                item_type,
                parent_id,
            );
        }
    }

    pub fn report_test_found_with_location(
        &mut self,
        test_id: i32,
        name: &mut BunString,
        item_type: TestType,
        parent_id: i32,
        source_url: &mut BunString,
        line: i32,
    ) {
        // SAFETY: self is a live C++ handle
        unsafe {
            Bun__TestReporterAgentReportTestFoundWithLocation(
                self, test_id, name, item_type, parent_id, source_url, line,
            );
        }
    }

    pub fn report_test_start(&mut self, test_id: c_int) {
        // SAFETY: self is a live C++ handle
        unsafe {
            Bun__TestReporterAgentReportTestStart(self, test_id);
        }
    }

    pub fn report_test_end(&mut self, test_id: c_int, bun_test_status: TestStatus, elapsed: f64) {
        // SAFETY: self is a live C++ handle
        unsafe {
            Bun__TestReporterAgentReportTestEnd(self, test_id, bun_test_status, elapsed);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__TestReporterAgentEnable(agent: *mut TestReporterHandle) {
    if let Some(debugger) = VirtualMachine::get().debugger.as_mut() {
        bun_output::scoped_log!(TestReporterAgent, "enable");
        debugger.test_reporter_agent.handle = agent;

        // Retroactively report any tests that were already discovered before the debugger connected
        retroactively_report_discovered_tests(agent);
    }
}

/// When TestReporter.enable is called after test collection has started/finished,
/// we need to retroactively assign test IDs and report discovered tests.
fn retroactively_report_discovered_tests(agent: *mut TestReporterHandle) {
    use bun_jsc::jest::Jest;
    let Some(runner) = Jest::runner() else {
        return;
    };
    let Some(active_file) = runner.bun_test_root.active_file.get() else {
        return;
    };

    // Only report if we're in collection or execution phase (tests have been discovered)
    match active_file.phase {
        bun_jsc::jest::bun_test::Phase::Collection
        | bun_jsc::jest::bun_test::Phase::Execution => {}
        bun_jsc::jest::bun_test::Phase::Done => return,
    }

    // Get the file path for source location info
    let file_path = runner.files.get(active_file.file_id).source.path.text;
    let mut source_url = BunString::init(file_path);

    // Track the maximum ID we assign
    let mut max_id: i32 = 0;

    // Recursively report all discovered tests starting from root scope
    let root_scope = active_file.collection.root_scope;
    retroactively_report_scope(agent, root_scope, -1, &mut max_id, &mut source_url);

    bun_output::scoped_log!(TestReporterAgent, "retroactively reported {} tests", max_id);
}

fn retroactively_report_scope(
    agent: *mut TestReporterHandle,
    scope: &mut bun_jsc::jest::bun_test::DescribeScope,
    parent_id: i32,
    max_id: &mut i32,
    source_url: &mut BunString,
) {
    use bun_jsc::jest::bun_test::ScopeEntry;
    // SAFETY: agent is a live C++ handle (set by Enable above)
    let agent_ref = unsafe { &mut *agent };
    for entry in scope.entries.as_mut_slice() {
        match entry {
            ScopeEntry::Describe(describe) => {
                // Only report and assign ID if not already assigned
                if describe.base.test_id_for_debugger == 0 {
                    *max_id += 1;
                    let test_id = *max_id;
                    // Assign the ID so start/end events will fire during execution
                    describe.base.test_id_for_debugger = test_id;
                    let mut name =
                        BunString::init(describe.base.name.as_deref().unwrap_or(b"(unnamed)"));
                    agent_ref.report_test_found_with_location(
                        test_id,
                        &mut name,
                        TestType::Describe,
                        parent_id,
                        source_url,
                        i32::try_from(describe.base.line_no).unwrap(),
                    );
                    // Recursively report children with this describe as parent
                    retroactively_report_scope(agent, describe, test_id, max_id, source_url);
                } else {
                    // Already has ID, just recurse with existing ID as parent
                    retroactively_report_scope(
                        agent,
                        describe,
                        describe.base.test_id_for_debugger,
                        max_id,
                        source_url,
                    );
                }
            }
            ScopeEntry::TestCallback(test_entry) => {
                // Only report and assign ID if not already assigned
                if test_entry.base.test_id_for_debugger == 0 {
                    *max_id += 1;
                    let test_id = *max_id;
                    // Assign the ID so start/end events will fire during execution
                    test_entry.base.test_id_for_debugger = test_id;
                    let mut name =
                        BunString::init(test_entry.base.name.as_deref().unwrap_or(b"(unnamed)"));
                    agent_ref.report_test_found_with_location(
                        test_id,
                        &mut name,
                        TestType::Test,
                        parent_id,
                        source_url,
                        i32::try_from(test_entry.base.line_no).unwrap(),
                    );
                }
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__TestReporterAgentDisable(_agent: *mut TestReporterHandle) {
    if let Some(debugger) = VirtualMachine::get().debugger.as_mut() {
        bun_output::scoped_log!(TestReporterAgent, "disable");
        debugger.test_reporter_agent.handle = core::ptr::null_mut();
    }
}

impl TestReporterAgent {
    /// Caller must ensure that it is enabled first.
    ///
    /// Since we may have to call .deinit on the name string.
    pub fn report_test_found(
        &self,
        call_frame: &CallFrame,
        test_id: i32,
        name: &mut BunString,
        item_type: TestType,
        parent_id: i32,
    ) {
        bun_output::scoped_log!(TestReporterAgent, "reportTestFound");
        // SAFETY: caller must ensure is_enabled() (handle != null)
        unsafe { &mut *self.handle }.report_test_found(
            call_frame, test_id, name, item_type, parent_id,
        );
    }

    /// Caller must ensure that it is enabled first.
    pub fn report_test_start(&self, test_id: i32) {
        bun_output::scoped_log!(TestReporterAgent, "reportTestStart");
        // SAFETY: caller must ensure is_enabled() (handle != null)
        unsafe { &mut *self.handle }.report_test_start(test_id);
    }

    /// Caller must ensure that it is enabled first.
    pub fn report_test_end(&self, test_id: i32, bun_test_status: TestStatus, elapsed: f64) {
        bun_output::scoped_log!(TestReporterAgent, "reportTestEnd");
        // SAFETY: caller must ensure is_enabled() (handle != null)
        unsafe { &mut *self.handle }.report_test_end(test_id, bun_test_status, elapsed);
    }

    pub fn is_enabled(&self) -> bool {
        !self.handle.is_null()
    }
}

// ─── LifecycleAgent ───────────────────────────────────────────────────────

#[derive(Default)]
pub struct LifecycleAgent {
    pub handle: *mut LifecycleHandle,
}

#[repr(C)]
pub struct LifecycleHandle {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn Bun__LifecycleAgentReportReload(agent: *mut LifecycleHandle);
    fn Bun__LifecycleAgentReportError(agent: *mut LifecycleHandle, exception: *mut ZigException);
    fn Bun__LifecycleAgentPreventExit(agent: *mut LifecycleHandle);
    fn Bun__LifecycleAgentStopPreventingExit(agent: *mut LifecycleHandle);
}

impl LifecycleHandle {
    pub fn prevent_exit(&mut self) {
        // SAFETY: self is a live C++ handle
        unsafe { Bun__LifecycleAgentPreventExit(self) }
    }

    pub fn stop_preventing_exit(&mut self) {
        // SAFETY: self is a live C++ handle
        unsafe { Bun__LifecycleAgentStopPreventingExit(self) }
    }

    pub fn report_reload(&mut self) {
        bun_output::scoped_log!(LifecycleAgent, "reportReload");
        // SAFETY: self is a live C++ handle
        unsafe { Bun__LifecycleAgentReportReload(self) }
    }

    pub fn report_error(&mut self, exception: &mut ZigException) {
        bun_output::scoped_log!(LifecycleAgent, "reportError");
        // SAFETY: self is a live C++ handle
        unsafe { Bun__LifecycleAgentReportError(self, exception) }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__LifecycleAgentEnable(agent: *mut LifecycleHandle) {
    if let Some(debugger) = VirtualMachine::get().debugger.as_mut() {
        bun_output::scoped_log!(LifecycleAgent, "enable");
        debugger.lifecycle_reporter_agent.handle = agent;
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__LifecycleAgentDisable(_agent: *mut LifecycleHandle) {
    if let Some(debugger) = VirtualMachine::get().debugger.as_mut() {
        bun_output::scoped_log!(LifecycleAgent, "disable");
        debugger.lifecycle_reporter_agent.handle = core::ptr::null_mut();
    }
}

impl LifecycleAgent {
    pub fn report_reload(&mut self) {
        if !self.handle.is_null() {
            // SAFETY: handle checked non-null above
            unsafe { &mut *self.handle }.report_reload();
        }
    }

    pub fn report_error(&mut self, exception: &mut ZigException) {
        if !self.handle.is_null() {
            // SAFETY: handle checked non-null above
            unsafe { &mut *self.handle }.report_error(exception);
        }
    }

    pub fn is_enabled(&self) -> bool {
        !self.handle.is_null()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/Debugger.zig (535 lines)
//   confidence: medium
//   todos:      13
//   notes:      MimallocArena-backed VM init in start_js_debugger_thread needs Phase B design; std::thread::spawn used for debugger thread; borrowck reshaping around &mut VirtualMachine + &mut Debugger; bun.timespec/Futex/analytics crate paths guessed; Jest/bun_test types referenced via bun_jsc::jest placeholders.
// ──────────────────────────────────────────────────────────────────────────
