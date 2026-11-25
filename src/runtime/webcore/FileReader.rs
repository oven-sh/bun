use core::cell::Cell;

use bun_collections::VecExt;
#[cfg(not(windows))]
use bun_io::FileType;
use bun_io::pipe_reader::ReaderFlags;
use bun_io::{BufferedReader, Chunk, IoEvent, Owner, PollTag, ReadResult, ReadState};
use bun_jsc::JsCell;
use bun_ptr::{OptionCellExt as _, RefPtr};
use bun_sys::{self as sys, Fd};

use crate::webcore::SinkHandle;
use crate::webcore::blob;
use crate::webcore::jsc::SysErrorJsc as _;
use crate::webcore::jsc::bindgen::{JsLocal, JsScope};
use crate::webcore::jsc::{self as jsc, EventLoopHandle, JSValue};
use crate::webcore::jsc::{EnsureStillAlive, strong::Optional as Strong};
use crate::webcore::node_types::PathOrFileDescriptor;
use crate::webcore::readable_stream;
use crate::webcore::streams;

bun_core::declare_scope!(FileReader, visible);

// Every method takes `&self`; per-field interior mutability via `Cell` (Copy) / `JsCell` (non-Copy).
pub struct FileReader {
    pub(crate) reader: BufferedReader,
    pub(crate) done: Cell<bool>,
    pub(crate) pending: streams::Pending,
    pub(crate) pending_value: JsCell<Strong>, // Strong.Optional
    /// Read-only after construction (set via struct literal in `from_blob_*`).
    pub(crate) start_offset: Option<usize>,
    /// Length of the slice window at `start_offset`; the reader is limited to it when it is started and ends the stream there. Read-only after init.
    pub(crate) max_size: Option<usize>,
    pub(crate) started: Cell<bool>,
    /// Held while a read can complete from the event loop, until the reader is done.
    pub(crate) io_ref: Cell<Option<RefPtr<Source>>>,
    pub(crate) event_loop: Cell<EventLoopHandle>,
    pub(crate) lazy: JsCell<Lazy>,
    pub(crate) buffered: JsCell<Vec<u8>>,
    /// A read error that arrived with no pending pull. The next `on_pull` returns it.
    pub(crate) read_error: JsCell<Option<sys::Error>>,
    /// Read-only after construction.
    pub(crate) highwater_mark: usize,
    pub(crate) flowing: Cell<bool>,
    /// Native sink attached by a hookup site (e.g. fetch request body). When
    /// set, `on_read_chunk` writes directly to it instead of the JS `pending`
    /// path; `pull_into_sink` is the drain-ack resume.
    pub(crate) sink: JsCell<SinkHandle>,
    pub(crate) sink_paused: Cell<bool>,
}

impl Default for FileReader {
    fn default() -> Self {
        Self {
            reader: BufferedReader::init(),
            done: Cell::new(false),
            pending: streams::Pending::default(),
            pending_value: JsCell::new(Strong::empty()),
            start_offset: None,
            max_size: None,
            started: Cell::new(false),
            io_ref: Cell::new(None),
            // Sentinel only; never dispatched (callers must overwrite before use).
            event_loop: Cell::new(EventLoopHandle::init(core::ptr::null_mut())),
            lazy: JsCell::new(Lazy::None),
            buffered: JsCell::new(Vec::new()),
            read_error: JsCell::new(None),
            highwater_mark: 16384,
            flowing: Cell::new(true),
            sink: JsCell::new(SinkHandle::None),
            sink_paused: Cell::new(false),
        }
    }
}

pub(crate) enum Lazy {
    None,
    Blob(RefPtr<blob::Store>),
}

pub(crate) struct OpenedFileBlob {
    pub(crate) file: sys::File,
    pub(crate) pollable: bool,
    pub(crate) nonblocking: bool,
    #[cfg(not(windows))]
    pub(crate) file_type: FileType,
}

unsafe extern "C" {
    #[cfg(not(windows))]
    pub(crate) safe fn open_as_nonblocking_tty(fd: i32, flags: i32) -> i32;
}

