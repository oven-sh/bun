use core::cell::Cell;
#[cfg(windows)]
use core::cell::UnsafeCell;
#[cfg(windows)]
use core::ffi::c_void;
use core::mem;
use core::ptr::NonNull;

use bun_collections::ByteVecExt;
use bun_core::OOM;
use bun_ptr::LaunderedSelf; // brings `Self::r` into scope for the buffered writers
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::{self as sys, Fd};

use crate::{EventLoopHandle, IoEvent, Owner};
#[cfg(unix)]
use crate::{FilePoll, FilePollFlag, PollTag};

#[cfg(unix)]
use crate::pipes::{FileType, PipeHandle};
#[cfg(windows)]
use crate::posix_event_loop::__bun_run_io;
#[cfg(windows)]
use crate::source::{File, Source};

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

/// What a writer reports to, from inside the call that it is passed to. It may call the writer again.
pub trait WriteHandler {
    fn on_write(&self, amount: usize, status: WriteStatus);
    /// Comes with `on_close`.
    fn on_error(&self, err: sys::Error);
    fn on_close(&self);
    #[cfg(windows)]
    fn on_writable(&self);
    /// From `true` to `false` libuv uses the writer, and dropping it panics.
    #[cfg(windows)]
    fn on_write_in_flight(&self, in_flight: bool);
}

// ──────────────────────────────────────────────────────────────────────────
// PosixPipeWriter
// ──────────────────────────────────────────────────────────────────────────

/// What both writers write through.
#[cfg(unix)]
struct PosixPipeWriter {
    handle: PipeHandle,
    /// Set once `pwritev2(RWF_NOWAIT)` said this fd's file type does not support it, so we stop asking.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    rwf_unsupported: Cell<bool>,
    is_done: Cell<bool>,
    closed_without_reporting: Cell<bool>,
}

#[cfg(unix)]
impl PosixPipeWriter {
    const fn closed() -> Self {
        Self {
            handle: PipeHandle::closed(),
            #[cfg(any(target_os = "linux", target_os = "android"))]
            rwf_unsupported: Cell::new(false),
            is_done: Cell::new(false),
            closed_without_reporting: Cell::new(false),
        }
    }

    fn get_file_type(&self) -> FileType {
        self.handle
            .with_poll(FilePoll::file_type)
            .unwrap_or(FileType::File)
    }

