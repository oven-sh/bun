//! I/O sources of the Windows readers and writers. Events come from the event loop only: never inside a call, never after drop.

mod console;
mod file;
mod owners;
mod pipe;
mod pipe_server;
mod state;

use core::sync::atomic::{AtomicBool, Ordering};
use std::rc::Rc;

use bun_iocp::Port;
use bun_sys::windows::{self as w, HandleKind};
use bun_sys::{self as sys, E, Fd, MaybeOwnedFile, Tag};

use crate::Owner;
use crate::pipe_reader::ReadEvent;
use console::Console;
use file::File;
pub use owners::{finish_all_disk_writes, stop_all_for_vm_teardown};
pub use pipe::Pipe;
pub use pipe_server::{PipeConnect, PipeServer};
use state::SourceState;

pub(crate) enum Payload {
    Owned(Vec<u8>),
    Shared(Rc<dyn AsRef<[u8]>>),
}

impl Payload {
    pub(crate) fn as_bytes(&self) -> &[u8] {
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

    fn into_spare_buffer(self) -> Vec<u8> {
        match self {
            Payload::Owned(bytes) => bytes,
            Payload::Shared(_) => Vec::new(),
        }
    }
}

enum Source {
    Pipe(Pipe),
    Console(Console),
    File(File),
}

impl Source {
    fn open(
        port: &Rc<Port>,
        file: MaybeOwnedFile,
        classify: fn(Fd) -> HandleKind,
    ) -> sys::Result<Source> {
        if w::is_invalid_handle(file.fd().native()) {
            return Err(sys::Error::from_code(E::EBADF, Tag::open));
        }
        let (file, is_only_handle) = match file {
            MaybeOwnedFile::Owned(file) if file.fd().stdio_tag().is_none() => (file, true),
            // Worker threads use the handle, so a borrowed or stdio fd is duplicated to stay open for them.
            original => (sys::File::from_fd(sys::dup(original.fd())?), false),
        };
        Ok(match classify(file.fd()) {
            HandleKind::Pipe => match Pipe::open(port, file) {
                Ok(pipe) => Source::Pipe(pipe),
                Err(file) => Source::File(File::new(port, file, is_only_handle)),
            },
            HandleKind::Tty => Source::Console(Console::new(port, file)),
            _ => Source::File(File::new(port, file, is_only_handle)),
        })
    }

    fn state(&self) -> &SourceState {
        match self {
            Source::Pipe(pipe) => pipe.state(),
            Source::Console(console) => console.state(),
            Source::File(file) => file.state(),
        }
    }

