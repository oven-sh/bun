//! A pipe HANDLE driven by the loop.
//!
//! How a pipe is driven depends on where the HANDLE came from:
//!
//! - [`Mode::Owned`]: an overlapped end Bun created. It is associated with the
//!   loop's completion port and every operation is a plain overlapped call.
//! - [`Mode::Event`]: an overlapped end somebody else created (inherited stdio,
//!   an fd adopted from JS). It is never associated with the port — the
//!   association belongs to the file object, which other processes share — so
//!   each operation carries an event with the low bit set (no packet is queued
//!   anywhere) and a wait on that event delivers it to the loop.
//! - [`Mode::Sync`]: a synchronous end. Reads block on the pipe's own reader
//!   thread ([`SyncReader`]) and writes on a helper thread; each posts its
//!   result to the loop.
//! - [`Mode::Unknown`]: somebody else's end that nobody has classified yet.
//!   Finding out takes the file object's lock ([`classify`]), so the helper
//!   thread of its first read or write does that before anything else, and the
//!   loop moves the pipe to `Event` or `Sync` when it hears.
//!
//! A read that takes bytes is never cancelled except by closing: cancelling a
//! buffered pipe read can make the peer's `WriteFile` report success for bytes
//! nobody received. Pausing an `Owned` pipe lets the read complete and holds
//! what it produced. On the others, which someone else may read next, what
//! is pending is a zero-byte read; pausing cancels that, and nothing has left
//! the pipe (see [`Pipe::read_stop`]).

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, Ordering};
use std::rc::Rc;
use std::sync::Arc;

use bun_sys::{self as sys, E, Fd, FdExt as _, Tag};
use bun_uws_sys::Loop;
use bun_uws_sys::iocp::{self, Op, OverlappedEntry, Wait};
use bun_windows_sys::ntdll::NtFsControlFile;
use bun_windows_sys::{FILE_PIPE_PEEK_BUFFER, FSCTL_PIPE_PEEK};

use super::sys as win;
use super::sys::{HANDLE, INVALID_HANDLE_VALUE, Win32Error};
use super::{Callback, Link, Port, ReadCallback};

bun_core::declare_scope!(WinPipe, hidden);

/// Bytes asked of the kernel per read unless the owner says otherwise.
pub const DEFAULT_READ_SIZE: usize = 64 * 1024;

/// `WriteFile` takes a `DWORD`; larger buffers go out in several calls.
const MAX_WRITE_CHUNK: usize = 0x7fff_f000;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Mode {
    Owned,
    Event,
    Sync,
    Unknown,
}

/// What [`classify`] found a pipe HANDLE to be.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Synchronous,
    Overlapped,
    /// Not something this module can drive; the `errno` its I/O fails with.
    Unusable(E),
}

/// What the first classification of each standard handle found. A standard
/// handle is the same file object for the life of the process, and the pipe
/// mode [`classify`] set belongs to the pipe end, so both hold for every later
/// open: the second and third stream, every Worker.
static STD_MODES: [AtomicU8; 3] = [AtomicU8::new(0), AtomicU8::new(0), AtomicU8::new(0)];
const STD_MODE_EVENT: u8 = 1;
const STD_MODE_SYNC: u8 = 2;

/// Where a pipe HANDLE came from, which decides how it is driven.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PipeOrigin {
    /// An overlapped end Bun created (a spawned child's stdio, a pseudoconsole
    /// pipe, a connected client). It is associated with the loop's completion
    /// port.
    Created,
    /// A HANDLE to a file object that was opened as [`Created`](Self::Created)
    /// on this loop before (a duplicate): the port has it already, and a file
    /// object is associated once.
    Associated,
    /// A synchronous byte-mode end Bun created (`bun_sys::pipe()`). Nothing
    /// about it has to be found out.
    CreatedSynchronous,
    /// An end somebody else created (inherited stdio, an fd that came from
    /// JS). A standard handle is duplicated and the original is left alone.
    Foreign,
    /// An end this process inherited and that nobody else does I/O on, by the
    /// protocol it came with (the IPC channel a parent names in
    /// `NODE_CHANNEL_FD`). A completion port on its file object then affects
    /// nobody else, so an overlapped end is driven through the loop's port
    /// like a pipe Bun created. A standard handle is [`Foreign`](Self::Foreign)
    /// all the same: others in this process use it by number too.
    InheritedUnshared,
}

impl PipeOrigin {
    /// What `is_pollable` of a reader's or writer's `start` says on Windows:
    /// set for an overlapped pipe end Bun created; clear for anything else,
    /// which [`Source::open`](crate::source::Source::open) classifies and, if
    /// it is a pipe, treats as somebody else's.
    pub(crate) fn from_is_pollable(is_pollable: bool) -> PipeOrigin {
        if is_pollable {
            PipeOrigin::Created
        } else {
            PipeOrigin::Foreign
        }
    }
}

/// How a write hears that the kernel refused it at once (the reader of the
/// pipe is gone, say).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Refusal {
    /// From the `write` call itself; `on_write` never runs.
    Returned,
    /// As of a write that fails later: from `on_write`, from the loop. For a
    /// caller with nowhere to take a failure to yet.
    Posted,
}

/// What a read produced.
pub enum ReadEvent<'a> {
    /// Bytes from the pipe, after whatever
    /// [`lend_read_buffer`](Pipe::lend_read_buffer) handed over. The `Vec` may
    /// be taken (`mem::take`, `mem::swap` with an empty one); whatever is left
    /// in it is discarded and its capacity reused for the next read.
    Data(&'a mut Vec<u8>),
    /// The write side is gone. Reading has stopped.
    Eof,
    /// The other end has finished writing and is still open: on a
    /// message-type pipe it sent the zero-length message that says so (what
    /// [`write_end_marker`](Pipe::write_end_marker) sends). Reading has
    /// stopped; the pipe can still be written to.
    EndOfWrite,
    /// Reading has stopped.
    Err(sys::Error),
}

/// The owner's handle to a pipe. Dropping it closes the pipe without telling
/// anyone: in-flight operations are cancelled and orphaned, and the HANDLE is
/// released once the last of them has been collected.
pub struct Pipe {
    inner: NonNull<Inner>,
}

bitflags::bitflags! {
    #[derive(Clone, Copy)]
    struct Flags: u16 {
        /// The owner wants `ReadEvent`s.
        const READING        = 1 << 0;
        const REFD           = 1 << 1;
        /// Counted in the loop's `active`.
        const KEEPING_ALIVE  = 1 << 2;
        /// `close` ran; nothing new is submitted and nobody is called back.
        const CLOSING        = 1 << 3;
        /// EOF or a read error was delivered.
        const READ_ENDED     = 1 << 4;
        /// The loop is going away: nothing may touch it again.
        const DETACHED       = 1 << 5;
        /// The owner's `Pipe` is gone; free `Inner` when nothing refers to it.
        const OWNER_GONE     = 1 << 6;
        /// The owner went away without asking to hear about unfinished writes.
        const SILENT         = 1 << 7;
        /// `handle` is this pipe's own duplicate of a standard handle.
        const DUPLICATED     = 1 << 8;
        /// `MESSAGE_TYPE` has been looked up.
        const TYPE_KNOWN     = 1 << 9;
        /// The pipe was created as a message-type pipe.
        const MESSAGE_TYPE   = 1 << 10;
    }
}

#[repr(C)]
struct Inner {
    link: Link,
    handle: HANDLE,
    /// How the HANDLE is released; `None` leaves it to whoever lent it.
    close_fd: Option<Fd>,
    mode: Mode,
    flags: Flags,
    port: Option<Arc<Port>>,
    /// The [`STD_MODES`] entry of the standard handle this is a duplicate of.
    std_slot: Option<&'static AtomicU8>,

    reader: Option<ReadCallback>,
    read_op: *mut ReadOp,
    read_size: usize,
    sync_reader: Option<SyncReader>,
    /// `Sync` and `Unknown` modes: the HANDLE the write threads use.
    sync_handle: Option<Arc<SyncHandle>>,
    /// The write a helper thread has.
    sync_write: Option<Arc<SyncWrite>>,
    /// The last one, to use again once its thread has let go of it.
    sync_spare: Option<Arc<SyncWrite>>,

    /// Accepted, not yet handed to the kernel (every mode but `Owned` runs one
    /// write at a time).
    write_head: *mut WriteOp,
    write_tail: *mut WriteOp,
    /// The one write the kernel has in `Event` mode.
    event_write: *mut WriteOp,
    writes_in_flight: u32,
    /// A write longer than one `WriteFile` can take that still has chunks to
    /// go: nothing queued behind it may reach the kernel before its last one.
    chunked_write: *mut WriteOp,
    /// A finished write kept for the next one.
    spare_write: *mut WriteOp,
    /// The [`Pipe::flush_peer`] request that is out.
    flush_op: *mut FlushOp,
    write_lane: Lane,
    /// Buffers of writes that outlived the owner who lent them.
    adopted: Vec<Vec<u8>>,
    /// The buffer of a lent write that is over, for its owner to take back
    /// from the write's callback or from `write_lent`'s refusal.
    lent_back: Option<Vec<u8>>,
    blocking_event: HANDLE,

    /// Packets that will dereference this allocation when dequeued.
    pending: u32,
    /// Stack frames that are inside a callback and will touch this allocation
    /// when it returns.
    pins: u32,
}

/// The event an `Event`-mode operation completes through and the wait that
/// brings it to the loop.
struct Lane {
    event: HANDLE,
    wait: *mut Wait,
}

impl Lane {
    const NONE: Lane = Lane {
        event: ptr::null_mut(),
        wait: ptr::null_mut(),
    };

    /// # Safety
    /// `loop_` is the live loop of the calling thread.
    unsafe fn ensure(&mut self, loop_: *mut Loop) -> Result<(), Win32Error> {
        if !self.event.is_null() {
            return Ok(());
        }
        // SAFETY: plain Win32 call; manual-reset so the kernel's own reset at
        // the start of each operation is the only one.
        let event = unsafe { win::CreateEventW(ptr::null_mut(), 1, 0, ptr::null()) };
        if event.is_null() {
            return Err(win::last_error());
        }
        // SAFETY: caller contract.
        let wait = unsafe { iocp::us_iocp_wait_create(loop_) };
        if wait.is_null() {
            // SAFETY: `event` was just created.
            unsafe { win::CloseHandle(event) };
            return Err(Win32Error::NOT_ENOUGH_MEMORY);
        }
        self.event = event;
        self.wait = wait;
        Ok(())
    }

    /// `op` pended on `handle` with this lane's event and no wait could be
    /// registered for it, so nothing would ever announce its completion: take
    /// it back from the kernel. The wait here is for the cancellation, which
    /// the pipe driver completes by itself; no peer has a say in it.
    ///
    /// # Safety
    /// `op` is the pending operation; it carries this lane's event.
    unsafe fn take_back(&self, handle: HANDLE, op: *mut Op) -> (Win32Error, usize) {
        // SAFETY: caller contract.
        unsafe {
            win::CancelIoEx(handle, op.cast());
            bun_sys::windows::kernel32::WaitForSingleObject(self.event, bun_sys::windows::INFINITE);
            // The I/O is over, which is what fills the OVERLAPPED in.
            match win::status_to_win32((*op).status()) {
                Win32Error::OPERATION_ABORTED => {
                    (Win32Error::NOT_ENOUGH_MEMORY, (*op).bytes_transferred())
                }
                raced => (raced, (*op).bytes_transferred()),
            }
        }
    }

