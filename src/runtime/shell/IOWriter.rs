//! Abstraction to allow multiple writers that can write to a file descriptor.
//!
//! This exists because kqueue/epoll does not work when registering multiple
//! poll events on the same file descriptor.
//!
//! One way to get around this limitation is to just call `.dup()` on the file
//! descriptor, which we do for the top-level stdin/stdout/stderr. But calling
//! `.dup()` for every concurrent writer is expensive.
//!
//! So `IOWriter` is essentially a writer queue to a file descriptor.
//!
//! We also make `IOWriter` reference counted (via `Rc` in the Rust port),
//! this simplifies management of the file descriptor.

use bun_collections::VecExt;
use bun_jsc::JsCell;
use bun_ptr::JsRefCell;
use bun_ptr::{RefPtr, ThisPtr};
use core::cell::Cell;
#[cfg(not(windows))]
use core::ffi::c_void;

#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_sys::{self as sys, E, Fd};

use crate::shell::interpreter::{CapturedBuf, EventLoopHandle, Interpreter, NodeId};
use crate::shell::subproc::PipeReader;
use crate::shell::yield_::Yield;

// ──────────────────────────────────────────────────────────────────────────
// ChildPtr
// ──────────────────────────────────────────────────────────────────────────

/// In the NodeId-arena port, a "writer child" is `(NodeId, WriterTag)` — the
/// id of the owning state node plus a tag saying which `on_io_writer_chunk`
/// impl to dispatch to.
///
/// The one tag that does **not** live in the NodeId arena is
/// `WriterTag::Subproc` (the captured-output tee of a subprocess
/// [`PipeReader`]); for that variant the dispatch target is carried in
/// `subproc` instead of `node`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ChildPtr {
    pub node: NodeId,
    pub(crate) tag: WriterTag,
    /// Only set when `tag == Subproc`. The reader is kept alive by the
    /// `Readable::Pipe` ref on its `ShellSubprocess` until every chunk it
    /// queued has completed or been `cancel_chunks`ed.
    pub(crate) subproc: Option<bun_ptr::BackRef<PipeReader, bun_ptr::Root>>,
    /// `tag == Builtin`: which of the builtin's queued chunks this is (0 = the
    /// builtin itself). Chunks with different `seq` are distinct children, so
    /// each gets its own completion.
    pub(crate) seq: u32,
}

impl ChildPtr {
    const NULL: ChildPtr = ChildPtr {
        node: NodeId::NONE,
        tag: WriterTag::Cmd,
        subproc: None,
        seq: 0,
    };

    #[inline]
    pub(crate) const fn new(node: NodeId, tag: WriterTag) -> ChildPtr {
        ChildPtr {
            node,
            tag,
            subproc: None,
            seq: 0,
        }
    }

    /// The `seq`th chunk queued by the builtin at `node` (see
    /// [`OutputQueue`](crate::shell::interpreter::OutputQueue)).
    #[inline]
    pub(crate) const fn builtin_task(node: NodeId, seq: u32) -> ChildPtr {
        ChildPtr {
            node,
            tag: WriterTag::Builtin,
            subproc: None,
            seq,
        }
    }

    /// Construct a `ChildPtr` targeting a `subproc::PipeReader`'s captured
    /// writer (lives outside the NodeId arena).
    #[inline]
    pub(crate) fn subproc_capture(pipe: bun_ptr::ThisPtr<PipeReader>) -> ChildPtr {
        ChildPtr {
            node: NodeId::NONE,
            tag: WriterTag::Subproc,
            subproc: Some(pipe.into()),
            seq: 0,
        }
    }

    #[inline]
    fn is_null(&self) -> bool {
        self.node == NodeId::NONE && self.subproc.is_none()
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WriterTag {
    /// Builtin running inside a Cmd — dispatch via `Builtin::on_io_writer_chunk`.
    Builtin,
    Cmd,
    CondExpr,
    Pipeline,
    /// `subproc::PipeReader`'s captured-output tee — heap-allocated, addressed via
    /// `ChildPtr::subproc` rather than `node`.
    Subproc,
}

// ──────────────────────────────────────────────────────────────────────────
// Flags / Writer queue entry
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Default)]
pub struct Flags {
    pub(crate) pollable: bool,
    pub(crate) nonblock: bool,
    pub(crate) is_socket: bool,
    pub(crate) broken_pipe: bool,
}

/// One queued chunk: which child enqueued it, how many bytes (in `buf`), how
/// many of those have been written so far, and an optional buffer to tee
/// into.
struct Writer {
    ptr: ChildPtr,
    len: usize,
    written: usize,
    bytelist: Option<CapturedBuf>,
}

impl Writer {
    #[cfg(not(windows))]
    #[inline]
    fn wrote_everything(&self) -> bool {
        self.written >= self.len
    }
    #[inline]
    fn is_dead(&self) -> bool {
        self.ptr.is_null()
    }
    #[inline]
    fn set_dead(&mut self) {
        self.ptr = ChildPtr::NULL;
    }
    /// Tee `chunk` into the optional capture buffer.
    #[inline]
    fn tee(&self, chunk: &[u8]) {
        if let Some(bl) = &self.bytelist {
            let _ = bl.borrow_mut().append_slice(chunk);
        }
    }
}

// PERF: an inline small-vec may be worth it — profile if hot; smallvec crate.
type Writers = Vec<Writer>;

/// ~128kb. We shrink `buf` when we reach the last writer, but if that never
/// happens we shrink when it exceeds this threshold.
const SHRINK_THRESHOLD: usize = 1024 * 128;

