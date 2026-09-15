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
//! - [`Mode::Sync`]: a synchronous end somebody else created. Reads block on
//!   the pipe's own reader thread ([`SyncReader`]) and writes on a helper
//!   thread; each posts its result to the loop.
//!
//! A pending read is never cancelled except by closing: cancelling a buffered
//! pipe read can make the peer's `WriteFile` report success for bytes nobody
//! received. Pausing lets the read complete and holds what it produced.

use core::ffi::c_void;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, AtomicU32, Ordering};
use std::sync::Arc;

use bun_sys::{self as sys, E, Fd, FdExt as _, Tag};
use bun_uws_sys::Loop;
use bun_uws_sys::iocp::{self, Op, OverlappedEntry, Wait};

use super::sys as win;
use super::sys::{HANDLE, INVALID_HANDLE_VALUE, Win32Error};
use super::{Callback, Link, Port};

bun_core::declare_scope!(WinPipe, hidden);

/// Bytes asked of the kernel per read unless the owner says otherwise.
pub const DEFAULT_READ_SIZE: usize = 64 * 1024;

/// `WriteFile` takes a `DWORD`; larger buffers go out in several calls.
const MAX_WRITE_CHUNK: usize = 0x7fff_f000;

/// How long opening somebody else's pipe waits for the helper thread that asks
/// the kernel whether the HANDLE is synchronous. The query only stalls behind
/// another process's blocking I/O on the same file object, which a
/// synchronous file object alone allows, so running out of time means
/// "synchronous".
const MODE_PROBE_DEADLINE_MS: u32 = 100;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Mode {
    Owned,
    Event,
    Sync,
}

/// What a read produced.
pub enum ReadEvent<'a> {
    /// Bytes from the pipe. The `Vec` may be taken (`mem::take`, `mem::swap`
    /// with an empty one); whatever is left in it is discarded and its
    /// capacity reused for the next read.
    Data(&'a mut Vec<u8>),
    /// The write side is gone. Reading has stopped.
    Eof,
    /// Reading has stopped.
    Err(sys::Error),
}

