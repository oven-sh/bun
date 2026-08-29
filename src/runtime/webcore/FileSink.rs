use core::cell::Cell;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicI32, Ordering};

#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{self, WriteResult, WriteStatus};
use bun_jsc::event_loop_handle::EventLoopHandleJs as _;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSPromise, JsCell};
use bun_ptr::{BackRef, RefPtr, ThisPtr};
use bun_sys::{self as sys, Fd, FdExt as _};

use crate::api::bun::process::Status as SpawnStatus;
use crate::webcore::jsc::{CallFrame, EventLoopHandle, JSGlobalObject, JSValue, JsResult};
use crate::webcore::readable_stream::{self, ReadableStream};
use crate::webcore::{self, AutoFlusher, PathOrFileDescriptor, streams};
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(windows)]
use bun_sys::windows::libuv::UvHandle as _;

bun_core::declare_scope!(FileSink, visible);

// ───────────────────────────────────────────────────────────────────────────
// FileSink
// ───────────────────────────────────────────────────────────────────────────

// R-2 (`&mut self` host-fn re-entrancy → noalias UB): JS-reachable host-fns
// take `&self` and mutate via `Cell`/`JsCell`. Paths that may drop the last
// ref (`finalize`, the PipeWriter IO callbacks, the promise reactions) take a
// `ThisPtr<FileSink>` instead of any receiver — see the `borrow = this` note
// on the `impl_streaming_writer_parent!` invocation below.
//
// Every ref some untyped holder keeps on the sink (the JS wrapper, the queued
// flush task, the writer's pending write, the stream pump's promise) is a
// `RefPtr<FileSink>` stored in a slot on the sink itself, set where that
// holder takes it and released where it gives it up.
#[derive(bun_ptr::CellRefCounted)]
pub struct FileSink {
    ref_count: Cell<u32>,
    /// Set at allocation so `&self` entry points can reach the
    /// `ThisPtr`-taking paths that take or release refs.
    self_ref: bun_ptr::SelfRoot<FileSink>,
    pub(crate) writer: JsCell<IOWriter>,
    pub(crate) event_loop_handle: EventLoopHandle,
    pub(crate) written: Cell<usize>,
    pub(crate) pending: JsCell<streams::WritablePending>,
    pub(crate) source: JsCell<streams::SourceHandle>,
    pub(crate) done: Cell<bool>,
    pub(crate) started: Cell<bool>,
    /// Taken in `to_result`/`end`/`end_from_js`/`assign_to_stream` when a
    /// write returned `.pending`: keeps the sink alive until the writer
    /// reports EOF/close (`clear_keep_alive_ref`).
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

    pub(crate) auto_flusher: JsCell<AutoFlusher>,
    /// `run_pending` should run from the queued `FlushPendingFileSinkTask`
    /// (cleared when an earlier `run_pending` gets there first).
    run_pending_later_wanted: Cell<bool>,
    /// The queued `FlushPendingFileSinkTask`'s ref (its pointer is this sink);
    /// at most one is queued, released when it runs or is released unrun.
    flush_task_ref: JsCell<Option<RefPtr<FileSink>>>,
    /// The JS wrapper's ref (`to_js`/`construct`), released by its `finalize`.
    wrapper_ref: JsCell<Option<RefPtr<FileSink>>>,
    /// Held across the `assign_to_stream` pump promise; released by whichever
    /// of its reactions runs.
    stream_promise_ref: JsCell<Option<RefPtr<FileSink>>>,

    /// Currently, only used when `stdin` in `Bun.spawn` is a ReadableStream.
    pub(crate) readable_stream: JsCell<readable_stream::Strong>,

    /// `pipe_stream`: settled from `on_close` with `stream_bytes`, or with the error that ended
    /// the stream or the write.
    stream_done: JsCell<bun_jsc::JSPromiseStrong>,
    stream_error: JsCell<Option<streams::StreamError>>,
    /// Bytes accepted since `pipe_stream` (`written` counts buffered bytes again when flushed).
    pub(crate) stream_bytes: Cell<Option<u64>>,

    /// Strong reference to the JS wrapper object to prevent GC from collecting it
    /// while an async operation is pending. This is set when endFromJS returns a
    /// pending Promise and cleared when the operation completes.
    pub(crate) js_sink_ref: JsCell<bun_jsc::strong::Optional>,
}

/// Count of live native FileSink instances. Incremented at allocation,
/// decremented on drop. Exposed to tests via `bun:internal-for-testing`
/// so leak tests can detect native FileSink leaks that are invisible to
/// `heapStats()` (which only counts JS wrapper objects).
pub(crate) static LIVE_COUNT: AtomicI32 = AtomicI32::new(0);

pub mod testing_apis {
    use super::*;

    pub(crate) fn file_sink_live_count(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::js_number(LIVE_COUNT.load(Ordering::Relaxed) as f64))
    }
}
// `generated_js2native.rs` snake-cases `TestingAPIs` as `testing_ap_is`
// (acronym splitter treats `AP|Is` as two words); alias so both resolve.
pub use testing_apis as testing_ap_is;

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

/// Streaming-writer vtable wiring: the
/// parent type implements the handler trait
/// (onClose / onWritable / onError / onWrite) directly.
pub type IOWriter = bun_io::StreamingWriter<FileSink>;
#[cfg(not(windows))]
pub(crate) type Poll = IOWriter;

