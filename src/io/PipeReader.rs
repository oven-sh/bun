use core::ffi::c_void;
use core::mem;
use core::ptr::NonNull;
#[cfg(windows)]
use std::sync::Arc;

use bun_sys::{self as sys, Fd};

use crate::{EventLoopHandle, FilePollRef, Owner, FilePollFlag, FilePollKind};
use bun_install_types::reader::{
    InstallBufferedReaderDelivery, InstallBufferedReaderTarget, InstallReaderError,
};
use bun_io_types::file_poll;
use bun_io_types::reader::BufferedReaderHandle;
// `bun.Async.Loop` — on POSIX the uws `us_loop_t`, on Windows the embedded
// `uv_loop_t` (`bun_io::Loop` is the cfg-aliased nominal that picks the
// right one). Typed reader targets carry the event-loop context needed to
// hand it to libuv/uws without a cross-crate cast.
//
// Public so trait implementors in `bun_runtime` can name the same type in
// their `loop_` signature without duplicating the cfg-split.
#[cfg(not(windows))]
pub type Loop = bun_uws_sys::Loop;
#[cfg(windows)]
pub type Loop = bun_sys::windows::libuv::Loop;

/// `bun_io::poll_tag::BUFFERED_READER` — every `FilePoll` allocated by this
/// module stores a `*mut BufferedReader` (erased) as its owner; the per-tag
/// dispatch in `bun_runtime::dispatch::__bun_run_file_poll` recovers the type
/// from this constant. T2 cannot name `bun_io`, so the value is mirrored.

use crate::max_buf::MaxBuf;
use crate::pipes::{FileType, PollOrFd, ReadState};
#[cfg(windows)]
use crate::source::Source;
use bun_runtime_types::reader::{
    RuntimeBufferedReaderDelivery, RuntimeBufferedReaderTarget, RuntimeReaderError,
};

#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(windows)]
// `close`/`set_data`/`is_closed` are default trait methods; bring traits into
// scope so method resolution finds them on `Pipe`/`uv_tty_t`/`fs_t`.
use bun_sys::windows::libuv::{UvHandle as _, UvReq as _, UvStream as _};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;

// PipeReader.zig declares no `Output.scoped(.PipeReader, …)` scope; all logging
// goes through `bun.sys.syslog` (the `SYS` scope) or `libuv::log!`.

unsafe extern "Rust" {
    fn __bun_dispatch_install_buffered_reader_delivery(
        delivery: InstallBufferedReaderDelivery,
        event_loop: EventLoopHandle,
        context: *mut c_void,
    );
    fn __bun_dispatch_runtime_buffered_reader_delivery(
        delivery: RuntimeBufferedReaderDelivery<'_>,
        context: *mut c_void,
    ) -> bool;
}

// ──────────────────────────────────────────────────────────────────────────
// BufferedReaderVTable
// ──────────────────────────────────────────────────────────────────────────

// This is a runtime type instead of comptime due to bugs in Zig.
// https://github.com/ziglang/zig/issues/18664
pub struct BufferedReaderVTable {
    pub target: Option<BufferedReaderTarget>,
}

#[derive(Clone, Copy)]
pub enum BufferedReaderTarget {
    Install {
        target: InstallBufferedReaderTarget,
        event_loop: EventLoopHandle,
    },
    Runtime {
        target: RuntimeBufferedReaderTarget,
        event_loop: EventLoopHandle,
    },
}

impl BufferedReaderTarget {
    #[inline]
    fn event_loop(self) -> EventLoopHandle {
        match self {
            Self::Install { event_loop, .. } => event_loop,
            Self::Runtime { event_loop, .. } => event_loop,
        }
    }

    #[inline]
    fn loop_ptr(self) -> *mut Loop {
        match self {
            Self::Install { event_loop, .. } => {
                #[cfg(not(windows))]
                { event_loop.loop_().cast() }
                #[cfg(windows)]
                // SAFETY: Windows uws loop wrapper stores the live uv loop.
                unsafe { (*event_loop.loop_()).uv_loop }
            }
            Self::Runtime { event_loop, .. } => {
                #[cfg(not(windows))]
                { event_loop.loop_().cast() }
                #[cfg(windows)]
                // SAFETY: Windows uws loop wrapper stores the live uv loop.
                unsafe { (*event_loop.loop_()).uv_loop }
            }
        }
    }

    #[inline]
    fn has_on_read_chunk(self) -> bool {
        match self {
            Self::Install { target, .. } => target.has_on_read_chunk(),
            Self::Runtime { target, .. } => target.has_on_read_chunk(),
        }
    }

    #[inline]
    fn on_read_chunk(
        self,
        reader: BufferedReaderHandle,
        chunk: &[u8],
        _has_more: ReadState,
    ) -> bool {
        match self {
            Self::Install { target, event_loop } => {
                target.on_read_chunk(chunk);
                true
            }
            Self::Runtime { target, event_loop } => {
                let delivery = target.on_read_chunk(reader, chunk, _has_more);
                // SAFETY: `delivery` carries borrowed data valid for this
                // synchronous call only; the high-tier dispatcher must consume
                // it before returning.
                unsafe {
                    __bun_dispatch_runtime_buffered_reader_delivery(
                        delivery,
                        event_loop.current_context(),
                    )
                }
            }
        }
    }

    #[inline]
    fn on_reader_done(self, reader: BufferedReaderHandle) {
        match self {
            Self::Install { target, event_loop } => {
                if let Some(delivery) = target.on_reader_done() {
                    unsafe {
                        __bun_dispatch_install_buffered_reader_delivery(
                            delivery,
                            event_loop,
                            event_loop.current_context(),
                        );
                    }
                }
            }
            Self::Runtime { target, event_loop } => {
                if let Some(delivery) = target.on_reader_done(reader) {
                    // SAFETY: done delivery carries no borrowed bytes and is
                    // consumed synchronously by the high-tier dispatcher.
                    unsafe {
                        let _ = __bun_dispatch_runtime_buffered_reader_delivery(
                            delivery,
                            event_loop.current_context(),
                        );
                    }
                }
            }
        }
    }

