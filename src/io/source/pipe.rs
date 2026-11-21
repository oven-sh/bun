use core::cell::{Cell, OnceCell};
use core::time::Duration;
use std::rc::{Rc, Weak};
use std::sync::Arc;

use bun_iocp::blocking::{self, Cancel};
use bun_iocp::{AsyncFile, Completion, Handle, Port, Remote, Request};
use bun_ptr::{CellExt as _, OptionCellExt as _};
use bun_sys::windows::named_pipe::{self, Kind};
use bun_sys::windows::{self as w, NT_ERROR, NTSTATUS, Win32Error, Win32ErrorExt as _};
use bun_sys::{self as sys, E, Fd, Tag};

use super::Payload;
use super::endpoint::{BUSY_SIZE, Endpoint, HasEndpoint, room_for};
use crate::pipe_reader::ReadEvent;
use crate::pipe_writer::WriteEvent;

/// For an end that does not wait.
const RETRY_AFTER: Duration = Duration::from_millis(5);

/// More than a pipe holds.
const MAX_AVAILABLE: usize = 256 * 1024;

/// What a pipe holds, and a write that waits for room. Half as many reads run into the writer half as often.
const STREAM_SIZE: usize = 2 * BUSY_SIZE;

/// For one event.
const MAX_READS: usize = 32;

/// An end of a pipe, for a reader, a writer or both. It is closed with the last clone.
#[derive(Clone)]
pub struct Pipe(Rc<Inner>);

enum Io {
    Overlapped(Rc<AsyncFile>),
    Synchronous,
    NotAPipe,
}

struct InFlight {
    request: Request,
    thread: Option<CancelOnDrop>,
}

struct CancelOnDrop(Cancel);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

impl From<Request> for InFlight {
    fn from(request: Request) -> Self {
        let thread = None;
        InFlight { request, thread }
    }
}

impl InFlight {
    fn cancel(&self) {
        match &self.thread {
            Some(thread) => thread.0.cancel(),
            None => self.request.cancel(),
        }
    }
}

struct Inner {
    endpoint: Endpoint,
    handle: Arc<Handle>,
    /// Finding out can take as long as a read.
    io: OnceCell<Io>,
    /// Others may read it too, so data is only taken out at a moment when the reader is known to want it.
    is_input_shared: Cell<bool>,
    was_full: Cell<bool>,
    read: Cell<Option<InFlight>>,
    write: Cell<Option<InFlight>>,
}

/// When a read of shared input takes data out.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Take {
    Now,
    OnceThereIsSome,
}

impl Pipe {
    fn new(port: &Rc<Port>, handle: Arc<Handle>, is_input_shared: bool) -> Pipe {
        Pipe(Rc::new(Inner {
            endpoint: Endpoint::new(port),
            handle,
            io: OnceCell::new(),
            is_input_shared: Cell::new(is_input_shared),
            was_full: Cell::new(false),
            read: Cell::new(None),
            write: Cell::new(None),
        }))
    }

    /// For an end that this process has opened for overlapped I/O, and keeps to itself.
    pub fn from_exclusive(port: &Rc<Port>, end: impl Into<sys::File>) -> Pipe {
        let handle = Handle::new(end.into().into_raw());
        Pipe::exclusive(Rc::new(AsyncFile::exclusive(port, handle)))
    }

    pub(super) fn exclusive(file: Rc<AsyncFile>) -> Pipe {
        let pipe = Pipe::new(file.port(), Arc::clone(file.handle()), false);
        pipe.0.io.get_or_init(|| Io::Overlapped(file));
        pipe
    }

    /// For an end of unknown origin, which comes back if it turns out to be something else.
    pub(super) fn open(port: &Rc<Port>, end: sys::File) -> Result<Pipe, sys::File> {
        let handle = end.fd().native();
        match named_pipe::is_idle(handle).then(|| named_pipe::kind(handle)) {
            Some(Kind::NotAPipe) => Err(end),
            kind => Ok(Pipe::foreign(port, end.into_raw(), kind)),
        }
    }

