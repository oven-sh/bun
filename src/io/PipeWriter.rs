use core::ffi::c_void;
use core::mem;

use bun_collections::{ByteVecExt, VecExt};
use bun_core::OOM;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(windows)]
// `close`/`set_data`/`ref_` are default trait methods; bring traits into scope
// so method resolution finds them on `Pipe`/`uv_tty_t`/`fs_t`.
use bun_sys::windows::libuv::{UvHandle as _, UvReq as _, UvStream as _};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
use bun_sys::{self as sys, Fd};

use crate::{EventLoopHandle, FilePollRef, Owner, PollTag, FilePollFlag, FilePollKind};

use crate::pipes::{FileType, PollOrFd};
#[cfg(windows)]
use crate::source::Source;

bun_core::declare_scope!(PipeWriter, hidden);
macro_rules! log {
    ($($args:tt)*) => { bun_core::scoped_log!(PipeWriter, $($args)*) };
}

// TODO(b2-blocked): bun_sys::Error::oom — `oom()` is a private free fn in
// `bun_sys::error`; promote to assoc fn or re-export, then drop this shim.
#[inline]
fn oom_err() -> sys::Error {
    sys::Error::from_code(sys::E::ENOMEM, sys::Tag::write)
}

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
        log!("onPoll({})", buffer_len);
        if buffer_len == 0 && !received_hup {
            let self_addr = std::ptr::from_ref(self).cast::<()>() as usize;
            log!(
                "PosixPipeWriter(0x{:x}) handle={}",
                self_addr,
                self.handle().tag_name()
            );
            if let PollOrFd::Poll(poll) = self.handle() {
                log!(
                    "PosixPipeWriter(0x{:x}) got 0, registered state = {}",
                    self_addr,
                    poll.is_registered()
                );
            }
            return;
        }

        let max_write = if size_hint > 0 && self.get_file_type().is_blocking() {
            usize::try_from(size_hint).expect("int cast")
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

    match bun_core::is_writable(fd) {
        bun_core::Pollable::Ready | bun_core::Pollable::Hup => sys::write(fd, buf),
        bun_core::Pollable::NotReady => sys::Result::Err(sys::Error::retry()),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PosixBufferedWriter
// ──────────────────────────────────────────────────────────────────────────

/// Function table for `PosixBufferedWriter`. In Zig this was `function_table: anytype`;
/// in many cases the function table can be the same as `Parent`.
///
/// All methods take `*mut Self` (not `&mut self`) because the writer is an
/// intrusive *field of* the parent — see PipeWriter.zig `parent: *Parent`.
/// Materializing `&mut Parent` while a `&mut writer` is live would alias under
/// Stacked Borrows. Zig's `*Parent` freely aliases; we mirror that with raw
/// pointers and never form a `&mut Parent` inside the writer.
pub trait PosixBufferedWriterParent {
    /// `bun_io::poll_tag` constant for this writer's `FilePoll` owner. The
    /// per-tag dispatch in `bun_runtime::dispatch::__bun_run_file_poll`
    /// recovers `*mut PosixBufferedWriter<Self>` from this. Zig derived the
    /// tag from `@TypeOf` (TaggedPointerUnion); Rust threads it explicitly.
    const POLL_OWNER_TAG: PollTag;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_error(this: *mut Self, err: sys::Error);
    const HAS_ON_CLOSE: bool;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_close(_this: *mut Self) {}
    /// # Safety
    /// `this` must point to a live `Self`; returned slice borrows from it.
    unsafe fn get_buffer<'a>(this: *mut Self) -> &'a [u8];
    const HAS_ON_WRITABLE: bool;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_writable(_this: *mut Self) {}
    // TODO(port): Zig calls `parent.eventLoop()` (returns anytype). Phase B: pin concrete type.
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn event_loop(this: *mut Self) -> EventLoopHandle;
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
        // Raw-ptr dispatch — no `&Parent` materialized.
        unsafe { Parent::get_buffer(self.parent) }
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
    /// Raw backref to the owning `Parent`. Returned as `*mut` (never `&mut`)
    /// because this writer is an intrusive field of `Parent` and a `&mut Parent`
    /// would alias the live `&mut self` under Stacked Borrows. All vtable
    /// dispatch goes through `Parent::method(ptr, ..)` which takes `*mut Self`.
    #[inline]
    fn parent(&self) -> *mut Parent {
        self.parent
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>()
    }

    pub fn create_poll(&mut self, fd: Fd) -> FilePollRef {
        FilePollRef::init(// SAFETY: parent BACKREF set via set_parent; outlives this writer.
            unsafe { Parent::event_loop(self.parent()) }, fd, Owner::new(Parent::POLL_OWNER_TAG, std::ptr::from_mut(self).cast()))
    }

    pub fn get_poll(&self) -> Option<FilePollRef> {
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

        // SAFETY: parent BACKREF set via set_parent; outlives this writer.
        unsafe { Parent::on_error(self.parent(), err) };

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
        unsafe { Parent::on_write(parent, written, status) };
        if status == WriteStatus::EndOfFile && !was_done {
            self.close();
        }
    }

    fn _on_writable(&mut self) {
        if self.is_done {
            return;
        }

        if Parent::HAS_ON_WRITABLE {
            // SAFETY: parent BACKREF set via set_parent; outlives this writer.
            unsafe { Parent::on_writable(self.parent()) };
        }
    }

    pub fn register_poll(&mut self) {
        let Some(poll) = self.get_poll() else { return };
        // Use the event loop from the parent, not the global one
        // SAFETY: parent BACKREF set via set_parent; outlives this writer.
        let loop_ = unsafe { Parent::event_loop(self.parent()) }.loop_();
        match poll.register_with_fd(loop_, FilePollKind::Writable, poll.fd()) {
            sys::Result::Err(err) => {
                // SAFETY: parent BACKREF valid.
                unsafe { Parent::on_error(self.parent(), err) };
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

    pub fn enable_keeping_process_alive(&self, event_loop: EventLoopHandle) {
        self.update_ref(event_loop, true);
    }

    pub fn disable_keeping_process_alive(&self, event_loop: EventLoopHandle) {
        self.update_ref(event_loop, false);
    }

    fn get_buffer_internal(&self) -> &[u8] {
        // SAFETY: parent is a BACKREF set via set_parent; valid while writer is
        // alive. Raw-ptr dispatch — no `&Parent` materialized.
        unsafe { Parent::get_buffer(self.parent()) }
    }

    pub fn end(&mut self) {
        if self.is_done {
            return;
        }

        self.is_done = true;
        self.close();
    }

    fn close_without_reporting(&mut self) {
        if self.get_fd() != Fd::INVALID {
            debug_assert!(!self.closed_without_reporting);
            self.closed_without_reporting = true;
            if self.close_fd {
                self.handle.close(None, None::<fn(*mut c_void)>);
            }
        }
    }

    pub fn close(&mut self) {
        if Parent::HAS_ON_CLOSE {
            if self.closed_without_reporting {
                self.closed_without_reporting = false;
                // SAFETY: parent BACKREF valid.
                unsafe { Parent::on_close(self.parent()) };
            } else {
                let parent = self.parent;
                self.handle.close_impl(
                    Some(parent.cast()),
                    // SAFETY: parent was set via set_parent with a *mut Parent.
                    Some(|ctx: *mut c_void| unsafe { Parent::on_close(ctx.cast::<Parent>()) }),
                    self.close_fd,
                );
            }
        }
    }

    pub fn update_ref(&self, event_loop: EventLoopHandle, value: bool) {
        let Some(poll) = self.get_poll() else { return };
        poll.set_keeping_process_alive(event_loop, value);
    }

    pub fn set_parent(&mut self, parent: *mut Parent) {
        self.parent = parent;
        // PORT NOTE: reshaped for borrowck — capture *mut Self before borrowing field.
        let owner = std::ptr::from_mut(self).cast::<c_void>();
        self.handle.set_owner(Owner::new(Parent::POLL_OWNER_TAG, owner.cast()));
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
                p
            }
        };
        // SAFETY: parent BACKREF set via set_parent; outlives this writer.
        let loop_ = unsafe { Parent::event_loop(self.parent()) }.loop_();

        match poll.register_with_fd(loop_, FilePollKind::Writable, fd) {
            sys::Result::Err(err) => {
                return sys::Result::Err(err);
            }
            sys::Result::Ok(()) => {
                // SAFETY: parent BACKREF valid.
                let event_loop = unsafe { Parent::event_loop(self.parent()) };
                self.enable_keeping_process_alive(event_loop);
            }
        }

        sys::Result::Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PosixStreamingWriter
// ──────────────────────────────────────────────────────────────────────────

/// Function table for `PosixStreamingWriter`.
/// All methods take `*mut Self` (not `&mut self`) because the writer is an
/// intrusive *field of* the parent — see PipeWriter.zig `parent: *Parent`.
/// Materializing `&mut Parent` while a `&mut writer` is live would alias under
/// Stacked Borrows. Zig's `*Parent` freely aliases; we mirror that with raw
/// pointers and never form a `&mut Parent` inside the writer.
pub trait PosixStreamingWriterParent {
    /// `bun_io::poll_tag` constant for this writer's `FilePoll` owner. The
    /// per-tag dispatch in `bun_runtime::dispatch::__bun_run_file_poll`
    /// recovers `*mut PosixStreamingWriter<Self>` from this. Zig derived the
    /// tag from `@TypeOf` (TaggedPointerUnion); Rust threads it explicitly.
    const POLL_OWNER_TAG: PollTag;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_error(this: *mut Self, err: sys::Error);
    const HAS_ON_READY: bool;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_ready(_this: *mut Self) {}
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_close(this: *mut Self);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn event_loop(this: *mut Self) -> EventLoopHandle;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn loop_(this: *mut Self) -> *mut bun_uws_sys::Loop;
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

    /// Raw backref to the owning `Parent`. Returned as `*mut` (never `&mut`)
    /// because this writer is an intrusive field of `Parent` and a `&mut Parent`
    /// would alias the live `&mut self` under Stacked Borrows. All vtable
    /// dispatch goes through `Parent::method(ptr, ..)` which takes `*mut Self`.
    #[inline]
    fn parent(&self) -> *mut Parent {
        self.parent
    }

    pub fn get_force_sync(&self) -> bool {
        self.force_sync
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.outgoing.memory_cost()
    }

    pub fn get_poll(&self) -> Option<FilePollRef> {
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

        // SAFETY: parent BACKREF set via set_parent; outlives this writer.
        unsafe { Parent::on_error(self.parent(), err) };
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

        // SAFETY: parent BACKREF set via set_parent; outlives this writer.
        unsafe { Parent::on_write(self.parent(), written, status) };
    }

    pub fn set_parent(&mut self, parent: *mut Parent) {
        self.parent = parent;
        // PORT NOTE: reshaped for borrowck — capture *mut Self before borrowing field.
        let owner = std::ptr::from_mut(self).cast::<c_void>();
        self.handle.set_owner(Owner::new(Parent::POLL_OWNER_TAG, owner.cast()));
    }

    fn _on_writable(&mut self) {
        if self.is_done || self.closed_without_reporting {
            return;
        }

        self.outgoing.reset();

        if Parent::HAS_ON_READY {
            // SAFETY: parent BACKREF set via set_parent; outlives this writer.
            unsafe { Parent::on_ready(self.parent()) };
        }
    }

    fn close_without_reporting(&mut self) {
        if self.get_fd() != Fd::INVALID {
            debug_assert!(!self.closed_without_reporting);
            self.closed_without_reporting = true;
            self.handle.close(None, None::<fn(*mut c_void)>);
        }
    }

    fn register_poll(&mut self) {
        let Some(poll) = self.get_poll() else { return };
        // SAFETY: parent BACKREF set via set_parent; outlives this writer.
        let loop_ = unsafe { Parent::loop_(self.parent()) }.cast();
        match poll.register_with_fd(loop_, FilePollKind::Writable, poll.fd()) {
            sys::Result::Err(err) => {
                // PORT_NOTES_PLAN R-2: `&mut self` carries LLVM `noalias`, but
                // `Parent::on_error` (e.g. `FileSink::on_error`) re-enters via
                // a fresh `&mut Self` from the parent's intrusive `writer`
                // field and may write `self.is_done` / `self.handle`.
                // ASM-verified PROVEN_CACHED on the `self.close()` path's
                // field reads. Launder so `close()` sees fresh state.
                let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
                // SAFETY: parent BACKREF valid; `this` aliases the live
                // `&mut self` and is the only mutable view used hereafter.
                unsafe { Parent::on_error((*this).parent(), err) };
                // SAFETY: `this` is still live (parent owns this writer; an
                // on_error handler may end/detach but never frees mid-call).
                unsafe { &mut *this }.close();
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
            return WriteResult::Err(oom_err());
        }

        let buf_len = self.outgoing.size() - before_len;

        self.maybe_write_newly_buffered_data(buf_len)
    }

    pub fn write_latin1(&mut self, buf: &[u8]) -> WriteResult {
        if self.is_done || self.closed_without_reporting {
            return WriteResult::Done(0);
        }

        if bun_core::strings::is_all_ascii(buf) {
            return self.write(buf);
        }

        let before_len = self.outgoing.size();

        const CHECK_ASCII: bool = false;
        if self.outgoing.write_latin1::<CHECK_ASCII>(buf).is_err() {
            return WriteResult::Err(oom_err());
        }

        let buf_len = self.outgoing.size() - before_len;

        self.maybe_write_newly_buffered_data(buf_len)
    }

    fn maybe_write_newly_buffered_data(&mut self, buf_len: usize) -> WriteResult {
        debug_assert!(!self.is_done);

        if self.should_buffer(0) {
            // SAFETY: parent BACKREF set via set_parent; outlives this writer.
            unsafe { Parent::on_write(self.parent(), buf_len, WriteStatus::Drained) };
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
                    // SAFETY: parent BACKREF valid.
                    unsafe { Parent::on_write(self.parent(), amt, WriteStatus::Drained) };
                } else {
                    self.outgoing.wrote(amt);
                    // SAFETY: parent BACKREF valid.
                    unsafe { Parent::on_write(self.parent(), amt, WriteStatus::Pending) };
                    Self::register_poll(self);
                    return WriteResult::Pending(amt);
                }
            }
            WriteResult::Done(amt) => {
                self.outgoing.reset();
                // SAFETY: parent BACKREF valid.
                unsafe { Parent::on_write(self.parent(), amt, WriteStatus::EndOfFile) };
            }
            WriteResult::Pending(amt) => {
                self.outgoing.wrote(amt);
                // SAFETY: parent BACKREF valid.
                unsafe { Parent::on_write(self.parent(), amt, WriteStatus::Pending) };
                Self::register_poll(self);
            }

            // Zig `else => |r| return r` — only Err remains.
            WriteResult::Err(e) => return WriteResult::Err(e),
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
                return WriteResult::Err(oom_err());
            }

            // noop, but need this to have a chance
            // to register deferred tasks (onAutoFlush)
            // SAFETY: parent BACKREF valid.
            unsafe { Parent::on_write(self.parent(), buf.len(), WriteStatus::Drained) };
            Self::register_poll(self);

            // it's buffered, but should be reported as written to
            // callers
            return WriteResult::Wrote(buf.len());
        }

        if self.outgoing.size() > 0 {
            // make sure write is in-order
            if self.outgoing.write(buf).is_err() {
                return WriteResult::Err(oom_err());
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
                    return WriteResult::Err(oom_err());
                }
                // SAFETY: parent BACKREF valid.
                unsafe { Parent::on_write(self.parent(), amt, WriteStatus::Pending) };
                Self::register_poll(self);
            }
            WriteResult::Wrote(amt) => {
                if amt < buf.len() {
                    if self.outgoing.write(&buf[amt..]).is_err() {
                        return WriteResult::Err(oom_err());
                    }
                    // SAFETY: parent BACKREF valid.
                    unsafe { Parent::on_write(self.parent(), amt, WriteStatus::Pending) };
                    Self::register_poll(self);
                } else {
                    self.outgoing.reset();
                    // SAFETY: parent BACKREF valid.
                    unsafe { Parent::on_write(self.parent(), amt, WriteStatus::Drained) };
                }
            }
            WriteResult::Done(amt) => {
                self.outgoing.reset();
                // SAFETY: parent BACKREF valid.
                unsafe { Parent::on_write(self.parent(), amt, WriteStatus::EndOfFile) };
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
                break 'brk poll.has_flag(FilePollFlag::Hup);
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
            debug_assert!(self.get_fd() == Fd::INVALID);
            // SAFETY: parent BACKREF valid.
            unsafe { Parent::on_close(self.parent()) };
            return;
        }

        let parent = self.parent;
        self.handle.close(
            Some(parent.cast()),
            // SAFETY: parent was set via set_parent with a *mut Parent.
            Some(|ctx: *mut c_void| unsafe { Parent::on_close(ctx.cast::<Parent>()) }),
        );
    }

    pub fn start(&mut self, fd: Fd, is_pollable: bool) -> sys::Result<()> {
        if !is_pollable {
            self.close();
            self.handle = PollOrFd::Fd(fd);
            return sys::Result::Ok(());
        }

        // SAFETY: parent BACKREF set via set_parent; outlives this writer.
        let loop_ = unsafe { Parent::event_loop(self.parent()) };
        let poll = match self.get_poll() {
            Some(p) => p,
            None => {
                let p = FilePollRef::init(loop_, fd, Owner::new(Parent::POLL_OWNER_TAG, std::ptr::from_mut(self).cast()));
                self.handle = PollOrFd::Poll(p);
                p
            }
        };

        match poll.register_with_fd(loop_.loop_(), FilePollKind::Writable, fd) {
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
#[cfg(windows)]
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
        let Some(pipe) = self.source() else { return Fd::INVALID };
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

    fn enable_keeping_process_alive(&mut self, event_loop: EventLoopHandle) {
        self.update_ref(event_loop, true);
    }

    fn disable_keeping_process_alive(&mut self, event_loop: EventLoopHandle) {
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
                // Hand the Box off to libuv; the embedded uv_fs_t may still have
                // an in-flight write (on_fs_write_complete) or will receive an
                // async uv_fs_close callback (File::on_close_complete). Dropping
                // the Box here would free that memory before the callback fires.
                // Zig stores a raw `*File` so `this.source = null` is non-owning;
                // mirror that by leaking via into_raw. on_close_detached path
                // reclaims via heap::take in File::on_close_complete.
                let raw = bun_core::heap::into_raw(file);
                // SAFETY: raw is heap-allocated by Source::open_file; libuv holds
                // the only remaining reference via the fs_t it points into.
                unsafe {
                    if self.owns_fd() {
                        // Use state machine to handle close after operation completes.
                        // detach() schedules start_close() (now or after the pending
                        // op completes); on_close_complete heap::take()s `raw`.
                        (*raw).detach();
                    } else {
                        // Don't own fd: stop any in-flight op and detach parent so
                        // on_fs_write_complete won't touch the (possibly freed)
                        // writer. We must still reclaim the Box<File> — the Zig
                        // spec leaks it here (source.zig heap-allocates and never
                        // destroys on this path); Rust port fixes that leak.
                        (*raw).stop();
                        (*raw).fs.data = core::ptr::null_mut();
                        if (*raw).state == crate::source::FileState::Deinitialized {
                            // No callback will ever fire for this fs_t — sole
                            // owner, free now.
                            // SAFETY: `raw` is the Box<File> leaked above via
                            // into_raw; no libuv request references it.
                            drop(bun_core::heap::take(raw));
                        }
                        // else: state is Operating/Canceling — libuv still owns a
                        // request pointing into *raw. on_fs_write_complete sees
                        // parent_ptr null, observes state == Deinitialized after
                        // complete(), and heap::take()s there.
                    }
                }
            }
            Source::Pipe(pipe) => {
                // Hand the Box off to libuv; on_pipe_close reclaims it.
                let raw = bun_core::heap::into_raw(pipe);
                // SAFETY: raw is heap-allocated by Source::open; freed in on_pipe_close.
                unsafe {
                    (*raw).data = raw.cast::<c_void>();
                    (*raw).close(on_pipe_close);
                }
            }
            Source::Tty(tty) => {
                let p = tty.as_ptr();
                // SAFETY: tty is heap-allocated (via open_tty heap::alloc) or the
                // process-static stdin tty; freed in on_tty_close (gated on is_stdin_tty).
                unsafe { (*p).data = p.cast::<c_void>() };
                // SAFETY: tty is a live uv handle; libuv calls on_tty_close after close completes.
                unsafe { (*p).close(on_tty_close) };
            }
        }
        *self.source_mut() = None;
        self.on_close_source();
        // Deref last — this may free the parent and `self`.
        if has_inflight_write {
            // SAFETY: parent BACKREF valid until deref drops it.
            unsafe { Self::Parent::deref(self.parent_ptr()) };
        }
    }

    fn update_ref(&mut self, _event_loop: EventLoopHandle, value: bool) {
        if let Some(pipe) = self.source_mut().as_mut() {
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
            // raw self-ptr first to dodge the immutable-then-mutable conflict
            let self_ptr = core::ptr::from_mut(self).cast::<c_void>();
            if let Some(pipe) = self.source_mut().as_mut() {
                pipe.set_data(self_ptr);
            }
        }
    }

    fn watch(&mut self) {
        // no-op
    }

    /// SAFETY: `pipe` must be a `Box<uv::Pipe>`-allocated pointer; ownership
    /// transfers to `self.source` (later freed via `close_and_destroy`).
    unsafe fn start_with_pipe(&mut self, pipe: *mut uv::Pipe) -> sys::Result<()> {
        debug_assert!(self.source().is_none());
        // SAFETY: caller contract — Box-allocated, ownership transfers.
        *self.source_mut() = Some(Source::Pipe(unsafe { bun_core::heap::take(pipe) }));
        let p = self.parent_ptr();
        self.set_parent(p);
        self.start_with_current_pipe()
    }

    fn start_sync(&mut self, fd: Fd, _pollable: bool) -> sys::Result<()> {
        debug_assert!(self.source().is_none());
        let mut source = Source::SyncFile(Source::open_file(fd));
        source.set_data(core::ptr::from_mut(self).cast::<c_void>());
        *self.source_mut() = Some(source);
        let p = self.parent_ptr();
        self.set_parent(p);
        self.start_with_current_pipe()
    }

    fn start_with_file(&mut self, fd: Fd) -> sys::Result<()> {
        debug_assert!(self.source().is_none());
        let mut source = Source::File(Source::open_file(fd));
        source.set_data(core::ptr::from_mut(self).cast::<c_void>());
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
        let loop_ = unsafe { Self::Parent::loop_(self.parent_ptr()) };
        let mut source = match Source::open(loop_, fd) {
            sys::Result::Ok(source) => source,
            sys::Result::Err(err) => return sys::Result::Err(err),
        };
        // Creating a uv_pipe/uv_tty takes ownership of the file descriptor
        // TODO: Change the type of the parameter and update all places to
        //       use MovableFD
        // TODO(port): Zig branch `if (source is pipe|tty) and FDType == *MovableIfWindowsFd { rawfd.take() }`
        // dropped — Phase B handles via the MovableFd overload.
        let _ = matches!(source, Source::Pipe(_) | Source::Tty(_));
        source.set_data(core::ptr::from_mut(self).cast::<c_void>());
        *self.source_mut() = Some(source);
        let p = self.parent_ptr();
        self.set_parent(p);
        self.start_with_current_pipe()
    }

    /// SAFETY: `pipe` must be a `Box<uv::Pipe>`-allocated pointer.
    unsafe fn set_pipe(&mut self, pipe: *mut uv::Pipe) {
        // Zig overwrites a raw-pointer union (worst case: leak). In Rust the
        // assignment below would Drop the prior Box WITHOUT uv_close, leaving
        // libuv with a dangling handle → UAF on next loop tick. All other
        // start_* paths assert empty; enforce the same invariant here.
        debug_assert!(self.source().is_none());
        // SAFETY: caller contract — Box-allocated, ownership transfers.
        *self.source_mut() = Some(Source::Pipe(unsafe { bun_core::heap::take(pipe) }));
        let p = self.parent_ptr();
        self.set_parent(p);
    }

    fn get_stream(&mut self) -> Option<*mut uv::uv_stream_t> {
        let source = self.source_mut().as_mut()?;
        // Zig spec only excludes .file (latent bug); Rust's Source::to_stream()
        // is `unreachable!()` for SyncFile too, so exclude both to avoid panic.
        if matches!(source, Source::File(_) | Source::SyncFile(_)) {
            return None;
        }
        Some(source.to_stream())
    }
}

#[cfg(windows)]
extern "C" fn on_pipe_close(handle: *mut uv::Pipe) {
    // SAFETY: handle.data was set to the boxed Pipe ptr in close().
    let this = unsafe { (*handle).data.cast::<uv::Pipe>() };
    drop(unsafe { bun_core::heap::take(this) });
}

#[cfg(windows)]
extern "C" fn on_tty_close(handle: *mut uv::uv_tty_t) {
    // SAFETY: handle.data was set to the tty ptr in close().
    let this = unsafe { (*handle).data.cast::<uv::uv_tty_t>() };
    // The stdin tty (fd 0) lives in static storage; never free it. Mirrors
    // Zig PipeWriter onTtyClose's `is_stdin_tty()` gate.
    if !crate::source::stdin_tty::is_stdin_tty(this) {
        drop(unsafe { bun_core::heap::take(this) });
    }
}

/// Common parent requirements for Windows writers (event loop access + ref counting).
///
/// All methods take `*mut Self` (not `&self`) because the writer is an
/// intrusive *field of* the parent — see PipeWriter.zig `parent: *Parent`.
/// Materializing `&Parent`/`&mut Parent` while a `&mut writer` is live would
/// alias under Stacked Borrows. Zig's `*Parent` freely aliases; we mirror that
/// with raw pointers and never form a Rust reference to `Parent` inside the
/// writer.
#[cfg(windows)]
pub trait WindowsWriterParent {
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn loop_(this: *mut Self) -> *mut uv::Loop;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn ref_(this: *mut Self);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn deref(this: *mut Self);
}

// ──────────────────────────────────────────────────────────────────────────
// WindowsBufferedWriter
// ──────────────────────────────────────────────────────────────────────────

/// Function table for `WindowsBufferedWriter`.
///
/// All methods take `*mut Self` — see [`WindowsWriterParent`] for rationale.
#[cfg(windows)]
pub trait WindowsBufferedWriterParent: WindowsWriterParent {
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_error(this: *mut Self, err: sys::Error);
    const HAS_ON_CLOSE: bool;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_close(_this: *mut Self) {}
    /// # Safety
    /// `this` must point to a live `Self`; returned slice borrows from it.
    unsafe fn get_buffer<'a>(this: *mut Self) -> &'a [u8];
    const HAS_ON_WRITABLE: bool;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_writable(_this: *mut Self) {}
}

#[cfg(windows)]
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

#[cfg(windows)]
impl<Parent: WindowsBufferedWriterParent> Default for WindowsBufferedWriter<Parent> {
    fn default() -> Self {
        Self {
            source: None,
            owns_fd: true,
            parent: core::ptr::null_mut(), // Zig: undefined
            is_done: false,
            write_req: bun_core::ffi::zeroed(),
            write_buffer: uv::uv_buf_t::init(b""),
            pending_payload_size: 0,
        }
    }
}

#[cfg(windows)]
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
            unsafe { Parent::on_close(self.parent) };
        }
    }

    fn start_with_current_pipe(&mut self) -> sys::Result<()> {
        debug_assert!(self.source.is_some());
        self.is_done = false;
        self.write();
        sys::Result::Ok(())
    }
}

