use core::cell::{Cell, UnsafeCell};
use core::mem;

use bun_collections::VecExt;
#[cfg(unix)]
use bun_io as aio;
#[cfg(not(windows))]
use bun_io::FileType;
use bun_io::{BufferedReader, Chunk, ReadState};
use bun_jsc::JsCell;
use bun_ptr::{AsCtxPtr, RefPtr};
use bun_sys::{self as sys, Fd, FdExt};

use crate::webcore::SinkHandle;
use crate::webcore::blob;
use crate::webcore::jsc::{self as jsc, EventLoopHandle, JSValue};
use crate::webcore::jsc::{EnsureStillAlive, strong::Optional as Strong};
use crate::webcore::node_types::PathOrFileDescriptor;
use crate::webcore::readable_stream;
use crate::webcore::streams;

bun_core::declare_scope!(FileReader, visible);

// R-2 (host-fn re-entrancy): every JS-exposed / vtable-reachable method takes
// `&self`; per-field interior mutability via `Cell` (Copy) / `JsCell` (non-
// Copy). The `SourceContext` trait and `BufferedReaderParent` shims still
// hand in `&mut Self` / `*mut Self` until those layers are migrated — `&mut T`
// auto-derefs to `&T` so the impls below compile against either. `Cell<T>` and
// `JsCell<T>` are both `#[repr(transparent)]`, so the embedded layout (offset
// 0 of `NewSource<FileReader>`) is unchanged.
pub struct FileReader {
    /// Wrapped in `UnsafeCell` so that the back-ref `*mut FileReader` (vtable
    /// `parent`) and the reader's own `&mut self` both derive from a
    /// SharedReadWrite root — see `BufferedReaderParent` aliasing contract
    /// (PipeReader.rs). The vtable callbacks fire while a `&mut BufferedReader`
    /// is live on the caller's stack and re-enter `self.reader` (close/buffer/
    /// is_done); without `UnsafeCell` materializing `&mut FileReader` there is
    /// Stacked-Borrows UB. Matches sibling `IOReader` (shell) port.
    pub(crate) reader: UnsafeCell<IOReader>,
    pub(crate) done: Cell<bool>,
    pub(crate) pending: JsCell<streams::Pending>,
    pub(crate) pending_value: JsCell<Strong>, // Strong.Optional
    // TODO(refactor): `&'static mut [u8]` forge — borrows a JS typed-array buffer
    // that GC can move/collect, and `&'static mut` asserts uniqueness the GC
    // does not honour. `bun_ptr::Interned` is read-only by construction so
    // does NOT cover this; tracked under the sibling `static-widen-mut`
    // pattern (field should become `*mut [u8]` / `RawSliceMut<u8>`).
    pub(crate) pending_view: JsCell<&'static mut [u8]>,
    pub(crate) fd: Cell<Fd>,
    /// Read-only after construction (set via struct literal in `from_blob_*`).
    pub(crate) start_offset: Option<usize>,
    /// Length of the slice window at `start_offset`; the reader is limited to it when it is started and ends the stream there. Read-only after init.
    pub(crate) max_size: Option<usize>,
    pub(crate) started: Cell<bool>,
    pub(crate) waiting_for_on_reader_done: Cell<bool>,
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
            reader: UnsafeCell::new(IOReader::init::<FileReader>()),
            done: Cell::new(false),
            pending: JsCell::new(streams::Pending::default()),
            pending_value: JsCell::new(Strong::empty()),
            pending_view: JsCell::new(&mut []),
            fd: Cell::new(Fd::INVALID),
            start_offset: None,
            max_size: None,
            started: Cell::new(false),
            waiting_for_on_reader_done: Cell::new(false),
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
//
// R-2: every mutated field on `FileReader` is `Cell`/`JsCell`/`UnsafeCell`-
// backed, so materializing `&FileReader` via `(&*this)` does not assert Unique
// over any byte the caller may have borrowed (SharedReadWrite root); the
// inherent impls re-derive any reader access through `reader()`
// (`UnsafeCell::get`).
bun_io::impl_buffered_reader_parent! {
    FileReader for FileReader;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, state| (&*this).on_read_chunk(chunk, state);
    on_reader_done  = |this| (&*this).on_reader_done();
    on_reader_error = |this, err| (&*this).on_reader_error(err);
    loop_ = |this| {
        let ev = (&*this).event_loop.get();
        // The event loop is a libuv
        // `uv_loop_t*` on Windows. `.cast()` reconciles the impl-declared
        // `bun_uws_sys::Loop` nominal with `bun_io::Loop` (= `uv::Loop`).
        #[cfg(windows)] { ev.uv_loop().cast() }
        #[cfg(not(windows))] { ev.r#loop() }
    };
    event_loop = |this| (&*this).event_loop.get().as_event_loop_ctx();
    // A read delivers to `on_read_chunk` consumers (JS, or a native sink such
    // as HTMLRewriter) that can drop this stream's last GC root and allocate
    // before the read loop's frames unwind, so the reader pins its parent —
    // and, through `increment_count`, the JS wrapper — for the duration.
    ref_  = |this| (*(&*this).parent()).increment_count();
    deref = |this| { let _ = Source::decrement_count((&*this).parent()); };
}

impl FileReader {
    /// SharedReadWrite accessor for the embedded `BufferedReader`. See the
    /// `UnsafeCell` note on the field declaration — this is the single point
    /// through which all `self.reader` access flows so vtable-callback
    /// re-entrancy and outer `&mut FileReader` borrows both root at the cell.
    /// SAFETY: single-threaded (JS event loop); the cell is the sole
    /// SharedReadWrite root — see the unsafe block below.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn reader(&self) -> &mut IOReader {
        // SAFETY: `FileReader` is single-threaded (JS event loop) and every
        // `self.reader` access flows through this accessor, so the `UnsafeCell`
        // is the sole SharedReadWrite root — no `&mut IOReader` is held live
        // across a vtable-callback re-entry point (see field doc comment).
        unsafe { &mut *self.reader.get() }
    }

