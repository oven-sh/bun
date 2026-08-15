use core::ffi::c_void;
use core::mem;
use core::ptr::NonNull;

use bun_sys::{self as sys, Fd};

use crate::{EventLoopHandle, FilePollFlag, FilePollKind, FilePollRef, Owner, PollTag};
// `bun.Async.Loop` — on POSIX the uws `us_loop_t`, on Windows the embedded
// `uv_loop_t` (`bun_io::Loop` is the cfg-aliased nominal that picks the
// right one). `BufferedReaderParent::loop_` returns this so callers in T3+
// can hand it to libuv/uws without a cross-crate cast.
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

#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(windows)]
// `close`/`set_data`/`is_closed` are default trait methods; bring traits into
// scope so method resolution finds them on `Pipe`/`uv_tty_t`/`fs_t`.
use bun_sys::windows::libuv::UvHandle as _;

// All logging in this module goes through `bun.sys.syslog` (the `SYS` scope)
// or `libuv::log!`.

// ──────────────────────────────────────────────────────────────────────────
// BufferedReaderVTable
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct BufferedReaderVTable {
    pub(crate) parent: *mut c_void,
    pub(crate) kind: crate::BufferedReaderParentLinkKind,
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
    unsafe fn ref_(this: *mut Self) {
        let _ = this;
    }
    unsafe fn deref(this: *mut Self) {
        let _ = this;
    }
}