type ReadCallback = unsafe fn(*const (), *mut c_void, ReadEvent<'_>);

#[derive(Clone, Copy)]
struct Reader {
    ctx: *mut c_void,
    f: *const (),
    call: ReadCallback,
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

    reader: Option<Reader>,
    read_op: *mut ReadOp,
    read_size: usize,
    /// `Sync` mode: data may leave the pipe before the owner has seen the chunk
    /// in front of it.
    read_ahead: bool,
    sync_reader: Option<SyncReader>,

    /// Accepted, not yet handed to the kernel (`Event` and `Sync` run one write
    /// at a time).
    write_head: *mut WriteOp,
    write_tail: *mut WriteOp,
    /// The one write the kernel has in `Event` mode.
    event_write: *mut WriteOp,
    writes_in_flight: u32,
    /// A write longer than one `WriteFile` can take that still has chunks to
    /// go: nothing queued behind it may reach the kernel before its last one.
    chunked_write: *mut WriteOp,
    write_lane: Lane,
    /// Buffers of writes that outlived the owner who lent them.
    adopted: Vec<Vec<u8>>,
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
    Err(Win32Error),
}

#[repr(C)]
struct ReadOp {
    op: Op,
    /// Outlives the operation: a pipe is freed only once `pending` is zero.
    pipe: *mut Inner,
    state: ReadState,
    outcome: Outcome,
    buf: Vec<u8>,
    /// A failure that produced no packet of its own, carried by a posted one.
    posted_error: Option<Win32Error>,
    lane: Lane,
    // `Sync` mode; the reader thread's from `request` until it posts the op:
    max_len: u32,
    read_ahead: bool,
    sync_bytes: u32,
    sync_error: u32,
    /// `read_stop` took the wait out of the kernel: an aborted completion is
    /// not an error.
    stopped: AtomicBool,
    /// `Event` mode: the operation out is the zero-byte read that waits for
    /// data, not a read that takes it.
    zero_wait: bool,
}

type WriteResult = sys::Result<usize>;

#[repr(C)]
struct WriteOp {
    op: Op,
    pipe: *mut Inner,
    next: *mut WriteOp,
    data: *const u8,
    len: usize,
    done: usize,
    chunk: u32,
    /// The bytes when the operation owns them (`data` points into it).
    owned: Vec<u8>,
    callback: Option<Callback<WriteResult>>,
    posted_error: Option<Win32Error>,
    // `Sync` mode:
    handle: HANDLE,
    port: Option<Arc<Port>>,
    sync_error: u32,
}

// ──────────────────────────────────────────────────────────────────────────
// Opening
// ──────────────────────────────────────────────────────────────────────────

impl Pipe {
    /// Take over an overlapped pipe end that Bun created (a spawned child's
    /// stdio, a pseudoconsole pipe, a connected client). The HANDLE is
    /// associated with the loop's completion port, and closed with the pipe
    /// when `close_fd` is set. On `Err` the caller still owns `fd`.
    pub fn open_owned(loop_: *mut Loop, fd: Fd, close_fd: bool) -> sys::Result<Pipe> {
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

    /// Take over a pipe end somebody else created. Standard handles are
    /// duplicated and the original is left alone; any other `fd` is closed
    /// with the pipe when `close_fd` is set. On `Err` the caller still owns
    /// `fd`.
    pub fn open_foreign(loop_: *mut Loop, fd: Fd, close_fd: bool) -> sys::Result<Pipe> {
        let original = fd.native();
        let (handle, close_with) = if fd.stdio_tag().is_some() {
            let mut dup: HANDLE = ptr::null_mut();
            // SAFETY: both process handles are the pseudo-handle; `original`
            // is the caller's open HANDLE.
            let ok = unsafe {
                win::DuplicateHandle(
                    win::GetCurrentProcess(),
                    original,
                    win::GetCurrentProcess(),
                    &raw mut dup,
                    0,
                    0,
                    win::DUPLICATE_SAME_ACCESS,
                )
            };
            if ok == 0 {
                return Err(sys::Error::from_win32(win::last_error(), Tag::dup).with_fd(fd));
            }
            (dup, Some(Fd::from_system(dup)))
        } else {
            (original, close_fd.then_some(fd))
        };
        let duplicated = handle != original;

        // A standard handle is the same file object for the life of the
        // process, so what the probe found (and the pipe mode it set) holds
        // for every later open: the second and third stream, every Worker.
        static STD_MODES: [AtomicU8; 3] = [AtomicU8::new(0), AtomicU8::new(0), AtomicU8::new(0)];
        const KNOWN_EVENT: u8 = 1;
        const KNOWN_SYNC: u8 = 2;
        let known = fd.stdio_tag().map(|tag| &STD_MODES[tag as usize]);
        let mode = match known.map(|slot| slot.load(Ordering::Acquire)) {
            Some(KNOWN_EVENT) => Mode::Event,
            Some(KNOWN_SYNC) => Mode::Sync,
            _ => match probe_mode(handle) {
                Ok(mode) => {
                    if let Some(slot) = known {
                        let value = if mode == Mode::Sync {
                            KNOWN_SYNC
                        } else {
                            KNOWN_EVENT
                        };
                        slot.store(value, Ordering::Release);
                    }
                    mode
                }
                Err(errno) => {
                    if handle != original {
                        // SAFETY: `handle` is the duplicate made above.
                        unsafe { win::CloseHandle(handle) };
                    }
                    return Err(sys::Error::from_code(errno, Tag::open).with_fd(fd));
                }
            },
        };
        let pipe = Self::create(loop_, handle, close_with, mode);
        if duplicated {
            // SAFETY: `inner` is live while `pipe` is.
            unsafe { (*pipe.raw()).flags.insert(Flags::DUPLICATED) };
        }
        Ok(pipe)
    }

    fn create(loop_: *mut Loop, handle: HANDLE, close_fd: Option<Fd>, mode: Mode) -> Pipe {
        let inner = bun_core::heap::into_raw(Box::new(Inner {
            link: Link::new(loop_, Inner::shut),
            handle,
            close_fd,
            mode,
            flags: Flags::REFD,
            port: None,
            reader: None,
            read_op: ptr::null_mut(),
            read_size: DEFAULT_READ_SIZE,
            read_ahead: true,
            sync_reader: None,
            write_head: ptr::null_mut(),
            write_tail: ptr::null_mut(),
            event_write: ptr::null_mut(),
            writes_in_flight: 0,
            chunked_write: ptr::null_mut(),
            write_lane: Lane::NONE,
            adopted: Vec::new(),
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

/// Ask the kernel, off-thread and with a deadline, whether `handle` is a
/// synchronous file object, and put it in byte-read blocking mode on the way.
fn probe_mode(handle: HANDLE) -> Result<Mode, E> {
    struct Probe {
        /// The probe's own duplicate: an abandoned probe finishes whenever the
        /// other process's read does, long after the caller's HANDLE value may
        /// have been closed and reused.
        handle: HANDLE,
        done: HANDLE,
        /// 0 until the thread runs, `STARTED` while it asks, then `RESULT_*`.
        result: AtomicU32,
    }
    // SAFETY: the raw handles are only used for thread-safe Win32 calls.
    unsafe impl Send for Probe {}
    // SAFETY: as above; the one shared field is atomic.
    unsafe impl Sync for Probe {}
    impl Drop for Probe {
        fn drop(&mut self) {
            // SAFETY: both were created by `probe_mode` and are closed once.
            unsafe {
                win::CloseHandle(self.done);
                win::CloseHandle(self.handle);
            }
        }
    }
    const RESULT_OVERLAPPED: u32 = 1;
    const RESULT_SYNC: u32 = 2;
    const RESULT_NOT_A_PIPE: u32 = 3;
    const RESULT_NOWAIT: u32 = 4;
    const RESULT_FAILED: u32 = 5;
    const STARTED: u32 = 6;

    unsafe extern "system" fn run(context: *mut c_void) -> u32 {
        // SAFETY: `context` is the `Arc<Probe>` leaked for this thread below.
        let probe = unsafe { Arc::from_raw(context.cast::<Probe>().cast_const()) };
        probe.result.store(STARTED, Ordering::Release);
        let mut mode_info: u32 = 0;
        let mut iosb: win::IO_STATUS_BLOCK = bun_core::ffi::zeroed();
        // SAFETY: out-params are live locals sized for FileModeInformation.
        let status = unsafe {
            win::NtQueryInformationFile(
                probe.handle,
                &raw mut iosb,
                (&raw mut mode_info).cast(),
                size_of::<u32>() as u32,
                win::FILE_INFORMATION_CLASS(win::FILE_MODE_INFORMATION),
            )
        };
        let mut result = if status != win::NTSTATUS::SUCCESS {
            RESULT_FAILED
        } else if mode_info & (win::FILE_SYNCHRONOUS_IO_ALERT | win::FILE_SYNCHRONOUS_IO_NONALERT)
            != 0
        {
            RESULT_SYNC
        } else {
            RESULT_OVERLAPPED
        };

        if result != RESULT_FAILED {
            let mut pipe_mode = win::PIPE_READMODE_BYTE | win::PIPE_WAIT;
            // SAFETY: `pipe_mode` is a live local; the other parameters are optional.
            let ok = unsafe {
                win::SetNamedPipeHandleState(
                    probe.handle,
                    &raw mut pipe_mode,
                    ptr::null_mut(),
                    ptr::null_mut(),
                )
            };
            if ok == 0 {
                let err = win::last_error();
                if err == Win32Error::ACCESS_DENIED {
                    // The handle lacks FILE_WRITE_ATTRIBUTES; that is fine as
                    // long as the pipe already blocks.
                    let mut state: u32 = 0;
                    // SAFETY: `state` is a live local; the rest is optional.
                    let ok = unsafe {
                        win::GetNamedPipeHandleStateW(
                            probe.handle,
                            &raw mut state,
                            ptr::null_mut(),
                            ptr::null_mut(),
                            ptr::null_mut(),
                            ptr::null_mut(),
                            0,
                        )
                    };
                    if ok == 0 {
                        result = RESULT_FAILED;
                    } else if state & win::PIPE_NOWAIT != 0 {
                        result = RESULT_NOWAIT;
                    }
                } else if err == Win32Error::INVALID_PARAMETER {
                    // FILE_TYPE_PIPE, yet not a pipe: a socket.
                    result = RESULT_NOT_A_PIPE;
                } else {
                    result = RESULT_FAILED;
                }
            }
        }
        probe.result.store(result, Ordering::Release);
        // SAFETY: `done` stays open until the last `Arc` drops.
        unsafe { win::SetEvent(probe.done) };
        0
    }

    let mut duplicate: HANDLE = ptr::null_mut();
    // SAFETY: plain Win32 call; `duplicate` is a live local.
    let duplicated = unsafe {
        win::DuplicateHandle(
            win::GetCurrentProcess(),
            handle,
            win::GetCurrentProcess(),
            &raw mut duplicate,
            0,
            0,
            win::DUPLICATE_SAME_ACCESS,
        )
    };
    if duplicated == 0 {
        return Err(E::EBADF);
    }
    // SAFETY: plain Win32 call.
    let done = unsafe { win::CreateEventW(ptr::null_mut(), 1, 0, ptr::null()) };
    if done.is_null() {
        // SAFETY: `duplicate` was just created and is not shared yet.
        unsafe { win::CloseHandle(duplicate) };
        return Err(E::ENOMEM);
    }
    let probe = Arc::new(Probe {
        handle: duplicate,
        done,
        result: AtomicU32::new(0),
    });
    let for_thread = Arc::into_raw(probe.clone());
    // SAFETY: `run` takes over the leaked `Arc`; everything in `Probe` is
    // usable from another thread.
    if !unsafe { super::queue_blocking_work(run, for_thread.cast_mut().cast()) } {
        // SAFETY: the thread never started, so the leaked `Arc` is still ours.
        drop(unsafe { Arc::from_raw(for_thread) });
        return Err(E::ENOMEM);
    }
    loop {
        bun_sys::windows::kernel32::WaitForSingleObject(done, MODE_PROBE_DEADLINE_MS);
        return match probe.result.load(Ordering::Acquire) {
            // The thread pool has not run it yet: the handle is not what is slow.
            0 => continue,
            RESULT_OVERLAPPED => Ok(Mode::Event),
            RESULT_NOT_A_PIPE => Err(E::ENOTSOCK),
            RESULT_NOWAIT => Err(E::EACCES),
            RESULT_FAILED => Err(E::EBADF),
            _ => Ok(Mode::Sync),
        };
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

    /// Whether a synchronous HANDLE's reader thread may take the next chunk
    /// from the pipe while the owner is still handling the one before it (the
    /// default). An owner that must not take a byte past some count turns it
    /// off, since its next read size depends on what this one produced.
    pub fn set_read_ahead(&mut self, allowed: bool) {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        unsafe { (*self.raw()).read_ahead = allowed };
    }

    /// Deliver what the pipe produces to `on_read(ctx, ..)`, always from the
    /// loop and never from inside this call. `ctx` must stay valid until
    /// `read_stop`, the `Eof`/`Err` event, or the `Pipe` is closed or dropped.
    pub fn read_start<T>(
        &mut self,
        ctx: *mut T,
        on_read: unsafe fn(*mut T, ReadEvent<'_>),
    ) -> sys::Result<()> {
        unsafe fn call<T>(f: *const (), ctx: *mut c_void, event: ReadEvent<'_>) {
            // SAFETY: `f` was erased from exactly this type below.
            let f =
                unsafe { core::mem::transmute::<*const (), unsafe fn(*mut T, ReadEvent<'_>)>(f) };
            // SAFETY: the owner keeps `ctx` valid while reading (see `read_start`).
            unsafe { f(ctx.cast::<T>(), event) }
        }
        let this = self.raw();
        // SAFETY: `inner` is live while the owner's `Pipe` is; no reference
        // into it is held across the calls below.
        unsafe {
            if (*this).flags.contains(Flags::DETACHED) {
                return Err(sys::Error::from_code(E::EBADF, Tag::read));
            }
            (*this).reader = Some(Reader {
                ctx: ctx.cast(),
                f: on_read as *const (),
                call: call::<T>,
            });
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
    /// zero-byte read costs the peer's write nothing. A chunk that a
    /// synchronous HANDLE's reader thread took before this call (it works one
    /// ahead, see [`SyncReader`]) is kept for the next `read_start`.
    pub fn read_stop(&mut self) {
        // SAFETY: `inner` is live while the owner's `Pipe` is; `read_op` is
        // owned by it while non-null.
        unsafe {
            let this = self.raw();
            (*this).flags.remove(Flags::READING);
            let read = (*this).read_op;
            let in_flight = !read.is_null() && (*read).state == ReadState::InFlight;
            match (*this).mode {
                Mode::Owned => {}
                Mode::Sync => {
                    if in_flight {
                        (*read).stopped.store(true, Ordering::Release);
                    }
                    // Also with nothing in flight: the thread may be waiting
                    // for the chunk after the one being delivered.
                    if let Some(reader) = &(*this).sync_reader {
                        reader.disarm();
                    }
                }
                Mode::Event => {
                    if in_flight && (*read).zero_wait {
                        (*read).stopped.store(true, Ordering::Release);
                        win::CancelIoEx((*this).handle, (&raw mut (*read).op).cast());
                    }
                }
            }
            Inner::update_keep_alive(this);
        }
    }

    /// Write `data`, then call `on_write(ctx, result)` from the loop — also
    /// when the pipe is closed first (`ECANCELED`). `result` is the byte count,
    /// which is `data.len()` unless the write failed.
    ///
    /// # Safety
    /// `data` and `ctx` must stay valid until `on_write` runs. A `Pipe` that is
    /// dropped (rather than [`close`](Self::close)d) never calls back; give it
    /// the bytes first ([`adopt_write_buffer`](Self::adopt_write_buffer)).
    pub unsafe fn write<T>(
        &mut self,
        data: &[u8],
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
            )
        }
    }

    /// As [`write`](Self::write), for bytes the operation should own: nothing
    /// needs to outlive the call, and `on_write` is optional.
    pub fn write_owned<T>(
        &mut self,
        data: Vec<u8>,
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
            )
        }
    }

    /// Write all of `data` before returning, blocking the calling thread for
    /// as long as the reader takes. Queues behind writes already in flight.
    pub fn write_blocking(&mut self, data: &[u8]) -> sys::Result<usize> {
        // SAFETY: `inner` is live while the owner's `Pipe` is.
        unsafe { Inner::write_blocking(self.raw(), data) }
    }

    /// The process on the other end of a named pipe.
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
    err == Win32Error::BROKEN_PIPE
        || err == Win32Error::PIPE_NOT_CONNECTED
        || err == Win32Error::NO_DATA
        || err == Win32Error::HANDLE_EOF
}

impl Inner {
    fn has_writes(&self) -> bool {
        self.writes_in_flight > 0 || !self.write_head.is_null()
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
                    posted_error: None,
                    lane: Lane::NONE,
                    max_len: 0,
                    read_ahead: false,
                    sync_bytes: 0,
                    sync_error: 0,
                    stopped: AtomicBool::new(false),
                    zero_wait: false,
                }));
            }
            let op = (*this).read_op;
            match (*op).state {
                ReadState::InFlight | ReadState::Replaying | ReadState::Delivering => Ok(()),
                ReadState::Held => {
                    // Back through the port so the owner hears of it from the
                    // loop, not from inside `read_start`.
                    if !super::post_to_loop((*this).link.loop_, &raw mut (*op).op) {
                        return Err(win::last_error());
                    }
                    (*this).pending += 1;
                    (*op).state = ReadState::Replaying;
                    Ok(())
                }
                ReadState::Idle => Self::submit_read(this, op),
            }
        }
    }

    /// # Safety
    /// `this` and its idle `op` are live; `this` is not closing.
    /// One overlapped `ReadFile` of `len` bytes into `op.buf` on an `Event`
    /// HANDLE. `Ok(true)`: it is pending and its completion arrives as a
    /// packet. `Ok(false)`: it is over already; `posted_error` or the
    /// OVERLAPPED says how.
    ///
    /// # Safety
    /// `this` is live in `Event` mode, `op` is its read with nothing out, and
    /// `op.buf` has room for `len` bytes.
    unsafe fn event_read(this: *mut Inner, op: *mut ReadOp, len: u32) -> Result<bool, Win32Error> {
        // SAFETY: caller contract. The buffer and OVERLAPPED handed to the
        // kernel live in `op`, which is freed only from its own completion.
        unsafe {
            let loop_ = (*this).link.loop_;
            (*op).lane.ensure(loop_)?;
            (*op).posted_error = None;
            (*op).op.overlapped.internal = 0;
            (*op).op.overlapped.internal_high = 0;
            // Low bit set: the completion queues no packet on whatever port
            // the file object may be associated with.
            (*op).op.overlapped.event = ((*op).lane.event as usize | 1) as HANDLE;
            let ok = win::ReadFile(
                (*this).handle,
                (*op).buf.as_mut_ptr(),
                len,
                ptr::null_mut(),
                (&raw mut (*op).op).cast(),
            );
            if ok == 0 && win::last_error() == win::IO_PENDING {
                if iocp::us_iocp_wait_start((*op).lane.wait, (*op).lane.event, &raw mut (*op).op)
                    != 0
                {
                    // Nothing will announce the completion, so collect it here.
                    win::CancelIoEx((*this).handle, (&raw mut (*op).op).cast());
                    bun_sys::windows::kernel32::WaitForSingleObject(
                        (*op).lane.event,
                        bun_sys::windows::INFINITE,
                    );
                    return Ok(false);
                }
                super::wait_submitted(loop_);
                return Ok(true);
            }
            if ok == 0 {
                (*op).posted_error = Some(win::last_error());
            }
            Ok(false)
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
                (*op).posted_error = Some(win::last_error());
                return Ok(false);
            }
            if available == 0 {
                // Another reader of the pipe got there first: wait again.
                (*op).zero_wait = true;
                return Self::event_read(this, op, 0);
            }
            let len = (available as usize).min((*op).buf.capacity()) as u32;
            Self::event_read(this, op, len)
        }
    }

    unsafe fn submit_read(this: *mut Inner, op: *mut ReadOp) -> Result<(), Win32Error> {
        // SAFETY: caller contract. The buffer and OVERLAPPED handed to the
        // kernel live in `op`, which is freed only from its own completion.
        unsafe {
            let loop_ = (*this).link.loop_;
            let want = (*this).read_size;
            (*op).buf.clear();
            if (*op).buf.capacity() < want {
                (*op).buf.reserve_exact(want);
            }
            let len = want.min((*op).buf.capacity()) as u32;
            (*op).outcome = Outcome::None;
            (*op).posted_error = None;
            (*op).op.overlapped.internal = 0;
            (*op).op.overlapped.internal_high = 0;
            (*op).op.overlapped.offset = 0;
            (*op).op.overlapped.offset_high = 0;

            match (*this).mode {
                Mode::Owned => {
                    (*op).op.overlapped.event = ptr::null_mut();
                    let ok = win::ReadFile(
                        (*this).handle,
                        (*op).buf.as_mut_ptr(),
                        len,
                        ptr::null_mut(),
                        (&raw mut (*op).op).cast(),
                    );
                    if ok != 0 || win::last_error() == win::IO_PENDING {
                        // A read that finished at once still queues its packet.
                        super::op_submitted(loop_);
                    } else {
                        (*op).posted_error = Some(win::last_error());
                        if !super::post_to_loop(loop_, &raw mut (*op).op) {
                            return Err(win::last_error());
                        }
                    }
                }
                Mode::Event => {
                    // Wait with a zero-byte read and take the data when it
                    // completes: see `read_stop`.
                    (*op).zero_wait = true;
                    if !Self::event_read(this, op, 0)?
                        && !super::post_to_loop(loop_, &raw mut (*op).op)
                    {
                        return Err(win::last_error());
                    }
                }
                Mode::Sync => {
                    if (*this).sync_reader.is_none() {
                        let Some(port) = Self::port(this) else {
                            return Err(win::last_error());
                        };
                        (*this).sync_reader = Some(SyncReader::start((*this).handle, port)?);
                    }
                    (*op).max_len = len;
                    (*op).read_ahead = (*this).read_ahead;
                    (*op).sync_bytes = 0;
                    (*op).sync_error = 0;
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
    ) -> sys::Result<()> {
        // SAFETY: caller contract.
        unsafe {
            if (*this).gone() {
                return Err(sys::Error::from_code(E::EBADF, Tag::write));
            }
            // A helper thread cannot be stopped mid-write, so what it writes
            // from must not depend on the owner staying around.
            let (data, owned) = if (*this).mode == Mode::Sync && owned.is_empty() && len > 0 {
                let copy = core::slice::from_raw_parts(data, len).to_vec();
                (copy.as_ptr(), copy)
            } else {
                (data, owned)
            };
            let op = bun_core::heap::into_raw(Box::new(WriteOp {
                op: Op::new(WriteOp::complete),
                pipe: this,
                next: ptr::null_mut(),
                data,
                len,
                done: 0,
                chunk: 0,
                owned,
                callback,
                posted_error: None,
                handle: (*this).handle,
                port: None,
                sync_error: 0,
            }));
            if (*this).write_tail.is_null() {
                (*this).write_head = op;
            } else {
                (*(*this).write_tail).next = op;
            }
            (*this).write_tail = op;
            Self::update_keep_alive(this);
            Self::pump_writes(this);
            Ok(())
        }
    }

    /// Hand queued writes to the kernel: all of them on a HANDLE Bun owns
    /// (the kernel keeps them in order), one at a time otherwise.
    ///
    /// # Safety
    /// `this` is live and not closing.
    unsafe fn pump_writes(this: *mut Inner) {
        // SAFETY: caller contract; queued ops are owned by `this`.
        unsafe {
            loop {
                let op = (*this).write_head;
                if op.is_null()
                    || !(*this).chunked_write.is_null()
                    || ((*this).mode != Mode::Owned && (*this).writes_in_flight > 0)
                {
                    return;
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
                Self::submit_write(this, op);
            }
        }
    }

    /// Start (or continue) `op`. A failure to start travels through the port
    /// like any other completion.
    ///
    /// # Safety
    /// `this` and `op` are live; `op` is counted in `writes_in_flight` and
    /// `pending`.
    unsafe fn submit_write(this: *mut Inner, op: *mut WriteOp) {
        // SAFETY: caller contract. The OVERLAPPED lives in `op`, freed only
        // from its own completion.
        unsafe {
            let loop_ = (*this).link.loop_;
            let remaining = (*op).len - (*op).done;
            let chunk = remaining.min(MAX_WRITE_CHUNK) as u32;
            (*op).chunk = chunk;
            (*op).posted_error = None;
            (*op).op.overlapped.internal = 0;
            (*op).op.overlapped.internal_high = 0;
            (*op).op.overlapped.offset = 0;
            (*op).op.overlapped.offset_high = 0;
            let data = (*op).data.add((*op).done);

            let failed: Option<Win32Error> = match (*this).mode {
                Mode::Owned => {
                    (*op).op.overlapped.event = ptr::null_mut();
                    let ok = win::WriteFile(
                        (*this).handle,
                        data,
                        chunk,
                        ptr::null_mut(),
                        (&raw mut (*op).op).cast(),
                    );
                    if ok != 0 || win::last_error() == win::IO_PENDING {
                        super::op_submitted(loop_);
                        return;
                    }
                    Some(win::last_error())
                }
                Mode::Event => match (*this).write_lane.ensure(loop_) {
                    Err(err) => Some(err),
                    Ok(()) => {
                        let event = (*this).write_lane.event;
                        (*op).op.overlapped.event = (event as usize | 1) as HANDLE;
                        let ok = win::WriteFile(
                            (*this).handle,
                            data,
                            chunk,
                            ptr::null_mut(),
                            (&raw mut (*op).op).cast(),
                        );
                        if ok == 0 && win::last_error() == win::IO_PENDING {
                            if iocp::us_iocp_wait_start(
                                (*this).write_lane.wait,
                                event,
                                &raw mut (*op).op,
                            ) == 0
                            {
                                super::wait_submitted(loop_);
                                (*this).event_write = op;
                                return;
                            }
                            // Nothing will announce the completion: wait for
                            // it here (the reader decides how long that is).
                            bun_sys::windows::kernel32::WaitForSingleObject(
                                event,
                                bun_sys::windows::INFINITE,
                            );
                            None
                        } else if ok == 0 {
                            Some(win::last_error())
                        } else {
                            None
                        }
                    }
                },
                Mode::Sync => match Self::port(this) {
                    None => Some(win::last_error()),
                    Some(port) => {
                        (*op).port = Some(port);
                        (*op).handle = (*this).handle;
                        if super::queue_blocking_work(WriteOp::sync_write_thread, op.cast()) {
                            super::op_submitted(loop_);
                            return;
                        }
                        let err = win::last_error();
                        (*op).port = None;
                        Some(err)
                    }
                },
            };
            (*op).posted_error = failed;
            if !super::post_to_loop(loop_, &raw mut (*op).op) {
                // The port is unusable; the operation can only be abandoned.
                (*op).posted_error = Some(Win32Error::OPERATION_ABORTED);
                WriteOp::finish(op);
            }
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
            let mut written = 0usize;
            while written < data.len() {
                let chunk = (data.len() - written).min(MAX_WRITE_CHUNK) as u32;
                let mut n: u32 = 0;
                if (*this).mode == Mode::Sync {
                    if win::WriteFile(
                        (*this).handle,
                        data.as_ptr().add(written),
                        chunk,
                        &raw mut n,
                        ptr::null_mut(),
                    ) == 0
                    {
                        return Err(write_error(win::last_error()));
                    }
                } else {
                    if (*this).blocking_event.is_null() {
                        let event = win::CreateEventW(ptr::null_mut(), 1, 0, ptr::null());
                        if event.is_null() {
                            return Err(write_error(win::last_error()));
                        }
                        (*this).blocking_event = event;
                    }
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
                        if win::last_error() != win::IO_PENDING {
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
                    n = overlapped.InternalHigh as u32;
                }
                if n == 0 {
                    break;
                }
                written += n as usize;
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
                reader.stop();
            }
            let read = (*this).read_op;
            if !read.is_null() {
                match (*read).state {
                    ReadState::InFlight => match (*this).mode {
                        Mode::Owned | Mode::Event => {
                            win::CancelIoEx(handle, (&raw mut (*read).op).cast());
                        }
                        Mode::Sync => {}
                    },
                    ReadState::Idle | ReadState::Held => {
                        (*this).read_op = ptr::null_mut();
                        ReadOp::destroy(read);
                    }
                    ReadState::Replaying | ReadState::Delivering => {}
                }
            }

            if (*this).mode == Mode::Owned && (*this).writes_in_flight > 0 {
                // Everything this process has out on a HANDLE it owns is this
                // pipe's, and the read was dealt with above.
                win::CancelIoEx(handle, ptr::null_mut());
            } else if !(*this).event_write.is_null() {
                // Somebody else's HANDLE may carry other I/O from this process
                // (stdout written to directly): cancel this write only.
                win::CancelIoEx(handle, (&raw mut (*(*this).event_write).op).cast());
            }
            // Queued writes never reached the kernel; they complete as
            // cancelled, in order, through the port.
            let mut op = core::mem::replace(&mut (*this).write_head, ptr::null_mut());
            (*this).write_tail = ptr::null_mut();
            while !op.is_null() {
                let next = (*op).next;
                (*op).next = ptr::null_mut();
                (*op).posted_error = Some(Win32Error::OPERATION_ABORTED);
                (*this).writes_in_flight += 1;
                (*this).pending += 1;
                if !super::post_to_loop(loop_, &raw mut (*op).op) {
                    WriteOp::finish(op);
                }
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

            if (*this).state == ReadState::InFlight {
                if core::mem::take(&mut (*this).zero_wait)
                    && (*this).posted_error.is_none()
                    && win::status_to_win32((*this).op.status()) == Win32Error::SUCCESS
                {
                    if !(*pipe).flags.contains(Flags::READING) {
                        // Stopped since: what arrived stays in the pipe.
                        (*this).stopped.store(false, Ordering::Release);
                        (*this).state = ReadState::Idle;
                        return;
                    }
                    match Inner::event_fetch(pipe, this) {
                        Ok(true) => {
                            (*pipe).pending += 1;
                            return;
                        }
                        Ok(false) => {}
                        Err(err) => (*this).posted_error = Some(err),
                    }
                }
                (*this).outcome = Self::outcome(this, (*pipe).mode);
                if (*this).stopped.swap(false, Ordering::AcqRel)
                    && matches!(&(*this).outcome, Outcome::Err(err) if *err == Win32Error::OPERATION_ABORTED)
                {
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
                Outcome::Data if (*this).buf.is_empty() => {}
                Outcome::Data => {
                    (reader.call)(reader.f, reader.ctx, ReadEvent::Data(&mut (*this).buf));
                }
                Outcome::Eof => {
                    (*pipe).flags.remove(Flags::READING);
                    (*pipe).flags.insert(Flags::READ_ENDED);
                    (reader.call)(reader.f, reader.ctx, ReadEvent::Eof);
                }
                Outcome::Err(err) => {
                    (*pipe).flags.remove(Flags::READING);
                    (*pipe).flags.insert(Flags::READ_ENDED);
                    (reader.call)(reader.f, reader.ctx, ReadEvent::Err(read_error(err)));
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
            if (*pipe).flags.contains(Flags::READING)
                && let Err(err) = Inner::pump_read(pipe)
            {
                (*this).outcome = Outcome::Err(err);
                (*this).state = ReadState::Held;
                let _ = Inner::pump_read(pipe);
            }
        }
    }

    /// # Safety
    /// `this` just completed; its buffer holds what the kernel wrote.
    unsafe fn outcome(this: *mut ReadOp, mode: Mode) -> Outcome {
        // SAFETY: caller contract. The kernel initialized the first `bytes`
        // bytes of the buffer's capacity.
        unsafe {
            let (err, bytes) = if let Some(err) = (*this).posted_error {
                (err, 0)
            } else if mode == Mode::Sync {
                (
                    Win32Error::from_u32((*this).sync_error),
                    (*this).sync_bytes as usize,
                )
            } else {
                (
                    win::status_to_win32((*this).op.status()),
                    (*this).op.bytes_transferred(),
                )
            };
            // A message-mode pipe reports the part of a message that fit as
            // MORE_DATA; the bytes are as good as any.
            if err == Win32Error::SUCCESS || err == win::MORE_DATA {
                debug_assert!(bytes <= (*this).buf.capacity());
                (*this).buf.set_len(bytes.min((*this).buf.capacity()));
                return Outcome::Data;
            }
            if is_eof(err) {
                return Outcome::Eof;
            }
            Outcome::Err(err)
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
    /// is null; the thread takes it and posts it exactly once.
    request: AtomicPtr<ReadOp>,
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
/// The thread waits in a zero-byte read, which consumes nothing and can be
/// interrupted without the peer losing anything, then takes what
/// `PeekNamedPipe` reports. While the owner handles a chunk, the thread takes
/// the next one if it was in the pipe already when that chunk was read, and
/// holds it until the loop asks. What arrives later stays in the pipe until the
/// loop asks, so an owner that stops reading from its callback leaves it to
/// whoever reads the HANDLE next. `disarm` stops anything more being taken.
struct SyncReader {
    shared: Arc<SyncShared>,
    /// For `CancelSynchronousIo`.
    thread: HANDLE,
}

impl SyncReader {
    fn start(pipe: HANDLE, port: Arc<Port>) -> Result<SyncReader, Win32Error> {
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
        self.shared.armed.store(true, Ordering::Release);
        self.shared.request.store(op, Ordering::Release);
        // SAFETY: `wake` is open while `shared` is.
        unsafe { win::SetEvent(self.shared.wake) };
    }

    /// Nothing more leaves the pipe until the next `request`. A request that
    /// is outstanding comes back aborted, or with what was already read.
    fn disarm(&self) {
        self.shared.armed.store(false, Ordering::Release);
        self.interrupt();
    }

    /// The thread answers an outstanding request (as `disarm`) and exits.
    fn stop(self) {
        self.shared.shutdown.store(true, Ordering::Release);
        self.shared.armed.store(false, Ordering::Release);
        self.interrupt();
        // SAFETY: both HANDLEs are open; `thread` is this struct's to close.
        unsafe {
            win::SetEvent(self.shared.wake);
            win::CloseHandle(self.thread);
        }
    }

    /// Get the thread out of its zero-byte read. `armed` or `shutdown` was
    /// changed first: the thread checks them under `lock` before it blocks.
    fn interrupt(&self) {
        self.shared.lock.lock();
        // The cancel only takes once the thread is inside the call, and the
        // thread leaves `waiting` only through this lock, so none lands late.
        while self.shared.waiting.load(Ordering::Acquire) {
            // SAFETY: `thread` is this struct's open thread HANDLE.
            unsafe { win::CancelSynchronousIo(self.thread) };
            win::SwitchToThread();
        }
        self.shared.lock.unlock();
    }
}

impl SyncShared {
    fn run(&self) {
        // What the thread has taken from the pipe and nobody asked for yet:
        // the bytes in `ahead` and how the read that made them went.
        let mut ahead: Vec<u8> = Vec::new();
        let mut held: Option<Taken> = None;
        // Bytes that may be taken before the next request; 0 for none.
        let mut ahead_len: u32 = 0;
        loop {
            if self.shutdown.load(Ordering::Acquire) {
                break;
            }
            if let Some(taken) = held {
                let op = self.request.swap(ptr::null_mut(), Ordering::AcqRel);
                if op.is_null() {
                    self.park();
                    continue;
                }
                held = None;
                // SAFETY: `op` is this thread's until it is posted.
                unsafe {
                    ahead_len = if taken.error == 0 && taken.more && (*op).read_ahead {
                        (*op).max_len
                    } else {
                        0
                    };
                    core::mem::swap(&mut (*op).buf, &mut ahead);
                    self.answer(op, taken.error);
                }
                continue;
            }

            let op = self.request.load(Ordering::Acquire);
            if !self.armed.load(Ordering::Acquire) {
                if op.is_null() {
                    self.park();
                } else {
                    self.abort_request();
                }
                continue;
            }
            if !op.is_null() {
                // SAFETY: a stored request is this thread's until it is posted.
                held = self.read(&mut ahead, unsafe { (*op).max_len }, true);
                continue;
            }
            if ahead_len != 0 {
                // Without waiting: what was there when the last chunk was read
                // is there now, unless another reader of the pipe took it.
                held = self.read(&mut ahead, ahead_len, false);
                ahead_len = 0;
                if held.is_some() {
                    continue;
                }
            }
            self.park();
        }
        self.abort_request();
    }

    fn park(&self) {
        bun_sys::windows::kernel32::WaitForSingleObject(self.wake, bun_sys::windows::INFINITE);
    }

    /// # Safety
    /// `op` was taken from `request`; it is not touched after this.
    unsafe fn answer(&self, op: *mut ReadOp, error: u32) {
        // SAFETY: caller contract; the loop reads these once it dequeues the packet.
        unsafe {
            (*op).sync_error = error;
            (*op).sync_bytes = (*op).buf.len() as u32;
            self.port.post(&raw mut (*op).op);
        }
    }

    fn abort_request(&self) {
        let op = self.request.swap(ptr::null_mut(), Ordering::AcqRel);
        if !op.is_null() {
            // SAFETY: `op` was taken from `request`.
            unsafe {
                (*op).buf.clear();
                self.answer(op, Win32Error::OPERATION_ABORTED.int().into());
            }
        }
    }

    /// Take at most `want` bytes into `into`, after waiting for them if `wait`.
    /// `None` when nothing was taken and nothing went wrong: the wait was
    /// interrupted, the owner stopped as the data arrived, or the pipe is empty.
    fn read(&self, into: &mut Vec<u8>, want: u32, wait: bool) -> Option<Taken> {
        if wait {
            match self.wait_for_data() {
                Some(Win32Error::SUCCESS) => {}
                Some(err) => {
                    into.clear();
                    return Some(Taken::failed(err));
                }
                None => return None,
            }
        }
        if !self.armed.load(Ordering::Acquire) {
            return None;
        }
        into.clear();
        if into.capacity() < want as usize {
            into.reserve_exact(want as usize);
        }
        let Ok(available) = self.available() else {
            return Some(Taken::failed(win::last_error()));
        };
        // Nothing there: another reader of the pipe got to it first.
        if available == 0 {
            return wait.then_some(Taken {
                error: 0,
                more: false,
            });
        }
        let mut n: u32 = 0;
        // SAFETY: `handle` is open while `self` is; `into` has room for `want`
        // bytes and the kernel initializes the `n` it reports.
        unsafe {
            if win::ReadFile(
                self.handle,
                into.as_mut_ptr(),
                available.min(want),
                &raw mut n,
                ptr::null_mut(),
            ) == 0
            {
                return Some(Taken::failed(win::last_error()));
            }
            into.set_len(n as usize);
        }
        // A failure here is the next read's to report.
        Some(Taken {
            error: 0,
            more: self.available().map_or(true, |left| left > 0),
        })
    }

    fn available(&self) -> Result<u32, ()> {
        let mut available: u32 = 0;
        // SAFETY: `handle` is open while `self` is.
        let ok = unsafe {
            win::PeekNamedPipe(
                self.handle,
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                &raw mut available,
                ptr::null_mut(),
            )
        };
        if ok == 0 { Err(()) } else { Ok(available) }
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

/// How a read by the reader thread went.
#[derive(Clone, Copy)]
struct Taken {
    /// Win32 error; 0 with the bytes in the thread's buffer.
    error: u32,
    /// The pipe held more right after these bytes were taken.
    more: bool,
}

impl Taken {
    fn failed(err: Win32Error) -> Taken {
        Taken {
            error: err.int().into(),
            more: false,
        }
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
            if (*this).posted_error.is_none() {
                let (err, bytes) = if (*pipe).mode == Mode::Sync {
                    (
                        Win32Error::from_u32((*this).sync_error),
                        (*this).chunk as usize,
                    )
                } else {
                    (
                        win::status_to_win32((*this).op.status()),
                        (*this).op.bytes_transferred(),
                    )
                };
                if err != Win32Error::SUCCESS {
                    (*this).posted_error = Some(err);
                } else {
                    (*this).done += bytes;
                    // The rest of a buffer that did not fit one `WriteFile`.
                    if bytes > 0 && (*this).done < (*this).len && !(*pipe).gone() {
                        Inner::submit_write(pipe, this);
                        return;
                    }
                }
            }
            Self::finish(this);
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
            let result: WriteResult = match (*this).posted_error {
                Some(err) => Err(write_error(err)),
                None => Ok((*this).done),
            };
            let callback = (*this).callback.take();
            drop(bun_core::heap::take(this));
            (*pipe).pending -= 1;
            (*pipe).writes_in_flight -= 1;
            if (*pipe).event_write == this {
                (*pipe).event_write = ptr::null_mut();
            }

            if let Some(callback) = callback
                && !(*pipe).flags.contains(Flags::SILENT)
            {
                (*pipe).pins += 1;
                callback.invoke(result);
                (*pipe).pins -= 1;
            }
            if (*pipe).gone() {
                Inner::maybe_finish(pipe);
                return;
            }
            Inner::pump_writes(pipe);
            Inner::update_keep_alive(pipe);
        }
    }

    unsafe extern "system" fn sync_write_thread(context: *mut c_void) -> u32 {
        let op = context.cast::<WriteOp>();
        // SAFETY: `context` is the `WriteOp` submitted by `submit_write`; it
        // owns its bytes and stays allocated until the packet posted below is
        // dequeued.
        unsafe {
            let mut written = 0u32;
            let data = (*op).data.add((*op).done);
            while written < (*op).chunk {
                let mut n: u32 = 0;
                if win::WriteFile(
                    (*op).handle,
                    data.add(written as usize),
                    (*op).chunk - written,
                    &raw mut n,
                    ptr::null_mut(),
                ) == 0
                {
                    (*op).sync_error = win::last_error().int().into();
                    break;
                }
                written += n;
            }
            if let Some(port) = (*op).port.take() {
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
/// callback does not run.
pub struct ConnectRequest {
    abandoned: Arc<AtomicBool>,
}

#[repr(C)]
struct ConnectOp {
    op: Op,
    loop_: *mut Loop,
    port: Option<Arc<Port>>,
    name: Vec<u16>,
    handle: HANDLE,
    error: u32,
    abandoned: Arc<AtomicBool>,
    callback: Callback<sys::Result<Pipe>>,
}

/// How long a connecting client waits for a busy server to offer an instance.
const CONNECT_BUSY_WAIT_MS: u32 = 30_000;

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
        let abandoned = Arc::new(AtomicBool::new(false));
        let op = bun_core::heap::into_raw(Box::new(ConnectOp {
            op: Op::new(ConnectOp::complete),
            loop_,
            port: None,
            name,
            handle,
            error,
            abandoned: abandoned.clone(),
            callback: Callback::new(ctx, on_connect),
        }));
        // SAFETY: `op` is live; `loop_` is the caller's live loop. The op is
        // freed only by `ConnectOp::complete`.
        unsafe {
            let started = if busy {
                match super::port_for(loop_) {
                    Some(port) => {
                        (*op).port = Some(port);
                        let queued =
                            super::queue_blocking_work(ConnectOp::wait_for_instance, op.cast());
                        if queued {
                            super::op_submitted(loop_);
                        }
                        queued
                    }
                    None => false,
                }
            } else {
                // The outcome is known; it is still reported from the loop.
                super::post_to_loop(loop_, &raw mut (*op).op)
            };
            if !started {
                let err = win::last_error();
                let op = bun_core::heap::take(op);
                if op.handle != INVALID_HANDLE_VALUE {
                    win::CloseHandle(op.handle);
                }
                return Err(sys::Error::from_win32(err, Tag::connect));
            }
            (*loop_).add_active(1);
            Ok(ConnectRequest { abandoned })
        }
    }
}

impl Drop for ConnectRequest {
    fn drop(&mut self) {
        self.abandoned.store(true, Ordering::Release);
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

impl ConnectOp {
    /// Every instance was busy, so wait for one and try again.
    unsafe extern "system" fn wait_for_instance(context: *mut c_void) -> u32 {
        let op = context.cast::<ConnectOp>();
        // SAFETY: `context` is the `ConnectOp` queued by `connect`, which
        // stays allocated until the packet posted below is dequeued. The loop
        // thread only touches `abandoned` meanwhile.
        unsafe {
            (*op).error = Win32Error::PIPE_BUSY.int().into();
            while !(*op).abandoned.load(Ordering::Acquire) {
                if win::WaitNamedPipeW((*op).name.as_ptr(), CONNECT_BUSY_WAIT_MS) == 0 {
                    (*op).error = win::last_error().int().into();
                    break;
                }
                match open_client(&(*op).name) {
                    Ok(handle) => {
                        (*op).handle = handle;
                        (*op).error = 0;
                        break;
                    }
                    // Another client took the instance first.
                    Err(err) if err == Win32Error::PIPE_BUSY => {
                        win::SwitchToThread();
                    }
                    Err(err) => {
                        (*op).error = err.int().into();
                        break;
                    }
                }
            }
            if let Some(port) = (*op).port.take() {
                port.post(&raw mut (*op).op);
            }
        }
        0
    }

    unsafe extern "C" fn complete(loop_: *mut Loop, op: *mut Op, _entry: *mut OverlappedEntry) {
        // SAFETY: `op` is the first field of the `ConnectOp` this packet was
        // posted for; the packet is what kept it allocated.
        unsafe {
            super::op_dequeued(loop_);
            (*loop_).sub_active(1);
            let this = bun_core::heap::take(op.cast::<ConnectOp>());
            let connected = this.handle != INVALID_HANDLE_VALUE && this.error == 0;
            if this.abandoned.load(Ordering::Acquire) {
                if connected {
                    win::CloseHandle(this.handle);
                }
                return;
            }
            let result = if connected {
                let fd = Fd::from_system(this.handle);
                Pipe::open_owned(loop_, fd, true).inspect_err(|_| {
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
