//! `jsc.Debugger` — inspector / test-reporter / lifecycle-agent surface.
//!
//! Type surface (`Debugger`, `AsyncTaskTracker`, `DebuggerId`,
//! `TestReporterAgent`, `LifecycleAgent`, `AsyncCallType`) is real and
//! compiles against the `bun_jsc` crate's available dependency set.
//! `retroactively_report_discovered_tests` reaches into the `bun:test` runner
//! (`bun_runtime::test_runner`) — a forward-dep cycle — so it dispatches
//! through [`RuntimeHooks::retroactively_report_discovered_tests`].

use core::cell::UnsafeCell;
use core::ffi::{c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_aio::posix_event_loop::{get_vm_ctx, AllocatorType};
use bun_aio::KeepAlive;
use bun_string::String as BunString;

use crate::virtual_machine::{runtime_hooks, VirtualMachine};
use crate::{self as jsc, CallFrame, JSGlobalObject, ZigException};

bun_core::declare_scope!(debugger, visible);
bun_core::declare_scope!(TestReporterAgent, visible);
bun_core::declare_scope!(LifecycleAgent, visible);

// ──────────────────────────────────────────────────────────────────────────
// Agent types. `HTTPServerAgent` is the real sibling definition (re-exported
// so `Debugger.http_server_agent` carries `next_server_id` state).
// `BunFrontendDevServerAgent` is defined HERE (the canonical definition) —
// it carries `next_inspector_connection_id` state inline in `Debugger`, so
// it must live in this crate. Spec source:
// `src/runtime/server/InspectorBunFrontendDevServerAgent.zig`.
// ──────────────────────────────────────────────────────────────────────────

pub use crate::http_server_agent::HTTPServerAgent;

/// Opaque C++ `InspectorBunFrontendDevServerAgent` handle.
#[repr(C)]
pub struct InspectorBunFrontendDevServerAgentHandle {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

/// `BunFrontendDevServerAgent` — stored inline in `Debugger`. The two
/// high-tier types the Zig spec referenced (`DevServer.RouteBundle.Index` in
/// `notifyClientNavigated`, `DevServer.ConsoleLogKind` in `notifyConsoleLog`)
/// are forward deps; both reduce to `i32` / `u8` at the C++ FFI boundary, so
/// callers in `bun_runtime` resolve them before calling.
pub struct BunFrontendDevServerAgent {
    pub next_inspector_connection_id: i32,
    pub handle: *mut InspectorBunFrontendDevServerAgentHandle,
}

impl Default for BunFrontendDevServerAgent {
    fn default() -> Self {
        Self { next_inspector_connection_id: 0, handle: core::ptr::null_mut() }
    }
}

impl BunFrontendDevServerAgent {
    /// `nextConnectionID` — wrapping post-increment.
    pub fn next_connection_id(&mut self) -> i32 {
        let id = self.next_inspector_connection_id;
        self.next_inspector_connection_id = self.next_inspector_connection_id.wrapping_add(1);
        id
    }

    #[inline]
    pub fn is_enabled(&self) -> bool {
        !self.handle.is_null()
    }

    pub fn notify_client_connected(&self, dev_server_id: DebuggerId, connection_id: i32) {
        if let Some(handle) = core::ptr::NonNull::new(self.handle) {
            // SAFETY: handle non-null (agent enabled by C++).
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyClientConnected(
                    handle.as_ptr(),
                    dev_server_id.get(),
                    connection_id,
                )
            }
        }
    }

    pub fn notify_client_disconnected(&self, dev_server_id: DebuggerId, connection_id: i32) {
        if let Some(handle) = core::ptr::NonNull::new(self.handle) {
            // SAFETY: handle non-null (agent enabled by C++).
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyClientDisconnected(
                    handle.as_ptr(),
                    dev_server_id.get(),
                    connection_id,
                )
            }
        }
    }

    pub fn notify_bundle_start(&self, dev_server_id: DebuggerId, trigger_files: &mut [BunString]) {
        if let Some(handle) = core::ptr::NonNull::new(self.handle) {
            // SAFETY: handle non-null; slice valid for the call.
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

    pub fn notify_bundle_complete(&self, dev_server_id: DebuggerId, duration_ms: f64) {
        if let Some(handle) = core::ptr::NonNull::new(self.handle) {
            // SAFETY: handle non-null (agent enabled by C++).
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyBundleComplete(
                    handle.as_ptr(),
                    dev_server_id.get(),
                    duration_ms,
                )
            }
        }
    }

    pub fn notify_bundle_failed(
        &self,
        dev_server_id: DebuggerId,
        build_errors_payload_base64: &mut BunString,
    ) {
        if let Some(handle) = core::ptr::NonNull::new(self.handle) {
            // SAFETY: handle non-null; payload valid for the call.
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyBundleFailed(
                    handle.as_ptr(),
                    dev_server_id.get(),
                    build_errors_payload_base64,
                )
            }
        }
    }

    /// `notifyClientNavigated`. `route_bundle_id` is the pre-resolved
    /// `DevServer.RouteBundle.Index` (`-1` for `None`) — caller in
    /// `bun_runtime` does `rbi.map(|i| i.get() as i32).unwrap_or(-1)`.
    pub fn notify_client_navigated(
        &self,
        dev_server_id: DebuggerId,
        connection_id: i32,
        url: &mut BunString,
        route_bundle_id: i32,
    ) {
        if let Some(handle) = core::ptr::NonNull::new(self.handle) {
            // SAFETY: handle non-null; url valid for the call.
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyClientNavigated(
                    handle.as_ptr(),
                    dev_server_id.get(),
                    connection_id,
                    url,
                    route_bundle_id,
                )
            }
        }
    }

    pub fn notify_client_error_reported(
        &self,
        dev_server_id: DebuggerId,
        client_error_payload_base64: &mut BunString,
    ) {
        if let Some(handle) = core::ptr::NonNull::new(self.handle) {
            // SAFETY: handle non-null; payload valid for the call.
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyClientErrorReported(
                    handle.as_ptr(),
                    dev_server_id.get(),
                    client_error_payload_base64,
                )
            }
        }
    }

    pub fn notify_graph_update(
        &self,
        dev_server_id: DebuggerId,
        visualizer_payload_base64: &mut BunString,
    ) {
        if let Some(handle) = core::ptr::NonNull::new(self.handle) {
            // SAFETY: handle non-null; payload valid for the call.
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyGraphUpdate(
                    handle.as_ptr(),
                    dev_server_id.get(),
                    visualizer_payload_base64,
                )
            }
        }
    }

    /// `notifyConsoleLog`. `kind` is `DevServer.ConsoleLogKind as u8` (`b'l'`
    /// / `b'e'`) — caller in `bun_runtime` does `kind as u8`.
    pub fn notify_console_log(&self, dev_server_id: DebuggerId, kind: u8, data: &mut BunString) {
        if let Some(handle) = core::ptr::NonNull::new(self.handle) {
            // SAFETY: handle non-null; data valid for the call.
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyConsoleLog(
                    handle.as_ptr(),
                    dev_server_id.get(),
                    kind,
                    data,
                )
            }
        }
    }
}

