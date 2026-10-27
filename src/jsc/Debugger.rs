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

use bun_core::{String as BunString, StringView};
use bun_io::KeepAlive;
use bun_io::posix_event_loop::{AllocatorType, get_vm_ctx};

use crate::virtual_machine::{VirtualMachine, runtime_hooks};
use crate::{self as jsc, JSGlobalObject, ZigException};

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

/// Belongs to the debuggee VM and is only touched on its thread. The debugger
/// thread gets copies of what it needs ([`DebuggerThreadInit`]).
pub struct Debugger {
    // `'static` is genuine: set from `cli::cli_dupe` (process-lifetime CLI
    // arena) — see jsc_hooks.rs. Never freed.
    pub path_or_port: Option<&'static [u8]>,
    // `'static` is genuine: borrowed from process-lifetime env-var storage;
    // default `""`.
    pub from_environment_variable: &'static [u8],
    pub script_execution_context_id: Cell<u32>,
    pub next_debugger_id: Cell<u64>,
    pub poll_ref: KeepAlive,
    pub wait_for_connection: Cell<Wait>,
    pub set_breakpoint_on_first_line: bool,
    pub mode: Mode,
    pub protocol: Protocol,

    pub test_reporter_agent: TestReporterAgent,
    pub lifecycle_reporter_agent: LifecycleAgent,
    pub extension_agent: ErasedAgentSlot,
    pub http_server_agent: HTTPServerAgent,
    pub must_block_until_connected: Cell<bool>,
}

impl Default for Debugger {
    fn default() -> Self {
        Self {
            path_or_port: None,
            from_environment_variable: b"",
            script_execution_context_id: Cell::new(0),
            next_debugger_id: Cell::new(1),
            poll_ref: KeepAlive::default(),
            wait_for_connection: Cell::new(Wait::Off),
            set_breakpoint_on_first_line: false,
            mode: Mode::Listen,
            protocol: Protocol::Jsc,
            test_reporter_agent: TestReporterAgent::default(),
            lifecycle_reporter_agent: LifecycleAgent::default(),
            extension_agent: ErasedAgentSlot::default(),
            http_server_agent: HTTPServerAgent::default(),
            must_block_until_connected: Cell::new(false),
        }
    }
}

// SAFETY (safe fn): `JSGlobalObject` is an opaque `UnsafeCell`-backed handle
// (`&` is ABI-identical to non-null `*mut`); `BunString` is a `#[repr(C)]`
// in-param C++ only reads. Remaining args are by-value scalars.
unsafe extern "C" {
    safe fn Bun__createJSDebugger(global: &JSGlobalObject) -> u32;
    safe fn Bun__ensureDebugger(ctx_id: u32, wait: bool);
    safe fn Bun__startJSDebuggerThread(
        global: &JSGlobalObject,
        ctx_id: u32,
        url: &BunString,
        from_env: c_int,
        is_connect: bool,
        is_node_inspector: bool,
    );
}

static FUTEX_ATOMIC: AtomicU32 = AtomicU32::new(0);
static HAS_CREATED_DEBUGGER: AtomicBool = AtomicBool::new(false);

/// What [`Debugger::start`] takes from the debuggee VM's thread. The copy of
/// the debuggee's environment travels next to it and is used up by the VM setup.
struct DebuggerThreadInit {
    debuggee: crate::VmHandle,
    ctx_id: u32,
    is_connect: bool,
    is_node_inspector: bool,
    from_env: &'static [u8],
    path_or_port: Option<&'static [u8]>,
}

