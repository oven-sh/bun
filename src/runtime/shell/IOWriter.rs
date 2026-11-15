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
//! It never calls its children: methods return the `Yield` to run next.

use bun_collections::VecExt;
use core::cell::Cell;
use core::marker::PhantomData;
#[cfg(windows)]
use core::mem::ManuallyDrop;

use bun_io::{
    BufferedWriteHandler, BufferedWriter, IoEvent, Owner, PollTag, WriteHandler, WriteStatus,
};
#[cfg(windows)]
use bun_ptr::AliasableBox;
use bun_sys::{self as sys, E, Fd};

use crate::shell::builtin::IoKind;
use crate::shell::interpreter::{BufioId, EventLoopHandle, Interpreter, NodeId, ShellExecEnvs};
use crate::shell::yield_::Yield;

// ──────────────────────────────────────────────────────────────────────────
// ChildPtr
// ──────────────────────────────────────────────────────────────────────────

/// In the NodeId-arena port, a "writer child" is `(NodeId, WriterTag)` — the
/// id of the owning state node plus a tag saying which `on_io_writer_chunk`
/// impl to dispatch to.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct ChildPtr {
    pub node: NodeId,
    pub(crate) tag: WriterTag,
}

impl ChildPtr {
    const NULL: ChildPtr = ChildPtr::new(NodeId::NONE, WriterTag::Cmd);

    #[inline]
    pub(crate) const fn new(node: NodeId, tag: WriterTag) -> ChildPtr {
        ChildPtr { node, tag }
    }

    #[inline]
    fn is_null(self) -> bool {
        self.node == NodeId::NONE
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum WriterTag {
    /// Builtin running inside a Cmd — dispatch via `Builtin::on_io_writer_chunk`.
    Builtin,
    Cmd,
    CondExpr,
    Pipeline,
    /// `subproc::CapturedWriter` of the Cmd's stdout or stderr `PipeReader`.
    Subproc(IoKind),
}

// ──────────────────────────────────────────────────────────────────────────
// Flags / Writer queue entry
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Default)]
pub(crate) struct Flags {
    pub(crate) pollable: bool,
    pub(crate) nonblock: bool,
    pub(crate) is_socket: bool,
    pub(crate) broken_pipe: bool,
}

/// One queued chunk: which child enqueued it, how many bytes (in `buf`), how
/// many of those have been written so far, and an optional `Vec<u8>` to tee
/// into.
struct Writer {
    ptr: ChildPtr,
    len: usize,
    written: usize,
    captured: Option<BufioId>,
}

