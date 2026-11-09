//! `us_poll_t` of the Windows backend (internal/eventing/iocp.h) as a field of a Rust object; see `Bun__internal_dispatch_ready_poll`.

use core::ffi::{c_int, c_void};
use core::ptr;

use bun_windows_sys::Win32Error;

use crate::Loop;

pub const READABLE: c_int = 1;
pub const WRITABLE: c_int = 2;

/// `POLL_TYPE_FILE_POLL` (`internal/internal.h`).
const POLL_TYPE_FILE_POLL: u8 = 5;

/// `LIBUS_POLL_KIND_*`: what the handle is, which decides how the loop learns that it is ready.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Kind {
    Socket = 0,
    /// A kernel object a thread could wait on (process, event, console input). Readable while signaled.
    Waitable = 1,
    /// An end of a pipe that Bun created or opened: overlapped, and in nobody else's hands.
    Pipe = 2,
    /// A pipe end from outside: it can be synchronous, and other processes can be using it.
    ForeignPipe = 4,
}

/// The loop keeps the address from the first `set_events`, `read` or `write` until `detach` or `close`.
#[repr(C)]
pub struct Poll {
    handle: usize,
    req: *mut c_void,
    poll_type: u8,
    kind: Kind,
}

const _: () = assert!(size_of::<Poll>() == 24 && core::mem::offset_of!(Poll, kind) == 17);

impl Poll {
    pub fn init(handle: *mut c_void, kind: Kind) -> Poll {
        Poll {
            handle: handle as usize,
            req: ptr::null_mut(),
            poll_type: POLL_TYPE_FILE_POLL,
            kind,
        }
    }

    #[inline]
    pub fn handle(&self) -> *mut c_void {
        self.handle as *mut c_void
    }

    #[inline]
    pub fn kind(&self) -> Kind {
        self.kind
    }

    #[inline]
    pub fn is_pipe(&self) -> bool {
        matches!(self.kind, Kind::Pipe | Kind::ForeignPipe)
    }

    fn result(rc: c_int) -> Result<usize, Win32Error> {
        if rc < 0 {
            Err(Win32Error::get())
        } else {
            Ok(rc as usize)
        }
    }

    /// Which of [`READABLE`] and [`WRITABLE`] to report, while they hold. None is fine.
    pub fn set_events(&mut self, loop_: &Loop, events: c_int) -> Result<(), Win32Error> {
        // SAFETY: `self` stays where it is until `detach`/`close` (type contract); `loop_` is live.
        Self::result(unsafe { us_poll_change(self, loop_, events) }).map(|_| ())
    }

    /// [`Kind::Waitable`], after `set_events`: the loop sets `event` once it has nothing left to run, if [`READABLE`] is still wanted.
    pub fn set_event_on_wait(&mut self, event: *mut c_void) {
        debug_assert!(self.kind == Kind::Waitable && !self.req.is_null());
        // SAFETY: `self` is a poll that was started, and `event` outlives its request block (caller).
        unsafe { us_internal_poll_set_event_on_wait(self, event) }
    }

    /// Reports nothing from here on. A pipe keeps what was written and has not left yet.
    pub fn stop(&mut self, loop_: &Loop) {
        // SAFETY: as in `set_events`.
        unsafe { us_poll_stop(self, loop_) }
    }

    /// Lets go of everything the loop holds for this poll. The handle stays open.
    pub fn detach(&mut self) {
        // SAFETY: `self` is a valid poll.
        unsafe { us_internal_poll_detach(self) }
    }

    /// [`Poll::detach`], and closes the handle. A write that was answered with `WSAEWOULDBLOCK` is cancelled.
    pub fn close(&mut self) {
        if !self.is_pipe() {
            self.detach();
        }
        // SAFETY: `self` is a valid poll.
        unsafe { us_internal_poll_close_fd(self) }
    }

    /// Pipes only, as a non-blocking `recv`: 0 is the end of the stream, `WSAEWOULDBLOCK` says to wait for [`READABLE`].
    pub fn read(&mut self, loop_: &Loop, buf: &mut [u8]) -> Result<usize, Win32Error> {
        debug_assert!(self.is_pipe());
        let len = buf.len().min(c_int::MAX as usize) as c_int;
        // SAFETY: as in `set_events`; `buf` is writable for `len` bytes.
        Self::result(unsafe { us_internal_pipe_read(loop_, self, buf.as_mut_ptr().cast(), len) })
    }

    /// Pipes only, as a non-blocking `send`, but after `WSAEWOULDBLOCK` the bytes are on their way: a write that begins with other bytes fails.
    pub fn write(&mut self, loop_: &Loop, buf: &[u8]) -> Result<usize, Win32Error> {
        debug_assert!(self.is_pipe());
        let len = buf.len().min(c_int::MAX as usize) as c_int;
        // SAFETY: as in `set_events`; `buf` is readable for `len` bytes.
        Self::result(unsafe { us_internal_pipe_write(loop_, self, buf.as_ptr().cast(), len) })
    }

    /// The bytes that [`Poll::write`] answered `WSAEWOULDBLOCK` for will not be offered again. The peer gets them all the same.
    pub fn disown_write(&mut self) {
        // SAFETY: `self` is a valid poll.
        unsafe { us_internal_pipe_disown_write(self) }
    }
}

unsafe extern "C" {
    fn us_poll_change(p: *mut Poll, loop_: *const Loop, events: c_int) -> c_int;
    fn us_poll_stop(p: *mut Poll, loop_: *const Loop);
    fn us_internal_poll_detach(p: *mut Poll);
    fn us_internal_poll_set_event_on_wait(p: *mut Poll, event: *mut c_void);
    fn us_internal_poll_close_fd(p: *mut Poll);
    fn us_internal_pipe_read(
        loop_: *const Loop,
        p: *mut Poll,
        buffer: *mut c_void,
        length: c_int,
    ) -> c_int;
    fn us_internal_pipe_write(
        loop_: *const Loop,
        p: *mut Poll,
        buffer: *const c_void,
        length: c_int,
    ) -> c_int;
    fn us_internal_pipe_disown_write(p: *mut Poll);
}