impl Debugger {
    /// `Debugger.waitForDebuggerIfNecessary(vm)` — block on the futex until
    /// `start()` (debugger thread) signals, then run the wait-loop until a
    /// frontend connects (`Debugger__didConnect`) or the deadline elapses.
    pub fn wait_for_debugger_if_necessary(this: &VirtualMachine) {
        debug_assert!(core::ptr::eq(this, VirtualMachine::get()));
        let Some(dbg) = this.debugger.get() else {
            return;
        };
        bun_analytics::features::debugger.fetch_add(1, Ordering::Relaxed);
        if !dbg.must_block_until_connected.get() {
            return;
        }
        let (ctx_id, wait) = (
            dbg.script_execution_context_id.get(),
            dbg.wait_for_connection.get(),
        );
        scopeguard::defer! { dbg.must_block_until_connected.set(false); }

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
                let uv_loop = this.uv_loop().as_ptr();
                // SAFETY: `uv_loop` is a live initialized `uv_loop_t`.
                unsafe { uv::uv_update_time(uv_loop) };
                let timer: *mut uv::Timer =
                    bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed()));
                // SAFETY: `timer` freshly allocated; `uv_loop` valid.
                unsafe { (*timer).init(uv_loop) };

                extern "C" fn on_debugger_timer(handle: *mut uv::Timer) {
                    if let Some(d) = VirtualMachine::get().debugger.get() {
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

        while dbg.wait_for_connection.get() != Wait::Off {
            this.event_loop().tick();
            // Re-read after `tick()` — `Debugger__didConnect` may have flipped it.
            match dbg.wait_for_connection.get() {
                Wait::Forever => {
                    this.event_loop().auto_tick_active();

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
                            this.uws_loop().unref_count(pending_unref);
                        }
                    }

                    this.uws_loop()
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
                        dbg.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
                        bun_core::scoped_log!(debugger, "Timed out waiting for the debugger");
                        break;
                    }
                }
                Wait::Off => break,
            }
        }
    }

    /// First-time debugger setup for `vm`, which `self` is (or is about to
    /// become) the debugger of: create the JSC inspector context, spawn the
    /// debugger VM thread, and arm the keep-alive on the parent loop.
    pub fn create(
        &self,
        vm: &VirtualMachine,
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

        debug_assert!(core::ptr::eq(vm, VirtualMachine::get()));
        let ctx_id = Bun__createJSDebugger(global_object);
        self.script_execution_context_id.set(ctx_id);

        if !vm.has_started_debugger.get() {
            vm.has_started_debugger.set(true);
            // Everything the debugger thread needs from this VM, copied here;
            // it reaches back only through the (uncounted) handle to wake us.
            // That includes the environment: the debugger VM builds its
            // `process.env` from this copy, not from this thread's loader.
            let env_map = vm.env_loader().map.clone_with_allocator()?;
            let init = DebuggerThreadInit {
                debuggee: vm.handle(),
                ctx_id,
                is_connect: self.mode == Mode::Connect,
                is_node_inspector: self.protocol == Protocol::NodeInspector,
                from_env: self.from_environment_variable,
                path_or_port: self.path_or_port,
            };
            // Rust's `std::thread` default stack (2 MiB) is too small to run
            // a full `VirtualMachine::init` + JS module load on this thread,
            // so use 16 MiB.
            std::thread::Builder::new()
                .name("Debugger".to_string())
                .stack_size(16 * 1024 * 1024)
                .spawn(move || Debugger::start_js_debugger_thread(env_map, init))
                .map_err(|_| crate::CrateError::ThreadSpawnFailed)?;
            // The `JoinHandle` is dropped here, detaching the thread.
        }
        vm.event_loop().ensure_waker();

        if self.wait_for_connection.get() != Wait::Off {
            self.poll_ref.ref_(get_vm_ctx(AllocatorType::Js));
            self.must_block_until_connected.set(true);
        }
        Ok(())
    }

    pub(crate) fn next_async_task_id(&self) -> u64 {
        let id = self.next_debugger_id.get().wrapping_add(1);
        self.next_debugger_id.set(id);
        id
    }

    /// Debugger-thread entry: build a second `VirtualMachine` on the
    /// debuggee's copied environment, hold the API lock, and run
    /// [`Debugger::start`] inside it.
    ///
    /// The VM only evaluates built-in modules, so `env_map` is the whole of
    /// its environment setup: `Transpiler::configure_defines` is not run here.
    /// It would reload the `.env` files and JSON-parse `NODE_ENV`, and its
    /// failure (say a stray `\r` in `NODE_ENV`) would abort the debuggee.
    fn start_js_debugger_thread(env_map: bun_dotenv::Map, init: DebuggerThreadInit) {
        // This thread serves the inspector up to (and during) `process.exit()`,
        // so it's never joined and its VM is never torn down.
        bun_core::asan::disable_leak_checks_on_current_thread();
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Debugger"));
        bun_core::scoped_log!(debugger, "startJSDebuggerThread");
        jsc::mark_binding();

        let vm = VirtualMachine::init(
            crate::virtual_machine::InitOptions {
                // Lives as long as the VM, which this thread never tears down.
                env_loader: Some(bun_core::heap::alloc_nn(bun_dotenv::Loader::init_with_map(
                    env_map,
                ))),
                is_main_thread: false,
                ..Default::default()
            },
            &mut |_| {},
        )
        .unwrap_or_else(|_| panic!("Failed to create Debugger VM"));
        vm.is_main_thread.set(false);
        vm.event_loop().ensure_waker();

        extern "C" fn start_trampoline(ctx: *mut c_void) {
            // SAFETY: `ctx` is `&mut slot` below; `hold_api_lock` calls this
            // synchronously on the same frame.
            let init = unsafe { (*ctx.cast::<Option<DebuggerThreadInit>>()).take() };
            Debugger::start(init.expect("init"));
        }
        let mut slot = Some(init);
        #[allow(deprecated)]
        vm.global()
            .vm()
            .hold_api_lock((&raw mut slot).cast(), start_trampoline);
    }

    /// Runs inside `holdAPILock` on the debugger thread. Publishes the
    /// inspector URL(s), wakes the futex the debuggee VM is blocked on, then
    /// spins this thread's event loop forever.
    fn start(init: DebuggerThreadInit) {
        jsc::mark_binding();

        let this: &VirtualMachine = VirtualMachine::get();
        let global: &JSGlobalObject = this.global();
        let DebuggerThreadInit {
            debuggee,
            ctx_id,
            is_connect,
            is_node_inspector,
            from_env,
            path_or_port,
        } = init;

        if !from_env.is_empty() {
            let url = StringView::borrow_utf8(from_env);
            let _scope = this.enter_event_loop_scope();
            Bun__startJSDebuggerThread(global, ctx_id, &url, 1, is_connect, false);
        }

        if let Some(path_or_port) = path_or_port {
            let url = StringView::borrow_utf8(path_or_port);
            let _scope = this.enter_event_loop_scope();
            Bun__startJSDebuggerThread(global, ctx_id, &url, 0, is_connect, is_node_inspector);
        }

        let _ = this.global().handle_rejected_promises();

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

        debuggee.wake();
        this.event_loop().tick();
        debuggee.wake();

        loop {
            while this.is_event_loop_alive() {
                this.tick();
                this.event_loop().auto_tick_active();
            }
            this.event_loop().tick_possibly_forever();
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
    let this = VirtualMachine::get();
    if !this.is_main_thread.get() {
        return false;
    }
    if this.debugger.get().is_some() || HAS_CREATED_DEBUGGER.load(Ordering::Relaxed) {
        return false;
    }

    // The URL outlives the process: the debugger struct stores `'static` slices
    // (CLI-arena lifetimes), so leak the runtime-provided URL the same way.
    let url_bytes: &'static [u8] = Box::leak(url.to_owned_slice().into_boxed_slice());
    let dbg = Box::new(Debugger {
        path_or_port: Some(url_bytes),
        wait_for_connection: Cell::new(if wait_for_connection {
            Wait::Forever
        } else {
            Wait::Off
        }),
        protocol: Protocol::NodeInspector,
        ..Default::default()
    });

    // Frontends need positions that map back to the original source, so stop
    // minifying and caching transpiled output for code loaded from now on.
    // Left in place after inspector.close(): the debugger thread persists for
    // reopen, so modules loaded between close() and a later open() must still
    // have unminified positions.
    crate::runtime_transpiler_cache::IS_DISABLED.store(true, Ordering::Relaxed);
    let opts = &this.transpiler().options;
    opts.minify_identifiers.set(false);
    opts.minify_syntax.set(false);
    opts.minify_whitespace.set(false);
    opts.debugger.set(true);

    // `vm.debugger` is set once, so only a debugger that started goes in.
    if dbg.create(this, this.global()).is_err() {
        return false;
    }
    let dbg = this.debugger.get_or_init(|| dbg);

    // Install Bun's controller before any yield can let a client
    // connectFrontend() to JSC's default one; the waiting path's later call
    // from wait_for_debugger_if_necessary is then a bunControllerInstalled
    // no-op that only handles the block.
    Bun__ensureDebugger(dbg.script_execution_context_id.get(), false);

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
    let Some(dbg) = this.debugger.get() else {
        return;
    };
    if dbg.wait_for_connection.get() == Wait::Off {
        // Mirror `create()`: the ref pairs with the unref in `did_connect`.
        dbg.wait_for_connection.set(Wait::Forever);
        dbg.poll_ref.ref_(get_vm_ctx(AllocatorType::Js));
    }
    dbg.must_block_until_connected.set(true);
    Debugger::wait_for_debugger_if_necessary(this);
}

/// The debugger thread reported that `Bun.serve` failed (e.g. EADDRINUSE) —
/// undo `create()`'s `poll_ref.ref_()` so the process can exit. Without this
/// the ref leaks and the event loop never drains.
// HOST_EXPORT(Debugger__abandonNodeInspectorWait, c)
pub fn abandon_node_inspector_wait() {
    let Some(dbg) = VirtualMachine::get().debugger.get() else {
        return;
    };
    if dbg.wait_for_connection.get() != Wait::Off {
        dbg.wait_for_connection.set(Wait::Off);
        dbg.must_block_until_connected.set(false);
        dbg.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
    }
}

// HOST_EXPORT(Debugger__didConnect, c)
pub fn did_connect() {
    let this = VirtualMachine::get();
    let Some(dbg) = this.debugger.get() else {
        return;
    };
    if dbg.wait_for_connection.get() != Wait::Off {
        dbg.wait_for_connection.set(Wait::Off);
        dbg.poll_ref.unref(get_vm_ctx(AllocatorType::Js));
        this.event_loop().wakeup();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AsyncTaskTracker — stable surface (used by pool jobs / event_loop).
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Default, Copy, Clone)]
pub struct AsyncTaskTracker {
    pub id: u64,
}

impl AsyncTaskTracker {
    pub fn init(vm: &VirtualMachine) -> AsyncTaskTracker {
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
    handle: Cell<*mut TestReporterHandle>,
    /// Shared `describe`/`test` ID counter for both the live
    /// (`ScopeFunctions::call`) and retroactive reporting paths.
    next_test_id: Cell<i32>,
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

// SAFETY (safe fn): `TestReporterHandle` is an `opaque_ffi!`
// ZST handle (`!Freeze` via `UnsafeCell`); `BunString` is a `#[repr(C)]`
// in/out-param the C++ side reads/consumes in-place. Remaining args are
// by-value scalars.
unsafe extern "C" {
    safe fn Bun__TestReporterAgentReportTestFound(
        agent: &TestReporterHandle,
        test_id: c_int,
        name: &BunString,
        item_type: TestType,
        parent_id: c_int,
    );
    safe fn Bun__TestReporterAgentReportTestFoundWithLocation(
        agent: &TestReporterHandle,
        test_id: c_int,
        name: &BunString,
        item_type: TestType,
        parent_id: c_int,
        source_url: &BunString,
        line: c_int,
    );
    safe fn Bun__TestReporterAgentReportTestStart(agent: &TestReporterHandle, test_id: c_int);
    safe fn Bun__TestReporterAgentReportTestEnd(
        agent: &TestReporterHandle,
        test_id: c_int,
        bun_test_status: TestStatus,
        elapsed: f64,
    );
}

impl TestReporterHandle {
    pub(crate) fn report_test_found(
        &self,
        test_id: i32,
        name: &BunString,
        item_type: TestType,
        parent_id: i32,
    ) {
        Bun__TestReporterAgentReportTestFound(self, test_id, name, item_type, parent_id);
    }

    pub fn report_test_found_with_location(
        &self,
        test_id: i32,
        name: &BunString,
        item_type: TestType,
        parent_id: i32,
        source_url: &BunString,
        line: i32,
    ) {
        Bun__TestReporterAgentReportTestFoundWithLocation(
            self, test_id, name, item_type, parent_id, source_url, line,
        );
    }

    pub(crate) fn report_test_start(&self, test_id: c_int) {
        Bun__TestReporterAgentReportTestStart(self, test_id);
    }

    pub(crate) fn report_test_end(
        &self,
        test_id: c_int,
        bun_test_status: TestStatus,
        elapsed: f64,
    ) {
        Bun__TestReporterAgentReportTestEnd(self, test_id, bun_test_status, elapsed);
    }
}

// HOST_EXPORT(Bun__TestReporterAgentEnable, c)
pub fn test_reporter_agent_enable(agent: &TestReporterHandle) {
    if let Some(dbg) = VirtualMachine::get().debugger.get() {
        bun_core::scoped_log!(TestReporterAgent, "enable");
        let reporter = &dbg.test_reporter_agent;
        reporter.handle.set(core::ptr::from_ref(agent).cast_mut());

        // Retroactively report any tests that were already discovered before
        // the debugger connected.
        //
        // LAYERING: `retroactivelyReportDiscoveredTests` reaches into
        // the test runner (`bun_test.DescribeScope`), which lives in `bun_runtime::test_runner`
        // — a forward-dep cycle. Dispatched through [`RuntimeHooks`].
        if let Some(hooks) = runtime_hooks() {
            reporter
                .next_test_id
                .set((hooks.retroactively_report_discovered_tests)(
                    agent,
                    reporter.next_test_id.get(),
                ));
        }
    }
}

// HOST_EXPORT(Bun__TestReporterAgentDisable, c)
pub fn test_reporter_agent_disable(_agent: *mut TestReporterHandle) {
    if let Some(dbg) = VirtualMachine::get().debugger.get() {
        bun_core::scoped_log!(TestReporterAgent, "disable");
        dbg.test_reporter_agent.handle.set(core::ptr::null_mut());
    }
}

impl TestReporterAgent {
    /// The live C++ `Inspector::TestReporterAgent*`. Panics unless
    /// `is_enabled()`.
    #[inline]
    fn handle(&self) -> &TestReporterHandle {
        TestReporterHandle::opaque_ref(self.handle.get())
    }

    /// The next `describe`/`test` ID.
    pub fn next_test_id(&self) -> i32 {
        let id = self.next_test_id.get() + 1;
        self.next_test_id.set(id);
        id
    }

    /// Caller must ensure that it is enabled first.
    ///
    /// Since we may have to call .deinit on the name string.
    ///
    /// The test's location is that of the caller of the host function that is running.
    pub fn report_test_found(
        &self,
        test_id: i32,
        name: &BunString,
        item_type: TestType,
        parent_id: i32,
    ) {
        bun_core::scoped_log!(TestReporterAgent, "reportTestFound");
        self.handle()
            .report_test_found(test_id, name, item_type, parent_id);
    }

    /// Caller must ensure that it is enabled first.
    pub fn report_test_start(&self, test_id: i32) {
        bun_core::scoped_log!(TestReporterAgent, "reportTestStart");
        self.handle().report_test_start(test_id);
    }

    /// Caller must ensure that it is enabled first.
    pub fn report_test_end(&self, test_id: i32, bun_test_status: TestStatus, elapsed: f64) {
        bun_core::scoped_log!(TestReporterAgent, "reportTestEnd");
        self.handle()
            .report_test_end(test_id, bun_test_status, elapsed);
    }

    pub fn is_enabled(&self) -> bool {
        !self.handle.get().is_null()
    }
}

// ─── LifecycleAgent ───────────────────────────────────────────────────────

#[derive(Default)]
pub struct LifecycleAgent {
    handle: Cell<*mut LifecycleHandle>,
}

bun_opaque::opaque_ffi! { pub struct LifecycleHandle; }

// SAFETY (safe fn): `LifecycleHandle` is an `opaque_ffi!` ZST handle (`!Freeze`
// via `UnsafeCell`); `ZigException` is a `#[repr(C)]` out-param the C++ side
// reads/fills in-place.
unsafe extern "C" {
    safe fn Bun__LifecycleAgentReportError(
        agent: &LifecycleHandle,
        exception: &mut ZigException<'_>,
    );
}

impl LifecycleHandle {
    pub(crate) fn report_error(&self, exception: &mut ZigException<'_>) {
        bun_core::scoped_log!(LifecycleAgent, "reportError");
        Bun__LifecycleAgentReportError(self, exception)
    }
}

// HOST_EXPORT(Bun__LifecycleAgentEnable, c)
pub fn lifecycle_agent_enable(agent: *mut LifecycleHandle) {
    if let Some(dbg) = VirtualMachine::get().debugger.get() {
        bun_core::scoped_log!(LifecycleAgent, "enable");
        dbg.lifecycle_reporter_agent.handle.set(agent);
    }
}

// HOST_EXPORT(Bun__LifecycleAgentDisable, c)
pub fn lifecycle_agent_disable(_agent: *mut LifecycleHandle) {
    if let Some(dbg) = VirtualMachine::get().debugger.get() {
        bun_core::scoped_log!(LifecycleAgent, "disable");
        dbg.lifecycle_reporter_agent
            .handle
            .set(core::ptr::null_mut());
    }
}

impl LifecycleAgent {
    pub(crate) fn report_error(&self, exception: &mut ZigException<'_>) {
        let handle = self.handle.get();
        if !handle.is_null() {
            LifecycleHandle::opaque_ref(handle).report_error(exception);
        }
    }
}