impl Lazy {
    pub(crate) fn open_file_blob(file: &mut blob::store::File) -> sys::Result<OpenedFileBlob> {
        #[cfg(unix)]
        let mut is_nonblocking = false;

        let opened: sys::File = match &file.pathlike {
            PathOrFileDescriptor::Fd(pl_fd) => {
                if pl_fd.stdio_tag().is_some() {
                    'brk: {
                        #[cfg(unix)]
                        {
                            let rc = open_as_nonblocking_tty(pl_fd.native(), sys::O::RDONLY);
                            if rc > -1 {
                                is_nonblocking = true;
                                file.is_atty = Some(true);
                                break 'brk sys::File::from_fd(Fd::from_native(rc));
                            }
                        }
                        // `File` leaves a standard stream open.
                        break 'brk sys::File::from_fd(*pl_fd);
                    }
                } else {
                    let duped = sys::dup_with_flags(*pl_fd, 0);

                    let fd: Fd = match duped {
                        Ok(fd) => fd,
                        Err(err) => return Err(err.with_fd(*pl_fd)),
                    };

                    #[cfg(unix)]
                    {
                        if fd.stdio_tag().is_none() {
                            is_nonblocking = match sys::get_fcntl_flags(fd) {
                                Ok(flags) => (flags & sys::O::NONBLOCK as isize) != 0,
                                Err(_) => false,
                            };
                        }
                    }

                    sys::File::from_fd(fd).make_lib_uv_owned_for_syscall(sys::Tag::dup)?
                }
            }
            PathOrFileDescriptor::Path(path) => {
                match sys::File::open(
                    &bun_paths::Path::from(path.slice()),
                    sys::O::RDONLY | sys::O::NONBLOCK | sys::O::CLOEXEC,
                    0,
                ) {
                    Ok(opened) => {
                        #[cfg(unix)]
                        {
                            is_nonblocking = true;
                        }
                        opened
                    }
                    Err(err) => {
                        return Err(crate::node::fs::error_for_caller(
                            [Some(path), None],
                            err.with_path(path.slice()),
                        ));
                    }
                }
            }
        };
        #[cfg_attr(windows, allow(unused_mut))]
        let mut this = OpenedFileBlob {
            file: opened,
            pollable: false,
            nonblocking: true,
            #[cfg(not(windows))]
            file_type: FileType::File,
        };

        #[cfg(unix)]
        {
            let fd = this.file.fd();
            if file.is_atty.unwrap_or(false)
                || (fd.stdio_tag().is_some() && sys::isatty(fd))
                || (matches!(&file.pathlike, PathOrFileDescriptor::Fd(pl_fd)
                        if pl_fd.stdio_tag().is_some() && sys::isatty(*pl_fd)))
            {
                file.is_atty = Some(true);
            }

            let stat = sys::fstat(fd)?;

            let mode = stat.st_mode as _;
            if sys::S::ISDIR(mode) {
                return Err(sys::Error::from_code(sys::Errno::EISDIR, sys::Tag::fstat));
            }

            if sys::S::ISREG(mode) {
                is_nonblocking = false;
            }

            // pollable: `S.ISFIFO(mode) or S.ISSOCK(mode)`
            this.pollable = (sys::S::ISFIFO(mode) || sys::S::ISSOCK(mode))
                || is_nonblocking
                || file.is_atty.unwrap_or(false);
            this.file_type = if sys::S::ISFIFO(mode) {
                FileType::Pipe
            } else if sys::S::ISSOCK(mode) {
                FileType::Socket
            } else {
                FileType::File
            };

            // pretend it's a non-blocking pipe if it's a TTY
            if is_nonblocking && this.file_type != FileType::Socket {
                this.file_type = FileType::NonblockingPipe;
            }

            this.nonblocking = is_nonblocking
                || (this.pollable
                    && !file.is_atty.unwrap_or(false)
                    && this.file_type != FileType::Pipe);

            if this.nonblocking && this.file_type == FileType::Pipe {
                this.file_type = FileType::NonblockingPipe;
            }
        }

        Ok(this)
    }
}

