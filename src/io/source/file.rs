use core::cell::Cell;
use core::sync::atomic::{AtomicBool, Ordering};
use std::rc::Rc;
use std::sync::{Arc, OnceLock};

use bun_iocp::blocking::{self, CancelToken};
use bun_iocp::{PendingClose, Port, Request};
use bun_ptr::{CellExt as _, OptionCellExt as _};
use bun_sys::windows::{self as w, NTSTATUS, Win32Error, named_pipe};
use bun_sys::{self as sys, E, Fd, FdExt as _, Tag};
use bun_threading::Guarded;
use bun_threading::work_pool::FilePool;

use super::state::{HasSourceState, LARGE_READ_SIZE, SourceState};
use crate::Closer;
use crate::pipe_reader::ReadEvent;
use crate::pipe_writer::WriteEvent;

struct OwnedFd {
    fd: Fd,
    /// Closing the last handle to a file that was written can be slow.
    is_only_handle: bool,
    pending_close: OnceLock<PendingClose>,
}

impl Drop for OwnedFd {
    fn drop(&mut self) {
        if self.is_only_handle {
            Closer::close_pending(sys::File::from_fd(self.fd), self.pending_close.take());
        } else {
            self.fd.close();
        }
    }
}

/// Performed by the first thread that calls `run`.
pub(super) struct WriteJob {
    fd: Arc<OwnedFd>,
    is_cancelled: AtomicBool,
    result: OnceLock<sys::Result<()>>,
    /// Locked for the duration of the write.
    bytes: Guarded<Vec<u8>>,
}

impl WriteJob {
    /// If another thread got here first, waits for it and returns its result.
    pub(super) fn run(&self) -> sys::Result<()> {
        let bytes = self.bytes.lock();
        let write = || {
            if self.is_cancelled.load(Ordering::SeqCst) {
                Err(sys::Error::from_code(E::ECANCELED, Tag::write))
            } else {
                sys::File::borrow(&self.fd.fd).write_all(&bytes)
            }
        };
        self.result.get_or_init(write).clone()
    }
}

/// A file or device, read and written on worker threads.
pub(crate) struct File(Rc<Inner>);

struct Inner {
    state: SourceState,
    fd: Arc<OwnedFd>,
    /// `false` for a device, whose I/O can block indefinitely.
    is_on_disk: bool,
    /// `None` uses the current file position.
    offset: Cell<Option<u64>>,
    /// Length and loop iteration of the last read, if it was a disk read that filled its buffer.
    last_full_read: Cell<Option<(usize, u64)>>,
    inflight_read: Cell<Option<(Request, Option<CancelToken>)>>,
    inflight_write: Cell<Option<(Request, Arc<WriteJob>)>>,
    is_last_write_slow: Cell<bool>,
}

impl File {
    pub(super) fn new(port: &Rc<Port>, file: sys::File, is_only_handle: bool) -> File {
        let fd = file.into_raw();
        let state = SourceState::new(port);
        state.use_large_buffer();
        File(Rc::new(Inner {
            state,
            fd: Arc::new(OwnedFd {
                fd,
                is_only_handle,
                pending_close: OnceLock::new(),
            }),
            is_on_disk: w::GetFileType(fd.native()) == w::FILE_TYPE_DISK,
            offset: Cell::new(None),
            last_full_read: Cell::new(None),
            inflight_read: Cell::new(None),
            inflight_write: Cell::new(None),
            is_last_write_slow: Cell::new(false),
        }))
    }

    pub(super) fn state(&self) -> &SourceState {
        &self.0.state
    }

    pub(super) fn set_offset(&self, offset: u64) {
        self.0.offset.set(Some(offset));
    }

    pub(super) fn read(&self, max_len: usize) {
        self.0.state.set_read_limit(Some(max_len));
        self.0.maybe_start_read();
    }

    pub(super) fn pause(&self) {
        self.0.state.set_read_limit(None);
    }

    pub(super) fn write(&self, buffer: Vec<u8>) {
        // A strong reference: the write outlives `self` and keeps the loop alive.
        let this = Rc::clone(&self.0);
        let start_iteration = self.0.state.port.iteration();
        let callback = move |(buffer, result): (Vec<u8>, sys::Result<()>)| {
            this.inflight_write.take();
            this.is_last_write_slow
                .set(this.state.port.iteration() - start_iteration > 1);
            this.state.owners.disk_write.take();
            this.report_write(match result {
                Ok(()) => WriteEvent::Wrote(buffer),
                Err(err) => WriteEvent::Err(err),
            });
        };
        let (request, completer) = Request::with_completer(&self.0.state.port, callback);
        let job = Arc::new(WriteJob {
            fd: Arc::clone(&self.0.fd),
            is_cancelled: AtomicBool::new(false),
            result: OnceLock::new(),
            bytes: Guarded::new(buffer),
        });
        let worker_job = Arc::clone(&job);
        let pending_write_guard = self.0.state.port.add_pending_write();
        self.0.spawn_job(move || {
            let result = worker_job.run();
            drop(pending_write_guard);
            let buffer = core::mem::take(&mut *worker_job.bytes.lock());
            drop(worker_job);
            completer.complete((buffer, result));
        });
        let disk_write = self.0.is_on_disk.then(|| Arc::clone(&job));
        self.0.state.owners.disk_write.set(disk_write);
        self.0.inflight_write.set(Some((request, job)));
        self.0.state.set_writing(true);
    }

