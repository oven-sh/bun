use core::cell::{Cell, OnceCell};
use std::os::windows::io::OwnedHandle;
use std::rc::{Rc, Weak};
use std::sync::Arc;

use bun_iocp::blocking::{self, CancelToken};
use bun_iocp::{Completion, Handle, OverlappedFile, Port, Request};
use bun_ptr::{CellExt as _, OptionCellExt as _};
use bun_sys::windows::named_pipe::{self, Kind};
use bun_sys::windows::{self as w, NT_ERROR, NTSTATUS, Win32Error, Win32ErrorExt as _};
use bun_sys::{self as sys, E, Fd, Tag};

use super::Payload;
use super::state::{HasSourceState, LARGE_READ_SIZE, SourceState, compute_buffer_size};
use crate::pipe_reader::ReadEvent;
use crate::pipe_writer::WriteEvent;

/// Exceeds a pipe's quota, so that `try_read` can drain a full pipe.
const MAX_DRAIN_LEN: usize = 256 * 1024;

/// A full pipe plus a write blocked on it. Fewer reads mean less contention with the writer.
const STREAM_READ_SIZE: usize = 2 * LARGE_READ_SIZE;

const MAX_READS_PER_EVENT: usize = 32;

/// A follow-up read that returns less has caught up with the writer, so more reads would only contend with it.
const SHORT_READ_THRESHOLD: usize = 8 * 1024;

#[derive(Copy, Clone, PartialEq, Eq)]
enum FillMode {
    Drain,
    StopOnShortRead,
}

/// One end of a pipe, used by a reader, a writer or both. Closed when the last clone is dropped.
#[derive(Clone)]
pub struct Pipe(Rc<Inner>);

enum IoMode {
    Overlapped(Rc<OverlappedFile>),
    Synchronous,
    NotAPipe,
}

struct InflightRequest {
    request: Request,
    /// Set if the I/O runs on a blocking thread.
    cancel_guard: Option<CancelOnDrop>,
}

struct CancelOnDrop(CancelToken);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

impl From<Request> for InflightRequest {
    fn from(request: Request) -> Self {
        InflightRequest {
            request,
            cancel_guard: None,
        }
    }
}

impl InflightRequest {
    fn cancel(&self) {
        match &self.cancel_guard {
            Some(cancel_guard) => cancel_guard.0.cancel(),
            None => self.request.cancel(),
        }
    }
}

struct Inner {
    state: SourceState,
    handle: Arc<Handle>,
    max_transfer_len: usize,
    /// Set lazily for a reader: on a synchronous handle the query blocks behind a pending read.
    io_mode: OnceCell<IoMode>,
    /// Others may read this end too, so data is consumed only when the reader is known to want it.
    is_input_shared: Cell<bool>,
    is_last_read_large: Cell<bool>,
    should_drain_eagerly: Cell<bool>,
    quota: OnceCell<usize>,
    inflight_read: Cell<Option<InflightRequest>>,
    inflight_write: Cell<Option<InflightRequest>>,
}

/// When a read on a synchronous handle consumes data.
#[derive(Copy, Clone, PartialEq, Eq)]
enum ConsumeMode {
    Immediate,
    /// After a zero-byte read has reported data.
    WaitReadable,
}

impl Pipe {
    fn new(
        port: &Rc<Port>,
        handle: Arc<Handle>,
        max_transfer_len: usize,
        is_input_shared: bool,
    ) -> Pipe {
        Pipe(Rc::new(Inner {
            state: SourceState::new(port),
            handle,
            max_transfer_len,
            io_mode: OnceCell::new(),
            is_input_shared: Cell::new(is_input_shared),
            is_last_read_large: Cell::new(false),
            should_drain_eagerly: Cell::new(false),
            quota: OnceCell::new(),
            inflight_read: Cell::new(None),
            inflight_write: Cell::new(None),
        }))
    }

