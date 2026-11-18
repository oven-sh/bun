//! What a reader or a writer works on. It reports from the loop, never from inside a call, and not once it is dropped.

mod console;
mod endpoint;
mod file;
mod owners;
mod pipe;
mod pipe_server;

use std::rc::Rc;

use bun_sys::windows::{self as w, HandleKind};
use bun_sys::{self as sys, E, Fd, Tag};
use bun_uws_sys::Loop;

use crate::Owner;
use crate::pipe_reader::ReadEvent;
use console::Console;
use endpoint::Endpoint;
use file::File;
pub use owners::{finish_writes_to_disk, stop_all_for_vm_teardown};
pub use pipe::Pipe;
pub use pipe_server::{PipeConnect, PipeServer};

pub(crate) enum Payload {
    Owned(Vec<u8>),
    Shared(Rc<dyn AsRef<[u8]>>),
}

impl Payload {
    pub(crate) fn bytes(&self) -> &[u8] {
        match self {
            Payload::Owned(bytes) => bytes,
            Payload::Shared(bytes) => (**bytes).as_ref(),
        }
    }

    fn into_vec(self) -> Vec<u8> {
        match self {
            Payload::Owned(bytes) => bytes,
            Payload::Shared(bytes) => (*bytes).as_ref().to_vec(),
        }
    }

