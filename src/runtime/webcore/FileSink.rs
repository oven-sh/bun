use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicI32, Ordering};

use bun_io::{
    self, IoEvent, Owner, PollTag, StreamingWriter, WriteHandler, WriteResult, WriteStatus,
};
use bun_jsc::JsCell;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_ptr::RefPtr;
use bun_sys::{self as sys, Fd};

use crate::api::bun::process::Status as SpawnStatus;
use crate::api::bun_subprocess::Subprocess;
use crate::generated_bindgen::file_sink::{
    Bun__FileSink__onRejectStream, Bun__FileSink__onResolveStream,
};
use crate::webcore::jsc::{EventLoopHandle, JSGlobalObject, JSValue, JsError, JsResult};
use crate::webcore::readable_stream::{self, ReadableStream};
use crate::webcore::sink::{AnyControlledSink, ReadableSinkController};
use crate::webcore::{self, AutoFlusher, PathOrFileDescriptor, streams};
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(windows)]
use bun_sys::windows::libuv::UvHandle as _;

bun_core::declare_scope!(FileSink, visible);

// ───────────────────────────────────────────────────────────────────────────
// FileSink
// ───────────────────────────────────────────────────────────────────────────

// Shared borrows only. A method may release every ref but the one its caller borrows from.
#[derive(bun_ptr::CellRefCounted)]
pub struct FileSink {
    ref_count: Cell<u32>,
    pub(crate) writer: StreamingWriter,
    /// Held while a write is in flight.
    #[cfg(windows)]
    inflight_write_ref: Cell<Option<RefPtr<FileSink>>>,
    pub(crate) event_loop_handle: EventLoopHandle,
    pub(crate) written: Cell<usize>,
    pub(crate) pending: JsCell<streams::WritablePending>,
    pub(crate) source: Cell<streams::SourceHandle>,
    pub(crate) done: Cell<bool>,
    pub(crate) started: Cell<bool>,
    /// From a write that is pending, or a native source that is piped in, until the writer closes.
    keep_alive_ref: JsCell<Option<RefPtr<FileSink>>>,
    /// `to_result` returned `Backpressure` to a ByteStream; drain callbacks resume it.
    pub(crate) source_pending_pull: Cell<bool>,

    // TODO: these fields are duplicated on writer()
    // we should not duplicate these fields...
    pub(crate) pollable: Cell<bool>,
    pub(crate) nonblocking: Cell<bool>,
    pub(crate) force_sync: Cell<bool>,

    pub(crate) is_socket: Cell<bool>,
    pub(crate) fd: Cell<Fd>,

    pub(crate) auto_flusher: AutoFlusher,
    run_pending_armed: Cell<bool>,

    /// While `assign_to_stream` (spawn stdin) or `pipe_stream` (`Bun.write`) pipes a stream in: the controller cell that holds the stream, `pipe_stream`'s done-promise and a JS failure value.
    pipe: JsCell<streams::PipeCell>,
    /// A write or source failure that is not a JS value; a JS one lives on `pipe` and sets `stream_js_error`.
    stream_error: JsCell<Option<streams::StreamError>>,
    stream_js_error: Cell<bool>,
    /// Bytes accepted since `pipe_stream` (`written` counts buffered bytes again when flushed).
    pub(crate) stream_bytes: Cell<Option<u64>>,
    /// For the pump promise's reactions, which take it.
    pump_promise_ref: Cell<Option<RefPtr<FileSink>>>,

    /// Strong reference to the JS wrapper object to prevent GC from collecting it
    /// while an async operation is pending. This is set when endFromJS returns a
    /// pending Promise and cleared when the operation completes.
    pub(crate) js_sink_ref: JsCell<bun_jsc::strong::Optional>,
    /// Armed while a file this sink opened for a `Bun.ModuleGraph`'s script is open, and under
    /// `bun test --isolate` while its copy of a descriptor is.
    abort_handle: bun_jsc::AbortHandle,
    /// It is a test file's: closed once the file's realm is retired, unless something is still unwritten.
    closes_with_test_file: Cell<bool>,
}

// `bun.ptr.RefCount(FileSink, "ref_count", deinit, .{})` — intrusive single-thread
// refcount derived via #[derive(CellRefCounted)] above. `*FileSink` crosses FFI
// (JSSink wrapper, `@fieldParentPtr`, `b.promisePtr`), so this stays intrusive
// rather than `Rc<T>`.

/// Count of live native FileSink instances. Incremented at allocation,
/// decremented in `deinit`. Exposed to tests via `bun:internal-for-testing`
/// so leak tests can detect native FileSink leaks that are invisible to
/// `heapStats()` (which only counts JS wrapper objects).
pub(crate) static LIVE_COUNT: AtomicI32 = AtomicI32::new(0);

pub(crate) fn live_count() -> i32 {
    LIVE_COUNT.load(Ordering::Relaxed)
}

/// `bun_sys` does not yet export
/// an isPollable helper, so re-derive it locally from `S_IFMT`. Windows always
/// returns `false`.
fn is_pollable(mode: sys::Mode) -> bool {
    #[cfg(windows)]
    {
        let _ = mode;
        false
    }
    #[cfg(unix)]
    {
        let fmt = mode & (libc::S_IFMT as sys::Mode);
        fmt == (libc::S_IFIFO as sys::Mode) || fmt == (libc::S_IFSOCK as sys::Mode)
    }
}

pub struct Options {
    pub(crate) input_path: PathOrFileDescriptor,
    pub(crate) mode: bun_sys::Mode,
    /// `Bun.write(path, stream)`: replace the file's contents.
    pub(crate) truncate: bool,
    /// `Bun.write(path, stream)`: create missing parent directories.
    pub(crate) mkdirp: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            input_path: PathOrFileDescriptor::Fd(Fd::INVALID),
            mode: 0o664,
            truncate: false,
            mkdirp: false,
        }
    }
}

impl Options {
    pub(crate) fn flags(&self) -> i32 {
        let flags =
            bun_sys::O::NONBLOCK | bun_sys::O::CLOEXEC | bun_sys::O::CREAT | bun_sys::O::WRONLY;
        if self.truncate {
            flags | bun_sys::O::TRUNC
        } else {
            flags
        }
    }
}

impl Drop for FileSink {
    #[cold]
    fn drop(&mut self) {
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        self.release_pipe_with(ReadableSinkController::detach_dropped_sink);
        if let Some(global) = self.js_global() {
            let vm = global.bun_vm();
            AutoFlusher::unregister_deferred_microtask_with_type::<Self>(self, vm);
        }
    }
}

