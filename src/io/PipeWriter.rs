use core::cell::Cell;
use core::mem;
#[cfg(windows)]
use std::rc::Rc;

use bun_core::OOM;
#[cfg(windows)]
use bun_ptr::OptionCellExt as _;
use bun_ptr::{CellExt as _, VecCellExt as _};
use bun_sys::{self as sys, Fd, MaybeOwnedFile};

use crate::{EventLoopHandle, IoEvent, Owner};
#[cfg(unix)]
use crate::{FilePoll, FilePollFlag};

#[cfg(unix)]
use crate::pipes::{FileType, PipeHandle};
#[cfg(windows)]
use crate::source::{Payload, Pipe, WriteSource};

bun_core::define_scoped_log!(log, PipeWriter, hidden);

// ──────────────────────────────────────────────────────────────────────────
// WriteResult / WriteStatus
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub enum WriteResult {
    Done(usize),
    Wrote(usize),
    Pending(usize),
    Err(sys::Error),
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum WriteStatus {
    EndOfFile,
    Drained,
    Pending,
}

/// What a writer reports to, from inside the call that it is passed to. It may call the writer again.
pub trait WriteHandler {
    fn on_write(&self, amount: usize, status: WriteStatus);
    /// The writer also closes: `on_close` runs after this or, on Windows, may run before.
    fn on_error(&self, err: sys::Error);
    fn on_close(&self);
    /// Only from a `StreamingWriter`.
    #[cfg(windows)]
    fn on_writable(&self) {}
    /// `true` when a write is submitted, `false` when it ends or the writer is closed. Dropping the writer in between cancels it.
    #[cfg(windows)]
    fn set_has_inflight_write(&self, _: bool) {}
}

/// A handler that owns the bytes a `BufferedWriter` writes.
pub trait BufferedWriteHandler: WriteHandler {
    /// Lends `f` what is to be written next.
    fn with_buffer<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R;
}

// ──────────────────────────────────────────────────────────────────────────
// PosixPipeWriter
// ──────────────────────────────────────────────────────────────────────────

/// State and syscalls shared by `PosixBufferedWriter` and `PosixStreamingWriter`.
#[cfg(unix)]
struct PosixPipeWriter {
    handle: PipeHandle,
    /// Set once `pwritev2(RWF_NOWAIT)` said this fd's file type does not support it, so we stop asking.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    rwf_unsupported: Cell<bool>,
    closed_without_reporting: Cell<bool>,
}

#[cfg(unix)]
impl Default for PosixPipeWriter {
    fn default() -> Self {
        Self {
            handle: PipeHandle::closed(),
            #[cfg(any(target_os = "linux", target_os = "android"))]
            rwf_unsupported: Cell::new(false),
            closed_without_reporting: Cell::new(false),
        }
    }
}

#[cfg(unix)]
impl PosixPipeWriter {
    fn get_file_type(&self) -> FileType {
        self.handle
            .with_poll(FilePoll::file_type)
            .unwrap_or(FileType::File)
    }

    /// A short write is `Pending` or `Done`, never `Wrote`.
    fn try_write(&self, force_sync: bool, buf: &[u8]) -> WriteResult {
        // PERF: try_write_with_write_fn is not monomorphized per FileType —
        // profile if hot.
        let ft = self.get_file_type();
        // Linux: RWF_NOWAIT is a free per-call nonblocking write, so a pipe stays async even after a spawn cleared O_NONBLOCK on it.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if matches!(ft, FileType::Pipe | FileType::NonblockingPipe) && !self.rwf_unsupported.get() {
            match self.try_write_nowait(buf) {
                Some(rc) => return rc,
                // Not a pipe as far as pwritev2 is concerned (tty, pty master, old kernel): remember, use the plain path.
                None => self.rwf_unsupported.set(true),
            }
        }
        match ft {
            // send(MSG_DONTWAIT | MSG_NBIO) is nonblocking per call on every Unix, whatever the fd's flags.
            FileType::Socket => self.try_write_with_write_fn(buf, write_to_socket),
            FileType::Pipe if !force_sync => {
                self.try_write_with_write_fn(buf, write_to_blocking_pipe)
            }
            _ => self.try_write_with_write_fn(buf, sys::write),
        }
    }

    /// `None` if `RWF_NOWAIT` is not usable on this fd (nothing was written).
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn try_write_nowait(&self, buf: &[u8]) -> Option<WriteResult> {
        let fd = self.handle.get_fd();
        if fd == Fd::INVALID {
            return Some(WriteResult::Done(0));
        }
        let mut offset: usize = 0;
        while offset < buf.len() {
            match sys::write_nowait(fd, &buf[offset..]) {
                Ok(None) if offset == 0 => return None,
                Ok(None) => return Some(WriteResult::Pending(offset)),
                Ok(Some(0)) => return Some(WriteResult::Done(offset)),
                Ok(Some(wrote)) => offset += wrote,
                Err(err) if err.is_retry() => return Some(WriteResult::Pending(offset)),
                Err(err) => return Some(WriteResult::Err(err)),
            }
        }
        Some(WriteResult::Wrote(offset))
    }

    fn try_write_with_write_fn(
        &self,
        buf: &[u8],
        write_fn: fn(Fd, &[u8]) -> sys::Result<usize>,
    ) -> WriteResult {
        let fd = self.handle.get_fd();
        if fd == Fd::INVALID {
            return WriteResult::Done(0);
        }

        let mut offset: usize = 0;

        while offset < buf.len() {
            match write_fn(fd, &buf[offset..]) {
                sys::Result::Err(err) => {
                    if err.is_retry() {
                        return WriteResult::Pending(offset);
                    }

                    // Return EPIPE as an error so it propagates to JavaScript.
                    // This ensures process.stdout.write() properly emits an error
                    // when writing to a broken pipe, matching Node.js behavior.

                    return WriteResult::Err(err);
                }

                sys::Result::Ok(wrote) => {
                    offset += wrote;
                    if wrote == 0 {
                        return WriteResult::Done(offset);
                    }
                }
            }
        }

        WriteResult::Wrote(offset)
    }

    /// Writes as much of `buf` as `event` says there is room for. `None` if there is nothing to do.
    fn try_write_on_poll(
        &self,
        event: IoEvent,
        force_sync: bool,
        buf: &[u8],
    ) -> Option<WriteResult> {
        log!("onPoll({})", buf.len());
        if buf.is_empty() {
            return event.is_hup().then_some(WriteResult::Wrote(0));
        }
        let max_write = match usize::try_from(event.size_or_offset) {
            Ok(size) if size > 0 && self.get_file_type().is_blocking() => size,
            _ => usize::MAX,
        };
        Some(self.try_write(force_sync, &buf[..buf.len().min(max_write)]))
    }

    fn register_poll(&self) -> sys::Result<()> {
        self.handle.register(FilePollFlag::Writable)
    }

    fn start_polling(&self, ev: EventLoopHandle, file: MaybeOwnedFile) -> sys::Result<()> {
        // A poll from an earlier start() still holds that start's fd.
        if !file.is_owned() && self.handle.has_poll() {
            return self.register_poll();
        }
        self.handle.set_file(file);
        self.handle.add_poll(ev);
        self.register_poll()
            .inspect_err(|_| drop(self.handle.take_file()))
    }

    fn update_ref(&self, value: bool) {
        self.handle
            .with_poll(|poll| poll.set_keeping_process_alive(value));
    }

    fn close_without_reporting(&self) {
        if !self.handle.is_closed() {
            debug_assert!(!self.closed_without_reporting.get());
            self.closed_without_reporting.set(true);
            self.handle.close_if_owned();
        }
    }

    /// `true` if there is a close to report.
    fn close(&self) -> bool {
        self.closed_without_reporting.take() || self.handle.close()
    }
}

