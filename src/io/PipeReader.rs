use core::cell::{Cell, OnceCell};
#[cfg(windows)]
use core::ffi::c_void;
use core::mem;

#[cfg(unix)]
use bun_core::vec::{BorrowedBuf, BorrowedCursor};
use bun_sys::{self as sys, Fd};

use crate::max_buf::MaxBuf;
use crate::pipes::{Chunk, ReadState};
#[cfg(unix)]
use crate::pipes::{FileType, PollOrFd};
#[cfg(windows)]
use crate::posix_event_loop::__bun_run_io;
#[cfg(windows)]
use crate::source::{File, Source};
use crate::{EventLoopHandle, IoEvent, Owner};
#[cfg(unix)]
use crate::{FilePoll, FilePollFlag, PipeReadScratchGuard};
use bun_ptr::RefPtr;

#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;

// All logging in this module goes through `bun.sys.syslog` (the `SYS` scope)
// or `libuv::log!`.

/// What a call on a `BufferedReader` leaves its caller to report.
#[must_use]
pub enum ReadStatus {
    /// Nothing: more may come, or the end was reported before.
    Pending,
    Done,
    Failed(sys::Error),
}

/// Bytes the reader may still take out of its source (a blob slice window; `None` reads to EOF): reads are cut to it and using it up is reported as EOF.
#[derive(Default)]
struct ReadLimit(Cell<Option<usize>>);

impl ReadLimit {
    fn reached(&self) -> bool {
        self.0.get() == Some(0)
    }

    fn clamp_len(&self, len: usize) -> usize {
        self.0.get().map_or(len, |remaining| len.min(remaining))
    }

    /// Charges `n` bytes read from the source; `true` once the window is used up.
    fn charge(&self, n: usize) -> bool {
        let Some(remaining) = self.0.get() else {
            return false;
        };
        debug_assert!(
            n <= remaining,
            "read past the limit: the read was not clamped"
        );
        self.0.set(Some(remaining.saturating_sub(n)));
        remaining <= n
    }
}

impl BufferedReader {
    pub fn has_flag(&self, flag: Flags) -> bool {
        self.flags.get().contains(flag)
    }

    pub fn set_flags(&self, flags: Flags, value: bool) {
        self.flags.update(|mut all| {
            all.set(flags, value);
            all
        });
    }

    #[inline]
    pub fn is_done(&self) -> bool {
        (self.flags.get())
            .intersects(Flags::IS_DONE | Flags::RECEIVED_EOF | Flags::CLOSED_WITHOUT_REPORTING)
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.with_buffer(|buffer| buffer.capacity())
    }

    pub fn set_maxbuf(&mut self, maxbuf: RefPtr<MaxBuf>) {
        self.maxbuf = OnceCell::from(maxbuf);
    }

    /// Ends the reader after the next `len` bytes of the source as if they were followed by EOF (`ReadLimit`); `None` reads to EOF. Set before starting.
    pub fn set_limit(&self, len: Option<usize>) {
        self.limit.0.set(len);
    }

    pub fn start_file_offset(
        &self,
        ev: EventLoopHandle,
        fd: Fd,
        poll: bool,
        offset: usize,
    ) -> sys::Result<ReadStatus> {
        self.offset.set(offset);
        self.set_flags(Flags::USE_PREAD, true);
        self.start(ev, fd, poll)
    }

    pub fn buffer(&mut self) -> &mut Vec<u8> {
        self.buffer.get_mut()
    }

    pub fn take_buffer(&self) -> Vec<u8> {
        self.buffer.take()
    }

    pub fn final_buffer(&mut self) -> &mut Vec<u8> {
        self.read_memfd();
        self.buffer()
    }

    pub fn take_final_buffer(&self) -> Vec<u8> {
        self.read_memfd();
        self.take_buffer()
    }

    fn with_buffer<R>(&self, f: impl FnOnce(&mut Vec<u8>) -> R) -> R {
        let mut buffer = self.buffer.take();
        let result = f(&mut buffer);
        self.buffer.set(buffer);
        result
    }

    /// Takes back the buffer a consumer was lent, unless a read from inside that delivery left bytes.
    fn reuse_buffer(&self, mut lent: Vec<u8>) {
        lent.clear();
        self.with_buffer(|buffer| {
            if buffer.is_empty() {
                *buffer = lent;
            }
        });
    }

    /// All of `from` but the handle.
    fn take_state_from(&self, other: &Self) {
        self.flags.set(other.flags.get());
        self.buffer.set(other.buffer.take());
        self.offset.set(other.offset.take());
        self.limit.0.set(other.limit.0.take());
        if let Some(maxbuf) = other.maxbuf.get() {
            let _ = self.maxbuf.set(maxbuf.clone());
        }
        other.set_flags(Flags::IS_DONE, true);
    }

    /// How much of `len` the limit and the byte budget leave to one read.
    fn clamp_len(&self, len: usize) -> usize {
        let len = self.limit.clamp_len(len);
        (self.maxbuf.get()).map_or(len, |maxbuf| maxbuf.clamp_read_len(len))
    }

    /// Charges `bytes_read` against the `maxBuffer` budget; `true` once it is gone. The overflow callback only kills the child, so the caller must also stop reading.
    fn charge_max_buffer(&self, bytes_read: usize) -> bool {
        (self.maxbuf.get()).is_some_and(|maxbuf| maxbuf.on_read_bytes(bytes_read as u64))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PosixBufferedReader
// ──────────────────────────────────────────────────────────────────────────

/// Shared borrows only: a consumer of a chunk can reach the reader again.
#[cfg(unix)]
pub struct PosixBufferedReader {
    handle: PollOrFd,
    /// Set once `preadv2(RWF_NOWAIT)` said this fd's file type does not support it (tty), so we stop asking.
    rwf_unsupported: Cell<bool>,
    buffer: Cell<Vec<u8>>,
    offset: Cell<usize>,
    limit: ReadLimit,
    flags: Cell<PosixFlags>,
    maxbuf: OnceCell<RefPtr<MaxBuf>>,
}

#[cfg(unix)]
bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub struct PosixFlags: u16 {
        const IS_DONE                  = 1 << 0;
        const POLLABLE                 = 1 << 1;
        const NONBLOCKING              = 1 << 2;
        const SOCKET                   = 1 << 3;
        const RECEIVED_EOF             = 1 << 4;
        const CLOSED_WITHOUT_REPORTING = 1 << 5;
        const CLOSE_HANDLE             = 1 << 6; // default true
        const MEMFD                    = 1 << 7;
        const USE_PREAD                = 1 << 8;
        const IS_PAUSED                = 1 << 9;
        const KEEP_ALIVE               = 1 << 10; // default true
        /// A read failed with a non-retry errno. Set before the bytes read ahead of the failure are delivered, so a pull from inside that delivery cannot read the fd past the error. Never cleared: `start()`, `unpause()` and `from()` keep it, and only a reader from `init()` reads again.
        const READ_FAILED              = 1 << 11;
    }
}

#[cfg(unix)]
impl PosixFlags {
    pub(crate) const fn new() -> Self {
        Self::from_bits_truncate(PosixFlags::CLOSE_HANDLE.bits() | PosixFlags::KEEP_ALIVE.bits())
    }
}

#[cfg(unix)]
impl PosixBufferedReader {
    pub fn init() -> PosixBufferedReader {
        PosixBufferedReader {
            handle: PollOrFd::closed(),
            rwf_unsupported: Cell::new(false),
            buffer: Cell::default(),
            offset: Cell::new(0),
            limit: ReadLimit::default(),
            flags: Cell::new(PosixFlags::new()),
            maxbuf: OnceCell::new(),
        }
    }

