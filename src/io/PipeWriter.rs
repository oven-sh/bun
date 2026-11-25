use core::cell::Cell;
#[cfg(windows)]
use core::cell::UnsafeCell;
#[cfg(windows)]
use core::ffi::c_void;
use core::mem;

use bun_core::OOM;
#[cfg(windows)]
use bun_ptr::OptionCellExt as _;
use bun_ptr::{CellExt as _, VecCellExt as _};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::{self as sys, Fd, MaybeOwnedFile};

use crate::{EventLoopHandle, IoEvent, Owner};
#[cfg(unix)]
use crate::{FilePoll, FilePollFlag};

#[cfg(unix)]
use crate::pipes::{FileType, PipeHandle};
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
    /// The writer also closes: `on_close` runs after this or, on Windows, may run before.
    fn on_error(&self, err: sys::Error);
    fn on_close(&self);
    /// Only from a `StreamingWriter`.
    #[cfg(windows)]
    fn on_writable(&self) {}
    /// `true` when a write is submitted, `false` when it ends. Dropping the writer in between panics.
    #[cfg(windows)]
    fn set_has_inflight_write(&self, value: bool);
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

/// What libuv completed.
#[cfg(windows)]
pub struct WriteEvent(Completion);

#[cfg(windows)]
enum Completion {
    Wrote,
    StreamFailed(sys::Error),
    FileFailed(sys::Error),
    VmTeardown,
}

/// Also tells `handler` that the write has ended.
#[cfg(windows)]
fn completion_of(handler: &impl WriteHandler, event: IoEvent) -> Completion {
    let IoEvent::Write(WriteEvent(completion)) = event else {
        unreachable!("a read was passed to a writer");
    };
    if !matches!(completion, Completion::VmTeardown) {
        handler.set_has_inflight_write(false);
    }
    completion
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
    has_inflight_write: Cell<bool>,
    write_req: UnsafeCell<uv::uv_write_t>,
    /// Bytes of the write in flight, or of one that failed.
    current_payload: StreamBufferCell,
    detached: Cell<Option<Detached>>,
}

/// What the callback of the write in flight frees. See `WindowsBufferedWriter::close_and_detach`.
#[cfg(windows)]
#[derive(Copy, Clone)]
struct Detached {
    ptr: *mut (),
    free: unsafe fn(*mut ()),
}

#[cfg(windows)]
impl Default for WindowsPipeWriter {
    fn default() -> Self {
        Self {
            source: Cell::new(None),
            owner: Cell::new(Owner::NULL),
            owns_fd: Cell::new(true),
            is_done: Cell::new(false),
            closed_without_reporting: Cell::new(false),
            has_inflight_write: Cell::new(false),
            write_req: UnsafeCell::new(bun_core::ffi::zeroed()),
            current_payload: StreamBufferCell::default(),
            detached: Cell::new(None),
        }
    }
}

#[cfg(windows)]
impl WindowsPipeWriter {
    /// `None` without a source. The cell is empty while `f` runs.
    fn with_source<R>(&self, f: impl FnOnce(&mut Source) -> R) -> Option<R> {
        self.source.with_taken(|source| source.as_mut().map(f))
    }

    fn has_source(&self) -> bool {
        self.source.is_some()
    }

    fn payload_len(&self) -> usize {
        self.current_payload.size()
    }

    /// `self` for libuv to keep, which `set_owner`'s contract allows.
    fn as_uv_data(&self) -> *mut Self {
        assert!(!self.owner.get().ptr().is_null(), "writer has no owner");
        core::ptr::from_ref(self).cast_mut()
    }

    /// From now on a VM teardown closes `source` through this writer.
    fn set_source(&self, mut source: Source) {
        assert!(!self.has_source() && !self.has_inflight_write.get());
        source.set_owner(self.as_uv_data().cast(), Self::stop_for_vm_teardown);
        self.source.set(Some(source));
    }

    fn update_ref(&self, value: bool) {
        self.with_source(if value { Source::ref_ } else { Source::unref });
    }

    /// The owner may free `self`.
    ///
    /// # Safety
    /// `this` is `as_uv_data` of a live writer.
    unsafe fn dispatch(this: *mut Self, completion: Completion) {
        let event = IoEvent::Write(WriteEvent(completion));
        // SAFETY: fn contract, and `set_owner`'s.
        unsafe { __bun_run_io((*this).owner.get(), event) };
    }

