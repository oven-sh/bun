#[cfg(not(windows))]
use core::cell::Cell;

#[cfg(not(windows))]
use bun_ptr::{CellExt as _, OptionCellExt as _};
#[cfg(not(windows))]
use bun_sys::{self as sys, Fd, MaybeOwnedFile};

#[cfg(not(windows))]
use crate::posix_event_loop::OneShotFlag;
#[cfg(not(windows))]
use crate::{EventLoopHandle, FilePoll, FilePollFlag, OwnedFilePoll, Owner};

/// An fd, and its poll once it is waited on.
#[cfg(not(windows))]
pub(crate) struct PipeHandle {
    /// `INVALID` when closed.
    file: Cell<MaybeOwnedFile>,
    /// Forced: the kernel keeps a fired poll for as long as the file is open.
    poll: Cell<Option<OwnedFilePoll<true>>>,
    owner: Cell<Owner>,
}

#[cfg(not(windows))]
impl PipeHandle {
    pub(crate) const fn closed() -> Self {
        Self {
            file: Cell::new(MaybeOwnedFile::INVALID),
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

    pub(crate) fn owner(&self) -> Owner {
        self.owner.get()
    }

    pub(crate) fn get_fd(&self) -> Fd {
        self.file.with_taken(|file| file.fd())
    }

    pub(crate) fn owns_file(&self) -> bool {
        self.file.with_taken(|file| file.is_owned())
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.get_fd() == Fd::INVALID
    }

    pub(crate) fn has_poll(&self) -> bool {
        self.poll.is_some()
    }

    pub(crate) fn is_watching(&self) -> bool {
        self.with_poll(FilePoll::is_watching) == Some(true)
    }

    /// Does nothing without a poll.
    pub(crate) fn set_poll_flag(&self, flag: FilePollFlag) {
        self.with_poll(|poll| poll.set_flag(flag));
    }

    pub(crate) fn set_file(&self, file: MaybeOwnedFile) {
        self.close();
        self.file.set(file);
    }

    /// Releases the poll.
    pub(crate) fn take_file(&self) -> MaybeOwnedFile {
        self.poll.set(None);
        self.file.take()
    }

    pub(crate) fn add_poll(&self, ev: EventLoopHandle) {
        // SAFETY: `set_owner`'s contract. Nothing is dispatched to `Owner::NULL`.
        let poll = unsafe { OwnedFilePoll::new(ev, self.get_fd(), self.owner.get()) };
        self.poll.set(Some(poll));
    }

    /// Leaves `other` closed. Both keep their owner.
    pub(crate) fn take_from(&self, other: &PipeHandle) {
        self.set_file(other.file.take());
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
    pub(crate) fn close(&self) -> bool {
        #[cfg(not(target_os = "macos"))]
        let close_async = true;
        // kqueue misses the EOF of a non-blocking FIFO whose write end closes on another thread just before the read end is re-armed.
        #[cfg(target_os = "macos")]
        let close_async = self.with_poll(|poll| {
            poll.has_flag(FilePollFlag::PollWritable) && poll.has_flag(FilePollFlag::Nonblocking)
        }) != Some(true);
        match self.take_file() {
            MaybeOwnedFile::Owned(file) if close_async => crate::closer::Closer::close(file, ()),
            MaybeOwnedFile::Owned(file) => drop(file),
            MaybeOwnedFile::Borrowed(fd) => return fd != Fd::INVALID,
        }
        true
    }

    /// A borrowed fd keeps its poll, to be used again.
    pub(crate) fn close_if_owned(&self) {
        if self.owns_file() {
            self.close();
        }
    }
}

#[cfg(not(windows))]
impl Drop for PipeHandle {
    fn drop(&mut self) {
        self.close();
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
