//! The Subprocess object is returned by `Bun.spawn`. This file also holds the
//! code for `Bun.spawnSync`

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use std::sync::atomic::AtomicU32;
use std::sync::Arc;

use bun_ptr::{IntrusiveRc, IntrusiveRefCounted};

use bun_aio::{FilePoll, KeepAlive};
use bun_collections::CowString;
use bun_core::Output;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, JSGlobalObject, JSPromise, JSValue, JsRef, JsResult,
    VirtualMachine, ZigString,
};
use bun_runtime::api::bun::Terminal;
use bun_runtime::api::Timer::EventLoopTimer;
use bun_runtime::node::node_cluster_binding;
use bun_runtime::webcore::{self, AbortSignal, Blob, FileSink};
use bun_spawn::{self, PosixSpawnResult, Process, Rusage, Status, WindowsSpawnResult};
use bun_sys::{self, Fd, SignalCode};
use enumset::{EnumSet, EnumSetType};

use crate::api::bun::js_bun_spawn_bindings;
use crate::jsc::ipc as IPC;

pub mod resource_usage;
pub use resource_usage::ResourceUsage;

pub mod subprocess_pipe_reader;
pub use subprocess_pipe_reader as PipeReader;

pub mod readable;
pub use readable::Readable;

pub mod writable;
pub use writable::Writable;

pub mod static_pipe_writer;
pub use static_pipe_writer::NewStaticPipeWriter;

pub use bun_io::MaxBuf;
pub use js_bun_spawn_bindings::{spawn, spawn_sync};

bun_output::declare_scope!(Subprocess, visible);
bun_output::declare_scope!(IPC, visible);

// `toJS`/`fromJS`/`fromJSDirect` are wired by `#[bun_jsc::JsClass]`; do not re-export here.
// TODO(port): codegen — cached-property accessors (exitedPromiseGetCached, stdinGetCached, etc.)
// from `jsc.Codegen.JSSubprocess` are still needed; the derive emits this `js` module.
pub mod js {
    pub use bun_jsc::codegen::JSSubprocess::*;
}

/// Platform-dependent stdio result type.
#[cfg(windows)]
pub type StdioResult = WindowsSpawnResult::StdioResult;
#[cfg(not(windows))]
pub type StdioResult = Option<Fd>;

#[cfg(windows)]
type StdioPipeItem = StdioResult;
#[cfg(not(windows))]
type StdioPipeItem = PosixSpawnResult::ExtraPipe;

pub type StaticPipeWriter<'a> = NewStaticPipeWriter<Subprocess<'a>>;

#[derive(EnumSetType, strum::IntoStaticStr)]
pub enum ObservableGetter {
    Stdin,
    Stdout,
    Stderr,
}

#[derive(EnumSetType, strum::IntoStaticStr)]
pub enum StdioKind {
    Stdin,
    Stdout,
    Stderr,
}

impl StdioKind {
    pub fn to_fd(self) -> Fd {
        match self {
            StdioKind::Stdin => Fd::stdin(),
            StdioKind::Stdout => Fd::stdout(),
            StdioKind::Stderr => Fd::stderr(),
        }
    }

    pub fn to_num(self) -> c_int {
        match self {
            StdioKind::Stdin => 0,
            StdioKind::Stdout => 1,
            StdioKind::Stderr => 2,
        }
    }
}

#[bun_jsc::JsClass]
pub struct Subprocess<'a> {
    pub ref_count: Cell<u32>,
    // ManuallyDrop so finalize() can release the strong ref at the same point as Zig's
    // `process.deref()` (before the intrusive ref_count hits zero).
    pub process: ManuallyDrop<Arc<Process>>,
    pub stdin: Writable,
    pub stdout: Readable,
    pub stderr: Readable,
    pub stdio_pipes: Vec<StdioPipeItem>,
    pub pid_rusage: Option<Rusage>,

    /// Terminal attached to this subprocess (if spawned with terminal option)
    pub terminal: Option<&'a Terminal>,

    pub global_this: &'a JSGlobalObject,
    pub observable_getters: EnumSet<ObservableGetter>,
    pub closed: EnumSet<StdioKind>,
    pub this_value: JsRef,

    /// `None` indicates all of the IPC data is uninitialized.
    pub ipc_data: Option<IPC::SendQueue>,
    pub flags: Flags,

    // TODO(port): lifetime — weak observer, nulled in onStdinDestroyed; no ownership
    pub weak_file_sink_stdin_ptr: Option<NonNull<FileSink>>,
    pub abort_signal: Option<Arc<AbortSignal>>,

    pub event_loop_timer_refd: bool,
    pub event_loop_timer: EventLoopTimer,
    pub kill_signal: SignalCode,

    pub stdout_maxbuf: Option<Arc<MaxBuf>>,
    pub stderr_maxbuf: Option<Arc<MaxBuf>>,
    pub exited_due_to_maxbuf: Option<MaxBuf::Kind>,
}