    /// For an end of unknown origin whose first write has to start at once. It owns `fd` on `Ok`, unless that is stdio.
    pub fn open_duplex(port: &Rc<Port>, fd: Fd) -> sys::Result<Pipe> {
        let handle = fd.native();
        let kind = match w::GetFileType(handle) {
            w::FILE_TYPE_PIPE => named_pipe::kind(handle),
            _ => Kind::NotAPipe,
        };
        if kind == Kind::NotAPipe {
            return Err(sys::Error::from_code(E::ENOTSOCK, Tag::open));
        }
        let owned = match fd.stdio_tag() {
            Some(_) => sys::dup(fd)?,
            None => fd,
        };
        Ok(Pipe::foreign(port, owned, Some(kind)))
    }

    fn foreign(port: &Rc<Port>, fd: Fd, kind: Option<Kind>) -> Pipe {
        let pipe = Pipe::new(port, Handle::new(fd), true);
        if let Some(kind) = kind {
            pipe.0.set_kind(kind);
        }
        pipe
    }

    /// For an end that nobody else reads.
    pub fn read_ahead(&self) {
        self.0.is_input_shared.set(false);
    }

    pub fn peer_process_id(&self) -> Option<u32> {
        named_pipe::peer_process_id(self.0.handle.raw())
    }

    /// Whether a read keeps the loop running. A write always does.
    pub fn update_ref(&self, value: bool) {
        self.0.endpoint.update_ref(value);
    }

    pub(super) fn endpoint(&self) -> &Endpoint {
        &self.0.endpoint
    }

    pub(super) fn read(&self, max_len: usize) {
        self.0.endpoint.set_wanted(Some(max_len));
        self.0.continue_reading(Take::OnceThereIsSome);
    }

    pub(super) fn read_on(&self, max_len: usize) {
        self.0.endpoint.set_wanted(Some(max_len));
        self.0.continue_reading(Take::Now);
    }

    pub(super) fn pause(&self) {
        self.0.endpoint.set_wanted(None);
        if self.0.is_input_shared.get() {
            self.0.cancel_read();
        }
    }

    pub(super) fn take_available(&self) -> Option<ReadEvent> {
        let this = &self.0;
        if this.is_input_shared.get() || !matches!(this.io.get(), Some(Io::Overlapped(_))) {
            return None;
        }
        let mut data = match this.read.take().map(|read| read.request.finish_now()) {
            Some(Ok(completion)) => completion.buffer,
            // Either a report that is made here or once more, or a read that does not end.
            Some(Err(_)) | None => Vec::new(),
        };
        if !this.endpoint.is_holding() {
            this.size_next_read(&data);
            if data.is_empty() {
                this.endpoint.recycle(core::mem::take(&mut data));
            }
            let enough = data.len() + MAX_AVAILABLE;
            this.add_what_followed(&mut data, enough);
            if data.is_empty() {
                this.continue_reading(Take::OnceThereIsSome);
                return None;
            }
            this.endpoint.hold(ReadEvent::Data(data));
        }
        this.endpoint.take_held()
    }

    pub(super) fn stop_reading(&self) {
        self.0.endpoint.set_wanted(None);
        self.0.read.take();
    }

    pub(super) fn write(&self, payload: Payload) -> sys::Result<()> {
        debug_assert!(!self.0.write.is_some());
        self.0.start_write(payload, 0)
    }

    pub(super) fn write_now(&self, buffer: Vec<u8>) -> sys::Result<Option<Vec<u8>>> {
        let this = &self.0;
        let Some(Io::Overlapped(file)) = this.io.get() else {
            return self.write(Payload::Owned(buffer)).map(|()| None);
        };
        match file.write_now(buffer, this.on_wrote_owned(0)) {
            Ok(request) => this.started_write(request.into()),
            Err(ended) if NT_ERROR(ended.status) => return Err(write_error(ended.status)),
            Err(ended) if ended.transferred >= ended.buffer.len() => return Ok(Some(ended.buffer)),
            Err(ended) => this.start_write(Payload::Owned(ended.buffer), ended.transferred)?,
        }
        Ok(None)
    }

    pub(super) fn stop_writing(&self) {
        self.0.write.take();
        self.0.endpoint.set_writing(false);
        self.0.continue_reading(Take::OnceThereIsSome);
    }
}

