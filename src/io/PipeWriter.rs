use core::ffi::c_void;
use core::mem;

use bun_aio::FilePoll;
use bun_collections::BabyList;
use bun_core::OOM;
use bun_jsc::EventLoopHandle;
use bun_sys::windows::libuv as uv;
use bun_sys::{self as sys, Fd};

use crate::pipes::{FileType, PollOrFd};
use crate::source::Source;

bun_output::declare_scope!(PipeWriter, hidden);

// ──────────────────────────────────────────────────────────────────────────
// WriteResult / WriteStatus
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
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

// ──────────────────────────────────────────────────────────────────────────
// PosixPipeWriter
// ──────────────────────────────────────────────────────────────────────────

/// Zig: `fn PosixPipeWriter(comptime This, getFd, getBuffer, onWrite, registerPoll, onError, _, getFileType) type`
///
/// Originally this was a comptime vtable struct. In Rust the comptime fn pointers
/// become required trait methods on `Self`, and the returned struct's fns become
/// provided trait methods.
pub trait PosixPipeWriter {
    fn get_fd(&self) -> Fd;
    fn get_buffer(&self) -> &[u8];
    fn on_write(&mut self, written: usize, status: WriteStatus);
    /// Optional in Zig (`?fn`). Implement as no-op when not needed and set
    /// `HAS_REGISTER_POLL = false`.
    fn register_poll(&mut self);
    const HAS_REGISTER_POLL: bool = true;
    fn on_error(&mut self, err: sys::Error);
    fn get_file_type(&self) -> FileType;
    fn get_force_sync(&self) -> bool;

    // TODO(port): Zig accesses `parent.handle` (PollOrFd) directly for logging
    // in on_poll. Expose via accessor instead of requiring a field.
    fn handle(&self) -> &PollOrFd;

    fn try_write(&mut self, force_sync: bool, buf: &[u8]) -> WriteResult {
        // PERF(port): Zig used `switch { inline else }` to monomorphize
        // try_write_with_write_fn per FileType — profile in Phase B.
        let ft = if !force_sync { self.get_file_type() } else { FileType::File };
        match ft {
            FileType::NonblockingPipe | FileType::File => {
                self.try_write_with_write_fn(buf, sys::write)
            }
            FileType::Pipe => self.try_write_with_write_fn(buf, write_to_blocking_pipe),
            FileType::Socket => self.try_write_with_write_fn(buf, sys::send_non_block),
        }
    }

