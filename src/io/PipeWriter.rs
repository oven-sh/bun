use core::cell::Cell;
#[cfg(windows)]
use core::cell::UnsafeCell;
#[cfg(windows)]
use core::ffi::c_void;
use core::mem;

use bun_collections::ByteVecExt;
use bun_core::OOM;
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::{self as sys, Fd};

use crate::{EventLoopHandle, IoEvent, Owner};
#[cfg(unix)]
use crate::{FilePoll, FilePollFlag};

#[cfg(unix)]
use crate::pipes::{FileType, PollOrFd};
#[cfg(windows)]
use crate::posix_event_loop::__bun_run_io;
#[cfg(windows)]
use crate::source::{File, Source};

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
    /// Comes with `on_close`.
    fn on_error(&self, err: sys::Error);
    fn on_close(&self);
    /// Only from a `StreamingWriter`.
    #[cfg(windows)]
    fn on_writable(&self) {}
    /// From `true` to `false` libuv uses the writer, and dropping it panics.
    #[cfg(windows)]
    fn on_write_in_flight(&self, in_flight: bool);
}

/// The handler of a `BufferedWriter`, which has the bytes.
pub trait BufferedWriteHandler: WriteHandler {
    /// Lends `f` what is to be written next.
    fn with_buffer<R>(&self, f: impl FnOnce(&[u8]) -> R) -> R;
}

// ──────────────────────────────────────────────────────────────────────────
// PosixPipeWriter
// ──────────────────────────────────────────────────────────────────────────

/// What both writers write through.
#[cfg(unix)]
struct PosixPipeWriter {
    handle: PollOrFd,
    /// Set once `pwritev2(RWF_NOWAIT)` said this fd's file type does not support it, so we stop asking.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    rwf_unsupported: Cell<bool>,
    closed_without_reporting: Cell<bool>,
}

#[cfg(unix)]
impl PosixPipeWriter {
    const fn closed() -> Self {
        Self {
            handle: PollOrFd::closed(),
            #[cfg(any(target_os = "linux", target_os = "android"))]
            rwf_unsupported: Cell::new(false),
            closed_without_reporting: Cell::new(false),
        }
    }

