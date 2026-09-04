//! The Subprocess object is returned by `Bun.spawn`. This file also holds the
//! code for `Bun.spawnSync`

use core::cell::Cell;
use core::ptr::NonNull;

use bun_ptr::{BackRef, RefPtr, ThisPtr};

use bun_jsc::SysErrorJsc;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSPromise, JSValue, JsCell, JsRef, JsResult,
    VirtualMachine,
};
#[cfg(not(windows))]
use bun_sys::FdExt as _;
use bun_sys::{self, SignalCode};
use enumset::{EnumSet, EnumSetType};

// Process / spawn machinery lives in this crate (api/bun/process.rs), not in an
// external `bun_spawn` crate. The `bun_spawn` workspace crate only carries the
// platform-thin `Stdio`/`Status` shims used by `bun.spawnSync` callers.
use crate::api::bun::Terminal;
#[cfg(not(windows))]
use crate::api::bun_process::ExtraPipe;
use crate::api::bun_process::{ProcessHandle, Rusage, Status};
use crate::ipc as IPC;
use crate::node::node_cluster_binding;
use crate::timer::{EventLoopTimer, EventLoopTimerState};
use crate::webcore::{self, AbortSignal, FileSink};
#[cfg(windows)]
use bun_libuv_sys::UvHandle as _;

#[path = "subprocess/ResourceUsage.rs"]
pub mod resource_usage;
pub use resource_usage::ResourceUsage;

#[path = "subprocess/SubprocessPipeReader.rs"]
pub mod subprocess_pipe_reader;
pub use subprocess_pipe_reader as PipeReader;

#[path = "subprocess/Readable.rs"]
pub mod readable;
pub use readable::Readable;

#[path = "subprocess/Writable.rs"]
pub mod writable;
pub use writable::Writable;

pub use bun_spawn::static_pipe_writer;
pub use static_pipe_writer::StaticPipeWriter as NewStaticPipeWriter;

pub use bun_io::MaxBuf;

bun_output::declare_scope!(Subprocess, visible);
bun_output::declare_scope!(IPC, visible);

// `toJS`/`fromJS`/`fromJSDirect` are wired manually below (the `#[bun_jsc::JsClass]`
// proc-macro doesn't support generic structs); cached-property accessors
// (exitedPromiseGetCached, stdinGetCached, …) from `jsc.Codegen.JSSubprocess` are
// emitted here via `codegen_cached_accessors!`.
pub mod js {
    bun_jsc::codegen_cached_accessors!(
        "Subprocess";
        stdin,
        stdout,
        stderr,
        terminal,
        exitedPromise,
        onExitCallback,
        onDisconnectCallback,
        ipcCallback
    );
}

/// Platform-dependent stdio result type.
pub use bun_spawn::subprocess::StdioResult;

#[cfg(windows)]
type StdioPipeItem = StdioResult;
#[cfg(not(windows))]
type StdioPipeItem = ExtraPipe;

pub type StaticPipeWriter<'a> = NewStaticPipeWriter<Subprocess<'a>>;

impl<'a> static_pipe_writer::StaticPipeWriterProcess for Subprocess<'a> {
    const POLL_OWNER_TAG: bun_io::PollTag = bun_io::posix_event_loop::poll_tag::STATIC_PIPE_WRITER;
    fn on_close_io(this: ThisPtr<Self>, kind: StdioKind) {
        this.on_close_io(kind)
    }
}

#[derive(EnumSetType, strum::IntoStaticStr)]
pub enum ObservableGetter {
    Stdin,
    Stdout,
    Stderr,
}

pub use bun_spawn::process::StdioKind;

// Note: `#[bun_jsc::JsClass]` does not yet handle generic structs (it emits the
// bare ident in extern signatures). The `JsClass` impl + finalize/construct C-ABI
// hooks are hand-expanded below for `Subprocess<'_>`.
//
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). Host-fn bodies re-enter
// JS (`run_callback`, promise resolve, getters that materialise streams) and a
// live `&mut Self` across those calls would alias the fresh `&mut Self` the
// codegen shim hands to whichever method JS calls next. `UnsafeCell`-backed
// fields suppress `noalias` on the outer `&Subprocess`, making the miscompile
// structurally impossible.
// Intrusive ref-count: the Box is freed when `ref_count` → 0. Refs are held
// by the JS wrapper (released in `finalize`), the `Process` exit handler
// (`exit_ref`) and, while a stdin `FileSink` points back here, that sink's
// destructor (`stdin_sink_ref`).
#[derive(bun_ptr::RefCounted)]
pub struct Subprocess<'a> {
    pub(crate) ref_count: bun_ptr::RefCount<Subprocess<'a>>,
    /// The exit-handler owner's handle on the spawned `Process`; detached in
    /// [`Subprocess::finalize`], released when this struct drops.
    pub(crate) process: ProcessHandle,
    /// The ref the `Process` exit handler holds; released at the end of
    /// `on_process_exit` (stranded if the child outlives VM teardown).
    pub(crate) exit_ref: Cell<Option<RefPtr<Subprocess<'a>>>>,
    pub(crate) stdin: JsCell<Writable<'a>>,
    pub(crate) stdout: JsCell<Readable>,
    pub(crate) stderr: JsCell<Readable>,
    pub(crate) stdio_pipes: JsCell<Vec<StdioPipeItem>>,
    pub(crate) pid_rusage: Cell<Option<Rusage>>,

    /// Terminal attached to this subprocess (if spawned with terminal
    /// option). Kept alive by its JS wrapper, which is cached on ours.
    pub(crate) terminal: Cell<Option<BackRef<Terminal, bun_ptr::Root>>>,

    // The JSC global outlives every Subprocess.
    pub global_this: bun_ptr::BackRef<JSGlobalObject>,
    pub(crate) observable_getters: Cell<EnumSet<ObservableGetter>>,
    pub closed: Cell<EnumSet<StdioKind>>,
    pub this_value: JsCell<JsRef>,

    /// Our ref on the IPC send queue; detached and released in `finalize`.
    pub(crate) ipc_data: JsCell<Option<RefPtr<IPC::SendQueue>>>,
    pub(crate) flags: Cell<Flags>,

    /// Weak observer of the stdin `FileSink` — holds no ref. `on_stdin_destroyed`
    /// nulls this before the sink is freed, so it is never dereferenced after the sink dies.
    pub(crate) weak_file_sink_stdin_ptr: Cell<Option<BackRef<FileSink, bun_ptr::Root>>>,
    /// The ref held while a stdin `FileSink` points back at us; its JS
    /// destructor or close signal reaches `on_stdin_destroyed`, which releases
    /// it.
    pub(crate) stdin_sink_ref: Cell<Option<RefPtr<Subprocess<'a>>>>,
    /// Our listener registration (holds a ref on the signal); dropped in
    /// `clear_abort_signal`.
    pub(crate) abort_signal: JsCell<Option<bun_jsc::AbortListenerHandle>>,

    pub(crate) event_loop_timer_refd: Cell<bool>,
    /// Intrusive timer node. `JsCell` so `&self` can hand `*mut EventLoopTimer`
    /// to the timer heap; `JsCell` is `#[repr(transparent)]` so
    /// `from_field_ptr!(Subprocess, event_loop_timer, t)` in
    /// `dispatch.rs` still recovers the correct container address.
    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
    pub(crate) kill_signal: SignalCode,

    pub(crate) stdout_maxbuf: MaxBuf::MaxBufSlot,
    pub(crate) stderr_maxbuf: MaxBuf::MaxBufSlot,
    pub(crate) exited_due_to_maxbuf: Cell<Option<MaxBuf::Kind>>,
}