impl FileReader {
    pub(crate) fn ref_guard(&self) -> RefPtr<Source> {
        // SAFETY: see `parent()`.
        unsafe { RefPtr::init_ref(self.parent()) }
    }

    pub(crate) fn set_reader_owner(&self) {
        let owner = Owner::new(PollTag::FileReader, self.parent().cast());
        // SAFETY: see `parent()`. The reader is a field of `self`.
        unsafe { self.reader.set_owner(owner) };
    }

    fn event_loop_ctx(&self) -> bun_io::EventLoopCtx {
        self.event_loop.get().as_event_loop_ctx()
    }

    /// `this` pins the JS wrapper too: a consumer (JS, or a native sink such as HTMLRewriter) can drop the stream's last GC root.
    pub(crate) fn read(this: &RefPtr<Source>, event: Option<IoEvent>) {
        let this = &this.context;
        let result = this
            .reader
            .read_chunks(this.event_loop_ctx(), event, |chunk, state| {
                this.on_read_chunk(chunk, state)
            });
        this.on_read_result(result);
    }

    fn on_read_result(&self, result: ReadResult) {
        match result {
            ReadResult::Pending => {}
            ReadResult::Done => self.on_reader_done(),
            ReadResult::Err(err) => self.on_reader_error(err),
        }
    }

    pub(crate) fn on_start(&self) -> streams::Start {
        self.set_reader_owner();
        #[cfg(unix)]
        let was_lazy = !matches!(self.lazy.get(), Lazy::None);
        let mut lazy_file = None;
        let mut pollable = false;
        #[cfg(unix)]
        let mut file_type = FileType::File;
        // R-2: move the `Lazy` out of the cell up-front (it's reset to `None`
        // on every path through the original `if let` body) so the `RefPtr<Store>`
        // is owned locally and the cell borrow is released immediately.
        if let Lazy::Blob(store) = self.lazy.replace(Lazy::None) {
            // Single-threaded JS event loop; we hold the only mutating handle.
            match blob::Store::data_mut(&store) {
                blob::store::Data::S3(_) | blob::store::Data::Bytes(_) => {
                    panic!("Invalid state in FileReader: expected file ")
                }
                blob::store::Data::File(file) => {
                    let open_result = Lazy::open_file_blob(file);
                    // drop the RefPtr<Store>; `lazy` was already cleared above
                    drop(store);
                    match open_result {
                        Err(err) => return streams::Start::Err(err),
                        Ok(opened) => {
                            lazy_file = Some(opened.file);
                            pollable = opened.pollable;
                            #[cfg(unix)]
                            {
                                file_type = opened.file_type;
                            }
                            self.reader.update_flags(|f| {
                                f.set(ReaderFlags::NONBLOCKING, opened.nonblocking);
                                f.set(ReaderFlags::POLLABLE, pollable);
                            });
                        }
                    }
                }
            }
        }

        {
            let global = self.parent_const().global_this();
            // `bun_vm()` is the live thread-local VM; `event_loop()` is its
            // per-thread `jsc::EventLoop`.
            self.event_loop
                .set(EventLoopHandle::init(global.bun_vm().event_loop_ptr()));
        }

        if let Some(file) = lazy_file {
            // The across-read ref roots the JS wrapper (`increment_count`
            // upgrades `this_jsvalue` to Strong) so an event-loop callback
            // firing with no JS on the stack never lands on a freed box. For a
            // POSIX non-pollable regular file every read is synchronous
            // (`read_file` → `sys::pread`), so there is no such callback —
            // holding the Strong there would root an abandoned reader forever
            // and leak its fd. Windows file reads are async via libuv even for
            // regular files, so the ref is always taken there.
            #[cfg(unix)]
            let need_io_ref = pollable;
            #[cfg(windows)]
            let need_io_ref = true;
            if need_io_ref {
                self.io_ref.set(Some(self.ref_guard()));
            }
            self.reader.set_limit(self.max_size);
            let (event_loop, fd) = (self.event_loop_ctx(), file.into());
            let start_result = if let Some(offset) = self.start_offset {
                self.reader
                    .start_file_offset(event_loop, fd, pollable, offset)
            } else {
                self.reader.start(event_loop, fd, pollable)
            };
            match start_result {
                Ok(result) => self.on_read_result(result),
                Err(e) => {
                    self.io_ref.set(None);
                    return streams::Start::Err(e);
                }
            }
        } else {
            #[cfg(unix)]
            {
                if !self.started.get()
                    && self.io_ref.is_none()
                    && self.reader.has_flag(ReaderFlags::POLLABLE)
                    && !self.reader.is_done()
                {
                    self.io_ref.set(Some(self.ref_guard()));
                }
            }
            #[cfg(windows)]
            {
                // Non-lazy fromPipe path (Bun.spawn stdout/stderr): hold a
                // ref across the pending uv_read_start so the source is not
                // finalized while IOCP has a read queued on it.
                if !self.started.get()
                    && self.io_ref.is_none()
                    && self.reader.has_source()
                    && !self.reader.is_done()
                {
                    self.io_ref.set(Some(self.ref_guard()));
                }
            }
        }

        #[cfg(unix)]
        if file_type == FileType::Socket {
            self.reader.update_flags(|f| f.insert(ReaderFlags::SOCKET));
        }

        self.started.set(true);

        if self.reader.is_done() {
            self.consume_reader_buffer();
            if !self.buffered.get().is_empty() {
                return streams::Start::OwnedAndDone(self.buffered.replace(Vec::new()));
            }
        } else {
            #[cfg(unix)]
            {
                if !was_lazy && self.reader.has_flag(ReaderFlags::POLLABLE) {
                    // A from_pipe() reader may arrive with IS_PAUSED set (lazy
                    // subprocess stdio); clear it so read() does not no-op.
                    self.on_read_result(self.reader.unpause());
                    Self::read(&self.ref_guard(), None);
                }
            }
        }

        streams::Start::Ready
    }