    /// Back to what `init` made, for the same owner.
    pub fn reset(&self) {
        self.release_handle();
        self.rwf_unsupported.set(false);
        self.buffer.take();
        self.offset.set(0);
        self.set_limit(None);
        self.flags.set(PosixFlags::new());
    }

    /// `owner` is handed the events, to pass on to [`Self::read`] or [`Self::read_chunks`].
    ///
    /// # Safety
    /// `owner` is what `__bun_run_io` takes its tag for, and `self` is a field of it that does not
    /// move, until `self` is dropped or has another owner.
    pub unsafe fn set_owner(&self, owner: Owner) {
        // SAFETY: caller contract.
        unsafe { self.handle.set_owner(owner) };
    }

    pub fn update_ref(&self, value: bool) {
        // Remember the ref state so a poll created later (lazy start) honours
        // an unref() that preceded the first registration.
        self.set_flags(PosixFlags::KEEP_ALIVE, value);
        self.handle.with_poll(|poll| {
            // An unarmed poll delivers nothing; `register_poll` applies KEEP_ALIVE when it arms.
            if !value || poll.is_watching() {
                poll.set_keeping_process_alive(value);
            }
        });
    }

    /// Both keep their owner.
    pub fn from(&self, other: &PosixBufferedReader) {
        self.release_handle();
        self.handle.take_from(&other.handle);
        self.rwf_unsupported.set(other.rwf_unsupported.get());
        self.take_state_from(other);

        // note: the caller is supposed to drain the buffer themselves
        // doing it here automatically makes it very easy to end up reading from the same buffer multiple times.
    }

    pub fn start_memfd(&self, fd: Fd) {
        self.set_flags(PosixFlags::MEMFD, true);
        self.handle.set_fd(fd);
    }

    fn get_file_type(&self) -> FileType {
        let flags = self.flags.get();
        if flags.contains(PosixFlags::SOCKET) {
            return FileType::Socket;
        }

        if flags.contains(PosixFlags::POLLABLE) {
            if flags.contains(PosixFlags::NONBLOCKING) {
                return FileType::NonblockingPipe;
            }

            return FileType::Pipe;
        }

        FileType::File
    }

    pub fn close(&self) -> ReadStatus {
        if self.has_flag(PosixFlags::CLOSED_WITHOUT_REPORTING)
            || (self.has_flag(PosixFlags::CLOSE_HANDLE) && !self.handle.is_closed())
        {
            return self.done();
        }
        ReadStatus::Pending
    }

    /// Explicit teardown with nothing to report (unlike
    /// [`close`]). Safe to call
    /// before Drop; both paths are idempotent over an already-released handle.
    pub fn deinit(&self) {
        // clearAndFree — release capacity, not just length.
        self.buffer.take();
        self.close_without_reporting();
    }

    fn close_without_reporting(&self) {
        if !self.handle.is_closed() {
            debug_assert!(!self.has_flag(PosixFlags::CLOSED_WITHOUT_REPORTING));
            self.set_flags(PosixFlags::CLOSED_WITHOUT_REPORTING, true);
            if self.has_flag(PosixFlags::CLOSE_HANDLE) {
                self.handle.close();
            }
        }
    }

    /// The fd stays open without `CLOSE_HANDLE`.
    pub fn release_handle(&self) {
        (self.handle).close_impl(self.has_flag(PosixFlags::CLOSE_HANDLE));
    }

    pub fn get_fd(&self) -> Fd {
        self.handle.get_fd()
    }

    pub fn pause(&self) {
        if self.has_flag(PosixFlags::IS_PAUSED) {
            return;
        }
        self.set_flags(PosixFlags::IS_PAUSED, true);

        // Unregister the FilePoll if it's registered
        self.handle.with_poll(|poll| {
            if poll.is_registered() {
                let _ = poll.unregister(false);
            }
        });
    }

    pub fn unpause(&self) -> ReadStatus {
        self.set_flags(PosixFlags::IS_PAUSED, false);
        // The next read() call will re-register the poll if needed
        ReadStatus::Pending
    }

    fn read_memfd(&self) {
        let fd = self.get_fd();
        if !self.has_flag(PosixFlags::MEMFD) || fd == Fd::INVALID {
            return;
        }
        // The handle is closed after the read regardless of result.
        // `self.handle` owns the fd;
        // borrow a non-owning `File` view so the temporary doesn't
        // close it on drop (handle.close() below does).
        let result = self.with_buffer(|buffer| {
            sys::File::borrow(&fd).read_to_end_with_array_list(buffer, sys::SizeHint::UnknownSize)
        });
        self.handle.close();
        if let Err(err) = result {
            bun_core::debug_warn!("error reading from memfd\n{}", err);
        }
    }

    fn done(&self) -> ReadStatus {
        if self.has_flag(PosixFlags::CLOSE_HANDLE) {
            self.handle.close();
        }
        self.set_flags(PosixFlags::CLOSED_WITHOUT_REPORTING, false);
        if self.handle.is_closed() {
            debug_assert!(!self.has_flag(PosixFlags::IS_DONE));
            self.set_flags(PosixFlags::IS_DONE, true);
            self.with_buffer(Vec::shrink_to_fit);
        }
        ReadStatus::Done
    }

    /// `done`, unless a consumer of the final chunk got there first.
    fn done_once(&self) -> ReadStatus {
        if self.has_flag(PosixFlags::IS_DONE) {
            return ReadStatus::Pending;
        }
        self.done()
    }