// Intrusive ref-count: bun.ptr.RefCount(@This(), "ref_count", deinit, .{})
// `IntrusiveRc<Subprocess>` provides ref/deref and frees the Box when ref_count → 0.
impl IntrusiveRefCounted for Subprocess<'_> {
    fn ref_count(&self) -> &Cell<u32> {
        &self.ref_count
    }
}
pub type SubprocessRc<'a> = IntrusiveRc<Subprocess<'a>>;

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u8 {
        const IS_SYNC                      = 1 << 0;
        const KILLED                       = 1 << 1;
        const HAS_STDIN_DESTRUCTOR_CALLED  = 1 << 2;
        const FINALIZED                    = 1 << 3;
        const DEREF_ON_STDIN_DESTROYED     = 1 << 4;
        const IS_STDIN_A_READABLE_STREAM   = 1 << 5;
        /// Terminal was created inline by spawn (vs. an existing Terminal passed
        /// by the caller). Owned terminals are closed when the subprocess exits
        /// so the exit callback fires; borrowed terminals are left open for reuse.
        const OWNS_TERMINAL                = 1 << 6;
    }
}

// TODO(port): Poll appears unreferenced (dead code per LIFETIMES.tsv). Porting for parity.
pub enum Poll {
    PollRef(Option<NonNull<FilePoll>>), // TODO(port): lifetime
    WaitThread(WaitThreadPoll),
}

pub struct WaitThreadPoll {
    pub ref_count: AtomicU32,
    pub poll_ref: KeepAlive,
}

impl Default for WaitThreadPoll {
    fn default() -> Self {
        Self {
            ref_count: AtomicU32::new(0),
            poll_ref: KeepAlive::default(),
        }
    }
}

#[inline]
pub fn assert_stdio_result(result: StdioResult) {
    #[cfg(debug_assertions)]
    {
        #[cfg(unix)]
        {
            if let Some(fd) = result {
                debug_assert!(fd != bun_sys::INVALID_FD);
            }
        }
        #[cfg(not(unix))]
        let _ = result;
    }
    #[cfg(not(debug_assertions))]
    let _ = result;
}

pub extern "C" fn on_abort_signal(subprocess_ctx: *mut c_void, _reason: JSValue) {
    // SAFETY: subprocess_ctx was registered as `this` when the abort listener was attached.
    let this: &mut Subprocess = unsafe { &mut *(subprocess_ctx.cast::<Subprocess>()) };
    this.clear_abort_signal();
    let _ = this.try_kill(this.kill_signal);
}