// ──────────────────────────────────────────────────────────────────────────
// IOWriter
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub(crate) type WriterImpl = bun_io::pipe_writer::PosixBufferedWriter<IOWriter>;
#[cfg(windows)]
pub(crate) type WriterImpl = bun_io::pipe_writer::WindowsBufferedWriter<IOWriter>;

/// The `FilePoll.Owner` payload type for `SHELL_BUFFERED_WRITER`.
#[cfg(not(windows))]
pub(crate) type Poll = WriterImpl;

/// Poll-dispatch entry for `SHELL_BUFFERED_WRITER`. Holds an extra strong
/// ref across `on_poll` so child `onIOWriterChunk` callbacks (via `bump()`)
/// can drop the last external ref without freeing `self` while PipeWriter is
/// still on the stack.
#[cfg(not(windows))]
pub(crate) fn on_poll(writer: &mut Poll, size_hint: isize, hup: bool) {
    use bun_io::pipe_writer::PosixPipeWriter;
    let parent = writer.parent.expect("IOWriter writer.parent unset");
    // `parent` is the backref stashed via `set_parent` in `IOWriter::init`;
    // `writer` is a field of `*parent`, so the pointee is live.
    let _keepalive = RefPtr::from_this(parent.this_ptr());
    writer.on_poll(size_hint, hup);
}

/// Multiple state nodes share one writer and its chunk callbacks re-enter it
/// (`enqueue` from inside `on_io_writer_chunk`), so every field is
/// interior-mutable behind `&self` and no borrow is held across a callback.
/// Intrusively refcounted: holders own a `RefPtr<IOWriter>`; the io layer's
/// per-write `ref_`/`deref` hooks and the keep-alive brackets below use the
/// same count.
#[derive(bun_ptr::CellRefCounted)]
pub struct IOWriter {
    ref_count: Cell<u32>,
    self_root: bun_ptr::SelfRoot<IOWriter>,
    /// The io-layer writer. Its poll callbacks arrive while a `&mut` to it is
    /// live on the io layer's stack (see the `BufferedWriterParent` aliasing
    /// contract), so it sits in its own cell and is only touched through
    /// short `with_mut` scopes.
    writer: JsCell<WriterImpl>,
    fd: Cell<Fd>,
    writers: JsRefCell<Writers>,
    /// The bytes being written. In its own cell because the io layer borrows
    /// it (`get_buffer`) for the duration of a write syscall.
    buf: JsCell<Vec<u8>>,
    /// quick hack to get windows working; ideally this should be removed.
    #[cfg(windows)]
    winbuf: JsCell<Vec<u8>>,
    writer_idx: Cell<usize>,
    total_bytes_written: Cell<usize>,
    /// Set (and never cleared) by `fail_pending_writers`. A writer with a
    /// stored error is dead: `enqueue`/`enqueue_fmt_bltn` must reject new
    /// chunks with this error instead of queueing them (see
    /// `handle_dead_writer`). The syscall error is kept (not the derived
    /// `SystemError`) so each rejected chunk gets its own freshly-derived
    /// `SystemError`.
    err: JsRefCell<Option<sys::Error>>,
    evtloop: EventLoopHandle,
    is_writing: Cell<bool>,
    started: Cell<bool>,
    flags: Cell<Flags>,
    /// Backref to the owning interpreter for async-poll callbacks (which must
    /// drive `Yield::run`). Set by `set_interp`; `None` until then.
    interp: Cell<Option<bun_ptr::ParentRef<Interpreter>>>,
}

impl IOWriter {
    #[inline]
    fn this_ptr(&self) -> ThisPtr<IOWriter> {
        self.self_root.this_ptr(self)
    }

    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    /// Read-only accessor for the `is_socket` flag (used by
    /// `ShellSubprocess::spawn` to decide `no_sigpipe`).
    #[inline]
    #[cfg(not(windows))]
    pub(crate) fn is_socket(&self) -> bool {
        self.flags.get().is_socket
    }

    pub(crate) fn init(fd: Fd, flags: Flags, evtloop: EventLoopHandle) -> RefPtr<IOWriter> {
        let mut writer = WriterImpl::default();
        // Tell the PipeWriter impl to *not* close the file descriptor.
        #[cfg(not(windows))]
        {
            writer.close_fd = false;
        }
        #[cfg(windows)]
        {
            writer.owns_fd = false;
        }
        let this = RefPtr::new_cyclic(|self_root| IOWriter {
            ref_count: Cell::new(1),
            self_root,
            writer: JsCell::new(writer),
            fd: Cell::new(fd),
            writers: JsRefCell::new(Writers::new()),
            buf: JsCell::new(Vec::new()),
            #[cfg(windows)]
            winbuf: JsCell::new(Vec::new()),
            writer_idx: Cell::new(0),
            total_bytes_written: Cell::new(0),
            err: JsRefCell::new(None),
            evtloop,
            is_writing: Cell::new(false),
            started: Cell::new(false),
            flags: Cell::new(flags),
            interp: Cell::new(None),
        });
        let parent: *mut IOWriter = this.as_ptr();
        this.writer.with_mut(|w| w.set_parent(parent));
        crate::shell_log!("IOWriter(0x{:x}, fd={}) init", parent as usize, fd);
        this
    }

    /// Stash the interpreter backref so async poll callbacks can drive
    /// `Yield::run`. `interp` owns (through its IO structs) every handle to
    /// this writer. Idempotent.
    #[inline]
    pub(crate) fn set_interp(&self, interp: &Interpreter) {
        self.interp.set(Some(bun_ptr::ParentRef::new(interp)));
    }