    fn register_poll(&self, ev: EventLoopHandle) -> ReadStatus {
        // pause() may land from inside a chunk's JS re-entry while the
        // loop's own re-arm is still ahead on the stack.
        if self.has_flag(PosixFlags::IS_PAUSED) {
            return ReadStatus::Pending;
        }
        let fd = self.get_fd();
        if !self.handle.has_poll() {
            if fd == Fd::INVALID || !self.has_flag(PosixFlags::POLLABLE) {
                return ReadStatus::Pending;
            }
            self.handle.set_poll(ev, fd);
        }

        // Re-applied on every arm: `pause()` unregisters, which drops it.
        if self.has_flag(PosixFlags::KEEP_ALIVE) {
            (self.handle).with_poll(FilePoll::enable_keeping_process_alive);
        }

        match self.handle.register(FilePollFlag::Readable, fd) {
            sys::Result::Err(err) => ReadStatus::Failed(err),
            sys::Result::Ok(()) => ReadStatus::Pending,
        }
    }

    /// Always takes `fd`: a poll that cannot be armed is a read that failed. `Err` is for Windows.
    pub fn start(&self, ev: EventLoopHandle, fd: Fd, is_pollable: bool) -> sys::Result<ReadStatus> {
        if !is_pollable {
            self.with_buffer(Vec::clear);
            self.set_flags(PosixFlags::IS_DONE, false);
            self.handle.close();
            self.handle.set_fd(fd);
            return sys::Result::Ok(ReadStatus::Pending);
        }
        self.set_flags(PosixFlags::POLLABLE, true);
        if self.get_fd() != fd {
            self.handle.set_fd(fd);
        }
        // With nothing left to read the fd is never waited on: like a non-pollable source, the parent's first read request ends the reader.
        if self.limit.reached() {
            return sys::Result::Ok(ReadStatus::Pending);
        }

        sys::Result::Ok(self.register_poll(ev))
    }

    // Exists for consistently with Windows.
    pub fn has_pending_read(&self) -> bool {
        // `is_watching()` (registered && !needs-rearm) rather than
        // `is_registered()`: a one-shot poll that has fired but not been
        // re-armed will not deliver another callback, so callers that skip
        // `read()` on "pending" must not be told one is in flight.
        self.handle.is_watching()
    }

    pub fn watch(&self, ev: EventLoopHandle) -> ReadStatus {
        if self.has_flag(PosixFlags::POLLABLE) && !self.handle.is_watching() {
            return self.register_poll(ev);
        }
        ReadStatus::Pending
    }

    /// Reads what is there into the buffer. `event` is the one the owner was handed, if any.
    pub fn read(&self, ev: EventLoopHandle, event: Option<IoEvent>) -> ReadStatus {
        let mut read = match ReadLoop::begin(self, &ev, event, false) {
            Ok(read) => read,
            Err(status) => return status,
        };
        loop {
            read.fill();
            if let Some(status) = read.advance(true) {
                return status;
            }
        }
    }

    /// Like [`Self::read`], handing the bytes to `on_chunk`. Its `false` ends only this call. To stop the reader, call `pause()`.
    pub fn read_chunks(
        &self,
        ev: EventLoopHandle,
        event: Option<IoEvent>,
        mut on_chunk: impl FnMut(Chunk<'_>, ReadState) -> bool,
    ) -> ReadStatus {
        let mut read = match ReadLoop::begin(self, &ev, event, true) {
            Ok(read) => read,
            Err(status) => return status,
        };
        loop {
            let keep_going = (read.fill()).is_none_or(|(chunk, state)| on_chunk(chunk, state));
            if let Some(status) = read.advance(keep_going) {
                return status;
            }
        }
    }

    fn begin_read(&self) -> Option<(Fd, FileType)> {
        if (self.flags.get()).intersects(PosixFlags::IS_PAUSED | PosixFlags::READ_FAILED) {
            return None;
        }
        Some((self.get_fd(), self.get_file_type()))
    }

    /// For a read nothing announced. A used-up limit is reported without reading, so there is nothing to wait for.
    fn readiness(&self, file_type: FileType, fd: Fd) -> bun_core::Pollable {
        if file_type == FileType::Pipe && !self.limit.reached() {
            return bun_core::is_readable(fd);
        }
        bun_core::Pollable::Ready
    }

    /// Every kind uses its non-blocking primitive: `RWF_NOWAIT`/poll-guarded reads for pipes, `MSG_DONTWAIT` for sockets; regular files cannot block.
    fn sys_read(
        &self,
        file_type: FileType,
        fd: Fd,
        buf: &mut BorrowedCursor<'_, u8>,
    ) -> sys::Result<usize> {
        match file_type {
            FileType::File if self.has_flag(PosixFlags::USE_PREAD) => sys::pread_buf(
                fd,
                buf.reborrow(),
                i64::try_from(self.offset.get()).expect("int cast"),
            ),
            FileType::File => sys::read_buf(fd, buf.reborrow()),
            FileType::Socket => sys::recv_non_block_buf(fd, buf.reborrow()),
            FileType::NonblockingPipe | FileType::Pipe => {
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    if !self.rwf_unsupported.get() {
                        match sys::read_nowait(fd, buf.reborrow()) {
                            Ok(None) => self.rwf_unsupported.set(true),
                            Ok(Some(n)) => return Ok(n),
                            Err(e) => return Err(e),
                        }
                    }
                    // Poll first even when labelled nonblocking: some callers (FileResponseStream) label by fd kind, not by O_NONBLOCK.
                    match bun_core::is_readable(fd) {
                        bun_core::Pollable::Ready | bun_core::Pollable::Hup => {
                            sys::read_buf(fd, buf.reborrow())
                        }
                        bun_core::Pollable::NotReady => Err(sys::Error::retry().with_fd(fd)),
                    }
                }
                // macOS poll(2) is unreliable on FIFOs; the kqueue registration drives readiness there.
                #[cfg(not(any(target_os = "linux", target_os = "android")))]
                sys::read_buf(fd, buf.reborrow())
            }
        }
    }

    /// One syscall into `buf`, which `clamp_len` has cut; charges the limit and the byte budget and advances the offset. A limit that is (or gets) used up is this reader's EOF.
    fn read_once(&self, file_type: FileType, fd: Fd, mut buf: BorrowedCursor<'_, u8>) -> ReadOnce {
        if self.limit.reached() {
            return ReadOnce::Stop(Stop::Eof);
        }
        match self.sys_read(file_type, fd, &mut buf) {
            sys::Result::Ok(0) => ReadOnce::Stop(Stop::Eof),
            sys::Result::Ok(n) => {
                self.offset.update(|offset| offset + n);
                let limit_reached = self.limit.charge(n);
                if self.charge_max_buffer(n) {
                    ReadOnce::Read(n, Some(Stop::OverBudget))
                } else if limit_reached {
                    ReadOnce::Read(n, Some(Stop::Eof))
                } else {
                    ReadOnce::Read(n, None)
                }
            }
            sys::Result::Err(err) if err.is_retry() => ReadOnce::Stop(Stop::WouldBlock),
            sys::Result::Err(err) => {
                self.set_flags(PosixFlags::READ_FAILED, true);
                ReadOnce::Stop(Stop::Error(err))
            }
        }
    }

