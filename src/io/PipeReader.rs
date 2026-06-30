use core::ffi::c_void;
use core::mem;
use core::ptr::NonNull;

use bun_sys::{self as sys, Fd};

use crate::{EventLoopHandle, FilePollFlag, FilePollKind, FilePollRef, Owner, PollTag};
// `bun.Async.Loop` — the uws `us_loop_t` wrapper on every platform.
// `BufferedReaderParent::loop_` returns this; Windows engine-handle creation
// bridges to the native loop inside `source.rs`.
//
// Public so trait implementors in `bun_runtime` can name the same type in
// their `loop_` signature.
pub type Loop = bun_uws_sys::Loop;

/// `bun_io::poll_tag::BUFFERED_READER` — every `FilePoll` allocated by this
/// module stores a `*mut BufferedReader` (erased) as its owner; the per-tag
/// dispatch in `bun_runtime::dispatch::__bun_run_file_poll` recovers the type
/// from this constant. T2 cannot name `bun_io`, so the value is mirrored.
use crate::max_buf::MaxBuf;
use crate::pipes::{FileType, PollOrFd, ReadState};
#[cfg(windows)]
use crate::source::Source;

#[cfg(windows)]
use bun_sys::windows::win_error;
#[cfg(windows)]
use bun_windows_sys::Win32Error;

// All logging in this module goes through `bun.sys.syslog` (the `SYS` scope).

// ──────────────────────────────────────────────────────────────────────────
// BufferedReaderVTable
// ──────────────────────────────────────────────────────────────────────────

pub struct BufferedReaderVTable {
    pub parent: *mut c_void,
    pub kind: crate::BufferedReaderParentLinkKind,
}

/// Trait that parent types implement to receive buffered-reader callbacks.
///
/// ## Aliasing contract (raw `*mut Self`, not `&mut self`)
///
/// The parent `Self` *contains*
/// the `BufferedReader` as a field, and these callbacks are invoked from inside
/// `BufferedReader` methods that hold a live `&mut BufferedReader`. Taking
/// `&mut self` here would therefore materialize a `&mut Self` overlapping that
/// live borrow (Stacked-Borrows UB). Instead each callback receives the raw
/// `*mut Self` registered via `set_parent`.
///
/// SAFETY requirements for implementors:
/// - `this` is non-null, properly aligned, and points at a live `Self` for the
///   duration of the call.
/// - A `&mut` to the embedded reader field may be live on the caller's stack.
///   Implementors must not assume unique access to that field while servicing
///   the callback; access other fields via `&mut (*this).field` /
///   `addr_of_mut!` or reborrow `&mut *this` only when the reader is known to
///   be done with `self` (e.g. tail-position `on_reader_done`).
pub trait BufferedReaderParent {
    /// `link_interface!` variant for this type. Each impl pairs this with a
    /// `bun_io::buffered_reader_parent_link!(KIND for Self)` at module scope.
    const KIND: crate::BufferedReaderParentLinkKind;
    /// Mirrors `@hasDecl(Type, "onReadChunk")`.
    const HAS_ON_READ_CHUNK: bool = true;

    unsafe fn on_read_chunk(this: *mut Self, chunk: &[u8], has_more: ReadState) -> bool {
        let _ = (this, chunk, has_more);
        // Default: should not be called when HAS_ON_READ_CHUNK == false.
        true
    }
    unsafe fn on_reader_done(this: *mut Self);
    unsafe fn on_reader_error(this: *mut Self, err: sys::Error);
    unsafe fn loop_(this: *mut Self) -> *mut Loop;
    unsafe fn event_loop(this: *mut Self) -> EventLoopHandle;
    /// Fired when this reader's `MaxBuf` budget goes negative. Only
    /// `SubprocessPipeReader` overrides this; the default no-ops because no
    /// other parent type wires a `MaxBuf`.
    unsafe fn on_max_buffer_overflow(this: *mut Self, maxbuf: NonNull<MaxBuf>) {
        let _ = (this, maxbuf);
    }
}

impl BufferedReaderVTable {
    pub(crate) fn init<T: BufferedReaderParent>() -> BufferedReaderVTable {
        BufferedReaderVTable {
            parent: core::ptr::null_mut(),
            kind: T::KIND,
        }
    }

    #[inline]
    fn link(&self) -> crate::BufferedReaderParentLink {
        // SAFETY: `parent` is a `*mut T` matching `kind` per `set_parent`'s
        // contract; raw-ptr passthrough, no `&mut T` materialized.
        unsafe { crate::BufferedReaderParentLink::new(self.kind, self.parent) }
    }

    pub(crate) fn event_loop(&self) -> EventLoopHandle {
        self.link().event_loop()
    }

    pub(crate) fn loop_(&self) -> *mut Loop {
        self.link().loop_ptr()
    }

    pub(crate) fn is_streaming_enabled(&self) -> bool {
        self.link().has_on_read_chunk()
    }

    /// When the reader has read a chunk of data
    /// and hasMore is true, it means that there might be more data to read.
    ///
    /// Returning false prevents the reader from reading more data.
    pub(crate) fn on_read_chunk(&self, chunk: &[u8], has_more: ReadState) -> bool {
        self.link().on_read_chunk(chunk, has_more)
    }

    pub(crate) fn on_reader_done(&self) {
        self.link().on_reader_done()
    }

    pub(crate) fn on_reader_error(&self, err: sys::Error) {
        self.link().on_reader_error(err)
    }

    pub(crate) fn on_max_buffer_overflow(&self, maxbuf: NonNull<MaxBuf>) {
        self.link().on_max_buffer_overflow(maxbuf)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PosixBufferedReader
// ──────────────────────────────────────────────────────────────────────────

pub struct PosixBufferedReader {
    pub handle: PollOrFd,
    pub _buffer: Vec<u8>,
    pub _offset: usize,
    pub vtable: BufferedReaderVTable,
    pub flags: PosixFlags,
    pub count: usize,
    // MaxBuf uses hand-rolled dual-ownership (Subprocess + reader) via
    // `add_to_pipereader`/`remove_from_pipereader`, not Arc — see MaxBuf.rs.
    pub maxbuf: Option<NonNull<MaxBuf>>,
}

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
    }
}

impl PosixFlags {
    pub const fn new() -> Self {
        PosixFlags::CLOSE_HANDLE
    }
}

impl PosixBufferedReader {
    pub fn init<T: BufferedReaderParent>() -> PosixBufferedReader {
        PosixBufferedReader {
            handle: PollOrFd::Closed,
            _buffer: Vec::new(),
            _offset: 0,
            vtable: BufferedReaderVTable::init::<T>(),
            flags: PosixFlags::new(),
            count: 0,
            maxbuf: None,
        }
    }

    pub fn update_ref(&self, value: bool) {
        let Some(poll) = self.handle.get_poll() else {
            return;
        };
        poll.set_keeping_process_alive(self.vtable.event_loop(), value);
    }

    #[inline]
    pub fn is_done(&self) -> bool {
        self.flags.intersects(
            PosixFlags::IS_DONE | PosixFlags::RECEIVED_EOF | PosixFlags::CLOSED_WITHOUT_REPORTING,
        )
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self._buffer.capacity()
    }

    pub fn from(&mut self, other: &mut PosixBufferedReader, parent: *mut c_void) {
        let kind = self.vtable.kind;
        *self = PosixBufferedReader {
            handle: mem::replace(&mut other.handle, PollOrFd::Closed),
            _buffer: mem::take(other.buffer()),
            _offset: other._offset,
            flags: other.flags,
            vtable: BufferedReaderVTable { kind, parent },
            count: 0,
            maxbuf: None,
        };
        other.flags.insert(PosixFlags::IS_DONE);
        other._offset = 0;
        MaxBuf::transfer_to_pipereader(&mut other.maxbuf, &mut self.maxbuf);
        // Capture *mut Self before borrowing `handle` so the owner pointer
        // doesn't conflict with the field borrow.
        let owner = std::ptr::from_mut(self).cast::<c_void>();
        self.handle
            .set_owner(Owner::new(PollTag::BufferedReader, owner.cast()));

        // note: the caller is supposed to drain the buffer themselves
        // doing it here automatically makes it very easy to end up reading from the same buffer multiple times.
    }

