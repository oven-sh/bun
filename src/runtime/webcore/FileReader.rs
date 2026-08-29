use core::cell::Cell;
use core::mem;

use bun_collections::VecExt;
#[cfg(unix)]
use bun_io as aio;
#[cfg(not(windows))]
use bun_io::FileType;
use bun_io::{BufferedReader, Chunk, ReadState};
use bun_jsc::JsCell;
use bun_ptr::{RefPtr, ThisPtr};
use bun_sys::{self as sys, Fd, FdExt};

use crate::webcore::SinkHandle;
use crate::webcore::blob;
use crate::webcore::jsc::{self as jsc, EventLoopHandle, JSValue};
use crate::webcore::jsc::{EnsureStillAlive, strong::Optional as Strong};
use crate::webcore::node_types::PathOrFileDescriptor;
use crate::webcore::readable_stream::{self, SourceRef};
use crate::webcore::streams;

bun_core::declare_scope!(FileReader, visible);

// R-2 (host-fn re-entrancy): every JS-exposed / vtable-reachable method takes
// `&self` (or the enclosing source's `ThisPtr`); per-field interior mutability
// via `Cell` (Copy) / `JsCell` (non-Copy). `Cell<T>` and `JsCell<T>` are both
// `#[repr(transparent)]`, so the embedded layout (offset 0 of
// `NewSource<FileReader>`) is unchanged.
pub struct FileReader {
    /// The `BufferedReader` re-enters this `FileReader` (through the enclosing
    /// `Source`, its registered parent) from inside its own methods, so every
    /// access is a short closure-scoped borrow.
    pub(crate) reader: JsCell<IOReader>,
    pub(crate) done: Cell<bool>,
    pub(crate) pending: JsCell<streams::Pending>,
    pub(crate) pending_value: JsCell<Strong>, // Strong.Optional
    pub(crate) fd: Cell<Fd>,
    /// Read-only after construction (set via struct literal in `from_blob_*`).
    pub(crate) start_offset: Option<usize>,
    /// Length of the slice window at `start_offset`; the reader is limited to it when it is started and ends the stream there. Read-only after init.
    pub(crate) max_size: Option<usize>,
    pub(crate) started: Cell<bool>,
    /// The reference held across an in-flight read (from `start()` until
    /// `on_reader_done` / `on_reader_error`): it keeps the source — and, through
    /// [`readable_stream::NewSource::retain`], the JS wrapper — alive so an
    /// event-loop callback with no JS on the stack never lands on a freed source.
    pub(crate) read_ref: Cell<Option<SourceRef<FileReader>>>,
    /// References the embedded reader holds on the source while one of its
    /// entry points runs (`BufferedReaderParent::ref_` / `deref`, LIFO).
    pub(crate) reader_refs: JsCell<Vec<SourceRef<FileReader>>>,
    pub(crate) event_loop: Cell<EventLoopHandle>,
    pub(crate) lazy: JsCell<Lazy>,
    pub(crate) buffered: JsCell<Vec<u8>>,
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
            reader: JsCell::new(IOReader::init::<Source>()),
            done: Cell::new(false),
            pending: JsCell::new(streams::Pending::default()),
            pending_value: JsCell::new(Strong::empty()),
            fd: Cell::new(Fd::INVALID),
            start_offset: None,
            max_size: None,
            started: Cell::new(false),
            read_ref: Cell::new(None),
            reader_refs: JsCell::new(Vec::new()),
            // Sentinel only; never dispatched (callers must overwrite before use).
            event_loop: Cell::new(EventLoopHandle::init(core::ptr::null_mut())),
            lazy: JsCell::new(Lazy::None),
            buffered: JsCell::new(Vec::new()),
            highwater_mark: 16384,
            flowing: Cell::new(true),
            sink: JsCell::new(SinkHandle::None),
            sink_paused: Cell::new(false),
        }
    }
}

pub type IOReader = BufferedReader;

pub enum Lazy {
    None,
    Blob(RefPtr<blob::Store>),
}

pub struct OpenedFileBlob {
    pub(crate) fd: Fd,
    pub(crate) pollable: bool,
    pub(crate) nonblocking: bool,
    #[cfg(not(windows))]
    pub(crate) file_type: FileType,
}