impl Writer {
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
    fn tee(&self, shells: &mut ShellExecEnvs<'_>, chunk: &[u8]) {
        if let Some(captured) = self.captured {
            shells.captured_mut(captured).append_slice(chunk);
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

pub(crate) type IOWriterId = bun_core::GenericIndex<u32, IOWriter<'static>>;

pub(crate) struct IOWriter<'a> {
    #[cfg(not(windows))]
    writer: BufferedWriter,
    /// libuv holds its address, and a write in flight keeps it past the drop.
    #[cfg(windows)]
    writer: ManuallyDrop<AliasableBox<BufferedWriter>>,
    id: IOWriterId,
    fd: Fd,
    writers: Writers,
    buf: Vec<u8>,
    writer_idx: usize,
    total_bytes_written: usize,
    /// Set (and never cleared) by `fail_pending_writers`. A writer with a
    /// stored error is dead: `enqueue`/`enqueue_fmt_bltn` must reject new
    /// chunks with this error instead of queueing them (see
    /// `handle_dead_writer`). The syscall error is kept (not the derived
    /// `SystemError`) so each rejected chunk gets its own freshly-derived
    /// `SystemError`.
    err: Option<sys::Error>,
    evtloop: EventLoopHandle,
    #[cfg(windows)]
    is_writing: bool,
    started: bool,
    flags: Flags,
    /// Keeps it inside its `Interpreter<'a>`.
    _interp: PhantomData<&'a ()>,
}

impl IOWriter<'_> {
    /// Read-only accessor for the `is_socket` flag (used by
    /// `ShellSubprocess::spawn` to decide `no_sigpipe`).
    #[inline]
    #[cfg(not(windows))]
    pub(crate) fn is_socket(&self) -> bool {
        self.flags.is_socket
    }

    /// The caller removes it from `interp.io_writers`, which closes `fd`.
    pub(crate) fn init(interp: &mut Interpreter<'_>, fd: Fd, flags: Flags) -> IOWriterId {
        let (shell_interp, evtloop) = (interp.as_ctx_ptr(), interp.event_loop);
        interp.io_writers.insert_with(|id| {
            // `Drop` closes the file descriptor.
            let writer = BufferedWriter::borrowing_fd();
            #[cfg(windows)]
            let writer = ManuallyDrop::new(AliasableBox::new(writer));
            let ptr = shell_interp.as_ptr().cast();
            let owner = Owner::with_key(PollTag::ShellIoWriter, id.get(), ptr);
            // SAFETY: `shell_interp` owns `interp`, which owns the writer. On Windows the box keeps it in
            // place and is never borrowed mutably.
            unsafe { writer.set_owner(owner) };
            crate::shell_log!("IOWriter({}, fd={}) init", id, fd);
            IOWriter {
                writer,
                id,
                fd,
                writers: Writers::new(),
                buf: Vec::new(),
                writer_idx: 0,
                total_bytes_written: 0,
                err: None,
                evtloop,
                #[cfg(windows)]
                is_writing: false,
                started: false,
                flags,
                _interp: PhantomData,
            }
        })
    }

    #[inline]
    pub(crate) fn fd(&self) -> Fd {
        self.fd
    }

    pub(crate) fn memory_cost(&self) -> usize {
        let mut cost = core::mem::size_of::<IOWriter>();
        cost += self.buf.capacity();
        cost += self.writers.capacity() * core::mem::size_of::<Writer>();
        cost += self.writer.memory_cost();
        cost
    }

    /// `bun_io::EventLoopHandle` is an opaque `*mut c_void` that the io-layer
    /// `FilePollVTable` round-trips back to the runtime. We pass the address of
    /// the stored `bun_event_loop::EventLoopHandle` so the (runtime-registered)
    /// vtable can recover it.
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        // SAFETY: `bun_io::EventLoopHandle` stores `*mut c_void` purely for
        // type-erasure; vtable consumers treat the pointee as read-only
        self.evtloop.as_event_loop_ctx()
    }

    // ── start ────────────────────────────────────────────────────────────

