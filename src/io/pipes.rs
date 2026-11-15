#[cfg(not(windows))]
use core::ffi::c_void;

#[cfg(not(windows))]
use bun_sys::{Fd, FdExt};

#[cfg(target_os = "macos")]
use crate::FilePollFlag;
#[cfg(not(windows))]
use crate::{EventLoopHandle, FilePollRef, OwnedFilePoll, Owner};

/// Dropping it releases the poll. The fd stays open.
#[cfg(not(windows))]
pub enum PollOrFd {
    /// Forced: the kernel keeps a fired poll for as long as the file is open.
    Poll(OwnedFilePoll<true>),
    Fd(Fd),
    Closed,
}

#[cfg(not(windows))]
impl PollOrFd {
    pub(crate) fn tag_name(&self) -> &'static str {
        match self {
            PollOrFd::Poll(_) => "poll",
            PollOrFd::Fd(_) => "fd",
            PollOrFd::Closed => "closed",
        }
    }

    pub(crate) fn set_owner(&mut self, owner: Owner) {
        if let PollOrFd::Poll(poll) = self {
            poll.owner = owner;
        }
    }

    pub(crate) fn get_fd(&self) -> Fd {
        match self {
            PollOrFd::Closed => Fd::INVALID,
            PollOrFd::Fd(fd) => *fd,
            PollOrFd::Poll(poll) => poll.fd,
        }
    }

    pub fn get_poll(&self) -> Option<FilePollRef<'_>> {
        match self {
            PollOrFd::Poll(poll) => Some(poll.poll_ref()),
            _ => None,
        }
    }

    pub(crate) fn set_poll(&mut self, ev: EventLoopHandle, fd: Fd, owner: Owner) {
        *self = PollOrFd::Poll(OwnedFilePoll::new(ev, fd, owner));
    }

    pub(crate) fn close_impl<F>(
        &mut self,
        ctx: Option<*mut c_void>,
        on_close_fn: Option<F>,
        close_fd: bool,
    ) where
        F: FnOnce(*mut c_void),
    {
        let fd = self.get_fd();
        #[cfg(target_os = "macos")]
        let mut close_async = true;
        #[cfg(not(target_os = "macos"))]
        let close_async = true;
        #[cfg(target_os = "macos")]
        if let PollOrFd::Poll(poll) = self {
            // workaround kqueue bug.
            // 1) non-blocking FIFO
            // 2) open for writing only = fd 2, nonblock
            // 3) open for reading only = fd 3, nonblock
            // 4) write(3, "something") = 9
            // 5) read(2, buf, 9) = 9
            // 6) read(2, buf, 9) = -1 (EAGAIN)
            // 7) ON ANOTHER THREAD: close(3) = 0,
            // 8) kevent(2, EVFILT_READ, EV_ADD | EV_ENABLE | EV_DISPATCH, 0, 0, 0) = 0
            // 9) ??? No more events for fd 2
            close_async = !(poll.flags.contains(FilePollFlag::PollWritable)
                && poll.flags.contains(FilePollFlag::Nonblocking));
        }
        *self = PollOrFd::Closed;

        if fd != Fd::INVALID {
            if close_async && close_fd {
                crate::closer::Closer::close(fd, ());
            } else if close_fd {
                let _ = fd.close_allowing_bad_file_descriptor(None);
            }
            if let Some(f) = on_close_fn {
                // SAFETY: caller guarantees ctx is Some and properly aligned
                // for the callback's expected pointee type.
                f(ctx.expect("ctx must be Some when on_close_fn is provided"));
            }
        }
    }

    pub(crate) fn close<F>(&mut self, ctx: Option<*mut c_void>, on_close_fn: Option<F>)
    where
        F: FnOnce(*mut c_void),
    {
        self.close_impl(ctx, on_close_fn, true);
    }
}

// Sunk to `bun_io` so `FilePoll::file_type()` needs no aio→io edge; re-export
// keeps the historical `bun_io::FileType` / `bun_io::pipes::FileType` paths.
pub use crate::posix_event_loop::FileType;

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ReadState {
    /// The most common scenario
    /// Neither EOF nor EAGAIN
    Progress,

    /// Received a 0-byte read, or the reader's limit or byte budget is used up: nothing more will be read
    Eof,

    /// Received an EAGAIN
    Drained,
}

/// One delivery from a `BufferedReader`. The variant says who owns the bytes, so a consumer never has to work that out from the pointer.
pub enum Chunk<'a> {
    /// The loop's shared scratch: gone once `on_read_chunk` returns. Copy what you keep.
    Scratch(&'a [u8]),
    /// The reader's own buffer, which it clears and reuses after the call. Copy what you keep, or `take()` it when moving beats copying.
    Buffer(&'a mut Vec<u8>),
    /// The reader is finished with these bytes (EOF, limit, error, budget): yours to move.
    Owned(Vec<u8>),
}

impl Chunk<'_> {
    /// The bytes as an owned `Vec`, moving rather than copying where the variant allows.
    pub fn take(self) -> Vec<u8> {
        match self {
            Chunk::Scratch(bytes) => bytes.to_vec(),
            Chunk::Buffer(buffer) => core::mem::take(buffer),
            Chunk::Owned(buffer) => buffer,
        }
    }

    pub fn is_owned(&self) -> bool {
        matches!(self, Chunk::Owned(_))
    }
}

impl core::ops::Deref for Chunk<'_> {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        match self {
            Chunk::Scratch(bytes) => bytes,
            Chunk::Buffer(buffer) => buffer,
            Chunk::Owned(buffer) => buffer,
        }
    }
}