    /// # Safety
    /// No wait is armed and no operation references the event.
    unsafe fn release(&mut self) {
        if !self.wait.is_null() {
            // SAFETY: caller contract.
            unsafe { iocp::us_iocp_wait_free(self.wait) };
            self.wait = ptr::null_mut();
        }
        if !self.event.is_null() {
            // SAFETY: caller contract.
            unsafe { win::CloseHandle(self.event) };
            self.event = ptr::null_mut();
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReadState {
    Idle,
    InFlight,
    /// Completed while the owner was not reading; `outcome` is what it found.
    Held,
    /// A held result on its way back through the port.
    Replaying,
    /// Inside the owner's callback.
    Delivering,
}

enum Outcome {
    None,
    Data,
    Eof,
    EndOfWrite,
    Err(sys::Error),
}

#[repr(C)]
struct ReadOp {
    op: Op,
    /// Outlives the operation: a pipe is freed only once `pending` is zero.
    pipe: *mut Inner,
    state: ReadState,
    outcome: Outcome,
    buf: Vec<u8>,
    /// What `buf` held when the read was submitted (see
    /// [`Pipe::lend_read_buffer`]). The read lands after it, in spare
    /// capacity reserved by the loop thread, and only the loop thread touches
    /// the `Vec` itself.
    kept: usize,
    /// [`Pipe::take_read_buffer`] copied those bytes out from under a read in
    /// flight.
    kept_taken: bool,
    /// Where the read in flight lands: `buf`'s spare capacity.
    dest: *mut u8,
    posted: Posted,
    /// From the reader thread of an `Unknown` pipe, with its first answer.
    verdict: Option<Kind>,
    lane: Lane,
    /// The most this read may take: the owner's read size when it was
    /// submitted. Every mode reads against this one number.
    max_len: u32,
    /// `read_stop` took the wait out of the kernel: an aborted completion is
    /// not an error.
    stopped: bool,
    /// Every mode but `Owned`: the operation out waits for data (a zero-byte
    /// read) and takes none. Its completion says the pipe is readable; the loop
    /// then asks for the bytes, if its owner still wants them.
    zero_wait: bool,
    /// `Sync` and `Unknown` modes, once the reader thread has taken the
    /// request: who finishes it (`READ_*`).
    finisher: AtomicU8,
}

const READ_REQUESTED: u8 = 0;
/// A packet for it is on its way to the loop: the reader thread is handing
/// the result to the port, or the loop took the request back unanswered.
const READ_POSTED: u8 = 1;
/// The pipe closed while the thread had the request: the thread frees it.
const READ_ORPHANED: u8 = 2;

type WriteResult = sys::Result<usize>;

/// How an operation went when Bun queued its packet itself, because the call
/// finished or failed without the kernel queuing one, or a helper thread made
/// it: the result and the bytes moved. `None` on an operation means the
/// kernel's packet (or the wait packet of an I/O that pended) brought it, and
/// only then does its OVERLAPPED say how it went.
type Posted = Option<(Win32Error, usize)>;

#[repr(C)]
struct WriteOp {
    op: Op,
    pipe: *mut Inner,
    next: *mut WriteOp,
    data: *const u8,
    len: usize,
    done: usize,
    chunk: u32,
    /// The bytes when the operation owns them (`data` points into it). While
    /// a helper thread has the write they are in its [`SyncWrite`].
    owned: Vec<u8>,
    /// The bytes are the caller's buffer, which it takes back when the write
    /// is over ([`Pipe::write_lent`]).
    lent: bool,
    callback: Option<Callback<WriteResult>>,
    posted: Posted,
    /// What ended the write short of `len`.
    error: Option<sys::Error>,
    /// `Unknown` mode: what the helper thread found; nothing was written
    /// unless that is `Synchronous`.
    verdict: Option<Kind>,
}

// ──────────────────────────────────────────────────────────────────────────
// Opening
// ──────────────────────────────────────────────────────────────────────────

impl Pipe {
    /// Take over the pipe end `fd`. It is closed with the pipe when `close_fd`
    /// is set (a standard handle never is). On `Err` the caller still owns `fd`.
    ///
    /// An `fd` that came from outside (`Foreign`, `InheritedUnshared`) may be
    /// no HANDLE at all, or a HANDLE to something else: that fails here.
    pub fn open(loop_: *mut Loop, fd: Fd, origin: PipeOrigin, close_fd: bool) -> sys::Result<Pipe> {
        if matches!(origin, PipeOrigin::Foreign | PipeOrigin::InheritedUnshared) {
            // `GetFileType` does not take the file object's lock.
            match bun_sys::File::borrow(&fd).kind() {
                Ok(bun_sys::FileKind::NamedPipe) => {}
                Ok(_) => return Err(sys::Error::from_code(E::ENOTSOCK, Tag::open).with_fd(fd)),
                Err(err) => {
                    return Err(sys::Error {
                        syscall: Tag::open,
                        ..err
                    }
                    .with_fd(fd));
                }
            }
        }
        Self::open_classified(loop_, fd, origin, close_fd)
    }

    /// [`open`](Self::open) by a caller that `GetFileType` has told `fd` is a
    /// pipe.
    pub(crate) fn open_classified(
        loop_: *mut Loop,
        fd: Fd,
        origin: PipeOrigin,
        close_fd: bool,
    ) -> sys::Result<Pipe> {
        match origin {
            PipeOrigin::Created => Self::open_created(loop_, fd, close_fd),
            PipeOrigin::Associated => Ok(Self::create(
                loop_,
                fd.native(),
                close_fd.then_some(fd),
                Mode::Owned,
            )),
            PipeOrigin::CreatedSynchronous => Ok(Self::create(
                loop_,
                fd.native(),
                close_fd.then_some(fd),
                Mode::Sync,
            )),
            PipeOrigin::Foreign => Self::open_foreign(loop_, fd, close_fd),
            PipeOrigin::InheritedUnshared => Self::open_inherited_unshared(loop_, fd, close_fd),
        }
    }

    fn open_created(loop_: *mut Loop, fd: Fd, close_fd: bool) -> sys::Result<Pipe> {
        let handle = fd.native();
        // SAFETY: `loop_` is the caller's live loop.
        let port = unsafe { iocp::us_loop_iocp(loop_) };
        if bun_sys::windows::CreateIoCompletionPort(handle, port, 0, 0).is_err() {
            return Err(sys::Error::from_win32(win::last_error(), Tag::open).with_fd(fd));
        }
        Ok(Self::create(
            loop_,
            handle,
            close_fd.then_some(fd),
            Mode::Owned,
        ))
    }

    /// A pipe-server instance that was associated with `loop_`'s port when it
    /// was created.
    pub(crate) fn from_associated(loop_: *mut Loop, handle: HANDLE) -> Pipe {
        Self::create(loop_, handle, Some(Fd::from_system(handle)), Mode::Owned)
    }

    fn open_foreign(loop_: *mut Loop, fd: Fd, close_fd: bool) -> sys::Result<Pipe> {
        let std_slot = fd.stdio_tag().map(|tag| &STD_MODES[tag as usize]);
        let (handle, close_with) = if std_slot.is_some() {
            let dup = sys::dup(fd)?;
            (dup.native(), Some(dup))
        } else {
            (fd.native(), close_fd.then_some(fd))
        };
        let mode = match std_slot.map(|slot| slot.load(Ordering::Acquire)) {
            Some(STD_MODE_EVENT) => Mode::Event,
            Some(STD_MODE_SYNC) => Mode::Sync,
            _ => Mode::Unknown,
        };
        let pipe = Self::create(loop_, handle, close_with, mode);
        // SAFETY: `inner` is live while `pipe` is.
        unsafe {
            (*pipe.raw()).std_slot = std_slot;
            if std_slot.is_some() {
                (*pipe.raw()).flags.insert(Flags::DUPLICATED);
            }
        }
        Ok(pipe)
    }

    fn open_inherited_unshared(loop_: *mut Loop, fd: Fd, close_fd: bool) -> sys::Result<Pipe> {
        if fd.stdio_tag().is_some() {
            return Self::open_foreign(loop_, fd, close_fd);
        }
        let handle = fd.native();
        // SAFETY: `loop_` is the caller's live loop.
        let port = unsafe { iocp::us_loop_iocp(loop_) };
        // Refused for a synchronous file object, and for one the parent gave a
        // port already. The call takes a synchronous file object's lock, as
        // `classify` does; nobody holds it, since nobody else does I/O on this
        // end (the origin's contract) and this process has done none yet.
        let mode = if bun_sys::windows::CreateIoCompletionPort(handle, port, 0, 0).is_ok() {
            // Overlapped, then: it has no lock for this to wait on.
            if let Err(errno) = set_byte_wait_mode(handle) {
                return Err(sys::Error::from_code(errno, Tag::open).with_fd(fd));
            }
            Mode::Owned
        } else {
            Mode::Unknown
        };
        Ok(Self::create(loop_, handle, close_fd.then_some(fd), mode))
    }

    fn create(loop_: *mut Loop, handle: HANDLE, close_fd: Option<Fd>, mode: Mode) -> Pipe {
        let inner = bun_core::heap::into_raw(Box::new(Inner {
            link: Link::new(loop_, Inner::shut),
            handle,
            close_fd,
            mode,
            flags: Flags::REFD,
            port: None,
            std_slot: None,
            reader: None,
            read_op: ptr::null_mut(),
            read_size: DEFAULT_READ_SIZE,
            sync_reader: None,
            sync_handle: None,
            sync_write: None,
            sync_spare: None,
            write_head: ptr::null_mut(),
            write_tail: ptr::null_mut(),
            event_write: ptr::null_mut(),
            writes_in_flight: 0,
            chunked_write: ptr::null_mut(),
            spare_write: ptr::null_mut(),
            flush_op: ptr::null_mut(),
            write_lane: Lane::NONE,
            adopted: Vec::new(),
            lent_back: None,
            blocking_event: ptr::null_mut(),
            pending: 0,
            pins: 0,
        }));
        // SAFETY: `inner` is at its final address; `link` is its first field.
        unsafe { Link::insert(inner.cast()) };
        bun_core::scoped_log!(WinPipe, "open {:p} {:?}", handle, mode);
        // SAFETY: `into_raw` never returns null.
        Pipe {
            inner: unsafe { NonNull::new_unchecked(inner) },
        }
    }

    #[inline]
    fn raw(&self) -> *mut Inner {
        self.inner.as_ptr()
    }
}

/// Whether `handle` is a synchronous file object, putting the pipe end in
/// byte-read blocking mode on the way.
///
/// Both calls take the lock of a synchronous file object, which is held for as
/// long as any thread of any process has I/O in flight on it (a parked read of
/// an inherited stdin): only a thread that may block that long calls this.
fn classify(handle: HANDLE) -> Kind {
    let mut mode_info: u32 = 0;
    let mut iosb: win::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
    // SAFETY: out-params are live locals sized for FileModeInformation.
    let status = unsafe {
        win::NtQueryInformationFile(
            handle,
            &raw mut iosb,
            (&raw mut mode_info).cast(),
            size_of::<u32>() as u32,
            win::FILE_INFORMATION_CLASS::FileModeInformation,
        )
    };
    if status != win::NTSTATUS::SUCCESS {
        return Kind::Unusable(E::EBADF);
    }
    if let Err(errno) = set_byte_wait_mode(handle) {
        return Kind::Unusable(errno);
    }
    if mode_info & (win::FILE_SYNCHRONOUS_IO_ALERT | win::FILE_SYNCHRONOUS_IO_NONALERT) != 0 {
        Kind::Synchronous
    } else {
        Kind::Overlapped
    }
}

/// `PIPE_READMODE_BYTE | PIPE_WAIT` for the pipe end behind `handle`, which is
/// what every read and write in this module assumes. Takes a synchronous file
/// object's lock, as [`classify`] does.
fn set_byte_wait_mode(handle: HANDLE) -> Result<(), E> {
    let mut pipe_mode = win::PIPE_READMODE_BYTE | win::PIPE_WAIT;
    // SAFETY: `pipe_mode` is a live local; the other parameters are optional.
    let ok = unsafe {
        win::SetNamedPipeHandleState(handle, &raw mut pipe_mode, ptr::null_mut(), ptr::null_mut())
    };
    if ok != 0 {
        return Ok(());
    }
    match win::last_error() {
        // The handle lacks FILE_WRITE_ATTRIBUTES; that is fine as long as the
        // pipe end is in that mode already.
        Win32Error::ACCESS_DENIED => {
            let mut state: u32 = 0;
            // SAFETY: `state` is a live local; the rest is optional.
            let ok = unsafe {
                win::GetNamedPipeHandleStateW(
                    handle,
                    &raw mut state,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    0,
                )
            };
            if ok == 0 {
                Err(E::EBADF)
            } else if state & win::PIPE_NOWAIT != 0 {
                Err(E::EACCES)
            } else if state & win::PIPE_READMODE_MESSAGE != 0 {
                // A zero-byte read of a message-mode end fails with MORE_DATA
                // whenever a message is waiting, so waiting that way cannot
                // work.
                Err(E::EBADF)
            } else {
                Ok(())
            }
        }
        // FILE_TYPE_PIPE, yet not a pipe: a socket.
        Win32Error::INVALID_PARAMETER => Err(E::ENOTSOCK),
        _ => Err(E::EBADF),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Owner-facing API
// ──────────────────────────────────────────────────────────────────────────

impl Pipe {
    pub fn handle(&self) -> HANDLE {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        unsafe { (*self.raw()).handle }
    }

    /// The HANDLE as a system-kind `Fd`; `Fd::INVALID` once closed.
    pub fn fd(&self) -> Fd {
        let handle = self.handle();
        if handle == INVALID_HANDLE_VALUE {
            return Fd::INVALID;
        }
        Fd::from_system(handle)
    }

    /// Closed by [`close_all_for_loop`](super::close_all_for_loop): every
    /// operation fails with `EBADF` from here on.
    pub fn is_closed(&self) -> bool {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        unsafe { (*self.raw()).flags.contains(Flags::DETACHED) }
    }

    /// `read_start` without a `read_stop`, EOF or error since.
    pub fn is_reading(&self) -> bool {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        let inner = unsafe { &*self.raw() };
        !inner.flags.contains(Flags::DETACHED) && inner.flags.contains(Flags::READING)
    }

    /// Reading, or writes not yet completed.
    pub fn is_active(&self) -> bool {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        let inner = unsafe { &*self.raw() };
        !inner.flags.contains(Flags::DETACHED)
            && (inner.flags.contains(Flags::READING) || inner.has_writes())
    }

    /// Let this pipe keep the loop alive while it reads (the default).
    /// Unfinished writes keep it alive either way.
    pub fn ref_(&self) {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        unsafe {
            (*self.raw()).flags.insert(Flags::REFD);
            Inner::update_keep_alive(self.raw());
        }
    }

    pub fn unref(&self) {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        unsafe {
            (*self.raw()).flags.remove(Flags::REFD);
            Inner::update_keep_alive(self.raw());
        }
    }

    /// Leave the caller's `Fd` open when the pipe closes. A duplicate made for
    /// a standard handle is still released.
    pub fn disown(&mut self) {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        unsafe {
            if !(*self.raw()).flags.contains(Flags::DUPLICATED) {
                (*self.raw()).close_fd = None;
            }
        }
    }

    /// The most the next reads ask of the kernel (at least one byte).
    pub fn set_read_size(&mut self, size: usize) {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        unsafe { (*self.raw()).read_size = size.clamp(1, u32::MAX as usize) };
    }

    /// Deliver what the pipe produces to `on_read(ctx, ..)`, always from the
    /// loop and never from inside this call. `ctx` must stay valid until
    /// `read_stop`, the `Eof`/`Err` event, or the `Pipe` is closed or dropped.
    pub fn read_start<T>(
        &mut self,
        ctx: *mut T,
        on_read: unsafe fn(*mut T, ReadEvent<'_>),
    ) -> sys::Result<()> {
        let this = self.raw();
        // SAFETY: `inner` is live while the owner's `Pipe` is; no reference
        // into it is held across the calls below.
        unsafe {
            if (*this).flags.contains(Flags::DETACHED) {
                return Err(sys::Error::from_code(E::EBADF, Tag::read));
            }
            (*this).reader = Some(ReadCallback::new(ctx, on_read));
            if (*this).flags.contains(Flags::READING) {
                return Ok(());
            }
            (*this).flags.insert(Flags::READING);
            (*this).flags.remove(Flags::READ_ENDED);
            Inner::update_keep_alive(this);
            Inner::pump_read(this).map_err(|err| {
                (*this).flags.remove(Flags::READING);
                Inner::update_keep_alive(this);
                sys::Error::from_win32(err, Tag::read)
            })
        }
    }

    /// Stop delivering. On a HANDLE Bun created, a read already handed to the
    /// kernel is left to finish and what it produces is kept for the next
    /// `read_start`. Any other HANDLE (inherited stdin) may be read by another
    /// process next, so what is out on it is a zero-byte wait, and that is
    /// taken back: nothing has left the pipe at that point, and cancelling a
    /// zero-byte read costs the peer's write nothing.
    pub fn read_stop(&mut self) {
        // SAFETY: `inner` is live while the owner's `Pipe` is; `read_op` is
        // owned by it while non-null.
        unsafe {
            let this = self.raw();
            (*this).flags.remove(Flags::READING);
            let read = (*this).read_op;
            if !read.is_null() && (*read).state == ReadState::InFlight {
                if let Some(reader) = &(*this).sync_reader {
                    (*read).stopped = true;
                    let taken_back = reader.disarm();
                    Inner::complete_taken_back(this, taken_back);
                } else if (*this).mode == Mode::Event && (*read).zero_wait {
                    (*read).stopped = true;
                    win::CancelIoEx((*this).handle, (&raw mut (*read).op).cast());
                }
            }
            Inner::update_keep_alive(this);
        }
    }

    /// Have the reads from here on land after `buffer`'s contents, in its
    /// spare capacity, and their [`ReadEvent::Data`] carry the whole of it: a
    /// reader that accumulates never copies a chunk. The allocation is the
    /// read's while the kernel has it; [`take_read_buffer`](Self::take_read_buffer)
    /// says how it comes back early. `Err(buffer)` when a read is out or its
    /// result is waiting to be delivered.
    pub fn lend_read_buffer(&mut self, buffer: Vec<u8>) -> Result<(), Vec<u8>> {
        // SAFETY: `inner` is live while the owner's `Pipe` is; `read_op` is
        // owned by it while non-null.
        unsafe {
            let this = self.raw();
            let op = (*this).read_op;
            if (*this).gone()
                || op.is_null()
                || !matches!((*op).state, ReadState::Idle | ReadState::Delivering)
            {
                return Err(buffer);
            }
            debug_assert!(!(*op).kept_taken);
            (*op).kept = buffer.len();
            (*op).buf = buffer;
            Ok(())
        }
    }

    /// What [`lend_read_buffer`](Self::lend_read_buffer) handed over, back. It
    /// is copied out while a read has the allocation; bytes of a read not yet
    /// delivered stay with the pipe.
    pub fn take_read_buffer(&mut self) -> Vec<u8> {
        // SAFETY: as `lend_read_buffer`. A read in flight only ever writes
        // past `kept`, within capacity the loop thread reserved, and nothing
        // but the loop thread touches the `Vec` itself.
        unsafe {
            let op = (*self.raw()).read_op;
            if op.is_null() {
                return Vec::new();
            }
            match (*op).state {
                ReadState::Idle | ReadState::Delivering => {
                    (*op).kept = 0;
                    core::mem::take(&mut (*op).buf)
                }
                ReadState::InFlight => {
                    // The read still lands after it; `outcome` drops the gap.
                    (*op).kept_taken = true;
                    (&(*op).buf)[..(*op).kept].to_vec()
                }
                ReadState::Held | ReadState::Replaying => {
                    let kept = core::mem::take(&mut (*op).kept);
                    let undelivered = (&(*op).buf)[kept..].to_vec();
                    let mut lent = core::mem::replace(&mut (*op).buf, undelivered);
                    lent.truncate(kept);
                    lent
                }
            }
        }
    }

    /// Write `data`, then call `on_write(ctx, result)` from the loop — also
    /// when the pipe is closed first (`ECANCELED`). `result` is the byte count,
    /// which is `data.len()` unless the write failed. `Err` means `on_write`
    /// will not run: the pipe is closed, or the kernel refused the write and
    /// `refusal` asked to hear of that here.
    ///
    /// # Safety
    /// `data` and `ctx` must stay valid until `on_write` runs. A `Pipe` that is
    /// dropped (rather than [`close`](Self::close)d) never calls back; give it
    /// the bytes first ([`adopt_write_buffer`](Self::adopt_write_buffer)). A
    /// lender that cannot do that uses [`write_owned`](Self::write_owned)
    /// where [`writes_outlive_cancel`](Self::writes_outlive_cancel) says so.
    pub unsafe fn write<T>(
        &mut self,
        data: &[u8],
        refusal: Refusal,
        ctx: *mut T,
        on_write: unsafe fn(*mut T, WriteResult),
    ) -> sys::Result<()> {
        // SAFETY: caller contract.
        unsafe {
            Inner::write(
                self.raw(),
                data.as_ptr(),
                data.len(),
                Vec::new(),
                Some(Callback::new(ctx, on_write)),
                refusal,
            )
        }
    }

    /// As [`write`](Self::write) with [`Refusal::Returned`], for bytes the
    /// operation should own: nothing needs to outlive the call, and `on_write`
    /// is optional.
    pub fn write_owned<T>(
        &mut self,
        data: Vec<u8>,
        ctx: *mut T,
        on_write: Option<unsafe fn(*mut T, WriteResult)>,
    ) -> sys::Result<()> {
        self.write_owned_with(data, Refusal::Returned, ctx, on_write)
    }

    /// [`write_owned`](Self::write_owned) with a say in `refusal`.
    pub fn write_owned_with<T>(
        &mut self,
        data: Vec<u8>,
        refusal: Refusal,
        ctx: *mut T,
        on_write: Option<unsafe fn(*mut T, WriteResult)>,
    ) -> sys::Result<()> {
        // SAFETY: the operation owns `data`, whose heap buffer does not move.
        unsafe {
            Inner::write(
                self.raw(),
                data.as_ptr(),
                data.len(),
                data,
                on_write.map(|f| Callback::new(ctx, f)),
                refusal,
            )
        }
    }

    /// Write `buffer[start..]`, which the operation owns for as long as it
    /// runs, without copying it. The buffer comes back from
    /// [`take_lent_buffer`](Self::take_lent_buffer) inside `on_write`, and in
    /// `Err` when the write is refused here. For a pipe whose
    /// [`writes_outlive_cancel`](Self::writes_outlive_cancel).
    pub fn write_lent<T>(
        &mut self,
        buffer: Vec<u8>,
        start: usize,
        refusal: Refusal,
        ctx: *mut T,
        on_write: unsafe fn(*mut T, WriteResult),
    ) -> Result<(), (sys::Error, Vec<u8>)> {
        let this = self.raw();
        debug_assert!(start <= buffer.len());
        // SAFETY: `inner` is live while the owner's `Pipe` is. The operation
        // owns `buffer`, whose heap buffer does not move.
        unsafe {
            (*this).lent_back = None;
            let result = Inner::write_with(
                this,
                buffer.as_ptr().add(start),
                buffer.len() - start,
                buffer,
                true,
                Some(Callback::new(ctx, on_write)),
                refusal,
            );
            result.map_err(|err| (err, (*this).lent_back.take().unwrap_or_default()))
        }
    }

    /// The buffer of the lent write whose `on_write` is running: empty when a
    /// helper thread that could not be stopped still has the bytes.
    pub fn take_lent_buffer(&mut self) -> Option<Vec<u8>> {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        unsafe { (*self.raw()).lent_back.take() }
    }

    /// Whether a write can still be reading its bytes after the pipe was
    /// dropped: a helper thread's blocking `WriteFile` cannot be recalled.
    pub fn writes_outlive_cancel(&self) -> bool {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        matches!(unsafe { (*self.raw()).mode }, Mode::Sync | Mode::Unknown)
    }

    /// Write all of `data` before returning, blocking the calling thread for
    /// as long as the reader takes. For a pipe whose owner writes no other
    /// way: nothing orders this against a [`write`](Self::write) still out.
    pub fn write_blocking(&mut self, data: &[u8]) -> sys::Result<usize> {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        unsafe { Inner::write_blocking(self.raw(), data) }
    }

    /// The process on the other end of a named pipe.
    /// Whether the pipe was created as a message-type pipe, where a
    /// zero-length write reaches the other end as a read of no bytes. On a
    /// byte-type pipe such a write is dropped.
    pub fn is_message_type(&self) -> bool {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        unsafe { Inner::is_message_type(self.raw()) }
    }

    /// Hear, once, when the other end has read everything written so far
    /// (`Ok`), or that it closed first (`Err`). Only for a HANDLE Bun created:
    /// the request would block the calling thread on any other, which gets
    /// `ENOTSUP`. Closing or dropping the pipe cancels it without a call.
    pub fn flush_peer<T>(
        &mut self,
        ctx: *mut T,
        on_flushed: unsafe fn(*mut T, sys::Result<()>),
    ) -> sys::Result<()> {
        let this = self.raw();
        // SAFETY: `inner` is live while the owner's `Pipe` is. The OVERLAPPED
        // lives in the op, which is freed only from its own completion.
        unsafe {
            if (*this).gone() {
                return Err(sys::Error::from_code(E::EBADF, Tag::fsync));
            }
            if (*this).mode != Mode::Owned {
                return Err(sys::Error::from_code(E::ENOTSUP, Tag::fsync));
            }
            if !(*this).flush_op.is_null() {
                return Err(sys::Error::from_code(E::EBUSY, Tag::fsync));
            }
            let op = bun_core::heap::into_raw(Box::new(FlushOp {
                op: Op::new(FlushOp::complete),
                pipe: this,
                callback: Callback::new(ctx, on_flushed),
            }));
            // The OVERLAPPED's first two fields are the IO_STATUS_BLOCK; its
            // address is what the port hands back.
            let overlapped = &raw mut (*op).op.overlapped;
            let status = NtFsControlFile(
                (*this).handle,
                ptr::null_mut(),
                ptr::null_mut(),
                overlapped.cast(),
                overlapped.cast(),
                FSCTL_PIPE_FLUSH,
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                0,
            );
            // A call that fails outright queues no packet.
            if status.0 >= 0xC000_0000 {
                drop(bun_core::heap::take(op));
                return Err(sys::Error::from_win32(
                    Win32Error::from_ntstatus(status),
                    Tag::fsync,
                ));
            }
            super::op_submitted((*this).link.loop_);
            (*this).pending += 1;
            (*this).flush_op = op;
            Ok(())
        }
    }

    /// Tell the other end of a message-type pipe that nothing more will be
    /// written, with the pipe left open: a zero-length message, which a
    /// reader sees as a read of no bytes. Readers that know the convention
    /// (.NET streams, go-winio, WCF) take it as the end of the stream. It has
    /// to follow a completed [`flush_peer`](Self::flush_peer): written behind
    /// unread bytes, a byte-mode reader gets it merged into them.
    pub fn write_end_marker<T>(
        &mut self,
        ctx: *mut T,
        on_write: unsafe fn(*mut T, WriteResult),
    ) -> sys::Result<()> {
        // SAFETY: a write of no bytes reads nothing through its pointer.
        unsafe {
            Inner::write(
                self.raw(),
                ptr::NonNull::<u8>::dangling().as_ptr(),
                0,
                Vec::new(),
                Some(Callback::new(ctx, on_write)),
                Refusal::Posted,
            )
        }
    }

    /// Whether a read has finished in the kernel and its packet is still on
    /// its way to the loop.
    pub fn read_awaits_delivery(&self) -> bool {
        const STATUS_PENDING: usize = 0x103;
        // SAFETY: `inner` is live while the owner's `Pipe` is; `read_op` is
        // owned by it while non-null.
        unsafe {
            let this = self.raw();
            let read = (*this).read_op;
            !read.is_null()
                && (*this).mode == Mode::Owned
                && (*read).state == ReadState::InFlight
                && (*read).op.overlapped.Internal != STATUS_PENDING
        }
    }

    pub fn peer_pid(&self) -> Option<u32> {
        let handle = self.handle();
        let mut pid: u32 = 0;
        // SAFETY: `pid` is a live local.
        unsafe {
            if win::GetNamedPipeClientProcessId(handle, &raw mut pid) == 0 {
                return None;
            }
            // A client end asking for "the client" gets itself.
            if pid == bun_sys::windows::GetCurrentProcessId()
                && win::GetNamedPipeServerProcessId(handle, &raw mut pid) == 0
            {
                return None;
            }
        }
        Some(pid)
    }

    /// Close. Writes that had not completed still call back, with `ECANCELED`
    /// (dropping the `Pipe` instead calls nobody back); reads report nothing.
    pub fn close(self) {
        let this = self.raw();
        core::mem::forget(self);
        // SAFETY: `this` is live until `Inner::close` decides otherwise.
        unsafe { Inner::close(this, true) };
    }

    /// `buffer` is kept until the pipe itself is freed: for an owner about to
    /// go away while a write that borrows `buffer` may still be in flight.
    pub fn adopt_write_buffer(&mut self, buffer: Vec<u8>) {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        unsafe { Inner::adopt_write_buffer(self.raw(), buffer) };
    }
}

impl Drop for Pipe {
    fn drop(&mut self) {
        // SAFETY: `inner` is live until `Inner::close` decides otherwise.
        unsafe { Inner::close(self.raw(), false) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Inner
// ──────────────────────────────────────────────────────────────────────────

fn read_error(err: Win32Error) -> sys::Error {
    // A server that disconnected its instance, as opposed to closing it, left
    // the conversation without an end: EPIPE, as libuv and Node report it.
    if err == Win32Error::NO_DATA || err == Win32Error::PIPE_NOT_CONNECTED {
        return sys::Error::from_code(E::EPIPE, Tag::read);
    }
    sys::Error::from_win32(err, Tag::read)
}

fn write_error(err: Win32Error) -> sys::Error {
    // A pipe whose reader is gone reports one of three codes depending on how
    // it went; all of them are EPIPE to a writer.
    if err == Win32Error::BROKEN_PIPE
        || err == Win32Error::NO_DATA
        || err == Win32Error::PIPE_NOT_CONNECTED
    {
        return sys::Error::from_code(E::EPIPE, Tag::write);
    }
    if err == Win32Error::OPERATION_ABORTED {
        return sys::Error::from_code(E::ECANCELED, Tag::write);
    }
    sys::Error::from_win32(err, Tag::write)
}

fn is_eof(err: Win32Error) -> bool {
    err == Win32Error::BROKEN_PIPE || err == Win32Error::HANDLE_EOF
}

/// How the operation behind a dequeued packet went: what `posted` says, else
/// what the kernel left in its OVERLAPPED.
fn completed(op: &Op, posted: Posted) -> (Win32Error, usize) {
    posted.unwrap_or_else(|| (win::status_to_win32(op.status()), op.bytes_transferred()))
}

impl Inner {
    fn has_writes(&self) -> bool {
        self.writes_in_flight > 0 || !self.write_head.is_null()
    }

    /// # Safety
    /// `this` is live.
    unsafe fn is_message_type(this: *mut Inner) -> bool {
        /// `FILE_PIPE_LOCAL_INFORMATION`, whose first field is the pipe's type.
        const FILE_PIPE_LOCAL_INFORMATION_CLASS: win::FILE_INFORMATION_CLASS =
            win::FILE_INFORMATION_CLASS(24);
        const FILE_PIPE_MESSAGE_TYPE: u32 = 1;
        // SAFETY: caller contract; the out-parameters are live locals of the
        // class's size (ten `ULONG`s).
        unsafe {
            if !(*this).flags.contains(Flags::TYPE_KNOWN) {
                let mut info = [0u32; 10];
                let mut iosb: win::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
                let status = win::NtQueryInformationFile(
                    (*this).handle,
                    &raw mut iosb,
                    info.as_mut_ptr().cast(),
                    size_of::<[u32; 10]>() as u32,
                    FILE_PIPE_LOCAL_INFORMATION_CLASS,
                );
                (*this).flags.insert(Flags::TYPE_KNOWN);
                if status == win::NTSTATUS::SUCCESS && info[0] == FILE_PIPE_MESSAGE_TYPE {
                    (*this).flags.insert(Flags::MESSAGE_TYPE);
                }
            }
            (*this).flags.contains(Flags::MESSAGE_TYPE)
        }
    }

    #[inline]
    fn gone(&self) -> bool {
        self.flags.intersects(Flags::CLOSING | Flags::DETACHED)
    }

    /// # Safety
    /// `this` is live. Must run on the loop's thread.
    unsafe fn update_keep_alive(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            let inner = &mut *this;
            if inner.flags.contains(Flags::DETACHED) {
                return;
            }
            let wanted = !inner.flags.contains(Flags::CLOSING)
                && ((inner.flags.contains(Flags::REFD) && inner.flags.contains(Flags::READING))
                    || inner.has_writes());
            if wanted == inner.flags.contains(Flags::KEEPING_ALIVE) {
                return;
            }
            inner.flags.set(Flags::KEEPING_ALIVE, wanted);
            if wanted {
                (*inner.link.loop_).add_active(1);
            } else {
                (*inner.link.loop_).sub_active(1);
            }
        }
    }

    /// # Safety
    /// `this` is live and not detached.
    unsafe fn port(this: *mut Inner) -> Option<Arc<Port>> {
        // SAFETY: caller contract.
        unsafe {
            if (*this).port.is_none() {
                (*this).port = super::port_for((*this).link.loop_);
            }
            (*this).port.clone()
        }
    }

    // ── reading ──────────────────────────────────────────────────────────

    /// Make progress towards the next `ReadEvent`.
    ///
    /// # Safety
    /// `this` is live, not closing, and `READING` is set.
    unsafe fn pump_read(this: *mut Inner) -> Result<(), Win32Error> {
        // SAFETY: caller contract; `read_op` is owned by `this` while non-null
        // and its `pipe` points back here.
        unsafe {
            if (*this).flags.contains(Flags::READ_ENDED) {
                return Ok(());
            }
            if (*this).read_op.is_null() {
                (*this).read_op = bun_core::heap::into_raw(Box::new(ReadOp {
                    op: Op::new(ReadOp::complete),
                    pipe: this,
                    state: ReadState::Idle,
                    outcome: Outcome::None,
                    buf: Vec::new(),
                    kept: 0,
                    kept_taken: false,
                    dest: ptr::null_mut(),
                    posted: None,
                    verdict: None,
                    lane: Lane::NONE,
                    max_len: 0,
                    stopped: false,
                    zero_wait: false,
                    finisher: AtomicU8::new(READ_REQUESTED),
                }));
            }
            let op = (*this).read_op;
            match (*op).state {
                ReadState::InFlight | ReadState::Replaying | ReadState::Delivering => Ok(()),
                ReadState::Held => {
                    // The owner hears of it from the loop, not from inside
                    // `read_start`.
                    super::complete_from_loop((*this).link.loop_, &raw mut (*op).op);
                    (*this).pending += 1;
                    (*op).state = ReadState::Replaying;
                    Ok(())
                }
                ReadState::Idle => Self::submit_read(this, op),
            }
        }
    }

    /// One overlapped `ReadFile` of `len` bytes to `op.dest` on an `Event`
    /// HANDLE. `Ok(true)`: it is pending and its completion arrives as a
    /// packet. `Ok(false)`: it is over already and `op.posted` says how.
    ///
    /// # Safety
    /// `this` is live in `Event` mode, `op` is its read with nothing out, and
    /// `op.dest` has room for `len` bytes.
    unsafe fn event_read(this: *mut Inner, op: *mut ReadOp, len: u32) -> Result<bool, Win32Error> {
        // SAFETY: caller contract. The buffer and OVERLAPPED handed to the
        // kernel live in `op`, which is freed only from its own completion.
        unsafe {
            let loop_ = (*this).link.loop_;
            (*op).lane.ensure(loop_)?;
            (*op).posted = None;
            (*op).op.overlapped.Internal = 0;
            (*op).op.overlapped.InternalHigh = 0;
            // Low bit set: the completion queues no packet on whatever port
            // the file object may be associated with.
            (*op).op.overlapped.hEvent = ((*op).lane.event as usize | 1) as HANDLE;
            let ok = win::ReadFile(
                (*this).handle,
                (*op).dest,
                len,
                ptr::null_mut(),
                (&raw mut (*op).op).cast(),
            );
            if ok == 0 && win::last_error() == Win32Error::IO_PENDING {
                if iocp::us_iocp_wait_start((*op).lane.wait, (*op).lane.event, &raw mut (*op).op)
                    != 0
                {
                    (*op).posted = Some((*op).lane.take_back((*this).handle, &raw mut (*op).op));
                    return Ok(false);
                }
                super::wait_submitted(loop_);
                return Ok(true);
            }
            (*op).posted = Some(if ok == 0 {
                (win::last_error(), 0)
            } else {
                // A call that returned TRUE filled the OVERLAPPED in.
                (Win32Error::SUCCESS, (*op).op.bytes_transferred())
            });
            Ok(false)
        }
    }

    /// A request taken back from the reader thread ends as one the thread
    /// answered as aborted would: from the loop, with the packet it was
    /// already counted for.
    ///
    /// # Safety
    /// `this` is live; `op` is null or its read, taken from the reader.
    unsafe fn complete_taken_back(this: *mut Inner, op: *mut ReadOp) {
        if op.is_null() {
            return;
        }
        // SAFETY: caller contract; the thread never looked inside `op`.
        unsafe {
            (*op).zero_wait = false;
            (*op).posted = Some((Win32Error::OPERATION_ABORTED, 0));
            // No longer the thread's: a close before the packet is dequeued
            // leaves the read to its packet.
            *(*op).finisher.get_mut() = READ_POSTED;
            iocp::us_iocp_op_ready((*this).link.loop_, &raw mut (*op).op);
        }
    }

    /// The reader thread found data for `op` and took none of it: ask for the
    /// bytes. Runs on the loop thread, so a loop that is blocked (in a
    /// synchronous spawn that shares the HANDLE, say) leaves them in the pipe.
    ///
    /// # Safety
    /// As [`Inner::event_fetch`]; `this` is a `Sync` pipe that has its reader.
    unsafe fn sync_fetch(
        this: *mut Inner,
        op: *mut ReadOp,
        loop_: *mut Loop,
    ) -> Result<bool, Win32Error> {
        // SAFETY: caller contract; the thread posted `op` and no longer has it.
        unsafe {
            let Some(reader) = &(*this).sync_reader else {
                return Err(Win32Error::INVALID_HANDLE);
            };
            reader.request(op);
            super::op_submitted(loop_);
            Ok(true)
        }
    }

    /// The zero-byte wait of an `Event` HANDLE completed: read what is there.
    /// Returns as [`event_read`](Self::event_read).
    ///
    /// # Safety
    /// As `event_read`.
    unsafe fn event_fetch(this: *mut Inner, op: *mut ReadOp) -> Result<bool, Win32Error> {
        // SAFETY: caller contract.
        unsafe {
            let mut available: u32 = 0;
            if win::PeekNamedPipe(
                (*this).handle,
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                &raw mut available,
                ptr::null_mut(),
            ) == 0
            {
                (*op).posted = Some((win::last_error(), 0));
                return Ok(false);
            }
            if available == 0 {
                // Another reader of the pipe got there first: wait again.
                (*op).zero_wait = true;
                return Self::event_read(this, op, 0);
            }
            Self::event_read(this, op, available.min((*op).max_len))
        }
    }

    /// # Safety
    /// `this` and its idle `op` are live; `this` is not closing.
    unsafe fn submit_read(this: *mut Inner, op: *mut ReadOp) -> Result<(), Win32Error> {
        // SAFETY: caller contract. The buffer and OVERLAPPED handed to the
        // kernel live in `op`, which is freed only from its own completion.
        unsafe {
            let loop_ = (*this).link.loop_;
            let want = (*this).read_size;
            let buf = &mut (*op).buf;
            buf.truncate((*op).kept);
            if buf.capacity() - buf.len() < want {
                if buf.is_empty() {
                    buf.reserve_exact(want);
                } else {
                    buf.reserve(want);
                }
            }
            (*op).dest = buf.as_mut_ptr().add(buf.len());
            let len = want as u32;
            (*op).max_len = len;
            (*op).outcome = Outcome::None;
            (*op).posted = None;
            (*op).op.overlapped.Internal = 0;
            (*op).op.overlapped.InternalHigh = 0;
            (*op).op.overlapped.Offset = 0;
            (*op).op.overlapped.OffsetHigh = 0;

            match (*this).mode {
                Mode::Owned => {
                    (*op).op.overlapped.hEvent = ptr::null_mut();
                    let ok = win::ReadFile(
                        (*this).handle,
                        (*op).dest,
                        len,
                        ptr::null_mut(),
                        (&raw mut (*op).op).cast(),
                    );
                    if ok != 0 || win::last_error() == Win32Error::IO_PENDING {
                        // A read that finished at once still queues its packet.
                        super::op_submitted(loop_);
                    } else {
                        (*op).posted = Some((win::last_error(), 0));
                        super::complete_from_loop(loop_, &raw mut (*op).op);
                    }
                }
                Mode::Event => {
                    // Wait with a zero-byte read and take the data when it
                    // completes: see `read_stop`.
                    (*op).zero_wait = true;
                    if !Self::event_read(this, op, 0)? {
                        super::complete_from_loop(loop_, &raw mut (*op).op);
                    }
                }
                Mode::Sync | Mode::Unknown => {
                    if (*this).sync_reader.is_none() {
                        let Some(port) = Self::port(this) else {
                            return Err(win::last_error());
                        };
                        let classify = (*this).mode == Mode::Unknown;
                        (*this).sync_reader =
                            Some(SyncReader::start((*this).handle, port, classify)?);
                    }
                    // Nothing leaves the pipe until this loop has seen that
                    // data is there and still wants it: see `complete`.
                    (*op).zero_wait = true;
                    if let Some(reader) = &(*this).sync_reader {
                        reader.request(op);
                    }
                    super::op_submitted(loop_);
                }
            }
            (*this).pending += 1;
            (*op).state = ReadState::InFlight;
            Ok(())
        }
    }

    // ── writing ──────────────────────────────────────────────────────────

    /// # Safety
    /// `this` is live. `data..data+len` stays valid until the callback runs,
    /// or points into `owned`.
    unsafe fn write(
        this: *mut Inner,
        data: *const u8,
        len: usize,
        owned: Vec<u8>,
        callback: Option<Callback<WriteResult>>,
        refusal: Refusal,
    ) -> sys::Result<()> {
        // SAFETY: caller contract.
        unsafe { Self::write_with(this, data, len, owned, false, callback, refusal) }
    }

    /// [`write`](Self::write); `lent`: `owned` goes back to the caller through
    /// `lent_back` when the write is over or refused.
    ///
    /// # Safety
    /// As [`write`](Self::write).
    unsafe fn write_with(
        this: *mut Inner,
        data: *const u8,
        len: usize,
        owned: Vec<u8>,
        lent: bool,
        callback: Option<Callback<WriteResult>>,
        refusal: Refusal,
    ) -> sys::Result<()> {
        // SAFETY: caller contract.
        unsafe {
            if (*this).gone() {
                if lent {
                    (*this).lent_back = Some(owned);
                }
                return Err(sys::Error::from_code(E::EBADF, Tag::write));
            }
            let mut op = core::mem::replace(&mut (*this).spare_write, ptr::null_mut());
            if op.is_null() {
                op = bun_core::heap::into_raw(Box::new(WriteOp {
                    op: Op::new(WriteOp::complete),
                    pipe: this,
                    next: ptr::null_mut(),
                    data: ptr::null(),
                    len: 0,
                    done: 0,
                    chunk: 0,
                    owned: Vec::new(),
                    lent: false,
                    callback: None,
                    posted: None,
                    error: None,
                    verdict: None,
                }));
            }
            (*op).data = data;
            (*op).len = len;
            (*op).done = 0;
            (*op).owned = owned;
            (*op).lent = lent;
            (*op).callback = callback;
            (*op).error = None;
            if (*this).write_tail.is_null() {
                (*this).write_head = op;
            } else {
                (*(*this).write_tail).next = op;
            }
            (*this).write_tail = op;
            let fresh = match refusal {
                Refusal::Returned => op,
                Refusal::Posted => ptr::null_mut(),
            };
            let refused = Self::pump_writes(this, fresh);
            Self::update_keep_alive(this);
            match refused {
                Some(err) => Err(write_error(err)),
                None => Ok(()),
            }
        }
    }

    /// Hand queued writes to the kernel: all of them on a HANDLE Bun owns
    /// (the kernel keeps them in order), one at a time otherwise.
    ///
    /// `fresh` is the write a [`Refusal::Returned`] caller queued just now, or
    /// null. When the kernel refuses that one at once, it is dropped without
    /// its callback and the refusal is returned: the caller of `write` hears
    /// of it before it can close the pipe. Any other write that cannot start
    /// reports through the port: its `write` call returned long ago, or asked
    /// for that.
    ///
    /// # Safety
    /// `this` is live and not closing.
    unsafe fn pump_writes(this: *mut Inner, fresh: *mut WriteOp) -> Option<Win32Error> {
        // SAFETY: caller contract; queued ops are owned by `this`.
        unsafe {
            loop {
                let op = (*this).write_head;
                if op.is_null()
                    || !(*this).chunked_write.is_null()
                    || ((*this).mode != Mode::Owned && (*this).writes_in_flight > 0)
                {
                    return None;
                }
                (*this).write_head = (*op).next;
                if (*this).write_head.is_null() {
                    (*this).write_tail = ptr::null_mut();
                }
                (*op).next = ptr::null_mut();
                (*this).writes_in_flight += 1;
                (*this).pending += 1;
                if (*op).len - (*op).done > MAX_WRITE_CHUNK {
                    (*this).chunked_write = op;
                }
                match Self::start_write(this, op) {
                    None => {}
                    Some((err, _)) if op == fresh && err != Win32Error::SUCCESS => {
                        if (*this).chunked_write == op {
                            (*this).chunked_write = ptr::null_mut();
                        }
                        (*this).writes_in_flight -= 1;
                        (*this).pending -= 1;
                        (*this).lent_back = WriteOp::reclaim(op);
                        Self::recycle_write(this, op);
                        return Some(err);
                    }
                    Some(finished) => Self::post_finished_write(this, op, finished),
                }
            }
        }
    }

    /// `op` is over: drop what it carried and keep the allocation for the
    /// next write, unless one is kept already or there will be none.
    ///
    /// # Safety
    /// `this` is live; `op` is its write, referenced by nothing else.
    unsafe fn recycle_write(this: *mut Inner, op: *mut WriteOp) {
        // SAFETY: caller contract.
        unsafe {
            if (*this).gone() || !(*this).spare_write.is_null() {
                drop(bun_core::heap::take(op));
                return;
            }
            (*op).owned = Vec::new();
            (*op).lent = false;
            (*op).callback = None;
            (*this).spare_write = op;
        }
    }

    /// A helper thread found out what this `Unknown` HANDLE is.
    ///
    /// # Safety
    /// `this` is live. Must run on the loop's thread.
    unsafe fn classified(this: *mut Inner, kind: Kind) {
        // SAFETY: caller contract.
        unsafe {
            if (*this).mode != Mode::Unknown {
                return;
            }
            let (mode, std_mode) = match kind {
                Kind::Synchronous => (Mode::Sync, STD_MODE_SYNC),
                Kind::Overlapped => (Mode::Event, STD_MODE_EVENT),
                Kind::Unusable(_) => return,
            };
            (*this).mode = mode;
            if let Some(slot) = (*this).std_slot {
                slot.store(std_mode, Ordering::Release);
            }
            bun_core::scoped_log!(WinPipe, "classified {:p} {:?}", (*this).handle, mode);
        }
    }

    /// Start (or continue) `op` and, when no packet of the kernel's will
    /// announce how it went, queue one that does.
    ///
    /// # Safety
    /// As [`start_write`](Self::start_write).
    unsafe fn submit_write(this: *mut Inner, op: *mut WriteOp) {
        // SAFETY: caller contract.
        unsafe {
            if let Some(finished) = Self::start_write(this, op) {
                Self::post_finished_write(this, op, finished);
            }
        }
    }

    /// # Safety
    /// `this` and `op` are live; `op` is counted in `writes_in_flight` and
    /// `pending`, and no packet for it is on its way.
    unsafe fn post_finished_write(
        this: *mut Inner,
        op: *mut WriteOp,
        finished: (Win32Error, usize),
    ) {
        // SAFETY: caller contract.
        unsafe {
            (*op).posted = Some(finished);
            super::complete_from_loop((*this).link.loop_, &raw mut (*op).op);
        }
    }

    /// Hand `op`'s next chunk to the kernel. `None`: a packet will announce
    /// how it went. Otherwise it is over already, with this result and count.
    ///
    /// # Safety
    /// `this` and `op` are live; `op` is counted in `writes_in_flight` and
    /// `pending`.
    unsafe fn start_write(this: *mut Inner, op: *mut WriteOp) -> Option<(Win32Error, usize)> {
        // SAFETY: caller contract. The OVERLAPPED lives in `op`, freed only
        // from its own completion.
        unsafe {
            let loop_ = (*this).link.loop_;
            let remaining = (*op).len - (*op).done;
            let chunk = remaining.min(MAX_WRITE_CHUNK) as u32;
            (*op).chunk = chunk;
            (*op).posted = None;
            (*op).op.overlapped.Internal = 0;
            (*op).op.overlapped.InternalHigh = 0;
            (*op).op.overlapped.Offset = 0;
            (*op).op.overlapped.OffsetHigh = 0;
            let data = (*op).data.add((*op).done);

            // Every arm returns `None` once a packet is on its way.
            let finished: (Win32Error, usize) = match (*this).mode {
                Mode::Owned => {
                    (*op).op.overlapped.hEvent = ptr::null_mut();
                    let ok = win::WriteFile(
                        (*this).handle,
                        data,
                        chunk,
                        ptr::null_mut(),
                        (&raw mut (*op).op).cast(),
                    );
                    if ok != 0 || win::last_error() == Win32Error::IO_PENDING {
                        super::op_submitted(loop_);
                        return None;
                    }
                    (win::last_error(), 0)
                }
                Mode::Event => match (*this).write_lane.ensure(loop_) {
                    Err(err) => (err, 0),
                    Ok(()) => {
                        let event = (*this).write_lane.event;
                        (*op).op.overlapped.hEvent = (event as usize | 1) as HANDLE;
                        let ok = win::WriteFile(
                            (*this).handle,
                            data,
                            chunk,
                            ptr::null_mut(),
                            (&raw mut (*op).op).cast(),
                        );
                        if ok == 0 && win::last_error() == Win32Error::IO_PENDING {
                            if iocp::us_iocp_wait_start(
                                (*this).write_lane.wait,
                                event,
                                &raw mut (*op).op,
                            ) == 0
                            {
                                super::wait_submitted(loop_);
                                (*this).event_write = op;
                                return None;
                            }
                            (*this)
                                .write_lane
                                .take_back((*this).handle, &raw mut (*op).op)
                        } else if ok == 0 {
                            (win::last_error(), 0)
                        } else {
                            // A call that returned TRUE filled the OVERLAPPED in.
                            (Win32Error::SUCCESS, (*op).op.bytes_transferred())
                        }
                    }
                },
                Mode::Sync | Mode::Unknown => match SyncWrite::start(this, op, chunk) {
                    Ok(()) => {
                        super::op_submitted(loop_);
                        return None;
                    }
                    Err(err) => (err, 0),
                },
            };
            Some(finished)
        }
    }

    /// # Safety
    /// `this` is live.
    unsafe fn write_blocking(this: *mut Inner, data: &[u8]) -> sys::Result<usize> {
        // SAFETY: caller contract. The OVERLAPPED may live on this stack frame
        // because the frame does not return before the operation completes.
        unsafe {
            if (*this).gone() {
                return Err(sys::Error::from_code(E::EBADF, Tag::write));
            }
            debug_assert!(!(*this).has_writes());
            if (*this).mode == Mode::Unknown {
                // This call may block for as long as the write itself would.
                let kind = classify((*this).handle);
                Self::classified(this, kind);
                if let Kind::Unusable(errno) = kind {
                    return Err(sys::Error::from_code(errno, Tag::write));
                }
            }
            if (*this).blocking_event.is_null() {
                let event = win::CreateEventW(ptr::null_mut(), 1, 0, ptr::null());
                if event.is_null() {
                    return Err(write_error(win::last_error()));
                }
                (*this).blocking_event = event;
            }
            let mut written = 0usize;
            while written < data.len() {
                let chunk = (data.len() - written).min(MAX_WRITE_CHUNK) as u32;
                // Right for either kind of HANDLE, whichever this is: a
                // synchronous one returns when the write is over, an
                // overlapped one may pend and is waited for.
                let mut overlapped: win::OVERLAPPED = bun_core::ffi::zeroed();
                // Low bit set: no packet for this one, the event is all.
                overlapped.hEvent = ((*this).blocking_event as usize | 1) as HANDLE;
                let ok = win::WriteFile(
                    (*this).handle,
                    data.as_ptr().add(written),
                    chunk,
                    ptr::null_mut(),
                    (&raw mut overlapped).cast(),
                );
                if ok == 0 {
                    if win::last_error() != Win32Error::IO_PENDING {
                        return Err(write_error(win::last_error()));
                    }
                    bun_sys::windows::kernel32::WaitForSingleObject(
                        (*this).blocking_event,
                        bun_sys::windows::INFINITE,
                    );
                }
                let status = win::status_to_win32(overlapped.Internal as i32);
                if status != Win32Error::SUCCESS {
                    return Err(write_error(status));
                }
                let n = overlapped.InternalHigh;
                if n == 0 {
                    break;
                }
                written += n;
            }
            Ok(written)
        }
    }

    /// # Safety
    /// `this` is live.
    unsafe fn adopt_write_buffer(this: *mut Inner, buffer: Vec<u8>) {
        // SAFETY: caller contract. The pipe is freed only after every
        // operation has been collected, which is as long as any of them can
        // look at `buffer`.
        unsafe { (*this).adopted.push(buffer) };
    }

    // ── closing ──────────────────────────────────────────────────────────

    /// The owner is done with the pipe.
    ///
    /// # Safety
    /// `this` is live; the owner's `Pipe` is consumed or being dropped.
    unsafe fn close(this: *mut Inner, report_writes: bool) {
        // SAFETY: caller contract.
        unsafe {
            (*this).flags.insert(Flags::OWNER_GONE);
            (*this).reader = None;
            if !report_writes {
                (*this).flags.insert(Flags::SILENT);
            }
            if !(*this).gone() {
                Self::cancel_everything(this);
                (*this).flags.insert(Flags::CLOSING);
                (*this).flags.remove(Flags::READING);
                if (*this).mode == Mode::Owned {
                    // A server-side instance holds the pipe's name until its
                    // HANDLE is closed, and a server may listen on that name
                    // again as soon as its connections report `close`. What
                    // was cancelled above still completes through the port.
                    Self::release_handle(this);
                }
                Self::update_keep_alive(this);
            }
            Self::maybe_finish(this);
        }
    }

    /// [`Link::shut`]: the loop is about to be freed.
    unsafe fn shut(link: *mut Link) {
        let this = link.cast::<Inner>();
        // SAFETY: `link` is the first field of a listed (live) `Inner`.
        unsafe {
            if !(*this).gone() {
                Self::cancel_everything(this);
                (*this).flags.remove(Flags::READING);
            }
            (*this).flags.insert(Flags::CLOSING | Flags::SILENT);
            (*this).reader = None;
            Self::update_keep_alive(this);
            (*this).flags.insert(Flags::DETACHED);
            Link::remove(link);
            Self::maybe_finish(this);
        }
    }

    /// Ask every in-flight operation to complete and fail every queued one.
    ///
    /// # Safety
    /// `this` is live and neither closing nor detached.
    unsafe fn cancel_everything(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            let loop_ = (*this).link.loop_;
            let handle = (*this).handle;

            // Before an idle read is freed below: the thread answers the one it
            // was given (as aborted) and touches no other.
            if let Some(reader) = (*this).sync_reader.take() {
                let taken_back = reader.stop();
                Inner::complete_taken_back(this, taken_back);
            }
            let read = (*this).read_op;
            if !read.is_null() {
                match (*read).state {
                    ReadState::InFlight => match (*this).mode {
                        Mode::Owned | Mode::Event => {
                            win::CancelIoEx(handle, (&raw mut (*read).op).cast());
                        }
                        // The reader thread has it, and may be queued behind
                        // another reader of the pipe for as long as that one
                        // likes. Unless a packet for it is on its way already,
                        // the read is the thread's to free from here on.
                        Mode::Sync | Mode::Unknown
                            if (*read)
                                .finisher
                                .compare_exchange(
                                    READ_REQUESTED,
                                    READ_ORPHANED,
                                    Ordering::SeqCst,
                                    Ordering::SeqCst,
                                )
                                .is_ok() =>
                        {
                            (*this).read_op = ptr::null_mut();
                            (*this).pending -= 1;
                            super::settle((*this).link.loop_);
                        }
                        Mode::Sync | Mode::Unknown => {}
                    },
                    ReadState::Idle | ReadState::Held => {
                        (*this).read_op = ptr::null_mut();
                        ReadOp::destroy(read);
                    }
                    ReadState::Replaying | ReadState::Delivering => {}
                }
            }

            if !(*this).flush_op.is_null() {
                win::CancelIoEx(handle, (&raw mut (*(*this).flush_op).op).cast());
            }
            if (*this).mode == Mode::Owned && (*this).writes_in_flight > 0 {
                // Everything this process has out on a HANDLE it owns is this
                // pipe's, and the read was dealt with above.
                win::CancelIoEx(handle, ptr::null_mut());
            } else if !(*this).event_write.is_null() {
                // Somebody else's HANDLE may carry other I/O from this process
                // (stdout written to directly): cancel this write only.
                win::CancelIoEx(handle, (&raw mut (*(*this).event_write).op).cast());
            } else if let Some(write) = (*this).sync_write.take()
                && let Some(op) = write.cancel()
            {
                // The thread has the write and cannot be made to give it up.
                // It ends here as cancelled, with the packet it was counted for.
                (*op).posted = Some((Win32Error::OPERATION_ABORTED, 0));
                iocp::us_iocp_op_ready((*this).link.loop_, &raw mut (*op).op);
            }
            // Queued writes never reached the kernel; they complete as
            // cancelled, in order, from the loop.
            let mut op = core::mem::replace(&mut (*this).write_head, ptr::null_mut());
            (*this).write_tail = ptr::null_mut();
            while !op.is_null() {
                let next = (*op).next;
                (*op).next = ptr::null_mut();
                (*op).posted = Some((Win32Error::OPERATION_ABORTED, 0));
                (*this).writes_in_flight += 1;
                (*this).pending += 1;
                super::complete_from_loop(loop_, &raw mut (*op).op);
                op = next;
            }
        }
    }

    /// # Safety
    /// `this` is live and no operation will use the HANDLE again.
    unsafe fn release_handle(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            if let Some(fd) = (*this).close_fd.take() {
                fd.close();
            }
            (*this).handle = INVALID_HANDLE_VALUE;
        }
    }

    /// Release the HANDLE and the allocation once nothing can refer to them.
    ///
    /// # Safety
    /// `this` is live.
    unsafe fn maybe_finish(this: *mut Inner) {
        // SAFETY: caller contract.
        unsafe {
            if !(*this).flags.contains(Flags::CLOSING) || (*this).pending > 0 || (*this).pins > 0 {
                return;
            }
            let detached = (*this).flags.contains(Flags::DETACHED);
            Self::release_handle(this);
            if !(*this).flags.contains(Flags::OWNER_GONE) {
                return;
            }
            if !detached {
                Self::update_keep_alive(this);
                Link::remove(this.cast());
            }
            debug_assert!((*this).sync_reader.is_none());
            if !(*this).spare_write.is_null() {
                drop(bun_core::heap::take((*this).spare_write));
            }
            (*this).write_lane.release();
            if !(*this).blocking_event.is_null() {
                win::CloseHandle((*this).blocking_event);
            }
            drop(bun_core::heap::take(this));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Completions
// ──────────────────────────────────────────────────────────────────────────

impl ReadOp {
    /// # Safety
    /// `op` is not referenced by the kernel, a helper thread or a queued packet.
    unsafe fn destroy(op: *mut ReadOp) {
        // SAFETY: caller contract.
        unsafe {
            (*op).lane.release();
            drop(bun_core::heap::take(op));
        }
    }

    unsafe extern "C" fn complete(loop_: *mut Loop, op: *mut Op, _entry: *mut OverlappedEntry) {
        let this = op.cast::<ReadOp>();
        // SAFETY: `op` is the first field of the `ReadOp` this packet was
        // submitted for; the packet is what kept it allocated.
        unsafe {
            super::op_dequeued(loop_);
            let pipe = (*this).pipe;
            (*pipe).pending -= 1;
            if (*pipe).gone() {
                (*pipe).read_op = ptr::null_mut();
                Self::destroy(this);
                Inner::maybe_finish(pipe);
                return;
            }

            let verdict = (*this).verdict.take();
            if let Some(kind) = verdict {
                Inner::classified(pipe, kind);
            }
            if let Some(kind) = verdict
                && kind != Kind::Synchronous
            {
                // The thread did no I/O for this request and has left.
                if let Some(reader) = (*pipe).sync_reader.take() {
                    let taken_back = reader.stop();
                    debug_assert!(taken_back.is_null());
                }
                (*this).zero_wait = false;
                (*this).stopped = false;
                (*this).posted = None;
                Self::drop_taken(this);
                match kind {
                    Kind::Unusable(errno) => {
                        (*this).outcome = Outcome::Err(sys::Error::from_code(errno, Tag::read));
                    }
                    _ => {
                        (*this).state = ReadState::Idle;
                        Self::resume(pipe, this);
                        return;
                    }
                }
            } else if (*this).state == ReadState::InFlight {
                if core::mem::take(&mut (*this).zero_wait)
                    && Self::result(this).0 == Win32Error::SUCCESS
                {
                    if !(*pipe).flags.contains(Flags::READING) {
                        // Stopped since: what arrived stays in the pipe.
                        (*this).stopped = false;
                        Self::drop_taken(this);
                        (*this).state = ReadState::Idle;
                        return;
                    }
                    let fetch = if (*pipe).sync_reader.is_some() {
                        Inner::sync_fetch(pipe, this, loop_)
                    } else {
                        Inner::event_fetch(pipe, this)
                    };
                    match fetch {
                        Ok(true) => {
                            (*pipe).pending += 1;
                            return;
                        }
                        Ok(false) => {}
                        Err(err) => (*this).posted = Some((err, 0)),
                    }
                }
                let aborted = Self::result(this).0 == Win32Error::OPERATION_ABORTED;
                (*this).outcome = Self::outcome(this);
                if core::mem::take(&mut (*this).stopped) && aborted {
                    // `read_stop` interrupted the wait: nothing was read.
                    (*this).outcome = Outcome::None;
                    if !(*pipe).flags.contains(Flags::READING) {
                        (*this).state = ReadState::Idle;
                        return;
                    }
                }
            }
            if !(*pipe).flags.contains(Flags::READING) {
                (*this).state = ReadState::Held;
                return;
            }
            let Some(reader) = (*pipe).reader else {
                (*this).state = ReadState::Held;
                return;
            };

            (*this).state = ReadState::Delivering;
            (*pipe).pins += 1;
            match core::mem::replace(&mut (*this).outcome, Outcome::None) {
                Outcome::None => {}
                Outcome::Data if (*this).buf.len() == (*this).kept => {}
                Outcome::Data => {
                    // Before the call, which may lend the next one.
                    (*this).kept = 0;
                    reader.invoke(ReadEvent::Data(&mut (*this).buf));
                }
                Outcome::Eof => {
                    (*pipe).flags.remove(Flags::READING);
                    (*pipe).flags.insert(Flags::READ_ENDED);
                    reader.invoke(ReadEvent::Eof);
                }
                Outcome::EndOfWrite => {
                    (*pipe).flags.remove(Flags::READING);
                    (*pipe).flags.insert(Flags::READ_ENDED);
                    reader.invoke(ReadEvent::EndOfWrite);
                }
                Outcome::Err(err) => {
                    (*pipe).flags.remove(Flags::READING);
                    (*pipe).flags.insert(Flags::READ_ENDED);
                    reader.invoke(ReadEvent::Err(err));
                }
            }
            (*pipe).pins -= 1;
            (*this).state = ReadState::Idle;

            if (*pipe).gone() {
                (*pipe).read_op = ptr::null_mut();
                Self::destroy(this);
                Inner::maybe_finish(pipe);
                return;
            }
            Inner::update_keep_alive(pipe);
            Self::resume(pipe, this);
        }
    }

    /// Read on, if the owner still wants to.
    ///
    /// # Safety
    /// `this` is `pipe`'s idle read; `pipe` is live and not closing.
    unsafe fn resume(pipe: *mut Inner, this: *mut ReadOp) {
        // SAFETY: caller contract.
        unsafe {
            if (*pipe).flags.contains(Flags::READING)
                && let Err(err) = Inner::pump_read(pipe)
            {
                (*this).outcome = Outcome::Err(sys::Error::from_win32(err, Tag::read));
                (*this).state = ReadState::Held;
                let _ = Inner::pump_read(pipe);
            }
        }
    }

    /// Let go of the lent bytes that [`Pipe::take_read_buffer`] copied out
    /// from under the read: every way out of `InFlight` that keeps the buffer
    /// comes through here.
    ///
    /// # Safety
    /// `this` just completed: only the loop thread refers to `buf`.
    unsafe fn drop_taken(this: *mut ReadOp) {
        // SAFETY: caller contract.
        unsafe {
            if core::mem::take(&mut (*this).kept_taken) {
                let kept = core::mem::take(&mut (*this).kept);
                (*this).buf.drain(..kept);
            }
        }
    }

    /// How the operation whose packet was just dequeued went.
    ///
    /// # Safety
    /// `this` just completed.
    unsafe fn result(this: *mut ReadOp) -> (Win32Error, usize) {
        // SAFETY: caller contract.
        unsafe { completed(&(*this).op, (*this).posted) }
    }

    /// # Safety
    /// `this` just completed; `dest` holds what the kernel wrote.
    unsafe fn outcome(this: *mut ReadOp) -> Outcome {
        // SAFETY: caller contract. The kernel initialized `bytes` bytes of the
        // buffer's spare capacity, which `submit_read` reserved.
        unsafe {
            let (err, bytes) = Self::result(this);
            (*this).posted = None;
            let buf = &mut (*this).buf;
            if err == Win32Error::SUCCESS {
                debug_assert!(bytes <= buf.capacity() - buf.len());
                buf.set_len(buf.len() + bytes.min(buf.capacity() - buf.len()));
            }
            Self::drop_taken(this);
            if err == Win32Error::SUCCESS {
                // A read that asked for bytes and completed with none took a
                // zero-length message, which only a message-type pipe delivers.
                let pipe = (*this).pipe;
                if bytes == 0 && (*pipe).mode == Mode::Owned && Inner::is_message_type(pipe) {
                    return Outcome::EndOfWrite;
                }
                return Outcome::Data;
            }
            if is_eof(err) {
                return Outcome::Eof;
            }
            Outcome::Err(read_error(err))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// The reader thread of a synchronous HANDLE
// ──────────────────────────────────────────────────────────────────────────

/// What the loop and the reader thread of a `Sync` pipe share.
struct SyncShared {
    /// The thread's own duplicate of the pipe HANDLE, so the pipe's can be
    /// closed without waiting for the thread to notice `shutdown`.
    handle: HANDLE,
    port: Arc<Port>,
    /// Auto-reset; set after a change the thread may be parked on.
    wake: HANDLE,
    lock: bun_threading::Mutex,
    /// The thread is inside its cancellable zero-byte read.
    waiting: AtomicBool,
    /// The owner wants data: the thread may wait for it and take it.
    armed: AtomicBool,
    shutdown: AtomicBool,
    /// The read the loop is waiting for. The loop stores one only while this
    /// is null. Whoever swaps it out has it: the thread, to answer it, or the
    /// loop, to take it back unanswered. The thread looks inside only once it
    /// has taken it.
    request: AtomicPtr<ReadOp>,
    /// What `request` asks for: to hear that the pipe is readable (nothing is
    /// taken, and the request's memory is not needed), or the bytes.
    zero_wait: AtomicBool,
    /// The pipe is `Unknown`: [`classify`] `handle` before anything else.
    classify: bool,
    /// The thread's: what `classify` found, until an answer has carried it.
    verdict: Cell<Option<Kind>>,
}

// SAFETY: the HANDLEs are used from the thread that the field docs name, the
// rest is atomics, and a `ReadOp` behind `request` is the thread's alone.
unsafe impl Send for SyncShared {}
// SAFETY: as above.
unsafe impl Sync for SyncShared {}

impl Drop for SyncShared {
    fn drop(&mut self) {
        // SAFETY: both were created in `SyncReader::start` and nothing uses
        // them once the loop's and the thread's references are gone.
        unsafe {
            win::CloseHandle(self.handle);
            win::CloseHandle(self.wake);
        }
    }
}

/// The loop's side of the one thread that reads a `Sync` pipe for as long as
/// the pipe is open.
///
/// A request is answered in two steps. The thread waits in a zero-byte read,
/// which consumes nothing and can be interrupted without the peer losing
/// anything, and reports that the pipe is readable. The loop asks again, and
/// the thread takes what `PeekNamedPipe` reports. The bytes leave the pipe only
/// after the loop thread has asked for them with them waiting, as with a
/// readiness poll: while it is blocked, or once its owner has stopped reading,
/// they stay for whoever else reads the HANDLE. `disarm` stops anything more
/// being taken.
///
/// For an `Unknown` pipe the thread classifies the HANDLE first and its first
/// answer carries the verdict. Unless that is `Synchronous`, the answer is all
/// it does.
struct SyncReader {
    shared: Arc<SyncShared>,
    /// For `CancelSynchronousIo`.
    thread: HANDLE,
}

impl SyncReader {
    fn start(pipe: HANDLE, port: Arc<Port>, classify: bool) -> Result<SyncReader, Win32Error> {
        use std::os::windows::io::IntoRawHandle;
        let mut handle: HANDLE = ptr::null_mut();
        // SAFETY: plain Win32 calls; `pipe` is the caller's open HANDLE.
        let wake = unsafe {
            if win::DuplicateHandle(
                win::GetCurrentProcess(),
                pipe,
                win::GetCurrentProcess(),
                &raw mut handle,
                0,
                0,
                win::DUPLICATE_SAME_ACCESS,
            ) == 0
            {
                return Err(win::last_error());
            }
            let wake = win::CreateEventW(ptr::null_mut(), 0, 0, ptr::null());
            if wake.is_null() {
                let err = win::last_error();
                win::CloseHandle(handle);
                return Err(err);
            }
            wake
        };
        let shared = Arc::new(SyncShared {
            handle,
            port,
            wake,
            lock: bun_threading::Mutex::new(),
            waiting: AtomicBool::new(false),
            armed: AtomicBool::new(false),
            shutdown: AtomicBool::new(false),
            request: AtomicPtr::new(ptr::null_mut()),
            zero_wait: AtomicBool::new(false),
            classify,
            verdict: Cell::new(None),
        });
        let for_thread = shared.clone();
        match std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || for_thread.run())
        {
            Ok(join) => Ok(SyncReader {
                shared,
                thread: join.into_raw_handle().cast(),
            }),
            Err(err) => Err(err
                .raw_os_error()
                .map_or(Win32Error::NOT_ENOUGH_MEMORY, |code| {
                    Win32Error::from_u32(code as u32)
                })),
        }
    }

    /// # Safety
    /// `op` stays allocated until the packet the thread posts for it is
    /// dequeued, and no request is outstanding.
    unsafe fn request(&self, op: *mut ReadOp) {
        debug_assert!(self.shared.request.load(Ordering::Relaxed).is_null());
        // SAFETY: caller contract; `op` is the loop's until it is stored.
        let zero_wait = unsafe {
            *(*op).finisher.get_mut() = READ_REQUESTED;
            (*op).zero_wait
        };
        self.shared.zero_wait.store(zero_wait, Ordering::Release);
        self.shared.armed.store(true, Ordering::Release);
        self.shared.request.store(op, Ordering::Release);
        // SAFETY: `wake` is open while `shared` is.
        unsafe { win::SetEvent(self.shared.wake) };
    }

    /// Nothing more leaves the pipe until the next `request`. Returns the
    /// request when the thread had not taken it: it is the caller's again,
    /// unanswered. Null: none was out, or the thread has it and answers it
    /// with what it read.
    #[must_use]
    fn disarm(&self) -> *mut ReadOp {
        self.take_back()
    }

    /// As `disarm`, and the thread exits.
    #[must_use]
    fn stop(self) -> *mut ReadOp {
        self.shared.shutdown.store(true, Ordering::Release);
        let op = self.take_back();
        // SAFETY: both HANDLEs are open; `thread` is this struct's to close.
        unsafe {
            win::SetEvent(self.shared.wake);
            win::CloseHandle(self.thread);
        }
        op
    }

    /// Never waits for the thread. A synchronous HANDLE serves one call at a
    /// time, whichever process makes it, and a call queued behind another
    /// cannot be cancelled: there is nothing to wait for that is sure to come.
    fn take_back(&self) -> *mut ReadOp {
        self.shared.lock.lock();
        self.shared.armed.store(false, Ordering::Release);
        let op = self.shared.request.swap(ptr::null_mut(), Ordering::AcqRel);
        // The thread leaves `waiting` only through this lock, so the cancel
        // lands on its zero-byte read or on nothing. It lands on nothing when
        // the thread is not inside the call yet, or is queued behind another
        // reader of the pipe: the thread then stays in a read that takes
        // nothing, and looks at `armed` and `shutdown` when it returns.
        if self.shared.waiting.load(Ordering::Acquire) {
            // SAFETY: `thread` is this struct's open thread HANDLE.
            unsafe { win::CancelSynchronousIo(self.thread) };
        }
        self.shared.lock.unlock();
        op
    }
}

impl SyncShared {
    fn run(&self) {
        if self.classify {
            let kind = classify(self.handle);
            self.verdict.set(Some(kind));
            if kind != Kind::Synchronous {
                while !self.shutdown.load(Ordering::Acquire)
                    && self.request.load(Ordering::Acquire).is_null()
                {
                    self.park();
                }
                self.abort_request();
                return;
            }
        }
        while !self.shutdown.load(Ordering::Acquire) {
            let op = self.request.load(Ordering::Acquire);
            if !self.armed.load(Ordering::Acquire) {
                if op.is_null() {
                    self.park();
                } else {
                    self.abort_request();
                }
                continue;
            }
            if op.is_null() {
                self.park();
                continue;
            }
            if self.zero_wait.load(Ordering::Acquire) {
                match self.wait_for_data() {
                    Some(Win32Error::SUCCESS) => self.announce(),
                    Some(err) => self.finish_request(err, 0),
                    None => {}
                }
                continue;
            }
            // The bytes land in the request's buffer: it is taken first, and
            // the loop cannot take it back from here on.
            let op = self.request.swap(ptr::null_mut(), Ordering::AcqRel);
            if op.is_null() {
                continue;
            }
            // SAFETY: `op` was taken from `request`: it is this thread's until
            // it is posted or stored again.
            unsafe {
                match self.read((*op).dest, (*op).max_len) {
                    Some((err, bytes)) => {
                        (*op).zero_wait = false;
                        self.answer(op, err, bytes);
                    }
                    // Nothing there: another reader of the pipe took it.
                    None => self.wait_again(op),
                }
            }
        }
        self.abort_request();
    }

    /// Turn the data request `op`, which found the pipe empty, back into a
    /// wait for it to be readable; or answer it as aborted if the loop has
    /// stopped reading since.
    ///
    /// # Safety
    /// `op` was taken from `request`.
    unsafe fn wait_again(&self, op: *mut ReadOp) {
        // Under `lock`, as `SyncReader::take_back` is: either that finds the
        // request stored again, or this finds `armed` cleared.
        self.lock.lock();
        let go = self.armed.load(Ordering::Acquire) && !self.shutdown.load(Ordering::Acquire);
        if go {
            // SAFETY: caller contract.
            unsafe { (*op).zero_wait = true };
            self.zero_wait.store(true, Ordering::Release);
            self.request.store(op, Ordering::Release);
        }
        self.lock.unlock();
        if !go {
            // SAFETY: caller contract.
            unsafe {
                (*op).zero_wait = false;
                self.answer(op, Win32Error::OPERATION_ABORTED, 0);
            }
        }
    }

    fn park(&self) {
        bun_sys::windows::kernel32::WaitForSingleObject(self.wake, bun_sys::windows::INFINITE);
    }

    /// # Safety
    /// `op` was taken from `request`; it is not touched after this.
    unsafe fn answer(&self, op: *mut ReadOp, err: Win32Error, bytes: u32) {
        // SAFETY: caller contract. The thread took `op` from `request`, so it
        // is the thread's until this decides: the loop reads it once it
        // dequeues the packet, or the pipe closed meanwhile and left it here.
        unsafe {
            if (*op)
                .finisher
                .compare_exchange(
                    READ_REQUESTED,
                    READ_POSTED,
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                )
                .is_err()
            {
                // No lane: that is for an `Event` pipe, which has no thread.
                drop(bun_core::heap::take(op));
                return;
            }
            (*op).verdict = self.verdict.take();
            (*op).posted = Some((err, bytes as usize));
            self.port.post(&raw mut (*op).op);
        }
    }

    /// The pipe is readable; nothing was taken.
    fn announce(&self) {
        let op = self.request.swap(ptr::null_mut(), Ordering::AcqRel);
        if !op.is_null() {
            // SAFETY: `op` was taken from `request`; `zero_wait` stays set.
            unsafe { self.answer(op, Win32Error::SUCCESS, 0) };
        }
    }

    fn abort_request(&self) {
        self.finish_request(Win32Error::OPERATION_ABORTED, 0);
    }

    /// The request is over: with `bytes` bytes at its `dest`, or with `err`.
    fn finish_request(&self, err: Win32Error, bytes: u32) {
        let op = self.request.swap(ptr::null_mut(), Ordering::AcqRel);
        if !op.is_null() {
            // SAFETY: `op` was taken from `request`.
            unsafe {
                (*op).zero_wait = false;
                self.answer(op, err, bytes);
            }
        }
    }

    /// Take at most `want` bytes to `dest`, without waiting, and say how it
    /// went. `None` when nothing was taken and nothing went wrong: the owner
    /// stopped, or the pipe is empty.
    ///
    /// # Safety
    /// `dest` has room for `want` bytes.
    unsafe fn read(&self, dest: *mut u8, want: u32) -> Option<(Win32Error, u32)> {
        if !self.armed.load(Ordering::Acquire) {
            return None;
        }
        let available = match self.available() {
            Ok(available) => available,
            Err(err) => return Some((err, 0)),
        };
        if available == 0 {
            return None;
        }
        let mut n: u32 = 0;
        // SAFETY: `handle` is open while `self` is; caller contract for `dest`.
        let ok = unsafe {
            win::ReadFile(
                self.handle,
                dest,
                available.min(want),
                &raw mut n,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Some((win::last_error(), 0));
        }
        Some((Win32Error::SUCCESS, n))
    }

    /// Bytes waiting in the pipe. What `PeekNamedPipe` does, without the event
    /// it makes and closes around the call: on a synchronous HANDLE, which
    /// this thread's is, the call itself returns when it is over.
    fn available(&self) -> Result<u32, Win32Error> {
        let mut peek = FILE_PIPE_PEEK_BUFFER {
            NamedPipeState: 0,
            ReadDataAvailable: 0,
            NumberOfMessages: 0,
            MessageLength: 0,
        };
        let mut iosb: win::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
        // SAFETY: `handle` is open while `self` is; the out-params are live
        // locals and the output length is `peek`'s.
        let status = unsafe {
            NtFsControlFile(
                self.handle,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                &raw mut iosb,
                FSCTL_PIPE_PEEK,
                ptr::null_mut(),
                0,
                (&raw mut peek).cast(),
                size_of::<FILE_PIPE_PEEK_BUFFER>() as u32,
            )
        };
        // BUFFER_OVERFLOW: there are bytes, and no room was offered for them.
        if status == win::NTSTATUS::SUCCESS || status == win::NTSTATUS::BUFFER_OVERFLOW {
            Ok(peek.ReadDataAvailable)
        } else {
            Err(Win32Error::from_ntstatus(status))
        }
    }

    /// The cancellable zero-byte read. `None`: interrupted, or not to start.
    fn wait_for_data(&self) -> Option<Win32Error> {
        self.lock.lock();
        let go = self.armed.load(Ordering::Acquire) && !self.shutdown.load(Ordering::Acquire);
        if go {
            self.waiting.store(true, Ordering::Release);
        }
        self.lock.unlock();
        if !go {
            return None;
        }
        let mut n: u32 = 0;
        let mut probe = [0u8; 1];
        // SAFETY: `handle` is open while `self` is; a zero-byte read writes nothing.
        let waited = unsafe {
            if win::ReadFile(
                self.handle,
                probe.as_mut_ptr(),
                0,
                &raw mut n,
                ptr::null_mut(),
            ) == 0
            {
                win::last_error()
            } else {
                Win32Error::SUCCESS
            }
        };
        // See `SyncReader::interrupt`: passing through the lock waits out a
        // cancel that is still spinning, before any other call can take it.
        self.waiting.store(false, Ordering::Release);
        self.lock.lock();
        self.lock.unlock();

        (waited != Win32Error::OPERATION_ABORTED).then_some(waited)
    }
}

impl WriteOp {
    unsafe extern "C" fn complete(loop_: *mut Loop, op: *mut Op, _entry: *mut OverlappedEntry) {
        let this = op.cast::<WriteOp>();
        // SAFETY: `op` is the first field of the `WriteOp` this packet was
        // submitted for; the packet is what kept it allocated.
        unsafe {
            super::op_dequeued(loop_);
            let pipe = (*this).pipe;
            // Its thread let go of the job before it posted this packet.
            if let Some(mut write) = (*pipe).sync_write.take()
                && let Some(job) = Arc::get_mut(&mut write)
            {
                (*this).owned = core::mem::take(&mut job.bytes);
                (*pipe).sync_spare = Some(write);
            }
            let (mut err, bytes) = completed(&(*this).op, (*this).posted.take());
            if let Some(kind) = (*this).verdict.take() {
                Inner::classified(pipe, kind);
                match kind {
                    Kind::Synchronous => {}
                    // Nothing was written.
                    Kind::Overlapped if !(*pipe).gone() => {
                        Inner::submit_write(pipe, this);
                        return;
                    }
                    Kind::Overlapped => err = Win32Error::OPERATION_ABORTED,
                    Kind::Unusable(errno) => {
                        (*this).error = Some(sys::Error::from_code(errno, Tag::write));
                        Self::finish(this);
                        return;
                    }
                }
            }
            if err != Win32Error::SUCCESS {
                (*this).error = Some(write_error(err));
            } else {
                (*this).done += bytes;
                // The rest of a buffer that did not fit one `WriteFile`.
                if bytes > 0 && (*this).done < (*this).len && !(*pipe).gone() {
                    Inner::submit_write(pipe, this);
                    return;
                }
            }
            Self::finish(this);
        }
    }

    /// The buffer of a lent write, for its owner: empty when a helper thread
    /// that could not be stopped still has the bytes. `None` for any other
    /// write.
    ///
    /// # Safety
    /// `this` is live and no longer with the kernel.
    unsafe fn reclaim(this: *mut WriteOp) -> Option<Vec<u8>> {
        // SAFETY: caller contract.
        unsafe {
            if !core::mem::take(&mut (*this).lent) {
                return None;
            }
            Some(core::mem::take(&mut (*this).owned))
        }
    }

    /// # Safety
    /// `this` is live, counted in its pipe, and referenced by nothing else.
    unsafe fn finish(this: *mut WriteOp) {
        // SAFETY: caller contract.
        unsafe {
            let pipe = (*this).pipe;
            if (*pipe).chunked_write == this {
                (*pipe).chunked_write = ptr::null_mut();
            }
            let result: WriteResult = match (*this).error.take() {
                Some(err) => Err(err),
                None => Ok((*this).done),
            };
            let callback = (*this).callback.take();
            let lent = Self::reclaim(this);
            Inner::recycle_write(pipe, this);
            (*pipe).pending -= 1;
            (*pipe).writes_in_flight -= 1;
            if (*pipe).event_write == this {
                (*pipe).event_write = ptr::null_mut();
            }

            if let Some(callback) = callback
                && !(*pipe).flags.contains(Flags::SILENT)
            {
                (*pipe).lent_back = lent;
                (*pipe).pins += 1;
                callback.invoke(result);
                (*pipe).pins -= 1;
                (*pipe).lent_back = None;
            }
            if (*pipe).gone() {
                Inner::maybe_finish(pipe);
                return;
            }
            Inner::pump_writes(pipe, ptr::null_mut());
            Inner::update_keep_alive(pipe);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// The write thread of a synchronous HANDLE
// ──────────────────────────────────────────────────────────────────────────

/// A duplicate of a synchronous pipe HANDLE for the threads that write to it.
/// A thread can be inside a call on it when the pipe closes, and closing the
/// last handle of a synchronous file object waits for such a call: the pipe's
/// own HANDLE is never the last one while a thread has this.
struct SyncHandle(HANDLE);

// SAFETY: a HANDLE may be used from any thread.
unsafe impl Send for SyncHandle {}
// SAFETY: as above.
unsafe impl Sync for SyncHandle {}

impl Drop for SyncHandle {
    fn drop(&mut self) {
        // SAFETY: the duplicate made in `SyncWrite::start`.
        unsafe { win::CloseHandle(self.0) };
    }
}

/// The calling thread's real HANDLE, for `CancelSynchronousIo`.
struct OwnThread(HANDLE);

impl Drop for OwnThread {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: the duplicate made below.
            unsafe { win::CloseHandle(self.0) };
        }
    }
}

thread_local! {
    static OWN_THREAD: OwnThread = {
        let mut handle: HANDLE = ptr::null_mut();
        // SAFETY: plain Win32 call on the pseudo-handles.
        unsafe {
            win::DuplicateHandle(
                win::GetCurrentProcess(),
                win::GetCurrentThread(),
                win::GetCurrentProcess(),
                &raw mut handle,
                0,
                0,
                win::DUPLICATE_SAME_ACCESS,
            );
        }
        OwnThread(handle)
    };
}

const SYNC_WRITE_RUNNING: u8 = 0;
/// The thread is handing the result to the port.
const SYNC_WRITE_POSTED: u8 = 1;
/// The loop ended the write itself: the thread lets go without posting.
const SYNC_WRITE_ORPHANED: u8 = 2;

/// One chunk of a write to a `Sync` or `Unknown` pipe, on a thread-pool
/// thread. A blocking `WriteFile` that another writer of the pipe is ahead of,
/// in whatever process, cannot be cancelled, so the loop never waits for the
/// thread: what the thread needs is here, the bytes included, and outlives the
/// pipe and the loop.
struct SyncWrite {
    handle: Arc<SyncHandle>,
    port: Arc<Port>,
    /// The write's bytes, which the thread may still be reading after the
    /// pipe and the loop are gone. The chunk is `bytes[offset..offset + len]`.
    bytes: Vec<u8>,
    offset: usize,
    len: usize,
    /// [`classify`] `handle` before writing.
    classify: bool,
    /// The thread's only once it has won `SYNC_WRITE_POSTED`.
    op: *mut WriteOp,
    state: AtomicU8,
    lock: bun_threading::Mutex,
    /// The thread is inside `WriteFile`, and `thread` is its HANDLE.
    writing: AtomicBool,
    cancelled: AtomicBool,
    thread: AtomicPtr<c_void>,
}

// SAFETY: `op` is touched by one side at a time, as `state` says; the rest is
// atomics and shared handles.
unsafe impl Send for SyncWrite {}
// SAFETY: as above.
unsafe impl Sync for SyncWrite {}

impl SyncWrite {
    /// Hand the next `chunk` bytes of `op` to a thread.
    ///
    /// # Safety
    /// `this` and `op` are live.
    unsafe fn start(this: *mut Inner, op: *mut WriteOp, chunk: u32) -> Result<(), Win32Error> {
        // SAFETY: caller contract.
        unsafe {
            // The last job again, if its thread has let go of it.
            let mut write = match (*this).sync_spare.take() {
                Some(spare) if Arc::strong_count(&spare) == 1 => spare,
                _ => {
                    let Some(port) = Inner::port(this) else {
                        return Err(win::last_error());
                    };
                    if (*this).sync_handle.is_none() {
                        let mut handle: HANDLE = ptr::null_mut();
                        if win::DuplicateHandle(
                            win::GetCurrentProcess(),
                            (*this).handle,
                            win::GetCurrentProcess(),
                            &raw mut handle,
                            0,
                            0,
                            win::DUPLICATE_SAME_ACCESS,
                        ) == 0
                        {
                            return Err(win::last_error());
                        }
                        (*this).sync_handle = Some(Arc::new(SyncHandle(handle)));
                    }
                    let Some(handle) = (*this).sync_handle.clone() else {
                        return Err(Win32Error::INVALID_HANDLE);
                    };
                    Arc::new(SyncWrite {
                        handle,
                        port,
                        bytes: Vec::new(),
                        offset: 0,
                        len: 0,
                        classify: false,
                        op: ptr::null_mut(),
                        state: AtomicU8::new(SYNC_WRITE_RUNNING),
                        lock: bun_threading::Mutex::new(),
                        writing: AtomicBool::new(false),
                        cancelled: AtomicBool::new(false),
                        thread: AtomicPtr::new(ptr::null_mut()),
                    })
                }
            };
            let Some(job) = Arc::get_mut(&mut write) else {
                return Err(Win32Error::INVALID_HANDLE);
            };
            // The write's bytes go with the job, not copied. Bytes the write
            // only borrows are: their owner may be gone before the thread is.
            let mut bytes = core::mem::take(&mut (*op).owned);
            if bytes.is_empty() && (*op).len > 0 {
                bytes = core::slice::from_raw_parts((*op).data, (*op).len).to_vec();
                (*op).data = bytes.as_ptr();
            }
            job.offset = (*op).data.add((*op).done) as usize - bytes.as_ptr() as usize;
            job.len = chunk as usize;
            job.bytes = bytes;
            job.classify = (*this).mode == Mode::Unknown;
            job.op = op;
            *job.state.get_mut() = SYNC_WRITE_RUNNING;
            *job.writing.get_mut() = false;
            *job.cancelled.get_mut() = false;

            let for_thread = Arc::into_raw(write.clone());
            if !super::queue_blocking_work(SyncWrite::run, for_thread.cast_mut().cast()) {
                let err = win::last_error();
                drop(Arc::from_raw(for_thread));
                if let Some(job) = Arc::get_mut(&mut write) {
                    (*op).owned = core::mem::take(&mut job.bytes);
                }
                return Err(err);
            }
            debug_assert!((*this).sync_write.is_none());
            (*this).sync_write = Some(write);
            Ok(())
        }
    }

    /// The pipe is closing. One attempt to get the thread out of `WriteFile`:
    /// it takes while the thread is inside the call with the pipe its to write
    /// to. Otherwise the write is the loop's to end, unless the thread is
    /// posting it already: returns it then.
    fn cancel(&self) -> Option<*mut WriteOp> {
        self.lock.lock();
        self.cancelled.store(true, Ordering::Release);
        // The thread leaves `writing` only through this lock, so the cancel
        // lands on this write or on nothing.
        let took = self.writing.load(Ordering::Acquire)
            // SAFETY: `thread` is the writing thread's open HANDLE while `writing` is set.
            && unsafe { win::CancelSynchronousIo(self.thread.load(Ordering::Acquire)) } != 0;
        self.lock.unlock();
        if took {
            return None;
        }
        self.state
            .compare_exchange(
                SYNC_WRITE_RUNNING,
                SYNC_WRITE_ORPHANED,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .ok()
            .map(|_| self.op)
    }

    /// `false`: the pipe closed, do not write.
    fn enter(&self) -> bool {
        self.lock.lock();
        let go = !self.cancelled.load(Ordering::Acquire);
        if go {
            self.thread
                .store(OWN_THREAD.with(|own| own.0), Ordering::Release);
            self.writing.store(true, Ordering::Release);
        }
        self.lock.unlock();
        go
    }

    fn leave(&self) {
        self.writing.store(false, Ordering::Release);
        // A cancel that is being issued has returned before anything else
        // this thread calls can be taken for the write.
        self.lock.lock();
        self.lock.unlock();
    }

    unsafe extern "system" fn run(context: *mut c_void) -> u32 {
        // SAFETY: `context` is the reference `start` made for this thread.
        let write = unsafe { Arc::from_raw(context.cast::<SyncWrite>().cast_const()) };
        let mut verdict = None;
        let mut error = Win32Error::SUCCESS;
        let mut written = 0usize;
        'work: {
            if write.classify {
                let kind = classify(write.handle.0);
                verdict = Some(kind);
                if kind != Kind::Synchronous {
                    break 'work;
                }
            }
            let chunk = &write.bytes[write.offset..write.offset + write.len];
            while written < chunk.len() {
                if !write.enter() {
                    error = Win32Error::OPERATION_ABORTED;
                    break;
                }
                let mut n: u32 = 0;
                // SAFETY: `handle` is open while `write` is; the range is within `chunk`.
                let failed = unsafe {
                    win::WriteFile(
                        write.handle.0,
                        chunk.as_ptr().add(written),
                        (chunk.len() - written) as u32,
                        &raw mut n,
                        ptr::null_mut(),
                    ) == 0
                }
                .then(win::last_error);
                write.leave();
                if let Some(err) = failed {
                    error = err;
                    break;
                }
                // A `PIPE_NOWAIT` end with no room takes nothing and says so by
                // succeeding; the mode is the pipe end's, which whoever shares
                // it can change at any time.
                if n == 0 {
                    break;
                }
                written += n as usize;
            }
        }
        if write
            .state
            .compare_exchange(
                SYNC_WRITE_RUNNING,
                SYNC_WRITE_POSTED,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
        {
            let op = write.op;
            let port = write.port.clone();
            // Before the packet: the loop uses the job again once it has it.
            drop(write);
            // SAFETY: the loop counts the packet posted here as owed, which
            // keeps `op` allocated until it is dequeued; the loop does not
            // touch `verdict` or `posted` meanwhile.
            unsafe {
                (*op).verdict = verdict;
                (*op).posted = Some((error, written));
                port.post(&raw mut (*op).op);
            }
        }
        0
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Connecting
// ──────────────────────────────────────────────────────────────────────────

/// A connection attempt to a named pipe. Dropping it abandons the attempt: the
/// callback does not run, and the loop is no longer kept alive for it.
pub struct ConnectRequest {
    state: Rc<ConnectState>,
    loop_: *mut Loop,
}

/// What the request and its operation share. Both are the loop thread's.
struct ConnectState {
    abandoned: Cell<bool>,
    /// The attempt holds the loop alive. Whichever of the request's drop, the
    /// loop's teardown and the completion comes first gives that up.
    holds_loop: Cell<bool>,
    /// The pipe device, while a wait for an instance is out on it.
    device: Cell<HANDLE>,
}

impl ConnectState {
    /// The attempt is over for its owner: no callback, no hold on the loop,
    /// and a wait that is out is cancelled, which brings its packet at once.
    ///
    /// # Safety
    /// `loop_` is the live loop the attempt was started on, unless the hold on
    /// it was given up before.
    unsafe fn abandon(&self, loop_: *mut Loop) {
        self.abandoned.set(true);
        // SAFETY: caller contract.
        unsafe { self.release_loop(loop_) };
        let device = self.device.get();
        if device != INVALID_HANDLE_VALUE {
            // SAFETY: `device` is open until the wait's packet is dequeued,
            // and the wait is the one operation on it.
            unsafe { win::CancelIoEx(device, ptr::null_mut()) };
        }
    }

    /// # Safety
    /// As [`abandon`](Self::abandon).
    unsafe fn release_loop(&self, loop_: *mut Loop) {
        if self.holds_loop.replace(false) {
            // SAFETY: caller contract.
            unsafe { (*loop_).sub_active(1) };
        }
    }
}

#[repr(C)]
struct ConnectOp {
    op: Op,
    link: Link,
    name: Vec<u16>,
    handle: HANDLE,
    error: u32,
    state: Rc<ConnectState>,
    callback: Callback<sys::Result<Pipe>>,
}

/// How long a connecting client waits for a busy server to offer an instance.
const CONNECT_BUSY_WAIT_MS: i64 = 30_000;

/// `FSCTL_PIPE_FLUSH` (`ntifs.h`): what `FlushFileBuffers` sends to a pipe.
/// It completes when the other end has read what was written before it.
const FSCTL_PIPE_FLUSH: u32 = 0x0011_8040;

/// One [`Pipe::flush_peer`] request.
#[repr(C)]
struct FlushOp {
    op: Op,
    pipe: *mut Inner,
    callback: Callback<sys::Result<()>>,
}

impl FlushOp {
    unsafe extern "C" fn complete(loop_: *mut Loop, op: *mut Op, _entry: *mut OverlappedEntry) {
        let this = op.cast::<FlushOp>();
        // SAFETY: `op` is the first field of the `FlushOp` this packet was
        // submitted for; the packet is what kept it allocated.
        unsafe {
            super::op_dequeued(loop_);
            let this = bun_core::heap::take(this);
            let pipe = this.pipe;
            (*pipe).pending -= 1;
            (*pipe).flush_op = ptr::null_mut();
            let (err, _) = completed(&this.op, None);
            if !(*pipe).gone() {
                (*pipe).pins += 1;
                this.callback.invoke(if err == Win32Error::SUCCESS {
                    Ok(())
                } else {
                    Err(sys::Error::from_win32(err, Tag::fsync))
                });
                (*pipe).pins -= 1;
            }
            if (*pipe).gone() {
                Inner::maybe_finish(pipe);
                return;
            }
            Inner::update_keep_alive(pipe);
        }
    }
}

/// `FSCTL_PIPE_WAIT` (`ntifs.h`): what `WaitNamedPipeW` sends to the pipe
/// device. `DeviceIoControl` cannot issue it: it takes the FSCTL path only for
/// `FILE_DEVICE_FILE_SYSTEM` codes, and this one is `FILE_DEVICE_NAMED_PIPE`.
const FSCTL_PIPE_WAIT: u32 = 0x0011_0018;
/// `FILE_PIPE_WAIT_FOR_BUFFER`: `LARGE_INTEGER Timeout; ULONG NameLength;
/// BOOLEAN TimeoutSpecified; WCHAR Name[]`, the name starting at this offset.
const PIPE_WAIT_NAME_OFFSET: usize = 14;

impl Pipe {
    /// Connect to the named pipe `name` (`\\.\pipe\…`). `on_connect(ctx, ..)`
    /// runs from the loop with the connected pipe or the error. The loop is
    /// kept alive until then.
    pub fn connect<T>(
        loop_: *mut Loop,
        name: &[u8],
        ctx: *mut T,
        on_connect: unsafe fn(*mut T, sys::Result<Pipe>),
    ) -> sys::Result<ConnectRequest> {
        let name = super::to_wide_z(name);
        let mut error = 0u32;
        let handle = match open_client(&name) {
            Ok(handle) => handle,
            Err(err) => {
                error = err.int().into();
                INVALID_HANDLE_VALUE
            }
        };
        let busy = error == u32::from(Win32Error::PIPE_BUSY.int());
        let state = Rc::new(ConnectState {
            abandoned: Cell::new(false),
            holds_loop: Cell::new(false),
            device: Cell::new(INVALID_HANDLE_VALUE),
        });
        let op = bun_core::heap::into_raw(Box::new(ConnectOp {
            op: Op::new(ConnectOp::complete),
            link: Link::new(loop_, ConnectOp::shut),
            name,
            handle,
            error,
            state: state.clone(),
            callback: Callback::new(ctx, on_connect),
        }));
        // SAFETY: `op` is live; `loop_` is the caller's live loop. The op is
        // freed only by `ConnectOp::complete`.
        unsafe {
            if busy {
                // Every instance was busy: wait for one and try again.
                if let Err(err) = ConnectOp::wait_for_instance(op) {
                    let device = state.device.replace(INVALID_HANDLE_VALUE);
                    if device != INVALID_HANDLE_VALUE {
                        win::CloseHandle(device);
                    }
                    drop(bun_core::heap::take(op));
                    return Err(sys::Error::from_win32(err, Tag::connect));
                }
            } else {
                // The outcome is known; it is still reported from the loop.
                super::complete_from_loop(loop_, &raw mut (*op).op);
            }
            Link::insert(&raw mut (*op).link);
            (*loop_).add_active(1);
            state.holds_loop.set(true);
            Ok(ConnectRequest { state, loop_ })
        }
    }
}

impl Drop for ConnectRequest {
    fn drop(&mut self) {
        // SAFETY: the attempt holds the loop only until its packet is
        // dequeued or the loop's teardown shut it, and the request's owner
        // drops it before its loop goes otherwise.
        unsafe { self.state.abandon(self.loop_) };
    }
}

/// A client end: duplex if the server allows, else whichever direction it does.
/// No `SECURITY_SQOS_PRESENT`: the server is somebody else's (an ssh agent, a
/// service) and may identify or impersonate its client.
fn open_client(name: &[u16]) -> Result<HANDLE, Win32Error> {
    let flags = win::FILE_FLAG_OVERLAPPED;
    let attempts = [
        win::GENERIC_READ | win::GENERIC_WRITE,
        // The opposite direction's *_ATTRIBUTES right is what lets the pipe's
        // state be queried and set on a one-way end.
        win::GENERIC_READ | win::FILE_WRITE_ATTRIBUTES,
        win::GENERIC_WRITE | win::FILE_READ_ATTRIBUTES,
    ];
    let mut last = Win32Error::ACCESS_DENIED;
    for access in attempts {
        // SAFETY: `name` is NUL-terminated.
        let handle = unsafe {
            win::CreateFileW(
                name.as_ptr(),
                access,
                0,
                ptr::null_mut(),
                win::OPEN_EXISTING,
                flags,
                ptr::null_mut(),
            )
        };
        if handle != INVALID_HANDLE_VALUE {
            return Ok(handle);
        }
        last = win::last_error();
        // A one-way pipe refuses the duplex open with ACCESS_DENIED.
        if last != Win32Error::ACCESS_DENIED {
            break;
        }
    }
    Err(last)
}

/// The pipe device `name` (NUL-terminated) is served by, as `CreateFileW`
/// takes it, and the pipe's name on that device: what `WaitNamedPipeW` opens
/// and sends. `\\.\pipe\a\b` is `a\b` on `\\.\pipe\`; `\\server\pipe\a` is `a`
/// on `\\server\pipe`. `\\?\pipe\…`, which `WaitNamedPipeW` refuses and
/// `CreateFileW` takes, is the local device too.
fn pipe_device_and_name(name: &[u16]) -> Option<(Vec<u16>, Vec<u16>)> {
    const BACKSLASH: u16 = b'\\' as u16;
    let is_sep = |unit: u16| unit == BACKSLASH || unit == u16::from(b'/');
    let name = name.strip_suffix(&[0]).unwrap_or(name);
    if name.len() < 2 || !is_sep(name[0]) || !is_sep(name[1]) {
        return None;
    }
    let rest = &name[2..];
    let server_len = rest.iter().position(|&unit| is_sep(unit))?;
    let (server, rest) = (&rest[..server_len], &rest[server_len + 1..]);
    let pipe_len = rest.iter().position(|&unit| is_sep(unit))?;
    let (pipe, pipe_name) = (&rest[..pipe_len], &rest[pipe_len + 1..]);
    let is_pipe = pipe.len() == 4
        && pipe.iter().zip(b"pipe").all(|(&unit, &ascii)| {
            unit == u16::from(ascii) || unit == u16::from(ascii.to_ascii_uppercase())
        });
    if server.is_empty() || !is_pipe || pipe_name.is_empty() {
        return None;
    }
    let verbatim = server == [u16::from(b'?')];
    let local = verbatim || server == [u16::from(b'.')];
    let mut device: Vec<u16> = Vec::with_capacity(server.len() + 9);
    device.extend([BACKSLASH, BACKSLASH]);
    const DOT: [u16; 1] = [b'.' as u16];
    device.extend(if local { &DOT[..] } else { server });
    device.push(BACKSLASH);
    device.extend(b"pipe".iter().map(|&ascii| u16::from(ascii)));
    if local {
        device.push(BACKSLASH);
    }
    device.push(0);
    // Win32 turns `/` into `\` on the way to the device, except in a `\\?\` name.
    let pipe_name = pipe_name
        .iter()
        .map(|&unit| {
            if !verbatim && is_sep(unit) {
                BACKSLASH
            } else {
                unit
            }
        })
        .collect();
    Some((device, pipe_name))
}

impl ConnectOp {
    /// Ask the pipe device to say when the server offers an instance. The
    /// answer is a packet on the loop's port: [`complete`](Self::complete)
    /// tries the open again.
    ///
    /// # Safety
    /// `this` is live, with no wait out; its loop is the calling thread's.
    unsafe fn wait_for_instance(this: *mut ConnectOp) -> Result<(), Win32Error> {
        // SAFETY: caller contract.
        unsafe {
            let loop_ = (*this).link.loop_;
            let state: &ConnectState = &(*this).state;
            let Some((device_path, pipe_name)) = pipe_device_and_name(&(*this).name) else {
                return Err(Win32Error::BAD_PATHNAME);
            };
            let mut device = state.device.get();
            if device == INVALID_HANDLE_VALUE {
                device = win::CreateFileW(
                    device_path.as_ptr(),
                    win::FILE_READ_ATTRIBUTES | win::SYNCHRONIZE,
                    win::FILE_SHARE_READ | win::FILE_SHARE_WRITE,
                    ptr::null_mut(),
                    win::OPEN_EXISTING,
                    win::FILE_FLAG_OVERLAPPED,
                    ptr::null_mut(),
                );
                if device == INVALID_HANDLE_VALUE {
                    return Err(win::last_error());
                }
                if bun_sys::windows::CreateIoCompletionPort(device, iocp::us_loop_iocp(loop_), 0, 0)
                    .is_err()
                {
                    let err = win::last_error();
                    win::CloseHandle(device);
                    return Err(err);
                }
                state.device.set(device);
            }

            let name_bytes = pipe_name.len() * 2;
            let mut request = vec![0u8; PIPE_WAIT_NAME_OFFSET + name_bytes];
            // Relative, in 100 ns units. Left unspecified, the timeout is the
            // one the server gave the pipe.
            request[0..8].copy_from_slice(&(-(CONNECT_BUSY_WAIT_MS * 10_000)).to_le_bytes());
            request[8..12].copy_from_slice(&(name_bytes as u32).to_le_bytes());
            request[12] = 1;
            for (i, unit) in pipe_name.iter().enumerate() {
                let at = PIPE_WAIT_NAME_OFFSET + i * 2;
                request[at..at + 2].copy_from_slice(&unit.to_le_bytes());
            }

            // The OVERLAPPED's first two fields are the IO_STATUS_BLOCK, as for
            // every Win32 overlapped call; its address is what the port hands
            // back. The input is copied before the call returns.
            (*this).op.overlapped.Internal = 0;
            (*this).op.overlapped.InternalHigh = 0;
            let overlapped = &raw mut (*this).op.overlapped;
            let status = NtFsControlFile(
                device,
                ptr::null_mut(),
                ptr::null_mut(),
                overlapped.cast(),
                overlapped.cast(),
                FSCTL_PIPE_WAIT,
                request.as_mut_ptr().cast(),
                request.len() as u32,
                ptr::null_mut(),
                0,
            );
            // A call that fails outright queues no packet.
            if status.0 >= 0xC000_0000 {
                return Err(Win32Error::from_ntstatus(status));
            }
            super::op_submitted(loop_);
            Ok(())
        }
    }

    /// [`Link::shut`]: the loop is about to be freed.
    unsafe fn shut(link: *mut Link) {
        // SAFETY: `link` is the `link` field of a listed (live) `ConnectOp`,
        // whose loop is still live.
        unsafe {
            let this = link
                .byte_sub(core::mem::offset_of!(ConnectOp, link))
                .cast::<ConnectOp>();
            Link::remove(link);
            let state: &ConnectState = &(*this).state;
            state.abandon((*link).loop_);
        }
    }

    unsafe extern "C" fn complete(loop_: *mut Loop, op: *mut Op, _entry: *mut OverlappedEntry) {
        let this = op.cast::<ConnectOp>();
        // SAFETY: `op` is the first field of the `ConnectOp` this packet was
        // posted for; the packet is what kept it allocated.
        unsafe {
            super::op_dequeued(loop_);
            let state: &ConnectState = &(*this).state;
            let abandoned = state.abandoned.get();
            if state.device.get() != INVALID_HANDLE_VALUE {
                // The packet is the wait's.
                let waited = win::status_to_win32((*this).op.status());
                if !abandoned && waited == Win32Error::SUCCESS {
                    match open_client(&(*this).name) {
                        Ok(handle) => {
                            (*this).handle = handle;
                            (*this).error = 0;
                        }
                        // Another client took the instance first.
                        Err(err) if err == Win32Error::PIPE_BUSY => {
                            match Self::wait_for_instance(this) {
                                Ok(()) => return,
                                Err(err) => (*this).error = err.int().into(),
                            }
                        }
                        Err(err) => (*this).error = err.int().into(),
                    }
                } else {
                    (*this).error = waited.int().into();
                }
                win::CloseHandle(state.device.replace(INVALID_HANDLE_VALUE));
            }

            Link::remove(&raw mut (*this).link);
            let this = bun_core::heap::take(this);
            this.state.release_loop(loop_);
            let connected = this.handle != INVALID_HANDLE_VALUE && this.error == 0;
            if abandoned {
                if connected {
                    win::CloseHandle(this.handle);
                }
                return;
            }
            let result = if connected {
                let fd = Fd::from_system(this.handle);
                Pipe::open(loop_, fd, PipeOrigin::Created, true).inspect_err(|_| {
                    win::CloseHandle(this.handle);
                })
            } else {
                Err(sys::Error::from_win32(
                    Win32Error::from_u32(this.error),
                    Tag::connect,
                ))
            };
            this.callback.invoke(result);
        }
    }
}