bun_event_loop::impl_timer_owner!(Subprocess<'_>; from_timer_ptr => event_loop_timer);

// Note: no `Default` impl for `Subprocess`. `js_bun_spawn_bindings::
// spawn_maybe_sync` fills every field explicitly (see note there), and
// `ProcessHandle` has no placeholder anyway.

// ── manual `#[bun_jsc::JsClass]` expansion (generic struct) ──────────────────
// Routes through the codegen'd `crate::generated_classes::js_Subprocess`
// wrappers (which are typed against `Subprocess<'static>`) so the extern
// symbols are declared exactly once.
const _: () = {
    use crate::generated_classes::js_Subprocess as js;

    impl<'a> Subprocess<'a> {
        /// Wrap an already-heap-allocated `Subprocess` (`RefPtr::new`) in
        /// its JS cell. `Bun.spawn` boxes early so address-dependent
        /// back-pointers (`stdin.pipe.signal`, MaxBuf owner, IPC owner) can be
        /// wired before `subprocess.toJS(globalThis)` runs; this is the raw-ptr
        /// entrypoint that avoids re-boxing.
        ///
        /// `ptr` is the JS wrapper's ref (`RefPtr::into_raw`), not yet owned by
        /// any wrapper; ownership transfers to the C++ side (released via
        /// `SubprocessClass__finalize`). Thin forwarder to
        /// the (already safe) generated `js_Subprocess::to_js`, which
        /// encapsulates the FFI `__create` call internally.
        #[inline]
        pub(crate) fn to_js_from_ptr(ptr: *mut Self, global: &JSGlobalObject) -> JSValue {
            // The codegen wrapper is monomorphized at `'static`; the lifetime
            // parameter is purely a borrow-checker artifact (C++ stores the
            // pointer as opaque `m_ctx`), so erase it via `cast`.
            js::to_js(ptr.cast(), global)
        }
    }

    bun_jsc::impl_js_class_via_generated!(for<'a> Subprocess<'a> => crate::generated_classes::js_Subprocess, no_constructor);

    // `SubprocessClass__finalize` / `SubprocessClass__construct` are now emitted
    // by `generateRust()` (`build/*/codegen/generated_classes.rs`); the
    // hand-expanded copies that used to live here collided at link time and
    // have been removed.
};

impl<'a> Subprocess<'a> {
    /// Claim `start()`'s outstanding ref on the buffer-stdin writer (if any)
    /// for the caller to release after closing the writer; see `StaticPipeWriter`.
    fn take_pending_start_writer(&self) -> Option<RefPtr<StaticPipeWriter<'a>>> {
        match self.stdin.get() {
            Writable::Buffer(buffer) => StaticPipeWriter::take_start_ref(buffer.this_ptr()),
            _ => None,
        }
    }

    #[inline]
    pub(crate) fn process(&self) -> &ProcessHandle {
        &self.process
    }

    /// Borrow the stored JSC global. The global is guaranteed to outlive
    /// every Subprocess it created.
    #[inline]
    pub fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    /// `self`'s address, for identity comparisons and as the key the JSSink
    /// destructor registration uses.
    #[inline]
    pub(crate) fn as_ctx_ptr(&self) -> *mut Self {
        std::ptr::from_ref::<Self>(self).cast_mut()
    }

    /// Read-modify-write the packed `Cell<Flags>` through `&self`.
    #[inline]
    pub(crate) fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }
}

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u8 {
        const IS_SYNC                      = 1 << 0;
        const HAS_STDIN_DESTRUCTOR_CALLED  = 1 << 2;
        const FINALIZED                    = 1 << 3;
        const IS_STDIN_A_READABLE_STREAM   = 1 << 5;
        /// Terminal was created inline by spawn (vs. an existing Terminal passed
        /// by the caller). Owned terminals are closed when the subprocess exits
        /// so the exit callback fires; borrowed terminals are left open for reuse.
        const OWNS_TERMINAL                = 1 << 6;
        /// `handle_abort_signal` sent `kill_signal`; `on_process_exit` closes
        /// pipe readers instead of waiting on EOF a grandchild may never send.
        const ABORT_SIGNAL_KILLED          = 1 << 7;
    }
}

// `StdioResult` is `Option<Fd>` (Copy) on unix but a non-Copy enum on windows;
// a fn would have to pick by-value (moves on windows) or by-ref
// (clippy::trivially_copy_pass_by_ref on unix).
macro_rules! assert_stdio_result {
    ($result:expr) => {{
        #[cfg(all(debug_assertions, unix))]
        if let Some(fd) = &$result {
            debug_assert!(fd.is_valid());
        }
    }};
}
pub(crate) use assert_stdio_result;