    /// For an end that this process opened for overlapped I/O and shares with no other process.
    pub fn new_exclusive(port: &Rc<Port>, end: impl Into<sys::File>) -> Pipe {
        let handle = Handle::new(end.into().into_raw());
        Pipe::from_exclusive_file(
            Rc::new(OverlappedFile::new_exclusive(port, handle)),
            usize::MAX,
        )
    }

    /// Like `new_exclusive`, for a client end, whose server may be on another machine.
    pub(super) fn new_client(port: &Rc<Port>, end: OwnedHandle) -> Pipe {
        let handle = Handle::from_owned(end);
        let max_transfer_len = named_pipe::max_transfer_len(handle.raw());
        let pipe = Pipe::from_exclusive_file(
            Rc::new(OverlappedFile::new_exclusive(port, handle)),
            max_transfer_len,
        );
        pipe.0.init_quota();
        pipe
    }

    pub(super) fn from_exclusive_file(file: Rc<OverlappedFile>, max_transfer_len: usize) -> Pipe {
        let pipe = Pipe::new(
            file.port(),
            Arc::clone(file.handle()),
            max_transfer_len,
            false,
        );
        file.set_max_write_len(max_transfer_len);
        pipe.0.io_mode.get_or_init(|| IoMode::Overlapped(file));
        pipe
    }

    /// For an end of unknown origin, which is returned if it is not a pipe.
    pub(super) fn open_for_reading(port: &Rc<Port>, end: sys::File) -> Result<Pipe, sys::File> {
        if named_pipe::is_idle(end.fd().native()) {
            Pipe::open(port, end)
        } else {
            Ok(Pipe::new_shared(port, end.into_raw(), None))
        }
    }

    /// Like `open_for_reading`, for an end whose first write has to start immediately.
    pub(super) fn open(port: &Rc<Port>, end: sys::File) -> Result<Pipe, sys::File> {
        match named_pipe::kind(end.fd().native()) {
            Kind::NotAPipe => Err(end),
            kind => Ok(Pipe::new_shared(port, end.into_raw(), Some(kind))),
        }
    }

    /// For an end of unknown origin whose first write has to start immediately. On `Ok` it owns `fd`, unless that is stdio.
    pub fn open_duplex(port: &Rc<Port>, fd: Fd) -> sys::Result<Pipe> {
        let handle = fd.native();
        let kind = match w::GetFileType(handle) {
            w::FILE_TYPE_PIPE => named_pipe::kind(handle),
            _ => Kind::NotAPipe,
        };
        if kind == Kind::NotAPipe {
            return Err(sys::Error::from_code(E::ENOTSOCK, Tag::open));
        }
        let owned_fd = match fd.stdio_tag() {
            Some(_) => sys::dup(fd)?,
            None => fd,
        };
        Ok(Pipe::new_shared(port, owned_fd, Some(kind)))
    }

    fn new_shared(port: &Rc<Port>, fd: Fd, kind: Option<Kind>) -> Pipe {
        let max_transfer_len = named_pipe::max_transfer_len(fd.native());
        let pipe = Pipe::new(port, Handle::new(fd), max_transfer_len, true);
        if let Some(kind) = kind {
            pipe.0.init_io_mode(kind);
        }
        pipe
    }

    /// For an end with no other reader.
    pub fn enable_read_ahead(&self) {
        self.0.is_input_shared.set(false);
    }

    /// The unread part of a pending write is lost when the writer exits.
    pub fn enable_eager_drain(&self) {
        self.0.should_drain_eagerly.set(true);
    }

    pub fn peer_process_id(&self) -> Option<u32> {
        named_pipe::peer_process_id(self.0.handle.raw())
    }

    /// Sets whether a read keeps the loop alive. A write always does.
    pub fn update_ref(&self, value: bool) {
        self.0.state.update_ref(value);
    }

    pub(super) fn state(&self) -> &SourceState {
        &self.0.state
    }