#[cfg(windows)]
impl<Parent: WindowsBufferedWriterParent> WindowsBufferedWriter<Parent> {
    /// Raw backref to the owning `Parent`. Returned as `*mut` (never `&mut`)
    /// because this writer is an intrusive field of `Parent` and a `&mut Parent`
    /// would alias the live `&mut self` under Stacked Borrows. All vtable
    /// dispatch goes through `Parent::method(ptr, ..)` which takes `*mut Self`.
    #[inline]
    fn parent(&self) -> *mut Parent {
        self.parent
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.write_buffer.len as usize
    }

    fn on_write_complete(&mut self, status: uv::ReturnCode) {
        let written = self.pending_payload_size;
        self.pending_payload_size = 0;
        if let Some(err) = status.to_error(sys::Tag::write) {
            self.close();
            // SAFETY: parent BACKREF valid.
            unsafe { Parent::on_error(self.parent(), err) };
            return;
        }
        let pending = self.get_buffer_internal();
        let has_pending_data = (pending.len() - written) != 0;
        // SAFETY: parent BACKREF valid.
        unsafe {
            Parent::on_write(
                self.parent(),
                written,
                if self.is_done && !has_pending_data { WriteStatus::Drained } else { WriteStatus::Pending },
            )
        };
        // is_done can be changed inside on_write
        if self.is_done && !has_pending_data {
            // already done and end was called
            self.close();
            return;
        }

        if Parent::HAS_ON_WRITABLE {
            // SAFETY: parent BACKREF valid.
            unsafe { Parent::on_writable(self.parent()) };
        }
    }