    fn update_ref(&self, value: bool) {
        if !matches!(self, Source::File(_)) {
            self.state().update_ref(value);
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
    /// `offset` applies to files and devices only. `None` reads from the current file position.
    pub(crate) fn open(
        port: &Rc<Port>,
        file: MaybeOwnedFile,
        offset: Option<u64>,
    ) -> sys::Result<ReadSource> {
        static HAS_OPENED_PIPE: AtomicBool = AtomicBool::new(false);
        let source = Source::open(port, file, w::guess_handle)?;
        match (&source, offset) {
            (Source::File(file), Some(offset)) => file.set_offset(offset),
            (Source::Pipe(_), _) if HAS_OPENED_PIPE.swap(true, Ordering::Relaxed) => {
                w::named_pipe::mark_concurrent_reader();
            }
            _ => {}
        }
        Ok(ReadSource(source))
    }

    /// Reads with plain blocking calls, like a child process would.
    pub(crate) fn open_as_file(port: &Rc<Port>, file: MaybeOwnedFile) -> sys::Result<ReadSource> {
        w::named_pipe::mark_concurrent_reader();
        Source::open(port, file, |_| HandleKind::File).map(ReadSource)
    }

    /// SAFETY: `owner` stays valid for `__bun_run_io` until it is replaced or `self` is dropped.
    pub(crate) unsafe fn set_owner(&self, owner: Owner) {
        // SAFETY: caller contract. `Drop` clears the reader.
        unsafe { self.0.state().owners.set_reader(owner) };
    }

    pub(crate) fn update_ref(&self, value: bool) {
        self.0.update_ref(value);
    }

    /// Requests one event of at most `max_len` bytes.
    pub(crate) fn read(&self, max_len: usize) {
        match &self.0 {
            Source::Pipe(pipe) => pipe.read(max_len),
            Source::Console(console) => console.read(max_len),
            Source::File(file) => file.read(max_len),
        }
    }

    /// `read`, called right after handling the previous read's event.
    pub(crate) fn continue_read(&self, max_len: usize) {
        match &self.0 {
            Source::Pipe(pipe) => pipe.continue_read(max_len),
            Source::Console(_) | Source::File(_) => self.read(max_len),
        }
    }

    /// The result of a read that completes while paused is buffered for the next `read`.
    pub(crate) fn pause(&self) {
        match &self.0 {
            Source::Pipe(pipe) => pipe.pause(),
            Source::Console(console) => console.pause(),
            Source::File(file) => file.pause(),
        }
    }

    /// Completes the requested `read` if an overlapped pipe with unshared input already has data. EOF and errors are left to the loop.
    pub(crate) fn try_read(&self) -> Option<ReadEvent> {
        match &self.0 {
            Source::Pipe(pipe) => pipe.try_read(),
            Source::Console(_) | Source::File(_) => None,
        }
    }

    pub(crate) fn reuse_buffer(&self, buffer: Vec<u8>) {
        self.0.state().reuse_buffer(buffer);
    }
}

impl Drop for ReadSource {
    fn drop(&mut self) {
        self.0.state().owners.clear_reader();
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
    pub(crate) fn open(port: &Rc<Port>, file: MaybeOwnedFile) -> sys::Result<WriteSource> {
        let source = Source::open(port, file, w::guess_handle)?;
        if let Source::Console(console) = &source {
            console.enable_escape_sequences();
        }
        Ok(WriteSource(source))
    }

    pub(crate) fn is_file(&self) -> bool {
        matches!(self.0, Source::File(_))
    }

    /// SAFETY: see [`ReadSource::set_owner`].
    pub(crate) unsafe fn set_owner(&self, owner: Owner) {
        // SAFETY: caller contract. `Drop` clears the writer.
        unsafe { self.0.state().owners.set_writer(owner) };
    }

    pub(crate) fn update_ref(&self, value: bool) {
        self.0.update_ref(value);
    }

    /// On `Ok`, reports one event once all of `payload` is written or the write fails. One write at a time.
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

    /// Like `write`, but returns `buffer` and reports no event if the write completed synchronously.
    pub(crate) fn try_write(&self, buffer: Vec<u8>) -> sys::Result<Option<Vec<u8>>> {
        match &self.0 {
            Source::Pipe(pipe) => pipe.try_write(buffer),
            _ => self.write(Payload::Owned(buffer)).map(|()| None),
        }
    }

    pub(crate) fn is_console(&self) -> bool {
        matches!(self.0, Source::Console(_))
    }

    pub(crate) fn write_console_sync(&self, bytes: &[u8]) -> Option<sys::Result<()>> {
        match &self.0 {
            Source::Console(console) => Some(console.write_sync(bytes)),
            Source::Pipe(_) | Source::File(_) => None,
        }
    }

    /// A disk write completes one loop iteration later at best, which is slow while the loop is I/O-starved.
    pub(crate) fn try_take_io_budget(&self, len: usize) -> bool {
        matches!(&self.0, Source::File(file) if file.try_take_io_budget(len))
    }

    /// The write's event is still reported.
    pub(crate) fn finish_disk_write(&self) -> sys::Result<()> {
        let job = self.0.state().owners.disk_write.take();
        job.map_or(Ok(()), |job| job.run())
    }

    /// For `WriteEvent::FlushSync`.
    pub(crate) fn write_file_sync(&self, bytes: &[u8]) {
        if let Source::File(file) = &self.0 {
            let _ = file.write_sync(bytes);
        }
    }

    /// Without this, a file write still runs after the source is dropped.
    pub(crate) fn cancel_unstarted_write(&self) {
        if let Source::File(file) = &self.0 {
            file.cancel_unstarted_write();
        }
    }
}

impl Drop for WriteSource {
    fn drop(&mut self) {
        self.0.state().owners.clear_writer();
        if let Source::Pipe(pipe) = &self.0 {
            pipe.stop_writing();
        }
    }
}