/// Free fn for the blocking-pipe path; the other file types are handled
/// inline in `try_write` above.
#[cfg(unix)]
fn write_to_blocking_pipe(fd: Fd, buf: &[u8]) -> sys::Result<usize> {
    match bun_core::is_writable(fd) {
        bun_core::Pollable::Ready | bun_core::Pollable::Hup => sys::write(fd, buf),
        bun_core::Pollable::NotReady => sys::Result::Err(sys::Error::retry()),
    }
}

/// `send(2)` stands in for `write(2)` on the socketpair behind a child's stdio,
/// only to pass `MSG_NOSIGNAL`. The error names `write`, as Node does.
#[cfg(unix)]
fn write_to_socket(fd: Fd, buf: &[u8]) -> sys::Result<usize> {
    sys::send_non_block(fd, buf).map_err(|err| sys::Error {
        syscall: sys::Tag::write,
        // XNU's send() says ENOTCONN once a stream peer is fully gone; write(2) on the same fd (and Node) say EPIPE.
        errno: if err.get_errno() == sys::E::ENOTCONN {
            sys::E::EPIPE as _
        } else {
            err.errno
        },
        ..err
    })
}

// ──────────────────────────────────────────────────────────────────────────
// PosixBufferedWriter
// ──────────────────────────────────────────────────────────────────────────

/// Shared borrows only: a handler can reach the writer again.
#[cfg(unix)]
#[derive(Default)]
pub struct PosixBufferedWriter {
    base: PosixPipeWriter,
}

#[cfg(unix)]
impl PosixBufferedWriter {
    /// # Safety
    /// See `PosixStreamingWriter::set_owner`.
    pub unsafe fn set_owner(&self, owner: Owner) {
        // SAFETY: caller contract.
        unsafe { self.base.handle.set_owner(owner) };
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>()
    }

    pub fn is_closed(&self) -> bool {
        self.base.handle.is_closed()
    }

    pub fn has_poll(&self) -> bool {
        self.base.handle.has_poll()
    }

    pub fn is_watching(&self) -> bool {
        self.base.handle.is_watching()
    }

    pub fn set_poll_flag(&self, flag: FilePollFlag) {
        self.base.handle.set_poll_flag(flag);
    }

    pub fn on_io(&self, handler: &impl BufferedWriteHandler, event: IoEvent) {
        match handler.with_buffer(|buf| self.base.try_write_on_poll(event, false, buf)) {
            None => {}
            Some(WriteResult::Pending(wrote)) => {
                if wrote > 0 {
                    handler.on_write(wrote, WriteStatus::Pending);
                }
                self.register_poll(handler);
            }
            Some(WriteResult::Wrote(amt)) => handler.on_write(amt, WriteStatus::Drained),
            Some(WriteResult::Err(err)) => self.report_error_and_close(handler, err),
            Some(WriteResult::Done(amt)) => {
                self.base.close_without_reporting();
                handler.on_write(amt, WriteStatus::EndOfFile);
                self.close(handler);
            }
        }
    }

    fn report_error_and_close(&self, handler: &impl WriteHandler, err: sys::Error) {
        debug_assert!(!err.is_retry());
        handler.on_error(err);
        self.close(handler);
    }

    pub fn register_poll(&self, handler: &impl WriteHandler) {
        if let sys::Result::Err(err) = self.base.register_poll() {
            self.report_error_and_close(handler, err);
        }
    }

    pub fn close(&self, handler: &impl WriteHandler) {
        if self.base.close() {
            handler.on_close();
        }
    }

    pub fn update_ref(&self, value: bool) {
        self.base.update_ref(value);
    }