    extern "C" fn on_fs_write_complete(fs: *mut uv::fs_t) {
        // SAFETY: `fs` is the `uv_fs_t` field at offset 0 of a boxed
        // `source::File`; `from_fs` reverses the `offset_of` to recover the
        // owning pointer.
        let file = unsafe { crate::source::File::from_fs(fs) };
        // SAFETY: fs is a live uv_fs_t passed by libuv to this callback.
        let result = unsafe { (*fs).result };
        let was_canceled = result.int() == uv::UV_ECANCELED as i64;
        // SAFETY: fs is a live uv_fs_t passed by libuv to this callback.
        let parent_ptr = unsafe { (*fs).data };

        // ALWAYS complete first
        // SAFETY: `file` was derived from `fs` via `offset_of`; the boxed
        // `source::File` outlives this callback (detach()/close() gates free).
        unsafe { (*file).complete(was_canceled) };

        // If detached, file may be closing (owned fd) or just stopped (non-owned fd)
        if parent_ptr.is_null() {
            // owns_fd detach() path: complete() already kicked off start_close()
            // (state == Closing) and on_close_complete will heap::take the Box.
            // !owns_fd close() path: complete() left state == Deinitialized and
            // nothing else will reclaim the Box<File>; this callback is the sole
            // remaining owner, so free it here.
            // SAFETY: `file` is the Box<File> leaked in close() via into_raw.
            if unsafe { (*file).state } == crate::source::FileState::Deinitialized {
                drop(unsafe { bun_core::heap::take(file) });
            }
            return;
        }

        // SAFETY: data was set to `self as *mut Self` in write(); libuv invokes
        // this callback on the single-threaded event loop with no other Rust
        // borrow of `*this` live, so this is the sole `&mut` at this point.
        let this = unsafe { bun_ptr::callback_ctx::<Self>(parent_ptr) };

        if was_canceled {
            // Canceled write - clear pending state
            this.pending_payload_size = 0;
            return;
        }

        if let Some(err) = result.to_error(sys::Tag::write) {
            this.close();
            // SAFETY: parent BACKREF valid.
            unsafe { Parent::on_error(this.parent(), err) };
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

        // BORROW_PARAM (raw-ptr break): the match arms mutate `self` while
        // borrowing into `self.source`. The boxed `File`/`Pipe` live in their
        // own heap allocations, so a `*mut` snapshot is provenance-disjoint
        // from `&mut self` (mirrors the Zig `*Source` pointer the original
        // kept across `self.*` writes).
        let (file_raw, stream_raw): (*mut crate::source::File, *mut uv::uv_stream_t) =
            match self.source.as_mut() {
                None => return,
                Some(Source::SyncFile(_)) => {
                    panic!("This code path shouldn't be reached - sync_file in PipeWriter.zig");
                }
                Some(Source::File(f)) => (f.as_mut() as *mut _, core::ptr::null_mut()),
                Some(s) => (core::ptr::null_mut(), s.to_stream()),
            };

        if !file_raw.is_null() {
            // SAFETY: see raw-ptr break note above.
            let file = unsafe { &mut *file_raw };
            // BufferedWriter ensures pending_payload_size blocks concurrent writes
            debug_assert!(file.can_start());

            self.pending_payload_size = buffer_len;
            file.fs.data = core::ptr::from_mut(self).cast::<c_void>();
            file.prepare();
            self.write_buffer = uv::uv_buf_t::init(buffer);

            // SAFETY: file is fully initialized; libuv stores the cb and fires
            // it on the event loop. parent BACKREF valid.
            if let Some(err) = unsafe {
                uv::uv_fs_write(
                    Parent::loop_(self.parent()),
                    &mut file.fs,
                    file.file,
                    &self.write_buffer,
                    1,
                    -1,
                    Some(Self::on_fs_write_complete),
                )
            }
            .to_error(sys::Tag::write)
            {
                file.complete(false);
                self.close();
                // SAFETY: parent BACKREF valid.
                unsafe { Parent::on_error(self.parent(), err) };
            }
        } else {
            // the buffered version should always have a stable ptr
            self.pending_payload_size = buffer_len;
            self.write_buffer = uv::uv_buf_t::init(buffer);
            let self_ptr = self as *mut Self;
            if let Some(write_err) = self
                .write_req
                // SAFETY: `p` is `self_ptr`; libuv invokes on the loop thread with no
                // other Rust borrow of `*p` live, so `&mut *p` is the sole alias.
                .write(stream_raw, &self.write_buffer, self_ptr, |p, s| unsafe {
                    (*p).on_write_complete(s)
                })
                .to_error(sys::Tag::write)
            {
                self.close();
                // SAFETY: parent BACKREF valid.
                unsafe { Parent::on_error(self.parent(), write_err) };
            }
        }
    }

    fn get_buffer_internal(&self) -> &[u8] {
        // SAFETY: parent is a BACKREF set via set_parent; valid while writer is
        // alive. Raw-ptr dispatch — no `&Parent` materialized.
        unsafe { Parent::get_buffer(self.parent()) }
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
            // Zig: expandToCapacity() then shrinkAndFree(page) — i.e. truncate the
            // buffer's content to `page` bytes AND release the excess capacity.
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

    pub fn write_type_as_bytes<T: bun_core::NoUninit>(&mut self, data: &T) -> Result<(), OOM> {
        self.write(bun_core::bytes_of(data))
    }

    pub fn write_type_as_bytes_assume_capacity<T: bun_core::NoUninit>(&mut self, data: T) {
        // TODO(port): Zig round-trips through bun.Vec<u8> here; Rust just writes bytes.
        // PERF(port): was assume_capacity
        self.list.extend_from_slice(bun_core::bytes_of(&data));
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
                if bun_core::strings::is_all_ascii(buffer) {
                    return Ok(buffer);
                }
                self.write_latin1::<false>(buffer)?;
                Ok(&self.list[self.cursor..])
            }
            WriteKind::Utf16 => {
                let buffer = buffer_u16.unwrap();
                self.write_utf16(buffer)?;
                Ok(&self.list[self.cursor..])
            }
            WriteKind::Bytes => Ok(buffer_u8.unwrap()),
        }
    }