    fn read_once_into(&self, file_type: FileType, fd: Fd, buf: &mut [u8]) -> ReadOnce {
        let len = self.clamp_len(buf.len());
        self.read_once(file_type, fd, BorrowedBuf::from(&mut buf[..len]).unfilled())
    }

    /// Reads into `scratch` until it is worth delivering; returns bytes filled and why it stopped (`None`: deliver and keep going).
    fn fill_scratch(
        &self,
        file_type: FileType,
        fd: Fd,
        scratch: &mut [u8],
    ) -> (usize, Option<Stop>) {
        let mut filled = 0;
        while scratch.len() - filled > 16 * 1024 && filled < scratch.len() / 2 {
            match self.read_once_into(file_type, fd, &mut scratch[filled..]) {
                ReadOnce::Read(n, stop) => {
                    filled += n;
                    if stop.is_some() || file_type == FileType::Pipe {
                        return (filled, stop);
                    }
                }
                ReadOnce::Stop(stop) => return (filled, Some(stop)),
            }
        }
        (filled, None)
    }

    /// Reads into `buffer` until it is worth delivering (streaming) or exhausted (buffering).
    fn fill_buffer(
        &self,
        file_type: FileType,
        fd: Fd,
        buffer: &mut Vec<u8>,
        streaming: bool,
    ) -> Option<Stop> {
        loop {
            buffer.reserve(16 * 1024);
            let read = bun_core::vec::append_with(buffer, self.clamp_len(usize::MAX), |spare| {
                self.read_once(file_type, fd, spare)
            });
            match read {
                ReadOnce::Read(_, stop) => {
                    if stop.is_some()
                        || file_type == FileType::Pipe
                        || (streaming && buffer.len() >= 128 * 1024)
                    {
                        return stop;
                    }
                }
                ReadOnce::Stop(stop) => return Some(stop),
            }
        }
    }

    /// One non-blocking read straight into `dst` for a consumer pulling synchronously; arms the poll when nothing is available.
    pub fn read_into(&self, ev: EventLoopHandle, dst: &mut [u8]) -> (usize, ReadState, ReadStatus) {
        let Some((fd, file_type)) = self.begin_read().filter(|_| !dst.is_empty()) else {
            return (0, ReadState::Progress, ReadStatus::Pending);
        };
        if let bun_core::Pollable::NotReady = self.readiness(file_type, fd) {
            return (0, ReadState::Progress, self.register_poll(ev));
        }
        let (n, stop) = match self.read_once_into(file_type, fd, dst) {
            ReadOnce::Read(n, stop) => (n, stop),
            ReadOnce::Stop(stop) => (0, Some(stop)),
        };
        match stop {
            None => (n, ReadState::Progress, ReadStatus::Pending),
            Some(Stop::Eof | Stop::OverBudget) => {
                self.close_without_reporting();
                (n, ReadState::Eof, self.done_once())
            }
            Some(Stop::WouldBlock) if file_type == FileType::File => {
                (0, ReadState::Drained, ReadStatus::Pending)
            }
            Some(Stop::WouldBlock) => (0, ReadState::Drained, self.register_poll(ev)),
            Some(Stop::Error(err)) => (0, ReadState::Progress, ReadStatus::Failed(err)),
        }
    }
}

/// One `read` or `read_chunks` call.
#[cfg(unix)]
struct ReadLoop<'a> {
    reader: &'a PosixBufferedReader,
    ev: &'a EventLoopHandle,
    fd: Fd,
    file_type: FileType,
    streaming: bool,
    received_hup: bool,
    scratch: Option<PipeReadScratchGuard<'a>>,
    /// Out of the reader, so a re-entrant read cannot alias or reallocate it under the consumer.
    lent: Option<Vec<u8>>,
    /// Why the last `fill` stopped.
    stop: Option<Stop>,
}

#[cfg(unix)]
impl<'a> ReadLoop<'a> {
    fn begin(
        reader: &'a PosixBufferedReader,
        ev: &'a EventLoopHandle,
        event: Option<IoEvent>,
        streaming: bool,
    ) -> Result<Self, ReadStatus> {
        let (fd, file_type) = reader.begin_read().ok_or(ReadStatus::Pending)?;
        let received_hup = match event {
            Some(event) => {
                bun_sys::syslog!("onPoll({}) = {}", fd, event.size_or_offset);
                event.is_hup()
            }
            None => match reader.readiness(file_type, fd) {
                bun_core::Pollable::Ready => false,
                bun_core::Pollable::Hup => true,
                bun_core::Pollable::NotReady => return Err(reader.register_poll(*ev)),
            },
        };
        Ok(Self {
            reader,
            ev,
            fd,
            file_type,
            streaming,
            received_hup,
            scratch: ev.claim_pipe_read_scratch(),
            lent: None,
            stop: None,
        })
    }

    /// Returns what there is to deliver.
    fn fill(&mut self) -> Option<(Chunk<'_>, ReadState)> {
        let (reader, streaming) = (self.reader, self.streaming);
        let mut buffer = reader.buffer.take();
        let mut from_scratch: &[u8] = &[];
        match &mut self.scratch {
            Some(scratch) if buffer.is_empty() && (streaming || buffer.capacity() == 0) => {
                let scratch = scratch.bytes();
                let filled;
                (filled, self.stop) = reader.fill_scratch(self.file_type, self.fd, scratch);
                from_scratch = &scratch[..filled];
            }
            _ => self.stop = reader.fill_buffer(self.file_type, self.fd, &mut buffer, streaming),
        }

        let state = match self.stop {
            Some(Stop::Eof | Stop::OverBudget) => {
                // Before the final chunk is delivered, so a consumer that pulls again from inside it finds the reader done instead of reading past EOF or the byte budget.
                reader.close_without_reporting();
                ReadState::Eof
            }
            Some(Stop::WouldBlock) => ReadState::Drained,
            Some(Stop::Error(_)) | None => ReadState::Progress,
        };

        if !streaming {
            buffer.extend_from_slice(from_scratch);
            reader.buffer.set(buffer);
            None
        } else if buffer.is_empty() {
            reader.buffer.set(buffer);
            (!from_scratch.is_empty()).then_some((Chunk::Scratch(from_scratch), state))
        } else if let Some(Stop::Eof | Stop::OverBudget | Stop::Error(_)) = self.stop {
            Some((Chunk::Owned(buffer), state))
        } else {
            Some((Chunk::Buffer(self.lent.insert(buffer)), state))
        }
    }

