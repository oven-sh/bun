//! The Subprocess object is returned by `Bun.spawn`. This file also holds the
//! code for `Bun.spawnSync`

use core::cell::Cell;
use core::ptr::NonNull;

use bun_ptr::{RefCount, RefPtr};

use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{
    self as jsc, JSGlobalObject, JSPromise, JSValue, JsCell, JsRef, JsResult, VirtualMachine,
};
use bun_jsc::{JsClass, SysErrorJsc};
use bun_sys::{self, SignalCode};
use enumset::{EnumSet, EnumSetType};

// Process / spawn machinery lives in this crate (api/bun/process.rs), not in an
// external `bun_spawn` crate. The `bun_spawn` workspace crate only carries the
// platform-thin `Stdio`/`Status` shims used by `bun.spawnSync` callers.
use crate::api::bun::Terminal;
#[cfg(not(windows))]
use crate::api::bun_process::ExtraPipe;
use crate::api::bun_process::{Process, Rusage, Status};
use crate::ipc as IPC;
use crate::node::node_cluster_binding;
use crate::timer::{EventLoopTimer, EventLoopTimerState};
use crate::webcore::streams::SourceHandle;
use crate::webcore::{self, AbortSignal, FileSink};
#[cfg(windows)]
use bun_libuv_sys::UvHandle as _;

#[path = "subprocess/ResourceUsage.rs"]
pub(crate) mod resource_usage;
pub(crate) use resource_usage::ResourceUsage;

#[path = "subprocess/SubprocessPipeReader.rs"]
pub(crate) mod subprocess_pipe_reader;
use subprocess_pipe_reader::PipeReader;

#[path = "subprocess/Readable.rs"]
pub(crate) mod readable;
pub(crate) use readable::Readable;

#[path = "subprocess/Writable.rs"]
pub(crate) mod writable;
pub(crate) use writable::Writable;

use bun_spawn::static_pipe_writer::{self, PipeState};

use bun_io::IoEvent;
pub(crate) use bun_io::MaxBuf;

bun_output::declare_scope!(Subprocess, visible);
bun_output::declare_scope!(IPC, visible);

pub(crate) use crate::generated_bindgen::subprocess::js_Subprocess as js;

/// Platform-dependent stdio result type.
pub(crate) use bun_spawn::subprocess::StdioResult;

#[cfg(windows)]
type StdioPipeItem = StdioResult;
#[cfg(not(windows))]
type StdioPipeItem = ExtraPipe;

pub(crate) type StaticPipeWriter = static_pipe_writer::StaticPipeWriter<webcore::AnyBlob>;

#[derive(EnumSetType, strum::IntoStaticStr)]
pub enum ObservableGetter {
    Stdin,
    Stdout,
    Stderr,
}