    fn __start(&mut self) -> sys::Result<()> {
        crate::shell_log!("IOWriter(fd={}) __start()", self.fd);
        // An empty buffer, because Windows writes from `start`.
        let handler = Handler::default();
        let started =
            (self.writer).start(&handler, self.io_evtloop(), self.fd, self.flags.pollable);
        if let Err(e) = started {
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
                    crate::shell_log!("IOWriter(fd={}) got EINVAL", self.fd);
                    self.flags.pollable = false;
                    self.flags.nonblock = false;
                    self.flags.is_socket = false;
                    return self.__start();
                }
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    // On linux regular files are not pollable and return EPERM,
                    // so restart if that's the case with polling disabled.
                    if e.get_errno() == E::EPERM {
                        self.flags.pollable = false;
                        self.flags.nonblock = false;
                        self.flags.is_socket = false;
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
                    self.flags.pollable = false;
                    self.flags.nonblock = false;
                    self.flags.is_socket = false;
                    (self.writer).start_with_file(&handler, self.io_evtloop(), self.fd);
                    return Ok(());
                }
            }
            return Err(e);
        }
        #[cfg(windows)]
        {
            // libuv closes the HANDLE of a pipe or a tty.
            if self.writer.is_stream() {
                self.fd = Fd::INVALID;
            }
        }
        #[cfg(not(windows))]
        {
            use bun_io::FilePollFlag;
            if self.flags.nonblock {
                self.writer.set_poll_flag(FilePollFlag::Nonblocking);
            }
            // On macOS `sendto` with MSG_DONTWAIT can still block, unless the fd is O_NONBLOCK.
            let sendto_msg_nowait_blocks = cfg!(target_os = "macos");
            if self.flags.is_socket && (!sendto_msg_nowait_blocks || self.flags.nonblock) {
                self.writer.set_poll_flag(FilePollFlag::Socket);
            } else if self.flags.pollable {
                self.writer.set_poll_flag(FilePollFlag::Fifo);
            }
        }
        Ok(())
    }

    /// Idempotent write call.
    fn write(&mut self) -> WriteOutcome {
        #[cfg(not(windows))]
        debug_assert!(self.flags.pollable);

        if !self.started {
            crate::shell_log!("IOWriter(fd={}) starting", self.fd);
            // Set before the fallible `__start` so a later enqueue does not
            // retry it.
            self.started = true;
            if let Err(e) = self.__start() {
                return WriteOutcome::Failed(e);
            }
            #[cfg(not(windows))]
            {
                // no poll means it's a file which does not
                // support polling for writeability and we should just write to it
                if !self.writer.has_poll() {
                    debug_assert!(!self.flags.pollable);
                    return WriteOutcome::IsActuallyFile;
                }
                return WriteOutcome::Suspended;
            }
        }

        #[cfg(windows)]
        {
            crate::shell_log!(
                "IOWriter(fd={}) write() is_writing={}",
                self.fd,
                self.is_writing
            );
            if self.is_writing {
                return WriteOutcome::Suspended;
            }
            self.skip_dead();
            let handler = Handler::new(self.get_buffer());
            self.writer.write(&handler);
            let err = handler.err.take();
            self.is_writing = handler.has_inflight_write.get();
            return err.map_or(WriteOutcome::Suspended, WriteOutcome::Failed);
        }

        #[cfg(not(windows))]
        {
            debug_assert!(self.writer.has_poll());
            // A one-shot poll that fired has to be re-armed.
            if self.writer.is_watching() {
                return WriteOutcome::Suspended;
            }
            let handler = Handler::default();
            let started =
                (self.writer).start(&handler, self.io_evtloop(), self.fd, self.flags.pollable);
            if let Err(e) = started {
                return WriteOutcome::Failed(e);
            }
            WriteOutcome::Suspended
        }
    }

    // ── queue management ────────────────────────────────────────────────

    /// Cancel the chunks enqueued by the given child by marking them as dead.
    pub(crate) fn cancel_chunks(&mut self, ptr: ChildPtr) {
        for w in &mut self.writers[self.writer_idx..] {
            if w.ptr == ptr {
                w.set_dead();
            }
        }
    }

    /// Skips over dead children and increments `total_bytes_written` by the
    /// amount they would have written so the buf is skipped as well.
    fn skip_dead(&mut self) {
        while let Some(w) = self.writers.get(self.writer_idx).filter(|w| w.is_dead()) {
            self.total_bytes_written += w.len - w.written;
            self.writer_idx += 1;
        }
    }

    fn wrote_everything(&self) -> bool {
        self.total_bytes_written >= self.buf.len()
    }

    fn clear(&mut self) {
        self.buf.clear();
        self.writer_idx = 0;
        self.writers.clear();
        self.total_bytes_written = 0;
    }

    // ── buffer slicing ──────────────────────────────────────────────────

    /// Returns the buffer of data that needs to be written for the *current*
    /// writer.
    fn get_buffer(&self) -> &[u8] {
        let Some(writer) = self.writers.get(self.writer_idx) else {
            return &[];
        };
        debug_assert!(writer.len != writer.written);
        let start = self.total_bytes_written;
        &self.buf[start..start + (writer.len - writer.written)]
    }

    // ── bump (chunk completed) ──────────────────────────────────────────

    /// Advance past `current_writer`, shrinking `buf` if appropriate, and
    /// return the `Yield` for the child's `on_io_writer_chunk` callback.
    fn bump(&mut self, current_idx: usize) -> Yield {
        let w = &self.writers[current_idx];
        let (is_dead, written, child_ptr) = (w.is_dead(), w.written, w.ptr);

        if is_dead {
            self.skip_dead();
        } else {
            debug_assert!(w.written == w.len);
            self.writer_idx += 1;
        }

        if self.writer_idx >= self.writers.len() {
            self.clear();
        } else if self.total_bytes_written >= SHRINK_THRESHOLD {
            self.buf.drain_front(self.total_bytes_written);
            self.total_bytes_written = 0;
            // Drop the *prefix* of the writers queue: Vec::drain(..idx).
            self.writers.drain(..self.writer_idx);
            self.writer_idx = 0;
            if cfg!(debug_assertions) && !self.writers.is_empty() {
                debug_assert!(self.buf.len() >= self.writers[0].len);
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
    fn record_write_progress(&mut self, shells: &mut ShellExecEnvs<'_>, idx: usize, amt: usize) {
        let lo = self.total_bytes_written;
        self.writers[idx].tee(shells, &self.buf[lo..lo + amt]);
        self.total_bytes_written += amt;
        self.writers[idx].written += amt;
    }

    /// POSIX-only.
    #[cfg(not(windows))]
    fn do_file_write(&mut self, shells: &mut ShellExecEnvs<'_>) -> Yield {
        debug_assert!(!self.flags.pollable);
        debug_assert!(self.writer_idx < self.writers.len());

        self.skip_dead();

        let idx = self.writer_idx;
        debug_assert!(!self.writers[idx].is_dead());

        let buf = self.get_buffer();
        debug_assert!(!buf.is_empty());

        let amt = match drain_buffered_data(self.fd, buf, u32::MAX as usize) {
            bun_io::WriteResult::Done(amt) | bun_io::WriteResult::Wrote(amt) => amt,
            bun_io::WriteResult::Pending(amt) => {
                // EAGAIN from a target that was classified non-pollable (a
                // FIFO or chardev opened by path with O_NONBLOCK). Record the
                // partial write and restart this writer on the pollable path.
                self.record_write_progress(shells, idx, amt);
                self.flags.pollable = true;
                self.flags.nonblock = true;
                self.started = false;
                return match self.write() {
                    WriteOutcome::Suspended => Yield::suspended(),
                    WriteOutcome::IsActuallyFile => {
                        self.fail_pending_writers(sys::Error::from_code(E::EAGAIN, sys::Tag::write))
                    }
                    WriteOutcome::Failed(e) => self.fail_pending_writers(e),
                };
            }
            bun_io::WriteResult::Err(e) => return self.fail_pending_writers(e),
        };
        self.record_write_progress(shells, idx, amt);
        if !self.writers[idx].wrote_everything() {
            // The only case where we get partial writes is when an error is
            // encountered, which returns above.
            unreachable!(
                "IOWriter.doFileWrite: child.wroteEverything() is false. This is unexpected behavior and indicates a bug in Bun. Please file a GitHub issue."
            );
        }
        self.bump(idx)
    }

    // ── poll callback ───────────────────────────────────────────────────

    /// The caller runs the result, and then [`Self::write_pending`].
    pub(crate) fn on_io(&mut self, shells: &mut ShellExecEnvs<'_>, event: IoEvent) -> Yield {
        // On Windows the current chunk was already written, dead or not.
        #[cfg(not(windows))]
        self.skip_dead();
        let handler = Handler::new(self.get_buffer());
        #[cfg(windows)]
        handler.has_inflight_write.set(self.is_writing);
        self.writer.on_io(&handler, event);
        let (written, err) = (handler.written.get(), handler.err.take());
        #[cfg(windows)]
        {
            self.is_writing = handler.has_inflight_write.get();
        }
        match (written, err) {
            (None, None) => Yield::suspended(),
            (Some((amount, status)), None) => self.on_write_pollable(shells, amount, status),
            (None, Some(err)) => self.fail_pending_writers(err),
            // A short write, after which the poll could not be registered again.
            (Some((amount, _)), Some(err)) => {
                self.record_write_progress(shells, self.writer_idx, amount);
                self.fail_pending_writers(err)
            }
        }
    }

    fn on_write_pollable(
        &mut self,
        shells: &mut ShellExecEnvs<'_>,
        amount: usize,
        status: WriteStatus,
    ) -> Yield {
        #[cfg(not(windows))]
        debug_assert!(self.flags.pollable);

        let idx = self.writer_idx;
        let Some(current) = self.writers.get(idx) else {
            return Yield::suspended();
        };
        if current.is_dead() {
            return self.bump(idx);
        }
        self.record_write_progress(shells, idx, amount);
        if status == WriteStatus::EndOfFile {
            // The other end of the socket/pipe closed (e.g. `ls | echo`).
            return self.fail_pending_writers(sys::Error::from_code(E::EPIPE, sys::Tag::write));
        }
        if self.writers[idx].wrote_everything() {
            return self.bump(idx);
        }
        Yield::suspended()
    }

    pub(crate) fn write_pending(&mut self) -> Yield {
        if self.wrote_everything() || self.writer_idx >= self.writers.len() {
            return Yield::suspended();
        }
        match self.write() {
            WriteOutcome::Failed(err) => self.fail_pending_writers(err),
            _ => Yield::suspended(),
        }
    }

    /// Fails every chunk still queued, oldest first, each with its own error
    /// completion: a builtin that queues one chunk per item waits for one
    /// completion per chunk. A child that finishes at its first error has to
    /// `cancel_chunks` there.
    fn fail_pending_writers(&mut self, err: sys::Error) -> Yield {
        if err.get_errno() == E::EPIPE {
            self.flags.broken_pipe = true;
        }
        // Mark the writer dead before any completion runs: a child that
        // enqueues from its callback (the next statement, the RHS of `&&`, ...)
        // must be rejected by `handle_dead_writer`, not queued onto a writer
        // whose handle the error path has torn down.
        self.err = Some(err);
        Yield::FailPendingWriters(self.id)
    }

    /// Returns the error completion of the oldest queued chunk, and whether more are queued.
    pub(crate) fn fail_next_writer(&mut self) -> (Yield, bool) {
        // A completion may have cancelled the entries behind it.
        self.skip_dead();
        let child = self.writers.get(self.writer_idx).map(|w| w.ptr);
        self.writer_idx += 1;
        let more = self.writer_idx < self.writers.len();
        if !more {
            self.clear();
        }
        let completion = child.map_or(Yield::done(), |child| Yield::OnIoWriterChunk {
            child,
            written: 0,
            err: self.err.as_ref().map(sys::Error::to_shell_system_error),
        });
        (completion, more)
    }

    // ── enqueue ─────────────────────────────────────────────────────────

    /// A writer that already reported a fatal error must not accept new
    /// chunks: a later `write()` would run with `handle == Closed` (the
    /// pollable path asserts `handle == Poll`). Broken pipes are the EPIPE
    /// flavor of the same thing. Report the error to the child instead of
    /// queueing the chunk.
    fn handle_dead_writer(&self, ptr: ChildPtr) -> Option<Yield> {
        if self.flags.broken_pipe {
            let err = sys::Error::from_code(E::EPIPE, sys::Tag::write).to_system_error();
            return Some(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                err: Some(err),
            });
        }
        if let Some(err) = &self.err {
            return Some(Yield::OnIoWriterChunk {
                child: ptr,
                written: 0,
                // `SystemError` owns its `bun_core::String`s by value, so
                // derive a fresh one per rejected chunk.
                err: Some(err.to_shell_system_error()),
            });
        }
        None
    }

    #[cfg(not(windows))]
    fn enqueue_file(&mut self, shells: &mut ShellExecEnvs<'_>) -> Yield {
        // The pollable path sets `started` in write(); the non-pollable file
        // path bypasses write() entirely, so set it here.
        self.started = true;
        self.do_file_write(shells)
    }

    /// You MUST have already added the data to `self.buf`!
    fn enqueue_internal(&mut self, shells: &mut ShellExecEnvs<'_>) -> Yield {
        debug_assert!(!self.flags.broken_pipe);
        debug_assert!(self.err.is_none());
        #[cfg(windows)]
        let _ = shells;
        #[cfg(not(windows))]
        if !self.flags.pollable {
            return self.enqueue_file(shells);
        }
        match self.write() {
            WriteOutcome::Suspended => Yield::suspended(),
            #[cfg(not(windows))]
            WriteOutcome::IsActuallyFile => self.enqueue_file(shells),
            WriteOutcome::Failed(e) => self.fail_pending_writers(e),
        }
    }

    /// Queue `buf` for writing; when the chunk completes (or errors),
    /// `child`'s `on_io_writer_chunk` fires.
    pub(crate) fn enqueue(
        &mut self,
        shells: &mut ShellExecEnvs<'_>,
        child: ChildPtr,
        captured: Option<BufioId>,
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
        self.buf.extend_from_slice(buf);
        self.writers.push(Writer {
            ptr: child,
            len: buf.len(),
            written: 0,
            captured,
        });
        self.enqueue_internal(shells)
    }

    /// Prefix `"{kind}: "` then format.
    pub(crate) fn enqueue_fmt_bltn(
        &mut self,
        shells: &mut ShellExecEnvs<'_>,
        child: ChildPtr,
        captured: Option<BufioId>,
        kind: Option<crate::shell::builtin::Kind>,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        use std::io::Write as _;
        if let Some(y) = self.handle_dead_writer(child) {
            return y;
        }
        let start = self.buf.len();
        if let Some(k) = kind {
            let _ = write!(&mut self.buf, "{}: ", k.as_str());
        }
        let _ = self.buf.write_fmt(args);
        let end = self.buf.len();
        self.writers.push(Writer {
            ptr: child,
            len: end - start,
            written: 0,
            captured,
        });
        self.enqueue_internal(shells)
    }
}

enum WriteOutcome {
    Suspended,
    /// The write/poll-registration failed synchronously.
    Failed(sys::Error),
    #[cfg(not(windows))]
    IsActuallyFile,
}

/// Records the callbacks of one `BufferedWriter` call, for `IOWriter` to handle after it returns.
#[derive(Default)]
struct Handler<'a> {
    buffer: &'a [u8],
    written: Cell<Option<(usize, WriteStatus)>>,
    err: Cell<Option<sys::Error>>,
    #[cfg(windows)]
    has_inflight_write: Cell<bool>,
}