impl FileSink {
    pub(crate) fn memory_cost(&self) -> usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(FileSink).
        self.writer.memory_cost()
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio(
    _global: *mut JSGlobalObject,
    jsvalue: JSValue,
) {
    let Some(this) = JSSink::sink_from_js(jsvalue) else {
        return;
    };
    // SAFETY: the object's live sink.
    let this: &FileSink = unsafe { this.as_ref() };

    #[cfg(not(windows))]
    {
        this.force_sync.set(true);
        this.writer.set_force_sync(true);
        if !this.pollable.get() && this.fd.get() != Fd::INVALID {
            let _ = sys::update_nonblocking(this.fd.get(), false);
        }
    }
    #[cfg(windows)]
    {
        if this.writer.set_blocking() {
            return;
        }

        // Fallback to WriteFile() if it fails.
        this.force_sync.set(true);
    }
}

impl FileSink {
    /// `bun.spawn`'s subprocess exited while this `FileSink` was its stdin.
    pub(crate) fn on_attached_process_exit(&self, status: &SpawnStatus) {
        bun_core::scoped_log!(FileSink, "onAttachedProcessExit()");
        self.done.set(true);
        if let Some(stream) = self.pipe.get().take_stream() {
            if let Some(global) = self.js_global() {
                if !status.is_ok() {
                    let _entered = global.bun_vm().enter_event_loop_scope();
                    crate::dispatch::fold(stream.cancel(global));
                } else {
                    stream.done();
                }
            }
        }

        self.writer.close(self);

        self.pending.with_mut(|p| {
            p.result =
                streams::Writable::Err(sys::Error::from_code(sys::Errno::EPIPE, sys::Tag::write));
        });
        self.run_pending();

        // `on_close` isn't reached if the writer was closed already.
        self.keep_alive_ref.set(None);
    }

    pub(crate) fn on_writer_io(&self, event: IoEvent) {
        self.writer.on_io(self, event);
    }

    fn run_pending(&self) {
        self.run_pending_armed.set(false);

        let _entered = self.event_loop().entered();
        if self.pending.get().state == streams::PendingState::Pending {
            self.pending.take().run();
        }

        // See `protect_js_wrapper`.
        self.js_sink_ref.set(Default::default());
    }
}

impl WriteHandler for FileSink {
    fn on_write(&self, amount: usize, status: WriteStatus) {
        bun_core::scoped_log!(FileSink, "onWrite({}, {})", amount, status as u8);
        self.written.set(self.written.get() + amount);

        // TODO: done means no pending data on windows but not on unix, unify the behaviors
        let has_pending_data = self.writer.has_pending_data();
        // Only keep the event loop ref'd while there's a pending write in progress.
        self.writer.update_ref(has_pending_data);

        if has_pending_data {
            if let Some(vm) = self.js_vm() {
                if !vm.is_inside_deferred_task_queue.get() {
                    AutoFlusher::register_deferred_microtask_with_type::<Self>(self, vm);
                }
            }
        }

        // if we are not done yet and has pending data we just wait so we do not runPending twice
        if status == WriteStatus::Pending && has_pending_data {
            return;
        }

        let was_pending = self.pending.get().state == streams::PendingState::Pending;
        let resumes = was_pending || (status == WriteStatus::Drained && !has_pending_data);
        // Opened before `run_pending` so the settle and the resume share one checkpoint.
        let _entered = if resumes && self.source_pending_pull.get() {
            self.completion_scope()
        } else {
            None
        };
        if was_pending {
            // What the pending operation accepted. `amount` is only what this drain wrote.
            let consumed = self.pending.get().consumed;
            // when "done" is true, we will never receive more data.
            if self.done.get() || status == WriteStatus::EndOfFile {
                self.pending
                    .with_mut(|p| p.result = streams::Writable::OwnedAndDone(consumed));
            } else {
                self.pending
                    .with_mut(|p| p.result = streams::Writable::Owned(consumed));
            }

            self.run_pending();
        }

        if resumes {
            self.resume_source();
        }

        // Finishes an `end()` whose flush was pending. `status` predates what the JS above buffered.
        if self.done.get() && !self.writer.has_pending_data() {
            if status == WriteStatus::EndOfFile {
                self.writer.close(self);
            } else {
                self.end_writer();
            }
        }

        if status == WriteStatus::EndOfFile {
            self.source.get().close(None);
            self.keep_alive_ref.set(None);
        }
    }

    fn on_error(&self, err: sys::Error) {
        bun_core::scoped_log!(FileSink, "onError({:?})", err);
        self.record_stream_error(streams::StreamError::Error(err.clone()));
        if self.pending.get().state == streams::PendingState::Pending {
            self.pending
                .with_mut(|p| p.result = streams::Writable::Err(err));
            if let Some(vm) = self.js_vm() {
                if vm.is_inside_deferred_task_queue.get() {
                    self.run_pending_later();
                    return;
                }
            }

            self.run_pending();
        }
    }

    fn on_close(&self) {
        bun_core::scoped_log!(FileSink, "onClose()");
        let _entered = self.completion_scope();

        self.abort_handle.leave();
        if self.js_global().is_some() {
            if let Some(stream) = self.pipe.get().stream() {
                stream.done();
            }
        }

        // A piped JS ReadableStream sees the write error as its cancel reason.
        let err = match self.stream_error.get() {
            Some(streams::StreamError::Error(err)) => Some(err.clone()),
            _ => None,
        };
        self.source.get().close(err);

        self.settle_stream_done();
        self.release_pipe();

        // No further callbacks will arrive.
        self.keep_alive_ref.set(None);
    }

    #[cfg(windows)]
    fn on_writable(&self) {
        bun_core::scoped_log!(FileSink, "onReady()");
        self.resume_source();
    }

    #[cfg(windows)]
    fn set_has_inflight_write(&self, value: bool) {
        self.inflight_write_ref.set(value.then(|| self.ref_guard()));
    }
}

impl FileSink {
    fn resume_source(&self) {
        if self.source_pending_pull.replace(false) {
            self.source.get().ready(None, None);
        }
    }

    /// Microtask checkpoint owed for the JS a writer callback enters while a stream is piped in.
    fn completion_scope(&self) -> Option<bun_jsc::event_loop_handle::EnteredEventLoop> {
        self.pipe.get().cell()?;
        Some(self.event_loop().entered())
    }

    /// This sink opened its file itself, for the script that is running: if that is a
    /// `Bun.ModuleGraph`'s, the file is closed with the graph. (The host's sinks are left to
    /// flush at exit as they always have.)
    pub(crate) fn close_with_graph(&self, context: &bun_jsc::ScriptExecutionContext) {
        if let Some(context) = self.js_vm().and_then(|vm| vm.as_graph_context(context)) {
            // SAFETY: a started sink is heap-allocated; it leaves its context in `on_close`.
            unsafe {
                bun_jsc::AbortHandle::arm_owner(core::ptr::from_ref(self).cast_mut(), context);
            }
        }
    }

    /// This sink owns a copy of a descriptor, as `process.stdout`'s and `process.stderr`'s do. Under
    /// `bun test --isolate` the copy is closed with the test file that made it. Left to the
    /// finalizer, it would be closed by some collection in the middle of a later file.
    #[cfg(unix)]
    fn close_with_test_file(&self, context: &bun_jsc::ScriptExecutionContext) {
        let Some(vm) = self.js_vm() else {
            return;
        };
        if vm.as_graph_context(context).is_some() {
            return;
        }
        if let Some(context) = vm.as_context_that_stops_early(context) {
            self.closes_with_test_file.set(true);
            self.abort_handle.set_only_waits_to_be_closed();
            // SAFETY: a started sink is heap-allocated; it leaves its context in `on_close`.
            unsafe {
                bun_jsc::AbortHandle::arm_owner(core::ptr::from_ref(self).cast_mut(), context);
            }
        }
    }

