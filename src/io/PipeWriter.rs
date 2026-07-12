use core::ffi::c_void;
use core::mem;

use bun_collections::ByteVecExt;
use bun_core::OOM;
use bun_ptr::LaunderedSelf; // brings `Self::r` into scope for all 4 writers
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(windows)]
// `close`/`set_data`/`ref_` are default trait methods; bring traits into scope
// so method resolution finds them on `Pipe`/`uv_tty_t`/`fs_t`.
use bun_sys::windows::libuv::UvHandle as _;
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
            FileType::Socket => self.try_write_with_write_fn(buf, sys::send_non_block),
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
                self.on_error(err);
            }
            WriteResult::Done(amt) => {
                self.on_write(amt, WriteStatus::EndOfFile);
            }
        }
    }

    /// Re-derives the slice from `self.get_buffer()` each iteration.
    /// `try_write` only needs `&self`, so the shared borrow of the buffer
    /// coexists with it, and the `&mut self` for `on_error` is taken after
    /// the temporary slice borrow has ended — no raw-pointer escape needed.
    fn drain_buffered_data(&mut self, max_write_size: usize, received_hup: bool) -> WriteResult {
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
            // `try_write` takes `&self`; re-fetching the buffer here keeps the
            // shared borrow scoped to this statement so the `&mut self` for
            // `on_error` below is unencumbered. `try_write` does not mutate
            // `self`, so `get_buffer()` is stable across iterations.
            let attempt = self.try_write(force_sync, &self.get_buffer()[drained..limit]);
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
    const HAS_ON_WRITABLE: bool;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_writable(_this: *mut Self) {}
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn event_loop(this: *mut Self) -> EventLoopHandle;
}

pub struct PosixBufferedWriter<Parent: PosixBufferedWriterParent> {
    pub handle: PollOrFd,
    /// `None` only between `Default` and `set_parent`; every dispatch path
    /// assumes it is set (see SAFETY comments at the call sites).
    pub parent: Option<bun_ptr::ParentRef<Parent>>,
    pub is_done: bool,
    pub pollable: bool,
    pub closed_without_reporting: bool,
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

    pub fn create_poll(&mut self, fd: Fd) -> FilePollRef {
        FilePollRef::init(
            self.parent_event_loop(),
            fd,
            Owner::new(Parent::POLL_OWNER_TAG, std::ptr::from_mut(self).cast()),
        )
    }

    pub fn get_poll(&self) -> Option<FilePollRef> {
        self.handle.get_poll()
    }

    pub fn get_file_type(&self) -> FileType {
        let Some(poll) = self.get_poll() else {
            return FileType::File;
        };
        poll.file_type()
    }

    pub fn get_fd(&self) -> Fd {
        self.handle.get_fd()
    }

    fn _on_error(&mut self, err: sys::Error) {
        debug_assert!(!err.is_retry());

        self.parent_on_error(err);

        self.close();
    }

    pub fn get_force_sync(&self) -> bool {
        false
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
        let loop_ = self.parent_event_loop().loop_();
        match poll.register_with_fd(loop_, FilePollKind::Writable, poll.fd()) {
            sys::Result::Err(err) => {
                self.parent_on_error(err);
            }
            sys::Result::Ok(()) => {}
        }
    }