    /// `None` to `fill` again.
    fn advance(&mut self, keep_going: bool) -> Option<ReadStatus> {
        let reader = self.reader;
        if let Some(lent) = self.lent.take() {
            reader.reuse_buffer(lent);
        }
        let would_block = match self.stop.take() {
            Some(Stop::Eof | Stop::OverBudget) => return Some(reader.done_once()),
            Some(Stop::Error(err)) => return Some(ReadStatus::Failed(err)),
            Some(Stop::WouldBlock) => true,
            None => false,
        };
        // Re-entrant JS inside the consumer can close the reader (nested on_pull -> read -> EOF); the captured `fd` is then stale.
        if reader.is_done() {
            return Some(ReadStatus::Pending);
        }
        if would_block {
            if self.file_type == FileType::File {
                bun_core::debug_warn!("Received EAGAIN while reading from a file. This is a bug.");
                return Some(ReadStatus::Pending);
            }
            return Some(reader.register_poll(*self.ev));
        }
        if !keep_going && !self.received_hup {
            return Some(ReadStatus::Pending);
        }
        if self.file_type != FileType::Pipe {
            return None;
        }

        // A blocking pipe gets one read per wakeup unless it hung up, in
        // which case draining locally reaches EOF — but `received_hup` is a
        // snapshot, and user JS inside the consumer may have opened a new
        // writer on the same FIFO. Re-check before committing to a read
        // that could block (Linux named FIFOs reject RWF_NOWAIT).
        if !self.received_hup {
            return Some(reader.register_poll(*self.ev));
        }
        match bun_core::is_readable(self.fd) {
            bun_core::Pollable::Hup => {}
            bun_core::Pollable::Ready => self.received_hup = false,
            bun_core::Pollable::NotReady => return Some(reader.register_poll(*self.ev)),
        }
        None
    }
}

#[cfg(unix)]
enum Stop {
    Eof,
    OverBudget,
    WouldBlock,
    Error(sys::Error),
}

#[cfg(unix)]
enum ReadOnce {
    Read(usize, Option<Stop>),
    Stop(Stop),
}

#[cfg(unix)]
impl Drop for PosixBufferedReader {
    fn drop(&mut self) {
        self.release_handle();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WindowsBufferedReader
// ──────────────────────────────────────────────────────────────────────────

/// Shared borrows only: libuv holds its address, and a consumer of a chunk can reach it again.
#[cfg(windows)]
pub struct WindowsBufferedReader {
    source: Cell<Option<Source>>,
    owner: Cell<Owner>,
    offset: Cell<usize>,
    limit: ReadLimit,
    /// The `File` has it while a read of the file is out.
    buffer: Cell<Vec<u8>>,
    // for compatibility with Linux
    flags: Cell<WindowsFlags>,
    maxbuf: OnceCell<RefPtr<MaxBuf>>,
}

#[cfg(windows)]
bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub struct WindowsFlags: u16 {
        const IS_DONE                  = 1 << 0;
        const POLLABLE                 = 1 << 1;
        const NONBLOCKING              = 1 << 2;
        const RECEIVED_EOF             = 1 << 3;
        const CLOSED_WITHOUT_REPORTING = 1 << 4;
        const CLOSE_HANDLE             = 1 << 5; // default true
        const IS_PAUSED                = 1 << 6; // default true
        const HAS_INFLIGHT_READ        = 1 << 7;
        const USE_PREAD                = 1 << 8;
        /// When true, wait for the file operation callback before calling done().
        /// Used to ensure proper cleanup ordering when closing during cancellation.
        const DEFER_DONE_CALLBACK      = 1 << 9;
    }
}

#[cfg(windows)]
impl WindowsFlags {
    pub(crate) const fn new() -> Self {
        Self::from_bits_truncate(WindowsFlags::CLOSE_HANDLE.bits() | WindowsFlags::IS_PAUSED.bits())
    }
}

/// What libuv completed.
#[cfg(windows)]
pub struct ReadEvent(Completion);

#[cfg(windows)]
enum Completion {
    /// The buffer has `amount` more bytes.
    Read {
        amount: usize,
        state: ReadState,
        read_file_again: bool,
    },
    Ended(ReadStatus),
}

#[cfg(windows)]
impl Completion {
    const EOF: Completion = Completion::Read {
        amount: 0,
        state: ReadState::Eof,
        read_file_again: false,
    };

    /// # Safety
    /// `owner` is the one a reader has.
    unsafe fn dispatch(self, owner: Owner) {
        if !matches!(self, Completion::Ended(ReadStatus::Pending)) {
            // SAFETY: `set_owner`'s contract.
            unsafe { __bun_run_io(owner, IoEvent::Read(ReadEvent(self))) };
        }
    }
}

#[cfg(windows)]
impl WindowsBufferedReader {
    pub fn init() -> WindowsBufferedReader {
        WindowsBufferedReader {
            source: Cell::new(None),
            owner: Cell::new(Owner::NULL),
            offset: Cell::new(0),
            limit: ReadLimit::default(),
            buffer: Cell::default(),
            flags: Cell::new(WindowsFlags::new()),
            maxbuf: OnceCell::new(),
        }
    }

    /// See `PosixBufferedReader::reset`.
    pub fn reset(&self) {
        self.deinit();
        self.offset.set(0);
        self.set_limit(None);
        self.flags.set(WindowsFlags::new());
    }

    /// `None` without a source. `f` finds `self` without one.
    fn with_source<R>(&self, f: impl FnOnce(&mut Source) -> R) -> Option<R> {
        let mut source = self.source.take()?;
        let result = f(&mut source);
        self.source.set(Some(source));
        Some(result)
    }

    pub fn has_source(&self) -> bool {
        self.with_source(|_| ()).is_some()
    }

    pub fn has_open_source(&self) -> bool {
        self.with_source(|source| !source.is_closed()) == Some(true)
    }

    fn is_file_busy(&self) -> bool {
        self.with_source(|source| source.file().is_some_and(|file| file.is_busy())) == Some(true)
    }

    /// Both keep their owner.
    pub fn from(&self, other: &WindowsBufferedReader) {
        debug_assert!(other.has_source() && !self.has_source());
        self.close_source();
        self.take_state_from(other);
        // Ownership of the handle (or listed file) moves with the source.
        self.source.set(other.source.take());
        self.claim_source();
    }