    /// The sweep that stops the file's handles comes first; its close handlers and last microtasks
    /// follow and may still write. At the VM's end the sink is left to flush as it always has been.
    fn close_at_retirement(&self, cause: bun_jsc::AbortCause) {
        use bun_jsc::{AbortCause, StopReason};
        if !matches!(cause, AbortCause::ContextStopped(StopReason::Disposed)) {
            return;
        }
        let Some(vm) = self.js_vm() else {
            return;
        };
        let this = self.ref_guard();
        vm.release_at_retirement(Box::new(move || {
            if this.done.get() || this.writer.has_pending_data() {
                return;
            }
            this.done.set(true);
            this.writer.close(&*this);
            this.run_pending();
            this.keep_alive_ref.set(None);
        }));
    }

    /// `writer.end()`; `on_close` follows, except (Windows) for an fd the writer
    /// does not own, which is never closed: settle a piped stream here then.
    fn end_writer(&self) {
        #[cfg(windows)]
        if !self.writer.owns_fd() {
            self.settle_stream_done();
            self.release_pipe();
        }
        self.writer.end(self);
    }

    fn settle_stream_done(&self) {
        let Some(promise) = self.pipe.get().take_done() else {
            return;
        };
        // SAFETY: `take_done` returned a live `JSPromise` cell; the stack keeps it alive for this call.
        let promise = unsafe { &mut *promise };
        let _keep = bun_jsc::EnsureStillAlive(promise.to_js());
        let Some(global) = self.js_global() else {
            return;
        };
        let error = match self.stream_error.replace(None) {
            Some(err) => Some(err.to_js(global)),
            None => self.pipe.get().error(),
        };
        self.stream_js_error.set(false);
        let result = match error {
            Some(error) => promise.reject(global, Ok(error)),
            None => promise.resolve(
                global,
                JSValue::js_number(self.stream_bytes.get().unwrap_or(0) as f64),
            ),
        };
        crate::dispatch::fold(result);
    }

    /// The pipe is over: detach the controller cell (it must never outlive this sink attached) and drop the root on it.
    fn release_pipe(&self) {
        self.release_pipe_with(ReadableSinkController::detach);
    }

    fn release_pipe_with(&self, detach: fn(JSValue, &JSGlobalObject) -> JsResult<()>) {
        let pipe = self.pipe.replace(streams::PipeCell::default());
        pipe.clear_slots();
        let (Some(cell), Some(global)) = (pipe.cell(), self.js_global()) else {
            return;
        };
        crate::dispatch::fold(detach(cell, global));
    }

    fn has_stream_error(&self) -> bool {
        self.stream_error.get().is_some() || self.stream_js_error.get()
    }

    /// `record_stream_error` for a JS value: it is held by the pipe's controller cell, not rooted here.
    fn record_js_stream_error(&self, error: JSValue) {
        if self.has_stream_error() {
            return;
        }
        self.pipe.get().set_error(error);
        self.stream_js_error.set(true);
    }

    pub(crate) fn ref_guard(&self) -> RefPtr<FileSink> {
        // SAFETY: the writer's owner is the allocation that holds `self`.
        unsafe { RefPtr::init_ref(self.writer.owner().ptr().cast()) }
    }

    fn keep_alive_until_eof(&self) {
        if self.keep_alive_ref.get().is_none() {
            self.keep_alive_ref.set(Some(self.ref_guard()));
        }
    }

    #[cfg(windows)]
    pub(crate) fn create_with_pipe(
        event_loop_: impl Into<EventLoopHandle>,
        pipe: uv::Owned<uv::Pipe>,
    ) -> RefPtr<FileSink> {
        // `UvHandle::fd()` returns the raw `uv_os_fd_t` (HANDLE on Windows);
        // INVALID_HANDLE_VALUE maps to `Fd::INVALID`, anything else is
        // tagged as a system handle.
        let fd = match pipe.fd() {
            h if h == uv::INVALID_HANDLE_VALUE => Fd::INVALID,
            h => Fd::from_system(h),
        };
        let this = Self::init(fd, event_loop_);
        this.writer.set_pipe(pipe);
        this
    }

    #[cfg(windows)]
    pub(crate) fn start_writer(&self, file: sys::MaybeOwnedFile, sync: bool) -> sys::Result<()> {
        let event_loop = self.event_loop_handle.as_event_loop_ctx();
        if sync {
            self.writer.start_sync(self, event_loop, file)
        } else {
            self.writer.start(self, event_loop, file, true)
        }
    }

    #[cfg(not(windows))]
    pub(crate) fn create(event_loop_: impl Into<EventLoopHandle>, fd: Fd) -> RefPtr<FileSink> {
        Self::init(fd, event_loop_)
    }