    pub fn write_latin1<const CHECK_ASCII: bool>(&mut self, buffer: &[u8]) -> Result<(), OOM> {
        if CHECK_ASCII {
            if bun_core::strings::is_all_ascii(buffer) {
                return self.write(buffer);
            }
        }

        // PORT NOTE: Zig round-trips through `Vec::<u8>::moveFromList` to call
        // `writeLatin1`; the underlying op is `allocateLatin1IntoUTF8WithList`,
        // which we call on the `Vec<u8>` directly.
        let len = self.list.len();
        let list = mem::take(&mut self.list);
        self.list = bun_core::strings::allocate_latin1_into_utf8_with_list(list, len, buffer);
        Ok(())
    }

    pub fn write_utf16(&mut self, buffer: &[u16]) -> Result<(), OOM> {
        // Zig (PipeWriter.zig:1213): `byte_list.writeUTF16(allocator, buffer)` —
        // `ByteList.writeUTF16` (baby_list.zig:419) sizes the spare capacity via
        // `simdutf.length.utf8.from.utf16.le` *before* the simdutf write. The
        // `ByteVecExt::write_utf16` impl mirrors that contract; calling
        // `convert_utf16_to_utf8_append` directly (its old shortcut) handed
        // simdutf a `Vec::new()` dangling pointer (`0x1`) and segfaulted.
        ByteVecExt::write_utf16(&mut self.list, buffer)?;
        Ok(())
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
#[cfg(windows)]
/// All methods take `*mut Self` — see [`WindowsWriterParent`] for rationale.
pub trait WindowsStreamingWriterParent: WindowsWriterParent {
    /// reports the amount written and done means that we dont have any
    /// other pending data to send (but we may send more data)
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_error(this: *mut Self, err: sys::Error);
    const HAS_ON_WRITABLE: bool;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_writable(_this: *mut Self) {}
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_close(this: *mut Self);
}

#[cfg(windows)]
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

#[cfg(windows)]
impl<Parent: WindowsStreamingWriterParent> Default for WindowsStreamingWriter<Parent> {
    fn default() -> Self {
        Self {
            source: None,
            owns_fd: true,
            parent: core::ptr::null_mut(), // Zig: undefined
            is_done: false,
            write_req: bun_core::ffi::zeroed(),
            write_buffer: uv::uv_buf_t::init(b""),
            outgoing: StreamBuffer::default(),
            current_payload: StreamBuffer::default(),
            last_write_result: WriteResult::Wrote(0),
            closed_without_reporting: false,
        }
    }
}

#[cfg(windows)]
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
        unsafe { Parent::on_close(self.parent) };
    }