pub(crate) use bun_spawn::process::StdioKind;

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). Host-fn bodies re-enter
// JS (`run_callback`, promise resolve, getters that materialise streams) and a
// live `&mut Self` across those calls would alias the fresh `&mut Self` the
// codegen shim hands to whichever method JS calls next. `UnsafeCell`-backed
// fields suppress `noalias` on the outer `&Subprocess`, making the miscompile
// structurally impossible.
// Intrusive ref-count: `RefPtr<Subprocess>` provides ref/deref and frees the
// Box when ref_count → 0; `deinit` runs when the last ref drops.
#[derive(bun_ptr::RefCounted)]
pub struct Subprocess<'a> {
    pub(crate) ref_count: RefCount<Subprocess<'a>>,
    /// The construction ref on the `Process` (detached in [`Subprocess::finalize`]).
    pub(crate) process: RefPtr<Process>,
    pub(crate) stdin: JsCell<Writable>,
    pub(crate) stdout: JsCell<Readable>,
    pub(crate) stderr: JsCell<Readable>,
    pub(crate) stdio_pipes: JsCell<Vec<StdioPipeItem>>,
    pub(crate) pid_rusage: Cell<Option<Rusage>>,

    /// Terminal attached to this subprocess (if spawned with terminal option)
    pub(crate) terminal: Cell<Option<NonNull<Terminal>>>,

    // The JSC global outlives every Subprocess.
    pub global_this: bun_ptr::BackRef<JSGlobalObject>,
    pub(crate) observable_getters: Cell<EnumSet<ObservableGetter>>,
    pub closed: Cell<EnumSet<StdioKind>>,
    pub this_value: JsCell<JsRef>,

    pub(crate) ipc_data: JsCell<Option<RefPtr<IPC::SendQueue>>>,
    pub(crate) flags: Cell<Flags>,

    /// Weak observer of the stdin `FileSink` — holds no ownership/ref. `onStdinDestroyed`
    /// nulls this before the sink is freed, so it is never dereferenced after the sink dies.
    pub(crate) weak_file_sink_stdin_ptr: Cell<Option<NonNull<FileSink>>>,
    /// Held for the stdin `FileSink`, which points back here.
    pub(crate) stdin_sink_ref: JsCell<Option<RefPtr<Subprocess<'a>>>>,
    /// Follows the `signal` option until `clear_abort_signal`; armed only in a
    /// `Bun.ModuleGraph` context, which kills it when disposed (children
    /// of the realm's own script are the process auto-killer's).
    pub(crate) abort_handle: bun_jsc::AbortHandle,
    /// The context of the script that spawned the child: its exit is reported there.
    pub(crate) context: bun_jsc::ContextId,

    pub(crate) event_loop_timer_refd: Cell<bool>,
    /// Intrusive timer node; `dispatch.rs` recovers the container from it.
    pub(crate) event_loop_timer: EventLoopTimer,
    pub(crate) kill_signal: SignalCode,

    pub(crate) stdout_maxbuf: JsCell<Option<MaxBuf::OwnerRef>>,
    pub(crate) stderr_maxbuf: JsCell<Option<MaxBuf::OwnerRef>>,
    pub(crate) exited_due_to_maxbuf: Cell<Option<MaxBuf::Kind>>,
}

bun_event_loop::impl_timer_owner!(Subprocess<'_>; from_timer_ptr => event_loop_timer);

// Note: no `Default` impl for `Subprocess`. `js_bun_spawn_bindings::
// spawn_maybe_sync` fills every field explicitly (see note there), and
// `*mut Process` has no sound placeholder anyway.

impl Subprocess<'_> {
    #[inline]
    pub(crate) fn process(&self) -> &Process {
        &self.process
    }

    /// Borrow the stored JSC global. The global is guaranteed to outlive
    /// every Subprocess it created.
    #[inline]
    pub fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    /// `self`'s address as `*mut Self` for C-callback ctx slots / abort-signal
    /// native bindings. Callbacks deref it as `&*const` (shared) — see the
    /// `*_c` thunks below — so no write provenance is required; the `*mut`
    /// spelling is purely to match the C signature.
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

    pub(crate) fn hold_for_stdin_sink(&self) {
        // SAFETY: `self` is the live heap allocation.
        let this = unsafe { RefPtr::init_ref(self.as_ctx_ptr()) };
        self.stdin_sink_ref.set(Some(this));
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
        /// The `signal` option fired and `kill_signal` was sent; `on_process_exit` closes
        /// pipe readers instead of waiting on EOF a grandchild may never send.
        const ABORT_SIGNAL_KILLED          = 1 << 7;
    }
}

bun_jsc::impl_abort_handle_owner!(Subprocess<'static>, abort_handle, |this, cause| {
    // SAFETY: trait contract — `this` is live.
    let this = unsafe { &*this };
    let signal = match cause {
        // Its own signal: the child is asked the way its script chose. It stays in its
        // context, which may still stop before the child is gone.
        bun_jsc::AbortCause::Signal(_) => {
            this.abort_handle.unfollow();
            this.kill_signal
        }
        // A child outlives the VM that spawned it, as one the host spawned does.
        bun_jsc::AbortCause::ContextStopped(bun_jsc::StopReason::VmTeardown) => {
            this.clear_abort_signal();
            return;
        }
        // Nobody is left to wait for a child that ignores being asked.
        bun_jsc::AbortCause::ContextStopped(_) => {
            this.clear_abort_signal();
            SignalCode::SIGKILL
        }
    };
    if !this.has_exited() {
        this.update_flags(|f| f.insert(Flags::ABORT_SIGNAL_KILLED));
    }
    let _ = this.try_kill(signal);
});

