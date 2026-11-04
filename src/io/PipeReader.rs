use core::ffi::c_void;
use core::mem;
use core::ptr::NonNull;

use bun_sys::{self as sys, Fd};

use crate::{EventLoopHandle, FilePollKind, FilePollRef, Owner, PollTag};

/// `bun_io::poll_tag::BUFFERED_READER` — every `FilePoll` allocated by this
/// module stores a `*mut BufferedReader` (erased) as its owner; the per-tag
/// dispatch in `bun_runtime::dispatch::__bun_run_file_poll` recovers the type
/// from this constant. T2 cannot name `bun_io`, so the value is mirrored.
use crate::max_buf::MaxBuf;
use crate::pipes::{Chunk, FileType, PollOrFd, ReadState};

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
// BufferedReader
// ──────────────────────────────────────────────────────────────────────────

pub struct BufferedReader {
    pub handle: PollOrFd,
    /// Set once `preadv2(RWF_NOWAIT)` said this fd's file type does not support it (tty), so we stop asking.
    rwf_unsupported: core::cell::Cell<bool>,
    pub _buffer: Vec<u8>,
    pub(crate) _offset: usize,
    limit: ReadLimit,
    pub(crate) vtable: BufferedReaderVTable,
    pub flags: ReaderFlags,
    // MaxBuf uses hand-rolled dual-ownership (Subprocess + reader) via
    // `add_to_pipereader`/`remove_from_pipereader`, not Arc — see MaxBuf.rs.
    pub maxbuf: Option<NonNull<MaxBuf>>,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub struct ReaderFlags: u16 {
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
        /// A read failed with a non-retry errno. Set before the bytes read ahead of the failure are delivered, so a pull from inside that delivery cannot read the fd past the error. Never cleared: `start()`, `unpause()` and `from()` keep it, and only a reader from `init()` reads again.
        const READ_FAILED              = 1 << 11;
        /// One chunk per wakeup also from what cannot block. For a streaming parent that never says stop: a source that never runs dry would keep the loop to itself.
        const IN_TURNS                 = 1 << 12;
    }
}

impl ReaderFlags {
    /// This process's end of what a child has for `Stdio::Buffer`: a socket, or on Windows a pipe.
    pub const CHILD_STDIO: Self = if cfg!(windows) {
        Self::NONBLOCKING
    } else {
        Self::NONBLOCKING.union(Self::SOCKET)
    };

    pub(crate) const fn new() -> Self {
        Self::from_bits_truncate(ReaderFlags::CLOSE_HANDLE.bits() | ReaderFlags::KEEP_ALIVE.bits())
    }
}

impl BufferedReader {
    pub fn init<T: BufferedReaderParent>() -> BufferedReader {
        BufferedReader {
            handle: PollOrFd::Closed,
            rwf_unsupported: core::cell::Cell::new(false),
            _buffer: Vec::new(),
            _offset: 0,
            limit: ReadLimit::NONE,
            vtable: BufferedReaderVTable::init::<T>(),
            flags: ReaderFlags::new(),
            maxbuf: None,
        }
    }

    pub fn update_ref(&mut self, value: bool) {
        // Remember the ref state so a poll created later (lazy start) honours
        // an unref() that preceded the first registration.
        self.flags.set(ReaderFlags::KEEP_ALIVE, value);
        let Some(poll) = self.handle.get_poll() else {
            return;
        };
        // An unarmed poll delivers nothing; `try_register_poll` applies KEEP_ALIVE when it arms.
        if value && !poll.is_watching() {
            return;
        }
        poll.set_keeping_process_alive(self.vtable.event_loop(), value);
    }

    #[inline]
    pub fn is_done(&self) -> bool {
        self.flags.intersects(
            ReaderFlags::IS_DONE
                | ReaderFlags::RECEIVED_EOF
                | ReaderFlags::CLOSED_WITHOUT_REPORTING,
        )
    }

    pub fn memory_cost(&self) -> usize {
        mem::size_of::<Self>() + self._buffer.capacity()
    }

    pub fn from(&mut self, other: &mut BufferedReader, parent: *mut c_void) {
        let kind = self.vtable.kind;
        *self = BufferedReader {
            handle: mem::replace(&mut other.handle, PollOrFd::Closed),
            rwf_unsupported: other.rwf_unsupported.clone(),
            _buffer: mem::take(other.buffer()),
            _offset: other._offset,
            limit: other.limit,
            flags: other.flags,
            vtable: BufferedReaderVTable { kind, parent },
            maxbuf: None,
        };
        other.flags.insert(ReaderFlags::IS_DONE);
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
        self.flags.insert(ReaderFlags::MEMFD);
        self.handle = PollOrFd::Fd(fd);
    }

