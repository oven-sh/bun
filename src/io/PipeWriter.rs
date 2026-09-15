use core::ffi::c_void;
use core::mem;

use bun_collections::ByteVecExt;
use bun_core::OOM;
use bun_ptr::LaunderedSelf; // brings `Self::r` into scope for all 4 writers
use bun_sys::{self as sys, Fd};

use crate::{EventLoopHandle, FilePollFlag, FilePollKind, FilePollRef, Owner, PollTag};

use crate::pipes::{FileType, PollOrFd};
#[cfg(windows)]
use crate::source::Source;

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

// ──────────────────────────────────────────────────────────────────────────
// PosixPipeWriter
// ──────────────────────────────────────────────────────────────────────────

/// The hooks a writer supplies are the required trait methods; the shared
/// write machinery is the provided trait methods.
pub trait PosixPipeWriter {
    fn get_fd(&self) -> Fd;
    fn get_buffer(&self) -> &[u8];
    fn on_write(&mut self, written: usize, status: WriteStatus);
    /// Optional. Implement as no-op when not needed and set
    /// `HAS_REGISTER_POLL = false`.
    fn register_poll(&mut self);
    const HAS_REGISTER_POLL: bool = true;
    fn on_error(&mut self, err: sys::Error);
    fn get_file_type(&self) -> FileType;
    fn get_force_sync(&self) -> bool;

    fn handle(&self) -> &PollOrFd;

    /// Only reads `get_file_type()` / `get_fd()` from `self`; takes `&self` so
    /// callers may pass a `buf` that borrows from a field of `self` (e.g.
    /// `self.outgoing.slice()`) without raw-pointer aliasing escapes.
    fn try_write(&self, force_sync: bool, buf: &[u8]) -> WriteResult {
        // PERF: try_write_with_write_fn is not monomorphized per FileType —
        // profile if hot.
        let ft = if !force_sync {
            self.get_file_type()
        } else {
            FileType::File
        };
        match ft {
            FileType::NonblockingPipe | FileType::File => {
                self.try_write_with_write_fn(buf, sys::write)
            }
            FileType::Pipe => self.try_write_with_write_fn(buf, write_to_blocking_pipe),
            FileType::Socket => self.try_write_with_write_fn(buf, write_to_socket),
        }
    }

    fn try_write_with_write_fn(
        &self,
        buf: &[u8],
        write_fn: fn(Fd, &[u8]) -> sys::Result<usize>,
    ) -> WriteResult {
        let fd = self.get_fd();
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

    fn on_poll(&mut self, size_hint: isize, received_hup: bool) {
        // reshaped for borrowck — capture buffer.len() before further &mut self calls.
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

        match self.drain_buffered_data(max_write, received_hup) {
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
                // Like `.drained`, this may free the writer; `self` is dead after it.
                self.on_error(err);
            }
            WriteResult::Done(amt) => {
                self.on_write(amt, WriteStatus::EndOfFile);
            }
        }
    }

