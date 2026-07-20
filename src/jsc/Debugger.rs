//! `jsc.Debugger` — inspector / test-reporter / lifecycle-agent surface.
//!
//! Type surface (`Debugger`, `AsyncTaskTracker`, `DebuggerId`,
//! `TestReporterAgent`, `LifecycleAgent`, `AsyncCallType`) is real and
//! compiles against the `bun_jsc` crate's available dependency set.
//! `retroactively_report_discovered_tests` reaches into the `bun:test` runner
//! (`bun_runtime::test_runner`) — a forward-dep cycle — so it dispatches
//! through [`RuntimeHooks::retroactively_report_discovered_tests`].

use core::cell::Cell;
use core::ffi::{c_int, c_void};
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
// so `Debugger.http_server_agent` carries `next_server_id` state). Agents
// implemented in higher-tier crates store their per-VM state in the
// type-erased [`ErasedAgentSlot`] below.
// ──────────────────────────────────────────────────────────────────────────

pub use crate::http_server_agent::HTTPServerAgent;

/// Type-erased per-`Debugger` slot for an inspector agent implemented in a
/// higher-tier crate (a forward dep this crate cannot name).
///
/// `agent` is the opaque C++ inspector-agent pointer the backend pushes on
/// domain enable (null while disabled) through a `HOST_EXPORT` defined next
/// to the slot's owner; `sequence` is a free-running counter for the owner's
/// use. `Debugger` only stores the slot — it never interprets either field.
/// The fields are private so every outside access flows through the named
/// accessors below, keeping the owning module's interpretation the only one.
///
/// Both fields are `Copy`, so `Cell<T>` gives interior mutability with zero
/// `unsafe`.
pub struct ErasedAgentSlot {
    agent: Cell<*mut c_void>,
    sequence: Cell<i32>,
}

impl ErasedAgentSlot {
    /// The opaque agent pointer (null while the inspector domain is disabled).
    #[inline]
    pub fn agent_ptr(&self) -> *mut c_void {
        self.agent.get()
    }

    /// Set the opaque agent pointer. Called by the slot owner's `HOST_EXPORT`
    /// on domain enable/disable.
    #[inline]
    pub fn set_agent_ptr(&self, ptr: *mut c_void) {
        self.agent.set(ptr);
    }

    /// Wrapping post-increment of the owner's free-running counter.
    #[inline]
    pub fn post_increment_sequence(&self) -> i32 {
        let id = self.sequence.get();
        self.sequence.set(id.wrapping_add(1));
        id
    }
}