    pub fn set_parent(&mut self, parent: *mut c_void) {
        self.vtable.parent = parent;
        // Capture *mut Self before borrowing `handle` so the owner pointer
        // doesn't conflict with the field borrow.
        let owner = std::ptr::from_mut(self).cast::<c_void>();
        self.handle
            .set_owner(Owner::new(PollTag::BufferedReader, owner.cast()));
    }

    pub fn start_memfd(&mut self, fd: Fd) {
        self.flags.insert(PosixFlags::MEMFD);
        self.handle = PollOrFd::Fd(fd);
    }

    pub fn get_file_type(&self) -> FileType {
        let flags = self.flags;
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

    pub fn close(&mut self) {
        self.close_handle();
    }

    /// Explicit teardown that does **not** fire `on_reader_done` (unlike
    /// [`close`]). Safe to call
    /// before Drop; both paths are idempotent over an already-released handle.
    pub fn deinit(&mut self) {
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        // clearAndFree — release capacity, not just length.
        self._buffer = Vec::new();
        self.close_without_reporting();
    }

    fn close_without_reporting(&mut self) {
        if self.get_fd() != Fd::INVALID {
            debug_assert!(!self.flags.contains(PosixFlags::CLOSED_WITHOUT_REPORTING));
            self.flags.insert(PosixFlags::CLOSED_WITHOUT_REPORTING);
            if self.flags.contains(PosixFlags::CLOSE_HANDLE) {
                let owner = std::ptr::from_mut(self).cast::<c_void>();
                self.handle.close(Some(owner), None::<fn(*mut c_void)>);
            }
        }
    }

    pub fn get_fd(&self) -> Fd {
        self.handle.get_fd()
    }

    pub fn pause(&mut self) {
        if self.flags.contains(PosixFlags::IS_PAUSED) {
            return;
        }
        self.flags.insert(PosixFlags::IS_PAUSED);

        // Unregister the FilePoll if it's registered
        if let PollOrFd::Poll(poll) = &mut self.handle {
            if poll.is_registered() {
                let _ = poll.unregister(self.vtable.loop_().cast(), false);
            }
        }
    }

    pub fn unpause(&mut self) {
        if !self.flags.contains(PosixFlags::IS_PAUSED) {
            return;
        }
        self.flags.remove(PosixFlags::IS_PAUSED);
        // The next read() call will re-register the poll if needed
    }

    pub fn take_buffer(&mut self) -> Vec<u8> {
        mem::take(&mut self._buffer)
    }

    pub fn buffer(&mut self) -> &mut Vec<u8> {
        &mut self._buffer
    }

    pub fn final_buffer(&mut self) -> &mut Vec<u8> {
        if self.flags.contains(PosixFlags::MEMFD) {
            if let PollOrFd::Fd(fd) = self.handle {
                // The handle is closed after the read regardless of result.
                // `self.handle` owns the fd;
                // borrow a non-owning `File` view so the temporary doesn't
                // close it on drop (handle.close() below does).
                let result = sys::File::borrow(&fd)
                    .read_to_end_with_array_list(&mut self._buffer, sys::SizeHint::UnknownSize);
                self.handle.close(None, None::<fn(*mut c_void)>);
                if let Err(err) = result {
                    bun_core::debug_warn!("error reading from memfd\n{}", err);
                    return self.buffer();
                }
            }
        }

        self.buffer()
    }

    pub fn disable_keeping_process_alive<C>(&self, _event_loop_ctx: C) {
        self.update_ref(false);
    }

    pub fn enable_keeping_process_alive<C>(&self, _event_loop_ctx: C) {
        self.update_ref(true);
    }

    fn finish(&mut self) {
        if !matches!(self.handle, PollOrFd::Closed)
            || self.flags.contains(PosixFlags::CLOSED_WITHOUT_REPORTING)
        {
            if self.flags.contains(PosixFlags::CLOSE_HANDLE) {
                self.close_handle();
            }
            return;
        }

        debug_assert!(!self.flags.contains(PosixFlags::IS_DONE));
        self.flags.insert(PosixFlags::IS_DONE);
        self._buffer.shrink_to_fit();
    }

    fn close_handle(&mut self) {
        if self.flags.contains(PosixFlags::CLOSED_WITHOUT_REPORTING) {
            self.flags.remove(PosixFlags::CLOSED_WITHOUT_REPORTING);
            self.done();
            return;
        }

        if self.flags.contains(PosixFlags::CLOSE_HANDLE) {
            let owner = std::ptr::from_mut(self).cast::<c_void>();
            self.handle.close(
                Some(owner),
                // SAFETY: ctx == &mut PosixBufferedReader (this fn's `self`).
                Some(|ctx: *mut c_void| unsafe { (*ctx.cast::<PosixBufferedReader>()).done() }),
            );
        }
    }

    pub fn done(&mut self) {
        if !matches!(self.handle, PollOrFd::Closed) && self.flags.contains(PosixFlags::CLOSE_HANDLE)
        {
            self.close_handle();
            return;
        } else if self.flags.contains(PosixFlags::CLOSED_WITHOUT_REPORTING) {
            self.flags.remove(PosixFlags::CLOSED_WITHOUT_REPORTING);
        }
        self.finish();
        self.vtable.on_reader_done();
    }

    pub fn on_error(&mut self, err: sys::Error) {
        self.vtable.on_reader_error(err);
    }

    /// Returns `false` when registration failed and `on_reader_error` was
    /// dispatched. That callback may drop the last reference to the struct
    /// embedding `self` (the shell `PipeReader` does exactly that), so the
    /// caller must not touch `self` again after a `false` return.
    pub fn register_poll(&mut self) -> bool {
        // Hoist vtable-derived scalars and
        // normalize self.handle to Poll before taking the single &mut borrow,
        // so no raw-pointer escape is needed.
        let ev = self.vtable.event_loop();
        let lp = self.vtable.loop_();
        let owner_ptr = std::ptr::from_mut(self).cast::<c_void>();

        if let PollOrFd::Fd(fd) = self.handle {
            if !self.flags.contains(PosixFlags::POLLABLE) {
                return true;
            }
            self.handle = PollOrFd::Poll(FilePollRef::init(
                ev,
                fd,
                Owner::new(PollTag::BufferedReader, owner_ptr.cast()),
            ));
        }
        let Some(poll) = self.handle.get_poll_mut() else {
            return true;
        };
        poll.set_owner(Owner::new(PollTag::BufferedReader, owner_ptr.cast()));

        if !poll.has_flag(FilePollFlag::WasEverRegistered) {
            poll.enable_keeping_process_alive(ev);
        }

        match poll.register_with_fd(lp.cast(), FilePollKind::Readable, poll.fd()) {
            sys::Result::Err(err) => {
                self.vtable.on_reader_error(err);
                false
            }
            sys::Result::Ok(()) => true,
        }
    }

    pub fn start(&mut self, fd: Fd, is_pollable: bool) -> sys::Result<()> {
        if !is_pollable {
            self.buffer().clear();
            self.flags.remove(PosixFlags::IS_DONE);
            self.handle.close(None, None::<fn(*mut c_void)>);
            self.handle = PollOrFd::Fd(fd);
            return sys::Result::Ok(());
        }
        self.flags.insert(PosixFlags::POLLABLE);
        if self.get_fd() != fd {
            self.handle = PollOrFd::Fd(fd);
        }
        self.register_poll();

        sys::Result::Ok(())
    }

    pub fn start_file_offset(&mut self, fd: Fd, poll: bool, offset: usize) -> sys::Result<()> {
        self._offset = offset;
        self.flags.insert(PosixFlags::USE_PREAD);
        self.start(fd, poll)
    }

    // Exists for consistently with Windows.
    pub fn has_pending_read(&self) -> bool {
        matches!(&self.handle, PollOrFd::Poll(poll) if poll.is_registered())
    }

    pub fn watch(&mut self) {
        if self.flags.contains(PosixFlags::POLLABLE) {
            self.register_poll();
        }
    }

    pub fn has_pending_activity(&self) -> bool {
        match &self.handle {
            PollOrFd::Poll(poll) => poll.is_active(),
            PollOrFd::Fd(_) => true,
            _ => false,
        }
    }

    pub fn loop_(&self) -> *mut Loop {
        self.vtable.loop_()
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        self.vtable.event_loop()
    }

    pub fn read(&mut self) {
        // Don't initiate new reads if paused
        if self.flags.contains(PosixFlags::IS_PAUSED) {
            return;
        }

        let fd = self.get_fd();

        match self.get_file_type() {
            FileType::NonblockingPipe => {
                Self::read_pipe(self, fd, 0, false);
            }
            FileType::File => {
                Self::read_file(self, fd, 0, false);
            }
            FileType::Socket => {
                Self::read_socket(self, fd, 0, false);
            }
            FileType::Pipe => match bun_core::is_readable(fd) {
                bun_core::Pollable::Ready => {
                    Self::read_from_blocking_pipe_without_blocking(self, fd, 0, false);
                }
                bun_core::Pollable::Hup => {
                    Self::read_from_blocking_pipe_without_blocking(self, fd, 0, true);
                }
                bun_core::Pollable::NotReady => {
                    self.register_poll();
                }
            },
        }
    }

    pub fn on_poll(parent: &mut PosixBufferedReader, size_hint: isize, received_hup: bool) {
        let fd = parent.get_fd();
        bun_sys::syslog!("onPoll({}) = {}", fd, size_hint);

        match parent.get_file_type() {
            FileType::NonblockingPipe => {
                Self::read_pipe(parent, fd, size_hint, received_hup);
            }
            FileType::File => {
                Self::read_file(parent, fd, size_hint, received_hup);
            }
            FileType::Socket => {
                Self::read_socket(parent, fd, size_hint, received_hup);
            }
            FileType::Pipe => {
                Self::read_from_blocking_pipe_without_blocking(parent, fd, size_hint, received_hup);
            }
        }
    }

    // Takes &vtable instead of &mut Self so
    // call sites can pass &parent._buffer alongside without a raw-pointer escape.
    #[inline]
    fn drain_chunk(vtable: &BufferedReaderVTable, chunk: &[u8], has_more: ReadState) -> bool {
        if vtable.is_streaming_enabled() {
            if !chunk.is_empty() {
                return vtable.on_read_chunk(chunk, has_more);
            }
        }

        false
    }

    fn read_file(parent: &mut PosixBufferedReader, fd: Fd, size_hint: isize, received_hup: bool) {
        fn pread_fn(fd1: Fd, buf: &mut [u8], offset: usize) -> sys::Result<usize> {
            sys::pread(fd1, buf, i64::try_from(offset).expect("int cast"))
        }
        if parent.flags.contains(PosixFlags::USE_PREAD) {
            Self::read_with_fn(
                parent,
                FileType::File,
                fd,
                size_hint,
                received_hup,
                pread_fn,
            );
        } else {
            Self::read_with_fn(
                parent,
                FileType::File,
                fd,
                size_hint,
                received_hup,
                |fd, buf, _| sys::read(fd, buf),
            );
        }
    }

    fn read_socket(parent: &mut PosixBufferedReader, fd: Fd, size_hint: isize, received_hup: bool) {
        Self::read_with_fn(
            parent,
            FileType::Socket,
            fd,
            size_hint,
            received_hup,
            |fd, buf, _| sys::recv_non_block(fd, buf),
        );
    }

    fn read_pipe(parent: &mut PosixBufferedReader, fd: Fd, size_hint: isize, received_hup: bool) {
        Self::read_with_fn(
            parent,
            FileType::NonblockingPipe,
            fd,
            size_hint,
            received_hup,
            |fd, buf, _| sys::read_nonblocking(fd, buf),
        );
    }

    fn read_blocking_pipe(
        parent: &mut PosixBufferedReader,
        fd: Fd,
        _size_hint: isize,
        received_hup_initially: bool,
    ) {
        // PORT_NOTES_PLAN R-2: `&mut parent` carries LLVM `noalias`, but
        // `vtable.on_read_chunk` below re-enters JS (e.g.
        // `FileReader::on_read_chunk` resolves a promise → drains microtasks)
        // and user code can reach this reader via a fresh
        // `&mut PosixBufferedReader` from the parent's intrusive `reader`
        // field, writing `self.flags` / `self._buffer` / `self.handle`. Not
        // currently ASM-cached (noalias-hunt SUSPECT), but one inlining change
        // away from caching `flags`/`_buffer.{ptr,cap}` across the call so the
        // next loop iteration's `_buffer.capacity()` / `IS_DONE` check / poll
        // re-arm operate on stale state. Launder so `parent` is derived from
        // an opaque pointer that LLVM must assume the vtable dispatch may
        // write through; mirrors the cork fix at b818e70e1c57. Stacked-Borrows
        // is still violated by the re-entrant `&mut` alias regardless — this
        // addresses the codegen hazard only.
        let this: *mut PosixBufferedReader = core::hint::black_box(core::ptr::from_mut(parent));
        // SAFETY: `this` aliases the live `&mut parent`; single JS thread.
        // Shadow-rebind so the local `parent` is no longer the `noalias` arg
        // but a raw-ptr-derived borrow whose loads must reload after each
        // opaque vtable call (precedent: `JSMySQLQuery::resolve`'s guard
        // re-borrow). The reader struct is an inline field of its parent;
        // `on_read_chunk` re-entry never frees it per `BufferedReaderParent`'s
        // contract, so `*this` stays a valid place even if re-entry calls
        // `done()`/`close()`. `on_reader_error` MAY free it, and every
        // `register_poll()`/`on_error()` below is in tail position, so nothing
        // touches `parent` after one can have dispatched it.
        let parent = unsafe { &mut *this };
        let mut received_hup = received_hup_initially;
        loop {
            let streaming = parent.vtable.is_streaming_enabled();
            let mut got_retry = false;

            if parent._buffer.capacity() == 0 {
                // Use stack buffer for streaming — per-loop scratch buffer;
                // single-threaded event loop (see `EventLoopCtx::pipe_read_buffer_mut`).
                let stack_buffer = parent.vtable.event_loop().pipe_read_buffer_mut();

                match sys::read_nonblocking(fd, stack_buffer) {
                    sys::Result::Ok(bytes_read) => {
                        if let Some(l) = parent.maxbuf {
                            if MaxBuf::on_read_bytes(l, bytes_read as u64) {
                                parent.vtable.on_max_buffer_overflow(l);
                            }
                        }

                        if bytes_read == 0 {
                            // EOF - finished and closed pipe
                            parent.close_without_reporting();
                            if !parent.flags.contains(PosixFlags::IS_DONE) {
                                parent.done();
                            }
                            return;
                        }

                        if streaming {
                            // Stream this chunk and register for next cycle
                            let _ = parent.vtable.on_read_chunk(
                                &stack_buffer[..bytes_read],
                                if received_hup && bytes_read < stack_buffer.len() {
                                    ReadState::Eof
                                } else {
                                    ReadState::Progress
                                },
                            );
                        } else {
                            parent
                                ._buffer
                                .extend_from_slice(&stack_buffer[..bytes_read]);
                        }
                    }
                    sys::Result::Err(err) => {
                        if !err.is_retry() {
                            parent.on_error(err);
                            return;
                        }
                        // EAGAIN - fall through to register for next poll
                        got_retry = true;
                    }
                }
            } else {
                parent._buffer.reserve(16 * 1024);
                let buf_len = {
                    // SAFETY: sys::read_nonblocking writes only initialized bytes into
                    // the prefix it reports; commit_spare exposes exactly that prefix.
                    let buf = unsafe { bun_core::vec::spare_bytes_mut(&mut parent._buffer) };
                    let buf_len = buf.len();
                    match sys::read_nonblocking(fd, buf) {
                        sys::Result::Ok(bytes_read) => {
                            if let Some(l) = parent.maxbuf {
                                if MaxBuf::on_read_bytes(l, bytes_read as u64) {
                                    parent.vtable.on_max_buffer_overflow(l);
                                }
                            }
                            parent._offset += bytes_read;
                            // SAFETY: bytes_read bytes were just initialized by the syscall.
                            unsafe { bun_core::vec::commit_spare(&mut parent._buffer, bytes_read) };

                            if bytes_read == 0 {
                                parent.close_without_reporting();
                                if !parent.flags.contains(PosixFlags::IS_DONE) {
                                    parent.done();
                                }
                                return;
                            }

                            if streaming {
                                let new_len = parent._buffer.len();
                                let chunk = &parent._buffer[new_len - bytes_read..new_len];
                                if !parent.vtable.on_read_chunk(
                                    chunk,
                                    if received_hup && bytes_read < buf_len {
                                        ReadState::Eof
                                    } else {
                                        ReadState::Progress
                                    },
                                ) {
                                    return;
                                }
                            }
                            buf_len
                        }
                        sys::Result::Err(err) => {
                            if !err.is_retry() {
                                parent.on_error(err);
                                return;
                            }
                            got_retry = true;
                            buf_len
                        }
                    }
                };
                let _ = buf_len;
            }

            // Register for next poll cycle unless we got HUP
            if !received_hup {
                parent.register_poll();
                return;
            }

            // We have received HUP. Normally that means all writers are gone
            // and draining the buffer will eventually hit EOF (read() == 0),
            // so we loop locally instead of re-arming the poll (HUP is
            // level-triggered and would fire again immediately).
            //
            // But `received_hup` is a snapshot from when the epoll/kqueue
            // event fired. `onReadChunk` above re-enters JS (resolves the
            // pending read, drains microtasks, fires the 'data' event), and
            // user code there can open a new writer on the same FIFO — after
            // which the pipe is no longer hung up. Looping again would then
            // either spin forever on EAGAIN (if the fd is O_NONBLOCK) or
            // block the event loop in read() (if the fd is blocking and
            // RWF_NOWAIT is unavailable — Linux named FIFOs return
            // EOPNOTSUPP for it, unlike anonymous pipes).
            //
            // An explicit EAGAIN proves the HUP is stale, so re-arm.
            if got_retry {
                parent.register_poll();
                return;
            }
            // Otherwise we just returned from user JS; re-poll the fd to see
            // whether HUP still holds before committing to another blocking
            // read. This is one extra poll() per chunk only on the HUP path
            // (i.e. while draining the final buffered bytes), not per read.
            match bun_core::is_readable(fd) {
                bun_core::Pollable::Hup => {
                    // Still hung up; keep draining towards EOF.
                }
                bun_core::Pollable::Ready => {
                    // Data is available but HUP cleared — a writer came back.
                    // Drop the stale HUP so the next iteration takes the
                    // normal registerPoll() exit once the data is drained.
                    received_hup = false;
                }
                bun_core::Pollable::NotReady => {
                    // No data and no HUP: a writer exists. Go back to the
                    // event loop instead of blocking in read().
                    parent.register_poll();
                    return;
                }
            }
        }
    }

    // PERF: `file_type` is a runtime arg (adt_const_params is unstable); `sys_fn`
    // is generic so it still monomorphizes — profile if hot.
    fn read_with_fn(
        parent: &mut PosixBufferedReader,
        file_type: FileType,
        fd: Fd,
        _size_hint: isize,
        received_hup: bool,
        sys_fn: impl Fn(Fd, &mut [u8], usize) -> sys::Result<usize>,
    ) {
        // PORT_NOTES_PLAN R-2: `&mut parent` carries LLVM `noalias`, but
        // `vtable.on_read_chunk` below re-enters JS (resolves the pending
        // read, drains microtasks, fires `'data'`) and user code can reach
        // this reader via a fresh `&mut PosixBufferedReader` from the parent's
        // intrusive `reader` field, writing `self._buffer` / `self.flags` /
        // `self.handle`. Not currently ASM-cached (noalias-hunt SUSPECT), but
        // one inlining change away from caching `_buffer.{ptr,len,cap}` across
        // the call so the post-call `_buffer.clear()` / `capacity()` / inner-
        // loop `set_len` operate on a stale Vec header (UAF if re-entry
        // reallocated). Launder so `parent` is derived from an opaque pointer
        // that LLVM must assume the vtable dispatch may write through; mirrors
        // the cork fix at b818e70e1c57. Stacked-Borrows is still violated by
        // the re-entrant `&mut` alias regardless — this addresses the codegen
        // hazard only.
        let this: *mut PosixBufferedReader = core::hint::black_box(core::ptr::from_mut(parent));
        // SAFETY: `this` aliases the live `&mut parent`; single JS thread.
        // Shadow-rebind so the local `parent` is no longer the `noalias` arg
        // but a raw-ptr-derived borrow (precedent: `JSMySQLQuery::resolve`).
        // The reader struct is an inline field of its parent, which
        // `on_read_chunk` re-entry never frees per `BufferedReaderParent`'s
        // contract. `on_reader_error` MAY free it, so nothing below touches
        // `parent` after dispatching an error (see the EAGAIN arm).
        let parent = unsafe { &mut *this };
        let streaming = parent.vtable.is_streaming_enabled();

        if streaming {
            // Per-loop scratch buffer; single-threaded event loop (see
            // `EventLoopCtx::pipe_read_buffer_mut`).
            let event_loop = parent.vtable.event_loop();
            let stack_buffer_len = event_loop.pipe_read_buffer_mut().len();
            while parent._buffer.capacity() == 0 {
                let stack_buffer_cutoff = stack_buffer_len / 2;
                let mut head_start = 0usize; // index into stack_buffer where the unwritten head begins
                while stack_buffer_len - head_start > 16 * 1024 {
                    let buf = &mut event_loop.pipe_read_buffer_mut()[head_start..];

                    match sys_fn(fd, buf, parent._offset) {
                        sys::Result::Ok(bytes_read) => {
                            if let Some(l) = parent.maxbuf {
                                if MaxBuf::on_read_bytes(l, bytes_read as u64) {
                                    parent.vtable.on_max_buffer_overflow(l);
                                }
                            }
                            parent._offset += bytes_read;
                            head_start += bytes_read;

                            if bytes_read == 0 {
                                parent.close_without_reporting();
                                if head_start > 0 {
                                    let _ = parent.vtable.on_read_chunk(
                                        &event_loop.pipe_read_buffer_mut()[..head_start],
                                        ReadState::Eof,
                                    );
                                }
                                if !parent.flags.contains(PosixFlags::IS_DONE) {
                                    parent.done();
                                }
                                return;
                            }

                            // Keep reading as much as we can
                            if (stack_buffer_len - head_start) < stack_buffer_cutoff {
                                // `&& !received_hup` mirrors the
                                // after-inner-loop flush below (line ~855).
                                // Without it, a peer close (HUP) with >cutoff
                                // bytes still buffered makes a parent that
                                // returns `false` on `.eof` (e.g. shell
                                // `PipeReader::on_read_chunk`) early-return
                                // here with data left in the kernel and no
                                // `register_poll`/`done()` → 90s hang in
                                // shell-blocking-pipe.test.ts.
                                // Once HUP is set the kernel
                                // returns the remaining bytes then 0, so
                                // draining to `bytes_read == 0` is bounded.
                                if !parent.vtable.on_read_chunk(
                                    &event_loop.pipe_read_buffer_mut()[..head_start],
                                    if received_hup {
                                        ReadState::Eof
                                    } else {
                                        ReadState::Progress
                                    },
                                ) && !received_hup
                                {
                                    return;
                                }
                                head_start = 0;
                            }
                        }
                        sys::Result::Err(err) => {
                            if err.is_retry() {
                                if file_type == FileType::File {
                                    bun_core::debug_warn!(
                                        "Received EAGAIN while reading from a file. This is a bug.",
                                    );
                                } else if !parent.register_poll() {
                                    // `on_reader_error` ran and may have freed
                                    // the struct embedding `parent`; the
                                    // drained head must not be delivered.
                                    return;
                                }

                                if head_start > 0 {
                                    let _ = parent.vtable.on_read_chunk(
                                        &event_loop.pipe_read_buffer_mut()[..head_start],
                                        ReadState::Drained,
                                    );
                                }
                                return;
                            }

                            if head_start > 0 {
                                let _ = parent.vtable.on_read_chunk(
                                    &event_loop.pipe_read_buffer_mut()[..head_start],
                                    ReadState::Progress,
                                );
                            }
                            parent.on_error(err);
                            return;
                        }
                    }
                }

                if head_start > 0 {
                    if !parent.vtable.on_read_chunk(
                        &event_loop.pipe_read_buffer_mut()[..head_start],
                        if received_hup {
                            ReadState::Eof
                        } else {
                            ReadState::Progress
                        },
                    ) && !received_hup
                    {
                        return;
                    }
                }

                if !parent.vtable.is_streaming_enabled() {
                    break;
                }
            }
        } else if parent._buffer.capacity() == 0 && parent._offset == 0 {
            // Avoid a 16 KB dynamic memory allocation when the buffer might very well be empty.
            // Per-loop scratch buffer; single-threaded event loop (see
            // `EventLoopCtx::pipe_read_buffer_mut`).
            let stack_buffer = parent.vtable.event_loop().pipe_read_buffer_mut();

            // Unlike the block of code following this one, only handle the non-streaming case.
            debug_assert!(!streaming);

            match sys_fn(fd, stack_buffer, 0) {
                sys::Result::Ok(bytes_read) => {
                    if bytes_read > 0 {
                        parent
                            ._buffer
                            .extend_from_slice(&stack_buffer[..bytes_read]);
                    }
                    if let Some(l) = parent.maxbuf {
                        if MaxBuf::on_read_bytes(l, bytes_read as u64) {
                            parent.vtable.on_max_buffer_overflow(l);
                        }
                    }
                    parent._offset += bytes_read;

                    if bytes_read == 0 {
                        parent.close_without_reporting();
                        let _ = Self::drain_chunk(&parent.vtable, &parent._buffer, ReadState::Eof);
                        if !parent.flags.contains(PosixFlags::IS_DONE) {
                            parent.done();
                        }
                        return;
                    }
                }
                sys::Result::Err(err) => {
                    if err.is_retry() {
                        if file_type == FileType::File {
                            bun_core::debug_warn!(
                                "Received EAGAIN while reading from a file. This is a bug.",
                            );
                        } else {
                            parent.register_poll();
                        }
                        return;
                    }
                    parent.on_error(err);
                    return;
                }
            }

            // Allow falling through
        }

        loop {
            parent._buffer.reserve(16 * 1024);
            // SAFETY: writing into spare capacity; commit after syscall reports bytes written.
            let buf = unsafe { bun_core::vec::spare_bytes_mut(&mut parent._buffer) };

            match sys_fn(fd, buf, parent._offset) {
                sys::Result::Ok(bytes_read) => {
                    if let Some(l) = parent.maxbuf {
                        if MaxBuf::on_read_bytes(l, bytes_read as u64) {
                            parent.vtable.on_max_buffer_overflow(l);
                        }
                    }
                    parent._offset += bytes_read;
                    // SAFETY: bytes_read bytes initialized by sys_fn.
                    unsafe { bun_core::vec::commit_spare(&mut parent._buffer, bytes_read) };

                    if bytes_read == 0 {
                        parent.close_without_reporting();
                        let _ = Self::drain_chunk(&parent.vtable, &parent._buffer, ReadState::Eof);
                        if !parent.flags.contains(PosixFlags::IS_DONE) {
                            parent.done();
                        }
                        return;
                    }

                    if parent.vtable.is_streaming_enabled() {
                        if parent._buffer.len() > 128_000 {
                            let keep_going = parent
                                .vtable
                                .on_read_chunk(&parent._buffer, ReadState::Progress);
                            parent._buffer.clear();
                            if !keep_going {
                                return;
                            }
                            continue;
                        }
                    }
                }
                sys::Result::Err(err) => {
                    if parent.vtable.is_streaming_enabled() {
                        if !parent._buffer.is_empty() {
                            let _ = parent
                                .vtable
                                .on_read_chunk(&parent._buffer, ReadState::Drained);
                            parent._buffer.clear();
                        }
                    }

                    if err.is_retry() {
                        if file_type == FileType::File {
                            bun_core::debug_warn!(
                                "Received EAGAIN while reading from a file. This is a bug.",
                            );
                        } else {
                            parent.register_poll();
                        }
                        return;
                    }
                    parent.on_error(err);
                    return;
                }
            }
        }
    }

    fn read_from_blocking_pipe_without_blocking(
        parent: &mut PosixBufferedReader,
        fd: Fd,
        size_hint: isize,
        received_hup: bool,
    ) {
        if parent.vtable.is_streaming_enabled() {
            parent._buffer.clear();
        }

        Self::read_blocking_pipe(parent, fd, size_hint, received_hup);
    }
}

// Keep boolean state in the `PosixFlags` bitflags field — no loose `bool`
// fields on `PosixBufferedReader`.

impl Drop for PosixBufferedReader {
    fn drop(&mut self) {
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        self.close_without_reporting();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WindowsBufferedReader
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub struct WindowsBufferedReader {
    /// The pointer to this source must be stable: the engine targets its
    /// pinned read buffer and the close callback frees the wrapper.
    pub source: Option<Source>,
    pub _offset: usize,
    pub _buffer: Vec<u8>,
    // for compatibility with Linux
    pub flags: WindowsFlags,
    pub maxbuf: Option<NonNull<MaxBuf>>,

    pub parent: *mut c_void,
    pub vtable: BufferedReaderVTable,
}

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
    }
}

impl WindowsFlags {
    pub const fn new() -> Self {
        Self::from_bits_truncate(WindowsFlags::CLOSE_HANDLE.bits() | WindowsFlags::IS_PAUSED.bits())
    }
}

#[cfg(windows)]
impl WindowsBufferedReader {
    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self._buffer.capacity()
    }