    /// `uv::open_handles` closes this writer's stream through here at teardown.
    ///
    /// # Safety
    /// `this` is the pointer that `set_source` recorded.
    unsafe fn stop_for_vm_teardown(this: *mut c_void) {
        // SAFETY: fn contract. Closing the source takes it off the list.
        unsafe { Self::dispatch(this.cast(), Completion::VmTeardown) };
    }

    fn on_stream_write(this: *mut Self, status: uv::ReturnCode) {
        let completion = match status.to_error(sys::Tag::write) {
            Some(err) => Completion::StreamFailed(err),
            None => Completion::Wrote,
        };
        // SAFETY: set by `submit_buf`. `Drop` does not return while the write is in flight. `free` has `close_and_detach`'s contract.
        unsafe {
            (*this).has_inflight_write.set(false);
            match (*this).detached.get() {
                Some(Detached { ptr, free }) => free(ptr),
                None => Self::dispatch(this, completion),
            }
        }
    }

    /// # Safety
    /// `fs` is what libuv passes to the callback of `submit_write`.
    unsafe extern "C" fn on_file_write(fs: *mut uv::fs_t) {
        // SAFETY: fn contract.
        let Some((result, this)) = (unsafe { File::on_complete(fs) }) else {
            return;
        };
        let completion = match result.to_error(sys::Tag::write) {
            Some(err) => Completion::FileFailed(err),
            None => Completion::Wrote,
        };
        let this = this.cast::<Self>();
        // SAFETY: set by `set_source`, and cleared by dropping the file.
        unsafe {
            (*this).has_inflight_write.set(false);
            Self::dispatch(this, completion);
        }
    }

    /// Returns the length it had.
    fn reset_payload(&self) -> usize {
        assert!(!self.has_inflight_write.get());
        let len = self.current_payload.size();
        self.current_payload.reset();
        len
    }

    /// Runs `fill` on the payload and submits it. Without a source: `EPIPE`, and `fill` does not run.
    fn submit(&self, fill: impl FnOnce(&mut StreamBuffer)) -> sys::Result<()> {
        assert!(!self.has_inflight_write.get());
        let submitted = self.with_source(|source| {
            let buf = self.current_payload.with_taken(|payload| {
                fill(payload);
                uv::uv_buf_t::init(payload.slice())
            });
            // SAFETY: nothing changes the payload in flight but `close_source`, which gives it to the file.
            unsafe { self.submit_buf(source, buf) }
        });
        submitted.unwrap_or_else(|| Err(sys::Error::from_code(sys::E::PIPE, sys::Tag::pipe)))
    }

    /// # Safety
    /// `source` is that of `self`, with no write in flight. On `Ok` the bytes of `buf` stay until libuv calls back.
    unsafe fn submit_buf(&self, source: &mut Source, buf: uv::uv_buf_t) -> sys::Result<()> {
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
        }?;
        self.has_inflight_write.set(true);
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
                    file.buffer.set(self.current_payload.take().list);
                    self.has_inflight_write.set(false);
                }
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
        let had_inflight_write = self.has_inflight_write.get();
        if !self.close_source(cancel_inflight_write) {
            return;
        }
        if had_inflight_write && !self.has_inflight_write.get() {
            handler.set_has_inflight_write(false);
        }
        if !self.closed_without_reporting.get() {
            handler.on_close();
        }
    }

    /// Closes the old source before a restart, like the POSIX writer.
    fn close_current_source(&self, handler: &impl WriteHandler) -> sys::Result<()> {
        // The callback of a cancelled `uv_write` would close the new source.
        if self.has_inflight_write.get()
            && self.with_source(|source| source.file().is_some()) != Some(true)
        {
            return sys::Result::Err(sys::Error::from_code(sys::E::BUSY, sys::Tag::write));
        }
        // Canceling an in-flight write would drop its bytes, so let it finish writing to the old file.
        self.close(handler, false);
        // `on_close` started the writer again.
        if self.has_source() || self.has_inflight_write.get() {
            return sys::Result::Err(sys::Error::from_code(sys::E::BUSY, sys::Tag::write));
        }
        // Free a failed write's payload.
        self.current_payload.take();
        self.is_done.set(false);
        sys::Result::Ok(())
    }
}

#[cfg(windows)]
impl Drop for WindowsPipeWriter {
    fn drop(&mut self) {
        self.close_source(true);
        assert!(
            !self.has_inflight_write.get(),
            "writer dropped under a uv_write"
        );
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
    pending_payload_size: Cell<usize>,
}

#[cfg(windows)]
impl WindowsBufferedWriter {
    /// # Safety
    /// See `PosixStreamingWriter::set_owner`.
    pub unsafe fn set_owner(&self, owner: Owner) {
        self.base.owner.set(owner);
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.base.current_payload.memory_cost()
    }