impl Default for ErasedAgentSlot {
    fn default() -> Self {
        Self {
            agent: Cell::new(core::ptr::null_mut()),
            sequence: Cell::new(0),
        }
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

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Protocol {
    /// WebKit inspector protocol, spoken by debug.bun.sh and the VSCode extension.
    Jsc,
    /// V8 Chrome DevTools Protocol, spoken by clients of `node:inspector`'s
    /// `inspector.open()` (Chrome DevTools, vscode-js-debug, ...). The
    /// debugger-thread server translates CDP to the JSC protocol.
    NodeInspector,
}

pub struct Debugger {
    // `'static` is genuine: set from `cli::cli_dupe` (process-lifetime CLI
    // arena) — see jsc_hooks.rs. Never freed.
    pub path_or_port: Option<&'static [u8]>,
    // `'static` is genuine: borrowed from process-lifetime env-var storage;
    // default `""`.
    pub from_environment_variable: &'static [u8],
    pub script_execution_context_id: u32,
    /// Set once the exit handshake has run for this thread; see
    /// `wait_for_debugger_to_disconnect`.
    pub has_waited_for_disconnect: bool,
    /// `process._debugEnd()` on this thread. Node's `_debugEnd` drops this
    /// agent's IO thread, after which `WaitForDisconnect` has no `io_` and
    /// does not wait; a later `inspector.open()` undoes it. Per-thread, like
    /// Node's per-agent state — a worker must not disarm the main thread.
    pub debug_ended: bool,
    pub next_debugger_id: u64,
    pub poll_ref: KeepAlive,
    pub wait_for_connection: Wait,
    // wait_for_connection: bool = false,
    pub set_breakpoint_on_first_line: bool,
    pub mode: Mode,
    pub protocol: Protocol,

    pub test_reporter_agent: TestReporterAgent,
    pub lifecycle_reporter_agent: LifecycleAgent,
    /// Reached through a shared `&Debugger` borrow; the slot's `Cell` fields
    /// provide the interior mutability. JS-thread only.
    pub extension_agent: ErasedAgentSlot,
    pub http_server_agent: HTTPServerAgent,
    pub must_block_until_connected: bool,
}

impl Default for Debugger {
    fn default() -> Self {
        Self {
            path_or_port: None,
            from_environment_variable: b"",
            script_execution_context_id: 0,
            has_waited_for_disconnect: false,
            debug_ended: false,
            next_debugger_id: 1,
            poll_ref: KeepAlive::default(),
            wait_for_connection: Wait::Off,
            set_breakpoint_on_first_line: false,
            mode: Mode::Listen,
            protocol: Protocol::Jsc,
            test_reporter_agent: TestReporterAgent::default(),
            lifecycle_reporter_agent: LifecycleAgent::default(),
            extension_agent: ErasedAgentSlot::default(),
            http_server_agent: HTTPServerAgent::default(),
            must_block_until_connected: false,
        }
    }
}

// SAFETY (safe fn): `JSGlobalObject` is an opaque `UnsafeCell`-backed handle
// (`&` is ABI-identical to non-null `*mut`); `BunString` is a `#[repr(C)]` POD
// out-param. Remaining args are by-value scalars.
unsafe extern "C" {
    safe fn Bun__createJSDebugger(global: &JSGlobalObject) -> u32;
    safe fn BunDebugger__notifyWaitingForDebugger(ctx_id: u32);
    safe fn BunDebugger__waitForDebuggerToDisconnect(ctx_id: u32, is_worker: bool);
    safe fn Bun__ensureDebugger(ctx_id: u32, wait: bool);
    safe fn Bun__startJSDebuggerThread(
        global: &JSGlobalObject,
        ctx_id: u32,
        url: &mut BunString,
        from_env: c_int,
        is_connect: bool,
        is_node_inspector: bool,
        enable_node_cdp: bool,
    );
}

static FUTEX_ATOMIC: AtomicU32 = AtomicU32::new(0);
pub(crate) static HAS_CREATED_DEBUGGER: AtomicBool = AtomicBool::new(false);
/// Script execution context of the thread currently blocked waiting for a
/// frontend (`--inspect-brk`, `--inspect-wait`, `inspector.waitForDebugger()`),
/// or 0 when none is. Contexts are what inspector connections are keyed by, so
/// a waiting worker must not answer for the main thread. Read from the debugger
/// thread to answer `NodeRuntime.enable`, hence atomic.
/// A single slot suffices because only one context can wait today (workers
/// publish no CDP target); with two simultaneous waiters the second store
/// would win.
static WAITING_FOR_DEBUGGER_CONTEXT: AtomicU32 = AtomicU32::new(0);

impl Debugger {
    /// `Debugger.waitForDebuggerIfNecessary(vm)` — block on the futex until
    /// `start()` (debugger thread) signals, then run the wait-loop until a
    /// frontend connects (`Debugger__didConnect`) or the deadline elapses.
    ///
    /// Aliasing: `this.debugger` is read through a raw pointer
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
        // Reset `must_block_until_connected` on every exit path. The wait is
        // over once this returns, including the `Wait::Shortly` timeout, so
        // clear the flag `NodeRuntime.enable` reads here too.
        let _reset = scopeguard::guard((), |()| {
            let _ = WAITING_FOR_DEBUGGER_CONTEXT.compare_exchange(
                ctx_id,
                0,
                Ordering::Relaxed,
                Ordering::Relaxed,
            );
            if let Some(d) = this.debugger_mut() {
                d.must_block_until_connected = false;
            }
        });

        bun_core::scoped_log!(debugger, "spin");
        // `FUTEX_ATOMIC` starts at 0 and nothing ever stores `1` before this
        // load, so this loop is a no-op on first call.
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
            // Placeholder — never read on the `.forever` path.
            bun_core::Timespec { sec: 0, nsec: 0 }
        };

        #[cfg(windows)]
        {
            // Arm a one-shot libuv timer that unrefs `poll_ref` after the
            // delay (Windows lacks a working `tickWithTimeout`). TODO: remove
            // this when tickWithTimeout actually works properly on Windows.
            use bun_sys::windows::libuv as uv;
            use bun_sys::windows::libuv::UvHandle as _;
            if wait == Wait::Shortly {
                let uv_loop = this.uv_loop();
                // SAFETY: `uv_loop` is a live initialized `uv_loop_t`.
                unsafe { uv::uv_update_time(uv_loop) };
                let timer: *mut uv::Timer =
                    bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed()));
                // SAFETY: `timer` freshly allocated; `uv_loop` valid.
                unsafe { (*timer).init(uv_loop) };

                extern "C" fn on_debugger_timer(handle: *mut uv::Timer) {
                    // SAFETY: `vm` is the per-thread singleton; called on the
                    // JS thread (libuv timer callback). Unwinding across
                    // `extern "C"` is UB so we early-return if no debugger.
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
        // the aliasing note on this fn. Each loop iteration re-fetches via `debugger_mut()`
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

                    this.uws_loop_mut()
                        .tick_with_timeout(Some(&deadline), bun_uws::NOW_NS_UNKNOWN);

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
    pub fn create(
        this: *mut VirtualMachine,
        global_object: &JSGlobalObject,
    ) -> crate::CrateResult<()> {
        bun_core::scoped_log!(debugger, "create");
        jsc::mark_binding();
        if HAS_CREATED_DEBUGGER.swap(true, Ordering::Relaxed) {
            return Ok(());
        }
        // `#[unsafe(no_mangle)]` already prevents the linker from stripping
        // the exported `Bun__*Agent*` symbols, so no explicit keep-alive
        // references are needed.

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
            // `std::thread::spawn` requires `Send`; raw `*mut
            // VirtualMachine` is `!Send`. Wrap in a `Send` newtype — the
            // pointer is only ever dereferenced on the debugger thread under
            // `holdAPILock` (see `start_js_debugger_thread` doc), and the VM
            // outlives the process.
            struct SendVmPtr(*mut VirtualMachine);
            // SAFETY: see comment above — cross-thread access is mediated
            // by `holdAPILock` / the futex; the VM allocation is `'static`.
            unsafe impl Send for SendVmPtr {}
            let send_vm = SendVmPtr(this);
            // Rust's `std::thread` default stack (2 MiB) is too small to run
            // a full `VirtualMachine::init` + JS module load on this thread,
            // so use 16 MiB.
            std::thread::Builder::new()
                .name("Debugger".to_string())
                .stack_size(16 * 1024 * 1024)
                .spawn(move || {
                    let send_vm = send_vm;
                    Debugger::start_js_debugger_thread(send_vm.0);
                })
                .map_err(|_| crate::CrateError::ThreadSpawnFailed)?;
            // The `JoinHandle` is dropped here, detaching the thread.
        }
        this_ref.event_loop_mut().ensure_waker();

        // Re-borrow after `ensure_waker` (which may touch `*this`).
        let dbg = this_ref.debugger_mut().unwrap();
        if dbg.wait_for_connection != Wait::Off {
            dbg.poll_ref.ref_(get_vm_ctx(AllocatorType::Js));
            dbg.must_block_until_connected = true;
            // Armed here, before the debugger thread can accept a frontend, so
            // a client that attaches immediately still sees the waiting state.
            // No broadcast: no connection can exist yet.
            WAITING_FOR_DEBUGGER_CONTEXT.store(dbg.script_execution_context_id, Ordering::Relaxed);
        }
        Ok(())
    }

    /// Debugger-thread entry: build a second `VirtualMachine`, hold the API
    /// lock, run `start()`.
    ///
    /// `other_vm` is the *parent thread's* VM. The parent thread
    /// continues executing (and mutating that VM) concurrently with this
    /// thread.
    /// Taking `&mut VirtualMachine` here would assert exclusive access we do
    /// not have — UB. We hold a raw `*VirtualMachine` and
    /// never materialize a `&`/`&mut VirtualMachine` to the foreign-thread VM.
    pub fn start_js_debugger_thread(other_vm: *mut VirtualMachine) {
        // The global allocator is mimalloc and `InitOptions` does not carry
        // `allocator`/`env_loader` (those are wired by
        // `RuntimeHooks::init_runtime_state`).
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Debugger"));
        bun_core::scoped_log!(debugger, "startJSDebuggerThread");
        jsc::mark_binding();

        let vm_ptr = VirtualMachine::init(crate::virtual_machine::InitOptions {
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

        extern "C" fn start_trampoline(ctx: *mut c_void) {
            // Forward the raw pointer unchanged — see fn doc above
            // for why we never form `&mut VirtualMachine` to the parent VM.
            Debugger::start(ctx.cast::<VirtualMachine>());
        }
        #[allow(deprecated)]
        vm.global()
            .vm()
            .hold_api_lock(other_vm.cast(), start_trampoline);
    }

    /// Runs inside `holdAPILock` on the
    /// debugger thread. Publishes the inspector URL(s), wakes the futex the
    /// parent VM is blocked on, then spins this thread's event loop forever.
    ///
    /// Aliasing: every `VirtualMachine` / `EventLoop` access here
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
    fn start(other_vm: *mut VirtualMachine) {
        jsc::mark_binding();

        // `this` is this thread's own VM (created in `start_js_debugger_thread`)
        // — safe to hold as `&'static`. `other_vm` remains a raw pointer (see
        // aliasing note above): the parent thread mutates it concurrently after the
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

        // Copy the four scalars we need from the parent VM's
        // debugger before re-entering JS or waking the parent. We run inside
        // an `extern "C"` trampoline where unwinding is UB — if `debugger` is
        // missing, wake the parent and bail instead (unreachable in
        // practice; `create()` always populates `debugger` before spawning).
        // SAFETY: `other_vm` live; short-lived shared borrow of `debugger`
        // ends before any other access to `*other_vm`.
        let (ctx_id, is_connect, is_node_inspector, from_env, path_or_port) =
            match unsafe { (*other_vm).debugger.as_deref() } {
                Some(d) => (
                    d.script_execution_context_id,
                    d.mode == Mode::Connect,
                    d.protocol == Protocol::NodeInspector,
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
            Bun__startJSDebuggerThread(global, ctx_id, &mut url, 1, is_connect, false, false);
        }

        if let Some(path_or_port) = path_or_port {
            let mut url = BunString::clone_utf8(path_or_port);
            let _scope = this.enter_event_loop_scope();
            // A `--inspect*` listener keeps its JSC-protocol pathname and adds
            // Node's `/json` endpoints plus a second, CDP-speaking pathname.
            // `inspector.open()` servers are already CDP-only.
            let enable_node_cdp = !is_node_inspector && !is_connect;
            Bun__startJSDebuggerThread(
                global,
                ctx_id,
                &mut url,
                0,
                is_connect,
                is_node_inspector,
                enable_node_cdp,
            );
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
        // Re-read `this.event_loop()` here rather than reusing
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

/// `inspector.open()` from `node:inspector` — start the debugger thread and
/// its WebSocket server at runtime, speaking the V8 Chrome DevTools Protocol.
/// Returns false when an inspector is already configured (CLI `--inspect`,
/// `BUN_INSPECT`, or a previous `inspector.open()`), when called off the main
/// thread, or when the debugger thread could not be started.
// HOST_EXPORT(Debugger__startNodeInspectorServer, c)
pub fn start_node_inspector_server(url: &mut BunString, wait_for_connection: bool) -> bool {
    // Short-lived borrows only — `Debugger::create` re-enters JS and forms its
    // own `&mut VirtualMachine` (see the aliasing note on
    // `wait_for_debugger_if_necessary`).
    let this: &VirtualMachine = VirtualMachine::get();
    if !this.is_main_thread {
        return false;
    }
    if this.debugger.is_some() || HAS_CREATED_DEBUGGER.load(Ordering::Relaxed) {
        return false;
    }

    // The URL outlives the process: the debugger struct stores `'static` slices
    // (CLI-arena lifetimes), so leak the runtime-provided URL the same way.
    let url_bytes: &'static [u8] = Box::leak(url.to_utf8_bytes().into_boxed_slice());
    this.as_mut().debugger = Some(Box::new(Debugger {
        path_or_port: Some(url_bytes),
        wait_for_connection: if wait_for_connection {
            Wait::Forever
        } else {
            Wait::Off
        },
        protocol: Protocol::NodeInspector,
        ..Default::default()
    }));

    // Frontends need positions that map back to the original source, so stop
    // minifying and caching transpiled output for code loaded from now on.
    // Left in place after inspector.close(): the debugger thread persists for
    // reopen, so modules loaded between close() and a later open() must still
    // have unminified positions.
    crate::runtime_transpiler_cache::IS_DISABLED.store(true, Ordering::Relaxed);
    {
        let opts = &mut this.as_mut().transpiler.options;
        opts.minify_identifiers = false;
        opts.minify_syntax = false;
        opts.minify_whitespace = false;
        opts.debugger = true;
    }

    let global = this.global;
    // SAFETY: `global` is set during `VirtualMachine::init` and outlives the VM.
    if Debugger::create(VirtualMachine::get_mut_ptr(), unsafe { &*global }).is_err() {
        this.as_mut().debugger = None;
        return false;
    }

    // Install Bun's controller before any yield can let a client
    // connectFrontend() to JSC's default one; the waiting path's later call
    // from wait_for_debugger_if_necessary is then a bunControllerInstalled
    // no-op that only handles the block.
    let ctx_id = match this.debugger.as_deref() {
        Some(d) => d.script_execution_context_id,
        None => return false,
    };
    Bun__ensureDebugger(ctx_id, false);

    true
}

/// `inspector.open(port, host, true)` / `inspector.waitForDebugger()` — block,
/// ticking the event loop, until a frontend connects to the inspector.
// HOST_EXPORT(Debugger__waitForNodeInspectorConnection, c)
pub fn wait_for_node_inspector_connection() {
    // Node blocks on every waitForDebugger() call for a fresh
    // Runtime.runIfWaitingForDebugger, even if a frontend already resolved a
    // previous wait — see test-inspector-wait-for-connection.js.
    let this = VirtualMachine::get();
    {
        let Some(dbg) = this.debugger_mut() else {
            return;
        };
        if dbg.wait_for_connection == Wait::Off {
            // Mirror `create()`: the ref pairs with the unref in `did_connect`.
            dbg.wait_for_connection = Wait::Forever;
            dbg.poll_ref.ref_(get_vm_ctx(AllocatorType::Js));
        }
        dbg.must_block_until_connected = true;
    }
    // A frontend may already be attached with the NodeRuntime domain enabled
    // (inspector.open() then waitForDebugger()); Node announces the new wait to
    // it, so tell the debugger thread before blocking.
    let ctx_id = match this.debugger.as_deref() {
        Some(d) => d.script_execution_context_id,
        None => 0,
    };
    WAITING_FOR_DEBUGGER_CONTEXT.store(ctx_id, Ordering::Relaxed);
    BunDebugger__notifyWaitingForDebugger(ctx_id);
    Debugger::wait_for_debugger_if_necessary(VirtualMachine::get_mut_ptr());
}

/// The debugger thread reported that `Bun.serve` failed (e.g. EADDRINUSE) —
/// undo `create()`'s `poll_ref.ref_()` so the process can exit. Without this
/// the ref leaks and the event loop never drains.
// HOST_EXPORT(Debugger__abandonNodeInspectorWait, c)
pub fn abandon_node_inspector_wait() {
    let Some(dbg) = VirtualMachine::get().debugger_mut() else {
        return;
    };
    let ctx_id = dbg.script_execution_context_id;
    if dbg.wait_for_connection != Wait::Off {
        dbg.wait_for_connection = Wait::Off;
        dbg.must_block_until_connected = false;
        dbg.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
    }
    let _ = WAITING_FOR_DEBUGGER_CONTEXT.compare_exchange(
        ctx_id,
        0,
        Ordering::Relaxed,
        Ordering::Relaxed,
    );
}

/// Answers `NodeRuntime.enable` on the debugger thread: Node emits
/// `NodeRuntime.waitingForDebugger` from that command exactly while the
/// inspected thread is blocked waiting for a frontend.
// HOST_EXPORT(Debugger__isWaitingForDebugger, c)
pub fn is_waiting_for_debugger(ctx_id: u32) -> bool {
    ctx_id != 0 && WAITING_FOR_DEBUGGER_CONTEXT.load(Ordering::Relaxed) == ctx_id
}

/// Node's `Agent::WaitForDisconnect`, run from the exit funnel: announce the
/// teardown to every attached CDP frontend and block until each disconnects.
/// A no-op unless a CDP frontend is attached to this thread's context.
pub fn wait_for_debugger_to_disconnect(vm: &VirtualMachine) {
    // The borrow must end before the call below: it blocks, and pumping the
    // inspector runs user JS on this thread (Runtime.evaluate), which can
    // re-enter anything that takes `&mut Debugger` — `inspector.open()`, or
    // `did_connect()` for a frontend finishing its handshake.
    let ctx_id = {
        let Some(dbg) = vm.debugger_mut() else {
            return;
        };
        // process.exit() inside an exit handler re-enters the funnel; wait once.
        if dbg.has_waited_for_disconnect || dbg.debug_ended {
            return;
        }
        dbg.has_waited_for_disconnect = true;
        dbg.script_execution_context_id
    };
    if ctx_id == 0 {
        return;
    }
    BunDebugger__waitForDebuggerToDisconnect(ctx_id, !vm.is_main_thread());
}

/// `inspector.open()` brings this thread's inspector back up, so a previous
/// `process._debugEnd()` no longer suppresses the exit handshake. The reopen
/// path reuses the existing `Debugger`, so clearing it here is required.
// HOST_EXPORT(Debugger__clearDebugEnd, c)
pub fn clear_debug_end() {
    if let Some(dbg) = VirtualMachine::get().debugger_mut() {
        dbg.debug_ended = false;
    }
}

/// `process._debugEnd()`. Only the exit-handshake half of Node's `_debugEnd`
/// is implemented: this thread's listener and any live session stay up.
// HOST_EXPORT(Debugger__debugEnd, c)
pub fn debug_end() {
    if let Some(dbg) = VirtualMachine::get().debugger_mut() {
        dbg.debug_ended = true;
    }
}

// HOST_EXPORT(Debugger__didConnect, c)
pub fn did_connect() {
    let this = VirtualMachine::get().as_mut();
    // SAFETY: `VirtualMachine::get()` returns the per-thread singleton; called
    // on the JS thread. If the debugger is missing we early-return
    // defensively (extern "C" — unwinding is UB).
    let Some(dbg) = this.debugger.as_deref_mut() else {
        return;
    };
    let ctx_id = dbg.script_execution_context_id;
    if dbg.wait_for_connection != Wait::Off {
        dbg.wait_for_connection = Wait::Off;
        dbg.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
        this.event_loop_mut().wakeup();
    }
    // Matches Node's runIfWaitingForDebugger -> unsetWaitingForDebugger: the
    // wait is resolved, so NodeRuntime.enable must stop announcing it.
    let _ = WAITING_FOR_DEBUGGER_CONTEXT.compare_exchange(
        ctx_id,
        0,
        Ordering::Relaxed,
        Ordering::Relaxed,
    );
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
    /// now and `did_dispatch` when the returned guard is dropped.
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
        // LAYERING: `retroactivelyReportDiscoveredTests` reaches into
        // the test runner (`bun_test.DescribeScope`), which lives in `bun_runtime::test_runner`
        // — a forward-dep cycle. Dispatched through [`RuntimeHooks`].
        if let Some(hooks) = runtime_hooks() {
            // SAFETY: `handle` is the live C++ agent just stored above.
            unsafe {
                (hooks.retroactively_report_discovered_tests)(dbg.test_reporter_agent.handle)
            };
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
    /// ensure `is_enabled()` (handle != null).
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

// SAFETY (safe fn): `LifecycleHandle` is an `opaque_ffi!` ZST handle (`!Freeze`
// via `UnsafeCell`); `ZigException` is a `#[repr(C)]` out-param the C++ side
// reads/fills in-place.
unsafe extern "C" {
    safe fn Bun__LifecycleAgentReportReload(agent: &mut LifecycleHandle);
    safe fn Bun__LifecycleAgentReportError(
        agent: &mut LifecycleHandle,
        exception: &mut ZigException,
    );
}

impl LifecycleHandle {
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

    pub(crate) fn report_error(&mut self, exception: &mut ZigException) {
        if let Some(h) = self.handle_mut() {
            h.report_error(exception);
        }
    }
}