    pub fn init<T: BufferedReaderParent>() -> WindowsBufferedReader {
        WindowsBufferedReader {
            source: None,
            _offset: 0,
            _buffer: Vec::new(),
            flags: WindowsFlags::new(),
            maxbuf: None,
            parent: core::ptr::null_mut(),
            vtable: BufferedReaderVTable::init::<T>(),
        }
    }

    #[inline]
    pub fn is_done(&self) -> bool {
        self.flags.intersects(
            WindowsFlags::IS_DONE
                | WindowsFlags::RECEIVED_EOF
                | WindowsFlags::CLOSED_WITHOUT_REPORTING,
        )
    }

    pub fn from(&mut self, other: &mut WindowsBufferedReader, parent: *mut c_void) {
        debug_assert!(other.source.is_some() && self.source.is_none());
        // Keep self.vtable; move other's state in.
        self.flags = other.flags;
        self._buffer = mem::take(other.buffer());
        self._offset = other._offset;
        self.source = other.source.take();

        other.flags.insert(WindowsFlags::IS_DONE);
        other._offset = 0;
        // other._buffer / other.source already cleared by mem::take above.
        // The field-by-field assigns above leave `self.maxbuf` untouched, so
        // drop any prior owner-count first to avoid leaking a MaxBuf ref when
        // the destination already held one.
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        MaxBuf::transfer_to_pipereader(&mut other.maxbuf, &mut self.maxbuf);
        self.set_parent(parent);

        // The engine snapshots (cb, data) at read_start, so an actively
        // reading stream still dispatches into `other` — re-register at this
        // address before a completion can land in the dead reader. The engine
        // re-snapshots without double-submitting; stopped/parked sources are
        // re-targeted by their next start_reading instead.
        if !self
            .flags
            .intersects(WindowsFlags::IS_PAUSED | WindowsFlags::IS_DONE)
        {
            let self_ptr = core::ptr::from_mut(self).cast::<c_void>();
            // SAFETY: same contract as `start_reading` — `self` outlives the
            // registration (the source is stopped or closed before free).
            let rc = unsafe {
                match self.source.as_mut().expect("transferred source") {
                    Source::Pipe(pipe) => pipe.read_start(Self::on_pipe_read, self_ptr),
                    Source::Tty(tty) => Source::tty_mut(tty).read_start(Self::on_tty_read, self_ptr),
                    Source::File(_) | Source::SyncFile(_) => Win32Error::SUCCESS,
                }
            };
            if rc != Win32Error::SUCCESS {
                // Surface through the normal restart path: the next
                // start_reading retries and reports the error.
                self.flags.insert(WindowsFlags::IS_PAUSED);
            }
        }
    }