    pub(super) fn read(&self, max_len: usize) {
        self.0
            .state
            .set_read_limit(Some(max_len.min(self.0.max_transfer_len)));
        self.0.maybe_start_read(ConsumeMode::WaitReadable);
    }

    pub(super) fn continue_read(&self, max_len: usize) {
        self.0
            .state
            .set_read_limit(Some(max_len.min(self.0.max_transfer_len)));
        self.0.maybe_start_read(ConsumeMode::Immediate);
    }

    pub(super) fn pause(&self) {
        self.0.state.set_read_limit(None);
        if self.0.is_input_shared.get() {
            self.0.cancel_read();
        }
    }

    pub(super) fn try_read(&self) -> Option<ReadEvent> {
        let this = &self.0;
        if this.is_input_shared.get() || !matches!(this.io_mode.get(), Some(IoMode::Overlapped(_)))
        {
            return None;
        }
        let mut data = match this
            .inflight_read
            .take()
            .map(|inflight| inflight.request.try_take_completion())
        {
            Some(Ok(completion)) => completion.buffer,
            // The pipe is empty. If the read is cancelled, a concurrent write above the quota succeeds with 0 bytes.
            Some(Err(request)) if request.is_pending_io() => {
                this.inflight_read.set(Some(request.into()));
                return None;
            }
            // A deferred callback, whose event is returned below or recurs on the next read.
            Some(Err(_)) | None => Vec::new(),
        };
        if !this.state.has_buffered_event() {
            this.update_read_size(&data);
            if data.is_empty() {
                this.state.reuse_buffer(core::mem::take(&mut data));
            }
            let target_len = data.len() + MAX_DRAIN_LEN;
            this.fill_buffer(&mut data, target_len, FillMode::Drain);
            if data.is_empty() {
                this.maybe_start_read(ConsumeMode::WaitReadable);
                return None;
            }
            this.state.buffer_event(ReadEvent::Data(data));
        }
        this.state.take_buffered_event()
    }

    pub(super) fn stop_reading(&self) {
        self.0.state.set_read_limit(None);
        self.0.inflight_read.take();
    }

    pub(super) fn write(&self, payload: Payload) -> sys::Result<()> {
        debug_assert!(self.0.inflight_write.is_none());
        self.0.start_write(payload, 0)
    }

    pub(super) fn try_write(&self, buffer: Vec<u8>) -> sys::Result<Option<Vec<u8>>> {
        let this = &self.0;
        let Some(IoMode::Overlapped(file)) = this.io_mode.get() else {
            return self.write(Payload::Owned(buffer)).map(|()| None);
        };
        match file.try_write(buffer, this.make_owned_write_callback(0)) {
            Ok(request) => this.set_inflight_write(request.into()),
            Err(completion) if NT_ERROR(completion.status) => {
                return Err(map_write_error(completion.status));
            }
            Err(completion) if completion.transferred >= completion.buffer.len() => {
                return Ok(Some(completion.buffer));
            }
            Err(completion) => {
                this.start_write(Payload::Owned(completion.buffer), completion.transferred)?
            }
        }
        Ok(None)
    }

    pub(super) fn stop_writing(&self) {
        self.0.state.set_writing(false);
        if let Some(inflight) = self.0.inflight_write.take()
            && let Some(mut cancel_guard) = inflight.cancel_guard
            && self.0.state.port.is_thread_exiting()
            && inflight.request.detach()
        {
            // The blocking thread finishes the write.
            cancel_guard.0 = CancelToken::default();
            return;
        }
        self.0.maybe_start_read(ConsumeMode::WaitReadable);
    }
}

fn map_read_error(status: NTSTATUS) -> ReadEvent {
    ReadEvent::Err(match status {
        NTSTATUS::PIPE_BROKEN => return ReadEvent::Eof,
        NTSTATUS::ACCESS_DENIED => sys::Error::from_code(E::ENOTCONN, Tag::recv),
        NTSTATUS::RETRY => sys::Error::from_code(E::EAGAIN, Tag::recv),
        status => sys::Error::new(Win32Error::from_ntstatus(status).to_node_errno(), Tag::recv),
    })
}