    /// Lazily start the reader for a native-sink hookup. Bun's file-backed
    /// streams defer `start()` to the first JS `pull()`, so the hookup site
    /// must drive it itself. Returns `None` if the reader was already started
    /// (or nothing to do); otherwise the `on_start` result the caller must
    /// handle (`Err` / `OwnedAndDone`).
    pub(crate) fn start_for_sink(&self, global: &jsc::JSGlobalObject) -> Option<streams::Start> {
        if self.started.get() {
            return None;
        }
        self.parent_const()
            .global_this
            .set(Some(bun_ptr::BackRef::new(global)));
        match self.on_start() {
            streams::Start::Ready | streams::Start::Empty | streams::Start::ChunkSize(_) => None,
            other => Some(other),
        }
    }

    /// Drop the native sink and end the stream locked to it: errored with the reader's `err`, else closed.
    fn detach_sink(&self, err: Option<&streams::StreamError>) {
        self.sink_paused.set(false);
        if self.sink.replace(SinkHandle::None).is_some() {
            self.parent_const().end_locked_stream(err);
        }
    }

    /// Detach the native sink without running the cancel path. Called by the
    /// sink's `SourceHandle::close` when the sink closes first.
    pub(crate) fn unpipe_without_deref(&self) {
        self.detach_sink(None);
    }

    /// Sink's drain ack: unpause, push any buffered bytes, then resume reading.
    pub(crate) fn pull_into_sink(&self) {
        if !self.sink_paused.replace(false) {
            return;
        }
        let sink = *self.sink.get();
        if sink.is_none() {
            return;
        }
        let reader_done = self.reader_finished();
        let buffered = self.drain();
        if !buffered.is_empty() {
            let chunk = if reader_done {
                streams::Result::OwnedAndDone(buffered)
            } else {
                streams::Result::Owned(buffered)
            };
            match sink.write(&chunk) {
                streams::Writable::Backpressure(_) => {
                    self.sink_paused.set(true);
                    self.reader.pause();
                    return;
                }
                streams::Writable::Err(e) => {
                    self.detach_sink(None);
                    sink.end(Some(streams::StreamError::Error(e)));
                    return;
                }
                streams::Writable::Done => {
                    self.detach_sink(None);
                    sink.end(None);
                    return;
                }
                _ => {}
            }
        }
        if reader_done || self.done.get() {
            // A read error from before the sink was attached ends it here.
            let err = self
                .read_error
                .replace(None)
                .map(streams::StreamError::Error);
            self.detach_sink(err.as_ref());
            sink.end(err);
            return;
        }
        if !self.reader.has_pending_read() {
            let this = self.ref_guard();
            self.on_read_result(self.reader.unpause());
            Self::read(&this, None);
        }
    }