    pub fn get_fd(&self) -> Fd {
        (self.with_source(|source| source.get_fd())).unwrap_or(Fd::INVALID)
    }

    pub fn watch(&self, _: EventLoopHandle) -> ReadStatus {
        // No-op on windows.
        ReadStatus::Pending
    }

    /// # Safety
    /// See `PosixBufferedReader::set_owner`.
    pub unsafe fn set_owner(&self, owner: Owner) {
        self.owner.set(owner);
        self.claim_source();
    }

    /// `self` for libuv to keep: the owner's pointer outlasts this borrow.
    fn as_uv_data(&self) -> *mut c_void {
        let owner = self.owner.get().ptr();
        assert!(!owner.is_null(), "BufferedReader has no owner");
        owner.with_addr(core::ptr::from_ref(self).addr()).cast()
    }

    /// From now on this reader is the one a VM teardown stops the source
    /// through — whether or not it ever starts reading — so nothing else may
    /// close that handle while it sits here.
    fn claim_source(&self) {
        self.with_source(|source| {
            // A read over a file is a uv request with no handle to close: list
            // the boxed File so a thread teardown closes this reader (`close()`
            // below) before draining the loop. Unlisted where the box leaves
            // this reader (`close_source`).
            if let Some(file) = source.file_key() {
                uv::open_handles::add_file(file);
            }
            source.set_owner(self.as_uv_data(), Self::stop_for_vm_teardown);
        });
    }

    pub fn update_ref(&self, value: bool) {
        self.with_source(if value { Source::ref_ } else { Source::unref });
    }

    fn read_memfd(&self) {}

    pub fn has_pending_read(&self) -> bool {
        self.has_flag(WindowsFlags::HAS_INFLIGHT_READ) || self.is_file_busy()
    }

    fn finish(&self) {
        self.set_flags(WindowsFlags::HAS_INFLIGHT_READ, false);
        self.set_flags(WindowsFlags::IS_DONE, true);
        self.with_buffer(Vec::shrink_to_fit);
    }

    pub fn fail(&self, err: sys::Error) -> ReadStatus {
        self.finish();
        ReadStatus::Failed(err)
    }

    pub fn start_with_current_pipe(&self) -> sys::Result<()> {
        debug_assert!(self.has_open_source());
        self.claim_source();
        self.with_buffer(Vec::clear);
        self.set_flags(WindowsFlags::IS_DONE, false);
        // Debug-only fault injection for test/js/bun/spawn/spawn-pipe-start-error.test.ts:
        // a real uv_read_start failure on a freshly-spawned stdio pipe cannot be
        // triggered from JS, so the test exercises the consumer's error path this way.
        #[cfg(debug_assertions)]
        if bun_core::env_var::feature_flag::BUN_INTERNAL_FAIL_PIPE_READER_START.get() == Some(true)
        {
            return sys::Result::Err(sys::Error::from_code(sys::E::INVAL, sys::Tag::open));
        }
        self.start_reading()
    }

    pub fn start_with_pipe(&self, pipe: uv::Owned<uv::Pipe>) -> sys::Result<()> {
        self.set_source(Source::Pipe(pipe));
        self.start_with_current_pipe()
    }

    /// Take ownership of `source` (reading starts later, or never).
    pub fn set_source(&self, source: Source) {
        debug_assert!(!self.has_source());
        self.close_source();
        self.source.set(Some(source));
        self.claim_source();
    }

    /// `uv::open_handles` closes this reader's stream through here at teardown.
    unsafe fn stop_for_vm_teardown(this: *mut c_void) {
        // SAFETY: recorded by `claim_source`; the slot is replaced or dropped before the reader
        // goes away (`from`, `close_source`). Not used once the owner runs, which may free it.
        let this = unsafe { &*this.cast::<WindowsBufferedReader>() };
        // SAFETY: the reader's owner.
        unsafe { Completion::Ended(this.close()).dispatch(this.owner.get()) };
    }

    pub fn start(&self, ev: EventLoopHandle, fd: Fd, _: bool) -> sys::Result<ReadStatus> {
        self.set_source(Source::open(ev.native_loop(), fd)?);
        self.start_with_current_pipe()?;
        sys::Result::Ok(ReadStatus::Pending)
    }

    pub fn set_raw_mode(&self, value: bool) -> sys::Result<()> {
        (self.with_source(|source| source.set_raw_mode(value))).unwrap_or_else(|| {
            sys::Result::Err(sys::Error {
                errno: sys::E::BADF as _,
                syscall: sys::Tag::uv_tty_set_mode,
                ..Default::default()
            })
        })
    }

    /// For a tty this also runs from inside `uv_read_start` and `uv_tty_set_mode`.
    extern "C" fn on_stream_alloc(
        handle: *mut uv::Handle,
        suggested_size: usize,
        buf: *mut uv::uv_buf_t,
    ) {
        // SAFETY: `start_reading` set `data`, and the reader stops reading before it lets go of the handle.
        let (this, kind) = unsafe { (&*(*handle).data.cast::<Self>(), (*handle).type_) };
        this.set_flags(WindowsFlags::HAS_INFLIGHT_READ, true);
        // Never empty: reads are only issued while the limit has not been reached (`start_reading`, `begin`), and libuv treats an empty buffer as an error.
        debug_assert!(!this.limit.reached());
        let size = this.limit.clamp_len(suggested_size);
        let spare = |buffer: &mut Vec<u8>| {
            buffer.reserve(size);
            let spare = buffer.spare_capacity_mut();
            // Spare capacity grows well past `suggested_size`, so an unclamped read
            // overshoots the limit or `maxBuffer` by however much the buffer had room for.
            let len = this.clamp_len(spare.len());
            uv::uv_buf_t {
                len: len as _,
                base: spare.as_mut_ptr().cast(),
            }
        };
        let result = if kind == uv::HandleType::Tty {
            // Tty reads must not target `buffer`: libuv can retain the pointer
            // past reader teardown (see `uv::Tty::read_scratch` for the contract).
            // SAFETY: the tty of a `Source` is the head of a `uv::Tty`, whose scratch only this borrows.
            let scratch = unsafe { &mut (*handle.cast::<uv::Tty>()).read_scratch };
            scratch.clear();
            spare(scratch)
        } else {
            // libuv reads a pipe between this callback and `on_stream_read`.
            this.with_buffer(spare)
        };
        // SAFETY: buf is a valid out-pointer from libuv.
        unsafe { *buf = result };
    }