bun_spawn::link_impl_ProcessExit! {
    Subprocess for Subprocess<'static> => |this| {
        // The ref outlasts a wrapper that script lets go of while the exit is reported.
        on_process_exit(status, rusage) => RefPtr::init_ref(this).on_process_exit(&status, rusage),
    }
}

impl Subprocess<'_> {
    /// Shared borrow of the attached `AbortSignal`, if any.
    #[inline]
    pub(crate) fn abort_signal_ref(&self) -> Option<&AbortSignal> {
        self.abort_handle.signal()
    }

    pub(crate) fn resource_usage(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        self.create_resource_usage_object(cx.global())
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
                if let Some(r) = self.process.rusage() {
                    self.pid_rusage.set(Some(r));
                    break 'brk r;
                }
            }

            return Ok(JSValue::UNDEFINED);
        };
        Ok(ResourceUsage { rusage }.to_js(global_object))
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

    pub(crate) fn close_stdin_buffer(&self) {
        if matches!(self.stdin.get(), Writable::Buffer(_)) {
            self.stdin.set(Writable::Ignore);
            self.update_has_pending_activity();
        }
    }

    pub(crate) fn on_stdin_io(&self, event: IoEvent) {
        if let Writable::Buffer(buffer) = self.stdin.get() {
            self.on_stdin_state(buffer.on_io(event));
        }
    }

    pub(crate) fn on_stdin_state(&self, state: PipeState) {
        if state == PipeState::Closed {
            self.close_stdin_buffer();
        }
    }

    fn on_output_read(&self, reader: &PipeReader, output: Readable) {
        [&self.stdout, &self.stderr]
            .into_iter()
            .find(|out| matches!(out.get(), Readable::Pipe(pipe) if core::ptr::eq(pipe.as_ptr(), reader)))
            .expect("We should be either stdout or stderr")
            .set(output);

        // When the process exits before its stdout/stderr pipes have finished
        // draining, onProcessExit's deferred updateHasPendingActivity() observes
        // the pipe as still pending and keeps `this_value` Strong. When the pipe
        // later completes and reaches here, we must re-evaluate so the JsRef can
        // be downgraded and the JSSubprocess + buffered output become collectable.
        self.update_has_pending_activity();
    }

    pub(crate) fn do_ref(&self) {
        self.process().enable_keeping_event_loop_alive();

        if !self.has_called_getter(ObservableGetter::Stdin) {
            self.stdin.with_mut(|s| s.r#ref());
        }

        if !self.has_called_getter(ObservableGetter::Stdout) {
            self.stdout.get().ref_();
        }

        if !self.has_called_getter(ObservableGetter::Stderr) {
            self.stderr.get().ref_();
        }

        self.update_has_pending_activity();
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub(crate) fn do_unref(&self) {
        self.process().disable_keeping_event_loop_alive();

        if !self.has_called_getter(ObservableGetter::Stdin) {
            self.stdin.with_mut(|s| s.unref());
        }

        if !self.has_called_getter(ObservableGetter::Stdout) {
            self.stdout.get().unref();
        }

        if !self.has_called_getter(ObservableGetter::Stderr) {
            self.stderr.get().unref();
        }

        self.update_has_pending_activity();
    }

    pub(crate) fn get_stderr(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // When terminal is used, stderr goes through the terminal
        if self.terminal.get().is_some() {
            return Ok(JSValue::NULL);
        }
        self.observable_getters
            .set(self.observable_getters.get() | ObservableGetter::Stderr);
        let exited = self.has_exited();
        // The stream is the script's that reads the property.
        self.stderr.with_mut(|s| s.to_js(&cx.js_thread(), exited))
    }

    pub(crate) fn get_stdin(&self, cx: &mut JsScope<'_>) -> JSValue {
        // When terminal is used, stdin goes through the terminal
        if self.terminal.get().is_some() {
            return JSValue::NULL;
        }
        self.observable_getters
            .set(self.observable_getters.get() | ObservableGetter::Stdin);
        // `Writable::to_js` takes only the parent and projects `stdin`
        // internally so no two `&mut` overlap here.
        Writable::to_js(self, cx.global())
    }

    pub(crate) fn get_stdout(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // When terminal is used, stdout goes through the terminal
        if self.terminal.get().is_some() {
            return Ok(JSValue::NULL);
        }
        self.observable_getters
            .set(self.observable_getters.get() | ObservableGetter::Stdout);
        // NOTE: ownership of internal buffers is transferred to the JSValue, which
        // gets cached on JSSubprocess (created via bindgen). This makes it
        // re-accessable to JS code but not via `self.stdout`, which is now `.closed`.
        let exited = self.has_exited();
        // The stream is the script's that reads the property.
        self.stdout.with_mut(|s| s.to_js(&cx.js_thread(), exited))
    }

    pub(crate) fn async_dispose(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        if self.process().has_exited() {
            // rely on GC to clean everything up in this case
            return Ok(JSValue::UNDEFINED);
        }

        // unref streams so that this disposed process will not prevent
        // the process from exiting causing a hang
        self.stdin.with_mut(|s| s.unref());
        self.stdout.get().unref();
        self.stderr.get().unref();

        match self.try_kill(self.kill_signal) {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(err) => {
                // Signal 9 should always be fine, but just in case that somehow fails.
                let global = cx.global();
                return Err(global.throw_value(err.to_js(global)));
            }
        }

        Ok(self.get_exited(this_value, cx))
    }

    pub(crate) fn set_event_loop_timer_refd(&self, refd: bool) {
        if self.event_loop_timer_refd.get() == refd {
            return;
        }
        self.event_loop_timer_refd.set(refd);
        let uws_loop = self.global_this().bun_vm().uws_loop();
        let delta: i32 = if refd { 1 } else { -1 };
        crate::jsc_hooks::timer_all().increment_timer_ref(delta, uws_loop);
    }

    pub(crate) fn timeout_callback(&self) {
        self.set_event_loop_timer_refd(false);
        if self.has_exited() {
            self.event_loop_timer
                .state
                .set(EventLoopTimerState::CANCELLED);
            return;
        }
        let _ = self.try_kill(self.kill_signal);
    }

    /// SAFETY: `this` is a live `Subprocess`.
    pub(crate) unsafe fn on_max_buffer(this: NonNull<()>, kind: MaxBuf::Kind) {
        // SAFETY: caller contract.
        let this = unsafe { this.cast::<Subprocess<'static>>().as_ref() };
        this.exited_due_to_maxbuf.set(Some(kind));
        let _ = this.try_kill(this.kill_signal);
    }

    /// Close still-open stdout/stderr pipe readers after a timeout/maxBuffer
    /// kill; a grandchild may still hold the write end (Node.js
    /// `SyncProcessRunner::Kill()`). Called outside any reader callback.
    pub(crate) fn close_readable_pipes(&self) {
        for out in [&self.stdout, &self.stderr] {
            if let Some(pipe) = out.get().pipe() {
                PipeReader::close(&pipe);
            }
        }
    }

    pub(crate) fn kill(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        signal: JsLocal<'_>,
    ) -> JsResult<()> {
        let global_this = cx.global();
        // Safe: this method can only be called while the object is alive (reachable from JS)
        // The finalizer only runs when the object becomes unreachable
        self.this_value
            .with_mut(|v| v.update(global_this, this_value.to_js()));

        // If signal is 0, then no actual signal is sent, but error checking
        // is still performed.
        let sig: SignalCode = bun_sys_jsc::signal_code_jsc::from_js(signal.to_js(), global_this)?;

        match self.try_kill(sig) {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(err) => {
                // EINVAL or ENOSYS means the signal is not supported in the current platform (most likely unsupported on windows)
                return Err(global_this.throw_value(err.to_js(global_this)));
            }
        }

        Ok(())
    }

    pub(crate) fn has_killed(&self) -> bool {
        self.process().has_killed()
    }

    pub(crate) fn try_kill(&self, sig: SignalCode) -> bun_sys::Result<()> {
        if self.has_exited() {
            return bun_sys::Result::Ok(());
        }
        self.process().kill(sig.0)
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
            self.process().close();
        }
    }

    pub(crate) fn on_stdin_destroyed(&self) {
        let _stdin_sink_ref = self.stdin_sink_ref.replace(None);
        self.update_flags(|f| f.insert(Flags::HAS_STDIN_DESTRUCTOR_CALLED));
        self.weak_file_sink_stdin_ptr.set(None);

        if !self.flags.get().contains(Flags::FINALIZED) {
            // otherwise update the pending activity flag
            self.update_has_pending_activity();
        }
    }

    pub(crate) fn send(
        &self,
        cx: &mut JsScope<'_>,
        message: JsLocal<'_>,
        handle: JsLocal<'_>,
        options: JsLocal<'_>,
        callback: JsLocal<'_>,
    ) -> JsResult<bool> {
        bun_output::scoped_log!(IPC, "Subprocess#doSend");

        let context = if self.has_exited() {
            crate::ipc_host::FromEnum::SubprocessExited
        } else {
            crate::ipc_host::FromEnum::Subprocess
        };
        // `ipc()` centralises the single unsafe `JsCell` deref; `do_send` may
        // re-enter JS, but only the SendQueue is borrowed, not `*self`.
        crate::ipc_host::do_send(
            self.ipc(),
            cx.global(),
            [
                message.to_js(),
                handle.to_js(),
                options.to_js(),
                callback.to_js(),
            ],
            context,
            self.pid() as u32,
        )
    }

    pub(crate) fn disconnect(&self) {
        if let Some(ipc_data) = self.ipc() {
            ipc_data.disconnect();
        }
    }

    pub(crate) fn get_connected(&self) -> bool {
        self.ipc().map(|d| d.is_connected()).unwrap_or(false)
    }

    pub(crate) fn pid(&self) -> i32 {
        self.process().pid
    }

    pub(crate) fn get_pid(&self) -> i32 {
        self.pid()
    }

    pub(crate) fn get_killed(&self) -> bool {
        self.has_killed()
    }

    pub(crate) fn get_stdio(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
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
        self.stdio_pipes.with_mut(|pipes| {
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
            }
        });

        for item in self.stdio_pipes.get().iter() {
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
                    ExtraPipe::OwnedFd(_) | ExtraPipe::UnownedFd(_) => {
                        array.push(global, JSValue::js_number(item.fd().native() as f64))?;
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
        self.stdio_pipes
            .with_mut(|pipes| pipes.iter_mut().for_each(ExtraPipe::release_to_caller));
        Ok(array)
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.process().memory_cost()
            + self.stdin.get().memory_cost()
            + self.stdout.get().memory_cost()
            + self.stderr.get().memory_cost()
    }

    pub(crate) fn on_process_exit(&self, status: &Status, rusage: &Rusage) {
        bun_output::scoped_log!(Subprocess, "onProcessExit()");
        let this_jsvalue = self.this_value.get().try_get().unwrap_or_default();
        // Copy the BackRef out so the `&JSGlobalObject` borrow is detached from `&self`
        // (mirrors the original `&'a` return — the global outlives `self`).
        let global_this = self.global_this;
        let global_this = global_this.get();
        let jsc_vm = global_this.bun_vm();
        this_jsvalue.ensure_still_alive();
        self.pid_rusage.set(Some(*rusage));
        let is_sync = self.flags.get().contains(Flags::IS_SYNC);
        self.clear_abort_signal();

        self.event_loop_timer.disarm();
        self.set_event_loop_timer_refd(false);

        jsc_vm.on_subprocess_exit(&self.process);

        if self.flags.get().contains(Flags::OWNS_TERMINAL) {
            // Deliver EOF to the terminal reader without closing the Terminal.
            // POSIX drains then releases slave_fd (BSD kernels flush on last
            // slave close). Windows: the ConDrv \Reference handle was released
            // at spawn time, so conhost exits and breaks the output pipe once
            // its last client (this child, or a grandchild it left behind) has
            // disconnected; unref the writer here and leave the reader ref'd
            // until that EOF arrives.
            if let Some(terminal) = self.terminal.get() {
                // `BackRef` invariant holds: the terminal is owned by (or
                // borrowed from a JS wrapper kept live by) this subprocess and
                // outlives this scope; single JS thread.
                let term = bun_ptr::BackRef::from(terminal);
                #[cfg(unix)]
                term.drain_and_close_slave_fd();
                #[cfg(windows)]
                term.unref_after_inline_child_exit();
            }
        }

        let mut stdin: Option<NonNull<FileSink>> = if matches!(self.stdin.get(), Writable::Pipe(_))
            && self.flags.get().contains(Flags::IS_STDIN_A_READABLE_STREAM)
        {
            if let Writable::Pipe(pipe) = self.stdin.get() {
                Some(pipe.as_non_null())
            } else {
                unreachable!()
            }
        } else {
            self.weak_file_sink_stdin_ptr.get()
        };
        let mut existing_stdin_value = JSValue::ZERO;
        if !this_jsvalue.is_empty() {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                if existing_value.is_cell() {
                    if stdin.is_none() {
                        stdin = crate::webcore::file_sink::JSSink::sink_from_js(existing_value);
                    }

                    if !self.flags.get().contains(Flags::IS_STDIN_A_READABLE_STREAM) {
                        existing_stdin_value = existing_value;
                    }
                }
            }
        }

        // We won't be sending any more data.
        self.close_stdin_buffer();

        if !existing_stdin_value.is_empty() {
            crate::webcore::file_sink::JSSink::forget_subprocess(existing_stdin_value);
        }

        // Node.js keeps reading stdout/stderr until EOF after the direct child
        // is reaped (a grandchild may still be writing). Sync and async both
        // resume reads here; timeout/maxBuffer bound the sync wait. A lazy
        // reader is paused until JS pulls, so unpause it first; backpressure
        // is moot once the direct child has exited.
        for out in [&self.stdout, &self.stderr] {
            if let Some(pipe) = out.get().pipe() {
                PipeReader::resume(&pipe);
            }
        }

        // When Bun itself killed the child (timeout/maxBuffer/AbortSignal) stop
        // waiting on pipe EOF after the drain above: a grandchild may still
        // hold the write end and the caller already opted into a bounded wait.
        if self.event_loop_timer.state.get() == EventLoopTimerState::FIRED
            || self.exited_due_to_maxbuf.get().is_some()
            || self.flags.get().contains(Flags::ABORT_SIGNAL_KILLED)
        {
            self.close_readable_pipes();
        }

        if let Some(pipe_ptr) = stdin {
            self.weak_file_sink_stdin_ptr.set(None);
            self.update_flags(|f| f.insert(Flags::HAS_STDIN_DESTRUCTOR_CALLED));

            // SAFETY: `self.stdin` or the cached JS sink holds a ref.
            let pipe = unsafe { RefPtr::init_ref(pipe_ptr.as_ptr()) };

            // Detach the source first so onAttachedProcessExit's sync FileSink.onClose cannot
            // re-enter Writable.onClose → pipe.deref() on the still-running pipe.
            let self_ptr = self.as_ctx_ptr().cast::<Subprocess<'static>>();
            if matches!(
                pipe.source.get(),
                SourceHandle::Subprocess(p) if p.as_const_ptr() == self_ptr.cast_const()
            ) {
                pipe.source.set(SourceHandle::None);
            }
            let _stdin_sink_ref = self.stdin_sink_ref.replace(None);
            pipe.on_attached_process_exit(status);
        }

        let mut did_update_has_pending_activity = false;

        let event_loop = jsc_vm.event_loop();

        // The exit is reported to the script that spawned the child.
        let _context = jsc_vm.enter_context(self.context);
        if !is_sync {
            if !this_jsvalue.is_empty() {
                if let Some(promise) = js::exited_promise_take_cached(this_jsvalue, global_this) {
                    let _exit_guard = event_loop.enter_scope();

                    if !did_update_has_pending_activity {
                        self.update_has_pending_activity();
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
                                JSValue::js_number(
                                    bun_sys::SignalCode(*signaled).to_exit_code() as f64
                                ),
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
                        self.exit_code_to_js(),
                        self.signal_code_to_js(global_this),
                        waitpid_value,
                    ];

                    if !did_update_has_pending_activity {
                        self.update_has_pending_activity();
                        did_update_has_pending_activity = true;
                    }

                    event_loop.run_callback(self.context, callback, global_this, this_value, &args);
                }
            }
        }

        if !did_update_has_pending_activity {
            self.update_has_pending_activity();
        }
        if let Some(ipc_data) = self.ipc() {
            ipc_data.close_after_exit();
        }
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
                if !called {
                    Writable::finalize(self);
                } else {
                    Writable::close(&self.stdin);
                }
            }
            StdioKind::Stdout => {
                if !called {
                    self.stdout.with_mut(|s| s.finalize());
                } else {
                    Readable::close(&self.stdout);
                }
            }
            StdioKind::Stderr => {
                if !called {
                    self.stderr.with_mut(|s| s.finalize());
                } else {
                    Readable::close(&self.stderr);
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

        self.stdio_pipes.set(Vec::new());
    }

    fn clear_abort_signal(&self) {
        self.abort_handle.disarm();
    }

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

        // `stdin_sink_ref` is released in `on_stdin_destroyed()`, reached either
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
            self.stdin_sink_ref.set(None);
        }

        self.process().detach();
        self.event_loop_timer.disarm();
        self.set_event_loop_timer_refd(false);

        self.stdout_maxbuf.set(None);
        self.stderr_maxbuf.set(None);

        if let Some(ipc_data) = self.ipc_data.take() {
            // In normal operation the socket is already `.closed` by the time we
            // get here (that is what allowed `compute_has_pending_activity` to drop
            // to false and let GC collect us). Detach and release our ref; any
            // still-queued close task holds its own ref and frees the SendQueue
            // when it runs.
            ipc_data.detach();
        }

        self.update_flags(|f| f.insert(Flags::FINALIZED));
    }

    pub(crate) fn get_exited(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JSValue {
        let this_value = this_value.to_js();
        if let Some(promise) = js::exited_promise_get_cached(this_value) {
            return promise;
        }

        let global_this = cx.global();
        match self.process().status() {
            Some(Status::Exited(exit)) => {
                JSPromise::resolved_promise_value(global_this, JSValue::js_number(exit.code as f64))
            }
            Some(Status::Signaled(signal)) => JSPromise::resolved_promise_value(
                global_this,
                JSValue::js_number(bun_sys::SignalCode(*signal).to_exit_code() as f64),
            ),
            Some(Status::Err(err)) => {
                let js_err = err.to_js(global_this);
                JSPromise::rejected_promise(global_this, js_err).to_js()
            }
            _ => {
                let promise = JSPromise::create(global_this).to_js();
                js::exited_promise_set_cached(this_value, global_this, promise);
                promise
            }
        }
    }

    pub(crate) fn get_exit_code(&self) -> Option<u8> {
        if let Some(Status::Exited(exited)) = self.process().status() {
            return Some(exited.code);
        }
        None
    }

    pub(crate) fn exit_code_to_js(&self) -> JSValue {
        self.get_exit_code().map_or(JSValue::NULL, |code| {
            JSValue::js_number_from_int32(i32::from(code))
        })
    }

    pub(crate) fn get_signal_code(&self, cx: &mut JsScope<'_>) -> JSValue {
        self.signal_code_to_js(cx.global())
    }

    /// The name of the signal that ended the process, its number if it has no name, else `null`.
    pub(crate) fn signal_code_to_js(&self, global: &JSGlobalObject) -> JSValue {
        let Some(signal) = self.process().status().and_then(Status::signal) else {
            return JSValue::NULL;
        };
        match signal.name() {
            Some(name) => {
                use bun_jsc::EncodedSliceJsc as _;
                bun_core::EncodedSlice::latin1(name.as_bytes()).to_js(global)
            }
            None => JSValue::js_number(f64::from(signal.0)),
        }
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
                        global_this.bun_vm().event_loop().run_callback(
                            self.context,
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
                global_this.bun_vm().event_loop().run_callback(
                    self.context,
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

impl static_pipe_writer::Source for webcore::AnyBlob {
    fn slice(&self) -> &[u8] {
        webcore::AnyBlob::slice(self)
    }
    fn memory_cost(&self) -> usize {
        webcore::AnyBlob::memory_cost(self)
    }
}

/// Windows: the extra stdio pipes (`stdio_pipes`) are uv handles this
/// Subprocess owns without a reader/writer in front of them; record that so a
/// thread teardown closes them through us (and `finalize_streams` then finds
/// the slots empty) instead of anyone closing them twice.
#[cfg(windows)]
impl Subprocess<'_> {
    pub(crate) fn record_stdio_pipe_ownership(this: *mut Self) {
        // SAFETY: `this` is the live boxed Subprocess (stable address).
        let me = unsafe { &*this };
        for item in me.stdio_pipes.get().iter() {
            if let StdioResult::Buffer(buffer) = item {
                buffer.set_owner(this.cast(), Self::stop_for_vm_teardown);
            }
        }
    }

    /// `uv::open_handles` entry point: close every stdio pipe still held here.
    unsafe fn stop_for_vm_teardown(this: *mut core::ffi::c_void) {
        // SAFETY: recorded by `record_stdio_pipe_ownership` for this live
        // Subprocess; each pipe leaves the list as its uv_close is issued.
        unsafe { &*this.cast::<Self>() }.stdio_pipes.set(Vec::new());
    }
}

pub(crate) mod testing_apis {
    use super::*;

    /// Inject a synthetic read error into a subprocess's stdout/stderr
    /// PipeReader, as if the underlying read() syscall (Posix) or libuv read
    /// callback (Windows) had failed with EBADF. Used by tests to exercise
    /// the `on_read_result` cleanup path, which is otherwise very hard to
    /// trigger deterministically — on Windows in particular, peer death on
    /// a named pipe maps to UV_EOF rather than an error.
    ///
    /// Returns true if an error was injected, false if the given stdio is
    /// not (or no longer) a buffered pipe reader.
    pub(crate) fn inject_stdio_read_error(
        cx: &mut JsScope<'_>,
        subprocess: &Subprocess<'static>,
        kind: &bun_core::String,
    ) -> JsResult<bool> {
        let out: &JsCell<Readable> = if kind.eq_ascii(b"stdout") {
            &subprocess.stdout
        } else if kind.eq_ascii(b"stderr") {
            &subprocess.stderr
        } else {
            return Err(cx
                .global()
                .throw(format_args!("second argument must be 'stdout' or 'stderr'")));
        };

        let Some(pipe) = out.get().pipe() else {
            return Ok(false);
        };

        // Mirror what the real error path does (onStreamRead on Windows,
        // read() on Posix) so the teardown exercised is identical.
        let fake_err = bun_sys::Error::from_code(bun_sys::Errno::EBADF, bun_sys::Tag::read);
        PipeReader::inject_error(&pipe, fake_err);
        Ok(true)
    }

    /// Close the stdin pipe's writer as a Windows worker's stop phase does: no JS wrapper.
    pub(crate) fn close_stdin_writer(
        _: &mut JsScope<'_>,
        subprocess: &Subprocess<'static>,
    ) -> bool {
        let Writable::Pipe(pipe) = subprocess.stdin.get() else {
            return false;
        };
        let pipe = pipe.clone();
        pipe.writer.close(&*pipe);
        true
    }
}