    /// The JS stream was errored with `reason`. A native reader that waits now fails with it.
    pub(crate) fn error_native_consumer(&self, reason: jsc::JSValue) {
        let _pin = self.ref_guard();
        let global = self.parent_const().global_this();
        let err = streams::StreamError::JSValue(jsc::strong::Optional::create(reason, global));
        let sink = *self.sink.get();
        if sink.is_some() {
            self.detach_sink(Some(&err));
            sink.end(Some(err));
        } else {
            self.pending.run(streams::Result::Err(err));
        }
    }

    pub(crate) fn on_cancel(&self) {
        // A sink still wired here must fail, not see an EOF and commit a truncated body.
        let sink = *self.sink.get();
        self.unpipe_without_deref();
        if sink.is_some() {
            sink.end(Some(streams::StreamError::AbortReason(
                jsc::CommonAbortReason::UserAbort,
            )));
        }
        if self.done.get() {
            return;
        }
        self.done.set(true);
        // Nothing is read into the buffer of a pull that was waiting.
        self.pending_value
            .with_mut(|p| p.clear_without_deallocation());
        self.reader.update_ref(false);
        if !self.reader.is_done() {
            self.on_read_result(self.reader.close());
        }
    }

    fn on_read_chunk(&self, chunk: Chunk<'_>, state: ReadState) -> bool {
        bun_core::scoped_log!(
            FileReader,
            "onReadChunk() = {} ({})",
            chunk.len(),
            read_state_tag(state)
        );

        if self.done.get() {
            self.on_read_result(self.reader.close());
            return false;
        }
        let has_more = state != ReadState::Eof;

        let sink = *self.sink.get();
        if sink.is_some() {
            self.write_chunk_to_sink(sink, &chunk, has_more)
        } else if self.pending.is_pending() {
            // Pipes may return 0-byte reads short of EOF; keep reading.
            if chunk.is_empty() && state == ReadState::Drained {
                true
            } else {
                self.resolve_pending_read(chunk, has_more)
            }
        } else {
            if self.buffered.get().is_empty() && chunk.is_owned() {
                self.buffered.set(chunk.take());
            } else {
                self.buffered.with_mut(|b| b.extend_from_slice(&chunk));
            }
            // No JS read is waiting; stop at the highwater mark and let onPull restart. `started` gates it: a non-lazy `Bun.spawn` pipe is already reading before any consumer attaches, and throttling then deadlocks a child alternating stdout/stderr writes.
            let keep_going = !self.started.get()
                || (self.flowing.get() && self.buffered.get().len() < self.highwater_mark);
            // `false` only ends this read loop; `pause()` stops the reader and releases its hold on the event loop until `on_pull`.
            if !keep_going {
                self.reader.pause();
            }
            keep_going
        }
    }

    fn write_chunk_to_sink(&self, sink: SinkHandle, chunk: &[u8], has_more: bool) -> bool {
        if !chunk.is_empty() {
            let wrote = sink.write(&if has_more {
                streams::Result::Temporary(chunk)
            } else {
                streams::Result::TemporaryAndDone(chunk)
            });
            match wrote {
                streams::Writable::Backpressure(_) => {
                    // Returning `false` ends a synchronous read loop; an event-driven reader (Windows, pollable fds) has to be paused or its next completion piles into the sink. `pull_into_sink` unpauses.
                    self.sink_paused.set(true);
                    self.reader.pause();
                    return false;
                }
                streams::Writable::Err(e) => {
                    self.detach_sink(None);
                    sink.end(Some(streams::StreamError::Error(e)));
                    return false;
                }
                streams::Writable::Done => {
                    self.detach_sink(None);
                    sink.end(None);
                    return false;
                }
                _ => {}
            }
        }
        if !has_more && self.sink.get().is_some() {
            self.detach_sink(None);
            sink.end(None);
        }
        has_more
    }