impl Default for OpenedFileBlob {
    fn default() -> Self {
        Self {
            fd: Fd::INVALID,
            pollable: false,
            nonblocking: true,
            #[cfg(not(windows))]
            file_type: FileType::File,
        }
    }
}

unsafe extern "C" {
    pub safe fn open_as_nonblocking_tty(fd: i32, flags: i32) -> i32;
}

impl Lazy {
    pub(crate) fn open_file_blob(file: &mut blob::store::File) -> sys::Result<OpenedFileBlob> {
        let mut this = OpenedFileBlob {
            fd: Fd::INVALID,
            ..Default::default()
        };
        let mut file_buf = bun_paths::PathBuffer::uninit();
        #[cfg(unix)]
        let mut is_nonblocking = false;

        let fd: Fd = match &file.pathlike {
            PathOrFileDescriptor::Fd(pl_fd) => {
                if pl_fd.stdio_tag().is_some() {
                    'brk: {
                        #[cfg(unix)]
                        {
                            let rc = open_as_nonblocking_tty(pl_fd.native(), sys::O::RDONLY);
                            if rc > -1 {
                                is_nonblocking = true;
                                file.is_atty = Some(true);
                                break 'brk Fd::from_native(rc);
                            }
                        }
                        break 'brk *pl_fd;
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

                    fd.make_lib_uv_owned_for_syscall(sys::Tag::dup, sys::ErrorCase::CloseOnFail)?
                }
            }
            PathOrFileDescriptor::Path(path) => {
                match sys::open(
                    bun_paths::resolve_path::z(path.slice(), &mut file_buf),
                    sys::O::RDONLY | sys::O::NONBLOCK | sys::O::CLOEXEC,
                    0,
                ) {
                    Ok(fd) => {
                        #[cfg(unix)]
                        {
                            is_nonblocking = true;
                        }
                        fd
                    }
                    Err(err) => {
                        return Err(err.with_path(path.slice()));
                    }
                }
            }
        };

        #[cfg(unix)]
        {
            if file.is_atty.unwrap_or(false)
                || (fd.stdio_tag().is_some() && sys::isatty(fd))
                || (matches!(&file.pathlike, PathOrFileDescriptor::Fd(pl_fd)
                        if pl_fd.stdio_tag().is_some() && sys::isatty(*pl_fd)))
            {
                file.is_atty = Some(true);
            }

            let stat: sys::Stat = match sys::fstat(fd) {
                Ok(result) => result,
                Err(err) => {
                    fd.close();
                    return Err(err);
                }
            };

            let mode = stat.st_mode as _;
            if sys::S::ISDIR(mode) {
                aio::Closer::close(fd, ());
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

        this.fd = fd;

        Ok(this)
    }
}

// BufferedReader vtable parent: wires the
// `onReadChunk`/`onReaderDone`/`onReaderError`/`loop`/`eventLoop` callbacks.
// The registered parent is the enclosing `Source` (root pointer), so every
// handler receives its `ThisPtr` and reaches the `FileReader` at `.context`.
bun_io::impl_buffered_reader_parent! {
    FileReader for Source;
    borrow = this;
    reader = context.reader;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, state| FileReader::on_read_chunk(this, chunk, state);
    on_reader_done  = |this| FileReader::on_reader_done(this);
    on_reader_error = |this, err| FileReader::on_reader_error(this, err);
    loop_ = |this| {
        let ev = this.context.event_loop.get();
        // The event loop is a libuv
        // `uv_loop_t*` on Windows. `.cast()` reconciles the impl-declared
        // `bun_uws_sys::Loop` nominal with `bun_io::Loop` (= `uv::Loop`).
        #[cfg(windows)] { ev.uv_loop().cast() }
        #[cfg(not(windows))] { ev.r#loop() }
    };
    event_loop = |this| this.context.event_loop.get().as_event_loop_ctx();
    // A read delivers to `on_read_chunk` consumers (JS, or a native sink such
    // as HTMLRewriter) that can drop this stream's last GC root and allocate
    // before the read loop's frames unwind, so the reader pins its parent —
    // and, through `retain`, the JS wrapper — for the duration.
    ref_  = |this| { let retained = this.retain(); this.context.reader_refs.with_mut(|refs| refs.push(retained)); };
    deref = |this| { let released = this.context.reader_refs.with_mut(|refs| refs.pop()); drop(released); };
}

impl FileReader {
    /// This reader as the enclosing source's dispatch handle.
    #[inline]
    pub(crate) fn this_ptr(&self) -> ThisPtr<Source> {
        self.parent().this_ptr()
    }

    pub(crate) fn on_start(&self) -> streams::Start {
        let source = self.this_ptr();
        self.reader
            .with_mut(|r| r.set_parent(source.as_ptr().cast()));
        let was_lazy = !matches!(self.lazy.get(), Lazy::None);
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
                        Err(err) => {
                            self.fd.set(Fd::INVALID);
                            return streams::Start::Err(err);
                        }
                        Ok(opened) => {
                            debug_assert!(opened.fd.is_valid());
                            self.fd.set(opened.fd);
                            pollable = opened.pollable;
                            #[cfg(unix)]
                            {
                                file_type = opened.file_type;
                            }
                            #[cfg(unix)]
                            {
                                use bun_io::pipe_reader::PosixFlags;
                                self.reader.with_mut(|r| {
                                    r.flags.set(PosixFlags::NONBLOCKING, opened.nonblocking);
                                    r.flags.set(PosixFlags::POLLABLE, pollable);
                                });
                            }
                            #[cfg(windows)]
                            {
                                use bun_io::pipe_reader::WindowsFlags;
                                self.reader.with_mut(|r| {
                                    r.flags.set(WindowsFlags::NONBLOCKING, opened.nonblocking);
                                    r.flags.set(WindowsFlags::POLLABLE, pollable);
                                });
                            }
                        }
                    }
                }
            }
        }

        {
            let reader_fd = self.reader.get().get_fd();
            if reader_fd != Fd::INVALID && self.fd.get() == Fd::INVALID {
                self.fd.set(reader_fd);
            }
        }

        {
            let global = self.parent().global_this();
            // `bun_vm()` is the live thread-local VM; `event_loop()` is its
            // per-thread `jsc::EventLoop`.
            self.event_loop.set(EventLoopHandle::init(
                global.bun_vm().as_mut().event_loop().cast::<()>(),
            ));
        }

        if was_lazy {
            // The across-read ref roots the JS wrapper (`retain` upgrades
            // `this_jsvalue` to Strong) so an event-loop callback firing with
            // no JS on the stack never lands on a freed source. For a POSIX
            // non-pollable regular file every read is synchronous
            // (`read_file` → `sys::pread`), so there is no such callback —
            // holding the Strong there would root an abandoned reader forever
            // and leak its fd. Windows file reads are async via libuv even for
            // regular files, so the ref is always taken there.
            #[cfg(unix)]
            let need_io_ref = pollable;
            #[cfg(windows)]
            let need_io_ref = true;
            if need_io_ref {
                self.read_ref.set(Some(source.retain()));
            }
            self.reader.with_mut(|r| r.set_limit(self.max_size));
            let start_result =
                IOReader::start_from(source, self.fd.get(), pollable, self.start_offset);
            if let Err(e) = start_result {
                if need_io_ref {
                    // The JS wrapper still holds its reference, so this cannot free the source.
                    drop(self.read_ref.take());
                }
                return streams::Start::Err(e);
            }
        } else {
            #[cfg(unix)]
            {
                use bun_io::pipe_reader::PosixFlags;
                if !self.started.get()
                    && !self.has_read_ref()
                    && self.reader.get().flags.contains(PosixFlags::POLLABLE)
                    && !self.reader.get().is_done()
                {
                    self.read_ref.set(Some(source.retain()));
                }
            }
            #[cfg(windows)]
            {
                // Non-lazy fromPipe path (Bun.spawn stdout/stderr): hold a
                // ref across the pending uv_read_start so the source is not
                // finalized while IOCP has a read queued on it.
                if !self.started.get()
                    && !self.has_read_ref()
                    && self.reader.get().source.is_some()
                    && !self.reader.get().is_done()
                {
                    self.read_ref.set(Some(source.retain()));
                }
            }
        }

        #[cfg(unix)]
        {
            use bun_io::pipe_reader::PosixFlags;
            if file_type == FileType::Socket {
                self.reader.with_mut(|r| r.flags.insert(PosixFlags::SOCKET));
            }

            let r = self.reader.get();
            if let Some(poll) = r.handle.get_poll() {
                // `bun_io::FilePoll` is an opaque vtable wrapper; flag
                // mutation goes through `set_flag(FilePollFlag)`.
                if file_type == FileType::Socket || r.flags.contains(PosixFlags::SOCKET) {
                    poll.set_flag(bun_io::FilePollFlag::Socket);
                } else {
                    // if it's a TTY, we report it as a fifo
                    // we want the behavior to be as though it were a blocking pipe.
                    poll.set_flag(bun_io::FilePollFlag::Fifo);
                }

                if r.flags.contains(PosixFlags::NONBLOCKING) {
                    poll.set_flag(bun_io::FilePollFlag::Nonblocking);
                }
            }
        }

        self.started.set(true);

        if self.reader.get().is_done() {
            self.consume_reader_buffer();
            if !self.buffered.get().is_empty() {
                return streams::Start::OwnedAndDone(Vec::<u8>::move_from_list(
                    self.buffered.replace(Vec::new()),
                ));
            }
        } else {
            #[cfg(unix)]
            {
                use bun_io::pipe_reader::PosixFlags;
                if !was_lazy && self.reader.get().flags.contains(PosixFlags::POLLABLE) {
                    // A from_pipe() reader may arrive with IS_PAUSED set (lazy
                    // subprocess stdio); clear it so read() does not no-op.
                    IOReader::unpause_from(source);
                    // `read_from` is the re-entrancy-safe entry (its dispatch runs user JS).
                    IOReader::read_from(source);
                }
            }
        }

        streams::Start::Ready
    }

    #[inline]
    fn has_read_ref(&self) -> bool {
        let r = self.read_ref.take();
        let held = r.is_some();
        self.read_ref.set(r);
        held
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
        self.parent().set_global_this(global);
        match self.on_start() {
            streams::Start::Ready | streams::Start::Empty | streams::Start::ChunkSize(_) => None,
            other => Some(other),
        }
    }

    /// Detach the native sink without running the cancel path. Called by the
    /// sink's `SourceHandle::close` when the sink closes first.
    pub(crate) fn unpipe_without_deref(&self) {
        self.sink.set(SinkHandle::None);
        self.sink_paused.set(false);
    }

    /// Sink's drain ack: unpause, push any buffered bytes, then resume reading.
    pub(crate) fn pull_into_sink(this: ThisPtr<Source>) {
        let self_ = &this.context;
        if !self_.sink_paused.replace(false) {
            return;
        }
        let sink = *self_.sink.get();
        if sink.is_none() {
            return;
        }
        let reader_done = self_.reader.get().is_done();
        let buffered = self_.drain();
        if !buffered.is_empty() {
            let chunk = if reader_done {
                streams::Result::OwnedAndDone(buffered)
            } else {
                streams::Result::Owned(buffered)
            };
            match sink.write(&chunk) {
                streams::Writable::Backpressure(_) => {
                    self_.sink_paused.set(true);
                    self_.reader.with_mut(|r| r.pause());
                    return;
                }
                streams::Writable::Err(e) => {
                    self_.sink.set(SinkHandle::None);
                    sink.end(Some(streams::StreamError::Error(e)));
                    return;
                }
                streams::Writable::Done => {
                    self_.sink.set(SinkHandle::None);
                    sink.end(None);
                    return;
                }
                _ => {}
            }
        }
        if reader_done || self_.done.get() {
            self_.sink.set(SinkHandle::None);
            sink.end(None);
            return;
        }
        if !self_.reader.get().has_pending_read() {
            IOReader::unpause_from(this);
            // `read_from` is the re-entrancy-safe entry (its dispatch runs user JS).
            IOReader::read_from(this);
        }
    }

    pub(crate) fn on_cancel(&self) {
        self.unpipe_without_deref();
        if self.done.get() {
            return;
        }
        self.done.set(true);
        self.reader.with_mut(|r| r.update_ref(false));
        if !self.reader.get().is_done() {
            // Its done callback re-enters `on_reader_done`.
            IOReader::close_from(self.this_ptr());
        }
    }

    // NOTE: not `impl Drop` — FileReader is embedded as `Source.context` and this is
    // invoked from the Source's `Drop` via `SourceContext::deinit_fn`, before the
    // owned fields (buffered, reader, pending_value, lazy) drop.
    fn deinit(&self) {
        self.reader.with_mut(|r| r.update_ref(false));
    }

    /// The JS wrapper is being finalized: if a read is still in flight, give up
    /// its reference (the wrapper it was rooting is gone) and mark the reader done.
    fn finalize_detach(&self) {
        let read_ref = self.read_ref.take();
        debug_assert!(!(self.done.get() && read_ref.is_some()));
        if self.done.get() || read_ref.is_none() {
            self.read_ref.set(read_ref);
            return;
        }
        self.done.set(true);
        drop(read_ref);
    }

    pub(crate) fn on_read_chunk(this: ThisPtr<Source>, chunk: Chunk<'_>, state: ReadState) -> bool {
        let self_ = &this.context;
        bun_core::scoped_log!(
            FileReader,
            "onReadChunk() = {} ({})",
            chunk.len(),
            read_state_tag(state)
        );

        if self_.done.get() {
            IOReader::close_from(this);
            return false;
        }
        let has_more = state != ReadState::Eof;

        let sink = *self_.sink.get();
        if sink.is_some() {
            self_.write_chunk_to_sink(sink, &chunk, has_more)
        } else if self_.pending.get().state == streams::PendingState::Pending {
            // Pipes may return 0-byte reads short of EOF; keep reading.
            if chunk.is_empty() && state == ReadState::Drained {
                true
            } else {
                Self::resolve_pending_read(this, chunk, has_more)
            }
        } else {
            if self_.buffered.get().is_empty() && chunk.is_owned() {
                self_.buffered.set(chunk.take());
            } else {
                self_.buffered.with_mut(|b| b.extend_from_slice(&chunk));
            }
            // No JS read is waiting; stop at the highwater mark and let onPull restart. `started` gates it: a non-lazy `Bun.spawn` pipe is already reading before any consumer attaches, and throttling then deadlocks a child alternating stdout/stderr writes.
            let keep_going = !self_.started.get()
                || (self_.flowing.get() && self_.buffered.get().len() < self_.highwater_mark);
            // A completion-driven reader keeps issuing reads unless stopped; `on_pull` restarts it.
            #[cfg(windows)]
            if !keep_going {
                self_.reader.with_mut(|r| r.pause());
            }
            keep_going
        }
    }

    fn write_chunk_to_sink(&self, sink: SinkHandle, chunk: &[u8], has_more: bool) -> bool {
        if !chunk.is_empty() {
            let chunk = bun_ptr::RawSlice::new(chunk);
            let wrote = sink.write(&if has_more {
                streams::Result::Temporary(chunk)
            } else {
                streams::Result::TemporaryAndDone(chunk)
            });
            match wrote {
                streams::Writable::Backpressure(_) => {
                    // Returning `false` ends a synchronous read loop; an event-driven reader (Windows, pollable fds) has to be paused or its next completion piles into the sink. `pull_into_sink` unpauses.
                    self.sink_paused.set(true);
                    self.reader.with_mut(|r| r.pause());
                    return false;
                }
                streams::Writable::Err(e) => {
                    self.sink.set(SinkHandle::None);
                    sink.end(Some(streams::StreamError::Error(e)));
                    return false;
                }
                streams::Writable::Done => {
                    self.sink.set(SinkHandle::None);
                    sink.end(None);
                    return false;
                }
                _ => {}
            }
        }
        if !has_more && self.sink.get().is_some() {
            self.sink.set(SinkHandle::None);
            sink.end(None);
        }
        has_more
    }

    /// Settles the parked JS read with `chunk` (invariant: a parked read means `buffered` was already drained into it).
    fn resolve_pending_read(this: ThisPtr<Source>, chunk: Chunk<'_>, has_more: bool) -> bool {
        let self_ = &this.context;
        let was_done = self_.reader.get().is_done();
        let global = this.global_this();
        let mut pending_array_buffer = self_
            .pending_value
            .get()
            .get()
            .and_then(|view| view.as_array_buffer(global))
            .unwrap_or_default();
        let pending_buf = pending_array_buffer.slice_mut();
        let ret = if chunk.is_empty() {
            let buffered = self_.buffered.replace(Vec::new());
            let result = if buffered.is_empty() {
                streams::Result::Done
            } else if pending_buf.len() >= buffered.len() {
                pending_buf[..buffered.len()].copy_from_slice(&buffered);
                streams::Result::IntoArrayAndDone(streams::IntoArray {
                    value: self_.pending_value.get().get().unwrap_or_default(),
                    len: buffered.len() as u64,
                })
            } else {
                streams::Result::OwnedAndDone(buffered)
            };
            self_.pending.with_mut(|p| p.result = result);
            false
        } else {
            let result = if pending_buf.len() >= chunk.len() {
                pending_buf[..chunk.len()].copy_from_slice(&chunk);
                let into = streams::IntoArray {
                    value: self_.pending_value.get().get().unwrap_or_default(),
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
                // Copied into a fresh Uint8Array by `run()` below, before this returns.
                streams::Result::Temporary(bun_ptr::RawSlice::new(&chunk))
            };
            self_.pending.with_mut(|p| p.result = result);
            !was_done
        };
        self_
            .pending_value
            .with_mut(|p| p.clear_without_deallocation());
        // Pin across `run()`: a re-entrant cancel() reaches on_reader_done, which drops the across-read ref and lets a GC free this source while the io caller is still inside it.
        let _pin = this.retain();
        self_.pending.with_mut(|p| p.run());
        // Re-entrant cancel or a nested pull that read to EOF closed the reader; tell the io caller to stop so it does not re-read the captured fd.
        ret && !self_.done.get() && !self_.reader.get().is_done()
    }

    pub(crate) fn on_pull(&self, buffer: &mut [u8], array: JSValue) -> streams::Result {
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

                if self.reader.get().is_done() {
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

            if self.reader.get().is_done() {
                return streams::Result::OwnedAndDone(drained);
            } else {
                return streams::Result::Owned(drained);
            }
        }

        if self.reader.get().is_done() {
            return streams::Result::Done;
        }

        if !self.reader.get().has_pending_read() && self.flowing.get() {
            // `read_into_from` is the re-entrancy-safe entry (EOF/error dispatch runs user JS).
            let (amount_read, state) = IOReader::read_into_from(self.this_ptr(), buffer);
            bun_core::scoped_log!(FileReader, "onPull({}) = {}", buffer.len(), amount_read);
            let done = state == ReadState::Eof || self.reader.get().is_done();
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
            // A completion may have landed in `buffered` while `read_into` ran user JS.
            let drained = self.drain();
            if !drained.is_empty() {
                return if done {
                    streams::Result::OwnedAndDone(drained)
                } else {
                    streams::Result::Owned(drained)
                };
            }
            if done {
                return streams::Result::Done;
            }
        }

        let buffer_len = buffer.len();
        let global = self.parent().global_this();
        self.pending_value.with_mut(|p| p.set(global, array));
        #[cfg(windows)]
        if self.flowing.get() {
            IOReader::unpause_from(self.this_ptr());
        }

        bun_core::scoped_log!(FileReader, "onPull({}) = pending", buffer_len);

        streams::Result::Pending(bun_ptr::BackRef::new(&self.pending))
    }

    pub(crate) fn drain(&self) -> Vec<u8> {
        if !self.buffered.get().is_empty() {
            let out = Vec::<u8>::move_from_list(self.buffered.replace(Vec::new()));
            debug_assert!(self.reader.with_mut(|r| r.buffer().as_ptr()) != out.as_ptr());
            return out;
        }

        if self.reader.get().has_pending_read() {
            return Vec::<u8>::default();
        }

        Vec::<u8>::move_from_list(self.reader.with_mut(|r| mem::take(r.buffer())))
    }

    pub(crate) fn set_ref_or_unref(&self, enable: bool) {
        if self.done.get() {
            return;
        }
        self.reader.with_mut(|r| r.update_ref(enable));
    }

    fn consume_reader_buffer(&self) {
        if self.buffered.get().capacity() == 0 {
            self.buffered
                .set(self.reader.with_mut(|r| mem::take(r.buffer())));
        }
    }

    pub(crate) fn on_reader_done(this: ThisPtr<Source>) {
        let self_ = &this.context;
        bun_core::scoped_log!(FileReader, "onReaderDone()");
        // Pin across `p.run()` and `on_close()`: both can run user JS, and the
        // `buffered` / `read_ref` accesses below must not land on a freed
        // source. Same bracket as on_read_chunk / on_reader_error.
        let _pin = this.retain();
        let sink = *self_.sink.get();
        if sink.is_some() {
            self_.consume_reader_buffer();
            if !self_.sink_paused.get() {
                self_.sink.set(SinkHandle::None);
                let buffered = self_.buffered.replace(Vec::new());
                if !buffered.is_empty() {
                    let _ = sink.write(&streams::Result::OwnedAndDone(buffered));
                }
                sink.end(None);
            }
        } else {
            self_.consume_reader_buffer();
            if self_.pending.get().state == streams::PendingState::Pending {
                if !self_.buffered.get().is_empty() {
                    let buffered = self_.buffered.replace(Vec::new());
                    self_.pending.with_mut(|p| {
                        p.result =
                            streams::Result::OwnedAndDone(Vec::<u8>::move_from_list(buffered))
                    });
                } else {
                    self_.pending.with_mut(|p| p.result = streams::Result::Done);
                }
                self_.buffered.set(Vec::new());
                self_.pending.with_mut(|p| p.run());
            }
            // Don't handle buffered data here - it will be returned on the next onPull
            // This ensures proper ordering of chunks
        }

        // Only close the stream if there's no buffered data left to deliver
        if self_.buffered.get().is_empty() {
            this.on_close();
        }
        drop(self_.read_ref.take());
    }

    pub(crate) fn on_reader_error(this: ThisPtr<Source>, err: sys::Error) {
        let self_ = &this.context;
        self_.consume_reader_buffer();
        if self_.buffered.get().capacity() > 0 && self_.buffered.get().is_empty() {
            self_.buffered.set(Vec::new());
        }

        let sink = *self_.sink.get();
        if sink.is_some() {
            self_.sink.set(SinkHandle::None);
            self_.sink_paused.set(false);
            sink.end(Some(streams::StreamError::Error(err)));
            if !self_.done.get() {
                drop(self_.read_ref.take());
            }
            return;
        }

        self_.pending.with_mut(|p| {
            p.result = streams::Result::Err(streams::StreamError::Error(err));
        });
        // Pin across `p.run()`: it runs user JS, and anything there that
        // reaches on_reader_done would drop the across-read ref and let a GC
        // free this source before the `read_ref` access below.
        let _pin = this.retain();
        self_.pending.with_mut(|p| p.run());

        if !self_.done.get() {
            drop(self_.read_ref.take());
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
            self.reader.with_mut(|r| r.set_raw_mode(_flag))
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
            IOReader::unpause_from(self.this_ptr());
            if !self.reader.get().is_done() && !self.reader.get().has_pending_read() {
                // Kick off a new read if needed
                IOReader::read_from(self.this_ptr());
            }
        } else {
            self.reader.with_mut(|r| r.pause());
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        // ReadableStreamSource covers @sizeOf(FileReader)
        self.reader.get().memory_cost() + self.buffered.get().capacity()
    }
}

pub type Source = readable_stream::NewSource<FileReader>;

// Every `FileReader` is the `context` field of a heap-allocated `Source`.
bun_core::impl_field_parent! { FileReader => Source.context; pub fn shared parent; }

impl readable_stream::SourceContext for FileReader {
    const NAME: &'static str = "File";
    const SUPPORTS_REF: bool = true;
    crate::source_context_codegen!(js_FileInternalReadableStreamSource);
    fn on_start(&self) -> streams::Start {
        Self::on_start(self)
    }
    fn on_pull(&self, buf: &mut [u8], arr: JSValue) -> streams::Result {
        Self::on_pull(self, buf, arr)
    }
    fn on_cancel(&self) {
        Self::on_cancel(self);
    }
    fn deinit_fn(&self) {
        Self::deinit(self)
    }
    fn finalize_detach(&self) {
        Self::finalize_detach(self)
    }
    fn set_ref_unref(&self, e: bool) {
        Self::set_ref_or_unref(self, e)
    }
    fn drain_internal_buffer(&self) -> Vec<u8> {
        Self::drain(self)
    }
    fn memory_cost_fn(&self) -> usize {
        Self::memory_cost(self)
    }
    fn set_raw_mode(&self, flag: bool) -> Option<sys::Result<()>> {
        Some(Self::set_raw_mode(self, flag))
    }
    fn set_flowing(&self, flag: bool) {
        Self::set_flowing(self, flag)
    }
    // toBufferedValue: null
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
