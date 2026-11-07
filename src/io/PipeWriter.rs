use core::ffi::c_void;
use core::mem;

use bun_collections::ByteVecExt;
use bun_core::OOM;
use bun_ptr::LaunderedSelf; // brings `Self::r` into scope for both writers
use bun_sys::{self as sys, Fd};

use crate::file_poll::FlagsSet as FilePollFlags;
use crate::{EventLoopHandle, FilePollFlag, FilePollKind, FilePollRef, Owner, PollTag};

use crate::pipes::{FileType, PollOrFd};

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
// PipeWriter
// ──────────────────────────────────────────────────────────────────────────

/// The hooks a writer supplies are the required trait methods; the shared
/// write machinery is the provided trait methods.
pub trait PipeWriter {
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

    /// Set once `pwritev2(RWF_NOWAIT)` said this fd's file type does not support it, so we stop asking.
    fn rwf_unsupported(&self) -> &core::cell::Cell<bool>;

    /// `Some` if the fd is a console.
    #[cfg(windows)]
    fn console(&self) -> Option<&crate::console::Utf8Carry>;

    /// Whether the fd is one for `write_synchronous`, once a write has asked.
    #[cfg(windows)]
    fn is_synchronous(&self) -> &core::cell::OnceCell<bool>;

    #[cfg(windows)]
    fn try_write(&self, force_sync: bool, buf: &[u8]) -> WriteResult {
        if let PollOrFd::Poll(poll) = *self.handle()
            && !force_sync
        {
            return self.try_write_with_write_fn(buf, |_, buf| poll.write(buf));
        }
        if let Some(carry) = self.console() {
            return self
                .try_write_with_write_fn(buf, |fd, buf| crate::console::write(fd, carry, buf));
        }
        self.try_write_with_write_fn(buf, |fd, buf| {
            use sys::windows::fs::{is_synchronous, write_synchronous};
            if *self.is_synchronous().get_or_init(|| is_synchronous(fd)) {
                write_synchronous(fd, buf)
            } else {
                sys::write(fd, buf)
            }
        })
    }