    fn try_write_with_write_fn(
        &mut self,
        buf: &[u8],
        write_fn: fn(Fd, &[u8]) -> sys::Result<usize>,
    ) -> WriteResult {
        let fd = self.get_fd();

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

    fn on_poll(&mut self, size_hint: isize, received_hup: bool) {
        // PORT NOTE: reshaped for borrowck — capture buffer.len() before further &mut self calls.
        let buffer_len = self.get_buffer().len();
        bun_output::scoped_log!(PipeWriter, "onPoll({})", buffer_len);
        if buffer_len == 0 && !received_hup {
            bun_output::scoped_log!(
                PipeWriter,
                "PosixPipeWriter(0x{:x}) handle={}",
                self as *const _ as usize,
                <&'static str>::from(self.handle())
            );
            if let PollOrFd::Poll(poll) = self.handle() {
                bun_output::scoped_log!(
                    PipeWriter,
                    "PosixPipeWriter(0x{:x}) got 0, registered state = {}",
                    self as *const _ as usize,
                    poll.is_registered()
                );
            }
            return;
        }

        let max_write = if size_hint > 0 && self.get_file_type().is_blocking() {
            usize::try_from(size_hint).unwrap()
        } else {
            usize::MAX
        };

        // PORT NOTE: reshaped for borrowck — Zig passed `buffer` (borrow of self) into
        // drain_buffered_data which also takes &mut self. Re-fetch inside.
        match self.drain_buffered_data_from_self(max_write, received_hup) {
            WriteResult::Pending(wrote) => {
                if wrote > 0 {
                    self.on_write(wrote, WriteStatus::Pending);
                }

                if Self::HAS_REGISTER_POLL {
                    self.register_poll();
                }
            }
            WriteResult::Wrote(amt) => {
                // `.drained`: the buffer was fully written before the
                // callback. If the callback buffers more data via
                // `write()`, that path already calls `register_poll()`.
                // Don't touch `self` after the callback returns — the
                // `.drained` callback is allowed to close/free the writer
                // (e.g. `FileSink.onWrite` → `writer.end()` → `onClose`
                // may drop the last ref).
                self.on_write(amt, WriteStatus::Drained);
            }
            WriteResult::Err(err) => {
                self.on_error(err);
            }
            WriteResult::Done(amt) => {
                self.on_write(amt, WriteStatus::EndOfFile);
            }
        }
    }

    /// PORT NOTE: helper that re-fetches the buffer to avoid borrowck overlap in on_poll.
    fn drain_buffered_data_from_self(
        &mut self,
        max_write_size: usize,
        received_hup: bool,
    ) -> WriteResult {
        // TODO(port): borrowck — Zig passed `buf: []const u8` separately while
        // also mutating `self`. Phase B: verify get_buffer() stable across loop.
        let buf_len = self.get_buffer().len();
        // SAFETY: buffer points into self; Zig code never mutated the underlying
        // storage during this loop (only reads). Phase B should refactor to take
        // a raw slice.
        let buf_ptr = self.get_buffer().as_ptr();
        let buf = unsafe { core::slice::from_raw_parts(buf_ptr, buf_len) };
        self.drain_buffered_data(buf, max_write_size, received_hup)
    }

    fn drain_buffered_data(
        &mut self,
        buf: &[u8],
        max_write_size: usize,
        received_hup: bool,
    ) -> WriteResult {
        let _ = received_hup; // autofix

        let trimmed = if max_write_size < buf.len() && max_write_size > 0 {
            &buf[0..max_write_size]
        } else {
            buf
        };

        let mut drained: usize = 0;

        while drained < trimmed.len() {
            let attempt = self.try_write(self.get_force_sync(), &trimmed[drained..]);
            match attempt {
                WriteResult::Pending(pending) => {
                    drained += pending;
                    return WriteResult::Pending(drained);
                }
                WriteResult::Wrote(amt) => {
                    drained += amt;
                }
                WriteResult::Err(err) => {
                    if drained > 0 {
                        self.on_error(err);
                        return WriteResult::Wrote(drained);
                    } else {
                        return WriteResult::Err(err);
                    }
                }
                WriteResult::Done(amt) => {
                    drained += amt;
                    return WriteResult::Done(drained);
                }
            }
        }

        WriteResult::Wrote(drained)
    }
}

/// Zig: `fn writeToFileType(comptime file_type: FileType) *const fn(...)` — folded into
/// `try_write` above. Kept here as a free fn for the blocking-pipe path.
fn write_to_blocking_pipe(fd: Fd, buf: &[u8]) -> sys::Result<usize> {
    #[cfg(target_os = "linux")]
    {
        if bun_sys::linux::RWFFlagSupport::is_maybe_supported() {
            return sys::write_nonblocking(fd, buf);
        }
    }

    match bun_sys::is_writable(fd) {
        bun_sys::Writable::Ready | bun_sys::Writable::Hup => sys::write(fd, buf),
        bun_sys::Writable::NotReady => sys::Result::Err(sys::Error::retry()),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PosixBufferedWriter
// ──────────────────────────────────────────────────────────────────────────

/// Function table for `PosixBufferedWriter`. In Zig this was `function_table: anytype`;
/// in many cases the function table can be the same as `Parent`.
pub trait PosixBufferedWriterParent {
    fn on_write(&mut self, amount: usize, status: WriteStatus);
    fn on_error(&mut self, err: sys::Error);
    const HAS_ON_CLOSE: bool;
    fn on_close(&mut self) {}
    fn get_buffer(&self) -> &[u8];
    const HAS_ON_WRITABLE: bool;
    fn on_writable(&mut self) {}
    // TODO(port): Zig calls `parent.eventLoop()` (returns anytype). Phase B: pin concrete type.
    fn event_loop(&self) -> EventLoopHandle;
}

pub struct PosixBufferedWriter<Parent: PosixBufferedWriterParent> {
    pub handle: PollOrFd,
    pub parent: *mut Parent,
    pub is_done: bool,
    pub pollable: bool,
    pub closed_without_reporting: bool,
    pub close_fd: bool,
}

impl<Parent: PosixBufferedWriterParent> Default for PosixBufferedWriter<Parent> {
    fn default() -> Self {
        Self {
            handle: PollOrFd::Closed,
            parent: core::ptr::null_mut(), // Zig: undefined
            is_done: false,
            pollable: false,
            closed_without_reporting: false,
            close_fd: true,
        }
    }
}

impl<Parent: PosixBufferedWriterParent> PosixPipeWriter for PosixBufferedWriter<Parent> {
    fn get_fd(&self) -> Fd {
        self.handle.get_fd()
    }
    fn get_buffer(&self) -> &[u8] {
        // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
        unsafe { (*self.parent).get_buffer() }
    }
    fn on_write(&mut self, written: usize, status: WriteStatus) {
        self._on_write(written, status);
    }
    fn register_poll(&mut self) {
        Self::register_poll(self);
    }
    fn on_error(&mut self, err: sys::Error) {
        self._on_error(err);
    }
    fn get_file_type(&self) -> FileType {
        Self::get_file_type(self)
    }
    fn get_force_sync(&self) -> bool {
        false
    }
    fn handle(&self) -> &PollOrFd {
        &self.handle
    }
}

impl<Parent: PosixBufferedWriterParent> PosixBufferedWriter<Parent> {
    #[inline]
    fn parent(&self) -> &mut Parent {
        // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
        unsafe { &mut *self.parent }
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>()
    }

    pub fn create_poll(&mut self, fd: Fd) -> *mut FilePoll {
        FilePoll::init(self.parent().event_loop(), fd, Default::default(), self)
    }

    pub fn get_poll(&self) -> Option<&mut FilePoll> {
        self.handle.get_poll()
    }

    pub fn get_file_type(&self) -> FileType {
        let Some(poll) = self.get_poll() else { return FileType::File };
        poll.file_type()
    }

    pub fn get_fd(&self) -> Fd {
        self.handle.get_fd()
    }

    fn _on_error(&mut self, err: sys::Error) {
        debug_assert!(!err.is_retry());

        self.parent().on_error(err);

        self.close();
    }

    pub fn get_force_sync(&self) -> bool {
        false
    }

    fn _on_write(&mut self, written: usize, status: WriteStatus) {
        let was_done = self.is_done == true;
        let parent = self.parent;

        if status == WriteStatus::EndOfFile && !was_done {
            self.close_without_reporting();
        }

        // SAFETY: parent BACKREF valid.
        unsafe { (*parent).on_write(written, status) };
        if status == WriteStatus::EndOfFile && !was_done {
            self.close();
        }
    }

    fn _on_writable(&mut self) {
        if self.is_done {
            return;
        }

        if Parent::HAS_ON_WRITABLE {
            self.parent().on_writable();
        }
    }

    pub fn register_poll(&mut self) {
        let Some(poll) = self.get_poll() else { return };
        // Use the event loop from the parent, not the global one
        let loop_ = self.parent().event_loop().loop_();
        match poll.register_with_fd(loop_, bun_aio::Pollable::Writable, bun_aio::PollMode::Dispatch, poll.fd) {
            sys::Result::Err(err) => {
                self.parent().on_error(err);
            }
            sys::Result::Ok(()) => {}
        }
    }

    pub fn has_ref(&self) -> bool {
        if self.is_done {
            return false;
        }

        let Some(poll) = self.get_poll() else { return false };
        poll.can_enable_keeping_process_alive()
    }

    pub fn enable_keeping_process_alive<E>(&self, event_loop: E) {
        self.update_ref(event_loop, true);
    }

    pub fn disable_keeping_process_alive<E>(&self, event_loop: E) {
        self.update_ref(event_loop, false);
    }

    fn get_buffer_internal(&self) -> &[u8] {
        self.parent().get_buffer()
    }

    pub fn end(&mut self) {
        if self.is_done {
            return;
        }

        self.is_done = true;
        self.close();
    }

    fn close_without_reporting(&mut self) {
        if self.get_fd() != Fd::invalid() {
            debug_assert!(!self.closed_without_reporting);
            self.closed_without_reporting = true;
            if self.close_fd {
                self.handle.close(None::<fn()>, ());
            }
        }
    }

    pub fn close(&mut self) {
        if Parent::HAS_ON_CLOSE {
            if self.closed_without_reporting {
                self.closed_without_reporting = false;
                self.parent().on_close();
            } else {
                self.handle.close_impl(self.parent, Parent::on_close, self.close_fd);
            }
        }
    }

    pub fn update_ref<E>(&self, event_loop: E, value: bool) {
        let Some(poll) = self.get_poll() else { return };
        poll.set_keeping_process_alive(event_loop, value);
    }

    pub fn set_parent(&mut self, parent: *mut Parent) {
        self.parent = parent;
        self.handle.set_owner(self);
    }

    pub fn write(&mut self) {
        self.on_poll(0, false);
    }

    pub fn watch(&mut self) {
        if self.pollable {
            if matches!(self.handle, PollOrFd::Fd(_)) {
                let fd = self.get_fd();
                self.handle = PollOrFd::Poll(self.create_poll(fd));
            }

            Self::register_poll(self);
        }
    }

    /// Zig accepts `bun.FD`, `*bun.MovableIfWindowsFd`, or `bun.MovableIfWindowsFd`.
    // TODO(port): MovableIfWindowsFd overload — Phase B add Into<Fd> bound or separate fn.
    pub fn start(&mut self, rawfd: Fd, pollable: bool) -> sys::Result<()> {
        let fd = rawfd;
        self.pollable = pollable;
        if !pollable {
            debug_assert!(!matches!(self.handle, PollOrFd::Poll(_)));
            self.handle = PollOrFd::Fd(fd);
            return sys::Result::Ok(());
        }
        let poll = match self.get_poll() {
            Some(p) => p,
            None => {
                let p = self.create_poll(fd);
                self.handle = PollOrFd::Poll(p);
                match &self.handle {
                    PollOrFd::Poll(p) => *p,
                    _ => unreachable!(),
                }
            }
        };
        let loop_ = self.parent().event_loop().loop_();

        // SAFETY: poll is a *mut FilePoll just stored in self.handle (PollOrFd::Poll); valid until handle is closed.
        match unsafe { (*poll).register_with_fd(loop_, bun_aio::Pollable::Writable, bun_aio::PollMode::Dispatch, fd) } {
            sys::Result::Err(err) => {
                return sys::Result::Err(err);
            }
            sys::Result::Ok(()) => {
                self.enable_keeping_process_alive(self.parent().event_loop());
            }
        }

        sys::Result::Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PosixStreamingWriter
// ──────────────────────────────────────────────────────────────────────────

/// Function table for `PosixStreamingWriter`.
pub trait PosixStreamingWriterParent {
    fn on_write(&mut self, amount: usize, status: WriteStatus);
    fn on_error(&mut self, err: sys::Error);
    const HAS_ON_READY: bool;
    fn on_ready(&mut self) {}
    fn on_close(&mut self);
    fn event_loop(&self) -> EventLoopHandle;
    fn loop_(&self) -> *mut bun_uws::Loop;
}

pub struct PosixStreamingWriter<Parent: PosixStreamingWriterParent> {
    pub outgoing: StreamBuffer,
    pub handle: PollOrFd,
    pub parent: *mut Parent,
    pub is_done: bool,
    pub closed_without_reporting: bool,
    pub force_sync: bool,
}

impl<Parent: PosixStreamingWriterParent> Default for PosixStreamingWriter<Parent> {
    fn default() -> Self {
        Self {
            outgoing: StreamBuffer::default(),
            handle: PollOrFd::Closed,
            parent: core::ptr::null_mut(), // Zig: undefined
            is_done: false,
            closed_without_reporting: false,
            force_sync: false,
        }
    }
}

impl<Parent: PosixStreamingWriterParent> PosixPipeWriter for PosixStreamingWriter<Parent> {
    fn get_fd(&self) -> Fd {
        self.handle.get_fd()
    }
    fn get_buffer(&self) -> &[u8] {
        self.outgoing.slice()
    }
    fn on_write(&mut self, written: usize, status: WriteStatus) {
        self._on_write(written, status);
    }
    fn register_poll(&mut self) {
        Self::register_poll(self);
    }
    fn on_error(&mut self, err: sys::Error) {
        self._on_error(err);
    }
    fn get_file_type(&self) -> FileType {
        Self::get_file_type(self)
    }
    fn get_force_sync(&self) -> bool {
        self.force_sync
    }
    fn handle(&self) -> &PollOrFd {
        &self.handle
    }
}

impl<Parent: PosixStreamingWriterParent> PosixStreamingWriter<Parent> {
    // TODO: configurable?
    // TODO(port): std.heap.page_size_min — pick correct const for target.
    const CHUNK_SIZE: usize = 4096;

    #[inline]
    fn parent(&self) -> &mut Parent {
        // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
        unsafe { &mut *self.parent }
    }

    pub fn get_force_sync(&self) -> bool {
        self.force_sync
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.outgoing.memory_cost()
    }

    pub fn get_poll(&self) -> Option<&mut FilePoll> {
        self.handle.get_poll()
    }

    pub fn get_fd(&self) -> Fd {
        self.handle.get_fd()
    }

    pub fn get_file_type(&self) -> FileType {
        let Some(poll) = self.get_poll() else { return FileType::File };
        poll.file_type()
    }

    pub fn has_pending_data(&self) -> bool {
        self.outgoing.is_not_empty()
    }

    pub fn should_buffer(&self, addition: usize) -> bool {
        !self.force_sync && self.outgoing.size() + addition < Self::CHUNK_SIZE
    }

    pub fn get_buffer(&self) -> &[u8] {
        self.outgoing.slice()
    }

    fn _on_error(&mut self, err: sys::Error) {
        debug_assert!(!err.is_retry());

        self.close_without_reporting();
        self.is_done = true;
        self.outgoing.reset();

        self.parent().on_error(err);
        self.close();
    }

    fn _on_write(&mut self, written: usize, status: WriteStatus) {
        self.outgoing.wrote(written);

        if status == WriteStatus::EndOfFile && !self.is_done {
            self.close_without_reporting();
        }

        if self.outgoing.is_empty() {
            self.outgoing.cursor = 0;
            if status != WriteStatus::EndOfFile {
                self.outgoing.maybe_shrink();
            }
            self.outgoing.list.clear();
        }

        self.parent().on_write(written, status);
    }

    pub fn set_parent(&mut self, parent: *mut Parent) {
        self.parent = parent;
        self.handle.set_owner(self);
    }

    fn _on_writable(&mut self) {
        if self.is_done || self.closed_without_reporting {
            return;
        }

        self.outgoing.reset();

        if Parent::HAS_ON_READY {
            self.parent().on_ready();
        }
    }

    fn close_without_reporting(&mut self) {
        if self.get_fd() != Fd::invalid() {
            debug_assert!(!self.closed_without_reporting);
            self.closed_without_reporting = true;
            self.handle.close(None::<fn()>, ());
        }
    }

    fn register_poll(&mut self) {
        let Some(poll) = self.get_poll() else { return };
        match poll.register_with_fd(self.parent().loop_(), bun_aio::Pollable::Writable, bun_aio::PollMode::Dispatch, poll.fd) {
            sys::Result::Err(err) => {
                self.parent().on_error(err);
                self.close();
            }
            sys::Result::Ok(()) => {}
        }
    }

    pub fn write_utf16(&mut self, buf: &[u16]) -> WriteResult {
        if self.is_done || self.closed_without_reporting {
            return WriteResult::Done(0);
        }

        let before_len = self.outgoing.size();

        if self.outgoing.write_utf16(buf).is_err() {
            return WriteResult::Err(sys::Error::oom());
        }

        let buf_len = self.outgoing.size() - before_len;

        self.maybe_write_newly_buffered_data(buf_len)
    }

    pub fn write_latin1(&mut self, buf: &[u8]) -> WriteResult {
        if self.is_done || self.closed_without_reporting {
            return WriteResult::Done(0);
        }

        if bun_str::strings::is_all_ascii(buf) {
            return self.write(buf);
        }

        let before_len = self.outgoing.size();

        const CHECK_ASCII: bool = false;
        if self.outgoing.write_latin1::<CHECK_ASCII>(buf).is_err() {
            return WriteResult::Err(sys::Error::oom());
        }

        let buf_len = self.outgoing.size() - before_len;

        self.maybe_write_newly_buffered_data(buf_len)
    }

    fn maybe_write_newly_buffered_data(&mut self, buf_len: usize) -> WriteResult {
        debug_assert!(!self.is_done);

        if self.should_buffer(0) {
            self.parent().on_write(buf_len, WriteStatus::Drained);
            Self::register_poll(self);

            return WriteResult::Wrote(buf_len);
        }

        // PORT NOTE: reshaped for borrowck — pass slice via raw to avoid &self/&mut self overlap.
        // TODO(port): raw-ptr borrowck escape — restructure in Phase B.
        let slice_ptr = self.outgoing.slice().as_ptr();
        let slice_len = self.outgoing.slice().len();
        // SAFETY: outgoing storage not reallocated during try_write_newly_buffered_data
        // until after reads complete (writes happen via syscall on this slice).
        let buf = unsafe { core::slice::from_raw_parts(slice_ptr, slice_len) };
        self.try_write_newly_buffered_data(buf)
    }

    fn try_write_newly_buffered_data(&mut self, buf: &[u8]) -> WriteResult {
        debug_assert!(!self.is_done);

        let rc = self.try_write(self.force_sync, buf);

        match rc {
            WriteResult::Wrote(amt) => {
                if amt == self.outgoing.size() {
                    self.outgoing.reset();
                    self.parent().on_write(amt, WriteStatus::Drained);
                } else {
                    self.outgoing.wrote(amt);
                    self.parent().on_write(amt, WriteStatus::Pending);
                    Self::register_poll(self);
                    return WriteResult::Pending(amt);
                }
            }
            WriteResult::Done(amt) => {
                self.outgoing.reset();
                self.parent().on_write(amt, WriteStatus::EndOfFile);
            }
            WriteResult::Pending(amt) => {
                self.outgoing.wrote(amt);
                self.parent().on_write(amt, WriteStatus::Pending);
                Self::register_poll(self);
            }

            ref r => return WriteResult::Err(match r { WriteResult::Err(e) => *e, _ => unreachable!() }),
            // TODO(port): Zig `else => |r| return r` — only Err remains; cleaner once WriteResult derives Clone.
        }

        rc
    }

    pub fn write(&mut self, buf: &[u8]) -> WriteResult {
        if self.is_done || self.closed_without_reporting {
            return WriteResult::Done(0);
        }

        if self.should_buffer(buf.len()) {
            // this is streaming, but we buffer the data below `chunk_size` to
            // reduce the number of writes
            if self.outgoing.write(buf).is_err() {
                return WriteResult::Err(sys::Error::oom());
            }

            // noop, but need this to have a chance
            // to register deferred tasks (onAutoFlush)
            self.parent().on_write(buf.len(), WriteStatus::Drained);
            Self::register_poll(self);

            // it's buffered, but should be reported as written to
            // callers
            return WriteResult::Wrote(buf.len());
        }

        if self.outgoing.size() > 0 {
            // make sure write is in-order
            if self.outgoing.write(buf).is_err() {
                return WriteResult::Err(sys::Error::oom());
            }

            // PORT NOTE: reshaped for borrowck
            // TODO(port): raw-ptr borrowck escape — restructure in Phase B.
            let slice_ptr = self.outgoing.slice().as_ptr();
            let slice_len = self.outgoing.slice().len();
            // SAFETY: outgoing storage is not reallocated inside try_write_newly_buffered_data
            // until after the syscall reads from this slice (only reset/wrote cursor mutation).
            let s = unsafe { core::slice::from_raw_parts(slice_ptr, slice_len) };
            return self.try_write_newly_buffered_data(s);
        }

        let rc = self.try_write(self.force_sync, buf);

        match rc {
            WriteResult::Pending(amt) => {
                if self.outgoing.write(&buf[amt..]).is_err() {
                    return WriteResult::Err(sys::Error::oom());
                }
                self.parent().on_write(amt, WriteStatus::Pending);
                Self::register_poll(self);
            }
            WriteResult::Wrote(amt) => {
                if amt < buf.len() {
                    if self.outgoing.write(&buf[amt..]).is_err() {
                        return WriteResult::Err(sys::Error::oom());
                    }
                    self.parent().on_write(amt, WriteStatus::Pending);
                    Self::register_poll(self);
                } else {
                    self.outgoing.reset();
                    self.parent().on_write(amt, WriteStatus::Drained);
                }
            }
            WriteResult::Done(amt) => {
                self.outgoing.reset();
                self.parent().on_write(amt, WriteStatus::EndOfFile);
                return WriteResult::Done(amt);
            }
            _ => {}
        }

        rc
    }

    pub fn flush(&mut self) -> WriteResult {
        if self.closed_without_reporting || self.is_done {
            return WriteResult::Done(0);
        }

        let buffer_len = self.get_buffer().len();
        if buffer_len == 0 {
            self.outgoing.reset();
            return WriteResult::Wrote(0);
        }

        let received_hup = 'brk: {
            if let Some(poll) = self.get_poll() {
                break 'brk poll.flags.contains(bun_aio::PollFlag::Hup);
            }
            false
        };

        // PORT NOTE: reshaped for borrowck — re-fetch buffer inside.
        let rc = self.drain_buffered_data_from_self(usize::MAX, received_hup);
        // update head
        match rc {
            WriteResult::Pending(written) => {
                self.outgoing.wrote(written);
                if self.outgoing.is_empty() {
                    self.outgoing.reset();
                }
            }
            WriteResult::Wrote(written) => {
                self.outgoing.wrote(written);
                if self.outgoing.is_empty() {
                    self.outgoing.reset();
                }
            }
            _ => {
                self.outgoing.reset();
            }
        }
        rc
    }

    pub fn has_ref(&self) -> bool {
        let Some(poll) = self.get_poll() else { return false };
        !self.is_done && poll.can_enable_keeping_process_alive()
    }

    pub fn enable_keeping_process_alive(&self, event_loop: EventLoopHandle) {
        if self.is_done {
            return;
        }
        let Some(poll) = self.get_poll() else { return };
        poll.enable_keeping_process_alive(event_loop);
    }

    pub fn disable_keeping_process_alive(&self, event_loop: EventLoopHandle) {
        let Some(poll) = self.get_poll() else { return };
        poll.disable_keeping_process_alive(event_loop);
    }

    pub fn update_ref(&self, event_loop: EventLoopHandle, value: bool) {
        if value {
            self.enable_keeping_process_alive(event_loop);
        } else {
            self.disable_keeping_process_alive(event_loop);
        }
    }

    pub fn end(&mut self) {
        if self.is_done {
            return;
        }

        self.is_done = true;
        self.close();
    }

    pub fn close(&mut self) {
        if self.closed_without_reporting {
            self.closed_without_reporting = false;
            debug_assert!(self.get_fd() == Fd::invalid());
            self.parent().on_close();
            return;
        }

        self.handle.close(Some(self.parent), Parent::on_close);
    }

    pub fn start(&mut self, fd: Fd, is_pollable: bool) -> sys::Result<()> {
        if !is_pollable {
            self.close();
            self.handle = PollOrFd::Fd(fd);
            return sys::Result::Ok(());
        }

        let loop_ = self.parent().event_loop();
        let poll = match self.get_poll() {
            Some(p) => p,
            None => {
                self.handle = PollOrFd::Poll(FilePoll::init(loop_, fd, Default::default(), self));
                match &self.handle {
                    PollOrFd::Poll(p) => *p,
                    _ => unreachable!(),
                }
            }
        };

        // SAFETY: poll is a *mut FilePoll just stored in self.handle (PollOrFd::Poll); valid until handle is closed.
        match unsafe { (*poll).register_with_fd(loop_.loop_(), bun_aio::Pollable::Writable, bun_aio::PollMode::Dispatch, fd) } {
            sys::Result::Err(err) => {
                return sys::Result::Err(err);
            }
            sys::Result::Ok(()) => {}
        }

        sys::Result::Ok(())
    }
}

impl<Parent: PosixStreamingWriterParent> Drop for PosixStreamingWriter<Parent> {
    fn drop(&mut self) {
        self.close_without_reporting();
        // outgoing dropped automatically
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BaseWindowsPipeWriter
// ──────────────────────────────────────────────────────────────────────────

/// Will provide base behavior for pipe writers.
/// The implementor type should provide:
///   source: Option<Source>,
///   parent: *mut Parent,
///   is_done: bool,
///   owns_fd: bool,
///   fn start_with_current_pipe(&mut self) -> sys::Result<()>,
///   fn on_close_source(&mut self),
pub trait BaseWindowsPipeWriter {
    type Parent: WindowsWriterParent;

    /// `true` for WindowsStreamingWriter (has `current_payload`), `false` for buffered.
    const HAS_CURRENT_PAYLOAD: bool;

    fn source(&self) -> &Option<Source>;
    fn source_mut(&mut self) -> &mut Option<Source>;
    fn parent_ptr(&self) -> *mut Self::Parent;
    fn set_parent_ptr(&mut self, p: *mut Self::Parent);
    fn is_done(&self) -> bool;
    fn set_is_done(&mut self, v: bool);
    fn owns_fd(&self) -> bool;
    fn start_with_current_pipe(&mut self) -> sys::Result<()>;
    fn on_close_source(&mut self);

    fn get_fd(&self) -> Fd {
        let Some(pipe) = self.source() else { return Fd::invalid() };
        pipe.get_fd()
    }

    fn has_ref(&self) -> bool {
        if self.is_done() {
            return false;
        }
        if let Some(pipe) = self.source() {
            return pipe.has_ref();
        }
        false
    }

    fn enable_keeping_process_alive<E>(&mut self, event_loop: E) {
        self.update_ref(event_loop, true);
    }

    fn disable_keeping_process_alive<E>(&mut self, event_loop: E) {
        self.update_ref(event_loop, false);
    }

    fn close(&mut self) {
        self.set_is_done(true);
        let Some(source) = self.source_mut().take() else { return };
        // Check for in-flight file write before detaching. detach()
        // nulls fs.data so onFsWriteComplete can't recover the writer
        // to call deref(). We must balance processSend's ref() here.
        let has_inflight_write = if Self::HAS_CURRENT_PAYLOAD {
            match &source {
                Source::SyncFile(file) | Source::File(file) => {
                    file.state == crate::source::FileState::Operating
                        || file.state == crate::source::FileState::Canceling
                }
                _ => false,
            }
        } else {
            false
        };
        match source {
            Source::SyncFile(file) | Source::File(file) => {
                // Use state machine to handle close after operation completes
                if self.owns_fd() {
                    file.detach();
                } else {
                    // Don't own fd, just stop operations and detach parent
                    file.stop();
                    file.fs.data = core::ptr::null_mut();
                }
            }
            Source::Pipe(pipe) => {
                // SAFETY: pipe is heap-allocated by Source::open; freed in on_pipe_close.
                unsafe { (*pipe).data = pipe as *mut c_void };
                // SAFETY: pipe is a live uv handle; libuv calls on_pipe_close after close completes.
                unsafe { (*pipe).close(on_pipe_close) };
            }
            Source::Tty(tty) => {
                // SAFETY: tty is heap-allocated by Source::open; freed in on_tty_close.
                unsafe { (*tty).data = tty as *mut c_void };
                // SAFETY: tty is a live uv handle; libuv calls on_tty_close after close completes.
                unsafe { (*tty).close(on_tty_close) };
            }
        }
        *self.source_mut() = None;
        self.on_close_source();
        // Deref last — this may free the parent and `self`.
        if has_inflight_write {
            // SAFETY: parent BACKREF valid until deref drops it.
            unsafe { (*self.parent_ptr()).deref() };
        }
    }

    fn update_ref<E>(&mut self, _event_loop: E, value: bool) {
        if let Some(pipe) = self.source() {
            if value {
                pipe.ref_();
            } else {
                pipe.unref();
            }
        }
    }

    fn set_parent(&mut self, parent: *mut Self::Parent) {
        self.set_parent_ptr(parent);
        if !self.is_done() {
            if let Some(pipe) = self.source() {
                pipe.set_data(self as *mut Self as *mut c_void);
            }
        }
    }

    fn watch(&mut self) {
        // no-op
    }

    fn start_with_pipe(&mut self, pipe: *mut uv::Pipe) -> sys::Result<()> {
        debug_assert!(self.source().is_none());
        *self.source_mut() = Some(Source::Pipe(pipe));
        let p = self.parent_ptr();
        self.set_parent(p);
        self.start_with_current_pipe()
    }

    fn start_sync(&mut self, fd: Fd, _pollable: bool) -> sys::Result<()> {
        debug_assert!(self.source().is_none());
        let source = Source::SyncFile(Source::open_file(fd));
        source.set_data(self as *mut Self as *mut c_void);
        *self.source_mut() = Some(source);
        let p = self.parent_ptr();
        self.set_parent(p);
        self.start_with_current_pipe()
    }

    fn start_with_file(&mut self, fd: Fd) -> sys::Result<()> {
        debug_assert!(self.source().is_none());
        let source = Source::File(Source::open_file(fd));
        source.set_data(self as *mut Self as *mut c_void);
        *self.source_mut() = Some(source);
        let p = self.parent_ptr();
        self.set_parent(p);
        self.start_with_current_pipe()
    }

    /// Zig accepts `bun.FD` or `*bun.MovableIfWindowsFd`.
    // TODO(port): MovableIfWindowsFd overload — Phase B add a separate start_movable().
    fn start(&mut self, rawfd: Fd, _pollable: bool) -> sys::Result<()> {
        let fd = rawfd;
        debug_assert!(self.source().is_none());
        // Use the event loop from the parent, not the global one
        // This is critical for spawnSync to use its isolated loop
        // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
        let loop_ = unsafe { (*self.parent_ptr()).loop_() };
        let source = match Source::open(loop_, fd) {
            sys::Result::Ok(source) => source,
            sys::Result::Err(err) => return sys::Result::Err(err),
        };
        // Creating a uv_pipe/uv_tty takes ownership of the file descriptor
        // TODO: Change the type of the parameter and update all places to
        //       use MovableFD
        // TODO(port): Zig branch `if (source is pipe|tty) and FDType == *MovableIfWindowsFd { rawfd.take() }`
        // dropped — Phase B handles via the MovableFd overload.
        let _ = matches!(source, Source::Pipe(_) | Source::Tty(_));
        source.set_data(self as *mut Self as *mut c_void);
        *self.source_mut() = Some(source);
        let p = self.parent_ptr();
        self.set_parent(p);
        self.start_with_current_pipe()
    }

    fn set_pipe(&mut self, pipe: *mut uv::Pipe) {
        *self.source_mut() = Some(Source::Pipe(pipe));
        let p = self.parent_ptr();
        self.set_parent(p);
    }

    fn get_stream(&self) -> Option<*mut uv::uv_stream_t> {
        let source = self.source().as_ref()?;
        if matches!(source, Source::File(_)) {
            return None;
        }
        Some(source.to_stream())
    }
}

extern "C" fn on_pipe_close(handle: *mut uv::Pipe) {
    // SAFETY: handle.data was set to the boxed Pipe ptr in close().
    let this = unsafe { (*handle).data as *mut uv::Pipe };
    drop(unsafe { Box::from_raw(this) });
}

extern "C" fn on_tty_close(handle: *mut uv::uv_tty_t) {
    // SAFETY: handle.data was set to the boxed tty ptr in close().
    let this = unsafe { (*handle).data as *mut uv::uv_tty_t };
    drop(unsafe { Box::from_raw(this) });
}

/// Common parent requirements for Windows writers (event loop access + ref counting).
pub trait WindowsWriterParent {
    fn loop_(&self) -> *mut uv::Loop;
    fn ref_(&self);
    fn deref(&self);
}

// ──────────────────────────────────────────────────────────────────────────
// WindowsBufferedWriter
// ──────────────────────────────────────────────────────────────────────────

/// Function table for `WindowsBufferedWriter`.
pub trait WindowsBufferedWriterParent: WindowsWriterParent {
    fn on_write(&mut self, amount: usize, status: WriteStatus);
    fn on_error(&mut self, err: sys::Error);
    const HAS_ON_CLOSE: bool;
    fn on_close(&mut self) {}
    fn get_buffer(&self) -> &[u8];
    const HAS_ON_WRITABLE: bool;
    fn on_writable(&mut self) {}
}

pub struct WindowsBufferedWriter<Parent: WindowsBufferedWriterParent> {
    pub source: Option<Source>,
    pub owns_fd: bool,
    pub parent: *mut Parent,
    pub is_done: bool,
    // we use only one write_req, any queued data in outgoing will be flushed after this ends
    pub write_req: uv::uv_write_t,
    pub write_buffer: uv::uv_buf_t,
    pub pending_payload_size: usize,
}

impl<Parent: WindowsBufferedWriterParent> Default for WindowsBufferedWriter<Parent> {
    fn default() -> Self {
        Self {
            source: None,
            owns_fd: true,
            parent: core::ptr::null_mut(), // Zig: undefined
            is_done: false,
            // SAFETY: all-zero is a valid uv_write_t (Zig: std.mem.zeroes)
            write_req: unsafe { mem::zeroed() },
            write_buffer: uv::uv_buf_t::init(b""),
            pending_payload_size: 0,
        }
    }
}

impl<Parent: WindowsBufferedWriterParent> BaseWindowsPipeWriter for WindowsBufferedWriter<Parent> {
    type Parent = Parent;
    const HAS_CURRENT_PAYLOAD: bool = false;

    fn source(&self) -> &Option<Source> { &self.source }
    fn source_mut(&mut self) -> &mut Option<Source> { &mut self.source }
    fn parent_ptr(&self) -> *mut Parent { self.parent }
    fn set_parent_ptr(&mut self, p: *mut Parent) { self.parent = p; }
    fn is_done(&self) -> bool { self.is_done }
    fn set_is_done(&mut self, v: bool) { self.is_done = v; }
    fn owns_fd(&self) -> bool { self.owns_fd }

    fn on_close_source(&mut self) {
        if Parent::HAS_ON_CLOSE {
            // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
            unsafe { (*self.parent).on_close() };
        }
    }

    fn start_with_current_pipe(&mut self) -> sys::Result<()> {
        debug_assert!(self.source.is_some());
        self.is_done = false;
        self.write();
        sys::Result::Ok(())
    }
}

impl<Parent: WindowsBufferedWriterParent> WindowsBufferedWriter<Parent> {
    #[inline]
    fn parent(&self) -> &mut Parent {
        // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
        unsafe { &mut *self.parent }
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.write_buffer.len as usize
    }

    fn on_write_complete(&mut self, status: uv::ReturnCode) {
        let written = self.pending_payload_size;
        self.pending_payload_size = 0;
        if let Some(err) = status.to_error(uv::SyscallTag::Write) {
            self.close();
            self.parent().on_error(err);
            return;
        }
        let pending = self.get_buffer_internal();
        let has_pending_data = (pending.len() - written) != 0;
        self.parent().on_write(
            written,
            if self.is_done && !has_pending_data { WriteStatus::Drained } else { WriteStatus::Pending },
        );
        // is_done can be changed inside on_write
        if self.is_done && !has_pending_data {
            // already done and end was called
            self.close();
            return;
        }

        if Parent::HAS_ON_WRITABLE {
            self.parent().on_writable();
        }
    }

    extern "C" fn on_fs_write_complete(fs: *mut uv::fs_t) {
        let file = crate::source::File::from_fs(fs);
        // SAFETY: fs is a live uv_fs_t passed by libuv to this callback.
        let result = unsafe { (*fs).result };
        let was_canceled = result.int() == uv::UV_ECANCELED;
        // SAFETY: fs is a live uv_fs_t passed by libuv to this callback.
        let parent_ptr = unsafe { (*fs).data };

        // ALWAYS complete first
        file.complete(was_canceled);

        // If detached, file may be closing (owned fd) or just stopped (non-owned fd)
        if parent_ptr.is_null() {
            return;
        }

        // SAFETY: data was set to *mut Self in write().
        let this = unsafe { &mut *(parent_ptr as *mut Self) };

        if was_canceled {
            // Canceled write - clear pending state
            this.pending_payload_size = 0;
            return;
        }

        if let Some(err) = result.to_error(uv::SyscallTag::Write) {
            this.close();
            this.parent().on_error(err);
            return;
        }

        this.on_write_complete(uv::ReturnCode::zero());
    }

    pub fn write(&mut self) {
        let buffer = self.get_buffer_internal();
        // if we are already done or if we have some pending payload we just wait until next write
        if self.is_done || self.pending_payload_size > 0 || buffer.len() == 0 {
            return;
        }

        // PORT NOTE: reshaped for borrowck — capture ptr/len before mutating self.
        // TODO(port): raw-ptr borrowck escape — restructure in Phase B.
        let buffer_ptr = buffer.as_ptr();
        let buffer_len = buffer.len();
        // SAFETY: buffer points into get_buffer_internal()'s storage which is not
        // reallocated below (only handed to libuv via uv_buf_t / write_req).
        let buffer = unsafe { core::slice::from_raw_parts(buffer_ptr, buffer_len) };

        let Some(pipe) = &self.source else { return };
        match pipe {
            Source::SyncFile(_) => {
                panic!("This code path shouldn't be reached - sync_file in PipeWriter.zig");
            }
            Source::File(file) => {
                // BufferedWriter ensures pending_payload_size blocks concurrent writes
                debug_assert!(file.can_start());

                self.pending_payload_size = buffer_len;
                file.fs.set_data(self as *mut Self as *mut c_void);
                file.prepare();
                self.write_buffer = uv::uv_buf_t::init(buffer);

                if let Some(err) = uv::uv_fs_write(
                    self.parent().loop_(),
                    &mut file.fs,
                    file.file,
                    &self.write_buffer as *const _,
                    1,
                    -1,
                    Self::on_fs_write_complete,
                )
                .to_error(uv::SyscallTag::Write)
                {
                    file.complete(false);
                    self.close();
                    self.parent().on_error(err);
                }
            }
            _ => {
                // the buffered version should always have a stable ptr
                self.pending_payload_size = buffer_len;
                self.write_buffer = uv::uv_buf_t::init(buffer);
                if let Some(write_err) = self
                    .write_req
                    .write(pipe.to_stream(), &self.write_buffer, self, Self::on_write_complete)
                    .as_err()
                {
                    self.close();
                    self.parent().on_error(write_err);
                }
            }
        }
    }

    fn get_buffer_internal(&self) -> &[u8] {
        self.parent().get_buffer()
    }

    pub fn end(&mut self) {
        if self.is_done {
            return;
        }

        self.is_done = true;
        if self.pending_payload_size == 0 {
            // will auto close when pending stuff get written
            self.close();
        }
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

    pub fn maybe_shrink(&mut self) {
        // TODO(port): std.heap.pageSize() — using 4096; Phase B: query actual page size.
        let page = 4096usize;
        if self.list.capacity() > page {
            // workaround insane zig decision to make it undefined behavior to resize .len < .capacity
            // PORT NOTE: Rust shrink_to handles len<cap correctly; expandToCapacity() unneeded.
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
        self.list.extend_from_slice(buffer);
        Ok(())
    }

    pub fn wrote(&mut self, amount: usize) {
        self.cursor += amount;
    }

    pub fn write_assume_capacity(&mut self, buffer: &[u8]) {
        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
        self.list.extend_from_slice(buffer);
    }

    pub fn ensure_unused_capacity(&mut self, capacity: usize) -> Result<(), OOM> {
        self.list.reserve(capacity);
        Ok(())
    }

    pub fn write_type_as_bytes<T>(&mut self, data: &T) -> Result<(), OOM> {
        // SAFETY: caller passes POD T (matches Zig std.mem.asBytes contract).
        let bytes = unsafe {
            core::slice::from_raw_parts(data as *const T as *const u8, mem::size_of::<T>())
        };
        self.write(bytes)
    }

    pub fn write_type_as_bytes_assume_capacity<T>(&mut self, data: T) {
        // TODO(port): Zig round-trips through bun.ByteList here; Rust just writes bytes.
        // SAFETY: caller passes POD T.
        let bytes = unsafe {
            core::slice::from_raw_parts(&data as *const T as *const u8, mem::size_of::<T>())
        };
        // PERF(port): was assume_capacity
        self.list.extend_from_slice(bytes);
    }

    /// Zig: `writeOrFallback(buffer: anytype, comptime writeFn: anytype)` —
    /// dispatched on fn-pointer identity at comptime. In Rust we use an enum tag.
    pub fn write_or_fallback<'a>(
        &'a mut self,
        buffer_u8: Option<&'a [u8]>,
        buffer_u16: Option<&[u16]>,
        kind: WriteKind,
    ) -> Result<&'a [u8], OOM> {
        // TODO(port): comptime fn-ptr identity dispatch → enum tag; Phase B unify with write_internal.
        match kind {
            WriteKind::Latin1 => {
                let buffer = buffer_u8.unwrap();
                if bun_str::strings::is_all_ascii(buffer) {
                    return Ok(buffer);
                }
                {
                    let mut byte_list = BabyList::<u8>::move_from_vec(&mut self.list);
                    let _g = scopeguard::guard((), |_| self.list = byte_list.move_to_vec());
                    byte_list.write_latin1(buffer)?;
                    // TODO(port): scopeguard borrow — Phase B reshape (Zig defer pattern).
                }
                Ok(&self.list[self.cursor..])
            }
            WriteKind::Utf16 => {
                let buffer = buffer_u16.unwrap();
                {
                    let mut byte_list = BabyList::<u8>::move_from_vec(&mut self.list);
                    let _g = scopeguard::guard((), |_| self.list = byte_list.move_to_vec());
                    byte_list.write_utf16(buffer)?;
                }
                Ok(&self.list[self.cursor..])
            }
            WriteKind::Bytes => Ok(buffer_u8.unwrap()),
        }
    }

    pub fn write_latin1<const CHECK_ASCII: bool>(&mut self, buffer: &[u8]) -> Result<(), OOM> {
        if CHECK_ASCII {
            if bun_str::strings::is_all_ascii(buffer) {
                return self.write(buffer);
            }
        }

        let mut byte_list = BabyList::<u8>::move_from_vec(&mut self.list);
        let r = byte_list.write_latin1(buffer);
        self.list = byte_list.move_to_vec();
        r.map(|_| ())
    }

    pub fn write_utf16(&mut self, buffer: &[u16]) -> Result<(), OOM> {
        let mut byte_list = BabyList::<u8>::move_from_vec(&mut self.list);
        let r = byte_list.write_utf16(buffer);
        self.list = byte_list.move_to_vec();
        r.map(|_| ())
    }

    pub fn slice(&self) -> &[u8] {
        &self.list[self.cursor..]
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum WriteKind {
    Bytes,
    Latin1,
    Utf16,
}

// ──────────────────────────────────────────────────────────────────────────
// WindowsStreamingWriter
// ──────────────────────────────────────────────────────────────────────────

/// Function table for `WindowsStreamingWriter`.
pub trait WindowsStreamingWriterParent: WindowsWriterParent {
    /// reports the amount written and done means that we dont have any
    /// other pending data to send (but we may send more data)
    fn on_write(&mut self, amount: usize, status: WriteStatus);
    fn on_error(&mut self, err: sys::Error);
    const HAS_ON_WRITABLE: bool;
    fn on_writable(&mut self) {}
    fn on_close(&mut self);
}

pub struct WindowsStreamingWriter<Parent: WindowsStreamingWriterParent> {
    pub source: Option<Source>,
    /// if the source of this writer is a file descriptor, calling end() will not close it.
    /// if it is a path, then we claim ownership and the backing fd will be closed by end().
    pub owns_fd: bool,
    pub parent: *mut Parent,
    pub is_done: bool,
    // we use only one write_req, any queued data in outgoing will be flushed after this ends
    pub write_req: uv::uv_write_t,
    pub write_buffer: uv::uv_buf_t,

    // queue any data that we want to write here
    pub outgoing: StreamBuffer,
    // libuv requires a stable ptr when doing async so we swap buffers
    pub current_payload: StreamBuffer,
    // we preserve the last write result for simplicity
    pub last_write_result: WriteResult,
    // some error happed? we will not report onClose only onError
    pub closed_without_reporting: bool,
}

impl<Parent: WindowsStreamingWriterParent> Default for WindowsStreamingWriter<Parent> {
    fn default() -> Self {
        Self {
            source: None,
            owns_fd: true,
            parent: core::ptr::null_mut(), // Zig: undefined
            is_done: false,
            // SAFETY: all-zero is a valid uv_write_t (Zig: std.mem.zeroes)
            write_req: unsafe { mem::zeroed() },
            write_buffer: uv::uv_buf_t::init(b""),
            outgoing: StreamBuffer::default(),
            current_payload: StreamBuffer::default(),
            last_write_result: WriteResult::Wrote(0),
            closed_without_reporting: false,
        }
    }
}

impl<Parent: WindowsStreamingWriterParent> BaseWindowsPipeWriter for WindowsStreamingWriter<Parent> {
    type Parent = Parent;
    const HAS_CURRENT_PAYLOAD: bool = true;

    fn source(&self) -> &Option<Source> { &self.source }
    fn source_mut(&mut self) -> &mut Option<Source> { &mut self.source }
    fn parent_ptr(&self) -> *mut Parent { self.parent }
    fn set_parent_ptr(&mut self, p: *mut Parent) { self.parent = p; }
    fn is_done(&self) -> bool { self.is_done }
    fn set_is_done(&mut self, v: bool) { self.is_done = v; }
    fn owns_fd(&self) -> bool { self.owns_fd }

    fn on_close_source(&mut self) {
        self.source = None;
        if self.closed_without_reporting {
            self.closed_without_reporting = false;
            return;
        }
        // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
        unsafe { (*self.parent).on_close() };
    }

    fn start_with_current_pipe(&mut self) -> sys::Result<()> {
        debug_assert!(self.source.is_some());
        self.is_done = false;
        sys::Result::Ok(())
    }
}

impl<Parent: WindowsStreamingWriterParent> WindowsStreamingWriter<Parent> {
    #[inline]
    fn parent(&self) -> &mut Parent {
        // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
        unsafe { &mut *self.parent }
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.current_payload.memory_cost() + self.outgoing.memory_cost()
    }

    pub fn has_pending_data(&self) -> bool {
        self.outgoing.is_not_empty() || self.current_payload.is_not_empty()
    }

    fn is_done_internal(&self) -> bool {
        // done is flags and no more data queued? so we are done!
        self.is_done && !self.has_pending_data()
    }

    fn on_write_complete(&mut self, status: uv::ReturnCode) {
        // Deref the parent at the end to balance the ref taken in
        // process_send before submitting the async write request.
        // SAFETY: p is the BACKREF parent ptr; ref taken in process_send keeps it alive until this deref.
        let _g = scopeguard::guard(self.parent, |p| unsafe { (*p).deref() });

        if let Some(err) = status.to_error(uv::SyscallTag::Write) {
            self.last_write_result = WriteResult::Err(err);
            bun_output::scoped_log!(PipeWriter, "onWrite() = {}", err.name());

            self.parent().on_error(err);
            self.close_without_reporting();
            return;
        }

        // success means that we send all the data inside current_payload
        let written = self.current_payload.size();
        self.current_payload.reset();

        // if we dont have more outgoing data we report done in onWrite
        let done = self.outgoing.is_empty();
        let was_done = self.is_done;

        bun_output::scoped_log!(PipeWriter, "onWrite({}) ({} left)", written, self.outgoing.size());

        if was_done && done {
            // we already call .end lets close the connection
            self.last_write_result = WriteResult::Done(written);
            self.parent().on_write(written, WriteStatus::EndOfFile);
            return;
        }
        // .end was not called yet
        self.last_write_result = WriteResult::Wrote(written);

        // report data written
        self.parent()
            .on_write(written, if done { WriteStatus::Drained } else { WriteStatus::Pending });

        // process pending outgoing data if any
        self.process_send();

        // TODO: should we report writable?
        if Parent::HAS_ON_WRITABLE {
            self.parent().on_writable();
        }
    }

    extern "C" fn on_fs_write_complete(fs: *mut uv::fs_t) {
        let file = crate::source::File::from_fs(fs);
        // SAFETY: fs is a live uv_fs_t passed by libuv to this callback.
        let result = unsafe { (*fs).result };
        let was_canceled = result.int() == uv::UV_ECANCELED;
        // SAFETY: fs is a live uv_fs_t passed by libuv to this callback.
        let parent_ptr = unsafe { (*fs).data };

        // ALWAYS complete first
        file.complete(was_canceled);

        // If detached, file may be closing (owned fd) or just stopped (non-owned fd).
        // The deref to balance processSend's ref was already done in close().
        if parent_ptr.is_null() {
            return;
        }

        // SAFETY: data was set to *mut Self in process_send().
        let this = unsafe { &mut *(parent_ptr as *mut Self) };

        if was_canceled {
            // Canceled write - reset buffers and deref to balance process_send ref
            this.current_payload.reset();
            // SAFETY: parent is BACKREF; ref taken in process_send keeps it alive until this deref.
            unsafe { (*this.parent).deref() };
            return;
        }

        if let Some(err) = result.to_error(uv::SyscallTag::Write) {
            // deref to balance process_send ref
            // SAFETY: p is the BACKREF parent ptr; ref taken in process_send keeps it alive until this deref.
            let _g = scopeguard::guard(this.parent, |p| unsafe { (*p).deref() });
            this.close();
            this.parent().on_error(err);
            return;
        }

        // on_write_complete handles the deref
        this.on_write_complete(uv::ReturnCode::zero());
    }

    /// this tries to send more data returning if we are writable or not after this
    fn process_send(&mut self) {
        bun_output::scoped_log!(PipeWriter, "processSend");
        if self.current_payload.is_not_empty() {
            // we have some pending async request, the next outgoing data will be processed after this finish
            self.last_write_result = WriteResult::Pending(0);
            return;
        }

        let bytes_len = self.outgoing.slice().len();
        // nothing todo (we assume we are writable until we try to write something)
        if bytes_len == 0 {
            self.last_write_result = WriteResult::Wrote(0);
            return;
        }

        let Some(pipe) = &self.source else {
            let err = sys::Error::from_code(sys::E::PIPE, sys::SyscallTag::Pipe);
            self.last_write_result = WriteResult::Err(err);
            self.parent().on_error(err);
            self.close_without_reporting();
            return;
        };

        // current payload is empty we can just swap with outgoing
        mem::swap(&mut self.current_payload, &mut self.outgoing);
        // PORT NOTE: reshaped for borrowck — re-read bytes from current_payload (post-swap).
        // TODO(port): raw-ptr borrowck escape — restructure in Phase B.
        let bytes_ptr = self.current_payload.slice().as_ptr();
        // SAFETY: current_payload storage is not reallocated until on_write_complete resets it;
        // libuv reads via uv_buf_t which holds this same ptr/len.
        let bytes = unsafe { core::slice::from_raw_parts(bytes_ptr, bytes_len) };

        match pipe {
            Source::SyncFile(_) => {
                panic!("sync_file pipe write should not be reachable");
            }
            Source::File(file) => {
                // StreamingWriter ensures current_payload blocks concurrent writes
                debug_assert!(file.can_start());

                file.fs.set_data(self as *mut Self as *mut c_void);
                file.prepare();
                self.write_buffer = uv::uv_buf_t::init(bytes);

                if let Some(err) = uv::uv_fs_write(
                    self.parent().loop_(),
                    &mut file.fs,
                    file.file,
                    &self.write_buffer as *const _,
                    1,
                    -1,
                    Self::on_fs_write_complete,
                )
                .to_error(uv::SyscallTag::Write)
                {
                    file.complete(false);
                    self.last_write_result = WriteResult::Err(err);
                    self.parent().on_error(err);
                    self.close_without_reporting();
                    return;
                }
            }
            _ => {
                // enqueue the write
                self.write_buffer = uv::uv_buf_t::init(bytes);
                if let Some(err) = self
                    .write_req
                    .write(pipe.to_stream(), &self.write_buffer, self, Self::on_write_complete)
                    .as_err()
                {
                    self.last_write_result = WriteResult::Err(err);
                    self.parent().on_error(err);
                    self.close_without_reporting();
                    return;
                }
            }
        }
        // Ref the parent to prevent it from being freed while the async
        // write is in flight. The matching deref is in on_write_complete
        // or on_fs_write_complete.
        // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
        unsafe { (*self.parent).ref_() };
        self.last_write_result = WriteResult::Pending(0);
    }

    fn close_without_reporting(&mut self) {
        if self.get_fd() != Fd::invalid() {
            debug_assert!(!self.closed_without_reporting);
            self.closed_without_reporting = true;
            self.close();
        }
    }

    fn write_internal_u8(&mut self, buffer: &[u8], kind: WriteKind) -> WriteResult {
        // TODO(port): Zig used `comptime writeFn: anytype` (fn-ptr identity);
        // Rust splits into u8/u16 paths via WriteKind enum.
        if self.is_done {
            return WriteResult::Done(0);
        }

        if matches!(self.source, Some(Source::SyncFile(_))) {
            let result = (|| {
                let remain = match self.outgoing.write_or_fallback(Some(buffer), None, kind) {
                    Ok(r) => r,
                    Err(_) => return WriteResult::Err(sys::Error::oom()),
                };
                let initial_len = remain.len();
                let mut remain = remain;
                let fd = Fd::from_uv(match &self.source {
                    Some(Source::SyncFile(f)) => f.file,
                    _ => unreachable!(),
                });

                while remain.len() > 0 {
                    match fd.write(remain) {
                        sys::Result::Err(err) => return WriteResult::Err(err),
                        sys::Result::Ok(wrote) => {
                            remain = &remain[wrote..];
                            if wrote == 0 {
                                break;
                            }
                        }
                    }
                }

                let wrote = initial_len - remain.len();
                if wrote == 0 {
                    return WriteResult::Done(wrote);
                }
                WriteResult::Wrote(wrote)
            })();
            self.outgoing.reset();
            return result;
        }

        let had_buffered_data = self.outgoing.is_not_empty();
        let r = match kind {
            WriteKind::Latin1 => self.outgoing.write_latin1::<true>(buffer),
            WriteKind::Bytes => self.outgoing.write(buffer),
            WriteKind::Utf16 => unreachable!(),
        };
        if r.is_err() {
            return WriteResult::Err(sys::Error::oom());
        }
        if had_buffered_data {
            return WriteResult::Pending(0);
        }
        self.process_send();
        self.last_write_result
    }

    fn write_internal_u16(&mut self, buffer: &[u16]) -> WriteResult {
        if self.is_done {
            return WriteResult::Done(0);
        }

        if matches!(self.source, Some(Source::SyncFile(_))) {
            let result = (|| {
                let remain = match self.outgoing.write_or_fallback(None, Some(buffer), WriteKind::Utf16) {
                    Ok(r) => r,
                    Err(_) => return WriteResult::Err(sys::Error::oom()),
                };
                let initial_len = remain.len();
                let mut remain = remain;
                let fd = Fd::from_uv(match &self.source {
                    Some(Source::SyncFile(f)) => f.file,
                    _ => unreachable!(),
                });

                while remain.len() > 0 {
                    match fd.write(remain) {
                        sys::Result::Err(err) => return WriteResult::Err(err),
                        sys::Result::Ok(wrote) => {
                            remain = &remain[wrote..];
                            if wrote == 0 {
                                break;
                            }
                        }
                    }
                }

                let wrote = initial_len - remain.len();
                if wrote == 0 {
                    return WriteResult::Done(wrote);
                }
                WriteResult::Wrote(wrote)
            })();
            self.outgoing.reset();
            return result;
        }

        let had_buffered_data = self.outgoing.is_not_empty();
        if self.outgoing.write_utf16(buffer).is_err() {
            return WriteResult::Err(sys::Error::oom());
        }
        if had_buffered_data {
            return WriteResult::Pending(0);
        }
        self.process_send();
        self.last_write_result
    }

    pub fn write_utf16(&mut self, buf: &[u16]) -> WriteResult {
        self.write_internal_u16(buf)
    }

    pub fn write_latin1(&mut self, buffer: &[u8]) -> WriteResult {
        self.write_internal_u8(buffer, WriteKind::Latin1)
    }

    pub fn write(&mut self, buffer: &[u8]) -> WriteResult {
        self.write_internal_u8(buffer, WriteKind::Bytes)
    }

    pub fn flush(&mut self) -> WriteResult {
        if self.is_done {
            return WriteResult::Done(0);
        }
        if !self.has_pending_data() {
            return WriteResult::Wrote(0);
        }

        self.process_send();
        self.last_write_result
    }

    pub fn end(&mut self) {
        if self.is_done {
            return;
        }

        self.closed_without_reporting = false;
        self.is_done = true;

        if !self.has_pending_data() {
            if !self.owns_fd {
                return;
            }
            self.close();
        }
    }
}

impl<Parent: WindowsStreamingWriterParent> Drop for WindowsStreamingWriter<Parent> {
    fn drop(&mut self) {
        // Close the pipe first to cancel any in-flight writes before
        // freeing the buffers they reference.
        self.close_without_reporting();
        // outgoing & current_payload dropped automatically
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Platform aliases
// ──────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
pub type BufferedWriter<P> = PosixBufferedWriter<P>;
#[cfg(not(unix))]
pub type BufferedWriter<P> = WindowsBufferedWriter<P>;

#[cfg(unix)]
pub type StreamingWriter<P> = PosixStreamingWriter<P>;
#[cfg(not(unix))]
pub type StreamingWriter<P> = WindowsStreamingWriter<P>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/io/PipeWriter.zig (1576 lines)
//   confidence: medium
//   todos:      17
//   notes:      comptime vtable+mixin pattern → traits; heavy borrowck reshaping around self-referential buffers (raw-ptr escapes flagged for Phase B restructure); writeInternal/writeOrFallback fn-ptr-identity dispatch reworked to WriteKind enum; MovableIfWindowsFd overloads stubbed
// ──────────────────────────────────────────────────────────────────────────