impl Subprocess<'_> {
    #[bun_jsc::host_fn(method)]
    pub fn resource_usage(
        this: &mut Self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.create_resource_usage_object(global_object)
    }

    pub fn create_resource_usage_object(
        &mut self,
        global_object: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let rusage_ref = 'brk: {
            if self.pid_rusage.is_some() {
                break 'brk self.pid_rusage.as_ref().unwrap();
            }

            #[cfg(windows)]
            {
                if matches!(self.process.poller, bun_spawn::Poller::Uv(_)) {
                    self.pid_rusage =
                        Some(bun_spawn::process::uv_getrusage(self.process.poller.uv()));
                    break 'brk self.pid_rusage.as_ref().unwrap();
                }
            }

            return Ok(JSValue::UNDEFINED);
        };
        ResourceUsage::create(rusage_ref, global_object)
    }

    pub fn has_exited(&self) -> bool {
        self.process.has_exited()
    }

    pub fn compute_has_pending_activity(&self) -> bool {
        // `ipc_data` is never set back to `None` after init, so checking only
        // for `is_some()` would keep the JSSubprocess strongly referenced for the
        // lifetime of the VM. The IPC side contributes pending activity until
        // `_onAfterIPCClosed` has actually run: gating on `close_event_sent`
        // (rather than `socket != .closed`) keeps the wrapper Strong across the
        // window where the socket is already `.closed` but the task holding a
        // raw `*SendQueue` into `ipc_data` is still queued.
        if let Some(ipc) = &self.ipc_data {
            if !ipc.close_event_sent {
                return true;
            }
        }

        if self.has_pending_activity_stdio() {
            return true;
        }

        if !self.process.has_exited() {
            return true;
        }

        false
    }

    pub fn update_has_pending_activity(&mut self) {
        if self.flags.contains(Flags::IS_SYNC) {
            return;
        }

        let has_pending = self.compute_has_pending_activity();
        if cfg!(debug_assertions) {
            bun_output::scoped_log!(Subprocess, "updateHasPendingActivity() -> {}", has_pending);
        }

        // Upgrade or downgrade the reference based on pending activity
        if has_pending {
            self.this_value.upgrade(self.global_this);
        } else {
            self.this_value.downgrade();
        }
    }

    pub fn has_pending_activity_stdio(&self) -> bool {
        if self.stdin.has_pending_activity() {
            return true;
        }

        // PERF(port): was `inline for` over .{stdout, stderr} — unrolled manually.
        if self.stdout.has_pending_activity() {
            return true;
        }
        if self.stderr.has_pending_activity() {
            return true;
        }

        false
    }

    pub fn on_close_io(&mut self, kind: StdioKind) {
        match kind {
            StdioKind::Stdin => match &mut self.stdin {
                Writable::Pipe(pipe) => {
                    pipe.signal.clear();
                    pipe.deref();
                    self.stdin = Writable::Ignore;
                }
                Writable::Buffer(buffer) => {
                    buffer.source.detach();
                    buffer.deref();
                    self.stdin = Writable::Ignore;
                }
                _ => {}
            },
            StdioKind::Stdout | StdioKind::Stderr => {
                let out: &mut Readable = if kind == StdioKind::Stdout {
                    &mut self.stdout
                } else {
                    &mut self.stderr
                };
                match out {
                    Readable::Pipe(pipe) => {
                        if let PipeReader::State::Done(done) = &mut pipe.state {
                            let taken = core::mem::take(done);
                            *out = Readable::Buffer(CowString::init_owned(taken));
                            // pipe.state was emptied via take()
                        } else {
                            *out = Readable::Ignore;
                        }
                        // PORT NOTE: pipe.deref() handled by Rc<PipeReader> Drop when *out is reassigned.
                    }
                    _ => {}
                }
            }
        }

        // When the process exits before its stdout/stderr pipes have finished
        // draining, onProcessExit's deferred updateHasPendingActivity() observes
        // the pipe as still pending and keeps `this_value` Strong. When the pipe
        // later completes and reaches here, we must re-evaluate so the JsRef can
        // be downgraded and the JSSubprocess + buffered output become collectable.
        self.update_has_pending_activity();
    }

    pub fn js_ref(&mut self) {
        self.process.enable_keeping_event_loop_alive();

        if !self.has_called_getter(ObservableGetter::Stdin) {
            self.stdin.ref_();
        }

        if !self.has_called_getter(ObservableGetter::Stdout) {
            self.stdout.ref_();
        }

        if !self.has_called_getter(ObservableGetter::Stderr) {
            self.stderr.ref_();
        }

        self.update_has_pending_activity();
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub fn js_unref(&mut self) {
        self.process.disable_keeping_event_loop_alive();

        if !self.has_called_getter(ObservableGetter::Stdin) {
            self.stdin.unref();
        }

        if !self.has_called_getter(ObservableGetter::Stdout) {
            self.stdout.unref();
        }

        if !self.has_called_getter(ObservableGetter::Stderr) {
            self.stderr.unref();
        }

        self.update_has_pending_activity();
    }

    #[bun_jsc::host_fn]
    pub fn constructor(
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<*mut Subprocess> {
        Err(global_object.throw("Cannot construct Subprocess", &[]))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stderr(this: &mut Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // When terminal is used, stderr goes through the terminal
        if this.terminal.is_some() {
            return Ok(JSValue::NULL);
        }
        this.observable_getters.insert(ObservableGetter::Stderr);
        this.stderr.to_js(global_this, this.has_exited())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stdin(this: &mut Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // When terminal is used, stdin goes through the terminal
        if this.terminal.is_some() {
            return Ok(JSValue::NULL);
        }
        this.observable_getters.insert(ObservableGetter::Stdin);
        // PORT NOTE: reshaped for borrowck — Writable::to_js needs &mut self and *Subprocess.
        let self_ptr = this as *mut Subprocess;
        this.stdin.to_js(global_this, self_ptr)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stdout(this: &mut Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // When terminal is used, stdout goes through the terminal
        if this.terminal.is_some() {
            return Ok(JSValue::NULL);
        }
        this.observable_getters.insert(ObservableGetter::Stdout);
        // NOTE: ownership of internal buffers is transferred to the JSValue, which
        // gets cached on JSSubprocess (created via bindgen). This makes it
        // re-accessable to JS code but not via `this.stdout`, which is now `.closed`.
        this.stdout.to_js(global_this, this.has_exited())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_terminal(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        if let Some(terminal) = this.terminal {
            return terminal.to_js(global_this);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(method)]
    pub fn async_dispose(
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.process.has_exited() {
            // rely on GC to clean everything up in this case
            return Ok(JSValue::UNDEFINED);
        }

        let this_jsvalue = callframe.this();

        let _keep = jsc::EnsureStillAlive(this_jsvalue);

        // unref streams so that this disposed process will not prevent
        // the process from exiting causing a hang
        this.stdin.unref();
        this.stdout.unref();
        this.stderr.unref();

        match this.try_kill(this.kill_signal) {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(err) => {
                // Signal 9 should always be fine, but just in case that somehow fails.
                return Err(global.throw_value(err.to_js(global)?));
            }
        }

        Ok(this.get_exited(this_jsvalue, global))
    }

    pub fn set_event_loop_timer_refd(&mut self, refd: bool) {
        if self.event_loop_timer_refd == refd {
            return;
        }
        self.event_loop_timer_refd = refd;
        let vm = self.global_this.bun_vm();
        if refd {
            vm.timer.increment_timer_ref(1);
        } else {
            vm.timer.increment_timer_ref(-1);
        }
    }

    pub fn timeout_callback(&mut self) {
        self.set_event_loop_timer_refd(false);
        if self.event_loop_timer.state == EventLoopTimer::State::CANCELLED {
            return;
        }
        if self.has_exited() {
            self.event_loop_timer.state = EventLoopTimer::State::CANCELLED;
            return;
        }
        self.event_loop_timer.state = EventLoopTimer::State::FIRED;
        let _ = self.try_kill(self.kill_signal);
    }

    pub fn on_max_buffer(&mut self, kind: MaxBuf::Kind) {
        self.exited_due_to_maxbuf = Some(kind);
        let _ = self.try_kill(self.kill_signal);
    }

    #[bun_jsc::host_fn(method)]
    pub fn kill(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // Safe: this method can only be called while the object is alive (reachable from JS)
        // The finalizer only runs when the object becomes unreachable
        this.this_value.update(global_this, callframe.this());

        let arguments = callframe.arguments_old(1);
        // If signal is 0, then no actual signal is sent, but error checking
        // is still performed.
        let sig: SignalCode = SignalCode::from_js(arguments.ptr[0], global_this)?;

        if global_this.has_exception() {
            return Ok(JSValue::ZERO);
        }

        match this.try_kill(sig) {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(err) => {
                // EINVAL or ENOSYS means the signal is not supported in the current platform (most likely unsupported on windows)
                return Err(global_this.throw_value(err.to_js(global_this)?));
            }
        }

        Ok(JSValue::UNDEFINED)
    }

    pub fn has_killed(&self) -> bool {
        self.process.has_killed()
    }

    pub fn try_kill(&mut self, sig: SignalCode) -> bun_sys::Result<()> {
        if self.has_exited() {
            return bun_sys::Result::Ok(());
        }
        self.process.kill(sig as u8)
    }

    fn has_called_getter(&self, getter: ObservableGetter) -> bool {
        self.observable_getters.contains(getter)
    }

    fn close_process(&mut self) {
        #[cfg(not(target_os = "linux"))]
        {
            return;
        }
        #[cfg(target_os = "linux")]
        {
            self.process.close();
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.js_ref();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.js_unref();
        Ok(JSValue::UNDEFINED)
    }

    pub fn on_stdin_destroyed(&mut self) {
        let must_deref = self.flags.contains(Flags::DEREF_ON_STDIN_DESTROYED);
        self.flags.remove(Flags::DEREF_ON_STDIN_DESTROYED);
        let guard = scopeguard::guard((), |_| {
            if must_deref {
                self.deref();
            }
        });

        self.flags.insert(Flags::HAS_STDIN_DESTRUCTOR_CALLED);
        self.weak_file_sink_stdin_ptr = None;

        if !self.flags.contains(Flags::FINALIZED) {
            // otherwise update the pending activity flag
            self.update_has_pending_activity();
        }

        drop(guard);
        // TODO(port): errdefer — scopeguard captures &mut self; reshaped above. Phase B verify.
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_send(
        this: &mut Self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(IPC, "Subprocess#doSend");

        let ipc_data = this.ipc_data.as_mut();
        let context = if this.has_exited() {
            IPC::SendContext::SubprocessExited
        } else {
            IPC::SendContext::Subprocess
        };
        IPC::do_send(ipc_data, global, call_frame, context)
    }

    pub fn disconnect_ipc(&mut self, next_tick: bool) {
        let Some(ipc_data) = self.ipc() else { return };
        ipc_data.close_socket_next_tick(next_tick);
    }

    #[bun_jsc::host_fn(method)]
    pub fn disconnect(
        this: &mut Self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        this.disconnect_ipc(true);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_connected(this: &mut Self, _global_this: &JSGlobalObject) -> JSValue {
        let ipc_data = this.ipc();
        JSValue::from(ipc_data.is_some() && ipc_data.unwrap().is_connected())
    }

    pub fn pid(&self) -> i32 {
        i32::try_from(self.process.pid).unwrap()
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_pid(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.pid())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_killed(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(this.has_killed())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stdio(this: &mut Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let array = JSValue::create_empty_array(global, 0)?;
        array.push(global, JSValue::NULL)?;
        array.push(global, JSValue::NULL)?; // TODO: align this with options
        array.push(global, JSValue::NULL)?; // TODO: align this with options

        for item in this.stdio_pipes.iter() {
            #[cfg(windows)]
            {
                if let StdioResult::Buffer(buffer) = item {
                    let fdno: usize = buffer.fd().cast() as usize;
                    array.push(global, JSValue::js_number(fdno))?;
                } else {
                    array.push(global, JSValue::NULL)?;
                }
            }
            #[cfg(not(windows))]
            {
                match item {
                    PosixSpawnResult::ExtraPipe::OwnedFd(fd)
                    | PosixSpawnResult::ExtraPipe::UnownedFd(fd) => {
                        array.push(global, JSValue::js_number(fd.cast()))?;
                    }
                    PosixSpawnResult::ExtraPipe::Unavailable => {
                        array.push(global, JSValue::NULL)?;
                    }
                }
            }
        }
        Ok(array)
    }

    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<Self>()
            + self.process.memory_cost()
            + self.stdin.memory_cost()
            + self.stdout.memory_cost()
            + self.stderr.memory_cost()
    }

    fn consume_exited_promise(this_jsvalue: JSValue, global_this: &JSGlobalObject) -> Option<JSValue> {
        if let Some(promise) = js::exited_promise_get_cached(this_jsvalue) {
            js::exited_promise_set_cached(this_jsvalue, global_this, JSValue::ZERO);
            return Some(promise);
        }
        None
    }

    fn consume_on_exit_callback(
        this_jsvalue: JSValue,
        global_this: &JSGlobalObject,
    ) -> Option<JSValue> {
        if let Some(callback) = js::on_exit_callback_get_cached(this_jsvalue) {
            js::on_exit_callback_set_cached(this_jsvalue, global_this, JSValue::ZERO);
            return Some(callback);
        }
        None
    }

    fn consume_on_disconnect_callback(
        this_jsvalue: JSValue,
        global_this: &JSGlobalObject,
    ) -> Option<JSValue> {
        if let Some(callback) = js::on_disconnect_callback_get_cached(this_jsvalue) {
            js::on_disconnect_callback_set_cached(this_jsvalue, global_this, JSValue::ZERO);
            return Some(callback);
        }
        None
    }

    pub fn on_process_exit(&mut self, process: &Process, status: Status, rusage: &Rusage) {
        bun_output::scoped_log!(Subprocess, "onProcessExit()");
        let this_jsvalue = self.this_value.try_get().unwrap_or(JSValue::ZERO);
        let global_this = self.global_this;
        let jsc_vm = global_this.bun_vm();
        this_jsvalue.ensure_still_alive();
        self.pid_rusage = Some(*rusage);
        let is_sync = self.flags.contains(Flags::IS_SYNC);
        self.clear_abort_signal();

        // defer this.deref();
        // defer this.disconnectIPC(true);
        // TODO(port): errdefer — using scopeguard for the two trailing defers; they capture
        // &mut self which conflicts with the body. Reshaped: explicit calls at every return point.
        // For now we run them at the end and at early-return sites manually.

        if self.event_loop_timer.state == EventLoopTimer::State::ACTIVE {
            jsc_vm.timer.remove(&mut self.event_loop_timer);
        }
        self.set_event_loop_timer_refd(false);

        jsc_vm.on_subprocess_exit(process);

        #[cfg(windows)]
        if self.flags.contains(Flags::OWNS_TERMINAL) {
            // POSIX gets EOF on the master when the child (last slave_fd holder)
            // exits. ConPTY's conhost stays alive after the child exits, so close
            // the pseudoconsole now to deliver EOF and fire the terminal's exit
            // callback. Leaves the Terminal itself open to match POSIX.
            if let Some(terminal) = self.terminal {
                // SAFETY: terminal pointer is valid while subprocess is alive.
                unsafe { terminal.as_ref() }.close_pseudoconsole();
            }
        }

        let mut stdin: Option<NonNull<FileSink>> =
            if matches!(self.stdin, Writable::Pipe(_))
                && self.flags.contains(Flags::IS_STDIN_A_READABLE_STREAM)
            {
                if let Writable::Pipe(pipe) = &self.stdin {
                    Some(NonNull::from(pipe.as_ref()))
                    // TODO(port): Writable::Pipe payload type — assuming &FileSink-like.
                } else {
                    unreachable!()
                }
            } else {
                self.weak_file_sink_stdin_ptr
            };
        let mut existing_stdin_value = JSValue::ZERO;
        if !this_jsvalue.is_empty() {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                if existing_value.is_cell() {
                    if stdin.is_none() {
                        // TODO: review this cast
                        stdin = FileSink::JSSink::from_js(existing_value)
                            .map(|p| NonNull::from(p));
                    }

                    if !self.flags.contains(Flags::IS_STDIN_A_READABLE_STREAM) {
                        existing_stdin_value = existing_value;
                    }
                }
            }
        }

        // We won't be sending any more data.
        if let Writable::Buffer(buffer) = &mut self.stdin {
            buffer.close();
        }

        if !existing_stdin_value.is_empty() {
            FileSink::JSSink::set_destroy_callback(existing_stdin_value, 0);
        }

        if self.flags.contains(Flags::IS_SYNC) {
            // This doesn't match Node.js' behavior, but for synchronous
            // subprocesses the streams should not keep the timers going.
            if matches!(self.stdout, Readable::Pipe(_)) {
                self.stdout.close();
            }

            if matches!(self.stderr, Readable::Pipe(_)) {
                self.stderr.close();
            }
        } else {
            // This matches Node.js behavior. Node calls resume() on the streams.
            if let Readable::Pipe(pipe) = &mut self.stdout {
                if !pipe.reader.is_done() {
                    pipe.reader.read();
                }
            }

            if let Readable::Pipe(pipe) = &mut self.stderr {
                if !pipe.reader.is_done() {
                    pipe.reader.read();
                }
            }
        }

        if let Some(pipe_ptr) = stdin {
            self.weak_file_sink_stdin_ptr = None;
            self.flags.insert(Flags::HAS_STDIN_DESTRUCTOR_CALLED);

            // SAFETY: pipe_ptr came from a live FileSink (either self.stdin.pipe or the cached JS sink).
            let pipe = unsafe { pipe_ptr.as_ref() };

            // `onAttachedProcessExit()` → `writer.close()` → `FileSink.onClose`
            // fires `pipe.signal` synchronously on POSIX. When the signal still
            // targets `&self.stdin` (the user never read `.stdin`, or did and
            // `Writable.toJS` left it wired), that would re-enter
            // `Writable.onClose` → `pipe.deref()` while `onAttachedProcessExit`
            // is still running on `pipe`. Detach the signal first and drive the
            // `onStdinDestroyed()` deref ourselves instead; this also leaves
            // `self.stdin` as `.pipe` so reading `.stdin` after exit still
            // returns the sink.
            if core::ptr::eq(
                pipe.signal.ptr() as *const c_void,
                &self.stdin as *const Writable as *const c_void,
            ) {
                pipe.signal.clear();
            }
            let must_deref = self.flags.contains(Flags::DEREF_ON_STDIN_DESTROYED);
            self.flags.remove(Flags::DEREF_ON_STDIN_DESTROYED);

            pipe.on_attached_process_exit(&status);

            if must_deref {
                self.deref();
            }
        }

        let mut did_update_has_pending_activity = false;

        let event_loop = jsc_vm.event_loop();

        if !is_sync {
            if !this_jsvalue.is_empty() {
                if let Some(promise) = Self::consume_exited_promise(this_jsvalue, global_this) {
                    event_loop.enter();
                    // defer loop.exit() — handled below
                    let _exit_guard = scopeguard::guard((), |_| event_loop.exit());

                    if !did_update_has_pending_activity {
                        self.update_has_pending_activity();
                        did_update_has_pending_activity = true;
                    }

                    match status {
                        Status::Exited(exited) => {
                            let _ = promise
                                .as_any_promise()
                                .unwrap()
                                .resolve(global_this, JSValue::js_number(exited.code));
                            // TODO: properly propagate exception upwards
                        }
                        Status::Err(err) => {
                            match err.to_js(global_this) {
                                Ok(js_err) => {
                                    let _ = promise
                                        .as_any_promise()
                                        .unwrap()
                                        .reject_with_async_stack(global_this, js_err);
                                    // TODO: properly propagate exception upwards
                                }
                                Err(_) => {
                                    // Zig: `catch return` — fall through to deferred cleanup.
                                    // Defer LIFO: loop.exit() runs FIRST, then the outer defers.
                                    drop(_exit_guard);
                                    if !did_update_has_pending_activity {
                                        self.update_has_pending_activity();
                                    }
                                    self.disconnect_ipc(true);
                                    self.deref();
                                    return;
                                }
                            }
                        }
                        Status::Signaled(signaled) => {
                            let _ = promise.as_any_promise().unwrap().resolve(
                                global_this,
                                JSValue::js_number(128u32.wrapping_add(signaled as u32)),
                            );
                            // TODO: properly propagate exception upwards
                        }
                        _ => {
                            // crash in debug mode
                            #[cfg(debug_assertions)]
                            unreachable!();
                        }
                    }
                }

                if let Some(callback) = Self::consume_on_exit_callback(this_jsvalue, global_this) {
                    let waitpid_value: JSValue = if let Status::Err(err) = &status {
                        match err.to_js(global_this) {
                            Ok(v) => v,
                            Err(_) => {
                                if !did_update_has_pending_activity {
                                    self.update_has_pending_activity();
                                }
                                self.disconnect_ipc(true);
                                self.deref();
                                return;
                            }
                        }
                    } else {
                        JSValue::UNDEFINED
                    };

                    let this_value: JSValue = if this_jsvalue.is_empty_or_undefined_or_null() {
                        JSValue::UNDEFINED
                    } else {
                        this_jsvalue
                    };
                    this_value.ensure_still_alive();

                    let args = [
                        this_value,
                        self.get_exit_code(global_this),
                        self.get_signal_code(global_this),
                        waitpid_value,
                    ];

                    if !did_update_has_pending_activity {
                        self.update_has_pending_activity();
                        did_update_has_pending_activity = true;
                    }

                    event_loop.run_callback(callback, global_this, this_value, &args);
                }
            }
        }

        // defer if (!did_update_has_pending_activity) this.updateHasPendingActivity();
        if !did_update_has_pending_activity {
            self.update_has_pending_activity();
        }
        // defer this.disconnectIPC(true);
        self.disconnect_ipc(true);
        // defer this.deref();
        self.deref();
    }

    fn close_io(&mut self, io: StdioKind) {
        if self.closed.contains(io) {
            return;
        }
        self.closed.insert(io);

        // If you never referenced stdout/stderr, they won't be garbage collected.
        //
        // That means:
        //   1. We need to stop watching them
        //   2. We need to free the memory
        //   3. We need to halt any pending reads (1)

        let getter = match io {
            StdioKind::Stdin => ObservableGetter::Stdin,
            StdioKind::Stdout => ObservableGetter::Stdout,
            StdioKind::Stderr => ObservableGetter::Stderr,
        };
        let called = self.has_called_getter(getter);

        match io {
            StdioKind::Stdin => {
                if !called {
                    self.stdin.finalize();
                } else {
                    self.stdin.close();
                }
            }
            StdioKind::Stdout => {
                if !called {
                    self.stdout.finalize();
                } else {
                    self.stdout.close();
                }
            }
            StdioKind::Stderr => {
                if !called {
                    self.stderr.finalize();
                } else {
                    self.stderr.close();
                }
            }
        }
    }

    // This must only be run once per Subprocess
    pub fn finalize_streams(&mut self) {
        bun_output::scoped_log!(Subprocess, "finalizeStreams");
        self.close_process();

        self.close_io(StdioKind::Stdin);
        self.close_io(StdioKind::Stdout);
        self.close_io(StdioKind::Stderr);

        for item in self.stdio_pipes.iter() {
            #[cfg(windows)]
            {
                if let StdioResult::Buffer(buffer) = item {
                    buffer.close(on_pipe_close);
                }
            }
            #[cfg(not(windows))]
            {
                match item {
                    PosixSpawnResult::ExtraPipe::OwnedFd(fd) => fd.close(),
                    PosixSpawnResult::ExtraPipe::UnownedFd(_)
                    | PosixSpawnResult::ExtraPipe::Unavailable => {}
                }
            }
        }
        self.stdio_pipes.clear();
        self.stdio_pipes.shrink_to_fit();
    }

    fn clear_abort_signal(&mut self) {
        if let Some(signal) = self.abort_signal.take() {
            signal.pending_activity_unref();
            signal.clean_native_bindings(self as *mut Self as *mut c_void);
            // signal.unref() — handled by Arc::drop
            drop(signal);
        }
    }

    pub fn finalize(this: *mut Self) {
        bun_output::scoped_log!(Subprocess, "finalize");
        // SAFETY: called from JSC finalizer on the mutator thread; `this` is the m_ctx payload.
        let this = unsafe { &mut *this };
        // Ensure any code which references the "this" value doesn't attempt to
        // access it after it's been freed We cannot call any methods which
        // access GC'd values during the finalizer
        this.this_value.finalize();

        this.clear_abort_signal();

        debug_assert!(
            !this.compute_has_pending_activity() || VirtualMachine::get().is_shutting_down()
        );
        this.finalize_streams();

        this.process.detach();
        // Match Zig's `this.process.deref()`: release the Arc strong ref now, not when
        // ref_count → 0. ManuallyDrop on the field prevents a double-drop later.
        // SAFETY: finalize() runs exactly once; no code path reads `this.process` after this.
        unsafe { ManuallyDrop::drop(&mut this.process) };

        if this.event_loop_timer.state == EventLoopTimer::State::ACTIVE {
            this.global_this
                .bun_vm()
                .timer
                .remove(&mut this.event_loop_timer);
        }
        this.set_event_loop_timer_refd(false);

        MaxBuf::remove_from_subprocess(&mut this.stdout_maxbuf);
        MaxBuf::remove_from_subprocess(&mut this.stderr_maxbuf);

        if let Some(ipc_data) = this.ipc_data.take() {
            // In normal operation the socket is already `.closed` by the time we
            // get here (that is what allowed `computeHasPendingActivity` to drop
            // to false and let GC collect us). `disconnectIPC` would be a no-op
            // in that state and would leak the SendQueue's buffers; deinit it
            // instead. `SendQueue.deinit` handles the VM-shutdown case where the
            // socket is still open.
            drop(ipc_data);
        }

        this.flags.insert(Flags::FINALIZED);
        this.deref();
    }

    pub fn get_exited(&mut self, this_value: JSValue, global_this: &JSGlobalObject) -> JSValue {
        if let Some(promise) = js::exited_promise_get_cached(this_value) {
            return promise;
        }

        match &self.process.status {
            Status::Exited(exit) => {
                JSPromise::resolved_promise_value(global_this, JSValue::js_number(exit.code))
            }
            Status::Signaled(signal) => JSPromise::resolved_promise_value(
                global_this,
                JSValue::js_number(signal.to_exit_code().unwrap_or(254)),
            ),
            Status::Err(err) => {
                let js_err = match err.to_js(global_this) {
                    Ok(v) => v,
                    Err(_) => return JSValue::ZERO,
                };
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    js_err,
                )
            }
            _ => {
                let promise = JSPromise::create(global_this).to_js();
                js::exited_promise_set_cached(this_value, global_this, promise);
                promise
            }
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_exit_code(this: &Self, _global: &JSGlobalObject) -> JSValue {
        if let Status::Exited(exited) = &this.process.status {
            return JSValue::js_number(exited.code);
        }
        JSValue::NULL
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_signal_code(this: &Self, global: &JSGlobalObject) -> JSValue {
        if let Some(signal) = this.process.signal_code() {
            if let Some(name) = signal.name() {
                return ZigString::init(name).to_js(global);
            } else {
                return JSValue::js_number(signal as u32);
            }
        }

        JSValue::NULL
    }

    pub fn handle_ipc_message(&mut self, message: IPC::DecodedIPCMessage, handle: JSValue) {
        bun_output::scoped_log!(IPC, "Subprocess#handleIPCMessage");
        match message {
            // In future versions we can read this in order to detect version mismatches,
            // or disable future optimizations if the subprocess is old.
            IPC::DecodedIPCMessage::Version(v) => {
                bun_output::scoped_log!(IPC, "Child IPC version is {}", v);
            }
            IPC::DecodedIPCMessage::Data(data) => {
                bun_output::scoped_log!(IPC, "Received IPC message from child");
                let this_jsvalue = self.this_value.try_get().unwrap_or(JSValue::ZERO);
                let _keep = jsc::EnsureStillAlive(this_jsvalue);
                if !this_jsvalue.is_empty() {
                    if let Some(cb) = js::ipc_callback_get_cached(this_jsvalue) {
                        let global_this = self.global_this;
                        global_this.bun_vm().event_loop().run_callback(
                            cb,
                            global_this,
                            this_jsvalue,
                            &[data, this_jsvalue, handle],
                        );
                    }
                }
            }
            IPC::DecodedIPCMessage::Internal(data) => {
                bun_output::scoped_log!(IPC, "Received IPC internal message from child");
                let global_this = self.global_this;
                let _ =
                    node_cluster_binding::handle_internal_message_primary(global_this, self, data);
            }
        }
    }

    pub fn handle_ipc_close(&mut self) {
        bun_output::scoped_log!(IPC, "Subprocess#handleIPCClose");
        let this_jsvalue = self.this_value.try_get().unwrap_or(JSValue::ZERO);
        let _keep = jsc::EnsureStillAlive(this_jsvalue);
        let global_this = self.global_this;
        self.update_has_pending_activity();

        if !this_jsvalue.is_empty() {
            // Avoid keeping the callback alive longer than necessary
            js::ipc_callback_set_cached(this_jsvalue, global_this, JSValue::ZERO);

            // Call the onDisconnectCallback if it exists and prevent it from being kept alive longer than necessary
            if let Some(callback) = Self::consume_on_disconnect_callback(this_jsvalue, global_this)
            {
                global_this.bun_vm().event_loop().run_callback(
                    callback,
                    global_this,
                    this_jsvalue,
                    &[JSValue::TRUE],
                );
            }
        }
    }

    pub fn ipc(&mut self) -> Option<&mut IPC::SendQueue> {
        self.ipc_data.as_mut()
    }

    pub fn get_global_this(&self) -> Option<&JSGlobalObject> {
        Some(self.global_this)
    }
}

pub enum Source {
    Blob(Blob::Any),
    ArrayBuffer(ArrayBuffer::Strong),
    Detached,
}

impl Source {
    pub fn memory_cost(&self) -> usize {
        // Memory cost of Source and each of the particular fields is covered by size_of::<Subprocess>().
        match self {
            Source::Blob(blob) => blob.memory_cost(),
            // ArrayBuffer is owned by GC.
            Source::ArrayBuffer(_) => 0,
            Source::Detached => 0,
        }
    }

    pub fn slice(&self) -> &[u8] {
        match self {
            Source::Blob(blob) => blob.slice(),
            Source::ArrayBuffer(ab) => ab.slice(),
            _ => panic!("Invalid source"),
        }
    }

    pub fn detach(&mut self) {
        match self {
            Source::Blob(blob) => {
                blob.detach();
            }
            Source::ArrayBuffer(ab) => {
                // ArrayBuffer.Strong.deinit() → drop releases the Strong handle.
                // TODO(port): verify ArrayBuffer::Strong has explicit deinit vs Drop.
                let _ = ab;
            }
            _ => {}
        }
        *self = Source::Detached;
    }
}

#[cfg(windows)]
pub extern "C" fn on_pipe_close(this: *mut bun_sys::windows::libuv::Pipe) {
    // safely free the pipes
    // SAFETY: pipe was Box::into_raw'd when created; we are the close callback owner.
    drop(unsafe { Box::from_raw(this) });
}

pub mod testing_apis {
    use super::*;

    /// Inject a synthetic read error into a subprocess's stdout/stderr
    /// PipeReader, as if the underlying read() syscall (Posix) or libuv read
    /// callback (Windows) had failed with EBADF. Used by tests to exercise
    /// the onReaderError cleanup path, which is otherwise very hard to
    /// trigger deterministically — on Windows in particular, peer death on
    /// a named pipe maps to UV_EOF rather than an error.
    ///
    /// Returns true if an error was injected, false if the given stdio is
    /// not (or no longer) a buffered pipe reader.
    #[bun_jsc::host_fn]
    pub fn inject_stdio_read_error(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [subprocess_value, kind_value] = callframe.arguments_as_array::<2>();
        let Some(subprocess) = Subprocess::from_js(subprocess_value) else {
            return Err(global_this.throw("first argument must be a Subprocess", &[]));
        };
        let kind_str = kind_value.to_bun_string(global_this)?;
        // defer kind_str.deref() — bun_str::String Drop handles deref.

        let out: &mut Readable = if kind_str.eql_comptime(b"stdout") {
            &mut subprocess.stdout
        } else if kind_str.eql_comptime(b"stderr") {
            &mut subprocess.stderr
        } else {
            return Err(global_this.throw("second argument must be 'stdout' or 'stderr'", &[]));
        };

        let Readable::Pipe(pipe) = out else {
            return Ok(JSValue::FALSE);
        };

        // Mirror what the real error path does (onStreamRead on Windows,
        // read() on Posix) so the teardown exercised is identical.
        let fake_err = bun_sys::Error::from_code(bun_sys::Errno::BADF, bun_sys::Syscall::Read);
        #[cfg(windows)]
        {
            let _ = pipe.reader.stop_reading();
        }
        pipe.reader.on_error(fake_err);
        Ok(JSValue::TRUE)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/subprocess.zig (1024 lines)
//   confidence: medium
//   todos:      8
//   notes:      Subprocess gained <'a> (terminal/global_this per LIFETIMES.tsv); ref/deref via bun_ptr::IntrusiveRc; process held in ManuallyDrop so finalize releases at Zig timing; on_process_exit defers reshaped to manual calls at return points.
// ──────────────────────────────────────────────────────────────────────────