    #[inline]
    pub(crate) fn fd(&self) -> Fd {
        self.fd.get()
    }

    #[inline]
    #[cfg(windows)]
    pub(crate) fn evtloop(&self) -> EventLoopHandle {
        self.evtloop
    }

    pub(crate) fn memory_cost(&self) -> usize {
        let mut cost = core::mem::size_of::<IOWriter>();
        cost += self.buf.get().capacity();
        #[cfg(windows)]
        {
            cost += self.winbuf.get().capacity();
        }
        cost += self.writers.borrow().capacity() * core::mem::size_of::<Writer>();
        cost += self.writer.get().memory_cost();
        cost
    }

    /// `bun_io::EventLoopHandle` is an opaque `*mut c_void` that the io-layer
    /// `FilePollVTable` round-trips back to the runtime. We pass the address of
    /// the stored `bun_event_loop::EventLoopHandle` so the (runtime-registered)
    /// vtable can recover it.
    #[cfg(not(windows))]
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        self.evtloop.as_event_loop_ctx()
    }

    // ── start ────────────────────────────────────────────────────────────

    fn __start(&self) -> sys::Result<()> {
        let fd = self.fd.get();
        crate::shell_log!("IOWriter(fd={}) __start()", fd);
        let pollable = self.flags.get().pollable;
        if let Err(e) = self.writer.with_mut(|w| w.start(fd, pollable)) {
            #[cfg(not(windows))]
            {
                // We get this if we pass in a file descriptor that is not
                // pollable, for example a special character device like
                // /dev/null. If so, restart with polling disabled.
                //
                // It's also possible on Linux for EINVAL to be returned
                // when registering multiple writable/readable polls for the
                // same file descriptor. The shell code here makes sure to
                // _not_ run into that case, but it is possible.
                if e.get_errno() == E::EINVAL {
                    crate::shell_log!("IOWriter(fd={}) got EINVAL", fd);
                    self.disable_polling();
                    return self.__start();
                }
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    // On linux regular files are not pollable and return EPERM,
                    // so restart if that's the case with polling disabled.
                    if e.get_errno() == E::EPERM {
                        self.disable_polling();
                        return self.__start();
                    }
                }
            }
            #[cfg(windows)]
            {
                // This might happen if the file descriptor points to NUL.
                // On Windows GetFileType(NUL) returns FILE_TYPE_CHAR, so
                // `this.writer.start()` will try to open it as a tty with
                // uv_tty_init, but this returns EBADF. As a workaround,
                // we'll try opening the file descriptor as a file.
                if e.get_errno() == E::EBADF {
                    self.update_flags(|f| {
                        f.pollable = false;
                        f.nonblock = false;
                        f.is_socket = false;
                    });
                    return self.writer.with_mut(|w| w.start_with_file(fd));
                }
            }
            return Err(e);
        }
        #[cfg(windows)]
        {
            // When `Source::open` produced a uv pipe/tty, libuv has TAKEN
            // OWNERSHIP of the underlying HANDLE
            // (`uv_pipe_open`/`uv_tty_init`) and `uv_close` (issued by
            // `writer.close()` in Drop) will close it.
            // `BaseWindowsPipeWriter::start` does not invalidate the stored
            // fd (TODO at PipeWriter.rs:1277), so disarm the Drop close here
            // instead. The `Source::File`/`SyncFile` case (incl. the
            // EBADF→`start_with_file` fallback above, which `return`s early)
            // keeps `fd` valid: with `owns_fd=false` PipeWriter does NOT
            // close it there, so Drop must.
            if matches!(
                self.writer.get().source,
                Some(bun_io::Source::Pipe(_) | bun_io::Source::Tty(_))
            ) {
                self.fd.set(Fd::INVALID);
            }
        }
        #[cfg(not(windows))]
        {
            use bun_io::FilePollFlag;
            let flags = self.flags.get();
            self.writer.with_mut(|w| {
                if let Some(poll) = w.get_poll() {
                    if flags.nonblock {
                        poll.set_flag(FilePollFlag::Nonblocking);
                    }
                    // On macOS `sendto` with MSG_DONTWAIT can still block, so
                    // only mark as socket there if the fd is already O_NONBLOCK.
                    let sendto_msg_nowait_blocks = cfg!(target_os = "macos");
                    if flags.is_socket && (!sendto_msg_nowait_blocks || flags.nonblock) {
                        poll.set_flag(FilePollFlag::Socket);
                    } else if flags.pollable {
                        poll.set_flag(FilePollFlag::Fifo);
                    }
                }
            });
        }
        Ok(())
    }

    /// EINVAL/EPERM fallback: this fd cannot be polled, so drop the poll (if
    /// one was registered) and continue on the synchronous file path.
    #[cfg(not(windows))]
    fn disable_polling(&self) {
        self.update_flags(|f| {
            f.pollable = false;
            f.nonblock = false;
            f.is_socket = false;
        });
        self.writer.with_mut(|w| {
            if matches!(w.handle, bun_io::pipes::PollOrFd::Poll(_)) {
                w.handle.close_impl(None, None::<fn(*mut c_void)>, false);
            }
            w.handle = bun_io::pipes::PollOrFd::Closed;
        });
    }

    /// Idempotent write call.
    ///
    /// Failures are *returned* (`WriteOutcome::Failed`), never dispatched from
    /// here: the caller sits inside the enqueuing child's trampoline, so the
    /// error completion has to bounce off it (`on_sync_error`) instead of
    /// re-entering `Yield::run` (see `DbgDepthGuard`).
    fn write(&self) -> WriteOutcome {
        #[cfg(not(windows))]
        debug_assert!(self.flags.get().pollable);

        if !self.started.get() {
            crate::shell_log!("IOWriter(fd={}) starting", self.fd.get());
            // Set before the fallible `__start` so a later enqueue does not
            // retry it.
            self.started.set(true);
            if let Err(e) = self.__start() {
                return WriteOutcome::Failed(e);
            }
            #[cfg(not(windows))]
            {
                // if `handle == .fd` it means it's a file which does not
                // support polling for writeability and we should just write to it
                if matches!(self.writer.get().handle, bun_io::pipes::PollOrFd::Fd(_)) {
                    debug_assert!(!self.flags.get().pollable);
                    return WriteOutcome::IsActuallyFile;
                }
                return WriteOutcome::Suspended;
            }
            #[cfg(windows)]
            return WriteOutcome::Suspended;
        }

        #[cfg(windows)]
        {
            crate::shell_log!(
                "IOWriter(fd={}) write() is_writing={}",
                self.fd.get(),
                self.is_writing.get()
            );
            if self.is_writing.get() {
                return WriteOutcome::Suspended;
            }
            self.is_writing.set(true);
            if let Err(e) = self.writer.with_mut(|w| w.start_with_current_pipe()) {
                return WriteOutcome::Failed(e);
            }
            return WriteOutcome::Suspended;
        }

        #[cfg(not(windows))]
        {
            debug_assert!(matches!(
                self.writer.get().handle,
                bun_io::pipes::PollOrFd::Poll(_)
            ));
            // `is_watching()` = `is_registered() && !needs_rearm`.
            // NOT `is_registered()`: after a one-shot fire that drains
            // everything (no `register_poll()`), `PollWritable` stays set
            // but `NeedsRearm` is set → `is_registered()` would return
            // Suspended without re-arming and stall the queue forever.
            let watching = self
                .writer
                .with_mut(|w| w.get_poll().is_some_and(|poll| poll.is_watching()));
            if watching {
                return WriteOutcome::Suspended;
            }
            let (fd, pollable) = (self.fd.get(), self.flags.get().pollable);
            if let Err(e) = self.writer.with_mut(|w| w.start(fd, pollable)) {
                return WriteOutcome::Failed(e);
            }
            WriteOutcome::Suspended
        }
    }

    // ── queue management ────────────────────────────────────────────────

    /// Cancel the chunks enqueued by the given child by marking them as dead.
    pub(crate) fn cancel_chunks(&self, ptr: ChildPtr) {
        let mut writers = self.writers.borrow_mut();
        if writers.is_empty() {
            return;
        }
        let idx = self.writer_idx.get();
        if idx >= writers.len() {
            return;
        }
        for w in &mut writers[idx..] {
            if w.ptr == ptr {
                w.set_dead();
            }
        }
    }

    /// Skips over dead children and increments `total_bytes_written` by the
    /// amount they would have written so the buf is skipped as well.
    fn skip_dead(&self) {
        let writers = self.writers.borrow();
        while self.writer_idx.get() < writers.len() {
            let w = &writers[self.writer_idx.get()];
            if w.is_dead() {
                self.total_bytes_written
                    .set(self.total_bytes_written.get() + (w.len - w.written));
                self.writer_idx.set(self.writer_idx.get() + 1);
                continue;
            }
            return;
        }
    }

    fn wrote_everything(&self) -> bool {
        self.total_bytes_written.get() >= self.buf.get().len()
    }

    /// Only does things on windows.
    #[inline]
    fn set_writing(&self, writing: bool) {
        #[cfg(windows)]
        {
            self.is_writing.set(writing);
        }
        let _ = writing;
    }

    // ── buffer slicing ──────────────────────────────────────────────────

    /// Returns the buffer of data that needs to be written for the *current*
    /// writer.
    fn get_buffer(&self) -> &[u8] {
        let result = self.get_buffer_impl();
        #[cfg(windows)]
        {
            self.winbuf.with_mut(|winbuf| {
                winbuf.clear();
                winbuf.extend_from_slice(result);
            });
            return self.winbuf.get().as_slice();
        }
        #[cfg(not(windows))]
        result
    }

    fn get_buffer_impl(&self) -> &[u8] {
        let current_is_dead = {
            let writers = self.writers.borrow();
            match writers.get(self.writer_idx.get()) {
                None => return &[],
                Some(w) => w.is_dead(),
            }
        };
        if current_is_dead {
            self.skip_dead();
        }
        let writers = self.writers.borrow();
        let idx = self.writer_idx.get();
        if idx >= writers.len() {
            return &[];
        }
        let remaining = {
            let writer = &writers[idx];
            debug_assert!(writer.len != writer.written);
            writer.len - writer.written
        };
        // `buf` is not reallocated until after the caller's write syscall
        // completes.
        let start = self.total_bytes_written.get();
        &self.buf.get()[start..start + remaining]
    }

    // ── bump (chunk completed) ──────────────────────────────────────────

    /// Advance past `current_writer`, shrinking `buf` if appropriate, and
    /// return the `Yield` for the child's `on_io_writer_chunk` callback.
    fn bump(&self, current_idx: usize) -> Yield {
        let (is_dead, written, len, child_ptr) = {
            let writers = self.writers.borrow();
            let w = &writers[current_idx];
            (w.is_dead(), w.written, w.len, w.ptr)
        };

        if is_dead {
            self.skip_dead();
        } else {
            debug_assert!(written == len);
            self.writer_idx.set(self.writer_idx.get() + 1);
        }

        {
            let mut writers = self.writers.borrow_mut();
            if self.writer_idx.get() >= writers.len() {
                self.buf.with_mut(|b| b.clear());
                self.writer_idx.set(0);
                writers.clear();
                self.total_bytes_written.set(0);
            } else if self.total_bytes_written.get() >= SHRINK_THRESHOLD {
                let total = self.total_bytes_written.get();
                self.buf.with_mut(|b| b.drain_front(total));
                self.total_bytes_written.set(0);
                // Drop the *prefix* of the writers queue: Vec::drain(..idx).
                writers.drain(..self.writer_idx.get());
                self.writer_idx.set(0);
                if cfg!(debug_assertions) && !writers.is_empty() {
                    debug_assert!(self.buf.get().len() >= writers[0].len);
                }
            }
        }

        if !is_dead {
            return Yield::OnIoWriterChunk {
                child: child_ptr,
                written,
                err: None,
            };
        }
        Yield::done()
    }

    // ── file write (non-pollable sync path) ─────────────────────────────

    /// Tee `amt` bytes from the current buffer position into `writers[idx]`'s
    /// capture and advance its `written` / `total_bytes_written` counters.
    fn record_write_progress(&self, idx: usize, amt: usize) {
        let mut writers = self.writers.borrow_mut();
        let lo = self.total_bytes_written.get();
        writers[idx].tee(&self.buf.get()[lo..lo + amt]);
        self.total_bytes_written.set(lo + amt);
        writers[idx].written += amt;
    }

    /// POSIX-only. `child` is the writer being enqueued (see `on_sync_error`).
    #[cfg(not(windows))]
    fn do_file_write(&self, child: ChildPtr) -> Yield {
        debug_assert!(!self.flags.get().pollable);
        debug_assert!(self.writer_idx.get() < self.writers.borrow().len());

        scopeguard::defer! { self.set_writing(false); }
        self.skip_dead();

        let idx = self.writer_idx.get();
        debug_assert!(!self.writers.borrow()[idx].is_dead());

        let buf = self.get_buffer();
        debug_assert!(!buf.is_empty());

        let result = drain_buffered_data(self, buf, u32::MAX as usize);
        let amt = match result {
            bun_io::WriteResult::Done(amt) | bun_io::WriteResult::Wrote(amt) => amt,
            bun_io::WriteResult::Pending(amt) => {
                // EAGAIN from a target that was classified non-pollable (a
                // FIFO or chardev opened by path with O_NONBLOCK). Record the
                // partial write and restart this writer on the pollable path.
                self.record_write_progress(idx, amt);
                self.update_flags(|f| {
                    f.pollable = true;
                    f.nonblock = true;
                });
                self.started.set(false);
                return match self.write() {
                    WriteOutcome::Suspended => Yield::suspended(),
                    WriteOutcome::IsActuallyFile => self
                        .on_sync_error(child, &sys::Error::from_code(E::EAGAIN, sys::Tag::write)),
                    WriteOutcome::Failed(e) => self.on_sync_error(child, &e),
                };
            }
            // The caller is inside the enqueuing child's trampoline, so the
            // error completion is returned, not `Yield::run` from here.
            bun_io::WriteResult::Err(e) => return self.on_sync_error(child, &e),
        };
        self.record_write_progress(idx, amt);
        if !self.writers.borrow()[idx].wrote_everything() {
            // The only case where we get partial writes is when an error is
            // encountered, which returns above.
            unreachable!(
                "IOWriter.doFileWrite: child.wroteEverything() is false. This is unexpected behavior and indicates a bug in Bun. Please file a GitHub issue."
            );
        }
        self.bump(idx)
    }

    // ── poll callback ───────────────────────────────────────────────────

    /// The `BufferedWriter.onWrite` hook. Runs on the event loop when the fd
    /// is writable.
    fn on_write_pollable(this: ThisPtr<Self>, amount: usize, status: bun_io::WriteStatus) {
        let _keepalive = RefPtr::from_this(this);
        let me: &Self = &this;
        me.on_write_pollable_impl(amount, status);
    }

    fn on_write_pollable_impl(&self, amount: usize, status: bun_io::WriteStatus) {
        self.set_writing(false);
        #[cfg(not(windows))]
        debug_assert!(self.flags.get().pollable);

        let idx = self.writer_idx.get();
        let (is_dead, queue_len) = {
            let writers = self.writers.borrow();
            if idx >= writers.len() {
                return;
            }
            (writers[idx].is_dead(), writers.len())
        };
        if is_dead {
            self.run_yield(self.bump(idx));
        } else {
            self.record_write_progress(idx, amount);
            let (written, len) = {
                let writers = self.writers.borrow();
                (writers[idx].written, writers[idx].len)
            };
            if status == bun_io::WriteStatus::EndOfFile {
                let last = idx == queue_len.saturating_sub(1);
                let not_fully_written = if last { true } else { written < len };
                if !not_fully_written {
                    return;
                }
                // Other end of the socket/pipe closed and we got EPIPE
                // (e.g. `ls | echo`). Quick hack: have all writers see an
                // error.
                self.update_flags(|f| f.broken_pipe = true);
                self.broken_pipe_for_writers();
                return;
            }
            if written >= len {
                self.run_yield(self.bump(idx));
            }
        }

        let wrote_everything = self.wrote_everything();
        if !wrote_everything && self.writer_idx.get() < self.writers.borrow().len() {
            #[cfg(windows)]
            {
                self.is_writing.set(true);
                self.writer.with_mut(|w| w.write());
            }
            #[cfg(not(windows))]
            {
                debug_assert!(matches!(
                    self.writer.get().handle,
                    bun_io::pipes::PollOrFd::Poll(_)
                ));
                self.writer.with_mut(|w| w.register_poll());
            }
        }
    }

    fn broken_pipe_for_writers(&self) {
        debug_assert!(self.flags.get().broken_pipe);
        // Collect targets first so `writers` is not borrowed across
        // `cancel_chunks`/`run_yield`.
        let mut targets: Vec<ChildPtr> = Vec::new();
        for w in &self.writers.borrow()[self.writer_idx.get()..] {
            if w.is_dead() {
                continue;
            }
            if !targets.contains(&w.ptr) {
                targets.push(w.ptr);
            }
        }
        for ptr in targets {
            let err = sys::Error::from_code(E::EPIPE, sys::Tag::write).to_system_error();
            self.run_yield(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(err),
            });
            self.cancel_chunks(ptr);
        }
        self.total_bytes_written.set(0);
        self.writers.borrow_mut().clear();
        self.buf.with_mut(|b| b.clear());
        self.writer_idx.set(0);
    }

    /// Shared failure bookkeeping: mark broken pipes, reset the queue, and
    /// return the still-pending children that have to be told their chunk
    /// failed. The queue is reset *before* any of them runs so that a child
    /// re-enqueueing from its callback is not wiped afterwards.
    fn fail_pending_writers(&self, err: &sys::Error) -> Vec<ChildPtr> {
        self.set_writing(false);
        if err.get_errno() == E::EPIPE {
            self.update_flags(|f| f.broken_pipe = true);
        }
        // Mark the writer dead before any completion below runs: a child that
        // enqueues from its callback (the next statement, the RHS of `&&`, ...)
        // must be rejected by `handle_dead_writer`, not queued onto a writer
        // whose handle the error path is tearing down.
        *self.err.borrow_mut() = Some(err.clone());
        // Writers before writer_idx have already had their callback fired and
        // may have been freed; only notify the still-pending ones, dedup'd.
        let mut pending: Vec<ChildPtr> = Vec::new();
        let mut writers = self.writers.borrow_mut();
        for w in &writers[self.writer_idx.get()..] {
            if !w.is_dead() && !pending.contains(&w.ptr) {
                pending.push(w.ptr);
            }
        }
        self.total_bytes_written.set(0);
        self.writer_idx.set(0);
        self.buf.with_mut(|b| b.clear());
        writers.clear();
        pending
    }

    /// Write failure reported by the `bun_io` writer callbacks. Each pending
    /// child's error completion is driven through its own `Yield::run`; on
    /// POSIX these callbacks only fire from the event loop, with no trampoline
    /// on the stack. On Windows uv can also report one from under the
    /// submitting call (`start_with_current_pipe` returns `Ok` regardless), so
    /// the enqueuing child may be called back from inside its own `enqueue`;
    /// callers therefore hold no node borrow across `enqueue`.
    fn on_error(this: ThisPtr<Self>, err: &sys::Error) {
        let _keepalive = RefPtr::from_this(this);
        let me: &Self = &this;
        me.on_error_impl(err);
    }

    fn on_error_impl(&self, err: &sys::Error) {
        for ptr in self.fail_pending_writers(err) {
            // `SystemError` owns `bun_core::String`s by value (no shared
            // refcount yet), so re-derive a fresh one per callee instead of
            // cloning the stored error.
            let ee = err.to_shell_system_error();
            self.run_yield(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(ee),
            });
        }
    }

    /// Synchronous write failure while `child`'s `enqueue` call (and therefore
    /// its trampoline) is still on the stack. `child`'s error completion is
    /// *returned* so that trampoline delivers it after `enqueue` unwinds;
    /// calling `on_error` here instead would re-enter `Yield::run` once per
    /// failing command and fire `child`'s callback from inside its own
    /// `enqueue`. Usually `child`'s chunk is the only pending one (a
    /// synchronous failure is the first write attempt of a batch); if a poll
    /// re-registration fails while other children are still queued, those are
    /// dispatched the way the async path dispatches them.
    fn on_sync_error(&self, child: ChildPtr, err: &sys::Error) -> Yield {
        let _keepalive = RefPtr::from_this(self.this_ptr());
        let mut completion = None;
        for ptr in self.fail_pending_writers(err) {
            // `SystemError` owns `bun_core::String`s by value (no shared
            // refcount yet), so re-derive a fresh one per callee.
            let y = Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(err.to_shell_system_error()),
            };
            if completion.is_none() && ptr == child {
                completion = Some(y);
            } else {
                self.run_yield(y);
            }
        }
        // The writer `enqueue` just pushed for `child` is live and at or past
        // `writer_idx`, so it is always in the pending list.
        debug_assert!(completion.is_some());
        completion.unwrap_or_else(Yield::done)
    }

    fn on_close(this: ThisPtr<Self>) {
        this.set_writing(false);
    }

    /// Drive a `Yield` from inside an async poll callback. Requires `interp`
    /// to have been set; if not, the chunk-complete is dropped (debug-asserts).
    fn run_yield(&self, y: Yield) {
        let Some(interp) = self.interp.get() else {
            debug_assert!(
                matches!(y, Yield::Done),
                "IOWriter async callback fired without interp backref"
            );
            return;
        };
        // The interpreter owns the IO structs that hold this writer and
        // outlives it. Single-threaded.
        y.run(&interp);
    }

    // ── enqueue ─────────────────────────────────────────────────────────

    /// A writer that already reported a fatal error must not accept new
    /// chunks: `PosixBufferedWriter::_on_error` closes the handle after
    /// `on_error` returns, so a chunk queued from inside the completion
    /// callbacks (or any later one) would wait on a poll that is being torn
    /// down, and a later `write()` would run with `handle == Closed` (the
    /// pollable path asserts `handle == Poll`). Broken pipes are the EPIPE
    /// flavor of the same thing. Report the error to the child instead of
    /// queueing the chunk.
    fn handle_dead_writer(&self, ptr: ChildPtr) -> Option<Yield> {
        if self.flags.get().broken_pipe {
            let err = sys::Error::from_code(E::EPIPE, sys::Tag::write).to_system_error();
            return Some(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(err),
            });
        }
        if let Some(err) = &*self.err.borrow() {
            return Some(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                // `SystemError` owns its `bun_core::String`s by value, so
                // derive a fresh one per rejected chunk (see `on_error`).
                err: Some(err.to_shell_system_error()),
            });
        }
        None
    }

    #[cfg(not(windows))]
    fn enqueue_file(&self, child: ChildPtr) -> Yield {
        if self.is_writing.get() {
            return Yield::suspended();
        }
        // The pollable path sets `started` in write(); the non-pollable file
        // path bypasses write() entirely, so set it here.
        self.started.set(true);
        self.set_writing(true);
        self.do_file_write(child)
    }

    /// You MUST have already added the data to `self.buf`!
    /// `child` is the writer that was just pushed (see `on_sync_error`).
    fn enqueue_internal(&self, child: ChildPtr) -> Yield {
        debug_assert!(!self.flags.get().broken_pipe);
        debug_assert!(self.err.borrow().is_none());
        #[cfg(not(windows))]
        if !self.flags.get().pollable {
            return self.enqueue_file(child);
        }
        match self.write() {
            WriteOutcome::Suspended => Yield::suspended(),
            #[cfg(not(windows))]
            WriteOutcome::IsActuallyFile => self.enqueue_file(child),
            WriteOutcome::Failed(e) => self.on_sync_error(child, &e),
        }
    }

    /// Queue `buf` for writing; when the chunk completes (or errors),
    /// `child`'s `on_io_writer_chunk` fires.
    pub(crate) fn enqueue(
        &self,
        child: ChildPtr,
        bytelist: Option<CapturedBuf>,
        buf: &[u8],
    ) -> Yield {
        if let Some(y) = self.handle_dead_writer(child) {
            return y;
        }
        if buf.is_empty() {
            return Yield::OnIoWriterChunk {
                child,
                written: 0,
                err: None,
            };
        }
        self.buf.with_mut(|b| b.extend_from_slice(buf));
        self.writers.borrow_mut().push(Writer {
            ptr: child,
            len: buf.len(),
            written: 0,
            bytelist,
        });
        self.enqueue_internal(child)
    }

    /// [`enqueue`](Self::enqueue) with the bytes produced by `fill`, which
    /// appends them straight into the write buffer (any borrow it needs ends
    /// with it, before the writer can call anyone back).
    pub(crate) fn enqueue_with(
        &self,
        child: ChildPtr,
        bytelist: Option<CapturedBuf>,
        fill: impl FnOnce(&mut Vec<u8>),
    ) -> Yield {
        if let Some(y) = self.handle_dead_writer(child) {
            return y;
        }
        let len = self.buf.with_mut(|b| {
            let start = b.len();
            fill(b);
            b.len() - start
        });
        if len == 0 {
            return Yield::OnIoWriterChunk {
                child,
                written: 0,
                err: None,
            };
        }
        self.writers.borrow_mut().push(Writer {
            ptr: child,
            len,
            written: 0,
            bytelist,
        });
        self.enqueue_internal(child)
    }

    /// Prefix `"{kind}: "` then format.
    pub(crate) fn enqueue_fmt_bltn(
        &self,
        child: ChildPtr,
        bytelist: Option<CapturedBuf>,
        kind: Option<crate::shell::builtin::Kind>,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        use std::io::Write as _;
        let (start, end) = self.buf.with_mut(|buf| {
            let start = buf.len();
            if let Some(k) = kind {
                let _ = write!(buf, "{}: ", k.as_str());
            }
            let _ = buf.write_fmt(args);
            (start, buf.len())
        });
        // `buf` is written *before* the dead-writer checks (the bytes are dead
        // on the error path but no `Writer` references them, and an errored
        // writer never drains again).
        if let Some(y) = self.handle_dead_writer(child) {
            return y;
        }
        self.writers.borrow_mut().push(Writer {
            ptr: child,
            len: end - start,
            written: 0,
            bytelist,
        });
        self.enqueue_internal(child)
    }
}