    /// A short write is `Pending` or `Done`, never `Wrote`.
    fn try_write(&self, force_sync: bool, buf: &[u8]) -> WriteResult {
        // PERF: try_write_with_write_fn is not monomorphized per FileType —
        // profile if hot.
        let ft = self.get_file_type();
        // Linux: RWF_NOWAIT is a free per-call nonblocking write, so a pipe stays async even after a spawn cleared O_NONBLOCK on it.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if matches!(ft, FileType::Pipe | FileType::NonblockingPipe) && !self.rwf_unsupported.get() {
            match self.try_write_nowait(buf) {
                Some(rc) => return rc,
                // Not a pipe as far as pwritev2 is concerned (tty, pty master, old kernel): remember, use the plain path.
                None => self.rwf_unsupported.set(true),
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
        let fd = self.handle.get_fd();
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
        write_fn: fn(Fd, &[u8]) -> sys::Result<usize>,
    ) -> WriteResult {
        let fd = self.handle.get_fd();
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

    /// Writes as much of `buf` as `event` says there is room for. `None` if there is nothing to do.
    fn write_on(&self, event: IoEvent, force_sync: bool, buf: &[u8]) -> Option<WriteResult> {
        log!("onPoll({})", buf.len());
        if buf.is_empty() {
            return event.is_hup().then_some(WriteResult::Wrote(0));
        }
        let room = match usize::try_from(event.size_or_offset) {
            Ok(room) if room > 0 && self.get_file_type().is_blocking() => room,
            _ => usize::MAX,
        };
        Some(self.try_write(force_sync, &buf[..buf.len().min(room)]))
    }

    fn register_poll(&self) -> sys::Result<()> {
        self.handle.register(FilePollFlag::Writable)
    }

    fn start_polling(&self, ev: EventLoopHandle, fd: Fd) -> sys::Result<()> {
        let had_poll = self.handle.has_poll();
        if !had_poll {
            self.handle.set_poll(ev, fd);
        } else if fd != self.handle.get_fd() {
            return sys::Result::Err(sys::Error::from_code(sys::E::EBUSY, sys::Tag::write));
        }
        self.register_poll().inspect_err(|_| {
            // A poll from an earlier start() still holds that start's fd.
            if !had_poll {
                self.handle.set_fd(Fd::INVALID);
            }
        })
    }

    fn update_ref(&self, value: bool) {
        self.handle
            .with_poll(|poll| poll.set_keeping_process_alive(value));
    }

    fn close_without_reporting(&self, close_fd: bool) {
        if !self.handle.is_closed() {
            debug_assert!(!self.closed_without_reporting.get());
            self.closed_without_reporting.set(true);
            if close_fd {
                self.handle.close();
            }
        }
    }

    /// `true` if there is a close to report.
    fn close(&self, close_fd: bool) -> bool {
        self.closed_without_reporting.take() || self.handle.close_impl(close_fd)
    }
}

/// Free fn for the blocking-pipe path; the other file types are handled
/// inline in `try_write` above.
#[cfg(unix)]
fn write_to_blocking_pipe(fd: Fd, buf: &[u8]) -> sys::Result<usize> {
    match bun_core::is_writable(fd) {
        bun_core::Pollable::Ready | bun_core::Pollable::Hup => sys::write(fd, buf),
        bun_core::Pollable::NotReady => sys::Result::Err(sys::Error::retry()),
    }
}

/// `send(2)` stands in for `write(2)` on the socketpair behind a child's stdio,
/// only to pass `MSG_NOSIGNAL`. The error names `write`, as Node does.
#[cfg(unix)]
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
pub struct KeepParentAlive<Parent: WriterParent>(NonNull<Parent>);

impl<Parent: WriterParent> KeepParentAlive<Parent> {
    /// # Safety
    /// `parent` must point to a live `Parent`.
    unsafe fn new(parent: *mut Parent) -> Self {
        // SAFETY: caller contract.
        unsafe {
            Parent::ref_(parent);
            Self(NonNull::new_unchecked(parent))
        }
    }
}

impl<Parent: WriterParent> Drop for KeepParentAlive<Parent> {
    fn drop(&mut self) {
        // SAFETY: the ref taken in `new` kept the parent live until here.
        unsafe { Parent::deref(self.0.as_ptr()) };
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
#[cfg(unix)]
pub trait PosixBufferedWriterParent: WriterParent {
    /// For `bun_runtime::dispatch::__bun_run_io`, which
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

#[cfg(unix)]
pub struct PosixBufferedWriter<Parent: PosixBufferedWriterParent> {
    pipe: PosixPipeWriter,
    /// `None` only between `Default` and `set_parent`; every dispatch path
    /// assumes it is set (see SAFETY comments at the call sites).
    pub parent: Option<bun_ptr::ParentRef<Parent, bun_ptr::Mut>>,
    pub(crate) pollable: bool,
    pub close_fd: bool,
}

#[cfg(unix)]
impl<Parent: PosixBufferedWriterParent> Default for PosixBufferedWriter<Parent> {
    fn default() -> Self {
        Self {
            pipe: PosixPipeWriter::closed(),
            parent: None,
            pollable: false,
            close_fd: true,
        }
    }
}

// SAFETY: writer is an intrusive field of `Parent`; `Parent::on_write`
// re-entry writes `is_done`/`handle` but never frees it; single JS thread.
#[cfg(unix)]
unsafe impl<Parent: PosixBufferedWriterParent> bun_ptr::LaunderedSelf
    for PosixBufferedWriter<Parent>
{
}

#[cfg(unix)]
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

    pub fn handle(&self) -> &PipeHandle {
        &self.pipe.handle
    }

    pub fn on_poll(&mut self, event: IoEvent) {
        match (self.pipe).write_on(event, false, self.get_buffer_internal()) {
            None => {}
            Some(WriteResult::Pending(wrote)) => {
                if wrote > 0 {
                    self._on_write(wrote, WriteStatus::Pending);
                }
                self.register_poll();
            }
            Some(WriteResult::Wrote(amt)) => self._on_write(amt, WriteStatus::Drained),
            Some(WriteResult::Err(err)) => self._on_error(err),
            Some(WriteResult::Done(amt)) => self._on_write(amt, WriteStatus::EndOfFile),
        }
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
        let was_done = Self::r(this).pipe.is_done.get();
        let parent = Self::r(this).parent();

        if status == WriteStatus::EndOfFile && !was_done {
            let writer = Self::r(this);
            writer.pipe.close_without_reporting(writer.close_fd);
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
        match self.pipe.register_poll() {
            sys::Result::Err(err) => {
                // Same report as a failed write (the streaming writer does the
                // same): parents expect every error to be followed by `on_close`.
                self._on_error(err);
            }
            sys::Result::Ok(()) => {}
        }
    }

    fn get_buffer_internal(&self) -> &[u8] {
        // SAFETY: parent is a BACKREF set via set_parent; valid while writer is
        // alive. Raw-ptr dispatch — no `&Parent` materialized.
        unsafe { Parent::get_buffer(self.parent()) }
    }

    pub fn end(&mut self) {
        if !self.pipe.is_done.replace(true) {
            self.close();
        }
    }

    pub fn close(&mut self) {
        if Parent::HAS_ON_CLOSE && self.pipe.close(self.close_fd) {
            // SAFETY: parent BACKREF valid.
            unsafe { Parent::on_close(self.parent()) };
        }
    }

    pub fn update_ref(&self, value: bool) {
        self.pipe.update_ref(value);
    }

    pub fn set_parent(&mut self, parent: *mut Parent) {
        // Reject null up front: every dispatch path past this point assumes
        // `self.parent` is set (see the type-invariant doc on `parent_event_loop`).
        let parent = core::ptr::NonNull::new(parent).expect("set_parent: parent must not be null");
        // SAFETY: caller passes the live owning `Parent` (write provenance).
        self.parent = Some(unsafe { bun_ptr::ParentRef::from_raw_mut(parent.as_ptr()) });
        let owner = Owner::new(Parent::POLL_OWNER_TAG, std::ptr::from_mut(self).cast());
        // SAFETY: `handle` is a field of its owner.
        unsafe { self.pipe.handle.set_owner(owner) };
    }

    pub fn watch(&mut self) {
        if self.pollable {
            let handle = &self.pipe.handle;
            if !handle.has_poll() && !handle.is_closed() {
                handle.set_poll(self.parent_event_loop(), handle.get_fd());
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
            debug_assert!(!self.pipe.handle.has_poll());
            self.pipe.handle.set_fd(fd);
            return sys::Result::Ok(());
        }
        self.pipe.start_polling(self.parent_event_loop(), fd)?;
        self.update_ref(true);
        sys::Result::Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PosixStreamingWriter
// ──────────────────────────────────────────────────────────────────────────

/// Shared borrows only: a handler can reach the writer again.
#[cfg(unix)]
pub struct PosixStreamingWriter {
    pipe: PosixPipeWriter,
    outgoing: Cell<StreamBuffer>,
    force_sync: Cell<bool>,
    /// Last reported `WriteStatus == Pending` (i.e. write(2) returned EAGAIN).
    backed_up: Cell<bool>,
}

#[cfg(unix)]
impl Default for PosixStreamingWriter {
    fn default() -> Self {
        Self {
            pipe: PosixPipeWriter::closed(),
            outgoing: Cell::default(),
            force_sync: Cell::new(false),
            backed_up: Cell::new(false),
        }
    }
}

/// The result of a write, and what `report` does about it.
#[cfg(unix)]
enum Written {
    /// Waits in `outgoing` for more.
    Coalesced(usize),
    Tried(WriteResult),
    /// The writer has ended.
    Refused,
}

#[cfg(unix)]
impl PosixStreamingWriter {
    // The smallest page size the target
    // supports (16K on Apple Silicon, 4K elsewhere among our targets).
    const CHUNK_SIZE: usize = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        16384
    } else {
        4096
    };

    /// `owner` is handed the events, to pass on to [`Self::on_io`].
    /// SAFETY: `owner` is what `__bun_run_io` takes its tag for, until `self` is dropped. `self` does
    /// not move, and is not borrowed mutably, until then.
    pub unsafe fn set_owner(&self, owner: Owner) {
        // SAFETY: caller contract.
        unsafe { self.pipe.handle.set_owner(owner) };
    }

    pub fn owner(&self) -> Owner {
        self.pipe.handle.owner()
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + with_buffer(&self.outgoing, |outgoing| outgoing.memory_cost())
    }

    pub fn set_force_sync(&self, value: bool) {
        self.force_sync.set(value);
    }

    pub fn set_poll_flag(&self, flag: FilePollFlag) {
        self.pipe.handle.set_poll_flag(flag);
    }

    pub fn has_pending_data(&self) -> bool {
        self.buffered_len() > 0
    }

    /// write(2) returned EAGAIN (distinct from has_pending_data()'s coalesce buffer).
    pub fn is_backed_up(&self) -> bool {
        self.backed_up.get()
    }

    /// Bytes accepted from callers that have not reached the fd yet.
    pub fn buffered_len(&self) -> usize {
        with_buffer(&self.outgoing, |outgoing| outgoing.size())
    }

    /// The part of `buffered_len` that `flush` would send.
    pub fn queued_len(&self) -> usize {
        self.buffered_len()
    }

    fn should_buffer(&self, len: usize) -> bool {
        !self.force_sync.get() && len < Self::CHUNK_SIZE
    }

    fn has_ended(&self) -> bool {
        self.pipe.is_done.get() || self.pipe.closed_without_reporting.get()
    }

    fn report_write(&self, handler: &impl WriteHandler, amount: usize, status: WriteStatus) {
        // on_write may re-enter write(); record first so re-entry leaves the newer value.
        self.backed_up.set(status == WriteStatus::Pending);
        handler.on_write(amount, status);
    }

    fn report_error(&self, handler: &impl WriteHandler, err: sys::Error) {
        handler.on_error(err);
        self.close(handler);
    }

    fn register_poll(&self, handler: &impl WriteHandler) {
        if let sys::Result::Err(err) = self.pipe.register_poll() {
            self.report_error(handler, err);
        }
    }

    pub fn on_io(&self, handler: &impl WriteHandler, event: IoEvent) {
        match self.drain_on(event) {
            None => {}
            Some(WriteResult::Pending(wrote)) => {
                if wrote > 0 {
                    self.report_write(handler, wrote, WriteStatus::Pending);
                }
                self.register_poll(handler);
            }
            // If the handler buffers more data, `write()` registers the poll.
            Some(WriteResult::Wrote(amt)) => self.report_write(handler, amt, WriteStatus::Drained),
            Some(WriteResult::Err(err)) => self.report_error(handler, err),
            Some(WriteResult::Done(amt)) => self.report_write(handler, amt, WriteStatus::EndOfFile),
        }
    }

    fn drain_on(&self, event: IoEvent) -> Option<WriteResult> {
        with_buffer(&self.outgoing, |outgoing| {
            let rc = (self.pipe).write_on(event, self.force_sync.get(), outgoing.slice())?;
            match rc {
                WriteResult::Pending(amt) => outgoing.wrote(amt),
                WriteResult::Wrote(amt) => {
                    outgoing.wrote(amt);
                    if outgoing.is_empty() {
                        outgoing.reset();
                    }
                }
                WriteResult::Done(amt) => {
                    outgoing.wrote(amt);
                    if !self.pipe.is_done.get() {
                        self.pipe.close_without_reporting(true);
                    }
                }
                WriteResult::Err(ref err) => {
                    debug_assert!(!err.is_retry());
                    self.pipe.close_without_reporting(true);
                    self.pipe.is_done.set(true);
                    outgoing.reset();
                }
            }
            Some(rc)
        })
    }

    fn report(&self, handler: &impl WriteHandler, written: Written) -> WriteResult {
        match written {
            Written::Refused => WriteResult::Done(0),
            Written::Coalesced(amt) => {
                // Lets the handler schedule a flush.
                self.report_write(handler, amt, WriteStatus::Drained);
                self.register_poll(handler);

                // it's buffered, but should be reported as written to callers
                WriteResult::Wrote(amt)
            }
            Written::Tried(rc) => {
                match rc {
                    WriteResult::Pending(amt) => {
                        self.report_write(handler, amt, WriteStatus::Pending);
                        self.register_poll(handler);
                    }
                    WriteResult::Wrote(amt) => {
                        self.report_write(handler, amt, WriteStatus::Drained)
                    }
                    WriteResult::Done(amt) => {
                        self.report_write(handler, amt, WriteStatus::EndOfFile)
                    }
                    WriteResult::Err(_) => {}
                }
                rc
            }
        }
    }

    pub fn write_utf16(&self, handler: &impl WriteHandler, buf: &[u16]) -> WriteResult {
        self.report(handler, self.accept_utf16(buf))
    }

    pub fn write_latin1(&self, handler: &impl WriteHandler, buf: &[u8]) -> WriteResult {
        self.report(handler, self.accept_latin1(buf))
    }

    pub fn write(&self, handler: &impl WriteHandler, buf: &[u8]) -> WriteResult {
        self.report(handler, self.accept(buf))
    }

    fn accept_utf16(&self, buf: &[u16]) -> Written {
        self.accept_encoded(|outgoing| outgoing.write_utf16(buf))
    }

    fn accept_latin1(&self, buf: &[u8]) -> Written {
        if bun_core::strings::is_all_ascii(buf) {
            return self.accept(buf);
        }

        const CHECK_ASCII: bool = false;
        self.accept_encoded(|outgoing| outgoing.write_latin1::<CHECK_ASCII>(buf))
    }

    fn accept_encoded(&self, encode: impl FnOnce(&mut StreamBuffer) -> Result<(), OOM>) -> Written {
        if self.has_ended() {
            return Written::Refused;
        }
        with_buffer(&self.outgoing, |outgoing| {
            let before_len = outgoing.size();
            if encode(outgoing).is_err() {
                return Written::Tried(WriteResult::Err(sys::Error::oom()));
            }
            if self.should_buffer(outgoing.size()) {
                return Written::Coalesced(outgoing.size() - before_len);
            }
            self.try_write_newly_buffered_data(outgoing)
        })
    }

    fn try_write_newly_buffered_data(&self, outgoing: &mut StreamBuffer) -> Written {
        let rc = self.pipe.try_write(self.force_sync.get(), outgoing.slice());
        match rc {
            WriteResult::Wrote(_) | WriteResult::Done(_) => outgoing.reset(),
            WriteResult::Pending(amt) => outgoing.wrote(amt),
            WriteResult::Err(_) => {}
        }
        Written::Tried(rc)
    }

    fn accept(&self, buf: &[u8]) -> Written {
        if self.has_ended() {
            return Written::Refused;
        }
        with_buffer(&self.outgoing, |outgoing| {
            // this is streaming, but we buffer the data below `chunk_size` to
            // reduce the number of writes
            let should_buffer = self.should_buffer(outgoing.size() + buf.len());
            // make sure write is in-order
            if should_buffer || outgoing.is_not_empty() {
                if outgoing.write(buf).is_err() {
                    return Written::Tried(WriteResult::Err(sys::Error::oom()));
                }
                if should_buffer {
                    return Written::Coalesced(buf.len());
                }
                return self.try_write_newly_buffered_data(outgoing);
            }

            let rc = self.pipe.try_write(self.force_sync.get(), buf);
            match rc {
                WriteResult::Pending(amt) => {
                    if outgoing.write(&buf[amt..]).is_err() {
                        return Written::Tried(WriteResult::Err(sys::Error::oom()));
                    }
                }
                WriteResult::Wrote(_) | WriteResult::Done(_) => outgoing.reset(),
                WriteResult::Err(_) => {}
            }
            Written::Tried(rc)
        })
    }

    /// Only Windows reports from here.
    pub fn flush(&self, _: &impl WriteHandler) -> WriteResult {
        self.drain()
    }

    fn drain(&self) -> WriteResult {
        if self.has_ended() {
            return WriteResult::Done(0);
        }
        with_buffer(&self.outgoing, |outgoing| {
            if outgoing.is_empty() {
                outgoing.reset();
                return WriteResult::Wrote(0);
            }

            let rc = self.pipe.try_write(self.force_sync.get(), outgoing.slice());
            match rc {
                WriteResult::Pending(written) => outgoing.wrote(written),
                _ => outgoing.reset(),
            }
            // Leftover bytes = kernel refused them.
            self.backed_up.set(outgoing.is_not_empty());
            rc
        })
    }

    pub fn update_ref(&self, value: bool) {
        if value && self.pipe.is_done.get() {
            return;
        }
        self.pipe.update_ref(value);
    }

    pub fn end(&self, handler: &impl WriteHandler) {
        if !self.pipe.is_done.replace(true) {
            self.close(handler);
        }
    }

    pub fn close(&self, handler: &impl WriteHandler) {
        if self.pipe.close(true) {
            handler.on_close();
        }
    }

    /// On `Err` the writer holds nothing; `fd` is still the caller's to close.
    pub fn start(
        &self,
        handler: &impl WriteHandler,
        ev: EventLoopHandle,
        fd: Fd,
        is_pollable: bool,
    ) -> sys::Result<()> {
        if is_pollable {
            return self.pipe.start_polling(ev, fd);
        }
        self.close(handler);
        self.pipe.handle.set_fd(fd);
        sys::Result::Ok(())
    }
}

#[cfg(unix)]
impl Drop for PosixStreamingWriter {
    fn drop(&mut self) {
        self.pipe.handle.close();
    }
}

/// What libuv completed.
#[cfg(windows)]
pub struct WriteEvent(Completion);

#[cfg(windows)]
enum Completion {
    Wrote,
    StreamFailed(sys::Error),
    FileFailed(sys::Error),
    VmTeardown,
}

/// A source, and the one write that libuv may have on it. Shared borrows only: libuv holds its address.
#[cfg(windows)]
struct WindowsPipeWriter {
    source: Cell<Option<Source>>,
    owner: Cell<Owner>,
    /// `false` for a file descriptor that was passed in, which is left open.
    owns_fd: Cell<bool>,
    is_done: Cell<bool>,
    closed_without_reporting: Cell<bool>,
    /// libuv reads the bytes of `payload`, and for a stream uses `write_req`.
    in_flight: Cell<bool>,
    write_req: UnsafeCell<uv::uv_write_t>,
    /// Of the write in flight, or of one that failed.
    payload: Cell<StreamBuffer>,
}

#[cfg(windows)]
impl WindowsPipeWriter {
    fn closed() -> Self {
        Self {
            source: Cell::new(None),
            owner: Cell::new(Owner::NULL),
            owns_fd: Cell::new(true),
            is_done: Cell::new(false),
            closed_without_reporting: Cell::new(false),
            in_flight: Cell::new(false),
            write_req: UnsafeCell::new(bun_core::ffi::zeroed()),
            payload: Cell::default(),
        }
    }

    /// `None` without a source. `f` finds `self` without one.
    fn with_source<R>(&self, f: impl FnOnce(&mut Source) -> R) -> Option<R> {
        let mut source = self.source.take()?;
        let result = f(&mut source);
        self.source.set(Some(source));
        Some(result)
    }

    fn has_source(&self) -> bool {
        self.with_source(|_| ()).is_some()
    }

    fn payload_len(&self) -> usize {
        with_buffer(&self.payload, |payload| payload.size())
    }

    /// `self` for libuv to keep, which `set_owner`'s contract allows.
    fn as_uv_data(&self) -> *mut Self {
        assert!(!self.owner.get().ptr().is_null(), "writer has no owner");
        core::ptr::from_ref(self).cast_mut()
    }

    /// From now on a VM teardown closes `source` through this writer.
    fn set_source(&self, mut source: Source) {
        assert!(!self.has_source() && !self.in_flight.get());
        source.set_owner(self.as_uv_data().cast(), Self::stop_for_vm_teardown);
        self.source.set(Some(source));
    }

    fn update_ref(&self, value: bool) {
        self.with_source(if value { Source::ref_ } else { Source::unref });
    }

    /// The owner may free `self`.
    /// SAFETY: `this` is `as_uv_data` of a live writer.
    unsafe fn dispatch(this: *mut Self, completion: Completion) {
        let event = IoEvent::Write(WriteEvent(completion));
        // SAFETY: fn contract, and `set_owner`'s.
        unsafe { __bun_run_io((*this).owner.get(), event) };
    }

    /// `uv::open_handles` closes this writer's stream through here at teardown.
    unsafe fn stop_for_vm_teardown(this: *mut c_void) {
        // SAFETY: recorded by `set_source`. Closing the source takes it off the list.
        unsafe { Self::dispatch(this.cast(), Completion::VmTeardown) };
    }

    fn on_stream_write(this: *mut Self, status: uv::ReturnCode) {
        let completion = match status.to_error(sys::Tag::write) {
            Some(err) => Completion::StreamFailed(err),
            None => Completion::Wrote,
        };
        // SAFETY: set by `submit`. `Drop` does not return while the write is in flight.
        unsafe {
            (*this).in_flight.set(false);
            Self::dispatch(this, completion);
        }
    }

    unsafe extern "C" fn on_file_write(fs: *mut uv::fs_t) {
        // SAFETY: the callback of `submit_write`.
        let Some((result, this)) = (unsafe { File::on_complete(fs) }) else {
            return;
        };
        let completion = match result.to_error(sys::Tag::write) {
            Some(err) => Completion::FileFailed(err),
            None => Completion::Wrote,
        };
        let this = this.cast::<Self>();
        // SAFETY: set by `set_source`, and cleared by dropping the file.
        unsafe {
            (*this).in_flight.set(false);
            Self::dispatch(this, completion);
        }
    }

    /// Returns the length it had.
    fn reset_payload(&self) -> usize {
        assert!(!self.in_flight.get());
        with_buffer(&self.payload, |payload| {
            let len = payload.size();
            payload.reset();
            len
        })
    }

    /// Writes the payload that `fill` leaves, which does not run without a source.
    fn submit(&self, fill: impl FnOnce(&mut StreamBuffer)) -> sys::Result<()> {
        assert!(!self.in_flight.get());
        let submitted = self.with_source(|source| {
            let buf = with_buffer(&self.payload, |payload| {
                fill(payload);
                uv::uv_buf_t::init(payload.slice())
            });
            match source {
                Source::SyncFile(_) => panic!("sync_file pipe write should not be reachable"),
                // SAFETY: nothing changes the payload in flight but `close_source`, which gives it to the file.
                Source::File(file) => unsafe { file.submit_write(buf, Self::on_file_write) },
                // SAFETY: the request and the payload are libuv's until `on_stream_write`. It copies `buf`.
                stream => unsafe { &mut *self.write_req.get() }
                    .write(
                        stream.to_stream(),
                        &buf,
                        self.as_uv_data(),
                        Self::on_stream_write,
                    )
                    .to_result(sys::Tag::write),
            }
        });
        submitted.unwrap_or_else(|| Err(sys::Error::from_code(sys::E::PIPE, sys::Tag::pipe)))?;
        self.in_flight.set(true);
        sys::Result::Ok(())
    }

    /// `false` if there was none. `cancel_inflight_write` cancels a `uv_fs_write` that hasn't started yet.
    fn close_source(&self, cancel_inflight_write: bool) -> bool {
        self.is_done.set(true);
        let Some(source) = self.source.take() else {
            return false;
        };
        match source {
            Source::SyncFile(file) | Source::File(file) => {
                if file.is_busy() {
                    // The write still reads the payload, and its callback will not get back here.
                    file.buffer.set(self.payload.take().list);
                    self.in_flight.set(false);
                }
                file.close_on_drop.set(self.owns_fd.get());
                if cancel_inflight_write {
                    file.stop();
                }
            }
            Source::Pipe(pipe) => drop(pipe),
            Source::Tty(tty) => tty.close(),
        }
        true
    }

    fn close(&self, handler: &impl WriteHandler, cancel_inflight_write: bool) {
        let was_in_flight = self.in_flight.get();
        if !self.close_source(cancel_inflight_write) {
            return;
        }
        if was_in_flight && !self.in_flight.get() {
            handler.on_write_in_flight(false);
        }
        if !self.closed_without_reporting.get() {
            handler.on_close();
        }
    }

    /// Closes the old source before a restart, like the POSIX writer.
    fn close_for_restart(&self, handler: &impl WriteHandler) -> sys::Result<()> {
        // The callback of a cancelled `uv_write` would close the new source.
        if self.in_flight.get() && self.with_source(|source| source.file().is_some()) != Some(true)
        {
            return sys::Result::Err(sys::Error::from_code(sys::E::BUSY, sys::Tag::write));
        }
        // Canceling an in-flight write would drop its bytes, so let it finish writing to the old file.
        self.close(handler, false);
        // The handler has started the writer.
        if self.has_source() || self.in_flight.get() {
            return sys::Result::Err(sys::Error::from_code(sys::E::BUSY, sys::Tag::write));
        }
        // Free a failed write's payload.
        self.payload.take();
        self.is_done.set(false);
        sys::Result::Ok(())
    }
}

#[cfg(windows)]
impl Drop for WindowsPipeWriter {
    fn drop(&mut self) {
        self.close_source(true);
        assert!(!self.in_flight.get(), "writer dropped under a uv_write");
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
pub trait BaseWindowsPipeWriter: Sized {
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
    fn closed_without_reporting(&self) -> bool;
    fn set_closed_without_reporting(&mut self, v: bool);
    fn take_write_ref(&mut self) -> Option<KeepParentAlive<Self::Parent>>;

    /// Returns true if the callback of a write is still to come.
    fn has_inflight_write(&self) -> bool;

    /// `uv::open_handles` closes this writer's stream through here at teardown.
    unsafe fn stop_for_vm_teardown(this: *mut c_void) {
        // SAFETY: recorded via `Source::set_owner` by this live writer; cleared
        // when the writer closes (source taken → uv_close → off the list).
        unsafe { (*this.cast::<Self>()).close() };
    }

    /// Close the source without invoking `Parent::on_close` — for `Drop`, where
    /// the parent is mid-teardown. Error paths use `close()` so the parent
    /// still observes `on_close`.
    fn close_without_reporting(&mut self) {
        if self.source().is_some() {
            self.set_closed_without_reporting(true);
            // Last: `close()` may drop the parent's final ref and free `self`.
            self.close();
        }
    }

    fn close(&mut self) {
        self.close_impl(true);
    }

    /// If `cancel_inflight_write` is set, cancels a `uv_fs_write` that hasn't started yet.
    fn close_impl(&mut self, cancel_inflight_write: bool) {
        self.set_is_done(true);
        let Some(source) = self.source_mut().take() else {
            return;
        };
        let mut _write_ref = None;
        match source {
            Source::SyncFile(file) | Source::File(file) => {
                if file.is_busy() {
                    // The callback of the write will not get back here.
                    _write_ref = self.take_write_ref();
                }
                file.close_on_drop.set(self.owns_fd());
                if cancel_inflight_write {
                    file.stop();
                }
            }
            Source::Pipe(pipe) => drop(pipe),
            Source::Tty(tty) => tty.close(),
        }
        self.on_close_source();
    }

    fn update_ref(&mut self, value: bool) {
        if let Some(pipe) = self.source_mut().as_mut() {
            if value {
                pipe.ref_();
            } else {
                pipe.unref();
            }
        }
    }

    /// Also the single point where this writer records itself as the owner a
    /// VM teardown stops its pipe/tty through: every way a source is installed
    /// (`start`, `set_pipe`, `start_with_file`)
    /// funnels through here.
    fn set_parent(&mut self, parent: *mut Self::Parent) {
        self.set_parent_ptr(parent);
        if !self.is_done() {
            // raw self-ptr first to dodge the immutable-then-mutable conflict
            let self_ptr = core::ptr::from_mut(self).cast::<c_void>();
            if let Some(source) = self.source_mut().as_mut() {
                source.set_owner(self_ptr, Self::stop_for_vm_teardown);
            }
        }
    }

    fn watch(&mut self) {
        // no-op
    }

    /// Closes the old source before a restart, like the POSIX writer.
    fn close_current_source(&mut self) -> sys::Result<()> {
        match self.source() {
            // The callback of a cancelled `uv_write` would close the new source.
            None | Some(Source::Pipe(_) | Source::Tty(_)) if self.has_inflight_write() => {
                return sys::Result::Err(sys::Error::from_code(sys::E::BUSY, sys::Tag::write));
            }
            None => {}
            // Canceling an in-flight write would drop its bytes, so let it finish writing to the old file.
            Some(_) => self.close_impl(false),
        }
        // `set_parent` only records the new source's owner while `is_done` is false.
        self.set_is_done(false);
        sys::Result::Ok(())
    }

    fn start_with_file(&mut self, fd: Fd) -> sys::Result<()> {
        debug_assert!(self.source().is_none());
        // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
        let loop_ = unsafe { Self::Parent::loop_(self.parent_ptr()) };
        let mut source = Source::File(Source::open_file(loop_, fd));
        source.set_data(core::ptr::from_mut(self).cast::<c_void>());
        *self.source_mut() = Some(source);
        let p = self.parent_ptr();
        self.set_parent(p);
        self.start_with_current_pipe()
    }

    // TODO: MovableIfWindowsFd overload — add a separate start_movable().
    fn start(&mut self, rawfd: Fd, _pollable: bool) -> sys::Result<()> {
        let fd = rawfd;
        self.close_current_source()?;
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

    fn set_pipe(&mut self, pipe: uv::Owned<uv::Pipe>) {
        debug_assert!(self.source().is_none());
        *self.source_mut() = Some(Source::Pipe(pipe));
        let p = self.parent_ptr();
        self.set_parent(p);
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
pub trait WindowsWriterParent: WriterParent {
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn loop_(this: *mut Self) -> &'static bun_uws_sys::Loop;
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
    pub(crate) parent: *mut Parent,
    pub(crate) is_done: bool,
    /// Set by `Drop`: the parent is going away, close without `on_close`.
    pub(crate) closed_without_reporting: bool,
    // we use only one write_req, any queued data in outgoing will be flushed after this ends
    pub(crate) write_req: uv::uv_write_t,
    pub(crate) write_buffer: uv::uv_buf_t,
    /// Held while a write is in flight.
    write_ref: Option<KeepParentAlive<Parent>>,
    pub(crate) pending_payload_size: usize,
}

#[cfg(windows)]
impl<Parent: WindowsBufferedWriterParent> Default for WindowsBufferedWriter<Parent> {
    fn default() -> Self {
        Self {
            source: None,
            owns_fd: true,
            parent: core::ptr::null_mut(),
            is_done: false,
            closed_without_reporting: false,
            write_req: bun_core::ffi::zeroed(),
            write_buffer: uv::uv_buf_t::init(b""),
            write_ref: None,
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
        if self.closed_without_reporting {
            return;
        }
        if Parent::HAS_ON_CLOSE {
            // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
            unsafe { Parent::on_close(self.parent) };
        }
    }
    fn closed_without_reporting(&self) -> bool {
        self.closed_without_reporting
    }
    fn set_closed_without_reporting(&mut self, v: bool) {
        self.closed_without_reporting = v;
    }
    fn take_write_ref(&mut self) -> Option<KeepParentAlive<Parent>> {
        self.write_ref.take()
    }

    fn has_inflight_write(&self) -> bool {
        self.write_ref.is_some()
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
// alive across the callback by `write_ref`; single JS thread.
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
    /// `on_fs_write_complete` into one.
    #[inline(always)]
    fn r_on_error(this: *mut Self, err: sys::Error) {
        let parent = Self::r(this).parent;
        // SAFETY: type invariant — set-once parent backref outlives writer.
        unsafe { Parent::on_error(parent, err) }
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
        let _write_ref = Self::r(this).write_ref.take();
        let written = Self::r(this).pending_payload_size;
        Self::r(this).pending_payload_size = 0;
        if let Some(err) = status.to_error(sys::Tag::write) {
            Self::r(this).close();
            Self::r_on_error(this, err);
            return;
        }
        let pending = Self::r(this).get_buffer_internal();
        // `close()` may have run before this callback (exit-first ordering) and
        // cleared the parent's buffer to 0 while `written` still carries the
        // submitted size; treat that as no pending data rather than underflowing.
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

    extern "C" fn on_fs_write_complete(fs: *mut uv::fs_t) {
        // SAFETY: the callback of a write on the source.
        let Some((result, parent_ptr)) = (unsafe { crate::source::File::on_complete(fs) }) else {
            return;
        };
        let was_canceled = result.int() == uv::UV_ECANCELED as i64;

        // PORT_NOTES_PLAN R-2: launder `*this` for the same reason as the
        // Streaming sibling above — `close()` → `Parent::on_close` → JS may
        // re-enter via `with_mut(|w| ..)`; the post-call `(*this).parent()`
        // must reload.
        // SAFETY: data was set to `self as *mut Self` in write(); libuv invokes
        // this callback on the single-threaded event loop with no other Rust
        // borrow of `*this` live, so this is the sole access path.
        let this: *mut Self = core::hint::black_box(parent_ptr.cast::<Self>());

        if was_canceled {
            Self::r(this).pending_payload_size = 0;
            drop(Self::r(this).write_ref.take());
            return;
        }

        if let Some(err) = result.to_error(sys::Tag::write) {
            let _write_ref = Self::r(this).write_ref.take();
            // close() may re-enter JS.
            Self::r(this).close();
            core::hint::black_box(this);
            // `r_on_error` re-reads `.parent` after the close() re-entry.
            Self::r_on_error(this, err);
            return;
        }

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
                Some(Source::File(f)) => (f.as_ptr(), core::ptr::null_mut()),
                Some(s) => (core::ptr::null_mut(), s.to_stream()),
            };

        if !file_raw.is_null() {
            // SAFETY: see raw-ptr break note above.
            let file = unsafe { &*file_raw };
            // BufferedWriter ensures pending_payload_size blocks concurrent writes
            debug_assert!(file.can_start());

            self.pending_payload_size = buffer_len;
            file.parent.set(core::ptr::from_mut(self).cast::<c_void>());
            file.prepare();
            self.write_buffer = write_buf;

            // SAFETY: file is fully initialized; libuv stores the cb and fires
            // it on the event loop. parent BACKREF valid.
            if let Some(err) = unsafe {
                uv::uv_fs_write(
                    Parent::loop_(self.parent()).uv_loop(),
                    file_raw.cast(),
                    file.file,
                    &self.write_buffer,
                    1,
                    -1,
                    Some(Self::on_fs_write_complete),
                )
            }
            .to_error(sys::Tag::write)
            {
                // SAFETY: refused.
                unsafe { file.complete(false) };
                self.close();
                self.parent_on_error(err);
            } else {
                // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
                self.write_ref = Some(unsafe { KeepParentAlive::new(self.parent()) });
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
                // SAFETY: parent is BACKREF set via set_parent; valid while writer alive.
                self.write_ref = Some(unsafe { KeepParentAlive::new(self.parent()) });
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

    /// `chunk` as UTF-8, which goes through `self` only if it has to be encoded.
    #[cfg(windows)]
    fn write_or_fallback<'a>(&'a mut self, chunk: WriteChunk<'a>) -> Result<&'a [u8], OOM> {
        match chunk {
            WriteChunk::Bytes(bytes) => return Ok(bytes),
            WriteChunk::Latin1(bytes) if bun_core::strings::is_all_ascii(bytes) => {
                return Ok(bytes);
            }
            WriteChunk::Latin1(bytes) => self.write_latin1::<false>(bytes)?,
            WriteChunk::Utf16(text) => self.write_utf16(text)?,
        }
        Ok(self.slice())
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
        self.compact();
        ByteVecExt::write_utf16(&mut self.list, buffer)?;
        Ok(())
    }

    pub fn slice(&self) -> &[u8] {
        &self.list[self.cursor..]
    }
}

/// `f` finds `cell` empty.
fn with_buffer<R>(cell: &Cell<StreamBuffer>, f: impl FnOnce(&mut StreamBuffer) -> R) -> R {
    let mut buffer = cell.take();
    let result = f(&mut buffer);
    cell.set(buffer);
    result
}

#[cfg(windows)]
enum WriteChunk<'a> {
    Bytes(&'a [u8]),
    Latin1(&'a [u8]),
    Utf16(&'a [u16]),
}

// ──────────────────────────────────────────────────────────────────────────
// WindowsStreamingWriter
// ──────────────────────────────────────────────────────────────────────────

/// Shared borrows only: a handler can reach the writer again.
#[cfg(windows)]
pub struct WindowsStreamingWriter {
    pipe: WindowsPipeWriter,
    /// Becomes the payload once the write in flight has ended.
    outgoing: Cell<StreamBuffer>,
}

#[cfg(windows)]
impl Default for WindowsStreamingWriter {
    fn default() -> Self {
        Self {
            pipe: WindowsPipeWriter::closed(),
            outgoing: Cell::default(),
        }
    }
}

#[cfg(windows)]
impl WindowsStreamingWriter {
    /// SAFETY: see `PosixStreamingWriter::set_owner`.
    pub unsafe fn set_owner(&self, owner: Owner) {
        self.pipe.owner.set(owner);
    }

    pub fn owner(&self) -> Owner {
        self.pipe.owner.get()
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>()
            + with_buffer(&self.pipe.payload, |payload| payload.memory_cost())
            + with_buffer(&self.outgoing, |outgoing| outgoing.memory_cost())
    }

    pub fn owns_fd(&self) -> bool {
        self.pipe.owns_fd.get()
    }

    pub fn set_owns_fd(&self, value: bool) {
        self.pipe.owns_fd.set(value);
    }

    pub fn is_done(&self) -> bool {
        self.pipe.is_done.get()
    }

    pub fn has_pending_data(&self) -> bool {
        self.buffered_len() > 0
    }

    /// process_send found a uv_write already in flight (the payload alone is not backpressure).
    pub fn is_backed_up(&self) -> bool {
        self.queued_len() > 0
    }

    /// Bytes accepted from callers that have not reached the fd yet.
    pub fn buffered_len(&self) -> usize {
        self.queued_len() + self.pipe.payload_len()
    }

    /// See `PosixStreamingWriter::queued_len`.
    pub fn queued_len(&self) -> usize {
        with_buffer(&self.outgoing, |outgoing| outgoing.size())
    }

    /// For the next `start` or `flush` to send.
    pub fn enqueue(&self, bytes: &[u8]) -> Result<(), OOM> {
        with_buffer(&self.outgoing, |outgoing| outgoing.write(bytes))
    }

    pub fn discard_queued(&self) {
        self.outgoing.take();
    }

    pub fn update_ref(&self, value: bool) {
        self.pipe.update_ref(value);
    }

    /// `false` if the source is not a stream that can block.
    pub fn set_blocking(&self) -> bool {
        self.get_stream().is_some_and(|stream| {
            // SAFETY: the stream of the source.
            unsafe { uv::uv_stream_set_blocking(stream, 1) == uv::ReturnCode::ZERO }
        })
    }

    pub fn get_stream(&self) -> Option<*mut uv::uv_stream_t> {
        (self.pipe).with_source(|source| source.file().is_none().then(|| source.to_stream()))?
    }

    fn sync_fd(&self) -> Option<Fd> {
        (self.pipe)
            .with_source(|source| matches!(source, Source::SyncFile(_)).then(|| source.get_fd()))?
    }

    pub fn set_pipe(&self, pipe: uv::Owned<uv::Pipe>) {
        self.pipe.set_source(Source::Pipe(pipe));
    }

    pub fn start_with_current_pipe(&self, handler: &impl WriteHandler) {
        debug_assert!(self.pipe.has_source());
        self.pipe.is_done.set(false);
        // The old source's write never reports completion, so send the queued chunks here.
        if self.is_backed_up() && self.sync_fd().is_none() {
            self.process_send(handler);
        }
    }

    pub fn start_sync(
        &self,
        handler: &impl WriteHandler,
        ev: EventLoopHandle,
        fd: Fd,
    ) -> sys::Result<()> {
        // A `SyncFile` writes each chunk synchronously and can't drain a queue.
        if self.is_backed_up() {
            return sys::Result::Err(sys::Error::from_code(sys::E::BUSY, sys::Tag::write));
        }
        self.pipe.close_for_restart(handler)?;
        (self.pipe).set_source(Source::SyncFile(Source::open_file(ev.loop_(), fd)));
        sys::Result::Ok(())
    }

    /// A pipe or a tty owns `fd` on `Ok`.
    pub fn start(
        &self,
        handler: &impl WriteHandler,
        ev: EventLoopHandle,
        fd: Fd,
        _pollable: bool,
    ) -> sys::Result<()> {
        self.pipe.close_for_restart(handler)?;
        self.pipe.set_source(Source::open(ev.loop_(), fd)?);
        self.start_with_current_pipe(handler);
        sys::Result::Ok(())
    }

    pub fn on_io(&self, handler: &impl WriteHandler, event: IoEvent) {
        let IoEvent::Write(WriteEvent(completion)) = event else {
            unreachable!("a read was passed to a writer");
        };
        if !matches!(completion, Completion::VmTeardown) {
            handler.on_write_in_flight(false);
        }
        match completion {
            Completion::Wrote => self.on_write_complete(handler, self.pipe.reset_payload()),
            Completion::StreamFailed(err) => self.report_error(handler, err),
            Completion::FileFailed(err) => {
                self.close(handler);
                handler.on_error(err);
            }
            Completion::VmTeardown => self.close(handler),
        }
    }

    fn report_error(&self, handler: &impl WriteHandler, err: sys::Error) {
        log!("onWrite() = {}", bstr::BStr::new(err.name()));
        handler.on_error(err);
        self.close(handler);
    }

    fn on_write_complete(&self, handler: &impl WriteHandler, written: usize) {
        log!("onWrite({}) ({} left)", written, self.queued_len());

        if self.is_backed_up() {
            handler.on_write(written, WriteStatus::Pending);
        } else if self.is_done() {
            // we already call .end lets close the connection
            return handler.on_write(written, WriteStatus::EndOfFile);
        } else {
            handler.on_write(written, WriteStatus::Drained);
        }

        // process pending outgoing data if any
        self.process_send(handler);

        // TODO: should we report writable?
        handler.on_writable();
    }

    /// this tries to send more data returning if we are writable or not after this
    fn process_send(&self, handler: &impl WriteHandler) -> WriteResult {
        log!("processSend");
        if self.pipe.payload_len() > 0 {
            // we have some pending async request, the next outgoing data will be processed after this finish
            return WriteResult::Pending(0);
        }
        // nothing todo (we assume we are writable until we try to write something)
        if !self.is_backed_up() {
            return WriteResult::Wrote(0);
        }
        match self.submit_outgoing() {
            sys::Result::Ok(()) => {
                handler.on_write_in_flight(true);
                WriteResult::Pending(0)
            }
            sys::Result::Err(err) => {
                self.report_error(handler, err.clone());
                WriteResult::Err(err)
            }
        }
    }

    fn submit_outgoing(&self) -> sys::Result<()> {
        with_buffer(&self.outgoing, |outgoing| {
            self.pipe.submit(|payload| mem::swap(payload, outgoing))
        })
    }

    /// `None` if `chunk` is first in the queue.
    fn accept(&self, chunk: WriteChunk<'_>) -> Option<WriteResult> {
        if self.is_done() {
            return Some(WriteResult::Done(0));
        }
        with_buffer(&self.outgoing, |outgoing| {
            if let Some(fd) = self.sync_fd() {
                let result = match outgoing.write_or_fallback(chunk) {
                    Ok(bytes) => write_sync(fd, bytes),
                    Err(_) => WriteResult::Err(sys::Error::oom()),
                };
                outgoing.reset();
                return Some(result);
            }

            let had_buffered_data = outgoing.is_not_empty();
            let appended = match chunk {
                WriteChunk::Bytes(bytes) => outgoing.write(bytes),
                WriteChunk::Latin1(bytes) => outgoing.write_latin1::<true>(bytes),
                WriteChunk::Utf16(text) => outgoing.write_utf16(text),
            };
            if appended.is_err() {
                return Some(WriteResult::Err(sys::Error::oom()));
            }
            had_buffered_data.then_some(WriteResult::Pending(0))
        })
    }

    pub fn write_utf16(&self, handler: &impl WriteHandler, buf: &[u16]) -> WriteResult {
        (self.accept(WriteChunk::Utf16(buf))).unwrap_or_else(|| self.process_send(handler))
    }

    pub fn write_latin1(&self, handler: &impl WriteHandler, buf: &[u8]) -> WriteResult {
        (self.accept(WriteChunk::Latin1(buf))).unwrap_or_else(|| self.process_send(handler))
    }

    pub fn write(&self, handler: &impl WriteHandler, buf: &[u8]) -> WriteResult {
        (self.accept(WriteChunk::Bytes(buf))).unwrap_or_else(|| self.process_send(handler))
    }

    pub fn flush(&self, handler: &impl WriteHandler) -> WriteResult {
        if self.is_done() {
            return WriteResult::Done(0);
        }
        self.process_send(handler)
    }

    pub fn end(&self, handler: &impl WriteHandler) {
        if self.pipe.is_done.replace(true) {
            return;
        }
        self.pipe.closed_without_reporting.set(false);
        if !self.has_pending_data() && self.owns_fd() {
            self.close(handler);
        }
    }

    pub fn close(&self, handler: &impl WriteHandler) {
        self.pipe.close(handler, true);
    }

    /// `close` without `on_close`.
    pub fn close_without_reporting(&self, handler: &impl WriteHandler) {
        if self.pipe.has_source() {
            self.pipe.closed_without_reporting.set(true);
            self.close(handler);
        }
    }
}

#[cfg(windows)]
fn write_sync(fd: Fd, bytes: &[u8]) -> WriteResult {
    let mut remain = bytes;
    while !remain.is_empty() {
        match sys::write(fd, remain) {
            sys::Result::Err(err) => return WriteResult::Err(err),
            sys::Result::Ok(0) => break,
            sys::Result::Ok(wrote) => remain = &remain[wrote..],
        }
    }

    match bytes.len() - remain.len() {
        0 => WriteResult::Done(0),
        wrote => WriteResult::Wrote(wrote),
    }
}

#[cfg(windows)]
impl<Parent: WindowsBufferedWriterParent> Drop for WindowsBufferedWriter<Parent> {
    fn drop(&mut self) {
        // The parent is going away.
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
pub type StreamingWriter = PosixStreamingWriter;
#[cfg(not(unix))]
pub type StreamingWriter = WindowsStreamingWriter;

// ──────────────────────────────────────────────────────────────────────────
// Parent-vtable shim macros
// ──────────────────────────────────────────────────────────────────────────
//
// The `*WriterParent` traits are monomorphic function tables whose every
// method is `unsafe fn(this: *mut Self, ..)`
// that derefs the BACKREF and forwards to an inherent method. Every concrete
// parent needs the same triple of cfg-gated impls,
// differing only in:
//   (a) the inherent-method names the vtable forwards to,
//   (b) how the callback is dispatched off `*mut Self` — as `&mut` or `&`,
//   (c) the `event_loop` / `loop_` / refcount accessor expressions.
// This macro stamps that triple once per parent.
//
// `borrow = mut`    → bodies form `&mut *this` (unique access for the
//                     callback's duration; the writer never holds
//                     `&mut Parent` itself).
// `borrow = shared` → bodies form `&*this` (callback may re-enter JS or
//                     `enqueue(&self)` and observe a fresh `&Self`; aliased
//                     `&Self` is sound where `&mut Self` is not).
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
    pub use ::bun_uws_sys::Loop as UwsLoop;
}

/// Stamp `WriterParent` + `PosixBufferedWriterParent` + `WindowsWriterParent` +
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
        uws_loop   = |$uws_this:ident| $uws:expr,
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

        #[cfg(windows)]
        impl $($gen)* $crate::pipe_writer::WindowsWriterParent for $Ty {
            #[inline]
            unsafe fn loop_(this: *mut Self) -> &'static $crate::pipe_writer::__parent_macro::UwsLoop {
                // SAFETY: BACKREF set via `set_parent`; shared-only read.
                let $uws_this = this;
                #[allow(unused_unsafe)]
                unsafe { $uws }
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