    pub(super) fn try_take_io_budget(&self, len: usize) -> bool {
        let this = &self.0;
        this.is_on_disk
            && !this.is_last_write_slow.get()
            && this
                .state
                .port
                .take_io_budget(len.div_ceil(LARGE_READ_SIZE))
                > 0
    }

    pub(super) fn write_sync(&self, bytes: &[u8]) -> sys::Result<()> {
        sys::File::borrow(&self.0.fd.fd).write_all(bytes)
    }

    pub(super) fn cancel_unstarted_write(&self) {
        self.0.inflight_write.with_taken(|inflight| {
            if let Some((_, job)) = inflight {
                job.is_cancelled.store(true, Ordering::SeqCst);
            }
        });
    }
}

impl Drop for File {
    fn drop(&mut self) {
        self.pause();
        match self.0.inflight_read.take() {
            Some((_, Some(cancel_token))) if self.0.is_on_disk => cancel_token.mark_cancelled(),
            Some((_, Some(cancel_token))) => cancel_token.cancel(),
            Some((_, None)) | None => {}
        }
    }
}

impl Drop for Inner {
    fn drop(&mut self) {
        if self.is_on_disk {
            let _ = (self.fd.pending_close).set(self.state.port.add_pending_close());
        }
    }
}

impl HasSourceState for Inner {
    fn state(&self) -> &SourceState {
        &self.state
    }
}

impl Inner {
    fn spawn_job(&self, job: impl FnOnce() + Send + 'static) {
        if self.is_on_disk {
            FilePool::go(job);
        } else {
            blocking::spawn(job);
        }
    }

    /// While the loop is I/O-starved, the buffer grows for a reader that reads again within one iteration.
    fn acquire_buffer(&self, max_len: usize) -> Vec<u8> {
        /// The chunk size a native `ReadableStream` grows to on POSIX.
        const MAX_FILE_READ_SIZE: usize = 512 * 1024;
        let port = &self.state.port;
        let target_len = match self.last_full_read.take() {
            Some((len, iteration)) if port.iteration() - iteration <= 1 => {
                (len * 4).min(MAX_FILE_READ_SIZE)
            }
            _ => 0,
        };
        let extra_chunk_count = target_len
            .min(max_len)
            .div_ceil(LARGE_READ_SIZE)
            .saturating_sub(1);
        match port.take_io_budget(extra_chunk_count) {
            0 => self.state.acquire_buffer(max_len),
            granted_count => {
                Vec::with_capacity(((1 + granted_count) * LARGE_READ_SIZE).min(max_len))
            }
        }
    }

    fn maybe_start_read(self: &Rc<Self>) {
        let Some(max_len) = self.state.read_limit() else {
            return;
        };
        if self.inflight_read.is_some() {
            return;
        }
        let this = Rc::downgrade(self);
        if self.state.has_buffered_event() {
            let request = Request::defer(&self.state.port, move || {
                let Some(this) = this.upgrade() else { return };
                this.inflight_read.take();
                this.report_read();
            });
            return self.inflight_read.set(Some((request, None)));
        }
        let (request, completer) =
            Request::with_completer(&self.state.port, move |event: ReadEvent| {
                let Some(this) = this.upgrade() else { return };
                this.inflight_read.take();
                if let ReadEvent::Data(data) = &event {
                    let is_full = this.is_on_disk && data.len() == data.capacity();
                    this.last_full_read
                        .set(is_full.then(|| (data.len(), this.state.port.iteration())));
                    this.offset
                        .update(|offset| Some(offset? + data.len() as u64));
                }
                this.state.buffer_event(event);
                this.report_read();
            });
        let fd = Arc::clone(&self.fd);
        let worker_token = CancelToken::default();
        let buffer = self.acquire_buffer(max_len);
        let offset = self.offset.get();
        let cancel_token = worker_token.clone();
        let is_on_disk = self.is_on_disk;
        self.spawn_job(move || {
            let event = if is_on_disk {
                (!worker_token.is_cancelled()).then(|| read_disk(fd.fd, buffer, max_len, offset))
            } else {
                worker_token.run(|| read_device(fd.fd, buffer, max_len, offset))
            };
            drop(fd);
            completer.complete(event.unwrap_or(ReadEvent::Eof));
        });
        self.inflight_read.set(Some((request, Some(cancel_token))));
    }
}

fn read_disk(fd: Fd, mut buffer: Vec<u8>, max_len: usize, offset: Option<u64>) -> ReadEvent {
    let result = bun_core::vec::append_with(&mut buffer, max_len, |cursor| match offset {
        Some(offset) => sys::pread_buf(fd, cursor, offset as i64),
        None => sys::read_buf(fd, cursor),
    });
    match result {
        Ok(0) => ReadEvent::Eof,
        Ok(_) => ReadEvent::Data(buffer),
        Err(err) => ReadEvent::Err(sys::Error::from_code(err.get_errno(), Tag::read)),
    }
}

fn read_device(fd: Fd, mut buffer: Vec<u8>, max_len: usize, offset: Option<u64>) -> ReadEvent {
    let offset = offset.map(|offset| offset as i64);
    loop {
        match named_pipe::read_device(fd.native(), &mut buffer, max_len, offset) {
            Ok(_) if !buffer.is_empty() => return ReadEvent::Data(buffer),
            Err(NTSTATUS::PIPE_EMPTY) if named_pipe::set_blocking(fd.native()).is_ok() => {}
            Err(NTSTATUS::PIPE_EMPTY) => {
                return ReadEvent::Err(sys::Error::from_code(E::EAGAIN, Tag::read));
            }
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
