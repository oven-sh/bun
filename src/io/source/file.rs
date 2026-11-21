use core::cell::Cell;
use core::sync::atomic::{AtomicBool, Ordering};
use std::rc::Rc;
use std::sync::{Arc, OnceLock};

use bun_iocp::blocking::{self, Cancel};
use bun_iocp::{Port, Request};
use bun_ptr::{CellExt as _, OptionCellExt as _};
use bun_sys::windows::{self as w, NTSTATUS, Win32Error, named_pipe};
use bun_sys::{self as sys, E, Fd, FdExt as _, Tag};
use bun_threading::Guarded;
use bun_threading::work_pool::FilePool;

use super::endpoint::{Endpoint, HasEndpoint};
use crate::Closer;
use crate::pipe_reader::ReadEvent;
use crate::pipe_writer::WriteEvent;

struct OwnedFd {
    fd: Fd,
    /// Closing the last one of a file that was written to can take a while.
    is_only_handle: bool,
}

impl Drop for OwnedFd {
    fn drop(&mut self) {
        match self.is_only_handle {
            true => Closer::close(sys::File::from_fd(self.fd)),
            false => self.fd.close(),
        }
    }
}

/// For the first thread that gets to it.
pub(super) struct Write {
    fd: Arc<OwnedFd>,
    is_cancelled: AtomicBool,
    result: OnceLock<sys::Result<()>>,
    /// Locked while they are written.
    bytes: Guarded<Vec<u8>>,
}

impl Write {
    /// Waits for a thread that was there before.
    pub(super) fn run(&self) -> sys::Result<()> {
        let bytes = self.bytes.lock();
        let write = || match self.is_cancelled.load(Ordering::SeqCst) {
            true => Err(sys::Error::from_code(E::ECANCELED, Tag::write)),
            false => sys::File::borrow(&self.fd.fd).write_all(&bytes),
        };
        self.result.get_or_init(write).clone()
    }
}

/// Read and written by other threads.
pub(crate) struct File(Rc<Inner>);

struct Inner {
    endpoint: Endpoint,
    fd: Arc<OwnedFd>,
    /// Otherwise a device, which takes as long as it likes.
    is_on_disk: bool,
    /// `None` is the position of the file.
    offset: Cell<Option<u64>>,
    read: Cell<Option<(Request, Option<Cancel>)>>,
    write: Cell<Option<(Request, Arc<Write>)>>,
}

impl File {
    pub(super) fn new(port: &Rc<Port>, file: sys::File, is_only_handle: bool) -> File {
        let (fd, endpoint) = (file.into_raw(), Endpoint::new(port));
        endpoint.expect_much();
        File(Rc::new(Inner {
            endpoint,
            fd: Arc::new(OwnedFd { fd, is_only_handle }),
            is_on_disk: w::GetFileType(fd.native()) == w::FILE_TYPE_DISK,
            offset: Cell::new(None),
            read: Cell::new(None),
            write: Cell::new(None),
        }))
    }

    pub(super) fn endpoint(&self) -> &Endpoint {
        &self.0.endpoint
    }

    pub(super) fn set_offset(&self, offset: u64) {
        self.0.offset.set(Some(offset));
    }

    pub(super) fn read(&self, max_len: usize) {
        self.0.endpoint.set_wanted(Some(max_len));
        self.0.continue_reading();
    }

    pub(super) fn pause(&self) {
        self.0.endpoint.set_wanted(None);
    }

    pub(super) fn write(&self, buffer: Vec<u8>) {
        // It goes on after `self` is dropped, and keeps the loop running.
        let this = Rc::clone(&self.0);
        let done = move |(buffer, result): (Vec<u8>, sys::Result<()>)| {
            this.write.take();
            this.endpoint.owners.disk_write.take();
            this.report_write(match result {
                Ok(()) => WriteEvent::Wrote(buffer),
                Err(err) => WriteEvent::Failed(err),
            });
        };
        let (request, remote) = Request::remote(&self.0.endpoint.port, done);
        let write = Arc::new(Write {
            fd: Arc::clone(&self.0.fd),
            is_cancelled: AtomicBool::new(false),
            result: OnceLock::new(),
            bytes: Guarded::new(buffer),
        });
        let (job, pending) = (Arc::clone(&write), self.0.endpoint.port.pending_write());
        self.0.run(move || {
            let result = job.run();
            drop(pending);
            let buffer = core::mem::take(&mut *job.bytes.lock());
            drop(job);
            remote.complete((buffer, result));
        });
        let disk_write = self.0.is_on_disk.then(|| Arc::clone(&write));
        self.0.endpoint.owners.disk_write.set(disk_write);
        self.0.write.set(Some((request, write)));
        self.0.endpoint.set_writing(true);
    }

