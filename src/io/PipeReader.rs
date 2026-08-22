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
use crate::pipes::{Chunk, FileType, PollOrFd, ReadState};
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

    unsafe fn on_read_chunk(this: *mut Self, chunk: Chunk<'_>, has_more: ReadState) -> bool {
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

    /// Returning false ends only the current read loop. To stop the reader, call `pause()`.
    fn on_read_chunk(&self, chunk: Chunk<'_>, has_more: ReadState) -> bool {
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

/// Bytes the reader may still take out of its source (a blob slice window; `None` reads to EOF): reads are cut to it and using it up is reported as EOF.
#[derive(Clone, Copy)]
struct ReadLimit(Option<usize>);

impl ReadLimit {
    const NONE: ReadLimit = ReadLimit(None);

    fn reached(self) -> bool {
        self.0 == Some(0)
    }

    fn clamp_len(self, len: usize) -> usize {
        self.0.map_or(len, |remaining| len.min(remaining))
    }

    fn clamp(self, buf: &mut [u8]) -> &mut [u8] {
        let len = self.clamp_len(buf.len());
        &mut buf[..len]
    }

    /// Charges `n` bytes read from the source; `true` once the window is used up.
    fn charge(&mut self, n: usize) -> bool {
        let Some(remaining) = &mut self.0 else {
            return false;
        };
        debug_assert!(
            n <= *remaining,
            "read past the limit: the read was not clamped"
        );
        *remaining = remaining.saturating_sub(n);
        *remaining == 0
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PosixBufferedReader
// ──────────────────────────────────────────────────────────────────────────

pub struct PosixBufferedReader {
    pub handle: PollOrFd,
    pub _buffer: Vec<u8>,
    pub(crate) _offset: usize,
    limit: ReadLimit,
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
            limit: ReadLimit::NONE,
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
            limit: other.limit,
            flags: other.flags,
            vtable: BufferedReaderVTable { kind, parent },
            maxbuf: None,
        };
        other.flags.insert(PosixFlags::IS_DONE);
        other._offset = 0;
        other.limit = ReadLimit::NONE;
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
        // With nothing left to read the fd is never waited on: like a non-pollable source, the parent's first read request ends the reader.
        if !self.flags.contains(PosixFlags::IS_PAUSED) && !self.limit.reached() {
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

    /// Ends the reader after the next `len` bytes of the source as if they were followed by EOF (`ReadLimit`); `None` reads to EOF. Set before starting.
    pub fn set_limit(&mut self, len: Option<usize>) {
        self.limit = ReadLimit(len);
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
    /// `on_read_chunk` dispatched from the read loop re-enters JS, which can
    /// reach this reader again through its parent — a protected `&mut`
    /// spanning that re-entry is exactly the aliasing this API avoids.
    pub unsafe fn read(this: *mut Self) {
        // SAFETY: caller contract — `this` is live; borrows end at each `;`.
        let Some((fd, file_type, vtable)) = (unsafe { (*this).begin_read() }) else {
            return;
        };
        // The read loop dispatches `on_read_chunk` and touches `*this`
        // afterwards, so the parent (which embeds this reader) must outlive it.
        let _parent = vtable.ref_parent();
        let mut received_hup = false;
        // A used-up limit is reported without reading, so there is nothing to wait for.
        // SAFETY: caller contract; borrow ends at `;`.
        if file_type == FileType::Pipe && !unsafe { (*this).limit.reached() } {
            match bun_core::is_readable(fd) {
                bun_core::Pollable::Ready => {}
                bun_core::Pollable::Hup => received_hup = true,
                bun_core::Pollable::NotReady => {
                    // SAFETY: caller contract; the error dispatch may free the parent.
                    unsafe { Self::register_poll(this) };
                    return;
                }
            }
        }
        // SAFETY: caller contract.
        unsafe { Self::read_loop(this, file_type, fd, received_hup) };
    }

    /// # Safety
    /// `this` is the live reader registered as the poll's user data; see
    /// [`Self::read`] for why the entry is raw.
    pub unsafe fn on_poll(this: *mut PosixBufferedReader, size_hint: isize, received_hup: bool) {
        // SAFETY: caller contract — `this` is live; borrows end at each `;`.
        let Some((fd, file_type, vtable)) = (unsafe { (*this).begin_read() }) else {
            return;
        };
        bun_sys::syslog!("onPoll({}) = {}", fd, size_hint);
        let _parent = vtable.ref_parent();
        // SAFETY: caller contract.
        unsafe { Self::read_loop(this, file_type, fd, received_hup) };
    }

    fn begin_read(&self) -> Option<(Fd, FileType, BufferedReaderVTable)> {
        if self.flags.contains(PosixFlags::IS_PAUSED) {
            return None;
        }
        Some((self.get_fd(), self.get_file_type(), self.vtable))
    }

    /// Charges `bytes_read` against the `maxBuffer` budget; `true` once it is gone. The overflow callback only kills the child, so the caller must also stop reading.
    fn charge_max_buffer(&mut self, bytes_read: usize) -> bool {
        let Some(maxbuf) = self.maxbuf else {
            return false;
        };
        MaxBuf::on_read_bytes(maxbuf, bytes_read as u64)
    }

    /// Every kind uses its non-blocking primitive: `RWF_NOWAIT`/poll-guarded reads for pipes, `MSG_DONTWAIT` for sockets; regular files cannot block.
    fn sys_read(&self, file_type: FileType, fd: Fd, buf: &mut [u8]) -> sys::Result<usize> {
        match file_type {
            FileType::File if self.flags.contains(PosixFlags::USE_PREAD) => {
                sys::pread(fd, buf, i64::try_from(self._offset).expect("int cast"))
            }
            FileType::File => sys::read(fd, buf),
            FileType::Socket => sys::recv_non_block(fd, buf),
            FileType::NonblockingPipe | FileType::Pipe => sys::read_nonblocking(fd, buf),
        }
    }

    /// One syscall into `buf`, cut to the limit and the byte budget; charges both and advances the offset. A limit that is (or gets) used up is this reader's EOF.
    fn read_once(&mut self, file_type: FileType, fd: Fd, buf: &mut [u8]) -> ReadOnce {
        if self.limit.reached() {
            return ReadOnce::Stop(Stop::Eof);
        }
        let buf = MaxBuf::clamp_read_buf(self.maxbuf, self.limit.clamp(buf));
        match self.sys_read(file_type, fd, buf) {
            sys::Result::Ok(0) => ReadOnce::Stop(Stop::Eof),
            sys::Result::Ok(n) => {
                self._offset += n;
                let limit_reached = self.limit.charge(n);
                if self.charge_max_buffer(n) {
                    ReadOnce::Read(n, Some(Stop::OverBudget))
                } else if limit_reached {
                    ReadOnce::Read(n, Some(Stop::Eof))
                } else {
                    ReadOnce::Read(n, None)
                }
            }
            sys::Result::Err(err) if err.is_retry() => ReadOnce::Stop(Stop::WouldBlock),
            sys::Result::Err(err) => ReadOnce::Stop(Stop::Error(err)),
        }
    }

    /// Reads into `scratch` until it is worth delivering; returns bytes filled and why it stopped (`None`: deliver and keep going).
    fn fill_scratch(
        &mut self,
        file_type: FileType,
        fd: Fd,
        scratch: &mut [u8],
    ) -> (usize, Option<Stop>) {
        let mut filled = 0;
        while scratch.len() - filled > 16 * 1024 && filled < scratch.len() / 2 {
            match self.read_once(file_type, fd, &mut scratch[filled..]) {
                ReadOnce::Read(n, stop) => {
                    filled += n;
                    if stop.is_some() || file_type == FileType::Pipe {
                        return (filled, stop);
                    }
                }
                ReadOnce::Stop(stop) => return (filled, Some(stop)),
            }
        }
        (filled, None)
    }

    /// Reads into `_buffer` until it is worth delivering (streaming) or exhausted (buffering).
    fn fill_buffer(&mut self, file_type: FileType, fd: Fd, streaming: bool) -> Option<Stop> {
        loop {
            self._buffer.reserve(16 * 1024);
            // SAFETY: the syscall writes only initialized bytes into the prefix it reports and `commit_spare` exposes exactly that prefix.
            let read = unsafe {
                let spare: *mut [u8] = bun_core::vec::spare_bytes_mut(&mut self._buffer);
                self.read_once(file_type, fd, &mut *spare)
            };
            match read {
                ReadOnce::Read(n, stop) => {
                    // SAFETY: `read_once` initialized `n` bytes of the spare capacity.
                    unsafe { bun_core::vec::commit_spare(&mut self._buffer, n) };
                    if stop.is_some()
                        || file_type == FileType::Pipe
                        || (streaming && self._buffer.len() >= 128 * 1024)
                    {
                        return stop;
                    }
                }
                ReadOnce::Stop(stop) => return Some(stop),
            }
        }
    }

    /// # Safety
    /// `this` is the live reader (an inline field of its parent).
    /// `on_read_chunk` re-entry never frees it (`BufferedReaderParent`
    /// contract) but may mutate it — no borrow of `*this` is held across any
    /// dispatch below. `on_error()` / `done()` MAY free the parent, so both
    /// are dispatched in tail position.
    unsafe fn read_loop(
        this: *mut PosixBufferedReader,
        file_type: FileType,
        fd: Fd,
        mut received_hup: bool,
    ) {
        // SAFETY: caller contract — `this` is live.
        let vtable = unsafe { (*this).vtable };
        let streaming = vtable.is_streaming_enabled();
        let mut scratch = vtable.event_loop().claim_pipe_read_scratch();
        loop {
            // SAFETY: caller contract; borrow ends at `;`.
            let use_scratch = unsafe {
                (*this)._buffer.is_empty() && (streaming || (*this)._buffer.capacity() == 0)
            };
            let (stop, keep_going) = match (use_scratch, scratch.as_mut()) {
                (true, Some(scratch)) => {
                    // SAFETY: caller contract; the borrow ends before the dispatch.
                    let (filled, stop) = unsafe { (*this).fill_scratch(file_type, fd, scratch) };
                    // SAFETY: caller contract; borrow ends at `;`.
                    unsafe { Self::close_if_final(this, stop.as_ref()) };
                    let keep_going = if filled == 0 {
                        true
                    } else if streaming {
                        vtable.on_read_chunk(
                            Chunk::Scratch(&scratch[..filled]),
                            Self::read_state(stop.as_ref(), received_hup),
                        )
                    } else {
                        // SAFETY: caller contract; borrow ends at `;`.
                        unsafe { (*this)._buffer.extend_from_slice(&scratch[..filled]) };
                        true
                    };
                    (stop, keep_going)
                }
                _ => {
                    // SAFETY: caller contract; the borrow ends before the dispatch.
                    let stop = unsafe { (*this).fill_buffer(file_type, fd, streaming) };
                    // SAFETY: caller contract; borrow ends at `;`.
                    unsafe { Self::close_if_final(this, stop.as_ref()) };
                    // SAFETY: caller contract; borrow ends at `;`.
                    let keep_going = if !streaming || unsafe { (*this)._buffer.is_empty() } {
                        true
                    } else {
                        // Moved out so a re-entrant read cannot alias or reallocate it under the consumer.
                        // SAFETY: caller contract; borrow ends at `;`.
                        let mut buffer = unsafe { mem::take(&mut (*this)._buffer) };
                        let state = Self::read_state(stop.as_ref(), received_hup);
                        if matches!(stop, Some(Stop::Eof | Stop::OverBudget | Stop::Error(_))) {
                            vtable.on_read_chunk(Chunk::Owned(buffer), state)
                        } else {
                            let keep_going =
                                vtable.on_read_chunk(Chunk::Buffer(&mut buffer), state);
                            buffer.clear();
                            // SAFETY: caller contract; borrows end at the block.
                            unsafe {
                                if (*this)._buffer.is_empty() {
                                    (*this)._buffer = buffer;
                                }
                            }
                            keep_going
                        }
                    };
                    (stop, keep_going)
                }
            };

            match stop {
                Some(Stop::Eof | Stop::OverBudget) => {
                    // SAFETY: caller contract; `done()` is the tail.
                    unsafe {
                        if !(*this).flags.contains(PosixFlags::IS_DONE) {
                            Self::done(this);
                        }
                    }
                    return;
                }
                Some(Stop::Error(err)) => {
                    // SAFETY: caller contract; `on_error` is the tail.
                    unsafe { Self::on_error(this, err) };
                    return;
                }
                _ => {}
            }
            // Re-entrant JS inside on_read_chunk can close the reader (nested on_pull -> read -> EOF); the captured `fd` is then stale.
            // SAFETY: caller contract (re-entry never frees `*this`).
            if unsafe { (*this).is_done() } {
                return;
            }
            if let Some(Stop::WouldBlock) = stop {
                if file_type == FileType::File {
                    bun_core::debug_warn!(
                        "Received EAGAIN while reading from a file. This is a bug."
                    );
                } else {
                    // SAFETY: caller contract; the error dispatch may free the parent.
                    unsafe { Self::register_poll(this) };
                }
                return;
            }
            if streaming && !keep_going && !received_hup {
                return;
            }
            if file_type != FileType::Pipe {
                continue;
            }

            // A blocking pipe gets one read per wakeup unless it hung up, in
            // which case draining locally reaches EOF — but `received_hup` is a
            // snapshot, and user JS inside `on_read_chunk` may have opened a new
            // writer on the same FIFO. Re-check before committing to a read
            // that could block (Linux named FIFOs reject RWF_NOWAIT).
            if !received_hup {
                // SAFETY: caller contract; the error dispatch may free the parent.
                unsafe { Self::register_poll(this) };
                return;
            }
            match bun_core::is_readable(fd) {
                bun_core::Pollable::Hup => {}
                bun_core::Pollable::Ready => received_hup = false,
                bun_core::Pollable::NotReady => {
                    // SAFETY: caller contract; the error dispatch may free the parent.
                    unsafe { Self::register_poll(this) };
                    return;
                }
            }
        }
    }

    /// Closes before the final chunk is delivered, so a consumer that pulls again from inside `on_read_chunk` finds the reader done instead of reading past EOF or the byte budget.
    ///
    /// # Safety
    /// `this` is the live reader.
    unsafe fn close_if_final(this: *mut Self, stop: Option<&Stop>) {
        if matches!(stop, Some(Stop::Eof | Stop::OverBudget)) {
            // SAFETY: caller contract; borrow ends at `;`.
            unsafe { (*this).close_without_reporting() };
        }
    }

    fn read_state(stop: Option<&Stop>, received_hup: bool) -> ReadState {
        match stop {
            Some(Stop::Eof | Stop::OverBudget) => ReadState::Eof,
            Some(Stop::WouldBlock) => ReadState::Drained,
            Some(Stop::Error(_)) => ReadState::Progress,
            None if received_hup => ReadState::Eof,
            None => ReadState::Progress,
        }
    }

    /// One non-blocking read straight into `dst` for a consumer pulling synchronously; arms the poll when nothing is available. EOF and errors are reported through `on_reader_done` / `on_reader_error` like any other read.
    ///
    /// # Safety
    /// Same contract as [`Self::read`]: those dispatches may free the parent.
    pub unsafe fn read_into(this: *mut Self, dst: &mut [u8]) -> (usize, ReadState) {
        // SAFETY: caller contract — `this` is live; borrow ends at `;`.
        let Some((fd, file_type, vtable)) = (unsafe { (*this).begin_read() }) else {
            return (0, ReadState::Progress);
        };
        if dst.is_empty() {
            return (0, ReadState::Progress);
        }
        let _parent = vtable.ref_parent();
        // As in `read`: a used-up limit is reported without reading.
        // SAFETY: caller contract; borrow ends at `;`.
        if file_type == FileType::Pipe && !unsafe { (*this).limit.reached() } {
            match bun_core::is_readable(fd) {
                bun_core::Pollable::Ready | bun_core::Pollable::Hup => {}
                bun_core::Pollable::NotReady => {
                    // SAFETY: caller contract.
                    unsafe { Self::register_poll(this) };
                    return (0, ReadState::Progress);
                }
            }
        }
        // SAFETY: caller contract; the borrow ends before any dispatch.
        let (n, stop) = match unsafe { (*this).read_once(file_type, fd, dst) } {
            ReadOnce::Read(n, stop) => (n, stop),
            ReadOnce::Stop(stop) => (0, Some(stop)),
        };
        match stop {
            None => (n, ReadState::Progress),
            Some(Stop::Eof | Stop::OverBudget) => {
                // SAFETY: caller contract; `done()` may free the parent, nothing of `*this` is touched after.
                unsafe {
                    (*this).close_without_reporting();
                    if !(*this).flags.contains(PosixFlags::IS_DONE) {
                        Self::done(this);
                    }
                }
                (n, ReadState::Eof)
            }
            Some(Stop::WouldBlock) => {
                if file_type != FileType::File {
                    // SAFETY: caller contract.
                    unsafe { Self::register_poll(this) };
                }
                (0, ReadState::Drained)
            }
            Some(Stop::Error(err)) => {
                // SAFETY: caller contract; `on_error` may free the parent.
                unsafe { Self::on_error(this, err) };
                (0, ReadState::Progress)
            }
        }
    }
}

enum Stop {
    Eof,
    OverBudget,
    WouldBlock,
    Error(sys::Error),
}

enum ReadOnce {
    Read(usize, Option<Stop>),
    Stop(Stop),
}

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
    limit: ReadLimit,
    pub _buffer: Vec<u8>,
    // for compatibility with Linux
    pub flags: WindowsFlags,
    pub maxbuf: Option<NonNull<MaxBuf>>,

    pub(crate) vtable: BufferedReaderVTable,

    /// What `on_stream_read` recorded inside `uv_run`; handled by
    /// `dispatch_stream_read` once `uv_run` has returned (uv::deferred).
    #[cfg(windows)]
    stream_read: StreamRead,
}

/// Reads libuv completed on a pipe/tty since the loop last dispatched this
/// reader. The bytes themselves are already committed to `_buffer`.
#[cfg(windows)]
#[derive(Default)]
struct StreamRead {
    deferred: uv::Deferred,
    bytes: usize,
    end: StreamReadEnd,
    /// `maxBuffer` ran out during these reads; its owner hears about it at dispatch.
    over_budget: bool,
    /// A tty read was stopped inside the read callback (see `on_stream_read`)
    /// and is started again once its bytes were handed to the parent.
    restart_tty: bool,
}

#[cfg(windows)]
#[derive(Default)]
enum StreamReadEnd {
    #[default]
    Open,
    /// The read limit or `maxBuffer` was used up: this reader's EOF.
    Budget,
    Eof,
    Err(sys::Error),
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
            limit: ReadLimit::NONE,
            _buffer: Vec::new(),
            flags: WindowsFlags::new(),
            maxbuf: None,
            vtable: BufferedReaderVTable::init::<T>(),
            stream_read: StreamRead::default(),
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
        self.limit = other.limit;
        // Ownership of the handle (or listed file) moves with the source;
        // `set_parent` below re-records this reader as the one a VM teardown
        // stops it through.
        self.source = other.source.take();
        // Reads recorded but not yet dispatched move too; the queue node is
        // re-pointed at `self` (its `run` recovers the reader from the node).
        // SAFETY: both nodes are live; `self`'s is idle (no source until now).
        unsafe {
            uv::Deferred::cancel(&raw mut self.stream_read.deferred);
            self.stream_read.bytes = other.stream_read.bytes;
            self.stream_read.end = mem::take(&mut other.stream_read.end);
            self.stream_read.over_budget = other.stream_read.over_budget;
            self.stream_read.restart_tty = other.stream_read.restart_tty;
            other.stream_read.bytes = 0;
            other.stream_read.over_budget = false;
            other.stream_read.restart_tty = false;
            uv::Deferred::relocate(
                &raw mut other.stream_read.deferred,
                &raw mut self.stream_read.deferred,
            );
        }

        other.flags.insert(WindowsFlags::IS_DONE);
        other._offset = 0;
        other.limit = ReadLimit::NONE;
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

    fn on_read_chunk(&mut self, has_more: ReadState) -> bool {
        if has_more == ReadState::Eof {
            self.flags.insert(WindowsFlags::RECEIVED_EOF);
        }

        // The read that produced this chunk is complete; if the flag is set again
        // below, a `start_reading` issued from the dispatch set it.
        self.flags.remove(WindowsFlags::HAS_INFLIGHT_READ);

        if !self.vtable.is_streaming_enabled() {
            return true;
        }
        // `on_read_chunk` re-enters JS, which can reach this reader through its parent; go raw across the dispatch so nothing of `self` is cached over it.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // SAFETY: `this` aliases the live `&mut self`; the reader is an inline field of its parent (never freed mid-call). Borrows end at each `;`.
        let (vtable, mut buffer) = unsafe { ((*this).vtable, mem::take(&mut (*this)._buffer)) };
        let result = if buffer.is_empty() {
            true
        } else if has_more == ReadState::Eof {
            vtable.on_read_chunk(Chunk::Owned(buffer), has_more)
        } else {
            let result = vtable.on_read_chunk(Chunk::Buffer(&mut buffer), has_more);
            buffer.clear();
            // SAFETY: `this` is still live (see above).
            unsafe {
                // An in-flight read owns `_buffer`: libuv holds a pointer into it (#39890).
                if !(*this).flags.contains(WindowsFlags::HAS_INFLIGHT_READ)
                    && (*this)._buffer.is_empty()
                {
                    (*this)._buffer = buffer;
                }
            }
            result
        };
        core::hint::black_box(this);
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
        // overshoots the limit or `maxBuffer` by however much the buffer had room for.
        let maxbuf = self.maxbuf;
        let limit = self.limit;
        // Never empty: reads are only issued while the limit has not been reached (`start_reading`, `on_read`), and libuv treats an empty buffer as an error.
        debug_assert!(!limit.reached());
        let size = limit.clamp_len(suggested_size);
        // Tty reads must not target `_buffer`: libuv can retain the pointer
        // past reader teardown (see `uv::Tty::read_scratch` for the contract).
        if matches!(self.source, Some(Source::Tty(_))) {
            let scratch = self
                .source
                .as_mut()
                .and_then(|s| s.tty_read_scratch(size))
                .expect("tty source matched above");
            return MaxBuf::clamp_read_buf(maxbuf, limit.clamp(scratch));
        }
        self._buffer.reserve(size);
        // SAFETY: returning spare capacity for libuv to write into; len updated in on_read.
        let buf = unsafe { bun_core::vec::spare_bytes_mut(&mut self._buffer) };
        MaxBuf::clamp_read_buf(maxbuf, limit.clamp(buf))
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

    /// See `PosixBufferedReader::set_limit`.
    pub fn set_limit(&mut self, len: Option<usize>) {
        self.limit = ReadLimit(len);
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

    /// libuv read callback: runs inside `uv_run`, so it only records. The
    /// bytes are committed to `_buffer` and charged against the limits here
    /// (libuv may call `on_stream_alloc` + this again before `uv_run` returns,
    /// and the next allocation has to start after these bytes and be clamped
    /// by what is left); handing anything to the parent waits for
    /// `dispatch_stream_read`.
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

        bun_sys::syslog!(
            "onStreamRead(0x{}) = {}",
            core::ptr::from_mut(this) as usize,
            nread_int
        );

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
                this.stream_read.end = StreamReadEnd::Eof;
            }
            _ => {
                if let Some(err) = nread.to_error(sys::Tag::recv) {
                    let _ = this.stop_reading();
                    this.stream_read.end = StreamReadEnd::Err(err);
                } else {
                    let len: usize = usize::try_from(nread_int).expect("int cast");
                    if matches!(this.source, Some(Source::Tty(_))) {
                        // Tty chunks arrive in the tty-owned scratch; stage them
                        // into `_buffer` so they are committed like a pipe chunk.
                        this._buffer.reserve(len);
                        // SAFETY: buf is valid when nread > 0; `_buffer` has `len`
                        // spare bytes, disjoint from `this` and the scratch.
                        unsafe {
                            let dst =
                                bun_core::vec::spare_bytes_mut(&mut this._buffer).as_mut_ptr();
                            core::ptr::copy_nonoverlapping((*buf).base.cast::<u8>(), dst, len);
                        }
                    } else {
                        // Address arithmetic: `buf` covers spare (uninit) capacity, so no `&[u8]` over the Vec may be formed for the check.
                        debug_assert!(
                            // SAFETY: buf is valid when nread > 0.
                            unsafe { (*buf).base } as usize >= this._buffer.as_ptr() as usize
                                && unsafe { (*buf).base } as usize + len
                                    <= this._buffer.as_ptr() as usize + this._buffer.capacity(),
                            "uv_read_cb: buf is not in buffer! This is a bug in bun. Please report it."
                        );
                    }
                    // SAFETY: `len` bytes were written into the spare capacity (by libuv for a pipe, by the copy above for a tty).
                    unsafe { bun_core::vec::commit_spare(&mut this._buffer, len) };
                    this.stream_read.bytes += len;
                    let limit_reached = this.limit.charge(len);
                    let over_budget = match this.maxbuf {
                        Some(maxbuf) => MaxBuf::charge(maxbuf, len as u64),
                        None => false,
                    };
                    this.stream_read.over_budget |= over_budget;
                    if limit_reached || over_budget {
                        let _ = this.stop_reading();
                        this.stream_read.end = StreamReadEnd::Budget;
                    } else if matches!(this.source, Some(Source::Tty(_))) {
                        // A console in line mode queues its next read - alloc_cb
                        // included - as soon as this callback returns, and fills
                        // that buffer from a worker thread; the parent takes and
                        // clears `_buffer` when these bytes are handed over, so no
                        // read may be outstanding into it by then. Stop here (no
                        // read is pending at this point, so nothing is cancelled)
                        // and start again after the hand-over. `IS_PAUSED` is left
                        // alone: to the parent this reader is still reading.
                        // SAFETY: `stream` is the live tty handle.
                        unsafe { uv::uv_read_stop(stream) };
                        this.stream_read.restart_tty = true;
                    }
                }
            }
        }
        // SAFETY: the node lives in `*this`, which is stable while its handle
        // reads (handle.data points at it) and cancels the node when it lets
        // go of the handle (`close_impl`, `deinit`, `Drop`, `from`).
        unsafe {
            uv::Deferred::enqueue(
                (*stream).loop_,
                &raw mut this.stream_read.deferred,
                Self::dispatch_stream_read,
            )
        };
    }

    /// Dispatch phase: hand the parent what `on_stream_read` recorded.
    #[cfg(windows)]
    unsafe fn dispatch_stream_read(node: *mut uv::Deferred) {
        // SAFETY: `node` is `stream_read.deferred` of a live reader (enqueue contract).
        let this: *mut WindowsBufferedReader = unsafe {
            bun_core::from_field_ptr!(StreamRead, deferred, node)
                .cast::<u8>()
                .sub(core::mem::offset_of!(WindowsBufferedReader, stream_read))
                .cast()
        };
        // SAFETY: `this` is live; each borrow below ends before the parent is
        // called (the parent may reach this reader again through its own state).
        let (vtable, bytes, end, over_budget, maxbuf) = unsafe {
            let sr = &mut (*this).stream_read;
            (
                (*this).vtable,
                mem::take(&mut sr.bytes),
                mem::take(&mut sr.end),
                mem::take(&mut sr.over_budget),
                (*this).maxbuf,
            )
        };
        let _parent = vtable.ref_parent();

        if over_budget {
            if let Some(maxbuf) = maxbuf {
                MaxBuf::overflowed(maxbuf);
            }
        }
        match end {
            StreamReadEnd::Open => {
                if bytes > 0 {
                    // SAFETY: `this` is live (see above).
                    let _ = unsafe { (*this).on_read_chunk(ReadState::Progress) };
                }
                // SAFETY: `this` is live (see above; `_parent` holds the parent it
                // is a field of). Resume a tty read stopped in `on_stream_read`,
                // unless the hand-over paused, closed or finished the reader.
                unsafe {
                    if mem::take(&mut (*this).stream_read.restart_tty)
                        && !(*this)
                            .flags
                            .intersects(WindowsFlags::IS_PAUSED | WindowsFlags::IS_DONE)
                        && matches!((*this).stream_read.end, StreamReadEnd::Open)
                    {
                        if let Some(source @ Source::Tty(_)) = (*this).source.as_mut() {
                            let rc = uv::uv_read_start(
                                source.to_stream(),
                                Some(Self::on_stream_alloc),
                                Some(Self::on_stream_read),
                            );
                            if let Some(err) = rc.to_error(sys::Tag::open) {
                                (*this).flags.insert(WindowsFlags::IS_PAUSED);
                                Self::on_error(this, err);
                            }
                        }
                    }
                }
            }
            StreamReadEnd::Budget | StreamReadEnd::Eof => {
                // SAFETY: `this` is live (see above); `close` may free the parent
                // but not the reader inline (it is a field of the parent, and
                // `_parent` holds the parent).
                unsafe {
                    let _ = (*this).on_read_chunk(ReadState::Eof);
                    (*this).close();
                }
            }
            StreamReadEnd::Err(err) => {
                if bytes > 0 {
                    // SAFETY: as above.
                    let _ = unsafe { (*this).on_read_chunk(ReadState::Progress) };
                }
                // SAFETY: as above; the error dispatch may free the parent.
                unsafe { Self::on_error(this, err) };
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
                                let req: *mut uv::fs_t = &raw mut (*file_raw).fs;
                                uv::uv_fs_read(
                                    this.vtable.loop_().cast(),
                                    req,
                                    (*file_raw).file,
                                    &(*file_raw).iov,
                                    1,
                                    offset,
                                    uv::deferred::fs_callback(req, Self::on_file_read),
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
        // A used-up limit stays paused: `start` has nothing to read and `unpause` reports it as EOF instead.
        // An end (EOF, error, budget) recorded but not yet handed over is final too.
        if self.flags.contains(WindowsFlags::IS_DONE)
            || !self.flags.contains(WindowsFlags::IS_PAUSED)
            || self.limit.reached()
            || !matches!(self.stream_read.end, StreamReadEnd::Open)
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
                    let req: *mut uv::fs_t = &raw mut (*file_raw).fs;
                    uv::uv_fs_read(
                        self.vtable.loop_().cast(),
                        req,
                        (*file_raw).file,
                        &(*file_raw).iov,
                        1,
                        offset,
                        uv::deferred::fs_callback(req, Self::on_file_read),
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
        // Reads recorded for a handle this reader is letting go of are dropped
        // with it (their bytes stay in `_buffer`); an overdrawn `maxBuffer` is
        // still reported, since the owner keys `exitedDueToMaxBuffer` off it.
        // SAFETY: the node is a field of `self`.
        unsafe { uv::Deferred::cancel(&raw mut self.stream_read.deferred) };
        self.stream_read.bytes = 0;
        self.stream_read.end = StreamReadEnd::Open;
        self.stream_read.restart_tty = false;
        if mem::take(&mut self.stream_read.over_budget) {
            if let Some(maxbuf) = self.maxbuf {
                MaxBuf::overflowed(maxbuf);
            }
        }
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
                        // SAFETY: tty is a live heap-allocated Tty*;
                        // `Tty::close` keeps whole-struct provenance so
                        // on_tty_close may reclaim the Box.
                        unsafe {
                            (*p).uv.data = p.cast::<c_void>();
                            crate::source::Tty::close(p, Self::on_tty_close);
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
        if let Some(source) = self.source.take() {
            if !source.is_closed() {
                // closeImpl will take care of freeing the source.
                // Dropping the `Box<Pipe>` here would free a uv_pipe_t still
                // linked into the loop's handle queue → UAF. Restore the source
                // so close_impl can do the proper take + hand-off to libuv
                // (into_raw + uv_close). close_impl also parks `_buffer` on
                // the File for an in-flight uv_fs_read (orphaned_read_buf),
                // which is why `_buffer` is freed after this, not before.
                self.source = Some(source);
                self.close_impl::<false>();
            } else {
                // Already closing/closed: a uv close callback may still be
                // pending on this allocation; dropping the Box would free
                // memory libuv still owns, so leak it instead.
                core::mem::forget(source);
            }
        }
        self._buffer = Vec::new();
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
        // libuv passes the same pointer back; `Tty::from_uv` recovers the
        // owning `Tty`. Caller gates on `!is_stdin_tty`, so it is heap-owned,
        // and no request is pending once this runs (`uv::Tty::read_scratch`).
        let tty = crate::source::Tty::from_uv(handle);
        debug_assert!(!crate::source::stdin_tty::is_stdin_tty(tty));
        // SAFETY: non-stdin tty is heap-allocated; sole owner after uv_close.
        drop(unsafe { bun_core::heap::take(tty) });
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

        // Address arithmetic: `slice` covers spare (uninit) capacity, so no `&[u8]` over the Vec may be formed for the check.
        debug_assert!(
            slice.is_empty()
                || (slice.as_ptr() as usize >= self._buffer.as_ptr() as usize
                    && slice.as_ptr() as usize + slice.len()
                        <= self._buffer.as_ptr() as usize + self._buffer.capacity()),
            "uv_read_cb: buf is not in buffer! This is a bug in bun. Please report it."
        );

        // move cursor foward
        // SAFETY: slice is inside _buffer's spare capacity; libuv wrote `amount_result` bytes.
        unsafe { bun_core::vec::commit_spare(&mut self._buffer, amount_result) };

        // Using the limit up is this reader's EOF (`ReadLimit`); so is exhausting `maxBuffer`.
        let limit_reached = self.limit.charge(amount_result);
        let over_budget = self.charge_max_buffer(amount_result);
        let has_more = if limit_reached || over_budget {
            ReadState::Eof
        } else {
            has_more
        };
        // Parents that want the reader paused call `reader().pause()` themselves; stopping here could free a parent whose caller still holds `this` (FileResponseStream on abort).
        let _ = self.on_read_chunk(has_more);

        if has_more == ReadState::Eof {
            self.close();
        }
    }

    pub fn pause(&mut self) {
        let _ = self.stop_reading();
    }

    pub fn unpause(&mut self) {
        if self.limit.reached() && !self.is_done() {
            // Nothing left to read: report EOF the way a completed read does instead of issuing one.
            self.on_read(sys::Result::Ok(0), &mut [], ReadState::Eof);
            return;
        }
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

    /// Windows reads complete through libuv, never synchronously; this just makes sure one is in flight.
    ///
    /// # Safety
    /// `this` is the live reader.
    pub unsafe fn read_into(this: *mut Self, _dst: &mut [u8]) -> (usize, ReadState) {
        // SAFETY: caller contract; borrow scoped to the call.
        unsafe { (*this).unpause() };
        (0, ReadState::Progress)
    }
}

// Keep boolean state in the `WindowsFlags` bitflags field — no loose `bool`
// fields on `WindowsBufferedReader`.

#[cfg(windows)]
impl Drop for WindowsBufferedReader {
    fn drop(&mut self) {
        // SAFETY: the node is a field of `self`.
        unsafe { uv::Deferred::cancel(&raw mut self.stream_read.deferred) };
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