enum WriteOutcome {
    Suspended,
    /// The write/poll-registration failed synchronously; the caller turns this
    /// into the enqueuing child's error completion (`on_sync_error`).
    Failed(sys::Error),
    #[cfg(not(windows))]
    IsActuallyFile,
}

// ──────────────────────────────────────────────────────────────────────────
// BufferedWriter parent vtable — wires bun_io callbacks to inherent methods
// ──────────────────────────────────────────────────────────────────────────

bun_io::impl_buffered_writer_parent! {
    IOWriter;
    poll_tag   = bun_io::posix_event_loop::poll_tag::SHELL_BUFFERED_WRITER,
    // Child callbacks may re-enter `enqueue(&self)` and drop holder refs, so
    // every hook gets a `ThisPtr` and takes a ref guard first.
    borrow     = this,
    on_write   = on_write_pollable,
    on_error   = on_error,
    on_close   = on_close,
    get_buffer = |this| this.get_buffer(),
    event_loop = |this| this.io_evtloop(),
    uv_loop    = |this| this.evtloop().uv_loop(),
}

// ──────────────────────────────────────────────────────────────────────────
// drainBufferedData / tryWrite (POSIX file path)
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
fn try_write_with_write_fn(
    fd: Fd,
    buf: &[u8],
    write_fn: fn(Fd, &[u8]) -> sys::Maybe<usize>,
) -> bun_io::WriteResult {
    let mut offset: usize = 0;
    while offset < buf.len() {
        match write_fn(fd, &buf[offset..]) {
            Err(err) => {
                if err.is_retry() {
                    return bun_io::WriteResult::Pending(offset);
                }
                // Return EPIPE as an error so it propagates properly.
                return bun_io::WriteResult::Err(err);
            }
            Ok(wrote) => {
                offset += wrote;
                if wrote == 0 {
                    return bun_io::WriteResult::Done(offset);
                }
            }
        }
    }
    bun_io::WriteResult::Wrote(offset)
}