fn map_write_error(status: NTSTATUS) -> sys::Error {
    match status {
        NTSTATUS::ACCESS_DENIED => sys::Error::from_code(E::EPIPE, Tag::write),
        NTSTATUS::RETRY => sys::Error::from_code(E::EAGAIN, Tag::write),
        status => sys::Error::from_win32(Win32Error::from_ntstatus(status), Tag::write),
    }
}

impl HasSourceState for Inner {
    fn state(&self) -> &SourceState {
        &self.state
    }
}

impl Inner {
    fn init_io_mode(&self, kind: Kind) {
        self.io_mode.get_or_init(|| match kind {
            Kind::Overlapped => {
                let file = OverlappedFile::new_shared(&self.state.port, Arc::clone(&self.handle));
                file.set_max_write_len(self.max_transfer_len);
                self.init_quota();
                IoMode::Overlapped(Rc::new(file))
            }
            Kind::Synchronous => IoMode::Synchronous,
            Kind::NotAPipe => IoMode::NotAPipe,
        });
    }

    /// For a pipe created elsewhere, whose quota is often 4 KiB or zero.
    fn init_quota(&self) {
        const MIN_QUOTA: usize = 4096;
        if self.max_transfer_len == usize::MAX {
            self.quota.get_or_init(|| {
                let quota = named_pipe::input_quota(self.handle.raw());
                quota.map_or(LARGE_READ_SIZE, |quota| {
                    quota.clamp(MIN_QUOTA, LARGE_READ_SIZE)
                })
            });
        }
    }

    /// Whether `len` bytes fill the pipe, which blocks the writer.
    fn is_quota_reached(&self, len: usize) -> bool {
        len >= self.quota.get().copied().unwrap_or(LARGE_READ_SIZE)
    }

    // ── reading ──────────────────────────────────────────────────────────

