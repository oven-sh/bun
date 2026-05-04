use core::ffi::c_void;
use core::mem;
use std::sync::Arc;

use bun_aio::{self as aio, FilePoll, Loop};
use bun_jsc::EventLoopHandle;
use bun_sys::{self as sys, Fd};

use crate::max_buf::MaxBuf;
use crate::pipes::{FileType, PollOrFd, ReadState};
use crate::source::Source;

#[cfg(windows)]
use bun_sys::windows::libuv as uv;

// ──────────────────────────────────────────────────────────────────────────
// BufferedReaderVTable
// ──────────────────────────────────────────────────────────────────────────

// This is a runtime type instead of comptime due to bugs in Zig.
// https://github.com/ziglang/zig/issues/18664
pub struct BufferedReaderVTable {
    pub parent: *mut c_void,
    pub fns: &'static BufferedReaderVTableFn,
}

/// Trait that parent types implement to receive buffered-reader callbacks.
/// Mirrors the duck-typed `Type.onReaderDone` / `Type.onReaderError` etc. in Zig.
pub trait BufferedReaderParent {
    /// Mirrors `@hasDecl(Type, "onReadChunk")`.
    const HAS_ON_READ_CHUNK: bool = true;

    fn on_read_chunk(&mut self, chunk: &[u8], has_more: ReadState) -> bool {
        let _ = (chunk, has_more);
        // Default: should not be called when HAS_ON_READ_CHUNK == false.
        true
    }
    fn on_reader_done(&mut self);
    fn on_reader_error(&mut self, err: sys::Error);
    fn loop_(&mut self) -> *mut Loop;
    fn event_loop(&mut self) -> EventLoopHandle;
}

impl BufferedReaderVTable {
    pub fn init<T: BufferedReaderParent>() -> BufferedReaderVTable {
        BufferedReaderVTable {
            parent: core::ptr::null_mut(),
            fns: BufferedReaderVTableFn::init::<T>(),
        }
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        (self.fns.event_loop)(self.parent)
    }

    pub fn loop_(&self) -> *mut Loop {
        (self.fns.loop_)(self.parent)
    }

    pub fn is_streaming_enabled(&self) -> bool {
        self.fns.on_read_chunk.is_some()
    }

    /// When the reader has read a chunk of data
    /// and hasMore is true, it means that there might be more data to read.
    ///
    /// Returning false prevents the reader from reading more data.
    pub fn on_read_chunk(&self, chunk: &[u8], has_more: ReadState) -> bool {
        (self.fns.on_read_chunk.unwrap())(self.parent, chunk, has_more)
    }

    pub fn on_reader_done(&self) {
        (self.fns.on_reader_done)(self.parent)
    }

    pub fn on_reader_error(&self, err: sys::Error) {
        (self.fns.on_reader_error)(self.parent, err)
    }
}

pub struct BufferedReaderVTableFn {
    pub on_read_chunk: Option<fn(*mut c_void, &[u8], ReadState) -> bool>,
    pub on_reader_done: fn(*mut c_void),
    pub on_reader_error: fn(*mut c_void, sys::Error),
    pub loop_: fn(*mut c_void) -> *mut Loop,
    pub event_loop: fn(*mut c_void) -> EventLoopHandle,
}

impl BufferedReaderVTableFn {
    pub fn init<T: BufferedReaderParent>() -> &'static BufferedReaderVTableFn {
        fn on_read_chunk<T: BufferedReaderParent>(
            this: *mut c_void,
            chunk: &[u8],
            has_more: ReadState,
        ) -> bool {
            // SAFETY: parent was set via set_parent with a *mut T.
            unsafe { &mut *(this as *mut T) }.on_read_chunk(chunk, has_more)
        }
        fn on_reader_done<T: BufferedReaderParent>(this: *mut c_void) {
            // SAFETY: parent was set via set_parent with a *mut T.
            unsafe { &mut *(this as *mut T) }.on_reader_done()
        }
        fn on_reader_error<T: BufferedReaderParent>(this: *mut c_void, err: sys::Error) {
            // SAFETY: parent was set via set_parent with a *mut T.
            unsafe { &mut *(this as *mut T) }.on_reader_error(err)
        }
        fn event_loop<T: BufferedReaderParent>(this: *mut c_void) -> EventLoopHandle {
            // SAFETY: parent was set via set_parent with a *mut T.
            EventLoopHandle::init(unsafe { &mut *(this as *mut T) }.event_loop())
        }
        fn loop_<T: BufferedReaderParent>(this: *mut c_void) -> *mut Loop {
            // SAFETY: parent was set via set_parent with a *mut T.
            unsafe { &mut *(this as *mut T) }.loop_()
        }