    pub fn get_fd(&self) -> Fd {
        let Some(source) = &self.source else {
            return Fd::INVALID;
        };
        source.get_fd()
    }

    pub fn watch(&mut self) {
        // No-op on windows.
    }

    pub fn set_parent(&mut self, parent: *mut c_void) {
        self.parent = parent;
        self.vtable.parent = parent;
        if !self.flags.contains(WindowsFlags::IS_DONE) {
            // `Source::set_data` only stores the consumer backref (raw ptr
            // store); take a raw self-pointer first to dodge the
            // immutable-then-mutable-borrow conflict.
            let self_ptr = core::ptr::from_mut(self).cast::<c_void>();
            if let Some(source) = self.source.as_mut() {
                source.set_data(self_ptr);
            }
        }
    }

    pub fn update_ref(&mut self, value: bool) {
        if let Some(source) = self.source.as_mut() {
            if value {
                source.ref_();
            } else {
                source.unref();
            }
        }
    }

    pub fn disable_keeping_process_alive<C>(&mut self, _: C) {
        self.update_ref(false);
    }

    pub fn take_buffer(&mut self) -> Vec<u8> {
        mem::take(&mut self._buffer)
    }

    pub fn buffer(&mut self) -> &mut Vec<u8> {
        &mut self._buffer
    }