    pub(crate) fn setup(
        &self,
        options: &Options,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> sys::Result<()> {
        if self.pipe.get().has_stream() {
            // Already started.
            return sys::Result::Ok(());
        }

        // reshaped for borrowck — split into a local capture and apply after.
        // R-2: out-params for `bun_io::open_for_writing` are local then `Cell::set`.
        let mut is_tty_out = false;
        let mut pollable_out = self.pollable.get();
        let mut is_socket_out = self.is_socket.get();
        let mut nonblocking_out = self.nonblocking.get();
        // `OpenForWritingInput` is impl'd for
        // `bun_io::PathOrFileDescriptor`, not `webcore::PathOrFileDescriptor`;
        // bridge by-value here. The borrowed slice is valid for the duration of
        // `open_for_writing` (the call only needs it for `openat_a`).
        let io_path = match &options.input_path {
            PathOrFileDescriptor::Fd(fd) => bun_io::PathOrFileDescriptor::Fd(*fd),
            PathOrFileDescriptor::Path(slice) => bun_io::PathOrFileDescriptor::Path(slice.slice()),
        };
        let open = |pollable_out: &mut bool,
                    is_socket_out: &mut bool,
                    nonblocking_out: &mut bool,
                    is_tty_out: &mut bool| {
            bun_io::open_for_writing(
                Fd::cwd(),
                &io_path,
                options.flags(),
                options.mode,
                pollable_out,
                is_socket_out,
                self.force_sync.get(),
                nonblocking_out,
                is_tty_out,
                |_tty: &mut bool| {
                    #[cfg(unix)]
                    {
                        *_tty = true;
                    }
                },
                is_pollable,
            )
        };
        if let PathOrFileDescriptor::Path(path) = &options.input_path
            && let Some(error) =
                crate::node::fs::refuse_open_for_write(path.slice(), options.flags())
        {
            return sys::Result::Err(error);
        }
        let mut result = open(
            &mut pollable_out,
            &mut is_socket_out,
            &mut nonblocking_out,
            &mut is_tty_out,
        );
        if options.mkdirp {
            if let (sys::Result::Err(err), bun_io::PathOrFileDescriptor::Path(path)) =
                (&result, &io_path)
            {
                if err.get_errno() == sys::E::ENOENT {
                    result = match webcore::blob::mkdirp_parent(path) {
                        Ok(()) => open(
                            &mut pollable_out,
                            &mut is_socket_out,
                            &mut nonblocking_out,
                            &mut is_tty_out,
                        ),
                        Err(err) => Err(err),
                    };
                }
            }
        }
        self.pollable.set(pollable_out);
        self.is_socket.set(is_socket_out);
        self.nonblocking.set(nonblocking_out);

        let file = result?;

        if let PathOrFileDescriptor::Path(path) = &options.input_path {
            let is_whole = options.flags() & sys::O::TRUNC != 0;
            crate::node::fs::note_opened_for_write(path.slice(), is_whole);
        }
        match options.input_path {
            PathOrFileDescriptor::Path(_) => self.close_with_graph(context),
            #[cfg(unix)]
            PathOrFileDescriptor::Fd(_) => self.close_with_test_file(context),
            #[cfg(not(unix))]
            PathOrFileDescriptor::Fd(_) => {}
        }

        let event_loop = self.event_loop_handle.as_event_loop_ctx();
        #[cfg(windows)]
        {
            if self.force_sync.get() {
                self.writer.start_sync(self, event_loop, file.into())?;
                self.writer.update_ref(false);
                return sys::Result::Ok(());
            }
        }

        match self
            .writer
            .start(self, event_loop, file, self.pollable.get())
        {
            sys::Result::Err(err) => return sys::Result::Err(err),
            sys::Result::Ok(()) => {
                // Only keep the event loop ref'd while there's a pending write in progress.
                // If there's no pending write, no need to keep the event loop ref'd.
                self.writer.update_ref(false);
                #[cfg(unix)]
                {
                    // TTY writes are synchronous, as in Node.
                    let force_sync = self.force_sync.get() || is_tty_out;
                    self.writer.set_force_sync(force_sync);

                    if self.nonblocking.get() {
                        self.writer.set_poll_flag(bun_io::FilePollFlag::Nonblocking);
                    }

                    if self.is_socket.get() {
                        self.writer.set_poll_flag(bun_io::FilePollFlag::Socket);
                    } else if is_tty_out {
                        self.writer.set_poll_flag(bun_io::FilePollFlag::Tty);
                    } else if self.pollable.get() {
                        self.writer.set_poll_flag(bun_io::FilePollFlag::Fifo);
                    }
                }
            }
        }

        sys::Result::Ok(())
    }

    pub(crate) fn event_loop(&self) -> EventLoopHandle {
        self.event_loop_handle
    }

    /// `EventLoopHandle::global_object()` returns an erased `*mut ()`; recover
    /// the typed `&JSGlobalObject` (None for the mini loop or null).
    #[inline]
    fn js_global(&self) -> Option<&JSGlobalObject> {
        let p = self.event_loop_handle.global_object();
        if p.is_null() {
            return None;
        }
        // S008: `JSGlobalObject` is an `opaque_ffi!` ZST handle — safe
        // `*mut → &` via `opaque_deref` (non-null checked above; the global
        // is owned by the VM and outlives this sink).
        Some(bun_opaque::opaque_deref(p.cast::<JSGlobalObject>()))
    }

    /// `EventLoopHandle::bun_vm()` returns an erased `*mut ()`; recover the
    /// typed `&VirtualMachine` (None for the mini loop or null).
    #[inline]
    fn js_vm(&self) -> Option<&bun_jsc::VirtualMachineRef> {
        let p = self.event_loop_handle.bun_vm();
        if p.is_null() {
            return None;
        }
        // SAFETY: `bun_vm()` returns an erased `*mut VirtualMachine` for the
        // Js arm; non-null implies the per-thread VM.
        Some(unsafe { &*p.cast::<bun_jsc::VirtualMachineRef>() })
    }

    pub(crate) fn start(
        &self,
        stream_start: &streams::Start,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> sys::Result<()> {
        match stream_start {
            streams::Start::Err(err) => {
                return sys::Result::Err(err.clone());
            }
            streams::Start::FileSink(file)
                if !matches!(file.input_path, PathOrFileDescriptor::Fd(Fd::INVALID)) =>
            {
                match self.setup(file, context) {
                    sys::Result::Err(err) => {
                        return sys::Result::Err(err);
                    }
                    sys::Result::Ok(()) => {}
                }
            }
            _ => {}
        }

        self.done.set(false);
        self.started.set(true);
        self.source.get().start();
        sys::Result::Ok(())
    }

    pub(crate) fn run_pending_later(&self) {
        if self.run_pending_armed.replace(true) {
            return;
        }
        if let EventLoopHandle::Js { owner } = self.event_loop() {
            owner.enqueue_task(bun_event_loop::Task::from_ref::<Self>(self.ref_guard()));
        }
    }

    /// `true` if it did. Runs no JS.
    pub(crate) fn end_unneeded_auto_flush(&self) -> bool {
        if !self.writer.has_pending_data() {
            self.update_ref(false);
            self.auto_flusher.registered.set(false);
            return true;
        }
        // After `end()` the writable poll drains the tail and drops the ref.
        if self.done.get() {
            self.auto_flusher.registered.set(false);
            return true;
        }
        false
    }

    /// `AutoFlusher` deferred-microtask tick.
    pub(crate) fn on_auto_flush(&self) -> bool {
        let amount_buffered = self.writer.queued_len();

        match self.writer.flush(self) {
            WriteResult::Err(err) => {
                self.update_ref(false);
                // On POSIX `flush()` does not call `on_error`, and the pending slot still holds `Owned(consumed)`.
                self.record_stream_error(streams::StreamError::Error(err.clone()));
                self.done.set(true);
                if self.pending.get().state == streams::PendingState::Pending {
                    self.pending
                        .with_mut(|p| p.result = streams::Writable::Err(err));
                }
                self.writer.end(self);
                self.run_pending_later();
                self.auto_flusher.registered.set(false);
                return false;
            }
            WriteResult::Done(_) => {
                self.update_ref(false);
                self.run_pending_later();
            }
            WriteResult::Wrote(amount_drained) => {
                if amount_drained == amount_buffered {
                    self.update_ref(false);
                    self.run_pending_later();
                    // `flush()`'s drain bypasses `on_write(Drained)`; resume the parked ByteStream here.
                    self.resume_source();
                }
            }
            _ => {
                return true;
            }
        }

        let is_registered = !self.writer.has_pending_data();
        self.auto_flusher.registered.set(is_registered);
        is_registered
    }

    pub(crate) fn flush_from_js(
        &self,
        cx: &bun_jsc::JsThread<'_>,
        wait: bool,
    ) -> sys::Result<JSValue> {
        let _ = wait;

        if self.pending.get().state == streams::PendingState::Pending {
            if let streams::WritableFuture::Promise { strong, .. } = &self.pending.get().future {
                return sys::Result::Ok(strong.value());
            }
        }

        if self.done.get() {
            return sys::Result::Ok(JSValue::UNDEFINED);
        }

        let had_buffered_data = self.writer.has_pending_data();
        let rc = self.writer.flush(self);
        // `on_write` keeps the event loop alive while bytes sit in the buffer
        // and `on_auto_flush` releases that once it drains them. A flush from
        // JS that drained them has to release it too, or the loop still counts
        // as alive until the next deferred-task drain (a write()+flush() from a
        // 'beforeExit' listener then re-emits 'beforeExit').
        if had_buffered_data && !self.writer.has_pending_data() {
            self.update_ref(false);
        }
        let flushed = match rc {
            WriteResult::Done(written)
            | WriteResult::Pending(written)
            | WriteResult::Wrote(written) => {
                self.written.set(self.written.get() + written as usize); // @truncate
                written as u64 // @truncate
            }
            WriteResult::Err(err) => {
                return sys::Result::Err(err);
            }
        };
        // A flush takes no new chunk from the caller; a pending one reports the
        // bytes it pushed out. It only reaches here when no write is pending.
        match self.to_result(rc, flushed) {
            streams::Writable::Err(_) => unreachable!(),
            result => sys::Result::Ok(result.to_js(cx)),
        }
    }

    /// A `ReadableSinkController` was collected with this sink still attached. `pipe` roots that cell until
    /// `release_pipe` detaches it, so it only dies attached in the heap's last sweep. Unlike the
    /// wrapper with its [`WrapperRef`] it holds no ref: there is none to release for it.
    ///
    /// # Safety
    /// `this` is the cell's live sink; it must not be used after the call, which may free it.
    unsafe fn controller_finalize(this: *mut FileSink) {
        // SAFETY: caller contract.
        let this = unsafe { RefPtr::init_ref(this) };
        // The root is on the cell being destroyed: dropped here, `Drop` finds no cell to detach.
        drop(this.pipe.replace(streams::PipeCell::default()));
        this.release_ref_stranded_by_shutdown();
        if this.js_vm().is_some_and(|vm| vm.is_shutting_down()) {
            // The pump promise's reactions never run.
            this.pump_promise_ref.set(None);
        }
    }

    /// Shutdown never unwinds the writer: the loop stops ticking, so the
    /// `onWrite`/`onClose`/EOF callbacks that balance these refs can no
    /// longer arrive (a piped stdout whose write once returned
    /// `.pending` otherwise strands its keep-alive ref forever and the sink
    /// leaks). Only under `is_shutting_down`: on a live VM those events
    /// still arrive and must keep the sink alive past its JS cells.
    /// The caller holds a ref of its own.
    fn release_ref_stranded_by_shutdown(&self) {
        if self.js_vm().is_some_and(|vm| vm.is_shutting_down()) {
            self.keep_alive_ref.set(None);
        }
    }

    /// Protect the JS wrapper object from GC collection while an async operation is pending.
    /// This should be called when endFromJS returns a pending Promise.
    /// The reference is released when runPending() completes.
    pub(crate) fn protect_js_wrapper(&self, global_this: &JSGlobalObject, js_wrapper: JSValue) {
        // SAFETY(JsCell): `Strong::set` is a JSC root-slot write; does not
        // re-enter user JS.
        self.js_sink_ref
            .with_mut(|r| r.set(global_this, js_wrapper));
    }

    pub(crate) fn init(fd: Fd, event_loop_handle: impl Into<EventLoopHandle>) -> RefPtr<FileSink> {
        let this = RefPtr::new(FileSink::new(event_loop_handle.into(), fd));
        let owner = Owner::new(PollTag::FileSink, this.as_ptr().cast());
        // SAFETY: `owner` points to the heap allocation that holds this writer.
        unsafe { this.writer.set_owner(owner) };
        this
    }

    pub fn write(&self, data: &streams::Result<'_>) -> streams::Writable {
        if self.done.get() {
            return streams::Writable::Done;
        }
        let buffered_before = self.writer.buffered_len();
        let rc = self.writer.write(self, data.slice());
        if self.counting_stream_bytes() {
            self.count_stream_bytes(&rc, data.slice().len());
        }
        let accepted = self.bytes_accepted(buffered_before, &rc);
        self.to_result(rc, accepted)
    }

    fn count_stream_bytes(&self, rc: &WriteResult, encoded_len: usize) {
        let counted = self.stream_bytes.get().unwrap_or(0);
        match rc {
            WriteResult::Err(err) => {
                self.record_stream_error(streams::StreamError::Error(err.clone()))
            }
            WriteResult::Done(n) => self.stream_bytes.set(Some(counted + *n as u64)),
            _ => self.stream_bytes.set(Some(counted + encoded_len as u64)),
        }
    }

    /// Only `Bun.write(dest, stream)` reads the count; nothing else pays for the encoded length.
    fn counting_stream_bytes(&self) -> bool {
        self.stream_bytes.get().is_some()
    }

    fn record_stream_error(&self, err: streams::StreamError) {
        if self.has_stream_error() {
            return;
        }
        match err {
            streams::StreamError::JSValue(value) => {
                if let Some(value) = value.get() {
                    self.record_js_stream_error(value);
                }
            }
            err => self.stream_error.set(Some(err)),
        }
    }

    pub(crate) fn write_latin1(&self, data: &streams::Result<'_>) -> streams::Writable {
        if self.done.get() {
            return streams::Writable::Done;
        }
        let buffered_before = self.writer.buffered_len();
        let rc = self.writer.write_latin1(self, data.slice());
        if self.counting_stream_bytes() {
            self.count_stream_bytes(
                &rc,
                bun_core::strings::element_length_latin1_into_utf8(data.slice()),
            );
        }
        let accepted = self.bytes_accepted(buffered_before, &rc);
        self.to_result(rc, accepted)
    }

    pub(crate) fn write_utf16(&self, text: &[u16]) -> streams::Writable {
        if self.done.get() {
            return streams::Writable::Done;
        }
        let buffered_before = self.writer.buffered_len();
        let rc = self.writer.write_utf16(self, text);
        if self.counting_stream_bytes() {
            self.count_stream_bytes(&rc, bun_core::strings::element_length_utf16_into_utf8(text));
        }
        let accepted = self.bytes_accepted(buffered_before, &rc);
        self.to_result(rc, accepted)
    }

    /// The source is done; `err` settles a piped stream. A failed ByteStream closes without a flush.
    pub(crate) fn end_from_stream(&self, err: Option<streams::StreamError>) {
        let is_byte_stream = matches!(self.source.get(), streams::SourceHandle::ByteStream(_));
        if is_byte_stream {
            // Source drove this call and already cleared its own `sink` field;
            // detach so the writer's `on_close` → `source.close()` is a no-op.
            self.source.set(streams::SourceHandle::None);
        }
        let errored = err.is_some();
        // A failed `write()` recorded its error before the source called back here.
        let write_failed = self.has_stream_error();
        let sys_err = match &err {
            Some(streams::StreamError::Error(e)) => Some(e.clone()),
            _ => None,
        };
        if let Some(err) = err {
            self.record_stream_error(err);
        }
        if !errored || !is_byte_stream {
            let _ = self.end(sys_err);
            return;
        }
        if self.done.get() {
            return;
        }
        self.done.set(true);
        // The source stopped because a write failed (it cleared its sink first): nothing reads
        // the rest, so cancel it. A source that failed on its own is already done.
        let stream = self.pipe.get().take_stream();
        if write_failed {
            if let (Some(stream), Some(global)) = (stream, self.js_global()) {
                crate::dispatch::fold(stream.cancel(global));
            }
        }
        self.writer.close(self);
    }

    pub(crate) fn end(&self, _err: Option<sys::Error>) -> sys::Result<()> {
        if self.done.get() {
            return sys::Result::Ok(());
        }

        // A backpressured `write()` may have left its promise in `self.pending`;
        // `writer.end()` only re-enters `on_close`, which never touches it, so
        // every synchronous arm that tears the writer down here must settle it
        // (mirrors `on_auto_flush`). `close()` can't hand the promise back, so
        // the outcome is delivered via `run_pending` and the call returns `Ok`.
        let has_pending = self.pending.get().state == streams::PendingState::Pending;

        match self.writer.flush(self) {
            WriteResult::Done(written) | WriteResult::Wrote(written) => {
                self.written.set(self.written.get() + written as usize); // @truncate
                if has_pending {
                    // `to_result` already seeded `Owned(consumed)`; just deliver it.
                    self.run_pending_later();
                }
                self.end_writer();
                sys::Result::Ok(())
            }
            WriteResult::Err(e) => {
                self.record_stream_error(streams::StreamError::Error(e.clone()));
                self.done.set(true);
                if has_pending {
                    self.pending
                        .with_mut(|p| p.result = streams::Writable::Err(e));
                    self.run_pending_later();
                    self.end_writer();
                    return sys::Result::Ok(());
                }
                self.end_writer();
                sys::Result::Err(e)
            }
            WriteResult::Pending(written) => {
                self.written.set(self.written.get() + written as usize); // @truncate
                self.keep_alive_until_eof();
                self.done.set(true);
                sys::Result::Ok(())
            }
        }
    }

    pub fn to_js(this: RefPtr<FileSink>, global_this: &JSGlobalObject) -> JSValue {
        JSSink::create_object(global_this, WrapperRef(this), None)
    }

    /// As [`to_js`](Self::to_js), for the stdin of `subprocess`, which is notified when the object closes or is collected.
    pub(crate) fn to_js_for_subprocess(
        this: RefPtr<FileSink>,
        global_this: &JSGlobalObject,
        subprocess: NonNull<Subprocess<'static>>,
    ) -> JSValue {
        JSSink::create_object(global_this, WrapperRef(this), Some(subprocess))
    }

    pub(crate) fn end_from_js(&self, cx: &bun_jsc::JsThread<'_>) -> sys::Result<JSValue> {
        if self.done.get() {
            if self.pending.get().state == streams::PendingState::Pending {
                if let streams::WritableFuture::Promise { strong, .. } = &self.pending.get().future
                {
                    return sys::Result::Ok(strong.value());
                }
            }
            return sys::Result::Ok(JSValue::js_number(self.written.get() as f64));
        }

        let flush_result = self.writer.flush(self);

        // `writer.end()` only re-enters `on_close`, which never touches
        // `self.pending`; every arm that tears the writer down here with a
        // backpressured `write()` outstanding must hand that promise back and
        // schedule `run_pending` to settle it.
        let has_pending = self.pending.get().state == streams::PendingState::Pending;

        match flush_result {
            WriteResult::Done(written) => {
                self.update_ref(false);
                self.writer.end(self);
                if has_pending {
                    // `to_result` already seeded `Owned(consumed)`.
                    // SAFETY: JsCell — `WritablePending::promise` allocates a
                    // JSPromise (may GC) but invokes no FileSink host-fn.
                    let promise = unsafe { self.pending.get_mut() }.promise(cx);
                    self.run_pending_later();
                    return sys::Result::Ok(promise);
                }
                sys::Result::Ok(JSValue::js_number(written as f64))
            }
            WriteResult::Err(err) => {
                // `writer.end()` below runs `on_close`, which settles a piped stream with it.
                self.record_stream_error(streams::StreamError::Error(err.clone()));
                self.done.set(true);
                if has_pending {
                    // A backpressured write() left its promise outstanding.
                    // Throwing here would report the failure to the caller and
                    // then let the auto-flush/error path reject that promise a
                    // second time — with nobody holding it when the caller
                    // discarded write()'s return value, that second delivery
                    // surfaces as an unhandledRejection. Deliver the error to
                    // the pending promise instead and hand the caller the same
                    // promise (exactly like the Pending arm), so the failure is
                    // reported once, to whichever await is watching. The latch
                    // and promise grab happen before `writer.end()`: its
                    // teardown can re-enter `on_error`/`run_pending`
                    // synchronously, and the slot must already hold the error
                    // and this caller's promise when that runs.
                    self.pending
                        .with_mut(|p| p.result = streams::Writable::Err(err));
                    // SAFETY: JsCell — `WritablePending::promise` allocates a
                    // JSPromise (may GC) but does not invoke any FileSink
                    // host-fn synchronously.
                    let promise_result = unsafe { self.pending.get_mut() }.promise(cx);
                    self.writer.end(self);
                    self.run_pending_later();
                    return sys::Result::Ok(promise_result);
                }
                self.writer.end(self);
                sys::Result::Err(err)
            }
            WriteResult::Pending(pending_written) => {
                self.written
                    .set(self.written.get() + pending_written as usize); // @truncate
                self.keep_alive_until_eof();
                self.done.set(true);
                self.pending.with_mut(|p| {
                    // A write already pending on this slot owns `consumed`; seed it
                    // only when `end()` is the call that opens the slot.
                    if p.state != streams::PendingState::Pending {
                        p.consumed += pending_written as u64; // @truncate
                    }
                    p.result = streams::Writable::Owned(p.consumed);
                });

                // SAFETY: JsCell — `WritablePending::promise` allocates a JSPromise
                // (may GC) but does not invoke any FileSink host-fn synchronously.
                sys::Result::Ok(unsafe { self.pending.get_mut() }.promise(cx))
            }
            WriteResult::Wrote(written) => {
                self.writer.end(self);
                if has_pending {
                    // SAFETY: JsCell — see the `Done` arm above.
                    let promise = unsafe { self.pending.get_mut() }.promise(cx);
                    self.run_pending_later();
                    return sys::Result::Ok(promise);
                }
                sys::Result::Ok(JSValue::js_number(written as f64))
            }
        }
    }

    pub(crate) fn update_ref(&self, value: bool) {
        self.writer.update_ref(value);
    }
}

pub(crate) type JSSink = crate::webcore::sink::JSSink<FileSink>;

/// The JS wrapper's ref.
pub(crate) struct WrapperRef(RefPtr<FileSink>);

impl Drop for WrapperRef {
    /// Does not clear `pending` or `pipe`: I/O in flight may still need them.
    fn drop(&mut self) {
        self.0.release_ref_stranded_by_shutdown();
        self.0.js_sink_ref.set(Default::default());
    }
}

impl crate::webcore::sink::WrappedSink for FileSink {
    type Wrapped = WrapperRef;
    fn as_non_null(wrapped: &WrapperRef) -> NonNull<Self> {
        wrapped.0.as_non_null()
    }
}

impl crate::webcore::sink::JsSinkType for FileSink {
    const NAME: &'static str = "FileSink";

    crate::impl_js_sink_forwarders!(start_takes_context);

    type Entered<'a> = &'a Self;
    unsafe fn enter<'a>(this: NonNull<Self>) -> &'a Self {
        // SAFETY: trait contract.
        unsafe { this.as_ref() }
    }
    unsafe fn enter_with_ref<'a>(this: NonNull<Self>) -> (impl Sized, &'a Self) {
        // SAFETY: trait contract.
        unsafe { (RefPtr::init_ref(this.as_ptr()), this.as_ref()) }
    }

    fn end_from_js(
        this: &mut Self::Entered<'_>,
        cx: &bun_jsc::JsThread<'_>,
    ) -> sys::Result<JSValue> {
        Self::end_from_js(this, cx)
    }
    fn pending_state_is_pending(&self) -> bool {
        self.pending.get().state == streams::PendingState::Pending
    }
    fn protect_js_wrapper(&self, global: &JSGlobalObject, this_value: JSValue) {
        Self::protect_js_wrapper(self, global, this_value)
    }
    fn update_ref(&self, value: bool) {
        Self::update_ref(self, value)
    }
    fn get_fd(&self) -> Option<i32> {
        Some(Self::get_fd(self))
    }
}

impl crate::webcore::sink::ControlledSink for FileSink {
    fn to_any_sink(this: NonNull<Self>) -> AnyControlledSink {
        AnyControlledSink::FileSink(this)
    }
    unsafe fn controller_finalize(this: *mut Self) {
        // SAFETY: same contract, forwarded.
        unsafe { Self::controller_finalize(this) }
    }
    /// The JS pump's source failed, or `controller.close(error)`: a piped stream rejects with `reason`.
    unsafe fn close_with_error(
        this: *mut Self,
        _global: &JSGlobalObject,
        reason: JSValue,
    ) -> sys::Result<()> {
        // SAFETY: caller contract; `this` is live.
        let this = unsafe { RefPtr::init_ref(this) };
        this.record_js_stream_error(reason);
        // Not a ByteStream source: `end_from_stream` would flush and end the same way.
        let _ = this.end(None);
        sys::Result::Ok(())
    }
    fn source<'a>(this: &'a mut Self::Entered<'_>) -> &'a Cell<streams::SourceHandle> {
        &this.source
    }
}

impl FileSink {
    fn get_fd(&self) -> i32 {
        #[cfg(windows)]
        {
            match self.fd.get().decode_windows() {
                bun_sys::fd::DecodeWindows::Windows(_) => -1, // TODO:
                bun_sys::fd::DecodeWindows::Uv(num) => num,
            }
        }
        #[cfg(not(windows))]
        {
            self.fd.get().native()
        }
    }