    extern "C" fn on_stream_read(
        stream: *mut uv::uv_stream_t,
        nread: uv::ReturnCodeI64,
        buf: *const uv::uv_buf_t,
    ) {
        // SAFETY: as in `on_stream_alloc`. Not used once the owner runs, which may free it.
        let (this, kind) = unsafe { (&*(*stream).data.cast::<Self>(), (*stream).type_) };

        let nread_int = nread.int();

        bun_sys::syslog!(
            "onStreamRead(0x{}) = {}",
            core::ptr::from_ref(this) as usize,
            nread_int
        );

        // NOTE: pipes/tty need to call stopReading on errors (yeah)
        let completion = if nread_int == 0 {
            // EAGAIN or EWOULDBLOCK or canceled  (buf is not safe to access here)
            // With libuv 1.51.0+, calling onRead(.drained) here causes a race condition
            // where subsequent reads return truncated data (see logs showing 6024 instead
            // of 74468 bytes). Just ignore 0-byte reads and let libuv continue.
            return;
        } else if nread_int == uv::UV_EOF as i64 {
            this.pause();
            // EOF (buf is not safe to access here)
            Completion::EOF
        } else if let Some(err) = nread.to_error(sys::Tag::recv) {
            this.pause();
            // ERROR (buf is not safe to access here)
            Completion::Ended(this.fail(err))
        } else {
            let amount: usize = usize::try_from(nread_int).expect("int cast");
            // SAFETY: buf is valid when nread > 0.
            let base = unsafe { (*buf).base };
            this.with_buffer(|buffer| {
                if kind == uv::HandleType::Tty {
                    // SAFETY: libuv wrote `amount` bytes to the tty's scratch.
                    buffer.extend_from_slice(unsafe { core::slice::from_raw_parts(base, amount) });
                } else {
                    debug_assert!(
                        core::ptr::eq(base, buffer.as_ptr_range().end),
                        "uv_read_cb: buf is not in buffer! This is a bug in bun. Please report it."
                    );
                    // SAFETY: libuv wrote `amount` bytes to what `on_stream_alloc` has just handed out.
                    unsafe { bun_core::vec::commit_spare(buffer, amount) };
                }
            });
            Completion::Read {
                amount,
                state: ReadState::Progress,
                read_file_again: false,
            }
        };
        // SAFETY: the reader's owner.
        unsafe { completion.dispatch(this.owner.get()) };
    }

    /// Callback fired when a file read operation completes or is canceled.
    /// Handles cleanup, cancellation, and normal read processing.
    unsafe extern "C" fn on_file_read(fs: *mut uv::fs_t) {
        // SAFETY: the callback of `submit_read`.
        let Some((result, buffer, this)) = (unsafe { File::on_read_complete(fs) }) else {
            return;
        };
        bun_sys::syslog!("onFileRead() = {}", result.int());

        // SAFETY: what `read_file` or `claim_source` set, which dropping the file clears.
        // Not used once the owner runs, which may free it.
        let this = unsafe { &*this.cast::<Self>() };
        this.buffer.set(buffer);
        let completion = this.file_read_completion(result);
        if let Completion::Read { amount, .. } = completion {
            // SAFETY: libuv wrote as many bytes as it reports.
            this.with_buffer(|buffer| unsafe { bun_core::vec::commit_spare(buffer, amount) });
        }
        // SAFETY: the reader's owner.
        unsafe { completion.dispatch(this.owner.get()) };
    }

    fn file_read_completion(&self, result: uv::ReturnCodeI64) -> Completion {
        let nread_int = result.int();

        // Mark no longer in flight
        self.set_flags(WindowsFlags::HAS_INFLIGHT_READ, false);

        // `close()` was asked for while this read was out (the
        // cancel need not have won): finish the close, deliver nothing.
        if self.has_flag(WindowsFlags::DEFER_DONE_CALLBACK) {
            self.set_flags(WindowsFlags::DEFER_DONE_CALLBACK, false);
            return Completion::Ended(self.close_now());
        }

        if nread_int == uv::UV_ECANCELED as i64 {
            self.with_buffer(Vec::clear);
            return Completion::Ended(ReadStatus::Pending);
        }

        if self.has_flag(WindowsFlags::IS_DONE) {
            return Completion::Ended(ReadStatus::Pending);
        }

        // 0 actually means EOF too
        if nread_int == 0 || nread_int == uv::UV_EOF as i64 {
            self.set_flags(WindowsFlags::IS_PAUSED, true);
            return Completion::EOF;
        }

        if let Some(err) = result.to_error(sys::Tag::read) {
            self.set_flags(WindowsFlags::IS_PAUSED, true);
            return Completion::Ended(self.fail(err));
        }

        let amount: usize = usize::try_from(nread_int).expect("int cast");
        self.offset.update(|offset| offset + amount);
        Completion::Read {
            amount,
            state: ReadState::Progress,
            read_file_again: true,
        }
    }

    /// Does nothing while a read is out.
    fn read_file(&self, file: &mut File) -> sys::Result<()> {
        file.fs.data = self.as_uv_data();
        if !file.can_start() {
            return sys::Result::Ok(());
        }

        debug_assert!(!self.limit.reached());
        let offset = if self.has_flag(WindowsFlags::USE_PREAD) {
            i64::try_from(self.offset.get()).expect("int cast")
        } else {
            -1
        };
        self.with_buffer(|buffer| {
            buffer.reserve(self.limit.clamp_len(64 * 1024));
            let max_len = self.clamp_len(usize::MAX);
            file.submit_read(buffer, max_len, offset, Self::on_file_read)
        })?;
        self.set_flags(WindowsFlags::HAS_INFLIGHT_READ, true);
        sys::Result::Ok(())
    }

    fn start_reading(&self) -> sys::Result<()> {
        // A used-up limit stays paused: `start` has nothing to read and `unpause` reports it as EOF instead.
        if self.has_flag(WindowsFlags::IS_DONE)
            || !self.has_flag(WindowsFlags::IS_PAUSED)
            || self.limit.reached()
        {
            return sys::Result::Ok(());
        }
        self.set_flags(WindowsFlags::IS_PAUSED, false);

        let started = self.with_source(|source| {
            debug_assert!(!source.is_closed());
            if let Some(file) = source.file() {
                return self.read_file(file);
            }
            // Another reader of the tty for stdin may have replaced it.
            source.set_data(self.as_uv_data());
            // SAFETY: source is a live Pipe/Tty stream handle.
            if let Some(err) = unsafe {
                uv::uv_read_start(
                    source.to_stream(),
                    Some(Self::on_stream_alloc),
                    Some(Self::on_stream_read),
                )
            }
            .to_error(sys::Tag::open)
            {
                // Routed through `bun.windows.libuv.log` (the `uv` debug
                // scope, toggled by `BUN_DEBUG_uv=1`), not `SYS`.
                bun_sys::windows::libuv::log!("uv_read_start() = {}", bstr::BStr::new(err.name()));
                return sys::Result::Err(err);
            }
            sys::Result::Ok(())
        });
        started.unwrap_or_else(|| Err(sys::Error::from_code(sys::E::BADF, sys::Tag::read)))
    }