    fn make_read_callback<T>(
        self: &Rc<Self>,
        f: impl FnOnce(Rc<Self>, T) + 'static,
    ) -> impl FnOnce(T) + 'static {
        let this = Rc::downgrade(self);
        move |result| {
            if let Some(this) = Weak::upgrade(&this) {
                this.inflight_read.take();
                f(this, result);
            }
        }
    }

    fn make_deferred_read_callback(
        self: &Rc<Self>,
        f: impl FnOnce(Rc<Self>) + 'static,
    ) -> impl FnOnce() + 'static {
        let callback = self.make_read_callback(|this, ()| f(this));
        move || callback(())
    }

    fn cancel_read(&self) {
        self.inflight_read
            .with_taken(|inflight| inflight.as_ref().map(InflightRequest::cancel));
    }

    fn maybe_start_read(self: &Rc<Self>, mode: ConsumeMode) {
        let Some(max_len) = self.state.read_limit() else {
            return;
        };
        if self.inflight_read.is_some() {
            return;
        }
        if self.state.has_buffered_event() {
            let callback = self.make_deferred_read_callback(Inner::report_read);
            return self.inflight_read.set(Some(
                Request::defer_read_completion(&self.state.port, callback).into(),
            ));
        }
        let handle = self.handle.raw();
        match self.io_mode.get() {
            Some(IoMode::Overlapped(file)) if self.is_input_shared.get() => {
                let callback = self.make_read_callback(Inner::on_readable);
                self.set_inflight_read(file.read(Vec::new(), 0, callback));
            }
            Some(IoMode::Overlapped(file)) => {
                self.set_inflight_read(self.read_overlapped(file, max_len))
            }
            Some(IoMode::NotAPipe) => {
                let err = sys::Error::from_code(E::ENOTSOCK, Tag::open);
                self.state.buffer_event(ReadEvent::Err(err));
                self.maybe_start_read(mode);
            }
            // A synchronous handle serializes I/O, so the read starts when the write in flight ends.
            Some(IoMode::Synchronous) if self.inflight_write.is_some() => {}
            Some(IoMode::Synchronous)
                if mode == ConsumeMode::Immediate && named_pipe::is_sole_reader(handle) =>
            {
                self.init_quota();
                match named_pipe::peek_available(handle) {
                    Ok(Some(available)) => self.read_inline(available, max_len),
                    _ => self.spawn_blocking_read(max_len, ConsumeMode::WaitReadable),
                }
            }
            Some(IoMode::Synchronous) | None => self.spawn_blocking_read(max_len, mode),
        }
    }

    fn read_inline(self: &Rc<Self>, available: usize, max_len: usize) {
        let mut buffer = self.state.acquire_buffer_with_hint(available, max_len);
        let result = named_pipe::read(self.handle.raw(), &mut buffer, max_len);
        self.set_inflight_read(Err(Completion {
            status: result.unwrap_or_else(|status| status),
            transferred: buffer.len(),
            buffer,
        }));
    }

    fn read_overlapped(
        self: &Rc<Self>,
        file: &OverlappedFile,
        max_len: usize,
    ) -> Result<Request, Completion> {
        let size_hint = if self.is_last_read_large.get() {
            STREAM_READ_SIZE
        } else {
            0
        };
        let max_len = max_len.min(size_hint.max(LARGE_READ_SIZE));
        let callback = self.make_read_callback(Inner::on_read_complete);
        file.read(
            self.state.acquire_buffer_with_hint(size_hint, max_len),
            max_len,
            callback,
        )
    }

    fn set_inflight_read(self: &Rc<Self>, result: Result<Request, Completion>) {
        let request = result.unwrap_or_else(|completion| {
            let has_failed = NT_ERROR(completion.status);
            let callback =
                self.make_deferred_read_callback(|this| this.on_read_complete(completion));
            if has_failed {
                Request::defer(&self.state.port, callback).mark_hangup()
            } else {
                Request::defer_read_completion(&self.state.port, callback)
            }
        });
        self.inflight_read.set(Some(request.into()));
    }

    fn on_readable(self: Rc<Self>, completion: Completion) {
        if NT_ERROR(completion.status) {
            return self.on_read_complete(completion);
        }
        if let Some(max_len) = self.state.read_limit()
            && let Some(IoMode::Overlapped(file)) = self.io_mode.get()
        {
            match self
                .read_overlapped(file, max_len)
                .map(Request::take_sync_completion)
            {
                Ok(Ok(read_completion)) | Err(read_completion) => {
                    self.on_read_complete(read_completion)
                }
                Ok(Err(request)) => self.set_inflight_read(Ok(request)),
            }
        }
    }

    /// A pending read completes on the first write, so this appends the data of later writes. May leave the next read in flight.
    fn fill_buffer(self: &Rc<Self>, buffer: &mut Vec<u8>, target_len: usize, mode: FillMode) {
        let Some(max_len) = self.state.read_limit() else {
            return;
        };
        let Some(IoMode::Overlapped(file)) = self.io_mode.get() else {
            return;
        };
        if self.is_input_shared.get() {
            return;
        }
        let mut read_count = 0;
        let mut last_read_len = SHORT_READ_THRESHOLD;
        while buffer.len() < max_len {
            let result = self.read_overlapped(file, max_len - buffer.len());
            read_count += 1;
            if last_read_len < SHORT_READ_THRESHOLD && mode == FillMode::StopOnShortRead {
                return self.set_inflight_read(result.inspect(Request::defer_to_next_iteration));
            }
            if buffer.len() >= target_len || read_count == MAX_READS_PER_EVENT {
                return self.set_inflight_read(result);
            }
            match result.map(Request::take_sync_completion) {
                Ok(Ok(completion)) if completion.buffer.is_empty() => return,
                Ok(Ok(completion)) => {
                    self.update_read_size(&completion.buffer);
                    buffer.extend_from_slice(&completion.buffer);
                    last_read_len = completion.buffer.len();
                    if self.is_quota_reached(buffer.len()) {
                        self.state.port.expect_more_data();
                    }
                    self.state.reuse_buffer(completion.buffer);
                }
                Ok(Err(request)) => return self.set_inflight_read(Ok(request)),
                Err(completion) => return self.set_inflight_read(Err(completion)),
            }
        }
    }

    fn try_start_bulk_read(self: &Rc<Self>, buffered_len: usize) -> bool {
        if self.should_drain_eagerly.get()
            && let Some(max_len) = self.state.read_limit()
            && let Some(IoMode::Overlapped(file)) = self.io_mode.get()
            && let Ok(Some(available)) = named_pipe::peek_available(self.handle.raw())
        {
            let len = available.min(max_len.saturating_sub(buffered_len));
            if len >= STREAM_READ_SIZE {
                let callback = self.make_read_callback(Inner::on_read_complete);
                self.set_inflight_read(file.read_large(len, callback));
                return true;
            }
        }
        false
    }

    /// Returns whether the read filled its buffer or reached `LARGE_READ_SIZE`, in which case more data is likely.
    fn update_read_size(&self, buffer: &Vec<u8>) -> bool {
        self.is_last_read_large.set(buffer.len() >= LARGE_READ_SIZE);
        let is_full_read =
            !buffer.is_empty() && buffer.len() >= buffer.capacity().min(LARGE_READ_SIZE);
        if is_full_read {
            self.state.use_large_buffer();
        }
        is_full_read
    }

    fn on_read_complete(self: Rc<Self>, completion: Completion) {
        let status = completion.status;
        let mut buffer = completion.buffer;
        let is_full_read = self.update_read_size(&buffer);
        if !buffer.is_empty() {
            if is_full_read || self.is_quota_reached(buffer.len()) {
                self.state.port.expect_more_data();
            } else {
                self.state.port.note_receive();
            }
            if !(is_full_read && self.try_start_bulk_read(buffer.len())) {
                let mode = if self.should_drain_eagerly.get() || self.state.port.is_iteration_slow()
                {
                    FillMode::Drain
                } else {
                    FillMode::StopOnShortRead
                };
                self.fill_buffer(&mut buffer, LARGE_READ_SIZE, mode);
            }
            self.state.buffer_event(ReadEvent::Data(buffer));
            return self.report_read();
        }
        match status {
            NTSTATUS::CANCELLED => {}
            NTSTATUS::PIPE_EMPTY if named_pipe::set_blocking(self.handle.raw()).is_ok() => {}
            status if NT_ERROR(status) => {
                self.state.buffer_event(map_read_error(status));
                return self.report_read();
            }
            _ => {}
        }
        self.state.reuse_buffer(buffer);
        self.maybe_start_read(ConsumeMode::WaitReadable);
    }

    fn spawn_blocking_read(self: &Rc<Self>, max_len: usize, mode: ConsumeMode) {
        let callback = self.make_read_callback(|this, (kind, read): (Kind, BlockingRead)| {
            this.init_io_mode(kind);
            match read {
                BlockingRead::Completed(completion) => this.on_read_complete(completion),
                BlockingRead::Readable(buffer) => {
                    this.state.reuse_buffer(buffer);
                    this.maybe_start_read(ConsumeMode::Immediate);
                }
            }
        });
        let (request, completer) = Request::with_completer(&self.state.port, callback);
        let handle = Arc::clone(&self.handle);
        let worker_token = CancelToken::default();
        let buffer = self.state.acquire_buffer(max_len);
        let cancel_token = worker_token.clone();
        let is_kind_known = self.io_mode.get().is_some();
        let is_remote = self.max_transfer_len != usize::MAX;
        blocking::spawn(move || {
            let kind = resolve_kind(&handle, is_kind_known);
            let read = match kind {
                Kind::Synchronous => {
                    // A reader that waits for the handle goes first, and running JS may be about to pause.
                    let can_consume = || {
                        (is_remote || !named_pipe::has_concurrent_reader())
                            && completer.is_port_parked()
                    };
                    read_synchronous(&handle, buffer, max_len, mode, &worker_token, can_consume)
                }
                Kind::Overlapped | Kind::NotAPipe => BlockingRead::Readable(buffer),
            };
            // Released before completing, so that closing the pipe from the callback takes effect immediately.
            drop(handle);
            completer.complete((kind, read));
        });
        let cancel_guard = Some(CancelOnDrop(cancel_token));
        self.inflight_read.set(Some(InflightRequest {
            request,
            cancel_guard,
        }));
    }

    // ── writing ──────────────────────────────────────────────────────────

    fn make_write_callback<T>(
        self: &Rc<Self>,
        f: impl FnOnce(Rc<Self>, T) + 'static,
    ) -> impl FnOnce(T) + 'static {
        let this = Rc::downgrade(self);
        move |result| {
            if let Some(this) = Weak::upgrade(&this) {
                this.inflight_write.take();
                f(this, result);
            }
        }
    }

    fn start_write(self: &Rc<Self>, payload: Payload, offset: usize) -> sys::Result<()> {
        let inflight = match self.io_mode.get() {
            Some(IoMode::Overlapped(file)) => self.write_overlapped(file, payload, offset)?.into(),
            Some(IoMode::Synchronous) => self.spawn_blocking_write(payload.into_vec(), offset),
            Some(IoMode::NotAPipe) | None => unreachable!("only a reader's end is opened lazily"),
        };
        self.set_inflight_write(inflight);
        Ok(())
    }

    fn set_inflight_write(&self, inflight: InflightRequest) {
        self.inflight_write.set(Some(inflight));
        self.state.set_writing(true);
    }

    fn make_owned_write_callback(
        self: &Rc<Self>,
        offset: usize,
    ) -> impl FnOnce(Completion) + 'static {
        self.make_write_callback(move |this, completion: Completion| {
            let payload = Payload::Owned(completion.buffer);
            this.on_write_complete(payload, offset, completion.status, completion.transferred);
        })
    }

    fn write_overlapped(
        self: &Rc<Self>,
        file: &OverlappedFile,
        payload: Payload,
        offset: usize,
    ) -> sys::Result<Request> {
        let result = match payload {
            Payload::Owned(buffer) => {
                file.write(buffer, offset, self.make_owned_write_callback(offset))
            }
            Payload::Shared(bytes) => {
                let payload = Payload::Shared(Rc::clone(&bytes));
                let callback = self.make_write_callback(move |this, completion: Completion| {
                    this.on_write_complete(
                        payload,
                        offset,
                        completion.status,
                        completion.transferred,
                    );
                });
                file.write_shared(bytes, offset, callback)
            }
        };
        result.map_err(|completion| map_write_error(completion.status))
    }

    fn on_write_complete(
        self: Rc<Self>,
        payload: Payload,
        offset: usize,
        status: NTSTATUS,
        written: usize,
    ) {
        let offset = offset + written;
        if NT_ERROR(status) {
            self.end_write(WriteEvent::Err(map_write_error(status)));
        } else if offset >= payload.as_bytes().len() {
            self.end_write(WriteEvent::Wrote(payload.into_spare_buffer()));
        } else if written > 0 || named_pipe::set_blocking(self.handle.raw()).is_ok() {
            self.continue_write(payload, offset);
        } else {
            self.end_write(WriteEvent::Err(map_write_error(NTSTATUS::RETRY)));
        }
    }

    fn continue_write(self: Rc<Self>, payload: Payload, offset: usize) {
        if let Err(err) = self.start_write(payload, offset) {
            self.end_write(WriteEvent::Err(err));
        }
    }

    fn spawn_blocking_write(self: &Rc<Self>, buffer: Vec<u8>, offset: usize) -> InflightRequest {
        let callback = self.make_write_callback(Inner::end_write);
        let (request, completer) = Request::with_completer(&self.state.port, callback);
        let handle = Arc::clone(&self.handle);
        let worker_token = CancelToken::default();
        let cancel_guard = Some(CancelOnDrop(worker_token.clone()));
        let pending_write_guard = self.state.port.add_pending_write();
        // A synchronous handle serializes I/O, so the write would block behind the pending read.
        self.cancel_read();
        blocking::spawn(move || {
            let result = write_synchronous(&handle, &buffer[offset..], &worker_token);
            drop(handle);
            drop(pending_write_guard);
            completer.complete(match result {
                Ok(()) => WriteEvent::Wrote(buffer),
                Err(err) => WriteEvent::Err(err),
            });
        });
        InflightRequest {
            request,
            cancel_guard,
        }
    }

    fn end_write(self: Rc<Self>, event: WriteEvent) {
        self.maybe_start_read(ConsumeMode::WaitReadable);
        self.report_write(event);
    }
}