    pub(crate) fn get_file_type(&self) -> FileType {
        let flags = self.flags;
        if flags.contains(ReaderFlags::SOCKET) {
            return FileType::Socket;
        }

        if flags.contains(ReaderFlags::POLLABLE) {
            // On Windows `FilePoll::read` stands in for the system call, and it does not wait.
            if cfg!(windows) || flags.contains(ReaderFlags::NONBLOCKING) {
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
            debug_assert!(!self.flags.contains(ReaderFlags::CLOSED_WITHOUT_REPORTING));
            self.flags.insert(ReaderFlags::CLOSED_WITHOUT_REPORTING);
            if self.flags.contains(ReaderFlags::CLOSE_HANDLE) {
                let owner = std::ptr::from_mut(self).cast::<c_void>();
                self.handle.close(Some(owner), None::<fn(*mut c_void)>);
            }
        }
    }

    pub fn get_fd(&self) -> Fd {
        self.handle.get_fd()
    }

    pub fn pause(&mut self) {
        if self.flags.contains(ReaderFlags::IS_PAUSED) {
            return;
        }
        self.flags.insert(ReaderFlags::IS_PAUSED);

        // Unregister the FilePoll if it's registered
        if let PollOrFd::Poll(poll) = &mut self.handle {
            if poll.is_registered() {
                let _ = poll.unregister(self.vtable.event_loop().loop_(), false);
            }
        }
    }

    pub fn unpause(&mut self) {
        if !self.flags.contains(ReaderFlags::IS_PAUSED) {
            return;
        }
        self.flags.remove(ReaderFlags::IS_PAUSED);
        // The next read() call will re-register the poll if needed
    }

    pub fn take_buffer(&mut self) -> Vec<u8> {
        mem::take(&mut self._buffer)
    }

    pub fn buffer(&mut self) -> &mut Vec<u8> {
        &mut self._buffer
    }

    pub fn final_buffer(&mut self) -> &mut Vec<u8> {
        if self.flags.contains(ReaderFlags::MEMFD) {
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
            || self.flags.contains(ReaderFlags::CLOSED_WITHOUT_REPORTING)
        {
            if self.flags.contains(ReaderFlags::CLOSE_HANDLE) {
                // SAFETY: `self` is live. Note: this `&mut self` receiver still carries
                // a protector across the (maybe-freeing) done dispatch — pre-existing
                // on the parent chain, tracked with the raw-dispatch follow-up.
                unsafe { Self::close_handle(std::ptr::from_mut(self)) };
            }
            return;
        }

        debug_assert!(!self.flags.contains(ReaderFlags::IS_DONE));
        self.flags.insert(ReaderFlags::IS_DONE);
        self._buffer.shrink_to_fit();
    }

    /// # Safety
    /// `this` is the live reader. Raw (not `&mut self`): the `done` it can
    /// reach dispatches `on_reader_done`, which may drop the last reference to
    /// the struct embedding `*this` — a free must never run under a live
    /// receiver protector.
    unsafe fn close_handle(this: *mut Self) {
        // SAFETY: caller contract; borrows end at each `;`.
        let deferred_report = unsafe {
            (*this)
                .flags
                .contains(ReaderFlags::CLOSED_WITHOUT_REPORTING)
        };
        if deferred_report {
            // SAFETY: caller contract; borrow ends before the (maybe-freeing) done.
            unsafe {
                (*this).flags.remove(ReaderFlags::CLOSED_WITHOUT_REPORTING);
                Self::done(this);
            }
            return;
        }

        // SAFETY: caller contract; the `handle` borrow is scoped to the call.
        // The close callback receives the same raw pointer, so its `done` also
        // runs without a receiver borrow.
        unsafe {
            if (*this).flags.contains(ReaderFlags::CLOSE_HANDLE) {
                (*this).handle.close(
                    Some(this.cast::<c_void>()),
                    // SAFETY: ctx is the live reader raw pointer passed above.
                    Some(|ctx: *mut c_void| Self::done(ctx.cast::<BufferedReader>())),
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
                && (*this).flags.contains(ReaderFlags::CLOSE_HANDLE)
            {
                Self::close_handle(this);
                return;
            } else if (*this)
                .flags
                .contains(ReaderFlags::CLOSED_WITHOUT_REPORTING)
            {
                (*this).flags.remove(ReaderFlags::CLOSED_WITHOUT_REPORTING);
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
        if self.flags.contains(ReaderFlags::IS_PAUSED) {
            return Ok(());
        }
        let ev = self.vtable.event_loop();
        let Some(poll) = self.ensure_poll() else {
            return Ok(());
        };

        // Re-applied on every arm: `pause()` unregisters, which drops it.
        if self.flags.contains(ReaderFlags::KEEP_ALIVE) {
            poll.enable_keeping_process_alive(ev);
        }

        match poll.register_with_fd(ev.loop_(), FilePollKind::Readable, poll.fd()) {
            sys::Result::Err(err) => Err(err),
            sys::Result::Ok(()) => Ok(()),
        }
    }

    /// The poll of a pollable source, made on first use.
    fn ensure_poll(&mut self) -> Option<FilePollRef> {
        let owner = Owner::new(
            PollTag::BufferedReader,
            std::ptr::from_mut(self).cast::<()>(),
        );
        if let PollOrFd::Fd(fd) = self.handle {
            if !self.flags.contains(ReaderFlags::POLLABLE) {
                return None;
            }
            let mut flags = crate::file_poll::FlagsSet::empty();
            if self.flags.contains(ReaderFlags::SOCKET) {
                flags.insert(crate::FilePollFlag::Socket);
            }
            if self.flags.contains(ReaderFlags::NONBLOCKING) {
                flags.insert(crate::FilePollFlag::Nonblocking);
            }
            self.handle = PollOrFd::Poll(FilePollRef::init(
                self.vtable.event_loop(),
                fd,
                flags,
                owner,
            ));
        }
        let poll = self.handle.get_poll()?;
        poll.set_owner(owner);
        Some(poll)
    }

    pub fn start(&mut self, fd: Fd, is_pollable: bool) -> sys::Result<()> {
        if !is_pollable {
            self.buffer().clear();
            self.flags.remove(ReaderFlags::IS_DONE);
            self.handle.close(None, None::<fn(*mut c_void)>);
            self.handle = PollOrFd::Fd(fd);
            return sys::Result::Ok(());
        }
        self.flags.insert(ReaderFlags::POLLABLE);
        if self.get_fd() != fd {
            self.handle = PollOrFd::Fd(fd);
        }
        // With nothing left to read the fd is never waited on: like a non-pollable source, the parent's first read request ends the reader.
        if !self.flags.contains(ReaderFlags::IS_PAUSED) && !self.limit.reached() {
            // SAFETY: `self` is live. Note: this `&mut self` receiver still carries
            // a protector across the (maybe-freeing) error dispatch — pre-existing
            // on the parent chain, tracked with the raw-dispatch follow-up.
            unsafe { Self::register_poll(std::ptr::from_mut(self)) };
        }

        sys::Result::Ok(())
    }

    pub fn start_file_offset(&mut self, fd: Fd, poll: bool, offset: usize) -> sys::Result<()> {
        self._offset = offset;
        self.flags.insert(ReaderFlags::USE_PREAD);
        self.start(fd, poll)
    }

    /// Ends the reader after the next `len` bytes of the source as if they were followed by EOF (`ReadLimit`); `None` reads to EOF. Set before starting.
    pub fn set_limit(&mut self, len: Option<usize>) {
        self.limit = ReadLimit(len);
    }

    pub fn has_pending_read(&self) -> bool {
        // `is_watching()` (registered && !needs-rearm) rather than
        // `is_registered()`: a one-shot poll that has fired but not been
        // re-armed will not deliver another callback, so callers that skip
        // `read()` on "pending" must not be told one is in flight.
        matches!(&self.handle, PollOrFd::Poll(poll) if poll.is_watching())
    }

    pub fn watch(&mut self) {
        if self.flags.contains(ReaderFlags::POLLABLE)
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
        // SAFETY: caller contract; borrow ends at `;`.
        if unsafe { (*this).asks_before_reading(file_type) } {
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
    pub unsafe fn on_poll(this: *mut BufferedReader, size_hint: isize, received_hup: bool) {
        // SAFETY: caller contract — `this` is live; borrows end at each `;`.
        let Some((fd, file_type, vtable)) = (unsafe { (*this).begin_read() }) else {
            return;
        };
        bun_sys::syslog!("onPoll({}) = {}", fd, size_hint);
        let _parent = vtable.ref_parent();
        // SAFETY: caller contract.
        unsafe { Self::read_loop(this, file_type, fd, received_hup) };
    }

    /// A pipe may block. In turns, all that is left is read once the other end is gone (on Windows one chunk has all that a pipe holds). A used-up limit is reported without reading.
    fn asks_before_reading(&self, file_type: FileType) -> bool {
        #[cfg(windows)]
        const _: () = assert!(bun_sys::windows::pipe::BUFFER_SIZE <= 128 * 1024);
        let in_turns = cfg!(not(windows)) && self.flags.contains(ReaderFlags::IN_TURNS);
        (file_type == FileType::Pipe || in_turns) && !self.limit.reached()
    }

    fn begin_read(&self) -> Option<(Fd, FileType, BufferedReaderVTable)> {
        if self
            .flags
            .intersects(ReaderFlags::IS_PAUSED | ReaderFlags::READ_FAILED)
        {
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
    fn sys_read(&mut self, file_type: FileType, fd: Fd, buf: &mut [u8]) -> sys::Result<usize> {
        match file_type {
            FileType::File if self.flags.contains(ReaderFlags::USE_PREAD) => {
                sys::pread(fd, buf, i64::try_from(self._offset).expect("int cast"))
            }
            FileType::File => sys::read(fd, buf),
            #[cfg(windows)]
            FileType::Socket | FileType::NonblockingPipe | FileType::Pipe => {
                match self.ensure_poll() {
                    Some(poll) => poll.read(buf),
                    None => Err(sys::Error::from_code(sys::E::EBADF, sys::Tag::read)),
                }
            }
            #[cfg(not(windows))]
            FileType::Socket => sys::recv_non_block(fd, buf),
            #[cfg(not(windows))]
            FileType::NonblockingPipe | FileType::Pipe => {
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    if !self.rwf_unsupported.get() {
                        match sys::read_nowait(fd, buf) {
                            Ok(None) => self.rwf_unsupported.set(true),
                            Ok(Some(n)) => return Ok(n),
                            Err(e) => return Err(e),
                        }
                    }
                    // Poll first even when labelled nonblocking: some callers (FileResponseStream) label by fd kind, not by O_NONBLOCK.
                    match bun_core::is_readable(fd) {
                        bun_core::Pollable::Ready | bun_core::Pollable::Hup => sys::read(fd, buf),
                        bun_core::Pollable::NotReady => Err(sys::Error::retry().with_fd(fd)),
                    }
                }
                // macOS poll(2) is unreliable on FIFOs; the kqueue registration drives readiness there.
                #[cfg(not(any(target_os = "linux", target_os = "android")))]
                sys::read(fd, buf)
            }
        }
    }

    /// Appends what can be read without waiting, past the parent's callbacks. The end of the stream and errors are left for the event loop to find.
    pub fn read_available(&mut self, into: &mut Vec<u8>) {
        let Some((fd, file_type, _)) = self.begin_read() else {
            return;
        };
        if !fd.is_valid() {
            return;
        }
        let mut chunk = [0u8; 16 * 1024];
        while let Ok(count @ 1..) = self.sys_read(file_type, fd, &mut chunk) {
            into.extend_from_slice(&chunk[..count]);
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
            sys::Result::Err(err) => {
                self.flags.insert(ReaderFlags::READ_FAILED);
                ReadOnce::Stop(Stop::Error(err))
            }
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
        this: *mut BufferedReader,
        file_type: FileType,
        fd: Fd,
        mut received_hup: bool,
    ) {
        // SAFETY: caller contract — `this` is live.
        let vtable = unsafe { (*this).vtable };
        let streaming = vtable.is_streaming_enabled();
        // SAFETY: caller contract; borrow ends at `;`.
        let in_turns = unsafe { (*this).flags.contains(ReaderFlags::IN_TURNS) };
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
                    unsafe { (*this).close_if_final(stop.as_ref()) };
                    let keep_going = if filled == 0 {
                        true
                    } else if streaming {
                        vtable.on_read_chunk(
                            Chunk::Scratch(&scratch[..filled]),
                            Self::read_state(stop.as_ref()),
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
                    unsafe { (*this).close_if_final(stop.as_ref()) };
                    // SAFETY: caller contract; borrow ends at `;`.
                    let keep_going = if !streaming || unsafe { (*this)._buffer.is_empty() } {
                        true
                    } else {
                        // Moved out so a re-entrant read cannot alias or reallocate it under the consumer.
                        // SAFETY: caller contract; borrow ends at `;`.
                        let mut buffer = unsafe { mem::take(&mut (*this)._buffer) };
                        let state = Self::read_state(stop.as_ref());
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
                        if !(*this).flags.contains(ReaderFlags::IS_DONE) {
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
            if file_type != FileType::Pipe && (received_hup || !in_turns) {
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
    fn close_if_final(&mut self, stop: Option<&Stop>) {
        if matches!(stop, Some(Stop::Eof | Stop::OverBudget)) {
            self.close_without_reporting();
        }
    }

    fn read_state(stop: Option<&Stop>) -> ReadState {
        match stop {
            Some(Stop::Eof | Stop::OverBudget) => ReadState::Eof,
            Some(Stop::WouldBlock) => ReadState::Drained,
            Some(Stop::Error(_)) | None => ReadState::Progress,
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
        // SAFETY: caller contract; borrow ends at `;`.
        if unsafe { (*this).asks_before_reading(file_type) } {
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
                    if !(*this).flags.contains(ReaderFlags::IS_DONE) {
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

impl Drop for BufferedReader {
    fn drop(&mut self) {
        MaxBuf::remove_from_pipereader(&mut self.maxbuf);
        self.close_without_reporting();
    }
}
