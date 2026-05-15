//! `jsc.Debugger` — inspector / test-reporter / lifecycle-agent surface.
//!
//! Type surface (`Debugger`, `AsyncTaskTracker`, `DebuggerId`,
//! `TestReporterAgent`, `LifecycleAgent`, `AsyncCallType`) is real and
//! compiles against the `bun_jsc` crate's available dependency set.
//! `retroactively_report_discovered_tests` reaches into the `bun:test` runner
//! (`bun_runtime::test_runner`) — a forward-dep cycle — so it dispatches
//! through [`RuntimeHooks::retroactively_report_discovered_tests`].

use core::cell::{Cell, UnsafeCell};
use core::ffi::{c_int, c_void};
use core::marker::{PhantomData, PhantomPinned};
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_core::String as BunString;
use bun_io::KeepAlive;
use bun_io::posix_event_loop::{AllocatorType, get_vm_ctx};

use crate::virtual_machine::{VirtualMachine, runtime_hooks};
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

bun_opaque::opaque_ffi! {
    /// Opaque C++ `InspectorBunFrontendDevServerAgent` handle.
    pub struct InspectorBunFrontendDevServerAgentHandle;
}

/// `BunFrontendDevServerAgent` — stored inline in `Debugger`. The two
/// high-tier types the Zig spec referenced (`DevServer.RouteBundle.Index` in
/// `notifyClientNavigated`, `DevServer.ConsoleLogKind` in `notifyConsoleLog`)
/// are forward deps; both reduce to `i32` / `u8` at the C++ FFI boundary, so
/// callers in `bun_runtime` resolve them before calling.
///
/// Both fields are `Copy`, so `Cell<T>` gives interior mutability with zero
/// `unsafe` — every method takes `&self`, and callers reaching this through a
/// shared `&Debugger` borrow no longer need `&mut` (or the `UnsafeCell` deref
/// in `DevServer::inspector`).
pub struct BunFrontendDevServerAgent {
    pub next_inspector_connection_id: Cell<i32>,
    pub handle: Cell<*mut InspectorBunFrontendDevServerAgentHandle>,
}

impl Default for BunFrontendDevServerAgent {
    fn default() -> Self {
        Self {
            next_inspector_connection_id: Cell::new(0),
            handle: Cell::new(core::ptr::null_mut()),
        }
    }
}

impl BunFrontendDevServerAgent {
    /// `nextConnectionID` — wrapping post-increment.
    pub fn next_connection_id(&self) -> i32 {
        let id = self.next_inspector_connection_id.get();
        self.next_inspector_connection_id.set(id.wrapping_add(1));
        id
    }

    #[inline]
    pub fn is_enabled(&self) -> bool {
        !self.handle.get().is_null()
    }