/// A handle only reaches a blocking thread if its kind is synchronous or still unknown.
fn resolve_kind(handle: &Handle, is_known: bool) -> Kind {
    if is_known {
        Kind::Synchronous
    } else {
        named_pipe::kind(handle.raw())
    }
}

enum BlockingRead {
    Completed(Completion),
    /// Nothing was consumed: the loop thread decides whether the reader still wants the data.
    Readable(Vec<u8>),
}

fn read_synchronous(
    handle: &Handle,
    mut buffer: Vec<u8>,
    max_len: usize,
    mut mode: ConsumeMode,
    cancel_token: &CancelToken,
    can_consume: impl Fn() -> bool,
) -> BlockingRead {
    /// On a remote pipe a zero-byte read returns immediately.
    const MAX_READABLE_WAITS: usize = 3;
    let handle = handle.raw();
    let read_blocking = |buffer: &mut Vec<u8>, max_len| loop {
        if cancel_token.is_cancelled() {
            return Err(NTSTATUS::CANCELLED);
        }
        match named_pipe::read(handle, buffer, max_len) {
            Err(NTSTATUS::PIPE_EMPTY) => {
                named_pipe::set_blocking(handle).map_err(|_| NTSTATUS::RETRY)?;
            }
            result => return result,
        }
    };
    let has_consumed = cancel_token.run(|| {
        for _ in 0..MAX_READABLE_WAITS {
            if mode == ConsumeMode::Immediate
                && let Some(available) = named_pipe::peek_available(handle)?
            {
                let size = compute_buffer_size(available).min(max_len);
                if buffer.capacity() < size {
                    buffer = Vec::with_capacity(size);
                }
                break;
            }
            read_blocking(&mut buffer, 0)?;
            if cancel_token.is_cancelled() || !can_consume() {
                return Ok(false);
            }
            mode = ConsumeMode::Immediate;
        }
        read_blocking(&mut buffer, max_len).map(|_| true)
    });
    let status = match has_consumed {
        Some(Ok(false)) => return BlockingRead::Readable(buffer),
        Some(Ok(true)) => NTSTATUS::SUCCESS,
        Some(Err(status)) => status,
        None => NTSTATUS::CANCELLED,
    };
    BlockingRead::Completed(Completion {
        status,
        transferred: buffer.len(),
        buffer,
    })
}

fn write_synchronous(
    handle: &Handle,
    mut bytes: &[u8],
    cancel_token: &CancelToken,
) -> sys::Result<()> {
    let write_all = || {
        while !bytes.is_empty() {
            if cancel_token.is_cancelled() {
                return Err(NTSTATUS::CANCELLED);
            }
            let written = named_pipe::write(handle.raw(), bytes)?;
            if written == 0 {
                named_pipe::set_blocking(handle.raw()).map_err(|_| NTSTATUS::RETRY)?;
            }
            bytes = &bytes[written..];
        }
        Ok(())
    };
    let result = cancel_token.run(write_all);
    result
        .unwrap_or(Err(NTSTATUS::CANCELLED))
        .map_err(map_write_error)
}