    /// Bytes the writer took off our hands in the `write_*` call that produced
    /// `rc`: what reached the fd plus what it buffered for later. The writer
    /// never takes part of a chunk, so for a `Pending` result this is the
    /// chunk's own (encoded) byte count, not the partial `write(2)` return.
    fn bytes_accepted(&self, buffered_before: usize, rc: &WriteResult) -> u64 {
        let WriteResult::Pending(written) = rc else {
            return 0;
        };
        let buffered_after = self.writer.buffered_len();
        (buffered_after + written).saturating_sub(buffered_before) as u64 // @truncate
    }

    /// `accepted` is what the pending slot is credited with when `write_result`
    /// is `Pending`: a write's full chunk, or the bytes a flush pushed out. It
    /// is ignored for every other result.
    fn to_result(&self, write_result: WriteResult, accepted: u64) -> streams::Writable {
        match write_result {
            WriteResult::Done(amt) => {
                if amt > 0 {
                    return streams::Writable::OwnedAndDone(amt as u64);
                }
                streams::Writable::Done
            }
            WriteResult::Wrote(amt) => {
                if amt > 0 {
                    return streams::Writable::Owned(amt as u64);
                }
                streams::Writable::Temporary(amt as u64)
            }
            WriteResult::Err(err) => {
                // A backpressured `write()` left its promise outstanding. `Writable::Err` becomes a
                // second, already rejected promise, and the caller of `write()` is awaiting the first:
                // the failure would be reported twice, once as an unhandled rejection. As in `end()`,
                // the outstanding promise gets the error and the caller gets that promise.
                if self.pending.get().state == streams::PendingState::Pending {
                    self.pending
                        .with_mut(|p| p.result = streams::Writable::Err(err));
                    self.run_pending_later();
                    return streams::Writable::Pending(self.pending.as_ptr());
                }
                streams::Writable::Err(err)
            }
            WriteResult::Pending(_) => {
                self.keep_alive_until_eof();
                // A Windows uv_write is always async: Pending with an empty
                // outgoing buffer is not backpressure, so keep the source flowing.
                if !self.writer.is_backed_up() {
                    return streams::Writable::Owned(accepted);
                }
                self.source_pending_pull.set(true);
                if matches!(
                    self.source.get(),
                    streams::SourceHandle::ByteStream(_) | streams::SourceHandle::FileReader(_)
                ) {
                    return streams::Writable::Backpressure(accepted);
                }
                self.pending.with_mut(|p| {
                    p.consumed += accepted;
                    p.result = streams::Writable::Owned(p.consumed);
                });
                streams::Writable::Pending(self.pending.as_ptr())
            }
        }
    }