    pub fn pause(&self) {
        if self.has_flag(WindowsFlags::IS_DONE) || self.has_flag(WindowsFlags::IS_PAUSED) {
            return;
        }
        self.set_flags(WindowsFlags::IS_PAUSED, true);
        self.with_source(|source| match source.file() {
            Some(file) => file.stop(),
            // SAFETY: stream handle is live (not a file source).
            None => _ = unsafe { uv::uv_read_stop(source.to_stream()) },
        });
    }

    /// `false` if there was none.
    pub fn close_source(&self) -> bool {
        let Some(source) = self.source.take() else {
            return false;
        };
        match source {
            Source::SyncFile(mut file) | Source::File(mut file) => {
                uv::open_handles::remove_file(file.as_ptr().cast());
                file.close_on_drop = self.has_flag(WindowsFlags::CLOSE_HANDLE);
                file.stop();
            }
            Source::Tty(tty) => {
                self.set_flags(WindowsFlags::IS_PAUSED, true);
                // The one for stdin stays open.
                tty.stop_reading_for(core::ptr::from_ref(self).cast());
            }
            Source::Pipe(_) => self.set_flags(WindowsFlags::IS_PAUSED, true),
        }
        true
    }

    fn close_now(&self) -> ReadStatus {
        if !self.close_source() {
            return ReadStatus::Pending;
        }
        self.finish();
        ReadStatus::Done
    }

    /// If a file operation is in progress, `Done` comes with the event of
    /// its completion to ensure proper cleanup ordering.
    pub fn close(&self) -> ReadStatus {
        self.pause();

        // Defer done if operation is in progress (whether cancel succeeded or failed)
        if self.is_file_busy() {
            self.set_flags(WindowsFlags::DEFER_DONE_CALLBACK, true);
            return ReadStatus::Pending;
        }

        self.close_now()
    }

    /// Explicit teardown with nothing to report (unlike
    /// [`close`]). Safe to call
    /// before Drop; both paths are idempotent over an already-taken source.
    pub fn deinit(&self) {
        self.close_source();
        self.buffer.take();
    }

    /// Returns the state of the chunk in the buffer, and whether `advance` reads the file again.
    fn begin(&self, event: Option<IoEvent>) -> Result<(ReadState, bool), ReadStatus> {
        let (amount, mut state, read_file_again) = match event {
            // we cannot sync read pipes on Windows so we just check if we are paused to resume the reading
            None => return Err(self.unpause()),
            Some(IoEvent::Read(ReadEvent(Completion::Ended(status)))) => return Err(status),
            Some(IoEvent::Read(ReadEvent(Completion::Read {
                amount,
                state,
                read_file_again,
            }))) => (amount, state, read_file_again),
        };

        // Using the limit up is this reader's EOF (`ReadLimit`); so is exhausting `maxBuffer`.
        let limit_reached = self.limit.charge(amount);
        if self.charge_max_buffer(amount) || limit_reached {
            state = ReadState::Eof;
        }
        if state == ReadState::Eof {
            self.set_flags(WindowsFlags::RECEIVED_EOF, true);
        }

        // The read that produced this chunk is complete; if the flag is set again
        // below, a `start_reading` issued from the delivery set it.
        self.set_flags(WindowsFlags::HAS_INFLIGHT_READ, false);
        Ok((state, read_file_again))
    }

    fn advance(&self, state: ReadState, read_file_again: bool) -> ReadStatus {
        if state == ReadState::Eof {
            return self.close();
        }
        // if we are not paused we keep reading until EOF or err
        if !read_file_again || self.has_flag(WindowsFlags::IS_PAUSED) {
            return ReadStatus::Pending;
        }
        match self.with_source(|source| source.file().map(|file| self.read_file(file))) {
            Some(Some(Err(err))) => {
                self.set_flags(WindowsFlags::IS_PAUSED, true);
                // we should inform the error if we are unable to keep reading
                self.fail(err)
            }
            _ => ReadStatus::Pending,
        }
    }

    pub fn unpause(&self) -> ReadStatus {
        if self.limit.reached() && !self.is_done() {
            // Nothing was ever there to read: report EOF the way a completed read does instead of issuing one.
            self.set_flags(WindowsFlags::RECEIVED_EOF, true);
            return self.close();
        }
        let _ = self.start_reading();
        ReadStatus::Pending
    }

    /// See `PosixBufferedReader::read`.
    pub fn read(&self, _: EventLoopHandle, event: Option<IoEvent>) -> ReadStatus {
        match self.begin(event) {
            Ok((state, read_file_again)) => self.advance(state, read_file_again),
            Err(status) => status,
        }
    }

    /// See `PosixBufferedReader::read_chunks`.
    pub fn read_chunks(
        &self,
        _: EventLoopHandle,
        event: Option<IoEvent>,
        mut on_chunk: impl FnMut(Chunk<'_>, ReadState) -> bool,
    ) -> ReadStatus {
        let (state, read_file_again) = match self.begin(event) {
            Ok(read) => read,
            Err(status) => return status,
        };
        let mut buffer = self.buffer.take();
        // Parents that want the reader paused call `pause()` themselves.
        if !buffer.is_empty() && state == ReadState::Eof {
            on_chunk(Chunk::Owned(buffer), state);
        } else if !buffer.is_empty() {
            on_chunk(Chunk::Buffer(&mut buffer), state);
            self.reuse_buffer(buffer);
        }
        self.advance(state, read_file_again)
    }

    /// Windows reads complete through libuv, never synchronously; this just makes sure one is in flight.
    pub fn read_into(&self, _: EventLoopHandle, _dst: &mut [u8]) -> (usize, ReadState, ReadStatus) {
        (0, ReadState::Progress, self.unpause())
    }
}

// Keep boolean state in the `WindowsFlags` bitflags field — no loose `bool`
// fields on `WindowsBufferedReader`.

#[cfg(windows)]
impl Drop for WindowsBufferedReader {
    fn drop(&mut self) {
        self.close_source();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Platform alias
// ──────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
pub type BufferedReader = PosixBufferedReader;
#[cfg(unix)]
pub type Flags = PosixFlags;
#[cfg(windows)]
pub type BufferedReader = WindowsBufferedReader;
#[cfg(windows)]
pub type Flags = WindowsFlags;
#[cfg(not(any(unix, windows)))]
compile_error!("Unsupported platform");