fn read_error(status: NTSTATUS) -> ReadEvent {
    ReadEvent::Err(match status {
        NTSTATUS::PIPE_BROKEN => return ReadEvent::Eof,
        NTSTATUS::ACCESS_DENIED => sys::Error::from_code(E::ENOTCONN, Tag::recv),
        status => sys::Error::new(Win32Error::from_ntstatus(status).to_node_e(), Tag::recv),
    })
}

fn write_error(status: NTSTATUS) -> sys::Error {
    match status {
        NTSTATUS::ACCESS_DENIED => sys::Error::from_code(E::EPIPE, Tag::write),
        status => sys::Error::from_win32(Win32Error::from_ntstatus(status), Tag::write),
    }
}

impl HasEndpoint for Inner {
    fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }
}

impl Inner {
    fn set_kind(&self, kind: Kind) {
        self.io.get_or_init(|| match kind {
            Kind::Overlapped => {
                let file = AsyncFile::shared(&self.endpoint.port, Arc::clone(&self.handle));
                Io::Overlapped(Rc::new(file))
            }
            Kind::Synchronous => Io::Synchronous,
            Kind::NotAPipe => Io::NotAPipe,
        });
    }

    // ── reading ──────────────────────────────────────────────────────────

    /// The callback of the request in `read`.
    fn on_read<T>(
        self: &Rc<Self>,
        f: impl FnOnce(Rc<Self>, T) + 'static,
    ) -> impl FnOnce(T) + 'static {
        let this = Rc::downgrade(self);
        move |result| {
            if let Some(this) = Weak::upgrade(&this) {
                this.read.take();
                f(this, result);
            }
        }
    }

    fn later(self: &Rc<Self>, f: impl FnOnce(Rc<Self>) + 'static) -> impl FnOnce() + 'static {
        let done = self.on_read(|this, ()| f(this));
        move || done(())
    }

    fn cancel_read(&self) {
        self.read
            .with_taken(|read| read.as_ref().map(InFlight::cancel));
    }

    fn continue_reading(self: &Rc<Self>, take: Take) {
        let Some(max_len) = self.endpoint.wanted() else {
            return;
        };
        if self.read.is_some() {
            return;
        }
        if self.endpoint.is_holding() {
            let report = self.later(Inner::report_read);
            return self
                .read
                .set(Some(Request::defer(&self.endpoint.port, report).into()));
        }
        let handle = self.handle.raw();
        match self.io.get() {
            Some(Io::Overlapped(file)) if self.is_input_shared.get() => {
                let done = self.on_read(Inner::on_readable);
                self.started_read(file.read(Vec::new(), 0, done));
            }
            Some(Io::Overlapped(file)) => self.started_read(self.read_overlapped(file, max_len)),
            Some(Io::NotAPipe) => {
                let err = sys::Error::from_code(E::ENOTSOCK, Tag::open);
                self.endpoint.hold(ReadEvent::Err(err));
                self.continue_reading(take);
            }
            // It would wait for the write, which starts it when it has ended.
            Some(Io::Synchronous) | None if self.write.is_some() => {}
            Some(Io::Synchronous) if take == Take::Now && named_pipe::is_left_alone(handle) => {
                match named_pipe::input(handle) {
                    Ok(Some(available)) => self.read_here(available, max_len),
                    _ => self.read_on_thread(max_len, Take::OnceThereIsSome),
                }
            }
            Some(Io::Synchronous) | None => self.read_on_thread(max_len, take),
        }
    }

    fn read_here(self: &Rc<Self>, available: usize, max_len: usize) {
        let mut buffer = self.endpoint.buffer_for(available, max_len);
        let status = named_pipe::read(self.handle.raw(), &mut buffer, max_len);
        self.started_read(Err(Completion {
            status: status.unwrap_or_else(|status| status),
            transferred: buffer.len(),
            buffer,
        }));
    }

    fn read_overlapped(
        self: &Rc<Self>,
        file: &AsyncFile,
        max_len: usize,
    ) -> Result<Request, Completion> {
        let expected = if self.was_full.get() { STREAM_SIZE } else { 0 };
        let max_len = max_len.min(expected.max(BUSY_SIZE));
        let done = self.on_read(Inner::on_data);
        file.read(self.endpoint.buffer_for(expected, max_len), max_len, done)
    }

    fn started_read(self: &Rc<Self>, started: Result<Request, Completion>) {
        let request = started.unwrap_or_else(|refused| {
            let done = self.later(|this| this.on_data(refused));
            Request::defer(&self.endpoint.port, done)
        });
        self.read.set(Some(request.into()));
    }

    fn on_readable(self: Rc<Self>, completion: Completion) {
        match (self.endpoint.wanted(), self.io.get()) {
            _ if NT_ERROR(completion.status) => self.on_data(completion),
            (Some(max_len), Some(Io::Overlapped(file))) => {
                match (self.read_overlapped(file, max_len)).map(Request::take_immediate) {
                    Ok(Ok(ended)) | Err(ended) => self.on_data(ended),
                    Ok(Err(pending)) => self.started_read(Ok(pending)),
                }
            }
            _ => {}
        }
    }

    /// A read that was waiting ends with the first write, which tends to have company. This leaves the next read waiting.
    fn add_what_followed(self: &Rc<Self>, data: &mut Vec<u8>, enough: usize) {
        let (Some(wanted), Some(Io::Overlapped(file)), false) = (
            self.endpoint.wanted(),
            self.io.get(),
            self.is_input_shared.get(),
        ) else {
            return;
        };
        let mut reads = 0;
        while data.len() < wanted {
            let started = self.read_overlapped(file, wanted - data.len());
            reads += 1;
            if data.len() >= enough || reads == MAX_READS {
                return self.started_read(started);
            }
            match started.map(Request::take_immediate) {
                Ok(Ok(more)) if more.buffer.is_empty() => return,
                Ok(Ok(more)) => {
                    self.size_next_read(&more.buffer);
                    data.extend_from_slice(&more.buffer);
                    self.endpoint.recycle(more.buffer);
                }
                Ok(Err(pending)) => return self.started_read(Ok(pending)),
                Err(refused) => return self.started_read(Err(refused)),
            }
        }
    }

    /// `true` if more is to be expected.
    fn size_next_read(&self, read: &Vec<u8>) -> bool {
        self.was_full.set(read.len() >= BUSY_SIZE);
        let is_much = !read.is_empty() && read.len() >= read.capacity().min(BUSY_SIZE);
        if is_much {
            self.endpoint.expect_much();
        }
        is_much
    }

    fn on_data(self: Rc<Self>, completion: Completion) {
        let (status, mut buffer) = (completion.status, completion.buffer);
        let is_much = self.size_next_read(&buffer);
        if !buffer.is_empty() {
            if is_much {
                self.endpoint.port.expect_more();
            } else {
                self.endpoint.port.did_receive();
            }
            self.add_what_followed(&mut buffer, BUSY_SIZE);
            self.endpoint.hold(ReadEvent::Data(buffer));
            return self.report_read();
        }
        match status {
            NTSTATUS::PIPE_EMPTY => {
                let _ = named_pipe::set_blocking(self.handle.raw());
                let retry = self.later(|this| this.continue_reading(Take::OnceThereIsSome));
                let retry = Request::delay(&self.endpoint.port, RETRY_AFTER, retry);
                self.read.set(Some(retry.into()));
            }
            status if NT_ERROR(status) && status != NTSTATUS::CANCELLED => {
                self.endpoint.hold(read_error(status));
                self.report_read();
            }
            _ => {
                self.endpoint.recycle(buffer);
                self.continue_reading(Take::OnceThereIsSome);
            }
        }
    }

    fn read_on_thread(self: &Rc<Self>, max_len: usize, take: Take) {
        let done = self.on_read(|this, (kind, read): (Kind, ThreadRead)| {
            this.set_kind(kind);
            match read {
                ThreadRead::Ended(completion) => this.on_data(completion),
                ThreadRead::Readable(buffer) => {
                    this.endpoint.recycle(buffer);
                    this.continue_reading(Take::Now);
                }
            }
        });
        let (request, remote) = Request::remote(&self.endpoint.port, done);
        let (handle, cancel) = (Arc::clone(&self.handle), Cancel::default());
        let (buffer, thread) = (self.endpoint.buffer(max_len), cancel.clone());
        let is_kind_known = self.io.get().is_some();
        let take = self.is_input_shared.get().then_some(take);
        blocking::spawn(move || {
            let kind = kind_on_thread(&handle, is_kind_known);
            let read = match kind {
                Kind::Synchronous => {
                    read_synchronous(&handle, buffer, max_len, take, &cancel, &remote)
                }
                Kind::Overlapped | Kind::NotAPipe => ThreadRead::Readable(buffer),
            };
            // Whoever hears of the result may close the pipe, and expect that to take effect.
            drop(handle);
            remote.complete((kind, read));
        });
        let thread = Some(CancelOnDrop(thread));
        self.read.set(Some(InFlight { request, thread }));
    }

    // ── writing ──────────────────────────────────────────────────────────

    /// The callback of the request in `write`.
    fn on_write<T>(
        self: &Rc<Self>,
        f: impl FnOnce(Rc<Self>, T) + 'static,
    ) -> impl FnOnce(T) + 'static {
        let this = Rc::downgrade(self);
        move |result| {
            if let Some(this) = Weak::upgrade(&this) {
                this.write.take();
                f(this, result);
            }
        }
    }

    fn start_write(self: &Rc<Self>, payload: Payload, from: usize) -> sys::Result<()> {
        let write = match self.io.get() {
            Some(Io::Overlapped(file)) => self.write_overlapped(file, payload, from)?.into(),
            Some(Io::NotAPipe) => return Err(sys::Error::from_code(E::ENOTSOCK, Tag::open)),
            Some(Io::Synchronous) | None => self.write_on_thread(payload.into_vec(), from),
        };
        self.started_write(write);
        Ok(())
    }

    fn started_write(&self, write: InFlight) {
        self.write.set(Some(write));
        self.endpoint.set_writing(true);
    }

    fn on_wrote_owned(self: &Rc<Self>, from: usize) -> impl FnOnce(Completion) + 'static {
        self.on_write(move |this, completion: Completion| {
            let result = (completion.status, completion.transferred);
            this.on_wrote(Payload::Owned(completion.buffer), from, result);
        })
    }

    fn write_overlapped(
        self: &Rc<Self>,
        file: &AsyncFile,
        payload: Payload,
        from: usize,
    ) -> sys::Result<Request> {
        let started = match payload {
            Payload::Owned(buffer) => file.write(buffer, from, self.on_wrote_owned(from)),
            Payload::Shared(bytes) => {
                let payload = Payload::Shared(Rc::clone(&bytes));
                let done = self.on_write(move |this, completion: Completion| {
                    this.on_wrote(payload, from, (completion.status, completion.transferred));
                });
                file.write_shared(bytes, from, done)
            }
        };
        started.map_err(|refused| write_error(refused.status))
    }

    fn on_wrote(self: Rc<Self>, payload: Payload, from: usize, result: (NTSTATUS, usize)) {
        let (status, written) = result;
        let from = from + written;
        if NT_ERROR(status) {
            self.end_write(WriteEvent::Failed(write_error(status)));
        } else if from >= payload.bytes().len() {
            self.end_write(WriteEvent::Wrote(payload.into_spare()));
        } else if written > 0 {
            self.continue_writing(payload, from);
        } else {
            let _ = named_pipe::set_blocking(self.handle.raw());
            let retry = self.on_write(move |this, ()| this.continue_writing(payload, from));
            let retry = Request::delay(&self.endpoint.port, RETRY_AFTER, move || retry(()));
            self.write.set(Some(retry.into()));
        }
    }

    fn continue_writing(self: Rc<Self>, payload: Payload, from: usize) {
        if let Err(err) = self.start_write(payload, from) {
            self.end_write(WriteEvent::Failed(err));
        }
    }

    fn write_on_thread(self: &Rc<Self>, buffer: Vec<u8>, from: usize) -> InFlight {
        type Outcome = (Kind, Vec<u8>, sys::Result<()>);
        let done = self.on_write(move |this, (kind, buffer, result): Outcome| {
            this.set_kind(kind);
            match (kind, result) {
                (Kind::Synchronous, Ok(())) => this.end_write(WriteEvent::Wrote(buffer)),
                (Kind::Synchronous, Err(err)) => this.end_write(WriteEvent::Failed(err)),
                _ => {
                    this.continue_reading(Take::OnceThereIsSome);
                    this.continue_writing(Payload::Owned(buffer), from);
                }
            }
        });
        let (request, remote) = Request::remote(&self.endpoint.port, done);
        let (handle, cancel) = (Arc::clone(&self.handle), Cancel::default());
        let (thread, is_kind_known) = (Some(CancelOnDrop(cancel.clone())), self.io.get().is_some());
        let pending = self.endpoint.port.pending_write();
        // The write would wait for it.
        self.cancel_read();
        blocking::spawn(move || {
            let kind = kind_on_thread(&handle, is_kind_known);
            let result = match kind {
                Kind::Synchronous => write_synchronous(&handle, &buffer[from..], &cancel),
                Kind::Overlapped | Kind::NotAPipe => Ok(()),
            };
            drop((handle, pending));
            remote.complete((kind, buffer, result));
        });
        InFlight { request, thread }
    }

    fn end_write(self: Rc<Self>, event: WriteEvent) {
        self.continue_reading(Take::OnceThereIsSome);
        self.report_write(event);
    }
}

