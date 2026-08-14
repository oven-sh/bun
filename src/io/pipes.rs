use core::ffi::c_void;

use bun_sys::Fd;
#[cfg(not(windows))]
use bun_sys::FdExt;

#[cfg(target_os = "macos")]
use crate::FilePollFlag;
use crate::{FilePollRef, Owner};

pub enum PollOrFd {
    Poll(FilePollRef),
    Fd(Fd),
    Closed,
}

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
            poll.set_owner(owner);
        }
    }

    pub(crate) fn get_fd(&self) -> Fd {
        match self {
            PollOrFd::Closed => Fd::INVALID,
            PollOrFd::Fd(fd) => *fd,
            PollOrFd::Poll(poll) => poll.fd(),
        }
    }

    pub fn get_poll(&self) -> Option<FilePollRef> {
        match self {
            PollOrFd::Poll(poll) => Some(*poll),
            _ => None,
        }
    }

    pub(crate) fn get_poll_mut(&mut self) -> Option<FilePollRef> {
        match self {
            PollOrFd::Poll(poll) => Some(*poll),
            _ => None,
        }
    }

    pub fn close_impl<F>(
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
        #[cfg(all(not(target_os = "macos"), not(windows)))]
        let close_async = true;
        if matches!(self, PollOrFd::Poll(_)) {
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
            // Take ownership of the Box before
            // calling deinit_force_unregister, then leave self = Closed.
            let old = core::mem::replace(self, PollOrFd::Closed);
            if let PollOrFd::Poll(poll) = old {
                #[cfg(target_os = "macos")]
                {
                    if poll.has_flag(FilePollFlag::PollWritable)
                        && poll.has_flag(FilePollFlag::Nonblocking)
                    {
                        close_async = false;
                    }
                }
                // Consumes the underlying allocation.
                poll.deinit_force_unregister();
            }
        }

        if fd != Fd::INVALID {
            *self = PollOrFd::Closed;

            // TODO: We should make this call compatible using bun.FD
            #[cfg(windows)]
            {
                if close_fd {
                    crate::closer::Closer::close(fd, bun_sys::windows::libuv::Loop::get());
                }
            }
            #[cfg(not(windows))]
            {
                if close_async && close_fd {
                    crate::closer::Closer::close(fd, ());
                } else {
                    if close_fd {
                        let _ = fd.close_allowing_bad_file_descriptor(None);
                    }
                }
            }
            if let Some(f) = on_close_fn {
                // SAFETY: caller guarantees ctx is Some and properly aligned
                // for the callback's expected pointee type.
                f(ctx.expect("ctx must be Some when on_close_fn is provided"));
            }
        } else {
            *self = PollOrFd::Closed;
        }
    }

    pub(crate) fn close<F>(&mut self, ctx: Option<*mut c_void>, on_close_fn: Option<F>)
    where
        F: FnOnce(*mut c_void),
    {
        self.close_impl(ctx, on_close_fn, true);
    }

    /// Releases the poll (unregistering it) and leaves the fd open: for owners
    /// that close the fd themselves.
    pub fn close_without_closing_fd(&mut self) {
        self.close_impl(None, None::<fn(*mut c_void)>, false);
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