// `StreamingWriter<P>` requires `P: PosixStreamingWriterParent` (POSIX) /
// `WindowsStreamingWriterParent` (Windows). The vtable methods forward to the
// FileSink state-machine handlers below.
//
// `borrow = this`: PipeWriter callbacks must NOT form a `&FileSink`/`&mut
// FileSink` argument from the parent backref to dispatch the handler. The
// handler may drop the last ref mid-call (via `run_pending()` draining a
// promise, `writer.with_mut(|w| w.end()/w.close())` re-entering `on_close`,
// or the terminal `clear_keep_alive_ref()`), and freeing the allocation under
// a live reference argument is UB. The handlers take the parent as a
// `ThisPtr<FileSink>` built from the canonical heap pointer `set_parent` was
// given, and only form short-lived `&FileSink` borrows per statement.
bun_io::impl_streaming_writer_parent! {
    FileSink;
    poll_tag   = bun_io::posix_event_loop::poll_tag::FILE_SINK,
    borrow     = this,
    on_write   = on_write,
    on_error   = on_error,
    on_ready   = on_ready,
    on_close   = on_close,
    event_loop = |this| this.io_evtloop(),
    uws_loop   = |this| this.event_loop_handle.r#loop(),
    uv_loop    = |this| this.event_loop_handle.uv_loop(),
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

impl FileSink {
    pub(crate) fn memory_cost(&self) -> usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(FileSink).
        self.writer.get().memory_cost()
    }

    /// Root-provenance handle to `self` for the `&self` entry points
    /// (`JsSinkType` host fns, `SinkHandle`, `AutoFlusher`) that reach the
    /// paths taking or releasing refs.
    #[inline]
    pub(crate) fn this_ptr(&self) -> ThisPtr<FileSink> {
        self.self_ref.this_ptr(self)
    }

    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    fn ref_guard(&self) -> RefPtr<FileSink> {
        RefPtr::from_this(self.this_ptr())
    }
}

/// `process.stdout`/`process.stderr` must write synchronously (see
/// `constructStdioWriteStream` in BunProcess.cpp).
// HOST_EXPORT(Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio, c)
pub fn force_file_sink_to_be_synchronous_for_process_object_stdio(
    this: &crate::webcore::file_sink::FileSink,
) {
    #[cfg(not(windows))]
    {
        this.force_sync.set(true);
        this.writer.with_mut(|w| w.force_sync = true);
        if this.fd.get() != Fd::INVALID {
            let _ = sys::update_nonblocking(this.fd.get(), false);
        }
    }
    #[cfg(windows)]
    {
        let did_set_blocking = this.writer.with_mut(|w| {
            w.source
                .as_mut()
                .and_then(|source| source.set_stream_blocking(true))
                .is_some_and(|rc| rc == uv::ReturnCode::ZERO)
        });
        if did_set_blocking {
            return;
        }

        // Fallback to WriteFile() if it fails.
        this.force_sync.set(true);
    }
}

impl FileSink {
    /// `bun.spawn`'s subprocess exited while this `FileSink` was its stdin.
    ///
    /// `writer.close()` re-enters `on_close` via the writer backref and
    /// `stream.cancel`/`run_pending` drain microtasks — any of which may drop
    /// a ref — so this takes the `ThisPtr` and holds its own ref for the call.
    pub(crate) fn on_attached_process_exit(this: ThisPtr<FileSink>, status: &SpawnStatus) {
        bun_core::scoped_log!(FileSink, "onAttachedProcessExit()");
        let _guard = this.ref_guard();

        this.done.set(true);
        let readable_stream = this
            .readable_stream
            .replace(readable_stream::Strong::default());
        if let Some(stream) = readable_stream.get() {
            if let Some(global) = this.js_global() {
                if !status.is_ok() {
                    let _entered = this.event_loop().entered();
                    crate::dispatch::fold(stream.cancel(global));
                } else {
                    stream.done();
                }
            }
        }
        drop(readable_stream);

        this.writer.with_mut(|w| w.close());

        this.pending.with_mut(|p| {
            p.result =
                streams::Writable::Err(sys::Error::from_code(sys::Errno::EPIPE, sys::Tag::write));
        });
        FileSink::run_pending(this);

        // `writer.close()` → `onClose` already released this above; kept for
        // paths where `onClose` isn't reached (e.g. writer already closed).
        FileSink::clear_keep_alive_ref(this);
    }

    /// `WritablePending::run` settles a JSPromise, which may re-enter JS and
    /// drop refs; holds its own ref for the call.
    fn run_pending(this: ThisPtr<FileSink>) {
        let _guard = this.ref_guard();

        this.run_pending_later_wanted.set(false);

        let _entered = this.event_loop().entered();
        if let Some(settlement) = this.pending.with_mut(|p| p.take_settlement()) {
            settlement.run();
        }

        // Release the JS wrapper reference now that the pending operation is complete.
        // This was held to prevent GC from collecting the wrapper while the async
        // operation was in progress.
        this.js_sink_ref.with_mut(|r| r.deinit());
    }

    pub(crate) fn on_write(this: ThisPtr<FileSink>, amount: usize, status: WriteStatus) {
        bun_core::scoped_log!(FileSink, "onWrite({}, {})", amount, status as u8);
        // `runPending()` below drains microtasks and may drop the JS wrapper's
        // ref, and `writer.end()`/`writer.close()` re-enter `onClose` which
        // releases the keep-alive ref. Hold a local ref so `this` stays valid
        // for the rest of this function (same pattern as `runPending`/`onAutoFlush`).
        let _guard = this.ref_guard();

        this.written.set(this.written.get() + amount);

        // TODO: on windows done means ended (no pending data on the buffer) on unix we can still have pending data on the buffer
        // we should unify the behaviors to simplify this
        let has_pending_data = this.writer.get().has_pending_data();
        // Only keep the event loop ref'd while there's a pending write in progress.
        // If there's no pending write, no need to keep the event loop ref'd.
        // `with_mut`: Windows `update_ref` is `&mut self` (posix is `&self`).
        let evtloop = this.io_evtloop();
        this.writer
            .with_mut(|w| w.update_ref(evtloop, has_pending_data));

        if has_pending_data {
            if let Some(vm) = this.js_vm() {
                if !vm.is_inside_deferred_task_queue.get() {
                    AutoFlusher::register_deferred_microtask_with_type::<Self>(this.get(), vm);
                }
            }
        }

        // if we are not done yet and has pending data we just wait so we do not runPending twice
        if status == WriteStatus::Pending && has_pending_data {
            return;
        }

        let was_pending = this.pending.get().state == streams::PendingState::Pending;
        if was_pending {
            // `consumed` was credited when the pending operation accepted its
            // bytes; `amount` is only what this drain pushed to the fd.
            let consumed = this.pending.get().consumed;
            // when "done" is true, we will never receive more data.
            if this.done.get() || status == WriteStatus::EndOfFile {
                this.pending
                    .with_mut(|p| p.result = streams::Writable::OwnedAndDone(consumed));
            } else {
                this.pending
                    .with_mut(|p| p.result = streams::Writable::Owned(consumed));
            }

            FileSink::run_pending(this);
        }

        if (was_pending || (status == WriteStatus::Drained && !has_pending_data))
            && this.source_pending_pull.replace(false)
        {
            let mut src = *this.source.get();
            src.ready(None, None);
        }

        // `end()`'s Pending flush branch leaves the writer running; finish the
        // teardown here regardless of `pending.state` (native path has no promise).
        //
        // Not on `status`: `run_pending`/`src.ready()` above can re-enter
        // `write()` (a short write buffers the tail) and then `end()` (flush
        // Pending, sets `done`). `status` predates that, so a close on a stale
        // `Drained` drops the tail. Re-read the buffer instead; draining the
        // tail calls back here and finishes the teardown.
        if this.done.get() && !this.writer.get().has_pending_data() {
            if status == WriteStatus::EndOfFile {
                this.writer.with_mut(|w| w.close());
            } else {
                this.end_writer();
            }
        }

        if status == WriteStatus::EndOfFile {
            let mut src = *this.source.get();
            src.close(None);
            FileSink::clear_keep_alive_ref(this);
        }
    }