    /// Only writes; the caller dispatches the callbacks (`&self` enforces it,
    /// and parents rely on no `on_write` arriving after `on_error`). An error
    /// is always `Err`: `try_write` reports a short write as `Pending`, never
    /// as `Wrote`, so an error here means nothing was written this round.
    fn drain_buffered_data(&self, max_write_size: usize, received_hup: bool) -> WriteResult {
        let _ = received_hup; // autofix

        let buf_len = self.get_buffer().len();
        let limit = if max_write_size < buf_len && max_write_size > 0 {
            max_write_size
        } else {
            buf_len
        };

        let mut drained: usize = 0;

        while drained < limit {
            let force_sync = self.get_force_sync();
            match self.try_write(force_sync, &self.get_buffer()[drained..limit]) {
                WriteResult::Pending(pending) => {
                    drained += pending;
                    return WriteResult::Pending(drained);
                }
                WriteResult::Wrote(amt) => {
                    drained += amt;
                }
                WriteResult::Err(err) => {
                    return WriteResult::Err(err);
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

/// Free fn for the blocking-pipe path; the other file types are handled
/// inline in `try_write` above.
fn write_to_blocking_pipe(fd: Fd, buf: &[u8]) -> sys::Result<usize> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
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

/// `send(2)` stands in for `write(2)` on the socketpair behind a child's stdio,
/// only to pass `MSG_NOSIGNAL`. The error names `write`, as Node does.
fn write_to_socket(fd: Fd, buf: &[u8]) -> sys::Result<usize> {
    sys::send_non_block(fd, buf).map_err(|err| sys::Error {
        syscall: sys::Tag::write,
        ..err
    })
}

// ──────────────────────────────────────────────────────────────────────────
// PosixBufferedWriter
// ──────────────────────────────────────────────────────────────────────────

/// Function table for `PosixBufferedWriter`;
/// in many cases the function table can be the same as `Parent`.
///
/// All methods take `*mut Self` (not `&mut self`) because the writer is an
/// intrusive *field of* the parent (it holds a raw `parent` back-pointer).
/// Materializing `&mut Parent` while a `&mut writer` is live would alias under
/// Stacked Borrows, so we use raw
/// pointers and never form a `&mut Parent` inside the writer.
pub trait PosixBufferedWriterParent {
    /// `bun_io::poll_tag` constant for this writer's `FilePoll` owner. The
    /// per-tag dispatch in `bun_runtime::dispatch::__bun_run_file_poll`
    /// recovers `*mut PosixBufferedWriter<Self>` from this.
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
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn event_loop(this: *mut Self) -> EventLoopHandle;
}

pub struct PosixBufferedWriter<Parent: PosixBufferedWriterParent> {
    pub handle: PollOrFd,
    /// `None` only between `Default` and `set_parent`; every dispatch path
    /// assumes it is set (see SAFETY comments at the call sites).
    pub parent: Option<bun_ptr::ParentRef<Parent, bun_ptr::Mut>>,
    pub(crate) is_done: bool,
    pub(crate) pollable: bool,
    pub(crate) closed_without_reporting: bool,
    pub close_fd: bool,
}

impl<Parent: PosixBufferedWriterParent> Default for PosixBufferedWriter<Parent> {
    fn default() -> Self {
        Self {
            handle: PollOrFd::Closed,
            parent: None,
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
        self.get_buffer_internal()
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

// SAFETY: writer is an intrusive field of `Parent`; `Parent::on_write`
// re-entry writes `is_done`/`handle` but never frees it; single JS thread.
unsafe impl<Parent: PosixBufferedWriterParent> bun_ptr::LaunderedSelf
    for PosixBufferedWriter<Parent>
{
}

impl<Parent: PosixBufferedWriterParent> PosixBufferedWriter<Parent> {
    /// Raw backref to the owning `Parent`. Returned as `*mut` (never `&mut`)
    /// because this writer is an intrusive field of `Parent` and a `&mut Parent`
    /// would alias the live `&mut self` under Stacked Borrows. All vtable
    /// dispatch goes through `Parent::method(ptr, ..)` which takes `*mut Self`.
    #[inline]
    fn parent(&self) -> *mut Parent {
        self.parent
            .map_or(core::ptr::null_mut(), bun_ptr::ParentRef::as_mut_ptr)
    }

    /// Single nonnull-asref dispatch for the set-once `parent` backref.
    ///
    /// Type invariant (encapsulated `unsafe`): `self.parent` is populated by
    /// [`set_parent`](Self::set_parent) before any method that reaches this
    /// accessor, and the writer is an intrusive field of `*parent` so the
    /// pointee strictly outlives `self`. Collapses N identical
    /// `unsafe { Parent::event_loop(self.parent()) }` blocks into one.
    #[inline]
    fn parent_event_loop(&self) -> EventLoopHandle {
        // SAFETY: type invariant — see doc comment above.
        unsafe { Parent::event_loop(self.parent()) }
    }

    /// See [`parent_event_loop`](Self::parent_event_loop) for the encapsulated
    /// type invariant. `on_error` may re-enter via the parent's intrusive
    /// `writer` field; callers that read `self` afterwards must launder
    /// (R-2 noalias) — this accessor does not.
    #[inline]
    fn parent_on_error(&self, err: sys::Error) {
        // SAFETY: type invariant — set-once parent backref outlives writer.
        unsafe { Parent::on_error(self.parent(), err) }
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>()
    }

    pub(crate) fn create_poll(&mut self, fd: Fd) -> FilePollRef {
        FilePollRef::init(
            self.parent_event_loop(),
            fd,
            Owner::new(Parent::POLL_OWNER_TAG, std::ptr::from_mut(self).cast()),
        )
    }

    pub fn get_poll(&self) -> Option<FilePollRef> {
        self.handle.get_poll()
    }

    pub(crate) fn get_file_type(&self) -> FileType {
        let Some(poll) = self.get_poll() else {
            return FileType::File;
        };
        poll.file_type()
    }

    pub(crate) fn get_fd(&self) -> Fd {
        self.handle.get_fd()
    }

    fn _on_error(&mut self, err: sys::Error) {
        debug_assert!(!err.is_retry());

        self.parent_on_error(err);

        self.close();
    }

    fn _on_write(&mut self, written: usize, status: WriteStatus) {
        // PORT_NOTES_PLAN R-2: `&mut self` carries LLVM `noalias`, but
        // `Parent::on_write` (e.g. `IOWriter::on_write`) re-enters via a fresh
        // `&mut Self` from the parent's intrusive `writer` field and may write
        // `self.handle` / `self.is_done`. ASM-verified PROVEN_CACHED in the
        // `IOWriter` monomorphization: `self.handle.{tag,poll,fd}` were loaded
        // once, spilled to `[rbp-48/-120/-44]`, and reused by the trailing
        // `self.close()` without reload. Launder so post-call accesses see
        // fresh state.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        let was_done = Self::r(this).is_done;
        let parent = Self::r(this).parent();

        if status == WriteStatus::EndOfFile && !was_done {
            Self::r(this).close_without_reporting();
        }

        // SAFETY: parent BACKREF valid.
        unsafe { Parent::on_write(parent, written, status) };
        // Re-escape so the trailing `close()` cannot reuse the spilled
        // `self.handle` from before `on_write`.
        core::hint::black_box(this);
        if status == WriteStatus::EndOfFile && !was_done {
            // `close()` reads `is_done`/`handle` which may have been written
            // re-entrantly above; `r()` reborrows fresh from the laundered ptr.
            Self::r(this).close();
        }
    }

    pub fn register_poll(&mut self) {
        let Some(poll) = self.get_poll() else { return };
        // Use the event loop from the parent, not the global one
        let loop_ = self.parent_event_loop().loop_();
        match poll.register_with_fd(loop_, FilePollKind::Writable, poll.fd()) {
            sys::Result::Err(err) => {
                // Same report as a failed write (the streaming writer does the
                // same): parents expect every error to be followed by `on_close`.
                self._on_error(err);
            }
            sys::Result::Ok(()) => {}
        }
    }

    pub(crate) fn enable_keeping_process_alive(&self, event_loop: EventLoopHandle) {
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
                let parent = self.parent();
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
        // Reject null up front: every dispatch path past this point assumes
        // `self.parent` is set (see the type-invariant doc on `parent_event_loop`).
        let parent = core::ptr::NonNull::new(parent).expect("set_parent: parent must not be null");
        // SAFETY: caller passes the live owning `Parent` (write provenance).
        self.parent = Some(unsafe { bun_ptr::ParentRef::from_raw_mut(parent.as_ptr()) });
        // reshaped for borrowck — capture *mut Self before borrowing field.
        let owner = std::ptr::from_mut(self).cast::<c_void>();
        self.handle
            .set_owner(Owner::new(Parent::POLL_OWNER_TAG, owner.cast()));
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

    /// On POSIX a `MovableIfWindowsFd` never transfers ownership, so callers
    /// pass the plain `Fd` (via `MovableIfWindowsFd::get_posix()` when needed).
    ///
    /// On `Err` the writer holds nothing; `fd` is still the caller's to close.
    pub fn start(&mut self, rawfd: Fd, pollable: bool) -> sys::Result<()> {
        let fd = rawfd;
        self.pollable = pollable;
        if !pollable {
            debug_assert!(!matches!(self.handle, PollOrFd::Poll(_)));
            self.handle = PollOrFd::Fd(fd);
            return sys::Result::Ok(());
        }
        let existing_poll = self.get_poll();
        let poll = match existing_poll {
            Some(p) => p,
            None => {
                let p = self.create_poll(fd);
                self.handle = PollOrFd::Poll(p);
                p
            }
        };
        let loop_ = self.parent_event_loop().loop_();

        match poll.register_with_fd(loop_, FilePollKind::Writable, fd) {
            sys::Result::Err(err) => {
                // A poll from an earlier start() still holds that start's fd.
                if existing_poll.is_none() {
                    self.handle.close_without_closing_fd();
                }
                return sys::Result::Err(err);
            }
            sys::Result::Ok(()) => {
                let event_loop = self.parent_event_loop();
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
/// intrusive *field of* the parent (it holds a raw `parent` back-pointer).
/// Materializing `&mut Parent` while a `&mut writer` is live would alias under
/// Stacked Borrows, so we use raw
/// pointers and never form a `&mut Parent` inside the writer.
pub trait PosixStreamingWriterParent {
    /// `bun_io::poll_tag` constant for this writer's `FilePoll` owner. The
    /// per-tag dispatch in `bun_runtime::dispatch::__bun_run_file_poll`
    /// recovers `*mut PosixStreamingWriter<Self>` from this.
    const POLL_OWNER_TAG: PollTag;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_error(this: *mut Self, err: sys::Error);
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
    pub(crate) closed_without_reporting: bool,
    pub force_sync: bool,
    /// Last reported `WriteStatus == Pending` (i.e. write(2) returned EAGAIN).
    backed_up: core::cell::Cell<bool>,
}

impl<Parent: PosixStreamingWriterParent> Default for PosixStreamingWriter<Parent> {
    fn default() -> Self {
        Self {
            outgoing: StreamBuffer::default(),
            handle: PollOrFd::Closed,
            parent: core::ptr::null_mut(),
            is_done: false,
            closed_without_reporting: false,
            force_sync: false,
            backed_up: core::cell::Cell::new(false),
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

// SAFETY: see `PosixBufferedWriter`'s `LaunderedSelf` impl — identical shape.
unsafe impl<Parent: PosixStreamingWriterParent> bun_ptr::LaunderedSelf
    for PosixStreamingWriter<Parent>
{
}

impl<Parent: PosixStreamingWriterParent> PosixStreamingWriter<Parent> {
    // The smallest page size the target
    // supports (16K on Apple Silicon, 4K elsewhere among our targets).
    const CHUNK_SIZE: usize = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        16384
    } else {
        4096
    };

    /// Raw backref to the owning `Parent`. Returned as `*mut` (never `&mut`)
    /// because this writer is an intrusive field of `Parent` and a `&mut Parent`
    /// would alias the live `&mut self` under Stacked Borrows. All vtable
    /// dispatch goes through `Parent::method(ptr, ..)` which takes `*mut Self`.
    #[inline]
    fn parent(&self) -> *mut Parent {
        self.parent
    }

    /// Single nonnull-asref dispatch for the set-once `parent` backref.
    ///
    /// Type invariant (encapsulated `unsafe`): `self.parent` is populated by
    /// [`set_parent`](Self::set_parent) before any write path is reached, and
    /// the writer is an intrusive field of `*parent` so the pointee strictly
    /// outlives `self`. Collapses the N identical
    /// `unsafe { Parent::on_write(self.parent(), ..) }` blocks (one per
    /// `WriteResult` arm) into one. `on_write` may re-enter via the parent's
    /// intrusive `writer` field; callers that read `self` afterwards must
    /// launder (R-2 noalias) — the existing laundered sites in `_on_write` /
    /// `register_poll` keep their raw-pointer dispatch and do **not** route
    /// through this accessor.
    #[inline]
    fn parent_on_write(&self, amount: usize, status: WriteStatus) {
        // on_write may re-enter write(); record first so re-entry leaves the newer value.
        self.backed_up.set(status == WriteStatus::Pending);
        // SAFETY: type invariant — set-once parent backref outlives writer.
        unsafe { Parent::on_write(self.parent(), amount, status) }
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.outgoing.memory_cost()
    }

    pub fn get_poll(&self) -> Option<FilePollRef> {
        self.handle.get_poll()
    }

    pub(crate) fn get_fd(&self) -> Fd {
        self.handle.get_fd()
    }

    pub(crate) fn get_file_type(&self) -> FileType {
        let Some(poll) = self.get_poll() else {
            return FileType::File;
        };
        poll.file_type()
    }

    pub fn has_pending_data(&self) -> bool {
        self.outgoing.is_not_empty()
    }

    /// write(2) returned EAGAIN (distinct from has_pending_data()'s coalesce buffer).
    pub fn is_backed_up(&self) -> bool {
        self.backed_up.get()
    }

    /// Bytes accepted from callers that have not reached the fd yet.
    pub fn buffered_len(&self) -> usize {
        self.outgoing.size()
    }

    pub(crate) fn should_buffer(&self, addition: usize) -> bool {
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

        self.parent_on_write(written, status);
    }

    pub fn set_parent(&mut self, parent: *mut Parent) {
        self.parent = parent;
        // reshaped for borrowck — capture *mut Self before borrowing field.
        let owner = std::ptr::from_mut(self).cast::<c_void>();
        self.handle
            .set_owner(Owner::new(Parent::POLL_OWNER_TAG, owner.cast()));
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
                // SAFETY: parent BACKREF valid.
                unsafe { Parent::on_error(Self::r(this).parent(), err) };
                // `this` is still live (parent owns this writer; an on_error
                // handler may end/detach but never frees mid-call).
                Self::r(this).close();
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

        if bun_core::strings::is_all_ascii(buf) {
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
            self.parent_on_write(buf_len, WriteStatus::Drained);
            Self::register_poll(self);

            return WriteResult::Wrote(buf_len);
        }

        self.try_write_newly_buffered_data()
    }

    fn try_write_newly_buffered_data(&mut self) -> WriteResult {
        debug_assert!(!self.is_done);

        // Borrow `self.outgoing` only for the syscall. `try_write` takes `&self`
        // so the shared borrow of `outgoing.slice()` is sound and ends before
        // `reset()`/`Parent::on_write` below — both of which may reallocate or
        // free `outgoing.list` (`reset` shrinks; `on_write` may re-enter
        // `write()` on this writer). Holding a `&[u8]` fn-arg across those (the
        // old shape) was a Stacked-Borrows protector violation / dangling ref.
        let rc = self.try_write(self.force_sync, self.outgoing.slice());

        match rc {
            WriteResult::Wrote(amt) => {
                if amt == self.outgoing.size() {
                    self.outgoing.reset();
                    self.parent_on_write(amt, WriteStatus::Drained);
                } else {
                    self.outgoing.wrote(amt);
                    self.parent_on_write(amt, WriteStatus::Pending);
                    Self::register_poll(self);
                    return WriteResult::Pending(amt);
                }
            }
            WriteResult::Done(amt) => {
                self.outgoing.reset();
                self.parent_on_write(amt, WriteStatus::EndOfFile);
            }
            WriteResult::Pending(amt) => {
                self.outgoing.wrote(amt);
                self.parent_on_write(amt, WriteStatus::Pending);
                Self::register_poll(self);
            }

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
                return WriteResult::Err(sys::Error::oom());
            }

            // noop, but need this to have a chance
            // to register deferred tasks (onAutoFlush)
            self.parent_on_write(buf.len(), WriteStatus::Drained);
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

            return self.try_write_newly_buffered_data();
        }

        let rc = self.try_write(self.force_sync, buf);

        match rc {
            WriteResult::Pending(amt) => {
                if self.outgoing.write(&buf[amt..]).is_err() {
                    return WriteResult::Err(sys::Error::oom());
                }
                self.parent_on_write(amt, WriteStatus::Pending);
                Self::register_poll(self);
            }
            WriteResult::Wrote(amt) => {
                if amt < buf.len() {
                    if self.outgoing.write(&buf[amt..]).is_err() {
                        return WriteResult::Err(sys::Error::oom());
                    }
                    self.parent_on_write(amt, WriteStatus::Pending);
                    Self::register_poll(self);
                } else {
                    self.outgoing.reset();
                    self.parent_on_write(amt, WriteStatus::Drained);
                }
            }
            WriteResult::Done(amt) => {
                self.outgoing.reset();
                self.parent_on_write(amt, WriteStatus::EndOfFile);
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

        let rc = self.drain_buffered_data(usize::MAX, received_hup);
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
        // drain_buffered_data skips parent_on_write; leftover bytes = kernel refused them.
        self.backed_up.set(self.outgoing.is_not_empty());
        rc
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

    /// On `Err` the writer holds nothing; `fd` is still the caller's to close.
    pub fn start(&mut self, fd: Fd, is_pollable: bool) -> sys::Result<()> {
        if !is_pollable {
            self.close();
            self.handle = PollOrFd::Fd(fd);
            return sys::Result::Ok(());
        }

        // SAFETY: parent BACKREF set via set_parent; outlives this writer.
        let loop_ = unsafe { Parent::event_loop(self.parent()) };
        let existing_poll = self.get_poll();
        let poll = match existing_poll {
            Some(p) => p,
            None => {
                let p = FilePollRef::init(
                    loop_,
                    fd,
                    Owner::new(Parent::POLL_OWNER_TAG, std::ptr::from_mut(self).cast()),
                );
                self.handle = PollOrFd::Poll(p);
                p
            }
        };

        match poll.register_with_fd(loop_.loop_(), FilePollKind::Writable, fd) {
            sys::Result::Err(err) => {
                // A poll from an earlier start() still holds that start's fd.
                if existing_poll.is_none() {
                    self.handle.close_without_closing_fd();
                }
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
// Windows writers
// ──────────────────────────────────────────────────────────────────────────

/// Common parent requirements for Windows writers (loop access + ref counting).
///
/// A write that has been handed to the kernel borrows its bytes from the
/// parent until the completion is dequeued, so the writer holds a parent ref
/// across every write in flight.
///
/// All methods take `*mut Self` (not `&self`) because the writer is an
/// intrusive *field of* the parent (it holds a raw `parent` back-pointer).
/// Materializing `&Parent`/`&mut Parent` while a `&mut writer` is live would
/// alias under Stacked Borrows, so we use
/// raw pointers and never form a Rust reference to `Parent` inside the
/// writer.
#[cfg(windows)]
pub trait WindowsWriterParent {
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn loop_(this: *mut Self) -> *mut bun_uws_sys::Loop;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn ref_(this: *mut Self);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn deref(this: *mut Self);
}

/// Open what `fd` is for writing; see `WindowsBufferedReader::start` for what
/// `is_pollable` means on Windows.
#[cfg(windows)]
fn open_source_for_writing<Parent: WindowsWriterParent>(
    parent: *mut Parent,
    fd: Fd,
    is_pollable: bool,
    close_fd: bool,
) -> sys::Result<Source> {
    // The parent's loop, not the thread's: `spawnSync` writes on its own.
    // SAFETY: parent is the BACKREF set via set_parent; valid while the writer is.
    let loop_ = unsafe { Parent::loop_(parent) };
    if is_pollable {
        Source::open_owned_pipe(loop_, fd, close_fd)
    } else {
        Source::open(loop_, fd, close_fd)
    }
}

/// Hand `data` to `source`; `on_write(ctx, ..)` runs from the loop afterwards.
///
/// # Safety
/// `data` and `ctx` stay valid until `on_write` has run.
#[cfg(windows)]
unsafe fn submit_write<T>(
    source: &mut Source,
    data: &[u8],
    ctx: *mut T,
    on_write: unsafe fn(*mut T, sys::Result<usize>),
) -> sys::Result<()> {
    match source {
        // SAFETY: caller contract.
        Source::Pipe(pipe) => unsafe { pipe.write(data, ctx, on_write) },
        Source::Tty(tty) => tty.write(data, ctx, on_write),
        // SAFETY: caller contract.
        Source::File(file) => unsafe { file.write(data, ctx, on_write) },
    }
}

/// Write all of `data` before returning.
#[cfg(windows)]
fn write_blocking(source: &mut Source, data: &[u8]) -> sys::Result<usize> {
    match source {
        Source::Pipe(pipe) => pipe.write_blocking(data),
        Source::Tty(tty) => tty.try_write(data),
        Source::File(file) => {
            let fd = file.fd();
            let mut written = 0usize;
            while written < data.len() {
                match sys::write(fd, &data[written..])? {
                    0 => break,
                    n => written += n,
                }
            }
            Ok(written)
        }
    }
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
    /// The bytes must not move or be freed while a write is in flight.
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
    pub close_fd: bool,
    pub(crate) parent: *mut Parent,
    pub(crate) is_done: bool,
    /// One write at a time; whatever the parent queues meanwhile goes out after it.
    pub(crate) pending_payload_size: usize,
}

#[cfg(windows)]
impl<Parent: WindowsBufferedWriterParent> Default for WindowsBufferedWriter<Parent> {
    fn default() -> Self {
        Self {
            source: None,
            close_fd: true,
            parent: core::ptr::null_mut(),
            is_done: false,
            pending_payload_size: 0,
        }
    }
}

#[cfg(windows)]
// SAFETY: write completions re-enter via `FileSink::on_write` → JS →
// `writer.with_mut(|w| w.end())`; writer is intrusive in `Parent`, kept alive
// across the callback by the parent ref taken in `write()` (derefed via the
// callback-end scopeguards); single JS thread.
unsafe impl<Parent: WindowsBufferedWriterParent> bun_ptr::LaunderedSelf
    for WindowsBufferedWriter<Parent>
{
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

    #[inline]
    fn parent_on_error(&self, err: sys::Error) {
        // SAFETY: type invariant — set-once parent backref outlives writer.
        unsafe { Parent::on_error(self.parent(), err) }
    }

    /// Laundered-receiver variant of [`parent_on_error`](Self::parent_on_error):
    /// takes the R-2 `*mut Self` so the field read completes before dispatch
    /// and no Rust borrow of `*this` is live across the (re-entrant)
    /// `Parent::on_error` call.
    #[inline(always)]
    fn r_on_error(this: *mut Self, err: sys::Error) {
        let parent = Self::r(this).parent;
        // SAFETY: type invariant — set-once parent backref outlives writer.
        unsafe { Parent::on_error(parent, err) }
    }

    /// Reads `self.parent` at guard execution so a re-entrant `set_parent`
    /// cannot over-deref a stale pointer.
    #[inline(always)]
    fn r_deref(this: *mut Self) {
        let parent = Self::r(this).parent;
        // SAFETY: type invariant — set-once parent backref; the ref taken in
        // `write()` keeps parent (and self-as-field) alive until this deref.
        unsafe { Parent::deref(parent) }
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>()
    }

    pub fn get_fd(&self) -> Fd {
        self.source.as_ref().map_or(Fd::INVALID, Source::get_fd)
    }

    pub fn set_parent(&mut self, parent: *mut Parent) {
        self.parent = parent;
    }

    pub fn watch(&mut self) {
        // Writes complete on their own; there is nothing to arm.
    }

    pub fn update_ref(&self, _event_loop: EventLoopHandle, value: bool) {
        if let Some(source) = &self.source {
            if value {
                source.ref_();
            } else {
                source.unref();
            }
        }
    }

    pub fn enable_keeping_process_alive(&self, event_loop: EventLoopHandle) {
        self.update_ref(event_loop, true);
    }

    pub fn disable_keeping_process_alive(&self, event_loop: EventLoopHandle) {
        self.update_ref(event_loop, false);
    }

    /// See `WindowsBufferedReader::start` for `is_pollable`. On `Err` the
    /// writer holds nothing; `fd` is still the caller's to close.
    pub fn start(&mut self, fd: Fd, is_pollable: bool) -> sys::Result<()> {
        debug_assert!(self.source.is_none());
        let source = open_source_for_writing(self.parent, fd, is_pollable, self.close_fd)?;
        self.source = Some(source);
        self.is_done = false;
        self.write();
        sys::Result::Ok(())
    }

    /// `report`: whether the parent hears `on_close`, and whether a write still
    /// in flight reports back (it must not once the parent is being dropped).
    fn close_source(&mut self, report: bool) {
        self.is_done = true;
        let Some(mut source) = self.source.take() else {
            return;
        };
        if !self.close_fd {
            source.disown();
        }
        if report {
            source.close();
        } else {
            drop(source);
        }
        if report && Parent::HAS_ON_CLOSE {
            // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
            unsafe { Parent::on_close(self.parent) };
        }
    }

    pub fn close(&mut self) {
        self.close_source(true);
    }

    /// Close the source without invoking `Parent::on_close` — for a parent
    /// that is mid-teardown.
    pub fn close_without_reporting(&mut self) {
        self.close_source(false);
    }

    /// # Safety
    /// `this` is the writer that submitted the write, kept alive by the
    /// parent ref taken in `write`.
    unsafe fn on_write_result(this: *mut Self, result: sys::Result<usize>) {
        // PORT_NOTES_PLAN R-2: `Parent::on_write` (e.g. `FileSink::on_write`)
        // re-enters JS via promise resolution and may call back into this
        // writer through a fresh `&mut Self` derived from the parent's
        // intrusive `writer` field, writing `self.is_done`. Launder so
        // post-`on_write` reads see fresh state.
        let this: *mut Self = core::hint::black_box(this);
        // Scopeguard deref to balance write()'s ref: `Parent::on_write` may
        // drop the last external strong ref, and the trailing `is_done` /
        // `close()` reads below need the parent (and `self`, inside it) alive.
        let _g = scopeguard::guard(this, |s| Self::r_deref(s));
        let submitted = Self::r(this).pending_payload_size;
        Self::r(this).pending_payload_size = 0;
        let written = match result {
            // Closed with the write still out; `close()` told the parent already.
            sys::Result::Err(err) if err.get_errno() == sys::E::ECANCELED => return,
            sys::Result::Err(err) => {
                Self::r(this).close();
                Self::r_on_error(this, err);
                return;
            }
            sys::Result::Ok(written) => written.min(submitted),
        };
        let pending = Self::r(this).get_buffer_internal();
        // `close()` may have run before this callback and cleared the parent's
        // buffer while `written` still carries the submitted size; treat that
        // as no pending data rather than underflowing.
        let has_pending_data = pending.len().saturating_sub(written) != 0;
        let is_done_before = Self::r(this).is_done;
        // SAFETY: parent BACKREF valid.
        unsafe {
            Parent::on_write(
                Self::r(this).parent(),
                written,
                if is_done_before && !has_pending_data {
                    WriteStatus::Drained
                } else {
                    WriteStatus::Pending
                },
            )
        };
        // Re-escape so the trailing `is_done`/`parent`/`close()` cannot reuse
        // values spilled from before `on_write`.
        core::hint::black_box(this);
        // is_done can be changed inside on_write
        if Self::r(this).is_done && !has_pending_data {
            // already done and end was called
            Self::r(this).close();
            return;
        }

        if Parent::HAS_ON_WRITABLE {
            // SAFETY: parent BACKREF valid.
            unsafe { Parent::on_writable(Self::r(this).parent()) };
        }
    }

    pub fn write(&mut self) {
        // if we are already done or if we have some pending payload we just wait until next write
        // Before `get_buffer`: a parent may rebuild the buffer it returns, and
        // the write in flight borrows the one it returned last.
        if self.is_done || self.pending_payload_size > 0 {
            return;
        }
        // SAFETY: parent is a BACKREF set via set_parent; valid while writer is
        // alive. Not through `get_buffer_internal`, whose result borrows `self`.
        let buffer: &[u8] = unsafe { Parent::get_buffer(self.parent()) };
        if buffer.is_empty() {
            return;
        }
        let this: *mut Self = self;
        let Some(source) = self.source.as_mut() else {
            return;
        };
        let len = buffer.len();
        // SAFETY: the parent keeps `buffer` in place while a write is in
        // flight (`get_buffer` contract) and is itself kept alive by the ref
        // taken below; `this` is a field of it.
        match unsafe { submit_write(source, buffer, this, Self::on_write_result) } {
            sys::Result::Err(err) => {
                self.close();
                self.parent_on_error(err);
            }
            sys::Result::Ok(()) => {
                self.pending_payload_size = len;
                // The matching deref is in `on_write_result`, which runs for
                // every submitted write, cancelled ones included.
                // SAFETY: parent BACKREF valid; intrusive refcount bump.
                unsafe { Parent::ref_(self.parent()) };
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

#[cfg(windows)]
impl<Parent: WindowsBufferedWriterParent> Drop for WindowsBufferedWriter<Parent> {
    fn drop(&mut self) {
        self.close_source(false);
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

    /// Dispatched on the `WriteKind` enum tag.
    #[cfg(windows)]
    pub(crate) fn write_or_fallback<'a>(
        &'a mut self,
        buffer_u8: Option<&'a [u8]>,
        buffer_u16: Option<&[u16]>,
        kind: WriteKind,
    ) -> Result<&'a [u8], OOM> {
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
    pub parent: *mut Parent,
    pub is_done: bool,
    /// Write on the calling thread and report the result from `write*` itself.
    pub force_sync: bool,

    // queue any data that we want to write here
    pub outgoing: StreamBuffer,
    // the bytes of the write in flight must not move, so the buffers are swapped
    pub(crate) current_payload: StreamBuffer,
    // we preserve the last write result for simplicity
    pub(crate) last_write_result: WriteResult,
    // Set only by `close_without_reporting()` (i.e. `Drop`) to suppress
    // `Parent::on_close` while the parent is mid-teardown.
    pub closed_without_reporting: bool,
}

#[cfg(windows)]
impl<Parent: WindowsStreamingWriterParent> Default for WindowsStreamingWriter<Parent> {
    fn default() -> Self {
        Self {
            source: None,
            parent: core::ptr::null_mut(),
            is_done: false,
            force_sync: false,
            outgoing: StreamBuffer::default(),
            current_payload: StreamBuffer::default(),
            last_write_result: WriteResult::Wrote(0),
            closed_without_reporting: false,
        }
    }
}

#[cfg(windows)]
// SAFETY: see `WindowsBufferedWriter`'s `LaunderedSelf` impl — identical shape.
unsafe impl<Parent: WindowsStreamingWriterParent> bun_ptr::LaunderedSelf
    for WindowsStreamingWriter<Parent>
{
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

    /// Laundered-receiver dispatch: takes the R-2 `*mut Self` so the field
    /// read completes before dispatch and no Rust borrow of `*this` is live
    /// across the (re-entrant) `Parent::on_error` call.
    #[inline(always)]
    fn r_on_error(this: *mut Self, err: sys::Error) {
        let parent = Self::r(this).parent;
        // SAFETY: type invariant — set-once parent backref outlives writer.
        unsafe { Parent::on_error(parent, err) }
    }

    #[inline(always)]
    fn r_on_write(this: *mut Self, written: usize, status: WriteStatus) {
        let parent = Self::r(this).parent;
        // SAFETY: type invariant — set-once parent backref outlives writer.
        unsafe { Parent::on_write(parent, written, status) }
    }

    /// Reads `self.parent` **before** dispatch so the (potentially freeing)
    /// `Parent::deref` runs with no borrow of `*this` live.
    #[inline(always)]
    fn r_deref(this: *mut Self) {
        let parent = Self::r(this).parent;
        // SAFETY: type invariant — set-once parent backref; ref taken in
        // `process_send` keeps parent (and self-as-field) alive until this
        // deref runs.
        unsafe { Parent::deref(parent) }
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.current_payload.memory_cost() + self.outgoing.memory_cost()
    }

    pub fn get_fd(&self) -> Fd {
        self.source.as_ref().map_or(Fd::INVALID, Source::get_fd)
    }

    pub fn has_pending_data(&self) -> bool {
        self.outgoing.is_not_empty() || self.current_payload.is_not_empty()
    }

    /// process_send found a write already in flight (current_payload alone is not backpressure).
    pub fn is_backed_up(&self) -> bool {
        self.outgoing.is_not_empty()
    }

    /// Bytes accepted from callers that have not reached the fd yet: queued in
    /// `outgoing` or handed to the kernel in `current_payload`.
    pub fn buffered_len(&self) -> usize {
        self.outgoing.size() + self.current_payload.size()
    }

    pub fn set_parent(&mut self, parent: *mut Parent) {
        self.parent = parent;
    }

    pub fn watch(&mut self) {
        // Writes complete on their own; there is nothing to arm.
    }

    pub fn update_ref(&self, _event_loop: EventLoopHandle, value: bool) {
        if let Some(source) = &self.source {
            if value {
                source.ref_();
            } else {
                source.unref();
            }
        }
    }

    pub fn enable_keeping_process_alive(&self, event_loop: EventLoopHandle) {
        self.update_ref(event_loop, true);
    }

    pub fn disable_keeping_process_alive(&self, event_loop: EventLoopHandle) {
        self.update_ref(event_loop, false);
    }

    /// See `WindowsBufferedReader::start` for `is_pollable`. On `Err` the
    /// writer holds nothing; `fd` is still the caller's to close.
    pub fn start(&mut self, fd: Fd, is_pollable: bool) -> sys::Result<()> {
        debug_assert!(self.source.is_none());
        let source = open_source_for_writing(self.parent, fd, is_pollable, true)?;
        self.start_with_source(source);
        sys::Result::Ok(())
    }

    /// Write to a source that is already open (an accepted or connected named
    /// pipe). The source stays reachable through `self.source`, which is how a
    /// duplex owner reads from the same pipe.
    pub fn start_with_source(&mut self, source: Source) {
        debug_assert!(self.source.is_none());
        self.source = Some(source);
        self.is_done = false;
    }

    /// `report`: whether the parent hears `on_close`, and whether a write still
    /// in flight reports back (it must not once the parent is being dropped).
    fn close_source(&mut self, report: bool) {
        self.is_done = true;
        let Some(mut source) = self.source.take() else {
            return;
        };
        if report {
            source.close();
            // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
            unsafe { Parent::on_close(self.parent) };
        } else {
            // Nobody will be told when the write in flight is done with its
            // bytes, so they go with the source.
            if let Source::Pipe(pipe) = &mut source {
                pipe.adopt_write_buffer(mem::take(&mut self.current_payload.list));
            }
            drop(source);
        }
    }

    pub fn close(&mut self) {
        let report = !self.closed_without_reporting;
        self.close_source(report);
    }

    /// Close the source without invoking `Parent::on_close` — for a parent
    /// that is mid-teardown.
    pub fn close_without_reporting(&mut self) {
        if self.source.is_some() {
            self.closed_without_reporting = true;
            self.close_source(false);
        }
    }

    /// # Safety
    /// `this` is the writer that submitted the write, kept alive by the
    /// parent ref taken in `process_send`.
    unsafe fn on_write_result(this: *mut Self, result: sys::Result<usize>) {
        // PORT_NOTES_PLAN R-2: `Parent::on_write` (e.g. `FileSink::on_write`)
        // re-enters JS via promise resolution and may call back into this
        // writer through a fresh `&mut Self` derived from the parent's
        // intrusive `writer` field (`writer.with_mut(|w| w.end())` or
        // `.write(..)`), writing `self.is_done` / `self.outgoing` /
        // `self.parent`. Launder so all post-`on_write` field accesses see
        // fresh state.
        let this: *mut Self = core::hint::black_box(this);

        // Deref the parent at the end to balance the ref taken in
        // process_send. Capturing `self.parent` by value here would snapshot
        // the old pointer and over-deref it if a re-entrant callback
        // set_parent()s; read `.parent` at guard execution instead.
        let _g = scopeguard::guard(this, |s| Self::r_deref(s));

        let submitted = Self::r(this).current_payload.size();
        let written = match result {
            // Closed with the write still out; `close()` told the parent already.
            sys::Result::Err(err) if err.get_errno() == sys::E::ECANCELED => {
                Self::r(this).current_payload.reset();
                return;
            }
            sys::Result::Err(err) => {
                log!("onWrite() = {}", bstr::BStr::new(err.name()));
                Self::r(this).last_write_result = WriteResult::Err(err.clone());
                Self::r_on_error(this, err);
                core::hint::black_box(this);
                // `close()`, not `close_without_reporting()`: the parent must still
                // observe `on_close` after `on_error` (the `PosixStreamingWriter`
                // contract). FileSink's stream teardown only runs from `on_close`.
                Self::r(this).close();
                return;
            }
            sys::Result::Ok(written) => written.min(submitted),
        };

        Self::r(this).current_payload.wrote(written);
        if Self::r(this).current_payload.is_not_empty() {
            // The source took only part of it; the rest goes out next.
            Self::r_on_write(this, written, WriteStatus::Pending);
            core::hint::black_box(this);
            Self::r(this).send_current_payload();
            return;
        }
        Self::r(this).current_payload.reset();

        // if we dont have more outgoing data we report done in onWrite
        let done = Self::r(this).outgoing.is_empty();
        let was_done = Self::r(this).is_done;

        log!(
            "onWrite({}) ({} left)",
            written,
            Self::r(this).outgoing.size()
        );

        if was_done && done {
            // we already call .end lets close the connection
            Self::r(this).last_write_result = WriteResult::Done(written);
            Self::r_on_write(this, written, WriteStatus::EndOfFile);
            return;
        }
        // .end was not called yet
        Self::r(this).last_write_result = WriteResult::Wrote(written);

        // report data written
        Self::r_on_write(
            this,
            written,
            if done {
                WriteStatus::Drained
            } else {
                WriteStatus::Pending
            },
        );
        // Re-escape so `process_send`/`on_writable` and the deferred guard
        // cannot reuse `is_done`/`outgoing`/`parent` spilled from before
        // `on_write`.
        core::hint::black_box(this);

        // process pending outgoing data if any
        Self::r(this).process_send();

        // TODO: should we report writable?
        if Parent::HAS_ON_WRITABLE {
            // SAFETY: parent BACKREF valid.
            unsafe { Parent::on_writable(Self::r(this).parent()) };
        }
    }

    /// Report a failure to start a write like a failed write.
    fn fail_send(this: *mut Self, err: sys::Error) {
        Self::r(this).last_write_result = WriteResult::Err(err.clone());
        Self::r_on_error(this, err);
        core::hint::black_box(this);
        // See `on_write_result`: the parent must get `on_close`.
        Self::r(this).close();
    }

    /// Hand `current_payload` to the source.
    fn send_current_payload(&mut self) {
        // PORT_NOTES_PLAN R-2: the error arm calls `Parent::on_error`, which
        // re-enters JS and may reach this writer through a fresh `&mut Self`.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        let Some(source) = Self::r(this).source.as_mut() else {
            Self::fail_send(this, sys::Error::from_code(sys::E::PIPE, sys::Tag::pipe));
            return;
        };
        // SAFETY: `current_payload` is not touched until the write's result
        // arrives, and the parent ref taken below keeps the writer (a field of
        // the parent) alive until then. `(*this)` raw deref so the payload
        // borrow does not overlap the `source` borrow.
        let submitted = unsafe {
            submit_write(
                source,
                (*this).current_payload.slice(),
                this,
                Self::on_write_result,
            )
        };
        if let sys::Result::Err(err) = submitted {
            Self::r(this).current_payload.reset();
            Self::fail_send(this, err);
            return;
        }
        // The matching deref is in `on_write_result`, which runs for every
        // submitted write, cancelled ones included.
        // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
        unsafe { Parent::ref_(Self::r(this).parent()) };
        Self::r(this).last_write_result = WriteResult::Pending(0);
    }

    /// this tries to send more data returning if we are writable or not after this
    fn process_send(&mut self) {
        log!("processSend");
        if self.current_payload.is_not_empty() {
            // we have some pending async request, the next outgoing data will be processed after this finish
            self.last_write_result = WriteResult::Pending(0);
            return;
        }

        // nothing todo (we assume we are writable until we try to write something)
        if self.outgoing.is_empty() {
            self.last_write_result = WriteResult::Wrote(0);
            return;
        }

        // current payload is empty we can just swap with outgoing
        mem::swap(&mut self.current_payload, &mut self.outgoing);
        self.send_current_payload();
    }

    /// `force_sync`: everything is written before this returns.
    fn write_sync(
        &mut self,
        buffer_u8: Option<&[u8]>,
        buffer_u16: Option<&[u16]>,
        kind: WriteKind,
    ) -> WriteResult {
        let Some(source) = self.source.as_mut() else {
            return WriteResult::Err(sys::Error::from_code(sys::E::PIPE, sys::Tag::pipe));
        };
        let written = match (source, kind) {
            // A console takes UTF-16: no detour through UTF-8.
            (Source::Tty(tty), WriteKind::Utf16) => tty.try_write_utf16(buffer_u16.unwrap()),
            (Source::Tty(tty), WriteKind::Latin1) => tty.try_write_latin1(buffer_u8.unwrap()),
            (source, _) => match self.outgoing.write_or_fallback(buffer_u8, buffer_u16, kind) {
                Err(_) => sys::Result::Err(sys::Error::oom()),
                Ok(bytes) => write_blocking(source, bytes),
            },
        };
        self.outgoing.reset();
        match written {
            sys::Result::Err(err) => WriteResult::Err(err),
            sys::Result::Ok(0) => WriteResult::Done(0),
            sys::Result::Ok(wrote) => WriteResult::Wrote(wrote),
        }
    }

    fn write_internal_u8(&mut self, buffer: &[u8], kind: WriteKind) -> WriteResult {
        if self.is_done {
            return WriteResult::Done(0);
        }

        if self.force_sync {
            return self.write_sync(Some(buffer), None, kind);
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
        self.last_write_result.clone()
    }

    fn write_internal_u16(&mut self, buffer: &[u16]) -> WriteResult {
        if self.is_done {
            return WriteResult::Done(0);
        }

        if self.force_sync {
            return self.write_sync(None, Some(buffer), WriteKind::Utf16);
        }

        let had_buffered_data = self.outgoing.is_not_empty();
        if self.outgoing.write_utf16(buffer).is_err() {
            return WriteResult::Err(sys::Error::oom());
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
            self.close();
        }
    }
}

#[cfg(windows)]
impl<Parent: WindowsStreamingWriterParent> Drop for WindowsStreamingWriter<Parent> {
    fn drop(&mut self) {
        self.close_without_reporting();
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
// Parent-vtable shim macros
// ──────────────────────────────────────────────────────────────────────────
//
// The `*WriterParent` traits are monomorphic function tables whose every
// method is `unsafe fn(this: *mut Self, ..)`
// that derefs the BACKREF and forwards to an inherent method. Every concrete
// parent (FileSink, Terminal, WindowsNamedPipe, shell IOWriter,
// StaticPipeWriter) was hand-stamping the same triple of cfg-gated impls
// (POSIX + WindowsWriterParent + Windows{Streaming,Buffered}WriterParent),
// differing only in:
//   (a) the inherent-method names the vtable forwards to,
//   (b) how the callback is dispatched off `*mut Self` — as `&mut`, `&`, or
//       a raw-ptr method call (re-entrancy under Stacked/Tree Borrows — see
//       `borrow = shared` / `borrow = ptr` callers),
//   (c) the `event_loop` / `loop_` / refcount accessor expressions. The
//       refcount accessors are used on Windows only, where a write in flight
//       borrows the parent's bytes until its completion is dequeued.
// These macros stamp that triple once per parent.
//
// `borrow = mut`    → bodies form `&mut *this` (unique access for the
//                     callback's duration; the writer never holds
//                     `&mut Parent` itself).
// `borrow = shared` → bodies form `&*this` (callback may re-enter JS or
//                     `enqueue(&self)` and observe a fresh `&Self`; aliased
//                     `&Self` is sound where `&mut Self` is not).
// `borrow = ptr`    → bodies call `Self::method(this, ..)` — no reference is
//                     materialized at the boundary; for parents that must
//                     keep full write/dealloc provenance through a re-entrant,
//                     freeing callback (the callback may run `Box::from_raw`
//                     on `this`, so a `&self`-derived ptr would carry only
//                     SharedReadOnly provenance and dealloc through it is UB).
//
// Accessor args use closure-literal syntax (`|this| expr`) purely as a binder
// for the macro — no actual closure is created; `expr` is pasted into an
// `unsafe` block with `this: *mut Self` in scope.

/// Re-exports for `$crate::`-qualified use inside the macro bodies so callers
/// need no extra `use` items.
#[doc(hidden)]
pub mod __parent_macro {
    pub use ::bun_sys::Error as SysError;
    pub use ::bun_uws_sys::Loop as UwsLoop;
}

/// Stamp `PosixStreamingWriterParent` + `WindowsWriterParent` +
/// `WindowsStreamingWriterParent` for a parent type. See module comment above.
#[macro_export]
macro_rules! impl_streaming_writer_parent {
    // Internal: dispatch a callback off the raw-ptr backref per `borrow` mode.
    (@call mut    $p:expr; $m:ident($($a:tt)*)) => { (&mut *$p).$m($($a)*) };
    (@call shared $p:expr; $m:ident($($a:tt)*)) => { (&*$p).$m($($a)*) };
    (@call ptr    $p:expr; $m:ident($($a:tt)*)) => { <Self>::$m($p, $($a)*) };

    // Internal: expand the three impls once generics are normalized.
    (@emit
        [$($gen:tt)*] $Ty:ty;
        poll_tag   = $poll_tag:expr,
        borrow     = $borrow:tt,
        on_write   = $on_write:ident,
        on_error   = $on_error:ident,
        on_ready   = $on_ready:ident,
        on_close   = $on_close:ident,
        event_loop = |$el_this:ident| $el:expr,
        uws_loop   = |$uws_this:ident| $uws:expr,
        ref_       = |$ref_this:ident| $ref_:expr,
        deref      = |$deref_this:ident| $deref:expr,
    ) => {
        #[cfg(unix)]
        impl $($gen)* $crate::pipe_writer::PosixStreamingWriterParent for $Ty {
            const POLL_OWNER_TAG: $crate::PollTag = $poll_tag;
            #[inline]
            unsafe fn on_write(this: *mut Self, amount: usize, status: $crate::WriteStatus) {
                // SAFETY: `this` is the BACKREF set via `set_parent`; the
                // StreamingWriter never materializes `&mut Parent`. The handler
                // is dispatched per the `borrow` mode (`mut`/`shared`/`ptr` —
                // see the module comment); `ptr` keeps full write/dealloc
                // provenance through re-entrant, freeing callbacks.
                unsafe { $crate::impl_streaming_writer_parent!(@call $borrow this; $on_write(amount, status)) }
            }
            #[inline]
            unsafe fn on_error(this: *mut Self, err: $crate::pipe_writer::__parent_macro::SysError) {
                // SAFETY: see on_write.
                unsafe { $crate::impl_streaming_writer_parent!(@call $borrow this; $on_error(err)) }
            }
            #[inline]
            unsafe fn on_ready(this: *mut Self) {
                // SAFETY: see on_write.
                unsafe { $crate::impl_streaming_writer_parent!(@call $borrow this; $on_ready()) }
            }
            #[inline]
            unsafe fn on_close(this: *mut Self) {
                // SAFETY: see on_write.
                unsafe { $crate::impl_streaming_writer_parent!(@call $borrow this; $on_close()) }
            }
            #[inline]
            unsafe fn event_loop(this: *mut Self) -> $crate::EventLoopHandle {
                // SAFETY: see on_write. Shared-only read.
                let $el_this = this;
                #[allow(unused_unsafe)]
                unsafe { $el }
            }
            #[inline]
            unsafe fn loop_(this: *mut Self) -> *mut $crate::pipe_writer::__parent_macro::UwsLoop {
                // SAFETY: see on_write. Shared-only read.
                let $uws_this = this;
                #[allow(unused_unsafe)]
                unsafe { $uws }
            }
        }

        #[cfg(windows)]
        impl $($gen)* $crate::pipe_writer::WindowsWriterParent for $Ty {
            #[inline]
            unsafe fn loop_(this: *mut Self) -> *mut $crate::pipe_writer::__parent_macro::UwsLoop {
                // SAFETY: BACKREF set via `set_parent`; shared-only read.
                let $uws_this = this;
                #[allow(unused_unsafe)]
                unsafe { $uws }
            }
            #[inline]
            unsafe fn ref_(this: *mut Self) {
                // SAFETY: see loop_. Intrusive refcount bump.
                let $ref_this = this;
                #[allow(unused_unsafe)]
                unsafe { $ref_ };
            }
            #[inline]
            unsafe fn deref(this: *mut Self) {
                // SAFETY: see loop_. May free `this`.
                let $deref_this = this;
                #[allow(unused_unsafe)]
                unsafe { $deref };
            }
        }

        #[cfg(windows)]
        impl $($gen)* $crate::pipe_writer::WindowsStreamingWriterParent for $Ty {
            // Same body as POSIX `on_ready`.
            const HAS_ON_WRITABLE: bool = true;
            #[inline]
            unsafe fn on_write(this: *mut Self, amount: usize, status: $crate::WriteStatus) {
                // SAFETY: BACKREF set via `set_parent`; see borrow-mode note.
                unsafe { $crate::impl_streaming_writer_parent!(@call $borrow this; $on_write(amount, status)) }
            }
            #[inline]
            unsafe fn on_error(this: *mut Self, err: $crate::pipe_writer::__parent_macro::SysError) {
                // SAFETY: see on_write.
                unsafe { $crate::impl_streaming_writer_parent!(@call $borrow this; $on_error(err)) }
            }
            #[inline]
            unsafe fn on_writable(this: *mut Self) {
                // SAFETY: see on_write.
                unsafe { $crate::impl_streaming_writer_parent!(@call $borrow this; $on_ready()) }
            }
            #[inline]
            unsafe fn on_close(this: *mut Self) {
                // SAFETY: see on_write.
                unsafe { $crate::impl_streaming_writer_parent!(@call $borrow this; $on_close()) }
            }
        }
    };

    // Public entry — generic parent: `for<P: Bound, ...> Type<P>; ...`.
    (
        for<$($gp:ident $(: $b0:path)?),+> $Ty:ty;
        $($rest:tt)*
    ) => {
        $crate::impl_streaming_writer_parent! {
            @emit [<$($gp $(: $b0)?),+>] $Ty; $($rest)*
        }
    };

    // Public entry — non-generic parent.
    (
        $Ty:ty;
        $($rest:tt)*
    ) => {
        $crate::impl_streaming_writer_parent! { @emit [] $Ty; $($rest)* }
    };
}

/// Stamp `PosixBufferedWriterParent` + `WindowsWriterParent` +
/// `WindowsBufferedWriterParent` for a parent type. See module comment above.
#[macro_export]
macro_rules! impl_buffered_writer_parent {
    (@borrow mut    $p:expr) => { &mut *$p };
    (@borrow shared $p:expr) => { &*$p };

    (@emit
        [$($gen:tt)*] $Ty:ty;
        poll_tag   = $poll_tag:expr,
        borrow     = $borrow:tt,
        on_write   = $on_write:ident,
        on_error   = $on_error:ident,
        on_close   = $on_close:ident,
        get_buffer = |$gb_this:ident| $gb:expr,
        event_loop = |$el_this:ident| $el:expr,
        ref_       = |$ref_this:ident| $ref_:expr,
        deref      = |$deref_this:ident| $deref:expr,
    ) => {
        #[cfg(not(windows))]
        impl $($gen)* $crate::pipe_writer::PosixBufferedWriterParent for $Ty {
            const POLL_OWNER_TAG: $crate::PollTag = $poll_tag;
            #[inline]
            unsafe fn on_write(this: *mut Self, amount: usize, status: $crate::WriteStatus) {
                // SAFETY: `this` is the BACKREF set via `set_parent`; the
                // BufferedWriter never materializes `&mut Parent`, so this is
                // the unique access path for the callback's duration.
                unsafe { ($crate::impl_buffered_writer_parent!(@borrow $borrow this)).$on_write(amount, status) };
            }
            #[inline]
            unsafe fn on_error(this: *mut Self, err: $crate::pipe_writer::__parent_macro::SysError) {
                // SAFETY: see on_write.
                unsafe { ($crate::impl_buffered_writer_parent!(@borrow $borrow this)).$on_error(&err) };
            }
            const HAS_ON_CLOSE: bool = true;
            #[inline]
            unsafe fn on_close(this: *mut Self) {
                // SAFETY: see on_write.
                unsafe { ($crate::impl_buffered_writer_parent!(@borrow $borrow this)).$on_close() };
            }
            #[inline]
            unsafe fn get_buffer<'a>(this: *mut Self) -> &'a [u8] {
                // SAFETY: see on_write. Shared-only borrow of the buffer storage.
                let $gb_this = this;
                #[allow(unused_unsafe)]
                unsafe { $gb }
            }
            #[inline]
            unsafe fn event_loop(this: *mut Self) -> $crate::EventLoopHandle {
                // SAFETY: see on_write.
                let $el_this = this;
                #[allow(unused_unsafe)]
                unsafe { $el }
            }
        }

        #[cfg(windows)]
        impl $($gen)* $crate::pipe_writer::WindowsWriterParent for $Ty {
            #[inline]
            unsafe fn loop_(this: *mut Self) -> *mut $crate::pipe_writer::__parent_macro::UwsLoop {
                // SAFETY: BACKREF set via `set_parent`; shared-only read.
                let $el_this = this;
                #[allow(unused_unsafe)]
                let event_loop: $crate::EventLoopHandle = unsafe { $el };
                event_loop.loop_()
            }
            #[inline]
            unsafe fn ref_(this: *mut Self) {
                // SAFETY: see loop_. Intrusive refcount bump.
                let $ref_this = this;
                #[allow(unused_unsafe)]
                unsafe { $ref_ };
            }
            #[inline]
            unsafe fn deref(this: *mut Self) {
                // SAFETY: see loop_. May free `this`.
                let $deref_this = this;
                #[allow(unused_unsafe)]
                unsafe { $deref };
            }
        }

        #[cfg(windows)]
        impl $($gen)* $crate::pipe_writer::WindowsBufferedWriterParent for $Ty {
            #[inline]
            unsafe fn on_write(this: *mut Self, amount: usize, status: $crate::WriteStatus) {
                // SAFETY: BACKREF set via `set_parent`; see borrow-mode note.
                unsafe { ($crate::impl_buffered_writer_parent!(@borrow $borrow this)).$on_write(amount, status) };
            }
            #[inline]
            unsafe fn on_error(this: *mut Self, err: $crate::pipe_writer::__parent_macro::SysError) {
                // SAFETY: see on_write.
                unsafe { ($crate::impl_buffered_writer_parent!(@borrow $borrow this)).$on_error(&err) };
            }
            const HAS_ON_CLOSE: bool = true;
            #[inline]
            unsafe fn on_close(this: *mut Self) {
                // SAFETY: see on_write.
                unsafe { ($crate::impl_buffered_writer_parent!(@borrow $borrow this)).$on_close() };
            }
            #[inline]
            unsafe fn get_buffer<'a>(this: *mut Self) -> &'a [u8] {
                // SAFETY: see on_write.
                let $gb_this = this;
                #[allow(unused_unsafe)]
                unsafe { $gb }
            }
            const HAS_ON_WRITABLE: bool = false;
        }
    };

    // Public entry — generic parent.
    (
        for<$($gp:ident $(: $b0:path)?),+> $Ty:ty;
        $($rest:tt)*
    ) => {
        $crate::impl_buffered_writer_parent! {
            @emit [<$($gp $(: $b0)?),+>] $Ty; $($rest)*
        }
    };

    // Public entry — non-generic parent.
    (
        $Ty:ty;
        $($rest:tt)*
    ) => {
        $crate::impl_buffered_writer_parent! { @emit [] $Ty; $($rest)* }
    };
}