    fn start_with_current_pipe(&mut self) -> sys::Result<()> {
        debug_assert!(self.source.is_some());
        self.is_done = false;
        sys::Result::Ok(())
    }
}

#[cfg(windows)]
impl<Parent: WindowsStreamingWriterParent> WindowsStreamingWriter<Parent> {
    /// Raw backref to the owning `Parent`. Returned as `*mut` (never `&mut`)
    /// because this writer is an intrusive field of `Parent` and a `&mut Parent`
    /// would alias the live `&mut self` under Stacked Borrows. All vtable
    /// dispatch goes through `Parent::method(ptr, ..)` which takes `*mut Self`.
    #[inline]
    fn parent(&self) -> *mut Parent {
        self.parent
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
        // Zig's `defer this.parent.deref()` reads `this.parent` LAZILY at scope
        // exit; capturing `self.parent` by value here would snapshot the old
        // pointer and over-deref it if a re-entrant callback set_parent()s.
        // Capture `*mut Self` and read `.parent` at guard execution instead.
        // SAFETY: ref taken in process_send keeps parent (and self-as-field) alive until this deref.
        let _g = scopeguard::guard(core::ptr::from_mut(self), |s| unsafe {
            Parent::deref((*s).parent)
        });

        if let Some(err) = status.to_error(sys::Tag::write) {
            log!("onWrite() = {}", bstr::BStr::new(err.name()));
            self.last_write_result = WriteResult::Err(err.clone());
            // SAFETY: parent BACKREF valid.
            unsafe { Parent::on_error(self.parent(), err) };
            self.close_without_reporting();
            return;
        }

        // success means that we send all the data inside current_payload
        let written = self.current_payload.size();
        self.current_payload.reset();

        // if we dont have more outgoing data we report done in onWrite
        let done = self.outgoing.is_empty();
        let was_done = self.is_done;

        log!("onWrite({}) ({} left)", written, self.outgoing.size());

        if was_done && done {
            // we already call .end lets close the connection
            self.last_write_result = WriteResult::Done(written);
            // SAFETY: parent BACKREF valid.
            unsafe { Parent::on_write(self.parent(), written, WriteStatus::EndOfFile) };
            return;
        }
        // .end was not called yet
        self.last_write_result = WriteResult::Wrote(written);

        // report data written
        // SAFETY: parent BACKREF valid.
        unsafe {
            Parent::on_write(
                self.parent(),
                written,
                if done { WriteStatus::Drained } else { WriteStatus::Pending },
            )
        };

        // process pending outgoing data if any
        self.process_send();

        // TODO: should we report writable?
        if Parent::HAS_ON_WRITABLE {
            // SAFETY: parent BACKREF valid.
            unsafe { Parent::on_writable(self.parent()) };
        }
    }