    pub(crate) fn on_error(this: ThisPtr<FileSink>, err: sys::Error) {
        bun_core::scoped_log!(FileSink, "onError({:?})", err);
        // The streaming writer follows every `onError` with `close()` →
        // `onClose` (on both platforms), which fires `source.close()` and
        // releases the keep-alive ref. Releasing the ref here instead could
        // drop the last reference and free `this` before that `close()` runs.
        this.record_stream_error(streams::StreamError::Error(err.clone()));
        if this.pending.get().state == streams::PendingState::Pending {
            this.pending
                .with_mut(|p| p.result = streams::Writable::Err(err));
            if let Some(vm) = this.js_vm() {
                if vm.is_inside_deferred_task_queue.get() {
                    this.run_pending_later();
                    return;
                }
            }

            FileSink::run_pending(this);
        }
    }

    /// Serves both POSIX `on_ready` and the Windows `on_writable` slot.
    pub fn on_ready(this: ThisPtr<FileSink>) {
        bun_core::scoped_log!(FileSink, "onReady()");
        if this.source_pending_pull.replace(false) {
            let mut src = *this.source.get();
            src.ready(None, None);
        }
    }

    /// `source.close()` (→ `Writable::on_close`) and `clear_keep_alive_ref`
    /// may each drop a ref; holds its own for the call.
    pub fn on_close(this: ThisPtr<FileSink>) {
        bun_core::scoped_log!(FileSink, "onClose()");
        let _guard = this.ref_guard();
        if let Some(stream) = this.readable_stream.get().get() {
            if this.js_global().is_some() {
                stream.done();
            }
        }

        let mut src = *this.source.get();
        src.close(None);

        this.settle_stream_done();

        // The writer is fully closed; no further callbacks will arrive. Release
        // the ref taken when a write returned `.pending`. This must be the last
        // thing we do as it may free `this`.
        FileSink::clear_keep_alive_ref(this);
    }

    /// Take the ref that keeps the sink alive while a write is `.pending`
    /// (idempotent; released by [`clear_keep_alive_ref`](Self::clear_keep_alive_ref)).
    fn keep_alive_until_eof(&self) {
        if self.keep_alive_ref.get().is_none() {
            self.keep_alive_ref
                .set(Some(RefPtr::from_this(self.this_ptr())));
        }
    }

    /// `writer.end()`; `on_close` follows and may free `self`, except (Windows) for an fd the writer
    /// does not own, which is never closed: settle a piped stream here then.
    fn end_writer(&self) {
        #[cfg(windows)]
        if !self.writer.get().owns_fd {
            self.settle_stream_done();
        }
        self.writer.with_mut(|w| w.end());
    }

    fn settle_stream_done(&self) {
        let mut promise = self.stream_done.replace(bun_jsc::JSPromiseStrong::empty());
        if !promise.has_value() {
            return;
        }
        let Some(global) = self.js_global() else {
            return;
        };
        let result = match self.stream_error.replace(None) {
            Some(err) => promise.reject(global, Ok(err.to_js(global))),
            None => promise.resolve(
                global,
                JSValue::js_number(self.stream_bytes.get().unwrap_or(0) as f64),
            ),
        };
        crate::dispatch::fold(result);
    }

    /// Release the ref taken in `toResult`/`end`/`endFromJS` when a write
    /// returned `.pending` and we needed to stay alive until it completed.
    /// Idempotent. May free `this`.
    fn clear_keep_alive_ref(this: ThisPtr<FileSink>) {
        drop(this.keep_alive_ref.replace(None));
    }

    fn new(event_loop_handle: EventLoopHandle, fd: Fd) -> RefPtr<FileSink> {
        let sink = RefPtr::new_cyclic(|self_ref| FileSink::fields(self_ref, event_loop_handle, fd));
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        let this = sink.this_ptr();
        this.writer.with_mut(|w| w.set_parent(this.as_ptr()));
        sink
    }

    #[cfg(windows)]
    pub(crate) fn create_with_pipe(
        event_loop_: impl Into<EventLoopHandle>,
        pipe: Box<uv::Pipe>,
    ) -> RefPtr<FileSink> {
        // `UvHandle::fd()` returns the raw `uv_os_fd_t` (HANDLE on Windows);
        // INVALID_HANDLE_VALUE maps to `Fd::INVALID`, anything else is
        // tagged as a system handle.
        let fd = match pipe.fd() {
            h if h == uv::INVALID_HANDLE_VALUE => Fd::INVALID,
            h => Fd::from_system(h),
        };
        let sink = Self::new(event_loop_.into(), fd);
        sink.writer.with_mut(|w| w.set_pipe(pipe));
        sink
    }