    // In-place init — `self` is the `context` field of an already-allocated
    // `Source`; `event_loop` is set to its real value right after the reset.
    // R-2: kept `&mut self` — init-time constructor that runs before any
    // host-fn could re-enter; `*self =` requires unique access.

    pub(crate) fn on_start(&self) -> streams::Start {
        self.reader().set_parent(self.as_ctx_ptr().cast());
        let was_lazy = !matches!(self.lazy.get(), Lazy::None);
        let mut pollable = false;
        #[cfg(unix)]
        let mut file_type = FileType::File;
        // R-2: move the `Lazy` out of the cell up-front (it's reset to `None`
        // on every path through the original `if let` body) so the `RefPtr<Store>`
        // is owned locally and the cell borrow is released immediately.
        if let Lazy::Blob(store) = self.lazy.replace(Lazy::None) {
            // Clone the `File` out so `open_file_blob` takes `&mut File` on
            // its own copy instead of `data_mut()` on the shared `Store`
            // (other `RefPtr<Store>` clones to the same allocation exist). The
            // clone is cheap; the `is_atty = Some(true)` cache write
            // `open_file_blob` makes is intentionally discarded with the
            // clone — writing it back would need `data_mut()` on an aliased
            // handle, re-opening #30800. Cost: a repeat `isatty` probe on a
            // second `.stream()` of `Bun.file(0|1|2)` (the canonical stdio
            // Stores are built with `is_atty` pre-populated).
            match &store.data {
                blob::store::Data::S3(_) | blob::store::Data::Bytes(_) => {
                    panic!("Invalid state in FileReader: expected file ")
                }
                blob::store::Data::File(file) => {
                    let mut file_local = file.clone();
                    let open_result = Lazy::open_file_blob(&mut file_local);
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
                                self.reader()
                                    .flags
                                    .set(PosixFlags::NONBLOCKING, opened.nonblocking);
                                self.reader().flags.set(PosixFlags::POLLABLE, pollable);
                            }
                            #[cfg(windows)]
                            {
                                use bun_io::pipe_reader::WindowsFlags;
                                self.reader()
                                    .flags
                                    .set(WindowsFlags::NONBLOCKING, opened.nonblocking);
                                self.reader().flags.set(WindowsFlags::POLLABLE, pollable);
                            }
                        }
                    }
                }
            }
        }

        {
            let reader_fd = self.reader().get_fd();
            if reader_fd != Fd::INVALID && self.fd.get() == Fd::INVALID {
                self.fd.set(reader_fd);
            }
        }

        // `bun_vm()` returns a raw `*mut VirtualMachine` (never null for a Bun
        // global); deref to call `event_loop()`.
        {
            let global = self.parent_global();
            // `bun_vm()` is the live thread-local VM; `event_loop()` is its
            // per-thread `jsc::EventLoop`.
            self.event_loop.set(EventLoopHandle::init(
                global.bun_vm().as_mut().event_loop().cast::<()>(),
            ));
        }

        if was_lazy {
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
                // SAFETY: see `parent()`.
                unsafe { (*self.parent()).increment_count() };
                self.waiting_for_on_reader_done.set(true);
            }
            self.reader().set_limit(self.max_size);
            let start_result = if let Some(offset) = self.start_offset {
                self.reader()
                    .start_file_offset(self.fd.get(), pollable, offset)
            } else {
                self.reader().start(self.fd.get(), pollable)
            };
            if let Err(e) = start_result {
                if need_io_ref {
                    self.waiting_for_on_reader_done.set(false);
                    let parent = self.parent();
                    // SAFETY: see `parent()`; JS finalizer still holds a ref so this cannot free it.
                    let _ = unsafe { Source::decrement_count(parent) };
                }
                return streams::Start::Err(e);
            }
        } else {
            #[cfg(unix)]
            {
                use bun_io::pipe_reader::PosixFlags;
                if !self.started.get()
                    && !self.waiting_for_on_reader_done.get()
                    && self.reader().flags.contains(PosixFlags::POLLABLE)
                    && !self.reader().is_done()
                {
                    self.waiting_for_on_reader_done.set(true);
                    // SAFETY: see `parent()`.
                    unsafe { (*self.parent()).increment_count() };
                }
            }
            #[cfg(windows)]
            {
                // Non-lazy fromPipe path (Bun.spawn stdout/stderr): hold a
                // ref across the pending uv_read_start so the source is not
                // finalized while IOCP has a read queued on it.
                if !self.started.get()
                    && !self.waiting_for_on_reader_done.get()
                    && self.reader().source.is_some()
                    && !self.reader().is_done()
                {
                    self.waiting_for_on_reader_done.set(true);
                    // SAFETY: see `parent()`.
                    unsafe { (*self.parent()).increment_count() };
                }
            }
        }

        #[cfg(unix)]
        {
            use bun_io::pipe_reader::PosixFlags;
            if file_type == FileType::Socket {
                self.reader().flags.insert(PosixFlags::SOCKET);
            }

            let r = self.reader();
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

        if self.reader().is_done() {
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
                if !was_lazy && self.reader().flags.contains(PosixFlags::POLLABLE) {
                    // A from_pipe() reader may arrive with IS_PAUSED set (lazy
                    // subprocess stdio); clear it so read() does not no-op.
                    self.reader().unpause();
                    // SAFETY: the reader cell is live for `self`'s lifetime; `read` is
                    // the raw re-entrancy-safe entry (its dispatch runs user JS).
                    unsafe { IOReader::read(self.reader.get()) };
                }
            }
        }

        streams::Start::Ready
    }

    /// Safe accessor for the parent `NewSource.global_this` back-reference.
    ///
    /// One unsafe (`from_field_ptr` raw-place projection of a `Copy` field —
    /// no `&Source` is materialized so no aliasing with `&self`); callers
    /// then `Deref` the returned `BackRef` with no unsafe.
    #[inline]
    fn parent_global(&self) -> bun_ptr::BackRef<jsc::JSGlobalObject> {
        // SAFETY: see `parent()` — `self` is the `context` field of a live
        // heap-allocated `Source`. Reading the `Copy` `global_this` via
        // `(*ptr).field` is a raw-place read, not a `&Source` borrow.
        unsafe { (*self.parent()).global_this }.expect("NewSource.global_this set before use")
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
        // SAFETY: see `parent()` — `self` is the `context` field of a live
        // heap-allocated `Source`; single-threaded JS, no aliasing `&mut`.
        unsafe { (*self.parent()).global_this = Some(bun_ptr::BackRef::new(global)) };
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
    pub(crate) fn pull_into_sink(&self) {
        if !self.sink_paused.replace(false) {
            return;
        }
        let sink = *self.sink.get();
        if sink.is_none() {
            return;
        }
        let reader_done = self.reader().is_done();
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
                    self.reader().pause();
                    return;
                }
                streams::Writable::Err(e) => {
                    self.sink.set(SinkHandle::None);
                    sink.end(Some(streams::StreamError::Error(e)));
                    return;
                }
                streams::Writable::Done => {
                    self.sink.set(SinkHandle::None);
                    sink.end(None);
                    return;
                }
                _ => {}
            }
        }
        if reader_done || self.done.get() {
            self.sink.set(SinkHandle::None);
            sink.end(None);
            return;
        }
        if !self.reader().has_pending_read() {
            self.reader().unpause();
            // SAFETY: the reader cell is live for `self`'s lifetime; `read` is
            // the raw re-entrancy-safe entry (its dispatch runs user JS).
            unsafe { IOReader::read(self.reader.get()) };
        }
    }

    pub(crate) fn on_cancel(&self) {
        self.unpipe_without_deref();
        if self.done.get() {
            return;
        }
        self.done.set(true);
        self.reader().update_ref(false);
        if !self.reader().is_done() {
            self.reader().close();
        }
    }

    // NOTE: not `impl Drop` — FileReader is embedded as `Source.context` and this is
    // invoked from the Source's JS finalizer path via `SourceContext::deinit_fn`.
    // Not `pub`: reached only via the `SourceContext` trait impl below.
    //
    // Only side-effect teardown lives here. Owned fields (buffered: Vec, reader:
    // BufferedReader, pending_value: Strong, lazy: Arc) drop when the caller
    // (`NewSource::decrement_count`) reclaims the `Box<Source>` *after* this
    // returns. Freeing the parent here would
    // deallocate the storage backing `&self` while the borrow is still live
    // — a dangling-reference UAF — so ownership release stays with the caller.
    fn deinit(&self) {
        self.reader().update_ref(false);
    }

    fn finalize_detach(&self) -> bool {
        debug_assert!(!(self.done.get() && self.waiting_for_on_reader_done.get()));
        if self.done.get() || !self.waiting_for_on_reader_done.get() {
            return false;
        }
        self.waiting_for_on_reader_done.set(false);
        self.done.set(true);
        true
    }

    pub(crate) fn on_read_chunk(&self, chunk: Chunk<'_>, state: ReadState) -> bool {
        bun_core::scoped_log!(
            FileReader,
            "onReadChunk() = {} ({})",
            chunk.len(),
            read_state_tag(state)
        );

        if self.done.get() {
            self.reader().close();
            return false;
        }
        let has_more = state != ReadState::Eof;

        let sink = *self.sink.get();
        if sink.is_some() {
            self.write_chunk_to_sink(sink, &chunk, has_more)
        } else if self.pending.get().state == streams::PendingState::Pending {
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
            // A completion-driven reader keeps issuing reads unless stopped; `on_pull` restarts it.
            #[cfg(windows)]
            if !keep_going {
                self.reader().pause();
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
                    self.reader().pause();
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
    fn resolve_pending_read(&self, chunk: Chunk<'_>, has_more: bool) -> bool {
        let was_done = self.reader().is_done();
        let global = self.parent_global();
        let mut pending_array_buffer = self
            .pending_value
            .get()
            .get()
            .and_then(|view| view.as_array_buffer(&global))
            .unwrap_or_default();
        let pending_buf = pending_array_buffer.slice_mut();
        let ret = if chunk.is_empty() {
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
            self.pending.with_mut(|p| p.result = result);
            false
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
                // Copied into a fresh Uint8Array by `run()` below, before this returns.
                streams::Result::Temporary(bun_ptr::RawSlice::new(&chunk))
            };
            self.pending.with_mut(|p| p.result = result);
            !was_done
        };
        self.pending_value
            .with_mut(|p| p.clear_without_deallocation());
        self.pending_view.set(&mut []);
        // Pin across `run()`: a re-entrant cancel() reaches on_reader_done, which drops the across-read ref and lets a GC free this box while the io caller still holds `&mut` into it.
        let parent = self.parent();
        // SAFETY: see `parent()`.
        unsafe { (*parent).increment_count() };
        self.pending.with_mut(|p| p.run());
        // Re-entrant cancel or a nested pull that read to EOF closed the reader; tell the io caller to stop so it does not re-read the captured fd.
        let ret = ret && !self.done.get() && !self.reader().is_done();
        // SAFETY: see `parent()`; the pin keeps the count >= 1, so this never frees. `self` is not accessed after.
        let _ = unsafe { Source::decrement_count(parent) };
        ret
    }

    pub(crate) fn on_pull(&self, buffer: &'static mut [u8], array: JSValue) -> streams::Result {
        // `buffer` borrows a JS typed array kept alive by `array`.
        array.ensure_still_alive();
        let _keep = EnsureStillAlive(array);
        let drained = self.drain();

        if drained.len() > 0 {
            bun_core::scoped_log!(FileReader, "onPull({}) = {}", buffer.len(), drained.len());

            self.pending_value
                .with_mut(|p| p.clear_without_deallocation());
            self.pending_view.set(&mut []);

            if buffer.len() >= drained.len() as usize {
                let drained_len = drained.len();
                buffer[0..drained_len as usize].copy_from_slice(drained.slice());
                // drain() moved ownership of the allocation into `drained` and
                // left `self.buffered` / the reader buffer empty, so free
                // `drained` here — freeing `self.buffered` would be a no-op.
                drop(drained);

                if self.reader().is_done() {
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

            if self.reader().is_done() {
                return streams::Result::OwnedAndDone(drained);
            } else {
                return streams::Result::Owned(drained);
            }
        }

        if self.reader().is_done() {
            return streams::Result::Done;
        }

        if !self.reader().has_pending_read() && self.flowing.get() {
            // SAFETY: the reader cell is live for `self`'s lifetime; `read_into` is the raw re-entrancy-safe entry (EOF/error dispatch runs user JS).
            let (amount_read, state) = unsafe { IOReader::read_into(self.reader.get(), buffer) };
            bun_core::scoped_log!(FileReader, "onPull({}) = {}", buffer.len(), amount_read);
            let done = state == ReadState::Eof || self.reader().is_done();
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
        let global = self.parent_global();
        self.pending_value.with_mut(|p| p.set(&global, array));
        self.pending_view.set(buffer);
        #[cfg(windows)]
        if self.flowing.get() {
            self.reader().unpause();
        }

        bun_core::scoped_log!(FileReader, "onPull({}) = pending", buffer_len);

        streams::Result::Pending(self.pending.as_ptr())
    }

    pub(crate) fn drain(&self) -> Vec<u8> {
        if !self.buffered.get().is_empty() {
            let out = Vec::<u8>::move_from_list(self.buffered.replace(Vec::new()));
            debug_assert!(self.reader().buffer().as_ptr() != out.as_ptr());
            return out;
        }

        if self.reader().has_pending_read() {
            return Vec::<u8>::default();
        }

        Vec::<u8>::move_from_list(mem::take(self.reader().buffer()))
    }

    pub(crate) fn set_ref_or_unref(&self, enable: bool) {
        if self.done.get() {
            return;
        }
        self.reader().update_ref(enable);
    }

    fn consume_reader_buffer(&self) {
        if self.buffered.get().capacity() == 0 {
            self.buffered.set(mem::take(self.reader().buffer()));
        }
    }

    pub(crate) fn on_reader_done(&self) {
        bun_core::scoped_log!(FileReader, "onReaderDone()");
        // Pin across `p.run()` and `on_close()`: both can run user JS, and the
        // `self.buffered` / `waiting_for_on_reader_done` reads below must not
        // land on a freed box. Same bracket as on_read_chunk / on_reader_error.
        let parent = self.parent();
        // SAFETY: see `parent()`.
        unsafe { (*parent).increment_count() };
        let sink = *self.sink.get();
        if sink.is_some() {
            self.consume_reader_buffer();
            if !self.sink_paused.get() {
                self.sink.set(SinkHandle::None);
                let buffered = self.buffered.replace(Vec::new());
                if !buffered.is_empty() {
                    let _ = sink.write(&streams::Result::OwnedAndDone(buffered));
                }
                sink.end(None);
            }
        } else {
            self.consume_reader_buffer();
            if self.pending.get().state == streams::PendingState::Pending {
                if !self.buffered.get().is_empty() {
                    let buffered = self.buffered.replace(Vec::new());
                    self.pending.with_mut(|p| {
                        p.result =
                            streams::Result::OwnedAndDone(Vec::<u8>::move_from_list(buffered))
                    });
                } else {
                    self.pending.with_mut(|p| p.result = streams::Result::Done);
                }
                self.buffered.set(Vec::new());
                self.pending.with_mut(|p| p.run());
            }
            // Don't handle buffered data here - it will be returned on the next onPull
            // This ensures proper ordering of chunks
        }

        // Only close the stream if there's no buffered data left to deliver
        if self.buffered.get().is_empty() {
            // SAFETY: see `parent()`; the pin keeps the count > 0.
            unsafe { (*parent).on_close() };
        }
        if self.waiting_for_on_reader_done.get() {
            self.waiting_for_on_reader_done.set(false);
            // SAFETY: see `parent()`; the pin above keeps the count > 0.
            let _ = unsafe { Source::decrement_count(parent) };
        }
        // SAFETY: see `parent()`; releases the pin. Tail position — `self` (a
        // field of `*parent`) is not accessed after this call, which may free
        // the allocation when the refcount hits zero.
        let _ = unsafe { Source::decrement_count(parent) };
    }

    pub(crate) fn on_reader_error(&self, err: sys::Error) {
        self.consume_reader_buffer();
        if self.buffered.get().capacity() > 0 && self.buffered.get().is_empty() {
            self.buffered.set(Vec::new());
        }

        let sink = *self.sink.get();
        if sink.is_some() {
            self.sink.set(SinkHandle::None);
            self.sink_paused.set(false);
            sink.end(Some(streams::StreamError::Error(err)));
            let parent = self.parent();
            if self.waiting_for_on_reader_done.get() && !self.done.get() {
                self.waiting_for_on_reader_done.set(false);
                // SAFETY: see `parent()`.
                let _ = unsafe { Source::decrement_count(parent) };
            }
            return;
        }

        self.pending.with_mut(|p| {
            p.result = streams::Result::Err(streams::StreamError::Error(err));
        });
        // Pin across `p.run()`: it runs user JS, and anything there that
        // reaches on_reader_done would drop the across-read ref and let a GC
        // free this box before the `waiting_for_on_reader_done` read below.
        let parent = self.parent();
        // SAFETY: see `parent()`.
        unsafe { (*parent).increment_count() };
        self.pending.with_mut(|p| p.run());

        if self.waiting_for_on_reader_done.get() && !self.done.get() {
            self.waiting_for_on_reader_done.set(false);
            // SAFETY: see `parent()`; the pin above keeps the count > 0.
            let _ = unsafe { Source::decrement_count(parent) };
        }
        // SAFETY: see `parent()`; the pin keeps the count >= 1, so this never
        // frees. Tail call, `self` is not accessed after.
        let _ = unsafe { Source::decrement_count(parent) };
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
            self.reader().set_raw_mode(_flag)
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
            self.reader().unpause();
            if !self.reader().is_done() && !self.reader().has_pending_read() {
                // Kick off a new read if needed
                // SAFETY: the reader cell is live for `self`'s lifetime; `read` is
                // the raw re-entrancy-safe entry (its dispatch runs user JS).
                unsafe { IOReader::read(self.reader.get()) };
            }
        } else {
            self.reader().pause();
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        // ReadableStreamSource covers @sizeOf(FileReader)
        self.reader().memory_cost() + self.buffered.get().capacity()
    }
}

pub type Source = readable_stream::NewSource<FileReader>;

// SAFETY: `FileReader` is always the `context` field of a heap-allocated
// `Source`. `parent` is the `raw` arm because the ref-count pin
// (`increment_count`/`decrement_count`) and `global_this` are plain `Source`
// fields; callers deref in a tight `unsafe { (*ptr).method() }` scope and never
// hold `&mut Source` across other `self.*` accesses.
bun_core::impl_field_parent! { FileReader => Source.context; pub fn raw parent; pub fn shared parent_const; }

impl readable_stream::SourceContext for FileReader {
    const NAME: &'static str = "File";
    const SUPPORTS_REF: bool = true;
    crate::source_context_codegen!(js_FileInternalReadableStreamSource);
    // R-2: trait sigs are still `&mut self` (shared with ByteBlobLoader/
    // ByteStream — separate migration); the inherent impls take `&self`, so
    // these forward via auto-deref. The `&mut` here is what the codegen shim
    // currently emits; once `NewSource` is celled the trait flips to `&self`
    // and these become straight `Self::*(self, ..)` calls.
    fn on_start(&mut self) -> streams::Start {
        Self::on_start(self)
    }
    fn on_pull(&mut self, buf: &mut [u8], arr: JSValue) -> streams::Result {
        // SAFETY: lifetime laundering — `buf` borrows a JS typed array kept alive
        // by `arr` (see the lifetime note at the top of the file).
        let buf = unsafe { &mut *std::ptr::from_mut::<[u8]>(buf) };
        Self::on_pull(self, buf, arr)
    }
    fn on_cancel(&mut self) {
        Self::on_cancel(self);
    }
    fn deinit_fn(&mut self) {
        Self::deinit(self)
    }
    fn finalize_detach(&mut self) -> bool {
        Self::finalize_detach(self)
    }
    fn set_ref_unref(&mut self, e: bool) {
        Self::set_ref_or_unref(self, e)
    }
    fn drain_internal_buffer(&mut self) -> Vec<u8> {
        Self::drain(self)
    }
    fn memory_cost_fn(&self) -> usize {
        Self::memory_cost(self)
    }
    fn set_raw_mode(&mut self, flag: bool) -> Option<sys::Result<()>> {
        Some(Self::set_raw_mode(self, flag))
    }
    fn set_flowing(&mut self, flag: bool) {
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