    /// Only reads `get_file_type()` / `get_fd()` from `self`; takes `&self` so
    /// callers may pass a `buf` that borrows from a field of `self` (e.g.
    /// `self.outgoing.slice()`) without raw-pointer aliasing escapes.
    #[cfg(not(windows))]
    fn try_write(&self, force_sync: bool, buf: &[u8]) -> WriteResult {
        let ft = self.get_file_type();
        // Linux: RWF_NOWAIT is a free per-call nonblocking write, so a pipe stays async even after a spawn cleared O_NONBLOCK on it.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if matches!(ft, FileType::Pipe | FileType::NonblockingPipe) && !self.rwf_unsupported().get()
        {
            match self.try_write_nowait(buf) {
                Some(rc) => return rc,
                // Not a pipe as far as pwritev2 is concerned (tty, pty master, old kernel): remember, use the plain path.
                None => self.rwf_unsupported().set(true),
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
        let fd = self.get_fd();
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
        write_fn: impl Fn(Fd, &[u8]) -> sys::Result<usize>,
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
                "PipeWriter(0x{:x}) handle={}",
                self_addr,
                self.handle().tag_name()
            );
            if let PollOrFd::Poll(poll) = self.handle() {
                log!(
                    "PipeWriter(0x{:x}) got 0, registered state = {}",
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
#[cfg(not(windows))]
fn write_to_blocking_pipe(fd: Fd, buf: &[u8]) -> sys::Result<usize> {
    match bun_core::is_writable(fd) {
        bun_core::Pollable::Ready | bun_core::Pollable::Hup => sys::write(fd, buf),
        bun_core::Pollable::NotReady => sys::Result::Err(sys::Error::retry()),
    }
}

/// `send(2)` stands in for `write(2)` on the socketpair behind a child's stdio,
/// only to pass `MSG_NOSIGNAL`. The error names `write`, as Node does.
#[cfg(not(windows))]
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
// WriterParent
// ──────────────────────────────────────────────────────────────────────────

/// Refcount of the type a writer is a field of. Freeing the parent frees the writer.
///
/// Takes `*mut Self` for the same reason as the callback traits below.
pub trait WriterParent {
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn ref_(this: *mut Self);
    /// # Safety
    /// `this` must point to a live `Self` that the caller holds a ref on. May free `this`.
    unsafe fn deref(this: *mut Self);
}

/// One ref on a writer's parent. Dropping it can free the parent and the writer
/// inside it, so declare it before anything that uses the writer.
struct KeepParentAlive<Parent: WriterParent>(*mut Parent);

impl<Parent: WriterParent> KeepParentAlive<Parent> {
    /// # Safety
    /// `parent` must point to a live `Parent`.
    unsafe fn new(parent: *mut Parent) -> Self {
        // SAFETY: caller contract.
        unsafe { Parent::ref_(parent) };
        Self(parent)
    }
}

impl<Parent: WriterParent> Drop for KeepParentAlive<Parent> {
    fn drop(&mut self) {
        // SAFETY: the ref taken in `new` kept the parent live until here.
        unsafe { Parent::deref(self.0) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BufferedWriter
// ──────────────────────────────────────────────────────────────────────────

/// Function table for `BufferedWriter`;
/// in many cases the function table can be the same as `Parent`.
///
/// All methods take `*mut Self` (not `&mut self`) because the writer is an
/// intrusive *field of* the parent (it holds a raw `parent` back-pointer).
/// Materializing `&mut Parent` while a `&mut writer` is live would alias under
/// Stacked Borrows, so we use raw
/// pointers and never form a `&mut Parent` inside the writer.
pub trait BufferedWriterParent: WriterParent {
    /// `bun_io::poll_tag` constant for this writer's `FilePoll` owner. The
    /// per-tag dispatch in `bun_runtime::dispatch::__bun_run_file_poll`
    /// recovers `*mut BufferedWriter<Self>` from this.
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

pub struct BufferedWriter<Parent: BufferedWriterParent> {
    pub handle: PollOrFd,
    /// `None` only between `Default` and `set_parent`; every dispatch path
    /// assumes it is set (see SAFETY comments at the call sites).
    pub parent: Option<bun_ptr::ParentRef<Parent, bun_ptr::Mut>>,
    pub(crate) is_done: bool,
    pub(crate) pollable: bool,
    pub(crate) closed_without_reporting: bool,
    pub close_fd: bool,
    rwf_unsupported: core::cell::Cell<bool>,
    #[cfg(windows)]
    console: Option<crate::console::Utf8Carry>,
    #[cfg(windows)]
    is_synchronous: core::cell::OnceCell<bool>,
}

impl<Parent: BufferedWriterParent> Default for BufferedWriter<Parent> {
    fn default() -> Self {
        Self {
            handle: PollOrFd::Closed,
            parent: None,
            is_done: false,
            pollable: false,
            closed_without_reporting: false,
            close_fd: true,
            rwf_unsupported: core::cell::Cell::new(false),
            #[cfg(windows)]
            console: None,
            #[cfg(windows)]
            is_synchronous: core::cell::OnceCell::new(),
        }
    }
}

impl<Parent: BufferedWriterParent> PipeWriter for BufferedWriter<Parent> {
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
    fn rwf_unsupported(&self) -> &core::cell::Cell<bool> {
        &self.rwf_unsupported
    }
    #[cfg(windows)]
    fn console(&self) -> Option<&crate::console::Utf8Carry> {
        self.console.as_ref()
    }
    #[cfg(windows)]
    fn is_synchronous(&self) -> &core::cell::OnceCell<bool> {
        &self.is_synchronous
    }
}

// SAFETY: writer is an intrusive field of `Parent`; `Parent::on_write`
// re-entry writes `is_done`/`handle` but never frees it; single JS thread.
unsafe impl<Parent: BufferedWriterParent> bun_ptr::LaunderedSelf for BufferedWriter<Parent> {}

impl<Parent: BufferedWriterParent> BufferedWriter<Parent> {
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

    pub(crate) fn create_poll(&mut self, fd: Fd, flags: FilePollFlags) -> FilePollRef {
        FilePollRef::init(
            self.parent_event_loop(),
            fd,
            flags,
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

        // `on_error` can release every other ref on the parent, and `close()` still has to run.
        // SAFETY: type invariant, see `parent_event_loop`.
        let _keep_alive = unsafe { KeepParentAlive::new(self.parent()) };

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
                self.handle = PollOrFd::Poll(self.create_poll(fd, FilePollFlags::empty()));
            }

            Self::register_poll(self);
        }
    }

    /// `flags`: what the caller knows `fd` to be. On `Err` the writer holds nothing; `fd` is still the caller's to close.
    pub fn start(&mut self, fd: Fd, pollable: bool, flags: FilePollFlags) -> sys::Result<()> {
        self.pollable = pollable;
        if !pollable {
            debug_assert!(!matches!(self.handle, PollOrFd::Poll(_)));
            self.handle = PollOrFd::Fd(fd);
            #[cfg(windows)]
            {
                self.console = crate::console::Utf8Carry::for_fd(fd);
                self.is_synchronous = core::cell::OnceCell::new();
            }
            return sys::Result::Ok(());
        }
        let existing_poll = self.get_poll();
        let poll = match existing_poll {
            Some(p) => p,
            None => {
                let p = self.create_poll(fd, flags);
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
// StreamingWriter
// ──────────────────────────────────────────────────────────────────────────

/// Function table for `StreamingWriter`.
/// All methods take `*mut Self` (not `&mut self`) because the writer is an
/// intrusive *field of* the parent (it holds a raw `parent` back-pointer).
/// Materializing `&mut Parent` while a `&mut writer` is live would alias under
/// Stacked Borrows, so we use raw
/// pointers and never form a `&mut Parent` inside the writer.
pub trait StreamingWriterParent: WriterParent {
    /// `bun_io::poll_tag` constant for this writer's `FilePoll` owner. The
    /// per-tag dispatch in `bun_runtime::dispatch::__bun_run_file_poll`
    /// recovers `*mut StreamingWriter<Self>` from this.
    const POLL_OWNER_TAG: PollTag;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_error(this: *mut Self, err: sys::Error);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_close(this: *mut Self);
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn event_loop(this: *mut Self) -> EventLoopHandle;
}

pub struct StreamingWriter<Parent: StreamingWriterParent> {
    pub outgoing: StreamBuffer,
    pub handle: PollOrFd,
    pub parent: *mut Parent,
    pub is_done: bool,
    pub(crate) closed_without_reporting: bool,
    pub force_sync: bool,
    /// Last reported `WriteStatus == Pending` (i.e. write(2) returned EAGAIN).
    backed_up: core::cell::Cell<bool>,
    rwf_unsupported: core::cell::Cell<bool>,
    #[cfg(windows)]
    console: Option<crate::console::Utf8Carry>,
    #[cfg(windows)]
    is_synchronous: core::cell::OnceCell<bool>,
}

impl<Parent: StreamingWriterParent> Default for StreamingWriter<Parent> {
    fn default() -> Self {
        Self {
            outgoing: StreamBuffer::default(),
            handle: PollOrFd::Closed,
            parent: core::ptr::null_mut(),
            is_done: false,
            closed_without_reporting: false,
            force_sync: false,
            backed_up: core::cell::Cell::new(false),
            rwf_unsupported: core::cell::Cell::new(false),
            #[cfg(windows)]
            console: None,
            #[cfg(windows)]
            is_synchronous: core::cell::OnceCell::new(),
        }
    }
}

impl<Parent: StreamingWriterParent> PipeWriter for StreamingWriter<Parent> {
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
    fn rwf_unsupported(&self) -> &core::cell::Cell<bool> {
        &self.rwf_unsupported
    }
    #[cfg(windows)]
    fn console(&self) -> Option<&crate::console::Utf8Carry> {
        self.console.as_ref()
    }
    #[cfg(windows)]
    fn is_synchronous(&self) -> &core::cell::OnceCell<bool> {
        &self.is_synchronous
    }
}

// SAFETY: see `BufferedWriter`'s `LaunderedSelf` impl — identical shape.
unsafe impl<Parent: StreamingWriterParent> bun_ptr::LaunderedSelf for StreamingWriter<Parent> {}

impl<Parent: StreamingWriterParent> StreamingWriter<Parent> {
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

        self.report_error_and_close(err);
    }

    /// `self` may be freed when this returns.
    fn report_error_and_close(&mut self, err: sys::Error) {
        // PORT_NOTES_PLAN R-2: `&mut self` carries LLVM `noalias`, but
        // `Parent::on_error` (e.g. `FileSink::on_error`) re-enters via
        // a fresh `&mut Self` from the parent's intrusive `writer`
        // field and may write `self.is_done` / `self.handle`.
        // ASM-verified PROVEN_CACHED on the `self.close()` path's
        // field reads. Launder so `close()` sees fresh state.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        let parent = Self::r(this).parent();
        // `FileSink::on_error` rejects a promise and drains microtasks. That JS can close
        // this writer and release every other ref on the parent before `close()` below runs.
        // SAFETY: parent BACKREF set via set_parent; live, this writer is a field of it.
        let _keep_alive = unsafe { KeepParentAlive::new(parent) };
        // SAFETY: as above.
        unsafe { Parent::on_error(parent, err) };
        Self::r(this).close();
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
        let loop_ = unsafe { Parent::event_loop(self.parent()) }.loop_();
        match poll.register_with_fd(loop_, FilePollKind::Writable, poll.fd()) {
            sys::Result::Err(err) => self.report_error_and_close(err),
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

    /// `flags`: what the caller knows `fd` to be. On `Err` the writer holds what it held; `fd` is still the caller's to close.
    pub fn start(&mut self, fd: Fd, is_pollable: bool, flags: FilePollFlags) -> sys::Result<()> {
        let mut handle = PollOrFd::Fd(fd);
        if is_pollable {
            // SAFETY: parent BACKREF set via set_parent; outlives this writer.
            let loop_ = unsafe { Parent::event_loop(self.parent()) };
            let poll = FilePollRef::init(
                loop_,
                fd,
                flags,
                Owner::new(Parent::POLL_OWNER_TAG, std::ptr::from_mut(self).cast()),
            );
            handle = PollOrFd::Poll(poll);
            if let Err(err) = poll.register_with_fd(loop_.loop_(), FilePollKind::Writable, fd) {
                handle.close_without_closing_fd();
                return sys::Result::Err(err);
            }
        }

        // What an earlier start() left.
        self.close();
        self.is_done = false;
        self.handle = handle;
        #[cfg(windows)]
        {
            self.console = if is_pollable {
                None
            } else {
                crate::console::Utf8Carry::for_fd(fd)
            };
            self.is_synchronous = core::cell::OnceCell::new();
        }
        sys::Result::Ok(())
    }
}

impl<Parent: StreamingWriterParent> Drop for StreamingWriter<Parent> {
    fn drop(&mut self) {
        self.close_without_reporting();
        // outgoing dropped automatically
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

// ──────────────────────────────────────────────────────────────────────────
// Parent-vtable shim macros
// ──────────────────────────────────────────────────────────────────────────
//
// The `*WriterParent` traits are monomorphic function tables whose every
// method is `unsafe fn(this: *mut Self, ..)`
// that derefs the BACKREF and forwards to an inherent method. The concrete
// parents (FileSink, Terminal, shell IOWriter, StaticPipeWriter) differ only in:
//   (a) the inherent-method names the vtable forwards to,
//   (b) how the callback is dispatched off `*mut Self` — as `&mut`, `&`, or
//       a raw-ptr method call (re-entrancy under Stacked/Tree Borrows — see
//       `borrow = shared` / `borrow = ptr` callers),
//   (c) the `event_loop` / refcount accessor expressions.
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
}

/// Stamp `WriterParent` + `StreamingWriterParent` for a parent type. See module comment above.
#[macro_export]
macro_rules! impl_streaming_writer_parent {
    // Internal: dispatch a callback off the raw-ptr backref per `borrow` mode.
    (@call mut    $p:expr; $m:ident($($a:tt)*)) => { (&mut *$p).$m($($a)*) };
    (@call shared $p:expr; $m:ident($($a:tt)*)) => { (&*$p).$m($($a)*) };
    (@call ptr    $p:expr; $m:ident($($a:tt)*)) => { <Self>::$m($p, $($a)*) };

    // Internal: expand the impls once generics are normalized.
    (@emit
        [$($gen:tt)*] $Ty:ty;
        poll_tag   = $poll_tag:expr,
        borrow     = $borrow:tt,
        on_write   = $on_write:ident,
        on_error   = $on_error:ident,
        on_close   = $on_close:ident,
        event_loop = |$el_this:ident| $el:expr,
        ref_       = |$ref_this:ident| $ref_:expr,
        deref      = |$deref_this:ident| $deref:expr,
    ) => {
        impl $($gen)* $crate::pipe_writer::StreamingWriterParent for $Ty {
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
        }

        impl $($gen)* $crate::pipe_writer::WriterParent for $Ty {
            #[inline]
            unsafe fn ref_(this: *mut Self) {
                // SAFETY: BACKREF set via `set_parent`. Intrusive refcount bump.
                let $ref_this = this;
                #[allow(unused_unsafe)]
                unsafe { $ref_ };
            }
            #[inline]
            unsafe fn deref(this: *mut Self) {
                // SAFETY: see ref_. May free `this`.
                let $deref_this = this;
                #[allow(unused_unsafe)]
                unsafe { $deref };
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

/// Stamp `WriterParent` + `BufferedWriterParent` for a parent type. See module comment above.
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
        impl $($gen)* $crate::pipe_writer::BufferedWriterParent for $Ty {
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

        impl $($gen)* $crate::pipe_writer::WriterParent for $Ty {
            #[inline]
            unsafe fn ref_(this: *mut Self) {
                // SAFETY: BACKREF set via `set_parent`. Intrusive refcount bump.
                let $ref_this = this;
                #[allow(unused_unsafe)]
                unsafe { $ref_ };
            }
            #[inline]
            unsafe fn deref(this: *mut Self) {
                // SAFETY: see ref_. May free `this`.
                let $deref_this = this;
                #[allow(unused_unsafe)]
                unsafe { $deref };
            }
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