    pub fn is_closed(&self) -> bool {
        !self.base.has_source()
    }

    /// A pipe or a tty.
    pub fn is_stream(&self) -> bool {
        self.base.with_source(|source| source.file().is_none()) == Some(true)
    }

    pub fn update_ref(&self, value: bool) {
        self.base.update_ref(value);
    }

    pub fn set_pipe(&self, pipe: uv::Owned<uv::Pipe>) {
        self.base.set_source(Source::Pipe(pipe));
    }

    pub fn start_with_current_pipe(&self, handler: &impl BufferedWriteHandler) {
        debug_assert!(self.base.has_source());
        self.base.is_done.set(false);
        self.write(handler);
    }

    pub fn start_with_file(
        &self,
        handler: &impl BufferedWriteHandler,
        ev: EventLoopHandle,
        file: MaybeOwnedFile,
    ) {
        self.base
            .set_source(Source::File(Source::open_file(ev.loop_(), file)));
        self.start_with_current_pipe(handler);
    }

    pub fn start(
        &self,
        handler: &impl BufferedWriteHandler,
        ev: EventLoopHandle,
        file: MaybeOwnedFile,
        _pollable: bool,
    ) -> sys::Result<()> {
        self.base.close_current_source(handler)?;
        self.base.set_source(Source::open(ev.loop_(), file)?);
        self.start_with_current_pipe(handler);
        sys::Result::Ok(())
    }

    pub fn on_io(&self, handler: &impl BufferedWriteHandler, event: IoEvent) {
        match completion_of(handler, event) {
            Completion::Wrote => {
                let written = self.pending_payload_size.get();
                // After a `close()` the handler may have less than what was written.
                let has_pending_data = handler.with_buffer(<[u8]>::len) > written;
                let status = if self.base.is_done.get() && !has_pending_data {
                    WriteStatus::Drained
                } else {
                    WriteStatus::Pending
                };
                handler.on_write(written, status);
            }
            Completion::StreamFailed(err) | Completion::FileFailed(err) => {
                self.close_and_report_error(handler, err);
            }
            Completion::VmTeardown => self.close(handler),
        }
    }

    fn close_and_report_error(&self, handler: &impl WriteHandler, err: sys::Error) {
        self.close(handler);
        handler.on_error(err);
    }

    /// `false` if there is nothing to write, or not now.
    fn begin_write(&self, buffer: &[u8]) -> bool {
        let base = &self.base;
        if base.is_done.get()
            || base.has_inflight_write.get()
            || buffer.is_empty()
            || !base.has_source()
        {
            return false;
        }
        self.pending_payload_size.set(buffer.len());
        true
    }

    fn submit_copy(&self, buffer: &[u8]) -> Option<sys::Result<()>> {
        self.begin_write(buffer).then(|| {
            self.base.submit(|payload| {
                payload.list.clear();
                payload.list.extend_from_slice(buffer);
            })
        })
    }

    /// # Safety
    /// See `write_no_copy`.
    unsafe fn submit_no_copy(&self, buffer: &[u8]) -> Option<sys::Result<()>> {
        if !self.begin_write(buffer) {
            return None;
        }
        self.base.with_source(|source| {
            assert!(source.file().is_none());
            // SAFETY: fn contract. A write to a stream is in flight until its callback.
            unsafe { self.base.submit_buf(source, uv::uv_buf_t::init(buffer)) }
        })
    }

    fn report_submitted(&self, handler: &impl WriteHandler, submitted: Option<sys::Result<()>>) {
        match submitted {
            None => {}
            Some(sys::Result::Ok(())) => handler.set_has_inflight_write(true),
            Some(sys::Result::Err(err)) => self.close_and_report_error(handler, err),
        }
    }

    pub fn write(&self, handler: &impl BufferedWriteHandler) {
        let submitted = handler.with_buffer(|buffer| self.submit_copy(buffer));
        self.report_submitted(handler, submitted);
    }

    /// `write` to a stream, without a copy.
    ///
    /// # Safety
    /// The bytes that `handler` lends stay as they are while the write is in flight.
    pub unsafe fn write_no_copy(&self, handler: &impl BufferedWriteHandler) {
        // SAFETY: fn contract.
        let submitted = handler.with_buffer(|buffer| unsafe { self.submit_no_copy(buffer) });
        self.report_submitted(handler, submitted);
    }