impl<'a> Handler<'a> {
    fn new(buffer: &'a [u8]) -> Self {
        Handler {
            buffer,
            ..Default::default()
        }
    }
}

impl BufferedWriteHandler for Handler<'_> {
    fn with_buffer<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R {
        f(self.buffer)
    }
}

impl WriteHandler for Handler<'_> {
    fn on_write(&self, amount: usize, status: WriteStatus) {
        self.written.set(Some((amount, status)));
    }

    fn on_error(&self, err: sys::Error) {
        self.err.set(Some(err));
    }

    fn on_close(&self) {}

    #[cfg(windows)]
    fn set_has_inflight_write(&self, value: bool) {
        self.has_inflight_write.set(value);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// drainBufferedData / tryWrite (POSIX file path)
// ──────────────────────────────────────────────────────────────────────────

/// TODO: This function is a copy of PipeWriter's.
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

#[cfg(not(windows))]
fn drain_buffered_data(fd: Fd, buf: &[u8], max_write_size: usize) -> bun_io::WriteResult {
    let trimmed = if max_write_size < buf.len() && max_write_size > 0 {
        &buf[..max_write_size]
    } else {
        buf
    };
    let mut drained: usize = 0;
    while drained < trimmed.len() {
        match try_write_with_write_fn(fd, buf, sys::write) {
            bun_io::WriteResult::Pending(pending) => {
                drained += pending;
                return bun_io::WriteResult::Pending(drained);
            }
            bun_io::WriteResult::Wrote(amt) => {
                drained += amt;
            }
            bun_io::WriteResult::Err(err) => {
                // Reported as an error even after a partial write: the caller
                // (`do_file_write`) fails the whole chunk either way.
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

impl Drop for IOWriter<'_> {
    fn drop(&mut self) {
        crate::shell_log!("IOWriter(fd={}) deinit", self.fd);
        // The poll goes before its fd.
        #[cfg(not(windows))]
        self.writer.close(&Handler::default());
        #[cfg(windows)]
        {
            /// # Safety
            /// `writer` is the box of an `IOWriter` that was dropped.
            unsafe fn free(writer: *mut ()) {
                // SAFETY: fn contract.
                unsafe { bun_core::heap::destroy(writer.cast::<BufferedWriter>()) };
            }
            let writer = self.writer.as_ptr().cast();
            // SAFETY: nothing else frees the box, or uses it from here on.
            unsafe {
                if !self.writer.close_and_detach(writer, free) {
                    free(writer);
                }
            }
            // A libuv thread may still be writing to `fd`.
            if self.is_writing {
                return;
            }
        }
        if self.fd != Fd::INVALID {
            let _ = sys::close(self.fd);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Hoisted dispatch for `onIOWriterChunk`
// ──────────────────────────────────────────────────────────────────────────

/// Hoisted dispatch for the `onIOWriterChunk` callback (PORTING.md §Dispatch
/// hot-path). Called by `Yield::OnIoWriterChunk`.
pub(crate) fn on_io_writer_chunk(
    interp: &mut Interpreter<'_>,
    child: ChildPtr,
    written: usize,
    err: Option<sys::SystemError>,
) -> Yield {
    use crate::shell::builtin::Builtin;
    use crate::shell::states::{cmd, cond_expr, pipeline};
    use crate::shell::subproc::PipeReader;
    match child.tag {
        WriterTag::Builtin => Builtin::on_io_writer_chunk(interp, child.node, written, err),
        WriterTag::Cmd => cmd::Cmd::on_io_writer_chunk(interp, child.node, written, err),
        WriterTag::CondExpr => {
            cond_expr::CondExpr::on_io_writer_chunk(interp, child.node, written, err)
        }
        WriterTag::Pipeline => {
            pipeline::Pipeline::on_io_writer_chunk(interp, child.node, written, err)
        }
        WriterTag::Subproc(kind) => {
            PipeReader::on_io_writer_chunk(interp, child.node, kind, written, err)
        }
    }
}
