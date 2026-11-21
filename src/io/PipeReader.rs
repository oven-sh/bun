use core::cell::{Cell, OnceCell};
use core::mem;
#[cfg(unix)]
use core::ops::ControlFlow;

#[cfg(unix)]
use bun_core::vec::{BorrowedBuf, BorrowedCursor};
#[cfg(unix)]
use bun_sys::Fd;
use bun_sys::{self as sys, MaybeOwnedFile};

use crate::max_buf::MaxBuf;
use crate::pipes::{Chunk, ReadState};
#[cfg(unix)]
use crate::pipes::{FileType, PipeHandle};
#[cfg(windows)]
use crate::source::{Pipe, ReadSource};
use crate::{EventLoopHandle, IoEvent, Owner};
#[cfg(unix)]
use crate::{FilePoll, FilePollFlag, PipeReadScratchGuard};
#[cfg(windows)]
use bun_ptr::OptionCellExt as _;
use bun_ptr::{CellExt as _, RefPtr};

/// What a call on a `BufferedReader` leaves its caller to report.
#[must_use]
pub enum ReadResult {
    /// Nothing: more may come, or the end was reported before.
    Pending,
    Done,
    Err(sys::Error),
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

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub struct ReaderFlags: u16 {
        const IS_DONE                  = 1 << 0;
        const POLLABLE                 = 1 << 1;
        const NONBLOCKING              = 1 << 2;
        const SOCKET                   = 1 << 3;
        const RECEIVED_EOF             = 1 << 4;
        const CLOSED_WITHOUT_REPORTING = 1 << 5;
        const MEMFD                    = 1 << 7;
        const USE_PREAD                = 1 << 8;
        const IS_PAUSED                = 1 << 9; // default true on Windows
        const KEEP_ALIVE               = 1 << 10; // default true
        /// A read failed with a non-retry errno. Set before the bytes read ahead of the failure are delivered, so a pull from inside that delivery cannot read the fd past the error. `start()`, `unpause()` and `from()` keep it: only `reset()` clears it.
        const READ_FAILED              = 1 << 11;
    }
}

impl ReaderFlags {
    const fn new() -> Self {
        if cfg!(windows) {
            Self::KEEP_ALIVE.union(Self::IS_PAUSED)
        } else {
            Self::KEEP_ALIVE
        }
    }
}

impl BufferedReader {
    pub fn has_flag(&self, flag: ReaderFlags) -> bool {
        self.flags.get().contains(flag)
    }

    pub fn update_flags(&self, f: impl FnOnce(&mut ReaderFlags)) {
        let mut flags = self.flags.get();
        f(&mut flags);
        self.flags.set(flags);
    }