    extern "C" fn on_fs_write_complete(fs: *mut uv::fs_t) {
        // SAFETY: `fs` is the `uv_fs_t` field at offset 0 of a boxed
        // `source::File`; `from_fs` reverses the `offset_of` to recover the
        // owning pointer.
        let file = unsafe { crate::source::File::from_fs(fs) };
        // SAFETY: fs is a live uv_fs_t passed by libuv to this callback.
        let result = unsafe { (*fs).result };
        let was_canceled = result.int() == uv::UV_ECANCELED as i64;
        // SAFETY: fs is a live uv_fs_t passed by libuv to this callback.
        let parent_ptr = unsafe { (*fs).data };

        // ALWAYS complete first
        // SAFETY: `file` was derived from `fs` via `offset_of`; the boxed
        // `source::File` outlives this callback (detach()/close() gates free).
        unsafe { (*file).complete(was_canceled) };

        // If detached, file may be closing (owned fd) or just stopped (non-owned fd).
        // The deref to balance processSend's ref was already done in close().
        if parent_ptr.is_null() {
            // owns_fd detach() path: complete() already kicked off start_close()
            // (state == Closing) and on_close_complete will heap::take the Box.
            // !owns_fd close() path: complete() left state == Deinitialized and
            // nothing else will reclaim the Box<File>; this callback is the sole
            // remaining owner, so free it here.
            // SAFETY: `file` is the Box<File> leaked in close() via into_raw.
            if unsafe { (*file).state } == crate::source::FileState::Deinitialized {
                drop(unsafe { bun_core::heap::take(file) });
            }
            return;
        }

        // SAFETY: data was set to `self as *mut Self` in process_send(); libuv
        // invokes this callback on the single-threaded event loop with no other
        // Rust borrow of `*this` live, so this is the sole `&mut` at this point.
        let this = unsafe { bun_ptr::callback_ctx::<Self>(parent_ptr) };

        if was_canceled {
            // Canceled write - reset buffers and deref to balance process_send ref
            this.current_payload.reset();
            // SAFETY: parent is BACKREF; ref taken in process_send keeps it alive until this deref.
            unsafe { Parent::deref(this.parent) };
            return;
        }

        if let Some(err) = result.to_error(sys::Tag::write) {
            // deref to balance process_send ref — read `.parent` LAZILY at
            // guard execution (Zig defer semantics), not eagerly, in case
            // close()/on_error re-enter and swap the parent pointer.
            // SAFETY: ref taken in process_send keeps parent (and self) alive until this deref.
            let _g = scopeguard::guard(core::ptr::from_mut(this), |s| unsafe {
                Parent::deref((*s).parent)
            });
            this.close();
            // SAFETY: parent BACKREF valid.
            unsafe { Parent::on_error(this.parent(), err) };
            return;
        }

        // on_write_complete handles the deref
        this.on_write_complete(uv::ReturnCode::zero());
    }