/// TODO: This function and `try_write_with_write_fn` are copy-pastes from
/// PipeWriter; it would be nice to not have to do that.
#[cfg(not(windows))]
fn drain_buffered_data(
    parent: &IOWriter,
    buf: &[u8],
    max_write_size: usize,
) -> bun_io::WriteResult {
    let trimmed = if max_write_size < buf.len() && max_write_size > 0 {
        &buf[..max_write_size]
    } else {
        buf
    };
    let mut drained: usize = 0;
    while drained < trimmed.len() {
        match try_write_with_write_fn(parent.fd(), buf, sys::write) {
            bun_io::WriteResult::Pending(pending) => {
                drained += pending;
                return bun_io::WriteResult::Pending(drained);
            }
            bun_io::WriteResult::Wrote(amt) => {
                drained += amt;
            }
            bun_io::WriteResult::Err(err) => {
                // Reported as an error even after a partial write: the caller
                // (`do_file_write`) fails the whole chunk either way, and it
                // must not dispatch the failure from under the trampoline.
                return bun_io::WriteResult::Err(err);
            }
            bun_io::WriteResult::Done(amt) => {
                drained += amt;
                return bun_io::WriteResult::Done(drained);
            }
        }
    }
    bun_io::WriteResult::Wrote(drained)
}