    /// Settles the parked JS read with `chunk` (invariant: a parked read means `buffered` was already drained into it).
    fn resolve_pending_read(&self, chunk: Chunk<'_>, has_more: bool) -> bool {
        let was_done = self.reader.is_done();
        let global = self.parent_const().global_this();
        let mut pending_array_buffer = self
            .pending_value
            .get()
            .get()
            .and_then(|view| view.as_array_buffer(global))
            .unwrap_or_default();
        let pending_buf = pending_array_buffer.slice_mut();
        let (result, ret) = if chunk.is_empty() {
            let buffered = self.buffered.replace(Vec::new());
            let result = if buffered.is_empty() {
                streams::Result::Done
            } else if pending_buf.len() >= buffered.len() {
                pending_buf[..buffered.len()].copy_from_slice(&buffered);
                streams::Result::IntoArrayAndDone(streams::IntoArray {
                    value: self.pending_value.get().get().unwrap_or_default(),
                    len: buffered.len() as u64,
                })
            } else {
                streams::Result::OwnedAndDone(buffered)
            };
            (result, false)
        } else {
            let result = if pending_buf.len() >= chunk.len() {
                pending_buf[..chunk.len()].copy_from_slice(&chunk);
                let into = streams::IntoArray {
                    value: self.pending_value.get().get().unwrap_or_default(),
                    len: chunk.len() as u64,
                };
                if was_done {
                    streams::Result::IntoArrayAndDone(into)
                } else {
                    streams::Result::IntoArray(into)
                }
            } else if chunk.is_owned() || !has_more {
                let owned = chunk.take();
                if was_done {
                    streams::Result::OwnedAndDone(owned)
                } else {
                    streams::Result::Owned(owned)
                }
            } else {
                streams::Result::Temporary(&chunk)
            };
            (result, !was_done)
        };
        self.pending_value
            .with_mut(|p| p.clear_without_deallocation());
        self.pending.run(result);
        // Re-entrant cancel or a nested pull that read to EOF closed the reader; tell the io caller to stop so it does not re-read the captured fd.
        ret && !self.done.get() && !self.reader.is_done()
    }

    pub(crate) fn drain(&self) -> Vec<u8> {
        if !self.buffered.get().is_empty() {
            return self.buffered.replace(Vec::new());
        }

        if self.reader.has_pending_read() {
            return Vec::<u8>::default();
        }

        self.reader.take_buffer()
    }

    fn consume_reader_buffer(&self) {
        if self.buffered.get().capacity() == 0 {
            self.buffered.set(self.reader.take_buffer());
        }
    }

    fn on_reader_done(&self) {
        bun_core::scoped_log!(FileReader, "onReaderDone()");
        // `pending.run()` and `on_close()` can run user JS, and the `self.buffered` /
        // `io_ref` reads below must not land on a freed box.
        let _pin = self.ref_guard();
        let sink = *self.sink.get();
        if sink.is_some() {
            self.consume_reader_buffer();
            if !self.sink_paused.get() {
                self.detach_sink(None);
                let buffered = self.buffered.replace(Vec::new());
                if !buffered.is_empty() {
                    let _ = sink.write(&streams::Result::OwnedAndDone(buffered));
                }
                sink.end(None);
            }
        } else {
            self.consume_reader_buffer();
            if self.pending.is_pending() {
                let buffered = self.buffered.replace(Vec::new());
                self.pending.run(if buffered.is_empty() {
                    streams::Result::Done
                } else {
                    streams::Result::OwnedAndDone(buffered)
                });
            }
            // Don't handle buffered data here - it will be returned on the next onPull
            // This ensures proper ordering of chunks
        }

        // Only close the stream if there's no buffered data left to deliver
        if self.buffered.get().is_empty() {
            self.parent_const().on_close();
        }
        self.io_ref.set(None);
    }