impl BufferedReaderVTable {
    fn init<T: BufferedReaderParent>() -> BufferedReaderVTable {
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

    fn event_loop(&self) -> EventLoopHandle {
        self.link().event_loop()
    }

    fn loop_(&self) -> *mut Loop {
        self.link().loop_ptr()
    }

    fn is_streaming_enabled(&self) -> bool {
        self.link().has_on_read_chunk()
    }

    /// When the reader has read a chunk of data
    /// and hasMore is true, it means that there might be more data to read.
    /// Returning false prevents the reader from reading more data.
    fn on_read_chunk(&self, chunk: &[u8], has_more: ReadState) -> bool {
        self.link().on_read_chunk(chunk, has_more)
    }

    fn on_reader_done(&self) {
        self.link().on_reader_done()
    }

    fn on_reader_error(&self, err: sys::Error) {
        self.link().on_reader_error(err)
    }

    #[must_use]
    pub(crate) fn ref_parent(self) -> ParentKeepAlive {
        self.link().ref_();
        ParentKeepAlive(self)
    }
}

pub(crate) struct ParentKeepAlive(BufferedReaderVTable);

impl Drop for ParentKeepAlive {
    fn drop(&mut self) {
        self.0.link().deref();
    }
}

// The per-loop `pipe_read_buffer` scratch is handed to `on_read_chunk` as the
// chunk itself, and a consumer may keep parsing it while running user code
// that starts a *second* reader synchronously (HTMLRewriter handlers do). A
// nested read loop must not refill the scratch under the outer one, so only
// the outermost loop on the thread borrows it; nested ones read into their
// own `_buffer`.
thread_local! {
    static READ_SCRATCH_IN_USE: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

struct ReadScratchClaim;

impl ReadScratchClaim {
    fn try_claim() -> Option<Self> {
        READ_SCRATCH_IN_USE.with(|in_use| (!in_use.replace(true)).then_some(Self))
    }
}

impl Drop for ReadScratchClaim {
    fn drop(&mut self) {
        READ_SCRATCH_IN_USE.with(|in_use| in_use.set(false));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PosixBufferedReader
// ──────────────────────────────────────────────────────────────────────────

pub struct PosixBufferedReader {
    pub handle: PollOrFd,
    pub _buffer: Vec<u8>,
    pub(crate) _offset: usize,
    pub(crate) vtable: BufferedReaderVTable,
    pub flags: PosixFlags,
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
        const KEEP_ALIVE               = 1 << 10; // default true
    }
}

impl PosixFlags {
    pub(crate) const fn new() -> Self {
        Self::from_bits_truncate(PosixFlags::CLOSE_HANDLE.bits() | PosixFlags::KEEP_ALIVE.bits())
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
            maxbuf: None,
        }
    }

    pub fn update_ref(&mut self, value: bool) {
        // Remember the ref state so a poll created later (lazy start) honours
        // an unref() that preceded the first registration.
        self.flags.set(PosixFlags::KEEP_ALIVE, value);
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

    pub(crate) fn get_file_type(&self) -> FileType {
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
        // SAFETY: `self` is live. Note: this `&mut self` receiver still carries
        // a protector across the (maybe-freeing) done dispatch — pre-existing
        // on the parent chain, tracked with the raw-dispatch follow-up.
        unsafe { Self::close_handle(std::ptr::from_mut(self)) };
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

    pub fn disable_keeping_process_alive<C>(&mut self, _event_loop_ctx: C) {
        self.update_ref(false);
    }

    fn finish(&mut self) {
        if !matches!(self.handle, PollOrFd::Closed)
            || self.flags.contains(PosixFlags::CLOSED_WITHOUT_REPORTING)
        {
            if self.flags.contains(PosixFlags::CLOSE_HANDLE) {
                // SAFETY: `self` is live. Note: this `&mut self` receiver still carries
                // a protector across the (maybe-freeing) done dispatch — pre-existing
                // on the parent chain, tracked with the raw-dispatch follow-up.
                unsafe { Self::close_handle(std::ptr::from_mut(self)) };
            }
            return;
        }

        debug_assert!(!self.flags.contains(PosixFlags::IS_DONE));
        self.flags.insert(PosixFlags::IS_DONE);
        self._buffer.shrink_to_fit();
    }

    /// # Safety
    /// `this` is the live reader. Raw (not `&mut self`): the `done` it can
    /// reach dispatches `on_reader_done`, which may drop the last reference to
    /// the struct embedding `*this` — a free must never run under a live
    /// receiver protector.
    unsafe fn close_handle(this: *mut Self) {
        // SAFETY: caller contract; borrows end at each `;`.
        let deferred_report =
            unsafe { (*this).flags.contains(PosixFlags::CLOSED_WITHOUT_REPORTING) };
        if deferred_report {
            // SAFETY: caller contract; borrow ends before the (maybe-freeing) done.
            unsafe {
                (*this).flags.remove(PosixFlags::CLOSED_WITHOUT_REPORTING);
                Self::done(this);
            }
            return;
        }

        // SAFETY: caller contract; the `handle` borrow is scoped to the call.
        // The close callback receives the same raw pointer, so its `done` also
        // runs without a receiver borrow.
        unsafe {
            if (*this).flags.contains(PosixFlags::CLOSE_HANDLE) {
                (*this).handle.close(
                    Some(this.cast::<c_void>()),
                    // SAFETY: ctx is the live reader raw pointer passed above.
                    Some(|ctx: *mut c_void| Self::done(ctx.cast::<PosixBufferedReader>())),
                );
            }
        }
    }

    /// # Safety
    /// Same contract as [`Self::close_handle`]: `this` is live, and the
    /// terminal `on_reader_done` dispatch may free the parent embedding
    /// `*this`, so it runs with no `&Self`/`&mut Self` live.
    pub(crate) unsafe fn done(this: *mut Self) {
        // SAFETY: caller contract; borrows end at each `;`.
        unsafe {
            if !matches!((*this).handle, PollOrFd::Closed)
                && (*this).flags.contains(PosixFlags::CLOSE_HANDLE)
            {
                Self::close_handle(this);
                return;
            } else if (*this).flags.contains(PosixFlags::CLOSED_WITHOUT_REPORTING) {
                (*this).flags.remove(PosixFlags::CLOSED_WITHOUT_REPORTING);
            }
            (*this).finish();
        }
        // Copy the (Copy) vtable out so no borrow of `*this` spans the
        // callback, which may free the parent.
        // SAFETY: caller contract.
        let vtable = unsafe { (*this).vtable };
        vtable.on_reader_done();
    }

    /// # Safety
    /// `this` is live; `on_reader_error` may free the parent embedding
    /// `*this`, so it runs with no borrow of `*this` live.
    pub unsafe fn on_error(this: *mut Self, err: sys::Error) {
        // SAFETY: caller contract; the (Copy) vtable is copied out first.
        let vtable = unsafe { (*this).vtable };
        vtable.on_reader_error(err);
    }

    /// Returns `false` when registration failed and `on_reader_error` was
    /// dispatched. That callback may drop the last reference to the struct
    /// embedding `*this` (the shell `PipeReader` does exactly that), so the
    /// caller must not touch `this` again after a `false` return.
    ///
    /// # Safety
    /// `this` is the live reader; the error dispatch runs with no borrow of
    /// `*this` live, so the free is never under a receiver protector.
    pub(crate) unsafe fn register_poll(this: *mut Self) -> bool {
        // SAFETY: caller contract; `try_register_poll`'s receiver borrow ends
        // when it returns — before the dispatch below.
        match unsafe { (*this).try_register_poll() } {
            Ok(()) => true,
            Err(err) => {
                // SAFETY: caller contract; (Copy) vtable copied out, no borrow
                // of `*this` spans the (maybe-freeing) callback.
                let vtable = unsafe { (*this).vtable };
                vtable.on_reader_error(err);
                false
            }
        }
    }

    fn try_register_poll(&mut self) -> Result<(), sys::Error> {
        // pause() may land from inside on_read_chunk's JS re-entry while the
        // loop's own re-arm is still ahead on the stack.
        if self.flags.contains(PosixFlags::IS_PAUSED) {
            return Ok(());
        }
        // Hoist vtable-derived scalars and
        // normalize self.handle to Poll before taking the single &mut borrow,
        // so no raw-pointer escape is needed.
        let ev = self.vtable.event_loop();
        let lp = self.vtable.loop_();
        let owner_ptr = std::ptr::from_mut(self).cast::<c_void>();

        if let PollOrFd::Fd(fd) = self.handle {
            if !self.flags.contains(PosixFlags::POLLABLE) {
                return Ok(());
            }
            self.handle = PollOrFd::Poll(FilePollRef::init(
                ev,
                fd,
                Owner::new(PollTag::BufferedReader, owner_ptr.cast()),
            ));
        }
        let Some(poll) = self.handle.get_poll_mut() else {
            return Ok(());
        };
        poll.set_owner(Owner::new(PollTag::BufferedReader, owner_ptr.cast()));

        if !poll.has_flag(FilePollFlag::WasEverRegistered)
            && self.flags.contains(PosixFlags::KEEP_ALIVE)
        {
            poll.enable_keeping_process_alive(ev);
        }

        match poll.register_with_fd(lp.cast(), FilePollKind::Readable, poll.fd()) {
            sys::Result::Err(err) => Err(err),
            sys::Result::Ok(()) => Ok(()),
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
        if !self.flags.contains(PosixFlags::IS_PAUSED) {
            // SAFETY: `self` is live. Note: this `&mut self` receiver still carries
            // a protector across the (maybe-freeing) error dispatch — pre-existing
            // on the parent chain, tracked with the raw-dispatch follow-up.
            unsafe { Self::register_poll(std::ptr::from_mut(self)) };
        }

        sys::Result::Ok(())
    }

    pub fn start_file_offset(&mut self, fd: Fd, poll: bool, offset: usize) -> sys::Result<()> {
        self._offset = offset;
        self.flags.insert(PosixFlags::USE_PREAD);
        self.start(fd, poll)
    }

    // Exists for consistently with Windows.
    pub fn has_pending_read(&self) -> bool {
        // `is_watching()` (registered && !needs-rearm) rather than
        // `is_registered()`: a one-shot poll that has fired but not been
        // re-armed will not deliver another callback, so callers that skip
        // `read()` on "pending" must not be told one is in flight.
        matches!(&self.handle, PollOrFd::Poll(poll) if poll.is_watching())
    }

    pub fn watch(&mut self) {
        if self.flags.contains(PosixFlags::POLLABLE)
            && !matches!(&self.handle, PollOrFd::Poll(poll) if poll.is_watching())
        {
            // SAFETY: `self` is live. Note: this `&mut self` receiver still carries
            // a protector across the (maybe-freeing) error dispatch — pre-existing
            // on the parent chain, tracked with the raw-dispatch follow-up.
            unsafe { Self::register_poll(std::ptr::from_mut(self)) };
        }
    }

    pub fn has_pending_activity(&self) -> bool {
        match &self.handle {
            PollOrFd::Poll(poll) => poll.is_active(),
            PollOrFd::Fd(_) => true,
            _ => false,
        }
    }

    /// # Safety
    /// `this` is the live reader. Raw (not `&mut self`) because
    /// `on_read_chunk` dispatched from the read loops re-enters JS, which can
    /// reach this reader again through its parent — a protected `&mut`
    /// spanning that re-entry is exactly the aliasing this API avoids.
    pub unsafe fn read(this: *mut Self) {
        // SAFETY: caller contract — `this` is live; borrows end at each `;`.
        let (paused, fd, file_type, vtable) = unsafe {
            (
                (*this).flags.contains(PosixFlags::IS_PAUSED),
                (*this).get_fd(),
                (*this).get_file_type(),
                (*this).vtable,
            )
        };
        // Don't initiate new reads if paused
        if paused {
            return;
        }
        // As in `on_poll`: the synchronous read loops below dispatch
        // `on_read_chunk` and touch `*this` afterwards, so the parent (which
        // embeds this reader) must outlive them.
        let _parent = vtable.ref_parent();

        match file_type {
            FileType::NonblockingPipe => {
                // SAFETY: caller contract.
                unsafe { Self::read_pipe(this, fd, 0, false) };
            }
            FileType::File => {
                // SAFETY: caller contract.
                unsafe { Self::read_file(this, fd, 0, false) };
            }
            FileType::Socket => {
                // SAFETY: caller contract.
                unsafe { Self::read_socket(this, fd, 0, false) };
            }
            FileType::Pipe => match bun_core::is_readable(fd) {
                bun_core::Pollable::Ready => {
                    // SAFETY: caller contract.
                    unsafe { Self::read_from_blocking_pipe_without_blocking(this, fd, 0, false) };
                }
                bun_core::Pollable::Hup => {
                    // SAFETY: caller contract.
                    unsafe { Self::read_from_blocking_pipe_without_blocking(this, fd, 0, true) };
                }
                bun_core::Pollable::NotReady => {
                    // SAFETY: caller contract; borrow scoped to the call.
                    unsafe { Self::register_poll(this) };
                }
            },
        }
    }

    /// # Safety
    /// `this` is the live reader registered as the poll's user data; see
    /// [`Self::read`] for why the entry is raw.
    pub unsafe fn on_poll(this: *mut PosixBufferedReader, size_hint: isize, received_hup: bool) {
        // SAFETY: caller contract — `this` is live; borrows end at each `;`.
        let (paused, fd, file_type, vtable) = unsafe {
            (
                (*this).flags.contains(PosixFlags::IS_PAUSED),
                (*this).get_fd(),
                (*this).get_file_type(),
                (*this).vtable,
            )
        };
        if paused {
            return;
        }
        bun_sys::syslog!("onPoll({}) = {}", fd, size_hint);
        let _parent = vtable.ref_parent();

        match file_type {
            FileType::NonblockingPipe => {
                // SAFETY: caller contract.
                unsafe { Self::read_pipe(this, fd, size_hint, received_hup) };
            }
            FileType::File => {
                // SAFETY: caller contract.
                unsafe { Self::read_file(this, fd, size_hint, received_hup) };
            }
            FileType::Socket => {
                // SAFETY: caller contract.
                unsafe { Self::read_socket(this, fd, size_hint, received_hup) };
            }
            FileType::Pipe => {
                // SAFETY: caller contract.
                unsafe {
                    Self::read_from_blocking_pipe_without_blocking(
                        this,
                        fd,
                        size_hint,
                        received_hup,
                    )
                };
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

    /// Charges `bytes_read` against the `maxBuffer` budget, returning `true`
    /// once it is gone. The overflow callback only kills the child, which takes
    /// effect asynchronously, so the caller must also stop reading.
    #[inline]
    fn charge_max_buffer(parent: &mut PosixBufferedReader, bytes_read: usize) -> bool {
        let Some(maxbuf) = parent.maxbuf else {
            return false;
        };
        MaxBuf::on_read_bytes(maxbuf, bytes_read as u64)
    }

    /// Closes the handle so the child cannot put more bytes in the pipe, then
    /// reports what was buffered. Raw (not `&mut`) like [`Self::done`]: the
    /// `done` dispatch may free the parent embedding `*this`, so no receiver
    /// protector may be live around it. Callers must already have handed the
    /// overflowing chunk to the consumer.
    ///
    /// # Safety
    /// `this` is the live reader.
    unsafe fn stop_for_max_buffer(this: *mut PosixBufferedReader) {
        // SAFETY: caller contract; the borrow ends at `;`, before the dispatch.
        let already_done = unsafe {
            (*this).close_without_reporting();
            (*this).flags.contains(PosixFlags::IS_DONE)
        };
        if !already_done {
            // SAFETY: caller contract; no borrow of `*this` is live.
            unsafe { Self::done(this) };
        }
    }

    /// # Safety
    /// Same contract as [`Self::read`].
    unsafe fn read_file(
        this: *mut PosixBufferedReader,
        fd: Fd,
        size_hint: isize,
        received_hup: bool,
    ) {
        fn pread_fn(fd1: Fd, buf: &mut [u8], offset: usize) -> sys::Result<usize> {
            sys::pread(fd1, buf, i64::try_from(offset).expect("int cast"))
        }
        // SAFETY: caller contract; borrow ends at `;`.
        let use_pread = unsafe { (*this).flags.contains(PosixFlags::USE_PREAD) };
        if use_pread {
            // SAFETY: caller contract.
            unsafe {
                Self::read_with_fn(this, FileType::File, fd, size_hint, received_hup, pread_fn)
            };
        } else {
            // SAFETY: caller contract.
            unsafe {
                Self::read_with_fn(
                    this,
                    FileType::File,
                    fd,
                    size_hint,
                    received_hup,
                    |fd, buf, _| sys::read(fd, buf),
                )
            };
        }
    }

    /// # Safety
    /// Same contract as [`Self::read`].
    unsafe fn read_socket(
        this: *mut PosixBufferedReader,
        fd: Fd,
        size_hint: isize,
        received_hup: bool,
    ) {
        // SAFETY: caller contract.
        unsafe {
            Self::read_with_fn(
                this,
                FileType::Socket,
                fd,
                size_hint,
                received_hup,
                |fd, buf, _| sys::recv_non_block(fd, buf),
            )
        };
    }

    /// # Safety
    /// Same contract as [`Self::read`].
    unsafe fn read_pipe(
        this: *mut PosixBufferedReader,
        fd: Fd,
        size_hint: isize,
        received_hup: bool,
    ) {
        // SAFETY: caller contract.
        unsafe {
            Self::read_with_fn(
                this,
                FileType::NonblockingPipe,
                fd,
                size_hint,
                received_hup,
                |fd, buf, _| sys::read_nonblocking(fd, buf),
            )
        };
    }

    /// # Safety
    /// `this` is the live reader (an inline field of its parent).
    /// `on_read_chunk` re-entry never frees it (`BufferedReaderParent`
    /// contract) but may mutate it — no borrow of `*this` is held across any
    /// dispatch below. `on_error()` / `done()` MAY free the parent, so both
    /// are dispatched in tail position.
    unsafe fn read_blocking_pipe(
        this: *mut PosixBufferedReader,
        fd: Fd,
        _size_hint: isize,
        received_hup_initially: bool,
    ) {
        // The vtable is two Copy scalars set once at `start()`; copying it out
        // lets every `on_read_chunk` dispatch run with no borrow of `*this`.
        // SAFETY: caller contract — `this` is live.
        let vtable = unsafe { (*this).vtable };
        let mut received_hup = received_hup_initially;
        let scratch = ReadScratchClaim::try_claim();
        loop {
            let streaming = vtable.is_streaming_enabled();
            let mut got_retry = false;

            // SAFETY: caller contract; borrow ends at `;`.
            let unbuffered = scratch.is_some() && unsafe { (*this)._buffer.is_empty() };
            if unbuffered {
                // Use stack buffer for streaming — per-loop scratch buffer;
                // single-threaded event loop (see `EventLoopCtx::pipe_read_buffer_mut`).
                // SAFETY: caller contract; `maxbuf` is Copy.
                let maxbuf = unsafe { (*this).maxbuf };
                let stack_buffer = vtable.event_loop().pipe_read_buffer_mut();
                let stack_buffer = MaxBuf::clamp_read_buf(maxbuf, stack_buffer);

                match sys::read_nonblocking(fd, stack_buffer) {
                    sys::Result::Ok(bytes_read) => {
                        // SAFETY: caller contract; borrow scoped to the call.
                        let over_budget =
                            Self::charge_max_buffer(unsafe { &mut *this }, bytes_read);

                        if bytes_read == 0 {
                            // EOF - finished and closed pipe
                            // SAFETY: caller contract; `done()` is the tail.
                            unsafe {
                                (*this).close_without_reporting();
                                if !(*this).flags.contains(PosixFlags::IS_DONE) {
                                    Self::done(this);
                                }
                            }
                            return;
                        }

                        if streaming {
                            // Stream this chunk and register for next cycle
                            let keep_going = vtable.on_read_chunk(
                                &stack_buffer[..bytes_read],
                                if received_hup && bytes_read < stack_buffer.len() {
                                    ReadState::Eof
                                } else {
                                    ReadState::Progress
                                },
                            );
                            // Re-entrant JS inside on_read_chunk can close the
                            // reader (nested on_pull -> read -> EOF); the
                            // captured `fd` is then stale regardless of HUP.
                            // SAFETY: caller contract (re-entry never frees `*this`).
                            if unsafe { (*this).is_done() } {
                                return;
                            }
                            if !keep_going && !received_hup && !over_budget {
                                return;
                            }
                        } else {
                            // SAFETY: caller contract; borrow ends at `;`.
                            unsafe {
                                (*this)
                                    ._buffer
                                    .extend_from_slice(&stack_buffer[..bytes_read]);
                            }
                        }

                        if over_budget {
                            // SAFETY: caller contract; tail position, raw entry.
                            unsafe { Self::stop_for_max_buffer(this) };
                            return;
                        }
                    }
                    sys::Result::Err(err) => {
                        if !err.is_retry() {
                            // SAFETY: caller contract; `on_error` is the tail.
                            unsafe { Self::on_error(this, err) };
                            return;
                        }
                        // EAGAIN - fall through to register for next poll
                        got_retry = true;
                    }
                }
            } else {
                // SAFETY: caller contract; `maxbuf` is Copy, borrow ends at `;`.
                let maxbuf = unsafe { (*this).maxbuf };
                // SAFETY: caller contract; borrow ends at `;`.
                unsafe { (*this)._buffer.reserve(16 * 1024) };
                // SAFETY: caller contract. `sys::read_nonblocking` writes only
                // initialized bytes into the prefix it reports; `commit_spare`
                // exposes exactly that prefix. The `_buffer` borrow ends before
                // any dispatch.
                let read_result = unsafe {
                    let buf = bun_core::vec::spare_bytes_mut(&mut (*this)._buffer);
                    let buf = MaxBuf::clamp_read_buf(maxbuf, buf);
                    let buf_len = buf.len();
                    (sys::read_nonblocking(fd, buf), buf_len)
                };
                match read_result {
                    (sys::Result::Ok(bytes_read), buf_len) => {
                        // SAFETY: caller contract; borrow scoped to the call.
                        let over_budget =
                            Self::charge_max_buffer(unsafe { &mut *this }, bytes_read);
                        // SAFETY: caller contract; `bytes_read` bytes were just
                        // initialized by the syscall; borrows end at each `;`.
                        unsafe {
                            (*this)._offset += bytes_read;
                            bun_core::vec::commit_spare(&mut (*this)._buffer, bytes_read);
                        }

                        if bytes_read == 0 {
                            // SAFETY: caller contract; `done()` is the tail.
                            unsafe {
                                (*this).close_without_reporting();
                                if !(*this).flags.contains(PosixFlags::IS_DONE) {
                                    Self::done(this);
                                }
                            }
                            return;
                        }

                        if streaming {
                            // Move the buffer out for the dispatch so re-entrant
                            // access to the reader cannot alias or reallocate it
                            // under the chunk slice.
                            // SAFETY: caller contract; borrow ends at `;`.
                            let buffer = unsafe { core::mem::take(&mut (*this)._buffer) };
                            let new_len = buffer.len();
                            let keep_going = vtable.on_read_chunk(
                                &buffer[new_len - bytes_read..new_len],
                                if received_hup && bytes_read < buf_len {
                                    ReadState::Eof
                                } else {
                                    ReadState::Progress
                                },
                            );
                            // Delivered bytes are consumed by `on_read_chunk`; keep only what re-entry buffered.
                            // SAFETY: caller contract; borrows end at the block.
                            unsafe {
                                let mut buffer = buffer;
                                buffer.clear();
                                buffer.extend_from_slice(&(*this)._buffer);
                                (*this)._buffer = buffer;
                            }
                            // SAFETY: caller contract.
                            if unsafe { (*this).is_done() } {
                                return;
                            }
                            // Closing for `over_budget` outranks the
                            // consumer asking us to stop: it must still
                            // happen, or nothing ever caps the pipe.
                            if !keep_going && !over_budget {
                                return;
                            }
                        }

                        if over_budget {
                            // SAFETY: caller contract; tail position, raw entry.
                            unsafe { Self::stop_for_max_buffer(this) };
                            return;
                        }
                    }
                    (sys::Result::Err(err), _) => {
                        if !err.is_retry() {
                            // SAFETY: caller contract; `on_error` is the tail.
                            unsafe { Self::on_error(this, err) };
                            return;
                        }
                        got_retry = true;
                    }
                }
            }

            // Register for next poll cycle unless we got HUP
            if !received_hup {
                // SAFETY: caller contract; borrow scoped to the call.
                unsafe { Self::register_poll(this) };
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
                // SAFETY: caller contract; borrow scoped to the call.
                unsafe { Self::register_poll(this) };
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
                    // SAFETY: caller contract; borrow scoped to the call.
                    unsafe { Self::register_poll(this) };
                    return;
                }
            }
        }
    }

    // PERF: `file_type` is a runtime arg (adt_const_params is unstable); `sys_fn`
    // is generic so it still monomorphizes — profile if hot.
    /// # Safety
    /// Same contract as [`Self::read_blocking_pipe`]: `this` is live, re-entry
    /// through `on_read_chunk` may mutate but never frees `*this`, and no
    /// borrow of `*this` is held across any dispatch; `on_error()` / `done()`
    /// are tail-positioned because they may free the parent.
    unsafe fn read_with_fn(
        this: *mut PosixBufferedReader,
        file_type: FileType,
        fd: Fd,
        _size_hint: isize,
        received_hup: bool,
        sys_fn: impl Fn(Fd, &mut [u8], usize) -> sys::Result<usize>,
    ) {
        // Copy scalars set once at `start()`; dispatching through the copy
        // keeps `*this` unborrowed across every re-entry point.
        // SAFETY: caller contract — `this` is live.
        let vtable = unsafe { (*this).vtable };
        let streaming = vtable.is_streaming_enabled();
        let scratch = ReadScratchClaim::try_claim();

        if streaming && scratch.is_some() {
            // Per-loop scratch buffer; single-threaded event loop (see
            // `EventLoopCtx::pipe_read_buffer_mut`).
            let event_loop = vtable.event_loop();
            let stack_buffer_len = event_loop.pipe_read_buffer_mut().len();
            // SAFETY: caller contract; borrow ends at the loop test.
            while unsafe { (*this)._buffer.is_empty() } {
                let stack_buffer_cutoff = stack_buffer_len / 2;
                let mut head_start = 0usize; // index into stack_buffer where the unwritten head begins
                while stack_buffer_len - head_start > 16 * 1024 {
                    // SAFETY: caller contract; the `maxbuf`/`_offset` reads end
                    // before the syscall's buffer borrow (event-loop scratch,
                    // not `*this`).
                    let (maxbuf, offset) = unsafe { ((*this).maxbuf, (*this)._offset) };
                    let buf = &mut event_loop.pipe_read_buffer_mut()[head_start..];
                    let buf = MaxBuf::clamp_read_buf(maxbuf, buf);

                    match sys_fn(fd, buf, offset) {
                        sys::Result::Ok(bytes_read) => {
                            // SAFETY: caller contract; borrow scoped to the call.
                            let over_budget =
                                Self::charge_max_buffer(unsafe { &mut *this }, bytes_read);
                            // SAFETY: caller contract; borrow ends at `;`.
                            unsafe { (*this)._offset += bytes_read };
                            head_start += bytes_read;

                            // `over_budget` is terminal for the same reason EOF
                            // is: the child was killed and nothing past the cap
                            // may reach the consumer.
                            if bytes_read == 0 || over_budget {
                                // SAFETY: caller contract; borrow ends at `;`.
                                unsafe { (*this).close_without_reporting() };
                                if head_start > 0 {
                                    let _ = vtable.on_read_chunk(
                                        &event_loop.pipe_read_buffer_mut()[..head_start],
                                        ReadState::Eof,
                                    );
                                }
                                // SAFETY: caller contract; `done()` is the tail.
                                unsafe {
                                    if !(*this).flags.contains(PosixFlags::IS_DONE) {
                                        Self::done(this);
                                    }
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
                                let keep_going = vtable.on_read_chunk(
                                    &event_loop.pipe_read_buffer_mut()[..head_start],
                                    if received_hup {
                                        ReadState::Eof
                                    } else {
                                        ReadState::Progress
                                    },
                                );
                                // Re-entrant close (nested on_pull -> read ->
                                // EOF) invalidates the captured `fd`; stop
                                // before the next recv regardless of HUP.
                                // SAFETY: caller contract.
                                if unsafe { (*this).is_done() } {
                                    return;
                                }
                                if !keep_going && !received_hup {
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
                                } else {
                                    // SAFETY: caller contract; borrow scoped to
                                    // the call. `on_reader_error` from a failed
                                    // re-arm may have freed the struct embedding
                                    // `*this`; the drained head must not be
                                    // delivered.
                                    if !unsafe { Self::register_poll(this) } {
                                        return;
                                    }
                                }

                                if head_start > 0 {
                                    let _ = vtable.on_read_chunk(
                                        &event_loop.pipe_read_buffer_mut()[..head_start],
                                        ReadState::Drained,
                                    );
                                }
                                return;
                            }

                            if head_start > 0 {
                                let _ = vtable.on_read_chunk(
                                    &event_loop.pipe_read_buffer_mut()[..head_start],
                                    ReadState::Progress,
                                );
                            }
                            // SAFETY: caller contract; `on_error` is the tail.
                            unsafe { Self::on_error(this, err) };
                            return;
                        }
                    }
                }

                if head_start > 0 {
                    let keep_going = vtable.on_read_chunk(
                        &event_loop.pipe_read_buffer_mut()[..head_start],
                        if received_hup {
                            ReadState::Eof
                        } else {
                            ReadState::Progress
                        },
                    );
                    // SAFETY: caller contract.
                    if unsafe { (*this).is_done() } {
                        return;
                    }
                    if !keep_going && !received_hup {
                        return;
                    }
                }

                if !vtable.is_streaming_enabled() {
                    break;
                }
            }
        } else {
            // SAFETY: caller contract; borrows end at `;`.
            let take_stack_path = !streaming
                && scratch.is_some()
                && unsafe { (*this)._buffer.capacity() == 0 && (*this)._offset == 0 };
            if take_stack_path {
                // Avoid a 16 KB dynamic memory allocation when the buffer might very well be empty.
                // Per-loop scratch buffer; single-threaded event loop (see
                // `EventLoopCtx::pipe_read_buffer_mut`).
                // SAFETY: caller contract; `maxbuf` is Copy.
                let maxbuf = unsafe { (*this).maxbuf };
                let stack_buffer = vtable.event_loop().pipe_read_buffer_mut();
                let stack_buffer = MaxBuf::clamp_read_buf(maxbuf, stack_buffer);

                // Unlike the block of code following this one, only handle the non-streaming case.
                debug_assert!(!streaming);

                match sys_fn(fd, stack_buffer, 0) {
                    sys::Result::Ok(bytes_read) => {
                        if bytes_read > 0 {
                            // SAFETY: caller contract; borrow ends at `;`.
                            unsafe {
                                (*this)
                                    ._buffer
                                    .extend_from_slice(&stack_buffer[..bytes_read]);
                            }
                        }
                        // SAFETY: caller contract; borrow scoped to the call.
                        let over_budget =
                            Self::charge_max_buffer(unsafe { &mut *this }, bytes_read);
                        // SAFETY: caller contract; borrow ends at `;`.
                        unsafe { (*this)._offset += bytes_read };

                        // `over_budget` is terminal for the same reason EOF is: the
                        // child was killed and nothing past the cap may be buffered.
                        if bytes_read == 0 || over_budget {
                            // Move the buffer out so a re-entrant read cannot
                            // alias it across the drain dispatch.
                            // SAFETY: caller contract; borrows end at each `;`.
                            let buffer = unsafe {
                                (*this).close_without_reporting();
                                core::mem::take(&mut (*this)._buffer)
                            };
                            let delivered = vtable.is_streaming_enabled() && !buffer.is_empty();
                            let _ = Self::drain_chunk(&vtable, &buffer, ReadState::Eof);
                            // SAFETY: caller contract; `done()` is the tail.
                            unsafe {
                                if !delivered {
                                    let mut buffer = buffer;
                                    buffer.extend_from_slice(&(*this)._buffer);
                                    (*this)._buffer = buffer;
                                }
                                if !(*this).flags.contains(PosixFlags::IS_DONE) {
                                    Self::done(this);
                                }
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
                                // SAFETY: caller contract; borrow scoped to the call.
                                unsafe { Self::register_poll(this) };
                            }
                            return;
                        }
                        // SAFETY: caller contract; `on_error` is the tail.
                        unsafe { Self::on_error(this, err) };
                        return;
                    }
                }

                // Allow falling through
            }
        }

        loop {
            // SAFETY: caller contract. The `_buffer` borrow (reserve + spare
            // prefix) and the syscall both end inside this block, before any
            // dispatch.
            let read_result = unsafe {
                let maxbuf = (*this).maxbuf;
                (*this)._buffer.reserve(16 * 1024);
                let buf = bun_core::vec::spare_bytes_mut(&mut (*this)._buffer);
                let buf = MaxBuf::clamp_read_buf(maxbuf, buf);
                sys_fn(fd, buf, (*this)._offset)
            };

            match read_result {
                sys::Result::Ok(bytes_read) => {
                    // SAFETY: caller contract; borrow scoped to the call.
                    let over_budget = Self::charge_max_buffer(unsafe { &mut *this }, bytes_read);
                    // SAFETY: caller contract; `bytes_read` bytes were just
                    // initialized by `sys_fn`; borrows end at each `;`.
                    unsafe {
                        (*this)._offset += bytes_read;
                        bun_core::vec::commit_spare(&mut (*this)._buffer, bytes_read);
                    }

                    // `over_budget` is terminal for the same reason EOF is: the
                    // child was killed and nothing past the cap may be buffered.
                    if bytes_read == 0 || over_budget {
                        // SAFETY: caller contract; borrows end at each `;`.
                        let buffer = unsafe {
                            (*this).close_without_reporting();
                            core::mem::take(&mut (*this)._buffer)
                        };
                        let delivered = vtable.is_streaming_enabled() && !buffer.is_empty();
                        let _ = Self::drain_chunk(&vtable, &buffer, ReadState::Eof);
                        // SAFETY: caller contract; `done()` is the tail.
                        unsafe {
                            if !delivered {
                                let mut buffer = buffer;
                                buffer.extend_from_slice(&(*this)._buffer);
                                (*this)._buffer = buffer;
                            }
                            if !(*this).flags.contains(PosixFlags::IS_DONE) {
                                Self::done(this);
                            }
                        }
                        return;
                    }

                    if vtable.is_streaming_enabled() {
                        // SAFETY: caller contract; borrow ends at `;`.
                        let over_highwater = unsafe { (*this)._buffer.len() > 128_000 };
                        if over_highwater {
                            // Move the buffer out for the dispatch, then
                            // reinstall it cleared (matching the pre-existing
                            // clear-after-dispatch semantics).
                            // SAFETY: caller contract; borrow ends at `;`.
                            let mut buffer = unsafe { core::mem::take(&mut (*this)._buffer) };
                            let keep_going = vtable.on_read_chunk(&buffer, ReadState::Progress);
                            buffer.clear();
                            // SAFETY: caller contract; borrows end at each `;`.
                            unsafe {
                                (*this)._buffer = buffer;
                                if (*this).is_done() || !keep_going {
                                    return;
                                }
                            }
                            continue;
                        }
                    }
                }
                sys::Result::Err(err) => {
                    if vtable.is_streaming_enabled() {
                        // SAFETY: caller contract; borrow ends at `;`.
                        let buffer = unsafe { core::mem::take(&mut (*this)._buffer) };
                        if !buffer.is_empty() {
                            let _ = vtable.on_read_chunk(&buffer, ReadState::Drained);
                        }
                        // Reinstall cleared (capacity reuse; pre-existing
                        // clear-after-dispatch semantics).
                        // SAFETY: caller contract; borrow ends at `;`.
                        unsafe {
                            let mut buffer = buffer;
                            buffer.clear();
                            (*this)._buffer = buffer;
                        }
                    }

                    if err.is_retry() {
                        if file_type == FileType::File {
                            bun_core::debug_warn!(
                                "Received EAGAIN while reading from a file. This is a bug.",
                            );
                        } else {
                            // SAFETY: caller contract; borrow scoped to the call.
                            unsafe { Self::register_poll(this) };
                        }
                        return;
                    }
                    // SAFETY: caller contract; `on_error` is the tail.
                    unsafe { Self::on_error(this, err) };
                    return;
                }
            }
        }
    }

    /// # Safety
    /// Same contract as [`Self::read`].
    unsafe fn read_from_blocking_pipe_without_blocking(
        this: *mut PosixBufferedReader,
        fd: Fd,
        size_hint: isize,
        received_hup: bool,
    ) {
        // SAFETY: caller contract; borrow ends at `;`.
        unsafe {
            if (*this).vtable.is_streaming_enabled() {
                (*this)._buffer.clear();
            }
        }

        // SAFETY: caller contract.
        unsafe { Self::read_blocking_pipe(this, fd, size_hint, received_hup) };
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
    /// The pointer to this pipe must be stable.
    /// It cannot change because we don't know what libuv will do with it.
    pub source: Option<Source>,
    pub(crate) _offset: usize,
    pub _buffer: Vec<u8>,
    // for compatibility with Linux
    pub flags: WindowsFlags,
    pub maxbuf: Option<NonNull<MaxBuf>>,

    pub(crate) vtable: BufferedReaderVTable,
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

#[cfg(windows)]
impl WindowsFlags {
    pub(crate) const fn new() -> Self {
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
        // Ownership of the handle (or listed file) moves with the source;
        // `set_parent` below re-records this reader as the one a VM teardown
        // stops it through.
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
        self.vtable.parent = parent;
        if !self.flags.contains(WindowsFlags::IS_DONE) {
            // `Source::set_data` only writes the libuv `.data` field (raw ptr
            // store); take a raw self-pointer first to dodge the
            // immutable-then-mutable-borrow conflict.
            let self_ptr = core::ptr::from_mut(self).cast::<c_void>();
            if let Some(source) = self.source.as_mut() {
                source.set_owner(self_ptr, Self::stop_for_vm_teardown);
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
        if self.flags.contains(WindowsFlags::HAS_INFLIGHT_READ) {
            return true;
        }
        let Some(source) = &self.source else {
            return false;
        };
        match source {
            Source::File(file) | Source::SyncFile(file) => {
                file.state != crate::source::FileState::Deinitialized
            }
            _ => false,
        }
    }

    /// Charges `bytes_read` against the `maxBuffer` budget, returning `true`
    /// once it is gone. The overflow callback only kills the child, which takes
    /// effect asynchronously, so the caller must also close the handle.
    fn charge_max_buffer(&mut self, bytes_read: usize) -> bool {
        let Some(maxbuf) = self.maxbuf else {
            return false;
        };
        MaxBuf::on_read_bytes(maxbuf, bytes_read as u64)
    }

    fn on_read_chunk(&mut self, buf: &[u8], has_more: ReadState) -> bool {
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
        // Clear has_inflight_read after the callback completes to prevent
        // libuv from starting a new read while we're still processing data
        // SAFETY: `this` is still live (see above).
        unsafe { (*this).flags.remove(WindowsFlags::HAS_INFLIGHT_READ) };
        result
    }

    fn finish(&mut self) {
        self.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
        self.flags.insert(WindowsFlags::IS_DONE);
        self._buffer.shrink_to_fit();
    }

    fn done(&mut self) {
        if let Some(source) = &self.source {
            debug_assert!(source.is_closed());
        }

        self.finish();

        self.vtable.on_reader_done();
    }

    /// # Safety
    /// `this` is live; raw for parity with the POSIX entry so the
    /// (maybe-freeing) error dispatch runs under no receiver protector.
    pub unsafe fn on_error(this: *mut Self, err: sys::Error) {
        // SAFETY: caller contract; `finish`'s receiver borrow ends when it
        // returns, and the (Copy) vtable is copied out before the dispatch.
        let vtable = unsafe {
            (*this).finish();
            (*this).vtable
        };
        vtable.on_reader_error(err);
    }

    fn get_read_buffer_with_stable_memory_address(&mut self, suggested_size: usize) -> &mut [u8] {
        self.flags.insert(WindowsFlags::HAS_INFLIGHT_READ);
        // Spare capacity grows well past `suggested_size`, so an unclamped read
        // overshoots `maxBuffer` by however much the buffer had room for.
        let maxbuf = self.maxbuf;
        self._buffer.reserve(suggested_size);
        // SAFETY: returning spare capacity for libuv to write into; len updated in on_read.
        let buf = unsafe { bun_core::vec::spare_bytes_mut(&mut self._buffer) };
        MaxBuf::clamp_read_buf(maxbuf, buf)
    }

    pub fn start_with_current_pipe(&mut self) -> sys::Result<()> {
        debug_assert!(!self.source.as_ref().unwrap().is_closed());
        let self_ptr = core::ptr::from_mut(self).cast::<c_void>();
        self.source
            .as_mut()
            .unwrap()
            .set_owner(self_ptr, Self::stop_for_vm_teardown);
        self.buffer().clear();
        self.flags.remove(WindowsFlags::IS_DONE);
        // Debug-only fault injection for test/js/bun/spawn/spawn-pipe-start-error.test.ts:
        // a real uv_read_start failure on a freshly-spawned stdio pipe cannot be
        // triggered from JS, so the test exercises the consumer's error path this way.
        #[cfg(debug_assertions)]
        if bun_core::env_var::feature_flag::BUN_INTERNAL_FAIL_PIPE_READER_START.get() == Some(true)
        {
            return sys::Result::Err(sys::Error::from_code(sys::E::INVAL, sys::Tag::open));
        }
        self.start_reading()
    }

    /// SAFETY: `pipe` must be a `Box<uv::Pipe>`-allocated pointer; ownership
    /// transfers to `self.source` (later freed via `close_and_destroy`).
    #[cfg(windows)]
    pub unsafe fn start_with_pipe(&mut self, pipe: *mut uv::Pipe) -> sys::Result<()> {
        // SAFETY: caller contract — Box-allocated, ownership transfers.
        self.set_source(Source::Pipe(unsafe { bun_core::heap::take(pipe) }));
        self.start_with_current_pipe()
    }

    /// Take ownership of `source` (reading starts later, or never). For a pipe
    /// or tty this reader is from now on the one a VM teardown stops the handle
    /// through — whether or not it ever starts reading — so nothing else may
    /// close that handle while it sits here.
    pub fn set_source(&mut self, source: Source) {
        debug_assert!(self.source.is_none());
        self.source = Some(source);
        let self_ptr = core::ptr::from_mut(self).cast::<c_void>();
        if let Some(source) = self.source.as_mut() {
            // A read over a file is a uv request with no handle to close: list
            // the boxed File so a thread teardown closes this reader (`close()`
            // below) before draining the loop. Unlisted where the box leaves
            // this reader (`close_impl`, `Drop`).
            if let Some(file) = source.file_key() {
                uv::open_handles::add_file(file);
            }
            source.set_owner(self_ptr, Self::stop_for_vm_teardown);
        }
    }

    /// `uv::open_handles` closes this reader's stream through here at teardown.
    unsafe fn stop_for_vm_teardown(this: *mut c_void) {
        // SAFETY: recorded via `Source::set_owner` by this live reader; the slot
        // is replaced/dropped before the reader goes away (close_impl / from / Drop).
        unsafe { (*this.cast::<WindowsBufferedReader>()).close() };
    }

    pub fn start(&mut self, fd: Fd, _: bool) -> sys::Result<()> {
        debug_assert!(self.source.is_none());
        // Use the event loop from the parent, not the global one
        // This is critical for spawnSync to use its isolated loop
        let loop_ = self.vtable.loop_();
        let source = match Source::open(loop_.cast(), fd) {
            sys::Result::Err(err) => return sys::Result::Err(err),
            sys::Result::Ok(source) => source,
        };
        self.set_source(source);
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
        let _parent = this.vtable.ref_parent();

        let nread_int = nread.int();

        bun_sys::syslog!(
            "onStreamRead(0x{}) = {}",
            core::ptr::from_mut(this) as usize,
            nread_int
        );

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
        // SAFETY: libuv fs_cb — `fs` is the `uv_fs_t` field of a heap-boxed
        // `source::File` (separate allocation from `Self`). Invoked from the
        // event loop with no other Rust borrow of it live (single-owner).
        // `from_fs_callback` snapshots `result`/`data` then container_of's the
        // owning `&mut File`; that borrow does not overlap the later
        // `&mut WindowsBufferedReader` (distinct heap allocations).
        let (file, result, parent_ptr) = unsafe { crate::source::File::from_fs_callback(fs) };
        let nread_int = result.int();
        let was_canceled = nread_int == uv::UV_ECANCELED as i64;

        bun_sys::syslog!(
            "onFileRead({}) = {}",
            // SAFETY: `uv_fs_read` populated the `fd` arm of the `file` union.
            Fd::from_uv(unsafe { file.fs.file_fd() }),
            nread_int
        );

        // ALWAYS complete the read first (cleans up fs_t, updates state)
        file.complete(was_canceled);

        if parent_ptr.is_null() {
            if file.state != crate::source::FileState::Closing {
                // detach_borrowed_fd path: no close scheduled, so reclaim here.
                // SAFETY: sole &mut to the into_raw'd Box; no fs callback left.
                drop(unsafe { bun_core::heap::take(core::ptr::from_mut(file)) });
            }
            // else: detach() set close_after_operation; on_close_complete frees.
            return;
        }

        // SAFETY: `parent_ptr` (= `fs.data`) is `*mut Self` set via `set_data`.
        // `file` above points into the boxed `source::File` — a separate heap
        // allocation — and its borrow ends (NLL) before this point in the
        // non-null path, so this is the sole live `&mut` to the reader
        // (single-owner).
        let this: &mut WindowsBufferedReader =
            unsafe { bun_ptr::callback_ctx::<WindowsBufferedReader>(parent_ptr) };
        let _parent = this.vtable.ref_parent();

        // Mark no longer in flight
        this.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);

        // Cancelled, or `close()` was asked for while this read was out (the
        // cancel need not have won): finish the close, deliver nothing.
        if was_canceled || this.flags.contains(WindowsFlags::DEFER_DONE_CALLBACK) {
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

                let len: usize = usize::try_from(nread_int).expect("int cast");
                this._offset += len;
                // we got some data lets get the current iov
                //
                // BORROW_PARAM (raw-ptr break): `on_read` takes `&mut self`
                // *and* a slice borrowed from `self.source.File.iov`; under
                // Stacked Borrows that's a self-mut + field-shared conflict.
                // The boxed `File` lives in its own heap allocation, so a
                // `*mut File` snapshot is provenance-disjoint from `&mut self`.
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

                // Shared epilogue: both body paths above fall through here.
                // if we are not paused we keep reading until EOF or err
                if !this.flags.contains(WindowsFlags::IS_PAUSED) {
                    // Re-snapshot — `on_read` may have mutated `this.source`.
                    let this_ptr = core::ptr::from_mut(this).cast::<c_void>();
                    let file_raw: *mut crate::source::File = match this.source.as_mut() {
                        Some(Source::File(f)) => f.as_mut() as *mut _,
                        _ => core::ptr::null_mut(),
                    };
                    if !file_raw.is_null() {
                        // SAFETY (each access below): see the snapshot above —
                        // `file_raw` points into the boxed `File`, a heap
                        // allocation disjoint from `*this`, so the scoped
                        // borrows never overlap the `this` accesses interleaved
                        // here.
                        // Can only start if file is in deinitialized state
                        if unsafe { (*file_raw).can_start() } {
                            // SAFETY: see above.
                            unsafe { (*file_raw).fs.data = this_ptr };
                            // SAFETY: see above.
                            unsafe { (*file_raw).prepare() };
                            let buf = this.get_read_buffer_with_stable_memory_address(64 * 1024);
                            // SAFETY: see above.
                            unsafe { (*file_raw).iov = uv::uv_buf_t::init(buf) };
                            this.flags.insert(WindowsFlags::HAS_INFLIGHT_READ);

                            let offset = if this.flags.contains(WindowsFlags::USE_PREAD) {
                                i64::try_from(this._offset).expect("int cast")
                            } else {
                                -1
                            };
                            // SAFETY: the file is fully initialized; libuv
                            // stores the cb and fires it on the event loop.
                            if let Some(err) = unsafe {
                                uv::uv_fs_read(
                                    this.vtable.loop_().cast(),
                                    &mut (*file_raw).fs,
                                    (*file_raw).file,
                                    &(*file_raw).iov,
                                    1,
                                    offset,
                                    Some(Self::on_file_read),
                                )
                            }
                            // Tagged `.write` even though the syscall is
                            // `uv_fs_read`, so user-visible `error.syscall`
                            // stays bit-identical with previous releases.
                            .to_error(sys::Tag::write)
                            {
                                // SAFETY: see above.
                                unsafe { (*file_raw).complete(false) };
                                this.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
                                this.flags.insert(WindowsFlags::IS_PAUSED);
                                // we should inform the error if we are unable to keep reading
                                this.on_read(sys::Result::Err(err), &mut [], ReadState::Progress);
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    fn start_reading(&mut self) -> sys::Result<()> {
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
            Source::File(file) | Source::SyncFile(file) => {
                let file_raw: *mut crate::source::File = file.as_mut();
                // SAFETY (each access below): `file_raw` points into the boxed
                // File owned by `self.source` — a heap allocation disjoint
                // from `*self` — and is live until `self.source` is replaced;
                // the scoped borrows never overlap the `self` accesses
                // interleaved here.
                // If already reading, just set data and unpause
                unsafe { (*file_raw).fs.data = self_ptr };
                // SAFETY: see above.
                if !unsafe { (*file_raw).can_start() } {
                    return sys::Result::Ok(());
                }

                // Start new read - set data before prepare
                // SAFETY: see above.
                unsafe { (*file_raw).prepare() };
                let buf = self.get_read_buffer_with_stable_memory_address(64 * 1024);
                // SAFETY: see above.
                unsafe { (*file_raw).iov = uv::uv_buf_t::init(buf) };
                self.flags.insert(WindowsFlags::HAS_INFLIGHT_READ);

                let offset = if self.flags.contains(WindowsFlags::USE_PREAD) {
                    i64::try_from(self._offset).expect("int cast")
                } else {
                    -1
                };
                // SAFETY: the file is fully initialized; libuv stores cb and
                // fires it on the event loop.
                if let Some(err) = unsafe {
                    uv::uv_fs_read(
                        self.vtable.loop_().cast(),
                        &mut (*file_raw).fs,
                        (*file_raw).file,
                        &(*file_raw).iov,
                        1,
                        offset,
                        Some(Self::on_file_read),
                    )
                }
                // Tagged `.write` even though the syscall is `uv_fs_read`, so
                // user-visible `error.syscall` stays bit-identical with
                // previous releases.
                .to_error(sys::Tag::write)
                {
                    // SAFETY: see above.
                    unsafe { (*file_raw).complete(false) };
                    self.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);
                    return sys::Result::Err(err);
                }
            }
            Source::Pipe(_) | Source::Tty(_) => {
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
                    // Routed through `bun.windows.libuv.log` (the `uv` debug
                    // scope, toggled by `BUN_DEBUG_uv=1`), not `SYS`.
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
            Source::File(file) | Source::SyncFile(file) => {
                file.stop();
            }
            Source::Pipe(_) | Source::Tty(_) => {
                // SAFETY: stream handle is live (just matched a stream source).
                unsafe { uv::uv_read_stop(source.to_stream()) };
            }
        }
        sys::Result::Ok(())
    }

    pub fn close_impl<const CALL_DONE: bool>(&mut self) {
        if let Some(source) = self.source.take() {
            match source {
                Source::SyncFile(mut file) | Source::File(mut file) => {
                    uv::open_handles::remove_file(core::ptr::from_mut(&mut *file).cast());
                    // Hand the Box off to libuv: detach() leaves either an
                    // in-flight uv_fs_read (on_file_read) or a scheduled
                    // uv_fs_close (on_close_complete) pending; the callback
                    // reclaims the allocation via heap::take. Dropping the
                    // Box here would free the uv_fs_t out from under libuv.
                    let raw = bun_core::heap::into_raw(file);
                    // SAFETY: raw is a live heap File*; the pending fs callback
                    // is the sole reclaimer (heap::take in on_close_complete /
                    // on_file_read's detached path) when one is left pending.
                    unsafe {
                        // A read in flight writes into `self._buffer` (via
                        // `iov`) whenever it completes; this reader may be
                        // dropped before then, so the buffer goes with the File.
                        if self.flags.contains(WindowsFlags::HAS_INFLIGHT_READ) {
                            (*raw).orphaned_read_buf = core::mem::take(&mut self._buffer);
                        }
                        if self.flags.contains(WindowsFlags::CLOSE_HANDLE) {
                            (*raw).detach();
                        } else if !(*raw).detach_borrowed_fd() {
                            // Idle and the fd is parent-owned: nothing pending,
                            // nothing to close. Reclaim and drop the Box.
                            drop(bun_core::heap::take(raw));
                        }
                    }
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
                _ => {}
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
    /// [`close`]). Safe to call
    /// before Drop; both paths are idempotent over an already-taken source.
    pub fn deinit(&mut self) {
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        self._buffer = Vec::new();
        let Some(source) = self.source.take() else {
            return;
        };
        if !source.is_closed() {
            // closeImpl will take care of freeing the source.
            // Dropping the `Box<Pipe>` here would free a uv_pipe_t still
            // linked into the loop's handle queue → UAF. Restore the source so
            // close_impl can do the proper take + hand-off to libuv
            // (into_raw + uv_close).
            self.source = Some(source);
            self.close_impl::<false>();
        } else {
            // Already closing/closed: a uv close callback may still be pending
            // on this allocation; dropping the Box would free memory libuv
            // still owns, so leak it instead.
            core::mem::forget(source);
        }
    }

    #[cfg(windows)]
    extern "C" fn on_pipe_close(handle: *mut uv::Pipe) {
        // `close_impl` set `handle.data = handle` and called `uv_close(handle)`;
        // libuv passes the same pointer back, so `handle` *is* the boxed Pipe
        // ptr — no need to round-trip through `.data`.
        // SAFETY: pipe was Box-allocated (into_raw in close_impl); reclaim.
        drop(unsafe { bun_core::heap::take(handle) });
    }

    #[cfg(windows)]
    extern "C" fn on_tty_close(handle: *mut uv::uv_tty_t) {
        // `close_impl` set `handle.data = handle` and called `uv_close(handle)`;
        // libuv passes the same pointer back, so `handle` *is* the tty ptr.
        // Caller already gates on `!is_stdin_tty` before scheduling close, so
        // `handle` is heap-allocated (open_tty heap::alloc). Reclaim and drop.
        debug_assert!(!crate::source::stdin_tty::is_stdin_tty(handle));
        // SAFETY: non-stdin tty is heap-allocated; sole owner after uv_close.
        drop(unsafe { bun_core::heap::take(handle) });
    }

    fn on_read(&mut self, amount: sys::Result<usize>, slice: &mut [u8], has_more: ReadState) {
        if let sys::Result::Err(err) = amount {
            // SAFETY: live reader. Note: this `&mut self` receiver still carries
            // a protector across the (maybe-freeing) error dispatch — pre-existing
            // on the parent chain, tracked with the raw-dispatch follow-up.
            unsafe { Self::on_error(std::ptr::from_mut(self), err) };
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
        unsafe { bun_core::vec::commit_spare(&mut self._buffer, amount_result) };

        let over_budget = self.charge_max_buffer(amount_result);

        let should_continue = self.on_read_chunk(slice, has_more);

        // Streaming parents (shell IOReader, subprocess) cannot re-derive
        // `&mut Self` from inside the vtable callback to restart the pipe
        // (Stacked-Borrows; see the comment in shell/IOReader.rs). The re-arm
        // is already handled by `on_file_read`'s epilogue / `uv_read_start`,
        // but clearing the buffer here is load-bearing: without it `_buffer.len`
        // grows by `amount_result` every chunk and never resets, so a 1 GB
        // `cat` holds 1 GB resident instead of ~64 KB. Clear it here, after
        // the streaming consumer has finished with `slice`.
        // `should_continue` no longer gates the clear: FileReader may say
        // stop at its highwater mark while uv keeps delivering, and leaving
        // `_buffer` uncleared would double-buffer (here + FileReader.buffered).
        // Parents that want the reader paused call `reader().pause()`
        // themselves; stopping here could free a parent whose caller still
        // holds `this` (FileResponseStream on abort).
        let _ = should_continue;
        if has_more != ReadState::Eof && self.vtable.is_streaming_enabled() {
            self._buffer.clear();
        }

        // `over_budget` is terminal for the same reason EOF is: the child was
        // killed and nothing past the cap may be buffered.
        if has_more == ReadState::Eof || over_budget {
            self.close();
        }
    }

    pub fn pause(&mut self) {
        let _ = self.stop_reading();
    }

    pub fn unpause(&mut self) {
        let _ = self.start_reading();
    }

    /// # Safety
    /// `this` is the live reader. Raw for signature parity with the POSIX
    /// entry (callers dispatch through a `*mut`); the body only unpauses.
    pub unsafe fn read(this: *mut Self) {
        // we cannot sync read pipes on Windows so we just check if we are paused to resume the reading
        // SAFETY: caller contract; borrow scoped to the call.
        unsafe { (*this).unpause() };
    }
}

// Keep boolean state in the `WindowsFlags` bitflags field — no loose `bool`
// fields on `WindowsBufferedReader`.

#[cfg(windows)]
impl Drop for WindowsBufferedReader {
    fn drop(&mut self) {
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        // Do NOT take() source here and let it drop: Box<Pipe>/Box<File> own
        // live uv handles registered with the loop. Let close_impl perform the
        // take + into_raw hand-off so the uv close callback reclaims them.
        // Skip close_impl when the source is already closed — a uv_close is
        // already pending on that allocation, so closing again would
        // double-close and freeing the Box would UAF the handle libuv still
        // references. Same as deinit(): leak the already-closing handle.
        if let Some(source) = self.source.take() {
            if !source.is_closed() {
                self.source = Some(source);
                self.close_impl::<false>();
            } else {
                let mut source = source;
                if let Some(file) = source.file_key() {
                    uv::open_handles::remove_file(file);
                }
                core::mem::forget(source);
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