// ──────────────────────────────────────────────────────────────────────────
// Drop
// ──────────────────────────────────────────────────────────────────────────

impl Drop for IOWriter {
    fn drop(&mut self) {
        // With `Rc` the last ref drops *after* the callback returns, so the
        // synchronous path is safe (PipeWriter cannot touch us after free).
        // TODO: if a PipeWriter callback is on the stack when the last
        // ref drops (possible via re-entrant child deinit), we need the async
        // hop. Revisit once `bun_event_loop::EventLoopTask` is wired to the
        // shell's `EventLoopHandle` shim.
        let fd = self.fd.get();
        crate::shell_log!("IOWriter(fd={}) deinit", fd);
        let evtloop = self.evtloop;
        self.writer.with_mut(|w| {
            #[cfg(not(windows))]
            {
                if matches!(w.handle, bun_io::pipes::PollOrFd::Poll(_)) {
                    w.handle.close_impl(None, None::<fn(*mut c_void)>, false);
                }
            }
            #[cfg(windows)]
            {
                w.close();
            }
            if fd != Fd::INVALID {
                let _ = sys::close(fd);
            }
            w.disable_keeping_process_alive(evtloop.as_event_loop_ctx());
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Hoisted dispatch for `onIOWriterChunk`
// ──────────────────────────────────────────────────────────────────────────

/// Hoisted dispatch for the `onIOWriterChunk` callback (PORTING.md §Dispatch
/// hot-path). Called by `Yield::OnIoWriterChunk` and by the writer's poll
/// callback.
pub(crate) fn on_io_writer_chunk(
    interp: &Interpreter,
    child: ChildPtr,
    written: usize,
    err: Option<sys::SystemError>,
) -> Yield {
    use crate::shell::builtin::Builtin;
    use crate::shell::states::{cmd, cond_expr, pipeline};
    match child.tag {
        WriterTag::Builtin => {
            Builtin::on_io_writer_chunk(interp, child.node, child.seq, written, err)
        }
        WriterTag::Cmd => cmd::Cmd::on_io_writer_chunk(interp, child.node, written, err),
        WriterTag::CondExpr => {
            cond_expr::CondExpr::on_io_writer_chunk(interp, child.node, written, err)
        }
        WriterTag::Pipeline => {
            pipeline::Pipeline::on_io_writer_chunk(interp, child.node, written, err)
        }
        // The target is the subprocess PipeReader's captured-output tee; it
        // lives outside the NodeId arena (heap-allocated PipeReader), so it
        // is carried in `child.subproc` instead of `child.node`.
        WriterTag::Subproc => {
            let _ = interp;
            let pipe = child
                .subproc
                .expect("WriterTag::Subproc carries its PipeReader");
            PipeReader::on_captured_iowriter_chunk(pipe.this_ptr(), written, err)
        }
    }
}
