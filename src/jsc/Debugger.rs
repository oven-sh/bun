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
//! VirtualMachine.rs §Dispatch) by the high tier, so the public fns here
//! delegate to the hook table with `TODO(b2)` markers.

use core::cell::UnsafeCell;
use core::ffi::{c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_aio::KeepAlive;
use bun_string::String as BunString;

use crate::virtual_machine::VirtualMachine;
use crate::{self as jsc, CallFrame, JSGlobalObject, ZigException};

bun_core::declare_scope!(debugger, visible);
bun_core::declare_scope!(TestReporterAgent, visible);
bun_core::declare_scope!(LifecycleAgent, visible);

// ──────────────────────────────────────────────────────────────────────────
// Agent types. `HTTPServerAgent` is the real sibling definition (re-exported
// so `Debugger.http_server_agent` carries `next_server_id` state — the
// runtime-tier `notify_server_started` body increments it).
// `BunFrontendDevServerAgent` lives in `bun_runtime`; stored as a raw handle
// pointer here so the `Debugger` struct layout is stable without the forward
// dep. The high tier casts back.
// ──────────────────────────────────────────────────────────────────────────

pub use crate::http_server_agent::HTTPServerAgent;

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

    /// `notifyBundleStart` — calls into C++ if the agent is enabled.
    pub fn notify_bundle_start(
        &self,
        dev_server_id: DebuggerId,
        trigger_files: &mut [crate::String],
    ) {
        if let Some(handle) = core::ptr::NonNull::new(self.handle) {
            // SAFETY: handle is non-null (agent enabled); slice valid for the call.
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyBundleStart(
                    handle.as_ptr(),
                    dev_server_id.get(),
                    trigger_files.as_mut_ptr(),
                    trigger_files.len(),
                )
            }
        }
    }

    /// `notifyBundleComplete` — calls into C++ if the agent is enabled.
    pub fn notify_bundle_complete(&self, dev_server_id: DebuggerId, duration_ms: f64) {
        if let Some(handle) = core::ptr::NonNull::new(self.handle) {
            // SAFETY: handle is non-null (agent enabled).
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyBundleComplete(
                    handle.as_ptr(),
                    dev_server_id.get(),
                    duration_ms,
                )
            }
        }
    }

    /// `notifyBundleFailed` — calls into C++ if the agent is enabled.
    pub fn notify_bundle_failed(
        &self,
        dev_server_id: DebuggerId,
        build_errors_payload_base64: &mut crate::String,
    ) {
        if let Some(handle) = core::ptr::NonNull::new(self.handle) {
            // SAFETY: handle is non-null (agent enabled); payload valid for the call.
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyBundleFailed(
                    handle.as_ptr(),
                    dev_server_id.get(),
                    build_errors_payload_base64,
                )
            }
        }
    }
}