    pub(crate) fn setup(&self, options: &Options) -> sys::Result<()> {
        if self.readable_stream.with_mut(|rs| rs.has()) {
            // Already started.
            return sys::Result::Ok(());
        }

        // reshaped for borrowck — split into a local capture and apply after.
        // R-2: out-params for `bun_io::open_for_writing` are local then `Cell::set`.
        let mut force_sync_out = self.force_sync.get();
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
                    force_sync_out: &mut bool| {
            bun_io::open_for_writing(
                Fd::cwd(),
                &io_path,
                options.flags(),
                options.mode,
                pollable_out,
                is_socket_out,
                self.force_sync.get(),
                nonblocking_out,
                force_sync_out,
                |_fs: &mut bool| {
                    #[cfg(unix)]
                    {
                        *_fs = true;
                    }
                },
                is_pollable,
            )
        };
        let mut result = open(
            &mut pollable_out,
            &mut is_socket_out,
            &mut nonblocking_out,
            &mut force_sync_out,
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
                            &mut force_sync_out,
                        ),
                        Err(err) => Err(err),
                    };
                }
            }
        }
        self.pollable.set(pollable_out);
        self.is_socket.set(is_socket_out);
        self.nonblocking.set(nonblocking_out);
        #[cfg(unix)]
        if force_sync_out {
            self.force_sync.set(true);
            self.writer.with_mut(|w| w.force_sync = true);
        }

        let fd = match result {
            sys::Result::Err(err) => {
                return sys::Result::Err(err);
            }
            sys::Result::Ok(fd) => fd,
        };

        #[cfg(windows)]
        {
            if self.force_sync.get() {
                match self
                    .writer
                    .with_mut(|w| w.start_sync(fd, self.pollable.get()))
                {
                    sys::Result::Err(err) => {
                        fd.close();
                        return sys::Result::Err(err);
                    }
                    sys::Result::Ok(()) => {
                        self.writer
                            .with_mut(|w| w.update_ref(self.io_evtloop(), false));
                    }
                }
                return sys::Result::Ok(());
            }
        }

        match self.writer.with_mut(|w| w.start(fd, self.pollable.get())) {
            sys::Result::Err(err) => {
                fd.close();
                return sys::Result::Err(err);
            }
            sys::Result::Ok(()) => {
                // Only keep the event loop ref'd while there's a pending write in progress.
                // If there's no pending write, no need to keep the event loop ref'd.
                self.writer
                    .with_mut(|w| w.update_ref(self.io_evtloop(), false));
                #[cfg(unix)]
                {
                    if self.nonblocking.get() {
                        self.writer
                            .get()
                            .get_poll()
                            .unwrap()
                            .set_flag(bun_io::FilePollFlag::Nonblocking);
                    }

                    if self.is_socket.get() {
                        self.writer
                            .get()
                            .get_poll()
                            .unwrap()
                            .set_flag(bun_io::FilePollFlag::Socket);
                    } else if self.pollable.get() {
                        self.writer
                            .get()
                            .get_poll()
                            .unwrap()
                            .set_flag(bun_io::FilePollFlag::Fifo);
                    }
                }
            }
        }

        sys::Result::Ok(())
    }

    pub(crate) fn event_loop(&self) -> EventLoopHandle {
        self.event_loop_handle
    }

    /// `bun_io::EventLoopHandle` is an opaque `*mut c_void` that the io-layer
    /// `FilePollVTable` round-trips back to the runtime. We pass the address of
    /// the stored `bun_jsc::EventLoopHandle` so the (runtime-registered) vtable
    /// can recover it.
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        self.event_loop_handle.as_event_loop_ctx()
    }

    /// None for the mini loop.
    #[inline]
    fn js_global(&self) -> Option<&'static JSGlobalObject> {
        self.event_loop_handle.js_global()
    }

    /// None for the mini loop.
    #[inline]
    fn js_vm(&self) -> Option<&'static VirtualMachine> {
        self.event_loop_handle.js_vm()
    }

    pub(crate) fn start(&self, stream_start: &streams::Start) -> sys::Result<()> {
        match stream_start {
            streams::Start::Err(err) => {
                return sys::Result::Err(err.clone());
            }
            streams::Start::FileSink(file)
                if !matches!(file.input_path, PathOrFileDescriptor::Fd(Fd::INVALID)) =>
            {
                match self.setup(file) {
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
        self.source.with_mut(|s| s.start());
        sys::Result::Ok(())
    }

    pub(crate) fn run_pending_later(&self) {
        if self.run_pending_later_wanted.get() {
            return;
        }
        self.run_pending_later_wanted.set(true);
        if let EventLoopHandle::Js { owner } = self.event_loop() {
            if self.flush_task_ref.get().is_some() {
                // Already queued; it will see `run_pending_later_wanted`.
                return;
            }
            let this = self.this_ptr();
            this.flush_task_ref.set(Some(RefPtr::from_this(this)));
            // Dispatched to `run_flush_task` / `release_flush_task`.
            owner.enqueue_task(bun_event_loop::Task::new(
                bun_event_loop::task_tag::FlushPendingFileSinkTask,
                this.as_ptr().cast(),
            ));
        }
    }

    /// The queued `FlushPendingFileSinkTask` left the queue without running
    /// (VM teardown). May free `this`.
    pub(crate) fn release_flush_task(this: ThisPtr<FileSink>) {
        this.run_pending_later_wanted.set(false);
        drop(this.flush_task_ref.replace(None));
    }

    /// `task_tag::FlushPendingFileSinkTask` dispatch. May free `this`.
    pub(crate) fn run_flush_task(this: ThisPtr<FileSink>) {
        // Taken first, so a `run_pending_later()` re-entered from `run_pending`
        // queues a fresh task; the task's ref keeps `this` alive until the end.
        let task_ref = this.flush_task_ref.replace(None);
        if this.run_pending_later_wanted.replace(false) {
            FileSink::run_pending(this);
        }
        drop(task_ref);
    }

    /// `AutoFlusher` deferred-microtask tick. `writer.flush()` re-enters
    /// `on_write` via the writer backref, and `run_pending_later()` enqueues a
    /// task that drains a promise — either may drop a ref, so this takes the
    /// `ThisPtr` (see the PipeWriter callbacks) and holds its own for the call.
    pub(crate) fn on_auto_flush(this: ThisPtr<FileSink>) -> bool {
        if this.done.get() || !this.writer.get().has_pending_data() {
            this.update_ref(false);
            this.auto_flusher.with_mut(|a| a.registered.set(false));
            return false;
        }

        let _guard = this.ref_guard();

        let amount_buffered = this.writer.get().outgoing.size();

        match this.writer.with_mut(|w| w.flush()) {
            WriteResult::Err(err) => {
                this.update_ref(false);
                // `flush()` returns a write error without routing through the
                // writer's `_on_error`, so the pending slot still holds the
                // `Owned(consumed)` result `to_result` seeded and
                // `run_pending_later()` alone would resolve it as if every
                // buffered byte had reached the reader. Latch the error and
                // move the sink to its terminal state (mirrors `end_from_js`).
                this.record_stream_error(streams::StreamError::Error(err.clone()));
                this.done.set(true);
                if this.pending.get().state == streams::PendingState::Pending {
                    this.pending
                        .with_mut(|p| p.result = streams::Writable::Err(err));
                }
                this.writer.with_mut(|w| w.end());
                this.run_pending_later();
                this.auto_flusher.with_mut(|a| a.registered.set(false));
                return false;
            }
            WriteResult::Done(_) => {
                this.update_ref(false);
                this.run_pending_later();
            }
            WriteResult::Wrote(amount_drained) => {
                if amount_drained == amount_buffered {
                    this.update_ref(false);
                    this.run_pending_later();
                    // `flush()`'s drain bypasses `on_write(Drained)`; resume the parked ByteStream here.
                    if this.source_pending_pull.replace(false) {
                        let mut src = *this.source.get();
                        src.ready(None, None);
                    }
                }
            }
            _ => {
                return true;
            }
        }

        let is_registered = !this.writer.get().has_pending_data();
        this.auto_flusher
            .with_mut(|a| a.registered.set(is_registered));
        is_registered
    }

    pub fn flush(&self) -> sys::Result<()> {
        sys::Result::Ok(())
    }

    pub(crate) fn flush_from_js(
        &self,
        global_this: &JSGlobalObject,
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

        let had_buffered_data = self.writer.get().has_pending_data();
        let rc = self.writer.with_mut(|w| w.flush());
        // `on_write` keeps the event loop alive while bytes sit in the buffer
        // and `on_auto_flush` releases that once it drains them. A flush from
        // JS that drained them has to release it too, or the loop still counts
        // as alive until the next deferred-task drain (a write()+flush() from a
        // 'beforeExit' listener then re-emits 'beforeExit').
        if had_buffered_data && !self.writer.get().has_pending_data() {
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
            result => sys::Result::Ok(result.to_js(global_this)),
        }
    }

    /// The JS wrapper (or its controller) gives up its claim on the sink and
    /// never uses it again; releasing its ref may free `this`.
    pub(crate) fn finalize(this: ThisPtr<FileSink>) {
        // Called from (a) `~JSFileSink` during lazy sweep, and (b) synchronously
        // from `${name}__doClose` (prototype `.close()`). Must satisfy both
        // contexts: no touching live JS cells (sweep), and no tearing down
        // state that in-flight IO still needs (close).
        let _guard = this.ref_guard();
        FileSink::release_keep_alive_if_shutting_down(this);

        // `pending`/`readable_stream` are left for `Drop` since in-flight IO
        // may still need them.
        this.js_sink_ref.with_mut(|r| r.deinit());
        // Callers that allocate via `init` and then `to_js()` release their
        // own ref separately (see `Blob::get_writer`).
        drop(this.wrapper_ref.replace(None));
    }

    /// `~JSReadableFileSinkController` with the sink still attached — only at
    /// heap teardown (a live controller detaches first), where neither the
    /// pump's promise reactions nor the writer's callbacks can run any more:
    /// release the pump's ref, and the keep-alive as [`finalize`](Self::finalize)
    /// does (a sink pumped from a stream may never have had a wrapper).
    pub(crate) fn controller_finalize(this: ThisPtr<FileSink>) {
        let _guard = this.ref_guard();
        FileSink::release_keep_alive_if_shutting_down(this);
        FileSink::release_stream_promise_ref(this);
    }

    /// Shutdown never unwinds the writer: the loop stops ticking, so the
    /// `onWrite`/`onClose`/EOF callbacks that balance the keep-alive ref can
    /// no longer arrive. Release it (a piped stdout whose write once returned
    /// `.pending` otherwise strands it forever and the sink leaks). Only under
    /// `is_shutting_down`: on a live VM those events still arrive and must keep
    /// the sink alive past its JS cells. Idempotent, so a (theoretical) late
    /// `onClose` is a no-op. (A queued `FlushPendingFileSinkTask` keeps its
    /// ref until the queue runs or releases it; at a process exit that never
    /// drains the queue that ref simply dies with the process.)
    fn release_keep_alive_if_shutting_down(this: ThisPtr<FileSink>) {
        if this.js_vm().is_some_and(|vm| vm.is_shutting_down()) {
            FileSink::clear_keep_alive_ref(this);
        }
    }

    /// Protect the JS wrapper object from GC collection while an async operation is pending.
    /// This should be called when endFromJS returns a pending Promise.
    /// The reference is released when runPending() completes.
    pub(crate) fn protect_js_wrapper(&self, global_this: &JSGlobalObject, js_wrapper: JSValue) {
        self.js_sink_ref
            .with_mut(|r| r.set(global_this, js_wrapper));
    }

    pub(crate) fn init(fd: Fd, event_loop_handle: impl Into<EventLoopHandle>) -> RefPtr<FileSink> {
        Self::new(event_loop_handle.into(), fd)
    }

    /// The sink a new `JSFileSink` wrapper owns (`new FileSink()` from JS).
    pub(crate) fn construct() -> NonNull<FileSink> {
        let sink = Self::new(
            EventLoopHandle::init(VirtualMachine::get().event_loop().cast::<()>()),
            Fd::INVALID,
        );
        sink.install_wrapper_ref()
    }

    pub fn write(&self, data: &streams::Result) -> streams::Writable {
        if self.done.get() {
            return streams::Writable::Done;
        }
        let buffered_before = self.writer.get().buffered_len();
        let rc = self.writer.with_mut(|w| w.write(data.slice()));
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
        if self.stream_error.get().is_none() {
            self.stream_error.set(Some(err));
        }
    }

    pub(crate) fn write_latin1(&self, data: &streams::Result) -> streams::Writable {
        if self.done.get() {
            return streams::Writable::Done;
        }
        let buffered_before = self.writer.get().buffered_len();
        let rc = self.writer.with_mut(|w| w.write_latin1(data.slice()));
        if self.counting_stream_bytes() {
            self.count_stream_bytes(
                &rc,
                bun_core::strings::element_length_latin1_into_utf8(data.slice()),
            );
        }
        let accepted = self.bytes_accepted(buffered_before, &rc);
        self.to_result(rc, accepted)
    }

    pub(crate) fn write_utf16(&self, data: &streams::Result) -> streams::Writable {
        if self.done.get() {
            return streams::Writable::Done;
        }
        let buffered_before = self.writer.get().buffered_len();
        let rc = self.writer.with_mut(|w| w.write_utf16(data.slice16()));
        if self.counting_stream_bytes() {
            self.count_stream_bytes(
                &rc,
                bun_core::strings::element_length_utf16_into_utf8(data.slice16()),
            );
        }
        let accepted = self.bytes_accepted(buffered_before, &rc);
        self.to_result(rc, accepted)
    }

    /// Native-path terminator called from `SinkHandle::end`. On upstream error
    /// (ByteStream source), close the writer without flushing — mirrors
    /// `handle_reject_stream` — so a truncated write is not committed as EOF.
    pub(crate) fn end_from_stream(&self, err: Option<streams::StreamError>) {
        let is_byte_stream = matches!(self.source.get(), streams::SourceHandle::ByteStream(_));
        if is_byte_stream {
            // Source drove this call and already cleared its own `sink` field;
            // detach so the writer's `on_close` → `source.close()` is a no-op.
            self.source.with_mut(|s| s.clear());
        }
        let errored = err.is_some();
        // A failed `write()` recorded its error before the source called back here.
        let write_failed = self.stream_error.get().is_some();
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
        let readable_stream = self
            .readable_stream
            .replace(readable_stream::Strong::default());
        if write_failed {
            if let (Some(stream), Some(global)) = (readable_stream.get(), self.js_global()) {
                crate::dispatch::fold(stream.cancel(global));
            }
        }
        self.writer.with_mut(|w| w.close());
    }

    pub(crate) fn end(&self, _err: Option<sys::Error>) -> sys::Result<()> {
        if self.done.get() {
            return sys::Result::Ok(());
        }

        // A backpressured `write()` may have left its promise in `self.pending`;
        // `writer.end()` only re-enters `on_close`, which never touches it, so
        // every synchronous arm that tears the writer down here must settle it
        // (mirrors `on_auto_flush`). `js_close` can't hand the promise back, so
        // the outcome is delivered via `run_pending` and the call returns `Ok`.
        let has_pending = self.pending.get().state == streams::PendingState::Pending;

        match self.writer.with_mut(|w| w.flush()) {
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

    /// Take the ref a new JS wrapper holds on the sink and hand back the
    /// pointer its `finalize` returns.
    fn install_wrapper_ref(&self) -> NonNull<FileSink> {
        let this = self.this_ptr();
        debug_assert!(
            this.wrapper_ref.get().is_none(),
            "FileSink already has a JS wrapper"
        );
        this.wrapper_ref.set(Some(RefPtr::from_this(this)));
        NonNull::from(this)
    }

    pub fn to_js(&self, global_this: &JSGlobalObject) -> JSValue {
        JSSink::create_object(global_this, self.install_wrapper_ref(), 0)
    }

    pub(crate) fn to_js_with_destructor(
        &self,
        global_this: &JSGlobalObject,
        // `sink::DestructorPtr` is `TaggedPtrUnion<(Detached, Detached)>`
        // which does not satisfy `bun_ptr::TypeList` yet (sibling Sink.rs); accept
        // the encoded usize directly until that lands.
        destructor: Option<usize>,
    ) -> JSValue {
        JSSink::create_object(
            global_this,
            self.install_wrapper_ref(),
            destructor.unwrap_or(0),
        )
    }

    /// The pending slot's promise (created on first use).
    fn pending_promise(&self, global_this: &JSGlobalObject) -> JSValue {
        JSPromise::opaque_ref(self.pending.with_mut(|p| p.promise(global_this))).to_js()
    }

    pub(crate) fn end_from_js(&self, global_this: &JSGlobalObject) -> sys::Result<JSValue> {
        if self.done.get() {
            if self.pending.get().state == streams::PendingState::Pending {
                if let streams::WritableFuture::Promise { strong, .. } = &self.pending.get().future
                {
                    return sys::Result::Ok(strong.value());
                }
            }
            return sys::Result::Ok(JSValue::js_number(self.written.get() as f64));
        }

        let flush_result = self.writer.with_mut(|w| w.flush());

        // `writer.end()` only re-enters `on_close`, which never touches
        // `self.pending`; every arm that tears the writer down here with a
        // backpressured `write()` outstanding must hand that promise back and
        // schedule `run_pending` to settle it.
        let has_pending = self.pending.get().state == streams::PendingState::Pending;

        match flush_result {
            WriteResult::Done(written) => {
                self.update_ref(false);
                self.writer.with_mut(|w| w.end());
                if has_pending {
                    // `to_result` already seeded `Owned(consumed)`.
                    let promise = self.pending_promise(global_this);
                    self.run_pending_later();
                    return sys::Result::Ok(promise);
                }
                sys::Result::Ok(JSValue::js_number(written as f64))
            }
            WriteResult::Err(err) => {
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
                    let promise = self.pending_promise(global_this);
                    self.writer.with_mut(|w| w.end());
                    self.run_pending_later();
                    return sys::Result::Ok(promise);
                }
                self.writer.with_mut(|w| w.end());
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

                sys::Result::Ok(self.pending_promise(global_this))
            }
            WriteResult::Wrote(written) => {
                self.writer.with_mut(|w| w.end());
                if has_pending {
                    let promise = self.pending_promise(global_this);
                    self.run_pending_later();
                    return sys::Result::Ok(promise);
                }
                sys::Result::Ok(JSValue::js_number(written as f64))
            }
        }
    }

    pub(crate) fn update_ref(&self, value: bool) {
        // `with_mut`: the Windows `BaseWindowsPipeWriter` impls take `&mut self`
        // (the posix `PosixStreamingWriter` impls are `&self`); `with_mut`
        // covers both. No JS re-entry — pure libuv ref/unref.
        self.writer.with_mut(|w| {
            if value {
                w.enable_keeping_process_alive(self.io_evtloop());
            } else {
                w.disable_keeping_process_alive(self.io_evtloop());
            }
        });
    }
}

impl Drop for FileSink {
    fn drop(&mut self) {
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        if let Some(vm) = self.js_vm() {
            AutoFlusher::unregister_deferred_microtask_with_type::<Self>(self, vm);
        }
    }
}

// `Sink.JSSink(@This(), "FileSink")` — generic-fn-returning-type → monomorphized type alias.
pub(crate) type JSSink = crate::webcore::sink::JSSink<FileSink>;

crate::impl_js_sink_abi!(FileSink, "FileSink");

// `JsSinkType` impl: routes the codegen `FileSink__*` thunks (via
// `JSSink::<Self>::js_*`) into the inherent streaming methods. Mirrors
// `Sink.JSSink(@This(), "FileSink")`.
impl crate::webcore::sink::JsSinkType for FileSink {
    const NAME: &'static str = "FileSink";
    const HAS_CONSTRUCT: bool = true;
    const HAS_FLUSH_FROM_JS: bool = true;
    const HAS_PROTECT_JS_WRAPPER: bool = true;
    const HAS_UPDATE_REF: bool = true;
    const HAS_GET_FD: bool = true;
    const START_TAG: Option<streams::StartTag> = Some(streams::StartTag::FileSink);

    crate::impl_js_sink_forwarders!();

    fn finalize(this: ThisPtr<Self>) {
        Self::finalize(this)
    }
    fn controller_finalize(this: ThisPtr<Self>) {
        Self::controller_finalize(this)
    }
    fn construct() -> NonNull<Self> {
        Self::construct()
    }
    fn end_from_js(&mut self, global: &JSGlobalObject) -> sys::Result<JSValue> {
        Self::end_from_js(self, global)
    }
    fn source(&mut self) -> Option<&mut streams::SourceHandle> {
        Some(self.source.get_mut_unique())
    }
    fn pending_state_is_pending(&self) -> bool {
        self.pending.get().state == streams::PendingState::Pending
    }
    fn protect_js_wrapper(&mut self, global: &JSGlobalObject, this_value: JSValue) {
        Self::protect_js_wrapper(self, global, this_value)
    }
    fn update_ref(&mut self, value: bool) {
        Self::update_ref(self, value)
    }
    fn get_fd(&self) -> i32 {
        Self::get_fd(self)
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
        let buffered_after = self.writer.get().buffered_len();
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
            WriteResult::Err(err) => streams::Writable::Err(err),
            WriteResult::Pending(_) => {
                self.keep_alive_until_eof();
                // A Windows uv_write is always async: Pending with an empty
                // outgoing buffer is not backpressure, so keep the source flowing.
                if !self.writer.get().is_backed_up() {
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

    // `EventLoopHandle` has no `Default`, so `impl Default for FileSink` is
    // not possible; kept private since the writer's parent is only set once
    // [`Self::new`] has placed the value.
    fn fields(
        self_ref: bun_ptr::SelfRoot<FileSink>,
        event_loop_handle: EventLoopHandle,
        fd: Fd,
    ) -> FileSink {
        FileSink {
            ref_count: Cell::new(1),
            self_ref,
            writer: JsCell::new(IOWriter::default()),
            event_loop_handle,
            written: Cell::new(0),
            pending: JsCell::new(streams::WritablePending {
                result: streams::Writable::Done,
                ..Default::default()
            }),
            source: JsCell::new(streams::SourceHandle::default()),
            done: Cell::new(false),
            started: Cell::new(false),
            keep_alive_ref: JsCell::new(None),
            source_pending_pull: Cell::new(false),
            pollable: Cell::new(false),
            nonblocking: Cell::new(false),
            force_sync: Cell::new(false),
            is_socket: Cell::new(false),
            fd: Cell::new(fd),
            auto_flusher: JsCell::new(AutoFlusher::default()),
            run_pending_later_wanted: Cell::new(false),
            flush_task_ref: JsCell::new(None),
            wrapper_ref: JsCell::new(None),
            stream_promise_ref: JsCell::new(None),
            readable_stream: JsCell::new(readable_stream::Strong::default()),
            stream_done: JsCell::new(bun_jsc::JSPromiseStrong::empty()),
            stream_error: JsCell::new(None),
            stream_bytes: Cell::new(None),
            js_sink_ref: JsCell::new(bun_jsc::strong::Optional::empty()),
        }
    }
}

impl FileSink {
    /// Does not ref or unref.
    fn handle_resolve_stream(&self) {
        if let Some(stream) = self.readable_stream.get().get() {
            stream.done();
        }

        if !self.done.get() {
            self.writer.with_mut(|w| w.close());
        }
    }

    /// Does not ref or unref.
    fn handle_reject_stream(&self, global_this: &JSGlobalObject, _err: JSValue) -> JsResult<()> {
        if let Some(stream) = self.readable_stream.get().get() {
            let aborted = stream.abort(global_this);
            self.readable_stream.set(readable_stream::Strong::default());
            aborted?;
        }

        if !self.done.get() {
            self.writer.with_mut(|w| w.close());
        }
        Ok(())
    }

    /// The JS pump driving `stream` into this sink (via `assign_to_stream` or
    /// `Blob::pipe_readable_stream_to_blob`) is pending: hold `pump_ref` until
    /// its promise settles ([`release_stream_promise_ref`](Self::release_stream_promise_ref))
    /// or its controller dies attached at teardown (`controller_finalize`).
    pub(crate) fn hold_stream_promise_ref(&self, pump_ref: RefPtr<FileSink>) {
        debug_assert!(
            self.stream_promise_ref.get().is_none(),
            "one stream pump per FileSink"
        );
        self.stream_promise_ref.set(Some(pump_ref));
    }

    /// May free `this`.
    pub(crate) fn release_stream_promise_ref(this: ThisPtr<FileSink>) {
        drop(this.stream_promise_ref.replace(None));
    }
}

// C++ `promiseHandlerID` compares the handler passed to `JSValue::then` against
// these symbols by address, so they must stay function exports.
// HOST_EXPORT(Bun__FileSink__onResolveStream, jsc)
pub fn on_resolve_stream(
    this: ThisPtr<FileSink>,
    _global_this: &JSGlobalObject,
    _callframe: &CallFrame,
) -> JsResult<JSValue> {
    bun_core::scoped_log!(FileSink, "onResolveStream");
    this.handle_resolve_stream();
    // The ref taken before `then`; may free `this`.
    FileSink::release_stream_promise_ref(this);
    Ok(JSValue::UNDEFINED)
}

// HOST_EXPORT(Bun__FileSink__onRejectStream, jsc)
pub fn on_reject_stream(
    this: ThisPtr<FileSink>,
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    bun_core::scoped_log!(FileSink, "onRejectStream");
    let args = callframe.arguments();
    let err = args[0];
    let result = this.handle_reject_stream(global_this, err);
    FileSink::release_stream_promise_ref(this);
    result.map(|()| JSValue::UNDEFINED)
}

impl FileSink {
    /// `Bun.write(file, stream)`: wire `stream`'s native source straight to this sink and return a
    /// promise for the byte count once the file is closed. `None` if the stream is not a native
    /// source; the caller falls back to the JS pump.
    pub fn pipe_stream(
        this: ThisPtr<FileSink>,
        stream: &ReadableStream,
        global_this: &JSGlobalObject,
    ) -> Option<JSValue> {
        let _guard = this.ref_guard();

        this.stream_bytes.set(Some(0));
        this.stream_done
            .set(bun_jsc::JSPromiseStrong::init(global_this));
        let promise = this.stream_done.get().value();
        this.readable_stream
            .set(readable_stream::Strong::init(*stream, global_this));

        match stream.wire_native_sink(
            global_this,
            webcore::SinkHandle::FileSink(BackRef::new(this.get())),
            JSValue::UNDEFINED,
            |src| this.source.set(src),
        ) {
            readable_stream::NativeWireResult::Wired => {
                // A synchronous source (FileReader over a regular file) may have run to the
                // end inside `wire_native_sink`; the promise is settled then.
                if this.stream_done.get().has_value() && !this.done.get() {
                    this.writer
                        .with_mut(|w| w.enable_keeping_process_alive(this.io_evtloop()));
                    this.keep_alive_until_eof();
                }
                Some(promise)
            }
            readable_stream::NativeWireResult::EndedInline(err) => {
                this.source.set(streams::SourceHandle::None);
                this.end_from_stream(err);
                Some(promise)
            }
            readable_stream::NativeWireResult::NotNative => {
                this.stream_done.set(bun_jsc::JSPromiseStrong::empty());
                this.readable_stream.set(readable_stream::Strong::default());
                None
            }
        }
    }

    /// `ThisPtr`, not `&self`: the JS pump reaches back in through the sink
    /// pointer it is handed while this runs.
    pub fn assign_to_stream(
        this: ThisPtr<FileSink>,
        stream: &mut ReadableStream,
        global_this: &JSGlobalObject,
    ) -> JSValue {
        let _guard = this.ref_guard();

        this.readable_stream
            .set(readable_stream::Strong::init(*stream, global_this));

        // Native ByteStream/FileReader fast-path: wire the SinkHandle
        // directly, skipping the JS pump.
        match stream.wire_native_sink(
            global_this,
            webcore::SinkHandle::FileSink(BackRef::new(this.get())),
            JSValue::UNDEFINED,
            |src| this.source.set(src),
        ) {
            readable_stream::NativeWireResult::Wired => {
                // A synchronous producer may have driven `end_from_stream`
                // (clears `source`) inline; no keepalive then.
                if !matches!(this.source.get(), streams::SourceHandle::None) {
                    this.writer
                        .with_mut(|w| w.enable_keeping_process_alive(this.io_evtloop()));
                    this.keep_alive_until_eof();
                }
                return JSValue::UNDEFINED;
            }
            readable_stream::NativeWireResult::EndedInline(err) => {
                this.source.set(streams::SourceHandle::None);
                match err {
                    Some(err) => this.end_from_stream(Some(err)),
                    None => {
                        let _ = this.end(None);
                    }
                }
                return JSValue::UNDEFINED;
            }
            readable_stream::NativeWireResult::NotNative => {}
        }

        // No ref for the controller itself (only the transient `_guard`
        // above): the JS builtins always call `controller.end()`/`.close()`
        // (`${controller}__end/close` → `controller->detach()` → m_sinkPtr=null)
        // before GC, so its destructor only reaches `controller_finalize` at
        // heap teardown, where it stands in for the pump's reaction.
        let promise_result =
            JSSink::assign_to_stream(global_this, stream.value, NonNull::from(this));

        if let Some(err) = promise_result.to_error() {
            this.readable_stream.set(readable_stream::Strong::default());
            return err;
        }

        if !promise_result.is_empty_or_undefined_or_null() {
            if let Some(promise) = promise_result.as_any_promise() {
                match promise.status() {
                    bun_jsc::js_promise::Status::Pending => {
                        this.writer
                            .with_mut(|w| w.enable_keeping_process_alive(this.io_evtloop()));
                        this.hold_stream_promise_ref(RefPtr::from_this(this));
                        // TODO: properly propagate exception upwards
                        promise_result.then(
                            global_this,
                            this.as_ptr(),
                            crate::generated_host_exports::Bun__FileSink__onResolveStream,
                            crate::generated_host_exports::Bun__FileSink__onRejectStream,
                        );
                    }
                    bun_jsc::js_promise::Status::Fulfilled => {
                        // These don't ref().
                        this.handle_resolve_stream();
                    }
                    bun_jsc::js_promise::Status::Rejected => {
                        // These don't ref().
                        let result = promise.result(global_this.vm());
                        crate::dispatch::fold(this.handle_reject_stream(global_this, result));
                    }
                }
            }
        }

        promise_result
    }
}