    pub(super) fn write_blocking(&self, bytes: &[u8]) -> sys::Result<()> {
        sys::File::borrow(&self.0.fd.fd).write_all(bytes)
    }

    pub(super) fn cancel_write_unless_started(&self) {
        self.0.write.with_taken(|write| {
            if let Some((_, write)) = write {
                write.is_cancelled.store(true, Ordering::SeqCst);
            }
        });
    }
}

impl Drop for File {
    fn drop(&mut self) {
        self.pause();
        match self.0.read.take() {
            Some((_, Some(thread))) if self.0.is_on_disk => thread.cancel_unless_started(),
            Some((_, Some(thread))) => thread.cancel(),
            Some((_, None)) | None => {}
        }
    }
}

impl HasEndpoint for Inner {
    fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }
}

impl Inner {
    fn run(&self, job: impl FnOnce() + Send + 'static) {
        match self.is_on_disk {
            true => FilePool::go(job),
            false => blocking::spawn(job),
        }
    }

    fn continue_reading(self: &Rc<Self>) {
        let Some(max_len) = self.endpoint.wanted() else {
            return;
        };
        if self.read.is_some() {
            return;
        }
        let this = Rc::downgrade(self);
        if self.endpoint.is_holding() {
            let report = Request::defer(&self.endpoint.port, move || {
                let Some(this) = this.upgrade() else { return };
                this.read.take();
                this.report_read();
            });
            return self.read.set(Some((report, None)));
        }
        let (request, remote) = Request::remote(&self.endpoint.port, move |event: ReadEvent| {
            let Some(this) = this.upgrade() else { return };
            this.read.take();
            if let ReadEvent::Data(data) = &event {
                this.offset
                    .update(|offset| Some(offset? + data.len() as u64));
            }
            this.endpoint.hold(event);
            this.report_read();
        });
        let (fd, cancel) = (Arc::clone(&self.fd), Cancel::default());
        let (buffer, offset) = (self.endpoint.buffer(max_len), self.offset.get());
        let (thread, is_on_disk) = (cancel.clone(), self.is_on_disk);
        self.run(move || {
            let event = match is_on_disk {
                true => (!cancel.is_cancelled()).then(|| read_disk(fd.fd, buffer, max_len, offset)),
                false => cancel.run(|| read_device(fd.fd, buffer, max_len, &cancel)),
            };
            drop(fd);
            remote.complete(event.unwrap_or(ReadEvent::Eof));
        });
        self.read.set(Some((request, Some(thread))));
    }
}

fn read_disk(fd: Fd, mut buffer: Vec<u8>, max_len: usize, offset: Option<u64>) -> ReadEvent {
    let read = bun_core::vec::append_with(&mut buffer, max_len, |cursor| match offset {
        Some(offset) => sys::pread_buf(fd, cursor, offset as i64),
        None => sys::read_buf(fd, cursor),
    });
    match read {
        Ok(0) => ReadEvent::Eof,
        Ok(_) => ReadEvent::Data(buffer),
        Err(err) => ReadEvent::Err(sys::Error::from_code(err.get_errno(), Tag::read)),
    }
}

fn read_device(fd: Fd, mut buffer: Vec<u8>, max_len: usize, cancel: &Cancel) -> ReadEvent {
    loop {
        match named_pipe::read(fd.native(), &mut buffer, max_len) {
            Ok(_) if !buffer.is_empty() => return ReadEvent::Data(buffer),
            // Ctrl+C on a console.
            Ok(NTSTATUS::ALERTED) if !cancel.is_cancelled() => {}
            Ok(_) | Err(NTSTATUS::END_OF_FILE | NTSTATUS::PIPE_BROKEN) => return ReadEvent::Eof,
            Err(NTSTATUS::ACCESS_DENIED) => {
                return ReadEvent::Err(sys::Error::from_code(E::EBADF, Tag::read));
            }
            Err(status) => {
                let err = Win32Error::from_ntstatus(status);
                return ReadEvent::Err(sys::Error::from_win32(err, Tag::read));
            }
        }
    }
}