    // Helper for struct-init defaults. `EventLoopHandle` has
    // no `Default`, so `impl Default for FileSink` is not possible; kept private
    // to avoid exposing a half-initialized state.
    /// One ref, counted in `LIVE_COUNT`; the writer's owner/pipe are set by
    /// the caller once the sink has its final address.
    fn new(event_loop_handle: EventLoopHandle, fd: Fd) -> FileSink {
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        FileSink {
            ref_count: Cell::new(1),
            writer: StreamingWriter::default(),
            #[cfg(windows)]
            inflight_write_ref: Cell::new(None),
            event_loop_handle,
            written: Cell::new(0),
            pending: JsCell::new(streams::WritablePending {
                result: streams::Writable::Done,
                ..Default::default()
            }),
            source: Cell::default(),
            done: Cell::new(false),
            started: Cell::new(false),
            keep_alive_ref: JsCell::new(None),
            source_pending_pull: Cell::new(false),
            pollable: Cell::new(false),
            nonblocking: Cell::new(false),
            force_sync: Cell::new(false),
            is_socket: Cell::new(false),
            fd: Cell::new(fd),
            auto_flusher: AutoFlusher::default(),
            run_pending_armed: Cell::new(false),
            pipe: JsCell::new(streams::PipeCell::default()),
            stream_error: JsCell::new(None),
            stream_js_error: Cell::new(false),
            stream_bytes: Cell::new(None),
            pump_promise_ref: Cell::new(None),
            js_sink_ref: JsCell::new(bun_jsc::strong::Optional::empty()),
            abort_handle: bun_jsc::AbortHandle::for_owner::<FileSink>(),
            closes_with_test_file: Cell::new(false),
        }
    }
}

bun_jsc::impl_abort_handle_owner!(FileSink, abort_handle, |this, cause| {
    // What is buffered is dropped with the graph: the writer closes without draining (a reader
    // that never reads would keep it open for ever), and a parked write gives up its promise and
    // the wrapper it pins, as when an attached process exits.
    // SAFETY: trait contract — `this` is live (armed ⇒ `on_close` has not run).
    let this = unsafe { (*this).ref_guard() };
    if this.closes_with_test_file.get() {
        return this.close_at_retirement(cause);
    }
    this.done.set(true);
    #[cfg(windows)]
    if !this.writer.owns_fd() {
        // Never closed, so `on_close` does not follow: settle a piped stream here.
        this.settle_stream_done();
        this.release_pipe();
    }
    this.writer.close(&*this);
    this.run_pending();
    this.keep_alive_ref.set(None);
});

/// The task of [`FileSink::run_pending_later`].
impl bun_event_loop::RefTask for FileSink {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FlushPendingFileSinkTask;
    type Ref = RefPtr<Self>;
    fn release_unrun(_: Self::Ref) {}
    /// Flushes what the sink has buffered.
    fn context(_: &Self::Ref) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl FileSink {
    pub(crate) fn run_pending_if_armed(&self) {
        if self.run_pending_armed.get() {
            self.run_pending();
        }
    }
}

impl FileSink {
    /// The JS pump finished: flush what it wrote and end. Does not ref or unref.
    fn handle_resolve_stream(&self, global_this: &JSGlobalObject) {
        if let Some(stream) = self.pipe.get().stream() {
            stream.done();
        }

        if !self.done.get() {
            // A flush error is recorded in `stream_error` and reaches the done-promise.
            let _ = self.end(None);
        }
        self.detach_js_controller(global_this);
    }