    /// `&mut Handle` accessor for the FFI shims. `handle` is set by the C++
    /// inspector backend (`frontend_dev_server_agent_set_enabled`) and stays
    /// live while the agent is enabled. Returns `None` when disabled.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn handle_mut(&self) -> Option<&mut InspectorBunFrontendDevServerAgentHandle> {
        let handle = self.handle.get();
        if handle.is_null() {
            return None;
        }
        // `opaque_mut` is the audited safe `*mut → &mut` for opaque ZST
        // handles (zero-byte deref; see `bun_opaque::opaque_deref_mut`).
        Some(InspectorBunFrontendDevServerAgentHandle::opaque_mut(handle))
    }

    pub fn notify_client_connected(&self, dev_server_id: DebuggerId, connection_id: i32) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyClientConnected(
                handle,
                dev_server_id.get(),
                connection_id,
            )
        }
    }

    pub fn notify_client_disconnected(&self, dev_server_id: DebuggerId, connection_id: i32) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyClientDisconnected(
                handle,
                dev_server_id.get(),
                connection_id,
            )
        }
    }

    pub fn notify_bundle_start(&self, dev_server_id: DebuggerId, trigger_files: &mut [BunString]) {
        if let Some(handle) = self.handle_mut() {
            // SAFETY: `trigger_files` is a valid contiguous slice for the call;
            // `(ptr, len)` pair derived from it.
            unsafe {
                ffi::InspectorBunFrontendDevServerAgent__notifyBundleStart(
                    handle,
                    dev_server_id.get(),
                    trigger_files.as_mut_ptr(),
                    trigger_files.len(),
                )
            }
        }
    }

    pub fn notify_bundle_complete(&self, dev_server_id: DebuggerId, duration_ms: f64) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyBundleComplete(
                handle,
                dev_server_id.get(),
                duration_ms,
            )
        }
    }

    pub fn notify_bundle_failed(
        &self,
        dev_server_id: DebuggerId,
        build_errors_payload_base64: &mut BunString,
    ) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyBundleFailed(
                handle,
                dev_server_id.get(),
                build_errors_payload_base64,
            )
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
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyClientNavigated(
                handle,
                dev_server_id.get(),
                connection_id,
                url,
                route_bundle_id,
            )
        }
    }

    pub fn notify_client_error_reported(
        &self,
        dev_server_id: DebuggerId,
        client_error_payload_base64: &mut BunString,
    ) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyClientErrorReported(
                handle,
                dev_server_id.get(),
                client_error_payload_base64,
            )
        }
    }

    pub fn notify_graph_update(
        &self,
        dev_server_id: DebuggerId,
        visualizer_payload_base64: &mut BunString,
    ) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyGraphUpdate(
                handle,
                dev_server_id.get(),
                visualizer_payload_base64,
            )
        }
    }

    /// `notifyConsoleLog`. `kind` is `DevServer.ConsoleLogKind as u8` (`b'l'`
    /// / `b'e'`) — caller in `bun_runtime` does `kind as u8`.
    pub fn notify_console_log(&self, dev_server_id: DebuggerId, kind: u8, data: &mut BunString) {
        if let Some(handle) = self.handle_mut() {
            ffi::InspectorBunFrontendDevServerAgent__notifyConsoleLog(
                handle,
                dev_server_id.get(),
                kind,
                data,
            )
        }
    }
}

// HOST_EXPORT(Bun__InspectorBunFrontendDevServerAgent__setEnabled, c)
pub fn frontend_dev_server_agent_set_enabled(agent: *mut InspectorBunFrontendDevServerAgentHandle) {
    // SAFETY: called on the JS thread with a live VM (C++ inspector agent
    // invokes this only after the VM is initialized).
    if let Some(dbg) = VirtualMachine::get().as_mut().debugger.as_deref_mut() {
        // `dbg: &mut Debugger`, so safe `UnsafeCell::get_mut` applies — no
        // raw-pointer deref needed.
        dbg.frontend_dev_server_agent.get_mut().handle.set(agent);
    }
}

mod ffi {
    use super::{BunString, InspectorBunFrontendDevServerAgentHandle};
    // SAFETY (safe fn): `InspectorBunFrontendDevServerAgentHandle` is an
    // `opaque_ffi!` ZST handle (`!Freeze` via `UnsafeCell`); `BunString` is a
    // `#[repr(C)]` in-param the C++ side reads/consumes in-place. `&mut T` is
    // ABI-identical to a non-null `*mut T`. `notifyBundleStart` keeps a raw
    // `(ptr, len)` pair (slice not FFI-safe) and stays `unsafe`.
    unsafe extern "C" {
        pub safe fn InspectorBunFrontendDevServerAgent__notifyClientConnected(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            connection_id: i32,
        );
        pub safe fn InspectorBunFrontendDevServerAgent__notifyClientDisconnected(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            connection_id: i32,
        );
        pub fn InspectorBunFrontendDevServerAgent__notifyBundleStart(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            trigger_files: *mut BunString,
            trigger_files_len: usize,
        );
        pub safe fn InspectorBunFrontendDevServerAgent__notifyBundleComplete(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            duration_ms: f64,
        );
        pub safe fn InspectorBunFrontendDevServerAgent__notifyBundleFailed(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            build_errors_payload_base64: &mut BunString,
        );
        pub safe fn InspectorBunFrontendDevServerAgent__notifyClientNavigated(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            connection_id: i32,
            url: &mut BunString,
            route_bundle_id: i32,
        );
        pub safe fn InspectorBunFrontendDevServerAgent__notifyClientErrorReported(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            client_error_payload_base64: &mut BunString,
        );
        pub safe fn InspectorBunFrontendDevServerAgent__notifyGraphUpdate(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            visualizer_payload_base64: &mut BunString,
        );
        pub safe fn InspectorBunFrontendDevServerAgent__notifyConsoleLog(
            agent: &mut InspectorBunFrontendDevServerAgentHandle,
            dev_server_id: i32,
            kind: u8,
            data: &mut BunString,
        );
    }
}