/// Registered through `abort_signal`'s `AbortListenerHandle`.
impl bun_jsc::abort_signal::AbortListenerRef for Subprocess<'_> {
    fn on_abort(&self, _reason: JSValue) {
        self.clear_abort_signal();
        if !self.has_exited() {
            self.update_flags(|f| f.insert(Flags::ABORT_SIGNAL_KILLED));
        }
        let _ = self.try_kill(self.kill_signal);
    }
}

bun_spawn::link_impl_ProcessExit! {
    Subprocess for Subprocess<'static> => |this| {
        on_process_exit(_process, status, rusage) =>
            Subprocess::on_process_exit(ThisPtr::new(this), &status, rusage),
    }
}

impl Subprocess<'_> {
    /// Shared borrow of the attached `AbortSignal`, if any.
    #[inline]
    pub(crate) fn abort_signal_ref(&self) -> Option<&AbortSignal> {
        self.abort_signal.get().as_ref().map(|h| h.signal())
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn resource_usage(
        this: &Self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.create_resource_usage_object(global_object)
    }

    pub(crate) fn create_resource_usage_object(
        &self,
        global_object: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let rusage = 'brk: {
            if let Some(r) = self.pid_rusage.get() {
                break 'brk r;
            }

            #[cfg(windows)]
            {
                if let Some(r) = self.process.uv_rusage() {
                    self.pid_rusage.set(Some(r));
                    break 'brk r;
                }
            }

            return Ok(JSValue::UNDEFINED);
        };
        ResourceUsage::create(&rusage, global_object)
    }

    pub(crate) fn has_exited(&self) -> bool {
        self.process().has_exited()
    }

    pub(crate) fn compute_has_pending_activity(&self) -> bool {
        // `ipc_data` is never set back to `None` after init, so checking only
        // for `is_some()` would keep the JSSubprocess strongly referenced for the
        // lifetime of the VM. The IPC side contributes pending activity until
        // `_onAfterIPCClosed` has actually run: gating on `close_event_sent`
        // (rather than `socket != .closed`) keeps the wrapper Strong across the
        // window where the socket is already `.closed` but the task holding a
        // raw `*SendQueue` into `ipc_data` is still queued.
        if let Some(ipc) = self.ipc() {
            if !ipc.close_event_sent.get() {
                return true;
            }
        }

        if self.has_pending_activity_stdio() {
            return true;
        }

        if !self.process().has_exited() {
            return true;
        }

        false
    }

    pub(crate) fn update_has_pending_activity(&self) {
        if self.flags.get().contains(Flags::IS_SYNC) {
            return;
        }
        // The wrapper is gone (finalize() closing stdio that a stopped worker
        // left pending): there is nothing to keep alive or release.
        if self.this_value.get().is_finalized() {
            return;
        }

        let has_pending = self.compute_has_pending_activity();
        if cfg!(debug_assertions) {
            bun_output::scoped_log!(Subprocess, "updateHasPendingActivity() -> {}", has_pending);
        }

        // Upgrade or downgrade the reference based on pending activity
        if has_pending {
            let global_this = self.global_this;
            self.this_value.with_mut(|v| v.upgrade(global_this.get()));
        } else {
            self.this_value.with_mut(|v| v.downgrade());
        }
    }

    pub(crate) fn has_pending_activity_stdio(&self) -> bool {
        if self.stdin.get().has_pending_activity() {
            return true;
        }

        if self.stdout.get().has_pending_activity() {
            return true;
        }
        if self.stderr.get().has_pending_activity() {
            return true;
        }

        false
    }

    pub(crate) fn on_close_io(&self, kind: StdioKind) {
        match kind {
            StdioKind::Stdin => self.stdin.with_mut(|stdin| match stdin {
                Writable::Pipe(_) => {
                    let Writable::Pipe(pipe) = core::mem::replace(stdin, Writable::Ignore) else {
                        unreachable!()
                    };
                    pipe.source.with_mut(|s| s.clear());
                }
                Writable::Buffer(_) => {
                    let Writable::Buffer(buffer) = core::mem::replace(stdin, Writable::Ignore)
                    else {
                        unreachable!()
                    };
                    StaticPipeWriter::detach_source(buffer.this_ptr());
                }
                _ => {}
            }),
            StdioKind::Stdout | StdioKind::Stderr => {
                let out: &JsCell<Readable> = if kind == StdioKind::Stdout {
                    &self.stdout
                } else {
                    &self.stderr
                };
                if matches!(out.get(), Readable::Pipe(_)) {
                    // Move the Rc<PipeReader> out of `*out` first so
                    // reassigning doesn't drop it while still borrowed.
                    let Readable::Pipe(pipe) = out.replace(Readable::Ignore) else {
                        unreachable!()
                    };
                    let pipe_state = &mut Readable::pipe_reader_mut(&pipe).state;
                    if let PipeReader::State::Done(done) = pipe_state {
                        let taken = core::mem::take(done);
                        out.set(Readable::Buffer(readable::CowString::init_owned(
                            taken.into_boxed_slice(),
                        )));
                        // pipe.state was emptied via take()
                    }
                    // else: *out stays Readable::Ignore (set by replace above).
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

    pub(crate) fn js_ref(&self) {
        self.process.enable_keeping_event_loop_alive();

        if !self.has_called_getter(ObservableGetter::Stdin) {
            self.stdin.with_mut(|s| s.r#ref());
        }

        if !self.has_called_getter(ObservableGetter::Stdout) {
            self.stdout.with_mut(|s| s.ref_());
        }

        if !self.has_called_getter(ObservableGetter::Stderr) {
            self.stderr.with_mut(|s| s.ref_());
        }

        self.update_has_pending_activity();
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub(crate) fn js_unref(&self) {
        self.process.disable_keeping_event_loop_alive();

        if !self.has_called_getter(ObservableGetter::Stdin) {
            self.stdin.with_mut(|s| s.unref());
        }

        if !self.has_called_getter(ObservableGetter::Stdout) {
            self.stdout.with_mut(|s| s.unref());
        }

        if !self.has_called_getter(ObservableGetter::Stderr) {
            self.stderr.with_mut(|s| s.unref());
        }

        self.update_has_pending_activity();
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_stderr(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // When terminal is used, stderr goes through the terminal
        if this.terminal.get().is_some() {
            return Ok(JSValue::NULL);
        }
        this.observable_getters
            .set(this.observable_getters.get() | ObservableGetter::Stderr);
        let exited = this.has_exited();
        this.stderr.with_mut(|s| s.to_js(global_this, exited))
    }

    /// `this: ThisPtr` because handing stdin to JS may take a ref on us for
    /// the sink's destructor (`stdin_sink_ref`).
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_stdin(
        this: ThisPtr<Self>,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        // When terminal is used, stdin goes through the terminal
        if this.terminal.get().is_some() {
            return Ok(JSValue::NULL);
        }
        this.observable_getters
            .set(this.observable_getters.get() | ObservableGetter::Stdin);
        // `Writable::to_js` takes only the parent and projects `stdin`
        // internally so no two `&mut` overlap here.
        Ok(Writable::to_js(this, global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_stdout(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // When terminal is used, stdout goes through the terminal
        if this.terminal.get().is_some() {
            return Ok(JSValue::NULL);
        }
        this.observable_getters
            .set(this.observable_getters.get() | ObservableGetter::Stdout);
        // NOTE: ownership of internal buffers is transferred to the JSValue, which
        // gets cached on JSSubprocess (created via bindgen). This makes it
        // re-accessable to JS code but not via `this.stdout`, which is now `.closed`.
        let exited = this.has_exited();
        this.stdout.with_mut(|s| s.to_js(global_this, exited))
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_terminal(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        if let Some(terminal) = this.terminal.get() {
            return crate::api::bun_terminal_body::to_js(terminal.this_ptr().as_ptr(), global_this);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn async_dispose(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.process().has_exited() {
            // rely on GC to clean everything up in this case
            return Ok(JSValue::UNDEFINED);
        }

        let this_jsvalue = callframe.this();

        let _keep = jsc::EnsureStillAlive(this_jsvalue);

        // unref streams so that this disposed process will not prevent
        // the process from exiting causing a hang
        this.stdin.with_mut(|s| s.unref());
        this.stdout.with_mut(|s| s.unref());
        this.stderr.with_mut(|s| s.unref());

        match this.try_kill(this.kill_signal) {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(err) => {
                // Signal 9 should always be fine, but just in case that somehow fails.
                return Err(global.throw_value(err.to_js(global)));
            }
        }

        Ok(this.get_exited(this_jsvalue, global))
    }

    pub(crate) fn set_event_loop_timer_refd(&self, refd: bool) {
        if self.event_loop_timer_refd.get() == refd {
            return;
        }
        self.event_loop_timer_refd.set(refd);
        let uws_loop = self.global_this().bun_vm().uws_loop();
        let delta: i32 = if refd { 1 } else { -1 };
        Self::timer_all().increment_timer_ref(delta, uws_loop);
    }

    #[inline]
    fn timer_all() -> &'static mut crate::timer::All {
        crate::jsc_hooks::timer_all_mut()
    }

    pub(crate) fn timeout_callback(&self) {
        self.set_event_loop_timer_refd(false);
        if self.event_loop_timer.get().state == EventLoopTimerState::CANCELLED {
            return;
        }
        if self.has_exited() {
            self.event_loop_timer
                .with_mut(|t| t.state = EventLoopTimerState::CANCELLED);
            return;
        }
        self.event_loop_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        let _ = self.try_kill(self.kill_signal);
    }

    pub(crate) fn on_max_buffer(&self, kind: MaxBuf::Kind) {
        self.exited_due_to_maxbuf.set(Some(kind));
        let _ = self.try_kill(self.kill_signal);
    }

    /// Close still-open stdout/stderr pipe readers after a timeout/maxBuffer
    /// kill; a grandchild may still hold the write end (Node.js
    /// `SyncProcessRunner::Kill()`). Called outside any reader callback.
    pub(crate) fn close_readable_pipes(&self) {
        if matches!(self.stdout.get(), Readable::Pipe(_)) {
            self.stdout.with_mut(|s| s.close());
        }
        if matches!(self.stderr.get(), Readable::Pipe(_)) {
            self.stderr.with_mut(|s| s.close());
        }
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn kill(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // Safe: this method can only be called while the object is alive (reachable from JS)
        // The finalizer only runs when the object becomes unreachable
        this.this_value
            .with_mut(|v| v.update(global_this, callframe.this()));

        let [signal_arg] = callframe.arguments_as_array::<1>();
        // If signal is 0, then no actual signal is sent, but error checking
        // is still performed.
        let sig: SignalCode = bun_sys_jsc::signal_code_jsc::from_js(signal_arg, global_this)?;

        match this.try_kill(sig) {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(err) => {
                // EINVAL or ENOSYS means the signal is not supported in the current platform (most likely unsupported on windows)
                return Err(global_this.throw_value(err.to_js(global_this)));
            }
        }

        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn has_killed(&self) -> bool {
        self.process().has_killed()
    }

    pub(crate) fn try_kill(&self, sig: SignalCode) -> bun_sys::Result<()> {
        if self.has_exited() {
            return bun_sys::Result::Ok(());
        }
        self.process.kill(sig.0)
    }

    fn has_called_getter(&self, getter: ObservableGetter) -> bool {
        self.observable_getters.get().contains(getter)
    }

    fn close_process(&self) {
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            return;
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            self.process.close();
        }
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_ref(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.js_ref();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_unref(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.js_unref();
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn on_stdin_destroyed(&self) {
        let stdin_sink_ref = self.stdin_sink_ref.take();
        self.update_flags(|f| f.insert(Flags::HAS_STDIN_DESTRUCTOR_CALLED));
        self.weak_file_sink_stdin_ptr.set(None);

        if !self.flags.get().contains(Flags::FINALIZED) {
            // otherwise update the pending activity flag
            self.update_has_pending_activity();
        }

        // May free `self`; last use.
        drop(stdin_sink_ref);
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_send(
        this: &Self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(IPC, "Subprocess#doSend");

        let context = if this.has_exited() {
            crate::ipc_host::FromEnum::SubprocessExited
        } else {
            crate::ipc_host::FromEnum::Subprocess
        };
        // `do_send` may re-enter JS, but only the SendQueue is borrowed, not `*self`.
        crate::ipc_host::do_send(this.ipc(), global, call_frame, context, this.pid() as u32)
    }

    pub(crate) fn disconnect_ipc(&self, next_tick: bool) {
        let Some(ipc_data) = self.ipc() else { return };
        ipc_data.close_socket_next_tick(next_tick);
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn disconnect(
        this: &Self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if let Some(ipc_data) = this.ipc() {
            ipc_data.disconnect();
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_connected(this: &Self, _global_this: &JSGlobalObject) -> JSValue {
        let connected = this.ipc().map(|d| d.is_connected()).unwrap_or(false);
        JSValue::from(connected)
    }

    pub(crate) fn pid(&self) -> i32 {
        self.process().pid
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_pid(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.pid() as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_killed(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(this.has_killed())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_stdio(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let array = JSValue::create_empty_array(global, 0)?;
        array.push(global, JSValue::NULL)?;
        array.push(global, JSValue::NULL)?; // TODO: align this with options
        array.push(global, JSValue::NULL)?; // TODO: align this with options

        // Once the values are visible to JS the caller owns them (it hands
        // them to `net.connect({ fd })`, which closes them with the socket).
        // Our `uv_pipe_t` would close the same HANDLE again when this
        // Subprocess is finalized, so expose a duplicate instead. The pipe is
        // closed right away: as long as our handle stayed open, the child
        // would not see EOF when the caller closes its copy. The duplicate is
        // kept so later reads return the same value.
        #[cfg(windows)]
        this.stdio_pipes.with_mut(|pipes| {
            for slot in pipes.iter_mut() {
                let buffer = match core::mem::take(slot) {
                    StdioResult::Buffer(buffer) => buffer,
                    other => {
                        *slot = other;
                        continue;
                    }
                };
                let handle = buffer.fd();
                // On failure the slot stays `Unavailable` and reads as null.
                if handle != bun_sys::windows::libuv::INVALID_HANDLE_VALUE {
                    if let Ok(dup) = bun_sys::dup(bun_sys::Fd::from_system(handle)) {
                        *slot = StdioResult::UnownedFd(dup);
                    }
                }
                // `uv_close` is async; the pipe is freed from the close callback.
                bun_io::source::close_and_destroy_pipe(buffer);
            }
        });

        for item in this.stdio_pipes.get().iter() {
            #[cfg(windows)]
            {
                if let StdioResult::UnownedFd(fd) = item {
                    // Expose the numeric HANDLE value.
                    let handle: usize = fd.native() as usize;
                    array.push(global, JSValue::js_number(handle as f64))?;
                } else {
                    array.push(global, JSValue::NULL)?;
                }
            }
            #[cfg(not(windows))]
            {
                match item {
                    ExtraPipe::OwnedFd(fd) | ExtraPipe::UnownedFd(fd) => {
                        array.push(global, JSValue::js_number(fd.native() as f64))?;
                    }
                    ExtraPipe::Unavailable => {
                        array.push(global, JSValue::NULL)?;
                    }
                }
            }
        }
        // The raw fd numbers are now visible to JS and the caller owns them.
        // Downgrade so finalize_streams never closes a number JS may have
        // already closed (whose value the kernel may have since recycled).
        #[cfg(not(windows))]
        this.stdio_pipes.with_mut(|pipes| {
            for slot in pipes.iter_mut() {
                if let ExtraPipe::OwnedFd(fd) = *slot {
                    *slot = ExtraPipe::UnownedFd(fd);
                }
            }
        });
        Ok(array)
    }

    pub(crate) fn memory_cost(&self) -> usize {
        core::mem::size_of::<Self>()
            + self.process().memory_cost()
            + self.stdin.get().memory_cost()
            + self.stdout.get().memory_cost()
            + self.stderr.get().memory_cost()
    }

    /// `this: ThisPtr` because the tail releases the exit handler's ref, which
    /// may be the last.
    pub(crate) fn on_process_exit(this: ThisPtr<Self>, status: &Status, rusage: &Rusage) {
        bun_output::scoped_log!(Subprocess, "onProcessExit()");
        let this_jsvalue = this.this_value.get().try_get().unwrap_or_default();
        // Copy the BackRef out so the `&JSGlobalObject` borrow is detached from `this`
        // (the global outlives us).
        let global_this = this.global_this;
        let global_this = global_this.get();
        let jsc_vm = global_this.bun_vm();
        this_jsvalue.ensure_still_alive();
        this.pid_rusage.set(Some(*rusage));
        let is_sync = this.flags.get().contains(Flags::IS_SYNC);
        this.clear_abort_signal();

        // `exit_ref` release and `disconnect_ipc(true)` run at the tail of this
        // body (no early returns).

        if this.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            Self::timer_all().remove(this.event_loop_timer.as_ptr());
        }
        this.set_event_loop_timer_refd(false);

        jsc_vm
            .as_mut()
            .on_subprocess_exit(this.process.as_non_null());

        if this.flags.get().contains(Flags::OWNS_TERMINAL) {
            // Deliver EOF to the terminal reader without closing the Terminal.
            // POSIX drains then releases slave_fd (BSD kernels flush on last
            // slave close). Windows: the ConDrv \Reference handle was released
            // at spawn time, so conhost exits and breaks the output pipe once
            // its last client (this child, or a grandchild it left behind) has
            // disconnected; unref the writer here and leave the reader ref'd
            // until that EOF arrives.
            if let Some(term) = this.terminal.get() {
                #[cfg(unix)]
                Terminal::drain_and_close_slave_fd(term.this_ptr());
                #[cfg(windows)]
                term.unref_after_inline_child_exit();
            }
        }

        let mut stdin: Option<ThisPtr<FileSink>> = if matches!(this.stdin.get(), Writable::Pipe(_))
            && this.flags.get().contains(Flags::IS_STDIN_A_READABLE_STREAM)
        {
            if let Writable::Pipe(pipe) = this.stdin.get() {
                Some(pipe.this_ptr())
            } else {
                unreachable!()
            }
        } else {
            this.weak_file_sink_stdin_ptr.get().map(|p| p.this_ptr())
        };
        let mut existing_stdin_value = JSValue::ZERO;
        if !this_jsvalue.is_empty() {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                if existing_value.is_cell() {
                    if stdin.is_none() {
                        stdin = crate::generated_jssink::FileSink__fromJSThis(existing_value);
                    }

                    if !this.flags.get().contains(Flags::IS_STDIN_A_READABLE_STREAM) {
                        existing_stdin_value = existing_value;
                    }
                }
            }
        }

        // We won't be sending any more data.
        let pending_start = this.take_pending_start_writer();
        if let Writable::Buffer(buffer) = this.stdin.get() {
            StaticPipeWriter::close(buffer.this_ptr());
        }
        drop(pending_start);

        if !existing_stdin_value.is_empty() {
            crate::webcore::file_sink::JSSink::set_destroy_callback(existing_stdin_value, 0);
        }

        // Node.js keeps reading stdout/stderr until EOF after the direct child
        // is reaped (a grandchild may still be writing). Sync and async both
        // resume reads here; timeout/maxBuffer bound the sync wait. A lazy
        // reader is paused until JS pulls, so unpause it first; backpressure
        // is moot once the direct child has exited. `read` dispatch runs user
        // JS, hence the root-pointer entry.
        if let Readable::Pipe(pipe) = this.stdout.get() {
            if !pipe.reader.is_done() {
                Readable::pipe_reader_mut(pipe).reader.unpause();
                bun_io::BufferedReader::read_from(pipe.this_ptr());
            }
        }

        if let Readable::Pipe(pipe) = this.stderr.get() {
            if !pipe.reader.is_done() {
                Readable::pipe_reader_mut(pipe).reader.unpause();
                bun_io::BufferedReader::read_from(pipe.this_ptr());
            }
        }

        // When Bun itself killed the child (timeout/maxBuffer/AbortSignal) stop
        // waiting on pipe EOF after the drain above: a grandchild may still
        // hold the write end and the caller already opted into a bounded wait.
        if this.event_loop_timer.get().state == EventLoopTimerState::FIRED
            || this.exited_due_to_maxbuf.get().is_some()
            || this.flags.get().contains(Flags::ABORT_SIGNAL_KILLED)
        {
            this.close_readable_pipes();
        }

        if let Some(pipe) = stdin {
            this.weak_file_sink_stdin_ptr.set(None);
            this.update_flags(|f| f.insert(Flags::HAS_STDIN_DESTRUCTOR_CALLED));

            // `pipe` is a live FileSink (either `stdin.pipe`'s ref or the
            // cached JS sink kept live by GC).
            //
            // Detach the source first so onAttachedProcessExit's sync FileSink.onClose cannot
            // re-enter Writable.onClose → release the still-running pipe.
            let self_ptr = this.as_ctx_ptr().cast::<Subprocess<'static>>();
            if matches!(
                *pipe.source.get(),
                crate::webcore::streams::SourceHandle::Subprocess(p) if p.as_const_ptr() == self_ptr.cast_const()
            ) {
                pipe.source.with_mut(|s| s.clear());
            }
            let stdin_sink_ref = this.stdin_sink_ref.take();

            // Re-enters via the writer backref and may release refs on us, so
            // no `&mut FileSink` is materialized at the boundary.
            FileSink::on_attached_process_exit(pipe, status);

            drop(stdin_sink_ref);
        }

        let mut did_update_has_pending_activity = false;

        if !is_sync {
            if !this_jsvalue.is_empty() {
                if let Some(promise) = js::exited_promise_take_cached(this_jsvalue, global_this) {
                    let _exit_guard = jsc_vm.enter_event_loop_scope();

                    if !did_update_has_pending_activity {
                        this.update_has_pending_activity();
                        did_update_has_pending_activity = true;
                    }

                    match status {
                        Status::Exited(exited) => {
                            let _ = promise
                                .as_any_promise()
                                .unwrap()
                                .resolve(global_this, JSValue::js_number(exited.code as f64));
                            // TODO: properly propagate exception upwards
                        }
                        Status::Err(err) => {
                            let js_err = err.to_js(global_this);
                            let _ = promise
                                .as_any_promise()
                                .unwrap()
                                .reject_with_async_stack(global_this, js_err);
                            // TODO: properly propagate exception upwards
                        }
                        Status::Signaled(signaled) => {
                            let _ = promise.as_any_promise().unwrap().resolve(
                                global_this,
                                JSValue::js_number(128u8.wrapping_add(*signaled) as f64),
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

                if let Some(callback) = js::on_exit_callback_take_cached(this_jsvalue, global_this)
                {
                    let waitpid_value: JSValue = if let Status::Err(err) = status {
                        err.to_js(global_this)
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
                        this.get_exit_code(global_this),
                        this.get_signal_code(global_this),
                        waitpid_value,
                    ];

                    if !did_update_has_pending_activity {
                        this.update_has_pending_activity();
                        did_update_has_pending_activity = true;
                    }

                    jsc_vm
                        .event_loop_mut()
                        .run_callback(callback, global_this, this_value, &args);
                }
            }
        }

        if !did_update_has_pending_activity {
            this.update_has_pending_activity();
        }
        this.disconnect_ipc(true);
        // May free `this`; last use.
        drop(this.exit_ref.take());
    }

    fn close_io(&self, io: StdioKind) {
        if self.closed.get().contains(io) {
            return;
        }
        self.closed.set(self.closed.get() | io);

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
                let pending_start = self.take_pending_start_writer();
                if let Some(writer) = &pending_start {
                    StaticPipeWriter::close(writer.this_ptr());
                }
                if !called {
                    Writable::finalize(self);
                } else {
                    self.stdin.with_mut(|s| s.close());
                }
                drop(pending_start);
            }
            StdioKind::Stdout => {
                if !called {
                    self.stdout.with_mut(|s| s.finalize());
                } else {
                    self.stdout.with_mut(|s| s.close());
                }
            }
            StdioKind::Stderr => {
                if !called {
                    self.stderr.with_mut(|s| s.finalize());
                } else {
                    self.stderr.with_mut(|s| s.close());
                }
            }
        }
    }

    // This must only be run once per Subprocess
    pub(crate) fn finalize_streams(&self) {
        bun_output::scoped_log!(Subprocess, "finalizeStreams");
        self.close_process();

        self.close_io(StdioKind::Stdin);
        self.close_io(StdioKind::Stdout);
        self.close_io(StdioKind::Stderr);

        #[cfg(windows)]
        for item in self.stdio_pipes.replace(Vec::new()) {
            if let StdioResult::Buffer(buffer) = item {
                // `uv_close` is async — the pipe must outlive this scope until the
                // close callback reclaims the allocation; this also copes with a
                // pipe that never got `uv_pipe_init`'d.
                bun_io::source::close_and_destroy_pipe(buffer);
            }
        }
        #[cfg(not(windows))]
        {
            for item in self.stdio_pipes.get().iter() {
                match item {
                    ExtraPipe::OwnedFd(fd) => fd.close(),
                    ExtraPipe::UnownedFd(_) | ExtraPipe::Unavailable => {}
                }
            }
            self.stdio_pipes.with_mut(|v| v.clear());
        }
        self.stdio_pipes.with_mut(|v| v.shrink_to_fit());
    }

    /// Unregisters the listener and releases the signal.
    fn clear_abort_signal(&self) {
        drop(self.abort_signal.replace(None));
    }

    /// The JS wrapper's ref is released by the generated finalize thunk after
    /// this returns; the allocation may outlive this call if other refs remain.
    pub fn finalize(&self) {
        bun_output::scoped_log!(Subprocess, "finalize");
        // Ensure any code which references the "this" value doesn't attempt to
        // access it after it's been freed We cannot call any methods which
        // access GC'd values during the finalizer
        self.this_value.with_mut(|v| v.finalize());

        self.clear_abort_signal();

        debug_assert!(
            !self.compute_has_pending_activity()
                || VirtualMachine::VirtualMachine::get().is_shutting_down()
        );
        self.finalize_streams();

        // `Writable::init()` took a ref (`stdin_sink_ref`) for the stdin pipe
        // back-pointer, released by `on_stdin_destroyed()`, reached either
        // via the FileSink's signal (which `Writable::finalize` — called from
        // `close_io` above when the `.stdin` getter never ran — clears *before*
        // releasing the pipe) or via the JSFileSink's `m_onDestroy` callback
        // (only installed when the getter ran). When the getter never ran there
        // is no JSFileSink and the signal is now gone, so nothing will call
        // `on_stdin_destroyed()`; release the stranded ref here so the box can
        // reach zero. When the getter *did* run we must leave the ref in place:
        // the JSFileSink may be swept after us in the same
        // `lastChanceToFinalize` pass and would otherwise call
        // `on_stdin_destroyed()` against a freed Box.
        if !self.has_called_getter(ObservableGetter::Stdin) {
            drop(self.stdin_sink_ref.take());
        }

        let exit_handler_pending = self.process.exit_handler.is_some();
        self.process.detach();
        if exit_handler_pending {
            drop(self.exit_ref.take());
        }

        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            Self::timer_all().remove(self.event_loop_timer.as_ptr());
        }
        self.set_event_loop_timer_refd(false);

        self.stdout_maxbuf.release();
        self.stderr_maxbuf.release();

        if let Some(ipc_data) = self.ipc_data.replace(None) {
            // In normal operation the socket is already `.closed` by the time we
            // get here (that is what allowed `compute_has_pending_activity` to drop
            // to false and let GC collect us). Detach and release our ref; any
            // still-queued close task holds its own ref and frees the SendQueue
            // when it runs.
            ipc_data.detach();
        }

        self.update_flags(|f| f.insert(Flags::FINALIZED));
    }

    pub(crate) fn get_exited(&self, this_value: JSValue, global_this: &JSGlobalObject) -> JSValue {
        if let Some(promise) = js::exited_promise_get_cached(this_value) {
            return promise;
        }

        match &self.process().status {
            Status::Exited(exit) => {
                JSPromise::resolved_promise_value(global_this, JSValue::js_number(exit.code as f64))
            }
            Status::Signaled(signal) => JSPromise::resolved_promise_value(
                global_this,
                JSValue::js_number(
                    bun_sys::SignalCode(*signal).to_exit_code().unwrap_or(254) as f64
                ),
            ),
            Status::Err(err) => {
                let js_err = err.to_js(global_this);
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
    pub(crate) fn get_exit_code(&self, _global: &JSGlobalObject) -> JSValue {
        if let Status::Exited(exited) = &self.process().status {
            return JSValue::js_number(exited.code as f64);
        }
        JSValue::NULL
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_signal_code(&self, global: &JSGlobalObject) -> JSValue {
        if let Some(signal) = self.process().signal_code() {
            // `process.signal_code()` returns the tier-0 `bun_core::SignalCode`
            // (bare `#[repr(u8)]` discriminant); name/exit-code helpers live on
            // `bun_sys::SignalCode`.
            let sys_sig = bun_sys::SignalCode(signal as u8);
            if let Some(name) = sys_sig.name() {
                use bun_jsc::EncodedSliceJsc as _;
                return bun_core::EncodedSlice::latin1(name.as_bytes()).to_js(global);
            } else {
                return JSValue::js_number(signal as u32 as f64);
            }
        }

        JSValue::NULL
    }

    pub(crate) fn handle_ipc_message(
        &self,
        message: &IPC::DecodedIPCMessage,
        handle: JSValue,
    ) -> JsResult<()> {
        bun_output::scoped_log!(IPC, "Subprocess#handleIPCMessage");
        match message {
            // In future versions we can read this in order to detect version mismatches,
            // or disable future optimizations if the subprocess is old.
            IPC::DecodedIPCMessage::Version(v) => {
                bun_output::scoped_log!(IPC, "Child IPC version is {}", v);
            }
            IPC::DecodedIPCMessage::Data(data) => {
                bun_output::scoped_log!(IPC, "Received IPC message from child");
                let this_jsvalue = self.this_value.get().try_get().unwrap_or_default();
                let _keep = jsc::EnsureStillAlive(this_jsvalue);
                if !this_jsvalue.is_empty() {
                    if let Some(cb) = js::ipc_callback_get_cached(this_jsvalue) {
                        let global_this = self.global_this();
                        global_this.bun_vm().event_loop_mut().run_callback(
                            cb,
                            global_this,
                            this_jsvalue,
                            &[*data, this_jsvalue, handle],
                        );
                    }
                }
            }
            IPC::DecodedIPCMessage::Internal(data) => {
                bun_output::scoped_log!(IPC, "Received IPC internal message from child");
                let global_this = self.global_this;
                node_cluster_binding::handle_internal_message_primary(
                    global_this.get(),
                    self,
                    *data,
                )?;
            }
        }
        Ok(())
    }

    pub(crate) fn handle_ipc_close(&self) {
        bun_output::scoped_log!(IPC, "Subprocess#handleIPCClose");
        let this_jsvalue = self.this_value.get().try_get().unwrap_or_default();
        let _keep = jsc::EnsureStillAlive(this_jsvalue);
        let global_this = self.global_this;
        let global_this = global_this.get();
        self.update_has_pending_activity();

        if !this_jsvalue.is_empty() {
            // The ipc callback is kept: a server/dgram handle still adopting at EOF is delivered afterwards, as in node.
            // Call the onDisconnectCallback if it exists and prevent it from being kept alive longer than necessary
            if let Some(callback) =
                js::on_disconnect_callback_take_cached(this_jsvalue, global_this)
            {
                global_this.bun_vm().event_loop_mut().run_callback(
                    callback,
                    global_this,
                    this_jsvalue,
                    &[JSValue::TRUE],
                );
            }
        }
    }

    pub(crate) fn ipc(&self) -> Option<&IPC::SendQueue> {
        self.ipc_data.get().as_deref()
    }
}

/// Routes straight from the `MaxBuf` allocation to this `Subprocess`,
/// independent of whichever pipe reader currently holds the budget (the
/// `.stdout`/`.stderr` getter transfers it to a `FileReader`).
impl bun_io::max_buf::MaxBufOwner for Subprocess<'_> {
    fn on_max_buffer_overflow(&self, maxbuf: NonNull<MaxBuf::MaxBuf>) {
        let kind = if self.stdout_maxbuf.is(maxbuf) {
            self.stdout_maxbuf.release();
            MaxBuf::Kind::Stdout
        } else {
            self.stderr_maxbuf.release();
            MaxBuf::Kind::Stderr
        };
        self.on_max_buffer(kind);
    }
}

pub use bun_spawn::subprocess::{Source, SourceData};

// JSC-tier payloads wrap as `Source::Any(Box<dyn SourceData>)` — the lower-tier
// `bun_spawn` crate cannot name `webcore`/`jsc`, so the vtable travels with the
// value (§Dispatch cold path).
impl SourceData for webcore::AnyBlob {
    fn slice(&self) -> &[u8] {
        webcore::AnyBlob::slice(self)
    }
    fn detach(&mut self) {
        webcore::AnyBlob::detach(self)
    }
    fn memory_cost(&self) -> usize {
        webcore::AnyBlob::memory_cost(self)
    }
}
#[inline]
pub(crate) fn source_from_blob(b: webcore::AnyBlob) -> Source {
    Source::Any(Box::new(b))
}

/// Windows: the extra stdio pipes (`stdio_pipes`) are uv handles this
/// Subprocess owns without a reader/writer in front of them; record that so a
/// thread teardown closes them through us (and `finalize_streams` then finds
/// the slots empty) instead of anyone closing them twice.
#[cfg(windows)]
impl Subprocess<'_> {
    pub(crate) fn record_stdio_pipe_ownership(this: ThisPtr<Self>) {
        for item in this.stdio_pipes.get().iter() {
            if let StdioResult::Buffer(buffer) = item {
                bun_io::source::set_pipe_owner(buffer, this);
            }
        }
    }
}

// SAFETY: each pipe in `stdio_pipes` leaves the `uv::open_handles` list as its
// uv_close is issued — here, in `finalize_streams`, when a taker re-owns it
// (the IPC channel), or at the latest from `Drop` below — so no entry names a
// freed Subprocess.
#[cfg(windows)]
unsafe impl bun_io::source::UvPipeOwner for Subprocess<'_> {
    fn close_pipes_for_vm_teardown(&self) {
        for item in self.stdio_pipes.replace(Vec::new()) {
            if let StdioResult::Buffer(buffer) = item {
                bun_io::source::close_and_destroy_pipe(buffer);
            }
        }
    }
}

impl Drop for Subprocess<'_> {
    fn drop(&mut self) {
        // Normally emptied by `finalize_streams`; closing here keeps the
        // `uv::open_handles` owner entries from outliving us.
        #[cfg(windows)]
        bun_io::source::UvPipeOwner::close_pipes_for_vm_teardown(self);
    }
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
    pub(crate) fn inject_stdio_read_error(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [subprocess_value, kind_value] = callframe.arguments_as_array::<2>();
        let Some(subprocess) = subprocess_value.as_class_ref::<Subprocess<'static>>() else {
            return Err(global_this.throw(format_args!("first argument must be a Subprocess")));
        };
        let kind_str = kind_value.to_bun_string(global_this)?;

        let out: &JsCell<Readable> = if kind_str.eq_ascii(b"stdout") {
            &subprocess.stdout
        } else if kind_str.eq_ascii(b"stderr") {
            &subprocess.stderr
        } else {
            return Err(
                global_this.throw(format_args!("second argument must be 'stdout' or 'stderr'"))
            );
        };

        let Readable::Pipe(pipe) = out.get() else {
            return Ok(JSValue::FALSE);
        };

        // Mirror what the real error path does (onStreamRead on Windows,
        // read() on Posix) so the teardown exercised is identical.
        let fake_err = bun_sys::Error::from_code(bun_sys::Errno::EBADF, bun_sys::Tag::read);
        #[cfg(windows)]
        {
            let _ = Readable::pipe_reader_mut(pipe).reader.stop_reading();
        }
        // The (maybe-freeing) error dispatch runs under no receiver protector.
        bun_io::BufferedReader::on_error_from(pipe.this_ptr(), fake_err);
        Ok(JSValue::TRUE)
    }
}
// `generated_js2native.rs` snake-cases `TestingAPIs` as `testing_ap_is`
// (the converter splits the trailing `…APIs` cluster into `AP` + `Is`).
pub use testing_apis as testing_ap_is;