    /// Does not ref or unref.
    fn handle_reject_stream(&self, global_this: &JSGlobalObject, err: JSValue) -> JsResult<()> {
        self.record_js_stream_error(err);
        let aborted = match self.pipe.get().take_stream() {
            Some(stream) => stream.abort(global_this),
            None => Ok(()),
        };

        if !self.done.get() {
            // The body is truncated: drop what the writer buffered instead of flushing it.
            self.done.set(true);
            self.writer.close(self);
        }
        self.detach_js_controller(global_this);
        aborted
    }

    /// The pump is over: a controller whose `onClose` could not run must not outlive this sink attached.
    fn detach_js_controller(&self, global_this: &JSGlobalObject) {
        if let streams::SourceHandle::JSController(cell) = self.source.get() {
            self.source.set(streams::SourceHandle::None);
            crate::dispatch::fold(ReadableSinkController::detach(cell, global_this));
        }
    }
}

pub(crate) fn on_resolve_stream(cx: &mut JsScope<'_>, _: JsLocal<'_>, context: *mut FileSink) {
    bun_core::scoped_log!(FileSink, "onResolveStream");
    // SAFETY: `pump_promise_ref` keeps `context` alive until a reaction takes it.
    let sink = unsafe { (*context).pump_promise_ref.take() }.expect("one reaction runs");
    sink.handle_resolve_stream(cx.global());
}

pub(crate) fn on_reject_stream(
    cx: &mut JsScope<'_>,
    err: JsLocal<'_>,
    context: *mut FileSink,
) -> JsResult<()> {
    bun_core::scoped_log!(FileSink, "onRejectStream");
    // SAFETY: `pump_promise_ref` keeps `context` alive until a reaction takes it.
    let sink = unsafe { (*context).pump_promise_ref.take() }.expect("one reaction runs");
    sink.handle_reject_stream(cx.global(), err.to_js())
}

impl FileSink {
    /// `Bun.write(file, stream)`: the byte-count promise `on_close` settles.
    pub fn pipe_stream(
        this: &RefPtr<FileSink>,
        stream: &mut ReadableStream,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        this.stream_bytes.set(Some(0));
        let done_promise = bun_jsc::JSPromise::create(global_this);
        let promise = done_promise.to_js();
        let controller = ReadableSinkController::create(global_this, this.as_non_null());
        this.pipe.set(streams::PipeCell::create(
            controller,
            stream.value,
            promise,
            global_this,
        ));

        match stream.wire_native_sink(
            global_this,
            webcore::SinkHandle::FileSink(bun_ptr::BackRef::new(&**this)),
            JSValue::UNDEFINED,
            |src| this.source.set(src),
        ) {
            readable_stream::NativeWireResult::Wired => {
                // A synchronous source (FileReader over a regular file) may have run to the
                // end inside `wire_native_sink`; the promise is settled then.
                if this.pipe.get().has_done() && !this.done.get() {
                    this.update_ref(true);
                    this.keep_alive_until_eof();
                }
                Ok(promise)
            }
            readable_stream::NativeWireResult::EndedInline(err) => {
                this.source.set(streams::SourceHandle::None);
                this.end_from_stream(err);
                Ok(promise)
            }
            readable_stream::NativeWireResult::NotNative => {
                let result = Self::assign_to_js_stream(this, stream, controller, global_this)
                    .inspect_err(|_| {
                        this.stream_bytes.set(None);
                        // The caller gets the throw, not the done-promise that a close(error) inside pull() rejected.
                        done_promise.set_handled();
                    })?;
                // A pump that already failed reports through the done-promise.
                if let Some(pump) = result.as_any_promise() {
                    if pump.status() == bun_jsc::js_promise::Status::Rejected {
                        pump.set_handled(global_this.vm());
                    }
                }
                Ok(promise)
            }
        }
    }