/// `bun.GenericIndex(i32, Debugger)`
pub enum DebuggerMarker {}
pub type DebuggerId = bun_core::GenericIndex<i32, DebuggerMarker>;

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
//
// SAFETY (safe fn): `JSGlobalObject` is an opaque `UnsafeCell`-backed handle
// (`&` is ABI-identical to non-null `*mut`); `BunString` is a `#[repr(C)]` POD
// out-param. Remaining args are by-value scalars.
unsafe extern "C" {
    safe fn Bun__createJSDebugger(global: &JSGlobalObject) -> u32;
    safe fn Bun__ensureDebugger(ctx_id: u32, wait: bool);
    safe fn Bun__startJSDebuggerThread(
        global: &JSGlobalObject,
        ctx_id: u32,
        url: &mut BunString,
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
        // `this` is the live per-thread VM; same allocation as
        // `VirtualMachine::get()` — route through the safe thread-local
        // accessor instead of open-coding the backref deref. All subsequent
        // accesses form short-lived `&mut`s under the single-JS-thread
        // invariant via safe `&VirtualMachine` accessors.
        debug_assert!(core::ptr::eq(this, VirtualMachine::get_mut_ptr()));
        let _ = this; // release: param otherwise unused
        let this: &VirtualMachine = VirtualMachine::get();
        let Some(dbg) = this.debugger_mut() else {
            return;
        };
        bun_analytics::features::debugger.fetch_add(1, Ordering::Relaxed);
        if !dbg.must_block_until_connected {
            return;
        }
        let (ctx_id, wait) = (dbg.script_execution_context_id, dbg.wait_for_connection);
        // Spec: `defer debugger.must_block_until_connected = false;`
        let _reset = scopeguard::guard((), |()| {
            if let Some(d) = this.debugger_mut() {
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
                    duration_ns: u64::try_from(
                        (bun_core::time::nano_timestamp() - bun_core::start_time()).max(0),
                    )
                    .unwrap_or(u64::MAX),
                }
            );
        }

        Bun__ensureDebugger(ctx_id, wait != Wait::Off);

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
                let uv_loop = this.uv_loop();
                // SAFETY: `uv_loop` is a live initialized `uv_loop_t`.
                unsafe { uv::uv_update_time(uv_loop) };
                // Spec: `bun.handleOom(allocator.create(Timer))` + zero-init.
                let timer: *mut uv::Timer =
                    bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed()));
                // SAFETY: `timer` freshly allocated; `uv_loop` valid.
                unsafe { (*timer).init(uv_loop) };

                extern "C" fn on_debugger_timer(handle: *mut uv::Timer) {
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
                extern "C" fn deinit_timer(handle: *mut uv::uv_handle_t) {
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
        // PORT NOTE above. Each loop iteration re-fetches via `debugger_mut()`
        // so re-entrant JS may independently borrow the VM.
        loop {
            let wait = match this.debugger.as_deref() {
                Some(d) => d.wait_for_connection,
                None => break,
            };
            if wait == Wait::Off {
                break;
            }
            this.event_loop_mut().tick();
            // Re-read after `tick()` — `Debugger__didConnect` may have flipped it.
            let wait = match this.debugger.as_deref() {
                Some(d) => d.wait_for_connection,
                None => break,
            };
            match wait {
                Wait::Forever => {
                    this.event_loop_mut().auto_tick_active();

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
                        let pending_unref = this.take_pending_unref();
                        if pending_unref > 0 {
                            this.uws_loop_mut().unref_count(pending_unref);
                        }
                    }

                    this.uws_loop_mut().tick_with_timeout(Some(&deadline));

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
                        if let Some(d) = this.debugger_mut() {
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

        // `this` is the live per-thread VM; same allocation as
        // `VirtualMachine::get()` — route through the safe thread-local
        // accessor. Safe accessors below form short-lived `&mut`s under the
        // single-JS-thread invariant.
        debug_assert!(core::ptr::eq(this, VirtualMachine::get_mut_ptr()));
        let this_ref: &VirtualMachine = VirtualMachine::get();
        let dbg = this_ref
            .debugger_mut()
            .expect("Debugger::create: vm.debugger is None");
        dbg.script_execution_context_id = Bun__createJSDebugger(global_object);

        if !this_ref.has_started_debugger {
            this_ref.as_mut().has_started_debugger = true;
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
        this_ref.event_loop_mut().ensure_waker();

        // Re-borrow after `ensure_waker` (which may touch `*this`).
        let dbg = this_ref.debugger_mut().unwrap();
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
        let _ = vm_ptr;
        // `init` installs the freshly-boxed VM as this thread's singleton.
        let vm = VirtualMachine::get().as_mut();

        vm.transpiler
            .configure_defines()
            .unwrap_or_else(|_| panic!("Failed to configure defines"));
        vm.is_main_thread = false;
        vm.event_loop_mut().ensure_waker();

        // Spec: `vm.global.vm().holdAPILock(other_vm, OpaqueWrap(VM, start))`.
        extern "C" fn start_trampoline(ctx: *mut c_void) {
            // PORT NOTE: forward the raw pointer unchanged — see fn doc above
            // for why we never form `&mut VirtualMachine` to the parent VM.
            Debugger::start(ctx.cast::<VirtualMachine>());
        }
        #[allow(deprecated)]
        vm.global()
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

        // `this` is this thread's own VM (created in `start_js_debugger_thread`)
        // — safe to hold as `&'static`. `other_vm` remains a raw pointer (see
        // PORT NOTE above): the parent thread mutates it concurrently after the
        // futex wake, so forming `&VirtualMachine` to it would be a data race.
        let this: &VirtualMachine = VirtualMachine::get();
        // SAFETY: `other_vm` is the parent-thread VM, live for process
        // lifetime. We read its `event_loop` self-pointer once *before* the
        // futex wake (while the parent is still blocked / not yet past the
        // wait-loop) and reuse the raw pointer for the cross-thread `wakeup()`
        // calls below. `wakeup()` takes `&self` and is the documented
        // thread-safe path (event_loop.rs:779).
        let other_loop: *mut crate::event_loop::EventLoop = unsafe { (*other_vm).event_loop() };
        let global: &JSGlobalObject = this.global();

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
            let _scope = this.enter_event_loop_scope();
            Bun__startJSDebuggerThread(global, ctx_id, &mut url, 1, is_connect);
        }

        if let Some(path_or_port) = path_or_port {
            let mut url = BunString::clone_utf8(path_or_port);
            let _scope = this.enter_event_loop_scope();
            Bun__startJSDebuggerThread(global, ctx_id, &mut url, 0, is_connect);
        }

        this.global().handle_rejected_promises();

        if let Some(log) = this.log_ref() {
            if !log.msgs.is_empty() {
                let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(
                    bun_core::Output::error_writer(),
                ));
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
        // above. `event_loop_mut()` re-reads the slot on every call.
        this.event_loop_mut().tick();
        // SAFETY: see above.
        unsafe { (*other_loop).wakeup() };

        loop {
            // Each call forms a fresh short-lived `&`/`&mut` (via the safe
            // accessors) so re-entrant JS inside `tick()` may independently
            // call `VirtualMachine::get()` without aliasing.
            while this.is_event_loop_alive() {
                this.as_mut().tick();
                this.event_loop_mut().auto_tick_active();
            }
            this.event_loop_mut().tick_possibly_forever();
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
        this.event_loop_mut().wakeup();
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

    /// RAII pair for `will_dispatch` / `did_dispatch`. Calls `will_dispatch`
    /// now and `did_dispatch` when the returned guard is dropped — the Rust
    /// spelling of Zig's `tracker.willDispatch(); defer tracker.didDispatch();`.
    #[must_use]
    pub fn dispatch(self, global_object: &JSGlobalObject) -> DispatchScope<'_> {
        self.will_dispatch(global_object);
        DispatchScope {
            tracker: self,
            global_object,
        }
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
//
// SAFETY (safe fn): `JSGlobalObject` is an opaque `UnsafeCell`-backed handle
// (`&` is ABI-identical to non-null `*const`); remaining args are by-value
// scalars / `#[repr(u8)]` enums.
unsafe extern "C" {
    safe fn Debugger__didScheduleAsyncCall(
        global: &JSGlobalObject,
        call: AsyncCallType,
        id: u64,
        single_shot: bool,
    );
    safe fn Debugger__didCancelAsyncCall(global: &JSGlobalObject, call: AsyncCallType, id: u64);
    safe fn Debugger__didDispatchAsyncCall(global: &JSGlobalObject, call: AsyncCallType, id: u64);
    safe fn Debugger__willDispatchAsyncCall(global: &JSGlobalObject, call: AsyncCallType, id: u64);
}

pub fn did_schedule_async_call(
    global_object: &JSGlobalObject,
    call: AsyncCallType,
    id: u64,
    single_shot: bool,
) {
    jsc::mark_binding();
    Debugger__didScheduleAsyncCall(global_object, call, id, single_shot);
}
pub fn did_cancel_async_call(global_object: &JSGlobalObject, call: AsyncCallType, id: u64) {
    jsc::mark_binding();
    Debugger__didCancelAsyncCall(global_object, call, id);
}
pub fn did_dispatch_async_call(global_object: &JSGlobalObject, call: AsyncCallType, id: u64) {
    jsc::mark_binding();
    Debugger__didDispatchAsyncCall(global_object, call, id);
}
pub fn will_dispatch_async_call(global_object: &JSGlobalObject, call: AsyncCallType, id: u64) {
    jsc::mark_binding();
    Debugger__willDispatchAsyncCall(global_object, call, id);
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

bun_opaque::opaque_ffi! { pub struct TestReporterHandle; }

// TODO(port): move to jsc_sys
//
// SAFETY (safe fn): `TestReporterHandle` and `CallFrame` are `opaque_ffi!`
// ZST handles (`!Freeze` via `UnsafeCell`); `BunString` is a `#[repr(C)]`
// in/out-param the C++ side reads/consumes in-place. Remaining args are
// by-value scalars.
unsafe extern "C" {
    safe fn Bun__TestReporterAgentReportTestFound(
        agent: &mut TestReporterHandle,
        call_frame: &CallFrame,
        test_id: c_int,
        name: &mut BunString,
        item_type: TestType,
        parent_id: c_int,
    );
    safe fn Bun__TestReporterAgentReportTestFoundWithLocation(
        agent: &mut TestReporterHandle,
        test_id: c_int,
        name: &mut BunString,
        item_type: TestType,
        parent_id: c_int,
        source_url: &mut BunString,
        line: c_int,
    );
    safe fn Bun__TestReporterAgentReportTestStart(agent: &mut TestReporterHandle, test_id: c_int);
    safe fn Bun__TestReporterAgentReportTestEnd(
        agent: &mut TestReporterHandle,
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
        Bun__TestReporterAgentReportTestFound(
            self, call_frame, test_id, name, item_type, parent_id,
        );
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
        Bun__TestReporterAgentReportTestFoundWithLocation(
            self, test_id, name, item_type, parent_id, source_url, line,
        );
    }

    pub fn report_test_start(&mut self, test_id: c_int) {
        Bun__TestReporterAgentReportTestStart(self, test_id);
    }

    pub fn report_test_end(&mut self, test_id: c_int, bun_test_status: TestStatus, elapsed: f64) {
        Bun__TestReporterAgentReportTestEnd(self, test_id, bun_test_status, elapsed);
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
    /// Safe `&mut TestReporterHandle` accessor — `handle` is a live C++
    /// `Inspector::TestReporterAgent*` once the agent is enabled. Caller must
    /// ensure `is_enabled()` (handle != null); the debug-assert mirrors the
    /// Zig `agent.handle.?` unwrap.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn handle_mut(&self) -> &mut TestReporterHandle {
        debug_assert!(!self.handle.is_null());
        // Caller contract — `is_enabled()` checked; handle is a live C++ heap
        // allocation owned by the inspector backend. `TestReporterHandle` is an
        // opaque ZST handle so the deref is the centralised `opaque_mut` proof.
        TestReporterHandle::opaque_mut(self.handle)
    }

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
        self.handle_mut()
            .report_test_found(call_frame, test_id, name, item_type, parent_id);
    }

    /// Caller must ensure that it is enabled first.
    pub fn report_test_start(&self, test_id: i32) {
        bun_core::scoped_log!(TestReporterAgent, "reportTestStart");
        self.handle_mut().report_test_start(test_id);
    }

    /// Caller must ensure that it is enabled first.
    pub fn report_test_end(&self, test_id: i32, bun_test_status: TestStatus, elapsed: f64) {
        bun_core::scoped_log!(TestReporterAgent, "reportTestEnd");
        self.handle_mut()
            .report_test_end(test_id, bun_test_status, elapsed);
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

bun_opaque::opaque_ffi! { pub struct LifecycleHandle; }

// TODO(port): move to jsc_sys
//
// SAFETY (safe fn): `LifecycleHandle` is an `opaque_ffi!` ZST handle (`!Freeze`
// via `UnsafeCell`); `ZigException` is a `#[repr(C)]` out-param the C++ side
// reads/fills in-place.
unsafe extern "C" {
    safe fn Bun__LifecycleAgentReportReload(agent: &mut LifecycleHandle);
    safe fn Bun__LifecycleAgentReportError(
        agent: &mut LifecycleHandle,
        exception: &mut ZigException,
    );
    safe fn Bun__LifecycleAgentPreventExit(agent: &mut LifecycleHandle);
    safe fn Bun__LifecycleAgentStopPreventingExit(agent: &mut LifecycleHandle);
}

impl LifecycleHandle {
    pub fn prevent_exit(&mut self) {
        Bun__LifecycleAgentPreventExit(self)
    }

    pub fn stop_preventing_exit(&mut self) {
        Bun__LifecycleAgentStopPreventingExit(self)
    }

    pub fn report_reload(&mut self) {
        bun_core::scoped_log!(LifecycleAgent, "reportReload");
        Bun__LifecycleAgentReportReload(self)
    }

    pub fn report_error(&mut self, exception: &mut ZigException) {
        bun_core::scoped_log!(LifecycleAgent, "reportError");
        Bun__LifecycleAgentReportError(self, exception)
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
    /// Safe optional accessor — wraps the null check + raw deref.
    #[inline]
    fn handle_mut(&mut self) -> Option<&mut LifecycleHandle> {
        // `handle` is null or a live C++ heap allocation owned by the inspector
        // backend. `LifecycleHandle` is an opaque ZST handle so the deref is
        // the centralised `opaque_mut` proof.
        core::ptr::NonNull::new(self.handle).map(|p| LifecycleHandle::opaque_mut(p.as_ptr()))
    }

    pub fn report_reload(&mut self) {
        if let Some(h) = self.handle_mut() {
            h.report_reload();
        }
    }

    pub fn report_error(&mut self, exception: &mut ZigException) {
        if let Some(h) = self.handle_mut() {
            h.report_error(exception);
        }
    }

    pub fn is_enabled(&self) -> bool {
        !self.handle.is_null()
    }
}

// ported from: src/jsc/Debugger.zig