    /// Takes the handler to match `WindowsBufferedWriter::start`.
    pub fn start(
        &self,
        _: &impl BufferedWriteHandler,
        ev: EventLoopHandle,
        file: MaybeOwnedFile,
        pollable: bool,
    ) -> sys::Result<()> {
        if !pollable {
            debug_assert!(!self.has_poll());
            self.base.handle.set_file(file);
            return sys::Result::Ok(());
        }
        self.base.start_polling(ev, file)?;
        self.update_ref(true);
        sys::Result::Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PosixStreamingWriter
// ──────────────────────────────────────────────────────────────────────────

/// Shared borrows only: a handler can reach the writer again.
#[cfg(unix)]
#[derive(Default)]
pub struct PosixStreamingWriter {
    base: PosixPipeWriter,
    outgoing: StreamBufferCell,
    is_done: Cell<bool>,
    force_sync: Cell<bool>,
    /// Last reported `WriteStatus == Pending` (i.e. write(2) returned EAGAIN).
    backed_up: Cell<bool>,
}

#[cfg(unix)]
impl PosixStreamingWriter {
    // The smallest page size the target
    // supports (16K on Apple Silicon, 4K elsewhere among our targets).
    const CHUNK_SIZE: usize = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        16384
    } else {
        4096
    };

    /// `owner` is handed the events, to pass on to [`Self::on_io`].
    ///
    /// # Safety
    /// `owner.ptr` points to a live value of the type `__bun_run_io` casts `owner.tag` to, until `self`
    /// is dropped. `self` does not move, and is not borrowed mutably, until then.
    pub unsafe fn set_owner(&self, owner: Owner) {
        // SAFETY: caller contract.
        unsafe { self.base.handle.set_owner(owner) };
    }

    pub fn owner(&self) -> Owner {
        self.base.handle.owner()
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.outgoing.memory_cost()
    }

    pub fn set_force_sync(&self, value: bool) {
        self.force_sync.set(value);
    }

    pub fn set_poll_flag(&self, flag: FilePollFlag) {
        self.base.handle.set_poll_flag(flag);
    }

    pub fn has_pending_data(&self) -> bool {
        self.buffered_len() > 0
    }

    /// write(2) returned EAGAIN (distinct from has_pending_data()'s coalesce buffer).
    pub fn is_backed_up(&self) -> bool {
        self.backed_up.get()
    }

    /// Bytes accepted from callers that have not reached the fd yet.
    pub fn buffered_len(&self) -> usize {
        self.outgoing.size()
    }

    /// The part of `buffered_len` that `flush` would send.
    pub fn queued_len(&self) -> usize {
        self.buffered_len()
    }

    fn should_buffer(&self, addition: usize) -> bool {
        !self.force_sync.get() && self.outgoing.size() + addition < Self::CHUNK_SIZE
    }

    fn is_done(&self) -> bool {
        self.is_done.get() || self.base.closed_without_reporting.get()
    }

    fn report_write(&self, handler: &impl WriteHandler, amount: usize, status: WriteStatus) {
        // on_write may re-enter write(); record first so re-entry leaves the newer value.
        self.backed_up.set(status == WriteStatus::Pending);
        handler.on_write(amount, status);
    }

    #[cold]
    fn report_error_and_close(&self, handler: &impl WriteHandler, err: sys::Error) {
        handler.on_error(err);
        self.close(handler);
    }

    fn register_poll(&self, handler: &impl WriteHandler) {
        if let sys::Result::Err(err) = self.base.register_poll() {
            self.report_error_and_close(handler, err);
        }
    }

    pub fn on_io(&self, handler: &impl WriteHandler, event: IoEvent) {
        match self.drain_on_poll(event) {
            None => {}
            Some(WriteResult::Pending(wrote)) => {
                if wrote > 0 {
                    self.report_write(handler, wrote, WriteStatus::Pending);
                }
                self.register_poll(handler);
            }
            // If the handler buffers more data, `write()` registers the poll.
            Some(WriteResult::Wrote(amt)) => self.report_write(handler, amt, WriteStatus::Drained),
            Some(WriteResult::Err(err)) => self.report_error_and_close(handler, err),
            Some(WriteResult::Done(amt)) => self.report_write(handler, amt, WriteStatus::EndOfFile),
        }
    }

    fn drain_on_poll(&self, event: IoEvent) -> Option<WriteResult> {
        let outgoing = &self.outgoing;
        let rc = outgoing.with_taken(|outgoing| {
            self.base
                .try_write_on_poll(event, self.force_sync.get(), outgoing.slice())
        })?;
        match rc {
            WriteResult::Pending(amt) => outgoing.wrote(amt),
            WriteResult::Wrote(amt) => {
                outgoing.wrote(amt);
                if outgoing.size() == 0 {
                    outgoing.reset();
                }
            }
            WriteResult::Done(amt) => {
                outgoing.wrote(amt);
                if !self.is_done.get() {
                    self.base.close_without_reporting();
                }
            }
            WriteResult::Err(ref err) => {
                debug_assert!(!err.is_retry());
                self.base.close_without_reporting();
                self.is_done.set(true);
                outgoing.reset();
            }
        }
        Some(rc)
    }

    pub fn write_utf16(&self, handler: &impl WriteHandler, buf: &[u16]) -> WriteResult {
        if self.is_done() {
            return WriteResult::Done(0);
        }

        self.maybe_write_newly_buffered_data(handler, self.outgoing.write_utf16(buf))
    }

    pub fn write_latin1(&self, handler: &impl WriteHandler, buf: &[u8]) -> WriteResult {
        if bun_core::strings::is_all_ascii(buf) {
            return self.write(handler, buf);
        }

        if self.is_done() {
            return WriteResult::Done(0);
        }

        self.maybe_write_newly_buffered_data(handler, self.outgoing.write_latin1(buf))
    }

    fn maybe_write_newly_buffered_data(
        &self,
        handler: &impl WriteHandler,
        buf_len: usize,
    ) -> WriteResult {
        if self.should_buffer(0) {
            self.report_write(handler, buf_len, WriteStatus::Drained);
            self.register_poll(handler);

            return WriteResult::Wrote(buf_len);
        }

        self.try_write_newly_buffered_data(handler)
    }

    fn try_write_outgoing(&self) -> WriteResult {
        self.outgoing
            .with_taken(|outgoing| self.base.try_write(self.force_sync.get(), outgoing.slice()))
    }

    fn try_write_newly_buffered_data(&self, handler: &impl WriteHandler) -> WriteResult {
        let rc = self.try_write_outgoing();

        match rc {
            WriteResult::Wrote(amt) => {
                self.outgoing.reset();
                self.report_write(handler, amt, WriteStatus::Drained);
            }
            WriteResult::Done(amt) => {
                self.outgoing.reset();
                self.report_write(handler, amt, WriteStatus::EndOfFile);
            }
            WriteResult::Pending(amt) => {
                self.outgoing.wrote(amt);
                self.report_write(handler, amt, WriteStatus::Pending);
                self.register_poll(handler);
            }
            WriteResult::Err(_) => {}
        }

        rc
    }

    pub fn write(&self, handler: &impl WriteHandler, buf: &[u8]) -> WriteResult {
        if self.is_done() {
            return WriteResult::Done(0);
        }

        if self.should_buffer(buf.len()) {
            // this is streaming, but we buffer the data below `chunk_size` to
            // reduce the number of writes
            self.outgoing.write(buf);

            // noop, but need this to have a chance
            // to register deferred tasks (onAutoFlush)
            self.report_write(handler, buf.len(), WriteStatus::Drained);
            self.register_poll(handler);

            // it's buffered, but should be reported as written to
            // callers
            return WriteResult::Wrote(buf.len());
        }

        if self.has_pending_data() {
            // make sure write is in-order
            self.outgoing.write(buf);

            return self.try_write_newly_buffered_data(handler);
        }

        let rc = self.base.try_write(self.force_sync.get(), buf);

        match rc {
            WriteResult::Pending(amt) => {
                self.outgoing.write(&buf[amt..]);
                self.report_write(handler, amt, WriteStatus::Pending);
                self.register_poll(handler);
            }
            WriteResult::Wrote(amt) => {
                self.outgoing.reset();
                self.report_write(handler, amt, WriteStatus::Drained);
            }
            WriteResult::Done(amt) => {
                self.outgoing.reset();
                self.report_write(handler, amt, WriteStatus::EndOfFile);
            }
            WriteResult::Err(_) => {}
        }

        rc
    }

    /// Takes the handler to match `WindowsStreamingWriter::flush`.
    pub fn flush(&self, _: &impl WriteHandler) -> WriteResult {
        self.drain()
    }

    fn drain(&self) -> WriteResult {
        if self.is_done() {
            return WriteResult::Done(0);
        }
        if !self.has_pending_data() {
            self.outgoing.reset();
            return WriteResult::Wrote(0);
        }

        let rc = self.try_write_outgoing();
        match rc {
            WriteResult::Pending(written) => self.outgoing.wrote(written),
            _ => self.outgoing.reset(),
        }
        // Leftover bytes = kernel refused them.
        self.backed_up.set(self.has_pending_data());
        rc
    }

    pub fn update_ref(&self, value: bool) {
        if value && self.is_done.get() {
            return;
        }
        self.base.update_ref(value);
    }

    pub fn end(&self, handler: &impl WriteHandler) {
        if !self.is_done.replace(true) {
            self.close(handler);
        }
    }

    pub fn close(&self, handler: &impl WriteHandler) {
        if self.base.close() {
            handler.on_close();
        }
    }

    /// For our end of a pipe that this process has made.
    pub fn start_own_pipe(
        &self,
        handler: &impl WriteHandler,
        ev: EventLoopHandle,
        pipe: sys::File,
    ) -> sys::Result<()> {
        self.start(handler, ev, pipe, true)
    }

    pub fn start(
        &self,
        handler: &impl WriteHandler,
        ev: EventLoopHandle,
        file: sys::File,
        is_pollable: bool,
    ) -> sys::Result<()> {
        if !is_pollable {
            self.close(handler);
            self.base.handle.set_file(file.into());
            return sys::Result::Ok(());
        }
        if self.base.handle.has_poll() {
            // The poll stays on the fd of the earlier start().
            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                self.update_ref(false);
                return sys::Result::Err(sys::Error::from_code(
                    sys::E::ENOENT,
                    sys::Tag::epoll_ctl,
                ));
            }
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            return sys::Result::Ok(());
        }
        self.base.start_polling(ev, file.into())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WindowsPipeWriter
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub enum WriteEvent {
    /// With the allocation that held the bytes.
    Wrote(Vec<u8>),
    Failed(sys::Error),
    /// The write in flight has ended, and nothing that is started from now on does.
    WriteRestNow,
    /// The end of the write in flight is not going to be reported.
    VmTeardown,
}

#[cfg(windows)]
enum Sink {
    Async(WriteSource),
    /// Written before the call returns.
    Sync(MaybeOwnedFile),
}

/// Shared borrows only: a handler can reach the writer again.
#[cfg(windows)]
struct WindowsPipeWriter {
    sink: Cell<Option<Sink>>,
    owner: Cell<Owner>,
    /// `false` for a file descriptor that was passed in, which is left open.
    owns_fd: Cell<bool>,
    is_done: Cell<bool>,
    closed_without_reporting: Cell<bool>,
    has_inflight_write: Cell<bool>,
    /// Of the write in flight, or of one that failed.
    payload_len: Cell<usize>,
    spare: Cell<Vec<u8>>,
}

#[cfg(windows)]
impl Default for WindowsPipeWriter {
    fn default() -> Self {
        Self {
            sink: Cell::new(None),
            owner: Cell::new(Owner::NULL),
            owns_fd: Cell::new(true),
            is_done: Cell::new(false),
            closed_without_reporting: Cell::new(false),
            has_inflight_write: Cell::new(false),
            payload_len: Cell::new(0),
            spare: Cell::default(),
        }
    }
}

#[cfg(windows)]
impl WindowsPipeWriter {
    /// The cell is empty while `f` runs.
    fn with_source<R>(&self, f: impl FnOnce(&WriteSource) -> R) -> Option<R> {
        self.sink.with_taken(|sink| match sink {
            Some(Sink::Async(source)) => Some(f(source)),
            Some(Sink::Sync(_)) | None => None,
        })
    }

    fn has_sink(&self) -> bool {
        self.sink.is_some()
    }

    fn memory_cost(&self) -> usize {
        self.payload_len.get() + self.spare.capacity()
    }

    fn set_source(&self, source: WriteSource) {
        assert!(!self.has_sink());
        // SAFETY: the contract of `set_owner`, and the source does not outlast `self`.
        unsafe { source.set_owner(self.owner.get()) };
        self.sink.set(Some(Sink::Async(source)));
    }

    fn open(&self, ev: EventLoopHandle, file: MaybeOwnedFile) -> sys::Result<()> {
        self.set_source(WriteSource::open(ev.loop_().port(), file)?);
        sys::Result::Ok(())
    }

    fn update_ref(&self, value: bool) {
        self.with_source(|source| source.update_ref(value));
    }

    /// The number of bytes that were written.
    fn end_write(&self, handler: &impl WriteHandler, event: IoEvent) -> Option<sys::Result<usize>> {
        handler.set_has_inflight_write(false);
        let result = match event {
            IoEvent::Write(WriteEvent::Wrote(spare)) => Ok(self.wrote(spare)),
            IoEvent::Write(WriteEvent::Failed(err)) => Err(err),
            IoEvent::Write(WriteEvent::WriteRestNow | WriteEvent::VmTeardown) => return None,
            IoEvent::Read(_) => unreachable!("a read was passed to a writer"),
        };
        self.has_inflight_write.set(false);
        Some(result)
    }

    fn wrote(&self, mut spare: Vec<u8>) -> usize {
        spare.clear();
        spare.shrink_to(bun_core::page_size());
        self.spare.set(spare);
        self.payload_len.take()
    }

    fn submit_with<R>(
        &self,
        len: usize,
        write: impl FnOnce(&WriteSource) -> sys::Result<R>,
    ) -> sys::Result<R> {
        assert!(!self.has_inflight_write.get());
        self.payload_len.set(len);
        self.with_source(write)
            .unwrap_or_else(|| Err(sys::Error::from_code(sys::E::EPIPE, sys::Tag::pipe)))
    }

    fn submit(&self, payload: Payload) -> sys::Result<()> {
        self.submit_with(payload.bytes().len(), |source| source.write(payload))?;
        self.has_inflight_write.set(true);
        sys::Result::Ok(())
    }

    /// `true` if it is written.
    fn submit_now(&self, payload: Vec<u8>) -> sys::Result<bool> {
        let spare = self.submit_with(payload.len(), |source| source.write_now(payload))?;
        self.has_inflight_write.set(spare.is_none());
        sys::Result::Ok(spare.map(|spare| self.wrote(spare)).is_some())
    }

    /// `false` if there was none.
    fn close_sink(&self, cancel_inflight_write: bool) -> bool {
        self.is_done.set(true);
        match self.sink.take() {
            Some(Sink::Async(source)) if cancel_inflight_write => {
                source.cancel_write_unless_started();
            }
            Some(Sink::Sync(MaybeOwnedFile::Owned(file))) if file.fd().stdio_tag().is_none() => {
                crate::Closer::close(file);
            }
            Some(_) => {}
            None => return false,
        }
        true
    }

    fn close(&self, handler: &impl WriteHandler, cancel_inflight_write: bool) {
        if !self.close_sink(cancel_inflight_write) {
            return;
        }
        self.payload_len.set(0);
        let had_inflight_write = self.has_inflight_write.take();
        if !self.closed_without_reporting.get() {
            handler.on_close();
        }
        if had_inflight_write && !self.has_inflight_write.get() {
            handler.set_has_inflight_write(false);
        }
    }

    /// Closes the old source before a restart, like the POSIX writer.
    fn close_current_sink(&self, handler: &impl WriteHandler) -> sys::Result<()> {
        // Only a write to a file goes on after the close.
        if self.has_inflight_write.get() && self.with_source(WriteSource::is_file) != Some(true) {
            return sys::Result::Err(sys::Error::from_code(sys::E::EBUSY, sys::Tag::write));
        }
        self.close(handler, false);
        // `on_close` started the writer again.
        if self.has_sink() {
            return sys::Result::Err(sys::Error::from_code(sys::E::EBUSY, sys::Tag::write));
        }
        self.is_done.set(false);
        sys::Result::Ok(())
    }
}

#[cfg(windows)]
impl Drop for WindowsPipeWriter {
    fn drop(&mut self) {
        self.close_sink(true);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WindowsBufferedWriter
// ──────────────────────────────────────────────────────────────────────────

/// Shared borrows only: a handler can reach the writer again.
#[cfg(windows)]
#[derive(Default)]
pub struct WindowsBufferedWriter {
    base: WindowsPipeWriter,
}

#[cfg(windows)]
impl WindowsBufferedWriter {
    /// # Safety
    /// See `PosixStreamingWriter::set_owner`.
    pub unsafe fn set_owner(&self, owner: Owner) {
        self.base.owner.set(owner);
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.base.memory_cost()
    }

    pub fn is_closed(&self) -> bool {
        !self.base.has_sink()
    }

    pub fn update_ref(&self, value: bool) {
        self.base.update_ref(value);
    }

    pub fn set_pipe(&self, pipe: Pipe) {
        self.base.set_source(pipe.into());
    }

    pub fn start_with_current_source(&self, handler: &impl BufferedWriteHandler) {
        debug_assert!(self.base.has_sink());
        self.base.is_done.set(false);
        self.write(handler);
    }

    pub fn start(
        &self,
        handler: &impl BufferedWriteHandler,
        ev: EventLoopHandle,
        file: MaybeOwnedFile,
        _pollable: bool,
    ) -> sys::Result<()> {
        self.base.close_current_sink(handler)?;
        self.base.open(ev, file)?;
        self.start_with_current_source(handler);
        sys::Result::Ok(())
    }

    pub fn on_io(&self, handler: &impl BufferedWriteHandler, event: IoEvent) {
        let is_teardown = matches!(event, IoEvent::Write(WriteEvent::VmTeardown));
        match self.base.end_write(handler, event) {
            Some(Ok(written)) => handler.on_write(written, WriteStatus::Pending),
            Some(Err(err)) => self.close_and_report_error(handler, err),
            None if is_teardown => self.base.close(handler, false),
            None => {}
        }
    }

    fn close_and_report_error(&self, handler: &impl WriteHandler, err: sys::Error) {
        self.close(handler);
        handler.on_error(err);
    }

    fn can_write(&self) -> bool {
        !self.base.is_done.get() && !self.base.has_inflight_write.get() && self.base.has_sink()
    }

    fn submit(&self, handler: &impl WriteHandler, payload: Payload) {
        if payload.bytes().is_empty() {
            return;
        }
        match self.base.submit(payload) {
            sys::Result::Ok(()) => handler.set_has_inflight_write(true),
            sys::Result::Err(err) => self.close_and_report_error(handler, err),
        }
    }

    pub fn write(&self, handler: &impl BufferedWriteHandler) {
        if self.can_write() {
            let mut payload = self.base.spare.take();
            handler.with_buffer(|buffer| payload.extend_from_slice(buffer));
            self.submit(handler, Payload::Owned(payload));
        }
    }

    /// `write`, without a copy.
    pub fn write_shared(&self, handler: &impl WriteHandler, bytes: Rc<dyn AsRef<[u8]>>) {
        if self.can_write() {
            self.submit(handler, Payload::Shared(bytes));
        }
    }

    pub fn close(&self, handler: &impl WriteHandler) {
        self.base.close(handler, true);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StreamBuffer
// ──────────────────────────────────────────────────────────────────────────

/// Basic Vec<u8> + usize cursor wrapper
#[derive(Default)]
pub struct StreamBuffer {
    pub list: Vec<u8>,
    pub cursor: usize,
}

impl StreamBuffer {
    pub fn reset(&mut self) {
        self.cursor = 0;
        self.maybe_shrink();
        self.list.clear();
    }

    fn maybe_shrink(&mut self) {
        // Runtime page size of the host.
        let page = bun_core::page_size();
        if self.list.capacity() > page {
            // Truncate the buffer's content to `page` bytes AND release the
            // excess capacity.
            // Vec::shrink_to never goes below current len, so truncate first.
            self.list.truncate(page);
            self.list.shrink_to(page);
        }
    }

    pub fn size(&self) -> usize {
        self.list.len() - self.cursor
    }

    pub fn is_empty(&self) -> bool {
        self.size() == 0
    }

    pub fn is_not_empty(&self) -> bool {
        self.size() > 0
    }

    pub fn write(&mut self, buffer: &[u8]) -> Result<(), OOM> {
        self.compact();
        self.list.extend_from_slice(buffer);
        Ok(())
    }

    pub fn wrote(&mut self, amount: usize) {
        self.cursor += amount;
    }

    /// Drops the consumed prefix once it is at least as large as the unread tail.
    fn compact(&mut self) {
        if self.cursor == 0 || self.cursor < self.size() {
            return;
        }
        self.list.drain(..self.cursor);
        self.cursor = 0;
    }

    pub fn write_assume_capacity(&mut self, buffer: &[u8]) {
        self.list.extend_from_slice(buffer);
    }

    pub fn ensure_unused_capacity(&mut self, capacity: usize) -> Result<(), OOM> {
        self.compact();
        self.list.reserve(capacity);
        Ok(())
    }

    pub fn write_type_as_bytes_assume_capacity<T: bun_core::NoUninit>(&mut self, data: T) {
        self.list.extend_from_slice(bun_core::bytes_of(&data));
    }

    pub fn slice(&self) -> &[u8] {
        &self.list[self.cursor..]
    }
}

/// A [`StreamBuffer`] behind a shared borrow.
#[derive(Default)]
struct StreamBufferCell {
    list: Cell<Vec<u8>>,
    cursor: Cell<usize>,
}

impl StreamBufferCell {
    fn take(&self) -> StreamBuffer {
        StreamBuffer {
            list: self.list.take(),
            cursor: self.cursor.take(),
        }
    }

    fn put_back(&self, buffer: StreamBuffer) {
        debug_assert_eq!(self.list.capacity(), 0);
        self.list.put_back(buffer.list);
        self.cursor.set(buffer.cursor);
    }

    /// `self` is empty while `f` runs, and what is written to it meanwhile is leaked.
    fn with_taken<R>(&self, f: impl FnOnce(&mut StreamBuffer) -> R) -> R {
        let mut buffer = self.take();
        let result = f(&mut buffer);
        self.put_back(buffer);
        result
    }

    fn reset(&self) {
        self.cursor.set(0);
        if self.list.capacity() > bun_core::page_size() {
            self.with_taken(StreamBuffer::maybe_shrink);
        }
        self.list.clear();
    }

    fn memory_cost(&self) -> usize {
        self.list.capacity()
    }

    fn size(&self) -> usize {
        self.list.len() - self.cursor.get()
    }

    fn compact(&self) {
        if self.cursor.get() > 0 && self.cursor.get() >= self.size() {
            self.compact_slow();
        }
    }

    #[cold]
    fn compact_slow(&self) {
        self.with_taken(StreamBuffer::compact);
    }

    fn write(&self, buffer: &[u8]) {
        self.compact();
        self.list.extend_from_slice(buffer);
    }

    /// For text that is not all ASCII. Returns the encoded length.
    fn write_latin1(&self, buffer: &[u8]) -> usize {
        self.compact();
        let list = self.list.take();
        let len = list.len();
        let list = bun_core::strings::allocate_latin1_into_utf8_with_list(list, len, buffer);
        self.list.put_back(list);
        self.list.len() - len
    }

    /// Returns the encoded length.
    fn write_utf16(&self, buffer: &[u16]) -> usize {
        self.compact();
        let mut list = self.list.take();
        let len = list.len();
        bun_core::strings::convert_utf16_to_utf8_append(&mut list, buffer);
        self.list.put_back(list);
        self.list.len() - len
    }

    #[cfg(windows)]
    fn write_chunk(&self, chunk: WriteChunk<'_>) {
        match chunk {
            WriteChunk::Bytes(bytes) => self.write(bytes),
            WriteChunk::Latin1(bytes) => _ = self.write_latin1(bytes),
            WriteChunk::Utf16(text) => _ = self.write_utf16(text),
        }
    }

    #[cfg(unix)]
    fn wrote(&self, amount: usize) {
        self.cursor.set(self.cursor.get() + amount);
    }
}

#[cfg(windows)]
enum WriteChunk<'a> {
    Bytes(&'a [u8]),
    Latin1(&'a [u8]),
    Utf16(&'a [u16]),
}

// ──────────────────────────────────────────────────────────────────────────
// WindowsStreamingWriter
// ──────────────────────────────────────────────────────────────────────────

/// Shared borrows only: a handler can reach the writer again.
#[cfg(windows)]
#[derive(Default)]
pub struct WindowsStreamingWriter {
    base: WindowsPipeWriter,
    /// Becomes the payload once the write in flight has ended.
    outgoing: StreamBufferCell,
}

#[cfg(windows)]
impl WindowsStreamingWriter {
    /// # Safety
    /// See `PosixStreamingWriter::set_owner`.
    pub unsafe fn set_owner(&self, owner: Owner) {
        self.base.owner.set(owner);
    }

    pub fn owner(&self) -> Owner {
        self.base.owner.get()
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.base.memory_cost() + self.outgoing.memory_cost()
    }

    pub fn owns_fd(&self) -> bool {
        self.base.owns_fd.get()
    }

    pub fn is_done(&self) -> bool {
        self.base.is_done.get()
    }

    pub fn has_pending_data(&self) -> bool {
        self.buffered_len() > 0
    }

    /// process_send found a write already in flight (the payload alone is not backpressure).
    pub fn is_backed_up(&self) -> bool {
        self.queued_len() > 0
    }

    pub fn is_writing_to_file(&self) -> bool {
        self.base.has_inflight_write.get()
            && self.base.with_source(WriteSource::is_file) == Some(true)
    }

    /// Waits for the one in flight.
    pub fn finish_write_to_disk(&self) -> sys::Result<()> {
        (self.base.with_source(WriteSource::finish_write_to_disk)).unwrap_or(Ok(()))
    }

    /// Bytes accepted from callers that have not reached the fd yet.
    pub fn buffered_len(&self) -> usize {
        self.queued_len() + self.base.payload_len.get()
    }

    /// See `PosixStreamingWriter::queued_len`.
    pub fn queued_len(&self) -> usize {
        self.outgoing.size()
    }

    /// For the next `start` or `flush` to send.
    pub fn enqueue(&self, bytes: &[u8]) {
        self.outgoing.write(bytes);
    }

    pub fn discard_queued(&self) {
        self.outgoing.take();
    }

    pub fn update_ref(&self, value: bool) {
        self.base.update_ref(value);
    }

    fn sync_fd(&self) -> Option<Fd> {
        self.base.sink.with_taken(|sink| match sink {
            Some(Sink::Sync(file)) => Some(file.fd()),
            Some(Sink::Async(_)) | None => None,
        })
    }

    pub fn set_pipe(&self, pipe: Pipe) {
        self.base.set_source(pipe.into());
    }

    pub fn start_own_pipe(
        &self,
        handler: &impl WriteHandler,
        ev: EventLoopHandle,
        pipe: sys::File,
    ) -> sys::Result<()> {
        self.start_with_pipe(handler, Pipe::from_exclusive(ev.loop_().port(), pipe));
        sys::Result::Ok(())
    }

    pub fn start_with_pipe(&self, handler: &impl WriteHandler, pipe: Pipe) {
        self.set_pipe(pipe);
        self.start_with_current_source(handler);
    }

    fn start_with_current_source(&self, handler: &impl WriteHandler) {
        self.base.is_done.set(false);
        // The old source's write never reports completion, so send the queued chunks here.
        self.process_send(handler);
    }

    pub fn start_sync(&self, handler: &impl WriteHandler, file: MaybeOwnedFile) -> sys::Result<()> {
        // Each chunk is written synchronously, so nothing would drain a queue.
        if self.queued_len() > 0 {
            return sys::Result::Err(sys::Error::from_code(sys::E::EBUSY, sys::Tag::write));
        }
        self.base.close_current_sink(handler)?;
        self.base.owns_fd.set(file.is_owned());
        self.base.sink.set(Some(Sink::Sync(file)));
        sys::Result::Ok(())
    }

    pub fn start(
        &self,
        handler: &impl WriteHandler,
        ev: EventLoopHandle,
        file: impl Into<MaybeOwnedFile>,
        _pollable: bool,
    ) -> sys::Result<()> {
        let file = file.into();
        let owns_fd = file.is_owned();
        self.base.close_current_sink(handler)?;
        self.base.open(ev, file)?;
        self.base.owns_fd.set(owns_fd);
        self.start_with_current_source(handler);
        sys::Result::Ok(())
    }

    pub fn on_io(&self, handler: &impl WriteHandler, event: IoEvent) {
        if let IoEvent::Write(WriteEvent::WriteRestNow) = event {
            (self.base).with_source(|source| source.write_rest(self.outgoing.take().slice()));
        }
        if let IoEvent::Write(WriteEvent::VmTeardown) = event
            && self.base.with_source(WriteSource::is_file) == Some(true)
        {
            self.base.close_sink(false);
        }
        match self.base.end_write(handler, event) {
            Some(Ok(written)) => self.on_write_complete(handler, written),
            Some(Err(err)) if self.base.with_source(WriteSource::is_file) == Some(true) => {
                self.close(handler);
                handler.on_error(err);
            }
            Some(Err(err)) => self.report_error_and_close(handler, err),
            None => {}
        }
    }

    fn report_error_and_close(&self, handler: &impl WriteHandler, err: sys::Error) {
        log!("onWrite() = {}", bstr::BStr::new(err.name()));
        handler.on_error(err);
        self.close(handler);
    }

    fn on_write_complete(&self, handler: &impl WriteHandler, written: usize) {
        log!("onWrite({}) ({} left)", written, self.queued_len());

        if self.queued_len() > 0 {
            handler.on_write(written, WriteStatus::Pending);
        } else if self.is_done() {
            // we already call .end lets close the connection
            return handler.on_write(written, WriteStatus::EndOfFile);
        } else {
            handler.on_write(written, WriteStatus::Drained);
        }

        // process pending outgoing data if any
        self.process_send(handler);

        // TODO: should we report writable?
        handler.on_writable();
    }

    /// this tries to send more data returning if we are writable or not after this
    fn process_send(&self, handler: &impl WriteHandler) -> WriteResult {
        log!("processSend");
        if self.base.payload_len.get() > 0 {
            // we have some pending async request, the next outgoing data will be processed after this finish
            return WriteResult::Pending(0);
        }
        // nothing todo (we assume we are writable until we try to write something)
        if self.queued_len() == 0 {
            return WriteResult::Wrote(0);
        }
        match self.submit_outgoing() {
            sys::Result::Ok(()) => {
                handler.set_has_inflight_write(true);
                WriteResult::Pending(0)
            }
            sys::Result::Err(err) => {
                self.report_error_and_close(handler, err.clone());
                WriteResult::Err(err)
            }
        }
    }

    fn submit_outgoing(&self) -> sys::Result<()> {
        let outgoing = self.outgoing.list.replace(self.base.spare.take());
        self.base.submit(Payload::Owned(outgoing))
    }

    /// `None`: `chunk` was queued and the caller has to `process_send`.
    fn write_without_reporting(&self, chunk: WriteChunk<'_>) -> Option<WriteResult> {
        if self.is_done() {
            return Some(WriteResult::Done(0));
        }
        let chunk = match chunk {
            WriteChunk::Latin1(bytes) if bun_core::strings::is_all_ascii(bytes) => {
                WriteChunk::Bytes(bytes)
            }
            chunk => chunk,
        };
        if let Some(fd) = self.sync_fd() {
            let result = match chunk {
                WriteChunk::Bytes(bytes) => write_sync(fd, bytes),
                chunk => {
                    self.outgoing.write_chunk(chunk);
                    self.outgoing
                        .with_taken(|outgoing| write_sync(fd, outgoing.slice()))
                }
            };
            self.outgoing.reset();
            return Some(result);
        }

        let had_buffered_data = self.queued_len() > 0;
        self.outgoing.write_chunk(chunk);
        if !had_buffered_data && self.base.with_source(WriteSource::is_console) == Some(true) {
            let len = self.queued_len();
            let result = self.outgoing.with_taken(|outgoing| {
                (self.base).with_source(|source| source.write_to_console(outgoing.slice()))
            });
            self.outgoing.reset();
            return result.flatten().map(|result| match result {
                sys::Result::Ok(()) => WriteResult::Wrote(len),
                sys::Result::Err(err) => WriteResult::Err(err),
            });
        }
        had_buffered_data.then_some(WriteResult::Pending(0))
    }

    fn write_chunk(&self, handler: &impl WriteHandler, chunk: WriteChunk<'_>) -> WriteResult {
        self.write_without_reporting(chunk)
            .unwrap_or_else(|| self.process_send(handler))
    }

    pub fn write_utf16(&self, handler: &impl WriteHandler, buf: &[u16]) -> WriteResult {
        self.write_chunk(handler, WriteChunk::Utf16(buf))
    }

    pub fn write_latin1(&self, handler: &impl WriteHandler, buf: &[u8]) -> WriteResult {
        self.write_chunk(handler, WriteChunk::Latin1(buf))
    }

    pub fn write(&self, handler: &impl WriteHandler, buf: &[u8]) -> WriteResult {
        self.write_chunk(handler, WriteChunk::Bytes(buf))
    }

    pub fn flush(&self, handler: &impl WriteHandler) -> WriteResult {
        if self.is_done() {
            return WriteResult::Done(0);
        }
        self.process_send(handler)
    }

    /// For a writer that is idle. `true` if `parts` went out at once, which is not reported then.
    pub fn write_now(&self, handler: &impl WriteHandler, parts: &[&[u8]]) -> bool {
        debug_assert!(!self.has_pending_data());
        let mut payload = self.base.spare.take();
        for part in parts {
            payload.extend_from_slice(part);
        }
        match self.base.submit_now(payload) {
            sys::Result::Ok(true) => return true,
            sys::Result::Ok(false) => handler.set_has_inflight_write(true),
            sys::Result::Err(err) => self.report_error_and_close(handler, err),
        }
        false
    }

    pub fn end(&self, handler: &impl WriteHandler) {
        if self.base.is_done.replace(true) {
            return;
        }
        self.base.closed_without_reporting.set(false);
        // A source has a duplicate of what it does not own.
        if !self.has_pending_data() && (self.owns_fd() || self.sync_fd().is_none()) {
            self.close(handler);
        }
    }

    pub fn close(&self, handler: &impl WriteHandler) {
        self.base.close(handler, true);
    }

    pub fn close_without_reporting(&self, handler: &impl WriteHandler) {
        if self.base.has_sink() {
            self.base.closed_without_reporting.set(true);
            self.close(handler);
        }
    }
}

#[cfg(windows)]
fn write_sync(fd: Fd, bytes: &[u8]) -> WriteResult {
    use sys::windows::{FILE_TYPE_PIPE, GetFileType, named_pipe};
    let (mut remain, mut max_len) = (bytes, usize::MAX);
    while !remain.is_empty() {
        let len = remain.len().min(max_len);
        match sys::write(fd, &remain[..len]) {
            sys::Result::Err(err) => return WriteResult::Err(err),
            sys::Result::Ok(0) if GetFileType(fd.native()) == FILE_TYPE_PIPE => {
                max_len = named_pipe::after_empty_write(fd.native(), len);
                std::thread::sleep(core::time::Duration::from_millis(1));
            }
            sys::Result::Ok(0) => break,
            sys::Result::Ok(wrote) => remain = &remain[wrote..],
        }
    }

    match bytes.len() - remain.len() {
        0 => WriteResult::Done(0),
        wrote => WriteResult::Wrote(wrote),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Platform aliases
// ──────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
pub type BufferedWriter = PosixBufferedWriter;
#[cfg(not(unix))]
pub type BufferedWriter = WindowsBufferedWriter;

#[cfg(unix)]
pub type StreamingWriter = PosixStreamingWriter;
#[cfg(not(unix))]
pub type StreamingWriter = WindowsStreamingWriter;