    pub fn assign_to_stream(
        this: &RefPtr<FileSink>,
        stream: &mut ReadableStream,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let controller = ReadableSinkController::create(global_this, this.as_non_null());
        this.pipe.set(streams::PipeCell::create(
            controller,
            stream.value,
            JSValue::UNDEFINED,
            global_this,
        ));

        // Native ByteStream/FileReader fast-path: wire the SinkHandle
        // directly, skipping the JS pump.
        match stream.wire_native_sink(
            global_this,
            webcore::SinkHandle::FileSink(bun_ptr::BackRef::new(&**this)),
            JSValue::UNDEFINED,
            |src| this.source.set(src),
        ) {
            readable_stream::NativeWireResult::Wired => {
                // A synchronous producer may have driven `end_from_stream`
                // (clears `source`) inline; no keepalive then.
                if !matches!(this.source.get(), streams::SourceHandle::None) {
                    this.update_ref(true);
                    this.keep_alive_until_eof();
                }
                return Ok(JSValue::UNDEFINED);
            }
            readable_stream::NativeWireResult::EndedInline(err) => {
                this.source.set(streams::SourceHandle::None);
                match err {
                    Some(err) => this.end_from_stream(Some(err)),
                    None => {
                        let _ = this.end(None);
                    }
                }
                return Ok(JSValue::UNDEFINED);
            }
            readable_stream::NativeWireResult::NotNative => {}
        }

        Self::assign_to_js_stream(this, stream, controller, global_this)
    }

    /// Pump a JS `stream` in through the pipe's `controller`; the writer is ended when the pump settles.
    fn assign_to_js_stream(
        this: &RefPtr<FileSink>,
        stream: &mut ReadableStream,
        controller: JSValue,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        // No +1 for the controller: `release_pipe` detaches it before this sink is freed.
        let promise_result = ReadableSinkController::assign_controller_to_stream(
            global_this,
            stream.value,
            controller,
            this.as_non_null(),
        );

        // What the stream's code threw, which need not be an Error.
        if let Some(err) = promise_result.to_error() {
            this.release_pipe();
            return Err(global_this.throw_value(err));
        }
        // It ended the thread, which beneath script is still pending.
        if promise_result.is_termination_exception() {
            this.release_pipe();
            return Err(if global_this.has_exception() {
                JsError::Thrown
            } else {
                JsError::Terminated
            });
        }

        let Some(promise) = promise_result.as_any_promise() else {
            // The pump ran to the end inside `assign_to_stream`.
            this.handle_resolve_stream(global_this);
            return Ok(promise_result);
        };
        match promise.status() {
            bun_jsc::js_promise::Status::Pending => {
                this.update_ref(true);
                this.pump_promise_ref.set(Some(this.clone()));
                promise_result.then(
                    global_this,
                    this.as_ptr(),
                    Bun__FileSink__onResolveStream,
                    Bun__FileSink__onRejectStream,
                );
            }
            bun_jsc::js_promise::Status::Fulfilled => {
                // These don't ref().
                this.handle_resolve_stream(global_this);
            }
            bun_jsc::js_promise::Status::Rejected => {
                // These don't ref().
                let result = promise.result(global_this.vm());
                crate::dispatch::fold(this.handle_reject_stream(global_this, result));
            }
        }

        Ok(promise_result)
    }
}