    fn get_file_type(&self) -> FileType {
        (self.handle.with_poll(FilePoll::file_type)).unwrap_or(FileType::File)
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
    fn write_on(&self, event: IoEvent, force_sync: bool, buf: &[u8]) -> Option<WriteResult> {
        log!("onPoll({})", buf.len());
        if buf.is_empty() {
            return event.is_hup().then_some(WriteResult::Wrote(0));
        }
        let room = match usize::try_from(event.size_or_offset) {
            Ok(room) if room > 0 && self.get_file_type().is_blocking() => room,
            _ => usize::MAX,
        };
        Some(self.try_write(force_sync, &buf[..buf.len().min(room)]))
    }

    fn register_poll(&self) -> sys::Result<()> {
        self.handle.register(FilePollFlag::Writable)
    }

    fn start_polling(&self, ev: EventLoopHandle, fd: Fd) -> sys::Result<()> {
        let had_poll = self.handle.has_poll();
        if !had_poll {
            self.handle.set_poll(ev, fd);
        } else if fd != self.handle.get_fd() {
            return sys::Result::Err(sys::Error::from_code(sys::E::EBUSY, sys::Tag::write));
        }
        self.register_poll().inspect_err(|_| {
            // A poll from an earlier start() still holds that start's fd.
            if !had_poll {
                self.handle.set_fd(Fd::INVALID);
            }
        })
    }

    fn update_ref(&self, value: bool) {
        (self.handle).with_poll(|poll| poll.set_keeping_process_alive(value));
    }

    fn close_without_reporting(&self, close_fd: bool) {
        if !self.handle.is_closed() {
            debug_assert!(!self.closed_without_reporting.get());
            self.closed_without_reporting.set(true);
            if close_fd {
                self.handle.close();
            }
        }
    }

    /// `true` if there is a close to report.
    fn close(&self, close_fd: bool) -> bool {
        self.closed_without_reporting.take() || self.handle.close_impl(close_fd)
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
pub struct PosixBufferedWriter {
    pipe: PosixPipeWriter,
    owns_fd: bool,
}

#[cfg(unix)]
impl PosixBufferedWriter {
    /// Unless it `owns_fd`, closing it leaves the fd open.
    pub fn new(owns_fd: bool) -> Self {
        Self {
            pipe: PosixPipeWriter::closed(),
            owns_fd,
        }
    }

    /// SAFETY: see `PosixStreamingWriter::set_owner`.
    pub unsafe fn set_owner(&self, owner: Owner) {
        // SAFETY: caller contract.
        unsafe { self.pipe.handle.set_owner(owner) };
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>()
    }

    pub fn is_closed(&self) -> bool {
        self.pipe.handle.is_closed()
    }

    pub fn has_poll(&self) -> bool {
        self.pipe.handle.has_poll()
    }

    pub fn is_watching(&self) -> bool {
        self.pipe.handle.is_watching()
    }

    pub fn set_poll_flag(&self, flag: FilePollFlag) {
        self.pipe.handle.set_poll_flag(flag);
    }

    pub fn on_io(&self, handler: &impl BufferedWriteHandler, event: IoEvent) {
        match handler.with_buffer(|buf| self.pipe.write_on(event, false, buf)) {
            None => {}
            Some(WriteResult::Pending(wrote)) => {
                if wrote > 0 {
                    handler.on_write(wrote, WriteStatus::Pending);
                }
                self.register_poll(handler);
            }
            Some(WriteResult::Wrote(amt)) => handler.on_write(amt, WriteStatus::Drained),
            Some(WriteResult::Err(err)) => self.report_error(handler, err),
            Some(WriteResult::Done(amt)) => {
                self.pipe.close_without_reporting(self.owns_fd);
                handler.on_write(amt, WriteStatus::EndOfFile);
                self.close(handler);
            }
        }
    }

    fn report_error(&self, handler: &impl WriteHandler, err: sys::Error) {
        debug_assert!(!err.is_retry());
        handler.on_error(err);
        self.close(handler);
    }

    pub fn register_poll(&self, handler: &impl WriteHandler) {
        if let sys::Result::Err(err) = self.pipe.register_poll() {
            self.report_error(handler, err);
        }
    }

    pub fn close(&self, handler: &impl WriteHandler) {
        if self.pipe.close(self.owns_fd) {
            handler.on_close();
        }
    }

    pub fn update_ref(&self, value: bool) {
        self.pipe.update_ref(value);
    }

    /// On `Err` the writer holds nothing; `fd` is still the caller's to close. Only Windows reports from here.
    pub fn start(
        &self,
        _: &impl BufferedWriteHandler,
        ev: EventLoopHandle,
        fd: Fd,
        pollable: bool,
    ) -> sys::Result<()> {
        if !pollable {
            debug_assert!(!self.has_poll());
            self.pipe.handle.set_fd(fd);
            return sys::Result::Ok(());
        }
        self.pipe.start_polling(ev, fd)?;
        self.update_ref(true);
        sys::Result::Ok(())
    }
}

#[cfg(unix)]
impl Drop for PosixBufferedWriter {
    fn drop(&mut self) {
        self.pipe.handle.close_impl(self.owns_fd);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PosixStreamingWriter
// ──────────────────────────────────────────────────────────────────────────

/// Shared borrows only: a handler can reach the writer again.
#[cfg(unix)]
pub struct PosixStreamingWriter {
    pipe: PosixPipeWriter,
    outgoing: Cell<StreamBuffer>,
    is_done: Cell<bool>,
    force_sync: Cell<bool>,
    /// Last reported `WriteStatus == Pending` (i.e. write(2) returned EAGAIN).
    backed_up: Cell<bool>,
}

#[cfg(unix)]
impl Default for PosixStreamingWriter {
    fn default() -> Self {
        Self {
            pipe: PosixPipeWriter::closed(),
            outgoing: Cell::default(),
            is_done: Cell::new(false),
            force_sync: Cell::new(false),
            backed_up: Cell::new(false),
        }
    }
}

/// The result of a write, and what `report` does about it.
#[cfg(unix)]
enum Written {
    /// Waits in `outgoing` for more.
    Coalesced(usize),
    Tried(WriteResult),
    /// The writer has ended.
    Refused,
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
    /// SAFETY: `owner` is what `__bun_run_io` takes its tag for, until `self` is dropped. `self` does
    /// not move, and is not borrowed mutably, until then.
    pub unsafe fn set_owner(&self, owner: Owner) {
        // SAFETY: caller contract.
        unsafe { self.pipe.handle.set_owner(owner) };
    }

    pub fn owner(&self) -> Owner {
        self.pipe.handle.owner()
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + with_buffer(&self.outgoing, |outgoing| outgoing.memory_cost())
    }

    pub fn set_force_sync(&self, value: bool) {
        self.force_sync.set(value);
    }

    pub fn set_poll_flag(&self, flag: FilePollFlag) {
        self.pipe.handle.set_poll_flag(flag);
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
        with_buffer(&self.outgoing, |outgoing| outgoing.size())
    }

    /// The part of `buffered_len` that `flush` would send.
    pub fn queued_len(&self) -> usize {
        self.buffered_len()
    }

    fn should_buffer(&self, len: usize) -> bool {
        !self.force_sync.get() && len < Self::CHUNK_SIZE
    }

    fn has_ended(&self) -> bool {
        self.is_done.get() || self.pipe.closed_without_reporting.get()
    }

    fn report_write(&self, handler: &impl WriteHandler, amount: usize, status: WriteStatus) {
        // on_write may re-enter write(); record first so re-entry leaves the newer value.
        self.backed_up.set(status == WriteStatus::Pending);
        handler.on_write(amount, status);
    }

    fn report_error(&self, handler: &impl WriteHandler, err: sys::Error) {
        handler.on_error(err);
        self.close(handler);
    }

    fn register_poll(&self, handler: &impl WriteHandler) {
        if let sys::Result::Err(err) = self.pipe.register_poll() {
            self.report_error(handler, err);
        }
    }

    pub fn on_io(&self, handler: &impl WriteHandler, event: IoEvent) {
        match self.drain_on(event) {
            None => {}
            Some(WriteResult::Pending(wrote)) => {
                if wrote > 0 {
                    self.report_write(handler, wrote, WriteStatus::Pending);
                }
                self.register_poll(handler);
            }
            // If the handler buffers more data, `write()` registers the poll.
            Some(WriteResult::Wrote(amt)) => self.report_write(handler, amt, WriteStatus::Drained),
            Some(WriteResult::Err(err)) => self.report_error(handler, err),
            Some(WriteResult::Done(amt)) => self.report_write(handler, amt, WriteStatus::EndOfFile),
        }
    }

    fn drain_on(&self, event: IoEvent) -> Option<WriteResult> {
        with_buffer(&self.outgoing, |outgoing| {
            let rc = (self.pipe).write_on(event, self.force_sync.get(), outgoing.slice())?;
            match rc {
                WriteResult::Pending(amt) => outgoing.wrote(amt),
                WriteResult::Wrote(amt) => {
                    outgoing.wrote(amt);
                    if outgoing.is_empty() {
                        outgoing.reset();
                    }
                }
                WriteResult::Done(amt) => {
                    outgoing.wrote(amt);
                    if !self.is_done.get() {
                        self.pipe.close_without_reporting(true);
                    }
                }
                WriteResult::Err(ref err) => {
                    debug_assert!(!err.is_retry());
                    self.pipe.close_without_reporting(true);
                    self.is_done.set(true);
                    outgoing.reset();
                }
            }
            Some(rc)
        })
    }

    fn report(&self, handler: &impl WriteHandler, written: Written) -> WriteResult {
        match written {
            Written::Refused => WriteResult::Done(0),
            Written::Coalesced(amt) => {
                // Lets the handler schedule a flush.
                self.report_write(handler, amt, WriteStatus::Drained);
                self.register_poll(handler);

                // it's buffered, but should be reported as written to callers
                WriteResult::Wrote(amt)
            }
            Written::Tried(rc) => {
                match rc {
                    WriteResult::Pending(amt) => {
                        self.report_write(handler, amt, WriteStatus::Pending);
                        self.register_poll(handler);
                    }
                    WriteResult::Wrote(amt) => {
                        self.report_write(handler, amt, WriteStatus::Drained)
                    }
                    WriteResult::Done(amt) => {
                        self.report_write(handler, amt, WriteStatus::EndOfFile)
                    }
                    WriteResult::Err(_) => {}
                }
                rc
            }
        }
    }

    pub fn write_utf16(&self, handler: &impl WriteHandler, buf: &[u16]) -> WriteResult {
        self.report(handler, self.accept_utf16(buf))
    }

    pub fn write_latin1(&self, handler: &impl WriteHandler, buf: &[u8]) -> WriteResult {
        self.report(handler, self.accept_latin1(buf))
    }

    pub fn write(&self, handler: &impl WriteHandler, buf: &[u8]) -> WriteResult {
        self.report(handler, self.accept(buf))
    }

    fn accept_utf16(&self, buf: &[u16]) -> Written {
        self.accept_encoded(|outgoing| outgoing.write_utf16(buf))
    }

    fn accept_latin1(&self, buf: &[u8]) -> Written {
        if bun_core::strings::is_all_ascii(buf) {
            return self.accept(buf);
        }

        const CHECK_ASCII: bool = false;
        self.accept_encoded(|outgoing| outgoing.write_latin1::<CHECK_ASCII>(buf))
    }

    fn accept_encoded(&self, encode: impl FnOnce(&mut StreamBuffer) -> Result<(), OOM>) -> Written {
        if self.has_ended() {
            return Written::Refused;
        }
        with_buffer(&self.outgoing, |outgoing| {
            let before_len = outgoing.size();
            if encode(outgoing).is_err() {
                return Written::Tried(WriteResult::Err(sys::Error::oom()));
            }
            if self.should_buffer(outgoing.size()) {
                return Written::Coalesced(outgoing.size() - before_len);
            }
            self.try_write_newly_buffered_data(outgoing)
        })
    }

    fn try_write_newly_buffered_data(&self, outgoing: &mut StreamBuffer) -> Written {
        let rc = self.pipe.try_write(self.force_sync.get(), outgoing.slice());
        match rc {
            WriteResult::Wrote(_) | WriteResult::Done(_) => outgoing.reset(),
            WriteResult::Pending(amt) => outgoing.wrote(amt),
            WriteResult::Err(_) => {}
        }
        Written::Tried(rc)
    }

    fn accept(&self, buf: &[u8]) -> Written {
        if self.has_ended() {
            return Written::Refused;
        }
        with_buffer(&self.outgoing, |outgoing| {
            // this is streaming, but we buffer the data below `chunk_size` to
            // reduce the number of writes
            let should_buffer = self.should_buffer(outgoing.size() + buf.len());
            // make sure write is in-order
            if should_buffer || outgoing.is_not_empty() {
                if outgoing.write(buf).is_err() {
                    return Written::Tried(WriteResult::Err(sys::Error::oom()));
                }
                if should_buffer {
                    return Written::Coalesced(buf.len());
                }
                return self.try_write_newly_buffered_data(outgoing);
            }

            let rc = self.pipe.try_write(self.force_sync.get(), buf);
            match rc {
                WriteResult::Pending(amt) => {
                    if outgoing.write(&buf[amt..]).is_err() {
                        return Written::Tried(WriteResult::Err(sys::Error::oom()));
                    }
                }
                WriteResult::Wrote(_) | WriteResult::Done(_) => outgoing.reset(),
                WriteResult::Err(_) => {}
            }
            Written::Tried(rc)
        })
    }

    /// Only Windows reports from here.
    pub fn flush(&self, _: &impl WriteHandler) -> WriteResult {
        self.drain()
    }

    fn drain(&self) -> WriteResult {
        if self.has_ended() {
            return WriteResult::Done(0);
        }
        with_buffer(&self.outgoing, |outgoing| {
            if outgoing.is_empty() {
                outgoing.reset();
                return WriteResult::Wrote(0);
            }

            let rc = self.pipe.try_write(self.force_sync.get(), outgoing.slice());
            match rc {
                WriteResult::Pending(written) => outgoing.wrote(written),
                _ => outgoing.reset(),
            }
            // Leftover bytes = kernel refused them.
            self.backed_up.set(outgoing.is_not_empty());
            rc
        })
    }

    pub fn update_ref(&self, value: bool) {
        if value && self.is_done.get() {
            return;
        }
        self.pipe.update_ref(value);
    }

    pub fn end(&self, handler: &impl WriteHandler) {
        if !self.is_done.replace(true) {
            self.close(handler);
        }
    }

    pub fn close(&self, handler: &impl WriteHandler) {
        if self.pipe.close(true) {
            handler.on_close();
        }
    }

    /// On `Err` the writer holds nothing; `fd` is still the caller's to close.
    pub fn start(
        &self,
        handler: &impl WriteHandler,
        ev: EventLoopHandle,
        fd: Fd,
        is_pollable: bool,
    ) -> sys::Result<()> {
        if is_pollable {
            return self.pipe.start_polling(ev, fd);
        }
        self.close(handler);
        self.pipe.handle.set_fd(fd);
        sys::Result::Ok(())
    }
}

#[cfg(unix)]
impl Drop for PosixStreamingWriter {
    fn drop(&mut self) {
        self.pipe.handle.close();
    }
}

/// What libuv completed.
#[cfg(windows)]
pub struct WriteEvent(Completion);

#[cfg(windows)]
enum Completion {
    Wrote,
    Canceled,
    StreamFailed(sys::Error),
    FileFailed(sys::Error),
    VmTeardown,
}

/// A source, and the one write that libuv may have on it. Shared borrows only: libuv holds its address.
#[cfg(windows)]
struct WindowsPipeWriter {
    source: Cell<Option<Source>>,
    owner: Cell<Owner>,
    /// `false` for a file descriptor that was passed in, which is left open.
    owns_fd: Cell<bool>,
    is_done: Cell<bool>,
    closed_without_reporting: Cell<bool>,
    /// libuv reads the bytes that were submitted, and for a stream uses `write_req`.
    in_flight: Cell<bool>,
    write_req: UnsafeCell<uv::uv_write_t>,
    /// Of the write in flight, or of one that failed.
    payload: Cell<StreamBuffer>,
    /// See `WindowsBufferedWriter::orphan`.
    orphan: Cell<Option<(*mut (), unsafe fn(*mut ()))>>,
}

#[cfg(windows)]
impl WindowsPipeWriter {
    fn closed() -> Self {
        Self {
            source: Cell::new(None),
            owner: Cell::new(Owner::NULL),
            owns_fd: Cell::new(true),
            is_done: Cell::new(false),
            closed_without_reporting: Cell::new(false),
            in_flight: Cell::new(false),
            write_req: UnsafeCell::new(bun_core::ffi::zeroed()),
            payload: Cell::default(),
            orphan: Cell::new(None),
        }
    }

    /// `None` without a source. `f` finds `self` without one.
    fn with_source<R>(&self, f: impl FnOnce(&mut Source) -> R) -> Option<R> {
        let mut source = self.source.take()?;
        let result = f(&mut source);
        self.source.set(Some(source));
        Some(result)
    }

    fn has_source(&self) -> bool {
        self.with_source(|_| ()).is_some()
    }

    fn payload_len(&self) -> usize {
        with_buffer(&self.payload, |payload| payload.size())
    }

    /// `self` for libuv to keep, which `set_owner`'s contract allows.
    fn as_uv_data(&self) -> *mut Self {
        assert!(!self.owner.get().ptr().is_null(), "writer has no owner");
        core::ptr::from_ref(self).cast_mut()
    }

    /// From now on a VM teardown closes `source` through this writer.
    fn set_source(&self, mut source: Source) {
        assert!(!self.has_source() && !self.in_flight.get());
        source.set_owner(self.as_uv_data().cast(), Self::stop_for_vm_teardown);
        self.source.set(Some(source));
    }

    fn update_ref(&self, value: bool) {
        self.with_source(if value { Source::ref_ } else { Source::unref });
    }

    /// The owner may free `self`.
    /// SAFETY: `this` is `as_uv_data` of a live writer.
    unsafe fn dispatch(this: *mut Self, completion: Completion) {
        let event = IoEvent::Write(WriteEvent(completion));
        // SAFETY: fn contract, and `set_owner`'s.
        unsafe { __bun_run_io((*this).owner.get(), event) };
    }

    /// `uv::open_handles` closes this writer's stream through here at teardown.
    unsafe fn stop_for_vm_teardown(this: *mut c_void) {
        // SAFETY: recorded by `set_source`. Closing the source takes it off the list.
        unsafe { Self::dispatch(this.cast(), Completion::VmTeardown) };
    }

    fn on_stream_write(this: *mut Self, status: uv::ReturnCode) {
        let completion = match status.to_error(sys::Tag::write) {
            Some(err) => Completion::StreamFailed(err),
            None => Completion::Wrote,
        };
        // SAFETY: set by `submit_buf`. `Drop` does not return while the write is in flight. `free` has `orphan`'s contract.
        unsafe {
            (*this).in_flight.set(false);
            match (*this).orphan.get() {
                Some((ptr, free)) => free(ptr),
                None => Self::dispatch(this, completion),
            }
        }
    }

    unsafe extern "C" fn on_file_write(fs: *mut uv::fs_t) {
        // SAFETY: the callback of `submit_write`.
        let Some((result, this)) = (unsafe { File::on_complete(fs) }) else {
            return;
        };
        let completion = match result.to_error(sys::Tag::write) {
            _ if result.int() == uv::UV_ECANCELED as i64 => Completion::Canceled,
            Some(err) => Completion::FileFailed(err),
            None => Completion::Wrote,
        };
        let this = this.cast::<Self>();
        // SAFETY: set by `set_source`, and cleared by dropping the file.
        unsafe {
            (*this).in_flight.set(false);
            Self::dispatch(this, completion);
        }
    }

    /// Returns the length it had.
    fn reset_payload(&self) -> usize {
        assert!(!self.in_flight.get());
        with_buffer(&self.payload, |payload| {
            let len = payload.size();
            payload.reset();
            len
        })
    }

    /// Writes the payload that `fill` leaves, which does not run without a source.
    fn submit(&self, fill: impl FnOnce(&mut StreamBuffer)) -> sys::Result<()> {
        let buf = || {
            with_buffer(&self.payload, |payload| {
                fill(payload);
                uv::uv_buf_t::init(payload.slice())
            })
        };
        // SAFETY: nothing changes the payload in flight but `close_source`, which gives it to the file.
        unsafe { self.submit_buf(buf) }
    }

    /// SAFETY: on `Ok` the bytes of `buf` stay until libuv calls back.
    unsafe fn submit_buf(&self, buf: impl FnOnce() -> uv::uv_buf_t) -> sys::Result<()> {
        assert!(!self.in_flight.get());
        let submitted = self.with_source(|source| {
            let buf = buf();
            match source {
                Source::SyncFile(_) => panic!("sync_file pipe write should not be reachable"),
                // SAFETY: fn contract.
                Source::File(file) => unsafe { file.submit_write(buf, Self::on_file_write) },
                // SAFETY: the request is libuv's until `on_stream_write`. It copies `buf`.
                stream => unsafe { &mut *self.write_req.get() }
                    .write(
                        stream.to_stream(),
                        &buf,
                        self.as_uv_data(),
                        Self::on_stream_write,
                    )
                    .to_result(sys::Tag::write),
            }
        });
        submitted.unwrap_or_else(|| Err(sys::Error::from_code(sys::E::PIPE, sys::Tag::pipe)))?;
        self.in_flight.set(true);
        sys::Result::Ok(())
    }

    /// `false` if there was none. `cancel_inflight_write` cancels a `uv_fs_write` that hasn't started yet.
    fn close_source(&self, cancel_inflight_write: bool) -> bool {
        self.is_done.set(true);
        let Some(source) = self.source.take() else {
            return false;
        };
        match source {
            Source::SyncFile(file) | Source::File(file) => {
                if file.is_busy() {
                    // The write still reads the payload, and its callback will not get back here.
                    file.buffer.set(self.payload.take().list);
                    self.in_flight.set(false);
                }
                file.close_on_drop.set(self.owns_fd.get());
                if cancel_inflight_write {
                    file.stop();
                }
            }
            Source::Pipe(pipe) => drop(pipe),
            Source::Tty(tty) => tty.close(),
        }
        true
    }

    fn close(&self, handler: &impl WriteHandler, cancel_inflight_write: bool) {
        let was_in_flight = self.in_flight.get();
        if !self.close_source(cancel_inflight_write) {
            return;
        }
        if was_in_flight && !self.in_flight.get() {
            handler.on_write_in_flight(false);
        }
        if !self.closed_without_reporting.get() {
            handler.on_close();
        }
    }

    /// Closes the old source before a restart, like the POSIX writer.
    fn close_for_restart(&self, handler: &impl WriteHandler) -> sys::Result<()> {
        // The callback of a cancelled `uv_write` would close the new source.
        if self.in_flight.get() && self.with_source(|source| source.file().is_some()) != Some(true)
        {
            return sys::Result::Err(sys::Error::from_code(sys::E::BUSY, sys::Tag::write));
        }
        // Canceling an in-flight write would drop its bytes, so let it finish writing to the old file.
        self.close(handler, false);
        // The handler has started the writer.
        if self.has_source() || self.in_flight.get() {
            return sys::Result::Err(sys::Error::from_code(sys::E::BUSY, sys::Tag::write));
        }
        // Free a failed write's payload.
        self.payload.take();
        self.is_done.set(false);
        sys::Result::Ok(())
    }
}

#[cfg(windows)]
impl Drop for WindowsPipeWriter {
    fn drop(&mut self) {
        self.close_source(true);
        assert!(!self.in_flight.get(), "writer dropped under a uv_write");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WindowsBufferedWriter
// ──────────────────────────────────────────────────────────────────────────

/// Shared borrows only: a handler can reach the writer again.
#[cfg(windows)]
pub struct WindowsBufferedWriter {
    pipe: WindowsPipeWriter,
    pending_payload_size: Cell<usize>,
}

#[cfg(windows)]
impl WindowsBufferedWriter {
    /// See `PosixBufferedWriter::new`. A pipe or a tty owns its fd either way.
    pub fn new(owns_fd: bool) -> Self {
        let pipe = WindowsPipeWriter::closed();
        pipe.owns_fd.set(owns_fd);
        Self {
            pipe,
            pending_payload_size: Cell::new(0),
        }
    }

    /// SAFETY: see `PosixStreamingWriter::set_owner`.
    pub unsafe fn set_owner(&self, owner: Owner) {
        self.pipe.owner.set(owner);
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + with_buffer(&self.pipe.payload, |payload| payload.memory_cost())
    }

    pub fn is_closed(&self) -> bool {
        !self.pipe.has_source()
    }

    /// A pipe or a tty.
    pub fn is_stream(&self) -> bool {
        self.pipe.with_source(|source| source.file().is_none()) == Some(true)
    }

    pub fn update_ref(&self, value: bool) {
        self.pipe.update_ref(value);
    }

    pub fn set_pipe(&self, pipe: uv::Owned<uv::Pipe>) {
        self.pipe.set_source(Source::Pipe(pipe));
    }

    pub fn start_with_current_pipe(&self, handler: &impl BufferedWriteHandler) {
        debug_assert!(self.pipe.has_source());
        self.pipe.is_done.set(false);
        self.write(handler);
    }

    pub fn start_with_file(
        &self,
        handler: &impl BufferedWriteHandler,
        ev: EventLoopHandle,
        fd: Fd,
    ) {
        (self.pipe).set_source(Source::File(Source::open_file(ev.loop_(), fd)));
        self.start_with_current_pipe(handler);
    }

    /// A pipe or a tty owns `fd` on `Ok`.
    pub fn start(
        &self,
        handler: &impl BufferedWriteHandler,
        ev: EventLoopHandle,
        fd: Fd,
        _pollable: bool,
    ) -> sys::Result<()> {
        self.pipe.close_for_restart(handler)?;
        self.pipe.set_source(Source::open(ev.loop_(), fd)?);
        self.start_with_current_pipe(handler);
        sys::Result::Ok(())
    }

    pub fn on_io(&self, handler: &impl BufferedWriteHandler, event: IoEvent) {
        let IoEvent::Write(WriteEvent(completion)) = event else {
            unreachable!("a read was passed to a writer");
        };
        if !matches!(completion, Completion::VmTeardown) {
            handler.on_write_in_flight(false);
        }
        match completion {
            Completion::Wrote => {
                let written = self.pending_payload_size.get();
                // After a `close()` the handler may have less than what was written.
                let has_pending_data = handler.with_buffer(<[u8]>::len) > written;
                let status = if self.pipe.is_done.get() && !has_pending_data {
                    WriteStatus::Drained
                } else {
                    WriteStatus::Pending
                };
                handler.on_write(written, status);
            }
            Completion::Canceled => {}
            Completion::StreamFailed(err) | Completion::FileFailed(err) => {
                self.report_error(handler, err);
            }
            Completion::VmTeardown => self.close(handler),
        }
    }

    fn report_error(&self, handler: &impl WriteHandler, err: sys::Error) {
        self.close(handler);
        handler.on_error(err);
    }

    /// `false` if there is nothing to write, or not now.
    fn begin_write(&self, buffer: &[u8]) -> bool {
        let pipe = &self.pipe;
        if pipe.is_done.get() || pipe.in_flight.get() || buffer.is_empty() || !pipe.has_source() {
            return false;
        }
        self.pending_payload_size.set(buffer.len());
        true
    }

    fn submit_copy(&self, buffer: &[u8]) -> Option<sys::Result<()>> {
        self.begin_write(buffer).then(|| {
            self.pipe.submit(|payload| {
                payload.list.clear();
                payload.list.extend_from_slice(buffer);
            })
        })
    }

    /// SAFETY: see `write_lent`.
    unsafe fn submit_lent(&self, buffer: &[u8]) -> Option<sys::Result<()>> {
        self.begin_write(buffer).then(|| {
            assert!(self.is_stream());
            // SAFETY: fn contract. A write to a stream is in flight until its callback.
            unsafe { self.pipe.submit_buf(|| uv::uv_buf_t::init(buffer)) }
        })
    }

    fn report_submitted(&self, handler: &impl WriteHandler, submitted: Option<sys::Result<()>>) {
        match submitted {
            None => {}
            Some(sys::Result::Ok(())) => handler.on_write_in_flight(true),
            Some(sys::Result::Err(err)) => self.report_error(handler, err),
        }
    }

    pub fn write(&self, handler: &impl BufferedWriteHandler) {
        let submitted = handler.with_buffer(|buffer| self.submit_copy(buffer));
        self.report_submitted(handler, submitted);
    }

    /// `write` to a stream, without a copy.
    /// SAFETY: the bytes that `handler` lends stay as they are while the write is in flight.
    pub unsafe fn write_lent(&self, handler: &impl BufferedWriteHandler) {
        // SAFETY: fn contract.
        let submitted = handler.with_buffer(|buffer| unsafe { self.submit_lent(buffer) });
        self.report_submitted(handler, submitted);
    }

    pub fn close(&self, handler: &impl WriteHandler) {
        self.pipe.close(handler, true);
    }

    /// Closes without reporting. `true` if a write is still in flight, whose callback calls `free(ptr)`.
    /// SAFETY: after `true`, `self` stays until `free(ptr)`, which may be called then.
    pub unsafe fn orphan(&self, ptr: *mut (), free: unsafe fn(*mut ())) -> bool {
        self.pipe.close_source(true);
        let in_flight = self.pipe.in_flight.get();
        self.pipe.orphan.set(in_flight.then_some((ptr, free)));
        in_flight
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

    pub(crate) fn maybe_shrink(&mut self) {
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

    pub fn memory_cost(&self) -> usize {
        self.list.capacity()
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

    /// `chunk` as UTF-8, which goes through `self` only if it has to be encoded.
    #[cfg(windows)]
    fn write_or_fallback<'a>(&'a mut self, chunk: WriteChunk<'a>) -> Result<&'a [u8], OOM> {
        match chunk {
            WriteChunk::Bytes(bytes) => return Ok(bytes),
            WriteChunk::Latin1(bytes) if bun_core::strings::is_all_ascii(bytes) => {
                return Ok(bytes);
            }
            WriteChunk::Latin1(bytes) => self.write_latin1::<false>(bytes)?,
            WriteChunk::Utf16(text) => self.write_utf16(text)?,
        }
        Ok(self.slice())
    }

    pub fn write_latin1<const CHECK_ASCII: bool>(&mut self, buffer: &[u8]) -> Result<(), OOM> {
        if CHECK_ASCII {
            if bun_core::strings::is_all_ascii(buffer) {
                return self.write(buffer);
            }
        }

        self.compact();
        let len = self.list.len();
        let list = mem::take(&mut self.list);
        self.list = bun_core::strings::allocate_latin1_into_utf8_with_list(list, len, buffer);
        Ok(())
    }

    pub fn write_utf16(&mut self, buffer: &[u16]) -> Result<(), OOM> {
        // `ByteVecExt::write_utf16` sizes the spare capacity via
        // `simdutf.length.utf8.from.utf16.le` *before* the simdutf write;
        // calling
        // `convert_utf16_to_utf8_append` directly (its old shortcut) handed
        // simdutf a `Vec::new()` dangling pointer (`0x1`) and segfaulted.
        self.compact();
        ByteVecExt::write_utf16(&mut self.list, buffer)?;
        Ok(())
    }

    pub fn slice(&self) -> &[u8] {
        &self.list[self.cursor..]
    }
}

/// `f` finds `cell` empty.
fn with_buffer<R>(cell: &Cell<StreamBuffer>, f: impl FnOnce(&mut StreamBuffer) -> R) -> R {
    let mut buffer = cell.take();
    let result = f(&mut buffer);
    cell.set(buffer);
    result
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
pub struct WindowsStreamingWriter {
    pipe: WindowsPipeWriter,
    /// Becomes the payload once the write in flight has ended.
    outgoing: Cell<StreamBuffer>,
}

#[cfg(windows)]
impl Default for WindowsStreamingWriter {
    fn default() -> Self {
        Self {
            pipe: WindowsPipeWriter::closed(),
            outgoing: Cell::default(),
        }
    }
}

#[cfg(windows)]
impl WindowsStreamingWriter {
    /// SAFETY: see `PosixStreamingWriter::set_owner`.
    pub unsafe fn set_owner(&self, owner: Owner) {
        self.pipe.owner.set(owner);
    }

    pub fn owner(&self) -> Owner {
        self.pipe.owner.get()
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>()
            + with_buffer(&self.pipe.payload, |payload| payload.memory_cost())
            + with_buffer(&self.outgoing, |outgoing| outgoing.memory_cost())
    }

    pub fn owns_fd(&self) -> bool {
        self.pipe.owns_fd.get()
    }

    pub fn set_owns_fd(&self, value: bool) {
        self.pipe.owns_fd.set(value);
    }

    pub fn is_done(&self) -> bool {
        self.pipe.is_done.get()
    }

    pub fn has_pending_data(&self) -> bool {
        self.buffered_len() > 0
    }

    /// process_send found a uv_write already in flight (the payload alone is not backpressure).
    pub fn is_backed_up(&self) -> bool {
        self.queued_len() > 0
    }

    /// Bytes accepted from callers that have not reached the fd yet.
    pub fn buffered_len(&self) -> usize {
        self.queued_len() + self.pipe.payload_len()
    }

    /// See `PosixStreamingWriter::queued_len`.
    pub fn queued_len(&self) -> usize {
        with_buffer(&self.outgoing, |outgoing| outgoing.size())
    }

    /// For the next `start` or `flush` to send.
    pub fn enqueue(&self, bytes: &[u8]) -> Result<(), OOM> {
        with_buffer(&self.outgoing, |outgoing| outgoing.write(bytes))
    }

    pub fn discard_queued(&self) {
        self.outgoing.take();
    }

    pub fn update_ref(&self, value: bool) {
        self.pipe.update_ref(value);
    }

    /// `false` if the source is not a stream that can block.
    pub fn set_blocking(&self) -> bool {
        self.get_stream().is_some_and(|stream| {
            // SAFETY: the stream of the source.
            unsafe { uv::uv_stream_set_blocking(stream, 1) == uv::ReturnCode::ZERO }
        })
    }

    pub fn get_stream(&self) -> Option<*mut uv::uv_stream_t> {
        (self.pipe).with_source(|source| source.file().is_none().then(|| source.to_stream()))?
    }

    fn sync_fd(&self) -> Option<Fd> {
        (self.pipe)
            .with_source(|source| matches!(source, Source::SyncFile(_)).then(|| source.get_fd()))?
    }

    pub fn set_pipe(&self, pipe: uv::Owned<uv::Pipe>) {
        self.pipe.set_source(Source::Pipe(pipe));
    }

    pub fn start_with_current_pipe(&self, handler: &impl WriteHandler) {
        debug_assert!(self.pipe.has_source());
        self.pipe.is_done.set(false);
        // The old source's write never reports completion, so send the queued chunks here.
        if self.is_backed_up() && self.sync_fd().is_none() {
            self.process_send(handler);
        }
    }

    pub fn start_sync(
        &self,
        handler: &impl WriteHandler,
        ev: EventLoopHandle,
        fd: Fd,
    ) -> sys::Result<()> {
        // A `SyncFile` writes each chunk synchronously and can't drain a queue.
        if self.is_backed_up() {
            return sys::Result::Err(sys::Error::from_code(sys::E::BUSY, sys::Tag::write));
        }
        self.pipe.close_for_restart(handler)?;
        (self.pipe).set_source(Source::SyncFile(Source::open_file(ev.loop_(), fd)));
        sys::Result::Ok(())
    }

    /// A pipe or a tty owns `fd` on `Ok`.
    pub fn start(
        &self,
        handler: &impl WriteHandler,
        ev: EventLoopHandle,
        fd: Fd,
        _pollable: bool,
    ) -> sys::Result<()> {
        self.pipe.close_for_restart(handler)?;
        self.pipe.set_source(Source::open(ev.loop_(), fd)?);
        self.start_with_current_pipe(handler);
        sys::Result::Ok(())
    }

    pub fn on_io(&self, handler: &impl WriteHandler, event: IoEvent) {
        let IoEvent::Write(WriteEvent(completion)) = event else {
            unreachable!("a read was passed to a writer");
        };
        if !matches!(completion, Completion::VmTeardown) {
            handler.on_write_in_flight(false);
        }
        match completion {
            Completion::Wrote => self.on_write_complete(handler, self.pipe.reset_payload()),
            Completion::Canceled => _ = self.pipe.reset_payload(),
            Completion::StreamFailed(err) => self.report_error(handler, err),
            Completion::FileFailed(err) => {
                self.close(handler);
                handler.on_error(err);
            }
            Completion::VmTeardown => self.close(handler),
        }
    }

    fn report_error(&self, handler: &impl WriteHandler, err: sys::Error) {
        log!("onWrite() = {}", bstr::BStr::new(err.name()));
        handler.on_error(err);
        self.close(handler);
    }

    fn on_write_complete(&self, handler: &impl WriteHandler, written: usize) {
        log!("onWrite({}) ({} left)", written, self.queued_len());

        if self.is_backed_up() {
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
        if self.pipe.payload_len() > 0 {
            // we have some pending async request, the next outgoing data will be processed after this finish
            return WriteResult::Pending(0);
        }
        // nothing todo (we assume we are writable until we try to write something)
        if !self.is_backed_up() {
            return WriteResult::Wrote(0);
        }
        match self.submit_outgoing() {
            sys::Result::Ok(()) => {
                handler.on_write_in_flight(true);
                WriteResult::Pending(0)
            }
            sys::Result::Err(err) => {
                self.report_error(handler, err.clone());
                WriteResult::Err(err)
            }
        }
    }

    fn submit_outgoing(&self) -> sys::Result<()> {
        with_buffer(&self.outgoing, |outgoing| {
            self.pipe.submit(|payload| mem::swap(payload, outgoing))
        })
    }

    /// `None` if `chunk` is first in the queue.
    fn accept(&self, chunk: WriteChunk<'_>) -> Option<WriteResult> {
        if self.is_done() {
            return Some(WriteResult::Done(0));
        }
        with_buffer(&self.outgoing, |outgoing| {
            if let Some(fd) = self.sync_fd() {
                let result = match outgoing.write_or_fallback(chunk) {
                    Ok(bytes) => write_sync(fd, bytes),
                    Err(_) => WriteResult::Err(sys::Error::oom()),
                };
                outgoing.reset();
                return Some(result);
            }

            let had_buffered_data = outgoing.is_not_empty();
            let appended = match chunk {
                WriteChunk::Bytes(bytes) => outgoing.write(bytes),
                WriteChunk::Latin1(bytes) => outgoing.write_latin1::<true>(bytes),
                WriteChunk::Utf16(text) => outgoing.write_utf16(text),
            };
            if appended.is_err() {
                return Some(WriteResult::Err(sys::Error::oom()));
            }
            had_buffered_data.then_some(WriteResult::Pending(0))
        })
    }

    pub fn write_utf16(&self, handler: &impl WriteHandler, buf: &[u16]) -> WriteResult {
        (self.accept(WriteChunk::Utf16(buf))).unwrap_or_else(|| self.process_send(handler))
    }

    pub fn write_latin1(&self, handler: &impl WriteHandler, buf: &[u8]) -> WriteResult {
        (self.accept(WriteChunk::Latin1(buf))).unwrap_or_else(|| self.process_send(handler))
    }

    pub fn write(&self, handler: &impl WriteHandler, buf: &[u8]) -> WriteResult {
        (self.accept(WriteChunk::Bytes(buf))).unwrap_or_else(|| self.process_send(handler))
    }

    pub fn flush(&self, handler: &impl WriteHandler) -> WriteResult {
        if self.is_done() {
            return WriteResult::Done(0);
        }
        self.process_send(handler)
    }

    pub fn end(&self, handler: &impl WriteHandler) {
        if self.pipe.is_done.replace(true) {
            return;
        }
        self.pipe.closed_without_reporting.set(false);
        if !self.has_pending_data() && self.owns_fd() {
            self.close(handler);
        }
    }

    pub fn close(&self, handler: &impl WriteHandler) {
        self.pipe.close(handler, true);
    }

    /// `close` without `on_close`.
    pub fn close_without_reporting(&self, handler: &impl WriteHandler) {
        if self.pipe.has_source() {
            self.pipe.closed_without_reporting.set(true);
            self.close(handler);
        }
    }
}

#[cfg(windows)]
fn write_sync(fd: Fd, bytes: &[u8]) -> WriteResult {
    let mut remain = bytes;
    while !remain.is_empty() {
        match sys::write(fd, remain) {
            sys::Result::Err(err) => return WriteResult::Err(err),
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