fn kind_on_thread(handle: &Handle, is_known: bool) -> Kind {
    if is_known {
        Kind::Synchronous
    } else {
        named_pipe::kind(handle.raw())
    }
}

enum ThreadRead {
    Ended(Completion),
    /// It is for the loop to say whether the reader still wants it.
    Readable(Vec<u8>),
}

/// `take` is `None` for input that is not shared.
fn read_synchronous<T: Send + 'static>(
    handle: &Handle,
    mut buffer: Vec<u8>,
    max_len: usize,
    mut take: Option<Take>,
    cancel: &Cancel,
    remote: &Remote<T>,
) -> ThreadRead {
    let handle = handle.raw();
    let read_blocking = |buffer: &mut Vec<u8>, max_len| loop {
        if cancel.is_cancelled() {
            return Err(NTSTATUS::CANCELLED);
        }
        match named_pipe::read(handle, buffer, max_len) {
            Err(NTSTATUS::PIPE_EMPTY) => {
                let _ = named_pipe::set_blocking(handle);
                std::thread::sleep(RETRY_AFTER);
            }
            result => return result,
        }
    };
    let read = cancel.run(|| {
        // Over the network the wait for data returns at once.
        for _ in 0..3 {
            if take == Some(Take::Now)
                && let Some(available) = named_pipe::input(handle)?
            {
                let size = room_for(available).min(max_len);
                if buffer.capacity() < size {
                    buffer = Vec::with_capacity(size);
                }
                break;
            }
            if take.is_none() {
                break;
            }
            read_blocking(&mut buffer, 0)?;
            // A script that is running may have left the input to a child, or be about to pause.
            if !remote.is_port_idle() {
                return Ok(false);
            }
            take = Some(Take::Now);
        }
        read_blocking(&mut buffer, max_len).map(|_| true)
    });
    let status = match read {
        Some(Ok(false)) => return ThreadRead::Readable(buffer),
        Some(Ok(true)) => NTSTATUS::SUCCESS,
        Some(Err(status)) => status,
        None => NTSTATUS::CANCELLED,
    };
    ThreadRead::Ended(Completion {
        status,
        transferred: buffer.len(),
        buffer,
    })
}

fn write_synchronous(handle: &Handle, mut bytes: &[u8], cancel: &Cancel) -> sys::Result<()> {
    let write_all = || {
        let mut max_len = usize::MAX;
        while !bytes.is_empty() {
            if cancel.is_cancelled() {
                return Err(NTSTATUS::CANCELLED);
            }
            let len = bytes.len().min(max_len);
            let written = named_pipe::write(handle.raw(), &bytes[..len])?;
            if written == 0 {
                max_len = named_pipe::after_empty_write(handle.raw(), len);
                std::thread::sleep(RETRY_AFTER);
            }
            bytes = &bytes[written..];
        }
        Ok(())
    };
    let result = cancel.run(write_all);
    result
        .unwrap_or(Err(NTSTATUS::CANCELLED))
        .map_err(write_error)
}