    pub fn final_buffer(&mut self) -> &mut Vec<u8> {
        self.buffer()
    }

    pub fn has_pending_activity(&self) -> bool {
        let Some(source) = &self.source else {
            return false;
        };
        source.is_active()
    }

    pub fn has_pending_read(&self) -> bool {
        // File reads are synchronous now, so an in-flight read can only be
        // the engine-armed stream read flagged below.
        self.flags.contains(WindowsFlags::HAS_INFLIGHT_READ)
    }

    fn _on_read_chunk(&mut self, buf: &[u8], has_more: ReadState) -> bool {
        if let Some(m) = self.maxbuf {
            if MaxBuf::on_read_bytes(m, buf.len() as u64) {
                self.vtable.on_max_buffer_overflow(m);
            }
        }

        if has_more == ReadState::Eof {
            self.flags.insert(WindowsFlags::RECEIVED_EOF);
        }

        if !self.vtable.is_streaming_enabled() {
            self.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
            return true;
        }
        // PORT_NOTES_PLAN R-2: `&mut self` carries LLVM `noalias`, but
        // `vtable.on_read_chunk` re-enters JS and user code can reach this
        // reader via a fresh `&mut WindowsBufferedReader` from the parent's
        // intrusive `reader` field, writing `self.flags` (e.g. via `pause` /
        // `start_reading`). Not currently ASM-cached (noalias-hunt SUSPECT),
        // but one inlining change away from caching `self.flags` across the
        // call so the trailing `.remove(HAS_INFLIGHT_READ)` RMWs the stale
        // pre-call value, clobbering any re-entrant flag change. Launder so
        // the post-call RMW reloads through an opaque pointer; mirrors the
        // cork fix at b818e70e1c57.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // SAFETY: `this` aliases the live `&mut self`; single JS thread. The
        // reader struct is an inline field of its parent (never freed
        // mid-call), so `*this` stays a valid place across re-entry.
        let result = unsafe { (*this).vtable.on_read_chunk(buf, has_more) };
        // Re-escape so the trailing RMW cannot reuse a spilled `self.flags`
        // from before `on_read_chunk`.
        core::hint::black_box(this);
        // Clear has_inflight_read after the callback completes so a new
        // read is not considered armed while we process this chunk
        // SAFETY: `this` is still live (see above).
        unsafe { (*this).flags.remove(WindowsFlags::HAS_INFLIGHT_READ) };
        result
    }