    pub fn close(&self, handler: &impl WriteHandler) {
        self.base.close(handler, true);
    }

    /// Closes without reporting. `true` if a write is still in flight, whose callback calls `free(ptr)`.
    ///
    /// # Safety
    /// After `true`, `self` stays until `free(ptr)`, which may be called then.
    pub unsafe fn close_and_detach(&self, ptr: *mut (), free: unsafe fn(*mut ())) -> bool {
        self.base.close_source(true);
        let has_inflight_write = self.base.has_inflight_write.get();
        self.base
            .detached
            .set(has_inflight_write.then_some(Detached { ptr, free }));
        has_inflight_write
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
        mem::size_of::<Self>()
            + self.base.current_payload.memory_cost()
            + self.outgoing.memory_cost()
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

    /// process_send found a uv_write already in flight (the payload alone is not backpressure).
    pub fn is_backed_up(&self) -> bool {
        self.queued_len() > 0
    }

    /// Bytes accepted from callers that have not reached the fd yet.
    pub fn buffered_len(&self) -> usize {
        self.queued_len() + self.base.payload_len()
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

    /// `false` if the source is not a stream that can block.
    pub fn set_blocking(&self) -> bool {
        self.get_stream().is_some_and(|stream| {
            // SAFETY: the stream of the source.
            unsafe { uv::uv_stream_set_blocking(stream, 1) == uv::ReturnCode::ZERO }
        })
    }

    pub fn get_stream(&self) -> Option<*mut uv::uv_stream_t> {
        self.base
            .with_source(|source| source.file().is_none().then(|| source.to_stream()))?
    }

    fn sync_fd(&self) -> Option<Fd> {
        self.base
            .with_source(|source| matches!(source, Source::SyncFile(_)).then(|| source.get_fd()))?
    }

    pub fn set_pipe(&self, pipe: uv::Owned<uv::Pipe>) {
        self.base.set_source(Source::Pipe(pipe));
    }

    pub fn start_with_pipe(&self, handler: &impl WriteHandler, pipe: uv::Owned<uv::Pipe>) {
        self.set_pipe(pipe);
        self.start_with_current_pipe(handler);
    }

    fn start_with_current_pipe(&self, handler: &impl WriteHandler) {
        debug_assert!(self.base.has_source());
        self.base.is_done.set(false);
        // The old source's write never reports completion, so send the queued chunks here.
        if self.queued_len() > 0 && self.sync_fd().is_none() {
            self.process_send(handler);
        }
    }

    pub fn start_sync(
        &self,
        handler: &impl WriteHandler,
        ev: EventLoopHandle,
        file: MaybeOwnedFile,
    ) -> sys::Result<()> {
        // A `SyncFile` writes each chunk synchronously and can't drain a queue.
        if self.queued_len() > 0 {
            return sys::Result::Err(sys::Error::from_code(sys::E::BUSY, sys::Tag::write));
        }
        self.base.close_current_source(handler)?;
        self.base.owns_fd.set(file.is_owned());
        self.base
            .set_source(Source::SyncFile(Source::open_file(ev.loop_(), file)));
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
        self.base.close_current_source(handler)?;
        self.base.set_source(Source::open(ev.loop_(), file)?);
        self.base.owns_fd.set(owns_fd);
        self.start_with_current_pipe(handler);
        sys::Result::Ok(())
    }

    pub fn on_io(&self, handler: &impl WriteHandler, event: IoEvent) {
        match completion_of(handler, event) {
            Completion::Wrote => self.on_write_complete(handler, self.base.reset_payload()),
            Completion::StreamFailed(err) => self.report_error_and_close(handler, err),
            Completion::FileFailed(err) => {
                self.close(handler);
                handler.on_error(err);
            }
            Completion::VmTeardown => self.close(handler),
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
        if self.base.payload_len() > 0 {
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
        self.base.submit(|payload| {
            self.outgoing
                .with_taken(|outgoing| mem::swap(payload, outgoing))
        })
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

    pub fn end(&self, handler: &impl WriteHandler) {
        if self.base.is_done.replace(true) {
            return;
        }
        self.base.closed_without_reporting.set(false);
        if !self.has_pending_data() && self.owns_fd() {
            self.close(handler);
        }
    }

    pub fn close(&self, handler: &impl WriteHandler) {
        self.base.close(handler, true);
    }

    pub fn close_without_reporting(&self, handler: &impl WriteHandler) {
        if self.base.has_source() {
            self.base.closed_without_reporting.set(true);
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