    /// this tries to send more data returning if we are writable or not after this
    fn process_send(&mut self) {
        log!("processSend");
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

        // BORROW_PARAM (raw-ptr break): match arms mutate `self` while
        // borrowing into `self.source`. The boxed `File`/`Pipe` are separate
        // heap allocations, so a `*mut` snapshot is provenance-disjoint.
        let (file_raw, stream_raw): (*mut crate::source::File, *mut uv::uv_stream_t) =
            match self.source.as_mut() {
                None => {
                    let err = sys::Error::from_code(sys::E::PIPE, sys::Tag::pipe);
                    self.last_write_result = WriteResult::Err(err.clone());
                    // SAFETY: parent BACKREF valid.
                    unsafe { Parent::on_error(self.parent(), err) };
                    self.close_without_reporting();
                    return;
                }
                Some(Source::SyncFile(_)) => {
                    panic!("sync_file pipe write should not be reachable");
                }
                Some(Source::File(f)) => (f.as_mut() as *mut _, core::ptr::null_mut()),
                Some(s) => (core::ptr::null_mut(), s.to_stream()),
            };

        // current payload is empty we can just swap with outgoing
        mem::swap(&mut self.current_payload, &mut self.outgoing);
        // PORT NOTE: reshaped for borrowck — re-read bytes from current_payload (post-swap).
        let bytes_ptr = self.current_payload.slice().as_ptr();
        // SAFETY: current_payload storage is not reallocated until on_write_complete resets it;
        // libuv reads via uv_buf_t which holds this same ptr/len.
        let bytes = unsafe { core::slice::from_raw_parts(bytes_ptr, bytes_len) };

        if !file_raw.is_null() {
            // SAFETY: see raw-ptr break note above.
            let file = unsafe { &mut *file_raw };
            // StreamingWriter ensures current_payload blocks concurrent writes
            debug_assert!(file.can_start());

            file.fs.data = core::ptr::from_mut(self).cast::<c_void>();
            file.prepare();
            self.write_buffer = uv::uv_buf_t::init(bytes);

            // SAFETY: file is fully initialized; libuv stores the cb and fires
            // it on the event loop. parent BACKREF valid.
            if let Some(err) = unsafe {
                uv::uv_fs_write(
                    Parent::loop_(self.parent()),
                    &mut file.fs,
                    file.file,
                    &self.write_buffer,
                    1,
                    -1,
                    Some(Self::on_fs_write_complete),
                )
            }
            .to_error(sys::Tag::write)
            {
                file.complete(false);
                self.last_write_result = WriteResult::Err(err.clone());
                // SAFETY: parent BACKREF valid.
                unsafe { Parent::on_error(self.parent(), err) };
                self.close_without_reporting();
                return;
            }
        } else {
            // enqueue the write
            self.write_buffer = uv::uv_buf_t::init(bytes);
            let self_ptr = self as *mut Self;
            if let Some(err) = self
                .write_req
                // SAFETY: `p` is `self_ptr`; libuv invokes on the loop thread with no
                // other Rust borrow of `*p` live, so `&mut *p` is the sole alias.
                .write(stream_raw, &self.write_buffer, self_ptr, |p, s| unsafe {
                    (*p).on_write_complete(s)
                })
                .to_error(sys::Tag::write)
            {
                self.last_write_result = WriteResult::Err(err.clone());
                // SAFETY: parent BACKREF valid.
                unsafe { Parent::on_error(self.parent(), err) };
                self.close_without_reporting();
                return;
            }
        }
        // Ref the parent to prevent it from being freed while the async
        // write is in flight. The matching deref is in on_write_complete
        // or on_fs_write_complete.
        // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
        unsafe { Parent::ref_(self.parent()) };
        self.last_write_result = WriteResult::Pending(0);
    }