    fn finish(&mut self) {
        self.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
        self.flags.insert(WindowsFlags::IS_DONE);
        self._buffer.shrink_to_fit();
    }

    pub(crate) fn done(&mut self) {
        if let Some(source) = &self.source {
            debug_assert!(source.is_closed());
        }

        self.finish();

        self.vtable.on_reader_done();
    }

    pub fn on_error(&mut self, err: sys::Error) {
        self.finish();
        self.vtable.on_reader_error(err);
    }

    pub(crate) fn get_read_buffer_with_stable_memory_address(
        &mut self,
        suggested_size: usize,
    ) -> &mut [u8] {
        self.flags.insert(WindowsFlags::HAS_INFLIGHT_READ);
        self._buffer.reserve(suggested_size);
        // SAFETY: returning spare capacity for the read path to fill; len updated in on_read.
        unsafe { bun_core::vec::spare_bytes_mut(&mut self._buffer) }
    }

    pub fn start_with_current_pipe(&mut self) -> sys::Result<()> {
        debug_assert!(!self.source.as_ref().unwrap().is_closed());
        let self_ptr = core::ptr::from_mut(self).cast::<c_void>();
        self.source.as_mut().unwrap().set_data(self_ptr);
        self.buffer().clear();
        self.flags.remove(WindowsFlags::IS_DONE);
        self.start_reading()
    }

    /// Adopt a handle already attached to the engine (pair end, accepted or
    /// connected client) and start reading from it.
    #[cfg(windows)]
    pub fn start_with_pipe(&mut self, pipe: Box<bun_iocp::PipeHandle>) -> sys::Result<()> {
        self.source = Some(Source::Pipe(crate::source::PipeSource::from_engine(pipe)));
        self.start_with_current_pipe()
    }

    pub fn start(&mut self, fd: Fd, _: bool) -> sys::Result<()> {
        debug_assert!(self.source.is_none());
        // Use the event loop from the parent, not the global one
        // This is critical for spawnSync to use its isolated loop
        let loop_ = self.vtable.loop_();
        let mut source = Source::open(loop_, fd)?;
        source.set_data(core::ptr::from_mut(self).cast::<c_void>());
        self.source = Some(source);
        self.start_with_current_pipe()
    }

    pub fn start_file_offset(&mut self, fd: Fd, poll: bool, offset: usize) -> sys::Result<()> {
        self._offset = offset;
        self.flags.insert(WindowsFlags::USE_PREAD);
        self.start(fd, poll)
    }

    pub fn set_raw_mode(&mut self, value: bool) -> sys::Result<()> {
        let Some(source) = self.source.as_mut() else {
            return sys::Result::Err(sys::Error {
                errno: sys::E::BADF as _,
                syscall: sys::Tag::uv_tty_set_mode,
                ..Default::default()
            });
        };
        source.set_raw_mode(value)
    }