    /// The allocation, for the next write.
    fn into_spare(self) -> Vec<u8> {
        match self {
            Payload::Owned(bytes) => bytes,
            Payload::Shared(_) => Vec::new(),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Ownership {
    /// On `Ok`.
    Taken,
    Borrowed,
}

enum Source {
    Pipe(Pipe),
    Console(Console),
    File(File),
}

impl Source {
    fn open(loop_: &Loop, fd: Fd, ownership: Ownership) -> sys::Result<Source> {
        if w::is_missing(fd.native()) {
            return Err(sys::Error::from_code(E::BADF, Tag::open));
        }
        // Other threads use it, and what they use must not be closed under them.
        let is_kept_by_caller = ownership == Ownership::Borrowed || fd.stdio_tag().is_some();
        let owned = if is_kept_by_caller { sys::dup(fd)? } else { fd };
        Ok(match w::guess_handle(owned) {
            HandleKind::Pipe if let Some(pipe) = Pipe::open(loop_, owned) => Source::Pipe(pipe),
            HandleKind::Tty => {
                Source::Console(Console::new(loop_.port(), sys::File::from_fd(owned)))
            }
            _ => Source::File(File::new(loop_.port(), owned, !is_kept_by_caller)),
        })
    }

    fn fd(&self) -> Fd {
        match self {
            Source::Pipe(pipe) => pipe.fd(),
            Source::Console(console) => console.fd(),
            Source::File(file) => file.fd(),
        }
    }

    fn endpoint(&self) -> &Endpoint {
        match self {
            Source::Pipe(pipe) => pipe.endpoint(),
            Source::Console(console) => console.endpoint(),
            Source::File(file) => file.endpoint(),
        }
    }

    fn update_ref(&self, value: bool) {
        if !matches!(self, Source::File(_)) {
            self.endpoint().update_ref(value);
        }
    }
}

pub(crate) struct ReadSource(Source);

impl From<Pipe> for ReadSource {
    fn from(pipe: Pipe) -> Self {
        ReadSource(Source::Pipe(pipe))
    }
}

impl ReadSource {
    /// `offset` is for a file on a disk, whose position is used without it.
    pub(crate) fn open(
        loop_: &Loop,
        fd: Fd,
        ownership: Ownership,
        offset: Option<u64>,
    ) -> sys::Result<ReadSource> {
        let source = Source::open(loop_, fd, ownership)?;
        if let (Source::File(file), Some(offset)) = (&source, offset) {
            file.set_offset(offset);
        }
        Ok(ReadSource(source))
    }

    pub(crate) fn fd(&self) -> Fd {
        self.0.fd()
    }

    /// SAFETY: `owner` can be passed to `__bun_run_io` until it is replaced, or `self` is dropped.
    pub(crate) unsafe fn set_owner(&self, owner: Owner) {
        // SAFETY: fn contract. `Drop` clears it.
        unsafe { self.0.endpoint().owners.set_reader(owner) };
    }

    pub(crate) fn update_ref(&self, value: bool) {
        self.0.update_ref(value);
    }

    /// One event follows, with at most `max_len` bytes.
    pub(crate) fn read(&self, max_len: usize) {
        match &self.0 {
            Source::Pipe(pipe) => pipe.read(max_len),
            Source::Console(console) => console.read(max_len),
            Source::File(file) => file.read(max_len),
        }
    }

    /// `read`, right after the event of the one before.
    pub(crate) fn read_on(&self, max_len: usize) {
        match &self.0 {
            Source::Pipe(pipe) => pipe.read_on(max_len),
            Source::Console(_) | Source::File(_) => self.read(max_len),
        }
    }

    /// What comes nevertheless is kept for the next `read`.
    pub(crate) fn pause(&self) {
        match &self.0 {
            Source::Pipe(pipe) => pipe.pause(),
            Source::Console(console) => console.pause(),
            Source::File(file) => file.pause(),
        }
    }

    /// The event of the `read` under way, if that is on an overlapped pipe of our own and has something by now. It leaves the end of the input to the loop.
    pub(crate) fn take_available(&self) -> Option<ReadEvent> {
        match &self.0 {
            Source::Pipe(pipe) => pipe.take_available(),
            Source::Console(_) | Source::File(_) => None,
        }
    }

    /// For a later read to fill.
    pub(crate) fn recycle(&self, buffer: Vec<u8>) {
        self.0.endpoint().recycle(buffer);
    }

    pub(crate) fn set_raw_mode(&self, value: bool) -> sys::Result<()> {
        let Source::Console(console) = &self.0 else {
            return Err(sys::Error::from_code(E::NOTSUP, Tag::uv_tty_set_mode).with_fd(self.fd()));
        };
        let mode = if value {
            console::Mode::Raw
        } else {
            console::Mode::Normal
        };
        console::set_mode(console.fd().native(), mode)
    }
}

impl Drop for ReadSource {
    fn drop(&mut self) {
        self.0.endpoint().owners.clear_reader();
        if let Source::Pipe(pipe) = &self.0 {
            pipe.stop_reading();
        }
    }
}

pub(crate) struct WriteSource(Source);

impl From<Pipe> for WriteSource {
    fn from(pipe: Pipe) -> Self {
        WriteSource(Source::Pipe(pipe))
    }
}

impl WriteSource {
    pub(crate) fn open(loop_: &Loop, fd: Fd, ownership: Ownership) -> sys::Result<WriteSource> {
        let source = Source::open(loop_, fd, ownership)?;
        if let Source::Console(console) = &source {
            console.enable_escape_sequences();
        }
        Ok(WriteSource(source))
    }

    pub(crate) fn is_file(&self) -> bool {
        matches!(self.0, Source::File(_))
    }

    /// SAFETY: as for [`ReadSource::set_owner`].
    pub(crate) unsafe fn set_owner(&self, owner: Owner) {
        // SAFETY: fn contract. `Drop` clears it.
        unsafe { self.0.endpoint().owners.set_writer(owner) };
    }

    pub(crate) fn update_ref(&self, value: bool) {
        self.0.update_ref(value);
    }

    /// On `Ok` one event follows, once all of it is written. One at a time.
    pub(crate) fn write(&self, payload: Payload) -> sys::Result<()> {
        match &self.0 {
            Source::Pipe(pipe) => pipe.write(payload),
            Source::Console(console) => console.write(payload),
            Source::File(file) => {
                file.write(payload.into_vec());
                Ok(())
            }
        }
    }

    /// `write`, but no event follows if `buffer` comes back: it is written.
    pub(crate) fn write_now(&self, buffer: Vec<u8>) -> sys::Result<Option<Vec<u8>>> {
        match &self.0 {
            Source::Pipe(pipe) => pipe.write_now(buffer),
            _ => self.write(Payload::Owned(buffer)).map(|()| None),
        }
    }

    pub(crate) fn is_console(&self) -> bool {
        matches!(self.0, Source::Console(_))
    }

    /// No event follows.
    pub(crate) fn write_to_console(&self, bytes: &[u8]) -> Option<sys::Result<()>> {
        match &self.0 {
            Source::Console(console) => Some(console.write_now(bytes)),
            Source::Pipe(_) | Source::File(_) => None,
        }
    }

    /// For `WriteEvent::WriteRestNow`.
    pub(crate) fn write_rest(&self, bytes: &[u8]) {
        if let Source::File(file) = &self.0 {
            let _ = file.write_blocking(bytes);
        }
    }

    /// A write to a file goes on after the drop otherwise.
    pub(crate) fn cancel_write_unless_started(&self) {
        if let Source::File(file) = &self.0 {
            file.cancel_write_unless_started();
        }
    }
}

impl Drop for WriteSource {
    fn drop(&mut self) {
        self.0.endpoint().owners.clear_writer();
        if let Source::Pipe(pipe) = &self.0 {
            pipe.stop_writing();
        }
    }
}