    pub fn has_ref(&self) -> bool {
        if self.is_done {
            return false;
        }

        let Some(poll) = self.get_poll() else {
            return false;
        };
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
        self.parent = Some(bun_ptr::ParentRef::from(
            core::ptr::NonNull::new(parent).expect("set_parent: parent must not be null"),
        ));
        // reshaped for borrowck — capture *mut Self before borrowing field.
        let owner = std::ptr::from_mut(self).cast::<c_void>();
        self.handle
            .set_owner(Owner::new(Parent::POLL_OWNER_TAG, owner.cast()));
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

    /// On POSIX a `MovableIfWindowsFd` never transfers ownership, so callers
    /// pass the plain `Fd` (via `MovableIfWindowsFd::get_posix()` when needed).
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
        let loop_ = self.parent_event_loop().loop_();

        match poll.register_with_fd(loop_, FilePollKind::Writable, fd) {
            sys::Result::Err(err) => {
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
            parent: core::ptr::null_mut(),
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
        // SAFETY: type invariant — set-once parent backref outlives writer.
        unsafe { Parent::on_write(self.parent(), amount, status) }
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
        let Some(poll) = self.get_poll() else {
            return FileType::File;
        };
        poll.file_type()
    }

    pub fn has_pending_data(&self) -> bool {
        self.outgoing.is_not_empty()
    }

    /// Bytes accepted from callers that have not reached the fd yet.
    pub fn buffered_len(&self) -> usize {
        self.outgoing.size()
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

        self.parent_on_write(written, status);
    }

    pub fn set_parent(&mut self, parent: *mut Parent) {
        self.parent = parent;
        // reshaped for borrowck — capture *mut Self before borrowing field.
        let owner = std::ptr::from_mut(self).cast::<c_void>();
        self.handle
            .set_owner(Owner::new(Parent::POLL_OWNER_TAG, owner.cast()));
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
        rc
    }

    pub fn has_ref(&self) -> bool {
        let Some(poll) = self.get_poll() else {
            return false;
        };
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
        let Some(pipe) = self.source() else {
            return Fd::INVALID;
        };
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
        let Some(source) = self.source_mut().take() else {
            return;
        };
        // Check for in-flight file write before detaching. detach() nulls
        // fs.data so on_fs_write_complete can't recover the writer to call
        // deref(); balance the ref taken when the write was submitted here.
        let has_inflight_write = match &source {
            Source::SyncFile(file) | Source::File(file) => {
                file.state == crate::source::FileState::Operating
                    || file.state == crate::source::FileState::Canceling
            }
            _ => false,
        };
        match source {
            Source::SyncFile(file) | Source::File(file) => {
                // Hand the Box off to libuv; the embedded uv_fs_t may still have
                // an in-flight write (on_fs_write_complete) or will receive an
                // async uv_fs_close callback (File::on_close_complete). Dropping
                // the Box here would free that memory before the callback fires.
                // Leak via into_raw; the on_close_detached path
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
                    } else if !(*raw).detach_borrowed_fd() {
                        // Idle and the fd is parent-owned: nothing pending,
                        // nothing to close. Reclaim and drop the Box.
                        drop(bun_core::heap::take(raw));
                    }
                    // else: on_fs_write_complete heap::take()s the detached Box.
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

    // TODO: MovableIfWindowsFd overload — add a separate start_movable().
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
        // TODO: take ownership of the fd for pipe/tty sources via a MovableFd
        // overload.
        let _ = matches!(source, Source::Pipe(_) | Source::Tty(_));
        source.set_data(core::ptr::from_mut(self).cast::<c_void>());
        *self.source_mut() = Some(source);
        let p = self.parent_ptr();
        self.set_parent(p);
        self.start_with_current_pipe()
    }

    /// SAFETY: `pipe` must be a `Box<uv::Pipe>`-allocated pointer.
    unsafe fn set_pipe(&mut self, pipe: *mut uv::Pipe) {
        // The assignment below would Drop the prior Box WITHOUT uv_close, leaving
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
        // `Source::to_stream()` is `unreachable!()` for both File and
        // SyncFile, so exclude both to avoid panic.
        if matches!(source, Source::File(_) | Source::SyncFile(_)) {
            return None;
        }
        Some(source.to_stream())
    }
}

#[cfg(windows)]
extern "C" fn on_pipe_close(handle: *mut uv::Pipe) {
    // `close()` set `handle.data = handle` and then called `uv_close(handle)`;
    // libuv passes the same pointer back, so `handle` *is* the boxed Pipe ptr
    // — no need to round-trip through `.data`.
    // SAFETY: `handle` is the Box<Pipe> leaked via into_raw in close().
    drop(unsafe { bun_core::heap::take(handle) });
}

#[cfg(windows)]
extern "C" fn on_tty_close(handle: *mut uv::uv_tty_t) {
    // `close()` set `handle.data = handle` and then called `uv_close(handle)`;
    // libuv passes the same pointer back, so `handle` *is* the tty ptr.
    // The stdin tty (fd 0) lives in static storage; never free it.
    if !crate::source::stdin_tty::is_stdin_tty(handle) {
        // SAFETY: non-stdin tty is heap-allocated (open_tty heap::alloc).
        drop(unsafe { bun_core::heap::take(handle) });
    }
}

/// Common parent requirements for Windows writers (event loop access + ref counting).
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
            parent: core::ptr::null_mut(),
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

    fn source(&self) -> &Option<Source> {
        &self.source
    }
    fn source_mut(&mut self) -> &mut Option<Source> {
        &mut self.source
    }
    fn parent_ptr(&self) -> *mut Parent {
        self.parent
    }
    fn set_parent_ptr(&mut self, p: *mut Parent) {
        self.parent = p;
    }
    fn is_done(&self) -> bool {
        self.is_done
    }
    fn set_is_done(&mut self, v: bool) {
        self.is_done = v;
    }
    fn owns_fd(&self) -> bool {
        self.owns_fd
    }

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
// SAFETY: libuv write-complete callbacks re-enter via `FileSink::on_write` →
// JS → `writer.with_mut(|w| w.end())`; writer is intrusive in `Parent`, kept
// alive across the callback by the parent ref taken in `write()` (derefed via
// the callback-end scopeguards); single JS thread.
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

    /// Single nonnull-asref dispatch for the set-once `parent` backref.
    /// Type invariant (encapsulated `unsafe`): see
    /// [`PosixBufferedWriter::parent_on_error`] — same shape, same proof.
    /// Laundered (`(*this)`) sites in `on_write_complete` /
    /// `on_fs_write_complete` route through [`r_on_error`](Self::r_on_error)
    /// instead so no `&self` protector is held across re-entry.
    #[inline]
    fn parent_on_error(&self, err: sys::Error) {
        // SAFETY: type invariant — set-once parent backref outlives writer.
        unsafe { Parent::on_error(self.parent(), err) }
    }

    /// Laundered-receiver variant of [`parent_on_error`](Self::parent_on_error).
    ///
    /// Type invariant (encapsulated `unsafe`): `self.parent` is populated by
    /// [`set_parent`](BaseWindowsPipeWriter::set_parent) before any write path
    /// is reached, and the writer is an intrusive field of `*parent` so the
    /// pointee strictly outlives `self`. Takes the R-2 `*mut Self` so the field
    /// read completes before dispatch and no Rust borrow of `*this` is live
    /// across the (re-entrant) `Parent::on_error` call. Collapses the two
    /// identical dispatch blocks in `on_write_complete` /
    /// `on_fs_write_complete` into one — mirrors
    /// [`WindowsStreamingWriter::r_on_error`].
    #[inline(always)]
    fn r_on_error(this: *mut Self, err: sys::Error) {
        let parent = Self::r(this).parent;
        // SAFETY: type invariant — set-once parent backref outlives writer.
        unsafe { Parent::on_error(parent, err) }
    }

    /// See [`r_on_error`](Self::r_on_error). Reads `self.parent` at guard
    /// execution so a re-entrant `set_parent` cannot over-deref a stale
    /// pointer — mirrors [`WindowsStreamingWriter::r_deref`].
    #[inline(always)]
    fn r_deref(this: *mut Self) {
        let parent = Self::r(this).parent;
        // SAFETY: type invariant — set-once parent backref; the ref taken in
        // `write()` keeps parent (and self-as-field) alive until this deref.
        unsafe { Parent::deref(parent) }
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self.write_buffer.len as usize
    }

    fn on_write_complete(&mut self, status: uv::ReturnCode) {
        // PORT_NOTES_PLAN R-2: `&mut self` carries LLVM `noalias`, but
        // `Parent::on_write` (e.g. `FileSink::on_write`) re-enters JS via
        // promise resolution and may call back into this writer through a fresh
        // `&mut Self` derived from the parent's intrusive `writer` field
        // (`writer.with_mut(|w| w.end())`), writing `self.is_done`. With
        // `noalias`, LLVM may cache the pre-call `is_done`/`parent` and reuse
        // them after the call. Launder so post-`on_write` reads see fresh
        // state.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // Scopeguard deref to balance write()'s ref: `Parent::on_write` may
        // drop the last external strong ref, and the trailing `is_done` /
        // `close()` reads below need the parent (and `self`, inside it) alive.
        let _g = scopeguard::guard(this, |s| Self::r_deref(s));
        let written = Self::r(this).pending_payload_size;
        Self::r(this).pending_payload_size = 0;
        if let Some(err) = status.to_error(sys::Tag::write) {
            Self::r(this).close();
            Self::r_on_error(this, err);
            return;
        }
        let pending = Self::r(this).get_buffer_internal();
        let has_pending_data = (pending.len() - written) != 0;
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

    extern "C" fn on_fs_write_complete(fs: *mut uv::fs_t) {
        // SAFETY: libuv fs_cb — `fs` is the `uv_fs_t` field at offset 0 of a
        // boxed `source::File`; `from_fs_callback` snapshots `result`/`data`
        // and recovers `&mut File` via container_of. Single-threaded dispatch,
        // no other Rust borrow of the boxed `File` is live.
        let (file, result, parent_ptr) = unsafe { crate::source::File::from_fs_callback(fs) };
        let was_canceled = result.int() == uv::UV_ECANCELED as i64;

        // ALWAYS complete first — the boxed `source::File` outlives this
        // callback (detach()/close() gates free).
        file.complete(was_canceled);

        // If detached, file may be closing (owned fd) or just stopped (non-owned fd).
        // The deref to balance write()'s ref was already done in close().
        if parent_ptr.is_null() {
            // owns_fd detach() path: complete() already kicked off start_close()
            // (state == Closing) and on_close_complete will heap::take the Box.
            // !owns_fd close() path: complete() left state == Deinitialized and
            // nothing else will reclaim the Box<File>; this callback is the sole
            // remaining owner, so free it here.
            if file.state == crate::source::FileState::Deinitialized {
                // SAFETY: `file` is the Box<File> leaked in close() via into_raw.
                drop(unsafe { bun_core::heap::take(core::ptr::from_mut(file)) });
            }
            return;
        }

        // PORT_NOTES_PLAN R-2: launder `*this` for the same reason as the
        // Streaming sibling above — `close()` → `Parent::on_close` → JS may
        // re-enter via `with_mut(|w| ..)`; the post-call `(*this).parent()`
        // must reload.
        // SAFETY: data was set to `self as *mut Self` in write(); libuv invokes
        // this callback on the single-threaded event loop with no other Rust
        // borrow of `*this` live, so this is the sole access path.
        let this: *mut Self = core::hint::black_box(parent_ptr.cast::<Self>());

        if was_canceled {
            // Canceled write - clear pending state and balance write()'s ref.
            Self::r(this).pending_payload_size = 0;
            Self::r_deref(this);
            return;
        }

        if let Some(err) = result.to_error(sys::Tag::write) {
            // Balance write()'s ref — lazy `.parent` read at guard execution
            // in case close()/on_error re-enter and swap the parent pointer.
            let _g = scopeguard::guard(this, |s| Self::r_deref(s));
            // close() may re-enter JS.
            Self::r(this).close();
            core::hint::black_box(this);
            // `r_on_error` re-reads `.parent` after the close() re-entry.
            Self::r_on_error(this, err);
            return;
        }

        // on_write_complete handles the deref (and is itself laundered).
        Self::r(this).on_write_complete(uv::ReturnCode::zero());
    }

    pub fn write(&mut self) {
        let buffer = self.get_buffer_internal();
        // if we are already done or if we have some pending payload we just wait until next write
        if self.is_done || self.pending_payload_size > 0 || buffer.len() == 0 {
            return;
        }

        // Snapshot the slice into an owned `uv_buf_t` (ptr + len, `Copy`) now;
        // this ends the `&self` borrow held by `buffer` so the `&mut self`
        // accesses below (`self.source.as_mut()`, field writes) are unencumbered.
        // The underlying storage is not reallocated before libuv consumes it
        // (only handed to libuv via uv_buf_t / write_req).
        let buffer_len = buffer.len();
        let write_buf = uv::uv_buf_t::init(buffer);

        // BORROW_PARAM (raw-ptr break): the match arms mutate `self` while
        // borrowing into `self.source`. The boxed `File`/`Pipe` live in their
        // own heap allocations, so a `*mut` snapshot is provenance-disjoint
        // from `&mut self` and stays valid across `self.*` writes.
        let (file_raw, stream_raw): (*mut crate::source::File, *mut uv::uv_stream_t) =
            match self.source.as_mut() {
                None => return,
                Some(Source::SyncFile(_)) => {
                    panic!("This code path shouldn't be reached - sync_file in PipeWriter.rs");
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
            self.write_buffer = write_buf;

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
                self.parent_on_error(err);
            } else {
                // Ref the parent to prevent it from being freed while the async
                // write is in flight. The matching deref is in on_write_complete,
                // on_fs_write_complete, or close() (mid-flight teardown).
                // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
                unsafe { Parent::ref_(self.parent()) };
            }
        } else {
            // the buffered version should always have a stable ptr
            self.pending_payload_size = buffer_len;
            self.write_buffer = write_buf;
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
                self.parent_on_error(write_err);
            } else {
                // Keep the parent alive while the stream write is in flight;
                // the write callback (incl. ECANCELED after close) always
                // fires, and on_write_complete's guard runs the deref.
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
        self.list.extend_from_slice(buffer);
        Ok(())
    }

    pub fn wrote(&mut self, amount: usize) {
        self.cursor += amount;
    }

    pub fn write_assume_capacity(&mut self, buffer: &[u8]) {
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
        self.list.extend_from_slice(bun_core::bytes_of(&data));
    }

    /// Dispatched on the `WriteKind` enum tag.
    pub fn write_or_fallback<'a>(
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
    // Set only by `close_without_reporting()` (i.e. `Drop`) to suppress
    // `Parent::on_close` while the parent is mid-teardown.
    pub closed_without_reporting: bool,
}

#[cfg(windows)]
impl<Parent: WindowsStreamingWriterParent> Default for WindowsStreamingWriter<Parent> {
    fn default() -> Self {
        Self {
            source: None,
            owns_fd: true,
            parent: core::ptr::null_mut(),
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
impl<Parent: WindowsStreamingWriterParent> BaseWindowsPipeWriter
    for WindowsStreamingWriter<Parent>
{
    type Parent = Parent;

    fn source(&self) -> &Option<Source> {
        &self.source
    }
    fn source_mut(&mut self) -> &mut Option<Source> {
        &mut self.source
    }
    fn parent_ptr(&self) -> *mut Parent {
        self.parent
    }
    fn set_parent_ptr(&mut self, p: *mut Parent) {
        self.parent = p;
    }
    fn is_done(&self) -> bool {
        self.is_done
    }
    fn set_is_done(&mut self, v: bool) {
        self.is_done = v;
    }
    fn owns_fd(&self) -> bool {
        self.owns_fd
    }

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

    /// Single nonnull-asref dispatch for the set-once `parent` backref,
    /// laundered-receiver variant.
    ///
    /// Type invariant (encapsulated `unsafe`): `self.parent` is populated by
    /// [`set_parent`](BaseWindowsPipeWriter::set_parent) before any write path
    /// is reached, and the writer is an intrusive field of `*parent` so the
    /// pointee strictly outlives `self`. Unlike a `&self` accessor (which would
    /// place a `readonly`/SB-protector on `*self` for the duration of the
    /// re-entrant `Parent::on_error` call — see the `parent_on_error` note on
    /// [`WindowsBufferedWriter`]), this takes the R-2 `*mut Self`: the field
    /// read completes before dispatch, so no Rust borrow of `*this` is live
    /// across the (re-entrant) call. Collapses the five identical
    /// `Parent::on_error(Self::r(this).parent(), err)` dispatch blocks in
    /// `on_write_complete` / `on_fs_write_complete` / `process_send` into one.
    #[inline(always)]
    fn r_on_error(this: *mut Self, err: sys::Error) {
        let parent = Self::r(this).parent;
        // SAFETY: type invariant — set-once parent backref outlives writer.
        unsafe { Parent::on_error(parent, err) }
    }

    /// See [`r_on_error`](Self::r_on_error) for the encapsulated type
    /// invariant and laundered-receiver rationale. Collapses the two
    /// `Parent::on_write` arms in `on_write_complete` into one `unsafe`.
    #[inline(always)]
    fn r_on_write(this: *mut Self, written: usize, status: WriteStatus) {
        let parent = Self::r(this).parent;
        // SAFETY: type invariant — set-once parent backref outlives writer.
        unsafe { Parent::on_write(parent, written, status) }
    }

    /// See [`r_on_error`](Self::r_on_error) for the encapsulated type
    /// invariant and laundered-receiver rationale. Reads `self.parent`
    /// **before** dispatch so the (potentially freeing) `Parent::deref`
    /// runs with no borrow of `*this` live — matching the lazy read order
    /// at each scopeguard site. Collapses the three
    /// `Parent::deref` blocks into one `unsafe`.
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

    pub fn has_pending_data(&self) -> bool {
        self.outgoing.is_not_empty() || self.current_payload.is_not_empty()
    }

    /// Bytes accepted from callers that have not reached the fd yet: queued in
    /// `outgoing` or handed to libuv in `current_payload`.
    pub fn buffered_len(&self) -> usize {
        self.outgoing.size() + self.current_payload.size()
    }

    fn on_write_complete(&mut self, status: uv::ReturnCode) {
        // PORT_NOTES_PLAN R-2: `&mut self` carries LLVM `noalias`, but
        // `Parent::on_write` (e.g. `FileSink::on_write`) re-enters JS via
        // promise resolution and may call back into this writer through a fresh
        // `&mut Self` derived from the parent's intrusive `writer` field
        // (`writer.with_mut(|w| w.end())` or `.write(..)`), writing
        // `self.is_done` / `self.outgoing` / `self.parent`. With `noalias`,
        // LLVM may cache pre-call field loads and reuse them after the call.
        // Launder so all post-`on_write` field accesses see fresh state.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));

        // Deref the parent at the end to balance the ref taken in
        // process_send before submitting the async write request.
        // Capturing `self.parent` by value here would snapshot the old
        // pointer and over-deref it if a re-entrant callback set_parent()s.
        // Capture the laundered `*mut Self` and read `.parent` at guard
        // execution instead — the `black_box` above also ensures the guard's
        // read is not folded with any pre-call load.
        let _g = scopeguard::guard(this, |s| Self::r_deref(s));

        if let Some(err) = status.to_error(sys::Tag::write) {
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

        // success means that we send all the data inside current_payload
        let written = Self::r(this).current_payload.size();
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

    extern "C" fn on_fs_write_complete(fs: *mut uv::fs_t) {
        // SAFETY: libuv fs_cb — `fs` is the `uv_fs_t` field at offset 0 of a
        // boxed `source::File`; `from_fs_callback` snapshots `result`/`data`
        // and recovers `&mut File` via container_of. Single-threaded dispatch,
        // no other Rust borrow of the boxed `File` is live.
        let (file, result, parent_ptr) = unsafe { crate::source::File::from_fs_callback(fs) };
        let was_canceled = result.int() == uv::UV_ECANCELED as i64;

        // ALWAYS complete first — the boxed `source::File` outlives this
        // callback (detach()/close() gates free).
        file.complete(was_canceled);

        // If detached, file may be closing (owned fd) or just stopped (non-owned fd).
        // The deref to balance processSend's ref was already done in close().
        if parent_ptr.is_null() {
            // owns_fd detach() path: complete() already kicked off start_close()
            // (state == Closing) and on_close_complete will heap::take the Box.
            // !owns_fd close() path: complete() left state == Deinitialized and
            // nothing else will reclaim the Box<File>; this callback is the sole
            // remaining owner, so free it here.
            if file.state == crate::source::FileState::Deinitialized {
                // SAFETY: `file` is the Box<File> leaked in close() via into_raw.
                drop(unsafe { bun_core::heap::take(core::ptr::from_mut(file)) });
            }
            return;
        }

        // PORT_NOTES_PLAN R-2: launder `*this`. `this.on_write_complete()` /
        // `this.close()` below both reach `Parent::on_write`/`on_close` →
        // FileSink → JS, which can `self.writer.with_mut(|w| w.end()/close())`
        // forming a fresh aliased `&mut WindowsStreamingWriter`. The
        // `callback_ctx` `&mut` itself isn't a fn parameter (no `noalias`
        // attribute), but `this.on_write_complete(..)` *passes* `&mut self`
        // and that callee parameter IS `noalias` — `on_write_complete` is
        // already laundered, so the success path is covered. The error path
        // (`close()` → `on_error(this.parent())` → guard deref) reads
        // `this.parent` after re-entry; route those through a black-boxed raw
        // ptr so any inlined call chain cannot store-forward across the JS
        // re-entry.
        // SAFETY: data was set to `self as *mut Self` in process_send(); libuv
        // invokes this callback on the single-threaded event loop with no other
        // Rust borrow of `*this` live, so this is the sole access path.
        let this: *mut Self = core::hint::black_box(parent_ptr.cast::<Self>());

        if was_canceled {
            // Canceled write - reset buffers and deref to balance process_send ref
            Self::r(this).current_payload.reset();
            Self::r_deref(this);
            return;
        }

        if let Some(err) = result.to_error(sys::Tag::write) {
            // deref to balance process_send ref — read `.parent` LAZILY at
            // guard execution, not eagerly, in case
            // close()/on_error re-enter and swap the parent pointer.
            let _g = scopeguard::guard(this, |s| Self::r_deref(s));
            // close() may re-enter JS — every post-call `r(this)` reborrow
            // reloads (laundered raw ptr, no noalias).
            Self::r(this).close();
            core::hint::black_box(this);
            Self::r_on_error(this, err);
            return;
        }

        // on_write_complete handles the deref (and is itself laundered).
        Self::r(this).on_write_complete(uv::ReturnCode::zero());
    }

    /// this tries to send more data returning if we are writable or not after this
    fn process_send(&mut self) {
        log!("processSend");
        // PORT_NOTES_PLAN R-2: same noalias re-entry hazard as
        // `on_write_complete` above. The three synchronous-error arms call
        // `Parent::on_error` (re-enters JS via FileSink::on_error → promise
        // reject; user callback may `writer.with_mut(|w| w.end())`/`.close()`
        // forming a fresh aliased `&mut Self`) and then read
        // `self.{source, is_done, closed_without_reporting}` via `close()`.
        // With `&mut self` `noalias`, LLVM may forward pre-`on_error` field
        // loads across the call. Launder this entry point too — it is reached
        // from `on_write_complete` with a fresh `&mut`.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // `this` is the only access path to `*self` for the rest of this
        // function; every `r(this)` reborrow is sole-aliased on the JS thread.
        if Self::r(this).current_payload.is_not_empty() {
            // we have some pending async request, the next outgoing data will be processed after this finish
            Self::r(this).last_write_result = WriteResult::Pending(0);
            return;
        }

        let bytes_len = Self::r(this).outgoing.slice().len();
        // nothing todo (we assume we are writable until we try to write something)
        if bytes_len == 0 {
            Self::r(this).last_write_result = WriteResult::Wrote(0);
            return;
        }

        // BORROW_PARAM (raw-ptr break): match arms mutate `*this` while
        // borrowing into `(*this).source`. The boxed `File`/`Pipe` are separate
        // heap allocations, so a `*mut` snapshot is provenance-disjoint.
        let (file_raw, stream_raw): (*mut crate::source::File, *mut uv::uv_stream_t) =
            match Self::r(this).source.as_mut() {
                None => {
                    let err = sys::Error::from_code(sys::E::PIPE, sys::Tag::pipe);
                    Self::r(this).last_write_result = WriteResult::Err(err.clone());
                    Self::r_on_error(this, err);
                    core::hint::black_box(this);
                    // See `on_write_complete`: the parent must get `on_close`.
                    Self::r(this).close();
                    return;
                }
                Some(Source::SyncFile(_)) => {
                    panic!("sync_file pipe write should not be reachable");
                }
                Some(Source::File(f)) => (f.as_mut() as *mut _, core::ptr::null_mut()),
                Some(s) => (core::ptr::null_mut(), s.to_stream()),
            };

        // current payload is empty we can just swap with outgoing
        {
            let s = Self::r(this);
            mem::swap(&mut s.current_payload, &mut s.outgoing);
        }
        // Snapshot the post-swap payload into an owned `uv_buf_t` (ptr + len,
        // `Copy`); the underlying storage is not reallocated until
        // `on_write_complete` resets it, and libuv reads it via this same
        // ptr/len. `current_payload` was just swapped from `outgoing`, so its
        // slice length equals `bytes_len` captured above.
        let write_buf = {
            let s = Self::r(this);
            debug_assert_eq!(s.current_payload.slice().len(), bytes_len);
            uv::uv_buf_t::init(s.current_payload.slice())
        };

        if !file_raw.is_null() {
            // SAFETY: see raw-ptr break note above.
            let file = unsafe { &mut *file_raw };
            // StreamingWriter ensures current_payload blocks concurrent writes
            debug_assert!(file.can_start());

            file.fs.data = this.cast::<c_void>();
            file.prepare();
            Self::r(this).write_buffer = write_buf;

            // SAFETY: file is fully initialized; libuv stores the cb and fires
            // it on the event loop. parent BACKREF valid. `(*this)` raw deref
            // (not `r()`) so the `&write_buffer` borrow is not invalidated by a
            // sibling Unique tag from the `parent()` arg under Stacked Borrows.
            if let Some(err) = unsafe {
                uv::uv_fs_write(
                    Parent::loop_((*this).parent()),
                    &mut file.fs,
                    file.file,
                    &(*this).write_buffer,
                    1,
                    -1,
                    Some(Self::on_fs_write_complete),
                )
            }
            .to_error(sys::Tag::write)
            {
                file.complete(false);
                Self::r(this).last_write_result = WriteResult::Err(err.clone());
                Self::r_on_error(this, err);
                core::hint::black_box(this);
                // See `on_write_complete`: the parent must get `on_close`.
                Self::r(this).close();
                return;
            }
        } else {
            // enqueue the write
            Self::r(this).write_buffer = write_buf;
            // SAFETY: `(*this)` raw deref (not `r()`) so the two field borrows
            // (`write_req`, `write_buffer`) coexist under Stacked Borrows. The
            // closure's `(*p)` is the libuv callback ctx — `p` is `this` and
            // libuv invokes on the loop thread with no other Rust borrow live.
            if let Some(err) = unsafe {
                (*this)
                    .write_req
                    .write(stream_raw, &(*this).write_buffer, this, |p, s| {
                        (*p).on_write_complete(s)
                    })
            }
            .to_error(sys::Tag::write)
            {
                Self::r(this).last_write_result = WriteResult::Err(err.clone());
                Self::r_on_error(this, err);
                core::hint::black_box(this);
                // See `on_write_complete`: the parent must get `on_close`.
                Self::r(this).close();
                return;
            }
        }
        // Ref the parent to prevent it from being freed while the async
        // write is in flight. The matching deref is in on_write_complete
        // or on_fs_write_complete.
        // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
        unsafe { Parent::ref_(Self::r(this).parent()) };
        Self::r(this).last_write_result = WriteResult::Pending(0);
    }

    /// Close the source without invoking `Parent::on_close`. Only `Drop` uses
    /// this (the parent is mid-teardown there). Error paths must use `close()`
    /// instead so the parent still observes `on_close`.
    fn close_without_reporting(&mut self) {
        if self.get_fd() != Fd::INVALID {
            debug_assert!(!self.closed_without_reporting);
            self.closed_without_reporting = true;
            self.close();
        }
    }

    /// Blocking write for the `Source::SyncFile` path. Encodes via
    /// `write_or_fallback`, then loops `sys::write` until drained.
    #[inline]
    fn write_sync_file(
        &mut self,
        buffer_u8: Option<&[u8]>,
        buffer_u16: Option<&[u16]>,
        kind: WriteKind,
    ) -> WriteResult {
        let fd = Fd::from_uv(match &self.source {
            Some(Source::SyncFile(f)) => f.file,
            _ => unreachable!(),
        });
        let result = (|| {
            let remain = match self.outgoing.write_or_fallback(buffer_u8, buffer_u16, kind) {
                Ok(r) => r,
                Err(_) => return WriteResult::Err(sys::Error::oom()),
            };
            let initial_len = remain.len();
            let mut remain = remain;

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
        result
    }

    fn write_internal_u8(&mut self, buffer: &[u8], kind: WriteKind) -> WriteResult {
        if self.is_done {
            return WriteResult::Done(0);
        }

        if matches!(self.source, Some(Source::SyncFile(_))) {
            return self.write_sync_file(Some(buffer), None, kind);
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

        if matches!(self.source, Some(Source::SyncFile(_))) {
            return self.write_sync_file(None, Some(buffer), WriteKind::Utf16);
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
//   (c) the `event_loop` / `loop_` / refcount accessor expressions.
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
    #[cfg(windows)]
    pub use ::bun_sys::windows::libuv::Loop as UvLoop;
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
        uv_loop    = |$uv_this:ident| $uv:expr,
        ref_       = |$ref_this:ident| $ref_:expr,
        deref      = |$deref_this:ident| $deref:expr,
    ) => {
        #[cfg(unix)]
        impl $($gen)* $crate::pipe_writer::PosixStreamingWriterParent for $Ty {
            const POLL_OWNER_TAG: $crate::PollTag = $poll_tag;
            const HAS_ON_READY: bool = true;
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
            unsafe fn loop_(this: *mut Self) -> *mut $crate::pipe_writer::__parent_macro::UvLoop {
                // SAFETY: BACKREF set via `set_parent`; shared-only read.
                let $uv_this = this;
                #[allow(unused_unsafe)]
                unsafe { $uv }
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
        uv_loop    = |$uv_this:ident| $uv:expr,
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
            const HAS_ON_WRITABLE: bool = false;
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
            unsafe fn loop_(this: *mut Self) -> *mut $crate::pipe_writer::__parent_macro::UvLoop {
                // SAFETY: BACKREF set via `set_parent`; shared-only read.
                let $uv_this = this;
                #[allow(unused_unsafe)]
                unsafe { $uv }
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