    /// Engine read callback for pipe sources. `err == SUCCESS` delivers
    /// `n >= 1` bytes in the source's pinned buffer (copied out here before
    /// the engine re-arms); a terminal code delivers exactly once and the
    /// engine has already stopped reading. `BROKEN_PIPE` is the raw EOF shape
    /// on pipes. // quirk: PIPE-37
    #[cfg(windows)]
    unsafe fn on_pipe_read(
        _lp: &mut bun_iocp::Loop,
        data: *mut c_void,
        buf: *mut u8,
        n: usize,
        err: Win32Error,
    ) {
        // SAFETY: `data` was set to `*mut Self` via `read_start`; the engine
        // invokes this on the event loop with no other Rust borrow of the
        // reader live (single-owner).
        let this = unsafe { bun_ptr::callback_ctx::<WindowsBufferedReader>(data) };
        bun_sys::syslog!(
            "onPipeRead(0x{:x}) = {}",
            core::ptr::from_mut(this) as usize,
            if err == Win32Error::SUCCESS {
                n as i64
            } else {
                -1
            }
        );
        if err == Win32Error::SUCCESS {
            debug_assert!(n > 0);
            this.deliver_copied_chunk(buf, n);
            return;
        }
        this.on_stream_terminal(err);
    }

    /// Engine read callback for tty sources. Raw mode delivers translated
    /// VT/WTF-8 bytes in the source's pinned buffer; cooked mode lends UTF-16
    /// units valid only for this call — both are copied/transcoded into
    /// `_buffer` before delivery (the WTF-8 conversion lives here, in the
    /// consumer layer). // quirk: TTY-27, TTY-31, TTY-35
    #[cfg(windows)]
    unsafe fn on_tty_read(
        _lp: &mut bun_iocp::Loop,
        data: *mut c_void,
        payload: bun_iocp::TtyReadData,
        err: Win32Error,
    ) {
        // SAFETY: see `on_pipe_read` — same single-owner contract.
        let this = unsafe { bun_ptr::callback_ctx::<WindowsBufferedReader>(data) };
        if err != Win32Error::SUCCESS {
            this.on_stream_terminal(err);
            return;
        }
        match payload {
            bun_iocp::TtyReadData::Bytes { ptr, len } => {
                debug_assert!(len > 0);
                this.deliver_copied_chunk(ptr, len);
            }
            bun_iocp::TtyReadData::Utf16 { ptr, len } => {
                debug_assert!(len > 0);
                // SAFETY: the engine lends `len` units for the duration of
                // this callback.
                let units = unsafe { core::slice::from_raw_parts(ptr, len) };
                // Worst case 3 WTF-8 bytes per unit (pairs cost 4 per 2).
                let dst = this.get_read_buffer_with_stable_memory_address(len * 3);
                let r = bun_core::strings::copy_wtf16_into_wtf8(dst, units);
                debug_assert_eq!(r.read as usize, len);
                let written = r.written as usize;
                let dst_ptr = dst.as_mut_ptr();
                // SAFETY: `written` bytes of `_buffer` spare capacity were
                // just initialized; re-slicing through the raw pointer ends
                // the `dst` borrow before `on_read` takes `&mut self`.
                let slice = unsafe { core::slice::from_raw_parts_mut(dst_ptr, written) };
                let _ = this.on_read(sys::Result::Ok(written), slice, ReadState::Progress);
            }
        }
    }

    /// Copy a chunk the engine delivered (from the source's pinned buffer)
    /// into `_buffer` spare capacity and run the shared delivery path.
    #[cfg(windows)]
    fn deliver_copied_chunk(&mut self, src: *const u8, n: usize) {
        let dst = self.get_read_buffer_with_stable_memory_address(n);
        debug_assert!(dst.len() >= n);
        let dst_ptr = dst.as_mut_ptr();
        // SAFETY: `src..src+n` is the engine-delivered region (valid for this
        // call); `dst` is freshly reserved spare capacity, so the regions are
        // disjoint. The raw re-slice ends the `dst` borrow before `on_read`.
        unsafe {
            core::ptr::copy_nonoverlapping(src, dst_ptr, n);
            let _ = self.on_read(
                sys::Result::Ok(n),
                core::slice::from_raw_parts_mut(dst_ptr, n),
                ReadState::Progress,
            );
        }
    }

    /// Shared terminal-delivery path for stream sources: the engine already
    /// stopped reading; mirror that, then deliver EOF or the error exactly
    /// once.
    #[cfg(windows)]
    fn on_stream_terminal(&mut self, err: Win32Error) {
        let _ = self.stop_reading();
        match win_error::classify_read(err) {
            win_error::ReadClass::Eof => {
                let _ = self.on_read(sys::Result::Ok(0), &mut [], ReadState::Eof);
            }
            win_error::ReadClass::Err(e) => {
                // `recv` tag: user-visible `error.syscall` for stream read
                // failures stays bit-identical with previous releases.
                let _ = self.on_read(
                    sys::Result::Err(sys::Error::from_code(e, sys::Tag::recv)),
                    &mut [],
                    ReadState::Progress,
                );
            }
        }
    }

    #[cfg(windows)]
    pub(crate) fn start_reading(&mut self) -> sys::Result<()> {
        if self.flags.contains(WindowsFlags::IS_DONE)
            || !self.flags.contains(WindowsFlags::IS_PAUSED)
        {
            return sys::Result::Ok(());
        }
        self.flags.remove(WindowsFlags::IS_PAUSED);
        let self_ptr = core::ptr::from_mut(self).cast::<c_void>();
        if self.source.is_none() {
            return sys::Result::Err(sys::Error::from_code(sys::E::BADF, sys::Tag::read));
        }
        if matches!(
            self.source,
            Some(Source::File(_)) | Some(Source::SyncFile(_))
        ) {
            // Files have no readiness: drain synchronously on the loop
            // thread, exactly like the POSIX `FileType::File` path.
            return self.read_file_loop();
        }
        let source = self.source.as_mut().expect("checked above");
        debug_assert!(!source.is_closed());

        // SAFETY: `self` (the callback ctx) outlives reading — the source is
        // stopped or closed before the reader can be freed.
        let rc = unsafe {
            match source {
                Source::Pipe(pipe) => pipe.read_start(Self::on_pipe_read, self_ptr),
                Source::Tty(tty) => Source::tty_mut(tty).read_start(Self::on_tty_read, self_ptr),
                Source::File(_) | Source::SyncFile(_) => unreachable!(),
            }
        };
        if rc != Win32Error::SUCCESS {
            self.flags.insert(WindowsFlags::IS_PAUSED);
            return sys::Result::Err(sys::Error::from_code(
                win_error::translate(rc),
                sys::Tag::open,
            ));
        }

        sys::Result::Ok(())
    }