// HOST_EXPORT(Bun__InspectorBunFrontendDevServerAgent__setEnabled, c)
pub fn frontend_dev_server_agent_set_enabled(
    agent: *mut InspectorBunFrontendDevServerAgentHandle,
) {
    // SAFETY: called on the JS thread with a live VM (C++ inspector agent
    // invokes this only after the VM is initialized).
    if let Some(dbg) = VirtualMachine::get().as_mut().debugger.as_deref_mut() {
        // SAFETY: JS-thread only; sole access to the `UnsafeCell` slot here.
        unsafe { (*dbg.frontend_dev_server_agent.get()).handle = agent };
    }
}

mod ffi {
    use super::{BunString, InspectorBunFrontendDevServerAgentHandle};
    unsafe extern "C" {
        pub fn InspectorBunFrontendDevServerAgent__notifyClientConnected(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            connection_id: i32,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyClientDisconnected(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            connection_id: i32,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyBundleStart(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            trigger_files: *mut BunString,
            trigger_files_len: usize,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyBundleComplete(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            duration_ms: f64,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyBundleFailed(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            build_errors_payload_base64: *mut BunString,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyClientNavigated(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            connection_id: i32,
            url: *mut BunString,
            route_bundle_id: i32,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyClientErrorReported(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            client_error_payload_base64: *mut BunString,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyGraphUpdate(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            visualizer_payload_base64: *mut BunString,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyConsoleLog(
            agent: *mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            kind: u8,
            data: *mut BunString,
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
    /// Spec `Debugger.zig:31` `waitForDebuggerIfNecessary`.
    ///
    /// PORT NOTE — aliasing: `this.debugger` is read through a raw pointer
    /// with fresh short-lived borrows because `event_loop().tick()` /
    /// `auto_tick_active()` re-enter JS, which calls `VirtualMachine::get()`
    /// and may form independent `&mut VirtualMachine` borrows. Holding a
    /// long-lived `&mut Debugger` (which borrows from `&mut VirtualMachine`)
    /// across those calls is UB.
    pub fn wait_for_debugger_if_necessary(this: *mut VirtualMachine) {
        // SAFETY: `this` is the live per-thread VM; short-lived `&mut`.
        let Some(dbg) = (unsafe { (*this).debugger.as_deref_mut() }) else {
            return;
        };
        bun_analytics::features::debugger.fetch_add(1, Ordering::Relaxed);
        if !dbg.must_block_until_connected {
            return;
        }
        let (ctx_id, wait) = (dbg.script_execution_context_id, dbg.wait_for_connection);
        // Spec: `defer debugger.must_block_until_connected = false;`
        let _reset = scopeguard::guard(this, |this| {
            // SAFETY: `this` is the live per-thread VM; deferred to scope exit.
            if let Some(d) = unsafe { (*this).debugger.as_deref_mut() } {
                d.must_block_until_connected = false;
            }
        });

        bun_core::scoped_log!(debugger, "spin");
        // PORT NOTE: spec `var futex_atomic = .init(0)` and nothing ever
        // stores `1` before this load, so this loop is a no-op on first call
        // — ported faithfully.
        while FUTEX_ATOMIC.load(Ordering::Relaxed) > 0 {
            bun_threading::Futex::wait_forever(&FUTEX_ATOMIC, 1);
        }
        if bun_core::Environment::ENABLE_LOGS {
            bun_core::scoped_log!(
                debugger,
                "waitForDebugger: {}",
                bun_core::Output::ElapsedFormatter {
                    colors: bun_core::Output::enable_ansi_colors_stderr(),
                    duration_ns: (bun_core::time::nano_timestamp() - bun_core::start_time()) as u64,
                }
            );
        }

        // SAFETY: `Bun__ensureDebugger` is the C++ inspector setup hook;
        // `ctx_id` was returned by `Bun__createJSDebugger` in `create()`.
        unsafe { Bun__ensureDebugger(ctx_id, wait != Wait::Off) };

        // Sleep up to 30ms for automatic inspection.
        const WAIT_FOR_CONNECTION_DELAY_MS: i64 = 30;

        let deadline: bun_core::Timespec = if wait == Wait::Shortly {
            bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime)
                .add_ms(WAIT_FOR_CONNECTION_DELAY_MS)
        } else {
            // Spec: `else undefined` — never read on the `.forever` path.
            bun_core::Timespec { sec: 0, nsec: 0 }
        };

        #[cfg(windows)]
        {
            // Spec Debugger.zig:56-77: arm a one-shot libuv timer that unrefs
            // `poll_ref` after the delay (Windows lacks a working
            // `tickWithTimeout`). Per the original Zig comment ("TODO: remove
            // this when tickWithTimeout actually works properly on Windows").
            use bun_sys::windows::libuv as uv;
            use bun_sys::windows::libuv::UvHandle as _;
            if wait == Wait::Shortly {
                // SAFETY: `this` is the live per-thread VM; `uv_loop()` returns
                // the per-thread `uv_loop_t` initialized by `init()`.
                let uv_loop = unsafe { (*this).uv_loop() };
                // SAFETY: `uv_loop` is a live initialized `uv_loop_t`.
                unsafe { uv::uv_update_time(uv_loop) };
                // Spec: `bun.handleOom(allocator.create(Timer))` + zero-init.
                // SAFETY: all-zero is a valid pre-`uv_timer_init` state (C POD,
                // matches `std.mem.zeroes`).
                let timer: *mut uv::Timer =
                    bun_core::heap::into_raw(Box::new(unsafe { core::mem::zeroed() }));
                // SAFETY: `timer` freshly allocated; `uv_loop` valid.
                unsafe { (*timer).init(uv_loop) };

                unsafe extern "C" fn on_debugger_timer(handle: *mut uv::Timer) {
                    // SAFETY: `vm` is the per-thread singleton; called on the
                    // JS thread (libuv timer callback). Spec `.?` would panic;
                    // unwinding across `extern "C"` is UB so we early-return.
                    if let Some(d) = VirtualMachine::get().as_mut().debugger.as_deref_mut() {
                        d.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
                    }
                    // SAFETY: `handle` is a live `uv_timer_t` (`uv_handle_t`
                    // at offset 0); `deinit_timer` matches `uv_close_cb`.
                    unsafe {
                        uv::uv_close(handle.cast(), Some(deinit_timer));
                    }
                }
                unsafe extern "C" fn deinit_timer(handle: *mut uv::uv_handle_t) {
                    // SAFETY: `handle` is the `Box<Timer>` allocated above
                    // (cast through `uv_handle_t` at offset 0); this is the
                    // sole owner reclaiming it after `uv_close` completes.
                    drop(unsafe { bun_core::heap::take(handle.cast::<uv::Timer>()) });
                }
                // SAFETY: `timer` initialized above.
                unsafe {
                    (*timer).start(
                        WAIT_FOR_CONNECTION_DELAY_MS as u64,
                        0,
                        Some(on_debugger_timer),
                    );
                    (*timer).ref_();
                }
            }
        }

        // Drop the long-lived `&mut Debugger` before re-entering JS — see
        // PORT NOTE above.
        loop {
            // SAFETY: `this` is the live per-thread VM; fresh short-lived borrow.
            let wait = match unsafe { (*this).debugger.as_deref() } {
                Some(d) => d.wait_for_connection,
                None => break,
            };
            if wait == Wait::Off {
                break;
            }
            // SAFETY: `event_loop()` slot stable for VM lifetime; fresh `&mut`.
            unsafe { (*(*this).event_loop()).tick() };
            // Re-read after `tick()` — `Debugger__didConnect` may have flipped it.
            // SAFETY: see above.
            let wait = match unsafe { (*this).debugger.as_deref() } {
                Some(d) => d.wait_for_connection,
                None => break,
            };
            match wait {
                Wait::Forever => {
                    // SAFETY: see above.
                    unsafe { (*(*this).event_loop()).auto_tick_active() };

                    if bun_core::Environment::ENABLE_LOGS {
                        bun_core::scoped_log!(
                            debugger,
                            "waited: {}ns",
                            (bun_core::time::nano_timestamp() - bun_core::start_time()) as i64
                        );
                    }
                }
                Wait::Shortly => {
                    // Handle .incrementRefConcurrently
                    #[cfg(unix)]
                    {
                        // SAFETY: `this` is the live per-thread VM.
                        let pending_unref = unsafe { (*this).pending_unref_counter };
                        if pending_unref > 0 {
                            // SAFETY: see above.
                            unsafe { (*this).pending_unref_counter = 0 };
                            // SAFETY: `uws_loop()` returns the per-VM loop;
                            // non-null on the JS thread once `init()` ran.
                            unsafe { (*(*this).uws_loop()).unref_count(pending_unref) };
                        }
                    }

                    // SAFETY: `bun_core::Timespec` and `bun_uws::Timespec` are
                    // both `#[repr(C)] { sec: i64, nsec: i64 }` — layout-
                    // identical. `uws_loop()` non-null on JS thread.
                    let deadline_uws: &bun_uws::Timespec =
                        unsafe { &*(&raw const deadline).cast() };
                    // SAFETY: see above.
                    unsafe { (*(*this).uws_loop()).tick_with_timeout(Some(deadline_uws)) };

                    if bun_core::Environment::ENABLE_LOGS {
                        bun_core::scoped_log!(
                            debugger,
                            "waited: {}ns",
                            (bun_core::time::nano_timestamp() - bun_core::start_time()) as i64
                        );
                    }

                    let elapsed =
                        bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime);
                    if elapsed.order(&deadline) != core::cmp::Ordering::Less {
                        // SAFETY: `this` is the live per-thread VM; debugger
                        // checked Some above (re-check defensively).
                        if let Some(d) = unsafe { (*this).debugger.as_deref_mut() } {
                            d.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
                        }
                        bun_core::scoped_log!(debugger, "Timed out waiting for the debugger");
                        break;
                    }
                }
                Wait::Off => break,
            }
        }
    }

    /// `Debugger.create(vm, global)` — first-time debugger setup: create the
    /// JSC inspector context, spawn the debugger VM thread, and arm the
    /// keep-alive on the parent loop.
    ///
    /// Spec `Debugger.zig:118` `create`.
    pub fn create(
        this: *mut VirtualMachine,
        global_object: &JSGlobalObject,
    ) -> Result<(), bun_core::Error> {
        bun_core::scoped_log!(debugger, "create");
        jsc::mark_binding();
        if HAS_CREATED_DEBUGGER.swap(true, Ordering::Relaxed) {
            return Ok(());
        }
        // Spec: `std.mem.doNotOptimizeAway(&Bun__*Agent*)` — Rust
        // `#[unsafe(no_mangle)]` already prevents the linker from stripping
        // these exported symbols, so the keep-alive references are unnecessary.

        // SAFETY: `this` is the live per-thread VM; caller (high-tier
        // `ensure_debugger`) populated `debugger` before calling.
        let dbg = unsafe { (*this).debugger.as_deref_mut() }
            .expect("Debugger::create: vm.debugger is None");
        // SAFETY: `global_object` is a live opaque JSC handle.
        dbg.script_execution_context_id =
            unsafe { Bun__createJSDebugger(std::ptr::from_ref(global_object).cast_mut()) };

        // SAFETY: `this` is the live per-thread VM; short-lived borrow.
        if !unsafe { (*this).has_started_debugger } {
            // SAFETY: see above.
            unsafe { (*this).has_started_debugger = true };
            // PORT NOTE: `std::thread::spawn` requires `Send`; raw `*mut
            // VirtualMachine` is `!Send`. Wrap in a `Send` newtype — the
            // pointer is only ever dereferenced on the debugger thread under
            // `holdAPILock` (see `start_js_debugger_thread` doc), and the VM
            // outlives the process.
            struct SendVmPtr(*mut VirtualMachine);
            // SAFETY: see PORT NOTE above — cross-thread access is mediated
            // by `holdAPILock` / the futex; the VM allocation is `'static`.
            unsafe impl Send for SendVmPtr {}
            let send_vm = SendVmPtr(this);
            // Spec `std.Thread.spawn(.{}, ...)` — Zig's default is 16 MiB.
            // Rust's `std::thread` default (2 MiB) is too small to run a full
            // `VirtualMachine::init` + JS module load on this thread.
            std::thread::Builder::new()
                .name("Debugger".to_string())
                .stack_size(16 * 1024 * 1024)
                .spawn(move || {
                    let send_vm = send_vm;
                    Debugger::start_js_debugger_thread(send_vm.0);
                })
                .map_err(|_| bun_core::err!("ThreadSpawnFailed"))?;
            // Spec: `thread.detach()` — Rust `JoinHandle` detaches on drop.
        }
        // SAFETY: `event_loop()` slot stable for VM lifetime.
        unsafe { (*(*this).event_loop()).ensure_waker() };

        // Re-borrow after `ensure_waker` (which may touch `*this`).
        // SAFETY: `this` is the live per-thread VM.
        let dbg = unsafe { (*this).debugger.as_deref_mut() }.unwrap();
        if dbg.wait_for_connection != Wait::Off {
            dbg.poll_ref.ref_(get_vm_ctx(AllocatorType::Js));
            dbg.must_block_until_connected = true;
        }
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
        let this: *mut VirtualMachine = VirtualMachine::get_mut_ptr();
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
            unsafe { Bun__startJSDebuggerThread(global, ctx_id, &raw mut url, 1, is_connect) };
            // SAFETY: see above.
            unsafe { (*loop_).exit() };
        }

        if let Some(path_or_port) = path_or_port {
            let mut url = BunString::clone_utf8(path_or_port);
            // SAFETY: see above.
            unsafe { (*loop_).enter() };
            // SAFETY: see above.
            unsafe { Bun__startJSDebuggerThread(global, ctx_id, &raw mut url, 0, is_connect) };
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
                let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(bun_core::Output::error_writer()));
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

// HOST_EXPORT(Debugger__didConnect, c)
pub fn did_connect() {
    let this = VirtualMachine::get().as_mut();
    // SAFETY: `VirtualMachine::get()` returns the per-thread singleton; called
    // on the JS thread. Spec: `this.debugger.?` would safety-panic; we early-
    // return defensively (extern "C" — unwinding is UB).
    let Some(dbg) = this.debugger.as_deref_mut() else {
        return;
    };
    if dbg.wait_for_connection != Wait::Off {
        dbg.wait_for_connection = Wait::Off;
        dbg.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
        // SAFETY: `event_loop()` returns the raw `*mut EventLoop` slot; live
        // for VM lifetime. `wakeup()` takes `&self` (thread-safe).
        unsafe { (*(*this).event_loop()).wakeup() };
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
        AsyncTaskTracker { id: vm.next_async_task_id() }
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

    /// RAII pair for `will_dispatch` / `did_dispatch`. Calls `will_dispatch`
    /// now and `did_dispatch` when the returned guard is dropped — the Rust
    /// spelling of Zig's `tracker.willDispatch(); defer tracker.didDispatch();`.
    #[must_use]
    pub fn dispatch(self, global_object: &JSGlobalObject) -> DispatchScope<'_> {
        self.will_dispatch(global_object);
        DispatchScope { tracker: self, global_object }
    }
}

/// Drop guard returned by [`AsyncTaskTracker::dispatch`].
pub struct DispatchScope<'a> {
    tracker: AsyncTaskTracker,
    global_object: &'a JSGlobalObject,
}

impl Drop for DispatchScope<'_> {
    fn drop(&mut self) {
        self.tracker.did_dispatch(self.global_object);
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

// HOST_EXPORT(Bun__TestReporterAgentEnable, c)
pub fn test_reporter_agent_enable(agent: *mut TestReporterHandle) {
    // SAFETY: `VirtualMachine::get()` returns the per-thread singleton; called
    // on the JS thread.
    if let Some(dbg) = VirtualMachine::get().as_mut().debugger.as_deref_mut() {
        bun_core::scoped_log!(TestReporterAgent, "enable");
        dbg.test_reporter_agent.handle = agent;

        // Retroactively report any tests that were already discovered before
        // the debugger connected.
        //
        // LAYERING: `retroactivelyReportDiscoveredTests` (spec
        // Debugger.zig:351) reaches into `jsc.Jest.Jest.runner` /
        // `bun_test.DescribeScope`, which live in `bun_runtime::test_runner`
        // — a forward-dep cycle. Dispatched through [`RuntimeHooks`].
        if let Some(hooks) = runtime_hooks() {
            // SAFETY: `agent` is a live C++ handle (just stored above).
            unsafe { (hooks.retroactively_report_discovered_tests)(agent) };
        }
    }
}

// HOST_EXPORT(Bun__TestReporterAgentDisable, c)
pub fn test_reporter_agent_disable(_agent: *mut TestReporterHandle) {
    // SAFETY: `VirtualMachine::get()` returns the per-thread singleton; called
    // on the JS thread.
    if let Some(dbg) = VirtualMachine::get().as_mut().debugger.as_deref_mut() {
        bun_core::scoped_log!(TestReporterAgent, "disable");
        dbg.test_reporter_agent.handle = core::ptr::null_mut();
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

// HOST_EXPORT(Bun__LifecycleAgentEnable, c)
pub fn lifecycle_agent_enable(agent: *mut LifecycleHandle) {
    // SAFETY: `VirtualMachine::get()` returns the per-thread singleton; called
    // on the JS thread.
    if let Some(dbg) = VirtualMachine::get().as_mut().debugger.as_deref_mut() {
        bun_core::scoped_log!(LifecycleAgent, "enable");
        dbg.lifecycle_reporter_agent.handle = agent;
    }
}

// HOST_EXPORT(Bun__LifecycleAgentDisable, c)
pub fn lifecycle_agent_disable(_agent: *mut LifecycleHandle) {
    // SAFETY: `VirtualMachine::get()` returns the per-thread singleton; called
    // on the JS thread.
    if let Some(dbg) = VirtualMachine::get().as_mut().debugger.as_deref_mut() {
        bun_core::scoped_log!(LifecycleAgent, "disable");
        dbg.lifecycle_reporter_agent.handle = core::ptr::null_mut();
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

// ported from: src/jsc/Debugger.zig
