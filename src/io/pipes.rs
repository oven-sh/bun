#[cfg(not(windows))]
use core::cell::Cell;

#[cfg(not(windows))]
use bun_ptr::{CellExt as _, OptionCellExt as _};
#[cfg(not(windows))]
use bun_sys::{self as sys, Fd, FdExt};

#[cfg(not(windows))]
use crate::posix_event_loop::OneShotFlag;
#[cfg(not(windows))]
use crate::{EventLoopHandle, FilePoll, FilePollFlag, OwnedFilePoll, Owner};

/// An fd, and its poll once it is waited on. Dropping it releases the poll. The fd stays open.
#[cfg(not(windows))]
pub struct PipeHandle {
    /// `INVALID` when closed.
    fd: Cell<Fd>,
    /// Forced: the kernel keeps a fired poll for as long as the file is open.
    poll: Cell<Option<OwnedFilePoll<true>>>,
    owner: Cell<Owner>,
}

#[cfg(not(windows))]
impl PipeHandle {
    pub(crate) const fn closed() -> Self {
        Self {
            fd: Cell::new(Fd::INVALID),
            poll: Cell::new(None),
            owner: Cell::new(Owner::NULL),
        }
    }

    /// `None` without a poll. The cell is empty while `f` runs.
    pub(crate) fn with_poll<R>(&self, f: impl FnOnce(&FilePoll) -> R) -> Option<R> {
        self.poll.with_taken(|poll| poll.as_deref().map(f))
    }

    /// # Safety
    /// `owner.ptr` points to a live value of the type `__bun_run_io` casts `owner.tag` to, until `self`
    /// is dropped or has another owner.
    pub(crate) unsafe fn set_owner(&self, owner: Owner) {
        self.owner.set(owner);
        // SAFETY: caller contract. The poll leaves `self` by `take_from` alone, which replaces its owner.
        self.with_poll(|poll| unsafe { poll.set_owner(owner) });
    }

    pub(crate) fn get_fd(&self) -> Fd {
        self.fd.get()
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.get_fd() == Fd::INVALID
    }

    pub fn has_poll(&self) -> bool {
        self.poll.is_some()
    }

    pub fn is_registered(&self) -> bool {
        self.with_poll(FilePoll::is_registered) == Some(true)
    }

    pub fn is_watching(&self) -> bool {
        self.with_poll(FilePoll::is_watching) == Some(true)
    }

    /// Does nothing without a poll.
    pub fn set_poll_flag(&self, flag: FilePollFlag) {
        self.with_poll(|poll| poll.set_flag(flag));
    }

    /// Releases the poll. The fd that `fd` replaces stays open.
    pub fn set_fd(&self, fd: Fd) {
        self.poll.set(None);
        self.fd.set(fd);
    }

    pub(crate) fn set_poll(&self, ev: EventLoopHandle, fd: Fd) {
        // SAFETY: `set_owner`'s contract. Nothing is dispatched to `Owner::NULL`.
        let poll = unsafe { OwnedFilePoll::new(ev, fd, self.owner.get()) };
        self.poll.set(Some(poll));
        self.fd.set(fd);
    }

    /// Leaves `other` closed. Both keep their owner.
    pub(crate) fn take_from(&self, other: &PipeHandle) {
        self.fd.set(other.fd.replace(Fd::INVALID));
        self.poll.set(other.poll.take());
        // SAFETY: `set_owner`'s contract.
        self.with_poll(|poll| unsafe { poll.set_owner(self.owner.get()) });
    }

    /// Asks for one event. Does nothing without a poll.
    pub(crate) fn register(&self, flag: FilePollFlag) -> sys::Result<()> {
        self.with_poll(|poll| poll.register_with(flag, OneShotFlag::Dispatch))
            .unwrap_or(Ok(()))
    }

    /// `false` if it was closed already.
    pub(crate) fn close_impl(&self, close_fd: bool) -> bool {
        let fd = self.get_fd();
        #[cfg(not(target_os = "macos"))]
        let close_async = true;
        // kqueue misses the EOF of a non-blocking FIFO whose write end closes on another thread just before the read end is re-armed.
        #[cfg(target_os = "macos")]
        let close_async = self.with_poll(|poll| {
            poll.has_flag(FilePollFlag::PollWritable) && poll.has_flag(FilePollFlag::Nonblocking)
        }) != Some(true);
        self.set_fd(Fd::INVALID);

        if fd == Fd::INVALID {
            return false;
        }
        if close_async && close_fd {
            crate::closer::Closer::close(fd, ());
        } else if close_fd {
            let _ = fd.close_allowing_bad_file_descriptor(None);
        }
        true
    }

    pub(crate) fn close(&self) -> bool {
        self.close_impl(true)
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
    /// The loop's shared scratch: gone once the closure returns. Copy what you keep.
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