    fn close_without_reporting(&mut self) {
        if self.get_fd() != Fd::INVALID {
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
                    Err(_) => return WriteResult::Err(oom_err()),
                };
                let initial_len = remain.len();
                let mut remain = remain;
                let fd = Fd::from_uv(match &self.source {
                    Some(Source::SyncFile(f)) => f.file,
                    _ => unreachable!(),
                });

                while remain.len() > 0 {
                    match sys::write(fd, remain) {
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
            return WriteResult::Err(oom_err());
        }
        if had_buffered_data {
            return WriteResult::Pending(0);
        }
        self.process_send();
        self.last_write_result.clone()
    }

    fn write_internal_u16(&mut self, buffer: &[u16]) -> WriteResult {
        if self.is_done {
            return WriteResult::Done(0);
        }

        if matches!(self.source, Some(Source::SyncFile(_))) {
            let result = (|| {
                let remain = match self.outgoing.write_or_fallback(None, Some(buffer), WriteKind::Utf16) {
                    Ok(r) => r,
                    Err(_) => return WriteResult::Err(oom_err()),
                };
                let initial_len = remain.len();
                let mut remain = remain;
                let fd = Fd::from_uv(match &self.source {
                    Some(Source::SyncFile(f)) => f.file,
                    _ => unreachable!(),
                });

                while remain.len() > 0 {
                    match sys::write(fd, remain) {
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
            return WriteResult::Err(oom_err());
        }
        if had_buffered_data {
            return WriteResult::Pending(0);
        }
        self.process_send();
        self.last_write_result.clone()
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
        self.last_write_result.clone()
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

#[cfg(windows)]
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

// ported from: src/io/PipeWriter.zig