        // TODO(port): Zig used `comptime &BufferedReaderVTable.Fn{...}` (static rodata).
        // In Rust we need a `static` per monomorphization; `Box::leak` is a Phase-A
        // placeholder — Phase B should use a `static` in a generic helper or `OnceLock`.
        // PERF(port): was comptime static; profile in Phase B.
        Box::leak(Box::new(BufferedReaderVTableFn {
            on_read_chunk: if T::HAS_ON_READ_CHUNK {
                Some(on_read_chunk::<T>)
            } else {
                None
            },
            on_reader_done: on_reader_done::<T>,
            on_reader_error: on_reader_error::<T>,
            event_loop: event_loop::<T>,
            loop_: loop_::<T>,
        }))
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
    pub maxbuf: Option<Arc<MaxBuf>>,
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
    /// Zig default: `.{ .close_handle = true }`
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
        let fns = self.vtable.fns;
        *self = PosixBufferedReader {
            handle: mem::replace(&mut other.handle, PollOrFd::Closed),
            _buffer: mem::take(other.buffer()),
            _offset: other._offset,
            flags: other.flags,
            vtable: BufferedReaderVTable { fns, parent },
            count: 0,
            maxbuf: None,
        };
        // PORT NOTE: `other.buffer().* = init(default_allocator)` and
        // `other.handle = .closed` handled by mem::replace/mem::take above.
        other.flags.insert(PosixFlags::IS_DONE);
        other._offset = 0;
        MaxBuf::transfer_to_pipereader(&mut other.maxbuf, &mut self.maxbuf);
        self.handle.set_owner(self as *mut _ as *mut c_void);