    /// Synchronous file drain (the POSIX file shape): read chunks until EOF,
    /// error, pause or done. Chunk delivery re-enters JS, so all state is
    /// re-derived through a laundered pointer each iteration.
    #[cfg(windows)]
    fn read_file_loop(&mut self) -> sys::Result<()> {
        // R-2: `&mut self` carries LLVM `noalias`, but `on_read` re-enters JS
        // and user code can reach this reader through the parent's intrusive
        // field, writing `flags`/`_buffer`/`source`. Launder so every
        // iteration reloads through an opaque pointer.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        loop {
            // SAFETY: `this` aliases the live `&mut self`; single JS thread.
            // The reader is an inline field of its parent and is not freed by
            // chunk delivery (`BufferedReaderParent` contract).
            let r = unsafe { &mut *this };
            if r.flags
                .intersects(WindowsFlags::IS_DONE | WindowsFlags::IS_PAUSED)
            {
                return sys::Result::Ok(());
            }
            let Some(source) = r.source.as_ref() else {
                return sys::Result::Ok(());
            };
            let fd = match source {
                Source::File(f) | Source::SyncFile(f) => f.fd,
                _ => unreachable!("read_file_loop on a stream source"),
            };
            let use_pread = r.flags.contains(WindowsFlags::USE_PREAD);
            let offset = r._offset;

            let dst = r.get_read_buffer_with_stable_memory_address(64 * 1024);
            let dst_ptr = dst.as_mut_ptr();
            let dst_len = dst.len();
            // SAFETY: re-slice through the raw pointer so the spare-capacity
            // borrow does not overlap the `&mut self` taken by `on_read`
            // below. No reallocation happens between here and the commit
            // (`on_read` only commits + delivers).
            let buf = unsafe { core::slice::from_raw_parts_mut(dst_ptr, dst_len) };
            let result = if use_pread {
                sys::pread(fd, buf, i64::try_from(offset).expect("int cast"))
            } else {
                sys::read(fd, buf)
            };
            // SAFETY: fresh reborrow of the laundered pointer (see loop head).
            let r = unsafe { &mut *this };
            match result {
                sys::Result::Ok(0) => {
                    r.flags.insert(WindowsFlags::IS_PAUSED);
                    r.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
                    let _ = r.on_read(sys::Result::Ok(0), &mut [], ReadState::Eof);
                    return sys::Result::Ok(());
                }
                sys::Result::Ok(n) => {
                    r._offset += n;
                    // SAFETY: the syscall initialized `n` bytes at `dst_ptr`.
                    let slice = unsafe { core::slice::from_raw_parts_mut(dst_ptr, n) };
                    if !r.on_read(sys::Result::Ok(n), slice, ReadState::Progress) {
                        // Consumer asked to stop (POSIX `read_with_fn` honors
                        // this for files too): pause so the next
                        // `read()`/`unpause` resumes the drain.
                        // SAFETY: fresh reborrow — `on_read` re-entered JS.
                        let r = unsafe { &mut *this };
                        r.flags.insert(WindowsFlags::IS_PAUSED);
                        return sys::Result::Ok(());
                    }
                }
                sys::Result::Err(err) => {
                    r.flags.insert(WindowsFlags::IS_PAUSED);
                    r.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
                    let _ = r.on_read(sys::Result::Err(err), &mut [], ReadState::Progress);
                    return sys::Result::Ok(());
                }
            }
        }
    }

    pub fn stop_reading(&mut self) -> sys::Result<()> {
        if self.flags.contains(WindowsFlags::IS_DONE)
            || self.flags.contains(WindowsFlags::IS_PAUSED)
        {
            return sys::Result::Ok(());
        }
        self.flags.insert(WindowsFlags::IS_PAUSED);
        let Some(source) = self.source.as_mut() else {
            return sys::Result::Ok(());
        };
        match source {
            // File reads are synchronous; the IS_PAUSED flag set above stops
            // the drain loop between chunks.
            Source::File(_) | Source::SyncFile(_) => {}
            Source::Pipe(pipe) => pipe.read_stop(),
            Source::Tty(tty) => Source::tty_mut(tty).read_stop(),
        }
        sys::Result::Ok(())
    }

    pub fn close_impl<const CALL_DONE: bool>(&mut self) {
        if let Some(source) = self.source.take() {
            if matches!(source, Source::Pipe(_) | Source::Tty(_)) {
                self.flags.insert(WindowsFlags::IS_PAUSED);
            }
            // The engine handle (a private duplicate) always closes; the
            // originating fd is released through the table protocol when this
            // reader owns it (stdio fds are protected there).
            source.close(self.flags.contains(WindowsFlags::CLOSE_HANDLE));
            // self.source already None via take().
            if CALL_DONE {
                self.done();
            }
        }
    }

    /// Close the reader and call the done callback.
    pub fn close(&mut self) {
        let _ = self.stop_reading();
        self.close_impl::<true>();
    }

    /// Explicit teardown that does **not** fire `on_reader_done` (unlike
    /// [`close`]). Safe to call
    /// before Drop; both paths are idempotent over an already-taken source.
    pub fn deinit(&mut self) {
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        self._buffer = Vec::new();
        let Some(source) = self.source.take() else {
            return;
        };
        // `close_impl` performs the take + hand-off to the engine (the close
        // callback frees the wrapper allocation). A still-present source is
        // never mid-close (close paths always take it), so no leak gate is
        // needed; dead File sources just drop.
        if !source.is_closed() {
            self.source = Some(source);
            self.close_impl::<false>();
        }
    }

    /// Returns the consumer's `on_read_chunk` verdict: `false` = stop
    /// delivering (only the file drain loop acts on it; stream sources are
    /// paused explicitly by their consumers, as under libuv).
    pub(crate) fn on_read(
        &mut self,
        amount: sys::Result<usize>,
        slice: &mut [u8],
        has_more: ReadState,
    ) -> bool {
        if let sys::Result::Err(err) = amount {
            self.on_error(err);
            return false;
        }
        let amount_result = match amount {
            sys::Result::Ok(n) => n,
            sys::Result::Err(_) => unreachable!(),
        };

        #[cfg(debug_assertions)]
        {
            // Pointer-range check against `[ptr, ptr+capacity)` — can't form a
            // `&[u8]` over spare capacity (uninit), so do it on addresses.
            let base = self._buffer.as_ptr() as usize;
            let end = base + self._buffer.capacity();
            let s = slice.as_ptr() as usize;
            if !slice.is_empty() && !(s >= base && s + slice.len() <= end) {
                panic!("read chunk is not in buffer! This is a bug in bun. Please report it.");
            }
        }

        // move cursor foward
        // SAFETY: slice is inside _buffer's spare capacity with `amount_result` bytes initialized.
        unsafe { bun_core::vec::commit_spare(&mut self._buffer, amount_result) };

        let should_continue = self._on_read_chunk(slice, has_more);

        // Streaming parents (shell IOReader, subprocess) cannot re-derive
        // `&mut Self` from inside the vtable callback to restart the pipe
        // (Stacked-Borrows; see the comment in shell/IOReader.rs). The re-arm
        // is already handled by the file drain loop / the engine's re-arm,
        // but clearing the buffer here is load-bearing: without it `_buffer.len`
        // grows by `amount_result` every chunk and never resets, so a 1 GB
        // `cat` holds 1 GB resident instead of ~64 KB — and the leftover
        // bytes get re-delivered by `final_buffer`/`consume_reader_buffer`
        // at EOF. Clear even when the consumer returned false: the borrowed
        // `slice` contract ends when `on_read_chunk` returns (a deferred
        // `Temporary` view still reads valid capacity bytes — `clear()`
        // keeps the allocation and the paused drain commits nothing new
        // before it is consumed).
        if has_more != ReadState::Eof && self.vtable.is_streaming_enabled() {
            self._buffer.clear();
        }

        if has_more == ReadState::Eof {
            self.close();
        }
        should_continue
    }

    pub fn pause(&mut self) {
        let _ = self.stop_reading();
    }

    pub fn unpause(&mut self) {
        let _ = self.start_reading();
    }

    pub fn read(&mut self) {
        // we cannot sync read pipes on Windows so we just check if we are paused to resume the reading
        self.unpause();
    }
}

// Keep boolean state in the `WindowsFlags` bitflags field — no loose `bool`
// fields on `WindowsBufferedReader`.

#[cfg(windows)]
impl Drop for WindowsBufferedReader {
    fn drop(&mut self) {
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        // Do NOT let a live stream source drop in place: the engine handle
        // must go through close so its in-flight requests drain before the
        // wrapper (and its pinned read buffer) is freed in the close
        // callback. `close_impl` performs that hand-off.
        if let Some(source) = self.source.take() {
            if !source.is_closed() {
                self.source = Some(source);
                self.close_impl::<false>();
            }
        }
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