    fn on_reader_error(&self, err: sys::Error) {
        self.consume_reader_buffer();
        if self.buffered.get().capacity() > 0 && self.buffered.get().is_empty() {
            self.buffered.set(Vec::new());
        }

        // `sink.end()` and `pending.run()` run user JS, which can reach on_reader_done
        // and drop the across-read ref before the read of it below.
        let _pin = self.ref_guard();

        let sink = *self.sink.get();
        if sink.is_some() {
            let err = streams::StreamError::Error(err);
            self.detach_sink(Some(&err));
            sink.end(Some(err));
        } else if self.pending.is_pending() {
            self.pending
                .run(streams::Result::Err(streams::StreamError::Error(err)));
        } else {
            // `pending.run()` would no-op and the pull promise would never settle.
            self.read_error.set(Some(err));
        }

        if !self.done.get() {
            self.io_ref.set(None);
        }
        self.close_after_error();
    }

    /// An errored stream is never cancelled, so release the poll and the fd here.
    fn close_after_error(&self) {
        if self.done.get() {
            return;
        }
        self.done.set(true);
        self.reader.update_ref(false);
        self.reader.deinit();
    }

    /// Done, with no stored read error left for one more pull to return.
    fn reader_finished(&self) -> bool {
        self.reader.is_done() && self.read_error.get().is_none()
    }

    /// The stored read error, or a clean end.
    fn end_of_reader(&self) -> streams::Result<'static> {
        match self.read_error.replace(None) {
            Some(err) => streams::Result::Err(streams::StreamError::Error(err)),
            None => streams::Result::Done,
        }
    }

    pub(crate) fn set_raw_mode(&self, _flag: bool) -> sys::Result<()> {
        #[cfg(not(windows))]
        {
            panic!(
                "FileReader.setRawMode must not be called on {}",
                std::env::consts::OS
            );
        }
        #[cfg(windows)]
        {
            self.reader.set_raw_mode(_flag)
        }
    }

    pub(crate) fn set_flowing(&self, flag: bool) {
        bun_core::scoped_log!(
            FileReader,
            "setFlowing({}) was={}",
            flag,
            self.flowing.get()
        );

        if self.flowing.get() == flag {
            return;
        }

        self.flowing.set(flag);

        if flag {
            self.on_read_result(self.reader.unpause());
            if !self.reader.is_done() && !self.reader.has_pending_read() {
                // Kick off a new read if needed
                Self::read(&self.ref_guard(), None);
            }
        } else {
            self.reader.pause();
        }
    }
}

pub(crate) type Source = readable_stream::NewSource<FileReader>;

// SAFETY: `FileReader` is always the `context` field of a heap-allocated
// `Source`. `parent` is the `raw` arm for releasing a ref, which can free it.
bun_core::impl_field_parent! { FileReader => Source.context; pub fn raw parent; pub fn shared parent_const; }

impl readable_stream::SourceContext for FileReader {
    crate::source_context_codegen!(js_FileInternalReadableStreamSource);

    fn on_start(&self) -> streams::Start {
        Self::on_start(self)
    }

    fn on_pull(&self, buffer: &mut [u8], array: JSValue) -> streams::Result<'_> {
        // `buffer` borrows a JS typed array kept alive by `array`.
        array.ensure_still_alive();
        let _keep = EnsureStillAlive(array);
        let drained = self.drain();

        if drained.len() > 0 {
            bun_core::scoped_log!(FileReader, "onPull({}) = {}", buffer.len(), drained.len());

            self.pending_value
                .with_mut(|p| p.clear_without_deallocation());

            if buffer.len() >= drained.len() as usize {
                let drained_len = drained.len();
                buffer[0..drained_len as usize].copy_from_slice(drained.slice());
                // drain() moved ownership of the allocation into `drained` and
                // left `self.buffered` / the reader buffer empty, so free
                // `drained` here — freeing `self.buffered` would be a no-op.
                drop(drained);

                if self.reader_finished() {
                    return streams::Result::IntoArrayAndDone(streams::IntoArray {
                        value: array,
                        len: drained_len as u64,
                    });
                } else {
                    return streams::Result::IntoArray(streams::IntoArray {
                        value: array,
                        len: drained_len as u64,
                    });
                }
            }

            if self.reader_finished() {
                return streams::Result::OwnedAndDone(drained);
            } else {
                return streams::Result::Owned(drained);
            }
        }