    #[inline]
    fn on_reader_error(self, reader: BufferedReaderHandle, err: sys::Error) {
        match self {
            Self::Install { target, event_loop } => {
                if matches!(target, InstallBufferedReaderTarget::SecurityScanIpc { .. }) {
                    bun_core::Output::err_generic(
                        "Failed to read security scanner IPC: {}",
                        (&err,),
                    );
                }
                if let Some(delivery) = target.on_reader_error(InstallReaderError {
                    errno: err.errno,
                    name: <&'static str>::from(err.get_errno()),
                }) {
                    unsafe {
                        __bun_dispatch_install_buffered_reader_delivery(
                            delivery,
                            event_loop,
                            event_loop.current_context(),
                        );
                    }
                }
            }
            Self::Runtime { target, event_loop } => {
                let delivery = if target.uses_system_reader_error() {
                    target.on_system_reader_error(reader, err)
                } else {
                    target.on_reader_error(
                        RuntimeReaderError {
                            errno: err.errno,
                            name: <&'static str>::from(err.get_errno()),
                        },
                        reader,
                    )
                };
                if let Some(delivery) = delivery {
                    // SAFETY: error delivery carries no borrowed bytes and is
                    // consumed synchronously by the high-tier dispatcher.
                    unsafe {
                        let _ = __bun_dispatch_runtime_buffered_reader_delivery(
                            delivery,
                            event_loop.current_context(),
                        );
                    }
                }
            }
        }
    }

    #[inline]
    fn on_max_buffer_overflow(self, _maxbuf: NonNull<MaxBuf>) {
        match self {
            Self::Install { .. } => {}
            Self::Runtime { target, event_loop } => {
                if let Some(delivery) = target.on_max_buffer_overflow() {
                    // SAFETY: max-buffer delivery carries no borrowed bytes and is
                    // consumed synchronously by the high-tier dispatcher.
                    unsafe {
                        let _ = __bun_dispatch_runtime_buffered_reader_delivery(
                            delivery,
                            event_loop.current_context(),
                        );
                    }
                }
            }
        }
    }
}

impl BufferedReaderVTable {
    pub fn detached() -> BufferedReaderVTable {
        BufferedReaderVTable { target: None }
    }

    pub fn target(target: BufferedReaderTarget) -> BufferedReaderVTable {
        BufferedReaderVTable { target: Some(target) }
    }

    #[inline]
    fn typed_target(&self) -> BufferedReaderTarget {
        self.target.expect("BufferedReader has no typed target")
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        self.typed_target().event_loop()
    }

    pub fn loop_(&self) -> *mut Loop {
        self.typed_target().loop_ptr()
    }

    pub fn is_streaming_enabled(&self) -> bool {
        self.target.map(|target| target.has_on_read_chunk()).unwrap_or(false)
    }

    /// When the reader has read a chunk of data
    /// and hasMore is true, it means that there might be more data to read.
    ///
    /// Returning false prevents the reader from reading more data.
    pub fn on_read_chunk(
        &self,
        reader: BufferedReaderHandle,
        chunk: &[u8],
        has_more: ReadState,
    ) -> bool {
        self.typed_target().on_read_chunk(reader, chunk, has_more)
    }

    pub fn on_reader_done(&self, reader: BufferedReaderHandle) {
        self.typed_target().on_reader_done(reader);
    }

    pub fn on_reader_error(&self, reader: BufferedReaderHandle, err: sys::Error) {
        self.typed_target().on_reader_error(reader, err);
    }

    pub fn on_max_buffer_overflow(&self, maxbuf: NonNull<MaxBuf>) {
        if let Some(target) = self.target {
            target.on_max_buffer_overflow(maxbuf);
        }
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
    // PORT NOTE: MaxBuf uses hand-rolled dual-ownership (Subprocess + reader) via
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
    /// Zig default: `.{ .close_handle = true }`
    pub const fn new() -> Self {
        PosixFlags::CLOSE_HANDLE
    }
}

impl PosixBufferedReader {
    pub fn init_detached() -> PosixBufferedReader {
        PosixBufferedReader {
            handle: PollOrFd::Closed,
            _buffer: Vec::new(),
            _offset: 0,
            vtable: BufferedReaderVTable::detached(),
            flags: PosixFlags::new(),
            count: 0,
            maxbuf: None,
        }
    }