        // note: the caller is supposed to drain the buffer themselves
        // doing it here automatically makes it very easy to end up reading from the same buffer multiple times.
    }

    pub fn set_parent(&mut self, parent: *mut c_void) {
        self.vtable.parent = parent;
        self.handle.set_owner(self as *mut _ as *mut c_void);
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

    fn close_without_reporting(&mut self) {
        if self.get_fd() != Fd::INVALID {
            debug_assert!(!self.flags.contains(PosixFlags::CLOSED_WITHOUT_REPORTING));
            self.flags.insert(PosixFlags::CLOSED_WITHOUT_REPORTING);
            if self.flags.contains(PosixFlags::CLOSE_HANDLE) {
                self.handle.close(Some(self as *mut _ as *mut c_void), ());
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
                let _ = poll.unregister(self.vtable.loop_(), false);
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
                // PORT NOTE: defer self.handle.close(null, {}) — runs after the read.
                let result = sys::File { handle: fd }
                    .read_to_end_with_array_list(&mut self._buffer, sys::SizeHint::UnknownSize)
                    .unwrap();
                self.handle.close(None, ());
                if let Err(err) = result {
                    bun_core::Output::debug_warn!("error reading from memfd\n{}", err);
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
            // TODO(port): PollOrFd::close takes (owner_ptr, on_close_fn) — verify signature in Phase B.
            self.handle
                .close(Some(self as *mut _ as *mut c_void), Self::done);
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

    pub fn register_poll(&mut self) {
        // PORT NOTE: reshaped for borrowck — hoist vtable-derived scalars and
        // normalize self.handle to Poll before taking the single &mut borrow,
        // so no raw-pointer escape is needed.
        let ev = self.vtable.event_loop();
        let lp = self.vtable.loop_();
        let owner_ptr = self as *mut _ as *mut c_void;

        if let PollOrFd::Fd(fd) = self.handle {
            if !self.flags.contains(PosixFlags::POLLABLE) {
                return;
            }
            self.handle = PollOrFd::Poll(FilePoll::init(
                ev,
                fd,
                Default::default(),
                // TODO(port): FilePoll::init type-erased owner (@This(), this).
                owner_ptr,
            ));
        }
        let Some(poll) = self.handle.get_poll_mut() else {
            return;
        };
        poll.owner.set(owner_ptr);

        if !poll.flags.contains(aio::FilePollFlags::WAS_EVER_REGISTERED) {
            poll.enable_keeping_process_alive(ev);
        }

        match poll.register_with_fd(lp, aio::PollKind::Readable, aio::PollMode::Dispatch, poll.fd) {
            sys::Result::Err(err) => {
                self.vtable.on_reader_error(err);
            }
            sys::Result::Ok(()) => {}
        }
    }

    pub fn start(&mut self, fd: Fd, is_pollable: bool) -> sys::Result<()> {
        if !is_pollable {
            self.buffer().clear();
            self.flags.remove(PosixFlags::IS_DONE);
            self.handle.close(None, ());
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
            FileType::Pipe => match aio::is_readable(fd) {
                aio::Readable::Ready => {
                    Self::read_from_blocking_pipe_without_blocking(self, fd, 0, false);
                }
                aio::Readable::Hup => {
                    Self::read_from_blocking_pipe_without_blocking(self, fd, 0, true);
                }
                aio::Readable::NotReady => {
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

    // PORT NOTE: reshaped for borrowck — takes &vtable instead of &mut Self so
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

    fn wrap_read_fn(
        func: fn(Fd, &mut [u8]) -> sys::Result<usize>,
    ) -> impl Fn(Fd, &mut [u8], usize) -> sys::Result<usize> {
        move |fd, buf, _offset| func(fd, buf)
    }

    fn read_file(parent: &mut PosixBufferedReader, fd: Fd, size_hint: isize, received_hup: bool) {
        fn pread_fn(fd1: Fd, buf: &mut [u8], offset: usize) -> sys::Result<usize> {
            sys::pread(fd1, buf, i64::try_from(offset).unwrap())
        }
        if parent.flags.contains(PosixFlags::USE_PREAD) {
            Self::read_with_fn::<{ FileType::File }>(parent, fd, size_hint, received_hup, pread_fn);
        } else {
            Self::read_with_fn::<{ FileType::File }>(
                parent,
                fd,
                size_hint,
                received_hup,
                |fd, buf, _| sys::read(fd, buf),
            );
        }
    }

    fn read_socket(parent: &mut PosixBufferedReader, fd: Fd, size_hint: isize, received_hup: bool) {
        Self::read_with_fn::<{ FileType::Socket }>(parent, fd, size_hint, received_hup, |fd, buf, _| {
            sys::recv_non_block(fd, buf)
        });
    }

    fn read_pipe(parent: &mut PosixBufferedReader, fd: Fd, size_hint: isize, received_hup: bool) {
        Self::read_with_fn::<{ FileType::NonblockingPipe }>(
            parent,
            fd,
            size_hint,
            received_hup,
            |fd, buf, _| sys::read_nonblocking(fd, buf),
        );
    }

    // PORT NOTE: reshaped for borrowck — `resizable_buffer` is no longer passed
    // separately; functions access `parent._buffer` directly. In Zig the buffer
    // pointer was always `parent.buffer()` anyway.
    fn read_blocking_pipe(
        parent: &mut PosixBufferedReader,
        fd: Fd,
        _size_hint: isize,
        received_hup_initially: bool,
    ) {
        let mut received_hup = received_hup_initially;
        loop {
            let streaming = parent.vtable.is_streaming_enabled();
            let mut got_retry = false;

            if parent._buffer.capacity() == 0 {
                // Use stack buffer for streaming
                let stack_buffer = parent.vtable.event_loop().pipe_read_buffer();

                match sys::read_nonblocking(fd, stack_buffer) {
                    sys::Result::Ok(bytes_read) => {
                        if let Some(l) = &parent.maxbuf {
                            l.on_read_bytes(bytes_read);
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
                            parent._buffer.extend_from_slice(&stack_buffer[..bytes_read]);
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
                    // SAFETY: spare_capacity_mut yields MaybeUninit<u8>; sys::read_nonblocking
                    // writes only initialized bytes into the prefix it reports.
                    let buf = unsafe { spare_capacity_as_slice(&mut parent._buffer) };
                    let buf_len = buf.len();
                    match sys::read_nonblocking(fd, buf) {
                        sys::Result::Ok(bytes_read) => {
                            if let Some(l) = &parent.maxbuf {
                                l.on_read_bytes(bytes_read);
                            }
                            parent._offset += bytes_read;
                            // SAFETY: bytes_read bytes were just initialized by the syscall.
                            unsafe {
                                parent._buffer.set_len(parent._buffer.len() + bytes_read);
                            }

                            if bytes_read == 0 {
                                parent.close_without_reporting();
                                if !parent.flags.contains(PosixFlags::IS_DONE) {
                                    parent.done();
                                }
                                return;
                            }

                            if streaming {
                                // PORT NOTE: reshaped for borrowck — re-slice from _buffer.
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
            match aio::is_readable(fd) {
                aio::Readable::Hup => {
                    // Still hung up; keep draining towards EOF.
                }
                aio::Readable::Ready => {
                    // Data is available but HUP cleared — a writer came back.
                    // Drop the stale HUP so the next iteration takes the
                    // normal registerPoll() exit once the data is drained.
                    received_hup = false;
                }
                aio::Readable::NotReady => {
                    // No data and no HUP: a writer exists. Go back to the
                    // event loop instead of blocking in read().
                    parent.register_poll();
                    return;
                }
            }
        }
    }

    // PERF(port): `file_type` and `sys_fn` were comptime in Zig (monomorphization).
    // `FILE_TYPE` is a const generic; `sys_fn` is passed as a closure — profile in Phase B.
    fn read_with_fn<const FILE_TYPE: FileType>(
        parent: &mut PosixBufferedReader,
        fd: Fd,
        _size_hint: isize,
        received_hup: bool,
        sys_fn: impl Fn(Fd, &mut [u8], usize) -> sys::Result<usize>,
    ) {
        let streaming = parent.vtable.is_streaming_enabled();

        if streaming {
            let stack_buffer = parent.vtable.event_loop().pipe_read_buffer();
            let stack_buffer_len = stack_buffer.len();
            while parent._buffer.capacity() == 0 {
                let stack_buffer_cutoff = stack_buffer_len / 2;
                let mut head_start = 0usize; // index into stack_buffer where the unwritten head begins
                while stack_buffer_len - head_start > 16 * 1024 {
                    let buf = &mut stack_buffer[head_start..];

                    match sys_fn(fd, buf, parent._offset) {
                        sys::Result::Ok(bytes_read) => {
                            if let Some(l) = &parent.maxbuf {
                                l.on_read_bytes(bytes_read);
                            }
                            parent._offset += bytes_read;
                            head_start += bytes_read;

                            if bytes_read == 0 {
                                parent.close_without_reporting();
                                if head_start > 0 {
                                    let _ = parent
                                        .vtable
                                        .on_read_chunk(&stack_buffer[..head_start], ReadState::Eof);
                                }
                                if !parent.flags.contains(PosixFlags::IS_DONE) {
                                    parent.done();
                                }
                                return;
                            }

                            // Keep reading as much as we can
                            if (stack_buffer_len - head_start) < stack_buffer_cutoff {
                                if !parent.vtable.on_read_chunk(
                                    &stack_buffer[..head_start],
                                    if received_hup {
                                        ReadState::Eof
                                    } else {
                                        ReadState::Progress
                                    },
                                ) {
                                    return;
                                }
                                head_start = 0;
                            }
                        }
                        sys::Result::Err(err) => {
                            if err.is_retry() {
                                if FILE_TYPE == FileType::File {
                                    bun_core::Output::debug_warn!(
                                        "Received EAGAIN while reading from a file. This is a bug."
                                    );
                                } else {
                                    parent.register_poll();
                                }

                                if head_start > 0 {
                                    let _ = parent.vtable.on_read_chunk(
                                        &stack_buffer[..head_start],
                                        ReadState::Drained,
                                    );
                                }
                                return;
                            }

                            if head_start > 0 {
                                let _ = parent.vtable.on_read_chunk(
                                    &stack_buffer[..head_start],
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
                        &stack_buffer[..head_start],
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
            let stack_buffer = parent.vtable.event_loop().pipe_read_buffer();

            // Unlike the block of code following this one, only handle the non-streaming case.
            debug_assert!(!streaming);

            match sys_fn(fd, stack_buffer, 0) {
                sys::Result::Ok(bytes_read) => {
                    if bytes_read > 0 {
                        parent._buffer.extend_from_slice(&stack_buffer[..bytes_read]);
                    }
                    if let Some(l) = &parent.maxbuf {
                        l.on_read_bytes(bytes_read);
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
                        if FILE_TYPE == FileType::File {
                            bun_core::Output::debug_warn!(
                                "Received EAGAIN while reading from a file. This is a bug."
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
            // SAFETY: writing into spare capacity; set_len after syscall reports bytes written.
            let buf = unsafe { spare_capacity_as_slice(&mut parent._buffer) };

            match sys_fn(fd, buf, parent._offset) {
                sys::Result::Ok(bytes_read) => {
                    if let Some(l) = &parent.maxbuf {
                        l.on_read_bytes(bytes_read);
                    }
                    parent._offset += bytes_read;
                    // SAFETY: bytes_read bytes initialized by sys_fn.
                    unsafe {
                        parent._buffer.set_len(parent._buffer.len() + bytes_read);
                    }

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
                            // PORT NOTE: `defer resizable_buffer.clearRetainingCapacity()` inlined below.
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
                        if FILE_TYPE == FileType::File {
                            bun_core::Output::debug_warn!(
                                "Received EAGAIN while reading from a file. This is a bug."
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

    // PORT NOTE: `comptime { bun.meta.banFieldType(@This(), bool); }` dropped —
    // bitflags! ensures bools are packed.
}

impl Drop for PosixBufferedReader {
    fn drop(&mut self) {
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        // _buffer freed by Vec Drop.
        self.close_without_reporting();
    }
}

// SAFETY helper: view Vec spare capacity as &mut [u8] for syscall reads.
#[inline]
unsafe fn spare_capacity_as_slice(v: &mut Vec<u8>) -> &mut [u8] {
    let len = v.len();
    let cap = v.capacity();
    // SAFETY: caller promises to only treat the prefix the syscall wrote as initialized.
    core::slice::from_raw_parts_mut(v.as_mut_ptr().add(len), cap - len)
}

// ──────────────────────────────────────────────────────────────────────────
// WindowsBufferedReader
// ──────────────────────────────────────────────────────────────────────────

pub struct WindowsBufferedReaderVTable {
    pub on_reader_done: fn(*mut c_void),
    pub on_reader_error: fn(*mut c_void, sys::Error),
    pub on_read_chunk: Option<fn(*mut c_void, &[u8], ReadState) -> bool>,
    pub loop_: fn(*mut c_void) -> *mut Loop,
}

pub struct WindowsBufferedReader {
    /// The pointer to this pipe must be stable.
    /// It cannot change because we don't know what libuv will do with it.
    pub source: Option<Source>,
    pub _offset: usize,
    pub _buffer: Vec<u8>,
    // for compatibility with Linux
    pub flags: WindowsFlags,
    pub maxbuf: Option<Arc<MaxBuf>>,

    pub parent: *mut c_void,
    pub vtable: WindowsBufferedReaderVTable,
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
        /// When true, wait for the file operation callback before calling done().
        /// Used to ensure proper cleanup ordering when closing during cancellation.
        const DEFER_DONE_CALLBACK      = 1 << 9;
    }
}

impl WindowsFlags {
    /// Zig default: `.{ .close_handle = true, .is_paused = true }`
    pub const fn new() -> Self {
        Self::from_bits_truncate(WindowsFlags::CLOSE_HANDLE.bits() | WindowsFlags::IS_PAUSED.bits())
    }
}

impl WindowsBufferedReader {
    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self._buffer.capacity()
    }

    pub fn init<T: BufferedReaderParent>() -> WindowsBufferedReader {
        fn on_read_chunk<T: BufferedReaderParent>(
            this: *mut c_void,
            chunk: &[u8],
            has_more: ReadState,
        ) -> bool {
            // SAFETY: parent set via set_parent with *mut T.
            unsafe { &mut *(this as *mut T) }.on_read_chunk(chunk, has_more)
        }
        fn on_reader_done<T: BufferedReaderParent>(this: *mut c_void) {
            // SAFETY: parent set via set_parent with *mut T.
            unsafe { &mut *(this as *mut T) }.on_reader_done()
        }
        fn on_reader_error<T: BufferedReaderParent>(this: *mut c_void, err: sys::Error) {
            // SAFETY: parent set via set_parent with *mut T.
            unsafe { &mut *(this as *mut T) }.on_reader_error(err)
        }
        fn loop_<T: BufferedReaderParent>(this: *mut c_void) -> *mut Loop {
            // SAFETY: parent set via set_parent with *mut T.
            unsafe { &mut *(this as *mut T) }.loop_()
        }

        WindowsBufferedReader {
            source: None,
            _offset: 0,
            _buffer: Vec::new(),
            flags: WindowsFlags::new(),
            maxbuf: None,
            parent: core::ptr::null_mut(),
            vtable: WindowsBufferedReaderVTable {
                on_read_chunk: if T::HAS_ON_READ_CHUNK {
                    Some(on_read_chunk::<T>)
                } else {
                    None
                },
                on_reader_done: on_reader_done::<T>,
                on_reader_error: on_reader_error::<T>,
                loop_: loop_::<T>,
            },
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
        // PORT NOTE: keep self.vtable; move other's state in.
        self.flags = other.flags;
        self._buffer = mem::take(other.buffer());
        self._offset = other._offset;
        self.source = other.source.take();

        other.flags.insert(WindowsFlags::IS_DONE);
        other._offset = 0;
        // other._buffer / other.source already cleared by mem::take above.
        MaxBuf::transfer_to_pipereader(&mut other.maxbuf, &mut self.maxbuf);
        self.set_parent(parent);
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
        if !self.flags.contains(WindowsFlags::IS_DONE) {
            if let Some(source) = &self.source {
                source.set_data(self as *mut _ as *mut c_void);
            }
        }
    }

    pub fn update_ref(&mut self, value: bool) {
        if let Some(source) = &self.source {
            if value {
                source.ref_();
            } else {
                source.unref();
            }
        }
    }

    pub fn enable_keeping_process_alive<C>(&mut self, _: C) {
        self.update_ref(true);
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
        if self.flags.contains(WindowsFlags::HAS_INFLIGHT_READ) {
            return true;
        }
        let Some(source) = &self.source else {
            return false;
        };
        match source {
            Source::File(file) | Source::SyncFile(file) => file.state != crate::source::FileState::Deinitialized,
            _ => false,
        }
    }

    fn _on_read_chunk(&mut self, buf: &[u8], has_more: ReadState) -> bool {
        if let Some(m) = &self.maxbuf {
            m.on_read_bytes(buf.len());
        }

        if has_more == ReadState::Eof {
            self.flags.insert(WindowsFlags::RECEIVED_EOF);
        }

        let Some(on_read_chunk_fn) = self.vtable.on_read_chunk else {
            self.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
            return true;
        };
        let result = on_read_chunk_fn(self.parent, buf, has_more);
        // Clear has_inflight_read after the callback completes to prevent
        // libuv from starting a new read while we're still processing data
        self.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
        result
    }

    fn finish(&mut self) {
        self.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
        self.flags.insert(WindowsFlags::IS_DONE);
        self._buffer.shrink_to_fit();
    }

    pub fn done(&mut self) {
        if let Some(source) = &self.source {
            debug_assert!(source.is_closed());
        }

        self.finish();

        (self.vtable.on_reader_done)(self.parent);
    }

    pub fn on_error(&mut self, err: sys::Error) {
        self.finish();
        (self.vtable.on_reader_error)(self.parent, err);
    }

    pub fn get_read_buffer_with_stable_memory_address(&mut self, suggested_size: usize) -> &mut [u8] {
        self.flags.insert(WindowsFlags::HAS_INFLIGHT_READ);
        self._buffer.reserve(suggested_size);
        // SAFETY: returning spare capacity for libuv to write into; len updated in on_read.
        unsafe { spare_capacity_as_slice(&mut self._buffer) }
    }

    pub fn start_with_current_pipe(&mut self) -> sys::Result<()> {
        debug_assert!(!self.source.as_ref().unwrap().is_closed());
        self.source
            .as_ref()
            .unwrap()
            .set_data(self as *mut _ as *mut c_void);
        self.buffer().clear();
        self.flags.remove(WindowsFlags::IS_DONE);
        self.start_reading()
    }

    #[cfg(windows)]
    pub fn start_with_pipe(&mut self, pipe: *mut uv::Pipe) -> sys::Result<()> {
        self.source = Some(Source::Pipe(pipe));
        self.start_with_current_pipe()
    }

    pub fn start(&mut self, fd: Fd, _: bool) -> sys::Result<()> {
        debug_assert!(self.source.is_none());
        // Use the event loop from the parent, not the global one
        // This is critical for spawnSync to use its isolated loop
        let loop_ = (self.vtable.loop_)(self.parent);
        let source = match Source::open(loop_, fd) {
            sys::Result::Err(err) => return sys::Result::Err(err),
            sys::Result::Ok(source) => source,
        };
        source.set_data(self as *mut _ as *mut c_void);
        self.source = Some(source);
        self.start_with_current_pipe()
    }

    pub fn start_file_offset(&mut self, fd: Fd, poll: bool, offset: usize) -> sys::Result<()> {
        self._offset = offset;
        self.flags.insert(WindowsFlags::USE_PREAD);
        self.start(fd, poll)
    }

    pub fn set_raw_mode(&mut self, value: bool) -> sys::Result<()> {
        let Some(source) = &self.source else {
            return sys::Result::Err(sys::Error {
                errno: sys::E::BADF as _,
                syscall: sys::Syscall::UvTtySetMode,
                ..Default::default()
            });
        };
        source.set_raw_mode(value)
    }

    #[cfg(windows)]
    extern "C" fn on_stream_alloc(
        handle: *mut uv::Handle,
        suggested_size: usize,
        buf: *mut uv::uv_buf_t,
    ) {
        // SAFETY: handle.data was set to *mut WindowsBufferedReader in set_data.
        let this = unsafe { &mut *((*handle).data as *mut WindowsBufferedReader) };
        let result = this.get_read_buffer_with_stable_memory_address(suggested_size);
        // SAFETY: buf is a valid out-pointer from libuv.
        unsafe {
            *buf = uv::uv_buf_t::init(result);
        }
    }

    #[cfg(windows)]
    extern "C" fn on_stream_read(
        handle: *mut uv::uv_handle_t,
        nread: uv::ReturnCodeI64,
        buf: *const uv::uv_buf_t,
    ) {
        // SAFETY: handle is a uv_stream_t*; data points at WindowsBufferedReader.
        let stream = handle as *mut uv::uv_stream_t;
        let this = unsafe { &mut *((*stream).data as *mut WindowsBufferedReader) };

        let nread_int = nread.int();

        bun_sys::syslog!("onStreamRead(0x{}) = {}", this as *mut _ as usize, nread_int);

        // NOTE: pipes/tty need to call stopReading on errors (yeah)
        match nread_int {
            0 => {
                // EAGAIN or EWOULDBLOCK or canceled  (buf is not safe to access here)
                // With libuv 1.51.0+, calling onRead(.drained) here causes a race condition
                // where subsequent reads return truncated data (see logs showing 6024 instead
                // of 74468 bytes). Just ignore 0-byte reads and let libuv continue.
                return;
            }
            uv::UV_EOF => {
                let _ = this.stop_reading();
                // EOF (buf is not safe to access here)
                return this.on_read(sys::Result::Ok(0), &mut [], ReadState::Eof);
            }
            _ => {
                if let Some(err) = nread.to_error(sys::Syscall::Recv) {
                    let _ = this.stop_reading();
                    // ERROR (buf is not safe to access here)
                    this.on_read(sys::Result::Err(err), &mut [], ReadState::Progress);
                    return;
                }
                // we got some data we can slice the buffer!
                let len: usize = usize::try_from(nread_int).unwrap();
                // SAFETY: buf is valid when nread > 0.
                let slice = unsafe { (*buf).slice_mut() };
                this.on_read(sys::Result::Ok(len), &mut slice[..len], ReadState::Progress);
            }
        }
    }

    /// Callback fired when a file read operation completes or is canceled.
    /// Handles cleanup, cancellation, and normal read processing.
    #[cfg(windows)]
    extern "C" fn on_file_read(fs: *mut uv::fs_t) {
        // SAFETY: fs is a valid uv_fs_t from libuv.
        let fs_ref = unsafe { &mut *fs };
        let file = crate::source::File::from_fs(fs_ref);
        let result = fs_ref.result;
        let nread_int = result.int();
        let was_canceled = nread_int == uv::UV_ECANCELED;

        bun_sys::syslog!(
            "onFileRead({}) = {}",
            Fd::from_uv(fs_ref.file.fd),
            nread_int
        );

        // Get parent before completing (fs.data may be null if detached)
        let parent_ptr = fs_ref.data;

        // ALWAYS complete the read first (cleans up fs_t, updates state)
        file.complete(was_canceled);

        // If detached, file should be closing itself now
        if parent_ptr.is_null() {
            debug_assert!(file.state == crate::source::FileState::Closing); // complete should have started close
            return;
        }

        // SAFETY: parent_ptr is *mut WindowsBufferedReader set via set_data.
        let this: &mut WindowsBufferedReader =
            unsafe { &mut *(parent_ptr as *mut WindowsBufferedReader) };

        // Mark no longer in flight
        this.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);

        // If canceled, check if we need to call deferred done
        if was_canceled {
            if this.flags.contains(WindowsFlags::DEFER_DONE_CALLBACK) {
                this.flags.remove(WindowsFlags::DEFER_DONE_CALLBACK);
                // Now safe to call done - buffer will be freed by deinit
                this.close_impl::<true>();
            } else {
                this.buffer().clear();
            }
            return;
        }

        if this.flags.contains(WindowsFlags::IS_DONE) {
            return;
        }

        match nread_int {
            // 0 actually means EOF too
            0 | uv::UV_EOF => {
                this.flags.insert(WindowsFlags::IS_PAUSED);
                this.on_read(sys::Result::Ok(0), &mut [], ReadState::Eof);
            }
            // UV_ECANCELED needs to be on the top so we avoid UAF
            uv::UV_ECANCELED => unreachable!(),
            _ => {
                if let Some(err) = result.to_error(sys::Syscall::Read) {
                    this.flags.insert(WindowsFlags::IS_PAUSED);
                    this.on_read(sys::Result::Err(err), &mut [], ReadState::Progress);
                    return;
                }

                // PORT NOTE: defer block inlined after body — see below.
                let len: usize = usize::try_from(nread_int).unwrap();
                this._offset += len;
                // we got some data lets get the current iov
                let mut handled = false;
                if let Some(source) = &this.source {
                    if let Source::File(file_ptr) = source {
                        let buf = file_ptr.iov.slice_mut();
                        this.on_read(sys::Result::Ok(len), &mut buf[..len], ReadState::Progress);
                        handled = true;
                    }
                }
                if !handled {
                    // ops we should not hit this lets fail with EPIPE
                    debug_assert!(false);
                    this.on_read(
                        sys::Result::Err(sys::Error::from_code(sys::E::PIPE, sys::Syscall::Read)),
                        &mut [],
                        ReadState::Progress,
                    );
                }

                // PORT NOTE: this is the Zig `defer { ... }` body, inlined after the body
                // because both body paths fall through (void return).
                // if we are not paused we keep reading until EOF or err
                if !this.flags.contains(WindowsFlags::IS_PAUSED) {
                    if let Some(source) = &this.source {
                        if let Source::File(file_ptr) = source {
                            // Can only start if file is in deinitialized state
                            if file_ptr.can_start() {
                                source.set_data(this as *mut _ as *mut c_void);
                                file_ptr.prepare();
                                let buf =
                                    this.get_read_buffer_with_stable_memory_address(64 * 1024);
                                file_ptr.iov = uv::uv_buf_t::init(buf);
                                this.flags.insert(WindowsFlags::HAS_INFLIGHT_READ);

                                let offset = if this.flags.contains(WindowsFlags::USE_PREAD) {
                                    i64::try_from(this._offset).unwrap()
                                } else {
                                    -1
                                };
                                if let Some(err) = uv::uv_fs_read(
                                    (this.vtable.loop_)(this.parent),
                                    &mut file_ptr.fs,
                                    file_ptr.file,
                                    &mut file_ptr.iov as *mut _ as *mut _,
                                    1,
                                    offset,
                                    Self::on_file_read,
                                )
                                .to_error(sys::Syscall::Write)
                                {
                                    file_ptr.complete(false);
                                    this.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
                                    this.flags.insert(WindowsFlags::IS_PAUSED);
                                    // we should inform the error if we are unable to keep reading
                                    this.on_read(
                                        sys::Result::Err(err),
                                        &mut [],
                                        ReadState::Progress,
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    pub fn start_reading(&mut self) -> sys::Result<()> {
        if self.flags.contains(WindowsFlags::IS_DONE)
            || !self.flags.contains(WindowsFlags::IS_PAUSED)
        {
            return sys::Result::Ok(());
        }
        self.flags.remove(WindowsFlags::IS_PAUSED);
        let Some(source) = &self.source else {
            return sys::Result::Err(sys::Error::from_code(sys::E::BADF, sys::Syscall::Read));
        };
        debug_assert!(!source.is_closed());

        match source {
            Source::File(file) => {
                // If already reading, just set data and unpause
                if !file.can_start() {
                    source.set_data(self as *mut _ as *mut c_void);
                    return sys::Result::Ok(());
                }

                // Start new read - set data before prepare
                source.set_data(self as *mut _ as *mut c_void);
                file.prepare();
                let buf = self.get_read_buffer_with_stable_memory_address(64 * 1024);
                file.iov = uv::uv_buf_t::init(buf);
                self.flags.insert(WindowsFlags::HAS_INFLIGHT_READ);

                let offset = if self.flags.contains(WindowsFlags::USE_PREAD) {
                    i64::try_from(self._offset).unwrap()
                } else {
                    -1
                };
                if let Some(err) = uv::uv_fs_read(
                    (self.vtable.loop_)(self.parent),
                    &mut file.fs,
                    file.file,
                    &mut file.iov as *mut _ as *mut _,
                    1,
                    offset,
                    Self::on_file_read,
                )
                .to_error(sys::Syscall::Write)
                {
                    file.complete(false);
                    self.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
                    return sys::Result::Err(err);
                }
            }
            _ => {
                if let Some(err) = uv::uv_read_start(
                    source.to_stream(),
                    Self::on_stream_alloc,
                    Self::on_stream_read,
                )
                .to_error(sys::Syscall::Open)
                {
                    bun_sys::windows::libuv::log!("uv_read_start() = {}", err.name());
                    return sys::Result::Err(err);
                }
            }
        }

        sys::Result::Ok(())
    }

    #[cfg(not(windows))]
    pub fn start_reading(&mut self) -> sys::Result<()> {
        // TODO(port): Windows-only path; stubbed on non-Windows so the type still compiles.
        sys::Result::Ok(())
    }

    pub fn stop_reading(&mut self) -> sys::Result<()> {
        if self.flags.contains(WindowsFlags::IS_DONE)
            || self.flags.contains(WindowsFlags::IS_PAUSED)
        {
            return sys::Result::Ok(());
        }
        self.flags.insert(WindowsFlags::IS_PAUSED);
        let Some(source) = &self.source else {
            return sys::Result::Ok(());
        };
        match source {
            Source::File(file) => {
                file.stop();
            }
            _ => {
                source.to_stream().read_stop();
            }
        }
        sys::Result::Ok(())
    }

    pub fn close_impl<const CALL_DONE: bool>(&mut self) {
        if let Some(source) = self.source.take() {
            match source {
                Source::SyncFile(file) | Source::File(file) => {
                    // Detach - file will close itself after operation completes
                    file.detach();
                }
                #[cfg(windows)]
                Source::Pipe(pipe) => {
                    // SAFETY: pipe is a live uv::Pipe*.
                    unsafe {
                        (*pipe).data = pipe as *mut c_void;
                    }
                    self.flags.insert(WindowsFlags::IS_PAUSED);
                    // SAFETY: pipe is valid; on_pipe_close frees it.
                    unsafe { (*pipe).close(Self::on_pipe_close) };
                }
                #[cfg(windows)]
                Source::Tty(tty) => {
                    if crate::source::StdinTTY::is_stdin_tty(tty) {
                        // Node only ever closes stdin on process exit.
                    } else {
                        // SAFETY: tty is a live uv_tty_t*.
                        unsafe {
                            (*tty).data = tty as *mut c_void;
                            (*tty).close(Self::on_tty_close);
                        }
                    }

                    self.flags.insert(WindowsFlags::IS_PAUSED);
                }
                #[cfg(not(windows))]
                _ => {
                    // TODO(port): Pipe/Tty arms are Windows-only.
                }
            }
            // self.source already None via take().
            if CALL_DONE {
                self.done();
            }
        }
    }

    /// Close the reader and call the done callback.
    /// If a file operation is in progress, defers the done callback until
    /// the operation completes to ensure proper cleanup ordering.
    pub fn close(&mut self) {
        let _ = self.stop_reading();

        // Check if we have a pending file operation
        if let Some(source) = &self.source {
            if matches!(source, Source::File(_) | Source::SyncFile(_)) {
                let file = source.file();
                // Defer done if operation is in progress (whether cancel succeeded or failed)
                if file.state == crate::source::FileState::Canceling
                    || file.state == crate::source::FileState::Operating
                {
                    self.flags.insert(WindowsFlags::DEFER_DONE_CALLBACK);
                    return; // Don't call closeImpl yet - wait for operation callback
                }
            }
        }

        self.close_impl::<true>();
    }

    #[cfg(windows)]
    extern "C" fn on_pipe_close(handle: *mut uv::Pipe) {
        // SAFETY: handle.data was set to the pipe itself before close.
        let this = unsafe { (*handle).data as *mut uv::Pipe };
        // SAFETY: pipe was Box-allocated; reclaim and drop.
        drop(unsafe { Box::from_raw(this) });
    }

    #[cfg(windows)]
    extern "C" fn on_tty_close(handle: *mut uv::uv_tty_t) {
        // SAFETY: handle.data was set to the tty itself before close.
        let this = unsafe { (*handle).data as *mut uv::uv_tty_t };
        // SAFETY: tty was Box-allocated; reclaim and drop.
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn on_read(&mut self, amount: sys::Result<usize>, slice: &mut [u8], has_more: ReadState) {
        if let sys::Result::Err(err) = amount {
            self.on_error(err);
            return;
        }
        let amount_result = match amount {
            sys::Result::Ok(n) => n,
            sys::Result::Err(_) => unreachable!(),
        };

        #[cfg(debug_assertions)]
        {
            if !slice.is_empty()
                && !bun_core::is_slice_in_buffer(slice, self._buffer.as_ptr(), self._buffer.capacity())
            {
                panic!("uv_read_cb: buf is not in buffer! This is a bug in bun. Please report it.");
            }
        }

        // move cursor foward
        // SAFETY: slice is inside _buffer's spare capacity; libuv wrote `amount_result` bytes.
        unsafe {
            self._buffer.set_len(self._buffer.len() + amount_result);
        }

        let _ = self._on_read_chunk(slice, has_more);

        if has_more == ReadState::Eof {
            self.close();
        }
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

    // PORT NOTE: `comptime { bun.meta.banFieldType(WindowsBufferedReader, bool); }` dropped —
    // bitflags! ensures bools are packed.
}

impl Drop for WindowsBufferedReader {
    fn drop(&mut self) {
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        // _buffer freed by Vec Drop.
        let Some(source) = self.source.take() else {
            return;
        };
        if !source.is_closed() {
            // closeImpl will take care of freeing the source
            // TODO(port): Zig sets source=null before closeImpl, making it a no-op —
            // verify intent in Phase B (likely a latent Zig bug).
            self.close_impl::<false>();
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/io/PipeReader.zig (1313 lines)
//   confidence: medium
//   todos:      6
//   notes:      vtable init uses Box::leak (Phase B: per-T static); read fns reshaped for borrowck (resizable_buffer folded into &mut self, drain_chunk takes &vtable); register_poll hoists vtable scalars to avoid raw-ptr escape; FileType const-generic needs ConstParamTy in pipes.rs; PollOrFd::close/FilePoll::init signatures guessed; on_file_read defer-block inlined after body; Windows Drop mirrors Zig's source=null-before-closeImpl no-op (verify intent); Windows Source variants need #[cfg] alignment with source.rs.
// ──────────────────────────────────────────────────────────────────────────