        // A stored error also ends a reader that never started (`from_bytes_then_error`).
        if self.reader.is_done() || self.read_error.get().is_some() {
            return self.end_of_reader();
        }

        if !self.reader.has_pending_read() && self.flowing.get() {
            // A consumer is pulling again: undo the highwater pause from `on_read_chunk`.
            self.on_read_result(self.reader.unpause());
            let (amount_read, state, result) = self.reader.read_into(self.event_loop_ctx(), buffer);
            self.on_read_result(result);
            bun_core::scoped_log!(FileReader, "onPull({}) = {}", buffer.len(), amount_read);
            let done = state == ReadState::Eof || self.reader_finished();
            if amount_read > 0 {
                let into = streams::IntoArray {
                    value: array,
                    len: amount_read as u64,
                };
                return if done {
                    streams::Result::IntoArrayAndDone(into)
                } else {
                    streams::Result::IntoArray(into)
                };
            }
            // A completion may have landed in `buffered` while `on_read_result` ran user JS.
            let drained = self.drain();
            if !drained.is_empty() {
                return if done {
                    streams::Result::OwnedAndDone(drained)
                } else {
                    streams::Result::Owned(drained)
                };
            }
            if done || self.reader.is_done() {
                return self.end_of_reader();
            }
        }

        let buffer_len = buffer.len();
        let global = self.parent_const().global_this();
        self.pending_value.with_mut(|p| p.set(global, array));
        #[cfg(windows)]
        if self.flowing.get() {
            self.on_read_result(self.reader.unpause());
        }

        bun_core::scoped_log!(FileReader, "onPull({}) = pending", buffer_len);

        streams::Result::Pending(&self.pending)
    }

    fn on_cancel(&self) {
        Self::on_cancel(self);
    }

    fn deinit_fn(&self) {
        self.reader.update_ref(false);
    }

    fn wrapper_finalized(&self) {
        debug_assert!(!(self.done.get() && self.io_ref.is_some()));
        if self.done.get() || self.io_ref.is_none() {
            return;
        }
        self.done.set(true);
        self.io_ref.set(None);
    }

    fn set_ref_unref(&self, enable: bool) {
        if self.done.get() {
            return;
        }
        self.reader.update_ref(enable);
    }

    fn drain_internal_buffer(&self) -> Vec<u8> {
        Self::drain(self)
    }

    fn memory_cost_fn(&self) -> usize {
        // ReadableStreamSource covers @sizeOf(FileReader)
        self.reader.memory_cost() + self.buffered.get().capacity()
    }
}

impl Source {
    pub fn set_raw_mode(&self, cx: &mut JsScope<'_>, flag: JsLocal<'_>) -> JSValue {
        let flag = flag.to_js();
        debug_assert!(flag.is_boolean());
        match self.context.set_raw_mode(flag == JSValue::TRUE) {
            Ok(()) => JSValue::UNDEFINED,
            Err(e) => e.to_js(cx.global()),
        }
    }

    pub fn set_flowing(&self, _: &mut JsScope<'_>, flag: JsLocal<'_>) {
        let flag = flag.to_js();
        debug_assert!(flag.is_boolean());
        self.context.set_flowing(flag == JSValue::TRUE);
    }
}

// Local shim: `bun_io::ReadState` doesn't derive `IntoStaticStr` (upstream crate);
// used for the scoped log only.
#[inline]
fn read_state_tag(state: ReadState) -> &'static str {
    match state {
        ReadState::Progress => "progress",
        ReadState::Eof => "eof",
        ReadState::Drained => "drained",
    }
}