    pub fn init_target(target: BufferedReaderTarget) -> PosixBufferedReader {
        let mut reader = Self::init_detached();
        reader.set_target(target);
        reader
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

    pub fn from(&mut self, other: &mut PosixBufferedReader, target: BufferedReaderTarget) {
        *self = PosixBufferedReader {
            handle: mem::replace(&mut other.handle, PollOrFd::Closed),
            _buffer: mem::take(other.buffer()),
            _offset: other._offset,
            flags: other.flags,
            vtable: BufferedReaderVTable::target(target),
            count: 0,
            maxbuf: None,
        };
        // PORT NOTE: `other.buffer().* = init(default_allocator)` and
        // `other.handle = .closed` handled by mem::replace/mem::take above.
        other.flags.insert(PosixFlags::IS_DONE);
        other._offset = 0;
        MaxBuf::transfer_to_pipereader(&mut other.maxbuf, &mut self.maxbuf);
        let reader = BufferedReaderHandle::from_ptr(std::ptr::from_mut(self))
            .expect("BufferedReader self pointer is non-null");
        self.handle.set_owner(Owner::BufferedReader(reader));

        // note: the caller is supposed to drain the buffer themselves
        // doing it here automatically makes it very easy to end up reading from the same buffer multiple times.
    }

    pub fn set_target(&mut self, target: BufferedReaderTarget) {
        self.vtable.target = Some(target);
        let reader = BufferedReaderHandle::from_ptr(std::ptr::from_mut(self))
            .expect("BufferedReader self pointer is non-null");
        self.handle.set_owner(Owner::BufferedReader(reader));
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
    /// [`close`]). Mirrors Zig `PosixBufferedReader.deinit`. Safe to call
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

    #[inline]
    fn reader_handle(&mut self) -> BufferedReaderHandle {
        BufferedReaderHandle::from_ptr(std::ptr::from_mut(self))
            .expect("BufferedReader self pointer is non-null")
    }

    pub fn final_buffer(&mut self) -> &mut Vec<u8> {
        if self.flags.contains(PosixFlags::MEMFD) {
            if let PollOrFd::Fd(fd) = self.handle {
                // PORT NOTE: Zig `defer this.handle.close(null, {})` — close after
                // the read regardless of result.
                let result = sys::File { handle: fd }
                    .read_to_end_with_array_list(&mut self._buffer, sys::SizeHint::UnknownSize);
                self.handle.close(None, None::<fn(*mut c_void)>);
                if let Err(err) = result {
                    // TODO(b2-blocked): bun_core::debug_warn — macro form is
                    // broken (concat! into $fmt:literal); use the fn for now.
                    bun_core::output::debug_warn(&format_args!("error reading from memfd\n{}", err));
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
                Some(|ctx: *mut c_void| unsafe {
                    (*ctx.cast::<PosixBufferedReader>()).done()
                }),
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
        let reader = BufferedReaderHandle::from_ptr(std::ptr::from_mut(self))
            .expect("BufferedReader self pointer is non-null");
        self.vtable.on_reader_done(reader);
    }

    pub fn on_error(&mut self, err: sys::Error) {
        let reader = BufferedReaderHandle::from_ptr(std::ptr::from_mut(self))
            .expect("BufferedReader self pointer is non-null");
        self.vtable.on_reader_error(reader, err);
    }

    pub fn register_poll(&mut self) {
        // PORT NOTE: reshaped for borrowck — hoist vtable-derived scalars and
        // normalize self.handle to Poll before taking the single &mut borrow,
        // so no raw-pointer escape is needed.
        let ev = self.vtable.event_loop();
        let lp = self.vtable.loop_();
        let reader = BufferedReaderHandle::from_ptr(std::ptr::from_mut(self))
            .expect("BufferedReader self pointer is non-null");

        if let PollOrFd::Fd(fd) = self.handle {
            if !self.flags.contains(PosixFlags::POLLABLE) {
                return;
            }
            self.handle = PollOrFd::Poll(FilePollRef::init(ev, fd, Owner::BufferedReader(reader)));
        }
        let Some(poll) = self.handle.get_poll_mut() else {
            return;
        };
        poll.set_owner(Owner::BufferedReader(reader));

        if !poll.has_flag(FilePollFlag::WasEverRegistered) {
            poll.enable_keeping_process_alive(ev);
        }

        match poll.register_with_fd(lp.cast(), FilePollKind::Readable, poll.fd()) {
            sys::Result::Err(err) => {
                let reader = BufferedReaderHandle::from_ptr(std::ptr::from_mut(self))
                    .expect("BufferedReader self pointer is non-null");
                self.vtable.on_reader_error(reader, err);
            }
            sys::Result::Ok(()) => {}
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

    // PORT NOTE: reshaped for borrowck — takes &vtable instead of &mut Self so
    // call sites can pass &parent._buffer alongside without a raw-pointer escape.
    #[inline]
    fn drain_chunk(
        vtable: &BufferedReaderVTable,
        reader: BufferedReaderHandle,
        chunk: &[u8],
        has_more: ReadState,
    ) -> bool {
        if vtable.is_streaming_enabled() {
            if !chunk.is_empty() {
                return vtable.on_read_chunk(reader, chunk, has_more);
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
            sys::pread(fd1, buf, i64::try_from(offset).expect("int cast"))
        }
        if parent.flags.contains(PosixFlags::USE_PREAD) {
            Self::read_with_fn(parent, FileType::File, fd, size_hint, received_hup, pread_fn);
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
        Self::read_with_fn(parent, FileType::Socket, fd, size_hint, received_hup, |fd, buf, _| {
            sys::recv_non_block(fd, buf)
        });
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
        let reader = parent.reader_handle();
        loop {
            let streaming = parent.vtable.is_streaming_enabled();
            let mut got_retry = false;

            if parent._buffer.capacity() == 0 {
                // Use stack buffer for streaming
                // SAFETY: per-loop scratch buffer; single-threaded event loop,
                // sole live `&mut` for the read below.
                let stack_buffer = unsafe { &mut *parent.vtable.event_loop().pipe_read_buffer() };

                match sys::read_nonblocking(fd, stack_buffer) {
                    sys::Result::Ok(bytes_read) => {
                        if let Some(l) = parent.maxbuf {
                            // SAFETY: live until `remove_from_pipereader`.
                            if unsafe { MaxBuf::on_read_bytes(l, bytes_read as u64) } {
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
                                reader,
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
                            if let Some(l) = parent.maxbuf {
                                // SAFETY: live until `remove_from_pipereader`.
                                if unsafe { MaxBuf::on_read_bytes(l, bytes_read as u64) } {
                                    parent.vtable.on_max_buffer_overflow(l);
                                }
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
                                    reader,
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

    // PERF(port): `file_type` and `sys_fn` were comptime in Zig (monomorphization).
    // adt_const_params is unstable, so `file_type` is a runtime arg; `sys_fn` is
    // generic so it still monomorphizes — profile in Phase B.
    fn read_with_fn(
        parent: &mut PosixBufferedReader,
        file_type: FileType,
        fd: Fd,
        _size_hint: isize,
        received_hup: bool,
        sys_fn: impl Fn(Fd, &mut [u8], usize) -> sys::Result<usize>,
    ) {
        let streaming = parent.vtable.is_streaming_enabled();
        let reader = parent.reader_handle();

        if streaming {
            // SAFETY: per-loop scratch buffer; single-threaded event loop,
            // sole live `&mut` for the read below.
            let stack_buffer = unsafe { &mut *parent.vtable.event_loop().pipe_read_buffer() };
            let stack_buffer_len = stack_buffer.len();
            while parent._buffer.capacity() == 0 {
                let stack_buffer_cutoff = stack_buffer_len / 2;
                let mut head_start = 0usize; // index into stack_buffer where the unwritten head begins
                while stack_buffer_len - head_start > 16 * 1024 {
                    let buf = &mut stack_buffer[head_start..];

                    match sys_fn(fd, buf, parent._offset) {
                        sys::Result::Ok(bytes_read) => {
                            if let Some(l) = parent.maxbuf {
                                // SAFETY: live until `remove_from_pipereader`.
                                if unsafe { MaxBuf::on_read_bytes(l, bytes_read as u64) } {
                                    parent.vtable.on_max_buffer_overflow(l);
                                }
                            }
                            parent._offset += bytes_read;
                            head_start += bytes_read;

                            if bytes_read == 0 {
                                parent.close_without_reporting();
                                if head_start > 0 {
                                    let _ = parent.vtable.on_read_chunk(
                                        reader,
                                        &stack_buffer[..head_start],
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
                                // PORT NOTE: `&& !received_hup` mirrors the
                                // after-inner-loop flush below (line ~855).
                                // Without it, a peer close (HUP) with >cutoff
                                // bytes still buffered makes a parent that
                                // returns `false` on `.eof` (e.g. shell
                                // `PipeReader::on_read_chunk`) early-return
                                // here with data left in the kernel and no
                                // `register_poll`/`done()` → 90s hang in
                                // shell-blocking-pipe.test.ts. The Zig spec
                                // has the same asymmetry (PipeReader.zig:605)
                                // but the Rust port hits the timing window
                                // far more often; once HUP is set the kernel
                                // returns the remaining bytes then 0, so
                                // draining to `bytes_read == 0` is bounded.
                                if !parent.vtable.on_read_chunk(
                                    reader,
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
                                head_start = 0;
                            }
                        }
                        sys::Result::Err(err) => {
                            if err.is_retry() {
                                if file_type == FileType::File {
                                    bun_core::output::debug_warn("Received EAGAIN while reading from a file. This is a bug.");
                                } else {
                                    parent.register_poll();
                                }

                                if head_start > 0 {
                                    let _ = parent.vtable.on_read_chunk(
                                        reader,
                                        &stack_buffer[..head_start],
                                        ReadState::Drained,
                                    );
                                }
                                return;
                            }

                            if head_start > 0 {
                                let _ = parent.vtable.on_read_chunk(
                                    reader,
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
                        reader,
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
            // SAFETY: per-loop scratch buffer; single-threaded event loop,
            // sole live `&mut` for the read below.
            let stack_buffer = unsafe { &mut *parent.vtable.event_loop().pipe_read_buffer() };

            // Unlike the block of code following this one, only handle the non-streaming case.
            debug_assert!(!streaming);

            match sys_fn(fd, stack_buffer, 0) {
                sys::Result::Ok(bytes_read) => {
                    if bytes_read > 0 {
                        parent._buffer.extend_from_slice(&stack_buffer[..bytes_read]);
                    }
                    if let Some(l) = parent.maxbuf {
                        // SAFETY: live until `remove_from_pipereader`; see MaxBuf ownership note.
                        if unsafe { MaxBuf::on_read_bytes(l, bytes_read as u64) } {
                            parent.vtable.on_max_buffer_overflow(l);
                        }
                    }
                    parent._offset += bytes_read;

                    if bytes_read == 0 {
                        parent.close_without_reporting();
                        let _ = Self::drain_chunk(
                            &parent.vtable,
                            reader,
                            &parent._buffer,
                            ReadState::Eof,
                        );
                        if !parent.flags.contains(PosixFlags::IS_DONE) {
                            parent.done();
                        }
                        return;
                    }
                }
                sys::Result::Err(err) => {
                    if err.is_retry() {
                        if file_type == FileType::File {
                            bun_core::output::debug_warn("Received EAGAIN while reading from a file. This is a bug.");
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
                    if let Some(l) = parent.maxbuf {
                        // SAFETY: live until `remove_from_pipereader`; see MaxBuf ownership note.
                        if unsafe { MaxBuf::on_read_bytes(l, bytes_read as u64) } {
                            parent.vtable.on_max_buffer_overflow(l);
                        }
                    }
                    parent._offset += bytes_read;
                    // SAFETY: bytes_read bytes initialized by sys_fn.
                    unsafe {
                        parent._buffer.set_len(parent._buffer.len() + bytes_read);
                    }

                    if bytes_read == 0 {
                        parent.close_without_reporting();
                        let _ = Self::drain_chunk(
                            &parent.vtable,
                            reader,
                            &parent._buffer,
                            ReadState::Eof,
                        );
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
                                .on_read_chunk(reader, &parent._buffer, ReadState::Progress);
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
                                .on_read_chunk(reader, &parent._buffer, ReadState::Drained);
                            parent._buffer.clear();
                        }
                    }

                    if err.is_retry() {
                        if file_type == FileType::File {
                            bun_core::output::debug_warn("Received EAGAIN while reading from a file. This is a bug.");
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

#[cfg(windows)]
pub struct WindowsBufferedReader {
    /// The pointer to this pipe must be stable.
    /// It cannot change because we don't know what libuv will do with it.
    pub source: Option<Source>,
    pub _offset: usize,
    pub _buffer: Vec<u8>,
    // for compatibility with Linux
    pub flags: WindowsFlags,
    pub maxbuf: Option<NonNull<MaxBuf>>,

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

#[cfg(windows)]
impl WindowsBufferedReader {
    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self._buffer.capacity()
    }

    pub fn init_detached() -> WindowsBufferedReader {
        WindowsBufferedReader {
            source: None,
            _offset: 0,
            _buffer: Vec::new(),
            flags: WindowsFlags::new(),
            maxbuf: None,
            vtable: BufferedReaderVTable::detached(),
        }
    }

    pub fn init_target(target: BufferedReaderTarget) -> WindowsBufferedReader {
        let mut reader = Self::init_detached();
        reader.set_target(target);
        reader
    }

    #[inline]
    pub fn is_done(&self) -> bool {
        self.flags.intersects(
            WindowsFlags::IS_DONE
                | WindowsFlags::RECEIVED_EOF
                | WindowsFlags::CLOSED_WITHOUT_REPORTING,
        )
    }

    pub fn from(&mut self, other: &mut WindowsBufferedReader, target: BufferedReaderTarget) {
        debug_assert!(other.source.is_some() && self.source.is_none());
        // PORT NOTE: keep self.vtable; move other's state in.
        self.flags = other.flags;
        self._buffer = mem::take(other.buffer());
        self._offset = other._offset;
        self.source = other.source.take();

        other.flags.insert(WindowsFlags::IS_DONE);
        other._offset = 0;
        // other._buffer / other.source already cleared by mem::take above.
        // Zig spec (PipeReader.zig:825-831) re-inits `to.*` with a struct literal,
        // which resets every unlisted field — including `maxbuf` — to its default
        // (`null`) BEFORE `transferToPipereader`. The field-by-field assigns above
        // leave `self.maxbuf` untouched, so drop any prior owner-count first to
        // avoid leaking a MaxBuf ref when the destination already held one.
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        MaxBuf::transfer_to_pipereader(&mut other.maxbuf, &mut self.maxbuf);
        self.set_target(target);
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

    pub fn set_target(&mut self, target: BufferedReaderTarget) {
        self.vtable.target = Some(target);
        if !self.flags.contains(WindowsFlags::IS_DONE) {
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

    #[inline]
    fn reader_handle(&mut self) -> BufferedReaderHandle {
        BufferedReaderHandle::from_ptr(std::ptr::from_mut(self))
            .expect("BufferedReader self pointer is non-null")
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
        if let Some(m) = self.maxbuf {
            // SAFETY: MaxBuf intrusive ownership; ptr live while in pipereader.
            if unsafe { MaxBuf::on_read_bytes(m, buf.len() as u64) } {
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
        let reader = self.reader_handle();
        let result = self.vtable.on_read_chunk(reader, buf, has_more);
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

        let reader = BufferedReaderHandle::from_ptr(std::ptr::from_mut(self))
            .expect("BufferedReader self pointer is non-null");
        self.vtable.on_reader_done(reader);
    }

    pub fn on_error(&mut self, err: sys::Error) {
        self.finish();
        let reader = BufferedReaderHandle::from_ptr(std::ptr::from_mut(self))
            .expect("BufferedReader self pointer is non-null");
        self.vtable.on_reader_error(reader, err);
    }

    pub fn get_read_buffer_with_stable_memory_address(&mut self, suggested_size: usize) -> &mut [u8] {
        self.flags.insert(WindowsFlags::HAS_INFLIGHT_READ);
        self._buffer.reserve(suggested_size);
        // SAFETY: returning spare capacity for libuv to write into; len updated in on_read.
        unsafe { spare_capacity_as_slice(&mut self._buffer) }
    }

    pub fn start_with_current_pipe(&mut self) -> sys::Result<()> {
        debug_assert!(!self.source.as_ref().unwrap().is_closed());
        let self_ptr = core::ptr::from_mut(self).cast::<c_void>();
        self.source.as_mut().unwrap().set_data(self_ptr);
        self.buffer().clear();
        self.flags.remove(WindowsFlags::IS_DONE);
        self.start_reading()
    }

    /// SAFETY: `pipe` must be a `Box<uv::Pipe>`-allocated pointer; ownership
    /// transfers to `self.source` (later freed via `close_and_destroy`).
    #[cfg(windows)]
    pub unsafe fn start_with_pipe(&mut self, pipe: *mut uv::Pipe) -> sys::Result<()> {
        // SAFETY: caller contract — Box-allocated, ownership transfers.
        self.source = Some(Source::Pipe(unsafe { bun_core::heap::take(pipe) }));
        self.start_with_current_pipe()
    }

    pub fn start(&mut self, fd: Fd, _: bool) -> sys::Result<()> {
        debug_assert!(self.source.is_none());
        // Use the event loop from the parent, not the global one
        // This is critical for spawnSync to use its isolated loop
        let loop_ = self.vtable.loop_();
        let mut source = match Source::open(loop_.cast(), fd) {
            sys::Result::Err(err) => return sys::Result::Err(err),
            sys::Result::Ok(source) => source,
        };
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

    #[cfg(windows)]
    extern "C" fn on_stream_alloc(
        handle: *mut uv::Handle,
        suggested_size: usize,
        buf: *mut uv::uv_buf_t,
    ) {
        // SAFETY: libuv alloc_cb — `handle.data` was set to `*mut Self` in
        // `set_data`/`start_with_current_pipe`. libuv invokes this from the
        // event loop with no other Rust borrow of the reader live, so this is
        // the sole `&mut` to the allocation (single-owner).
        let this = unsafe { bun_ptr::callback_ctx::<WindowsBufferedReader>((*handle).data) };
        let result = this.get_read_buffer_with_stable_memory_address(suggested_size);
        // SAFETY: buf is a valid out-pointer from libuv.
        unsafe {
            *buf = uv::uv_buf_t::init(result);
        }
    }

    #[cfg(windows)]
    extern "C" fn on_stream_read(
        stream: *mut uv::uv_stream_t,
        nread: uv::ReturnCodeI64,
        buf: *const uv::uv_buf_t,
    ) {
        // SAFETY: libuv read_cb — `stream.data` was set to `*mut Self` in
        // `set_data`. Invoked from the event loop with no other Rust borrow of
        // the reader live (single-owner).
        let this = unsafe { bun_ptr::callback_ctx::<WindowsBufferedReader>((*stream).data) };

        let nread_int = nread.int();

        bun_sys::syslog!("onStreamRead(0x{}) = {}", core::ptr::from_mut(this) as usize, nread_int);

        // NOTE: pipes/tty need to call stopReading on errors (yeah)
        match nread_int {
            0 => {
                // EAGAIN or EWOULDBLOCK or canceled  (buf is not safe to access here)
                // With libuv 1.51.0+, calling onRead(.drained) here causes a race condition
                // where subsequent reads return truncated data (see logs showing 6024 instead
                // of 74468 bytes). Just ignore 0-byte reads and let libuv continue.
                return;
            }
            v if v == uv::UV_EOF as i64 => {
                let _ = this.stop_reading();
                // EOF (buf is not safe to access here)
                return this.on_read(sys::Result::Ok(0), &mut [], ReadState::Eof);
            }
            _ => {
                if let Some(err) = nread.to_error(sys::Tag::recv) {
                    let _ = this.stop_reading();
                    // ERROR (buf is not safe to access here)
                    this.on_read(sys::Result::Err(err), &mut [], ReadState::Progress);
                    return;
                }
                // we got some data we can slice the buffer!
                let len: usize = usize::try_from(nread_int).expect("int cast");
                // SAFETY: buf is valid when nread > 0. `uv_buf_t` is `Copy` —
                // take a local copy so `slice_mut` can borrow `&mut self`
                // (libuv's `read_cb` hands us `*const`).
                let mut b = unsafe { *buf };
                let slice = unsafe { b.slice_mut() };
                this.on_read(sys::Result::Ok(len), &mut slice[..len], ReadState::Progress);
            }
        }
    }

    /// Callback fired when a file read operation completes or is canceled.
    /// Handles cleanup, cancellation, and normal read processing.
    #[cfg(windows)]
    extern "C" fn on_file_read(fs: *mut uv::fs_t) {
        // SAFETY: libuv fs_cb — `fs` is a valid `uv_fs_t*` owned by the boxed
        // `source::File` (separate heap allocation from `Self`). Invoked from
        // the event loop with no other Rust borrow of it live (single-owner).
        // Read out the scalars we need before forming `&mut File` so the
        // `fs_ref` borrow is dead (NLL) by the time `file` covers it.
        let fs_ref = unsafe { &mut *fs };
        let result = fs_ref.result;
        let nread_int = result.int();
        let was_canceled = nread_int == uv::UV_ECANCELED as i64;

        bun_sys::syslog!(
            "onFileRead({}) = {}",
            // SAFETY: `uv_fs_read` populated the `fd` arm of the `file` union.
            Fd::from_uv(unsafe { fs_ref.file_fd() }),
            nread_int
        );

        // Get parent before completing (fs.data may be null if detached)
        let parent_ptr = fs_ref.data;

        // SAFETY: `fs` is the `fs` field of a heap-boxed `source::File`
        // (separate allocation from `Self`), so `from_fs`'s container_of
        // subtraction is valid and the resulting `&mut File` does not overlap
        // the later `&mut WindowsBufferedReader` (distinct allocations).
        // `fs_ref` above is dead (NLL) before this point.
        let file: &mut crate::source::File = unsafe { &mut *crate::source::File::from_fs(fs) };

        // ALWAYS complete the read first (cleans up fs_t, updates state)
        file.complete(was_canceled);

        // If detached, file should be closing itself now
        if parent_ptr.is_null() {
            debug_assert!(file.state == crate::source::FileState::Closing); // complete should have started close
            return;
        }

        // SAFETY: `parent_ptr` (= `fs.data`) is `*mut Self` set via `set_data`.
        // `fs_ref`/`file` above point into the boxed `source::File` — a
        // separate heap allocation — and their borrows end (NLL) before this
        // point in the non-null path, so this is the sole live `&mut` to the
        // reader (single-owner).
        let this: &mut WindowsBufferedReader =
            unsafe { bun_ptr::callback_ctx::<WindowsBufferedReader>(parent_ptr) };

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
            v if v == 0 || v == uv::UV_EOF as i64 => {
                this.flags.insert(WindowsFlags::IS_PAUSED);
                this.on_read(sys::Result::Ok(0), &mut [], ReadState::Eof);
            }
            // UV_ECANCELED needs to be on the top so we avoid UAF
            v if v == uv::UV_ECANCELED as i64 => unreachable!(),
            _ => {
                if let Some(err) = result.to_error(sys::Tag::read) {
                    this.flags.insert(WindowsFlags::IS_PAUSED);
                    this.on_read(sys::Result::Err(err), &mut [], ReadState::Progress);
                    return;
                }

                // PORT NOTE: defer block inlined after body — see below.
                let len: usize = usize::try_from(nread_int).expect("int cast");
                this._offset += len;
                // we got some data lets get the current iov
                //
                // BORROW_PARAM (raw-ptr break): `on_read` takes `&mut self`
                // *and* a slice borrowed from `self.source.File.iov`; under
                // Stacked Borrows that's a self-mut + field-shared conflict.
                // The boxed `File` lives in its own heap allocation, so a
                // `*mut File` snapshot is provenance-disjoint from `&mut self`
                // — same as the Zig `*File` pointer the original kept.
                let file_raw: *mut crate::source::File = match this.source.as_mut() {
                    Some(Source::File(f)) => f.as_mut() as *mut _,
                    _ => core::ptr::null_mut(),
                };
                if !file_raw.is_null() {
                    // SAFETY: `file_raw` points into the boxed File owned by
                    // `this.source`; live for the duration of this callback.
                    let buf = unsafe { (*file_raw).iov.slice_mut() };
                    this.on_read(sys::Result::Ok(len), &mut buf[..len], ReadState::Progress);
                } else {
                    // ops we should not hit this lets fail with EPIPE
                    debug_assert!(false);
                    this.on_read(
                        sys::Result::Err(sys::Error::from_code(sys::E::PIPE, sys::Tag::read)),
                        &mut [],
                        ReadState::Progress,
                    );
                }

                // PORT NOTE: this is the Zig `defer { ... }` body, inlined after the body
                // because both body paths fall through (void return).
                // if we are not paused we keep reading until EOF or err
                if !this.flags.contains(WindowsFlags::IS_PAUSED) {
                    // Re-snapshot — `on_read` may have mutated `this.source`.
                    let this_ptr = core::ptr::from_mut(this).cast::<c_void>();
                    let file_raw: *mut crate::source::File = match this.source.as_mut() {
                        Some(Source::File(f)) => f.as_mut() as *mut _,
                        _ => core::ptr::null_mut(),
                    };
                    if !file_raw.is_null() {
                        // SAFETY: see above; raw-ptr break for self-aliasing.
                        let file = unsafe { &mut *file_raw };
                        // Can only start if file is in deinitialized state
                        if file.can_start() {
                            file.fs.data = this_ptr;
                            file.prepare();
                            let buf =
                                this.get_read_buffer_with_stable_memory_address(64 * 1024);
                            file.iov = uv::uv_buf_t::init(buf);
                            this.flags.insert(WindowsFlags::HAS_INFLIGHT_READ);

                            let offset = if this.flags.contains(WindowsFlags::USE_PREAD) {
                                i64::try_from(this._offset).expect("int cast")
                            } else {
                                -1
                            };
                            // SAFETY: `file` is fully initialized; libuv stores
                            // the cb and fires it on the event loop.
                            if let Some(err) = unsafe {
                                uv::uv_fs_read(
                                    this.vtable.loop_().cast(),
                                    &mut file.fs,
                                    file.file,
                                    &file.iov,
                                    1,
                                    offset,
                                    Some(Self::on_file_read),
                                )
                            }
                            // PORT NOTE: Zig PipeReader.zig:1113 tags this `.write` even
                            // though the syscall is `uv_fs_read` (a Zig bug). Match the
                            // spec for now so user-visible `error.syscall` stays
                            // bit-identical; fix upstream in Zig first.
                            .to_error(sys::Tag::write)
                            {
                                file.complete(false);
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

    #[cfg(windows)]
    pub fn start_reading(&mut self) -> sys::Result<()> {
        if self.flags.contains(WindowsFlags::IS_DONE)
            || !self.flags.contains(WindowsFlags::IS_PAUSED)
        {
            return sys::Result::Ok(());
        }
        self.flags.remove(WindowsFlags::IS_PAUSED);
        // BORROW_PARAM (raw-ptr break): the body needs `&mut self` (for
        // `get_read_buffer_…`/`flags`) while also holding `&mut File` borrowed
        // out of `self.source`. The boxed `File` is its own heap allocation, so
        // a `*mut File` snapshot is provenance-disjoint from `&mut self`.
        let self_ptr = self as *mut Self as *mut c_void;
        let Some(source) = self.source.as_mut() else {
            return sys::Result::Err(sys::Error::from_code(sys::E::BADF, sys::Tag::read));
        };
        debug_assert!(!source.is_closed());

        match source {
            Source::File(file) => {
                let file_raw: *mut crate::source::File = file.as_mut();
                // SAFETY: `file_raw` points into the boxed File owned by
                // `self.source`; live until `self.source` is replaced.
                let file = unsafe { &mut *file_raw };
                // If already reading, just set data and unpause
                file.fs.data = self_ptr;
                if !file.can_start() {
                    return sys::Result::Ok(());
                }

                // Start new read - set data before prepare
                file.prepare();
                let buf = self.get_read_buffer_with_stable_memory_address(64 * 1024);
                file.iov = uv::uv_buf_t::init(buf);
                self.flags.insert(WindowsFlags::HAS_INFLIGHT_READ);

                let offset = if self.flags.contains(WindowsFlags::USE_PREAD) {
                    i64::try_from(self._offset).expect("int cast")
                } else {
                    -1
                };
                // SAFETY: file is fully initialized; libuv stores cb and fires
                // it on the event loop.
                if let Some(err) = unsafe {
                    uv::uv_fs_read(
                        self.vtable.loop_().cast(),
                        &mut file.fs,
                        file.file,
                        &file.iov,
                        1,
                        offset,
                        Some(Self::on_file_read),
                    )
                }
                // PORT NOTE: Zig PipeReader.zig:1163 tags this `.write` even though the
                // syscall is `uv_fs_read` (a Zig bug). Match the spec for now so
                // user-visible `error.syscall` stays bit-identical; fix upstream in
                // Zig first.
                .to_error(sys::Tag::write)
                {
                    file.complete(false);
                    self.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
                    return sys::Result::Err(err);
                }
            }
            _ => {
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
                    // Zig spec PipeReader.zig:1171 routes through
                    // `bun.windows.libuv.log` (the `uv` debug scope, toggled by
                    // `BUN_DEBUG_uv=1`), not `SYS`.
                    bun_sys::windows::libuv::log!(
                        "uv_read_start() = {}",
                        bstr::BStr::new(err.name()),
                    );
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
        let Some(source) = self.source.as_mut() else {
            return sys::Result::Ok(());
        };
        match source {
            Source::File(file) => {
                file.stop();
            }
            _ => {
                // SAFETY: stream handle is live (just matched non-File).
                unsafe { uv::uv_read_stop(source.to_stream()) };
            }
        }
        sys::Result::Ok(())
    }

    pub fn close_impl<const CALL_DONE: bool>(&mut self) {
        if let Some(source) = self.source.take() {
            match source {
                Source::SyncFile(file) | Source::File(file) => {
                    // Detach - file will close itself after operation completes.
                    // Hand the Box off to libuv: detach() leaves either an
                    // in-flight uv_fs_read (on_file_read) or a scheduled
                    // uv_fs_close (on_close_complete) pending; the callback
                    // reclaims the allocation via heap::take. Dropping the
                    // Box here would free the uv_fs_t out from under libuv.
                    let raw = bun_core::heap::into_raw(file);
                    // SAFETY: raw is a live heap File*; the pending fs callback
                    // is the sole reclaimer (heap::take in on_close_complete).
                    unsafe { (*raw).detach() };
                }
                #[cfg(windows)]
                Source::Pipe(pipe) => {
                    // Hand the Box off to libuv; the close cb reclaims it.
                    let raw = bun_core::heap::into_raw(pipe);
                    // SAFETY: raw is a live uv::Pipe*; on_pipe_close frees it.
                    unsafe {
                        (*raw).data = raw.cast::<c_void>();
                        self.flags.insert(WindowsFlags::IS_PAUSED);
                        (*raw).close(Self::on_pipe_close);
                    }
                }
                #[cfg(windows)]
                Source::Tty(tty) => {
                    let p = tty.as_ptr();
                    if crate::source::stdin_tty::is_stdin_tty(p) {
                        // Node only ever closes stdin on process exit.
                    } else {
                        // SAFETY: tty is a live heap-allocated uv_tty_t*.
                        unsafe {
                            (*p).data = p.cast::<c_void>();
                            (*p).close(Self::on_tty_close);
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

    /// Explicit teardown that does **not** fire `on_reader_done` (unlike
    /// [`close`]). Mirrors Zig `WindowsBufferedReader.deinit`. Safe to call
    /// before Drop; both paths are idempotent over an already-taken source.
    pub fn deinit(&mut self) {
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        self._buffer = Vec::new();
        let Some(source) = self.source.take() else {
            return;
        };
        if !source.is_closed() {
            // closeImpl will take care of freeing the source.
            // PORT NOTE: Zig nulls `source` *before* calling closeImpl, which
            // makes that call a no-op (latent Zig leak). We cannot mirror that
            // verbatim: in Zig nulling a `?*Pipe` leaks; in Rust dropping
            // `Box<Pipe>` frees a uv_pipe_t still linked into the loop's
            // handle queue → UAF. Restore the source so close_impl can do the
            // proper take + hand-off to libuv (into_raw + uv_close).
            self.source = Some(source);
            self.close_impl::<false>();
        } else {
            // Already closing/closed: a uv close callback may still be pending
            // on this allocation. Zig leaks here (pointer nulled, no dtor);
            // match that — dropping the Box would free memory libuv still owns.
            core::mem::forget(source);
        }
    }

    #[cfg(windows)]
    extern "C" fn on_pipe_close(handle: *mut uv::Pipe) {
        // SAFETY: handle.data was set to the pipe itself before close.
        let this = unsafe { (*handle).data.cast::<uv::Pipe>() };
        // SAFETY: pipe was Box-allocated; reclaim and drop.
        drop(unsafe { bun_core::heap::take(this) });
    }

    #[cfg(windows)]
    extern "C" fn on_tty_close(handle: *mut uv::uv_tty_t) {
        // SAFETY: handle.data was set to the tty itself before close.
        let this = unsafe { (*handle).data.cast::<uv::uv_tty_t>() };
        // Caller already gates on `!is_stdin_tty` before scheduling close, so
        // `this` is heap-allocated (open_tty heap::alloc). Reclaim and drop.
        debug_assert!(!crate::source::stdin_tty::is_stdin_tty(this));
        drop(unsafe { bun_core::heap::take(this) });
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
            // Pointer-range check against `[ptr, ptr+capacity)` — can't form a
            // `&[u8]` over spare capacity (uninit), so do it on addresses.
            let base = self._buffer.as_ptr() as usize;
            let end = base + self._buffer.capacity();
            let s = slice.as_ptr() as usize;
            if !slice.is_empty() && !(s >= base && s + slice.len() <= end) {
                panic!("uv_read_cb: buf is not in buffer! This is a bug in bun. Please report it.");
            }
        }

        // move cursor foward
        // SAFETY: slice is inside _buffer's spare capacity; libuv wrote `amount_result` bytes.
        unsafe {
            self._buffer.set_len(self._buffer.len() + amount_result);
        }

        let should_continue = self._on_read_chunk(slice, has_more);

        // PORT NOTE: Spec parents that stream (IOReader.zig:161,
        // shell/subproc.zig:1230) call `this.reader.startWithCurrentPipe()`
        // from inside their `onReadChunk` callback on Windows. The Rust
        // shell IOReader port cannot re-derive `&mut Self` from inside the
        // vtable callback (Stacked-Borrows; see shell/IOReader.rs PORT NOTE),
        // so the call is omitted there. The re-arm half of that call is
        // already handled by `on_file_read`'s defer block / `uv_read_start`,
        // but its other side effect — `buffer().clearRetainingCapacity()`
        // (PipeReader.zig:949) — is load-bearing: without it `_buffer.len`
        // grows by `amount_result` every chunk and never resets, so a 1 GB
        // `cat` holds 1 GB resident instead of ~64 KB. Clear it here, after
        // the streaming consumer has finished with `slice`.
        if should_continue
            && has_more != ReadState::Eof
            && self.vtable.is_streaming_enabled()
        {
            self._buffer.clear();
        }

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

#[cfg(windows)]
impl Drop for WindowsBufferedReader {
    fn drop(&mut self) {
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        // _buffer freed by Vec Drop.
        // Do NOT take() source here and let it drop: Box<Pipe>/Box<File> own
        // live uv handles registered with the loop. Let close_impl perform the
        // take + into_raw hand-off so the uv close callback reclaims them.
        self.close_impl::<false>();
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

#[inline]
pub fn with_buffered_reader_handle<R>(
    handle: BufferedReaderHandle,
    f: impl FnOnce(&mut BufferedReader) -> R,
) -> R {
    // SAFETY: handles are recorded from live BufferedReader fields by the crate
    // that owns the reader. Keep the raw-address recovery in bun_io rather than
    // spreading typed pointer casts through higher-tier consumers.
    unsafe { f(&mut *handle.as_ptr::<BufferedReader>()) }
}

// ported from: src/io/PipeReader.zig
