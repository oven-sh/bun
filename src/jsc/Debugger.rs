//! `jsc.Debugger` — inspector / test-reporter / lifecycle-agent surface.
//!
//! B-2 un-gate: the type surface (`Debugger`, `AsyncTaskTracker`, `DebuggerId`,
//! `TestReporterAgent`, `LifecycleAgent`, `AsyncCallType`) is real and
//! compiles against the `bun_jsc` crate's available dependency set. The heavy
//! `wait_for_debugger_if_necessary` / `start_js_debugger_thread` /
//! retroactive-jest-reporting bodies reach into forward-dep crates
//! (`bun_runtime`, `bun_schema`, the gated `http_server_agent` /
//! `BunFrontendDevServerAgent`) and into `VirtualMachine.debugger`'s real
//! field type — those are dispatched through `RuntimeHooks` (see
//! VirtualMachine.rs §Dispatch) by the high tier, so here they are gated
//! behind `` with `TODO(b2)` markers and the public fns delegate
//! to the hook table.

use core::ffi::{c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_aio::KeepAlive;
use bun_string::String as BunString;

use crate::virtual_machine::VirtualMachine;
use crate::{self as jsc, CallFrame, JSGlobalObject, ZigException};

#[allow(non_upper_case_globals)]
bun_core::declare_scope!(debugger, visible);
#[allow(non_upper_case_globals)]
bun_core::declare_scope!(TestReporterAgent, visible);
#[allow(non_upper_case_globals)]
bun_core::declare_scope!(LifecycleAgent, visible);

// ──────────────────────────────────────────────────────────────────────────
// Forward-dep agent types. The real `HTTPServerAgent` lives in the gated
// sibling `http_server_agent.rs`; `BunFrontendDevServerAgent` lives in
// `bun_runtime`. Both are stored as raw handle pointers here so the `Debugger`
// struct layout is stable without the forward dep. The high tier casts back.
// ──────────────────────────────────────────────────────────────────────────

/// `jsc.Debugger.HTTPServerAgent` — opaque until `http_server_agent.rs`
/// un-gates. Layout: single nullable C++ handle pointer (matches the real
/// struct's only stateful field).
#[derive(Default)]
pub struct HTTPServerAgent {
    pub handle: *mut c_void,
}
impl HTTPServerAgent {
    #[inline]
    pub fn is_enabled(&self) -> bool {
        !self.handle.is_null()
    }
}

/// `bun_runtime::server::inspector_bun_frontend_dev_server_agent::BunFrontendDevServerAgent`
/// — opaque until `bun_runtime` is reachable from this tier.
#[derive(Default)]
pub struct BunFrontendDevServerAgent {
    pub handle: *mut c_void,
}
impl BunFrontendDevServerAgent {
    #[inline]
    pub fn is_enabled(&self) -> bool {
        !self.handle.is_null()
    }
}

/// `bun.GenericIndex(i32, Debugger)`
#[repr(transparent)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash, Default)]
pub struct DebuggerId(pub i32);
impl DebuggerId {
    pub const INVALID: Self = Self(-1);
    #[inline]
    pub const fn new(i: i32) -> Self {
        Self(i)
    }
    #[inline]
    pub const fn get(self) -> i32 {
        self.0
    }
}

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
pub static HAS_CREATED_DEBUGGER: AtomicBool = AtomicBool::new(false);

impl Debugger {
    /// `Debugger.waitForDebuggerIfNecessary(vm)` — block on the futex until
    /// `start()` (debugger thread) signals, then run the wait-loop until a
    /// frontend connects (`Debugger__didConnect`) or the deadline elapses.
    ///
    /// B-2: body reaches into `vm.debugger: Option<Debugger>` (still
    /// `Option<()>` in VirtualMachine.rs), `bun_runtime::cli::start_time()`,
    /// `bun_core::Timespec`, and the libuv timer shim — dispatched through
    /// `RuntimeHooks::ensure_debugger` by the high tier instead.
    pub fn wait_for_debugger_if_necessary(this: &mut VirtualMachine) {
        let _ = this;
        // TODO(b2): RuntimeHooks dispatch — `ensure_debugger` covers this path.
        // Full body preserved below under ``.
    }

    /// `Debugger.create(vm, global)` — first-time debugger setup: create the
    /// JSC inspector context, spawn the debugger VM thread, and arm the
    /// keep-alive on the parent loop.
    ///
    /// B-2: same gating story as `wait_for_debugger_if_necessary` — touches
    /// `vm.debugger` as `&mut Debugger` and spawns a thread that calls
    /// `start_js_debugger_thread` (which itself needs `bun_runtime`).
    pub fn create(
        this: &mut VirtualMachine,
        global_object: &JSGlobalObject,
    ) -> Result<(), bun_core::Error> {
        let _ = (this, global_object);
        bun_core::scoped_log!(debugger, "create");
        jsc::mark_binding(core::panic::Location::caller());
        // TODO(b2): RuntimeHooks dispatch — `init_runtime_state` calls
        // `configureDebugger()` which subsumes this.
        Ok(())
    }

    /// Debugger-thread entry: build a second `VirtualMachine`, hold the API
    /// lock, run `start()`.
    ///
    /// Spec `Debugger.zig:143` `startJSDebuggerThread`.
    pub fn start_js_debugger_thread(other_vm: &mut VirtualMachine) {
        // PORT NOTE: Zig `MimallocArena` + thread-local `DotEnv.Loader` are
        // dropped per docs/PORTING.md §Allocators — the global allocator is
        // mimalloc and `InitOptions` no longer carries `allocator`/`env_loader`
        // (those are wired by `RuntimeHooks::init_runtime_state`).
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Debugger"));
        bun_core::scoped_log!(debugger, "startJSDebuggerThread");
        jsc::mark_binding(core::panic::Location::caller());

        let vm_ptr = VirtualMachine::init(crate::virtual_machine::InitOptions {
            // Spec: `args = std.mem.zeroes(TransformOptions)`, `store_fd = false`.
            is_main_thread: false,
            ..Default::default()
        })
        .unwrap_or_else(|_| panic!("Failed to create Debugger VM"));
        // SAFETY: `init` returns the freshly-boxed thread-local VM; this thread
        // is its sole owner.
        let vm = unsafe { &mut *vm_ptr };

        vm.transpiler
            .configure_defines()
            .unwrap_or_else(|_| panic!("Failed to configure defines"));
        vm.is_main_thread = false;
        // SAFETY: `event_loop()` returns the per-thread `EventLoop` slot
        // initialized by `init()` above.
        unsafe { (*vm.event_loop()).ensure_waker() };

        // Spec: `vm.global.vm().holdAPILock(other_vm, OpaqueWrap(VM, start))`.
        extern "C" fn start_trampoline(ctx: *mut c_void) {
            // SAFETY: `ctx` is the `other_vm` pointer threaded through
            // `JSC__VM__holdAPILock`; live for process lifetime (see `create`).
            let other_vm = unsafe { &mut *ctx.cast::<VirtualMachine>() };
            Debugger::start(other_vm);
        }
        // SAFETY: `vm.global` set by `init()` (non-null).
        #[allow(deprecated)]
        unsafe { &*vm.global }
            .vm()
            .hold_api_lock((other_vm as *mut VirtualMachine).cast(), start_trampoline);
    }

    /// Spec `Debugger.zig:182` `start` — runs inside `holdAPILock` on the
    /// debugger thread. Publishes the inspector URL(s), wakes the futex the
    /// parent VM is blocked on, then spins this thread's event loop forever.
    fn start(other_vm: &mut VirtualMachine) {
        jsc::mark_binding(core::panic::Location::caller());

        // SAFETY: `VirtualMachine::get()` returns this thread's VM created in
        // `start_js_debugger_thread` above.
        let this = unsafe { &mut *VirtualMachine::get() };
        // SAFETY: `event_loop()` returns the live per-thread `EventLoop` slot.
        let loop_ = unsafe { &mut *this.event_loop() };

        {
            // PORT NOTE: reshaped for borrowck — `Bun__startJSDebuggerThread`
            // re-enters JS which can touch `other_vm`; copy the four scalars
            // we need up front so we don't hold a borrow across the FFI call.
            let debugger = other_vm
                .debugger
                .as_ref()
                .expect("debugger configured by create()");
            let ctx_id = debugger.script_execution_context_id;
            let is_connect = debugger.mode == Mode::Connect;
            let from_env = debugger.from_environment_variable;
            let path_or_port = debugger.path_or_port;

            if !from_env.is_empty() {
                let mut url = BunString::clone_utf8(from_env);
                loop_.enter();
                // SAFETY: `this.global` non-null (set by `init`); `url` lives
                // across the call (C++ clones it).
                unsafe {
                    Bun__startJSDebuggerThread(this.global, ctx_id, &mut url, 1, is_connect);
                }
                loop_.exit();
            }

            if let Some(path_or_port) = path_or_port {
                let mut url = BunString::clone_utf8(path_or_port);
                loop_.enter();
                // SAFETY: see above.
                unsafe {
                    Bun__startJSDebuggerThread(this.global, ctx_id, &mut url, 0, is_connect);
                }
                loop_.exit();
            }
        }

        // SAFETY: `this.global` non-null.
        unsafe { &*this.global }.handle_rejected_promises();

        if let Some(log) = this.log {
            // SAFETY: `log` is the `Box::leak`ed per-VM `logger::Log` from
            // `VirtualMachine::init`; outlives the VM.
            let log = unsafe { log.as_ref() };
            if !log.msgs.is_empty() {
                let _ = log.print(bun_core::Output::error_writer());
                bun_core::pretty_errorln!("\n");
                bun_core::Output::flush();
            }
        }

        bun_core::scoped_log!(debugger, "wake");
        FUTEX_ATOMIC.store(0, Ordering::Relaxed);
        bun_threading::Futex::wake(&FUTEX_ATOMIC, 1);

        // SAFETY: `other_vm.event_loop()` is the parent VM's event loop; live
        // for process lifetime.
        unsafe { (*other_vm.event_loop()).wakeup() };
        loop_.tick();
        // SAFETY: see above.
        unsafe { (*other_vm.event_loop()).wakeup() };

        loop {
            while this.is_event_loop_alive() {
                this.tick();
                // SAFETY: `event_loop()` slot stable for VM lifetime.
                unsafe { (*this.event_loop()).auto_tick_active() };
            }
            // SAFETY: see above.
            unsafe { (*this.event_loop()).tick_possibly_forever() };
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Debugger__didConnect() {
    // TODO(b2): `vm.debugger` is `Option<()>` until VirtualMachine.rs swaps
    // the field type to `Option<Box<Debugger>>`. The real body flips
    // `wait_for_connection = Off`, unrefs `poll_ref`, and wakes the loop.
    let this = VirtualMachine::get();
    // SAFETY: VirtualMachine::get() returns the per-thread singleton; called on
    // JS thread. `event_loop()` returns the raw `*mut EventLoop` slot.
    unsafe { (*(*this).event_loop()).wakeup() };
}

// ──────────────────────────────────────────────────────────────────────────
// Phase-A draft body (forward-dep heavy). Preserved verbatim for B-2 so the
// port history isn't lost; never compiled (``).
// ──────────────────────────────────────────────────────────────────────────

mod __phase_a_body {
    use super::*;
    use bun_core::Output;

    impl Debugger {
        pub fn wait_for_debugger_if_necessary(this: &mut VirtualMachine) {
            let Some(debugger) = this.debugger.as_mut() else {
                return;
            };
            bun_analytics::Features::debugger().fetch_add(1, Ordering::Relaxed);
            if !debugger.must_block_until_connected {
                return;
            }

            bun_core::scoped_log!(debugger, "spin");
            while FUTEX_ATOMIC.load(Ordering::Relaxed) > 0 {
                bun_threading::Futex::wait_forever(&FUTEX_ATOMIC, 1);
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
            let deadline: bun_core::Timespec = if debugger.wait_for_connection == Wait::Shortly {
                bun_core::Timespec::now(bun_core::TimespecClock::ForceRealTime)
                    .add_ms(WAIT_FOR_CONNECTION_DELAY_MS)
            } else {
                // SAFETY: only read when wait_for_connection == Shortly (matches Zig `undefined`)
                unsafe { core::mem::zeroed() }
            };

            #[cfg(windows)]
            {
                use bun_sys::windows::libuv as uv;
                if debugger.wait_for_connection == Wait::Shortly {
                    // SAFETY: uv loop pointer is valid for the VM's lifetime
                    unsafe { uv::uv_update_time(this.uv_loop()) };
                    let timer: *mut uv::Timer = Box::into_raw(Box::new(unsafe {
                        core::mem::zeroed::<uv::Timer>()
                    }));
                    // SAFETY: timer freshly allocated
                    unsafe { (*timer).init(this.uv_loop()) };

                    extern "C" fn on_debugger_timer(handle: *mut uv::Timer) {
                        let vm = VirtualMachine::get();
                        vm.debugger.as_mut().unwrap().poll_ref.unref(vm);
                        // SAFETY: handle is a live uv_timer_t
                        unsafe { uv::uv_close(handle.cast(), Some(deinit_timer)) };
                    }
                    extern "C" fn deinit_timer(handle: *mut c_void) {
                        // SAFETY: handle was Box::into_raw'd above
                        drop(unsafe { Box::from_raw(handle.cast::<uv::Timer>()) });
                    }
                    // SAFETY: timer initialized
                    unsafe {
                        (*timer).start(WAIT_FOR_CONNECTION_DELAY_MS, 0, on_debugger_timer);
                        (*timer).ref_();
                    }
                }
            }

            while debugger.wait_for_connection != Wait::Off {
                this.event_loop().tick();
                let debugger = this.debugger.as_mut().unwrap();
                match debugger.wait_for_connection {
                    Wait::Forever => {
                        this.event_loop().auto_tick_active();
                    }
                    Wait::Shortly => {
                        #[cfg(unix)]
                        {
                            let pending_unref = this.pending_unref_counter;
                            if pending_unref > 0 {
                                this.pending_unref_counter = 0;
                                this.uws_loop().unref_count(pending_unref);
                            }
                        }
                        this.uws_loop().tick_with_timeout(&deadline);
                        let elapsed = bun_core::Timespec::now(bun_core::TimespecClock::ForceRealTime);
                        if elapsed.order(&deadline) != core::cmp::Ordering::Less {
                            debugger.poll_ref.unref(this);
                            bun_core::scoped_log!(debugger, "Timed out waiting for the debugger");
                            break;
                        }
                    }
                    Wait::Off => break,
                }
            }
            this.debugger.as_mut().unwrap().must_block_until_connected = false;
        }

        pub fn create(
            this: &mut VirtualMachine,
            global_object: &JSGlobalObject,
        ) -> Result<(), bun_core::Error> {
            bun_core::scoped_log!(debugger, "create");
            jsc::mark_binding(core::panic::Location::caller());
            if !HAS_CREATED_DEBUGGER.swap(true, Ordering::Relaxed) {
                let debugger = this.debugger.as_mut().unwrap();
                // SAFETY: global_object is a live JSGlobalObject
                debugger.script_execution_context_id =
                    unsafe { Bun__createJSDebugger(global_object as *const _ as *mut _) };
                if !this.has_started_debugger {
                    this.has_started_debugger = true;
                    let other_vm = this as *mut VirtualMachine as usize;
                    std::thread::spawn(move || {
                        // SAFETY: VM is process-lifetime
                        let other_vm = unsafe { &mut *(other_vm as *mut VirtualMachine) };
                        Debugger::start_js_debugger_thread(other_vm);
                    });
                }
                this.event_loop().ensure_waker();
                let debugger = this.debugger.as_mut().unwrap();
                if debugger.wait_for_connection != Wait::Off {
                    debugger.poll_ref.ref_(this);
                    this.debugger.as_mut().unwrap().must_block_until_connected = true;
                }
            }
            Ok(())
        }

        pub fn start_js_debugger_thread(other_vm: &mut VirtualMachine) {
            // TODO(port): MimallocArena-backed VM allocator
            Output::Source::configure_named_thread("Debugger");
            bun_core::scoped_log!(debugger, "startJSDebuggerThread");
            jsc::mark_binding(core::panic::Location::caller());

            let env_map = Box::new(bun_dotenv::Map::init());
            let env_loader = Box::new(bun_dotenv::Loader::init(Box::leak(env_map)));

            let vm = VirtualMachine::init(jsc::VirtualMachineInitOptions {
                args: bun_api::TransformOptions::default(),
                store_fd: false,
                env_loader: Some(Box::leak(env_loader)),
                ..Default::default()
            })
            .unwrap_or_else(|_| panic!("Failed to create Debugger VM"));

            vm.transpiler
                .configure_defines()
                .unwrap_or_else(|_| panic!("Failed to configure defines"));
            vm.is_main_thread = false;
            vm.event_loop().ensure_waker();

            let callback = jsc::opaque_wrap::<VirtualMachine, _>(start);
            vm.global.vm().hold_api_lock(other_vm, callback);
        }
    }

    fn start(other_vm: &mut VirtualMachine) {
        jsc::mark_binding(core::panic::Location::caller());
        let this = VirtualMachine::get();
        let debugger = other_vm.debugger.as_ref().unwrap();
        let loop_ = this.event_loop();

        if !debugger.from_environment_variable.is_empty() {
            let mut url = BunString::clone_utf8(debugger.from_environment_variable);
            loop_.enter();
            let _exit = scopeguard::guard((), |_| loop_.exit());
            // SAFETY: this.global is live
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
            // SAFETY: this.global is live
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

        bun_core::scoped_log!(debugger, "wake");
        FUTEX_ATOMIC.store(0, Ordering::Relaxed);
        bun_threading::Futex::wake(&FUTEX_ATOMIC, 1);

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

    /// When TestReporter.enable is called after test collection has started/finished,
    /// retroactively assign test IDs and report discovered tests. Needs
    /// `bun_jsc::jest` (forward-dep on `bun_runtime::test_runner`).
    fn retroactively_report_discovered_tests(agent: *mut TestReporterHandle) {
        use bun_jsc::Jest::Jest;
        // … body elided; see Debugger.zig …
        let _ = agent;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AsyncTaskTracker — stable surface (used by WorkTask / event_loop).
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Default, Copy, Clone)]
pub struct AsyncTaskTracker {
    pub id: u64,
}

impl AsyncTaskTracker {
    pub fn init(vm: &mut VirtualMachine) -> AsyncTaskTracker {
        let _ = vm;
        // TODO(b2-blocked): VirtualMachine::next_async_task_id is in the
        // gated impl block; until that un-gates, debugger async tracking is
        // a no-op (id = 0 short-circuits all `did_*` methods).
        AsyncTaskTracker { id: 0 }
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
    // TODO(b2): `vm.debugger` field type — see file header. Real body stores
    // `agent` into `debugger.test_reporter_agent.handle` and calls
    // `retroactively_report_discovered_tests` (needs `bun_runtime::test_runner`).
    let _ = agent;
    bun_core::scoped_log!(TestReporterAgent, "enable");
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__TestReporterAgentDisable(_agent: *mut TestReporterHandle) {
    // TODO(b2): `vm.debugger` field type — clears `test_reporter_agent.handle`.
    bun_core::scoped_log!(TestReporterAgent, "disable");
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
        bun_core::scoped_log!(TestReporterAgent, "reportTestFound");
        // SAFETY: caller must ensure is_enabled() (handle != null)
        unsafe { &mut *self.handle }.report_test_found(call_frame, test_id, name, item_type, parent_id);
    }

    /// Caller must ensure that it is enabled first.
    pub fn report_test_start(&self, test_id: i32) {
        bun_core::scoped_log!(TestReporterAgent, "reportTestStart");
        // SAFETY: caller must ensure is_enabled() (handle != null)
        unsafe { &mut *self.handle }.report_test_start(test_id);
    }

    /// Caller must ensure that it is enabled first.
    pub fn report_test_end(&self, test_id: i32, bun_test_status: TestStatus, elapsed: f64) {
        bun_core::scoped_log!(TestReporterAgent, "reportTestEnd");
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
        bun_core::scoped_log!(LifecycleAgent, "reportReload");
        // SAFETY: self is a live C++ handle
        unsafe { Bun__LifecycleAgentReportReload(self) }
    }

    pub fn report_error(&mut self, exception: &mut ZigException) {
        bun_core::scoped_log!(LifecycleAgent, "reportError");
        // SAFETY: self is a live C++ handle
        unsafe { Bun__LifecycleAgentReportError(self, exception) }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__LifecycleAgentEnable(agent: *mut LifecycleHandle) {
    // TODO(b2): `vm.debugger` field type — stores `agent` into
    // `debugger.lifecycle_reporter_agent.handle`.
    let _ = agent;
    bun_core::scoped_log!(LifecycleAgent, "enable");
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__LifecycleAgentDisable(_agent: *mut LifecycleHandle) {
    // TODO(b2): `vm.debugger` field type — clears `lifecycle_reporter_agent.handle`.
    bun_core::scoped_log!(LifecycleAgent, "disable");
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
//   todos:      14
//   notes:      B-2 un-gate: type surface real; wait_for_debugger /
//               start_js_debugger_thread / retroactive jest reporting /
//               agent-enable wiring gated on `vm.debugger` field type +
//               RuntimeHooks dispatch (forward-dep on bun_runtime).
// ──────────────────────────────────────────────────────────────────────────