    #[inline]
    pub fn is_done(&self) -> bool {
        self.flags.get().intersects(
            ReaderFlags::IS_DONE
                | ReaderFlags::RECEIVED_EOF
                | ReaderFlags::CLOSED_WITHOUT_REPORTING,
        )
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.buffer.with_taken(|buffer| buffer.capacity())
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
        file: MaybeOwnedFile,
        poll: bool,
        offset: usize,
    ) -> sys::Result<ReadResult> {
        self.offset.set(offset);
        self.update_flags(|f| f.insert(ReaderFlags::USE_PREAD));
        self.start(ev, file, poll)
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

    /// Takes back the buffer a consumer was lent, unless a read from inside that delivery left bytes.
    #[cfg(unix)]
    fn reuse_buffer(&self, mut lent: Vec<u8>) {
        lent.clear();
        self.buffer.with_taken(|buffer| {
            if buffer.is_empty() {
                *buffer = lent;
            }
        });
    }

    /// What `from()` moves on both platforms: everything except the handle.
    fn take_state_from(&self, other: &Self) {
        self.flags.set(other.flags.get());
        self.buffer.set(other.buffer.take());
        self.offset.set(other.offset.take());
        self.limit.0.set(other.limit.0.take());
        if let Some(maxbuf) = other.maxbuf.get() {
            let _ = self.maxbuf.set(maxbuf.clone());
        }
        other.update_flags(|f| f.insert(ReaderFlags::IS_DONE));
    }

    /// How much of `len` the limit and the byte budget leave to one read.
    fn clamp_len(&self, len: usize) -> usize {
        let len = self.limit.clamp_len(len);
        self.maxbuf
            .get()
            .map_or(len, |maxbuf| maxbuf.clamp_read_len(len))
    }

    /// Charges `bytes_read` against the `maxBuffer` budget; `true` once it is gone. The overflow callback only kills the child, so the caller must also stop reading.
    fn charge_max_buffer(&self, bytes_read: usize) -> bool {
        self.maxbuf
            .get()
            .is_some_and(|maxbuf| maxbuf.on_read_bytes(bytes_read as u64))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PosixBufferedReader
// ──────────────────────────────────────────────────────────────────────────

/// Shared borrows only: a consumer of a chunk can reach the reader again.
#[cfg(unix)]
pub struct PosixBufferedReader {
    handle: PipeHandle,
    /// Set once `preadv2(RWF_NOWAIT)` said this fd's file type does not support it (tty), so we stop asking.
    rwf_unsupported: Cell<bool>,
    buffer: Cell<Vec<u8>>,
    offset: Cell<usize>,
    limit: ReadLimit,
    flags: Cell<ReaderFlags>,
    maxbuf: OnceCell<RefPtr<MaxBuf>>,
}

#[cfg(unix)]
impl PosixBufferedReader {
    pub fn init() -> PosixBufferedReader {
        PosixBufferedReader {
            handle: PipeHandle::closed(),
            rwf_unsupported: Cell::new(false),
            buffer: Cell::default(),
            offset: Cell::new(0),
            limit: ReadLimit::default(),
            flags: Cell::new(ReaderFlags::new()),
            maxbuf: OnceCell::new(),
        }
    }

    /// Back to what `init` made, with the same owner and `maxbuf`.
    pub fn reset(&self) {
        self.release_handle();
        self.rwf_unsupported.set(false);
        self.buffer.take();
        self.offset.set(0);
        self.set_limit(None);
        self.flags.set(ReaderFlags::new());
    }

    /// `owner` is handed the events, to pass on to [`Self::read`] or [`Self::read_chunks`].
    ///
    /// # Safety
    /// `owner.ptr` points to a live value of the type `__bun_run_io` casts `owner.tag` to, and `self` is a
    /// field of it that does not move, until `self` is dropped or has another owner.
    pub unsafe fn set_owner(&self, owner: Owner) {
        // SAFETY: caller contract.
        unsafe { self.handle.set_owner(owner) };
    }

    pub fn update_ref(&self, value: bool) {
        // For a poll that is created later.
        self.update_flags(|f| f.set(ReaderFlags::KEEP_ALIVE, value));
        self.handle.with_poll(|poll| {
            // An unarmed poll delivers nothing; `register_poll` applies KEEP_ALIVE when it arms.
            if !value || poll.is_watching() {
                poll.set_keeping_process_alive(value);
            }
        });
    }

    /// Both keep their owner. The caller drains the buffer.
    pub fn from(&self, other: &PosixBufferedReader) {
        self.handle.take_from(&other.handle);
        self.rwf_unsupported.set(other.rwf_unsupported.get());
        self.take_state_from(other);
    }

    pub fn start_memfd(&self, memfd: sys::File) {
        self.update_flags(|f| f.insert(ReaderFlags::MEMFD));
        self.handle.set_file(memfd.into());
    }

    fn get_file_type(&self) -> FileType {
        let flags = self.flags.get();
        if flags.contains(ReaderFlags::SOCKET) {
            return FileType::Socket;
        }

        if flags.contains(ReaderFlags::POLLABLE) {
            if flags.contains(ReaderFlags::NONBLOCKING) {
                return FileType::NonblockingPipe;
            }

            return FileType::Pipe;
        }

        FileType::File
    }

    pub fn close(&self) -> ReadResult {
        if self.has_flag(ReaderFlags::CLOSED_WITHOUT_REPORTING) || self.handle.owns_file() {
            return self.done();
        }
        ReadResult::Pending
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
            debug_assert!(!self.has_flag(ReaderFlags::CLOSED_WITHOUT_REPORTING));
            self.update_flags(|f| f.insert(ReaderFlags::CLOSED_WITHOUT_REPORTING));
            self.handle.close_if_owned();
        }
    }

    pub fn release_handle(&self) {
        self.handle.close();
    }

    pub fn get_fd(&self) -> Fd {
        self.handle.get_fd()
    }

    pub fn pause(&self) {
        if self.has_flag(ReaderFlags::IS_PAUSED) {
            return;
        }
        self.update_flags(|f| f.insert(ReaderFlags::IS_PAUSED));

        // Unregister the FilePoll if it's registered
        self.handle.with_poll(|poll| {
            if poll.is_registered() {
                let _ = poll.unregister(false);
            }
        });
    }

    pub fn unpause(&self) -> ReadResult {
        self.update_flags(|f| f.remove(ReaderFlags::IS_PAUSED));
        // The next read() call will re-register the poll if needed
        ReadResult::Pending
    }

    fn read_memfd(&self) {
        let fd = self.get_fd();
        if !self.has_flag(ReaderFlags::MEMFD) || fd == Fd::INVALID {
            return;
        }
        // Borrowed: `handle.close()` closes the fd, whatever the result.
        let result = self.buffer.with_taken(|buffer| {
            sys::File::borrow(&fd).read_to_end_with_array_list(buffer, sys::SizeHint::UnknownSize)
        });
        self.handle.close();
        if let Err(err) = result {
            bun_core::debug_warn!("error reading from memfd\n{}", err);
        }
    }

    fn done(&self) -> ReadResult {
        self.handle.close_if_owned();
        self.update_flags(|f| f.remove(ReaderFlags::CLOSED_WITHOUT_REPORTING));
        if self.handle.is_closed() {
            debug_assert!(!self.has_flag(ReaderFlags::IS_DONE));
            self.update_flags(|f| f.insert(ReaderFlags::IS_DONE));
            self.buffer.with_taken(Vec::shrink_to_fit);
        }
        ReadResult::Done
    }

    /// `done`, unless a consumer of the final chunk got there first.
    fn done_once(&self) -> ReadResult {
        if self.has_flag(ReaderFlags::IS_DONE) {
            return ReadResult::Pending;
        }
        self.done()
    }

    fn register_poll(&self, ev: EventLoopHandle) -> ReadResult {
        // pause() may land from inside a chunk's JS re-entry while the
        // loop's own re-arm is still ahead on the stack.
        if self.has_flag(ReaderFlags::IS_PAUSED) {
            return ReadResult::Pending;
        }
        if !self.handle.has_poll() {
            if self.handle.is_closed() || !self.has_flag(ReaderFlags::POLLABLE) {
                return ReadResult::Pending;
            }
            self.handle.add_poll(ev);
        }

        // Re-applied on every arm: `pause()` unregisters, which drops it.
        if self.has_flag(ReaderFlags::KEEP_ALIVE) {
            self.handle
                .with_poll(FilePoll::enable_keeping_process_alive);
        }

        match self.handle.register(FilePollFlag::Readable) {
            sys::Result::Err(err) => ReadResult::Err(err),
            sys::Result::Ok(()) => ReadResult::Pending,
        }
    }

    /// For our end of a pipe that this process has made.
    pub fn start_own_pipe(&self, ev: EventLoopHandle, pipe: sys::File) -> sys::Result<ReadResult> {
        self.start(ev, pipe.into(), true)
    }

    /// The same, but nothing is read until `unpause`.
    pub fn set_own_pipe(&self, ev: EventLoopHandle, pipe: sys::File) {
        self.update_flags(|f| f.insert(ReaderFlags::IS_PAUSED));
        let _ = self.start_own_pipe(ev, pipe);
    }

    /// A poll that cannot be armed is a read that failed. `Err` is for Windows.
    pub fn start(
        &self,
        ev: EventLoopHandle,
        file: MaybeOwnedFile,
        is_pollable: bool,
    ) -> sys::Result<ReadResult> {
        if !is_pollable {
            self.buffer.with_taken(Vec::clear);
            self.update_flags(|f| f.remove(ReaderFlags::IS_DONE));
            self.handle.set_file(file);
            return sys::Result::Ok(ReadResult::Pending);
        }
        self.update_flags(|f| f.insert(ReaderFlags::POLLABLE));
        if file.is_owned() || self.get_fd() != file.fd() {
            self.handle.set_file(file);
        }
        // With nothing left to read the fd is never waited on: like a non-pollable source, the owner's first read request ends the reader.
        if self.limit.reached() {
            return sys::Result::Ok(ReadResult::Pending);
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

    pub fn watch(&self, ev: EventLoopHandle) -> ReadResult {
        if self.has_flag(ReaderFlags::POLLABLE) && !self.handle.is_watching() {
            return self.register_poll(ev);
        }
        ReadResult::Pending
    }

    /// Reads what is there into the buffer. `event` is the one the owner was handed, if any.
    pub fn read(&self, ev: EventLoopHandle, event: Option<IoEvent>) -> ReadResult {
        let mut read = match ReadLoop::begin(self, &ev, event, false) {
            Ok(read) => read,
            Err(result) => return result,
        };
        loop {
            read.fill();
            if let ControlFlow::Break(result) = read.advance(true) {
                return result;
            }
        }
    }

    /// Like [`Self::read`], handing the bytes to `on_chunk`. Its `false` ends only this call. To stop the reader, call `pause()`.
    pub fn read_chunks(
        &self,
        ev: EventLoopHandle,
        event: Option<IoEvent>,
        mut on_chunk: impl FnMut(Chunk<'_>, ReadState) -> bool,
    ) -> ReadResult {
        let mut read = match ReadLoop::begin(self, &ev, event, true) {
            Ok(read) => read,
            Err(result) => return result,
        };
        loop {
            let keep_going = read
                .fill()
                .is_none_or(|(chunk, state)| on_chunk(chunk, state));
            if let ControlFlow::Break(result) = read.advance(keep_going) {
                return result;
            }
        }
    }

    fn begin_read(&self) -> Option<(Fd, FileType)> {
        if self
            .flags
            .get()
            .intersects(ReaderFlags::IS_PAUSED | ReaderFlags::READ_FAILED)
        {
            return None;
        }
        Some((self.get_fd(), self.get_file_type()))
    }

    /// For a read that no poll event started. A used-up limit is reported without reading, so there is nothing to wait for.
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
            FileType::File if self.has_flag(ReaderFlags::USE_PREAD) => sys::pread_buf(
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
                        match sys::read_nowait_buf(fd, buf.reborrow()) {
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
                self.update_flags(|f| f.insert(ReaderFlags::READ_FAILED));
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
    pub fn read_into(&self, ev: EventLoopHandle, dst: &mut [u8]) -> (usize, ReadState, ReadResult) {
        let Some((fd, file_type)) = self.begin_read().filter(|_| !dst.is_empty()) else {
            return (0, ReadState::Progress, ReadResult::Pending);
        };
        if let bun_core::Pollable::NotReady = self.readiness(file_type, fd) {
            return (0, ReadState::Progress, self.register_poll(ev));
        }
        let (n, stop) = match self.read_once_into(file_type, fd, dst) {
            ReadOnce::Read(n, stop) => (n, stop),
            ReadOnce::Stop(stop) => (0, Some(stop)),
        };
        match stop {
            None => (n, ReadState::Progress, ReadResult::Pending),
            Some(Stop::Eof | Stop::OverBudget) => {
                self.close_without_reporting();
                (n, ReadState::Eof, self.done_once())
            }
            Some(Stop::WouldBlock) if file_type == FileType::File => {
                (0, ReadState::Drained, ReadResult::Pending)
            }
            Some(Stop::WouldBlock) => (0, ReadState::Drained, self.register_poll(ev)),
            Some(Stop::Error(err)) => (0, ReadState::Progress, ReadResult::Err(err)),
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
    ) -> Result<Self, ReadResult> {
        let (fd, file_type) = reader.begin_read().ok_or(ReadResult::Pending)?;
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
                let scratch = scratch.as_mut_slice();
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

    fn advance(&mut self, keep_going: bool) -> ControlFlow<ReadResult> {
        let reader = self.reader;
        if let Some(lent) = self.lent.take() {
            reader.reuse_buffer(lent);
        }
        let would_block = match self.stop.take() {
            Some(Stop::Eof | Stop::OverBudget) => return ControlFlow::Break(reader.done_once()),
            Some(Stop::Error(err)) => return ControlFlow::Break(ReadResult::Err(err)),
            Some(Stop::WouldBlock) => true,
            None => false,
        };
        // Re-entrant JS inside the consumer can close the reader (nested on_pull -> read -> EOF); the captured `fd` is then stale.
        if reader.is_done() {
            return ControlFlow::Break(ReadResult::Pending);
        }
        if would_block {
            if self.file_type == FileType::File {
                bun_core::debug_warn!("Received EAGAIN while reading from a file. This is a bug.");
                return ControlFlow::Break(ReadResult::Pending);
            }
            return ControlFlow::Break(reader.register_poll(*self.ev));
        }
        if !keep_going && !self.received_hup {
            return ControlFlow::Break(ReadResult::Pending);
        }
        if self.file_type != FileType::Pipe {
            return ControlFlow::Continue(());
        }

        // One read per wakeup, unless the pipe hung up. The consumer may have opened a new writer since, and a FIFO rejects RWF_NOWAIT, so ask again before a read that could block.
        if !self.received_hup {
            return ControlFlow::Break(reader.register_poll(*self.ev));
        }
        match bun_core::is_readable(self.fd) {
            bun_core::Pollable::Hup => {}
            bun_core::Pollable::Ready => self.received_hup = false,
            bun_core::Pollable::NotReady => {
                return ControlFlow::Break(reader.register_poll(*self.ev));
            }
        }
        ControlFlow::Continue(())
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

// ──────────────────────────────────────────────────────────────────────────
// WindowsBufferedReader
// ──────────────────────────────────────────────────────────────────────────

/// Shared borrows only: a consumer of a chunk can reach the reader again.
#[cfg(windows)]
pub struct WindowsBufferedReader {
    source: Cell<Option<ReadSource>>,
    owner: Cell<Owner>,
    offset: Cell<usize>,
    limit: ReadLimit,
    buffer: Cell<Vec<u8>>,
    flags: Cell<ReaderFlags>,
    maxbuf: OnceCell<RefPtr<MaxBuf>>,
}

#[cfg(windows)]
pub enum ReadEvent {
    /// Not empty.
    Data(Vec<u8>),
    Eof,
    Err(sys::Error),
    VmTeardown,
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
            flags: Cell::new(ReaderFlags::new()),
            maxbuf: OnceCell::new(),
        }
    }

    /// See `PosixBufferedReader::reset`.
    pub fn reset(&self) {
        self.deinit();
        self.offset.set(0);
        self.set_limit(None);
        self.flags.set(ReaderFlags::new());
    }

    /// `None` without a source. The cell is empty while `f` runs.
    fn with_source<R>(&self, f: impl FnOnce(&ReadSource) -> R) -> Option<R> {
        self.source.with_taken(|source| source.as_ref().map(f))
    }

    pub fn has_source(&self) -> bool {
        self.source.is_some()
    }

    /// Both keep their owner.
    pub fn from(&self, other: &WindowsBufferedReader) {
        debug_assert!(other.has_source() && !self.has_source());
        self.take_state_from(other);
        self.source.set(other.source.take());
        self.set_source_owner();
    }

    pub fn watch(&self, _: EventLoopHandle) -> ReadResult {
        // No-op on windows.
        ReadResult::Pending
    }

    /// # Safety
    /// See `PosixBufferedReader::set_owner`.
    pub unsafe fn set_owner(&self, owner: Owner) {
        self.owner.set(owner);
        self.set_source_owner();
    }

    fn set_source_owner(&self) {
        // SAFETY: the contract of `set_owner`, and the source does not outlast `self`.
        self.with_source(|source| unsafe { source.set_owner(self.owner.get()) });
    }

    pub fn update_ref(&self, value: bool) {
        self.with_source(|source| source.update_ref(value));
    }

    fn read_memfd(&self) {}

    /// The source reads into a buffer of its own, so nothing about the reader has to wait for it.
    pub fn has_pending_read(&self) -> bool {
        false
    }

    fn finish(&self) {
        self.update_flags(|f| f.insert(ReaderFlags::IS_DONE));
        self.buffer.with_taken(Vec::shrink_to_fit);
    }

    fn fail(&self, err: sys::Error) -> ReadResult {
        self.finish();
        ReadResult::Err(err)
    }

    pub fn start_with_current_source(&self) -> sys::Result<()> {
        debug_assert!(self.has_source());
        self.buffer.with_taken(Vec::clear);
        self.update_flags(|f| f.remove(ReaderFlags::IS_DONE));
        // For test/js/bun/spawn/spawn-pipe-start-error.test.ts.
        #[cfg(debug_assertions)]
        if bun_core::env_var::feature_flag::BUN_INTERNAL_FAIL_PIPE_READER_START.get() == Some(true)
        {
            return sys::Result::Err(sys::Error::from_code(sys::E::EINVAL, sys::Tag::open));
        }
        self.start_reading();
        sys::Result::Ok(())
    }

    pub fn start_own_pipe(&self, ev: EventLoopHandle, pipe: sys::File) -> sys::Result<ReadResult> {
        self.start_with_pipe(Pipe::from_exclusive(ev.loop_().port(), pipe))?;
        sys::Result::Ok(ReadResult::Pending)
    }

    pub fn set_own_pipe(&self, ev: EventLoopHandle, pipe: sys::File) {
        self.set_pipe(Pipe::from_exclusive(ev.loop_().port(), pipe));
    }

    pub fn start_with_pipe(&self, pipe: Pipe) -> sys::Result<()> {
        self.set_pipe(pipe);
        self.start_with_current_source()
    }

    /// Reading starts later, or never.
    pub fn set_pipe(&self, pipe: Pipe) {
        self.set_source(pipe.into());
    }

    fn set_source(&self, source: ReadSource) {
        debug_assert!(!self.has_source());
        self.source.set(Some(source));
        self.set_source_owner();
    }

    pub fn start(
        &self,
        ev: EventLoopHandle,
        file: MaybeOwnedFile,
        _: bool,
    ) -> sys::Result<ReadResult> {
        let offset = (self.has_flag(ReaderFlags::USE_PREAD)).then(|| self.offset.get() as u64);
        self.set_source(ReadSource::open(ev.loop_().port(), file, offset)?);
        self.start_with_current_source()?;
        sys::Result::Ok(ReadResult::Pending)
    }

    fn start_reading(&self) {
        // A used-up limit stays paused: `start` has nothing to read and `unpause` reports it as EOF instead.
        if self.has_flag(ReaderFlags::IS_DONE)
            || !self.has_flag(ReaderFlags::IS_PAUSED)
            || self.limit.reached()
        {
            return;
        }
        self.update_flags(|f| f.remove(ReaderFlags::IS_PAUSED));
        self.with_source(|source| source.read(self.clamp_len(usize::MAX)));
    }

    pub fn pause(&self) {
        if self.has_flag(ReaderFlags::IS_DONE) || self.has_flag(ReaderFlags::IS_PAUSED) {
            return;
        }
        self.update_flags(|f| f.insert(ReaderFlags::IS_PAUSED));
        self.with_source(ReadSource::pause);
    }

    /// What a child has written by now, to pass to `read` without waiting for the loop to find it.
    pub fn take_available(&self) -> Option<IoEvent> {
        self.with_source(ReadSource::take_available)?
            .map(IoEvent::Read)
    }

    pub fn release_handle(&self) {
        self.close_source();
    }

    /// `false` if there was none.
    fn close_source(&self) -> bool {
        self.update_flags(|f| f.insert(ReaderFlags::IS_PAUSED));
        self.source.take().is_some()
    }

    pub fn close(&self) -> ReadResult {
        if !self.close_source() {
            return ReadResult::Pending;
        }
        self.finish();
        ReadResult::Done
    }

    /// Explicit teardown with nothing to report (unlike [`close`](Self::close)).
    pub fn deinit(&self) {
        if self.close_source() {
            self.update_flags(|f| f.insert(ReaderFlags::CLOSED_WITHOUT_REPORTING));
        }
        self.buffer.take();
    }

    /// Returns the state of the chunk in the buffer.
    fn begin(&self, event: Option<IoEvent>) -> Result<ReadState, ReadResult> {
        let event = match event {
            // we cannot sync read pipes on Windows so we just check if we are paused to resume the reading
            None => return Err(self.unpause()),
            Some(IoEvent::Read(event)) => event,
            Some(IoEvent::Write(_)) => unreachable!("a write was passed to a reader"),
        };
        let has_more = match event {
            ReadEvent::Data(data) => {
                // Using the limit up is this reader's EOF (`ReadLimit`); so is exhausting `maxBuffer`.
                let limit_reached = self.limit.charge(data.len());
                let has_more = !(self.charge_max_buffer(data.len()) || limit_reached);
                self.append(data);
                has_more
            }
            ReadEvent::Eof => false,
            ReadEvent::Err(err) => {
                self.update_flags(|f| f.insert(ReaderFlags::IS_PAUSED));
                return Err(self.fail(err));
            }
            ReadEvent::VmTeardown => return Err(self.close()),
        };
        if !has_more {
            self.update_flags(|f| f.insert(ReaderFlags::RECEIVED_EOF | ReaderFlags::IS_PAUSED));
            return Ok(ReadState::Eof);
        }
        Ok(ReadState::Progress)
    }

    fn append(&self, data: Vec<u8>) {
        let spare = self.buffer.with_taken(|buffer| {
            if buffer.is_empty() {
                return mem::replace(buffer, data);
            }
            buffer.extend_from_slice(&data);
            data
        });
        self.with_source(|source| source.recycle(spare));
    }

    fn advance(&self, state: ReadState) -> ReadResult {
        if state == ReadState::Eof {
            return self.close();
        }
        if !self.has_flag(ReaderFlags::IS_PAUSED) {
            self.with_source(|source| source.read_on(self.clamp_len(usize::MAX)));
        }
        ReadResult::Pending
    }

    pub fn unpause(&self) -> ReadResult {
        if self.limit.reached() && !self.is_done() {
            // Nothing was ever there to read: report EOF the way a completed read does instead of issuing one.
            self.update_flags(|f| f.insert(ReaderFlags::RECEIVED_EOF));
            return self.close();
        }
        self.start_reading();
        ReadResult::Pending
    }

    /// See `PosixBufferedReader::read`.
    pub fn read(&self, _: EventLoopHandle, event: Option<IoEvent>) -> ReadResult {
        match self.begin(event) {
            Ok(state) => self.advance(state),
            Err(result) => result,
        }
    }

    /// See `PosixBufferedReader::read_chunks`.
    pub fn read_chunks(
        &self,
        _: EventLoopHandle,
        event: Option<IoEvent>,
        mut on_chunk: impl FnMut(Chunk<'_>, ReadState) -> bool,
    ) -> ReadResult {
        let state = match self.begin(event) {
            Ok(state) => state,
            Err(result) => return result,
        };
        let mut buffer = self.buffer.take();
        // Owners that want the reader paused call `pause()` themselves.
        if !buffer.is_empty() && state == ReadState::Eof {
            on_chunk(Chunk::Owned(buffer), state);
        } else if !buffer.is_empty() {
            on_chunk(Chunk::Buffer(&mut buffer), state);
            self.with_source(|source| source.recycle(buffer));
        }
        self.advance(state)
    }

    /// Reads never complete synchronously on Windows; this just makes sure one is in flight.
    pub fn read_into(&self, _: EventLoopHandle, _dst: &mut [u8]) -> (usize, ReadState, ReadResult) {
        (0, ReadState::Progress, self.unpause())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Platform alias
// ──────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
pub type BufferedReader = PosixBufferedReader;
#[cfg(windows)]
pub type BufferedReader = WindowsBufferedReader;
#[cfg(not(any(unix, windows)))]
compile_error!("Unsupported platform");