mod ffi {
    unsafe extern "C" {
        pub fn InspectorBunFrontendDevServerAgent__notifyBundleStart(
            agent: *mut core::ffi::c_void,
            dev_server_id: i32,
            trigger_files: *mut crate::String,
            trigger_files_len: usize,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyBundleComplete(
            agent: *mut core::ffi::c_void,
            dev_server_id: i32,
            duration_ms: f64,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyBundleFailed(
            agent: *mut core::ffi::c_void,
            dev_server_id: i32,
            build_errors_payload_base64: *mut crate::String,
        );
    }
}

/// `bun.GenericIndex(i32, Debugger)`
///
/// PORT NOTE: `bun_core::GenericIndex<I, M>` only bounds `I: GenericIndexInt`
/// for unsigned ints, so we hand-roll the `i32` flavor here. The null sentinel
/// is `std.math.maxInt(i32)` (bun.zig:3514), NOT `-1`. `Default` is
/// intentionally NOT derived: `0` is a valid index in spec.
#[repr(transparent)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
pub struct DebuggerId(pub i32);
impl DebuggerId {
    pub const INVALID: Self = Self(i32::MAX);
    #[inline]
    pub const fn new(i: i32) -> Self {
        debug_assert!(i != i32::MAX, "DebuggerId::new: maxInt is reserved for Optional::none");
        Self(i)
    }
    #[inline]
    pub const fn get(self) -> i32 {
        debug_assert!(self.0 != i32::MAX, "DebuggerId::get: corrupted (== none sentinel)");
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
    /// `UnsafeCell` because `DevServer::inspector()` hands out `&mut` to this
    /// agent through a shared `&VirtualMachine` borrow (Zig spec: `*const
    /// DevServer -> *BunFrontendDevServerAgent`, free aliasing). JS-thread
    /// only; callers must not hold overlapping `&mut` borrows.
    pub frontend_dev_server_agent: UnsafeCell<BunFrontendDevServerAgent>,
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
            frontend_dev_server_agent: UnsafeCell::new(BunFrontendDevServerAgent::default()),
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
        jsc::mark_binding();
        // TODO(b2): RuntimeHooks dispatch — `init_runtime_state` calls
        // `configureDebugger()` which subsumes this.
        Ok(())
    }

    /// Debugger-thread entry: build a second `VirtualMachine`, hold the API
    /// lock, run `start()`.
    ///
    /// Spec `Debugger.zig:143` `startJSDebuggerThread`.
    ///
    /// PORT NOTE: `other_vm` is the *parent thread's* VM. The parent thread
    /// continues executing (and mutating that VM) concurrently with this
    /// thread (Debugger.zig:131→134-138, then the wait-loop at zig:79-114).
    /// Taking `&mut VirtualMachine` here would assert exclusive access we do
    /// not have — UB. Spec uses a raw `*VirtualMachine`; we mirror that and
    /// never materialize a `&`/`&mut VirtualMachine` to the foreign-thread VM.
    pub fn start_js_debugger_thread(other_vm: *mut VirtualMachine) {
        // PORT NOTE: Zig `MimallocArena` + thread-local `DotEnv.Loader` are
        // dropped per docs/PORTING.md §Allocators — the global allocator is
        // mimalloc and `InitOptions` no longer carries `allocator`/`env_loader`
        // (those are wired by `RuntimeHooks::init_runtime_state`).
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Debugger"));
        bun_core::scoped_log!(debugger, "startJSDebuggerThread");
        jsc::mark_binding();

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
            // PORT NOTE: forward the raw pointer unchanged — see fn doc above
            // for why we never form `&mut VirtualMachine` to the parent VM.
            Debugger::start(ctx.cast::<VirtualMachine>());
        }
        // SAFETY: `vm.global` set by `init()` (non-null).
        #[allow(deprecated)]
        unsafe { &*vm.global }
            .vm()
            .hold_api_lock(other_vm.cast(), start_trampoline);
    }

    /// Spec `Debugger.zig:182` `start` — runs inside `holdAPILock` on the
    /// debugger thread. Publishes the inspector URL(s), wakes the futex the
    /// parent VM is blocked on, then spins this thread's event loop forever.
    ///
    /// PORT NOTE — aliasing: every `VirtualMachine` / `EventLoop` access here
    /// goes through a raw pointer with a fresh short-lived `&mut *p` formed at
    /// the call site, never bound to a long-lived reference. Reasons:
    ///
    /// 1. `other_vm` is owned by the parent thread (see
    ///    `start_js_debugger_thread` doc); after the futex wake the parent
    ///    resumes its tick loop concurrently. Holding `&mut VirtualMachine`
    ///    across that point is a data race on a `&mut`-covered allocation.
    /// 2. `this.event_loop()` returns a self-pointer into the inline
    ///    `regular_event_loop` field (VirtualMachine.rs:489), so a long-lived
    ///    `&mut EventLoop` overlaps any later `&mut VirtualMachine` use.
    /// 3. `Bun__startJSDebuggerThread` and `tick()` re-enter JS, which calls
    ///    `VirtualMachine::get()` / `event_loop()` and mints fresh `&mut` to
    ///    the same allocations — holding our own across those calls is UB.
    ///
    /// Spec Debugger.zig:185-187 holds raw `*VirtualMachine` / `*EventLoop`
    /// (no exclusivity), which is what we mirror.
    fn start(other_vm: *mut VirtualMachine) {
        jsc::mark_binding();

        // Raw pointers only — see PORT NOTE above.
        let this: *mut VirtualMachine = VirtualMachine::get();
        // SAFETY: `this` is this thread's VM created in
        // `start_js_debugger_thread`; `event_loop()` reads a scalar field.
        let loop_: *mut crate::event_loop::EventLoop = unsafe { (*this).event_loop() };
        // SAFETY: `other_vm` is the parent-thread VM, live for process
        // lifetime. We read its `event_loop` self-pointer once *before* the
        // futex wake (while the parent is still blocked / not yet past the
        // wait-loop) and reuse the raw pointer for the cross-thread `wakeup()`
        // calls below. `wakeup()` takes `&self` and is the documented
        // thread-safe path (event_loop.rs:779).
        let other_loop: *mut crate::event_loop::EventLoop = unsafe { (*other_vm).event_loop() };
        // SAFETY: `this.global` set by `init()` (non-null).
        let global: *mut JSGlobalObject = unsafe { (*this).global };

        // PORT NOTE: copy the four scalars we need from the parent VM's
        // debugger before re-entering JS or waking the parent. Spec `.?` would
        // safety-panic, but we run inside an `extern "C"` trampoline where
        // unwinding is UB — wake the parent and bail instead (unreachable in
        // practice; `create()` always populates `debugger` before spawning).
        // SAFETY: `other_vm` live; short-lived shared borrow of `debugger`
        // ends before any other access to `*other_vm`.
        let (ctx_id, is_connect, from_env, path_or_port) =
            match unsafe { (*other_vm).debugger.as_deref() } {
                Some(d) => (
                    d.script_execution_context_id,
                    d.mode == Mode::Connect,
                    d.from_environment_variable,
                    d.path_or_port,
                ),
                None => {
                    FUTEX_ATOMIC.store(0, Ordering::Relaxed);
                    bun_threading::Futex::wake(&FUTEX_ATOMIC, 1);
                    return;
                }
            };

        if !from_env.is_empty() {
            let mut url = BunString::clone_utf8(from_env);
            // SAFETY: `loop_` is this thread's EventLoop; short-lived `&mut`.
            unsafe { (*loop_).enter() };
            // SAFETY: `global` non-null; `url` lives across the call (C++
            // clones it).
            unsafe { Bun__startJSDebuggerThread(global, ctx_id, &mut url, 1, is_connect) };
            // SAFETY: see above.
            unsafe { (*loop_).exit() };
        }

        if let Some(path_or_port) = path_or_port {
            let mut url = BunString::clone_utf8(path_or_port);
            // SAFETY: see above.
            unsafe { (*loop_).enter() };
            // SAFETY: see above.
            unsafe { Bun__startJSDebuggerThread(global, ctx_id, &mut url, 0, is_connect) };
            // SAFETY: see above.
            unsafe { (*loop_).exit() };
        }

        // SAFETY: `global` non-null.
        unsafe { &*global }.handle_rejected_promises();

        // SAFETY: `this` is this thread's VM; short-lived shared read of `log`.
        if let Some(log) = unsafe { (*this).log } {
            // SAFETY: `log` is the `Box::leak`ed per-VM `logger::Log` from
            // `VirtualMachine::init`; outlives the VM.
            let log = unsafe { log.as_ref() };
            if !log.msgs.is_empty() {
                let _ = log.print(bun_core::Output::error_writer() as *mut bun_core::io::Writer);
                bun_core::pretty_errorln!("\n");
                bun_core::Output::flush();
            }
        }

        bun_core::scoped_log!(debugger, "wake");
        FUTEX_ATOMIC.store(0, Ordering::Relaxed);
        bun_threading::Futex::wake(&FUTEX_ATOMIC, 1);

        // SAFETY: `other_loop` is the parent VM's event loop, live for process
        // lifetime; `wakeup()` takes `&self` and is thread-safe.
        unsafe { (*other_loop).wakeup() };
        // Spec re-reads `this.eventLoop()` here (zig:219) rather than reusing
        // the cached `loop` — `vm.event_loop` may have flipped between
        // `regular_event_loop` and `macro_event_loop` inside the re-entrant JS
        // above. SAFETY: short-lived `&mut` per call.
        unsafe { (*(*this).event_loop()).tick() };
        // SAFETY: see above.
        unsafe { (*other_loop).wakeup() };

        loop {
            // SAFETY: `this` is this thread's VM; each call forms a fresh
            // short-lived `&`/`&mut` so re-entrant JS inside `tick()` may
            // independently call `VirtualMachine::get()` without aliasing.
            while unsafe { (*this).is_event_loop_alive() } {
                unsafe { (*this).tick() };
                // SAFETY: `event_loop()` slot stable for VM lifetime.
                unsafe { (*(*this).event_loop()).auto_tick_active() };
            }
            // SAFETY: see above.
            unsafe { (*(*this).event_loop()).tick_possibly_forever() };
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
// PORT NOTE: a Phase-A draft `mod __phase_a_body` previously lived here with
// duplicate `impl Debugger` bodies for `wait_for_debugger_if_necessary` /
// `create` / `start_js_debugger_thread` / `start`. Its cfg gate was stripped
// per PORTING.md §Forbidden but the module body was not deleted, causing
// E0592 duplicate inherent definitions against the live impls above. Removed
// outright; see Debugger.zig:31-231 for the spec bodies the high tier ports.
// ──────────────────────────────────────────────────────────────────────────

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
        global: *const JSGlobalObject,
        call: AsyncCallType,
        id: u64,
        single_shot: bool,
    );
    fn Debugger__didCancelAsyncCall(global: *const JSGlobalObject, call: AsyncCallType, id: u64);
    fn Debugger__didDispatchAsyncCall(global: *const JSGlobalObject, call: AsyncCallType, id: u64);
    fn Debugger__willDispatchAsyncCall(global: *const JSGlobalObject, call: AsyncCallType, id: u64);
}

pub fn did_schedule_async_call(
    global_object: &JSGlobalObject,
    call: AsyncCallType,
    id: u64,
    single_shot: bool,
) {
    jsc::mark_binding();
    // SAFETY: `global_object` is a live opaque JSC handle (ZST on the Rust side);
    // any mutation happens in C++-owned memory outside Rust's aliasing model.
    unsafe {
        Debugger__didScheduleAsyncCall(global_object, call, id, single_shot);
    }
}
pub fn did_cancel_async_call(global_object: &JSGlobalObject, call: AsyncCallType, id: u64) {
    jsc::mark_binding();
    // SAFETY: `global_object` is a live opaque JSC handle (ZST on the Rust side);
    // any mutation happens in C++-owned memory outside Rust's aliasing model.
    unsafe {
        Debugger__didCancelAsyncCall(global_object, call, id);
    }
}
pub fn did_dispatch_async_call(global_object: &JSGlobalObject, call: AsyncCallType, id: u64) {
    jsc::mark_binding();
    // SAFETY: `global_object` is a live opaque JSC handle (ZST on the Rust side);
    // any mutation happens in C++-owned memory outside Rust's aliasing model.
    unsafe {
        Debugger__didDispatchAsyncCall(global_object, call, id);
    }
}
pub fn will_dispatch_async_call(global_object: &JSGlobalObject, call: AsyncCallType, id: u64) {
    jsc::mark_binding();
    // SAFETY: `global_object` is a live opaque JSC handle (ZST on the Rust side);
    // any mutation happens in C++-owned memory outside Rust's aliasing model.
    unsafe {
        Debugger__willDispatchAsyncCall(global_object, call, id);
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
        call_frame: *const CallFrame,
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
        // SAFETY: `self` is a live C++ handle; `call_frame` is an opaque JSC
        // register-file pointer (ZST on the Rust side) that C++ only reads to
        // extract source-location info — no Rust-visible bytes are mutated.
        unsafe {
            Bun__TestReporterAgentReportTestFound(
                self,
                call_frame,
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
